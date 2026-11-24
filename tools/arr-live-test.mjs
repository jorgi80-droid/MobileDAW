// Arrangement after Live 12 (manual ch. 6) + theme adjustments, in a real browser (Chromium, landscape phone): Set / Previous / Next Locator, Optimize Height (H) / Width (W), and the theme sliders (brightness, tone, hue).
// Usage: node tools/arr-live-test.mjs [out-dir]     (screenshots: docs/redesign/arr)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.resolve(process.argv[2] || path.join(root, 'docs/redesign/arr')); fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1000, height: 455 }, deviceScaleFactor: 2 })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, floatPlugins: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(900);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const ev = (fn, a) => page.evaluate(fn, a);
await ev(async () => {
  const P = await import('./js/project.js'), Th = await import('./js/theme.js');
  P.newProject(false); ['midi', 'drum', 'midi', 'midi', 'midi', 'midi'].forEach((k) => P.addTrack(k));
  const cols = ['#ff3fd2', '#1fd8b8', '#3dff3d', '#e6f53c', '#5aa2ff', '#ff8a3c'];
  P.state.tracks.forEach((t, i) => { t.color = cols[i % 6]; for (let q = 0; q < 3; q++) { const c = P.addClip(i, (q * 6 + i) * P.BAR, 4 * P.BAR); for (let n = 0; n < 16; n++) c.notes.push({ t: n * 240, d: 200, p: 48 + ((n * 5 + i) % 12), v: 0.8 }); } P.clipChanged(i); });
  Th.applyTheme('middark'); if (!document.getElementById('view-arr').classList.contains('shut')) document.querySelector('#btn-shut').click(); P.selectTrack(0); P.emit('all');
});
await page.waitForTimeout(700);
const cv = page.locator('#arr canvas').first(), bx = await cv.boundingBox();
const geo = () => ev(async () => { const T = await import('./js/timeline.js'), P = await import('./js/project.js'); const r = document.querySelector('#arr canvas').getBoundingClientRect(); return { w: r.width, cw: r.width - T.headWidth(), h: r.height, ppt: T.view.ppt, x0: T.view.x0, rowH: T.view.rowH, marks: P.state.markers.length, tick: P.currentTick() }; });
const g0 = await geo(), K = bx.width / g0.w;   // the app may be zoomed: canvas units -> screen px
const tap = async (x, y) => { await page.mouse.click(bx.x + x * K, bx.y + y * K); await page.waitForTimeout(650); };
await page.screenshot({ path: path.join(out, 'arr-middark.png') });
// Set Locator: a locator at the insert marker; Previous / Next Locator jump between them
await ev(async () => { const P = await import('./js/project.js'); P.seekTo(4 * P.BAR); }); await tap(g0.cw + 20, 20); const g1 = await geo();
await ev(async () => { const P = await import('./js/project.js'); P.seekTo(9 * P.BAR); }); await tap(g0.cw + 20, 20); const g2 = await geo();
await tap(g0.cw + 6 + 30 + 3 + 12, 20); const g3 = await geo();
ok(g1.marks === g0.marks + 1 && g2.marks === g0.marks + 2 && g3.tick < g2.tick, `Set adds a locator at the insert marker (${g0.marks} -> ${g2.marks}); Previous Locator jumps back (tick ${Math.round(g2.tick)} -> ${Math.round(g3.tick)})`);
// Optimize Width (W) and Height (H)
await tap(g0.cw - 177 + 9, g0.h - 9); await page.waitForTimeout(700); const gw = await geo();
await tap(g0.cw - 198 + 9, g0.h - 9); await page.waitForTimeout(700); const gh = await geo();
const fits = await ev(async () => { const T = await import('./js/timeline.js'), P = await import('./js/project.js'); const end = P.state.tracks.reduce((m, t) => t.clips.reduce((a, c) => Math.max(a, c.start + c.len), m), 0); const r = document.querySelector('#arr canvas').getBoundingClientRect(); return { endPx: (end - T.view.x0) * T.view.ppt, cw: r.width - T.headWidth(), lastTop: T.probe(0, P.state.tracks.length - 1).top, h: r.height }; });
ok(Math.abs(gw.ppt - g0.ppt) > 1e-6 && fits.endPx <= fits.cw + 2 && fits.endPx > fits.cw * 0.7, `W fits the Arrangement into the width (end at ${Math.round(fits.endPx)} of ${Math.round(fits.cw)} px)`);
ok(gh.rowH !== gw.rowH && fits.lastTop < fits.h - 30, `H fits the tracks into the height (row ${Math.round(gw.rowH)} -> ${Math.round(gh.rowH)} px, last track at ${Math.round(fits.lastTop)} of ${Math.round(fits.h)})`);
await page.screenshot({ path: path.join(out, 'arr-fit.png') });
// control bar: separate flat buttons of one size; Play lights green while playing, the metronome orange
{ const q = await ev(() => { const r = (id) => { const e = document.querySelector(id), b = e.getBoundingClientRect(), c = getComputedStyle(e); return { w: Math.round(b.width), h: Math.round(b.height), rad: c.borderTopLeftRadius, svg: !!e.querySelector('svg') }; }; return ['#btn-browser', '#btn-rew', '#btn-play', '#btn-rec', '#btn-metro', '#btn-menu'].map(r); });
  ok(q.every((x) => x.svg && x.h === q[0].h && x.rad === '0px') && q.slice(1, 5).every((x) => x.w === q[1].w), `control bar: six icon buttons, one height (${q[0].h} px), square as Live 12 (radius ${q[0].rad}), transport buttons one width (${q[1].w} px)`);
  await page.locator('#top').screenshot({ path: path.join(out, 'controlbar.png') }); }
