// Effects of the web engine. Interface: setParam(i, v), process(L, R, n) in place, readOut(out) -> count, bypass flag.
import { AutoFilter, Echo, Roar } from './fx2.js';
import { Delay, FilterDelay, BeatRepeat, ChorusEnsemble, PhaserFlanger, AutoPan, Gate, GlueComp, ChannelEq, Erosion, Redux, VinylDist, DrumBuss, Tuner, EqEight, Spectrum } from './fx3.js';
import { Amp, Cabinet, Overdrive, Pedal, DynTube, MultibandDyn, Resonators, Corpus, Vocoder, Shifter, GrainDelay, HybridReverb, Looper } from './fx4.js';
import { SpectralTime, SpectralResonator } from './fx5.js';
import { LfoMod, ShaperMod, EnvFollower } from './fx6.js';
import { AudioEffectRack } from './fx7.js';
import { TapeStop } from './fx8.js';
import { TWO_PI, clamp, dbToLin, linToDb, Biquad, fft, fastLog2, fastPow2, fastTanh, Os4, OS4_LATENCY } from './dsp.js';

const tanh = fastTanh;
const DB_PER_LOG2 = 6.0205999;   // 20*log10(2)

class Fx { constructor(sr, sc) { this.sr = sr; this.sc = sc; this.bypass = false; } readOut() { return 0; } }

// 0 gain dB, 1 balance, 2 phase L, 3 mono, 4 phase R, 5 channel (stereo / left / right / swap), 6 width, 7 bass mono, 8 bass mono Hz, 9 mute, 10 DC filter
class Utility extends Fx {
  constructor(sr) {
    super(sr); this.gdb = 0; this.pan = 0; this.inv = 0; this.mono = 0; this.invR = 0; this.ch = 0; this.width = 1; this.bm = 0; this.bmf = 120; this.mute = 0; this.dc = 0; this.g = 0; this.gInit = false;
    this.lo = [new Biquad(), new Biquad()]; this.hi = [new Biquad(), new Biquad()]; this.dcx = [0, 0]; this.dcy = [0, 0]; this.upd();
  }
  upd() { this.lo[0].lowpass(this.sr, this.bmf, 0.707); this.lo[1].copy(this.lo[0]); this.hi[0].highpass(this.sr, this.bmf, 0.707); this.hi[1].copy(this.hi[0]); }
  setParam(i, v) {
    switch (i) {
      case 0: this.gdb = v; break; case 1: this.pan = clamp(v, -1, 1); break; case 2: this.inv = v > 0.5 ? 1 : 0; break; case 3: this.mono = v > 0.5 ? 1 : 0; break;
      case 4: this.invR = v > 0.5 ? 1 : 0; break; case 5: this.ch = Math.round(clamp(v, 0, 3)); break; case 6: this.width = clamp(v, 0, 4); break; case 7: this.bm = v > 0.5 ? 1 : 0; break;
      case 8: this.bmf = clamp(v, 50, 500); this.upd(); break; case 9: this.mute = v > 0.5 ? 1 : 0; break; case 10: this.dc = v > 0.5 ? 1 : 0; break;
    }
  }
  process(L, R, n) {
    const tg = this.mute ? 0 : dbToLin(this.gdb);
    if (!this.gInit) { this.g = tg; this.gInit = true; }
    const step = (tg - this.g) / n, pl = Math.cos(Math.max(0, this.pan) * Math.PI / 2), pr = Math.cos(Math.max(0, -this.pan) * Math.PI / 2);
    const sl = this.inv ? -1 : 1, sr = this.invR ? -1 : 1, w = this.mono ? 0 : this.width, ch = this.ch, dcR = 0.995;
    for (let i = 0; i < n; i++) {
      this.g += step;
      let l = L[i] * sl, r = R[i] * sr;
      if (ch === 1) r = l; else if (ch === 2) l = r; else if (ch === 3) { const t = l; l = r; r = t; }
      if (this.dc) { const yl = l - this.dcx[0] + dcR * this.dcy[0], yr = r - this.dcx[1] + dcR * this.dcy[1]; this.dcx[0] = l; this.dcx[1] = r; this.dcy[0] = yl; this.dcy[1] = yr; l = yl; r = yr; }
      const m = (l + r) * 0.5; let s = (l - r) * 0.5 * w;
      if (this.bm) { s = this.hi[0].process(s); this.lo[0].process(0); }   // Bass Mono: the side signal loses everything below the frequency
      l = m + s; r = m - s;
      L[i] = l * this.g * pl; R[i] = r * this.g * pr;
    }
  }
}

// Linkwitz-Riley crossover: 24 dB/oct = two Butterworth 2-pole stages, 48 dB/oct = Butterworth 4-pole squared
class Xover {
  constructor(sr) { this.sr = sr; this.l = []; this.h = []; }
  set(f, steep) {
    const qs = steep ? [0.5412, 1.3066, 0.5412, 1.3066] : [0.7071, 0.7071];
    if (this.l.length !== qs.length) { this.l = qs.map(() => new Biquad()); this.h = qs.map(() => new Biquad()); }
    qs.forEach((q, k) => { this.l[k].lowpass(this.sr, f, q); this.h[k].highpass(this.sr, f, q); });
  }
  lp(x) { for (const b of this.l) x = b.process(x); return x; }
  hp(x) { for (const b of this.h) x = b.process(x); return x; }
}
// EQ Three (Live): 0 low dB 1 mid dB 2 high dB (3 old mid Hz, unused) 4 low/mid split Hz 5 mid/high split Hz 6..8 band on (kill when off) 9 slope (24 / 48)
class Eq3 extends Fx {
  constructor(sr) { super(sr); this.g = [0, 0, 0]; this.on = [1, 1, 1]; this.lf = 250; this.hf = 4000; this.steep = 0; this.x = [0, 1].map(() => [new Xover(sr), new Xover(sr), new Xover(sr)]); this.upd(); }
  upd() { const hf = Math.max(this.hf, this.lf * 1.05); for (const c of this.x) { c[0].set(this.lf, this.steep); c[1].set(hf, this.steep); c[2].set(hf, this.steep); } }
  setParam(i, v) {
    if (i < 3) this.g[i] = clamp(v, -15, 15); else if (i === 4) { this.lf = clamp(v, 40, 800); this.upd(); } else if (i === 5) { this.hf = clamp(v, 1000, 16000); this.upd(); }
    else if (i >= 6 && i <= 8) this.on[i - 6] = v > 0.5 ? 1 : 0; else if (i === 9) { this.steep = v > 0.5 ? 1 : 0; this.upd(); }
  }
  process(L, R, n) {
    const gl = this.on[0] ? dbToLin(this.g[0]) : 0, gm = this.on[1] ? dbToLin(this.g[1]) : 0, gh = this.on[2] ? dbToLin(this.g[2]) : 0;
    for (let c = 0; c < 2; c++) {
      const X = c ? R : L, [a, b, ap] = this.x[c];
      for (let i = 0; i < n; i++) {
        const x = X[i], low = a.lp(x), rest = a.hp(x), mid = b.lp(rest), high = b.hp(rest), lowA = ap.lp(low) + ap.hp(low);   // the low band passes the upper split's all-pass so the bands sum flat
        X[i] = lowA * gl + mid * gm + high * gh;
      }
    }
  }
}

