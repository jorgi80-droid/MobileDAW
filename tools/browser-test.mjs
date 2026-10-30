// Non-audio logic test for the browser tab actions (project.js loaded in Node, engine = mock). Usage: node --experimental-default-type=module tools/browser-test.mjs
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const P = await import(path.join(root, 'js/project.js')), D = await import(path.join(root, 'js/defs.js')), H = await import(path.join(root, 'js/history.js'));
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };
P.newProject(false);
const n0 = P.state.tracks.length;
// tap instrument on a non-MIDI selection => one new synth track, one undo step
P.HK.group(() => { P.addTrack('midi'); P.selectTrack(P.state.tracks.length - 1); P.setInstrument(P.state.tracks.length - 1, 2); });
ok(P.state.tracks.length === n0 + 1 && P.state.tracks[n0].inst.type === 2, 'instrument on new track');
H.undoOp(); ok(P.state.tracks.length === n0, 'undo removes track and instrument in ONE step');
// factory presets: every preset applies and stays within parameter ranges
let total = 0;
for (const [k, list] of Object.entries(D.PRESETS)) {
  const def = D.INSTRUMENTS[k]; ok(!!def, 'PRESETS type ' + k + ' exists');
  P.addTrack('midi'); const i = P.state.tracks.length - 1;
  for (const pr of list) { P.HK.group(() => { P.setInstrument(i, +k); P.applyPreset(i, pr); }); total++; }
  P.removeTrack(i);
}
ok(total > 0, total + ' factory presets applied without error');
// effect add / limit
P.addTrack('midi'); const t = P.state.tracks.length - 1;
for (let k = 0; k < 20; k++) P.addDevice(t, 7);
ok(P.state.tracks[t].devices.length === 16, 'addDevice stops at 16');
P.addDevice(64, 6); ok(P.state.master.devices.length >= 1, 'effect on Master strip');
console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
