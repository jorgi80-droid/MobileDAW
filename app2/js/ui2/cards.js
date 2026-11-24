// MobileDAW 2's module cards: one Material You card for every effect and instrument, built from the module's parameter list.
//   header   on / off switch (effects), the name (tap = swap the module), Preset (instruments), ⋯ (full editor, move, reset, delete)
//   tabs     the module's sections: FL Studio Mobile's own section layout for the FLM effects (flmlayout.js), the name prefixes of the
//            parameters for the instruments (Osc 1, Flt, LFO, ...), "Keluaran" (Mix / Gain) last
//   controls a round dial for a continuous value (drag up / down, double tap = default, long press = automation lane), a switch for
//            on / off, segmented buttons for a short list, a drop-down field for a long one; an envelope drawing above A / D / S / R
// The classic full editor (with its graphs and sample zones) stays one tap away in a floating window: nothing is lost.
import { h, clamp, menu, toNorm, fromNorm, toast } from '../ui.js';
import * as P from '../project.js';
import { INSTRUMENTS, DEVICES, fmtParam, NO_WET_FX, WET_PARAMS, MIX_P, FX_GROUPS } from '../defs.js';
import { FLM_LAYOUT } from '../flmlayout.js';
import { offerAutomation } from '../automate.js';
import { gestureTiming } from '../gesture.js';
import { fxDisplay } from './fxdisp.js';
import { realScreen } from './realdisp.js';
import { kitView, instKitView } from '../fxkit.js';

const NS = 'http://www.w3.org/2000/svg';
const tabMem = new Map();                        // the open tab per card (device id / instrument track id), kept across re-renders
const A0 = -135, A1 = 135;
const pt = (r, a) => { const q = (a - 90) * Math.PI / 180; return [24 + r * Math.cos(q), 24 + r * Math.sin(q)]; };
const arc = (r, a, b) => { if (b - a < 0.5) return ''; const [x0, y0] = pt(r, a), [x1, y1] = pt(r, b); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
const svgEl = (tag, at) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); return e; };
const isList = (p) => Array.isArray(p.items) && p.items.length > 1;
const isSwitch = (p) => p.fmt === 'onoff' || (p.min === 0 && p.max === 1 && p.step === 1 && !isList(p));