// 0 drive dB, 1 mix, 2 output dB
class Saturator extends Fx {
  constructor(sr) { super(sr); this.type = 0; this.clip = 0; this.drive = 1; this.mix = 1; this.out = 1; this.tb = [new Biquad(), new Biquad()]; this.tone = 20000; this.tb[0].lowpass(sr, 20000, 0.707); this.tb[1].copy(this.tb[0]); }
  setParam(i, v) { if (i === 4) { this.type = Math.round(clamp(v, 0, 5)); return; } if (i === 5) { this.clip = v > 0.5 ? 1 : 0; return; } if (i === 0) this.drive = dbToLin(clamp(v, 0, 36)); else if (i === 1) this.mix = clamp(v, 0, 1); else if (i === 2) this.out = dbToLin(clamp(v, -24, 6)); else if (i === 3) { this.tone = clamp(v, 500, 20000); this.tb[0].lowpass(this.sr, this.tone, 0.707); this.tb[1].copy(this.tb[0]); } }
  // v68: the shaper runs 4x oversampled (no alias tones at high drive); the dry signal goes through the same fixed delay so Mix stays phase-aligned
  lat() { return OS4_LATENCY; }   // PDC: the oversampler round trip (wet and dry)
  process(L, R, n) {
    if (!this.os) { this.os = [new Os4(), new Os4()]; this.dl = new Float64Array(OS4_LATENCY); this.dr = new Float64Array(OS4_LATENCY); this.dp = 0; }
    { const d = this.drive, t = this.type | 0;   // Live Saturator curves: Analog Clip (tanh), Soft Sine, Medium Curve, Hard Curve, Sinoid Fold, Digital Clip
      this.shp = t === 1 ? (x) => Math.sin(clamp(x * d, -1.5708, 1.5708)) : t === 2 ? (x) => { const y = x * d; return y / (1 + Math.abs(y)) * 1.5; } : t === 3 ? (x) => { const y = clamp(x * d, -1.5, 1.5); return y - y * y * y / 6.75; }
        : t === 4 ? (x) => Math.sin(x * d) : (x) => clamp(x * d, -1, 1); }
    const d = this.drive, m = this.mix, o = this.out, norm = 1 / tanh(Math.max(d, 1)), lp = this.tone < 19500, a = this.tb[0], b = this.tb[1], ul = this.os[0], ur = this.os[1], DL = this.dl, DR = this.dr;
    let dp = this.dp;
    for (let i = 0; i < n; i++) {
      const xl = L[i], xr = R[i];
      const sh = this.type ? this.shp : (x) => tanh(x * d) * norm;
      let u = ul.up(xl); let l = ul.down(sh(u[0]), sh(u[1]), sh(u[2]), sh(u[3]));
      u = ur.up(xr); let r = ur.down(sh(u[0]), sh(u[1]), sh(u[2]), sh(u[3]));
      if (this.clip) { l = tanh(l); r = tanh(r); }
      if (lp) { l = a.process(l); r = b.process(r); }
      const yl = DL[dp], yr = DR[dp]; DL[dp] = xl; DR[dp] = xr; if (++dp >= OS4_LATENCY) dp = 0;
      L[i] = (yl * (1 - m) + l * m) * o; R[i] = (yr * (1 - m) + r * m) * o;
    }
    this.dp = dp;
  }
}

// 0 threshold dB, 1 ratio, 2 attack ms, 3 release ms, 4 output dB, 5 knee dB, 6 dry/wet, 7 mode (peak / RMS / expand), 8 auto makeup, 9 lookahead (0 / 1 / 10 ms),
// 10 release envelope (lin / log), 11 auto release
class Compressor extends Fx {
  constructor(sr) {
    super(sr); this.thr = -18; this.ratio = 4; this.atk = 10; this.rel = 120; this.mk = 1; this.gr = 0; this.knee = 6; this.cmix = 1; this.pin = 0; this.pout = 0;
    this.mode = 0; this.auto = 0; this.la = 0; this.lin = 0; this.arel = 0; this.rms = 0; this.slow = 0; this.dl = new Float32Array(Math.ceil(sr * 0.011)); this.dr = new Float32Array(this.dl.length); this.dp = 0; this.upd();
  }
  lat() { return this.la; }   // PDC: Lookahead delays the audio (0 / 1 / 10 ms)
  upd() { this.aC = Math.exp(-1 / (Math.max(0.05, this.atk) * 0.001 * this.sr)); this.rC = Math.exp(-1 / (Math.max(1, this.rel) * 0.001 * this.sr)); this.linStep = 60 / (Math.max(1, this.rel) * 0.001 * this.sr); }
  setParam(i, v) {
    switch (i) {
      case 0: this.thr = v; break; case 1: this.ratio = Math.max(1, v); break; case 2: this.atk = v; this.upd(); break; case 3: this.rel = v; this.upd(); break;
      case 4: this.mk = dbToLin(v); break; case 5: this.knee = clamp(v, 0, 24); break; case 6: this.cmix = clamp(v, 0, 1); break; case 7: this.mode = Math.round(clamp(v, 0, 2)); break;
      case 8: this.auto = v > 0.5 ? 1 : 0; break; case 9: this.la = [0, Math.round(this.sr * 0.001), Math.round(this.sr * 0.01)][Math.round(clamp(v, 0, 2))]; break;
      case 10: this.lin = v < 0.5 ? 1 : 0; break; case 11: this.arel = v > 0.5 ? 1 : 0; break;
    }
  }
  process(L, R, n) {
    const knee = Math.max(0.01, this.knee), cm = this.cmix, thr = this.thr, aC = this.aC, rC = this.rC, mode = this.mode, ratio = this.ratio;
    const mk = this.mk * (this.auto ? dbToLin(-thr * (1 - 1 / ratio) * 0.5) : 1), la = this.la, D = this.dl.length, rmsC = 1 - Math.exp(-1 / (0.01 * this.sr)), slC = 1 - Math.exp(-1 / (1.5 * this.sr));
    let gr = this.gr, pin = this.pin, pout = this.pout, dp = this.dp;
    for (let i = 0; i < n; i++) {
      const a = L[i] < 0 ? -L[i] : L[i], b = R[i] < 0 ? -R[i] : R[i], pk = a > b ? a : b;
      if (pk > pin) pin = pk;
      let lev = pk;
      if (mode === 1) { this.rms += (pk * pk - this.rms) * rmsC; lev = Math.sqrt(this.rms); }
      const over = DB_PER_LOG2 * fastLog2(lev + 1e-9) - thr;
      let red = 0;
      if (mode === 2) { if (over < 0) red = Math.min(60, -over * (ratio - 1)); }                       // expander: below the threshold the gap grows by the ratio
      else { const slope = 1 / ratio - 1; if (2 * over > knee) red = -slope * over; else if (2 * over > -knee) red = -slope * (over + knee / 2) * (over + knee / 2) / (2 * knee); }
      if (red > gr) gr = aC * gr + (1 - aC) * red;
      else if (this.lin) gr = Math.max(red, gr - this.linStep);
      else if (this.arel) { this.slow += (red - this.slow) * slC; const f = rC * gr + (1 - rC) * red; gr = Math.max(f, Math.min(gr, this.slow)); }
      else gr = rC * gr + (1 - rC) * red;
      const g = fastPow2(-gr * 0.16609640) * mk;
      let xl = L[i], xr = R[i];
      if (la) { const p = (dp - la + D) % D; this.dl[dp] = xl; this.dr[dp] = xr; xl = this.dl[p]; xr = this.dr[p]; dp = (dp + 1) % D; }
      L[i] = xl * (1 - cm) + xl * g * cm; R[i] = xr * (1 - cm) + xr * g * cm;
      const oa = L[i] < 0 ? -L[i] : L[i], ob = R[i] < 0 ? -R[i] : R[i]; if (oa > pout) pout = oa; if (ob > pout) pout = ob;
    }
    this.gr = gr; this.pin = pin; this.pout = pout; this.dp = dp;
  }
  readOut(o) { o[0] = this.gr; o[1] = linToDb(this.pin); o[2] = linToDb(this.pout); this.pin *= 0.5; this.pout *= 0.5; return 3; }
}

