// Meld (Live 12): two engines A and B per voice. Each engine: an oscillator type with two macros (Shape, Tone), octave / semitone / fine,
// a filter (SVF 12 / SVF 24 / Ladder / Comb with Freq, Q and a third control: L-B-H-N morph, drive or feedback), mix (pan, tone tilt,
// level, on), amp and modulation envelopes, LFO 1 (shape, fold, phase, retrigger) with its FX (attenuverter, fade-in), LFO 2, and a
// modulation grid (A Env / M Env / LFO 1 / LFO 2 / Velocity into Shape, Tone, Filter Freq, Q, third filter control, LFO 1 rate).
// Global: Poly / Mono, voices, Spread, Stack (unison), Drive, Volume, Limit.
// Parameter indices: engine A at 0, engine B at MELD_B (= 91, so instrument parameter 90 - the engine's Pitch - stays unused);
// MELD_G (= 68) globals: voice mode, voices, spread, stack, drive, volume, limit, PB range. Inside an engine: see MO below.
import { TWO_PI, clamp, midiToHz, lcg, polyBlep } from './dsp.js';

export const MELD_B = 91, MELD_G = 68, MELD_N = 68;
export const MO = { type: 0, oct: 1, semi: 2, fine: 3, shape: 4, tone: 5, ftype: 6, freq: 7, q: 8, morph: 9, pan: 10, tilt: 11, level: 12, on: 13, aenv: 14, menv: 18,
  l1w: 22, l1s: 23, l1r: 24, l1d: 25, l1sh: 26, l1f: 27, l1p: 28, l1rt: 29, fx1: 30, fx2: 31, l2w: 32, l2s: 33, l2r: 34, l2d: 35, l2p: 36, l2rt: 37, mat: 38 };
export const MELD_TGT = ['Osc Macro 1', 'Osc Macro 2', 'Filter Freq', 'Filter Macro 1', 'Filter Macro 2', 'LFO 1 Rate'];
export const MELD_SRC = ['A Env', 'M Env', 'LFO 1', 'LFO 2', 'Vel'];
export const MELD_OSC = ['Basic Shapes', 'Swarm Sine', 'Harmonic FM', 'Fold FM', 'Squelch', 'Noise Loop', 'Bitgrinder', 'Chip'];
export const MELD_SYNC = [0.25, 0.5, 1, 2, 4, 8, 16];
const rnd = (o) => lcg(o) / 4294967296;
const dbl = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));
class Env {
  constructor() { this.st = 0; this.v = 0; }
  start() { this.st = 1; }
  release() { if (this.st) this.st = 4; }
  step(a, d, s, r, dt) {
    switch (this.st) {
      case 1: this.v += dt / Math.max(0.0005, a); if (this.v >= 1) { this.v = 1; this.st = 2; } break;
      case 2: this.v += (s - this.v) * (1 - Math.exp(-dt * 4.6 / Math.max(0.0005, d))); if (Math.abs(this.v - s) < 1e-3) { this.v = s; this.st = 3; } break;
      case 3: this.v = s; break;
      case 4: this.v -= this.v * (1 - Math.exp(-dt * 4.6 / Math.max(0.0005, r))); if (this.v < 1e-4) { this.v = 0; this.st = 0; } break;
      default: return 0;
    }
    return this.v;
  }
}
class Svf { constructor() { this.a = 0; this.b = 0; } run(x, g, k, inv) { const h = (x - (k + g) * this.a - this.b) * inv, bp = g * h + this.a, lp = g * bp + this.b; this.a = g * h + bp; this.b = g * bp + lp; this.h = h; this.bp = bp; return lp; } }
const mkEng = () => ({ src: new Float64Array(5), lv1: 0, lv2: 0, ph: new Float64Array(8), ph2: 0, sv: [0, 0], z: 0, hold: 0, hv: 0, nl: new Float32Array(2048), nlp: 0, nll: 0, f1: new Svf(), f2: new Svf(), comb: new Float32Array(4096), cw: 0, ae: new Env(), me: new Env(), l1: 0, l2: 0, s1: 0, s2: 0, t: 0, tz: 0,
  d: 0, shape: 0, tone: 0, g: 0, k: 2, inv: 1, inv2: 1, morph: 0, amp: 0, pl: 1, pr: 1, cd: 100, tilt: 0 });
