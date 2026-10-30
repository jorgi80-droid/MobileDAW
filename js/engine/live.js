// Ableton-style Sampler (type 10) and Wavetable (type 11) for the web engine.
// Interface like every instrument: noteOn(p, vel), noteOff(p), allOff(), setParam(i, v), render(L, R, from, to) (adds into the buffers), active(), setTempo().
import { TWO_PI, clamp, midiToHz, lcg, Biquad, Adsr, adsrParams, fastTanh, JOBS, runJobNow } from './dsp.js';

const PI = Math.PI;
const dbLin = (db) => Math.pow(10, db / 20);
const herm = (y0, y1, y2, y3, fr) => { const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2); return ((c3 * fr + c2) * fr + c1) * fr + y1; };
class VoiceBase {
  constructor(sr) { this.sr = sr; this.counter = 0; this.rng = { seed: 987654321 }; }
  setTempo() {}
  active() { for (const v of this.v) if (v.on) return true; return false; }
}
const blep = (t, dt) => { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; };   // polyBLEP residual (band-limited saw / square edges)
// 0 sine, 1 triangle, 2 saw (rising), 3 square, 4 sample & hold
function lfoShape(shape, ph, hold) {
  switch (shape) {
    case 0: return Math.sin(TWO_PI * ph);
    case 1: return 4 * Math.abs(ph - 0.5) - 1;
    case 2: return 2 * ph - 1;
    case 3: return ph < 0.5 ? 1 : -1;
    default: return hold;
  }
}

// =============================================================================================== Sampler
// Global parameters (same order as INSTRUMENTS[10] in defs.js)
export const SMP = {
  VOL: 0, PAN: 1, TRANSPOSE: 2, DETUNE: 3, SPREAD: 4, VOICES: 5, SCALE: 6, VOLVEL: 7, INTERP: 8,
  FON: 9, FTYPE: 10, FREQ: 11, RES: 12, FENV: 13, AA: 14, AD: 15, AS: 16, AR: 17, FA: 18, FD: 19, FS: 20, FR: 21,
  PENV: 22, PDEC: 23, LSHAPE: 24, LRATE: 25, LPITCH: 26, LFILT: 27, LVOL: 28, LPAN: 29, RELMODE: 30, SNAP: 31, TIME: 32,
  OSCON: 33, OSCWAVE: 34, OSCLVL: 35, OSCSEMI: 36, OSCDET: 37, SMPLVL: 38,   // Osc section of the Pitch/Osc tab (0 sine, 1 triangle, 2 saw, 3 square, 4 noise)
};
export const SMP_ZONE0 = 200, SMP_ZONE_N = 16, SMP_FIELDS = 16;
// zone field k at parameter 200 + zone*16 + k:
// 0 sample id, 1 root, 2 low key, 3 high key, 4 low vel, 5 high vel, 6 detune (ct), 7 sustain mode (0 off, 1 forward, 2 back-and-forth),
// 8 sample start, 9 sample end, 10 loop start, 11 loop end (all 0..1 of the sample), 12 crossfade (0..1 of the loop), 13 reverse, 14 zone volume dB, 15 zone pan

