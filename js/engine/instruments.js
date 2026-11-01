// Instruments of the web engine. Interface: noteOn(p, vel), noteOff(p), allOff(), setParam(i, v),
// render(L, R, from, to) (adds into the buffers), active(), setTempo(bpm).
import { LiveSampler, LiveWavetable } from './live.js';
import { Drift } from './drift.js';
import { Operator } from './operator.js';
import { Analog } from './analog.js';
import { Poli } from './poli.js';
import { Electric, Tension, Collision } from './phys.js';
import { Impulse } from './impulse.js';
import { Granulator } from './granulator.js';
import { DsKick, DsSnare, DsTom, DsHH, DsClap, DsFm } from './ds.js';
import { Meld } from './meld.js';
import { Simpler } from './simpler.js';
import { TWO_PI, clamp, midiToHz, lcg, Biquad, Adsr, adsrParams, polyBlep, sawBl, squareBl, triNaive, wave4, JOBS, runJobNow, adsrInto } from './dsp.js';

// 4-point Hermite interpolation of sample data at position pos (frames), indices clamped to [0, last]: keeps the highs of pitched samples
// (linear interpolation dulls them and smears transients)
function herm(a, pos, last) {
  const i = pos | 0, t = pos - i, i0 = i > 0 ? i - 1 : 0, i2 = i + 1 < last ? i + 1 : last, i3 = i + 2 < last ? i + 2 : last;
  const x0 = a[i0], x1 = a[i > last ? last : i], x2 = a[i2], x3 = a[i3];
  return x1 + 0.5 * t * (x2 - x0 + t * (2 * x0 - 5 * x1 + 4 * x2 - x3 + t * (3 * (x1 - x2) + x3 - x0)));
}
const satN = (x, k) => Math.tanh(k * x) / Math.tanh(k);   // saturation normalised so +-1 stays +-1: adds harmonics, keeps the peak

const N_ZONES = 16;

class Base {
  constructor(sr) { this.sr = sr; this.counter = 0; this.rng = { seed: 12345 }; }
  setTempo() {}
  alloc(voices) {   // free voice, or steal the oldest
    let k = -1;
    for (let i = 0; i < voices.length; i++) if (!voices[i].on) { k = i; break; }
    if (k < 0) { k = 0; for (let i = 1; i < voices.length; i++) if (voices[i].age < voices[k].age) k = i; }
    return voices[k];
  }
  active() { for (const v of this.v) if (v.on) return true; return false; }
  allOff() { for (const v of this.v) if (v.on) { v.held = false; v.env.release(); } }
  noteOff(p) { for (const v of this.v) if (v.on && v.held && v.pitch === p) { v.held = false; v.env.release(); } }
}
const mkVoices = (n, extra) => Array.from({ length: n }, () => ({ on: false, held: false, pitch: 0, vel: 0, age: 0, env: new Adsr(), ...extra() }));

// ------------------------------------------------------------------------------- Mini Synth
export class MiniSynth extends Base {
  constructor(sr) {
    super(sr);
    this.wave = 0; this.cutoff = 8000; this.a = 0.005; this.d = 0.15; this.s = 0.7; this.r = 0.25; this.gain = 0.35;
    this.v = mkVoices(16, () => ({ ph: 0, f: new Biquad(), dt: 0 }));
    this.coef = new Biquad(); this.upEnv(); this.upFilter();
  }
  upEnv() { this.ap = adsrParams(this.a, this.d, this.s, this.r, this.sr); }
  upFilter() { this.coef.lowpass(this.sr, this.cutoff, 0.707); }
  setParam(i, x) {
    switch (i) { case 0: this.wave = Math.round(clamp(x, 0, 2)); break; case 1: this.cutoff = x; this.upFilter(); break; case 2: this.a = x; this.upEnv(); break; case 3: this.d = x; this.upEnv(); break; case 4: this.s = x; this.upEnv(); break; case 5: this.r = x; this.upEnv(); break; case 6: this.gain = x; break; }
  }
  noteOn(p, vel) { const v = this.alloc(this.v); v.on = v.held = true; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.ph = 0; v.dt = midiToHz(p) / this.sr; v.f.reset(); v.env.start(); }
  render(L, R, from, to) {
    const w = this.wave, ap = this.ap, g0 = this.gain;
    for (const v of this.v) {
      if (!v.on) continue;
      v.f.copy(this.coef);
      const dt = v.dt, g = g0 * v.vel;
      for (let i = from; i < to; i++) {
        const e = v.env.next(ap);
        if (v.env.st === 0) { v.on = false; break; }
        v.ph += dt; if (v.ph >= 1) v.ph -= 1;
        const x = w === 0 ? sawBl(v.ph, dt) : w === 1 ? squareBl(v.ph, dt) : triNaive(v.ph);
        const y = v.f.process(x) * e * g;
        L[i] += y; R[i] += y;
      }
    }
  }
}

// ------------------------------------------------------------------------------- SuperSaw
export class SuperSaw extends Base {
  constructor(sr) {
    super(sr);
    this.det = 25; this.mix = 0.75; this.cutoff = 9000; this.a = 0.01; this.r = 0.4; this.gain = 0.3;
    this.v = mkVoices(12, () => ({ ph: new Float64Array(7), fl: new Biquad(), fr: new Biquad(), f0: 0 }));
    this.coef = new Biquad(); this.upEnv(); this.coef.lowpass(sr, this.cutoff, 0.707);
    this.off = [0, -1, 1, -2, 2, -3, 3]; this.pl = [0.5, 0.15, 0.85, 0.3, 0.7, 0.05, 0.95]; this.lev = new Float64Array(7); this.dts = new Float64Array(7);
  }
  upEnv() { this.ap = adsrParams(this.a, 0.1, 1, this.r, this.sr); }
  setParam(i, x) { switch (i) { case 0: this.det = x; break; case 1: this.mix = x; break; case 2: this.cutoff = x; this.coef.lowpass(this.sr, x, 0.707); break; case 3: this.a = x; this.upEnv(); break; case 4: this.r = x; this.upEnv(); break; case 5: this.gain = x; break; } }
  noteOn(p, vel) { const v = this.alloc(this.v); v.on = v.held = true; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.f0 = midiToHz(p); for (let k = 0; k < 7; k++) v.ph[k] = lcg(this.rng) / 4294967296; v.fl.reset(); v.fr.reset(); v.env.start(); }
  render(L, R, from, to) {
    const sr = this.sr, ap = this.ap, off = this.off, pl = this.pl, lev = this.lev, dts = this.dts, det = this.det / 3 / 1200, mix = this.mix;
    for (let vi = 0; vi < this.v.length; vi++) {
      const v = this.v[vi];
      if (!v.on) continue;
      v.fl.copy(this.coef); v.fr.copy(this.coef);
      for (let k = 0; k < 7; k++) { dts[k] = v.f0 * Math.pow(2, off[k] * det) / sr; lev[k] = k === 0 ? 1 - mix * 0.5 : mix * 0.5; }
      const g = this.gain * v.vel * 0.72, ph = v.ph;
      for (let i = from; i < to; i++) {
        const e = v.env.next(ap);
        if (v.env.st === 0) { v.on = false; break; }
        let l = 0, r = 0;
        for (let k = 0; k < 7; k++) {
          const dt = dts[k]; let p = ph[k] + dt; if (p >= 1) p -= 1; ph[k] = p;
          let x = 2 * p - 1;
          x -= polyBlep(p, dt);
          x *= lev[k]; l += x * (1 - pl[k]); r += x * pl[k];
        }
        L[i] += v.fl.process(l) * e * g; R[i] += v.fr.process(r) * e * g;
      }
    }
  }
}

