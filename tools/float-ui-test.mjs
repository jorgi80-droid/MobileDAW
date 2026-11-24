// Floating-window modules in the real app (Chromium, landscape phone). Owner's rule: only a LARGE module (def.big, e.g. MiniMeters) opens
// in a floating window by default; instruments and modules that fit the rack card stay inline. When a floated window is minimised its rack
// card shows "Klik Tampilkan untuk menampilkan plugin" with a Tampilkan button. Any module can still be floated by hand (the ⧉ button).
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

// a MIDI track: MiniSynth instrument + a Delay (small) + a MiniMeters (big) in the chain; open the Device tab
await ev(async () => { const P = await import('./js/project.js'); P.newProject(true); P.addTrack('midi'); const i = P.state.tracks.length - 1; P.setInstrument(i, 32); P.addDevice(i, 6); P.addDevice(i, 16); P.selectTrack(i); });
await page.waitForTimeout(300);
await ev(() => document.querySelector('#dtabs .b[data-tab="dev"]').click());
await page.waitForTimeout(400);

ok(await ev(async () => (await import('./js/prefs.js')).prefs.floatPlugins === true), 'default pref floatPlugins is on');
const floated = () => ev(() => [...document.querySelectorAll('.dev-scroll .card.floated')].map((c) => ({ name: (c.querySelector('h4 span') || {}).textContent || '', msg: (c.querySelector('.fl-msg') || {}).textContent || '', min: c.classList.contains('fl-min') })));
let F = await floated();
ok(F.length === 1 && /MiniMeters/.test(F[0].name), 'only the big module (MiniMeters) is a floating launcher');
ok(await ev(() => !!document.querySelector('.dev-scroll .lkcard, .dev-scroll .lvcard')), 'the MiniSynth instrument panel is shown inline (not floated)');
ok(await ev(() => [...document.querySelectorAll('.dev-scroll .card')].some((c) => { const s = c.querySelector('h4 span'); return s && /Echo/.test(s.textContent) && !c.classList.contains('floated'); })), 'the small Echo effect is shown inline (not floated)');

// Tampilkan on the MiniMeters launcher -> its floating window opens
await ev(() => { const c = [...document.querySelectorAll('.dev-scroll .card.floated')].find((x) => /MiniMeters/.test((x.querySelector('h4 span') || {}).textContent || '')); c.querySelector('.fl-btns .b').click(); });
await page.waitForTimeout(400);
ok(await ev(() => !!document.querySelector('#fwlayer .fw:not([hidden])')), 'Tampilkan opens the MiniMeters floating window');

// minimise -> the owner's exact message + fl-min + a tray chip
await ev(() => document.querySelector('#fwlayer .fw .fw-mn').click());
await page.waitForTimeout(400);
F = await floated();
ok(F.length === 1 && F[0].min && F[0].msg === 'Klik Tampilkan untuk menampilkan plugin.', 'minimised: the card shows exactly "Klik Tampilkan untuk menampilkan plugin." with the fl-min cue');
ok(await ev(() => !!document.querySelector('#fwlayer .fw-tray .fw-chip')), 'minimised: a chip appears in the tray');

// Tampilkan restores it
await ev(() => { const c = [...document.querySelectorAll('.dev-scroll .card.floated')].find((x) => /MiniMeters/.test((x.querySelector('h4 span') || {}).textContent || '')); c.querySelector('.fl-btns .b').click(); });
await page.waitForTimeout(400);
ok(await ev(() => { const w = document.querySelector('#fwlayer .fw'); return !!w && !w.hidden; }), 'Tampilkan from the minimised card brings the window back');

// a small module can still be floated by hand (the ⧉ pop-out button on the Delay card)
await ev(() => { const c = [...document.querySelectorAll('.dev-scroll .card')].find((x) => { const s = x.querySelector('h4 span'); return s && /Echo/.test(s.textContent) && !x.classList.contains('floated'); }); c.querySelector('h4 .fw-pop').click(); });
await page.waitForTimeout(400);
ok(await ev(() => [...document.querySelectorAll('.dev-scroll .card.floated')].some((c) => /Echo/.test((c.querySelector('h4 span') || {}).textContent || ''))), 'a small module floats on demand via the pop-out button');

// pref off -> the big module is inline too (no floated launchers)
await ev(async () => { const FW = await import('./js/floatwin.js'); FW.closeAllFloats(); const { prefs, savePrefs } = await import('./js/prefs.js'); const P = await import('./js/project.js'); prefs.floatPlugins = false; savePrefs(); P.emit('devices'); });
await page.waitForTimeout(400);
ok(await ev(() => !document.querySelector('.dev-scroll .card.floated')), 'pref off: no module auto-floats (MiniMeters inline too)');

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nFLOAT UI: all passed');
process.exit(bad ? 1 : 0);
