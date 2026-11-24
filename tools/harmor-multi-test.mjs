// Harmor with several vocals in one pattern (Playwright + Chromium, the WebAssembly engine): two synthetic "vocals" resynthesised into
// images 1 and 2 of ONE Harmor track (vocal A = odd harmonics only, vocal B = a strong 2nd harmonic); one clip whose notes pick a vocal
// (note.img 0 / 1). Checks: each note plays its own vocal's timbre, a note of an empty image falls back to image 1, the project keeps
// the vocals and the notes' images (save -> open -> the same sound), the vocals are in the ZIP's file list.
// Usage: node tools/harmor-multi-test.mjs   (part of tools/run-tests.mjs)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
await new Promise((o) => server.once('listening', o));
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }), page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, tutorialOffered: true, fullscreen: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted); await page.waitForTimeout(800);

const r = await page.evaluate(async () => {
  const P = await import('./js/project.js'), { eng } = await import('./js/engine.js'), H = await import('./js/harmor/harmor.js'), { encodeWav } = await import('./js/engine/wav.js'), { HM } = await import('./js/harmor/schema.js');
  await eng.start(); const sr = eng.info().sampleRate; P.newProject(false); P.setBpm(120);
  // two 1-s sources at A3 (220 Hz): A = odd harmonics 1/k, B = fundamental + a 2nd harmonic at the same level + a little 3rd
  const mk = (name, amp) => { const n = sr, L = new Float32Array(n); for (let i = 0; i < n; i++) { const env = Math.min(1, i / (0.01 * sr), (n - i) / (0.02 * sr)); let v = 0; for (let k = 1; k <= 12; k++) v += amp(k) * Math.sin(2 * Math.PI * 220 * k * i / sr); L[i] = 0.25 * env * v; }
    return eng.saveBytes('/Samples/' + name, new Uint8Array(encodeWav([L], [L], n, sr, 24, 2))); };
  await mk('vocalA.wav', (k) => (k & 1 ? 1 / k : 0)); await mk('vocalB.wav', (k) => (k === 1 ? 1 : k === 2 ? 1 : k === 3 ? 0.2 : 0));
  P.addTrack('midi'); const ti = P.state.tracks.length - 1; P.setInstrument(ti, 38); P.setVol(ti, 1);
  const ra = await H.harmorLoadAudio(ti, '/Samples/vocalA.wav', { quality: 1 }), rb = await H.harmorLoadAudio(ti, '/Samples/vocalB.wav', { quality: 1, image: 1 });
  if (ra.error || rb.error) return { error: ra.error || rb.error };
  // one clip: A (img 0), B (img 1), an empty image (img 5 -> plays image 1 = A): beats 0, 1, 2 of 120 BPM (0.5 s each), 0.4 s long
  const Q = P.PPQ, c = P.addClip(ti, 0, Q * 4); c.notes = [{ t: 0, d: Q * 0.8, p: 57, v: 1 }, { t: Q, d: Q * 0.8, p: 57, v: 1, img: 1 }, { t: Q * 2, d: Q * 0.8, p: 57, v: 1, img: 5 }]; P.touchClips(ti); P.syncAll && P.syncAll();
  const ratio = (x, t0) => { const a = Math.round(t0 * sr), n = 8192; let c1r = 0, c1i = 0, c2r = 0, c2i = 0, c3r = 0, c3i = 0;   // |H2| / |H1| and |H3| / |H1| (Goertzel-like DFT at 220 / 440 / 660 Hz)
    for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n), v = (x[a + i] || 0) * w, ph = 2 * Math.PI * 220 * i / sr; c1r += v * Math.cos(ph); c1i += v * Math.sin(ph); c2r += v * Math.cos(2 * ph); c2i += v * Math.sin(2 * ph); c3r += v * Math.cos(3 * ph); c3i += v * Math.sin(3 * ph); }
    const m1 = Math.hypot(c1r, c1i) + 1e-12; return { h2: 20 * Math.log10(Math.hypot(c2r, c2i) / m1 + 1e-9), h3: 20 * Math.log10(Math.hypot(c3r, c3i) / m1 + 1e-9) }; };
  const render = async () => Array.from((await eng.renderTrack(ti, 1.6)).l);
  const x1 = await render(); const res = { a: ratio(x1, 0.12), b: ratio(x1, 0.62), e: ratio(x1, 1.12) };
  const files = []; { const t = P.state.tracks[ti]; if (t.inst.hm) files.push(t.inst.hm.path); for (const v of Object.values(t.inst.hmI || {})) files.push(v.path); }
  // save -> open: the vocals come back from the project (restoreHarmorMap), the notes keep their image
  const txt = P.serialize(); await P.deserialize(txt); for (let k = 0; k < 100 && !(P.state.tracks[0].inst.params[HM.IMG + 0] >= 0); k++) await new Promise((o) => setTimeout(o, 100));
  const x2 = await render(); let d = 0, e = 0; for (let i = 0; i < x1.length; i++) { d += (x1[i] - x2[i]) ** 2; e += x1[i] ** 2; }
  return { res, files, imgKept: P.state.tracks[0].clips[0].notes.map((n) => n.img || 0), reopenDb: 10 * Math.log10(d / e + 1e-20) };
});
if (r.error) { ok(false, 'resynthesis: ' + r.error); } else {
  const f = (o) => `2nd ${o.h2.toFixed(1)} dB, 3rd ${o.h3.toFixed(1)} dB`;
  ok(r.res.a.h2 < -25 && r.res.a.h3 > -20, `note with vocal 1 (odd harmonics): ${f(r.res.a)}`);
  ok(r.res.b.h2 > -6 && r.res.b.h3 < -8, `note with vocal 2 in the same pattern (strong 2nd): ${f(r.res.b)}`);
  ok(r.res.e.h2 < -25 && r.res.e.h3 > -20, `note with an empty vocal (6) falls back to vocal 1: ${f(r.res.e)}`);
  ok(r.files.length === 2 && r.files.some((p) => p.endsWith('vocalB.wav')), `both vocals are the track's sources (ZIP / restore): ${r.files.join(', ')}`);
  ok(JSON.stringify(r.imgKept) === '[0,1,5]', `the notes keep their vocal after save / open (${r.imgKept})`);
  ok(r.reopenDb < -40, `the reopened project sounds the same (difference ${r.reopenDb.toFixed(1)} dB)`);
}
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nHARMOR MULTI-VOCAL OK'); process.exit(bad ? 1 : 0);