// ------------------------------------------------------------------------------- Drum synth + sample pads
// 16 pad slots, each triggered by its own MIDI pitch. A pad plays either a built-in synthesised sound (kind 0..5: kick, snare, clap,
// hat, open hat, tom) or a sample from the bank. Parameters:
//   90 global pitch;  0..47: pad*3 + (0 level dB, 1 pitch semitones, 2 decay factor)  (the original scheme, kept for old projects and automation)
//   200 + pad*16 + f: 0 sample id (-1 none), 1 synth kind (-1 silent), 2 pan, 3 start 0..1, 4 end 0..1, 5 reverse, 6 attack s,
//                     7 decay s, 8 sustain 0..1, 9 release s (0 = ignore note-off, play the sample through), 10 mute, 11 midi pitch (-1 = pad unused)
const N_PADS = 16, DEF_PITCH = [36, 38, 39, 42, 46, 41];
// level of each built-in sound (kick, snare, clap, closed hat, open hat, tom) as in a mixed drum machine: kick -5.6 dBFS peak, snare / clap /
// tom a little under it, hats about 8 dB under the kick, so kick + clap + hat hitting together still leave headroom
const KIT_MIX = [0.56, 0.39, 0.32, 0.19, 0.2, 0.42];
// Drum Rack chains (Live 12): a pad can hold a chain = an instrument + effects instead of its built-in sound / sample. The pad's note plays
// the chain's instrument at C3 + the pad's Pitch (Live's "Receive"); the chain renders into its own buffer, runs its effects and is mixed with
// the pad's Level / Pan, muted when the pad is muted (or another pad soloed). rackCmd (core.js, d = -1): op 0 = clear all chains,
// 1..4 = chain effects (insert type a at j / parameter a = b / bypass a / remove j), 5 = chain instrument type a (0 = none),
// 6 = chain instrument parameter a = b, 7 = clear chain c.
export class DrumSynth extends Base {
  constructor(sr, bank, mkInst) {
    super(sr);
    this.bank = bank || []; this.mkInst = mkInst; this.rack = true; this.pst = 0;
    this.ch = Array.from({ length: N_PADS }, () => ({ inst: null, dev: [], L: new Float32Array(128), R: new Float32Array(128), note: -1 }));
    this.v = Array.from({ length: 24 }, () => ({ on: false, held: false, kind: 0, t: 0, vel: 0, ph: 0, age: 0, env: new Adsr(), n: { seed: 1 }, bp: new Biquad(), hp: 0,
      smp: false, pad: 0, sid: -1, pos: 0, dir: 1, lo: 0, hi: 0, ratio: 1, lv: 0, st: 0, ea: 0, ed: 0, es: 1, er: 0, rel: 0, g: 1, pl: 1, pr: 1,
      f2: new Biquad(), f3: new Biquad(), ph2: 0, mp: new Float64Array(6) }));
    this.gain = 1; this.rate = 1; this.pitchNative = true;   // gain 1: velocity 1 = the pad sample at unity, the built-in kit peaks about -1 dBFS
    this.pads = Array.from({ length: N_PADS }, (_, k) => ({ pitch: k < 6 ? DEF_PITCH[k] : -1, kind: k < 6 ? k : -1, sid: -1, lvl: 1, pit: 0, dec: 1, pan: 0, start: 0, end: 1, rev: false, a: 0, d: 0, s: 1, r: 0, mute: false }));
  }
  setParam(i, x) {
    if (!Number.isFinite(x)) return;
    if (i === 90) { this.pst = Math.round(clamp(x, -24, 24)); this.rate = Math.pow(2, clamp(x, -24, 24) / 12); return; }
    if (i >= 0 && i < N_PADS * 3) {
      const q = this.pads[(i / 3) | 0], j = i % 3;
      if (j === 0) q.lvl = Math.pow(10, clamp(x, -60, 12) / 20); else if (j === 1) q.pit = clamp(x, -24, 24); else q.dec = clamp(x, 0.25, 3);
      return;
    }
    if (i >= 200 && i < 200 + N_PADS * 16) {
      const q = this.pads[((i - 200) / 16) | 0];
      switch ((i - 200) % 16) {
        case 0: q.sid = x | 0; break; case 1: q.kind = clamp(x | 0, -1, 5); break; case 2: q.pan = clamp(x, -1, 1); break;
        case 3: q.start = clamp(x, 0, 1); break; case 4: q.end = clamp(x, 0, 1); break; case 5: q.rev = x > 0.5; break;
        case 6: q.a = clamp(x, 0, 4); break; case 7: q.d = clamp(x, 0, 4); break; case 8: q.s = clamp(x, 0, 1); break; case 9: q.r = clamp(x, 0, 4); break;
        case 10: q.mute = x > 0.5; break; case 11: q.pitch = x | 0; break;
        default: break;
      }
    }
  }
  padFor(p) {
    const a = this.pads;
    for (let k = 0; k < a.length; k++) if (a[k].pitch === p) return k;
    const al = p === 35 ? 36 : p === 40 ? 38 : p === 44 ? 42 : -1;       // GM aliases of the three built-in sounds
    if (al >= 0) for (let k = 0; k < a.length; k++) if (a[k].pitch === al) return k;
    return -1;
  }
  cmd(op, c, j, a, b, eng) {
    if (op === 0) { for (const x of this.ch) { if (x.inst) x.inst.allOff(); x.inst = null; x.dev.length = 0; x.note = -1; } return; }
    const x = this.ch[c]; if (!x) return;
    if (op === 7) { if (x.inst) x.inst.allOff(); x.inst = null; x.dev.length = 0; x.note = -1; return; }
    if (op === 5) { x.inst = a > 0 && this.mkInst ? this.mkInst(a) : null; if (x.inst && x.inst.setTempo) x.inst.setTempo(this.bpm || 120); return; }
    if (op === 6) { if (x.inst) x.inst.setParam(a, b); return; }
    if (op === 1) { const d = eng.mk(a); if (d) { if (d.setTempo) d.setTempo(this.bpm || 120); x.dev.splice(clamp(j, 0, x.dev.length), 0, d); } return; }
    if (op === 4) { if (j >= 0 && j < x.dev.length) x.dev.splice(j, 1); return; }
    const d = x.dev[j]; if (!d) return;
    if (op === 2) d.setParam(a, b); else if (op === 3) d.bypass = !!a;
  }
  setTempo(b) { this.bpm = b; for (const x of this.ch) { if (x.inst && x.inst.setTempo) x.inst.setTempo(b); for (const d of x.dev) if (d.setTempo) d.setTempo(b); } }
  noteOn(p, vel) {
    const k = this.padFor(p); if (k < 0) return;
    const q = this.pads[k]; if (q.mute) return;
    const cx = this.ch[k];
    if (cx.inst) { if (cx.note >= 0) cx.inst.noteOff(cx.note); cx.note = clamp(60 + Math.round(q.pit) + this.pst, 0, 127); cx.inst.noteOn(cx.note, vel); return; }
    const s = q.sid >= 0 ? this.bank[q.sid] : null;
    if (q.sid >= 0 && (!s || s.frames < 4)) return;       // sample not loaded (yet): stay silent
    if (!s && q.kind < 0) return;
    const v = this.alloc(this.v);
    v.on = true; v.age = ++this.counter; v.vel = vel; v.pad = k; v.pitch = p; v.t = 0; v.ph = 0;
    v.rt = this.rate * Math.pow(2, q.pit / 12); v.lvl = q.lvl; v.dec = q.dec;
    v.pl = q.pan <= 0 ? 1 : 1 - q.pan; v.pr = q.pan >= 0 ? 1 : 1 + q.pan;
    if (s) {
      v.smp = true; v.held = true; v.sid = q.sid;
      const f0 = Math.min(s.frames - 3, Math.floor(q.start * s.frames)), f1 = Math.max(f0 + 2, Math.min(s.frames - 1, Math.floor(q.end * s.frames)));
      v.lo = f0; v.hi = f1; v.dir = q.rev ? -1 : 1; v.pos = q.rev ? f1 - 1 : f0;
      v.ratio = (s.rate / this.sr) * v.rt;
      v.ea = Math.max(0.00012, q.a);                       // attack 0 = ~6 samples (no click, the transient stays)
      v.ed = q.d; v.es = q.s; v.er = q.r;                  // (was hidden in the comment above: pad Decay / Sustain / Release had no effect)
      v.lv = 0; v.st = 0; v.g = this.gain * v.lvl * vel;
    } else {
      v.smp = false; v.held = false; v.kind = q.kind; v.n.seed = 777 + this.counter * 31; v.hp = 0; v.ph2 = 0; v.mp.fill(0);
      for (const f of [v.bp, v.f2, v.f3]) f.z1 = f.z2 = 0;
      if (v.kind === 3) for (const o of this.v) if (o !== v && o.on && !o.smp && o.kind === 4) o.on = false;   // closed hat chokes the open hat
      const sr = this.sr, rt = v.rt;
      if (v.kind === 0) v.bp.bandpass(sr, 3200, 0.9);                                         // kick: beater click
      else if (v.kind === 1) { v.bp.highpass(sr, 1400, 0.7); v.f2.peaking(sr, 5200, 1.1, 5); }   // snare: wires
      else if (v.kind === 2) { v.bp.bandpass(sr, 1150 * rt, 1.5); v.f2.highpass(sr, 600, 0.7); }  // clap
      else if (v.kind === 3 || v.kind === 4) { v.bp.bandpass(sr, Math.min(sr * 0.4, 8600 * rt), 1.1); v.f2.highpass(sr, Math.min(sr * 0.4, 6800 * rt), 0.7); v.f3.highShelf(sr, 11000, 0.7, 4); }   // hats: metal
      else v.bp.bandpass(sr, 2400, 0.9);                                                       // tom: stick
    }
  }
  noteOff(p) {
    const k = this.padFor(p); if (k >= 0 && this.ch[k].inst && this.ch[k].note >= 0) { this.ch[k].inst.noteOff(this.ch[k].note); this.ch[k].note = -1; }
    for (const v of this.v) if (v.on && v.smp && v.held && v.pitch === p && v.st < 3) {
      v.held = false;
      if (v.er > 0) { v.st = 3; v.rel = Math.max(v.lv, 1e-4) / (v.er * this.sr); }   // release 0 = one-shot: the sample plays to its end
    }
  }
  allOff() { for (const v of this.v) v.on = false; for (const x of this.ch) if (x.inst) { x.inst.allOff(); x.note = -1; } }
  active() { if (super.active()) return true; for (const x of this.ch) if (x.inst && x.inst.active()) return true; return false; }
  renderSample(v, L, R, from, to) {
    const s = this.bank[v.sid];
    if (!s) { v.on = false; return; }
    const sl = s.l, sr_ = s.r || s.l, sr = this.sr, g = v.g, pl = v.pl, pr = v.pr, lo = v.lo, hi = v.hi, dir = v.dir, ratio = v.ratio;
    for (let i = from; i < to; i++) {
      switch (v.st) {
        case 0: v.lv += 1 / (v.ea * sr); if (v.lv >= 1) { v.lv = 1; v.st = v.ed > 0 && v.es < 1 ? 1 : 2; } break;
        case 1: v.lv -= (1 - v.es) / (v.ed * sr); if (v.lv <= v.es) { v.lv = v.es; v.st = 2; } break;
        case 2: v.lv = v.es; break;
        default: v.lv -= v.rel; if (v.lv <= 0) { v.on = false; return; }
      }
      const pos = v.pos;
      if (dir > 0 ? pos >= hi : pos <= lo) { v.on = false; return; }
      const e = v.lv * g, last = s.frames - 1;
      L[i] += herm(sl, pos, last) * e * pl; R[i] += herm(sr_, pos, last) * e * pr;
      v.pos = pos + dir * ratio;
    }
  }
  // chain instruments render sample-accurately into their buffers; effects + mix once per block (endBlock, called by core.js)
  endBlock(L, R, n) {
    for (let k = 0; k < N_PADS; k++) {
      const x = this.ch[k]; if (!x.inst) continue;
      const q = this.pads[k], bl = x.L, br = x.R;
      if (!q.mute) {
        for (const d of x.dev) if (!d.bypass) d.process(bl, br, n);
        const pl = q.pan <= 0 ? 1 : 1 - q.pan, pr = q.pan >= 0 ? 1 : 1 + q.pan, gl = q.lvl * pl, gr = q.lvl * pr;
        for (let i = 0; i < n; i++) { L[i] += bl[i] * gl; R[i] += br[i] * gr; }
      }
      bl.fill(0, 0, n); br.fill(0, 0, n);
    }
  }
  render(L, R, from, to) {
    const sr = this.sr;
    for (const x of this.ch) if (x.inst) x.inst.render(x.L, x.R, from, to);
    for (const v of this.v) {
      if (!v.on) continue;
      if (v.smp) { this.renderSample(v, L, R, from, to); continue; }
      // Built-in kit, modelled on the classic drum machines (909 / 808) and tuned to cut through on small speakers: every drum has a
      // transient (click / snap / stick), a pitched body that sweeps down, and soft saturation that adds the upper harmonics a phone
      // speaker can play (a pure 50 Hz sine is inaudible there). ts = time in seconds scaled by the pad's Decay; rt = pad pitch.
      for (let i = from; i < to; i++) {
        const t = v.t++, ts = t * v.rt / (sr * v.dec), tr = t / sr, rt = v.rt;
        const nz = (lcg(v.n) / 2147483648) - 1;
        let y = 0, len = 0.5;
        switch (v.kind) {
          case 0: {   // kick: 230 -> 50 Hz sweep, short hold, 300 ms body, beater click, drive
            const f = (50 + 180 * Math.exp(-tr / 0.024) + 34 * Math.exp(-tr / 0.11)) * rt; v.ph += f / sr;
            const env = ts < 0.012 ? 1 : Math.exp(-(ts - 0.012) / 0.3);
            const click = v.bp.process(nz) * Math.exp(-tr / 0.0028) * 2.2 + Math.sin(TWO_PI * v.ph * 4) * Math.exp(-tr / 0.004) * 0.35;
            y = satN(Math.sin(TWO_PI * v.ph) * env + click, 2.0) * 0.9; len = 2.1; break;
          }
          case 1: {   // snare: two drum-head modes with a pitch drop + bright wires
            const d = 1 + 0.35 * Math.exp(-tr / 0.012);
            v.ph += 182 * rt * d / sr; v.ph2 += 331 * rt * d / sr;
            const tone = (Math.sin(TWO_PI * v.ph) * 0.62 + Math.sin(TWO_PI * v.ph2) * 0.34) * Math.exp(-ts / 0.075);
            const wires = v.f2.process(v.bp.process(nz)) * (Math.exp(-ts / 0.16) * 0.75 + Math.exp(-tr / 0.004) * 0.55);
            y = satN(tone + wires, 1.8) * 0.88; len = 1.3; break;
          }
          case 2: {   // clap: four hand hits 9-11 ms apart, then the room
            let e = 0; for (const o of [0, 0.0095, 0.0195, 0.031]) if (tr >= o) e = Math.max(e, Math.exp(-(tr - o) / 0.0042));
            if (tr > 0.031) e = Math.max(e, 0.55 * Math.exp(-(ts - 0.031) / 0.13));
            y = satN(v.f2.process(v.bp.process(nz)) * e * 3.2, 1.6) * 0.9; len = 1.0; break;
          }
          case 3: case 4: {   // hats: six square oscillators at the 808 ratios through band-pass + high-pass, plus a little noise
            const F = [205.3, 304.4, 369.6, 522.7, 540, 800]; let m = 0;
            for (let k = 0; k < 6; k++) { v.mp[k] += F[k] * 1.7 * rt / sr; if (v.mp[k] >= 1) v.mp[k] -= 1; m += v.mp[k] < 0.5 ? 1 : -1; }
            const metal = v.f3.process(v.f2.process(v.bp.process(m / 6 + nz * 0.45)));
            const env = v.kind === 3 ? Math.exp(-ts / 0.032) : (Math.exp(-ts / 0.32) * 0.85 + Math.exp(-ts / 0.02) * 0.15);
            y = satN(metal * env * 2.8, 1.3) * 0.88; len = v.kind === 3 ? 0.3 : 2.4; break;
          }
          default: {  // tom: 160 -> 98 Hz, stick, drive
            const f = (98 + 70 * Math.exp(-tr / 0.045)) * rt; v.ph += f / sr;
            const body = (Math.sin(TWO_PI * v.ph) + 0.18 * Math.sin(TWO_PI * v.ph * 2.01)) * Math.exp(-ts / 0.24);
            y = satN(body + v.bp.process(nz) * Math.exp(-tr / 0.003) * 0.7, 1.9) * 0.9; len = 1.7;
          }
        }
        if (ts > len) { v.on = false; break; }
        y *= v.vel * this.gain * v.lvl * KIT_MIX[v.kind];   // mix balance of the kit (headroom: a full beat stays below 0 dBFS)
        L[i] += y * v.pl; R[i] += y * v.pr;
      }
    }
  }
}

