// Modulators of the web engine, Live 12 set (LFO, Shaper, Envelope Follower). Audio passes through unchanged; every block the modulator
// computes m (0..1) and core.js (runChain -> applyMod) writes the mapped value into the target device parameter.
// Mapping block (same layout in every modulator, starting at index MAP): Mod mode (remap / mod), bipolar, mod amount, min, max, then hidden:
// target strip (-1 = none), target device index, target parameter, target min, max, log curve, base value (the target's own setting).
import { TWO_PI, clamp, lcg } from './dsp.js';

const rnd01 = (o) => lcg(o) / 4294967296;
export const SYNC_BEATS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16];     // 1/32 ... 4 bars in quarter notes
class Mod {
  constructor(sr, map) { this.sr = sr; this.bypass = false; this.bpm = 120; this.MAP = map; this.m = 0; this.mod = true; this.hist = new Float32Array(128); this.hw = 0; }
  setTempo(b) { this.bpm = b; }
  // value for the target parameter from m, or null when nothing is mapped
  target() {
    const p = this.p, o = this.MAP; if (!(p[o + 5] >= 0)) return null;
    const lo = p[o + 8], hi = p[o + 9], log = p[o + 10] > 0.5 && lo > 0 && hi > 0, nrm = (v) => (log ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / ((hi - lo) || 1)), den = (n) => (log ? lo * Math.pow(hi / lo, n) : lo + n * (hi - lo));
    let n;
    if (p[o] > 0.5) { const m = p[o + 1] > 0.5 ? this.m * 2 - 1 : this.m; n = nrm(p[o + 11]) + m * p[o + 2] * (p[o + 1] > 0.5 ? 0.5 : 1); }   // Mod: around the target's own value
    else n = p[o + 3] + (p[o + 4] - p[o + 3]) * this.m;                                                                                       // Remap: Min .. Max
    return { s: Math.round(p[o + 5]), d: Math.round(p[o + 6]), k: Math.round(p[o + 7]), v: den(clamp(n, 0, 1)) };
  }
  push() { this.hist[this.hw & 127] = this.m; this.hw++; }
  readOut(o) { o[0] = this.m; for (let j = 0; j < 128; j++) o[1 + j] = this.hist[(this.hw + j) & 127]; return 129; }
}
const mapDefaults = () => [0, 0, 0.5, 0, 1, -1, 0, 0, 0, 1, 0, 0];

// ================================================================================================ LFO
// 0 waveform (sine / saw up / saw down / triangle / rectangle / random / binary) 1 shape 2 steps (0 = off) 3 jitter 4 smooth 5 rate Hz 6 sync 7 sync rate
// 8 x10 9 depth 10 offset 11 phase 12 hold 13 retrigger (counter) | 14.. mapping
export class LfoMod extends Mod {
  constructor(sr) { super(sr, 14); this.p = [0, 0, 0, 0, 0, 1, 0, 3, 0, 1, 0, 0, 0, 0, ...mapDefaults()]; this.ph = 0; this.rnd = { seed: 21 }; this.rv = 0; this.jv = 0; this.sm = 0; this.rt = 0; this.held = 0; }
  setParam(i, v) { this.p[i] = v; if (i === 13 && v !== this.rt) { this.rt = v; this.ph = 0; } }
  wave(x) {
    const p = this.p, w = Math.round(p[0]); x -= Math.floor(x);
    const sh = p[1]; if (sh) x = sh > 0 ? Math.pow(x, 1 + sh * 3) : 1 - Math.pow(1 - x, 1 - sh * 3);   // Shape bends the phase
    switch (w) { case 1: return x; case 2: return 1 - x; case 3: return 1 - Math.abs(2 * x - 1); case 4: return x < 0.5 ? 1 : 0; case 5: return this.rv; case 6: return this.rv > 0.5 ? 1 : 0; default: return 0.5 + 0.5 * Math.sin(TWO_PI * x); }
  }
  process(L, R, n) {
    const p = this.p, hz = (p[6] > 0.5 ? this.bpm / 60 / SYNC_BEATS[clamp(Math.round(p[7]), 0, 7)] : p[5] * (p[8] > 0.5 ? 10 : 1));
    const prev = this.ph; this.ph += hz * n / this.sr; if (Math.floor(this.ph) !== Math.floor(prev)) { this.rv = rnd01(this.rnd); this.jv = (rnd01(this.rnd) - 0.5) * p[3]; }
    if (this.ph > 1e6) this.ph -= Math.floor(this.ph);
    if (p[12] > 0.5) { if (this.held === null) this.held = this.m; this.push(); return; } this.held = null;   // Hold freezes the output
    let v = this.wave(this.ph + p[11]); const st = Math.round(p[2]); if (st > 1) v = Math.round(v * (st - 1)) / (st - 1);
    v = clamp(v + this.jv, 0, 1); const a = p[4] > 0 ? Math.exp(-n / (this.sr * (0.001 + p[4] * p[4] * 0.5))) : 0; this.sm = this.sm * a + v * (1 - a);
    this.m = clamp(0.5 + (this.sm - 0.5) * p[9] + p[10] * 0.5, 0, 1);              // Depth scales around the middle, Offset (-100..100 %) moves it
    this.push();
  }
}

