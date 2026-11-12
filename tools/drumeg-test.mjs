// Drum pad envelope model 1 = FL Studio Mobile's drum slot envelope (port of Honeydew crates/audio/src/drums.rs): a constant (DC) sample pad
// played through the engine, the output compared with Honeydew's recurrence run here in plain numbers: instant attack, decay towards the
// sustain level with c = 0.0002 / (50 x^4), release after the note-off, slow attack towards 5 clipped at 1, and the Hold gate.
// Usage: node tools/drumeg-test.mjs   (part of tools/run-tests.mjs)
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Engine, PPQ } = await import(path.join(root, 'js/engine/core.js'));
let bad = 0; const ok = (c, msg) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const SR = 44100, dc = new Float32Array(SR * 4).fill(0.5);
const coef = (v, scale) => { const x = 0.95 * v + 0.05, den = scale * x ** 4; return v < 0.001 || den < 0.001 ? 1 : 0.0002 / den; };
function play({ a, d, s, r, hold = 0, off }) {
  const e = new Engine(SR); e.masterLimit(false); e.loadSample(0, dc, dc); e.tempo(120); e.trackInst(0, 3); e.trackVol(0, 1);
  const S = (f, v) => e.instParam(0, 200 + 6 * 16 + f, v);
  S(0, 0); S(11, 50); e.instParam(0, 500 + 6, 1); S(6, a); S(7, d); S(8, s); S(9, r); S(14, hold);
  e.trackNotes(0, [0, Math.round(off * 2 * PPQ), 50, 1, 0], 1); e.settle(); e.play();     // 120 bpm: 1 beat = 0.5 s
  const N = SR * 2, L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i += 128) e.render(L.subarray(i, i + 128), R.subarray(i, i + 128), Math.min(128, N - i));
  return L;
}
// Honeydew's loop: gate / note-off -> Release; Attack target 5 (clip 1 -> Decay); Decay target sustain; Release target 0, ends below 1e-4
function model({ a, d, s, r, offFrame }, n) {
  const ca = coef(a, 500), cd = coef(d, 50), cr = coef(r, 50), out = new Float64Array(n); let env = 0, st = 0;
  for (let i = 0; i < n; i++) {
    if (i === offFrame && st < 2) st = 2;
    env += ((st === 0 ? 5 : st === 1 ? s : 0) - env) * (st === 0 ? ca : st === 1 ? cd : cr);
    if (st === 0 && env > 1) { env = 1; st = 1; } else if (st === 2 && env < 1e-4) break;
    out[i] = env;
  }
  return out;
}
const first = (L) => { for (let i = 0; i < L.length; i++) if (L[i] !== 0) return i; return -1; };
function cmp(label, p, offFrame) {
  const L = play(p), i0 = first(L), n = SR, m = model({ ...p, offFrame }, n), g = L[i0] / m[0];
  let worst = 0; for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(L[i0 + i] / g - m[i]));
  ok(i0 >= 0 && worst < 2e-3, `${label}: engine follows Honeydew's envelope (max difference ${worst.toExponential(2)} of full scale)`);
  return { L, i0, g, m };
}
{ const x = cmp('decay to sustain 0.4 (D 0.3), key held', { a: 0, d: 0.3, s: 0.4, r: 1, off: 3 }, -1), cd = coef(0.3, 50);
  const at = Math.round(SR * 0.05); ok(Math.abs(x.m[at] - (0.4 + 0.6 * (1 - cd) ** at)) < 1e-9, 'the reference recurrence is the closed form S + (1 - S)(1 - c)^n'); }
{ const off = Math.round(0.25 * SR); const x = cmp('release R 0.25 after a 0.25 s note', { a: 0, d: 1, s: 1, r: 0.25, off: 0.25 }, off);
  const e1 = x.L[x.i0 + off - 2] / x.g, e2 = x.L[x.i0 + off + Math.round(0.02 * SR)] / x.g; ok(e1 > 0.99 && e2 < 0.9 && e2 > 0.01, `before the note-off full level (${e1.toFixed(3)}), 20 ms after it ${e2.toFixed(3)}`); }
cmp('attack A 0.35 towards 5, clipped at 1', { a: 0.35, d: 1, s: 1, r: 1, off: 3 }, -1);
{ const p = { a: 0, d: 1, s: 1, r: 0.2, hold: 0.1, off: 3 }, L = play(p), i0 = first(L), g = L[i0], hf = Math.round(0.1 * SR);
  const m = model({ ...p, offFrame: hf - 1 }, SR); let worst = 0; for (let i = 0; i < SR; i++) worst = Math.max(worst, Math.abs(L[i0 + i] / g - m[i]));
  ok(worst < 2e-3, `Hold 0.1 s = the Length gate: release starts there although the key is held (max difference ${worst.toExponential(2)})`); }
{ const L = play({ a: 0, d: 1, s: 1, r: 1, off: 0.1 }), i0 = first(L), late = L[i0 + Math.round(0.5 * SR)] / L[i0]; ok(late > 0.9, `FLM default sliders (0 / 1 / 1 / 1): the release is so slow the hit plays on (${late.toFixed(3)} of the level 0.4 s after the note-off)`); }
console.log(bad ? `DRUM FLM ENVELOPE: ${bad} failed` : 'DRUM FLM ENVELOPE: all passed'); process.exit(bad ? 1 : 0);
