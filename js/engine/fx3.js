// Effects of the web engine, Live 12 set (part 1): Delay, Filter Delay, Beat Repeat, Chorus-Ensemble, Phaser-Flanger, Auto Pan, Gate,
// Glue Compressor, Channel EQ, Erosion, Redux, Vinyl Distortion, Drum Buss, Tuner.
// Interface as in fx.js: setParam(i, v), process(L, R, n) in place, readOut(out) -> count, bypass flag; optional setTempo(bpm) and
// tr(playing, beat) (transport, called once per block by the engine before process).
import { TWO_PI, clamp, dbToLin, linToDb, Biquad, fastTanh, lcg, fft } from './dsp.js';

class Fx { constructor(sr) { this.sr = sr; this.bypass = false; this.bpm = 120; } readOut() { return 0; } setTempo(b) { this.bpm = b; } }
const tanh = fastTanh;
const SIXTEENTHS = [1, 2, 3, 4, 5, 6, 8, 16];                                   // Live Delay sync steps
const bwQ = (oct) => 1 / (2 * Math.sinh(Math.LN2 / 2 * Math.max(0.1, oct)));    // bandwidth in octaves -> Q
const coef = (ms, sr) => Math.exp(-1 / Math.max(1, ms * 0.001 * sr));          // one-pole smoothing coefficient

// fractional read from a ring buffer (linear)
function rd(buf, mask, w, d) { const p = w - d, i = Math.floor(p), f = p - i; const a = buf[i & mask], b = buf[(i + 1) & mask]; return a + (b - a) * f; }

// band filter used by the delays: high-pass + low-pass around a centre (Live: Filter freq + width)
class Band {
  constructor(sr) { this.sr = sr; this.h = new Biquad(); this.l = new Biquad(); this.f = 1000; this.w = 6; this.set(1000, 6); }
  set(f, w) { this.f = f; this.w = w; const k = Math.pow(2, w / 2); this.h.highpass(this.sr, clamp(f / k, 20, 20000), 0.707); this.l.lowpass(this.sr, clamp(f * k, 30, 20000), 0.707); }
  process(x) { return this.l.process(this.h.process(x)); }
}

// ================================================================================================ Delay
// 0 L sync 1 L div 2 L time 3 L offset 4 R sync 5 R div 6 R time 7 R offset 8 link 9 feedback 10 freeze 11 filter on 12 filter freq
// 13 filter width 14 mod rate 15 mod filter 16 mod time 17 mode (repitch / fade / jump) 18 ping pong 19 dry/wet
export class Delay extends Fx {
  constructor(sr) {
    super(sr); const N = 1 << Math.ceil(Math.log2(sr * 6)); this.bl = new Float32Array(N); this.br = new Float32Array(N); this.m = N - 1; this.w = 0;
    this.p = [1, 2, 250, 0, 1, 3, 300, 0, 1, 0.5, 0, 1, 1000, 6.5, 0.5, 0, 0, 1, 0, 0.5];
    this.fl = new Band(sr); this.fr = new Band(sr); this.cur = [sr * 0.25, sr * 0.3]; this.old = [0, 0]; this.xf = [0, 0]; this.ph = 0; this.fq = -1; this.upd();
  }
  setParam(i, v) { this.p[i] = v; if (i === 8 && v > 0.5) { this.p[4] = this.p[0]; this.p[5] = this.p[1]; this.p[6] = this.p[2]; this.p[7] = this.p[3]; } this.upd(); }
  setTempo(b) { this.bpm = b; this.upd(); }
  tgt(c) { const p = this.p, o = c ? 4 : 0, src = c && p[8] > 0.5 ? 0 : o; const s16 = 60 / this.bpm / 4;
    const sec = p[src] > 0.5 ? SIXTEENTHS[clamp(Math.round(p[src + 1]), 0, 7)] * s16 * (1 + clamp(p[src + 3], -0.333, 0.333)) : p[src + 2] / 1000;
    return clamp(sec * this.sr, 2, this.m - 4); }
  upd() { this.t = [this.tgt(0), this.tgt(1)]; }
  process(L, R, n) {
    const p = this.p, fb = p[10] > 0.5 ? 1 : clamp(p[9], 0, 0.95), mix = p[19], mode = Math.round(p[17]), pp = p[18] > 0.5, frz = p[10] > 0.5, fon = p[11] > 0.5;
    const rate = TWO_PI * p[14] / this.sr, mf = p[15], mt = p[16], xs = 1 / (0.05 * this.sr), sm = 1 - coef(60, this.sr);
    for (let i = 0; i < n; i++) {
      this.ph += rate; if (this.ph > TWO_PI) this.ph -= TWO_PI; const lfo = Math.sin(this.ph);
      if ((i & 31) === 0 && fon) { const f = clamp(p[12] * Math.pow(2, lfo * mf * 2), 30, 18000); if (Math.abs(f - this.fq) > this.fq * 0.002) { this.fl.set(f, p[13]); this.fr.set(f, p[13]); this.fq = f; } }
      const out = [0, 0];
      for (let c = 0; c < 2; c++) {
        const tg = this.t[c] * (1 + lfo * mt * 0.02), buf = c ? this.br : this.bl;
        if (mode === 0) this.cur[c] += (tg - this.cur[c]) * sm;                                   // repitch: the read head glides (pitch bends)
        else if (Math.abs(tg - this.cur[c]) > 1 && this.xf[c] <= 0) { if (mode === 1) { this.old[c] = this.cur[c]; this.xf[c] = 1; } this.cur[c] = tg; }   // fade / jump
        let y = rd(buf, this.m, this.w, this.cur[c]);
        if (this.xf[c] > 0) { const o = rd(buf, this.m, this.w, this.old[c]); y = y * (1 - this.xf[c]) + o * this.xf[c]; this.xf[c] -= xs; }
        out[c] = fon ? (c ? this.fr : this.fl).process(y) : y;
      }
      const inL = frz ? 0 : L[i], inR = frz ? 0 : R[i];
      if (pp) { this.bl[this.w & this.m] = (inL + inR) * 0.5 + out[1] * fb; this.br[this.w & this.m] = out[0] * fb; }
      else { this.bl[this.w & this.m] = inL + out[0] * fb; this.br[this.w & this.m] = inR + out[1] * fb; }
      this.w++;
      L[i] = L[i] * (1 - mix) + out[0] * mix; R[i] = R[i] * (1 - mix) + out[1] * mix;
    }
  }
}

