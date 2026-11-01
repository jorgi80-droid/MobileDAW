// Wave Editor operations (js/engine/waveops.js): lengths, positions, silence, copies, fades, normalise, zero-crossing cuts, source untouched.
// Usage: node tools/waveops-test.mjs
import * as W from '../js/engine/waveops.js';
import { postRender } from '../js/engine/wav.js';
const SR = 48000; let bad = 0;
const ok = (c, m) => { if (c) console.log('ok   ' + m); else { bad++; console.log('FAIL ' + m); } };
const N = SR;                                                     // 1 s: 100 Hz sine in L, 0.5 x in R
const L = new Float32Array(N), R = new Float32Array(N); for (let i = 0; i < N; i++) { L[i] = Math.sin(2 * Math.PI * 100 * i / SR) * 0.5; R[i] = L[i] * 0.5; }
const L0 = L.slice(), a = 12000, b = 24000;
const same = (x, y, off = 0, n = x.length) => { for (let i = 0; i < n; i++) if (Math.abs(x[i] - y[i + off]) > 1e-7) return false; return true; };
const peak = (x, s = 0, e = x.length) => { let p = 0; for (let i = s; i < e; i++) p = Math.max(p, Math.abs(x[i])); return p; };

let o = W.insertSilence(L, R, a, b);
ok(o.l.length === N + (b - a) && peak(o.l, a, b) === 0 && same(L.subarray(0, a), o.l) && same(L.subarray(a), o.l, b), 'Insert Silence: silence of the selection length at its start, the rest shifted right');
o = W.duplicate(L, R, a, b);
ok(o.l.length === N + (b - a) && same(L.subarray(a, b), o.l, b) && same(L.subarray(b), o.l, 2 * b - a), 'Duplicate: the selection repeated right after itself');
o = W.clear(L, R, a, b, SR);
ok(o.l.length === N && peak(o.l, a + 60, b - 60) === 0 && same(L.subarray(0, a - 60), o.l), 'Clear: audio in the range silenced, length (time) kept');
o = W.deleteSpace(L, R, a, b, SR);
ok(o.l.length === N - (o.b - o.a) && Math.abs(o.a - a) <= 48 && Math.abs(o.b - b) <= 48, 'Delete Space: range removed (cuts within 1 ms of the selection)');
ok(Math.abs(L[o.a]) < 0.02 && Math.abs(L[o.b]) < 0.02, 'Delete Space: cut points on zero crossings (no click)');
o = W.trim(L, R, a, b, SR);
ok(Math.abs(o.l.length - (b - a)) <= 96 && same(o.l, L, o.a), 'Trim Selection: only the selection kept');
o = W.fade(L, R, a, b, 1);
ok(Math.abs(o.l[a]) < 1e-9 && Math.abs(o.l[b - 1] - L[b - 1]) < 0.01 && same(L.subarray(b), o.l, b) && same(L.subarray(0, a), o.l), 'Fade In: 0 -> 100 % over the selection only');
o = W.fade(L, R, a, b, -1);
ok(Math.abs(o.l[a] - L[a]) < 1e-9 && Math.abs(o.l[b - 1]) < 0.01, 'Fade Out: 100 % -> 0 over the selection');
o = W.normalize(L, R, a, b, -0.1);
ok(Math.abs(peak(o.l, a, b) - Math.pow(10, -0.1 / 20)) < 1e-4 && same(L.subarray(0, a), o.l) && Math.abs(o.gain - Math.pow(10, -0.1 / 20) / 0.5) < 1e-3, 'Normalize: selection peak -> -0.1 dBFS, outside unchanged');
ok(Math.abs(peak(o.r, a, b) - peak(R, a, b) * o.gain) < 1e-6, 'Normalize: one gain for both channels (stereo image kept)');
ok(same(L0, L), 'the source buffers are never modified');
const M = W.fade(L, L, a, b, 1); ok(M.r === M.l, 'mono buffer stays mono');
// export render modes (wav.js postRender): body 1000 frames + 300 frames of tail, in two chunks; leading 100 frames silent
{ const mk = () => { const a = new Float32Array(1300); for (let i = 100; i < 1300; i++) a[i] = i < 1000 ? 0.5 : 0.25; return [a.subarray(0, 700), a.subarray(700)]; };
  let q = postRender(mk(), mk(), 1000, { tail: 'leave' }); ok(q.L[0].length === 1300 && q.L[0][1299] === 0.25, 'Leave Remainder: the tail after the end stays');
  q = postRender(mk(), mk(), 1000, { tail: 'cut' }); ok(q.L[0].length === 1000 && q.L[0][999] === 0.5, 'Cut Remainder: the file stops exactly at the end');
  q = postRender(mk(), mk(), 1000, { tail: 'wrap' }); ok(q.L[0].length === 1000 && q.L[0][0] === 0.25 && q.L[0][150] === 0.75 && q.L[0][400] === 0.5, 'Wrap Remainder: the tail is mixed into the start, length = body (seamless loop)');
  q = postRender(mk(), mk(), 1000, { tail: 'cut', trimStart: true }); ok(q.L[0].length === 900 && q.L[0][0] === 0.5, 'Trim Silence: leading silence removed'); }
console.log(bad ? `\n${bad} FAILED` : '\nwaveops-test: all passed'); process.exit(bad ? 1 : 0);
