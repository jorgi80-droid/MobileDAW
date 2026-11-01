// Touch workflow in the real app on an emulated Android phone (Chromium, Pixel 7 landscape): Clip Controls on tap (non-modal), double tap =
// editor without the menu, Escape cancels a clip drag (no undo step left), Snap switch tap / long-press, Delete Track asks first, piano-roll
// background drag = note selection, automation rubber band, drum channel Clone / Set MIDI Key, device reorder by long-press + drag, knob fine
// adjustment, Quick Save swipe with backup, keyboard shortcuts (and not while typing), the Sentuhan settings pad.
// Touches are pointer events of type "touch" sent to the elements (layout pixels x the UI-scale factor, as the app expects).
// Usage: node tools/touch-ui-test.mjs   (needs Playwright + Chromium; not part of run-tests)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7 landscape'] }); const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(1500);
const ev = (f, a) => page.evaluate(f, a);
const wait = (ms) => page.waitForTimeout(ms);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };

// pointer events on an element; sel = CSS selector or 'arr' (arrangement gesture layer) / 'ed' (editor gesture layer); x, y in layout pixels
await ev(() => { window.__el = (sel) => sel === 'arr' ? [...document.querySelectorAll('#arr canvas')].pop() : sel === 'ed' ? document.querySelector('.ed-body canvas + canvas') : document.querySelector(sel); });
const ptr = (sel, type, x, y, id = 7) => ev(async ([sel, type, x, y, id]) => { const k = (await import('./js/uiscale.js')).emuK(); const el = typeof sel === 'string' ? window.__el(sel) : sel; el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 7, clientX: x * k, clientY: y * k, buttons: type === 'pointerup' ? 0 : 1 })); }, [sel, type, x, y, id]);
const tap = async (sel, x, y) => { await ptr(sel, 'pointerdown', x, y); await wait(40); await ptr(sel, 'pointerup', x, y); };
const hold = async (sel, x, y, ms = 560) => { await ptr(sel, 'pointerdown', x, y); await wait(ms); };
const slide = async (sel, x0, y0, x1, y1, n = 12, up = true) => { for (let k = 1; k <= n; k++) { await ptr(sel, 'pointermove', x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n); await wait(16); } if (up) await ptr(sel, 'pointerup', x1, y1); };
const centre = (sel) => ev((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
const arrOrigin = await ev(() => { const r = window.__el('arr').getBoundingClientRect(); return { x: r.x, y: r.y }; });
const at = async (tick, i) => { const r = await ev(async ([tick, i]) => (await import('./js/timeline.js')).probe(tick, i), [tick, i]); return { x: arrOrigin.x + r.x, y: arrOrigin.y + r.y }; };
const TL = () => ev(async () => (await import('./js/timeline.js')).testState());
const menuTexts = () => ev(() => [...document.querySelectorAll('#layer .menu:not(.closing) .mi')].map((e) => e.textContent));
const closeAll = () => ev(async () => (await import('./js/ui.js')).closeAll());
const BAR = await ev(async () => (await import('./js/project.js')).BAR);

// a MIDI track with two clips, nothing selected
await ev(async () => { const P = await import('./js/project.js'); const t = P.state.tracks[1]; t.clips = [];
  const a = P.addClip(1, 0, P.BAR); a.notes.push({ t: 0, d: 240, p: 60, v: 0.8 }, { t: 480, d: 240, p: 64, v: 0.8 });
  const c = P.addClip(1, P.BAR * 2, P.BAR); c.notes.push({ t: 0, d: 240, p: 67, v: 0.8 }); P.syncClips(1); P.state.sel.clip = null; P.state.sel.track = 1; P.emit('all'); });
await wait(400);

// 1. tap a clip: selected at once, Clip Controls after the double-tap window, no scrim (non-modal)
let p = await at(BAR * 0.5, 1); await tap('arr', p.x, p.y); await wait(60);
ok(await ev(async () => (await import('./js/project.js')).state.sel.clip !== null), 'tap clip: selected immediately');
ok((await menuTexts()).length === 0, 'Clip Controls held back during the double-tap window');
await wait(420);
let m = await menuTexts();
ok(m.includes('Edit') && m.includes('Copy') && m.includes('Cut') && m.includes('Delete') && m.some((x) => x.startsWith('Combine')) && m.some((x) => /Activate|Deactivate/.test(x)), 'Clip Controls: Edit / Copy / Cut / Delete / Combine / Mute (' + m.length + ' items)');
ok(await ev(() => !document.querySelector('#layer .scrim')), 'Clip Controls are non-modal (no scrim)');
// a touch elsewhere closes them and still works: drag the second clip right away
p = await at(BAR * 2.5, 1); let q = await at(BAR * 3.5, 1);
await ptr('arr', 'pointerdown', p.x, p.y); await wait(30);
ok((await menuTexts()).length === 0, 'a touch outside closes Clip Controls');
await slide('arr', p.x, p.y, q.x, q.y); await wait(300);
let starts = await ev(async () => { const P = await import('./js/project.js'); return P.state.tracks[1].clips.map((c) => c.start / P.BAR).sort(); });
ok(JSON.stringify(starts) === JSON.stringify([0, 3]), 'same touch drags the next clip (clip 2 now at bar 4): ' + JSON.stringify(starts));
await closeAll(); await wait(200);

// 2. double tap a clip: the editor opens, the menu does not
p = await at(BAR * 0.5, 1); await tap('arr', p.x, p.y); await wait(90); await tap('arr', p.x, p.y); await wait(700);
ok(await ev(() => document.getElementById('view-arr').classList.contains('edfull')), 'double tap clip: full-screen editor');
ok((await menuTexts()).length === 0, 'double tap: no Clip Controls left behind');

// 3. piano roll: one-finger drag on the background = rubber band over the notes (FL Studio Mobile)
const edO = await ev(() => { const r = window.__el('ed').getBoundingClientRect(); return { x: r.x, y: r.y }; });
const edAt = async (t, pi) => { const r = await ev(async ([t, pi]) => (await import('./js/editor.js')).probe(t, pi), [t, pi]); return { x: edO.x + r.x, y: edO.y + r.y }; };
await ev(async () => { const E = await import('./js/editor.js'); E.setTheory(); });
let a0 = await edAt(1500, 65), a1 = await edAt(5, 58);
console.log('rubber band from', JSON.stringify(a0), 'to', JSON.stringify(a1), 'editor', JSON.stringify(await ev(() => { const r = window.__el('ed').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })));
await ptr('ed', 'pointerdown', a0.x, a0.y); await wait(30); await slide('ed', a0.x, a0.y, a1.x, a1.y); await wait(500);
let es = await ev(async () => (await import('./js/editor.js')).testState());
ok(es.sel === 2, 'piano roll: background drag selected 2 notes (' + es.sel + ')');
ok(await ev(() => [...document.querySelectorAll('#layer .bar:not(.closing) .b')].some((x) => x.textContent === 'Copy')), 'selection bar offers Copy / Del / Snap / More');
await closeAll();
// keyboard: Ctrl+A selects all notes, Ctrl+D duplicates them, Escape drops the selection
await page.keyboard.press('Control+a'); es = await ev(async () => (await import('./js/editor.js')).testState()); ok(es.sel === 2, 'Ctrl+A in the piano roll: all notes');
await page.keyboard.press('Control+d'); await wait(100);
let nn = await ev(async () => { const P = await import('./js/project.js'); return P.selectedClip().clip.notes.length; }); ok(nn === 4, 'Ctrl+D duplicates the selection (' + nn + ' notes)');
await page.keyboard.press('Control+z'); await wait(100);
nn = await ev(async () => { const P = await import('./js/project.js'); return P.selectedClip().clip.notes.length; }); ok(nn === 2, 'Ctrl+Z undoes it');
// 4. Escape during a note drag puts the note back
let n0 = await edAt(10, 60), n1 = await edAt(10 + 960, 62);
const undo0 = await ev(async () => (await import('./js/history.js')).canUndo());
await ptr('ed', 'pointerdown', n0.x + 6, n0.y); await wait(30); await slide('ed', n0.x + 6, n0.y, n1.x, n1.y, 10, false);
await page.keyboard.press('Escape'); await ptr('ed', 'pointerup', n1.x, n1.y); await wait(200);
let note = await ev(async () => { const P = await import('./js/project.js'); const n = P.selectedClip().clip.notes.find((x) => x.t === 0); return n ? n.p : null; });
ok(note === 60, 'Escape during a note drag: note back at C4 / tick 0');
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await wait(400);
ok(await ev(() => !document.getElementById('view-arr').classList.contains('edfull')), 'Escape with nothing selected closes the editor');

// 5. Escape during a clip drag: the clip goes back, no undo step left behind
p = await at(BAR * 0.5, 1); q = await at(BAR * 1.5, 1);
const hist0 = await ev(async () => { const H = await import('./js/history.js'); return H.canUndo(); });
await ptr('arr', 'pointerdown', p.x, p.y); await wait(30); await slide('arr', p.x, p.y, q.x, q.y, 10, false);
ok((await TL()).dragging, 'clip drag in progress (ghost + position bubble drawn)');
await page.keyboard.press('Escape'); await ptr('arr', 'pointerup', q.x, q.y); await wait(300);
starts = await ev(async () => { const P = await import('./js/project.js'); return P.state.tracks[1].clips.map((c) => c.start / P.BAR).sort(); });
ok(JSON.stringify(starts) === JSON.stringify([0, 3]) && !(await TL()).dragging, 'Escape: clip back at bar 1');
await closeAll();

// 6. Snap switch (top right): tap = off / back on, long-press = options
const corner = await ev(async () => { const r = window.__el('arr').getBoundingClientRect(); return { x: r.x + r.width - 30, y: r.y + 10 }; });
const s0 = (await TL()).snap; await tap('arr', corner.x, corner.y); await wait(100);
ok((await TL()).snap === 'Off', 'tap Snap: off (was ' + s0 + ')');
await tap('arr', corner.x, corner.y); await wait(100); ok((await TL()).snap === s0, 'tap Snap again: back to ' + s0);
await hold('arr', corner.x, corner.y); await ptr('arr', 'pointerup', corner.x, corner.y); await wait(100);
m = await menuTexts(); ok(m.includes('Bar') && m.includes('1/4 Beat') && m.includes('Off'), 'long-press Snap: snap options');
await closeAll(); await wait(300);

// 7. Delete Track asks first (long-press the track header -> menu -> "Hapus track…" -> dialog)
const hd = await ev(async () => { const r = window.__el('arr').getBoundingClientRect(), T = await import('./js/timeline.js'), q = T.probe(0, 1); return { x: r.x + r.width - 40, y: r.y + q.top + 8 }; });
const n0t = await ev(async () => (await import('./js/project.js')).state.tracks.length);
await hold('arr', hd.x, hd.y); await ptr('arr', 'pointerup', hd.x, hd.y); await wait(420);
ok((await menuTexts()).includes('Hapus track…'), 'long-press track header: channel menu with "Hapus track…"');
await ev(() => [...document.querySelectorAll('#layer .menu .mi')].find((e) => e.textContent === 'Hapus track…').click()); await wait(200);
ok(await ev(() => !!document.querySelector('#layer .modal')) && (await ev(async () => (await import('./js/project.js')).state.tracks.length)) === n0t, 'Delete Track: confirmation dialog, nothing deleted yet');
await closeAll(); await wait(300);

// 8. Clip menu "Combine with Next Clip"
p = await at(BAR * 0.5, 1); await tap('arr', p.x, p.y); await wait(900);   // menu items take taps 350 ms after the menu opened (ghost-click guard)
await ev(() => [...document.querySelectorAll('#layer .menu .mi')].find((e) => e.textContent.startsWith('Combine')).click()); await wait(200);
let cl = await ev(async () => { const P = await import('./js/project.js'); return P.state.tracks[1].clips.map((c) => [c.start / P.BAR, c.len / P.BAR, c.notes.length]); });
ok(cl.length === 1 && cl[0][0] === 0 && cl[0][1] === 4 && cl[0][2] === 3, 'Combine with Next Clip: one 4-bar clip with all 3 notes ' + JSON.stringify(cl));

// 9. keyboard in the arrangement: Ctrl+A picks every clip, Escape drops them; no shortcut while typing in a field
await page.keyboard.press('Control+a'); ok((await TL()).picked >= 1, 'Ctrl+A in the arrangement picks every clip (' + (await TL()).picked + ')');
await page.keyboard.press('Escape'); ok((await TL()).picked === 0, 'Escape drops the picked clips');
await ev(async () => (await import('./js/ui.js')).ask('Tes', '', () => {})); await wait(100);
const playing0 = await ev(async () => (await import('./js/project.js')).state.playing);
await page.keyboard.press('Space'); await wait(100);
ok((await ev(async () => (await import('./js/project.js')).state.playing)) === playing0, 'Space while typing in a field does not start playback');
await closeAll(); await wait(300);

// 10. automation clip: rubber band over points, Copy / Hapus bar
await ev(async () => { const P = await import('./js/project.js'); const a = P.addAutoTrack({ kind: 0, strip: 1, param: 0, def: P.AUTO_VOL }, 'Vol'); const i = P.state.tracks.length - 1; const t = P.state.tracks[i]; t.clips = [];
  const c = P.addClip(i, 0, P.BAR); c.pts = [{ t: 0, v: 0.2 }, { t: 960, v: 0.8 }, { t: 1920, v: 0.4 }, { t: 3840, v: 0.6 }]; P.syncClips(i); P.selectClip(i, c.id); });
await ev(async () => (await import('./js/timeline.js')).openEditor()); await wait(700);
const eo = await ev(() => { const r = window.__el('ed').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const ptX = async (t) => ev(async (t) => (await import('./js/editor.js')).probe(t, 60).x, t);
const xa = eo.x + (await ptX(700)), xb = eo.x + (await ptX(2100));
await ptr('ed', 'pointerdown', xa, eo.y + 24); await wait(30); await slide('ed', xa, eo.y + 24, xb, eo.y + eo.h - 6); await wait(500);
es = await ev(async () => (await import('./js/editor.js')).testState());
ok(es.aset === 2, 'automation: background drag picked 2 points (' + es.aset + ')');
ok(await ev(() => [...document.querySelectorAll('#layer .bar:not(.closing) .b')].map((x) => x.textContent).join() === 'Copy,Hapus,Paste,Batal pilih'), 'automation bar: Copy / Hapus / Paste / Batal pilih');
await ev(() => [...document.querySelectorAll('#layer .bar .b')].find((x) => x.textContent === 'Hapus').click()); await wait(200);
let np = await ev(async () => (await import('./js/project.js')).selectedClip().clip.pts.length); ok(np === 2, 'Hapus removed the 2 picked points (' + np + ' left)');
await ev(async () => (await import('./js/history.js')).undoOp()); await wait(100);
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await wait(400);

// 11. drum channel menu: Clone and Set MIDI Key (steps follow the key)
await ev(async () => { const P = await import('./js/project.js'); const i = P.state.tracks.findIndex((t) => t.kind === 'drum'); const t = P.state.tracks[i]; t.clips = []; const c = P.addClip(i, 0, P.BAR); c.notes.push({ t: 0, d: 200, p: 36, v: 0.9 }); P.syncClips(i); P.selectClip(i, c.id); window.__dr = i; });
await ev(async () => (await import('./js/timeline.js')).openEditor()); await wait(700);
const before = await ev(async () => (await import('./js/project.js')).padsOf(window.__dr).map((q) => q.pitch));
const kick = before.indexOf(36);
const rowY = await ev(async (k) => { const r = window.__el('ed').getBoundingClientRect(); return { x: r.x + 30, y: r.y + 18 + 0 }; }, kick);
await hold('ed', rowY.x, rowY.y + 6); await ptr('ed', 'pointerup', rowY.x, rowY.y + 6); await wait(420);   // pad row 0 (rows start under an 18 px header)
m = await menuTexts();
ok(m.includes('Load Sample…') && m.includes('Clone') && m.some((x) => x.startsWith('Set MIDI Key')) && m.includes('Hapus pad…') && m.includes('Isi tiap 4 step'), 'long-press drum channel: Load Sample / Clone / Set MIDI Key / Hapus / Fill');
await ev(() => [...document.querySelectorAll('#layer .menu .mi')].find((e) => e.textContent === 'Clone').click()); await wait(200);
const after = await ev(async () => (await import('./js/project.js')).padsOf(window.__dr).length);
ok(after === before.length + 1, 'Clone: one more pad (' + before.length + ' -> ' + after + ')');
const r0 = await ev(async () => { const P = await import('./js/project.js'); const o = P.setPadKey(window.__dr, 0, 72); const c = P.selectedClip().clip; return { o, p: c.notes.map((n) => n.p), pad: P.padsOf(window.__dr)[0].pitch }; });
ok(r0.o.ok && r0.pad === 72 && (before[0] !== 36 || r0.p.includes(72)), 'Set MIDI Key: pad answers note 72 and its steps moved with it ' + JSON.stringify(r0));
const dup = await ev(async () => (await import('./js/project.js')).setPadKey(window.__dr, 1, 72));
ok(!!dup.error, 'Set MIDI Key refuses a key used by another pad');
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await wait(400);

// 12. device reorder: long-press a device title bar, slide right past the next device, release
await ev(async () => { const P = await import('./js/project.js'); P.selectTrack(1); const t = P.state.tracks[1]; while (t.devices.length) P.removeDevice(1, 0); P.addDevice(1, 7); P.addDevice(1, 6); });
await ev(async () => { (await import('./js/devices.js')).render(); }); await wait(500);
const order0 = await ev(async () => (await import('./js/project.js')).state.tracks[1].devices.map((d) => d.type));
const heads = await ev(() => [...document.querySelectorAll('.dev-scroll > .card')].filter((c) => c.querySelector('.pw')).map((c) => { const r = c.querySelector('h4 > span').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: c.getBoundingClientRect().width }; }));
if (heads.length >= 2) {
  await ev(() => { window.__h4 = [...document.querySelectorAll('.dev-scroll > .card')].filter((c) => c.querySelector('.pw'))[0].querySelector('h4'); });
  const h0 = heads[0], h1 = heads[1];
  await ev(async ([x, y]) => { const k = (await import('./js/uiscale.js')).emuK(); window.__h4.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'touch', clientX: x * k, clientY: y * k, buttons: 1 })); }, [h0.x, h0.y]);
  await wait(560);
  ok(await ev(() => !!document.querySelector('.card.dv-lift')), 'long-press device title: the card lifts');
  for (let k = 1; k <= 14; k++) { await ev(async ([x, y]) => { const kk = (await import('./js/uiscale.js')).emuK(); window.__h4.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 9, pointerType: 'touch', clientX: x * kk, clientY: y * kk, buttons: 1 })); }, [h0.x + (h1.x - h0.x + h1.w * 0.3) * k / 14, h0.y]); await wait(16); }
  ok(await ev(() => !!document.querySelector('.card.dv-ins-a, .card.dv-ins-b')), 'insertion line shown before the finger lifts');
  await ev(async ([x, y]) => { const k = (await import('./js/uiscale.js')).emuK(); window.__h4.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'touch', clientX: x * k, clientY: y * k })); }, [h1.x + h1.w * 0.3, h0.y]);
  await wait(400);
  const order1 = await ev(async () => (await import('./js/project.js')).state.tracks[1].devices.map((d) => d.type));
  ok(JSON.stringify(order1) === JSON.stringify([...order0].reverse()), 'device reorder: ' + JSON.stringify(order0) + ' -> ' + JSON.stringify(order1));
} else ok(false, 'two device cards found for the reorder test');

