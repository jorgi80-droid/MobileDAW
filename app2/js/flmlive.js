// Live-device compositions of the FL Studio Mobile modules (fxkit.js flmLive), one per module, after the Live 12 device each one is closest to
// (docs/refs: Compressor, Auto Filter, Delay, Chorus-Ensemble, Phaser-Flanger, Auto Pan, Multiband Dynamics, EQ Eight ...): knob columns left
// of a dark display, the display's handles dragged like Live's, the secondary values as numbers inside the display, mode buttons stacked,
// Output and Dry/Wet on the right with Dry/Wet at the bottom. Indices are FLM's parameter order (js/flmfx.js).
//   L / R: columns left / right of the display; a column is a list of items        B: a row of items under the display
//   D: { handles, rows, tabs, tap, piano }  rows = lines of items inside the dark display (a leading string = the line's name), tabs = a
//      list parameter as Live's mode buttons under the graph, handles = [{ x, y, n, pos }] dragged on the graph
//   item: 3 = knob | { n: 3 } number box | { s: 3 } menu | { ch: 3 } stacked choice | { t: 3 } switch | { sw: t, on, off } by a switch |
//         { f: 3 } vertical fader filling the column | { h: 'Title' } | '-' pushes the rest down (Dry/Wet at the bottom); l = label override
import { FLM_IGRAPH, tbPos, o3fPos, env3Pos } from './flmviz.js';
const F0 = 20, F1 = 20000;
const lx = (f) => Math.log(f / F0) / Math.log(F1 / F0);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const R = (a, b) => Array.from({ length: b - a + 1 }, (_, q) => a + q);
// where a handle sits on the module's graph, as fractions [x, y] of the display (y from the top), from the laws flmviz.js draws with
const eqH = (b) => ({ x: 2 + 4 * b, y: 1 + 4 * b, n: String(b + 1), kx: 9.966 / 9.25, ky: 1 / 0.92,
  pos: (p) => [lx(Math.pow(2, 5 + 9.25 * p(2 + 4 * b))), 0.5 - (p(1 + 4 * b) - 0.5) * 0.92] });
const GHZ = [80, 160, 375, 750, 1500, 3000, 6000, 12000];
const dynX = (db) => (db + 60) / 66;

