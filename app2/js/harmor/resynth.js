// Harmor audio resynthesis: an audio file -> a partial map (native/engine/harmor.h, "partial map"). Pure functions (Web Worker + tests).
//
// Pitched sound (a voiced majority): the note is the median YIN pitch (js/audiokit/pitch.js); every frame of an STFT (Hann, size and
// hop by quality) looks for each harmonic k near k x the frame's own f0 (the base note's when the frame is unvoiced), refines its peak
// by parabolic interpolation of the log magnitude, and records its amplitude (left and right), its frequency as a deviation in cents
// from k x the base note (so vibrato, glides and inharmonic partials come back) and its phase. Harmonic layout, base = the note.
// Unpitched sound (drums, noise, chords: no reliable pitch): a log-frequency map instead, the magnitude of every band per frame, which the
// engine reads at each partial's frequency (a spectral envelope, independent of the note played). The report says which and why.
// Amplitudes are sine amplitudes (a full-scale sine = 1), the scale Harmor's timbres use.
import { fft } from '../engine/dsp.js';
import { trackPitch, medianPitch, hzToMidi } from '../audiokit/pitch.js';
import { MAP_MAGIC, MAP_HDR } from './imagemap.js';

// Quality: P = analysis window in periods of the frame's own pitch (shorter = sharper in time), hop in ms (map frames)
export const RESYNTH_QUALITY = [{ name: 'Draft', P: 4, hopMs: 8, N: 2048 }, { name: 'Normal', P: 5, hopMs: 6, N: 4096 }, { name: 'High', P: 5, hopMs: 4, N: 4096 }];
const MAX_FRAMES = 8192, MAX_P = 516;
export const NOISE_BANDS = 32, NOISE_FLO = 40;

