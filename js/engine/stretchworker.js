// Runs the offline audio operations (reverse / pitch / WSOLA time-stretch) off the main thread so the UI never freezes while rendering.
import { processBuffers } from './audioops.js';
self.onmessage = (e) => {
  const { id, l, r, mono, opts } = e.data;
  try {
    const o = processBuffers(l, mono ? l : r, opts), tr = [o.l.buffer];
    const out = { id, l: o.l, mono: o.mono };
    if (!o.mono) { out.r = o.r; if (o.r.buffer !== o.l.buffer) tr.push(o.r.buffer); }
    self.postMessage(out, tr);
  } catch (err) { self.postMessage({ id, error: String((err && err.message) || err) }); }
};
