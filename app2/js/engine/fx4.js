// Effects of the web engine, Live 12 set (part 2): Amp, Cabinet, Overdrive, Pedal, Dynamic Tube, Multiband Dynamics, Resonators, Corpus,
// Vocoder, Shifter, Grain Delay, Hybrid Reverb, Looper. Interface as in fx.js (setParam / process / readOut / setTempo / tr).
import { TWO_PI, clamp, dbToLin, linToDb, Biquad, fastTanh, lcg } from './dsp.js';

class Fx { constructor(sr) { this.sr = sr; this.bypass = false; this.bpm = 120; } readOut() { return 0; } setTempo(b) { this.bpm = b; } }
const tanh = fastTanh;
const coef = (ms, sr) => Math.exp(-1 / Math.max(1, ms * 0.001 * sr));
const rnd01 = (o) => lcg(o) / 4294967296;
function rd(buf, mask, w, d) { const p = w - d, i = Math.floor(p), f = p - i; const a = buf[i & mask], b = buf[(i + 1) & mask]; return a + (b - a) * f; }
const pair = (fn) => [fn(), fn()];

// ================================================================================================ Amp
// 0 type (Clean, Boost, Blues, Rock, Lead, Heavy, Bass) 1 gain 2 bass 3 middle 4 treble 5 presence 6 volume (0..10) 7 output (mono / stereo) 8 dry/wet
const AMP = [{ g: 1, a: 0, lo: 0, mid: 700 }, { g: 3, a: 0.1, lo: 0, mid: 800 }, { g: 6, a: 0.2, lo: -2, mid: 650 }, { g: 12, a: 0.25, lo: -1, mid: 800 }, { g: 24, a: 0.3, lo: -3, mid: 1000 }, { g: 40, a: 0.4, lo: 2, mid: 500 }, { g: 4, a: 0.05, lo: 4, mid: 400 }];
export class Amp extends Fx {
  constructor(sr) { super(sr); this.p = [2, 6.9, 6.27, 5.79, 4.44, 2.62, 8.25, 0, 1]; this.f = pair(() => [new Biquad(), new Biquad(), new Biquad(), new Biquad(), new Biquad()]); this.upd(); }
  setParam(i, v) { this.p[i] = v; this.upd(); }
  upd() {
    const p = this.p, t = AMP[clamp(Math.round(p[0]), 0, 6)], db = (v) => (v - 5) * 2.4, [a, b, c, d, e] = this.f[0];
    a.highpass(this.sr, t === AMP[6] ? 30 : 70, 0.707); b.lowShelf(this.sr, 120, 0.7, db(p[2]) + t.lo); c.peaking(this.sr, t.mid, 0.8, db(p[3])); d.highShelf(this.sr, 2800, 0.7, db(p[4])); e.highShelf(this.sr, 5500, 0.7, db(p[5]) * 0.8);
    for (let k = 0; k < 5; k++) this.f[1][k].copy(this.f[0][k]);
  }
  process(L, R, n) {
    const p = this.p, t = AMP[clamp(Math.round(p[0]), 0, 6)], pre = t.g * (0.2 + p[1] / 10 * 2), vol = Math.pow(p[6] / 10, 2) * 1.6, mono = p[7] < 0.5, mix = p[8], norm = 1 / Math.max(0.3, tanh(pre * 0.5));
    for (let i = 0; i < n; i++) {
      let l = L[i], r = R[i]; if (mono) l = r = (l + r) * 0.5;
      const sh = (x, f) => { x = f[0].process(x) * pre; const y = tanh(x + t.a) - tanh(t.a); return f[4].process(f[3].process(f[2].process(f[1].process(y * norm * 0.5)))); };
      const yl = sh(l, this.f[0]) * vol, yr = mono ? yl : sh(r, this.f[1]) * vol;
      L[i] = L[i] * (1 - mix) + yl * mix; R[i] = R[i] * (1 - mix) + yr * mix;
    }
  }
}

// ================================================================================================ Cabinet
// 0 cabinet (1x12, 2x12, 4x12, 4x10 Bass) 1 microphone (condenser / dynamic) 2 position (near on-axis / near off-axis / far) 3 output (mono / stereo) 4 dry/wet
export class Cabinet extends Fx {
  constructor(sr) { super(sr); this.p = [1, 1, 0, 0, 1]; this.f = pair(() => [new Biquad(), new Biquad(), new Biquad(), new Biquad()]); const N = 2048; this.bl = new Float32Array(N); this.br = new Float32Array(N); this.w = 0; this.upd(); }
  setParam(i, v) { this.p[i] = v; this.upd(); }
  upd() {
    const p = this.p, cab = clamp(Math.round(p[0]), 0, 3), mic = Math.round(p[1]), pos = Math.round(p[2]), [a, b, c, d] = this.f[0];
    a.highpass(this.sr, [110, 90, 75, 45][cab], 0.9); b.peaking(this.sr, [2200, 1800, 1600, 900][cab], 1.2, [5, 4, 3, 3][cab] - (pos === 1 ? 4 : 0));
    c.lowpass(this.sr, [5200, 4800, 4300, 3200][cab] * (pos === 1 ? 0.7 : pos === 2 ? 0.8 : 1) * (mic ? 0.85 : 1.15), 0.9); d.peaking(this.sr, [120, 110, 100, 80][cab], 1, pos === 0 ? 3 : 1);
    for (let k = 0; k < 4; k++) this.f[1][k].copy(this.f[0][k]);
  }
  process(L, R, n) {
    const p = this.p, mono = p[3] < 0.5, mix = p[4], far = Math.round(p[2]) === 2, dl = Math.round(this.sr * 0.006), M = 2047;
    for (let i = 0; i < n; i++) {
      let l = L[i], r = R[i]; if (mono) l = r = (l + r) * 0.5;
      const run = (x, f) => f[3].process(f[2].process(f[1].process(f[0].process(x))));
      let yl = run(l, this.f[0]), yr = mono ? yl : run(r, this.f[1]);
      if (far) { this.bl[this.w & M] = yl; this.br[this.w & M] = yr; yl = yl * 0.7 + this.br[(this.w - dl) & M] * 0.35; yr = yr * 0.7 + this.bl[(this.w - dl - 37) & M] * 0.35; this.w++; }   // room: a little of the far wall
      L[i] = L[i] * (1 - mix) + yl * mix; R[i] = R[i] * (1 - mix) + yr * mix;
    }
  }
}

