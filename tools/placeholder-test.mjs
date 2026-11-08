// Modules this version does not have (removed types, or saved by a newer MobileDAW): kept as a neutral placeholder that holds the original
// device verbatim (d.missing.orig). Opening, saving and opening again loses nothing; a version that knows the type gets the module back;
// paste / rack preset / mixer preset bring unknown modules in as placeholders instead of dropping them.
// Usage: node tools/placeholder-test.mjs   (part of tools/run-tests.mjs)
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const P = await import(path.join(root, 'js/project.js')), D = await import(path.join(root, 'js/defs.js'));
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const FUT = 9001;                                                         // a module type from "the future"
const future = { id: 'fut1', type: FUT, params: [0.25, 7, -3], bypass: true, mix: 0.4, extra: { mode: 'x', curve: [1, 2, 3] } };
P.newProject(false); P.addTrack('midi'); const i = P.state.tracks.length - 1, tid = P.state.tracks[i].id;
P.addDevice(i, 7); P.addDevice(i, 51);
const o = JSON.parse(P.serialize()), ot = o.tracks.find((t) => t.id === tid);
ot.devices.splice(1, 0, JSON.parse(JSON.stringify(future)));                        // between the Reverb and the rack
ot.devices[2].chains[0].devices.push({ id: 'fut2', type: FUT, params: [1, 2] });   // inside the rack chain
ot.devices.push({ id: 'old11', type: 11, params: [0.5] });                         // the removed MultiFX
o.master.devices = [{ id: 'fut3', type: FUT, params: [3] }];
const text = JSON.stringify(o);
await P.deserialize(text);
const t = P.state.tracks.find((x) => x.id === tid);
ok(t.devices.length === 4, 'every module is still in the chain (' + t.devices.map((d) => d.missing ? '[' + d.missing.name + ']' : D.DEVICES[d.type].name).join(', ') + ')');
const ph = t.devices[1];
ok(ph.type === 0 && ph.missing && ph.missing.orig && ph.id === 'fut1', 'unknown module -> neutral placeholder (Utility), same id, original kept');
ok(JSON.stringify(ph.missing.orig) === JSON.stringify(future), 'the original device data is kept verbatim (params, bypass, mix, extra fields)');
ok(D.DEVICES[0].params.every((q, k) => ph.params[k] === q.def), 'the placeholder passes audio untouched (Utility at its defaults)');
ok(t.devices[2].chains[0].devices.some((x) => x.missing && x.missing.orig && x.missing.orig.id === 'fut2'), 'unknown module inside a rack chain -> placeholder');
ok(t.devices[3].missing && t.devices[3].missing.name === 'MultiFX', 'the removed MultiFX shows by name instead of vanishing');
ok(P.state.master.devices.length === 1 && P.state.master.devices[0].missing.orig.type === FUT, 'Master chain too');
// save -> open again: nothing lost, no double wrapping
const t2 = JSON.parse(P.serialize()).tracks.find((x) => x.id === tid);
ok(t2.devices[1].missing && JSON.stringify(t2.devices[1].missing.orig) === JSON.stringify(future), 'saved with the original data');
await P.deserialize(P.serialize());
const t3 = P.state.tracks.find((x) => x.id === tid);
ok(t3.devices[1].missing && !t3.devices[1].missing.orig.missing && JSON.stringify(t3.devices[1].missing.orig) === JSON.stringify(future), 'save / open twice: still the same original (not wrapped again)');
// a version that knows the type: the module comes back
D.DEVICES[FUT] = { name: 'Future FX', params: [{ n: 'A', min: 0, max: 1, def: 0 }, { n: 'B', min: 0, max: 10, def: 0 }, { n: 'C', min: -12, max: 12, def: 0 }] };
const back = P.devOrPlaceholder(JSON.parse(JSON.stringify(t3.devices[1])));
ok(back.type === FUT && back.id === 'fut1' && back.params[1] === 7 && back.mix === 0.4 && !back.missing, 'once the type exists, the placeholder turns back into the original module');
delete D.DEVICES[FUT];
// paste / rack preset path
P.addTrack('midi'); const j = P.state.tracks.length - 1;
const r = P.insertDeviceCopies(j, 0, [{ type: FUT, name: 'Zukunft', params: [1] }, { type: 7, params: [] }]);
ok(r.added === 2 && r.held.length === 1 && r.held[0] === 'Zukunft' && P.state.tracks[j].devices[0].missing, 'paste: unknown module comes in as a named placeholder (reported), not dropped');
// automation of a placeholder parameter is not played on the Utility
P.state.tracks.push({ id: 'auto1', kind: 'auto', target: { kind: 4, strip: tid, devId: 'fut1', param: 1, def: { n: 'B', min: 0, max: 10 } }, clips: [] });
ok(P.autoCurrent(P.state.tracks[P.state.tracks.length - 1]) === 0.5, 'an automation lane of the missing module stays in the file but drives nothing');
console.log(bad ? bad + ' FAILED' : 'ALL OK'); process.exit(bad ? 1 : 0);
