// Harmor phase 3 in the app (Playwright + Chromium, the WebAssembly engine): an image and an audio file are loaded into a Harmor
// track through js/harmor/harmor.js (worker, sample-bank slots, map parameters), the track is rendered and measured, the project is
// saved and opened again: the map comes back (from the render cache) and the track renders the same.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
await new Promise((o) => server.once('listening', o));
const b = await chromium.launch(), page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, tutorialOffered: true })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted); await page.waitForTimeout(800);
const r = await page.evaluate(async () => {
  const P = await import('./js/project.js'), { eng } = await import('./js/engine.js'), H = await import('./js/harmor/harmor.js'), { encodeWav } = await import('./js/engine/wav.js');
  await eng.start(); const sr = eng.info().sampleRate;
  const bin = (x, f, a, n) => { let re = 0, im = 0, ws = 0; for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)), ph = 2 * Math.PI * f * i / sr; re += x[a + i] * w * Math.cos(ph); im -= x[a + i] * w * Math.sin(ph); ws += w; } return 2 * Math.hypot(re, im) / ws; };
  // a picture: a bright line on row 5 from the bottom (partial 6)
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32; const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 64, 32); g.fillStyle = '#fff'; g.fillRect(0, 32 - 1 - 5, 64, 1);
  const png = await new Promise((o) => cv.toBlob(o, 'image/png')); await eng.saveBytes('/Samples/line.png', new Uint8Array(await png.arrayBuffer()));
  // an audio file: a saw at A3 (220 Hz), 1.5 s
  const n = Math.round(sr * 1.5), x = new Float32Array(n); for (let i = 0; i < n; i++) { let v = 0; for (let k = 1; k <= 12; k++) v += Math.sin(2 * Math.PI * 220 * k * i / sr) / k; x[i] = 0.3 * v; }
  await eng.saveBytes('/Samples/saw.wav', new Uint8Array(encodeWav([x], null, n, sr, 32, 1)));
  P.newProject(false); P.addTrack('midi'); P.setInstrument(0, 38); P.selectTrack(0);
  const c = P.addClip(0, 0, 3840); c.notes = [{ t: 0, d: 3000, p: 57, v: 1 }]; P.touchClips(0);
  const out = {};
  const ri = await H.harmorLoadImage(0, '/Samples/line.png', { seconds: 1 });
  let rr = await eng.renderTrack(0, 1); out.image = { ok: ri.ok, p6: bin(rr.l, 6 * 220, Math.round(sr * 0.2), 8192), p1: bin(rr.l, 220, Math.round(sr * 0.2), 8192) };
  const ra = await H.harmorLoadAudio(0, '/Samples/saw.wav', { quality: 1 });
  rr = await eng.renderTrack(0, 1); const lv = [1, 2, 3, 6].map((k) => bin(rr.l, 220 * k, Math.round(sr * 0.3), 8192));
  out.audio = { ok: ra.ok, report: ra.report, lv, slotA: P.state.tracks[0].inst.params[1061], hm: P.state.tracks[0].inst.hm && P.state.tracks[0].inst.hm.src };
  // the resynthesis plays at the file's level: Map Level 4x is set on load, at Volume 100 % (Sustain 100 %) partial 1 = the file's 0.300
  { const v0 = P.state.tracks[0].inst.params[0], s0 = P.state.tracks[0].inst.params[42]; P.setInstParam(0, 0, 1); P.setInstParam(0, 42, 1); const rv = await eng.renderTrack(0, 1); out.unity = { mapLevel: P.state.tracks[0].inst.params[1075], p1: bin(rv.l, 220, Math.round(sr * 0.3), 8192) }; P.setInstParam(0, 0, v0 ?? 0.7); P.setInstParam(0, 42, s0 ?? 0.8); }
  // save and open again: the map is restored (cache) and renders the same
  const txt = P.serialize(); const t0 = performance.now(); await P.deserialize(txt); const tOpen = performance.now() - t0;
  rr = await eng.renderTrack(0, 1); const lv2 = [1, 2, 3, 6].map((k) => bin(rr.l, 220 * k, Math.round(sr * 0.3), 8192));
  out.reopen = { lv2, slotA: P.state.tracks[0].inst.params[1061], tOpen: Math.round(tOpen) };
  return out;
});
ok(r.image.ok && r.image.p6 > 20 * r.image.p1, `image synthesis in the app: the picture's line plays partial 6 (${(20 * Math.log10(r.image.p6 / r.image.p1)).toFixed(0)} dB over partial 1)`);
const rel = r.audio.lv.map((a) => 20 * Math.log10(a / r.audio.lv[0]));
ok(r.unity.mapLevel === 4 && Math.abs(20 * Math.log10(r.unity.p1 / 0.3)) < 1, `resynthesis at the file's level: Map Level ${r.unity.mapLevel}x on load, Volume 100 % -> partial 1 = ${r.unity.p1.toFixed(3)} (file 0.300, ${(20 * Math.log10(r.unity.p1 / 0.3)).toFixed(2)} dB)`);
ok(r.audio.ok && r.audio.report && r.audio.report.pitched && Math.abs(r.audio.report.note - 57) < 0.1 && [0, -6.02, -9.54, -15.56].every((w, i) => Math.abs(rel[i] - w) < 0.6), `resynthesis in the app: note ${r.audio.report && r.audio.report.note.toFixed(2)}, harmonics ${rel.map((v) => v.toFixed(2)).join(' / ')} dB (0 / -6.02 / -9.54 / -15.56)`);
ok(r.reopen.slotA >= 0 && r.reopen.lv2.every((a, i) => Math.abs(20 * Math.log10(a / r.audio.lv[i])) < 0.05), `saved and opened again: the map is back and sounds the same (opened in ${r.reopen.tOpen} ms)`);
// the project menu's ZIP export (project + samples) carries the audio a Harmor map is made from (it used to leave it out)
{ const dl = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#btn-menu'); await page.waitForTimeout(500);
  await page.locator('.menu .mi', { hasText: 'Ekspor' }).first().click(); await page.waitForTimeout(500);
  await page.locator('.menu .mi', { hasText: 'ZIP (proyek' }).first().click();
  const d = await dl, fp = await d.path(), { readZip } = await import(path.join(root, 'js/zip.js'));
  const names = (await readZip(fs.readFileSync(fp).buffer.slice(0))).map((e) => e.name);
  ok(names.some((n) => /\.mdaw$/.test(n)) && names.includes('Samples/saw.wav'), `ZIP export carries the Harmor source: ${names.join(', ')}`); }
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nharmor-app-test: all passed'); process.exit(bad ? 1 : 0);
