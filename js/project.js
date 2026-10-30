// Project model + the one place that talks to the engine about project data.
// The UI edits `state`; this module mirrors changes into the native engine.
import { eng, MASTER, RET0, hooks } from './engine.js';
import { processBuffers, detectBpm } from './engine/audioops.js';
import { INSTRUMENTS, DEVICES, DRUM_PADS, INST, PRESETS, normOf, valOf } from './defs.js';

export const PPQ = 960, MAX_TRACKS = 64;
export let BEAT = PPQ, BAR = PPQ * 4;   // live bindings: they change with the time signature (setSig), so always read them at use time
import { TempoMap } from './engine/tmap.js';
import { MeterMap } from './engine/meter.js';
export const COLORS = ['#5cffe8', '#f7f47c', '#ffa529', '#ff94a6', '#8bc5ff', '#d86ce4', '#bffb00', '#ff3636'];   // Ableton Live's bright track colours
const OLD_COLORS = ['#6fe0e6', '#f5e05a', '#ff9d63', '#f38fb8', '#8fa0f7', '#b98ae8', '#86dc7e', '#ef7a6a'];        // pastel set of older projects: mapped to the same slot of the new set
export const AUTO_COLOR = '#9fb4d8';

export const state = {
  bpm: 120, loop: { on: false, start: 0, end: BAR * 4 }, metro: false,
  sig: { n: 4, d: 4 }, sigs: [], markers: [], groove: { amt: 0, grid: 240 }, countIn: 0, punch: { on: false, start: 0, end: 0 }, recLoop: false,
  playing: false, pos: 0, cpu: 0, meters: new Array(146).fill(0), ccLinks: {},
  tracks: [], master: { vol: 1, devices: [] }, returns: makeReturns(),
  sel: { track: 0, clip: null },
  nextSample: 16, samples: {}, projectName: 'Untitled',
};

let _id = 1;
const uid = () => _id++;
const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = (what) => listeners.forEach((f) => f(what));
// Undo hook, filled in by js/history.js. hit(key) = true when this change belongs to the gesture already recorded (a knob being dragged); add(entry) stores
// a small "before" entry. on is false while an undo / redo / project load runs, so replayed changes are not recorded again.
export const HK = { on: true, hit: () => false, add: () => {}, group: (f) => f(), barrier: () => {} };
// ------------------------------------------------------------------ time signature, markers, tempo map, groove
export const SIGS = [[2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [3, 8], [5, 8], [6, 8], [7, 8], [9, 8], [12, 8]];
// meter map: state.sig = signature from bar 1, state.sigs = [{ bar (0-based, > 0), n, d }] = changes later in the song. BAR / BEAT stay the length of the FIRST signature (default clip length etc.);
// everything that depends on where a bar really starts must use barStart / barAt / barFloor / barCeil / barRound (they follow the changes).
export const MM = new MeterMap();
export const MAX_SIG_CHANGES = 64;
const okD = (d) => ([1, 2, 4, 8, 16].includes(+d) ? +d : 4), okN = (n) => Math.max(1, Math.min(32, Math.round(+n) || 4));
export const meterFlat = () => { const f = [0, state.sig.n, state.sig.d]; for (const c of state.sigs) f.push(c.bar, c.n, c.d); return f; };
function rebuildMeter() {
  let prev = { n: state.sig.n, d: state.sig.d }; const out = [];
  for (const c of [...state.sigs].filter((x) => x && Number.isFinite(x.bar) && x.bar > 0).sort((a, b) => a.bar - b.bar)) {
    const n = okN(c.n), d = okD(c.d), bar = Math.round(c.bar);
    if (out.length && out[out.length - 1].bar === bar) out.pop();
    if (n === prev.n && d === prev.d) continue;          // no real change
    out.push({ bar, n, d }); prev = { n, d };
    if (out.length >= MAX_SIG_CHANGES) break;
  }
  state.sigs = out; MM.set(meterFlat());
}
export const barStart = (k) => MM.barStart(k), barAt = (t) => MM.barAt(t), barFloor = (t) => MM.barFloor(t), barCeil = (t) => MM.barCeil(t), barRound = (t) => MM.barRound(t);
export const barLenAt = (t) => MM.barLenAt(t), beatLenAt = (t) => MM.beatLenAt(t), beatRound = (t) => MM.beatRound(t);
export const sigAtTick = (t) => ({ n: MM.nAt(t), d: MM.dAt(t) });
export const sigTextAt = (t) => { const s = sigAtTick(t); return s.n + '/' + s.d; };
export function applySig(n, d, sigs) {
  state.sig = { n: okN(n), d: okD(d) }; BEAT = Math.round(PPQ * 4 / state.sig.d); BAR = BEAT * state.sig.n;
  if (sigs !== undefined) state.sigs = Array.isArray(sigs) ? sigs.map((c) => ({ bar: +c.bar, n: +c.n, d: +c.d })) : [];
  rebuildMeter();
}
export const sigText = () => state.sig.n + '/' + state.sig.d;
export function syncMeter() { eng.sig(BEAT, state.sig.n); eng.meter(meterFlat()); }
const meterSnap = () => ({ sig: { n: state.sig.n, d: state.sig.d }, sigs: state.sigs.map((c) => ({ ...c })) });
function restoreMeter(m) {
  applySig(m.sig.n, m.sig.d, m.sigs);
  if (state.loop.end <= state.loop.start) state.loop.end = state.loop.start + BAR;
  syncMeter(); eng.loop(state.loop.on, state.loop.start, state.loop.end);
  emit('transport'); emit('clips');
}
export function setSig(n, d) {                               // signature from bar 1
  if (HK.on && !(okN(n) === state.sig.n && okD(d) === state.sig.d)) HK.add({ t: 'meter', v: meterSnap() });
  applySig(n, d);
  if (state.loop.end <= state.loop.start) state.loop.end = state.loop.start + BAR;
  syncMeter(); eng.loop(state.loop.on, state.loop.start, state.loop.end);
  emit('transport'); emit('clips');
}
// signature change at a bar (0-based). bar 0 = the project signature. A change equal to the one before it is dropped.
export function setSigAt(bar, n, d) {
  bar = Math.max(0, Math.round(bar));
  if (bar === 0) return setSig(n, d);
  const i = state.sigs.findIndex((c) => c.bar === bar), c = { bar, n: okN(n), d: okD(d) };
  if (i < 0 && state.sigs.length >= MAX_SIG_CHANGES) return false;
  if (HK.on) HK.add({ t: 'meter', v: meterSnap() });
  if (i >= 0) state.sigs[i] = c; else state.sigs.push(c);
  rebuildMeter(); syncMeter(); emit('transport'); emit('clips'); return true;
}
export function removeSigAt(bar) {
  const i = state.sigs.findIndex((c) => c.bar === bar); if (i < 0) return;
  if (HK.on) HK.add({ t: 'meter', v: meterSnap() });
  state.sigs.splice(i, 1); rebuildMeter(); syncMeter(); emit('transport'); emit('clips');
}
// tempo map (tempo lane = an automation track whose target.kind is 6): tmain mirrors what the engine plays, so the UI and export use the same time
const tmain = new TempoMap();
export const TEMPO_DEF = { min: 20, max: 300, step: 0.01, unit: 'BPM', fmt: 'bpm' };
export const tempoLane = () => state.tracks.findIndex((t) => t.kind === 'auto' && t.target && t.target.kind === 6);
let tmOn = false, tmKey = '';
export const tempoMapOn = () => tmOn;
export function tempoPts() {
  const i = tempoLane(); if (i < 0) return [];
  const t = state.tracks[i]; if (t.mute) return [];
  const flat = []; let last = null;
  for (const c of [...t.clips].sort((a, b) => a.start - b.start)) {
    if (c.muted || !c.pts || !c.pts.length) continue;
    const sorted = [...c.pts].sort((a, b) => a.t - b.t);
    if (last !== null && c.start > last.tick) flat.push(c.start - 1, last.value);
    for (const q of sorted) flat.push(c.start + q.t, valOf(TEMPO_DEF, q.v));
    last = { tick: c.start + c.len, value: valOf(TEMPO_DEF, sorted[sorted.length - 1].v) };
  }
  return flat;
}
export function syncTempoMap() {
  const f = tempoPts(); tmain.set(f); tmOn = f.length >= 2;
  tmKey = tmOn ? f.join(',') : '';
  eng.tempoMap(tmOn, tmOn ? f : []);
  scheduleBake();
}
export const bpmAt = (tick) => (tmOn ? tmain.bpmAt(tick) : state.bpm);
export const tickToSec = (tick) => (tmOn ? tmain.tickToSec(tick) : tick / PPQ * 60 / state.bpm);
export const secToTick = (sec) => (tmOn ? tmain.secToTick(sec) : sec * state.bpm / 60 * PPQ);
// markers: { id, t, name, color }
export const MARKER_COLORS = ['#ffa722', '#5cffe8', '#ff94a6', '#bffb00', '#8bc5ff', '#d86ce4', '#f7f47c', '#ff3636'];
const marksSnap = () => state.markers.map((m) => ({ ...m }));
export function addMarker(t, name, color) {
  t = Math.max(0, Math.round(t));
  const hit = state.markers.find((m) => m.t === t); if (hit) return hit;
  if (HK.on) HK.add({ t: 'marks', v: marksSnap() });
  const m = { id: uid(), t, name: name || 'Marker ' + (state.markers.length + 1), color: color || MARKER_COLORS[state.markers.length % MARKER_COLORS.length] };
  state.markers.push(m); state.markers.sort((a, b) => a.t - b.t); emit('markers'); return m;
}
export function editMarker(id, patch) { const m = state.markers.find((x) => x.id === id); if (!m) return; if (HK.on && !HK.hit('mk' + id)) HK.add({ t: 'marks', v: marksSnap() }); Object.assign(m, patch); if ('t' in patch) { m.t = Math.max(0, Math.round(m.t)); state.markers.sort((a, b) => a.t - b.t); } emit('markers'); }
export function removeMarker(id) { if (!state.markers.some((m) => m.id === id)) return; if (HK.on) HK.add({ t: 'marks', v: marksSnap() }); state.markers = state.markers.filter((m) => m.id !== id); emit('markers'); }
export function jumpMarker(dir) {
  const p = state.pos, l = state.markers; let m;
  if (dir > 0) m = l.find((x) => x.t > p + 1); else { for (const x of l) if (x.t < p - 1) m = x; }
  if (m) seekTo(m.t); return m || null;
}
export function loopBetween(a, b) { const l = state.markers; if (!a || !b) return; const s = Math.min(a.t, b.t), e = Math.max(a.t, b.t); if (e <= s) return; setLoop({ on: true, start: s, end: e }); }
// groove / swing: delays the notes that sit on the odd positions of the grid (default 1/16). Applied when notes are sent to the engine, so playback and export match.
export function setGroove(patch) { if (HK.on && !HK.hit('groove')) HK.add({ t: 'groove', v: { amt: state.groove.amt, grid: state.groove.grid } }); Object.assign(state.groove, patch); state.groove.amt = Math.max(0, Math.min(1, +state.groove.amt || 0)); for (let i = 0; i < state.tracks.length; i++) { const k = state.tracks[i].kind; if (k === 'midi' || k === 'drum') touchClips(i); } scheduleBake(); emit('transport'); }
export const swingOf = (c) => (c.swing != null && c.swing >= 0 ? c.swing : state.groove.amt);
function swingShift(c, t) {
  const a = swingOf(c); if (!a) return 0;
  const g = state.groove.grid || 240, k = Math.round(t / g);
  return (k & 1) && Math.abs(t - k * g) < g / 4 ? Math.round(a * g * 0.5) : 0;
}

function makeReturns() { return [0, 1].map((k) => ({ name: 'Return ' + 'AB'[k], vol: 0.85, pan: 0, mute: false, devices: [] })); }
export const tr = (i) => (i === MASTER ? state.master : i >= RET0 ? state.returns[i - RET0] : state.tracks[i]);
const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16);

// ------------------------------------------------------------------ engine sync

