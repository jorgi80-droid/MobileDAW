// MobileDAW 2: copies the app2/ web app (and the repository's demo songs) into app2/www/, Capacitor's webDir for the MobileDAW 2 Android
// app (com.mobiledaw.app2, app2/android). www/ is rebuilt every time and is not committed.
// Usage: node tools/app2-www.mjs && (cd app2 && npx cap sync android)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), app = path.join(root, 'app2'), out = path.join(app, 'www');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
for (const it of ['index.html', 'manifest.json', 'css', 'js', 'icons']) fs.cpSync(path.join(app, it), path.join(out, it), { recursive: true });
fs.cpSync(path.join(root, 'demos'), path.join(out, 'demos'), { recursive: true });   // the demo songs are shared with 1.0 (one copy in the repository)
let files = 0, bytes = 0; const count = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) count(p); else { files++; bytes += fs.statSync(p).size; } } };
count(out); console.log(`app2/www/: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
