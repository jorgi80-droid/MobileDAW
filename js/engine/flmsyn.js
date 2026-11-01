// FL Studio Mobile instruments, rebuilt for MobileDAW from the owner's FLM screenshots and instrument guide (docs/FLM-INSTRUMENTS.md):
// DirectWave (sampler, type 30), GMS (dual-oscillator hybrid synth with 3 serial FX, 31), MiniSynth (multi-mode synth with 4 FX, 32),
// SuperSaw (supersaw / supersync synth with arpeggiator and FX, 33). Same controls, tabs and signal flow as FLM:
//   note -> voice manager (poly / mono / legato / slide) -> oscillators or sample zones -> filter (key / velocity tracking, envelope)
//   -> amplitude envelope -> LFO / envelope modulation -> built-in FX -> track.
// The parameter values are in the units FLM shows (0..100 knobs, semitones, cents, tempo divisions in beats); envelope times in seconds.
// Image-Line does not publish its DSP: curves (cutoff 0..100 -> Hz, envelope times, FX algorithms) are MobileDAW's own and the sound is
// close to FLM, not bit-identical. Interface like the other instruments (instruments.js): noteOn / noteOff / allOff / setParam / render
// (adds into L / R) / active / setTempo / setBend; no allocation in the audio path.
import { TWO_PI, clamp, midiToHz, lcg, Adsr, adsrInto, polyBlep, fft } from './dsp.js';

// ------------------------------------------------------------------------------------------------ shared pieces
export const FLM_SYNC = ['8 Bars', '4 Bars', '2 Bars', '1 Bar', '2', '1', '3/4', '1/2', '1/3', '1/4', '1/6', '1/8'];   // FL tempo values: beats
const SYNC_BEATS = [32, 16, 8, 4, 2, 1, 0.75, 0.5, 1 / 3, 0.25, 1 / 6, 0.125];
export const syncBeats = (i) => SYNC_BEATS[clamp(Math.round(i), 0, SYNC_BEATS.length - 1)];
export const cutHz = (x) => 20 * Math.pow(1000, clamp(x, 0, 100) / 100);         // FLM cutoff knob 0..100 -> 20 Hz .. 20 kHz (log)
const dbg = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));
const CR = 32;                                                                   // control rate: modulation every 32 samples

// zero-delay-feedback state variable filter (12 dB/oct): mode 0 low-pass, 1 high-pass, 2 band-pass
class Svf {
  constructor() { this.a = 0; this.b = 0; this.a1 = 1; this.a2 = 0; this.a3 = 0; this.k = 2; }
  reset() { this.a = this.b = 0; }
  set(sr, f, res) { const g = Math.tan(Math.PI * clamp(f, 16, sr * 0.45) / sr); this.k = 2 - 1.97 * clamp(res, 0, 1); this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2; }
  run(x, mode) {
    const v3 = x - this.b, v1 = this.a1 * this.a + this.a2 * v3, v2 = this.b + this.a2 * this.a + this.a3 * v3;
    this.a = 2 * v1 - this.a; this.b = 2 * v2 - this.b;
    return mode === 0 ? v2 : mode === 1 ? x - this.k * v1 - v2 : v1 * this.k;
  }
}
// per-voice LFO: Hertz / One Shot (one cycle, then holds) / Tempo sync; shapes sine, saw (falling), square, random (sample & hold); attack = fade in
function lfoAdvance(v, n, hz, sr) { v.lp += hz * n / sr; v.lt += n / sr; }
function lfoValue(v, shape, oneShot, attack, rng) {
  let p = v.lp;
  if (oneShot && p >= 1) p = 0.9999;
  else if (p >= 1) { const w = Math.floor(p); p -= w; v.lp = p; if (shape === 3) v.lr = (lcg(rng) / 2147483648) - 1; }
  const x = shape === 0 ? Math.sin(TWO_PI * p) : shape === 1 ? 1 - 2 * p : shape === 2 ? (p < 0.5 ? 1 : -1) : v.lr;
  return attack > 0.0005 ? x * Math.min(1, v.lt / attack) : x;
}
// voice allocation shared by the synths: poly up to `max`, or mono (one voice; legato = no retrigger while a note is held; slide)
class Voices {
  constructor(sr, n, extra) {
    this.sr = sr; this.counter = 0; this.rng = { seed: 9137 }; this.bpm = 120; this.bendSt = 0; this.pb = 2; this.max = n; this.mono = false; this.legato = false;
    this.slide = 0; this.constSlide = true; this.stack = [];
    this.v = Array.from({ length: n }, () => ({ on: false, held: false, pitch: 0, vel: 0, age: 0, f: 440, ft: 440, gl: 1, env: new Adsr(), lp: 0, lt: 0, lr: 0, ...extra() }));
  }
  setTempo(b) { this.bpm = clamp(b, 20, 400); }
  setBend(st) { this.bendSt = st / 2 * this.pb; }                                // the UI wheel sends +-2: scaled by the instrument's PB range
  active() { for (const v of this.v) if (v.on) return true; return false; }
  pick() {
    let k = -1; const n = Math.min(this.max, this.v.length);
    for (let i = 0; i < n; i++) if (!this.v[i].on) { k = i; break; }
    if (k < 0) { k = 0; for (let i = 1; i < n; i++) if (this.v[i].age < this.v[k].age) k = i; }
    return this.v[k];
  }
  glideCoef(from, to) {                                                          // slide: fixed time (Constant) or time per octave
    const t = this.constSlide ? this.slide : this.slide * Math.abs(Math.log2(to / from));
    return t < 0.0005 ? 1 : 1 - Math.exp(-1 / (t * this.sr / 4));
  }
  noteOn(p, vel) {
    if (this.mono) {
      this.stack = this.stack.filter((x) => x.p !== p); this.stack.push({ p, vel });
      const cur = this.v.find((o) => o.on && o.held);
      if (cur) {
        const ft = midiToHz(p); cur.gl = this.glideCoef(cur.f, ft); cur.ft = ft; cur.pitch = p; cur.vel = vel;
        if (!this.legato) this.start(cur, true);
        return;
      }
      for (const o of this.v) if (o.on) { o.held = false; o.env.release(); }
      const v = this.v[0]; this.begin(v, p, vel, v.on && this.slide > 0 && !this.legato ? v.f : 0); return;   // legato (Lead / Auto): no slide from a released note
    }
    this.begin(this.pick(), p, vel, 0);
  }
  begin(v, p, vel, fromF) {
    v.on = v.held = true; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.ft = midiToHz(p);
    if (fromF > 0) { v.f = fromF; v.gl = this.glideCoef(fromF, v.ft); } else { v.f = v.ft; v.gl = 1; }
    this.start(v, false);
  }
  noteOff(p) {
    if (this.mono) {
      this.stack = this.stack.filter((x) => x.p !== p);
      const cur = this.v.find((o) => o.on && o.held && o.pitch === p);
      if (!cur) return;
      if (this.stack.length) { const t = this.stack[this.stack.length - 1], ft = midiToHz(t.p); cur.gl = this.glideCoef(cur.f, ft); cur.ft = ft; cur.pitch = t.p; if (!this.legato) this.start(cur, true); return; }
      cur.held = false; this.release(cur); return;
    }
    for (const v of this.v) if (v.on && v.held && v.pitch === p) { v.held = false; this.release(v); }
  }
  release(v) { v.env.release(); }
  allOff() { this.stack = []; for (const v of this.v) if (v.on) { v.held = false; this.release(v); } }
}

