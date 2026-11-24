// Harmor phase 3 (partial maps): image synthesis and audio resynthesis, measured on the WebAssembly engine. Known signals in:
//   engine: frames in time (held / interpolated / speed / loop), harmonic and log-frequency layouts, stereo maps, frequency deviation,
//   level / map mix, Image Gain / Image Freq articulators, formant preservation;
//   image: rows -> partials, columns -> time, colour -> stereo, crop (zoom / pan), log layout;
//   resynthesis: a stereo saw with vibrato comes back with its note, harmonic levels, vibrato and left / right balance; a vowel keeps its
//   formant when played an octave up (Formant on) and moves without it; noise is recognised as unpitched (log-frequency map).
// Usage: node tools/harmor-map-test.mjs   (needs js/engine/mdaw.wasm: sh native/wasm/build.sh)
import { loadWasmEngine } from './wasm-engine.mjs';
import { buildImageMap, packMap } from '../js/harmor/imagemap.js';
import { analyzeResynth } from '../js/harmor/resynth.js';

let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const db = (x) => 20 * Math.log10(Math.max(1e-12, x)), SR = 48000;
function bin(x, f, a, n) { let re = 0, im = 0, ws = 0; for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)), ph = 2 * Math.PI * f * i / SR; re += x[a + i] * w * Math.cos(ph); im -= x[a + i] * w * Math.sin(ph); ws += w; } return 2 * Math.hypot(re, im) / ws; }
function freqAt(x, f0, a, n) { const d = Math.round(SR * 0.01), ph = (b) => { let re = 0, im = 0; for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)), p = 2 * Math.PI * f0 * i / SR; re += x[b + i] * w * Math.cos(p); im -= x[b + i] * w * Math.sin(p); } return Math.atan2(im, re); }; let dp = ph(a + d) - ph(a) - 2 * Math.PI * f0 * d / SR; dp = Math.atan2(Math.sin(dp), Math.cos(dp)); return f0 + dp * SR / (2 * Math.PI * d); }
const at = (t) => Math.round(t * SR);
// a map into the engine (slots 40 / 41) and a note rendered
async function play(map, params, notes, secs) {
  const { A, B } = packMap(map), parts = [A.l, A.r, B && B.l, B && B.r], offs = []; let tot = 0; for (const p of parts) { offs.push(tot); tot += p ? p.length : 0; }
  const blob = new Float32Array(tot); parts.forEach((p, k) => p && blob.set(p, offs[k]));
  const w = await loadWasmEngine(SR); w.setBlob(blob);
  let cmd = 'masterLimit 0\ntrackVol 0 1\ntrackInst 0 38\n' + `sample 40 @${offs[0]}:${A.l.length}${A.r ? ` @${offs[1]}:${A.r.length}` : ''}\n` + (B ? `sample 41 @${offs[2]}:${B.l.length}${B.r ? ` @${offs[3]}:${B.r.length}` : ''}\n` : '');
  for (const [k, v] of Object.entries({ 40: 0.001, 41: 0.1, 42: 1, 43: 0.05, 44: 0, 1: 516, 2: 2, 1060: 1, ...params, 1061: 40, ...(B ? { 1062: 41 } : {}) })) cmd += `instParam 0 ${k} ${v}\n`;
  const er = w.cmd(cmd); if (er) throw new Error(er);
  const n = Math.round(secs * SR), L = new Float32Array(n), R = new Float32Array(n); let pos = 0;
  for (const e of notes) { const to = at(e[0]); if (to > pos) { const l = new Float32Array(to - pos), r = new Float32Array(to - pos); w.render(l, r, to - pos); L.set(l, pos); R.set(r, pos); pos = to; } w.cmd(`preview 0 ${e[1]} ${e[2] ? 1 : 0} ${e[2] ? 1 : 0}`); }
  const l = new Float32Array(n - pos), r = new Float32Array(n - pos); w.render(l, r, n - pos); L.set(l, pos); R.set(r, pos); return { L, R };
}
const mapOf = (frames, bins, fill, o = {}) => { const aL = new Float32Array(frames * bins); for (let f = 0; f < frames; f++) for (let j = 0; j < bins; j++) aL[f * bins + j] = fill(f, j); return { layout: 0, frames, bins, hop: 0.5, base: 0, flo: 20, fhi: 20000, aL, aR: null, dev: null, ph: null, ...o }; };
const F = 220, N = 8192;

