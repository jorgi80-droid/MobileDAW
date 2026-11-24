// Harmor image synthesis: picture pixels -> a partial map (native/engine/harmor.h "partial map"), and the packing of any map into
// the two sample-bank slots the engine reads. Pure functions (Web Worker + tests).
//
// Horizontal = time (left to right), vertical = partial (harmonic layout: the bottom row is partial 1) or frequency (log layout:
// the bottom row is the lowest frequency, the top the highest), brightness = amplitude: luminance -> gamma -> a decibel range
// (the brightest pixel 0 dB, `rangeDb` below it silence). The picture region (crop x0..x1, y0..y1 of 0..1, so zoom / pan / position)
// is resampled to frames x bins with bilinear interpolation. Stereo (optional): the colour pans each pixel, red left, blue right.
// The whole map is scaled once so its loudest frame is no louder than a saw (RMS), keeping the picture's dynamics.
export const MAP_MAGIC = 4096.5, MAP_HDR = 16, MAX_P = 516;

export function buildImageMap(rgba, w, h, o = {}) {
  const x0 = clamp(o.x0 ?? 0, 0, 1), x1 = clamp(o.x1 ?? 1, x0 + 1e-6, 1), y0 = clamp(o.y0 ?? 0, 0, 1), y1 = clamp(o.y1 ?? 1, y0 + 1e-6, 1);
  const layout = o.layout === 1 ? 1 : 0;
  const frames = Math.max(1, Math.min(4096, Math.round(o.frames || Math.min(1024, (x1 - x0) * w))));
  const bins = Math.max(1, Math.min(MAX_P, Math.round(o.bins || (layout ? 256 : Math.min(MAX_P, (y1 - y0) * h)))));
  const gamma = o.gamma > 0 ? o.gamma : 1, range = o.rangeDb > 0 ? o.rangeDb : 60, stereo = !!o.stereo, invert = !!o.invert;
  const n = frames * bins, aL = new Float32Array(n), aR = stereo ? new Float32Array(n) : null;
  const px = (x, y, c) => rgba[(y * w + x) * 4 + c];
  const sample = (fx, fy) => {                          // bilinear rgb at a fractional pixel position
    const xa = Math.max(0, Math.min(w - 1, Math.floor(fx))), ya = Math.max(0, Math.min(h - 1, Math.floor(fy))), xb = Math.min(w - 1, xa + 1), yb = Math.min(h - 1, ya + 1), tx = clamp(fx - xa, 0, 1), ty = clamp(fy - ya, 0, 1);
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) { const t0 = px(xa, ya, c) + (px(xb, ya, c) - px(xa, ya, c)) * tx, t1 = px(xa, yb, c) + (px(xb, yb, c) - px(xa, yb, c)) * tx; out[c] = (t0 + (t1 - t0) * ty) / 255; }
    return out;
  };
  for (let f = 0; f < frames; f++) {
    const fx = (x0 + (x1 - x0) * (frames === 1 ? 0.5 : f / (frames - 1))) * (w - 1);
    for (let j = 0; j < bins; j++) {
      const fy = (y1 - (y1 - y0) * (bins === 1 ? 0.5 : j / (bins - 1))) * (h - 1);   // bin 0 = the bottom of the region
      const [r, g, b] = sample(fx, fy);
      let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b; if (invert) lum = 1 - lum;
      const v = Math.pow(Math.max(0, lum), gamma);
      const a = v < 1 / 255 ? 0 : Math.pow(10, (v - 1) * range / 20);
      const o2 = f * bins + j;
      if (stereo) { const pan = r + b > 1e-6 ? (b - r) / (r + b) : 0, an = (pan + 1) * Math.PI / 4; aL[o2] = a * Math.cos(an) * Math.SQRT2; aR[o2] = a * Math.sin(an) * Math.SQRT2; }
      else aL[o2] = a;
    }
  }
  // loudness: the loudest frame no louder than a saw (sum of a^2 / 2 <= 1/3), only harmonic layout (log layout = an envelope)
  if (layout === 0) {
    let mx = 0; for (let f = 0; f < frames; f++) { let e = 0; for (let j = 0; j < bins; j++) { const l = aL[f * bins + j], r = aR ? aR[f * bins + j] : l; e += (l * l + r * r) / 4; } mx = Math.max(mx, e); }
    const g = mx > 1 / 3 ? Math.sqrt((1 / 3) / mx) : 1;
    if (g < 1) { for (let i = 0; i < n; i++) aL[i] *= g; if (aR) for (let i = 0; i < n; i++) aR[i] *= g; }
  }
  const secs = o.seconds > 0 ? o.seconds : 2;
  return { layout, frames, bins, hop: secs / frames, base: 0, flo: o.flo || 40, fhi: o.fhi || 16000, aL, aR, dev: null, ph: null };
}

// a map -> the slots: A = { l: header + left amplitude, r: header + right amplitude (null = mono) }, B = deviation / phase (or null),
// N = the residual noise bands (or null)
export function packMap(m) {
  const n = m.frames * m.bins, head = (arr) => { arr[0] = MAP_MAGIC; arr[1] = m.frames; arr[2] = m.bins; arr[3] = m.hop; arr[4] = m.layout; arr[5] = m.base || 0; arr[6] = m.flo || 20; arr[7] = m.fhi || 20000; return arr; };
  const mk = (src) => { const a = head(new Float32Array(MAP_HDR + n)); a.set(src, MAP_HDR); return a; };
  const A = { l: mk(m.aL), r: m.aR ? mk(m.aR) : null };
  const B = m.dev ? { l: mk(m.dev), r: m.ph ? mk(m.ph) : null } : null;
  // N (resynthesis residual): frames x noise bands of band RMS (mid / side when header[5] = 1, else left / right), layout 2, its band edges
  let N = null;
  if (m.noise) { const nz = m.noise, nb = m.frames * nz.bands, mkN = (src) => { const a = new Float32Array(MAP_HDR + nb); a[0] = MAP_MAGIC; a[1] = m.frames; a[2] = nz.bands; a[3] = m.hop; a[4] = 2; a[5] = nz.ms ? 1 : 0; a[6] = nz.flo; a[7] = nz.fhi; a.set(src, MAP_HDR); return a; };
    N = { l: mkN(nz.nL), r: nz.nR ? mkN(nz.nR) : null }; }
  // W (resynthesis residual as a waveform): header (magic, samples, channels, sample rate, layout 3), then the samples (left / right)
  let W = null;
  if (m.wave) { const wv = m.wave, n = wv.l.length, mkW = (src) => { const a = new Float32Array(MAP_HDR + n); a[0] = MAP_MAGIC; a[1] = n; a[2] = wv.r ? 2 : 1; a[3] = wv.sr; a[4] = 3; a.set(src, MAP_HDR); return a; };
    W = { l: mkW(wv.l), r: wv.r ? mkW(wv.r) : null }; }
  return { A, B, N, W };
}
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
