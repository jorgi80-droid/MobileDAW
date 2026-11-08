// Channel-menu workflow (FL Studio Mobile): Duplicate Track and Save as MIDI per track. Duplicate = a full independent copy right below the
// original (new ids for track / clips / devices / chains, decoded samples shared), sidechain sources keep pointing at their tracks, one undo
// step; Save as MIDI = only that track's notes.   Usage: node --experimental-default-type=module tools/track-dup-test.mjs
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const P = await import(path.join(root, 'js/project.js')), H = await import(path.join(root, 'js/history.js'));
const { buildProjectMidi } = await import(path.join(root, 'js/midiio.js'));
const { decodeSmf } = await import(path.join(root, 'js/engine/smf.js'));
const D = await import(path.join(root, 'js/defs.js'));
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };
const T = () => P.state.tracks;

P.newProject(false);
const base = T().length;
P.addTrack('midi'); P.addTrack('drum'); P.addTrack('midi');
const a = base, d = base + 1, z = base + 2;
T()[a].name = 'Lead'; P.setInstrument(a, 33); P.setInstParam(a, 0, 1);
const c1 = P.addClip(a, 0, P.BAR * 2); c1.notes.push({ t: 0, d: 240, p: 60, v: 0.8 }, { t: 480, d: 240, p: 64, v: 0.6 }); P.clipChanged(a);
P.addDevice(a, 6); P.addDevice(a, 7);
T()[a].vol = 0.5; T()[a].pan = -0.3; T()[a].send = [0.4, 0.1]; T()[a].arm = true;
const dc = P.addClip(d, 0, P.BAR); dc.notes.push({ t: 0, d: 120, p: 36, v: 0.9 }); P.clipChanged(d);
P.setPad(d, 0, 'cut', 2); P.setPad(d, 0, 'hold', 0.25);
P.addTrack('midi'); const lastIdx = T().length - 1; P.addClip(lastIdx, 0, P.BAR).notes.push({ t: 0, d: 120, p: 70, v: 1 });

// ---- duplicate a synth track
const n0 = T().length, id0 = T()[a].id;
const r = P.duplicateTrack(a);
ok(!r.error && T().length === n0 + 1, 'duplicate adds one track');
const c = T()[a + 1], o = T()[a];
ok(c === r.track && c.name === 'Lead 2' && o.name === 'Lead' && o.id === id0, 'the copy sits right below the original, named "<name> 2"');
ok(c.id !== o.id && c.clips[0].id !== o.clips[0].id && c.devices[0].id !== o.devices[0].id && c.devices[1].id !== o.devices[1].id, 'new ids for track, clips and devices');
ok(c.inst.type === 33 && c.inst.params[0] === 1 && c.clips.length === 1 && c.clips[0].notes.length === 2 && c.devices.length === 2, 'instrument, parameters, clips and effects are copied');
ok(c.vol === 0.5 && c.pan === -0.3 && c.send[0] === 0.4 && c.send[1] === 0.1, 'mixer settings and sends are copied');
ok(c.arm === false && o.arm === true, 'record-arm is not copied (one record target)');
c.clips[0].notes[0].p = 99; c.inst.params[0] = 7; c.devices[0].params[0] = 123456; c.send[0] = 0;
ok(o.clips[0].notes[0].p === 60 && o.inst.params[0] === 1 && o.devices[0].params[0] !== 123456 && o.send[0] === 0.4, 'the copy is independent of the original (notes, parameters, effects, sends)');
ok(P.state.sel.track === a + 1, 'the copy becomes the selected track');
H.undoOp(); ok(T().length === n0 && T()[a].id === id0 && T().every((t) => t.id !== c.id), 'one undo removes the whole copy');
H.redoOp(); ok(T().length === n0 + 1 && T()[a + 1].id === c.id, 'redo brings it back');

// ---- drum track: pads (cut / hold fields) are copied, chains get new ids
const dr = P.duplicateTrack(T().findIndex((t) => t.kind === 'drum'));
const dOrig = T().find((t) => t.kind === 'drum'), dCopy = dr.track;
ok(!dr.error && dCopy.inst.pads && dCopy.inst.pads[0].cut === 2 && dCopy.inst.pads[0].hold === 0.25 && dCopy.inst.pads !== dOrig.inst.pads, 'drum track: pads with cut group / hold are copied, not shared');
dCopy.inst.pads[0].cut = 0; ok(dOrig.inst.pads[0].cut === 2, 'drum pads are independent');

// ---- sidechain sources are track numbers: duplicating a track above must not make an Autoduck listen to a different track
{
  P.newProject(false);
  P.addTrack('midi'); P.addTrack('midi'); P.addTrack('midi'); P.addTrack('midi');                  // 0 = will be duplicated, 1 = sidechain source, 3 = ducked
  P.addDevice(3, 10);
  const def = D.DEVICES[10], k = def.params.findIndex((q) => q.fmt === 'src'), dev = T()[3].devices[0];
  P.setDeviceParam(3, 0, k, 2);                                                                     // numbers are 1-based: source = track index 1
  const srcId = T()[1].id;
  P.duplicateTrack(0);                                                                              // a track appears above the source: it moves from index 1 to 2
  ok(T()[2].id === srcId, 'the duplicate really shifted the source track (index 1 -> 2)');
  const after = T().find((t) => t.devices.some((x) => x.id === dev.id)), nk = after.devices.find((x) => x.id === dev.id).params[k];
  ok(T()[nk - 1] && T()[nk - 1].id === srcId, 'Autoduck still listens to the same source track after the duplicate shifted the numbers');
}

// ---- guards
const au = P.addTrack('audio'); const auIdx = T().indexOf(au);
const lane = P.addAutoTrack({ kind: 4, strip: 'master', param: 0, def: { n: 'x', min: 0, max: 1, def: 0 } }, 'Lane'); const li = lane ? T().indexOf(lane) : -1;
if (li >= 0) ok(P.duplicateTrack(li).error, 'an automation track cannot be duplicated');
ok(P.duplicateTrack(999).error, 'a missing track gives an error');
while (T().length < P.MAX_TRACKS) P.addTrack('midi');
ok(/maksimum/.test(P.duplicateTrack(0).error || ''), 'at the track limit duplicate refuses with a message');

// ---- Save as MIDI per track
P.newProject(false);
P.addTrack('midi'); P.addTrack('midi'); const m0 = T().length - 2, m1 = T().length - 1;
P.addClip(m0, 0, P.BAR).notes.push({ t: 0, d: 240, p: 60, v: 0.8 }); P.clipChanged(m0);
P.addClip(m1, 0, P.BAR).notes.push({ t: 0, d: 240, p: 72, v: 0.8 }, { t: 480, d: 240, p: 74, v: 0.8 }); P.clipChanged(m1);
const all = buildProjectMidi(), one = buildProjectMidi(T()[m1]);
ok(all.tracks.length === 2 && one.tracks.length === 1, 'whole-project export has both tracks, per-track export only the chosen one');
const back = decodeSmf(one.bytes), nn = back.tracks.flatMap((t) => t.notes).map((x) => x.p).sort();
ok(nn.length === 2 && nn[0] === 72 && nn[1] === 74, 'the per-track .mid contains exactly that track\'s notes (' + nn.join(',') + ')');

console.log(bad ? `\n${bad} FAILED` : '\nTRACK DUPLICATE / SAVE AS MIDI OK');
process.exit(bad ? 1 : 0);
