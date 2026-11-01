// MP3 export quality: MobileDAW's encoder (js/engine/mp3.js) against LAME (ffmpeg libmp3lame, the encoder most apps ship) at the same
// bitrate, on the same audio. Both files are decoded by ffmpeg, aligned to the source, then compared with
//   - SNR (plain signal-to-noise),
//   - NMR: coding noise against a simple masking threshold per critical band (spreading -27 / -10 dB per Bark, offset -10 dB) — a
//     perceptual estimate, not a listening test; "audible bands" = share of band/frame cells whose noise is above that threshold,
//   - bandwidth (highest frequency within 30 dB of the source spectrum).
// Source: a synthetic mix (chords, bass, kick, hats, a 15 kHz tone), or MP3_SRC=/path/file.wav (any format ffmpeg reads).
// Usage: node tools/mp3-quality-test.mjs   (needs ffmpeg with libmp3lame; skipped without it). Not part of run-tests.
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const { Mp3Encoder } = await import('../js/engine/mp3.js');
const { encodeWav } = await import('../js/engine/wav.js');
try { execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { stdio: 'pipe' }).toString().includes('libmp3lame') || (() => { throw 0; })(); } catch { console.log('mp3-quality-test: skipped (ffmpeg with libmp3lame not found)'); process.exit(0); }
const SR = 44100, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mp3q-'));
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 30 });
const decode = (file) => { const b = ff(['-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-']); const f = new Float32Array(b.buffer, b.byteOffset, b.byteLength >> 2), n = f.length >> 1, L = new Float32Array(n), R = new Float32Array(n); for (let i = 0; i < n; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1]; } return { L, R }; };

function synth(secs = 12) {
  const n = SR * secs, L = new Float32Array(n), R = new Float32Array(n); let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const chords = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]], hz = (m) => 440 * 2 ** ((m - 69) / 12), bpm = 120, beat = 60 / bpm;
  const ph = new Float64Array(8); let hp = 0, lpL = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, b = t / beat, bar = Math.floor(b / 4) % 4, inB = b % 1;
    let s = 0;
    chords[bar].forEach((m, k) => { for (const det of [-0.08, 0.08]) { const f = hz(m) * 2 ** (det / 12); ph[k] = (ph[k] + f / SR) % 1; s += (2 * ((ph[k] + (det > 0 ? 0.37 : 0)) % 1) - 1) * 0.045; } });
    lpL += 0.25 * (s - lpL); s = lpL;                                                     // soft pad
    const bf = hz(chords[bar][0] - 24); ph[6] = (ph[6] + bf / SR) % 1; s += Math.sin(2 * Math.PI * ph[6]) * 0.22 * (inB < 0.5 ? 1 : 0.6);
    const kt = inB * beat; s += Math.sin(2 * Math.PI * (50 * kt + 120 * (1 - Math.exp(-kt * 30)) / 30)) * Math.exp(-kt * 9) * 0.45;   // kick
    const ht = ((b + 0.5) % 1) * beat, nz = rnd(); hp = nz - hp * 0.0; const hat = (nz - (L[i - 1] || 0) * 0) * Math.exp(-ht * 45) * 0.08;
    ph[7] = (ph[7] + 15000 / SR) % 1; const air = Math.sin(2 * Math.PI * ph[7]) * 0.01;
    L[i] = s + hat + air; R[i] = s * 0.92 + hat * (nz > 0 ? 1 : 0.7) - air;
  }
  return { L, R };
}

