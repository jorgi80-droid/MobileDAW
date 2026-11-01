// FL Studio Mobile project (.flm) reader -> import model (js/import/model.js). Pure: bytes in, plain objects out (no DOM, no engine).
// The format is undocumented; this layout was worked out from real projects (FL Studio Mobile 4.x):
//   file   = "10LF" + chunks; chunk = tag(4 ASCII) + u32 LE size + data. Containers start with a 0/4/8-byte prefix, then chunks.
//   HEAD   project: u32 0, u32 version, name[256], ..., f64 tempo at +0x108;   TDIV: u8 numerator, u8 denominator
//   RACK x N / CHNL x N (same order) = the channels. CHNL prefix u32 kind (0 master, 0x80 effect bus, 0x100 track).
//     CHHD: name[1024], ..., f32 order key (+0x408), f32 colour hue (+0x40c), GUID, u32 number (+0x438)
//     TRKH (one per sub-track): DESc = i32 kind (0 notes, 1 automation, 2 audio, 3 drums), i32 module id, i32 param, ..., name[...] (+0x1c)
//       CLIP = u32 position (128 ticks / beat) + "20LC" + CLHd (f64 length, f64 loop/cycle length, f64 offset, i32 id, f64 source length, u8 flags)
//              EVN2 = u16 record size (20) + records: u32 time (128/beat), f64 length (beats), u16 pitch, u16 pan, u16 velocity, u16 flags
//              CLSm (audio) = PTH1 (u16 len + "@L@\0" + path relative to the FLM user folder), STRC (u8, f64 stretch ratio, ...), PRMS (f32 gain, pan, ...)
//     RACK: RPRM (f32 volume, f32 pan 0..1, ...), RMOd modules in signal order (prefix i32 type, u32 instance id; HEAD, DESC names, PRST preset
//           path, PRMS f32 params with [0] = enabled, CSTM: ZONE / PATh = DirectWave sample), RSMP = Drums sampler: SMPl per pad (PTH1, PRMS)
import { FLM_TYPES } from './fxmap.js';
const TD = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
const isTag = (u, p) => { for (let k = 0; k < 4; k++) { const c = u[p + k]; if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95)) return false; } return true; };

export function isFlm(u8) { return u8.length > 12 && u8[0] === 0x31 && u8[1] === 0x30 && u8[2] === 0x4c && u8[3] === 0x46; }   // "10LF"

// FLM module type ids. Names proven by evidence inside real projects (preset folders, automation labels); every other type is named from the
// preset path of the same type in the file when there is one, else reported as "Efek FLM #id" (never a guessed name).
const KNOWN = Object.fromEntries(Object.entries(FLM_TYPES).map(([k, v]) => [k, v.name]));

