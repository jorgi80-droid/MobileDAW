// FL Studio Mobile workflow tools: (1) DirectWave "New from samples" (js/tokenmap.js, Honeydew token_map.rs): names -> root / key ranges
// split at the midpoints / velocity layers from their tops / round robins / unparsed files flagged; then in the app the zones it builds;
// (2) "Fine tune control": the exact value typed for a control (a device knob, the track pan), clamped and stepped.
// Usage: node tools/flmtools-test.mjs   (Playwright + Chromium for part 2; part of tools/run-tests.mjs)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TM = await import('../js/tokenmap.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const names = ['Piano_C3_v64.wav', 'Piano_C3_v127.wav', 'Piano_F#3_v64.wav', 'Piano_F#3_v127.wav', 'Piano_C4_v64.wav', 'Piano_C4_v127.wav'];
const sep = TM.separatorOf(names[0]), roles = TM.guess(TM.tokens(names[0], sep)), rg = TM.mapNames(names, sep, roles);
ok(sep === '_' && roles.join() === 'ignore,root,vel', 'separator and roles guessed from the first name: ' + sep + ' / ' + roles.join());
ok(rg[0].root === 48 && rg[0].keys.join() === '0,51' && rg[2].keys.join() === '52,57' && rg[4].keys.join() === '58,127', 'roots share the keyboard at the midpoints (C3 0-51, F#3 52-57, C4 58-127)');
ok(rg[0].vels.join() === '1,64' && rg[1].vels.join() === '65,127' && rg.every((r) => !r.flag), 'velocity layers from their tops (v64 = 1-64, v127 = 65-127), nothing flagged');
const rr = TM.mapNames(['Snare_D2_RR1.wav', 'Snare_D2_RR2.wav', 'Snare_D2_RR3.wav', 'Noise.wav'], '_', ['ignore', 'key', 'rr']);
ok(rr[0].seq.join() === '1,3' && rr[2].seq.join() === '3,3' && rr[0].keys.join() === '38,38' && rr[3].flag && rr[3].flag.unparsed === 1, 'round robins of one key counted 1..3; a name without the key token is flagged');
ok(TM.note('Db4') === 61 && TM.note('c-1') === 0 && TM.note('128') === null && TM.note('H2') === null, 'note names (scientific pitch, C4 = 60), numbers 0..127');

const { chromium } = createRequire(import.meta.url)('playwright');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
await new Promise((o) => server.once('listening', o));
const b = await chromium.launch(), page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, floatPlugins: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted); await page.waitForTimeout(800);
const r = await page.evaluate(async (names) => {
  const P = await import('./js/project.js'), { eng } = await import('./js/engine.js'), TM = await import('./js/tokenmap.js'), A = await import('./js/automate.js'), { DEVICES } = await import('./js/defs.js');
  const SR = 48000, wav = (hz) => { const n = 4800, d = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, SR, true); d.setUint32(28, SR * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) d.setInt16(44 + 2 * i, Math.round(8000 * Math.sin(2 * Math.PI * hz * i / SR)), true); return d.buffer; };
  for (const n of names) await eng.saveBytes('/Samples/Piano/' + n, wav(220));
  P.newProject(false); P.addTrack('midi'); const i = P.state.tracks.length - 1; P.setInstrument(i, 30);
  const rg = TM.mapNames(names, '_', ['ignore', 'root', 'vel']).map((x) => ({ ...x, path: '/Samples/Piano/' + x.file }));
  const res = await P.buildDwFromSamples(i, rg), zs = P.state.tracks[i].inst.zones;
  const out = { res, zones: zs.map((z) => [z.root, z.lo, z.hi, z.vlo, z.vhi, !!z.sample]) };
  // Fine tune: a device knob and the track pan, typed through the dialog
  P.addDevice(i, 3); const d = P.state.tracks[i].devices[P.state.tracks[i].devices.length - 1], k = DEVICES[3].params.findIndex((q) => q.n === 'Drive');
  const type = async (target, label, v) => { A.fineTune(target, label); await new Promise((o) => setTimeout(o, 60)); const m = [...document.querySelectorAll('#layer .modal')].pop(); m.querySelector('input').value = String(v); [...m.querySelectorAll('.b')].find((x) => x.textContent === 'OK').click(); await new Promise((o) => setTimeout(o, 60)); };
  await type({ kind: 4, strip: P.stripOf(i), devId: d.id, param: k, def: DEVICES[3].params[k] }, 'Saturator Drive', 12.5); out.drive = d.params[k];
  await type({ kind: 4, strip: P.stripOf(i), devId: d.id, param: k, def: DEVICES[3].params[k] }, 'Saturator Drive', 999); out.driveMax = d.params[k];
  await type({ kind: 1, strip: P.stripOf(i), param: 0, def: P.AUTO_PAN }, 'Pan', -0.25); out.pan = P.state.tracks[i].pan;
  return out;
}, names);
ok(r.res.zones === 6 && r.zones.every((z) => z[5]) && JSON.stringify(r.zones[2]) === JSON.stringify([54, 52, 57, 1, 64, true]), 'six zones built from the names, samples loaded: ' + JSON.stringify(r.zones[2]));
ok(r.drive === 12.5 && r.driveMax === 36 && r.pan === -0.25, `Fine tune: Drive typed 12.5 (${r.drive}), 999 clamped to its maximum (${r.driveMax}), Pan -0.25 (${r.pan})`);
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nflmtools-test: all passed'); process.exit(bad ? 1 : 0);