// the knob's shading, defined once for every knob (a lit top, a darker bottom)
function ensureKnobDefs() {
  if (document.getElementById('u2kdefs')) return;
  const sv = svgEl('svg', { id: 'u2kdefs', width: 0, height: 0, style: 'position:absolute;width:0;height:0', 'aria-hidden': 'true' }), defs = svgEl('defs', {});
  const lg = (id, stops) => { const g = svgEl('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }); for (const [o, c] of stops) g.append(svgEl('stop', { offset: o, 'stop-color': c })); defs.append(g); };
  lg('u2kcap', [[0, '#55565c'], [0.5, '#3a3b40'], [1, '#232428']]);
  lg('u2kface', [[0, '#2f3035'], [1, '#3b3c42']]);
  sv.append(defs); document.body.append(sv);
}

// ---- controls (each returns an element with .sync() that re-reads the value)
function dial(p, label, get, set, onLong) {
  // a physical knob: a thin scale ring (value in the family colour, muted), a shaded cap with a soft shadow, a light pointer line
  ensureKnobDefs();
  const s = svgEl('svg', { viewBox: '0 0 48 48', 'aria-hidden': 'true' });
  const trk = svgEl('path', { class: 'trk', d: arc(20.5, A0, A1) }), val = svgEl('path', { class: 'val' }), dot = svgEl('line', { class: 'dot' });
  s.append(trk, val, svgEl('circle', { class: 'shadow', cx: 24, cy: 25.5, r: 14.5 }), svgEl('circle', { class: 'cap', cx: 24, cy: 24, r: 14.5, fill: 'url(#u2kcap)' }),
    svgEl('circle', { class: 'rim', cx: 24, cy: 24, r: 14 }), svgEl('circle', { class: 'face', cx: 24, cy: 24, r: 10.5, fill: 'url(#u2kface)' }), dot);
  const v = h('span', { class: 'v' }), el = h('div', { class: 'u2d', role: 'slider', 'aria-label': label, tabindex: 0 }, h('span', { class: 'n', title: p.n }, label), s, v);
  const bip = p.min < 0 && p.max > 0 && p.curve !== 'log';
  let shown = null, tw = 0;
  const drawAt = (n, x) => {
    const a = A0 + n * (A1 - A0), z = bip ? A0 + toNorm(p, 0) * (A1 - A0) : A0;
    val.setAttribute('d', arc(20.5, Math.min(a, z), Math.max(a, z)));
    const [x0, y0] = pt(5, a), [x1, y1] = pt(12.5, a); dot.setAttribute('x1', x0.toFixed(2)); dot.setAttribute('y1', y0.toFixed(2)); dot.setAttribute('x2', x1.toFixed(2)); dot.setAttribute('y2', y1.toFixed(2));
    const t = fmtParam(p, x); if (v.textContent !== t) { v.textContent = t; el.setAttribute('aria-valuetext', t); }
  };
  const paint = () => { cancelAnimationFrame(tw); tw = 0; const x = get(); shown = toNorm(p, x); drawAt(shown, x); };
  // a change from outside (undo, automation, preset) glides there in 180 ms; a drag shows it at once
  const glide = () => {
    const x = get(), n = toNorm(p, x);
    if (shown === null || Math.abs(n - shown) < 0.003 || document.documentElement.classList.contains('reduce-motion')) { if (shown === null || Math.abs(n - shown) >= 0.0005) paint(); return; }
    if (tw) return;
    const from = shown, t0 = performance.now();
    const f = (now) => { const q = Math.min(1, (now - t0) / 180), e = 1 - Math.pow(1 - q, 3); shown = from + (toNorm(p, get()) - from) * e; drawAt(shown, get()); tw = q < 1 ? requestAnimationFrame(f) : 0; };
    tw = requestAnimationFrame(f);
  };
  let d = null, last = 0;
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); el.setPointerCapture(e.pointerId);
    d = { y: e.clientY, n: toNorm(p, get()), moved: false, fired: false, t: 0 };
    if (onLong) d.t = setTimeout(() => { if (d && !d.moved) { d.fired = true; onLong(el.getBoundingClientRect()); } }, gestureTiming().longMs);
  });
  el.addEventListener('pointermove', (e) => {
    if (!d || d.fired) return; const dy = d.y - e.clientY;
    if (!d.moved && Math.abs(dy) < 3) return;
    if (!d.moved) { d.moved = true; clearTimeout(d.t); el.classList.add('act'); }
    set(fromNorm(p, clamp(d.n + dy / 180, 0, 1))); paint();
  });
  const end = () => {
    if (!d) return; clearTimeout(d.t); el.classList.remove('act');
    if (!d.moved && !d.fired) { const now = performance.now(); if (now - last < gestureTiming().dtapMs) { set(p.def); paint(); last = 0; } else last = now; }
    d = null;
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => {
    const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key]; if (!k) return; e.preventDefault();
    set(fromNorm(p, clamp(toNorm(p, get()) + k * (p.step ? p.step / (p.max - p.min) : 0.01), 0, 1))); paint();
  });
  el.sync = () => { if (!d) glide(); };
  paint(); return el;
}
function toggle(p, label, get, set) {
  const sw = h('i', { class: 'u2sw' }), el = h('button', { class: 'u2t', role: 'switch' }, h('span', { title: label }, label), sw);
  const paint = () => { const on = get() >= (p.min + p.max) / 2; el.classList.toggle('on', on); el.setAttribute('aria-checked', String(on)); };
  el.onclick = (e) => { e.stopPropagation(); set(get() >= (p.min + p.max) / 2 ? p.min : p.max); paint(); };
  el.sync = paint; paint(); return el;
}
function choice(p, label, get, set) {
  const items = p.items, val = (k) => p.min + k * (p.step || 1), idx = () => clamp(Math.round((get() - p.min) / (p.step || 1)), 0, items.length - 1);
  if (items.length <= 4 && items.every((x) => String(x).length <= 9)) {
    const bs = items.map((x, k) => h('button', { onclick: (e) => { e.stopPropagation(); set(val(k)); paint(); } }, String(x)));
    const el = h('div', { class: 'u2seg-f' }, h('span', { class: 'n' }, label), h('div', { class: 'u2seg' }, ...bs));
    const paint = () => { const k = idx(); bs.forEach((b, j) => b.classList.toggle('on', j === k)); };
    el.sync = paint; paint(); return el;
  }
  const v = h('b'), el = h('button', { class: 'u2dd' }, h('span', { class: 'n' }, label), v, h('i', { class: 'car', 'aria-hidden': 'true' }));
  const paint = () => { v.textContent = String(items[idx()] ?? ''); };
  el.onclick = (e) => {
    e.stopPropagation(); const r = el.getBoundingClientRect(), k0 = idx();
    menu(items.map((x, k) => ({ label: String(x), check: k === k0, fn: () => { set(val(k)); paint(); } })), r.left, r.bottom);
  };
  el.sync = paint; paint(); return el;
}
// a horizontal slider (levels, mixes, amounts): drag sideways, double tap = default, long press = automation
const SLIDER_RE = /^(mix|dry\/?wet|wet( level)?|dry( level)?|gain|level|volume|output( level)?|post gain|amount|depth|send)\b/i;
function hslider(p, label, get, set, onLong) {
  const fill = h('i', { class: 'f' }), knob = h('em'), v = h('span', { class: 'v' });
  const el = h('div', { class: 'u2sl', role: 'slider', 'aria-label': label, tabindex: 0 }, h('div', { class: 'hd' }, h('span', { class: 'n' }, label), v), h('div', { class: 'tr' }, fill, knob));
  const paint = () => { const x = get(), n = toNorm(p, x); el.style.setProperty('--n', n.toFixed(4)); const t = fmtParam(p, x); if (v.textContent !== t) v.textContent = t; };
  let d = null, last = 0;
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); el.setPointerCapture(e.pointerId); d = { x: e.clientX, n: toNorm(p, get()), moved: false, fired: false, t: 0 };
    if (onLong) d.t = setTimeout(() => { if (d && !d.moved) { d.fired = true; onLong(el.getBoundingClientRect()); } }, gestureTiming().longMs); });
  el.addEventListener('pointermove', (e) => { if (!d || d.fired) return; const dx = e.clientX - d.x; if (!d.moved && Math.abs(dx) < 3) return;
    if (!d.moved) { d.moved = true; clearTimeout(d.t); el.classList.add('act'); } const w = Math.max(40, el.querySelector('.tr').clientWidth); set(fromNorm(p, clamp(d.n + dx / w, 0, 1))); paint(); });
  const end = () => { if (!d) return; clearTimeout(d.t); el.classList.remove('act'); if (!d.moved && !d.fired) { const now = performance.now(); if (now - last < gestureTiming().dtapMs) { set(p.def); paint(); last = 0; } else last = now; } d = null; };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.sync = () => { if (!d) paint(); }; paint(); return el;
}
// a vertical slider (an instrument's envelope stages and levels): drag up / down, double tap = default, long press = automation
const ENV_RE = /(^|\s)(attack|atk|att|decay|dec|sustain|sus|release|rel|hold|delay|dly|predelay|pre ?delay)$/i;
// faders for the close-set controls (amounts, depths, tracking, detune / spread / phase, mixes); knobs for the main tone controls
const FADER_RE = /(^|\s)(amount|amt|depth|kbd|kbd ?trk|key ?(trk|track)|vel|vel ?(trk|track|sens)|velocity|detune|dtn\.? spread|spread|phase|phase rand|slide|glide|sub osc|noise|unison pan|mix|dry|wet|er|width)$/i;
// an effect's faders: time stages, thresholds, feedback, damping, cuts, stereo width; a graphic EQ's bands
const FX_FADER_RE = /(^|\s)(attack|atk|release|release time|rel|hold|decay|thresh|threshold|feedback|fdbk|damping|high damp|damp|predelay|pre-delay|delay|early refl\.?|er|width|spread|separation|lo-cut|hi-cut|low cut|high cut|stereo|focus|timbre|bias|asymmetry|return|floor|async\.?|dry level|wet level|dry|wet)$/i;
const BAND_RE = /^\d+(\.\d+)? ?k?Hz$/i;
function vslider(p, label, get, set, onLong) {
  const tr = h('div', { class: 'tr' }, h('i', { class: 'f' }), h('em')), v = h('span', { class: 'v' });
  const el = h('div', { class: 'u2vs', role: 'slider', 'aria-label': label, 'aria-orientation': 'vertical', tabindex: 0 }, h('span', { class: 'n', title: p.n }, label), tr, v);
  const paint = () => { const x = get(), n = toNorm(p, x); el.style.setProperty('--n', n.toFixed(4)); const t = fmtParam(p, x); if (v.textContent !== t) { v.textContent = t; el.setAttribute('aria-valuetext', t); } };
  let d = null, last = 0;
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); el.setPointerCapture(e.pointerId); d = { y: e.clientY, n: toNorm(p, get()), moved: false, fired: false, t: 0 };
    if (onLong) d.t = setTimeout(() => { if (d && !d.moved) { d.fired = true; onLong(el.getBoundingClientRect()); } }, gestureTiming().longMs); });
  el.addEventListener('pointermove', (e) => { if (!d || d.fired) return; const dy = d.y - e.clientY; if (!d.moved && Math.abs(dy) < 3) return;
    if (!d.moved) { d.moved = true; clearTimeout(d.t); el.classList.add('act'); } set(fromNorm(p, clamp(d.n + dy / Math.max(50, tr.clientHeight), 0, 1))); paint(); });
  const end = () => { if (!d) return; clearTimeout(d.t); el.classList.remove('act'); if (!d.moved && !d.fired) { const now = performance.now(); if (now - last < gestureTiming().dtapMs) { set(p.def); paint(); last = 0; } else last = now; } d = null; };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => { const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key]; if (!k) return; e.preventDefault();
    set(fromNorm(p, clamp(toNorm(p, get()) + k * (p.step ? p.step / (p.max - p.min) : 0.01), 0, 1))); paint(); });
  el.sync = () => { if (!d) paint(); }; paint(); return el;
}
// a list as a stepper: the name, an arrow up, the value (tap = the whole list), an arrow down
function stepper(p, label, get, set) {
  const items = p.items, val = (k) => p.min + k * (p.step || 1), idx = () => clamp(Math.round((get() - p.min) / (p.step || 1)), 0, items.length - 1);
  const v = h('button', { class: 'sv' });
  const go = (dk) => (e) => { e.stopPropagation(); set(val(clamp(idx() + dk, 0, items.length - 1))); paint(); };
  const up = h('button', { class: 'sa up', 'aria-label': label + ' berikutnya', onclick: go(1) }), dn = h('button', { class: 'sa dn', 'aria-label': label + ' sebelumnya', onclick: go(-1) });
  const el = h('div', { class: 'u2st' }, h('span', { class: 'n', title: p.n }, label), up, v, dn);
  v.onclick = (e) => { e.stopPropagation(); const r = v.getBoundingClientRect(), k0 = idx();
    menu(items.map((x, k) => ({ label: String(x), check: k === k0, fn: () => { set(val(k)); paint(); } })), r.left, r.bottom); };
  const paint = () => { const k = idx(), t = String(items[k] ?? ''); if (v.textContent !== t) v.textContent = t; v.title = t; up.disabled = k >= items.length - 1; dn.disabled = k <= 0; };
  el.sync = paint; paint(); return el;
}
function control(p, label, get, set, onLong, vert) {
  if (vert === true) {   // an instrument's panel: lists as steppers, envelope stages and levels as vertical sliders
    if (isList(p)) return stepper(p, label, get, set);
    if (!isSwitch(p) && (ENV_RE.test(String(p.n).trim()) || FADER_RE.test(String(p.n).trim()))) return vslider(p, label, get, set, onLong);
    if (!isSwitch(p)) return dial(p, label, get, set, onLong);   // gain, level, pan, cutoff, pitch, rate...: a knob
  }
  if (vert === 'fx' && !isList(p) && !isSwitch(p) && SLIDER_RE.test(String(p.n).trim())) return vslider(p, label, get, set, onLong);   // effects: every slider stands upright
  if (!isList(p) && !isSwitch(p) && SLIDER_RE.test(String(p.n).trim())) return hslider(p, label, get, set, onLong);
  if (vert === 'fx' && !isList(p) && !isSwitch(p) && (FX_FADER_RE.test(String(p.n).trim()) || BAND_RE.test(String(p.n).trim()))) return vslider(p, label, get, set, onLong);
  if (isList(p)) return choice(p, label, get, set);
  if (isSwitch(p)) return toggle(p, label, get, set);
  return dial(p, label, get, set, onLong);
}