// ------------------------------------------------------------------ clip loop
// A clip dragged longer than its content repeats that content (like FL Studio Mobile / Live) instead of showing empty bars.
// `c.ll` = length in ticks of the content that repeats; it only matters while c.len > c.ll.
export const loopOf = (c) => (c.ll > 0 && c.len > c.ll ? c.ll : 0);
// the pieces a looped clip plays: [{ o: where in the clip (ticks), len, s: where inside the content it starts (ticks) }]; `c.lp` = loop phase of a clip that was split from the middle of a loop
export function loopSegs(c) {
  const ll = c.ll > 0 ? c.ll : 0;
  if (!ll) return [{ o: 0, len: c.len, s: 0 }];
  const out = [];
  let o = 0, ph = (c.lp || 0) % ll;
  while (o < c.len && out.length < 512) { const seg = Math.min(ll - ph, c.len - o); out.push({ o, len: seg, s: ph }); o += seg; ph = 0; }
  return out;
}
// content length of a clip before it is stretched out: MIDI/drum = its own length, audio = what is left of the sample after the offset
export function contentLen(c, kind) {
  if (c.ll > 0) return c.ll;
  if (kind === 'audio') {
    const es = c.dsample || c.sample;
    if (es && es.duration > 0) return Math.max(PPQ / 4, Math.min(c.len, Math.round((es.duration - (c.offset || 0)) * state.bpm / 60 * PPQ)));
  }
  return c.len;
}
// Turn the repeats of a looped MIDI clip into real notes (needed before anything edits the clip's inside: split, left-trim, piano roll).
export function bakeLoop(c, i) {
  const ll = loopOf(c);
  if (!ll || !c.notes) { if (c.ll) delete c.ll; return false; }
  const src = c.notes.filter((n) => n.t < ll).map((n) => ({ ...n, d: Math.min(n.d, ll - n.t) })), out = [];
  for (let o = 0; o < c.len; o += ll) for (const n of src) { if (o + n.t < c.len) out.push({ ...n, t: o + n.t, d: Math.min(n.d, c.len - o - n.t) }); }
  c.notes = out; delete c.ll;
  if (i !== undefined) syncClips(i);
  return true;
}
// Clip transpose for MIDI / synth clips: playback only, the notes in the piano roll stay as written (field c.xpose, default 0).
export function setClipXpose(i, id, st) {
  const t = state.tracks[i], c = t && t.clips.find((x) => x.id === id);
  if (!c || !c.notes || t.kind === 'drum') return { error: 'Transpose hanya untuk klip MIDI non-drum.' };
  st = Math.max(-48, Math.min(48, Math.round(st) || 0));
  if (st) c.xpose = st; else delete c.xpose;
  syncClips(i); emit('clips'); emit('notes');
  return { ok: true, st };
}
// Repeat the content of a MIDI / drum clip n times (real notes, so the piano roll shows them). The clip grows to n x its current length.
export function repeatClipContent(i, id, n) {
  const t = state.tracks[i], c = t && t.clips.find((x) => x.id === id);
  if (!c || !c.notes) return { error: 'Klip ini tidak punya not.' };
  n = Math.max(2, Math.min(64, n | 0)); bakeLoop(c, i);
  const base = c.len, src = c.notes.map((x) => ({ ...x })), out = [];
  for (let k = 0; k < n; k++) for (const x of src) out.push({ ...x, t: x.t + k * base });
  c.notes = out; c.len = base * n;
  syncClips(i); emit('clips'); emit('notes');
  return { ok: true };
}
// Audio clip loop: n > 1 repeats the clip's region n times (c.ll = region length, c.len = n x ll); n = 1 switches the loop off.
export function setAudioLoop(i, id, n) {
  const t = state.tracks[i], c = t && t.clips.find((x) => x.id === id);
  if (!c || t.kind !== 'audio') return { error: 'Klip audio tidak ditemukan.' };
  const one = c.ll > 0 ? c.ll : c.len;
  n = Math.max(1, Math.min(64, n | 0));
  if (n === 1) { delete c.ll; delete c.lp; c.len = one; }
  else { c.ll = one; c.lp = 0; c.len = one * n; }
  syncClips(i); emit('clips');
  return { ok: true };
}
export function setClipsMuted(list, m) {
  const touched = new Set();
  for (const { i, c } of list) { c.muted = !!m; touched.add(i); }
  for (const i of touched) syncClips(i);
  emit('clips');
}

export function syncClips(i) {
  const t = state.tracks[i];
  if (!t) return;
  if (t.kind === 'auto') { syncAutomation(); return; }
  const f = [];
  let n = 0;
  if (t.kind === 'audio') {
    for (const c of t.clips) {
      if (c.muted) continue;
      const bk = bakeCurrent(c);       // grid-locked clip on a tempo map / with swing: one pre-warped buffer that starts at the clip start
      if (bk) { f.push(c.start, c.len, bk.sample.id, c.gain, 0, c.fadeIn || 0, c.fadeOut || 0); n++; continue; }
      const es = c.dsample || c.sample;
      const segs = loopSegs(c);       // clip dragged longer than its audio: the audio repeats instead of leaving silence
      segs.forEach((g, k) => { f.push(c.start + g.o, g.len, es.id, c.gain, (c.offset || 0) + g.s / PPQ * 60 / state.bpm, k === 0 ? c.fadeIn || 0 : 0, k === segs.length - 1 ? c.fadeOut || 0 : 0); n++; });
    }
    eng.trackClips(i, f, n);
  } else {
    for (const c of t.clips) {
      if (c.muted) continue;
      const ll = loopOf(c), reps = ll ? Math.min(512, Math.ceil(c.len / ll)) : 1, xp = t.kind === 'drum' ? 0 : (c.xpose | 0);   // longer than its content: the notes loop; xpose = clip transpose (semitones, playback only)
      for (let k = 0; k < reps; k++) {
        const o = ll ? k * ll : 0, lim = ll ? Math.min(ll, c.len - o) : c.len;
        for (const nt of c.notes) {
          if (nt.t >= lim) continue;
          const sw = swingShift(c, o + nt.t);
          f.push(c.start + o + nt.t + sw, Math.min(nt.d, lim - nt.t), xp ? Math.max(0, Math.min(127, nt.p + xp)) : nt.p, nt.v, nt.pan || 0);
          n++;
        }
      }
    }
    eng.trackNotes(i, f, n);
    const cf = []; let cn = 0;                                   // controller lanes (pitch bend, CC7 / 10 / 11) of the clips
    const KIND = { bend: 0, 7: 1, 10: 2, 11: 3 };
    for (const c of t.clips) {
      if (c.muted || !c.cc) continue;
      const ll = loopOf(c), reps = ll ? Math.min(512, Math.ceil(c.len / ll)) : 1;
      for (const l of c.cc) {
        const kd = l.k === 'bend' ? 0 : KIND[l.n]; if (kd === undefined) continue;
        for (let k = 0; k < reps; k++) { const o = ll ? k * ll : 0, lim = ll ? Math.min(ll, c.len - o) : c.len; for (const q of l.pts) if (q.t <= lim) { cf.push(c.start + o + q.t, kd, q.v); cn++; } }
      }
    }
    eng.trackCC(i, cf, cn);
  }
}

const dirty = new Set();
let pending = false;
// Drags can produce hundreds of edits per second; the engine only needs the latest state once per frame.
export function touchClips(i) {
  dirty.add(i);
  if (pending) return;
  pending = true;
  raf(() => { pending = false; for (const k of dirty) syncClips(k); dirty.clear(); });
}

function syncDevices(i) {
  const t = tr(i);
  if (t.devices.some((d) => !DEVICES[d.type])) t.devices = t.devices.filter((d) => DEVICES[d.type]);   // devices that no longer exist (MultiFX was removed) are dropped
  t.devices.forEach((d, di) => {
    const dp = DEVICES[d.type] && DEVICES[d.type].params;     // projects saved before a parameter existed: fill the new ones with their defaults
    if (dp) { if (!Array.isArray(d.params)) d.params = []; for (let k = 0; k < dp.length; k++) if (!Number.isFinite(d.params[k])) d.params[k] = dp[k].def; }
    eng.insertDevice(i, di, d.type);
    d.params.forEach((v, pi) => eng.devParam(i, di, pi, v));
    if (d.bypass) eng.devBypass(i, di, true);
  });
}

export function syncTrackFull(i) {
  const t = state.tracks[i];
  eng.resetTrack(i);
  if (t.inst) {
    eng.trackInst(i, t.inst.type);
    if (t.inst.type === 11 && t.inst.params && t.inst.params[90] !== undefined) { if (t.inst.params[106] === undefined) t.inst.params[106] = t.inst.params[90]; delete t.inst.params[90]; }   // old projects: Vel>Filter Res moved from 90 (pitch) to 106
    for (const [k, v] of Object.entries(t.inst.params)) eng.instParam(i, +k, v);
    eng.instParam(i, 90, t.inst.pitch || 0);
  }
  syncZones(i);
  syncPads(i);
  syncSoundFont(i);
  syncDevices(i);
  eng.trackVol(i, t.vol); eng.trackPan(i, t.pan); eng.trackMute(i, t.mute); eng.trackSolo(i, t.solo);
  eng.send(i, 0, t.send ? t.send[0] : 0); eng.send(i, 1, t.send ? t.send[1] : 0);
  eng.trackOut(i, t.out >= 0 && t.out < state.returns.length ? t.out : -1);
  syncClips(i);
}

export function syncAll() {
  for (let i = 0; i < MAX_TRACKS; i++) {
    if (i < state.tracks.length) syncTrackFull(i); else eng.resetTrack(i);
  }
  eng.resetTrack(MASTER);
  syncDevices(MASTER);
  eng.trackVol(MASTER, state.master.vol);
  state.returns.forEach((r, k) => {
    eng.resetTrack(RET0 + k);
    syncDevices(RET0 + k);
    eng.trackVol(RET0 + k, r.vol); eng.trackPan(RET0 + k, r.pan); eng.trackMute(RET0 + k, r.mute);
  });
  for (let k = state.returns.length; k < MAX_FX; k++) eng.resetTrack(RET0 + k);   // effect tracks that no longer exist
  syncAutomation();
  eng.tempo(state.bpm);
  syncMeter();
  syncTempoMap();
  eng.loop(state.loop.on, state.loop.start, state.loop.end);
  eng.metro(state.metro);
}

// ------------------------------------------------------------------ transport

export function play() { eng.play(); }
export function stop() { eng.stop(); }
export function togglePlay() { (state.playing ? stop : play)(); }
export function seekTo(tick) { state.pos = Math.max(0, tick); eng.seek(state.pos); }
const lanePts = () => { const i = tempoLane(); return i < 0 ? null : state.tracks[i].clips.map((c) => ({ id: c.id, pts: (c.pts || []).map((q) => ({ ...q })) })); };
export function setBpm(b) {
  const old = state.bpm, nb = Math.max(20, Math.min(300, b));
  if (HK.on && nb !== old && !HK.hit('bpm')) HK.add({ t: 'bpm', v: old, lane: tmOn ? lanePts() : null });
  state.bpm = nb;
  if (tmOn && old > 0) { const k = state.bpm / old, i = tempoLane(); if (i >= 0) { for (const c of state.tracks[i].clips) for (const q of (c.pts || [])) q.v = normOf(TEMPO_DEF, Math.max(20, Math.min(300, valOf(TEMPO_DEF, q.v) * k))); syncTempoMap(); } }   // with tempo automation the BPM box scales the whole curve
  eng.tempo(state.bpm); emit('transport');
}
export function setLoop(patch) {
  if (HK.on && ('start' in patch || 'end' in patch) && !HK.hit('loop')) HK.add({ t: 'loop', v: { start: state.loop.start, end: state.loop.end } });
  Object.assign(state.loop, patch);
  if (state.loop.end <= state.loop.start) state.loop.end = state.loop.start + BAR;
  eng.loop(state.loop.on, state.loop.start, state.loop.end);
  emit('transport');
}
export function setCountIn(n) { state.countIn = [0, 1, 2, 4].includes(n) ? n : 0; emit('transport'); }
export function setRecLoop(on) { state.recLoop = !!on; emit('transport'); }
export function setPunch(patch) {
  const q = state.punch; Object.assign(q, patch);
  if (q.on && !(q.end > q.start)) { const L = state.loop; if (L.end > L.start) { q.start = L.start; q.end = L.end; } else { q.start = barStart(1); q.end = barStart(3); } }
  q.start = Math.max(0, Math.round(q.start)); q.end = Math.max(q.start + BEAT, Math.round(q.end));
  emit('transport');
}
export function toggleMetro() { state.metro = !state.metro; eng.metro(state.metro); emit('transport'); }

// Playhead clock. The engine reports its position ~30x per second; between reports the position is extrapolated from the tempo.
// A report is used ONCE (stamped with its arrival time, `rx`): re-reading the same stale report every frame used to restart the
// extrapolation from an old position and made the playhead stutter. A fresh report only nudges the clock (25 %) unless it is far
// off (seek, loop wrap, start/stop) - that keeps scrolling smooth at 60-120 Hz.
const clk = { tick: 0, at: 0, rx: -1 };
function clkAt(now) { return clk.tick + (now - clk.at) / 60000 * bpmAt(clk.tick) * PPQ; }
export function applyPoll(p) {
  if (!p || typeof p !== 'object' || p.error) return;
  const was = state.playing;
  state.playing = p.playing; state.cpu = p.cpu / 1000; state.meters = p.m; state.load = p.tl || null;   // load: [voices, per mille of the block budget] per track (only while the mixer is open)
  const rx = p.rx || performance.now();
  if (p.rx && p.rx === clk.rx) return;                        // same report as last time: nothing new about the position
  clk.rx = p.rx || -1;
  state.pos = p.pos; cinOn = !!p.cin;
  if (rec.on) recWatch(p);
  if (p.playing && was && clk.at) {
    const pred = clkAt(rx), err = p.pos - pred, lim = 0.12 * bpmAt(p.pos) / 60 * PPQ;   // 120 ms
    if (Math.abs(err) < lim) { clk.tick = pred + err * 0.25; clk.at = rx; return; }
  }
  clk.tick = p.pos; clk.at = rx;
}

// ------------------------------------------------------------------ tracks