// 0 ceiling dB, 1 release ms, 2 input gain dB
class Limiter extends Fx {
  // v68: look-ahead brickwall (1.5 ms). The gain is the sliding minimum of the needed gain over the look-ahead window, smoothed by a moving average of
  // the same length: it starts to duck BEFORE a peak and reaches the needed value exactly when the peak leaves the delay line, so the ceiling holds
  // without the instant gain jumps (and their distortion) of a zero-latency clamp. Release is a one-pole recovery. Latency: this.latency samples.
  constructor(sr) {
    super(sr); this.ceil = dbToLin(-0.3); this.rel = 80; this.in = 1; this.g = 1; this.pin = 0; this.pout = 0;
    const La = this.latency = Math.max(8, Math.round(sr * 0.0015)), W = La + 1;
    this.W = W; this.dL = new Float64Array(La); this.dR = new Float64Array(La); this.dp = 0;              // audio delay = look-ahead (La); the windows below span La + 1
    this.qv = new Float64Array(W + 1); this.qt = new Float64Array(W + 1); this.qh = 0; this.qn = 0; this.t = 0;   // monotonic deque for the sliding minimum
    this.ma = new Float64Array(W).fill(1); this.mp = 0; this.ms = W;                                                // moving average of the minima
    this.upd();
  }
  upd() { this.rC = Math.exp(-1 / (Math.max(1, this.rel) * 0.001 * this.sr)); }
  lat() { return this.latency; }   // PDC: the look-ahead delay line
  setParam(i, v) { if (i === 0) this.ceil = dbToLin(v); else if (i === 1) { this.rel = v; this.upd(); } else if (i === 2) this.in = dbToLin(v); }
  process(L, R, n) {
    const ceil = this.ceil, inG = this.in, rel = 1 - this.rC, W = this.W, La = this.latency, dL = this.dL, dR = this.dR, qv = this.qv, qt = this.qt, ma = this.ma, Q = W + 1;
    let g = this.g, pin = this.pin, pout = this.pout, dp = this.dp, qh = this.qh, qn = this.qn, t = this.t, mp = this.mp, ms = this.ms;
    for (let i = 0; i < n; i++) {
      const l = L[i] * inG, r = R[i] * inG, a = l < 0 ? -l : l, b = r < 0 ? -r : r, pk = a > b ? a : b;
      if (pk > pin) pin = pk;
      const need = pk > ceil ? ceil / pk : 1;
      while (qn > 0 && qv[(qh + qn - 1) % Q] >= need) qn--;                     // sliding minimum of 'need' over the last W samples
      qv[(qh + qn) % Q] = need; qt[(qh + qn) % Q] = t; qn++;
      while (qt[qh] <= t - W) { qh = (qh + 1) % Q; qn--; }
      const mn = qv[qh];
      ms += mn - ma[mp]; ma[mp] = mn; if (++mp >= W) mp = 0;                     // moving average of the minima (attack ramp over the look-ahead)
      const s = ms / W;
      g = s < g ? s : g + (s - g) * rel;
      const ol = dL[dp] * g, or = dR[dp] * g; dL[dp] = l; dR[dp] = r; if (++dp >= La) dp = 0;
      L[i] = ol > ceil ? ceil : ol < -ceil ? -ceil : ol; R[i] = or > ceil ? ceil : or < -ceil ? -ceil : or;   // final guard (should never act)
      const qa = L[i] < 0 ? -L[i] : L[i], qb = R[i] < 0 ? -R[i] : R[i]; if (qa > pout) pout = qa; if (qb > pout) pout = qb;
      t++;
    }
    if (t > 1e15) { for (let k = 0; k < qn; k++) qt[(qh + k) % Q] -= t; t = 0; }
    ms = 0; for (let k = 0; k < W; k++) ms += ma[k];                              // re-sum once per block: no float drift in the running sum
    this.g = g; this.pin = pin; this.pout = pout; this.dp = dp; this.qh = qh; this.qn = qn; this.t = t; this.mp = mp; this.ms = ms;
  }
  readOut(o) { o[0] = -linToDb(this.g); o[1] = linToDb(this.pin); o[2] = linToDb(this.pout); this.pin *= 0.5; this.pout *= 0.5; return 3; }
}

// 0 size, 1 damp, 2 mix (Freeverb layout)
class Reverb extends Fx {
  constructor(sr) {
    super(sr);
    const s = sr / 44100, ct = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], at = [556, 441, 341, 225];
    // all delay lines of one channel live in one typed array; offsets/lengths/indices are typed arrays too (no objects in the loop)
    this.cl = []; this.co = []; this.cbuf = []; this.cidx = []; this.cst = []; this.al = []; this.ao = []; this.abuf = []; this.aidx = [];
    for (let c = 0; c < 2; c++) {
      const cl = Int32Array.from(ct, (t) => Math.floor((t + c * 23) * s)), al = Int32Array.from(at, (t) => Math.floor((t + c * 23) * s));
      const co = new Int32Array(8), ao = new Int32Array(4);
      let tot = 0; for (let k = 0; k < 8; k++) { co[k] = tot; tot += cl[k]; }
      let tot2 = 0; for (let k = 0; k < 4; k++) { ao[k] = tot2; tot2 += al[k]; }
      this.cl.push(cl); this.co.push(co); this.cbuf.push(new Float32Array(tot)); this.cidx.push(new Int32Array(8)); this.cst.push(new Float32Array(8));
      this.al.push(al); this.ao.push(ao); this.abuf.push(new Float32Array(tot2)); this.aidx.push(new Int32Array(4));
    }
    this.tmp = new Float32Array(1024); this.pdl = new Float32Array(Math.ceil(sr * 0.12)); this.pdw = 0; this.pd = 0;
    this.size = 0.6; this.damp = 0.5; this.mix = 0.25; this.width = 1; this.freeze = 0; this.lc = new Biquad(); this.hc = new Biquad(); this.lcf = 20; this.hcf = 20000; this.upF(); this.upd();
  }
  upF() { this.lc.highpass(this.sr, this.lcf, 0.707); this.hc.lowpass(this.sr, this.hcf, 0.707); }
  upd() { this.fb = this.freeze ? 1 : 0.7 + 0.28 * this.size; this.d1 = this.freeze ? 0 : this.damp * 0.4; }
  setParam(i, v) { if (i === 4) { this.width = clamp(v, 0, 1); return; } if (i === 5) { this.freeze = v > 0.5 ? 1 : 0; this.upd(); return; } if (i === 6) { this.lcf = clamp(v, 20, 2000); this.upF(); return; } if (i === 7) { this.hcf = clamp(v, 1000, 20000); this.upF(); return; } if (i === 0) this.size = clamp(v, 0, 1); else if (i === 1) this.damp = clamp(v, 0, 1); else if (i === 2) this.mix = clamp(v, 0, 1); else if (i === 3) this.pd = Math.floor(clamp(v, 0, 100) * 0.001 * this.sr); this.upd(); }
  process(L, R, n) {
    const tmp = this.tmp, pd = this.pd, pl = this.pdl, pn = pl.length;
    if (!this.wv) this.wv = [new Float32Array(1024), new Float32Array(1024)];
    for (let i = 0; i < n; i++) { const x = this.freeze ? 0 : this.hc.process(this.lc.process((L[i] + R[i]) * 0.015)); if (pd > 0) { pl[this.pdw] = x; let rp = this.pdw - pd; if (rp < 0) rp += pn; tmp[i] = pl[rp]; if (++this.pdw >= pn) this.pdw = 0; } else tmp[i] = x; }
    const wet = this.mix * 3, dry = 1 - this.mix * 0.5, fb = this.fb, d1 = this.d1, d0 = 1 - d1;
    for (let c = 0; c < 2; c++) {
      const X = c === 0 ? L : R, cl = this.cl[c], co = this.co[c], cb = this.cbuf[c], ci = this.cidx[c], cs = this.cst[c], al = this.al[c], ao = this.ao[c], ab = this.abuf[c], ai = this.aidx[c];
      for (let i = 0; i < n; i++) {
        const inp = tmp[i];
        let out = 0;
        for (let k = 0; k < 8; k++) {
          let j = ci[k]; const p = co[k] + j, y = cb[p];
          const st = y * d0 + cs[k] * d1; cs[k] = st; cb[p] = inp + st * fb;
          if (++j >= cl[k]) j = 0; ci[k] = j; out += y;
        }
        for (let k = 0; k < 4; k++) {
          let j = ai[k]; const p = ao[k] + j, y = ab[p];
          ab[p] = out + y * 0.5; out = y - out;
          if (++j >= al[k]) j = 0; ai[k] = j;
        }
        this.wv[c][i] = out * wet;
      }
    }
    const wl = this.wv[0], wr = this.wv[1], w = this.width;
    for (let i = 0; i < n; i++) { const m = (wl[i] + wr[i]) * 0.5, sd = (wl[i] - wr[i]) * 0.5 * w; L[i] = L[i] * dry + m + sd; R[i] = R[i] * dry + m - sd; }
  }
}

// 0 low Hz, 1 low dB, 2 m1 Hz, 3 m1 dB, 4 m1 Q, 5 m2 Hz, 6 m2 dB, 7 m2 Q, 8 high Hz, 9 high dB
class ParametricEq extends Fx {
  constructor(sr) { super(sr); this.f = [100, 400, 3000, 8000]; this.g = [0, 0, 0, 0]; this.q = [1, 1]; this.b = [0, 1, 2, 3].map(() => [new Biquad(), new Biquad()]); this.upd(); }
  upd() {
    const s = this.sr;
    this.b[0][0].lowShelf(s, this.f[0], 0.707, this.g[0]); this.b[1][0].peaking(s, this.f[1], this.q[0], this.g[1]); this.b[2][0].peaking(s, this.f[2], this.q[1], this.g[2]); this.b[3][0].highShelf(s, this.f[3], 0.707, this.g[3]);
    for (const x of this.b) x[1].copy(x[0]);
  }
  setParam(i, v) {
    switch (i) { case 0: this.f[0] = v; break; case 1: this.g[0] = clamp(v, -18, 18); break; case 2: this.f[1] = v; break; case 3: this.g[1] = clamp(v, -18, 18); break; case 4: this.q[0] = clamp(v, 0.2, 12); break; case 5: this.f[2] = v; break; case 6: this.g[2] = clamp(v, -18, 18); break; case 7: this.q[1] = clamp(v, 0.2, 12); break; case 8: this.f[3] = v; break; case 9: this.g[3] = clamp(v, -18, 18); break; }
    this.upd();
  }
  process(L, R, n) { const b = this.b; for (let i = 0; i < n; i++) { L[i] = b[3][0].process(b[2][0].process(b[1][0].process(b[0][0].process(L[i])))); R[i] = b[3][1].process(b[2][1].process(b[1][1].process(b[0][1].process(R[i])))); } }
}

