// Waveform rendering shared by the arrangement and the audio editor.
// buildPyramid: min/max peaks at several resolutions (64 samples per block, x4 per level), so a waveform stays sharp at any zoom.
// wavePath: one filled Path2D, smooth like FL Studio Mobile (true min/max per pixel; zoomed in far enough it follows the samples).
const B0 = 64, GROW = 4;

export function buildPyramid(l, r) {
  const n = l.length, mono = r === l, lv = [];
  let nb = Math.max(1, Math.ceil(n / B0)), mn = new Float32Array(nb), mx = new Float32Array(nb);
  for (let b = 0; b < nb; b++) {
    let lo = Infinity, hi = -Infinity;
    for (let i = b * B0, e = Math.min(n, i + B0); i < e; i++) {
      const a = l[i]; if (a < lo) lo = a; if (a > hi) hi = a;
      if (!mono) { const c = r[i]; if (c < lo) lo = c; if (c > hi) hi = c; }
    }
    if (lo === Infinity) { lo = 0; hi = 0; }
    mn[b] = lo; mx[b] = hi;
  }
  lv.push({ size: B0, mn, mx });
  while (nb > 256) {
    const nn = Math.ceil(nb / GROW), mn2 = new Float32Array(nn), mx2 = new Float32Array(nn);
    for (let b = 0; b < nn; b++) {
      let lo = Infinity, hi = -Infinity;
      for (let i = b * GROW, e = Math.min(nb, i + GROW); i < e; i++) { if (mn[i] < lo) lo = mn[i]; if (mx[i] > hi) hi = mx[i]; }
      mn2[b] = lo; mx2[b] = hi;
    }
    mn = mn2; mx = mx2; nb = nn;
    lv.push({ size: lv[lv.length - 1].size * GROW, mn, mx });
  }
  return { l, r, mono, lv };
}

let MN = 0, MX = 0;
function range(p, a, b) {                                       // min / max over samples [a, b) -> MN, MX
  const n = p.l.length;
  a = Math.max(0, Math.floor(a)); b = Math.min(n, Math.max(a + 1, Math.ceil(b)));
  const span = b - a; let lo = Infinity, hi = -Infinity;
  if (span <= B0 * 4) {
    const l = p.l, r = p.r, mono = p.mono;
    for (let i = a; i < b; i++) {
      const x = l[i]; if (x < lo) lo = x; if (x > hi) hi = x;
      if (!mono) { const y = r[i]; if (y < lo) lo = y; if (y > hi) hi = y; }
    }
  } else {
    let k = 0; while (k + 1 < p.lv.length && p.lv[k + 1].size * 4 <= span) k++;
    const L = p.lv[k], size = L.size, b0 = Math.floor(a / size), b1 = Math.min(L.mn.length, Math.ceil(b / size));
    for (let i = b0; i < b1; i++) { if (L.mn[i] < lo) lo = L.mn[i]; if (L.mx[i] > hi) hi = L.mx[i]; }
  }
  if (lo === Infinity) { lo = 0; hi = 0; }
  MN = lo; MX = hi;
}

// o = { x0, x1 (pixel range to draw), s0 (sample index at pixel x0), spp (samples per pixel), mid, amp (pixels for amplitude 1) }
export function wavePath(p, o) {
  const path = new Path2D(), n = p.l.length, { x0, x1, mid, amp, s0, spp } = o;
  if (!(spp > 0) || !n) return path;
  const idx = (px) => s0 + (px - x0) * spp;
  let a = x0, b = x1;
  if (idx(a) < 0) a = Math.ceil(x0 + (0 - s0) / spp);
  if (idx(b) > n) b = Math.floor(x0 + (n - s0) / spp);
  a = Math.max(a, x0); b = Math.min(b, x1);
  if (b <= a) return path;
  if (spp >= 1) {
    const cnt = b - a, top = new Float32Array(cnt), bot = new Float32Array(cnt);
    for (let i = 0; i < cnt; i++) {
      range(p, idx(a + i), idx(a + i + 1));
      let yt = mid - Math.min(1, MX) * amp, yb = mid - Math.max(-1, MN) * amp;
      if (yb - yt < 1) { const m = (yt + yb) / 2; yt = m - 0.5; yb = m + 0.5; }
      top[i] = yt; bot[i] = yb;
    }
    path.moveTo(a, top[0]);
    for (let i = 0; i < cnt; i++) path.lineTo(a + i + 0.5, top[i]);
    for (let i = cnt - 1; i >= 0; i--) path.lineTo(a + i + 0.5, bot[i]);
    path.closePath();
  } else {                                                      // zoomed in past one sample per pixel: follow the sample curve
    const l = p.l, r = p.r, mono = p.mono, at = (s) => {
      const i = Math.floor(s), f = s - i, j = Math.min(n - 1, i + 1), i0 = Math.max(0, Math.min(n - 1, i));
      const v0 = mono ? l[i0] : 0.5 * (l[i0] + r[i0]), v1 = mono ? l[j] : 0.5 * (l[j] + r[j]);
      return v0 + (v1 - v0) * f;
    };
    path.moveTo(a, mid);
    for (let px = a; px <= b; px++) path.lineTo(px, mid - Math.max(-1, Math.min(1, at(idx(px)))) * amp);
    path.lineTo(b, mid); path.closePath();
  }
  return path;
}

// Fallback for samples without buffers: the coarse one-value-per-bin peaks, drawn as a smooth mirrored shape.
export function peaksPath(pk, o) {
  const path = new Path2D(), { x0, x1, mid, amp, s0, spp } = o, n = pk.length;
  if (!n || !(spp > 0)) return path;
  const top = [], xs = [];
  for (let px = x0; px < x1; px++) {
    const u0 = s0 + (px - x0) * spp, u1 = u0 + spp;
    if (u1 < 0) continue; if (u0 >= n) break;
    const b0 = Math.max(0, Math.floor(u0)), b1 = Math.min(n - 1, Math.max(b0, Math.floor(u1)));
    let m = 0; for (let b = b0; b <= b1; b++) if (pk[b] > m) m = pk[b];
    xs.push(px + 0.5); top.push(Math.max(0.5, m * amp));
  }
  if (!xs.length) return path;
  path.moveTo(xs[0], mid - top[0]);
  for (let i = 0; i < xs.length; i++) path.lineTo(xs[i], mid - top[i]);
  for (let i = xs.length - 1; i >= 0; i--) path.lineTo(xs[i], mid + top[i]);
  path.closePath();
  return path;
}
