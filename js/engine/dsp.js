// Shared DSP helpers for the web audio engine. Everything here is allocation-free in the audio path.
export const TWO_PI = Math.PI * 2;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const dbToLin = (db) => Math.pow(10, db * 0.05);
export const linToDb = (x) => 20 * Math.log10(Math.max(x, 1e-9));
export const midiToHz = (n) => 440 * Math.pow(2, (n - 69) / 12);
export const BLOCK = 128;            // frames per render chunk (= Web Audio render quantum)

// Background jobs (building wavetables). The audio thread must never spend tens of milliseconds in one render quantum, so in the worklet (JOBS.sync = false)
// a job runs in small slices: pumpJobs() is called once per quantum and spends at most JOBS.budget points of work (1 point is roughly one wavetable harmonic).
// Everywhere else (export, node tests, UI previews) JOBS.sync stays true and tables are built at once, exactly as before.
export const JOBS = { q: [], sync: true, budget: 6 };
export function pumpJobs() { let pts = JOBS.budget; while (pts > 0 && JOBS.q.length) { const j = JOBS.q[0]; pts -= j.run(pts); if (j.done) JOBS.q.shift(); } }
export function runJobNow(j) { while (!j.done) j.run(1e9); const i = JOBS.q.indexOf(j); if (i >= 0) JOBS.q.splice(i, 1); }


// Park-Miller-ish LCG, returns uint32
export function lcg(o) { o.seed = (Math.imul(o.seed, 1664525) + 1013904223) >>> 0; return o.seed; }

// RBJ biquad (transposed direct form II). Coefficients may be changed at any time; state is kept.
export class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(b0, b1, b2, a0, a1, a2) { const i = 1 / a0; this.b0 = b0 * i; this.b1 = b1 * i; this.b2 = b2 * i; this.a1 = a1 * i; this.a2 = a2 * i; }
  copy(o) { this.b0 = o.b0; this.b1 = o.b1; this.b2 = o.b2; this.a1 = o.a1; this.a2 = o.a2; }
  reset() { this.z1 = this.z2 = 0; }
  process(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
  lowpass(sr, f, q) { f = clamp(f, 10, sr * 0.45); const w = TWO_PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Math.max(q, 0.1)); this.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al); }
  highpass(sr, f, q) { f = clamp(f, 10, sr * 0.45); const w = TWO_PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Math.max(q, 0.1)); this.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al); }
  bandpass(sr, f, q) { f = clamp(f, 10, sr * 0.45); const w = TWO_PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Math.max(q, 0.1)); this.set(al, 0, -al, 1 + al, -2 * c, 1 - al); }
  notch(sr, f, q) { f = clamp(f, 10, sr * 0.45); const w = TWO_PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Math.max(q, 0.1)); this.set(1, -2 * c, 1, 1 + al, -2 * c, 1 - al); }
  peaking(sr, f, q, db) { f = clamp(f, 10, sr * 0.45); const A = Math.pow(10, db / 40), w = TWO_PI * f / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Math.max(q, 0.1)); this.set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A); }
  lowShelf(sr, f, q, db) { f = clamp(f, 10, sr * 0.45); const A = Math.pow(10, db / 40), w = TWO_PI * f / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * Math.max(q, 0.1)), t = 2 * Math.sqrt(A) * al; this.set(A * ((A + 1) - (A - 1) * c + t), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - t), (A + 1) + (A - 1) * c + t, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - t); }
  highShelf(sr, f, q, db) { f = clamp(f, 10, sr * 0.45); const A = Math.pow(10, db / 40), w = TWO_PI * f / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * Math.max(q, 0.1)), t = 2 * Math.sqrt(A) * al; this.set(A * ((A + 1) + (A - 1) * c + t), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - t), (A + 1) - (A - 1) * c + t, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - t); }
}