// ================================================================================================ Filter Delay
// three lines (L, L+R, R), 10 params each: on, filter on, freq, width, sync, div, time ms, feedback, pan, volume dB; 30 dry dB
export class FilterDelay extends Fx {
  constructor(sr) {
    super(sr); const N = 1 << Math.ceil(Math.log2(sr * 4)); this.m = N - 1; this.w = 0;
    this.b = [0, 1, 2].map(() => new Float32Array(N)); this.f = [0, 1, 2].map(() => new Band(sr)); this.d = [0, 0, 0];
    this.p = []; for (let k = 0; k < 3; k++) this.p.push(1, 1, [1010, 156, 1730][k], [2.09, 3.42, 2.36][k], 0, 3, 250, 0.2, [-0.5, 0, 0.5][k], 0); this.p.push(0);
    for (let k = 0; k < 3; k++) this.upd(k);
  }
  setParam(i, v) { this.p[i] = v; if (i < 30) this.upd(Math.floor(i / 10)); }
  setTempo(b) { this.bpm = b; for (let k = 0; k < 3; k++) this.upd(k); }
  upd(k) { const o = k * 10, p = this.p; this.f[k].set(p[o + 2], p[o + 3]); const s16 = 60 / this.bpm / 4; this.d[k] = clamp((p[o + 4] > 0.5 ? SIXTEENTHS[clamp(Math.round(p[o + 5]), 0, 7)] * s16 : p[o + 6] / 1000) * this.sr, 2, this.m - 2); }
  process(L, R, n) {
    const p = this.p, dry = p[30] <= -60 ? 0 : dbToLin(p[30]), g = [], pl = [], pr = [];
    for (let k = 0; k < 3; k++) { const o = k * 10, v = p[o + 9] <= -60 ? 0 : dbToLin(p[o + 9]), pan = clamp(p[o + 8], -1, 1); g[k] = p[o] > 0.5 ? v : 0; pl[k] = Math.cos((pan + 1) * Math.PI / 4); pr[k] = Math.sin((pan + 1) * Math.PI / 4); }
    for (let i = 0; i < n; i++) {
      const x = [L[i], (L[i] + R[i]) * 0.5, R[i]]; let oL = L[i] * dry, oR = R[i] * dry;
      for (let k = 0; k < 3; k++) {
        const o = k * 10, buf = this.b[k], y0 = buf[(this.w - this.d[k]) & this.m], y = p[o + 1] > 0.5 ? this.f[k].process(y0) : y0;
        buf[this.w & this.m] = (p[o] > 0.5 ? x[k] : 0) + y * clamp(p[o + 7], 0, 0.95);
        oL += y * g[k] * pl[k]; oR += y * g[k] * pr[k];
      }
      this.w++; L[i] = oL; R[i] = oR;
    }
  }
}

// ================================================================================================ Beat Repeat
// 0 interval 1 offset (16ths) 2 grid 3 variation 4 chance 5 gate (16ths) 6 pitch 7 pitch decay 8 filter on 9 filter freq 10 filter width
// 11 mix mode (mix / insert / gate) 12 volume dB 13 decay 14 no triplets 15 repeat (held = repeat now)
export const BR_INTERVAL = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16], BR_GRID = [1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 1 / 12, 0.0625];   // beats
export class BeatRepeat extends Fx {
  constructor(sr) {
    super(sr); const N = 1 << Math.ceil(Math.log2(sr * 10)); this.bl = new Float32Array(N); this.br = new Float32Array(N); this.m = N - 1; this.w = 0;
    this.p = [5, 0, 4, 0, 1, 8, 0, 0, 1, 1000, 6, 0, 0, 0, 0, 0]; this.fl = new Band(sr); this.fr = new Band(sr); this.fl.set(1000, 6); this.fr.set(1000, 6);
    this.on = false; this.start = 0; this.len = 1; this.pos = 0; this.rate = 1; this.amp = 1; this.left = 0; this.rnd = { seed: 12345 }; this.lastSlot = -1; this.play = false; this.beat = 0; this.gridNow = 4;
  }
  setParam(i, v) { this.p[i] = v; if (i === 9 || i === 10) { this.fl.set(this.p[9], this.p[10]); this.fr.set(this.p[9], this.p[10]); } if (i === 15 && v > 0.5) this.trigger(); }
  tr(playing, beat) { this.play = playing; this.beat = beat; }
  grid() {
    const p = this.p; let gi = clamp(Math.round(p[2]), 0, 8); const vr = Math.round(p[3]);
    if (vr > 0) gi = clamp(gi + Math.round(((lcg(this.rnd) / 4294967296) * 2 - 1) * vr), 0, 8);
    if (p[14] > 0.5 && gi % 2 === 1 && gi > 0) gi -= 1;            // no triplets
    this.gridNow = gi; return BR_GRID[gi];
  }
  trigger() {
    const spb = 60 / this.bpm * this.sr; this.len = Math.max(64, Math.round(this.grid() * spb)); this.start = this.w; this.pos = 0;
    this.left = Math.round(clamp(this.p[5], 1, 64) * spb / 4); this.rate = Math.pow(2, clamp(this.p[6], -48, 0) / 12); this.amp = 1; this.on = true; this.cap = this.len;
  }
  process(L, R, n) {
    const p = this.p, spb = 60 / this.bpm * this.sr, iv = BR_INTERVAL[clamp(Math.round(p[0]), 0, 7)], off = clamp(p[1], 0, 15) / 4;
    if (this.play) { const slot = Math.floor((this.beat - off) / iv); if (slot !== this.lastSlot && this.beat - off >= 0) { this.lastSlot = slot; if ((lcg(this.rnd) / 4294967296) < p[4]) this.trigger(); } }
    else this.lastSlot = -1;
    const vol = p[12] <= -60 ? 0 : dbToLin(p[12]), mode = Math.round(p[11]), fon = p[8] > 0.5, pd = p[7], dk = p[13];
    for (let i = 0; i < n; i++) {
      this.bl[this.w & this.m] = L[i]; this.br[this.w & this.m] = R[i];
      let rl = 0, rr = 0;
      if (this.on) {
        if (this.cap > 0) { this.cap--; rl = L[i]; rr = R[i]; }                   // the first pass is the live signal being captured
        else {
          const q = this.start + this.pos; rl = rd(this.bl, this.m, q, 0); rr = rd(this.br, this.m, q, 0);
          const env = Math.min(1, this.pos / 32, (this.len - this.pos) / 32);  // tiny fades: no clicks at the slice edges
          rl *= env * this.amp; rr *= env * this.amp;
          this.pos += this.rate; if (this.pos >= this.len) { this.pos = 0; this.rate = Math.max(0.0625, this.rate * (1 - pd * 0.15)); this.amp *= 1 - dk * 0.6; }   // every repeat a little lower (Pitch Decay) and quieter (Decay)
        }
        if (fon) { rl = this.fl.process(rl); rr = this.fr.process(rr); }
        if (--this.left <= 0) this.on = false;
      }
      this.w++;
      const dryOn = mode === 0 || (mode === 1 && !this.on) ? 1 : 0;
      L[i] = L[i] * dryOn + rl * vol; R[i] = R[i] * dryOn + rr * vol;
    }
  }
  readOut(o) { o[0] = this.on ? 1 : 0; o[1] = this.gridNow; return 2; }
}

