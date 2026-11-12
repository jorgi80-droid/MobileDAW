// Neutral import model (from .flm / .flp / .als readers) -> MDAW project JSON (the format P.deserialize reads), plus the list of sample files the
// project needs. Nothing is dropped silently:
//   - a plugin MDAW does not have becomes a placeholder device: a neutral Utility (passes the audio through unchanged) carrying
//     d.missing = { name, app, preset, params } so the device card shows "[Plugin tidak tersedia] <name>" and the original data is kept;
//   - an audio clip whose sample is not in the archive keeps its place, length and name and plays a short silent placeholder file;
//   - a DirectWave / sampler instrument whose sample is missing keeps its pattern (notes) and shows the missing program in its card;
//   - a drum pad whose sample is missing keeps its steps (the pad is muted until a sample is loaded).
// Model units: beats, linear gain (1 = default level), pan -1..1.
import { DEVICES, PRESETS, INSTRUMENTS, FLM_FMT } from '../defs.js';
import { gmFor, GM_SF } from './gm.js';
import { flmGain } from './flm.js';
import { ssEnvTime, ssLfoHz, SS_LFO_BEATS } from '../engine/hdsaw.js';

// the channel's instrument -> MDAW: DirectWave layers -> zones of MDAW's DirectWave; a library program that is not in the archive -> the
// closest General MIDI program of the bundled SoundFont; GMS / MiniSynth / SuperSaw -> MDAW's instrument of the same name (preset by name)
const SYNTH_TYPE = { gms: 31, minisynth: 32, supersaw: 33 };   // the FL Studio Mobile instruments of MobileDAW (js/engine/flmsyn.js)
// FL Studio Mobile's DEFAULT patch of each synth, calibrated against the owner's stems ("New Song": the untouched instruments playing an A minor
// chord, rendered by FLM): level of the first 125 ms, octave-band spectrum and the tail after note-off, measured on MobileDAW's render of the same notes.
//   SuperSaw: spectrum already matched (band distance 1.1 dB), FLM is 9.2 dB louder and gates at note-off -> Gain +9.5 dB, Release 3 ms
//   MiniSynth: FLM darker above 2.4 kHz and gated -> Cutoff 80 % (distance 5.2 -> 1.2 dB), Release 3 ms, Level +11.9 dB
//   GMS: release tail matched, FLM 4.5 dB louder -> Level +4.5 dB (its default waveform could not be proven from one chord: left as is)
//   (measured with the notes' real velocity, FLM's default 204 / 255 = 80 %; SuperSaw needs nothing: js/engine/hdsaw.js is FLM's own model)
// Used only when the FLM module has no preset (its own default), so an imported default instrument sounds like FLM's.
const FLM_DEFAULT = { 31: { Level: 4.5 } };   // MiniSynth (32) needs none since js/engine/hdmini.js is FLM's own model: miniFromFlm
// FLM raw parameters whose meaning is PROVEN (owner's "New Song 1" screenshots show the knob values of the MiniSynth preset "Cubed"; the
// "New Song" file gives the defaults): p6 Oscillator Kind (x 9: "Saw + Square" = 3), p7 Modifier (50), p8 Noise (14), p9 Cutoff (64), p10 Kbd Trk,
// p11 Res (49), p12 Vel Trk, p17 Filter env amount (bipolar: 0.6537 -> 30.7). Envelope times have no numbers on screen (curve unknown): not mapped.
// Cutoff follows the default calibration (FLM 100 % sounds like MobileDAW 80 %).
const RAW = {};   // (MiniSynth's partial mapping from screenshots is replaced by miniFromFlm: all 44 values)
// FLM SuperSaw module parameters (normalised 0..1; the layout of Honeydew's supersaw.rs / params registry: [0] Enable, [1] Pulse Width ...
// [59] MW Dest) -> MDAW SuperSaw (33) in FLM's units, with FLM's own laws (envelope time T(x), LFO rate, stepped menus) so the engine
// (js/engine/hdsaw.js, the same model) plays exactly what FLM plays. Every knob of the file is used: no preset guessing.
// FLM MiniSynth module parameters (44 values 0..1, the layout of Honeydew's minisynth.rs PARAMETERS: [0] Enable, [1] Voices Mode,
// [2] Transpose ... [43] PHASER Freq) -> MDAW MiniSynth (32): every knob as FLM stores it (x 100), menus by FLM's own truncation (in
// float, as the module computes them), so the engine (js/engine/hdmini.js, the same model) plays what FLM plays. Level stays 0 dB.
export function miniFromFlm(r) {
  const D = [1, 0, 0.5, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 0.5, 0, 0, 0.25, 0.5, 0, 1, 1, 0.07, 0, 0, 0, 0, 0.7, 0.5, 1, 0.5, 0, 0.25, 0.5, 0.5, 0, 0.1122, 0.4, 0.1, 1, 0.5];
  const v = (k) => Math.fround(r && Number.isFinite(r[k]) ? clamp(r[k], 0, 1) : D[k]), pc = (k) => v(k) * 100, bp = (k) => v(k) * 200 - 100, mi = (k, n) => Math.min(n, Math.trunc(Math.fround(n * v(k)))), on = (k) => (v(k) !== 0 ? 1 : 0);
  return { 0: mi(6, 9), 1: pc(7), 2: pc(8), 3: Math.trunc(Math.fround(v(2) * 24 - 12)), 4: pc(9), 5: pc(11), 6: pc(12), 7: pc(10), 8: pc(13), 9: pc(14), 10: v(15), 11: pc(16), 12: bp(17),
    13: bp(21), 14: mi(20, 11), 15: mi(18, 2), 16: mi(19, 2), 17: pc(5), 18: mi(4, 2), 19: pc(22), 20: pc(23), 21: v(24), 22: pc(25), 23: mi(1, 2), 24: pc(3),
    25: on(26), 26: pc(27), 27: pc(28), 28: on(29), 29: pc(31), 30: pc(32), 31: pc(33), 32: mi(30, 3), 33: on(34), 34: pc(35), 35: pc(36), 36: pc(37),
    37: on(38), 38: pc(39), 39: pc(40), 40: pc(41), 41: pc(43), 42: pc(42), 43: 0 };
}
const SYNC_B = [32, 16, 8, 4, 2, 1, 0.75, 0.5, 1 / 3, 0.25, 1 / 6, 0.125];
export function ssFromFlm(r) {
  const v = (k, d) => (r && Number.isFinite(r[k]) ? clamp(r[k], 0, 1) : d), t = (x) => Math.max(0.001, Math.round(ssEnvTime(x) * 1e5) / 1e5), pc = (x) => Math.round(x * 1e4) / 100, bp = (x) => Math.round((2 * x - 1) * 1e4) / 100;
  const tr = Math.trunc, out = {};
  const D = [0, 1, 0, 0, 0, 0.2, 0, 0.5, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0.5, 0, 1, 0, 0, 0, 1, 1, 1, 0.5, 0, 0, 1, 1, 0, 1, 0.5, 0, 0, 0.5, 0.1, 1, 0, 0, 0, 0, 0, 0.5, 0, 0, 0.2, 0.5, 0, 0, 0.5, 0, 1, 0.775, 0.4, 0, 0.5, 0.5, 0];
  const x = (k) => v(k, D[k]);
  out[0] = x(2) > 0.5 ? 1 : 0; out[1] = x(10) > 0.5 ? 1 : 0; out[2] = x(8) !== 0 ? 1 : 0; out[3] = pc(x(1)); out[4] = pc(x(3));
  out[5] = Math.min(12, tr(x(4) * 11 + 1)) - 1; out[6] = pc(x(5)); out[7] = pc(x(6)); out[8] = pc(x(7)); out[9] = pc(x(9));
  out[10] = pc(x(11)); out[11] = pc(x(12)); out[12] = t(x(13)); out[13] = t(x(14)); out[14] = x(15); out[15] = t(x(16)); out[16] = bp(x(17)); out[17] = x(18) > 0.5 ? 1 : 0;
  out[18] = pc(x(19)); out[19] = pc(x(20)); out[20] = pc(x(21)); out[21] = pc(x(27)); out[22] = t(x(22)); out[23] = t(x(23)); out[24] = x(24); out[25] = t(x(25)); out[26] = bp(x(26));
  out[27] = Math.min(2, tr(2 * x(41))); out[28] = Math.round(ssLfoHz(x(40)) * 1e4) / 1e4; out[29] = SYNC_B.indexOf(SS_LFO_BEATS[Math.min(9, tr(9 * x(42)))]);
  out[30] = Math.min(3, tr(x(39) * 3 + 0.5)); out[31] = t(x(46)); out[32] = bp(x(44)); out[33] = Math.min(7, tr(x(45) * 7 + 0.5));
  out[34] = pc(x(32)); out[35] = bp(x(33)); out[36] = t(0.9 * x(28)); out[37] = t(x(29)); out[38] = x(30); out[39] = t(0.85 * x(31) + 0.05);
  out[40] = tr(x(37) * 11 + 1); out[41] = bp(x(58)); out[42] = Math.min(8, tr(8 * x(59))); out[43] = Math.min(8, tr(x(51) * 7 + 1)); out[44] = tr(24 * x(36)) - 12;
  out[45] = Math.round(Math.pow(0.5 * x(35), 2) * 1e5) / 1e5; out[46] = x(34) !== 0 ? 1 : 0; out[47] = x(38) > 0.5 ? 1 : 0; out[48] = x(50) !== 0 ? 1 : 0;
  out[49] = Math.min(5, tr(5 * x(47))); out[50] = Math.min(3, tr(3 * x(48))); out[51] = Math.min(5, tr(5 * x(49)));
  out[52] = pc(x(52)); out[53] = Math.round((18 * x(53) - 18) * 100) / 100; out[54] = Math.min(4, tr(4 * x(54))); out[55] = pc(x(55)); out[56] = pc(x(57)); out[57] = pc(x(56));
  return out;
}
const byName = (type, o) => { const out = {}; for (const [n, v] of Object.entries(o || {})) { const k = INSTRUMENTS[type].params.findIndex((q) => q.n === n); if (k >= 0) out[k] = v; } return out; };
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
  return L.find((p) => p.name.toLowerCase() === n) || L.find((p) => n.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(n)) || null   // no single-word guess: "Lead Super" must not become "EDM Lead";
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
      const dflt = !pr && !(I.preset && I.preset !== 'Default');                  // FLM's own default patch: the stem-calibrated equivalent
      note(INSTRUMENTS[type].name + (pr ? ' (preset ' + pr.name + ')' : dflt ? ' (setelan awal FLM, dikalibrasi dari stem)' : ' (preset FLM "' + String(I.preset).replace(/\.\w+$/, '').replace(/^.*\//, '') + '" belum ada di MobileDAW: setelan awal)'), pr ? 'preset' : 'default');
      if (type === 33 && (I.params || []).length >= 58) {   // SuperSaw: every knob of the file, exactly (Honeydew's layout and laws)
        const n = report.instruments[report.instruments.length - 1]; n.to = 'SuperSaw (semua nilai knob dari file FLM)'; n.how = 'exact';
        return { type, params: ssFromFlm(I.params), pitch: 0, from: { app: M.app, name: I.name, preset: I.preset || '', params: I.params || [] } };
      }
      if (type === 32 && (I.params || []).length >= 44) {   // MiniSynth: every knob of the file, exactly (Honeydew's layout and laws)
        const n = report.instruments[report.instruments.length - 1]; n.to = 'MiniSynth (semua nilai knob dari file FLM)'; n.how = 'exact';
        return { type, params: miniFromFlm(I.params), pitch: 0, from: { app: M.app, name: I.name, preset: I.preset || '', params: I.params || [] } };
      }
      const raw = !pr && !dflt && RAW[type] && (I.params || []).length === 44 ? RAW[type](I.params) : null;   // proven knobs of an FLM preset that MobileDAW does not have
      if (raw) { const n = report.instruments[report.instruments.length - 1]; n.to = n.to.replace(': setelan awal)', ': osc / filter dari nilai file, sisanya setelan awal)'); }
      return { type, params: pr ? { ...pr.p } : dflt ? byName(type, FLM_DEFAULT[type]) : raw ? byName(type, raw) : {}, pitch: 0, from: { app: M.app, name: I.name, preset: I.preset || '', params: I.params || [] } };
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
  // FLM pads keep FLM's own envelope: the four sliders as they are, played by the drum engine's FLM model (pad eg 1, Honeydew drums.rs);
  // other sources (no sliders) play the sample through
  const padEnv = (e) => (e && [e.a, e.d, e.s, e.r].every(Number.isFinite) ? { a: clamp(e.a, 0, 1), d: clamp(e.d, 0, 1), s: clamp(e.s, 0, 1), r: clamp(e.r, 0, 1), eg: 1 } : { a: 0, d: 0, s: 1, r: 0 });
  const vol = (g) => clamp(Number.isFinite(g) ? g : 1, 0, VMAX);   // model gain 1 = the source app's default level = 0 dB in MDAW
  const util = DEVICES[0].params.map((q) => q.def);
  // a level above MDAW's fader top (+2.9 dB; FLM goes to +6 dB): the rest as a Utility Gain at the end of the strip's chain (FLM's fader is
  // after its effects too), so nothing of the mix is lost
  // g = the fader level, k = the gain of the strip's main output send (FLM routes a channel only through its sends, post fader): what the
  // fader cannot hold (above +2.9 dB) and a main send level other than 0 dB go into one Utility Gain at the end of the chain (all linear
  // after the effects, so the sum is the same and the fader / its automation stay exactly FLM's)
  const over = (strip, g, k = 1) => { const x = (g > VMAX ? g / VMAX : 1) * k; if (Math.abs(x - 1) < 1e-6 || strip.devices.length >= 16) return; const p = util.slice(); p[0] = Math.max(-60, Math.round(20 * Math.log10(Math.max(1e-6, x)) * 1000) / 1000); strip.devices.push({ id: uid(), type: 0, params: p, bypass: false }); if (g > VMAX) report.levelOver = (report.levelOver || 0) + 1; if (k !== 1) report.sendTrim = (report.sendTrim || 0) + 1; };
  // FLM sends -> MDAW routing: the main path is the master send when on, else the first bus send (the strip's Output then goes to that
  // effect track); the other bus sends become Send A / B (relative to the main gain, MDAW's sends are post fader too); no send on = silent
  const busIdx = new Map();
  const routeOf = (ch, name) => {
    const ss = ch.sends || [], on = ss.filter((q) => q.on);
    if (!ss.length) return { out: -1, k: 1, send: [0, 0], mute: false };
    const mainS = on.find((q) => q.target === 0) || on.find((q) => busIdx.has(q.target));
    if (!mainS) { report.skipped.push('"' + name + '": semua send FLM mati (channel diam di FLM): track dibisukan'); return { out: -1, k: 1, send: [0, 0], mute: true }; }
    const r = { out: mainS.target === 0 ? -1 : busIdx.get(mainS.target), k: mainS.gain, send: [0, 0], mute: false };
    for (const q of on) {
      if (q === mainS) continue;
      const b = busIdx.get(q.target);
      if (b === 0 || b === 1) r.send[b] = clamp(mainS.gain > 0 ? q.gain / mainS.gain : 0, 0, 1.5);
      else report.skipped.push('"' + name + '": send ke ' + (q.target === 0 ? 'Master' : 'bus #' + q.target) + ' (MobileDAW: satu output + Send A/B)');
    }
    return r;
  };
  const placeholder = (m) => {
    report.plugins.set(m.name, (report.plugins.get(m.name) || 0) + 1);
    return { id: uid(), type: 0, params: util.slice(), bypass: m.enabled === false, missing: { name: m.name, app: m.app || M.app, preset: m.preset || '', enabled: m.enabled !== false, ...(m.flmType != null ? { flmType: m.flmType } : {}), ...(m.sure === false ? { sure: false } : {}), ...(m.mix != null ? { mix: m.mix } : {}), ...(m.id != null ? { flmId: m.id } : {}), params: (m.params || []).slice() } };
  };
  const devices = (ch) => (ch.modules || []).slice(0, 16).map(placeholder);
  const prec = { offGrid: 0, boost: 0 };                                     // precision report: values kept that a rounding would have changed
  const notesOf = (cl, map) => (cl.notes || []).map((n) => { const t = Math.max(0, T(n.t)), d = Math.max(1 / 64, T(n.len)); if (t % 1 || d % 1) prec.offGrid++; if (n.vel > 1) prec.boost++; return { t, d, p: map ? map(n.pitch) : clamp(Math.round(n.pitch), 0, 127), v: clamp(n.vel ?? 0.8, 0.001, 2), ...(n.pan ? { pan: clamp(n.pan, -1, 1) } : {}), ...(n.slide ? { sl: true } : {}), ...(n.repeat > 0 ? { rpt: Math.min(8, n.repeat + 1) } : {}), ...(n.pitchOfs ? { pt: clamp(Math.round(n.pitchOfs * 1000) / 1000, -24, 24) } : {}) }; }).filter((n) => n.p >= 0 && n.p <= 127);
  const patternClip = (cl, notes, name) => {
    const c = { id: uid(), start: Math.max(0, T(cl.pos)), len: Math.max(1, T(cl.len)), name: name || '', notes, cm: true };
    const cyc = T(cl.cycle || 0);
    if (cyc > 0) { c.ll = cyc; c.lp = ((T(cl.offset || 0) % cyc) + cyc) % cyc; c.pb = cyc; }
    if (cl.muted) c.muted = true;
    report.clips++; report.notes += notes.length;
    return c;
  };

  const out = { v: 2, flm: FLM_FMT, name: M.name, bpm: clamp(M.bpm || 120, 20, 300), sig: { n: M.sig ? M.sig[0] : 4, d: M.sig ? M.sig[1] : 4 }, sigs: [], markers: [], groove: { amt: 0, grid: 240 }, countIn: 0,
    punch: { on: false, start: 0, end: 0 }, recLoop: false, loop: { on: false, start: 0, end: 7680 }, tracks: [], master: { vol: 1, devices: [] }, returns: [], cc: {}, imported: { app: M.app } };
  const spb = 60 / out.bpm;
  const master = M.channels.find((c) => c.kind === 'master');
  if (master) { out.master.vol = vol(master.gain); out.master.devices = devices(master); over(out.master, master.gain); }
  for (const b of M.channels.filter((c) => c.kind === 'bus')) {
    if (out.returns.length >= MAX_FX) { report.skipped.push('Bus efek "' + b.name + '": jumlah return maksimum ' + MAX_FX); continue; }
    if (b.number != null) busIdx.set(b.number, out.returns.length);
    out.returns.push({ name: b.name, vol: vol(b.gain), pan: clamp(b.pan || 0, -1, 1), ...(M.app === 'FL Studio Mobile' ? { panLaw: 'flm' } : {}), mute: !!b.mute, devices: devices(b) });
  }
  // a bus plays to the master (bus to bus is not in MDAW: reported); its master send level joins the Utility trim
  for (const b of M.channels.filter((c) => c.kind === 'bus')) {
    const k = busIdx.get(b.number); if (k == null) continue; const R = out.returns[k], ss = b.sends || [], on = ss.filter((q) => q.on), m = on.find((q) => q.target === 0);
    for (const q of on) if (q.target !== 0) report.skipped.push('Bus efek "' + b.name + '": send ke bus #' + q.target + ' (bus ke bus belum ada di MobileDAW)');
    if (ss.length && !m) { R.mute = true; report.skipped.push('Bus efek "' + b.name + '": send ke Master mati: dibisukan'); }
    over(R, b.gain, m ? m.gain : 1);
  }
  while (out.returns.length < 2) out.returns.push({ name: 'Return ' + 'AB'[out.returns.length], vol: DEF_VOL, pan: 0, mute: false, devices: [] });

  const autoLater = [];
  let ci = 0;
  for (const ch of M.channels.filter((c) => c.kind === 'track')) {
    const color = ch.color || hueColor(ch.hue, ci++), subs = ch.tracks.filter((t) => t.kind !== 'automation');
    const firstId = [];
    (subs.length ? subs : [{ kind: ch.instrument ? 'notes' : ch.pads.length ? 'drums' : 'audio', clips: [] }]).forEach((st, k) => {
      if (out.tracks.length >= MAX_TRACKS) { report.skipped.push('Track "' + ch.name + '": jumlah track maksimum'); return; }
      const split = new Map();
      const t = { id: uid(), name: subs.length > 1 && k > 0 ? `${ch.name} (${k + 1})` : ch.name, color, kind: 'audio', inst: null, clips: [], devices: devices(ch), vol: vol(ch.gain), pan: clamp(ch.pan || 0, -1, 1), mute: !!ch.mute, solo: false, send: [0, 0], out: -1 };
      const rt = routeOf(ch, t.name); t.out = rt.out; t.send = rt.send; if (rt.mute) t.mute = true;
      over(t, ch.gain, rt.k); if (M.app === 'FL Studio Mobile') t.panLaw = 'flm';   // FLM's balance pan law (Honeydew mixer.rs), kept for this track
      if (st.kind === 'notes') {
        t.kind = 'midi';
        t.inst = instrumentOf(ch.instrument, t.name);
        for (const cl of st.clips) t.clips.push(patternClip(cl, notesOf(cl)));
      } else if (st.kind === 'drums') {
        t.kind = 'drum';
        const pads = (ch.pads || []).slice(0, MAX_PADS).map((q, k2) => {
          const f = q.path ? sample(q.path, q.name) : null;
          return { pitch: 36 + k2, name: (q.name || 'Pad ' + (k2 + 1)).slice(0, 14), kind: -1, sample: f && !f.missing ? { path: f.path, name: f.path.split('/').pop() } : null, gain: clamp(20 * Math.log10(Math.max(1e-4, q.gain ?? 1)), -60, 12), pan: clamp(q.pan || 0, -1, 1), pit: clamp(q.pitch || 0, -24, 24), dec: 1, start: 0, end: 1, rev: false, ...padEnv(q.env), mute: !!(f && f.missing) || !!q.mute, solo: !!q.solo, rev: !!q.reverse, cut: clamp(q.cut | 0, 0, 3), poly: q.poly !== false,
            ...(q.startSec ? { flmSt: q.startSec } : {}), ...(q.length > 0 ? { flmLen: q.length } : {}) };   // FLM Sample Start (s) / Length (fraction): resolved against the sample's duration when it loads (project.js)
        });
        t.inst = { type: 3, params: {}, pads: pads.length ? pads : undefined };
        const map = pads.length ? (p) => (p >= 0 && p < pads.length ? pads[p].pitch : -1) : (p) => 36 + p;
        const ofs = (ch.pads || []).slice(0, MAX_PADS).map((q) => (Number.isFinite(q.offset) ? q.offset : 0));
        // a pad whose LINk sends it to an effect bus plays into that bus, past the channel's effects and fader: per bus, a copy of the kit
        // track (same hits, so cut groups still choke inside it) with only those pads audible, its Output on that effect track; the pads
        // are muted in the channel's own track
        (ch.pads || []).slice(0, pads.length).forEach((q, k2) => { const b = q.send > 0 ? busIdx.get(q.send) : null; if (b == null) return; if (!split.has(b)) split.set(b, []); split.get(b).push(k2); });
        for (const cl of st.clips) { const ns = notesOf(cl, map); if (ofs.some(Boolean)) { const byPitch = new Map(pads.map((q, k2) => [q.pitch, ofs[k2]])); for (const n of ns) { const o = byPitch.get(n.p) || 0; if (o) n.t = Math.max(0, Math.round(n.t + o * PPQ)); } } t.clips.push(patternClip(cl, ns)); }   // FLM pad Shift: hit at tick + offset beats
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
          if (Math.abs(cl.pan || 0) > 1e-6) { c.pan = clamp(cl.pan, -1, 1); prec.clipPan = (prec.clipPan || 0) + 1; }   // the clip's own pan, as in FL Studio Mobile (balance on top of the track pan)
          if (cl.env) prec.clipEnv = (prec.clipEnv || 0) + 1;
          if (f.missing) c.missing = { sample: cl.sample };
          t.clips.push(c); report.clips++;
        }
      }
      out.tracks.push(t); report.tracks++; firstId.push(t.id);
      for (const [b, ks] of split) {
        if (out.tracks.length >= MAX_TRACKS) { report.skipped.push('Pad "' + ch.name + '" ke ' + out.returns[b].name + ': jumlah track maksimum'); break; }
        const pads2 = t.inst.pads.map((q, k2) => ({ ...q, mute: ks.includes(k2) ? q.mute : true }));
        for (const k2 of ks) t.inst.pads[k2].mute = true;
        const t2 = { ...t, id: uid(), name: (t.name + ' → ' + out.returns[b].name).slice(0, 40), devices: [], vol: 1, pan: 0, mute: t.mute, send: [0, 0], out: b, inst: { ...t.inst, pads: pads2 }, clips: t.clips.map((c) => ({ ...c, id: uid(), notes: c.notes.map((n) => ({ ...n })) })) };
        out.tracks.push(t2); report.tracks++; report.padRoute = (report.padRoute || 0) + ks.length;
      }
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
      const len = Math.max(1, T(cl.len)), pts = (cl.points || []).map((q) => ({ t: clamp(T(q.t), 0, len), v: clamp(vol(flmGain(q.v || 0)) / VMAX, 0, 1) })).sort((a, b) => a.t - b.t);
      if (!pts.length) continue;
      if (pts.length === 1) pts.push({ t: len, v: pts[0].v });
      t.clips.push({ id: uid(), start: Math.max(0, T(cl.pos)), len, name: '', pts }); report.clips++;
    }
    if (t.clips.length) { out.tracks.push(t); report.tracks++; }
  }
  if (master) for (const at of master.tracks.filter((x) => x.kind === 'automation' && x.clips.length)) {   // Master level automation -> a lane on the master strip
    if (!at.target || at.target.kind !== 'volume' || out.tracks.length >= MAX_TRACKS) { report.skipped.push(`Otomasi "${at.label || '?'}" di Master: targetnya plugin / tidak tersedia`); continue; }
    const t = { id: uid(), name: 'Auto: Master \u2022 Volume', color: '#9fb4d8', kind: 'auto', inst: null, clips: [], devices: [], vol: DEF_VOL, pan: 0, mute: false, solo: false, send: [0, 0],
      target: { kind: 0, strip: 'master', param: 0, def: { n: 'Volume', min: 0, max: VMAX, fmt: 'gain' } } };
    for (const cl of at.clips) {
      const len = Math.max(1, T(cl.len)), pts = (cl.points || []).map((q) => ({ t: clamp(T(q.t), 0, len), v: clamp(vol(flmGain(q.v || 0)) / VMAX, 0, 1) })).sort((x, y) => x.t - y.t);
      if (!pts.length) continue;
      if (pts.length === 1) pts.push({ t: len, v: pts[0].v });
      t.clips.push({ id: uid(), start: Math.max(0, T(cl.pos)), len, name: '', pts }); report.clips++;
    }
    if (t.clips.length) { out.tracks.push(t); report.tracks++; }
  }
  if (needSf) out.needsSoundFont = GM_SF;
  const P2 = report.precision = [];
  if (prec.offGrid) P2.push(prec.offGrid + ' not di luar grid MobileDAW (1/128 ketuk FLM = 7,5 tick) disimpan di posisi persisnya, tanpa pembulatan');
  if (prec.boost) P2.push(prec.boost + ' not dengan velocity di atas 100 % (boost) dipertahankan, tidak dipotong');
  const dwN = report.instruments.filter((x) => /^DirectWave \(/.test(x.to)).length, synN = report.instruments.filter((x) => x.how === 'preset' || x.how === 'default').length;
  if (prec.clipPan) P2.push(prec.clipPan + ' klip audio punya pan sendiri di file asli: dipakai sebagai pan klip (balance)');
  if (report.padRoute) P2.push(report.padRoute + ' pad drum FLM dikirim ke bus efek (AUX): diputar dari salinan track kit yang Output-nya ke track efek itu, pad-nya dibisukan di track asal');
  if (report.sendTrim) P2.push(report.sendTrim + ' strip punya level send FLM ke output utama selain 0 dB: dipasang sebagai Utility di akhir rantainya');
  if (report.levelOver) P2.push(report.levelOver + ' strip punya level FLM di atas +2,9 dB (batas fader MobileDAW): sisa gain dipasang sebagai Utility di akhir rantainya');
  if (prec.clipEnv) P2.push(prec.clipEnv + ' klip audio punya envelope (A / D / S / R) sendiri di file asli: belum diterapkan');
  const muted = M.channels.filter((c) => c.kind !== 'master' && c.mute).map((c) => c.name);
  if (muted.length) P2.push(muted.length + ' track di-mute seperti di FLM: ' + muted.join(', '));
  const solo = M.channels.filter((c) => c.solo).map((c) => c.name);
  if (solo.length) P2.push(solo.length + ' track ditandai Solo di file FLM (RPRM): tidak diterapkan otomatis karena byte ini belum terbukti di proyek lain — ' + solo.join(', '));
  const pg = []; for (const c of M.channels) for (const m of c.modules || []) { if (m.postGain != null) pg.push(c.name + ' / ' + m.name + ' Post Gain'); if (m.wetPan != null) pg.push(c.name + ' / ' + m.name + ' Wet Pan'); }
  if (pg.length) P2.push(pg.length + ' modul punya Post Gain / Wet Pan non-default (SMPR): dilaporkan, belum ada padanan persisnya — ' + pg.slice(0, 6).join(', ') + (pg.length > 6 ? ', …' : ''));
  if (dwN) P2.push(dwN + ' DirectWave: pitch / fine tune per lapisan, envelope, filter, loop / reverse / legato / mono dan LFO dari nilai file');
  if (synN) P2.push(synN + ' GMS / MiniSynth / SuperSaw memakai preset bernama sama di MobileDAW: nilai parameter proyek tersimpan mentah (urutannya di file belum diketahui), bunyi bisa berbeda');
  P2.push('Level bawaan FLM = 0 dB, level lain relatif terhadapnya; waktu, pitch klip dan rasio stretch apa adanya');
  return { json: out, files: [...files.values()], report: { ...report, plugins: [...report.plugins.entries()].map(([name, n]) => ({ name, n })) } };
}
