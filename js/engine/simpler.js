// Simpler (Live 12): one sample (zone 0 of the project's zone system: parameters 200 + field, see project.js ZONE_FIELDS) played in
// Classic (start / length, loop with crossfade, amp envelope), 1-Shot (plays through; Trigger or Gate, fade in / out) or Slice mode
// (slices by transients / beats / equal regions, one per key from C1, Mono or Poly playback). Warp: Re-Pitch (speed follows the tempo) or
// Beats (two-grain time stretch, pitch kept), the sample spanning "as N Beats". Filter (LP / HP / BP / notch, 12 / 24 dB, circuit flavour,
// envelope, velocity and key), LFO (to volume, pitch, pan, filter), pitch envelope, pan / random pan / spread, transpose / detune / glide.
// Parameter indices: defs.js INSTRUMENTS[18]; SIM_Z0 = 200 is the zone block.
import { TWO_PI, clamp, midiToHz, lcg } from './dsp.js';

export const SIM_Z0 = 200;
const rnd = (o) => lcg(o) / 4294967296;
const dbl = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));
export const SIM_SYNC = [0.25, 0.5, 1, 2, 4, 8, 16];
class Env {
  constructor() { this.st = 0; this.v = 0; }
  start() { this.st = 1; this.v = 0; }
  release() { if (this.st) this.st = 4; }
  step(a, d, s, r, dt) {
    switch (this.st) {
      case 1: this.v += dt / Math.max(0.0001, a); if (this.v >= 1) { this.v = 1; this.st = 2; } break;
      case 2: this.v += (s - this.v) * (1 - Math.exp(-dt * 4.6 / Math.max(0.0005, d))); if (Math.abs(this.v - s) < 1e-3) { this.v = s; this.st = 3; } break;
      case 3: this.v = s; break;
      case 4: this.v -= this.v * (1 - Math.exp(-dt * 4.6 / Math.max(0.0005, r))); if (this.v < 1e-4) { this.v = 0; this.st = 0; } break;
      default: return 0;
    }
    return this.v;
  }
}
class Svf { constructor() { this.a = 0; this.b = 0; } run(x, g, k, inv) { const h = (x - (k + g) * this.a - this.b) * inv, bp = g * h + this.a, lp = g * bp + this.b; this.a = g * h + bp; this.b = g * bp + lp; this.h = h; this.bp = bp; return lp; } }
const mkVoice = () => ({ on: false, held: false, pitch: 0, vel: 0, age: 0, pos: 0, tpos: 0, g0: 0, g1: 0, gp: 0, s0: 0, s1: 0, end: 0, slice: -1, ae: new Env(), fe: new Env(), pe: new Env(), fl: [new Svf(), new Svf()], fr: [new Svf(), new Svf()], lph: 0, lsh: 0, t: 0,
  cnt: 0, rate: 1, gl: 0, amp: 0, pl: 1, pr: 1, g: 0, k: 2, i1: 1, i2: 1, rp: 0, gf: 0, fadeOut: -1, fo: 1, det: 0, span: 0 });