export class LiveSampler extends VoiceBase {
  constructor(sr, bank) {
    super(sr);
    this.bank = bank; this.pitch = 0; this.pitchNative = true;
    this.g = new Float64Array(40);
    const d = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 16, 6: 1, 7: 0.35, 8: 0, 9: 0, 10: 0, 11: 20000, 12: 0.707, 13: 0, 14: 0.001, 15: 0.6, 16: 1, 17: 0.05, 18: 0.001, 19: 0.6, 20: 1, 21: 0.05, 22: 0, 23: 0.15, 24: 0, 25: 4, 26: 0, 27: 0, 28: 0, 29: 0, 30: 0, 31: 0, 32: 1, 33: 0, 34: 0, 35: -12, 36: 0, 37: 0, 38: 0 };
    for (const k in d) this.g[k] = d[k];
    this.z = Array.from({ length: SMP_ZONE_N }, () => ({ id: -1, root: 60, lo: 0, hi: 127, vlo: 1, vhi: 127, det: 0, sus: 0, s0: 0, s1: 1, l0: 0, l1: 1, xf: 0, rev: false, vol: 0, pan: 0 }));
    this.v = Array.from({ length: 32 }, () => ({ on: false, held: false, pitch: 0, vel: 0, age: 0, env: new Adsr(), fenv: new Adsr(), id: -1, pos: 0, dir: 1, ratio: 1, rel: false, s0: 0, s1: 0, l0: 0, l1: 0, xf: 0, sus: 0, rev: false,
      zvol: 1, zpan: 0, dt: 0, vpan: 0, fl: new Biquad(), fr: new Biquad(), lfo: 0, hold: 0, pe: 1, base: 1, keyOff: 0, op: 0, sd: false, nz: 0 }));
    this.upEnv();
  }
  upEnv() {
    const g = this.g, t = Math.max(0.05, g[SMP.TIME]);
    this.ap = adsrParams(g[SMP.AA] * t, g[SMP.AD] * t, g[SMP.AS], g[SMP.AR] * t, this.sr);
    this.fp = adsrParams(g[SMP.FA] * t, g[SMP.FD] * t, g[SMP.FS], g[SMP.FR] * t, this.sr);
  }
  setParam(i, x) {
    if (i === 90) { this.pitch = clamp(x, -24, 24); return; }
    if (i >= SMP_ZONE0) {
      const zi = Math.floor((i - SMP_ZONE0) / SMP_FIELDS), k = (i - SMP_ZONE0) % SMP_FIELDS;
      if (zi >= SMP_ZONE_N) return;
      const q = this.z[zi];
      switch (k) {
        case 0: q.id = x | 0; break; case 1: q.root = clamp(x | 0, 0, 127); break; case 2: q.lo = clamp(x | 0, 0, 127); break; case 3: q.hi = clamp(x | 0, 0, 127); break;
        case 4: q.vlo = clamp(x | 0, 1, 127); break; case 5: q.vhi = clamp(x | 0, 1, 127); break; case 6: q.det = clamp(x, -100, 100); break; case 7: q.sus = clamp(x | 0, 0, 2); break;
        case 8: q.s0 = clamp(x, 0, 1); break; case 9: q.s1 = clamp(x, 0, 1); break; case 10: q.l0 = clamp(x, 0, 1); break; case 11: q.l1 = clamp(x, 0, 1); break;
        case 12: q.xf = clamp(x, 0, 1); break; case 13: q.rev = x > 0.5; break; case 14: q.vol = clamp(x, -60, 24); break; case 15: q.pan = clamp(x, -1, 1); break;
      }
      return;
    }
    if (i < 0 || i >= this.g.length) return;
    this.g[i] = x;
    if ((i >= SMP.AA && i <= SMP.FR) || i === SMP.TIME) this.upEnv();
  }
  alloc() {
    const n = clamp(Math.round(this.g[SMP.VOICES]), 1, this.v.length);
    let used = 0, oldest = 0, free = -1;
    for (let k = 0; k < this.v.length; k++) { const v = this.v[k]; if (v.on) { used++; if (this.v[oldest].age > v.age || !this.v[oldest].on) oldest = k; } else if (free < 0) free = k; }
    if (free >= 0 && used < n) return this.v[free];
    if (used >= n) { let o = -1; for (let k = 0; k < this.v.length; k++) if (this.v[k].on && (o < 0 || this.v[k].age < this.v[o].age)) o = k; if (o >= 0) return this.v[o]; }
    return free >= 0 ? this.v[free] : this.v[oldest];
  }
  start(q, s, p, vel, dt, pan) {
    const v = this.alloc(), g = this.g, frames = s.frames;
    v.on = v.held = true; v.rel = false; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.id = q.id;
    let a = Math.floor(Math.min(q.s0, q.s1) * (frames - 1)), b = Math.ceil(Math.max(q.s0, q.s1) * (frames - 1));
    let la = Math.floor(Math.min(q.l0, q.l1) * (frames - 1)), lb = Math.ceil(Math.max(q.l0, q.l1) * (frames - 1));
    if (g[SMP.SNAP] > 0.5) { a = this.zero(s, a); b = this.zero(s, b); la = this.zero(s, la); lb = this.zero(s, lb); }
    if (b - a < 2) b = Math.min(frames - 1, a + 2);
    la = clamp(la, a, b - 1); lb = clamp(lb, la + 1, b);
    v.s0 = a; v.s1 = b; v.sus = q.sus; v.rev = q.rev; v.xf = q.xf * (lb - la) * 0.5;
    if (q.rev) { const len = b - a; v.l0 = len - (lb - a); v.l1 = len - (la - a); v.pos = 0; } else { v.l0 = la - a; v.l1 = lb - a; v.pos = 0; }
    v.dir = 1;
    v.zvol = dbLin(q.vol) * (pan !== 0 ? 0.707 : 1); v.zpan = q.pan; v.vpan = pan;
    v.keyOff = ((p - q.root) * g[SMP.SCALE]) + g[SMP.TRANSPOSE] + this.pitch + (q.det + g[SMP.DETUNE] + dt) / 100;
    v.base = s.rate / this.sr;
    v.fl.reset(); v.fr.reset(); v.lfo = 0; v.hold = (lcg(this.rng) / 4294967296) * 2 - 1; v.pe = 1; v.op = 0; v.sd = false;
    v.env.start(); v.fenv.start();
  }
  startOsc(p, vel) {      // oscillator without a sample: no zone covers the note, but the Osc is on
    const v = this.alloc(), g = this.g;
    v.on = v.held = true; v.rel = false; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.id = -1; v.pos = 0; v.dir = 1;
    v.s0 = v.s1 = v.l0 = v.l1 = 0; v.xf = 0; v.sus = 0; v.rev = false; v.zvol = 1; v.zpan = 0; v.vpan = 0; v.keyOff = g[SMP.TRANSPOSE] + this.pitch + g[SMP.DETUNE] / 100; v.base = 1;
    v.fl.reset(); v.fr.reset(); v.lfo = 0; v.hold = (lcg(this.rng) / 4294967296) * 2 - 1; v.pe = 1; v.op = 0; v.sd = false;
    v.env.start(); v.fenv.start();
  }
  zero(s, i) {            // nearest zero crossing (within 256 frames) of the left channel
    const l = s.l, n = s.frames; i = clamp(i | 0, 0, n - 2);
    for (let k = 0; k < 256; k++) {
      for (const j of [i + k, i - k]) { if (j >= 0 && j < n - 1 && (l[j] <= 0) !== (l[j + 1] <= 0)) return j; }
    }
    return i;
  }
  noteOn(p, vel) {
    const vi = Math.round(vel * 127), sp = this.g[SMP.SPREAD];
    let started = false;
    for (const q of this.z) {
      const s = q.id >= 0 ? this.bank[q.id] : null;
      if (!s || s.frames < 4 || p < q.lo || p > q.hi || vi < q.vlo || vi > q.vhi) continue;
      started = true;
      if (sp > 0.005) { this.start(q, s, p, vel, -sp * 25, -sp); this.start(q, s, p, vel, sp * 25, sp); } else this.start(q, s, p, vel, 0, 0);
    }
    if (!started && this.g[SMP.OSCON] > 0.5) this.startOsc(p, vel);
  }
  noteOff(p) { for (const v of this.v) if (v.on && v.held && v.pitch === p) { v.held = false; v.rel = true; v.env.release(); v.fenv.release(); } }
  allOff() { for (const v of this.v) if (v.on) { v.held = false; v.rel = true; v.env.release(); v.fenv.release(); } }
  render(L, R, from, to) {
    const g = this.g, sr = this.sr, ap = this.ap, fp = this.fp, hi = g[SMP.INTERP] > 0.5, fon = g[SMP.FON] > 0.5, ft = Math.round(g[SMP.FTYPE]);
    const lfoInc = g[SMP.LRATE] / sr, lsh = Math.round(g[SMP.LSHAPE]), lP = g[SMP.LPITCH] * 12, lF = g[SMP.LFILT], lV = g[SMP.LVOL], lPan = g[SMP.LPAN];
    const pDec = Math.exp(-32 / Math.max(1, g[SMP.PDEC] * sr)), pAmt = g[SMP.PENV], vv = g[SMP.VOLVEL], gv = dbLin(g[SMP.VOL]), gp = g[SMP.PAN], fAmt = g[SMP.FENV], frq = g[SMP.FREQ], res = g[SMP.RES];
    const relMode = g[SMP.RELMODE] > 0.5, maxF = sr * 0.45;
    const oscOn = g[SMP.OSCON] > 0.5, oWave = Math.round(g[SMP.OSCWAVE]), oLvl = dbLin(g[SMP.OSCLVL]), oOff = g[SMP.OSCSEMI] + g[SMP.OSCDET] / 100, sLvl = dbLin(g[SMP.SMPLVL]);
    for (const v of this.v) {
      if (!v.on) continue;
      const osc = v.id < 0;
      const s = osc ? null : this.bank[v.id];
      if (!osc && (!s || s.frames < 4)) { v.on = false; continue; }
      if (osc && !oscOn) { v.on = false; continue; }
      const sl = osc ? null : s.l, sr_ = osc ? null : s.r, a = v.s0, len = v.s1 - v.s0, l0 = v.l0, l1 = v.l1, loopLen = l1 - l0, rev = v.rev, xf = v.xf;
      for (let i = from; i < to; i += 32) {
        const e2 = Math.min(to, i + 32);
        v.lfo += lfoInc * 32; if (v.lfo >= 1) { v.lfo -= 1; v.hold = (lcg(this.rng) / 4294967296) * 2 - 1; }
        const lv = lfoShape(lsh, v.lfo, v.hold);
        v.pe *= pDec;
        const fe = v.fenv.v;
        const ratio = v.base * Math.pow(2, (v.keyOff + pAmt * v.pe + lP * lv) / 12);
        const oInc = oscOn ? midiToHz(v.pitch) * Math.pow(2, (g[SMP.TRANSPOSE] + this.pitch + oOff + pAmt * v.pe + lP * lv) / 12) / sr : 0;
        if (fon) {
          const fc = clamp(frq * Math.pow(2, fAmt * 6 * fe + lF * 3 * lv), 20, maxF);
          if (ft === 0) v.fl.lowpass(sr, fc, res); else if (ft === 1) v.fl.highpass(sr, fc, res); else if (ft === 2) v.fl.bandpass(sr, fc, res); else v.fl.notch(sr, fc, res);
          v.fr.copy(v.fl);
        }
        const pn = clamp(gp + v.zpan + v.vpan + lPan * lv, -1, 1), pg = (1 - vv) + vv * v.vel;
        const gl = Math.cos((pn + 1) * 0.7853982) * 1.4142 * gv * v.zvol * pg * (1 - lV * (0.5 - 0.5 * lv));
        const gr = Math.sin((pn + 1) * 0.7853982) * 1.4142 * gv * v.zvol * pg * (1 - lV * (0.5 - 0.5 * lv));
        for (let k = i; k < e2; k++) {
          const e = v.env.next(ap); v.fenv.next(fp);
          if (v.env.st === 0) { v.on = false; break; }
          let xl = 0, xr = 0;
          if (!osc && !v.sd) {
          let p = v.pos;
          // loop handling in logical position space [0, len)
          if (v.sus && !(v.rel && relMode)) {
            if (v.sus === 1) { if (p >= l1) p -= loopLen; }
            else { if (v.dir > 0 && p >= l1) { p = 2 * l1 - p; v.dir = -1; } else if (v.dir < 0 && p <= l0) { p = 2 * l0 - p; v.dir = 1; } }
            v.pos = p;
          }
          if (p >= len - 1 || p < 0) { if (oscOn) v.sd = true; else { v.on = false; break; } }
          if (!v.sd) {
          const ip = p | 0, fr = p - ip;
          const j0 = rev ? v.s1 - 1 - ip : a + ip, j1 = rev ? v.s1 - 2 - ip : a + ip + 1;
          if (hi && ip > 0 && ip < len - 2) {
            const jm = rev ? v.s1 - ip : a + ip - 1, j2 = rev ? v.s1 - 3 - ip : a + ip + 2;
            xl = herm(sl[jm], sl[j0], sl[j1], sl[j2], fr); xr = herm(sr_[jm], sr_[j0], sr_[j1], sr_[j2], fr);
          } else { xl = sl[j0] + (sl[j1] - sl[j0]) * fr; xr = sr_[j0] + (sr_[j1] - sr_[j0]) * fr; }
          if (v.sus === 1 && xf > 1 && !(v.rel && relMode) && p > l1 - xf && p < l1) {     // crossfade the end of the loop into the material before its start
            const t = (p - (l1 - xf)) / xf, q = p - loopLen;
            if (q >= 0) {
              const i2 = q | 0, f2 = q - i2, ja = rev ? v.s1 - 1 - i2 : a + i2, jb = rev ? v.s1 - 2 - i2 : a + i2 + 1;
              const yl = sl[ja] + (sl[jb] - sl[ja]) * f2, yr = sr_[ja] + (sr_[jb] - sr_[ja]) * f2;
              xl = xl * (1 - t) + yl * t; xr = xr * (1 - t) + yr * t;
            }
          }
          xl *= sLvl; xr *= sLvl;
          v.pos += ratio * v.dir;
          }
          }
          if (oscOn) {
            v.op += oInc; if (v.op >= 1) v.op -= 1;
            const ph = v.op; let o;
            if (oWave === 0) o = Math.sin(TWO_PI * ph);
            else if (oWave === 1) o = 4 * Math.abs(ph - 0.5) - 1;
            else if (oWave === 2) { o = 2 * ph - 1; o -= blep(ph, oInc); }
            else if (oWave === 3) { o = ph < 0.5 ? 1 : -1; o += blep(ph, oInc); o -= blep((ph + 0.5) % 1, oInc); }
            else o = (lcg(this.rng) / 4294967296) * 2 - 1;
            o *= oLvl; xl += o; xr += o;
          }
          if (fon) { xl = v.fl.process(xl); xr = v.fr.process(xr); }
          L[k] += xl * e * gl; R[k] += xr * e * gr;
        }
        if (!v.on) break;
      }
    }
  }
}

