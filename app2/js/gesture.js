// One gesture recogniser for every canvas/panel. Coordinates are element-local CSS pixels.
//
// handlers (all optional):
//   hit(x, y)                       -> anything; stored as `target` and passed to the callbacks below
//   tap(x, y, target)               short tap          dtap(x, y, target)  second tap of a double tap
//   defer(target)                   -> true: this target has a double-tap action, so its single tap waits for the double-tap window and is
//                                   NOT fired when a second tap follows (a double tap is never read as two single taps)
//   long(x, y, target)              long press; return true to keep the finger as a drag (e.g. rubber-band select)
//   longMs(target, ms)              -> this target's long-press time (default: the preference), e.g. a deliberate 1 s hold before a
//                                   rubber band on empty space, so a quick one-finger drag there always scrolls
//   dragStart(x0, y0, target, fromLong) -> true if the handler wants this drag; false -> one-finger pan
//   drag(x, y, dx, dy, target)      dx/dy measured from the start        dragEnd(x, y, target, cancelled)
//   pan(ddx, ddy)                   incremental one-finger pan (when dragStart declined) or two-finger pan
//   pinch(cx, cy, sx, sy)           incremental scale factors, split per axis by finger orientation, centred between the fingers
//   panEnd(vx, vy)                  one-finger pan released while moving; speed in px/s (fling)
//   pinchEnd()                      the last of two fingers lifted
//   wheel(e)                        desktop testing
//
// Timing and distance come from the user's preferences (Settings -> Sentuhan), read at the start of every gesture:
//   long-press threshold, movement tolerance (touch slop; a mouse always uses a small fixed slop) and the double-tap window.
// A long press that is recognised gives a short haptic tick (when the device and the preference allow it).
// cancelGestures() (Escape, a dialog opening) ends the active gesture everywhere: dragEnd(..., true) lets each editor put things back.
import { prefs } from './prefs.js';

export const GESTURE_DEFAULTS = { longMs: 430, slop: 8, dtapMs: 320 };
export const gestureTiming = () => ({
  longMs: clampN(prefs.longMs, 250, 900, GESTURE_DEFAULTS.longMs),
  slop: clampN(prefs.touchSlop, 4, 20, GESTURE_DEFAULTS.slop),
  dtapMs: clampN(prefs.dtapMs, 200, 500, GESTURE_DEFAULTS.dtapMs),
});
function clampN(v, lo, hi, d) { v = +v; return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; }

// short vibration for gesture feedback (long press recognised, drag mode entered). Silently does nothing where unsupported.
export function haptic(ms = 12) {
  if (prefs.haptics === false) return;
  try { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms); } catch (_) { /* not allowed */ }
}

const active = new Set();       // cancel functions of recognisers with a gesture in progress
export function cancelGestures() { let any = false; for (const c of [...active]) any = c() || any; return any; }
export const gestureActive = () => active.size > 0;