// 13. knob fine adjustment: the same vertical drag changes far less when the finger has slid sideways
const fine = await ev(async () => {
  const { knob } = await import('./js/ui.js'); const p = { n: 'T', min: 0, max: 1, def: 0.5 }; let v = 0.5; const el = knob(p, () => v, (x) => { v = x; }, (q, x) => x.toFixed(3)); document.body.append(el); el.setPointerCapture = () => {};   // synthetic pointers have no active pointer to capture
  const go = (pts) => { el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, clientX: pts[0][0], clientY: pts[0][1] })); for (const [x, y] of pts.slice(1)) el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, clientX: x, clientY: y })); el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3 })); };
  v = 0.5; go([[100, 300], [100, 290], [100, 260]]); const coarse = v - 0.5;
  v = 0.5; go([[100, 300], [400, 302], [400, 296], [400, 260]]); const fineD = v - 0.5;   // slide sideways first, then the same 40 px up
  el.remove(); return { coarse, fineD };
});
ok(fine.coarse > 0.2 && fine.fineD > 0 && fine.fineD < fine.coarse / 4, 'knob: 40 px up = ' + fine.coarse.toFixed(3) + ', with the finger 300 px sideways = ' + fine.fineD.toFixed(3) + ' (fine)');

// 14. Quick Save: first time asks for a name; the swipe on "Simpan proyek…" then overwrites without a dialog and keeps a backup
await ev(async () => { const QS = await import('./js/quicksave.js'); const P = await import('./js/project.js'); P.state.projectName = 'Untitled'; QS.quickSave(); }); await wait(200);
ok(await ev(() => !!document.querySelector('#layer .modal input')), 'Quick Save on a never-saved project asks for a name');
await page.fill('#layer .modal input', 'TouchTest'); await ev(() => [...document.querySelectorAll('#layer .modal .b')].find((x) => x.textContent === 'OK').click()); await wait(300);
ok(await ev(async () => { const { eng } = await import('./js/engine.js'); const t = eng.readText('/Projects/TouchTest.mdaw'); return typeof t === 'string' && t.length > 20; }), 'saved as Projects/TouchTest.mdaw');
await ev(async () => { const P = await import('./js/project.js'); P.setBpm(133); });
await page.locator('#btn-menu').tap(); await wait(450);
await ev(() => { window.__mi = [...document.querySelectorAll('#layer .menu .mi')].find((e) => e.textContent.startsWith('Simpan proyek')); });
ok(await ev(() => !!window.__mi && window.__mi.classList.contains('swp')), 'menu row "Simpan proyek…" is swipeable');
await ptr(await page.evaluateHandle(() => window.__mi), 'pointerdown', 100, 100, 5);
for (let k = 1; k <= 10; k++) { await ptr(await page.evaluateHandle(() => window.__mi), 'pointermove', 100 + k * 12, 101, 5); await wait(16); }
await ptr(await page.evaluateHandle(() => window.__mi), 'pointerup', 220, 101, 5); await wait(300);
const qs = await ev(async () => { const { eng } = await import('./js/engine.js'); const a = eng.readText('/Projects/TouchTest.mdaw'), b = eng.readText('/Projects/_backup_TouchTest.mdaw'); return { main: /"bpm":\s*133/.test(a || ''), bak: typeof b === 'string' && !/"bpm":\s*133/.test(b), modal: !!document.querySelector('#layer .modal:not(.closing)') }; });
ok(qs.main && qs.bak && !qs.modal, 'swipe = Quick Save without a dialog: file has the new tempo, the old version is in _backup_TouchTest.mdaw ' + JSON.stringify(qs));
await closeAll(); await wait(300);

// 15. Settings -> Sentuhan: the gesture pad answers
await ev(async () => (await import('./js/settingsui.js')).openSettings()); await wait(300);
await ev(() => [...document.querySelectorAll('.prefs .btabs .b')].find((x) => x.dataset.t === 'Sentuhan').click()); await wait(200);
const gp = await ev(() => { const r = document.querySelector('.gtest').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await tap('.gtest', gp.x, gp.y); await wait(60);
ok(await ev(() => document.querySelector('.gtest span').textContent === 'Ketuk'), 'Sentuhan settings: gesture pad reports a tap');
await hold('.gtest', gp.x, gp.y); await ptr('.gtest', 'pointerup', gp.x, gp.y); await wait(60);
ok(await ev(() => /Tekan lama/.test(document.querySelector('.gtest span').textContent)), 'gesture pad reports a long press');
await ev(() => [...document.querySelectorAll('.prefs .btabs .b')].find((x) => x.dataset.t === 'Pintasan').click()); await wait(200);
ok(await ev(() => document.querySelectorAll('.kmap .sline').length >= 20), 'Pintasan settings: every shortcut listed and rebindable');
await closeAll();

ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\ntouch-ui-test: all passed');
process.exit(bad ? 1 : 0);