// =============================================================================================== Wavetable
const NF = 16, NM = 7, TL = 2048, NH = 64;
const rnd = (a, b) => ((Math.imul((a * 7919 + b * 104729 + 1) | 0, 2654435761) >>> 8) & 0xffff) / 65536;
const VOW = { A: [800, 1150], E: [400, 2000], I: [300, 2500], O: [500, 900], U: [350, 700] };
function vowel(h, t, f0, order, bw) {
  const x = t * (order.length - 1), k = Math.min(order.length - 2, x | 0), u = x - k, a = VOW[order[k]], b = VOW[order[k + 1]];
  const f1 = a[0] + (b[0] - a[0]) * u, f2 = a[1] + (b[1] - a[1]) * u, f = f0 * h;
  return (1 / Math.pow(h, 0.6)) * (Math.exp(-Math.pow((f - f1) / bw, 2)) + 0.7 * Math.exp(-Math.pow((f - f2) / (bw * 1.6), 2)) + 0.04);
}
const oddPh = (h) => ((((h - 1) / 2) & 1) ? PI : 0);
// harmonic generators: (h, t, frame) -> [amplitude, phase] for harmonic h (1..64) of a frame at morph position t (0..1)
const GEN = {
  sineSaw: (h, t) => [h === 1 ? 1 : t / h, 0],
  squarePulse: (h, t) => { const w = 0.5 - 0.42 * t; return [Math.sin(PI * h * w) / h, PI / 2 - h * PI * w]; },
  triSquare: (h, t) => [(h & 1) ? 1 / Math.pow(h, 2 - t) : 0, oddPh(h)],
  growHarm: (h, t) => { const n = 1 + t * 23; return [h <= n ? 1 / Math.pow(h, 0.7) : Math.max(0, 1 - (h - n)) / Math.pow(h, 0.7), 0]; },
  octaves: (h, t) => [(h & (h - 1)) === 0 ? (h === 1 ? 1 : t * 1.2 / Math.log2(h * 2)) : 0, 0],
  fifths: (h, t) => [(h === 1 || h === 3 || h === 9 || h === 27) ? (h === 1 ? 1 : t * 1.1 / Math.pow(h, 0.5)) : 0, 0],
  pulseStack: (h, t, f) => [(1 / h) * (0.4 + 0.6 * Math.abs(Math.sin(PI * h * (0.5 - 0.4 * t)))), rnd(h, 3) * 0.3 * t],
  ringMod: (h, t) => { const c = 2 + t * 10; return [Math.exp(-Math.pow(h - c, 2) / 2) + 0.6 * Math.exp(-Math.pow(h - c * 1.5, 2) / 2) + (h === 1 ? 0.3 : 0), h * t * 0.7]; },
  syncSweep: (h, t) => [(1 / h) * (1 + 5 * Math.exp(-Math.pow(h - (1 + t * 14), 2) / 1.2)), 0],
  chirp: (h, t) => [1 / h, t * h * h * 0.06],
  fold: (h, t) => [(h & 1) ? Math.abs(Math.sin(PI * h * (0.1 + t * 0.4))) / Math.pow(h, 0.8) : 0, oddPh(h)],
  clip: (h, t) => [(h & 1) ? Math.pow(1 / h, 1 - 0.85 * t) : 0, oddPh(h)],
  bits: (h, t, f) => [(1 / h) * (rnd(h, f) < 0.4 + 0.5 * t ? 1 : 0.1), 0],
  lpSweep: (h, t) => [(1 / h) / (1 + Math.pow(h / (1 + t * 22), 4)), 0],
  bpSweep: (h, t) => [(1 / h) * Math.exp(-Math.pow(h - (1 + t * 20), 2) / (2 * Math.pow(1 + t * 3, 2))) + (h === 1 ? 0.15 : 0), 0],
  comb: (h, t) => [(1 / h) * (0.5 + 0.5 * Math.cos(TWO_PI * h * (0.08 + t * 0.4))), 0],
  aeiou: (h, t) => [vowel(h, t, 110, ['A', 'E', 'I', 'O', 'U'], 220), 0],
  choir: (h, t, f) => [vowel(h, t, 130, ['O', 'A', 'E', 'A'], 260), rnd(h, 9) * 2],
  female: (h, t) => [vowel(h, t, 220, ['A', 'O', 'U', 'I', 'E'], 300), 0],
  oddHarm: (h, t) => [(h & 1) ? 1 / Math.pow(h, 0.5 + t) : 0, 0],
  evenHarm: (h, t) => [(h & 1) ? (h === 1 ? 1 : 1 - t) / h : t / h, 0],
  tilt: (h, t) => [Math.pow(h, -(0.2 + 2.2 * (1 - t))), 0],
  organ: (h, t) => { const D = [[1, 1], [2, 0.8], [3, 0.6], [4, 0.5], [6, 0.4], [8, 0.3]]; const q = D.find((d) => d[0] === h); return [q ? q[1] * (h === 1 ? 1 : 0.2 + 0.8 * t) : 0, 0]; },
  pluck: (h, t) => [Math.exp(-h * (0.04 + 0.35 * (1 - t))) / Math.pow(h, 0.4), 0],
  epiano: (h, t) => [[0, 1, 0.1, 0.45 * t, 0.05, 0.2 * t, 0, 0, 0.1 * t][h] || 0, h * 0.2],
  brass: (h, t) => [(1 / h) * (0.3 + Math.exp(-Math.pow(h - (2 + t * 6), 2) / 3) * 3), 0],
  metalNoise: (h, t, f) => [(h > 2 ? 1 / Math.pow(h, 0.35) : 0.5) * (0.5 + 0.5 * rnd(h, f + 1)) * (0.3 + t * 0.7), rnd(h, f + 7) * TWO_PI],
  digiNoise: (h, t, f) => [rnd(h, f + 3) > 0.5 - t * 0.3 ? 1 / Math.pow(h, 0.5) : 0, rnd(h, 11) * TWO_PI],
  chipPulse: (h, t) => { const w = [0.5, 0.25, 0.125, 0.0625][Math.min(3, (t * 4) | 0)]; return [Math.sin(PI * h * w) / h, PI / 2 - h * PI * w]; },
  chipTri: (h, t) => [(h & 1) ? (1 / (h * h)) + (t * 0.06) / Math.sqrt(h) : 0, oddPh(h)],
  chipSaw: (h, t) => [h <= 4 + ((t * 12) | 0) ? 1 / h : 0, 0],
  analogSaw: (h, t) => [1 / h, rnd(h, 5) * t * 0.9],
  warmSquare: (h, t) => [(h & 1) ? (1 / h) * (1 - 0.8 * t * (h > 5 ? 1 : 0)) : 0, oddPh(h)],
  detuneStack: (h, t) => [(1 / h) * (1 + 0.5 * Math.sin(h * (1 + t * 3))), h * t * 1.3],
};
export const WT_CATS = [
  { name: 'Basics', t: [['Sine \u2192 Saw', 'sineSaw'], ['Square \u2192 Pulse', 'squarePulse'], ['Triangle \u2192 Square', 'triSquare'], ['Harmonic Grow', 'growHarm']] },
  { name: 'Collection', t: [['Octaves', 'octaves'], ['Fifths', 'fifths'], ['Pulse Stack', 'pulseStack']] },
  { name: 'Complex', t: [['Ring Mod', 'ringMod'], ['Sync Sweep', 'syncSweep'], ['Chirp', 'chirp']] },
  { name: 'Distortion', t: [['Fold', 'fold'], ['Clip', 'clip'], ['Bit Crush', 'bits']] },
  { name: 'Filter', t: [['LP Sweep', 'lpSweep'], ['BP Sweep', 'bpSweep'], ['Comb', 'comb']] },
  { name: 'Formant', t: [['AEIOU', 'aeiou'], ['Choir', 'choir'], ['Female', 'female']] },
  { name: 'Harmonics', t: [['Odd', 'oddHarm'], ['Even / Odd', 'evenHarm'], ['Spectral Tilt', 'tilt']] },
  { name: 'Instrument', t: [['Organ', 'organ'], ['Pluck', 'pluck'], ['E-Piano', 'epiano'], ['Brass', 'brass']] },
  { name: 'Noise', t: [['Metal Noise', 'metalNoise'], ['Digital Noise', 'digiNoise']] },
  { name: 'Retro', t: [['Chip Pulse', 'chipPulse'], ['Chip Triangle', 'chipTri'], ['Chip Saw', 'chipSaw']] },
  { name: 'Vintage', t: [['Analog Saw', 'analogSaw'], ['Warm Square', 'warmSquare'], ['Detune Stack', 'detuneStack']] },
];
export const WT_LIST = [];                                      // flat list: { cat, name, gen }
WT_CATS.forEach((c, ci) => c.t.forEach(([name, gen], k) => { c.first = c.first ?? WT_LIST.length; WT_LIST.push({ cat: ci, name, gen, k }); }));
export const WT_COUNT = WT_LIST.length;
export const wtName = (i) => (WT_LIST[clamp(Math.round(i), 0, WT_COUNT - 1)] || WT_LIST[0]).name;
export const wtCatOf = (i) => WT_LIST[clamp(Math.round(i), 0, WT_COUNT - 1)].cat;
export const WT_N_FRAMES = NF;

