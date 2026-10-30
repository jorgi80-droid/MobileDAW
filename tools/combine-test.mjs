// Logic test for Combine (v66): merge clips of one track, notes keep their absolute position, refusals leave the song untouched.
// Usage: node tools/combine-test.mjs
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = await import(path.join(root, 'js/project.js'));
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
P.addTrack('midi'); const a = P.state.tracks.length - 1, B = P.BAR;
const c1 = P.addClip(a, 0, B), c2 = P.addClip(a, B * 2, B);
c1.notes.push({ t: 0, d: 240, p: 60, v: 0.8 }, { t: 960, d: 240, p: 64, v: 0.8 }); c2.notes.push({ t: 120, d: 480, p: 67, v: 0.7 });
const r = P.combineClips(a, [c1.id, c2.id]);
const m = P.state.tracks[a].clips;
ok(r.ok && m.length === 1, 'two clips become one');
ok(m[0].start === 0 && m[0].len === B * 3, 'spans from the first start to the last end');
ok(m[0].notes.length === 3 && m[0].notes.some((n) => n.p === 67 && n.t === B * 2 + 120), 'notes keep their absolute position');
ok(m[0].notes.every((n, k, arr) => k === 0 || arr[k - 1].t <= n.t), 'notes are sorted by time');
P.addTrack('audio'); const au = P.state.tracks.length - 1;
ok(!!P.combineClips(au, ['x', 'y']).error, 'audio track refused');
const d1 = P.addClip(a, B * 4, B), d2 = P.addClip(a, B * 5, B); d2.ll = B / 2;
const before = P.state.tracks[a].clips.length;
ok(!!P.combineClips(a, [d1.id, d2.id]).error && P.state.tracks[a].clips.length === before, 'looped clip refused, song untouched');
ok(!!P.combineClips(a, [d1.id]).error, 'one clip refused');
console.log(bad ? 'FAILED ' + bad : 'ALL OK'); process.exit(bad ? 1 : 0);
