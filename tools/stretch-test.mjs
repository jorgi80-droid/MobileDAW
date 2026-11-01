// Time-stretch audit (js/engine/audioops.js), measured on synthetic material, for the three warp algorithms:
//   beats = WSOLA, tones = phase vocoder (identity phase locking + transient phase reset), repitch = resampling.
// Measures: output length, pitch kept (or changed by exactly 1/ratio for repitch), level flutter on a steady tone, spectral purity of a
// chord (energy outside the chord partials = doubling / phasiness), transients (count, timing, pre-echo), stereo phase, a variable-ratio warp.
// Usage: node tools/stretch-test.mjs [--table]     (part of tools/run-tests.mjs; --table prints every measurement)
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = await import(path.join(root, 'js/engine/audioops.js'));
const { fft } = await import(path.join(root, 'js/engine/dsp.js'));
const SR = 48000, MODES = ['beats', 'tones', 'repitch'];
let bad = 0; const ok = (c, msg) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const tone = (fs, n, amps) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < fs.length; k++) s += amps[k] * Math.sin(2 * Math.PI * fs[k] * i / SR + k); a[i] = s; } return a; };
function spectrum(x, from, N = 16384) {           // Hann-windowed magnitude spectrum of N samples starting at `from`
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[from + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  fft(re, im, N); const m = new Float64Array(N / 2); for (let b = 0; b < N / 2; b++) m[b] = Math.hypot(re[b], im[b]); return m;
}
function peakHz(x, from) { const m = spectrum(x, from), N = 16384; let b = 1; for (let k = 2; k < m.length - 1; k++) if (m[k] > m[b]) b = k; const a = m[b - 1], c = m[b + 1], d = a - 2 * m[b] + c, off = d ? 0.5 * (a - c) / d : 0; return (b + off) * SR / N; }
function purity(x, from, fs) {                    // share of the spectral energy within +-3 bins (+-9 Hz) of the expected partials
  const m = spectrum(x, from), N = 16384; let inE = 0, tot = 0; const keep = new Uint8Array(m.length);
  for (const f of fs) { const b = Math.round(f * N / SR); for (let k = b - 3; k <= b + 3; k++) keep[k] = 1; }
  for (let b = 2; b < m.length; b++) { const e = m[b] * m[b]; tot += e; if (keep[b]) inE += e; }
  return inE / tot;
}
function flutterDb(x, a, b, W = 2400) {           // max - min RMS (dB) over W-sample windows (a steady tone should stay flat)
  let lo = Infinity, hi = -Infinity;
  for (let i = a; i + W <= b; i += W / 2) { let e = 0; for (let k = 0; k < W; k++) e += x[i + k] * x[i + k]; const d = 10 * Math.log10(e / W + 1e-20); lo = Math.min(lo, d); hi = Math.max(hi, d); }
  return hi - lo;
}
const rows = [];
const T = (mode, name, v, unit = '') => rows.push(`${mode.padEnd(8)} ${name.padEnd(46)} ${typeof v === 'number' ? v.toFixed(3) : v}${unit}`);

// 1. length + pitch on a steady 440 Hz tone, 2. level flutter
const n = SR * 3, sine = tone([440], n, [0.5]);
for (const mode of MODES) for (const ratio of [0.75, 1.5, 2]) {
  const o = A.stretchBy(sine, sine, ratio, mode), want = Math.floor(n * ratio), hz = peakHz(o.l, Math.floor(o.l.length / 2) - 8192), exp = mode === 'repitch' ? 440 / ratio : 440;
  const fl = flutterDb(o.l, 6000, o.l.length - 6000);
  T(mode, `x${ratio} length / pitch / flutter`, `${o.l.length} frames, ${hz.toFixed(2)} Hz, ${fl.toFixed(2)} dB`);
  ok(Math.abs(o.l.length - want) <= 1 && Math.abs(hz - exp) < 0.5, `${mode} x${ratio}: ${o.l.length} frames (${want}), ${hz.toFixed(2)} Hz (${exp.toFixed(2)} expected)`);
  if (mode !== 'beats') ok(fl < 0.5, `${mode} x${ratio}: steady tone stays steady (level flutter ${fl.toFixed(2)} dB < 0.5)`);
}
// 3. chord purity (sustained polyphonic material: where WSOLA doubles / phases)
const chordF = [261.63, 329.63, 392, 523.25, 659.26], chord = tone(chordF, n, [0.2, 0.18, 0.16, 0.1, 0.08]), pur = {};
for (const mode of ['beats', 'tones']) for (const ratio of [0.8, 1.3, 1.7]) {
  const o = A.stretchBy(chord, chord, ratio, mode), p = purity(o.l, Math.floor(o.l.length / 2) - 8192, chordF);
  pur[mode + ratio] = p; T(mode, `chord x${ratio}: energy on the partials`, (p * 100).toFixed(2) + ' %');
}
for (const ratio of [0.8, 1.3, 1.7]) ok(pur['tones' + ratio] > 0.995 && pur['tones' + ratio] >= pur['beats' + ratio] - 1e-4, `tones on a chord x${ratio}: ${(pur['tones' + ratio] * 100).toFixed(2)} % of the energy on the partials (WSOLA ${(pur['beats' + ratio] * 100).toFixed(2)} %)`);
// 4. transients: a hit (click + 30 ms noise burst) every 0.5 s
{
  const hits = 6, m = SR * 3, x = new Float32Array(m); let seed = 1; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let h = 0; h < hits; h++) { const at = Math.round((0.25 + h * 0.5) * SR); x[at] = 0.9; for (let i = 1; i < SR * 0.03; i++) x[at + i] = rnd() * 0.5 * Math.exp(-i / (SR * 0.008)); }
  for (const mode of ['beats', 'tones']) for (const ratio of [1.5, 0.8]) {
    const o = A.stretchBy(x, x, ratio, mode).l, env = new Float32Array(o.length);
    for (let i = 0; i < o.length; i++) env[i] = Math.abs(o[i]);
    const found = []; let pre = -200;
    for (let h = 0; h < hits; h++) {                // onset = first sample above 30 % of the loudest one within +-60 ms of the expected time
      const t = Math.round((0.25 + h * 0.5) * SR * ratio), a = t - 2880, b = t + 2880; let bv = 0;
      for (let i = a; i < b; i++) if (env[i] > bv) bv = env[i];
      let on = a; while (on < b && env[on] < 0.3 * bv) on++;
      found.push((on - t) / SR * 1000);
      let e0 = 0, e1 = 0; for (let i = on - 1920; i < on - 144; i++) e0 += o[i] * o[i]; for (let i = on; i < on + 1440; i++) e1 += o[i] * o[i];   // 40..3 ms before vs 30 ms after
      pre = Math.max(pre, 10 * Math.log10(e0 / e1 + 1e-12));
    }
    const late = Math.max(...found.map(Math.abs));
    if (process.env.DBG) console.log(mode, ratio, found.map((q) => q.toFixed(1)).join(" "));
    T(mode, `hits x${ratio}: worst timing / pre-echo`, `${late.toFixed(1)} ms / ${pre.toFixed(1)} dB`);
    const lim = mode === 'beats' ? 16 : 3; ok(late < lim, `${mode} hits x${ratio}: every hit within ${late.toFixed(1)} ms of its stretched time (< ${lim}${mode === 'beats' ? ': WSOLA searches +-10 ms for the best match' : ''})`);
    if (mode === 'beats') ok(pre < -20, `beats hits x${ratio}: pre-echo before the attack ${pre.toFixed(1)} dB (< -20: WSOLA is the mode for drums)`);
    else ok(pre < -20, `tones hits x${ratio}: pre-echo ${pre.toFixed(1)} dB (< -20: attacks are copied 1:1 by the transient lock)`);
  }
}
// 5. stereo image: an out-of-phase pair stays out of phase (phases are rotated together, not per channel)
{
  const L = tone([300, 700], n, [0.3, 0.2]), R = Float32Array.from(L, (v) => -v);
  for (const mode of MODES) {
    const o = A.stretchBy(L, R, 1.4, mode); let c = 0, a = 0, b = 0; for (let i = 10000; i < o.l.length - 10000; i++) { c += o.l[i] * o.r[i]; a += o.l[i] * o.l[i]; b += o.r[i] * o.r[i]; }
    const corr = c / Math.sqrt(a * b); T(mode, 'stereo correlation of an out-of-phase pair', corr);
    ok(corr < -0.99, `${mode}: out-of-phase stereo stays out of phase (correlation ${corr.toFixed(4)})`);
  }
}
// 6. variable-ratio warp (tempo map path): the tones / repitch warps follow the breakpoint curve
{
  const src = tone([440], SR * 4, [0.5]), xo = Float64Array.from([0, SR, SR * 3]), xs = Float64Array.from([0, SR, SR * 2]);   // 1x for 1 s, then 0.5x speed for 2 s
  for (const mode of ['tones', 'repitch']) {
    const o = A.warpBuffers(src, src, xo, xs, SR * 3, mode).l, f1 = peakHz(o, 4000), f2 = peakHz(o, SR * 2 - 8192);
    const want2 = mode === 'repitch' ? 220 : 440;
    ok(o.length === SR * 3 && Math.abs(f1 - 440) < 1 && Math.abs(f2 - want2) < 1, `${mode} warp along a curve: ${f1.toFixed(1)} Hz then ${f2.toFixed(1)} Hz (440 then ${want2})`);
  }
}
// 7. pitch shift that keeps the length, both algorithms
for (const mode of ['beats', 'tones']) {
  const o = A.pitchBuffers(sine, sine, 7, mode), hz = peakHz(o.l, Math.floor(o.l.length / 2) - 8192), want = 440 * Math.pow(2, 7 / 12);
  ok(Math.abs(o.l.length - n) < 64 && Math.abs(hz - want) < 1.5, `${mode} pitch +7 st: ${hz.toFixed(2)} Hz (${want.toFixed(2)}), length ${o.l.length} (${n})`);
}
if (process.argv.includes('--table')) { console.log(''); for (const r of rows) console.log(r); }
console.log(bad ? `\n${bad} FAILED` : '\nALL OK');
process.exit(bad ? 1 : 0);
