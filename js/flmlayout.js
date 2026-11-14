// Card layouts of the FL Studio Mobile modules MobileDAW runs on Honeydew's DSP (devices 100 + FLM id, instruments 34 / 35), drawn the
// Ableton Live way (fxkit.js flmLayout): the module's display on the left, then titled sections; in a section the menus and switches sit on
// top and the knobs in a grid of two rows. Indices are FLM's parameter order (js/flmfx.js, defs.js INSTRUMENTS).
//   s:    [title, [param indices]] per section, in reading order (a param left out stays reachable through automation only if hidden)
//   keys: [title, [12 note toggles C..B], label prefix to drop] - a one-octave keyboard (Scale, Pitcher, Pitcher 2)
//   when: { param: [sync toggle, shown while it is on] } - Live's Sync: only the rate control that plays is shown
//   names: { param: label } where the FLM name would read wrong in its section
//   tap: (note 0..11) => param - the display is a keyboard (flmviz keys) and a tap toggles that note; tapKeys: those params (no buttons)
//   strip: a regexp of name parts the section titles already say ("Low ", " (Arp 1)")
const R = (a, b) => Array.from({ length: b - a + 1 }, (_, q) => a + q);
const band = (n) => ['Band ' + n, [4 * n, 4 * n - 3, 4 * n - 2, 4 * n - 1, 16 + n]];
const arp = (n, o) => ['Arp ' + n, [o + 19, o + 10, o + 11, o + 12, o + 13, o + 14, o + 17, o + 18, o + 9, o + 15, 30 + n]];
const mb = (name, o, w) => [name, [o + 6, o, o + 1, o + 2, o + 3, o + 4, o + 5, w]];

export const FLM_LAYOUT = {
  3: { s: [band(1), band(2), band(3), band(4)], strip: / \d$/ },
  4: { s: [['FX', [1, 2, 3]], ['LFO', [4, 6, 5]]] },
  5: { s: [['Limiter', [1, 2, 3]]] },
  6: { s: [['Drive', [5, 1, 6, 2]], ['Output', [3, 4]]] },
  7: { s: [['Bands', R(1, 8)]] },
  8: { s: [['Compression', [1, 2, 3, 4, 6]], ['Output', [7, 9, 8, 5]]] },
  9: { s: [['Filter', [3, 4, 1, 2]]] },
  10: { s: [['Duck', [1, 2, 3]]] },
  11: { s: [['Chorus', [1, 2, 3, 4]]] },
  12: { s: [['Reverb', [1, 4, 5, 6, 11, 2]], ['Tone', [8, 9, 17, 18, 7]], ['Modulation', [19, 20]], ['Output', [10, 3, 12]]] },
  13: { s: [['LFO', [2, 1, 3, 4, 5]], ['Flanger', [6, 7, 9, 8]], ['Output', [10, 11]]], when: { 1: [2, true], 3: [2, false] } },
  14: { s: [['LFO', [6, 1, 7, 8, 2]], ['Phaser', [4, 3, 9]], ['Output', [5]]], when: { 1: [6, true], 7: [6, false] } },
  15: { s: [['Stereo', [1, 2, 3, 4, 5]]] },
  16: { s: [['Delay', [1, 5, 2, 4]], ['Output', [3, 6]]] },
  18: { s: [['Delay', [1, 2, 3, 4]]] },
  20: { s: [['Level', [1, 2]]] },
  25: { s: [['Pitch', [6, 1, 2, 3, 7, 8]], ['Formant', [4, 5]], ['Output', [9]]], keys: ['Bypass', R(10, 21), 'BYP '], after: [22], tap: (k) => 26 + k },   // tap a key of the display: that note on / off (the 12 enables after Post Gain / Mix / Wet Pan)
  27: { s: [['Gate', [1, 2, 8]], ['Envelope', [3, 4, 5, 6]], ['Output', [7]]] },
  28: { s: [['Limiter', [4, 3]], ['Gain', [1, 2]]] },
  29: { s: [['Shape', [7, 4, 5]], ['Duck', [1, 2, 3, 6]]] },
  30: { s: [['Bands', R(1, 8)], ['Tuning', [9, 10]]] },
  32: { s: [['Reverb', [1, 7, 8, 9, 6, 5]], ['Tone', [2, 10, 11]], ['Modulation', [12, 13]], ['Output', [3, 4, 14, 15]]] },
  34: { s: [['L/R', [4, 1, 2]], ['M/S', [6, 5, 3]], ['Mode', [7]]] },
  35: { s: [['Space', [3, 4, 5, 6, 15]], ['Pre-Delay', [12, 11, 10]], ['Tone', [1, 2, 14, 17]], ['Modulation', [13, 16]], ['Output', [7, 8, 9, 18]]] },
  36: { s: [['Bands', [4, 30, 2, 3, 1, 5]], mb('Low', 6, 27), mb('Mid', 13, 28), mb('High', 20, 29)], names: { 2: 'Low/Mid', 3: 'Mid/High', 1: 'Output', 30: 'Width', 12: 'Mode', 19: 'Mode', 26: 'Mode' } },
  40: { s: [['Comb', [1, 7, 2, 10, 11, 3]], ['Shape', [5, 8, 9, 6]], ['Output', [4]]] },
  41: { names: { 18: 'Rate', 7: 'Spread' }, s: [['Shape', [1, 2, 3, 4, 5]], ['Tone', R(9, 14)], ['LFO', [15, 16, 17, 18, 19, 20]], ['Output', [6, 7, 8]]], when: { 17: [16, true], 18: [16, false] } },
  42: { s: [['Transport', [5, 7]], ['Stop', [1, 3]], ['Start', [2, 4]], ['Warp', [6]]], when: { 1: [7, false], 3: [7, true], 2: [7, false], 4: [7, true] } },
  43: { s: [['Sync', [7]], ['Wow', [1, 2, 3]], ['Flutter', [4, 5, 6]], ['Random', [8, 9, 10]]],
    when: { 1: [7, false], 2: [7, true], 4: [7, false], 5: [7, true], 8: [7, false], 9: [7, true] }, strip: /^(Wow|Flutter|Random) / },
  44: { names: { 2: 'Low Byp', 3: 'Mono Lo' }, s: [['Spread', [1, 4, 2, 3]]] },
  45: { s: [['Pitch', [21, 13, 19, 20, 23, 24]], ['Formant', [16, 17, 18]], ['Output', [22, 25, 26]]], tap: (k) => 1 + k, tapKeys: R(1, 12) },
  46: { names: { 1: 'Rate', 2: 'Rate', 5: 'Phase', 6: 'Stereo', 3: 'Max', 4: 'Min' }, s: [['Rate', [7, 1, 2, 5, 6]], ['Depth', [3, 4]], ['Shape', [8, 9, 10, 11]]], when: { 1: [7, false], 2: [7, true] } },
  47: { names: { 1: 'Repeats', 2: 'Delay', 3: 'Delay', 5: 'Pitch', 6: 'Velocity', 12: 'Pan', 9: 'Time', 10: 'Length', 11: 'Delay', 13: 'Pan' }, s: [['Echo', [4, 2, 3, 1, 15]], ['Offsets', [5, 6, 12, 14]], ['Drift', [9, 10, 11, 13]], ['Start', [7, 8]]], when: { 2: [4, false], 3: [4, true] } },
  48: { s: [['Transpose', [1, 2]]] },
  49: { s: [['Random', R(1, 6)]] },
  50: { s: [['Scale', [1, 2, 3]]], keys: ['Notes', R(4, 15), 'Note '] },
  51: { s: [['Rate', [3, 1, 2, 4, 5, 6]], ['Velocity', [7, 8]], arp(1, 0), arp(2, 11)], when: { 1: [3, true], 2: [3, false] }, strip: / \(Arp \d\)$/ },
  // instruments (defs.js INSTRUMENTS[34] / [35])
  i34: { names: { 11: 'PW', 12: 'LFO Rate', 13: 'LFO > PW' }, s: [['Oscillator', [1, 11, 12, 13]], ['Filter', [2, 3, 4, 5, 6]], ['Distortion', [7, 8, 9, 10]]] },
  i35: { s: [['Slices', [7, 8]], ['Voice', [1, 3, 4, 5, 6]]] },
};

