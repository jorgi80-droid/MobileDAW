// Drift (Live 12): two oscillators + noise into a 12 / 24 dB filter (with key tracking, resonance, high-pass and two modulation slots), two
// envelopes (Env 2 can cycle), one LFO (Hz / ratio to the note / time / tempo sync), a three-slot modulation matrix, Poly / Mono / Stereo /
// Unison voicing and a slow per-voice random "drift". Modulation is computed every 16 samples; audio per sample.
// Parameter indices: defs.js INSTRUMENTS[13] (58 = PB Range, 59 + 3m = matrix slot m source / target / amount).
// Instrument interface (instruments.js): noteOn / noteOff / allOff / setParam / render(L, R, from, to) / active / setTempo, plus setBend(st).
import { TWO_PI, clamp, midiToHz, lcg, polyBlep } from './dsp.js';

export const DRIFT_SRC = ['Env 1', 'Env 2', 'LFO', 'Velocity', 'Key', 'Random'];
export const DRIFT_DEST = ['Off', 'Osc 1 Gain', 'Osc 2 Gain', 'Noise Gain', 'Shape', 'Osc 2 Detune', 'Pitch', 'Filter Freq', 'Res', 'HP', 'LFO Rate', 'Amp', 'Pan'];
export const DRIFT_SYNC = [0.25, 0.5, 1, 2, 4, 8, 16];          // 1/16 .. 4 bars in quarter notes
const VOICES = [2, 4, 6, 8, 12, 16, 24, 32];
const rnd = (o) => lcg(o) / 4294967296;
const dbl = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));
// 0..1 -> seconds (Live envelope ranges: 0.5 ms .. 20 s, curve so that the middle is useful)
// parameters hold milliseconds directly; envelope helper: stage times in seconds
class Env {
  constructor() { this.st = 0; this.v = 0; }
  start(legato) { this.st = 1; if (!legato) this.v = 0; }
  release() { if (this.st) this.st = 4; }
  step(a, d, s, r, dt, cyc) {         // dt = control period in seconds; exponential decay / release, linear attack
    switch (this.st) {
      case 1: this.v += dt / Math.max(0.0005, a); if (this.v >= 1) { this.v = 1; this.st = 2; } break;
      case 2: this.v += (s - this.v) * (1 - Math.exp(-dt * 4.6 / Math.max(0.0005, d))); if (Math.abs(this.v - s) < 1e-3) { this.v = s; this.st = cyc ? 4 : 3; } break;
      case 3: this.v = s; break;
      case 4: this.v -= this.v * (1 - Math.exp(-dt * 4.6 / Math.max(0.0005, r))); if (this.v < 1e-4) { this.v = 0; this.st = cyc ? 1 : 0; } break;
      default: return 0;
    }
    return this.v;
  }
}
// 2-pole state-variable filter (TPT): low-pass and high-pass outputs
class Svf {
  constructor() { this.a = 0; this.b = 0; }
  run(x, g, k, inv) { const h = (x - (k + g) * this.a - this.b) * inv, bp = g * h + this.a, lp = g * bp + this.b; this.a = g * h + bp; this.b = g * bp + lp; return lp; }
  hp(x, g, inv) { const h = (x - (1.4142 + g) * this.a - this.b) * inv, bp = g * h + this.a, lp = g * bp + this.b; this.a = g * h + bp; this.b = g * bp + lp; return h; }
}
const mkVoice = () => ({ on: false, held: false, pitch: 0, vel: 0, age: 0, f: 0, ph1: 0, ph2: 0, e1: new Env(), e2: new Env(), lph: 0, lsh: 0, wan: 0, wanT: 0, drift: 0, dT: 0, rnd: 0,
  fl: [new Svf(), new Svf()], fr: [new Svf(), new Svf()], hl: new Svf(), hr: new Svf(), pan: 0, cnt: 0, m: null, glideF: 0, det: 0 });

