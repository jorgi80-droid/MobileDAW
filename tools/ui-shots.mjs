// UI screenshots of the main views with a fixed test project (drums, bass, lead, pad, audio loop, automation lane, effects), for
// before / after comparisons of UI work. Serves the repo itself, drives the app with the preinstalled Playwright Chromium.
// Usage: node tools/ui-shots.mjs <out-dir> [arr] [clip] [dev] [mix] [win] [keys] [devs] [rack] [irack]      env: THEME=light|dark|..., VW / VH = viewport (default 1180 x 560), FX=33,34 = only these effects in devs, INST=13 = only these instruments
// Compare two runs (e.g. one on the previous commit, one on the working tree) side by side.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || 'ui-shots'), want = process.argv.slice(3), go = (n) => !want.length || want.includes(n);
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.mdaw': 'application/json', '.sf2': 'application/octet-stream' };
const server = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: +(process.env.VW || 1180), height: +(process.env.VH || 560) }, deviceScaleFactor: 2, hasTouch: true })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.addInitScript((th) => { try { localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, theme: th })); } catch (_) { /* no storage */ } }, process.env.THEME || 'dark');
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.evaluate(async () => {                         // the test project
  const P = await import('./js/project.js'), E = await import('./js/engine.js');
  P.newProject(true);
  const BAR = P.BAR, sr = 44100, n = sr * 4, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const wr = (o, s) => { for (let k = 0; k < s.length; k++) dv.setUint8(o + k, s.charCodeAt(k)); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE'); wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let k = 0; k < n; k++) { const t = k / sr, env = Math.exp(-(t % 0.5) * 9); dv.setInt16(44 + k * 2, Math.sin(2 * Math.PI * 110 * t) * env * 0.8 * 32000, true); }
  await E.eng.saveBytes('/Samples/Loop Tone.wav', buf);
  P.addTrack('midi').name = 'Lead'; const li = P.state.tracks.length - 1; P.setInstrument(li, 2);
  for (const [st, len] of [[0, BAR * 2], [BAR * 3, BAR], [BAR * 4, BAR * 2]]) { const c = P.addClip(li, st, len); for (let k = 0; k < len / 480; k++) c.notes.push({ t: k * 480, d: 400, p: 60 + [0, 3, 7, 10, 12, 10, 7, 3][k % 8], v: 0.5 + 0.5 * ((k * 37) % 10) / 10 }); }
  P.addTrack('midi').name = 'Pad Chords'; const pi = P.state.tracks.length - 1; P.setInstrument(pi, 1);
  { const c = P.addClip(pi, 0, BAR * 4); c.name = 'Chords'; [[48, 51, 55], [46, 50, 53], [44, 48, 51], [43, 46, 50]].forEach((ch, b) => ch.forEach((p) => c.notes.push({ t: b * BAR, d: BAR - 60, p, v: 0.7 }))); }
  P.addTrack('audio').name = 'Loop Tone'; await P.addAudioClip(P.state.tracks.length - 1, '/Samples/Loop Tone.wav', BAR);
  P.addDevice(1, 4); P.addDevice(1, 2); P.addDevice(li, 6); P.addDevice(li, 7);
  P.state.tracks[0].clips[0].name = 'Beat A';
  P.addClip(0, BAR * 2, BAR * 2).notes = P.state.tracks[0].clips[0].notes.map((x) => ({ ...x }));
  P.addClip(1, BAR * 2, BAR * 2).notes = P.state.tracks[1].clips[0].notes.map((x) => ({ ...x, p: x.p + 2 }));
  P.addAutoTrack({ kind: 0, strip: P.stripOf(li), param: 0, def: P.AUTO_VOL }, 'Lead • Volume');
  const at = P.state.tracks.length - 1, ac = P.state.tracks[at].clips[0] || P.addClip(at, 0, BAR * 4);
  ac.len = BAR * 6; ac.pts = [{ t: 0, v: 0.3 }, { t: BAR, v: 0.8 }, { t: BAR * 3, v: 0.6 }, { t: BAR * 6, v: 0.9 }];
  P.addMarker(BAR * 2); P.syncAll(); P.emit('all');
});
await page.waitForTimeout(1000);
const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(out, name + '.png') }); console.log('shot', name); };
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const sel = (i, c = 0) => ev(async ([i, c]) => { const P = await import('./js/project.js'); P.selectTrack(i); const t = P.state.tracks[i]; if (t && t.clips[c]) P.selectClip(i, t.clips[c].id); }, [i, c]);
const tab = (k) => ev((k) => document.querySelector(`#dtabs .b[data-tab="${k}"]`).click(), k);
const btn = (id) => ev((id) => document.getElementById(id).click(), id);
if (go('arr')) {
  await sel(2, 1); await shot('arr');
  await ev(async () => { const P = await import('./js/project.js'); P.setLoop({ on: true, start: P.BAR, end: P.BAR * 3 }); P.state.tracks[1].hx = 1.6; P.emit('tracks'); });   // loop brace on + one taller row
  await shot('arr-loop'); await ev(async () => { const P = await import('./js/project.js'); P.setLoop({ on: false }); delete P.state.tracks[1].hx; P.emit('tracks'); }); await btn('btn-shut'); await shot('arr-full'); await btn('btn-shut'); }
