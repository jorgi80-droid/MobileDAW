// Live 12 physical-model instruments: Electric (electric piano: hammer -> tine + tone bar -> pickup), Tension (string: exciter -> waveguide
// string with damping / inharmonicity, optional finger termination, pickup position) and Collision (mallet + noise exciters into a bank
// of modal resonators: beam, marimba, string, membrane, plate, pipe, tube). Types 25..27; parameter indices: defs.js INSTRUMENTS[25..27].
// Noise is a seeded LCG, so renders repeat exactly.
import { TWO_PI, clamp, midiToHz, lcg } from './dsp.js';

const dbl = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));
const nz = (o) => lcg(o) / 2147483648 - 1;
const t60 = (sec, sr) => Math.exp(-6.91 / Math.max(1, sec * sr));          // per-sample gain for a 60 dB decay in sec

class Poly {
  constructor(sr, n, nv = 8) { this.sr = sr; this.n = n; this.p = new Array(n).fill(0); this.v = []; this.nv = nv; this.rng = { seed: 777 + n }; }
  setParam(i, x) { if (i >= 0 && i < this.n) this.p[i] = x; }
  setTempo() {}
  active() { return this.v.length > 0; }
  noteOn(pitch, vel) { if (this.v.length >= this.nv) this.v.shift(); const v = this.voice(pitch, vel); v.pitch = pitch; v.vel = vel; v.on = true; v.t = 0; v.amp = 1; this.v.push(v); }
  noteOff(pitch) { for (const v of this.v) if (v.pitch === pitch && v.on) v.on = false; }
  allOff() { for (const v of this.v) v.on = false; }
  render(L, R, from, to) {
    const vol = dbl(this.p[this.n - 1]), dt = 1 / this.sr, rel = this.relGain();
    for (let j = this.v.length - 1; j >= 0; j--) {
      const v = this.v[j]; let peak = 0;
      for (let i = from; i < to; i++) { const x = this.tick(v, dt) * v.amp * vol; if (!v.on) v.amp *= rel; L[i] += x * (v.pl ?? 1); R[i] += x * (v.pr ?? 1); v.t += dt; const a = Math.abs(x); if (a > peak) peak = a; }
      if ((v.t > 0.05 && peak < 1e-5) || v.amp < 1e-5 || v.t > 30) this.v.splice(j, 1);
    }
  }
  relGain() { return t60(0.3, this.sr); }
}

// ---------------------------------------------------------------------------------------------- Electric
// 0 Stiffness, 1 Noise, 2 Tine, 3 Tone, 4 Symmetry, 5 Pickup Type (R / W), 6 Stiff < Vel, 7 Force, 8 Force < Vel, 9 Noise Pitch,
// 10 Noise Decay, 11 Damper (release), 12 Volume
export class Electric extends Poly {
  constructor(sr) { super(sr, 13); }
  relGain() { return t60(0.02 + this.p[11] * 2, this.sr); }
  voice(pitch, vel) {
    const p = this.p, f = midiToHz(pitch), key = (pitch - 60) / 48;
    const stiff = clamp(p[0] + (vel - 0.5) * p[6], 0, 1), force = (0.3 + 0.7 * p[7]) * clamp(1 + (vel - 0.5) * 2 * p[8], 0.1, 2);
    const v = { f, ph: 0, ph2: 0, ph3: 0, force, stiff, lp: 0, nl: 0,
      gT: t60((0.4 + p[2] * 3.5) * (1 - key * 0.6), this.sr), gB: t60((1 + p[3] * 6) * (1 - key * 0.5), this.sr), gO: t60(0.05 + 0.25 * (1 - stiff), this.sr),
      eT: 1, eB: 1, eO: 1, eN: 1, gN: t60(0.004 + p[10] * 0.08, this.sr), nc: 1 - Math.exp(-TWO_PI * (300 + p[9] * p[9] * 9000) / this.sr) };
    return v;
  }
  tick(v, dt) {
    const p = this.p;
    v.ph += v.f * dt; v.ph2 += v.f * 7.11 * dt; v.ph3 += v.f * 0.5 * dt;
    v.eT *= v.gT; v.eB *= v.gB; v.eO *= v.gO; v.eN *= v.gN;
    const tine = Math.sin(TWO_PI * v.ph) * v.eT * (0.3 + p[2] * 0.7), bar = Math.sin(TWO_PI * v.ph) * v.eB * p[3] * 0.6 + Math.sin(TWO_PI * v.ph3) * v.eB * p[3] * 0.15;
    const over = Math.sin(TWO_PI * v.ph2) * v.eO * v.stiff * 0.7;
    v.nl += (nz(this.rng) - v.nl) * v.nc; const noise = v.nl * v.eN * p[1] * 0.8;
    let x = (tine + bar + over) * v.force + noise * v.force;
    const s = p[4] * 2 - 1;                                                       // pickup: the tine's offset from the pickup = asymmetry
    x = Math.round(p[5]) === 0 ? Math.tanh(x * 1.6 + s * x * x) * 0.6 : (x + s * 0.7 * x * Math.abs(x) + 0.25 * x * x * x) * 0.5;
    return x;
  }
}

