// Analog (Live 12): Osc 1, Osc 2 and Noise feed two filters (each source split by its F1/F2 balance; Fil 1 can also feed Fil 2 with To F2;
// Fil 2 can follow Fil 1's frequency), Fil 1 -> Amp 1, Fil 2 -> Amp 2. Filters and amps have their own ADSR (linear or exponential slope,
// "Free" = envelopes ignore note-off and run through), LFO 1 modulates Osc 1 pitch / Fil 1 / Amp 1, LFO 2 the same for the second path.
// Global: voices, unison (with detune), glide, legato, vibrato, volume, PB range. Parameter indices: defs.js INSTRUMENTS[15].
import { TWO_PI, clamp, midiToHz, lcg, polyBlep } from './dsp.js';

const rnd = (o) => lcg(o) / 4294967296;
const dbl = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));
const VOICES = [1, 2, 4, 6, 8, 12, 16, 24, 32];
class Env {
  constructor() { this.st = 0; this.v = 0; }
  start() { this.st = 1; this.v = 0; }
  release() { if (this.st) this.st = 4; }
  step(a, d, s, r, dt, exp) {
    switch (this.st) {
      case 1: this.v += dt / Math.max(0.0005, a); if (this.v >= 1) { this.v = 1; this.st = 2; } break;
      case 2: if (exp) this.v += (s - this.v) * (1 - Math.exp(-dt * 4.6 / Math.max(0.0005, d))); else this.v -= (1 - s) * dt / Math.max(0.0005, d);
        if (this.v <= s + 1e-3) { this.v = s; this.st = 3; } break;
      case 3: this.v = s; break;
      case 4: if (exp) this.v -= this.v * (1 - Math.exp(-dt * 4.6 / Math.max(0.0005, r))); else this.v -= dt / Math.max(0.0005, r);
        if (this.v < 1e-4) { this.v = 0; this.st = 0; } break;
      default: return 0;
    }
    return this.v;
  }
}
class Svf {   // TPT state-variable filter, 2-pole; mode outputs
  constructor() { this.a = 0; this.b = 0; }
  run(x, g, k, inv) { const h = (x - (k + g) * this.a - this.b) * inv, bp = g * h + this.a, lp = g * bp + this.b; this.a = g * h + bp; this.b = g * bp + lp; this.h = h; this.bp = bp; return lp; }
}
const DRIVE = [0, 1.5, 3, 6, 1.5, 3, 6];
function drive(x, d) { if (!d) return x; const g = DRIVE[d]; return d >= 4 ? Math.tanh(x * g + 0.3) - Math.tanh(0.3) : Math.tanh(x * g) / Math.tanh(g); }
const mkVoice = () => ({ on: false, held: false, pitch: 0, vel: 0, age: 0, f: 0, gf: 0, ph: [0, 0], sub: [0, 0], nz: 0, uni: 0, pan: 0, fe: [new Env(), new Env()], ae: [new Env(), new Env()], f1: [new Svf(), new Svf()], f2: [new Svf(), new Svf()], cnt: 0,
  d: [0, 0], pw: [0.5, 0.5], g: [0, 0], k: [2, 2], inv: [1, 1], two: [false, false], md: [0, 0], amp: [0, 0], lp: [0, 0] });

