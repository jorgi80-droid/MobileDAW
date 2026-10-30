// Small UI toolkit: element helper, icons, popup menus, modals, toasts, knobs.
import { C } from './theme.js';
export const $ = (s, r = document) => r.querySelector(s);
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

const P = {
  play: 'M8 5v14l11-7z', pause: 'M7 5h3.5v14H7zm6.5 0H17v14h-3.5z', stop: 'M6 6h12v12H6z', rew: 'M6 6h2v12H6zm3.5 6L18 6v12z',
  loop: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  metro: 'M10 3h4l4.5 18h-13L10 3zm1.3 2.5L8 19h8l-3.3-13.5h-1.4zM12 9l5-5.5-1.2-1L11 8z',
  undo: 'M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.6-3.6A8 8 0 0 1 12.5 10c3.5 0 6.5 2.3 7.6 5.5l2.4-.8C21.1 10.7 17.2 8 12.5 8z',
  redo: 'M11.5 8c2.65 0 5.05 1 6.9 2.6L22 7v9h-9l3.6-3.6A8 8 0 0 0 11.5 10c-3.5 0-6.5 2.3-7.6 5.5l-2.4-.8C2.9 10.7 6.8 8 11.5 8z',
  menu: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  list: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z', plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  close: 'M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z',
  power: 'M11 3h2v9h-2zM7.1 6.1l1.4 1.4a6 6 0 1 0 7 0l1.4-1.4a8 8 0 1 1-9.8 0z',
  rec: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z', expand: 'M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z', collapse: 'M8 4h2v6H4V8h4V4zm6 0h2v4h4v2h-6V4zM4 14h6v6H8v-4H4v-2zm10 0h6v2h-4v4h-2v-6z', left: 'M15 6l-6 6 6 6z', down: 'M6 9l6 6 6-6z', up: 'M6 15l6-6 6 6z', right: 'M9 6l6 6-6 6z',
};
export const icon = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n]}"/></svg>`;
export function setIcon(el, n) { el.innerHTML = icon(n); }

// ---------------------------------------------------------------- floating layers
const layer = () => document.getElementById('layer');
const openers = new Set();
export function closeAll() { const had = openers.size > 0; for (const c of [...openers]) c(); return had; }

function place(el, x, y, w = el.offsetWidth, hh = el.offsetHeight) {
  const W = window.innerWidth, H = window.innerHeight;
  el.style.left = clamp(x, 6, Math.max(6, W - w - 6)) + 'px';
  el.style.top = clamp(y, 6, Math.max(6, H - hh - 6)) + 'px';
}

// A popup that appears on pointerup sits under the finger when the browser then sends the tap's "click": that ghost click
// used to press whichever button opened under the finger (e.g. "Del" right after tapping a note). Clicks in the first
// 350 ms after a popup opens are ignored.
const born = new WeakMap();
const armed = (node) => performance.now() - (born.get(node) || 0) > 350;

// Exit animation: the node plays its .closing animation (quick, accelerating) and is removed afterwards; instant when motion is reduced or scaled to 0.
function leave(...els) {
  const root = document.documentElement, sc = parseFloat(getComputedStyle(root).getPropertyValue('--anim'));
  if (root.classList.contains('reduce-motion') || !(sc > 0) || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) { for (const e of els) e.remove(); return; }
  for (const e of els) e.classList.add('closing');
  setTimeout(() => { for (const e of els) e.remove(); }, Math.round(150 * sc) + 30);
}
function floating(node, x, y) {
  born.set(node, performance.now());
  const scrim = h('div', { class: 'scrim' });
  let shut = false;
  const close = () => { if (shut) return; shut = true; leave(scrim, node); openers.delete(close); };
  scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });
  layer().append(scrim, node);
  openers.add(close);
  place(node, x, y);
  return close;
}

export function menu(items, x, y) {
  const node = h('div', { class: 'menu' });
  let close;
  for (const it of items) {
    if (it.sep) { node.append(h('div', { class: 'mi sep' })); continue; }
    const head = it.dim && !it.fn && /[A-Z]/.test(it.label) && it.label === String(it.label).toUpperCase();   // an all-caps dim entry without an action is a section title
    const sub = !head && /\u2026$/.test(it.label);                                                              // "…" = opens a list or a dialog (Live: a small arrow)
    node.append(h('div', {
      class: 'mi' + (it.check ? ' ck' : '') + (head ? ' hd' : it.dim ? ' dim' : '') + (sub ? ' sub' : ''),
      onclick: () => { if (!armed(node)) return; close(); if (it.fn) it.fn(); },
    }, it.label));
  }
  close = floating(node, x, y);
  return close;
}

