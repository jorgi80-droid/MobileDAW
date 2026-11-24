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
// Live interaction: dragging the ring of the Filter's display moves Freq (x) and Reso (y); tapping a key of Pitcher 2's keyboard switches the note
await ev(async () => { const P = await import('./js/project.js'); while (P.state.tracks[0].devices.length) P.removeDevice(0, 0); P.addDevice(0, 109); P.addDevice(0, 145); P.selectTrack(0); P.emit('all'); });
await page.waitForTimeout(700);
{ const cv = (await page.$$('.fl-live canvas'))[0], bx = await cv.boundingBox();
  const before = await ev(async () => { const P = await import('./js/project.js'); return P.state.tracks[0].devices[0].params.slice(1, 3); });
  const sx = bx.x + bx.width * 0.6, sy = bx.y + bx.height * 0.5;
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx - bx.width * 0.25, sy - bx.height * 0.3, { steps: 6 }); await page.mouse.up();
  const after = await ev(async () => { const P = await import('./js/project.js'); return P.state.tracks[0].devices[0].params.slice(1, 3); });
  ok(after[0] < before[0] - 0.1 && after[1] > before[1] + 0.2, `Filter display: dragging the ring left / up lowers Freq (${before[0].toFixed(2)} -> ${after[0].toFixed(2)}) and raises Reso (${before[1].toFixed(2)} -> ${after[1].toFixed(2)})`);
  const kb = (await page.$$('.fl-live canvas'))[1]; await kb.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); const kx = await kb.boundingBox();
  const n0 = await ev(async () => { const P = await import('./js/project.js'); return P.state.tracks[0].devices[1].params[1]; });
  await page.mouse.click(kx.x + kx.width * 0.07, kx.y + kx.height * 0.9);
  const n1 = await ev(async () => { const P = await import('./js/project.js'); return P.state.tracks[0].devices[1].params[1]; });
  ok((n0 > 0.5) !== (n1 > 0.5), `Pitcher 2 keyboard: tapping the C key switches Note C (${n0} -> ${n1})`); }
await page.screenshot({ path: path.join(out, 'live-filter-pitcher.png') });
// every handle of every display: press it where it is drawn, drag it 18 % of the display toward the centre, and it must follow the finger
// (its parameters move, and the place it is drawn at afterwards is under the pointer)
{ const { FLM_LIVE } = await import('../js/flmlive.js'); const cl = (x) => Math.min(1, Math.max(0, x)); let nh = 0, worst = 0;
  for (const id of Object.keys(FLM_LIVE).filter((x) => /^\d+$/.test(x) && FLM_LIVE[x].D && FLM_LIVE[x].D.handles)) {
    const hs = FLM_LIVE[id].D.handles;
    for (let q = 0; q < hs.length; q++) {
      await ev(async ([t, hp]) => { const P = await import('./js/project.js'); while (P.state.tracks[0].devices.length) P.removeDevice(0, 0); P.addDevice(0, t); for (const j of hp) P.setDeviceParam(0, 0, j, 0.4); P.selectTrack(0); P.emit('all'); }, [100 + +id, [hs[q].x, hs[q].y].filter((j) => j != null)]);
      await page.waitForTimeout(350);
      const cv = (await page.$$('.fl-live canvas'))[0]; await cv.scrollIntoViewIfNeeded(); const bx = await cv.boundingBox();
      const pr = () => ev(async () => { const P = await import('./js/project.js'); return Array.from(P.state.tracks[0].devices[0].params); });
      const hd = hs[q], at = (v) => { const f = hd.pos ? hd.pos((j) => v[j]) : [hd.x != null ? v[hd.x] : 0.5, hd.y != null ? 1 - v[hd.y] : 0.5]; return [cl(f[0]), cl(f[1])]; };
      const v0 = await pr(), [fx, fy] = at(v0), dx = hd.x != null ? (fx < 0.5 ? 0.18 : -0.18) : 0, dy = hd.y != null ? (fy < 0.5 ? 0.18 : -0.18) : 0;
      const sx = bx.x + fx * bx.width, sy = bx.y + fy * bx.height;
      await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + dx * bx.width, sy + dy * bx.height, { steps: 5 }); await page.mouse.up();
      const v1 = await pr(), [gx, gy] = at(v1); const moved = (hd.x == null || Math.abs(v1[hd.x] - v0[hd.x]) > 0.02) && (hd.y == null || Math.abs(v1[hd.y] - v0[hd.y]) > 0.02);
      const ex = hd.x != null ? Math.abs(gx - (fx + dx)) * bx.width : 0, ey = hd.y != null && !(hd.pos && hd.x != null && hd.y == null) ? Math.abs(gy - (fy + dy)) * bx.height : 0, err = Math.max(ex, ey);
      nh++; worst = Math.max(worst, err);
      if (!moved || err > 6) ok(false, `module ${id} handle ${q + 1}: moved ${moved}, ${err.toFixed(1)} px from the pointer (x ${v0[hd.x]} -> ${v1[hd.x]}, y ${v0[hd.y]} -> ${v1[hd.y]})`);
    }
  }
  ok(nh >= 30, `${nh} display handles dragged; each follows the pointer (worst ${worst.toFixed(1)} px)`); }