// ================================================================================================ Chorus-Ensemble
// 0 mode (chorus / ensemble / vibrato) 1 rate 2 amount 3 feedback 4 invert 5 hp on 6 hp freq 7 width 8 time ms 9 two taps 10 warmth 11 output dB 12 dry/wet
export class ChorusEnsemble extends Fx {
  constructor(sr) {
    super(sr); const N = 1 << Math.ceil(Math.log2(sr * 0.1)); this.bl = new Float32Array(N); this.br = new Float32Array(N); this.m = N - 1; this.w = 0; this.ph = 0;
    this.p = [0, 0.62, 0.59, 0.3, 0, 0, 50, 1, 20, 1, 0, 0, 0.5]; this.hl = new Biquad(); this.hr = new Biquad(); this.wl = new Biquad(); this.wr = new Biquad(); this.upd();
  }
  setParam(i, v) { this.p[i] = v; this.upd(); }
  upd() { this.hl.highpass(this.sr, this.p[6], 0.707); this.hr.copy(this.hl); this.wl.lowpass(this.sr, 20000 - this.p[10] * 14000, 0.6); this.wr.copy(this.wl); }
  process(L, R, n) {
    const p = this.p, mode = Math.round(p[0]), rate = TWO_PI * p[1] / this.sr, amt = p[2], fb = clamp(p[3], 0, 0.95) * (p[4] > 0.5 ? -1 : 1), hp = p[5] > 0.5;
    const base = clamp(p[8], 1, 40) * 0.001 * this.sr, depth = amt * (mode === 2 ? 0.004 : 0.003) * this.sr, taps = mode === 1 ? 3 : mode === 0 && p[9] > 0.5 ? 2 : 1;
    const wet = mode === 2 ? 1 : p[12], out = dbToLin(p[11]), width = clamp(p[7], 0, 2), warm = p[10];
    for (let i = 0; i < n; i++) {
      this.ph += rate; if (this.ph > TWO_PI) this.ph -= TWO_PI;
      let yl = 0, yr = 0;
      for (let t = 0; t < taps; t++) {
        const a = this.ph + t * TWO_PI / taps;
        yl += rd(this.bl, this.m, this.w, base * (1 + t * 0.35) + depth * (1 + Math.sin(a)));
        yr += rd(this.br, this.m, this.w, base * (1 + t * 0.35) + depth * (1 + Math.sin(a + Math.PI / 2 * width)));
      }
      yl /= taps; yr /= taps;
      const xl = hp ? this.hl.process(L[i]) : L[i], xr = hp ? this.hr.process(R[i]) : R[i];
      this.bl[this.w & this.m] = xl + yl * fb; this.br[this.w & this.m] = xr + yr * fb; this.w++;
      if (warm > 0) { yl = this.wl.process(tanh(yl * (1 + warm * 3)) / (1 + warm)); yr = this.wr.process(tanh(yr * (1 + warm * 3)) / (1 + warm)); }
      const m = (yl + yr) * 0.5, s = (yl - yr) * 0.5 * width; yl = m + s; yr = m - s;
      L[i] = (L[i] * (1 - wet) + yl * wet) * out; R[i] = (R[i] * (1 - wet) + yr * wet) * out;
    }
  }
}