const CACHE = new Map(), PEND = new Map();
// band-limited copy of every frame: data[(frame * NM + mip) * (TL + 1) + i]; mip m holds harmonics up to 64 >> m.
// Built one harmonic per step (same maths and order as the old all-at-once build, so the table is bit-identical).
function wtJob(idx) {
  const gen = GEN[WT_LIST[idx].gen], d = new Float32Array(NF * NM * (TL + 1)), acc = new Float32Array(TL), row = new Float32Array(TL);
  const at = (f, m) => (f * NM + m) * (TL + 1);
  return {
    done: false, idx, f: 0, h: 1, pk: 1e-6,
    run(pts) {
      let used = 0;
      while (!this.done && used < pts) {
        const f = this.f, h = this.h, t = f / (NF - 1); used++;
        const [amp, ph] = gen(h, t, f);
        if (amp) { for (let i = 0; i < TL; i++) row[i] = amp * Math.sin(TWO_PI * h * i / TL + ph); for (let i = 0; i < TL; i++) acc[i] += row[i]; }
        if ((h & (h - 1)) === 0) {
          const m = NM - 1 - Math.log2(h), o = at(f, m);
          for (let i = 0; i < TL; i++) d[o + i] = acc[i];
          if (m === 0) for (let i = 0; i < TL; i++) this.pk = Math.max(this.pk, Math.abs(acc[i]));
        }
        if (h < NH) { this.h++; continue; }
        const k = 1 / this.pk;
        for (let m = 0; m < NM; m++) { const o = at(f, m); for (let i = 0; i < TL; i++) d[o + i] *= k; d[o + TL] = d[o]; }
        this.f++; this.h = 1; this.pk = 1e-6; acc.fill(0);
        if (this.f >= NF) {
          const T = { d, at };
          if (CACHE.size > 10) CACHE.delete(CACHE.keys().next().value);
          CACHE.set(idx, T); PEND.delete(idx); this.done = true;
        }
      }
      return used || 1;
    },
  };
}
// all at once (UI previews, export, tests)
export function wtTable(idx) {
  idx = clamp(Math.round(idx), 0, WT_COUNT - 1);
  let T = CACHE.get(idx); if (T) return T;
  let j = PEND.get(idx); if (!j) { j = wtJob(idx); PEND.set(idx, j); }
  runJobNow(j);
  return CACHE.get(idx);
}
// realtime: the table or null while it is still being built in the background (the oscillator keeps its previous table meanwhile)
export function wtTableReq(idx) {
  idx = clamp(Math.round(idx), 0, WT_COUNT - 1);
  const T = CACHE.get(idx); if (T) return T;
  if (JOBS.sync) return wtTable(idx);
  if (!PEND.has(idx)) { const j = wtJob(idx); PEND.set(idx, j); JOBS.q.push(j); }
  return null;
}
const mipFor = (hz, sr) => { const maxH = (sr * 0.45) / Math.max(hz, 20); let m = 0; while (m < NM - 1 && (NH >> m) > maxH) m++; return m; };

