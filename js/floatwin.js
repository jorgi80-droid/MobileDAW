// Floating windows, like the plug-in windows of a desktop DAW: every window can be dragged by its title bar, resized from any edge or
// corner, rolled up to the title bar only (double-tap the title or use the arrow), minimised to a chip in the tray, maximised and closed.
// Several windows can be open at once; the last touched one is on top. Position and size are remembered per window id.
//
// Content comes from a builder: openFloat({ id, title, build(api), fit, ... }).
//   fit: true  -> the content keeps its natural layout and is scaled to the window (instrument and effect cards: shrinking the window shrinks
//                 the whole panel, nothing gets cut off); corner drags keep the aspect ratio
//   fit: false -> the content fills the window and lays itself out (MiniMeters modules: react to the size with a ResizeObserver)
//   build(api) returns an Element or { el, destroy }. api = { every(ms, fn), close(), refresh(), setTitle(t), win }. Return null to close.
// The windows live in #fwlayer inside #app, so they follow the visual viewport exactly like the rest of the app.
import { h } from './ui.js';

const KEY = 'mobiledaw.fw';
const BAR = 30, BAR_SLIM = 22;                               // title bar height (CSS px); frameless windows (MiniMeters) get the slim bar
const wins = new Map();
const listeners = new Set();
let layer = null, tray = null, zTop = 10;
let geo = {};
try { geo = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { geo = {}; }
const saveGeo = () => { try { const k = Object.keys(geo); if (k.length > 80) for (const x of k.slice(0, k.length - 80)) delete geo[x]; localStorage.setItem(KEY, JSON.stringify(geo)); } catch (_) { /* storage unavailable */ } };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const emit = () => { for (const f of [...listeners]) { try { f(); } catch (e) { console.error('floatwin', e); } } };

export const onFloatChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const isOpen = (id) => wins.has(id);
export const openIds = () => [...wins.keys()];

function ensureLayer() {
  if (layer && layer.isConnected) return layer;
  layer = document.getElementById('fwlayer');
  if (!layer) {
    layer = h('div', { id: 'fwlayer' });
    (document.getElementById('app') || document.body).append(layer);
  }
  tray = layer.querySelector('.fw-tray');
  if (!tray) { tray = h('div', { class: 'fw-tray', hidden: true }); layer.append(tray); }
  return layer;
}
const area = () => { ensureLayer(); return { w: layer.clientWidth || window.innerWidth, h: layer.clientHeight || window.innerHeight }; };

function raise(w) {
  for (const o of wins.values()) o.el.classList.toggle('focus', o === w);
  w.el.style.zIndex = String(++zTop);
}

function place(w) {
  const s = w.s, el = w.el.style;
  el.left = Math.round(s.x) + 'px'; el.top = Math.round(s.y) + 'px'; el.width = Math.round(s.w) + 'px';
  el.height = (s.shade ? w.bh : Math.round(s.h)) + 'px';
  w.el.classList.toggle('shade', !!s.shade); w.el.classList.toggle('max', !!s.max);
}

function keepInside(w) {
  const A = area(), s = w.s;
  if (s.max) { s.x = 4; s.y = 4; s.w = A.w - 8; s.h = A.h - 8; return; }
  s.w = clamp(s.w, w.minW, Math.max(w.minW, A.w - 4)); s.h = clamp(s.h, w.minH, Math.max(w.minH, A.h - 4));
  s.x = clamp(s.x, 70 - s.w, A.w - 70); s.y = clamp(s.y, 0, Math.max(0, A.h - w.bh));       // the title bar always stays reachable
}

function applyFit(w) {
  if (!w.fit || !w.fitEl || w.s.shade || w.s.min) return;
  const bw = w.body.clientWidth, bh = w.body.clientHeight, nw = w.fitEl.offsetWidth, nh = w.fitEl.offsetHeight;
  if (!nw || !nh || !bw || !bh) return;
  w.nat = { w: nw, h: nh };
  const sc = clamp(Math.min(bw / nw, bh / nh), 0.3, 1.6);
  w.scale = sc;
  w.fitEl.style.transform = `translate(${Math.max(0, (bw - nw * sc) / 2)}px, 0) scale(${sc})`;
}
function layout(w) { place(w); applyFit(w); if (w.inst && w.inst.onResize && !w.s.shade && !w.s.min) { try { w.inst.onResize(w.body.clientWidth, w.body.clientHeight); } catch (e) { console.error(e); } } }

function remember(w) {
  const s = w.s;
  if (s.max) { geo[w.id] = { ...(geo[w.id] || {}), max: 1 }; saveGeo(); return; }
  geo[w.id] = { x: Math.round(s.x), y: Math.round(s.y), w: Math.round(s.w), h: Math.round(s.h), shade: s.shade ? 1 : 0 };
  saveGeo();
}

function destroyContent(w) {
  for (const t of w.timers) clearInterval(t);
  w.timers = [];
  if (w.ro) { w.ro.disconnect(); w.ro = null; }
  if (w.inst && w.inst.destroy) { try { w.inst.destroy(); } catch (e) { console.error(e); } }
  w.inst = null;
}

function mount(w) {
  destroyContent(w);
  w.host.replaceChildren();
  const api = {
    win: w,
    every(ms, fn) { const t = setInterval(() => { if (w.el.isConnected && !w.s.min && !w.s.shade && !document.hidden) fn(); }, ms); w.timers.push(t); return t; },
    close: () => closeFloat(w.id), refresh: () => mount(w),
    setTitle(t) { w.titleEl.textContent = t; w.chipTitle = t; if (w.chip) w.chip.textContent = t; },
  };
  let out = null;
  try { out = w.opts.build(api); } catch (e) { console.error('floatwin build', e); out = null; }
  if (!out) { closeFloat(w.id); return false; }
  w.inst = out.nodeType ? { el: out } : out;
  w.host.append(w.inst.el);
  if (w.fit && typeof ResizeObserver !== 'undefined') { w.ro = new ResizeObserver(() => applyFit(w)); w.ro.observe(w.fitEl); }
  requestAnimationFrame(() => { if (wins.get(w.id) === w) { applyFit(w); if (w.inst && w.inst.onResize) w.inst.onResize(w.body.clientWidth, w.body.clientHeight); } });
  return true;
}

function setMin(w, on) {
  w.s.min = !!on;
  w.el.hidden = !!on;
  if (on) {
    if (!w.chip) {
      w.chip = h('button', { class: 'fw-chip', 'aria-label': 'Buka ' + w.titleEl.textContent, onclick: () => { setMin(w, false); raise(w); } }, w.titleEl.textContent);
      w.chip.style.setProperty('--c', w.opts.color || 'var(--accent)');
      tray.append(w.chip);
    }
  } else if (w.chip) { w.chip.remove(); w.chip = null; }
  tray.hidden = !tray.children.length;
  if (!on) layout(w);
  emit();
}

function toggleMax(w) {
  if (!w.s.max) { w.prev = { x: w.s.x, y: w.s.y, w: w.s.w, h: w.s.h, shade: w.s.shade }; w.s.max = true; w.s.shade = false; }
  else { w.s.max = false; Object.assign(w.s, w.prev || {}); }
  keepInside(w); layout(w); raise(w);
}
function toggleShade(w) { if (w.s.max) return; w.s.shade = !w.s.shade; layout(w); remember(w); }

function drag(w, e) {
  if (e.button > 0 || w.s.max) return;
  const s0 = { x: w.s.x, y: w.s.y }, px = e.clientX, py = e.clientY; let moved = false; w.moving = false;
  const bar = e.currentTarget; try { bar.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
  const mv = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    const dx = ev.clientX - px, dy = ev.clientY - py;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    moved = true; w.moving = true; w.s.x = s0.x + dx; w.s.y = s0.y + dy; keepInside(w); place(w);
  };
  const up = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up);
    if (moved) { w.dragged = performance.now(); remember(w); }
  };
  bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
}

