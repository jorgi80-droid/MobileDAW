// Displays of the FL Studio Mobile effect modules (fxkit.js flmPanel), drawn the Live way from the module's own laws: EQ and filter
// responses from the same biquad coefficients the engine uses (native/engine/hdfx.cpp, Honeydew biquad.rs), the transfer curves of the
// dynamics and shapers, the gain shapes of Tremolo / Autoduck, echo taps of the delays, the decay of the reverbs. Values are the
// module's normalized FLM params (get(i)). Laws ported from Honeydew (https://github.com/daijro/honeydew, GPL-3.0-or-later).
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
import { DISPC, lvPath } from './liveui.js';

const SR = 44100, F0 = 20, F1 = 20000, TAU = 2 * Math.PI;
const lx = (f, w) => (Math.log(f / F0) / Math.log(F1 / F0)) * w, xl = (x, w) => F0 * Math.pow(F1 / F0, x / w);
const sq = (x) => x * x, clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const LS = 3, PK = 4, HS = 5, LP = 0, BP = 1, HP = 2;
// biquad.rs set_parametric_response / set_filter_response (double here: a display)
function param(resp, hz, bw, db, sr) {
  if (db === 0) return [1, 0, 0, 0, 0];
  const a = Math.pow(10, db * 0.05), om = clamp(hz * TAU / sr, 0, 3), s = Math.sin(om), c = Math.cos(om), al = s * Math.sinh(0.3465736 * bw * om / s);
  let B0, B1, B2, A0, A1, A2;
  if (resp === PK) { B0 = 1 + al * a; B1 = -2 * c; B2 = 1 - al * a; A0 = 1 + al / a; A1 = -2 * c; A2 = 1 - al / a; }
  else { const sh = 2 * Math.sqrt(a) * al, ap = a + 1, am = a - 1;
    if (resp === LS) { B0 = a * (ap - am * c + sh); B1 = 2 * a * (am - ap * c); B2 = a * (ap - am * c - sh); A0 = ap + am * c + sh; A1 = -2 * (am + ap * c); A2 = ap + am * c - sh; }
    else { B0 = a * (ap + am * c + sh); B1 = -2 * a * (am + ap * c); B2 = a * (ap + am * c - sh); A0 = ap - am * c + sh; A1 = 2 * (am - ap * c); A2 = ap - am * c - sh; } }
  return [B0 / A0, B1 / A0, B2 / A0, A1 / A0, A2 / A0];
}
function filt(resp, hz, res, sr) {
  const om = Math.min(hz * TAU / sr, 3), s = Math.sin(om), c = Math.cos(om);
  if (resp === BP) { const al = s / (2 * res), den = 1 + al, b0 = 0.5 * s / den; return [b0, 0, -b0, -2 * c / den, (1 - al) / den]; }
  const hi = resp === HP, b0 = (1 + (hi ? c : -c)) / (s / res + 2);
  return [b0, hi ? -2 * b0 : 2 * b0, b0, -2 * res * c / (s + res), (res - s) / (s + res)];
}
const mag = (k, f, sr) => {   // |H(e^jw)|
  const w = TAU * f / sr, c1 = Math.cos(w), c2 = Math.cos(2 * w), s1 = Math.sin(w), s2 = Math.sin(2 * w);
  const nr = k[0] + k[1] * c1 + k[2] * c2, ni = -(k[1] * s1 + k[2] * s2), dr = 1 + k[3] * c1 + k[4] * c2, di = -(k[3] * s1 + k[4] * s2);
  return Math.sqrt((nr * nr + ni * ni) / Math.max(1e-30, dr * dr + di * di));
};
const db = (x) => 20 * Math.log10(Math.max(1e-9, x));
const fgrid = (g, w, hh) => { g.fillStyle = DISPC.grid; for (const f of [100, 1000, 10000]) g.fillRect(Math.round(lx(f, w)), 0, 1, hh); g.fillRect(0, Math.round(hh / 2), w, 1); };
const txt = (g, t, x, y, al = 'left') => { g.fillStyle = DISPC.ink; g.font = '600 9px system-ui,sans-serif'; g.textAlign = al; g.fillText(t, x, y); g.textAlign = 'left'; };
// a dB response over the log frequency axis, +-range dB
function response(g, w, hh, fn, range = 18, col = DISPC.bl) {
  fgrid(g, w, hh); const pts = [];
  for (let x = 0; x <= w; x += 2) { const d = clamp(fn(xl(x, w)), -range, range); pts.push([x, hh / 2 - d / range * (hh / 2 - 4)]); }
  lvPath(g, pts, col, hh / 2, 1.5);
}
// a curve of y(x) for x, y in -1..1 (transfer functions), or 0..1 over time (gain shapes)
function curve(g, w, hh, fn, o = {}) {
  g.fillStyle = DISPC.grid; g.fillRect(0, Math.round(hh / 2), w, 1); if (!o.time) g.fillRect(Math.round(w / 2), 0, 1, hh);
  const pts = [];
  for (let x = 0; x <= w; x += 1) { const u = o.time ? x / w : 2 * x / w - 1, y = fn(u); pts.push([x, o.time ? hh - 4 - clamp(y, 0, 1.05) * (hh - 8) : hh / 2 - clamp(y, -1.2, 1.2) * (hh / 2 - 4)]); }
  lvPath(g, pts, o.col || DISPC.or, o.time ? hh : null, 1.5);
}
// dynamics: output dB over input dB (-60..+6)
function dyn(g, w, hh, outDb) {
  g.fillStyle = DISPC.grid; for (let d = -48; d <= 0; d += 12) { const p = (d + 60) / 66; g.fillRect(Math.round(p * w), 0, 1, hh); g.fillRect(0, Math.round(hh - p * hh), w, 1); }
  const pts = []; for (let x = 0; x <= w; x += 2) { const i = -60 + 66 * x / w, o = clamp(outDb(i), -60, 6); pts.push([x, hh - (o + 60) / 66 * hh]); }
  lvPath(g, pts, DISPC.or, null, 1.5);
}
const amp = (d) => Math.pow(10, d / 20);
const PERIODS = [0.125, 0.25, 0.375, 0.5, 0.75, 1, 2, 4, 8, 16];
const pcurve = (P, i) => {   // waveshaper.rs point_curve
  if (i < P[0][0]) return P[0][1];
  for (let k = 1; k < P.length; k++) if (i < P[k][0]) { const t = (i - P[k - 1][0]) / (P[k][0] - P[k - 1][0]), c = P[k][2], s = c > 0 ? Math.pow(t, 1 - c) : 1 - Math.pow(1 - t, 1 + c); return P[k - 1][1] + s * (P[k][1] - P[k - 1][1]); }
  return P[P.length - 1][1];
};
const wsShape = (idx, x, y, i) => {   // waveshaper.rs shape (the menu's 7 shapes)
  switch (idx) {
    case 0: { let a = 2 * x - 1; if (Math.abs(a) < 1e-4) a = 1e-4; const k = 1 + 9 * y, gg = (u) => u / Math.sqrt(sq(u - a) + 1); return gg(k * i) / Math.abs(gg(Math.sign(a) * (1 + 1 / Math.abs(a)))); }
    case 1: { const a = 2 * x - 1, k = 1 + 9 * y; return (Math.tanh(a) + Math.tanh(k * i - a)) / (1 + Math.tanh(Math.abs(a))); }
    case 3: return Math.sin((1 + 7 * y) * i + 2 - 4 * x);
    case 4: { const a = 0.1 + 0.9 * x, p = 0.1 + 0.6 * y, q = (((i + 1) / (2 * p)) % 1 + 1) % 1; return q < a ? 2 * q / a - 1 : (2 - 2 * q) / (1 - a) - 1; }
    case 6: { const a = 0.6 + 0.4 * x, k = y > 0.5 ? 0.03 + 7.94 * (y - 0.5) : -0.03 - 7.94 * (0.5 - y); return i + Math.exp(-Math.exp(Math.pow(20, 1 - a)) * i * i) * Math.sin(TAU * k * i); }
    case 2: { const d = Math.min(x, 1 - x), e = Math.abs(2 * y - 1), m = Math.max(1 - 2 * y, 0), inn = 0.25 - 0.12 * x, out = 0.01 + 0.18 * d;
      return pcurve([[-1, -1 + 0.37 * m, 0], [-0.75, -0.75 + 0.25 * m, 0], [-inn, -0.1, 0], [-out, -(0.02 + 0.88 * e), 0.5], [0, 0, -0.3], [out, 0.02 + 0.88 * e, 0.3], [inn, 0.1, -0.3], [0.75, 0.75 - 0.25 * m, 0], [1, 1 - 0.37 * m, 0.16 * m]], i); }
    default: { const yf = clamp(4 * x - 1, -1, 1), x0 = clamp(-0.999 + 1.998 * (x - 0.5), -0.999, 0), c = 1.6 * (y - 0.5);
      return pcurve([[-1, yf, 0], [x0, yf, 0], [0, 0, c], [0.999, 1, -c], [1, 1, 0]], i); }
  }
};