// Horizontal action bar (clip / note controls).
export function bar(items, x, y) {
  const node = h('div', { class: 'bar' });
  let close;
  for (const it of items) node.append(h('button', { class: 'b', onclick: () => { if (!armed(node)) return; if (it.keep !== true) close(); it.fn(); } }, it.label));
  close = floating(node, x, y);
  return close;
}

export function modal(title, body, actions) {
  const scrim = h('div', { class: 'scrim', style: 'background:var(--scrim)' });
  const acts = h('div', { class: 'acts' });
  const node = h('div', { class: 'modal', role: 'dialog' }, h('h3', {}, title), body, acts);
  let shut = false;
  const close = () => { if (shut) return; shut = true; leave(scrim, node); openers.delete(close); };
  for (const a of actions) acts.append(h('button', { class: 'b' + (a.go ? ' go' : ''), onclick: () => { if (a.fn && a.fn() === false) return; close(); } }, a.label));
  scrim.addEventListener('pointerdown', close);
  layer().append(scrim, node);
  openers.add(close);
  return close;
}

export function ask(title, value, cb, type = 'text') {
  const input = h('input', { type, value: String(value), inputmode: type === 'number' ? 'decimal' : 'text' });
  modal(title, input, [
    { label: 'Batal' },
    { label: 'OK', go: true, fn: () => { cb(type === 'number' ? parseFloat(input.value) : input.value); } },
  ]);
  setTimeout(() => { input.focus(); input.select(); }, 30);
}

let toastEl = null, toastTimer = 0;
export function toast(msg, ms = 1900) {
  toastEl?.remove();
  toastEl = h('div', { class: 'toast', role: 'status' }, msg);
  layer().append(toastEl);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl?.remove(), ms);
}

// ---------------------------------------------------------------- parameter helpers + knob
export const toNorm = (p, v) => clamp(p.curve === 'log' ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min), 0, 1);
export function fromNorm(p, x) {
  x = clamp(x, 0, 1);
  let v = p.curve === 'log' ? p.min * Math.pow(p.max / p.min, x) : p.min + x * (p.max - p.min);
  if (p.step) v = Math.round(v / p.step) * p.step;
  return clamp(v, p.min, p.max);
}

