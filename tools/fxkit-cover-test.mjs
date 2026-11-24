// Live 12 panels of Roar / Autoduck / Stereolizer / Spacer / Tape Stop in the real app: every parameter has a control.   Usage: node tools/fxkit-cover-test.mjs (Playwright; not part of run-tests)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const b = await chromium.launch(); const page = await (await b.newContext({ ...devices['Pixel 7 landscape'] })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, floatPlugins: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(1500);
const ev = (f, a) => page.evaluate(f, a); const wait = (ms) => page.waitForTimeout(ms);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
// every parameter of the five panels built in this session has a control in the card (Roar, Autoduck, Stereolizer, Spacer, Tape Stop)
await ev(async () => { const P = await import('./js/project.js'); P.newProject(false); P.addTrack('midi'); P.state.sel.track = P.state.tracks.length - 1; P.emit('all'); document.querySelector('[data-tab="dev"], #dtabs .b')?.click(); });
await wait(500);
for (const k of [9, 10, 14, 15, 52]) {
  const r = await ev(async (k) => {
    const P = await import('./js/project.js'), D = await import('./js/defs.js'), i = P.state.tracks.length - 1; P.state.tracks[i].devices = []; P.addDevice(i, k); P.emit('all');
    await new Promise((f) => setTimeout(f, 400));
    const card = [...document.querySelectorAll('.dev-scroll > .card')].find((c) => c.textContent.includes(D.DEVICES[k].name));
    if (!card) return { err: 'no card' };
    const got = new Set(); for (const el of card.querySelectorAll('*')) if (el._k != null) got.add(el._k);
    if (k === 52) {                                                       // Sync off: the seconds dials replace the beat lists (Live: the Sync switch)
      P.setDeviceParam(i, 0, 1, 0); P.emit('devices'); await new Promise((f) => setTimeout(f, 400));
      const c2 = [...document.querySelectorAll('.dev-scroll > .card')].find((c) => c.textContent.includes(D.DEVICES[k].name)); for (const el of c2.querySelectorAll('*')) if (el._k != null) got.add(el._k);
    }
    const want = D.DEVICES[k].params.map((p, j) => j).filter((j) => !(k === 10 && j === 0));   // Autoduck source: its own Audio From button
    return { lk: card.classList.contains('lkcard'), miss: want.filter((j) => !got.has(j)).map((j) => D.DEVICES[k].params[j].n), src: k === 10 ? !!card.querySelector('.lk-src') : true };
  }, k);
  ok(r.lk && r.miss && !r.miss.length && r.src, `${k}: Live panel, every parameter has a control` + (r.miss && r.miss.length ? ' (missing: ' + r.miss.join(', ') + ')' : '') + (r.err || ''));
}
ok(!errs.length, 'no page errors ' + errs.join(' | '));
await b.close(); server.close(); console.log(bad ? bad + ' FAILED' : 'ALL OK'); process.exit(bad ? 1 : 0);
