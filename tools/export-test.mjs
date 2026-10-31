// Offline render post-processing and WAV encoding (js/engine/wav.js): mono fold, sample-rate conversion, normalisation, WAV headers / bit depths,
// and the PDC pre-roll the export drops (an impulse at the song start lands on frame 0 of the file, with or without latent devices).
// Usage: node tools/export-test.mjs     (part of tools/run-tests.mjs)
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { finishRender, encodeWav } = await import(path.join(root, 'js/engine/wav.js'));
const { Engine, PPQ } = await import(path.join(root, 'js/engine/core.js'));
let bad = 0; const ok = (c, msg) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const SR = 48000;
const sine = (hz, n, amp, sr = SR, ph = 0) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / sr + ph));
const chunks = (a, k = 4096) => { const r = []; for (let o = 0; o < a.length; o += k) r.push(a.slice(o, o + k)); return r; };
const flat = (c) => { const n = c.reduce((s, x) => s + x.length, 0), o = new Float32Array(n); let k = 0; for (const x of c) { o.set(x, k); k += x.length; } return o; };
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const freq = (a, sr) => { let z = 0; for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 && a[i] >= 0) z++; return z * sr / a.length; };

// mono fold
{ const L = chunks(sine(440, SR, 0.8)), R = chunks(sine(440, SR, 0.4)), r = finishRender(L, R, SR, { mono: true }), m = flat(r.L);
  ok(r.L === r.R && Math.abs(peak(m) - 0.6) < 1e-3, `mono = (L + R) / 2: peak ${peak(m).toFixed(4)} (0.6 expected), one channel`);
  const a = finishRender(chunks(sine(440, SR, 1)), chunks(sine(440, SR, -1)), SR, { mono: true }); ok(peak(flat(a.L)) < 1e-6, 'mono: opposite-phase channels cancel (mono compatibility check shows up as silence)'); }
// sample-rate conversion
for (const to of [44100, 96000, 88200]) {
  const r = finishRender(chunks(sine(1000, SR * 2, 0.5)), chunks(sine(1000, SR * 2, 0.5)), SR, { rate: to }), l = flat(r.L), mid = l.subarray(2000, l.length - 2000);
  const lenOk = Math.abs(r.frames - SR * 2 * to / SR) < 160, f = freq(mid, to), pk = peak(mid);
  ok(lenOk && Math.abs(f - 1000) < 2 && Math.abs(20 * Math.log10(pk / 0.5)) < 0.2, `48 kHz -> ${to}: ${r.frames} frames, 1 kHz stays ${f.toFixed(1)} Hz, level ${(20 * Math.log10(pk / 0.5)).toFixed(3)} dB`);
}
{ const r = finishRender(chunks(sine(23000, SR, 0.5)), chunks(sine(23000, SR, 0.5)), SR, { rate: 44100 }), l = flat(r.L).subarray(2000, 40000);
  ok(peak(l) < 0.5 * 0.01, `48 -> 44.1 kHz: a 23 kHz tone (above the new Nyquist, 22.05 kHz) is filtered instead of folding back to 21.1 kHz (peak ${peak(l).toFixed(4)})`); }
{ const r = finishRender(chunks(sine(18000, SR, 0.5)), chunks(sine(18000, SR, 0.5)), SR, { rate: 44100 }), db = 20 * Math.log10(peak(flat(r.L).subarray(2000, 40000)) / 0.5);
  ok(Math.abs(db) < 0.5, `48 -> 44.1 kHz: pass band flat at 18 kHz (${db.toFixed(2)} dB)`); }
// normalisation
{ const r = finishRender(chunks(sine(220, SR, 0.25)), chunks(sine(220, SR, 0.1)), SR, { normalize: true });
  ok(Math.abs(peak(flat(r.L)) - 0.9886) < 1e-4 && Math.abs(peak(flat(r.R)) - 0.9886 * 0.4) < 1e-4, `normalise: peak -> ${(20 * Math.log10(peak(flat(r.L)))).toFixed(2)} dBFS, channel balance kept`); }
// WAV headers and sample formats
for (const [bits, ch, rate] of [[16, 2, 48000], [24, 1, 44100], [32, 2, 96000]]) {
  const x = sine(100, 1000, 0.5), buf = encodeWav([x], ch === 1 ? null : [x], 1000, rate, bits, ch), dv = new DataView(buf);
  const fmt = dv.getUint16(20, true), nch = dv.getUint16(22, true), sr = dv.getUint32(24, true), bps = dv.getUint16(34, true), data = dv.getUint32(40, true);
  const s10 = bits === 16 ? dv.getInt16(44 + 10 * ch * 2, true) / 32767 : bits === 24 ? ((dv.getUint8(44 + 30 * ch) | (dv.getUint8(45 + 30 * ch) << 8) | (dv.getInt8(46 + 30 * ch) << 16)) / 8388607) : dv.getFloat32(44 + 40 * ch, true);
  ok(fmt === (bits === 32 ? 3 : 1) && nch === ch && sr === rate && bps === bits && data === 1000 * ch * bits / 8 && Math.abs(s10 - x[10]) < (bits === 16 ? 1e-4 : 1e-6),
    `WAV ${bits}-bit ${ch === 1 ? 'mono' : 'stereo'} ${rate} Hz: header (format ${fmt}, ${nch} ch, ${sr} Hz, ${bps} bit, ${data} bytes) and sample values`);
}
// PDC pre-roll as the export does it: render pdcLatency() frames and drop them, then frame 0 = song start
for (const latent of [false, true]) {
  const e = new Engine(SR), imp = new Float32Array(SR); imp[2000] = 0.25; e.loadSample(0, imp, imp); e.tempo(120);
  e.trackClips(0, [0, PPQ * 4, 0, 1, 0, 0, 0], 1); e.trackClips(1, [0, PPQ * 4, 0, 1, 0, 0, 0], 1);
  if (latent) { e.insertDevice(0, 0, 5); e.insertDevice(64, 0, 3); e.devParam(64, 0, 1, 0); }
  e.seek(0); e.play(); let k = e.pdcLatency(); const t = new Float32Array(4096), u = new Float32Array(4096); while (k > 0) { const n = Math.min(4096, k); e.render(t, u, n); k -= n; }
  const L = new Float32Array(8192), R = new Float32Array(8192); for (let i = 0; i < 8192; i += 128) e.render(L.subarray(i, i + 128), R.subarray(i, i + 128), 128);
  let at = -1, pk = 0; for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) > pk) { pk = Math.abs(L[i]); at = i; }
  ok(at === 2000, `export pre-roll ${latent ? 'with Limiter + master Saturator + output limiter' : 'without latent devices'}: the impulse at song frame 2000 is at file frame ${at}`);
}
console.log(bad ? `\n${bad} FAILED` : '\nALL OK');
process.exit(bad ? 1 : 0);
