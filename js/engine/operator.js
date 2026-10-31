// Operator (Live 12): four FM operators A..D, each with ratio (Coarse + Fine) or fixed frequency (Freq x Multi), level, waveform, self feedback,
// velocity sensitivity and its own envelope (attack / decay / sustain / release from Initial to Peak, Loop or Trigger mode); one of 11 algorithms
// routes them; then a filter (low / high / band-pass with envelope amount), Tone (brightness), Spread (stereo detune), Transpose, Volume.
// Parameter indices: defs.js INSTRUMENTS[14] (operator o (0 = A .. 3 = D) at 16 * o: on, coarse, fine, fixed, freq, multi, level dB, wave,
// feedback, vel > level, attack, decay, sustain, release, initial, peak; loop mode at 64 + o; 68 algorithm, 69..75 filter, 76 pan,
// 77 time, 78 tone, 79 volume, 80 transpose, 81 spread, 82 PB range, 83 voices).
import { TWO_PI, clamp, midiToHz, lcg } from './dsp.js';

// modulators of each operator (A = 0 .. D = 3) and the carriers, per algorithm (Live's 11, top = D)
export const OP_ALGOS = [
  { m: [[1], [2], [3], []], c: [0] }, { m: [[1], [2, 3], [], []], c: [0] }, { m: [[1, 2], [], [3], []], c: [0] }, { m: [[1, 3], [2], [], []], c: [0] },
  { m: [[1], [], [3], []], c: [0, 2] }, { m: [[3], [3], [3], []], c: [0, 1, 2] }, { m: [[1], [2], [], []], c: [0, 3] }, { m: [[1], [], [], []], c: [0, 2, 3] },
  { m: [[1, 2, 3], [], [], []], c: [0] }, { m: [[], [], [3], []], c: [0, 1, 2] }, { m: [[], [], [], []], c: [0, 1, 2, 3] },
];
const COARSE = (c) => (c < 0.75 ? 0.5 : Math.round(c));
const rnd = (o) => lcg(o) / 4294967296;
class OpEnv {
  constructor() { this.st = 0; this.v = 0; }
  start(init) { this.st = 1; this.v = init; }
  release() { if (this.st && this.st < 4) this.st = 4; }
  step(a, d, s, r, ini, pk, loop, dt) {
    switch (this.st) {
      case 1: this.v += (pk - ini) * dt / Math.max(0.0005, a); if ((pk >= ini && this.v >= pk) || (pk < ini && this.v <= pk)) { this.v = pk; this.st = 2; } break;
      case 2: this.v += (s - this.v) * (1 - Math.exp(-dt * 4.6 / Math.max(0.0005, d))); if (Math.abs(this.v - s) < 1e-3) { this.v = s; this.st = loop === 1 ? 1 : loop === 2 ? 4 : 3; if (loop === 1) this.v = ini; } break;
      case 3: this.v = s; break;
      case 4: this.v -= this.v * (1 - Math.exp(-dt * 4.6 / Math.max(0.0005, r))); if (this.v < 1e-4) { this.v = 0; this.st = 0; } break;
      default: return 0;
    }
    return this.v;
  }
}
const mkVoice = () => ({ on: false, held: false, pitch: 0, vel: 0, age: 0, f: 0, ph: new Float64Array(4), dt: new Float64Array(4), lv: new Float64Array(4), fb: new Float64Array(4), out: new Float64Array(4), e: [new OpEnv(), new OpEnv(), new OpEnv(), new OpEnv()], fe: new OpEnv(), tz: 0, a: 0, b: 0, a2: 0, b2: 0, cnt: 0 });
const dbl = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));

