// Pattern clips in the real app on an emulated Android phone (Chromium, Pixel 7 landscape, touch): pinch zoom, resize with snap, shorten,
// move, left trim, double tap -> full-screen editor, note in bar 5 + delete, a drum clip that follows its pattern, save / reload / load,
// real-time playback across a cycle boundary. Touches are pointer events of type "touch" sent to the gesture layers (layout pixels, as the
// app's UI-scale emulation expects). Usage: node tools/pattern-ui-test.mjs
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
const URL0 = `http://127.0.0.1:${server.address().port}/index.html`;
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7 landscape'] }); const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true })));
await page.goto(URL0); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(1500);
const ev = (f, a) => page.evaluate(f, a);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
await ev(async () => { const P = await import('./js/project.js'); const t = P.state.tracks[1]; t.clips = []; const c = P.addClip(1, 0, P.BAR);
  for (const bar of [0, 1, 2]) c.notes.push({ t: bar * P.BAR, d: P.BAR / 4, p: 48 + bar * 2, v: 0.8 }); P.fitPattern(c, 'midi'); P.syncClips(1); P.state.sel.clip = null; P.emit('all'); });
await page.waitForTimeout(400);
const canvas = await page.locator('#arr canvas').last().boundingBox();
const R = await ev(() => { const r = [...document.querySelectorAll('#arr canvas')].pop().getBoundingClientRect(); return { x: r.x, y: r.y }; });
const at = async (tick, i) => { const r = await ev(async ([tick, i]) => (await import('./js/timeline.js')).probe(tick, i), [tick, i]); return { x: R.x + r.x, y: R.y + r.y }; };
const st = () => ev(async () => { const P = await import('./js/project.js'); const c = P.state.tracks[1].clips[0]; const f = []; P.clipNoteEvents(c, 'midi', f); const bars = []; for (let k = 0; k < f.length; k += 5) bars.push(Math.floor((f[k] - c.start) / P.BAR) + 1);
  return { start: c.start / P.BAR, len: c.len / P.BAR, S: P.patternOf(c) / P.BAR, lp: (c.lp || 0) / P.BAR, cm: !!c.cm, notes: c.notes.length, bars, n: P.state.tracks[1].clips.length }; });
const BAR = await ev(async () => (await import('./js/project.js')).BAR);
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }] });
// synthetic touch pointer events on the arrangement's gesture layer (layout pixels, the coordinates the app works in)
const ptr = (type, x, y, id = 7) => ev(async ([type, x, y, id]) => { const k = (await import('./js/uiscale.js')).emuK(); x *= k; y *= k; const el = window.__tgt || [...document.querySelectorAll('#arr canvas')].pop(); el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 })); }, [type, x, y, id]);
const tapAt = async (x, y) => { await ptr('pointerdown', x, y); await page.waitForTimeout(40); await ptr('pointerup', x, y); };
const drag = async (x0, y0, x1, y1) => { await ptr('pointerdown', x0, y0); await page.waitForTimeout(30); for (let k = 1; k <= 14; k++) { await ptr('pointermove', x0 + (x1 - x0) * k / 14, y0 + (y1 - y0) * k / 14); await page.waitForTimeout(16); } await ptr('pointerup', x1, y1); await page.waitForTimeout(400); };
// two-finger pinch on the arrangement = zoom out, so 8 bars fit on screen
{ const y = 150, c0 = 640; await ptr('pointerdown', c0 - 260, y, 7); await ptr('pointerdown', c0 + 260, y, 8);
  for (let k = 1; k <= 12; k++) { const d = 260 - 170 * k / 12; await ptr('pointermove', c0 - d, y, 7); await ptr('pointermove', c0 + d, y, 8); await page.waitForTimeout(16); }
  await ptr('pointerup', c0 - 90, y, 7); await ptr('pointerup', c0 + 90, y, 8); await page.waitForTimeout(500);
  const z = await at(BAR * 9, 1); console.log('after pinch, bar 10 at x', Math.round(z.x)); }
// tap the clip to select it (handles appear)
let p = await at(BAR * 1.5, 1); await tapAt(p.x, p.y); await page.waitForTimeout(450);
console.log('start', JSON.stringify(await st()), await ev(async () => (await import('./js/project.js')).state.sel)); 
// 1. right edge 4 -> 6 bars (snap: release a bit past bar 7 -> snaps)
p = await at(BAR * 4 - 4, 1); const q = await at(BAR * 6 + BAR * 0.03, 1);
await drag(p.x, p.y, q.x, q.y);

