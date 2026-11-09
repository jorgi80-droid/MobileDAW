// FLM drum slot Sample Start / Length (Honeydew drums.rs): the importer keeps them as pad.flmSt (signed seconds) and pad.flmLen (fraction of the
// sample); loading the project resolves them against the sample's duration (a later start -> pad Start, a negative start -> pad Shift, Length ->
// Hold) and drops the FLM fields. In the real app: a 1 s WAV in storage, a project with three such pads, deserialize, check the pads.
// Usage: node tools/padtime-test.mjs   (Playwright + Chromium)
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
const page = await (await b.newContext({ viewport: { width: 791, height: 360 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, floatPlugins: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(500);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const r = await page.evaluate(async () => {
  const P = await import('./js/project.js');
  const sr = 44100, n = sr, buf = new ArrayBuffer(44 + n * 2), d = new DataView(buf), w = (o, s) => { for (let k = 0; k < s.length; k++) d.setUint8(o + k, s.charCodeAt(k)); };
  w(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, sr, true); d.setUint32(28, sr * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) d.setInt16(44 + i * 2, Math.round(8000 * Math.sin(i / 10)), true);
  const { eng } = await import('./js/engine.js'); await eng.saveBytes('/Samples/padtime.wav', buf);
  const pad = (o) => ({ pitch: 36, name: 'P', kind: -1, sample: { path: '/Samples/padtime.wav', name: 'padtime.wav' }, gain: 0, pan: 0, pit: 0, dec: 1, start: 0, end: 1, rev: false, a: 0, d: 0, s: 1, r: 0, mute: false, solo: false, cut: 0, poly: true, hold: 0, shift: 0, ...o });
  P.newProject(false); const j = JSON.parse(P.serialize ? P.serialize() : JSON.stringify(P.state));
  j.tracks = [{ id: 7, name: 'Kit', color: '#888', kind: 'drum', inst: { type: 3, params: {}, pads: [pad({ flmSt: 0.25, flmLen: 0.5 }), pad({ pitch: 37, flmSt: -0.1 }), pad({ pitch: 38 })] }, clips: [], devices: [], vol: 1, pan: 0, mute: false, solo: false, send: [0, 0], out: -1 }];
  await P.deserialize(JSON.stringify(j));
  const ps = P.state.tracks[0].inst.pads.map((q) => ({ start: q.start, hold: q.hold, shift: q.shift, st: q.flmSt, len: q.flmLen, dur: q.sample && q.sample.duration }));
  return ps;
});
ok(Math.abs(r[0].dur - 1) < 0.01, 'the 1 s sample loaded (' + r[0].dur + ' s)');
ok(Math.abs(r[0].start - 0.25 / r[0].dur) < 1e-6 && Math.abs(r[0].hold - 0.5 * r[0].dur) < 1e-6 && r[0].st === undefined && r[0].len === undefined, `Sample Start 0.25 s -> pad Start ${r[0].start.toFixed(4)}, Length 0.5 -> Hold ${r[0].hold.toFixed(3)} s; FLM fields dropped`);
ok(Math.abs(r[1].shift - 0.1) < 1e-9 && r[1].start === 0, 'negative Sample Start -0.1 s -> pad Shift 0.1 s (silence before the hit)');
ok(r[2].start === 0 && r[2].hold === 0 && r[2].shift === 0, 'a pad without FLM fields is untouched');
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
await b.close(); server.close();
console.log(bad ? `PAD TIME: ${bad} failed` : 'PAD TIME: all passed'); process.exit(bad ? 1 : 0);
