// FL Studio Mobile project (.flm) reader -> import model (js/import/model.js). Pure: bytes in, plain objects out (no DOM, no engine).
// The format is undocumented; this layout was worked out from real projects (FL Studio Mobile 4.x):
//   file   = "10LF" + chunks; chunk = tag(4 ASCII) + u32 LE size + data. Containers start with a 0/4/8-byte prefix, then chunks.
//   HEAD   project: u32 0, u32 version, name[256], ..., f64 tempo at +0x108;   TDIV: u8 numerator, u8 denominator
//   RACK x N / CHNL x N (same order) = the channels. CHNL prefix u32 kind (0 master, 0x80 effect bus, 0x100 track).
//     CHHD: name[1024], ..., f32 order key (+0x408), f32 colour hue (+0x40c), GUID, u32 number (+0x438)
//     TRKH (one per sub-track): DESc = i32 kind (0 notes, 1 automation, 2 audio, 3 drums), i32 module id, i32 param, ..., name[...] (+0x1c)
//       CLIP = u32 position (128 ticks / beat) + "20LC" + CLHd (f64 length, f64 loop/cycle length, f64 offset, i32 id, f64 source length, u8 flags)
//              EVN2 = u16 record size (20) + records: u32 time (128/beat), f64 length (beats), u16 pitch, u16 pan, u16 velocity, u16 flags
//              CLSm (audio) = PTH1 (u16 len + "@L@\0" + path relative to the FLM user folder), STRC (u8 stretch on, f64 time ratio, f64 pitch ratio,
//              f32 pitch knob = 0.5 + semitones / 48, f32), STR1 (u8 on, f64 time ratio, f64 pitch in semitones), PRMS (f32 gain, pan, pitch knob used
//              when stretching is off = resampled, ..., attack / decay / sustain / release at [6..9]). A clip with length 0 has never been resized:
//              its length is its cycle length (FLM duplicates / linked clips, LINk).
//           MODULE SMPR = f32 pan, level / mix (1 = full), f32. DirectWave ZONE root and EVN2 note pitches share one scale = MIDI (NOTE_OFS below).
//     RACK: RPRM (f32 volume, f32 pan 0..1, f32 mute 0 / 1, ...), RMOd modules in signal order (prefix i32 type, u32 instance id; HEAD, DESC names, PRST preset
//           path, PRMS f32 params with [0] = enabled, CSTM: ZONE / PATh = DirectWave sample), RSMP = Drums sampler: SMPl per pad (PTH1, PRMS)
import { FLM_TYPES } from './fxmap.js';
// FLM note numbers are MIDI note numbers: the owner's "New Song" stems prove it (FLM GMS / SuperSaw / MiniSynth and a DirectWave library piano
// playing stored 57 / 60 / 64 sound A3 220 Hz / C4 / E4). A DirectWave ZONE root is stored on the same scale (a C4 WAV whose zone says 48 plays at
// unity on stored note 48), so notes and roots get the same offset (0): sample pitch stays relative, synth / General MIDI pitch is absolute and right.
// (Before: both were shifted +12, which kept samplers right but played every synth one octave too high.)
const NOTE_OFS = 0;
const DW_ROOT0 = 48 + NOTE_OFS;                                                    // a zone without a stored root: FLM's default (a C4 WAV plays at unity on note 48)
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
    const ks = kids(r), out = { vol: LVL0, pan: 0.5, modules: [], pads: [] };
    const rp = one(ks, 'RPRM');                              // f32 x 6: level, pan, mute (0 / 1), solo?, 0.5, ?  (the FLM manual's channel has Activate (mute) then Solo; index 3 is a Solo candidate, 0 in every known project, not applied)
    if (rp && rp.n >= 8) { out.vol = f32(rp.a); out.pan = f32(rp.a + 4); out.rprm = []; for (let k = 0; k + 4 <= rp.n; k += 4) out.rprm.push(f32(rp.a + k)); if (rp.n >= 12) out.mute = f32(rp.a + 8) > 0.5; if (rp.n >= 16) out.solo = f32(rp.a + 12) > 0.5; }
    for (const m of ks.filter((x) => x.tag === 'RMOd')) {
      const mk = kids(m), type = i32(m.a), id = u32(m.a + 4);
      const prst = one(mk, 'PRST'), prms = one(mk, 'PRMS'), desc = one(mk, 'DESC'), cstm = one(mk, 'CSTM'), smpr = one(mk, 'SMPR');
      const pr = prst && prst.n > 8 ? str(prst.a + 4, Math.min(prst.n - 4, u32(prst.a))) : '';
      const params = []; if (prms) for (let k = 0; k + 4 <= prms.n; k += 4) params.push(f32(prms.a + k));
      const names = desc ? [str(desc.a, 256), str(desc.a + 0x100, 256)].filter(Boolean) : [];
      const folder = /Effect Presets\/([^/]+)\//.exec(pr); if (folder && !KNOWN[type]) presetName[type] = folder[1].replace(/(\S)\d+$/, '$1').trim();   // "Autoduck2" -> Autoduck, "Reverb 2" stays
      const mod = { type, id, params, enabled: !(params.length && params[0] < 0.5), preset: pr.replace(/^.*\//, '').replace(/\.(flmpst|dwp)$/i, ''), presetPath: pr, names };
      if (smpr && smpr.n >= 12) { mod.wetPan = f32(smpr.a); mod.level = f32(smpr.a + 4); mod.postGain = f32(smpr.a + 8); mod.pan = 0; }   // SMPR = Wet Pan, Mix, Post Gain (FLM Rack "Mix options"); Mix -> module level, Wet Pan / Post Gain default 0.5 in known projects
      if (cstm) for (const z of kids(cstm)) {                 // DirectWave: the sample of its zone (user folder) or a library program (built-in content)
        if (z.tag === 'ZONE') { mod.sample = clean(raw(z.a, Math.min(z.n, 1024))); if (z.n > 1028) mod.root = Math.min(127, u[z.a + 1024] + NOTE_OFS); }   // path[1024], then the zone's root key (MIDI)
        if (z.tag === 'PATh') mod.library = clean(raw(z.a + 4, Math.min(z.n - 4, u32(z.a))));
      }
      if (type === 1 && !mod.sample && !mod.library && names.length > 1 && /\.(wav|mp3|ogg|flac|m4a|aif+)$/i.test(names[names.length - 1])) mod.sample = names[names.length - 1];
      out.modules.push(mod);
    }
    const rs = one(ks, 'RSMP');
    if (rs) for (const s of kids(rs).filter((x) => x.tag === 'SMPl')) {
      const sk = kids(s), pm = one(sk, 'PRMS'), prm = [];
      if (pm) for (let k = 0; k + 4 <= pm.n; k += 4) prm.push(f32(pm.a + k));
      // MAIN (Honeydew read.rs slot()): i32, f64 pad index, name[512], folder[512], u8 reverse, f64 beat offset, f32 offset control, u8 cut group
      // (0 none, 1..3 = A..C), u8 overlapping voices (Poly). PRMS: level, pan, speed (pitch), mute, solo, length, A, D, S, R, sample start.
      const mn = one(sk, 'MAIN'), M0 = mn && mn.n >= 1051 ? mn.a : -1;
      out.pads.push({ path: path1(one(sk, 'PTH1')), vol: prm[0] ?? LVL0, pan: prm[1] ?? 0.5, pitch: prm[2] ?? 0.5, params: prm, index: M0 >= 0 ? f64(M0 + 4) : out.pads.length,
        reverse: M0 >= 0 && u[M0 + 1036] !== 0, offset: M0 >= 0 ? f64(M0 + 1037) : 0, cut: M0 >= 0 ? Math.min(3, u[M0 + 1049]) : 0, poly: M0 >= 0 ? u[M0 + 1050] !== 0 : true, mute: (prm[3] || 0) > 0.5, solo: (prm[4] || 0) > 0.5 });
    }
    out.pads.sort((a, b) => a.index - b.index);           // a slot plays on the pad its MAIN pad index names (not in file order)
    return out;
  };
  const readClip = (c, kind) => {
    const pos = u32(c.a), ck = kids(c), h = one(ck, 'CLHd');
    if (!h || h.n < 36) return null;
    const clip = { pos: pos / 128, len: f64(h.a), cycle: f64(h.a + 8), offset: f64(h.a + 16), id: i32(h.a + 24), srcLen: f64(h.a + 28), muted: h.n > 36 && u[h.a + 36] === 1, events: [] };
    if (!(clip.len > 0)) { clip.len = clip.cycle > 0 ? clip.cycle : clip.srcLen > 0 ? clip.srcLen : 4; clip.lenFromCycle = true; }   // never resized: one cycle long
    const e = one(ck, 'EVN2');
    if (e && e.n >= 2) { const rs = u16(e.a); if (rs >= 20) for (let p = e.a + 2; p + rs <= e.a + e.n; p += rs) clip.events.push({ t: u32(p) / 128, len: f64(p + 4), pitch: u16(p + 12), vel8: dv.getUint8(p + 14), pan8: dv.getUint8(p + 15), vel: u16(p + 16), value: u16(p + 16), repeat: dv.getInt8(p + 18), slide: u[p + 19] !== 0, flags: u16(p + 18) }); }
    const sm = one(ck, 'CLSm');
    if (sm) {
      const sk = kids(sm), stc = one(sk, 'STRC'), pm = one(sk, 'PRMS'), main = one(sk, 'MAIN');
      clip.sample = path1(one(sk, 'PTH1'));
      clip.name = main ? str(main.a + 12, 256) : '';
      const s1 = one(sk, 'STR1');
      if (stc && stc.n >= 9) { clip.stretchOn = u[stc.a] === 1; clip.stretch = f64(stc.a + 1); if (stc.n >= 17 && clip.stretchOn) clip.pitch = 12 * Math.log2(Math.max(1e-6, f64(stc.a + 9))); }
      if (s1 && s1.n >= 17 && u[s1.a] === 1) clip.pitch = f64(s1.a + 9);              // semitones while stretching (time and pitch independent)
      if (pm && pm.n >= 8) { clip.gain = f32(pm.a); clip.pan = f32(pm.a + 4); clip.params = []; for (let k = 0; k + 4 <= pm.n; k += 4) clip.params.push(f32(pm.a + k)); if (!clip.stretchOn && pm.n >= 12) clip.repitch = (f32(pm.a + 8) - 0.5) * 48; }   // stretch off: the pitch knob resamples
    }
    return clip;
  };
  for (let k = 0; k < chans.length; k++) {
    const c = chans[k], ks = kids(c), hd = one(ks, 'CHHD'), flag = u32(c.a);
    const ch = { kind: flag === 0 ? 'master' : flag === 0x80 ? 'bus' : 'track', name: hd ? str(hd.a, 1024) : 'Channel ' + k, order: hd && hd.n > 0x40c ? f32(hd.a + 0x408) : k, hue: hd && hd.n > 0x410 ? f32(hd.a + 0x40c) : 0, number: hd && hd.n >= 0x43c ? u32(hd.a + 0x438) : k, tracks: [] };
    Object.assign(ch, racks[k] ? readRack(racks[k]) : { vol: LVL0, pan: 0.5, modules: [], pads: [] });
    // SEND (Honeydew read.rs send()): i32 target channel number (0 = master), f32 enabled (> 0.5), f32 linear gain, f32 / f32 initial
    // values, f32 level (the Level law, 0.8531 = 0 dB). A channel plays only through its sends (post fader and pan); a repeated target is ignored.
    ch.sends = []; for (const sd of ks.filter((x) => x.tag === 'SEND')) { if (sd.n < 4) continue; const tg = i32(sd.a); if (ch.sends.some((q) => q.target === tg)) continue; ch.sends.push({ target: tg, enabled: sd.n >= 8 ? f32(sd.a + 4) > 0.5 : true, level: sd.n >= 24 ? f32(sd.a + 20) : LVL0 }); }
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
// FLM structures -> the neutral import model (js/import/build.js). Units: beats, linear gain (1 = unity, 0 dB), pan -1..1.
// FLM levels (track, master, bus, audio clip, drum pad) are 0..1 sliders whose default is the f32 0.85312408...: that default is unity
// gain and the stored values are kept as gain relative to it, exactly (no rounding). Note event (20 bytes, as Honeydew reads it): u32 position,
// f64 length, i16 key, u8 velocity (0..255, FLM's default 204 = 80 %), u8 pan (127 = centre), u16 value (0x7FFF; a drum hit's pitch), u8 repeat,
// u8 slide. Proven on the owner's projects: byte 14 varies note by note (204, 255, 178, 44 ...), byte 15 is 127, the u16 is 32767 on notes.
// (Before: the u16 was read as velocity, so every imported note played at 100 %.)
export const LVL0 = 0.85312408208847046;
// FLM's Level law (Honeydew mixer.rs level_gain): dB = 66 v^0.6 - 60, so 0.8531 is 0 dB, 1 is +6 dB, 0 is silence. Channel, master, effect
// bus, send, drum pad and audio clip levels all follow it (before: the ratio v / 0.8531, e.g. 0.25 played -10.6 dB instead of FLM's -31.2 dB).
export function flmGain(v) { if (!(v > 0)) return 0; const db = 66 * Math.pow(v, 0.6) - 60; return Math.abs(db) < 1e-5 ? 1 : Math.pow(10, db / 20); }
export function flmToModel(P) {
  const M = { app: P.app, name: P.name || 'FLM Project', bpm: P.bpm, sig: P.sig, channels: [], warnings: P.warnings.slice() };
  const hue = (h) => (Number.isFinite(h) && h >= 0 && h <= 1 ? h : null);
  const ordered = P.channels.slice().sort((a, b) => (a.kind === b.kind ? (a.kind === 'track' ? a.order - b.order : 0) : 0));
  for (const ch of ordered) {
    // the channel's instrument: every DirectWave layer (they all sound together in FLM -> zones of one MDAW DirectWave), else a GMS /
    // MiniSynth / SuperSaw module (recognised by its type id or by the name / preset path it stores)
    const dw = ch.modules.filter((m) => m.type === 1), syn = dw.length ? null : ch.modules.find((m) => synthOf(m));
    // an unidentified module with a synth-sized parameter set on a notes channel is its instrument (not an effect): reported by id
    const unk = dw.length || syn || !ch.tracks.some((t) => t.kind === 'notes') ? null : ch.modules.find((m) => !FLM_TYPES[m.type] && m.params.length >= 40);
    const instMods = new Set(dw.length ? dw : syn ? [syn] : unk ? [unk] : []);
    const c = { kind: ch.kind, name: ch.name, hue: hue(ch.hue), gain: flmGain(ch.vol), pan: ch.pan * 2 - 1, ...(ch.mute ? { mute: true } : {}), ...(ch.solo ? { solo: true } : {}), tracks: [], pads: [],
      modules: ch.modules.filter((m) => !instMods.has(m)).map((m) => ({ name: m.name, enabled: m.enabled, ...(m.level != null && m.level < 0.999 ? { mix: m.level } : {}), ...(m.postGain != null && Math.abs(m.postGain - 0.5) > 1e-4 ? { postGain: m.postGain } : {}), ...(m.wetPan != null && Math.abs(m.wetPan - 0.5) > 1e-4 ? { wetPan: m.wetPan } : {}), preset: m.preset && m.preset !== 'Default' ? m.preset : '', params: m.params, id: m.id, flmType: m.type, ...(FLM_TYPES[m.type] && FLM_TYPES[m.type].sure === false ? { sure: false } : {}), app: 'FL Studio Mobile' })) };
    if (dw.length) {
      const lib = dw.find((m) => m.library);
      c.instrument = { kind: 'directwave', name: 'DirectWave', layers: dw.filter((m) => m.enabled && m.sample).map((m) => ({ sample: m.sample, root: m.root ?? DW_ROOT0, params: m.params, level: m.level ?? 1, pan: m.pan || 0 })), library: lib ? lib.library : '', preset: dw[0].preset, enabled: dw.some((m) => m.enabled) };
      if (!c.instrument.layers.length && !c.instrument.library && dw[0].sample) c.instrument.layers.push({ sample: dw[0].sample, root: dw[0].root ?? DW_ROOT0, params: dw[0].params, level: dw[0].level ?? 1, pan: dw[0].pan || 0 });
    } else if (unk) { c.instrument = { kind: 'unknown', name: 'Instrumen FLM #' + unk.type, preset: unk.preset && unk.preset !== 'Default' ? unk.preset : '', params: unk.params, enabled: unk.enabled, flmType: unk.type };
    } else if (syn) { const k = synthOf(syn); c.instrument = { kind: k.kind, name: k.name, preset: syn.preset && syn.preset !== 'Default' ? syn.preset : '', params: syn.params, enabled: syn.enabled, flmType: syn.type, ...(k.kind === 'soundfont' ? { library: syn.presetPath } : {}) }; }
    c.pads = ch.pads.map((q, k) => ({ path: q.path, name: (q.path.split('/').pop() || 'Pad ' + (k + 1)).replace(/\.[^.]+$/, ''), gain: flmGain(q.vol), pan: q.pan * 2 - 1, pitch: (q.pitch - 0.5) * 48, env: q.params.length >= 10 ? { a: q.params[6], d: q.params[7], s: q.params[8], r: q.params[9] } : null, reverse: !!q.reverse, cut: q.cut | 0, poly: q.poly !== false, mute: !!q.mute, solo: !!q.solo, offset: Number.isFinite(q.offset) ? q.offset : 0 }));   // pitch 0.5 + st / 48 (cents kept)
    for (const t of ch.tracks) {
      if (!t.clips.length && t.kind === 'automation') continue;               // empty automation slots
      const tr = { kind: t.kind, label: t.label, clips: [] };
      if (t.kind === 'automation') {
        if (t.target && t.target.module === 0 && t.target.param === 0) tr.target = { kind: 'volume' };   // mixer Level
        else { const mod = ch.modules.find((m) => m.id === t.target.module); tr.target = { kind: 'module', name: t.label || (mod ? mod.name : '?'), module: t.target.module, param: t.target.param }; }   // param 32705 = the module's mix (SMPR)
      }
      for (const x of t.clips) {
        const cl = { pos: x.pos, len: x.len, cycle: x.cycle, offset: x.offset, srcLen: x.srcLen, muted: x.muted };
        if (t.kind === 'audio') Object.assign(cl, { sample: x.sample, name: x.name, pitch: x.pitch || 0, repitch: x.repitch || 0, stretch: x.stretchOn !== false && x.stretch > 0.01 ? x.stretch : 1, gain: flmGain(x.gain ?? LVL0), pan: x.pan != null ? x.pan * 2 - 1 : 0,
          ...(x.params && x.params.length >= 10 && (x.params[6] > 0 || x.params[7] < 1 || x.params[8] < 1 || x.params[9] < 1) ? { env: x.params.slice(6, 10) } : {}) });   // clip envelope A D S R (not applied yet: reported)
        else if (t.kind === 'automation') cl.points = x.events.map((e) => ({ t: e.t, v: e.vel / 65535 }));
        else cl.notes = x.events.map((e) => ({ t: e.t, len: e.len > 0 ? e.len : 0.25, pitch: t.kind === 'notes' ? Math.min(127, e.pitch + NOTE_OFS) : e.pitch, vel: e.vel8 / 255, pan: Math.max(-1, Math.min(1, (e.pan8 - 127) / 128)), ...(e.slide && t.kind === 'notes' ? { slide: true } : {}),
          ...(t.kind !== 'notes' && e.repeat > 0 ? { repeat: e.repeat } : {}), ...(t.kind !== 'notes' && Math.abs(12 * (2 * e.value / 65535 - 1)) > 0.01 ? { pitchOfs: 12 * (2 * e.value / 65535 - 1) } : {}) }));   // drum hit: Repeat (extra hits in the sixteenth), Pitch (2^(2 v / 65535 - 1), +-12 st)
        tr.clips.push(cl);
      }
      c.tracks.push(tr);
    }
    M.channels.push(c);
  }
  return M;
}