// ---- envelope drawing for a group that has A / D / S / R
function envView(ps, get) {
  const find = (re) => ps.find((x) => re.test(x.p.n));
  const A = find(/(^|\s)(Attack|Atk|Att)$/i), D = find(/(^|\s)(Decay|Dec)$/i), S = find(/(^|\s)(Sustain|Sus)$/i), R = find(/(^|\s)(Release|Rel)$/i);
  if (!A || !D || (!S && !R)) return null;
  const s = svgEl('svg', { viewBox: '0 0 200 64', preserveAspectRatio: 'none', class: 'u2env' }), fill = svgEl('path', { class: 'f' }), line = svgEl('path', { class: 'l' });
  s.append(fill, line);
  const n = (x) => (x ? toNorm(x.p, get(x.k)) : 0);
  s.sync = () => {
    const a = 0.08 + n(A) * 0.9, dd = 0.08 + n(D) * 0.9, sl = S ? n(S) : 0, rr = R ? 0.08 + n(R) * 0.9 : 0.1, hold = 0.5, k = 192 / (a + dd + hold + rr);
    const x1 = 4 + a * k, x2 = x1 + dd * k, x3 = x2 + hold * k, x4 = x3 + rr * k, ys = 6 + (1 - sl) * 52;
    const dPath = `M4 58L${x1.toFixed(1)} 6L${x2.toFixed(1)} ${ys.toFixed(1)}L${x3.toFixed(1)} ${ys.toFixed(1)}L${x4.toFixed(1)} 58`;
    line.setAttribute('d', dPath); fill.setAttribute('d', dPath + 'Z');
  };
  s.sync(); return s;
}

