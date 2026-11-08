// Non-audio logic test for the browser tab actions (project.js loaded in Node, engine = mock). Usage: node --experimental-default-type=module tools/browser-test.mjs
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const P = await import(path.join(root, 'js/project.js')), D = await import(path.join(root, 'js/defs.js')), H = await import(path.join(root, 'js/history.js'));
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };
P.newProject(false);
const n0 = P.state.tracks.length;
// tap instrument on a non-MIDI selection => one new synth track, one undo step
P.HK.group(() => { P.addTrack('midi'); P.selectTrack(P.state.tracks.length - 1); P.setInstrument(P.state.tracks.length - 1, 33); });
ok(P.state.tracks.length === n0 + 1 && P.state.tracks[n0].inst.type === 33, 'instrument on new track');
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
// classic instruments are gone: no preset list, no way to create one, old user presets open as the FLM twin
ok([1, 2, 4, 5].every((k) => !D.PRESETS[k]) && D.PRESETS[30].some((x) => x.name === 'One-Shot Drum' && x.from && x.from.type === 4), 'classic presets moved to DirectWave / GMS / MiniSynth / SuperSaw');
P.addTrack('midi'); { const j = P.state.tracks.length - 1; P.setInstrument(j, 1); ok(P.state.tracks[j].inst.type === 32, 'setInstrument(classic) -> FLM twin'); }
{ const { eng } = await import(path.join(root, 'js/engine.js')), PR = await import(path.join(root, 'js/presets.js')), rt = eng.readText;
  eng.readText = () => JSON.stringify({ app: 'mobiledaw', kind: 'instrument', type: 2, inst: 'SuperSaw Klasik', name: 'Old', p: [30, 0.5, 9000, 0.01, 0.4, 0.5], pitch: 0, flm: D.FLM_FMT });
  const o = PR.readPreset('/x.json'); eng.readText = rt;
  ok(o && o.type === 33 && o.inst === D.INSTRUMENTS[33].name && o.p.length === D.INSTRUMENTS[33].params.length, 'old classic user preset opens as SuperSaw (FLM)'); }
console.log(bad ? bad + ' FAILED' : 'all passed'); process.exit(bad ? 1 : 0);
