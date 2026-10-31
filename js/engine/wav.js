// WAV encoding/decoding helpers (main thread).
import { Resampler } from './mp3.js';

// After the offline render (chunks L / R at the engine rate sr): mono fold, sample-rate conversion, normalisation. Returns { L, R, frames }
// (R === L for mono). mono: (L + R) / 2, so a full-scale stereo mix cannot clip. rate != sr: windowed-sinc resampling of the rendered audio
// (the engine always renders at the device rate: samples, instruments and effects are prepared for it). normalize: sample peak -> -0.1 dBFS.
// peak = the stereo peak already measured while rendering (re-measured whenever the audio was changed here).
export function finishRender(L, R, sr, { mono = false, rate = sr, normalize = false, peak = -1 } = {}) {
  if (mono) { const M = []; for (let k = 0; k < L.length; k++) { const a = L[k], b = R[k], m = new Float32Array(a.length); for (let i = 0; i < a.length; i++) m[i] = (a[i] + b[i]) * 0.5; M.push(m); } L = R = M; }
  if (rate > 0 && rate !== sr) { const ra = new Resampler(sr, rate, true), rb = mono ? null : new Resampler(sr, rate, true); const l2 = L.map((c) => ra.process(c)); R = mono ? l2 : R.map((c) => rb.process(c)); L = l2; }
  if (mono || (rate > 0 && rate !== sr) || peak < 0) { peak = 0; for (const set of mono ? [L] : [L, R]) for (const a of set) for (let i = 0; i < a.length; i++) { const v = a[i] < 0 ? -a[i] : a[i]; if (v > peak) peak = v; } }
  if (normalize && peak > 1e-5) { const g = 0.9886 / peak; for (const a of L) for (let i = 0; i < a.length; i++) a[i] *= g; if (!mono) for (const a of R) for (let i = 0; i < a.length; i++) a[i] *= g; }
  let frames = 0; for (const c of L) frames += c.length;
  return { L, R, frames, peak };
}
export function encodeWav(chunksL, chunksR, frames, sr, bits, channels = 2) {
  const bytes = bits === 16 ? 2 : bits === 24 ? 3 : 4, data = frames * channels * bytes, buf = new ArrayBuffer(44 + data), dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + data, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, bits === 32 ? 3 : 1, true); dv.setUint16(22, channels, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * channels * bytes, true); dv.setUint16(32, channels * bytes, true); dv.setUint16(34, bits, true); w(36, 'data'); dv.setUint32(40, data, true);
  let o = 44, seed = 0x2545f491;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) / 16777216 - 0.5; };
  for (let c = 0; c < chunksL.length; c++) {
    const L = chunksL[c], R = chunksR ? chunksR[c] : L;
    for (let i = 0; i < L.length; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const x = ch ? R[i] : L[i];
        if (bits === 16) { const v = Math.max(-32768, Math.min(32767, Math.round(x * 32767 + rnd() + rnd()))); dv.setInt16(o, v, true); o += 2; }   // TPDF dither
        else if (bits === 24) { const v = Math.max(-8388608, Math.min(8388607, Math.round(x * 8388607))); dv.setUint8(o, v & 255); dv.setUint8(o + 1, (v >> 8) & 255); dv.setUint8(o + 2, (v >> 16) & 255); o += 3; }
        else { dv.setFloat32(o, x, true); o += 4; }
      }
    }
  }
  return buf;
}
