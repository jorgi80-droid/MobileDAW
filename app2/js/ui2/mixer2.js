// MobileDAW 2's mixer, its only mixer view: one strip per track, then the master, each with its name in the track colour, a tall fader with
// a round thumb, its level meter, a pan ring, Mute / Solo / Rekam, and the track's kind at the bottom (tap = select, the strip lights up).
import { h, clamp, menu, modal, knob } from '../ui.js';
import * as P from '../project.js';
import { MASTER, RET0 } from '../engine.js';
import { checkpoint } from '../history.js';
import { gestureTiming } from '../gesture.js';
const { state } = P;
const VMAX = 1.4, meterFrac = (lv) => clamp((20 * Math.log10(Math.max(lv, 1e-4)) + 60) / 66, 0, 1);
let root = null, list = null, strips = [], sig = '';

const ICON = {
  midi: '<path d="M4 5h16v14H4zM8 5v14M12 5v14M16 5v14"/><path d="M6.6 5v7.5M10.6 5v7.5M14.6 5v7.5M18.2 5v7.5" stroke-width="2.4"/>',
  drum: '<path d="M4 5h4v4H4zM10 5h4v4h-4zM16 5h4v4h-4zM4 11h4v4H4zM10 11h4v4h-4zM16 11h4v4h-4zM4 17h4v2H4zM10 17h4v2h-4zM16 17h4v2h-4z"/>',
  audio: '<path d="M3 12h2M6.5 8v8M9.5 5v14M12.5 9v6M15.5 6.5v11M18.5 10v4"/>',
  bus: '<path d="M5 19V10M9.5 19V5M14 19v-7M18.5 19V8"/>',
};
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
// the tracks, then the Master (the return channels A / B live in "Mixer lengkap", not here)
const order = () => { const o = []; state.tracks.forEach((t, i) => { if (t.kind !== 'auto') o.push(i); }); o.push(MASTER); return o; };
const colorOf = (i) => (i === MASTER ? (state.master.color || '#c9c9cf') : i >= RET0 ? (state.returns[i - RET0].color || '#a89be0') : state.tracks[i].color);
const nameOf = (i) => (i === MASTER ? 'Master' : P.tr(i).name);
const dbTxt = (v) => (v > 1e-4 ? (20 * Math.log10(v)).toFixed(1) : '-∞');

// a control dragged along one axis (relative), double tap = its default
function drag(el, axis, get, set, reset, span) {
  let d = null, last = 0;
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); el.setPointerCapture(e.pointerId);
    const now = performance.now(); if (now - last < gestureTiming().dtapMs) { checkpoint(); reset(); last = 0; return; } last = now;
    d = { p: axis === 'y' ? e.clientY : e.clientX, u: get(), moved: false };
  });
  el.addEventListener('pointermove', (e) => {
    if (!d) return; const q = axis === 'y' ? d.p - e.clientY : e.clientX - d.p, sp = span(); if (!d.moved && Math.abs(q) < 3) return;
    if (!d.moved) { d.moved = true; checkpoint(); } set(clamp(d.u + q / sp, 0, 1));
  });
  const end = () => { d = null; }; el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}

