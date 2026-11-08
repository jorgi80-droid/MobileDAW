// Track header column in the real app (Chromium, Pixel 7 landscape), laid out as in Live: a tap on a header switches the column between FULL (narrow coloured
// name column + wide grey mixer column: activator, S, arm, volume, pan, sends, output) and COMPACT (the coloured name block
// only); each look keeps its own width (drag the left edge, double tap = automatic); the triangle still folds one track.   Usage: node tools/header-ui-test.mjs   (needs Playwright + Chromium; not part of run-tests)
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


const hd = async (i) => { const q = await info(i); return { ...q, nw: Math.max(76, Math.round((q.head - 9) * 0.3)) }; };
await ev(async () => { const P = await import('./js/project.js'); P.state.tracks[0].mon = undefined; });
let a = await hd(0);
const full = () => ev(async () => (await import('./js/timeline.js')).headIsFull());
ok(await full() && a.head >= 230 && a.h === 72, `start: FULL column (${a.head} px), normal row`);

// ---- the colour column holds only the name; every control is in the wide mixer column of the 72 px row (right-aligned)
const pr = await ev(async () => { const T = await import('./js/timeline.js'), P = await import('./js/project.js'); return { n: P.state.returns.length }; });
ok(a.nw < a.head * 0.45, `the colour column is narrow (${a.nw} of ${a.head} px): name only, no In / Auto / Off`);
// Monitor modes still exist (long-press menu); Auto sounds only while armed; undo returns the previous mode
await ev(async () => { const P = await import('./js/project.js'); P.setMonitor(0, 'off'); P.setMonitor(0, 'auto'); });
ok(await ev(async () => { const P = await import('./js/project.js'), t = P.state.tracks[0]; t.arm = false; const a0 = P.monSounds(t); t.arm = true; const a1 = P.monSounds(t); t.arm = false; return P.monMode(t) === 'auto' && !a0 && a1; }), 'Monitor Auto sounds only while the track is armed');
await ev(async () => (await import('./js/history.js')).undoOp()); await wait(200);
ok(await ev(async () => { const P = await import('./js/project.js'); return P.monMode(P.state.tracks[0]); }) === 'off', 'one undo returns Monitor to the previous mode');
await ev(async () => (await import('./js/project.js')).setMonitor(0, 'in'));
await tapH(0, a.head - 9 - 4 - 14, 51 + 9); await wait(350);   // the Output field: right cell of the last row of the mixer column
let m = await menuTexts();
ok(m.includes('Master'), 'Output field (mixer column) opens the routing menu (' + m.slice(0, 3).join(' | ') + ')');
await closeAll(); await wait(200);
// the mixer column: Solo is the 2nd square of the first row
await ev(async () => { (await import('./js/project.js')).state.tracks[0].solo = false; });
await tapH(0, a.nw + 4 + 25 + 11, 2 + 9); await wait(200);
ok(await ev(async () => (await import('./js/project.js')).state.tracks[0].solo === true) && await full(), 'Solo button in the mixer column toggles solo and does not switch the look');
await tapH(0, a.nw + 4 + 25 + 11, 2 + 9); await wait(150);

// ---- sliders: wide, relative drag, and fine control when the finger moves away from the slider
{
  a = await hd(0); const volW = Math.round((a.head - 9 - a.nw - 8 - 3) * 0.6);
  ok(volW >= 120, `the volume slider is wide (${volW} px)`);
  const vol = () => ev(async () => (await import('./js/project.js')).state.tracks[0].vol);
  const sl = async (dy, dxs) => { const q = await hd(0), x0 = q.x + q.w - q.head + q.nw + 4 + 20, y0 = q.top + 36; await ptr('pointerdown', x0, y0); for (let k = 1; k <= 8; k++) { await ptr('pointermove', x0 + dxs * k / 8, y0 + dy * k / 8); await wait(16); } await ptr('pointerup', x0 + dxs, y0 + dy); await wait(150); };
  await ev(async () => (await import('./js/project.js')).setVol(0, 0.5)); const v0 = await vol();
  await sl(0, 20); const v1 = await vol();
  await ev(async () => (await import('./js/project.js')).setVol(0, 0.5));
  await sl(60, 20); const v2 = await vol();
  ok(Math.abs(v1 - v0) > 0.01 && v1 !== v0, `relative drag: 20 px moves the volume from where it was (${v0} -> ${v1.toFixed(3)}), no jump to the finger`);
  ok(Math.abs(v2 - 0.5) > 0 && Math.abs(v2 - 0.5) < Math.abs(v1 - 0.5) * 0.5, `finger moved away from the slider = fine control (${Math.abs(v1 - 0.5).toFixed(3)} vs ${Math.abs(v2 - 0.5).toFixed(3)})`);
}

