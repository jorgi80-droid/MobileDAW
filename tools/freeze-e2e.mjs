// Track Freeze in the real app (Chromium, AudioWorklet engine): a SuperSaw track with a Reverb and a Saturator (PDC) is frozen; the worklet
// strip then has no instrument (CPU saved), the exported mix of the project matches the unfrozen export, the frozen audio survives a
// save / reload, and an edit of the track unfreezes it. Needs the preinstalled Playwright + Chromium (not in CI).
// Usage: node tools/freeze-e2e.mjs
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
let bad = 0; const ok = (c, msg) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const r = await page.evaluate(async () => {
  const P = await import('./js/project.js'), E = await import('./js/engine.js'), eng = E.eng;
  P.newProject(true); while (P.state.tracks.length) P.removeTrack(0);
  P.state.master.devices = [];
  P.addTrack('midi'); const i = P.state.tracks.length - 1; P.setInstrument(i, 2);
  const c = P.addClip(i, 0, P.BAR * 2); for (let k = 0; k < 8; k++) c.notes.push({ t: k * 480, d: 400, p: 50 + (k % 4) * 3, v: 0.8 });
  P.addDevice(i, 3); P.addDevice(i, 7); P.setVol(i, 0.7); P.setPan(i, -0.3); P.syncAll(); P.emit('all');
  const mix = async (name) => { const done = new Promise((res) => { window.onExportDone = res; }); eng.exportJob({ dir: '/Exports', name, format: 'wav', bits: 32, startTick: 0, endTick: P.BAR * 2, bpm: P.state.bpm, secs: P.tickToSec(P.BAR * 2), tailSec: 3, normalize: false, zip: false, items: [{ name, kind: 'mix' }] }); const res = await done; const b = await eng.readBytes(res.path); const dv = new DataView(b.buffer || b), n = dv.getUint32(40, true) / 4, x = new Float32Array(n); for (let k = 0; k < n; k++) x[k] = dv.getFloat32(44 + k * 4, true); return x; };
  const a = await mix('live');
  const fr = await P.freezeTrack(i);
  const b = await mix('frozen');
  let d = 0, pk = 0, at = 0; for (let k = 0; k < Math.min(a.length, b.length); k++) { if (Math.abs(a[k] - b[k]) > d) { d = Math.abs(a[k] - b[k]); at = k; } pk = Math.max(pk, Math.abs(a[k])); }
  const frozen = P.isFrozen(i), saved = P.serialize();
  await P.deserialize(saved); const afterLoad = P.isFrozen(0);
  P.setInstParam(0, 0, 0.5); const afterEdit = P.isFrozen(0);
  return { fr, frozen, d, pk, la: a.length, lb: b.length, afterLoad, afterEdit, json: saved.includes('"frozen"') };
});
ok(r.fr && r.fr.ok && r.frozen, `track frozen: ${r.fr && r.fr.secs ? r.fr.secs.toFixed(2) + ' s of audio' : JSON.stringify(r.fr)}`);
const db = 20 * Math.log10(r.d / r.pk);
ok(r.la === r.lb && db < -90, `exported mix with the frozen track = the live mix: max difference ${db.toFixed(1)} dB under the peak (${r.la} frames)`);
ok(r.json && r.afterLoad, 'frozen state + audio survive save / reload');
ok(r.afterEdit === false, 'changing an instrument parameter unfreezes the track');
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await browser.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nALL OK'); process.exit(bad ? 1 : 0);
