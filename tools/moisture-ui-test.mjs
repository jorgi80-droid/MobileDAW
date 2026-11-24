// Moisture (instrument 37) window: every page keeps the same window size (one scale), the FX page shows only the effects in use,
// + Tambah FX adds one from a menu, × removes it, MATRIX lists all routes in two columns; landscape phone; no page errors.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium, devices } = createRequire(import.meta.url)('playwright');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
await new Promise((o) => server.once('listening', o));
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await b.newContext({ ...devices['Pixel 7 landscape'] })).newPage(), errs = [];
page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, tutorialOffered: true, fullscreen: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted); await page.waitForTimeout(800);
await page.evaluate(async () => { const P = await import('./js/project.js'), D = await import('./js/devices.js'); P.newProject(false); P.addTrack('midi'); P.setInstrument(0, 37); P.selectTrack(0); D.openInstWindow(P.state.tracks[0].id); });
await page.waitForSelector('.fw .m2x'); await page.waitForTimeout(500);
const tab = async (q) => { await page.evaluate((q) => document.querySelectorAll('.fw .m2x-pt')[q].click(), q); await page.waitForTimeout(250); };
const geo = []; for (let q = 0; q < 4; q++) { await tab(q); geo.push(await page.evaluate(() => { const r = document.querySelector('.fw .m2x').getBoundingClientRect(), f = document.querySelector('.fw').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(f.width), Math.round(f.height), f.right <= innerWidth + 1 && f.bottom <= innerHeight + 1]; })); }
ok(geo.every((g) => g[0] === geo[0][0] && g[1] === geo[0][1] && g[4]), `every page the same size, window inside the screen (${geo.map((g) => g[0] + 'x' + g[1]).join(' ')})`);
await tab(1);
const fxNames = () => page.evaluate(() => [...document.querySelectorAll('.fw .m2x-fx .m2x-fxh b')].map((x) => x.textContent));
const f0 = await fxNames();
await page.evaluate(() => document.querySelector('.fw .m2x-fxadd').click()); await page.waitForTimeout(500);
await page.evaluate(() => [...document.querySelectorAll('.menu .mi')].find((x) => x.textContent.trim() === 'DELAY').click()); await page.waitForTimeout(250);
const f1 = await fxNames(), on1 = await page.evaluate(async () => (await import('./js/project.js')).state.tracks[0].inst.params[158]);
ok(f0.length === 0 && f1.join() === 'DELAY' && on1 === 1, `FX: none shown by default (${f0.length}); + Tambah FX -> ${f1.join(', ')} (its switch ${on1})`);
ok(await page.evaluate(() => document.querySelectorAll('.fw .m2x-fx .m2x-k').length) >= 5, 'FX: the added effect shows its knobs');
await page.evaluate(() => document.querySelector('.fw .m2x-fx .m2x-fxx').click()); await page.waitForTimeout(250);
const f2 = await fxNames(), on2 = await page.evaluate(async () => (await import('./js/project.js')).state.tracks[0].inst.params[158]);
ok(f2.length === 0 && on2 === 0, `FX: × removes it (${f2.length} shown, switch ${on2})`);
await tab(2);
const mx = await page.evaluate(() => [...document.querySelectorAll('.fw .m2x-mxw > .m2x-mx')].map((c) => c.querySelectorAll('.m2x-mxn').length));
ok(mx.length === 2 && mx[0] + mx[1] >= 16, `MATRIX: two columns (${mx.join(' + ')} routes)`);
ok(!errs.length, `no page errors ${errs.slice(0, 2).join(' | ')}`);
console.log(bad ? bad + ' FAILED' : 'moisture UI: all passed'); await b.close(); server.close(); process.exit(bad ? 1 : 0);
