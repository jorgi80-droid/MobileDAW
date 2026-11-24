// Screenshots of the FL Studio Mobile instruments (DirectWave / GMS / MiniSynth / SuperSaw, types 30..33): every tab of each panel, in the
// device view (Chromium, landscape phone size). Checks the panels build without page errors and that each tab shows its controls.
// Usage: node tools/flm-inst-shots.mjs [out-dir]      (default docs/redesign/flm)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.resolve(process.argv[2] || path.join(root, 'docs/redesign/flm'));
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const VW = +(process.env.VW || 910), VH = +(process.env.VH || 414);   // default: a landscape phone (the owner's screen)
const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, floatPlugins: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(1000);
const ev = (fn, a) => page.evaluate(fn, a);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
await ev(async () => { const P = await import('./js/project.js'); P.newProject(true); for (const ty of [30, 31, 32, 33]) { P.addTrack('midi'); P.setInstrument(P.state.tracks.length - 1, ty); } P.emit('all'); });
await page.waitForTimeout(600);
await ev(() => document.querySelector('#dtabs .b[data-tab="dev"]').click()); await page.waitForTimeout(300);
if (process.env.DBG) await page.screenshot({ path: path.join(out, '_dbg.png') });
await ev(() => { if (document.getElementById('view-arr').classList.contains('shut')) document.getElementById('btn-shut').click(); }); await page.waitForTimeout(400);
if (process.env.MAX) { await ev(() => { const m = document.getElementById('btn-max'); if (m) m.click(); }); await page.waitForTimeout(300); }
for (const [k, ty, name] of [[0, 30, 'directwave'], [1, 31, 'gms'], [2, 32, 'minisynth'], [3, 33, 'supersaw']]) {
  await ev(async (ty) => { const P = await import('./js/project.js'); P.selectTrack(P.state.tracks.findIndex((t) => t.inst && t.inst.type === ty)); }, ty); await page.waitForTimeout(500);
  const tabs = await ev(() => [...document.querySelectorAll('.lk-flmtabs .lv-tab')].map((x) => x.textContent));
  ok(tabs.length >= 5, `${name}: tabs ${tabs.join(' / ')}`);
  for (let j = 0; j < tabs.length; j++) {
    await ev((j) => document.querySelectorAll('.lk-flmtabs .lv-tab')[j].click(), j); await page.waitForTimeout(250);
    const n = await ev(() => document.querySelectorAll('.lk-flmpg .lk-k, .lk-flmpg .flm-c, .lk-flmpg .lk-t, .lk-flmpg .lk-n, .lk-flmpg .lk-ch, .lk-flmpg .lv-fld, .lk-flmpg .lk-s').length);
    if (n < 2) ok(false, `${name} ${tabs[j]}: ${n} controls`);
    const el = await page.$('.card.flm-card');
    if (process.env.DBG) await page.screenshot({ path: path.join(out, '_full.png') });
    if (el && await el.isVisible()) { await el.screenshot({ path: path.join(out, `${name}-${String(j + 1).padStart(2, '0')}-${tabs[j].replace(/\W+/g, '').toLowerCase()}.png`) }); }
  }
}
// DirectWave: no zone side panel; a tap on the sample display asks for a sample (the zone event the device view answers with the browser)
{ await ev(async () => { const P = await import('./js/project.js'); P.selectTrack(P.state.tracks.findIndex((t) => t.inst && t.inst.type === 30)); }); await page.waitForTimeout(500);
  await ev(() => { window.__zone = 0; document.addEventListener('mdaw-zone', () => { window.__zone++; }); document.querySelectorAll('.lk-flmtabs .lv-tab')[0].click(); }); await page.waitForTimeout(300);
  const side = await ev(() => document.querySelectorAll('.card.flm-card .inst-side').length), cv = await page.$('.card.flm-card .flm-dbox canvas'), bx = await cv.boundingBox();
  await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height * 0.4); await page.waitForTimeout(300);
  ok(side === 0 && (await ev(() => window.__zone)) === 1, `DirectWave: no zone side panel (${side}), a tap on the display asks for a sample`);
  await page.keyboard.press('Escape'); await ev(() => { for (const b of document.querySelectorAll('.scrim')) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }); await page.waitForTimeout(200); }
