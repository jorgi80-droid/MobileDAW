// Automation recording (FL Studio Mobile: moving a control while recording creates its automation track and clip): in the real app on an
// emulated phone, record on a synth track, move a Saturator Drive and the track volume, stop; the lanes exist with the moves as points
// (rising values in time order), a second take over the same time replaces the points under the moving control, undo removes the take,
// and nothing is written while not recording. Usage: node tools/autorec-test.mjs   (Playwright + Chromium)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await b.newContext({ viewport: { width: 791, height: 360 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, floatPlugins: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(800);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const ev = (f, a) => page.evaluate(f, a);
await ev(async () => { const P = await import('./js/project.js'); window.P = P; P.newProject(false); P.addTrack('midi'); const i = P.state.tracks.length - 1; P.setInstrument(i, 33); P.addDevice(i, 3); P.selectTrack(i); P.emit('all'); window.TI = i; });
// not recording: no lane
await ev(() => { P.setDeviceParam(TI, 0, 0, 10); P.setVol(TI, 0.5); });
ok(await ev(() => !P.state.tracks.some((t) => t.kind === 'auto')), 'moving controls while not recording writes nothing');
// take 1: Drive 0 -> 30 dB over ~1.2 s, volume 0.3 -> 0.9
await ev(async () => { await P.startRecording(); });
await page.waitForFunction(() => P.state.playing, null, { timeout: 5000 }); await page.waitForTimeout(300);
for (let k = 0; k <= 12; k++) { await ev((k) => { P.setDeviceParam(TI, 0, 0, k * 2.5); P.setVol(TI, 0.3 + k * 0.05); }, k); await page.waitForTimeout(100); }
await ev(async () => { await P.stopRecording(); }); await page.waitForTimeout(300);
const r = await ev(() => {
  const autos = P.state.tracks.filter((t) => t.kind === 'auto'), d = P.state.tracks[TI].devices[0];
  const drv = autos.find((t) => t.target.kind === 4 && t.target.devId === d.id && t.target.param === 0), vol = autos.find((t) => t.target.kind === 0);
  const pts = (t) => (t && t.clips[0] ? t.clips[0].pts.map((p) => [Math.round(p.t), +p.v.toFixed(3)]) : []);
  return { n: autos.length, drv: pts(drv), vol: pts(vol), names: autos.map((t) => t.name), clips: autos.map((t) => t.clips.length) };
});
ok(r.n === 2 && r.names.some((x) => /Saturator Drive/.test(x)) && r.names.some((x) => /Volume/.test(x)), 'recording created two automation tracks: ' + r.names.join(' | '));
const rising = (p) => p.length >= 6 && p.slice(1).every((q, j) => q[0] >= p[j][0]) && p[p.length - 1][1] > p[1][1] + 0.2;
ok(rising(r.drv) && rising(r.vol), `the moves are points in time order with rising values (Drive ${r.drv.length} points, Volume ${r.vol.length} points)`);
ok(r.clips.every((n) => n === 1), 'one clip per lane for the take (grown bar by bar)');
// undo removes the recorded points (the clips as they were before the take)
const undone = await ev(async () => { const H = await import('./js/history.js'); H.undoOp(); return P.state.tracks.filter((t) => t.kind === 'auto').map((t) => t.clips.length); });
ok(undone.every((n) => n === 0) || undone.length === 0, 'undo removes the recorded take (' + JSON.stringify(undone) + ')');
const redone = await ev(async () => { const H = await import('./js/history.js'); H.redoOp(); return P.state.tracks.filter((t) => t.kind === 'auto').map((t) => t.clips.length && t.clips[0].pts.length); });
ok(redone.length === 2 && redone.every((n) => n >= 6), 'redo brings the take back (' + JSON.stringify(redone) + ')');
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
await b.close(); server.close();
console.log(bad ? `AUTOMATION REC: ${bad} failed` : 'AUTOMATION REC: all passed'); process.exit(bad ? 1 : 0);
