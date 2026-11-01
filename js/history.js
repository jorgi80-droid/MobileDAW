// Undo/redo. Two kinds of entries share one stack:
//  - clip entries: a snapshot of every track's clips + notes taken before a clip edit (clip objects are copied, sample objects are shared);
//  - small entries for everything else (fader, pan, sends, device and instrument parameters, device order, track add / remove / order,
//    tempo, signature changes, markers, swing, loop): they hold only the OLD value of the one thing that changed (see swapRec in project.js).
// Entries are swapped with the live state, so the same object serves undo and redo. Knob / fader drags are merged into one step.
import { state, syncClips, syncPads, emit, HK, swapRec, scheduleBake } from './project.js';
import { log } from './log.js';

const undo = [], redo = [], MAX = 80, GAP = 900;     // GAP: ms without a change before the next change of the same control becomes a new step
let lastKey = null, lastT = 0, pending = false, grp = null, depth = 0;

const snap = () => ({ n: state.tracks.length, pads: state.tracks.map((t) => (t.kind === 'drum' && t.inst && Array.isArray(t.inst.pads) ? t.inst.pads.map((q) => ({ ...q })) : null)), tracks: state.tracks.map((t) => t.clips.map((c) => {
  const o = { ...c };
  if (c.notes) o.notes = c.notes.map((x) => ({ ...x }));
  if (c.pts) o.pts = c.pts.map((x) => ({ ...x }));   // automation points are edited in place, so they must be copied too
  if (c.warp) o.warp = { ...c.warp };
  if (c.cc) o.cc = c.cc.map((l) => ({ ...l, pts: l.pts.map((q) => ({ ...q })) }));   // controller lanes are edited in place
  return o;
})) });

function commit(e) { undo.push(e); if (undo.length > MAX) undo.shift(); redo.length = 0; emit('history'); }
function add(e) {
  if (pending) pending = false; else lastKey = null;      // an entry that did not come through hit() ends any drag being merged
  if (grp) grp.items.push(e); else commit(e);
}
function hit(key) {
  if (grp) { if (grp.keys.has(key)) return true; grp.keys.add(key); return false; }
  const now = performance.now();
  if (key === lastKey && now - lastT < GAP && undo.length) { lastT = now; return true; }
  lastKey = key; lastT = now; pending = true;
  return false;
}
export function checkpoint() { add({ t: 'clips', s: snap() }); }
export function clearHistory() { undo.length = 0; redo.length = 0; lastKey = null; pending = false; emit('history'); }
export const canUndo = () => undo.length > 0;
export const canRedo = () => redo.length > 0;

// several changes that belong together (a preset, a MIDI import) become ONE undo step
export function begin() { if (depth++ === 0) grp = { t: 'grp', items: [], up: false, keys: new Set() }; }
export function end() {
  if (--depth > 0) return;
  depth = 0;
  const g = grp; grp = null;
  if (g && g.items.length) { lastKey = null; commit(g.items.length === 1 ? g.items[0] : g); }
}
export function group(fn) {
  begin();
  let r;
  try { r = fn(); } catch (e) { end(); throw e; }
  if (r && typeof r.then === 'function') return r.finally(end);
  end();
  return r;
}

function restore(s) {
  if (s.n !== state.tracks.length) return;
  state.tracks.forEach((t, i) => {
    t.clips = s.tracks[i];
    const old = s.pads && s.pads[i];                       // pad list: only a removed / added pad is undone, knob settings keep their current values
    if (old && t.inst && Array.isArray(t.inst.pads) && old.map((q) => q.pitch).join() !== t.inst.pads.map((q) => q.pitch).join()) {
      const now = new Map(t.inst.pads.map((q) => [q.pitch, q]));
      t.inst.pads = old.map((q) => now.get(q.pitch) || q);
      syncPads(i); emit('devices');
    }
    syncClips(i);
  });
  if (!state.tracks.some((t) => t.clips.some((c) => c.id === state.sel.clip))) state.sel.clip = null;
  scheduleBake(60);                                         // warped audio clips that came back need their baked version again
  emit('clips'); emit('notes'); emit('history');
}
function swap(e) {
  if (e.t === 'clips') { const cur = snap(); restore(e.s); e.s = cur; }
  else if (e.t === 'grp') { const L = e.up ? e.items : e.items.slice().reverse(); for (const x of L) swap(x); e.up = !e.up; }
  else swapRec(e);
}
function run(e) {
  const was = HK.on; HK.on = false;
  try { swap(e); } catch (err) { log('error', 'undo', err); } finally { HK.on = was; }
  lastKey = null; pending = false;
}
export function undoOp() { if (!undo.length) return; const e = undo.pop(); run(e); redo.push(e); emit('history'); }
// a cancelled gesture (Escape / a second finger / the system took the pointer): put back the state saved by the checkpoint taken when the
// gesture started, and leave no undo or redo step behind (nothing happened as far as the user is concerned)
export function revertLast() { if (!undo.length) return false; const e = undo.pop(); run(e); emit('history'); return true; }
export function redoOp() { if (!redo.length) return; const e = redo.pop(); run(e); undo.push(e); emit('history'); }

HK.hit = hit; HK.add = add; HK.group = group; HK.barrier = clearHistory;