export class Drift {
  constructor(sr) {
    this.sr = sr; this.counter = 0; this.rng = { seed: 7331 }; this.bpm = 120; this.bend = 0; this.gainOut = 0.32;
    this.p = new Array(68).fill(0); this.p[22] = 1000; this.p[31] = 2; this.p[32] = 600; this.p[34] = 400; this.p[42] = 1; this.p[47] = 1; this.p[51] = 7; this.p[55] = -6;   // the project sends every parameter (defs.js full: true)
    this.v = Array.from({ length: 32 }, mkVoice); this.held = []; this.last = 0; this.md = new Float64Array(13);
  }
  setTempo(b) { this.bpm = b; }
  setBend(st) { this.bend = st; }
  setParam(i, x) { this.p[i] = x; }
  active() { for (const v of this.v) if (v.on) return true; return false; }
  maxVoices() { const m = Math.round(this.p[50]); return m === 1 ? 1 : m === 3 ? 4 : VOICES[clamp(Math.round(this.p[51]), 0, 7)]; }
  alloc(n) { let k = -1; for (let i = 0; i < n; i++) if (!this.v[i].on) { k = i; break; } if (k < 0) { k = 0; for (let i = 1; i < n; i++) if (this.v[i].age < this.v[k].age) k = i; } return this.v[k]; }
  start(v, p, vel, legato) {
    const f = midiToHz(p + this.p[57]);
    v.glideF = legato || (this.p[54] > 0 && v.on) ? (v.f || f) : f;
    v.on = v.held = true; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.f = f; v.rnd = rnd(this.rng);
    if (!legato) {                                                      // R on = oscillators restart at the note, off = free running; LFO R the same
      if (this.p[21] > 0.5) { v.ph1 = 0; v.ph2 = 0; } else { v.ph1 = rnd(this.rng); v.ph2 = rnd(this.rng); }
      v.e1.start(false); v.e2.start(false); v.lph = this.p[46] > 0.5 ? 0 : rnd(this.rng);
    }
  }
  noteOn(p, vel) {
    const mode = Math.round(this.p[50]);
    if (mode === 1) {                                                   // Mono: one voice, last note priority, Legato = no retrigger while held
      this.held = this.held.filter((x) => x !== p); this.held.push(p);
      const v = this.v[0], leg = this.p[53] > 0.5 && v.on && v.held; this.start(v, p, vel, leg); return;
    }
    if (mode === 3) {                                                   // Unison: four voices on the note, spread in pitch and pan
      for (let u = 0; u < 4; u++) { const v = this.alloc(this.v.length); this.start(v, p, vel, false); v.det = (u - 1.5) * 0.08; v.pan = (u - 1.5) / 1.5; v.age = this.counter; }
      return;
    }
    const v = this.alloc(this.maxVoices()); this.start(v, p, vel, false); v.det = 0; v.pan = mode === 2 ? (rnd(this.rng) * 2 - 1) : 0;   // Stereo: each voice its own pan
  }
  noteOff(p) {
    if (Math.round(this.p[50]) === 1) {
      this.held = this.held.filter((x) => x !== p); const v = this.v[0];
      if (this.held.length && v.pitch === p) { this.start(v, this.held[this.held.length - 1], v.vel, this.p[53] > 0.5); return; }
      if (!this.held.length && v.on) { v.held = false; v.e1.release(); v.e2.release(); } return;
    }
    for (const v of this.v) if (v.on && v.held && v.pitch === p) { v.held = false; v.e1.release(); v.e2.release(); }
  }
  allOff() { this.held = []; for (const v of this.v) if (v.on) { v.held = false; v.e1.release(); v.e2.release(); } }
  lfoHz(v) {
    const p = this.p, m = Math.round(p[41]);
    return m === 0 ? p[42] : m === 1 ? v.glideF * p[43] / 100 : m === 2 ? 1000 / Math.max(1, p[44]) : this.bpm / 60 / DRIFT_SYNC[clamp(Math.round(p[45]), 0, 6)];
  }
  lfo(v) {
    const w = Math.round(this.p[40]), x = v.lph - Math.floor(v.lph);
    switch (w) {
      case 1: return 1 - 4 * Math.abs(x - 0.5); case 2: return 2 * x - 1; case 3: return 1 - 2 * x; case 4: return x < 0.5 ? 1 : -1;
      case 5: return v.lsh; case 6: return v.wan; case 7: return v.lph < 1 ? 1 - 2 * x : -1; case 8: return v.lph < 1 ? 2 * Math.exp(-x * 5) - 1 : -1;   // envelopes run once
      default: return Math.sin(TWO_PI * x);
    }
  }
  src(v, s, e1, e2, lf) { return s === 0 ? e1 : s === 1 ? e2 : s === 2 ? lf : s === 3 ? v.vel : s === 4 ? (v.pitch - 60) / 60 : v.rnd * 2 - 1; }
  render(L, R, from, to) {
    let w1x = 0; const p = this.p, sr = this.sr, CT = 16, dtc = CT / sr, w1 = Math.round(p[0]), w2 = Math.round(p[5]), two = Math.round(p[23]) === 1, mode = Math.round(p[50]);
    const glide = p[54] > 0 ? Math.exp(-dtc / (p[54] * 0.001)) : 0, out = this.gainOut * dbl(p[55]), vv = p[56], r1 = p[14] > 0.5, r2 = p[17] > 0.5, rn = p[20] > 0.5;
    for (const v of this.v) {
      if (!v.on) continue;
      let o1 = 0, o2 = 0, on = 0, sh = 0, cut = 1000, gk = 0, k = 2, hg = 0, amp = 0, pan = v.pan, d1 = 0, d2 = 0, gl = 0, gr = 0, i1 = 1, i2 = 1, ih = 1;
      for (let i = from; i < to; i++) {
        if (v.cnt-- <= 0) {                                             // ---- control rate
          v.cnt = CT - 1;
          const e1 = v.e1.step(p[31] * 0.001, p[32] * 0.001, p[33], p[34] * 0.001, dtc, false), e2 = v.e2.step(p[35] * 0.001, p[36] * 0.001, p[37], p[38] * 0.001, dtc, p[39] > 0.5);
          if (v.e1.st === 0) { v.on = false; break; }
          const lr = this.lfoHz(v), prev = v.lph; v.lph += lr * dtc; if (Math.floor(v.lph) !== Math.floor(prev)) v.lsh = rnd(this.rng) * 2 - 1;
          v.wanT += lr * dtc; if (v.wanT >= 0.25) { v.wanT = 0; v.wanG = clamp((v.wan || 0) + (rnd(this.rng) - 0.5), -1, 1); } v.wan = (v.wan || 0) + ((v.wanG || 0) - (v.wan || 0)) * 0.05;
          if (Math.round(p[40]) < 7 && v.lph > 1e6) v.lph -= Math.floor(v.lph);
          const lm = clamp(p[47] + this.src(v, Math.round(p[48]), e1, e2, 0) * p[49], -1, 1), lf = this.lfo(v) * lm;
          const md = this.md; md.fill(0);                                 // matrix destinations
          for (let s = 0; s < 3; s++) { const dst = Math.round(p[60 + s * 3]); if (dst > 0) md[dst] += this.src(v, Math.round(p[59 + s * 3]), e1, e2, lf) * p[61 + s * 3]; }
          v.dT -= dtc; if (v.dT <= 0) { v.dT = 0.15 + rnd(this.rng) * 0.3; v.dG = (rnd(this.rng) * 2 - 1); } v.drift += ((v.dG || 0) - v.drift) * 0.02;
          v.glideF = glide ? v.f + (v.glideF - v.f) * glide : v.f;
          const pm = this.src(v, Math.round(p[8]), e1, e2, lf) * p[9] * 12 + this.src(v, Math.round(p[10]), e1, e2, lf) * p[11] * 12 + md[6] * 12 + this.bend / 2 * p[58] + v.det + v.drift * p[52] * 0.3;
          const f = v.glideF * Math.pow(2, pm / 12);
          d1 = clamp(f * Math.pow(2, Math.round(p[1])) / sr, 0, 0.45); d2 = clamp(f * Math.pow(2, Math.round(p[6]) + (p[7] + md[5] * 12) / 12) / sr, 0, 0.45);
          sh = clamp(p[2] + this.src(v, Math.round(p[3]), e1, e2, lf) * p[4] + md[4], 0, 1);
          o1 = p[12] > 0.5 ? dbl(p[13]) * clamp(1 + md[1], 0, 2) : 0; o2 = p[15] > 0.5 ? dbl(p[16]) * clamp(1 + md[2], 0, 2) : 0; on = p[18] > 0.5 ? dbl(p[19]) * clamp(1 + md[3], 0, 2) : 0;
          const fo = this.src(v, Math.round(p[27]), e1, e2, lf) * p[28] * 6 + this.src(v, Math.round(p[29]), e1, e2, lf) * p[30] * 6 + md[7] * 6 + p[24] * (v.pitch - 60) / 12;
          cut = clamp(p[22] * Math.pow(2, fo), 20, sr * 0.45); gk = Math.tan(Math.PI * cut / sr); k = 2 - 1.95 * clamp(p[25] + md[8], 0, 1);
          hg = Math.tan(Math.PI * clamp(p[26] * Math.pow(2, md[9] * 4), 10, sr * 0.45) / sr); i1 = 1 / (1 + gk * (gk + k)); i2 = 1 / (1 + gk * (gk + k + 0.3)); ih = 1 / (1 + hg * (hg + 1.4142));
          amp = e1 * (1 - vv + vv * v.vel) * clamp(1 + md[11], 0, 2) * out; pan = clamp(v.pan + md[12], -1, 1); gl = amp * Math.min(1, 1 - pan); gr = amp * Math.min(1, 1 + pan);
        }
        // ---- oscillators
        v.ph1 += d1; if (v.ph1 >= 1) v.ph1 -= 1; v.ph2 += d2; if (v.ph2 >= 1) v.ph2 -= 1;
        const a = v.ph1, b = v.ph2; let x1 = 0, x2 = 0;
        if (o1 === 0) w1x = -1; else w1x = w1;
        switch (w1x) {
          case 0: { const sa = Math.sin(TWO_PI * a); x1 = sh > 0.001 ? Math.sin(TWO_PI * a + sh * 3 * sa) : sa; break; }                                          // Sine: phase fold
          case 1: { const t = (1 - 4 * Math.abs(a - 0.5)) * (1 + sh * 3); x1 = Math.sin(t * Math.PI / 2); break; }          // Triangle: wavefold
          case 2: { const sk = 0.5 + sh * 0.49; x1 = a < sk ? 2 * a / sk - 1 : 1 - 2 * (a - sk) / (1 - sk); break; }        // Shark Tooth: skew
          case 3: { const g = 1 + sh * 8; x1 = Math.tanh(Math.sin(TWO_PI * a) * g) / Math.tanh(g); break; }                // Saturated
          case 4: { const q = a * (1 + sh * 3), fq = q - Math.floor(q); x1 = 2 * fq - 1 - (sh < 0.01 ? polyBlep(a, d1) : 0); break; }   // Saw: sync
          case 5: case 6: { const pw = w1 === 5 ? 0.5 - sh * 0.45 : 0.5 + sh * 0.45; let c = a + (1 - pw); if (c >= 1) c -= 1; x1 = (a < pw ? 1 : -1) + polyBlep(a, d1) - polyBlep(c, d1); break; }   // Pulse / Rectangle
          default: x1 = 0;
        }
        if (o2 === 0) x2 = 0; else switch (w2) {
          case 0: x2 = Math.sin(TWO_PI * b); break; case 1: x2 = 1 - 4 * Math.abs(b - 0.5); break; case 2: x2 = Math.tanh(Math.sin(TWO_PI * b) * 3) / Math.tanh(3); break;
          case 3: x2 = 2 * b - 1 - polyBlep(b, d2); break; default: { let c = b + 0.5; if (c >= 1) c -= 1; x2 = (b < 0.5 ? 1 : -1) + polyBlep(b, d2) - polyBlep(c, d2); }
        }
        const nz = on ? (rnd(this.rng) * 2 - 1) : 0;
        const a1 = x1 * o1, a2 = x2 * o2, an = nz * on, fin = (r1 ? a1 : 0) + (r2 ? a2 : 0) + (rn ? an : 0), dry = (r1 ? 0 : a1) + (r2 ? 0 : a2) + (rn ? 0 : an);
        let y = v.fl[0].run(fin, gk, k, i1); if (two) y = v.fl[1].run(y, gk, k + 0.3, i2);
        y = v.hl.hp(y + dry, hg, ih);
        L[i] += y * gl; R[i] += y * gr;
      }
    }
  }
}
