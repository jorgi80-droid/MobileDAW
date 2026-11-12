// Channel-menu workflow in the real app (Chromium, Pixel 7 landscape): the drum pad panel's new "Seq" tab (Cut Group A/B/C, Poly, Hold, Shift),
// and the long-press track-header menu: Duplicate / Save as MIDI / Import MIDI / Sync all samples / Save + Load drum kit, per track kind.
// Usage: node tools/channel-ui-test.mjs   (needs Playwright + Chromium; not part of run-tests)
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
const ev = (f, a) => page.evaluate(f, a);
const wait = (ms) => page.waitForTimeout(ms);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
await ev(() => { window.__el = (sel) => sel === 'arr' ? [...document.querySelectorAll('#arr canvas')].pop() : document.querySelector(sel); });
const ptr = (sel, type, x, y, id = 7) => ev(async ([sel, type, x, y, id]) => { const k = (await import('./js/uiscale.js')).emuK(); const el = window.__el(sel); el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 7, clientX: x * k, clientY: y * k, buttons: type === 'pointerup' ? 0 : 1 })); }, [sel, type, x, y, id]);
const menuTexts = () => ev(() => [...document.querySelectorAll('#layer .menu:not(.closing) .mi')].map((e) => e.textContent));
const closeAll = () => ev(async () => (await import('./js/ui.js')).closeAll());
// long-press the header of track i
const headMenuOf = async (i) => {
  await closeAll(); await wait(250);
  const hd = await ev(async (i) => { const r = window.__el('arr').getBoundingClientRect(), T = await import('./js/timeline.js'), q = T.probe(0, i); return { x: r.x + r.width - 40, y: r.y + q.top + 8 }; }, i);
  await ptr('arr', 'pointerdown', hd.x, hd.y); await wait(560); await ptr('arr', 'pointerup', hd.x, hd.y); await wait(420);
  return menuTexts();
};

// a project: 0 drum, 1 synth, 2 audio (with a clip)
await ev(async () => {
  const P = await import('./js/project.js'); P.newProject(false);
  P.addTrack('drum'); P.addTrack('midi'); P.addTrack('audio');
  const c = P.addClip(0, 0, P.BAR); c.notes.push({ t: 0, d: 120, p: 36, v: 0.9 }); P.clipChanged(0);
  const s = { id: 40, path: '/Samples/x.wav', name: 'x.wav', duration: 1, frames: 48000, peaks: [], pyr: null }; P.state.samples[s.path] = s;
  P.state.tracks[2].clips.push({ id: 9001, start: 0, len: P.BAR, name: 'x', sample: s, offset: 0 });
  P.state.sel.track = 0; P.emit('all');
});
await wait(500);

// ---- the Seq tab of the pad panel
const seq = await ev(async () => {
  const D = await import('./js/drumpad.js'), P = await import('./js/project.js');
  const root = D.padPanel(0, 0, { onClose() {}, onChange() {} }); document.body.append(root); root.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#222';
  const tabs = [...root.querySelectorAll('.pp-h .b')].map((e) => e.textContent);
  [...root.querySelectorAll('.pp-h .b')].find((e) => e.textContent === 'Seq').click();
  const knobs = [...root.querySelectorAll('.pp-b .knob, .pp-b [class*="knob"]')].length;
  const txt = root.querySelector('.pp-b').textContent;
  const btn = (l) => [...root.querySelectorAll('.pp-b .b')].find((e) => e.textContent === l);
  btn('B').click(); const cutB = P.padsOf(0)[0].cut;
  [...root.querySelectorAll('.pp-b .b')].find((e) => e.textContent === 'A').click(); const cutA = P.padsOf(0)[0].cut;
  const polyBefore = P.padsOf(0)[0].poly; [...root.querySelectorAll('.pp-b .b')].find((e) => e.textContent === 'Poly').click(); const polyAfter = P.padsOf(0)[0].poly;
  const on = (l) => [...root.querySelectorAll('.pp-b .b')].find((e) => e.textContent === l).classList.contains('on');
  const res = { tabs, txt, cutB, cutA, polyBefore, polyAfter, polyOn: on('Poly'), aOn: on('A') };
  root.remove(); return res;
});
ok(seq.tabs.join() === '✕,Mixer,Sample,Envelope,Seq', 'pad panel tabs: Mixer, Sample, Envelope, Seq (' + seq.tabs.join(' ') + ')');
ok(/Hold/.test(seq.txt) && /Shift/.test(seq.txt) && /Cut/.test(seq.txt) && /Poly/.test(seq.txt), 'Seq tab shows Hold, Shift, Cut Group and Poly');
ok(seq.cutB === 2 && seq.cutA === 1, 'Cut Group buttons set the pad (B = 2, A = 1)');
ok(seq.polyBefore === true && seq.polyAfter === false && seq.polyOn === false, 'Poly toggles off and the button follows');
await ev(async () => { (await import('./js/project.js')).setPad(0, 0, 'cut', 0); (await import('./js/project.js')).setPad(0, 0, 'poly', true); });