// ---- built-in effects (stereo, in place on two buffers)
class Delay {
  constructor(sr, sec = 4) { this.sr = sr; this.n = Math.ceil(sr * sec); this.l = new Float32Array(this.n); this.r = new Float32Array(this.n); this.w = 0; this.zl = 0; this.zr = 0; }
  clear() { this.l.fill(0); this.r.fill(0); this.zl = this.zr = 0; }
  // time in samples, feedback 0..1, damp 0..1 (low-pass in the loop), mix 0..1, ping = stereo cross feedback
  run(L, R, from, to, time, fb, damp, mix, ping = false) {
    const n = this.n, d = clamp(Math.round(time), 1, n - 1), c = 1 - clamp(damp, 0, 0.98), l = this.l, r = this.r;
    for (let i = from; i < to; i++) {
      let j = this.w - d; if (j < 0) j += n;
      const yl = l[j], yr = r[j];
      this.zl += (yl - this.zl) * c; this.zr += (yr - this.zr) * c;
      const xl = L[i], xr = R[i];
      l[this.w] = xl + (ping ? this.zr : this.zl) * fb; r[this.w] = xr + (ping ? this.zl : this.zr) * fb;
      if (++this.w >= n) this.w = 0;
      L[i] = xl * (1 - mix * 0.5) + yl * mix; R[i] = xr * (1 - mix * 0.5) + yr * mix;
    }
  }
}
// modulated short delay: chorus / flanger (feedback), stereo LFO in quadrature
class ModDelay {
  constructor(sr) { this.sr = sr; this.n = Math.ceil(sr * 0.05); this.l = new Float32Array(this.n); this.r = new Float32Array(this.n); this.w = 0; this.ph = 0; }
  clear() { this.l.fill(0); this.r.fill(0); }
  rd(buf, d) { let p = this.w - d; while (p < 0) p += this.n; const i = p | 0, f = p - i, j = i + 1 >= this.n ? 0 : i + 1; return buf[i] + (buf[j] - buf[i]) * f; }
  run(L, R, from, to, hz, base, depth, fb, mix) {
    const sr = this.sr, inc = hz / sr;
    for (let i = from; i < to; i++) {
      this.ph += inc; if (this.ph >= 1) this.ph -= 1;
      const dl = (base + depth * (0.5 + 0.5 * Math.sin(TWO_PI * this.ph))) * sr, dr = (base + depth * (0.5 + 0.5 * Math.cos(TWO_PI * this.ph))) * sr;
      const yl = this.rd(this.l, dl), yr = this.rd(this.r, dr), xl = L[i], xr = R[i];
      this.l[this.w] = xl + yl * fb; this.r[this.w] = xr + yr * fb;
      if (++this.w >= this.n) this.w = 0;
      L[i] = xl * (1 - mix * 0.5) + yl * mix; R[i] = xr * (1 - mix * 0.5) + yr * mix;
    }
  }
}
// phaser: 6 first-order all-pass stages per channel, swept by an LFO between freq and freq * 2^(width * 5)
class Phaser {
  constructor(sr) { this.sr = sr; this.zl = new Float64Array(6); this.zr = new Float64Array(6); this.ph = 0; this.fl = 0; this.fr = 0; }
  clear() { this.zl.fill(0); this.zr.fill(0); this.fl = this.fr = 0; }
  run(L, R, from, to, hz, f0, width, fb, mix) {
    const sr = this.sr;
    for (let i = from; i < to; i += CR) {
      const e = Math.min(to, i + CR); this.ph += hz * (e - i) / sr; if (this.ph >= 1) this.ph -= Math.floor(this.ph);
      const s = 0.5 + 0.5 * Math.sin(TWO_PI * this.ph), fc = clamp(f0 * Math.pow(2, width * 5 * s), 30, sr * 0.45), t = Math.tan(Math.PI * fc / sr), a = (t - 1) / (t + 1);
      for (let k = i; k < e; k++) {
        let xl = L[k] + this.fl * fb, xr = R[k] + this.fr * fb;
        for (let st = 0; st < 6; st++) { const yl = a * xl + this.zl[st]; this.zl[st] = xl - a * yl; xl = yl; const yr = a * xr + this.zr[st]; this.zr[st] = xr - a * yr; xr = yr; }
        this.fl = xl; this.fr = xr;
        L[k] = L[k] * (1 - mix * 0.5) + xl * mix; R[k] = R[k] * (1 - mix * 0.5) + xr * mix;
      }
    }
  }
}
// small reverb: 4 damped combs + 2 all-pass per channel (Schroeder / Freeverb layout)
const RV_C = [1116, 1188, 1277, 1356], RV_A = [556, 441];
class Reverb {
  constructor(sr) {
    const s = sr / 44100; this.c = [0, 1].map((ch) => RV_C.map((n) => ({ b: new Float32Array(Math.round((n + ch * 23) * s)), i: 0, z: 0 })));
    this.a = [0, 1].map((ch) => RV_A.map((n) => ({ b: new Float32Array(Math.round((n + ch * 23) * s)), i: 0 })));
  }
  clear() { for (const ch of this.c) for (const q of ch) { q.b.fill(0); q.z = 0; } for (const ch of this.a) for (const q of ch) q.b.fill(0); }
  run(L, R, from, to, size, wet) {
    const fb = 0.7 + 0.28 * clamp(size, 0, 1), damp = 0.25;
    for (let i = from; i < to; i++) {
      const x = (L[i] + R[i]) * 0.15;
      for (let ch = 0; ch < 2; ch++) {
        let y = 0;
        for (const q of this.c[ch]) { const o = q.b[q.i]; q.z = o * (1 - damp) + q.z * damp; q.b[q.i] = x + q.z * fb; if (++q.i >= q.b.length) q.i = 0; y += o; }
        for (const q of this.a[ch]) { const o = q.b[q.i]; const v = -y + o; q.b[q.i] = y + o * 0.5; if (++q.i >= q.b.length) q.i = 0; y = v; }
        if (ch) R[i] = R[i] * (1 - wet * 0.5) + y * wet; else L[i] = L[i] * (1 - wet * 0.5) + y * wet;
      }
    }
  }
}
// decimator: sample-rate reduction + bit reduction (MiniSynth Distortion "Decim")
function decimate(st, L, R, from, to, amt) {
  if (amt <= 0) return;
  const hold = 1 + amt * 31, bits = Math.pow(2, 16 - amt * 12);
  for (let i = from; i < to; i++) { if (++st.c >= hold) { st.c = 0; st.l = Math.round(L[i] * bits) / bits; st.r = Math.round(R[i] * bits) / bits; } L[i] = st.l; R[i] = st.r; }
}

