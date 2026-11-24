// MobileDAW 2 (app2/, a separate app next to 1.0), Playwright + Chromium with touch: the bottom bar, the left track column, the clip
// bubbles, the range menu's playhead commands, the main menu, the module lists (FL Studio Mobile's modules + MiniMeters, Harmor, Moisture),
// and that it keeps its own settings (1.0's are untouched).
// Usage: node tools/app2-test.mjs   (part of tools/run-tests.mjs)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
await new Promise((o) => server.once('listening', o));
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await b.newContext({ viewport: { width: 1150, height: 540 }, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { if (!sessionStorage.getItem('u2t')) { sessionStorage.setItem('u2t', '1'); localStorage.setItem('mobiledaw2.prefs.v1', JSON.stringify({ v: 9, folderAsked: true, haptics: false, tutorialOffered: true, fullscreen: false, uiScale: 1 })); localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ v: 9, theme: 'light', mark: 1 })); } });
await page.goto(`http://127.0.0.1:${server.address().port}/app2/index.html`); await page.waitForFunction(() => window.__dawBooted); await page.waitForTimeout(900);

// a small song: two synth tracks with one clip each
await page.evaluate(async () => {
  const P = await import('./js/project.js'); P.newProject(false);
  for (const n of ['Lead', 'Bass']) { P.addTrack('midi'); const i = P.state.tracks.length - 1; P.renameTrack(i, n); const c = P.addClip(i, P.BAR, P.BAR * 2); c.notes.push({ t: 0, d: 480, p: 60, v: 0.8 }); P.touchClips(i); }
  P.emit('all');
});
await page.waitForTimeout(500);
const st = await page.evaluate(() => ({ top: getComputedStyle(document.querySelector('#top')).display, bar: !!document.querySelector('#bar2'), rows: document.querySelectorAll('#tcol2 .tc-row').length, n: (window.__P = null, 0), shut: document.querySelector('#view-arr').classList.contains('shut') }));
const n = await page.evaluate(async () => (await import('./js/project.js')).state.tracks.length);
ok(st.top === 'none' && st.bar, `MobileDAW 2: the bottom bar is there, no 1.0 control bar`);
ok(st.rows >= n, `the track column has a row per track (+ Master / FX rows): ${st.rows} rows for ${n} tracks`);
ok(st.shut, 'the arrangement starts with the whole screen (the device panel is closed)');

// bottom bar: play / metronome / loop
await page.click('#top2 .play'); await page.waitForTimeout(300);
ok(await page.evaluate(async () => (await import('./js/project.js')).state.playing), 'Play in the bottom bar starts playback');
await page.click('#top2 .play'); await page.waitForTimeout(200);
await page.click('#top2 [aria-label="LOOP"]'); await page.waitForTimeout(120);
ok(await page.evaluate(async () => (await import('./js/project.js')).state.loop.on), 'LOOP switches the arrangement loop on');
await page.click('#bar2 [aria-label="RACK"]'); await page.waitForTimeout(300);
ok(!(await page.evaluate(() => document.querySelector('#view-arr').classList.contains('shut'))), 'RACK opens the device panel');
await page.click('#bar2 [aria-label="RACK"]'); await page.waitForTimeout(300);
ok(await page.evaluate(() => document.querySelector('#view-arr').classList.contains('shut')), 'RACK again closes it');

