// Loading progress while a project opens. Opening no longer blocks the app: the project is on screen as soon as its structure is in place
// (P.deserialize onReady) and its samples, stretch / pitch renders and tempo-map warps load behind it while every button, menu and view
// keeps working. The progress is a small bar under the transport (play) buttons that never takes a tap; it appears only when loading takes
// longer than 250 ms and always goes away, also when loading fails. A project opened while another is still loading takes the bar over.
import * as P from './project.js';

let depth = 0, seq = 0, el = null;
function bar() {
  if (el && el.isConnected) return el;
  el = document.createElement('div'); el.className = 'ldm'; el.setAttribute('role', 'progressbar'); el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', '100');
  el.innerHTML = '<div class="ldm-row"><span class="ldm-l"></span><b class="ldm-p"></b></div><div class="ldm-bar"><i></i></div>';
  (document.getElementById('top-c') || document.body).append(el);
  return el;
}
export const loadingBar = () => (el && el.isConnected ? el : null);   // tests / tutorial

export async function withLoading(title, run, { bakes = true } = {}) {
  const me = ++seq; let shown = false, last = [0, '', 0, 0];
  const paint = () => {
    if (!shown || me !== seq) return;
    const [f, label, done, total] = last, e = bar(), pc = Math.round(Math.max(0, Math.min(1, f)) * 100);
    e.querySelector('.ldm-bar i').style.width = pc + '%';
    e.querySelector('.ldm-l').textContent = label || title;
    e.querySelector('.ldm-p').textContent = (total ? done + '/' + total + ' · ' : '') + pc + '%';
    e.title = title + (label ? ' — ' + label : ''); e.setAttribute('aria-valuenow', String(pc)); e.setAttribute('aria-label', title);
  };
  const timer = setTimeout(() => { shown = true; paint(); }, 250);
  const upd = (f, label, done, total) => { last = [f, label || last[1], done ?? last[2], total ?? last[3]]; paint(); };
  depth++; if (bakes) P.bakeHooks.hold = true;
  try {
    const r = await run(upd);
    if (me === seq) P.bakeHooks.hold = false;
    if (bakes && me === seq && P.bakesPending()) {                 // clips warped onto the tempo map / swing grid: rendered now, not while playing
      upd(0, 'Menyesuaikan klip ke tempo…', 0, P.bakesPending());
      P.bakeHooks.progress = (d, t, name) => upd(t ? d / t : 1, 'Menyesuaikan klip ke tempo: ' + name, d, t);
      await P.ensureBakes();
    }
    return r;
  } finally {
    depth--; if (!depth) { P.bakeHooks.progress = null; P.bakeHooks.hold = false; }
    clearTimeout(timer);
    if (me === seq && el) { el.remove(); el = null; }
  }
}
// P.deserialize with the progress bar. onReady(): the project is on screen and usable (its audio may still be loading); the promise
// resolves with the files that could not be found once everything is loaded.
export const openWithLoading = (text, title = 'Membuka proyek', { onReady } = {}) => withLoading(title, (upd) => P.deserialize(text, upd, onReady));
// the same, resolving as soon as the project is usable: { done } is the promise of the full load (missing files)
export function openInBackground(text, title) {
  return new Promise((res, rej) => {
    let ready = false;
    const done = openWithLoading(text, title, { onReady: () => { ready = true; res({ done }); } });
    done.catch((e) => { if (!ready) rej(e); else console.error('load', e); });
  });
}
