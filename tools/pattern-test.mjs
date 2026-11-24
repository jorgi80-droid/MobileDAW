// Pattern clips (MIDI / drum): source length vs clip length vs loop position, auto vs manual length, playback events.
// Usage: node tools/pattern-test.mjs        (part of tools/run-tests.mjs)
// Playback is checked on the exact event list the engines receive (P.clipNoteEvents, used by syncClips for both the JS and the C++ engine):
// every event must equal sourcePosition = (localClipPosition + lp) % sourceLength.
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const P = await import(path.join(root, 'js/project.js'));
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };

P.newProject(false);
const B = P.BAR, bpm0 = P.state.bpm;
P.addTrack('midi'); const MI = P.state.tracks.length - 1;
P.addTrack('drum'); const DI = P.state.tracks.length - 1;
const kindOf = (i) => P.state.tracks[i].kind;
// a note in bar `bar` (0-based) at step `k` of 4, pitch p
const nt = (bar, k = 0, p = 60, v = 0.8) => ({ t: bar * B + k * (B / 4), d: B / 8, p, v });
const clip = (i, notes, bars = 1) => { const c = P.addClip(i, 0, bars * B); c.notes.push(...notes.map((n) => ({ ...n }))); P.fitPattern(c, kindOf(i)); return c; };
const events = (c, kind) => { const f = []; P.clipNoteEvents(c, kind, f); const out = []; for (let k = 0; k < f.length; k += 5) out.push({ t: f[k] - c.start, d: f[k + 1], p: f[k + 2], v: f[k + 3] }); return out.sort((a, b) => a.t - b.t || a.p - b.p); };
// the specification: sourcePos = (local + lp) % S, a note plays when its source start falls inside the clip, cut at the cycle / clip end
function expected(c) {
  const S = P.patternOf(c), lp = c.ll > 0 ? (c.lp || 0) : 0, out = [];
  for (let k = -1; k * S - lp < c.len; k++) for (const n of c.notes) {
    if (n.t >= S) continue;
    const at = k * S + n.t - lp; if (at < 0 || at >= c.len) continue;
    out.push({ t: at, d: Math.min(n.d, S - n.t, c.len - at), p: n.p, v: n.v });
  }
  return out.sort((a, b) => a.t - b.t || a.p - b.p);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const snap = (c) => JSON.stringify(c.notes);
const barsWithNotes = (ev) => [...new Set(ev.map((e) => Math.floor(e.t / B) + 1))];
const extend = (c, bars) => P.setClipLength(c, bars * B);                 // the arrangement resize / Clip panel path

// ------------------------------------------------------------------ piano roll
for (const [src, to] of [[1, 4], [4, 8], [8, 16], [16, 32]]) {
  const c = clip(MI, [nt(0, 0), nt(src - 1, 2, 64)]);
  ok(P.patternOf(c) === src * B && c.len === src * B, `piano roll: notes up to bar ${src} = ${src}-bar pattern`);
  const s0 = snap(c); extend(c, to);
  const ev = events(c, 'midi');
  ok(c.len === to * B && P.patternOf(c) === src * B && snap(c) === s0, `piano roll: ${src} bar -> ${to} bar: clip ${to} bars, source ${src} bars, notes untouched`);
  ok(same(ev, expected(c)) && ev.length === (to / src) * c.notes.length, `piano roll: ${src} -> ${to}: every cycle replays the source (${ev.length} events)`);
}
{ const c = clip(MI, [nt(0), nt(1), nt(2)]);
  ok(P.patternOf(c) === 4 * B, 'piano roll: notes in bars 1-3 = 4-bar cycle (bar 4 part of it)');
  extend(c, 8); const bars = barsWithNotes(events(c, 'midi'));
  ok(same(bars, [1, 2, 3, 5, 6, 7]), 'piano roll: 3 bars -> 8: bars 5-7 repeat 1-3, bars 4 and 8 stay empty (' + bars + ')'); }
{ const c = clip(MI, [nt(0), nt(1)]);
  ok(P.patternOf(c) === 4 * B, 'piano roll: notes in bars 1-2 = 4-bar cycle (not 2)');
  extend(c, 8); const bars = barsWithNotes(events(c, 'midi'));
  ok(same(bars, [1, 2, 5, 6]), 'piano roll: 2 bars of notes -> 8: bars 3-4 and 7-8 empty, 5-6 repeat 1-2 (' + bars + ')'); }
{ const c = clip(MI, [nt(0), nt(3)]);                                    // 4-bar pattern
  c.notes.push(nt(4)); P.fitPattern(c, 'midi');
  ok(c.len === 8 * B && P.patternOf(c) === 8 * B, 'auto length: a note in bar 5 makes the pattern (and the clip) 8 bars');
  c.notes.pop(); P.fitPattern(c, 'midi');
  ok(c.len === 4 * B && P.patternOf(c) === 4 * B, 'auto length: that note deleted = back to 4 bars (the old bug kept 5)');
  c.notes = c.notes.filter((n) => n.t !== 0); P.fitPattern(c, 'midi');
  ok(P.patternOf(c) === 4 * B && c.notes.length === 1 && c.notes[0].t === 3 * B, 'auto length: empty bars before the last note stay (bar 4 note keeps 4 bars, nothing moves)'); }
{ const c = clip(MI, [nt(0), nt(3)]); const t0 = c.notes.map((n) => n.t);
  ok(same(barsWithNotes(events(c, 'midi')), [1, 4]) && same(c.notes.map((n) => n.t), t0), 'empty bars in the middle of a pattern are kept'); }

// ------------------------------------------------------------------ drum step
for (const [src, to] of [[1, 4], [2, 4], [3, 6], [4, 8], [3, 9]]) {
  const c = clip(DI, [nt(0, 0, 36, 1), nt(0, 2, 38, 0.6), nt(src - 1, 3, 42, 0.45)]);
  ok(P.patternOf(c) === src * B, `drum step: steps up to bar ${src} = ${src}-bar sequence (no rounding to 4 / 8 / 16)`);
  const s0 = snap(c); extend(c, to);
  const ev = events(c, 'drum');
  ok(snap(c) === s0 && c.notes.length === 3, `drum step: ${src} -> ${to}: no step copied into the pattern`);
  ok(same(ev, expected(c)) && ev.length === (to / src) * 3, `drum step: ${src} -> ${to}: ${to / src} cycles of the same steps`);
  const per = new Map(); for (const e of ev) { const k = (e.t % (src * B)) + ':' + e.p; if (!per.has(k)) per.set(k, e.v); else if (per.get(k) !== e.v) per.set(k, NaN); }
  ok([...per.values()].every((v) => !Number.isNaN(v)), `drum step: ${src} -> ${to}: every repeat has the same steps and velocities`);
}
{ const c = clip(DI, [nt(0, 0, 36)]); P.setPatternBase(DI, c.id, 2 * B);
  ok(P.patternOf(c) === 2 * B && c.len === 2 * B, 'drum step: a 2-bar sequence with an empty bar 2 (manual pattern length)');
  extend(c, 4); ok(same(barsWithNotes(events(c, 'drum')), [1, 3]), 'drum step: 2-bar sequence -> 4 bars: bar 3 repeats bar 1, bars 2 and 4 empty');
  c.notes.push(nt(2, 0, 36)); P.fitPattern(c, 'drum'); ok(P.patternOf(c) === 3 * B && c.len === 4 * B, 'drum step: a step in bar 3 grows the sequence to 3 bars (clip stays 4: sized by hand)');
  c.notes.pop(); P.fitPattern(c, 'drum'); ok(P.patternOf(c) === 2 * B, 'drum step: that step deleted = back to the 2-bar sequence (not 1)'); }

// ------------------------------------------------------------------ arrangement / resize
{ const c = clip(MI, [nt(0), nt(0, 3, 67)]);                              // 1-bar pattern
  const s0 = snap(c); extend(c, 4); ok(c.cm && P.patternOf(c) === B && snap(c) === s0, 'extending a clip changes only the clip length');
  c.notes.push(nt(1, 1, 62)); P.fitPattern(c, 'midi'); ok(c.len === 4 * B && P.patternOf(c) === 4 * B, 'hand-sized clip: a note in bar 2 makes the cycle 4 bars, the clip stays 4');
  c.notes.pop(); P.fitPattern(c, 'midi'); ok(c.len === 4 * B && P.patternOf(c) === B, 'hand-sized clip: deleting the note does NOT shorten the clip (cycle back to 1 bar)');
  extend(c, 2); ok(c.len === 2 * B && snap(c) === s0, 'shortening a clip keeps every source note');
  extend(c, 2.5); const ev = events(c, 'midi');
  ok(c.len === 2.5 * B && same(ev, expected(c)) && ev.every((e) => e.t + e.d <= c.len && e.d > 0), 'a clip can end in the middle of a cycle (2.5 bars); notes are cut at the clip end');
  extend(c, 1); ok(!c.ll && c.len === B && c.cm, 'resized back to its cycle: no loop field left (old files read the same)'); }
{ const c = clip(MI, [nt(0), nt(1, 2, 64), nt(2, 1, 67), nt(3, 3, 71)]);     // 4-bar cycle
  extend(c, 10); const whole = events(c, 'midi').map((e) => ({ ...e, t: e.t + c.start }));
  // left trim by 1.5 bars (the arrangement: start moves, the cycle position c.lp follows)
  const L = P.patternOf(c), sh = 1.5 * B, s0 = snap(c);
  c.start += sh; c.len -= sh; c.ll = L; c.lp = sh % L; c.cm = true; P.normLoop(c);
  const trimmed = events(c, 'midi').map((e) => ({ ...e, t: e.t + c.start }));
  ok(snap(c) === s0 && same(trimmed, whole.filter((e) => e.t >= c.start).map((e) => ({ ...e, d: e.d }))), 'left trim: the clip starts inside the cycle (lp), the notes keep their time, the source is untouched');
  ok(same(events(c, 'midi'), expected(c)), 'left trim: sourcePos = (local + lp) % cycle');
  // split in the middle of a cycle: the two halves play exactly what the whole clip played
  P.state.tracks[MI].clips = [c]; const before = events(c, 'midi').map((e) => ({ ...e, t: e.t + c.start }));
  P.splitClip(MI, c.id, c.start + 3 * B + B / 4);
  const halves = P.state.tracks[MI].clips.flatMap((q) => events(q, 'midi').map((e) => ({ ...e, t: e.t + q.start }))).sort((a, b) => a.t - b.t || a.p - b.p);
  const cut = c.start + c.len, exp = before.map((e) => (e.t < cut && e.t + e.d > cut ? { ...e, d: cut - e.t } : e));
  ok(same(halves, exp), 'split inside a cycle: both halves together play the same notes (no note copied into the pattern data)');
  ok(P.state.tracks[MI].clips.every((q) => snap(q) === s0), 'split: both halves keep the full pattern source'); }
{ const c = clip(MI, [nt(0), nt(2, 1, 65)]); extend(c, 8); const ev0 = events(c, 'midi');
  P.bakeLoop(c, MI); ok(same(events(c, 'midi'), ev0) && !c.ll && c.len === 8 * B, '"Lepas loop" (on request only) bakes exactly what played'); }

// ------------------------------------------------------------------ save / load keeps the four values apart
{ P.state.tracks[MI].clips = []; const c = clip(MI, [nt(0), nt(1)]); extend(c, 7); c.start = 2 * B; c.lp = B; c.ll = 4 * B; P.normLoop(c);
  const pre = { len: c.len, ll: c.ll, lp: c.lp, pb: c.pb, cm: c.cm, notes: snap(c) }, ev0 = events(c, 'midi');
  await P.deserialize(P.serialize());
  const q = P.state.tracks.find((t) => t.kind === 'midi').clips[0];
  ok(q && same({ len: q.len, ll: q.ll, lp: q.lp, pb: q.pb, cm: q.cm, notes: snap(q) }, pre) && same(events(q, 'midi'), ev0), 'save / load: clip length, cycle, loop position, base length and notes come back apart, same playback'); }

// ------------------------------------------------------------------ regression: the event list of plain / looped clips (no lp) is what the
// old engine sync produced (the previous algorithm, copied here as the reference)
function oldEvents(c, kind) {
  const ll = P.loopOf(c), reps = ll ? Math.min(512, Math.ceil(c.len / ll)) : 1, out = [];
  for (let k = 0; k < reps; k++) { const o = ll ? k * ll : 0, lim = ll ? Math.min(ll, c.len - o) : c.len; for (const n of c.notes) { if (n.t >= lim) continue; out.push({ t: o + n.t, d: Math.min(n.d, lim - n.t), p: n.p, v: n.v }); } }
  return out.sort((a, b) => a.t - b.t || a.p - b.p);
}
{ let s = 7; const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; let all = true, dup = false, hang = false;
  for (let k = 0; k < 300; k++) {
    const notes = []; for (let j = 0; j < 1 + (r() * 12 | 0); j++) notes.push({ t: Math.floor(r() * 6 * B / 60) * 60, d: 30 + Math.floor(r() * B), p: 36 + (r() * 40 | 0), v: Math.round(r() * 100) / 100 });
    const c = { id: 'r' + k, start: Math.floor(r() * 8) * B, len: (1 + Math.floor(r() * 16)) * B / 2, notes };
    if (r() < 0.6) c.ll = (1 + Math.floor(r() * 8)) * B / 2;
    const kind = r() < 0.5 ? 'midi' : 'drum', ev = events(c, kind);
    if (!same(ev, oldEvents(c, kind))) all = false;
    const keys = ev.map((e) => e.t + ':' + e.p + ':' + e.v + ':' + e.d); const src = new Set(c.notes.map((n) => n.t + ':' + n.p)).size === c.notes.length;
    if (src && new Set(keys).size !== keys.length) dup = true;
    if (ev.some((e) => !(e.d > 0) || e.t + e.d > c.len)) hang = true;
  }
  ok(all, 'regression: 300 random plain / looped clips play exactly the events of the previous engine sync');
  ok(!dup, 'regression: no note triggers twice at the same place');
  ok(!hang, 'regression: no note hangs past its cycle / clip end (no stuck notes)'); }
// step graph Note Repeat (FL Studio Mobile): rpt triggers inside the step, in the event list both engines get; the source keeps ONE note
{ const c = clip(DI, [{ t: 0, d: 200, p: 36, v: 0.9, rpt: 4 }, { t: 480, d: 200, p: 38, v: 0.7 }], 1); const ev = events(c, 'drum');
  const k = ev.filter((e) => e.p === 36);
  ok(k.length === 4 && k.map((e) => e.t).join() === '0,60,120,180' && k.every((e) => e.d <= 54 && e.v === 0.9), 'Note Repeat 4: four kicks 1/64 apart inside the step, same velocity (' + k.map((e) => e.t + '/' + e.d).join(' ') + ')');
  ok(ev.filter((e) => e.p === 38).length === 1 && c.notes.length === 2, 'other steps play once; the source keeps one note per step (no copies)');
  const c8 = clip(DI, [{ t: 0, d: 200, p: 36, v: 0.9, rpt: 8 }], 1); ok(events(c8, 'drum').length === 8, 'Note Repeat 8: eight triggers');
  const cm = clip(MI, [{ t: 0, d: 200, p: 60, v: 0.9, rpt: 4 }], 1); ok(events(cm, 'midi').length === 1, 'repeat only applies to drum steps'); }
ok(P.state.bpm === bpm0, 'regression: tempo unchanged');

console.log(bad ? bad + ' FAILED' : 'ALL OK'); process.exit(bad ? 1 : 0);
