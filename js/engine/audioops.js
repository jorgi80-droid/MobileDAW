// Offline audio operations on decoded buffers (stretch worker, or the main thread as a fallback): reverse, and three warp algorithms
// (Live-style warp modes, chosen per clip in c.warp.mode):
//   'beats'   WSOLA (waveform-similarity overlap-add, normalised cross-correlation): keeps transients tight - drums, rhythmic loops (default,
//             the only algorithm before v2 projects, so old projects sound the same)
//   'tones'   phase vocoder (4096-point STFT, 4x overlap) with identity phase locking (Laroche & Dolson) and a phase reset on transients: no
//             doubling / flutter on sustained, tonal and polyphonic material (pads, vocals, chords)
//   'repitch' resampling: speed and pitch change together (vinyl / tape), no artefacts at all
import { fft } from './dsp.js';
import { Resampler } from './mp3.js';
export function reverseBuffer(x) { const n = x.length, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = x[n - 1 - i]; return o; }

// ratio = output length / input length (1.5 = 50% longer). Returns { l, r }. Mono input (r === l) stays mono.
export function stretchBuffers(l, r, ratio) {
  const len = l.length, mono = r === l, N = 2048, Hs = N >> 1, tol = 512, outLen = Math.max(N, Math.floor(len * ratio));
  const ol = new Float32Array(outLen + N), or = mono ? ol : new Float32Array(outLen + N);
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const m = mono ? l : Float32Array.from(l, (v, i) => 0.5 * (v + r[i]));
  const add = (pos, outPos, first) => {
    for (let i = 0; i < N; i++) {
      const w = first && i < Hs ? 1 : win[i], p = pos + i, v = p < len ? 1 : 0;
      if (!v) continue;
      ol[outPos + i] += l[p] * w; if (!mono) or[outPos + i] += r[p] * w;
    }
  };
  let prev = 0; add(0, 0, true);
  for (let k = 1; k * Hs < outLen; k++) {
    const nominal = Math.round(k * Hs / ratio), target = prev + Hs;
    let best = Math.min(Math.max(0, nominal), Math.max(0, len - N)), bestC = -Infinity;
    if (target + N <= len) {
      // normalised cross-correlation: loud passages must not win just for being loud (that smears transients)
      let et = 1e-9; for (let i = 0; i < Hs; i += 4) et += m[target + i] * m[target + i];
      const corr = (pos) => { let c = 0, e = 1e-9; for (let i = 0; i < Hs; i += 4) { const y = m[pos + i]; c += m[target + i] * y; e += y * y; } return c / Math.sqrt(e * et); };
      for (let d = -tol; d <= tol; d += 4) { const pos = nominal + d; if (pos < 0 || pos + N > len) continue; const c = corr(pos); if (c > bestC) { bestC = c; best = pos; } }
      const center = best;
      for (let d = -3; d <= 3; d++) { const pos = center + d; if (pos < 0 || pos + N > len) continue; const c = corr(pos); if (c > bestC) { bestC = c; best = pos; } }
    }
    if (best >= len) break;
    add(best, k * Hs, false);
    prev = best;
  }
  return { l: ol.subarray(0, outLen), r: mono ? ol.subarray(0, outLen) : or.subarray(0, outLen) };
}

// Pitch shift that keeps the duration: stretch by the pitch factor, then resample back to the original length.
// mode 'tones' stretches with the phase vocoder (and reads back with 4-point Hermite interpolation); otherwise WSOLA + linear (as before).
export function pitchBuffers(l, r, semitones, mode = 'beats') {
  const f = Math.pow(2, semitones / 12), mono = r === l, pv = mode === 'tones', st = pv ? pvStretch(l, r, f) : stretchBuffers(l, r, f);
  const resample = (x) => { const n = Math.floor(x.length / f), o = new Float32Array(n), last = x.length - 1; for (let i = 0; i < n; i++) { const p = i * f; if (pv) { o[i] = herm(x, p); continue; } const i0 = p | 0, fr = p - i0; o[i] = x[i0] + (x[i0 < last ? i0 + 1 : last] - x[i0]) * fr; } return o; };
  const L = resample(st.l);
  return { l: L, r: mono ? L : resample(st.r) };
}

