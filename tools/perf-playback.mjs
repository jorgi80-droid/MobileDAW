// Playback render cost on a HEAVY project (many audio-waveform + MIDI clips), for before/after of the playback-smoothness work.
// During playback with Follow on, the arrangement scrolls, so the whole timeline (every visible clip + waveform) is redrawn each frame;
// this measures that per-frame main-thread cost. Usage: node tools/perf-playback.mjs [seconds]   env: AUD=16 MID=8 BARS=48 VW/VH/THEME
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), secs = +(process.argv[2] || 4);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const VW = +(process.env.VW || 1180), VH = +(process.env.VH || 560);
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2 })).newPage();
await page.addInitScript((th) => { try { localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, theme: th, fpsMode: 'auto' })); } catch (_) {}
  const raf = window.requestAnimationFrame.bind(window); window.__fr = [];
  window.requestAnimationFrame = (cb) => raf((ts) => { const t0 = performance.now(); cb(ts); window.__fr.push([t0, performance.now() - t0]); }); }, process.env.THEME || 'dark');
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 });
const AUD = +(process.env.AUD || 16), MID = +(process.env.MID || 8), BARS = +(process.env.BARS || 48);
await page.evaluate(async (cfg) => {
  const P = await import('./js/project.js'), E = await import('./js/engine.js'); const BAR = P.BAR;
  P.newProject(true);
  const sr = 44100, n = sr * 4, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const wr = (o, s) => { for (let k = 0; k < s.length; k++) dv.setUint8(o + k, s.charCodeAt(k)); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE'); wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let k = 0; k < n; k++) { const t = k / sr, env = Math.exp(-(t % 0.5) * 9); dv.setInt16(44 + k * 2, Math.sin(2 * Math.PI * 110 * t) * env * 0.8 * 32000, true); }
  await E.eng.saveBytes('/Samples/Perf Tone.wav', buf);
  for (let a = 0; a < cfg.AUD; a++) { P.addTrack('audio'); const i = P.state.tracks.length - 1; for (let b = 2; b < cfg.BARS; b += 3) await P.addAudioClip(i, '/Samples/Perf Tone.wav', b * BAR); }
  for (let m = 0; m < cfg.MID; m++) { P.addTrack('midi'); const i = P.state.tracks.length - 1; for (let b = 0; b < cfg.BARS; b += 4) { const c = P.addClip(i, b * BAR, 4 * BAR); for (let k = 0; k < 96; k++) c.notes.push({ t: k * 160, d: 140, p: 40 + ((k * 7 + m * 5) % 36), v: 0.7 }); } }
  P.syncAll(); P.emit('all');
}, { AUD, MID, BARS });
await page.waitForTimeout(1000);
const ev = (fn, a) => page.evaluate(fn, a);
await ev(() => document.querySelector('.seg .b[data-view="arr"]').click());
await ev(async () => { (await import('./js/project.js')).seekTo(0); (await import('./js/project.js')).play(); window.__fr = []; });
await page.waitForTimeout(secs * 1000);
const fr = await ev(async () => { (await import('./js/project.js')).stop(); return window.__fr; });
const by = new Map(); for (const [t, d] of fr) by.set(Math.round(t * 10), (by.get(Math.round(t * 10)) || 0) + d);
const d = [...by.values()].sort((a, b) => a - b), nn = d.length, mean = d.reduce((a, b) => a + b, 0) / (nn || 1);
const span = fr.length ? (fr[fr.length - 1][0] - fr[0][0]) / 1000 : 1;
console.log(JSON.stringify({ tracks: AUD + MID, audio: AUD, midi: MID, bars: BARS, frames: nn, fps: +(nn / span).toFixed(0), meanMs: +mean.toFixed(2), p95Ms: +(d[Math.floor(nn * 0.95)] || 0).toFixed(2), maxMs: +(d[nn - 1] || 0).toFixed(2) }));
await browser.close(); server.close();
