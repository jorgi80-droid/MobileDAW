// v68 DSP quality test: oversampler round trip, Saturator alias floor (old base-rate shaper vs new 2x), Limiter ceiling/transparency/distortion.
// Usage: node tools/dsp-quality-test.mjs
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = await import(path.join(root, 'js/engine/dsp.js')), F = await import(path.join(root, 'js/engine/fx.js'));
const SR = 48000, N = 16384; let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const db = (x) => 10 * Math.log10(Math.max(x, 1e-30));
function spectrum(x) { const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); D.fft(re, im, N); const p = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k]; return p; }
// power at harmonic bins of f0 (incl. folded) vs everything else
function aliasRatio(x, f0) {
  const p = spectrum(x), bin = f0 * N / SR, good = new Uint8Array(N / 2);
  for (let h = 1; h < 60; h++) { let f = (h * f0) % SR; if (f > SR / 2) f = SR - f; const k = Math.round(f * N / SR); if (h * f0 < SR / 2) for (let j = -4; j <= 4; j++) if (k + j >= 0 && k + j < N / 2) good[k + j] = 1; }
  let fund = 0, alias = 0; const kb = Math.round(bin);
  for (let k = 1; k < N / 2; k++) { if (Math.abs(k - kb) <= 4) fund += p[k]; else if (!good[k] && k * SR / N < 20000) alias += p[k]; }
  return db(alias / fund);
}
const sine = (f, a, len = N + 2048) => Float64Array.from({ length: len }, (_, i) => a * Math.sin(2 * Math.PI * f * i / SR));
// 1. oversampler round trip: unity gain in the audio band, latency exactly OS2_LATENCY
{ const os = new D.Os2(), x = sine(1000, 0.5), y = new Float64Array(x.length); for (let i = 0; i < x.length; i++) { const u = os.up(x[i]); y[i] = os.down(u[0], u[1]); }
  let e = 0; for (let i = 2000; i < x.length; i++) e = Math.max(e, Math.abs(y[i] - x[i - D.OS2_LATENCY])); ok(e < 2e-3, `oversampler round trip 1 kHz: delay ${D.OS2_LATENCY}, max error ${e.toExponential(1)}`);
  for (const f of [10000, 16000, 18000]) { const os2 = new D.Os2(), s = sine(f, 0.5); let e2 = 0, n2 = 0; for (let i = 0; i < s.length; i++) { const u = os2.up(s[i]); const v = os2.down(u[0], u[1]); if (i > 2000) { e2 += v * v; n2++; } } const g = 10 * Math.log10(e2 / n2 / 0.125); ok(Math.abs(g) < 0.5, `pass band ${f / 1000} kHz (RMS): ${g.toFixed(2)} dB`); } }
// 2. Saturator: alias floor, old (base rate) vs new (2x)
{ const f0 = 5003, drive = Math.pow(10, 24 / 20), x = sine(f0, 0.7);
  const old = Float64Array.from(x, (v) => D.fastTanh(v * drive) / D.fastTanh(drive));
  const sat = F.makeDevice(3, SR); sat.setParam(0, 24); const L = Float64Array.from(x), R = Float64Array.from(x); for (let o = 0; o < L.length; o += 128) sat.process(L.subarray(o, o + 128), R.subarray(o, o + 128), Math.min(128, L.length - o));
  const a0 = aliasRatio(old.subarray(2048, 2048 + N), f0), a1 = aliasRatio(L.subarray(2048, 2048 + N), f0);
  console.log(`     Saturator 24 dB drive, 5 kHz: alias floor old ${a0.toFixed(1)} dB -> new ${a1.toFixed(1)} dB`);
  ok(a1 < a0 - 15, 'Saturator: alias tones at least 15 dB lower');
  const s2 = F.makeDevice(3, SR); s2.setParam(0, 0); s2.setParam(1, 0); const q = sine(440, 0.3), Lq = Float64Array.from(q), Rq = Float64Array.from(q); s2.process(Lq, Rq, Lq.length);
  let e = 0; for (let i = 200; i < q.length; i++) e = Math.max(e, Math.abs(Lq[i] - q[i - D.OS4_LATENCY])); ok(e < 1e-12, 'Saturator Mix 0%: dry passes untouched (delay-aligned)'); }
