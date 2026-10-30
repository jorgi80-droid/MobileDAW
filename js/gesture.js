// One gesture recogniser for every canvas/panel. Coordinates are element-local CSS pixels.
//
// handlers (all optional):
//   hit(x, y)                       -> anything; stored as `target` and passed to the callbacks below
//   tap(x, y, target)               short tap          dtap(x, y, target)  second tap of a double tap
//   long(x, y, target)              long press; return true to keep the finger as a drag (e.g. rubber-band select)
//   dragStart(x0, y0, target, fromLong) -> true if the handler wants this drag; false -> one-finger pan
//   drag(x, y, dx, dy, target)      dx/dy measured from the start        dragEnd(x, y, target)
//   pan(ddx, ddy)                   incremental one-finger pan (when dragStart declined) or two-finger pan
//   pinch(cx, cy, sx, sy)           incremental scale factors, split per axis by finger orientation
//   panEnd(vx, vy)                  one-finger pan released while moving; speed in px/s (fling)
//   pinchEnd()                      the last of two fingers lifted
//   wheel(e)                        desktop testing
export function attachGestures(el, h) {
  const ptrs = new Map();
  let g = null, pinch = null, lastTap = { t: 0, x: -99, y: -99 };
  const TH = 7, LONG = 430, DOUBLE = 320;

  let rect = null;   // measured once per gesture: reading layout on every pointer move forces reflow and costs frames
  const local = (e) => { const r = rect || (rect = el.getBoundingClientRect()); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const endSingle = (cancel) => {
    if (!g) return;
    clearTimeout(g.timer);
    if ((g.mode === 'drag' || g.mode === 'longdrag') && h.dragEnd) h.dragEnd(g.x, g.y, g.target, cancel);
    g = null;
  };

  el.addEventListener('pointerdown', (e) => {
    if (!ptrs.size) rect = null;
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
    const p = local(e);
    ptrs.set(e.pointerId, p);
    if (ptrs.size === 1) {
      g = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, mode: 'wait', target: h.hit ? h.hit(p.x, p.y) : null, timer: 0, px: p.x, py: p.y };
      g.timer = setTimeout(() => {
        if (!g || g.mode !== 'wait') return;
        const keep = h.long ? h.long(g.x, g.y, g.target) === true : false;
        g.mode = keep ? 'longdrag' : 'done';
        if (keep && h.dragStart) h.dragStart(g.x0, g.y0, g.target, true);
      }, LONG);
    } else if (ptrs.size === 2) {
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
    if (g.mode === 'wait' && Math.hypot(p.x - g.x0, p.y - g.y0) > TH) {
      clearTimeout(g.timer);
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

  const up = (e, cancel) => {
    if (!ptrs.has(e.pointerId)) return;
    const p = local(e);
    ptrs.delete(e.pointerId);
    if (pinch) { if (ptrs.size < 2) { pinch = null; if (h.pinchEnd) h.pinchEnd(); } return; }
    if (!g || e.pointerId !== g.id) return;
    g.x = p.x; g.y = p.y;
    if (g.mode === 'wait' && !cancel) {
      clearTimeout(g.timer);
      const now = performance.now();
      const dbl = now - lastTap.t < DOUBLE && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 26;
      if (h.tap) h.tap(p.x, p.y, g.target);
      if (dbl && h.dtap) { h.dtap(p.x, p.y, g.target); lastTap.t = 0; } else lastTap = { t: now, x: p.x, y: p.y };
      g = null;
    } else {
      if (g.mode === 'pan' && !cancel && h.panEnd) {
        const vs = g.vs || [], a = vs[0], b = vs[vs.length - 1];
        if (a && b && b !== a && e.timeStamp - b[0] < 70) { const d = Math.max(16, b[0] - a[0]); h.panEnd((b[1] - a[1]) / d * 1000, (b[2] - a[2]) / d * 1000); } else h.panEnd(0, 0);
      }
      endSingle(cancel);
    }
  };
  el.addEventListener('pointerup', (e) => up(e, false));
  el.addEventListener('pointercancel', (e) => up(e, true));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('wheel', (e) => { if (h.wheel) { e.preventDefault(); h.wheel(e, local(e)); } }, { passive: false });
}
