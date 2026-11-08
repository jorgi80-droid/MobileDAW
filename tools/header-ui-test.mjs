// Track header column in the real app (Chromium, Pixel 7 landscape): tap a header = fold to its title bar, tap again = open with every control
// (monitor, output, volume / pan, sends); the header column's width follows a drag on its left edge and a double tap resets it; Output row menu;
// narrow column draws only title + meter.   Usage: node tools/header-ui-test.mjs   (needs Playwright + Chromium; not part of run-tests)
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
await ev(() => { window.__el = () => [...document.querySelectorAll('#arr canvas')].pop(); });
const ptr = (type, x, y, id = 7) => ev(async ([type, x, y, id]) => { const k = (await import('./js/uiscale.js')).emuK(); window.__el().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x * k, clientY: y * k, buttons: type === 'pointerup' ? 0 : 1 })); }, [type, x, y, id]);
const tap = async (x, y) => { await ptr('pointerdown', x, y); await wait(40); await ptr('pointerup', x, y); await wait(120); };
const info = (i) => ev(async (i) => { const T = await import('./js/timeline.js'), P = await import('./js/project.js'), r = window.__el().getBoundingClientRect(), q = T.probe(0, i), t = P.state.tracks[i]; return { x: r.x, w: r.width, top: r.y + q.top, mid: q.y, head: T.headWidth(), fold: !!t.fold, hx: t.hx || 0, rowH: T.view.rowH, h: (T.probe(0, i + 1).top - q.top) }; }, i);
const tapH = async (i, dx, dy) => { const q = await info(i); await tap(q.x + q.w - q.head + dx, q.top + dy); };   // the arrangement can change width when the selection changes: always measure again
const menuTexts = () => ev(() => [...document.querySelectorAll('#layer .menu:not(.closing) .mi')].map((e) => e.textContent));
const closeAll = () => ev(async () => (await import('./js/ui.js')).closeAll());

await ev(async () => { const P = await import('./js/project.js'); P.newProject(false); P.addTrack('midi'); P.addTrack('midi'); P.addTrack('drum'); P.state.sel.track = 1; P.emit('all'); });
await wait(500);

// ---- tap = fold / open with every control
let a = await info(0);
ok(!a.fold && a.h >= 60 && a.h < 100, 'start: track 0 open at the normal height (' + a.h.toFixed(0) + ' px)');
await tapH(0, 60, 9); await wait(500);                                  // the title bar, clear of the fold triangle
a = await info(0);
ok(a.fold && a.h < 30, 'tap on the header folds it to the title bar (' + a.h.toFixed(0) + ' px)');
await tapH(0, 60, 9); await wait(600);
a = await info(0);
ok(!a.fold && a.h >= 110, 'tap again opens it tall enough for every control (' + a.h.toFixed(0) + ' px)');
// a button inside the header does not fold it: "S" (solo) sits at the second slot of the button row
await ev(async () => { (await import('./js/project.js')).state.tracks[0].solo = false; });
await tapH(0, 5 + 25 + 11, 20 + 5 + 9); await wait(200);
a = await info(0);
ok(!a.fold && await ev(async () => (await import('./js/project.js')).state.tracks[0].solo === true), 'tapping the Solo button toggles solo and does not fold');
await tapH(0, 5 + 25 + 11, 20 + 5 + 9); await wait(150);
// the Output row exists in the tall row; tapping it opens the routing menu
await tapH(0, 40, 20 + 5 + 19 + 26 + 8 + ((await ev(async () => (await import('./js/project.js')).state.returns.length >= 2)) ? 21 : 0)); await wait(350);
let m = await menuTexts();
ok(m.includes('Master'), 'Output row opens the routing menu (' + m.slice(0, 3).join(' | ') + ')');
await closeAll(); await wait(200);
// the long-press menu still works and offers the width choices
// ---- header column width
a = await info(0); const w0 = a.head;
const ex = a.x + a.w - w0;                                              // the left edge of the header column
await ptr('pointerdown', ex, a.top + 40); for (let k = 1; k <= 8; k++) { await ptr('pointermove', ex - k * 8, a.top + 40); await wait(16); } await ptr('pointerup', ex - 64, a.top + 40); await wait(250);
const w1 = (await info(0)).head;
ok(w1 > w0 + 40, `dragging the edge to the left widens the column (${w0} -> ${w1})`);
ok(await ev(async () => (await import('./js/prefs.js')).prefs.headW) === w1, 'the width is remembered in the preferences');
const ex1 = a.x + a.w - w1;
await ptr('pointerdown', ex1, a.top + 40); for (let k = 1; k <= 12; k++) { await ptr('pointermove', ex1 + k * 10, a.top + 40); await wait(16); } await ptr('pointerup', ex1 + 120, a.top + 40); await wait(250);
const w2 = (await info(0)).head;
ok(w2 < w1 - 60, `dragging right narrows it (${w1} -> ${w2})`);
ok(await ev(async () => { const T = await import('./js/timeline.js'); T.setHeadW(5); return T.headWidth(); }) >= 56 && await ev(async () => { const T = await import('./js/timeline.js'); T.setHeadW(900); return T.headWidth(); }) <= 260, 'the width is clamped (56..260)');
// compact (narrow) column: draws without errors, tap on it still folds
await ev(async () => (await import('./js/timeline.js')).setHeadW(70)); await wait(300);
a = await info(1); ok(a.head === 70, 'column set to 70 px (compact: title + meter only)');
await tapH(1, 24, 9); await wait(500);
ok((await info(1)).fold !== a.fold, 'tap folds / opens in the compact column too');
// double tap on the edge: back to the automatic width
const ex2 = a.x + a.w - 70;
await tap(ex2, a.top + 40); await tap(ex2, a.top + 40); await wait(300);
const w3 = (await info(0)).head;
ok(w3 > 100 && await ev(async () => (await import('./js/prefs.js')).prefs.headW) === 0, `double tap on the edge resets to automatic (${w3} px)`);
// the long-press menu offers width choices
await ev(async () => (await import('./js/timeline.js')).setHeadW(0)); await wait(200);
a = await info(0);
await ptr('pointerdown', a.x + a.w - 40, a.top + 9); await wait(560); await ptr('pointerup', a.x + a.w - 40, a.top + 9); await wait(420);
m = await menuTexts(); ok(m.includes('Lipat track') || m.includes('Buka track'), 'long-press menu: fold / open item (' + m.filter((z) => /track/i.test(z)).join(', ') + ')');
ok(m.some((z) => z.startsWith('Lebar kolom track')), 'long-press menu: "Lebar kolom track…"');
await closeAll();
ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nHEADER UI: all passed');
process.exit(bad ? 1 : 0);
