// End-to-end check of the real app in Chromium (AudioWorklet engine, not node): boots the app, builds a project with latent devices
// (Limiter on a track, Saturator on the master), plays it and reads the PDC latency the worklet reports, then runs a real export job
// (mono, 44.1 kHz, 24-bit WAV) through the export pipeline and checks the file. Needs the preinstalled Playwright + Chromium (not in CI).
// Usage: node tools/engine-e2e.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  const iso = process.env.ISOLATED === '1' ? { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' } : {};   // as vercel.json: SharedArrayBuffer channels
  r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', ...iso }); fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 560 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.addInitScript(() => { try { localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true })); } catch (_) { /* no storage */ } });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForFunction(() => window.__dawBooted, null, { timeout: 20000 });
await page.waitForTimeout(1000);
let bad = 0; const ok = (c, msg) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const r = await page.evaluate(async () => {
  const P = await import('./js/project.js'), E = await import('./js/engine.js'), eng = E.eng;
  P.newProject(true);
  const sr = 48000, n = sr * 2, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf), wr = (o, s) => { for (let k = 0; k < s.length; k++) dv.setUint8(o + k, s.charCodeAt(k)); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE'); wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let k = 0; k < n; k++) dv.setInt16(44 + k * 2, Math.sin(2 * Math.PI * 220 * k / sr) * 12000, true);
  await eng.saveBytes('/Samples/E2E Tone.wav', buf);
  P.addTrack('audio'); const ai = P.state.tracks.length - 1; await P.addAudioClip(ai, '/Samples/E2E Tone.wav', 0);
  P.addDevice(ai, 5);                       // Limiter (72 frames at 48 kHz)
  P.syncAll(); P.emit('all');
  const ctxRate = eng.info().sampleRate;
  P.play(); await new Promise((res) => setTimeout(res, 450)); const p1 = eng.poll() || {}, lat = p1.lat, pos1 = p1.pos;
  const strip = ai, m1 = p1.m ? p1.m[strip * 2] : -1;
  eng.trackVol(strip, 0); await new Promise((res) => setTimeout(res, 1200)); /* the 2 s tone still plays; with the fader at 0 its meter only decays */ const p2 = eng.poll() || {}, m2 = p2.m ? p2.m[strip * 2] : -1, pos2 = p2.pos; P.stop();
  const chan = eng.channel ? eng.channel() : 'message', iso = globalThis.crossOriginIsolated === true;
  const job = { dir: '/Exports', name: 'e2e', format: 'wav', bits: 24, kbps: 192, startTick: 0, endTick: P.BAR, bpm: P.state.bpm, secs: P.tickToSec(P.BAR), tailSec: 0, normalize: true, channels: 1, rate: 44100, zip: false, items: [{ name: 'e2e', kind: 'mix' }] };
  const done = new Promise((res) => { window.onExportDone = res; });
  const started = eng.exportJob(job); const res = await done;
  const bytes = res.ok ? await eng.readBytes(res.path) : null;
  let hdr = null;
  if (bytes) { const d = new DataView(bytes.buffer || bytes); hdr = { ch: d.getUint16(22, true), sr: d.getUint32(24, true), bits: d.getUint16(34, true), data: d.getUint32(40, true) }; }
  const c = P.state.tracks[ai].clips[0], warps = {};
  for (const mode of ['tones', 'repitch', 'beats']) {
    const t0 = performance.now(), o = await P.setClipAudio(ai, c.id, { mode, beats: 2 });
    const d = c.dsample, buf = d && eng.sampleBuffers(d.id);
    warps[mode] = { error: o.error || '', mode: c.warp.mode || 'beats', dur: d ? +d.duration.toFixed(3) : 0, frames: buf ? buf.l.length : 0, ms: Math.round(performance.now() - t0) };
  }
  return { ctxRate, lat, started, res, hdr, secs: job.secs, warps, bpm: P.state.bpm, chan, iso, pos1, pos2, m1, m2 };
});
ok(r.chan === (process.env.ISOLATED === '1' ? 'sab' : 'message') && r.iso === (process.env.ISOLATED === '1'), `engine channel ${r.chan} (crossOriginIsolated ${r.iso})`);
ok(r.pos2 > r.pos1 && r.m1 > 50 && r.m2 < r.m1 * 0.2, `poll moves (${Math.round(r.pos1)} -> ${Math.round(r.pos2)} ticks), fader 0 through the ${r.chan} channel silences the track meter (${r.m1} -> ${r.m2})`);
const la = Math.max(8, Math.round(r.ctxRate * 0.0015));
ok(r.lat === 3 * la, `worklet reports the PDC output latency while playing: ${r.lat} frames at ${r.ctxRate} Hz (= track Limiter + the new project's master Limiter + output limiter, 3 x ${la})`);
ok(r.started === true && r.res && r.res.ok, `export job ran: ${JSON.stringify(r.res)}`);
ok(r.hdr && r.hdr.ch === 1 && r.hdr.sr === 44100 && r.hdr.bits === 24 && Math.abs(r.hdr.data / 3 - r.secs * 44100) < 400, `exported WAV: ${JSON.stringify(r.hdr)} (mono, 44.1 kHz, 24-bit, ${r.secs.toFixed(2)} s)`);
for (const [m, w] of Object.entries(r.warps)) { const want = 2 * 60 / r.bpm; ok(!w.error && w.mode === m && Math.abs(w.dur - want) < 0.01, `warp mode ${m} in the stretch worker: 2 s tone -> 2 beats = ${w.dur} s (${want.toFixed(3)} expected) in ${w.ms} ms${w.error ? ' ERROR ' + w.error : ''}`); }
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nALL OK');
process.exit(bad ? 1 : 0);