export function addTrack(kind) {
  if (state.tracks.length >= MAX_TRACKS) return null;
  const n = state.tracks.length + 1;
  const names = { midi: 'Synth', drum: 'Drums', audio: 'Audio' };
  const t = {
    id: uid(), name: `${names[kind]} ${n}`, color: COLORS[(n - 1) % COLORS.length], kind,
    inst: kind === 'audio' ? null : { type: kind === 'drum' ? INST.DRUM : INST.MINISYNTH, params: {} },
    clips: [], devices: [], vol: 0.85, pan: 0, mute: false, solo: false, send: [0, 0], out: -1,   // out: -1 = Master, k = effect track k
  };
  state.tracks.push(t);
  if (HK.on) HK.add({ t: 'trk', present: true, r: { gone: t, items: [{ t, at: state.tracks.length - 1 }], src: [] } });
  syncTrackFull(state.tracks.length - 1);
  emit('tracks');
  return t;
}

// Sidechain sources (Autoduck) are stored as track numbers; after tracks move or disappear they must follow the track, not the number.
export function remapSources(oldIds) {
  const chains = [state.master, ...state.returns, ...state.tracks];
  for (const c of chains) for (const d of c.devices) {
    const def = DEVICES[d.type];
    if (!def) continue;
    def.params.forEach((p, k) => {
      if (p.fmt !== 'src' || !(d.params[k] >= 1)) return;
      const id = oldIds[d.params[k] - 1], nk = id === undefined ? -1 : state.tracks.findIndex((t) => t.id === id);
      d.params[k] = nk < 0 ? 0 : nk + 1;
    });
  }
}

// Taking a track out (with the automation lanes that point at it) is reversible: the record keeps the track objects, their old positions and the
// Autoduck source numbers that remapSources rewrites, so undo can put everything back exactly.
function snapSources() {
  const o = [];
  for (const c of [state.master, ...state.returns, ...state.tracks]) for (const d of c.devices) { const def = DEVICES[d.type]; if (def) def.params.forEach((p, k) => { if (p.fmt === 'src') o.push({ a: d.params, k, v: d.params[k] }); }); }
  return o;
}
function detachTrack(i) {
  const gone = state.tracks[i], oldIds = state.tracks.map((t) => t.id), src = snapSources();
  const items = [{ t: gone, at: i }];
  state.tracks.forEach((t, k) => { if (k !== i && t.kind === 'auto' && t.target && t.target.strip === gone.id) items.push({ t, at: k }); });
  items.sort((a, b) => a.at - b.at);
  state.tracks.splice(i, 1);
  state.tracks = state.tracks.filter((t) => !(t.kind === 'auto' && t.target && t.target.strip === gone.id));
  remapSources(oldIds);
  state.sel.track = Math.max(0, Math.min(state.sel.track, state.tracks.length - 1));
  state.sel.clip = null;
  syncAll();
  emit('tracks');
  return { gone, items, src };
}
function attachTrack(r) {
  for (const x of r.items) state.tracks.splice(Math.min(x.at, state.tracks.length), 0, x.t);
  for (const q of r.src) q.a[q.k] = q.v;
  state.sel.track = Math.max(0, state.tracks.indexOf(r.gone)); state.sel.clip = null;
  syncAll(); scheduleBake(60);
  emit('tracks');
}
export function removeTrack(i) {
  if (!state.tracks[i]) return;
  const r = detachTrack(i);
  if (HK.on) HK.add({ t: 'trk', present: false, r });
}
export function swapTracks(i, j) {
  if (!state.tracks[i] || !state.tracks[j] || i === j) return;
  if (HK.on) HK.add({ t: 'tswap', a: state.tracks[i].id, b: state.tracks[j].id });
  const oldIds = state.tracks.map((t) => t.id);
  [state.tracks[i], state.tracks[j]] = [state.tracks[j], state.tracks[i]];
  remapSources(oldIds);
  state.sel.track = j; syncAll(); emit('tracks');
}

// ------------------------------------------------------------------ master + effect tracks (group routing)
// Every track plays into the Master by default (t.out = -1). An effect track ("Effect 1", ...) is a bus: tracks that route to it are mixed
// together, processed by its devices and then go to the Master, so a group is mastered once instead of track by track.
export const MAX_FX = 8;
export const outLabel = (k) => (k >= 0 && state.returns[k] ? state.returns[k].name : 'Master');
export function addFxTrack() {
  if (state.returns.length >= MAX_FX) return null;
  let n = 1; while (state.returns.some((r) => r.name === 'Effect ' + n)) n++;
  const r = { name: 'Effect ' + n, vol: 1, pan: 0, mute: false, devices: [] };
  state.returns.push(r);
  const k = state.returns.length - 1;
  eng.resetTrack(RET0 + k); eng.trackVol(RET0 + k, r.vol); eng.trackPan(RET0 + k, r.pan); eng.trackMute(RET0 + k, false);
  emit('tracks');
  return k;
}
export function removeFxTrack(k) {
  if (k < 2 || k >= state.returns.length) return false;       // Return A / B are the fixed send buses
  HK.barrier();                                               // not reversible (routing + lanes are renumbered): older undo steps would no longer fit
  state.returns.splice(k, 1);
  for (const t of state.tracks) { if (t.out === k) t.out = -1; else if (t.out > k) t.out--; }
  const key = 'ret' + k;
  state.tracks = state.tracks.filter((t) => !(t.kind === 'auto' && t.target && t.target.strip === key));
  for (const t of state.tracks) if (t.kind === 'auto' && t.target && /^ret\d+$/.test(t.target.strip)) { const m = +t.target.strip.slice(3); if (m > k) t.target.strip = 'ret' + (m - 1); }
  state.sel.track = MASTER; state.sel.clip = null;
  syncAll(); emit('tracks');
  return true;
}
export function renameFx(k, name) { if (state.returns[k] && name) { if (HK.on && name !== state.returns[k].name) HK.add({ t: 'name', s: 'ret' + k, v: state.returns[k].name }); state.returns[k].name = name; emit('tracks'); } }
export function setOut(i, k) {
  const t = state.tracks[i]; if (!t) return;
  const nk = k >= 0 && k < state.returns.length ? k : -1;
  if (HK.on && nk !== t.out) HK.add({ t: 'out', s: stripOf(i), v: t.out });
  t.out = nk;
  eng.trackOut(i, t.out); emit('mix');
}
export function renameTrack(i, name) { if (HK.on && name !== state.tracks[i].name) HK.add({ t: 'name', s: stripOf(i), v: state.tracks[i].name }); state.tracks[i].name = name; emit('tracks'); }
export function noteColor(strip, before) { if (HK.on) HK.add({ t: 'color', s: strip, v: before }); }   // the colour picker edits live, so it reports the old colour when it closes
export function setVol(i, v) { const t = tr(i); if (HK.on && t.vol !== v && !HK.hit('vol' + stripOf(i))) HK.add({ t: 'val', k: 'vol', s: stripOf(i), v: t.vol }); t.vol = v; eng.trackVol(i, v); }
export function setPan(i, v) { const t = tr(i); if (HK.on && t.pan !== v && !HK.hit('pan' + stripOf(i))) HK.add({ t: 'val', k: 'pan', s: stripOf(i), v: t.pan }); t.pan = v; eng.trackPan(i, v); }
export function setSend(i, k, v) { const t = state.tracks[i]; t.send = t.send || [0, 0]; if (HK.on && t.send[k] !== v && !HK.hit('snd' + stripOf(i) + k)) HK.add({ t: 'val', k: 'send', s: stripOf(i), p: k, v: t.send[k] }); t.send[k] = v; eng.send(i, k, v); }
// Arm = the track the record button records into (one at a time); Monitor = whether live input (keys, pads, MIDI) sounds on a MIDI / drum track. Fields t.arm / t.mon, default off / on.
const REC_KINDS = ['audio', 'midi', 'drum'];
export const armedTrack = () => state.tracks.findIndex((t) => t.arm && REC_KINDS.includes(t.kind));
export function flipTrackFlag(i, k) { const t = state.tracks[i]; if (!t) return; if (k === 'arm') t.arm = !t.arm; else t.mon = t.mon === false; emit('mix'); }
export function toggleArm(i) {
  const t = state.tracks[i]; if (!t || !REC_KINDS.includes(t.kind)) return;
  HK.group(() => {
    if (!t.arm) state.tracks.forEach((o, k) => { if (k !== i && o.arm) { if (HK.on) HK.add({ t: 'tog', k: 'arm', s: o.id }); o.arm = false; } });
    if (HK.on) HK.add({ t: 'tog', k: 'arm', s: t.id });
    t.arm = !t.arm;
  });
  if (t.arm) selectTrack(i); else emit('mix');
}
export function toggleMonitor(i) {
  const t = state.tracks[i]; if (!t || (t.kind !== 'midi' && t.kind !== 'drum')) return;
  if (HK.on) HK.add({ t: 'tog', k: 'mon', s: t.id });
  flipTrackFlag(i, 'mon');
}
export function toggleReturnMute(k) { const r = state.returns[k]; if (HK.on) HK.add({ t: 'tog', k: 'mute', s: 'ret' + k }); r.mute = !r.mute; eng.trackMute(RET0 + k, r.mute); emit('mix'); }
export function toggleMute(i) { const t = state.tracks[i]; if (HK.on) HK.add({ t: 'tog', k: 'mute', s: t.id }); t.mute = !t.mute; eng.trackMute(i, t.mute); if (t.kind === 'auto') syncAutomation(); emit('mix'); }
export function toggleSolo(i) { const t = state.tracks[i]; if (HK.on) HK.add({ t: 'tog', k: 'solo', s: t.id }); t.solo = !t.solo; eng.trackSolo(i, t.solo); emit('mix'); }
export const isSampler = (type) => type === INST.DIRECTWAVE || type === INST.KEYSTONE || type === INST.SAMPLER;
export function setInstrument(i, type) {
  const t = state.tracks[i];
  if (HK.on) HK.add({ t: 'inst', s: t.id, v: t.inst });
  t.inst = { type, params: {}, pitch: (t.inst && t.inst.pitch) || 0 };
  if (isSampler(type)) t.inst.zones = [newZone()];
  eng.trackInst(i, type);
  syncZones(i);
  emit('devices');
}
export function applyPreset(i, preset) {
  const t = state.tracks[i], def = INSTRUMENTS[t.inst.type];
  if (HK.on) HK.add({ t: 'ipar', s: t.id, v: { ...t.inst.params } });
  t.inst.params = {};
  def.params.forEach((p, k) => { if (k === 90 && t.inst.type === 11) return; const v = preset.p[k] ?? p.def; t.inst.params[k] = v; eng.instParam(i, k, v); });
  emit('devices');
}
export const presetsFor = (type) => PRESETS[type] || [];

// ---- sampler zones (DirectWave = 1 zone, Keystone / Sampler = up to 16): instrument parameter base + zone*stride + field
// DirectWave / Keystone: 100 + zone*8 + field.  Sampler: 200 + zone*16 + field (more fields: start / end / loop / crossfade / reverse / volume / pan).
export const ZONE_FIELDS = { sample: 0, root: 1, lo: 2, hi: 3, vlo: 4, vhi: 5, tune: 6, loop: 7, sus: 7, s0: 8, s1: 9, l0: 10, l1: 11, xf: 12, rev: 13, vol: 14, pan: 15 };
export const MAX_ZONES = 16;
export const newZone = () => ({ sample: null, root: 60, lo: 0, hi: 127, vlo: 1, vhi: 127, tune: 0, loop: false, sus: 0, s0: 0, s1: 1, l0: 0, l1: 1, xf: 0, rev: false, vol: 0, pan: 0 });
const zIdx = (i, k, f) => (state.tracks[i].inst.type === INST.SAMPLER ? 200 + k * 16 + ZONE_FIELDS[f] : 100 + k * 8 + ZONE_FIELDS[f]);
const zNum = (v) => (v === true ? 1 : v === false ? 0 : v);
function sendZone(i, k) {
  const z = state.tracks[i].inst.zones[k], big = state.tracks[i].inst.type === INST.SAMPLER;
  eng.instParam(i, zIdx(i, k, 'sample'), z.sample ? z.sample.id : -1);
  for (const f of ['root', 'lo', 'hi', 'vlo', 'vhi', 'tune']) eng.instParam(i, zIdx(i, k, f), z[f]);
  if (big) for (const f of ['sus', 's0', 's1', 'l0', 'l1', 'xf', 'rev', 'vol', 'pan']) eng.instParam(i, zIdx(i, k, f), zNum(z[f] ?? newZone()[f]));
  else eng.instParam(i, zIdx(i, k, 'loop'), z.loop ? 1 : 0);
}
export function syncZones(i) {
  const t = state.tracks[i];
  if (!t || !t.inst || !isSampler(t.inst.type)) return;
  const zs = t.inst.zones = t.inst.zones || [newZone()];
  for (let k = 0; k < zs.length; k++) zs[k] = { ...newZone(), ...zs[k] };
  for (let k = 0; k < MAX_ZONES; k++) {
    if (k < zs.length) sendZone(i, k); else eng.instParam(i, zIdx(i, k, 'sample'), -1);
  }
}
export function addZone(i) {
  const zs = state.tracks[i].inst.zones;
  if (zs.length >= MAX_ZONES) return null;
  zs.push(newZone());
  sendZone(i, zs.length - 1);
  emit('devices');
  return zs.length - 1;
}
export function removeZone(i, k) {
  const zs = state.tracks[i].inst.zones;
  if (zs.length < 2) return;
  zs.splice(k, 1);
  syncZones(i);
  emit('devices');
}
// quiet = true: engine + data only (used while dragging markers, the display repaints itself)
export function setZoneField(i, k, field, v, quiet) {
  const z = state.tracks[i].inst.zones[k];
  if (HK.on && z[field] !== v && !HK.hit('zn' + state.tracks[i].id + '.' + k + field)) HK.add({ t: 'val', k: 'zone', s: state.tracks[i].id, d: k, p: field, v: z[field] });
  z[field] = v;
  eng.instParam(i, zIdx(i, k, field), zNum(v));
  if (!quiet) emit('devices');
}
export async function setZoneSample(i, k, path) {
  const s = await loadSampleObj(path);
  if (!s) return null;
  const z = state.tracks[i].inst.zones[k];
  z.sample = s;
  eng.instParam(i, zIdx(i, k, 'sample'), s.id);
  emit('devices');
  return s;
}
export const PITCH_PARAM = { n: 'Pitch', min: -24, max: 24, def: 0, step: 1, fmt: 'int' };   // instrument param 90, handled by the engine for every instrument
export function setBend(i, st) { const t = state.tracks[i]; if (!t || !t.inst) return; eng.bend(i, st); }
export function setPitch(i, v) { const t = state.tracks[i]; if (!t || !t.inst) return; const nv = Math.max(-24, Math.min(24, Math.round(v) || 0)); if (HK.on && nv !== (t.inst.pitch || 0) && !HK.hit('pit' + t.id)) HK.add({ t: 'val', k: 'pitch', s: t.id, v: t.inst.pitch || 0 }); t.inst.pitch = nv; eng.instParam(i, 90, t.inst.pitch); }
// value of an instrument parameter as the engine sees it (a parameter never touched still has its default / pad value)
function instVal(t, pi) {
  const v = t.inst.params[pi];
  if (v !== undefined) return v;
  const q = INSTRUMENTS[t.inst.type] && INSTRUMENTS[t.inst.type].params[pi];
  if (q) return q.def;
  const pad = t.kind === 'drum' && t.inst.pads && pi >= 0 && pi < MAX_PADS * 3 ? t.inst.pads[(pi / 3) | 0] : null;
  return pad ? [pad.gain, pad.pit, pad.dec][pi % 3] : undefined;
}
export function setInstParam(i, pi, v) {
  const t = state.tracks[i];
  if (HK.on) { const old = instVal(t, pi); if (old !== undefined && old !== v && !HK.hit('ip' + t.id + '.' + pi)) HK.add({ t: 'val', k: 'inst', s: t.id, p: pi, v: old, u: !(pi in t.inst.params) }); }
  t.inst.params[pi] = v; eng.instParam(i, pi, v);
  if (t.kind === 'drum' && pi >= 0 && pi < MAX_PADS * 3 && t.inst.pads) {   // automation of the original pad parameters: keep the pad data equal
    const q = t.inst.pads[(pi / 3) | 0];
    if (q) { const j = pi % 3; if (j === 0) q.gain = v; else if (j === 1) q.pit = v; else q.dec = v; }
  }
}