// Live's control bar fields: song position "1. 1. 1", loop start / switch / length, time signature
{ await ev(async () => { const P = await import('./js/project.js'); P.setLoop({ start: 2 * P.BAR, end: 6 * P.BAR, on: false }); P.seekTo(4 * P.BAR + P.BEAT); }); await page.waitForTimeout(400);
  const t0 = await ev(() => ({ pos: document.querySelector('#rd-pos2').textContent, ls: document.querySelector('#rd-lst').textContent, ll: document.querySelector('#rd-llen').textContent, sig: document.querySelector('#rd-sig2').textContent }));
  await page.locator('#btn-loop').click(); await page.waitForTimeout(300); const on = await ev(async () => (await import('./js/project.js')).state.loop.on);
  ok(t0.pos === '5. 2. 1' && t0.ls === '3. 1. 1' && t0.ll === '4. 0. 0' && t0.sig === '4 / 4' && on, `control bar fields as Live's: position ${t0.pos}, loop ${t0.ls} / ${t0.ll}, ${t0.sig}; the loop switch turns the loop on`);
  await ev(async () => { const P = await import('./js/project.js'); P.setLoop({ on: false }); P.seekTo(0); }); }
// lit states of the transport: Play green while playing, Record red while armed, the metronome orange
{ await ev(() => { document.querySelector('#btn-metro').click(); document.querySelector('#btn-play').click(); }); await page.waitForTimeout(500);
  const on = await ev(() => ['#btn-play', '#btn-metro'].map((id) => { const e = document.querySelector(id); return { on: e.classList.contains('on'), bg: getComputedStyle(e).backgroundColor }; }));
  await page.locator('#top').screenshot({ path: path.join(out, 'controlbar-on.png') });
  await ev(() => { document.querySelector('#btn-play').click(); document.querySelector('#btn-metro').click(); }); await page.waitForTimeout(300);
  ok(on[0].on && on[1].on && on[0].bg !== on[1].bg, `Play lit (${on[0].bg}) and metronome lit (${on[1].bg}) while playing`); }