// 4-point Hermite read of x at fractional position p (0 outside the buffer)
function herm(x, p) {
  const i = Math.floor(p), f = p - i, n = x.length, g = (k) => (k >= 0 && k < n ? x[k] : 0);
  const y0 = g(i - 1), y1 = g(i), y2 = g(i + 1), y3 = g(i + 2), c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * f + c2) * f + c1) * f + y1;
}

// ---------------------------------------------------------------- phase vocoder ('tones')
// srcAt(t) = source frame (fractional) that sounds at output frame t (non-decreasing). Frames of N samples are taken around srcAt(k * HS)
// and written around k * HS. Phases come from the mid signal (L + R) / 2; the same per-bin rotation is applied to both channels, so the
// stereo image (inter-channel phase) is kept. Peaks of the mid spectrum get the phase-vocoder phase, every other bin keeps its phase
// offset to the peak of its region (identity phase locking: sinusoids stay coherent, no "phasiness"). A frame whose spectral flux jumps
// (an attack) takes the analysis phases unchanged (phase reset), so attacks are not smeared by phase drift.
export const PV_N = 4096, PV_HS = 1024;
export function pvWarp(l, r, srcAt, outLen) {
  const N = PV_N, HS = PV_HS, H = N >> 1, B = H + 1, len = l.length, mono = r === l, TWO = 2 * Math.PI;
  const ol = new Float32Array(outLen + N), or = mono ? ol : new Float32Array(outLen + N);
  const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(TWO * i / N);
  const norm = 1 / (N * 1.5);                                   // 1/N of the inverse FFT, 1/1.5 = sum of the squared Hann windows at 4x overlap
  const F = () => [new Float64Array(N), new Float64Array(N)];
  const [lr, li] = F(), [rr, ri] = F(), [mr, mi] = F();
  const pa = new Float64Array(B), ps = new Float64Array(B), phA = new Float64Array(B), phS = new Float64Array(B), mag = new Float64Array(B), pmag = new Float64Array(B);
  const peak = new Int32Array(B), own = new Int32Array(B);
  // transient locking: every frame whose window holds an onset of the source is taken with a hop of exactly HS (local ratio 1) and its
  // phases untouched, so all overlapping frames put the attack at the same output time: it comes out as in the source, not smeared over
  // the 85 ms window. The time this costs is won back over the next frames (hop limited to 0.25 .. 4 x HS).
  const ons = onsets(mono ? l : null, l, r), no = ons.length; let oi = 0, lock = -1;
  let prevPos = 0, first = true;
  const frames = Math.ceil(outLen / HS) + 1;
  for (let k = 0; k <= frames; k++) {
    const t = k * HS, target = srcAt(t);
    let pos;
    if (first) pos = Math.round(target);
    else if (lock >= 0 && ons[lock] >= prevPos + HS - H) pos = prevPos + HS;        // the onset is still inside the next window: keep the hop at HS
    else { lock = -1; const st = Math.round(target) - prevPos; pos = prevPos + Math.max(HS >> 2, Math.min(HS * 4, st)); if (target - prevPos < HS >> 2 && Math.round(target) <= prevPos) pos = prevPos + (HS >> 2); }
    while (oi < no && ons[oi] < pos - H) oi++;
    let trans = false;
    if (lock < 0 && oi < no && !first) {
      // lock from the frame placed so the attack lands where the warp curve wants it (output time of the onset = t + (o - target) / slope),
      // as soon as that frame holds the onset and still moves forward; or at once if the onset would otherwise be passed
      const o = ons[oi], sl = Math.max(1e-3, (srcAt(t + HS) - target) / HS), pl = Math.round(o - (o - target) / sl);
      if ((o <= pl + H && pl > prevPos) || o <= pos + H - HS) { lock = oi; trans = true; pos = Math.max(prevPos + 1, pl); }
    }
    else if (lock >= 0) trans = true;
    const a0 = pos - H, o0 = t - H;
    if (a0 >= len) break;
    for (let i = 0; i < N; i++) {
      const p = a0 + i, w = win[i], x = p >= 0 && p < len ? l[p] : 0, y = mono ? x : (p >= 0 && p < len ? r[p] : 0);
      lr[i] = x * w; li[i] = 0; if (!mono) { rr[i] = y * w; ri[i] = 0; mr[i] = (x + y) * 0.5 * w; mi[i] = 0; }
    }
    fft(lr, li, N); if (!mono) { fft(rr, ri, N); fft(mr, mi, N); }
    const Mr = mono ? lr : mr, Mi = mono ? li : mi;
    for (let b = 0; b < B; b++) { mag[b] = Math.hypot(Mr[b], Mi[b]); phA[b] = Math.atan2(Mi[b], Mr[b]); }
    const dHa = pos - prevPos;
    if (first || trans) { for (let b = 0; b < B; b++) phS[b] = phA[b]; }
    else {
      let np = 0;                                                // peaks of the mid magnitude (local maxima over +-2 bins)
      for (let b = 0; b < B; b++) { const m = mag[b]; if (m > 0 && (b < 1 || m > mag[b - 1]) && (b < 2 || m >= mag[b - 2]) && (b + 1 >= B || m >= mag[b + 1]) && (b + 2 >= B || m >= mag[b + 2])) peak[np++] = b; }
      if (!np) peak[np++] = 0;
      for (let j = 0, b = 0; j < np; j++) {                      // region of peak j: up to the lowest bin between it and the next peak
        let end = B - 1; if (j + 1 < np) { end = peak[j]; for (let q = peak[j]; q <= peak[j + 1]; q++) if (mag[q] < mag[end]) end = q; }
        for (; b <= end; b++) own[b] = peak[j];
      }
      for (let j = 0; j < np; j++) {
        const b = peak[j], w = TWO * b / N;
        let dv = phA[b] - pa[b] - w * dHa; dv -= TWO * Math.round(dv / TWO);
        phS[b] = ps[b] + (dHa > 0 ? (w + dv / dHa) : w) * HS;
      }
      for (let b = 0; b < B; b++) { const p = own[b]; if (p !== b) phS[b] = phS[p] + (phA[b] - phA[p]); }
    }
    for (let b = 0; b < B; b++) {
      let rot = phS[b] - phA[b]; rot -= TWO * Math.round(rot / TWO); pa[b] = phA[b]; ps[b] = phS[b] - TWO * Math.round(phS[b] / TWO); pmag[b] = mag[b];
      const c = Math.cos(rot), sn = Math.sin(rot);
      let x = lr[b], y = li[b]; lr[b] = x * c - y * sn; li[b] = x * sn + y * c;
      if (!mono) { x = rr[b]; y = ri[b]; rr[b] = x * c - y * sn; ri[b] = x * sn + y * c; }
    }
    const inv = (re, im, out) => {
      for (let b = 1; b < H; b++) { re[N - b] = re[b]; im[N - b] = -im[b]; }
      im[0] = 0; im[H] = 0; for (let i = 0; i < N; i++) im[i] = -im[i];
      fft(re, im, N);
      for (let i = 0; i < N; i++) { const o = o0 + i; if (o >= 0 && o < out.length) out[o] += re[i] * win[i] * norm; }
    };
    inv(lr, li, ol); if (!mono) inv(rr, ri, or);
    prevPos = pos; first = false;
  }
  return { l: ol.subarray(0, outLen), r: mono ? ol.subarray(0, outLen) : or.subarray(0, outLen) };
}
// onsets of the source (sample positions): 256-sample energy blocks; a block 4x (6 dB) louder than the 8 before it and within 50 dB of
// the loudest block starts an onset at its first sample above 30 % of its peak; at least 50 ms apart
function onsets(m, l, r) {
  const n = l.length, Bk = 256, nb = Math.floor(n / Bk), e = new Float64Array(nb); let mx = 0;
  for (let k = 0; k < nb; k++) { let s = 0; for (let i = k * Bk; i < (k + 1) * Bk; i++) { const x = m ? m[i] : 0.5 * (l[i] + r[i]); s += x * x; } e[k] = s / Bk; if (e[k] > mx) mx = e[k]; }
  const out = [], gap = Math.round(0.05 * 48000 / Bk); let last = -1e9;
  for (let k = 8; k < nb; k++) {
    let avg = 0; for (let j = k - 8; j < k; j++) avg += e[j]; avg /= 8;
    if (e[k] > 4 * avg + 1e-12 && e[k] > mx * 1e-5 && k - last >= gap) {
      let pk = 0; for (let i = k * Bk; i < (k + 1) * Bk; i++) { const x = Math.abs(m ? m[i] : 0.5 * (l[i] + r[i])); if (x > pk) pk = x; }
      let at = k * Bk; for (let i = Math.max(0, (k - 1) * Bk); i < (k + 1) * Bk; i++) if (Math.abs(m ? m[i] : 0.5 * (l[i] + r[i])) > 0.3 * pk) { at = i; break; }
      out.push(at); last = k;
    }
  }
  return out;
}
export function pvStretch(l, r, ratio) { const outLen = Math.max(PV_N, Math.floor(l.length * ratio)); return pvWarp(l, r, (t) => t / ratio, outLen); }

