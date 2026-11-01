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
// MP3 stream structure (js/engine/mp3.js): frame sync / size per bitrate, bit reservoir pointers inside the bytes the previous frames left free,
// granule lengths inside the main data area, scalefactors in use, exact CBR bitrate. (Sound quality vs LAME: tools/mp3-quality-test.mjs, needs ffmpeg.)
{
  const { Mp3Encoder, MP3_BITRATES } = await import(path.join(root, 'js/engine/mp3.js'));
  const sr = 44100, n = sr * 4, L = new Float32Array(n), R = new Float32Array(n); let seed = 3;
  for (let i = 0; i < n; i++) { const t = i / sr, env = (t % 0.5) < 0.02 ? 1 : 0.05, nz = ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5); L[i] = 0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.1 * Math.sin(2 * Math.PI * 3300 * t) + nz * env; R[i] = L[i] * 0.8 + 0.05 * Math.sin(2 * Math.PI * 523 * t); }
  for (const kbps of [128, 320]) {
    const e = new Mp3Encoder(sr, 2, kbps), parts = []; for (let o = 0; o < n; o += 4096) for (const f of e.encode(L.subarray(o, o + 4096), R.subarray(o, o + 4096), Math.min(4096, n - o))) parts.push(f); for (const f of e.finish()) parts.push(f);
    const b = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let k = 0; for (const p of parts) { b.set(p, k); k += p.length; }
    let pos = 0, frames = 0, okSync = true, okRes = true, okLen = true, free = 0, usedRes = 0, sfUsed = 0;
    while (pos + 4 <= b.length) {
      const h = (b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3];
      if (((h >>> 21) & 0x7ff) !== 0x7ff || MP3_BITRATES[((h >>> 12) & 15) - 1] !== kbps) { okSync = false; break; }
      const size = Math.floor(144000 * kbps / sr) + ((h >>> 9) & 1), side = 32, slots = size - 4 - side;
      let bp = (pos + 4) * 8; const rd = (m) => { let v = 0; for (let q = 0; q < m; q++, bp++) v = (v << 1) | ((b[bp >> 3] >> (7 - (bp & 7))) & 1); return v; };
      const mdb = rd(9); rd(3); rd(8); let p23 = 0;
      for (let g = 0; g < 4; g++) { p23 += rd(12); rd(9); rd(8); const sfc = rd(4); if (sfc) sfUsed++; rd(1); rd(15); rd(4); rd(3); rd(3); }
      if (mdb > Math.min(511, free)) okRes = false;                                 // points only into bytes earlier frames left free
      if (p23 > (mdb + slots) * 8) okLen = false;                                   // this frame's data fits between the pointer and its own end
      if (mdb) usedRes++;
      free = Math.min(511, mdb + slots - Math.ceil(p23 / 8)); if (free < 0) okLen = false;
      pos += size; frames++;
    }
    const secs = frames * 1152 / sr, rate = b.length * 8 / secs / 1000;
    ok(okSync && pos === b.length && frames > 100, `MP3 ${kbps} kbps: ${frames} frames, every header in sync, stream ends on a frame boundary`);
    ok(okRes && okLen && usedRes > 0, `MP3 ${kbps} kbps: bit reservoir valid (main_data_begin inside the free bytes of earlier frames, used by ${usedRes} frames; granules fit)`);
    ok(sfUsed > 0 && Math.abs(rate - kbps) < 0.5, `MP3 ${kbps} kbps: scalefactors in use (${sfUsed} granules), bitrate ${rate.toFixed(2)} kbps`);
  }
}
console.log(bad ? `\n${bad} FAILED` : '\nALL OK');
process.exit(bad ? 1 : 0);
