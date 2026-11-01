// Channel stereo stage (core.js stereo): width 0 = mono (L == R), 1 = untouched (bit-identical), 2 = side doubled; phase invert L / R / both
// flips the polarity after a 1.5 ms ramp (no click); width changes glide like the fader.
// Usage: node tools/mixer-test.mjs     (part of tools/run-tests.mjs)
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Engine, PPQ } = await import(path.join(root, 'js/engine/core.js'));
let bad = 0; const ok = (c, msg) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const SR = 48000, n = SR, l = new Float32Array(n), r = new Float32Array(n);
for (let i = 0; i < n; i++) { l[i] = 0.4 * Math.sin(2 * Math.PI * 300 * i / SR); r[i] = 0.3 * Math.sin(2 * Math.PI * 450 * i / SR); }
function run(setup, sec = 0.5, events = []) {
  const e = new Engine(SR); e.masterLimit(false); e.loadSample(0, l, r); e.trackClips(0, [0, PPQ * 8, 0, 1, 0, 0, 0], 1); e.trackVol(0, 1); setup(e); e.play();
  const N = Math.round(sec * SR), L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i += 128) { for (const [at, fn] of events) if (at === i) fn(e); e.render(L.subarray(i, i + 128), R.subarray(i, i + 128), Math.min(128, N - i)); }
  return [L, R];
}
const [L1, R1] = run(() => {}), [L0, R0] = run((e) => e.trackWidth(0, 0)), [L2, R2] = run((e) => e.trackWidth(0, 2)), [LI, RI] = run((e) => e.trackInvert(0, 3)), [LL, RL] = run((e) => e.trackInvert(0, 1));
const tail = (a) => a.subarray(12000);
let mono = 0; for (let i = 12000; i < L0.length; i++) mono = Math.max(mono, Math.abs(L0[i] - R0[i]));
ok(mono < 1e-6, `width 0 %: L == R (max difference ${mono.toExponential(1)})`);
let side = 0; for (let i = 12000; i < L2.length; i++) { const s1 = (L1[i] - R1[i]) / 2, s2 = (L2[i] - R2[i]) / 2, m1 = (L1[i] + R1[i]) / 2, m2 = (L2[i] + R2[i]) / 2; side = Math.max(side, Math.abs(s2 - 2 * s1), Math.abs(m2 - m1)); }
ok(side < 1e-5, `width 200 %: side doubled, mid unchanged (max error ${side.toExponential(1)})`);
let inv = 0, invL = 0; for (let i = 12000; i < LI.length; i++) { inv = Math.max(inv, Math.abs(LI[i] + L1[i]), Math.abs(RI[i] + R1[i])); invL = Math.max(invL, Math.abs(LL[i] + L1[i]), Math.abs(RL[i] - R1[i])); }
ok(inv < 1e-6 && invL < 1e-6, 'phase invert both sides: output negated; left only: left negated, right untouched');
// clicks: flipping the polarity / jumping the width while the tone plays
const step = (a, x, y) => { let m = 0; for (let i = Math.max(1, x); i < y; i++) m = Math.max(m, Math.abs(a[i] - a[i - 1])); return m; };
const [LF] = run(() => {}, 0.5, [[12032, (e) => e.trackInvert(0, 3)]]), [LW] = run(() => {}, 0.5, [[12032, (e) => e.trackWidth(0, 0)]]);
const base = step(L1, 4000, 12000), sf = step(LF, 11900, 12400) / base, swd = step(LW, 11900, 12400) / base;
ok(sf < 1.3 && swd < 1.3, `no click: polarity flip step ${sf.toFixed(2)}x, width jump step ${swd.toFixed(2)}x the tone's own steps`);
console.log(bad ? `\n${bad} FAILED` : '\nALL OK'); process.exit(bad ? 1 : 0);
