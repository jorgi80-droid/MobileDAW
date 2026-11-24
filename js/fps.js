// Frame pacing + FPS meter. The browser calls requestAnimationFrame at the display's refresh rate (60/90/120 Hz);
// this module decides which of those frames are actually drawn.
//   Auto  = adaptive 30-120 fps: picks the highest rate (display rate divided by 1, 2, 3 or 4) that this phone renders without dropping frames
//   60 Hz = locked at 60 fps     120 Hz = locked at 120 fps (limited by what the display can show)
import { prefs } from './prefs.js';

const s = { last: 0, lastDraw: 0, dmin: 1e9, n: 0, hz: 60, auto: 120, cost: 3, frames: 0, t0: 0, fps: 0, since: 0 };
export const fpsNow = () => s.fps;
// Phones often run a web page at 60 Hz while nothing on screen changes (the compositor idles and Android picks a low refresh rate).
// A 2px, almost invisible element that moves every frame keeps the page producing frames, so a 90/120 Hz display stays at its high rate.
let ka = null, flip = false;
function pulse() {
  if (typeof document === 'undefined' || !document.body) return;
  if (!ka) { ka = document.createElement('div'); ka.setAttribute('aria-hidden', 'true'); ka.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;pointer-events:none;z-index:2147483647;background:rgba(128,128,128,.03);will-change:transform'; document.body.appendChild(ka); }
  flip = !flip; ka.style.transform = flip ? 'translate3d(0,0,0)' : 'translate3d(1px,0,0)';
}
export const displayHz = () => s.hz;

function candidates() {
  const out = [];
  for (let k = 1; k <= 4; k++) { const f = s.hz / k; if (f >= 29) out.push(f); }
  return out.length ? out : [30];
}
export function targetFps() {
  if (prefs.fpsMode === '60') return 60;
  if (prefs.fpsMode === '120') return 120;
  return s.auto;
}

// true when this animation frame should be drawn
export function shouldDraw(ts) {
  if (s.last) {
    const d = ts - s.last;
    if (d > 3 && d < 60 && d < s.dmin) s.dmin = d;
    if (++s.n >= 30) {                                   // every ~90 frames: re-estimate the display rate (smallest steady interval)
      const hz = Math.max(30, Math.min(240, 1000 / s.dmin));
      s.hz = [30, 48, 60, 72, 90, 120, 144, 165, 240].reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a));   // snap to a real display rate s.dmin = 1e9; s.n = 0;
    }
  }
  s.last = ts;
  const target = targetFps();
  if (prefs.fpsMode !== '60') pulse();
  if (ts - s.lastDraw < (1000 / target) * 0.8) return false;
  s.lastDraw = ts;
  if (prefs.fpsMode === '60') pulse();
  if (!s.t0) s.t0 = ts;
  s.frames++;
  if (ts - s.t0 >= 400) { s.fps = Math.round(s.frames * 1000 / (ts - s.t0)); s.frames = 0; s.t0 = ts; adapt(ts); }
  return true;
}

// called with the milliseconds one drawn frame took
export function recordCost(ms) { s.cost += (Math.min(ms, 60) - s.cost) * 0.12; }

function adapt(ts) {
  if (prefs.fpsMode === '60' || prefs.fpsMode === '120') return;
  const c = candidates();
  if (!c.includes(s.auto)) s.auto = c[Math.min(1, c.length - 1)];
  const need = (f) => s.cost * 1.5 < 1000 / f;           // a frame must use well under its time slot so touch handling keeps up
  if (!need(s.auto)) {                                    // too slow: step down at once
    const lower = c.filter((f) => f < s.auto && true);
    s.auto = lower.length ? lower[0] : c[c.length - 1]; s.since = ts; return;
  }
  const higher = c.filter((f) => f > s.auto).pop();       // nearest faster tier
  if (higher && s.cost * 2.2 < 1000 / higher && ts - s.since > 3000) { s.auto = higher; s.since = ts; }
}