// ---- band-limited wavetables for GMS (oscillator A / B waves): per octave mip-maps built with an inverse FFT
const WT_LEN = 2048, WT_MIPS = 10;
export const GMS_WAVES = ['Beast', 'Sine', 'Triangle', 'Saw', 'Square', 'Pulse 25%', 'Pulse 12%', 'Organ', 'Bell', 'Formant', 'Hollow', 'Brass', 'Voice', 'Digital'];
// harmonic amplitude (and sign) of harmonic h for each wave; Beast = FLM's default GMS wave: a bright, slightly nasal saw / square blend
const HARM = [
  (h) => (1 / h) * (h % 2 ? 1 : 0.55) * (1 + 1.6 * Math.exp(-((h - 7) ** 2) / 10)),
  (h) => (h === 1 ? 1 : 0),
  (h) => (h % 2 ? (((h - 1) / 2) % 2 ? -1 : 1) / (h * h) : 0),
  (h) => 1 / h,
  (h) => (h % 2 ? 1 / h : 0),
  (h) => Math.sin(Math.PI * h * 0.25) / h,
  (h) => Math.sin(Math.PI * h * 0.125) / h,
  (h) => ([1, 2, 3, 4, 6, 8].includes(h) ? [1, 0.8, 0.6, 0.5, 0.35, 0.3][[1, 2, 3, 4, 6, 8].indexOf(h)] : 0),
  (h) => (h === 1 ? 1 : h === 3 ? 0.55 : h === 5 ? 0.4 : h === 7 ? 0.3 : h === 11 ? 0.25 : h === 14 ? 0.2 : 0),
  (h) => (1 / h) * (Math.exp(-((h - 5) ** 2) / 3) * 2.5 + Math.exp(-((h - 13) ** 2) / 6) * 1.6 + 0.15),
  (h) => (h % 2 ? 1 / h : 0) * (h % 3 ? 1 : 0.2),
  (h) => (1 / h) * (1 - Math.exp(-h / 3)) * 1.8,
  (h) => (1 / h) * (Math.exp(-((h - 3) ** 2) / 2) * 2 + Math.exp(-((h - 9) ** 2) / 4) * 1.2 + 0.1),
  (h) => (h <= 24 ? (h % 4 === 1 ? 1 : h % 4 === 3 ? -0.6 : 0.2) / Math.sqrt(h) : 0),
];
let WT = null;
function wavetables() {
  if (WT) return WT;
  WT = HARM.map((fn) => {
    const mips = [];
    for (let m = 0; m < WT_MIPS; m++) {
      const maxH = Math.max(1, Math.floor(WT_LEN / 2 / Math.pow(2, m)) - 1);
      const re = new Float64Array(WT_LEN), im = new Float64Array(WT_LEN);
      for (let h = 1; h <= Math.min(maxH, WT_LEN / 2 - 1); h++) { const a = fn(h); im[h] = -a; im[WT_LEN - h] = a; }   // sine series: x(t) = sum a_h sin(2 pi h t)
      fft(re, im, WT_LEN);                                                       // forward FFT of the conjugate-symmetric spectrum -> real wave (times N, sign folded below)
      const t = new Float32Array(WT_LEN + 1); let pk = 0;
      for (let i = 0; i < WT_LEN; i++) { t[i] = re[i]; pk = Math.max(pk, Math.abs(re[i])); }
      if (pk > 0) for (let i = 0; i < WT_LEN; i++) t[i] /= pk;
      t[WT_LEN] = t[0]; mips.push(t);
    }
    return mips;
  });
  return WT;
}
function wtRead(mips, ph, dt) {                                                  // mip by the phase increment (harmonics stay below Nyquist)
  const m = clamp(Math.floor(Math.log2(Math.max(1e-9, dt * WT_LEN * 2))) + 1, 0, WT_MIPS - 1), t = mips[m], p = ph * WT_LEN, i = p | 0, f = p - i;
  return t[i] + (t[i + 1] - t[i]) * f;
}

// ---- tempo-synced arpeggiator (SuperSaw): Off / Up / Down / Up & Down / Random over the held notes and `range` octaves
class Arp {
  constructor() { this.held = []; this.pos = 0; this.step = 0; this.note = -1; this.vel = 0; }
  next(mode, range, rng) {
    const seq = this.held.slice().sort((a, b) => a.p - b.p), n = seq.length, total = n * range;
    if (!total) return null;
    let idx;
    if (mode === 1) idx = this.step % total;
    else if (mode === 2) idx = total - 1 - (this.step % total);
    else if (mode === 3) { const cyc = Math.max(1, total * 2 - 2), q = this.step % cyc; idx = q < total ? q : cyc - q; }
    else idx = (lcg(rng) >>> 8) % total;
    this.step++;
    return { p: Math.min(127, seq[idx % n].p + 12 * Math.floor(idx / n)), vel: seq[idx % n].vel };
  }
}

// ================================================================================================ DirectWave (30)
// Sample tab: Pitch, Fine Tune, ADSR, Slide Time, PB Range, Reverse, Loop, Legato, Mono. Filter: Cutoff, Resonance, Kbd Trk, Vel Trk,
// type (Off / Lowpass / Highpass / Bandpass). Filter envelope and Frequency (pitch) envelope: ADSR + Amount. LFO: Hertz / One Shot /
// Tempo, Rate, Shape, Attack, Amount, Destination (Filter / Frequency / Level / Pan). Zones (sample, root, key / velocity range, tune,
// loop) at 100 + zone * 8 + field, like DirectWave classic, so the zone editor and FLM multi-layer imports work unchanged.
const DW_ZONES = 16;
export class FlmDirectWave extends Voices {
  constructor(sr, bank) {
    super(sr, 32, () => ({ pos: 0, rate: 1, id: -1, zroot: 60, ztune: 0, zloop: false, zg: 1, zp: 0, fenv: new Adsr(), penv: new Adsr(), sl: new Svf(), sr2: new Svf(), fade: 0 }));
    this.bank = bank; this.p = new Float64Array(40);
    this.z = Array.from({ length: DW_ZONES }, () => ({ id: -1, root: 60, lo: 0, hi: 127, vlo: 1, vhi: 127, tune: 0, loop: false, gain: 1, pan: 0 }));   // gain / pan: 300 + zone * 2 (FLM layer level / pan)
    this.ap = {}; this.fp = {}; this.qp = {};
    const D = [0, 0, 0.001, 1, 1, 0.3, 0.1, 2, 0, 0, 0, 0, 100, 0, 0, 0, 1, 0.001, 1, 1, 0.3, 0, 0.001, 1, 1, 0.3, 0, 0, 0.03, 9, 0, 0, 0, 0, 0];
    D.forEach((x, i) => this.setParam(i, x));
  }
  setParam(i, x) {
    if (i >= 300) { const zi = (i - 300) >> 1; if (zi < DW_ZONES) { if ((i - 300) & 1) this.z[zi].pan = clamp(x, -1, 1); else this.z[zi].gain = dbg(clamp(x, -60, 12)); } return; }
    if (i >= 100) {
      const zi = Math.floor((i - 100) / 8), k = (i - 100) % 8; if (zi >= DW_ZONES) return; const q = this.z[zi];
      switch (k) { case 0: q.id = x | 0; break; case 1: q.root = clamp(x | 0, 0, 127); break; case 2: q.lo = clamp(x | 0, 0, 127); break; case 3: q.hi = clamp(x | 0, 0, 127); break; case 4: q.vlo = clamp(x | 0, 1, 127); break; case 5: q.vhi = clamp(x | 0, 1, 127); break; case 6: q.tune = clamp(x, -100, 100); break; case 7: q.loop = x > 0.5; break; }
      return;
    }
    if (i < 0 || i >= 40) return;
    this.p[i] = x; const p = this.p;
    if (i >= 2 && i <= 5) adsrInto(this.ap, p[2], p[3], p[4], p[5], this.sr);
    if (i >= 17 && i <= 20) adsrInto(this.fp, p[17], p[18], p[19], p[20], this.sr);
    if (i >= 22 && i <= 25) adsrInto(this.qp, p[22], p[23], p[24], p[25], this.sr);
    if (i === 6) this.slide = x; if (i === 7) this.pb = x; if (i === 10) this.legato = x > 0.5; if (i === 11) { this.mono = x > 0.5; this.allOff(); }
  }
  start(v, retrig) {
    if (!retrig) { v.fenv.v = 0; v.penv.v = 0; v.lp = 0; v.lt = 0; v.sl.reset(); v.sr2.reset(); }
    v.pos = this.p[8] > 0.5 ? -1 : 0;                                            // the sample restarts (reverse: from its end)
    v.env.start(); v.fenv.start(); v.penv.start();
  }
  release(v) { v.env.release(); v.fenv.release(); v.penv.release(); }
  noteOn(p, vel) {
    const vi = Math.round(vel * 127);
    for (const q of this.z) {                                                    // every matching zone sounds (layers); mono: the first one
      const s = q.id >= 0 ? this.bank[q.id] : null;
      if (!s || p < q.lo || p > q.hi || vi < q.vlo || vi > q.vhi) continue;
      const v = this.mono ? this.v[0] : this.pick();
      v.id = q.id; v.zroot = q.root; v.ztune = q.tune; v.zloop = q.loop; v.zg = q.gain; v.zp = q.pan;
      if (this.mono) { super.noteOn(p, vel); return; }
      this.begin(v, p, vel, 0);
    }
  }
  render(L, R, from, to) {
    const p = this.p, sr = this.sr, ftype = Math.round(p[16]), filt = ftype > 0, mode = ftype - 1, loopAll = p[9] > 0.5, rev = p[8] > 0.5;
    const lfoMode = Math.round(p[27]), lhz = lfoMode === 2 ? this.bpm / 60 / syncBeats(p[29]) : p[28], lshape = Math.round(p[30]), lamt = p[32] / 100, ldest = Math.round(p[33]);
    const lvl = dbg(p[34]), res = p[13] / 100;
    for (const v of this.v) {
      if (!v.on) continue;
      const s = this.bank[v.id];
      if (!s || s.frames < 2) { v.on = false; continue; }
      const last = s.frames - 1, sl = s.l, srr = s.r || s.l, loop = loopAll || v.zloop, base = s.rate / sr;
      if (v.pos < 0) v.pos = last;
      for (let i = from; i < to; i += CR) {
        const e2 = Math.min(to, i + CR), n = e2 - i;
        lfoAdvance(v, n, lhz, sr); const lf = lfoValue(v, lshape, lfoMode === 1, p[31], this.rng) * lamt;
        if (v.gl < 1) v.f += (v.ft - v.f) * (1 - Math.pow(1 - v.gl, n)); else v.f = v.ft;
        const fe = v.fenv.v, pe = v.penv.v;
        // pitch: note (with slide) vs zone root + Pitch / Fine / zone tune + frequency envelope (+-12 st) + LFO (+-12 st) + wheel
        const st = 12 * Math.log2(v.f / midiToHz(v.zroot)) + p[0] + (p[1] + v.ztune) / 100 + pe * p[26] / 100 * 12 + (ldest === 1 ? lf * 12 : 0) + this.bendSt;
        const step = base * Math.pow(2, st / 12) * (rev ? -1 : 1);
        if (filt) {
          const oct = (v.pitch - 60) / 12 * p[14] / 100 + (v.vel - 1) * 4 * p[15] / 100 + fe * p[21] / 100 * 6 + (ldest === 0 ? lf * 4 : 0);
          const f = cutHz(p[12]) * Math.pow(2, oct); v.sl.set(sr, f, res); v.sr2.a1 = v.sl.a1; v.sr2.a2 = v.sl.a2; v.sr2.a3 = v.sl.a3; v.sr2.k = v.sl.k;
        }
        const amp = lvl * v.vel * v.zg * (ldest === 2 ? Math.max(0, 1 + lf) : 1), pan = clamp((ldest === 3 ? lf : 0) + v.zp, -1, 1), gl = amp * Math.min(1, 1 - pan), gr = amp * Math.min(1, 1 + pan);
        for (let k = i; k < e2; k++) {
          const e = v.env.next(this.ap); v.fenv.next(this.fp); v.penv.next(this.qp);
          if (v.env.st === 0) { v.on = false; break; }
          if (v.pos > last || v.pos < 0) { if (!loop) { v.on = false; break; } v.pos = rev ? v.pos + last : v.pos - last; }
          const ip = v.pos | 0, fr = v.pos - ip, j = ip + 1 > last ? (loop ? 0 : last) : ip + 1;
          let xl = sl[ip] + (sl[j] - sl[ip]) * fr, xr = srr[ip] + (srr[j] - srr[ip]) * fr;
          if (filt) { xl = v.sl.run(xl, mode); xr = v.sr2.run(xr, mode); }
          L[k] += xl * e * gl; R[k] += xr * e * gr;
          v.pos += step;
        }
        if (!v.on) break;
      }
    }
  }
}

