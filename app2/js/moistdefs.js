// Moisture (instrument 37): parameter definitions and value texts. Engine: native/engine/moist2.cpp (C++ only; the web runs its WebAssembly
// build). Every parameter is a normalized 0..1 value in Serum 1's order (0..298, js/serumparams.js); 300.. are Moisture's own.
// The laws below turn a normalized value into the text shown (and are the ones the engine uses): MobileDAW's approximations of Serum's ranges.
import { SERUM_PARAMS } from './serumparams.js';

export const M2 = { TBL_A: 300, TBL_B: 301, SMP_A: 302, SMP_B: 303, NOISE: 304, VOICES: 305, MONO: 306, LEGATO: 307, LFO_SHAPE: 308, LFO_SYNC: 316, LFO_MODE: 324, ROUTE: 332, ROUTES: 32 };
export const M2_TABLES = ['Basic Shapes', 'Analog Saw', 'PWM', 'Harmonic Sweep', 'Formant Vowels', 'Sync Saw', 'Sine Fold', 'Organ', 'Square Sweep', 'Digital Steps'];
export const M2_WARPS = ['Off', 'Window Sync', 'Sync', 'Bend +', 'Bend -', 'Bend +/-', 'PWM', 'Asym +', 'Asym -', 'Asym +/-', 'Flip', 'Mirror', 'Remap 1', 'Remap 2', 'Remap 3', 'Remap 4', 'Quantize', 'FM (from B)', 'AM (from B)', 'RM (from B)', 'FM (Noise)', 'Odd'];
export const M2_FILTERS = ['MG Low 6', 'MG Low 12', 'MG Low 18', 'MG Low 24', 'Low 6', 'Low 12', 'Low 18', 'Low 24', 'High 6', 'High 12', 'High 18', 'High 24', 'Band 12', 'Band 24', 'Peak 12', 'Peak 24', 'Notch 12', 'Notch 24'];
export const M2_DIST = ['Tube', 'Soft Clip', 'Hard Clip', 'Diode 1', 'Diode 2', 'Lin.Fold', 'Sin Fold', 'Zero-Square', 'Downsample', 'Asym', 'Rectify', 'X-Shaper', 'X-Shaper (Asym)'];
export const M2_SUB = ['Sine', 'Round Rect', 'Triangle', 'Saw', 'Square', 'Pulse'];
export const M2_LFO_SHAPES = ['Sine', 'Triangle', 'Saw Up', 'Saw Down', 'Square', 'S&H'];
export const M2_SOURCES = ['—', 'Env 1', 'Env 2', 'Env 3', 'LFO 1', 'LFO 2', 'LFO 3', 'LFO 4', 'LFO 5', 'LFO 6', 'LFO 7', 'LFO 8', 'Velocity', 'Note', 'Mod Wheel', 'Macro 1', 'Macro 2', 'Macro 3', 'Macro 4', 'Pitch Bend', 'Noteon Rand'];
// destinations a route can reach (Serum parameter indices the engine modulates per voice)
export const M2_DESTS = [[11, 'A WT Pos'], [10, 'A Coarse'], [5, 'A Fine'], [1, 'A Level'], [2, 'A Pan'], [9, 'A Warp'], [7, 'A Uni Detune'], [8, 'A Uni Blend'],
  [24, 'B WT Pos'], [23, 'B Coarse'], [18, 'B Fine'], [14, 'B Level'], [15, 'B Pan'], [22, 'B Warp'], [20, 'B Uni Detune'], [21, 'B Uni Blend'],
  [33, 'Sub Level'], [34, 'Sub Pan'], [27, 'Noise Level'], [30, 'Noise Pan'], [45, 'Fil Cutoff'], [46, 'Fil Reso'], [47, 'Fil Drive'], [49, 'Fil Mix'], [0, 'Master Vol']];
export const m2Bank = (k) => (k < 16 ? 180 + 2 * k : 228 + 2 * (k - 16));   // route k's amount; +1 = its output

