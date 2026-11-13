// The Android app's engine choice, in Chromium with a mocked Capacitor shell: a fake NativeEngine plugin (the Java / JNI bridge) records the
// engine commands. With fresh preferences, and with preferences saved before v8 (engine 'web'), the app starts on the native C++ engine,
// sends it the project, and plays through it (the WebView's worklet stays silent); a project the native engine cannot play falls back to the
// WebView; Pengaturan -> Audio lists Native first. Usage: node tools/android-engine-test.mjs   (Playwright + Chromium)
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
// the fake shell: every plugin call resolves; NativeEngine reports the instruments / effects the C++ engine has (all but 7) and records commands
const shell = (saved) => {
  if (saved) localStorage.setItem('mobiledaw.prefs.v1', saved);
  window.__nat = { cmds: [], active: [], started: 0 };
  const any = new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : async () => ({})) });
  const NativeEngine = {
    start: async ({ sr }) => { window.__nat.started++; return { sr, inst: Array.from({ length: 40 }, (_, i) => i).filter((i) => i !== 7), dev: Array.from({ length: 64 }, (_, i) => i) }; },
    cmd: async ({ text }) => { window.__nat.cmds.push(...text.split('\n')); return {}; },
    setActive: async ({ on }) => { window.__nat.active.push(on); return {}; },
    sampleBegin: async () => ({}), sampleData: async () => ({}), sampleEnd: async () => ({}), watch: async () => ({}), stats: async () => ({}),
    addListener: () => ({ remove() {} }),
  };
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: new Proxy({ NativeEngine }, { get: (t, k) => t[k] || any }) };
};
async function run(saved) {
  const page = await (await b.newContext({ viewport: { width: 791, height: 360 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(shell, saved);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__nat.active.length > 0, null, { timeout: 15000 }).catch(() => {});
  const r = await page.evaluate(async () => {
    const { eng } = await import('./js/engine.js'), P = await import('./js/project.js'), { prefs } = await import('./js/prefs.js');
    const info0 = eng.engineInfo(), n0 = window.__nat.cmds.length;
    P.addTrack('midi'); const i = P.state.tracks.length - 1; P.setInstrument(i, 30);
    await new Promise((r2) => setTimeout(r2, 300));
    P.play(); await new Promise((r2) => setTimeout(r2, 200)); P.stop(); await new Promise((r2) => setTimeout(r2, 300));
    const sent = window.__nat.cmds.slice(n0), dw = sent.some((l) => /^trackInst \d+ 30$/.test(l)), played = sent.includes('play');
    P.setInstrument(i, 7); await new Promise((r2) => setTimeout(r2, 400));     // an instrument the (fake) native engine does not have
    const info1 = eng.engineInfo();
    return { info0, info1, dw, played, pref: prefs.engine, toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent) };
  });
  await page.close();
  return { ...r, errs };
}
const fresh = await run(null), old = await run(JSON.stringify({ v: 7, engine: 'web', folderAsked: true }));
ok(fresh.info0.want === 'native' && fresh.info0.active === 'native' && fresh.pref === 'native', `fresh install: the native C++ engine is chosen and plays (${JSON.stringify(fresh.info0)})`);
ok(old.info0.active === 'native' && old.pref === 'native', 'preferences saved before v8 (engine web) move to the native engine once');
ok(fresh.dw && fresh.played, 'the project reaches the native engine (DirectWave track, play)');
ok(fresh.info1.active === 'web' && fresh.info1.blocker && fresh.info1.blocker.inst === 7, 'an instrument the native engine lacks: the WebView engine plays instead (' + JSON.stringify(fresh.info1.blocker) + ')');
ok(!fresh.toasts.some((t) => /Native/.test(t)), 'no toast for the default engine at start');
ok(!fresh.errs.length && !old.errs.length, 'no page errors' + (fresh.errs[0] ? ': ' + fresh.errs[0] : ''));
await b.close(); server.close();
console.log(bad ? `ANDROID ENGINE: ${bad} failed` : 'ANDROID ENGINE: all passed'); process.exit(bad ? 1 : 0);