// ---------------------------------------------------------------------------------------------- Tension
// 0 Exciter (Bow / Hammer / Plectrum), 1 Protrusion, 2 Stiffness, 3 Velocity, 4 Position, 5 Exc Damping, 6 Decay, 7 Ratio, 8 Inharm,
// 9 Damping, 10 Termination, 11 Finger Mass, 12 Finger Stiff, 13 Fret Stiff, 14 Pickup, 15 Pickup Position, 16 Volume
export class Tension extends Poly {
  constructor(sr) { super(sr, 17); }
  relGain() { return t60(0.15, this.sr); }
  voice(pitch, vel) {
    const p = this.p, sr = this.sr, f = midiToHz(pitch), N = Math.max(4, sr / f), size = 1 << Math.ceil(Math.log2(N + 8));
    const v = { f, N, buf: new Float32Array(size), M: size - 1, w: 0, lp: 0, ap: 0, apx: 0, fm: 0, ex: 0, exl: 0,
      loss: t60(0.2 + p[6] * 8, sr) ** (N), damp: 0.05 + (1 - p[9]) * 0.9, inh: -p[8] * 0.6, tlp: 0 };
    // excitation shape written into the string (Plectrum / Hammer); the bow keeps exciting while the key is held
    const ty = Math.round(p[0]), len = Math.max(2, Math.round(N * (0.05 + p[1] * 0.45))), amp = (0.4 + p[3] * 1.2) * (0.4 + 0.6 * vel), sm = 0.1 + (1 - p[5]) * 0.9;
    let y = 0;
    if (ty !== 0) for (let k = 0; k < N; k++) {
      const u = k / len, sh = ty === 2 ? (u < 1 ? u : Math.max(0, 1 - (u - 1) * (1 + p[2] * 4))) : (u < 1 ? 0.5 - 0.5 * Math.cos(TWO_PI * u) : 0);
      const tone = ty === 1 ? sh * (1 + p[2] * nz(this.rng) * 0.3) : sh;
      y += (tone - y) * sm; v.buf[k] = y * amp;
    }
    const pos = Math.round(N * (0.02 + p[4] * 0.48));                            // excitation position: comb on the initial shape
    if (ty !== 0) { const c = Float32Array.from(v.buf.subarray(0, Math.ceil(N))); for (let k = 0; k < c.length; k++) v.buf[k] = c[k] - c[(k + pos) % c.length] * 0.9; }
    v.w = Math.ceil(N); v.bowAmp = ty === 0 ? amp : 0;
    return v;
  }
  tick(v, dt) {
    const p = this.p, N = v.N, r = v.w - N, i0 = Math.floor(r), fr = r - i0;
    let x = v.buf[i0 & v.M] * (1 - fr) + v.buf[(i0 + 1) & v.M] * fr;
    v.lp += (x - v.lp) * (1 - v.damp * (0.4 + p[7] * 0.6)); x = v.lp;               // damping (Ratio = how much more the highs lose)
    const ap = v.inh * x + v.apx - v.inh * v.ap; v.apx = x; v.ap = ap; x = ap;       // inharmonicity: dispersion all-pass
    if (p[10] > 0.5) { v.tlp += (x - v.tlp) * (0.15 + (1 - p[11]) * 0.85); x = v.tlp * (0.995 - (1 - p[12]) * 0.02) + (x - v.tlp) * p[13] * 0.3; }
    x *= v.loss;
    if (v.bowAmp && v.on) { const rel = v.bowAmp * 0.3 - x, fric = rel * Math.exp(-rel * rel * (2 + p[2] * 20)) * (0.2 + p[1] * 0.4); x += fric * (1 - p[5] * 0.5) + nz(this.rng) * 0.0008; }
    v.buf[v.w & v.M] = x; v.w++;
    let out = x;
    if (p[14] > 0.5) { const pd = Math.max(1, Math.round(N * (0.02 + p[15] * 0.48))); out = x - v.buf[(v.w - 1 - pd) & v.M]; }
    return Math.tanh(out * 0.9);
  }
}