// ---------------------------------------------------------------- re-pitch ('repitch'): read the source faster / slower
export function repitchWarp(l, r, srcAt, outLen) {
  const mono = r === l, L = new Float32Array(outLen), R = mono ? L : new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) { const p = srcAt(i); L[i] = herm(l, p); if (!mono) R[i] = herm(r, p); }
  return { l: L, r: R };
}


// Variable-ratio time-warp (WSOLA). xo/xs = matching breakpoints (output frame, source frame), both ascending: the source position that should
// sound at output frame p is read from this curve, so the ratio can change along the clip (tempo map, swing). Returns { l, r } of n frames.
export function warpBuffers(l, r, xo, xs, n, mode = 'beats') {
  if (mode === 'tones' || mode === 'repitch') {
    const m0 = xo.length, outLen = Math.max(1, n | 0); let qi = 0;
    if (!m0 || l.length < 2) { const z = new Float32Array(outLen); return { l: z, r: r === l ? z : new Float32Array(outLen) }; }
    const at = (p) => {                                    // same piecewise-linear curve as below (p only grows)
      if (p <= xo[0]) return xs[0] + (p - xo[0]) * (m0 > 1 && xo[1] > xo[0] ? (xs[1] - xs[0]) / (xo[1] - xo[0]) : 1);
      while (qi < m0 - 2 && xo[qi + 1] < p) qi++;
      const a = qi, b = Math.min(m0 - 1, qi + 1), d = xo[b] - xo[a]; return d <= 0 ? xs[b] : xs[a] + (xs[b] - xs[a]) * (p - xo[a]) / d;
    };
    return mode === 'tones' ? pvWarp(l, r, at, outLen) : repitchWarp(l, r, at, outLen);
  }
  const len = l.length, mono = r === l, N = 2048, Hs = N >> 1, tol = 160, m0 = xo.length;
  const outLen = Math.max(1, n | 0), ol = new Float32Array(outLen + N), or = mono ? ol : new Float32Array(outLen + N);
  if (!m0 || len < 2) return { l: ol.subarray(0, outLen), r: mono ? ol.subarray(0, outLen) : or.subarray(0, outLen) };
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const m = mono ? l : Float32Array.from(l, (v, i) => 0.5 * (v + r[i]));
  let qi = 0;
  const srcAt = (p) => {                                   // piecewise-linear lookup, p only grows between calls
    if (p <= xo[0]) return xs[0] + (p - xo[0]) * (m0 > 1 && xo[1] > xo[0] ? (xs[1] - xs[0]) / (xo[1] - xo[0]) : 1);
    while (qi < m0 - 2 && xo[qi + 1] < p) qi++;
    const a = qi, b = Math.min(m0 - 1, qi + 1), d = xo[b] - xo[a];
    if (d <= 0) return xs[b];
    return xs[a] + (xs[b] - xs[a]) * (p - xo[a]) / d ;
  };
  const add = (pos, outPos, first) => {
    for (let i = 0; i < N; i++) {
      const p = pos + i; if (p < 0 || p >= len) continue;
      const o = outPos + i; if (o >= outLen + N) break;
      const w = first && i < Hs ? 1 : win[i];
      ol[o] += l[p] * w; if (!mono) or[o] += r[p] * w;
    }
  };
  let prev = Math.max(0, Math.round(srcAt(0)));
  add(prev, 0, true);
  for (let k = 1; k * Hs < outLen; k++) {
    const nominal = Math.round(srcAt(k * Hs)), target = prev + Hs;
    let best = Math.min(Math.max(0, nominal), Math.max(0, len - N)), bestC = -Infinity;
    if (nominal >= len) break;
    if (target + N <= len && nominal + N <= len + tol) {
      let et = 1e-9; for (let i = 0; i < Hs; i += 4) et += m[target + i] * m[target + i];
      const corr = (pos) => { let c = 0, e = 1e-9; for (let i = 0; i < Hs; i += 4) { const y = m[pos + i]; c += m[target + i] * y; e += y * y; } return c / Math.sqrt(e * et); };
      for (let d = -tol; d <= tol; d += 2) { const pos = nominal + d; if (pos < 0 || pos + N > len) continue; const c = corr(pos); if (c > bestC) { bestC = c; best = pos; } }
      const center = best;
      for (let d = -3; d <= 3; d++) { const pos = center + d; if (pos < 0 || pos + N > len) continue; const c = corr(pos); if (c > bestC) { bestC = c; best = pos; } }
    }
    add(best, k * Hs, false);
    prev = best;
  }
  return { l: ol.subarray(0, outLen), r: mono ? ol.subarray(0, outLen) : or.subarray(0, outLen) };
}
// map = { n, segs: [{ o, n, xo, xs }] } -> one buffer of n frames made of warped segments (o = where the segment starts in the output)
export function warpSegments(l, r, map, mode = 'beats') {
  const mono = r === l, n = Math.max(1, map.n | 0), L = new Float32Array(n), R = mono ? L : new Float32Array(n);
  for (const sg of map.segs) {
    const w = warpBuffers(l, r, sg.xo, sg.xs, sg.n, mode), F = Math.min(48, sg.n >> 1);
    for (let i = 0; i < sg.n && sg.o + i < n; i++) {
      const g = i < F ? i / F : (sg.n - 1 - i) < F ? (sg.n - 1 - i) / F : 1;     // short fades at the segment edges: no clicks where a loop restarts
      L[sg.o + i] += w.l[i] * g; if (!mono) R[sg.o + i] += w.r[i] * g;
    }
  }
  return { l: L, r: R };
}

