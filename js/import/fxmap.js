// Migration of imported modules MDAW does not have to MDAW stock plugins (FL Studio Mobile modules first; names / parameters from the
// FL Studio Mobile FX guide supplied by the owner + what real projects store). Two levels:
//   'map' (done during import): only conversions that keep the sound — parameter layouts that are verified (Graphic EQ, Leveller, Spacer
//          at its neutral default), modules that were OFF in the source (-> the stock equivalent, bypassed: identical sound), and modules
//          that do not change audio (Analyzer, Tuner).
//   'all' (the "replace every missing module" option): additionally every other module that has a stock equivalent becomes that stock
//          plugin BYPASSED (the sound stays exactly as it is now; the plugin is ready to switch on and adjust), keeping the original values.
// Modules with no MDAW equivalent (Pitcher 2, Multi FX, Comb Filter) and unidentified types stay placeholders and are reported.
import { DEVICES, normOf } from '../defs.js';

// FL Studio Mobile module type ids -> module (guide names). sure: the identity is proven by data in real projects (preset folder, automation
// label) or by an unambiguous parameter layout; the rest of the 30 guide modules are matched by name when a project names them.
export const FLM_TYPES = {
  1: { name: 'DirectWave', sure: true },
  7: { name: 'Graphic EQ', sure: true },              // on/off + 8 band gains (0.5 = 0 dB): the guide's 8-band Graphic EQ (80 Hz .. 12 kHz)
  8: { name: 'Compressor', sure: true },              // preset folder Effect Presets/Compressor
  20: { name: 'Leveller', sure: true },               // automation label "Gain : FX Leveller"; params on/off, gain, pan
  29: { name: 'Autoduck', sure: true },               // preset folder Effect Presets/Autoduck2
  34: { name: 'Spacer', sure: true },                 // preset folder Effect Presets/Spacer
  36: { name: 'Multiband Compressor', sure: true },   // on/off + 3 identical band groups (Low / Mid / High) + master group
  43: { name: 'Wow & Flutter', sure: true },          // preset folder Effect Presets/Wow & Flutter
  6: { name: 'Distortion', sure: true },              // preset folder Effect Presets/Distortion (2nd owner project)
  15: { name: 'Stereoizer', sure: true },             // preset folder Effect Presets/Stereoizer
  32: { name: 'Reverb', sure: true },                 // preset folder Effect Presets/Reverb; MAIN Decay / High Damp / Mix / Early Refl. / Room Size, MIXER Wet / Dry / Rev Pan
  35: { name: 'Reverb 2', sure: true },               // preset folder Effect Presets/Reverb 2
  42: { name: 'Tape Stop', sure: true },              // automation label "Toggle Play : Tape Stop"
  46: { name: 'Tremolo', sure: true },                // preset folder Effect Presets/Tremolo; automation label "Mix : Tremolo"
  2: { name: 'GMSynth', sure: true, synth: 'gms' },   // preset Synth Presets2/GMSynth/*.flgsynth
  23: { name: 'SuperSaw', sure: true, synth: 'supersaw' },   // preset Synth Presets2/SuperSaw/*
  52: { name: 'SoundFont Player', sure: true, synth: 'soundfont' },   // preset = Resources/SoundFonts/*.sf2 (FLM content, not in the project)
  11: { name: 'Tape Delay', sure: false },            // on/off + 4 controls = the guide's Tape Delay (Time, Fdbk, Asym, Mix): layout match only
  25: { name: 'Waveshaper', sure: false },            // custom curve data + 22 controls (Shape / Amp / EQ / LFO pages): layout match only
  // 44 (on/off + 4) was guessed as Stereoizer: the 2nd project names 15 Stereoizer, so 44 is unknown again
};
// guide module -> MDAW stock plugin with the same function (null = MobileDAW has nothing equivalent)
export const STOCK = {
  'Analyzer': 32, 'Autoduck': 22, 'Pitcher 2': null, 'Chorus': 20, 'Comb Filter': null, 'Compressor': 4, 'Distortion': 3, 'Parametric EQ': 31,
  'Filter': 1, 'Flanger': 21, 'Gate': 23, 'Graphic EQ': 31, 'Tuned EQ': 31, 'Leveller': 0, 'Limiter': 5, 'Multi FX': null, 'Multiband Compressor': 38,
  'Phaser': 21, 'Reverb': 7, 'Reverb 2': 7, 'Spacer': 0, 'Spreader': 0, 'Stereoizer': 0, 'Tape Delay': 6, 'Tape Stop': 52, 'Trance Delay': 17,
  'Tremolo': 22, 'Tuner': 30, 'Waveshaper': 3, 'Wow & Flutter': 20,
  'DirectWave': null,                                 // FLM DirectWave modules become the track's DirectWave zones (flm.js); never an effect
};
const ALIAS = { 'FX Leveller': 'Leveller', 'Param EQ': 'Parametric EQ', 'Equalizer': 'Parametric EQ', 'MultiFX': 'Multi FX', 'Stereorizer': 'Stereoizer', 'Autoduck2': 'Autoduck' };
export const moduleName = (x) => { const n = String(x || '').replace(/^FX\s+/, '').replace(/\s*\(.*\)$/, '').trim(); return ALIAS[n] || ALIAS['FX ' + n] || n; };
const NEUTRAL_SPACER = [0.5, 0.5, 0.5, 0, 0.5, 0, 0];
const GEQ_FREQ = [80, 160, 375, 750, 1500, 3000, 6000, 12000], GEQ_RANGE = 12;   // dB at the slider ends (the guide shows no numbers: kept moderate)
const defaults = (type) => DEVICES[type].params.map((q) => q.def);
const near = (a, b, e = 0.004) => Math.abs(a - b) <= e;