// ================================================================================================ Overdrive
// 0 filter freq 1 filter width (octaves) 2 drive 3 tone 4 dynamics 5 dry/wet
export class Overdrive extends Fx {
  constructor(sr) { super(sr); this.p = [1100, 6, 0.5, 0.5, 0.5, 1]; this.h = pair(() => new Biquad()); this.l = pair(() => new Biquad()); this.t = pair(() => new Biquad()); this.env = 0; this.upd(); }
  setParam(i, v) { this.p[i] = v; this.upd(); }
  upd() { const p = this.p, k = Math.pow(2, p[1] / 2); for (const c of [0, 1]) { this.h[c].highpass(this.sr, clamp(p[0] / k, 20, 18000), 0.707); this.l[c].lowpass(this.sr, clamp(p[0] * k, 40, 20000), 0.707); this.t[c].lowpass(this.sr, 800 * Math.pow(25, p[3]), 0.707); } }
  process(L, R, n) {
    const p = this.p, dv = 1 + p[2] * 40, dyn = p[4], mix = p[5], ec = 1 - coef(20, this.sr);
    for (let i = 0; i < n; i++) {
      const x = Math.max(Math.abs(L[i]), Math.abs(R[i])); this.env += (x - this.env) * ec;
      const g = dyn > 0 ? 1 + dyn * clamp(this.env * 4, 0, 1) : 1;                        // Dynamics: the output follows the input level instead of flattening it
      const yl = this.t[0].process(tanh(this.l[0].process(this.h[0].process(L[i])) * dv) * 0.5) * g, yr = this.t[1].process(tanh(this.l[1].process(this.h[1].process(R[i])) * dv) * 0.5) * g;
      L[i] = L[i] * (1 - mix) + yl * mix; R[i] = R[i] * (1 - mix) + yr * mix;
    }
  }
}

// ================================================================================================ Pedal
// 0 type (overdrive / distortion / fuzz) 1 gain 2 output dB 3 bass 4 mid 5 treble 6 mid freq (low / mid / high) 7 sub 8 dry/wet
export class Pedal extends Fx {
  constructor(sr) { super(sr); this.p = [0, 0.5, 0, 0, 0, 0, 1, 0, 1]; this.f = pair(() => [new Biquad(), new Biquad(), new Biquad(), new Biquad()]); this.upd(); }
  setParam(i, v) { this.p[i] = v; this.upd(); }
  upd() { const p = this.p; for (const c of [0, 1]) { const [a, b, m, t] = this.f[c]; a.highpass(this.sr, p[7] > 0.5 ? 20 : 90, 0.707); b.lowShelf(this.sr, 150, 0.7, p[3] * 12); m.peaking(this.sr, [500, 1000, 2000][clamp(Math.round(p[6]), 0, 2)], 0.9, p[4] * 12); t.highShelf(this.sr, 3000, 0.7, p[5] * 12); } }
  process(L, R, n) {
    const p = this.p, ty = Math.round(p[0]), g = 1 + p[1] * [20, 60, 150][clamp(ty, 0, 2)], out = dbToLin(p[2]) * 0.6, mix = p[8];
    const sh = ty === 0 ? (x) => tanh(x) : ty === 1 ? (x) => clamp(x * 1.2, -1, 1) : (x) => (x > 0 ? 1 - Math.exp(-x * 2) : -(1 - Math.exp(x * 1.2)) * 0.8);
    for (let i = 0; i < n; i++) {
      const run = (x, f) => f[3].process(f[2].process(f[1].process(sh(f[0].process(x) * g))));
      const yl = run(L[i], this.f[0]) * out, yr = run(R[i], this.f[1]) * out;
      L[i] = L[i] * (1 - mix) + yl * mix; R[i] = R[i] * (1 - mix) + yr * mix;
    }
  }
}

// ================================================================================================ Dynamic Tube
// 0 drive dB 1 bias 2 envelope 3 tube (A / B / C) 4 tone 5 attack ms 6 release ms 7 output dB 8 dry/wet
export class DynTube extends Fx {
  constructor(sr) { super(sr); this.p = [0, 0.5, 0, 0, 0.5, 10, 100, 0, 1]; this.t = pair(() => new Biquad()); this.env = 0; this.upd(); }
  setParam(i, v) { this.p[i] = v; this.upd(); }
  upd() { for (const c of [0, 1]) this.t[c].highShelf(this.sr, 2000, 0.7, (this.p[4] - 0.5) * 18); }
  process(L, R, n) {
    const p = this.p, dv = dbToLin(p[0]) * 2, tube = Math.round(p[3]), out = dbToLin(p[7]), mix = p[8], at = 1 - coef(p[5], this.sr), rl = 1 - coef(p[6], this.sr);
    for (let i = 0; i < n; i++) {
      const x = Math.max(Math.abs(L[i]), Math.abs(R[i])); this.env += (x - this.env) * (x > this.env ? at : rl);
      const bias = clamp(p[1] - 0.5 + p[2] * this.env * 2, -1, 1) * 0.6;              // Envelope: the bias follows the level (positive = more grit on loud parts)
      const sh = (v) => { const y = v * dv + bias; const z = tube === 0 ? tanh(y) - tanh(bias) : tube === 1 ? (y > 0 ? tanh(y) : tanh(y * 0.6) / 0.6) - tanh(bias) : y / (1 + Math.abs(y)) - bias / (1 + Math.abs(bias)); return z / Math.max(1, dv * 0.5); };
      const yl = this.t[0].process(sh(L[i])) * out, yr = this.t[1].process(sh(R[i])) * out;
      L[i] = L[i] * (1 - mix) + yl * mix; R[i] = R[i] * (1 - mix) + yr * mix;
    }
  }
}