// ---- drum pads: every drum track owns up to 16 pads; a pad is a built-in synth sound or a sample, with gain / pan / sample / envelope settings
export const MAX_PADS = 16;
const PAD_FREE = [37, 43, 45, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59];   // MIDI pitches given to added pads (35, 40 and 44 stay GM aliases)
export const newPad = (o) => ({ pitch: 36, name: 'Pad', kind: -1, sample: null, gain: 0, pan: 0, pit: 0, dec: 1, start: 0, end: 1, rev: false, a: 0, d: 0, s: 1, r: 0, mute: false, solo: false, ...o });
export function padsOf(i) {
  const t = state.tracks[i];
  if (!t || t.kind !== 'drum' || !t.inst) return [];
  if (!Array.isArray(t.inst.pads) || !t.inst.pads.length) {          // first use / project saved before pads existed: the six built-in sounds with their old settings
    const pr = t.inst.params || {};
    t.inst.pads = DRUM_PADS.map((d, k) => newPad({ pitch: d.pitch, name: d.name, kind: k, gain: pr[k * 3] ?? 0, pit: pr[k * 3 + 1] ?? 0, dec: pr[k * 3 + 2] ?? 1 }));
  }
  return t.inst.pads;
}
const padSolo = (ps) => ps.some((q) => q.solo);
function sendPad(i, k) {
  const ps = padsOf(i), q = ps[k], b = 200 + k * 16, solo = padSolo(ps);
  if (!q) { eng.instParam(i, b + 11, -1); eng.instParam(i, b, -1); return; }
  eng.instParam(i, k * 3, q.gain); eng.instParam(i, k * 3 + 1, q.pit); eng.instParam(i, k * 3 + 2, q.dec);
  eng.instParam(i, b, q.sample ? q.sample.id : -1); eng.instParam(i, b + 1, q.kind); eng.instParam(i, b + 2, q.pan);
  eng.instParam(i, b + 3, q.start); eng.instParam(i, b + 4, q.end); eng.instParam(i, b + 5, q.rev ? 1 : 0);
  eng.instParam(i, b + 6, q.a); eng.instParam(i, b + 7, q.d); eng.instParam(i, b + 8, q.s); eng.instParam(i, b + 9, q.r);
  eng.instParam(i, b + 10, q.mute || (solo && !q.solo) ? 1 : 0); eng.instParam(i, b + 11, q.pitch);
}
export function syncPads(i) {
  const t = state.tracks[i];
  if (!t || t.kind !== 'drum' || !t.inst) return;
  padsOf(i);
  for (let k = 0; k < MAX_PADS; k++) sendPad(i, k);
}
const PAD_FIELD_PARAM = { sample: 0, kind: 1, pan: 2, start: 3, end: 4, rev: 5, a: 6, d: 7, s: 8, r: 9, pitch: 11 };
export function setPad(i, k, field, v) {
  const q = padsOf(i)[k]; if (!q) return;
  if (HK.on && q[field] !== v && !HK.hit('pd' + state.tracks[i].id + '.' + k + field)) HK.add({ t: 'val', k: 'pad', s: state.tracks[i].id, d: k, p: field, v: q[field] });
  q[field] = v;
  if (field === 'name') return;
  if (field === 'mute' || field === 'solo') { for (let m = 0; m < MAX_PADS; m++) sendPad(i, m); return; }
  const b = 200 + k * 16;
  if (field === 'gain') eng.instParam(i, k * 3, v); else if (field === 'pit') eng.instParam(i, k * 3 + 1, v); else if (field === 'dec') eng.instParam(i, k * 3 + 2, v);
  else if (field in PAD_FIELD_PARAM) eng.instParam(i, b + PAD_FIELD_PARAM[field], typeof v === 'boolean' ? (v ? 1 : 0) : v);
}
const cleanName = (n) => String(n || 'Sample').replace(/\.[^.]+$/, '').slice(0, 14);
export async function addPadSample(i, path) {
  const ps = padsOf(i);
  if (ps.length >= MAX_PADS) return { error: 'Batas 16 pad tercapai.' };
  const s = await loadSampleObj(path);
  if (!s) return { error: 'Sample tidak bisa dimuat (format atau file terlalu panjang).' };
  const used = new Set(ps.map((q) => q.pitch)), pitch = PAD_FREE.find((x) => !used.has(x));
  if (pitch === undefined) return { error: 'Tidak ada nada kosong untuk pad baru.' };
  ps.push(newPad({ pitch, name: cleanName(s.name), kind: -1, sample: s }));
  sendPad(i, ps.length - 1);
  emit('devices');
  return { k: ps.length - 1 };
}
export async function setPadSample(i, k, path) {
  const q = padsOf(i)[k]; if (!q) return { error: 'Pad tidak ada.' };
  const s = await loadSampleObj(path);
  if (!s) return { error: 'Sample tidak bisa dimuat (format atau file terlalu panjang).' };
  q.sample = s; q.name = cleanName(s.name); q.start = 0; q.end = 1;
  sendPad(i, k); emit('devices');
  return { k };
}
export function resetPadSound(i, k) {           // back to the built-in synth sound (only pads that have one)
  const q = padsOf(i)[k]; if (!q || !q.sample) return false;
  const k0 = DRUM_PADS.findIndex((d) => d.pitch === q.pitch);
  if (k0 < 0) return false;
  q.sample = null; q.kind = k0; q.name = DRUM_PADS[k0].name;
  sendPad(i, k); emit('devices');
  return true;
}
export const padHasSynth = (i, k) => { const q = padsOf(i)[k]; return !!q && q.kind >= 0; };
export function removePad(i, k) {
  const ps = padsOf(i), q = ps[k];
  if (!q || ps.length < 2) return false;
  ps.splice(k, 1);
  for (const c of state.tracks[i].clips) if (c.notes) c.notes = c.notes.filter((n) => n.p !== q.pitch);   // its steps go with it
  syncPads(i); syncClips(i);
  emit('devices'); emit('clips');
  return true;
}

// ------------------------------------------------------------------ devices (i == MASTER for master chain)

export function addDevice(i, type) {
  const t = tr(i);
  if (t.devices.length >= 16) return;
  const d = { id: uid(), type, params: DEVICES[type].params.map((p) => p.def), bypass: false };
  t.devices.push(d);
  if (HK.on) HK.add({ t: 'dpres', s: stripOf(i), d, di: t.devices.length - 1, present: true });
  const di = t.devices.length - 1;
  eng.insertDevice(i, di, type);
  d.params.forEach((v, pi) => eng.devParam(i, di, pi, v));
  emit('devices');
}
export function removeDevice(i, di) { const d0 = tr(i).devices[di]; if (HK.on && d0) HK.add({ t: 'dpres', s: stripOf(i), d: d0, di, present: false }); tr(i).devices.splice(di, 1); eng.removeDevice(i, di); emit('devices'); }
export function setDeviceParam(i, di, pi, v) { const d = tr(i).devices[di]; if (HK.on && d.params[pi] !== v && !HK.hit('dp' + stripOf(i) + '.' + d.id + '.' + pi)) HK.add({ t: 'val', k: 'dev', s: stripOf(i), d: d.id, p: pi, v: d.params[pi] }); tr(i).devices[di].params[pi] = v; eng.devParam(i, di, pi, v); }
export function toggleBypass(i, di) {
  const d = tr(i).devices[di];
  if (HK.on) HK.add({ t: 'tog', k: 'byp', s: stripOf(i), d: d.id });
  d.bypass = !d.bypass;
  eng.devBypass(i, di, d.bypass);
  emit('devices');
}
export function moveDevice(i, from, to) {
  const t = tr(i);
  if (to < 0 || to >= t.devices.length) return;
  if (HK.on && from !== to) HK.add({ t: 'dmv', s: stripOf(i), d: t.devices[from].id, a: from, b: to });
  const [d] = t.devices.splice(from, 1);
  t.devices.splice(to, 0, d);
  eng.removeDevice(i, from);   // reordering recreates the device (its internal tail restarts)
  eng.insertDevice(i, to, d.type);
  d.params.forEach((v, pi) => eng.devParam(i, to, pi, v));
  if (d.bypass) eng.devBypass(i, to, true);
  emit('devices');
}

// ------------------------------------------------------------------ clips + notes

export function findClip(id) {
  for (let i = 0; i < state.tracks.length; i++) {
    const c = state.tracks[i].clips.find((x) => x.id === id);
    if (c) return { track: i, clip: c };
  }
  return null;
}
export function selectedClip() { return state.sel.clip == null ? null : findClip(state.sel.clip); }
export function selectTrack(i) { state.sel.track = i; emit('sel'); }
export function selectClip(i, id) { state.sel.track = i; state.sel.clip = id; emit('sel'); }

export function addClip(i, start, len) {
  const t = state.tracks[i];
  if (!t || t.kind === 'audio') return null;
  if (!(len > 0)) len = barLenAt(Math.max(0, start));          // default: one bar of the signature that is active there
  const c = { id: uid(), start: Math.max(0, start), len, name: '' };
  if (t.kind === 'auto') { const v = autoCurrent(t); c.pts = [{ t: 0, v }, { t: len, v }]; } else c.notes = [];
  t.clips.push(c);
  syncClips(i);
  selectClip(i, c.id);
  emit('clips');
  return c;
}

export async function loadSampleObj(path) {
  if (state.samples[path]) return state.samples[path];
  if (state.nextSample >= SAMPLE_MAX) { deriveErr = SAMPLE_FULL; return null; }   // the engine bank has 256 slots: a higher id would be silently ignored
  const id = state.nextSample++;
  const r = await eng.loadSample(id, path);
  if (!r || r.error) return null;
  const s = { id, path, name: path.split('/').pop(), duration: r.duration, peaks: r.peaks, pyr: r.pyr };
  state.samples[path] = s;
  return s;
}

// A sample file moved or renamed in the file browser: the open project keeps pointing at the right file.
export function renamePath(from, to) {
  const s = state.samples[from];
  if (!s) return;
  s.path = to; s.name = to.split('/').pop();
  state.samples[to] = s; delete state.samples[from];
  for (const t of state.tracks) for (const c of (t.clips || [])) if (c.sample === s && c.name === from.split('/').pop()) c.name = s.name;
  emit('clips');
}

