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
ok(pts[4][0] === 3839 && pts[4][2] === -5 && pts[5][0] === 3840 && pts[5][2] === 0, `the slid pitch holds through the note's release, back to 0 at the next note / clip end (${pts[4]} ${pts[5]})`);
{ const c4 = P.addClip(i, P.BAR, P.BAR); c4.notes.push({ t: 0, d: 960, p: 60, v: 0.8 }, { t: 480, d: 240, p: 64, v: 0.8, sl: true }, { t: 1440, d: 480, p: 62, v: 0.8 }); const q = []; P.slideLane(c4, q); ok(q.length >= 12 && q[q.length - 3] - c4.start === 1440 && q[q.length - 1] === 0 && q[q.length - 4] === 4, 'with a next note: back to 0 exactly when it starts'); }
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
// ---- velocity / pan glide: lanes 5 / 6 only when a slide note changes them
{
  const c2 = P.addClip(i, P.BAR * 2, P.BAR);
  c2.notes.push({ t: 0, d: 1920, p: 60, v: 0.8, pan: 0 }, { t: 480, d: 480, p: 60, v: 0.4, pan: 0.5, sl: true });
  const g = []; P.slideLane(c2, g); const by = (k) => { const o = []; for (let j = 0; j < g.length; j += 3) if (g[j + 1] === k) o.push([g[j] - c2.start, g[j + 2]]); return o; };
  const v5 = by(5), v6 = by(6);
  ok(v5.length === 4 && v5[0][0] === 480 && v5[0][1] === 1 && v5[1][0] === 960 && v5[1][1] === 0.5 && v5[2][1] === 0.5 && v5[3][1] === 1, 'slide velocity 0.4 over a 0.8 note: level lane 1 -> 0.5 over the slide, back to 1 at the note end');
  ok(v6.length === 4 && v6[1][1] === 0.5 && v6[3][1] === 0, 'slide pan +0.5: pan lane 0 -> +0.5, back to 0');
  const c3 = P.addClip(i, P.BAR * 4, P.BAR); c3.notes.push({ t: 0, d: 1920, p: 60, v: 0.8 }, { t: 480, d: 480, p: 64, v: 0.8, sl: true });
  const h = []; P.slideLane(c3, h); ok(h.length && [...Array(h.length / 3).keys()].every((j) => h[j * 3 + 1] === 4), 'same velocity / pan: only the pitch lane (older projects unchanged)');
  const rms = (x, a, b) => { let q = 0; for (let k = a; k < b; k++) q += x[k] * x[k]; return Math.sqrt(q / (b - a)); };
  const run = (cc) => { const e2 = new Engine(SR); e2.masterLimit(false); e2.tempo(120); e2.trackInst(0, 32); e2.trackVol(0, 1); e2.trackNotes(0, [0, PPQ * 4, 57, 0.8, 0], 1); if (cc) e2.trackCC(0, cc, cc.length / 3); e2.play();
    const L2 = new Float32Array(N), R2 = new Float32Array(N); for (let k = 0; k < N; k += 128) e2.render(L2.subarray(k, k + 128), R2.subarray(k, k + 128), 128); return { L2, R2 }; };
  const ref = run(null), sv = run([PPQ, 5, 1, PPQ * 2, 5, 0.5]), sp = run([PPQ, 6, 0, PPQ * 2, 6, 1]);
  const r0 = rms(ref.L2, 62400, 86400), r1 = rms(sv.L2, 62400, 86400);
  ok(Math.abs(20 * Math.log10(r1 / r0) + 6.02) < 0.3, `after a velocity slide to half the level is -6 dB (${(20 * Math.log10(r1 / r0)).toFixed(2)} dB)`);
  ok(rms(sp.L2, 62400, 86400) < 0.05 * rms(sp.R2, 62400, 86400), 'after a pan slide to +1 the sound is on the right');
  ok(Math.abs(rms(sv.L2, 4800, 19200) - rms(ref.L2, 4800, 19200)) < 1e-6, 'before the slide nothing changes');
}
// ---- Live instruments read the wheel in units scaled by their own PB Range (bend / 2 x PB Range): a slide note must still glide by exact
// semitones (setBendSl keeps the two apart). A note at 57 sliding -3 semitones must end at 48 + ... = 54 (185.0 Hz), whatever the PB Range.
{
  const { INSTRUMENTS } = await import(path.join(root, 'js/defs.js'));
  const f0At = (x, a, b) => { const z = []; for (let k = a; k < b - 1; k++) if (x[k] < 0 && x[k + 1] >= 0) z.push(k + x[k] / (x[k] - x[k + 1])); if (z.length < 3) return 0; const d = []; for (let k = 1; k < z.length; k++) d.push(z[k] - z[k - 1]); d.sort((p, q) => p - q); return SR / d[d.length >> 1]; };
  for (const [type, name, prm] of [[14, 'Operator', [[22, -60], [38, -60], [54, -60], [83, 1]]], [13, 'Drift', []], [15, 'Analog', []], [16, 'Poli', [[7, 0], [8, 0], [6, 0], [58, 0], [9, 0], [33, 0], [32, 0]]], [17, 'Meld', []]]) {
    const e3 = new Engine(SR); e3.masterLimit(false); e3.tempo(120); e3.trackInst(0, type); INSTRUMENTS[type].params.forEach((q, k) => { if (q && typeof q.def === 'number') e3.instParam(0, k, q.def); }); for (const [k, v] of prm) e3.instParam(0, k, v); e3.trackVol(0, 1);
    e3.trackNotes(0, [0, PPQ * 4, 57, 0.8, 0], 1); e3.trackCC(0, [PPQ, 4, 0, PPQ * 2, 4, -3], 2); e3.play();
    const L3 = new Float32Array(N), R3 = new Float32Array(N); for (let k = 0; k < N; k += 128) e3.render(L3.subarray(k, k + 128), R3.subarray(k, k + 128), 128);
    // low-pass the render (one-pole x4) so the zero crossings are the fundamental's
    const lp = Float32Array.from(L3); for (let pass = 0; pass < 4; pass++) { let y = 0; for (let k = 0; k < lp.length; k++) { y += (lp[k] - y) * 0.03; lp[k] = y; } }
    const fa = f0At(lp, 9600, 22000), fb = f0At(lp, 72000, 90000), st = 12 * Math.log2(fb / fa);
    ok(Math.abs(st + 3) < 0.15, `${name}: a slide note -3 semitones glides exactly -3 (${st.toFixed(2)} st, ${fa.toFixed(1)} -> ${fb.toFixed(1)} Hz)`);
  }
}
console.log(bad ? `\n${bad} FAILED` : '\nSLIDE NOTES OK'); process.exit(bad ? 1 : 0);