// ---- engine: frames in time, interpolation, speed, loop, level / mix
{
  const m = mapOf(2, 16, (f, j) => (f === 0 && j === 2) || (f === 1 && j === 4) ? 0.5 : 0);
  const { L } = await play(m, { 1072: 0, 1071: 0 }, [[0, 57, 1]], 1.2);
  ok(bin(L, 3 * F, at(0.1), N) > 0.05 && bin(L, 5 * F, at(0.1), N) < 1e-4 && bin(L, 5 * F, at(0.7), N) > 0.05 && bin(L, 3 * F, at(0.7), N) < 1e-4, 'map frames in time: partial 3 for the first 0.5 s, then partial 5 (held at the end)');
  const it = (await play(m, { 1072: 1, 1071: 0 }, [[0, 57, 1]], 1.2)).L;
  const mid3 = bin(it, 3 * F, at(0.2), 2048), mid5 = bin(it, 5 * F, at(0.2), 2048);
  ok(mid3 > 0.01 && mid5 > 0.01, `interpolated frames crossfade (at 0.25 s partial 3 ${db(mid3).toFixed(1)} dB, partial 5 ${db(mid5).toFixed(1)} dB)`);
  const sp = (await play(m, { 1072: 0, 1071: 1, 1069: 2 }, [[0, 57, 1]], 1.2)).L;
  ok(bin(sp, 5 * F, at(0.27), 4096) > 0.05 && bin(sp, 3 * F, at(0.52), 4096) > 0.05, 'speed 2 + loop: partial 5 from 0.25 s, back to partial 3 at 0.5 s');
  const lv = (await play(m, { 1072: 0, 1071: 0, 1075: 0.5 }, [[0, 57, 1]], 0.4)).L, l1 = (await play(m, { 1072: 0, 1071: 0 }, [[0, 57, 1]], 0.4)).L;
  ok(Math.abs(db(bin(lv, 3 * F, at(0.1), N) / bin(l1, 3 * F, at(0.1), N)) - db(0.5)) < 0.05, 'map level 50 % = -6.02 dB');
  const half = (await play(m, { 1072: 0, 1071: 0, 1060: 0.5, 10: 0 }, [[0, 57, 1]], 0.4)).L;
  ok(Math.abs(db(bin(half, 3 * F, at(0.1), N) / bin(l1, 3 * F, at(0.1), N)) - db(0.5)) < 0.05 && bin(half, F, at(0.1), N) > 0.02, 'map mix 50 %: half the map, half the timbre (sine fundamental)');
}
// ---- engine: Image Gain / Image Freq articulators, shift
{
  const m = mapOf(1, 16, (f, j) => (j === 3 ? 0.5 : 0));
  const sh = (await play(m, { 1076: 12 }, [[0, 57, 1]], 0.6)).L;
  ok(bin(sh, 8 * F, at(0.1), N) > 0.05 && bin(sh, 4 * F, at(0.1), N) < 1e-3, 'map shift +12 st: the map is read an octave lower in partials (partial 4 -> partial 8)');
  const E = (e, k) => 110 + 60 * e + k;
  const ig = (await play(m, { [E(9, 0)]: 1, [E(9, 1)]: 1, [E(9, 5)]: 0.3, [E(9, 7)]: 0.1, [E(9, 8)]: 1 }, [[0, 57, 1]], 0.6)).L;
  ok(bin(ig, 4 * F, at(0.0), 2048) < 0.5 * bin(ig, 4 * F, at(0.4), 2048), 'Image Gain articulator: the map fades in over its attack');
  const ifr = (await play(m, { [E(8, 0)]: 1, [E(8, 1)]: 0.25, [E(8, 5)]: 0.001, [E(8, 6)]: 1, [E(8, 8)]: 1 }, [[0, 57, 1]], 0.6)).L;
  ok(bin(ifr, 8 * F, at(0.2), N) > 0.05, 'Image Freq articulator (+1 octave): the map moves up the partials');
}
// ---- engine: log-frequency layout is pitch independent; harmonic layout follows the note
{
  const B = 128, flo = 50, fhi = 12800, j1k = Math.round((Math.log2(1000) - Math.log2(flo)) / (Math.log2(fhi) - Math.log2(flo)) * (B - 1));
  const m = mapOf(1, B, (f, j) => (Math.abs(j - j1k) <= 3 ? 0.5 : 0.0), { layout: 1, flo, fhi });
  const a = (await play(m, {}, [[0, 57, 1]], 0.6)).L, b2 = (await play(m, {}, [[0, 60, 1]], 0.6)).L;
  const c4 = 440 * Math.pow(2, (60 - 69) / 12);
  ok(bin(a, 1100, at(0.1), N) > 0.02 && bin(b2, Math.round(1000 / c4) * c4, at(0.1), N) > 0.02 && bin(a, 2 * F, at(0.1), N) < 1e-3, 'log-frequency layout: the partial nearest 1 kHz sounds, whatever the note');
}
// ---- engine: stereo map pans each partial; frequency deviation moves partials
{
  const aL = new Float32Array(16), aR = new Float32Array(16); aL[1] = 0.5; aR[3] = 0.5;
  const st = await play({ ...mapOf(1, 16, () => 0), aL, aR }, {}, [[0, 57, 1]], 0.6);
  ok(bin(st.L, 2 * F, at(0.1), N) > 0.05 && bin(st.L, 4 * F, at(0.1), N) < 1e-4 && bin(st.R, 4 * F, at(0.1), N) > 0.05 && bin(st.R, 2 * F, at(0.1), N) < 1e-4, 'stereo map: partial 2 only left, partial 4 only right');
  const dev = new Float32Array(16); dev[0] = 100; const ph = new Float32Array(16);
  const dv = (await play({ ...mapOf(1, 16, (f, j) => (j === 0 ? 0.5 : 0)), dev, ph }, {}, [[0, 57, 1]], 0.6)).L;
  const fm = freqAt(dv, F * Math.pow(2, 1 / 12), at(0.1), N);
  ok(Math.abs(fm - F * Math.pow(2, 1 / 12)) < 0.05, `frequency deviation +100 cents: partial 1 at ${fm.toFixed(2)} Hz (${(F * Math.pow(2, 1 / 12)).toFixed(2)})`);
}
// ---- image: rows -> partials, columns -> time, colour -> stereo, crop
{
  const w = 64, h = 32, img = new Uint8ClampedArray(w * h * 4);
  const set = (x, y, r, g, b) => { const o = (y * w + x) * 4; img[o] = r; img[o + 1] = g; img[o + 2] = b; img[o + 3] = 255; };
  for (let x = 0; x < 32; x++) set(x, h - 1 - 2, 255, 255, 255);          // left half: row 2 from the bottom = partial 3
  for (let x = 32; x < 64; x++) set(x, h - 1 - 6, 255, 255, 255);         // right half: partial 7
  const map = buildImageMap(img, w, h, { frames: 64, bins: 32, seconds: 1 });
  const { L } = await play(map, { 1072: 0, 1071: 0 }, [[0, 57, 1]], 1.2);
  ok(bin(L, 3 * F, at(0.1), N) > 0.05 && bin(L, 7 * F, at(0.1), N) < 1e-3 && bin(L, 7 * F, at(0.7), N) > 0.05 && bin(L, 3 * F, at(0.7), N) < 1e-3, 'image: bright rows become partials (3, then 7), columns become time');
  const zoom = buildImageMap(img, w, h, { x0: 0.5, x1: 1, frames: 32, bins: 32, seconds: 1 });
  const Z = (await play(zoom, { 1072: 0, 1071: 0 }, [[0, 57, 1]], 0.6)).L;
  ok(bin(Z, 7 * F, at(0.1), N) > 0.05 && bin(Z, 3 * F, at(0.1), N) < 1e-3, 'image crop (zoom / pan to the right half): only partial 7');
  const col = new Uint8ClampedArray(w * h * 4); for (let x = 0; x < w; x++) { const o = ((h - 1 - 1) * w + x) * 4; col[o] = 255; col[o + 3] = 255; const o2 = ((h - 1 - 4) * w + x) * 4; col[o2 + 2] = 255; col[o2 + 3] = 255; }
  const cm = buildImageMap(col, w, h, { frames: 8, bins: 32, stereo: true, rangeDb: 40 });
  const cs = await play(cm, {}, [[0, 57, 1]], 0.5);
  ok(bin(cs.L, 2 * F, at(0.1), N) > 10 * bin(cs.R, 2 * F, at(0.1), N) && bin(cs.R, 5 * F, at(0.1), N) > 10 * bin(cs.L, 5 * F, at(0.1), N), 'image colour pans: the red row left, the blue row right');
}
// ---- resynthesis: a stereo saw with vibrato
{
  const n = SR * 2, L = new Float32Array(n), R = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, f = 220 * Math.pow(2, (30 / 1200) * Math.sin(2 * Math.PI * 5 * t)); ph += f / SR; let v = 0; for (let k = 1; k <= 20; k++) v += Math.sin(2 * Math.PI * k * ph) / k; L[i] = 0.3 * v; R[i] = 0.15 * v; }
  const t0 = performance.now(), m = analyzeResynth(L, R, SR, { quality: 1 }), ms = performance.now() - t0;
  ok(m.report.pitched && Math.abs(m.base - 57) < 0.1, `resynthesis finds the note: MIDI ${m.base.toFixed(2)} (57), ${m.frames} frames x ${m.bins} partials in ${ms.toFixed(0)} ms`);
  const fr = Math.round(m.frames / 2), lv = [1, 2, 3, 5, 8].map((k) => m.aL[fr * m.bins + k - 1]);
  ok(lv.every((a, i) => Math.abs(db(a / lv[0]) - db(1 / [1, 2, 3, 5, 8][i])) < 0.5) && Math.abs(lv[0] - 0.3) < 0.03, `analysed harmonic levels 1/k (${lv.map((a) => db(a / lv[0]).toFixed(2)).join(', ')} dB), partial 1 = ${lv[0].toFixed(3)} (0.300)`);
  let dmax = -1e9, dmin = 1e9; for (let f = 10; f < m.frames - 10; f++) { const d = m.dev[f * m.bins]; dmax = Math.max(dmax, d); dmin = Math.min(dmin, d); }
  ok(Math.abs((dmax - dmin) / 2 - 30) < 5, `analysed vibrato: +-${((dmax - dmin) / 2).toFixed(1)} cents (30)`);
  const out = await play(m, { 0: 1, 1069: 1, 1071: 0 }, [[0, 57, 1]], 1.6);
  const gain = 0.25;                                                // voice gain at volume 1, velocity 1, no velocity scaling
  const oL = [1, 2, 3].map((k) => bin(out.L, k * 220, at(0.6), 4096) / gain), iL = [1, 2, 3].map((k) => bin(L, k * 220, at(0.6), 4096));
  ok(oL.every((x, i) => Math.abs(db(x / iL[i])) < 1), `resynthesised harmonic levels match the source within 1 dB (${oL.map((x, i) => db(x / iL[i]).toFixed(2)).join(', ')} dB)`);
  const tr = []; for (let t = 0.3; t < 1.3; t += 0.005) tr.push(freqAt(out.L, 220, at(t), 960));
  const vib = 1200 * Math.log2(Math.max(...tr) / Math.min(...tr)) / 2;
  ok(Math.abs(vib - 30) < 6, `the resynthesised note keeps the vibrato (+-${vib.toFixed(1)} cents)`);
  const bal = db(bin(out.R, 220, at(0.6), 4096) / bin(out.L, 220, at(0.6), 4096));
  ok(Math.abs(bal - db(0.5)) < 0.5, `stereo balance kept: right ${bal.toFixed(2)} dB re left (-6.02)`);
}
// ---- resynthesis: formant preservation (a vowel-like spectrum with a peak near 800 Hz, analysed at 110 Hz, played at 220 Hz)
{
  const n = SR * 1.5, x = new Float32Array(n), fb = 110;
  for (let i = 0; i < n; i++) { let v = 0; for (let k = 1; k <= 60; k++) { const f = k * fb, g = Math.exp(-0.5 * ((Math.log2(f) - Math.log2(800)) / 0.25) ** 2) + 0.05; v += g * Math.sin(2 * Math.PI * f * i / SR); } x[i] = 0.2 * v; }
  const m = analyzeResynth(x, null, SR, { quality: 1 });
  const peakAt = async (formant) => { const { L } = await play(m, { 1073: formant, 1071: 1 }, [[0, 57, 1]], 1); let best = 0, bf = 0; for (let k = 1; k <= 20; k++) { const a = bin(L, k * 220, at(0.4), 4096); if (a > best) { best = a; bf = k * 220; } } return bf; };
  const on = await peakAt(1), off = await peakAt(0);
  ok(Math.abs(on - 880) <= 220 && Math.abs(off - 1760) <= 220, `formant preservation: an octave up the peak stays near 800 Hz with Formant on (${on} Hz), moves up an octave without (${off} Hz)`);
}
// ---- resynthesis: noise is unpitched -> a log-frequency envelope that follows the source spectrum
{
  const n = SR, x = new Float32Array(n); let y = 0; for (let i = 0; i < n; i++) { y = 0.9 * y + 0.1 * (Math.random() * 2 - 1); x[i] = y; }   // low-passed noise
  const m = analyzeResynth(x, null, SR, { quality: 1 });
  ok(!m.report.pitched && m.layout === 1, 'noise: no reliable pitch -> log-frequency map (' + m.report.why + ')');
  const { L } = await play(m, { 1071: 1 }, [[0, 45, 1]], 0.8);
  ok(bin(L, 110, at(0.2), 8192) > 4 * bin(L, 110 * 60, at(0.2), 8192), 'the noise map keeps its low-pass tilt on the partials');
}
console.log(bad ? `\n${bad} FAILED` : '\nharmor-map-test: all passed'); process.exit(bad ? 1 : 0);