// 0 source (0 none, n = track n-1), 1 threshold dB, 2 amount dB, 3 attack ms, 4 release ms. Level = previous block of the source.
class Autoduck extends Fx {
  constructor(sr, sc) { super(sr, sc); this.src = 0; this.thr = -30; this.amt = 12; this.atk = 5; this.rel = 200; this.g = 1; this.gr = 0; this.upd(); }
  upd() { this.aC = 1 - Math.exp(-1 / (Math.max(0.05, this.atk) * 0.001 * this.sr)); this.rC = 1 - Math.exp(-1 / (Math.max(1, this.rel) * 0.001 * this.sr)); }
  setParam(i, v) { if (i === 0) this.src = Math.round(clamp(v, 0, 64)); else if (i === 1) this.thr = v; else if (i === 2) this.amt = v; else if (i === 3) { this.atk = v; this.upd(); } else if (i === 4) { this.rel = v; this.upd(); } }
  process(L, R, n) {
    const lvl = this.src > 0 ? this.sc[this.src - 1] : 0, depth = clamp((linToDb(lvl) - this.thr) / 6, 0, 1), target = dbToLin(-this.amt * depth);
    for (let i = 0; i < n; i++) { this.g += (target - this.g) * (target < this.g ? this.aC : this.rC); L[i] *= this.g; R[i] *= this.g; }
    this.gr = -linToDb(this.g);
  }
  readOut(o) { o[0] = this.gr; return 1; }
}

// BS.1770-4 K-weighted loudness (gated integrated, LRA, 4x true peak) plus RMS and per-channel peaks.
// Params: 0 reset (toggle the value), 1 gain dB (applied to the output; the measurement is taken at the input).
// readOut: 0 momentary, 1 short-term, 2 integrated, 3 LRA, 4 true peak, 5 sample peak, 6 seconds, 7 RMS dB, 8 peak L dB, 9 peak R dB, 10 gain dB, 11 gain reduction-free flag (always 0)
const BINS = 900;
class Loudness {
  constructor(sr) {
    this.sr = sr; this.subLen = Math.floor(sr / 10);
    const ks = () => [{ b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585, z1: 0, z2: 0 }, { b0: 1, b1: -2, b2: 1, a1: -1.99004745483398, a2: 0.99007225036621, z1: 0, z2: 0 }];
    this.k = [ks(), ks()];
    this.hist = new Uint32Array(BINS); this.lra = new Uint32Array(BINS); this.ring = new Float64Array(30);
    this.o = new Float32Array(12); this.rk = Math.exp(-1 / (0.3 * sr)); this.clear();
  }
  clear() { this.hist.fill(0); this.lra.fill(0); this.ring.fill(0); this.rn = 0; this.rp = 0; this.sn = 0; this.ss = 0; this.tp = 0; this.sp = 0; this.sec = 0; this.pl = 0; this.pr = 0; this.rms2 = 0; this.prev = [[0, 0, 0], [0, 0, 0]]; this.o.fill(-100); this.o[6] = 0; this.o[3] = 0; for (const c of this.k) for (const s of c) s.z1 = s.z2 = 0; }
  static lufs(ms) { return ms > 1e-12 ? -0.691 + 10 * Math.log10(ms) : -100; }
  static bin(l) { return Math.max(0, Math.min(BINS - 1, Math.floor((l + 70) * 10))); }
  static pw(b) { return Math.pow(10, ((b / 10 - 70 + 0.05) + 0.691) / 10); }
  meanLast(k) { const n = Math.min(k, this.rn); if (n <= 0) return 0; let s = 0; for (let i = 0; i < n; i++) s += this.ring[(this.rp - 1 - i + 30) % 30]; return s / n; }
  pct(h, from, q) { let tot = 0; for (let b = from; b < BINS; b++) tot += h[b]; if (!tot) return 0; const want = Math.ceil(q * tot); let acc = 0; for (let b = from; b < BINS; b++) { acc += h[b]; if (acc >= want) return b / 10 - 70; } return 0; }
  block() {
    this.ring[this.rp] = this.ss / this.subLen; this.rp = (this.rp + 1) % 30; this.rn = Math.min(30, this.rn + 1); this.ss = 0; this.sn = 0;
    const L = Loudness, mom = L.lufs(this.meanLast(4)), st = L.lufs(this.meanLast(30));
    if (this.rn >= 4 && mom > -70) this.hist[L.bin(mom)]++;
    if (this.rn >= 30 && st > -70) this.lra[L.bin(st)]++;
    let sum = 0, cnt = 0;
    for (let b = 0; b < BINS; b++) if (this.hist[b]) { sum += L.pw(b) * this.hist[b]; cnt += this.hist[b]; }
    let integ = -100;
    if (cnt) { const gate = L.lufs(sum / cnt) - 10; let s2 = 0, c2 = 0; for (let b = L.bin(gate); b < BINS; b++) if (this.hist[b]) { s2 += L.pw(b) * this.hist[b]; c2 += this.hist[b]; } if (c2) integ = L.lufs(s2 / c2); }
    let lra = 0, ls = 0, lc = 0;
    for (let b = 0; b < BINS; b++) if (this.lra[b]) { ls += L.pw(b) * this.lra[b]; lc += this.lra[b]; }
    if (lc) { const from = L.bin(L.lufs(ls / lc) - 20); lra = Math.max(0, this.pct(this.lra, from, 0.95) - this.pct(this.lra, from, 0.1)); }
    const o = this.o; o[0] = mom; o[1] = this.rn >= 30 ? st : L.lufs(this.meanLast(30)); o[2] = integ; o[3] = lra; o[4] = linToDb(this.tp); o[5] = linToDb(this.sp); o[6] = this.sec;
    o[7] = linToDb(Math.sqrt(this.rms2 * 0.5)); o[8] = linToDb(this.pl); o[9] = linToDb(this.pr);
  }
  measure(L, R, n) {
    const ch = [L, R], rk = this.rk;
    for (let i = 0; i < n; i++) {
      const l = L[i], r = R[i], al = l < 0 ? -l : l, ar = r < 0 ? -r : r;
      if (al > this.pl) this.pl = al; if (ar > this.pr) this.pr = ar;
      this.rms2 = this.rms2 * rk + (l * l + r * r) * (1 - rk);
      for (let c = 0; c < 2; c++) {
        const x = ch[c][i]; this.sp = Math.max(this.sp, x < 0 ? -x : x);
        const pr = this.prev[c], p0 = pr[0], p1 = pr[1], p2 = pr[2], p3 = x;
        for (let k = 1; k < 4; k++) { const t = k * 0.25, t2 = t * t, t3 = t2 * t; const v = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); const av = v < 0 ? -v : v; if (av > this.tp) this.tp = av; }
        const ax = x < 0 ? -x : x; if (ax > this.tp) this.tp = ax; pr[0] = p1; pr[1] = p2; pr[2] = x;
        let y = x;
        for (const s of this.k[c]) { const o = s.b0 * y + s.z1; s.z1 = s.b1 * y - s.a1 * o + s.z2; s.z2 = s.b2 * y - s.a2 * o; y = o; }
        this.ss += y * y;
      }
      this.sec += 1 / this.sr;
      if (++this.sn >= this.subLen) this.block();
    }
  }
}

