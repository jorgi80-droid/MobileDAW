// MobileDAW 2: the module's own display on the card's screen. The full editor (fxkit.js / flmpanels.js) draws its graphics from the
// module's real parameters and the engine's own formulas (EQ response, reverb space, stereo field, delay taps, the synths' oscillators,
// filters and envelopes); the card builds that editor off screen and shows its display, repainted while the rack is visible, so the
// graphic follows a knob turned on the card. For a tabbed instrument (FL Studio Mobile's synths) the card's tab chooses the page.
import { h } from '../ui.js';

const paintOf = (el) => { const c = el && (el.tagName === 'CANVAS' ? el : el.querySelector('canvas')); return c && c.paint ? c : null; };

// build: () => the full editor's element (or { el }); every: the card's timer; returns the screen element or null (no display)
export function realScreen(build, every) {
  let root = null;
  try { root = build(); root = root && (root.el || root); } catch (e) { console.warn('realScreen', e); return null; }
  if (!root || !root.querySelector) return null;
  const box = h('div', { class: 'u2real' });
  let cur = null;
  // FL Studio Mobile synth pages size their display from its box (.flm-dbox), Live-style panels from .lk-dfill, the rest is a canvas
  const pick = () => root.querySelector('.flm-pg .flm-dbox, .flm-pg .lk-dfill, .flm-pg canvas.lv-disp') || root.querySelector('.flm-dbox, .lk-dfill, canvas.lv-disp');
  const fit = () => {
    if (!cur) return; const w = Math.floor(box.clientWidth), hh = Math.floor(box.clientHeight); if (w < 20 || hh < 20) return;
    const cv = paintOf(cur); if (!cv) return;
    if (cur.classList.contains('lk-dfill') || cur.classList.contains('flm-dbox')) { Object.assign(cur.style, { minWidth: '0', minHeight: '0', width: w + 'px', height: hh + 'px', flex: 'none' }); return; }   // they follow their box
    if (cv.resize && (cv._w !== w || cv._h !== hh)) { cv.resize(w, hh); cv.style.width = w + 'px'; cv.style.height = hh + 'px'; }
  };
  const mount = () => { const c = pick(); if (!c) return false; if (c !== cur) { cur = c; box.replaceChildren(c); requestAnimationFrame(fit); } return true; };
  if (!mount()) return null;
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(box);
  every(90, () => { const cv = paintOf(cur); if (cv) cv.paint(); });
  // a tabbed editor: show page n (the full editor's own tab button), then its display
  box.setTab = (n) => {
    const tb = root.querySelector('.flm-tabs, .lv-tabs'); const bs = tb ? [...tb.querySelectorAll('button')] : [];
    if (bs[n]) { bs[n].click(); cur = null; mount(); fit(); }
  };
  box.root = root;
  return box;
}