// ================================================================================================ GMS (31)
// Filter (Cutoff, Res, Attack, Decay, Amount, Kbd, Kind LP12 / LP24 / HP), Osc (waves A / B, Pitch B, Fine B, Phase B, Balance, Noise),
// Mod (Mod Amount, Kind Mix / FM / Ring / Sync, Attack, Decay, EG Amount, PB Range, MW Dest, MW Amount), Level (Level, Pan, ADSR), EG
// (Amount, ADSR, Vel, Dest), LFO (Amount, Shape, Dest, Rate), Voices (Transpose, Slide, Chorus Detune / Stereo, Mono, Auto, Voices
// Solo..4, Scale Flat / Chord / Octave), FX x3 in series (on, kind, LFO amount, X, Y, LFO rate, LFO shape) at 47 + slot * 7.
export const GMS_FX = ['Dist', 'Flanger', 'Phaser', 'LPF', 'HPF', 'Delay', 'Reverb', 'Panner', 'Ring Mod', 'VOX Filter'];
const SCALE = [[0, 0, 0, 0], [0, 7, 12, 19], [0, 12, -12, 24]];
const VOX = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];   // a e i o u formants
class GmsFx {
  constructor(sr) { this.sr = sr; this.dl = new Delay(sr, 2); this.md = new ModDelay(sr); this.ph = new Phaser(sr); this.rv = new Reverb(sr); this.fl = [new Svf(), new Svf()]; this.fv = [0, 1, 2].map(() => [new Svf(), new Svf()]); this.lp = 0; this.rm = 0; this.kind = -1; this.z = [0, 0]; }
  run(L, R, from, to, kind, amt, X, Y, rateBeats, shape, bpm) {
    if (kind !== this.kind) { this.kind = kind; this.dl.clear(); this.md.clear(); this.ph.clear(); this.rv.clear(); }
    const sr = this.sr, n = to - from, hz = bpm / 60 / rateBeats;
    this.lp += hz * n / sr; this.lp -= Math.floor(this.lp);
    const lv = shape === 0 ? Math.sin(TWO_PI * this.lp) : shape === 1 ? 1 - 2 * this.lp : this.lp < 0.5 ? 1 : -1;
    const x = clamp(X / 100 + amt / 100 * lv * 0.5, 0, 1), y = clamp(Y / 100, 0, 1);
    switch (kind) {
      case 0: { const drive = 1 + x * 30, f = cutHz(20 + y * 80); this.fl[0].set(sr, f, 0.1); this.fl[1].set(sr, f, 0.1); const nrm = 1 / Math.tanh(drive);
        for (let i = from; i < to; i++) { L[i] = this.fl[0].run(Math.tanh(L[i] * drive) * nrm, 0); R[i] = this.fl[1].run(Math.tanh(R[i] * drive) * nrm, 0); } break; }
      case 1: this.md.run(L, R, from, to, 0.25 + Math.abs(lv) * 0, 0.001, 0.004 * x + 0.0005, y * 0.85, 0.5); break;
      case 2: this.ph.run(L, R, from, to, 0.3, 200, x, y * 0.8, 0.6); break;
      case 3: case 4: { const f = cutHz(x * 100); this.fl[0].set(sr, f, y * 0.9); this.fl[1].set(sr, f, y * 0.9); const m = kind === 3 ? 0 : 1;
        for (let i = from; i < to; i++) { L[i] = this.fl[0].run(L[i], m); R[i] = this.fl[1].run(R[i], m); } break; }
      case 5: this.dl.run(L, R, from, to, sr * 60 / bpm * 0.75, x * 0.9, y, 0.45, true); break;
      case 6: this.rv.run(L, R, from, to, x, y); break;
      case 7: { const pan = x * 2 - 1, gl = Math.min(1, 1 - pan), gr = Math.min(1, 1 + pan); const d = Math.round(y * 0.0007 * sr);
        for (let i = from; i < to; i++) { const l = L[i], r = R[i]; L[i] = l * gl; R[i] = r * gr; }
        if (d > 0) this.dl.run(L, R, from, to, d, 0, 0, y * 0.5); break; }
      case 8: { const f = 20 * Math.pow(250, x), inc = f / sr;
        for (let i = from; i < to; i++) { this.rm += inc; if (this.rm >= 1) this.rm -= 1; const m = Math.sin(TWO_PI * this.rm); L[i] *= m; R[i] *= m; } break; }
      case 9: { const vf = x * 4, a = Math.floor(vf), b = Math.min(4, a + 1), fr = vf - a, sc = 0.75 + y * 0.5;
        for (let k = 0; k < 3; k++) { const f = (VOX[a][k] + (VOX[b][k] - VOX[a][k]) * fr) * sc; this.fv[k][0].set(sr, f, 0.85); this.fv[k][1].set(sr, f, 0.85); }
        for (let i = from; i < to; i++) { let l = 0, r = 0; for (let k = 0; k < 3; k++) { l += this.fv[k][0].run(L[i], 2) * (k ? 0.6 : 1); r += this.fv[k][1].run(R[i], 2) * (k ? 0.6 : 1); } L[i] = l * 0.6; R[i] = r * 0.6; } break; }
      default: break;
    }
  }
}
export class FlmGms extends Voices {
  constructor(sr) {
    super(sr, 16, () => ({ ph: new Float64Array(8), fenv: new Adsr(), menv: new Adsr(), eg: new Adsr(), s1: new Svf(), s2: new Svf(), s3: new Svf(), s4: new Svf(), nz: 0 }));
    this.p = new Float64Array(70); this.ap = {}; this.fp = {}; this.mp = {}; this.ep = {};
    this.bufL = new Float32Array(4096); this.bufR = new Float32Array(4096); this.fx = [0, 1, 2].map(() => new GmsFx(sr));
    this.max = 16; wavetables();
    const D = [100, 0, 0.001, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0.001, 1, 0, 2, 0, 0, 0, 0, 0.001, 1, 1, 0.1, 0, 0.001, 0.5, 0, 0.3, 0, 0, 0, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0, 0];
    for (let s = 0; s < 3; s++) D.push(0, [1, 2, 5][s], 0, 50, 50, 9, 0);
    D.forEach((x, i) => this.setParam(i, x));
  }
  setParam(i, x) {
    if (i < 0 || i >= 70) return; this.p[i] = x; const p = this.p;
    if (i === 2 || i === 3) adsrInto(this.fp, p[2], p[3], 0, p[3], this.sr);
    if (i === 16 || i === 17) adsrInto(this.mp, p[16], p[17], 0, p[17], this.sr);
    if (i >= 24 && i <= 27) adsrInto(this.ap, p[24], p[25], p[26], p[27], this.sr);
    if (i >= 29 && i <= 32) adsrInto(this.ep, p[29], p[30], p[31], p[32], this.sr);
    if (i === 19) this.pb = x; if (i === 40) this.slide = x; if (i === 43) { this.mono = x > 0.5; this.allOff(); } if (i === 44) this.legato = x > 0.5;
  }
  start(v, retrig) {
    if (!retrig) { for (let k = 0; k < 8; k++) v.ph[k] = this.p[11] * (k & 1); v.lp = 0; v.lt = 0; for (const f of [v.s1, v.s2, v.s3, v.s4]) f.reset(); v.fenv.v = 0; v.menv.v = 0; v.eg.v = 0; }
    v.env.start(); v.fenv.start(); v.menv.start(); v.eg.start();
  }
  release(v) { v.env.release(); v.eg.release(); }
  render(L, R, from, to) {
    const p = this.p, sr = this.sr, W = WT, wa = W[clamp(Math.round(p[7]), 0, W.length - 1)], wb = W[clamp(Math.round(p[8]), 0, W.length - 1)];
    const kind = Math.round(p[15]), fk = Math.round(p[6]), bal = (p[12] + 100) / 200, noise = p[13] / 100, lvl = dbg(p[22]), pan = p[23] / 100;
    const nv = clamp(Math.round(p[45]) + 1, 1, 4), sc = SCALE[clamp(Math.round(p[46]), 0, 2)], det = p[41] / 100 * 0.3, wide = p[42] / 100;
    const lhz = this.bpm / 60 / syncBeats(p[38]), lsh = Math.round(p[36]), lamt = p[35] / 100, ldst = Math.round(p[37]), edst = Math.round(p[34]), eamt = p[28] / 100;
    const res = p[1] / 100, bRatio = Math.pow(2, (p[9] + p[10] / 100) / 12), tr = p[39];
    const B = this.bufL, Bq = this.bufR, n0 = to - from;
    if (n0 > B.length) { this.render(L, R, from, from + B.length); this.render(L, R, from + B.length, to); return; }
    B.fill(0, 0, n0); Bq.fill(0, 0, n0);
    for (const v of this.v) {
      if (!v.on) continue;
      for (let i = 0; i < n0; i += CR) {
        const e2 = Math.min(n0, i + CR), n = e2 - i;
        lfoAdvance(v, n, lhz, sr); const lf = lfoValue(v, lsh, false, 0, this.rng) * lamt;
        if (v.gl < 1) v.f += (v.ft - v.f) * (1 - Math.pow(1 - v.gl, n)); else v.f = v.ft;
        const egv = v.eg.v * eamt * (p[33] > 0.5 ? v.vel : 1);
        const modD = clamp(p[14] / 100 + v.menv.v * p[18] / 100 + (edst === 1 ? egv : 0) + (ldst === 1 ? lf : 0), 0, 1);
        const pitchSt = tr + this.bendSt + (edst === 2 ? egv * 12 : 0) + (ldst === 2 ? lf * 12 : 0);
        const oct = (p[5] > 0.5 ? (v.pitch - 60) / 12 : 0) + v.fenv.v * p[4] / 100 * 6 + (edst === 0 ? egv * 6 : 0) + (ldst === 0 ? lf * 4 : 0);
        const fc = cutHz(p[0]) * Math.pow(2, oct);
        v.s1.set(sr, fc, fk === 1 ? res * 0.5 : res); v.s2.set(sr, fc, fk === 1 ? res * 0.5 : res);
        v.s3.a1 = v.s1.a1; v.s3.a2 = v.s1.a2; v.s3.a3 = v.s1.a3; v.s3.k = v.s1.k; v.s4.a1 = v.s1.a1; v.s4.a2 = v.s1.a2; v.s4.a3 = v.s1.a3; v.s4.k = v.s1.k;
        const fm = fk === 2 ? 1 : 0, two = fk === 1;
        const f0 = v.f * Math.pow(2, pitchSt / 12);
        for (let k = i; k < e2; k++) {
          const e = v.env.next(this.ap); v.fenv.next(this.fp); v.menv.next(this.mp); v.eg.next(this.ep);
          if (v.env.st === 0) { v.on = false; break; }
          let l = 0, r = 0;
          for (let u = 0; u < nv; u++) {
            const uf = f0 * Math.pow(2, (sc[u] + (u ? (u & 1 ? 1 : -1) * det * Math.ceil(u / 2) : 0)) / 12), dA = uf / sr, dB = dA * bRatio * (kind === 3 ? Math.pow(2, modD * 3) : 1);
            let pa = v.ph[u * 2] + dA, pb = v.ph[u * 2 + 1] + dB;
            if (pa >= 1) { pa -= 1; if (kind === 3) pb = pa * (dB / dA); }
            if (pb >= 1) pb -= Math.floor(pb);
            v.ph[u * 2] = pa; v.ph[u * 2 + 1] = pb;
            const b = wtRead(wb, pb, dB);
            let a;
            if (kind === 1) { let q = pa + b * modD * 0.6; q -= Math.floor(q); a = wtRead(wa, q, dA); } else a = wtRead(wa, pa, dA);
            if (kind === 2) a = a * (1 - modD) + a * b * modD;
            const x = a * (1 - bal) + b * bal, sp = nv > 1 ? (u / (nv - 1) * 2 - 1) * wide : 0;
            l += x * (1 - sp); r += x * (1 + sp);
          }
          if (noise > 0) { const nz = (lcg(this.rng) / 2147483648 - 1) * noise; l += nz; r += nz; }
          l = v.s1.run(l, fm); r = v.s2.run(r, fm);
          if (two) { l = v.s3.run(l, 0); r = v.s4.run(r, 0); }
          const g = e * v.vel * 0.2 / Math.sqrt(nv);
          B[k] += l * g; Bq[k] += r * g;
        }
        if (!v.on) break;
      }
    }
    tailOf(this, n0);
    for (let s = 0; s < 3; s++) { const o = 47 + s * 7; if (p[o] > 0.5) this.fx[s].run(B, Bq, 0, n0, Math.round(p[o + 1]), p[o + 2], p[o + 3], p[o + 4], syncBeats(p[o + 5]), Math.round(p[o + 6]), this.bpm); }
    const gl = lvl * Math.min(1, 1 - pan), gr = lvl * Math.min(1, 1 + pan);
    for (let k = 0; k < n0; k++) { L[from + k] += B[k] * gl; R[from + k] += Bq[k] * gr; }
  }
  active() { return super.active() || this.tail > 0; }
}
function tailOf(o, n) { let on = false; for (const v of o.v) if (v.on) { on = true; break; } o.tail = on ? o.sr * 6 : Math.max(0, (o.tail || 0) - n); }   // the FX (delay / reverb) ring on after the last voice