function resize(w, dir, e) {
  if (w.s.max || w.s.shade) return;
  e.stopPropagation(); e.preventDefault();
  const s0 = { x: w.s.x, y: w.s.y, w: w.s.w, h: w.s.h }, px = e.clientX, py = e.clientY, el = e.currentTarget, A = area();
  const corner = dir.length === 2, keep = w.fit && corner && w.nat ? (w.nat.h + w.bh) / w.nat.w : 0;      // fit windows scale with their content: corners keep the aspect ratio
  try { el.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
  const mv = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    let dx = ev.clientX - px, dy = ev.clientY - py, nw = s0.w, nh = s0.h;
    if (dir.includes('e')) nw = s0.w + dx; if (dir.includes('w')) nw = s0.w - dx;
    if (dir.includes('s')) nh = s0.h + dy; if (dir.includes('n')) nh = s0.h - dy;
    if (keep) { const byW = nw * keep, byH = nh / keep; if (Math.abs(nw - s0.w) / s0.w >= Math.abs(nh - s0.h) / s0.h) nh = byW; else nw = byH; }
    nw = clamp(nw, w.minW, A.w - 4); nh = clamp(nh, w.minH, A.h - 4);
    if (keep) nh = Math.max(w.minH, nw * keep);
    w.s.w = nw; w.s.h = nh;
    w.s.x = dir.includes('w') ? s0.x + (s0.w - nw) : s0.x; w.s.y = dir.includes('n') ? s0.y + (s0.h - nh) : s0.y;
    keepInside(w); layout(w);
  };
  const up = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    remember(w);
  };
  el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

