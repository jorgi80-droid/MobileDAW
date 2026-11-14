// Value texts of the FL Studio Mobile effect modules (defs.js FLMFX devices): the text each control shows for its normalized value, as
// FL Studio Mobile prints it. Port of Honeydew src/params/display.rs (Display::text_at, Fmt::apply) and the module formatters of
// src/params/effects.rs / effects_24_51.rs (https://github.com/daijro/honeydew, GPL-3.0-or-later, see THIRD_PARTY_NOTICES.md).
// The laws themselves (js/flmfx.js `law`) are exported from Honeydew's tables. f32 arithmetic as the Rust original (Math.fround);
// fixed decimals round exact binary ties to even, like Rust's `{:.N}`. Checked string for string against the Rust code (tools/flmfx-test.mjs).
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
const f = Math.fround;
const fma = (a, b, c) => f(f(a) * f(b) + f(c));                 // f32 mul_add (the product is exact in double)
const powi = (x, n) => { let r = f(1); for (let k = 0; k < n; k++) r = f(r * x); return r; };
const clamp01 = (v) => (Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v)));

// x with d fraction digits, ties to even on the exact binary value (Rust `format!("{:.d}", x)`), no sign handling
function fixedAbs(x, d) {
  x = Math.abs(x);
  if (!Number.isFinite(x)) return x === Infinity ? 'inf' : 'NaN';
  const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, x);
  const hi = dv.getUint32(0), lo = dv.getUint32(4), ex = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo), e;
  if (ex === 0) e = -1074; else { m |= 1n << 52n; e = ex - 1075; }
  const p10 = 10n ** BigInt(d);
  let n;
  if (e >= 0) n = (m << BigInt(e)) * p10;
  else {
    const num = m * p10, den = 1n << BigInt(-e), q = num / den, r = num - q * den;
    n = 2n * r > den ? q + 1n : 2n * r < den ? q : q + (q & 1n);
  }
  let s = n.toString();
  if (d === 0) return s;
  s = s.padStart(d + 1, '0');
  return s.slice(0, s.length - d) + '.' + s.slice(s.length - d);
}
const printsZero = (digits) => !/[1-9]/.test(digits);
// Fmt::apply: decimals, unit, sign rule (Minus / Positive / Always)
function fmtApply(F, x) {
  const digits = fixedAbs(x, F.d), zero = printsZero(digits);
  const sign = x < 0 && !zero ? '-' : F.s === 'Always' ? '+' : F.s === 'Positive' && !zero ? '+' : '';
  return sign + digits + F.u;
}
// Rust `{}` of an f32 that holds a whole number (the formatters below only print those)
const intText = (x) => (Object.is(x, -0) ? '-0' : String(x));
const linear = (min, max, v) => fma(f(max - min), v, f(min));
const expo = (min, max, v) => f(f(min) * f(Math.pow(f(max / min), v)));
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const rnd = (x) => Math.sign(x) * Math.round(Math.abs(x));   // Rust round(): halves away from zero
const step = (n, lo, v) => { const x = rnd(f(f(n * v) + lo)); return (x >= 0 ? '+' : '') + x; };
const ECHO = [[0.125, '1/8'], [0.25, '1/4'], [0.375, '3/8'], [0.5, '1/2'], [0.75, '3/4'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [8, '8']];
const ARP_PATTERNS = ['x.', 'x.x', 'x..x', 'x.xx', 'x.x.x', 'x..x.x', 'x..xx.', 'x.x.xx', 'x..x.x.', 'x..x.xx', 'x..xx.x', 'x.x.x.x', 'x.xx.xx', 'x...x.xx', 'x...xx.x', 'x..x..x.', 'x..x.xx.', 'x..x.xxx', 'x..xx.x.', 'x.x.x.xx', 'x.x.xx.x'];
const arpRotate = (v, c, ri) => {
  const rv = c.p && c.p[ri] != null ? c.p[ri] : 0, k = Math.round(f(f(Math.min(1, Math.max(0, rv))) * 21)) - 1;
  if (k < 0) return '0';
  const n = ARP_PATTERNS[k].length; return String(rnd(f(f(f(2 * v) - 1) * (n - 1))) + 0);
};
// the module formatters (Display::Custom / CustomCx), by FLM module id . param index; ctx = { p: the module's params, bpm, sr }
const CUSTOM = {
  '6.4': (v) => String(Math.trunc(fma(200, v, -100))),                                          // Distortion Stereo (AMOUNT_TRUNC)
  '29.2': (v, c) => { const beats = fma(0.5, v, 0.001), ms = Math.round(beats * 60000 / (c.bpm || 0)); return (Number.isFinite(ms) ? fixedAbs(ms, 0) : 'inf') + ' ms'; },   // Autoduck Attack
  '29.6': (v, c) => { const t = f(c.p && c.p[4] != null ? c.p[4] : 0.501); return intText(Math.round(f(f(f(100 * v) * Math.max(t, f(0.001)))))) + ' %'; },   // Autoduck Hold
  '34.1': (v) => {                                                                              // Spacer L/R Delay
    const t = f(300 * powi(Math.abs(f(f(2 * v) - 1)), 3));
    if (t < 0.01) return 'off';
    return fixedAbs(t, t < 1 ? 2 : t < 10 ? 1 : 0) + ' ms';
  },
  '34.5': (v, c) => {                                                                           // Spacer M/S Delay
    const d = powi(Math.abs(f(f(2 * v) - 1)), 5), t = f(100 * d), us = f(100000 * d), sr = c.sr || 0;
    if (t < f(500 / sr)) return 'off';
    if (t < 0.01) return fixedAbs(us, 2) + ' us'; if (t < 0.1) return fixedAbs(us, 1) + ' us'; if (t < 1) return fixedAbs(us, 0) + ' us';
    return t < 10 ? fixedAbs(t, 1) + ' ms' : fixedAbs(t, 0) + ' ms';
  },
  '35.4': (v) => fixedAbs(f(Math.floor(fma(199, v, 1.5)) / 10), 1) + 's',                       // Reverb 2 Decay
  '35.17': (v) => intText(Math.floor(fma(1975, v, 25.5))) + 'Hz',                               // Reverb 2 Cross
  '40.9': (v) => fmtApply({ d: 1, u: ' %', s: 'Minus' }, -5 + 10 * v),                         // Comb Filter Asym (f64)
  '40.10': (v) => String(rnd(fma(7, v, -1)) + 0),                                           // Comb Filter Pitch Oct
  '44.2': (v) => { const hz = f(10 * f(Math.pow(1000, v))); return hz < 1000 ? fixedAbs(hz, 0) + ' Hz' : Math.abs(hz - 10000) < 0.1 ? '10 kHz' : fixedAbs(f(hz / 1000), 1) + ' kHz'; },   // Spreader Low Bypass
  // note effects (Honeydew effects_24_51.rs): signed whole steps round(f32(f32(n·v) + lo)) with a sign on 0 and up ("+0", "-24")
  '47.5': (v) => step(48, -24, v), '47.8': (v) => step(24, -12, v), '48.1': (v) => step(8, -4, v), '48.2': (v) => step(24, -12, v),
  '47.3': (v) => { const b = fma(8 - 1 / 32, f(v * v), 1 / 32); let k = 0; for (let i = 1; i < ECHO.length; i++) if (Math.abs(f(b - ECHO[i][0])) < Math.abs(f(b - ECHO[k][0]))) k = i; return ECHO[k][1]; },   // Note Echo Delay (sync): the nearest item
  '51.15': (v, c) => arpRotate(v, c, 14), '51.26': (v, c) => arpRotate(v, c, 25),   // Arpeggiator Rotate: -(n-1) .. +(n-1), n = the steps of its Rhythm
  '44.4': (v) => { const s = fma(200, v, -100), a = Math.abs(s); return a < 0.1 ? 'Original' : (s < 0 ? '-' : '') + fixedAbs(s, a < 10 ? 1 : 0) + ' %'; },   // Spreader Separation
};

// the text of a continuous law for normalized v; key = 'id.index' for the module formatters
export function lawText(L, v, ctx = {}, key = '') {
  v = f(clamp01(v));
  switch (L.t) {
    case 'generic': return String(Math.trunc(f(v * 100)));
    case 'gunit': return Math.round(f(v * 100)) + L.u;
    case 'lin': return fmtApply(L.f, linear(L.min, L.max, v));
    case 'pow': return fmtApply(L.f, linear(L.min, L.max, powi(v, L.e)));
    case 'exp': return fmtApply(L.f, expo(L.min, L.max, v));
    case 'freq': {
      const hz = expo(L.min, L.max, v);
      return +fixedAbs(hz, L.hd) >= 1000 ? fmtApply({ d: L.kd, u: ' kHz', s: 'Minus' }, hz / 1000) : fmtApply({ d: L.hd, u: ' Hz', s: 'Minus' }, hz);
    }
    case 'steps': return fmtApply(L.f, L.min + Math.round(f(v * (L.n - 1))));
    case 'pan': {
      const pc = linear(-100, 100, v), digits = fixedAbs(pc, L.d);
      return printsZero(digits) ? L.c : digits + L.u + ' ' + L.sides[pc > 0 ? 1 : 0];
    }
    case 'gaincurve': {
      const db = Math.trunc((72 * Math.pow(v, 0.6) - 60) * 10) / 10;
      return db === 0 ? '0 dB' : (db > 0 ? '+' : '-') + fixedAbs(db, 1) + ' dB';
    }
    case 'const': return L.x;
    case 'bip': return fmtApply(L.f, v < 0.5 ? f(-f(L.neg) * f(1 - f(2 * v))) : f(f(L.pos) * f(f(2 * v) - 1)));
    case 'mirror': return fmtApply(L.f, f(f(L.max) * powi(Math.abs(f(f(2 * v) - 1)), L.e)));
    case 'hzsig': {
      const hz = linear(L.min, L.max, powi(v, L.e)), big = hz >= 1000, x = big ? f(hz / 1000) : hz;
      const w = Math.max(Math.trunc(f(Math.log10(x))), 1);
      const digits = fixedAbs(x, Math.max(2 - w, 0)).replace(/[0.]+$/, '');
      return (digits || '0') + (big ? ' KHz' : ' Hz');
    }
    case 'millis': {
      const ms = Math.round(f(v * f(L.full)));
      return ms === 0 ? L.z : ms >= 1000 ? fixedAbs(ms / 1000, 2) + ' s' : fixedAbs(ms, 0) + ' ms';
    }
    case 'table': {
      const P = L.p; let i = 0; while (i < P.length && P[i][0] <= v) i++; i = Math.min(Math.max(i, 1), P.length - 1);
      const [v0, x0] = P[i - 1], [v1, x1] = P[i]; return fmtApply(L.f, x0 + (x1 - x0) * (v - v0) / (v1 - v0));
    }
    case 'note': { const s = Math.round(f(v * (L.n - 1))); return NOTES[s % 12] + Math.floor(s / 12); }
    case 'special': {
      const hit = L.at === 'Min' ? v <= 0 : L.at === 'Max' ? v >= 1 : Math.abs(v - 0.5) < 1e-4;
      return hit ? L.x : lawText(L.in, v, ctx, key);
    }
    case 'trunc64': return String(Math.trunc(L.min + (L.max - L.min) * v)) + L.u;
    case 'custom': return CUSTOM[key] ? CUSTOM[key](v, ctx) : String(Math.round(v * 100));
  }
  return String(Math.round(v * 100));
}
// a menu's item at normalized v: its index law as breakpoints [v, item] (exported from Honeydew's index functions)
export function menuItem(br, v) { v = f(clamp01(v)); let it = 0; for (const [b, k] of br) if (v >= b) it = k; return it; }
// the context a control's text reads: the song tempo (Autoduck Attack), the audio rate (Spacer M/S Delay; FLM's 44.1 kHz until set) and,
// through p.lawCtx (fxkit.js flmPanel), the module's other params (Autoduck Hold reads Time)
let tempo = () => 120;
export const LAW_ENV = { sr: 44100 };
export function setLawTempo(fn) { tempo = fn; }
export function flmText(p, v) {
  const c = { bpm: tempo(), sr: LAW_ENV.sr, ...(p.lawCtx ? p.lawCtx() : {}) };
  return lawText(p.law, v, c, p.lawKey);
}