// MiniSynth FX: one panel; the switch on an effect's entry turns it on, choosing an entry shows that effect
{ await ev(async () => { const P = await import('./js/project.js'); P.selectTrack(P.state.tracks.findIndex((t) => t.inst && t.inst.type === 32)); }); await page.waitForTimeout(500);
  await ev(() => [...document.querySelectorAll('.lk-flmtabs .lv-tab')].find((x) => x.textContent === 'FX').click()); await page.waitForTimeout(300);
  const get = () => ev(async () => { const P = await import('./js/project.js'); const t = P.state.tracks.find((x) => x.inst && x.inst.type === 32); return t.inst.params[28] || 0; });
  const n0 = await ev(() => ({ secs: document.querySelectorAll('.flm-fxw .flm-ds').length, list: [...document.querySelectorAll('.flm-fxsel .lv-tab')].map((x) => x.textContent) })), v0 = await get();
  await ev(() => document.querySelectorAll('.flm-fxsel .lv-tab')[1].querySelector('.chk').click()); await page.waitForTimeout(200); const v1 = await get();
  await ev(() => document.querySelectorAll('.flm-fxsel .lv-tab')[1].click()); await page.waitForTimeout(200);
  const title = await ev(() => document.querySelector('.flm-fxw .flm-dt').textContent), led = await ev(() => [...document.querySelectorAll('.lk-flmtabs .lv-tab')].find((x) => x.textContent === 'FX').classList.contains('lit'));
  ok(n0.secs === 1 && n0.list.join('/') === 'Distortion/Delay/Chorus/Phaser' && v0 < 0.5 && v1 > 0.5 && title === 'Delay' && led, `MiniSynth FX: one panel (${n0.list.join(' / ')}), Delay switch ${v0} -> ${v1}, panel shows ${title}, FX tab LED lit ${led}`); }
// title bar: the quick swap button lists the instruments; the long list stays on screen (it scrolls)
{ await ev(() => document.querySelector('.card.flm-card > h4 .dv-swap').click()); await page.waitForTimeout(450);
  const m = await ev(() => { const e = document.querySelector('.menu'); if (!e) return null; const r = e.getBoundingClientRect(); return { n: e.querySelectorAll('.mi').length, top: r.top, bottom: r.bottom, H: innerHeight }; });
  ok(m && m.n >= 20 && m.top >= 0 && m.bottom <= m.H, `quick swap: ${m && m.n} instruments listed, menu inside the screen (${m && Math.round(m.top)}..${m && Math.round(m.bottom)} of ${m && m.H})`);
  await ev(() => { for (const b of document.querySelectorAll('.scrim')) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); }); await page.waitForTimeout(300); }
