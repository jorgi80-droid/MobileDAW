// Touch hit-slop. The Live look draws buttons 20-28 px tall, smaller than a finger. A tap that lands on plain panel surface (no control
// there) close to a button counts as a tap on the nearest one, so every button has an effective touch area of at least 44 x 44 CSS px
// without growing on screen. A tap never moves to a control in another panel, and never when it lands on a real control or on a surface
// with its own gestures (knobs, sliders, displays, the arrangement, the piano roll): only empty panel background forwards.
import { emuK } from './uiscale.js';
const BTN = 'button, .lv-btn, .lv-tab, .lv-fld, [role="button"], .mi';
const SKIP = BTN + ', .knob, input, select, textarea, canvas, svg, a, label, [contenteditable], .lk-dfill, .lv-disp, .zmap, .lslider, .lk-n, .scrim, [data-nohit]';
const ZONES = '#top, #dtabs, .dev-scroll > .card, .modal, .menu, .cp, .fw-win, .fw';   // panels whose empty surface forwards taps
const MIN = 44, REACH = 16, MOVE = 8, TIME = 600;   // CSS px of the screen (the page itself is scaled by the UI scale)
const cssPerLayout = () => ((typeof visualViewport !== 'undefined' && visualViewport && visualViewport.scale) || 1) * (emuK() || 1);

const visible = (e) => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return null; for (let p = e; p; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none') return null; } return r; };

// the button nearest to (x, y) whose 44 x 44 px touch area contains the point, inside `zone`; null when none
export function nearestButton(zone, x, y) {
  let best = null, bd = Infinity; const k = cssPerLayout(), min = MIN / k, reach = REACH / k;
  for (const e of zone.querySelectorAll(BTN)) {
    if (e.disabled || e.closest('[aria-disabled="true"]')) continue;
    const r = visible(e); if (!r) continue;
    const ex = Math.max(0, (min - r.width) / 2), ey = Math.max(0, (min - r.height) / 2);
    if (x < r.left - ex || x > r.right + ex || y < r.top - ey || y > r.bottom + ey) continue;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0, dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0, d = Math.hypot(dx, dy);
    if (d > reach) continue;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

let pend = null, done = false;
export function initTouchHit() {
  if (done || typeof document === 'undefined') return; done = true;
  document.addEventListener('pointerdown', (e) => {
    pend = null;
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    const t = e.target instanceof Element ? e.target : null; if (!t || t.closest(SKIP)) return;
    const zone = t.closest(ZONES); if (!zone) return;
    const b = nearestButton(zone, e.clientX, e.clientY);
    if (b) pend = { b, x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
  }, true);
  document.addEventListener('pointermove', (e) => { if (pend && e.pointerId === pend.id && Math.hypot(e.clientX - pend.x, e.clientY - pend.y) > MOVE / cssPerLayout()) pend = null; }, true);
  document.addEventListener('pointercancel', () => { pend = null; }, true);
  document.addEventListener('pointerup', (e) => {
    const p = pend; pend = null;
    if (!p || e.pointerId !== p.id || e.timeStamp - p.t > TIME || !p.b.isConnected) return;
    p.b.classList.add('hit-flash'); setTimeout(() => p.b.classList.remove('hit-flash'), 140);
    p.b.click();
  }, true);
}
