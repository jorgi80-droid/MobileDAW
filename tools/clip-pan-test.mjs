// Pan per audio clip (stride-8 clip events: balance on top of the track pan; the centre leaves both sides untouched, so every project without a clip pan
// plays bit-identical to before).   Usage: node tools/clip-pan-test.mjs   (part of tools/run-tests.mjs)
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Engine, PPQ } = await import(path.join(root, 'js/engine/core.js'));
let bad = 0; const ok = (c, msg) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const SR = 48000, n = SR, l = new Float32Array(n), r = new Float32Array(n);
for (let i = 0; i < n; i++) { l[i] = 0.4 * Math.sin(2 * Math.PI * 300 * i / SR); r[i] = 0.4 * Math.sin(2 * Math.PI * 450 * i / SR); }
function run(flat, stride) {
  const e = new Engine(SR); e.masterLimit(false); e.loadSample(0, l, r); e.trackClips(0, flat, 1, stride); e.trackVol(0, 1); e.play();
  const N = SR / 2, L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i += 128) e.render(L.subarray(i, i + 128), R.subarray(i, i + 128), Math.min(128, N - i));
  return [L, R];
}
const rms = (a) => { let s = 0; for (let i = 12000; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / (a.length - 12000)); };
const [L7, R7] = run([0, PPQ * 8, 0, 1, 0, 0, 0], 7), [L0, R0] = run([0, PPQ * 8, 0, 1, 0, 0, 0, 0], 8);
let same = true; for (let i = 0; i < L7.length; i++) if (L7[i] !== L0[i] || R7[i] !== R0[i]) { same = false; break; }
ok(same, 'pan 0 (stride 8) is bit-identical to the old stride-7 clip');
const [LL, RL] = run([0, PPQ * 8, 0, 1, 0, 0, 0, -1], 8), [LR, RR] = run([0, PPQ * 8, 0, 1, 0, 0, 0, 1], 8), [LH, RH] = run([0, PPQ * 8, 0, 1, 0, 0, 0, 0.5], 8);
ok(rms(RL) < 1e-9 && Math.abs(rms(LL) / rms(L0) - 1) < 1e-6, `pan hard left: right silent, left untouched (${rms(RL).toExponential(1)})`);
ok(rms(LR) < 1e-9 && Math.abs(rms(RR) / rms(R0) - 1) < 1e-6, 'pan hard right: left silent, right untouched');
ok(Math.abs(rms(LH) / rms(L0) - 0.5) < 1e-6 && Math.abs(rms(RH) / rms(R0) - 1) < 1e-6, 'pan 50 % right: left halves, right untouched (balance)');
console.log(bad ? `\n${bad} FAILED` : '\nCLIP PAN OK'); process.exit(bad ? 1 : 0);
