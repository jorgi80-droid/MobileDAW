// Effects of the web engine, Live 12 set (part 3): spectral devices on a shared STFT (Spectral Time, Spectral Resonator).
// Interface as in fx.js (setParam / process / readOut / setTempo). Spectral Resonator also takes notes (midiIn / midiFrom / noteOn / noteOff,
// delivered by core.js midiTo from the track chosen in MIDI From).
import { TWO_PI, clamp, dbToLin, lcg, fft } from './dsp.js';

class Fx { constructor(sr) { this.sr = sr; this.bypass = false; this.bpm = 120; } readOut() { return 0; } setTempo(b) { this.bpm = b; } }
const rnd01 = (o) => lcg(o) / 4294967296;
const wrap = (x) => x - TWO_PI * Math.floor((x + Math.PI) / TWO_PI);
const NOTE_BEATS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16];          // 1/32 ... 4 bars, in quarter notes

// ---- STFT: Hann analysis + synthesis, 4x overlap, latency N samples. frame(re, im) gets both channels' bins 0..N/2 and edits them in place.
export class Stft {
  get latency() { return this.N; }   // measured: an impulse comes out exactly N samples later (tools/pdc-test.mjs)
  constructor(N, hop) {
    this.N = N; this.hop = hop; this.B = N / 2 + 1; this.k = 0; this.win = new Float64Array(N);
    for (let i = 0; i < N; i++) this.win[i] = 0.5 - 0.5 * Math.cos(TWO_PI * i / N);
    let s = 0; for (let i = 0; i < N; i += hop) s += this.win[i] * this.win[i]; this.scale = 1 / (s * N);   // s = sum of w^2 over the overlapping frames; 1/N of the inverse FFT
    const F = () => [new Float64Array(N), new Float64Array(N)];
    this.inp = [new Float32Array(N), new Float32Array(N)]; this.ola = [new Float32Array(N), new Float32Array(N)]; this.out = [new Float32Array(hop), new Float32Array(hop)];
    this.re = F(); this.im = F();
  }
  process(L, R, n, frame) {
    const N = this.N, hop = this.hop, a = this.inp[0], b = this.inp[1], oa = this.out[0], ob = this.out[1];
    for (let i = 0; i < n; i++) {
      a[N - hop + this.k] = L[i]; b[N - hop + this.k] = R[i]; L[i] = oa[this.k]; R[i] = ob[this.k];
      if (++this.k === hop) { this.k = 0; this.run(frame); }
    }
  }
  run(frame) {
    const N = this.N, hop = this.hop, w = this.win;
    for (let c = 0; c < 2; c++) { const re = this.re[c], im = this.im[c], x = this.inp[c]; for (let i = 0; i < N; i++) { re[i] = x[i] * w[i]; im[i] = 0; } fft(re, im, N); }
    frame(this.re, this.im);
    for (let c = 0; c < 2; c++) {
      const re = this.re[c], im = this.im[c], o = this.ola[c];
      for (let j = 1; j < N / 2; j++) { re[N - j] = re[j]; im[N - j] = -im[j]; }
      im[0] = 0; im[N / 2] = 0;
      for (let i = 0; i < N; i++) im[i] = -im[i];
      fft(re, im, N);
      for (let i = 0; i < N; i++) o[i] += re[i] * w[i] * this.scale;
      this.out[c].set(o.subarray(0, hop)); o.copyWithin(0, hop); o.fill(0, N - hop);
      this.inp[c].copyWithin(0, hop);
    }
  }
}
// sonogram column for the displays: NB log-spaced bands (40 Hz .. 16 kHz) in dB from magnitudes m[0..B)
function bands(m, B, sr, N, o, off, NB) {
  for (let j = 0; j < NB; j++) {
    const f0 = 40 * Math.pow(400, j / NB), f1 = 40 * Math.pow(400, (j + 1) / NB), b0 = Math.max(1, Math.floor(f0 * N / sr)), b1 = Math.min(B - 1, Math.max(b0 + 1, Math.ceil(f1 * N / sr)));
    let s = 0; for (let b = b0; b < b1; b++) if (m[b] > s) s = m[b];
    o[off + j] = 20 * Math.log10(s * 4 / N + 1e-9);
  }
}

