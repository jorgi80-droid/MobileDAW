// Recomputes the CACHE name in sw.js from the content of every file listed in ASSETS (run after any change: node tools/build.mjs)
import fs from 'node:fs'; import crypto from 'node:crypto';
let sw = fs.readFileSync('sw.js', 'utf8');
const assets = JSON.parse(sw.match(/const ASSETS = (\[.*?\]);/)[1]), h = crypto.createHash('sha256');
for (const a of assets.filter((x) => x !== './').sort()) { h.update(a); h.update(fs.readFileSync(a.slice(2))); }
const name = 'mobiledaw-' + h.digest('hex').slice(0, 12);
sw = sw.replace(/const CACHE = '[^']*';/, `const CACHE = '${name}';`); fs.writeFileSync('sw.js', sw); console.log(name);