export function parseFlm(buf, onProgress) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (!isFlm(u)) throw new Error('Bukan file FL Studio Mobile (.flm).');
  const str = (a, n) => { let e = a; const m = Math.min(u.length, a + n); while (e < m && u[e]) e++; return TD ? TD.decode(u.subarray(a, e)) : String.fromCharCode(...u.subarray(a, e)); };
  const list = (a, b) => {                                   // chunk list filling [a, b) exactly, or null
    const out = []; let p = a;
    while (p + 8 <= b) { if (!isTag(u, p)) return null; const n = dv.getUint32(p + 4, true); if (p + 8 + n > b) return null; out.push({ tag: str(p, 4), a: p + 8, n }); p += 8 + n; }
    return p === b ? out : null;
  };
  const kids = (c) => { for (const off of [0, 8, 4, 12, 16]) if (c.n - off >= 8) { const l = list(c.a + off, c.a + c.n); if (l) return l; } return []; };
  const one = (cs, tag) => cs.find((x) => x.tag === tag);
  const f32 = (p) => dv.getFloat32(p, true), f64 = (p) => dv.getFloat64(p, true), i32 = (p) => dv.getInt32(p, true), u32 = (p) => dv.getUint32(p, true), u16 = (p) => dv.getUint16(p, true);
  const raw = (a, n) => { const b = u.subarray(a, Math.min(u.length, a + n)); return TD ? TD.decode(b) : String.fromCharCode(...b); };
  const clean = (s) => s.replace(/^\0+/, '').replace(/^@[LR]@\0?/, '').split('\0').filter(Boolean)[0] || '';          // "@L@\0My Samples/x.wav" -> "My Samples/x.wav"
  const path1 = (c) => (c ? clean(raw(c.a + 2, Math.min(c.n - 2, u16(c.a)))) : '');
  const top = list(4, u.length);
  if (!top) throw new Error('Struktur file .flm tidak dikenali (versi baru?).');

  const P = { app: 'FL Studio Mobile', name: '', bpm: 120, sig: [4, 4], channels: [], warnings: [] };
  const head = one(top, 'HEAD');
  if (head) { P.version = i32(head.a + 4); P.name = str(head.a + 8, 256); if (head.n >= 0x110) { const b = f64(head.a + 0x108); if (b >= 20 && b <= 999) P.bpm = b; } P.appVersion = str(head.a + head.n - 5, 5); }
  const td = one(top, 'TDIV'); if (td && td.n >= 2 && u[td.a] > 0 && u[td.a + 1] > 0) P.sig = [u[td.a], u[td.a + 1]];
  const racks = top.filter((x) => x.tag === 'RACK'), chans = top.filter((x) => x.tag === 'CHNL');
  const presetName = {};                                     // type -> plugin name learned from preset folders in this file

  const readRack = (r) => {
    const ks = kids(r), out = { vol: 0.853, pan: 0.5, modules: [], pads: [] };
    const rp = one(ks, 'RPRM'); if (rp && rp.n >= 8) { out.vol = f32(rp.a); out.pan = f32(rp.a + 4); }
    for (const m of ks.filter((x) => x.tag === 'RMOd')) {
      const mk = kids(m), type = i32(m.a), id = u32(m.a + 4);
      const prst = one(mk, 'PRST'), prms = one(mk, 'PRMS'), desc = one(mk, 'DESC'), cstm = one(mk, 'CSTM');
      const pr = prst && prst.n > 8 ? str(prst.a + 4, Math.min(prst.n - 4, u32(prst.a))) : '';
      const params = []; if (prms) for (let k = 0; k + 4 <= prms.n; k += 4) params.push(f32(prms.a + k));
      const names = desc ? [str(desc.a, 256), str(desc.a + 0x100, 256)].filter(Boolean) : [];
      const folder = /Effect Presets\/([^/]+)\//.exec(pr); if (folder && !KNOWN[type]) presetName[type] = folder[1].replace(/\d+$/, '');
      const mod = { type, id, params, enabled: !(params.length && params[0] < 0.5), preset: pr.replace(/^.*\//, '').replace(/\.(flmpst|dwp)$/i, ''), presetPath: pr, names };
      if (cstm) for (const z of kids(cstm)) {                 // DirectWave: the sample of its zone (user folder) or a library program (built-in content)
        if (z.tag === 'ZONE') { mod.sample = clean(raw(z.a, Math.min(z.n, 1024))); if (z.n > 1028) mod.root = u[z.a + 1024]; }   // path[1024], then the zone's root key (MIDI)
        if (z.tag === 'PATh') mod.library = clean(raw(z.a + 4, Math.min(z.n - 4, u32(z.a))));
      }
      if (type === 1 && !mod.sample && !mod.library && names.length > 1 && /\.(wav|mp3|ogg|flac|m4a|aif+)$/i.test(names[names.length - 1])) mod.sample = names[names.length - 1];
      out.modules.push(mod);
    }
    const rs = one(ks, 'RSMP');
    if (rs) for (const s of kids(rs).filter((x) => x.tag === 'SMPl')) {
      const sk = kids(s), pm = one(sk, 'PRMS'), prm = [];
      if (pm) for (let k = 0; k + 4 <= pm.n; k += 4) prm.push(f32(pm.a + k));
      out.pads.push({ path: path1(one(sk, 'PTH1')), vol: prm[0] ?? 0.853, pan: prm[1] ?? 0.5, pitch: prm[2] ?? 0.5, params: prm });
    }
    return out;
  };
  const readClip = (c, kind) => {
    const pos = u32(c.a), ck = kids(c), h = one(ck, 'CLHd');
    if (!h || h.n < 36) return null;
    const clip = { pos: pos / 128, len: f64(h.a), cycle: f64(h.a + 8), offset: f64(h.a + 16), id: i32(h.a + 24), srcLen: f64(h.a + 28), muted: h.n > 36 && u[h.a + 36] === 1, events: [] };
    const e = one(ck, 'EVN2');
    if (e && e.n >= 2) { const rs = u16(e.a); if (rs >= 20) for (let p = e.a + 2; p + rs <= e.a + e.n; p += rs) clip.events.push({ t: u32(p) / 128, len: f64(p + 4), pitch: u16(p + 12), pan: u16(p + 14), vel: u16(p + 16), flags: u16(p + 18) }); }
    const sm = one(ck, 'CLSm');
    if (sm) {
      const sk = kids(sm), stc = one(sk, 'STRC'), pm = one(sk, 'PRMS'), main = one(sk, 'MAIN');
      clip.sample = path1(one(sk, 'PTH1'));
      clip.name = main ? str(main.a + 12, 256) : '';
      if (stc && stc.n >= 9) { clip.stretchOn = u[stc.a] === 1; clip.stretch = f64(stc.a + 1); }
      if (pm && pm.n >= 8) { clip.gain = f32(pm.a); clip.pan = f32(pm.a + 4); clip.params = []; for (let k = 0; k + 4 <= pm.n; k += 4) clip.params.push(f32(pm.a + k)); }
    }
    return clip;
  };
  for (let k = 0; k < chans.length; k++) {
    const c = chans[k], ks = kids(c), hd = one(ks, 'CHHD'), flag = u32(c.a);
    const ch = { kind: flag === 0 ? 'master' : flag === 0x80 ? 'bus' : 'track', name: hd ? str(hd.a, 1024) : 'Channel ' + k, order: hd && hd.n > 0x40c ? f32(hd.a + 0x408) : k, hue: hd && hd.n > 0x410 ? f32(hd.a + 0x40c) : 0, number: hd && hd.n >= 0x43c ? u32(hd.a + 0x438) : k, tracks: [] };
    Object.assign(ch, racks[k] ? readRack(racks[k]) : { vol: 0.853, pan: 0.5, modules: [], pads: [] });
    for (const t of ks.filter((x) => x.tag === 'TRKH')) {
      const tk = kids(t), ds = one(tk, 'DESc');
      const tr = { kind: ds ? ['notes', 'automation', 'audio', 'drums'][i32(ds.a)] || 'audio' : 'audio', target: ds ? { module: i32(ds.a + 4), param: i32(ds.a + 8) } : null, label: ds ? str(ds.a + 28, 256) : '', clips: [] };
      for (const cl of tk.filter((x) => x.tag === 'CLIP')) { const x = readClip(cl, tr.kind); if (x) tr.clips.push(x); }
      ch.tracks.push(tr);
    }
    P.channels.push(ch);
    if (onProgress) onProgress((k + 1) / chans.length);
  }
  // plugin names: proven ids, then names learned from preset folders in this file, else an honest id
  const nameOf = (type) => KNOWN[type] || presetName[type] || 'Efek FLM #' + type;
  for (const ch of P.channels) for (const m of ch.modules) m.name = nameOf(m.type);
  for (const ch of P.channels) for (const t of ch.tracks) if (t.kind === 'automation' && t.label) {   // "Gain : FX Leveller" names the module type of that instance
    const mm = /:\s*(.+)$/.exec(t.label), mod = ch.modules.find((m) => m.id === t.target.module);
    if (mm && mod && /^Efek FLM #/.test(mod.name)) { const nm = mm[1].trim(); for (const c2 of P.channels) for (const m2 of c2.modules) if (m2.type === mod.type) m2.name = nm; }
  }
  return P;
}

// FLM synths: recognised by type id (FLM_TYPES, when known) or by the name / preset path the module stores (e.g. ".../GMS Presets/...")
const SYNTHS = [['gms', /\bGMS\b|GMSynth|GM Synth/i, 'GMS'], ['minisynth', /mini\s*synth/i, 'MiniSynth'], ['supersaw', /super\s*saw/i, 'SuperSaw']];
function synthOf(m) {
  const t = FLM_TYPES[m.type]; if (t) return t.synth ? { kind: t.synth, name: t.name } : null;   // a known effect type is never a synth
  const txt = [m.presetPath, ...(m.names || []), m.name].join(' ');
  for (const [kind, re, name] of SYNTHS) if (re.test(txt)) return { kind, name };
  return null;
}
// FLM structures -> the neutral import model (js/import/build.js). Units: beats, linear gain (1 = the app's default level), pan -1..1.
// FLM levels are 0..1 sliders whose default is 0.853: gains are kept relative to that default (0.853 -> the MDAW default level).
const LVL0 = 0.853;
export function flmToModel(P) {
  const M = { app: P.app, name: P.name || 'FLM Project', bpm: P.bpm, sig: P.sig, channels: [], warnings: P.warnings.slice() };
  const hue = (h) => (Number.isFinite(h) && h >= 0 && h <= 1 ? h : null);
  const ordered = P.channels.slice().sort((a, b) => (a.kind === b.kind ? (a.kind === 'track' ? a.order - b.order : 0) : 0));
  for (const ch of ordered) {
    // the channel's instrument: every DirectWave layer (they all sound together in FLM -> zones of one MDAW DirectWave), else a GMS /
    // MiniSynth / SuperSaw module (recognised by its type id or by the name / preset path it stores)
    const dw = ch.modules.filter((m) => m.type === 1), syn = dw.length ? null : ch.modules.find((m) => synthOf(m));
    const instMods = new Set(dw.length ? dw : syn ? [syn] : []);
    const c = { kind: ch.kind, name: ch.name, hue: hue(ch.hue), gain: ch.vol / LVL0, pan: ch.pan * 2 - 1, tracks: [], pads: [],
      modules: ch.modules.filter((m) => !instMods.has(m)).map((m) => ({ name: m.name, enabled: m.enabled, preset: m.preset && m.preset !== 'Default' ? m.preset : '', params: m.params, id: m.id, flmType: m.type, ...(FLM_TYPES[m.type] && FLM_TYPES[m.type].sure === false ? { sure: false } : {}), app: 'FL Studio Mobile' })) };
    if (dw.length) {
      const lib = dw.find((m) => m.library);
      c.instrument = { kind: 'directwave', name: 'DirectWave', layers: dw.filter((m) => m.enabled && m.sample).map((m) => ({ sample: m.sample, root: m.root ?? 60, params: m.params })), library: lib ? lib.library : '', preset: dw[0].preset, enabled: dw.some((m) => m.enabled) };
      if (!c.instrument.layers.length && !c.instrument.library && dw[0].sample) c.instrument.layers.push({ sample: dw[0].sample, root: dw[0].root ?? 60 });
    } else if (syn) { const k = synthOf(syn); c.instrument = { kind: k.kind, name: k.name, preset: syn.preset && syn.preset !== 'Default' ? syn.preset : '', params: syn.params, enabled: syn.enabled, flmType: syn.type }; }
    c.pads = ch.pads.map((q, k) => ({ path: q.path, name: (q.path.split('/').pop() || 'Pad ' + (k + 1)).replace(/\.[^.]+$/, ''), gain: q.vol / LVL0, pan: q.pan * 2 - 1, pitch: Math.round((q.pitch - 0.5) * 48) }));
    for (const t of ch.tracks) {
      if (!t.clips.length && t.kind === 'automation') continue;               // empty automation slots
      const tr = { kind: t.kind, label: t.label, clips: [] };
      if (t.kind === 'automation') {
        if (t.target && t.target.module === 0 && t.target.param === 0) tr.target = { kind: 'volume' };   // mixer Level
        else { const mod = ch.modules.find((m) => m.id === t.target.module); tr.target = { kind: 'module', name: t.label || (mod ? mod.name : '?') }; }
      }
      for (const x of t.clips) {
        const cl = { pos: x.pos, len: x.len, cycle: x.cycle, offset: x.offset, srcLen: x.srcLen, muted: x.muted };
        if (t.kind === 'audio') Object.assign(cl, { sample: x.sample, name: x.name, stretch: x.stretchOn !== false && x.stretch > 0.01 ? x.stretch : 1, gain: (x.gain ?? LVL0) / LVL0, pan: x.pan != null ? x.pan * 2 - 1 : 0 });
        else if (t.kind === 'automation') cl.points = x.events.map((e) => ({ t: e.t, v: e.vel / 65535 }));
        else cl.notes = x.events.map((e) => ({ t: e.t, len: Math.max(1 / 64, e.len || 0.25), pitch: e.pitch, vel: Math.max(0.05, Math.min(1, e.vel / 32767 * 0.8)), pan: Math.max(-1, Math.min(1, e.pan / 32767.5 - 1)) }));
        tr.clips.push(cl);
      }
      c.tracks.push(tr);
    }
    M.channels.push(c);
  }
  return M;
}