function strip(i) {
  const isT = i < MASTER, t = P.tr(i), kind = isT ? t.kind : 'bus';
  const name = h('button', { class: 'm2-name' }), ic = h('i', { class: 'm2-ic' }); ic.innerHTML = svg(ICON[kind] || ICON.midi);
  // fader with its dB scale and the stereo meter beside it
  const scale = h('div', { class: 'm2-scale', 'aria-hidden': 'true' }, ...[6, 0, -6, -12, -24, -48].map((db) => h('span', { style: `--u:${Math.sqrt(clamp(Math.pow(10, db / 20) / VMAX, 0, 1)).toFixed(4)}` }, db > 0 ? '+' + db : String(db))));
  const fad = h('div', { class: 'm2-fad', 'aria-label': 'Volume' }, h('i', { class: 'trk' }), h('i', { class: 'fill' }), h('em'));
  // the gain meter: two channel slots always visible, the level, a falling peak line and a clip light
  const met = h('div', { class: 'm2-met' }, h('span', { class: 'ch' }, h('i'), h('b')), h('span', { class: 'ch' }, h('i'), h('b')), h('em', { class: 'clip' })), db = h('div', { class: 'm2-db' });
  // pan: a small horizontal slider, centre = C
  const pan = h('div', { class: 'm2-pan2', 'aria-label': 'Pan' }, h('i', { class: 'mid' }), h('i', { class: 'val' }), h('em')), pv = h('span', { class: 'm2-pv' });
  const on = h('button', { class: 'm2-b m2-m', 'aria-label': 'Mute' }, 'M'), solo = h('button', { class: 'm2-b m2-s', 'aria-label': 'Solo' }, 'S'), rec = h('button', { class: 'm2-b m2-r', 'aria-label': 'Rekam' }, h('i'));
  const el = h('div', { class: 'm2-strip' + (isT ? '' : ' bus') },
    h('div', { class: 'm2-head' }, ic, name),
    h('div', { class: 'm2-mid' }, scale, fad, met), db,
    h('div', { class: 'm2-panrow' }, pan, pv),
    h('div', { class: 'm2-row' }, ...(isT ? [on, solo, rec] : [h('span', { class: 'm2-out' }, i === MASTER ? 'Output' : 'Return')])));
  el.style.setProperty('--tc', colorOf(i));
  drag(fad, 'y', () => Math.sqrt(clamp(P.tr(i).vol / VMAX, 0, 1)), (u) => { P.setVol(i, u * u * VMAX); paint(s); }, () => { P.setVol(i, 1); paint(s); }, () => Math.max(60, fad.clientHeight - 20));
  drag(pan, 'x', () => (clamp(P.tr(i).pan || 0, -1, 1) + 1) / 2, (u) => { P.setPan(i, Math.round((u * 2 - 1) * 100) / 100); paint(s); }, () => { P.setPan(i, 0); paint(s); }, () => Math.max(50, pan.clientWidth));
  on.onclick = () => { P.toggleMute(i); paint(s); };
  solo.onclick = () => { P.toggleSolo(i); paint(s); };
  rec.onclick = () => { P.toggleArm(i); paint(s); };
  name.onclick = () => { P.selectTrack(i); if (isT) routeMenu(i, name.getBoundingClientRect()); };
  const s = { i, el, name, fad, met, db, pan, pv, on, solo, rec, kindB: ic, lv: [0, 0] };
  paint(s); return s;
}
function paint(s) {
  const t = P.tr(s.i); if (!t) return;
  if (s.name.textContent !== nameOf(s.i)) s.name.textContent = nameOf(s.i);
  const u = Math.sqrt(clamp(t.vol / VMAX, 0, 1)); s.fad.style.setProperty('--u', u.toFixed(4)); s.db.textContent = dbTxt(t.vol);
  const pn = clamp(t.pan || 0, -1, 1); s.pan.style.setProperty('--p', ((pn + 1) / 2).toFixed(4)); const pr = Math.round(pn * 50); s.pv.textContent = pr === 0 ? 'C' : Math.abs(pr) + (pr < 0 ? 'L' : 'R');
  s.on.classList.toggle('on', !!t.mute); s.solo.classList.toggle('on', !!t.solo);
  if (s.i < MASTER) { const can = ['audio', 'midi', 'drum'].includes(t.kind); s.rec.classList.toggle('on', !!t.arm); s.rec.disabled = !can; }
  s.el.classList.toggle('sel', state.sel.track === s.i); s.el.classList.toggle('muted', !!t.mute);
}

export function build() {
  if (!root) return;
  strips = order().map(strip); list.replaceChildren(...strips.map((s) => s.el));
  sig = order().join(',');
}
export function update() { if (!root) return; if (order().join(',') !== sig) build(); for (const s of strips) { s.el.style.setProperty('--tc', colorOf(s.i)); paint(s); } }
export function frame() {
  if (!root || root.hidden) return;
  const now = performance.now();
  for (const s of strips) {
    s.pk = s.pk || [0, 0]; s.clip = s.clip || 0;
    for (let ch = 0; ch < 2; ch++) {   // instant attack, a gentle release; the peak holds, then falls
      const lv = (state.meters[s.i * 2 + ch] || 0) / 1000, f = meterFrac(lv); s.lv[ch] = f > s.lv[ch] ? f : Math.max(f, s.lv[ch] - 0.02);
      s.pk[ch] = f >= s.pk[ch] ? f : Math.max(f, s.pk[ch] - 0.004);
      if (lv >= 1) s.clip = now;
      const slot = s.met.children[ch], bar = slot.firstChild, pk = slot.lastChild, hgt = (s.lv[ch] * 100).toFixed(1) + '%', pkb = (s.pk[ch] * 100).toFixed(1) + '%';
      if (bar.style.height !== hgt) bar.style.height = hgt; if (pk.style.bottom !== pkb) pk.style.bottom = pkb; pk.style.opacity = s.pk[ch] > 0.02 ? '1' : '0';
    }
    s.met.lastChild.classList.toggle('on', now - s.clip < 1500);
  }
}
export function show(on) { if (root) { root.hidden = !on; if (on) update(); } }
export const visible = () => !!root && !root.hidden;
export function initMixer2(host) {
  list = h('div', { class: 'm2-list' });
  root = h('section', { id: 'mix2', hidden: true }, list);
  host.append(root);
  P.onChange((w) => { if (w === 'tracks' || w === 'all') build(); else if (w === 'mix' || w === 'sel') update(); });
  build();
}
