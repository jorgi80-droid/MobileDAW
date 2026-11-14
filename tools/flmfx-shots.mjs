// Screenshots of the FL Studio Mobile effect modules (device 100 + FLM id, fxkit.js flmPanel) in the device view (Chromium, landscape phone
// size): one track with a few modules; checks every panel builds without page errors and shows its controls, and a knob reaches the project.
// Usage: node tools/flmfx-shots.mjs [out-dir]      (default docs/redesign/flmfx)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.resolve(process.argv[2] || path.join(root, 'docs/redesign/flmfx'));
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
await new Promise((ok) => server.once('listening', ok));
const VW = +(process.env.VW || 910), VH = +(process.env.VH || 414);
const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, floatPlugins: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(1000);
const ev = (fn, a) => page.evaluate(fn, a);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const SETS = [[132, 106, 125], [136, 141, 143], [104, 116, 145], [107, 108, 109], [141, 146, 129], [103, 135, 118], [111, 113, 114], [115, 134, 127], [140, 144, 142]];
await ev(async () => { const P = await import('./js/project.js'); P.newProject(true); P.addTrack('midi'); P.setInstrument(0, 1); P.emit('all'); });
await page.waitForTimeout(500);
await ev(() => document.querySelector('#dtabs .b[data-tab="dev"]').click()); await page.waitForTimeout(300);
await ev(() => { if (document.getElementById('view-arr').classList.contains('shut')) document.getElementById('btn-shut').click(); }); await page.waitForTimeout(400);
for (const [s, set] of SETS.entries()) {
  await ev(async (set) => { const P = await import('./js/project.js'); while (P.state.tracks[0].devices.length) P.removeDevice(0, 0); for (const t of set) P.addDevice(0, t); P.selectTrack(0); P.emit('all'); }, set);
  await page.waitForTimeout(700);
  const n = await ev(() => [...document.querySelectorAll('.lk')].map((x) => x.querySelectorAll('.lk-k, .lk-t, .lv-fld').length));
  ok(n.length >= set.length && n.every((x) => x >= 3), `set ${s + 1}: ${set.length} module panels with controls (${n.join(', ')})`);
  await page.screenshot({ path: path.join(out, `flmfx-${s + 1}.png`) });
}
const moved = await ev(async () => { const P = await import('./js/project.js'); P.setDeviceParam(0, 0, 1, 0.37); return P.state.tracks[0].devices[0].params[1]; });
ok(moved === 0.37, 'a module parameter set through the project API: ' + moved);
// the Transistor Bass instrument (34) panel
await ev(async () => { const P = await import('./js/project.js'); while (P.state.tracks[0].devices.length) P.removeDevice(0, 0); P.setInstrument(0, 34); P.selectTrack(0); P.emit('all'); });
await page.waitForTimeout(700);
const tbk = await ev(() => document.querySelectorAll('.card .knob, .card .lk-k, .card .kn').length);
ok(tbk >= 10, 'Transistor Bass panel shows its knobs: ' + tbk);
await page.screenshot({ path: path.join(out, 'transistor-bass.png') });
// a note effect (Arpeggiator, 151) on the track: the project sends its chain to the engine (trackNoteFx) before the notes, again on a change
const nfx = await ev(async () => {
  const P = await import('./js/project.js'), { eng } = await import('./js/engine.js'); const sent = [];
  const orig = eng.trackNoteFx; eng.trackNoteFx = (...a) => { sent.push(JSON.stringify(a[1])); return orig && orig.apply(eng, a); };
  P.addDevice(0, 151); const di = P.state.tracks[0].devices.length - 1; P.setDeviceParam(0, di, 10, 2 / 23);
  P.toggleBypass(0, di); P.toggleBypass(0, di); eng.trackNoteFx = orig;
  return { n: sent.length, first: sent[0] ? JSON.parse(sent[0]).slice(0, 3) : null, mode: sent[1] ? JSON.parse(sent[1])[3 + 10] : null, byp: sent[2] ? JSON.parse(sent[2])[3] : null };
});
ok(nfx.n >= 3 && nfx.first[0] === 51 && nfx.first[2] === 33 && Math.abs(nfx.mode - 2 / 23) < 1e-9 && nfx.byp === 0, `Arpeggiator on a track: its chain reaches the engine (${nfx.n} sends: added, Mode changed, bypass -> Enable 0)`);
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(out, 'arpeggiator.png') });
// the Slicer instrument (35) panel: its loop picker and controls
await ev(async () => { const P = await import('./js/project.js'); while (P.state.tracks[0].devices.length) P.removeDevice(0, 0); P.setInstrument(0, 35); P.selectTrack(0); P.emit('all'); });
await page.waitForTimeout(700);
const sl = await ev(() => ({ knobs: document.querySelectorAll('.card .lk-k').length, loop: [...document.querySelectorAll('.card button')].some((b) => /Loop/.test(b.textContent)) }));
ok(sl.knobs >= 4 && sl.loop, `Slicer panel: loop picker and ${sl.knobs} knobs`);
await page.screenshot({ path: path.join(out, 'slicer.png') });
// an old FLM import (Reverb kept as a placeholder): the offer switches it to the FLM module
const up = await ev(async () => {
  const P = await import('./js/project.js'), PM = await import('./js/projects.js'), { FLMFX } = await import('./js/flmfx.js');
  const j = JSON.parse(P.serialize()); j.tracks[0].devices = [{ id: 'old1', type: 0, params: [], missing: { name: 'Reverb', flmType: 32, params: FLMFX[32].p.map((x) => x.d), enabled: true } }];
  await P.deserialize(JSON.stringify(j)); await PM.offerFlmUpgrade();
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Pakai DSP FLM'); if (!b) return 'no offer'; b.click();
  await new Promise((r) => setTimeout(r, 600)); return P.state.tracks[0].devices[0].type;
});
ok(up === 132, 'opening an old FLM import offers its modules on FLM DSP; accepted, the placeholder becomes Reverb (132): ' + up);
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nALL FLM FX SHOTS OK');
process.exit(bad ? 1 : 0);