// FLM's panel names in Live's title case: "HIGH DAMP" -> "High Damp", "EARLY REFL." -> "Early Refl." (short codes stay: ER, LFO, M/S ...)
const KEEP = new Set(['ER', 'LFO', 'FX', 'L/R', 'M/S', 'EQ', 'RMS', 'CRSV']);
export function flmName(n) {
  if (!n) return n;
  if (/[a-z]/.test(n)) return n[0].toUpperCase() + n.slice(1);
  return n.split(' ').map((w) => (KEEP.has(w) ? w : w.toLowerCase().replace(/(^|[-/(])([a-z])/g, (_, a, b) => a + b.toUpperCase()))).join(' ');
}
// Live's short words where a knob label would not fit its cell
const SHORT = [[/\bFrequency\b/, 'Freq'], [/\bBandwidth\b/, 'Width'], [/\bResonance\b/, 'Reso'], [/\bThreshold\b/, 'Thresh'], [/\bOutput\b/, 'Out'], [/\bInput\b/i, 'In'], [/\bAmount\b/, 'Amt'],
  [/\bRelease\b/, 'Rel'], [/\bAttack\b/, 'Att'], [/\bFeedback\b/, 'Fdbk'], [/\bDiffusion\b/, 'Diffuse'], [/\bSeparation\b/, 'Sep'], [/\bModulation\b/, 'Mod'], [/ Time\b/, ''], [/\bLevel\b/, 'Lvl'],
  [/^Early Refl\.$/, 'Early'], [/^Room Size$/, 'Size'], [/^Bass Mult\.$/, 'Bass'], [/^High Damp$/, 'Damp'], [/\bSpeed\b/, 'Spd'], [/\bSemitone\b/, 'Semi'], [/\bRepetitions\b/, 'Repeats'], [/ Ratio$/, ''], [/^Humanization$/, 'Human'], [/\bSensitivity\b/, 'Sens'], [/\bSmoothing\b/, 'Smooth'], [/\bStability\b/, 'Stable'], [/\bAsymmetry\b/, 'Asym']];
export function flmShort(n) { if (n.length <= 7) return n; for (const [re, w] of SHORT) { n = n.replace(re, w).trim(); if (n.length <= 7) break; } return n; }
