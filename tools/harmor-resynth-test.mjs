// Harmor resynthesis = harmonics + residual (Playwright + Chromium, the WebAssembly engine), the owner's round trip on a synthetic
// source: a melody of harmonic notes with "s"-like noise bursts between them (stereo). Checked against the SOURCE every time:
//   identity  - the source resynthesised and played at its note (Freq Dev 100 %): spectrum, level, the noise bursts come back
//   flatten   - Freq Dev 0 %, one long note: every voiced frame on that note
//   restore   - the flat render resynthesised again, the melody as notes (mono + legato, Formant off): pitch and spectrum of the source
//   speed 2x  - the residual waveform cannot be stretched: the noise bands stand in (the bursts keep their level)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
import { fft } from '../js/engine/dsp.js';
import { trackPitch, hzToMidi } from '../js/audiokit/pitch.js';
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

// the source: 4 notes of 0.45 s (a harmonic tone, 1/k^1.2, a little vibrato-free), an 80 ms noise burst (high band) after each, stereo
const MEL = [57, 62, 64, 59], NOTE = 0.45, BURST = 0.08, GAP = 0.05;
const r = await page.evaluate(async ({ MEL, NOTE, BURST, GAP }) => {
  const P = await import('./js/project.js'), { eng } = await import('./js/engine.js'), H = await import('./js/harmor/harmor.js'), { encodeWav } = await import('./js/engine/wav.js'), { HM } = await import('./js/harmor/schema.js');
  await eng.start(); const sr = eng.info().sampleRate; P.newProject(false); P.setBpm(120);
  const seg = NOTE + BURST + GAP, dur = MEL.length * seg + 0.2, n = Math.round(dur * sr), L = new Float32Array(n), R = new Float32Array(n);
  let s = 12345; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  let hp = 0;
  MEL.forEach((p, q) => { const f = 440 * 2 ** ((p - 69) / 12), a0 = Math.round(q * seg * sr), an = Math.round(NOTE * sr);
    for (let i = 0; i < an; i++) { const env = Math.min(1, i / (0.01 * sr), (an - i) / (0.02 * sr)); let v = 0; for (let k = 1; k * f < 0.45 * sr && k <= 40; k++) v += Math.sin(2 * Math.PI * k * f * i / sr) / k ** 1.2; L[a0 + i] += 0.18 * env * v; R[a0 + i] += 0.13 * env * v; }
    const b0 = a0 + an + Math.round(0.01 * sr), bn = Math.round(BURST * sr);
    for (let i = 0; i < bn; i++) { const env = Math.sin(Math.PI * i / bn), x = rnd(); hp = 0.6 * hp + 0.6 * (x - (hp)); const y = x - hp * 0.5; L[b0 + i] += 0.08 * env * y; R[b0 + i] += 0.08 * env * y; } });
  await eng.saveBytes('/Samples/src.wav', new Uint8Array(encodeWav([L], [R], n, sr, 32, 2)));
  const TPS = 2 * P.PPQ, tk = (x) => Math.round(x * TPS), b64 = (x) => Array.from(x);
  const setup = async (i, file, extra) => { P.addTrack('midi'); P.setInstrument(i, 38); const res = await H.harmorLoadAudio(i, file, { quality: 2 });
    for (const [k, v] of [[HM.MAP_LOOP, 0], [HM.ATT, 0.001], [HM.SUS, 1], [HM.REL, 0.05], [HM.QUALITY, 2], [HM.VOL, 1], ...extra]) P.setInstParam(i, k, v); return res; };
  const out = { sr, n, src: [b64(L), b64(R)] };
  // identity
  const a = await setup(0, '/Samples/src.wav', [[HM.MAP_FDEV, 1]]); const base = Math.round(a.report.note); out.report = a.report; out.base = base;
  out.slots = [P.state.tracks[0].inst.params[HM.MAP_N] >= 0, P.state.tracks[0].inst.params[HM.MAP_W] >= 0];
  let c = P.addClip(0, 0, tk(dur)); c.notes = [{ t: 0, d: tk(dur), p: base, v: 1 }]; P.touchClips(0);
  let f = await eng.renderTrack(0, dur); out.id = [b64(f.l.slice(0, n)), b64(f.r.slice(0, n))];
  // speed 2x: the noise bands stand in for the waveform (played over half the time)
  P.setInstParam(0, HM.MAP_SPEED, 2); f = await eng.renderTrack(0, dur); out.sp2 = [b64(f.l.slice(0, n)), b64(f.r.slice(0, n))]; P.setInstParam(0, HM.MAP_SPEED, 1);
  // Map End in the middle of note 1: Loop off holds that frame (note 1 sounds on, no bursts after it); Map End at the end of segment 1 + Loop on repeats segment 1
  const mapDur = (a.report.frames - 1) * a.report.hopMs / 1000, segS = NOTE + BURST + GAP; out.mapDur = mapDur;
  P.setInstParam(0, HM.MAP_END, 0.25 / mapDur); f = await eng.renderTrack(0, dur); out.endHold = [b64(f.l.slice(0, n)), b64(f.r.slice(0, n))];
  P.setInstParam(0, HM.MAP_END, segS / mapDur); P.setInstParam(0, HM.MAP_LOOP, 1); f = await eng.renderTrack(0, dur); out.endLoop = [b64(f.l.slice(0, n)), b64(f.r.slice(0, n))];
  P.setInstParam(0, HM.MAP_LOOP, 0); P.setInstParam(0, HM.MAP_END, 1);
  // flatten
  await setup(1, '/Samples/src.wav', [[HM.MAP_FDEV, 0]]); c = P.addClip(1, 0, tk(dur)); c.notes = [{ t: 0, d: tk(dur), p: base, v: 1 }]; P.touchClips(1);
  f = await eng.renderTrack(1, dur); const fl = [f.l.slice(0, n), f.r.slice(0, n)]; out.flat = [b64(fl[0]), b64(fl[1])];
  await eng.saveBytes('/Samples/flat.wav', new Uint8Array(encodeWav([fl[0]], [fl[1]], n, sr, 32, 2)));
  // restore: the melody as notes on the flat file (mono + legato: the map keeps running; overlapping a little)
  await setup(2, '/Samples/flat.wav', [[HM.MAP_FDEV, 1], [HM.MONO, 1], [HM.LEGATO, 1], [HM.GLIDE, 0], [HM.MAP_FORMANT, 0]]);
  c = P.addClip(2, 0, tk(dur)); c.notes = MEL.map((p, q) => ({ t: q ? tk(q * (NOTE + BURST + GAP)) : 0, d: (q + 1 < MEL.length ? tk((q + 1) * (NOTE + BURST + GAP)) : tk(dur)) - (q ? tk(q * (NOTE + BURST + GAP)) : 0) + 24, p, v: 1 })); P.touchClips(2);
  f = await eng.renderTrack(2, dur); out.rest = [b64(f.l.slice(0, n)), b64(f.r.slice(0, n))];
  return out;
}, { MEL, NOTE, BURST, GAP });
const sr = r.sr, F = (a) => a.map((x) => Float32Array.from(x)), src = F(r.src), id = F(r.id), flat = F(r.flat), rest = F(r.rest), sp2 = F(r.sp2);
const mono = (c) => { const m = new Float32Array(c[0].length); for (let i = 0; i < m.length; i++) m[i] = 0.5 * (c[0][i] + c[1][i]); return m; };
// smoothed log-spectral distance (48 log bands 60 Hz - 16 kHz, 2048 / 512, 4-frame averages, bands within 30 dB of the loudest)
const N = 2048, HOP = 512, NB = 48, lo = Math.log2(60), hi = Math.log2(16000);
const bands = (x) => { const out = []; const re = new Float64Array(N), im = new Float64Array(N); for (let a = 0; a + N <= x.length; a += HOP) { for (let i = 0; i < N; i++) { re[i] = x[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; } fft(re, im, N); const bb = new Float64Array(NB); for (let k = 1; k < N / 2; k++) { const hz = k * sr / N; if (hz < 60 || hz >= 16000) continue; bb[Math.min(NB - 1, Math.floor((Math.log2(hz) - lo) / (hi - lo) * NB))] += re[k] ** 2 + im[k] ** 2; } out.push(bb); } return out; };
const lsd = (a, b) => { const A = bands(mono(a)), B = bands(mono(b)); let s = 0, c = 0; for (let f = 0; f + 4 <= A.length; f += 2) { const x = new Float64Array(NB), y = new Float64Array(NB); let mx = 0; for (let q = 0; q < 4; q++) for (let j = 0; j < NB; j++) { x[j] += A[f + q][j]; y[j] += B[f + q][j]; } for (let j = 0; j < NB; j++) mx = Math.max(mx, x[j]); if (mx < 1e-6) continue; let t = 0, n = 0; for (let j = 0; j < NB; j++) if (x[j] > mx * 1e-3) { t += Math.abs(10 * Math.log10((y[j] + 1e-12) / x[j])); n++; } if (n) { s += t / n; c++; } } return s / c; };
const rmsDb = (c, a = 0, z = c[0].length) => { let e = 0; for (let i = a; i < z; i++) e += c[0][i] ** 2 + c[1][i] ** 2; return 10 * Math.log10(e / (2 * (z - a)) + 1e-20); };
const seg = NOTE + BURST + GAP, burstAt = (q) => [Math.round((q * seg + NOTE + 0.01) * sr), Math.round((q * seg + NOTE + 0.01 + BURST) * sr)];
const burstDb = (c) => { let e = 0, n = 0; for (let q = 0; q < MEL.length; q++) { const [a, z] = burstAt(q); for (let i = a; i < z; i++) { e += c[0][i] ** 2 + c[1][i] ** 2; n++; } } return 10 * Math.log10(e / n + 1e-20); };
const pitchOf = (c) => { const tr = trackPitch(mono(c), sr, { hop: Math.round(sr * 0.01), minF: 60, maxF: 1200 }); return Array.from(tr.f0, (v, i) => (v > 0 && tr.conf[i] > 0.85 ? hzToMidi(v) : null)); };
ok(r.report.pitched && r.slots[0] && r.slots[1] && r.report.noisePct > 0.3, `analysis: pitched (note ${r.base}), harmonics + residual (noise bands + waveform slots set, residual ${r.report.noisePct.toFixed(1)} % of the energy)`);
const lI = lsd(src, id), dI = rmsDb(id) - rmsDb(src), bI = burstDb(id) - burstDb(src);
ok(lI < 1.5 && Math.abs(dI) < 0.5 && Math.abs(bI) < 1, `identity vs source: spectral distance ${lI.toFixed(2)} dB, level ${dI >= 0 ? '+' : ''}${dI.toFixed(2)} dB, noise bursts ${bI >= 0 ? '+' : ''}${bI.toFixed(2)} dB`);
const pf = pitchOf(flat).filter((v) => v != null), onBase = pf.filter((v) => Math.abs(v - r.base) < 0.5).length / pf.length;
ok(pf.length > 50 && onBase > 0.98, `flatten: ${(100 * onBase).toFixed(1)} % of ${pf.length} voiced frames on note ${r.base}`);
const ps = pitchOf(src), pr = pitchOf(rest); let both = 0, same = 0; for (let i = 0; i < Math.min(ps.length, pr.length); i++) if (ps[i] != null && pr[i] != null) { both++; if (Math.abs(ps[i] - pr[i]) < 0.5) same++; }
const lR = lsd(src, rest), dR = rmsDb(rest) - rmsDb(src), bR = burstDb(rest) - burstDb(src);
ok(both > 50 && same / both > 0.97 && lR < 2.5 && Math.abs(dR) < 1 && Math.abs(bR) < 1.5, `restore from the flat file vs source: same note ${(100 * same / both).toFixed(1)} % of ${both} frames, spectral distance ${lR.toFixed(2)} dB, level ${dR >= 0 ? '+' : ''}${dR.toFixed(2)} dB, noise bursts ${bR >= 0 ? '+' : ''}${bR.toFixed(2)} dB`);
// speed 2x: the source's first half plays in a quarter... the bursts of notes 1 and 2 land at half their times; compare their level
const half = (q) => { const [a, z] = burstAt(q); return [Math.round(a / 2), Math.round(z / 2)]; }; let e2 = 0, n2 = 0, eS = 0, nS = 0;
for (let q = 0; q < 2; q++) { const [a, z] = half(q); for (let i = a; i < z; i++) { e2 += sp2[0][i] ** 2 + sp2[1][i] ** 2; n2++; } const [a2, z2] = burstAt(q); for (let i = a2; i < z2; i++) { eS += src[0][i] ** 2 + src[1][i] ** 2; nS++; } }
const d2 = 10 * Math.log10((e2 / n2) / (eS / nS));
ok(Math.abs(d2) < 3, `Map Speed 2x: the noise bands stand in for the waveform, the bursts at ${d2 >= 0 ? '+' : ''}${d2.toFixed(2)} dB of the source`);
const eH = F(r.endHold), eL = F(r.endLoop), seg1 = (c, q) => { const z = Math.round((q * seg + NOTE) * sr); return [c[0].slice(z - Math.round(0.3 * sr), z), c[1].slice(z - Math.round(0.3 * sr), z)]; };
const pAt = (c, q) => { const p = pitchOf(seg1(c, q)).filter((v) => v != null); p.sort((x, y) => x - y); return p.length ? p[p.length >> 1] : null; };
const held = [1, 2, 3].map((q) => pAt(eH, q)), looped = [1, 2, 3].map((q) => pAt(eL, q));
const hL = rmsDb(seg1(eH, 3)) - rmsDb(seg1(src, 0));
ok(held.every((v) => v != null && Math.abs(v - MEL[0]) < 0.5) && Math.abs(hL) < 3, `Map End (Loop off): past the end it holds the end frame, notes 2-4 stay at ${held.map((v) => v && v.toFixed(1)).join(' / ')} (note 1 = ${MEL[0]}), level ${hL >= 0 ? '+' : ''}${hL.toFixed(1)} dB of note 1`);
const bL = (() => { let e = 0, n = 0; for (let q = 1; q < MEL.length; q++) { const [a0, z0] = burstAt(q); for (let i = a0 + Math.round(0.01 * sr); i < z0 - Math.round(0.01 * sr); i++) { e += eL[0][i] ** 2 + eL[1][i] ** 2; n++; } } return 10 * Math.log10(e / n + 1e-20) - burstDb(src); })();
ok(looped.every((v) => v != null && Math.abs(v - MEL[0]) < 0.5) && bL > -6, `Map End (Loop on): segment 1 repeats, pitch ${looped.map((v) => v && v.toFixed(1)).join(' / ')}, its burst comes back each time (${bL >= 0 ? '+' : ''}${bL.toFixed(1)} dB)`);
ok(!errs.length, `no page errors ${errs.slice(0, 2).join(' | ')}`);
await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nharmor-resynth-test: all passed');
process.exit(bad ? 1 : 0);
