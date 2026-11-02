// Floating-window plugin UI in the real app (Chromium, landscape phone). The owner's rule: every plugin lives in a floating window, and
// when the window is minimised the device card in the rack shows "Klik Tampilkan untuk menampilkan plugin" with a Tampilkan button.
// Checks: default pref on -> inline card is a launcher (not the full panel); Tampilkan opens the window; minimise -> the exact message +
// fl-min; Tampilkan restores it; turning the pref off -> the full panel is shown inline again.
// Usage: node tools/float-ui-test.mjs   (needs Playwright + Chromium; not part of run-tests)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const VW = +(process.env.VW || 910), VH = +(process.env.VH || 414);
const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true })));   // no v field -> migration turns floatPlugins on (default)
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(800);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const ev = (f, a) => page.evaluate(f, a);

// a MIDI track with an instrument, then open the Device tab
await ev(async () => { const P = await import('./js/project.js'); P.newProject(true); P.addTrack('midi'); P.setInstrument(P.state.tracks.length - 1, 32); P.selectTrack(P.state.tracks.length - 1); });
await page.waitForTimeout(300);
await ev(() => document.querySelector('#dtabs .b[data-tab="dev"]').click());
await page.waitForTimeout(400);

ok(await ev(async () => (await import('./js/prefs.js')).prefs.floatPlugins === true), 'default pref floatPlugins is on (in-memory after migration)');
const launcher = () => ev(() => { const c = document.querySelector('.dev-scroll .card.floated'); return c ? { msg: (c.querySelector('.fl-msg') || {}).textContent || '', min: c.classList.contains('fl-min'), btns: [...c.querySelectorAll('.fl-btns .b')].map((b) => b.textContent), panel: !!c.querySelector('.lk, .flm-pg') } : null; });
let L = await launcher();
ok(L && !L.panel && /jendela mengambang/.test(L.msg) && L.btns.includes('Tampilkan'), 'plugin on: inline shows a launcher card (no full panel) with Tampilkan');
ok(await ev(() => !document.querySelector('.dev-scroll .lkcard, .dev-scroll .lvcard')), 'plugin on: the full instrument panel is NOT inline');

// Tampilkan -> a floating window opens
await ev(() => [...document.querySelectorAll('.dev-scroll .card.floated .fl-btns .b')].find((b) => b.textContent === 'Tampilkan').click());
await page.waitForTimeout(400);
ok(await ev(() => !!document.querySelector('#fwlayer .fw:not([hidden])')), 'Tampilkan opens a floating window with the plugin panel');
ok(await ev(() => !!document.querySelector('#fwlayer .fw .lk, #fwlayer .fw .flm-pg')), 'the floating window holds the real instrument panel');
L = await launcher();
ok(L && /Terbuka di jendela mengambang/.test(L.msg) && L.btns.includes('Tutup'), 'while open the card says "Terbuka di jendela mengambang" + Tutup');

// minimise -> the owner's exact message + fl-min + a tray chip
await ev(() => document.querySelector('#fwlayer .fw .fw-mn').click());
await page.waitForTimeout(400);
L = await launcher();
ok(L && L.min && L.msg === 'Klik Tampilkan untuk menampilkan plugin.', 'minimised: card shows exactly "Klik Tampilkan untuk menampilkan plugin." with the fl-min cue');
ok(await ev(() => !!document.querySelector('#fwlayer .fw-tray .fw-chip')), 'minimised: a chip appears in the tray');
ok(await ev(() => { const w = document.querySelector('#fwlayer .fw'); return !!w && w.hidden; }), 'minimised: the window itself is hidden');

// Tampilkan restores it
await ev(() => [...document.querySelectorAll('.dev-scroll .card.floated .fl-btns .b')].find((b) => b.textContent === 'Tampilkan').click());
await page.waitForTimeout(400);
ok(await ev(() => { const w = document.querySelector('#fwlayer .fw'); return !!w && !w.hidden; }), 'Tampilkan from the minimised card brings the window back');
L = await launcher();
ok(L && !L.min, 'restored: the card is no longer in the minimised state');

// turn the pref off -> the full panel is inline again, no floated launcher
await ev(async () => { const FW = await import('./js/floatwin.js'); FW.closeAllFloats(); const { prefs, savePrefs } = await import('./js/prefs.js'); const P = await import('./js/project.js'); prefs.floatPlugins = false; savePrefs(); P.emit('devices'); });
await page.waitForTimeout(400);
ok(await ev(() => !!document.querySelector('.dev-scroll .lkcard, .dev-scroll .lvcard') && !document.querySelector('.dev-scroll .card.floated')), 'pref off: the full instrument panel is shown inline again (no launcher)');

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nFLOAT UI: all passed');
process.exit(bad ? 1 : 0);