// ---- sections
const GROUP_NAMES = { Flt: 'Filter Env', Frq: 'Pitch Env', EG: 'Envelope', MW: 'Mod Wheel', Dist: 'Distorsi', Mod: 'Modulasi', Vib: 'Vibrato', Sync: 'Sync' };
function prefixOf(n) {
  const w = String(n).split(/\s+/); if (w.length < 2) return '';
  if (/^\d+$/.test(w[1]) && w.length > 2) return w[0] + ' ' + w[1];
  return w[0];
}
// FL Studio Mobile's own pages for its four synths (the same tabs as the full editor, flmpanels.js)
const R = (a, b) => Array.from({ length: b - a + 1 }, (_, q) => a + q);
const SECTIONS = {
  30: [['Sample', [...R(0, 11), 34]], ['Filter', R(12, 16)], ['Filter Env', R(17, 21)], ['Pitch Env', R(22, 26)], ['LFO', R(27, 33)]],
  31: [['Filter', R(0, 6)], ['Osc', R(7, 13)], ['Mod', R(14, 21)], ['Level', R(22, 27)], ['EG', R(28, 34)], ['LFO', R(35, 38)], ['Voices', R(39, 46)], ['FX 1', R(47, 53)], ['FX 2', R(54, 60)], ['FX 3', R(61, 67)]],
  32: [['Osc', [0, 1, 2, 3, 43]], ['Filter', R(4, 7)], ['Filter Env', R(8, 12)], ['LFO', R(13, 18)], ['Master', R(19, 24)], ['Distorsi', R(25, 27)], ['Delay', R(28, 32)], ['Chorus', R(33, 36)], ['Phaser', R(37, 42)]],
  33: [['Osc', R(0, 4)], ['Unison', R(5, 9)], ['Sync', R(10, 17)], ['Filter', R(18, 26)], ['LFO', R(27, 33)], ['Amp', R(34, 39)], ['Wheels', R(40, 42)], ['Voices', R(43, 51)], ['Distorsi', [52, 53]], ['Delay', R(54, 57)]],
};
// card tab -> the full editor's page (its tabs: DirectWave 5, GMS 8, MiniSynth 6, SuperSaw 8)
const TABMAP = { 30: [0, 1, 2, 3, 4], 31: [0, 1, 2, 3, 4, 5, 6, 7, 7, 7], 32: [0, 1, 2, 3, 4, 5, 5, 5, 5], 33: [0, 0, 1, 2, 3, 4, 5, 6, 7, 7] };
function instGroups(def, type) {
  if (SECTIONS[type]) {
    const used = new Set(), out = SECTIONS[type].map(([n, ks]) => [n, ks.filter((k) => def.params[k] && !def.params[k].hidden && !used.has(k) && used.add(k)), '']).filter((g) => g[1].length);
    const rest = def.params.map((_, k) => k).filter((k) => !used.has(k) && !def.params[k].hidden);
    if (rest.length) out.push(['Lainnya', rest, '']);
    return out;
  }
  const idx = def.params.map((p, k) => k).filter((k) => !def.params[k].hidden);
  const cnt = new Map(); for (const k of idx) { const pf = prefixOf(def.params[k].n); if (pf) cnt.set(pf, (cnt.get(pf) || 0) + 1); }
  const order = [], by = new Map();
  for (const k of idx) {
    let pf = prefixOf(def.params[k].n); if (!pf || cnt.get(pf) < 3) pf = '';
    if (pf && !/^[A-Z]$/.test(pf)) pf = pf.replace(/\s?\d+$/, '') || pf;   // LFO1 / LFO2, Img 2 / Img 3, Mod10 ... share one tab
    if (!by.has(pf)) { by.set(pf, []); order.push(pf); } by.get(pf).push(k);
  }
  const main = by.get('') || [];
  const out = [];
  if (main.length) out.push(['Utama', main, '']);
  for (const pf of order) if (pf) out.push([/^[A-Z]$/.test(pf) ? 'Osc ' + pf : (GROUP_NAMES[pf] || pf), by.get(pf), pf]);
  // many tiny groups (Harmor, Moisture): fold groups of 1-2 params into the previous one
  return out;
}
function fxGroups(def) {
  const L = def.flm != null ? FLM_LAYOUT[def.flm] : null, used = new Set(), out = [];
  if (L && L.s) for (const [title, ks] of L.s) {
    const list = ks.filter((k) => def.params[k] && !def.params[k].hidden && !used.has(k)); list.forEach((k) => used.add(k));
    if (list.length) out.push([title, list, '', L.names || {}]);
  }
  const rest = def.params.map((_, k) => k).filter((k) => !used.has(k) && !def.params[k].hidden && def.params[k].fmt !== 'src');
  if (rest.length) out.push([out.length ? 'Lainnya' : 'Parameter', rest, '', (L && L.names) || {}]);
  return out;
}
const tidy = (n, pf) => { let s = String(n); if (pf && s.startsWith(pf + ' ')) s = s.slice(pf.length + 1); s = s.trim(); return /^[A-Z0-9 .\-/]+$/.test(s) && s.length > 3 ? s[0] + s.slice(1).toLowerCase() : s; };