// ================================================================================================ Phaser-Flanger
// 0 mode (phaser / flanger / doubler) 1 notches 2 center Hz 3 spread 4 blend 5 rate 6 sync 7 amount 8 feedback 9 invert 10 warmth 11 output dB 12 dry/wet 13 time ms 14 sync div
export const PF_DIV = [0.25, 0.5, 1, 2, 4, 8, 16];
export class PhaserFlanger extends Fx {
  constructor(sr) {
    super(sr); this.p = [0, 4, 769, 0.37, 0.62, 0.5, 0, 0.69, 0.12, 0, 0.27, 0, 0.5, 2, 3];
    this.z = [new Float64Array(48), new Float64Array(48)]; this.lastL = 0; this.lastR = 0; this.ph = 0;
    const N = 1 << Math.ceil(Math.log2(sr * 0.06)); this.bl = new Float32Array(N); this.br = new Float32Array(N); this.m = N - 1; this.w = 0; this.wl = new Biquad(); this.wr = new Biquad(); this.upd();
  }
  setParam(i, v) { this.p[i] = v; this.upd(); }
  upd() { this.wl.lowpass(this.sr, 20000 - this.p[10] * 15000, 0.6); this.wr.copy(this.wl); }
  allpass(z, x, a, k) { const y = -a * x + z[k]; z[k] = x + a * y; return y; }
  process(L, R, n) {
    const p = this.p, mode = Math.round(p[0]), hz = p[6] > 0.5 ? this.bpm / 60 / PF_DIV[clamp(Math.round(p[14]), 0, 6)] : p[5], rate = TWO_PI * hz / this.sr;
    const amt = p[7], fb = clamp(p[8], 0, 0.95) * (p[9] > 0.5 ? -1 : 1), wet = p[12], out = dbToLin(p[11]), st = clamp(Math.round(p[1]), 1, 24) * 2, warm = p[10];
    for (let i = 0; i < n; i++) {
      this.ph += rate; if (this.ph > TWO_PI) this.ph -= TWO_PI;
      let yl, yr;
      if (mode === 0) {
        const ml = Math.sin(this.ph), mr = Math.sin(this.ph + Math.PI * p[3]);
        const fL = clamp(p[2] * Math.pow(2, ml * amt * 3), 20, 18000), fR = clamp(p[2] * Math.pow(2, mr * amt * 3), 20, 18000);
        const tL = Math.tan(Math.PI * fL / this.sr), tR = Math.tan(Math.PI * fR / this.sr), aL = (1 - tL) / (1 + tL), aR = (1 - tR) / (1 + tR);
        yl = L[i] + this.lastL * fb; yr = R[i] + this.lastR * fb;
        for (let k = 0; k < st; k++) { yl = this.allpass(this.z[0], yl, aL, k); yr = this.allpass(this.z[1], yr, aR, k); }
        this.lastL = yl; this.lastR = yr;
      } else {
        const base = (mode === 1 ? clamp(p[13], 0.1, 20) : clamp(p[13], 0.1, 20) + 15) * 0.001 * this.sr, dep = amt * (mode === 1 ? 0.004 : 0.006) * this.sr;
        const dl = base + dep * (1 + Math.sin(this.ph)) * 0.5, dr = base + dep * (1 + Math.sin(this.ph + Math.PI * p[3])) * 0.5;
        yl = rd(this.bl, this.m, this.w, dl); yr = rd(this.br, this.m, this.w, dr);
        this.bl[this.w & this.m] = L[i] + yl * fb; this.br[this.w & this.m] = R[i] + yr * fb; this.w++;
      }
      if (warm > 0) { yl = this.wl.process(tanh(yl * (1 + warm * 2))); yr = this.wr.process(tanh(yr * (1 + warm * 2))); }
      const b = mode === 0 ? 0.5 + (p[4] - 0.5) * 0.5 : 0.5;
      L[i] = ((L[i] * (1 - b) + yl * b) * wet + L[i] * (1 - wet)) * out; R[i] = ((R[i] * (1 - b) + yr * b) * wet + R[i] * (1 - wet)) * out;
    }
  }
}

// ================================================================================================ Auto Pan
// 0 amount 1 rate Hz 2 sync 3 sync div 4 phase deg 5 shape 6 offset deg 7 waveform (sine / triangle / saw down / random) 8 invert
export const AP_DIV = [0.25, 0.5, 1, 2, 4, 8, 16];
export class AutoPan extends Fx {
  constructor(sr) { super(sr); this.p = [0.5, 1, 0, 2, 180, 0, 0, 0, 0]; this.ph = 0; this.rnd = { seed: 777 }; this.sh = [0, 0]; this.last = [0, 0]; this.play = false; this.beat = 0; }
  setParam(i, v) { this.p[i] = v; }
  tr(playing, beat) { this.play = playing; this.beat = beat; }
  wave(x, c) {
    const p = this.p, wf = Math.round(p[7]); x -= Math.floor(x); let v;
    if (wf === 0) v = Math.sin(TWO_PI * x); else if (wf === 1) v = 1 - 4 * Math.abs(x - 0.5); else if (wf === 2) v = 1 - 2 * x;
    else { if (x < this.last[c]) this.sh[c] = (lcg(this.rnd) / 4294967296) * 2 - 1; this.last[c] = x; v = this.sh[c]; }
    const s = p[5]; if (s > 0) v = clamp(v * (1 + s * 6), -1, 1);
    return v;
  }
  process(L, R, n) {
    const p = this.p, amt = p[0], inv = p[8] > 0.5 ? -1 : 1, sync = p[2] > 0.5, hz = sync ? this.bpm / 60 / AP_DIV[clamp(Math.round(p[3]), 0, 6)] : p[1];
    if (sync && this.play) this.ph = this.beat / AP_DIV[clamp(Math.round(p[3]), 0, 6)];
    const step = hz / this.sr, off = p[6] / 360, phs = p[4] / 360;
    for (let i = 0; i < n; i++) {
      this.ph += step; const a = this.wave(this.ph + off, 0), b = this.wave(this.ph + off + phs, 1);
      const gl = 1 - amt * (0.5 + 0.5 * a * inv), gr = 1 - amt * (0.5 + 0.5 * b * -inv);
      L[i] *= gl; R[i] *= gr;
    }
    this.ph -= Math.floor(this.ph);
  }
  readOut(o) { o[0] = this.ph; return 1; }
}

