// Sliced (worklet-style) wavetable build vs. all-at-once build: the tables must be bit-identical, and the pump must spend little per call.
// Usage: node --experimental-default-type=module tools/tables-test.mjs [sync|sliced]   (prints a hash; run both and compare)
import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
const root = process.env.ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = await import(path.join(root, 'js/engine/dsp.js'));
const I = await import(path.join(root, 'js/engine/instruments.js')), Lv = await import(path.join(root, 'js/engine/live.js'));
const mode = process.argv[2] || 'sync', h = crypto.createHash('sha1'); let worst = 0, calls = 0; const ts = [];
if (mode === 'sliced') {
  D.JOBS.sync = false;
  if (!I.tablesReq) throw new Error('no sliced build in this version');
  const want = [0, 5, 20, 33];
  I.tablesReq(); for (const i of want) Lv.wtTableReq(i);
  while (D.JOBS.q.length) { const a = performance.now(); D.pumpJobs(); const d = performance.now() - a; ts.push(d); worst = Math.max(worst, d); calls++; }
  h.update(Buffer.from(I.tablesReq().d.buffer));
  for (const i of want) h.update(Buffer.from(Lv.wtTableReq(i).d.buffer));
  ts.sort((x, y) => x - y); console.log(`sliced: ${calls} pump calls, p50 ${ts[calls >> 1].toFixed(2)} p99 ${ts[Math.floor(calls * 0.99)].toFixed(2)} worst ${worst.toFixed(2)} ms (budget per block 2.67 ms), hash ${h.digest('hex').slice(0, 12)}`);
} else {
  const a = performance.now(); h.update(Buffer.from(I.buildTables().d.buffer)); for (const i of [0, 5, 20, 33]) h.update(Buffer.from(Lv.wtTable(i).d.buffer));
  console.log(`sync: ${(performance.now() - a).toFixed(0)} ms, hash ${h.digest('hex').slice(0, 12)}`);
}
