// MobileDAW 2 (app2/): rebuilds app2/sw.js's file list (every web file of app2/) and its cache name (a hash of those files).
// Run after any change in app2/: node tools/app2-build.mjs   (1.0 keeps its own: node tools/build.mjs)
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app2');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = ['index.html', 'manifest.json', ...['css', 'js', 'icons'].flatMap((d) => walk(path.join(app, d)).map((f) => path.relative(app, f).split(path.sep).join('/')))].sort();
const h = crypto.createHash('sha256'); for (const f of files) { h.update(f); h.update(fs.readFileSync(path.join(app, f))); }
const name = 'mobiledaw2-' + h.digest('hex').slice(0, 12);
let sw = fs.readFileSync(path.join(app, 'sw.js'), 'utf8');
sw = sw.replace(/const CACHE = '[^']*';/, `const CACHE = '${name}';`).replace(/const ASSETS = \[.*?\];/, 'const ASSETS = ' + JSON.stringify(['./', ...files.map((f) => './' + f)]) + ';');
fs.writeFileSync(path.join(app, 'sw.js'), sw); console.log(name, files.length + ' files');
