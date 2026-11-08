// Sub-tracks in the real app (Chromium, Pixel 7 landscape): rows under a drum track, double tap = clip in that row, M = mute the row, menus.
// Usage: node tools/subtrack-ui-test.mjs   (needs Playwright + Chromium; not part of run-tests)   SHOT=file.png saves a screenshot
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
const geo = (i) => ev(async (i) => { const T = await import('./js/timeline.js'), r = window.__el().getBoundingClientRect(), q = T.probe(0, i); return { x: r.x, y: r.y, w: r.width, top: r.y + q.top, head: T.headWidth(), subs: T.subLayout(i).map((s) => ({ y: r.y + s.y, h: s.h, mx: r.x + s.mute.x + s.mute.w / 2, my: r.y + s.mute.y + s.mute.h / 2 })), xOf: T.probe(P_BAR(), i).x }; function P_BAR() { return 1920 * 2; } }, i);
await ev(async () => { const P = await import('./js/project.js'); P.newProject(false); P.addTrack('drum'); P.addTrack('midi'); P.state.sel.track = 0; P.emit('all'); });
await wait(400);
const g0 = await geo(0);
await ev(async () => { const P = await import('./js/project.js'); P.addSub(0, 'steps'); P.addSub(0, 'notes'); P.emit('all'); }); await wait(500);
const g = await geo(0), g1 = await geo(1);
ok(g.subs.length === 2 && g1.top - g.top > g0.subs.length + 2 * g.subs[0].h - 4, `two sub-track rows under the drum track (${g.subs[0].h} px each), the next track moves down`);
// double tap inside the second sub-track row at bar 3 = a new clip in that row
const sx = g.x + g.xOf + 20, sy = g.subs[1].y + g.subs[1].h / 2;
await tap(sx, sy); await wait(60); await tap(sx, sy); await wait(400);
const made = await ev(async () => { const P = await import('./js/project.js'), t = P.state.tracks[0]; return t.clips.map((c) => ({ sub: c.sub || null, start: c.start })); });
const sid = await ev(async () => { const P = await import('./js/project.js'); return P.subsOf(P.state.tracks[0]).map((s) => s.id); });
ok(made.length === 1 && made[0].sub === sid[1], 'double tap in a sub-track row makes the clip there (' + JSON.stringify(made) + ')');
// double tap in the track's own row: a clip at the same bar is allowed (another row)
const my = g.top + 20; await tap(sx, my); await wait(60); await tap(sx, my); await wait(400);
const made2 = await ev(async () => { const P = await import('./js/project.js'); return P.state.tracks[0].clips.map((c) => c.sub || null); });
ok(made2.length === 2 && made2.includes(null), 'the track row takes its own clip at the same bar');
// M button of the first sub-track row (measure again: the layout can change with the selection)
let G = await geo(0);
await tap(G.subs[0].mx, G.subs[0].my); await wait(300);
ok(await ev(async () => { const P = await import('./js/project.js'); return P.subsOf(P.state.tracks[0])[0].mute; }), 'M in the sub-track header mutes that row');
G = await geo(0); await tap(G.subs[0].mx, G.subs[0].my); await wait(300);
ok(!(await ev(async () => { const P = await import('./js/project.js'); return P.subsOf(P.state.tracks[0])[0].mute; })), 'tap again: active');
// long press the track header: "Tambah sub-track…" in the menu
G = await geo(0); await ptr('pointerdown', G.x + G.w - G.head + 40, G.top + 10); await wait(900); await ptr('pointerup', G.x + G.w - G.head + 40, G.top + 10); await wait(300);
const mt = await ev(() => [...document.querySelectorAll('#layer .menu:not(.closing) .mi')].map((e) => e.textContent));
ok(mt.some((t) => /Tambah sub-track/.test(t)), 'the track menu offers "Tambah sub-track…"');
await ev(async () => (await import('./js/ui.js')).closeAll()); await wait(200);
// tap the sub-track header body = its menu
G = await geo(0); await tap(G.x + G.w - G.head + 40, G.subs[1].y + G.subs[1].h / 2); await wait(400);
const sm = await ev(() => [...document.querySelectorAll('#layer .menu:not(.closing) .mi')].map((e) => e.textContent));
ok(sm.some((t) => /Hapus sub-track/.test(t)) && sm.some((t) => /Editor: Notes/.test(t)), 'tap a sub-track header = its menu (mute, rename, editor, delete)');
await ev(async () => (await import('./js/ui.js')).closeAll()); await wait(200);
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
ok(!errs.length, 'no page errors ' + errs.join(' | '));
await b.close(); server.close();
console.log(bad ? bad + ' FAILED' : 'ALL OK'); process.exit(bad ? 1 : 0);