// Parameters (same order as INSTRUMENTS[11] in defs.js)
export const WTP = {
  O1: 0, O2: 9,              // per oscillator, offsets: +0 table, +1 pos, +2 fx1, +3 fx2, +4 fx mode, +5 gain dB, +6 semi, +7 detune, +8 on
  SUBON: 18, SUBG: 19, SUBTONE: 20, SUBOCT: 21, TRANSPOSE: 22, MONO: 23, GLIDE: 24, VOICES: 25, UMODE: 26, UVOICES: 27, UAMT: 28, VOL: 29,
  FON: 30, FTYPE: 31, FREQ: 32, RES: 33, DRIVE: 34, AMP: 35, E2: 39, E3: 43, LFO1: 47, LFO2: 50, MX: 53,
  F2ON: 101, F2TYPE: 102, F2FREQ: 103, F2RES: 104, F2ROUTE: 105, VELRES: 106,   // Filter 2 (routing 0 = serial, 1 = parallel)
};
const MX_SRC = 6, MX_DST = 8;
const DEFAULTS = [
  0, 0.7, 0, 0, 0, 0, 0, 0, 1,         // osc 1
  4, 0.5, 0, 0, 0, -6, 0, 0, 0,        // osc 2
  0, -6, 0.5, 1, 0, 0, 30, 8, 0, 4, 0.2, -6,
  1, 0, 20000, 0.707, 0,
  0.001, 0.6, 1, 0.1,  0.001, 0.6, 0, 0.1,  0.001, 0.6, 0, 0.1,
  0, 1, 0,  0, 1, 0,
];
function osc0() { return { tab: null, tabIdx: -1, want: -1, pos: 0.7, fx1: 0, fx2: 0, mode: 0, gain: 1, semi: 0, det: 0, on: true }; }

