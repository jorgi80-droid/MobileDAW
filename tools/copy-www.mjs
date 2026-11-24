// Copies the web app into www/ (Capacitor's webDir) for the Android build. The source files stay where they are; www/ is rebuilt from
// scratch every time and is not committed. Usage: node tools/copy-www.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.join(root, 'www');
const ITEMS = ['index.html', 'manifest.json', 'css', 'js', 'icons', 'demos'];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let files = 0, bytes = 0;
for (const it of ITEMS) {
  const src = path.join(root, it);
  if (!fs.existsSync(src)) { console.error('missing: ' + it); process.exit(1); }
  fs.cpSync(src, path.join(out, it), { recursive: true });
}
const count = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) count(p); else { files++; bytes += fs.statSync(p).size; } } };
count(out);
console.log(`www/: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
