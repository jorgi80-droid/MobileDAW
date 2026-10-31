// Live 12 Drum Synths: DS Kick, DS Snare, DS Tom, DS HH, DS Clap, DS FM (instrument types 19..24). Each is a small one-shot drum voice that
// plays its own tuned sound on any note (velocity = level), up to six overlapping hits. Parameter indices: defs.js INSTRUMENTS[19..24];
// the last parameter of every device is Volume. Noise comes from a seeded LCG, so renders are repeatable (tests, golden files).
import { TWO_PI, clamp, lcg } from './dsp.js';

const dbl = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));
const nz = (o) => lcg(o) / 2147483648 - 1;
// one-pole and state-variable filters (per voice)
class Svf {
  constructor() { this.a = 0; this.b = 0; }
  set(sr, f, q) { this.g = Math.tan(Math.PI * clamp(f, 20, sr * 0.45) / sr); this.k = 1 / Math.max(0.3, q); this.inv = 1 / (1 + this.g * (this.g + this.k)); }
  run(x) { const h = (x - (this.k + this.g) * this.a - this.b) * this.inv, bp = this.g * h + this.a, lp = this.g * bp + this.b; this.a = this.g * h + bp; this.b = this.g * bp + lp; this.hp = h; this.bp = bp; return lp; }
}
const pick = (f, type) => (type === 1 ? f.hp : type === 2 ? f.bp : null);

class DrumBase {
  constructor(sr, n) { this.sr = sr; this.p = new Array(n).fill(0); this.v = []; this.rng = { seed: 1234 + n }; }
  setParam(i, x) { this.p[i] = x; }
  setTempo() {}
  active() { return this.v.length > 0; }
  noteOn(pitch, vel) { if (this.v.length >= 6) this.v.shift(); const v = this.voice(vel); v.t = 0; v.vel = vel; this.v.push(v); }
  noteOff() {}                                                     // one-shot: the hit decays by itself
  allOff() {}                                                      // (stop / panic: the hits still ring out, as in Live)
  render(L, R, from, to) {
    const vol = dbl(this.p[this.p.length - 1]), dt = 1 / this.sr;
    for (let j = this.v.length - 1; j >= 0; j--) {
      const v = this.v[j];
      for (let i = from; i < to; i++) { const s = this.tick(v, dt); L[i] += s[0] * vol * v.vel; R[i] += s[1] * vol * v.vel; v.t += dt; }
      if (v.t > v.life) this.v.splice(j, 1);
    }
  }
}
const OUT = [0, 0];
const mono = (x) => { OUT[0] = x; OUT[1] = x; return OUT; };
const st = (l, r) => { OUT[0] = l; OUT[1] = r; return OUT; };