export class LiveWavetable extends VoiceBase {
  constructor(sr) {
    super(sr);
    this.p = new Float64Array(120);
    for (let i = 0; i < DEFAULTS.length; i++) this.p[i] = DEFAULTS[i];
    this.p[WTP.F2ON] = 0; this.p[WTP.F2TYPE] = 1; this.p[WTP.F2FREQ] = 20; this.p[WTP.F2RES] = 0.707; this.p[WTP.F2ROUTE] = 0;
    this.o = [osc0(), osc0()]; this.o[1].on = false;
    this.mx = new Float64Array(MX_SRC * MX_DST);
    this.v = Array.from({ length: 8 }, () => ({ on: false, held: false, pitch: 0, vel: 0, age: 0, env: new Adsr(), e2: new Adsr(), e3: new Adsr(), f0: 0, cur: 0,
      ph: [new Float64Array(8), new Float64Array(8)], sy: [new Float64Array(8), new Float64Array(8)], phS: 0, l1: 0, l2: 0, h1: 0, h2: 0, t: 0, rnd: new Float64Array(8), fl: new Biquad(), fr: new Biquad(), fl2: new Biquad(), fr2: new Biquad() }));
    this.stack = [];
    this.spread = new Float64Array(8);
    for (let u = 0; u < 8; u++) this.spread[u] = 0;
    this.gl = new Float64Array(8); this.gr = new Float64Array(8); this.dt = new Float64Array(8);
    this.src = new Float64Array(MX_SRC); this.mod = new Float64Array(MX_DST);
    this.st = [null, null];
    this.sc = [0, 1].map(() => ({ o: null, gn: 1, dts: new Float64Array(8), pos: new Float64Array(8), mips: new Int32Array(8), tb: null }));
    for (let i = 0; i < 18; i++) this.setParam(i, this.p[i]);
    this.upEnv(); this.upO();
  }
  upEnv() {
    const p = this.p, sr = this.sr, E = (b) => adsrParams(p[b], p[b + 1], p[b + 2], p[b + 3], sr);
    this.pa = E(WTP.AMP); this.p2 = E(WTP.E2); this.p3 = E(WTP.E3);
  }
  takeTab(o) { const T = wtTableReq(o.want); if (T) { o.tab = T; o.tabIdx = o.want; o.want = -1; } }   // a table that is still being built is picked up by a later render call
  upO() {
    for (let n = 0; n < 2; n++) {
      const b = n ? WTP.O2 : WTP.O1, o = this.o[n], p = this.p;
      const ti = clamp(Math.round(p[b]), 0, WT_COUNT - 1);
      if (ti !== o.tabIdx) o.want = ti;
      if (o.want >= 0) this.takeTab(o);
      o.pos = clamp(p[b + 1], 0, 1); o.fx1 = clamp(p[b + 2], 0, 1); o.fx2 = clamp(p[b + 3], 0, 1); o.mode = Math.round(clamp(p[b + 4], 0, 3));
      o.gain = dbLin(p[b + 5]); o.semi = p[b + 6]; o.det = p[b + 7]; o.on = p[b + 8] > 0.5;
    }
  }
  setParam(i, x) {
    if (i === 90) return;
    if (i < 0 || i >= this.p.length) return;
    this.p[i] = x;
    if (i < 18) this.upO();
    else if (i >= WTP.AMP && i < WTP.LFO1) this.upEnv();
    else if (i >= WTP.MX && i < WTP.MX + MX_SRC * MX_DST) this.mx[i - WTP.MX] = clamp(x, -1, 1);
    else if (i === WTP.MONO) { this.allOff(); this.stack.length = 0; }
    else if (i === WTP.VELRES) this.mx[4 * MX_DST + 5] = clamp(x, -1, 1);   // Vel > Filter Res (index 90 is taken by the instrument pitch)
  }
  alloc() {
    const n = clamp(Math.round(this.p[WTP.VOICES]), 1, 8);
    let used = 0, free = null, old = null;
    for (let k = 0; k < 8; k++) { const v = this.v[k]; if (v.on) { used++; if (!old || v.age < old.age) old = v; } else if (!free) free = v; }
    return (free && used < n) ? free : (old || free);
  }
  begin(v, p, vel) {
    v.on = v.held = true; v.pitch = p; v.vel = vel; v.age = ++this.counter; v.f0 = midiToHz(p + this.p[WTP.TRANSPOSE]); v.t = 0; v.l1 = v.l2 = 0; v.h1 = lcg(this.rng) / 4294967296 * 2 - 1; v.h2 = lcg(this.rng) / 4294967296 * 2 - 1; v.phS = 0;
    for (let n = 0; n < 2; n++) for (let u = 0; u < 8; u++) { v.ph[n][u] = lcg(this.rng) / 4294967296; v.sy[n][u] = 0; }
    for (let u = 0; u < 8; u++) v.rnd[u] = lcg(this.rng) / 4294967296 * 2 - 1;
    v.fl.reset(); v.fr.reset(); v.fl2.reset(); v.fr2.reset(); v.env.start(); v.e2.start(); v.e3.start();
  }
  noteOn(p, vel) {
    if (this.p[WTP.MONO] > 0.5) {
      this.stack = this.stack.filter((x) => x !== p); this.stack.push(p);
      const v = this.v[0];
      if (v.on && v.held) { v.pitch = p; v.vel = vel; v.f0 = midiToHz(p + this.p[WTP.TRANSPOSE]); return; }   // legato: glide to the new pitch, keep the envelopes
      this.begin(v, p, vel); v.cur = v.f0;
      for (let k = 1; k < 8; k++) if (this.v[k].on) { this.v[k].held = false; this.v[k].env.release(); }
      return;
    }
    const v = this.alloc(); this.begin(v, p, vel); v.cur = v.f0;
  }
  noteOff(p) {
    if (this.p[WTP.MONO] > 0.5) {
      this.stack = this.stack.filter((x) => x !== p);
      const v = this.v[0];
      if (!v.on || !v.held) return;
      if (this.stack.length) { v.pitch = this.stack[this.stack.length - 1]; v.f0 = midiToHz(v.pitch + this.p[WTP.TRANSPOSE]); }
      else { v.held = false; v.env.release(); v.e2.release(); v.e3.release(); }
      return;
    }
    for (const v of this.v) if (v.on && v.held && v.pitch === p) { v.held = false; v.env.release(); v.e2.release(); v.e3.release(); }
  }
  allOff() { this.stack.length = 0; for (const v of this.v) if (v.on) { v.held = false; v.env.release(); v.e2.release(); v.e3.release(); } }
  render(L, R, from, to) {
    const P = this.p, sr = this.sr, maxF = sr * 0.45, M = this.mx;
    const nUni = P[WTP.UMODE] > 0.5 ? clamp(Math.round(P[WTP.UVOICES]), 2, 8) : 1, umode = Math.round(P[WTP.UMODE]), uamt = P[WTP.UAMT];
    const vol = dbLin(P[WTP.VOL]), subOn = P[WTP.SUBON] > 0.5, subG = dbLin(P[WTP.SUBG]), subTone = P[WTP.SUBTONE], subDiv = 1 / Math.pow(2, Math.round(P[WTP.SUBOCT]));
    const f2on = P[WTP.F2ON] > 0.5, f2t = Math.round(P[WTP.F2TYPE]), par = P[WTP.F2ROUTE] > 0.5;
    const fon = P[WTP.FON] > 0.5, ft = Math.round(P[WTP.FTYPE]), drive = dbLin(P[WTP.DRIVE]), glide = Math.exp(-32 / Math.max(1, P[WTP.GLIDE] * 0.001 * sr)), mono = P[WTP.MONO] > 0.5;
    const l1s = Math.round(P[WTP.LFO1]), l1r = P[WTP.LFO1 + 1] / sr, l1a = P[WTP.LFO1 + 2], l2s = Math.round(P[WTP.LFO2]), l2r = P[WTP.LFO2 + 1] / sr, l2a = P[WTP.LFO2 + 2];
    const pa = this.pa, p2 = this.p2, p3 = this.p3, spread = this.spread, gl = this.gl, gr = this.gr, dt = this.dt;
    for (let u = 0; u < nUni; u++) spread[u] = nUni > 1 ? (u / (nUni - 1)) * 2 - 1 : 0;
    const src = this.src, mod = this.mod;
    if (this.o[0].want >= 0) this.takeTab(this.o[0]); if (this.o[1].want >= 0) this.takeTab(this.o[1]);
    for (const v of this.v) {
      if (!v.on) continue;
      for (let i = from; i < to; i += 32) {
        const e2 = Math.min(to, i + 32), dtS = 32 / sr;
        v.t += dtS;
        v.l1 += l1r * 32; if (v.l1 >= 1) { v.l1 -= 1; v.h1 = lcg(this.rng) / 4294967296 * 2 - 1; }
        v.l2 += l2r * 32; if (v.l2 >= 1) { v.l2 -= 1; v.h2 = lcg(this.rng) / 4294967296 * 2 - 1; }
        const a1 = l1a > 0.001 ? Math.min(1, v.t / l1a) : 1, a2 = l2a > 0.001 ? Math.min(1, v.t / l2a) : 1;
        src[0] = v.e2.v; src[1] = v.e3.v; src[2] = lfoShape(l1s, v.l1, v.h1) * a1; src[3] = lfoShape(l2s, v.l2, v.h2) * a2; src[4] = v.vel; src[5] = (v.pitch - 60) / 60;
        for (let d = 0; d < MX_DST; d++) { let s = 0; for (let k = 0; k < MX_SRC; k++) s += M[k * MX_DST + d] * src[k]; mod[d] = s; }
        if (mono) v.cur = v.f0 + (v.cur - v.f0) * glide; else v.cur = v.f0;
        const fbase = v.cur;
        if (fon) {
          const fc = clamp(P[WTP.FREQ] * Math.pow(2, mod[4] * 6), 20, maxF), q = clamp(P[WTP.RES] + mod[5] * 6, 0.3, 14);
          if (ft === 0) v.fl.lowpass(sr, fc, q); else if (ft === 1) v.fl.highpass(sr, fc, q); else if (ft === 2) v.fl.bandpass(sr, fc, q); else v.fl.notch(sr, fc, q);
          v.fr.copy(v.fl);
        }
        if (f2on) {
          const fc2 = clamp(P[WTP.F2FREQ], 20, maxF), q2 = clamp(P[WTP.F2RES], 0.3, 14);
          if (f2t === 0) v.fl2.lowpass(sr, fc2, q2); else if (f2t === 1) v.fl2.highpass(sr, fc2, q2); else if (f2t === 2) v.fl2.bandpass(sr, fc2, q2); else v.fl2.notch(sr, fc2, q2);
          v.fr2.copy(v.fl2);
        }
        // per-oscillator, per-unison-voice phase increments, mipmaps and frame pairs for this block
        const O = this.o, st = this.st;
        for (let n = 0; n < 2; n++) {
          const o = O[n];
          if (!o.on || !o.tab) { st[n] = null; continue; }
          const pit = o.semi + o.det / 100 + mod[n ? 3 : 1] * 24, f = fbase * Math.pow(2, pit / 12);
          const gn = clamp(o.gain * (1 + mod[n ? 7 : 6]), 0, 3);
          const SC = this.sc[n], dts = SC.dts, pos = SC.pos, mips = SC.mips;
          for (let u = 0; u < nUni; u++) {
            let det = 0, ps = 0;
            if (umode === 1 || umode === 2 || umode === 4) det = spread[u] * uamt * 60;
            else if (umode === 3) det = spread[u] * uamt * 60 + v.rnd[u] * uamt * 20 * Math.sin(v.t * 7 + u);
            else if (umode === 6) det = v.rnd[u] * uamt * 100;
            if (umode === 5) ps = spread[u] * uamt * 0.5;
            const fu = f * Math.pow(2, det / 1200) * (umode === 2 && (u & 1) ? 2 : 1);
            dts[u] = fu / sr; mips[u] = mipFor(fu * (o.mode === 2 && o.fx2 > 0.01 ? 1 + o.fx2 * 7 : 1) * 1.05, sr);
            pos[u] = clamp(o.pos + mod[n ? 2 : 0] + ps, 0, 1);
          }
          SC.o = o; SC.gn = gn; SC.tb = o.tab; st[n] = SC;
        }
        for (let u = 0; u < nUni; u++) { const pan = nUni > 1 ? spread[u] * Math.min(1, uamt * 1.2 + 0.2) : 0; gl[u] = Math.cos((pan + 1) * 0.7853982) * 1.4142; gr[u] = Math.sin((pan + 1) * 0.7853982) * 1.4142; }
        const norm = 1 / Math.sqrt(nUni), subDt = (fbase * subDiv) / sr;
        for (let k = i; k < e2; k++) {
          const ea = v.env.next(pa); v.e2.next(p2); v.e3.next(p3);
          if (v.env.st === 0) { v.on = false; break; }
          let sl = 0, sr2 = 0;
          for (let n = 0; n < 2; n++) {
            const S = st[n]; if (!S) continue;
            const o = S.o, T = S.tb.d, at = S.tb.at, ph = v.ph[n], sy = v.sy[n];
            for (let u = 0; u < nUni; u++) {
              let p = ph[u] + S.dts[u]; let wrapped = false;
              if (p >= 1) { p -= 1; wrapped = true; } ph[u] = p;
              let q = p;
              if (o.mode === 2) {                     // Classic: pulse-width style phase distortion (FX 1) and hard sync (FX 2)
                if (o.fx2 > 0.01) { if (wrapped) sy[u] = 0; sy[u] += S.dts[u] * (1 + o.fx2 * 7); q = sy[u] % 1; }
                const c = 0.5 - o.fx1 * 0.45; q = q < c ? 0.5 * q / c : 0.5 + 0.5 * (q - c) / (1 - c);
              } else if (o.mode === 3) q = Math.pow(p, 1 + o.fx1 * 3);              // Modern: warp
              else if (o.mode === 1) { const r = 1 + Math.round(o.fx2 * 7); q = p + o.fx1 * 0.9 * Math.sin(TWO_PI * p * r); q -= Math.floor(q); }   // FM
              const fp = q * TL, i0 = fp | 0, fr = fp - i0;
              const tp = S.pos[u] * (NF - 1), f0 = Math.min(tp | 0, NF - 2), ff = tp - f0, m = S.mips[u];
              const a0 = at(f0, m) + i0, a1 = at(f0 + 1, m) + i0;
              const x0 = T[a0] + (T[a0 + 1] - T[a0]) * fr, x1 = T[a1] + (T[a1 + 1] - T[a1]) * fr;
              let x = x0 + (x1 - x0) * ff;
              if (o.mode === 3 && o.fx2 > 0.005) { let y = x * (1 + o.fx2 * 4); y = Math.abs(((y + 1) % 4 + 4) % 4 - 2) - 1; x = y; }   // Modern: fold
              x *= S.gn;
              sl += x * gl[u]; sr2 += x * gr[u];
            }
          }
          sl *= norm; sr2 *= norm;
          if (subOn) {
            v.phS += subDt; if (v.phS >= 1) v.phS -= 1;
            const s0 = Math.sin(TWO_PI * v.phS), x = (s0 * (1 - subTone) + subTone * Math.max(-1, Math.min(1, s0 * 2.2)) * 0.8) * subG;
            sl += x; sr2 += x;
          }
          if (drive > 1.001) { sl = fastTanh(sl * drive) / Math.sqrt(drive); sr2 = fastTanh(sr2 * drive) / Math.sqrt(drive); }
          if (par && fon && f2on) { const al = v.fl.process(sl), ar = v.fr.process(sr2), bl = v.fl2.process(sl), br = v.fr2.process(sr2); sl = (al + bl) * 0.6; sr2 = (ar + br) * 0.6; }
          else { if (fon) { sl = v.fl.process(sl); sr2 = v.fr.process(sr2); } if (f2on) { sl = v.fl2.process(sl); sr2 = v.fr2.process(sr2); } }
          const g = ea * vol * (0.6 + 0.4 * v.vel);
          L[k] += sl * g; R[k] += sr2 * g;
        }
        if (!v.on) break;
      }
    }
  }
}

LiveWavetable.prototype.bendVoice = function (v, r) { v.f0 *= r; if (v.cur) v.cur *= r; };   // pitch bend (core.js Engine.bend)