// Band-limited step (BLEP) residual for the oscillators of every synth (saw, square, pulse: naive - polyBlep at each jump).
// v2: a 16-sample Blackman-windowed sinc step instead of the 2-sample polynomial: aliasing of a 3 kHz saw -30 dB -> about -90 dB, highs flat
// to 15 kHz within 1 dB. The step's cutoff is 19.5 kHz (0.86 x Nyquist at 44.1 kHz). Residual r(x) = S(x) - H(x) for a jump x samples ago
// (x < 0: a jump still to come; the phase increment is assumed constant over +-8 samples, as for any polyBLEP); the return value is 2r for
// the discontinuity at phase 0 and its repeats (several when the period is shorter than the kernel). Same table in dsp.h (C++).
export const BLEP_W = 8, BLEP_M = 1024;
let blepT = null, blepSr = 0;
export function blepInit(sr) {
  if (blepT && blepSr === sr) return;
  const W = BLEP_W, M = BLEP_M, n = 2 * W * M, fc = Math.min(0.86, 19500 / (sr * 0.5)), k = new Float64Array(n + 1), S = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) { const x = -W + i / M, a = Math.PI * fc * x; k[i] = (i === W * M ? 1 : Math.sin(a) / a) * (0.42 + 0.5 * Math.cos(Math.PI * x / W) + 0.08 * Math.cos(2 * Math.PI * x / W)); }
  let acc = 0; for (let i = 1; i <= n; i++) { acc += (k[i - 1] + k[i]) * 0.5; S[i] = acc; }   // integrated kernel (trapezoid), normalised to 0..1
  for (let i = 0; i <= n; i++) S[i] /= acc;
  blepT = S; blepSr = sr;
}
export function polyBlep(t, dt) {
  const W = BLEP_W, wd = W * dt;
  if (t >= wd && t <= 1 - wd) return 0;                       // far from every jump (most samples of a low note)
  if (!blepT) blepInit(48000);
  const T = blepT, M = BLEP_M, k1 = Math.floor(t + wd);
  let s = 0;
  for (let k = Math.ceil(t - wd); k <= k1; k++) {
    const x = (t - k) / dt;
    if (x <= -W || x >= W) continue;
    const f = (x + W) * M, i = Math.floor(f), fr = f - i;
    if (i >= 2 * W * M) continue;                             // x rounded onto the far edge of the kernel (the residual is 0 there)
    s += T[i] + (T[i + 1] - T[i]) * fr - (x >= 0 ? 1 : 0);
  }
  return 2 * s;
}
export const sawBl = (ph, dt) => 2 * ph - 1 - polyBlep(ph, dt);
export function squareBl(ph, dt) { let p2 = ph + 0.5; if (p2 >= 1) p2 -= 1; return (ph < 0.5 ? 1 : -1) + polyBlep(ph, dt) - polyBlep(p2, dt); }
export const triNaive = (ph) => 2 * Math.abs(2 * ph - 1) - 1;
export function wave4(w, ph, dt) { return w === 0 ? sawBl(ph, dt) : w === 1 ? squareBl(ph, dt) : w === 2 ? triNaive(ph) : Math.sin(TWO_PI * ph); }

// ADSR: linear attack, exponential decay/release. stage: 0 idle, 1 attack, 2 decay, 3 sustain, 4 release
export class Adsr {
  constructor() { this.st = 0; this.v = 0; }
  start() { this.st = 1; }   // a retriggered / stolen voice attacks from where it is (no jump to 0 = no click); a free voice is already at 0
  release() { if (this.st !== 0) this.st = 4; }
  next(p) {
    switch (this.st) {
      case 1: this.v += p.aInc; if (this.v >= 1) { this.v = 1; this.st = 2; } break;
      case 2: this.v += (p.s - this.v) * p.dC; if (Math.abs(this.v - p.s) < 1e-4) { this.v = p.s; this.st = 3; } break;
      case 3: this.v = p.s; break;
      case 4: this.v -= this.v * p.rC; if (this.v < 1e-4) { this.v = 0; this.st = 0; } break;
      default: return 0;
    }
    return this.v;
  }
}
// same values as adsrParams but written into an existing object: note-ons in the audio path must not allocate
export function adsrInto(o, a, d, s, r, sr) { o.aInc = 1 / Math.max(1, a * sr); o.dC = 1 - Math.exp(-4.6 / Math.max(1, d * sr)); o.s = s; o.rC = 1 - Math.exp(-4.6 / Math.max(1, r * sr)); return o; }
export function adsrParams(a, d, s, r, sr) {
  return { aInc: 1 / Math.max(1, a * sr), dC: 1 - Math.exp(-4.6 / Math.max(1, d * sr)), s, rC: 1 - Math.exp(-4.6 / Math.max(1, r * sr)) };
}