// ---- the Envelope tab: FL Studio Mobile's drum slot envelope only (no model switch); an old pad (seconds) is converted when it loads
const egt = await ev(async () => {
  const D = await import('./js/drumpad.js'), P = await import('./js/project.js');
  P.padsOf(0)[0].sample = P.state.samples['/Samples/x.wav'];
  const root = D.padPanel(0, 0, { onClose() {}, onChange() {} }); document.body.append(root); root.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#222';
  [...root.querySelectorAll('.pp-h .b')].find((e) => e.textContent === 'Envelope').click();
  const q = P.padsOf(0)[0], box = root.getBoundingClientRect(); window.__ppBox = { x: box.x, y: box.y, w: box.width, h: box.height };
  const old = P.newPad({ a: 0.2, d: 0.3, s: 0.5, r: 0 }), cur = P.newPad({ eg: 1, a: 0.4, d: 0.5, s: 0.5, r: 0.6 });
  return { eg: q.eg, a: q.a, d: q.d, s: q.s, r: q.r, knobs: root.querySelectorAll('.pp-b .knobs > *').length, btns: root.querySelectorAll('.pp-b .b').length, old, cur };
});
ok(egt.eg === 1 && egt.a === 0 && egt.d === 1 && egt.s === 1 && egt.r === 1 && egt.knobs === 4 && egt.btns === 0, "Envelope tab: FLM's envelope with its default sliders (0 / 1 / 1 / 1), four knobs, no model switch");
ok(egt.old.eg === 1 && egt.old.a > 0.2 && egt.old.a < 1 && egt.old.d > 0.1 && egt.old.d < 1 && egt.old.r === 1 && egt.old.s === 0.5 && egt.cur.a === 0.4 && egt.cur.r === 0.6, `a pad saved in seconds converts to FLM sliders (A 0.2 s -> ${egt.old.a}, D 0.3 s -> ${egt.old.d}, R 0 = play through -> 1); an FLM pad is kept`);
if (process.env.SHOT) { const bx = await ev(() => window.__ppBox); await page.screenshot({ path: process.env.SHOT, clip: { x: bx.x, y: bx.y, width: Math.min(bx.w, 780), height: Math.min(bx.h, 350) } }); }
await ev(async () => { const P = await import('./js/project.js'); document.querySelectorAll('body > .pp').forEach((e) => e.remove()); P.padsOf(0)[0].sample = null; });

// ---- header menus per track kind
let m = await headMenuOf(0);
ok(m.includes('Duplikat track') && m.includes('Simpan sebagai MIDI') && m.some((x) => x.startsWith('Impor MIDI ke track ini')) && m.includes('Simpan kit drum…') && m.includes('Muat kit drum…'), 'drum track menu: Duplicate, Save as MIDI, Import MIDI, Save / Load drum kit');
ok(!m.includes('Sync semua sample'), 'drum track menu has no "Sync semua sample"');
m = await headMenuOf(1);
ok(m.includes('Duplikat track') && m.includes('Simpan sebagai MIDI') && !m.includes('Simpan kit drum…'), 'synth track menu: Duplicate and Save as MIDI, no drum kit items');
m = await headMenuOf(2);
ok(m.includes('Duplikat track') && m.includes('Sync semua sample') && !m.includes('Simpan sebagai MIDI'), 'audio track menu: Duplicate and Sync all samples, no MIDI items');

// ---- Duplicate Track from the menu
const n0 = await ev(async () => (await import('./js/project.js')).state.tracks.length);
await headMenuOf(1);
await ev(() => [...document.querySelectorAll('#layer .menu .mi')].find((e) => e.textContent === 'Duplikat track').click()); await wait(400);
const after = await ev(async () => { const P = await import('./js/project.js'); return { n: P.state.tracks.length, names: P.state.tracks.map((t) => t.name), sel: P.state.sel.track }; });
ok(after.n === n0 + 1 && after.names[2] === after.names[1] + ' 2' && after.sel === 2, 'menu "Duplikat track": copy right below, selected (' + after.names.join(' | ') + ')');
await ev(async () => { (await import('./js/history.js')).undoOp(); }); await wait(250);
ok(await ev(async () => (await import('./js/project.js')).state.tracks.length) === n0, 'one undo removes the duplicate');

// ---- Save drum kit then Load drum kit from the menu (the browser file system is the mock: kits live in memory for this run)
await ev(async () => { const { eng } = await import('./js/engine.js'); const fs = new Map(); eng.writeText = (p, t) => { fs.set(p, t); return true; }; eng.readText = (p) => fs.get(p); eng.listDir = (d) => ({ path: d, items: [...fs.keys()].filter((k) => k.startsWith(d + '/')).map((k) => ({ name: k.slice(d.length + 1) })) }); });
await headMenuOf(0);
await ev(() => [...document.querySelectorAll('#layer .menu .mi')].find((e) => e.textContent === 'Simpan kit drum…').click()); await wait(350);
const named = await ev(() => { const inp = document.querySelector('#layer input'); if (!inp) return false; inp.value = 'UI Kit'; inp.dispatchEvent(new Event('input', { bubbles: true })); const b = [...document.querySelectorAll('#layer .modal .b, #layer .modal button')].find((e) => /OK|Simpan|Ya/i.test(e.textContent)); if (b) b.click(); return !!b; });
await wait(400);
ok(named && await ev(async () => (await import('./js/presets.js')).kitList().length) === 1, 'menu "Simpan kit drum…": the kit file is written');
await headMenuOf(0);
await ev(() => [...document.querySelectorAll('#layer .menu .mi')].find((e) => e.textContent === 'Muat kit drum…').click()); await wait(350);
ok((await menuTexts()).some((x) => /^UI Kit \(\d+ pad\)$/.test(x)), 'menu "Muat kit drum…": lists "UI Kit"');
await closeAll();

ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nCHANNEL UI: all passed');
process.exit(bad ? 1 : 0);