// ---- metrics
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr; re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
}
const N = 2048, WIN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
const bark = (f) => 13 * Math.atan(0.00076 * f) + 3.5 * Math.atan((f / 7500) ** 2);
const NB = 25, binBand = Int32Array.from({ length: N / 2 }, (_, k) => Math.min(NB - 1, Math.floor(bark(k * SR / N))));
function align(src, dec) {                                                                 // decoder / encoder delay
  let best = 0, bv = -Infinity; const a = SR, len = SR * 2;
  for (let d = -3000; d <= 3000; d++) { let s = 0; for (let i = a; i < a + len; i += 3) s += src[i] * (dec[i + d] || 0); if (s > bv) { bv = s; best = d; } }
  return best;
}
function metrics(src, dec) {
  const d = align(src.L, dec.L), n = Math.min(src.L.length, dec.L.length - Math.max(0, d)) - N;
  let es = 0, en = 0; const sig = new Float64Array(N / 2), noi = new Float64Array(N / 2), dp = new Float64Array(N / 2);
  let cells = 0, audible = 0, nmrSum = 0; const diag = { band: new Array(NB).fill(0), trans: 0, quiet: 0 };
  for (const c of ['L', 'R']) {
    const S = src[c], D = dec[c];
    for (let i = 4096; i < n; i++) { const x = S[i], e = (D[i + d] || 0) - x; es += x * x; en += e * e; }
    for (let o = 4096; o + N < n; o += N / 2) {
      const sr = new Float64Array(N), si = new Float64Array(N), nr = new Float64Array(N), ni = new Float64Array(N);
      for (let i = 0; i < N; i++) { const x = S[o + i]; sr[i] = x * WIN[i]; nr[i] = ((D[o + i + d] || 0) - x) * WIN[i]; }
      fft(sr, si); fft(nr, ni);
      const bs = new Float64Array(NB), bn = new Float64Array(NB);
      for (let k = 1; k < N / 2; k++) { const ps = sr[k] ** 2 + si[k] ** 2, pn = nr[k] ** 2 + ni[k] ** 2; sig[k] += ps; noi[k] += pn; dp[k] += (sr[k] + nr[k]) ** 2 + (si[k] + ni[k]) ** 2; bs[binBand[k]] += ps; bn[binBand[k]] += pn; }
      const total = bs.reduce((a, b) => a + b, 0); if (total < 1e-6) continue;           // silence
      let e0 = 0, e1 = 0; for (let i = 0; i < N / 2; i++) { e0 += S[o + i] ** 2; e1 += S[o + N / 2 + i] ** 2; } const isT = e1 > 8 * e0;
      for (let j = 0; j < NB; j++) {
        let thr = 0; for (let k = 0; k < NB; k++) { const dz = j - k; thr += bs[k] * 10 ** ((dz >= 0 ? -10 * dz : 27 * dz) / 10); }
        thr *= 10 ** (-10 / 10); thr = Math.max(thr, total * 1e-9);
        const nmr = 10 * Math.log10((bn[j] + 1e-20) / thr); cells++; nmrSum += nmr; if (nmr > 0) { audible++; diag.band[j]++; if (isT) diag.trans++; if (total < 1e-2) diag.quiet++; }
      }
    }
  }
  // bandwidth: highest frequency where the decoded spectrum still holds the source (within 3 dB) and the source is above -90 dB of its peak
  let bw = 0; const top = Math.max(...sig);
  for (let k = 1; k < N / 2; k++) if (sig[k] > top * 1e-9 && Math.abs(10 * Math.log10((dp[k] + 1e-30) / sig[k])) < 3) bw = k;
  if (process.env.MP3_DIAG) { const bs = new Float64Array(NB), bn = new Float64Array(NB); for (let k = 1; k < N / 2; k++) { bs[binBand[k]] += sig[k]; bn[binBand[k]] += noi[k]; } console.log('   diag', JSON.stringify(diag), 'S/N per band dB', [...bs].map((v, j) => Math.round(10 * Math.log10(v / bn[j]))).join(' ')); }
  return { delay: d, snr: 10 * Math.log10(es / en), nmr: nmrSum / cells, audible: 100 * audible / cells, bw: Math.round(bw * SR / N) };
}

const src = process.env.MP3_SRC ? decode(process.env.MP3_SRC) : synth();
const srcWav = path.join(tmp, 'src.wav'); fs.writeFileSync(srcWav, Buffer.from(encodeWav([src.L], [src.R], src.L.length, SR, 32, 2)));
const rows = [];
for (const kbps of [128, 192, 256, 320]) {
  const enc = new Mp3Encoder(SR, 2, kbps), parts = [];
  for (let o = 0; o < src.L.length; o += 4096) for (const f of enc.encode(src.L.subarray(o, o + 4096), src.R.subarray(o, o + 4096), Math.min(4096, src.L.length - o))) parts.push(f);
  for (const f of enc.finish()) parts.push(f);
  const mFile = path.join(tmp, `mdaw${kbps}.mp3`), lFile = path.join(tmp, `lame${kbps}.mp3`);
  fs.writeFileSync(mFile, Buffer.concat(parts.map((p) => Buffer.from(p))));
  ff(['-i', srcWav, '-c:a', 'libmp3lame', '-b:a', kbps + 'k', lFile]);
  let derr = ''; try { derr = execFileSync('ffmpeg', ['-v', 'error', '-i', mFile, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); } catch (x) { derr = String(x.stderr || x); }
  const m = metrics(src, decode(mFile)), l = metrics(src, decode(lFile)); m.err = derr;
  rows.push({ kbps, m, l });
  console.log(`${kbps} kbps  MobileDAW: SNR ${m.snr.toFixed(1)} dB, NMR ${m.nmr.toFixed(1)} dB, band terdengar ${m.audible.toFixed(1)} %, lebar pita ${(m.bw / 1000).toFixed(1)} kHz  |  LAME: SNR ${l.snr.toFixed(1)} dB, NMR ${l.nmr.toFixed(1)} dB, band terdengar ${l.audible.toFixed(1)} %, lebar pita ${(l.bw / 1000).toFixed(1)} kHz`);
}
fs.rmSync(tmp, { recursive: true, force: true });
// pass: decodes without errors; from 192 kbps up the share of audible cells is at most LAME's + 1 point and the mean NMR at most 5 dB above
let bad = 0;
for (const { kbps, m, l } of rows) {
  const good = !m.err && (kbps < 192 || (m.audible <= l.audible + 1 && m.nmr <= l.nmr + 5));
  if (!good) bad++; console.log((good ? 'ok   ' : 'FAIL ') + kbps + ' kbps' + (m.err ? ' decode errors: ' + m.err.slice(0, 120) : ''));
}
console.log(bad ? 'mp3-quality-test: ' + bad + ' FAILED' : 'mp3-quality-test: all passed'); process.exit(bad ? 1 : 0);
if (process.env.MP3_JSON) fs.writeFileSync(process.env.MP3_JSON, JSON.stringify(rows, null, 1));
