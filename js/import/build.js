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
import { LVL0 } from './flm.js';

// the channel's instrument -> MDAW: DirectWave layers -> zones of MDAW's DirectWave; a library program that is not in the archive -> the
// closest General MIDI program of the bundled SoundFont; GMS / MiniSynth / SuperSaw -> MDAW's instrument of the same name (preset by name)
const SYNTH_TYPE = { gms: 31, minisynth: 32, supersaw: 33 };   // the FL Studio Mobile instruments of MobileDAW (js/engine/flmsyn.js)
// FLM DirectWave module parameters (normalised 0..1, [0] = on) -> MDAW DirectWave (30). Layout worked out from the owner's FLM screenshots
// against the values stored in two real projects (defaults of a freshly loaded sample, a library program whose filter shows 40 / 0 / 50 /
// 100, layered tracks an octave apart, legato + slide on the same instance):
//   [1] Attack  [2] Release  [3] Pitch (+-24 st, the knob is stepped: whole semitones toward zero)  [4] Fine Tune (+-100 cents)
//   [5] Decay  [6] Sustain  [7] Slide Time  [8] Reverse  [9] Loop  [10] Legato  [11] Mono
//   [12] Cutoff  [13] Resonance  [14] Kbd Trk  [15] Vel Trk (0..1 = 0..100, as FLM shows them)  [16] Filter Off / Lowpass / Highpass / Bandpass
//   [17..21] filter envelope A D S R Amount (0.5 = 0)  [22..26] frequency envelope  [27..32] LFO mode, rate, shape, attack, amount, destination.
// Pitch / Fine Tune belong to each layer (they go into the zone: root and tune); FLM shows no envelope times (the time curve fT is MDAW's).
const fT = (v) => Math.min(10, Math.round((0.001 + 10 * Math.pow(clamp(v, 0, 1), 3)) * 1e6) / 1e6);   // FLM 0..1 envelope slider -> seconds (1 ms .. 10 s, cubic)
export const dwPitchSt = (r) => (r && r.length > 3 ? clamp(Math.trunc((r[3] - 0.5) * 48 + 1e-9 * Math.sign(r[3] - 0.5)), -24, 24) : 0);
export const dwFineCt = (r) => (r && r.length > 4 ? clamp((r[4] - 0.5) * 200, -100, 100) : 0);
export function dwParamsFromFlm(raw) {
  const r = raw || [], out = {};
  if (r.length < 17) return out;
  const amt = (v) => (clamp(v, 0, 1) - 0.5) * 200, idx = (v, n) => clamp(Math.round(v > 1 ? v : v * (n - 1)), 0, n - 1), on = (v) => (v > 0.5 ? 1 : 0);
  out[0] = 0; out[1] = 0;                                                         // pitch / fine are per layer (zone root / tune)
  out[2] = fT(r[1]); out[3] = fT(r[5]); out[4] = clamp(r[6], 0, 1); out[5] = fT(r[2]); out[6] = clamp(fT(r[7]), 0.001, 2);
  out[8] = on(r[8]); out[9] = on(r[9]); out[10] = on(r[10]); out[11] = on(r[11]);
  out[12] = clamp(r[12], 0, 1) * 100; out[13] = clamp(r[13], 0, 1) * 100; out[14] = clamp(r[14], 0, 1) * 100; out[15] = clamp(r[15], 0, 1) * 100; out[16] = idx(r[16], 4);
  if (r.length < 33) return out;
  [[17, 17], [22, 22]].forEach(([src, dst]) => { out[dst] = fT(r[src]); out[dst + 1] = fT(r[src + 1]); out[dst + 2] = clamp(r[src + 2], 0, 1); out[dst + 3] = fT(r[src + 3]); out[dst + 4] = amt(r[src + 4]); });
  out[27] = idx(r[27], 3); out[28] = 0.03 * Math.pow(1000, clamp(r[28], 0, 1)); out[30] = idx(r[29], 3); out[31] = clamp(r[30], 0, 1) * 5; out[32] = amt(r[31]); out[33] = idx(r[32], 4);
  return out;
}
function presetFor(type, name) {
  const L = PRESETS[type] || [], n = String(name || '').toLowerCase().replace(/\.\w+$/, '').replace(/^.*\//, '').trim();
  if (!n) return null;
  return L.find((p) => p.name.toLowerCase() === n) || L.find((p) => n.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(n)) || L.find((p) => n.split(/\s+/).some((w) => w.length > 3 && p.name.toLowerCase().includes(w))) || null;
}
const PPQ = 960, VMAX = 1.4, DEF_VOL = 0.85, MAX_FX = 8, MAX_TRACKS = 64, MAX_PADS = 16;
const PALETTE = ['#1fbccf', '#e3c000', '#f07200', '#f02ec8', '#0b9fdb', '#8d5de0', '#a3df00', '#b8573c'];
const T = (beats) => { const t = beats * PPQ, r = Math.round(t); return Math.abs(t - r) < 1e-6 ? r : Math.round(t * 1024) / 1024; };   // exact ticks: FLM's 1/128 beat = 7.5 ticks (half ticks kept)
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
  // a DirectWave layer -> a zone: its Pitch (whole semitones) moves the root the other way, its Fine Tune is the zone tune (cents), its module
  // level / pan are the zone level (dB, exact) / pan
  const zoneOf = (smp, root, L = {}) => ({ sample: smp, root: clamp(Math.round(root ?? 60) - dwPitchSt(L.params), 0, 127), lo: 0, hi: 127, vlo: 1, vhi: 127, tune: dwFineCt(L.params), loop: false, sus: 0, s0: 0, s1: 1, l0: 0, l1: 1, xf: 0, rev: false,
    vol: L.level != null && L.level > 0 && L.level !== 1 ? Math.max(-60, 20 * Math.log10(L.level)) : L.level === 0 ? -60 : 0, pan: clamp(L.pan || 0, -1, 1) });
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
    // every DirectWave layer becomes a zone with its own pitch / fine / level / pan, also when its sample is not in the archive (a silent
    // placeholder file keeps the zone and the instrument settings: put the sample in place and it plays exactly as set in FLM)
    const zones = [], lost = [];
    for (const L of layers) { const f = sample(L.sample); const z = zoneOf({ path: f.path, name: f.path.split('/').pop() }, L.root, L); if (f.missing) { z.missing = L.sample; lost.push(L.sample); } zones.push(z); }
    const dwParams = dwParamsFromFlm((layers.find((L) => (L.params || []).length >= 33) || layers.find((L) => (L.params || []).length >= 17) || {}).params);
    if (zones.length) {
      note('DirectWave (' + zones.length + ' zona' + (lost.length ? ', ' + lost.length + ' sample hilang' : '') + ')', lost.length === zones.length ? 'missing' : 'exact');
      return { type: 30, params: dwParams, pitch: 0, zones, from: { app: M.app, name: I.name, preset: I.preset || '', layers: layers.map((L) => ({ sample: L.sample, root: L.root, params: (L.params || []).slice() })) }, ...(lost.length ? { missing: { name: I.name || 'DirectWave', library: '', sample: lost.join(', ') } } : {}) };
    }
    const gm = I.library ? gmFor(I.library) : null;
    if (gm) { needSf = true; note('SoundFont GM: ' + gm.name + ' (pengganti program library yang tidak ada di arsip)', 'substitute'); return { type: 6, params: { 0: 0.8 }, pitch: 0, sf: { path: GM_SF, preset: gm.program }, sub: { from: I.name, library: gm.label, gm: gm.name } }; }
    note(I.kind === 'unknown' ? I.name + ' belum dikenal: DirectWave kosong (pattern tetap)' : 'DirectWave tanpa sample (pattern tetap)', 'missing');
    report.plugins.set((I.name || 'Instrumen') + (I.library ? ' (' + I.library.replace(/^.*\//, '').replace(/\.\w+$/, '') + ')' : ''), 1);
    return { type: 30, params: {}, pitch: 0, zones: [zoneOf(null, 60)], missing: { name: I.name || 'Instrumen', library: I.library || I.preset || '', sample: layers[0] ? layers[0].sample : '' } };
  };
  let needSf = false;
  // FLM pad envelope (0..1 sliders): applied when it shapes the sound (attack, sustain below full, release); full settings = play the sample through
  const padEnv = (e) => { if (!e || (e.a < 0.005 && e.s > 0.995 && e.r > 0.995)) return { a: 0, d: 0, s: 1, r: 0 }; return { a: e.a < 0.005 ? 0 : fT(e.a), d: fT(e.d), s: clamp(e.s, 0, 1), r: e.r > 0.995 ? 0 : fT(e.r) }; };
  const vol = (g) => clamp(Number.isFinite(g) ? g : 1, 0, VMAX);   // model gain 1 = the source app's default level = 0 dB in MDAW
  const util = DEVICES[0].params.map((q) => q.def);
  const placeholder = (m) => {
    report.plugins.set(m.name, (report.plugins.get(m.name) || 0) + 1);
    return { id: uid(), type: 0, params: util.slice(), bypass: m.enabled === false, missing: { name: m.name, app: m.app || M.app, preset: m.preset || '', enabled: m.enabled !== false, ...(m.flmType != null ? { flmType: m.flmType } : {}), ...(m.sure === false ? { sure: false } : {}), ...(m.mix != null ? { mix: m.mix } : {}), ...(m.id != null ? { flmId: m.id } : {}), params: (m.params || []).slice() } };
  };
  const devices = (ch) => (ch.modules || []).slice(0, 16).map(placeholder);
  const prec = { offGrid: 0, boost: 0 };                                     // precision report: values kept that a rounding would have changed
  const notesOf = (cl, map) => (cl.notes || []).map((n) => { const t = Math.max(0, T(n.t)), d = Math.max(1 / 64, T(n.len)); if (t % 1 || d % 1) prec.offGrid++; if (n.vel > 1) prec.boost++; return { t, d, p: map ? map(n.pitch) : clamp(Math.round(n.pitch), 0, 127), v: clamp(n.vel ?? 0.8, 0.001, 2), ...(n.pan ? { pan: clamp(n.pan, -1, 1) } : {}) }; }).filter((n) => n.p >= 0 && n.p <= 127);
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
          return { pitch: 36 + k2, name: (q.name || 'Pad ' + (k2 + 1)).slice(0, 14), kind: -1, sample: f && !f.missing ? { path: f.path, name: f.path.split('/').pop() } : null, gain: clamp(20 * Math.log10(Math.max(1e-4, q.gain ?? 1)), -60, 12), pan: clamp(q.pan || 0, -1, 1), pit: clamp(q.pitch || 0, -24, 24), dec: 1, start: 0, end: 1, rev: false, ...padEnv(q.env), mute: !!(f && f.missing), solo: false };
        });
        t.inst = { type: 3, params: {}, pads: pads.length ? pads : undefined };
        const map = pads.length ? (p) => (p >= 0 && p < pads.length ? pads[p].pitch : -1) : (p) => 36 + p;
        for (const cl of st.clips) t.clips.push(patternClip(cl, notesOf(cl, map)));
      } else {
        for (const cl of st.clips) {
          if (!cl.sample) continue;
          const f = sample(cl.sample, cl.name), ratio = cl.stretch > 0 ? cl.stretch : 1, nm = cl.name || (cl.sample.split('/').pop() || '').replace(/\.[^.]+$/, '');
          const c = { id: uid(), start: Math.max(0, T(cl.pos)), len: Math.max(1, T(cl.len)), sample: { path: f.path, name: f.path.split('/').pop() }, gain: clamp(cl.gain ?? 1, 0, 8), name: f.missing ? '⚠ ' + nm + ' (sample tidak ada)' : nm, offset: Math.max(0, (cl.offset || 0) * spb) };
          const st = cl.pitch || 0, rp = cl.repitch || 0;                         // exact (FLM stores f64 semitones / an f32 knob)
          if (!f.missing && rp) c.warp = { beats: 0, ratio: Math.pow(2, -rp / 12), rev: false, pitch: 0, mode: 'repitch', bpm: out.bpm };   // stretch off: pitch by resampling (speed follows)
          else if (!f.missing && (Math.abs(ratio - 1) > 1e-12 || st)) c.warp = { beats: 0, ratio, rev: false, pitch: st, bpm: out.bpm };   // stretch on: time and pitch independent
          if (st || rp) report.pitched = (report.pitched || 0) + 1;
          const cyc = T(cl.cycle || 0); if (!f.missing && cyc > 0 && cyc < c.len - 1) c.ll = cyc;   // the loop repeats inside a longer clip
          if (cl.muted) c.muted = true;
          if (Math.abs(cl.pan || 0) > 1e-6) prec.clipPan = (prec.clipPan || 0) + 1;   // MDAW clips have no pan of their own: reported
          if (cl.env) prec.clipEnv = (prec.clipEnv || 0) + 1;
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
    if (at.target && at.target.kind === 'module' && strip != null) {           // plugin parameter: a device lane, mapped once the module is converted (index.js resolveFlmAutomation)
      if (out.tracks.length >= MAX_TRACKS) break;
      const host = out.tracks.find((x) => x.id === strip), dev = host && host.devices.find((d) => d.missing && d.missing.flmId === at.target.module);
      if (!dev) { report.skipped.push(`Otomasi "${at.label || '?'}" di ${ch.name}: modulnya tidak ada di rantai`); continue; }
      const t = { id: uid(), name: 'Auto: ' + ch.name + ' \u2022 ' + (at.label || 'Plugin'), color: '#9fb4d8', kind: 'auto', inst: null, clips: [], devices: [], vol: DEF_VOL, pan: 0, mute: false, solo: false, send: [0, 0],
        target: { kind: 4, strip, devId: dev.id, param: -1, def: { n: at.label || 'Plugin', min: 0, max: 1 } }, flmAuto: { param: at.target.param, label: at.label || '', from: (dev.missing.params || [])[at.target.param] } };
      for (const cl of at.clips) {
        const len = Math.max(1, T(cl.len)), pts = (cl.points || []).map((q) => ({ t: clamp(T(q.t), 0, len), v: clamp(q.v || 0, 0, 1) })).sort((a, b) => a.t - b.t);
        if (!pts.length) continue;
        t.clips.push({ id: uid(), start: Math.max(0, T(cl.pos)), len, name: '', pts }); report.clips++;
      }
      if (t.clips.length) { out.tracks.push(t); report.tracks++; }
      continue;
    }
    if (!at.target || at.target.kind !== 'volume' || strip == null) { report.skipped.push(`Otomasi "${at.label || '?'}" di ${ch.name}: targetnya plugin yang tidak tersedia`); continue; }
    if (out.tracks.length >= MAX_TRACKS) break;
    const t = { id: uid(), name: 'Auto: ' + ch.name + ' • Volume', color: '#9fb4d8', kind: 'auto', inst: null, clips: [], devices: [], vol: DEF_VOL, pan: 0, mute: false, solo: false, send: [0, 0],
      target: { kind: 0, strip, param: 0, def: { n: 'Volume', min: 0, max: VMAX, fmt: 'gain' } } };
    for (const cl of at.clips) {
      const len = Math.max(1, T(cl.len)), pts = (cl.points || []).map((q) => ({ t: clamp(T(q.t), 0, len), v: clamp(vol((q.v || 0) / LVL0) / VMAX, 0, 1) })).sort((a, b) => a.t - b.t);
      if (!pts.length) continue;
      if (pts.length === 1) pts.push({ t: len, v: pts[0].v });
      t.clips.push({ id: uid(), start: Math.max(0, T(cl.pos)), len, name: '', pts }); report.clips++;
    }
    if (t.clips.length) { out.tracks.push(t); report.tracks++; }
  }
  if (master) for (const at of master.tracks.filter((x) => x.kind === 'automation' && x.clips.length)) report.skipped.push(`Otomasi "${at.label || '?'}" di Master (otomasi volume master belum didukung MDAW)`);
  if (needSf) out.needsSoundFont = GM_SF;
  const P2 = report.precision = [];
  if (prec.offGrid) P2.push(prec.offGrid + ' not di luar grid MobileDAW (1/128 ketuk FLM = 7,5 tick) disimpan di posisi persisnya, tanpa pembulatan');
  if (prec.boost) P2.push(prec.boost + ' not dengan velocity di atas 100 % (boost) dipertahankan, tidak dipotong');
  const dwN = report.instruments.filter((x) => /^DirectWave \(/.test(x.to)).length, synN = report.instruments.filter((x) => x.how === 'preset' || x.how === 'default').length;
  if (prec.clipPan) P2.push(prec.clipPan + ' klip audio punya pan sendiri di file asli: MobileDAW belum punya pan per klip (pan track tetap dipakai)');
  if (prec.clipEnv) P2.push(prec.clipEnv + ' klip audio punya envelope (A / D / S / R) sendiri di file asli: belum diterapkan');
  const muted = M.channels.filter((c) => c.kind !== 'master' && c.mute).map((c) => c.name);
  if (muted.length) P2.push(muted.length + ' track di-mute seperti di FLM: ' + muted.join(', '));
  if (dwN) P2.push(dwN + ' DirectWave: pitch / fine tune per lapisan, envelope, filter, loop / reverse / legato / mono dan LFO dari nilai file');
  if (synN) P2.push(synN + ' GMS / MiniSynth / SuperSaw memakai preset bernama sama di MobileDAW: nilai parameter proyek tersimpan mentah (urutannya di file belum diketahui), bunyi bisa berbeda');
  P2.push('Level bawaan FLM = 0 dB, level lain relatif terhadapnya; waktu, pitch klip dan rasio stretch apa adanya');
  return { json: out, files: [...files.values()], report: { ...report, plugins: [...report.plugins.entries()].map(([name, n]) => ({ name, n })) } };
}