export const FLM_LIVE = {
  // Equalizer (EQ Eight): the four bands as numbered handles (drag = frequency / gain); the selected band's Freq / Gain / Width on the left
  3: { band: 4, names: { 1: 'Gain', 2: 'Freq', 3: 'Q' }, D: { handles: [0, 1, 2, 3].map(eqH) } },
  // Multi FX: Live's XY pad
  4: { D: { handles: [{ x: 2, y: 3 }], rows: [[{ s: 1, l: 'FX' }, { n: 2, l: 'X' }, { n: 3, l: 'Y' }], ['LFO', { s: 4, l: 'Rate' }, { s: 6, l: 'Shape' }, { n: 5, l: 'Amount' }]] } },
  5: { L: [[1, 2]], D: { handles: [{ x: 1, pos: (p) => { const d = 20 * Math.log10(Math.pow(10, 1.2 * p(1) - 1.2)); return [dynX(d), 1 - dynX(d)]; }, kx: 66 / 24 }] }, R: [[{ f: 3 }]] },
  // Distortion (Saturator): Drive left, the curve with the type buttons under it, Output right
  6: { L: [[1, 6]], D: { tabs: 5, rows: [[{ n: 2 }, { n: 4 }]] }, R: [[{ f: 3 }]], names: { 3: 'Output' } },
  7: { D: { handles: GHZ.map((hz, i) => ({ y: i + 1, pos: (p) => [lx(hz), 0.5 - (p(i + 1) - 0.5) * 0.92], ky: 1 / 0.92 })), rows: [R(1, 8).map((j) => ({ n: j }))] } },
  // Compressor: Ratio / Attack / Release, the transfer curve (drag = Threshold), Knee-row numbers, Peak / RMS and Makeup on the right
  8: { L: [[2, 3, 4]], D: { handles: [{ x: 1, pos: (p) => [dynX(-40 + 40 * p(1)), 1 - dynX(-40 + 40 * p(1))], kx: 66 / 40 }], rows: [[{ n: 1 }, { n: 6 }, { n: 8, l: 'In' }]] },
    R: [[{ t: 7, l: 'Makeup' }, { t: 9, l: 'RMS' }, '-', 5]], names: { 5: 'Out' } },
  // Filter (Auto Filter): Freq / Res, the response with its ring, type and slope under the display
  9: { L: [[1, 2]], D: { handles: [{ x: 1, y: 2, pos: (p) => [lx(Math.pow(2, 4 + 10.3 * p(1))), 0.5 - 0.4 * p(2)], kx: 9.966 / 10.3, ky: 2.5 }], rows: [[{ s: 3, l: '' }, { ch: 4, l: '' }]] } },
  10: { D: {}, B: [1, 2, 3] },
  // Chorus (Chorus-Ensemble): the display, Rate / Amount under it, Dry/Wet right
  11: { D: {}, B: [1, 2, 3], R: [[{ f: 4 }]], names: { 2: 'Amount', 3: 'Width', 4: 'Dry/Wet' } },
  12: { L: [[1, 5, 4]], D: { rows: [[{ n: 2 }, { n: 8 }, { n: 9 }, { n: 17 }, { n: 18 }], ['Diffusion', { n: 6, l: 'Amount' }, { n: 7 }, { n: 11, l: 'Early' }], ['Modulation', { n: 19, l: 'Rate' }, { n: 20, l: 'Amount' }]] },
    R: [[10, 12, '-', 3]], names: { 3: 'Dry/Wet', 5: 'Size', 2: 'Damp', 17: 'Bass', 12: 'Dry' } },
  // Flanger / Phaser (Phaser-Flanger): display + LFO shape buttons, rate with its Sync switch and the knobs under it
  13: { D: { tabs: 4, rows: [[{ n: 6 }, { n: 9 }]] }, B: [{ t: 2, l: 'Sync' }, { sw: 2, on: { s: 1, l: 'Rate' }, off: 3 }, 5, 7, { t: 8, l: 'ø' }], R: [[{ t: 11, l: 'Inv' }, { f: 10 }]],
    names: { 3: 'Rate', 5: 'Amount', 7: 'Feedback', 10: 'Dry/Wet' } },
  14: { D: { tabs: 8, rows: [[{ n: 4, l: 'Center' }, { n: 9 }]] }, B: [{ t: 6, l: 'Sync' }, { sw: 6, on: { s: 1, l: 'Rate' }, off: 7 }, 2, 3], R: [[{ f: 5 }]],
    names: { 7: 'Rate', 2: 'Amount', 3: 'Feedback', 5: 'Dry/Wet' } },
  15: { L: [[1, 2]], D: { rows: [[{ n: 3 }, { n: 4 }]] }, R: [[{ f: 5, bip: true }]] },
  // Trance Delay / Tape Delay (Delay): time and feedback left, the taps, Dry/Wet right
  16: { L: [[{ s: 1, l: 'Time' }, { ch: 5 }, 2]], D: { rows: [[{ n: 4 }]] }, R: [[6, '-', 3]], names: { 2: 'Feedback', 3: 'Dry/Wet' } },
  18: { L: [[1, 2]], D: { rows: [[{ n: 3, l: 'Async' }]] }, R: [[{ f: 4 }]], names: { 2: 'Feedback', 4: 'Dry/Wet' } },
  20: { L: [[{ f: 1 }], [{ f: 2, bip: true }]] },
  // Pitcher / Pitcher 2: the keyboard is the display (tap = note on / off)
  25: { L: [[1, 2, 3]], D: { tap: (n) => 26 + n, rows: [[{ s: 6, l: 'Input', w: 100 }, { t: 4, l: 'Formant' }, { t: 22, l: 'No Snap' }], ['Bypass', ...R(10, 21).map((j) => ({ t: j, l: '', key: true }))]] },
    R: [[7, 8, 5], [{ f: 9 }]], names: { 9: 'Dry/Wet', 8: 'Stable', 5: 'Formant' } },
  // Gate: Threshold on the curve, the times as numbers in the display, Floor / Mix right
  27: { L: [[1, 2]], D: { handles: [{ x: 1, pos: (p) => [dynX(-60 + 66 * p(1)), 1 - dynX(-60 + 66 * p(1))] }], rows: [[{ n: 3 }, { n: 8 }, { n: 5 }], [{ n: 4, l: 'Att Curve' }, { n: 6, l: 'Rel Curve' }]] }, R: [[{ f: 7 }]] },
  // Limiter: Gain, the ceiling on the curve, Release
  28: { L: [[1, 3]], D: { handles: [{ x: 4, pos: (p) => [dynX(-24 + 24 * p(4)), 1 - dynX(-24 + 24 * p(4))], kx: 66 / 24 }], rows: [[{ n: 4, l: 'Ceiling' }]] }, R: [[{ f: 2 }]], names: { 1: 'Gain', 3: 'Release', 2: 'Output' } },
  29: { L: [[1, 2]], D: { rows: [[{ s: 7, l: 'Shape' }, { n: 4 }, { n: 5 }]] }, R: [[3, 6]], names: { 1: 'Amount' } },
  30: { D: { handles: R(0, 7).map((i) => ({ y: i + 1, pos: (p) => [lx(110 * Math.pow(2, Math.trunc(p(9) * 11 + 0.001) / 12 - 0.75 + i)), 0.5 - (p(i + 1) - 0.5) * 0.92], ky: 1 / 0.92 })),
    rows: [R(1, 8).map((j) => ({ n: j })), [{ s: 9, l: 'Tuning' }, { n: 10, l: 'Width' }]] } },
  // Reverb: Decay / Size / Predelay, the tail with its numbers (damping, filters, diffusion, modulation), levels and Dry/Wet right
  32: { L: [[1, 7, 6]], D: { rows: [[{ n: 2 }, { n: 10 }, { n: 11 }], ['Diffusion', { n: 8, l: 'Amount' }, { n: 9 }, { n: 5, l: 'Early' }], ['Modulation', { n: 12, l: 'Rate' }, { n: 13, l: 'Amount' }]] },
    R: [[14, 15, 4], [{ f: 3 }]], names: { 3: 'Dry/Wet', 7: 'Size', 2: 'Damp', 14: 'Wet', 15: 'Dry' } },
  34: { L: [[1, 5]], D: { rows: [[{ s: 4, l: 'L/R' }, { s: 6, l: 'M/S' }, { s: 7, l: 'Mode' }]] }, R: [[2, 3]], names: { 1: 'L/R', 5: 'M/S', 3: 'Separate' } },
  35: { L: [[3, 4, 11]], D: { rows: [[{ n: 5 }, { n: 6 }, { n: 15 }], ['Tone', { n: 1 }, { n: 2 }, { n: 14 }, { n: 17 }], ['Modulation', { n: 13, l: 'Amount' }, { n: 16, l: 'Rate' }, { t: 12, l: 'Tempo' }, { t: 10, l: 'Side' }]] },
    R: [[8, 18], [7, '-', 9]], names: { 9: 'Wet', 7: 'Dry', 11: 'Predelay', 5: 'Diffuse' } },
  // Multiband Compressor (Multiband Dynamics): the splits left, the bands as lines of numbers in the display, Output right
  36: { L: [[{ n: 3, l: 'High' }, { n: 2, l: 'Low' }, { t: 4, l: 'Solo' }, { s: 30, l: 'Width' }]],
    D: { handles: [{ x: 2, pos: (p) => [lx(20 * Math.pow(2, 9 * p(2))), 0.5], kx: 9.966 / 9 }, { x: 3, pos: (p) => [lx(20 * Math.pow(2, 9 * p(3))), 0.5], kx: 9.966 / 9 }],
      rows: [['High', { s: 26, l: 'Mode' }, { n: 21, l: 'Thresh' }, { n: 22, l: 'Ratio' }, { n: 23, l: 'Attack' }, { n: 24, l: 'Release' }, { n: 20, l: 'Input' }, { n: 25, l: 'Gain' }, { n: 29, l: 'Width' }],
        ['Mid', { s: 19 }, { n: 14 }, { n: 15 }, { n: 16 }, { n: 17 }, { n: 13 }, { n: 18 }, { n: 28 }], ['Low', { s: 12 }, { n: 7 }, { n: 8 }, { n: 9 }, { n: 10 }, { n: 6 }, { n: 11 }, { n: 27 }]], table: true },
    R: [[1, '-', 5]], names: { 1: 'Output', 5: 'Dry Mix' } },
  40: { L: [[2, 3]], D: { rows: [[{ s: 1, l: 'Mode' }, { t: 7, l: 'Snap' }, { n: 10, l: 'Octave' }, { s: 11, l: 'Note' }], [{ s: 5, l: 'Offset' }, { s: 8, l: 'Polarity' }, { n: 9, l: 'Asym' }, { n: 6, l: 'Smooth' }]] }, R: [['-', 4]], names: { 3: 'Feedback', 4: 'Dry/Wet' } },
  // Waveshaper: Drive left, the curve dragged by X / Y, tone and LFO as numbers in the display
  41: { L: [[5, 3, 4]], D: { handles: [{ x: 3, y: 4 }], rows: [[{ s: 1, l: 'Shape' }, { t: 2, l: 'Auto' }, { n: 9 }, { n: 10 }], ['EQ', { n: 11 }, { n: 12 }, { n: 13 }, { n: 14 }],
      ['LFO', { s: 15, l: 'Shape' }, { t: 16, l: 'Sync' }, { sw: 16, on: { s: 17, l: 'Rate' }, off: { n: 18, l: 'Rate' } }, { n: 19, l: 'To X' }, { n: 20, l: 'To Y' }]] },
    R: [[6, 7, '-', 8]], names: { 6: 'Output', 7: 'Spread', 8: 'Dry/Wet' } },
  42: { L: [[{ t: 5, l: 'Play' }, { t: 7, l: 'Sync' }]], D: {}, R: [[{ sw: 7, on: { s: 3, l: 'Stop' }, off: 1 }, { sw: 7, on: { s: 4, l: 'Start' }, off: 2 }, 6]], names: { 1: 'Stop', 2: 'Start' } },
  43: { L: [[{ t: 7, l: 'Sync' }]], D: { rows: [['Wow', { sw: 7, on: { s: 2, l: 'Rate' }, off: { n: 1, l: 'Rate' } }, { n: 3, l: 'Amount' }], ['Flutter', { sw: 7, on: { s: 5 }, off: { n: 4 } }, { n: 6 }],
    ['Random', { sw: 7, on: { s: 9 }, off: { n: 8 } }, { n: 10 }]], table: true } },
  44: { L: [[1, 4]], D: { handles: [{ x: 2, pos: (p) => [lx(Math.max(20, 10 * Math.pow(1000, p(2)))), 0.5], kx: 9.966 / 9.966 }], rows: [[{ n: 2, l: 'Low Bypass' }, { n: 3, l: 'Mono Bass' }]] }, names: { 4: 'Separate' } },
  45: { L: [[13, 19, 20]], D: { tap: (n) => 1 + n, rows: [[{ t: 21, l: 'Snap' }, { t: 16, l: 'Formant' }, { n: 17, l: 'Ratio' }, { s: 18, l: 'Ref', w: 92 }], [{ t: 25, l: 'Latency' }, { t: 26, l: 'Sibilants' }, { n: 23, l: 'Sens' }, { n: 24 }]] },
    R: [[{ f: 22 }]], names: { 22: 'Dry/Wet', 19: 'Stable', 20: 'Human' } },
  // Tremolo (Auto Pan): the shape, Amount / Rate / Phase under it
  46: { D: { rows: [[{ n: 8 }, { n: 9 }, { n: 10 }, { n: 11 }]] }, B: [3, 4, { t: 7, l: 'Sync' }, { sw: 7, on: { s: 2, l: 'Rate' }, off: 1 }, 5, 6], names: { 1: 'Rate', 3: 'Max', 4: 'Min', 5: 'Phase', 6: 'Stereo' } },
  // note effects: no display
  47: { L: [[{ h: 'Echo' }, { t: 4, l: 'Sync' }, { sw: 4, on: 3, off: 2 }, 1], [{ h: 'Offset' }, 5, 6, 12], [{ h: 'Drift' }, 9, 10, 11], [{ h: 'Pan' }, 13, { t: 14, l: 'Ping Pong' }, 15], [{ h: 'Start' }, 7, 8]],
    names: { 1: 'Repeats', 2: 'Delay', 3: 'Delay', 5: 'Pitch', 6: 'Velocity', 12: 'Pan', 9: 'Time', 10: 'Length', 11: 'Delay', 13: 'Drift', 15: 'Stop' } },
  48: { L: [[{ f: 1, bip: true }], [{ f: 2, bip: true }]] },
  49: { L: [[1, 2], [3, 4], [5, 6]] },
  50: { D: { piano: R(4, 15), rows: [[{ s: 1, l: 'Key' }, { s: 2, l: 'Scale' }, { t: 3, l: 'Snap' }]] } },
  51: { L: [[{ h: 'Rate' }, { t: 3, l: 'Sync' }, { sw: 3, on: { s: 1, l: '' }, off: 2 }, { t: 6, l: 'Latch' }], [{ h: 'Swing' }, 4, { s: 5, l: '' }], [{ h: 'Velocity' }, 7, 8]],
    D: { rows: [['Arp 1', { t: 19, l: 'On' }, { s: 10, l: 'Style' }, { s: 11, l: 'Range' }, { s: 12, l: 'Octave' }, { s: 13, l: 'Start' }, { s: 14, l: 'Rhythm' }, { s: 17, l: 'Repeats' }, { s: 18, l: 'Retrig' }, { s: 31, l: 'Rate' }, { n: 9, l: 'Gate' }, { n: 15, l: 'Rotate' }],
      ['Arp 2', { t: 30, l: 'On' }, { s: 21 }, { s: 22 }, { s: 23 }, { s: 24 }, { s: 25 }, { s: 28 }, { s: 29 }, { s: 32 }, { n: 20 }, { n: 26 }]], table: true },
    names: { 2: 'Rate', 7: 'Arp 1', 8: 'Arp 2' } },
};
// ---- instruments (defs.js INSTRUMENTS[34] Transistor Bass, [35] Slicer, [36] 3x Osc): parts = Live sections side by side, each with its display
// Transistor Bass: the oscillator's wave | the filter with its ring (drag = Cutoff / Reso) over the envelope knobs | Distortion | Volume fader
FLM_LIVE.i34 = { parts: [
  { D: { graph: FLM_IGRAPH.tbWave, w: 150, handles: [{ x: 11, y: 1 }], rows: [[{ n: 1, l: 'Wave' }, { n: 11, l: 'PW' }], ['LFO', { n: 12, l: 'Rate' }, { n: 13, l: 'To PW' }]] } },
  { D: { graph: FLM_IGRAPH.tbFilter, handles: [{ x: 2, y: 3, pos: tbPos }], rows: [[{ n: 2 }, { n: 3 }]] }, B: [4, 5, 6] },
  { L: [[{ t: 7, l: 'Distort' }, 9, 8]], R: [[{ f: 10 }]] }],
  names: { 9: 'Drive', 8: 'HP', 10: 'Volume', 2: 'Cutoff', 3: 'Reso' } };
