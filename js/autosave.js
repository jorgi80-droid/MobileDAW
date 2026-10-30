// Auto-save: the project is written to the app's own storage every 5 seconds (only when something changed) and again the moment the
// page is hidden or closed, like FL Studio Mobile. On the next start the project is restored exactly as it was.
import { eng } from './engine.js';
import * as P from './project.js';

export const AUTOSAVE_NAME = '_autosave.mdaw';
const dir = () => eng.home() + '/Projects';
export const autosavePath = () => dir() + '/' + AUTOSAVE_NAME;
export const isAutosave = (name) => name === AUTOSAVE_NAME;

let last = '', timer = 0, enabled = false;
export function saveNow() {
  if (!enabled) return false;
  try {
    const txt = P.serialize();
    if (txt === last) return false;
    eng.writeText(autosavePath(), txt);
    last = txt;
    return true;
  } catch (e) { console.error('autosave', e); return false; }
}

// Restore the last session. Returns true if a project was loaded from the auto-save.
export async function restore() {
  try {
    const txt = eng.readText(autosavePath());
    if (typeof txt !== 'string' || txt.length < 20) return false;
    await P.deserialize(txt);
    last = txt;
    return true;
  } catch (e) { console.error('autosave restore', e); return false; }
}

export function startAutosave() {
  enabled = true;
  clearInterval(timer);
  // Serialising a big project is the one heavy thing done outside the frame loop: wait for an idle moment and never while a finger is down
  // (dragging / playing a knob), so autosave can no longer cause a stutter or a dropped audio buffer.
  let down = 0;
  const pd = () => { down += 1; }, pu = () => { down = Math.max(0, down - 1); };
  addEventListener('pointerdown', pd, true); addEventListener('pointerup', pu, true); addEventListener('pointercancel', pu, true);
  const idle = typeof requestIdleCallback === 'function' ? (f) => requestIdleCallback(f, { timeout: 2500 }) : (f) => setTimeout(f, 50);
  const tick = () => { if (!enabled) return; if (down > 0 || document.hidden) return; idle(saveNow); };
  timer = setInterval(tick, 5000);
  const flush = () => { saveNow(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  window.addEventListener('blur', flush);
}
