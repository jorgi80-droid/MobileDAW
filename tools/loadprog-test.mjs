// Opening a project in the background (js/project.js deserialize + js/loadprog.js)  (Playwright + Chromium): a project with 12 audio clips (6 stretched / pitched,
// 2 warped onto a swing grid) and a drum kit is saved, then opened through the project list. The window appears, its bar moves forward,
// its labels name the steps (samples, stretch / pitch renders, clips fitted to the tempo), its count reaches the total, and it is gone
// once the project is open. Usage: node tools/loadprog-test.mjs   (part of tools/run-tests.mjs)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
await new Promise((o) => server.once('listening', o));
const b = await chromium.launch(), page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted); await page.waitForTimeout(800);
const r = await page.evaluate(async () => {
  const P = await import('./js/project.js'), { eng } = await import('./js/engine.js'), PJ = await import('./js/projects.js');
  const SR = 48000, wav = (sec, hz) => { const n = Math.round(SR * sec), d = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, SR, true); d.setUint32(28, SR * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) d.setInt16(44 + 2 * i, Math.round(9000 * Math.sin(2 * Math.PI * hz * i / SR) * (i % 12000 < 600 ? 2 : 1)), true); return d.buffer; };
  for (let k = 0; k < 12; k++) await eng.saveBytes('/Samples/LP/loop' + k + '.wav', wav(12, 110 * (1 + k % 5)));
  P.newProject(false); P.addTrack('audio'); const i = P.state.tracks.length - 1;
  for (let k = 0; k < 12; k++) { const c = await P.addAudioClip(i, '/Samples/LP/loop' + k + '.wav', k * 3840); if (k % 2 === 0 || k > 5) c.warp = { beats: 0, ratio: 1.1 + k * 0.01, rev: false, pitch: k % 4 ? 2 : 0 }; if (k === 1 || k === 3) { c.srcBpm = 110; c.warpAuto = true; c.swing = 0.5; } }
  await P.ensureBakes(); P.state.projectName = 'LoadProg'; eng.writeText('/Projects/LoadProg.mdaw', P.serialize());
  P.newProject(false);
  const seen = []; let maxDone = 0, maxTotal = 0;
  const obs = new MutationObserver(() => { const el = document.querySelector('.ldm'); if (!el) return; const l = el.querySelector('.ldm-l').textContent, c = el.querySelector('.ldm-p').textContent, w = parseFloat(el.querySelector('.ldm-bar i').style.width) || 0;
    seen.push([l, c, w]); const m = /(\d+)\/(\d+)/.exec(c); if (m) { maxDone = Math.max(maxDone, +m[1]); maxTotal = Math.max(maxTotal, +m[2]); } });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  const t0 = performance.now();
  const res = await PJ.openProject('LoadProg'); const tReady = performance.now() - t0;
  // while the samples load: the project is on screen, nothing covers the app, the bar sits under the play button, a menu opens
  const during = await (async () => {
    for (let w = 0; w < 100 && !document.querySelector('.ldm'); w++) await new Promise((o) => setTimeout(o, 30));   // the bar shows after 250 ms
    const bar = document.querySelector('.ldm'), play = document.getElementById('btn-play').getBoundingClientRect(), br = bar && bar.getBoundingClientRect();
    const K = (await import('./js/uiscale.js')).emuK(), hit = document.elementFromPoint((play.left + play.width / 2) * K, (play.top + play.height / 2) * K);
    const tl = document.querySelector('#body'), tr = tl.getBoundingClientRect(), mid = document.elementFromPoint((tr.left + tr.width / 2) * K, (tr.top + tr.height / 2) * K);
    const busy = P.loading.busy, pend = P.state.tracks[0].clips.filter((c) => !(c.sample.id >= 0)).length;
    return { bar: !!bar, under: !!br && br.top >= play.bottom - 1 && br.left < play.right && br.right > play.left, playHit: hit && (hit.id === 'btn-play' || !!hit.closest('#btn-play')),
      overlay: !!document.querySelector('.ldp'), barTaps: bar ? getComputedStyle(bar).pointerEvents : '', midOk: !!mid && !mid.closest('.ldm, .ldp'), busy, pend, tracks: P.state.tracks.length, clips: P.state.tracks[0].clips.length };
  })();
  if (res.error) return { err: res.error };
  const miss = await res.done; await new Promise((o) => setTimeout(o, 120)); obs.disconnect();
  const tAll = performance.now() - t0, cl = P.state.tracks[0].clips;
  const loaded = cl.every((c) => c.sample.id >= 0 && !c.sample.pending), warped = cl.filter((c) => c.warp && (c.warp.ratio !== 1 || c.warp.pitch)).every((c) => c.dsample && c.dsample.id >= 0);
  // a second project opened while the first is still loading: the first stops, the second is the one that ends up loaded
  P.newProject(false); P.addTrack('audio'); for (let k = 0; k < 3; k++) await P.addAudioClip(0, '/Samples/LP/loop' + k + '.wav', k * 3840); P.state.projectName = 'LoadProg2'; eng.writeText('/Projects/LoadProg2.mdaw', P.serialize());
  P.newProject(false);
  const r1 = await PJ.openProject('LoadProg'), r2 = await PJ.openProject('LoadProg2'); const [m1, m2] = await Promise.all([r1.done, r2.done]);
  await new Promise((o) => setTimeout(o, 150));
  const second = { name: P.state.projectName, clips: P.state.tracks[0].clips.length, loaded: P.state.tracks[0].clips.every((c) => c.sample.id >= 0), m1: m1.length, m2: m2.length, busy: P.loading.busy, bar: !!document.querySelector('.ldm') };
  return { ok: res.ok, miss: miss.length, clips: cl.length, loaded, warped, during, second, tReady: Math.round(tReady), tAll: Math.round(tAll), seen: seen.length, labels: [...new Set(seen.map((x) => x[0].split(':')[0]))], widths: seen.map((x) => x[2]), maxDone, maxTotal, gone: !document.querySelector('.ldm'), pending: P.bakesPending() };
});
if (r.err) console.log('ERR', r.err);
ok(r.ok && r.clips === 12 && r.miss === 0, 'the project opened through the project list (' + r.clips + ' clips, nothing missing)');
ok(r.during.tracks === 1 && r.during.clips === 12 && r.during.busy, 'it is on screen while its samples still load (ready after ' + r.tReady + ' ms, all loaded after ' + r.tAll + ' ms; ' + r.during.pend + ' clips still pending at the check)');
ok(!r.during.overlay && r.during.playHit && r.during.midOk && r.during.barTaps === 'none', 'nothing covers the app while loading: the play button and the arrangement take taps, the bar never does');
ok(r.during.bar && r.during.under, 'the progress bar sits under the play button');
ok(r.seen > 3, 'the progress bar showed (' + r.seen + ' updates)');
ok(r.labels.some((l) => /Merender stretch/.test(l)) && r.labels.some((l) => /tempo/.test(l)), 'its labels name the steps: ' + r.labels.join(' | '));
ok(r.widths.some((w) => w > 0 && w < 100) && Math.max(...r.widths) >= 90, 'the bar moves forward (' + Math.round(Math.min(...r.widths.filter((w) => w > 0))) + ' .. ' + Math.round(Math.max(...r.widths)) + ' %)');
ok(r.maxTotal > 0 && r.maxDone >= r.maxTotal - 1, 'the count reaches its total (' + r.maxDone + ' / ' + r.maxTotal + ')');
ok(r.loaded && r.warped, 'afterwards every clip has its audio and every stretched / pitched clip its render');
ok(r.gone && r.pending === 0, 'the bar is gone once everything is loaded, every swing clip already rendered');
ok(r.second.name === 'LoadProg2' && r.second.clips === 3 && r.second.loaded && !r.second.busy && !r.second.bar && r.second.m2 === 0, 'a project opened while another still loads takes over cleanly (' + JSON.stringify(r.second) + ')');
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nloadprog-test: all passed'); process.exit(bad ? 1 : 0);