// 3. Limiter: ceiling holds, below-ceiling is transparent, less distortion than the old instant-attack clamp
{ const lim = F.makeDevice(5, SR); lim.setParam(0, -0.3); const ceil = Math.pow(10, -0.3 / 20);
  const x = Float64Array.from({ length: N + 4096 }, (_, i) => 2.0 * Math.sin(2 * Math.PI * 440 * i / SR) * (i % 9600 < 400 ? 1 : 0.4)), L = Float64Array.from(x), R = Float64Array.from(x);
  for (let o = 0; o < L.length; o += 128) lim.process(L.subarray(o, o + 128), R.subarray(o, o + 128), Math.min(128, L.length - o));
  let mx = 0; for (const v of L) mx = Math.max(mx, Math.abs(v)); ok(mx <= ceil + 1e-9, `Limiter: peak ${(20 * Math.log10(mx)).toFixed(2)} dBFS <= ceiling -0.30`);
  const lt = lim.latency | 0, q = sine(440, 0.5), Lq = Float64Array.from(q), Rq = Float64Array.from(q), l2 = F.makeDevice(5, SR); l2.process(Lq, Rq, Lq.length);
  let e = 0; for (let i = lt + 10; i < q.length; i++) e = Math.max(e, Math.abs(Lq[i] - q[i - lt])); ok(e < 1e-12, `Limiter below ceiling: transparent (latency ${lt} samples)`);
  // splatter: a 100 Hz tone whose level jumps 0.5 <-> 2.0 (5 ms raised-cosine ramps). Instant gain jumps of a zero-latency clamp spray energy above 4 kHz.
  const len = N + 4096, env = (i) => { const ph = i % 4800, up = ph < 2400, k = ph % 2400, r = Math.min(1, k / 240), w = 0.5 - 0.5 * Math.cos(Math.PI * r); return up ? 0.5 + 1.5 * w : 2.0 - 1.5 * w; };
  const hot = Float64Array.from({ length: len }, (_, i) => env(i) * Math.sin(2 * Math.PI * 100 * i / SR)), oldOut = new Float64Array(len);
  { let g = 1; const rc = 1 - Math.exp(-1 / (80 * 0.001 * SR)); for (let i = 0; i < len; i++) { const pk = Math.abs(hot[i]), need = pk > ceil ? ceil / pk : 1; g = need < g ? need : g + (1 - g) * rc; let o = hot[i] * g; o = Math.max(-ceil, Math.min(ceil, o)); oldOut[i] = o; } }
  const l3 = F.makeDevice(5, SR), Lh = Float64Array.from(hot), Rh = Float64Array.from(hot); for (let o = 0; o < len; o += 128) l3.process(Lh.subarray(o, o + 128), Rh.subarray(o, o + 128), Math.min(128, len - o));
  const hf = (y) => { const p = spectrum(y.subarray(len - N)), k0 = Math.round(4000 * N / SR); let a = 0, t = 0; for (let k = 1; k < N / 2; k++) { t += p[k]; if (k >= k0) a += p[k]; } return db(a / t); };
  const t0 = hf(oldOut), t1 = hf(Lh); console.log(`     Limiter on level jumps (+6 dB over ceiling): energy above 4 kHz old ${t0.toFixed(1)} dB -> new ${t1.toFixed(1)} dB`);
  ok(t1 < t0 - 6, 'Limiter: at least 6 dB less distortion'); }
console.log(bad ? 'FAILED ' + bad : 'ALL OK'); process.exit(bad ? 1 : 0);
