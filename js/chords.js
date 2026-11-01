// Chord keyboard theory (pure, no DOM): diatonic chords of a scale degree, their names, inversions. Used by the Keys tab (Chord / Strum).
const NAMES12 = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// the chord on scale degree d (0-based): stacked thirds inside the scale, `n` notes (3 = triad, 4 = 7th), from octave `oct`
export function degreeChord(key, steps, d, n = 3, oct = 4) {
  const L = steps.length, out = [];
  for (let k = 0; k < n; k++) { const idx = d + k * 2, o = Math.floor(idx / L); out.push((oct + 1) * 12 + key + steps[idx % L] + o * 12); }
  return out;
}
export function chordName(notes) {
  const r = notes[0], iv = notes.slice(1).map((p) => (p - r) % 12 === 0 ? 12 : ((p - r) % 12 + 12) % 12).join(',');
  const q = { '4,7': '', '3,7': 'm', '3,6': 'dim', '4,8': 'aug', '2,7': 'sus2', '5,7': 'sus4', '4,7,11': 'maj7', '3,7,10': 'm7', '4,7,10': '7', '3,6,10': 'm7b5', '3,6,9': 'dim7', '3,7,11': 'mMaj7', '4,8,11': 'maj7#5' }[iv];
  return NAMES12[((r % 12) + 12) % 12] + (q === undefined ? '?' : q);
}
export const invert = (notes, inv) => { const a = notes.slice(); for (let k = 0; k < inv; k++) a.push(a.shift() + 12); return a; };