// a card body with tabs (more than one section) and a grid of controls
function body(key, groups, mk, every, bigTabs, onTab) {
  const box = h('div', { class: 'u2c-b' }), tabs = h('div', { class: 'u2c-tabs', role: 'tablist' }), grid = h('div', { class: 'u2c-g' });
  let live = [], shownOnce = false;
  const show = (gi) => {
    tabMem.set(key, gi); const g = groups[gi]; live = []; if (onTab) onTab(gi);
    [...tabs.children].forEach((b, j) => { b.classList.toggle('on', j === gi); b.setAttribute('aria-selected', String(j === gi)); });
    const parts = [];
    const ctl = g[1].map((k) => { const c = mk(k, g[2], g[3] || {}); live.push(c); return { k, c }; });
    const env = null;   // v3 cards draw the envelope on their screen (fxdisp.js), not again among the controls
    // order: lists and switches first (full-width rows), then the dials
    const rows = ctl.filter(({ c }) => !c.classList.contains('u2d') && !c.classList.contains('u2sl') && !c.classList.contains('u2vs')).map(({ c }) => c), dials = ctl.filter(({ c }) => c.classList.contains('u2d')).map(({ c }) => c), sliders = ctl.filter(({ c }) => c.classList.contains('u2sl')).map(({ c }) => c);
    dials.push(...ctl.filter(({ c }) => c.classList.contains('u2vs')).map(({ c }) => c));   // the faders after the knobs, side by side
    // one grid that fills the rack's height row by row and then grows sideways (a field takes two dial cells): nothing is cut off
    if (mk.cols) {   // an instrument: columns across the whole panel, one kind each: switches, lists, knobs (stacked), sliders
      const of = (c) => ctl.filter((x) => x.c.classList.contains(c)).map((x) => x.c), tg = of('u2t'), st = of('u2st'), kn = of('u2d'), vs = of('u2vs');
      const rest = ctl.map((x) => x.c).filter((c) => !tg.includes(c) && !st.includes(c) && !kn.includes(c) && !vs.includes(c));
      parts.push(h('div', { class: 'u2cols' }, tg.length ? h('div', { class: 'u2col tg' }, ...tg) : null, ...st, ...rest, kn.length ? h('div', { class: 'u2col kn' }, ...kn) : null, ...vs));
    } else if (env || rows.length || dials.length || sliders.length) parts.push(h('div', { class: 'u2c-dials' }, ...(env ? [env] : []), ...rows, ...dials, ...sliders));
    grid.replaceChildren(...parts); fit();
    const dl = grid.firstElementChild; if (dl && shownOnce) { dl.classList.remove('swap'); void dl.offsetWidth; dl.classList.add('swap'); } shownOnce = true;
  };
  // rows: as many as the rack is tall (the card is only as tall as its controls, so measure against the rack, not the card)
  // rows: as many 58 px rows (+4 px gaps) as fit between the grid's top and the card's bottom; never more than the controls need.
  // Checked again while the rack is on screen (the panel can still be opening, the tabs can wrap), set only when it changes.
  const fitNow = () => {
    const card = grid.closest('.card'), sc = grid.closest('.dev-scroll'), dl = grid.querySelector('.u2c-dials'); if (!card || !sc || !card.offsetParent) return;
    const cl = grid.querySelector('.u2cols');
    if (cl) {   // columns: as tall as the rack allows; knobs two to a column when there is room, switches as many to a column as fit
      const hh = Math.floor(Math.min(card.getBoundingClientRect().bottom, sc.getBoundingClientRect().bottom) - 8 - cl.getBoundingClientRect().top); if (!(hh > 40)) return;
      if (cl.style.height !== hh + 'px') cl.style.height = hh + 'px';
      const kn = cl.querySelector('.u2col.kn'), tg = cl.querySelector('.u2col.tg');
      if (kn) { const n = kn.children.length, r = Math.max(1, Math.min(n >= (hh >= 130 ? 4 : 6) ? 2 : 1, Math.floor(hh / 64))), c = Math.ceil(n / r);
        if (kn.style.getPropertyValue('--kr') !== String(r)) kn.style.setProperty('--kr', String(r)); kn.style.flexGrow = String(c); kn.style.minWidth = (c * 64) + 'px'; }
      if (tg) { const n = tg.children.length, r = Math.max(1, Math.min(n, Math.floor((hh + 5) / 33))), c = Math.ceil(n / r);
        if (tg.style.getPropertyValue('--tr') !== String(r)) tg.style.setProperty('--tr', String(r)); tg.style.flexGrow = "0"; tg.style.minWidth = (c * 92 + (c - 1) * 5) + 'px'; }
      return;
    }
    const bottom = Math.min(card.getBoundingClientRect().bottom, sc.getBoundingClientRect().bottom) - 8, dl0 = grid.querySelector('.u2c-dials'), hh = bottom - (dl0 || grid).getBoundingClientRect().top;
    if (!(hh > 0)) return;
    const kids = dl ? [...dl.children] : [], span = (e) => (e.classList.contains('u2seg-f') ? 3 : e.classList.contains('u2dd') || e.classList.contains('u2sl') ? 2 : 1);
    const cells = kids.reduce((a, e) => a + span(e), 0) || 1, rows = Math.max(1, Math.min(Math.floor((hh + 6) / 76), kids.length || 1));   // rows of 70 px: a knob of 40 px or more
    // the fewest columns whose row-by-row packing (wide controls take 2 or 3 cells, 'dense' fills gaps) fits in the rows
    const tall = rows >= 2; if (dl) dl.classList.toggle('vs2', tall);   // a fader stands two rows tall when there are two
    const fits = (cols) => { const g = []; let used = 0; for (const e of kids) { const w = span(e), ht = tall && e.classList.contains('u2vs') ? 2 : 1; let placed = false;
      for (let r = 0; r < 64 && !placed; r++) { for (let q = r; q < r + ht; q++) g[q] = g[q] || new Array(cols).fill(0);
        for (let c = 0; c + w <= cols; c++) { let free = true; for (let q = r; q < r + ht && free; q++) free = g[q].slice(c, c + w).every((x) => !x);
          if (free) { for (let q = r; q < r + ht; q++) for (let x = c; x < c + w; x++) g[q][x] = 1; used = Math.max(used, r + ht); placed = true; break; } } }
    } return used <= rows; };
    let cols = Math.max(Math.ceil(cells / rows), ...kids.map(span), 1); while (cols < cells && !fits(cols)) cols++;   // read left to right, top to bottom
    const v = String(rows); if (grid.style.getPropertyValue('--rows') !== v) grid.style.setProperty('--rows', v);
    if (grid.style.getPropertyValue('--cols') !== String(cols)) grid.style.setProperty('--cols', String(cols));
  };
  const fit = () => requestAnimationFrame(fitNow);
  if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(() => fit()); ro.observe(grid); ro.observe(tabs); requestAnimationFrame(() => { const sc = grid.closest('.dev-scroll'); if (sc) ro.observe(sc); }); }
  setTimeout(fit, 120); setTimeout(fit, 450);
  if (groups.length > 1 || bigTabs) groups.forEach((g, gi) => tabs.append(h('button', { role: 'tab', onclick: (e) => { e.stopPropagation(); show(gi); } }, g[0])));
  if (tabs.children.length) box.append(tabs);
  box.append(grid);
  show(Math.min(tabMem.get(key) || 0, Math.max(0, groups.length - 1)));
  every(120, () => { for (const c of live) if (c.sync) c.sync(); fitNow(); });
  return box;
}

