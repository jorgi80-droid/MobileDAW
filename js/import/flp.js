// FL Studio desktop project (.flp) -> neutral import model. EXPERIMENTAL: the event layout follows the community documentation of the format
// (PyFLP); it is tested on generated files, not yet on real projects from every FL version.
//   header "FLhd" (u32 6, u16 format, u16 channels, u16 PPQ) + "FLdt" (u32 size) + events. Event id < 64: 1 byte, < 128: u16, < 192: u32,
//   else varint length + data. Used: 156 tempo (x1000), 17/18 time signature, 194 title, 64 new channel, 21 channel type, 196 sample path,
//   201 plugin internal name, 203 plugin / channel name, 65 new pattern, 224 notes (24 bytes each), 233 playlist items (32 bytes each),
//   98 mixer slot index (closes a slot: the plugin events just before it belong to that slot), 236 mixer insert flags (one per insert).
export const isFlp = (u) => u.length > 22 && u[0] === 0x46 && u[1] === 0x4c && u[2] === 0x68 && u[3] === 0x64;   // "FLhd"

export function parseFlp(u8) {
  const u = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (!isFlp(u)) throw new Error('Bukan file FL Studio (.flp).');
  const PPQ = dv.getUint16(12, true) || 96;
  let p = 8 + dv.getUint32(4, true);
  if (String.fromCharCode(...u.subarray(p, p + 4)) !== 'FLdt') throw new Error('File .flp rusak (tidak ada blok data).');
  const end = Math.min(u.length, p + 8 + dv.getUint32(p + 4, true)); p += 8;
  const text = (b) => {                                         // FL 11.5+ writes UTF-16LE, older versions ASCII
    if (b.length >= 2 && b[1] === 0 && b.length % 2 === 0) { let s = ''; for (let k = 0; k + 1 < b.length; k += 2) { const c = b[k] | (b[k + 1] << 8); if (!c) break; s += String.fromCharCode(c); } return s; }
    let e = 0; while (e < b.length && b[e]) e++; return new TextDecoder().decode(b.subarray(0, e));
  };
  const M = { app: 'FL Studio', name: '', bpm: 140, sig: [4, 4], channels: [], warnings: ['Impor .flp masih eksperimental: periksa hasilnya.'] };
  const chans = new Map(), patterns = new Map(), items = [], inserts = []; let ch = null, pat = null, slotPlug = null, ins = -1, mixerSeen = false;
  while (p < end) {
    const id = u[p++]; let v = 0, data = null;
    if (id < 64) v = u[p++];
    else if (id < 128) { v = dv.getUint16(p, true); p += 2; }
    else if (id < 192) { v = dv.getUint32(p, true); p += 4; }
    else { let n = 0, sh = 0, b; do { b = u[p++]; n |= (b & 127) << sh; sh += 7; } while (b & 128 && sh < 35); data = u.subarray(p, p + n); p += n; }
    switch (id) {
      case 156: M.bpm = v / 1000; break;
      case 66: if (!M._fine) M.bpm = v; break;                  // old integer tempo
      case 17: M.sig[0] = v || 4; break;
      case 18: M.sig[1] = v || 4; break;
      case 194: M.name = text(data); break;
      case 64: ch = { iid: v, name: '', type: 0, plugin: '', sample: '' }; chans.set(v, ch); slotPlug = null; break;
      case 21: if (ch) ch.type = v; break;
      case 196: if (ch) ch.sample = text(data); break;
      case 201: { const nm = text(data); if (mixerSeen) slotPlug = { internal: nm, name: '' }; else if (ch) ch.plugin = nm; break; }
      case 203: { const nm = text(data); if (mixerSeen && slotPlug) slotPlug.name = nm; else if (ch) ch.name = nm; break; }
      case 65: pat = { idx: v, notes: [] }; patterns.set(v, pat); break;
      case 224: if (pat && data) for (let k = 0; k + 24 <= data.length; k += 24) {
        const o = data.byteOffset - u.byteOffset + k;            // offset inside u / dv
        pat.notes.push({ pos: dv.getUint32(o, true), chan: dv.getUint16(o + 6, true), len: dv.getUint32(o + 8, true), key: dv.getUint16(o + 12, true) & 255, pan: u[o + 20], vel: u[o + 21] });
      } break;
      case 233: if (data) for (let k = 0; k + 32 <= data.length; k += 32) {
        const o = data.byteOffset - u.byteOffset + k;
        items.push({ pos: dv.getUint32(o, true), base: dv.getUint16(o + 4, true), idx: dv.getUint16(o + 6, true), len: dv.getUint32(o + 8, true), track: dv.getUint16(o + 12, true), flags: dv.getUint16(o + 18, true), startOff: dv.getFloat32(o + 24, true) });
      } break;
      case 236: mixerSeen = true; ins++; inserts[ins] = inserts[ins] || { slots: [] }; break;
      case 98: if (mixerSeen && slotPlug && ins >= 0) { inserts[ins].slots.push(slotPlug); slotPlug = null; } break;
      case 204: if (ins >= 0 && inserts[ins]) inserts[ins].name = text(data); break;
      default: break;
    }
  }
  // channels -> tracks (one per channel that has notes / clips); playlist items place patterns (per channel) and audio clips
  const beat = (t) => t / PPQ;
  const out = new Map();
  const chanModel = (c) => {
    if (!out.has(c.iid)) {
      const isSampler = !c.plugin || /sampler|audio clip/i.test(c.plugin), hasSample = !!c.sample;
      const m = { kind: 'track', name: c.name || c.plugin || (c.sample ? c.sample.split(/[\\/]/).pop().replace(/\.\w+$/, '') : 'Channel ' + c.iid), gain: 1, pan: 0, modules: [], pads: [], tracks: [] };
      if (c.type === 4 || /audio clip/i.test(c.plugin)) m._audio = true;
      else m.instrument = { kind: isSampler && hasSample ? 'directwave' : 'unknown', name: isSampler ? 'Sampler' : c.plugin, sample: isSampler ? c.sample : '', library: isSampler ? '' : c.plugin };
      out.set(c.iid, m);
    }
    return out.get(c.iid);
  };
  for (const it of items) {
    if (it.base && it.idx >= it.base) {                         // pattern item: one clip per channel that has notes in that pattern
      const pt = patterns.get(it.idx - it.base); if (!pt) continue;
      const byChan = new Map(); for (const n of pt.notes) { if (!byChan.has(n.chan)) byChan.set(n.chan, []); byChan.get(n.chan).push(n); }
      for (const [ci, ns] of byChan) {
        const c = chans.get(ci) || [...chans.values()][ci]; if (!c) continue;
        const m = chanModel(c); let tr = m.tracks[0]; if (!tr) m.tracks.push(tr = { kind: 'notes', clips: [] });
        const plen = Math.max(...ns.map((n) => n.pos + n.len), PPQ * 4);
        tr.clips.push({ pos: beat(it.pos), len: beat(it.len || plen), cycle: beat(Math.ceil(plen / (PPQ * 4)) * PPQ * 4), offset: Number.isFinite(it.startOff) && it.startOff > 0 ? beat(it.startOff) : 0, muted: !!(it.flags & 0x2000),
          notes: ns.map((n) => ({ t: beat(n.pos), len: Math.max(1 / 64, beat(n.len || PPQ / 4)), pitch: n.key, vel: Math.min(1, (n.vel || 100) / 128), pan: ((n.pan ?? 64) - 64) / 64 })) });
      }
    } else {                                                    // channel item (audio clip channel)
      const c = chans.get(it.idx); if (!c) continue;
      const m = chanModel(c); m._audio = true; let tr = m.tracks.find((x) => x.kind === 'audio'); if (!tr) m.tracks.push(tr = { kind: 'audio', clips: [] });
      tr.clips.push({ pos: beat(it.pos), len: beat(it.len), cycle: 0, offset: Number.isFinite(it.startOff) && it.startOff > 0 ? beat(it.startOff) : 0, sample: c.sample, name: c.name, stretch: 1, gain: 1, muted: !!(it.flags & 0x2000) });
    }
  }
  for (const m of out.values()) { if (m._audio) delete m.instrument; delete m._audio; }
  const ins0 = inserts[0];
  M.channels.push({ kind: 'master', name: 'Master', gain: 1, pan: 0, modules: ins0 ? ins0.slots.map((s) => ({ name: s.name || s.internal, enabled: true, preset: '', params: [], app: 'FL Studio' })) : [], pads: [], tracks: [] });
  inserts.slice(1).forEach((x, k) => { if (x && x.slots.length) M.channels.push({ kind: 'bus', name: x.name || 'Insert ' + (k + 1), gain: 1, pan: 0, modules: x.slots.map((s) => ({ name: s.name || s.internal, enabled: true, preset: '', params: [], app: 'FL Studio' })), pads: [], tracks: [] }); });
  if (inserts.length > 1) M.warnings.push('Routing channel -> insert mixer FL Studio belum dikonversi: efek insert ditaruh di track Return bernama sama.');
  M.channels.push(...out.values());
  if (!out.size) M.warnings.push('Tidak ada klip di playlist yang bisa dibaca.');
  return M;
}
