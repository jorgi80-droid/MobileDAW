// Automation segment shapes. A point p = { t, v, s, k } describes the segment from p to the next point:
//   s 0 / absent = linear, 1 = step (hold p.v, jump at the next point), 2 = smooth (S-curve, zero slope at both ends),
//   3 = curved (k in -1..1: > 0 slow start / fast end, < 0 fast start / slow end), 4 = Bezier (cubic through the neighbours: Catmull-Rom
//   tangents = a cubic Bezier with handles at a third of them, clamped to the value range so it never overshoots 0..1).
// Values are normalised (0..1, the lane's own scale), so the curve the editor draws is the curve the engine plays (project.js turns every
// non-linear segment into dense breakpoints in this space before mapping them to parameter values; linear segments are sent as before).
export const SHAPES = [['Linear', 0], ['Step', 1], ['Halus (S)', 2], ['Lengkung', 3], ['Bézier', 4]];
export const shapeOf = (p) => (p && p.s >= 1 && p.s <= 4 ? p.s | 0 : 0);

// value of segment i (pts sorted by t) at fraction u (0..1) of its length
export function segValue(pts, i, u) {
  const a = pts[i], b = pts[i + 1]; if (!b) return a.v;
  const s = shapeOf(a), d = b.v - a.v;
  switch (s) {
    case 1: return u < 1 ? a.v : b.v;
    case 2: return a.v + d * (u * u * (3 - 2 * u));
    case 3: { const k = Math.max(-1, Math.min(1, +a.k || 0)), w = k >= 0 ? Math.pow(u, 1 + k * 3) : 1 - Math.pow(1 - u, 1 - k * 3); return a.v + d * w; }
    case 4: {
      const p0 = pts[i - 1] || a, p3 = pts[i + 2] || b, dt = b.t - a.t || 1;
      const m1 = (b.v - p0.v) / ((b.t - p0.t) || 1) * dt, m2 = (p3.v - a.v) / ((p3.t - a.t) || 1) * dt;   // Catmull-Rom tangents in segment units
      const u2 = u * u, u3 = u2 * u, y = (2 * u3 - 3 * u2 + 1) * a.v + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * b.v + (u3 - u2) * m2;
      return Math.max(0, Math.min(1, y));
    }
    default: return a.v + d * u;
  }
}
// value of a sorted point list at local time t (holds the ends)
export function valueAt(pts, t) {
  if (!pts.length) return 0.5;
  if (t <= pts[0].t) return pts[0].v;
  const n = pts.length; if (t >= pts[n - 1].t) return pts[n - 1].v;
  let i = 0; while (i < n - 2 && pts[i + 1].t < t) i++;
  const a = pts[i], b = pts[i + 1], len = b.t - a.t;
  return len <= 0 ? b.v : segValue(pts, i, (t - a.t) / len);
}
// breakpoints [t, v] (local ticks, normalised values) that a linear interpolator follows within tolerance: linear segments stay two points,
// a step becomes a hold + a jump, curves are sampled (about one point per 20 ticks = 1/48 beat, 4..128 per segment)
export function densify(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], s = shapeOf(a);
    out.push([a.t, a.v]);
    if (!b || s === 0) continue;
    const len = b.t - a.t; if (len <= 0) continue;
    if (s === 1) { out.push([b.t - Math.min(1, len / 2), a.v]); continue; }   // hold until just before the next point
    const N = Math.max(4, Math.min(128, Math.ceil(len / 20)));
    for (let k = 1; k < N; k++) { const u = k / N; out.push([a.t + len * u, segValue(pts, i, u)]); }
  }
  return out;
}
