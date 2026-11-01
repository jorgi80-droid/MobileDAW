// MIDI controller input: notes play the selected track (and record when REC is on), CC values drive linked parameters,
// MMC / realtime messages control the transport. Drum pads follow FL Studio Mobile: notes 48.. = pads in order.
import { eng } from './engine.js';
import { toast } from './ui.js';
import { prefs } from './prefs.js';
import * as P from './project.js';

let started = false, warned = 0, learn = null;
// Set MIDI Key (FL Studio Mobile drum channel menu): the next note-on from a controller is handed to cb instead of being played. Returns a cancel function.
export function learnNote(cb) { learn = cb; return () => { if (learn === cb) learn = null; }; }
export const midiNames = () => eng.midiDevices();

function mmc(d) {   // F0 7F <device> 06 <command> F7
  if (d[1] !== 0x7F || d[3] !== 0x06) return;
  switch (d[4]) {
    case 1: case 9: P.stop(); break;
    case 2: case 3: P.play(); break;
    case 5: P.seekTo(0); break;
    case 6: P.startRecording().then((r) => r && r.error && toast(r.error, 3500)); break;
    case 7: P.stopRecording().then((r) => r && r.error && toast(r.error, 3500)); break;
    default: break;
  }
}

function onMessage(d, name) {
  if (prefs.midiDevice !== 'any' && name !== prefs.midiDevice) return;
  const s = d[0];
  window.dispatchEvent(new Event('midiact'));
  if (s === 0xF0) return mmc(d);
  if (s === 0xFA) { P.seekTo(0); P.play(); return; }
  if (s === 0xFB) { P.play(); return; }
  if (s === 0xFC) { P.stop(); return; }
  const cmd = s & 0xF0;
  if (cmd === 0x90 || cmd === 0x80) {
    if (learn && cmd === 0x90 && d[2] > 0) { const f = learn; learn = null; f(d[1]); return; }
    const on = cmd === 0x90 && d[2] > 0, i = P.state.sel.track, t = P.state.tracks[i];
    if (!t || (t.kind !== 'midi' && t.kind !== 'drum')) { if (on && performance.now() - warned > 4000) { warned = performance.now(); toast('Pilih track synth atau drum untuk dimainkan dari MIDI.'); } return; }
    P.noteEvent(i, d[1], on ? d[2] / 127 : 0, on);
  } else if (cmd === 0xB0) {
    const r = P.midiCC(d[1], d[2]);
    if (r) toast(`CC ${r.linked} terhubung ke ${r.label}`, 3000);
  }
}

export async function enableMidi(quiet = false) {
  const r = await eng.midiInit(onMessage);
  if (r && r.error) { if (!quiet) toast(r.error, 4000); return r; }
  started = true; prefs.midiOn = true;
  return r;
}
export const midiStarted = () => started;
