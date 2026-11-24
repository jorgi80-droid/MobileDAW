// Built-in sample programs of the source app that are not in the archive (e.g. FL Studio Mobile's DirectWave library "Keyboard/Grand Piano")
// -> the closest General MIDI program of the SoundFont MobileDAW ships (TimGM6mb.sf2), so the pattern still plays with a similar sound.
// Most specific keywords first; then the library category; null = no sensible match.
export const GM_SF = '/SoundFonts/TimGM6mb.sf2';
export const GM_NAMES = ['Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano', 'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet', 'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion', 'Nylon Guitar', 'Steel Guitar', 'Jazz Guitar', 'Clean Guitar', 'Muted Guitar', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Finger Bass', 'Pick Bass', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2', 'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit', 'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet', 'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Square Lead', 'Saw Lead', 'Calliope Lead', 'Chiff Lead', 'Charang Lead', 'Voice Lead', 'Fifths Lead', 'Bass + Lead', 'New Age Pad', 'Warm Pad', 'Polysynth Pad', 'Choir Pad', 'Bowed Pad', 'Metallic Pad', 'Halo Pad', 'Sweep Pad',
  'Rain FX', 'Soundtrack FX', 'Crystal FX', 'Atmosphere FX', 'Brightness FX', 'Goblins FX', 'Echoes FX', 'Sci-fi FX', 'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal'];
const RULES = [
  [/electric\s*grand/, 2], [/honky/, 3], [/bright\s*piano/, 1], [/(e\.?\s*piano|electric\s*piano|rhodes|wurli|epiano|\bep\b)/, 4], [/(fm\s*piano|dx)/, 5], [/harpsi/, 6], [/clav/, 7],
  [/celest/, 8], [/glock/, 9], [/music\s*box/, 10], [/vibra/, 11], [/marimba/, 12], [/xylo/, 13], [/(tubular|chime)/, 14], [/dulcimer/, 15], [/piano/, 0],
  [/church\s*organ|pipe\s*organ/, 19], [/rock\s*organ/, 18], [/(perc\w*\s*organ)/, 17], [/reed\s*organ/, 20], [/organ/, 16], [/accordion/, 21], [/harmonica/, 22],
  [/nylon|classical\s*guitar/, 24], [/(steel|acoustic)\s*guitar/, 25], [/jazz\s*guitar/, 26], [/muted\s*guitar/, 28], [/overdriv/, 29], [/distort\w*\s*guitar/, 30], [/(clean|electric)\s*guitar/, 27], [/guitar/, 24],
  [/slap/, 36], [/fretless/, 35], [/(synth|sub|808)\s*bass/, 38], [/(finger|electric)\s*bass/, 33], [/pick\s*bass/, 34], [/(acoustic|upright|double)\s*bass/, 32],
  [/violin/, 40], [/viola/, 41], [/cello/, 42], [/contrabass/, 43], [/tremolo\s*str/, 44], [/pizz/, 45], [/harp/, 46], [/timpani/, 47], [/synth\s*str/, 50], [/(slow|soft)\s*str/, 49], [/string/, 48],
  [/(choir|aah)/, 52], [/(ooh|vocal|voice)/, 53], [/orch\w*\s*hit/, 55], [/muted\s*trumpet/, 59], [/trumpet/, 56], [/trombone/, 57], [/tuba/, 58], [/horn/, 60], [/synth\s*brass/, 62], [/brass/, 61],
  [/soprano\s*sax/, 64], [/tenor\s*sax/, 66], [/bari\w*\s*sax/, 67], [/sax/, 65], [/oboe/, 68], [/english\s*horn/, 69], [/bassoon/, 70], [/clarinet/, 71], [/piccolo/, 72], [/pan\s*flute/, 75], [/flute/, 73], [/recorder/, 74], [/whistle/, 78], [/ocarina/, 79],
  [/square/, 80], [/(saw|lead)/, 81], [/warm\s*pad/, 89], [/(choir|voice)\s*pad/, 91], [/sweep/, 95], [/pad/, 88],
  [/sitar/, 104], [/banjo/, 105], [/shamisen/, 106], [/koto/, 107], [/kalimba/, 108], [/bagpipe/, 109], [/fiddle/, 110], [/steel\s*drum/, 114], [/taiko/, 116], [/bell/, 112],
  [/^bas\b/, 38], [/^led\b/, 81], [/^pad\b/, 89], [/^(key|pno)\b/, 0], [/^(plk|pluck)\b/, 45], [/^arp\b/, 81], [/^brs\b/, 61], [/^str\b/, 48], [/^org\b/, 16], [/^(syn|sy)\b/, 81],   // FLM SoundFont names (BAS / LED / PAD ...)
  [/^keyboards?\b|\/keyboards?\//, 0], [/^bass\b|\/bass\//, 33], [/^strings?\b/, 48], [/^pads?\b/, 89], [/^synth/, 81], [/^guitars?\b/, 24], [/^brass\b/, 61], [/^(wood)?winds?\b/, 73], [/^(mallets?|percussion)\b/, 12],
];
// "DirectWave Samples/Keyboard/Grand Piano.dwp" -> { program: 0, name: 'Acoustic Grand Piano', label: 'Keyboard/Grand Piano' }
export function gmFor(library) {
  const label = String(library || '').replace(/^.*?(DirectWave Samples[^/]*|SoundFonts)\//i, '').replace(/\.\w+$/, '');
  const s = label.toLowerCase(), base = s.split('/').pop();
  for (const [re, prog] of RULES) if (re.test(base)) return { program: prog, name: GM_NAMES[prog], label };
  for (const [re, prog] of RULES) if (re.test(s)) return { program: prog, name: GM_NAMES[prog], label };
  return null;
}