// Live's vertical slider: dragging the Limiter's Output fader up raises the parameter
{ await ev(async () => { const P = await import('./js/project.js'); while (P.state.tracks[0].devices.length) P.removeDevice(0, 0); P.addDevice(0, 128); P.setDeviceParam(0, 0, 2, 0.3); P.selectTrack(0); P.emit('all'); });
  await page.waitForTimeout(400); const tr = await page.$('.fl-live .lk-ft'), bx = await tr.boundingBox();
  await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height * 0.7); await page.mouse.down(); await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height * 0.3, { steps: 5 }); await page.mouse.up();
  const v = await ev(async () => { const P = await import('./js/project.js'); return P.state.tracks[0].devices[0].params[2]; });
  ok(Math.abs(v - 0.7) < 0.03 && bx.height > 60, `Limiter Output fader (${Math.round(bx.height)} px tall): dragged up 40 % of its track, 0.30 -> ${v.toFixed(2)}`);
  await page.screenshot({ path: path.join(out, 'live-fader.png') }); }

// a display handle of an instrument card (part q of the composition S, canvas c of the card): dragged D of the display toward the centre, it follows the pointer
async function dragInst(type, c, part, what, tab = -1, D = 0.18) {
  const { FLM_LIVE, OSC3_LIVE } = await import('../js/flmlive.js'), { INSTRUMENTS } = await import('../js/defs.js'); const cl = (x) => Math.min(1, Math.max(0, x));
  const S = tab >= 0 ? OSC3_LIVE[tab][1] : FLM_LIVE['i' + type], hs = S.parts[part].D.handles, def = INSTRUMENTS[type].params.map((x) => x.def); let worst = 0, bad = '';
  for (let q = 0; q < hs.length; q++) {
    const hd = hs[q]; await ev(async ([hp]) => { const P = await import('./js/project.js'); for (const j of hp) P.setInstParam(0, j, 0.4); }, [[hd.x, hd.y].filter((j) => j != null)]); await page.waitForTimeout(250);
    const cv = (await page.$$('.fl-live canvas'))[c]; await cv.scrollIntoViewIfNeeded(); const bx = await cv.boundingBox();
    const pr = async () => { const v = await ev(async () => { const P = await import('./js/project.js'); return { ...P.state.tracks[0].inst.params }; }); return def.map((d, j) => (v[j] != null ? v[j] : d)); };
    const at = (v) => { const f = hd.pos ? hd.pos((j) => v[j]) : [hd.x != null ? v[hd.x] : 0.5, hd.y != null ? 1 - v[hd.y] : 0.5]; return [cl(f[0]), cl(f[1])]; };
    const v0 = await pr(), [fx, fy] = at(v0), dx = hd.x != null ? (fx < 0.5 ? D : -D) : 0, dy = hd.y != null ? (fy < 0.5 ? D : -D) : 0, sx = bx.x + fx * bx.width, sy = bx.y + fy * bx.height;
    await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + dx * bx.width, sy + dy * bx.height, { steps: 5 }); await page.mouse.up();
    const v1 = await pr(), [gx, gy] = at(v1), err = Math.max(hd.x != null ? Math.abs(gx - (fx + dx)) * bx.width : 0, hd.y != null ? Math.abs(gy - (fy + dy)) * bx.height : 0);
    const moved = (hd.x == null || Math.abs(v1[hd.x] - v0[hd.x]) > 0.01) && (hd.y == null || Math.abs(v1[hd.y] - v0[hd.y]) > 0.01);
    worst = Math.max(worst, err); if (!moved || err > 6) bad += ` handle ${q + 1}: moved ${moved}, ${err.toFixed(1)} px off;`;
  }
  ok(!bad, `${what}: ${hs.length} handle(s) follow the pointer (worst ${worst.toFixed(1)} px)${bad}`);
}
// the Transistor Bass instrument (34) panel
await ev(async () => { const P = await import('./js/project.js'); while (P.state.tracks[0].devices.length) P.removeDevice(0, 0); P.setInstrument(0, 34); P.selectTrack(0); P.emit('all'); });
await page.waitForTimeout(700);
const tbk = await ev(() => ({ c: document.querySelectorAll('.card .lk-k, .card .lv-fld, .card .lk-ft').length, d: document.querySelectorAll('.card .fl-live canvas').length }));
ok(tbk.c >= 13 && tbk.d === 2, `Transistor Bass panel: ${tbk.c} controls, ${tbk.d} displays (wave, filter)`);
await dragInst(34, 1, 1, 'Transistor Bass filter ring');
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
const sl = await ev(() => ({ knobs: document.querySelectorAll('.card .lk-k, .card .lv-fld').length, loop: [...document.querySelectorAll('.card button')].some((b) => /Loop/.test(b.textContent)) }));
ok(sl.knobs >= 5 && sl.loop, `Slicer panel: loop picker and ${sl.knobs} controls`);
await page.screenshot({ path: path.join(out, 'slicer.png') });
// the 3x Osc instrument (36) panel: FLM's eight pages as tabs
await ev(async () => { const P = await import('./js/project.js'); while (P.state.tracks[0].devices.length) P.removeDevice(0, 0); P.setInstrument(0, 36); P.selectTrack(0); P.emit('all'); });
await page.waitForTimeout(700);
const o3 = await ev(() => ({ tabs: [...document.querySelectorAll('.card .lk-tabs button, .card .lk-tabs .lv-tab, .card .lk-tabs > *')].map((b) => b.textContent.trim()).filter(Boolean), knobs: document.querySelectorAll('.card .lk-k, .card .lv-fld, .card .lk-ft').length }));
ok(o3.tabs.includes('Osc') && o3.tabs.includes('Misc') && o3.knobs >= 10, `3x Osc panel: tabs ${o3.tabs.join('/')} and ${o3.knobs} controls on the Osc page`);
await page.screenshot({ path: path.join(out, '3xosc.png') });
await ev(() => { const t = [...document.querySelectorAll('.card .lk-tabs > *')].find((b) => b.textContent.trim() === 'Vol'); if (t) t.click(); });
await page.waitForTimeout(400);
await dragInst(36, 0, 0, '3x Osc Vol LFO (speed / amount)', 2);
await dragInst(36, 1, 1, '3x Osc Vol envelope (attack, decay / sustain, release)', 2, 0.04);
await page.screenshot({ path: path.join(out, '3xosc-vol.png') });
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