function moreBtn(items) {
  return h('button', { class: 'u2c-more', 'aria-label': 'Menu modul', onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); menu(items(r), r.right - 220, r.bottom + 4); } },
    h('i'), h('i'), h('i'));
}
function powerSwitch(on, flip, label) {
  const b = h('button', { class: 'u2sw-b' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-label': label, onclick: (e) => { e.stopPropagation(); flip(); } }, h('i', { class: 'u2sw' }));
  return b;
}

// ---- the card's identity: each effect family has its own colour and icon (the instruments take their track's colour)
const SV = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const CAT = {
  echo: ['Echo & Reverb', '#7cc8ff', SV('<path d="M4 12h2M8 8v8M12 5v14M16 8v8M20 11v2"/>')],
  level: ['Dinamika', '#9be37a', SV('<path d="M5 19V9M10 19V5M15 19v-8M20 19v-5"/>')],
  eq: ['EQ & Filter', '#ffc65c', SV('<path d="M3 16c3 0 4-8 7-8s3 6 6 6 3-4 5-4"/>')],
  mod: ['Modulasi', '#c9b3ff', SV('<path d="M3 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0"/>')],
  pitch: ['Pitch & Stereo', '#ff9ccb', SV('<path d="M8 4v16M8 4l-3 3M8 4l3 3M16 20V4M16 20l-3-3M16 20l3-3"/>')],
  misc: ['Alat', '#a8b4c8', SV('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>')],
  flmnote: ['Note FX', '#6fe0cc', SV('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>')],
};
const INST_IC = SV('<path d="M4 5h16v14H4zM8 5v14M12 5v14M16 5v14"/><path d="M6.6 5v7M10.6 5v7M14.6 5v7M18.2 5v7" stroke-width="2.6"/>');
const famOf = (type) => { const g = FX_GROUPS.find((x) => x[2].includes(type)); return g && CAT[g[0]] ? g[0] : 'misc'; };
const catOf = (type) => CAT[famOf(type)];
// header: [icon badge] [name / family] ... [extra] [switch] [⋯]
function header(icon, nameEl, sub, ...right) {
  const b = h('i', { class: 'u2c-badge', 'aria-hidden': 'true' }); b.innerHTML = icon;
  return h('div', { class: 'u2c-h' }, b, h('div', { class: 'u2c-tt' }, nameEl, h('small', {}, sub)), ...right.filter(Boolean));
}

// v3 card: a module like a piece of hardware - a screen on the left (the graphic, with the module's name, switch and menu on it, and the
// instrument's actions under it), the tabs and the controls on the right
function cardV3(cls, cc, head, hero, foot, panelKids, kb) {
  // an instrument's buttons (Preset, SoundFont, Sample...) sit under its name in the title bar, its keyboard at the screen's foot
  if (kb && foot && foot.length) { const tt = head.querySelector('.u2c-tt'), sm = tt && tt.querySelector('small'); if (sm) sm.replaceWith(h('div', { class: 'u2c-chips' }, ...foot)); foot = null; }
  const screen = h('div', { class: 'u2s' + (kb ? ' haskb' : '') }, hero || h('div', { class: 'u2fx blank' }), head, kb || null, foot && foot.length ? h('div', { class: 'u2s-foot' }, ...foot) : null);
  const card = h('div', { class: 'card u2c v3 ' + cls }, screen, h('div', { class: 'u2c-p' }, ...panelKids.filter(Boolean)));
  // the display comes first: on a short rack (a phone held sideways) the keyboard steps aside so the graphic keeps its room
  // (a small button swaps the graphic and the keyboard there, so the keyboard is always one tap away)
  if (kb) screen.append(h('button', { class: 'u2kb-tg', 'aria-label': 'Keyboard / tampilan', title: 'Keyboard', onclick: (e) => { e.stopPropagation(); screen.classList.toggle('kbshow'); } }));
  if (kb && typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { const s = screen.clientHeight; if (s > 0) screen.classList.toggle('kbhide', s < 200); }).observe(screen);
  card.style.setProperty('--cc', cc); return card;
}

// a two-octave keyboard on an instrument's screen: tap a key to hear the instrument (the octave arrows move it)
const kbOct = new Map();
function miniKeys(i, key) {
  let base = kbOct.get(key) ?? 48;
  const keys = h('div', { class: 'u2kb-keys' }), lab = h('span', { class: 'u2kb-o' });
  const build = () => {
    const ws = [], bs = []; let wi = 0;
    for (let n = 0; n < 24; n++) { const pc = n % 12, black = [1, 3, 6, 8, 10].includes(pc), p = base + n;
      const k = h('i', { class: black ? 'bk' : 'wk', style: black ? `left:calc(${wi} * 100% / 14 - 100% / 40)` : '' });
      k.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); try { k.setPointerCapture(e.pointerId); } catch (_) { /* gone */ } k.classList.add('on'); P.noteEvent(i, p, 0.8, true); });
      const off = () => { if (!k.classList.contains('on')) return; k.classList.remove('on'); P.noteEvent(i, p, 0, false); };
      k.addEventListener('pointerup', off); k.addEventListener('pointercancel', off); k.addEventListener('pointerleave', off);
      if (black) bs.push(k); else { ws.push(k); wi++; } }
    keys.replaceChildren(...ws, ...bs); lab.textContent = 'C' + (Math.floor(base / 12) - 1);
  };
  const step = (d) => (e) => { e.stopPropagation(); base = clamp(base + d * 12, 24, 84); kbOct.set(key, base); build(); };
  build();
  return h('div', { class: 'u2kb' }, h('button', { class: 'u2kb-a', 'aria-label': 'Oktaf turun', onclick: step(-1) }, '\u2039'), keys, h('button', { class: 'u2kb-a', 'aria-label': 'Oktaf naik', onclick: step(1) }, '\u203a'), lab);
}
// SoundFont has no display of its own: its real state, as text (the file, the program, the envelope multipliers over the file's own)
function sfScreen(t, def, every) {
  const el = h('div', { class: 'u2sf' });
  const paint = () => {
    const sf = t.inst.sf, pr = sf && sf.presets ? sf.presets[sf.preset || 0] : null, nm = (q) => (typeof q === 'string' ? q : q && (q.name || q.n)) || '\u2014';
    const v = (k) => fmtParam(def.params[k], t.inst.params[k] ?? def.params[k].def);
    const rows = [['File', sf ? String(sf.path || '').split('/').pop() : 'Belum dimuat'], ['Program', sf ? nm(pr) : '\u2014'], ['ADSR', v(2) + ' ' + v(3) + ' ' + v(4) + ' ' + v(5)]];
    el.replaceChildren(...rows.map(([a, b]) => h('div', { class: 'r' }, h('span', {}, a), h('b', {}, b))));
  };
  paint(); every(300, paint); return el;
}

