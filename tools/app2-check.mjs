// MobileDAW 2 (app2/): node --check on every script and app2/sw.js lists exactly app2's web files (run node tools/app2-build.mjs after changes).
// Usage: node tools/app2-check.mjs   (part of tools/run-tests.mjs)
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app2');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const js = [...walk(path.join(app, 'js')).filter((f) => /\.m?js$/.test(f)), path.join(app, 'sw.js')];
const broken = js.filter((f) => { try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); return false; } catch (_) { return true; } });
ok(!broken.length, `node --check on ${js.length} app2 files` + (broken.length ? ': ' + broken.map((f) => path.relative(app, f)).join(', ') : ''));
const listed = JSON.parse(fs.readFileSync(path.join(app, 'sw.js'), 'utf8').match(/const ASSETS = (\[.*?\]);/)[1]).filter((a) => a !== './').map((a) => a.slice(2)).sort();
const real = ['index.html', 'manifest.json', ...['css', 'js', 'icons'].flatMap((d) => walk(path.join(app, d)).map((f) => path.relative(app, f).split(path.sep).join('/')))].sort();
ok(JSON.stringify(listed) === JSON.stringify(real), 'app2/sw.js ASSETS lists every app2 web file' + (JSON.stringify(listed) === JSON.stringify(real) ? '' : ' (run node tools/app2-build.mjs)'));
console.log(bad ? `\n${bad} FAILED` : '\nAPP2 CHECK OK'); process.exit(bad ? 1 : 0);