// ---------------------------------------------------------------- tempo detection
// Estimates the tempo of a sample: onset envelope -> comb-weighted autocorrelation over 60..200 BPM -> folded into a
// musical range. If the sample length is (nearly) a whole number of beats, the BPM is snapped so the loop fits exactly.
// Returns { bpm, conf (0..1), beats, exact } or { error }.
export function detectBpm(l, r, sr) {
  const total = l.length;
  if (!total || !sr || total < sr * 1.5) return { error: 'Sample terlalu pendek untuk mendeteksi tempo (minimal sekitar 1,5 detik).' };
  const useN = Math.min(total, Math.floor(sr * 90)), f = Math.max(1, Math.round(sr / 11025)), hop = 256, m = Math.floor(useN / f), nf = Math.floor(m / hop) - 1;
  if (nf < 40) return { error: 'Sample terlalu pendek untuk mendeteksi tempo.' };
  const mono = r === l, E = new Float32Array(nf), D = new Float32Array(nf);
  let prev = 0;
  for (let k = 0; k < nf; k++) {
    let e = 0, d = 0;
    for (let j = 0; j < hop; j++) {
      const base = (k * hop + j) * f; let x = 0;
      for (let q = 0; q < f; q++) { const p = base + q; x += mono ? l[p] : 0.5 * (l[p] + r[p]); }
      x /= f; e += x * x; d += Math.abs(x - prev); prev = x;
    }
    E[k] = Math.sqrt(e / hop); D[k] = d / hop;
  }
  const O = new Float32Array(nf);
  for (let k = 1; k < nf; k++) O[k] = Math.max(0, Math.log(1 + 80 * E[k]) - Math.log(1 + 80 * E[k - 1])) + Math.max(0, Math.log(1 + 80 * D[k]) - Math.log(1 + 80 * D[k - 1]));
  // remove the slow average so only the transients remain
  const W = 24, sm = new Float32Array(nf); let acc = 0;
  for (let k = 0; k < nf; k++) { acc += O[k]; if (k >= W) acc -= O[k - W]; sm[k] = acc / Math.min(W, k + 1); }
  let en = 0; for (let k = 0; k < nf; k++) { O[k] = Math.max(0, O[k] - sm[k]); en += O[k]; }
  if (en < 1e-4) return { error: 'Tidak ada ketukan yang jelas di sample ini.' };
  const fr = sr / f / hop;                                           // onset frames per second
  const at = (x) => { if (x < 0 || x >= nf - 1) return 0; const i = x | 0, fa = x - i; return O[i] + (O[i + 1] - O[i]) * fa; };
  const ac = (lag) => { let s = 0; const lim = nf - Math.ceil(lag) - 1; for (let k = 0; k < lim; k++) s += O[k] * at(k + lag); return s / Math.max(1, lim); };
  const lo = 60, hi = 200, step = 0.25, S = [], B = [];
  for (let b = lo; b <= hi; b += step) {
    const lag = 60 * fr / b; let s = ac(lag) + 0.5 * ac(lag * 2) + 0.25 * ac(lag * 4);
    const oct = Math.log2(b / 120); s *= Math.exp(-oct * oct / (2 * 0.8 * 0.8));      // mild preference for 90..160 BPM
    B.push(b); S.push(s);
  }
  let bi = 0; for (let i = 1; i < S.length; i++) if (S[i] > S[bi]) bi = i;
  const mean = S.reduce((a, v) => a + v, 0) / S.length;
  if (!(S[bi] > 0)) return { error: 'Tempo tidak bisa dipastikan.' };
  let best = B[bi];
  if (bi > 0 && bi < S.length - 1) { const a = S[bi - 1], b0 = S[bi], c = S[bi + 1], dn = a - 2 * b0 + c; if (dn < 0) best += step * 0.5 * (a - c) / dn; }
  const conf = Math.max(0, Math.min(1, (S[bi] / (mean || 1) - 1) / 6));
  while (best < 70) best *= 2; while (best > 180) best /= 2;
  // loops: snap to the BPM that makes the whole sample an exact number of beats
  const dur = total / sr; let exact = false, beats = dur * best / 60, snapped = best;
  for (const cand of [best, best * 2, best / 2]) {
    if (cand < 60 || cand > 200) continue;
    const bt = dur * cand / 60, B0 = Math.round(bt);
    if (B0 >= 2 && B0 % 2 === 0 && Math.abs(B0 - bt) / bt < 0.02 && (!exact || Math.abs(cand - best) < Math.abs(snapped - best))) { exact = true; snapped = B0 * 60 / dur; beats = B0; }
  }
  if (exact && snapped >= 70 && snapped <= 180) best = snapped;
  else if (exact) { best = snapped; }
  return { bpm: Math.round(best * 100) / 100, conf, beats: exact ? beats : dur * best / 60, exact };
}