// Level (Swiss-Army-style meter): loudness + peak meters, goniometer and spectrum of the signal at the input; passes audio through with a gain.
// readOut: 0..9 as Loudness, 10 gain dB, 11 0, 12..139 vectorscope (64 x/y pairs), 140..187 spectrum (48 bands, dB)
class Levelness extends Fx {
  constructor(sr) {
    super(sr); this.m = new Loudness(sr); this.resetVal = 0; this.gdb = 0; this.g = 1; this.ring = new Float32Array(2048); this.rl = new Float32Array(2048); this.rr = new Float32Array(2048); this.w = 0;
    this.win = Float32Array.from({ length: 1024 }, (_, i) => 0.5 - 0.5 * Math.cos(TWO_PI * i / 1023)); this.re = new Float32Array(1024); this.im = new Float32Array(1024); this.spec = new Float32Array(48).fill(-100);
  }
  setParam(i, v) { if (i === 0 && v !== this.resetVal) { this.resetVal = v; this.m.clear(); } else if (i === 1) { this.gdb = clamp(v, -24, 24); this.g = dbToLin(this.gdb); } }
  process(L, R, n) {
    this.m.measure(L, R, n);
    for (let i = 0; i < n; i++) { const j = (this.w + i) & 2047; this.rl[j] = L[i]; this.rr[j] = R[i]; }
    this.w = (this.w + n) & 2047;
    const g = this.g; if (g !== 1) for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
  }
  readOut(o) {
    const s = this.m.o; for (let i = 0; i < 10; i++) o[i] = s[i]; o[10] = this.gdb; o[11] = 0;
    const end = this.w, N = 1024, re = this.re, im = this.im;
    for (let p = 0; p < 64; p++) { const j = (end - 1024 + p * 16) & 2047, l = this.rl[j], r = this.rr[j]; o[12 + p * 2] = (l - r) * 0.7071; o[13 + p * 2] = (l + r) * 0.7071; }
    for (let i = 0; i < N; i++) { const j = (end - N + i) & 2047; re[i] = (this.rl[j] + this.rr[j]) * 0.5 * this.win[i]; im[i] = 0; }
    fft(re, im, N);
    const binHz = this.sr / N;
    for (let b = 0; b < 48; b++) {
      const f0 = 30 * Math.pow(600, b / 48), f1 = 30 * Math.pow(600, (b + 1) / 48), k0 = Math.max(1, Math.floor(f0 / binHz)), k1 = Math.min(N / 2 - 1, Math.max(k0, Math.ceil(f1 / binHz) - 1));
      let m = 0; for (let k = k0; k <= k1; k++) m = Math.max(m, Math.sqrt(re[k] * re[k] + im[k] * im[k]));
      const db = linToDb(m * 4 / N); this.spec[b] = db > this.spec[b] ? db : this.spec[b] * 0.8 + db * 0.2; o[140 + b] = this.spec[b];
    }
    return 188;
  }
}

// Analyzer (transparent): 64-band spectrum, correlation / balance / width, peak per channel, dominant pitch, scope + vectorscope points and K-weighted loudness.
// out: 0 correlation, 1 RMS dB, 2..65 spectrum dB, 66 peak L dB, 67 peak R dB, 68 balance (-1..1), 69 width (0..1), 70 peak dB,
//      71 dominant Hz (0 = none), 72 its level dB, 73 reserved, 74..169 scope (96 points), 170..297 vectorscope (64 x/y pairs), 298..309 loudness (as Levelness 0..9, 10 = 0)
class Analyzer extends Fx {
  constructor(sr) {
    super(sr); this.N = 2048; this.ringL = new Float32Array(4096); this.ringR = new Float32Array(4096); this.w = 0; this.sLR = 0; this.sLL = 0; this.sRR = 0;
    this.win = Float32Array.from({ length: 2048 }, (_, i) => 0.5 - 0.5 * Math.cos(TWO_PI * i / 2047)); this.re = new Float32Array(2048); this.im = new Float32Array(2048);
    this.pl = 0; this.pr = 0; this.pk = 0; this.m = new Loudness(sr); this.resetVal = 0; this.mid2 = 0; this.side2 = 0;
  }
  setParam(i, v) { if (i === 0 && v !== this.resetVal) { this.resetVal = v; this.m.clear(); this.pk = 0; } }
  process(L, R, n) {
    const k = Math.exp(-1 / (0.3 * this.sr));
    for (let i = 0; i < n; i++) {
      const l = L[i], r = R[i], j = (this.w + i) & 4095; this.ringL[j] = l; this.ringR[j] = r;
      this.sLR = this.sLR * k + l * r; this.sLL = this.sLL * k + l * l; this.sRR = this.sRR * k + r * r;
      const m = (l + r) * 0.5, s = (l - r) * 0.5; this.mid2 = this.mid2 * k + m * m; this.side2 = this.side2 * k + s * s;
      const al = l < 0 ? -l : l, ar = r < 0 ? -r : r; if (al > this.pl) this.pl = al; if (ar > this.pr) this.pr = ar; if (al > this.pk) this.pk = al; if (ar > this.pk) this.pk = ar;
    }
    this.w = (this.w + n) >>> 0;
    this.m.measure(L, R, n);
  }
  readOut(o) {
    const N = this.N, re = this.re, im = this.im, end = this.w;
    for (let i = 0; i < N; i++) { const x = (this.ringL[(end - N + i) & 4095] + this.ringR[(end - N + i) & 4095]) * 0.5; re[i] = x * this.win[i]; im[i] = 0; }
    fft(re, im, N);
    const d = Math.sqrt(this.sLL * this.sRR), c = 1 - Math.exp(-1 / (0.3 * this.sr));
    o[0] = d > 1e-12 ? this.sLR / d : 0;
    o[1] = linToDb(Math.sqrt((this.sLL + this.sRR) * c * 0.5));
    const binHz = this.sr / N;
    for (let b = 0; b < 64; b++) {
      const f0 = 20 * Math.pow(1000, b / 64), f1 = 20 * Math.pow(1000, (b + 1) / 64);
      const k0 = Math.max(1, Math.floor(f0 / binHz)), k1 = Math.min(N / 2 - 1, Math.max(k0, Math.ceil(f1 / binHz) - 1));
      let m = 0;
      for (let k = k0; k <= k1; k++) m = Math.max(m, Math.sqrt(re[k] * re[k] + im[k] * im[k]));
      o[2 + b] = linToDb(m * 4 / N);
    }
    o[66] = linToDb(this.pl); o[67] = linToDb(this.pr); o[70] = linToDb(this.pk); this.pl *= 0.6; this.pr *= 0.6;
    const rl = Math.sqrt(this.sLL), rr = Math.sqrt(this.sRR);
    o[68] = rl + rr > 1e-9 ? (rr - rl) / (rl + rr) : 0;
    const ms = Math.sqrt(this.mid2), ss = Math.sqrt(this.side2); o[69] = ms + ss > 1e-9 ? ss / (ms + ss) : 0;
    // dominant pitch: strongest bin between 40 Hz and 5 kHz, parabolic interpolation, only when clearly above the floor
    let bk = 0, bm = 0; const lo = Math.max(2, Math.floor(40 / binHz)), hi = Math.min(N / 2 - 2, Math.floor(5000 / binHz));
    for (let k = lo; k <= hi; k++) { const m = re[k] * re[k] + im[k] * im[k]; if (m > bm) { bm = m; bk = k; } }
    const peakDb = linToDb(Math.sqrt(bm) * 4 / N);
    if (bk && peakDb > -60) {
      const m0 = Math.log(Math.sqrt(re[bk - 1] * re[bk - 1] + im[bk - 1] * im[bk - 1]) + 1e-12), m1 = Math.log(Math.sqrt(bm) + 1e-12), m2 = Math.log(Math.sqrt(re[bk + 1] * re[bk + 1] + im[bk + 1] * im[bk + 1]) + 1e-12);
      const den = m0 - 2 * m1 + m2, off = Math.abs(den) > 1e-9 ? 0.5 * (m0 - m2) / den : 0;
      o[71] = (bk + Math.max(-0.5, Math.min(0.5, off))) * binHz; o[72] = peakDb;
    } else { o[71] = 0; o[72] = -100; }
    o[73] = 0;
    // scope: the last 2048 samples folded into 96 signed peaks (mono)
    const span = 2048, per = span / 96;
    for (let p = 0; p < 96; p++) {
      let best = 0, bv = 0; const s0 = Math.floor(p * per);
      for (let q = 0; q < per; q++) { const x = (this.ringL[(end - span + s0 + q) & 4095] + this.ringR[(end - span + s0 + q) & 4095]) * 0.5; const ax = x < 0 ? -x : x; if (ax >= bv) { bv = ax; best = x; } }
      o[74 + p] = best;
    }
    // vectorscope: 64 L/R pairs from the last 1024 samples (x = side, y = mid)
    for (let p = 0; p < 64; p++) { const j = (end - 1024 + p * 16) & 4095, l = this.ringL[j], r = this.ringR[j]; o[170 + p * 2] = (l - r) * 0.7071; o[171 + p * 2] = (l + r) * 0.7071; }
    const lm = this.m.o; for (let i = 0; i < 10; i++) o[298 + i] = lm[i]; o[308] = 0; o[309] = 0;
    return 310;
  }
}

