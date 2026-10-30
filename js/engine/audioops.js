// Offline audio operations on decoded buffers (main thread): reverse and pitch-preserving time-stretch (WSOLA).
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
export function pitchBuffers(l, r, semitones) {
  const f = Math.pow(2, semitones / 12), mono = r === l, st = stretchBuffers(l, r, f);
  const resample = (x) => { const n = Math.floor(x.length / f), o = new Float32Array(n), last = x.length - 1; for (let i = 0; i < n; i++) { const p = i * f, i0 = p | 0, fr = p - i0; o[i] = x[i0] + (x[i0 < last ? i0 + 1 : last] - x[i0]) * fr; } return o; };
  const L = resample(st.l);
  return { l: L, r: mono ? L : resample(st.r) };
}


// Variable-ratio time-warp (WSOLA). xo/xs = matching breakpoints (output frame, source frame), both ascending: the source position that should
// sound at output frame p is read from this curve, so the ratio can change along the clip (tempo map, swing). Returns { l, r } of n frames.
export function warpBuffers(l, r, xo, xs, n) {
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
export function warpSegments(l, r, map) {
  const mono = r === l, n = Math.max(1, map.n | 0), L = new Float32Array(n), R = mono ? L : new Float32Array(n);
  for (const sg of map.segs) {
    const w = warpBuffers(l, r, sg.xo, sg.xs, sg.n), F = Math.min(48, sg.n >> 1);
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
export function processBuffers(l, r, { rev = false, pitch = 0, ratio = 1, map = null } = {}) {
  const mono = r === l;
  if (rev) { l = reverseBuffer(l); r = mono ? l : reverseBuffer(r); }
  if (pitch) ({ l, r } = pitchBuffers(l, r, pitch));
  if (map) { ({ l, r } = warpSegments(l, mono ? l : r, map)); return { l, r: mono ? l : r, mono }; }
  if (ratio !== 1) ({ l, r } = stretchBuffers(l, r, ratio));
  return { l, r: mono ? l : r, mono };
}
