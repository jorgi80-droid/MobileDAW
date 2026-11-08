// Replica diff helper: renders the arrangement in the same state as a reference Ableton Live screenshot (3 open tracks: two stereo audio tracks
// and a drum MIDI track, a folded synth track, two return tracks and the Master) and saves the track area as PNG for tools/imgdiff.py (layout mode).
// Usage: node tools/replica-arr-shot.mjs out.png [theme]   (needs Playwright + Chromium; not part of run-tests)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || 'arr.png', theme = process.argv[3] || 'live';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const b = await chromium.launch(); const page = await (await b.newContext({ ...devices['Pixel 7 landscape'] })).newPage();
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, floatPlugins: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(1200);
const box = await page.evaluate(async (theme) => {
  const P = await import('./js/project.js'), T = await import('./js/timeline.js'), W = await import('./js/waveform.js'), Th = await import('./js/theme.js');
  P.newProject(false); ['audio', 'audio', 'drum', 'midi'].forEach((k) => P.addTrack(k)); P.addFxTrack && P.addFxTrack();
  const t = P.state.tracks; t[0].name = 'Exotic Ensem'; t[0].color = '#ff3fd2'; t[1].name = 'Bass'; t[1].color = '#1fd8b8'; t[2].name = '11 Castle Kit'; t[2].color = '#3dff3d'; t[3].name = '12 Wavetable'; t[3].color = '#e6f53c'; t[3].fold = true;
  const mk = (seed, id) => { const n = 48000 * 40, l = new Float32Array(n), r = new Float32Array(n); for (let i = 0; i < n; i++) { const env = 0.25 + 0.75 * Math.abs(Math.sin(i / 12000 + seed)) * (0.6 + 0.4 * Math.sin(i / 700)); l[i] = Math.sin(i / 9 + seed) * env * 0.9; r[i] = Math.sin(i / 11 + seed) * env * 0.8 * (0.7 + 0.3 * Math.cos(i / 3000)); } const pyr = W.buildPyramid(l, r); return { id, path: '/S/' + id + '.wav', name: id + '.wav', duration: 40, frames: n, peaks: [], pyr }; };
  const a = mk(0.3, 41), c2 = mk(1.7, 42); P.state.samples[a.path] = a; P.state.samples[c2.path] = c2;
  const B = P.BAR, at = (f) => Math.round(f * 27 * B / 960) ;
  t[0].clips.push({ id: 9101, start: 0, len: at(140), name: '', sample: a, offset: 0, gain: 1 }, { id: 9102, start: at(285), len: at(425), name: '', sample: a, offset: 1, gain: 1 });
  t[1].clips.push({ id: 9103, start: 0, len: at(425), name: '', sample: c2, offset: 0, gain: 1 }, { id: 9104, start: at(570), len: at(140), name: '', sample: c2, offset: 2, gain: 1 });
  const d = P.addClip(2, 0, at(710)); for (let k = 0; k < at(710) / 240; k++) { d.notes.push({ t: k * 240, d: 60, p: 42, v: 0.8 }); if (k % 4 === 0) d.notes.push({ t: k * 240, d: 120, p: 36, v: 0.9 }); if (k % 8 === 4) d.notes.push({ t: k * 240, d: 120, p: 38, v: 0.9 }); } d.name = '';
  const d2 = P.addClip(2, at(925), at(35)); d2.notes.push({ t: 0, d: 120, p: 36, v: 0.9 });
  const w = P.addClip(3, at(425), at(140)); w.notes.push({ t: 0, d: 480, p: 60, v: 0.8 }); w.name = '';
  P.clipChanged(2); P.clipChanged(3); Th.applyTheme(theme);
  document.querySelector('#btn-shut').click(); P.state.sel.track = -1; P.state.sel.clip = null;
  T.view.x0 = 0; T.view.ppt = (document.querySelector('#arr').getBoundingClientRect().width - T.headWidth()) / (27 * B); T.view.y0 = 0;
  P.emit('all');
  await new Promise((r) => setTimeout(r, 600));
  const cv = [...document.querySelectorAll('#arr canvas')][0], rr = cv.getBoundingClientRect(), q0 = T.probe(0, 0), qn = T.probe(0, P.state.tracks.length + 1 + Math.max(0, P.state.returns.length - 2));
  return { w: rr.width, h: rr.height, top: q0.top, bottom: qn.top };
}, theme);
await page.waitForTimeout(500);
const tmp = out + '.full.png';
await page.locator('#arr canvas').first().screenshot({ path: tmp });
fs.writeFileSync(out + '.json', JSON.stringify(box));
await b.close(); server.close();
console.log(JSON.stringify(box));
