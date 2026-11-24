// DirectWave programs (.dwp) for the DirectWave instrument (30). Pure: bytes in, zones out. The layout is Honeydew's reader
// (crates/audio/src/dwp.rs, GPL-3.0, THIRD_PARTY_NOTICES.md): "DwPr", u32 version (37 / 38 known), then records `u32 tag, u64 len, data`
// (a length past the end is cut to what is there). Tag 1 = the program: its tag-3 records are the zones, up to its tag 2.
// A zone's records: 0x1F4 root / key range / velocity range (u8 @0..4), gain f32 @9, pan f32 @13, u32 @21 / 2 = lead-in frames of the
// embedded audio; 0x1F6 the sample's path (only the file name counts); 0x1F7 the audio's shape: u64 frames, u32 channels (1-2) @8,
// f32 rate @16, i32 loop mode @20 (> 1 = loops), u32 loop start @24, end @28; 0x1FD four floats (#1 attack, #4 release, normalized);
// 0x205 embedded interleaved PCM (16-bit LE below 4 bytes a sample, else f32); 0x206 an embedded FLAC stream (with or without a
// leading u64). Embedded audio wins over the file; a zone with neither (or a bad 0x1F7) is left out. Input is hostile: every
// length is checked, nothing throws but a "not a program".
const u32 = (dv, a, n) => (a + 4 <= n ? dv.getUint32(a, true) : null);
const f32 = (dv, a, n) => { if (a + 4 > n) return null; const v = dv.getFloat32(a, true); return Number.isFinite(v) ? v : null; };
const u64 = (dv, a, n) => (a + 8 <= n ? dv.getUint32(a, true) + dv.getUint32(a + 4, true) * 4294967296 : null);

function* records(u8, from, to) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = from;
  while (p + 12 <= to) {
    const tag = dv.getUint32(p, true), len = u64(dv, p + 4, to), a = p + 12, b = Math.min(to, a + Math.min(len, to - a));
    yield [tag, a, b];
    p = b;
  }
}

export const MAX_FRAMES = 30 * 60 * 192000;   // embedded audio longer than this is not decoded

export function parseDwp(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), n = u8.length, dv = new DataView(u8.buffer, u8.byteOffset, n);
  if (n < 8 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'DwPr') throw new Error('Bukan program DirectWave (.dwp).');
  const version = dv.getUint32(4, true), zones = [];
  let prog = null;
  for (const r of records(u8, 8, n)) if (r[0] === 1) { prog = r; break; }
  if (prog) for (const [tag, a, b] of records(u8, prog[1], prog[2])) { if (tag === 2) break; if (tag === 3) { const z = zone(u8, dv, a, b); if (z) zones.push(z); } }
  return { version, zones };
}

function zone(u8, dv0, a, b) {
  const z = { root: 48, lo: 0, hi: 128, vlo: 0, vhi: 127, gain: 1, pan: 0, loopMode: 0, loopStart: 0, loopEnd: 0, floats: [0, 1, 1, 0.1], file: null, audio: null, format: null, leadIn: 0 };
  for (const [tag, s, e] of records(u8, a, b)) {
    const dv = new DataView(u8.buffer, u8.byteOffset + s, e - s), m = e - s;
    if (tag === 0x1f4) {
      ['root', 'lo', 'hi', 'vlo', 'vhi'].forEach((k, i) => { if (i < m) z[k] = u8[s + i]; });
      z.gain = f32(dv, 9, m) ?? z.gain; z.pan = f32(dv, 13, m) ?? z.pan; z.leadIn = Math.floor((u32(dv, 21, m) || 0) / 2);
    } else if (tag === 0x1f6) {
      let q = s; while (q < e && u8[q] !== 0) q++;
      const path = new TextDecoder('utf-8').decode(u8.subarray(s, q)), name = path.split(/[\\/]/).pop();
      z.file = name && name !== '.' && name !== '..' ? name : null;
    } else if (tag === 0x1f7) {
      const f = { frames: u64(dv, 0, m) || 0, channels: u32(dv, 8, m) || 0, rate: f32(dv, 16, m) || 0 };
      if (!(f.frames >= 1 && f.frames <= 4294967295) || !(f.channels >= 1 && f.channels <= 2)) return null;
      z.format = f; z.loopMode = m >= 24 ? dv.getInt32(20, true) : 0; z.loopStart = u32(dv, 24, m) || 0; z.loopEnd = u32(dv, 28, m) || 0;
    } else if (tag === 0x1fd) { for (let i = 0; i < 4; i++) z.floats[i] = f32(dv, 4 * i, m) ?? z.floats[i]; }
    else if (tag === 0x205) z.audio = { kind: 'pcm', s, e };
    else if (tag === 0x206) z.audio = { kind: 'flac', s, e };
  }
  if (!z.file && !z.audio) return null;
  if (z.audio) z.audio = embedded(u8, z);
  return z.file || z.audio ? z : null;
}

