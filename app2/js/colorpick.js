// Colour picker in the style of FL Studio Mobile's "Channel Color" (a hue slider with a live preview), drawn with Live-style flat panels.
// Colours are stored as '#rrggbb' exactly like before, so saved projects keep working.
import { h, modal } from './ui.js';

const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
export function hslToHex(hh, s, l) {
  hh = ((hh % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n) => (n + hh / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + hex2(f(0) * 255) + hex2(f(8) * 255) + hex2(f(4) * 255);
}
export function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return { h: 30, s: 100, l: 62 };
  const n = parseInt(m[1], 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  let hh = 0;
  if (d) hh = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round(hh * 60) % 360, s: d ? Math.round(d / (1 - Math.abs(2 * l - 1)) * 100) : 100, l: Math.round(l * 100) };
}
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
// readable text on top of a colour
const ink = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16 & 255) * 299 + (n >> 8 & 255) * 587 + (n & 255) * 114) / 1000 > 140 ? '#1b1b1c' : '#fff'; };

// pickColor({ title, name, color, swatches, onChange(hex), onDone(hex) })  -  onChange fires while sliding (live preview)
export function pickColor(o) {
  const start = hexToHsl(o.color);
  const cur = { h: start.h, s: clampN(start.s, 60, 100), l: clampN(start.l, 45, 80) };
  const orig = o.color;
  const preview = h('div', { class: 'cp-prev' }, o.name || 'Warna');
  const hueSl = h('input', { type: 'range', class: 'cp-sl cp-hue', min: 0, max: 359, step: 1, value: cur.h, 'aria-label': 'Warna (hue)' });
  const litSl = h('input', { type: 'range', class: 'cp-sl cp-lit', min: 45, max: 80, step: 1, value: cur.l, 'aria-label': 'Terang' });
  const sw = h('div', { class: 'cp-sw' });
  let raf = 0, last = '';
  const hex = () => hslToHex(cur.h, cur.s, cur.l);
  const paint = () => {
    const c = hex();
    preview.style.background = c; preview.style.color = ink(c);
    // both tracks show the REAL colours that the slider will give, so what you see is what you get
    const stops = []; for (let d = 0; d <= 360; d += 30) stops.push(hslToHex(d, cur.s, cur.l));
    hueSl.style.background = `linear-gradient(to right, ${stops.join(',')})`;
    litSl.style.background = `linear-gradient(to right, ${hslToHex(cur.h, cur.s, 45)}, ${hslToHex(cur.h, cur.s, 62)}, ${hslToHex(cur.h, cur.s, 80)})`;
    for (const b of sw.children) b.classList.toggle('on', b.dataset.c === c);
    if (c !== last) { last = c; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { try { o.onChange && o.onChange(c); } catch (e) { console.error(e); } }); }
  };
  hueSl.addEventListener('input', () => { cur.h = +hueSl.value; paint(); });
  litSl.addEventListener('input', () => { cur.l = +litSl.value; paint(); });
  for (const c of o.swatches || []) {
    const b = h('button', { class: 'cp-s', 'aria-label': 'Warna', 'data-c': c, style: 'background:' + c, onclick: () => { const v = hexToHsl(c); cur.h = v.h; cur.s = clampN(v.s, 60, 100); cur.l = clampN(v.l, 45, 80); hueSl.value = cur.h; litSl.value = cur.l; paint(); } });
    sw.append(b);
  }
  const body = h('div', { class: 'cp' }, preview, h('div', { class: 'cp-lb' }, 'Warna'), hueSl, h('div', { class: 'cp-lb' }, 'Terang'), litSl, sw);
  const close = modal(o.title || 'Warna', body, [
    { label: 'Batal', fn: () => { cancelAnimationFrame(raf); if (o.onChange && orig) o.onChange(orig); } },
    { label: 'OK', go: true, fn: () => { cancelAnimationFrame(raf); const c = hex(); if (o.onChange) o.onChange(c); if (o.onDone) o.onDone(c); } },
  ]);
  const node = document.querySelector('#layer .modal:last-of-type'); if (node) { node.classList.add('cpm'); if (node.previousElementSibling) node.previousElementSibling.style.background = 'transparent'; }   // the arrangement stays visible behind the picker
  paint();
  return close;
}