// Slicer: the loop is the display (fxkit VI[35] adds the Loop button and the waveform); the play mode as buttons under it
FLM_LIVE.i35 = { L: [[1, { t: 6, l: 'Mono' }]], D: { w: 260, tabs: 5, rows: [[{ n: 7, l: 'Sens' }, { n: 8, l: 'First Key' }, { n: 3 }, { n: 4 }]] } };
// 3x Osc: FLM's eight pages
const o3osc = (i) => ({ D: { graph: FLM_IGRAPH.osc3(i), w: 170, rows: [[{ s: 1 + i, l: 'Shape', w: 76 }, { t: 4 + i, l: 'Inv' }, { t: 146 + i, l: 'Free' }, ...(i === 2 ? [{ t: 24, l: 'AM' }] : [])],
  [{ n: 13 + i, l: 'Coarse' }, { n: 16 + i, l: 'Fine' }, { n: 10 + i, l: 'Detune' }, { n: 7 + i, l: 'Phase' }, { n: 19 + i, l: 'Pan' }]] }, R: i ? [[{ f: 21 + i, l: 'Mix' }]] : undefined });
const o3lfo = (t) => ({ D: { graph: FLM_IGRAPH.lfo3(t), w: 200, handles: [{ x: 57 + t, y: 52 + t }], tabs: 37 + t,
  rows: [[{ n: 57 + t, l: 'Speed' }, { n: 52 + t, l: 'Amount' }, { n: 42 + t, l: 'Predelay' }, { n: 47 + t, l: 'Attack' }], [{ t: 32 + t, l: 'Sync' }, { t: 27 + t, l: 'Global' }]] } });
