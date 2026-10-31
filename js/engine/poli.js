// Poli (Live 12): a polysynth in the spirit of the classic one-oscillator boards. Per voice: saw, pulse (PW + PWM), sub (square or saw one
// octave down), coloured noise and a ring modulator (saw or pulse times a sine at the note + Freq), cross-modulation (sub -> saw / pulse
// frequency); high-pass (with the "Sub" bass boost) and a 24 dB low-pass with resonance; filter envelope (can loop) and amp envelope;
// one LFO (free or synced, retrigger, fade-in); a modulation grid (LFO / Filter Env / Amp Env and Velocity / Key into LPF, HPF, Vol, Pitch,
// PWM, RM Freq, LFO Freq); chorus off / A / B / C, random pan, glide, Poly / Mono / Unison with spread, pitch bend.
// Parameter indices: defs.js INSTRUMENTS[16] (POLI_GRID / POLI_MIDI give the grid cells; 58 chorus, 59 random pan, 60 volume, 61 PB range,
// 62 PB all, 63 glide mode, 64 glide time, 65 voices mode, 66 spread, 67..70 amp envelope).
import { TWO_PI, clamp, midiToHz, lcg, polyBlep } from './dsp.js';

export const POLI_TGT = ['LPF', 'HPF', 'Vol', 'Pitch', 'PWM', 'RM Freq', 'LFO Freq'];
// [target, source] -> parameter index; sources 0 LFO, 1 Filter Env, 2 Amp Env (Live leaves Vol x Amp Env, LFO Freq x LFO / Amp Env empty)
export const POLI_GRID = {}; export const POLI_MIDI = {};
{ let k = 26; for (let t = 0; t < 7; t++) for (let s = 0; s < 3; s++) { if ((t === 2 && s === 2) || (t === 6 && s !== 1)) continue; POLI_GRID[t + ',' + s] = k++; }
  for (let t = 0; t < 7; t++) for (let s = 0; s < 2; s++) POLI_MIDI[t + ',' + s] = k++; }   // 26..43 grid, 44..57 velocity / key
export const POLI_SYNC = [0.25, 0.5, 1, 2, 4, 8, 16];
const rnd = (o) => lcg(o) / 4294967296;
const dbl = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));
class Env {
  constructor() { this.st = 0; this.v = 0; }
  start() { this.st = 1; }
  release() { if (this.st) this.st = 4; }
  step(a, d, s, r, dt, loop) {
    switch (this.st) {
      case 1: this.v += dt / Math.max(0.0005, a); if (this.v >= 1) { this.v = 1; this.st = 2; } break;
      case 2: this.v += (s - this.v) * (1 - Math.exp(-dt * 4.6 / Math.max(0.0005, d))); if (Math.abs(this.v - s) < 2e-3) { this.v = s; this.st = loop ? 5 : 3; } break;
      case 3: this.v = s; break;
      case 5: this.v -= this.v * (1 - Math.exp(-dt * 4.6 / Math.max(0.0005, r))); if (this.v < 0.01) this.st = 1; break;   // Loop: release back down, then attack again
      case 4: this.v -= this.v * (1 - Math.exp(-dt * 4.6 / Math.max(0.0005, r))); if (this.v < 1e-4) { this.v = 0; this.st = 0; } break;
      default: return 0;
    }
    return this.v;
  }
}
class Svf { constructor() { this.a = 0; this.b = 0; } run(x, g, k, inv) { const h = (x - (k + g) * this.a - this.b) * inv, bp = g * h + this.a, lp = g * bp + this.b; this.a = g * h + bp; this.b = g * bp + lp; this.h = h; return lp; } }
const mkVoice = () => ({ on: false, held: false, pitch: 0, vel: 0, age: 0, f: 0, gf: 0, ps: 0, pp: 0, pb: 0, pr: 0, nz: 0, fe: new Env(), ae: new Env(), lp: [new Svf(), new Svf()], hp: new Svf(), ls: 0, cnt: 0, t: 0, pan: 0, det: 0,
  dS: 0, dB: 0, dR: 0, pw: 0.5, g: 0, k: 2, i1: 1, i2: 1, hg: 0, hi: 1, amp: 0, ring: 0, lph: 0 });