// Window buttons are drawn as SVG (the same on every phone font): roll up, minimise, maximise, close
const ICON = {
  sh: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg>',
  mn: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 11h8"/></svg>',
  mx: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1"/></svg>',
  x: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
};
const btn = (cls, label, key, fn) => { const b = h('button', { class: 'fw-b ' + cls, 'aria-label': label, title: label, onclick: (e) => { e.stopPropagation(); fn(); } }); b.innerHTML = ICON[key]; return b; };

export function openFloat(opts) {
  ensureLayer();
  const ex = wins.get(opts.id);
  if (ex) { if (ex.s.min) setMin(ex, false); raise(ex); return ex; }
  const A = area(), g = geo[opts.id] || null;
  const w = {
    id: opts.id, opts, fit: opts.fit !== false, timers: [], inst: null, ro: null, nat: null, scale: 1, chip: null, prev: null,
    bh: opts.frameless ? BAR_SLIM : BAR, minW: opts.minW || (opts.fit !== false ? 120 : 160), minH: opts.minH || (opts.fit !== false ? BAR + 56 : BAR_SLIM + 70),
    s: { x: 0, y: 0, w: opts.w || 360, h: opts.h || 260, shade: false, min: false, max: false },
  };
  const n = wins.size % 7;
  w.s.x = g && Number.isFinite(g.x) ? g.x : 24 + n * 28; w.s.y = g && Number.isFinite(g.y) ? g.y : 46 + n * 28;
  if (g && Number.isFinite(g.w)) { w.s.w = g.w; w.s.h = g.h; }
  w.s.shade = !!(g && g.shade);
  w.titleEl = h('span', { class: 'fw-title' }, opts.title || '');
  w.chipTitle = opts.title || '';
  w.bar = h('div', { class: 'fw-bar' }, h('i', { class: 'fw-dot', style: opts.color ? `background:${opts.color}` : '' }), w.titleEl,
    btn('fw-sh', 'Gulung / buka jendela', 'sh', () => toggleShade(w)),
    btn('fw-mn', 'Kecilkan ke bar bawah', 'mn', () => setMin(w, true)),
    btn('fw-mx', 'Perbesar / kembalikan', 'mx', () => toggleMax(w)),
    btn('fw-x', 'Tutup jendela', 'x', () => closeFloat(w.id)));
  w.bar.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; raise(w); drag(w, e); });
  let lastTap = 0;
  w.bar.addEventListener('pointerup', (e) => { if (e.target.closest('button')) return; const t = performance.now(); if (w.moving) { w.moving = false; lastTap = 0; return; } if (t - lastTap < 320) { toggleShade(w); lastTap = 0; } else lastTap = t; });
  w.host = h('div', { class: w.fit ? 'fw-fit' : 'fw-fill' });
  w.fitEl = w.fit ? w.host : null;
  w.body = h('div', { class: 'fw-body' }, w.host);
  w.el = h('div', { class: 'fw' + (w.fit ? ' isfit' : '') + (opts.frameless ? ' frameless' : ''), role: 'dialog', 'aria-label': opts.title || 'Jendela' }, w.bar, w.body);
  for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) { const r = h('div', { class: 'fw-rz ' + d }); r.addEventListener('pointerdown', (e) => { raise(w); resize(w, d, e); }); w.el.append(r); }
  w.el.append(h('i', { class: 'fw-grip', 'aria-hidden': 'true' }));
  w.el.addEventListener('pointerdown', () => raise(w), true);
  w.el.style.cssText = 'left:0;top:0;width:10px;height:10px';
  layer.append(w.el);
  wins.set(w.id, w);
  if (!mount(w)) return null;
  // first open without a remembered size: take the natural size of the content (a card at 100 %), as large as the screen allows
  if (!g || !Number.isFinite(g.w)) {
    if (w.fit) {
      w.s.w = 10; w.s.h = 10; place(w); const nw = w.fitEl.offsetWidth, nh = w.fitEl.offsetHeight;
      if (nw && nh) { const sc = Math.min(1, (A.w - 12) / (nw + 2), (A.h - 12) / (nh + w.bh + 2)); w.s.w = Math.round(nw * sc) + 2; w.s.h = Math.round(nh * sc) + w.bh + 2; }
    }
  }
  w.s.w = clamp(w.s.w, w.minW, Math.max(w.minW, A.w - 8)); w.s.h = clamp(w.s.h, w.minH, Math.max(w.minH, A.h - 8));
  if (g && g.max) { w.prev = { x: w.s.x, y: w.s.y, w: w.s.w, h: w.s.h, shade: false }; w.s.max = true; }
  keepInside(w); layout(w); raise(w);
  emit();
  return w;
}