// ---- tap on the header body: FULL <-> COMPACT
await tapH(0, 60, 9); await wait(450);
a = await hd(0);
ok(!(await full()) && a.head < 130 && a.h === 72, `tap on the header body switches to COMPACT: name block only, the timeline is wider (${a.head} px)`);
await tapH(0, 40, 9); await wait(450);
a = await hd(0);
ok(await full() && a.head >= 150, `tap again: back to FULL (${a.head} px)`);

// ---- the triangle folds one track to its title bar
await tapH(0, 12, 9); await wait(500);
a = await hd(0); ok(a.fold && a.h < 30 && await full(), 'the triangle folds just that track (' + a.h.toFixed(0) + ' px)');
await tapH(0, 12, 9); await wait(500);
ok(!(await hd(0)).fold, 'and opens it again');

// ---- widths: each look has its own
a = await hd(0); const wFull0 = a.head;
const drag = async (dxs) => { a = await hd(0); const ex = a.x + a.w - a.head; await ptr('pointerdown', ex, a.top + 40); for (let k = 1; k <= 10; k++) { await ptr('pointermove', ex + dxs * k / 10, a.top + 40); await wait(16); } await ptr('pointerup', ex + dxs, a.top + 40); await wait(250); return (await hd(0)).head; };
const wFull1 = await drag(-60);
ok(wFull1 > wFull0 + 40, `dragging the edge left widens the FULL column (${wFull0} -> ${wFull1})`);
ok(await ev(async () => (await import('./js/prefs.js')).prefs.headW) === wFull1, 'the FULL width is remembered');
await ev(async () => (await import('./js/timeline.js')).setHeadFull(false)); await wait(300);
const wC0 = (await hd(0)).head;
ok(wC0 < 130 && wC0 !== wFull1, `COMPACT has its own width (${wC0} px)`);
const wC1 = await drag(-40);
ok(wC1 > wC0 + 20 && await ev(async () => (await import('./js/prefs.js')).prefs.headWc) === wC1, `dragging widens the COMPACT column independently (${wC0} -> ${wC1})`);
ok(await ev(async () => { const T = await import('./js/timeline.js'); T.setHeadW(5); const lo = T.headWidth(); T.setHeadW(900); return lo >= 56 && T.headWidth() <= 160; }), 'COMPACT width is clamped (56..160)');
a = await hd(0); const ex2 = a.x + a.w - a.head;
await tap(ex2, a.top + 40); await tap(ex2, a.top + 40); await wait(300);
ok(await ev(async () => (await import('./js/prefs.js')).prefs.headWc) === 0 && (await hd(0)).head < 110, 'double tap on the edge resets the COMPACT width to automatic');
await ev(async () => { const T = await import('./js/timeline.js'); T.setHeadFull(true); }); await wait(300);
ok(await ev(async () => { const T = await import('./js/timeline.js'); T.setHeadW(5); const lo = T.headWidth(); T.setHeadW(900); const hi = T.headWidth(); T.setHeadW(0); return lo >= 150 && hi <= 460; }), 'FULL width is clamped (150..460)');

// ---- default control size: a taller row keeps finger-sized controls (no giant sliders); the Output field stays at the end of the third row
{
  await ev(async () => { const P = await import('./js/project.js'); P.state.tracks[0].hx = 2.4; P.state.tracks[0].fold = false; P.emit('all'); }); await wait(500);
  const q = await hd(0); ok(q.h > 160, `row 0 is tall (${q.h.toFixed(0)} px)`);
  await tapH(0, q.head - 9 - 4 - 14, 91 + 9); await wait(350);
  const mm = await menuTexts(); ok(mm.includes('Master'), 'tall row: controls keep their default size (Output cell at the third row, not stretched to the bottom)');
  await closeAll(); await wait(200);
  await ev(async () => { const P = await import('./js/project.js'); delete P.state.tracks[0].hx; P.emit('all'); }); await wait(300);
}

// ---- long-press menu
a = await hd(0);
await ptr('pointerdown', a.x + a.w - 40, a.top + 9); await wait(560); await ptr('pointerup', a.x + a.w - 40, a.top + 9); await wait(420);
m = await menuTexts(); ok(m.includes('Lipat track') || m.includes('Buka track'), 'long-press menu: fold item');
ok(m.some((z) => z.startsWith('Lebar kolom track')) && m.some((z) => z.startsWith('Monitor input: ')), 'long-press menu: column width + monitor items');
await closeAll();
ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nHEADER UI: all passed');
process.exit(bad ? 1 : 0);