// ================================================================================================ MiniSynth (32)
// Osc (Oscillator Kind, Modifier, Noise, Transp), Filter (Cutoff, Kbd Trk, Vel Trk, Res), Flt EG (ADSR, Amount), LFO (Amount, Rate,
// Shape, Dest Filter / Frequency / Modifier, MW, MW Dest), Master (ADSR, Voices Mode Poly / Mono / Lead, Slide), FX: Distortion
// (on, Drive, Decim), Delay (on, Feedback, Filter, Mix, Time), Chorus (on, Rate, Mod, Mix), Phaser (on, Speed, Width, Feedback, Freq, Mix).
export const MINI_KINDS = ['Saw', 'Saw + Saw', 'Pulse', 'Square + Saw', 'Square + Square', 'SuperSaw', 'Bell', 'DeafSaw', 'Spread Oct', 'Spread 5th'];
const pulse = (ph, dt, w) => { let p2 = ph + 1 - w; if (p2 >= 1) p2 -= 1; return (2 * ph - 1 - polyBlep(ph, dt)) - (2 * p2 - 1 - polyBlep(p2, dt)) + (1 - 2 * w); };
const saw = (ph, dt) => 2 * ph - 1 - polyBlep(ph, dt);
const SS_OFF = [0, -1, 1, -0.6, 0.6, -0.3, 0.3, -0.85], SS_PAN = [0, -0.9, 0.9, -0.55, 0.55, -0.25, 0.25, 0.7];
export class FlmMiniSynth extends Voices {
  constructor(sr) {
    super(sr, 8, () => ({ ph: new Float64Array(8), fenv: new Adsr(), s1: new Svf(), s2: new Svf() }));
    this.p = new Float64Array(48); this.ap = {}; this.fp = {}; this.lead = false;
    this.bufL = new Float32Array(4096); this.bufR = new Float32Array(4096);
    this.dl = new Delay(sr, 4); this.ch = new ModDelay(sr); this.phs = new Phaser(sr); this.dec = { c: 0, l: 0, r: 0 };
    const D = [0, 0, 0, 0, 100, 0, 0, 0, 0.001, 1, 1, 1, 0, 0, 6, 0, 0, 0, 0, 0.001, 1, 1, 0.08, 0, 0.05,
      0, 0, 0, 0, 40, 30, 25, 6, 0, 30, 40, 40, 0, 40, 60, 40, 30, 50, 0];
    D.forEach((x, i) => this.setParam(i, x));
  }
  setParam(i, x) {
    if (i < 0 || i >= 48) return; this.p[i] = x; const p = this.p;
    if (i >= 8 && i <= 11) adsrInto(this.fp, p[8], p[9], p[10], p[11], this.sr);
    if (i >= 19 && i <= 22) adsrInto(this.ap, p[19], p[20], p[21], p[22], this.sr);
    if (i === 23) { const m = Math.round(x); this.mono = m > 0; this.legato = m === 2; this.allOff(); }
    if (i === 24) this.slide = x;
  }
  start(v, retrig) { if (!retrig) { v.lp = 0; v.lt = 0; v.s1.reset(); v.s2.reset(); v.fenv.v = 0; for (let k = 0; k < 8; k++) v.ph[k] = (lcg(this.rng) >>> 8) / 16777216; } v.env.start(); v.fenv.start(); }
  release(v) { v.env.release(); v.fenv.release(); }
  active() { return super.active() || this.tail > 0; }
  render(L, R, from, to) {
    const p = this.p, sr = this.sr, kind = clamp(Math.round(p[0]), 0, 9), mod = p[1] / 100, noise = p[2] / 100 * 0.5, res = p[7] / 100;
    const lhz = this.bpm / 60 / syncBeats(p[14]), lsh = Math.round(p[15]), lamt = p[13] / 100, ldst = Math.round(p[16]);
    const B = this.bufL, Bq = this.bufR, n0 = to - from;
    if (n0 > B.length) { this.render(L, R, from, from + B.length); this.render(L, R, from + B.length, to); return; }
    B.fill(0, 0, n0); Bq.fill(0, 0, n0);
    for (const v of this.v) {
      if (!v.on) continue;
      for (let i = 0; i < n0; i += CR) {
        const e2 = Math.min(n0, i + CR), n = e2 - i;
        lfoAdvance(v, n, lhz, sr); const lf = lfoValue(v, lsh, false, 0, this.rng) * lamt;
        if (v.gl < 1) v.f += (v.ft - v.f) * (1 - Math.pow(1 - v.gl, n)); else v.f = v.ft;
        const m = clamp(mod + (ldst === 2 ? lf * 0.5 : 0), 0, 1);
        const f0 = v.f * Math.pow(2, (p[3] + this.bendSt + (ldst === 1 ? lf * 2 : 0)) / 12), dt = f0 / sr;
        const oct = (v.pitch - 60) / 12 * p[5] / 100 + (v.vel - 1) * 4 * p[6] / 100 + v.fenv.v * p[12] / 100 * 6 + (ldst === 0 ? lf * 4 : 0);
        const fc = cutHz(p[4]) * Math.pow(2, oct); v.s1.set(sr, fc, res); v.s2.a1 = v.s1.a1; v.s2.a2 = v.s1.a2; v.s2.a3 = v.s1.a3; v.s2.k = v.s1.k;
        const r2 = Math.pow(2, (m * 24) / 12), pw = 0.5 - m * 0.45, ph = v.ph;
        const det = kind === 5 ? m * 0.5 : kind >= 8 ? m * 0.25 : 0, iv = kind === 8 ? 12 : kind === 9 ? 7 : 0;
        const d2 = dt * (kind === 1 || kind === 3 || kind === 4 ? r2 : kind >= 8 ? Math.pow(2, (iv + det) / 12) : 1);
        for (let k = i; k < e2; k++) {
          const e = v.env.next(this.ap); v.fenv.next(this.fp);
          if (v.env.st === 0) { v.on = false; break; }
          let a = ph[0] + dt; if (a >= 1) a -= 1; ph[0] = a;
          let l, r;
          if (kind === 5) {
            l = 0; r = 0;
            for (let u = 0; u < 8; u++) { const du = dt * Math.pow(2, SS_OFF[u] * det / 12); let q = (u ? ph[u] : a); if (u) { q += du; if (q >= 1) q -= 1; ph[u] = q; } const x = saw(q, du) * 0.42; l += x * (1 - SS_PAN[u]); r += x * (1 + SS_PAN[u]); }
          } else {
            let b = ph[1] + d2; if (b >= 1) b -= 1; ph[1] = b;
            let x;
            switch (kind) {
              case 0: x = 0.6 * saw(a, dt) + 0.4 * pulse(a, dt, pw); break;
              case 1: x = 0.55 * (saw(a, dt) + saw(b, d2)); break;
              case 2: { let c = a + m * 0.5; if (c >= 1) c -= 1; x = 0.5 * (pulse(a, dt, 0.5) + pulse(c, dt, 0.5)); break; }
              case 3: x = 0.5 * pulse(a, dt, 0.5) + 0.5 * saw(b, d2); break;
              case 4: x = 0.5 * (pulse(a, dt, 0.5) + pulse(b, d2, 0.5)); break;
              case 6: x = 0.7 * saw(a, dt) + m * 0.6 * Math.sin(TWO_PI * a * 3) * Math.sin(TWO_PI * a); break;
              case 7: { let c = a + 0.15 + m * 0.35; if (c >= 1) c -= 1; x = 0.55 * (saw(a, dt) + saw(c, dt)); break; }
              default: x = 0.55 * (saw(a, dt) + saw(b, d2)); break;
            }
            l = r = x;
          }
          if (noise > 0) { const nz = (lcg(this.rng) / 2147483648 - 1) * noise; l += nz; r += nz; }
          const g = e * v.vel * 0.19;
          B[k] += v.s1.run(l, 0) * g; Bq[k] += v.s2.run(r, 0) * g;
        }
        if (!v.on) break;
      }
    }
    tailOf(this, n0);
    // FX in the FLM tab order: Distortion -> Delay -> Chorus -> Phaser
    if (p[25] > 0.5) {
      const drive = 1 + p[26] / 100 * 20, nrm = 1 / Math.tanh(drive);
      if (p[26] > 0) for (let k = 0; k < n0; k++) { B[k] = Math.tanh(B[k] * drive) * nrm; Bq[k] = Math.tanh(Bq[k] * drive) * nrm; }
      decimate(this.dec, B, Bq, 0, n0, p[27] / 100);
    }
    if (p[28] > 0.5) this.dl.run(B, Bq, 0, n0, sr * 60 / this.bpm * syncBeats(p[32]), p[29] / 100 * 0.9, p[30] / 100, p[31] / 100);
    if (p[33] > 0.5) this.ch.run(B, Bq, 0, n0, 0.1 + p[34] / 100 * 4, 0.007, 0.012 * p[35] / 100, 0, p[36] / 100);
    if (p[37] > 0.5) this.phs.run(B, Bq, 0, n0, 0.05 + p[38] / 100 * 4, 80 + p[41] / 100 * 1500, p[39] / 100, p[40] / 100 * 0.85, p[42] / 100);
    const lvl = dbg(p[43]);
    for (let k = 0; k < n0; k++) { L[from + k] += B[k] * lvl; R[from + k] += Bq[k] * lvl; }
  }
}

