// Edge guard: in fullscreen / installed mode a finger that lands on the very edge of the screen opens the Android status bar
// (top) or navigation bar / back gesture (bottom, sides). Those system gestures cannot be switched off from a web page, so the app
// makes them hard to hit by accident instead: the edge strip is padded (see layout.js) and any touch that STARTS inside the strip is
// swallowed - it never reaches a button, fader or the timeline. A drag that starts inside the app and crosses the strip is untouched.
// Levels (Pengaturan > UI > Zona tepi layar): 0 off, 1 normal, 2 lebar.
import { prefs } from './prefs.js';
import { isStandalone } from './pwa.js';

export const EDGE_LEVELS = ['Mati', 'Normal', 'Lebar'];
// CSS px of padding kept free at top / bottom per level, and the dead strip at the left / right edge
export const EDGE_INSET = [{ t: 5, b: 0, s: 0 }, { t: 8, b: 14, s: 8 }, { t: 14, b: 26, s: 14 }];
const EXTRA = 4;                                   // the dead strip reaches a little further than the padding

const blocked = new Set();                         // pointer ids whose touch started in the strip
const level = () => Math.max(0, Math.min(2, prefs.edgeGuard ?? 1));
const active = () => level() > 0 && (!!document.fullscreenElement || isStandalone());
function inStrip(x, y) {
  const g = EDGE_INSET[level()], w = window.innerWidth, h = window.innerHeight;
  return y < g.t + EXTRA || y > h - g.b - EXTRA || (g.s > 0 && (x < g.s || x > w - g.s));
}
const eat = (e) => { e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); };

export function initEdgeGuard() {
  const opt = { capture: true, passive: false };
  addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !active() || !inStrip(e.clientX, e.clientY)) return;
    blocked.add(e.pointerId); eat(e);
  }, opt);
  for (const ev of ['pointermove', 'pointerup', 'pointercancel']) {
    addEventListener(ev, (e) => {
      if (!blocked.has(e.pointerId)) return;
      if (ev !== 'pointermove') blocked.delete(e.pointerId);
      eat(e);
    }, opt);
  }
  addEventListener('touchstart', (e) => { if (active() && [...e.changedTouches].some((t) => inStrip(t.clientX, t.clientY))) eat(e); }, opt);
  addEventListener('click', (e) => { if (e.pointerType !== 'mouse' && e.detail !== 0 && active() && inStrip(e.clientX, e.clientY)) eat(e); }, opt);
}