// ------------------------------------------------------------------------------- Sampler (DirectWave / Keystone)
// 0 gain, 1 attack, 2 release, 3 cutoff, 4 tune (semitones), 5 velocity sensitivity, 6 mode (0 gate: the release starts at note-off,
// 1 one-shot: the sample plays to its end, as drums are usually played);
// zone z field k: parameter 100 + z*8 + k  (0 sample id, 1 root, 2 low key, 3 high key, 4 low vel, 5 high vel, 6 tune cents, 7 loop)
// Playback like a professional sampler: Gain 80 % (the default) = the sample at unity at full velocity, Attack up to 2 ms (the old default) = instant
// (the transient is kept; a 0.12 ms ramp only removes the click), 4-point Hermite interpolation, Cutoff fully open = no filter at all,
// below that a 12 dB/oct resonance-free low-pass. A voice that is stolen fades out over 1.5 ms instead of being cut.
const SMP_UNITY = 0.8, SMP_OPEN = 17999;
export class Sampler extends Base {
  constructor(sr, bank) {
    super(sr);
    this.bank = bank; this.gain = 0.8; this.a = 0.001; this.r = 0.2; this.cutoff = 18000; this.tune = 0; this.pitch = 0; this.pitchNative = true; this.velSens = 0.7; this.oneShot = false;
    this.z = Array.from({ length: N_ZONES }, () => ({ id: -1, root: 60, lo: 0, hi: 127, vlo: 1, vhi: 127, tune: 0, loop: false }));
    this.v = mkVoices(24, () => ({ pos: 0, ratio: 1, id: -1, loop: false, fL: new Biquad(), fR: new Biquad(), fade: 0, fd: 0 }));
    this.lp = new Biquad();
    this.upEnv(); this.upFilter();
  }
  upEnv() { this.ap = adsrParams(this.a <= 0.00201 ? 0.00012 : this.a, 0.1, 1, this.r, this.sr); }
  upFilter() { this.open = this.cutoff >= SMP_OPEN; if (!this.open) this.lp.lowpass(this.sr, clamp(this.cutoff, 20, this.sr * 0.45), 0.707); for (const v of this.v) { v.fL.copy(this.lp); v.fR.copy(this.lp); } }
  setParam(i, x) {
    if (i === 90) { this.pitch = clamp(x, -24, 24); return; }
    if (i >= 100) {
      const zi = Math.floor((i - 100) / 8), k = (i - 100) % 8;
      if (zi >= N_ZONES) return;
      const q = this.z[zi];
      switch (k) { case 0: q.id = x | 0; break; case 1: q.root = clamp(x | 0, 0, 127); break; case 2: q.lo = clamp(x | 0, 0, 127); break; case 3: q.hi = clamp(x | 0, 0, 127); break; case 4: q.vlo = clamp(x | 0, 1, 127); break; case 5: q.vhi = clamp(x | 0, 1, 127); break; case 6: q.tune = clamp(x, -100, 100); break; case 7: q.loop = x > 0.5; break; }
      return;
    }
    switch (i) { case 0: this.gain = x; break; case 1: this.a = x; this.upEnv(); break; case 2: this.r = x; this.upEnv(); break; case 3: this.cutoff = x; this.upFilter(); break; case 4: this.tune = x; break; case 5: this.velSens = clamp(x, 0, 1); break; case 6: this.oneShot = x > 0.5; break; }
  }
  alloc(voices) {                       // free voice, or steal the oldest; a stolen voice that is still sounding gets a 1.5 ms fade on a spare voice
    const v = super.alloc(voices);
    if (v.on && v.fade === 0) { const sp = voices.find((o) => !o.on && o !== v); if (sp) { Object.assign(sp, { on: true, held: false, pitch: v.pitch, vel: v.vel, age: v.age, pos: v.pos, ratio: v.ratio, id: v.id, loop: v.loop, fade: 1, fd: 1 / (0.0015 * this.sr) }); sp.env.st = v.env.st; sp.env.v = v.env.v; sp.fL.copy(v.fL); sp.fL.z1 = v.fL.z1; sp.fL.z2 = v.fL.z2; sp.fR.copy(v.fR); sp.fR.z1 = v.fR.z1; sp.fR.z2 = v.fR.z2; } }
    return v;
  }
  noteOn(p, vel) {
    const vi = Math.round(vel * 127);
    for (const q of this.z) {
      const s = q.id >= 0 ? this.bank[q.id] : null;
      if (!s || p < q.lo || p > q.hi || vi < q.vlo || vi > q.vhi) continue;
      const v = this.alloc(this.v);
      v.on = v.held = true; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.pos = 0; v.id = q.id; v.loop = q.loop; v.fade = 0;
      v.fL.copy(this.lp); v.fR.copy(this.lp); v.fL.z1 = v.fL.z2 = v.fR.z1 = v.fR.z2 = 0;
      v.ratio = (s.rate / this.sr) * Math.pow(2, ((p - q.root) + this.tune + this.pitch) / 12 + q.tune / 1200);
      v.env.start();
    }
  }
  noteOff(p) { if (this.oneShot) { for (const v of this.v) if (v.on && v.held && v.pitch === p) v.held = false; return; } super.noteOff(p); }
  allOff() { for (const v of this.v) if (v.on) { v.held = false; v.env.release(); } }
  render(L, R, from, to) {
    const ap = this.ap, open = this.open;
    for (const v of this.v) {
      if (!v.on) continue;
      const s = this.bank[v.id];
      if (!s || s.frames < 2) { v.on = false; continue; }
      const g = (this.gain / SMP_UNITY) * ((1 - this.velSens) + this.velSens * v.vel), last = s.frames - 1, sl = s.l, sr_ = s.r || s.l, fL = v.fL, fR = v.fR;
      for (let i = from; i < to; i++) {
        let e = v.env.next(ap);
        if (v.env.st === 0) { v.on = false; break; }
        if (v.fade > 0) { v.fade -= v.fd; if (v.fade <= 0) { v.on = false; v.fade = 0; break; } e *= v.fade; }
        if (v.pos >= last) { if (!v.loop) { v.on = false; break; } v.pos -= last; }
        let xl = herm(sl, v.pos, last), xr = herm(sr_, v.pos, last);
        if (!open) { xl = fL.process(xl); xr = fR.process(xr); }
        L[i] += xl * e * g; R[i] += xr * e * g;
        v.pos += v.ratio;
      }
    }
  }
}

