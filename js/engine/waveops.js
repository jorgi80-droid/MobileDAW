// Wave Editor time-selection operations (FL Studio Mobile Wave Editor): pure functions on sample buffers, a..b in frames (a < b).
// Every function returns NEW Float32Arrays (the source sample is never changed: the editor saves the result as a new sample file and
// the clip points at it, so Undo simply points back). Cut points that remove audio (Clear, Delete Space, Trim) move to the nearest zero
// crossing within 1 ms so no click is made and no transient is chopped; Insert / Duplicate add audio at exact positions.
const ZX = 0.001;   // zero-crossing search window, seconds
export function zeroCross(l, r, i, sr) {
  const w = Math.max(1, Math.round(ZX * sr)), n = l.length; if (i <= 0 || i >= n) return Math.max(0, Math.min(n, i));
  let best = i, bv = Infinity;
  for (let k = Math.max(1, i - w); k <= Math.min(n - 1, i + w); k++) {
    const v = Math.abs(l[k]) + Math.abs(r[k]);
    const cross = (l[k - 1] <= 0) !== (l[k] <= 0);
    const score = cross ? v * 0.25 : v;
    if (score < bv || (score === bv && Math.abs(k - i) < Math.abs(best - i))) { bv = score; best = k; }
  }
  return best;
}
const range = (l, a, b) => [Math.max(0, Math.min(l.length, Math.round(a))), Math.max(0, Math.min(l.length, Math.round(b)))];
const both = (l, r, f) => ({ l: f(l), r: r === l ? null : f(r) });
const fin = (o, l) => ({ l: o.l, r: o.r || o.l });
function splice(x, a, b, ins) { const out = new Float32Array(x.length - (b - a) + ins.length); out.set(x.subarray(0, a), 0); out.set(ins, a); out.set(x.subarray(b), a + ins.length); return out; }

export function insertSilence(l, r, a, b) { [a, b] = range(l, a, b); const z = new Float32Array(b - a); return fin(both(l, r, (x) => splice(x, a, a, z))); }
export function duplicate(l, r, a, b) { [a, b] = range(l, a, b); return fin(both(l, r, (x) => splice(x, b, b, x.slice(a, b)))); }
export function clear(l, r, a, b, sr) { [a, b] = range(l, a, b); a = zeroCross(l, r, a, sr); b = zeroCross(l, r, b, sr); return fin(both(l, r, (x) => { const y = x.slice(); y.fill(0, a, b); return y; })); }
export function deleteSpace(l, r, a, b, sr) { [a, b] = range(l, a, b); a = zeroCross(l, r, a, sr); b = zeroCross(l, r, b, sr); return { ...fin(both(l, r, (x) => splice(x, a, b, new Float32Array(0)))), a, b }; }
export function trim(l, r, a, b, sr) { [a, b] = range(l, a, b); a = zeroCross(l, r, a, sr); b = zeroCross(l, r, b, sr); return { ...fin(both(l, r, (x) => x.slice(a, b))), a, b }; }
export function fade(l, r, a, b, dir) {                     // dir 1 = fade in (0 -> 100 %), -1 = fade out (100 % -> 0); linear over the selection
  [a, b] = range(l, a, b); const n = Math.max(1, b - a);
  return fin(both(l, r, (x) => { const y = x.slice(); for (let i = a; i < b; i++) { const k = (i - a) / n; y[i] *= dir > 0 ? k : 1 - k; } return y; }));
}
// peak of the selection -> target (dBFS); returns { l, r, gain }
export function normalize(l, r, a, b, targetDb = -0.1) {
  [a, b] = range(l, a, b); let pk = 0;
  for (const x of r === l ? [l] : [l, r]) for (let i = a; i < b; i++) { const v = Math.abs(x[i]); if (v > pk) pk = v; }
  if (pk < 1e-6) return { l, r, gain: 1 };
  const g = Math.pow(10, targetDb / 20) / pk;
  return { ...fin(both(l, r, (x) => { const y = x.slice(); for (let i = a; i < b; i++) y[i] *= g; return y; })), gain: g };
}