// In-place radix-2 FFT
export function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TWO_PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const a = i + k, b = a + h, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// Fast approximations for per-sample dB conversions (about 1e-4 relative error) and a rational tanh.
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
export function fastLog2(x) {
  _f32[0] = x; const vx = _u32[0]; _u32[0] = (vx & 0x007FFFFF) | 0x3f000000; const mx = _f32[0];
  return vx * 1.1920928955078125e-7 - 124.22551499 - 1.498030302 * mx - 1.72587999 / (0.3520887068 + mx);
}
export function fastPow2(p) {
  const c = p < -126 ? -126 : p, w = c | 0, z = c - w + (p < 0 ? 1 : 0);
  _u32[0] = (1 << 23) * (c + 121.2740575 + 27.7280233 / (4.84252568 - z) - 1.49012907 * z);
  return _f32[0];
}
export function fastTanh(x) { if (x > 3) return 1; if (x < -3) return -1; const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }

// ---- v68: 2x oversampling for waveshapers (polyphase, 65-tap Kaiser low-pass, ~ -75 dB stop band) --------------------------------------------------
// Run a non-linear stage at twice the sample rate so the harmonics it creates above the base Nyquist are removed instead of folding back as alias tones.
// Round trip (up -> shaper -> down) has a fixed latency of OS2_LATENCY base-rate samples; mix the dry signal through the same delay (see Saturator).
const OS_N = 65, OS_C = 32;
export const OS2_LATENCY = 32;
function osDesign(n, fc, beta) {            // Kaiser-windowed sinc low-pass, odd length, unity DC gain
  const bessel = (x) => { let sum = 1, term = 1; for (let k = 1; k < 40; k++) { term *= (x / (2 * k)) * (x / (2 * k)); sum += term; if (term < 1e-12 * sum) break; } return sum; };
  const c = (n - 1) / 2, h = new Float64Array(n); let dc = 0;
  for (let i = 0; i < n; i++) { const m = i - c, sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m), r = m / c; h[i] = sinc * bessel(beta * Math.sqrt(Math.max(0, 1 - r * r))) / bessel(beta); dc += h[i]; }
  for (let i = 0; i < n; i++) h[i] /= dc;
  return h;
}
const OS_H = osDesign(OS_N, 0.245, 7.3);     // 1x <-> 2x: flat to 20 kHz, stop band from ~27 kHz (48 kHz base)
const OS_H4 = osDesign(21, 0.25, 7.3);       // 2x <-> 4x: the signal is already band-limited, a short filter is enough (4x cheaper)
export class Os2 {
  constructor(h = OS_H) { this.h = h; this.n = h.length; this.ne = (this.n + 1) >> 1; this.no = this.n >> 1; this.xu = new Float64Array(this.n * 2); this.pu = 0; this.xd = new Float64Array(this.n * 2); this.pd = 0; this.o = new Float64Array(2); }
  // input sample x -> two samples at the double rate in this.o[0], this.o[1]
  up(x) {
    const b = this.xu, H = this.h, N = this.n; let p = this.pu - 1; if (p < 0) p = N - 1; this.pu = p; b[p] = x; b[p + N] = x;     // newest sample at b[p], older ones follow
    let a0 = 0, a1 = 0;
    for (let i = 0, e = this.ne; i < e; i++) a0 += H[2 * i] * b[p + i];      // even phase: taps h[0], h[2], ...
    for (let i = 0, e = this.no; i < e; i++) a1 += H[2 * i + 1] * b[p + i];  // odd phase:  taps h[1], h[3], ...
    this.o[0] = 2 * a0; this.o[1] = 2 * a1;                                    // factor 2: zero-stuffing halves the energy
    return this.o;
  }
  // two consecutive samples at the double rate -> one sample at the base rate (taken at the even position: the round trip keeps an integer delay)
  down(a, b2) {
    const w = this.xd, H = this.h, N = this.n; let p = this.pd - 1; if (p < 0) p = N - 1; this.pd = p; w[p] = a; w[p + N] = a;
    let y = 0; for (let i = 0; i < N; i++) y += H[i] * w[p + i];
    p = this.pd - 1; if (p < 0) p = N - 1; this.pd = p; w[p] = b2; w[p + N] = b2;
    return y;
  }
}

