// Golden (equivalence) tests: the JS engine (js/engine, the reference) and the C++ engine (native/) render the same scenario and are
// compared sample by sample. The scenario is run once on the JS engine through a recorder that writes every engine command and every
// render call to a text file (native/engine/commands.h format); the C++ desktop host replays that file.
// Pass: RMS of the difference below -90 dBFS AND no single sample off by more than -70 dBFS (the RMS alone can hide a small real bug). A scenario that uses an instrument / effect not ported yet is reported SKIP.
// Usage: node tools/golden/golden.mjs [scenario ...] [--list] [--keep]       (builds build/native/golden_host with cmake when needed)
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { Engine } = await import(path.join(root, 'js/engine/core.js'));
const SR = 48000, LIMIT_DB = -90, MAX_DB = -70;
const args = process.argv.slice(2), flags = new Set(args.filter((a) => a.startsWith('--'))), names = args.filter((a) => !a.startsWith('--'));
if (flags.has('--list')) { for (const s of SCENARIOS) console.log(s.name.padEnd(22), s.info || ''); process.exit(0); }

// ---- recorder: forwards to the JS engine and writes the command stream
const num = (v) => (v === true ? '1' : v === false ? '0' : v == null ? 'u' : Number.isNaN(v) ? 'nan' : v === Infinity ? 'inf' : v === -Infinity ? '-inf' : Object.is(v, -0) ? '-0' : String(+v));
function recorder(sr) {
  const e = new Engine(sr), lines = ['sr ' + sr], blobs = []; let blobLen = 0;
  const f32 = (a) => { const off = blobLen; blobs.push(Float32Array.from(a)); blobLen += a.length; return '@' + off + ':' + a.length; };
  const arg = (v) => (v instanceof Float32Array ? f32(v) : Array.isArray(v) || ArrayBuffer.isView(v) ? '[' + v.length + (v.length ? ' ' : '') + Array.from(v, num).join(' ') + ']' : num(v));
  const out = [];
  const rec = new Proxy(e, {
    get(t, k) {
      if (k === 'render') return (n) => { const L = new Float32Array(n), R = new Float32Array(n); t.render(L, R, n); lines.push('render ' + n); out.push([L, R]); };
      if (k === 'loadSample') return (id, l, r) => { lines.push(`sample ${id} ${f32(l)}${r && r !== l ? ' ' + f32(r) : ''}`); t.loadSample(id, l, r); };
      if (k === 'engine') return t;
      const v = t[k];
      if (typeof v !== 'function') return v;
      return (...a) => { lines.push(k + (a.length ? ' ' + a.map(arg).join(' ') : '')); return v.apply(t, a); };
    },
  });
  const finish = () => {
    const frames = out.reduce((s, [L]) => s + L.length, 0), I = new Float32Array(frames * 2); let o = 0;
    for (const [L, R] of out) for (let i = 0; i < L.length; i++, o += 2) { I[o] = L[i]; I[o + 1] = R[i]; }
    const B = new Float32Array(blobLen); let b = 0; for (const x of blobs) { B.set(x, b); b += x.length; }
    return { cmds: lines.join('\n') + '\n', blob: B, ref: I };
  };
  return { rec, finish };
}

// ---- C++ host
const hostDir = path.join(root, 'build/native'), host = path.join(hostDir, 'golden_host');
function buildHost() {
  const r1 = spawnSync('cmake', ['-S', path.join(root, 'native'), '-B', hostDir, '-DCMAKE_BUILD_TYPE=Release'], { encoding: 'utf8' });
  const r2 = r1.status === 0 ? spawnSync('cmake', ['--build', hostDir, '-j8'], { encoding: 'utf8' }) : r1;
  if (r2.status !== 0) { console.log(r1.stdout, r1.stderr, r2.stdout, r2.stderr); throw new Error('golden_host build failed'); }
}

function compare(ref, out) {
  if (ref.length !== out.length) return { err: `length ${out.length / 2} != ${ref.length / 2} frames` };
  let se = 0, sr = 0, mx = 0, at = -1;
  for (let i = 0; i < ref.length; i++) { const d = out[i] - ref[i]; se += d * d; sr += ref[i] * ref[i]; const a = Math.abs(d); if (a > mx) { mx = a; at = i >> 1; } }
  const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  return { diffDb: db(Math.sqrt(se / ref.length)), refDb: db(Math.sqrt(sr / ref.length)), maxDb: db(mx), at };
}

buildHost();
const list = names.length ? SCENARIOS.filter((s) => names.includes(s.name)) : SCENARIOS;
if (names.length && list.length !== names.length) { console.log('unknown scenario; --list shows them'); process.exit(2); }
let bad = 0, skip = 0;
for (const sc of list) {
  const dir = path.join(root, 'build/golden', sc.name); fs.mkdirSync(dir, { recursive: true });
  const { rec, finish } = recorder(SR);
  const t0 = Date.now();
  await sc.run(rec, { root, SR });
  const { cmds, blob, ref } = finish();
  fs.writeFileSync(path.join(dir, 'cmds.txt'), cmds); fs.writeFileSync(path.join(dir, 'blob.f32'), Buffer.from(blob.buffer)); fs.writeFileSync(path.join(dir, 'ref.f32'), Buffer.from(ref.buffer));
  const jsMs = Date.now() - t0, t1 = Date.now();
  const r = spawnSync(host, [path.join(dir, 'cmds.txt'), path.join(dir, 'blob.f32'), path.join(dir, 'out.f32')], { encoding: 'utf8' });
  const cMs = Date.now() - t1, sec = (ref.length / 2 / SR).toFixed(1) + ' s';
  if (r.status === 3) { skip++; console.log(`SKIP ${sc.name.padEnd(22)} ${sec.padStart(7)}  ${(r.stdout || '').trim()}`); continue; }
  if (r.status !== 0) { bad++; console.log(`FAIL ${sc.name.padEnd(22)} host error: ${(r.stderr || r.stdout).trim()}`); continue; }
  const ob = fs.readFileSync(path.join(dir, 'out.f32')), out = new Float32Array(ob.buffer, ob.byteOffset, ob.length / 4);
  const c = compare(ref, out);
  if (c.err) { bad++; console.log(`FAIL ${sc.name.padEnd(22)} ${c.err}`); continue; }
  const pass = c.diffDb < LIMIT_DB && c.maxDb < MAX_DB && c.refDb > -200;   // a silent reference proves nothing
  if (!pass) bad++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${sc.name.padEnd(22)} ${sec.padStart(7)}  level ${c.refDb.toFixed(1)} dBFS  diff RMS ${c.diffDb === -Infinity ? '-inf (identical)' : c.diffDb.toFixed(1) + ' dBFS'}  max ${c.maxDb === -Infinity ? '-inf' : c.maxDb.toFixed(1) + ' dBFS @' + c.at}  (js ${jsMs} ms, c++ ${cMs} ms)`);
  if (!flags.has('--keep') && pass) for (const f of ['blob.f32', 'ref.f32', 'out.f32']) fs.rmSync(path.join(dir, f), { force: true });
}
console.log(bad ? `\n${bad} FAILED` : `\nALL OK (${list.length - skip} compared, ${skip} skipped: not ported yet)`);
process.exit(bad ? 1 : 0);
