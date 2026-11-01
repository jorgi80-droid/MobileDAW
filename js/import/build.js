// Neutral import model (from .flm / .flp / .als readers) -> MDAW project JSON (the format P.deserialize reads), plus the list of sample files the
// project needs. Nothing is dropped silently:
//   - a plugin MDAW does not have becomes a placeholder device: a neutral Utility (passes the audio through unchanged) carrying
//     d.missing = { name, app, preset, params } so the device card shows "[Plugin tidak tersedia] <name>" and the original data is kept;
//   - an audio clip whose sample is not in the archive keeps its place, length and name and plays a short silent placeholder file;
//   - a DirectWave / sampler instrument whose sample is missing keeps its pattern (notes) and shows the missing program in its card;
//   - a drum pad whose sample is missing keeps its steps (the pad is muted until a sample is loaded).
// Model units: beats, linear gain (1 = default level), pan -1..1.
import { DEVICES, PRESETS, INSTRUMENTS } from '../defs.js';
import { gmFor, GM_SF } from './gm.js';

// the channel's instrument -> MDAW: DirectWave layers -> zones of MDAW's DirectWave; a library program that is not in the archive -> the
// closest General MIDI program of the bundled SoundFont; GMS / MiniSynth / SuperSaw -> MDAW's instrument of the same name (preset by name)
const SYNTH_TYPE = { gms: 5, minisynth: 1, supersaw: 2 };
function presetFor(type, name) {
  const L = PRESETS[type] || [], n = String(name || '').toLowerCase().replace(/\.\w+$/, '').replace(/^.*\//, '').trim();
  if (!n) return null;
  return L.find((p) => p.name.toLowerCase() === n) || L.find((p) => n.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(n)) || L.find((p) => n.split(/\s+/).some((w) => w.length > 3 && p.name.toLowerCase().includes(w))) || null;
}
const PPQ = 960, VMAX = 1.4, DEF_VOL = 0.85, MAX_FX = 8, MAX_TRACKS = 64, MAX_PADS = 16;
const PALETTE = ['#1fbccf', '#e3c000', '#f07200', '#f02ec8', '#0b9fdb', '#8d5de0', '#a3df00', '#b8573c'];
const T = (beats) => Math.round(beats * PPQ);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hex = (n) => n.toString(16).padStart(2, '0');
function hueColor(h, k) {
  if (h == null) return PALETTE[k % PALETTE.length];
  const s = 0.78, l = 0.5, f = (n) => { const q = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(q - 3, 9 - q, 1)))); };
  return '#' + hex(f(0)) + hex(f(8)) + hex(f(4));
}
export const safeName = (s) => String(s || 'Import').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Import';

