// Audio export in the real app (Chromium, Pixel 7 landscape): menu -> Ekspor audio, the "MP3 320 kbps · 44,1 kHz" preset, the file written to
// Exports/ is a 44.1 kHz 320 kbps stereo MP3 of the song (frame headers checked; decoded with ffmpeg when available: level close to the WAV
// export of the same song). Usage: node tools/export-ui-test.mjs  (needs Playwright + Chromium; not part of run-tests)
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7 landscape'], acceptDownloads: true }); const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(1200);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const ev = (f, a) => page.evaluate(f, a); const wait = (ms) => page.waitForTimeout(ms);
// a short song: a synth track with a chord pattern (2 bars)
await ev(async () => { const P = await import('./js/project.js'); P.addTrack('midi'); const i = P.state.tracks.length - 1; const c = P.addClip(i, 0, 7680);
  c.notes = [60, 64, 67].flatMap((p) => [0, 1920, 3840, 5760].map((s) => ({ t: s, d: 1800, p, v: 0.8 }))); P.syncClips(i); P.emit('all'); });
const expo = async (label) => {
  await ev(() => document.getElementById('btn-menu').click()); await wait(500);
  await ev(() => [...document.querySelectorAll('#layer .menu .mi')].find((e) => /^Ekspor audio/.test(e.textContent)).click()); await wait(500);
  const pre = await ev((l) => { const bt = [...document.querySelectorAll('#layer .modal .xd-row .b')].find((x) => x.textContent === l); if (bt) bt.click(); return !!bt; }, label); await wait(200);
  const rows = await ev(() => [...document.querySelectorAll('#layer .modal .xd-row')].filter((r) => r.style.display !== 'none').map((r) => r.querySelector('.xd-l')?.textContent + '=' + [...r.querySelectorAll('.b.on')].map((x) => x.textContent).join('/')).join(' '));
  const dl = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  await ev(() => [...document.querySelectorAll('#layer .modal .b')].find((x) => x.textContent === 'Ekspor').click());
  const d = await dl; const file = d ? await d.path() : null;
  return { pre, rows, file, name: d ? d.suggestedFilename() : '' };
};
const mp3 = await expo('MP3 320 kbps · 44,1 kHz');
console.log('     dialog: ' + mp3.rows);
ok(mp3.pre && /Format=MP3/.test(mp3.rows) && /Kualitas=320 kbps/.test(mp3.rows) && /Sample rate=44,1/.test(mp3.rows), 'preset "MP3 320 kbps · 44,1 kHz" sets format, bitrate and sample rate');
const buf = mp3.file ? fs.readFileSync(mp3.file) : Buffer.alloc(0);
const hdr = buf.length > 4 ? ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0 : 0;
const RATES = [44100, 48000, 32000], BR = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
ok(/\.mp3$/.test(mp3.name) && ((hdr >>> 21) & 0x7ff) === 0x7ff && BR[(hdr >>> 12) & 15] === 320 && RATES[(hdr >>> 10) & 3] === 44100 && ((hdr >>> 6) & 3) !== 3, `exported ${mp3.name}: MPEG-1 Layer III, ${BR[(hdr >>> 12) & 15]} kbps, ${RATES[(hdr >>> 10) & 3]} Hz, stereo (${buf.length} bytes)`);
const wav = await expo('WAV 16-bit · 44,1 kHz');
const wb = wav.file ? fs.readFileSync(wav.file) : Buffer.alloc(0);
ok(/\.wav$/.test(wav.name) && wb.readUInt32LE(24) === 44100 && wb.readUInt16LE(34) === 16 && wb.readUInt16LE(22) === 2, `preset "WAV 16-bit · 44,1 kHz": ${wav.name} ${wb.length > 44 ? wb.readUInt32LE(24) + ' Hz ' + wb.readUInt16LE(34) + '-bit ' + wb.readUInt16LE(22) + ' ch' : ''}`);
let ff = true; try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ff = false; }
if (ff && buf.length && wb.length) {
  const dec = (f) => { const o = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'f32le', '-ac', '2', '-ar', '44100', '-'], { maxBuffer: 1 << 28 }); return new Float32Array(o.buffer, o.byteOffset, o.byteLength >> 2); };
  const m = dec(mp3.file), w = dec(wav.file), rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  const d = 20 * Math.log10(rms(m) / rms(w));
  ok(rms(w) > 1e-3 && Math.abs(d) < 0.3, `MP3 decodes to the same level as the WAV export (${d.toFixed(2)} dB), song not silent`);
}
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\nexport-ui-test: ${bad} FAILED` : '\nexport-ui-test: all passed'); process.exit(bad ? 1 : 0);