export async function addAudioClip(i, path, start) {
  const t = state.tracks[i];
  if (!t || t.kind !== 'audio') return null;
  const s = await loadSampleObj(path);
  if (!s) return null;
  const len = Math.max(PPQ / 4, Math.round(s.duration * state.bpm / 60 * PPQ));
  const c = { id: uid(), start: Math.max(0, start), len, sample: s, gain: 1, name: s.name };
  t.clips.push(c);
  syncClips(i);
  selectClip(i, c.id);
  emit('clips');
  return c;
}

// v66 (FL Studio Mobile "Combine"): merge two or more MIDI / drum clips of ONE track into a single clip. Notes keep their absolute position.
// Refuses what it cannot merge without changing the music (audio, automation, looped, transposed or CC clips) and returns { error } then.
export function combineClips(i, ids) {
  const t = state.tracks[i];
  if (!t || t.kind === 'audio' || t.kind === 'auto') return { error: 'Gabung hanya untuk klip MIDI / drum.' };
  const L = t.clips.filter((c) => ids.includes(c.id));
  if (L.length < 2) return { error: 'Pilih minimal 2 klip di track yang sama.' };
  if (L.some((c) => c.ll || c.xpose || (c.cc && c.cc.length))) return { error: 'Klip dengan loop, transpose, atau CC belum bisa digabung.' };
  const a = Math.min(...L.map((c) => c.start)), e = Math.max(...L.map((c) => c.start + c.len));
  const notes = [];
  for (const c of L) for (const n of (c.notes || [])) if (n.t < c.len) notes.push({ ...n, t: n.t + c.start - a, d: Math.min(n.d, c.len - n.t) });
  notes.sort((x, y) => x.t - y.t || x.p - y.p);
  const first = L.reduce((m, c) => (c.start < m.start ? c : m), L[0]);
  const merged = { id: uid(), start: a, len: e - a, name: first.name || '', notes };
  t.clips = [...t.clips.filter((c) => !ids.includes(c.id)), merged];
  syncClips(i); selectClip(i, merged.id); emit('clips');
  return { ok: true, id: merged.id };
}

export function removeClip(i, id) {
  const t = state.tracks[i];
  t.clips = t.clips.filter((c) => c.id !== id);
  if (state.sel.clip === id) state.sel.clip = null;
  syncClips(i);
  emit('clips');
}

export function duplicateClip(i, id) {
  const t = state.tracks[i];
  const c = t.clips.find((x) => x.id === id);
  if (!c) return;
  const copy = JSON.parse(JSON.stringify(c, (k, v) => (k === 'sample' || k === 'dsample' ? undefined : v)));
  copy.id = uid();
  copy.start = c.start + c.len;
  if (c.sample) copy.sample = c.sample;   // keep the shared sample objects (peaks are large)
  if (c.dsample) copy.dsample = c.dsample;
  t.clips.push(copy);
  syncClips(i);
  selectClip(i, copy.id);
  emit('clips');
}

export function splitClip(i, id, tick) {
  const t = state.tracks[i];
  const c = t.clips.find((x) => x.id === id);
  if (!c || tick <= c.start || tick >= c.start + c.len) return;
  const cut = tick - c.start;
  if (c.notes) bakeLoop(c);
  if (t.kind === 'audio' && loopOf(c)) {   // a looped audio clip: both halves keep the repeating pattern in phase
    const ll = c.ll, right = { ...c, id: uid(), start: tick, len: c.len - cut, fadeIn: 0, lp: ((c.lp || 0) + cut) % ll };
    if (c.warp) right.warp = { ...c.warp };
    c.fadeOut = 0; c.len = cut;
    t.clips.push(right); syncClips(i); emit('clips'); return;
  }
  if (t.kind === 'audio') {   // both halves keep playing the same audio: the right half starts later inside the sample
    const right = { ...c, id: uid(), start: tick, len: c.len - cut, offset: (c.offset || 0) + cut / PPQ * 60 / state.bpm };
    if (c.warp) right.warp = { ...c.warp };
    right.fadeIn = 0;                    // the cut point must not dip: fade-in stays on the left half, fade-out moves to the right half
    right.fadeOut = c.fadeOut || 0;
    c.fadeOut = 0;
    c.len = cut;
    t.clips.push(right);
    syncClips(i); emit('clips');
    return;
  }
  if (t.kind === 'auto') {
    const at = autoValueAt(c, cut);
    const right = { id: uid(), start: tick, len: c.len - cut, name: c.name, pts: [{ t: 0, v: at }, ...c.pts.filter((p) => p.t > cut).map((p) => ({ t: p.t - cut, v: p.v }))] };
    c.pts = [...c.pts.filter((p) => p.t < cut), { t: cut, v: at }];
    c.len = cut;
    t.clips.push(right);
    syncClips(i); emit('clips');
    return;
  }
  const right = { id: uid(), start: tick, len: c.len - cut, notes: [], name: c.name };
  c.notes = c.notes.filter((n) => {
    if (n.t >= cut) { right.notes.push({ ...n, t: n.t - cut }); return false; }
    if (n.t + n.d > cut) n.d = cut - n.t;
    return true;
  });
  c.len = cut;
  t.clips.push(right);
  syncClips(i);
  emit('clips');
}

export function pasteClip(i, data, start) {
  const t = state.tracks[i];
  if (!t || !data || (t.kind === 'audio') !== (data.kind === 'audio')) return null;
  const c = JSON.parse(JSON.stringify(data.clip, (k, v) => (k === 'sample' || k === 'dsample' ? undefined : v)));
  if (data.clip.sample) c.sample = data.clip.sample;
  if (data.clip.dsample) c.dsample = data.clip.dsample;
  c.id = uid(); c.start = Math.max(0, start); c.muted = false;
  t.clips.push(c);
  syncClips(i);
  selectClip(i, c.id);
  emit('clips');
  return c;
}

export function moveClipToTrack(from, id, to) {
  const a = state.tracks[from], b = state.tracks[to];
  if (!a || !b || a === b || a.kind !== b.kind) return false;
  const k = a.clips.findIndex((c) => c.id === id);
  if (k < 0) return false;
  b.clips.push(a.clips.splice(k, 1)[0]);
  state.sel.track = to;
  syncClips(from); syncClips(to);
  return true;
}

export function clipChanged(i) { touchClips(i); emit('notes'); }

// ------------------------------------------------------------------ demo + save/load

export function newProject(demo = true) {
  HK.on = false;
  try { return newProjectInner(demo); } finally { HK.on = true; HK.barrier(); }
}
function newProjectInner(demo) {
  for (const k of Object.keys(state.samples)) delete state.samples[k];
  state.nextSample = 16; bakes.clear(); freeSlots.length = 0;
  state.tracks = []; state.master = { vol: 1, devices: [] }; state.returns = makeReturns();
  applySig(4, 4, []); state.markers = []; state.groove = { amt: 0, grid: 240 }; state.countIn = 0; state.punch = { on: false, start: 0, end: 0 }; state.recLoop = false;
  state.bpm = 120; state.loop = { on: false, start: 0, end: BAR * 2 }; state.metro = false;
  state.sel = { track: 0, clip: null }; state.projectName = 'Untitled';
  state.ccLinks = {}; learn.pending = null;   // MIDI CC links belong to the project that is being replaced
  eng.stop(); state.pos = 0;
  if (demo) {
    const d = addTrack('drum'); d.name = 'Drums';
    const dc = addClip(0, 0, BAR * 2);
    for (let bar = 0; bar < 2; bar++) {
      for (let s = 0; s < 16; s++) {
        const t = bar * 3840 + s * 240;
        if (s % 4 === 0) dc.notes.push({ t, d: 200, p: 36, v: 0.95 });
        if (s === 4 || s === 12) dc.notes.push({ t, d: 200, p: 38, v: 0.9 });
        if (s % 2 === 0) dc.notes.push({ t, d: 120, p: 42, v: s % 4 === 0 ? 0.8 : 0.55 });
      }
    }
    const s = addTrack('midi'); s.name = 'Bass';
    const bc = addClip(1, 0, BAR * 2);
    const roots = [36, 36, 39, 34];
    for (let k = 0; k < 8; k++) bc.notes.push({ t: k * 960, d: 700, p: roots[k % 4] + 12, v: 0.85 });
    state.sel = { track: 0, clip: dc.id };
    state.master.devices.push({ id: uid(), type: 5, params: DEVICES[5].params.map((p) => p.def), bypass: false });   // limiter: the demo mix must not clip
  }
  syncAll();
  scheduleBake(200);
  emit('all');
}

export function serialize() {
  const compact = (k, v) => {
    if (k === 'dsample') return undefined;                                                   // derived buffers are rebuilt on load
    if (k === 'sample' && v && v.path) return { path: v.path, name: v.name, duration: v.duration };   // no peaks / engine ids in the file
    if (k === 'sf' && v) return { path: v.path, preset: v.preset };
    return v;
  };
  return JSON.stringify({ v: 2, name: state.projectName, bpm: state.bpm, sig: state.sig, sigs: state.sigs, markers: state.markers, groove: state.groove, countIn: state.countIn, punch: state.punch, recLoop: state.recLoop, loop: state.loop, tracks: state.tracks, master: state.master, returns: state.returns, cc: state.ccLinks }, compact);
}

export async function deserialize(text) {
  HK.on = false;
  try { return await deserializeInner(text); } finally { HK.on = true; HK.barrier(); }
}
async function deserializeInner(text) {
  const o = JSON.parse(text);
  if (!o || typeof o !== 'object' || !Array.isArray(o.tracks)) throw new Error('Berkas proyek tidak valid (tidak ada daftar track).');
  if (o.tracks.length > MAX_TRACKS) throw new Error('Proyek memiliki terlalu banyak track.');
  eng.stop(); state.pos = 0; learn.pending = null;
  for (const k of Object.keys(state.samples)) delete state.samples[k];
  state.nextSample = 16; bakes.clear(); freeSlots.length = 0;
  state.bpm = Math.max(20, Math.min(300, +o.bpm || 120));
  applySig(o.sig && o.sig.n, o.sig && o.sig.d, o.sigs);          // old projects have no signature: 4/4
  state.markers = Array.isArray(o.markers) ? o.markers.filter((m) => m && Number.isFinite(m.t)).map((m) => ({ id: uid(), t: Math.max(0, Math.round(m.t)), name: String(m.name || 'Marker'), color: m.color || MARKER_COLORS[0] })) : [];
  state.groove = { amt: Math.max(0, Math.min(1, +(o.groove && o.groove.amt) || 0)), grid: [120, 240, 480].includes(o.groove && o.groove.grid) ? o.groove.grid : 240 };
  state.countIn = [0, 1, 2, 4].includes(o.countIn) ? o.countIn : 0;
  state.punch = o.punch && Number.isFinite(o.punch.start) && Number.isFinite(o.punch.end) && o.punch.end > o.punch.start ? { on: !!o.punch.on, start: Math.max(0, Math.round(o.punch.start)), end: Math.round(o.punch.end) } : { on: false, start: 0, end: 0 };
  state.recLoop = false;                                   // loop was removed from the UI: old projects always open with loop and loop-recording off
  state.loop = o.loop && Number.isFinite(o.loop.start) && Number.isFinite(o.loop.end) && o.loop.end > o.loop.start ? { ...o.loop, on: false } : { on: false, start: 0, end: BAR * 2 };
  state.master = o.master && Array.isArray(o.master.devices) ? o.master : { vol: 1, devices: [] };
  state.projectName = o.name || 'Untitled';
  state.returns = Array.isArray(o.returns) && o.returns.length >= 2 && o.returns.length <= MAX_FX ? o.returns : makeReturns();
  state.tracks = o.tracks;
  state.ccLinks = o.cc || {};
  for (const t of state.tracks) { const oc = OLD_COLORS.indexOf(t.color); if (oc >= 0) t.color = COLORS[oc]; else if (t.color === '#8ea2c0') t.color = AUTO_COLOR; t.send = t.send || [0, 0]; t.clips = Array.isArray(t.clips) ? t.clips : []; t.devices = Array.isArray(t.devices) ? t.devices : []; }
  for (const r of state.returns) r.devices = Array.isArray(r.devices) ? r.devices : [];
  for (const t of state.tracks) t.out = Number.isInteger(t.out) && t.out >= 0 && t.out < state.returns.length ? t.out : -1;   // projects from before routing existed: everything goes to the Master
  const missing = [];
  for (const t of state.tracks) {
    if (t.kind !== 'audio') continue;
    t.clips = t.clips.filter((c) => c && c.sample && c.sample.path);   // a clip without a sample reference cannot be played
    for (const c of t.clips) {
      const s = await loadSampleObj(c.sample.path);
      if (s) {
        c.sample = s;
        if (c.warp && (c.warp.ratio !== 1 || c.warp.rev || c.warp.pitch)) c.dsample = await deriveSample(s, c.warp);
      } else missing.push(c.sample.path);
    }
    t.clips = t.clips.filter((c) => !missing.includes(c.sample.path) || state.samples[c.sample.path]);
  }
  const chains = [state.master, ...state.returns, ...state.tracks];
  for (let i = 0; i < state.tracks.length; i++) {
    const t = state.tracks[i];
    if (t.inst && t.inst.type === INST.SOUNDFONT && t.inst.sf) { const r = await loadSoundFontFor(i, t.inst.sf.path, t.inst.sf.preset); if (r && r.error) missing.push(t.inst.sf.path); }
  }
  for (const t of state.tracks) {
    if (!t.inst || !t.inst.zones) continue;
    for (const z of t.inst.zones) {
      if (!z.sample) continue;
      const sm = await loadSampleObj(z.sample.path);
      if (sm) z.sample = sm; else { missing.push(z.sample.path); z.sample = null; }
    }
  }
  for (const t of state.tracks) {
    if (t.kind !== 'drum' || !t.inst) continue;
    if (!Array.isArray(t.inst.pads)) { delete t.inst.pads; continue; }
    t.inst.pads = t.inst.pads.filter((q) => q && Number.isFinite(q.pitch)).slice(0, MAX_PADS).map((q) => newPad(q));
    for (const q of t.inst.pads) {
      if (!q.sample) continue;
      const sm = q.sample.path ? await loadSampleObj(q.sample.path) : null;
      if (sm) q.sample = sm; else { if (q.sample.path) missing.push(q.sample.path); q.sample = null; if (q.kind < 0) q.mute = true; }
    }
  }
  let maxId = 0;
  for (const t of state.tracks) { maxId = Math.max(maxId, t.id || 0); for (const c of t.clips) maxId = Math.max(maxId, c.id || 0); }
  for (const c of chains) for (const d of c.devices) maxId = Math.max(maxId, d.id || 0);
  _id = 1 + maxId;
  for (const c of chains) for (const d of c.devices) if (!d.id) d.id = uid();
  state.sel = { track: 0, clip: null };
  syncAll();
  emit('all');
  return missing;
}

