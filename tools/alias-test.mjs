// Oscillator aliasing of the synths that use the shared band-limited step (dsp.js polyBlep): energy that is not on a harmonic of the note,
// relative to the harmonics, up to 20 kHz (Blackman-Harris window). Usage: node tools/alias-test.mjs [--check]   (part of tools/run-tests.mjs)
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { MiniSynth, SuperSaw } = await import(path.join(root, 'js/engine/instruments.js'));
const { fft, blepInit } = await import(path.join(root, 'js/engine/dsp.js'));
const SR = 48000, N = 32768, CHECK = process.argv.includes('--check'); blepInit(SR);
function alias(inst, p, f0s) {
  const L = new Float32Array(N + 4800), R = new Float32Array(N + 4800); inst.noteOn(p, 1); inst.render(L, R, 0, L.length);
  const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < N; i++) re[i] = L[4800 + i] * (0.35875 - 0.48829 * Math.cos(2 * Math.PI * i / N) + 0.14128 * Math.cos(4 * Math.PI * i / N) - 0.01168 * Math.cos(6 * Math.PI * i / N));
  fft(re, im, N); let h = 0, a = 0;
  for (let k = 1; k < N / 2; k++) { const f = k * SR / N; if (f > 20000) break; const e = re[k] * re[k] + im[k] * im[k], d = Math.min(...f0s.map((f0) => Math.abs(f / f0 - Math.round(f / f0)) * f0)); if (d < 12) h += e; else if (d > 30) a += e; }
  return 10 * Math.log10(a / h);
}
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
for (const p of [84, 96, 103]) {
  const f0 = 440 * Math.pow(2, (p - 69) / 12);
  for (const w of [0, 1]) { const m = new MiniSynth(SR); m.setParam(0, w); m.setParam(1, 20000); m.setParam(2, 0.001); m.setParam(4, 1); const a = alias(m, p, [f0]); ok(!CHECK || a < -85, `Mini Synth ${w ? 'square' : 'saw'} ${f0.toFixed(0)} Hz: aliasing ${a.toFixed(1)} dB (< -85)`); }
}
{ const s = new SuperSaw(SR); s.setParam(1, 0); s.setParam(2, 20000); const f0 = 440 * Math.pow(2, (96 - 69) / 12); const a = alias(s, 96, [f0]); ok(!CHECK || a < -80, `SuperSaw centre saw ${f0.toFixed(0)} Hz: aliasing ${a.toFixed(1)} dB (< -80)`); }
if (CHECK) { console.log(bad ? bad + ' FAILED' : 'ALL OK'); process.exit(bad ? 1 : 0); }