// opts: { root: '/Samples/Imports/<name>', has(path) -> bool (the sample file is available) }
export function buildMdaw(M, opts) {
  let id = 1; const uid = () => id++;
  const root = opts.root, resolve = opts.resolve || ((p) => (opts.has && opts.has(p) ? p : null));   // model path -> archive path (or null)
  const files = new Map();                                     // model path -> { path in MDAW, missing }
  const report = { tracks: 0, clips: 0, notes: 0, samplesFound: 0, samplesMissing: [], plugins: new Map(), skipped: [], warnings: (M.warnings || []).slice() };
  const sample = (p, name) => {
    const key = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!files.has(key)) {
      const rel = key ? resolve(key) : null, base = (key.split('/').pop() || name || 'sample').replace(/\.[^.]+$/, '');
      files.set(key, rel ? { path: root + '/' + (opts.relName ? opts.relName(rel) : rel), missing: false, src: rel } : { path: root + '/_missing/' + safeName(base) + '.wav', missing: true, src: key, name: base });
      const ok = !!rel;
      if (ok) report.samplesFound++; else report.samplesMissing.push(key || name || '?');
    }
    return files.get(key);
  };
  const zoneOf = (smp, root) => ({ sample: smp, root: clamp(Math.round(root ?? 60), 0, 127), lo: 0, hi: 127, vlo: 1, vhi: 127, tune: 0, loop: false, sus: 0, s0: 0, s1: 1, l0: 0, l1: 1, xf: 0, rev: false, vol: 0, pan: 0 });
  report.instruments = [];
  const instrumentOf = (I, trackName) => {
    I = I || { kind: 'unknown', name: 'Instrumen' };
    const note = (to, how) => report.instruments.push({ track: trackName, from: I.name + (I.library ? ' "' + I.library.replace(/^.*?Samples\//, '').replace(/\.\w+$/, '') + '"' : I.preset ? ' "' + I.preset + '"' : ''), to, how });
    if (SYNTH_TYPE[I.kind]) {
      const type = SYNTH_TYPE[I.kind], pr = presetFor(type, I.preset);
      note(INSTRUMENTS[type].name + (pr ? ' (preset ' + pr.name + ')' : ' (setelan awal)'), pr ? 'preset' : 'default');
      return { type, params: pr ? { ...pr.p } : {}, pitch: 0, from: { app: M.app, name: I.name, preset: I.preset || '', params: I.params || [] } };
    }
    const layers = I.layers || (I.sample ? [{ sample: I.sample, root: 60 }] : []);
    const zones = [];
    for (const L of layers) { const f = sample(L.sample); if (!f.missing) zones.push(zoneOf({ path: f.path, name: f.path.split('/').pop() }, L.root)); }
    if (zones.length) { note('DirectWave (' + zones.length + ' zona' + (zones.length < layers.length ? ', ' + (layers.length - zones.length) + ' sample hilang' : '') + ')', 'exact'); return { type: 4, params: {}, pitch: 0, zones, from: { app: M.app, name: I.name, preset: I.preset || '', layers: layers.map((L) => ({ sample: L.sample, root: L.root, params: (L.params || []).map((v) => Math.round(v * 1e5) / 1e5) })) } }; }
    const gm = I.library ? gmFor(I.library) : null;
    if (gm) { needSf = true; note('SoundFont GM: ' + gm.name + ' (pengganti program library yang tidak ada di arsip)', 'substitute'); return { type: 6, params: { 0: 0.8 }, pitch: 0, sf: { path: GM_SF, preset: gm.program }, sub: { from: I.name, library: gm.label, gm: gm.name } }; }
    note('DirectWave tanpa sample (pattern tetap)', 'missing');
    report.plugins.set((I.name || 'Instrumen') + (I.library ? ' (' + I.library.replace(/^.*\//, '').replace(/\.\w+$/, '') + ')' : ''), 1);
    return { type: 4, params: {}, pitch: 0, zones: [zoneOf(null, 60)], missing: { name: I.name || 'Instrumen', library: I.library || I.preset || '', sample: layers[0] ? layers[0].sample : '' } };
  };
  let needSf = false;
  const vol = (g) => clamp((Number.isFinite(g) ? g : 1) * DEF_VOL, 0, VMAX);
  const util = DEVICES[0].params.map((q) => q.def);
  const placeholder = (m) => {
    report.plugins.set(m.name, (report.plugins.get(m.name) || 0) + 1);
    return { id: uid(), type: 0, params: util.slice(), bypass: m.enabled === false, missing: { name: m.name, app: m.app || M.app, preset: m.preset || '', enabled: m.enabled !== false, ...(m.flmType != null ? { flmType: m.flmType } : {}), ...(m.sure === false ? { sure: false } : {}), params: (m.params || []).map((v) => Math.round(v * 1e5) / 1e5) } };
  };
  const devices = (ch) => (ch.modules || []).slice(0, 16).map(placeholder);
  const notesOf = (cl, map) => (cl.notes || []).map((n) => ({ t: Math.max(0, T(n.t)), d: Math.max(1, T(n.len)), p: map ? map(n.pitch) : clamp(Math.round(n.pitch), 0, 127), v: clamp(n.vel ?? 0.8, 0.01, 1), ...(n.pan ? { pan: clamp(n.pan, -1, 1) } : {}) })).filter((n) => n.p >= 0 && n.p <= 127);
  const patternClip = (cl, notes, name) => {
    const c = { id: uid(), start: Math.max(0, T(cl.pos)), len: Math.max(1, T(cl.len)), name: name || '', notes, cm: true };
    const cyc = T(cl.cycle || 0);
    if (cyc > 0) { c.ll = cyc; c.lp = ((T(cl.offset || 0) % cyc) + cyc) % cyc; c.pb = cyc; }
    if (cl.muted) c.muted = true;
    report.clips++; report.notes += notes.length;
    return c;
  };

  const out = { v: 2, name: M.name, bpm: clamp(M.bpm || 120, 20, 300), sig: { n: M.sig ? M.sig[0] : 4, d: M.sig ? M.sig[1] : 4 }, sigs: [], markers: [], groove: { amt: 0, grid: 240 }, countIn: 0,
    punch: { on: false, start: 0, end: 0 }, recLoop: false, loop: { on: false, start: 0, end: 7680 }, tracks: [], master: { vol: 1, devices: [] }, returns: [], cc: {}, imported: { app: M.app } };
  const spb = 60 / out.bpm;
  const master = M.channels.find((c) => c.kind === 'master');
  if (master) { out.master.vol = vol(master.gain); out.master.devices = devices(master); }
  for (const b of M.channels.filter((c) => c.kind === 'bus')) {
    if (out.returns.length >= MAX_FX) { report.skipped.push('Bus efek "' + b.name + '": jumlah return maksimum ' + MAX_FX); continue; }
    out.returns.push({ name: b.name, vol: vol(b.gain), pan: clamp(b.pan || 0, -1, 1), mute: !!b.mute, devices: devices(b) });
  }
  while (out.returns.length < 2) out.returns.push({ name: 'Return ' + 'AB'[out.returns.length], vol: DEF_VOL, pan: 0, mute: false, devices: [] });

  const autoLater = [];
  let ci = 0;
  for (const ch of M.channels.filter((c) => c.kind === 'track')) {
    const color = ch.color || hueColor(ch.hue, ci++), subs = ch.tracks.filter((t) => t.kind !== 'automation');
    const firstId = [];
    (subs.length ? subs : [{ kind: ch.instrument ? 'notes' : ch.pads.length ? 'drums' : 'audio', clips: [] }]).forEach((st, k) => {
      if (out.tracks.length >= MAX_TRACKS) { report.skipped.push('Track "' + ch.name + '": jumlah track maksimum'); return; }
      const t = { id: uid(), name: subs.length > 1 && k > 0 ? `${ch.name} (${k + 1})` : ch.name, color, kind: 'audio', inst: null, clips: [], devices: devices(ch), vol: vol(ch.gain), pan: clamp(ch.pan || 0, -1, 1), mute: !!ch.mute, solo: false, send: [0, 0], out: -1 };
      if (st.kind === 'notes') {
        t.kind = 'midi';
        t.inst = instrumentOf(ch.instrument, t.name);
        for (const cl of st.clips) t.clips.push(patternClip(cl, notesOf(cl)));
      } else if (st.kind === 'drums') {
        t.kind = 'drum';
        const pads = (ch.pads || []).slice(0, MAX_PADS).map((q, k2) => {
          const f = q.path ? sample(q.path, q.name) : null;
          return { pitch: 36 + k2, name: (q.name || 'Pad ' + (k2 + 1)).slice(0, 14), kind: -1, sample: f && !f.missing ? { path: f.path, name: f.path.split('/').pop() } : null, gain: clamp(20 * Math.log10(Math.max(1e-4, q.gain ?? 1)), -60, 12), pan: clamp(q.pan || 0, -1, 1), pit: clamp(q.pitch || 0, -24, 24), dec: 1, start: 0, end: 1, rev: false, a: 0, d: 0, s: 1, r: 0, mute: !!(f && f.missing), solo: false };
        });
        t.inst = { type: 3, params: {}, pads: pads.length ? pads : undefined };
        const map = pads.length ? (p) => (p >= 0 && p < pads.length ? pads[p].pitch : -1) : (p) => 36 + p;
        for (const cl of st.clips) t.clips.push(patternClip(cl, notesOf(cl, map)));
      } else {
        for (const cl of st.clips) {
          if (!cl.sample) continue;
          const f = sample(cl.sample, cl.name), ratio = cl.stretch > 0 ? cl.stretch : 1, nm = cl.name || (cl.sample.split('/').pop() || '').replace(/\.[^.]+$/, '');
          const c = { id: uid(), start: Math.max(0, T(cl.pos)), len: Math.max(1, T(cl.len)), sample: { path: f.path, name: f.path.split('/').pop() }, gain: clamp(cl.gain ?? 1, 0, 8), name: f.missing ? '⚠ ' + nm + ' (sample tidak ada)' : nm, offset: Math.max(0, (cl.offset || 0) * spb) };
          if (!f.missing && Math.abs(ratio - 1) > 1e-4) c.warp = { beats: 0, ratio: Math.round(ratio * 1e5) / 1e5, rev: false, pitch: 0, bpm: out.bpm };
          const cyc = T(cl.cycle || 0); if (!f.missing && cyc > 0 && cyc < c.len - 1) c.ll = cyc;   // the loop repeats inside a longer clip
          if (cl.muted) c.muted = true;
          if (f.missing) c.missing = { sample: cl.sample };
          t.clips.push(c); report.clips++;
        }
      }
      out.tracks.push(t); report.tracks++; firstId.push(t.id);
    });
    for (const at of ch.tracks.filter((x) => x.kind === 'automation')) autoLater.push({ ch, at, strip: firstId[0] });
  }
  // automation: mixer level -> an MDAW automation track on that channel's track; plugin parameters are listed (their plugin is a placeholder)
  for (const { ch, at, strip } of autoLater) {
    if (!at.target || at.target.kind !== 'volume' || strip == null) { report.skipped.push(`Otomasi "${at.label || '?'}" di ${ch.name}: targetnya plugin yang tidak tersedia`); continue; }
    if (out.tracks.length >= MAX_TRACKS) break;
    const t = { id: uid(), name: 'Auto: ' + ch.name + ' • Volume', color: '#9fb4d8', kind: 'auto', inst: null, clips: [], devices: [], vol: DEF_VOL, pan: 0, mute: false, solo: false, send: [0, 0],
      target: { kind: 0, strip, param: 0, def: { n: 'Volume', min: 0, max: VMAX, fmt: 'gain' } } };
    for (const cl of at.clips) {
      const len = Math.max(1, T(cl.len)), pts = (cl.points || []).map((q) => ({ t: clamp(T(q.t), 0, len), v: clamp(vol((q.v || 0) / 0.853) / VMAX, 0, 1) })).sort((a, b) => a.t - b.t);
      if (!pts.length) continue;
      if (pts.length === 1) pts.push({ t: len, v: pts[0].v });
      t.clips.push({ id: uid(), start: Math.max(0, T(cl.pos)), len, name: '', pts }); report.clips++;
    }
    if (t.clips.length) { out.tracks.push(t); report.tracks++; }
  }
  if (master) for (const at of master.tracks.filter((x) => x.kind === 'automation' && x.clips.length)) report.skipped.push(`Otomasi "${at.label || '?'}" di Master (otomasi volume master belum didukung MDAW)`);
  if (needSf) out.needsSoundFont = GM_SF;
  return { json: out, files: [...files.values()], report: { ...report, plugins: [...report.plugins.entries()].map(([name, n]) => ({ name, n })) } };
}