export function closeFloat(id) {
  const w = wins.get(id);
  if (!w) return;
  if (!w.s.max && !w.s.min) remember(w);
  destroyContent(w);
  wins.delete(id);
  if (w.chip) w.chip.remove();
  w.el.remove();
  if (tray) tray.hidden = !tray.children.length;
  try { if (w.opts.onClose) w.opts.onClose(); } catch (e) { console.error(e); }
  emit();
}
export function closeAllFloats() { for (const id of [...wins.keys()]) closeFloat(id); }
export function refreshFloat(id) { const w = wins.get(id); if (w) mount(w); }
// rebuild every window (the project changed: devices added / removed / undo); windows whose content no longer exists close themselves
export function refreshAll() { for (const w of [...wins.values()]) if (wins.get(w.id) === w) mount(w); }
export function titleOf(id) { const w = wins.get(id); return w ? w.titleEl.textContent : ''; }

export function initFloat() {
  ensureLayer();
  window.addEventListener('applayout', () => { for (const w of wins.values()) { keepInside(w); layout(w); } });
  window.addEventListener('resize', () => { for (const w of wins.values()) { keepInside(w); layout(w); } });
  document.addEventListener('keydown', (e) => {                                  // Esc closes the front window (desktop keyboard)
    if (e.key !== 'Escape' || !wins.size || e.target.closest && e.target.closest('input,textarea')) return;
    let top = null; for (const w of wins.values()) if (!w.s.min && (!top || +w.el.style.zIndex > +top.el.style.zIndex)) top = w;
    if (top && top.el.classList.contains('focus')) closeFloat(top.id);
  });
}