// ================================================================================================ Multiband Dynamics
// 0 low split 1 high split; per band b (low, mid, high) at 2 + b * 9: on, input dB, output dB, thr above, ratio above, thr below, ratio below, attack ms, release ms;
// 29 amount 30 time 31 output dB 32 soft knee 33 RMS
export class MultibandDyn extends Fx {
  constructor(sr) {
    super(sr); this.p = [120, 2500]; for (let b = 0; b < 3; b++) this.p.push(1, 6, 0, -12, 4, -40, 1, 10, 100); this.p.push(1, 1, 0, 0, 0, 0, 0, 0);
    this.x = pair(() => [[new Biquad(), new Biquad()], [new Biquad(), new Biquad()], [new Biquad(), new Biquad()], [new Biquad(), new Biquad()]]); this.env = [0, 0, 0]; this.gr = [0, 0, 0]; this.lv = [0, 0, 0]; this.upd();
  }
  setParam(i, v) { this.p[i] = v; if (i < 2) this.upd(); }
  upd() { const lo = clamp(this.p[0], 20, 1000), hi = Math.max(lo * 1.5, clamp(this.p[1], 500, 16000)); for (const c of this.x) { c[0][0].lowpass(this.sr, lo, 0.7071); c[0][1].copy(c[0][0]); c[1][0].highpass(this.sr, lo, 0.7071); c[1][1].copy(c[1][0]); c[2][0].lowpass(this.sr, hi, 0.7071); c[2][1].copy(c[2][0]); c[3][0].highpass(this.sr, hi, 0.7071); c[3][1].copy(c[3][0]); } }
  process(L, R, n) {
    const p = this.p, amt = p[29], tm = p[30], out = dbToLin(p[31]), soft = p[32] > 0.5, rms = p[33] > 0.5, B = [];
    for (let b = 0; b < 3; b++) { const o = 2 + b * 9; B.push({ on: p[o] > 0.5, inG: dbToLin(p[o + 1]), outG: dbToLin(p[o + 2]), ta: p[o + 3], ra: 1 + (p[o + 4] - 1) * amt, tb: p[o + 5], rb: 1 + (p[o + 6] - 1) * amt, at: 1 - coef(p[o + 7] * tm, this.sr), rl: 1 - coef(p[o + 8] * tm, this.sr) }); }
    const pk = [0, 0, 0], solo = p[34] > 0.5 || p[35] > 0.5 || p[36] > 0.5;                // 34-36: band solo (Live's S buttons)
    for (let b = 0; b < 3; b++) if (solo && !(p[34 + b] > 0.5)) B[b].outG = 0;
    for (let i = 0; i < n; i++) {
      const bl = [], br = [];
      for (let c = 0; c < 2; c++) { const x = c ? R[i] : L[i], f = this.x[c], lo = f[0][1].process(f[0][0].process(x)), rest = f[1][1].process(f[1][0].process(x)), mid = f[2][1].process(f[2][0].process(rest)), hi = f[3][1].process(f[3][0].process(rest)); (c ? br : bl).push(lo, mid, hi); }
      let ol = 0, or = 0;
      for (let b = 0; b < 3; b++) {
        const s = B[b]; let l = bl[b] * s.inG, r = br[b] * s.inG;
        if (!s.on) { ol += l * s.outG; or += r * s.outG; continue; }
        const x = Math.max(Math.abs(l), Math.abs(r)), d = rms ? x * x : x; this.env[b] += (d - this.env[b]) * (d > this.env[b] ? s.at : s.rl);
        const lev = linToDb(rms ? Math.sqrt(this.env[b]) : this.env[b]); if (lev > pk[b]) pk[b] = lev;
        let gdb = 0; const kn = soft ? 6 : 0;
        if (lev > s.ta - kn) gdb = -(lev - s.ta) * (1 - 1 / s.ra) * (lev > s.ta + kn || !kn ? 1 : 0.5);        // above: downward compression (ratio < 1 = upward expansion)
        else if (lev < s.tb && lev > -90) gdb = -(s.tb - lev) * (s.rb - 1);                                      // below: ratio > 1 = downward expansion, < 1 = upward compression
        gdb = clamp(gdb, -60, Math.min(24, 6 - Math.max(lev, linToDb(x)))); this.gr[b] = gdb;                                               // upward gain never lifts the band above +6 dBFS
        const g = dbToLin(gdb) * s.outG; ol += l * g; or += r * g;
      }
      L[i] = ol * out; R[i] = or * out;
    }
    for (let b = 0; b < 3; b++) this.lv[b] = Math.max(pk[b] || -90, this.lv[b] - 1.5);
  }
  readOut(o) { for (let b = 0; b < 3; b++) { o[b * 2] = this.lv[b]; o[b * 2 + 1] = this.gr[b]; } return 6; }
}

