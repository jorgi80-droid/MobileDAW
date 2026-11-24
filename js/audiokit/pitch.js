// Pitch analysis shared by Harmor (resynthesis) and NewTone: YIN (de Cheveigné & Kawahara 2002) with its difference function computed
// through an FFT autocorrelation (O(N log N) a frame instead of O(N * lag)), the cumulative-mean-normalised difference, the absolute
// threshold, parabolic interpolation of the dip and a confidence (1 - the dip's depth). A frame without a dip below the threshold, or
// too quiet, is unvoiced: its f0 is 0 and its confidence the best it reached. Pure functions: Float32Array in, plain arrays out (they
// run in Web Workers and in the Node tests).
import { fft } from '../engine/dsp.js';

const pow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };

// one analyser for a window of W samples and lags up to maxLag (scratch buffers made once)
export function makeYin(W, maxLag) {
  const N = pow2(2 * (W + maxLag)), aRe = new Float64Array(N), aIm = new Float64Array(N), bRe = new Float64Array(N), bIm = new Float64Array(N);
  const d = new Float64Array(maxLag + 1), cm = new Float64Array(maxLag + 1), e = new Float64Array(W + maxLag + 1);
  // x[a .. a + W + maxLag): f0 (Hz, 0 = unvoiced), confidence 0..1, the dip's lag
  return function yin(x, a, sr, minLag, threshold = 0.12) {
    aRe.fill(0); aIm.fill(0); bRe.fill(0); bIm.fill(0);
    const L = W + maxLag;
    for (let i = 0; i < L; i++) { const v = a + i < x.length && a + i >= 0 ? x[a + i] : 0; bRe[i] = v; if (i < W) aRe[i] = v; }
    // r(tau) = sum_{j<W} x_j x_{j+tau}: cross-correlation of the first W samples with the whole window (FFT, conjugate product, inverse)
    fft(aRe, aIm, N); fft(bRe, bIm, N);
    for (let i = 0; i < N; i++) { const r = aRe[i] * bRe[i] + aIm[i] * bIm[i], im = aRe[i] * bIm[i] - aIm[i] * bRe[i]; aRe[i] = r; aIm[i] = -im; }
    fft(aRe, aIm, N);                                   // conj(FFT(conj(X))) / N = inverse; the sign of im is irrelevant for the real part
    // energies of the shifted windows: e_tau = sum_{j<W} x_{j+tau}^2 (running sum)
    let s = 0; const xv = (i) => (a + i < x.length && a + i >= 0 ? x[a + i] : 0);
    for (let j = 0; j < W; j++) s += xv(j) * xv(j);
    const e0 = s; e[0] = s;
    for (let t = 1; t <= maxLag; t++) { s += xv(t + W - 1) ** 2 - xv(t - 1) ** 2; e[t] = s; }
    d[0] = 0; let run = 0; cm[0] = 1;
    for (let t = 1; t <= maxLag; t++) { d[t] = Math.max(0, e0 + e[t] - 2 * aRe[t] / N); run += d[t]; cm[t] = run > 0 ? d[t] * t / run : 1; }
    let tau = -1, best = 1, bt = -1;
    for (let t = Math.max(2, minLag); t < maxLag; t++) {
      if (cm[t] < best) { best = cm[t]; bt = t; }
      if (cm[t] < threshold) { while (t + 1 < maxLag && cm[t + 1] < cm[t]) t++; tau = t; break; }
    }
    if (tau < 0) return { f0: 0, conf: Math.max(0, 1 - best), lag: bt };
    const y0 = cm[tau - 1], y1 = cm[tau], y2 = cm[tau + 1], den = y0 - 2 * y1 + y2, sh = den !== 0 ? Math.max(-1, Math.min(1, 0.5 * (y0 - y2) / den)) : 0;
    return { f0: sr / (tau + sh), conf: Math.max(0, Math.min(1, 1 - y1)), lag: tau + sh };
  };
}

// the pitch track of a mono signal: one frame every `hop` samples (centred), f0 between minF and maxF.
// Returns { hop, f0: Float32Array, conf: Float32Array, rms: Float32Array (dBFS) }.
export function trackPitch(x, sr, { hop = Math.round(sr * 0.005), minF = 50, maxF = 1600, threshold = 0.12, silenceDb = -55 } = {}) {
  const maxLag = Math.ceil(sr / minF) + 2, minLag = Math.max(2, Math.floor(sr / maxF)), W = Math.max(maxLag, Math.round(sr * 0.025));
  const yin = makeYin(W, maxLag), n = Math.max(1, Math.ceil(x.length / hop)), f0 = new Float32Array(n), conf = new Float32Array(n), rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i * hop - (W >> 1);
    let e = 0; for (let j = 0; j < W; j++) { const k = a + j; const v = k >= 0 && k < x.length ? x[k] : 0; e += v * v; }
    const db = 10 * Math.log10(e / W + 1e-20); rms[i] = db;
    if (db < silenceDb) { f0[i] = 0; conf[i] = 0; continue; }
    const r = yin(x, a, sr, minLag, threshold); f0[i] = r.f0; conf[i] = r.conf;
  }
  return { hop, f0, conf, rms };
}

// the note of a pitch track: the median f0 of its confident voiced frames (null when there are too few)
export function medianPitch(tr, minConf = 0.85, minFrames = 4) {
  const v = []; for (let i = 0; i < tr.f0.length; i++) if (tr.f0[i] > 0 && tr.conf[i] >= minConf) v.push(tr.f0[i]);
  if (v.length < minFrames) return null;
  v.sort((a, b) => a - b); return v[v.length >> 1];
}
export const hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
