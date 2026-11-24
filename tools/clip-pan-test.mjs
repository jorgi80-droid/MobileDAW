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
// clip envelope (FLM audio-clip Level / Pan, stride 10 + [seconds, gain, pan] points)
function runEnv(flat, env) {
  const e = new Engine(SR); e.masterLimit(false); e.loadSample(0, l, r); e.trackClips(0, flat, 1, 10, env); e.trackVol(0, 1); e.play();
  const N = SR / 2, L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i += 128) e.render(L.subarray(i, i + 128), R.subarray(i, i + 128), Math.min(128, N - i));
  return [L, R];
}
const seg = (a, s0, s1) => { let s = 0; for (let i = Math.round(s0 * SR); i < Math.round(s1 * SR); i++) s += a[i] * a[i]; return Math.sqrt(s / (Math.round(s1 * SR) - Math.round(s0 * SR))); };
{ const [Ln] = runEnv([0, PPQ * 8, 0, 1, 0, 0, 0, 0, 0, 0], []); let same = true; for (let i = 0; i < Ln.length; i++) if (Ln[i] !== L0[i]) { same = false; break; }
  ok(same, 'stride 10 without points is bit-identical to stride 8');
  const [LE, RE] = runEnv([0, PPQ * 8, 0, 1, 0, 0, 0, 0, 0, 2], [0.1, 1, 0, 0.3, 0, 0]);
  ok(Math.abs(seg(LE, 0.02, 0.09) / seg(L0, 0.02, 0.09) - 1) < 1e-3, 'before the first point: the clip gain');
  ok(seg(LE, 0.3, 0.5) < 1e-9 && seg(RE, 0.3, 0.5) / seg(R0, 0.3, 0.5) < 1e-9, 'after the last point: its gain (0)');
  const mid = seg(LE, 0.19, 0.21) / seg(L0, 0.19, 0.21); ok(Math.abs(mid - 0.5) < 0.02, `halfway: linear fade (${mid.toFixed(3)})`);
  const [LP, RP] = runEnv([0, PPQ * 8, 0, 1, 0, 0, 0, 0, 0, 1], [0, 1, 1]); ok(seg(LP, 0.1, 0.5) < 1e-9 && Math.abs(seg(RP, 0.1, 0.5) / seg(R0, 0.1, 0.5) - 1) < 1e-6, 'pan envelope: hard right'); }
console.log(bad ? `\n${bad} FAILED` : '\nCLIP PAN OK'); process.exit(bad ? 1 : 0);