export class Analog {
  constructor(sr) { this.sr = sr; this.counter = 0; this.rng = { seed: 4242 }; this.bend = 0; this.bpm = 120; this.p = new Array(92).fill(0); this.v = Array.from({ length: 32 }, mkVoice); this.lph = [0, 0]; this.lsh = [0, 0]; this.vph = 0; this.held = []; }
  setTempo(b) { this.bpm = b; }
  setBend(st) { this.bend = st; }
  setParam(i, x) { this.p[i] = x; }
  active() { for (const v of this.v) if (v.on) return true; return false; }
  start(v, p, vel, legato) {
    v.on = v.held = true; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.f = midiToHz(p); if (!v.gf || this.p[83] <= 0) v.gf = v.f;
    if (!legato) { v.ph[0] = v.ph[1] = 0; v.sub[0] = v.sub[1] = 0; for (const e of v.fe) e.start(); for (const e of v.ae) e.start(); for (let l = 0; l < 2; l++) if (this.p[73 + l * 5] > 0.5) this.lph[l] = 0; }   // LFO Retrig: restart at the note
  }
  noteOn(p, vel) {
    const n = VOICES[clamp(Math.round(this.p[80]), 0, 8)], uni = [1, 2, 3, 4][clamp(Math.round(this.p[81]), 0, 3)];
    if (n === 1) { this.held = this.held.filter((x) => x !== p); this.held.push(p); const v = this.v[0]; this.start(v, p, vel, this.p[84] > 0.5 && v.on && v.held); return; }
    for (let u = 0; u < uni; u++) {
      let k = -1; for (let i = 0; i < n; i++) if (!this.v[i].on) { k = i; break; } if (k < 0) { k = 0; for (let i = 1; i < n; i++) if (this.v[i].age < this.v[k].age) k = i; }
      const v = this.v[k]; this.start(v, p, vel, false); v.uni = uni > 1 ? (u / (uni - 1) - 0.5) : 0; v.pan = v.uni * 1.4;
    }
  }
  noteOff(p) {
    const free = this.p[91] > 0.5;
    if (VOICES[clamp(Math.round(this.p[80]), 0, 8)] === 1) {
      this.held = this.held.filter((x) => x !== p); const v = this.v[0];
      if (this.held.length && v.pitch === p) { this.start(v, this.held[this.held.length - 1], v.vel, this.p[84] > 0.5); return; }
      if (this.held.length) return;
    }
    for (const v of this.v) if (v.on && v.held && v.pitch === p) { v.held = false; if (!free) { for (const e of v.fe) e.release(); for (const e of v.ae) e.release(); } }
  }
  allOff() { this.held = []; for (const v of this.v) if (v.on) { v.held = false; for (const e of v.fe) e.release(); for (const e of v.ae) e.release(); } }
  render(L, R, from, to) {
    const p = this.p, sr = this.sr, CT = 16, dtc = CT / sr, exp = p[89] > 0.5, vol = dbl(p[87]) * 0.25, free = p[91] > 0.5;
    const n = to - from, lv = [0, 0];
    for (let l = 0; l < 2; l++) {                                                     // LFOs are global (as in Live's Analog)
      const b = 70 + l * 5; this.lph[l] += p[b + 2] * n / sr; if (this.lph[l] >= 1) { this.lph[l] -= Math.floor(this.lph[l]); this.lsh[l] = rnd(this.rng) * 2 - 1; }
      const x = (this.lph[l] + p[b + 4]) % 1, w = Math.round(p[b + 1]);   /* Phase offset */ lv[l] = p[b] > 0.5 ? (w === 1 ? 1 - 4 * Math.abs(x - 0.5) : w === 2 ? (x < 0.5 ? 1 : -1) : w === 3 ? this.lsh[l] : w === 4 ? rnd(this.rng) * 2 - 1 : Math.sin(TWO_PI * x)) : 0;
    }
    this.vph += p[86] * n / sr; const vib = Math.sin(TWO_PI * this.vph) * p[85] * 0.5; if (this.vph > 1e6) this.vph -= Math.floor(this.vph);
    const glide = p[83] > 0 ? Math.exp(-dtc / (p[83] * 0.001)) : 0;
    for (const v of this.v) {
      if (!v.on) continue;
      for (let i = from; i < to; i++) {
        if (v.cnt-- <= 0) {
          v.cnt = CT - 1;
          v.gf = glide ? v.f + (v.gf - v.f) * glide : v.f;
          const bendSt = this.bend / 2 * p[88] + vib + v.uni * p[82];
          for (let o = 0; o < 2; o++) {
            const b = o * 12, st = p[b + 4] * 12 + p[b + 5] + p[b + 6] + bendSt + lv[o] * p[b + 10] * 12 + (p[b + 9] ? v.fe[o].v * p[b + 9] * 12 : 0);
            v.d[o] = clamp((p[b + 11] > 0.5 ? v.gf : 261.63) * Math.pow(2, st / 12) / sr, 0, 0.45); v.pw[o] = 0.5 - p[b + 7] * 0.45;
          }
          let alive = false;
          for (let f = 0; f < 2; f++) {
            const b = 28 + f * 12, fe = v.fe[f].step(p[b + 7] * 0.001, p[b + 8] * 0.001, p[b + 9], p[b + 10] * 0.001, dtc, exp), ab = 54 + f * 8, ae = v.ae[f].step(p[ab + 3] * 0.001, p[ab + 4] * 0.001, p[ab + 5], p[ab + 6] * 0.001, dtc, exp);
            if (p[ab] > 0.5 && v.ae[f].st !== 0) alive = true;
            let fc = p[b + 2]; if (f === 1 && p[53] > 0.5) fc = p[30] * (p[b + 2] / 1000);   // Follow: Fil 2 = Fil 1 frequency x (its own Freq / 1 kHz)
            fc = clamp(fc * Math.pow(2, fe * p[b + 4] * 7 + lv[f] * p[b + 11] * 3 + p[b + 5] * (v.pitch - 60) / 12), 20, sr * 0.45);
            v.g[f] = Math.tan(Math.PI * fc / sr); v.k[f] = 2 - 1.97 * p[b + 3]; v.inv[f] = 1 / (1 + v.g[f] * (v.g[f] + v.k[f]));
            v.amp[f] = p[ab] > 0.5 ? ae * dbl(p[ab + 1]) * (0.3 + 0.7 * v.vel) * (1 + lv[f] * p[ab + 7]) : 0;
          }
          if (!alive || (free && v.ae[0].st === 0 && v.ae[1].st === 0)) { v.on = false; break; }
        }
        // ---- sources
        let s1 = 0, s2 = 0;
        for (let o = 0; o < 2; o++) {
          const b = o * 12; if (p[b] < 0.5) continue;
          v.ph[o] += v.d[o]; if (v.ph[o] >= 1) v.ph[o] -= 1;
          const a = v.ph[o], dt = v.d[o], sh = Math.round(p[b + 3]); let x;
          if (sh === 0) x = Math.sin(TWO_PI * a); else if (sh === 1) x = 2 * a - 1 - polyBlep(a, dt);
          else if (sh === 2) { const pw = v.pw[o]; let c = a + (1 - pw); if (c >= 1) c -= 1; x = (a < pw ? 1 : -1) + polyBlep(a, dt) - polyBlep(c, dt); }
          else x = rnd(this.rng) * 2 - 1;
          if (p[b + 8] > 0) { v.sub[o] += dt * 0.5; if (v.sub[o] >= 1) v.sub[o] -= 1; x = x * (1 - p[b + 8] * 0.5) + (v.sub[o] < 0.5 ? 1 : -1) * p[b + 8] * 0.5; }   // Sub: square one octave down
          x *= dbl(p[b + 1]); s1 += x * (1 - p[b + 2]); s2 += x * p[b + 2];
        }
        if (p[24] > 0.5) { const w = rnd(this.rng) * 2 - 1, c = 1 - Math.exp(-TWO_PI * p[27] / sr); v.nz += (w - v.nz) * c; const x = v.nz * dbl(p[25]) * 2; s1 += x * (1 - p[26]); s2 += x * p[26]; }
        // ---- filters (Fil 1 -> Amp 1, partly into Fil 2 with To F2; Fil 2 -> Amp 2)
        let y1 = 0, y2 = 0;
        for (let f = 0; f < 2; f++) {
          const b = 28 + f * 12, ty = Math.round(p[b + 1]), on = p[b] > 0.5, fl = f ? v.f2 : v.f1;
          let x = f ? s2 + y1 * p[52] : s1; let y;
          if (!on) y = x;
          else {
            const lp = fl[0].run(x, v.g[f], v.k[f], v.inv[f]);
            switch (ty) {
              case 1: y = fl[1].run(lp, v.g[f], v.k[f] + 0.4, 1 / (1 + v.g[f] * (v.g[f] + v.k[f] + 0.4))); break;   // LP24
              case 2: y = fl[0].bp; break; case 3: fl[1].run(fl[0].bp, v.g[f], v.k[f], v.inv[f]); y = fl[1].bp; break;
              case 4: y = x - fl[0].bp * v.k[f]; break; case 5: y = fl[0].h; break; case 6: fl[1].run(fl[0].h, v.g[f], v.k[f], v.inv[f]); y = fl[1].h; break;
              default: y = lp;
            }
            y = drive(y, Math.round(p[b + 6]));
          }
          if (f === 0) { y1 = y; } else y2 = y;
        }
        const o1 = y1 * v.amp[0] * (1 - p[52] * 0.5), o2 = y2 * v.amp[1], pa = clamp(p[56] + v.pan * 0.5, -1, 1), pb = clamp(p[64] + v.pan * 0.5, -1, 1);
        L[i] += (o1 * Math.min(1, 1 - pa) + o2 * Math.min(1, 1 - pb)) * vol; R[i] += (o1 * Math.min(1, 1 + pa) + o2 * Math.min(1, 1 + pb)) * vol;
      }
    }
  }
}