// ------------------------------------------------------------------------------- Moisture (wavetable)
const NT = 8, NM = 7, TLEN = 2048;
export const WT_FRAMES = NT;
let TABLES = null, TJOB = null, harmPh = 0;
// amplitude (return value) and phase (harmPh) of harmonic h of table t
function harm(t, h) {
  let amp = 0; harmPh = 0;
  switch (t) {
    case 0: amp = h === 1 ? 1 : 0; break;
    case 1: amp = (h & 1) ? 1 / (h * h) : 0; harmPh = (((h - 1) / 2) & 1) ? Math.PI : 0; break;
    case 2: amp = 1 / h; break;
    case 3: amp = (h & 1) ? 1 / h : 0; break;
    case 4: amp = Math.abs(Math.sin(Math.PI * h * 0.25)) / h; harmPh = -Math.PI * h * 0.5; break;
    case 5: amp = [0, 1, 0.7, 0.5, 0.4, 0, 0.25, 0, 0.2][h] || 0; break;
    case 6: amp = (1 / h) * (0.15 + Math.exp(-0.5 * (h - 3) ** 2 / 1.5) + 0.8 * Math.exp(-0.5 * (h - 6) ** 2 / 2) + 0.5 * Math.exp(-0.5 * (h - 10) ** 2 / 3)); break;
    default: amp = (h & 1) ? 1 / Math.pow(h, 0.8) : 0; harmPh = ((Math.imul(h, 2654435761) >>> 20) & 1023) * (TWO_PI / 1024);
  }
  return amp;
}
// The table set is built one harmonic per step (same maths and order as the old all-at-once build, so the result is bit-identical)
function tablesJob() {
  const d = new Float32Array(NT * NM * (TLEN + 1)), row = new Float32Array(TLEN), at = (t, m) => (t * NM + m) * (TLEN + 1);
  return {
    done: false, t: 0, h: 1,
    run(pts) {
      let used = 0;
      while (!this.done && used < pts) {
        const t = this.t, h = this.h, amp = harm(t, h), ph = harmPh; used += 3;
        if (amp) {
          for (let i = 0; i < TLEN; i++) row[i] = amp * Math.sin(TWO_PI * h * i / TLEN + ph);
          for (let m = 0; m < NM; m++) if (h <= (64 >> m)) { const o = at(t, m); for (let i = 0; i < TLEN; i++) d[o + i] += row[i]; }
        }
        if (h < 64) { this.h++; continue; }
        let pk = 1e-6; const o0 = at(t, 0);
        for (let i = 0; i < TLEN; i++) pk = Math.max(pk, Math.abs(d[o0 + i]));
        for (let m = 0; m < NM; m++) { const o = at(t, m); for (let i = 0; i < TLEN; i++) d[o + i] /= pk; d[o + TLEN] = d[o]; }
        this.t++; this.h = 1;
        if (this.t >= NT) { TABLES = { d, at }; this.done = true; TJOB = null; }
      }
      return used || 1;
    },
  };
}
// all at once (UI previews, export, tests)
export function buildTables() { if (TABLES) return TABLES; if (!TJOB) TJOB = tablesJob(); runJobNow(TJOB); return TABLES; }
// realtime: the tables or null while they are still being built in the background (the instrument stays silent until then)
export function tablesReq() { if (TABLES) return TABLES; if (JOBS.sync) return buildTables(); if (!TJOB) { TJOB = tablesJob(); JOBS.q.push(TJOB); } return null; }
const mipFor = (hz, sr) => { const maxH = (sr * 0.45) / Math.max(hz, 20); let m = 0; while (m < NM - 1 && (64 >> m) > maxH) m++; return m; };

