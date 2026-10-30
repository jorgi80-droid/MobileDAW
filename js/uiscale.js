// UI scale that survives fullscreen. The viewport meta tag scales the page in a normal browser tab, but Chrome drops it as soon as the page is
// fullscreen (Fullscreen API, installed fullscreen app, swipe-back re-entering fullscreen): layout falls back to device width and the Skala UI
// slider seems dead. layout.js measures the layout width the meta tag really produced; when it is not the width the slider asks for, the page
// is scaled here with a CSS transform instead (html.emu, factor K) and the few browser APIs that report screen coordinates are shimmed so every
// piece of code keeps working in "layout pixels", exactly as it does under the meta tag:
//   pointer / touch clientX, clientY      -> divided by K
//   getBoundingClientRect()               -> divided by K
//   innerWidth / innerHeight              -> divided by K
//   devicePixelRatio                      -> multiplied by K (canvases stay 1:1 with the physical pixels)
// K === 1 means no emulation: every shim returns the browser's own value untouched.
let K = 1;
export const emuK = () => K;
export const setEmuK = (k) => { K = k > 0 ? k : 1; };

function shimGetter(obj, name, fn) {
  const d = Object.getOwnPropertyDescriptor(obj, name);
  if (!d || !d.get || d.configurable === false) return;
  Object.defineProperty(obj, name, { configurable: true, enumerable: d.enumerable, get() { const v = d.get.call(this); return K === 1 ? v : fn(v); } });
}
let done = false;
export function installScaleShim() {
  if (done || typeof window === 'undefined') return;
  done = true;
  try {
    const down = (v) => v / K, up = (v) => v * K;
    for (const P of [typeof MouseEvent !== 'undefined' && MouseEvent.prototype, typeof PointerEvent !== 'undefined' && PointerEvent.prototype, typeof Touch !== 'undefined' && Touch.prototype]) {
      if (!P) continue;
      for (const n of ['clientX', 'clientY', 'x', 'y']) shimGetter(P, n, down);
    }
    shimGetter(window, 'innerWidth', down); shimGetter(window, 'innerHeight', down);
    shimGetter(window, 'devicePixelRatio', up);
    const gbr = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () { const r = gbr.call(this); return K === 1 ? r : new DOMRect(r.x / K, r.y / K, r.width / K, r.height / K); };
  } catch (_) { /* a browser that forbids the shims keeps the meta-tag scale only */ }
}