// 4x = two 2x stages in cascade (the inner stage runs at the 2x rate). Latency OS4_LATENCY base-rate samples.
export const OS4_LATENCY = OS2_LATENCY + (OS_H4.length - 1) / 4;
export class Os4 {
  constructor() { this.a = new Os2(); this.b = new Os2(OS_H4); this.o = new Float64Array(4); }
  up(x) { const u = this.a.up(x), u0 = u[0], u1 = u[1], o = this.o; let v = this.b.up(u0); o[0] = v[0]; o[1] = v[1]; v = this.b.up(u1); o[2] = v[0]; o[3] = v[1]; return o; }
  down(s0, s1, s2, s3) { const y0 = this.b.down(s0, s1), y1 = this.b.down(s2, s3); return this.a.down(y0, y1); }
}

// ---- plugin delay compensation (PDC) helpers, shared by core.js (tracks / returns / master / click) and fx7.js (parallel rack chains)
// A path never gets more than PDC_MAX - 1 frames of compensation. The rings grow in powers of two (512 .. PDC_MAX) only when a longer delay is
// needed; growing starts from silence (the native engine does the same in its preallocated buffer, so both stay sample-identical).
export const PDC_MAX = 16384;
export function pdcCap(D) { let c = 512; while (c <= D && c < PDC_MAX) c *= 2; return c; }
// latency of a device chain in frames: the devices that report one (d.lat(): look-ahead, oversampling, STFT) and are switched on
export function chainLat(dev) { let l = 0; for (let i = 0; i < dev.length; i++) { const d = dev[i]; if (!d.bypass && d.lat) l += d.lat(); } return l; }
// stereo delay ring for PDC: write first, then read D frames back
export class PdcLine {
  constructor() { this.L = null; this.R = null; this.n = 0; this.w = 0; this.used = false; }
  run(L, R, n, D) {
    if (D >= this.n) { this.n = pdcCap(D); this.L = new Float32Array(this.n); this.R = new Float32Array(this.n); this.w = 0; }   // rare: a longer delay than ever before on this path
    const bl = this.L, br = this.R, M = this.n - 1; let w = this.w;
    for (let i = 0; i < n; i++) { bl[w] = L[i]; br[w] = R[i]; const r = (w - D) & M; L[i] = bl[r]; R[i] = br[r]; w = (w + 1) & M; }
    this.w = w; this.used = true;
  }
  clear() { if (this.used) { this.L.fill(0); this.R.fill(0); this.used = false; } }   // stale audio must never come out when the path starts again
}
// mono delay ring for the metronome (double precision: a click that is not delayed adds exactly as before)
export class ClickLine {
  constructor() { this.b = null; this.n = 0; this.w = 0; this.used = false; }
  run(x, n, D) {
    if (D >= this.n) { this.n = pdcCap(D); this.b = new Float64Array(this.n); this.w = 0; }
    const b = this.b, M = this.n - 1; let w = this.w;
    for (let i = 0; i < n; i++) { b[w] = x[i]; x[i] = b[(w - D) & M]; w = (w + 1) & M; }
    this.w = w; this.used = true;
  }
  clear() { if (this.used) { this.b.fill(0); this.used = false; } }
}