// ================================================================================================ Gate
// 0 threshold 1 return 2 attack ms 3 hold ms 4 release ms 5 floor dB 6 flip
export class Gate extends Fx {
  constructor(sr) { super(sr); this.p = [-40, 3, 0.1, 10, 100, -80, 0]; this.env = 0; this.g = 0; this.open = false; this.hold = 0; this.inPk = 0; this.gr = 0; }
  setParam(i, v) { this.p[i] = v; }
  process(L, R, n) {
    const p = this.p, on = dbToLin(p[0]), off = dbToLin(p[0] - p[1]), at = 1 - coef(p[2], this.sr), rl = 1 - coef(p[4], this.sr), hs = p[3] * 0.001 * this.sr, fl = dbToLin(p[5]), flip = p[6] > 0.5, ec = 1 - coef(1, this.sr);
    let pk = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.max(Math.abs(L[i]), Math.abs(R[i])); this.env += (x - this.env) * (x > this.env ? 1 : ec); if (x > pk) pk = x;
      if (this.env >= on) { this.open = true; this.hold = hs; } else if (this.env < off) { if (this.hold > 0) this.hold--; else this.open = false; }
      const t = (this.open !== flip) ? 1 : fl; this.g += (t - this.g) * (t > this.g ? at : rl);
      L[i] *= this.g; R[i] *= this.g;
    }
    this.inPk = Math.max(pk, this.inPk * 0.9); this.gr = this.g;
  }
  readOut(o) { o[0] = linToDb(this.inPk); o[1] = linToDb(this.gr); o[2] = this.open ? 1 : 0; this.inPk = 0; return 3; }
}

// ================================================================================================ Glue Compressor (bus compressor)
// 0 attack idx 1 release idx (6 = auto) 2 ratio idx 3 threshold 4 makeup 5 range 6 soft clip 7 dry/wet
export const GLUE_ATK = [0.01, 0.1, 0.3, 1, 3, 10, 30], GLUE_REL = [0.1, 0.2, 0.4, 0.6, 0.8, 1.2], GLUE_RAT = [2, 4, 10];
export class GlueComp extends Fx {
  constructor(sr) { super(sr); this.p = [3, 2, 0, -10, 0, 70, 0, 1]; this.env = 0; this.grDb = 0; this.grMax = 0; this.slow = 0; }
  setParam(i, v) { this.p[i] = v; }
  process(L, R, n) {
    const p = this.p, at = 1 - coef(GLUE_ATK[clamp(Math.round(p[0]), 0, 6)], this.sr), auto = Math.round(p[1]) >= 6, rel = GLUE_REL[clamp(Math.round(p[1]), 0, 5)];
    const ratio = GLUE_RAT[clamp(Math.round(p[2]), 0, 2)], th = p[3], mk = dbToLin(p[4]), range = p[5], clip = p[6] > 0.5, mix = p[7];
    const rf = 1 - coef(rel * 1000, this.sr), rs = 1 - coef(1500, this.sr), rq = 1 - coef(80, this.sr);
    let mx = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.max(Math.abs(L[i]), Math.abs(R[i])), xdb = linToDb(x), over = xdb - th;
      const want = over > 0 ? Math.min(range, over * (1 - 1 / ratio)) : 0;
      if (want > this.env) this.env += (want - this.env) * at;
      else if (auto) { this.slow += (want - this.slow) * rs; const fast = this.env + (want - this.env) * rq; this.env = Math.max(fast, Math.min(this.env, this.slow)); }
      else this.env += (want - this.env) * rf;
      const g = dbToLin(-this.env) * mk; if (this.env > mx) mx = this.env;
      let l = L[i] * g, r = R[i] * g; if (clip) { l = tanh(l); r = tanh(r); }   // soft clip: a gentle ceiling at 0 dBFS
      L[i] = L[i] * (1 - mix) + l * mix; R[i] = R[i] * (1 - mix) + r * mix;
    }
    this.grDb = this.env; this.grMax = Math.max(this.grMax, mx);
  }
  readOut(o) { o[0] = this.grMax; this.grMax = 0; return 1; }
}

// ================================================================================================ Channel EQ
// 0 HP 80 Hz on 1 low dB 2 mid dB 3 mid freq 4 high dB 5 output dB
export class ChannelEq extends Fx {
  constructor(sr) { super(sr); this.p = [0, 0, 0, 1500, 0, 0]; this.b = [0, 1].map(() => [new Biquad(), new Biquad(), new Biquad(), new Biquad()]); this.upd(); }
  setParam(i, v) { this.p[i] = v; this.upd(); }
  upd() {
    const p = this.p, [hp, lo, mid, hi] = this.b[0];
    hp.highpass(this.sr, 80, 0.707); lo.lowShelf(this.sr, 100, 0.7, clamp(p[1], -15, 15)); mid.peaking(this.sr, p[3], 0.9, clamp(p[2], -12, 12));
    if (p[4] >= 0) hi.highShelf(this.sr, 6000, 0.7, p[4]); else hi.lowpass(this.sr, 20000 * Math.pow(2, p[4] / 3), 0.707);   // Live: a negative High turns into a low-pass sweep
    for (let k = 0; k < 4; k++) this.b[1][k].copy(this.b[0][k]);
  }
  process(L, R, n) {
    const hpOn = this.p[0] > 0.5, g = dbToLin(this.p[5]), [a, b] = this.b;
    for (let i = 0; i < n; i++) {
      let l = L[i], r = R[i]; if (hpOn) { l = a[0].process(l); r = b[0].process(r); }
      for (let k = 1; k < 4; k++) { l = a[k].process(l); r = b[k].process(r); }
      L[i] = l * g; R[i] = r * g;
    }
  }
}