// ================================================================================================ Resonators (five tuned comb resonators)
// 0 filter on 1 filter freq 2 filter type (LP / BP / HP / notch) 3 mode (A / B) 4 decay 5 const 6 color; I: 7 on 8 note 9 fine 10 gain; II-V at 11 + 4 * (k - 1): on, pitch st, fine, gain; 27 width 28 gain dB 29 dry/wet
export class Resonators extends Fx {
  constructor(sr) {
    super(sr); this.p = [1, 50, 2, 0, 0.77, 0, 0.857, 1, 43, 0, 0]; for (const st of [7, 7, 3, 12]) this.p.push(1, st, 0, 0); this.p.push(1, 0, 0.49);
    const N = 1 << Math.ceil(Math.log2(sr / 20 + 4)); this.N = N - 1; this.b = [0, 1, 2, 3, 4].map(() => new Float32Array(N)); this.lp = new Float64Array(5); this.w = 0; this.in = pair(() => new Biquad()); this.upd();
  }
  setParam(i, v) { this.p[i] = v; if (i <= 2) this.upd(); }
  upd() { for (const c of [0, 1]) { const f = this.in[c], t = Math.round(this.p[2]); if (t === 0) f.lowpass(this.sr, this.p[1], 0.7); else if (t === 1) f.bandpass(this.sr, this.p[1], 0.7); else if (t === 2) f.highpass(this.sr, this.p[1], 0.7); else f.notch(this.sr, this.p[1], 0.7); } }
  process(L, R, n) {
    const p = this.p, fon = p[0] > 0.5, modeB = Math.round(p[3]) === 1, col = 0.15 + p[6] * 0.85, cst = p[5] > 0.5, wid = p[27], g = dbToLin(p[28]) * 0.25, mix = p[29];
    const V = [];
    for (let k = 0; k < 5; k++) {
      const o = k === 0 ? 7 : 11 + (k - 1) * 4, on = p[o] > 0.5, midi = k === 0 ? p[8] + p[9] / 100 : p[8] + p[o + 1] + p[o + 2] / 100, hz = 440 * Math.pow(2, (midi - 69) / 12) * (modeB ? 0.5 : 1);
      const d = clamp(this.sr / hz, 2, this.N - 2), T60 = 0.05 + Math.pow(p[4], 2) * 8, fbk = cst ? Math.exp(-6.9 * (d / this.sr) / T60) : 0.9 + p[4] * 0.099;
      V.push({ on, d, fb: modeB ? -fbk : fbk, gain: dbToLin(k === 0 ? p[10] : p[o + 3]), pan: k === 0 ? 0 : (k % 2 ? -1 : 1) * wid * (k < 3 ? 0.5 : 1) });
    }
    for (let i = 0; i < n; i++) {
      let xl = L[i], xr = R[i]; if (fon) { xl = this.in[0].process(xl); xr = this.in[1].process(xr); }
      const x = (xl + xr) * 0.5; let ol = 0, or = 0;
      for (let k = 0; k < 5; k++) {
        const v = V[k]; if (!v.on) continue; const buf = this.b[k];
        const y = rd(buf, this.N, this.w, v.d); this.lp[k] += (y - this.lp[k]) * col; buf[this.w & this.N] = x + this.lp[k] * v.fb;
        const out = y * v.gain; ol += out * (1 - Math.max(0, v.pan)); or += out * (1 + Math.min(0, v.pan));
      }
      this.w++;
      L[i] = L[i] * (1 - mix) + ol * g * mix; R[i] = R[i] * (1 - mix) + or * g * mix;
    }
  }
}

// ================================================================================================ Corpus (modal resonator bank)
// 0 type 1 quality 2 decay 3 material 4 bright 5 inharm 6 ratio 7 hit 8 width 9 pos L 10 pos R 11 tune Hz 12 fine 13 spread 14 LFO on 15 LFO amount
// 16 LFO rate 17 filter on 18 filter freq 19 filter bandwidth 20 bleed 21 gain dB 22 dry/wet
const CORPUS = [[1, 2.756, 5.404, 8.933, 13.34, 18.64, 24.81, 31.87, 39.8, 48.6, 58.3, 68.9],          // beam
  [1, 3.932, 9.538, 16.81, 25.66, 36.1, 48.1, 61.8, 77, 94, 112, 132],                                      // marimba
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],                                                                  // string
  [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501, 3.6, 4.06, 4.15, 4.6],                              // membrane
  [1, 2.5, 4, 5, 6.5, 8, 9, 10, 12.5, 13, 16, 17],                                                         // plate
  [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23],                                                             // pipe (closed)
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]];                                                                // tube (open)
const CORPUS_SYNC = [1 / 16, 1 / 8, 1 / 4, 3 / 8, 1 / 2, 1, 2, 4];   // note values (1/2 = half note) -> bars
function lfoWave(sh, x, rn) { x -= Math.floor(x); switch (Math.round(sh)) { case 1: return x < 0.5 ? 1 : -1; case 2: return 1 - 4 * Math.abs(x - 0.5); case 3: return 2 * x - 1; case 4: return 1 - 2 * x; case 5: return rn; default: return Math.sin(TWO_PI * x); } }
export class Corpus extends Fx {
  constructor(sr) {
    super(sr); this.p = [3, 1, 0.5, 0.84, 0, 0, 0.5, 0.5, 1, 0.47, 0.82, 65.41, 0, 0, 0, 0.5, 0.5, 0, 1000, 4, 0, -0.5, 1];
    this.p.push(0, 0, 4, 0, 0); this.m = []; this.ph = 0; this.sh = [0, 0]; this.rnd = { seed: 7 }; this.in = pair(() => new Biquad()); this.cnt = 0; this.upd();
  }
  setParam(i, v) { this.p[i] = v; this.upd(); }
  upd() {
    const p = this.p, ty = clamp(Math.round(p[0]), 0, 6), nm = [4, 8, 12][clamp(Math.round(p[1]), 0, 2)], base = p[11] * Math.pow(2, p[12] / 1200), rat = CORPUS[ty];
    this.m = [];
    for (let k = 0; k < nm; k++) {
      const r = rat[k] * Math.max(0.3, 1 + p[5] * 0.03 * k * k) * (ty === 3 || ty === 4 ? 1 + (p[6] - 0.5) * 0.3 * (k % 2) : 1), f = base * r;   // Inharm stretches (or squeezes) the upper modes
      if (f > this.sr * 0.45) break;
      const T = (0.05 + p[2] * p[2] * 6) * Math.pow(r, -(0.25 + p[3] * 0.75 + 0.25)) , rr = Math.exp(-6.9 / (T * this.sr));
      const amp = Math.abs(Math.sin(Math.PI * (k + 1) * (0.05 + p[7] * 0.9))) * Math.pow(r, p[4] * 0.8 - 0.4);
      const aL = Math.sin(Math.PI * (k + 1) * (0.05 + p[9] * 0.9)), aR = Math.sin(Math.PI * (k + 1) * (0.05 + p[10] * 0.9));
      this.m.push({ f, rr, amp: amp * (1 - rr) * 2, aL, aR, s1: [0, 0], s2: [0, 0], fs: f * (1 + p[13] * 0.02) });   // (1 - r): every mode peaks near unity whatever its decay
    }
    for (const c of [0, 1]) this.in[c].bandpass(this.sr, p[18], 1 / Math.max(0.1, p[19]));
    this.dirty = true;
  }
  coefs(lfo) { for (const md of this.m) for (const c of [0, 1]) { const f = (c ? md.fs : md.f) * (1 + lfo[c]), w = TWO_PI * f / this.sr; md['c' + c] = 2 * md.rr * Math.cos(w); } this.dirty = false; }
  process(L, R, n) {
    const p = this.p, lfoOn = p[14] > 0.5, wid = p[8], g = dbToLin(p[21]) * 0.5, mix = p[22], bleed = p[20], fon = p[17] > 0.5;
    if (lfoOn) {                                    // 23 shape 24 sync 25 sync rate 26 phase (R against L) 27 offset
      const hz = p[24] > 0.5 ? this.bpm / 60 / (CORPUS_SYNC[clamp(Math.round(p[25]), 0, 7)] * 4) : p[16];
      this.ph += hz * n / this.sr; if (this.ph >= 1) { this.ph -= Math.floor(this.ph); this.sh = [rnd01(this.rnd) * 2 - 1, rnd01(this.rnd) * 2 - 1]; }
      const a = p[15] * 0.12, o = p[27] / 360; this.coefs([lfoWave(p[23], this.ph + o, this.sh[0]) * a, lfoWave(p[23], this.ph + o + p[26] / 360, this.sh[1]) * a]);
    } else if (this.dirty) this.coefs([0, 0]);
    for (let i = 0; i < n; i++) {
      let x = (L[i] + R[i]) * 0.5; if (fon) x = this.in[0].process(x);
      let ol = 0, or = 0;
      for (const md of this.m) {
        for (let c = 0; c < 2; c++) { const y = md['c' + c] * md.s1[c] - md.rr * md.rr * md.s2[c] + x * md.amp; md.s2[c] = md.s1[c]; md.s1[c] = y; }
        ol += md.s1[0] * md.aL; or += md.s1[1] * md.aR;
      }
      const m = (ol + or) * 0.5, s = (ol - or) * 0.5 * wid; ol = (m + s) * g; or = (m - s) * g;
      L[i] = L[i] * (1 - mix) + (ol + x * bleed) * mix; R[i] = R[i] * (1 - mix) + (or + x * bleed) * mix;
    }
  }
}

