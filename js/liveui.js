// Ableton Live style controls for device panels: value boxes, toggles, drop-downs, tabs, dark displays.
// Everything is a plain element with .update() so panels can refresh it after a preset / automation changes the value.
import { h, menu, toNorm, fromNorm, clamp } from './ui.js';

// small label above a control (Live puts the name of a control above its box)
export const lvLab = (text, el, cls = '') => h('div', { class: 'lv-fl ' + cls }, h('span', { class: 'lv-lb' }, text), el);

// Value box: drag up / down to change, double tap = reset, long press = automation (onLong).
// p: parameter definition { min, max, def, curve, step } - a plain object is enough for values that are not engine parameters.
export function lvNum(p, get, set, fmt, o = {}) {
  const txt = h('span', { class: 'v' });
  const root = h('div', { class: 'lv-fld' + (o.fill ? ' fill' : '') + (o.cls ? ' ' + o.cls : ''), role: 'slider', tabindex: 0, 'aria-label': o.label || p.n || 'Nilai', style: o.w ? `min-width:${o.w}px;width:${o.w}px` : '' }, txt);
  const draw = () => {
    const v = get();
    txt.textContent = fmt(p, v);
    if (o.fill) root.style.setProperty('--f', String(toNorm(p, v)));
  };
  let st = null;
  root.addEventListener('pointerdown', (e) => {
    root.setPointerCapture(e.pointerId);
    st = { y: e.clientY, x: e.clientX, n: toNorm(p, get()), moved: false, fired: false, t: 0 };
    if (o.onLong) st.t = setTimeout(() => { if (st && !st.moved) { st.fired = true; o.onLong(root.getBoundingClientRect()); } }, 480);
  });
  root.addEventListener('pointermove', (e) => {
    if (!st || st.fired) return;
    const dy = st.y - e.clientY, dx = e.clientX - st.x;
    if (Math.abs(dy) > 3 || Math.abs(dx) > 3) { st.moved = true; clearTimeout(st.t); }
    if (st.moved) {
      const d = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
      set(fromNorm(p, st.n + d / (o.px || 150))); draw();
    }
  });
  const end = () => {
    if (!st) return;
    clearTimeout(st.t);
    if (!st.moved && !st.fired) {
      const now = performance.now();
      if (root._lt && now - root._lt < 320) { set(p.def); root._lt = 0; }
      else if (p.step && p.max - p.min <= 4 && !o.noCycle) { const v = get() + p.step; set(v > p.max ? p.min : v); root._lt = now; }
      else root._lt = now;
      draw();
    }
    st = null;
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', () => { if (st) clearTimeout(st.t); st = null; });
  root.update = draw; draw();
  return root;
}

// Toggle button (orange when on). get() -> boolean / 0|1, set(boolean)
export function lvTog(label, get, set, o = {}) {
  const b = h('button', { class: 'lv-btn' + (o.cls ? ' ' + o.cls : ''), 'aria-pressed': 'false', style: o.w ? `min-width:${o.w}px` : '' }, label);
  const draw = () => { const on = !!get(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); };
  b.addEventListener('click', () => { set(!get()); draw(); });
  b.update = draw; draw();
  return b;
}

// Plain action button
export const lvBtn = (label, fn, o = {}) => h('button', { class: 'lv-btn' + (o.cls ? ' ' + o.cls : ''), style: o.w ? `min-width:${o.w}px` : '', onclick: fn }, label);

// Choice button group: only one is on (e.g. Sustain Mode, Octave 0 / -1 / -2). items: [{ label, title }]
export function lvChoice(items, get, set, o = {}) {
  const row = h('div', { class: 'lv-grp' + (o.cls ? ' ' + o.cls : '') });
  const bs = items.map((it, k) => h('button', { class: 'lv-btn', title: it.title || '', 'aria-label': it.title || it.label, onclick: () => { set(k); draw(); } }, it.label));
  const draw = () => { const c = get(); bs.forEach((b, k) => b.classList.toggle('on', k === c)); };
  row.append(...bs); row.update = draw; draw();
  return row;
}

// Drop-down: shows the current choice and a triangle; tap opens the popup list. items() -> [{ label, check?, value, sep?, dim? }]
export function lvSel(items, get, set, o = {}) {
  const txt = h('span', { class: 'v' }), root = h('button', { class: 'lv-fld sel' + (o.cls ? ' ' + o.cls : ''), style: o.w ? `min-width:${o.w}px;width:${o.w}px` : '' }, txt, h('i', { class: 'tri' }));
  const draw = () => { const cur = get(); const it = items().find((x) => x.value === cur); txt.textContent = o.show ? o.show(cur) : (it ? it.label : ''); };
  root.addEventListener('click', () => {
    const r = root.getBoundingClientRect(), cur = get();
    menu(items().map((it) => (it.sep ? { sep: true } : { label: it.label, dim: it.dim, check: it.value === cur, fn: () => { set(it.value); draw(); if (o.after) o.after(); } })), r.left, r.bottom + 1);
  });
  root.update = draw; draw();
  return root;
}

// Tab bar like the Sampler / Wavetable header: a tab is a box with an optional LED (orange = the section has something active).
export function lvTabs(tabs, cur, onSel, o = {}) {
  const row = h('div', { class: 'lv-tabs' + (o.cls ? ' ' + o.cls : '') });
  const bs = tabs.map((t, k) => {
    const led = t.led ? h('i', { class: 'led' }) : null;
    const chk = t.check ? h('i', { class: 'chk' }) : null;
    const b = h('button', { class: 'lv-tab' + (k === cur ? ' on' : ''), onclick: (e) => { if (e.target.classList && e.target.classList.contains('chk') && t.onCheck) { t.onCheck(); paint(); return; } sel(k); } }, chk, led, t.label);
    return b;
  });
  const paint = () => tabs.forEach((t, k) => { if (t.check) bs[k].classList.toggle('lit', !!t.check()); });
  function sel(k) { cur = k; bs.forEach((b, m) => b.classList.toggle('on', m === k)); onSel(k); }
  row.append(...bs); row.update = paint; paint();
  row.select = sel;
  return row;
}

// Dark display with an orange / blue drawing, sharp at any pixel density. draw(g, w, h) gets a ready 2D context in CSS pixels.
export const DISPC = { bg: '#262628', grid: '#3a3a3e', grid2: '#4a4a4f', ink: '#9a9aa2', or: '#ffad32', orD: '#a8731f', bl: '#4fc3f0', sel: '#3c7e8d', selD: '#2f5b66' };
export function lvDisp(w, hh, draw, o = {}) {
  const c = document.createElement('canvas'), d = Math.min(3, window.devicePixelRatio || 1);
  c.width = Math.round(w * d); c.height = Math.round(hh * d); c.className = 'lv-disp' + (o.cls ? ' ' + o.cls : '');
  c.style.width = w + 'px'; c.style.height = hh + 'px';
  c._w = w; c._h = hh;
  const paint = () => {
    const g = c.getContext('2d');
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = DISPC.bg; g.fillRect(0, 0, w, hh);
    draw(g, w, hh, c);
  };
  c.paint = paint; paint();
  return c;
}
// pointer drag on a display: onDown(x, y, e) may return a state; onMove(x, y, dx, dy, state, e); positions are in CSS px inside the canvas
export function lvDrag(c, o) {
  let st = null, id = null;
  const pos = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c._w / r.width), (e.clientY - r.top) * (c._h / r.height)]; };
  c.addEventListener('pointerdown', (e) => {
    c.setPointerCapture(e.pointerId); id = e.pointerId;
    const [x, y] = pos(e); st = { x0: x, y0: y, s: o.onDown ? o.onDown(x, y, e) : {} };
    if (st.s === false) st = null;
  });
  c.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== id) return;
    const [x, y] = pos(e); o.onMove(x, y, x - st.x0, y - st.y0, st.s, e);
  });
  const up = (e) => { if (st && o.onUp) { const [x, y] = pos(e); o.onUp(x, y, st.s); } st = null; };
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', () => { st = null; });
}

// ---- drawing helpers shared by the displays ------------------------------------------------------
export function lvPath(g, pts, color, fillTo = null, lw = 1.5) {
  g.beginPath(); pts.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = color; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke();
  if (fillTo !== null) { g.lineTo(pts[pts.length - 1][0], fillTo); g.lineTo(pts[0][0], fillTo); g.closePath(); g.fillStyle = color + '30'; g.fill(); }
}
// ADSR picture: x positions proportional to sqrt(time) so a 20 s release and a 1 ms attack are both visible
export function lvEnvPts(w, hh, a, d, s, r, pad = 4) {
  const wa = Math.sqrt(a), wd = Math.sqrt(d), wr = Math.sqrt(r), wh = Math.max(0.25, (wa + wd + wr) * 0.3), k = (w - 2 * pad) / (wa + wd + wh + wr);
  const X = [pad, pad + wa * k, pad + (wa + wd) * k, pad + (wa + wd + wh) * k, pad + (wa + wd + wh + wr) * k];
  const sy = pad + (1 - s) * (hh - 2 * pad), Y = [hh - pad, pad, sy, sy, hh - pad];
  return X.map((x, n) => [x, Y[n]]);
}
export const lvClamp = clamp;