// ================================================================================================ Shaper (breakpoint shape)
// 0 rate Hz 1 sync 2 sync rate 3 depth 4 offset 5 phase 6 jitter 7 smooth 8 grid 9 snap 10 points in use (2..8) 11..34 points (x, y, curve) x8 | 35.. mapping
export const SHAPER_PTS = 8, SHAPER_P0 = 11;
export class ShaperMod extends Mod {
  constructor(sr) { super(sr, 35); const pts = [0, 0, -0.5, 0.5, 1, 0, 0.5, 0, 0.5, 1, 1, 0]; this.p = [1, 0, 3, 1, 0, 0, 0, 0, 4, 1, 4, ...pts, ...[1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], ...mapDefaults()]; this.ph = 0; this.rnd = { seed: 31 }; this.jv = 0; this.sm = 0; }
  setParam(i, v) { this.p[i] = v; }
  shape(x) {
    const p = this.p, np = clamp(Math.round(p[10]), 2, SHAPER_PTS); x -= Math.floor(x);
    for (let j = 0; j < np - 1; j++) {
      const x0 = p[SHAPER_P0 + j * 3], x1 = p[SHAPER_P0 + (j + 1) * 3];
      if (x <= x1 || j === np - 2) { const y0 = p[SHAPER_P0 + j * 3 + 1], y1 = p[SHAPER_P0 + (j + 1) * 3 + 1], c = p[SHAPER_P0 + j * 3 + 2]; let t = x1 > x0 ? clamp((x - x0) / (x1 - x0), 0, 1) : 1; if (c) t = c > 0 ? Math.pow(t, 1 + c * 4) : 1 - Math.pow(1 - t, 1 - c * 4); return y0 + (y1 - y0) * t; }
    }
    return 0;
  }
  process(L, R, n) {
    const p = this.p, hz = p[1] > 0.5 ? this.bpm / 60 / SYNC_BEATS[clamp(Math.round(p[2]), 0, 7)] : p[0];
    const prev = this.ph; this.ph += hz * n / this.sr; if (Math.floor(this.ph) !== Math.floor(prev)) this.jv = (rnd01(this.rnd) - 0.5) * p[6]; if (this.ph > 1e6) this.ph -= Math.floor(this.ph);
    const v = clamp(this.shape(this.ph + p[5]) + this.jv, 0, 1), a = p[7] > 0 ? Math.exp(-n / (this.sr * (0.001 + p[7] * p[7] * 0.5))) : 0; this.sm = this.sm * a + v * (1 - a);
    this.m = clamp(0.5 + (this.sm - 0.5) * p[3] + p[4] * 0.5, 0, 1); this.push();
  }
}

// ================================================================================================ Envelope Follower
// 0 gain dB 1 rise 2 fall 3 delay 4 delay sync 5 delay note | 6.. mapping
export class EnvFollower extends Mod {
  constructor(sr) { super(sr, 6); this.p = [0, 0.157, 0.134, 63, 0, 2, ...mapDefaults()]; this.env = 0; this.dl = new Float32Array(4096); this.dw = 0; this.lv = new Float32Array(128); this.lw = 0; }
  setParam(i, v) { this.p[i] = v; }
  process(L, R, n) {
    const p = this.p, g = Math.pow(10, p[0] / 20); let pk = 0;
    for (let i = 0; i < n; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])) * g; if (a > pk) pk = a; }
    const blocks = this.sr / n, rise = Math.exp(-1 / Math.max(1, p[1] * p[1] * blocks * 2)), fall = Math.exp(-1 / Math.max(1, p[2] * p[2] * blocks * 4));
    this.env = pk > this.env ? this.env * rise + pk * (1 - rise) : this.env * fall + pk * (1 - fall);
    const dms = p[4] > 0.5 ? SYNC_BEATS[clamp(Math.round(p[5]), 0, 7)] * 60000 / this.bpm : p[3], d = clamp(Math.round(dms * 0.001 * blocks), 0, 4095);   // delay in blocks
    this.dl[this.dw & 4095] = clamp(this.env, 0, 1); this.m = this.dl[(this.dw - d) & 4095]; this.dw++;
    this.lv[this.lw & 127] = Math.min(1, pk); this.lw++; this.push();
  }
  readOut(o) { const k = super.readOut(o); for (let j = 0; j < 128; j++) o[k + j] = this.lv[(this.lw + j) & 127]; return k + 128; }
}
