// Runs every check of the project: syntax of every JS file, sw.js asset list, and all tests in tools/. Exit code 1 if anything fails.
// Usage: node tools/run-tests.mjs
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
const run = (label, args) => {
  const t = Date.now(), r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  const okRun = r.status === 0;
  if (!okRun) { bad++; console.log((r.stdout || '') + (r.stderr || '')); }
  console.log(`${okRun ? 'ok  ' : 'FAIL'} ${label} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  return r;
};
// 1. syntax of every JS file of the web app
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.m?js$/.test(e.name) ? [path.join(d, e.name)] : []));
const js = [...walk(path.join(root, 'js')), path.join(root, 'sw.js'), ...walk(path.join(root, 'tools'))];
let syn = 0;
for (const f of js) { const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }); if (r.status !== 0) { syn++; console.log(r.stderr); } }
if (syn) bad++;
console.log(`${syn ? 'FAIL' : 'ok  '} node --check on ${js.length} files`);
// 2. every web file is in sw.js ASSETS (otherwise the PWA breaks offline)
const assets = new Set(JSON.parse(fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/const ASSETS = (\[.*?\]);/)[1]));
const web = [...walk(path.join(root, 'js')), ...fs.readdirSync(path.join(root, 'css')).map((f) => path.join(root, 'css', f))].map((f) => './' + path.relative(root, f).split(path.sep).join('/'));
const miss = web.filter((f) => !assets.has(f)), gone = [...assets].filter((a) => a !== './' && !fs.existsSync(path.join(root, a)));
if (miss.length || gone.length) { bad++; console.log('not in ASSETS: ' + miss.join(', ') + (gone.length ? ' | listed but missing: ' + gone.join(', ') : '')); }
console.log(`${miss.length || gone.length ? 'FAIL' : 'ok  '} sw.js ASSETS lists every web file`);
// 3. the tests
for (const t of ['browser-test', 'clipview-test', 'pattern-test', 'header-test', 'combine-test', 'dsp-quality-test', 'presets-test', 'drumrack-test']) run(t, ['tools/' + t + '.mjs']);
run('drum-punch (drum kit + DirectWave: level, transient, punch on small speakers)', ['tools/drum-punch.mjs', '--check']);
run('click-test (mute / solo / send / voice steal: no clicks)', ['tools/click-test.mjs', '--check']);
run('alias-test (synth oscillators: aliasing below -80 dB)', ['tools/alias-test.mjs', '--check']);
run('fx-test (every effect: no dummy parameters, no NaN)', ['tools/fx-test.mjs']);
run('inst-test (every Live 12 instrument: no dummy parameters, no NaN)', ['tools/inst-test.mjs']);
// 4. wavetable tables: sliced build must equal the all-at-once build
const h = (m) => { const r = run('tables-test ' + m, ['tools/tables-test.mjs', m]); return ((r.stdout || '').match(/hash (\w+)/) || [])[1]; };
const a = h('sync'), b = h('sliced');
if (!a || a !== b) { bad++; console.log(`FAIL tables sync ${a} != sliced ${b}`); } else console.log('ok   tables sync == sliced (' + a + ')');
console.log(bad ? `\n${bad} FAILED` : '\nALL TESTS PASSED');
process.exit(bad ? 1 : 0);
