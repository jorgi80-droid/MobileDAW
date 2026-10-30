// Robust sizing for fullscreen / notch / zoom. The app box follows the *visual* viewport (what is really visible), the
// safe-area insets (camera notch, rounded corners) are measured and padded, and a stray page zoom is reset.
import { prefs } from './prefs.js';
import { log } from './log.js';
import { EDGE_INSET } from './edgeguard.js';
import { installScaleShim, setEmuK } from './uiscale.js';
installScaleShim();

// Fixed margins in CSS px (same for every phone): the arrangement runs edge to edge, only a small top margin remains.
// The camera cut-out is NOT padded any more (that padding was the empty band on both sides).
const INSET = { l: 0, r: 0, t: 5, b: 0 };
const root = document.documentElement;
let meta = null, resetting = false, hMax = 0, hmW = 0, lastVvH = 0;
const isFull = () => !!document.fullscreenElement || ['fullscreen', 'standalone'].some((m) => window.matchMedia && window.matchMedia(`(display-mode: ${m})`).matches);

// An installed (standalone / fullscreen) PWA ignores initial-scale, so the UI scale did nothing there. A fixed layout width is honoured in both
// modes: the browser fits that many CSS px onto the screen, which is exactly a UI scale. screen.width is the device width in CSS px at scale 1.
const deviceCssWidth = () => { const a = window.screen ? window.screen.width : 0, b = window.screen ? window.screen.height : 0; const land = window.matchMedia && window.matchMedia('(orientation: landscape)').matches; return (land ? Math.max(a, b) : Math.min(a, b)) || window.innerWidth; };
// Reference phone: 2374 x 1080 physical pixels. On that screen the layout width is chosen so one CSS px is a quarter-step number of physical
// pixels (ratio multiple of 0.25), which keeps 1 px lines, knobs and text on the pixel grid instead of smeared between two pixels.
const REF = { w: 2374, h: 1080 };
const nativeDpr = () => { const a = Math.max(window.screen ? window.screen.width : 0, window.screen ? window.screen.height : 0), b = Math.min(window.screen ? window.screen.width : 0, window.screen ? window.screen.height : 0); return a && b && Math.abs(a / b - REF.w / REF.h) < 0.03 ? REF.w / a : 0; };
export function effectiveScale(scale) {            // the scale really applied (the slider value, nudged onto the pixel grid on the reference screen)
  const d = deviceCssWidth(), nd = nativeDpr();
  if (scale === 1 || !nd) return { w: Math.round(d / scale), s: scale };
  const ratio = Math.max(0.5, Math.round(nd * scale * 4) / 4), w = Math.round(REF.w / ratio);
  return { w, s: d / w };
}
const viewportContent = (scale) => { if (scale === 1) return 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'; const e = effectiveScale(scale), sc = Math.round(e.s * 10000) / 10000; return `width=${e.w}, initial-scale=${sc}, minimum-scale=${sc}, maximum-scale=${sc}, user-scalable=no, viewport-fit=cover`; };
export function applyViewportMeta() {
  meta = meta || document.querySelector('meta[name=viewport]');
  if (!meta) return;
  const c = viewportContent(prefs.uiScale || 1);
  if (meta.getAttribute('content') !== c) meta.setAttribute('content', c);
}
let lastReset = 0, lastKey = '';
function resetZoom() {            // only for a real stray zoom (pinch / fullscreen quirk); rate-limited so it can never loop
  const now = Date.now();
  if (resetting || now - lastReset < 4000) return;
  lastReset = now; resetting = true;
  meta = meta || document.querySelector('meta[name=viewport]');
  if (!meta) { resetting = false; return; }
  meta.setAttribute('content', viewportContent(1));
  setTimeout(() => { applyViewportMeta(); resetting = false; relayout(); }, 120);
}
export function relayout() {
  const vv = window.visualViewport;
  const w = vv ? vv.width : window.innerWidth;
  let h = vv ? vv.height : window.innerHeight;
  // Pulling down the status bar / quick settings makes some Android browsers shrink the viewport for a moment. Native DAWs (FL Studio Mobile) do
  // not re-layout for that, so neither do we: a small shrink without the keyboard keeps the biggest height seen for this width.
  if (Math.abs(w - hmW) > 2) { hmW = w; hMax = 0; }
  if (h > hMax) hMax = h;
  const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  const held = !typing && h < hMax && hMax - h <= 120 && isFull();
  if (held) h = hMax;
  if (vv && Math.abs(vv.height - lastVvH) > 1) {      // diagnostics for the status-bar behaviour: Pengaturan > Log shows what the browser reported
    log('info', 'layar', `vv ${Math.round(vv.width)}x${Math.round(vv.height)} top ${Math.round(vv.offsetTop)} inner ${innerHeight} screen ${screen.height} fs ${document.fullscreenElement ? 1 : 0} mode ${['fullscreen', 'standalone', 'browser'].find((m) => m === 'browser' || matchMedia(`(display-mode: ${m})`).matches)} ${held ? 'ditahan' : ''}`);
    lastVvH = vv.height;
  }
  applyViewportMeta();                                  // orientation change alters the device width the fixed layout width is derived from
  const g = EDGE_INSET[Math.max(0, Math.min(2, prefs.edgeGuard ?? 1))];   // padding along the screen edges keeps controls out of the system-gesture strip
  // Did the viewport meta tag give the layout width the slider asks for? Not in fullscreen: then scale with CSS (see uiscale.js), K = real / wanted width.
  const wantW = effectiveScale(prefs.uiScale || 1).w, haveW = root.clientWidth || w;
  let k = Math.abs(haveW - wantW) <= 3 ? 1 : haveW / wantW;
  if (!(k > 0.25 && k < 4)) k = 1;
  k = Math.round(k * 1000) / 1000;
  const key = [Math.round(w * 100), Math.round(h * 100), vv ? Math.round(vv.offsetLeft) : 0, vv && !held ? Math.round(vv.offsetTop) : 0, prefs.uiScale || 1, g.t, g.b, k].join('|');
  if (key === lastKey) { if (vv && vv.scale > Math.max(1.08, (prefs.uiScale || 1) * 1.08) && !resetting) resetZoom(); return; }   // nothing changed: skip the style writes and the redraw of every canvas
  lastKey = key;
  setEmuK(k);
  const s = root.style, lw = w / k, lh = h / k;               // layout-space size of the page (equal to w, h when k is 1)
  root.classList.toggle('emu', k !== 1); s.setProperty('--k', String(k));
  s.setProperty('--vw', Math.round(lw * 100) / 100 + 'px'); s.setProperty('--vh', Math.round(lh * 100) / 100 + 'px');
  s.setProperty('--vx', (vv ? vv.offsetLeft / k : 0) + 'px'); s.setProperty('--vy', (vv && !held ? vv.offsetTop / k : 0) + 'px');
  s.setProperty('--ui', String(Math.round(effectiveScale(prefs.uiScale || 1).s * 1000) / 1000));          // CSS px shrink with the UI scale: touch targets divide by it to stay finger-sized
  s.setProperty('--sat', Math.max(INSET.t, g.t) + 'px'); s.setProperty('--sar', INSET.r + 'px');
  s.setProperty('--sab', Math.max(INSET.b, g.b) + 'px'); s.setProperty('--sal', INSET.l + 'px');
  root.dataset.w = lw < 540 ? 'xs' : lw < 700 ? 's' : lw < 1000 ? 'm' : 'l';          // drives the compact top bar in css
  if (vv && vv.scale > Math.max(1.08, (prefs.uiScale || 1) * 1.08) && !resetting) resetZoom();   // zoomed IN by accident (pinch); the browser may report scale 1 under a smaller UI scale, which is fine
  window.dispatchEvent(new Event('applayout'));
}
let timers = [];
export function relayoutSoon() { relayout(); for (const t of timers) clearTimeout(t); timers = [120, 400, 1200].map((ms) => setTimeout(relayout, ms)); }

export function initLayout() {
  applyViewportMeta();
  relayout();
  for (const ev of ['resize', 'orientationchange', 'fullscreenchange', 'pageshow', 'focus']) window.addEventListener(ev, relayoutSoon);
  document.addEventListener('fullscreenchange', relayoutSoon);
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', relayout); window.visualViewport.addEventListener('scroll', relayout); }
  relayoutSoon();
}