// ================================================================================================ Vocoder (carrier: noise / modulator / pitch tracking)
// 0 carrier 1 enhance 2 unvoiced dB 3 sensitivity 4 fast 5 bands 6 range low 7 range high 8 bandwidth 9 gate dB 10 level dB 11 precise 12 depth
// 13 attack ms 14 release ms 15 output (mono / stereo / L-R) 16 formant 17 dry/wet
const VOC_BANDS = [4, 8, 12, 16, 20, 24, 32, 40];
export class Vocoder extends Fx {
  constructor(sr) { super(sr); this.p = [0, 0, -60, 0.5, 0, 4, 80, 12000, 1, -60, 0, 0, 1, 1, 150, 1, 0, 1, 1, 0]; this.hold = 0; this.nz = 0; this.rnd = { seed: 3 }; this.ph = 0; this.zc = 0; this.last = 0; this.period = 200; this.cntZ = 0; this.lv = new Float32Array(40); this.zr = 0; this.uv = 0; this.upd(); }
  setParam(i, v) { this.p[i] = v; if (i >= 5 && i <= 8 || i === 11 || i === 16) this.upd(); }
  upd() {
    const p = this.p, nb = VOC_BANDS[clamp(Math.round(p[5]), 0, 7)], lo = clamp(p[6], 20, 2000), hi = Math.max(lo * 2, clamp(p[7], 500, 18000)), q = (p[11] > 0.5 ? 9 : 4) / Math.max(0.1, p[8]) * nb / 20;
    this.B = [];
    for (let b = 0; b < nb; b++) { const f = lo * Math.pow(hi / lo, (b + 0.5) / nb), fc = clamp(f * Math.pow(2, p[16]), 20, 20000); const m = new Biquad(), c1 = new Biquad(), c2 = new Biquad(); m.bandpass(this.sr, f, q); c1.bandpass(this.sr, fc, q); c2.bandpass(this.sr, fc, q); this.B.push({ m, c: [c1, c2], e: 0 }); }
  }
  process(L, R, n) {
    const p = this.p, car = Math.round(p[0]), enh = p[1] > 0.5, unv = p[2] <= -60 ? 0 : dbToLin(p[2]), gate = dbToLin(p[9]), lvl = dbToLin(p[10]) * 3, dep = p[12], at = 1 - coef(p[13], this.sr), rl = 1 - coef(p[14], this.sr), mode = Math.round(p[15]), mix = p[17];
    const nb = this.B.length;
    for (let i = 0; i < n; i++) {
      const mod = (L[i] + R[i]) * 0.5;
      if ((mod >= 0) !== (this.last >= 0) && mod >= 0) { if (this.cntZ > 20) this.period += (this.cntZ - this.period) * 0.2; this.cntZ = 0; } this.cntZ++; this.last = mod;
      let carrier;
      if (car === 0) {                              // 18 noise rate (sample-and-hold), 19 crackle (sparse impulses)
        if (--this.hold <= 0) { this.hold = 1 + Math.round(Math.pow(1 - p[18], 2) * 63); this.nz = rnd01(this.rnd) * 2 - 1; if (p[19] > 0 && rnd01(this.rnd) < p[19] * 0.97) this.nz = 0; else if (p[19] > 0) this.nz /= Math.sqrt(1 - p[19] * 0.97); }
        carrier = this.nz;
      }
      else if (car === 1) carrier = mod;
      else { this.ph += 1 / Math.max(8, this.period); if (this.ph >= 1) this.ph -= 1; carrier = 2 * this.ph - 1; }
      const noise = rnd01(this.rnd) * 2 - 1;
      this.zr += (((mod >= 0) !== (this.last2 >= 0) ? 1 : 0) - this.zr) * 0.002; this.last2 = mod;                    // zero-crossing rate: high for s / sh / t (unvoiced)
      const uT = clamp((this.zr - (1 - p[3]) * 0.35) / 0.08, 0, 1); this.uv += (uT - this.uv) * (p[4] > 0.5 ? 0.02 : 0.0015);   // Sens. = how easily a sound counts as unvoiced, Fast = quicker switch
      let ol = 0, or = 0, tot = 0;
      for (let b = 0; b < nb; b++) {
        const B = this.B[b], m = Math.abs(B.m.process(mod)); B.e += (m - B.e) * (m > B.e ? at : rl);
        let e = B.e < gate * 0.1 ? 0 : B.e; tot += e;
        e = dep * e + (1 - dep) * 0.05;
        const c = B.c[0].process(carrier), cn = B.c[1].process(noise) * unv * this.uv * (b > nb * 0.6 ? 1 : 0.3);
        const y = (c + cn) * e * (enh ? 1 / Math.max(0.02, Math.sqrt(B.e + 1e-4)) * 0.2 : 1) * lvl * 30;
        if (mode === 2) { if (b % 2) or += y; else ol += y; } else { ol += y; or += y * (mode === 1 ? (b % 2 ? 0.8 : 1.2) : 1); }
        if ((i & 63) === 0) this.lv[b] = Math.max(B.e, this.lv[b] * 0.97);
      }
      void tot;
      L[i] = L[i] * (1 - mix) + clamp(ol, -4, 4) * mix; R[i] = R[i] * (1 - mix) + clamp(or, -4, 4) * mix;
    }
  }
  readOut(o) { const nb = this.B.length; for (let b = 0; b < nb; b++) o[b] = linToDb(this.lv[b]); return nb; }
}