// 0 pos A, 1 pos B, 2 B level, 3 B octave, 4 sub, 5 unison, 6 detune ct, 7 filter type, 8 cutoff, 9 reso, 10 env amount,
// 11 attack, 12 decay, 13 sustain, 14 release, 15 LFO rate, 16 LFO depth, 17 gain
export class Moisture extends Base {
  constructor(sr) {
    super(sr);
    this.T = tablesReq();   // null while the tables are built in the background (worklet); see tablesReq
    Object.assign(this, { posA: 0.25, posB: 0.6, lvB: 0.5, octB: 0, subLv: 0, uni: 1, uniDet: 12, ftype: 0, cutoff: 6000, res: 1, fAmt: 0.3, a: 0.005, d: 0.35, s: 0.7, rel: 0.3, lfoHz: 0.5, lfoDep: 0, gain: 0.4 });
    this.v = mkVoices(8, () => ({ phA: new Float64Array(5), phB: 0, phS: 0, lfo: 0, fenv: 0, f0: 0, mA: 0, mB: 0, fl: new Biquad(), fr: new Biquad() }));
    this.spread = [0, -1, 1, -0.5, 0.5]; this.dtA = new Float64Array(5); this.gl = new Float64Array(5); this.gr = new Float64Array(5);
    this.upEnv();
  }
  upEnv() { this.ap = adsrParams(this.a, this.d, this.s, this.rel, this.sr); this.fdC = Math.exp(-1 / Math.max(1, this.d * this.sr * 0.3)); }
  setParam(i, x) {
    switch (i) {
      case 0: this.posA = clamp(x, 0, 1); break; case 1: this.posB = clamp(x, 0, 1); break; case 2: this.lvB = clamp(x, 0, 1); break; case 3: this.octB = Math.round(clamp(x, -2, 2)); break;
      case 4: this.subLv = clamp(x, 0, 1); break; case 5: this.uni = Math.round(clamp(x, 1, 5)); break; case 6: this.uniDet = clamp(x, 0, 60); break; case 7: this.ftype = Math.round(clamp(x, 0, 2)); break;
      case 8: this.cutoff = x; break; case 9: this.res = clamp(x, 0.5, 12); break; case 10: this.fAmt = clamp(x, -1, 1); break;
      case 11: this.a = x; this.upEnv(); break; case 12: this.d = x; this.upEnv(); break; case 13: this.s = x; this.upEnv(); break; case 14: this.rel = x; this.upEnv(); break;
      case 15: this.lfoHz = x; break; case 16: this.lfoDep = clamp(x, 0, 1); break; case 17: this.gain = x; break;
    }
  }
  noteOn(p, vel) {
    if (!this.T && !(this.T = tablesReq())) return;   // tables not ready yet: the note is skipped instead of hanging
    const v = this.alloc(this.v);
    v.on = v.held = true; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.fenv = 1; v.lfo = 0; v.f0 = midiToHz(p); v.phS = 0;
    v.mA = mipFor(v.f0 * 1.05, this.sr); v.mB = mipFor(v.f0 * Math.pow(2, this.octB) * 1.05, this.sr);
    for (let u = 0; u < 5; u++) v.phA[u] = lcg(this.rng) / 4294967296;
    v.phB = lcg(this.rng) / 4294967296; v.fl.reset(); v.fr.reset(); v.env.start();
  }
  render(L, R, from, to) {
    if (!this.T) return;
    const T = this.T.d, at = this.T.at, sr = this.sr, ap = this.ap, lfoInc = this.lfoHz / sr, maxF = sr * 0.45, uni = this.uni;
    const spread = this.spread, dtA = this.dtA, gl = this.gl, gr = this.gr, TL = TLEN, lvB = this.lvB, subLv = this.subLv, posB = this.posB, gain = this.gain, fdC = this.fdC;
    const tposB = posB * (NT - 1), tB0 = Math.min(tposB | 0, NT - 2), tBf = tposB - tB0;
    for (let vi = 0; vi < this.v.length; vi++) {
      const v = this.v[vi];
      if (!v.on) continue;
      const dtB = v.f0 * Math.pow(2, this.octB) / sr, dtS = v.f0 * 0.5 / sr, mA = v.mA, mB = v.mB, phA = v.phA;
      for (let u = 0; u < uni; u++) { dtA[u] = v.f0 * Math.pow(2, this.uniDet * spread[u] / 1200) / sr; const pan = uni > 1 ? spread[u] * 0.7 : 0; gl[u] = Math.cos((pan + 1) * 0.7853982) * 1.4142; gr[u] = Math.sin((pan + 1) * 0.7853982) * 1.4142; }
      const norm = 1 / Math.sqrt(uni), bBase0 = at(tB0, mB), bBase1 = at(tB0 + 1, mB);
      for (let i = from; i < to; i += 32) {
        const e2 = Math.min(to, i + 32);
        const fc = clamp(this.cutoff * Math.pow(2, this.fAmt * 4 * v.fenv), 30, maxF);
        if (this.ftype === 0) v.fl.lowpass(sr, fc, this.res); else if (this.ftype === 1) v.fl.highpass(sr, fc, this.res); else v.fl.bandpass(sr, fc, this.res);
        v.fr.copy(v.fl);
        v.lfo += lfoInc * 32; if (v.lfo >= 1) v.lfo -= 1;
        const pA = clamp(this.posA + this.lfoDep * 0.5 * (1 + Math.sin(TWO_PI * v.lfo)) * (1 - this.posA), 0, 1);
        const tp = pA * (NT - 1), tA0 = Math.min(tp | 0, NT - 2), tAf = tp - tA0, aBase0 = at(tA0, mA), aBase1 = at(tA0 + 1, mA);
        for (let k = i; k < e2; k++) {
          const e = v.env.next(ap);
          if (v.env.st === 0) { v.on = false; break; }
          v.fenv *= fdC;
          let sl = 0, sr2 = 0;
          for (let u = 0; u < uni; u++) {
            let p = phA[u] + dtA[u]; if (p >= 1) p -= 1; phA[u] = p;
            const fp = p * TL, i0 = fp | 0, fr = fp - i0, a0 = aBase0 + i0, a1 = aBase1 + i0;
            const x0 = T[a0] + (T[a0 + 1] - T[a0]) * fr, x1 = T[a1] + (T[a1 + 1] - T[a1]) * fr, x = x0 + (x1 - x0) * tAf;
            sl += x * gl[u]; sr2 += x * gr[u];
          }
          sl *= norm; sr2 *= norm;
          if (lvB > 0.001) {
            v.phB += dtB; if (v.phB >= 1) v.phB -= 1;
            const fp = v.phB * TL, i0 = fp | 0, fr = fp - i0, a0 = bBase0 + i0, a1 = bBase1 + i0;
            const x0 = T[a0] + (T[a0 + 1] - T[a0]) * fr, x1 = T[a1] + (T[a1 + 1] - T[a1]) * fr, x = (x0 + (x1 - x0) * tBf) * lvB;
            sl += x; sr2 += x;
          }
          if (subLv > 0.001) { v.phS += dtS; if (v.phS >= 1) v.phS -= 1; const x = Math.sin(TWO_PI * v.phS) * subLv; sl += x; sr2 += x; }
          const g = e * v.vel * gain;
          L[k] += v.fl.process(sl) * g; R[k] += v.fr.process(sr2) * g;
        }
        if (!v.on) break;
      }
    }
  }
}