export class Poli {
  constructor(sr) {
    this.sr = sr; this.counter = 0; this.rng = { seed: 616 }; this.bend = 0; this.bpm = 120; this.p = new Array(71).fill(0); this.v = Array.from({ length: 16 }, mkVoice); this.lph = 0; this.lsh = 0; this.held = []; this.mix = [0, 0, 0, 0, 0];
    const N = 2048; this.cl = new Float32Array(N); this.cr = new Float32Array(N); this.cw = 0; this.cph = 0; this.CM = N - 1;
  }
  setTempo(b) { this.bpm = b; }
  setBend(st) { this.bend = st; }
  setParam(i, x) { this.p[i] = x; }
  active() { for (const v of this.v) if (v.on) return true; return false; }
  mode() { return Math.round(this.p[65]); }        // 0 Poly, 1 Mono, 2 Unison
  start(v, p, vel, leg) {
    const f = midiToHz(p), g = Math.round(this.p[63]);
    v.gf = g === 0 || !v.on && g !== 1 ? f : (v.f || f); if (g === 2 && !leg) v.gf = f;       // Glide: Off / On / Legato (only between overlapping notes)
    v.on = v.held = true; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.f = f; v.pan = (rnd(this.rng) * 2 - 1) * this.p[59];
    if (!leg) { v.fe.start(); v.ae.start(); v.t = 0; v.lph = this.p[13] > 0.5 ? 0 : this.lph; }   // LFO R off: the voice joins the free-running LFO
  }
  noteOn(p, vel) {
    const m = this.mode();
    if (m === 1) { this.held = this.held.filter((x) => x !== p); this.held.push(p); const v = this.v[0], leg = v.on && v.held; this.start(v, p, vel, leg); v.det = 0; return; }
    const n = m === 2 ? 4 : 1;
    for (let u = 0; u < n; u++) {
      let k = -1; for (let i = 0; i < 16; i++) if (!this.v[i].on) { k = i; break; } if (k < 0) { k = 0; for (let i = 1; i < 16; i++) if (this.v[i].age < this.v[k].age) k = i; }
      const v = this.v[k]; this.start(v, p, vel, false); v.det = n > 1 ? (u / (n - 1) - 0.5) * this.p[66] * 0.5 : 0; if (n > 1) v.pan = (u / (n - 1) - 0.5) * 2 * Math.max(this.p[66], this.p[59]);
    }
  }
  noteOff(p) {
    if (this.mode() === 1) { this.held = this.held.filter((x) => x !== p); const v = this.v[0]; if (this.held.length && v.pitch === p) { this.start(v, this.held[this.held.length - 1], v.vel, true); return; } if (this.held.length) return; }
    for (const v of this.v) if (v.on && v.held && v.pitch === p) { v.held = false; v.fe.release(); v.ae.release(); }
  }
  allOff() { this.held = []; for (const v of this.v) if (v.on) { v.held = false; v.fe.release(); v.ae.release(); } }
  render(L, R, from, to) {
    const p = this.p, sr = this.sr, CT = 16, dtc = CT / sr, n = to - from, G = POLI_GRID, M = POLI_MIDI;
    const lfoHz = p[12] > 0.5 ? this.bpm / 60 / POLI_SYNC[clamp(Math.round(p[15]), 0, 6)] : p[14];
    const mix = this.mix; mix[0] = p[5] * p[5]; mix[1] = p[6] * p[6]; mix[2] = p[7] * p[7]; mix[3] = p[8] * p[8]; mix[4] = p[9] * p[9]; const subSaw = Math.round(p[2]) === 1, rmPulse = Math.round(p[4]) === 1, vol = dbl(p[60]) * 0.22, glide = Math.round(p[63]) > 0 && p[64] > 0 ? Math.exp(-dtc / (p[64] * 0.001)) : 0;
    const nc = 1 - Math.exp(-TWO_PI * (200 * Math.pow(100, p[3])) / sr), boost = p[17] > 0.5, bendAll = p[62] > 0.5;
    const cell = (k) => (k === undefined ? 0 : p[k]);
    this.lph += lfoHz * n / sr; if (this.lph > 1e6) this.lph -= Math.floor(this.lph);
    for (const v of this.v) {
      if (!v.on) continue;
      let gl = 0, gr = 0;
      for (let i = from; i < to; i++) {
        if (v.cnt-- <= 0) {
          v.cnt = CT - 1; v.t += dtc;
          const fe = v.fe.step(p[22] * 0.001, p[23] * 0.001, p[24], p[25] * 0.001, dtc, p[21] > 0.5), ae = v.ae.step(p[67] * 0.001, p[68] * 0.001, p[69], p[70] * 0.001, dtc, false);
          if (v.ae.st === 0) { v.on = false; break; }
          const src = (t) => { const fade = p[16] > 0 ? Math.min(1, v.t / p[16]) : 1, lf = this.lfoV(v) * fade; return cell(G[t + ',0']) * lf + cell(G[t + ',1']) * fe + cell(G[t + ',2']) * ae + cell(M[t + ',0']) * v.vel + cell(M[t + ',1']) * (v.pitch - 60) / 60; };
          v.lph += lfoHz * Math.pow(2, src(6) * 4) * dtc; if (v.lph >= 1) { v.lph -= Math.floor(v.lph); v.lsh = rnd(this.rng) * 2 - 1; }
          v.gf = glide ? v.f + (v.gf - v.f) * glide : v.f;
          const bendOn = bendAll || v.held, f = v.gf * Math.pow(2, (src(3) * 12 + (bendOn ? this.bend / 2 * p[61] : 0) + v.det) / 12);
          v.dS = clamp(f / sr, 0, 0.45); v.pw = clamp(0.5 - p[1] * 0.45 - src(4) * 0.4, 0.05, 0.95); v.ring = clamp((f + p[10]) * Math.pow(2, src(5) * 2) / sr, 0, 0.45);   // RM Freq modulation: +-2 octaves
          const lpf = clamp(p[19] * Math.pow(2, src(0) * 6), 20, sr * 0.45), hpf = clamp(p[18] * Math.pow(2, src(1) * 6), 10, sr * 0.45);
          v.g = Math.tan(Math.PI * lpf / sr); v.k = 2 - 1.95 * p[20]; v.i1 = 1 / (1 + v.g * (v.g + v.k)); v.i2 = 1 / (1 + v.g * (v.g + v.k + 0.3));
          v.hg = Math.tan(Math.PI * hpf / sr); v.hi = 1 / (1 + v.hg * (v.hg + 1.4142));
          v.amp = ae * clamp(1 + src(2), 0, 2) * vol; const pan = clamp(v.pan, -1, 1); gl = v.amp * Math.min(1, 1 - pan); gr = v.amp * Math.min(1, 1 + pan);
        }
        const dt = v.dS;
        v.ps += dt * 0.5; if (v.ps >= 1) v.ps -= 1;                                           // sub (one octave down) drives the cross-mod
        const sub = subSaw ? 2 * v.ps - 1 : (v.ps < 0.5 ? 1 : -1);
        const d2 = clamp(dt * (1 + p[0] * sub * 0.8), 0, 0.45);
        v.pb += d2; if (v.pb >= 1) v.pb -= 1;
        const a = v.pb, saw = 2 * a - 1 - polyBlep(a, d2); let c = a + (1 - v.pw); if (c >= 1) c -= 1;
        const pulse = (a < v.pw ? 1 : -1) + polyBlep(a, d2) - polyBlep(c, d2);
        v.pr += v.ring; if (v.pr >= 1) v.pr -= 1;
        let x = saw * mix[0] + pulse * mix[1] + sub * mix[2] + (rmPulse ? pulse : saw) * Math.sin(TWO_PI * v.pr) * mix[4];
        if (mix[3]) { v.nz += (rnd(this.rng) * 2 - 1 - v.nz) * nc; x += v.nz * mix[3] * 1.5; }
        let y = v.hp.run(x, v.hg, 1.4142, v.hi); y = v.hp.h;                                      // high-pass
        if (boost) { v.ls += (x - v.ls) * 0.01; y += v.ls * 0.8; }                                // "Sub": the low end comes back in
        y = v.lp[1].run(v.lp[0].run(y, v.g, v.k, v.i1), v.g, v.k + 0.3, v.i2);
        L[i] += y * gl; R[i] += y * gr;
      }
    }
    // chorus: - / A / B / C (A + B), two modulated delays in opposite phase
    const ch = Math.round(p[58]); if (!ch) return;
    const rate = ch === 1 ? 0.5 : ch === 2 ? 0.83 : 0.65, depth = ch === 1 ? 0.0019 : ch === 2 ? 0.0035 : 0.0028, base = 0.0045 * sr, M2 = this.CM;
    for (let i = from; i < to; i++) {
      this.cph += rate / sr; if (this.cph >= 1) this.cph -= 1;
      const m = Math.sin(TWO_PI * this.cph) * depth * sr, xl = L[i], xr = R[i];
      this.cl[this.cw & M2] = (xl + xr) * 0.5; const rd = (dd) => { const pos = this.cw - dd, k = Math.floor(pos), f = pos - k; return this.cl[k & M2] * (1 - f) + this.cl[(k + 1) & M2] * f; };
      L[i] = xl * 0.7 + rd(base + m) * 0.6; R[i] = xr * 0.7 + rd(base - m) * 0.6; this.cw++;
    }
  }
  lfoV(v) {
    const w = Math.round(this.p[11]), x = v.lph - Math.floor(v.lph);
    switch (w) { case 1: return 1 - 4 * Math.abs(x - 0.5); case 2: return 2 * x - 1; case 3: return 1 - 2 * x; case 4: return x < 0.5 ? 1 : -1; case 5: return v.lsh; case 6: return rnd(this.rng) * 2 - 1; default: return Math.sin(TWO_PI * x); }
  }
}
