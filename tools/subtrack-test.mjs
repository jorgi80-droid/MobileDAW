// Sub-tracks (FL Studio Mobile): extra rows under a drum / synth track with clips of their own, played by the same instrument. Checks the
// data (add / rename / kind / mute / remove), that the engine gets the notes of every row (muted rows left out), save / open, undo, moving a
// clip to another track, and that projects without sub-tracks are written exactly as before.
// Usage: node tools/subtrack-test.mjs   (part of tools/run-tests.mjs)
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const P = await import(path.join(root, 'js/project.js')), H = await import(path.join(root, 'js/history.js'));
const { eng } = await import(path.join(root, 'js/engine.js'));
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const sent = new Map(), tn = eng.trackNotes;
eng.trackNotes = (i, f, n, st) => { sent.set(i, { f: Array.from(f), n, st }); return tn && tn(i, f, n, st); };
const pitches = (i) => { const s = sent.get(i); const o = []; for (let k = 0; k < s.n; k++) o.push(s.f[k * s.st + 2]); return o.sort((a, b) => a - b); };

P.newProject(false);
const plain = P.serialize();
ok(!/"subs"/.test(plain) && !/"sub":/.test(plain), 'a project without sub-tracks is written as before (no new fields)');
P.addTrack('drum'); const d = P.state.tracks.length - 1, T = P.state.tracks[d];
P.addTrack('audio'); const a = P.state.tracks.length - 1;
ok(P.addSub(a, 'steps') === null, 'audio tracks have no sub-tracks');
const s1 = P.addSub(d, 'steps'), s2 = P.addSub(d, 'notes');
ok(s1 && s2 && P.subsOf(T).length === 2 && s1.kind === 'steps' && s2.kind === 'notes' && s1.name === 'Steps 1' && s2.name === 'Notes 2', 'drum track: Step track + Notes track added');
const c0 = P.addClip(d, 0, P.BAR); c0.notes.push({ t: 0, d: 120, p: 36, v: 0.9 });
const c1 = P.addClip(d, 0, P.BAR); P.setClipSub(d, c1, s1.id); c1.notes.push({ t: 240, d: 120, p: 38, v: 0.9 });
const c2 = P.addClip(d, 0, P.BAR); P.setClipSub(d, c2, s2.id); c2.notes.push({ t: 480, d: 120, p: 42, v: 0.9 });
P.syncClips(d);
ok(c1.sub === s1.id && c2.sub === s2.id && !('sub' in c0), 'clips sit in their rows (c.sub)');
ok(JSON.stringify(pitches(d)) === '[36,38,42]', 'the instrument gets the notes of the track row and of both sub-tracks, overlapping in time');
P.setSub(d, s1.id, 'mute', true);
ok(JSON.stringify(pitches(d)) === '[36,42]', 'muting a sub-track leaves its clips out');
P.setSub(d, s1.id, 'mute', false); P.setSub(d, s1.id, 'name', '  Hats  '); P.setSub(d, s2.id, 'kind', 'steps');
ok(s1.name === 'Hats' && s2.kind === 'steps' && JSON.stringify(pitches(d)) === '[36,38,42]', 'rename / editor kind / unmute');
P.setClipSub(d, c0, 'nope');
ok(!('sub' in c0), 'a clip cannot be put into a sub-track that does not exist');
// save / open
const txt = P.serialize(), o = JSON.parse(txt), od = o.tracks.find((t) => t.id === T.id);
ok(od.subs.length === 2 && od.clips.find((c) => c.id === c1.id).sub === s1.id, 'sub-tracks and clip rows are saved');
od.clips.find((c) => c.id === c2.id).sub = 'gone'; od.subs.push({ bogus: 1 });
await P.deserialize(JSON.stringify(o));
const T2 = P.state.tracks.find((t) => t.id === T.id), d2 = P.state.tracks.indexOf(T2);
ok(P.subsOf(T2).length === 2 && T2.clips.find((c) => c.id === c1.id).sub === s1.id, 'opened again with its sub-tracks');
ok(!('sub' in T2.clips.find((c) => c.id === c2.id)), 'a clip pointing at a missing sub-track goes back to the track row (kept, not lost)');
// undo of adding / removing a sub-track
H.clearHistory(); H.checkpoint(); const s3 = P.addSub(d2, 'notes');
ok(P.subsOf(T2).length === 3, 'third sub-track'); H.undoOp();
ok(P.subsOf(T2).length === 2 && !P.subsOf(T2).some((s) => s.id === s3.id), 'undo removes it again'); H.redoOp();
ok(P.subsOf(T2).length === 3, 'redo brings it back');
H.checkpoint(); P.removeSub(d2, s1.id);
const cc1 = T2.clips.find((c) => c.id === c1.id);
ok(P.subsOf(T2).length === 2 && !('sub' in cc1) && T2.clips.length === 3, 'removing a sub-track moves its clips to the track row (nothing deleted)');
H.undoOp(); ok(P.subsOf(T2).some((s) => s.id === s1.id) && T2.clips.find((c) => c.id === c1.id).sub === s1.id, 'undo: the sub-track and its clip row come back');
// moving a clip to another drum track: it leaves the sub-track row
P.addTrack('drum'); const e = P.state.tracks.length - 1;
ok(P.moveClipToTrack(d2, c1.id, e) && !('sub' in P.state.tracks[e].clips.find((c) => c.id === c1.id)), 'a clip moved to another track lands in that track\'s own row');
// duplicate track keeps the sub-tracks
const r = P.duplicateTrack(d2), dup = P.state.tracks[d2 + 1];
ok(!r.error && P.subsOf(dup).length === P.subsOf(T2).length, 'duplicating a track copies its sub-tracks');
// synth track too
P.addTrack('midi'); const m = P.state.tracks.length - 1;
ok(!!P.addSub(m, 'notes'), 'synth tracks can have sub-tracks too');
console.log(bad ? bad + ' FAILED' : 'ALL OK'); process.exit(bad ? 1 : 0);
