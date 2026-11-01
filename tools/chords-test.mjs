// Chord / Strum keyboard theory (js/chords.js): diatonic chords, names, inversions. Usage: node tools/chords-test.mjs
import { degreeChord, chordName, invert } from '../js/chords.js';
let bad = 0; const ok = (c, m) => { if (c) console.log('ok   ' + m); else { bad++; console.log('FAIL ' + m); } };
const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10];
const names = (key, st, n) => st.map((_, d) => chordName(degreeChord(key, st, d, n, 4))).join(' ');
ok(names(0, MAJ, 3) === 'C Dm Em F G Am Bdim', 'C major triads: ' + names(0, MAJ, 3));
ok(names(9, MIN, 3) === 'Am Bdim C Dm Em F G', 'A minor triads: ' + names(9, MIN, 3));
ok(names(0, MAJ, 4) === 'Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7b5', 'C major 7th chords: ' + names(0, MAJ, 4));
const c = degreeChord(0, MAJ, 0, 3, 4);
ok(c.join() === '60,64,67', 'C at octave 4 = MIDI 60 64 67');
ok(invert(c, 1).join() === '64,67,72' && invert(c, 2).join() === '67,72,76', 'inversions: 1st E G C, 2nd G C E');
ok(degreeChord(0, MAJ, 6, 3, 4).join() === '71,74,77', 'degree 7 wraps into the next octave (B D F)');
console.log(bad ? `\n${bad} FAILED` : '\nchords-test: all passed'); process.exit(bad ? 1 : 0);