// ================================================================================================ Spectral Time
// Freezer: 0 on 1 mode (manual / retrigger) 2 retrigger (onsets / sync) 3 freeze 4 interval sync 5 interval note 6 interval ms 7 sensitivity
// 8 fade type (crossfade / envelope) 9 x-fade.  Delay: 10 on 11 time ms 12 feedback 13 shift Hz 14 mode (time / notes / 16th / 16th T / 16th D)
// 15 notes 16 16th steps 17 stereo 18 mix 19 tilt ms 20 spray ms 21 mask
const ST_N = 2048, ST_HOP = 512, ST_D = 384;
export class SpectralTime extends Fx {
  lat() { return this.st.latency; }   // PDC: the whole signal (dry included) goes through the STFT
  constructor(sr) {
    super(sr); this.p = [1, 1, 1, 0, 1, 2, 250, 0.5, 0, 0.25, 1, 250, 0.21, 0, 0, 2, 3, 0, 0.5, 0, 0, 0];
    this.st = new Stft(ST_N, ST_HOP); const B = this.st.B, A = () => [new Float32Array(B), new Float32Array(B)];
    this.mag = A(); this.ph = A(); this.prev = A(); this.pmag = A();
    this.fz = { m: A(), ph: A(), dp: A(), om: A(), oph: A(), odp: A(), on: false, pos: 0, cnt: 0 };
    this.dre = [new Float32Array(ST_D * B), new Float32Array(ST_D * B)]; this.dim = [new Float32Array(ST_D * B), new Float32Array(ST_D * B)]; this.w = 0;
    this.rnd = { seed: 5 }; this.col = new Float32Array(B); this.lvIn = 0; this.lvOut = 0; this.son = new Float32Array(48);
  }
  setParam(i, v) { this.p[i] = v; if (i === 3 && v < 0.5) this.fz.on = false; }
  frames(beats) { return beats * 60 / this.bpm * this.sr / ST_HOP; }
  process(L, R, n) {
    let pk = 0; for (let i = 0; i < n; i++) { const a = Math.abs(L[i]) + Math.abs(R[i]); if (a > pk) pk = a; } this.lvIn = Math.max(pk * 0.5, this.lvIn * 0.97);
    this.st.process(L, R, n, (re, im) => this.frame(re, im));
    pk = 0; for (let i = 0; i < n; i++) { const a = Math.abs(L[i]) + Math.abs(R[i]); if (a > pk) pk = a; } this.lvOut = Math.max(pk * 0.5, this.lvOut * 0.97);
  }
  frame(re, im) {
    const p = this.p, B = this.st.B, fz = this.fz;
    let flux = 0, tot = 0;
    for (let c = 0; c < 2; c++) for (let b = 0; b < B; b++) {
      const m = Math.hypot(re[c][b], im[c][b]), ph = Math.atan2(im[c][b], re[c][b]);
      flux += Math.max(0, m - this.pmag[c][b]); tot += m; this.pmag[c][b] = m;
      this.mag[c][b] = m; this.prev[c][b] = this.ph[c][b]; this.ph[c][b] = ph;
    }
    // ---- Freezer
    if (p[0] > 0.5 && p[3] > 0.5) {
      const retr = Math.round(p[1]) === 1, iv = Math.max(2, p[4] > 0.5 ? this.frames(NOTE_BEATS[clamp(Math.round(p[5]), 0, 7)]) : p[6] * 0.001 * this.sr / ST_HOP);
      fz.cnt++;
      const onset = Math.round(p[2]) === 0 && fz.cnt > 4 && flux > (0.05 + (1 - p[7]) * 0.6) * (tot + 1e-6);
      if (!fz.on || (retr && (Math.round(p[2]) === 1 ? fz.cnt >= iv : onset))) {
        for (let c = 0; c < 2; c++) { fz.om[c].set(fz.m[c]); fz.oph[c].set(fz.ph[c]); fz.odp[c].set(fz.dp[c]); for (let b = 0; b < B; b++) { fz.m[c][b] = this.mag[c][b]; fz.ph[c][b] = this.ph[c][b]; fz.dp[c][b] = wrap(this.ph[c][b] - this.prev[c][b]); } }
        if (!fz.on) for (let c = 0; c < 2; c++) fz.om[c].fill(0);
        fz.on = true; fz.cnt = 0; fz.len = retr && Math.round(p[2]) === 1 ? iv : retr ? 24 : 1e9;
      }
      const env = Math.round(p[8]) === 1, xf = Math.max(1, p[9] * (fz.len < 1e8 ? fz.len : 40)), t = fz.cnt;
      let gn, go;
      if (env) { gn = Math.min(1, (t + 1) / Math.max(1, xf / 2)); if (fz.len < 1e8) gn *= Math.min(1, Math.max(0, (fz.len - t) / Math.max(1, xf / 2))); go = 0; }
      else { gn = Math.min(1, (t + 1) / xf); go = 1 - gn; }
      for (let c = 0; c < 2; c++) for (let b = 0; b < B; b++) {
        fz.ph[c][b] += fz.dp[c][b]; fz.oph[c][b] += fz.odp[c][b];
        const a = fz.m[c][b] * gn, o = fz.om[c][b] * go;
        re[c][b] = a * Math.cos(fz.ph[c][b]) + o * Math.cos(fz.oph[c][b]); im[c][b] = a * Math.sin(fz.ph[c][b]) + o * Math.sin(fz.oph[c][b]);
      }
    } else fz.on = false;
    // ---- Delay: every bin has its own delay (base time + tilt across the spectrum + spray), feedback shifted by Shift Hz, mask = only high / low bins
    if (p[10] > 0.5) {
      const mode = Math.round(p[14]), base = mode === 0 ? p[11] * 0.001 * this.sr / ST_HOP : mode === 1 ? this.frames(NOTE_BEATS[clamp(Math.round(p[15]), 0, 7)]) : this.frames(Math.round(p[16]) * 0.25 * [1, 2 / 3, 1.5][mode - 2]);
      const tilt = p[19] * 0.001 * this.sr / ST_HOP, spray = p[20] * 0.001 * this.sr / ST_HOP, fb = clamp(p[12], 0, 0.98), sh = Math.round(p[13] * ST_N / this.sr), mix = p[18], mask = p[21];
      const w = this.w, D = ST_D;
      for (let c = 0; c < 2; c++) {
        const dr = this.dre[c], di = this.dim[c], st = (c ? 1 : -1) * p[17] * base * 0.25, rr = re[c], ii = im[c];
        for (let b = 0; b < B; b++) {
          const x = b / B, d = clamp(Math.round(base + st + tilt * (x * 2 - 1) + (spray > 0 ? rnd01(this.rnd) * spray : 0)), 1, D - 1);
          const wb = mask > 0 ? (x >= mask ? 1 : 0) : mask < 0 ? (x <= 1 + mask ? 1 : 0) : 1;
          const rf = ((w - d + D) % D) * B, yr = dr[rf + b], yi = di[rf + b], sb = b - sh, fr = sb >= 0 && sb < B ? dr[rf + sb] : 0, fi = sb >= 0 && sb < B ? di[rf + sb] : 0;
          dr[w * B + b] = rr[b] * wb + fr * fb; di[w * B + b] = ii[b] * wb + fi * fb;
          rr[b] = rr[b] * (1 - mix) + yr * mix; ii[b] = ii[b] * (1 - mix) + yi * mix;
        }
      }
      this.w = (w + 1) % D;
    }
    for (let b = 0; b < B; b++) this.col[b] = Math.hypot(re[0][b], im[0][b]) + Math.hypot(re[1][b], im[1][b]);
    bands(this.col, B, this.sr, ST_N, this.son, 0, 48);
  }
  readOut(o) { o[0] = this.lvIn; o[1] = this.lvOut; o[2] = this.fz.on ? 1 : 0; for (let j = 0; j < 48; j++) o[3 + j] = this.son[j]; return 51; }
}

