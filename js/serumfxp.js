// Serum 1 presets (.fxp) and wavetables (.wav) for Moisture (instrument 37). Pure: bytes in, plain data out.
// .fxp = a VST2 program file (big-endian): "CcnK", u32 size, "FPCh" (opaque chunk) or "FxCk" (raw floats), u32 version, plug-in id
// ("XfsX" = Serum), u32 plug-in version, u32 programs, char name[28], then (FPCh) u32 chunk size + chunk. Serum's chunk is zlib data: the
// first stream holds the parameter block, 299 little-endian floats at 0x3460 = Serum's VST parameters 0..298, normalized, the order of
// js/serumparams.js; a second stream (when present) holds wavetable frames. Layout from the community notes ("Reverse Engineering Serum
// Preset Format", 0xdevalias / djOffstage): the parameter block is reliable, the modulation routings and the wavetable layout are not
// documented, so routes are not read; the wavetable stream holds oscillator A's frames then B's (split where the waveform jumps).
const BE = (u, p) => ((u[p] << 24) | (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3]) >>> 0;
const tag = (u, p) => String.fromCharCode(u[p], u[p + 1], u[p + 2], u[p + 3]);

async function inflate(u8) {   // one zlib stream; throws when the bytes are not exactly one stream
  const ds = new DecompressionStream('deflate'), out = new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(await out);
}
// the zlib streams of a chunk: the first is tried whole, else cut at every later zlib header (0x78 + a valid check byte)
async function streams(u8) {
  try { return [await inflate(u8)]; } catch (_) { /* more than one stream, or junk after it */ }
  for (let p = 2; p < u8.length - 2; p++) {
    if (u8[p] !== 0x78 || ((u8[p] << 8) | u8[p + 1]) % 31 !== 0) continue;
    let a; try { a = await inflate(u8.subarray(0, p)); } catch (_) { continue; }
    let b = null; for (let t = 0; t <= 16 && !b; t++) { try { b = await inflate(u8.subarray(p, u8.length - t)); } catch (_) { /* trailing bytes after the stream (seen: 4) */ } }
    return b ? [a, b] : [a];
  }
  throw new Error('Data preset Serum tidak bisa dibuka (zlib).');
}