// the magnitude responses the displays draw, in dB at f Hz for the module's params p(i) (tools/flmfx-test.mjs measures the engine against them)
const eqParam = (p) => (f, sr = SR) => { let d = 0; for (let b = 0; b < 4; b++) { const o = 1 + 4 * b, k = Math.trunc(p(o + 3) * 2); d += db(mag(param(k === 0 ? LS : k === 2 ? HS : PK, Math.pow(2, 5 + 9.25 * p(o + 1)), 0.25 + 7 * p(o + 2), -12 + 24 * p(o), sr * 2), f, sr)); } return d; };
const GHZ = [80, 160, 375, 750, 1500, 3000, 6000, 12000];
export const FLM_RESP = {
  3: (p, f, sr = SR) => eqParam(p)(f, sr),
  7: (p, f, sr = SR) => GHZ.reduce((d, hz, i) => d + db(mag(param(i === 0 ? LS : i === 7 ? HS : PK, hz, 1, -12 + 24 * p(i + 1), sr), f, sr)), 0),
  30: (p, f, sr = SR) => { const key = Math.trunc(p(9) * 11 + 0.001), q = 0.1 + 10 * Math.pow(p(10), 3); let d = 0; for (let i = 0; i < 8; i++) d += db(mag(param(i === 0 ? LS : i === 7 ? HS : PK, 110 * Math.pow(2, key / 12 - 0.75 + i), q, -12 + 24 * p(i + 1), sr), f, sr)); return d; },
  9: (p, f, sr = SR) => {
    const k = Math.trunc(p(3) * 2), resp = k === 0 ? LP : k === 2 ? HP : BP, pk = Math.trunc(p(4) * 2), passes = pk === 0 ? 1 : pk === 2 ? 4 : 2;
    const c = filt(resp, Math.pow(2, 4 + 10.3 * p(1)), 0.8 + 2 * sq(p(2)), sr), out = resp === LP ? Math.pow(0.8, passes) : 1;
    return db(Math.pow(mag(c, f, sr), passes * 2) * out);
  },
  // Comb Filter (Manual / Snap): out = in + Mix * line, line = in + Feedback * line delayed by 2 + (sr - 2) / f0 frames (comb.rs)
  40: (p, f, sr = SR) => {
    const snap = p(7) !== 0, f0b = snap ? (Math.round(7 * p(10)) * 12 + Math.round(11 * p(11)) < 1 ? 0 : 440 * Math.pow(2, (Math.round(7 * p(10)) * 12 + Math.round(11 * p(11))) / 12 - 5.75)) : 1 + 2499 * Math.pow(p(2), 4);
    const f0 = clamp(f0b * Math.pow(2, Math.round(4 * p(5) - 2)), 1, 20000) * (1 - (0.1 * p(9) - 0.05)), D = 2 + (sr - 2) / f0, w = TAU * f / sr * D, fb = p(3), mx = p(4);
    const zr = Math.cos(w), zi = -Math.sin(w), dr = 1 - fb * zr, di = -fb * zi, den = dr * dr + di * di;   // z^-D / (1 - fb z^-D)
    const hr = 1 + mx * (zr * dr + zi * di) / den, hi = mx * (zi * dr - zr * di) / den;
    return db(Math.sqrt(hr * hr + hi * hi));
  },
};
// id -> draw(g, w, hh, get) ; get(i) = the module's normalized param i
export const FLM_GRAPH = {
  3: (g, w, hh, p) => response(g, w, hh, (f) => FLM_RESP[3](p, f), 12),
  7: (g, w, hh, p) => response(g, w, hh, (f) => FLM_RESP[7](p, f), 12),
  30: (g, w, hh, p) => response(g, w, hh, (f) => FLM_RESP[30](p, f), 12),
  9: (g, w, hh, p) => response(g, w, hh, (f) => FLM_RESP[9](p, f), 30),
  8: (g, w, hh, p) => {   // Compressor: the static curve (detector gain, threshold, ratio, makeup)
    const thr = -40 + 40 * p(1), ratio = 1 + 19 * sq(p(2)), det = -20 + 40 * p(8), T = amp(thr);
    const inv = ratio >= 20 ? 0 : T >= 1 ? 1 / ratio : (amp(thr * (1 - 1 / ratio)) - T) / Math.max(1 - T, 1e-30);
    const auto = p(7) >= 0.5 ? 1 / (T + inv * (1 - T)) : 1, mk = amp(p(7) >= 0.5 ? -20 + 40 * p(5) : 40 * p(5)) * auto;
    dyn(g, w, hh, (i) => { const e = amp(i + det), red = e < T ? 1 : (T + inv * (e - T)) / e; return db(amp(i) * red * mk); });
  },
  28: (g, w, hh, p) => { const ig = -24 + 48 * p(1), og = -24 + 48 * p(2), th = -24 + 24 * p(4); dyn(g, w, hh, (i) => Math.min(i + ig, th) + og); },
  5: (g, w, hh, p) => { const th = db(Math.pow(10, 1.2 * p(1) - 1.2)), og = 36 * p(3) - 24; dyn(g, w, hh, (i) => Math.min(i, th) - th + og); },
  6: (g, w, hh, p) => {   // Distortion: the left channel's shaper, its Gain and Bias
    const left = Math.min(2 * p(4), 1), d = p(1), mode = Math.trunc(3 * p(5)), b0 = 2 * p(6) - 1, bias = b0 * b0 * b0 * b0 * b0, gain = Math.pow(10, 1.2 * p(3) - 1.2);
    const dr = mode === 0 ? Math.pow(10, 5 * d * left) - 1 : mode === 1 ? Math.pow(10, 4 * d * left) - 0.99 : mode === 2 ? 20 * d * d * left : Math.pow(10, 3 * d * d * left);
    const sh = (x) => { const s = x + bias; if (mode === 0) return (dr + 1) * s / (1 + dr * Math.abs(s)); if (mode === 1) return Math.tanh(dr * s) / Math.tanh(dr); if (mode === 2) return s >= 0 ? 1 + (s - 1) * Math.pow(10, -dr * s) : -1 + (s + 1) * Math.pow(10, dr * s); return clamp(dr * s, -1, 1); };
    curve(g, w, hh, (x) => sh(x) * gain);
  },
  41: (g, w, hh, p) => { const idx = Math.min(Math.round(p(1) * 6), 6), drive = Math.pow(10, 2 * p(5)); curve(g, w, hh, (x) => wsShape(idx, p(3), p(4), drive * x)); },
  46: (g, w, hh, p) => {   // Tremolo: the gain over one LFO cycle, between Min and Max
    const mx = p(3), mn = p(4), skew = 0.001 + 0.998 * p(10), width = 0.999 - 1.998 * p(11), shape = 2 * p(8) - 1, smooth = 0.001 + 0.998 * p(9), off = p(5);
    const wave = (ph) => { const x = (ph + off) % 1, tri = Math.min(x / skew, (1 - x) / (1 - skew)), un = clamp((2 * tri - 1 - width) / (1 - Math.abs(width)), -1, 1), an = Math.sign(un) * Math.PI / 2 * Math.pow(Math.abs(un), Math.pow(2, shape * 4)), lin = an * 2 / Math.PI; return lin + (Math.sin(an) - lin) * smooth; };
    curve(g, w, hh, (t) => clamp(mn + (mx - mn) * 0.495 * (wave(t) + 1), mn, mx), { time: true, col: DISPC.bl });
  },
  29: (g, w, hh, p) => {   // Autoduck: the gain over one beat
    const atk = p(2) * 0.5 + 0.001, time = Math.max(p(4), 0.001), he = p(6) * time + atk, shape = Math.trunc(p(7) * 5), c = p(3);
    const cv = (t) => { const ph = ((t + 0.5 - p(5)) % 1 + 1) % 1; let v = ph < atk ? ph / atk : ph >= time ? 0 : ph < he ? 1 : 1 + (he - ph) / (time - he); v = clamp(v, 0, 1); if (v === 0) return 0;
      if (ph < atk || shape === 0) return Math.pow(v, c * 0.5 + 0.5); if (shape === 1) return Math.pow(v, 0.1 + 0.9 * c); if (shape === 2) return Math.pow(v, 3 - 2 * c); if (shape === 3) return Math.pow(v, 6 - 5 * c);
      const e = (1 - c) * (shape === 4 ? 2 : 5) + 1, dd = Math.min(v, 1 - v), half = 0.5 * Math.pow(2, e) * Math.pow(dd, e); return v < 0.5 ? half : 1 - half; };
    curve(g, w, hh, (t) => 1 - cv(t) * Math.sqrt(p(1)), { time: true, col: DISPC.bl });
  },
  10: (g, w, hh, p) => { const atk = p(2) * 0.5 + 0.001; curve(g, w, hh, (t) => { const v = t < atk ? t / atk : 1 + (atk - t) / (1 - atk); return 1 - Math.pow(clamp(v, 0, 1), p(3) * 0.5 + 0.5) * sq(p(1)); }, { time: true, col: DISPC.bl }); },
  18: (g, w, hh, p) => { const sec = sq(p(1)), fb = p(2), wet = p(4) * p(2); echoes(g, w, hh, sec * 1000, fb, wet, 'ms'); },
  16: (g, w, hh, p) => { const beats = [0.25, 0.375, 0.5, 0.75, 1][Math.min(Math.trunc(p(1) * 4), 4)]; echoes(g, w, hh, beats, p(2) * 0.99, sq(p(3)), 'beat'); },
  32: (g, w, hh, p) => decay(g, w, hh, 0.15 + 9.85 * sq(p(1)), p(6) * 0.25, p(3) * p(14)),
  12: (g, w, hh, p) => decay(g, w, hh, 0.15 + 9.85 * sq(p(1)), p(4) * 0.25, p(3)),
  35: (g, w, hh, p) => decay(g, w, hh, 0.1 + 19.9 * p(4), p(12) > 0.5 ? null : p(11), 1.25 * p(9)),
  36: (g, w, hh, p) => {   // Multiband: the three bands' gains between the crossovers
    const lo = 20 * Math.pow(2, 9 * p(2)), hi = 20 * Math.pow(2, 9 * p(3)), gain = (b) => { const st = Math.trunc(2 * p(6 + b * 7 + 6)); return st === 2 ? -24 : st === 1 ? 0 : -24 + 48 * p(6 + b * 7 + 5); };
    response(g, w, hh, (f) => (f < lo ? gain(0) : f < hi ? gain(1) : gain(2)) + (-24 + 48 * p(1)), 24, DISPC.or);
    g.fillStyle = DISPC.bl; g.fillRect(Math.round(lx(lo, w)), 0, 1, hh); g.fillRect(Math.round(lx(hi, w)), 0, 1, hh);
  },
  40: (g, w, hh, p) => { if (Math.trunc(2 * p(1)) !== 0) { fgrid(g, w, hh); txt(g, Math.trunc(2 * p(1)) === 1 ? 'MIDI Note' : 'Audio Pitch', w / 2, hh / 2 - 6, 'center'); return; } response(g, w, hh, (f) => FLM_RESP[40](p, f), 24); },
  11: (g, w, hh, p) => {   // Chorus: the two taps' delay over two seconds (left / right LFO)
    const rate = 0.2 + 4 * sq(p(1)), depth = 0.04 + 0.36 * p(2);
    curve(g, w, hh, (t) => 0.5 + Math.sin(TAU * (0.62 + rate * 2 * t)) * depth, { time: true, col: DISPC.bl });
    curve(g, w, hh, (t) => 0.5 + (Math.sin(TAU * (0.1 + (rate + 0.1) * 2 * t)) * depth), { time: true, col: DISPC.or });
  },
  13: (g, w, hh, p) => {   // Flanger: the delay over one LFO cycle, base +- depth
    const shape = Math.min(Math.round(p(4) * 2), 2), base = 0.5 * sq(p(6)), depth = 0.5 * base * p(5);
    curve(g, w, hh, (t) => clamp(base + depth * lfo(shape, t), 0, 1) * 2, { time: true, col: DISPC.bl });
  },
  14: (g, w, hh, p) => {   // Phaser: the allpass frequency over one LFO cycle (log axis 50 Hz .. 16 kHz)
    const shape = Math.min(Math.round(p(8) * 2), 2), depth = 0.25 * Math.pow(p(2), 3), center = sq(p(4)), lo = 50 / SR, hi = Math.min(16000 / SR, 0.499);
    curve(g, w, hh, (t) => { const fr = clamp(lo + (center + depth * lfo(shape, t)) * (hi - lo), lo, hi) * SR; return Math.log(fr / 50) / Math.log(16000 / 50); }, { time: true, col: DISPC.bl });
  },
  15: (g, w, hh, p) => {   // Stereoizer: the side component's tone (Focus one-pole low / high pass) at its Strength
    const st = sq(p(1)), focus = 1 - 2 * p(3), hp = focus < 0, k = hp ? Math.pow(-0.99 * focus, 3) : Math.pow(1 - 0.8 * focus, 3);
    response(g, w, hh, (f) => { const z = TAU * f / SR, re = 1 - (1 - k) * Math.cos(z), im = (1 - k) * Math.sin(z), lp = k / Math.sqrt(re * re + im * im); return db(st * (hp ? Math.abs(1 - lp) : lp)); }, 30);
  },
  34: (g, w, hh, p) => {   // Spacer: L/R and M/S shifts as bars around the centre, Pan and Separation
    g.fillStyle = DISPC.grid; g.fillRect(Math.round(w / 2), 0, 1, hh);
    const bar = (y, v, col, lab) => { const x0 = w / 2, x1 = w / 2 + (v - 0.5) * (w - 12); g.fillStyle = col; g.fillRect(Math.min(x0, x1), y, Math.max(2, Math.abs(x1 - x0)), 10); txt(g, lab, 4, y + 9); };
    bar(10, p(1), DISPC.bl, 'L/R'); bar(30, p(5), DISPC.or, 'M/S'); bar(50, p(2), DISPC.ink, 'Pan'); bar(70, p(3), DISPC.bl, 'Sep');
  },
  27: (g, w, hh, p) => {   // Gate: output over input with the threshold, its asymmetry (close point) and the floor
    const th = -60 + 66 * p(1), as = 66 * sq(p(2)), floorDb = db(Math.pow(10, -3 * Math.abs(2 * p(7) - 1))), inv = 2 * p(7) - 1 < 0;
    dyn(g, w, hh, (i) => (inv ? (i > th ? i + floorDb : i) : (i > th ? i : i + floorDb)));
    g.fillStyle = DISPC.bl; const x = (d) => Math.round((d + 60) / 66 * w); g.fillRect(x(th), 0, 1, hh); g.fillStyle = DISPC.grid2; g.fillRect(x(th - as), 0, 1, hh);
  },
  43: (g, w, hh, p) => {   // Wow & Flutter: the delay over one second (wow + flutter), free rates
    const wr = 0.1 + 4.9 * p(1), wd = Math.expm1(5 * p(3)) * 0.006783655, fr = 5 + 15 * p(4), fd = p(6), wm = 0.142, fm = 0.003;
    curve(g, w, hh, (t) => (clamp(0.5 * wm * (1 + Math.sin(TAU * wr * t)) * wd, 0, wm) + clamp(0.5 * fm * (1 + Math.sin(TAU * fr * t)) * fd, 0, fm)) / (wm + fm), { time: true, col: DISPC.bl });
  },
  25: (g, w, hh, p) => keys(g, w, hh, (k) => p(FLMFX_N25 + 3 + k) >= 0.5,   // the note enables follow Post Gain / Mix / Wet Pan
    (k) => p(10 + k) > 0.5, `${Math.trunc(24 * p(2) - 12)} st`),
  45: (g, w, hh, p) => keys(g, w, hh, (k) => p(1 + k) > 0.5, () => false, `Mix ${Math.round(p(22) * 100)} %`),
  44: (g, w, hh, p) => {   // Spreader: Low Bypass on the frequency axis, Width / Separation
    fgrid(g, w, hh); const lb = 10 * Math.pow(1000, p(2)); g.fillStyle = 'rgba(98,207,250,.25)'; g.fillRect(0, 0, Math.round(lx(Math.max(20, lb), w)), hh);
    g.fillStyle = DISPC.or; const wd = clamp(2 * p(1), 0, 2) / 2 * (hh - 16); g.fillRect(Math.round(lx(Math.max(20, lb), w)), hh / 2 - wd / 2, w, Math.max(2, wd)); txt(g, 'Width', w - 4, 11, 'right');
  },
  4: (g, w, hh, p) => {   // Multi FX: the selected processor and the X / Y position
    const K = ['Delay', 'Reverb', 'LP Filter', 'HP Filter', 'Flanger', 'Phaser', 'Panner', 'Vox'][Math.min(Math.trunc(clamp(p(1), 0, 1) * 7), 7)];
    g.fillStyle = DISPC.grid; g.fillRect(Math.round(w / 2), 0, 1, hh); g.fillRect(0, Math.round(hh / 2), w, 1);
    const x = 6 + p(2) * (w - 12), y = hh - 6 - p(3) * (hh - 12); g.fillStyle = DISPC.or; g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill(); txt(g, K, 4, 11);
  },
  42: (g, w, hh, p) => {   // Tape Stop: the speed over the ramp (Warp bends it)
    const warp = 2 * p(6) - 1, c = Math.abs(warp) < 0.005 ? 0.005 : 1 - Math.pow(0.005, -warp);
    curve(g, w, hh, (t) => clamp((Math.pow(1 - c, -(1 - t)) - 1) * (1 / c - 1), 0, 1), { time: true, col: DISPC.bl }); txt(g, p(5) > 0.5 ? 'Play' : 'Stop', w - 4, 11, 'right');
  },
};
const lfo = (shape, t) => (shape === 1 ? 2 * t - 1 : shape === 2 ? (t <= 0.5 ? -1 : 1) : Math.sin(TAU * t));
const FLMFX_N25 = 23;
// a 12-key octave: on(k) lit, byp(k) marked, a caption
function keys(g, w, hh, on, byp, cap) {
  const white = [0, 2, 4, 5, 7, 9, 11], black = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }, kw = (w - 8) / 7, top = 16, h2 = hh - top - 4;
  white.forEach((k, j) => { g.fillStyle = on(k) ? DISPC.bl : '#cfcfd4'; g.fillRect(4 + j * kw + 1, top, kw - 2, h2); if (byp(k)) { g.fillStyle = DISPC.or; g.fillRect(4 + j * kw + 1, top + h2 - 4, kw - 2, 4); } });
  for (const [k, j] of Object.entries(black)) { g.fillStyle = on(+k) ? '#3c7e8d' : '#1e1e20'; g.fillRect(4 + (j + 1) * kw - kw * 0.3, top, kw * 0.6, h2 * 0.6); if (byp(+k)) { g.fillStyle = DISPC.or; g.fillRect(4 + (j + 1) * kw - kw * 0.3, top + h2 * 0.6 - 3, kw * 0.6, 3); } }
  txt(g, cap, 4, 11);
}
function echoes(g, w, hh, step, fb, wet, unit) {
  g.fillStyle = DISPC.grid; g.fillRect(0, hh - 4, w, 1);
  const n = 12, span = step * n; g.fillStyle = DISPC.bl; let a = wet;
  for (let k = 1; k <= n && a > 0.002; k++, a *= fb) { const x = Math.round(k * step / span * (w - 8)) + 4, hgt = Math.max(1, clamp(a, 0, 1) * (hh - 16)); g.fillRect(x - 1, hh - 4 - hgt, 3, hgt); }
  txt(g, unit === 'ms' ? `${Math.round(step)} ms` : `${step} beat`, 4, 11);
}
function decay(g, w, hh, sec, pre, level) {
  const span = Math.max(1, sec * 1.2), pts = [];
  for (let x = 0; x <= w; x += 2) { const t = x / w * span, d = pre != null ? Math.max(0, t - pre) : t, a = (pre != null && t < pre) ? 0 : Math.pow(10, -3 * d / sec) * clamp(level, 0, 1.25); pts.push([x, hh - 4 - clamp(a, 0, 1.25) / 1.25 * (hh - 16)]); }
  g.fillStyle = DISPC.grid; g.fillRect(0, hh - 4, w, 1); lvPath(g, pts, DISPC.bl, hh - 4, 1.5); txt(g, `${sec.toFixed(1)} s`, w - 4, 11, 'right');
}