// ================================================================================================ SuperSaw (33)
// Osc: Pulse Mode, Supersaw / Supersync, Retrig, Pulse Width, Sub Osc, Unison (Single..9), Detune, Unison Pan, Detune Spread, Unison
// Phase; Supersync: Sync, Sync PW, ADSR, Amount, Flip. Filter: Cutoff, Resonance, Kbd Trk, Vel Trk, ADSR, Amount. LFO: Hertz / One Shot /
// Tempo, Rate, Shape (Sine / Saw / Square / Random), Attack, Amount, Destination. Level: Output Level, Panning, ADSR. Mod: PW Range,
// ModWheel Amount / Dest. Voices: Poly (max voices), Transp, Slide, Legato, Constant, Mono Mode, Arp Rate / Range / Mode. FX: Distortion,
// Gain, Delay Time / Feedback / Filter / Mix.
export const SS_LFO_DEST = ['Cutoff', 'Resonance', 'Frequency', 'Osc Sync', 'Pulse Width', 'Unison Detune', 'Level', 'Pan'];
export class FlmSuperSaw extends Voices {
  constructor(sr) {
    super(sr, 16, () => ({ ph: new Float64Array(9), sp: new Float64Array(9), sub: 0, fenv: new Adsr(), senv: new Adsr(), s1: new Svf(), s2: new Svf(), dir: 1 }));
    this.p = new Float64Array(60); this.ap = {}; this.fp = {}; this.sp = {}; this.arp = new Arp(); this.lastPitch = 60;
    this.bufL = new Float32Array(4096); this.bufR = new Float32Array(4096); this.dl = new Delay(sr, 4); this.dz = [new Svf(), new Svf()];
    this.uOff = new Float64Array(9); this.uPan = new Float64Array(9);
    const D = [0, 0, 0, 50, 0, 0, 20, 0, 50, 0, 0, 50, 0.001, 0.5, 0, 0.3, 0, 0, 100, 0, 0, 0, 0.001, 0.5, 1, 0.3, 0, 0, 0.03, 9, 0, 0, 0, 0,
      100, 0, 0.001, 0.5, 1, 0.3, 2, 0, 0, 5, 0, 0.05, 0, 1, 0, 9, 2, 0, 0, 0, 6, 40, 50, 0];
    D.forEach((x, i) => this.setParam(i, x));
  }
  setParam(i, x) {
    if (i < 0 || i >= 60) return; this.p[i] = x; const p = this.p;
    if (i >= 12 && i <= 15) adsrInto(this.sp, p[12], p[13], p[14], p[15], this.sr);
    if (i >= 22 && i <= 25) adsrInto(this.fp, p[22], p[23], p[24], p[25], this.sr);
    if (i >= 36 && i <= 39) adsrInto(this.ap, p[36], p[37], p[38], p[39], this.sr);
    if (i === 40) this.pb = x; if (i === 43) this.max = clamp(Math.round(x), 1, 16); if (i === 45) this.slide = x; if (i === 46) this.legato = x > 0.5;
    if (i === 47) this.constSlide = x > 0.5; if (i === 48) { this.mono = x > 0.5; this.allOff(); }
    if (i === 51) { this.allOff(); this.arp.held = []; this.arp.note = -1; this.arp.step = 0; this.arp.pos = 0; }
  }
  start(v, retrig) {
    const p = this.p;
    if (!retrig) {
      const rt = p[2] > 0.5, ph = p[9] / 100;
      for (let k = 0; k < 9; k++) { const r = (lcg(this.rng) >>> 8) / 16777216; if (rt) { v.ph[k] = (k * 0.618 % 1) * ph; v.sp[k] = 0; } else { v.ph[k] = r; v.sp[k] = r; } }
      v.lp = 0; v.lt = 0; v.s1.reset(); v.s2.reset(); v.fenv.v = 0; v.senv.v = 0;
      v.dir = p[17] > 0.5 && v.pitch < this.lastPitch ? -1 : 1; this.lastPitch = v.pitch;
    }
    v.env.start(); v.fenv.start(); v.senv.start();
  }
  release(v) { v.env.release(); v.fenv.release(); v.senv.release(); }
  noteOn(p, vel) { if (Math.round(this.p[51]) > 0) { if (!this.arp.held.some((h) => h.p === p) && this.arp.held.length < 16) this.arp.held.push({ p, vel }); return; } super.noteOn(p, vel); }
  noteOff(p) {
    if (Math.round(this.p[51]) > 0) { this.arp.held = this.arp.held.filter((h) => h.p !== p); if (!this.arp.held.length && this.arp.note >= 0) { super.noteOff(this.arp.note); this.arp.note = -1; } return; }
    super.noteOff(p);
  }
  allOff() { super.allOff(); if (this.arp) { this.arp.note = -1; } }
  active() { return super.active() || this.tail > 0 || (Math.round(this.p[51]) > 0 && this.arp.held.length > 0); }
  render(L, R, from, to) {
    const mode = Math.round(this.p[51]);
    if (!mode) { this.renderVoices(L, R, from, to); return; }
    const step = this.sr * 60 / this.bpm * syncBeats(this.p[49]), A = this.arp; let cur = from, guard = 0;
    while (cur < to && guard++ < 64) {
      if (A.held.length && A.pos <= 0) {                                         // next arp step
        if (A.note >= 0) super.noteOff(A.note);
        const nx = A.next(mode, clamp(Math.round(this.p[50]) + 1, 1, 4), this.rng);
        if (nx) { A.note = nx.p; super.noteOn(nx.p, nx.vel); }
        A.pos = step;
      }
      const seg = A.held.length ? Math.min(to - cur, Math.max(1, Math.ceil(A.pos))) : to - cur;
      this.renderVoices(L, R, cur, cur + seg); cur += seg; if (A.held.length) A.pos -= seg; else A.pos = 0;
    }
  }
  renderVoices(L, R, from, to) {
    const p = this.p, sr = this.sr, B = this.bufL, Bq = this.bufR, n0 = to - from;
    if (n0 <= 0) return;
    if (n0 > B.length) { this.renderVoices(L, R, from, from + B.length); this.renderVoices(L, R, from + B.length, to); return; }
    B.fill(0, 0, n0); Bq.fill(0, 0, n0);
    const pulseM = p[0] > 0.5, sync = Math.round(p[1]) === 1, nu = clamp(Math.round(p[5]) + 1, 1, 9), sub = p[4] / 100, res0 = p[19] / 100;
    const lmode = Math.round(p[27]), lhz = lmode === 2 ? this.bpm / 60 / syncBeats(p[29]) : p[28], lsh = Math.round(p[30]), lamt = p[32] / 100, ld = Math.round(p[33]);
    const spreadExp = Math.pow(2, (0.5 - p[8] / 100) * 2.5), uOff = this.uOff, uPan = this.uPan, upan = p[7] / 100;
    for (let u = 0; u < nu; u++) { const x = nu === 1 ? 0 : u / (nu - 1) * 2 - 1; uOff[u] = Math.sign(x) * Math.pow(Math.abs(x), spreadExp); uPan[u] = x * upan; }
    const lvl0 = p[34] / 100, pan0 = p[35] / 100, norm = 0.19 / Math.sqrt(nu);
    for (const v of this.v) {
      if (!v.on) continue;
      for (let i = 0; i < n0; i += CR) {
        const e2 = Math.min(n0, i + CR), n = e2 - i;
        lfoAdvance(v, n, lhz, sr); const lf = lfoValue(v, lsh, lmode === 1, p[31], this.rng) * lamt;
        if (v.gl < 1) v.f += (v.ft - v.f) * (1 - Math.pow(1 - v.gl, n)); else v.f = v.ft;
        const f0 = v.f * Math.pow(2, (p[44] + this.bendSt + (ld === 2 ? lf * 12 : 0)) / 12);
        const det = clamp(p[6] / 100 + (ld === 5 ? lf * 0.5 : 0), 0, 1) * 1.0;   // up to +-1 semitone at the outer voices
        const pw = clamp(p[sync ? 11 : 3] / 100 + (ld === 4 ? lf * 0.5 : 0), 0.02, 0.98);   // Supersync has its own (minimum) pulse width
        const syncAmt = clamp(p[10] / 100 + v.senv.v * p[16] / 100 * v.dir + (ld === 3 ? lf : 0), 0, 1), sr2 = Math.pow(2, syncAmt * 4);
        const oct = (v.pitch - 60) / 12 * p[20] / 100 + (v.vel - 1) * 4 * p[21] / 100 + v.fenv.v * p[26] / 100 * 6 + (ld === 0 ? lf * 4 : 0);
        v.s1.set(sr, cutHz(p[18]) * Math.pow(2, oct), clamp(res0 + (ld === 1 ? lf * 0.5 : 0), 0, 1)); v.s2.a1 = v.s1.a1; v.s2.a2 = v.s1.a2; v.s2.a3 = v.s1.a3; v.s2.k = v.s1.k;
        const amp = lvl0 * v.vel * norm * (ld === 6 ? Math.max(0, 1 + lf) : 1), pan = clamp(pan0 + (ld === 7 ? lf : 0), -1, 1);
        const dsub = f0 / 2 / sr;
        for (let k = i; k < e2; k++) {
          const e = v.env.next(this.ap); v.fenv.next(this.fp); v.senv.next(this.sp);
          if (v.env.st === 0) { v.on = false; break; }
          let l = 0, r = 0;
          for (let u = 0; u < nu; u++) {
            const du = f0 * Math.pow(2, uOff[u] * det / 12) / sr;
            let q = v.ph[u] + du, x;
            if (sync) {
              let s = v.sp[u] + du * sr2;
              if (q >= 1) { q -= 1; s = q * sr2; }
              if (s >= 1) s -= Math.floor(s);
              v.sp[u] = s;
              x = pulseM ? (s < pw ? 1 : -1) : 2 * s - 1;
            } else {
              if (q >= 1) q -= 1;
              x = pulseM ? pulse(q, du, pw) : saw(q, du);
            }
            v.ph[u] = q;
            l += x * (1 - uPan[u]); r += x * (1 + uPan[u]);
          }
          if (sub > 0) { v.sub += dsub; if (v.sub >= 1) v.sub -= 1; const sx = saw(v.sub, dsub) * sub * Math.sqrt(nu); l += sx; r += sx; }
          const g = e * amp;
          B[k] += v.s1.run(l, 0) * g * Math.min(1, 1 - pan); Bq[k] += v.s2.run(r, 0) * g * Math.min(1, 1 + pan);
        }
        if (!v.on) break;
      }
    }
    tailOf(this, n0);
    // FX: Distortion (+ Gain after it), Delay (tempo time, feedback, filter, mix)
    if (p[52] > 0 || p[53] !== 0) {
      const drive = 1 + p[52] / 100 * 25, nrm = p[52] > 0 ? 1 / Math.tanh(drive) : 1, gn = Math.pow(10, p[53] / 20);
      for (let k = 0; k < n0; k++) { B[k] = (p[52] > 0 ? Math.tanh(B[k] * drive) * nrm : B[k]) * gn; Bq[k] = (p[52] > 0 ? Math.tanh(Bq[k] * drive) * nrm : Bq[k]) * gn; }
    }
    if (p[57] > 0) this.dl.run(B, Bq, 0, n0, sr * 60 / this.bpm * syncBeats(p[54]), p[55] / 100 * 0.9, p[56] / 100, p[57] / 100);
    for (let k = 0; k < n0; k++) { L[from + k] += B[k]; R[from + k] += Bq[k]; }
  }
}

// one cycle of a GMS wave (panel preview)
export function gmsWaveTable(i) { return wavetables()[clamp(Math.round(i), 0, HARM.length - 1)][3]; }