const o3env = (e) => { const [a, d, r] = env3Pos(e); return { D: { graph: FLM_IGRAPH.env3(e), w: 230, handles: [{ x: 74 + e, pos: a }, { x: 86 + e, y: 94 + e, pos: d }, { x: 98 + e, pos: r }],
  rows: [[{ n: 74 + e, l: 'Attack' }, { n: 82 + e, l: 'Hold' }, { n: 86 + e, l: 'Decay' }, { n: 94 + e, l: 'Sustain' }, { n: 98 + e, l: 'Release' }],
    [{ t: 62 + e, l: 'On' }, { t: 66 + e, l: 'Sync' }, { n: 70 + e, l: 'Predelay' }, { n: 78 + e, l: 'A Curve' }, { n: 90 + e, l: 'D Curve' }, { n: 102 + e, l: 'R Curve' }, { n: 106 + e, l: 'Amount' }]] } }; };
export const OSC3_LIVE = [
  ['Osc', { parts: [o3osc(0), o3osc(1), o3osc(2), { L: [[{ t: 25, l: 'HQ' }, 26]] }], names: { 26: 'Ph Rand' } }],
  ['Pan', { parts: [o3lfo(0), { L: [[113], [122], [126]] }], names: { 113: 'Offset', 122: 'Key', 126: 'Velocity' } }],
  ['Vol', { parts: [o3lfo(1), o3env(0), { R: [[{ f: 114, l: 'Volume' }]] }] }],
  ['Cut', { parts: [o3lfo(2), o3env(1)] }],
  ['Res', { parts: [o3lfo(3), o3env(2)] }],
  ['Pitch', { parts: [o3lfo(4), o3env(3)] }],
  ['Filter', { parts: [{ L: [[115, 116]], D: { graph: FLM_IGRAPH.filt3, handles: [{ x: 111, y: 112, pos: o3fPos }], rows: [[{ s: 110, l: 'Type', w: 84 }, { n: 111, l: 'Cutoff' }, { n: 112, l: 'Reso' }]] } },
    { D: { cap: 'Tracking', rows: [['Key', { n: 121, l: 'Middle' }, { n: 123, l: 'Cutoff' }, { n: 124, l: 'Reso' }], ['Velocity', { n: 125 }, { n: 127 }, { n: 128 }]], table: true } }], names: { 115: 'Cut Ofs', 116: 'Res Ofs' } }],
  ['Misc', { parts: [{ L: [[{ n: 117, l: 'Voices' }, { t: 120, l: 'Mono' }, { t: 138, l: 'Fat' }], [118, { t: 119, l: 'Mode' }, 129]] },
    { D: { graph: FLM_IGRAPH.echo3, w: 190, rows: [[{ n: 130, l: 'Echoes' }, { n: 131, l: 'Feedback' }, { n: 132, l: 'Time' }, { t: 137, l: 'Bounce' }], [{ n: 133, l: 'Pan' }, { n: 134, l: 'Pitch' }, { n: 135, l: 'Cutoff' }, { n: 136, l: 'Reso' }]] } },
    { D: { cap: 'Arpeggio', rows: [[{ s: 139, l: 'Direction' }, { s: 142, l: 'Range', w: 56 }, { s: 143, l: 'Repeat', w: 56 }], [{ s: 145, l: 'Chord', w: 110 }, { t: 144, l: 'Slide' }], [{ n: 140, l: 'Time' }, { n: 141, l: 'Gate' }]] } }], names: { 118: 'Glide', 129: 'Gate' } }],
];
export { clamp as liveClamp };