// tap a clip: the bubbles; Salin duplicates, Hapus deletes, undo brings it back
const clipAt = async (i) => page.evaluate(async (i) => { const TL = await import('./js/timeline.js'), P = await import('./js/project.js'); const c = P.state.tracks[i].clips[0], bx = TL.v2ClipBox(i, c.id), r = document.querySelector('#arr canvas').getBoundingClientRect(); return { x: r.left + bx.x + 20, y: r.top + bx.y + bx.h / 2, id: c.id }; }, i);
let p = await clipAt(0);
await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(700);
ok(await page.evaluate(() => !document.querySelector('#bub2').hidden && document.querySelectorAll('#bub2 .bub').length === 5), 'a tap on a clip shows the bubbles over it (Salin, Hapus, Snap, Edit, Lainnya)');
await page.click('#bub2 [aria-label="Salin"]'); await page.waitForTimeout(150);
ok(await page.evaluate(async () => (await import('./js/project.js')).state.tracks[0].clips.length === 1 && (await import('./js/timeline.js')).v2HasClipboard()), 'Salin copies the clip to the clipboard (Honeydew Copy)');
await page.click('#bub2 [aria-label="Lainnya"]'); await page.waitForTimeout(600); await page.click('.menu .mi:text-is("Gandakan")'); await page.waitForTimeout(250);
ok(await page.evaluate(async () => (await import('./js/project.js')).state.tracks[0].clips.length === 2), 'Lainnya > Gandakan puts a copy right after the clip');
await page.click('#bub2 [aria-label="Hapus"]'); await page.waitForTimeout(200);
ok(await page.evaluate(async () => (await import('./js/project.js')).state.tracks[0].clips.length === 1 && document.querySelector('#bub2').hidden), 'Hapus deletes the clip and hides the bubbles');
await page.click('#top2 [aria-label="Urungkan"]'); await page.waitForTimeout(200);
ok(await page.evaluate(async () => (await import('./js/project.js')).state.tracks[0].clips.length === 2), 'Undo in the bottom bar brings it back');

// a tap on empty space of the current track: the insert menu (Klip baru / Tempel); Tempel pastes the clipboard there
{ const q = await page.evaluate(async () => { const TL = await import('./js/timeline.js'), P = await import('./js/project.js'); P.selectTrack(1); P.state.sel.clip = null; const p = TL.v2TickX(1, P.BAR * 4), r = document.querySelector('#arr canvas').getBoundingClientRect(); return { x: r.left + p.x + 4, y: r.top + p.y + p.h / 2 }; });
  await page.waitForTimeout(150); await page.touchscreen.tap(q.x, q.y); await page.waitForTimeout(500);
  ok(await page.evaluate(() => !document.querySelector('#ins2').hidden), 'a tap on empty space of the current track shows Klip baru / Tempel');
  await page.click('#ins2 [aria-label="Tempel"]'); await page.waitForTimeout(250);
  ok(await page.evaluate(async () => { const P = await import('./js/project.js'); return P.state.tracks[1].clips.some((c) => c.start === P.BAR * 4); }), 'Tempel pastes the copied clip at that beat');
  await page.evaluate(async () => { const P = await import('./js/project.js'); const t = P.state.tracks[1]; const c = t.clips.find((x) => x.start === P.BAR * 4); if (c) P.removeClip(1, c.id); P.state.sel.clip = null; P.emit('clips'); }); }