await page.mouse.click(4, 4); await page.waitForTimeout(350);   // close whatever menu a test above left open
// displays of the redesigned tabs still take the finger: MiniSynth's filter ring (cutoff) and filter envelope (a handle)
{ await ev(async () => { const P = await import('./js/project.js'); P.selectTrack(P.state.tracks.findIndex((t) => t.inst && t.inst.type === 32)); }); await page.waitForTimeout(500);
  const par = () => ev(async () => { const P = await import('./js/project.js'), { INSTRUMENTS } = await import('./js/defs.js'); const t = P.state.tracks.find((x) => x.inst && x.inst.type === 32); return INSTRUMENTS[32].params.map((d, j) => (t.inst.params[j] != null ? t.inst.params[j] : d.def)); });
  const dragOn = async (tab, fx, fy, dx, dy) => { await ev((tab) => [...document.querySelectorAll('.lk-flmtabs .lv-tab')].find((x) => x.textContent === tab).click(), tab); await page.waitForTimeout(350);
    const cv = await page.$('.card.flm-card .flm-dbox canvas'); await cv.scrollIntoViewIfNeeded(); await page.waitForTimeout(200); const bx = await cv.boundingBox(), v0 = await par(); if (process.env.DBG) console.log(tab, JSON.stringify(bx), JSON.stringify(await ev(([x, y]) => { const e = document.elementFromPoint(x, y); return { w: innerWidth, at: e && (e.tagName + '.' + e.className + '#' + e.id), par: e && e.parentElement && e.parentElement.className }; }, [bx.x + bx.width * fx, bx.y + bx.height * fy])));
    await page.mouse.move(bx.x + bx.width * fx, bx.y + bx.height * fy); await page.mouse.down(); await page.mouse.move(bx.x + bx.width * fx + dx, bx.y + bx.height * fy + dy, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
    const v1 = await par(); return v0.map((v, j) => (Math.abs(v - v1[j]) > 1e-6 ? j : -1)).filter((j) => j >= 0); };
  const f = await dragOn('FILTER', 0.6, 0.4, -80, 30), e = await dragOn('FLT EG', 0.5, 0.2, 50, 40);
  ok(f.includes(4) && e.some((j) => j >= 8 && j <= 11), `MiniSynth displays follow a drag: filter moved params ${f.join(',')} (4 = Cutoff), envelope moved ${e.join(',')} (8..11 = A D S R)`); }
// the same on the other three FLM synths: their filter display moves Cutoff (DirectWave 12, GMS 0, SuperSaw 18)
for (const [ty, name, tabName, cut] of [[30, 'DirectWave', 'FILTER', 12], [31, 'GMS', 'FILTER', 0], [33, 'SuperSaw', 'FILTER', 18]]) {
  await ev(async (ty) => { const P = await import('./js/project.js'); P.selectTrack(P.state.tracks.findIndex((t) => t.inst && t.inst.type === ty)); }, ty); await page.waitForTimeout(500);
  const par = () => ev(async (ty) => { const P = await import('./js/project.js'), { INSTRUMENTS } = await import('./js/defs.js'); const t = P.state.tracks.find((x) => x.inst && x.inst.type === ty); return INSTRUMENTS[ty].params.map((d, j) => (t.inst.params[j] != null ? t.inst.params[j] : d.def)); }, ty);
  await ev((tab) => [...document.querySelectorAll('.lk-flmtabs .lv-tab')].find((x) => x.textContent === tab).click(), tabName); await page.waitForTimeout(350);
  const cv = await page.$('.card.flm-card .flm-dbox canvas'); await cv.scrollIntoViewIfNeeded(); await page.waitForTimeout(200); const bx = await cv.boundingBox(), v0 = await par();
  await page.mouse.move(bx.x + bx.width * 0.6, bx.y + bx.height * 0.4); await page.mouse.down(); await page.mouse.move(bx.x + bx.width * 0.6 - 80, bx.y + bx.height * 0.4 + 30, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
  const v1 = await par(); ok(v1[cut] < v0[cut], `${name} filter display: dragging left lowers Cutoff (${v0[cut]} -> ${Math.round(v1[cut] * 10) / 10})`); }
// title bar menus: the instrument's "⋯" menu and the quick swap button of an effect card
{ await ev(async () => { const P = await import('./js/project.js'); P.selectTrack(P.state.tracks.findIndex((t) => t.inst && t.inst.type === 32)); }); await page.waitForTimeout(500);
  await ev(() => document.querySelector('.card.flm-card > h4 .dv-more').click()); await page.waitForTimeout(450);
  const m1 = await ev(() => [...document.querySelectorAll('.menu .mi')].map((x) => x.textContent));
  await ev(() => { for (const b of document.querySelectorAll('.scrim')) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); }); await page.waitForTimeout(300);
  await ev(async () => { const P = await import('./js/project.js'); const i = P.state.tracks.findIndex((t) => t.inst && t.inst.type === 32); P.addDevice(i, 109); P.emit('all'); }); await page.waitForTimeout(500);
  const before = await ev(async () => { const P = await import('./js/project.js'); return P.state.tracks.find((t) => t.inst && t.inst.type === 32).devices[0].type; });
  await ev(() => document.querySelector('.card.lkcard:not(.flm-card) > h4 .dv-swap').click()); await page.waitForTimeout(450);
  const n2 = await ev(() => { const it = [...document.querySelectorAll('.menu .mi')].filter((x) => !x.classList.contains('hd') && !x.classList.contains('sep') && x.textContent === 'Compressor'); const flm = [...document.querySelectorAll('.menu .mi')].filter((x) => / \(FLM\)$/.test(x.textContent)).length; window.__flmN = flm; if (it[0]) it[0].click(); return document.querySelectorAll('.menu .mi').length; }); await page.waitForTimeout(500);
  const after = await ev(async () => { const P = await import('./js/project.js'); return P.state.tracks.find((t) => t.inst && t.inst.type === 32).devices[0].type; });
  const flmN = await ev(() => window.__flmN); ok(flmN === 32, `FX list: all ${flmN} FL Studio Mobile effects on their DSP are offered (tagged FLM)`);
  ok(m1.some((x) => /Ganti instrumen/.test(x)) && m1.some((x) => /mengambang/.test(x)) && n2 > 30 && after !== before, `instrument menu: ${m1.join(' | ')}; effect quick swap: ${n2} entries, Filter (${before}) -> Compressor (${after})`); }
// SoundFont with a loaded file: the 136 presets scroll inside the card, the card keeps the height of the rack
{ await ev(async () => { const P = await import('./js/project.js'); P.addTrack('midi'); const i = P.state.tracks.length - 1; P.setInstrument(i, 6); P.state.tracks[i].inst.sf = { path: 'x/TimGM6mb.sf2', presets: Array.from({ length: 136 }, (_, q) => 'Preset ' + (q + 1)), preset: 33 }; P.selectTrack(i); P.emit('all'); }); await page.waitForTimeout(600);
  const q = await ev(() => { const l = document.querySelector('.lk-sflist'), c = l.closest('.card'), sc = c.parentElement; return { card: Math.round(c.getBoundingClientRect().height), rack: Math.round(sc.getBoundingClientRect().height), list: Math.round(l.getBoundingClientRect().height), scroll: l.scrollHeight }; });
  ok(q.card <= q.rack + 1 && q.scroll > q.list * 3, `SoundFont: card ${q.card} px in a ${q.rack} px rack, the list (${q.list} px) scrolls its ${q.scroll} px of presets`);
  const el = await page.$('.card:has(.lk-sflist)'); if (el) await el.screenshot({ path: path.join(out, 'soundfont.png') }); }
// a knob turned on the panel reaches the project (and the engine)
const moved = await ev(async () => { const P = await import('./js/project.js'); const i = P.state.tracks.findIndex((t) => t.inst && t.inst.type === 32); P.selectTrack(i); P.setInstParam(i, 4, 37); return P.state.tracks[i].inst.params[4]; });
ok(moved === 37, 'MiniSynth Cutoff set through the project API: ' + moved);
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close(); server.close(); console.log(bad ? `flm-inst-shots: ${bad} FAILED` : 'flm-inst-shots: all passed'); process.exit(bad ? 1 : 0);
