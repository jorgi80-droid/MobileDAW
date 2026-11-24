// Click / discontinuity measurements of the engine (no instrument-specific sound design involved): mute / unmute and solo while notes
// sound, send level jumps, voice stealing and same-note retrigger on Mini Synth and SuperSaw. A click shows up as a sample-to-sample step
// far larger than the signal's own steps. Score = largest step in the 3 ms around the event / largest step of the steady signal (1 = no
// click). Usage: node tools/click-test.mjs [--check]     (part of tools/run-tests.mjs)
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Engine, PPQ, RET0 } = await import(path.join(root, 'js/engine/core.js'));
const SR = 48000, CHECK = process.argv.includes('--check');
const steps = (x, a, b) => { let m = 0; for (let i = Math.max(1, a); i < Math.min(x.length, b); i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
function run(setup, events, sec) {        // events: [time s, fn(e)]
  const e = new Engine(SR); e.masterLimit(false); setup(e); e.play();
  const n = Math.round(sec * SR), L = new Float32Array(n), R = new Float32Array(n); let k = 0; events.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < n;) { const next = k < events.length ? Math.round(events[k][0] * SR) : n, m = Math.min(128, n - i, Math.max(1, next - i)); e.render(L.subarray(i, i + m), R.subarray(i, i + m), m); i += m; while (k < events.length && Math.round(events[k][0] * SR) <= i) events[k++][1](e); }
  return L;
}
const sine = (e, t) => { e.trackInst(t, 1); e.instParam(t, 0, 2); e.instParam(t, 1, 20000); e.instParam(t, 2, 0.01); e.instParam(t, 4, 1); e.instParam(t, 5, 0.3); };   // Mini Synth triangle, open filter, full sustain
const held = (e, t, p) => e.trackNotes(t, [0, PPQ * 64, p, 0.9, 0], 1);
const rows = [];
function score(name, x, at, ref = [0.15, 0.35]) {
  const base = steps(x, Math.round(ref[0] * SR), Math.round(ref[1] * SR)) || 1e-9, i = Math.round(at * SR), ev = steps(x, i - 48, i + 96);
  rows.push({ name, score: ev / base }); return ev / base;
}
// mute / unmute / solo while a note is held
let x = run((e) => { sine(e, 0); held(e, 0, 64); }, [[0.4, (e) => e.trackMute(0, true)], [0.7, (e) => e.trackMute(0, false)]], 1.0);
score('track mute while a note sounds', x, 0.4); score('track unmute', x, 0.7);
x = run((e) => { sine(e, 0); sine(e, 1); held(e, 0, 64); held(e, 1, 67); }, [[0.4, (e) => e.trackSolo(1, true)]], 0.8);
score('solo another track (this one goes silent)', x, 0.4);
// send jump: track -> Return A only (direct output muted by volume 0), send 0 -> 1 at once
x = run((e) => { sine(e, 0); held(e, 0, 64); e.trackVol(0, 0.0001); e.trackSend(0, 0, 0.1); }, [[0.4, (e) => e.trackSend(0, 0, 1)]], 0.8);
score('send level 10 % -> 100 % at once', x, 0.4);
// voice stealing: Mini Synth has 16 voices, SuperSaw 12: one more held note steals the oldest, which is still sounding
for (const [ty, nm, nv] of [[1, 'Mini Synth', 16], [2, 'SuperSaw', 12]]) {
  x = run((e) => { e.trackInst(0, ty); if (ty === 1) { e.instParam(0, 0, 2); e.instParam(0, 4, 1); } const f = []; for (let k = 0; k < nv; k++) f.push(k * 4, PPQ * 64, 48 + k, 0.5, 0); f.push(PPQ * 2, PPQ * 64, 90, 0.5, 0); e.trackNotes(0, f, f.length / 5); }, [], 1.6);
  score(nm + ': a voice is stolen while it sounds', x, 60 / 120 * 2 + 0.0, [0.6, 0.9]);
  x = run((e) => { e.trackInst(0, ty); if (ty === 1) { e.instParam(0, 0, 2); e.instParam(0, 4, 1); e.instParam(0, 5, 2); } else e.instParam(0, 4, 2); e.trackNotes(0, [0, PPQ, 60, 0.9, 0, PPQ * 1.5, PPQ, 60, 0.9, 0], 2); }, [], 1.6);
  score(nm + ': same note again during its release', x, 60 / 120 * 1.5, [0.55, 0.7]);
}
for (const r of rows) console.log(r.name.padEnd(48), r.score.toFixed(2).padStart(8));
if (CHECK) { let bad = 0; for (const r of rows) { const okk = r.score < 2.5; if (!okk) bad++; console.log((okk ? 'ok   ' : 'FAIL ') + r.name + ': step ' + r.score.toFixed(2) + 'x the steady signal (< 2.5)'); } console.log(bad ? bad + ' FAILED' : 'ALL OK'); process.exit(bad ? 1 : 0); }
