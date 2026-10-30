// Logic test for Clip View additions (point 17): clip transpose, MIDI repeat, audio loop, undo. Usage: node --experimental-default-type=module tools/clipview-test.mjs
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const P = await import(path.join(root, 'js/project.js')), H = await import(path.join(root, 'js/history.js'));
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };
P.newProject(false);
P.addTrack('midi'); const i = P.state.tracks.length - 1, t = P.state.tracks[i];
const c = { id: 'tc1', start: 0, len: P.BAR, notes: [{ t: 0, d: 120, p: 60, v: 0.8 }, { t: 240, d: 120, p: 64, v: 0.8 }] };
t.clips.push(c);
H.checkpoint(); ok(P.setClipXpose(i, 'tc1', 5).st === 5 && c.xpose === 5, 'transpose set');
H.undoOp(); ok(!P.state.tracks[i].clips[0].xpose, 'transpose undone');
P.setClipXpose(i, 'tc1', 0); ok(!('xpose' in P.state.tracks[i].clips[0]), 'transpose 0 removes field');
const len0 = P.state.tracks[i].clips[0].len;
H.checkpoint(); ok(P.repeatClipContent(i, 'tc1', 4).ok, 'repeat x4');
const c2 = P.state.tracks[i].clips[0]; ok(c2.len === len0 * 4 && c2.notes.length === 8 && c2.notes[7].t === 3 * len0 + 240, 'repeat length and notes');
H.undoOp(); ok(P.state.tracks[i].clips[0].len === len0 && P.state.tracks[i].clips[0].notes.length === 2, 'repeat undone');
// round trip: old projects open, new field survives
P.setClipXpose(i, 'tc1', -3);
const txt = P.serialize(); await P.deserialize(txt);
const ti = P.state.tracks.findIndex((x) => x.clips.some((q) => q.id === 'tc1'));
ok(ti >= 0 && P.state.tracks[ti].clips.find((q) => q.id === 'tc1').xpose === -3, 'xpose survives save/load');
// drum track refuses transpose
P.addTrack('drum'); const d = P.state.tracks.length - 1; P.state.tracks[d].clips.push({ id: 'dc1', start: 0, len: P.BAR, notes: [] });
ok(!!P.setClipXpose(d, 'dc1', 2).error, 'drum clip refuses transpose');
// audio loop
P.addTrack('audio'); const a = P.state.tracks.length - 1;
P.state.tracks[a].clips.push({ id: 'ac1', start: 0, len: P.BAR, gain: 1, offset: 0, sample: { id: 1, path: 'x.wav', name: 'x', duration: 4, peaks: [] } });
ok(P.setAudioLoop(a, 'ac1', 4).ok && P.state.tracks[a].clips[0].len === P.BAR * 4 && P.state.tracks[a].clips[0].ll === P.BAR, 'audio loop x4');
ok(P.loopOf(P.state.tracks[a].clips[0]) === P.BAR, 'loopOf active');
P.setAudioLoop(a, 'ac1', 1); ok(P.state.tracks[a].clips[0].len === P.BAR && !P.state.tracks[a].clips[0].ll, 'audio loop off restores length');
console.log(bad ? bad + ' FAILED' : 'ALL OK'); process.exit(bad ? 1 : 0);