// Automation Mode: off hides the automation lanes, on brings them back; Waveform Vertical Zoom steps through its levels
{ const lanes = () => ev(async () => { const T = await import('./js/timeline.js'), P = await import('./js/project.js'); const i = P.state.tracks.findIndex((t) => t.kind === 'auto'); if (i < 0) return null; const q = T.probe(0, i); return 2 * (q.y - q.top); });   // the row's own height (the Master row now sits at the bottom)
  await ev(async () => { const P = await import('./js/project.js'); P.addAutoTrack({ kind: 6, strip: 'master', param: 0, def: P.TEMPO_DEF }, 'Tempo'); P.emit('all'); });
  await page.waitForTimeout(400); const h0 = await lanes();
  if (h0 == null) console.log('     (no automation lane could be made from the test: Automation Mode checked by its switch only)');
  const g = await geo(); await tap(g.cw + 6 + 30 + 2 * 24 + 8 + 13, 17); await page.waitForTimeout(700); const h1 = await lanes(), off = await ev(async () => (await import('./js/prefs.js')).prefs.autoMode);
  await tap(g.cw + 6 + 30 + 2 * 24 + 8 + 13, 17); await page.waitForTimeout(700); const h2 = await lanes(), on2 = await ev(async () => (await import('./js/prefs.js')).prefs.autoMode);
  ok(off === false && on2 === true && (h0 == null || (h0 > 10 && h1 < 2 && h2 > 10)), `Automation Mode switch: off -> on (${off} -> ${on2})` + (h0 != null ? `, lane height ${Math.round(h0)} -> ${Math.round(h1)} -> ${Math.round(h2)} px` : ''));
  const z0 = await ev(async () => (await import('./js/prefs.js')).prefs.waveZoom || 1); await tap(g.cw - 242 + 19, g.h - 9); const z1 = await ev(async () => (await import('./js/prefs.js')).prefs.waveZoom || 1);
  ok(z1 > z0, `Waveform Vertical Zoom: ${z0}x -> ${z1}x`); await ev(async () => { const p = await import('./js/prefs.js'); p.prefs.waveZoom = 1; }); }
// theme adjustments on top of a theme: brightness lifts the greys, tone tints them, hue turns the accent; reset restores the theme exactly
const tok = () => ev(() => { const s = getComputedStyle(document.documentElement); return { bg: s.getPropertyValue('--bg').trim(), acc: s.getPropertyValue('--accent').trim() }; });
const t0 = await tok();
for (const [name, adj, file] of [['brightness +50 %', { brightness: 0.5 }, 'theme-bright'], ['tone warm', { brightness: 0, tone: 1 }, 'theme-warm'], ['tone cool + hue', { tone: -1, hue: 150, intensity: -0.3 }, 'theme-cool-hue'], ['contrast', { tone: 0, hue: 0, intensity: 0, contrast: 0.8 }, 'theme-contrast']]) {
  await ev(async (a) => { const Th = await import('./js/theme.js'); Th.setThemeAdjust(a); }, adj); await page.waitForTimeout(350); await page.screenshot({ path: path.join(out, file + '.png') });
  const t = await tok(); console.log('     ' + name + ': --bg ' + t0.bg + ' -> ' + t.bg + ', --accent ' + t0.acc + ' -> ' + t.acc); if (name.startsWith('brightness')) ok(parseInt(t.bg.slice(1, 3), 16) > parseInt(t0.bg.slice(1, 3), 16) + 15, 'brightness lifts the background'); if (name.startsWith('tone warm')) ok(parseInt(t.bg.slice(1, 3), 16) > parseInt(t.bg.slice(5, 7), 16), 'warm tone: more red than blue in the greys'); if (name.includes('hue')) ok(t.acc !== t0.acc, 'hue turns the accent colour'); if (name.includes('hue')) { const c = await ev(async () => (await import('./js/theme.js')).tone('#ff3fd2')); ok(c !== '#ff3fd2', 'hue also turns the clip colours (#ff3fd2 -> ' + c + ')'); }
}
await ev(async () => { const Th = await import('./js/theme.js'); Th.setThemeAdjust({ tone: 0, brightness: 0, contrast: 0, intensity: 0, hue: 0 }); }); const t9 = await tok();
ok(t9.bg === t0.bg && t9.acc === t0.acc, 'reset: the theme is back exactly');
// Settings -> Tampilan: the theme sliders (bipolar ones filled from the centre); moving Brightness changes the theme at once
{ await ev(async () => { const S = await import('./js/settingsui.js'); S.openSettings(); }); await page.waitForTimeout(700);
  await ev(() => { const t = [...document.querySelectorAll('[data-t]')].find((x) => /Tampilan/.test(x.dataset.t) || x.textContent.trim() === 'Tampilan'); if (t) t.click(); }); await page.waitForTimeout(400);
  const has = await ev(() => document.querySelectorAll('.thm-adj input').length);
  if (has) {
    const sl = page.locator('.thm-adj input').nth(1); await sl.scrollIntoViewIfNeeded(); const b0 = await tok(), sb = await sl.boundingBox();
    await page.mouse.click(sb.x + sb.width * 0.8, sb.y + sb.height / 2); await page.waitForTimeout(300); const b1 = await tok();
    await page.locator('.thm-adjs').screenshot({ path: path.join(out, 'theme-sliders.png') });
    ok(b1.bg !== b0.bg, `Settings Brightness slider: tapping right of centre lifts --bg (${b0.bg} -> ${b1.bg})`);
    await ev(async () => { const Th = await import('./js/theme.js'); Th.setThemeAdjust({ tone: 0, brightness: 0, contrast: 0, intensity: 0, hue: 0 }); const p = await import('./js/prefs.js'); p.prefs.themeAdj = null; }); await page.keyboard.press('Escape'); await page.mouse.click(4, 4); await page.waitForTimeout(300); }
  else console.log('     (settings dialog not opened from the test)'); }