// Pitched sound = harmonic + noise model. Every frame (hop by quality) is analysed with a Hann window of P periods of THAT frame's pitch
// (zero-padded FFT): harmonic k is the peak near k x f0, refined by parabolic interpolation; it counts as a harmonic only when its lobe
// stands 6 dB above the floor between the harmonics, and the floor's share is taken out of its energy. Everything that is not a
// harmonic - unvoiced frames (consonants, breath), the floor between harmonics, noise - is the residual: its energy in 32 log bands
// (40 Hz .. 20 kHz) per frame, mid and side, which the engine plays as filtered noise on the same timeline (map N).
export function analyzeResynth(L, R, sr, { quality = 1, maxSec = 60, onProgress } = {}) {
  const len = Math.min(L.length, Math.round(maxSec * sr)), stereo = !!R && R !== L;
  const mono = new Float32Array(len); for (let i = 0; i < len; i++) mono[i] = stereo ? 0.5 * (L[i] + R[i]) : L[i];
  const tr = trackPitch(mono, sr, { hop: Math.round(sr * 0.005), minF: 27, maxF: 2000, threshold: 0.25 });   // down to A0: an 808 / sub bass (D1 = 36.7 Hz) analyses as a pitched tone
  // voicing without flicker: an unvoiced run of <= 20 ms between two voiced frames within a semitone of each other is voiced (f0
  // interpolated) - a harmonic switched off and on every few ms is a rough, noisy modulation the source does not have
  { const v = (i) => tr.f0[i] > 0 && tr.conf[i] > 0.6, n = tr.f0.length, gap = Math.max(1, Math.round(0.02 * sr / tr.hop));
    for (let i = 1; i < n; i++) { if (v(i) || !v(i - 1)) continue; let j = i; while (j < n && !v(j) && j - i < gap + 1) j++;
      if (j < n && v(j) && j - i <= gap && Math.abs(Math.log2(tr.f0[j] / tr.f0[i - 1])) < 1 / 12) { for (let q = i; q < j; q++) { const u = (q - i + 1) / (j - i + 1); tr.f0[q] = tr.f0[i - 1] * Math.pow(tr.f0[j] / tr.f0[i - 1], u); tr.conf[q] = 0.7; } }
      i = j; } }
  const voiced = tr.f0.filter((v, i) => v > 0 && tr.conf[i] > 0.85).length, audible = tr.rms.filter((d) => d > -55).length;
  const fb = medianPitch(tr), pitched = !!fb && voiced >= 0.5 * Math.max(1, audible);
  const Q = RESYNTH_QUALITY[Math.max(0, Math.min(2, quality))];
  if (pitched) {
    const vf = []; for (let i = 0; i < tr.f0.length; i++) if (tr.f0[i] > 0 && tr.conf[i] > 0.85) vf.push(tr.f0[i]); vf.sort((a, b) => a - b);
    const fmin = Math.max(27, vf[Math.floor(0.03 * (vf.length - 1))] * 0.94);
    const even = (x) => 2 * Math.round(x / 2), Wmax = even(Math.ceil(Q.P * sr / fmin)), Wu = even(0.025 * sr);
    let NF = 256; while (NF < 2 * Math.max(Wmax, Wu)) NF <<= 1;
    const hop = Math.max(Math.round(Q.hopMs / 1000 * sr), Math.ceil(len / (MAX_FRAMES - 1))), frames = Math.max(1, Math.ceil(len / hop) + 1);
    const K = Math.max(1, Math.min(MAX_P, Math.floor(0.47 * sr / fmin))), n = frames * K, NB = NOISE_BANDS;
    const aL = new Float32Array(n), aR = stereo ? new Float32Array(n) : null, dev = new Float32Array(n), ph = new Float32Array(n);
    const nfhi = Math.min(20000, 0.47 * sr), lnlo = Math.log2(NOISE_FLO), lnsp = Math.log2(nfhi) - lnlo, nL = new Float32Array(frames * NB), nR = stereo ? new Float32Array(frames * NB) : null;
    const half = NF >> 1, binHz = sr / NF, bandOf = new Int16Array(half).fill(-1);
    for (let k = 1; k < half; k++) { const hz = k * binHz; if (hz >= NOISE_FLO && hz < nfhi) bandOf[k] = Math.min(NB - 1, Math.floor((Math.log2(hz) - lnlo) / lnsp * NB)); }
    const wins = new Map(), hann = (W) => { let w = wins.get(W); if (!w) { const a = new Float64Array(W); let s2 = 0; for (let i = 0; i < W; i++) { a[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / W); s2 += a[i] * a[i]; } w = { a, s2 }; wins.set(W, w); } return w; };
    const reL = new Float64Array(NF), imL = new Float64Array(NF), reR = new Float64Array(NF), imR = new Float64Array(NF);
    const PL = new Float64Array(half), PR = new Float64Array(half), PM = new Float64Array(half), RL = new Float64Array(half), RR = new Float64Array(half);   // RL / RR: residual MID / SIDE power
    const spec = (x, c, W, w, re, im) => { const a0 = c - (W >> 1); re.fill(0); im.fill(0); for (let i = 0; i < W; i++) { const k = a0 + i; re[i] = k >= 0 && k < len ? x[k] * w[i] : 0; } fft(re, im, NF); };
    const f0At = (c) => { const i = Math.max(0, Math.min(tr.f0.length - 1, Math.round(c / tr.hop))); return tr.f0[i] > 0 && tr.conf[i] > 0.6 ? tr.f0[i] : 0; };
    // the residual as a WAVEFORM too: each frame's complex spectrum with the accepted harmonics' lobes brought down to the noise floor
    // (their phase kept), back to time and weighted overlap-add (sum w x / sum w^2): consonants, breath and transients come back exactly
    const wvL = new Float32Array(len), wvR = stereo ? new Float32Array(len) : null, wvN = new Float32Array(len), tmp = new Float64Array(NF), tmi = new Float64Array(NF);
    const lobes = [];
    const ola = (re, im, c, W, w, out) => { for (let i = 0; i < NF; i++) { tmp[i] = re[i]; tmi[i] = -im[i]; } fft(tmp, tmi, NF); const a0 = c - (W >> 1);
      for (let i = 0; i < W; i++) { const k = a0 + i; if (k >= 0 && k < len) out[k] += (tmp[i] / NF) * w[i]; } };
    let eHarm = 0, eRes = 0;
    for (let f = 0; f < frames; f++) {
      const c = f * hop, ff = f0At(c), W = ff ? Math.max(64, Math.min(Wmax, even(Q.P * sr / ff))) : Wu, { a: w, s2 } = hann(W), norm = NF * s2;
      spec(L, c, W, w, reL, imL); if (stereo) spec(R, c, W, w, reR, imR);
      for (let k = 0; k < half; k++) { PL[k] = reL[k] * reL[k] + imL[k] * imL[k]; PR[k] = stereo ? reR[k] * reR[k] + imR[k] * imR[k] : PL[k]; PM[k] = stereo ? 0.5 * (PL[k] + PR[k]) : PL[k];
        if (stereo) { const mr = 0.5 * (reL[k] + reR[k]), mi = 0.5 * (imL[k] + imR[k]), sr2 = 0.5 * (reL[k] - reR[k]), si = 0.5 * (imL[k] - imR[k]); RL[k] = mr * mr + mi * mi; RR[k] = sr2 * sr2 + si * si; } else { RL[k] = PL[k]; RR[k] = 0; } }
      lobes.length = 0;
      if (ff) {
        const lw = Math.max(1, Math.round(Math.min(2 * NF / W, 0.42 * ff / binHz)));   // the whole Hann main lobe (+-2 bins of W): the gap holds side lobes only
        for (let k = 1; k <= K; k++) {
          const fe = k * ff; if (fe >= 0.47 * sr) break;
          const sw = Math.max(1, Math.round(0.25 * ff / binHz)), b0 = Math.round(fe / binHz);
          let b = b0, bm = -1; for (let j = Math.max(1, b0 - sw); j <= Math.min(half - 2, b0 + sw); j++) if (PM[j] > bm) { bm = PM[j]; b = j; }
          const ga = Math.max(1, Math.round((fe - 0.5 * ff) / binHz)), gb = Math.min(half - 1, Math.round((fe + 0.5 * ff) / binHz));
          let eM = 0, eL = 0, eR = 0, nl = 0;
          for (let j = ga; j <= gb; j++) if (j >= b - lw && j <= b + lw) { eM += PM[j]; eL += PL[j]; eR += PR[j]; nl++; }
          if (!nl) continue;
          // the noise floor around the harmonic: per side of the lobe the median of the gap (x 1.44 = the mean of noise, robust to the
          // harmonic's own leakage near the lobe), the quieter side
          const floorOf = (A) => { const side = (a, z) => { const v = []; for (let j = a; j <= z; j++) v.push(A[j]); if (!v.length) return Infinity; v.sort((x, y) => x - y); return 1.4427 * v[v.length >> 1]; };
            const m = Math.min(side(ga, b - lw - 1), side(b + lw + 1, gb)); return Number.isFinite(m) ? m : 0; };
          const fl = floorOf(PM), flL = floorOf(PL), flR = stereo ? floorOf(PR) : flL, flm = floorOf(RL), fls = stereo ? floorOf(RR) : 0;
          const o = f * K + k - 1;
          if (eM <= 4 * fl * nl || bm <= 0) continue;                                   // not a harmonic: stays in the residual
          const hL = Math.max(0, eL - flL * nl), hR = Math.max(0, eR - flR * nl);
          aL[o] = 2 * Math.sqrt(hL / norm); if (stereo) aR[o] = 2 * Math.sqrt(hR / norm);
          eHarm += hL + hR;
          for (let j = Math.max(ga, b - lw); j <= Math.min(gb, b + lw); j++) { RL[j] = Math.min(RL[j], flm); RR[j] = Math.min(RR[j], fls); }
          lobes.push(Math.max(ga, b - lw), Math.min(gb, b + lw), flL, flR);
          let fp = b * binHz;
          if (b > 1 && b < half - 2) { const y0 = Math.log(PM[b - 1] + 1e-30), y1 = Math.log(PM[b] + 1e-30), y2 = Math.log(PM[b + 1] + 1e-30), den = y0 - 2 * y1 + y2; if (den < 0) fp = (b + Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den))) * binHz; }
          const meas = 1200 * Math.log2(fp / (k * fb)), lock = 1200 * Math.log2(ff / fb);
          dev[o] = Math.abs(meas - lock) < 25 ? lock : meas;                             // harmonic lock: within 25 cents = exactly k x f0 (periodic)
          const xr = stereo ? reL[b] + reR[b] : reL[b], xi = stereo ? imL[b] + imR[b] : imL[b];
          let phi = Math.atan2(xi, xr) + Math.PI / 2 + 2 * Math.PI * fp * (W >> 1) / sr; phi /= 2 * Math.PI; ph[o] = phi - Math.floor(phi);
        }
      }
      { const cut = (re, im, ch) => { for (let q = 0; q < lobes.length; q += 4) { const fl = lobes[q + 2 + ch]; for (let j = lobes[q]; j <= lobes[q + 1]; j++) { const pw = re[j] * re[j] + im[j] * im[j]; if (pw > fl) { const g = Math.sqrt(fl / pw); re[j] *= g; im[j] *= g; re[NF - j] *= g; im[NF - j] *= g; } } } };
        cut(reL, imL, 0); ola(reL, imL, c, W, w, wvL); if (stereo) { cut(reR, imR, 1); ola(reR, imR, c, W, w, wvR); }
        const a0 = c - (W >> 1); for (let i = 0; i < W; i++) { const k = a0 + i; if (k >= 0 && k < len) wvN[k] += w[i] * w[i]; } }
      if (f > 0) for (let k = 0; k < K; k++) { const o = f * K + k; if (!aL[o] && !(stereo && aR[o])) dev[o] = dev[o - K]; }   // silent partial: hold the frequency (no glide while it fades)
      // the residual: its energy per band -> the band's RMS, as MID (nL) and SIDE (nR): two independent noises keep the stereo width / correlation
      const bl = new Float64Array(NB), br = new Float64Array(NB);
      for (let k = 1; k < half; k++) { const j = bandOf[k]; if (j < 0) continue; bl[j] += RL[k]; br[j] += RR[k]; }
      for (let j = 0; j < NB; j++) { nL[f * NB + j] = Math.sqrt(2 * bl[j] / norm); if (stereo) nR[f * NB + j] = Math.sqrt(2 * br[j] / norm); eRes += 2 * (bl[j] + br[j]); }
      if (onProgress && f % 64 === 0) onProgress(f / frames);
    }
    // time envelope: the analysis windows (17-27 ms) smear energy into gaps and soften attacks. Per frame, the source's short-time power
    // (Hann, 8 ms or 1.5 periods) against the model's (harmonics + noise, per channel); harmonics and noise of the frame scaled by the
    // square root of the ratio (smoothed over 3 frames, 0 .. 2x), so the resynthesis follows the source's envelope
    for (let k = 0; k < len; k++) { const nn = wvN[k] > 1e-9 ? 1 / wvN[k] : 0; wvL[k] *= nn; if (stereo) wvR[k] *= nn; }
    { const g = new Float32Array(frames), gh = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        const c = f * hop, ff = f0At(c), Ls = Math.max(Math.round(0.008 * sr), ff ? Math.round(1.5 * sr / ff) : 0); let e = 0, er = 0, ws2 = 0;
        for (let i = 0; i < Ls; i++) { const k = c - (Ls >> 1) + i; if (k < 0 || k >= len) continue; const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / Ls), a = L[k], b2 = stereo ? R[k] : a, ra = wvL[k], rb = stereo ? wvR[k] : ra; e += w * (a * a + b2 * b2) / 2; er += w * (ra * ra + rb * rb) / 2; ws2 += w; }
        const eo = ws2 > 0 ? e / ws2 : 0, eres = ws2 > 0 ? er / ws2 : 0; let eh = 0, en = 0;
        for (let k = 0; k < K; k++) { const o = f * K + k, a = aL[o], b2 = stereo ? aR[o] : a; eh += (a * a + b2 * b2) / 4; }
        for (let j = 0; j < NB; j++) { const M = nL[f * NB + j], S2 = stereo ? nR[f * NB + j] : 0; en += M * M + S2 * S2; }
        g[f] = eh + en > 1e-14 ? Math.sqrt(eo / (eh + en)) : 1;                     // band-noise model: harmonics + noise to the source
        gh[f] = eh > 1e-14 ? Math.sqrt(Math.max(0, eo - eres) / eh) : 1;            // waveform residual is exact: harmonics to the rest
      }
      const sm = (a, f) => Math.min(2, (a[Math.max(0, f - 1)] + 2 * a[f] + a[Math.min(frames - 1, f + 1)]) / 4);
      for (let f = 0; f < frames; f++) { const gg = sm(g, f), hh = sm(gh, f);
        for (let k = 0; k < K; k++) { const o = f * K + k; aL[o] *= hh; if (stereo) aR[o] *= hh; }
        for (let j = 0; j < NB; j++) { nL[f * NB + j] *= gg; if (stereo) nR[f * NB + j] *= gg; } } }
    return { layout: 0, frames, bins: K, hop: hop / sr, base: hzToMidi(fb), flo: 20, fhi: 20000, aL, aR, dev, ph,
      noise: { bands: NB, flo: NOISE_FLO, fhi: nfhi, nL, nR, ms: 1 }, wave: { sr, l: wvL, r: wvR },
      report: { pitched: true, note: hzToMidi(fb), hz: fb, voiced: voiced / Math.max(1, audible), frames, partials: K, fft: NF, hopMs: 1000 * hop / sr, quality: Q.name,
        noisePct: 100 * eRes / Math.max(1e-30, eRes + eHarm) } };
  }
  let N = Q.N;
  let hop = Math.max(Math.round(N / 8), Math.ceil(len / (MAX_FRAMES - 1)));
  const frames = Math.max(1, Math.ceil(len / hop) + 1);
  const win = new Float64Array(N); let ws = 0; for (let i = 0; i < N; i++) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); ws += win[i]; }
  const re = new Float64Array(N), im = new Float64Array(N), reR = new Float64Array(N), imR = new Float64Array(N), binHz = sr / N, half = N >> 1;
  const spec = (x, c, oRe, oIm) => { for (let i = 0; i < N; i++) { const k = c - half + i; oRe[i] = k >= 0 && k < len ? x[k] * win[i] : 0; oIm[i] = 0; } fft(oRe, oIm, N); };
  const mag = (oRe, oIm, b) => Math.hypot(oRe[b], oIm[b]);
  // unpitched: log-frequency bands (RMS magnitude of the bins in each band)
  const B = 256, flo = 20, fhi = Math.min(20000, 0.47 * sr), lf0 = Math.log2(flo), lsp = Math.log2(fhi) - lf0, n = frames * B;
  const aL = new Float32Array(n), aR = stereo ? new Float32Array(n) : null;
  const band = (oRe, oIm, j) => { const a = Math.pow(2, lf0 + lsp * (j - 0.5) / (B - 1)) / binHz, b = Math.pow(2, lf0 + lsp * (j + 0.5) / (B - 1)) / binHz;
    let s = 0, c = 0; for (let k = Math.max(1, Math.floor(a)); k <= Math.min(half - 1, Math.ceil(b)); k++) { const m = mag(oRe, oIm, k); s += m * m; c++; }
    if (!c) { const k = Math.max(1, Math.min(half - 1, Math.round((a + b) / 2))); return 2 * mag(oRe, oIm, k) / ws; }
    return 2 * Math.sqrt(s / c) / ws; };
  for (let f = 0; f < frames; f++) {
    spec(L, f * hop, re, im); if (stereo) spec(R, f * hop, reR, imR);
    for (let j = 0; j < B; j++) { aL[f * B + j] = band(re, im, j); if (stereo) aR[f * B + j] = band(reR, imR, j); }
    if (onProgress && f % 64 === 0) onProgress(f / frames);
  }
  return { layout: 1, frames, bins: B, hop: hop / sr, base: 0, flo, fhi, aL, aR, dev: null, ph: null,
    report: { pitched: false, why: fb ? 'nada tidak stabil (sebagian besar tidak bernada)' : 'tidak ada nada yang dapat dipercaya', voiced: voiced / Math.max(1, audible), frames, bands: B, fft: N, hopMs: 1000 * hop / sr, quality: Q.name } };
}
export { MAP_MAGIC, MAP_HDR };