let s = await st(); console.log('resize', JSON.stringify(s));
ok(s.len === 6 && s.S === 4 && s.notes === 3 && s.cm, 'touch resize 4 -> 6 bars: clip 6, cycle 4, 3 source notes, snapped to the grid');
ok(JSON.stringify(s.bars) === JSON.stringify([1, 2, 3, 5, 6]), 'playback events: bars 1-3 then 5-6 repeat, bar 4 empty');
// 2. shorten to 2.5 bars (grid 1/8 snap) -> non-multiple length, notes kept
p = await at(BAR * 6 - 4, 1); const q2 = await at(BAR * 2.5, 1);
await drag(p.x, p.y, q2.x, q2.y);
s = await st(); ok(Math.abs(s.len - 2.5) < 1e-9 && s.notes === 3 && s.S === 4, 'touch shorten to 2.5 bars: no note removed, cycle stays 4 (' + s.len + ')');
// back to 8
p = await at(BAR * 2.5 - 4, 1); const q3 = await at(BAR * 8, 1);
await drag(p.x, p.y, q3.x, q3.y);
s = await st(); ok(s.len === 8 && JSON.stringify(s.bars) === JSON.stringify([1, 2, 3, 5, 6, 7]), 'touch resize to 8: bars 5-7 repeat, 4 and 8 empty');
// 3. move the clip one bar right (body drag), then left trim by 1 bar: start inside the cycle, notes untouched
p = await at(BAR * 1.5, 1); const m1 = await at(BAR * 2.5, 1);
await drag(p.x, p.y, m1.x, m1.y);
s = await st(); ok(s.start === 1 && s.len === 8 && s.notes === 3 && JSON.stringify(s.bars) === JSON.stringify([1, 2, 3, 5, 6, 7]), 'touch move: clip to bar 2, playback unchanged relative to the clip');
p = await at(BAR + 4, 1); const q4 = await at(BAR * 2 + 4, 1);
await drag(p.x + 3, p.y, q4.x + 3, q4.y);
s = await st(); console.log('trimL', JSON.stringify(s));
ok(s.start === 2 && s.len === 7 && s.lp === 1 && s.notes === 3, 'touch left trim: start bar 3, loop position 1 bar, notes untouched');
ok(JSON.stringify(s.bars) === JSON.stringify([1, 2, 4, 5, 6]), 'left-trimmed clip plays (local + lp) % cycle');

// undo the trim (undo button) to come back to the 8-bar clip
await page.locator('#btn-undo, [aria-label="Undo"]').first().tap().catch(() => {});
await page.waitForTimeout(400); s = await st(); console.log('undo', JSON.stringify(s));
// 4. double tap the clip -> full-screen editor; tap a note into bar 5 of the pattern, then delete it
p = await at((s.start + 0.5) * BAR, 1); await tapAt(p.x, p.y); await page.waitForTimeout(80); await tapAt(p.x, p.y); await page.waitForTimeout(700);
ok(await ev(() => document.getElementById('view-arr').classList.contains('edfull')), 'double tap: editor full screen');

// 5. in the editor (full screen): tap a note into bar 5 of the pattern, then long-press it -> Hapus
const edAt = async (t, pi) => { const r = await ev(async ([t, pi]) => { const E = await import('./js/editor.js'); const el = document.querySelector('.ed-root .ed-body canvas + canvas'), b = el.getBoundingClientRect(); window.__tgt = el; const q = E.probe(t, pi); return { x: b.x + q.x, y: b.y + q.y }; }, [t, pi]); return r; };
let e5 = await edAt(BAR * 4 + BAR / 8, 50); await tapAt(e5.x, e5.y); await page.waitForTimeout(500);
s = await st(); ok(s.notes === 4 && s.S === 8 && s.len === 8, 'editor: a note in bar 5 makes the cycle 8 bars; the hand-sized clip stays 8 (' + JSON.stringify(s) + ')');