// m = device.missing (name, app, params, flmType?) -> decision
//   { apply: true, type, params, bypass, how: 'exact' | 'approx' | 'off' | 'later', note } | { apply: false, why: 'none' | 'unknown' | 'layout', stock }
export function decide(m, mode = 'map') { return withMix(m, decide0(m, mode)); }
// FLM module level / mix (SMPR, < 1 = part dry): the stock plugin's Dry/Wet / Mix, or for Utility / EQ Eight the equivalent blend of dry and
// processed level (1 - mix + mix * gain; exact for Utility, per band for the EQ)
function withMix(m, r) {
  const mix = m.mix;
  if (!r.apply || r.bypass || mix == null || !(mix < 0.999)) return r;
  const ps = DEVICES[r.type].params, q = (r.params && r.params.length ? r.params : defaults(r.type)).slice(), pct = Math.round(mix * 100);
  const blend = (db) => Math.round(20 * Math.log10(Math.max(1e-4, 1 - mix + mix * Math.pow(10, db / 20))) * 100) / 100;
  const k = ps.findIndex((x) => /^(Dry\/Wet|Mix)$/.test(x.n));
  if (k >= 0) { q[k] = (Number.isFinite(q[k]) ? q[k] : ps[k].def) * mix; return { ...r, params: q, note: r.note + `; mix modul ${pct} %` }; }
  if (r.type === 0) { q[0] = blend(q[0] || 0); return { ...r, params: q, note: r.note + `; mix modul ${pct} % (gain gabungan)` }; }
  if (r.type === 31) { for (let b = 0; b < 8; b++) q[b * 5 + 3] = blend(q[b * 5 + 3] || 0); return { ...r, params: q, how: r.how === 'exact' ? 'exact' : 'approx', note: r.note + `; mix modul ${pct} % (per band)` }; }
  return { ...r, how: r.how === 'exact' ? 'approx' : r.how, note: r.note + `; mix modul ${pct} % tidak ada padanannya` };
}
function decide0(m, mode) {
  const nm = moduleName(m.name), stock = Object.prototype.hasOwnProperty.call(STOCK, nm) ? STOCK[nm] : undefined, p = m.params || [];
  const on = !(p.length && p[0] < 0.5) && m.enabled !== false;
  if (stock === undefined) return { apply: false, why: 'unknown' };
  if (stock === null) return { apply: false, why: 'none' };
  if (!DEVICES[stock]) return { apply: false, why: 'none' };
  const base = defaults(stock);
  if (!on) return { apply: true, type: stock, params: base, bypass: true, how: 'off', note: 'off di proyek asli: plugin stock dipasang dalam keadaan bypass (suara sama)' };
  if (m.sure === false) return mode === 'all' ? { apply: true, type: stock, params: base, bypass: true, how: 'later', note: 'identitas modul diduga dari tata letak parameter: dipasang bypass, aktifkan bila cocok (nilai asli tersimpan)' } : { apply: false, why: 'layout', stock };
  if (nm === 'Analyzer' || nm === 'Tuner') return { apply: true, type: stock, params: base, bypass: false, how: 'exact', note: 'alat ukur, tidak mengubah audio' };
  if (nm === 'Graphic EQ' && p.length >= 9) {
    const q = base.slice(); let flat = true;
    GEQ_FREQ.forEach((f, k) => { const g = Math.max(-15, Math.min(15, (p[1 + k] - 0.5) * 2 * GEQ_RANGE)); if (Math.abs(g) > 0.05) flat = false; const o = k * 5; q[o] = 1; q[o + 1] = 3; q[o + 2] = f; q[o + 3] = Math.round(g * 100) / 100; q[o + 4] = 1.41; });
    return { apply: true, type: 31, params: q, bypass: false, how: flat ? 'exact' : 'approx', note: flat ? 'semua band 0 dB' : `8 band bell 80 Hz - 12 kHz, gain dari slider (rentang +-${GEQ_RANGE} dB)` };
  }
  if (nm === 'Leveller' && p.length >= 3) {
    const lin = Math.pow(Math.max(1e-4, p[1]) / 0.7071, 2), db = Math.max(-60, Math.min(24, 20 * Math.log10(lin))), pan = Math.max(-1, Math.min(1, (p[2] - 0.5) * 2));
    const q = base.slice(); q[0] = Math.round(db * 100) / 100; q[1] = Math.round(pan * 1000) / 1000;
    return { apply: true, type: 0, params: q, bypass: false, how: near(p[1], 0.7071) && near(p[2], 0.5) ? 'exact' : 'approx', note: `gain ${q[0] >= 0 ? '+' : ''}${q[0].toFixed(1)} dB, pan ${q[1].toFixed(2)}` };
  }
  if (nm === 'Tape Stop' && p.length >= 6) {                                  // Play = param 5 (automation label "Toggle Play"); times = FLM defaults (1 beat / 1/2)
    const q = base.slice(); q[0] = p[5] > 0.5 ? 1 : 0;
    return { apply: true, type: 52, params: q, bypass: false, how: q[0] ? 'exact' : 'approx', note: 'Play dari proyek (diotomasi lewat Toggle Play); waktu start 1 beat / stop 1/2 beat seperti bawaan FLM' };
  }
  if (nm === 'Spacer' && p.length >= 8 && NEUTRAL_SPACER.every((v, k) => near(p[k + 1], v))) return { apply: true, type: 0, params: base, bypass: false, how: 'exact', note: 'pengaturan netral (Nothing / off / Center / Standard)' };
  if (mode === 'all') return { apply: true, type: stock, params: base, bypass: true, how: 'later', note: 'parameter asli belum bisa dikonversi: dipasang bypass, aktifkan dan atur sesuai telinga (nilai asli tersimpan)' };
  return { apply: false, why: 'layout', stock };
}