export function attachGestures(el, h) {
  const ptrs = new Map();
  let g = null, pinch = null, lastTap = { t: 0, x: -99, y: -99 }, pend = null;
  let T = gestureTiming();

  let rect = null;   // measured once per gesture: reading layout on every pointer move forces reflow and costs frames
  const local = (e) => { const r = rect || (rect = el.getBoundingClientRect()); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const endSingle = (cancel) => {
    if (!g) return;
    clearTimeout(g.timer);
    if ((g.mode === 'drag' || g.mode === 'longdrag') && h.dragEnd) h.dragEnd(g.x, g.y, g.target, cancel);
    g = null;
  };
  const cancel = () => {
    const had = !!(g && (g.mode === 'drag' || g.mode === 'longdrag' || g.mode === 'pan')) || !!pinch;
    if (g) { g.cancelled = true; endSingle(true); }
    if (pinch) { pinch = null; if (h.pinchEnd) h.pinchEnd(); }
    active.delete(cancel);
    return had;
  };
  const flushPending = () => { if (!pend) return; clearTimeout(pend.timer); const p = pend; pend = null; if (h.tap) h.tap(p.x, p.y, p.target); };

  el.addEventListener('pointerdown', (e) => {
    if (!ptrs.size) { rect = null; T = gestureTiming(); }
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
    const p = local(e);
    ptrs.set(e.pointerId, p);
    active.add(cancel);
    if (ptrs.size === 1) {
      g = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, mode: 'wait', target: h.hit ? h.hit(p.x, p.y) : null, timer: 0, px: p.x, py: p.y, slop: e.pointerType === 'mouse' ? 4 : T.slop };
      // a pending (deferred) tap somewhere else is no double tap any more: fire it now so it is never lost
      if (pend && Math.hypot(p.x - pend.x, p.y - pend.y) >= 26 + T.slop) flushPending();
      g.timer = setTimeout(() => {
        if (!g || g.mode !== 'wait') return;
        flushPending();
        const keep = h.long ? h.long(g.x, g.y, g.target) === true : false;
        g.mode = keep ? 'longdrag' : 'done';
        if (h.long) haptic(keep ? 30 : 10);                         // a mode entered (rubber band, lifted item): a clearly felt buzz
        if (keep && h.dragStart) h.dragStart(g.x0, g.y0, g.target, true);
      }, h.longMs ? Math.max(T.longMs, +h.longMs(g.target, T.longMs) || 0) : T.longMs);
    } else if (ptrs.size === 2) {
      flushPending();
      endSingle(true);
      const [a, b] = [...ptrs.values()];
      pinch = { dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
  });

  el.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const p = local(e);
    ptrs.set(e.pointerId, p);
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const n = { dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      // only scale an axis when the fingers are clearly separated along it
      const sx = pinch.dx > 36 && n.dx > 12 ? n.dx / pinch.dx : 1;
      const sy = pinch.dy > 36 && n.dy > 12 ? n.dy / pinch.dy : 1;
      if (h.pinch && (sx !== 1 || sy !== 1)) h.pinch(n.cx, n.cy, sx, sy);
      if (h.pan) h.pan(n.cx - pinch.cx, n.cy - pinch.cy);
      pinch = n;
      return;
    }
    if (!g || e.pointerId !== g.id) return;
    g.x = p.x; g.y = p.y;
    if (g.mode === 'wait' && Math.hypot(p.x - g.x0, p.y - g.y0) > g.slop) {
      clearTimeout(g.timer);
      flushPending();
      g.mode = h.dragStart && h.dragStart(g.x0, g.y0, g.target, false) ? 'drag' : 'pan';
    }
    if (g.mode === 'drag' || g.mode === 'longdrag') {
      if (h.drag) h.drag(p.x, p.y, p.x - g.x0, p.y - g.y0, g.target);
    } else if (g.mode === 'pan') {
      if (h.pan) h.pan(p.x - g.px, p.y - g.py);
      const ts = e.timeStamp, vs = g.vs || (g.vs = []); vs.push([ts, p.x, p.y]); while (vs.length > 2 && ts - vs[0][0] > 90) vs.shift();   // last ~90 ms of the finger path
    }
    g.px = p.x; g.py = p.y;
  });

  const up = (e, cancelled) => {
    if (!ptrs.has(e.pointerId)) return;
    const p = local(e);
    ptrs.delete(e.pointerId);
    if (!ptrs.size) active.delete(cancel);
    if (pinch) { if (ptrs.size < 2) { pinch = null; if (h.pinchEnd) h.pinchEnd(); } return; }
    if (!g || e.pointerId !== g.id) return;
    g.x = p.x; g.y = p.y;
    if (g.mode === 'wait' && !cancelled) {
      clearTimeout(g.timer);
      const now = performance.now(), target = g.target;
      const dbl = now - lastTap.t < T.dtapMs && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 26 + T.slop;
      g = null;
      if (dbl && h.dtap) {
        if (pend) { clearTimeout(pend.timer); pend = null; } else if (h.tap && !(h.defer && h.defer(target))) h.tap(p.x, p.y, target);
        lastTap.t = 0;
        h.dtap(p.x, p.y, target);
        return;
      }
      lastTap = { t: now, x: p.x, y: p.y };
      if (h.dtap && h.defer && h.defer(target)) {                 // wait: a second tap turns this into a double tap and the single tap is dropped
        flushPending();
        pend = { x: p.x, y: p.y, target, timer: setTimeout(() => { const q = pend; pend = null; if (q && h.tap) h.tap(q.x, q.y, q.target); }, T.dtapMs) };
        return;
      }
      if (h.tap) h.tap(p.x, p.y, target);
    } else {
      if (g.mode === 'pan' && !cancelled && h.panEnd) {
        const vs = g.vs || [], a = vs[0], b = vs[vs.length - 1];
        if (a && b && b !== a && e.timeStamp - b[0] < 70) { const d = Math.max(16, b[0] - a[0]); h.panEnd((b[1] - a[1]) / d * 1000, (b[2] - a[2]) / d * 1000); } else h.panEnd(0, 0);
      }
      endSingle(cancelled);
    }
  };
  el.addEventListener('pointerup', (e) => up(e, false));
  el.addEventListener('pointercancel', (e) => up(e, true));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('wheel', (e) => { if (h.wheel) { e.preventDefault(); h.wheel(e, local(e)); } }, { passive: false });
  return { cancel, pending: () => !!pend };
}