// ------------------------------------------------------------------ automation
// An automation track targets one parameter: { kind, strip, devId?, param, def }.
//   kind: 0 volume, 1 pan, 2 send A, 3 send B, 4 device parameter, 5 instrument parameter
//   strip: a track id, or 'master' / 'ret0' / 'ret1'.   def: { min, max, curve?, step? } of the parameter.
// Clip points are { t: ticks inside the clip, v: 0..1 }; the engine receives real parameter values.
export const AUTO_VOL = { n: 'Volume', min: 0, max: 1.4, fmt: 'gain' }, AUTO_PAN = { n: 'Pan', min: -1, max: 1, fmt: 'pan' }, AUTO_SEND = { n: 'Send', min: 0, max: 1, unit: '%' };

export function stripIndex(strip) {
  if (strip === 'master') return MASTER;
  if (/^ret\d+$/.test(strip)) { const k = +strip.slice(3); return k < state.returns.length ? RET0 + k : -1; }
  return state.tracks.findIndex((t) => t.id === strip);
}
export const stripOf = (i) => (i === MASTER ? 'master' : i >= RET0 ? 'ret' + (i - RET0) : state.tracks[i].id);

function resolveTarget(tg) {
  if (tg.kind === 6) return { track: MASTER, dev: 0 };   // tempo lane: not an engine parameter, it feeds the tempo map
  const idx = stripIndex(tg.strip);
  if (idx < 0) return null;
  if (tg.kind === 4) {
    const di = tr(idx).devices.findIndex((d) => d.id === tg.devId);
    return di < 0 ? null : { track: idx, dev: di };
  }
  if (tg.kind === 5 && !(state.tracks[idx] && state.tracks[idx].inst)) return null;
  return { track: idx, dev: 0 };
}

export function autoCurrent(t) {
  const tg = t.target;
  if (!tg) return 0.5;
  const r = resolveTarget(tg);
  if (!r) return 0.5;
  if (tg.kind === 6) return normOf(TEMPO_DEF, state.bpm);
  const o = tr(r.track);
  let v;
  switch (tg.kind) {
    case 0: v = o.vol; break;
    case 1: v = o.pan || 0; break;
    case 2: case 3: v = (o.send || [0, 0])[tg.kind - 2]; break;
    case 4: v = o.devices[r.dev].params[tg.param]; break;
    default: { const x = tg.param === 90 ? (o.inst.pitch || 0) : o.inst.params[tg.param]; v = x === undefined ? tg.def.def ?? tg.def.min : x; }
  }
  return normOf(tg.def, v ?? tg.def.min);
}

export function autoValueAt(c, t) {
  const p = c.pts;
  if (!p.length) return 0.5;
  if (t <= p[0].t) return p[0].v;
  if (t >= p[p.length - 1].t) return p[p.length - 1].v;
  for (let k = 1; k < p.length; k++) if (t <= p[k].t) { const a = p[k - 1], b = p[k], d = b.t - a.t; return d <= 0 ? b.v : a.v + (b.v - a.v) * (t - a.t) / d; }
  return p[p.length - 1].v;
}

export function syncAutomation() {
  const flat = [];
  syncTempoMap();
  for (const t of state.tracks) {
    if (t.kind !== 'auto' || !t.target || t.mute || t.target.kind === 6) continue;
    const r = resolveTarget(t.target);
    if (!r) continue;
    const pts = [];
    let last = null;
    for (const c of [...t.clips].sort((a, b) => a.start - b.start)) {
      if (c.muted || !c.pts.length) continue;
      const sorted = [...c.pts].sort((a, b) => a.t - b.t);
      if (last !== null && c.start > last.tick) pts.push([c.start - 1, last.value]);   // hold the previous value across the gap
      for (const p of sorted) pts.push([c.start + p.t, valOf(t.target.def, p.v)]);
      last = { tick: c.start + c.len, value: valOf(t.target.def, sorted[sorted.length - 1].v) };
    }
    if (!pts.length) continue;
    flat.push(t.target.kind, r.track, r.dev, t.target.param || 0, pts.length);
    for (const [tk, v] of pts) flat.push(tk, v);
  }
  eng.automation(flat, flat.length);
}

export function addAutoTrack(target, label) {
  if (state.tracks.length >= MAX_TRACKS) return null;
  const existing = state.tracks.findIndex((t) => t.kind === 'auto' && t.target && t.target.kind === target.kind && t.target.strip === target.strip && t.target.devId === target.devId && t.target.param === target.param);
  if (existing >= 0) { selectTrack(existing); return state.tracks[existing]; }   // one lane per parameter
  const n = state.tracks.length + 1;
  const t = {
    id: uid(), name: 'Auto: ' + label, color: AUTO_COLOR, kind: 'auto', inst: null, clips: [], devices: [],
    vol: 0.85, pan: 0, mute: false, solo: false, send: [0, 0], target,
  };
  state.tracks.push(t);
  if (HK.on) HK.add({ t: 'trk', present: true, r: { gone: t, items: [{ t, at: state.tracks.length - 1 }], src: [] } });
  const i = state.tracks.length - 1;
  syncTrackFull(i);
  emit('tracks');
  { const a0 = barFloor(state.pos); addClip(i, a0, barStart(barAt(a0) + 2) - a0); }
  selectTrack(i);
  return t;
}

export function autoLabel(t) {
  const tg = t.target;
  if (!tg) return '';
  const idx = stripIndex(tg.strip);
  if (idx < 0) return 'target hilang';
  const o = tr(idx);
  return (idx === MASTER ? 'Master' : idx >= RET0 ? o.name : o.name);
}


// ------------------------------------------------------------------ audio clip operations (web engine)
// c.warp = { beats, ratio, rev }: ratio = stretched length / original length. c.dsample is the derived buffer actually played.
const SAMPLE_MAX = 256, SAMPLE_FULL = 'Slot sample penuh (256). Simpan proyek lalu buka ulang untuk membersihkan hasil stretch lama.';
let deriveErr = '';
// Offline audio rendering (reverse / pitch / stretch) runs in a module Worker so the UI stays smooth; if workers are not
// available it falls back to the main thread. Jobs run one after another (a drag can queue several).
let worker = null, workerDead = false, jobId = 0;
const jobs = new Map();
function getWorker() {
  if (worker || workerDead || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./engine/stretchworker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const j = jobs.get(e.data.id); if (!j) return; jobs.delete(e.data.id); if (e.data.error) j.rej(new Error(e.data.error)); else j.res({ l: e.data.l, r: e.data.mono ? e.data.l : e.data.r }); };
    worker.onerror = () => { workerDead = true; const w = worker; worker = null; try { w.terminate(); } catch (_) { /* ignore */ } for (const [k, j] of jobs) { jobs.delete(k); j.rej(new Error('worker')); } };
  } catch (_) { workerDead = true; worker = null; }
  return worker;
}
async function renderAudio(l, r, opts) {
  const w = getWorker(), mono = r === l;
  if (w) {
    try {
      return await new Promise((res, rej) => { const id = ++jobId; jobs.set(id, { res, rej }); w.postMessage({ id, l, r: mono ? null : r, mono, opts }); });
    } catch (e) { if (!workerDead) throw e; }                    // the worker itself failed (not the audio): do it here instead
  }
  await new Promise((res) => setTimeout(res, 0));
  return processBuffers(l, r, opts);
}
export async function deriveSample(base, warp) {
  deriveErr = '';
  const ratio = warp.ratio || 1, rev = !!warp.rev, pitch = warp.pitch || 0;
  if (ratio === 1 && !rev && !pitch) return base;
  const key = `${base.path}|${ratio.toFixed(5)}|${rev ? 1 : 0}|${pitch}`;
  if (state.samples[key]) return state.samples[key];
  const b = eng.sampleBuffers(base.id);
  if (!b) return null;
  let l, r;
  try { ({ l, r } = await renderAudio(b.l, b.r || b.l, { rev, pitch, ratio })); }
  catch (e) { deriveErr = 'Gagal memproses audio: ' + (e && e.message || e); return null; }
  if (state.nextSample >= SAMPLE_MAX) { deriveErr = SAMPLE_FULL; return null; }
  const id = state.nextSample++;
  const m = await eng.putSampleBuffers(id, l, r);
  if (!m || m.error) return null;
  const s = { id, path: base.path, name: base.name, duration: m.duration, peaks: m.peaks, pyr: m.pyr, derived: true };
  state.samples[key] = s;
  return s;
}
export const canWarp = () => !!eng.sampleBuffers(0) || state.nextSample > 16;
// opts: { rev?, beats? (stretch the whole sample to this many beats), reset? }
export async function setClipAudio(i, id, opts) {
  const t = state.tracks[i], c = t && t.clips.find((x) => x.id === id);
  if (!c || t.kind !== 'audio') return { error: 'Klip tidak ditemukan' };
  const w = opts.reset ? { beats: 0, ratio: 1, rev: false, pitch: 0 } : { beats: c.warp ? c.warp.beats : 0, ratio: c.warp ? c.warp.ratio : 1, rev: c.warp ? c.warp.rev : false, pitch: c.warp ? c.warp.pitch || 0 : 0 };
  if (opts.rev !== undefined) w.rev = opts.rev;
  if (opts.pitch !== undefined) w.pitch = opts.pitch;
  if (opts.beats) { w.beats = opts.beats; w.ratio = (opts.beats * 60 / state.bpm) / c.sample.duration; }
  const ds = await deriveSample(c.sample, w);
  if (!ds) return { error: deriveErr || 'Operasi audio hanya tersedia di versi web.' };
  w.bpm = state.bpm; c.warp = w; c.dsample = ds === c.sample ? null : ds;
  if (opts.reset || opts.beats) c.warpAuto = false;                       // an explicit warp / reset takes the clip off "follow project tempo"
  if (opts.pitch === undefined || opts.rev !== undefined || opts.beats || opts.reset) c.offset = 0;   // pitch-only keeps the trimmed start
  if (opts.beats) c.len = Math.round(opts.beats * PPQ);
  else if (opts.reset) c.len = Math.max(PPQ / 4, Math.round(c.sample.duration * state.bpm / 60 * PPQ));
  syncClips(i); emit('clips');
  return { ok: true };
}
// ---- tempo: detect, sync and free stretch (the clip keeps its trimmed region and its place on the grid)
const baseOf = (c) => c.sample;
export function detectClipBpm(i, id) {
  const t = state.tracks[i], c = t && t.clips.find((x) => x.id === id);
  if (!c || t.kind !== 'audio') return { error: 'Klip audio tidak ditemukan.' };
  const b = eng.sampleBuffers(baseOf(c).id);
  if (!b || !b.l) return { error: 'Deteksi tempo hanya tersedia di versi web.' };
  const sr = (eng.info && eng.info().sampleRate) || 48000;
  return detectBpm(b.l, b.r || b.l, sr);
}
export function setClipSrcBpm(i, id, bpm) {
  const t = state.tracks[i], c = t && t.clips.find((x) => x.id === id);
  if (!c) return;
  c.srcBpm = bpm > 0 ? Math.round(Math.max(20, Math.min(400, bpm)) * 100) / 100 : 0;
  if (!c.srcBpm) c.warpAuto = false;
  emit('clips');
}
// ratio = stretched length / original length (relative to the ORIGINAL sample). opts.len = explicit clip length in ticks
// (used by the arrangement stretch handle); opts.beats = keep the "N beat" label.
export async function restretchClip(i, id, ratio, opts = {}) {
  const t = state.tracks[i], c = t && t.clips.find((x) => x.id === id);
  if (!c || t.kind !== 'audio') return { error: 'Klip tidak ditemukan' };
  if (!Number.isFinite(ratio) || ratio <= 0) return { error: 'Rasio stretch tidak valid.' };
  if (ratio < 0.25 || ratio > 4) return { error: 'Selisih tempo terlalu jauh (maks 4x lebih cepat / lambat). Coba ×2 atau ÷2 pada BPM sample.' };
  ratio = Math.round(ratio * 10000) / 10000;
  const old = c.warp || { beats: 0, ratio: 1, rev: false, pitch: 0 }, D0 = (c.dsample || c.sample).duration;
  const sptOld = 60 / ((old.bpm || state.bpm) * PPQ), sptNew = 60 / (state.bpm * PPQ);
  const o0 = c.offset || 0, f0 = o0 / D0, f1 = (o0 + c.len * sptOld) / D0;
  const w = { ...old, ratio, beats: opts.beats || 0, bpm: state.bpm };
  const ds = await deriveSample(c.sample, w);
  if (!ds) return { error: deriveErr || 'Operasi audio hanya tersedia di versi web.' };
  const D1 = ds.duration, k = D1 / D0;
  c.warp = w; c.dsample = ds === c.sample ? null : ds;
  c.offset = Math.max(0, f0 * D1);
  c.len = opts.len ? Math.max(PPQ / 32, Math.round(opts.len)) : Math.max(PPQ / 32, Math.round((f1 - f0) * D1 / sptNew));
  if (c.fadeIn) c.fadeIn *= k; if (c.fadeOut) c.fadeOut *= k;
  syncClips(i); emit('clips');
  return { ok: true, ratio };
}
// Make the sample play on the project tempo: ratio = sample BPM / project BPM.
export async function syncClipToTempo(i, id, srcBpm, auto = true) {
  const t = state.tracks[i], c = t && t.clips.find((x) => x.id === id);
  if (!c || t.kind !== 'audio') return { error: 'Klip tidak ditemukan' };
  const b = srcBpm || c.srcBpm;
  if (!(b > 0)) return { error: 'BPM sample belum diketahui. Deteksi atau isi BPM sample dulu.' };
  const out = await restretchClip(i, id, b / state.bpm);
  if (out.error) return out;
  c.srcBpm = Math.round(b * 100) / 100; c.warpAuto = !!auto;
  emit('clips');
  return out;
}
export const unsyncClip = (i, id) => { const t = state.tracks[i], c = t && t.clips.find((x) => x.id === id); if (c) { c.warpAuto = false; emit('clips'); } return restretchClip(i, id, 1); };
export const retempoClip = async (i, id) => {
  const c = state.tracks[i].clips.find((x) => x.id === id);
  if (c && c.srcBpm && c.warpAuto) return syncClipToTempo(i, id, c.srcBpm, true);
  if (!c || !c.warp || !c.warp.beats) return { error: 'Klip ini belum di-warp ke jumlah beat.' };
  return restretchClip(i, id, (c.warp.beats * 60 / state.bpm) / c.sample.duration, { beats: c.warp.beats });
};