// DS Kick: 0 Pitch, 1 Decay, 2 Tone, 3 Env (pitch sweep), 4 Drive, 5 Attack (click level), 6 Click, 7 Volume
export class DsKick extends DrumBase {
  constructor(sr) { super(sr, 8); }
  voice() { return { ph: 0, life: this.p[1] * 6 + 0.05, lp: 0 }; }
  tick(v, dt) {
    const p = this.p, f = p[0] * (1 + p[3] * 6 * Math.exp(-v.t * 40));
    v.ph += f * dt; const env = Math.exp(-v.t * 4.6 / p[1]);
    let x = Math.sin(TWO_PI * v.ph) + p[2] * 0.6 * Math.sin(TWO_PI * v.ph * 2) * Math.exp(-v.t * 12);
    if (p[6] > 0.5 && v.t < 0.012) { const c = nz(this.rng) * (1 - v.t / 0.012); v.lp += (c - v.lp) * 0.5; x += v.lp * p[5] * 1.6; }
    x *= env; const dr = 1 + p[4] * 9; x = Math.tanh(x * dr) / Math.tanh(dr) * 0.9;
    return mono(x);
  }
}
// DS Snare: 0 Tune, 1 Decay, 2 Tone (noise vs body), 3 Color (noise filter), 4 Filter Type, 5 Spread, 6 Volume
export class DsSnare extends DrumBase {
  constructor(sr) { super(sr, 7); }
  voice() { const v = { ph: 0, ph2: 0, life: this.p[1] * 6 + 0.05, fl: new Svf(), fr: new Svf(), d: new Float32Array(64), w: 0 }; v.fl.set(this.sr, this.p[3], 0.9); v.fr.set(this.sr, this.p[3], 0.9); return v; }
  tick(v, dt) {
    const p = this.p, ty = Math.round(p[4]), f = p[0] * (1 + 0.4 * Math.exp(-v.t * 60));
    v.ph += f * dt; v.ph2 += f * 1.47 * dt;
    const body = (Math.sin(TWO_PI * v.ph) + 0.5 * Math.sin(TWO_PI * v.ph2)) * Math.exp(-v.t * 4.6 / (p[1] * 0.5));
    const n = nz(this.rng), eN = Math.exp(-v.t * 4.6 / p[1]);
    const lo = v.fl.run(n), nl = ty ? pick(v.fl, ty) : lo;
    v.d[v.w & 63] = n; const nd = v.d[(v.w - 23) & 63]; v.w++;                 // Spread: the right channel hears a decorrelated copy
    const ro = v.fr.run(n * (1 - p[5]) + nd * p[5]), nr = ty ? pick(v.fr, ty) : ro;
    const b = body * (1 - p[2]) * 0.8;
    return st(Math.tanh(b + nl * p[2] * eN * 1.2), Math.tanh(b + nr * p[2] * eN * 1.2));
  }
}
// DS Tom: 0 Tune, 1 Decay, 2 Tone (attack noise + overtone), 3 Bend (pitch drop), 4 Volume
export class DsTom extends DrumBase {
  constructor(sr) { super(sr, 5); }
  voice() { const v = { ph: 0, ph2: 0, life: this.p[1] * 6 + 0.05, f: new Svf() }; v.f.set(this.sr, this.p[0] * 4, 1.5); return v; }
  tick(v, dt) {
    const p = this.p, f = p[0] * (1 + p[3] * 1.5 * Math.exp(-v.t * 9));
    v.ph += f * dt; v.ph2 += f * 1.59 * dt;
    const e = Math.exp(-v.t * 4.6 / p[1]);
    const x = (Math.sin(TWO_PI * v.ph) + p[2] * 0.45 * Math.sin(TWO_PI * v.ph2)) * e + v.f.run(nz(this.rng)) * p[2] * Math.exp(-v.t * 80) * 1.5;
    return mono(Math.tanh(x));
  }
}
// DS HH: 0 Tune (metal partials), 1 Decay, 2 Tone (high-pass), 3 Type (Metal / Noise / Mix), 4 Volume
const HH_R = [1, 1.342, 1.2312, 1.6532, 1.9523, 2.1523];
export class DsHH extends DrumBase {
  constructor(sr) { super(sr, 5); }
  voice() { const v = { ph: new Float64Array(6), life: this.p[1] * 6 + 0.03, f: new Svf() }; v.f.set(this.sr, this.p[2], 0.8); return v; }
  tick(v, dt) {
    const p = this.p, ty = Math.round(p[3]); let m = 0;
    for (let k = 0; k < 6; k++) { v.ph[k] += p[0] * HH_R[k] * dt; m += (v.ph[k] % 1 < 0.5 ? 1 : -1); }
    const src = ty === 0 ? m / 6 : ty === 1 ? nz(this.rng) : (m / 6 + nz(this.rng)) * 0.5;
    v.f.run(src);
    return mono(v.f.hp * Math.exp(-v.t * 4.6 / p[1]) * 1.4);
  }
}
// DS Clap: 0 Tune (band centre), 1 Decay, 2 Tone (band width), 3 Spread, 4 Sloppy (burst spacing), 5 Tail, 6 Volume
export class DsClap extends DrumBase {
  constructor(sr) { super(sr, 7); }
  voice() { const v = { life: this.p[1] * 6 + 0.1, fl: new Svf(), fr: new Svf() }; const q = 0.6 + (1 - this.p[2]) * 4; v.fl.set(this.sr, this.p[0], q); v.fr.set(this.sr, this.p[0] * (1 + this.p[3] * 0.25), q); return v; }
  tick(v, dt) {
    const p = this.p, gap = 0.006 + p[4] * 0.02; let e = 0;
    for (let k = 0; k < 4; k++) { const t0 = k * gap; if (v.t >= t0) e += Math.exp(-(v.t - t0) * 160) * (k === 3 ? 1 : 0.8); }
    e += p[5] * Math.exp(-v.t * 4.6 / p[1]) * 0.6;
    const n = nz(this.rng), n2 = nz(this.rng);
    v.fl.run(n); v.fr.run(n * (1 - p[3]) + n2 * p[3]);
    return st(v.fl.bp * e * 2.2, v.fr.bp * e * 2.2);
  }
}
// DS FM: 0 Tune, 1 Decay, 2 Amount (index), 3 Ratio, 4 Feedback, 5 Tone (low-pass), 6 Volume
export class DsFm extends DrumBase {
  constructor(sr) { super(sr, 7); }
  voice() { return { pc: 0, pm: 0, fb: 0, lp: 0, life: this.p[1] * 6 + 0.05 }; }
  tick(v, dt) {
    const p = this.p, e = Math.exp(-v.t * 4.6 / p[1]), em = Math.exp(-v.t * 4.6 / (p[1] * 0.5));
    v.pm += p[0] * p[3] * dt; const m = Math.sin(TWO_PI * v.pm + v.fb * p[4] * 3); v.fb = m;
    v.pc += p[0] * dt; const x = Math.sin(TWO_PI * v.pc + m * p[2] * 8 * em) * e;
    const a = 1 - Math.exp(-TWO_PI * (200 + p[5] * p[5] * 18000) * dt); v.lp += (x - v.lp) * a;
    return mono(v.lp);
  }
}