// ================================================================================================ Erosion
// 0 mode (noise / wide noise / sine) 1 freq 2 width 3 amount
export class Erosion extends Fx {
  constructor(sr) { super(sr); this.p = [0, 670, 0.3, 0.6]; this.f = [new Biquad(), new Biquad()]; this.rnd = { seed: 99 }; this.ph = 0; this.upd(); }
  setParam(i, v) { this.p[i] = v; this.upd(); }
  upd() { const q = clamp(1 / Math.max(0.05, this.p[2]), 0.3, 20); this.f[0].bandpass(this.sr, this.p[1], q); this.f[1].copy(this.f[0]); }
  process(L, R, n) {
    const p = this.p, mode = Math.round(p[0]), amt = p[3] * 4, ph = TWO_PI * p[1] / this.sr;
    for (let i = 0; i < n; i++) {
      let ml, mr;
      if (mode === 2) { this.ph += ph; if (this.ph > TWO_PI) this.ph -= TWO_PI; ml = mr = Math.sin(this.ph) * 0.3; }
      else { const a = (lcg(this.rnd) / 4294967296) * 2 - 1; ml = this.f[0].process(a); mr = mode === 1 ? this.f[1].process((lcg(this.rnd) / 4294967296) * 2 - 1) : ml; }
      L[i] += L[i] * ml * amt; R[i] += R[i] * mr * amt;
    }
  }
}

// ================================================================================================ Redux
// 0 rate Hz 1 jitter 2 pre filter 3 bits 4 bits on 5 shape 6 dc shift 7 dry/wet
export class Redux extends Fx {
  constructor(sr) { super(sr); this.p = [40000, 0, 1, 8, 0, 0, 0, 1]; this.c = 1; this.hl = 0; this.hr = 0; this.rnd = { seed: 5 }; this.pre = [new Biquad(), new Biquad()]; this.upd(); }
  setParam(i, v) { this.p[i] = v; this.upd(); }
  upd() { this.pre[0].lowpass(this.sr, clamp(this.p[0] * 0.45, 100, this.sr * 0.45), 0.707); this.pre[1].copy(this.pre[0]); }
  process(L, R, n) {
    const p = this.p, step = clamp(p[0], 50, this.sr) / this.sr, jit = p[1], pre = p[2] > 0.5, bon = p[4] > 0.5, q = Math.pow(2, clamp(p[3], 1, 16) - 1), sh = p[5], dc = p[6] > 0.5 ? 0.5 / q : 0, mix = p[7];
    for (let i = 0; i < n; i++) {
      const xl = pre ? this.pre[0].process(L[i]) : L[i], xr = pre ? this.pre[1].process(R[i]) : R[i];
      this.c += step * (1 + jit * ((lcg(this.rnd) / 4294967296) - 0.5));
      if (this.c >= 1) { this.c -= Math.floor(this.c); this.hl = xl; this.hr = xr; }
      let l = this.hl, r = this.hr;
      if (bon) { const sl = sh > 0 ? Math.sign(l) * Math.pow(Math.abs(l), 1 - sh * 0.6) : l, sr2 = sh > 0 ? Math.sign(r) * Math.pow(Math.abs(r), 1 - sh * 0.6) : r; l = Math.round(sl * q + dc) / q; r = Math.round(sr2 * q + dc) / q; }
      L[i] = L[i] * (1 - mix) + l * mix; R[i] = R[i] * (1 - mix) + r * mix;
    }
  }
}

// ================================================================================================ Vinyl Distortion
// 0 tracing on 1 tracing drive 2 tracing freq 3 tracing width 4 pinch on 5 pinch drive 6 pinch freq 7 pinch width 8 mono 9 hard 10 crackle volume 11 crackle density 12 drive
export class VinylDist extends Fx {
  constructor(sr) { super(sr); this.p = [1, 0.14, 10400, 1.67, 1, 0.14, 5080, 3, 0, 1, 0, 0, 1]; this.tb = [new Biquad(), new Biquad()]; this.pb = [new Biquad(), new Biquad()]; this.cf = [new Biquad(), new Biquad()]; this.rnd = { seed: 31 }; this.upd(); }
  setParam(i, v) { this.p[i] = v; this.upd(); }
  upd() { const p = this.p; this.tb[0].bandpass(this.sr, p[2], 1 / Math.max(0.1, p[3])); this.tb[1].copy(this.tb[0]); this.pb[0].bandpass(this.sr, p[6], 1 / Math.max(0.1, p[7])); this.pb[1].copy(this.pb[0]); this.cf[0].bandpass(this.sr, 3000, 0.8); this.cf[1].copy(this.cf[0]); }
  process(L, R, n) {
    const p = this.p, tOn = p[0] > 0.5, td = p[1] * 8, pOn = p[4] > 0.5, pd = p[5] * 8, mono = p[8] > 0.5, hard = p[9] > 0.5, cv = p[10], cd = p[11] * 0.004, dr = p[12];
    for (let i = 0; i < n; i++) {
      let l = L[i], r = R[i];
      if (tOn) { const a = this.tb[0].process(l), b = this.tb[1].process(r); l += td * a * Math.abs(a); r += td * b * Math.abs(b); }   // even harmonics in the tracing band
      if (pOn) {
        const a = this.pb[0].process(l), b = this.pb[1].process(r), sh = (x) => (hard ? clamp(x * (1 + pd), -1, 1) : tanh(x * (1 + pd)));   // odd harmonics, opposite polarity in stereo
        const ea = sh(a) - a, eb = sh(b) - b; l += ea; r += mono ? ea : -eb;
      }
      if (cv > 0 && (lcg(this.rnd) / 4294967296) < cd) { const c = ((lcg(this.rnd) / 4294967296) * 2 - 1) * cv; l += this.cf[0].process(c) * 4; r += this.cf[1].process(c) * 4; }
      else if (cv > 0) { l += this.cf[0].process(0) * 4; r += this.cf[1].process(0) * 4; }
      L[i] = l * dr; R[i] = r * dr;
    }
  }
}