if (go('clip')) {
  await sel(1); await tab('clip'); await shot('clip'); await btn('btn-max');
  await sel(2); await ev(async () => (await import('./js/editor.js')).setTheory(0, 'Minor')); await shot('clip-midi');
  await sel(0); await shot('clip-drum');
  await ev(async () => { const P = await import('./js/project.js'); const i = P.state.tracks.findIndex((t) => t.kind === 'auto'); P.selectTrack(i); P.selectClip(i, P.state.tracks[i].clips[0].id); }); await shot('clip-auto');
  await ev(async () => { const P = await import('./js/project.js'); const i = P.state.tracks.findIndex((t) => t.kind === 'audio'); P.selectTrack(i); P.selectClip(i, P.state.tracks[i].clips[0].id); }); await shot('clip-audio');
  await btn('btn-max');
}
if (go('dev')) {
  await sel(1); await tab('dev'); await btn('btn-max'); await shot('dev');
  await ev(async () => { const P = await import('./js/project.js'); P.selectTrack(P.state.tracks.findIndex((t) => t.kind === 'audio')); }); await shot('dev-audio');
  await btn('btn-max');
}
if (go('mix')) {
  await ev(async () => { (await import('./js/project.js')).setSend(1, 0, 0.4); document.querySelector('.seg .b[data-view="mix"]').click(); }); await shot('mix');
  await ev(async () => (await import('./js/project.js')).play()); await page.waitForTimeout(1800); await shot('mix-play');
  await ev(async () => (await import('./js/project.js')).stop());
  await ev(() => document.querySelector('.seg .b[data-view="arr"]').click());
}
if (go('win')) {                                         // global windows: tempo, preferences (every tab), modal, ask, export, toast, PWA card, floating window
  const close = () => ev(async () => { (await import('./js/ui.js')).closeAll(); (await import('./js/floatwin.js')).closeAllFloats(); document.querySelectorAll('.pwa-card,.toast').forEach((e) => e.remove()); });
  await ev(async () => (await import('./js/tempo.js')).openTempo()); await shot('win-tempo'); await close();
  const tabs = await ev(async () => { (await import('./js/settingsui.js')).openSettings(); await new Promise((r) => setTimeout(r, 50)); return [...document.querySelectorAll('.btabs .b[data-t]')].map((b) => b.dataset.t); });
  for (const t of tabs) { await ev((t) => document.querySelector(`.btabs .b[data-t="${t}"]`).click(), t); await shot('win-pref-' + t.toLowerCase().replace(/[^a-z]/g, '')); }
  await close();
  await ev(async () => { const U = await import('./js/ui.js'); U.modal('Proyek baru', 'Perubahan yang belum disimpan akan hilang.', [{ label: 'Batal' }, { label: 'Buat baru', go: true }]); }); await shot('win-modal'); await close();
  await ev(async () => { const U = await import('./js/ui.js'); U.ask('Nama proyek', 'Lagu baru', () => {}); }); await shot('win-ask'); await close();
  await ev(() => document.getElementById('btn-menu').click()); await shot('win-menu');
  await ev(() => [...document.querySelectorAll('.menu .mi')].find((m) => /^Ekspor audio/.test(m.textContent)).click()); await shot('win-export'); await close();
  await ev(async () => { const U = await import('./js/ui.js'); U.toast('Tersimpan: /MobileDAW/Lagu baru.mdaw', 9000); const c = U.h('div', { class: 'pwa-card', role: 'dialog' }, U.h('b', {}, 'Pasang MobileDAW'), U.h('div', { class: 'sv' }, 'Pasang sebagai aplikasi: layar penuh tanpa bilah browser, tetap jalan offline, dan ikon di layar utama.'), U.h('div', { class: 'acts' }, U.h('button', { class: 'b' }, 'Nanti'), U.h('button', { class: 'b go' }, 'Pasang'))); document.getElementById('layer').append(c); }); await shot('win-toast-pwa'); await close();
  await ev(async () => { const P = await import('./js/project.js'), D = await import('./js/devices.js'); D.openDeviceWindow(P.state.tracks[1].devices[0].id); }); await shot('win-float'); await close();
}
if (go('keys')) {
  await tab('keys');
  await ev(async () => (await import('./js/editor.js')).setTheory(9, 'Minor'));      // scale highlight: A minor
  await sel(2); await shot('keys-midi'); await btn('btn-max'); await shot('keys-midi-max'); await btn('btn-max');
  await sel(0); await shot('keys-drum'); await btn('btn-max'); await shot('keys-drum-max'); await btn('btn-max');
}
if (want.includes('rack')) {                             // Audio Effect Rack with two chains (chain list, devices; then macros + chain select editor)
  await sel(2); await tab('dev');
  await ev(async () => { const P = await import('./js/project.js'); P.state.tracks[2].devices = []; P.syncAll(); P.addDevice(2, 51); P.rackAddDevice(2, 0, 0, 2); const c = P.rackAddChain(2, 0); P.rackAddDevice(2, 0, c, 0); P.emit('all'); });
  await btn('btn-max'); await shot('rack'); 
  await ev(() => { for (const b of document.querySelectorAll('.lk-rki')) if (b.title === 'Macro') b.click(); });
  await ev(() => { const b = [...document.querySelectorAll('.lk-rkh .lv-btn')].find((x) => x.textContent === 'Chain'); if (b) b.click(); });
  await shot('rack-macro'); await btn('btn-max');
}
if (want.includes('irack')) {                            // Instrument Rack: chain 1 SuperSaw, chain 2 Mini Synth + Utility, key zones split at C3
  await sel(2); await tab('dev');
  await ev(async () => { const P = await import('./js/project.js'); P.state.tracks[2].devices = []; P.syncAll(); P.setInstrument(2, 12); P.rackSetChainInst(2, 0, 2); const c = P.rackAddChain(2, -1, 1); P.rackAddDevice(2, -1, c, 0);
    P.setInstParam(2, 100 + 123, 59); P.setInstParam(2, 100 + 124, 60); P.emit('all'); });
  await btn('btn-max'); await shot('irack');
  await ev(() => { const b = [...document.querySelectorAll('.lk-rkh .lv-btn')].find((x) => x.textContent === 'Key'); if (b) b.click(); });
  await ev(() => { const b = [...document.querySelectorAll('.lk-cname')][1]; if (b) b.click(); });
  await shot('irack-key'); await btn('btn-max');
}
if (go('devs')) {                                        // every instrument and every effect, normal and maximised panel
  const list = await ev(async () => { const D = await import('./js/defs.js'); return { inst: [...D.INST_LIST], fx: Object.keys(D.DEVICES).map(Number) }; });
  const only = process.env.FX ? process.env.FX.split(',').map(Number) : null; if (only) { list.inst = []; list.fx = list.fx.filter((t) => only.includes(t)); }
  if (process.env.INST) { const oi = process.env.INST.split(',').map(Number); list.inst = list.inst.filter((t) => oi.includes(t)); if (!only) list.fx = []; }
  await sel(2); await tab('dev');
  for (const k of list.inst) {
    await ev(async (k) => { const P = await import('./js/project.js'); P.setInstrument(2, k); P.state.tracks[2].devices = []; P.syncAll(); P.emit('all'); }, k);
    await shot('inst-' + k); await btn('btn-max'); await shot('inst-' + k + '-max'); await btn('btn-max');
  }
  for (const k of list.fx) {
    await ev(async (k) => { const P = await import('./js/project.js'); P.state.tracks[2].devices = []; P.addDevice(2, k); P.syncAll(); P.emit('all'); }, k);
    await shot('fx-' + k); await btn('btn-max'); await shot('fx-' + k + '-max');
    if (process.env.CARD) { const c = page.locator('.dev-scroll > .card').filter({ hasText: (await ev(async (k) => (await import('./js/defs.js')).DEVICES[k].name, k)) }).last(); if (await c.count()) await c.screenshot({ path: path.join(out, 'card-' + k + '.png') }); }
    await btn('btn-max');
  }
}
console.log(errs.length ? 'page errors:\n' + errs.join('\n') : 'no page errors');
await browser.close(); server.close();
process.exit(errs.length ? 1 : 0);
