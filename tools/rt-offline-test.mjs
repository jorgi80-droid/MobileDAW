// Real-time vs offline rendering, compared numerically (master prompt: "Bandingkan hasil real-time dan offline").
//   real-time path : the AudioWorklet processor the app plays through (js/engine/worklet.js), commands by postMessage, run inside Chromium's
//                    OfflineAudioContext so it renders as fast as possible but through exactly the same worklet code and message handling
//   offline path   : the Engine class rendered on the main thread, as the WAV export does
// Both get the same project (SuperSaw + Mini Synth notes, an audio clip, Saturator / Compressor look-ahead (PDC) / Reverb / Echo, sends,
// volume automation with a curve). They are aligned on the first sound and compared sample by sample.
// Expected: identical (same code, same order of operations). Known, explained difference: instruments whose wavetables the worklet builds
// in slices between render quanta (Moisture, Wavetable) are silent for their first notes in real time; the test measures that separately.
// Needs the preinstalled Playwright + Chromium (not in CI).   Usage: node tools/rt-offline-test.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x').pathname;
  if (u === '/rt.html') { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><title>rt</title>'); return; }
  const f = path.join(root, decodeURIComponent(u)); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const browser = await chromium.launch(); const page = await browser.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/rt.html`);
let bad = 0; const ok = (c, msg) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };

const res = await page.evaluate(async () => {
  const { Engine, PPQ } = await import('./js/engine/core.js');
  const { densify } = await import('./js/autocurve.js');
  const SR = 48000, SECS = 6, PRE = 128 * 40;
  // the project as engine commands (what project.js syncAll sends)
  const tone = new Float32Array(SR); for (let i = 0; i < SR; i++) tone[i] = 0.4 * Math.sin(2 * Math.PI * 220 * i / SR) * Math.exp(-i / (SR * 0.4));
  function project(synthType) {
    const c = [];
    c.push(['tempo', 124], ['trackInst', 0, synthType], ['trackInst', 1, 1]);
    const f = []; for (let k = 0; k < 24; k++) f.push(k * PPQ / 2, PPQ * 0.45, 48 + ((k * 5) % 19), 0.7, 0);
    c.push(['trackNotes', 0, f, f.length / 5], ['trackNotes', 1, f.map((v, i) => (i % 5 === 2 ? v + 12 : v)), f.length / 5]);
    c.push(['trackClips', 2, [PPQ * 2, PPQ * 8, 0, 0.8, 0, 0.01, 0.2], 1]);
    c.push(['insertDevice', 0, 0, 3], ['devParam', 0, 0, 0, 10], ['insertDevice', 1, 0, 4], ['devParam', 1, 0, 9, 2], ['insertDevice', 65, 0, 7], ['insertDevice', 66, 0, 6]);
    c.push(['trackSend', 0, 0, 0.4], ['trackSend', 1, 1, 0.3], ['trackSend', 2, 0, 0.5], ['trackVol', 0, 0.6], ['trackPan', 1, -0.4]);
    const D = densify([{ t: 0, v: 0.2, s: 2 }, { t: PPQ * 8, v: 0.9 }]), auto = [0, 1, -1, 0, D.length]; for (const [t, v] of D) auto.push(t, v);
    c.push(['automation', auto, auto.length]);
    return c;
  }
  async function realtime(cmds) {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: PRE + SECS * SR, sampleRate: SR });
    await ctx.audioWorklet.addModule('./js/engine/worklet.js');
    const node = new AudioWorkletNode(ctx, 'daw', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }); node.connect(ctx.destination);
    // an OfflineAudioContext renders without pausing, so messages are only handled while it is suspended: the project goes in at the first
    // suspension (as in the app, where the project is loaded long before Play), Play at the second
    ctx.suspend(128 / SR).then(() => { node.port.postMessage({ c: 'sample', id: 0, l: tone, r: tone }); for (const [c, ...a] of cmds) node.port.postMessage({ c, a }); setTimeout(() => ctx.resume(), 50); });
    ctx.suspend(PRE / SR).then(() => { node.port.postMessage({ c: 'play', a: [] }); setTimeout(() => ctx.resume(), 50); });
    const buf = await ctx.startRendering();
    return [buf.getChannelData(0), buf.getChannelData(1)];
  }
  function offline(cmds) {
    const e = new Engine(SR); e.loadSample(0, tone, tone);
    const N = PRE + SECS * SR, L = new Float32Array(N), R = new Float32Array(N);
    for (let i = 0; i < N; i += 128) { if (i === 128) for (const [c, ...a] of cmds) e[c](...a); if (i === PRE) e.play(); e.render(L.subarray(i, i + 128), R.subarray(i, i + 128), 128); }
    return [L, R];
  }
  const onset = (x) => { for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 1e-6) return i; return -1; };
  const cmp = (a, b) => {
    const oa = onset(a[0]), ob = onset(b[0]), sh = oa - ob; let mx = 0, pk = 0, se = 0, n = 0, firstBad = -1;
    for (let i = Math.max(0, ob); i + sh < a[0].length && i < b[0].length; i++) for (let ch = 0; ch < 2; ch++) { const d = Math.abs(a[ch][i + sh] - b[ch][i]); if (d > mx) mx = d; if (d > 1e-6 && firstBad < 0) firstBad = i - ob; pk = Math.max(pk, Math.abs(b[ch][i])); se += d * d; n++; }
    return { shift: sh, maxDb: mx > 0 ? 20 * Math.log10(mx / pk) : -Infinity, rmsDb: se > 0 ? 10 * Math.log10(se / n) - 20 * Math.log10(pk) : -Infinity, firstBadMs: firstBad < 0 ? -1 : firstBad / SR * 1000 };
  };
  const out = {};
  for (const [name, ty] of [['SuperSaw', 2], ['Moisture', 7]]) {
    const cmds = project(ty);
    out[name] = cmp(await realtime(cmds), offline(cmds));
  }
  return out;
});
const f = (x) => (x === -Infinity ? '-inf' : x.toFixed(1));
const nn = (o) => { for (const k of ['maxDb', 'rmsDb']) if (o[k] === null) o[k] = -Infinity; return o; }, s = nn(res.SuperSaw), m = nn(res.Moisture);
ok(s.maxDb < -90, `SuperSaw project: real-time (worklet) vs offline (export engine): max difference ${f(s.maxDb)} dB, RMS ${f(s.rmsDb)} dB (rel. peak), aligned by the first sound (shift ${s.shift} frames = the quantum the play command arrived in)`);
console.log(`info Moisture project: real-time differs (max ${f(m.maxDb)} dB, RMS ${f(m.rmsDb)} dB): the worklet builds the Moisture wavetables in slices between render quanta (JOBS.sync = false, so a cold start never blocks the audio thread); notes that start before the tables exist stay silent in real time and take no random phases, the export builds them at once. Documented tolerance, not an error.`);
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await browser.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nALL OK'); process.exit(bad ? 1 : 0);
