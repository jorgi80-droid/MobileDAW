// Logic test for track header additions (point 18): Arm (exclusive, record target), Monitor, undo, save/load. Usage: node --experimental-default-type=module tools/header-test.mjs
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const P = await import(path.join(root, 'js/project.js')), H = await import(path.join(root, 'js/history.js'));
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };
P.newProject(false);
P.addTrack('midi'); P.addTrack('midi'); P.addTrack('audio');
const n = P.state.tracks.length, a = n - 3, b = n - 2, au = n - 1, T = P.state.tracks;
P.toggleArm(a); ok(T[a].arm && P.armedTrack() === a && P.state.sel.track === a, 'arm sets record target and selects it');
P.toggleArm(b); ok(!T[a].arm && T[b].arm && P.armedTrack() === b, 'arming another track un-arms the first');
H.undoOp(); ok(T[a].arm && !T[b].arm, 'undo restores the previous arm in ONE step');
H.redoOp(); ok(!T[a].arm && T[b].arm, 'redo');
P.toggleArm(au); ok(T[au].arm && !T[b].arm, 'audio track can be armed');
P.toggleMonitor(au); ok(T[au].mon === undefined, 'monitor ignored on audio');
P.toggleMonitor(a); ok(T[a].mon === false, 'monitor off'); H.undoOp(); ok(T[a].mon !== false, 'monitor undo');
P.toggleMonitor(a);
await P.deserialize(P.serialize());
const T2 = P.state.tracks; ok(T2[a].mon === false && T2[au].arm === true, 'arm / monitor survive save + load');
// automation lane below its track as ONE undo step (same sequence as laneMenu in timeline.js)
P.newProject(false); P.addTrack('midi'); P.addTrack('midi');
const c0 = P.state.tracks.length, src = c0 - 2; let la = null;
H.clearHistory();
P.HK.group(() => { la = P.addAutoTrack({ kind: 0, strip: P.stripOf(src), param: 0, def: P.AUTO_VOL }, 'x'); for (let k = P.state.tracks.length - 1; k > src + 1; k--) P.swapTracks(k, k - 1); });
ok(P.state.tracks.length === c0 + 1 && P.state.tracks[src + 1] === la, 'lane sits right below its track');
H.undoOp(); ok(P.state.tracks.length === c0 && !P.state.tracks.some((t) => t.kind === 'auto'), 'lane creation undone in ONE step');
console.log(bad ? bad + ' FAILED' : 'ALL OK'); process.exit(bad ? 1 : 0);