const C = (v) => Math.min(1, Math.max(0, v));
const envT = (v) => 32 * Math.pow(C(v), 5), hz = (v) => 8 * Math.pow(2756.25, C(v)), idx = (v, n) => Math.max(0, Math.min(n - 1, Math.round(C(v) * (n - 1))));
const tTxt = (s) => (s < 0.001 ? (s * 1000).toFixed(2) + ' ms' : s < 1 ? (s * 1000).toFixed(s < 0.1 ? 1 : 0) + ' ms' : s.toFixed(2) + ' s');
const hzTxt = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + ' kHz' : f.toFixed(f < 100 ? 1 : 0) + ' Hz');
const divTxt = (v) => { const bars = Math.pow(2, 3 - Math.round(10 * C(v))); return bars >= 1 ? bars + (bars > 1 ? ' bars' : ' bar') : '1/' + Math.round(1 / bars); };
const pct = (v) => Math.round(C(v) * 100) + ' %';

export function m2Text(k, v) {
  const r = SERUM_PARAMS[k]; if (!r) return String(v);
  const [n, mn, mx, law, unit] = r;
  if (/^Mod ?\d+ amt$/.test(n)) return Math.round((v * 2 - 1) * 100) + ' %';
  if (law === '=') { const x = mn + (mx - mn) * C(v); if (/Octave/.test(n)) return (x > 0 ? '+' : '') + Math.round(x) + ' oct'; if (/Semi|Bend/.test(n)) return (x > 0 ? '+' : '') + Math.round(x) + ' st';
    if (/Fine/.test(n) && unit === 'cents') return (x > 0 ? '+' : '') + Math.round(x) + ' ct'; if (/Pan|PortCurve/.test(n)) return Math.round(x) === 0 ? 'C' : Math.abs(Math.round(x)) + (x < 0 ? 'L' : 'R');
    if (unit === 'dB') return (x > 0 ? '+' : '') + x.toFixed(1) + ' dB'; if (unit === '°') return Math.round(x) + '°'; if (/Unison/.test(n)) return String(Math.max(1, Math.round(x)));
    return (Math.abs(x) < 10 && Math.round(x) !== x ? x.toFixed(1) : Math.round(x)) + (unit === '%' ? ' %' : unit === '-' ? '' : ' ' + unit); }
  if (/WTPos/.test(n)) return String(1 + Math.round(C(v) * 255));
  if (/CoarsePit/.test(n)) { const s = (v - 0.5) * 96; return (s > 0 ? '+' : '') + s.toFixed(2) + ' st'; }
  if (/Phase$/.test(n) && unit === '°') return Math.round(C(v) * 360) + '°';
  if (/Env\d (Atk|Hold|Hld|Dec|Rel)/.test(n)) return tTxt(envT(v));
  if (/Env1 Sus/.test(n)) return v <= 0.0001 ? '-inf dB' : (20 * Math.log10(v)).toFixed(1) + ' dB';
  if (n === 'Fil Type' || n === 'FX Fil Type') return M2_FILTERS[idx(v, 96)] || 'Low 12 (' + (idx(v, 96) + 1) + ')';
  if (n === 'Fil Cutoff' || n === 'FX Fil Freq' || n === 'Phs_Frq' || n === 'Dist_Freq' || n === 'Cho_Filt' || n === 'Dly_Freq') return hzTxt(hz(v));
  if (/^LFO\dRate$/.test(n)) return divTxt(v);
  if (n === 'PortTime') return tTxt(10 * Math.pow(C(v), 3));
  if (n === 'VerbPDly') return tTxt(0.2 * C(v));
  if (/^EQ Frq/.test(n)) return hzTxt(20 * Math.pow(1000, C(v)));
  if (/^EQ Typ/.test(n)) return ['Shelf', 'Peak', 'Cut'][idx(v, 3)];
  if (n === 'Dist_Mode') return M2_DIST[idx(v, 13)];
  if (n === 'Dist_PrePost') return v > 0.5 ? 'Post' : 'Pre';
  if (/BPM_Sync|Enable|On$|PitchTrack|Link|Retrig|Stack/.test(n)) return v > 0.5 ? 'On' : 'Off';
  if (/_Rate$/.test(n)) return hzTxt(0.02 * Math.pow(500, C(v)));
  if (/Dly_Tim/.test(n)) { const b = Math.pow(2, Math.round(C(v) * 8) - 6); return b >= 4 ? b / 4 + ' bar' : '1/' + Math.round(4 / b); }   // tempo-synced (the engine: 2^(round(8 v) - 6) beats)
  if (n === 'Dly_Mode') return ['Normal', 'Ping-Pong', 'Tap->Delay'][idx(v, 3)];
  if (n === 'Cmp_Thr') return (-60 + 60 * C(v)).toFixed(1) + ' dB';
  if (n === 'Cmp_Rat') return (1 + 3 * Math.pow(C(v) / 0.75, 2)).toFixed(1) + ':1';
  if (n === 'Cmp_Att') return tTxt(0.0001 + 0.1 * v * v);
  if (n === 'Cmp_Rel') return tTxt(0.01 + 1.0 * v * v);
  if (n === 'CmpGain') return '+' + (30 * C(v)).toFixed(1) + ' dB';
  if (n === 'Hyp_Unison') return String(1 + idx(v, 8));
  if (/^WarpOsc/.test(n)) return M2_WARPS[idx(v, M2_WARPS.length)];
  if (n === 'SubOscShape') return M2_SUB[idx(v, 6)];
  if (n === 'Pitch Bend') return ((v - 0.5) * 2).toFixed(2);
  return pct(v);
}

