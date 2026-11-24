// FL Studio Mobile module reorder, shared by every device chain (main chain, Audio / Instrument Rack chains, Drum Rack pad chains):
// long-press a module's title bar (not its buttons), then slide it along the chain. The card lifts and follows the finger, an accent line
// shows where it will land, the chain scrolls at its edges; lifting the finger calls move(to). Moving before the long press is recognised
// scrolls the chain as usual; a lift without moving changes nothing.
//   reorderGrip(head, { index, siblings: (card) => [cards in chain order], move: (to) => void })
import { gestureTiming, haptic } from './gesture.js';

const scrollerOf = (el) => {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return p;
    if (p.classList && p.classList.contains('dev-scroll')) return p;
  }
  return el.parentElement;
};

export function reorderGrip(head, o) {
  let st = null;
  const clear = () => {
    if (!st) return; clearTimeout(st.tm); cancelAnimationFrame(st.raf);
    if (st.on) { st.card.classList.remove('dv-lift'); st.card.style.transform = ''; for (const x of st.others) x.el.classList.remove('dv-ins-b', 'dv-ins-a'); document.documentElement.classList.remove('dv-reordering'); }
    st = null;
  };
  const target = () => {
    const sc = st.scroll, mid = st.c0 + (st.x - st.x0) + (sc.scrollLeft - st.sl0);
    let to = 0; for (const x of st.others) if (x.c < mid) to++;
    for (const x of st.others) x.el.classList.remove('dv-ins-b', 'dv-ins-a');
    const nx = st.others[to] || null, pv = st.others[to - 1] || null;
    if (to !== o.index) { if (nx) nx.el.classList.add('dv-ins-b'); else if (pv) pv.el.classList.add('dv-ins-a'); }
    return to;
  };
  const move = () => { if (!st || !st.on) return; st.card.style.transform = `translateX(${st.x - st.x0 + (st.scroll.scrollLeft - st.sl0)}px)`; target(); };
  const begin = () => {
    const card = head.closest('.card'); if (!card) { st = null; return; }
    const list = o.siblings(card); if (list.length < 2) { st = null; return; }
    const scroll = scrollerOf(card), sl = scroll.scrollLeft;
    const cx = (el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2 + sl; };
    Object.assign(st, { on: true, card, scroll, sl0: sl, c0: cx(card), others: list.filter((el) => el !== card).map((el) => ({ el, c: cx(el) })) });
    head._noTap = true;
    card.classList.add('dv-lift'); document.documentElement.classList.add('dv-reordering'); haptic(14);
    try { head.setPointerCapture(st.id); } catch (_) { /* pointer gone */ }
    const edge = () => {
      if (!st) return;
      const r = st.scroll.getBoundingClientRect(), M = 40;
      const v = st.x < r.left + M ? -(r.left + M - st.x) / 3 : st.x > r.right - M ? (st.x - (r.right - M)) / 3 : 0;
      if (v) { st.scroll.scrollLeft += v; move(); }
      st.raf = requestAnimationFrame(edge);
    };
    st.raf = requestAnimationFrame(edge);
    move();
  };
  head.addEventListener('pointerdown', (e) => {
    if ((e.target.closest && e.target.closest('button')) || head.closest('.fw') || e.button > 0) return;
    clear();
    st = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, on: false, tm: 0, raf: 0 };
    st.tm = setTimeout(() => { if (st && !st.on) begin(); }, gestureTiming().longMs);
  });
  head.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    st.x = e.clientX;
    if (!st.on) { if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) > gestureTiming().slop) clear(); return; }   // moved first = a scroll
    move();
  });
  head.addEventListener('touchmove', (e) => { if (st && st.on && e.cancelable) e.preventDefault(); }, { passive: false });   // the card follows the finger, not the chain
  head.addEventListener('pointerup', (e) => {
    if (!st || e.pointerId !== st.id) return;
    const on = st.on, to = on ? target() : o.index; clear();
    if (on && to !== o.index) o.move(to);
  });
  head.addEventListener('pointercancel', clear);
  head.addEventListener('contextmenu', (e) => e.preventDefault());
  return head;
}