for (const th of ['dark', 'light', 'midlight', 'live', 'lightlc', 'medc']) { await ev(async (th) => { const Th = await import('./js/theme.js'); Th.applyTheme(th); }, th); await page.waitForTimeout(350); await page.screenshot({ path: path.join(out, 'arr-' + th + '.png') }); }
// Live's grid menu (Grid field, bottom right): Snap to Grid, Adaptive / Fixed Grid, Triplet Grid; a fixed 2 Bars grid shows in the field
{ const g = await geo(), K3 = bx.width / g.w; await page.mouse.click(bx.x + (g.cw - 150 + 46) * K3, bx.y + (g.h - 9) * K3); await page.waitForTimeout(450);
  const items = await ev(() => [...document.querySelectorAll('.menu .mi')].map((x) => x.textContent)); await page.screenshot({ path: path.join(out, 'grid-menu.png') });
  await ev(() => { const it = [...document.querySelectorAll('.menu .mi')].find((x) => x.textContent === '2 Bars'); if (it) it.click(); }); await page.waitForTimeout(400);
  const st = await ev(async () => (await import('./js/timeline.js')).snapTicks()), bar = await ev(async () => (await import('./js/project.js')).BAR);
  ok(['Snap to Grid', 'ADAPTIVE GRID', 'Widest', 'FIXED GRID', '8 Bars', '1/32', 'Narrow Grid', 'Widen Grid', 'Triplet Grid', 'Zoom to Fit'].every((x) => items.includes(x)) && st === 2 * bar, `grid menu as Live's (${items.length} entries); Fixed 2 Bars -> snap ${st / bar} bars`);
}
// Lock Envelopes: off (Live's default) a dragged clip takes its track's automation along; on, the automation stays at the song position
{ const setup = () => ev(async () => { const P = await import('./js/project.js'), T = await import('./js/timeline.js'), D = await import('./js/defs.js');
    P.newProject(false); P.addTrack('midi'); const c = P.addClip(0, 0, 4 * P.BAR); c.notes.push({ t: 0, d: 480, p: 60, v: 0.8 }); P.clipChanged(0);
    const lane = P.addAutoTrack({ kind: 5, strip: P.stripOf(0), param: 4, def: D.INSTRUMENTS[P.state.tracks[0].inst.type].params[4] }, 'Cutoff');
    const ai = P.state.tracks.indexOf(lane); lane.clips = [{ id: 777001, start: 0, len: 12 * P.BAR, name: '', pts: [{ t: 0, v: 0.2 }, { t: 2 * P.BAR, v: 0.9 }, { t: 4 * P.BAR - 1, v: 0.2 }, { t: 12 * P.BAR - 1, v: 0.2 }] }];
    T.view.x0 = 0; T.view.ppt = (document.querySelector('#arr canvas').getBoundingClientRect().width - T.headWidth()) / (14 * P.BAR); P.selectTrack(0); P.emit('all'); return { ai }; });
  const peakAt = () => ev(async () => { const P = await import('./js/project.js'); const lane = P.state.tracks.find((t) => t.kind === 'auto'); const abs = []; for (const c of lane.clips) for (const p of c.pts) abs.push([c.start + p.t, p.v]); abs.sort((a, b) => a[0] - b[0]); const top = abs.reduce((m, p) => (p[1] > m[1] ? p : m), [0, -1]); return { bar: top[0] / P.BAR, start: P.state.tracks[0].clips[0].start / P.BAR }; });
  const dragClip = async () => { const q = await ev(async () => { const T = await import('./js/timeline.js'), P = await import('./js/project.js'); const p = T.probe(1 * P.BAR, 0), r = document.querySelector('#arr canvas').getBoundingClientRect(); return { x: p.x, y: p.top + 6, x2: T.probe(5 * P.BAR, 0).x, k: r.width / document.querySelector('#arr canvas').clientWidth }; });
    const K2 = bx.width / (await geo()).w; await page.mouse.move(bx.x + q.x * K2, bx.y + q.y * K2); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.move(bx.x + q.x2 * K2, bx.y + q.y * K2, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(400); };
  await ev(async () => { const p = await import('./js/prefs.js'); p.prefs.lockEnv = false; }); await setup(); await page.waitForTimeout(400); const a0 = await peakAt(); await dragClip(); const a1 = await peakAt();
  await page.screenshot({ path: path.join(out, 'lock-envelopes-off.png') });
  await ev(async () => { const p = await import('./js/prefs.js'); p.prefs.lockEnv = true; }); await setup(); await page.waitForTimeout(400); await dragClip(); const b1 = await peakAt();
  await ev(async () => { const p = await import('./js/prefs.js'); p.prefs.lockEnv = false; });
  await page.screenshot({ path: path.join(out, 'automation-over-clips.png') });   // Automation Mode: the lane's curve drawn over the track's clip
  const red = await ev(async () => { const T = await import('./js/timeline.js'), P = await import('./js/project.js'); const c = document.querySelector('#arr canvas'), g = c.getContext('2d'), d = window.devicePixelRatio || 1, q = T.probe(6 * P.BAR, 0); let n = 0;
    const im = g.getImageData(Math.round(q.x * d) - 40, Math.round(q.top * d), 80, Math.round((T.probe(0, 1).top - q.top) * d)).data; for (let k = 0; k < im.length; k += 4) if (im[k] > 220 && im[k + 1] < 110 && im[k + 2] < 110) n++; return n; });
  ok(red > 20, `Automation Mode draws the track's automation over its clip in red (${red} red pixels around bar 6)`);
  ok(a1.start === 4 && a1.bar === a0.bar + 4 && b1.start === 4 && b1.bar === a0.bar, `Lock Envelopes off: clip bar ${a0.start} -> ${a1.start}, its automation peak bar ${a0.bar} -> ${a1.bar}; on: the peak stays at bar ${b1.bar}`); }
// Honeydew's clip handles on a selected audio clip: the end capsule (outside its right edge) sets the length, the start capsule trims the start
// with the audio in place, and the bar under its right end stretches the audio at once (no Stretch mode)
{ const setup = () => ev(async () => { const P = await import('./js/project.js'), T = await import('./js/timeline.js'), W = await import('./js/waveform.js');
    P.newProject(false); P.addTrack('audio'); const n = 48000 * 8, l = new Float32Array(n); for (let k = 0; k < n; k++) l[k] = Math.sin(k / 20) * (0.3 + 0.7 * Math.abs(Math.sin(k / 9000)));
    const smp = { id: 0, path: 'test/handles.wav', name: 'handles.wav', duration: 8, pyr: W.buildPyramid(l, l), peaks: [] }; P.state.samples[smp.path] = smp;
    P.state.tracks[0].clips.push({ id: 880001, start: 2 * P.BAR, len: 4 * P.BAR, name: '', sample: smp, offset: 0, gain: 1 });
    T.view.x0 = 0; T.view.ppt = (document.querySelector('#arr canvas').getBoundingClientRect().width - T.headWidth()) / (12 * P.BAR); P.selectTrack(0); P.selectClip(0, 880001); P.emit('all'); });
  const clip = () => ev(async () => { const P = await import('./js/project.js'); const c = P.state.tracks[0].clips[0]; return { s: c.start / P.BAR, l: c.len / P.BAR, o: c.offset }; });
  const pos = (bar, dy) => ev(async ([bar, dy]) => { const T = await import('./js/timeline.js'), P = await import('./js/project.js'); const q = T.probe(bar * P.BAR, 0), b = { top: q.top + 2 * (q.y - q.top) }; return { x: q.x, y: dy === 'mid' ? (q.top + b.top) / 2 : dy === 'below' ? b.top + 9 : q.top }; }, [bar, dy]);
  const g = await geo(), K4 = bx.width / g.w;
  const dragBy = async (p, dxBars, hold) => { const step = (await pos(1, 'mid')).x - (await pos(0, 'mid')).x; await page.mouse.move(bx.x + p.x * K4, bx.y + p.y * K4); await page.mouse.down(); await page.waitForTimeout(60);
    await page.mouse.move(bx.x + (p.x + dxBars * step) * K4, bx.y + p.y * K4, { steps: 8 }); const mid = await clip(); if (!hold) { await page.mouse.up(); await page.waitForTimeout(400); } return mid; };
  await setup(); await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, 'clip-handles.png') });
  let p = await pos(6, 'mid'); p.x += 9; await dragBy(p, 2); const r1 = await clip();
  await setup(); await page.waitForTimeout(300); p = await pos(2, 'mid'); p.x += 5; await dragBy(p, 2); const r2 = await clip();   // the grid is 2 bars here (set by the grid menu test)
  await setup(); await page.waitForTimeout(300); p = await pos(6, 'below'); const mid = await dragBy(p, 2, true); await page.screenshot({ path: path.join(out, 'clip-stretch.png') }); await page.mouse.up(); await page.waitForTimeout(500);
  await setup(); await page.waitForTimeout(300); { const q = await pos(2, 'top'); const st = (await pos(1, 'mid')).x - (await pos(0, 'mid')).x;
    await page.mouse.move(bx.x + (q.x + 6) * K4, bx.y + (q.y + 20) * K4); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.move(bx.x + (q.x + 6 + st * 0.5) * K4, bx.y + (q.y + 20) * K4, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300); }
  const fi = await ev(async () => (await import('./js/project.js')).state.tracks[0].clips[0].fadeIn || 0);
  ok(fi > 0.5 && fi < 1.5, `fade-in handle (top left corner): dragged half a bar -> fade in ${fi.toFixed(2)} s`);
  ok(r1.s === 2 && r1.l === 6, `end capsule: length 4 -> ${r1.l} bars, start stays at bar ${r1.s + 1}`);
  ok(r2.s === 4 && r2.l === 2 && r2.o > 3.9 && r2.o < 4.1, `start capsule: start bar 3 -> ${r2.s + 1}, length ${r2.l}, audio offset ${r2.o.toFixed(2)} s (the audio stays in place)`);
  ok(mid.l > 5.5, `the bar under the clip stretches it while dragged: length 4 -> ${mid.l.toFixed(2)} bars, without Stretch mode`); }