// reverse -> pitch -> stretch in one call (same order as the arrangement uses). Runs in the stretch worker, or on the main thread as a fallback.
export function processBuffers(l, r, { rev = false, pitch = 0, ratio = 1, map = null, mode = 'beats' } = {}) {
  const mono = r === l;
  if (rev) { l = reverseBuffer(l); r = mono ? l : reverseBuffer(r); }
  if (pitch) ({ l, r } = pitchBuffers(l, r, pitch, mode));
  if (map) { ({ l, r } = warpSegments(l, mono ? l : r, map, mode)); return { l, r: mono ? l : r, mono }; }
  if (ratio !== 1) ({ l, r } = stretchBy(l, r, ratio, mode));
  return { l, r: mono ? l : r, mono };
}
// constant-ratio stretch with the chosen algorithm (ratio = output length / input length)
export function stretchBy(l, r, ratio, mode = 'beats') {
  if (mode === 'tones') return pvStretch(l, r, ratio);
  if (mode === 'repitch') {                                  // windowed-sinc resampler: band-limited when the speed goes up (no aliasing)
    const n = Math.max(1, Math.floor(l.length * ratio)), one = (x) => { const rs = new Resampler(1, ratio, true), y = rs.process(x), t = rs.process(new Float32Array(256)), o = new Float32Array(n); o.set(y.subarray(0, n)); if (y.length < n) o.set(t.subarray(0, n - y.length), y.length); return o; };
    const L = one(l); return { l: L, r: r === l ? L : one(r) };
  }
  return stretchBuffers(l, r, ratio);
}