// ================================================================================================ Drum Buss
// 0 drive 1 type (soft / medium / hard) 2 trim dB 3 comp 4 crunch 5 damp Hz 6 transients 7 boom 8 boom freq 9 boom decay 10 output dB 11 dry/wet
export class DrumBuss extends Fx {
  constructor(sr) {
    super(sr); this.p = [0.45, 2, -12, 1, 0, 20000, -0.45, 0, 49, 1, -4, 1];
    this.dmp = [new Biquad(), new Biquad()]; this.cr = [new Biquad(), new Biquad()]; this.bm = new Biquad(); this.env = 0; this.fast = 0; this.slow = 0; this.boomLv = 0; this.outLv = 0; this.upd();
  }
  setParam(i, v) { this.p[i] = v; this.upd(); }
  upd() { const p = this.p; this.dmp[0].lowpass(this.sr, p[5], 0.707); this.dmp[1].copy(this.dmp[0]); this.cr[0].bandpass(this.sr, 4500, 1.2); this.cr[1].copy(this.cr[0]); this.bm.bandpass(this.sr, p[8], 4 + p[9] * 40); }
  process(L, R, n) {
    const p = this.p, trim = dbToLin(p[2]), comp = p[3] > 0.5, dv = 1 + p[0] * 9, ty = Math.round(p[1]), cr = p[4] * 2, tr = p[6], boom = p[7] * 3, out = dbToLin(p[10]), mix = p[11];
    const ec = 1 - coef(30, this.sr), fa = 1 - coef(1, this.sr), sl = 1 - coef(60, this.sr);
    let bpk = 0, opk = 0;
    for (let i = 0; i < n; i++) {
      let l = L[i] * trim, r = R[i] * trim;
      if (comp) { const x = Math.max(Math.abs(l), Math.abs(r)); this.env += (x - this.env) * ec; const g = this.env > 0.25 ? Math.pow(0.25 / this.env, 0.5) : 1; l *= g * 1.6; r *= g * 1.6; }
      const sh = (x) => (ty === 0 ? tanh(x * dv) / Math.max(1, dv * 0.6) : ty === 1 ? tanh(x * dv) / Math.max(1, dv * 0.45) : clamp(x * dv, -1, 1) / Math.max(1, dv * 0.4));
      l = sh(l); r = sh(r);
      if (cr > 0) { l += tanh(this.cr[0].process(l) * 6) * cr * 0.2; r += tanh(this.cr[1].process(r) * 6) * cr * 0.2; }
      l = this.dmp[0].process(l); r = this.dmp[1].process(r);
      const a = Math.max(Math.abs(l), Math.abs(r)); this.fast += (a - this.fast) * fa; this.slow += (a - this.slow) * sl;
      const tg = clamp(1 + tr * ((this.fast - this.slow) / Math.max(1e-4, this.slow)) * 0.8, 0.2, 3); l *= tg; r *= tg;
      if (boom > 0) { const b = this.bm.process((l + r) * 0.5) * boom; l += b; r += b; if (Math.abs(b) > bpk) bpk = Math.abs(b); }
      l *= out; r *= out; const o = Math.max(Math.abs(l), Math.abs(r)); if (o > opk) opk = o;
      L[i] = L[i] * (1 - mix) + l * mix; R[i] = R[i] * (1 - mix) + r * mix;
    }
    this.boomLv = Math.max(bpk, this.boomLv * 0.92); this.outLv = Math.max(opk, this.outLv * 0.92);
  }
  readOut(o) { o[0] = linToDb(this.boomLv); o[1] = linToDb(this.outLv); return 2; }
}

// ================================================================================================ Tuner (pass-through; pitch from a normalised difference function on a decimated window)
// 0 reference Hz
export class Tuner extends Fx {
  constructor(sr) { super(sr); this.p = [440]; this.dec = Math.max(1, Math.round(sr / 12000)); this.N = 2048; this.buf = new Float32Array(this.N); this.w = 0; this.k = 0; this.acc = 0; this.hz = 0; this.cl = 0; this.lv = 0; }
  setParam(i, v) { this.p[i] = v; }
  process(L, R, n) {
    for (let i = 0; i < n; i++) { this.acc += (L[i] + R[i]) * 0.5; if (++this.k >= this.dec) { this.buf[this.w++ & (this.N - 1)] = this.acc / this.dec; this.acc = 0; this.k = 0; } }
  }
  detect() {
    const sr = this.sr / this.dec, W = 768, b = this.buf, e = this.w, M = this.N - 1, maxLag = Math.min(700, Math.floor(sr / 25)), minLag = Math.max(2, Math.floor(sr / 1500));
    let lv = 0; for (let j = 0; j < W; j++) { const x = b[(e - W - maxLag + j) & M]; lv += x * x; } this.lv = Math.sqrt(lv / W);
    if (this.lv < 0.003) { this.cl = 0; return; }
    let run = 0, best = -1, bestV = 1, prev = 1, d = new Float32Array(maxLag + 1);
    for (let t = 1; t <= maxLag; t++) { let s = 0; for (let j = 0; j < W; j++) { const x = b[(e - W + j) & M] - b[(e - W + j - t) & M]; s += x * x; } run += s; d[t] = run > 0 ? s * t / run : 1; }
    for (let t = minLag; t < maxLag; t++) if (d[t] < 0.15 && d[t] < d[t - 1] && d[t] <= d[t + 1]) { best = t; bestV = d[t]; break; }
    if (best < 0) { for (let t = minLag; t < maxLag; t++) if (d[t] < bestV) { bestV = d[t]; best = t; } if (bestV > 0.35) { this.cl = 0; return; } }
    const a = d[best - 1], c = d[best + 1], den = a + c - 2 * d[best], lag = den !== 0 ? best + 0.5 * (a - c) / den : best;
    this.hz = sr / lag; this.cl = 1 - bestV; void prev;
  }
  readOut(o) { this.detect(); o[0] = this.cl > 0 ? this.hz : 0; o[1] = this.cl; o[2] = linToDb(this.lv); o[3] = this.p[0]; return 4; }
}