// Apply to an MDAW project JSON (import path). Returns the summary; onProgress(fraction) while it works.
export async function migrateJson(json, mode = 'map', onProgress = () => {}) {
  const chains = [json.master, ...(json.returns || []), ...(json.tracks || [])].filter(Boolean);
  const all = []; for (const c of chains) for (const d of c.devices || []) if (d.missing) all.push(d);
  const S = summary();
  for (let k = 0; k < all.length; k++) {
    const d = all[k], r = decide(d.missing, mode);
    count(S, d.missing, r);
    if (r.apply) { const from = d.missing; delete d.missing; d.type = r.type; d.params = fill(r.type, r.params); d.bypass = !!r.bypass; d.from = { ...from, how: r.how, note: r.note }; }
    if (k % 8 === 7) { onProgress((k + 1) / all.length); await new Promise((res) => setTimeout(res, 0)); }
  }
  onProgress(1);
  return S;
}
export const fill = (type, params) => { const q = defaults(type); (params || []).forEach((v, k) => { if (Number.isFinite(v) && k < q.length) q[k] = v; }); return q; };
export function summary() { return { total: 0, exact: 0, approx: 0, off: 0, later: 0, notApplied: 0, none: new Map(), unknown: new Map(), layout: new Map() }; }
export function count(S, m, r) {
  S.total++;
  const nm = String(m.name || '?').replace(/^FX\s+/, ''), add = (map) => map.set(nm, (map.get(nm) || 0) + 1);   // the name as the project shows it
  if (r.apply) S[r.how]++; else { S.notApplied++; add(S[r.why]); }
}
export function describe(S) {
  const applied = S.exact + S.approx + S.off + S.later, list = (m) => [...m.entries()].map(([n, c]) => n + (c > 1 ? ' ×' + c : ''));
  return {
    applied, notApplied: S.notApplied,
    lines: [
      `${applied} dari ${S.total} modul diterapkan ke plugin stock MobileDAW` + (applied ? ` (${S.exact} persis, ${S.approx} perkiraan, ${S.off} yang off di proyek asli` + (S.later ? `, ${S.later} dipasang bypass untuk diatur` : '') + ')' : '') + '.',
      S.notApplied ? `${S.notApplied} modul tidak diterapkan.` : 'Semua modul diterapkan.',
    ],
    none: list(S.none), unknown: list(S.unknown), layout: list(S.layout),
  };
}