// the embedded audio as data: PCM decoded here ({ kind: 'pcm', l, r, rate }), FLAC kept as its bytes ({ kind: 'flac', bytes }; the
// browser decodes it). null when it cannot play.
function embedded(u8, z) {
  const { kind, s, e } = z.audio, f = z.format;
  if (kind === 'flac') {
    let a = s; if (!(u8[a] === 0x66 && u8[a + 1] === 0x4c && u8[a + 2] === 0x61 && u8[a + 3] === 0x43)) a += 8;   // "fLaC" or a leading u64
    return a + 4 <= e && u8[a] === 0x66 && u8[a + 1] === 0x4c ? { kind, bytes: u8.slice(a, e) } : null;
  }
  if (!f) return null;
  const ch = f.channels, len = e - s, wide = Math.floor(len / (f.frames * ch)) >= 4, w = wide ? 4 : 2, rate = Math.round(f.rate);
  if (!(rate >= 1 && rate <= 4294967295)) return null;
  const total = Math.floor(len / (w * ch)), start = Math.min(z.leadIn, total), frames = Math.min(total - start, f.frames);
  if (frames < 1 || frames > MAX_FRAMES) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset + s, len), l = new Float32Array(frames), r = ch === 2 ? new Float32Array(frames) : l;
  for (let i = 0; i < frames; i++) {
    const q = (start + i) * w * ch;
    for (let c = 0; c < ch; c++) {
      let v = wide ? dv.getFloat32(q + c * w, true) : dv.getInt16(q + c * w, true) / 32768;
      if (!Number.isFinite(v)) v = 0; else if (wide) v = Math.max(-1, Math.min(1, v));
      (c ? r : l)[i] = v;
    }
  }
  return { kind, l, r, rate };
}

// a DirectWave zone as MobileDAW keeps it (js/project.js newZone): keys 0..127, velocities 1..127, level in dB (the zone gain), pan -1..1,
// loop when the program's loop mode is > 1 (the engine loops the whole sample: the loop points are not used)
export function toMdawZone(z) {
  const k = (v) => Math.max(0, Math.min(127, v | 0)), vel = (v) => Math.max(1, Math.min(127, v | 0));
  const db = z.gain > 0 ? Math.max(-60, Math.min(12, Math.round(20 * Math.log10(z.gain) * 10) / 10)) : -60;
  return { root: k(z.root), lo: k(Math.min(z.lo, z.hi)), hi: k(Math.max(z.lo, z.hi)), vlo: vel(Math.min(z.vlo, z.vhi)), vhi: vel(Math.max(z.vlo, z.vhi)), tune: 0,
    loop: z.loopMode > 1, vol: db, pan: Math.max(-1, Math.min(1, z.pan || 0)) };
}
// the attack / release (seconds, DirectWave's amp law 0.001 + 10 v^4) a program sets: its last zone's floats #1 and #4
export function dwpAttackRelease(zones) {
  const z = zones[zones.length - 1]; if (!z) return null;
  const amp = (x) => Math.round((0.001 + 10 * Math.pow(Math.max(0, Math.min(1, x)), 4)) * 1e6) / 1e6;
  return { attack: z.floats[0] <= 0 ? 0.001 : amp(z.floats[0]), release: amp(z.floats[3]) };
}