// ---- effect card
// api: { fxPick(rect, fn), openWindow(), stripName, every }
export function fxCard(i, d, di, n, api) {
  const def = DEVICES[d.type], off = !!d.bypass;
  const name = h('button', { class: 'u2c-name', onclick: (e) => { e.stopPropagation(); api.fxPick(e.currentTarget.getBoundingClientRect(), (ty) => P.replaceDevice(i, di, ty)); } }, h('span', {}, def.name), h('i', { class: 'car', 'aria-hidden': 'true' }));
  const items = () => [
    { label: 'Editor lengkap…', fn: () => api.openWindow() },
    { sep: true },
    { label: 'Geser ke kiri', dim: di <= 0, fn: () => { if (di > 0) P.moveDevice(i, di, di - 1); } },
    { label: 'Geser ke kanan', dim: di >= n - 1, fn: () => { if (di < n - 1) P.moveDevice(i, di, di + 1); } },
    { label: 'Reset parameter', fn: () => { P.resetDevice(i, di); toast(def.name + ': parameter kembali ke awal.', 1400); } },
    { sep: true },
    { label: 'Hapus', fn: () => P.removeDevice(i, di) },
  ];
  const cat = catOf(d.type);
  const head = header(cat[2], name, cat[0], powerSwitch(!off, () => P.toggleBypass(i, di), off ? 'Nyalakan ' + def.name : 'Matikan ' + def.name), moreBtn(items));
  const groups = fxGroups(def);
  if (!NO_WET_FX.has(d.type)) groups.push(['Keluaran', ['mix', 'gain'], '']);
  const get = (k) => (k === 'mix' || k === 'gain' ? P.wetOf(d)[k] : (d.params[k] ?? def.params[k].def));
  const pdef = (k) => (k === 'mix' || k === 'gain' ? WET_PARAMS[k] : def.params[k]);
  const mk = (k, pf, names) => {
    const p = pdef(k), wet = k === 'mix' || k === 'gain';
    const set = wet ? (v) => P.setDeviceWet(i, di, k, v) : (v) => P.setDeviceParam(i, di, k, v);
    const auto = wet && k === 'gain' ? null : (rect) => offerAutomation(rect, { kind: 4, strip: P.stripOf(i), devId: d.id, param: wet ? MIX_P : k, def: p }, `${api.stripName(i)} • ${def.name} ${p.n}`);
    return control(p, wet ? p.n : tidy(names[k] || p.n, pf), () => get(k), set, auto, 'fx');
  };
  mk.get = get; mk.def = pdef;
  const kids = [];
  if (d.type === 16) kids.push(h('div', { class: 'u2c-cta' }, h('p', {}, 'Meter, spektrum, osiloskop dan stereo di satu jendela.'), h('button', { class: 'u2btn fill', onclick: () => api.openWindow() }, 'Buka MiniMeters')));
  // the module's own display (real formulas, real parameters) when it has one, else the card's drawn graphic
  const real = d.type === 16 || !def.kit ? null : realScreen(() => kitView({ i, di, d, def, every: api.every, set: (k, v) => P.setDeviceParam(i, di, k, v), refreshKnobs: () => {} }), api.every);
  const hero = d.type === 16 ? null : real || fxDisplay({ def, d, family: famOf(d.type), strip: i, every: api.every, get: (k) => d.params[k] ?? def.params[k].def });
  if (groups.length) kids.push(body('d' + d.id, groups, mk, api.every));
  else kids.push(h('div', { class: 'u2c-empty' }, 'Modul ini tidak punya parameter.'));
  return cardV3('fx' + (off ? ' off' : ''), cat[1], head, hero, null, kids);
}

// ---- instrument card
// api: { pickInst(rect), presetMenu(rect), openWindow(), extra: [{label, fn}], every }
export function instCard(i, t, api) {
  const def = INSTRUMENTS[t.inst.type], midi = t.kind === 'midi';
  const name = midi ? h('button', { class: 'u2c-name', onclick: (e) => { e.stopPropagation(); api.pickInst(e.currentTarget.getBoundingClientRect()); } }, h('span', {}, def.name), h('i', { class: 'car', 'aria-hidden': 'true' }))
    : h('div', { class: 'u2c-name' }, h('span', {}, def.name));
  const items = () => [{ label: 'Editor lengkap…', fn: () => api.openWindow() }, ...(api.extra.length ? [{ sep: true }, ...api.extra] : [])];
  const head = header(INST_IC, name, (t.kind === 'drum' ? 'Drum' : 'Instrumen') + ' \u2022 ' + t.name, moreBtn(items));
  const foot = [];
  if (midi) foot.push(h('button', { class: 'u2chip', onclick: (e) => { e.stopPropagation(); api.presetMenu(e.currentTarget.getBoundingClientRect()); } }, 'Preset'));
  if (def.zones || def.floatOnly || t.inst.type === 6 || t.inst.type === 35 || t.inst.type === 38 || !midi) foot.push(h('button', { class: 'u2chip fill', onclick: () => api.openWindow() }, t.inst.type === 6 ? 'SoundFont' : def.zones ? 'Sample' : t.inst.type === 35 ? 'Irisan' : !midi ? 'Pad & sample' : 'Editor'));
  if (t.inst.type === 6 && t.inst.sf && (t.inst.sf.presets || []).length) {   // SoundFont: the program, chosen from the file's list
    const pr = t.inst.sf.presets, cur = pr[t.inst.sf.preset || 0], nm = (q) => (typeof q === 'string' ? q : q && (q.name || q.n)) || 'Program';
    foot.push(h('button', { class: 'u2chip prog', onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect();
      menu(pr.map((q, k) => ({ label: nm(q), check: k === (t.inst.sf.preset || 0), fn: () => P.setSfPreset(i, k) })), r.left, r.top - 8); } }, nm(cur)));
  }
  for (const x of api.extra.slice(0, 1)) foot.push(h('button', { class: 'u2chip', onclick: (e) => x.fn(e.currentTarget.getBoundingClientRect()) }, x.label.replace(/\u2026$/, '').replace(/^Zona sample$/, 'Zona')));
  const kids = [];
  if (t.inst.missing) { const x = t.inst.missing; kids.push(h('div', { class: 'u2c-warn' }, (x.name || 'Instrumen') + ': ' + (x.sample ? 'sample ' + x.sample.split('/').pop() : 'program') + ' tidak tersedia')); }
  if (t.kind === 'drum') {   // the drum kit: its pads and the chosen pad's sound
    kids.push(drumBody(i, t, api));
    return cardV3('inst drum', t.color || 'var(--accent)', head, fxDisplay({ def, d: null, family: 'inst', strip: i, every: api.every, get: () => 0 }), foot, kids);
  }
  const groups = instGroups(def, t.inst.type);
  const get = (k) => t.inst.params[k] ?? def.params[k].def;
  const mk = (k, pf) => { const p = def.params[k];
    return control(p, tidy(p.n, pf), () => get(k), (v) => P.setInstParam(i, k, v), (rect) => offerAutomation(rect, { kind: 5, strip: P.stripOf(i), param: k, def: p }, `${t.name} \u2022 ${p.n}`), true); };
  mk.get = get; mk.def = (k) => def.params[k]; mk.cols = true;
  // the instrument's own display (FL Studio Mobile's synths: the page of the card's tab; 3x Osc: its oscillators)
  const real = midi && def.view === 'kit' && t.inst.type !== 6 ? realScreen(() => instKitView(i, t, api.every), api.every) : null;
  const tmap = TABMAP[t.inst.type];
  if (groups.length) kids.push(body('i' + t.id, groups, mk, api.every, false, real && real.setTab ? (gi) => real.setTab(tmap ? (tmap[gi] ?? 0) : 0) : null));
  else kids.push(h('div', { class: 'u2c-empty' }, 'Diatur lewat editornya.'));
  const hero = real || (t.inst.type === 6 ? sfScreen(t, def, api.every) : fxDisplay({ def, d: null, family: 'inst', strip: i, every: api.every, get }));
  return cardV3('inst', t.color || 'var(--accent)', head, hero, foot, kids, midi ? miniKeys(i, t.id) : null);
}