// FLM plugin automation (build.js leaves device lanes with flmAuto = { param, label }): once the modules are converted, point each lane at
// the stock plugin's parameter — module mix (32705) -> Dry/Wet / Mix, Tape Stop "Toggle Play" (5) -> Play (stepped, starting from the module's
// value). Lanes whose module stayed a placeholder or has no matching parameter are removed and reported (nothing changes the sound silently).
export const FLM_MIX_PARAM = 32705;
export function resolveFlmAutomation(json, report) {
  const all = json.tracks || [];
  for (let k = all.length - 1; k >= 0; k--) {
    const t = all[k], a = t && t.flmAuto; if (!a) continue;
    const host = all.find((x) => x.id === t.target.strip), d = host && (host.devices || []).find((x) => x.id === t.target.devId);
    let pi = -1, step = false, conv = (v) => v;                                   // conv: FLM 0..1 value -> the stock parameter's value
    if (d && !d.missing && DEVICES[d.type]) {
      const ps = DEVICES[d.type].params, nm = moduleName(d.from && d.from.name);
      if (a.param === FLM_MIX_PARAM) pi = ps.findIndex((q) => /^(Dry\/Wet|Mix)$/.test(q.n));
      else if (d.type === 52 && a.param === 5) { pi = 0; step = true; }
      else if (nm === 'Leveller' && d.type === 0 && (a.param === 1 || a.param === 2)) {   // same conversion as the module (0.7071 = 0 dB, pan 0.5 = centre)
        pi = a.param === 1 ? 0 : 1;
        conv = a.param === 1 ? (v) => Math.max(-60, Math.min(24, 20 * Math.log10(Math.pow(Math.max(1e-4, v) / 0.7071, 2)))) : (v) => (v - 0.5) * 2;
      } else if (nm === 'Graphic EQ' && d.type === 31 && a.param >= 1 && a.param <= 8) { pi = (a.param - 1) * 5 + 3; conv = (v) => Math.max(-15, Math.min(15, (v - 0.5) * 2 * GEQ_RANGE)); }
    }
    if (pi < 0) { all.splice(k, 1); if (report) { report.tracks = Math.max(0, (report.tracks || 0) - 1); (report.skipped || []).push(`Otomasi "${a.label || '?'}": ${d && !d.missing ? 'parameter belum dipetakan' : 'plugin tidak tersedia'}`); } continue; }
    const q = DEVICES[d.type].params[pi];
    for (const c of t.clips) for (const p of c.pts) p.v = Math.round(normOf(q, conv(p.v)) * 1e5) / 1e5;   // lanes hold the parameter's normalised value
    t.target.param = pi; t.target.def = { ...q }; t.name = t.name.replace(/\u2022 .*$/, '\u2022 ' + q.n);
    if (step) for (const c of t.clips) {                                     // a toggle holds its value and jumps at each point
      const first = c.pts[0]; if (first && first.t > 0) c.pts.unshift({ t: 0, v: a.from != null ? (a.from > 0.5 ? 1 : 0) : 1 });
      for (const p of c.pts) p.s = 1;
    }
    delete t.flmAuto;
  }
}