// ------------------------------------------------------------------------------- Osphere (layered pad)
// 0 L1 wave, 1 L1 level, 2 L1 oct, 3 L1 detune, 4 L2 wave, 5 L2 level, 6 L2 oct, 7 L2 detune, 8 air, 9 cutoff, 10 reso,
// 11 attack, 12 release, 13 chorus depth, 14 chorus mix, 15 motion, 16 motion rate, 17 gain
export class Osphere extends Base {
  constructor(sr) {
    super(sr);
    Object.assign(this, { w1: 0, w2: 1, oct1: 0, oct2: 1, lv1: 0.6, lv2: 0.4, det1: 8, det2: 10, air: 0, cutoff: 4500, res: 0.8, a: 0.6, rel: 1.2, chDepth: 0.5, chMix: 0.4, motion: 0.3, motionHz: 0.15, gain: 0.35 });
    this.v = mkVoices(8, () => ({ ph: new Float64Array(4), lfo: 0, f0: 0, fl: new Biquad(), fr: new Biquad() }));
    this.DL = 4096; this.dl = [new Float32Array(4096), new Float32Array(4096)]; this.wp = 0; this.chPh = 0;
    this.tl = new Float32Array(1024); this.tr = new Float32Array(1024); this.dts = new Float64Array(4); this.dPrevL = 0.018 * sr; this.dPrevR = 0.018 * sr; this.upEnv();
  }
  upEnv() { this.ap = adsrParams(this.a, 0.4, 0.85, this.rel, this.sr); }
  setParam(i, x) {
    switch (i) {
      case 0: this.w1 = Math.round(clamp(x, 0, 3)); break; case 1: this.lv1 = clamp(x, 0, 1); break; case 2: this.oct1 = Math.round(clamp(x, -2, 2)); break; case 3: this.det1 = clamp(x, 0, 40); break;
      case 4: this.w2 = Math.round(clamp(x, 0, 3)); break; case 5: this.lv2 = clamp(x, 0, 1); break; case 6: this.oct2 = Math.round(clamp(x, -2, 2)); break; case 7: this.det2 = clamp(x, 0, 40); break;
      case 8: this.air = clamp(x, 0, 1); break; case 9: this.cutoff = x; break; case 10: this.res = clamp(x, 0.5, 8); break;
      case 11: this.a = x; this.upEnv(); break; case 12: this.rel = x; this.upEnv(); break;
      case 13: this.chDepth = clamp(x, 0, 1); break; case 14: this.chMix = clamp(x, 0, 1); break; case 15: this.motion = clamp(x, 0, 1); break; case 16: this.motionHz = x; break; case 17: this.gain = x; break;
    }
  }
  noteOn(p, vel) { const v = this.alloc(this.v); v.on = v.held = true; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.f0 = midiToHz(p); v.lfo = 0; for (let k = 0; k < 4; k++) v.ph[k] = lcg(this.rng) / 4294967296; v.fl.reset(); v.fr.reset(); v.env.start(); }
  render(L, R, from, to) {
    const n = to - from; if (n <= 0) return;
    const tl = this.tl, tr = this.tr, sr = this.sr, ap = this.ap, maxF = sr * 0.45, dts = this.dts;
    tl.fill(0, 0, n); tr.fill(0, 0, n);
    const w1 = this.w1, w2 = this.w2, lv1 = this.lv1, lv2 = this.lv2, air = this.air, gain = this.gain;
    for (let vi = 0; vi < this.v.length; vi++) {
      const v = this.v[vi];
      if (!v.on) continue;
      const f1 = v.f0 * Math.pow(2, this.oct1), f2 = v.f0 * Math.pow(2, this.oct2), ph = v.ph;
      dts[0] = f1 * Math.pow(2, this.det1 / 1200) / sr; dts[1] = f1 * Math.pow(2, -this.det1 / 1200) / sr; dts[2] = f2 * Math.pow(2, this.det2 / 1200) / sr; dts[3] = f2 * Math.pow(2, -this.det2 / 1200) / sr;
      const d0 = dts[0], d1 = dts[1], d2 = dts[2], d3 = dts[3];
      for (let i = 0; i < n; i += 32) {
        const e2 = Math.min(n, i + 32);
        v.lfo += this.motionHz * 32 / sr; if (v.lfo >= 1) v.lfo -= 1;
        v.fl.lowpass(sr, clamp(this.cutoff * Math.pow(2, this.motion * 2 * Math.sin(TWO_PI * v.lfo)), 40, maxF), this.res); v.fr.copy(v.fl);
        for (let k = i; k < e2; k++) {
          const e = v.env.next(ap);
          if (v.env.st === 0) { v.on = false; break; }
          let p0 = ph[0] + d0, p1 = ph[1] + d1, p2 = ph[2] + d2, p3 = ph[3] + d3;
          if (p0 >= 1) p0 -= 1; if (p1 >= 1) p1 -= 1; if (p2 >= 1) p2 -= 1; if (p3 >= 1) p3 -= 1;
          ph[0] = p0; ph[1] = p1; ph[2] = p2; ph[3] = p3;
          let xl = wave4(w1, p0, d0) * lv1 + wave4(w2, p2, d2) * lv2, xr = wave4(w1, p1, d1) * lv1 + wave4(w2, p3, d3) * lv2;
          if (air > 0.001) { const nz = ((lcg(this.rng) | 0) / 2147483648) * air * 0.5; xl += nz; xr -= nz; }
          const g = e * v.vel * gain;
          tl[k] += v.fl.process(xl) * g; tr[k] += v.fr.process(xr) * g;
        }
        if (!v.on) break;
      }
    }
    // stereo chorus on this instrument's own signal: the delay time is ramped linearly across the block
    const DL = this.DL, dl0 = this.dl[0], dl1 = this.dl[1], base = 0.018 * sr, dep = (0.0005 + 0.004 * this.chDepth) * sr, cm = this.chMix;
    const tgtL = base + dep * Math.sin(TWO_PI * this.chPh), tgtR = base + dep * Math.sin(TWO_PI * (this.chPh + 0.33));
    this.chPh += 0.35 * n / sr; if (this.chPh >= 1) this.chPh -= 1;
    let dL = this.dPrevL, dR = this.dPrevR; const sL = (tgtL - dL) / n, sR = (tgtR - dR) / n;
    let wp = this.wp;
    for (let i = 0; i < n; i++) {
      dl0[wp] = tl[i]; dl1[wp] = tr[i];
      dL += sL; dR += sR;
      let rp = wp - dL; if (rp < 0) rp += DL; let a = rp | 0, f = rp - a; const oL = dl0[a] * (1 - f) + dl0[a + 1 >= DL ? 0 : a + 1] * f;
      rp = wp - dR; if (rp < 0) rp += DL; a = rp | 0; f = rp - a; const oR = dl1[a] * (1 - f) + dl1[a + 1 >= DL ? 0 : a + 1] * f;
      L[from + i] += tl[i] * (1 - cm * 0.5) + oL * cm; R[from + i] += tr[i] * (1 - cm * 0.5) + oR * cm;
      if (++wp >= DL) wp = 0;
    }
    this.wp = wp; this.dPrevL = dL; this.dPrevR = dR;
  }
}

