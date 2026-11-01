// Plugins in the real app (Chromium): the two example plugins are installed (validated, saved to /Plugins, loaded into the AudioWorklet and
// the main thread), put on a track, heard in real time (track meter) and in the export, saved / reloaded by plugin id, and a project whose
// plugin is not installed keeps its device as a placeholder. Needs the preinstalled Playwright + Chromium (not in CI).
// Usage: node tools/plugin-e2e.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 560 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true })); } catch (_) { /* no storage */ } });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForFunction(() => window.__dawBooted, null, { timeout: 20000 }); await page.waitForTimeout(800);
const trem = fs.readFileSync(path.join(root, 'plugins/examples/tremolo.js'), 'utf8'), wg = fs.readFileSync(path.join(root, 'plugins/examples/wasm-gain.js'), 'utf8');
let bad = 0; const ok = (c, msg) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const r = await page.evaluate(async ([trem, wg]) => {
  const P = await import('./js/project.js'), E = await import('./js/engine.js'), PL = await import('./js/plugins.js'), eng = E.eng;
  const a = await PL.installPlugin('tremolo.js', trem), b = await PL.installPlugin('wasm-gain.js', wg), bad = await PL.installPlugin('bad.js', 'export const manifest = { id: "x" }; export default class {}');
  P.newProject(true); while (P.state.tracks.length) P.removeTrack(0); P.state.master.devices = [];
  const sr = 48000, n = sr * 2, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf), wr = (o, s) => { for (let k = 0; k < s.length; k++) dv.setUint8(o + k, s.charCodeAt(k)); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE'); wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); wr(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let k = 0; k < n; k++) dv.setInt16(44 + k * 2, Math.sin(2 * Math.PI * 220 * k / sr) * 12000, true);
  await eng.saveBytes('/Samples/pl-tone.wav', buf);
  P.addTrack('audio'); await P.addAudioClip(0, '/Samples/pl-tone.wav', 0);
  const mix = async (name) => { const done = new Promise((res) => { window.onExportDone = res; }); eng.exportJob({ dir: '/Exports', name, format: 'wav', bits: 32, startTick: 0, endTick: P.BAR, bpm: P.state.bpm, secs: 1.5, tailSec: 0, normalize: false, zip: false, items: [{ name, kind: 'mix' }] }); const res = await done; const bb = await eng.readBytes(res.path); const d = new DataView(bb.buffer || bb), m = d.getUint32(40, true) / 4; let s = 0; for (let k = 0; k < m; k++) { const x = d.getFloat32(44 + k * 4, true); s += x * x; } return Math.sqrt(s / m); };
  const dry = await mix('pl-dry');
  P.addDevice(0, b.type); P.setDeviceParam(0, 0, 0, -12);
  P.play(); await new Promise((res) => setTimeout(res, 700)); const m1 = (eng.poll() || {}).m[0]; P.stop();
  const wet = await mix('pl-wet');
  P.addDevice(0, a.type);
  const saved = P.serialize(), plugIds = JSON.parse(saved).tracks[0].devices.map((d) => d.plugin && d.plugin.id);
  await P.deserialize(saved); const reloaded = P.state.tracks[0].devices.map((d) => d.type);
  const fake = JSON.parse(saved); fake.tracks[0].devices[0].plugin = { id: 'com.nowhere.missing', version: '2.0.0', name: 'Gone' }; fake.tracks[0].devices[0].params = [0.25];
  await P.deserialize(JSON.stringify(fake)); const ph = P.state.tracks[0].devices[0], phDef = (await import('./js/defs.js')).DEVICES[ph.type];
  const listed = (await import('./js/defs.js')).FX_GROUPS.find((g) => g[0] === 'plug');
  return { a, b, bad, dry, wet, m1, plugIds, reloaded, types: [a.type, b.type], ph: { name: phDef.name, params: ph.params, keepsId: ph.plugin.id }, listed: listed ? listed[2] : null, files: eng.listDir('/Plugins').items.map((x) => x.name) };
}, [trem, wg]);
ok(r.a.ok && r.b.ok, `example plugins installed: ${r.a.name} (type ${r.a.type}), ${r.b.name} (type ${r.b.type}); files in /Plugins: ${r.files.join(', ')}`);
ok(r.bad.error, 'an invalid plugin is refused: ' + r.bad.error);
ok(r.listed && r.listed.includes(r.a.type) && r.listed.includes(r.b.type), 'plugins listed in the effect browser (Plugin group)');
ok(r.m1 > 0, `real time: the AudioWorklet plays the track through the WASM plugin (track meter ${r.m1})`);
ok(Math.abs(20 * Math.log10(r.wet / r.dry) + 12) < 0.1, `export: the WASM Gain plugin at -12 dB changes the mix by ${(20 * Math.log10(r.wet / r.dry)).toFixed(2)} dB`);
ok(r.plugIds[0] === 'org.mobiledaw.example.wasmgain' && r.plugIds[1] === 'org.mobiledaw.example.tremolo' && r.reloaded.join() === [r.b.type, r.a.type].join(), 'saved by plugin id, reloaded onto the right plugins');
ok(/tidak ada/.test(r.ph.name) && r.ph.params[0] === 0.25 && r.ph.keepsId === 'com.nowhere.missing', `missing plugin: placeholder "${r.ph.name}", parameters and id kept`);
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await browser.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nALL OK'); process.exit(bad ? 1 : 0);