// ================================================================================================ Shifter (pitch / frequency / ring)
// 0 mode 1 pitch st 2 fine ct 3 freq Hz 4 window ms 5 spread 6 feedback 7 tone Hz 8 dry/wet
class Hilbert {                                   // 90-degree phase-difference network (two all-pass chains)
  constructor() { this.a = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737]; this.b = [0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278]; this.za = new Float64Array(8); this.zb = new Float64Array(8); this.d = 0; }
  run(x) {
    let y = x; for (let k = 0; k < 4; k++) { const c = this.a[k] * this.a[k], o = c * (y - this.za[k * 2 + 1]) + this.za[k * 2]; this.za[k * 2] = y; this.za[k * 2 + 1] = o; y = o; }
    let z = x; for (let k = 0; k < 4; k++) { const c = this.b[k] * this.b[k], o = c * (z - this.zb[k * 2 + 1]) + this.zb[k * 2]; this.zb[k * 2] = z; this.zb[k * 2 + 1] = o; z = o; }
    const re = y, im = this.d; this.d = z; return [re, im];
  }
}
export class Shifter extends Fx {
  constructor(sr) { super(sr); this.p = [0, 7, 0, 100, 60, 0, 0, 20000, 1]; const N = 1 << Math.ceil(Math.log2(sr * 0.5)); this.b = pair(() => new Float32Array(N)); this.M = N - 1; this.w = 0; this.ph = [0, 0]; this.oph = 0; this.h = pair(() => new Hilbert()); this.t = pair(() => new Biquad()); this.fb = [0, 0]; this.upd(); }
  setParam(i, v) { this.p[i] = v; if (i === 7) this.upd(); }
  upd() { for (const c of [0, 1]) this.t[c].lowpass(this.sr, this.p[7], 0.707); }
  process(L, R, n) {
    const p = this.p, mode = Math.round(p[0]), mix = p[8], fbk = clamp(p[6], 0, 0.9), win = clamp(p[4], 10, 300) * 0.001 * this.sr, sp = p[5];
    for (let i = 0; i < n; i++) {
      const out = [0, 0];
      for (let c = 0; c < 2; c++) {
        const x = (c ? R[i] : L[i]) + this.fb[c] * fbk, sgn = c ? 1 : -1; let y;
        if (mode === 0) {
          const ratio = Math.pow(2, (p[1] + p[2] / 100 + sgn * sp * 0.25) / 12), step = (1 - ratio) / win;
          this.b[c][this.w & this.M] = x; this.ph[c] += step; this.ph[c] -= Math.floor(this.ph[c]);
          const d1 = this.ph[c] * win + 2, d2 = ((this.ph[c] + 0.5) % 1) * win + 2, g1 = Math.sin(Math.PI * this.ph[c]), g2 = Math.sin(Math.PI * ((this.ph[c] + 0.5) % 1));
          y = rd(this.b[c], this.M, this.w, d1) * g1 + rd(this.b[c], this.M, this.w, d2) * g2;
        } else {
          const f = p[3] + sgn * sp * 20, [re, im] = this.h[c].run(x), a = this.oph * (c ? 1 : 1) + (c ? sp * 1.5 : 0);
          y = mode === 1 ? re * Math.cos(a) - im * Math.sin(a) : x * Math.cos(a);
          if (c === 1) { this.oph += TWO_PI * (mode === 1 ? f : Math.abs(f)) / this.sr; if (this.oph > 1e4) this.oph -= TWO_PI * Math.floor(this.oph / TWO_PI); }
        }
        y = this.t[c].process(y); this.fb[c] = y; out[c] = y;
      }
      this.w++;
      L[i] = L[i] * (1 - mix) + out[0] * mix; R[i] = R[i] * (1 - mix) + out[1] * mix;
    }
  }
}