// ------------------------------------------------------------------------------- GMS (groove synth)
// 0 mode, 1 glide ms, 2 cutoff, 3 reso, 4 env amt, 5 A, 6 D, 7 S, 8 R, 9 gain, 10-13 osc1 (wave, oct, fine, level), 14-17 osc2, 18-21 osc3,
// 22 arp on, 23 pattern, 24 rate, 25 octaves, 26 gate
export class Gms extends Base {
  constructor(sr) {
    super(sr);
    Object.assign(this, { mode: 0, glide: 60, cutoff: 2500, res: 1.2, fAmt: 0.4, a: 0.003, d: 0.25, s: 0.6, rel: 0.2, gain: 0.4, bpm: 120, arpOn: false, pattern: 0, rate: 2, octs: 1, gate: 0.7, triggers: 0 });
    this.o3 = [{ wave: 0, oct: 0, fine: 0, lv: 0.7 }, { wave: 0, oct: 0, fine: 8, lv: 0.5 }, { wave: 0, oct: -1, fine: 0, lv: 0 }];
    this.v = mkVoices(8, () => ({ f: 0, ft: 0, ph: new Float64Array(3), fenv: 0, f1: new Biquad(), f2: new Biquad() }));
    this.held = []; this.stack = []; this.arpPos = 0; this.arpStep = 0; this.arpNote = -1; this.arpOffAt = -1;
    this.upEnv();
  }
  upEnv() { this.ap = adsrParams(this.a, this.d, this.s, this.rel, this.sr); this.fdC = Math.exp(-1 / Math.max(1, this.d * this.sr * 0.3)); }
  setTempo(b) { this.bpm = clamp(b, 20, 300); }
  setParam(i, x) {
    if (i >= 10 && i <= 21) { const q = this.o3[Math.floor((i - 10) / 4)]; switch ((i - 10) % 4) { case 0: q.wave = Math.round(clamp(x, 0, 3)); break; case 1: q.oct = Math.round(clamp(x, -2, 2)); break; case 2: q.fine = clamp(x, -50, 50); break; default: q.lv = clamp(x, 0, 1); } return; }
    switch (i) {
      case 0: this.mode = x > 0.5 ? 1 : 0; this.allOff(); break; case 1: this.glide = x; break; case 2: this.cutoff = x; break; case 3: this.res = clamp(x, 0.5, 10); break; case 4: this.fAmt = clamp(x, -1, 1); break;
      case 5: this.a = x; this.upEnv(); break; case 6: this.d = x; this.upEnv(); break; case 7: this.s = x; this.upEnv(); break; case 8: this.rel = x; this.upEnv(); break; case 9: this.gain = x; break;
      case 22: { const on = x > 0.5; if (on !== this.arpOn) { this.arpOn = on; this.allOff(); this.held = []; this.arpNote = -1; this.arpPos = 0; this.arpStep = 0; } break; }
      case 23: this.pattern = Math.round(clamp(x, 0, 4)); break; case 24: this.rate = Math.round(clamp(x, 0, 3)); break; case 25: this.octs = Math.round(clamp(x, 1, 3)); break; case 26: this.gate = clamp(x, 0.1, 1); break;
    }
  }
  trigger(p, vel) {
    this.triggers++;
    if (this.mode === 1) { const m = this.v.find((o) => o.on && o.held); if (m) { m.pitch = p; m.ft = midiToHz(p); m.vel = vel; return; } for (const o of this.v) if (o.on) { o.held = false; o.env.release(); } }
    const v = this.alloc(this.v);
    v.on = v.held = true; v.pitch = p; v.vel = vel; v.f = v.ft = midiToHz(p); v.age = ++this.counter; v.fenv = 1; for (let k = 0; k < 3; k++) v.ph[k] = lcg(this.rng) / 4294967296; v.f1.reset(); v.f2.reset(); v.env.start();
  }
  release(p) { if (this.mode === 1) { for (const o of this.v) if (o.on && o.held) { o.held = false; o.env.release(); } return; } for (const o of this.v) if (o.on && o.held && o.pitch === p) { o.held = false; o.env.release(); } }
  noteOn(p, vel) { if (this.arpOn) { if (!this.held.some((h) => h.p === p) && this.held.length < 16) this.held.push({ p, vel }); return; } if (this.mode === 1) { this.stack = this.stack.filter((h) => h.p !== p); this.stack.push({ p, vel }); } this.trigger(p, vel); }
  noteOff(p) {
    if (this.arpOn) { this.held = this.held.filter((h) => h.p !== p); if (!this.held.length && this.arpNote >= 0) { this.release(this.arpNote); this.arpNote = -1; } return; }
    if (this.mode === 1) { this.stack = this.stack.filter((h) => h.p !== p); if (this.stack.length) { const t = this.stack[this.stack.length - 1]; this.trigger(t.p, t.vel); return; } }
    this.release(p);
  }
  allOff() { for (const o of this.v) if (o.on) { o.held = false; o.env.release(); } this.stack = []; this.arpNote = -1; }
  active() { return (this.arpOn && this.held.length > 0) || this.v.some((o) => o.on); }
  stepSamples() { return this.sr * 60 / (this.bpm * [1, 2, 4, 8][this.rate]); }
  arpNext() {
    let seq = this.held.map((h) => ({ ...h }));
    if (this.pattern !== 4) seq.sort((a, b) => a.p - b.p);
    const n = seq.length, total = n * this.octs;
    if (!total) return;
    let idx;
    switch (this.pattern) {
      case 1: idx = total - 1 - (this.arpStep % total); break;
      case 2: { const cyc = Math.max(1, total * 2 - 2), q = this.arpStep % cyc; idx = q < total ? q : cyc - q; break; }
      case 3: idx = (lcg(this.rng) >>> 8) % total; break;
      default: idx = this.arpStep % total;
    }
    this.arpStep++;
    const p = Math.min(127, seq[idx % n].p + 12 * Math.floor(idx / n));
    if (this.arpNote >= 0) this.release(this.arpNote);
    this.arpNote = p; this.trigger(p, seq[idx % n].vel);
  }
  renderVoices(L, R, from, to) {
    const sr = this.sr, maxF = sr * 0.45, gl = 1 - Math.exp(-1 / Math.max(1, this.glide * 0.001 * sr)), ap = this.ap, o3 = this.o3, mono = this.mode === 1, gain = this.gain, fdC = this.fdC;
    const mul0 = Math.pow(2, o3[0].oct + o3[0].fine / 1200) / sr, mul1 = Math.pow(2, o3[1].oct + o3[1].fine / 1200) / sr, mul2 = Math.pow(2, o3[2].oct + o3[2].fine / 1200) / sr;
    const w0 = o3[0].wave, w1 = o3[1].wave, w2 = o3[2].wave, l0 = o3[0].lv, l1 = o3[1].lv, l2 = o3[2].lv;
    for (let vi = 0; vi < this.v.length; vi++) {
      const v = this.v[vi];
      if (!v.on) continue;
      const ph = v.ph;
      for (let i = from; i < to; i += 32) {
        const e2 = Math.min(to, i + 32);
        v.f1.lowpass(sr, clamp(this.cutoff * Math.pow(2, this.fAmt * 4 * v.fenv), 30, maxF), this.res); v.f2.copy(v.f1);
        const dt0 = v.f * mul0, dt1 = v.f * mul1, dt2 = v.f * mul2;
        for (let k = i; k < e2; k++) {
          const e = v.env.next(ap);
          if (v.env.st === 0) { v.on = false; break; }
          v.fenv *= fdC;
          if (mono) v.f += (v.ft - v.f) * gl;
          let x = 0;
          if (l0 > 0) { let p = ph[0] + dt0; if (p >= 1) p -= 1; ph[0] = p; x += wave4(w0, p, dt0) * l0; }
          if (l1 > 0) { let p = ph[1] + dt1; if (p >= 1) p -= 1; ph[1] = p; x += wave4(w1, p, dt1) * l1; }
          if (l2 > 0) { let p = ph[2] + dt2; if (p >= 1) p -= 1; ph[2] = p; x += wave4(w2, p, dt2) * l2; }
          const y = v.f2.process(v.f1.process(x)) * e * v.vel * gain;
          L[k] += y; R[k] += y;
        }
        if (!v.on) break;
      }
    }
  }
  render(L, R, from, to) {
    if (!this.arpOn) { this.renderVoices(L, R, from, to); return; }
    const step = this.stepSamples();
    let cur = from, guard = 0;
    while (cur < to && guard++ < 64) {
      let seg = to - cur;
      if (this.held.length > 0) seg = Math.min(seg, Math.max(0, Math.ceil(this.arpPos <= 0 ? 0 : step - this.arpPos)));
      if (this.arpNote >= 0 && this.arpOffAt >= 0) seg = Math.min(seg, Math.max(0, Math.ceil(this.arpOffAt - this.arpPos)));
      if (seg > 0) { this.renderVoices(L, R, cur, cur + seg); cur += seg; if (this.held.length > 0) this.arpPos += seg; }
      if (this.held.length > 0 && (this.arpPos >= step || this.arpPos <= 0)) { this.arpPos = this.arpPos <= 0 ? 0 : this.arpPos - step; this.arpNext(); this.arpOffAt = step * this.gate; if (this.arpPos <= 0) this.arpPos = 1e-9; }
      else if (this.arpNote >= 0 && this.arpOffAt >= 0 && this.arpPos >= this.arpOffAt) { this.release(this.arpNote); this.arpNote = -1; this.arpOffAt = -1; }
      else if (seg <= 0 && this.held.length === 0) { this.renderVoices(L, R, cur, to); cur = to; }
    }
  }
}

