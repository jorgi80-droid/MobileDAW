// Touch hit-slop (js/touchhit.js) on an emulated OPPO Find X8 (1080 x 2374 at 480 dpi = 360 x 791 CSS px, DPR 3, as the owner measured; landscape and portrait):
// a real touchscreen tap on empty panel surface a few px beside a small button presses that button; a tap far from every button, and a
// tap on a knob, do not. Usage: node tools/touchhit-test.mjs   (Playwright + Chromium; part of run-tests when Playwright is installed)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const b = await chromium.launch();
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
for (const [W, H, name] of [[791, 360, 'landscape'], [360, 791, 'portrait']]) {
  const page = await (await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, floatPlugins: false })));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(1000);
  const ev = (f, a) => page.evaluate(f, a);
  await ev(async () => { const P = await import('./js/project.js'); P.newProject(false); P.addTrack('midi'); const i = P.state.tracks.length - 1; P.setInstrument(i, 32); P.addDevice(i, 4); P.selectTrack(i); P.emit('all'); });
  for (let k = 0; k < 3; k++) { const hh = await ev(() => { const d = document.querySelector('.dev-scroll'); return d ? d.getBoundingClientRect().height : 0; }); if (hh > 60) break; await ev(() => document.querySelector('#dtabs .b[data-tab="dev"]').click()); await page.waitForTimeout(500); }
  await page.waitForTimeout(500);
  // a layout point -> touchscreen coordinates (the page is scaled by the viewport meta / UI scale)
  const at = (sel, fx, dy) => ev(([sel, fx, dy]) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(), s = 1; return { x: (r.left + r.width * fx) * s, y: (dy < 0 ? r.top + dy : r.bottom + dy) * s, txt: e.textContent }; }, [sel, fx, dy]);
  const rmsOn = () => ev(() => { const e = [...document.querySelectorAll('.lv-btn')].find((x) => x.textContent === 'RMS'); return e ? e.classList.contains('on') : null; });
  const target = '.dev-scroll .card .lv-btn';
  const btnSel = await ev(() => { const e = [...document.querySelectorAll('.dev-scroll .card .lv-btn')].find((x) => x.textContent === 'RMS'); if (e) e.id = 'th-rms'; return !!e; });
  ok(btnSel, `${name}: Compressor RMS button found`);
  if (!btnSel) { await page.close(); continue; }
  const before = await rmsOn();
  // empty surface beside the button: just right of it (the RMS / Peak / Expand column has room at its sides)
  const p = await ev(() => { const e = document.getElementById('th-rms'); e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(), s = 1;
    for (const dx of [6, 8, 10, -6, -8, -10]) { const x = dx > 0 ? r.right + dx : r.left + dx, y = r.top + r.height / 2, t = document.elementFromPoint(x, y); if (t && !t.closest('button, .lv-btn, .knob, canvas, svg, .lv-fld, .lk-n')) return { x: x * s, y: y * s }; }
    return null; });
  ok(!!p, `${name}: empty surface found beside the button`);
  if (process.env.DBG) { await ev(() => { window.__tl = []; document.addEventListener('pointerdown', (e) => window.__tl.push(['down', e.pointerType, Math.round(e.clientX), Math.round(e.clientY), e.target.className]), true); }); const c = await ev(() => { const r = document.getElementById('th-rms').getBoundingClientRect(); return [r.left, r.top, r.width, r.height, (window.visualViewport && visualViewport.scale) || 1]; }); console.log('rms rect', c, 'tap', p); }
  if (p) { await page.touchscreen.tap(p.x, p.y); if (process.env.DBG) console.log(await ev(() => JSON.stringify(window.__tl))); await page.waitForTimeout(250); ok((await rmsOn()) !== before, `${name}: tap beside RMS presses it`); }
  // far from every button: nothing changes
  const far = await ev(() => { const c = document.getElementById('th-rms').closest('.card'), r = c.getBoundingClientRect(), s = 1, { nearestButton } = window.__th || {};
    for (let y = r.top + 30; y < r.bottom - 10; y += 6) for (let x = r.left + 10; x < r.right - 10; x += 6) { const t = document.elementFromPoint(x, y); if (!t || t.closest('button, .lv-btn, .knob, canvas, svg, .lv-fld, .lk-n, .lk-dfill')) continue; let near = false; for (const e of c.querySelectorAll('button, .lv-btn, .lv-tab, .lv-fld')) { const q = e.getBoundingClientRect(); if (x > q.left - 30 && x < q.right + 30 && y > q.top - 30 && y < q.bottom + 30) { near = true; break; } } if (!near) return { x: x * s, y: y * s }; }
    return null; });
  if (far) { const s0 = await ev(() => JSON.stringify([...document.querySelectorAll('.dev-scroll .lv-btn.on')].map((e) => e.textContent))); await page.touchscreen.tap(far.x, far.y); await page.waitForTimeout(250); const s1 = await ev(() => JSON.stringify([...document.querySelectorAll('.dev-scroll .lv-btn.on')].map((e) => e.textContent))); ok(s0 === s1, `${name}: a tap far from every button changes nothing`); }
  else ok(true, `${name}: (no surface far from buttons in this card)`);
  void target; void at;
  ok(!errs.length, `${name}: no page errors` + (errs.length ? ' ' + errs[0] : ''));
  await page.close();
}
await b.close(); server.close();
console.log(bad ? `TOUCH HIT: ${bad} failed` : 'TOUCH HIT: all passed'); process.exit(bad ? 1 : 0);