// ================================================================================================ Grain Delay
// 0 sync 1 16th 2 delay ms 3 spray ms 4 frequency Hz (grain rate) 5 pitch st 6 random pitch 7 feedback 8 dry/wet
const SIXT = [1, 2, 3, 4, 5, 6, 8, 16];
export class GrainDelay extends Fx {
  constructor(sr) {
    super(sr); this.p = [0, 3, 100, 15, 4, 0, 0, 0, 0.5]; const N = 1 << Math.ceil(Math.log2(sr * 2.5)); this.b = pair(() => new Float32Array(N)); this.M = N - 1; this.w = 0; this.rnd = { seed: 17 };
    this.g = [0, 1].map(() => ({ pos: 0, rate: 1, age: 0, len: 1 })); this.cnt = 0; this.fb = [0, 0];
  }
  setParam(i, v) { this.p[i] = v; }
  process(L, R, n) {
    const p = this.p, s16 = 60 / this.bpm / 4, base = (p[0] > 0.5 ? SIXT[clamp(Math.round(p[1]), 0, 7)] * s16 : p[2] / 1000) * this.sr, hz = clamp(p[4], 1, 150), period = this.sr / hz, mix = p[8], fbk = clamp(p[7], 0, 0.95);
    for (let i = 0; i < n; i++) {
      if (--this.cnt <= 0) {                     // start a new grain on the free head (two overlapping heads, Hann windows)
        this.cnt = period / 2; const gr = this.g[0].age >= this.g[0].len ? this.g[0] : this.g[1];
        const rp = (rnd01(this.rnd) * 2 - 1) * p[6] * 12; gr.rate = Math.pow(2, (p[5] + rp) / 12); gr.len = period; gr.age = 0;
        gr.pos = clamp(base + rnd01(this.rnd) * p[3] / 1000 * this.sr, 2, this.M - period * 4);
      }
      const out = [0, 0];
      for (const gr of this.g) {
        if (gr.age >= gr.len) continue; const w = Math.sin(Math.PI * gr.age / gr.len), d = gr.pos - gr.age * (gr.rate - 1);
        for (let c = 0; c < 2; c++) out[c] += rd(this.b[c], this.M, this.w, clamp(d, 2, this.M - 2)) * w;
        gr.age++;
      }
      for (let c = 0; c < 2; c++) { this.b[c][this.w & this.M] = (c ? R[i] : L[i]) + out[c] * fbk; }
      this.w++;
      L[i] = L[i] * (1 - mix) + out[0] * mix; R[i] = R[i] * (1 - mix) + out[1] * mix;
    }
  }
}

// ================================================================================================ Hybrid Reverb (early-reflection "IR" network + algorithmic FDN tail)
// 0 send dB 1 predelay ms 2 predelay feedback 3 routing (serial / parallel / algorithm / IR) 4 blend 5 IR (hall / room / plate / spring / chamber) 6 IR decay
// 7 IR size 8 algorithm (dark hall / quartz / shimmer / tides / prism) 9 decay s 10 size 11 damping 12 diffusion 13 modulation 14 freeze 15 EQ on 16 low cut 17 high cut
// 18 stereo 19 vintage (off / subtle / old / older / extreme) 20 bass mono 21 dry/wet
const ER = [[7, 11, 17, 23, 31, 41, 53, 67, 79, 97, 113, 131], [3, 5, 8, 11, 13, 17, 19, 23, 29, 31, 37, 41], [1, 2, 3, 5, 7, 9, 12, 15, 18, 22, 26, 31], [11, 22, 33, 44, 55, 66, 77, 88, 99, 110, 121, 132], [5, 9, 14, 20, 27, 35, 44, 54, 65, 77, 90, 104]];
export class HybridReverb extends Fx {
  constructor(sr) {
    super(sr); this.p = [0, 10, 0, 0, 0.6, 0, 0.6, 0.6, 0, 3.5, 0.5, 0.5, 0.7, 0.5, 0, 0, 20, 20000, 1, 0, 0, 0.3];
    const N = 1 << Math.ceil(Math.log2(sr * 1.2)); this.pre = new Float32Array(N); this.pm = N - 1; this.pw = 0;
    this.er = pair(() => new Float32Array(1 << 15)); this.em = (1 << 15) - 1; this.ew = 0;
    this.len = [1031, 1327, 1523, 1801, 2053, 2311, 2633, 2969].map((l) => Math.round(l * sr / 44100)); this.fd = this.len.map((l) => new Float32Array(1 << Math.ceil(Math.log2(l * 2.2 + 64)))); this.fw = 0; this.lp = new Float64Array(8); this.ph = 0;
    this.ap = [0, 1, 2, 3].map(() => ({ b: new Float32Array(1024), w: 0 })); this.sh = 0; this.shB = new Float32Array(1 << 13); this.vh = [0, 0]; this.vc = 0;
    this.eq = pair(() => [new Biquad(), new Biquad()]); this.bm = pair(() => new Biquad()); this.upd();
  }
  setParam(i, v) { this.p[i] = v; this.upd(); }
  upd() { const p = this.p; for (const c of [0, 1]) { this.eq[c][0].highpass(this.sr, p[16], 0.707); this.eq[c][1].lowpass(this.sr, p[17], 0.707); this.bm[c].highpass(this.sr, 200, 0.707); } }
  process(L, R, n) {
    const p = this.p, send = p[0] <= -60 ? 0 : dbToLin(p[0]), pd = clamp(p[1], 0, 1000) * 0.001 * this.sr, pfb = clamp(p[2], 0, 0.9), route = Math.round(p[3]), blend = p[4], ir = ER[clamp(Math.round(p[5]), 0, 4)];
    const irD = p[6], irS = 0.3 + p[7] * 1.7, alg = Math.round(p[8]), frz = p[14] > 0.5, mix = p[21], st = p[18], vint = Math.round(p[19]), eqOn = p[15] > 0.5;
    const sizeK = 0.5 + p[10] * 1.5, g = frz ? 1 : Math.pow(10, -3 * (this.len[4] * sizeK / this.sr) / Math.max(0.2, p[9])), damp = frz ? 0 : clamp((0.05 + p[11] * 0.7) * [1.35, 0.5, 1, 1, 0.3][clamp(alg, 0, 4)], 0, 0.95), dif = clamp(0.3 + p[12] * 0.45 + [0, 0.12, 0, 0, -0.12][clamp(alg, 0, 4)], 0.1, 0.85), md = p[13] * (alg === 3 ? 30 : 8), nm = alg === 4 ? 8 : 2;   // Dark Hall darker, Quartz bright + dense, Prism bright, every line modulated
    for (let i = 0; i < n; i++) {
      const xin = frz ? 0 : (L[i] + R[i]) * 0.5 * send;
      const pdo = pd > 1 ? rd(this.pre, this.pm, this.pw, pd) : xin; this.pre[this.pw & this.pm] = xin + pdo * pfb; this.pw++;
      // early reflections ("IR"): taps spread by size, decaying, alternating sides
      this.er[0][this.ew & this.em] = pdo; this.er[1][this.ew & this.em] = pdo;
      let el = 0, er = 0; for (let k = 0; k < 12; k++) { const d = Math.round(ir[k] * irS * this.sr / 1000) + 1, a = Math.pow(0.35 + irD * 0.6, k / 3); const v = this.er[0][(this.ew - d) & this.em] * a * (k % 3 === 0 ? -1 : 1); if (k % 2) er += v; else el += v; }
      this.ew++;
      // diffusion all-passes, then the 8-line FDN (Householder) with damping and modulation
      let x = route === 0 ? (el + er) * 0.5 : pdo;
      for (let k = 0; k < 4; k++) { const a = this.ap[k], d = [142, 107, 379, 277][k], y = a.b[(a.w - d) & 1023]; const u = x + y * dif; a.b[a.w & 1023] = u; a.w++; x = y - u * dif; }
      this.ph += TWO_PI * (alg === 3 ? 0.3 : 0.8) / this.sr; if (this.ph > TWO_PI) this.ph -= TWO_PI;
      const o = this.o || (this.o = new Float64Array(8)); let sum = 0;
      for (let k = 0; k < 8; k++) { const buf = this.fd[k], M = buf.length - 1, d = this.len[k] * sizeK + (k < nm ? Math.sin(this.ph + k) * md : 0); o[k] = rd(buf, M, this.fw, clamp(d, 2, M - 2)); this.lp[k] += (o[k] - this.lp[k]) * (1 - damp); o[k] = this.lp[k]; sum += o[k]; }
      const hh = sum * 0.25;
      if (alg === 2) { this.shB[this.sh & 8191] = hh; this.sh++; }                                // shimmer: an octave-up copy is fed back
      const shim = alg === 2 ? (this.shB[(this.sh - 1 - ((this.sh * 0.5) % 2048 | 0)) & 8191] * 0.25) : 0;
      for (let k = 0; k < 8; k++) { const buf = this.fd[k], M = buf.length - 1; buf[this.fw & M] = (o[k] - hh) * g + x * (k % 2 ? 0.35 : -0.35) + shim * (alg === 4 ? (k % 2 ? 1 : -1) : 1); }
      this.fw++;
      let al = o[0] + o[2] + o[4] + o[6], ar = o[1] + o[3] + o[5] + o[7]; al *= 0.5; ar *= 0.5;
      let wl, wr;
      if (route === 2) { wl = al; wr = ar; } else if (route === 3) { wl = el; wr = er; } else { wl = el * (1 - blend) + al * blend; wr = er * (1 - blend) + ar * blend; }
      if (vint > 0) { if (++this.vc >= [1, 2, 3, 4, 6][vint]) { this.vc = 0; this.vh[0] = wl; this.vh[1] = wr; } wl = this.vh[0]; wr = this.vh[1]; }
      if (eqOn) { wl = this.eq[0][1].process(this.eq[0][0].process(wl)); wr = this.eq[1][1].process(this.eq[1][0].process(wr)); }
      const m = (wl + wr) * 0.5; let s = (wl - wr) * 0.5 * st; if (p[20] > 0.5) s = this.bm[0].process(s);
      wl = m + s; wr = m - s;
      L[i] = L[i] * (1 - mix) + wl * mix * 1.2; R[i] = R[i] * (1 - mix) + wr * mix * 1.2;
    }
  }
}