// the instrument definition: Serum's 299 + Moisture's own
export function moistureDef() {
  const P = SERUM_PARAMS.map(([n, , , , , d], k) => ({ n: n.replace(/_/g, ' ').replace(/\s+/g, ' '), min: 0, max: 1, def: d, fmt: 'srm', k, ...(/(^| )(Enable|On)$|BPM.Sync|PitchTrack|Link$/.test(n) ? { step: 1 } : {}) }));
  P[80].hidden = true; P[222].hidden = true;                                       // Mast.Tun / Amp. (no knob in Serum's own panel)
  while (P.length < 300) P.push({ n: '-', min: 0, max: 1, def: 0, hidden: true });
  const list = (n, items, def = 0) => ({ n, min: 0, max: items.length - 1, def, step: 1, fmt: 'list', items });
  const onoff = (n, def = 0) => ({ n, min: 0, max: 1, def, step: 1, fmt: 'onoff' });
  P.push(list('Wavetable A', M2_TABLES, 0), list('Wavetable B', M2_TABLES, 0), { n: 'Table A Sample', min: -1, max: 255, def: -1, step: 1, hidden: true }, { n: 'Table B Sample', min: -1, max: 255, def: -1, step: 1, hidden: true },
    { n: 'Noise Type', min: 0, max: 1, def: 0, step: 1, hidden: true }, { n: 'Voices', min: 1, max: 16, def: 8, step: 1, fmt: 'num' }, onoff('Mono'), onoff('Legato'));
  for (let k = 0; k < 8; k++) P.push(list('LFO' + (k + 1) + ' Shape', M2_LFO_SHAPES, 1));
  for (let k = 0; k < 8; k++) P.push(onoff('LFO' + (k + 1) + ' Sync', 1));
  for (let k = 0; k < 8; k++) P.push(list('LFO' + (k + 1) + ' Mode', ['Trig', 'Env', 'Free'], 0));
  for (let k = 0; k < 32; k++) P.push(list('Mod' + (k + 1) + ' Source', M2_SOURCES, 0), { n: 'Mod' + (k + 1) + ' Dest', min: -1, max: 298, def: -1, step: 1, hidden: true });
  return { name: 'Moisture', view: 'kit', full: true, native: true, serum: true, floatOnly: true, big: true, params: P };   // floatOnly: its panel lives in a floating window only (as MiniMeters)
}
