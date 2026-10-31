// Per-frame render cost of the main views (arrangement, piano roll, mixer) while the transport plays, for before / after comparisons of UI work.
// Every requestAnimationFrame callback is timed; reports mean / p95 / max ms of main-thread work per frame and the fps reached.
// Usage: node tools/ui-perf.mjs [seconds per view]      env: VW / VH = viewport (default 1180 x 560), THEME
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), secs = +(process.argv[2] || 3);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const browser = await chromium.launch({ args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await (await browser.newContext({ viewport: { width: +(process.env.VW || 1180), height: +(process.env.VH || 560) }, deviceScaleFactor: 2 })).newPage();
await page.addInitScript((th) => {
  try { localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, theme: th })); } catch (_) { /* no storage */ }
  const raf = window.requestAnimationFrame.bind(window); window.__fr = [];
  window.requestAnimationFrame = (cb) => raf((ts) => { const t0 = performance.now(); cb(ts); window.__fr.push([t0, performance.now() - t0]); });
}, process.env.THEME || 'dark');
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 });
await page.evaluate(async () => {                          // a dense project: 8 tracks x 16 bars of notes
  const P = await import('./js/project.js'); P.newProject(true); const BAR = P.BAR;
  for (let k = 0; k < 7; k++) { P.addTrack('midi'); const i = P.state.tracks.length - 1; for (let b = 0; b < 16; b += 4) { const c = P.addClip(i, b * BAR, 4 * BAR); for (let n = 0; n < 64; n++) c.notes.push({ t: n * 240, d: 200, p: 48 + ((n * 7 + k * 5) % 24), v: 0.8 }); } }
  P.addDevice(1, 2); P.addDevice(1, 4); P.syncAll(); P.emit('all');
});
await page.waitForTimeout(800);
const ev = (fn, a) => page.evaluate(fn, a);
const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
async function measure(name, setup) {
  await ev(setup); await page.waitForTimeout(400);
  await ev(async () => { (await import('./js/project.js')).play(); window.__fr = []; });
  const m0 = await metrics();
  await page.waitForTimeout(secs * 1000);
  const m1 = await metrics(), dm = (k) => (m1[k] - m0[k]) * 1000;
  const fr = await ev(async () => { (await import('./js/project.js')).stop(); return window.__fr; });
  const by = new Map(); for (const [t, d] of fr) by.set(Math.round(t * 10), (by.get(Math.round(t * 10)) || 0) + d);   // callbacks of one frame share t0 within 0.1 ms
  const d = [...by.values()].sort((a, b) => a - b), n = d.length, mean = d.reduce((a, b) => a + b, 0) / (n || 1);
  const span = fr.length ? (fr[fr.length - 1][0] - fr[0][0]) / 1000 : 1;
  const row = { view: name, frames: n, fps: +(n / span).toFixed(0), meanMs: +mean.toFixed(2), p95Ms: +(d[Math.floor(n * 0.95)] || 0).toFixed(2), maxMs: +(d[n - 1] || 0).toFixed(2), styleLayoutMsPerFrame: +((dm('RecalcStyleDuration') + dm('LayoutDuration')) / (n || 1)).toFixed(3), scriptMsPerFrame: +(dm('ScriptDuration') / (n || 1)).toFixed(3) };
  console.log(JSON.stringify(row)); return row;
}
const rows = [];
rows.push(await measure('arrangement', () => document.querySelector('.seg .b[data-view="arr"]').click()));
rows.push(await measure('pianoroll', async () => { const P = await import('./js/project.js'); P.selectTrack(1); P.selectClip(1, P.state.tracks[1].clips[0].id); (await import('./js/timeline.js')).openEditor(); }));
rows.push(await measure('device', () => document.querySelector('#dtabs .b[data-tab="dev"]').click()));
rows.push(await measure('mixer', () => document.querySelector('.seg .b[data-view="mix"]').click()));
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(rows, null, 1));
await browser.close(); server.close();