const mkVoice = () => ({ on: false, held: false, pitch: 0, vel: 0, age: 0, f: 0, e: [mkEng(), mkEng()], cnt: 0, det: 0, pan: 0 });

export class Meld {
  constructor(sr) { this.sr = sr; this.counter = 0; this.rng = { seed: 909 }; this.bend = 0; this.bpm = 120; this.p = new Array(MELD_B + MELD_N).fill(0); this.v = Array.from({ length: 16 }, mkVoice); this.held = []; this.g1 = [0, 0]; this.g2 = [0, 0]; }
  setTempo(b) { this.bpm = b; }
  setBend(st) { this.bend = st; }
  setParam(i, x) { this.p[i] = x; }
  active() { for (const v of this.v) if (v.on) return true; return false; }
  start(v, p, vel) {
    v.on = v.held = true; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.f = midiToHz(p);
    for (let e = 0; e < 2; e++) { const E = v.e[e], b = e ? MELD_B : 0; E.ae.start(); E.me.start(); E.t = 0; E.l1 = this.p[b + MO.l1rt] > 0.5 ? 0 : this.g1[e]; E.l2 = this.p[b + MO.l2rt] > 0.5 ? 0 : this.g2[e]; E.nll = 0; }   // R off: the voice joins the free-running LFO
  }
  noteOn(p, vel) {
    const G = MELD_G, mono = Math.round(this.p[G]) === 1, n = mono ? 1 : clamp(Math.round(this.p[G + 1]), 1, 16), stack = [1, 2, 3, 4][clamp(Math.round(this.p[G + 3]), 0, 3)];
    if (mono) { this.held = this.held.filter((x) => x !== p); this.held.push(p); const v = this.v[0]; const leg = v.on && v.held; if (leg) { v.pitch = p; v.f = midiToHz(p); v.vel = vel; } else this.start(v, p, vel); v.det = 0; return; }
    for (let u = 0; u < stack; u++) {
      let k = -1; for (let i = 0; i < n * stack && i < 16; i++) if (!this.v[i].on) { k = i; break; } if (k < 0) { k = 0; for (let i = 1; i < Math.min(16, n * stack); i++) if (this.v[i].age < this.v[k].age) k = i; }
      const v = this.v[k]; this.start(v, p, vel); const sp = stack > 1 ? u / (stack - 1) - 0.5 : 0; v.det = sp * this.p[G + 2] * 0.6; v.pan = sp * this.p[G + 2] * 2;
    }
  }
  noteOff(p) {
    if (Math.round(this.p[MELD_G]) === 1) { this.held = this.held.filter((x) => x !== p); const v = this.v[0]; if (this.held.length) { if (v.pitch === p) { v.pitch = this.held[this.held.length - 1]; v.f = midiToHz(v.pitch); } return; } }
    for (const v of this.v) if (v.on && v.held && v.pitch === p) { v.held = false; for (const E of v.e) { E.ae.release(); E.me.release(); } }
  }
  allOff() { this.held = []; for (const v of this.v) if (v.on) { v.held = false; for (const E of v.e) { E.ae.release(); E.me.release(); } } }
  lfo(w, x, sh, fold, s) {
    x -= Math.floor(x); if (sh) x = sh > 0 ? Math.pow(x, 1 + sh * 3) : 1 - Math.pow(1 - x, 1 - sh * 3);
    let y; switch (Math.round(w)) { case 1: y = 1 - 4 * Math.abs(x - 0.5); break; case 2: y = 2 * x - 1; break; case 3: y = x < 0.5 ? 1 : -1; break; case 4: case 5: y = s; break; default: y = Math.sin(TWO_PI * x); }
    if (fold > 0) y = Math.sin(y * (1 + fold * 4) * Math.PI / 2);
    return y;
  }
  render(L, R, from, to) {
    for (let e = 0; e < 2; e++) { const b = e ? MELD_B : 0, n = (to - from) / this.sr; this.g1[e] = (this.g1[e] + (this.p[b + MO.l1s] > 0.5 ? this.bpm / 60 / MELD_SYNC[clamp(Math.round(this.p[b + MO.l1d]), 0, 6)] : this.p[b + MO.l1r]) * n) % 1; this.g2[e] = (this.g2[e] + (this.p[b + MO.l2s] > 0.5 ? this.bpm / 60 / MELD_SYNC[clamp(Math.round(this.p[b + MO.l2d]), 0, 6)] : this.p[b + MO.l2r]) * n) % 1; }
    const p = this.p, sr = this.sr, CT = 16, dtc = CT / sr, G = MELD_G, drive = p[G + 4], vol = dbl(p[G + 5]) * 0.25, limit = p[G + 6] > 0.5;
    for (const v of this.v) {
      if (!v.on) continue;
      for (let i = from; i < to; i++) {
        if (v.cnt-- <= 0) {
          v.cnt = CT - 1; let alive = false;
          for (let e = 0; e < 2; e++) {
            const E = v.e[e], b = e ? MELD_B : 0, q = (o) => p[b + o];
            const ae = E.ae.step(q(14) * 0.001, q(15) * 0.001, q(16), q(17) * 0.001, dtc), me = E.me.step(q(18) * 0.001, q(19) * 0.001, q(20), q(21) * 0.001, dtc);
            if (q(MO.on) > 0.5 && E.ae.st !== 0) alive = true;
            E.t += dtc; const fade = q(MO.fx2) > 0 ? Math.min(1, E.t / q(MO.fx2)) : 1;
            const src = E.src; src[0] = ae; src[1] = me; src[2] = E.lv1; src[3] = E.lv2; src[4] = v.vel; /* LFO values of the previous tick (for LFO 1 Rate) */ const m = (t) => { let s = 0; for (let k = 0; k < 5; k++) s += src[k] * q(MO.mat + t * 5 + k); return s; };
            const r1 = (q(MO.l1s) > 0.5 ? this.bpm / 60 / MELD_SYNC[clamp(Math.round(q(MO.l1d)), 0, 6)] : q(MO.l1r)) * Math.pow(2, m(5) * 4), r2 = q(MO.l2s) > 0.5 ? this.bpm / 60 / MELD_SYNC[clamp(Math.round(q(MO.l2d)), 0, 6)] : q(MO.l2r);
            const p1 = E.l1; E.l1 += r1 * dtc; if (Math.floor(E.l1) !== Math.floor(p1)) E.s1 = E.s1 * 0.5 * (Math.round(q(MO.l1w)) === 5) + (rnd(this.rng) * 2 - 1) * (Math.round(q(MO.l1w)) === 5 ? 0.5 : 1);
            const p2 = E.l2; E.l2 += r2 * dtc; if (Math.floor(E.l2) !== Math.floor(p2)) E.s2 = rnd(this.rng) * 2 - 1;
            src[2] = this.lfo(q(MO.l1w), E.l1 + q(MO.l1p) / 360, q(MO.l1sh), q(MO.l1f), E.s1) * q(MO.fx1) * fade; src[3] = this.lfo(q(MO.l2w), E.l2 + q(MO.l2p) / 360, 0, 0, E.s2); E.lv1 = src[2]; E.lv2 = src[3];
            const st = q(MO.oct) * 12 + q(MO.semi) + q(MO.fine) / 100 + this.bend / 2 * p[G + 7] + v.det;
            E.d = clamp(v.f * Math.pow(2, st / 12) / sr, 0, 0.45);
            E.shape = clamp(q(MO.shape) + m(0), 0, 1); E.tone = clamp(q(MO.tone) + m(1), 0, 1);
            const fc = clamp(q(MO.freq) * Math.pow(2, m(2) * 6), 20, sr * 0.45), qq = clamp(q(MO.q) + m(3), 0, 1); E.morph = clamp(q(MO.morph) + m(4), 0, 1);
            const ft = Math.round(q(MO.ftype)); E.g = Math.tan(Math.PI * fc / sr); E.k = 2 - 1.95 * qq; E.inv = 1 / (1 + E.g * (E.g + E.k)); E.inv2 = 1 / (1 + E.g * (E.g + E.k + 0.3)); E.cd = clamp(sr / fc, 2, 4000); E.cq = qq;
            E.amp = q(MO.on) > 0.5 ? ae * dbl(q(MO.level)) : 0; const pan = clamp(q(MO.pan) + v.pan, -1, 1); E.pl = Math.min(1, 1 - pan); E.pr = Math.min(1, 1 + pan); E.tilt = q(MO.tilt); E.ft = ft;
          }
          if (!alive) { v.on = false; break; }
        }
        let l = 0, r = 0;
        for (let e = 0; e < 2; e++) {
          const E = v.e[e]; if (!E.amp) continue;
          const b = e ? MELD_B : 0, x = this.osc(E, Math.round(p[b]), v), y = this.filt(E, x);
          E.tz += (y - E.tz) * 0.15; const t = E.tilt, o = (t >= 0 ? y + (y - E.tz) * t * 2 : E.tz * (-t) + y * (1 + t)) * E.amp;   // Tone: tilt (- darker, + brighter)
          l += o * E.pl; r += o * E.pr;
        }
        if (drive > 0) { const g = 1 + drive * 8; l = Math.tanh(l * g) / Math.sqrt(g); r = Math.tanh(r * g) / Math.sqrt(g); }
        L[i] += l * vol; R[i] += r * vol;
      }
    }
    if (limit) for (let i = from; i < to; i++) { L[i] = Math.tanh(L[i]); R[i] = Math.tanh(R[i]); }
  }
  osc(E, type, v) {
    const d = E.d, sh = E.shape, tn = E.tone;
    switch (type) {
      case 1: { let s = 0; for (let k = 0; k < 6; k++) { const det = 1 + (k - 2.5) * sh * 0.012 + (k % 2 ? tn * (k === 5 ? 1 : 0) : 0); E.ph[k] += d * det * (k === 5 && tn > 0.5 ? 2 : 1); if (E.ph[k] >= 1) E.ph[k] -= 1; s += Math.sin(TWO_PI * E.ph[k]); } return s / 3; }   // Swarm Sine
      case 2: { E.ph[0] += d; if (E.ph[0] >= 1) E.ph[0] -= 1; const ratio = 1 + Math.round(sh * 7); E.ph[1] += d * ratio; if (E.ph[1] >= 1) E.ph[1] -= 1; return Math.sin(TWO_PI * E.ph[0] + tn * 4 * Math.sin(TWO_PI * E.ph[1])); }   // Harmonic FM
      case 3: { E.ph[0] += d; if (E.ph[0] >= 1) E.ph[0] -= 1; E.ph[1] += d * 2; if (E.ph[1] >= 1) E.ph[1] -= 1; const x = Math.sin(TWO_PI * E.ph[0] + tn * 3 * Math.sin(TWO_PI * E.ph[1])); return Math.sin(x * (1 + sh * 5) * Math.PI / 2); }   // Fold FM
      case 4: { E.ph[0] += d; if (E.ph[0] >= 1) E.ph[0] -= 1; const x = 2 * E.ph[0] - 1 - polyBlep(E.ph[0], d), g = Math.tan(Math.PI * clamp(d * this.sr * (1 + sh * 30), 20, this.sr * 0.45) / this.sr), k = 2 - 1.98 * tn; const h = (x - (k + g) * E.sv[0] - E.sv[1]) / (1 + g * (g + k)), bp = g * h + E.sv[0], lp = g * bp + E.sv[1]; E.sv[0] = g * h + bp; E.sv[1] = g * bp + lp; return clamp(lp * 1.5, -2, 2); }   // Squelch
      case 5: { const len = clamp(Math.round(1 / Math.max(1e-4, d)), 2, 2048); if (E.nll !== len) { E.nll = len; for (let k = 0; k < len; k++) E.nl[k] = rnd(this.rng) * 2 - 1; E.nlp = 0; } const j = E.nlp; const y = E.nl[j]; E.nl[j] = y * (1 - sh * 0.5) + E.nl[(j + 1) % len] * sh * 0.5; E.nlp = (j + 1) % len; E.z += (y - E.z) * (0.05 + tn * 0.95); return E.z; }   // Noise Loop (plucked)
      case 6: { E.ph[0] += d; if (E.ph[0] >= 1) E.ph[0] -= 1; if (--E.hold <= 0) { E.hold = 1 + Math.round(tn * 40); const bits = 2 + Math.round((1 - sh) * 10), q = Math.pow(2, bits); E.hv = Math.round(Math.sin(TWO_PI * E.ph[0]) * q) / q; } return E.hv; }   // Bitgrinder
      case 7: { E.ph[0] += d; if (E.ph[0] >= 1) E.ph[0] -= 1; const duty = [0.125, 0.25, 0.5, 0.75][Math.min(3, Math.floor(sh * 4))]; const x = E.ph[0] < duty ? 1 : -1; return tn > 0 && rnd(this.rng) < tn * 0.3 ? rnd(this.rng) * 2 - 1 : x; }   // Chip
      default: { E.ph[0] += d; if (E.ph[0] >= 1) E.ph[0] -= 1; const a = E.ph[0], s = sh * 3, sq = (a < 0.5 - tn * 0.4 ? 1 : -1), shapes = [Math.sin(TWO_PI * a), 1 - 4 * Math.abs(a - 0.5), 2 * a - 1 - polyBlep(a, d), sq]; const i0 = Math.min(2, Math.floor(s)), f = s - i0, y = shapes[i0] * (1 - f) + shapes[i0 + 1] * f, g = 1 + tn * 5; return Math.tanh(y * g) / Math.tanh(g); }   // Basic Shapes: sine -> triangle -> saw -> square; Tone = pulse width + drive (brighter)
    }
  }
  filt(E, x) {
    switch (E.ft) {
      case 1: return E.f2.run(E.f1.run(x, E.g, E.k, E.inv), E.g, E.k + 0.3, E.inv2);                                                                          // SVF 24 dB
      case 2: { const y = E.f2.run(E.f1.run(Math.tanh(x * (1 + E.morph * 6)), E.g, E.k, E.inv), E.g, E.k + 0.3, E.inv2); return y; }                        // Ladder: third control = drive
      case 3: { const dd = E.cd, pos = E.cw - dd, k = Math.floor(pos), f = pos - k, M = 4095, y = E.comb[k & M] * (1 - f) + E.comb[(k + 1) & M] * f; E.comb[E.cw & M] = x + y * (E.morph * 2 - 1) * 0.95 * (0.5 + E.cq * 0.5); E.cw++; return (x + y) * 0.6; }   // Comb: third control = feedback (- / +)
      default: { const lp = E.f1.run(x, E.g, E.k, E.inv), m = E.morph * 3, bp = E.f1.bp, hp = E.f1.h, no = lp + hp, o = [lp, bp, hp, no], i0 = Math.min(2, Math.floor(m)), f = m - i0; return o[i0] * (1 - f) + o[i0 + 1] * f; }   // SVF 12 dB, L-B-H-N morph
    }
  }
}