// Stereolizer: mid/side stereo widener with bass-mono and balance.
// 0 width (0..2), 1 mid dB, 2 side dB, 3 bass mono Hz (0 = off), 4 balance, 5 output dB
// readOut: 0 correlation, 1 mid RMS dB, 2 side RMS dB, 3 peak L dB, 4 peak R dB, 5.. vectorscope 64 x/y pairs (out of the processed signal)
class Stereolizer extends Fx {
  constructor(sr) {
    super(sr); this.width = 1; this.mg = 1; this.sg = 1; this.bm = 0; this.bal = 0; this.og = 1; this.lp = new Biquad(); this.sLR = 0; this.sLL = 0; this.sRR = 0; this.m2 = 0; this.s2 = 0; this.pl = 0; this.pr = 0;
    this.vx = new Float32Array(128); this.vi = 0; this.vc = 0; this.upd();
  }
  upd() { if (this.bm >= 20) this.lp.lowpass(this.sr, this.bm, 0.707); }
  setParam(i, v) {
    if (i === 0) this.width = clamp(v, 0, 2); else if (i === 1) this.mg = dbToLin(clamp(v, -12, 12)); else if (i === 2) this.sg = dbToLin(clamp(v, -12, 12));
    else if (i === 3) { this.bm = v < 20 ? 0 : clamp(v, 20, 500); this.upd(); } else if (i === 4) this.bal = clamp(v, -1, 1); else if (i === 5) this.og = dbToLin(clamp(v, -24, 12));
  }
  process(L, R, n) {
    const k = Math.exp(-1 / (0.3 * this.sr)), wd = this.width * this.sg, mg = this.mg, og = this.og, bm = this.bm > 0, lp = this.lp;
    const gl = this.bal > 0 ? 1 - this.bal : 1, gr = this.bal < 0 ? 1 + this.bal : 1;
    for (let i = 0; i < n; i++) {
      const m = (L[i] + R[i]) * 0.5 * mg;
      let s = (L[i] - R[i]) * 0.5 * wd;
      if (bm) s -= lp.process(s);                            // everything below the bass-mono frequency becomes mono
      const l = (m + s) * gl * og, r = (m - s) * gr * og;
      L[i] = l; R[i] = r;
      this.sLR = this.sLR * k + l * r; this.sLL = this.sLL * k + l * l; this.sRR = this.sRR * k + r * r; this.m2 = this.m2 * k + m * m * (1 - k); this.s2 = this.s2 * k + s * s * (1 - k);
      const al = l < 0 ? -l : l, ar = r < 0 ? -r : r; if (al > this.pl) this.pl = al; if (ar > this.pr) this.pr = ar;
      if (++this.vc >= 24) { this.vc = 0; this.vx[this.vi] = (l - r) * 0.7071; this.vx[this.vi + 1] = (l + r) * 0.7071; this.vi = (this.vi + 2) & 127; }
    }
  }
  readOut(o) {
    const d = Math.sqrt(this.sLL * this.sRR); o[0] = d > 1e-12 ? this.sLR / d : 0;
    o[1] = linToDb(Math.sqrt(this.m2)); o[2] = linToDb(Math.sqrt(this.s2)); o[3] = linToDb(this.pl); o[4] = linToDb(this.pr); this.pl *= 0.6; this.pr *= 0.6;
    for (let i = 0; i < 128; i++) o[5 + i] = this.vx[(this.vi + i) & 127];
    return 133;
  }
}

// Spacer: adds room and depth to a dry stereo mix without a long tail (early-reflection network + decorrelated side channel).
// 0 size, 1 spread, 2 damp, 3 mix, 4 pre-delay ms, 5 low cut Hz (wet only)
class Spacer extends Fx {
  constructor(sr) {
    super(sr); this.len = Math.floor(sr * 0.25); this.buf = new Float32Array(this.len); this.w = 0;
    this.size = 0.5; this.spread = 0.5; this.damp = 0.4; this.mix = 0.3; this.pre = 0; this.hp = [new Biquad(), new Biquad()]; this.lpz = [0, 0]; this.hs = new Float32Array(Math.floor(sr * 0.03)); this.hw = 0;
    this.TL = [0.0113, 0.0173, 0.0233, 0.0311, 0.0397, 0.0491]; this.TR = [0.0131, 0.0197, 0.0269, 0.0347, 0.0433, 0.0527]; this.G = [0.8, 0.66, 0.54, 0.44, 0.34, 0.26];
    this.upd(); this.hpf(120);
  }
  hpf(f) { this.hp[0].highpass(this.sr, f, 0.707); this.hp[1].copy(this.hp[0]); }
  upd() { this.k = 1 - Math.exp(-TWO_PI * (2500 + (1 - this.damp) * 12000) / this.sr); this.hd = Math.floor(this.spread * 0.014 * this.sr) + 1; }
  setParam(i, v) {
    if (i === 0) this.size = clamp(v, 0, 1); else if (i === 1) this.spread = clamp(v, 0, 1); else if (i === 2) this.damp = clamp(v, 0, 1); else if (i === 3) this.mix = clamp(v, 0, 1);
    else if (i === 4) this.pre = clamp(v, 0, 60) * 0.001; else if (i === 5) this.hpf(clamp(v, 20, 1000));
    this.upd();
  }
  process(L, R, n) {
    const sr = this.sr, len = this.len, sc = 0.4 + this.size * 1.6, nt = 6, mix = this.mix, pre = this.pre, hn = this.hs.length;
    for (let i = 0; i < n; i++) {
      const m = (L[i] + R[i]) * 0.5; this.buf[this.w] = m;
      let wl = 0, wr = 0;
      for (let t = 0; t < nt; t++) {
        let pl = this.w - Math.floor((this.TL[t] * sc + pre) * sr), pr = this.w - Math.floor((this.TR[t] * sc + pre) * sr);
        if (pl < 0) pl += len; if (pr < 0) pr += len; if (pl < 0) pl += len; if (pr < 0) pr += len;
        wl += this.buf[pl] * this.G[t] * (t & 1 ? -1 : 1); wr += this.buf[pr] * this.G[t] * (t & 1 ? 1 : -1);
      }
      wl *= 0.5; wr *= 0.5;
      this.lpz[0] += this.k * (wl - this.lpz[0]); this.lpz[1] += this.k * (wr - this.lpz[1]);
      const el = this.hp[0].process(this.lpz[0]), er = this.hp[1].process(this.lpz[1]);
      // decorrelated side: the right channel's direct sound is delayed a few ms (Haas) and cross-faded in by the spread amount
      this.hs[this.hw] = R[i]; let hr = this.hw - this.hd; if (hr < 0) hr += hn;
      const rd = R[i] * (1 - this.spread * 0.5 * mix) + this.hs[hr] * this.spread * 0.5 * mix;
      if (++this.hw >= hn) this.hw = 0;
      L[i] = L[i] + el * mix * 1.4; R[i] = rd + er * mix * 1.4;
      if (++this.w >= len) this.w = 0;
    }
  }
}