// ================================================================================================ Looper
// 0 state (stop / record / play / overdub) 1 length (free / 1 / 2 / 4 / 8 / 16 bars) 2 speed st 3 reverse 4 feedback 5 monitor (always / never / rec-ovr / rec-ovr-stop) 6 clear 7 volume dB
export class Looper extends Fx {
  constructor(sr) { super(sr); this.p = [0, 0, 0, 0, 1, 0, 0, 0]; this.N = sr * 32; this.bl = new Float32Array(this.N); this.br = new Float32Array(this.N); this.len = 0; this.rec = 0; this.pos = 0; this.st = 0; this.clr = 0; }
  setParam(i, v) {
    this.p[i] = v;
    if (i === 0) { const s = Math.round(v); if (s === 1 && this.st !== 1) { this.len = 0; this.rec = 0; this.pos = 0; } if (s !== 1 && this.st === 1) this.close(); this.st = s; }
    if (i === 6 && v !== this.clr) { this.clr = v; this.len = 0; this.rec = 0; this.bl.fill(0); this.br.fill(0); }
  }
  close() { const bars = [0, 1, 2, 4, 8, 16][clamp(Math.round(this.p[1]), 0, 5)]; this.len = bars ? Math.min(this.N, Math.round(bars * 4 * 60 / this.bpm * this.sr)) : Math.max(64, this.rec); this.pos = 0; }
  process(L, R, n) {
    const p = this.p, st = this.st, rate = Math.pow(2, p[2] / 12) * (p[3] > 0.5 ? -1 : 1), fb = p[4], vol = dbToLin(p[7]), mon = Math.round(p[5]);
    const dry = mon === 0 || ((mon === 2 || mon === 3) && (st === 1 || st === 3)) || (mon === 3 && st === 0) ? 1 : 0;
    for (let i = 0; i < n; i++) {
      let ol = 0, or = 0;
      if (st === 1) { if (this.rec < this.N) { this.bl[this.rec] = L[i]; this.br[this.rec] = R[i]; this.rec++; } if (this.p[1] > 0.5 && this.len === 0) { const bars = [0, 1, 2, 4, 8, 16][Math.round(this.p[1])]; if (this.rec >= bars * 4 * 60 / this.bpm * this.sr) { this.close(); this.st = 3; } } }
      else if ((st === 2 || st === 3) && this.len > 0) {
        const j = Math.floor(this.pos), k = ((j % this.len) + this.len) % this.len; ol = this.bl[k] * vol; or = this.br[k] * vol;
        if (st === 3) { this.bl[k] = this.bl[k] * fb + L[i]; this.br[k] = this.br[k] * fb + R[i]; }
        this.pos += rate; if (this.pos >= this.len) this.pos -= this.len; if (this.pos < 0) this.pos += this.len;
      }
      L[i] = L[i] * dry + ol; R[i] = R[i] * dry + or;
    }
  }
  readOut(o) { o[0] = this.st; o[1] = this.len / this.sr; o[2] = this.len ? this.pos / this.len : 0; o[3] = this.rec / this.sr; return 4; }
}