const A0 = 135, A1 = 405;   // degrees, clockwise from 12 o'clock offset
function arc(cx, cy, r, a, b) {
  const pt = (d) => [cx + r * Math.sin((d * Math.PI) / 180), cy - r * Math.cos((d * Math.PI) / 180)];
  const [x0, y0] = pt(a), [x1, y1] = pt(b);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// get/set are closures so the same widget serves instruments, devices and the mixer.
export function knob(p, get, set, fmt, color = null, onLong = null) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  const mk = (tag, st) => { const el = document.createElementNS(NS, tag); Object.assign(el.style, st); return el; };
  const track = mk('path', { fill: 'none', stroke: 'var(--lv-trk)', strokeWidth: '3.2', strokeLinecap: 'butt' });
  const val = mk('path', { fill: 'none', stroke: 'var(--lv-arc)', strokeWidth: '3.2', strokeLinecap: 'butt' });
  const disc = mk('circle', { fill: 'none', stroke: 'none' });   // v70: Live's dial has no knob body - only the arc ring and a needle from the centre
  disc.setAttribute('cx', 20); disc.setAttribute('cy', 20); disc.setAttribute('r', 12.2);
  const ptr = mk('line', { stroke: 'var(--lv-ink)', strokeWidth: '2.2', strokeLinecap: 'round' });
  svg.append(track, val, disc, ptr);
  track.setAttribute('d', arc(20, 20, 15.5, A0, A1));
  const vEl = h('div', { class: 'k-v' }), nEl = h('div', { class: 'k-n' + (String(p.n).length > 9 ? ' long' : ''), title: p.n }, p.n);
  const root = h('div', { class: 'knob' }, nEl, svg, vEl);
  const draw = () => {
    const v = get(), n = toNorm(p, v);
    const bipolar = p.min < 0 && p.max > 0 && !p.curve;
    const a = A0 + n * (A1 - A0), z = A0 + toNorm(p, 0) * (A1 - A0);
    val.setAttribute('d', bipolar ? (Math.abs(a - z) > 0.6 ? arc(20, 20, 15.5, Math.min(a, z), Math.max(a, z)) : '') : (n > 0.002 ? arc(20, 20, 15.5, A0, a) : ''));
    const rad = (a * Math.PI) / 180, sn = Math.sin(rad), cs = -Math.cos(rad);
    ptr.setAttribute('x1', (20 + 0 * sn).toFixed(2)); ptr.setAttribute('y1', (20 + 0 * cs).toFixed(2));
    ptr.setAttribute('x2', (20 + 15.5 * sn).toFixed(2)); ptr.setAttribute('y2', (20 + 15.5 * cs).toFixed(2));
    vEl.textContent = fmt(p, v);
  };
  let start = null;
  root.addEventListener('pointerdown', (e) => {
    root.setPointerCapture(e.pointerId);
    start = { y: e.clientY, n: toNorm(p, get()), moved: false, fired: false, timer: 0 };
    // long press = offer automation for this parameter
    if (onLong) start.timer = setTimeout(() => { if (start && !start.moved) { start.fired = true; onLong(root.getBoundingClientRect()); } }, 480);
  });
  root.addEventListener('pointermove', (e) => {
    if (!start || start.fired) return;
    const dy = start.y - e.clientY;
    if (Math.abs(dy) > 3) { start.moved = true; clearTimeout(start.timer); }
    if (start.moved) { set(fromNorm(p, start.n + dy / 160)); draw(); }
  });
  const end = () => {
    if (!start) return;
    clearTimeout(start.timer);
    if (!start.moved && !start.fired) {
      const now = performance.now();
      if (p.step && p.max - p.min <= 4) { const v = get() + p.step; set(v > p.max ? p.min : v); }
      else if (root._lt && now - root._lt < 320) set(p.def);      // double tap = reset
      root._lt = now;
      draw();
    }
    start = null;
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', () => { if (start) clearTimeout(start.timer); start = null; });
  root.update = draw;
  draw();
  return root;
}

// Live-style horizontal slider: a flat dark box, the value filled in accent from the left, label left and value right
// inside the box (the text flips to dark ink where the fill passes under it), a thin tick at the "home" value.
// Drag = relative (no jump on touch), double tap = back to `home`, arrow keys = fine steps.
//   o: { label, min, max, home, step, value, fmt(v), width, speed (drag gearing, 0.5 = twice as fine), onStart(), onInput(v) }  ->  element with .set(v) / .get()
export function slider(o) {
  const min = o.min, max = o.max, home = o.home ?? min, step = o.step || (max - min) / 200;
  let val = clamp(o.value ?? home, min, max);
  const txt = () => [h('span', { class: 'ls-l' }, o.label || ''), h('span', { class: 'ls-v' })];
  const base = h('div', { class: 'ls-t' }, txt()), top = h('div', { class: 'ls-t ls-top' }, txt());
  const tick = h('i', { class: 'ls-tick' });
  const root = h('div', { class: 'lslider', role: 'slider', tabindex: 0, 'aria-label': o.label || 'Slider', 'aria-valuemin': min, 'aria-valuemax': max, style: o.width ? `width:${o.width}px` : '' }, base, top, tick);
  const norm = (v) => clamp((v - min) / (max - min), 0, 1);
  const paint = () => {
    const p = norm(val) * 100, f = o.fmt ? o.fmt(val) : String(val);
    for (const t of [base, top]) t.querySelector('.ls-v').textContent = f;
    top.style.clipPath = `inset(0 ${(100 - p).toFixed(2)}% 0 0)`;
    tick.style.left = norm(home) * 100 + '%';
    root.setAttribute('aria-valuenow', val); root.setAttribute('aria-valuetext', f);
  };
  const set = (v, fire) => { v = clamp(Math.round(v / step) * step, min, max); if (Math.abs(v) < step / 2 && min < 0) v = 0; if (v === val) return; val = v; paint(); if (fire && o.onInput) o.onInput(val); };
  let d = null, lastTap = 0;
  root.addEventListener('pointerdown', (e) => {
    root.setPointerCapture(e.pointerId);
    const now = performance.now();
    if (now - lastTap < 320) { lastTap = 0; if (o.onStart) o.onStart(); set(home, true); d = null; return; }   // double tap = home
    lastTap = now; d = { x: e.clientX, v: val, started: false }; root.classList.add('act');
  });
  root.addEventListener('pointermove', (e) => {
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.started) { if (Math.abs(dx) < 2) return; d.started = true; if (o.onStart) o.onStart(); }
    const w = root.getBoundingClientRect().width || 1, fine = e.pointerType === 'mouse' && e.shiftKey ? 0.1 : 1;
    set(d.v + dx / w * (max - min) * fine * (o.speed || 1), true);
  });
  const end = () => { d = null; root.classList.remove('act'); };
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
  root.addEventListener('keydown', (e) => {
    const k = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!k) return; e.preventDefault(); if (o.onStart) o.onStart(); set(val + k * step * (e.shiftKey ? 10 : 1), true);
  });
  root.set = (v) => { val = clamp(v, min, max); paint(); };
  root.get = () => val;
  paint();
  return root;
}
