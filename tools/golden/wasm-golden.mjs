// The golden scenarios on the WebAssembly build of the C++ engine (js/engine/mdaw.wasm): each scenario is recorded on the JS engine
// (the reference, as tools/golden/golden.mjs does) and replayed on the WASM engine. The WASM build uses another maths library (musl)
// than the desktop host, so "identical" is not expected everywhere: pass = difference RMS below -90 dBFS and no sample off by more than
// -70 dBFS, the golden limits. Usage: node tools/golden/wasm-golden.mjs [scenario ...]
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.mjs';
import { loadWasmEngine } from '../wasm-engine.mjs';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { Engine } = await import(path.join(root, 'js/engine/core.js'));
const { encode, sfArgs } = await import(path.join(root, 'js/engine/cmdtext.js'));
const SR = 48000, names = process.argv.slice(2), list = names.length ? SCENARIOS.filter((s) => names.includes(s.name)) : SCENARIOS;
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
let bad = 0, same = 0;
for (const sc of list) {
  const e = new Engine(SR), steps = [], blobs = []; let blobLen = 0;
  const f32 = (a) => { const off = blobLen; blobs.push(Float32Array.from(a)); blobLen += a.length; return '@' + off + ':' + a.length; };
  const ref = [];
  const rec = new Proxy(e, { get(t, k) {
    if (k === 'render') return (n) => { const L = new Float32Array(n), R = new Float32Array(n); t.render(L, R, n); steps.push(n); ref.push([L, R]); };
    if (k === 'loadSample') return (id, l, r) => { steps.push(`sample ${id} ${f32(l)}${r && r !== l ? ' ' + f32(r) : ''}`); t.loadSample(id, l, r); };
    if (k === 'loadSoundFont') return (id, sf) => { steps.push(encode('sf', sfArgs(id, sf), f32)); t.loadSoundFont(id, sf); };
    if (k === 'engine') return t;
    const v = t[k]; if (typeof v !== 'function') return v;
    return (...a) => { steps.push(encode(k, a, f32)); return v.apply(t, a); };
  } });
  const t0 = Date.now(); await sc.run(rec, { root, SR }); const jsMs = Date.now() - t0;
  const B = new Float32Array(blobLen); let b = 0; for (const x of blobs) { B.set(x, b); b += x.length; }
  const w = await loadWasmEngine(SR); w.setBlob(B);
  let se = 0, sr = 0, mx = 0, n = 0, k = 0, errs = ''; const t1 = Date.now();
  for (const s of steps) {
    if (typeof s === 'string') { const er = w.cmd(s); if (er) errs += er; continue; }
    const L = new Float32Array(s), R = new Float32Array(s); w.render(L, R, s);
    const [rl, rr] = ref[k++];
    for (let i = 0; i < s; i++) { let d = L[i] - rl[i]; se += d * d; mx = Math.max(mx, Math.abs(d)); d = R[i] - rr[i]; se += d * d; mx = Math.max(mx, Math.abs(d)); sr += rl[i] * rl[i] + rr[i] * rr[i]; }
    n += 2 * s;
  }
  const wMs = Date.now() - t1, diff = db(Math.sqrt(se / n)), pass = diff < -90 && db(mx) < -70 && !errs;
  if (!pass) bad++; if (mx === 0) same++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${sc.name.padEnd(22)} level ${db(Math.sqrt(sr / n)).toFixed(1)} dBFS  diff RMS ${diff === -Infinity ? '-inf (identical)' : diff.toFixed(1) + ' dBFS'}  max ${db(mx) === -Infinity ? '-inf' : db(mx).toFixed(1)}  (js ${jsMs} ms, wasm ${wMs} ms)${errs ? '  errors: ' + errs.trim().slice(0, 120) : ''}`);
}
console.log(bad ? `\n${bad} FAILED` : `\nWASM ALL OK (${list.length} scenarios, ${same} identical to the JS engine)`);
process.exit(bad ? 1 : 0);