// ---- drum kit: a grid of pads (tap = choose + hear it), the chosen pad's Gain / Pan / Pitch / Decay (+ Start / End for a sample),
// Mute / Solo, and its sample from the browser
const PADK = {
  gain: { n: 'Gain', min: -36, max: 6, def: 0, unit: 'dB' }, pan: { n: 'Pan', min: -1, max: 1, def: 0, fmt: 'pan' },
  pit: { n: 'Pitch', min: -12, max: 12, def: 0, step: 1, unit: 'st' }, dec: { n: 'Decay', min: 0.25, max: 3, def: 1, curve: 'log', unit: 'x' },
  start: { n: 'Start', min: 0, max: 0.95, def: 0, unit: '%' }, end: { n: 'End', min: 0.05, max: 1, def: 1, unit: '%' },
};
const padSel = new Map();
function drumBody(i, t, api) {
  const pads = P.padsOf(i), key = t.id;
  let sel = Math.min(padSel.get(key) || 0, Math.max(0, pads.length - 1));
  const grid = h('div', { class: 'u2pads' }), ctl = h('div', { class: 'u2c-dials u2padctl' }), live = [];
  const paint = () => {
    [...grid.children].forEach((b, k) => b.classList.toggle('on', k === sel));
    const q = pads[sel]; live.length = 0; if (!q) { ctl.replaceChildren(); return; }
    const fields = q.sample ? ['gain', 'pan', 'pit', 'start', 'end'] : ['gain', 'pan', 'pit', 'dec'];
    const kn = fields.map((f) => { const c = control(PADK[f], PADK[f].n, () => (pads[sel] ? pads[sel][f] ?? PADK[f].def : PADK[f].def), (v) => P.setPad(i, sel, f, v)); live.push(c); return c; });
    const tg = (f, label) => { const b = h('button', { class: 'u2padb' + (q[f] ? ' on' : ''), onclick: (e) => { e.stopPropagation(); P.setPad(i, sel, f, !pads[sel][f]); b.classList.toggle('on', !!pads[sel][f]); grid.children[sel].classList.toggle(f, !!pads[sel][f]); } }, label); return b; };
    const smp = h('button', { class: 'u2padb wide', onclick: async (e) => { e.stopPropagation(); const DP = await import('../drumpad.js'); DP.pickPadSample(i, sel, () => P.emit('devices')); } }, q.sample ? (q.sample.name || 'Sample').replace(/\.[^.]+$/, '') : 'Pilih sample\u2026');
    ctl.replaceChildren(h('div', { class: 'u2padhead' }, h('b', {}, q.name || 'Pad ' + (sel + 1)), h('div', { class: 'u2padbs' }, tg('mute', 'M'), tg('solo', 'S')), smp), ...kn);
  };
  pads.forEach((q, k) => {
    const b = h('button', { class: 'u2pad' + (q.mute ? ' mute' : '') + (q.solo ? ' solo' : '') }, h('span', {}, q.name || 'Pad ' + (k + 1)));
    b.addEventListener('pointerdown', (e) => { e.stopPropagation(); sel = k; padSel.set(key, k); paint(); P.noteEvent(i, q.pitch, 0.85, true); b.classList.add('hit'); });
    const off = () => { if (!b.classList.contains('hit')) return; b.classList.remove('hit'); P.noteEvent(i, q.pitch, 0, false); };
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    grid.append(b);
  });
  if (!pads.length) grid.append(h('div', { class: 'u2c-empty' }, 'Belum ada pad.'));
  api.every(150, () => { for (const c of live) if (c.sync) c.sync(); });
  paint();
  return h('div', { class: 'u2c-b u2drum' }, grid, ctl);
}

// ---- audio track: the source card
export function audioCard() {
  return h('div', { class: 'card u2c src' }, h('div', { class: 'u2c-h' }, h('i', { class: 'u2c-ic au', 'aria-hidden': 'true' }), h('div', { class: 'u2c-name' }, h('span', {}, 'Audio'))),
    h('div', { class: 'u2c-empty' }, 'Klip audio diputar, lalu lewat efek di sebelah kanan.'));
}