// MiniMeters (transparent): the data source for the MiniMeters modules (VU, Waveform, Spectrogram, Spectrum, Stereometer, Loudness, Oscilloscope).
// Params: 0 reset (toggle the value), 1 FFT size index (0..4 = 1024..16384), 2 follow pitch (scope trigger), 3 spectrum channels (0 L/R, 1 M/S)
// readOut: 0 corr, 1 corr low, 2 corr mid, 3 corr high, 4 peak L dB, 5 peak R dB, 6 RMS L dB, 7 RMS R dB, 8 mid RMS dB, 9 side RMS dB,
//   10..19 loudness (as Loudness 0..9), 20..23 min/max L, min/max R since the last read, 24..26 low / mid / high band RMS dB (since the last read),
//   27 dominant Hz, 28 its dB, 29 balance, 30 width, 31 sample rate, 32 FFT size, 33 spectrum channel mode, 34..37 min/max mid, min/max side since the last read,
//   40.. four spectra of MM_NB log bins (20 Hz .. 20 kHz): A (L or M-less), B, mono (M), side (S) -> A/B are L/R or M/S, 3rd is always mono sum, 4th always side
//   then scope L (MM_SC points), scope R, stereo dots full (128 x/y pairs), low (64), mid (64), high (64)
const MM_NB = 320, MM_SC = 384, MM_RING = 32768, MM_HEAD = 40;
const MM_OFF = { spec: MM_HEAD, scL: MM_HEAD + MM_NB * 4, scR: MM_HEAD + MM_NB * 4 + MM_SC, dots: MM_HEAD + MM_NB * 4 + MM_SC * 2 };
MM_OFF.dLo = MM_OFF.dots + 256; MM_OFF.dMid = MM_OFF.dLo + 128; MM_OFF.dHi = MM_OFF.dMid + 128; MM_OFF.end = MM_OFF.dHi + 128;
class MiniMeters extends Fx {
  constructor(sr) {
    super(sr); this.rl = new Float32Array(MM_RING); this.rr = new Float32Array(MM_RING); this.w = 0; this.m = new Loudness(sr);
    this.resetVal = 0; this.fftIdx = 2; this.follow = 0; this.msMode = 0; this.cache = null; this.cacheIdx = -1; this.cacheMs = -1; this.rc = 0;
    this.pl = 0; this.pr = 0; this.k = Math.exp(-1 / (0.3 * sr));
    this.sLR = 0; this.sLL = 0; this.sRR = 0; this.mid2 = 0; this.side2 = 0; this.rmsL = 0; this.rmsR = 0;
    this.bLP = [new Biquad(), new Biquad()]; this.bHP = [new Biquad(), new Biquad()];
    for (const b of this.bLP) b.lowpass(sr, 200, 0.707); for (const b of this.bHP) b.highpass(sr, 2000, 0.707);
    this.bs = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];                // per band (low, mid, high): smoothed LR, LL, RR
    this.rb = [new Float32Array(MM_RING >> 2), new Float32Array(MM_RING >> 2), new Float32Array(MM_RING >> 2), new Float32Array(MM_RING >> 2), new Float32Array(MM_RING >> 2), new Float32Array(MM_RING >> 2)];   // L/R of low, mid, high (last 8192 samples)
    this.wb = 0;
    this.fr = new Float32Array(MM_RING >> 1); this.fi = new Float32Array(MM_RING >> 1); this.gr = new Float32Array(MM_RING >> 1); this.gi = new Float32Array(MM_RING >> 1); this.lre = new Float32Array(MM_RING >> 1); this.lim = new Float32Array(MM_RING >> 1);
    this.win = null; this.winN = 0;
    this.mnL = 1; this.mxL = -1; this.mnR = 1; this.mxR = -1; this.mnM = 1; this.mxM = -1; this.mnS = 1; this.mxS = -1; this.e2 = [0, 0, 0]; this.en = 0;
      }
  setParam(i, v) {
    if (i === 0 && v !== this.resetVal) { this.resetVal = v; this.m.clear(); this.pl = this.pr = 0; }
    else if (i === 1) this.fftIdx = clamp(Math.round(v), 0, 4);
    else if (i === 2) this.follow = v >= 0.5 ? 1 : 0;
    else if (i === 3) this.msMode = v >= 0.5 ? 1 : 0;
  }
  process(L, R, n) {
    const k = this.k, bs = this.bs, W = MM_RING - 1, W2 = (MM_RING >> 2) - 1;
    for (let i = 0; i < n; i++) {
      const l = L[i], r = R[i], j = (this.w + i) & W; this.rl[j] = l; this.rr[j] = r;
      this.sLR = this.sLR * k + l * r; this.sLL = this.sLL * k + l * l; this.sRR = this.sRR * k + r * r;
      this.rmsL = this.rmsL * k + l * l * (1 - k); this.rmsR = this.rmsR * k + r * r * (1 - k);
      const m = (l + r) * 0.5, s = (l - r) * 0.5; this.mid2 = this.mid2 * k + m * m; this.side2 = this.side2 * k + s * s;
      const al = l < 0 ? -l : l, ar = r < 0 ? -r : r; if (al > this.pl) this.pl = al; if (ar > this.pr) this.pr = ar;
      if (l < this.mnL) this.mnL = l; if (l > this.mxL) this.mxL = l; if (r < this.mnR) this.mnR = r; if (r > this.mxR) this.mxR = r;
      if (m < this.mnM) this.mnM = m; if (m > this.mxM) this.mxM = m; if (s < this.mnS) this.mnS = s; if (s > this.mxS) this.mxS = s;
      const ll = this.bLP[0].process(l), lr = this.bLP[1].process(r), hl = this.bHP[0].process(l), hr = this.bHP[1].process(r);
      const ml = l - ll - hl, mr = r - lr - hr, jb = (this.wb + i) & W2;
      this.rb[0][jb] = ll; this.rb[1][jb] = lr; this.rb[2][jb] = ml; this.rb[3][jb] = mr; this.rb[4][jb] = hl; this.rb[5][jb] = hr;
      bs[0][0] = bs[0][0] * k + ll * lr; bs[0][1] = bs[0][1] * k + ll * ll; bs[0][2] = bs[0][2] * k + lr * lr;
      bs[1][0] = bs[1][0] * k + ml * mr; bs[1][1] = bs[1][1] * k + ml * ml; bs[1][2] = bs[1][2] * k + mr * mr;
      bs[2][0] = bs[2][0] * k + hl * hr; bs[2][1] = bs[2][1] * k + hl * hl; bs[2][2] = bs[2][2] * k + hr * hr;
      this.e2[0] += ll * ll + lr * lr; this.e2[1] += ml * ml + mr * mr; this.e2[2] += hl * hl + hr * hr;
    }
    this.en += n; this.w = (this.w + n) >>> 0; this.wb = (this.wb + n) >>> 0;
    this.m.measure(L, R, n);
  }
  // magnitude spectra (4 x MM_NB log bins) of the last N samples
  spectra(o) {
    const N = 1024 << this.fftIdx, sr = this.sr, end = this.w, W = MM_RING - 1;
    if (this.winN !== N) { this.win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(TWO_PI * i / (N - 1))); this.winN = N; }
    const re = this.fr, im = this.fi, win = this.win;
    // one complex FFT for both channels: z = L + iR, then L_k = (Z_k + conj Z_(N-k)) / 2 and R_k = (Z_k - conj Z_(N-k)) / 2i
    for (let i = 0; i < N; i++) { const j = (end - N + i) & W, w = win[i]; re[i] = this.rl[j] * w; im[i] = this.rr[j] * w; }
    fft(re, im, N);
    const gr = this.gr, gi = this.gi, lre = this.lre, lim = this.lim;
    for (let kk = 0; kk <= N >> 1; kk++) {
      const k2 = (N - kk) & (N - 1), ar = re[kk], ai = im[kk], br = re[k2], bi = im[k2];
      lre[kk] = (ar + br) * 0.5; lim[kk] = (ai - bi) * 0.5; gr[kk] = (ai + bi) * 0.5; gi[kk] = (br - ar) * 0.5;
    }
    const binHz = sr / N, nyq = N / 2 - 1, top = Math.min(20000, sr * 0.49), sc = 4 / N;
    for (let b = 0; b < MM_NB; b++) {
      const f0 = 20 * Math.pow(top / 20, b / MM_NB), f1 = 20 * Math.pow(top / 20, (b + 1) / MM_NB), fc = Math.sqrt(f0 * f1);
      let k0 = Math.floor(f0 / binHz), k1 = Math.ceil(f1 / binHz) - 1; k0 = Math.max(1, Math.min(nyq, k0)); k1 = Math.max(k0, Math.min(nyq, k1));
      let ma = 0, mb = 0, mm = 0, ms = 0;                        // squared magnitudes while scanning, square roots once at the end
      if (k1 - k0 < 1) {                                       // narrower than one FFT bin: interpolate between the neighbours
        const x = fc / binHz, q = Math.max(1, Math.min(nyq - 1, Math.floor(x))), t = x - q;
        const lr = lre[q] + (lre[q + 1] - lre[q]) * t, li = lim[q] + (lim[q + 1] - lim[q]) * t, rr = gr[q] + (gr[q + 1] - gr[q]) * t, ri = gi[q] + (gi[q + 1] - gi[q]) * t;
        ma = lr * lr + li * li; mb = rr * rr + ri * ri; const sr_ = lr + rr, si_ = li + ri, dr_ = lr - rr, di_ = li - ri; mm = (sr_ * sr_ + si_ * si_) * 0.25; ms = (dr_ * dr_ + di_ * di_) * 0.25;
      } else {
        for (let kk = k0; kk <= k1; kk++) {
          const lr = lre[kk], li = lim[kk], rr = gr[kk], ri = gi[kk];
          const a2 = lr * lr + li * li, b2 = rr * rr + ri * ri, sr_ = lr + rr, si_ = li + ri, dr_ = lr - rr, di_ = li - ri, m2 = (sr_ * sr_ + si_ * si_) * 0.25, s2 = (dr_ * dr_ + di_ * di_) * 0.25;
          if (a2 > ma) ma = a2; if (b2 > mb) mb = b2; if (m2 > mm) mm = m2; if (s2 > ms) ms = s2;
        }
      }
      ma = Math.sqrt(ma); mb = Math.sqrt(mb); mm = Math.sqrt(mm); ms = Math.sqrt(ms);
      let A = ma, B = mb;
      if (this.msMode) { A = mm; B = ms; }
      o[MM_HEAD + b] = linToDb(A * sc); o[MM_HEAD + MM_NB + b] = linToDb(B * sc); o[MM_HEAD + MM_NB * 2 + b] = linToDb(mm * sc); o[MM_HEAD + MM_NB * 3 + b] = linToDb(ms * sc);
    }
    // dominant pitch from the mono spectrum, parabolic interpolation on the log bins is too coarse: use the FFT bins around the strongest log bin
    const lo = Math.max(2, Math.floor(40 / binHz)), hi = Math.min(N / 2 - 2, Math.floor(5000 / binHz));
    let bk = 0, bm = 0;
    for (let kk = lo; kk <= hi; kk++) { const x = lre[kk] + gr[kk], y = lim[kk] + gi[kk], m = x * x + y * y; if (m > bm) { bm = m; bk = kk; } }
    bm = Math.sqrt(bm);
    const pd = linToDb(bm * 0.5 * sc);
    if (bk && pd > -60) {
      const g = (kk) => Math.log(Math.hypot(lre[kk] + gr[kk], lim[kk] + gi[kk]) + 1e-12), m0 = g(bk - 1), m1 = g(bk), m2 = g(bk + 1), den = m0 - 2 * m1 + m2, off = Math.abs(den) > 1e-9 ? 0.5 * (m0 - m2) / den : 0;
      o[27] = (bk + clamp(off, -0.5, 0.5)) * binHz; o[28] = pd;
    } else { o[27] = 0; o[28] = -100; }
  }
  readOut(o) {
    const W = MM_RING - 1, end = this.w, d = Math.sqrt(this.sLL * this.sRR), bs = this.bs;
    const cr = (b) => { const dd = Math.sqrt(b[1] * b[2]); return dd > 1e-12 ? b[0] / dd : 0; };
    o[0] = d > 1e-12 ? this.sLR / d : 0; o[1] = cr(bs[0]); o[2] = cr(bs[1]); o[3] = cr(bs[2]);
    o[4] = linToDb(this.pl); o[5] = linToDb(this.pr); this.pl *= 0.6; this.pr *= 0.6;
    o[6] = linToDb(Math.sqrt(this.rmsL)); o[7] = linToDb(Math.sqrt(this.rmsR));
    const ms = Math.sqrt(this.mid2), ss = Math.sqrt(this.side2); o[8] = linToDb(ms); o[9] = linToDb(ss);
    const lm = this.m.o; for (let i = 0; i < 10; i++) o[10 + i] = lm[i];
    const n = Math.max(1, this.en);
    o[20] = this.mnL > this.mxL ? 0 : this.mnL; o[21] = this.mnL > this.mxL ? 0 : this.mxL; o[22] = this.mnR > this.mxR ? 0 : this.mnR; o[23] = this.mnR > this.mxR ? 0 : this.mxR;
    o[24] = linToDb(Math.sqrt(this.e2[0] / (2 * n))); o[25] = linToDb(Math.sqrt(this.e2[1] / (2 * n))); o[26] = linToDb(Math.sqrt(this.e2[2] / (2 * n)));
    const ok = this.mnM <= this.mxM; o[34] = ok ? this.mnM : 0; o[35] = ok ? this.mxM : 0; o[36] = ok ? this.mnS : 0; o[37] = ok ? this.mxS : 0;
    this.mnL = this.mnR = this.mnM = this.mnS = 1; this.mxL = this.mxR = this.mxM = this.mxS = -1; this.e2[0] = this.e2[1] = this.e2[2] = 0; this.en = 0;
    const rl = Math.sqrt(this.sLL), rr = Math.sqrt(this.sRR);
    o[29] = rl + rr > 1e-9 ? (rr - rl) / (rl + rr) : 0; o[30] = ms + ss > 1e-9 ? ss / (ms + ss) : 0;
    o[31] = this.sr; o[32] = 1024 << this.fftIdx; o[33] = this.msMode; for (let i = 38; i < MM_HEAD; i++) o[i] = 0;
    // big FFTs (8192 / 16384) are refreshed every 2nd / 3rd read only: one such transform is a large share of a 128-sample audio block on a phone
    const every = this.fftIdx >= 3 ? this.fftIdx - 1 : 1, nsp = MM_NB * 4;
    if (every === 1 || !this.cache || this.cacheIdx !== this.fftIdx || this.cacheMs !== this.msMode || (this.rc++ % every) === 0) {
      this.spectra(o); this.rc = 1; this.cacheIdx = this.fftIdx; this.cacheMs = this.msMode;
      if (every > 1) { if (!this.cache) this.cache = new Float32Array(nsp + 2); for (let i = 0; i < nsp; i++) this.cache[i] = o[MM_HEAD + i]; this.cache[nsp] = o[27]; this.cache[nsp + 1] = o[28]; }
    } else { for (let i = 0; i < nsp; i++) o[MM_HEAD + i] = this.cache[i]; o[27] = this.cache[nsp]; o[28] = this.cache[nsp + 1]; }
    // oscilloscope: MM_SC points. Follow pitch = start at a rising zero crossing of the mono signal found in the newest 4096 samples
    const span = 1536; let start = end - span;
    if (this.follow) {
      const back = 4096; let best = -1;
      for (let q = back; q > span; q--) { const a = (this.rl[(end - q) & W] + this.rr[(end - q) & W]) * 0.5, b = (this.rl[(end - q + 1) & W] + this.rr[(end - q + 1) & W]) * 0.5; if (a < 0 && b >= 0) { best = q; break; } }
      if (best > 0) start = end - best;
    }
    const step = span / MM_SC;
    for (let p = 0; p < MM_SC; p++) { const j = (start + Math.floor(p * step)) & W; o[MM_OFF.scL + p] = this.rl[j]; o[MM_OFF.scR + p] = this.rr[j]; }
    // stereo dots: x = side, y = mid, from the last samples (full band 128 points over 1024 samples; bands 64 points over 512)
    for (let p = 0; p < 128; p++) { const j = (end - 1024 + p * 8) & W, l = this.rl[j], r = this.rr[j]; o[MM_OFF.dots + p * 2] = (l - r) * 0.7071; o[MM_OFF.dots + p * 2 + 1] = (l + r) * 0.7071; }
    const W2 = (MM_RING >> 2) - 1, e2 = this.wb;
    for (let band = 0; band < 3; band++) {
      const off = band === 0 ? MM_OFF.dLo : band === 1 ? MM_OFF.dMid : MM_OFF.dHi, A = this.rb[band * 2], B = this.rb[band * 2 + 1];
      for (let p = 0; p < 64; p++) { const j = (e2 - 512 + p * 8) & W2, l = A[j], r = B[j]; o[off + p * 2] = (l - r) * 0.7071; o[off + p * 2 + 1] = (l + r) * 0.7071; }
    }
    return MM_OFF.end;
  }
}

const TYPES = [Utility, AutoFilter, Eq3, Saturator, Compressor, Limiter, Echo, Reverb, ParametricEq, Roar, Autoduck, null, Levelness, Analyzer, Stereolizer, Spacer, MiniMeters,
  Delay, FilterDelay, BeatRepeat, ChorusEnsemble, PhaserFlanger, AutoPan, Gate, GlueComp, ChannelEq, Erosion, Redux, VinylDist, DrumBuss, Tuner, EqEight, Spectrum,
  Amp, Cabinet, Overdrive, Pedal, DynTube, MultibandDyn, Resonators, Corpus, Vocoder, Shifter, GrainDelay, HybridReverb, Looper, SpectralTime, SpectralResonator, LfoMod, ShaperMod, EnvFollower, AudioEffectRack, TapeStop];   // 52 Tape Stop (fx8.js)   // 17.. = Live 12 set (fx3.js)
export function makeDevice(type, sr, sc) { const C = TYPES[type]; return C ? new C(sr, sc) : null; }