// ---------------------------------------------------------------------------------------------- Collision
// 0 Mallet, 1 Mallet Volume, 2 Stiffness, 3 Mallet Noise, 4 Color, 5 Noise, 6 Noise Filter, 7 Noise Volume, 8 Env Amt, 9 Freq, 10 Res,
// 11 A, 12 D, 13 S, 14 R, 15 Resonator Type, 16 Decay, 17 Material, 18 Bright, 19 Inharm, 20 Ratio, 21 Volume
export const COL_TYPES = ['Beam', 'Marimba', 'String', 'Membrane', 'Plate', 'Pipe', 'Tube'];
const MODES = 12;
function ratios(type, ratio, inh) {
  const r = [];
  for (let k = 1; r.length < MODES; k++) {
    let x;
    switch (type) {
      case 0: x = ((2 * k + 1) / 3) ** 2; break;                                   // free beam
      case 1: x = [1, 3.9, 9.2, 13.4, 16.6, 21, 25.4, 30, 35.1, 40.3, 46, 52][k - 1]; break; // tuned marimba bar
      case 2: x = k; break;
      case 3: x = [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.16, 3.5, 3.6, 4.06, 4.15, 4.6][k - 1] * (1 + (ratio - 1) * 0.15 * ((k % 3) / 2)); break;
      case 4: { const a = Math.ceil(k / 3), b = (k % 3) + 1; x = (a * a + (b * b) * ratio * ratio) / (1 + ratio * ratio); break; }
      case 5: x = 2 * k - 1; break;                                                 // closed pipe: odd harmonics
      default: x = k; break;                                                        // open tube
    }
    r.push(x * (1 + inh * (x - 1) * 0.05));
  }
  return r;
}
export class Collision extends Poly {
  constructor(sr) { super(sr, 22); }
  relGain() { return t60(0.05 + this.p[16] * 0.1, this.sr); }
  voice(pitch, vel) {
    const p = this.p, sr = this.sr, f = midiToHz(pitch), rs = ratios(Math.round(p[15]), p[20], p[19]), m = [];
    for (let k = 0; k < MODES; k++) {
      const fk = f * rs[k]; if (fk > sr * 0.45) break;
      const dec = p[16] / (1 + k * (1 + p[17]) * 0.6), g = t60(Math.max(0.01, dec), sr), w = TWO_PI * fk / sr;
      m.push({ c1: 2 * g * Math.cos(w), c2: -g * g, y1: 0, y2: 0, a: Math.pow(k + 1, -2.2 + p[18] * 2.2) * (1 - g * g) * 6 });
    }
    return { m, nl: 0, mlp: 0, ne: 0, ns: 1, a: 0, b: 0, vel,
      mw: Math.max(2, Math.round(sr * (0.0005 + (1 - p[2]) * 0.006))), mc: 1 - Math.exp(-TWO_PI * (200 + p[4] * p[4] * 12000) / sr) };
  }
  tick(v, dt) {
    const p = this.p, sr = this.sr; let ex = 0;
    if (p[0] > 0.5) {                                                                // mallet: a raised-cosine strike (width = stiffness) + noise
      const n = v.t * sr; let hit = n < v.mw ? 0.5 - 0.5 * Math.cos(TWO_PI * n / v.mw) : 0;
      v.mlp += (nz(this.rng) - v.mlp) * v.mc; hit += v.mlp * p[3] * Math.exp(-v.t * 300);
      ex += hit * dbl(p[1]) * (0.3 + 0.7 * v.vel) * 4;
    }
    if (p[5] > 0.5) {                                                                // noise: ADSR envelope, filter with envelope amount
      const A = p[11] / 1000, D = p[12] / 1000, S = p[13], R = p[14] / 1000;
      if (v.on) v.ne = v.t < A ? v.t / Math.max(1e-4, A) : S + (1 - S) * Math.exp(-(v.t - A) * 4.6 / Math.max(1e-4, D)); else v.ne *= t60(Math.max(0.001, R), sr);
      const fc = clamp(p[9] * Math.pow(2, p[8] * 4 * v.ne), 30, sr * 0.45), g = Math.tan(Math.PI * fc / sr), k = 1 / p[10], inv = 1 / (1 + g * (g + k));
      const x = nz(this.rng), h = (x - (k + g) * v.a - v.b) * inv, bp = g * h + v.a, lp = g * bp + v.b; v.a = g * h + bp; v.b = g * bp + lp;
      const ty = Math.round(p[6]); ex += (ty === 0 ? lp : ty === 1 ? h : bp) * v.ne * dbl(p[7]) * 2;
    }
    let y = 0;
    for (const m of v.m) { const o = m.c1 * m.y1 + m.c2 * m.y2 + ex * m.a; m.y2 = m.y1; m.y1 = o; y += o; }
    return Math.tanh(y * 0.5);
  }
}