// Honeydew's Chop...: a 4-bar MIDI clip every 1 beat = 16 clips end to end; an audio clip at its transients = one clip per hit
{ const r = await ev(async () => { const P = await import('./js/project.js'), T = await import('./js/timeline.js'), W = await import('./js/waveform.js');
    P.newProject(false); P.addTrack('midi'); const c = P.addClip(0, 0, 4 * P.BAR); for (let k = 0; k < 16; k++) c.notes.push({ t: k * 480, d: 240, p: 60, v: 0.8 }); P.clipChanged(0);
    T.testChop(0, c.id, { every: 1 }); const m = P.state.tracks[0].clips.map((q) => [q.start, q.len]).sort((a, b) => a[0] - b[0]);
    P.addTrack('audio'); const sr = 44100, n = sr * 4, l = new Float32Array(n); for (const at of [0.1, 0.9, 1.7, 2.6, 3.3]) { const s0 = Math.round(at * sr); for (let k = 0; k < sr * 0.6 && s0 + k < n; k++) l[s0 + k] += Math.exp(-k / 3000) * Math.sin(k / 7); }
    const smp = { id: 0, path: 'test/chop.wav', name: 'chop.wav', duration: 4, pyr: W.buildPyramid(l, l), peaks: [] }; P.state.samples[smp.path] = smp;
    P.state.tracks[1].clips.push({ id: 990001, start: 0, len: 4 * P.BAR, name: '', sample: smp, offset: 0, gain: 1 }); T.testChop(1, 990001, { transients: true });
    return { m, contiguous: m.every((q, k) => k === 0 || q[0] === m[k - 1][0] + m[k - 1][1]), beat: P.BEAT, audio: P.state.tracks[1].clips.length }; });
  ok(r.m.length === 16 && r.contiguous && r.m.every((q) => q[1] === r.beat), `Chop every 1 beat: 4 bars -> ${r.m.length} clips of one beat, end to end`);
  ok(r.audio === 6, `Chop at transients: an audio clip with 5 hits -> ${r.audio} clips (the lead-in before the first hit, then one per hit)`); }