export async function parseSerumFxp(buf) {
  const u = new Uint8Array(buf), notes = [];
  if (u.length < 60 || tag(u, 0) !== 'CcnK') throw new Error('Bukan file preset VST (.fxp).');
  const kind = tag(u, 8), plugin = tag(u, 16), name = new TextDecoder().decode(u.subarray(28, 56)).replace(/\0.*$/s, '').trim();
  if (plugin !== 'XfsX') notes.push('Preset ini untuk plug-in "' + plugin + '", bukan Serum (XfsX): nilainya tetap dicoba.');
  if (kind === 'FxCk') {   // raw parameter list (big-endian floats)
    const n = Math.min(299, BE(u, 24)), dv = new DataView(u.buffer, u.byteOffset), params = new Float32Array(299).fill(NaN);
    for (let k = 0; k < n && 56 + 4 * k + 4 <= u.length; k++) params[k] = dv.getFloat32(56 + 4 * k, false);
    return { name, plugin, params, tables: [null, null], notes };
  }
  if (kind !== 'FPCh') throw new Error('Jenis preset VST tidak dikenal: ' + kind);
  const size = BE(u, 56), chunk = u.subarray(60, Math.min(u.length, 60 + size));
  const [main, extra] = await streams(chunk);
  if (main.length < 0x3460 + 299 * 4) throw new Error('Blok parameter Serum terlalu pendek (' + main.length + ' byte).');
  const dv = new DataView(main.buffer, main.byteOffset, main.byteLength), params = new Float32Array(299);
  let odd = 0; for (let k = 0; k < 299; k++) { const v = dv.getFloat32(0x3460 + 4 * k, true); if (v >= -0.0001 && v <= 1.0001) params[k] = Math.min(1, Math.max(0, v)); else { params[k] = NaN; odd++; } }
  if (odd) notes.push(odd + ' parameter (indeks tinggi, mis. LFO 5-8 / FX Level) tidak ada di blok preset versi ini: memakai nilai awal.');
  const str = (a, n) => (main.length >= a + n ? new TextDecoder().decode(main.subarray(a, a + n)).replace(/\0.*$/s, '').trim() : '');
  const pn = str(0x4970, 32), wtName = [str(0x3c08, 512), str(0x3e08, 512)].map((x) => x.replace(/^.*\//, '').replace(/\.wav$/i, ''));
  // wavetables: the frames of oscillator A then of oscillator B (2048 floats each). The split is not stored as a number: it is where the
  // waveform jumps most between two neighbouring frames (seen: 1 + 1, 256 + 1, 256 + 87 in three factory-bank presets)
  let tables = [null, null];
  if (extra && extra.length >= 8192 && extra.length % 8192 === 0) {
    const all = new Float32Array(extra.buffer.slice(extra.byteOffset, extra.byteOffset + extra.length)), F = all.length / 2048;
    if (all.every((x) => Number.isFinite(x) && Math.abs(x) <= 8)) {
      let cut = F === 2 ? 1 : F;
      if (F > 2) { let best = 0, bi = -1; const jumps = []; for (let k = 1; k < F; k++) { let q = 0; for (let i = 0; i < 2048; i++) q += (all[k * 2048 + i] - all[(k - 1) * 2048 + i]) ** 2; q = Math.sqrt(q / 2048); jumps.push(q); if (q > best) { best = q; bi = k; } }
        const med = jumps.slice().sort((a, b) => a - b)[jumps.length >> 1] || 0; if (bi > 0 && best > Math.max(0.05, med * 8)) cut = bi; }
      tables = [all.slice(0, Math.min(cut, 256) * 2048), cut < F ? all.slice(cut * 2048, Math.min(F, cut + 256) * 2048) : null];
    } else notes.push('Data wavetable tidak terbaca: osilator memakai wavetable bawaan Moisture.');
  } else if (extra) notes.push('Data wavetable (' + extra.length + ' byte) tata letaknya belum dikenal: osilator memakai wavetable bawaan Moisture.');
  return { name: pn && /^[\x20-\x7e]+$/.test(pn) ? pn : name, plugin, params, tables, wtName, notes };
}

// a wavetable WAV read as stored (no resampling: frames are 2048 points): PCM 8 / 16 / 24 / 32 bit or float, first channel; the frame size
// from a Serum "clm " chunk ("<!>2048 ...") when there is one, else 2048
export function parseWavetable(buf) {
  const u = new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (u.length < 44 || tag(u, 0) !== 'RIFF' || tag(u, 8) !== 'WAVE') throw new Error('Bukan file WAV.');
  let p = 12, fmt = null, data = null, frame = 2048;
  while (p + 8 <= u.length) { const id = tag(u, p), n = dv.getUint32(p + 4, true), a = p + 8;
    if (id === 'fmt ') fmt = { code: dv.getUint16(a, true), ch: dv.getUint16(a + 2, true), bits: dv.getUint16(a + 14, true) };
    else if (id === 'data') data = [a, Math.min(n, u.length - a)];
    else if (id === 'clm ') { const m = /<!>(\d+)/.exec(new TextDecoder().decode(u.subarray(a, a + Math.min(n, 64)))); if (m && +m[1] >= 256) frame = +m[1]; }
    p = a + n + (n & 1); }
  if (!fmt || !data) throw new Error('WAV tanpa fmt / data.');
  const bps = fmt.bits >> 3, step = bps * fmt.ch, n = Math.floor(data[1] / step), out = new Float32Array(n), isF = fmt.code === 3;
  for (let i = 0; i < n; i++) { const q = data[0] + i * step;
    out[i] = isF ? dv.getFloat32(q, true) : bps === 2 ? dv.getInt16(q, true) / 32768 : bps === 3 ? ((dv.getUint8(q) | (dv.getUint8(q + 1) << 8) | (dv.getInt8(q + 2) << 16)) / 8388608) : bps === 4 ? dv.getInt32(q, true) / 2147483648 : (dv.getUint8(q) - 128) / 128; }
  return { frame, data: out };
}
// any frame size -> frames of 2048 points (linear resampling of each cycle), at most 256 frames
export function toFrames2048(t) {
  const F = Math.max(1, Math.min(256, Math.floor(t.data.length / t.frame))), out = new Float32Array(F * 2048);
  for (let f = 0; f < F; f++) for (let i = 0; i < 2048; i++) { const x = i * t.frame / 2048, j = Math.floor(x), fr = x - j, a = t.data[f * t.frame + j] || 0, b = t.data[f * t.frame + ((j + 1) % t.frame)] || 0; out[f * 2048 + i] = a + (b - a) * fr; }
  return out;
}
