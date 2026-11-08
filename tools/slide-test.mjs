// Slide notes (FL Studio Mobile): a slide note is not played; over its length it glides the sounding note to the slide note's pitch (lane kind 4,
// exact semitones in both engines; golden core-slide checks JS = C++). Checks the lane built from a clip and the audible glide.
// Usage: node --experimental-default-type=module tools/slide-test.mjs   (part of tools/run-tests.mjs)
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const P = await import(path.join(root, 'js/project.js'));
const { Engine, PPQ } = await import(path.join(root, 'js/engine/core.js'));
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const SR = 48000;
// ---- the lane built from a clip
P.newProject(false); P.addTrack('midi'); const i = P.state.tracks.length - 1;
const c = P.addClip(i, 0, P.BAR);
c.notes.push({ t: 0, d: 1920, p: 60, v: 0.8 }, { t: 480, d: 480, p: 67, v: 0.8, sl: true }, { t: 1200, d: 240, p: 55, v: 0.8, sl: true });
const f = []; const n = P.slideLane(c, f);
const pts = []; for (let k = 0; k < f.length; k += 3) pts.push([f[k], f[k + 1], f[k + 2]]);
ok(n === pts.length && pts.every((q) => q[1] === 4), `slide notes -> lane kind 4 (${n} points)`);
ok(pts[0][0] === 480 && pts[0][2] === 0 && pts[1][0] === 960 && pts[1][2] === 7, 'first slide: from the note pitch (0) at its start to +7 at its end');
ok(pts[2][0] === 1200 && pts[2][2] === 7 && pts[3][0] === 1440 && pts[3][2] === -5, 'second slide continues from +7 to -5 (55 - 60)');
ok(pts[4][0] === 1920 && pts[4][2] === -5 && pts[5][0] === 1921 && pts[5][2] === 0, 'back to 0 when the sounding note ends');
const ev = P.clipNoteEvents(c, 'midi', []), fe = []; P.clipNoteEvents(c, 'midi', fe);
ok(fe.length === 5, 'slide notes are not played as notes of their own (only the plain note is an event)');
// ---- audible: a classic synth glides 220 Hz -> 440 Hz
const goertzel = (x, a, b, fr) => { const w = 2 * Math.PI * fr / SR, cc = 2 * Math.cos(w); let s1 = 0, s2 = 0; for (let k = a; k < b; k++) { const s0 = x[k] + cc * s1 - s2; s2 = s1; s1 = s0; } return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - cc * s1 * s2)) / (b - a); };
const e = new Engine(SR); e.masterLimit(false); e.tempo(120); e.trackInst(0, 1); e.trackVol(0, 1);
e.trackNotes(0, [0, PPQ * 4, 57, 0.8, 0], 1);
e.trackCC(0, [PPQ, 4, 0, PPQ * 2, 4, 12], 2);
e.play();
const N = SR * 2, L = new Float32Array(N), R = new Float32Array(N);
for (let k = 0; k < N; k += 128) e.render(L.subarray(k, k + 128), R.subarray(k, k + 128), Math.min(128, N - k));
const a1 = goertzel(L, 4800, 19200, 220), a2 = goertzel(L, 4800, 19200, 440), b1 = goertzel(L, 62400, 86400, 220), b2 = goertzel(L, 62400, 86400, 440);
ok(a1 > a2 * 1.5 && a1 > 0.03, `before the slide the note sounds at 220 Hz (fundamental, saw harmonics above) (${a1.toFixed(4)} vs 440 Hz ${a2.toFixed(4)})`);
ok(b2 > 0.03 && b1 < a1 * 0.1, `after the slide it sounds an octave up (440 Hz ${b2.toFixed(4)} vs 220 Hz ${b1.toFixed(4)})`);
console.log(bad ? `\n${bad} FAILED` : '\nSLIDE NOTES OK'); process.exit(bad ? 1 : 0);