// Clips with "ikuti tempo" follow the project tempo once the tempo has settled (debounced: each distinct ratio costs a sample slot).
let followTimer = 0, followBpm = 0;
export async function followTempo() {
  followBpm = state.bpm;
  let n = 0, err = '';
  for (let i = 0; i < state.tracks.length; i++) {
    const t = state.tracks[i]; if (t.kind !== 'audio') continue;
    for (const c of [...t.clips]) {
      if (!c.warpAuto || !(c.srcBpm > 0)) continue;
      const want = Math.round(c.srcBpm / state.bpm * 10000) / 10000, have = c.warp ? c.warp.ratio : 1;
      if (Math.abs(want - have) < 0.00005 && (!c.warp || !c.warp.bpm || c.warp.bpm === state.bpm)) continue;
      const out = await restretchClip(i, c.id, want);
      if (out.error) { err = out.error; c.warpAuto = false; } else n++;
    }
  }
  if (n || err) emit('followed');
  return { n, error: err };
}
onChange((what) => { if (what === 'transport' && state.bpm !== followBpm) { clearTimeout(followTimer); followTimer = setTimeout(followTempo, 450); } });

// ---- grid-locked audio: clips that follow the project tempo ("ikuti tempo", srcBpm known) stay on the musical grid when the tempo map
// changes the speed along the song and when swing is on. Playback and export use the same pre-warped buffer: the clip is rendered
// once (WSOLA with a variable ratio, in the stretch worker) for exactly its place on the timeline, then played from its start.
// Clips that are not synced keep playing in absolute time, as before. Constant tempo without swing never takes this path (identical to v41).
const bakes = new Map();          // clip id -> { id: sample slot, key, sample }
const freeSlots = [];
export let bakeError = '';
export const gridLocked = (c) => !!(c && c.warpAuto && c.srcBpm > 0 && c.sample);
const bakeWanted = (c) => gridLocked(c) && (tmOn || swingOf(c) > 0);
function bakeKey(c) {
  const w = c.warp || {};
  return [c.sample.path, c.start, c.len, (c.offset || 0).toFixed(5), c.ll || 0, c.lp || 0, c.srcBpm, w.ratio || 1, w.rev ? 1 : 0, w.pitch || 0, swingOf(c), state.groove.grid || 240, tmOn ? tmKey : 'c' + state.bpm].join('|');
}
function bakeCurrent(c) { if (!bakeWanted(c)) return null; const b = bakes.get(c.id); return b && b.key === bakeKey(c) ? b : null; }
// breakpoints (output frame, source frame) of one stretch of the clip: ticks y0..y1 of the timeline, content starting at tick s of the clip's loop
function bakeSeg(c, g, sr, srate, o0beats) {
  const a = swingOf(c), gr = state.groove.grid || 240, sh = a > 0 ? Math.round(a * gr * 0.5) : 0;
  const yj = (j) => j * gr + ((j & 1) ? sh : 0);
  const pinv = (y) => { if (!sh) return y; let j = Math.floor(y / gr); if (y < yj(j)) j--; return j * gr + (y - yj(j)) * gr / (yj(j + 1) - yj(j)); };
  const Y0 = c.start + g.o, Y1 = Y0 + g.len, T0 = tickToSec(Y0), oS = Math.round((tickToSec(Y0) - tickToSec(c.start)) * sr), oE = Math.round((tickToSec(Y1) - tickToSec(c.start)) * sr);
  const xo = [], xs = [], ST = 60;
  for (let y = Y0; ; y += ST) {
    if (y > Y1) y = Y1;
    const beat = o0beats + (g.s + (pinv(y) - Y0)) / PPQ;
    xo.push((tickToSec(y) - T0) * sr); xs.push(beat * 60 / c.srcBpm * srate);
    if (y >= Y1) break;
  }
  return { o: oS, n: Math.max(1, oE - oS), xo: Float64Array.from(xo), xs: Float64Array.from(xs) };
}
async function bakeClip(c) {
  const sr = (eng.info && eng.info().sampleRate) || 48000, w = c.warp || {}, ratio = w.ratio || 1;
  const base = await deriveSample(c.sample, { ratio: 1, rev: !!w.rev, pitch: w.pitch || 0 });
  if (!base) return { error: deriveErr || 'Gagal menyiapkan audio.' };
  const b = eng.sampleBuffers(base.id); if (!b || !b.l || !base.duration) return { error: 'Buffer sample tidak tersedia.' };
  const srate = b.l.length / base.duration, o0beats = ((c.offset || 0) / ratio) * c.srcBpm / 60;
  const segs = loopSegs(c).map((g) => bakeSeg(c, g, sr, srate, o0beats));
  const total = Math.max(1, Math.round((tickToSec(c.start + c.len) - tickToSec(c.start)) * sr));
  if (total > sr * 60 * 20) return { error: 'Klip terlalu panjang untuk disesuaikan dengan tempo map.' };
  let out;
  try { out = await renderAudio(b.l, b.r || b.l, { map: { n: total, segs } }); } catch (e) { return { error: 'Gagal memproses audio: ' + (e && e.message || e) }; }
  return { l: out.l, r: out.r };
}
let bakeTimer = 0, baking = null, bakeAgain = false;
export function scheduleBake(ms = 350) { clearTimeout(bakeTimer); bakeTimer = setTimeout(ensureBakes, ms); }
export function ensureBakes() {
  clearTimeout(bakeTimer);
  if (baking) { bakeAgain = true; return baking; }
  baking = (async () => { try { do { bakeAgain = false; await bakeAll(); } while (bakeAgain); } catch (_) { /* a failed bake leaves the clip on the plain path */ } baking = null; })();
  return baking;
}
async function bakeAll() {
  const alive = new Set();
  for (const t of state.tracks) if (t.kind === 'audio') for (const c of t.clips) alive.add(c.id);
  for (const [id, b] of [...bakes]) if (!alive.has(id)) { bakes.delete(id); freeSlots.push(b.id); }
  let changed = false;
  for (let i = 0; i < state.tracks.length; i++) {
    const t = state.tracks[i]; if (t.kind !== 'audio') continue;
    for (const c of [...t.clips]) {
      if (!bakeWanted(c)) continue;
      const key = bakeKey(c), have = bakes.get(c.id);
      if (have && have.key === key) continue;
      const r = await bakeClip(c);
      if (r.error) { bakeError = r.error; continue; }
      if (bakeKey(c) !== key) { bakeAgain = true; continue; }      // edited while rendering: go round again
      let id = have ? have.id : freeSlots.pop();
      if (id === undefined) { if (state.nextSample >= SAMPLE_MAX) { bakeError = SAMPLE_FULL; continue; } id = state.nextSample++; }
      const m = await eng.putSampleBuffers(id, r.l, r.r);
      if (!m || m.error) { bakeError = (m && m.error) || 'Gagal memuat hasil warp.'; continue; }
      bakeError = '';
      bakes.set(c.id, { id, key, sample: { id, path: c.sample.path, name: c.sample.name, duration: m.duration, peaks: m.peaks, pyr: m.pyr, derived: true } });
      syncClips(i); changed = true;
    }
  }
  if (changed) emit('clips');
}
// the waveform of a baked clip (drawn from the warped buffer), or null
export const bakedSample = (c) => { const b = bakeCurrent(c); return b ? b.sample : null; };

// ------------------------------------------------------------------ SoundFont instrument
function syncSoundFont(i) {
  const t = state.tracks[i];
  if (!t || !t.inst || t.inst.type !== INST.SOUNDFONT || !t.inst.sf || t.inst.sf.id === undefined) return;
  eng.instParam(i, 100, t.inst.sf.id); eng.instParam(i, 1, t.inst.sf.preset || 0);
}
async function loadSoundFontFor(i, path, preset = 0) {
  const r = await eng.loadSoundFont(path);
  if (!r || r.error) return r || { error: 'SoundFont tidak bisa dimuat' };
  const t = state.tracks[i];
  t.inst.sf = { path, id: r.id, preset: Math.min(preset, r.presets.length - 1), presets: r.presets };
  syncSoundFont(i);
  return r;
}
export async function setSoundFont(i, path) { const r = await loadSoundFontFor(i, path, 0); emit('devices'); return r; }
export function setSfPreset(i, k) { const t = state.tracks[i]; if (!t.inst.sf) return; t.inst.sf.preset = k; eng.instParam(i, 1, k); emit('devices'); }

