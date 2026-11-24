// The Slicer's onset detection (FLM Slicer, MobileDAW instrument 35), for the display: the same algorithm the engine slices with
// (native/engine/hdslicer.cpp slicerDetect), so the lines drawn on the loop are where the keys start. Port of Honeydew
// crates/audio/src/slicer.rs (https://github.com/daijro/honeydew, GPL-3.0-or-later, see THIRD_PARTY_NOTICES.md); double arithmetic as the C++.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
const HOP = 16, WINDOW = 128, BACK_HOPS = 28, ZC_FRAMES = 882, MIN_SLICE = 2646, MAX_SLICES = 128;
const HP_A = 9.134e-5, HP_B = 0.96, HOPS_PER_MS = 2.7562, ONSET = 1.0, START = 0.75, RMS_FLOOR = 0.05, TAU = 6.283185307179586;
const LOW = { lo: 1, hi: 6, hold: 55, ms: 15, k: 4.5, floor: 1e-10 / 1.8 }, HIGH = { lo: 6, hi: 64, hold: 41, ms: 10, k: 5, floor: 1e-10 / 20 };
function highPass(x) { let p = 0, v = 0; for (let i = 0; i < x.length; i++) { const u = v + HP_A * (x[i] - p); p += u; v = HP_B * u; x[i] -= p; } }
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; while (j & bit) { j ^= bit; bit >>= 1; } j |= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len, sn = Math.sin(ang), cs = Math.cos(ang);
    for (let st = 0; st < n; st += len) { let wr = 1, wi = 0;
      for (let k = st; k < st + len / 2; k++) { const m = k + len / 2, tr = re[m] * wr - im[m] * wi, ti = re[m] * wi + im[m] * wr; re[m] = re[k] - tr; im[m] = im[k] - ti; re[k] += tr; im[k] += ti; const nwr = wr * cs - wi * sn; wi = wr * sn + wi * cs; wr = nwr; } }
  }
}
function bandDetect(b, raw) {
  const fall = Math.exp(-1 / (HOPS_PER_MS * b.ms)), out = new Float64Array(raw.length); let env = 0;
  for (let i = 0; i < raw.length; i++) { let held = 0; for (let q = i >= b.hold ? i - b.hold : 0; q <= i; q++) held = Math.max(held, raw[q]);
    const r = Math.max(env, b.floor); env = held > env ? held : held + (env - held) * fall; out[i] = env >= r ? b.k * (env / r - 1) : 0; }
  return out;
}
function detection(y) {
  const n = Math.floor((y.length + WINDOW + HOP - 1) / HOP), win = new Float64Array(WINDOW); let gain = 0;
  for (let k = 0; k < WINDOW; k++) { win[k] = 0.53836 - 0.46164 * Math.cos(TAU * k / WINDOW); gain += win[k]; }
  const low = new Float64Array(n), high = new Float64Array(n), re = new Float64Array(WINDOW), im = new Float64Array(WINDOW);
  const mean = (a, b) => { let s = 0; for (let k = a; k < b; k++) { const m = Math.hypot(re[k], im[k]) / gain; s += m * m; } return s / (b - a); };
  for (let i = 0; i < n; i++) { for (let k = 0; k < WINDOW; k++) { const q = i * HOP + k; re[k] = q < y.length ? y[q] * win[k] : 0; im[k] = 0; } fft(re, im, WINDOW); low[i] = mean(LOW.lo, LOW.hi); high[i] = mean(HIGH.lo, HIGH.hi); }
  const l = bandDetect(LOW, low), h = bandDetect(HIGH, high); for (let i = 0; i < l.length; i++) l[i] = Math.max(l[i], h[i]);
  return l;
}
// slice start frames of a stereo buffer at the Sensitivity (0..1 normalized, as the engine receives it)
export function slicerDetect(left, right, sensitivity) {
  const frames = left.length, starts = [];
  if (sensitivity > 0 && frames > 0) {
    let peak = 0; for (let k = 0; k < frames; k++) peak = Math.max(peak, Math.abs(left[k]));
    if (right && right !== left) for (let k = 0; k < frames; k++) peak = Math.max(peak, Math.abs(right[k]));
    if (peak !== 0) {
      const x = (k) => left[k] / peak, y = new Float64Array(frames); for (let k = 0; k < frames; k++) y[k] = x(k);
      for (let r = 0; r < 3; r++) highPass(y);
      const d = detection(y), sens = Math.fround(sensitivity);
      const rms = (fr) => { const a = fr * HOP, b = Math.min(fr * HOP + WINDOW, y.length); let s = 0; for (let k = a; k < b; k++) s += x(k) * x(k); return Math.sqrt(s / WINDOW); };
      let i = 0;
      while (i < d.length && starts.length < MAX_SLICES) {
        if (sens * d[i] < ONSET) { i++; continue; }
        let back = i; for (let j = i >= BACK_HOPS ? i - BACK_HOPS : 0; j <= i; j++) if (sens * d[j] > START) { back = j; break; }
        let frame = i; for (let j = back; j <= i; j++) if (rms(j) > RMS_FLOOR) { frame = j; break; }
        let pos = frame * HOP, zc = pos;
        { const lo = Math.max(pos >= ZC_FRAMES ? pos - ZC_FRAMES : 0, 1); for (let k = pos; k >= lo; k--) { if (x(k) === 0 || ((x(k - 1) < 0) !== (x(k) < 0))) { zc = k; break; } } }
        pos = zc;
        if (y.length - pos >= MIN_SLICE) starts.push(pos);
        i = Math.max(Math.floor((pos + MIN_SLICE + WINDOW / 2 + HOP / 2) / HOP), i + 1);
      }
    }
  }
  if (!starts.length && frames > 0) starts.push(0);
  return starts;
}
const cache = new WeakMap();   // per sample buffer: { sens, starts }
export function slicesOf(pyr, sensitivity) {
  if (!pyr || !pyr.l) return null;
  const c = cache.get(pyr); if (c && c.sens === sensitivity) return c.starts;
  const starts = slicerDetect(pyr.l, pyr.mono ? pyr.l : pyr.r, sensitivity); cache.set(pyr, { sens: sensitivity, starts }); return starts;
}
