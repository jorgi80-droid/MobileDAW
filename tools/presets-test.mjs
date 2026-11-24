// v72 factory presets: count (>= 100 per synth), ranges, unique names, and a headless render of EVERY preset (C major chord, 2.5 s held + tail):
// no NaN/Inf, audible (peak > -40 dBFS), and not louder than the loudest hand-made preset of the same instrument by more than 3 dB.
// Usage: node tools/presets-test.mjs
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = await import(path.join(root, 'js/defs.js')), { Engine, PPQ } = await import(path.join(root, 'js/engine/core.js'));
const SR = 48000, B = 128; let bad = 0; const ok = (c, m) => { if (!c) { console.log('FAIL ' + m); bad++; } };
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
function render(type, p) {
  const e = new Engine(SR); e.trackInst(0, type);
  D.INSTRUMENTS[type].params.forEach((q, k) => e.instParam(0, k, p[k] ?? q.def));
  const len = Math.round(2.5 * 2 * PPQ), f = []; for (const n of [48, 52, 55, 60]) f.push(0, len, n, 0.8, 0);
  e.trackNotes(0, f, 4); e.play();
  const L = new Float32Array(B), R = new Float32Array(B); let pk = 0, ss = 0, n = 0, nan = false;
  for (let b = 0; b < Math.ceil(4 * SR / B); b++) { e.render(L, R, B); for (let i = 0; i < B; i++) { const a = Math.abs(L[i]), c = Math.abs(R[i]); if (!Number.isFinite(a + c)) nan = true; pk = Math.max(pk, a, c); ss += L[i] * L[i]; n++; } }
  return { pk, rms: Math.sqrt(ss / n), nan };
}
// Moisture (37) is C++ only: its presets render through the WebAssembly build of the engine
const { loadWasmEngine } = await import('./wasm-engine.mjs'), { encode } = await import('../js/engine/cmdtext.js');
async function renderWasm(t, p) {
  const w = await loadWasmEngine(SR), def = D.INSTRUMENTS[t], L0 = [encode('trackInst', [0, t])];
  def.params.forEach((q, k) => L0.push(encode('instParam', [0, k, p[k] ?? q.def])));
  w.cmd(L0.join('\n')); for (const n of [48, 52, 55, 60]) w.cmd(encode('preview', [0, n, 0.8, 1]));
  const L = new Float32Array(B), R = new Float32Array(B); let pk = 0, nan = false;
  for (let b = 0; b < Math.ceil(2.5 * SR / B); b++) { w.render(L, R, B); for (let i = 0; i < B; i++) { if (!Number.isFinite(L[i] + R[i])) nan = true; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); } }
  return { pk, nan };
}
for (const t of [37, 31, 32, 33]) {   // 37: Moisture with the Moisture Klasik / Osphere presets moved over; 31 .. 33: FL Studio Mobile GMS / MiniSynth / SuperSaw with the classic presets moved over (the classic types are gone)
  const def = D.INSTRUMENTS[t], L = D.PRESETS[t], names = new Set(L.map((x) => x.name));
  ok(L.length >= 100, `${def.name}: ${L.length} presets`); ok(names.size === L.length, `${def.name}: duplicate names`);
  for (const pr of L) for (const [k, v] of Object.entries(pr.p)) { const q = def.params[k]; ok(q && v >= q.min && v <= q.max && (!q.step || Math.abs(v / q.step - Math.round(v / q.step)) < 1e-9), `${def.name} / ${pr.name}: param ${k} = ${v}`); }
  const res = []; for (const pr of L) res.push({ pr, ...(def.native ? await renderWasm(t, pr.p) : render(t, pr.p)) });
  const hand = res.slice(0).filter((r) => !/ (Deep|Bright|Soft|Tight)( II)*$/.test(r.pr.name)), ref = Math.max(...res.filter((r, i) => i < 0 || true).map((r) => 0), ...hand.map((r) => r.pk));
  let lo = 1e9, hi = 0;
  for (const r of res) {
    lo = Math.min(lo, db(r.pk)); hi = Math.max(hi, db(r.pk));
    ok(!r.nan, `${def.name} / ${r.pr.name}: NaN`); ok(db(r.pk) > -40, `${def.name} / ${r.pr.name}: too quiet (${db(r.pk).toFixed(1)} dBFS)`);
    ok(db(r.pk) <= db(ref) + 3, `${def.name} / ${r.pr.name}: too loud (${db(r.pk).toFixed(1)} dBFS vs ${db(ref).toFixed(1)})`);
  }
  console.log(`${def.name.padEnd(10)} ${L.length} presets, peak range ${lo.toFixed(1)} .. ${hi.toFixed(1)} dBFS`);
}
console.log(bad ? 'FAILED ' + bad : 'ALL OK'); process.exit(bad ? 1 : 0);