e5 = await edAt(BAR * 4 + BAR / 8 + 30, 50); await ptr('pointerdown', e5.x, e5.y); await page.waitForTimeout(650); await ptr('pointerup', e5.x, e5.y); await page.waitForTimeout(450);
await ev(() => { const it = [...document.querySelectorAll('.menu .mi')].find((x) => /Hapus/.test(x.textContent)); it && it.click(); }); await page.waitForTimeout(450);
s = await st(); ok(s.notes === 3 && s.S === 4 && s.len === 8, 'editor: deleting it brings the cycle back to 4; the clip keeps its 8 bars (' + JSON.stringify(s) + ')');
await ev(() => { window.__tgt = null; document.getElementById('btn-edclose').click(); }); await page.waitForTimeout(300);
// 6. a new clip that follows its pattern: double tap on empty Drums row space, edit, delete -> 1 bar again
p = await at(BAR * 6.5, 0); await tapAt(p.x, p.y); await page.waitForTimeout(60); await tapAt(p.x, p.y); await page.waitForTimeout(500);
const dst = () => ev(async () => { const P = await import('./js/project.js'); const t = P.state.tracks[0], c = t.clips.find((q) => q.start === 6 * P.BAR); return c ? { len: c.len / P.BAR, S: P.patternOf(c) / P.BAR, cm: !!c.cm, notes: c.notes.length } : null; });
let d = await dst(); ok(d && d.len === 1 && d.notes === 0, 'double tap on empty Drums space: new 1-bar clip at bar 7');
await ev(async () => { const P = await import('./js/project.js'); const t = P.state.tracks[0], c = t.clips.find((q) => q.start === 6 * P.BAR); P.selectClip(0, c.id); (await import('./js/timeline.js')).openEditor(); }); await page.waitForTimeout(600);
await ev(async () => { const P = await import('./js/project.js'); const t = P.state.tracks[0], c = t.clips.find((q) => q.start === 6 * P.BAR); c.notes.push({ t: 0, d: 200, p: 36, v: 0.9 }, { t: 2 * P.BAR, d: 200, p: 38, v: 0.7 }); P.fitPattern(c, 'drum'); P.clipChanged(0); P.emit('clips'); });
d = await dst(); ok(d.len === 3 && d.S === 3, 'drum clip that follows its pattern: a step in bar 3 = 3-bar sequence and clip (no rounding to 4)');
await ev(async () => { const P = await import('./js/project.js'); const t = P.state.tracks[0], c = t.clips.find((q) => q.start === 6 * P.BAR); c.notes.pop(); P.fitPattern(c, 'drum'); P.clipChanged(0); P.emit('clips'); });
d = await dst(); ok(d.len === 1 && d.S === 1, 'that step deleted: back to its 1-bar base');
await ev(() => { window.__tgt = null; document.getElementById('btn-edclose').click(); }); await page.waitForTimeout(300);
// 7. save + reload the page (autosave / restore): the four values come back apart
const before = await ev(async () => { const P = await import('./js/project.js'); return JSON.stringify(P.state.tracks.map((t) => t.clips.map((c) => [c.start, c.len, c.ll || 0, c.lp || 0, c.pb || 0, !!c.cm, (c.notes || []).length]))); });
const txt = await ev(async () => (await import('./js/project.js')).serialize());
await page.reload(); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(1200);
await ev(async (txt) => { await (await import('./js/project.js')).deserialize(txt); }, txt); await page.waitForTimeout(300);
const after = await ev(async () => { const P = await import('./js/project.js'); return JSON.stringify(P.state.tracks.map((t) => t.clips.map((c) => [c.start, c.len, c.ll || 0, c.lp || 0, c.pb || 0, !!c.cm, (c.notes || []).length]))); });
ok(before === after, 'save / reload / load: clip length, cycle, loop position, base, manual flag and notes identical');
s = await st(); ok(JSON.stringify(s.bars) === JSON.stringify([1, 2, 3, 5, 6, 7]), 'after reload the clip plays the same cycles');
// 8. real-time playback across the cycle boundary (bar 5 of the clip) on the web audio engine
await ev(async () => { const P = await import('./js/project.js'); P.seekTo(P.BAR * 4.5); }); await page.waitForTimeout(200);
await page.locator('#btn-play, [aria-label="Play"]').first().tap().catch(async () => { await ev(async () => (await import('./js/project.js')).togglePlay()); });
await page.waitForTimeout(2500);
const pos = await ev(async () => { const P = await import('./js/project.js'); return { playing: P.state.playing, bar: P.currentTick() / P.BAR }; });
await ev(async () => { const P = await import('./js/project.js'); if (P.state.playing) P.togglePlay(); });
ok(pos.bar > 5.2, 'playback ran across the cycle boundary without errors (now at bar ' + pos.bar.toFixed(2) + ', playing ' + pos.playing + ')');
await b.close(); server.close();
if (errs.length) { bad++; console.log('page errors:', errs); }
console.log(bad ? bad + ' FAILED' : 'ALL OK'); process.exit(bad ? 1 : 0);