// ------------------------------------------------------------------------------- SoundFont player
// sf = { data: Int16Array, shdr: [{start,end,loopStart,loopEnd,rate}], presets: [{name, zones:[...]}] }  (see sf2.js)
// params: 0 gain, 1 preset index, 100 soundfont id
export class SfPlayer extends Base {
  constructor(sr, sfs) {
    super(sr);
    this.sfs = sfs; this.sfId = -1; this.gain = 0.8; this.preset = 0;
    this.v = mkVoices(40, () => ({ pos: 0, ratio: 1, z: null, sf: null, g: 0, pl: 1, pr: 1, ap: adsrParams(0, 0, 1, 0, 48000) }));
  }
  setParam(i, x) {
    if (i === 100) { this.sfId = x | 0; this.allOff(); } else if (i === 0) this.gain = x; else if (i === 1) { this.preset = Math.max(0, x | 0); this.allOff(); }
  }
  noteOn(p, vel) {
    const sf = this.sfs[this.sfId]; if (!sf) return;
    const pr = sf.presets[this.preset] || sf.presets[0]; if (!pr) return;
    const vi = Math.round(vel * 127);
    for (const z of pr.zones) {
      if (p < z.lo || p > z.hi || vi < z.vlo || vi > z.vhi) continue;
      const sh = sf.shdr[z.sample]; if (!sh) continue;
      const v = this.alloc(this.v);
      v.on = v.held = true; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.z = z; v.sf = sf;
      v.pos = z.start; v.ratio = (sh.rate / this.sr) * Math.pow(2, (p - z.root + z.tune / 100) / 12);
      v.g = Math.pow(10, -z.atten / 20); const pan = clamp(z.pan, -1, 1); v.pl = Math.cos((pan + 1) * 0.7853982) * 1.4142; v.pr = Math.sin((pan + 1) * 0.7853982) * 1.4142;
      adsrInto(v.ap, z.a, z.d, z.s, z.r, this.sr); v.env.start();
    }
  }
  render(L, R, from, to) {
    for (const v of this.v) {
      if (!v.on) continue;
      const z = v.z, d = v.sf.data, loop = z.loop !== 0 && z.le - z.ls > 8, end = z.end - 1;
      const g = this.gain * v.vel * v.g * 1 / 32768;
      for (let i = from; i < to; i++) {
        const e = v.env.next(v.ap);
        if (v.env.st === 0) { v.on = false; break; }
        if (loop && v.pos >= z.le) v.pos -= z.le - z.ls;
        if (v.pos >= end) { v.on = false; break; }
        const ip = v.pos | 0, fr = v.pos - ip, x = (d[ip] + (d[ip + 1] - d[ip]) * fr) * e * g;
        L[i] += x * v.pl; R[i] += x * v.pr;
        v.pos += v.ratio;
      }
    }
  }
}

export function makeInstrument(type, sr, bank, sfs) {
  switch (type) {
    case 1: return new MiniSynth(sr);
    case 2: return new SuperSaw(sr);
    case 3: return new DrumSynth(sr, bank, (k) => (k === 3 ? null : makeInstrument(k, sr, bank, sfs)));
    case 4: case 9: return new Sampler(sr, bank);
    case 5: return new Gms(sr);
    case 6: return new SfPlayer(sr, sfs);
    case 7: return new Moisture(sr);
    case 8: return new Osphere(sr);
    case 10: return new LiveSampler(sr, bank);
    case 11: return new LiveWavetable(sr);
    case 13: return new Drift(sr);
    case 14: return new Operator(sr);
    case 15: return new Analog(sr);
    case 16: return new Poli(sr);
    case 17: return new Meld(sr);
    case 18: return new Simpler(sr, bank);
    case 19: return new DsKick(sr); case 20: return new DsSnare(sr); case 21: return new DsTom(sr);
    case 28: return new Impulse(sr, bank); case 29: return new Granulator(sr, bank);
    case 25: return new Electric(sr); case 26: return new Tension(sr); case 27: return new Collision(sr);
    case 22: return new DsHH(sr); case 23: return new DsClap(sr); case 24: return new DsFm(sr);
    default: return null;
  }
}

// Pitch bend hooks (core.js Engine.bend): multiply the voice's base frequency by ratio r. Sample based instruments (drums, samplers, SoundFont) have none.
MiniSynth.prototype.bendVoice = function (v, r) { v.dt *= r; };
SuperSaw.prototype.bendVoice = function (v, r) { v.f0 *= r; };
Moisture.prototype.bendVoice = function (v, r) { v.f0 *= r; };
Osphere.prototype.bendVoice = function (v, r) { v.f0 *= r; };
Gms.prototype.bendVoice = function (v, r) { v.f *= r; v.ft *= r; };
