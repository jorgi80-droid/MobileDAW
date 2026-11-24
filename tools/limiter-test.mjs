// The master safety limiter (native/engine/fx.cpp Limiter, = js/engine/fx.js) on bass driven over its ceiling, on the C++ engine as
// WebAssembly: the ceiling holds (-0.3 dB) and a low tone is not distorted (the minimum holds 12 ms after a peak, so the gain does not
// ripple between the half-cycle peaks of a 45 Hz wave: THD was 1.25 %). Usage: node tools/limiter-test.mjs   (part of tools/run-tests.mjs)
import { loadWasmEngine } from './wasm-engine.mjs';
const SR = 48000, N = SR * 3;
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const gz = (x, a, b, f) => { const w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w); let s1 = 0, s2 = 0; for (let i = a; i < b; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; } return 2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / (b - a); };
for (const [f, amp] of [[45, 1.6], [60, 2.0], [100, 1.4]]) {
  const w = await loadWasmEngine(SR); w.setBlob(Float32Array.from({ length: N }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / SR)));
  const er = w.cmd(`masterLimit 1\ntempo 120\ntrackVol 0 1\nsample 0 @0:${N}\ntrackClips 0 [7 0 ${960 * 6} 0 1 0 0 0] 1\nsettle\nplay\n`); if (er) console.log('engine:', er.trim());
  const L = new Float32Array(N), R = new Float32Array(N); w.render(L, R, N);
  const a = SR, b = SR + Math.round(SR / f) * f, h1 = gz(L, a, b, f); let hs = 0; for (let k = 2; k <= 12; k++) hs += gz(L, a, b, f * k) ** 2;
  let pk = 0; for (let i = a; i < b; i++) pk = Math.max(pk, Math.abs(L[i]));
  const thd = 100 * Math.sqrt(hs) / h1, pdb = 20 * Math.log10(pk);
  ok(thd < 0.3 && pdb <= -0.29, `${f} Hz ${(20 * Math.log10(amp)).toFixed(1)} dB over full scale: THD ${thd.toFixed(2)} % (< 0.3), peak ${pdb.toFixed(2)} dB (ceiling -0.3)`);
}
console.log(bad ? `\n${bad} FAILED` : '\nlimiter-test: all passed'); process.exit(bad ? 1 : 0);