export class Operator {
  constructor(sr) { this.sr = sr; this.counter = 0; this.rng = { seed: 991 }; this.bend = 0; this.p = new Array(96).fill(0); this.v = Array.from({ length: 16 }, mkVoice); this.bpm = 120; this.wav = [0, 0, 0, 0]; this.on = [true, false, false, false]; }
  setTempo(b) { this.bpm = b; }
  setBend(st) { this.bend = st; }
  setParam(i, x) { this.p[i] = x; }
  active() { for (const v of this.v) if (v.on) return true; return false; }
  noteOn(p, vel) {
    const n = clamp(Math.round(this.p[83]), 1, 16); let k = -1;
    for (let i = 0; i < n; i++) if (!this.v[i].on) { k = i; break; }
    if (k < 0) { k = 0; for (let i = 1; i < n; i++) if (this.v[i].age < this.v[k].age) k = i; }
    const v = this.v[k]; v.on = v.held = true; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.f = midiToHz(p + this.p[80]);
    for (let o = 0; o < 4; o++) { v.ph[o] = 0; v.fb[o] = 0; v.out[o] = 0; v.e[o].start(dbl(this.p[o * 16 + 14])); }
    v.fe.start(0);
  }
  noteOff(p) { for (const v of this.v) if (v.on && v.held && v.pitch === p) { v.held = false; for (const e of v.e) e.release(); v.fe.release(); } }
  allOff() { for (const v of this.v) if (v.on) { v.held = false; for (const e of v.e) e.release(); v.fe.release(); } }
  render(L, R, from, to) {
    const p = this.p, sr = this.sr, CT = 16, dtc = CT / sr, alg = OP_ALGOS[clamp(Math.round(p[68]), 0, 10)], ftype = Math.round(p[70]), fon = p[69] > 0.5, vol = dbl(p[79]) * 0.3, tone = p[78];
    const tk = 1 - Math.exp(-TWO_PI * (200 * Math.pow(100, tone)) / sr), time = Math.pow(2, p[77]), spread = p[81], wav = this.wav, on = this.on, pan = p[76], pl = Math.min(1, 1 - pan), pr = Math.min(1, 1 + pan);
    for (let o = 0; o < 4; o++) { wav[o] = Math.round(p[o * 16 + 7]); on[o] = p[o * 16] > 0.5; }
    for (const v of this.v) {
      if (!v.on) continue;
      let gk = 0, kq = 1.4, inv = 1;
      for (let i = from; i < to; i++) {
        if (v.cnt-- <= 0) {
          v.cnt = CT - 1; let alive = false;
          const f0 = v.f * Math.pow(2, this.bend / 2 * p[82] / 12);
          for (let o = 0; o < 4; o++) {
            const b = o * 16, e = v.e[o].step(p[b + 10] * 0.001 * time, p[b + 11] * 0.001 * time, dbl(p[b + 12]), p[b + 13] * 0.001 * time, dbl(p[b + 14]), dbl(p[b + 15]), Math.round(p[64 + o]), dtc);
            if (v.e[o].st !== 0 && alg.c.includes(o) && on[o]) alive = true;
            const fr = p[b + 3] > 0.5 ? p[b + 4] * p[b + 5] : f0 * COARSE(p[b + 1]) * (1 + p[b + 2] / 1000);
            v.dt[o] = clamp(fr / sr, 0, 0.49);
            v.lv[o] = on[o] ? e * dbl(p[b + 6]) * (1 - p[b + 9] + p[b + 9] * v.vel) : 0;
          }
          if (!alive) { v.on = false; break; }
          const fe = v.fe.step(p[74] * 0.001, p[75] * 0.001, 0, p[75] * 0.001, 0, 1, 0, dtc);
          const cut = clamp(p[71] * Math.pow(2, p[73] * fe * 6), 20, sr * 0.45); gk = Math.tan(Math.PI * cut / sr); kq = 2 - 1.9 * p[72]; inv = 1 / (1 + gk * (gk + kq));
        }
        // operators from D down to A: phase modulation by the modulators' last outputs, self feedback
        const out = v.out;
        for (let o = 3; o >= 0; o--) {
          if (v.lv[o] === 0) { out[o] = 0; continue; }
          let pm = 0; const ms = alg.m[o]; for (let j = 0; j < ms.length; j++) pm += out[ms[j]];
          v.ph[o] += v.dt[o]; if (v.ph[o] >= 1) v.ph[o] -= 1;
          const x = v.ph[o] + pm * 0.5 + v.fb[o] * p[o * 16 + 8] * 0.4, a = x - Math.floor(x);
          let y; switch (wav[o]) { case 1: y = 2 * a - 1; break; case 2: y = a < 0.5 ? 1 : -1; break; case 3: y = 1 - 4 * Math.abs(a - 0.5); break; case 4: y = rnd(this.rng) * 2 - 1; break; default: y = Math.sin(TWO_PI * x); }
          y *= v.lv[o]; v.fb[o] = (v.fb[o] + y) * 0.5; out[o] = y;
        }
        let s = 0; for (const c of alg.c) s += out[c];
        s *= vol / Math.sqrt(alg.c.length);
        v.tz += (s - v.tz) * tk; s = v.tz;                              // Tone: brightness (one-pole low-pass, fully open at 100 %)
        if (fon) { const h = (s - (kq + gk) * v.a - v.b) * inv, bp = gk * h + v.a, lp = gk * bp + v.b; v.a = gk * h + bp; v.b = gk * bp + lp; s = ftype === 1 ? h : ftype === 2 ? bp : lp; }
        const w = spread ? out[alg.c[0]] * vol * spread * 0.3 * (v.age % 2 ? 1 : -1) : 0;   // Spread: alternate voices lean left / right
        L[i] += (s * (1 - spread * 0.3) - w) * pl; R[i] += (s * (1 - spread * 0.3) + w) * pr;
      }
    }
  }
}