export class Simpler {
  constructor(sr, bank) {
    this.sr = sr; this.bank = bank; this.counter = 0; this.rng = { seed: 1818 }; this.bend = 0; this.bpm = 120; this.p = new Array(64).fill(0);
    this.z = { id: -1, root: 60, s0: 0, s1: 1, l0: 0, l1: 1, xf: 0, rev: false, vol: 0 }; this.v = Array.from({ length: 32 }, mkVoice); this.slices = null; this.sliceKey = ''; this.lastF = 0;
  }
  setTempo(b) { this.bpm = b; }
  setBend(st) { this.bend = st; }
  setParam(i, x) {
    if (i >= SIM_Z0) { const f = i - SIM_Z0, z = this.z; switch (f) { case 0: z.id = x | 0; break; case 1: z.root = clamp(x | 0, 0, 127); break; case 8: z.s0 = clamp(x, 0, 1); break; case 9: z.s1 = clamp(x, 0, 1); break; case 10: z.l0 = clamp(x, 0, 1); break; case 11: z.l1 = clamp(x, 0, 1); break; case 12: z.xf = clamp(x, 0, 1); break; case 13: z.rev = x > 0.5; break; case 14: z.vol = x; break; } return; }
    this.p[i] = x;
  }
  active() { for (const v of this.v) if (v.on) return true; return false; }
  smp() { const s = this.z.id >= 0 ? this.bank[this.z.id] : null; return s && s.frames > 4 ? s : null; }
  // slice start frames (Slice mode): transients (energy jumps above Sensitivity), beats (Division of the warped length) or equal regions
  getSlices(s) {
    const p = this.p, key = [this.z.id, s.frames, Math.round(p[9]), p[10].toFixed(3), Math.round(p[11]), Math.round(p[12]), Math.round(p[15]), this.z.s0, this.z.s1].join(',');
    if (key === this.sliceKey && this.slices) return this.slices;
    const a = Math.floor(this.z.s0 * s.frames), b = Math.max(a + 64, Math.floor(this.z.s1 * s.frames)), out = [a], by = Math.round(p[9]);
    if (by === 0) {                                                        // transients: 10 ms blocks, energy rise ratio
      const blk = Math.max(64, Math.round(this.sr * 0.01)), thr = 1.5 + (1 - p[10]) * 6; let prev = 1e-6, last = a;
      for (let i = a; i + blk < b; i += blk) { let e = 0; for (let j = i; j < i + blk; j++) e += s.l[j] * s.l[j]; e /= blk; if (e > prev * thr && e > 1e-5 && i - last > this.sr * 0.05) { out.push(i); last = i; } prev = prev * 0.6 + e * 0.4; if (out.length >= 64) break; }
    } else if (by === 1) { const beats = Math.max(1, Math.round(p[15])), div = [0.25, 0.5, 1, 2, 4][clamp(Math.round(p[11]), 0, 4)], n = Math.max(1, Math.round(beats / div)), step = (b - a) / n; for (let k = 1; k < Math.min(64, n); k++) out.push(Math.round(a + k * step)); }
    else { const n = clamp(Math.round(p[12]), 2, 64), step = (b - a) / n; for (let k = 1; k < n; k++) out.push(Math.round(a + k * step)); }
    out.push(b); this.slices = out; this.sliceKey = key; return out;
  }
  noteOn(p, vel) {
    const s = this.smp(); if (!s) return;
    const P = this.p, mode = Math.round(P[0]), n = clamp(Math.round(P[4]), 1, 32);
    let s0 = Math.floor(Math.min(this.z.s0, this.z.s1) * s.frames), s1 = Math.floor(Math.max(this.z.s0, this.z.s1) * s.frames), slice = -1;
    if (mode === 2) { const sl = this.getSlices(s); slice = p - 36; if (slice < 0 || slice >= sl.length - 1) return; s0 = sl[slice]; s1 = sl[slice + 1];
      if (Math.round(P[13]) === 0) for (const v of this.v) if (v.on) { v.fadeOut = 0.004; v.held = false; } }   // Mono: a new slice cuts the playing one
    if (P[3] > 0.5) { let k = s0; while (k < s1 - 1 && !((s.l[k] <= 0 && s.l[k + 1] > 0))) k++; if (k < s1 - 1) s0 = k; }   // Snap: start on a zero crossing
    const spread = P[51], copies = spread > 0.005 ? 2 : 1;
    for (let c = 0; c < copies; c++) {
      let v = null; let used = 0; for (let k = 0; k < n; k++) if (this.v[k].on) used++;
      if (P[5] > 0.5 && mode !== 2) for (const x of this.v) if (x.on && x.pitch === p) { v = x; break; }                    // Retrig: the same note restarts its voice
      if (!v) { for (let k = 0; k < n; k++) if (!this.v[k].on) { v = this.v[k]; break; } if (!v) { v = this.v[0]; for (let k = 1; k < n; k++) if (this.v[k].age < v.age) v = this.v[k]; } }
      v.on = v.held = true; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.s0 = s0; v.s1 = s1; v.slice = slice; v.t = 0; v.fadeOut = -1; v.fo = 1;
      v.pos = this.z.rev ? s1 - 1 : s0; v.tpos = v.pos; v.gp = 0; v.det = copies > 1 ? (c ? 1 : -1) * spread * 25 : 0;
      const pan = clamp(P[49] + (rnd(this.rng) * 2 - 1) * P[50] + (copies > 1 ? (c ? 1 : -1) * spread : 0), -1, 1); v.rp = pan;
      v.ae.start(); v.fe.start(); v.pe.start(); if (P[38] > 0.5) v.lph = P[37] / 360; else v.lph = this.lastL || 0;
      const f = midiToHz(p); v.gf = Math.round(P[54]) > 0 && this.lastF ? this.lastF : f; this.lastF = f;
      for (const x of v.fl) { x.a = 0; x.b = 0; } for (const x of v.fr) { x.a = 0; x.b = 0; }
    }
  }
  noteOff(p) {
    const mode = Math.round(this.p[0]);
    for (const v of this.v) if (v.on && v.held && v.pitch === p) {
      v.held = false;
      if (mode === 1) { if (Math.round(this.p[6]) === 1) v.fadeOut = Math.max(0.001, this.p[8] * 0.001); }   // 1-Shot: Gate fades out at note-off, Trigger plays through
      else { v.ae.release(); v.fe.release(); v.pe.release(); }
    }
  }
  allOff() { for (const v of this.v) if (v.on) { v.held = false; v.ae.release(); v.fe.release(); v.pe.release(); if (Math.round(this.p[0]) === 1) v.fadeOut = 0.01; } }
  read(s, pos) { const i = Math.floor(pos), f = pos - i, n = s.frames; if (i < 0 || i >= n - 1) { this.ol = 0; this.or = 0; return; } this.ol = s.l[i] + (s.l[i + 1] - s.l[i]) * f; this.or = s.r[i] + (s.r[i + 1] - s.r[i]) * f; }   // linear read into ol / or (no allocation)
  filt(F, x, v, ft, two) { let y = F[0].run(x, v.g, v.k, v.i1), o = ft === 1 ? F[0].h : ft === 2 ? F[0].bp : ft === 3 ? x - F[0].bp * v.k : y;
    if (two) { y = F[1].run(o, v.g, v.k + 0.3, v.i2); o = ft === 1 ? F[1].h : ft === 2 ? F[1].bp : ft === 3 ? o - F[1].bp * v.k : y; } return o; }
  render(L, R, from, to) {
    const s = this.smp(); if (!s) { for (const v of this.v) v.on = false; return; }
    const P = this.p, sr = this.sr, CT = 16, dtc = CT / sr, mode = Math.round(P[0]), gain = dbl(P[1]) * dbl(this.z.vol) * dbl(P[61]) * 0.8, loop = mode === 0 && P[2] > 0.5;
    const warp = P[14] > 0.5, beats = Math.max(1, P[15]), stretch = warp ? ((Math.max(this.z.s1, this.z.s0) - Math.min(this.z.s1, this.z.s0)) * s.frames / sr) / (beats * 60 / this.bpm) : 1, wBeats = warp && Math.round(P[16]) === 1;
    const lfoHz = P[32] > 0.5 ? this.bpm / 60 / SIM_SYNC[clamp(Math.round(P[34]), 0, 6)] : P[33];
    this.lastL = ((this.lastL || 0) + lfoHz * (to - from) / sr) % 1;
    const glide = Math.round(P[54]) > 0 && P[55] > 0 ? Math.exp(-dtc / (P[55] * 0.001)) : 0, ftype = Math.round(P[18]), two = Math.round(P[19]) === 1, circ = Math.round(P[20]), fon = P[17] > 0.5;
    for (const v of this.v) {
      if (!v.on) continue;
      for (let i = from; i < to; i++) {
        if (v.cnt-- <= 0) {
          v.cnt = CT - 1; v.t += dtc;
          const ae = mode === 1 ? 1 : v.ae.step(P[56] * 0.001, P[57] * 0.001, P[58], P[59] * 0.001, dtc);
          if (mode !== 1 && v.ae.st === 0) { v.on = false; break; }
          if (v.fadeOut >= 0) { v.fo -= dtc / Math.max(0.001, v.fadeOut); if (v.fo <= 0) { v.on = false; break; } }
          const fe = v.fe.step(P[26] * 0.001, P[27] * 0.001, P[28], P[29] * 0.001, dtc), pe = P[43] > 0.5 ? v.pe.step(P[45] * 0.001, P[46] * 0.001, P[47], P[48] * 0.001, dtc) * P[44] : 0;
          v.lph += lfoHz * Math.pow(2, P[36] * (v.pitch - 60) / 12) * dtc; if (v.lph >= 1) { v.lph -= Math.floor(v.lph); v.lsh = rnd(this.rng) * 2 - 1; }
          const fade = P[35] > 0 ? Math.min(1, v.t / (P[35] * 0.001)) : 1, lw = Math.round(P[31]), x = v.lph - Math.floor(v.lph);
          const lfo = P[30] > 0.5 ? (lw === 1 ? (x < 0.5 ? 1 : -1) : lw === 2 ? 1 - 4 * Math.abs(x - 0.5) : lw === 3 ? 1 - 2 * x : lw === 4 ? 2 * x - 1 : lw === 5 ? v.lsh : Math.sin(TWO_PI * x)) * fade : 0;
          const f = midiToHz(v.pitch); v.gf = glide ? f + (v.gf - f) * glide : f;
          const st = (mode === 2 ? 0 : 12 * Math.log2(v.gf / midiToHz(this.z.root))) + P[52] + (P[53] + v.det) / 100 + pe + lfo * P[40] * 12 + this.bend;
          v.rate = Math.pow(2, st / 12) * (warp && !wBeats ? stretch : 1); v.span = wBeats ? stretch : 1;
          const fc = clamp(P[21] * Math.pow(2, fe * P[25] * 6 + P[23] * (v.vel - 0.5) * 4 + P[24] * (v.pitch - 60) / 12 + lfo * P[42] * 3), 20, sr * 0.45);
          v.g = Math.tan(Math.PI * fc / sr); v.k = 2 - 1.95 * P[22]; v.i1 = 1 / (1 + v.g * (v.g + v.k)); v.i2 = 1 / (1 + v.g * (v.g + v.k + 0.3));
          let fi = 1; if (mode === 1) { const pos0 = Math.abs(v.tpos - (this.z.rev ? v.s1 : v.s0)) / sr, rem = Math.abs((this.z.rev ? v.s0 : v.s1) - v.tpos) / sr; fi = Math.min(1, P[7] > 0 ? pos0 / (P[7] * 0.001) : 1, P[8] > 0 ? rem / (P[8] * 0.001) : 1); }
          v.amp = ae * fi * v.fo * gain * (1 - P[60] + P[60] * v.vel) * clamp(1 + lfo * P[39], 0, 2);
          const pan = clamp(v.rp + lfo * P[41], -1, 1); v.pl = Math.min(1, 1 - pan); v.pr = Math.min(1, 1 + pan);
        }
        // ---- sample playback (Re-Pitch: one read head; Beats: the timeline moves at the warp speed, two overlapping grains read at the pitch)
        const dir = this.z.rev ? -1 : 1; let l, r;
        if (v.span !== 1) {
          const G = Math.round(sr * 0.05); v.tpos += dir * v.span; v.gp += 1; if (v.gp >= G) v.gp = 0;
          const a = v.gp / G, o1 = v.tpos + dir * v.gp * (v.rate - v.span), o2 = v.tpos + dir * ((v.gp + G / 2) % G) * (v.rate - v.span), w1 = Math.sin(Math.PI * a), w2 = Math.sin(Math.PI * ((a + 0.5) % 1));
          this.read(s, o1); l = this.ol * w1; r = this.or * w1; this.read(s, o2); l += this.ol * w2; r += this.or * w2;
        } else { v.tpos += dir * v.rate; this.read(s, v.tpos); l = this.ol; r = this.or; }
        // loop / end
        const lenF = v.s1 - v.s0;
        if (loop) { const la = v.s0 + Math.min(this.z.l0, this.z.l1) * lenF, lb = v.s0 + Math.max(this.z.l0, this.z.l1) * lenF, ll = Math.max(64, lb - la), xfN = this.z.xf * ll * 0.5;
          if (dir > 0 && v.tpos >= lb) v.tpos -= ll; else if (dir < 0 && v.tpos <= la) v.tpos += ll;
          if (xfN > 1) { const d2 = dir > 0 ? lb - v.tpos : v.tpos - la; if (d2 < xfN) { const w = d2 / xfN; this.read(s, v.tpos - dir * ll); l = l * w + this.ol * (1 - w); r = r * w + this.or * (1 - w); } } }
        else if ((dir > 0 && v.tpos >= v.s1) || (dir < 0 && v.tpos <= v.s0)) { v.on = false; break; }
        // filter (circuit = drive flavour) and output
        if (fon) {
          if (circ) { const d = [1, 1.6, 2.4, 1.2, 3][circ]; l = Math.tanh(l * d) / d * (circ === 3 ? 1.2 : 1); r = Math.tanh(r * d) / d * (circ === 3 ? 1.2 : 1); }
          l = this.filt(v.fl, l, v, ftype, two); r = this.filt(v.fr, r, v, ftype, two);
        }
        L[i] += l * v.amp * v.pl; R[i] += r * v.amp * v.pr;
      }
    }
  }
}