// ================================================================================================ EQ Eight
// 8 bands x 5 params (on, type, freq, gain dB, Q) = 0..39, 40 scale (gain multiplier), 41 output dB.
// types: 0 low cut 48, 1 low cut 12, 2 low shelf, 3 bell, 4 notch, 5 high shelf, 6 high cut 12, 7 high cut 48
export const EQ8_TYPES = ['Low Cut 48', 'Low Cut 12', 'Low Shelf', 'Bell', 'Notch', 'High Shelf', 'High Cut 12', 'High Cut 48'];
export function eq8Stages(sr, type, f, g, q) {                      // the biquad stages of one band (shared with the display)
  const st = [], one = () => { const b = new Biquad(); st.push(b); return b; };
  if (type === 0 || type === 7) { for (const qq of [0.5412, 1.3066, 0.5412, 1.3066]) type === 0 ? one().highpass(sr, f, qq * q / 0.7071) : one().lowpass(sr, f, qq * q / 0.7071); }
  else if (type === 1) one().highpass(sr, f, q); else if (type === 6) one().lowpass(sr, f, q);
  else if (type === 2) one().lowShelf(sr, f, q, g); else if (type === 5) one().highShelf(sr, f, q, g);
  else if (type === 4) one().notch(sr, f, q); else one().peaking(sr, f, q, g);
  return st;
}
export class EqEight extends Fx {
  constructor(sr) {
    super(sr); this.p = []; const T = [1, 2, 3, 3, 3, 3, 5, 6], F = [30, 100, 250, 1000, 2500, 5000, 10000, 18000];
    for (let b = 0; b < 8; b++) this.p.push(b === 0 || b === 7 ? 0 : 1, T[b], F[b], 0, 0.71); this.p.push(1, 0);
    this.st = [[], []]; this.upd();
  }
  setParam(i, v) { this.p[i] = v; this.upd(); }
  upd() {
    const p = this.p, sc = p[40]; this.st = [[], []];
    for (let b = 0; b < 8; b++) { const o = b * 5; if (p[o] < 0.5) continue; const t = Math.round(p[o + 1]); for (const c of [0, 1]) this.st[c].push(...eq8Stages(this.sr, t, clamp(p[o + 2], 10, 22000), clamp(p[o + 3] * sc, -24, 24), clamp(p[o + 4], 0.1, 18))); }
  }
  process(L, R, n) {
    const g = dbToLin(this.p[41]), a = this.st[0], b = this.st[1];
    for (let i = 0; i < n; i++) { let l = L[i], r = R[i]; for (let k = 0; k < a.length; k++) { l = a[k].process(l); r = b[k].process(r); } L[i] = l * g; R[i] = r * g; }
  }
}

// ================================================================================================ Spectrum (pass-through analyser)
// 0 block (1024..16384) 1 channel (L / R / L+R) 2 averaging 3 graph (line / bins) 4 max hold 5 scale X (lin / log / ST) 6 auto range  - display options only
export class Spectrum extends Fx {
  constructor(sr) { super(sr); this.p = [2, 2, 4, 0, 0, 1, 1]; this.N = 16384; this.buf = new Float32Array(this.N); this.w = 0; this.avg = new Float32Array(256).fill(-150); }
  setParam(i, v) { this.p[i] = v; }
  process(L, R, n) { const ch = Math.round(this.p[1]); for (let i = 0; i < n; i++) this.buf[this.w++ & (this.N - 1)] = ch === 0 ? L[i] : ch === 1 ? R[i] : (L[i] + R[i]) * 0.5; }
  readOut(o) {
    const n = [1024, 2048, 4096, 8192, 16384][clamp(Math.round(this.p[0]), 0, 4)], re = new Float64Array(n), im = new Float64Array(n), M = this.N - 1;
    for (let k = 0; k < n; k++) { const wdw = 0.5 - 0.5 * Math.cos(2 * Math.PI * k / (n - 1)); re[k] = this.buf[(this.w - n + k) & M] * wdw; }
    fft(re, im, n);
    const scale = Math.round(this.p[5]), a = 1 / Math.max(1, Math.round(this.p[2])), bins = 256, nyq = this.sr / 2;
    for (let b = 0; b < bins; b++) {
      const f0 = scale === 0 ? b / bins * nyq : 20 * Math.pow(1000, b / bins), f1 = scale === 0 ? (b + 1) / bins * nyq : 20 * Math.pow(1000, (b + 1) / bins);
      let k0 = Math.floor(f0 / nyq * n / 2), k1 = Math.max(k0 + 1, Math.ceil(f1 / nyq * n / 2)), m = 0;
      for (let k = k0; k < k1 && k < n / 2; k++) { const v = re[k] * re[k] + im[k] * im[k]; if (v > m) m = v; }
      const db = 10 * Math.log10(m / (n * n / 16) + 1e-16);
      this.avg[b] += (db - this.avg[b]) * a; o[b] = this.avg[b];
    }
    return bins;
  }
}