// MIDI editor: Live 12's velocity tools - Ramp lines the velocities up from the first note to the last, Randomize moves each one
{ await ev(async () => { const P = await import('./js/project.js'), T = await import('./js/timeline.js'); P.newProject(false); P.addTrack('midi');
    const c = P.addClip(0, 0, 2 * P.BAR); for (let k = 0; k < 16; k++) c.notes.push({ t: k * 240, d: 200, p: 60 + (k % 8), v: 0.4 + 0.5 * ((k * 7) % 10) / 10 }); c.notes[15].v = 0.9; c.notes[0].v = 0.3;
    P.clipChanged(0); P.selectClip(0, c.id); P.emit('all'); T.openEditor(); }); await page.waitForTimeout(800);
  const vs = () => ev(async () => (await import('./js/project.js')).state.tracks[0].clips[0].notes.slice().sort((a, b) => a.t - b.t).map((n) => n.v));
  await ev(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Ramp').click()); await page.waitForTimeout(300); const r = await vs();
  await page.screenshot({ path: path.join(out, 'editor-velocity.png') });
  await ev(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Randomize').click()); await page.waitForTimeout(300); const q = await vs();
  ok(r.every((x, k) => k === 0 || x >= r[k - 1] - 1e-9) && Math.abs(r[0] - 0.3) < 1e-6 && Math.abs(r[15] - 0.9) < 1e-6 && q.filter((x, k) => Math.abs(x - r[k]) > 1e-3).length >= 12,
    `MIDI editor velocity tools: Ramp ${Math.round(r[0] * 127)} -> ${Math.round(r[15] * 127)} in a line, Randomize moved ${q.filter((x, k) => Math.abs(x - r[k]) > 1e-3).length} of 16`); }
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\narr-live-test: ${bad} FAILED` : '\narr-live-test: all passed'); process.exit(bad ? 1 : 0);