// ================================================================================================ Spectral Resonator
// 0 mode (internal / MIDI) 1 MIDI from (0 = own track, k = track k) 2 freq Hz 3 transp st 4 decay s 5 HF damp 6 LF damp 7 stretch 8 shift st
// 9 mod (none / chorus / wander / granular) 10 mod rate 11 pitch mod st 12 harmonics 13 mono / poly 14 voices 15 unison (1 / 2 / 4 / 8)
// 16 unison amount 17 input send dB 18 dry/wet
const SR_N = 2048, SR_HOP = 512, UNI = [1, 2, 4, 8];
export class SpectralResonator extends Fx {
  lat() { return this.st.latency; }   // PDC: the whole signal (dry included) goes through the STFT
  constructor(sr) {
    super(sr); this.p = [0, 0, 110, 0, 2.6, 0, 0, 0, 0, 0, 0.1, 0, 128, 1, 16, 0, 0.2, 0, 0.5];
    this.st = new Stft(SR_N, SR_HOP); const B = this.st.B;
    this.E = [new Float32Array(B), new Float32Array(B)]; this.phi = new Float64Array(B); this.hf = new Float32Array(B); this.hit = new Uint8Array(B);
    this.notes = []; this.rnd = { seed: 9 }; this.t = 0; this.wan = new Float32Array(256); this.gr = new Uint8Array(256).fill(1); this.grT = 0; this.son = new Float32Array(48); this.col = new Float32Array(B);
    this.midiIn = true;
  }
  setParam(i, v) { this.p[i] = v; if (i === 0 && Math.round(v) === 0) this.notes.length = 0; }
  midiFrom() { return Math.round(this.p[0]) === 1 ? Math.round(this.p[1]) : -1; }
  noteOn(p, v) {
    const poly = this.p[13] > 0.5, max = poly ? clamp(Math.round(this.p[14]), 1, 16) : 1;
    this.notes = this.notes.filter((x) => x.p !== p); this.notes.push({ p, v }); while (this.notes.length > max) this.notes.shift();
  }
  noteOff(p) { this.notes = this.notes.filter((x) => x.p !== p); }
  process(L, R, n) { this.st.process(L, R, n, (re, im) => this.frame(re, im)); for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i]); R[i] = Math.tanh(R[i]); } }   // soft ceiling: resonances can pile up
  frame(re, im) {
    const p = this.p, B = this.st.B, sr = this.sr, hopS = SR_HOP / sr, binHz = sr / SR_N, mix = p[18], send = dbToLin(p[17]);
    this.t += hopS;
    // voices: the internal frequency or the held notes (+ transpose), each with unison copies
    const vs = Math.round(p[0]) === 0 ? [{ f: clamp(p[2], 20, 4000), a: 1 }] : this.notes.map((x) => ({ f: 440 * Math.pow(2, (x.p + p[3] - 69) / 12), a: 0.4 + 0.6 * x.v }));
    const nu = UNI[clamp(Math.round(p[15]), 0, 3)], vv = [];
    for (const v of vs) for (let u = 0; u < nu; u++) vv.push({ f: v.f * Math.pow(2, (nu > 1 ? (u / (nu - 1) - 0.5) * p[16] : 0) / 12), a: v.a / Math.sqrt(nu) });
    const H = clamp(Math.round(p[12]), 1, 256), mod = Math.round(p[9]), pm = p[11], rate = 0.05 + p[10] * 12, str = p[7], shf = Math.pow(2, -p[8] / 12);
    if (mod === 2) for (let k = 0; k < 256; k++) this.wan[k] = clamp(this.wan[k] * 0.995 + (rnd01(this.rnd) - 0.5) * rate * 0.02, -1, 1);
    if (mod === 3) { this.grT += hopS * rate; if (this.grT >= 1) { this.grT -= Math.floor(this.grT); for (let k = 0; k < 256; k++) this.gr[k] = rnd01(this.rnd) < 0.5 ? 1 : 0; } } else this.gr.fill(1);
    this.hit.fill(0);
    for (const v of vv) for (let k = 1; k <= H; k++) {
      let st = 0; if (mod === 1) st = pm * Math.sin(TWO_PI * rate * 0.3 * this.t + k * 1.7); else if (mod === 2) st = pm * this.wan[(k - 1) & 255];
      const f = v.f * Math.pow(k, 1 + str * 0.5) * Math.pow(2, st / 12);
      if (f >= sr * 0.47) break; if (f < 20) continue;
      const b = Math.round(f / binHz); if (b < 1 || b >= B) continue;
      if (!this.gr[(k - 1) & 255]) continue;
      const sbF = b * shf, s0 = Math.round(sbF);
      for (let c = 0; c < 2; c++) { const m = s0 > 0 && s0 < B ? Math.hypot(re[c][s0], im[c][s0]) : 0; this.E[c][b] += m * v.a * send * 0.35; }
      this.hf[b] = f; this.hit[b] = 1;
    }
    for (let b = 1; b < B; b++) {
      const x = b / B, T = Math.max(0.01, p[4] * (1 - p[5] * 0.95 * x) * (1 - p[6] * 0.95 * (1 - x) * (1 - x))), dec = Math.exp(-6.9 * hopS / T);
      this.phi[b] += TWO_PI * (this.hf[b] || b * binHz) * hopS; if (this.phi[b] > 1e6) this.phi[b] = wrap(this.phi[b]);
      const cs = Math.cos(this.phi[b]), sn = Math.sin(this.phi[b]);
      for (let c = 0; c < 2; c++) { const e = this.E[c][b] *= dec; re[c][b] = re[c][b] * (1 - mix) + e * cs * mix; im[c][b] = im[c][b] * (1 - mix) + e * sn * mix; }
      this.col[b] = this.E[0][b] + this.E[1][b];
    }
    re[0][0] *= 1 - mix; re[1][0] *= 1 - mix; im[0][0] *= 1 - mix; im[1][0] *= 1 - mix;
    bands(this.col, B, sr, SR_N, this.son, 0, 48);
  }
  readOut(o) { o[0] = this.notes.length; for (let j = 0; j < 48; j++) o[1 + j] = this.son[j]; return 49; }
}
