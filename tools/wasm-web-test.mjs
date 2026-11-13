// The web app on the WebAssembly engine (the C++ engine in the AudioWorklet): in Chromium, the app starts on mdaw.wasm, a MiniSynth, a GMS
// and a drum track play (transport moves, the master meter shows level, no engine errors), and the same project on the JS engine
// (prefs.webEngine 'js', the fallback) reaches the same master level. Usage: node tools/wasm-web-test.mjs   (Playwright + Chromium)
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
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
async function run(engine) {
  const page = await (await b.newContext({ viewport: { width: 900, height: 420 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript((engine) => { localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, webEngine: engine })); window.__engErr = []; window.onEngineError = (e) => window.__engErr.push(e && e.msg); }, engine);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(500);
  const r = await page.evaluate(async () => {
    const P = await import('./js/project.js'), { eng } = await import('./js/engine.js');
    await eng.start(); await new Promise((r2) => setTimeout(r2, 300));
    P.newProject(false);
    for (const type of [32, 31]) { P.addTrack('midi'); const i = P.state.tracks.length - 1; P.setInstrument(i, type); const c = P.addClip(i, 0, P.BAR * 2); for (let k = 0; k < 8; k++) c.notes.push({ t: k * 480, d: 400, p: 57 + (k % 3) * 4, v: 0.8 }); P.clipChanged(i); }
    P.addTrack('drum'); { const i = P.state.tracks.length - 1, c = P.addClip(i, 0, P.BAR * 2); for (let k = 0; k < 8; k++) c.notes.push({ t: k * 480, d: 120, p: 36, v: 0.9 }); P.clipChanged(i); }
    P.syncAll(); P.play();
    let peak = 0, pos = 0; const t0 = performance.now();
    while (performance.now() - t0 < 2500) { await new Promise((r2) => setTimeout(r2, 50)); const q = eng.poll(); pos = q.pos; const m = q.m || []; peak = Math.max(peak, (m[64 * 2] || 0), (m[64 * 2 + 1] || 0)); }
    P.stop(); await new Promise((r2) => setTimeout(r2, 200));
    // offline render (Track Freeze path) of the GMS track: on the engine that plays
    const fr = await eng.renderTrack(1, 2, null); let e2 = 0; for (let i = 0; i < fr.l.length; i++) e2 += fr.l[i] * fr.l[i] + fr.r[i] * fr.r[i];
    return { info: eng.info(), peak, pos, errs: window.__engErr, frozen: Math.sqrt(e2 / (2 * fr.l.length)) };
  });
  await page.close();
  return { ...r, page: errs };
}
const w = await run('wasm'), j = await run('js');
ok(w.info.engine === 'wasm', 'the app starts on the WebAssembly engine (' + w.info.engine + ', ' + w.info.sampleRate + ' Hz)');
ok(w.pos > 960 && w.peak > 50, `MiniSynth + GMS + drums play on it: transport at tick ${Math.round(w.pos)}, master peak ${(w.peak / 1000).toFixed(3)}`);
ok(!w.errs.length && !w.page.length, 'no engine or page errors' + (w.errs.length ? ': ' + w.errs[0] : w.page.length ? ': ' + w.page[0] : ''));
ok(j.info.engine === 'js' && j.peak > 50, `prefs.webEngine 'js' keeps the JS engine as the fallback (peak ${(j.peak / 1000).toFixed(3)})`);
ok(w.frozen > 1e-3 && Math.abs(20 * Math.log10(w.frozen / j.frozen)) < 0.5, `offline render (freeze / export) runs on the same engine: GMS track ${(20 * Math.log10(w.frozen)).toFixed(1)} dB on WASM, ${(20 * Math.log10(j.frozen)).toFixed(1)} dB on JS`);
ok(Math.abs(20 * Math.log10(w.peak / j.peak)) < 1, `both engines reach the same master level (${(20 * Math.log10(w.peak / j.peak)).toFixed(2)} dB apart)`);
await b.close(); server.close();
console.log(bad ? `WASM WEB: ${bad} failed` : 'WASM WEB: all passed'); process.exit(bad ? 1 : 0);