// ------------------------------------------------------------------ live input (keyboard, pads, MIDI) and recording
export const rec = { on: false, kind: null, track: -1, startTick: 0, open: new Map(), notes: [], pass: 0, passes: [], punch: null, loopRec: false, cinUntil: 0, cinSecs: 0, lastPos: 0, last: null };
let cinOn = false;                                   // the engine is still counting in (the song has not started)
const inPunch = (t) => !rec.punch || (t >= rec.punch.start && t < rec.punch.end);
export function currentTick() {
  if (!state.playing || cinOn) return state.pos;
  let t = clkAt(performance.now());
  const L = state.loop;
  if (L.on && t >= L.end && state.pos < L.end) t = L.start + ((t - L.end) % Math.max(1, L.end - L.start));   // the engine has not reported the wrap yet
  return Math.max(0, t);
}
// Drum pads follow FL Studio Mobile: MIDI notes 48.. play the pads in order.
export const drumPitch = (note, i) => { const ps = i === undefined ? DRUM_PADS : padsOf(i); return note >= 48 && note < 48 + ps.length ? ps[note - 48].pitch : note; };
export function noteEvent(i, pitch, vel, on) {
  const t = state.tracks[i];
  if (!t || (t.kind !== 'midi' && t.kind !== 'drum')) return;
  if (t.kind === 'drum') pitch = drumPitch(pitch, i);
  if (t.mon !== false || !on) eng.preview(i, pitch, on ? vel : 0, on);   // Monitor off: live input is recorded but does not sound (note-offs always pass)
  if (rec.on && rec.kind === 'midi' && rec.track === i && performance.now() >= rec.cinUntil && !cinOn) {
    const tick = currentTick();
    if (on) { if (inPunch(tick)) rec.open.set(pitch, { tick, vel, pass: rec.pass }); }
    else { const o = rec.open.get(pitch); if (o) { rec.notes.push({ tick: o.tick, end: rec.punch ? Math.min(tick, rec.punch.end) : tick, p: pitch, v: o.vel, pass: o.pass }); rec.open.delete(pitch); } }
  }
}
// called with every engine report while recording: loop wrap -> next take; punch-out -> stop recording, playback goes on
function recWatch(p) {
  if (!p.playing || p.cin) return;
  const L = state.loop;
  if (rec.loopRec && p.pos < rec.lastPos - 0.5 * (L.end - L.start)) {
    for (const [pp, o] of rec.open) rec.notes.push({ tick: o.tick, end: L.end, p: pp, v: o.vel, pass: o.pass });
    rec.open.clear();
    rec.passes[rec.passes.length - 1].b = L.end;
    rec.passes.push({ a: L.start, b: L.end });
    rec.pass++;
  }
  rec.lastPos = p.pos;
  if (!rec.loopRec && rec.punch && p.pos >= rec.punch.end && !rec.ending) {
    rec.ending = true;
    stopRecording({ keepPlaying: true }).then((r) => { rec.last = r; emit('recend'); });
  }
}
export async function startRecording() {
  if (rec.on) return { ok: true };
  const ar = armedTrack(); if (ar >= 0 && ar !== state.sel.track) selectTrack(ar);   // an armed track is the record target: live input goes to the selected track
  const i = state.sel.track, t = state.tracks[i];
  if (!t || (t.kind !== 'audio' && t.kind !== 'midi' && t.kind !== 'drum')) return { error: 'Pilih track audio, synth, atau drum dulu untuk merekam.' };
  const pn = state.punch.on && state.punch.end > state.punch.start ? { start: state.punch.start, end: state.punch.end } : null;
  const L = state.loop, loopRec = !!(state.recLoop && L.on && L.end > L.start);
  let from = state.pos;
  if (loopRec && (from < L.start || from >= L.end)) from = L.start;
  else if (pn && from >= pn.end) from = Math.max(0, barStart(barAt(pn.start) - 1));
  if (from !== state.pos) seekTo(from);
  if (t.kind === 'audio') { const r = await eng.recStart(); if (r && r.error) return r; }
  const beats = state.countIn * MM.nAt(from), cinSecs = beats > 0 ? beats * (tickToSec(from + beatLenAt(from)) - tickToSec(from)) : 0;
  Object.assign(rec, { on: true, ending: false, kind: t.kind === 'audio' ? 'audio' : 'midi', track: i, startTick: from, notes: [], pass: 0, passes: [{ a: from, b: loopRec ? L.end : from }], punch: pn, loopRec, cinSecs, cinUntil: performance.now() + cinSecs * 1000 + 40, lastPos: from, last: null });
  rec.open.clear(); cinOn = beats > 0;
  if (beats > 0) eng.playCountIn(beats); else eng.play();
  emit('rec');
  return { ok: true };
}
export async function stopRecording(opts = {}) {
  if (!rec.on) return null;
  rec.on = false;
  const i = rec.track, endTick = Math.min(currentTick(), rec.punch ? rec.punch.end : Infinity), startTick = rec.startTick, wasCin = cinOn || performance.now() < rec.cinUntil;
  if (!opts.keepPlaying) eng.stop();
  cinOn = false;
  const passes = rec.passes.map((q) => ({ ...q })); passes[passes.length - 1].b = Math.max(passes[passes.length - 1].a, endTick);
  let out = { ok: true, kind: rec.kind, takes: 0 };
  if (rec.kind === 'audio') {
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const r = await eng.recStop(`/Recordings/Rec-${stamp}.wav`);
    if (r && r.error) out = { error: r.error };
    else {
      const lat = (eng.latencyMs() || 0) / 1000, made = [];
      let elapsed = rec.cinSecs;                                    // seconds of the file that belong to the count-in (not music)
      for (const q of passes) {
        const a2 = rec.punch ? Math.max(q.a, rec.punch.start) : q.a, b2 = rec.punch ? Math.min(q.b, rec.punch.end) : q.b;
        const off = elapsed + (tickToSec(a2) - tickToSec(q.a)) + lat;
        elapsed += tickToSec(q.b) - tickToSec(q.a);
        if (b2 - a2 < PPQ / 8 || wasCin && q.b <= q.a) continue;
        const c = await addAudioClip(i, r.path, a2);
        if (!c) { out = { error: 'Rekaman tersimpan tapi tidak bisa dimuat sebagai klip.' }; break; }
        if (off >= c.sample.duration) { removeClip(i, c.id); continue; }
        c.offset = off; c.len = Math.max(PPQ / 4, Math.min(b2 - a2, Math.round((secToTick(tickToSec(a2) + c.sample.duration - off) - a2))));
        made.push(c);
      }
      if (!out.error) {
        made.forEach((c, k) => { if (made.length > 1) { c.name = 'Take ' + (k + 1); if (k < made.length - 1) c.muted = true; } });   // stacked takes: the last one sounds, the others are muted
        for (const c of made) c.name = c.name || (c.sample && c.sample.name) || 'Rekaman';
        syncClips(i); emit('clips');
        out.takes = made.length; out.clip = made[made.length - 1];
        if (!made.length) out = { ok: true, kind: 'audio', empty: true };
      }
    }
  } else {
    for (const [p, o] of rec.open) rec.notes.push({ tick: o.tick, end: endTick, p, v: o.vel, pass: o.pass });
    rec.open.clear();
    if (!rec.notes.length) out = { ok: true, kind: 'midi', empty: true };
    else {
      const byPass = new Map(); for (const n of rec.notes) { if (!byPass.has(n.pass)) byPass.set(n.pass, []); byPass.get(n.pass).push(n); }
      const keys = [...byPass.keys()].sort((x, y) => x - y), made = [];
      for (const k of keys) {
        const list = byPass.get(k), L = state.loop;
        const start = rec.loopRec ? L.start : barFloor(Math.max(startTick, rec.punch ? rec.punch.start : 0));
        const len = rec.loopRec ? Math.max(barLenAt(L.start), L.end - L.start) : Math.max(barLenAt(start), barCeil(Math.max(endTick, ...list.map((n) => n.end))) - start);
        const c = addClip(i, start, len);
        for (const n of list) c.notes.push({ t: Math.max(0, Math.round(n.tick - start)), d: Math.max(60, Math.round(n.end - n.tick)), p: n.p, v: Math.max(0.05, Math.min(1, n.v)) });
        c.notes.sort((a, b) => a.t - b.t); made.push(c);
      }
      made.forEach((c, k) => { if (made.length > 1) { c.name = 'Take ' + (k + 1); if (k < made.length - 1) c.muted = true; } });
      for (const c of made) clipChanged(i);
      out.takes = made.length; out.clip = made[made.length - 1];
    }
  }
  if (!opts.keepPlaying) seekTo(startTick);
  emit('rec');
  return out;
}

// ------------------------------------------------------------------ MIDI CC links ("Link to MIDI CC" in FL Studio Mobile)
export const learn = { pending: null };
export function startCcLearn(target, label) { learn.pending = { target, label }; emit('learn'); }
export function cancelCcLearn() { learn.pending = null; emit('learn'); }
let _rt = 0;
const scheduleRefresh = () => { if (!_rt) _rt = setTimeout(() => { _rt = 0; emit('devices'); emit('mix'); }, 90); };
export function applyTargetValue(target, v) {
  const r = resolveTarget(target);
  if (!r) return;
  switch (target.kind) {
    case 0: setVol(r.track, v); break;
    case 1: setPan(r.track, v); break;
    case 2: case 3: if (r.track < MASTER) setSend(r.track, target.kind - 2, v); break;
    case 4: setDeviceParam(r.track, r.dev, target.param, v); break;
    default: setInstParam(r.track, target.param, v);
  }
  scheduleRefresh();
}
export function midiCC(cc, value) {
  if (learn.pending) { state.ccLinks[cc] = learn.pending; const l = learn.pending; learn.pending = null; emit('learn'); return { linked: cc, label: l.label }; }
  const l = state.ccLinks[cc];
  if (l) applyTargetValue(l.target, valOf(l.target.def, value / 127));
  return null;
}
export function unlinkCc(cc) { delete state.ccLinks[cc]; emit('learn'); }

// ------------------------------------------------------------------ undo / redo of everything that is not a clip
// js/history.js calls this with recording switched off. An entry holds the OLD value of one thing; swapping it puts that value back and keeps the
// value it replaced inside the entry, so the same object serves undo and redo. Things are found by stable ids (track id, device id), never by position.
function placeDevice(i, di, d) {
  tr(i).devices.splice(di, 0, d);
  eng.insertDevice(i, di, d.type);
  d.params.forEach((v, pi) => eng.devParam(i, di, pi, v));
  if (d.bypass) eng.devBypass(i, di, true);
  emit('devices');
}
export function swapRec(e) {
  const i = e.s === undefined ? -1 : stripIndex(e.s), t = i >= 0 ? tr(i) : null;
  switch (e.t) {
    case 'val': {
      if (!t) return;
      let cur;
      if (e.k === 'vol') { cur = t.vol; setVol(i, e.v); }
      else if (e.k === 'pan') { cur = t.pan; setPan(i, e.v); }
      else if (e.k === 'send') { cur = t.send ? t.send[e.p] : 0; setSend(i, e.p, e.v); }
      else if (e.k === 'dev') { const di = t.devices.findIndex((x) => x.id === e.d); if (di < 0) return; cur = t.devices[di].params[e.p]; setDeviceParam(i, di, e.p, e.v); }
      else if (e.k === 'inst') { if (!t.inst) return; const had = e.p in t.inst.params; cur = instVal(t, e.p); setInstParam(i, e.p, e.v); if (e.u) delete t.inst.params[e.p]; e.u = !had; }   // a parameter that was never touched goes back to "not stored", so saved files stay the same
      else if (e.k === 'pitch') { if (!t.inst) return; cur = t.inst.pitch || 0; setPitch(i, e.v); }
      else if (e.k === 'pad') { const q = t.inst && padsOf(i)[e.d]; if (!q) return; cur = q[e.p]; setPad(i, e.d, e.p, e.v); }
      else if (e.k === 'zone') { const z = t.inst && t.inst.zones && t.inst.zones[e.d]; if (!z) return; cur = z[e.p]; setZoneField(i, e.d, e.p, e.v, true); }
      else return;
      if (cur !== undefined) e.v = cur;
      emit('mix'); emit('devices');
      return;
    }
    case 'tog': {
      if (!t) return;
      if (e.k === 'mute') { if (i === MASTER) return; if (i >= RET0) toggleReturnMute(i - RET0); else toggleMute(i); }
      else if (e.k === 'solo') toggleSolo(i);
      else if (e.k === 'arm' || e.k === 'mon') flipTrackFlag(i, e.k);
      else if (e.k === 'byp') { const di = t.devices.findIndex((x) => x.id === e.d); if (di >= 0) toggleBypass(i, di); }
      return;
    }
    case 'out': { if (!t || i >= MASTER) return; const cur = t.out; setOut(i, e.v); e.v = cur; return; }
    case 'name': { if (!t) return; const cur = t.name; t.name = e.v; e.v = cur; emit('tracks'); return; }
    case 'color': { if (!t) return; const cur = t.color; t.color = e.v; e.v = cur; emit('tracks'); return; }
    case 'bpm': {
      const cur = { v: state.bpm, lane: e.lane ? lanePts() : null };
      state.bpm = e.v;
      if (e.lane) { const li = tempoLane(); if (li >= 0) for (const x of e.lane) { const c = state.tracks[li].clips.find((q) => q.id === x.id); if (c) c.pts = x.pts; } syncTempoMap(); }
      eng.tempo(state.bpm); emit('transport');
      e.v = cur.v; e.lane = cur.lane; return;
    }
    case 'loop': { const cur = { start: state.loop.start, end: state.loop.end }; Object.assign(state.loop, e.v); eng.loop(state.loop.on, state.loop.start, state.loop.end); emit('transport'); e.v = cur; return; }
    case 'groove': { const cur = { amt: state.groove.amt, grid: state.groove.grid }; setGroove(e.v); e.v = cur; return; }
    case 'marks': { const cur = marksSnap(); state.markers = e.v; state.markers.sort((a, b) => a.t - b.t); e.v = cur; emit('markers'); return; }
    case 'meter': { const cur = meterSnap(); restoreMeter(e.v); e.v = cur; return; }
    case 'trk': {
      if (e.present) { const k = state.tracks.indexOf(e.r.gone); if (k < 0) return; e.r = detachTrack(k); e.present = false; }
      else { attachTrack(e.r); e.present = true; }
      return;
    }
    case 'tswap': { const a = state.tracks.findIndex((x) => x.id === e.a), b = state.tracks.findIndex((x) => x.id === e.b); if (a >= 0 && b >= 0) swapTracks(a, b); return; }
    case 'dpres': {
      if (!t) return;
      if (e.present) { const di = t.devices.findIndex((x) => x.id === e.d.id); if (di < 0) return; e.di = di; removeDevice(i, di); e.present = false; }
      else { placeDevice(i, Math.min(e.di, t.devices.length), e.d); e.present = true; }
      return;
    }
    case 'dmv': { if (!t) return; const cur = t.devices.findIndex((x) => x.id === e.d); if (cur < 0) return; moveDevice(i, cur, cur === e.b ? e.a : e.b); return; }
    case 'inst': { if (!t) return; const cur = t.inst; t.inst = e.v; e.v = cur; syncTrackFull(i); emit('devices'); return; }
    case 'ipar': {
      if (!t || !t.inst) return;
      const cur = { ...t.inst.params }; t.inst.params = { ...e.v }; e.v = cur;
      const def = INSTRUMENTS[t.inst.type];
      if (def) def.params.forEach((p, k) => { if (k === 90 && t.inst.type === 11) return; eng.instParam(i, k, t.inst.params[k] ?? p.def); });
      emit('devices'); return;
    }
  }
}

hooks.replay = syncAll;