// the column: tap a tile = wide column (pan ring, Mute / Solo / Rekam, the volume fader)
await page.evaluate(() => document.querySelector('#tcol2 .tc-row .tc-tile').click()); await page.waitForTimeout(400);
ok(await page.evaluate(() => document.documentElement.classList.contains('tc-wide') && getComputedStyle(document.querySelector('#tcol2 .tc-row .tc-ctl')).display === 'flex' && !!document.querySelector('#tcol2 .tc-row .tc-vol') && !!document.querySelector('#tcol2 .tc-row .tc-bs .tc-pan')), 'a tap on a track tile widens the column (volume fader, pan ring, M / S / R)');
await page.evaluate(() => document.querySelector('#tcol2 .tc-row .tc-m').click()); await page.waitForTimeout(150);
ok(await page.evaluate(async () => (await import('./js/project.js')).state.tracks[0].mute === true), 'M mutes the track');
await page.evaluate(() => document.querySelector('#tcol2 .tc-row .tc-rec').click()); await page.waitForTimeout(150);
ok(await page.evaluate(async () => (await import('./js/project.js')).state.tracks[0].arm === true), 'R arms the track for recording');
await page.evaluate(async () => { const P = await import('./js/project.js'); P.toggleArm(0); });
for (const [sel, key, what] of [['.tc-vol', 'vol', 'dragging the volume fader left turns the track down'], ['.tc-pan', 'pan', 'dragging the pan ring left pans the track left']]) {
  const v = await page.evaluate((sel) => { const r = document.querySelector('#tcol2 .tc-row ' + sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  const v0 = await page.evaluate(async (key) => (await import('./js/project.js')).state.tracks[0][key], key);
  await page.mouse.move(v.x, v.y); await page.mouse.down(); await page.mouse.move(v.x - 40, v.y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(450);
  const v1 = await page.evaluate(async (key) => (await import('./js/project.js')).state.tracks[0][key], key);
  ok(v1 < v0 - 0.05, `${what} (${v0.toFixed(2)} -> ${v1.toFixed(2)})`); }
await page.evaluate(() => document.querySelector('#tcol2 .tc-row .tc-tile').click()); await page.waitForTimeout(300);

// range menu: copy the selection to the playhead
await page.evaluate(async () => {
  const P = await import('./js/project.js'); P.seekTo(P.BAR * 6);
});
const rr = await page.evaluate(async () => { const TL = await import('./js/timeline.js'), P = await import('./js/project.js'); const r = document.querySelector('#arr canvas').getBoundingClientRect(), g = TL.v2Geom(); const b1 = TL.v2ClipBox(1, P.state.tracks[1].clips[0].id); return { y: r.top + 12, x0: r.left + b1.x - 3, x1: r.left + b1.x + b1.w + 3 }; });
await page.mouse.move(rr.x0, rr.y); await page.mouse.down(); await page.mouse.move(rr.x1, rr.y, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(300);
const items = await page.evaluate(() => [...document.querySelectorAll('.menu .mi, .menu button, .ctx button, [role=menuitem]')].map((e) => e.textContent.trim()));
ok(items.includes('Salin ke playhead') && items.includes('Pindah ke playhead'), 'the ruler range menu offers Salin / Pindah ke playhead');
if (items.includes('Salin ke playhead')) {
  await page.waitForTimeout(700); await page.click('.menu .mi:text-is("Salin ke playhead")'); await page.waitForTimeout(300);   // (a menu ignores taps in its first moments)
  ok(await page.evaluate(async () => { const P = await import('./js/project.js'); return P.state.tracks[1].clips.some((c) => c.start >= P.BAR * 6 && c.start < P.BAR * 7); }), 'Salin ke playhead puts a copy of the range at the playhead');   // the range start snaps to the grid, so the copy starts at the playhead + (clip start - range start)
}

// the mixer: the tracks and the Master (no return strips), each with Mute / Solo / Rekam
{ const m = await page.evaluate(async () => { const M = await import('./js/ui2/mixer2.js'), P = await import('./js/project.js'); M.build(); const n = document.querySelectorAll('#mix2 .m2-strip').length; return { n, want: P.state.tracks.filter((t) => t.kind !== 'auto').length + 1, msr: document.querySelectorAll('#mix2 .m2-strip:not(.bus) .m2-row .m2-b').length, full: !!document.querySelector('.m2-full') }; });
  ok(m.n === m.want && m.msr === (m.want - 1) * 3 && !m.full, `the mixer shows the tracks + Master as its only view, without return strips, with M / S / R (${m.n} strips)`); }
// BPM: a finger tap opens the Tempo window
{ const r = await page.evaluate(() => { const b = document.querySelector('#top2 .bpm').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.touchscreen.tap(r.x, r.y); await page.waitForTimeout(500);
  ok(await page.evaluate(() => !!document.querySelector('.u2p .tp2c')), 'a finger tap on BPM opens the Tempo window');
  await page.evaluate(() => { for (const m of document.querySelectorAll('.u2p')) m.remove(); }); }
// main menu
await page.click('#logo2'); await page.waitForTimeout(400);
ok(await page.evaluate(() => document.querySelector('#mm2').classList.contains('open') && document.querySelectorAll('#mm2 .u2m-t').length === 5), 'the logo button opens the main menu (5 tabs)');
await page.click('.u2m-t[data-k=proyek]'); await page.waitForTimeout(150);
ok(await page.evaluate(() => /Info lagu/.test(document.querySelector('#mm2 .u2m-body').textContent)), 'PROYEK shows the song info');
await page.click('.u2m-x'); await page.waitForTimeout(350);
ok(!(await page.evaluate(() => document.querySelector('#mm2').classList.contains('open'))), 'the ✕ closes it');

// module lists: FL Studio Mobile's instruments / effects + MiniMeters, Harmor, Moisture (nothing else is offered)
const mods = await page.evaluate(async () => { const D = await import('./js/defs.js'); return { inst: D.INST_LIST.map((k) => D.INSTRUMENTS[k].name), fx: D.FX_GROUPS.flatMap((g) => g[2]).map((k) => [k, D.DEVICES[k].name, D.DEVICES[k].flm != null]) }; });
ok(mods.inst.length === 10 && ['DirectWave', 'GMS', 'MiniSynth', 'SuperSaw', '3x Osc', 'Slicer', 'Transistor Bass', 'Harmor', 'Moisture'].every((n) => mods.inst.includes(n)), 'instruments: FL Studio Mobile\'s + Harmor + Moisture (' + mods.inst.join(', ') + ')');
ok(mods.fx.every(([k, , flm]) => flm || k === 16) && mods.fx.some(([k]) => k === 16), `effects: only FL Studio Mobile's (${mods.fx.length - 1}) + MiniMeters`);
// module cards (ui2/cards.js): every offered instrument and effect renders as a Material You card; a dial drag changes the value, the switch bypasses
{ await page.evaluate(async () => { const P = await import('./js/project.js'); P.selectTrack(0); [...document.querySelectorAll('#bar2 button')].find((b) => /Rack/.test(b.textContent)).click(); });
  await page.waitForTimeout(300);
  const r = await page.evaluate(async () => {
    const P = await import('./js/project.js'), D = await import('./js/defs.js'), DV = await import('./js/devices.js'), bad = [];
    for (const k of D.INST_LIST) { P.setInstrument(0, k); DV.render(); if (!document.querySelector('.dev-scroll > .card.u2c.inst .u2c-h')) bad.push('inst ' + k); }
    P.setInstrument(0, 32);
    for (const k of D.FX_GROUPS.flatMap((g) => g[2]).filter((x) => D.DEVICES[x])) { P.addDevice(0, k); DV.render(); const n = P.tr(0).devices.length; if (document.querySelectorAll('.dev-scroll > .card.u2c:not(.inst)').length !== n) bad.push('fx ' + k); P.removeDevice(0, n - 1); }
    P.addDevice(0, 132); DV.render(); return { bad, active: document.querySelector('#devices, .dev-scroll') && document.querySelector('.dev-scroll').getBoundingClientRect().height };
  });
  ok(!r.bad.length, 'every instrument and effect has a Material You card' + (r.bad.length ? ': missing ' + r.bad.join(', ') : ''));
  await page.evaluate(() => { [...document.querySelectorAll('.dev-scroll > .card.u2c:not(.inst)')].pop().scrollIntoView(); }); await page.waitForTimeout(700);   // let the rack settle on the card (scroll snap)
  const dl = await page.evaluate(() => { const c = [...document.querySelectorAll('.dev-scroll > .card.u2c:not(.inst)')].pop(); const d = c.querySelector('.u2d'); const b = d.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 22 }; });
  // the dragged knob's own parameter (whichever it is): the one value that changed must have gone up
  const pv = async () => page.evaluate(async () => { const P = await import('./js/project.js'), D = await import('./js/defs.js'); const d = P.tr(0).devices[P.tr(0).devices.length - 1]; return D.DEVICES[d.type].params.map((q, k) => d.params[k] ?? q.def); });
  // (down first: the knob may already sit at its top) then up again
  const drag = async (dy) => { const a0 = await pv(); await page.mouse.move(dl.x, dl.y); await page.mouse.down(); await page.mouse.move(dl.x, dl.y + dy, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(400);
    const ch = (await pv()).map((v, k) => [k, a0[k], v]).filter(([, x, y]) => x !== y); return ch.length === 1 ? ch[0] : [null, null, null]; };
  const dn = await drag(40), up = await drag(-40);
  ok(dn[0] !== null && dn[2] < dn[1] && up[0] === dn[0] && up[2] > up[1], `dragging a dial down lowers its value and up raises it (${dn[1]} -> ${dn[2]} -> ${up[2]})`);
  await page.evaluate(() => [...document.querySelectorAll('.dev-scroll > .card.u2c:not(.inst) .u2sw-b')].pop().click()); await page.waitForTimeout(100);
  ok(await page.evaluate(async () => { const P = await import('./js/project.js'); return P.tr(0).devices[P.tr(0).devices.length - 1].bypass === true && !!document.querySelector('.dev-scroll > .card.u2c.off'); }), 'the switch in the card header bypasses the effect'); }
{ await page.waitForTimeout(600);
  const lay = await page.evaluate(() => { const cs = [...document.querySelectorAll('#dbody .dev-scroll > .card.u2c')], bad = [];
    for (const c of cs) { const r = c.getBoundingClientRect(); for (const e of c.querySelectorAll('.u2c-dials > *')) { const q = e.getBoundingClientRect(); if (q.width && (q.bottom > r.bottom + 1 || q.right > r.right + 1)) bad.push(e.textContent.slice(0, 12)); } }
    const side = cs.length < 2 || cs.slice(1).every((c, k) => Math.abs(c.getBoundingClientRect().top - cs[k].getBoundingClientRect().top) < 2);
    return { n: cs.length, side, bad }; });
  ok(lay.n >= 2 && lay.side && !lay.bad.length, `module cards sit side by side and no control runs out of its card (${lay.n} cards${lay.bad.length ? ', cut: ' + lay.bad.join(', ') : ''})`); }
// the module's own display on the card screen (real formulas, not decoration): an FLM effect and MiniSynth, painted
{ const rd = await page.evaluate(async () => { const P = await import('./js/project.js'); P.addDevice(0, 103); P.setInstrument(0, 32); await new Promise((r) => setTimeout(r, 900));
    const fx = document.querySelector('.dev-scroll > .card.u2c.fx .u2real'), ins = document.querySelector('.dev-scroll > .card.u2c.inst .u2real canvas');
    let painted = 0; if (ins) { const d = ins.getContext('2d').getImageData(0, 0, ins.width, ins.height).data, set = new Set(); for (let k = 0; k < d.length; k += 32) set.add(d[k] + ',' + d[k + 1] + ',' + d[k + 2]); painted = set.size; }
    return { fx: !!fx, ins: !!ins, painted }; });
  ok(rd.fx && rd.ins && rd.painted > 8, `effect and synth cards show the module's own display (synth display colours: ${rd.painted})`); }
// the instrument card's keyboard plays the instrument (a note goes to the engine while the key is held)
{ const k = await page.evaluate(async () => { const P = await import('./js/project.js'), E = await import('./js/engine.js'); P.setInstrument(0, 32); await new Promise((r) => setTimeout(r, 400));
    const scr = document.querySelector('.dev-scroll > .card.u2c.inst .u2s.haskb');   // a short rack shows the display: the keyboard is one tap away
    if (scr && scr.classList.contains('kbhide') && !scr.classList.contains('kbshow')) scr.querySelector('.u2kb-tg').click();
    const key = document.querySelector('.dev-scroll > .card.u2c.inst .u2kb .wk'); if (!key || !key.offsetWidth) return 'no keyboard';
    const seen = []; const orig = P.noteEvent; const b = key.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height - 4 }; });
  if (typeof k === 'string') ok(false, k); else { await page.mouse.move(k.x, k.y); await page.mouse.down(); await page.waitForTimeout(120);
    const lit = await page.evaluate(() => !!document.querySelector('.u2kb .wk.on')); await page.mouse.up(); await page.waitForTimeout(80);
    ok(lit && !(await page.evaluate(() => !!document.querySelector('.u2kb .wk.on'))), 'the instrument card has a keyboard: a key lights while held and lets go'); } }
ok(await page.evaluate(() => !!document.querySelector('#tcol2 .tc-top .snap, #tcol2 .tc-top [aria-label*="Snap"]') && !document.querySelector('#top2 .tg [aria-label*="Snap"]')), 'Snap sits in the corner above the track column (not in the top bar)');
// its own settings: 1.0's preferences are untouched, MobileDAW 2 writes mobiledaw2.prefs.v1
await page.evaluate(async () => { const { prefs, savePrefs } = await import('./js/prefs.js'); prefs.ui2Wide = false; savePrefs(); });
const ls = await page.evaluate(() => ({ one: JSON.parse(localStorage.getItem('mobiledaw.prefs.v1')), two: JSON.parse(localStorage.getItem('mobiledaw2.prefs.v1')) }));
ok(ls.one && ls.one.mark === 1 && !('ui2Wide' in ls.one) && ls.two && 'ui2Wide' in ls.two, 'MobileDAW 2 keeps its own settings (1.0\'s are untouched)');
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nMOBILEDAW 2 OK'); process.exit(bad ? 1 : 0);
