// Live 12 device panels for the effects of js/engine/fx3.js (defs.js: kit: true). Every control is bound to a real engine parameter;
// the layout follows the owner's reference images of Live 12 (sections side by side, label above / value below each knob, orange toggles,
// cyan value boxes, dark displays with a cyan curve and hollow orange rings that can be dragged).
import { reorderGrip } from './reorder.js';
import { h, knob, menu, ask, fromNorm, toNorm } from './ui.js';
import { C } from './theme.js';
import { fmtParam, normOf, valOf, MOD_MAP, DEVICES, INSTRUMENTS, FX_GROUPS, IRACK_DEF } from './defs.js';
import { buildSynth } from './devviz.js';
import { menuItem } from './fxlaw.js';
import { FLM_GRAPH } from './flmviz.js';
import { OP_ALGOS } from './engine/operator.js';
import { POLI_TGT, POLI_GRID, POLI_MIDI } from './engine/poli.js';
import { MELD_B, MELD_G, MELD_N, MO, MELD_TGT, MELD_SRC, MELD_OSC } from './engine/meld.js';
import { lvNum, lvTog, lvBtn, lvChoice, lvSel, lvDisp, lvDrag, lvRing, lvPath, lvTabs, lvEnvPts, DISPC } from './liveui.js';
import { eq8Stages } from './engine/fx3.js';
import { Electric, Tension, Collision } from './engine/phys.js';
import { DsKick, DsSnare, DsTom, DsHH, DsClap, DsFm } from './engine/ds.js';
import { WT_CATS, WT_LIST, WT_COUNT, WT_N_FRAMES, wtTable, wtCatOf } from './engine/live.js';
import { offerAutomation } from './automate.js';
import { Biquad } from './engine/dsp.js';
import { addFlmPanels } from './flmpanels.js';
import { eng, MASTER, RET0 } from './engine.js';
import * as P from './project.js';
import * as BR from './browser.js';
import { prefs } from './prefs.js';
// fluid motion for meters / analysers: a value glides to its target every frame (fast up, slower down); off with Reduce motion
const calm = () => prefs.reduceMotion || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const glide = (cur, tgt, up = 0.5, down = 0.14) => (calm() ? tgt : cur + (tgt - cur) * (tgt > cur ? up : down));

// scaleK: a stepped dial with its steps printed round it (Live's Glue Compressor Attack / Release / Ratio); the dial's own value line is hidden
function scaleK(k, j, steps) {
  const el = k.K(j), sv = el.querySelector('svg'), w = h('span', { class: 'lk-sclw' });
  sv.replaceWith(w); w.append(sv);
  steps.forEach((t, n) => { const th = (225 + (steps.length > 1 ? n / (steps.length - 1) : 0) * 270) * Math.PI / 180, x = Math.sin(th) * 25, y = -Math.cos(th) * 23;
    w.append(h('i', { class: 'lk-scl', style: `left:calc(50% + ${x.toFixed(1)}px);top:calc(50% + ${y.toFixed(1)}px)` }, t)); });
  el.classList.add('lk-sclk'); return el;
}
// specFill: Live's grey analyser behind a filter curve. spec = 128 log bins (20 Hz .. 20 kHz, dB) from the engine; drawn as a filled
// shape over the display's width (the x axis of grid() / lx() is the same 20 Hz .. 20 kHz log scale)
function specFill(g, spec, w, hh, top = 0, bottom = hh) {
  if (!spec || !spec.length) return; const n = spec.length, pts = [[0, bottom]];
  for (let b = 0; b < n; b++) pts.push([(b + 0.5) / n * w, bottom - Math.max(0, Math.min(1, (spec[b] + 90) / 84)) * (bottom - top)]);
  pts.push([w, bottom]); g.fillStyle = 'rgba(150,150,156,.55)'; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const q of pts) g.lineTo(q[0], q[1]); g.closePath(); g.fill();
}
// specFeed: polls the device read-out from `off` (128 bins) and glides the shown spectrum every frame
function specFeed(k, off, paint) {
  const st = { spec: null, tgt: null };
  k.every(60, () => { const r = k.out(); if (r.length >= off + 128) { const a = new Float32Array(128); for (let b = 0; b < 128; b++) { let m = -150; for (let j = -1; j <= 1; j++) { const q = b + j; if (q >= 0 && q < 128) m = Math.max(m, r[off + q]); } a[b] = m; } st.tgt = a; } });
  k.every(16, () => { if (!st.tgt) return; if (!st.spec) st.spec = Float32Array.from(st.tgt); else for (let b = 0; b < 128; b++) st.spec[b] = glide(st.spec[b], st.tgt[b], 0.35, 0.08); paint(); });
  return st;
}
// tn: the name a section gets when the rack is too small for the whole panel and it is shown as tabs (devices.js tabify)
const tn = (el, n) => { el.dataset.tn = n; return el; };
const SR = 48000, F0 = 20, F1 = 20000;
const lx = (f, w) => (Math.log(f / F0) / Math.log(F1 / F0)) * w, xl = (x, w) => F0 * Math.pow(F1 / F0, Math.max(0, Math.min(1, x / w)));
const mag = (b, f) => { const w = 2 * Math.PI * f / SR, c1 = Math.cos(w), c2 = Math.cos(2 * w), s1 = Math.sin(w), s2 = Math.sin(2 * w);
  const nr = b.b0 + b.b1 * c1 + b.b2 * c2, ni = -(b.b1 * s1 + b.b2 * s2), dr = 1 + b.a1 * c1 + b.a2 * c2, di = -(b.a1 * s1 + b.a2 * s2); return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di)); };
const grid = (g, w, hh) => { g.fillStyle = 'rgba(255,255,255,.05)'; for (let dec = 10; dec < 20000; dec *= 10) for (let m = 2; m < 10; m++) { const f = dec * m; if (f > 20 && f < 20000 && m !== 10) g.fillRect(Math.round(lx(f, w)), 0, 1, hh); } g.fillStyle = DISPC.grid; for (const f of [100, 1000, 10000]) g.fillRect(Math.round(lx(f, w)), 0, 1, hh); };   // Live: a fine log grid under the decade lines
const label = (g, t, x, y, col = DISPC.ink, sz = 9, al = 'left') => { g.fillStyle = col; g.font = `600 ${sz}px system-ui,sans-serif`; g.textAlign = al; g.textBaseline = 'alphabetic'; g.fillText(t, x, y); g.textAlign = 'left'; };

// ---- the kit: controls bound to device parameters (a bipolar knob gets Live's small centre triangle above its dial) ---------
const EZ_ID = new Map(), EZ_OBJ = new WeakMap();
function easeMap(d) {
  if (d && d.id != null) { let m = EZ_ID.get(d.id); if (!m) { if (EZ_ID.size > 300) EZ_ID.clear(); m = new Map(); EZ_ID.set(d.id, m); } return m; }
  if (d && typeof d === 'object') { let m = EZ_OBJ.get(d); if (!m) { m = new Map(); EZ_OBJ.set(d, m); } return m; }
  return new Map();
}
function kit(ctx) {
  const { i, di, d, def } = ctx, draws = [], ctls = [];
  // fluid displays: while a display paints (inDraw), a continuous parameter reads a value that glides to the real one in about 60 ms on the
  // knob's own scale (log knobs glide evenly in octaves), so curves / envelopes / waveforms morph instead of jumping on presets, menus,
  // automation, undo and drags. Menus and switches stay exact. Off with Reduce motion.
  const ez = easeMap(d); let drawing = 0, need = false, raf = 0, lastT = 0;   // kept per device: a panel rebuilt after a change still glides from where it was
  const easeable = (p) => p && typeof p.min === 'number' && typeof p.max === 'number' && p.max > p.min && p.fmt !== 'list' && p.fmt !== 'onoff' && !p.items && !(p.step >= 1 && p.max - p.min <= 16);
  const get = (k) => {
    const v = d.params[k];
    if (!drawing || typeof v !== 'number' || !def.params) return v;
    const p = def.params[k]; if (!easeable(p)) return v;
    const t = normOf(p, v), e = ez.get(k);
    if (e === undefined || calm() || Math.abs(e - t) < 1e-4) { ez.set(k, t); return v; }
    need = true; return valOf(p, e);
  };
  const step = (now) => {
    raf = 0; const dt = Math.min(0.05, Math.max(0.001, (now - (lastT || now - 16)) / 1000)); lastT = now;
    const f = 1 - Math.exp(-dt / 0.06);
    for (const [k, e] of ez) { const p = def.params[k], v = d.params[k]; if (!p || typeof v !== 'number') { ez.delete(k); continue; } const t = normOf(p, v); ez.set(k, Math.abs(t - e) < 1e-4 ? t : e + (t - e) * f); }
    redraw();
  };
  const inDraw = (fn) => { drawing++; need = false; try { fn(); } finally { drawing--; } if (need && !raf) { if (!lastT || performance.now() - lastT > 100) lastT = 0; raf = requestAnimationFrame(step); } };
  const redraw = () => { for (const f of draws) f(); };
  const set = (k, v) => { if (ctx.setParam) ctx.setParam(k, v); else P.setDeviceParam(i, di, k, v); redraw(); for (const c of ctls) if (c.update && c._k !== k) c.update(); };
  const auto = (k) => (ctx.autoFn ? ctx.autoFn(k) : ctx.nested ? null : (rect) => offerAutomation(rect, { kind: 4, strip: P.stripOf(i), devId: d.id, param: k, def: def.params[k] }, `${def.name} ${def.params[k].n}`));   // devices inside a rack have no automation lanes (map them to a macro)
  const reg = (el, k) => { el._k = k; ctls.push(el); return el; };
  const lbl = (k, o) => (o && o.n != null ? o.n : def.params[k].n.replace(/^(L\+R|L|R) /, ''));
  const K = (k, o = {}) => { const el = knob({ ...def.params[k], ...(o.p || {}), n: lbl(k, o) }, () => get(k), (v) => set(k, v), fmtParam, C('#7ac5ff'), auto(k)); el.classList.add('lk-k'); { const q = def.params[k], sv = el.querySelector('svg'); if (q.min < 0 && q.max > 0 && !q.curve && sv) sv.before(h('i', { class: 'lk-bipm' })); } if (o.big) el.classList.add('big'); if (o.col) el.style.setProperty('--lv-arc', o.col); return reg(el, k); };
  const T = (k, text, o = {}) => reg(lvTog(text, () => (get(k) > 0.5) !== !!o.inv, (b) => set(k, b !== !!o.inv ? 1 : 0), { cls: 'lk-t ' + (o.cls || ''), w: o.w }), k);
  // one button that steps through a list and shows the current entry (Live: Resonators Mode A / B)
  const CY = (k, labels, o = {}) => { const p = def.params[k], b = lvBtn('', () => { const j = Math.round(get(k) - p.min) + 1; set(k, (j >= labels.length ? 0 : j) + p.min); b.update(); }, { cls: 'lk-t on ' + (o.cls || ''), w: o.w });
    b.update = () => { b.textContent = labels[Math.round(get(k) - p.min)] || ''; }; b.update(); return reg(b, k); };
  const CH = (k, labels, o = {}) => { const p = def.params[k]; return reg(lvChoice(labels.map((l) => ({ label: l })), () => Math.round(get(k) - p.min), (j) => set(k, j + p.min), { cls: 'lk-ch ' + (o.v ? 'v ' : '') + (o.cls || '') }), k); };
  const S = (k, o = {}) => { const p = def.params[k], items = p.items || Array.from({ length: Math.round(p.max - p.min) + 1 }, (_, j) => fmtParam(p, p.min + j)); return reg(lvSel(() => items.map((l, j) => ({ label: l, value: j + p.min })), () => Math.round(get(k)), (v) => set(k, v), { w: o.w || 76, cls: 'lk-s ' + (o.cls || ''), show: o.short ? (v) => o.short[Math.round(v - p.min)] : null }), k); };
  const N = (k, o = {}) => reg(lvNum(def.params[k], () => get(k), (v) => set(k, v), fmtParam, { fill: o.fill !== false, w: o.w || 64, onLong: auto(k), label: def.params[k].n, cls: 'lk-n ' + (o.cls || '') }), k);
  const NT = (k, o = {}) => N(k, { ...o, fill: false, cls: 'lk-nt ' + (o.cls || '') });     // value as coloured text inside a dark display (Live: Decay 1.81 s)
  const dk = (...kids) => h('div', { class: 'lk-dk' }, ...kids.filter(Boolean));                // dark display area holding controls
  const LN = (text, el) => h('div', { class: 'lk-ln' }, h('span', {}, text), el);           // label left, control right (Live rows like "Freq [5.08 kHz]")
  const TL = (text, ...kids) => h('div', { class: 'lk-tl' }, h('span', { class: 'lk-lb' }, text), ...kids);   // title above a control
  const D = (w, hh, draw, drag) => { const c = lvDisp(w, hh, (g) => inDraw(() => draw(g, w, hh))); c.classList.add('lk-d', w * hh < 26000 ? 'lk-dsm' : 'lk-dbig'); draws.push(() => c.paint()); if (drag) lvDrag(c, drag); return c; };
  // DF: a display that fills the free room of its column (min size w x hh): draw(g, w, hh) gets the REAL size, the canvas follows its box
  const DF = (w, hh, draw, drag) => {
    const wrap = h('div', { class: 'lk-dfill', style: `min-width:${w}px;min-height:${hh}px` }), c = lvDisp(w, hh, (g, cw, ch) => inDraw(() => draw(g, cw, ch)));
    c.classList.add('lk-dfc'); wrap.append(c); wrap.paint = () => c.paint(); draws.push(() => c.paint()); if (drag) lvDrag(c, drag);
    const ro = new ResizeObserver(() => { const cw = wrap.clientWidth, ch = wrap.clientHeight; if (cw > 20 && ch > 20 && (cw !== c._w || ch !== c._h)) c.resize(cw, ch); }); ro.observe(wrap);
    return wrap;
  };
  const sec = (title, ...kids) => h('div', { class: 'lk-sec' }, title ? h('div', { class: 'lk-st' }, title) : null, ...kids.filter(Boolean));
  const row = (...kids) => h('div', { class: 'lk-row' }, ...kids.filter(Boolean));
  const col = (...kids) => h('div', { class: 'lk-col' }, ...kids.filter(Boolean));
  const sep = () => h('div', { class: 'lk-sep' });
  const every = (ms, fn) => ctx.every(ms, fn);
  const out = () => { const o = eng.devOut(i, ctx.outD != null ? ctx.outD : di); return Array.isArray(o) ? o : o ? Array.from(o) : []; };
  // a box whose content follows a parameter (Live: Sync on shows the 16th grid, off shows the time knob)
  const swap = (k, on, off) => { const box = h('div', { class: 'lk-swap' }); const fill = () => box.replaceChildren(get(k) > 0.5 ? on() : off()); fill(); draws.push(() => { const want = get(k) > 0.5; if (box._on !== want) { box._on = want; fill(); } }); box._on = get(k) > 0.5; return box; };
  // like swap, for a list parameter: fn(value) builds the content (Spectral Time: Time / Notes / 16th knob by Mode)
  const swapN = (k, fn) => { const box = h('div', { class: 'lk-swap' }); let cur = null; const fill = () => { const v = Math.round(get(k)); if (v !== cur) { cur = v; box.replaceChildren(fn(v)); } }; fill(); draws.push(fill); return box; };
  return { ctx, d, def, get, set, inDraw, K, swapN, T, CY, CH, S, N, NT, dk, LN, TL, D, DF, sec, row, col, sep, every, out, swap, redraw, reg, auto };
}
// filter (band) display with a draggable ring: x = freq, y = width (or Q); used by the delays, Beat Repeat, Erosion, Vinyl
function bandDisp(k, w, hh, kf, kw, o = {}) {
  let cur = w;
  const draw = (g, w, hh) => {
    cur = w; grid(g, w, hh);
    if (o.fill) { g.fillStyle = 'rgba(255,255,255,.05)'; for (let dec = 10; dec < 20000; dec *= 10) for (let m = 2; m < 10; m++) { const f = dec * m; if (f > 20 && f < 20000) g.fillRect(Math.round(lx(f, w)), 0, 1, hh); } g.fillStyle = DISPC.grid; for (let q = 1; q < 4; q++) g.fillRect(0, Math.round(hh * q / 4), w, 1); }   // Live's filter displays carry a fine grid
    const f = k.get(kf), wd = kw != null ? k.get(kw) : 1, on = o.on == null || k.get(o.on) > 0.5;
    const hp = new Biquad(), lp = new Biquad(), bp = new Biquad(); let fn;
    if (o.peak) { bp.bandpass(SR, f, 1 / Math.max(0.05, wd)); fn = (x) => mag(bp, x); }
    else { const kk = Math.pow(2, wd / 2); hp.highpass(SR, Math.max(20, f / kk), 0.707); lp.lowpass(SR, Math.min(20000, f * kk), 0.707); fn = (x) => mag(hp, x) * mag(lp, x); }
    const pts = []; for (let x = 0; x <= w; x += 2) { const m = fn(xl(x, w)); pts.push([x, hh - 4 - Math.min(1.4, m) / 1.4 * (hh - 10)]); }
    lvPath(g, pts, on ? DISPC.bl : DISPC.grid2, null, 2);   // Live's filter curves are a plain line (no fill)
    const peak = fn(f); lvRing(g, lx(f, w), hh - 4 - Math.min(1.4, peak) / 1.4 * (hh - 10), 4.5);
  };
  const drag = { onDown: () => ({ f: k.get(kf), w: kw != null ? k.get(kw) : 0 }),
    onMove: (x, y, dx, dy, s) => { k.set(kf, Math.max(20, Math.min(20000, s.f * Math.pow(2, dx / (cur / 10))))); if (kw != null) k.set(kw, Math.max(o.wmin || 0.5, Math.min(o.wmax || 9, s.w + dy / (o.peak ? 30 : 12)))); } };
  return o.fill ? k.DF(w, hh, draw, drag) : k.D(w, hh, draw, drag);
}

// ================================================================================================ views
const V = {};
const WT_TAB = new Map();                                   // Wavetable: the tab shown per track
// Filter Delay: three lines L / L+R / R, each: input on, filter on + display, sync grid / time, feedback, pan, volume; dry at the end
V[18] = (k) => {
  // Live: ONE grid - the column titles once on top (Input, Filter, Delay Time, Feedback, Pan, Volume) and the three lines L / L+R / R under
  // them; per line the channel and filter switches side by side over Freq and Width, the filter display, the 16th-note grid (1..16) over
  // Sync + ms, then Feedback / Pan / Volume dials without titles; Dry in the last column
  const H = (t) => h('span', { class: 'lk-fdh' }, t), cells = [H('Input'), H('Filter'), H('Delay Time'), H('Feedback'), H('Pan'), H('Volume'), H('Out')];
  // the Out meter (Live: right of the lines): two level bars fed by the engine (readOut: output peak L / R)
  let mo = [-90, -90], mt = [-90, -90], fr = 0;
  const meter = k.DF(26, 96, (g, w, hh) => { const bw = (w - 9) / 2;
    [0, 1].forEach((c) => { const x = 3 + c * (bw + 3), v = Math.max(0, Math.min(1, (mo[c] + 60) / 60)), top = 3 + (hh - 6) * (1 - v), gr = g.createLinearGradient(0, 3, 0, hh - 3);
      g.fillStyle = '#1b1b1d'; g.fillRect(x, 3, bw, hh - 6); gr.addColorStop(0, '#ff5a4d'); gr.addColorStop(0.16, '#f2d33a'); gr.addColorStop(0.32, '#5fe070'); gr.addColorStop(1, '#2ab04a'); g.fillStyle = gr; g.fillRect(x, top, bw, hh - 3 - top); }); });
  meter.style.gridRow = 'span 2'; meter.style.alignSelf = 'stretch';
  k.every(16, () => { if (fr++ % 3 === 0) { const r = k.out(); if (r.length >= 2) mt = [r[0], r[1]]; } mo = mo.map((v, c) => glide(v, mt[c])); meter.paint(); });
  ['L', 'L+R', 'R'].forEach((name, n) => { const o = n * 10;
    cells.push(k.col(k.row(k.T(o, name, { w: 34 }), k.T(o + 1, 'On', { w: 40 })), k.N(o + 2, { w: 78 }), k.N(o + 3, { w: 78 })),
      bandDisp(k, 150, 72, o + 2, o + 3, { on: o + 1 }),
      k.col(k.CH(o + 5, ['1', '2', '3', '4', '5', '6', '8', '16'], { cls: 'lk-g4' }), k.row(k.T(o + 4, 'Sync', { w: 44 }), k.N(o + 6, { w: 62 }))),
      k.K(o + 7, { n: '' }), k.K(o + 8, { n: '' }), k.K(o + 9, { n: '' }), ...(n === 0 ? [meter] : n === 2 ? [k.K(30, { n: 'Dry' })] : [])); });
  return h('div', { class: 'lk-fdg' }, ...cells);
};
// Gate: level display with the threshold and return lines, attack / hold / release / floor, flip
V[23] = (k) => {
  let lv = -80, gr = 0;
  const disp = k.DF(150, 70, (g, w, hh) => {
    const y = (db) => 4 + (Math.min(0, Math.max(-80, db)) / -80) * (hh - 8);
    g.fillStyle = '#2f5b66'; g.fillRect(8, y(lv), 18, hh - 4 - y(lv)); g.fillStyle = DISPC.bl; g.fillRect(8, y(lv), 18, 2);
    g.fillStyle = DISPC.or; g.fillRect(32, y(k.get(0)), w - 40, 2); g.fillStyle = DISPC.orD; g.fillRect(32, y(k.get(0) - k.get(1)), w - 40, 1);
    g.fillStyle = gr > -1 ? '#5fd08a' : DISPC.grid2; g.beginPath(); g.arc(w - 14, 12, 5, 0, 7); g.fill();
    label(g, k.get(0).toFixed(1) + ' dB', 34, y(k.get(0)) - 3, DISPC.or);
  }, { onDown: () => ({ t: k.get(0) }), onMove: (x, y, dx, dy, s) => k.set(0, Math.max(-80, Math.min(0, s.t - dy * 0.6))) });
  k.every(60, () => { const r = k.out(); if (r.length) { lv = r[0]; gr = r[1]; disp.paint(); } });
  return k.row(k.col(disp, k.row(k.K(0), k.K(1))), k.sep(), k.col(k.row(k.K(2), k.K(3)), k.row(k.K(4), k.K(5)), k.T(6, 'Flip')));
};
// Glue Compressor: attack / release / ratio stepped knobs, needle meter, threshold / makeup, range / soft clip / dry-wet
V[24] = (k) => {
  let grv = 0, shown = 0;
  const vu = k.D(210, 100, (g, w, hh) => {
    const cx = w / 2, cy = hh + 46, R = hh + 30;
    g.strokeStyle = DISPC.grid2; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R - 6, Math.PI * 1.28, Math.PI * 1.72); g.stroke();
    for (const [v, t] of [[0, '0'], [5, '5'], [10, '10'], [15, '15'], [20, '20']]) { const a = Math.PI * 1.28 + (v / 20) * Math.PI * 0.44; label(g, t, cx + Math.cos(a) * (R - 2), cy + Math.sin(a) * (R - 2), DISPC.ink, 9, 'center'); }
    const a = Math.PI * 1.28 + (Math.min(20, shown) / 20) * Math.PI * 0.44; g.strokeStyle = DISPC.bl; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18 - 0); g.lineTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10)); g.stroke();
  });
  k.every(40, () => { const r = k.out(); if (r.length) grv = r[0]; shown += (grv - shown) * 0.35; vu.paint(); });
  // Live: Attack / Release / Ratio are stepped dials with their steps printed round the dial (no value line); Threshold and Makeup sit inside
  // the dark VU box; Clip with a pink Soft switch on the right above Range and Dry/Wet
  const lampC = h('span', { class: 'lk-lamp' }), fC = () => lampC.classList.toggle('on', k.get(6) > 0.5); fC(); k.reg(Object.assign(lampC, { update: fC }), 6);
  const clip = h('div', { class: 'lk-gclip' }, lampC, h('span', { class: 'lk-lb' }, 'Clip'));
  const soft = k.T(6, 'Soft', { cls: 'lk-pink', w: 56 });
  return h('div', { class: 'lk-row lk-glue' }, k.col(scaleK(k, 0, ['.01', '.1', '.3', '1', '3', '10', '30']), scaleK(k, 1, ['.1', '.2', '.4', '.6', '.8', '1.2', 'A']), scaleK(k, 2, ['2', '4', '10'])),
    tn(k.dk(vu, k.row(k.K(3, { big: true }), k.K(4, { big: true }))), 'Meter'), k.sep(), k.col(clip, soft, k.K(5), k.K(7)));
};
// Channel EQ: curve display with the HP switch and the mid frequency readout, Low / Mid / High / Output
V[25] = (k) => {
  // Live: one dark display holding the analyser (grey, the track's spectrum), the EQ curve (cyan line), dB / Hz scales, and a bottom strip
  // with the HP filter switch (orange icon box) and the Mid frequency in orange
  let spec = null;
  const disp = k.D(300, 118, (g, w, hh) => {
    const B = hh - 2, yd = (db) => B / 2 - db / 14.5 * (B / 2 - 4);
    if (spec) { const pts = [[0, B]]; for (let b = 0; b < spec.length; b++) pts.push([(b + 0.5) / spec.length * w, B - Math.max(0, Math.min(1, (spec[b] + 84) / 78)) * (B - 6)]); pts.push([w, B]);
      g.fillStyle = 'rgba(150,150,156,.55)'; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const q of pts) g.lineTo(q[0], q[1]); g.closePath(); g.fill(); }
    grid(g, w, B); const b = [new Biquad(), new Biquad(), new Biquad(), new Biquad()];
    b[0].highpass(SR, 80, 0.707); b[1].lowShelf(SR, 100, 0.7, k.get(1)); b[2].peaking(SR, k.get(3), 0.9, k.get(2)); if (k.get(4) >= 0) b[3].highShelf(SR, 6000, 0.7, k.get(4)); else b[3].lowpass(SR, 20000 * Math.pow(2, k.get(4) / 3), 0.707);
    const pts = []; for (let x = 0; x <= w; x += 2) { const f = xl(x, w); let m = 1; for (let j = k.get(0) > 0.5 ? 0 : 1; j < 4; j++) m *= mag(b[j], f); pts.push([x, yd(20 * Math.log10(m + 1e-9) + k.get(5))]); }
    g.fillStyle = DISPC.grid; g.fillRect(0, Math.round(yd(0)), w, 1); lvPath(g, pts, DISPC.bl, null, 2);
    for (const [db, t] of [[12, '12'], [0, '0'], [-12, '-12']]) label(g, t, 5, yd(db) + (db === 12 ? 14 : db === -12 ? -3 : 5), DISPC.ink, 15);
    for (const [f, t] of [[100, '100'], [1000, '1k'], [10000, '10k']]) label(g, t, lx(f, w) - 8, B - 4, DISPC.ink, 15);
  }, { onDown: () => ({ f: k.get(3), g: k.get(2) }), onMove: (x, y, dx, dy, s) => { k.set(3, Math.max(120, Math.min(7500, s.f * Math.pow(2, dx / 22)))); k.set(2, Math.max(-12, Math.min(12, s.g - dy * 0.25))); } });
  // Live's analyser is smooth: each bin takes the loudest of its neighbours, then a 7-bin average across frequency and a slow fall over time
  k.every(60, () => { const r = k.out(); if (r.length < 64) return; const n = r.length, m = new Float32Array(n), a = new Float32Array(n);
    for (let b = 0; b < n; b++) m[b] = Math.max(r[Math.max(0, b - 1)], r[b], r[Math.min(n - 1, b + 1)]);
    for (let b = 0; b < n; b++) { let t = 0, c = 0; for (let j = -3; j <= 3; j++) { const q = b + j; if (q >= 0 && q < n) { t += m[q]; c++; } } a[b] = t / c; }
    sTgt = a; });
  let sTgt = null; k.every(16, () => { if (!sTgt) return; if (!spec || spec.length !== sTgt.length) spec = Float32Array.from(sTgt); else for (let b = 0; b < spec.length; b++) spec[b] = glide(spec[b], sTgt[b], 0.35, 0.08); disp.paint(); });   // fluid: the analyser glides every frame
  const ico = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); ico.setAttribute('viewBox', '0 0 24 14'); ico.setAttribute('width', '22'); ico.setAttribute('height', '13');
  ico.innerHTML = '<path d="M2 12 C 8 12, 9 3, 15 3 L 22 3" fill="none" stroke="currentColor" stroke-width="2"/>';
  const hp = k.T(0, '', { w: 34, cls: 'lk-hpi' }); hp.append(ico);
  return k.col(h('div', { class: 'lk-dk lk-ceq' }, disp, h('div', { class: 'lk-ceqs' }, hp, h('span', { class: 'lk-grow' }), k.NT(3, { w: 90, cls: 'or' }), h('span', { class: 'lk-grow' }), h('span', { style: 'width:34px' }))),
    k.row(k.K(1, { big: true }), k.K(2, { big: true }), k.K(4, { big: true }), k.sep(), k.K(5, { big: true })));
};
// Erosion (Live: Erosion Legacy): display across the top, the three modes under it, Freq / Width / Amount as value boxes in a row
V[26] = (k) => k.col(bandDisp(k, 226, 92, 1, 2, { peak: true, wmin: 0.08, wmax: 10, fill: true }), k.CH(0, ['Noise', 'Wide Noise', 'Sine'], { cls: 'spc' }),
  k.row(k.TL('Freq', k.N(1, { w: 62 })), k.TL('Width', k.N(2, { w: 62 })), k.TL('Amount', k.N(3, { w: 62 }))));
// Redux: sample-rate section (rate, jitter, pre filter) and bit section (bits, quantize, shape, DC shift), dry/wet
V[27] = (k) => k.row(k.sec('Sample Rate', k.row(k.K(0, { big: true }), k.K(1)), k.row(k.T(2, 'Pre Filter'))), k.sep(),
  k.sec('Bit Reduction', k.row(k.K(3, { big: true }), k.K(5)), k.row(k.T(4, 'Quantize'), k.T(6, 'DC Shift'))), k.sep(), k.sec(null, k.K(7)));
// Vinyl Distortion: Tracing Model and Pinch, each with display + On / drive / freq / width, pinch type and stereo mode; crackle and drive
V[28] = (k) => {
  // Live: the title line (Pinch carries Soft / Hard and Stereo / Mono on it), the display as wide as the column, then On / amount / Freq / B
  const part = (o, head) => h('div', { class: 'lk-col lk-vdp' }, head, bandDisp(k, 230, 60, o + 2, o + 3, { peak: true, on: o, wmin: 0.1, wmax: 10, fill: true }),
    k.row(k.T(o, 'On', { w: 34 }), k.N(o + 1, { w: 46 }), k.LN('Freq', k.N(o + 2, { w: 64 })), k.LN('B', k.N(o + 3, { w: 44 }))));
  return k.row(k.col(part(0, h('div', { class: 'lk-st' }, 'Tracing Model')), part(4, k.row(h('div', { class: 'lk-st' }, 'Pinch'), k.CH(9, ['Soft', 'Hard']), k.CH(8, ['Stereo', 'Mono'])))), k.sep(),
    k.col(h('div', { class: 'lk-st c' }, 'Crackle'), k.K(10, { n: 'Volume' }), k.K(11), k.K(12)));
};
// Drum Buss: drive + type, trim / comp, crunch / damp / transients, boom section with meters, output / dry-wet
V[29] = (k) => {
  // Live: framed Bass meter (orange, a darker cap = the Boom band) and Out meter (two green bars L / R) with peak lines, the output arrow at
  // the Out meter (drag it), Boom % and output dB under the meters, Dry / Wet in a strip below a line
  let bm = -80, ov = -80, pb = -80, po = -80; const po0 = k.def.params[10];
  const met = k.D(132, 150, (g, w, hh) => {
    const top = 22, bot = hh - 26, y = (db) => top + ((6 - Math.min(6, Math.max(-60, db))) / 66) * (bot - top);
    const frame = (x, ww) => { g.fillStyle = '#121214'; g.fillRect(x - 2, top - 2, ww + 4, bot - top + 4); g.strokeStyle = '#4a4a50'; g.lineWidth = 1; g.strokeRect(x - 1.5, top - 1.5, ww + 3, bot - top + 3); };
    const bar = (x, ww, v, c0, c1, glow) => { const yt = y(v); if (bot - yt < 0.5) return; const gr = g.createLinearGradient(0, yt, 0, bot); gr.addColorStop(0, c0); gr.addColorStop(1, c1);
      g.save(); g.shadowColor = glow; g.shadowBlur = 9; g.fillStyle = gr; g.fillRect(x, yt, ww, bot - yt); g.restore(); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, yt, Math.max(1, ww * 0.3), bot - yt); };   // light: glow + a highlight stripe
    frame(18, 26); bar(19, 24, bm, '#ffc35a', '#e08a12', 'rgba(255,173,50,.75)'); if (bot - y(bm) > 1) { g.fillStyle = '#a8731f'; g.fillRect(19, y(bm), 24, Math.min(10, bot - y(bm))); }
    g.fillStyle = '#ffd08a'; g.fillRect(19, Math.round(y(pb)), 24, 1.5);
    frame(70, 26); for (const x of [71, 84]) { bar(x, 11, ov, '#8af0a8', '#3fb46a', 'rgba(95,208,138,.75)'); g.fillStyle = '#b8f0c8'; g.fillRect(x, Math.round(y(po)), 11, 1.5); }
    const oy = y(k.get(10)); g.fillStyle = '#c8c8ce'; g.beginPath(); g.moveTo(100, oy); g.lineTo(110, oy - 6); g.lineTo(110, oy + 6); g.closePath(); g.fill();
    label(g, 'Bass', 31, 14, '#c8c8ce', 11, 'center'); label(g, 'Out', 83, 14, '#c8c8ce', 11, 'center');
    label(g, k.get(7) * 100 >= 0 ? (k.get(7) * 100).toFixed(1) + ' %' : '', 31, hh - 8, '#c8c8ce', 10.5, 'center'); label(g, k.get(10).toFixed(2) + ' dB', 86, hh - 8, '#c8c8ce', 10.5, 'center');
  }, { onDown: () => ({ o: k.get(10) }), onMove: (x, y, dx, dy, s) => k.set(10, Math.max(po0.min, Math.min(po0.max, s.o - dy * 0.15))) });
  let tb = -80, to = -80, fr = 0;                                            // targets from the engine; the bars glide to them every frame
  k.every(16, () => { if (fr++ % 3 === 0) { const r = k.out(); if (r.length) { tb = r[0]; to = r[1]; } } bm = glide(bm, tb); ov = glide(ov, to); pb = Math.max(pb - 0.35, bm); po = Math.max(po - 0.35, ov); met.paint(); });
  // Live Boom section: the note of the Boom frequency (tap = Force To Note: Freq to that note exactly) and the headphone = Boom Audition
  const NN2 = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], midi = () => Math.round(69 + 12 * Math.log2(k.get(8) / 440));
  const note = h('button', { class: 'lv-btn lk-pill', title: 'Force To Note' }); const nUp = () => { const m = midi(); note.textContent = NN2[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 2); }; nUp();
  note.addEventListener('click', () => { k.set(8, Math.max(30, Math.min(90, 440 * Math.pow(2, (midi() - 69) / 12)))); nUp(); }); k.reg(Object.assign(note, { update: nUp }), 8);
  const aud = k.T(12, '', { w: 26, cls: 'lk-hph' }); aud.title = 'Boom Audition'; { const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); sv.setAttribute('viewBox', '0 0 16 16'); sv.setAttribute('width', '14'); sv.setAttribute('height', '14'); sv.innerHTML = '<path d="M3 10 V8 a5 5 0 0 1 10 0 V10" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="2" y="9" width="3" height="5" rx="1" fill="currentColor"/><rect x="11" y="9" width="3" height="5" rx="1" fill="currentColor"/>'; aud.append(sv); }
  const box = h('div', { class: 'lk-dk lk-dbm' }, met, h('div', { class: 'lk-dbw' }, h('span', {}, 'Dry / Wet'), k.NT(11, { w: 54 })));
  return k.row(k.col(k.K(0), k.CH(1, ['Soft', 'Medium', 'Hard'], { v: true }), k.TL('Trim', k.N(2, { w: 62 })), k.T(3, 'Comp')), k.sep(),
    k.col(k.K(4), k.K(5), k.K(6)), k.sep(), k.col(k.K(7), k.K(8), k.TL('Decay', k.N(9, { w: 62 })), k.row(note, aud)), box);
};
// Tuner: arc meter with the cents dot, note + frequency, reference; display options: strobe / histogram and Hz / cents readout
const NN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
V[30] = (k) => {
  const ui = { strobe: false, hz: true }; let hz = 0, cl = 0, ph = 0;
  const disp = k.D(380, 172, (g, w, hh) => {
    const ref = k.get(0), midi = hz > 0 ? 69 + 12 * Math.log2(hz / ref) : 0, n = Math.round(midi), cents = hz > 0 ? (midi - n) * 100 : 0;
    const c = w * 0.37, sg = 38, R = (c * c + sg * sg) / (2 * sg), cx = w / 2, cy = 34 + R, span = Math.asin(c / R);   // Live: a wide, shallow dashed arc
    if (ui.strobe) { ph += cents * 0.02; for (let j = 0; j < 24; j++) { const x = ((j * 14 + ph * 10) % (w + 14) + w + 14) % (w + 14) - 7; g.fillStyle = hz > 0 && Math.abs(cents) < 3 ? '#5fd08a' : DISPC.or; g.fillRect(x, 26, 7, 40); } }
    else {
      g.strokeStyle = DISPC.or; g.lineWidth = 2.4; g.setLineDash([22, 7]); g.beginPath(); g.arc(cx, cy, R, Math.PI * 1.5 - span, Math.PI * 1.5 + span); g.stroke(); g.setLineDash([]);
      label(g, '0', cx, 22, DISPC.ink, 11, 'center'); label(g, '-50', cx - c - 4, 34 + sg + 16, DISPC.ink, 11, 'right'); label(g, '+50', cx + c + 4, 34 + sg + 16, DISPC.ink, 11);
      if (hz > 0) { const a = Math.PI * 1.5 + (Math.max(-50, Math.min(50, cents)) / 50) * span; g.fillStyle = Math.abs(cents) < 3 ? '#5fd08a' : DISPC.or; g.beginPath(); g.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 11, 0, 7); g.fill(); }
    }
    if (!(hz > 0)) label(g, '—', cx, hh - 22, DISPC.or, 30, 'center');
    else label(g, NN[((n % 12) + 12) % 12], cx - 34, hh - 22, DISPC.or, 30, 'right');
    label(g, hz > 0 ? (ui.hz ? hz.toFixed(1) + ' Hz' : (cents >= 0 ? '+' : '') + cents.toFixed(1) + ' ct') : '', cx - 20, hh - 22, DISPC.or, 28);
  });
  disp.classList.add('lk-hero');
  k.every(80, () => { const r = k.out(); if (r.length) { hz = r[0]; cl = r[1]; } disp.paint(); if (typeof strip !== 'undefined') strip.querySelectorAll('.lk-tico').forEach((x, q) => x.classList.toggle('on', (q === 1) === ui.strobe)); });
  const opt = (label2, key) => { const b = h('button', { class: 'lv-btn lk-t' + (ui[key] ? ' on' : ''), onclick: () => { ui[key] = !ui[key]; b.classList.toggle('on', ui[key]); disp.paint(); } }, label2); return b; };
  // Live: ONE dark display; its bottom strip holds the view icons (arc / strobe), the Strobe and Hz chips and Reference in cyan
  const ico = (svg, key, on) => { const b = h('button', { class: 'lv-btn lk-tico' + (ui.strobe === on ? ' on' : ''), 'aria-label': key, onclick: () => { ui.strobe = on; strip.querySelectorAll('.lk-tico').forEach((x, q) => x.classList.toggle('on', (q === 1) === on)); sb.classList.toggle('on', on); disp.paint(); } }); b.innerHTML = `<svg viewBox="0 0 16 10" width="16" height="10">${svg}</svg>`; return b; };
  const sb = opt('Strobe', 'strobe');
  const strip = h('div', { class: 'lk-row lk-tstrip' }, ico('<path d="M2 8 Q8 0 14 8" fill="none" stroke="currentColor" stroke-width="1.6"/>', 'arc', false), ico('<path d="M1 5h3l2-4 3 8 2-4h4" fill="none" stroke="currentColor" stroke-width="1.4"/>', 'strobe', true),
    sb, opt('Hz', 'hz'), h('span', { class: 'lk-grow' }), h('span', { class: 'lk-lb' }, 'Reference'), k.NT(0, { w: 62, cls: 'cy' }));
  return h('div', { class: 'lk-col lk-tuner' }, h('div', { class: 'lk-dk lk-tdk' }, disp, strip));
};

// ================================================================================================ redesigned originals
// Utility: Input (phase L / R, channel, width, mono, bass mono + freq) | Output (gain, balance, mute, DC)
V[0] = (k) => k.row(
  k.sec('Input', k.row(k.T(2, 'ØL', { w: 34 }), k.T(4, 'ØR', { w: 34 })), k.S(5, { w: 76 }), k.K(6), k.T(3, 'Mono', { w: 72 }), k.row(k.T(7, 'Bass Mono'), k.N(8, { w: 56 }))), k.sep(),
  k.sec('Output', k.K(0, { n: 'Gain' }), k.K(1), k.row(k.T(9, 'Mute', { w: 40 }), k.T(10, 'DC', { w: 30 }))));
// EQ Three: GainLow / GainMid / GainHi with L / M / H kill switches, FreqLow, 24 / 48, FreqHi
// EQ Three (Live): an orange lamp above each band (lit while the band is on), GainLow / Mid / Hi with L M H under them; FreqLow, the small
// 24 / 48 slope pair, FreqHi
V[2] = (k) => {
  const lamp = (on) => { const el = h('span', { class: 'lk-lamp' }); const f = () => el.classList.toggle('on', k.get(on) > 0.5); f(); k.reg(Object.assign(el, { update: f }), on); return el; };
  const band = (g, on, t) => k.col(lamp(on), k.K(g), k.T(on, t, { w: 30 }));
  return h('div', { class: 'lk-eq3' }, band(0, 6, 'L'), band(1, 7, 'M'), band(2, 8, 'H'), k.K(4), k.CH(9, ['24', '48'], { v: true, cls: 'lk-sm' }), k.K(5));   // 3 x 2 grid: FreqLow under GainLow, 24 / 48 under GainMid, FreqHi under GainHi
};
// Saturator: curve display, Drive, type, soft clip | Tone, Output, Dry/Wet
V[3] = (k) => {
  const disp = k.DF(150, 90, (g, w, hh) => {
    const d = Math.pow(10, k.get(0) / 20), t = Math.round(k.get(4)), cl = (x, a, b) => Math.max(a, Math.min(b, x));
    const fn = [(x) => Math.tanh(x * d) / Math.tanh(Math.max(d, 1)), (x) => Math.sin(cl(x * d, -1.5708, 1.5708)), (x) => { const y = x * d; return y / (1 + Math.abs(y)) * 1.5; }, (x) => { const y = cl(x * d, -1.5, 1.5); return y - y * y * y / 6.75; }, (x) => Math.sin(x * d), (x) => cl(x * d, -1, 1)][t];
    g.fillStyle = DISPC.grid; g.fillRect(0, hh / 2, w, 1); g.fillRect(w / 2, 0, 1, hh);
    const pts = []; for (let x = 0; x <= w; x += 2) { let y = fn((x / w) * 2 - 1); if (k.get(5) > 0.5) y = Math.tanh(y); pts.push([x, hh / 2 - cl(y, -1.3, 1.3) * (hh / 2 - 8)]); }
    lvPath(g, pts, DISPC.bl, null, 1.8);
  });
  return k.row(k.col(disp, k.S(4, { w: 110 }), k.T(5, 'Soft Clip')), k.sep(), k.col(k.K(0, { big: true }), k.K(3, { n: 'Tone' })), k.sep(), k.col(k.K(2), k.K(1)));
};
// Compressor: Ratio / Attack / Release (+ Auto) | transfer display with GR and Out meters, Knee / Lookahead / Env | Makeup, Peak / RMS / Expand, Output, Dry/Wet
V[4] = (k) => {
  // Live Compressor: one tall display with the input meter pair (arrow = Threshold), the transfer curve on a fine grid, the GR bar and the
  // output meter pair (arrow = Output); a strip under it with the three view buttons (collapsed / curve / activity), Knee, Look, Env.
  // Left: Ratio, Attack, Release, Auto. Right: Makeup, Peak / RMS / Expand, Dry/Wet.
  let o = [0, -80, -80], grs = 0, pi = -80, po = -80, view = 1; const hist = new Float32Array(160), hin = new Float32Array(160); let hw = 0;
  // symmetric layout, measured from both edges: [In pair + arrow] gap [curve] gap [GR] gap [Out pair + arrow]; labels centred above the
  // meters, dB values centred under them, the same margin left and right
  // Live's proportions: labels 13 px over the meters, the dB values under them, a SQUARE transfer grid right after the input meter, GR and
  // Out at the right edge; the display fills the whole middle column (DF)
  const M = 12, PW = 22, AW = 10, GW = 14, GAP = 12; let cw = 352, ch = 182;
  const geo = (w, hh = ch) => { const inX = M, outX = w - M - AW - PW, grX = outX - GAP - GW, L0 = inX + PW + AW + GAP, room = grX - GAP - L0, W0 = view === 0 ? 0 : room; return { inX, outX, grX, L0, W0 }; };
  const disp = k.DF(330, 170, (g, w, hh) => {
    cw = w; ch = hh; const T = 26, Bt = hh - 24, yd = (db) => T + ((Math.min(6, Math.max(-60, db)) - 6) / -66) * (Bt - T), { inX, outX, grX, L0, W0 } = geo(w, hh), cx = (db) => L0 + ((db + 60) / 60) * W0;
    const thr = k.get(0), ratio = Math.max(1, k.get(1)), knee = Math.max(0.01, k.get(5)), mode = Math.round(k.get(7));
    const tf = (x) => { if (mode === 2) return x < thr ? thr + (x - thr) * ratio : x; const over = x - thr, slope = 1 / ratio - 1; let r = 0; if (2 * over > knee) r = slope * over; else if (2 * over > -knee) r = slope * (over + knee / 2) * (over + knee / 2) / (2 * knee); return x + r; };
    const pair = (x, v, pk, arrowDb) => { g.fillStyle = '#121214'; g.fillRect(x, T - 1, PW, Bt - T + 2); g.fillStyle = 'rgba(255,255,255,.16)'; for (let v = 0; v >= -54; v -= 6) g.fillRect(x + PW / 2 - 0.5, Math.round(yd(v)), 1, 1); for (const xx of [x + 1, x + PW / 2 + 0.5]) { const yt = yd(v); if (Bt - yt > 0.5) { const gr = g.createLinearGradient(0, yt, 0, Bt); gr.addColorStop(0, '#8af0a8'); gr.addColorStop(1, '#3fb46a'); g.save(); g.shadowColor = 'rgba(95,208,138,.7)'; g.shadowBlur = 7; g.fillStyle = gr; g.fillRect(xx, yt, PW / 2 - 1.5, Bt - yt); g.restore(); } g.fillStyle = '#d8f8e0'; g.fillRect(xx, Math.round(yd(pk)), PW / 2 - 1.5, 1.2); }
      const ay = yd(arrowDb), ax = x + PW + 2; g.fillStyle = '#c8c8ce'; g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + AW - 2, ay - 4.5); g.lineTo(ax + AW - 2, ay + 4.5); g.closePath(); g.fill(); };
    pair(inX, o[1], pi, thr);
    if (view === 1) {                                                         // transfer curve on a 6 dB grid
      g.fillStyle = DISPC.grid; for (let v = -54; v < 0; v += 6) { g.fillRect(Math.round(cx(v)), T, 1, Bt - T); g.fillRect(L0, Math.round(yd(v)), W0, 1); }
      g.strokeStyle = DISPC.grid2; g.lineWidth = 1; g.strokeRect(L0 + 0.5, T + 0.5, W0 - 1, Bt - T - 1);
      const pts = []; for (let x = -60; x <= 0; x += 1) pts.push([cx(x), yd(tf(x))]); lvPath(g, pts, DISPC.bl, null, 1.8);
      lvRing(g, cx(thr), yd(tf(thr)), 4.5); const cur = Math.max(-60, Math.min(0, o[1])); g.fillStyle = DISPC.or; g.beginPath(); g.arc(cx(cur), yd(tf(cur)), 3, 0, 6.2832); g.fill();
    } else if (view === 2) {                                                  // activity: input level (grey) and gain reduction (orange) over time
      g.strokeStyle = DISPC.grid2; g.lineWidth = 1; g.strokeRect(L0 + 0.5, T + 0.5, W0 - 1, Bt - T - 1);
      const n = hist.length, xs = (j) => L0 + (j / (n - 1)) * W0, a = [], b = [];
      for (let j = 0; j < n; j++) { const q = (hw + j) % n; a.push([xs(j), yd(hin[q])]); b.push([xs(j), T + Math.min(Bt - T, hist[q] * (Bt - T) / 24)]); }
      lvPath(g, a, '#9a9aa2', Bt, 1.2); lvPath(g, b, DISPC.or, null, 1.6);
    }
    g.fillStyle = '#121214'; g.fillRect(grX, T - 1, GW, Bt - T + 2); g.save(); g.shadowColor = 'rgba(255,173,50,.7)'; g.shadowBlur = 7; g.fillStyle = '#ffad32'; g.fillRect(grX + 1, T, GW - 2, Math.min(Bt - T, grs * (Bt - T) / 24)); g.restore();
    pair(outX, o[2], po, k.get(4));
    const top = T - 9, mid = (x, ww) => x + ww / 2;
    label(g, 'Thresh', inX + 2, top, DISPC.ink, 13); label(g, 'GR', mid(grX, GW), top, DISPC.ink, 13, 'center'); label(g, 'Out', mid(outX, PW), top, DISPC.ink, 13, 'center');
    if (view === 2) label(g, 'Activity', mid(L0, W0), top, DISPC.ink, 13, 'center');
    label(g, thr.toFixed(1) + ' dB', inX, hh - 7, DISPC.ink, 13); label(g, k.get(4).toFixed(2) + ' dB', w - M, hh - 7, DISPC.ink, 13, 'right');
  }, { onDown: (x) => ({ x, t: k.get(0), o: k.get(4) }), onMove: (x, y, dx, dy, s) => { if (s.x > geo(cw).grX - 4) k.set(4, Math.max(k.def.params[4].min, Math.min(k.def.params[4].max, s.o - dy * 0.2))); else k.set(0, Math.max(-60, Math.min(0, s.t - dy * 0.4))); } });
  let tg = [0, -80, -80], fr = 0; k.every(16, () => { if (fr++ % 3 === 0) { const r = k.out(); if (r.length) tg = r; hist[hw] = grs; hin[hw] = o[1]; hw = (hw + 1) % hist.length; } o = [glide(o[0], tg[0]), glide(o[1], tg[1]), glide(o[2], tg[2])]; grs = glide(grs, tg[0], 0.4, 0.12); pi = Math.max(pi - 0.35, o[1]); po = Math.max(po - 0.35, o[2]); disp.paint(); });
  // the three view buttons of Live's display strip (collapsed = meters only, transfer curve, activity)
  const ICON = ['<rect x="3" y="3" width="3" height="10"/><rect x="8" y="6" width="3" height="7"/>', '<path d="M2 13 L8 7 L14 4" fill="none" stroke="currentColor" stroke-width="1.8"/>', '<path d="M1 10 L3 6 L5 11 L7 4 L9 9 L11 5 L13 10 L15 7" fill="none" stroke="currentColor" stroke-width="1.4"/>'];
  const vb = ICON.map((ic, j) => { const b = h('button', { class: 'lv-btn lk-vbtn', title: ['Collapsed', 'Transfer curve', 'Activity'][j] }); const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); sv.setAttribute('viewBox', '0 0 16 16'); sv.setAttribute('width', '14'); sv.setAttribute('height', '14'); sv.setAttribute('fill', 'currentColor'); sv.innerHTML = ic; b.append(sv);
    b.addEventListener('click', () => { view = j; vb.forEach((x, q) => x.classList.toggle('on', q === view)); disp.paint(); }); return b; });
  vb[view].classList.add('on');
  // three columns of equal height, a separator on each side of the display (mirror image)
  const r = k.row(k.col(k.K(1), k.K(2), k.K(3), k.T(11, 'Auto', { w: 62 })), k.sep(),
    h('div', { class: 'lk-dk lk-ceq lk-cmpd' }, disp, h('div', { class: 'lk-ceqs' }, ...vb, h('span', { class: 'lk-grow' }), k.LN('Knee', k.NT(5, { w: 50 })), k.LN('Look', k.S(9, { w: 54 })), k.LN('Env', k.CH(10, ['Lin', 'Log'])))), k.sep(),
    k.col(k.T(8, 'Makeup', { w: 70 }), k.CH(7, ['Peak', 'RMS', 'Expand'], { v: true }), k.K(6)));
  r.classList.add('lk-cmp'); return r;
};
// Limiter: gain reduction display | Gain, Ceiling, Release
V[5] = (k) => {
  // Live: In / GR / Out meters in one dark display, the three dials in ONE row under it (Gain, Ceiling, Release), the whole device centred
  let o = [0, -80, -80]; const W = 216, BW = 36, GAP = (W - 3 * BW) / 4;
  const disp = k.D(W, 128, (g, w, hh) => { const top = 8, bot = hh - 20, y = (db) => top + (Math.min(0, Math.max(-48, db)) / -48) * (bot - top);
    [[o[1], '#5fd08a', 'In'], [-o[0], '#ffad32', 'GR'], [o[2], '#5fd08a', 'Out']].forEach(([db, col, t], n) => { const x = Math.round(GAP + n * (BW + GAP));
      g.fillStyle = '#1b1b1d'; g.fillRect(x, top, BW, bot - top); g.fillStyle = col;
      if (t === 'GR') g.fillRect(x, top, BW, Math.min(bot - top, o[0] * (bot - top) / 24)); else g.fillRect(x, y(db), BW, bot - y(db));
      label(g, t, x + BW / 2, hh - 6, DISPC.ink, 10, 'center'); });
    const x3 = Math.round(GAP + 2 * (BW + GAP)); g.fillStyle = DISPC.or; g.fillRect(x3 - 4, y(k.get(0)), BW + 8, 2); });
  let tg = [0, -80, -80], fr = 0; k.every(16, () => { if (fr++ % 3 === 0) { const r = k.out(); if (r.length) tg = r; } o = [glide(o[0], tg[0]), glide(o[1], tg[1]), glide(o[2], tg[2])]; disp.paint(); });
  return h('div', { class: 'lk-col lk-lim' }, k.dk(disp), k.row(k.K(2, { big: true }), k.K(0, { big: true }), k.K(1, { big: true })));
};
// Reverb: Input Processing (Lo Cut / Hi Cut), Predelay, decay display, Global (Size / Damping), Freeze, Width, Dry/Wet
V[7] = (k) => {
  const disp = k.D(170, 76, (g, w, hh) => { const sz = k.get(0), dm = k.get(1), pd = k.get(3) / 100; const pts = [], x0 = 6 + pd * 30; pts.push([6, hh - 4], [x0, hh - 4]);
    for (let x = x0; x <= w - 4; x += 2) pts.push([x, 8 + (hh - 14) * (1 - Math.exp(-(x - x0) / (w * (0.08 + sz * 0.5)))) * (0.6 + dm * 0.4)]); lvPath(g, pts.map(([x, y], i) => [x, i < 2 ? y : hh - (y - 4)]), DISPC.bl, hh, 1.7);
    label(g, (0.3 + sz * 8).toFixed(1) + ' s', w - 34, 12, DISPC.or); if (k.get(5) > 0.5) label(g, 'FREEZE', 6, 12, '#4fc3f0'); },
    { onDown: () => ({ s: k.get(0) }), onMove: (x, y, dx, dy, s) => k.set(0, Math.max(0, Math.min(1, s.s + dx / 150))) });
  return k.row(k.sec('Input Processing', k.K(6), k.K(7)), k.sep(), k.sec('Early', k.K(3)), k.sep(),
    k.col(disp, k.row(k.K(0, { n: 'Size' }), k.K(1), k.T(5, 'Freeze'))), k.sep(), k.col(k.K(4, { n: 'Stereo' }), k.K(2)));
};
// EQ Eight: band knobs (selected band) | curve display with numbered rings, band cells (on + type) | Scale, Gain
// EQ Eight band shapes as Live draws them on the band buttons: low cut 48 / 12, low shelf, bell, notch, high shelf, high cut 12 / 48
const EQ8_ICO = ['M1 9 L5 2 H15', 'M1 9 Q4 2 7 2 H15', 'M1 3 H5 C7 3 8 7 10 7 H15', 'M1 8 H4 C6 8 6 2 8 2 C10 2 10 8 12 8 H15', 'M1 3 H6 L8 9 L10 3 H15', 'M1 7 H6 C8 7 9 3 11 3 H15', 'M1 2 H9 Q12 2 15 9', 'M1 2 H11 L15 9'];
V[31] = (k) => {
  let sel = 2, W = 420, H = 150, sp = { spec: null }; const ctlBox = h('div', { class: 'lk-col' });
  const yd = (db) => H / 2 - db / 15 * (H / 2 - 8), dy = (y) => (H / 2 - y) / (H / 2 - 8) * 15;
  const disp = k.DF(420, 150, (g, w, hh) => {
    W = w; H = hh; specFill(g, sp.spec, W, H, 8, H); grid(g, W, H);
    g.fillStyle = 'rgba(255,255,255,.045)'; for (let dec = 10; dec < 10000; dec *= 10) for (let m = 2; m < 10; m++) { const f = dec * m; if (f > 20 && f < 20000) g.fillRect(Math.round(lx(f, W)), 0, 1, H); }   // Live: a fine log grid
    g.fillStyle = DISPC.grid; for (const v of [-12, -6, 0, 6, 12]) g.fillRect(0, Math.round(yd(v)), W, 1); for (const v of [12, 6, 0, -6, -12]) label(g, String(v), 5, yd(v) - 3, DISPC.ink, 10);
    for (const [f, t] of [[100, '100'], [1000, '1k'], [10000, '10k']]) label(g, t, lx(f, W) + 3, H - 4, DISPC.ink, 10);
    const sc = k.get(40), st = []; for (let b = 0; b < 8; b++) if (k.get(b * 5) > 0.5) st.push(...eq8Stages(SR, Math.round(k.get(b * 5 + 1)), k.get(b * 5 + 2), k.get(b * 5 + 3) * sc, k.get(b * 5 + 4)));
    const pts = []; for (let x = 0; x <= W; x += 2) { let m = 1; const f = xl(x, W); for (const b of st) m *= mag(b, f); pts.push([x, yd(20 * Math.log10(m + 1e-9) + k.get(41))]); }
    lvPath(g, pts, DISPC.bl, H / 2, 1.8);
    for (let b = 0; b < 8; b++) { const on = k.get(b * 5) > 0.5, t = Math.round(k.get(b * 5 + 1)), gy = t === 2 || t === 3 || t === 5 ? yd(k.get(b * 5 + 3) * sc) : H / 2; g.globalAlpha = !on ? 0.3 : b === sel ? 1 : 0.8; lvRing(g, Math.max(10, Math.min(W - 10, lx(k.get(b * 5 + 2), W))), gy, 9); label(g, String(b + 1), Math.max(10, Math.min(W - 10, lx(k.get(b * 5 + 2), W))), gy + 3.5, DISPC.or, 10, 'center'); g.globalAlpha = 1; }
  }, { onDown: (x, y) => { let best = sel, bd = 1e9; for (let b = 0; b < 8; b++) { const dd = Math.abs(lx(k.get(b * 5 + 2), W) - x) + Math.abs(yd(k.get(b * 5 + 3)) - y) * 0.5; if (dd < bd) { bd = dd; best = b; } } if (best !== sel) { sel = best; fillCtl(); } return { f: k.get(sel * 5 + 2), g: k.get(sel * 5 + 3) }; },
    onMove: (x, y, ddx, ddy, s) => { k.set(sel * 5 + 2, Math.max(10, Math.min(22000, s.f * Math.pow(2, ddx / (W / 10))))); k.set(sel * 5 + 3, Math.max(-15, Math.min(15, s.g - ddy * 15 / (H / 2 - 8)))); } });
  sp = specFeed(k, 0, () => disp.paint());
  function fillCtl() { ctlBox.replaceChildren(k.K(sel * 5 + 2, { n: 'Freq' }), k.K(sel * 5 + 3, { n: 'Gain' }), k.K(sel * 5 + 4, { n: 'Q' })); disp.paint(); }
  fillCtl();
  // Live: under the display one cell per band - the filter-shape icon with its menu arrow, then the band's on box and number
  const cells = h('div', { class: 'lk-eq8' }, ...Array.from({ length: 8 }, (_, b) => {
    const j = b * 5 + 1, ib = h('button', { class: 'lv-btn lk-eqico', 'aria-label': 'Band ' + (b + 1) + ' type' });
    const paint = () => { ib.innerHTML = `<svg viewBox="0 0 16 10" width="20" height="12"><path d="${EQ8_ICO[Math.round(k.get(j))]}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg><i class="tri"></i>`; };
    paint(); k.reg(Object.assign(ib, { update: paint }), j);
    ib.onclick = () => { const r = ib.getBoundingClientRect(); menu(DEVICES[31].params[j].items.map((o, q) => ({ label: o, check: q === Math.round(k.get(j)), fn: () => k.set(j, q) })), r.left, r.bottom + 1); };
    const c = h('div', { class: 'lk-cell' }, ib, k.T(b * 5, String(b + 1), { cls: 'lk-eqon', w: 34 })); c.addEventListener('pointerdown', () => { if (sel !== b) { sel = b; fillCtl(); } }, true); return c; }));
  return k.row(ctlBox, k.sep(), k.col(disp, cells), k.sep(), h('div', { class: 'lk-col lk-eqr' }, k.TL('Scale', k.N(40, { w: 64 })), k.TL('Gain', k.N(41, { w: 64 }))));
};
// Spectrum: Block / Channel / Avg / Graph / Max / Scale X / Auto | spectrum display (L+R or one channel, bins or line, peak hold)
V[32] = (k) => {
  let sp = null, mx = null; const W = 380, H = 232;
  const disp = k.D(W, H, (g) => {
    const lin = Math.round(k.get(5)) === 0, auto = k.get(6) > 0.5; let lo = -120, hi = 0;
    if (sp && auto) { let a = -200, b = 0; for (const v of sp) { if (v > a) a = v; } hi = Math.min(0, Math.ceil(a / 6) * 6 + 6); lo = hi - 72; }
    const yd = (db) => 4 + (hi - Math.max(lo, Math.min(hi, db))) / (hi - lo) * (H - 18), N = sp ? sp.length : 256;
    g.fillStyle = DISPC.grid; for (let d = Math.ceil(lo / 12) * 12; d <= hi; d += 12) { g.fillRect(0, Math.round(yd(d)), W, 1); label(g, String(d), 3, yd(d) - 2, DISPC.ink, 14); }
    const st = Math.round(k.get(5)) === 2;
    if (st) for (let o = 1; o <= 9; o++) { const f = 32.703 * Math.pow(2, o - 1), x = Math.log(f / 20) / Math.log(1000) * W; g.fillRect(Math.round(x), 0, 1, H - 12); label(g, 'C' + o, x + 2, H - 2, DISPC.ink, 8); }
    else if (!lin) for (const f of [100, 1000, 10000]) { const x = Math.log(f / 20) / Math.log(1000) * W; g.fillRect(Math.round(x), 0, 1, H - 12); label(g, f >= 1000 ? f / 1000 + 'k' : String(f), x - 8, 16, DISPC.ink, 15); }
    else for (const f of [5000, 10000, 15000, 20000]) { const x = f / (SR / 2) * W; g.fillRect(Math.round(x), 0, 1, H - 12); label(g, f / 1000 + 'k', x + 2, H - 2, DISPC.ink, 8); }
    if (!sp) return;
    if (Math.round(k.get(3)) === 1) { g.fillStyle = 'rgba(79,195,240,.85)'; for (let b = 0; b < N; b++) { const x = b / N * W, y = yd(sp[b]); g.fillRect(x, y, Math.max(1, W / N - 0.5), H - 12 - y); } }
    else lvPath(g, Array.from(sp, (v, b) => [b / (N - 1) * W, yd(v)]), DISPC.bl, H - 12, 1.4);
    if (k.get(4) > 0.5 && mx) lvPath(g, Array.from(mx, (v, b) => [b / (N - 1) * W, yd(v)]), DISPC.or, null, 1);
  });
  disp.classList.add('lk-hero');
  k.every(60, () => { const r = k.out(); if (r.length) { sp = r; if (k.get(4) > 0.5) { mx = mx && mx.length === r.length ? mx.map((v, j) => Math.max(v - 0.15, r[j])) : r.slice(); } else mx = null; disp.paint(); } });
  // Live: a compact settings column in groups split by thin rules (Block / Channel | Avg | Graph + Max, Scale X, Auto) and the analyser filling the rest
  const hr = () => h('div', { class: 'lk-hr' });
  return k.row(h('div', { class: 'lk-col lk-spl' }, k.LN('Block', k.S(0, { w: 76 })), hr(), k.LN('Channel', k.CH(1, ['L', 'R', 'L+R'])), hr(), k.LN('Avg', k.N(2, { w: 60 })), hr(),
    k.LN('Graph', k.row(k.CH(3, ['Line', 'Bins']), k.T(4, 'Max', { w: 40 }))), k.LN('Scale X', k.CH(5, ['Lin', 'Log', 'ST'])), k.row(k.T(6, 'Auto', { w: 48 }))), disp);
};

// ================================================================================================ Live 12 set, part 2 (engine: js/engine/fx4.js)
const rrect = (g, x, y, w, hh, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, hh, r); else g.rect(x, y, w, hh); };
const ico = (d) => { const s = h('span', { class: 'lk-ico' }); s.innerHTML = `<svg viewBox="0 0 24 12" width="24" height="12"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`; return s; };
const ICO = { lp: 'M2 3H13Q18 3 22 11', bp: 'M2 11Q7 2 12 2Q17 2 22 11', hp: 'M2 11Q6 3 11 3H22', no: 'M2 3H8Q12 3 12 11Q12 3 16 3H22' };
const ORK = '#f08a24', AMPN = ['Clean', 'Boost', 'Blues', 'Rock', 'Lead', 'Heavy', 'Bass'];
// Amp: amp-head picture with the model name in script, model buttons, Gain / Bass / Middle / Treble / Presence (orange dials) | Output Mono, Volume, Dry/Wet
V[33] = (k) => {
  const pic = k.D(262, 86, (g, w, hh) => {
    g.fillStyle = '#1b1c21'; rrect(g, 0, 0, w, hh, 7); g.fill();
    g.strokeStyle = '#9a9ca3'; g.fillStyle = '#9a9ca3'; g.lineWidth = 1.3; rrect(g, 10, 8, w - 20, hh - 15, 3); g.stroke();
    g.beginPath(); g.moveTo(10, 25); g.lineTo(w - 10, 25); for (const x of [66, 152]) { g.moveTo(x, 8); g.lineTo(x, 25); } g.stroke();
    g.beginPath(); g.arc(18, 16.5, 2.2, 0, 7); g.stroke();
    for (const x of [29, 41, 53, 77, 90, 103, 116, 129, 163, 176, 189, 202]) { g.beginPath(); g.arc(x, 16.5, 4, 0, 7); g.fill(); }
    g.beginPath(); g.arc(w - 24, 16.5, 4.5, 0, 7); g.lineWidth = 2; g.stroke();
    g.fillStyle = '#6b6d74'; for (let y = 29; y < hh - 9; y += 3) g.fillRect(13, y, w - 26, 1); for (let x = 13; x < w - 13; x += 4) g.fillRect(x, 28, 1, hh - 37);
    g.save(); g.translate(22, 55); g.rotate(-0.16); g.font = 'italic 700 27px "Brush Script MT","Segoe Script","Snell Roundhand",cursive'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const t = AMPN[Math.round(k.get(0))]; g.lineWidth = 6; g.strokeStyle = '#1b1c21'; g.strokeText(t, 0, 0); g.lineWidth = 1.4; g.strokeStyle = '#c9cbd1'; g.strokeText(t, 0, 0); g.restore();
  });
  pic.style.zoom = '1.45';   // Live: the amp picture fills the width of the device
  const O = (j) => k.K(j, { col: ORK });
  return k.row(k.col(pic, k.CH(0, AMPN, { cls: 'spc' }), k.row(O(1), O(2), O(3), O(4), O(5))), k.sep(),
    k.col(k.TL('Output', k.T(7, 'Mono', { inv: true })), h('span', { class: 'lk-grow' }), O(6), O(8)));
};
// Cabinet: cabinet picture (speakers of the chosen model, the microphone ring at its position: tap / drag to move it) | microphone, position | Output Mono, Dry/Wet
V[34] = (k) => {
  let W = 200, H = 96; const MX = [0.5, 0.78, 1.1];
  const pic = k.DF(W, H, (g, w, hh) => {
    W = w; H = hh;
    const ty = Math.round(k.get(0)), cw = ty === 0 ? 70 : ty === 1 ? 116 : 104, ch = ty < 2 ? 70 : 84, x0 = 14, y0 = (H - ch) / 2;
    g.fillStyle = '#1b1c21'; g.strokeStyle = '#9a9ca3'; g.lineWidth = 1.3; rrect(g, x0, y0, cw, ch, 4); g.fill(); g.stroke();
    const n = [1, 2, 4, 4][ty], cols = n === 1 ? 1 : 2, rows = n === 4 ? 2 : 1, r = ty === 3 ? 17 : ty === 0 ? 27 : ty === 1 ? 25 : 19, sp = [];
    for (let j = 0; j < n; j++) { const cx = x0 + cw * ((j % cols) + 0.5) / cols, cy = y0 + ch * (Math.floor(j / cols) + 0.5) / rows; sp.push([cx, cy]); g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); g.beginPath(); g.arc(cx, cy, r * 0.32, 0, 7); g.stroke(); }
    const pos = Math.round(k.get(2)), [sx, sy] = sp[0], mx = pos === 0 ? sx : pos === 1 ? sx + r * 0.75 : x0 + cw + 36, my = sy;
    g.strokeStyle = DISPC.ink; g.lineWidth = 1; g.beginPath(); g.moveTo(mx + 6, my); g.lineTo(W - 8, my); g.stroke();
    lvRing(g, mx, my, 6); label(g, ['Near On-Axis', 'Near Off-Axis', 'Far'][pos], W - 6, H - 6, DISPC.or, 9, 'right');
    label(g, k.get(1) > 0.5 ? 'Dynamic' : 'Condenser', W - 6, 13, DISPC.ink, 9, 'right'); void MX;
  }, { onDown: (x) => { const ty = Math.round(k.get(0)), cw = ty === 0 ? 70 : ty === 1 ? 116 : 104, sx = 14 + cw / (ty === 0 ? 2 : 4); const p = x > 14 + cw + 8 ? 2 : Math.abs(x - sx) < 10 ? 0 : 1; if (p !== Math.round(k.get(2))) k.set(2, p); return {}; }, onMove: () => {} });
  return k.row(k.col(pic, k.CH(0, ['1x12', '2x12', '4x12', '4x10 Bass'], { cls: 'spc' })), k.sep(),
    k.col(k.TL('Microphone', k.CH(1, ['Condenser', 'Dynamic'], { v: true })), k.TL('Position', k.CH(2, ['Near On-Axis', 'Near Off-Axis', 'Far'], { v: true }))), k.sep(),
    k.col(k.TL('Output', k.T(3, 'Mono', { inv: true })), h('span', { class: 'lk-grow' }), k.K(4)));
};
// Overdrive: band-pass display (drag: x = Freq, y = Width), Freq / Width boxes | Drive, Tone | Dynamics, Dry/Wet
V[35] = (k) => k.row(k.col(bandDisp(k, 190, 72, 0, 1, { wmin: 0.5, wmax: 9, fill: true }), k.row(k.LN('Freq', k.N(0, { w: 70 })), k.LN('Width', k.N(1, { w: 50 })))), k.sep(),
  k.col(k.K(2, { big: true }), k.K(3)), k.sep(), k.col(k.K(4), k.K(5)));
// Pedal: OD / Distort / Fuzz, Gain, Output | Bass / Mid / Treble with the Mid frequency switch | Sub, Dry/Wet
V[36] = (k) => k.row(k.col(k.CH(0, ['OD', 'Distort', 'Fuzz'], { v: true }), k.K(2)), k.col(k.K(1, { big: true })), k.sep(),
  k.col(k.row(k.K(3), k.K(4), k.K(5)), k.TL('Mid Freq', k.CH(6, ['Low', 'Mid', 'High']))), k.sep(), k.col(k.T(7, 'Sub'), h('span', { class: 'lk-grow' }), k.K(8)));
// Dynamic Tube: tube curve (drag: x = Bias, y = Drive), tube A / B / C | Drive, Bias | Envelope, Attack, Release | Tone, Output, Dry/Wet
V[37] = (k) => {
  const disp = k.DF(150, 86, (g, w, hh) => {
    const dv = Math.pow(10, k.get(0) / 20) * 2, bias = (k.get(1) - 0.5) * [0.4, 0.8, 1.4][Math.round(k.get(3))];
    g.fillStyle = DISPC.grid; g.fillRect(0, hh / 2, w, 1); g.fillRect(w / 2, 0, 1, hh);
    const fn = (x) => { const y = x * dv + bias; return Math.tanh(y) - Math.tanh(bias); }, pts = [];
    for (let x = 0; x <= w; x += 2) pts.push([x, hh / 2 - Math.max(-1.2, Math.min(1.2, fn((x / w) * 2 - 1))) / 1.2 * (hh / 2 - 6)]);
    lvPath(g, pts, DISPC.bl, null, 1.8); lvRing(g, w / 2 + (k.get(1) - 0.5) * (w - 20), hh / 2 - (k.get(0) + 12) / 36 * (hh / 2 - 8), 4.5);
  }, { onDown: () => ({ b: k.get(1), d: k.get(0) }), onMove: (x, y, dx, dy, s) => { k.set(1, Math.max(0, Math.min(1, s.b + dx / 130))); k.set(0, Math.max(-12, Math.min(24, s.d - dy * 0.4))); } });
  return k.row(k.col(disp, k.TL('Tube', k.CH(3, ['A', 'B', 'C']))), k.sep(), k.col(k.K(0, { big: true }), k.K(1)), k.sep(),
    k.col(k.K(2), k.row(k.K(5), k.K(6))), k.sep(), k.col(k.K(4), k.row(k.K(7), k.K(8))));
};
// Multiband Dynamics: Split Freq (band on, solo, crossover boxes) | Input | level display with the Below / Above ranges (drag the edges) | Att/Rel, Below or
// Above readouts (T / B / A) | band Output | global Output, Time, Amount; Soft Knee, RMS
V[38] = (k) => {
  const BO = (b) => 2 + b * 9, ROWS = [2, 1, 0], W = 266, RH = 50, H = RH * 3 + 18, lv = [-90, -90, -90], gr = [0, 0, 0];
  let view = 0; const xd = (db) => 8 + (Math.max(-80, Math.min(0, db)) + 80) / 80 * (W - 16), dx2db = (dx) => dx / (W - 16) * 80;
  const disp = k.D(W, H, (g) => {
    for (let d = -80; d <= 0; d += 10) { g.fillStyle = DISPC.grid; g.fillRect(Math.round(xd(d)), 0, 1, H - 16); label(g, String(-d), xd(d), H - 4, DISPC.ink, 9, 'center'); }
    ROWS.forEach((b, r) => {
      const o = BO(b), y0 = r * RH + 4, on = k.get(o) > 0.5, xa = xd(k.get(o + 3)), xb = xd(k.get(o + 5));
      g.fillStyle = 'rgba(115,70,60,.45)'; g.fillRect(xa, y0, W - 8 - xa, RH - 8); g.fillStyle = 'rgba(60,90,120,.35)'; g.fillRect(8, y0, xb - 8, RH - 8);
      g.fillStyle = DISPC.grid2; g.fillRect(xa, y0, 1, RH - 8); g.fillRect(xb, y0, 1, RH - 8);
      const x1 = xd(lv[b]); g.fillStyle = on ? DISPC.bl : DISPC.grid2; g.fillRect(8, y0 + 14, Math.max(0, x1 - 8), 9);
      if (on && Math.abs(gr[b]) > 0.05) { g.fillStyle = DISPC.or; g.fillRect(Math.round(xd(lv[b] + gr[b])), y0 + 11, 2, 15); }
      label(g, on ? (gr[b] > 0 ? '+' : '') + gr[b].toFixed(1) : '', 12, y0 + 37, DISPC.bl, 10);
    });
  }, { onDown: (x, y) => { const b = ROWS[Math.max(0, Math.min(2, Math.floor(y / RH)))], o = BO(b), ka = Math.abs(x - xd(k.get(o + 3))) < Math.abs(x - xd(k.get(o + 5))) ? o + 3 : o + 5; return { k: ka, v: k.get(ka) }; },
    onMove: (x, y, dx, dy, s) => { const p = k.def.params[s.k]; k.set(s.k, Math.max(p.min, Math.min(p.max, s.v + dx2db(dx)))); } });
  k.every(50, () => { const r = k.out(); if (r.length >= 6) { for (let b = 0; b < 3; b++) { lv[b] = r[b * 2]; gr[b] = r[b * 2 + 1]; } disp.paint(); } });
  const cell = (...kids) => h('div', { class: 'lk-mbr' }, ...kids.filter(Boolean));
  const split = k.col(h('div', { class: 'lk-st c' }, 'Split Freq'), ...ROWS.map((b) => cell(k.col(k.row(h('span', { class: 'lk-lb' }, ['Low', 'Mid', 'High'][b]), k.T(BO(b), '⏻', { w: 22 }), k.T(34 + b, 'S', { w: 22 })),
    b === 2 ? k.N(1, { w: 66 }) : b === 0 ? k.N(0, { w: 66 }) : null))), k.T(32, 'Soft Knee'));
  const input = k.col(h('div', { class: 'lk-st c' }, 'Input'), ...ROWS.map((b) => cell(k.K(BO(b) + 1, { n: '' }))), k.T(33, 'RMS'));
  const rdBox = k.col(), TBA = [[7, 8, 'Att/Rel'], [5, 6, 'Below'], [3, 4, 'Above']];
  const fillRd = () => rdBox.replaceChildren(h('div', { class: 'lk-st c' }, TBA[view][2]), ...ROWS.map((b) => cell(k.col(k.NT(BO(b) + TBA[view][0], { w: 62 }), k.NT(BO(b) + TBA[view][1], { w: 62 })))));
  fillRd();
  const vb = lvChoice(['T', 'B', 'A'].map((l) => ({ label: l, title: TBA[['T', 'B', 'A'].indexOf(l)][2] })), () => view, (j) => { view = j; fillRd(); }, { cls: 'lk-ch lk-tba' });
  const outs = k.col(h('div', { class: 'lk-st c' }, 'Output'), ...ROWS.map((b) => cell(k.K(BO(b) + 2, { n: '' }))));
  // Live: the band bars and the Att/Rel (Below / Above) readouts share ONE dark box, the T / B / A view switch in its bottom-right corner
  return k.row(split, input, h('div', { class: 'lk-dk lk-mbdk' }, disp, h('div', { class: 'lk-col lk-mbrd' }, rdBox, vb)), outs, k.sep(), k.col(k.K(31), k.K(30), k.K(29)));
};
// Resonators: Filter (on, frequency, type) | Mode, Decay, Const, Color | I (note) and II-V (pitch): on, pitch, fine, gain | Width, Gain, Dry/Wet
V[39] = (k) => {
  const res = (n, o, first) => k.col(h('div', { class: 'lk-st' }, n), k.T(o, 'On'), k.K(o + 1, { n: first ? 'Note' : 'Pitch' }), k.N(o + 2, { w: 44, fill: false }), k.K(o + 3, { n: 'Gain' }));
  const ft = k.reg(lvChoice([ICO.lp, ICO.bp, ICO.hp, ICO.no].map((d, j) => ({ label: ico(d), title: ['LP', 'BP', 'HP', 'Notch'][j] })), () => Math.round(k.get(2)), (j) => k.set(2, j), { cls: 'lk-ch v lk-icoch' }), 2);
  return k.row(k.col(h('div', { class: 'lk-st c' }, 'Filter'), k.T(0, 'On'), k.K(1), ft), k.sep(),
    k.col(h('div', { class: 'lk-st' }, 'Mode'), k.CY(3, ['A', 'B'], { w: 30 }), k.K(4), k.T(5, 'Const'), k.K(6)),
    res('I', 7, true), res('II', 11), res('III', 15), res('IV', 19), res('V', 23), k.col(k.K(27), k.K(28), k.K(29)));
};
// Corpus: dark section (resonator type + quality, picture with the Hit ring, Decay / Material, Width / Pos. L / Pos. R), Bright / Inharm / Ratio / Hit |
// Tune with note readout, Fine, Spread | LFO (amount, shape, rate Hz or synced, phase, offset) | Filter (freq, bandwidth) | Bleed, Gain, Dry/Wet
const NN12 = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
V[40] = (k) => {
  const W = 196, H = 92;
  const pic = k.D(W, H, (g) => {
    const t = Math.round(k.get(0)), hx = 0.15 + k.get(7) * 0.7; g.strokeStyle = '#a9abb2'; g.lineWidth = 1.3; g.lineJoin = 'round';
    const iso = (pts) => { g.beginPath(); pts.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke(); };
    const cx = W / 2, cy = H / 2 + 8; let ring = [cx, cy - 26];
    if (t === 2) { g.beginPath(); g.moveTo(30, cy + 10); g.lineTo(W - 30, cy - 10); g.stroke(); ring = [30 + (W - 60) * hx, cy + 10 - 20 * hx]; }
    else if (t === 5 || t === 6) { g.beginPath(); g.ellipse(cx - 40, cy, 8, 16, 0, 0, 7); g.stroke(); g.beginPath(); g.moveTo(cx - 40, cy - 16); g.lineTo(cx + 40, cy - 16); g.moveTo(cx - 40, cy + 16); g.lineTo(cx + 40, cy + 16); g.stroke(); g.beginPath(); g.ellipse(cx + 40, cy, 8, 16, 0, -Math.PI / 2, Math.PI / 2); g.stroke(); if (t === 5) { g.beginPath(); g.ellipse(cx + 40, cy, 8, 16, 0, Math.PI / 2, Math.PI * 1.5); g.stroke(); } ring = [cx - 40 + 80 * hx, cy - 26]; }
    else { const L = t === 3 ? 28 : t === 4 ? 40 : 46, D = t === 3 ? 22 : t === 4 ? 26 : 9, T = t === 3 ? 12 : t === 4 ? 3 : 7;
      iso([[cx - L, cy], [cx, cy - D], [cx + L, cy], [cx, cy + D]]); iso([[cx - L, cy], [cx - L, cy + T], [cx, cy + D + T], [cx, cy + D]]); iso([[cx, cy + D], [cx, cy + D + T], [cx + L, cy + T], [cx + L, cy]]);
      if (t === 1) for (const f of [-0.5, 0, 0.5]) { g.beginPath(); g.moveTo(cx + f * L, cy + D * (1 - Math.abs(f)) + T); g.lineTo(cx + f * L, cy + D * (1 - Math.abs(f)) + T + 14); g.stroke(); }
      if (t === 3) for (let j = 1; j < 4; j++) { g.beginPath(); for (let x = 0; x <= 1.001; x += 0.1) { const px = cx - L + j * L / 4 + x * L, py = cy - D + j * D / 4 + x * D + Math.sin(x * 9) * 1.5; x ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); }
      ring = [cx - L * 0.6 + L * 1.2 * hx, cy - D * 0.4 - 18]; }
    lvRing(g, ring[0], ring[1], 6);
  }, { onDown: () => ({ v: k.get(7) }), onMove: (x, y, dx, dy, s) => k.set(7, Math.max(0, Math.min(1, s.v + dx / 140))) });
  const note = h('div', { class: 'lk-note' }); const nfill = () => { const m = 69 + 12 * Math.log2(k.get(11) * Math.pow(2, k.get(12) / 1200) / 440), n = Math.round(m); note.textContent = `${NN12[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}   ${Math.round((m - n) * 100)} ct`; };
  note.update = nfill; note._k = -1; nfill(); k.reg(note, -1);
  const dark = k.dk(k.row(k.S(0, { w: 104 }), k.S(1, { w: 64 })), k.row(k.col(pic, k.row(k.LN('Decay', k.NT(2, { w: 54 })), k.LN('Material', k.NT(3, { w: 46 })))),
    k.col(k.TL('Width', k.NT(8, { w: 52 })), k.TL('Pos. L', k.NT(9, { w: 52 })), k.TL('Pos. R', k.NT(10, { w: 52 })))));
  return k.row(k.col(dark, k.row(k.K(4), k.K(5), k.K(6), k.K(7))), k.sep(),
    k.col(k.K(11), note, k.K(12), k.TL('Spread', k.N(13, { w: 74 }))), k.sep(),
    h('div', { class: 'lk-col lk-clfo' }, k.T(14, 'LFO', { cls: 'lk-chkl' }), h('div', { class: 'lk-clg' }, k.K(15, { n: 'Amount' }), k.TL('Shape', k.S(23, { w: 66 })),
      k.swap(24, () => k.K(25, { n: 'Rate' }), () => k.K(16, { n: 'Rate' })), k.CH(24, ['Hz', '♪'], { v: true, cls: 'sm' }), k.K(26, { n: 'Phase' }), k.K(27, { n: 'Offset' }))), k.sep(),
    k.col(k.T(17, 'Filter', { cls: 'lk-chkl' }), h('span', { class: 'lk-grow' }), k.K(18), k.K(19)), k.sep(), k.col(k.K(20), k.K(21), k.K(22)));
};
// Vocoder: Carrier + Enhance, carrier XY pad (Noise: x = rate, y = crackle), Unvoiced / Sens. / Fast | band display (live band levels, dashed Level line;
// drag = Level) with Bands / Range / BW + Precise / Gate / Level | Depth, Attack, Release | Mono / Stereo / L/R, Formant, Dry/Wet
V[41] = (k) => {
  let lv = [];
  const xy = k.D(116, 76, (g, w, hh) => {
    if (Math.round(k.get(0)) !== 0) { label(g, ['', 'Modulator', 'Pitch Tracking'][Math.round(k.get(0))], w / 2, hh / 2 + 3, DISPC.ink, 9, 'center'); return; }
    g.fillStyle = DISPC.grid; g.fillRect(0, hh - 12, w, 12); label(g, 'Rate', 3, hh - 3, DISPC.ink, 8); label(g, 'Crackle', w - 3, hh - 3, DISPC.ink, 8, 'right');
    lvRing(g, 6 + k.get(18) * (w - 12), 6 + (1 - k.get(19)) * (hh - 24), 5.5);
  }, { onDown: () => (Math.round(k.get(0)) === 0 ? { r: k.get(18), c: k.get(19) } : false), onMove: (x, y, dx, dy, s) => { k.set(18, Math.max(0, Math.min(1, s.r + dx / 104))); k.set(19, Math.max(0, Math.min(1, s.c - dy / 52))); } });
  let W = 250, H = 110;
  const bands = k.DF(W, H, (g, w, hh) => {
    W = w; H = hh;
    const n = lv.length || [4, 8, 12, 16, 20, 24, 32, 40][Math.round(k.get(5))], bw = (W - 20) / n, ly = 8 + (-k.get(10) / 36 + 12 / 36) * (H - 20) * 0.5;
    g.strokeStyle = DISPC.bl; g.lineWidth = 1.5; g.beginPath(); g.moveTo(4, 12); g.lineTo(4, 4); g.lineTo(12, 4); g.moveTo(W - 12, 4); g.lineTo(W - 4, 4); g.lineTo(W - 4, 12); g.moveTo(4, H - 12); g.lineTo(4, H - 4); g.lineTo(12, H - 4); g.moveTo(W - 12, H - 4); g.lineTo(W - 4, H - 4); g.lineTo(W - 4, H - 12); g.stroke();
    g.fillStyle = DISPC.bl; for (let b = 0; b < n; b++) { const v = lv[b] == null ? -90 : lv[b], y = 14 + (1 - Math.max(0, Math.min(1, (v + 60) / 60))) * (H - 22); g.fillRect(10 + b * bw + 1, y, Math.max(1, bw - 3), H - 8 - y); }
    g.strokeStyle = DISPC.or; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(10, ly); g.lineTo(W - 10, ly); g.stroke(); g.setLineDash([]);
  }, { onDown: () => ({ v: k.get(10) }), onMove: (x, y, dx, dy, s) => k.set(10, Math.max(-24, Math.min(12, s.v - dy * 0.3))) });
  k.every(60, () => { const r = k.out(); if (r.length) { lv = r; bands.paint(); } });
  return k.row(
    k.col(k.row(h('span', { class: 'lk-st' }, 'Carrier'), k.T(1, 'Enhance')), k.S(0, { w: 116 }), xy, k.row(k.K(2), k.col(k.TL('Sens.', k.N(3, { w: 54 })), k.T(4, 'Fast')))), k.sep(),
    k.dk(bands, k.row(k.TL('Bands', k.S(5, { w: 44, cls: 'dk' })), k.TL('Range', k.NT(7, { w: 62 }), k.NT(6, { w: 62 })), k.TL('BW', k.NT(8, { w: 48 }), k.T(11, 'Precise')), k.TL('Gate', k.NT(9, { w: 54, cls: 'or' })), k.TL('Level', k.NT(10, { w: 50, cls: 'or' })))),
    k.col(k.K(12), k.K(13), k.K(14)), k.col(k.CH(15, ['Mono', 'Stereo', 'L/R'], { v: true }), k.K(16), k.K(17)));
};
// Shifter: Pitch / Freq / Ring, shift display (input line, shifted lines), Pitch or Freq, Fine, Window | Spread, Feedback | Tone, Dry/Wet
V[42] = (k) => {
  const disp = k.DF(206, 62, (g, w, hh) => {
    grid(g, w, hh); const m = Math.round(k.get(0)), f0 = 440, x0 = lx(f0, w);
    const fs = m === 0 ? [f0 * Math.pow(2, (k.get(1) + k.get(2) / 100) / 12)] : m === 1 ? [f0 + k.get(3)] : [Math.abs(f0 - k.get(3)), f0 + k.get(3)];
    g.fillStyle = DISPC.grid2; g.fillRect(Math.round(x0), 8, 2, hh - 16);
    for (const f of fs) { const x = lx(Math.max(20, Math.min(20000, f)), w); g.fillStyle = DISPC.bl; g.fillRect(Math.round(x), 8, 2, hh - 16); g.strokeStyle = DISPC.or; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, hh / 2); g.lineTo(x, hh / 2); g.stroke(); lvRing(g, x, hh / 2, 3.5); }
    const tx = lx(k.get(7), w); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(tx, 0, w - tx, hh);
  });
  return k.row(k.col(k.CH(0, ['Pitch', 'Freq', 'Ring']), disp, k.row(k.swap(0, () => k.K(3, { big: true }), () => k.K(1, { big: true })), k.K(2), k.K(4))), k.sep(),
    k.col(k.K(5), k.K(6)), k.sep(), k.col(k.K(7), k.K(8)));
};
// Grain Delay: parameter boxes with Y-axis buttons, 16th grid + Sync + Delay time | XY display (ring = the X and Y parameters) with the X-axis buttons
const GD = new Map();
V[43] = (k) => {
  const st = GD.get(k.d.id) || { x: 5, y: 8 }; GD.set(k.d.id, st);
  const xk = () => (st.x === 2 && k.get(0) > 0.5 ? 1 : st.x); let W = 300, H = 160;
  const xy = k.DF(W, H, (g, w, hh) => {
    W = w; H = hh;
    g.fillStyle = DISPC.grid; for (let j = 1; j < 10; j++) { g.fillRect(Math.round(j * W / 10), 0, 1, H); g.fillRect(0, Math.round(j * H / 10), W, 1); }
    const px = k.def.params[xk()], py = k.def.params[st.y]; lvRing(g, 8 + normOf(px, k.get(xk())) * (W - 16), H - 8 - normOf(py, k.get(st.y)) * (H - 16), 6);
  }, { onDown: () => ({}), onMove: (x, y) => { const a = xk(); k.set(a, valOf(k.def.params[a], (x - 8) / (W - 16))); k.set(st.y, valOf(k.def.params[st.y], (H - 8 - y) / (H - 16))); } });
  const axisBtns = (items, key) => { const bs = items.map(([j, t]) => h('button', { class: 'lv-btn lk-ax', onclick: () => { st[key] = j; paint(); xy.paint(); } }, t)); const paint = () => bs.forEach((b, n) => b.classList.toggle('on', items[n][0] === st[key])); paint(); return bs; };
  const ys = axisBtns([[3, 'Spray'], [4, 'Frequency'], [5, 'Pitch'], [6, 'Rand Pitch'], [7, 'Feedback'], [8, 'DryWet']], 'y');
  // Live: delay time (16th grid / Sync / ms) on the left, the X-Y field with its Y-axis buttons beside it and X-axis buttons under it, the six
  // grain dials in a 2 x 3 grid on the right
  const left = k.col(k.CH(1, ['1', '2', '3', '4', '5', '6', '8', '16'], { cls: 'lk-g4' }), k.row(k.T(0, 'Sync', { w: 48 }), k.N(2, { w: 66 })));
  const mid = h('div', { class: 'lk-gdm' }, h('div', { class: 'lk-gdy' }, ...ys), xy, h('span'), h('div', { class: 'lk-gdx' }, ...axisBtns([[2, 'Delay Time'], [3, 'Spray'], [4, 'Frequency'], [5, 'Pitch'], [6, 'Rand Pitch'], [7, 'Feedback']], 'x')));
  const knobs = h('div', { class: 'lk-gdk' }, k.K(3), k.K(4), k.K(5), k.K(6), k.K(7), k.K(8));
  return k.row(left, k.sep(), mid, k.sep(), knobs);
};
// Hybrid Reverb: Send, Predelay, Feedback | Reverb tab (IR picture with IR Decay / Size, Routing, Algorithm, Freeze, Mod, Diffusion; Convolution IR, Blend,
// Decay / Size / Damping) or EQ tab (Low Cut / High Cut curve with draggable rings; the tab's box = EQ on) | Stereo, Vintage, Bass Mono, Dry/Wet
V[44] = (k) => {
  const page = h('div', { class: 'lk-page' }), W = 440;
  const ir = k.D(W, 128, (g, w, hh) => {
    const dec = 0.06 + k.get(6) * 0.9, sz = k.get(7), blend = k.get(4), mid = hh / 2; let s = 11;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    g.fillStyle = DISPC.or; g.globalAlpha = Math.round(k.get(3)) === 2 ? 0.25 : 0.4 + (1 - blend) * 0.6;
    for (let x = 0; x < w; x++) { const t = x / w, env = Math.min(1, t / (0.004 + sz * 0.04)) * Math.exp(-t / dec), a = env * (0.35 + rnd() * 0.65) * (mid - 4); g.fillRect(x, mid - a, 1, a * 2); }
    g.globalAlpha = 1; if (k.get(14) > 0.5) label(g, 'FREEZE', 6, 13, DISPC.bl);
    label(g, Math.round(blend * 100) + ' / ' + Math.round(100 - blend * 100), w - 6, 13, DISPC.ink, 9, 'right');
  });
  const eq = k.D(W, 112, (g, w, hh) => {
    grid(g, w, hh); const yd = (db) => hh / 2 - db / 12 * (hh / 2 - 10); g.fillStyle = DISPC.grid; for (const v of [-6, 0, 6]) { g.fillRect(0, Math.round(yd(v)), w, 1); label(g, String(v), 3, yd(v) - 2, DISPC.ink, 8); }
    const hp = new Biquad(), lp = new Biquad(); hp.highpass(SR, k.get(16), 0.707); lp.lowpass(SR, k.get(17), 0.707); const pts = [];
    for (let x = 0; x <= w; x += 2) { const f = xl(x, w); pts.push([x, yd(20 * Math.log10(mag(hp, f) * mag(lp, f) + 1e-9))]); }
    lvPath(g, pts, k.get(15) > 0.5 ? DISPC.bl : DISPC.grid2, null, 1.8); lvRing(g, lx(k.get(16), w), yd(0), 5); lvRing(g, lx(k.get(17), w), yd(0), 5);
  }, { onDown: (x) => ({ hp: Math.abs(x - lx(k.get(16), W)) < Math.abs(x - lx(k.get(17), W)) }), onMove: (x, y, dx, dy, s) => { if (s.hp) k.set(16, Math.max(20, Math.min(2000, xl(x, W)))); else k.set(17, Math.max(1000, Math.min(20000, xl(x, W)))); } });
  const rout = h('div', { class: 'lk-tl' }, h('span', { class: 'lk-lb' }, 'Routing'), k.S(3, { w: 82, cls: 'dk or' }));
  const tabs = [
    () => k.col(k.dk(ir, k.row(k.TL('Decay', k.NT(6, { w: 48 })), k.TL('Size', k.NT(7, { w: 44 })), rout, k.TL('Algorithm', k.S(8, { w: 82, cls: 'dk' })), k.TL('Freeze', k.T(14, '❄', { w: 26 })), k.TL('Mod', k.NT(13, { w: 44 })), k.TL('Diffusion', k.NT(12, { w: 50 })))),
      k.row(k.col(h('div', { class: 'lk-st' }, 'Convolution IR'), k.S(5, { w: 120 })), k.sep(), k.K(4), k.sep(), k.K(9), k.K(10), k.K(11))),
    () => k.dk(eq, k.row(k.LN('Low Cut', k.NT(16, { w: 60, cls: 'or' })), k.LN('High Cut', k.NT(17, { w: 66, cls: 'or' })))),
  ];
  const t = lvTabs([{ label: 'Reverb' }, { label: 'EQ', check: () => k.get(15) > 0.5, onCheck: () => k.set(15, k.get(15) > 0.5 ? 0 : 1) }], 0, (j) => page.replaceChildren(tabs[j]()), { cls: 'lk-tabs c' });
  page.replaceChildren(tabs[0]());
  return k.row(t, k.col(k.K(0), k.K(1), k.TL('Feedback', k.N(2, { w: 56 }))), page, k.col(k.K(18), k.TL('Vintage', k.S(19, { w: 64 })), k.TL('Bass', k.T(20, 'Mono')), k.K(21)));   // the tab strip goes up into the title bar (devices.js hoistTabs)
};
// Looper: state display (length, position), transport button (Record -> Overdub -> Play -> Overdub ...), Stop, Clear | Record length, Monitor |
// Speed, Reverse | Feedback, Volume
V[45] = (k) => {
  let o = [0, 0, 0, 0]; const ST = ['Stopped', 'Recording', 'Playing', 'Overdub'];
  const disp = k.DF(176, 66, (g, w, hh) => {
    const s = Math.round(o[0]), col = s === 1 ? '#ff5a4f' : s === 3 ? DISPC.or : s === 2 ? '#5fd08a' : DISPC.ink;
    label(g, ST[s], 8, 18, col, 13); label(g, (s === 1 ? o[3] : o[1]).toFixed(1) + ' s', w - 8, 18, DISPC.bl, 13, 'right');
    g.fillStyle = DISPC.grid; g.fillRect(8, hh - 22, w - 16, 10); if (o[1] > 0) { g.fillStyle = col; g.fillRect(8, hh - 22, (w - 16) * o[2], 10); }
    label(g, k.get(3) > 0.5 ? 'Reverse' : '', 8, hh - 2, DISPC.ink, 9); label(g, fmtParam(k.def.params[2], k.get(2)), w - 8, hh - 2, DISPC.ink, 9, 'right');
  });
  const big = lvBtn('', () => { const s = Math.round(o[0]), next = s === 0 ? (o[1] > 0 ? 2 : 1) : s === 1 ? 3 : s === 3 ? 2 : 3; k.set(0, next); o[0] = next; paint(); }, { cls: 'lk-loop' });
  const paint = () => { const s = Math.round(o[0]); big.textContent = s === 0 ? (o[1] > 0 ? '▶' : '●') : s === 1 ? '+' : s === 3 ? '▶' : '+'; big.classList.toggle('rec', s === 1 || s === 3); disp.paint(); };
  k.every(80, () => { const r = k.out(); if (r.length >= 4) { o = r; paint(); } });
  paint();
  return k.row(k.col(disp, k.row(big, lvBtn('■', () => { k.set(0, 0); o[0] = 0; paint(); }, { cls: 'lk-t', w: 40 }), lvBtn('Clear', () => { k.set(6, k.get(6) + 1); paint(); }, { cls: 'lk-t' }))), k.sep(),
    h('div', { class: 'lk-lpg' }, k.TL('Record', k.S(1, { w: 96 })), k.K(2), k.K(4), k.TL('Monitor', k.S(5, { w: 96 })), k.T(3, 'Reverse', { w: 76 }), k.K(7)));   // Live: two aligned rows
};

// ================================================================================================ Live 12 set, part 3: spectral (engine: js/engine/fx5.js)
// scrolling sonogram (cyan on dark, newest column right); col(o) returns the 48 band levels in dB or null; ▶ pauses it like Live's display button
function sonogram(k, w, hh, col) {
  const off = document.createElement('canvas'); off.width = w; off.height = hh; const og = off.getContext('2d'); og.fillStyle = DISPC.bg; og.fillRect(0, 0, w, hh);
  let run = true;
  const c = k.DF(w, hh, (g, cw, ch) => { g.drawImage(off, 0, 0, cw, ch); });
  k.every(60, () => {
    if (!run) return; const v = col(); if (!v) return;
    og.drawImage(off, -2, 0); og.fillStyle = DISPC.bg; og.fillRect(w - 2, 0, 2, hh);
    const nb = v.length, bh = hh / nb;
    for (let j = 0; j < nb; j++) { const a = Math.max(0, Math.min(1, (v[j] + 84) / 66)); if (a < 0.03) continue; og.fillStyle = `rgba(110,226,236,${a.toFixed(3)})`; og.fillRect(w - 2, hh - (j + 1) * bh, 2, Math.ceil(bh)); }
    c.paint();
  });
  const play = h('button', { class: 'lk-play on', 'aria-label': 'Display', onclick: () => { run = !run; play.classList.toggle('on', run); } }, '▶');
  return h('div', { class: 'lk-son' }, c, play);
}
const chk = (k, j, text) => k.T(j, text, { cls: 'lk-chk' });     // Live section switch: orange square + title
// Spectral Time: 1 Freezer (Manual / Retrigger, Onsets / Sync, Interval or Sensitivity, ms / note, Freeze, crossfade / envelope, X-Fade) |
// 2 Delay (Time / Notes / 16th by Mode, Feedback, Shift, Mode, Stereo, Mix, Tilt, Spray, Mask) | sonogram, input / output meters
V[46] = (k) => {
  let lv = [0, 0], son = null;
  const met = k.D(14, 120, (g, w, hh) => { for (let c = 0; c < 2; c++) { const db = 20 * Math.log10(lv[c] + 1e-9), y = Math.max(0, Math.min(1, (db + 60) / 60)); g.fillStyle = '#5fd08a'; g.fillRect(1 + c * 7, hh - y * hh, 5, y * hh); } });
  k.every(60, () => { const r = k.out(); if (r.length >= 51) { lv = [r[0], r[1]]; son = r.slice(3, 51); met.paint(); } });
  const frz = k.col(chk(k, 0, '1 Freezer'), k.row(
    k.col(k.CH(1, ['Manual', 'Retrigger'], { v: true, cls: 'wide' }), k.CH(2, ['Onsets', 'Sync']),
      k.row(k.swap(2, () => k.swap(4, () => k.K(5, { n: 'Interval' }), () => k.K(6, { n: 'Interval' })), () => k.K(7, { n: 'Sensitivity' })), k.CH(4, ['ms', '♪'], { v: true, cls: 'sm' })),
      k.TL('Freeze', k.T(3, '✱', { cls: 'lk-frz' }))), k.sep(),
    k.col(k.row(k.CH(8, [ico('M3 2L21 10M3 10L21 2'), ico('M3 10L12 2L21 10')].map((x) => x), { cls: 'ico' })), k.K(9))));
  const dly = k.col(chk(k, 10, '2 Delay'),
    k.row(k.swapN(14, (m) => (m === 0 ? k.K(11, { n: 'Time' }) : m === 1 ? k.K(15, { n: 'Time' }) : k.K(16, { n: 'Time' }))), k.K(12), k.K(13)),
    k.row(k.TL('Mode', k.S(14, { w: 80 })), k.TL('Stereo', k.N(17, { w: 70, fill: false })), k.TL('Mix', k.N(18, { w: 70 }))),
    k.row(k.K(19), k.K(20), k.K(21)));
  const box = (el) => { const b = k.sec(null, el); b.classList.add('box'); return b; };
  return k.row(met, box(frz), box(dly), sonogram(k, 200, 170, () => son));
};
// Spectral Resonator: Mode Internal / MIDI, MIDI From, Mono / Poly, Voices | Freq (Internal) or Transp. (MIDI), Stretch, Shift | Decay, HF / LF Damp |
// None / Chorus / Wander / Granular, Mod Rate, Pch.Mod | sonogram with Harmonics | Unison, Uni.Amt, Input Send, Dry/Wet
V[47] = (k) => {
  let son = null; k.every(60, () => { const r = k.out(); if (r.length >= 49) son = r.slice(1, 49); });
  const src = k.reg(lvSel(() => [{ label: 'This Track', value: 0 }, ...P.state.tracks.map((t, j) => ({ label: `${j + 1} ${t.name || 'Track'}`, value: j + 1 }))], () => Math.round(k.get(1)), (v) => k.set(1, v), { w: 108, cls: 'lk-s' }), 1);
  const disp = h('div', { class: 'lk-sonw' }, sonogram(k, 230, 150, () => son), h('div', { class: 'lk-harm' }, h('span', {}, 'Harmonics'), k.NT(12, { w: 40, cls: 'or' })));
  return k.row(
    k.col(k.TL('Mode', k.CH(0, ['Internal', 'MIDI'])), k.TL('MIDI From', src), h('span', { class: 'lk-grow' }), k.CH(13, ['Mono', 'Poly']), k.TL('Voices', k.N(14, { w: 96 }))), k.sep(),
    k.col(k.swap(0, () => k.K(3, { big: true }), () => k.K(2, { big: true })), k.TL('Stretch', k.N(7, { w: 64 })), k.TL('Shift', k.N(8, { w: 64 }))),
    k.col(k.K(4), k.K(5), k.K(6)), k.sep(),
    k.col(k.CH(9, ['None', 'Chorus', 'Wander', 'Granular'], { cls: 'lk-g2x2' }), k.K(10), k.TL('Pch.Mod', k.N(11, { w: 64, fill: false }))),
    disp, h('div', { class: 'lk-srr' }, k.TL('Unison', k.S(15, { w: 56 })), k.K(16), k.K(17), k.K(18)));
};

// ================================================================================================ Live 12 modulators (engine: js/engine/fx6.js)
// Map bar: Map (tap = choose a device and a parameter anywhere in the set; mapped = shows the target, ⓧ unmaps), Mod (modulate around the target's
// own value: ± bipolar + amount) or Remap (Min / Max of the target range)
const stripName = (i) => (i === MASTER ? 'Master' : i >= RET0 ? 'Return ' + 'ABCDEFGH'[i - RET0] : (P.state.tracks[i].name || 'Track ' + (i + 1)));
function mapBar(k, o = {}) {
  const { i, di } = k.ctx, M = MOD_MAP[k.d.type], bar = h('div', { class: 'lk-map' });
  const pick = (r) => {
    const strips = [...P.state.tracks.map((_, j) => j), MASTER, ...P.state.returns.map((_, j) => RET0 + j)], items = [];
    for (const s of strips) {
      const t = P.tr(s); if (!t) continue; items.push({ label: stripName(s).toUpperCase(), dim: true });
      if (t.inst && INSTRUMENTS[t.inst.type]) items.push({ label: '   ' + INSTRUMENTS[t.inst.type].name + '…', fn: () => params(s, 'inst', INSTRUMENTS[t.inst.type].params) });
      t.devices.forEach((d) => { if (d !== k.d && !DEVICES[d.type].mod) items.push({ label: '   ' + DEVICES[d.type].name + '…', fn: () => params(s, d.id, DEVICES[d.type].params) }); });
    }
    const params = (s, id, ps) => menu(ps.map((q, kk) => (q.hidden ? null : { label: q.n, fn: () => { P.setModMap(i, di, { s: P.stripOf(s), id, k: kk }); fill(); } })).filter(Boolean), r.left, r.bottom + 1);
    menu(items, r.left, r.bottom + 1);
  };
  const fill = () => {
    const m = k.d.map, tg = m && P.modTarget(m), name = tg ? tg.p.n : 'Map';
    const mb = h('button', { class: 'lk-mapb' + (tg ? ' on' : ''), onclick: (e) => pick(e.currentTarget.getBoundingClientRect()) }, name);
    const x = tg ? h('button', { class: 'lk-mapx', 'aria-label': 'Unmap', onclick: () => { P.setModMap(i, di, null); fill(); } }, '×') : null;
    bar.replaceChildren(...[mb, x, o.noMode ? null : k.T(M, 'Mod', { cls: 'lk-modb' }), k.swap(M, () => k.row(k.T(M + 1, '±', { w: 22 }), k.NT(M + 2, { w: 50 })), () => k.row(k.NT(M + 3, { w: 46, cls: 'or' }), k.NT(M + 4, { w: 50, cls: 'or' })))].filter(Boolean));
  };
  fill(); return bar;
};
const WF = (w, x, sh) => { x -= Math.floor(x); if (sh) x = sh > 0 ? Math.pow(x, 1 + sh * 3) : 1 - Math.pow(1 - x, 1 - sh * 3);
  switch (w) { case 1: return x; case 2: return 1 - x; case 3: return 1 - Math.abs(2 * x - 1); case 4: return x < 0.5 ? 1 : 0; default: return 0.5 + 0.5 * Math.sin(TWO * x); } };
const TWO = Math.PI * 2;
// LFO: Map / Mod / ± / amount, waveform display (Waveform, Shape, Steps, Jitter, Smooth) | Rate (Hz or synced) with Hz / ♪ and ×10, Depth, Offset, Phase, Hold, R
V[48] = (k) => {
  let live = 0;
  const disp = k.D(370, 80, (g, w, hh) => {
    const wf = Math.round(k.get(0)), sh = k.get(1), st = Math.round(k.get(2)), dep = k.get(9), off = k.get(10), ph = k.get(11);
    g.fillStyle = DISPC.grid; g.fillRect(0, hh / 2, w, 1);
    const rv = (c) => { const r = Math.sin(c * 12.9898) * 43758.5453; return r - Math.floor(r); }, pts = [];
    for (let x = 0; x <= w; x += 1) { const t = x / w * 3 + ph; let v = wf >= 5 ? (wf === 6 ? (rv(Math.floor(t)) > 0.5 ? 1 : 0) : rv(Math.floor(t))) : WF(wf, t, sh); if (st > 1) v = Math.round(v * (st - 1)) / (st - 1); v = Math.max(0, Math.min(1, 0.5 + (v - 0.5) * dep + off * 0.5)); pts.push([x, hh - 6 - v * (hh - 12)]); }
    lvPath(g, pts, DISPC.or, null, 1.8);
    g.fillStyle = DISPC.or; g.globalAlpha = 0.9; g.beginPath(); g.arc(w - 6, hh - 6 - live * (hh - 12), 3.5, 0, 7); g.fill(); g.globalAlpha = 1;
  });
  k.every(50, () => { const r = k.out(); if (r.length) { live = r[0]; disp.paint(); } });
  const R = lvBtn('R', () => k.set(13, k.get(13) + 1), { cls: 'lk-t lk-r', w: 22 });
  return k.col(k.dk(mapBar(k), disp, k.row(k.TL('Waveform', k.S(0, { w: 96, cls: 'dk or' })), k.TL('Shape', k.NT(1, { w: 52, cls: 'or' })), k.TL('Steps', k.NT(2, { w: 44, cls: 'or' })), k.TL('Jitter', k.NT(3, { w: 48, cls: 'or' })), k.TL('Smooth', k.NT(4, { w: 48, cls: 'or' })))),
    k.row(k.swap(6, () => k.K(7, { n: 'Rate' }), () => k.K(5, { n: 'Rate' })), k.col(k.CH(6, ['Hz', '♪'], { v: true, cls: 'sm' }), k.T(8, '×10', { w: 34 })), k.K(9), k.K(10), k.col(k.TL('Phase', k.N(11, { w: 60 })), k.row(k.T(12, 'Hold'), R))));
};
// Shaper: Map bar, breakpoint editor (drag a point; tap empty space = new point; double tap a point = remove; drag a segment up / down = curve),
// preset shapes, Grid, Snap | output history with Jitter / Smooth, Rate (Hz or synced), Depth, Phase, Offset
const SP = 11, SPRESET = [[[0, 0, 0], [1, 1, 0]], [[0, 1, 0], [1, 0, 0]], [[0, 0, -0.5], [0.5, 1, 0.5], [1, 0, 0]], [[0, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [1, 1, 0]], [[0, 1, 0], [0.25, 0, 0], [0.5, 1, 0], [0.75, 0, 0], [1, 1, 0]], [[0, 0, 0.6], [0.5, 1, -0.6], [1, 0, 0]], [[0, 0, 0], [0.2, 1, 0], [0.4, 0.3, 0], [0.7, 0.8, 0], [1, 0, 0]]];
V[49] = (k) => {
  const W = 300, H = 132, pad = 8, X = (x) => pad + x * (W - 2 * pad), Y = (y) => H - pad - y * (H - 2 * pad);
  const np = () => Math.round(k.get(10)), pt = (j) => [k.get(SP + j * 3), k.get(SP + j * 3 + 1), k.get(SP + j * 3 + 2)];
  const setPts = (arr) => { arr.forEach(([x, y, c], j) => { k.set(SP + j * 3, x); k.set(SP + j * 3 + 1, y); k.set(SP + j * 3 + 2, c); }); k.set(10, arr.length); };
  const curve = (y0, y1, c, t) => { if (c) t = c > 0 ? Math.pow(t, 1 + c * 4) : 1 - Math.pow(1 - t, 1 - c * 4); return y0 + (y1 - y0) * t; };
  let hist = [], lastTap = 0;
  const ed = k.D(W, H, (g) => {
    const gr = Math.round(k.get(8)); g.fillStyle = DISPC.grid; for (let j = 1; j < gr; j++) g.fillRect(Math.round(X(j / gr)), 0, 1, H); g.fillRect(0, Math.round(Y(0.5)), W, 1);
    const n = np(), path = [];
    for (let j = 0; j < n - 1; j++) { const [x0, y0, c] = pt(j), [x1, y1] = pt(j + 1); for (let s2 = 0; s2 <= 24; s2++) { const t = s2 / 24; path.push([X(x0 + (x1 - x0) * t), Y(curve(y0, y1, c, t))]); } }
    lvPath(g, path, DISPC.or, null, 1.8); for (let j = 0; j < n; j++) { const [x, y] = pt(j); g.strokeStyle = DISPC.or; g.lineWidth = 1.4; g.beginPath(); g.arc(X(x), Y(y), 4, 0, 7); g.stroke(); }
  }, {
    onDown: (x, y) => {
      const n = np(); let best = -1, bd = 14; for (let j = 0; j < n; j++) { const [px, py] = pt(j), dd = Math.hypot(X(px) - x, Y(py) - y); if (dd < bd) { bd = dd; best = j; } }
      const now = performance.now();
      if (best >= 0 && now - lastTap < 320 && n > 2) { const a = Array.from({ length: n }, (_, j) => pt(j)); a.splice(best, 1); if (best === 0) a[0][0] = 0; if (best === n - 1) a[a.length - 1][0] = 1; setPts(a); lastTap = 0; return false; }
      lastTap = now;
      if (best >= 0) return { mode: 'pt', j: best };
      const xn = (x - pad) / (W - 2 * pad); let seg = 0; for (let j = 0; j < n - 1; j++) if (xn >= pt(j)[0]) seg = j;
      return { mode: 'seg', j: seg, c: pt(seg)[2], x, y, moved: false };
    },
    onMove: (x, y, dx, dy, s) => {
      const n = np();
      if (s.mode === 'pt') { const j = s.j, lo = j === 0 ? 0 : pt(j - 1)[0], hi = j === n - 1 ? 1 : pt(j + 1)[0], gr = Math.round(k.get(8)); let xn = (x - pad) / (W - 2 * pad); if (k.get(9) > 0.5) xn = Math.round(xn * gr) / gr;
        if (j > 0 && j < n - 1) k.set(SP + j * 3, Math.max(lo, Math.min(hi, xn))); k.set(SP + j * 3 + 1, Math.max(0, Math.min(1, (H - pad - y) / (H - 2 * pad)))); }
      else if (Math.abs(dy) > 4 || s.moved) { s.moved = true; const up = pt(s.j + 1)[1] >= pt(s.j)[1]; k.set(SP + s.j * 3 + 2, Math.max(-1, Math.min(1, s.c + (up ? dy : -dy) / 60))); }
    },
    onUp: (x, y, s) => {
      if (!s || s.mode !== 'seg' || s.moved || np() >= 8) return;
      const gr = Math.round(k.get(8)); let xn = Math.max(0.001, Math.min(0.999, (x - pad) / (W - 2 * pad))); if (k.get(9) > 0.5) xn = Math.round(xn * gr) / gr;
      const a = Array.from({ length: np() }, (_, j) => pt(j)); let at = a.findIndex((q) => q[0] > xn); if (at <= 0) at = a.length - 1;
      a.splice(at, 0, [xn, Math.max(0, Math.min(1, (H - pad - y) / (H - 2 * pad))), 0]); setPts(a);
    },
  });
  const out = k.D(150, 56, (g, w, hh) => { if (!hist.length) return; lvPath(g, hist.map((v, j) => [j / (hist.length - 1) * w, hh - 4 - v * (hh - 8)]), DISPC.or, null, 1.2); });
  k.every(50, () => { const r = k.out(); if (r.length >= 129) { hist = r.slice(1, 129); out.paint(); } });
  const presets = h('div', { class: 'lk-shp' }, ...SPRESET.map((ps) => { const c = document.createElement('canvas'); c.width = 44; c.height = 24; const g = c.getContext('2d'); g.strokeStyle = '#9a9aa2'; g.lineWidth = 2; g.beginPath();
    for (let j = 0; j < ps.length - 1; j++) for (let s2 = 0; s2 <= 10; s2++) { const t = s2 / 10, xx = 2 + (ps[j][0] + (ps[j + 1][0] - ps[j][0]) * t) * 40, yy = 22 - curve(ps[j][1], ps[j + 1][1], ps[j][2], t) * 20; if (!j && !s2) g.moveTo(xx, yy); else g.lineTo(xx, yy); } g.stroke();
    return h('button', { class: 'lk-shpb', 'aria-label': 'Shape', onclick: () => setPts(ps.map((q) => q.slice())) }, c); }));
  return k.row(k.dk(mapBar(k), ed, h('div', { class: 'lk-shrow' }, presets, k.LN('Grid', k.NT(8, { w: 30 })), k.T(9, 'Snap'))),
    k.col(k.dk(out, k.row(k.LN('Jitter', k.NT(6, { w: 44 })), k.LN('Smooth', k.NT(7, { w: 44 })))),
      k.row(k.col(k.swap(1, () => k.K(2, { n: 'Rate' }), () => k.K(0, { n: 'Rate' })), k.TL('Phase', k.N(5, { w: 56 }))), k.CH(1, ['Hz', '♪'], { v: true, cls: 'sm' }), k.col(k.K(3), k.TL('Offset', k.N(4, { w: 56 }))))));
};
// Envelope Follower: Map bar (Min / Max), input level bars with the envelope (orange) | Gain, Rise, Fall, Delay (ms or synced) with ms / ♪
V[50] = (k) => {
  let env = [], lv = [];
  const disp = k.D(300, 118, (g, w, hh) => {
    const n = lv.length; if (!n) return; g.fillStyle = '#6b6b70'; for (let j = 0; j < n; j++) { const v = Math.max(0, Math.min(1, (20 * Math.log10(lv[j] + 1e-6) + 48) / 48)); g.fillRect(j / n * w, hh - 2 - v * (hh - 8), Math.max(1, w / n - 0.5), v * (hh - 8)); }
    const lo = k.get(MOD_MAP[50] + 3), hi = k.get(MOD_MAP[50] + 4); lvPath(g, env.map((v, j) => [j / (env.length - 1) * w, hh - 2 - (lo + (hi - lo) * v) * (hh - 8)]), DISPC.or, null, 1.6);
  });
  k.every(50, () => { const r = k.out(); if (r.length >= 257) { env = r.slice(1, 129); lv = r.slice(129, 257); disp.paint(); } });
  return k.col(k.dk(mapBar(k, { noMode: true }), disp), k.row(k.K(0), k.K(1), k.K(2), k.swap(4, () => k.K(5, { n: 'Delay' }), () => k.K(3)), k.CH(4, ['ms', '♪'], { v: true, cls: 'sm' })));
};

// ================================================================================================ Racks (engine: js/engine/fx7.js)
// One panel for the Audio Effect Rack (device 51) and the Instrument Rack (instrument 12, di = -1). Left strip: macros / chain list / devices.
// Macros: 8 knobs (Map mode: tap a macro, then a device or instrument and a parameter inside the rack). Chain list: Auto Select, zone editors
// (Instrument Rack: Key / Vel / Chain, Audio Effect Rack: Chain) and Hide; per chain: name (tap = select, double tap = rename), meter, volume,
// pan, activator, solo, chain menu; Create Chain; tapping the drop text = a new chain with an effect / instrument. Devices: the selected chain's
// instrument (Instrument Rack) and effects as Live cards.
const RK = new Map(), RACK_FX = () => FX_GROUPS.map(([, label, ks]) => [label, ks.filter((t) => DEVICES[t] && DEVICES[t].kit && !DEVICES[t].mod && !DEVICES[t].rack)]).filter(([, ks]) => ks.length);
const fxMenu = (r, fn) => menu(RACK_FX().flatMap(([label, ks]) => [{ label: label.toUpperCase(), dim: true }, ...ks.map((t) => ({ label: DEVICES[t].name, fn: () => fn(t) }))]), r.left, Math.max(8, r.top - 120));
const instMenu = (r, fn, cur) => menu(P.IRACK_INSTS.map((t) => ({ label: INSTRUMENTS[t].name, check: t === cur, fn: () => fn(t) })), r.left, r.bottom + 1);
const icoBtn = (svg, title, on, fn) => { const b = h('button', { class: 'lk-rki' + (on ? ' on' : ''), 'aria-label': title, title, onclick: fn }); b.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14">${svg}</svg>`; return b; };
const ZM = { key: [122, 0, 'Key'], vel: [138, 1, 'Vel'], chain: [106, 0, 'Chain'] };
function rackPanel(k) {
  const { i, di } = k.ctx, d = k.d, IR = di < 0, st = RK.get(d.id) || { mac: false, list: true, dev: true, sel: 0, zm: null, auto: false, map: false }; RK.set(d.id, st);
  const root = h('div', { class: 'lk-rack' }); let pk = [];
  st.sel = Math.max(0, Math.min(st.sel, d.chains.length - 1));
  const redo = () => { root.replaceChildren(...build()); };
  const meterEls = [];
  k.every(60, () => { const r = k.out(); if (r.length) { pk = r; for (const [c, m] of meterEls) { const v = Math.max(0, Math.min(1, (20 * Math.log10((pk[c] || 0) + 1e-9) + 60) / 60)); m.style.setProperty('--m', String(v)); } } });
  const paramMenu = (r, ps, fn) => menu(ps.map((pp, kk) => (pp.hidden ? null : { label: pp.n, fn: () => fn(kk) })).filter(Boolean), r.left, r.bottom + 1);
  function build() {
    meterEls.length = 0;
    const strip = h('div', { class: 'lk-rks' },
      icoBtn('<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8L4 4" stroke="currentColor" stroke-width="2"/>', 'Macro', st.mac, () => { st.mac = !st.mac; redo(); }),
      icoBtn('<path d="M4 5h8M4 8h8M4 11h8" stroke="currentColor" stroke-width="1.6"/>', 'Daftar chain', st.list, () => { st.list = !st.list; redo(); }),
      icoBtn('<rect x="3" y="5" width="10" height="6" fill="none" stroke="currentColor" stroke-width="1.6"/>', 'Device', st.dev, () => { st.dev = !st.dev; redo(); }));
    const parts = [strip];
    if (st.mac) {
      const mk = (m) => {
        const mm = d.macroMap && d.macroMap[m], ch = mm && d.chains.find((c) => c.id === mm.c), x = ch && (mm.id === 'inst' ? ch.inst : ch.devices.find((q) => q.id === mm.id));
        const name = x ? (mm.id === 'inst' ? INSTRUMENTS[x.type] : DEVICES[x.type]).params[mm.k].n : 'Macro ' + (m + 1);
        const kn = k.K(33 + m, { n: name }); if (!st.map) return kn;
        const b = h('button', { class: 'lk-mmap' + (x ? ' on' : ''), onclick: (e) => {
          const r = e.currentTarget.getBoundingClientRect(), items = [];
          d.chains.forEach((c) => {
            items.push({ label: c.name.toUpperCase(), dim: true });
            if (c.inst) items.push({ label: '   ' + INSTRUMENTS[c.inst.type].name + '…', fn: () => paramMenu(r, INSTRUMENTS[c.inst.type].params, (kk) => P.rackMapMacro(i, di, m, { c: c.id, id: 'inst', k: kk })) });
            c.devices.forEach((q) => items.push({ label: '   ' + DEVICES[q.type].name + '…', fn: () => paramMenu(r, DEVICES[q.type].params, (kk) => P.rackMapMacro(i, di, m, { c: c.id, id: q.id, k: kk })) }));
          });
          if (x) items.push({ sep: true }, { label: 'Hapus map', fn: () => P.rackMapMacro(i, di, m, null) });
          menu(items.length ? items : [{ label: 'Tambahkan device ke chain dulu', dim: true }], r.left, r.bottom + 1);
        } }, x ? name : 'Map');
        return h('div', { class: 'lk-mcell' }, kn, b);
      };
      parts.push(h('div', { class: 'lk-rkm' }, h('div', { class: 'lk-rkmh' }, lvTog('Map', () => st.map, (b) => { st.map = b; redo(); }, { cls: 'lk-t lk-mapt' })), h('div', { class: 'lk-mgrid' }, ...Array.from({ length: 8 }, (_, m) => mk(m)))));
    }
    if (st.list) {
      const rows = d.chains.map((c, ci) => {
        const o = ci * 4, sel = ci === st.sel, met = h('i', { class: 'lk-cmet' }); meterEls.push([ci, met]); let lt = 0;
        const name = h('button', { class: 'lk-cname' + (sel ? ' on' : ''), onclick: () => { const now = performance.now(); if (now - lt < 320) ask('Nama chain', c.name, (v) => P.rackRenameChain(i, di, ci, String(v).trim())); lt = now; if (!sel) { st.sel = ci; redo(); } } }, c.name);
        const more = icoBtn('<path d="M3 8a5 5 0 0 1 9-3M13 8a5 5 0 0 1-9 3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 2v3H9M4 14v-3h3" fill="none" stroke="currentColor" stroke-width="1.5"/>', 'Menu chain', false, (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          menu([{ label: 'Ganti nama…', fn: () => ask('Nama chain', c.name, (v) => P.rackRenameChain(i, di, ci, String(v).trim())) }, { label: 'Duplikat', dim: d.chains.length >= 8, fn: () => P.rackDuplicateChain(i, di, ci) },
            ...(IR ? [{ label: c.inst ? 'Ganti instrumen…' : 'Pilih instrumen…', fn: () => instMenu(r, (t) => P.rackSetChainInst(i, ci, t), c.inst && c.inst.type) }] : []),
            { label: 'Tambah efek…', fn: () => fxMenu(r, (t) => P.rackAddDevice(i, di, ci, t)) }, { sep: true }, { label: 'Hapus chain', fn: () => { P.rackRemoveChain(i, di, ci); if (st.sel >= d.chains.length) st.sel = Math.max(0, d.chains.length - 1); } }], r.left - 120, r.bottom);
        });
        return h('div', { class: 'lk-crow' + (sel ? ' sel' : '') }, name, met, k.N(o, { w: 58 }), k.N(o + 1, { w: 48, fill: false }), k.T(o + 2, '🔈', { cls: 'lk-spk', w: 24 }), k.T(o + 3, 'S', { w: 22 }), more);
      });
      const zones = st.zm ? zoneEditor() : null;
      const drop = h('button', { class: 'lk-rdrop', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(), mkc = (t, isInst) => { const c = P.rackAddChain(i, di, isInst ? t : 0); if (c < 0) return; if (!isInst) P.rackAddDevice(i, di, c, t); st.sel = c; };
        if (IR) instMenu(r, (t) => mkc(t, true)); else fxMenu(r, (t) => mkc(t, false)); } }, IR ? 'Drop an Instrument or Sample Here' : 'Drop Audio Effects Here');
      const zb = (key) => lvTog(ZM[key][2], () => st.zm === key, (b) => { st.zm = b ? key : null; redo(); }, { cls: 'lk-t' });
      const head = h('div', { class: 'lk-rkh' }, k.reg(lvTog('⇥', () => st.auto, (b) => { st.auto = b; }, { cls: 'lk-t', w: 26 }), -2), h('span', { class: 'lk-grow' }),
        ...(IR ? [zb('key'), zb('vel')] : []), zb('chain'), lvTog('Hide', () => !st.zm, (b) => { if (b) st.zm = null; else st.zm = IR ? 'key' : 'chain'; redo(); }, { cls: 'lk-t lk-hide' }));
      parts.push(h('div', { class: 'lk-rkl' }, head, h('div', { class: 'lk-cbox' }, ...rows, zones, h('button', { class: 'lv-btn lk-cchain', disabled: d.chains.length >= 8, onclick: () => { const c = P.rackAddChain(i, di); if (c >= 0) st.sel = c; } }, 'Create Chain'), drop)));
    }
    if (st.dev) {
      const sc = st.sel, ch = d.chains[sc], cards = [];   // the chain shown when these cards were built
      if (ch && IR) cards.push(instCard(ch));
      if (ch) ch.devices.forEach((x, j) => {
        const def = DEVICES[x.type]; if (!def) return;
        const ctx = { i, di, d: x, def, nested: true, outD: IR ? 2000 + sc * 16 + j : 1000 + di * 256 + sc * 16 + j, every: k.ctx.every, setParam: (kk, v) => P.rackParam(i, di, sc, j, kk, v) };
        let kv = null; try { kv = kitView(ctx); } catch (e) { console.error('rack', e); }
        const pw = h('button', { class: 'pw' + (x.bypass ? '' : ' on'), 'aria-label': 'Bypass', onclick: () => P.rackBypass(i, di, sc, j) });
        const more = h('button', { class: 'dv-more', 'aria-label': 'Menu device', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(), n = ch.devices.length;
          menu([{ label: 'Geser ke kiri', dim: j <= 0, fn: () => P.rackMoveDevice(i, di, sc, j, j - 1) }, { label: 'Geser ke kanan', dim: j >= n - 1, fn: () => P.rackMoveDevice(i, di, sc, j, j + 1) }, { sep: true },
            { label: x.bypass ? 'Aktifkan' : 'Bypass', fn: () => P.rackBypass(i, di, sc, j) }, { label: 'Hapus device', fn: () => P.rackRemoveDevice(i, di, sc, j) }], r.left - 120, r.bottom); } }, '⋯');
        const hd = h('h4', {}, pw, h('span', {}, def.name), more);
        if (ch.devices.length > 1) reorderGrip(hd, { index: j, siblings: (card) => [...card.parentElement.children].filter((el) => el.classList.contains('lk-rfx')), move: (to) => P.rackMoveDevice(i, di, sc, j, to) });   // long-press the title, slide = reorder inside the chain
        cards.push(h('div', { class: 'card lkcard lk-rcard lk-rfx' + (x.bypass ? ' off' : '') }, hd, kv ? kv.el : null));
      });
      parts.push(h('div', { class: 'lk-rkd' }, ...cards, h('button', { class: 'lk-rdrop2', disabled: !ch, onclick: (e) => fxMenu(e.currentTarget.getBoundingClientRect(), (t) => P.rackAddDevice(i, di, sc, t)) }, 'Drop Audio Effects Here')));
    }
    return parts;
  }
  // Instrument Rack: the chain's instrument as a Live card (name = instrument chooser, ⋯ = change / remove), or a drop zone to choose one
  function instCard(ch) {
    const ci = d.chains.indexOf(ch);
    if (!ch.inst) return h('button', { class: 'lk-rdrop2 lk-idrop', onclick: (e) => instMenu(e.currentTarget.getBoundingClientRect(), (t) => P.rackSetChainInst(i, ci, t)) }, 'Drop an Instrument Here');
    const def = INSTRUMENTS[ch.inst.type], get = (kk) => ch.inst.params[kk] ?? def.params[kk].def;
    const name = h('button', { class: 'dv-name', onclick: (e) => instMenu(e.currentTarget.getBoundingClientRect(), (t) => P.rackSetChainInst(i, ci, t), ch.inst.type) }, h('span', {}, def.name), h('i', { class: 'tri', 'aria-hidden': 'true' }));
    const more = h('button', { class: 'dv-more', 'aria-label': 'Menu instrumen', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); menu([{ label: 'Ganti instrumen…', fn: () => instMenu(r, (t) => P.rackSetChainInst(i, ci, t), ch.inst.type) }, { label: 'Hapus instrumen', fn: () => P.rackSetChainInst(i, ci, 0) }], r.left - 120, r.bottom); } }, '⋯');
    const syn = buildSynth({ type: ch.inst.type, t: { id: 'ir' + d.id + ':' + ch.id }, def, h, knob, fmt: fmtParam, fromNorm, toNorm, pitch: null, get, set: (kk, v) => P.rackInstParam(i, ci, kk, v), auto: () => {} });
    return h('div', { class: 'card syn lk-rcard lk-rinst' }, h('h4', {}, h('i', { class: 'pdot' }), name, more), syn ? syn.el : null);
  }
  // zone editors: Key (0..127, note names) / Vel (1..127) / Chain (selector + zones). Drag a bar's edges or middle; Chain: drag the selector
  function zoneEditor() {
    const [base, lo0, label] = ZM[st.zm], W = 300, RH = 16, H = 14 + d.chains.length * RH, X = (v) => 4 + (v - lo0) / (127 - lo0) * (W - 8), V2 = (x) => Math.max(lo0, Math.min(127, Math.round(lo0 + (x - 4) / (W - 8) * (127 - lo0))));
    const c = k.D(W, H, (g) => {
      g.fillStyle = DISPC.grid; for (let v = 0; v <= 127; v += st.zm === 'key' ? 12 : 16) { g.fillRect(Math.round(X(Math.max(lo0, v))), 0, 1, H); if (st.zm === 'key') label2(g, 'C' + (v / 12 - 1), X(v) + 2, 10); }
      d.chains.forEach((_, ci) => { const a = k.get(base + ci * 2), b = k.get(base + ci * 2 + 1); g.fillStyle = ci === st.sel ? '#4fc3f0' : '#3c7e8d'; g.fillRect(X(a), 14 + ci * RH + 2, Math.max(2, X(b) - X(a)), RH - 4); });
      if (st.zm === 'chain') { const sx = X(k.get(105)); g.fillStyle = DISPC.or; g.fillRect(Math.round(sx) - 1, 0, 2, H); g.beginPath(); g.moveTo(sx - 5, 0); g.lineTo(sx + 5, 0); g.lineTo(sx, 7); g.fill(); }
    }, {
      onDown: (x, y) => { const v = V2(x); if (y < 14) return st.zm === 'chain' ? { sel: true } : false; const ci = Math.floor((y - 14) / RH); if (ci < 0 || ci >= d.chains.length) return false; const a = k.get(base + ci * 2), b = k.get(base + ci * 2 + 1);
        return { ci, edge: Math.abs(v - a) < 6 ? 'lo' : Math.abs(v - b) < 6 ? 'hi' : 'mid', a, b, v }; },
      onMove: (x, y, dx, dy, s) => {
        const v = V2(x);
        if (s.sel) { k.set(105, v); if (st.auto) { const hit = d.chains.findIndex((_, ci) => v >= k.get(106 + ci * 2) && v <= k.get(107 + ci * 2)); if (hit >= 0 && hit !== st.sel) { st.sel = hit; redo(); } } return; }
        const q = base + s.ci * 2;
        if (s.edge === 'lo') k.set(q, Math.min(v, k.get(q + 1))); else if (s.edge === 'hi') k.set(q + 1, Math.max(v, k.get(q)));
        else { const dv = Math.max(lo0 - s.a, Math.min(127 - s.b, v - s.v)); k.set(q, s.a + dv); k.set(q + 1, s.b + dv); }
      } });
    const sc = st.sel, ro = st.zm === 'chain' ? k.LN('Chain Select', k.N(105, { w: 52 })) : k.row(h('span', { class: 'lk-lb' }, label + ' ' + (sc + 1)), k.N(base + sc * 2, { w: 52 }), k.N(base + sc * 2 + 1, { w: 52 }));
    return h('div', { class: 'lk-zone' }, c, ro);
  }
  root.replaceChildren(...build());
  return root;
}
const label2 = (g, t, x, y) => label(g, t, x, y, DISPC.ink, 8);
V[51] = (k) => rackPanel(k);
// Instrument Rack (instrument 12): the rack panel on top of the instrument's own parameters (stored at 100 + k, see project.js)
export function irackView(i, t, every) {
  const store = t.inst, def = IRACK_DEF;
  const d = { id: 'ir' + t.id, type: 51, get chains() { return store.chains; }, get macroMap() { return store.macroMap; }, params: new Proxy({}, { get: (_, kk) => store.params[100 + +kk] ?? (def.params[kk] ? def.params[kk].def : undefined) }) };
  const ctx = { i, di: -1, d, def, every, outD: 999, setParam: (kk, v) => P.setInstParam(i, 100 + kk, v),
    autoFn: (kk) => (rect) => offerAutomation(rect, { kind: 5, strip: P.stripOf(i), param: 100 + kk, def: def.params[kk] }, `${t.name} \u2022 ${def.params[kk].n}`) };
  const k = kit(ctx); const el = rackPanel(k); el.classList.add('lk'); return { el, draw: k.redraw };
}

// ================================================================================================ Live 12 instruments (kit panels)
// instrument panels use the same kit as the effects: parameters live in t.inst.params (missing = default), automation lanes are kind 5
const VI = {};
const WAVE_ICO = { Sine: 'M1 6Q4 -1 7 6T13 6', Triangle: 'M1 9L4 2L10 10L13 4', 'Shark Tooth': 'M1 10L8 2L13 10', Saturated: 'M1 7Q2 2 4 2H6Q7 2 7 6Q7 10 9 10H11Q13 10 13 6', Saw: 'M1 10L12 2V10', Pulse: 'M1 10V2H4V10H13', Rectangle: 'M1 10V2H7V10H13',
  'Saw Up': 'M1 10L12 2V10', 'Saw Down': 'M1 2L12 10V2', Square: 'M1 10V2H7V10H13', 'S&H': 'M1 8H4V3H7V9H10V5H13', Wander: 'M1 7Q3 2 5 6T9 5T13 7', 'Linear Env': 'M1 2L13 10', 'Exp Env': 'M1 2Q2 10 13 10' };
function waveSel(k, j, col) {
  const p = k.def.params[j], b = h('button', { class: 'lk-wsel', style: `color:${col}` });
  const draw = () => { const n = p.items[Math.round(k.get(j))]; b.innerHTML = `<svg viewBox="0 0 14 12" width="18" height="14"><path d="${WAVE_ICO[n] || ''}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><i class="tri"></i>`; b.title = n; };
  b.onclick = () => { const r = b.getBoundingClientRect(); menu(p.items.map((n, v) => ({ label: n, check: v === Math.round(k.get(j)), fn: () => { k.set(j, v); draw(); } })), r.left, r.bottom + 1); };
  b.update = draw; draw(); return k.reg(b, j);
}
const DY = '#f5b324', DB = '#4fc3f0', DR = '#ff6464';
// Drift: dark oscillator area (Osc 1 / Osc 2 / Pitch Mod / Osc Mix with 1 / 2 / N switches, filter routes › and R), Filter, Envelopes,
// LFO / Mod tabs, Mode / Voices / Drift / Legato / Glide, Volume / Vel > Vol / Transpose / PB Range
VI[13] = (k) => {
  const Y = (j, o = {}) => k.K(j, { ...o, col: DY }), B = (j, o = {}) => k.K(j, { ...o, col: DB });
  const wave = k.D(150, 64, (g, w, hh) => {                                                           // the oscillators' mixed waveform (white, as in Live)
    const w1 = Math.round(k.get(0)), sh = k.get(2), w2 = Math.round(k.get(5)), g1 = k.get(12) > 0.5 ? Math.pow(10, k.get(13) / 20) : 0, g2 = k.get(15) > 0.5 ? Math.pow(10, k.get(16) / 20) : 0, r2 = Math.pow(2, k.get(6) - k.get(1) + k.get(7) / 12);
    const o1 = (a) => { switch (w1) { case 0: return Math.sin(2 * Math.PI * a + sh * 3 * Math.sin(2 * Math.PI * a)); case 1: return Math.sin((1 - 4 * Math.abs(a - 0.5)) * (1 + sh * 3) * Math.PI / 2); case 2: { const s2 = 0.5 + sh * 0.49; return a < s2 ? 2 * a / s2 - 1 : 1 - 2 * (a - s2) / (1 - s2); } case 3: { const q = 1 + sh * 8; return Math.tanh(Math.sin(2 * Math.PI * a) * q) / Math.tanh(q); } case 4: { const q = a * (1 + sh * 3); return 2 * (q - Math.floor(q)) - 1; } default: { const pw = w1 === 5 ? 0.5 - sh * 0.45 : 0.5 + sh * 0.45; return a < pw ? 1 : -1; } } };
    const o2 = (b) => { b -= Math.floor(b); switch (w2) { case 0: return Math.sin(2 * Math.PI * b); case 1: return 1 - 4 * Math.abs(b - 0.5); case 2: return Math.tanh(Math.sin(2 * Math.PI * b) * 3) / Math.tanh(3); case 3: return 2 * b - 1; default: return b < 0.5 ? 1 : -1; } };
    const pts = []; for (let x = 0; x <= w; x++) { const a = (x / w * 2) % 1, y = (o1(a) * g1 + o2(x / w * 2 * r2) * g2) / Math.max(0.3, g1 + g2); pts.push([x, hh / 2 - y * (hh / 2 - 6)]); }
    lvPath(g, pts, '#f2f2f2', null, 1.6);
  });
  const mix = (n, on, gj, fj, col, lbl) => { const r = k.row(k.T(on, lbl, { cls: 'lk-mixb', w: 22 }), k.K(gj, { n, col }), k.T(fj, '›', { cls: 'lk-mixb', w: 22 })); r.style.setProperty('--mixc', col); return r; };
  const osc = k.dk(
    k.row(k.col(h('span', { class: 'lk-lb' }, 'Osc 1'), waveSel(k, 0, DY)), Y(1, { n: 'Oct' }), Y(2), h('div', { class: 'lk-modbox' }, k.S(3, { w: 70, cls: 'dk or' }), k.NT(4, { w: 64, cls: 'or' })), k.sep(),
      k.col(h('div', { class: 'lk-st c' }, 'Osc Mix'), mix('Osc 1', 12, 13, 14, DY, '1'))),
    k.row(k.col(h('span', { class: 'lk-lb' }, 'Osc 2'), waveSel(k, 5, DB)), B(6, { n: 'Oct' }), B(7), h('span', { class: 'lk-grow' }), k.T(21, 'R', { cls: 'lk-mixb lk-r', w: 22 }), k.sep(), mix('Osc 2', 15, 16, 17, DB, '2')),
    k.row(k.col(h('span', { class: 'lk-lb' }, 'Pitch Mod'), k.row(k.S(8, { w: 60, cls: 'dk or' }), k.S(10, { w: 60, cls: 'dk or' })), k.row(k.NT(9, { w: 56, cls: 'or' }), k.NT(11, { w: 56, cls: 'or' }))), wave, k.sep(), mix('Noise', 18, 19, 20, DR, 'N')));
  const filt = k.sec('Filter', k.row(k.col(k.K(22, { big: true }), k.K(25)), k.col(k.TL('Type', k.CH(23, ['I', 'II'], { cls: 'cy' })), k.TL('Key', k.N(24, { w: 46 })), k.K(26))),
    h('div', { class: 'lk-st' }, 'Freq Mod'), k.row(k.S(27, { w: 60 }), k.S(29, { w: 60 })), k.row(k.N(28, { w: 60, fill: false }), k.N(30, { w: 60, fill: false })));
  let ev = 0;
  const envD = k.D(300, 70, (g, w, hh) => {
    for (const e of ev === 0 ? [0, 1] : [ev - 1]) { const b = e ? 35 : 31, pts = lvEnvPts(w - 36, hh, k.get(b) / 1000, k.get(b + 1) / 1000, k.get(b + 2), k.get(b + 3) / 1000, 6).map(([x, y]) => [x + 30, y]); lvPath(g, pts, e ? 'rgba(79,195,240,.45)' : DISPC.bl, null, 1.6); for (const n of [1, 2, 4]) { g.strokeStyle = DISPC.or; g.lineWidth = 1.2; g.strokeRect(pts[n][0] - 3, pts[n][1] - 3, 6, 6); } }
  });
  const envTabs = lvChoice([{ label: '1' }, { label: '2' }], () => ev - 1, (j) => { ev = ev === j + 1 ? 0 : j + 1; envD.paint(); }, { cls: 'lk-ch v lk-envt' });
  const envs = h('div', { class: 'lk-col lk-dlfo3 lk-denv' }, h('div', { class: 'lk-col lk-dlb' }, h('div', { class: 'lk-st c' }, 'Envelopes'), k.row(h('span', { class: 'lk-lb' }, '1'), k.K(31, { n: 'Attack' }), k.K(32, { n: 'Decay' }), k.K(33, { n: 'Sustain' }), k.K(34, { n: 'Release' }))),
    h('div', { class: 'lk-dk lk-dlfod lk-envw' }, envD, envTabs), h('div', { class: 'lk-row lk-dlb' }, h('span', { class: 'lk-lb' }, '2'), k.T(39, '⟳', { w: 22 }), k.K(35, { n: 'Attack' }), k.K(36, { n: 'Decay' }), k.K(37, { n: 'Sustain' }), k.K(38, { n: 'Release' })));
  const page = h('div', { class: 'lk-page' });
  const lfoD = k.D(170, 52, (g, w, hh) => { const wf = Math.round(k.get(40)), pts = []; for (let x = 0; x <= w; x++) { const t = x / w * 6, a = t - Math.floor(t); let v; switch (wf) { case 1: v = 1 - 4 * Math.abs(a - 0.5); break; case 2: v = 2 * a - 1; break; case 3: v = 1 - 2 * a; break; case 4: v = a < 0.5 ? 1 : -1; break; case 5: { const r = Math.sin(Math.floor(t) * 12.9898) * 43758.5; v = (r - Math.floor(r)) * 2 - 1; break; } case 6: v = Math.sin(t * 2.1) * 0.6 + Math.sin(t * 5.3) * 0.3; break; case 7: v = t < 1 ? 1 - 2 * a : -1; break; case 8: v = t < 1 ? 2 * Math.exp(-a * 5) - 1 : -1; break; default: v = Math.sin(2 * Math.PI * a); } pts.push([x, hh / 2 - v * k.get(47) * (hh / 2 - 6)]); } lvPath(g, pts, DISPC.bl, null, 2.4); });
  // Live: Ratio / Rate with the 2 x 2 unit chips on top, the dark box (shape menu, R, wave) in the middle, Amount and Mod under it
  const tabs = [
    () => h('div', { class: 'lk-col lk-dlfo3' },
      h('div', { class: 'lk-row lk-dlb' }, k.swapN(41, (m) => k.K([42, 43, 44, 45][m], { n: ['Rate', 'Ratio', 'Time', 'Rate'][m] })), h('span', { class: 'lk-dash' }), k.CH(41, ['Hz', '1:1', 'ms', '♪'], { cls: 'g2 sm lk-gap' })),
      h('div', { class: 'lk-dk lk-dlfod' }, k.row(k.S(40, { w: 96, cls: 'dk or' }), h('span', { class: 'lk-grow' }), k.T(46, 'R', { cls: 'lk-rbox', w: 22 })), lfoD),
      h('div', { class: 'lk-row lk-dlb' }, k.K(47, { n: 'Amount' }), h('span', { class: 'lk-dash' }), k.col(k.TL('Mod', k.S(48, { w: 70 })), k.N(49, { w: 70, fill: false })))),
    () => k.col(...[0, 1, 2].map((m) => k.row(k.S(59 + m * 3, { w: 76 }), h('span', { class: 'lk-lb' }, '→'), k.S(60 + m * 3, { w: 96 }), k.N(61 + m * 3, { w: 60, fill: false })))),
  ];
  const tb = lvTabs([{ label: 'LFO' }, { label: 'Mod' }], 0, (j) => page.replaceChildren(tabs[j]()), { cls: 'lk-tabs' }); page.replaceChildren(tabs[0]());
  const glob = k.row(k.col(k.TL('Mode', k.S(50, { w: 80 })), k.TL('Voices', k.S(51, { w: 80 })), k.TL('Drift', k.N(52, { w: 80 })), k.T(53, 'Legato', { w: 80 }), k.TL('Glide', k.N(54, { w: 80, fill: false }))), k.sep(),
    k.col(k.K(55), k.TL('Vel > Vol', k.N(56, { w: 80 })), k.TL('Transpose', k.N(57, { w: 80, fill: false })), k.TL('PB Range', k.N(58, { w: 80 }))));
  // ONE panel like Live (wide: the rack scrolls sideways) - never split into tabs
  const r = k.row(osc, k.sep(), filt, k.sep(), envs, k.sep(), h('div', { class: 'lk-col lk-dlfo' }, tb, page), k.sep(), glob); r.classList.add('lk-notab', 'lk-drift'); return r;
};
// Operator: operator rows D / C / B / A (Coarse + Fine, or Freq + Multi when Fixed; Level; coloured switch = operator on, tap a row = show it
// on the right), dark display with the selected operator's envelope (drag the Peak / Sustain points) and oscillator, algorithm picture,
// filter, global (Time, Tone, Volume, Pan, Transpose, Spread, PB Range, Voices)
const OPC = ['#f5e052', '#4ccd5a', '#3fe0c8', '#f59b24'];   // A yellow, B green, C cyan, D orange (Live)
const OPST = new Map();
VI[14] = (k) => {
  const st = OPST.get(k.d.id) || { sel: 0 }; OPST.set(k.d.id, st);
  const right = h('div', { class: 'lk-opr' });
  const rows = [3, 2, 1, 0].map((o) => {
    const b = o * 16, L = 'ABCD'[o];
    const sw = k.T(b, L, { cls: 'lk-opsw', w: 22 }); sw.style.setProperty('--opc', OPC[o]);
    const fx = h('div', { class: 'lk-opfx' }, k.T(b + 3, '', { cls: 'lk-chkbox' }));
    const r = h('div', { class: 'lk-oprow' + (st.sel === o ? ' sel' : '') }, k.swap(b + 3, () => k.K(b + 4, { n: 'Freq' }), () => k.K(b + 1, { n: 'Coarse' })), k.swap(b + 3, () => k.K(b + 5, { n: 'Multi' }), () => k.K(b + 2, { n: 'Fine' })),
      k.TL('Fixed', fx), k.K(b + 6, { n: 'Level', col: '#f08a24' }), sw);
    r.addEventListener('pointerdown', (e) => { if (e.target.closest('.knob, button')) return; st.sel = o; for (const x of rowsEls) x.classList.toggle('sel', x === r); fillRight(); });
    return r;
  });
  const rowsEls = rows;
  function fillRight() {
    const o = st.sel, b = o * 16, W = 250, H = 76, X0 = 8;
    const env = k.D(W, H, (g, w, hh) => {
      const db = (x) => hh - 6 - Math.max(0, (k.get(x) + 60) / 60) * (hh - 12), a = Math.sqrt(k.get(b + 10)), d = Math.sqrt(k.get(b + 11)), r = Math.sqrt(k.get(b + 13)), hold = Math.max(8, (a + d + r) * 0.4), K = (w - 2 * X0) / (a + d + hold + r + 1e-9);
      const pts = [[X0, db(b + 14)], [X0 + a * K, db(b + 15)], [X0 + (a + d) * K, db(b + 12)], [X0 + (a + d + hold) * K, db(b + 12)], [X0 + (a + d + hold + r) * K, hh - 6]];
      lvPath(g, pts, '#f08a24', hh, 1.6); g.strokeStyle = '#f08a24'; g.lineWidth = 1.3; for (const n of [0, 1, 2, 4]) g.strokeRect(pts[n][0] - 3, pts[n][1] - 3, 6, 6);
    }, { onDown: (x) => ({ which: x < W * 0.3 ? b + 15 : b + 12, v: k.get(x < W * 0.3 ? b + 15 : b + 12) }), onMove: (x, y, dx, dy, s) => k.set(s.which, Math.max(-60, Math.min(0, s.v - dy * 0.4))) });
    const T = (n, j, o2 = {}) => k.TL(n, k.NT(j, { w: o2.w || 58, cls: 'or' }));
    right.replaceChildren(k.dk(env, h('div', { class: 'lk-opeh', style: `--opc:${OPC[o]}` }, h('i', {}), 'Envelope ' + 'ABCD'[o]),
      k.row(T('Attack', b + 10), T('Decay', b + 11), T('Sustain', b + 12), T('Feedback', b + 8)), k.row(T('Initial', b + 14), T('Peak', b + 15), T('Release', b + 13), T('Vel > Lvl', b + 9)),
      k.row(k.TL('Loop', k.S(64 + o, { w: 118, cls: 'dk or' })), k.TL('Wave', k.S(b + 7, { w: 118, cls: 'dk or' })))));   // three rows of four: the envelope fits the rack height
  }
  fillRight();
  const algo = k.D(96, 72, (g, w, hh) => {
    const A = OP_ALGOS[Math.round(k.get(68))], lvl = [0, 0, 0, 0], tgt = [-1, -1, -1, -1];
    A.m.forEach((ms, o) => ms.forEach((m) => { tgt[m] = o; }));
    const depth = (o) => (tgt[o] < 0 ? 0 : 1 + depth(tgt[o])); for (let o = 0; o < 4; o++) lvl[o] = depth(o);
    const byL = {}; [3, 2, 1, 0].forEach((o) => { (byL[lvl[o]] = byL[lvl[o]] || []).push(o); });
    const pos = []; for (const [l, os] of Object.entries(byL)) os.forEach((o, j) => { pos[o] = [w / 2 + (j - (os.length - 1) / 2) * 22, hh - 12 - l * 18]; });
    g.strokeStyle = DISPC.ink; g.lineWidth = 1; for (let o = 0; o < 4; o++) if (tgt[o] >= 0) { g.beginPath(); g.moveTo(pos[o][0], pos[o][1]); g.lineTo(pos[tgt[o]][0], pos[tgt[o]][1]); g.stroke(); }
    for (let o = 0; o < 4; o++) { g.fillStyle = OPC[o]; g.fillRect(pos[o][0] - 7, pos[o][1] - 6, 14, 12); label(g, 'ABCD'[o], pos[o][0], pos[o][1] + 4, '#1b1b1d', 9, 'center'); }
  }, { onDown: () => { const r = algo.getBoundingClientRect(); menu(OP_ALGOS.map((_, n) => ({ label: 'Algoritma ' + (n + 1), check: n === Math.round(k.get(68)), fn: () => k.set(68, n) })), r.left, r.bottom + 1); return false; }, onMove: () => {} });
  const glob = k.col(k.row(k.col(h('div', { class: 'lk-st' }, 'Algorithm'), algo), k.col(k.T(69, 'Filter'), k.CH(70, ['Low', 'High', 'Band'], { v: true }))),
    k.row(k.K(71, { n: 'Freq' }), k.K(72, { n: 'Res' }), k.K(73, { n: 'Env' }), k.K(74, { n: 'Attack' }), k.K(75, { n: 'Decay' })));
  const g2 = k.col(k.row(k.K(77), k.K(78), k.K(79)), k.row(k.K(76), k.K(81)), k.row(k.TL('Transpose', k.N(80, { w: 60, fill: false })), k.TL('PB Range', k.N(82, { w: 56 })), k.TL('Voices', k.N(83, { w: 50 }))));
  return k.row(tn(h('div', { class: 'lk-ops' }, ...rows), 'Operators'), tn(right, 'Envelope'), k.sep(), tn(glob, 'Filter'), k.sep(), tn(g2, 'Global'));
};
// Analog: section rows (Osc1 / Noise / Osc2 left, Fil1 / Fil2 / Amp1 / Amp2 / LFO1 / LFO2 right, Global); tapping a row shows its details in
// the dark display between them (Live: the display follows the selected section): Slope LIN / EXP, Legato, Free, the section's envelope
// (drag the points) and its extra parameters
const ANST = new Map();
VI[15] = (k) => {
  const st = ANST.get(k.d.id) || { sec: 'fil0' }; ANST.set(k.d.id, st);
  const disp = h('div', { class: 'lk-andisp' }), rowsEls = [];
  const sel = (key, row) => { st.sec = key; for (const r of rowsEls) r.classList.toggle('sel', r === row); fill(); };
  const box = (key, ...kids) => { const r = h('div', { class: 'lk-anrow' + (st.sec === key ? ' sel' : '') }, ...kids.filter(Boolean)); r.addEventListener('pointerdown', (e) => { if (e.target.closest('.knob, button, .lv-fld')) return; sel(key, r); }); rowsEls.push(r); return r; };
  const tg = (j, t) => k.T(j, t, { cls: 'lk-antg' });
  const f12 = (j) => k.TL('F1/F2', k.N(j, { w: 64 }));
  const osc = (o) => { const b = o * 12; return box('osc' + o, k.col(k.row(tg(b, 'Osc' + (o + 1)), k.N(b + 1, { w: 66 })), k.LN('F1/F2', k.N(b + 2, { w: 66 }))), k.TL('Shape', waveSel(k, b + 3, '#ddd')), k.K(b + 4, { n: 'Octave' }), k.K(b + 5, { n: 'Semi' }), k.K(b + 6, { n: 'Detune' })); };
  const noise = box('noise', k.col(k.row(tg(24, 'Noise'), k.N(25, { w: 66 })), k.LN('F1/F2', k.N(26, { w: 66 }))), k.K(27, { n: 'Color' })); void f12;
  const fil = (f) => { const b = 28 + f * 12; return box('fil' + f, k.col(k.row(tg(b, 'Fil' + (f + 1)), k.S(b + 1, { w: 66 })), f ? k.T(53, 'Follow', { w: 70 }) : k.LN('To F2', k.N(52, { w: 66 }))), k.K(b + 2, { n: 'Freq' }), k.K(b + 3, { n: 'Res' })); };
  const amp = (a) => { const b = 54 + a * 8; return box('amp' + a, k.col(tg(b, 'Amp' + (a + 1)), k.N(b + 1, { w: 66 })), k.K(b + 2, { n: 'Pan' })); };
  const lfo = (l) => { const b = 70 + l * 5; return box('lfo' + l, k.col(tg(b, 'LFO' + (l + 1)), waveSel(k, b + 1, '#ddd')), k.K(b + 2, { n: 'Rate' })); };
  const glob = box('glob', k.col(h('span', { class: 'lk-st' }, 'Global'), k.S(80, { w: 66 })), k.K(87, { n: 'Volume' }));
  function envDisp(a, d, s2, r) {
    const W = 200, H = 96;
    return k.D(W, H, (g, w, hh) => { const pts = lvEnvPts(w, hh, k.get(a) / 1000, k.get(d) / 1000, k.get(s2), k.get(r) / 1000, 8), lin = k.get(89) < 0.5;
      const curve = lin ? pts : [pts[0], ...[1, 2, 3, 4].flatMap((n) => { const [x0, y0] = pts[n - 1], [x1, y1] = pts[n]; return Array.from({ length: 12 }, (_, j) => { const t = (j + 1) / 12, e = n === 1 ? t : 1 - Math.exp(-4 * t); return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * (n === 3 ? t : e / (1 - Math.exp(-4)))]; }); })];
      lvPath(g, curve, DISPC.bl, null, 1.6); g.strokeStyle = DISPC.or; g.lineWidth = 1.3; for (const n of [1, 2, 4]) g.strokeRect(pts[n][0] - 3.5, pts[n][1] - 3.5, 7, 7); },
    { onDown: (x) => ({ j: x < W * 0.3 ? a : x < W * 0.6 ? s2 : r, v0: 0 }), onMove: (x, y, dx, dy, s) => { const p = k.def.params[s.j]; if (s.j === s2) k.set(s2, Math.max(0, Math.min(1, 1 - (y - 8) / (H - 16)))); else k.set(s.j, Math.max(p.min, Math.min(p.max, (s.v0 || (s.v0 = k.get(s.j))) * Math.pow(2, dx / 40)))); } });
  }
  const T = (n, j, o2 = {}) => k.TL(n, k.NT(j, { w: o2.w || 62, cls: o2.or ? 'or' : '' }));
  function fill() {
    const sec = st.sec, n = +sec.slice(-1), head = k.row(h('span', { class: 'lk-lb' }, 'Slope'), k.CH(89, ['LIN', 'EXP'], { cls: 'cy' }), k.T(84, 'Legato', { cls: 'lk-chk' }), k.T(91, 'Free', { cls: 'lk-chk' }));
    let body;
    if (sec.startsWith('fil')) { const b = 28 + n * 12; body = k.row(envDisp(b + 7, b + 8, b + 9, b + 10), k.col(k.row(T('Attack', b + 7), T('Decay', b + 8)), k.row(T('Sustain', b + 9), T('Release', b + 10)), k.row(T('Env', b + 4), T('Key', b + 5)), k.row(k.TL('Drive', k.S(b + 6, { w: 70, cls: 'dk or' })), T('LFO' + (n + 1), b + 11, { or: true })))); }
    else if (sec.startsWith('amp')) { const b = 54 + n * 8; body = k.row(envDisp(b + 3, b + 4, b + 5, b + 6), k.col(k.row(T('Attack', b + 3), T('Decay', b + 4)), k.row(T('Sustain', b + 5), T('Release', b + 6)), k.row(T('LFO' + (n + 1), b + 7, { or: true })))); }
    else if (sec.startsWith('osc')) { const b = n * 12; body = k.row(k.col(k.row(T('PW', b + 7), T('Sub', b + 8)), k.row(T('PEG (Fil' + (n + 1) + ' Env)', b + 9, { w: 70 }), T('LFO' + (n + 1), b + 10, { or: true })), k.row(k.TL('Key', k.T(b + 11, 'On', { w: 40 }))))); }
    else if (sec === 'noise') body = k.row(T('Color', 27), T('F1/F2', 26));
    else if (sec.startsWith('lfo')) { const b = 70 + n * 5; body = k.row(T('Rate', b + 2), k.TL('Retrig', k.T(b + 3, 'On', { w: 40 })), T('Phase', b + 4)); }
    else body = k.col(k.row(k.TL('Unison', k.S(81, { w: 64, cls: 'dk' })), T('Detune', 82), T('Glide', 83)), k.row(T('Vibrato', 85), T('Vib Rate', 86), T('PB Range', 88)));
    disp.replaceChildren(k.dk(head, body));
  }
  fill();
  return k.row(tn(h('div', { class: 'lk-ancol' }, osc(0), noise, osc(1)), 'Osc'), tn(disp, 'Display'), tn(h('div', { class: 'lk-ancol' }, fil(0), fil(1), k.row(amp(0), amp(1))), 'Filter / Amp'), tn(h('div', { class: 'lk-ancol' }, lfo(0), lfo(1), glob), 'LFO / Global'));
};
// Poli: oscilloscope display (XMod, PW, Sub Wave, Color, RM Source), mixer (Saw, Pulse, Sub, Noise | Ring, Freq), LFO (shape, Sync, R, Rate,
// Fade-In), filter (Sub boost, Loop, HPF, LPF, Res, envelope), modulation grid (Modulators / MIDI tabs), Chorus, Random Pan, Volume, PBend + All,
// Glide, Voices / Spread, amp envelope
const ICO_SAW = 'M1 10L12 2V10', ICO_SQ = 'M1 10V2H7V10H13';
function icoTog(k, j, icons) { const b = h('button', { class: 'lk-icot' }); const draw = () => { b.innerHTML = `<svg viewBox="0 0 14 12" width="22" height="16"><path d="${icons[Math.round(k.get(j))]}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`; };
  b.onclick = () => { k.set(j, Math.round(k.get(j)) ? 0 : 1); draw(); }; b.update = draw; draw(); return k.reg(b, j); }
VI[16] = (k) => {
  const scope = k.D(300, 78, (g, w, hh) => {
    const saw = k.get(5) ** 2, pul = k.get(6) ** 2, sub = k.get(7) ** 2, pw = 0.5 - k.get(1) * 0.45, sw = Math.round(k.get(2)), nz = k.get(8) ** 2, pts = [];
    let seed = 7; const r = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    for (let x = 0; x <= w; x++) { const t = x / w * 4, a = t - Math.floor(t), s2 = (t / 2) - Math.floor(t / 2), y = (saw * (2 * a - 1) + pul * (a < pw ? 1 : -1) + sub * (sw ? 2 * s2 - 1 : (s2 < 0.5 ? 1 : -1)) + nz * r() * 1.5) / Math.max(0.4, saw + pul + sub); pts.push([x, hh / 2 - y * (hh / 2 - 8)]); }
    lvPath(g, pts, '#f5a623', null, 1.5);
  });
  const O = (n, j) => k.TL(n, k.NT(j, { w: 54, cls: 'or' }));
  const osc = k.col(k.dk(scope, k.row(O('XMod', 0), O('PW', 1), k.TL('Sub Wave', icoTog(k, 2, [ICO_SQ, ICO_SAW])), O('Color', 3), k.TL('RM Source', icoTog(k, 4, [ICO_SAW, ICO_SQ])))),
    k.row(k.K(5), k.K(6), k.K(7), k.K(8), k.sep(), k.K(9), k.K(10)));
  const lfo = k.col(k.row(k.col(k.TL('LFO Shape', k.S(11, { w: 100 })), k.row(k.T(12, 'Sync', { cls: 'cyt', w: 70 }), k.T(13, 'R', { cls: 'lk-r', w: 22 }))), k.swap(12, () => k.K(15, { n: 'Rate' }), () => k.K(14)), k.K(16)),
    k.row(k.col(k.T(17, 'Sub', { w: 50 }), k.T(21, 'Loop', { w: 50 })), k.K(18), k.K(19), k.K(20, { n: 'Res' })),
    k.row(k.K(22, { n: 'Attack' }), k.K(23, { n: 'Decay' }), k.K(24, { n: 'Sustain' }), k.K(25, { n: 'Release' })));
  const page = h('div', { class: 'lk-page' }), cellsOf = (map, cols) => h('div', { class: 'lk-pgrid', style: `grid-template-columns: 70px repeat(${cols.length}, 64px)` },
    h('span', { class: 'lk-pgh' }, 'Target'), ...cols.map((c) => h('span', { class: 'lk-pgh u' }, c)),
    ...POLI_TGT.flatMap((tn, t) => [h('span', { class: 'lk-pgt' }, tn), ...cols.map((_, s2) => { const j = map[t + ',' + s2]; return j === undefined ? h('span', { class: 'lk-pgx' }, '-') : k.NT(j, { w: 60 }); })]));
  const tabs = [() => cellsOf(POLI_GRID, ['LFO', 'Filter Env', 'Amp Env']), () => cellsOf(POLI_MIDI, ['Velocity', 'Key'])];
  const tb = lvTabs([{ label: 'Modulators' }, { label: 'MIDI' }], 0, (j) => page.replaceChildren(tabs[j]()), { cls: 'lk-tabs lk-ptabs' }); page.replaceChildren(tabs[0]());
  const mods = k.dk(tb, page);
  const glob = k.col(k.row(k.TL('Chorus', k.CH(58, ['-', 'A', 'B', 'C'], { cls: 'g2 sm' })), k.TL('Random Pan', k.N(59, { w: 70 })), k.K(60)),
    k.row(k.col(h('span', { class: 'lk-lb' }, 'PBend'), k.N(61, { w: 62 }), k.T(62, 'All', { w: 62 })), k.col(h('span', { class: 'lk-lb' }, 'Glide'), k.S(63, { w: 70 }), k.N(64, { w: 70, fill: false })), k.col(h('span', { class: 'lk-lb' }, 'Voices/Spread'), k.S(65, { w: 76 }), k.N(66, { w: 76, fill: false }))),
    k.row(k.K(67, { n: 'Attack' }), k.K(68, { n: 'Decay' }), k.K(69, { n: 'Sustain' }), k.K(70, { n: 'Release' })));
  return k.row(tn(osc, 'Osc'), k.sep(), tn(lfo, 'LFO'), k.sep(), tn(mods, 'Mod'), k.sep(), tn(glob, 'Global'));
};
// Meld: Engines (A / B oscillator with picture, prev / next, oct / sd / ct; Shape / Tone), dark centre with A / B / Settings tabs (Envelopes or
// LFOs of the engine; Settings = modulation grid, Copy to B, PB Range), Filters (type, Freq, Q, third control), Mix (pan, Tone, level fader),
// global (Limit, voice mode, voices, Spread, Stack, Drive, Volume)
const MLC = ['#2fd3e8', '#ffad32'], MLST = new Map();
function meldWave(type, sh, tn, x) {
  const a = x - Math.floor(x), s = Math.sin(2 * Math.PI * a);
  switch (type) { case 1: return (s + Math.sin(2 * Math.PI * a * (1 + sh * 0.05)) + Math.sin(2 * Math.PI * a * (1 - sh * 0.05))) / 3; case 2: return Math.sin(2 * Math.PI * a + tn * 4 * Math.sin(2 * Math.PI * a * (1 + Math.round(sh * 7)))); case 3: return Math.sin(Math.sin(2 * Math.PI * a + tn * 3 * Math.sin(4 * Math.PI * a)) * (1 + sh * 5) * Math.PI / 2);
    case 4: return (2 * a - 1) * (0.6 + tn * 0.4) * Math.cos(a * (2 + sh * 20)); case 5: return Math.sin(a * 37.1 + Math.sin(a * 91.7) * 3) * (1 - a * 0.5); case 6: { const q = Math.pow(2, 2 + Math.round((1 - sh) * 10)); return Math.round(s * q) / q; } case 7: return a < [0.125, 0.25, 0.5, 0.75][Math.min(3, Math.floor(sh * 4))] ? 1 : -1;
    default: { const k = sh * 3, sq = a < 0.5 - tn * 0.4 ? 1 : -1, w = [s, 1 - 4 * Math.abs(a - 0.5), 2 * a - 1, sq], i0 = Math.min(2, Math.floor(k)), f = k - i0; return w[i0] * (1 - f) + w[i0 + 1] * f; } }
}
VI[17] = (k) => {
  const st = MLST.get(k.d.id) || { tab: 0, sub: 1, matE: 0 }; MLST.set(k.d.id, st);
  const B = (e) => (e ? MELD_B : 0), O = MO, badge = (e) => h('span', { class: 'lk-mbadge', style: `--mc:${MLC[e]}` }, 'AB'[e]);
  const engRow = (e) => {
    const b = B(e), pic = k.D(96, 40, (g, w, hh) => { const pts = []; for (let x = 0; x <= w; x++) pts.push([x, hh / 2 - meldWave(Math.round(k.get(b)), k.get(b + O.shape), k.get(b + O.tone), x / w * 2) * (hh / 2 - 4)]); lvPath(g, pts, k.get(b + O.on) > 0.5 ? MLC[e] : '#777', null, 1.4); });
    const step = (d) => lvBtn(d < 0 ? '◀' : '▶', () => { const n = MELD_OSC.length; k.set(b, (Math.round(k.get(b)) + d + n) % n); }, { cls: 'lk-marr' });
    const on = k.T(b + O.on, 'AB'[e], { cls: 'lk-mbadge', w: 18 }); on.style.setProperty('--mc', MLC[e]);
    return k.dk(k.row(on, k.S(b, { w: 100, cls: 'dk' })), k.row(step(-1), pic, step(1)), k.row(k.NT(b + O.oct, { w: 44 }), k.NT(b + O.semi, { w: 40 }), k.NT(b + O.fine, { w: 40 })));
  };
  const macros = (e) => k.row(k.K(B(e) + O.shape, { n: 'Shape', col: e ? '#999' : MLC[0] }), k.K(B(e) + O.tone, { n: 'Tone', col: e ? '#999' : MLC[0] }));
  const centre = h('div', { class: 'lk-mcen' });
  const env = (e, base, name) => { const d = k.D(150, 46, (g, w, hh) => lvPath(g, lvEnvPts(w, hh, k.get(base) / 1000, k.get(base + 1) / 1000, k.get(base + 2), k.get(base + 3) / 1000, 4), MLC[e], hh, 1.5)); return k.col(h('span', { class: 'lk-st c' }, name), d, k.row(k.K(base, { n: 'Attack' }), k.K(base + 1, { n: 'Decay' }), k.K(base + 2, { n: 'Sustain' }), k.K(base + 3, { n: 'Release' }))); };
  const lfoD = (e, wj, sj, fj, pj, w = 150) => k.D(w, 50, (g, ww, hh) => { const pts = []; for (let x = 0; x <= ww; x++) { let t = x / ww * 2 + (pj >= 0 ? k.get(pj) / 360 : 0), a = t - Math.floor(t); const sh = sj >= 0 ? k.get(sj) : 0; if (sh) a = sh > 0 ? Math.pow(a, 1 + sh * 3) : 1 - Math.pow(1 - a, 1 - sh * 3);
    let y; switch (Math.round(k.get(wj))) { case 1: y = 1 - 4 * Math.abs(a - 0.5); break; case 2: y = 2 * a - 1; break; case 3: y = a < 0.5 ? 1 : -1; break; case 4: case 5: { const r = Math.sin(Math.floor(t * 4) * 12.9898) * 43758.5; y = (r - Math.floor(r)) * 2 - 1; break; } default: y = Math.sin(2 * Math.PI * a); }
    if (fj >= 0 && k.get(fj) > 0) y = Math.sin(y * (1 + k.get(fj) * 4) * Math.PI / 2); pts.push([x, hh / 2 - y * (hh / 2 - 5)]); } lvPath(g, pts, MLC[e], null, 1.5); });
  const lfos = (e) => { const b = B(e);
    return k.row(k.col(h('span', { class: 'lk-st c' }, 'LFO 1'), lfoD(e, b + O.l1w, b + O.l1sh, b + O.l1f, b + O.l1p), k.row(k.S(b + O.l1w, { w: 80, cls: 'dk' }), k.NT(b + O.l1p, { w: 46 }), k.T(b + O.l1rt, 'R', { cls: 'lk-r', w: 20 })),
        k.row(k.CH(b + O.l1s, ['Hz', '♪'], { v: true, cls: 'sm cy' }), k.swap(b + O.l1s, () => k.K(b + O.l1d, { n: 'Rate' }), () => k.K(b + O.l1r, { n: 'Rate' })), k.K(b + O.l1sh, { n: 'Shape' }), k.K(b + O.l1f, { n: 'Fold' }))),
      h('span', { class: 'lk-lb lk-arrow' }, '›'),
      k.col(h('span', { class: 'lk-st c' }, 'LFO 1 FX'), lfoD(e, b + O.l1w, b + O.l1sh, b + O.l1f, b + O.l1p), k.row(h('span', { class: 'lk-lb' }, 'FX1 Attenuv.'), h('span', { class: 'lk-lb' }, 'FX2 Fade In')), k.row(k.K(b + O.fx1, { n: 'Scale' }), k.K(b + O.fx2, { n: 'Ramp' }))), k.sep(),
      k.col(h('span', { class: 'lk-st c' }, 'LFO 2'), lfoD(e, b + O.l2w, -1, -1, b + O.l2p, 70), k.S(b + O.l2w, { w: 70, cls: 'dk' }), k.swap(b + O.l2s, () => k.NT(b + O.l2d, { w: 60 }), () => k.NT(b + O.l2r, { w: 60 })), k.CH(b + O.l2s, ['Hz', '♪'], { cls: 'sm cy' }), k.row(k.NT(b + O.l2p, { w: 44 }), k.T(b + O.l2rt, 'R', { cls: 'lk-r', w: 20 })))); };
  const grid = () => { const e = st.matE, b = B(e) + O.mat;
    return k.col(k.row(lvChoice([{ label: 'A' }, { label: 'B' }], () => st.matE, (j) => { st.matE = j; fill(); }, { cls: 'lk-ch sm' }), lvBtn('Copy to B', () => { for (let j = 0; j < MELD_N; j++) if (j !== O.on) k.set(MELD_B + j, k.get(j)); fill(); }, { cls: 'lk-t' }), h('span', { class: 'lk-grow' }), k.LN('PB Range', k.N(MELD_G + 7, { w: 52 }))),
      h('div', { class: 'lk-pgrid', style: 'grid-template-columns: 96px repeat(5, 52px)' }, h('span', { class: 'lk-pgh' }, 'Target'), ...MELD_SRC.map((s2) => h('span', { class: 'lk-pgh u' }, s2)),
        ...MELD_TGT.flatMap((tn, t) => [h('span', { class: 'lk-pgt' }, tn), ...MELD_SRC.map((_, s2) => k.NT(b + t * 5 + s2, { w: 50 }))]))); };
  function fill() {
    const e = st.tab;
    const body = e === 2 ? grid() : k.col(k.row(lvTabs([{ label: 'Envelopes' }, { label: 'LFOs' }], st.sub, (j) => { st.sub = j; fill(); }, { cls: 'lk-msub' })),
      st.sub === 0 ? k.row(env(e, B(e) + O.aenv, 'A Env'), k.sep(), env(e, B(e) + O.menv, 'M Env')) : lfos(e));
    centre.replaceChildren(lvTabs([{ label: 'A' }, { label: 'B' }, { label: 'Settings' }], st.tab, (j) => { st.tab = j; fill(); }, { cls: 'lk-tabs lk-mtabs' }), k.dk(body));
  }
  fill();
  const filt = (e) => { const b = B(e), third = k.swapN(b + O.ftype, (t) => k.TL(['L-B-H-N', 'L-B-H-N', 'Drive', 'Feedback'][t], k.N(b + O.morph, { w: 62, fill: false })));
    return k.row(k.col(k.row(badge(e), k.S(b + O.ftype, { w: 90 })), k.K(b + O.freq, { n: '' })), k.col(k.TL('Q', k.N(b + O.q, { w: 62, fill: false })), third)); };
  const fader = (e) => { const b = B(e) + O.level, W = 16, H = 78;
    const c = k.D(W, H, (g, w, hh) => { const y = hh - (k.get(b) + 60) / 66 * hh; g.fillStyle = '#555'; g.fillRect(w / 2 - 1, 0, 2, hh); g.fillStyle = MLC[e]; g.fillRect(2, y - 2, w - 4, 4); }, { onDown: () => ({ v: k.get(b) }), onMove: (x, y, dx, dy, s) => k.set(b, Math.max(-60, Math.min(6, s.v - dy * 0.5))) });
    return k.col(c, k.NT(b, { w: 54 })); };
  const mix = (e) => k.row(k.col(k.N(B(e) + O.pan, { w: 40, fill: false }), k.K(B(e) + O.tilt, { n: 'Tone' })), fader(e));
  const glob = k.col(k.T(MELD_G + 6, 'Limit', { w: 70 }), k.S(MELD_G, { w: 70 }), k.N(MELD_G + 1, { w: 70 }), k.TL('Spread', k.N(MELD_G + 2, { w: 70 })), k.TL('Stack', k.S(MELD_G + 3, { w: 70 })), k.TL('Drive', k.N(MELD_G + 4, { w: 70 })), k.K(MELD_G + 5));
  // Filters + Mix as ONE grid: a header line, then engine A and engine B as two identical boxed rows - filter (badge + type over the
  // frequency dial) | Q / L-B-H-N | pan over Tone | level fader with its dB value; every column lines up from A to B
  const fmRow = (e) => { const b = B(e), third = k.swapN(b + O.ftype, (t) => k.TL(['L-B-H-N', 'L-B-H-N', 'Drive', 'Feedback'][t], k.N(b + O.morph, { w: 66, fill: false })));
    return h('div', { class: 'lk-mfr' }, k.col(k.row(badge(e), k.S(b + O.ftype, { w: 96 })), k.K(b + O.freq, { n: '' })), k.col(k.TL('Q', k.N(b + O.q, { w: 66, fill: false })), third),
      k.col(k.N(B(e) + O.pan, { w: 44, fill: false }), k.K(B(e) + O.tilt, { n: 'Tone' })), fader(e)); };
  const fm = h('div', { class: 'lk-mfm' }, h('div', { class: 'lk-mfh' }, h('span', { class: 'lk-st' }, 'Filters'), h('span', { class: 'lk-st' }, 'Mix')), fmRow(0), fmRow(1));
  return k.row(k.sec('Engines', k.row(engRow(0), macros(0)), k.row(engRow(1), macros(1))), tn(centre, 'Mod'), tn(fm, 'Filters / Mix'), k.sep(), tn(glob, 'Global'));
};
// Simpler: Sample tab (waveform with start / end / loop / slice markers - drag them; Classic / 1-Shot / Slice and their controls, Warp) and
// Controls tab (filter display, LFO, pitch envelope, amplitude / pitch, then the Filter / LFO strip and Fade / Transp / Vol < Vel / Volume)
const SMST = new Map(), SY = '#f5e03a';
VI[18] = (k) => {
  const { i } = k.ctx, t = P.state.tracks[i], st = SMST.get(k.d.id) || { tab: 0 }; SMST.set(k.d.id, st);
  const Z = () => (t.inst.zones && t.inst.zones[0]) || P.newZone(), zset = (f, v, quiet = true) => P.setZoneField(i, 0, f, v, quiet);
  const pick = () => BR.openBrowser('file', { track: i, zone: 0 });
  const zNum = (n, get, set, o = {}) => k.TL(n, lvNum({ n, min: o.min ?? 0, max: o.max ?? 1, def: o.def ?? 0 }, get, (v) => { set(v); wave.paint(); }, (pp, v) => (o.fmt ? o.fmt(v) : (v * 100).toFixed(1) + ' %'), { w: 62, cls: 'lk-nt or' }));
  const W = 884, H = 134, X = (f) => 6 + f * (W - 12), Fx = (x) => Math.max(0, Math.min(1, (x - 6) / (W - 12)));
  const slicesUI = () => {                                                    // the same rules as the engine (transients approximated on the peaks)
    const z = Z(), s = z.sample; if (!s) return []; const a = Math.min(z.s0, z.s1), b = Math.max(z.s0, z.s1), by = Math.round(k.get(9)), out = [a];
    if (by === 0) { const pk = s.peaks || [], n = pk.length, thr = 1.5 + (1 - k.get(10)) * 6; let prev = 1e-6, last = -1; for (let j = Math.floor(a * n); j < Math.floor(b * n); j++) { const e = (pk[j] || 0) ** 2; if (e > prev * thr && e > 1e-5 && (last < 0 || (j - last) / n * (s.duration || 1) > 0.05)) { out.push(j / n); last = j; } prev = prev * 0.6 + e * 0.4; if (out.length >= 64) break; } }
    else if (by === 1) { const beats = Math.max(1, Math.round(k.get(15))), div = [0.25, 0.5, 1, 2, 4][Math.round(k.get(11))], m = Math.max(1, Math.round(beats / div)); for (let q = 1; q < Math.min(64, m); q++) out.push(a + (b - a) * q / m); }
    else { const m = Math.round(k.get(12)); for (let q = 1; q < m; q++) out.push(a + (b - a) * q / m); }
    return out.filter((x, j) => j === 0 || x > out[j - 1] + 1e-4);
  };
  const wave = k.D(W, H, (g, w, hh) => {
    const z = Z(), s = z.sample, mode = Math.round(k.get(0));
    if (!s) { label(g, 'Drop Sample Here', w / 2, hh / 2 + 4, '#bbb', 12, 'center'); return; }
    const pk = s.peaks || [], n = pk.length, a = Math.min(z.s0, z.s1), b = Math.max(z.s0, z.s1), mid = hh / 2 + 4;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, X(a), hh); g.fillRect(X(b), 0, w - X(b), hh);
    g.beginPath(); g.moveTo(6, mid); for (let x = 0; x <= w - 12; x++) g.lineTo(6 + x, mid - (pk[Math.min(n - 1, Math.floor(x / (w - 12) * n))] || 0) * (hh / 2 - 10)); for (let x = w - 12; x >= 0; x--) g.lineTo(6 + x, mid + (pk[Math.min(n - 1, Math.floor(x / (w - 12) * n))] || 0) * (hh / 2 - 10)); g.closePath(); g.fillStyle = SY; g.fill();
    const mark = (x, col, top = true) => { g.fillStyle = col; g.fillRect(Math.round(x), 0, 1, hh); g.beginPath(); if (top) { g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 8); } else { g.moveTo(x - 5, hh); g.lineTo(x + 5, hh); g.lineTo(x, hh - 8); } g.fill(); };
    mark(X(a), '#ddd'); mark(X(b), '#ddd');
    if (mode === 0 && k.get(2) > 0.5) { const la = a + Math.min(z.l0, z.l1) * (b - a), lb = a + Math.max(z.l0, z.l1) * (b - a); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(X(la), 0, X(lb) - X(la), hh); mark(X(la), '#ffad32', false); mark(X(lb), '#ffad32', false); }
    if (mode === 2) slicesUI().forEach((x, j) => { if (j) mark(X(x), '#ff8a3d'); label(g, String(j + 1), X(x) + 3, hh - 4, '#ccc', 9); });
    if (k.get(14) > 0.5) label(g, 'WARP ' + Math.round(k.get(15)) + ' Beats', w - 8, 14, '#ffad32', 10, 'right');
  }, { onDown: (x) => {
    const z = Z(); if (!z.sample) { pick(); return false; }
    const a = Math.min(z.s0, z.s1), b = Math.max(z.s0, z.s1), f = Fx(x), cand = [['s0', a], ['s1', b]];
    if (Math.round(k.get(0)) === 0 && k.get(2) > 0.5) cand.push(['l0', a + Math.min(z.l0, z.l1) * (b - a)], ['l1', a + Math.max(z.l0, z.l1) * (b - a)]);
    let best = null, bd = 1e9; for (const [nm, v] of cand) { const d = Math.abs(X(v) - x); if (d < bd) { bd = d; best = nm; } } return { m: best, a, b, f };
  }, onMove: (x, y, dx, dy, s) => {
    const f = Fx(x), z = Z();
    if (s.m === 's0') zset('s0', Math.min(f, Math.max(z.s0, z.s1) - 0.001)); else if (s.m === 's1') zset('s1', Math.max(f, Math.min(z.s0, z.s1) + 0.001));
    else { const rel = Math.max(0, Math.min(1, (f - s.a) / Math.max(1e-4, s.b - s.a))); zset(s.m, rel); }
    wave.paint();
  }, onUp: () => P.emit('devices') });
  const modeBtns = k.CH(0, ['Classic', '1-Shot', 'Slice'], { cls: 'lk-smode' });
  const classic = () => k.row(zNum('Start', () => Z().s0, (v) => zset('s0', Math.min(v, Z().s1 - 0.001))), zNum('Length', () => Math.max(Z().s0, Z().s1) - Math.min(Z().s0, Z().s1), (v) => zset('s1', Math.min(1, Z().s0 + Math.max(0.001, v)))),
    zNum('Loop', () => 1 - Math.min(Z().l0, Z().l1), (v) => { zset('l0', 1 - v); zset('l1', 1); }), zNum('Fade', () => Z().xf, (v) => zset('xf', v)), k.sep(), k.T(2, 'Loop', { w: 48 }), k.T(3, 'Snap', { w: 48 }), k.sep(), k.TL('Voices', k.NT(4, { w: 44, cls: 'or' })), k.TL('Retrig', k.T(5, 'R', { cls: 'lk-r', w: 22 })));
  const oneshot = () => k.row(k.TL('Mode', k.CH(6, ['Trigger', 'Gate'], { cls: 'lk-orb' })), k.sep(), k.TL('Fade In', k.NT(7, { w: 62, cls: 'or' })), k.TL('Fade Out', k.NT(8, { w: 62, cls: 'or' })));
  const slice = () => k.row(k.TL('Slice By', k.S(9, { w: 96, cls: 'dk or' })), k.swapN(9, (by) => (by === 0 ? k.TL('Sensitivity', k.NT(10, { w: 62, cls: 'or' })) : by === 1 ? k.TL('Division', k.S(11, { w: 70, cls: 'dk or' })) : k.TL('Regions', k.NT(12, { w: 62, cls: 'or' })))), k.sep(), k.TL('Playback', k.S(13, { w: 70, cls: 'dk or' })));
  const warp = h('div', { class: 'lk-row lk-swarp' }, k.T(14, 'WARP', { cls: 'lk-warp', w: 60 }), h('span', { class: 'lk-lb' }, 'as'), k.NT(15, { w: 66, cls: 'or' }), lvBtn(':2', () => k.set(15, Math.max(1, Math.round(k.get(15) / 2))), { cls: 'lk-t', w: 30 }), lvBtn('×2', () => k.set(15, Math.min(64, k.get(15) * 2)), { cls: 'lk-t', w: 30 }), k.S(16, { w: 80, cls: 'dk or' }));
  // header: sample name + chooser left, Warp right; waveform; one bar: mode switch, Gain, the mode's controls (all on one baseline)
  const sampleTab = () => k.dk(h('div', { class: 'lk-row lk-shead' }, h('span', { class: 'lk-st' }, (Z().sample && Z().sample.name) || 'Tanpa sample'), lvBtn('Sample…', pick, { cls: 'lk-t' }), h('span', { class: 'lk-grow' }), warp), wave,
    h('div', { class: 'lk-row lk-sbar' }, modeBtns, k.sep(), k.TL('Gain', k.NT(1, { w: 56, cls: 'or' })), k.sep(), k.swapN(0, (m) => (m === 0 ? classic() : m === 1 ? oneshot() : slice()))));
  // ---- Controls: three columns as in Live (Filter | LFO | Pitch Envelope + Amplitude / Pitch), each display above its control strip
  const O = (n, j, w = 50) => k.TL(n, k.NT(j, { w, cls: 'or' }));
  const fdisp = k.D(256, 96, (g, w, hh) => {
    grid(g, w, hh); const b = new Biquad(), ty = Math.round(k.get(18)), f = k.get(21), q = 0.6 + k.get(22) * 8;
    if (ty === 1) b.highpass(SR, f, q); else if (ty === 2) b.bandpass(SR, f, q); else if (ty === 3) b.notch(SR, f, q); else b.lowpass(SR, f, q);
    const pts = []; for (let x = 0; x <= w; x += 2) { let m = mag(b, xl(x, w)); if (Math.round(k.get(19)) === 1) m *= m; pts.push([x, hh - 6 - Math.min(2, m) / 2 * (hh - 12)]); }
    lvPath(g, pts, k.get(17) > 0.5 ? '#ff9a2e' : DISPC.grid2, null, 1.8); lvRing(g, Math.max(6, Math.min(w - 6, lx(f, w))), hh * 0.45, 5);
  }, { onDown: () => ({ f: k.get(21), r: k.get(22) }), onMove: (x, y, dx, dy, s) => { k.set(21, Math.max(20, Math.min(22000, s.f * Math.pow(2, dx / 24)))); k.set(22, Math.max(0, Math.min(1, s.r - dy / 80))); } });
  const ldisp = k.D(166, 56, (g, w, hh) => { const wf = Math.round(k.get(31)), pts = []; for (let x = 0; x <= w; x++) { const a = (x / w * 3 + k.get(37) / 360) % 1; const y = wf === 1 ? (a < 0.5 ? 1 : -1) : wf === 2 ? 1 - 4 * Math.abs(a - 0.5) : wf === 3 ? 1 - 2 * a : wf === 4 ? 2 * a - 1 : wf === 5 ? Math.sin(Math.floor(x / w * 12) * 7.3) : Math.sin(2 * Math.PI * a); pts.push([x, hh / 2 - y * (hh / 2 - 5)]); } lvPath(g, pts, '#ff9a2e', null, 1.6); });
  const pdisp = k.D(250, 80, (g, w, hh) => lvPath(g, lvEnvPts(w, hh, k.get(45) / 1000, k.get(46) / 1000, k.get(47), k.get(48) / 1000, 6), '#ff9a2e', null, 1.6));
  const R = (n, j) => k.LN(n, k.NT(j, { w: 64, cls: 'or' }));
  const cell = (cls, ...kids) => h('div', { class: 'lk-scell ' + cls }, ...kids.filter(Boolean));
  const controlsTab = () => h('div', { class: 'lk-sgrid' },
    k.dk(fdisp, h('div', { class: 'lk-row lk-sev' }, O('Vel', 23), O('Key', 24), O('Env', 25))),
    k.dk(h('div', { class: 'lk-row lk-sev' }, O('Attack', 35, 46), O('Key', 36, 40), O('Offset', 37, 40), k.TL('Retrig', k.T(38, 'R', { cls: 'lk-r', w: 22 }))), ldisp,
      h('div', { class: 'lk-row lk-sev' }, O('Vol', 39, 38), O('Pitch', 40, 38), O('Pan', 41, 38), O('Filter', 42, 38))),
    k.dk(h('div', { class: 'lk-row lk-shead' }, k.T(43, '', { cls: 'lk-chkbox' }), h('span', { class: 'lk-st' }, 'Pitch Envelope'), h('span', { class: 'lk-grow' }), R('Amount', 44)),
      h('div', { class: 'lk-row lk-shead' }, pdisp, h('div', { class: 'lk-col lk-sadsr' }, R('Attack', 45), R('Decay', 46), R('Sustain', 47), R('Release', 48))),
      h('div', { class: 'lk-s7' }, h('span', { class: 'lk-dkh s3' }, 'Amplitude'), h('span', { class: 'lk-dkh s4' }, 'Pitch'),
        O('Pan', 49, 0), O('Ran>Pan', 50, 0), O('Spread', 51, 0), O('Transp', 52, 0), O('Detune', 53, 0), k.TL('Glide', k.S(54, { w: 54, cls: 'dk or' })), O('Time', 55, 0))),
    cell('', k.col(k.row(k.T(17, 'Filter', { w: 52 }), k.S(18, { w: 76 })), k.row(k.CH(19, ['12', '24']), k.S(20, { w: 64 }))), k.K(21), k.K(22)),
    cell('', k.col(k.row(k.T(30, 'LFO', { w: 52 }), k.S(31, { w: 76 })), k.row(k.CH(32, ['Hz', '♪'], { cls: 'sm' }), k.swap(32, () => k.N(34, { w: 64 }), () => k.N(33, { w: 64 }))))),
    cell('', k.swapN(0, (m) => (m === 1 ? k.row(k.K(7), k.K(8)) : k.row(k.K(56, { n: 'Attack' }), k.K(57, { n: 'Decay' }), k.K(58, { n: 'Sustain' }), k.K(59, { n: 'Release' })))), k.sep(), k.K(52), k.K(60), k.K(61)));
  const page = h('div', { class: 'lk-page lk-spage' });
  const tb = lvTabs([{ label: 'Sample' }, { label: 'Controls' }], st.tab, (j) => { st.tab = j; page.replaceChildren(j ? controlsTab() : sampleTab()); }, { cls: 'lk-tabs' });
  page.replaceChildren(st.tab ? controlsTab() : sampleTab());
  return h('div', { class: 'lk-col lk-simp' }, tb, page);
};
// Wavetable (Live 12 layout): Osc 1 | Osc 2 (stacked frames with the current one in orange, drag up / down = Position; category and table
// menus, FX mode, FX 1 / 2, Semi, Det, Gain) | Sub; then Amp / Env 2 / Env 3 / LFO 1 / LFO 2 displays; then Filter | Filter 2 | Matrix | Global
const WTC = new Map();
const wtCurves = (idx) => {
  let c = WTC.get(idx); if (c) return c;
  const T = wtTable(idx), N = 128; c = [];
  for (let f = 0; f < WT_N_FRAMES; f++) { const o = T.at(f, 0), a = new Float32Array(N); for (let x = 0; x < N; x++) a[x] = T.d[o + Math.floor((x / N) * 2048)]; c.push(a); }
  WTC.set(idx, c); if (WTC.size > 8) WTC.delete(WTC.keys().next().value); return c;
};
const WT_SRC = ['Env 2', 'Env 3', 'LFO 1', 'LFO 2', 'Vel', 'Key'], WT_DST = ['Osc 1 Pos', 'Osc 1 Pitch', 'Osc 2 Pos', 'Osc 2 Pitch', 'Filter Freq', 'Filter Res', 'Osc 1 Gain', 'Osc 2 Gain'];
const lfoY = (sh, ph, u) => (sh === 0 ? Math.sin(6.2832 * ph) : sh === 1 ? 1 - 4 * Math.abs(ph - 0.5) : sh === 2 ? 2 * ph - 1 : sh === 3 ? (ph < 0.5 ? 1 : -1) : Math.sin(Math.floor(u * 9) * 12.9898) * 0.9);
VI[11] = (k) => {
  const g = k.get, cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const O = (n, j, w = 50) => k.TL(n, k.NT(j, { w, cls: 'or' }));
  const osc = (n) => {
    const b = n * 9, idx = () => Math.round(g(b)), cat = () => wtCatOf(idx());
    const cv = k.D(360, 112, (c, w, hh) => {
      const cur = wtCurves(idx()), on = g(b + 8) > 0.5, pos = cl(g(b + 1), 0, 1), L = 10, wv = w - 44, step = (hh - 34) / (WT_N_FRAMES - 1), amp = 14;
      const line = (arr, f) => { c.beginPath(); for (let x = 0; x < arr.length; x++) { const X = L + f * 1.6 + (x / (arr.length - 1)) * wv, Y = hh - 18 - f * step - arr[x] * amp; x ? c.lineTo(X, Y) : c.moveTo(X, Y); } };
      c.lineWidth = 1; c.strokeStyle = on ? 'rgba(200,200,206,.42)' : 'rgba(120,120,126,.35)'; for (let f = 0; f < WT_N_FRAMES; f++) { line(cur[f], f); c.stroke(); }
      const tp = pos * (WT_N_FRAMES - 1), f0 = Math.min(WT_N_FRAMES - 2, Math.floor(tp)), fr = tp - f0, mix = cur[f0].map((v, x) => v * (1 - fr) + cur[f0 + 1][x] * fr);
      line(mix, tp); c.strokeStyle = on ? DISPC.or : DISPC.orD; c.lineWidth = 2; c.stroke();
      const sx = w - 16, top = 10, bot = hh - 12, py = bot - pos * (bot - top);
      c.fillStyle = DISPC.grid2; c.fillRect(sx, top, 2, bot - top); c.fillStyle = on ? DISPC.or : DISPC.orD; c.fillRect(sx, py, 2, bot - py); c.fillRect(sx - 4, py - 2, 10, 4);
      label(c, Math.round(pos * 100) + ' %', w - 4, hh - 1, on ? DISPC.or : DISPC.orD, 9, 'right');
    }, { onDown: () => ({ p: g(b + 1) }), onMove: (x, y, dx, dy, s) => k.set(b + 1, cl(s.p - dy / 90, 0, 1)) });
    const catSel = k.reg(lvSel(() => WT_CATS.map((c, j) => ({ value: j, label: c.name })), cat, (j) => k.set(b, WT_CATS[j].first), { w: 92, cls: 'lk-s dk or' }), 'c' + b);
    const tabSel = k.reg(lvSel(() => WT_LIST.map((x, j) => ({ value: j, label: x.name })).filter((x) => WT_LIST[x.value].cat === cat()), idx, (j) => k.set(b, j), { w: 124, cls: 'lk-s dk or' }), 't' + b);
    const stp = (d) => lvBtn(d < 0 ? '◂' : '▸', () => k.set(b, (idx() + d + WT_COUNT) % WT_COUNT), { cls: 'lk-t lk-wstep', w: 20 });
    return k.dk(h('div', { class: 'lk-row lk-shead' }, k.T(b + 8, '', { cls: 'lk-chkbox' }), h('span', { class: 'lk-st' }, 'Osc ' + (n + 1)), h('span', { class: 'lk-grow' }), catSel, tabSel, stp(-1), stp(1)), cv,
      h('div', { class: 'lk-row lk-sev' }, k.TL('FX Mode', k.S(b + 4, { w: 70, cls: 'dk or' })), O('FX 1', b + 2), O('FX 2', b + 3), O('Semi', b + 6, 46), O('Det', b + 7, 52), O('Gain', b + 5, 58)));
  };
  const sub = k.dk(h('div', { class: 'lk-row lk-shead' }, k.T(18, 'Sub', { w: 56 })), k.K(19, { n: 'Gain' }), k.K(20, { n: 'Tone' }), k.TL('Octave', k.CH(21, ['0', '-1', '-2'], { cls: 'sm' })), O('Transpose', 22, 56));
  // modulation sources: envelope (A D S R) or LFO (shape, rate, attack) with its display
  const env = (name, j) => k.dk(h('div', { class: 'lk-row lk-shead' }, h('span', { class: 'lk-st' }, name)),
    k.D(160, 64, (c, w, hh) => { const pts = lvEnvPts(w, hh, g(j), g(j + 1), g(j + 2), g(j + 3), 6); lvPath(c, pts, DISPC.bl, hh - 4); for (const pt of pts.slice(1, 4)) lvRing(c, pt[0], pt[1]); }),
    h('div', { class: 'lk-row lk-sev' }, O('A', j, 38), O('D', j + 1, 38), O('S', j + 2, 38), O('R', j + 3, 38)));
  const lfo = (name, j) => k.dk(h('div', { class: 'lk-row lk-shead' }, h('span', { class: 'lk-st' }, name)),
    k.D(160, 64, (c, w, hh) => { c.fillStyle = DISPC.grid; c.fillRect(0, Math.round(hh / 2), w, 1); const sh = Math.round(g(j)), att = g(j + 2), pts = [];
      for (let x = 0; x <= w - 8; x += 1) { const u = x / (w - 8), ph = (u * 3) % 1, a = att > 0.001 ? Math.min(1, u * 3 / (att * g(j + 1) + 0.01) * 0.3) : 1; pts.push([x + 4, hh / 2 - lfoY(sh, ph, u) * a * (hh / 2 - 6)]); }
      lvPath(c, pts, DISPC.bl, null, 1.6); }),
    h('div', { class: 'lk-row lk-sev' }, k.TL('Shape', k.S(j, { w: 66, cls: 'dk or' })), O('Rate', j + 1, 48), O('Attack', j + 2, 44)));
  // filters: response display (drag x = Freq, y = Res)
  const fdisp = (on, ty, fq, rq) => k.D(184, 64, (c, w, hh) => {
    grid(c, w, hh); const bq = new Biquad(), t = Math.round(g(ty)), f = g(fq), q = g(rq);
    if (t === 1) bq.highpass(SR, f, q); else if (t === 2) bq.bandpass(SR, f, q); else if (t === 3) bq.notch(SR, f, q); else bq.lowpass(SR, Math.min(f, 20000), q);
    const pts = []; for (let x = 0; x <= w; x += 2) pts.push([x, hh - 6 - Math.min(2.5, mag(bq, xl(x, w))) / 2.5 * (hh - 12)]);
    lvPath(c, pts, g(on) > 0.5 ? DISPC.bl : DISPC.grid2, hh, 1.6); lvRing(c, cl(lx(f, w), 6, w - 6), hh - 6 - Math.min(2.5, mag(bq, f)) / 2.5 * (hh - 12), 4.5);
  }, { onDown: () => ({ f: g(fq), r: g(rq) }), onMove: (x, y, dx, dy, s) => { k.set(fq, cl(s.f * Math.pow(2, dx / 18), 20, 20000)); k.set(rq, cl(s.r * Math.pow(2, -dy / 30), 0.5, 12)); } });
  const filt1 = k.dk(h('div', { class: 'lk-row lk-shead' }, k.T(30, 'Filter', { w: 56 }), h('span', { class: 'lk-grow' }), k.S(31, { w: 84, cls: 'dk or' })), fdisp(30, 31, 32, 33),
    h('div', { class: 'lk-row lk-sev' }, k.K(32, { n: 'Freq' }), k.K(33, { n: 'Res' }), k.K(34, { n: 'Drive' })));
  const filt2 = k.dk(h('div', { class: 'lk-row lk-shead' }, k.T(101, 'Filter 2', { w: 64 }), h('span', { class: 'lk-grow' }), k.S(102, { w: 84, cls: 'dk or' })), fdisp(101, 102, 103, 104),
    h('div', { class: 'lk-row lk-sev' }, k.K(103, { n: 'Freq' }), k.K(104, { n: 'Res' }), k.TL('Routing', k.CH(105, ['Ser', 'Par'], { cls: 'sm' }))));
  // matrix: rows = targets, columns = sources (drag a cell up / down; blank = 0)
  const mx = h('div', { class: 'lk-wmx' }, h('span', { class: 'lk-wmh t' }, 'Target'), ...WT_SRC.map((s) => h('span', { class: 'lk-wmh' }, s)));
  WT_DST.forEach((dn, d) => {
    mx.append(h('span', { class: 'lk-wmt' }, dn));
    WT_SRC.forEach((sn, s) => {
      const j = 53 + s * 8 + d === 90 ? 106 : 53 + s * 8 + d, p = INSTRUMENTS[11].params[j];
      const cell = lvNum(p, () => g(j), (v) => { k.set(j, Math.abs(v) < 0.02 ? 0 : v); paint(); }, (pp, v) => (Math.abs(v) < 0.005 ? '' : String(Math.round(v * 100))), { cls: 'lk-wmc', label: `${sn} → ${dn}`, onLong: k.auto(j) });
      const paint = () => { const v = g(j); cell.style.setProperty('--f', String(Math.abs(v))); cell.classList.toggle('neg', v < 0); cell.classList.toggle('pos', v > 0); };
      const up = cell.update; cell.update = () => { if (up) up(); paint(); }; paint(); k.reg(cell, j); mx.append(cell);
    });
  });
  const matrix = k.dk(h('div', { class: 'lk-row lk-shead' }, h('span', { class: 'lk-st' }, 'Matrix')), mx);
  const glob = k.dk(h('div', { class: 'lk-row lk-shead' }, h('span', { class: 'lk-st' }, 'Unison')), h('div', { class: 'lk-row lk-sev' }, k.TL('Mode', k.S(26, { w: 84, cls: 'dk or' })), O('Voices', 27, 36), O('Amount', 28, 44)),
    h('div', { class: 'lk-row lk-shead' }, h('span', { class: 'lk-st' }, 'Global')), h('div', { class: 'lk-row lk-sev' }, k.TL('Poly', k.T(23, 'Mono', { w: 48 })), O('Voices', 25, 36), k.K(24, { n: 'Glide' }), k.K(29, { n: 'Volume' })));
  // phone (Find X8 Device panel ~250 px): the three rows would only fit at 0.6x (text 6 px, the last row cut), so one row is shown at a time
  // under Live-style tabs; every control keeps the common panel size and the tab is remembered per track
  const rows = [h('div', { class: 'lk-wr lk-wr1' }, osc(0), osc(1), sub),
    h('div', { class: 'lk-wr lk-wr2' }, env('Amp', 35), env('Env 2', 39), env('Env 3', 43), lfo('LFO 1', 47), lfo('LFO 2', 50)),
    h('div', { class: 'lk-wr lk-wr3' }, filt1, filt2, matrix, glob)];
  const mk = 'wt:' + (k.ctx.i ?? '') + ':' + (k.d ? k.d.id || '' : ''), cur = WT_TAB.get(mk) || 0;
  const show = (j) => { WT_TAB.set(mk, j); rows.forEach((r, q) => { r.style.display = q === j ? '' : 'none'; }); k.redraw(); };
  const tabs = lvTabs([{ label: 'Oscillators' }, { label: 'Envelopes / LFOs' }, { label: 'Filter / Matrix' }], cur, (j) => show(j), { cls: 'lk-wtabs' });
  show(cur);
  return h('div', { class: 'lk-col lk-wt' }, tabs, ...rows);
};
// Drum Synths (DS Kick / Snare / Tom / HH / Clap / FM): the hit drawn from the real engine (rendered offline with the current settings,
// tap the display = audition), one row of knobs, list parameters as joined buttons, Volume after a divider
const DS_CLS = { 19: DsKick, 20: DsSnare, 21: DsTom, 22: DsHH, 23: DsClap, 24: DsFm };
const dsPanel = (k) => {
  const type = k.d.type, def = k.def, n = def.params.length, sr = 12000, len = Math.round(sr * 0.6);
  let shape = null;
  const calc = () => { const d = new DS_CLS[type](sr); for (let j = 0; j < n; j++) d.setParam(j, k.get(j)); d.setParam(n - 1, 0); d.noteOn(60, 1); const L = new Float32Array(len), R = new Float32Array(len); d.render(L, R, 0, len); shape = L; };
  const disp = k.DF(420, 92, (g, w, hh) => {
    calc(); const mid = hh / 2, per = len / w; g.fillStyle = DISPC.grid; g.fillRect(0, Math.round(mid), w, 1);
    g.beginPath(); for (let x = 0; x < w; x++) { let mx = 0; const a = Math.floor(x * per), b = Math.floor((x + 1) * per); for (let j = a; j < b; j++) mx = Math.max(mx, Math.abs(shape[j])); g.rect(x, mid - mx * (mid - 6), 1, mx * (mid - 6) * 2); }
    g.fillStyle = DISPC.bl; g.fill(); label(g, def.name, w - 6, 12, DISPC.ink, 9, 'right');
  }, { onDown: () => { const i = k.ctx.i; P.noteEvent(i, 60, 0.9, true); setTimeout(() => P.noteEvent(i, 60, 0, false), 120); return false; } });
  const knobs = [], lists = [];
  def.params.forEach((p, j) => { if (j === n - 1) return; if (p.fmt === 'list') lists.push(k.TL(p.n, k.CH(j, p.items, { cls: 'sm' }))); else if (p.fmt === 'onoff') lists.push(k.T(j, p.n, { w: 52 })); else knobs.push(k.K(j)); });
  return h('div', { class: 'lk-col lk-ds' }, k.dk(disp, lists.length ? h('div', { class: 'lk-row lk-sev' }, ...lists) : null), h('div', { class: 'lk-row lk-dsk' }, ...knobs, k.sep(), k.K(n - 1, { big: true })));
};
for (const t of [19, 20, 21, 22, 23, 24]) VI[t] = dsPanel;
// a display of what the instrument plays with the current settings (rendered offline by the real engine at a low rate); tap = audition
const hitDisp = (k, Cls, w, hh, note = 60, secs = 0.8, col = DISPC.bl) => {
  const n = k.def.params.length, sr = 8000, len = Math.round(sr * secs);
  return k.D(w, hh, (g) => {
    const d = new Cls(sr); for (let j = 0; j < n; j++) d.setParam(j, k.get(j)); d.setParam(n - 1, 0); d.noteOn(note, 0.8);
    const L = new Float32Array(len), R = new Float32Array(len); d.render(L, R, 0, Math.round(len * 0.7)); d.noteOff(note); d.render(L, R, Math.round(len * 0.7), len);
    let pk = 1e-6; for (const x of L) pk = Math.max(pk, Math.abs(x)); const mid = hh / 2, per = len / w, sc = (mid - 6) / Math.max(pk, 0.25);
    g.fillStyle = DISPC.grid; g.fillRect(0, Math.round(mid), w, 1); g.beginPath();
    for (let x = 0; x < w; x++) { let mx = 0; for (let j = Math.floor(x * per); j < Math.floor((x + 1) * per); j++) mx = Math.max(mx, Math.abs(L[j])); g.rect(x, mid - mx * sc, 1, Math.max(1, mx * sc * 2)); }
    g.fillStyle = col; g.fill();
  }, { onDown: () => { const i = k.ctx.i; P.noteEvent(i, note, 0.8, true); setTimeout(() => P.noteEvent(i, note, 0, false), 400); return false; } });
};
const ttl = (t) => h('div', { class: 'lk-st c' }, t);
const box = (...kids) => h('div', { class: 'lk-box' }, ...kids.filter(Boolean));
// Electric: Hammer | Fork | Damper / Pickup | Global on top; below, the sound display and the Stiffness / Force / Noise rows
VI[25] = (k) => {
  const O = (n, j) => k.TL(n, k.NT(j, { w: 54, cls: j === 6 || j === 8 ? 'or' : '' }));
  const rows = h('div', { class: 'lk-elr' },
    h('span', { class: 'lk-elh' }, 'Stiffness'), h('span'), O('Vel', 6),
    h('span', { class: 'lk-elh' }, 'Force'), O('Amount', 7), O('Vel', 8),
    h('span', { class: 'lk-elh' }, 'Noise'), O('Pitch', 9), O('Decay', 10));
  return h('div', { class: 'lk-col lk-phys' },
    h('div', { class: 'lk-pr' }, box(ttl('Hammer'), k.row(k.K(0), k.K(1))), box(ttl('Fork'), k.row(k.K(2), k.K(3))), box(ttl('Damper / Pickup'), k.row(k.K(4), k.TL('Type', k.CH(5, ['R', 'W'], { v: true, cls: 'lk-orb sm' })))), box(ttl('Global'), k.row(k.K(11), k.K(12)))),
    h('div', { class: 'lk-pr2' }, k.dk(hitDisp(k, Electric, 236, 96)), k.dk(rows)));
};
// Tension: Exciter | String (dark strip) | Termination | Pickup | Volume
// phone layout: two columns of the same height (three stacked rows only fitted at 0.77x): left Exciter over Termination / Pickup / Global,
// right the string display over its four values
// SoundFont (instrument 6): the file and its presets as a list inside a dark box (tap = choose), Gain and Pitch on the right
VI[6] = (k) => {
  const i = k.ctx.i, t = P.state.tracks[i], sf = t.inst.sf;
  const file = lvBtn(sf ? sf.path.split('/').pop() : 'Pilih file SoundFont (.sf2)\u2026', () => BR.openBrowser('file', { track: i, sf: true }), { cls: 'lk-sfile' });
  const list = h('div', { class: 'lk-sflist' }, ...(sf ? sf.presets.map((n, q) => h('button', { class: 'lk-sfp' + (q === sf.preset ? ' on' : ''), onclick: () => P.setSfPreset(i, q) }, h('span', {}, String(q + 1).padStart(3, '0')), n))
    : [h('div', { class: 'lk-hint' }, 'Belum ada file SoundFont. Ketuk tombol di atas, atau seret berkas .sf2 dari Browser ke sini.')]));
  if (sf) requestAnimationFrame(() => { const on = list.querySelector('.on'); if (on) list.scrollTop = Math.max(0, on.offsetTop - list.clientHeight / 2 + 10); });
  const pitch = knob({ ...P.PITCH_PARAM, fmt: 'st' }, () => t.inst.pitch || 0, (v) => P.setPitch(i, v), fmtParam, C('#ffa722'));
  pitch.classList.add('lk-k');
  return k.row(h('div', { class: 'lk-col lk-sfc' }, file, h('div', { class: 'lk-dk lk-sfdk' }, h('div', { class: 'lk-sfh' }, h('span', {}, 'Preset'), h('span', {}, sf ? sf.presets.length + ' preset' : '')), list)), k.sep(), k.col(k.K(0, { big: true }), pitch));
};
VI[26] = (k) => h('div', { class: 'lk-row lk-phys lk-tens' },
  // Live: three bands stacked on the left, each ONE dial row high - Exciter (title + type on the left, five dials), the dark String strip,
  // Termination | Pickup | Global - and the decay display on the right
  h('div', { class: 'lk-col lk-tcol' },
    h('div', { class: 'lk-pr' }, box(k.row(k.col(ttl('Exciter'), k.S(0, { w: 96 })), k.K(1), k.K(2), k.K(3), k.K(4), k.K(5, { n: 'Damping' })))),
    k.dk(h('div', { class: 'lk-row lk-sev lk-tstr' }, h('span', { class: 'lk-elh' }, 'String'), k.TL('Decay', k.NT(6, { w: 58 })), k.TL('Ratio', k.NT(7, { w: 58 })), k.TL('Inharm', k.NT(8, { w: 58 })), k.TL('Damping', k.NT(9, { w: 58 })))),
    h('div', { class: 'lk-pr' }, box(k.row(k.col(k.T(10, 'Termination', { w: 92 })), k.K(11), k.K(12), k.K(13))), box(k.row(k.col(k.T(14, 'Pickup', { w: 64 })), k.K(15, { n: 'Position' }))), box(k.row(k.col(ttl('Global'), h('span', { class: 'lk-grow' })), k.K(16))))),
  h('div', { class: 'lk-col lk-pr2' }, k.dk(hitDisp(k, Tension, 250, 222, 52, 1.2))));
// Collision: Mallet | Noise | Resonator (type, mode display, Decay / Material) with Bright / Inharm / Ratio / Volume below
VI[27] = (k) => {
  const g = k.get;
  const modes = k.D(250, 82, (c, w, hh) => {
    const t = Math.round(g(15)), r = g(20), inh = g(19); c.fillStyle = DISPC.grid; c.fillRect(0, hh - 14, w, 1);
    for (let m = 1; m <= 12; m++) {
      let x; switch (t) { case 0: x = ((2 * m + 1) / 3) ** 2; break; case 1: x = [1, 3.9, 9.2, 13.4, 16.6, 21, 25.4, 30, 35.1, 40.3, 46, 52][m - 1]; break; case 3: x = [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.16, 3.5, 3.6, 4.06, 4.15, 4.6][m - 1] * (1 + (r - 1) * 0.15 * ((m % 3) / 2)); break;
        case 4: { const a = Math.ceil(m / 3), b = (m % 3) + 1; x = (a * a + b * b * r * r) / (1 + r * r); break; } case 5: x = 2 * m - 1; break; default: x = m; }
      x *= 1 + inh * (x - 1) * 0.05; const X = 8 + Math.log(x) / Math.log(64) * (w - 16), a = Math.pow(m, -2.2 + g(18) * 2.2), dec = g(16) / (1 + (m - 1) * (1 + g(17)) * 0.6);
      const y = (hh - 16) * Math.min(1, a * 0.9 + 0.05); c.fillStyle = DISPC.bl; c.fillRect(Math.round(X), hh - 14 - y, 2, y); c.fillStyle = DISPC.or; c.fillRect(Math.round(X) - 1, hh - 14 - y - 2, 4, 2);
      c.globalAlpha = 0.35; c.fillRect(Math.round(X), hh - 12, 2, Math.min(10, dec * 3)); c.globalAlpha = 1;
    }
    label(c, 'Partials', 6, 12, DISPC.ink, 9);
  });
  modes.classList.add('lk-hero');
  const N = (j, w = 60) => k.N(j, { w });
  return h('div', { class: 'lk-col lk-phys' }, h('div', { class: 'lk-pr lk-colr' },
    box(k.T(0, 'Mallet', { w: 72 }), k.K(1, { n: 'Volume' }), k.TL('Stiffness', N(2)), k.TL('Noise', N(3)), k.TL('Color', N(4))),
    box(k.row(k.T(5, 'Noise', { w: 60 }), k.CH(6, ['LP', 'HP', 'BP'], { cls: 'sm' })), k.row(k.K(7, { n: 'Volume' }), k.K(8)), k.row(k.K(9), k.TL('Res', N(10, 52))), k.row(k.TL('A', N(11, 50)), k.TL('D', N(12, 50)), k.TL('S', N(13, 44)), k.TL('R', N(14, 50)))),
    h('div', { class: 'lk-col lk-colres' }, k.dk(h('div', { class: 'lk-row lk-shead' }, k.S(15, { w: 96, cls: 'dk or' })), modes, h('div', { class: 'lk-row lk-sev' }, k.TL('Decay', k.NT(16, { w: 60, cls: 'or' })), k.TL('Material', k.NT(17, { w: 60, cls: 'or' })))),
      h('div', { class: 'lk-row lk-dsk' }, k.K(18), k.K(19), k.K(20), k.sep(), k.K(21, { big: true })))));
};
// Impulse: eight slot pads (sample name; tap = select + audition C3..G3), the selected slot's sections (Start | Transp, Stretch | Drive + Sat |
// Freq, Res + Filter | Decay + Trig / Gate | Pan | Volume + Vol < Vel) and the global Volume / Time / Transp column
const IMST = new Map();
VI[28] = (k) => {
  const { i } = k.ctx, t = P.state.tracks[i], st = IMST.get(k.d.id) || { s: 0 }; IMST.set(k.d.id, st);
  const zs = () => t.inst.zones || [], name = (z) => (zs()[z] && zs()[z].sample ? zs()[z].sample.name.replace(/\.[^.]+$/, '') : '');
  const pads = h('div', { class: 'lk-impads' }), page = h('div', { class: 'lk-impage' });
  const J = (f) => 92 + st.s * 13 + f, KN = (f, n, o = {}) => k.K(J(f), { n, ...o });
  const build = () => {
    pads.replaceChildren(...Array.from({ length: 8 }, (_, z) => {
      const b = h('button', { class: 'lk-impad' + (z === st.s ? ' sel' : '') + (name(z) ? '' : ' empty') }, h('span', {}, name(z) || 'Drop'), h('small', {}, ['C3', 'C#3', 'D3', 'D#3', 'E3', 'F3', 'F#3', 'G3'][z]));
      b.addEventListener('pointerdown', () => { if (st.s !== z) { st.s = z; build(); } if (name(z)) { P.noteEvent(i, 60 + z, 0.9, true); setTimeout(() => P.noteEvent(i, 60 + z, 0, false), 300); } });
      return b; }));
    const sec = (...kids) => h('div', { class: 'lk-imsec' }, ...kids);
    page.replaceChildren(
      sec(KN(0, 'Start'), lvBtn(name(st.s) ? 'Sample…' : 'Pilih…', () => BR.openBrowser('file', { track: i, zone: st.s }), { cls: 'lk-t' })),
      sec(k.row(KN(1, 'Transp'), KN(2, 'Stretch'))),
      sec(KN(3, 'Drive'), k.T(J(4), 'Sat', { w: 52 })),
      sec(k.row(KN(6, 'Freq'), KN(7, 'Res')), k.row(k.T(J(5), 'Filter', { w: 60 }))),
      sec(KN(8, 'Decay'), k.CH(J(9), ['Trig', 'Gate'], { cls: 'sm' })),
      sec(KN(10, 'Pan')),
      sec(KN(11, 'Volume'), k.TL('Velocity', k.N(J(12), { w: 54 }))));
  };
  build();
  return h('div', { class: 'lk-row lk-imp' }, h('div', { class: 'lk-col lk-imm' }, pads, page), h('div', { class: 'lk-col lk-imglob' }, k.K(0, { n: 'Volume' }), k.K(1, { n: 'Time' }), k.K(2, { n: 'Transp' })));
};
// Granulator III: the sample (yellow) with the Position line and the grain window (drag = Position), mode menu, file; then one row of
// knobs: Position, Scan / Density (by mode), Grain Size, Shape, Spray, Loop Length (Loop mode), Pitch Spread, Transpose | Attack, Release |
// Vol < Vel, Volume
VI[29] = (k) => {
  const { i } = k.ctx, t = P.state.tracks[i], Z = () => (t.inst.zones && t.inst.zones[0]) || {}, pick = () => BR.openBrowser('file', { track: i, zone: 0 });
  const W = 700, H = 128;
  const wave = k.D(W, H, (g, w, hh) => {
    const s = Z().sample; if (!s) { label(g, 'Drop Sample Here', w / 2, hh / 2 + 4, '#bbb', 12, 'center'); return; }
    const pk = s.peaks || [], n = pk.length, mid = hh / 2;
    g.fillStyle = '#f5b324'; for (let x = 0; x < w; x += 2) { const a = pk[Math.min(n - 1, Math.floor(x / w * n))] || 0; g.fillRect(x, mid - a * (mid - 8), 2, Math.max(1, a * (mid - 8) * 2)); }
    const px = k.get(1) * w, gw = Math.max(2, k.get(3) / 1000 / Math.max(0.05, s.duration || 1) * w), sp = k.get(5) * 0.25 * w;
    g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(px - sp, 0, sp * 2 + gw, hh);
    if (Math.round(k.get(0)) === 1) { g.fillStyle = 'rgba(79,195,240,.18)'; g.fillRect(px, 0, (0.02 + k.get(7) * 0.5) * w, hh); }
    g.fillStyle = '#e5484d'; g.fillRect(Math.round(px), 0, 2, hh);
  }, { onDown: (x) => { if (!Z().sample) { pick(); return false; } return { p: k.get(1) }; }, onMove: (x, y, dx, dy, s) => k.set(1, Math.max(0, Math.min(1, s.p + dx / W))) });
  // Live: the sample display is a dark box with the file strip INSIDE it at the bottom (load button, length, name); under it the mode menu with its
  // glyph on the left, then the dials
  const dur = () => { const sm = Z().sample, d = sm && sm.duration; return !d ? '' : d >= 60 ? Math.floor(d / 60) + ' min ' + Math.round(d % 60) : d.toFixed(1) + ' s'; };
  const info = h('div', { class: 'lk-row lk-ginfo' }, lvBtn('Sample\u2026', pick, { cls: 'lk-t lk-gio' }), h('span', { class: 'lk-gdur' }, dur()), h('span', { class: 'lk-grow' }), h('span', { class: 'lk-gname' }, (Z().sample && Z().sample.name) || ''));
  const glyph = h('span', { class: 'lk-gglyph' }); glyph.innerHTML = '<svg viewBox="0 0 40 26" width="40" height="26" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 11c0-6 10-6 12-1 4-4 12-1 10 5"/><path d="M4 18c0-5 9-6 12-2 4-3 11-1 11 4"/><path d="M12 24c2-4 8-5 12-2"/></svg>';
  return h('div', { class: 'lk-col lk-ds' }, k.dk(wave, info),
    h('div', { class: 'lk-row lk-dsk' }, k.col(k.S(0, { w: 86 }), glyph), k.sep(), k.K(1, { big: true }), k.swapN(0, (m) => (m === 2 ? k.K(6, { big: true }) : k.K(2, { big: true }))), k.K(3, { big: true }), k.K(4, { big: true }), k.sep(), k.K(5), k.swapN(0, (m) => (m === 1 ? k.K(7, { n: 'Loop' }) : k.K(8, { n: 'Pitch' }))), k.K(9), k.sep(), k.K(10), k.K(11), k.sep(), k.K(12), k.K(13)));
};
// synths with many sections (Drift, Operator, Poli, Analog, Meld, Wavetable, Sampler, Simpler, the FLM synths) keep the denser size; effects and compact instruments use Live's larger text and dials
const DENSE_INST = new Set([10, 11, 14, 15, 16, 17, 18, 30, 31, 32, 33]);
export function instKitView(i, t, every) {
  const def = INSTRUMENTS[t.inst.type]; if (!VI[t.inst.type]) return null;
  const d = { id: 'in' + t.id, type: t.inst.type, params: new Proxy({}, { get: (_, kk) => t.inst.params[kk] ?? (def.params[kk] ? def.params[kk].def : undefined) }) };
  const ctx = { i, di: -1, d, def, every, setParam: (kk, v) => P.setInstParam(i, +kk, v),
    autoFn: (kk) => (rect) => offerAutomation(rect, { kind: 5, strip: P.stripOf(i), param: +kk, def: def.params[kk] }, `${t.name} • ${def.params[kk].n}`) };
  const k = kit(ctx), el = VI[t.inst.type](k); el.classList.add('lk', 'lk-inst'); if (DENSE_INST.has(t.inst.type)) el.classList.add('lk-dense'); return { el, draw: k.redraw };
}

// ---- shared pieces for the Live 12 layouts: Sync / Time switch (orange "Sync" when synced, cyan "Time" when free), icon choices, checkbox
function syncBtn(k, j) { const b = h('button', { class: 'lv-btn lk-sync' }); const draw = () => { const on = k.get(j) > 0.5; b.textContent = on ? 'Sync' : 'Time'; b.classList.toggle('on', on); b.classList.toggle('tm', !on); };
  b.onclick = () => { k.set(j, k.get(j) > 0.5 ? 0 : 1); draw(); }; b.update = draw; draw(); return k.reg(b, j); }
const icoChoice = (k, j, paths, cls = '') => k.reg(lvChoice(paths.map((d, n) => ({ label: ico(d), title: k.def.params[j].items ? k.def.params[j].items[n] : String(n) })), () => Math.round(k.get(j) - k.def.params[j].min), (n) => k.set(j, n + k.def.params[j].min), { cls: 'lk-ch lk-icoch ' + cls }), j);
const fixH = (el, hh) => { el.style.height = hh + 'px'; return el; };
// Beat Repeat: position display + filter display on top, Interval / Offset / Grid / Variation, Repeat / No Trpl and Mix / Ins / Gate, then
// Chance / Gate / Pitch / Pitch Decay / Volume / Decay in one row
V[19] = (k) => {
  const pos = k.DF(300, 66, (g, w, hh) => {
    const iv = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16][Math.round(k.get(0))], bars = Math.max(1, iv / 4), beat = w / (bars * 4), off = k.get(1) / 4 * beat, gate = k.get(5) / 4 * beat, gr = [1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 1 / 12, 0.0625][Math.round(k.get(2))] * beat;
    g.fillStyle = DISPC.grid; for (let b = 0; b <= bars * 4; b++) g.fillRect(Math.round(b * beat), 0, 1, hh);
    g.fillStyle = '#ffad32'; g.fillRect(off, 6, Math.min(w - off, gr), hh - 24); g.fillStyle = '#5fd08a'; g.fillRect(off + gr, 6, Math.max(0, Math.min(w - off - gr, gate - gr)), hh - 24);
    for (let b = 0; b < bars * 4; b++) label(g, String(b / 4).replace(/^0\./, '.'), b * beat + 3, hh - 4, '#ffad32', 11);
  });
  const o = k.out; k.every(100, () => { const r = o(); pos.style.outline = r[0] ? '1px solid #ffad32' : ''; });
  // Live: left = position display, Interval / Offset / Grid / Variation, Repeat under Interval and No Trpl under Grid; right = the filter
  // display, Freq / Width, Filter right under them, Mix / Ins / Gate on the Repeat line; the six dials in one row across the device
  const top = h('div', { class: 'lk-brtop' },
    pos, h('div', { class: 'lk-brfd' }, bandDisp(k, 150, 50, 9, 10, { on: 8, fill: true })),
    h('div', { class: 'lk-brk' }, k.K(0), k.K(1), k.K(2), k.K(3), k.T(15, 'Repeat', { w: 70 }), h('span'), k.T(14, 'No Trpl', { w: 70 }), h('span')),
    h('div', { class: 'lk-brm' }, k.row(k.N(9, { w: 70 }), k.N(10, { w: 70 })), k.T(8, 'Filter', { w: 92 }), h('span', { class: 'lk-grow' }), k.CH(11, ['Mix', 'Ins', 'Gate'])));
  return h('div', { class: 'lk-col lk-br lk-notab' }, top, h('div', { class: 'lk-row lk-brb' }, k.K(4), k.K(5), k.K(6), k.K(7), k.K(12), k.K(13)));
};
// Delay: Left / Right (Sync = 16th grid, Time = knob; offset box), link, Feedback + freeze | dark display: filter curve, Filter on / freq / width,
// Modulation Rate / Filter / Time | Mode, Ping Pong, Dry/Wet
V[17] = (k) => {
  const side = (o, name) => k.col(h('span', { class: 'lk-lb' }, name), syncBtn(k, o), fixH(k.swap(o, () => k.CH(o + 1, ['1', '2', '3', '4', '5', '6', '8', '16'], { cls: 'g2c' }), () => k.K(o + 2, { n: '' })), 104), k.N(o + 3, { w: 58 }));
  const disp = k.dk(bandDisp(k, 200, 70, 12, 13, { on: 11, fill: true }), k.row(k.T(11, '', { cls: 'lk-chkbox' }), h('span', { class: 'lk-lb' }, 'Filter'), k.NT(12, { w: 66, cls: 'or' }), h('span', { class: 'lk-lb' }, 'Width'), k.NT(13, { w: 46, cls: 'or' })),
    h('div', { class: 'lk-dkh' }, 'Modulation'), k.row(k.TL('Rate', k.NT(14, { w: 58, cls: 'or' })), k.TL('Filter', k.NT(15, { w: 58, cls: 'or' })), k.TL('Time', k.NT(16, { w: 58, cls: 'or' }))));
  return k.row(k.col(k.row(side(0, 'Left'), h('div', { class: 'lk-mid' }, k.T(8, '⊶', { cls: 'link', w: 22 })), side(4, 'Right')), k.row(k.K(9), k.T(10, '∞', { cls: 'frz', w: 28 }))), disp,
    k.col(k.TL('Mode', k.CH(17, ['Repitch', 'Fade', 'Jump'], { v: true })), k.T(18, 'Ping Pong', { w: 80, cls: 'lk-pp' }), h('span', { class: 'lk-grow' }), k.K(19)));   // Dry/Wet sits at the bottom, level with Feedback
};
// Echo (Echo tab): Left / Right with link and Sync, Input / Feedback | tunnel display with the filter below it and HP / LP readouts |
// Reverb / Stereo, Output, Stereo / Ping Pong, Dry/Wet; Modulation and Character tabs
V[6] = (k) => {
  const page = h('div', { class: 'lk-page' });
  // Live: the repeats are nested half-ellipses over the whole display width (outer = first echo, bold; the inner ones thinner and denser),
  // a dotted white line down the middle; the filter display below it carries a fine grid
  const tunnel = k.DF(336, 104, (g, w, hh) => {
    const fb = k.get(1), tl = k.get(0), tr = k.get(6), N = 9, q = 0.7, ratio = Math.max(0.6, Math.min(1.6, tr / Math.max(1, tl)));
    for (let r = 0; r < N; r++) {
      const s = Math.pow(q, r) * (r % 2 ? Math.min(1, ratio) : 1), rx = (w / 2 - 6) * s, ry = (hh - 6) * s, a = 0.4 + 0.6 * Math.pow(Math.max(fb, 0.3), r * 0.4);
      g.strokeStyle = '#ffad32'; g.globalAlpha = Math.min(1, a); g.lineWidth = Math.max(1.3, 3.6 - r * 0.32); g.beginPath(); g.ellipse(w / 2, hh, Math.max(2, rx), Math.max(2, ry), 0, Math.PI, 0); g.stroke();
    }
    g.globalAlpha = 1; g.fillStyle = '#fff';   // Live: a white dot on top of every repeat, the first one large
    for (let r = 0; r < N; r++) { const s2 = Math.pow(q, r) * (r % 2 ? Math.min(1, ratio) : 1), y = hh - (hh - 6) * s2; if (y > hh - 6) break; g.beginPath(); g.arc(w / 2, y, r ? 2 : 3.6, 0, 6.2832); g.fill(); }
  });
  let fw = 336;
  const filt = k.DF(336, 78, (g, w, hh) => { fw = w; grid(g, w, hh); g.fillStyle = DISPC.grid; for (let q = 1; q < 4; q++) g.fillRect(0, Math.round(hh * q / 4), w, 1);
    const hp = new Biquad(), lp = new Biquad(); hp.highpass(SR, k.get(5), 0.707); lp.lowpass(SR, k.get(4), 0.707);
    const pts = []; for (let x = 0; x <= w; x += 2) { const f = xl(x, w); pts.push([x, hh - 4 - Math.min(1.2, mag(hp, f) * mag(lp, f)) / 1.2 * (hh - 14)]); } lvPath(g, pts, DISPC.bl, null, 1.8);
    for (const [f, t] of [[100, '100'], [1000, '1k'], [10000, '10k']]) label(g, t, lx(f, w) - 4, hh - 5, DISPC.ink, 12);
    for (const [n, f] of [[1, k.get(5)], [2, k.get(4)]]) { const x = Math.max(9, Math.min(w - 9, lx(f, w))), yy = hh - 4 - Math.min(1.2, mag(hp, f) * mag(lp, f)) / 1.2 * (hh - 14); g.fillStyle = '#ffad32'; g.beginPath(); g.arc(x, yy, 7, 0, 7); g.fill(); label(g, String(n), x, yy + 3.5, '#1b1b1d', 10, 'center'); } },
    { onDown: (x) => ({ hp: Math.abs(x - lx(k.get(5), fw)) < Math.abs(x - lx(k.get(4), fw)) }), onMove: (x, y, dx, dy, s) => { if (s.hp) k.set(5, Math.max(20, Math.min(2000, xl(x, fw)))); else k.set(4, Math.max(200, Math.min(20000, xl(x, fw)))); } });
  tunnel.style.flexGrow = '1.25';
  const tm = (j, dj) => k.swap(8, () => k.K(dj, { n: '' }), () => k.K(j, { n: '' }));
  // Modulation: what the engine does (fx2 Echo) - the delay time swings by a sine of Mod Rate, +-Mod Amt x 4 ms; drag: across = rate, up / down = amount
  const qgrid = (g, w, hh) => { g.fillStyle = DISPC.grid; for (let q = 1; q < 4; q++) { g.fillRect(Math.round(w * q / 4), 0, 1, hh); g.fillRect(0, Math.round(hh * q / 4), w, 1); } };
  const modD = k.D(300, 150, (g, w, hh) => { qgrid(g, w, hh); const sec = 2, amt = k.get(16), rate = k.get(15), pts = [];
    for (let x = 0; x <= w; x++) pts.push([x, hh / 2 - Math.sin(2 * Math.PI * rate * x / w * sec) * amt * (hh / 2 - 10)]);
    g.strokeStyle = 'rgba(255,173,50,.55)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, hh / 2); g.lineTo(w, hh / 2); g.stroke(); g.setLineDash([]);
    lvPath(g, pts, DISPC.bl, hh / 2, 1.6); label(g, '+' + (amt * 4).toFixed(1) + ' ms', 4, 12, DISPC.ink, 9); label(g, '2 s', w - 4, hh - 4, DISPC.ink, 9, 'right'); },
    { onDown: () => ({ r: k.get(15), a: k.get(16) }), onMove: (x, y, dx, dy, s) => { k.set(15, Math.max(0.1, Math.min(10, s.r * Math.pow(2, dx / 80)))); k.set(16, Math.max(0, Math.min(1, s.a - dy / 120))); } });
  // Character: the feedback path's saturation curve, tanh(x * (1 + 3 Drive)) / tanh(1 + 3 Drive) as in the engine; drag up / down = Drive
  const drvD = k.D(300, 150, (g, w, hh) => { qgrid(g, w, hh); const dr = 1 + k.get(17) * 3, dn = 1 / Math.tanh(dr), pts = [], M = 8;
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(M, hh - M); g.lineTo(w - M, M); g.stroke();
    for (let x = 0; x <= w - 2 * M; x++) { const v = x / (w - 2 * M) * 2 - 1, y = k.get(17) > 0 ? Math.tanh(v * dr) * dn : v; pts.push([M + x, hh / 2 - y * (hh / 2 - M)]); }
    lvPath(g, pts, '#ffad32', hh / 2, 1.8); label(g, 'in', w - M, hh / 2 - 4, DISPC.ink, 9, 'right'); label(g, 'out', M + 2, 12, DISPC.ink, 9); },
    { onDown: () => ({ v: k.get(17) }), onMove: (x, y, dx, dy, s) => k.set(17, Math.max(0, Math.min(1, s.v - dy / 120))) });
  const tabs = [
    () => k.row(h('div', { class: 'lk-col lk-ebox' }, k.row(k.TL('Left', tm(0, 9)), h('div', { class: 'lk-mid' }, k.T(7, '⊶', { cls: 'link', w: 24 })), k.TL('Right', tm(6, 10))), k.T(8, 'Sync', { w: 120 }), h('span', { class: 'lk-grow' }), k.row(k.K(13), k.K(1))),
      h('div', { class: 'lk-dk lk-edisp' }, tunnel, filt, k.row(h('span', { class: 'lk-lb' }, 'Filter HP'), k.NT(5, { w: 58 }), h('span', { class: 'lk-lb' }, 'LP'), k.NT(4, { w: 64 }))),
      h('div', { class: 'lk-ebox lk-eright' }, k.K(11), k.K(12), h('span'), k.K(14), k.CH(3, ['Stereo', 'Ping Pong'], { v: true }), k.K(2))),
    () => k.row(k.dk(modD, k.row(h('span', { class: 'lk-lb' }, 'Delay time ± ms'), h('span', { class: 'lk-grow' }), k.NT(15, { w: 64 }), k.NT(16, { w: 56 }))), k.col(k.K(15, { n: 'Rate', big: true }), k.K(16, { n: 'Amount', big: true }))),
    () => k.row(k.dk(drvD, k.row(h('span', { class: 'lk-lb' }, 'Feedback saturation'), h('span', { class: 'lk-grow' }), k.NT(17, { w: 56 }))), k.col(k.K(17, { n: 'Drive', big: true }), k.row(k.K(14), k.K(2)))),
  ];
  const t = lvTabs([{ label: 'Echo' }, { label: 'Modulation' }, { label: 'Character' }], 0, (j) => page.replaceChildren(tabs[j]()), { cls: 'lk-tabs c' });
  page.replaceChildren(tabs[0]());
  return k.col(t, page);
};
// Auto Filter: Freq, type, 12 / 24, Res | filter display with the LFO strip (LFO, Phase) inside, LFO Amt / Rate / Wave / Envelope (attack, release)
// below it | Drive, Dry/Wet
V[1] = (k) => {
  let fc = 0, sp = { spec: null };
  const disp = k.DF(420, 110, (g, w, hh) => {
    specFill(g, sp.spec, w, hh, 6, hh); grid(g, w, hh); g.fillStyle = DISPC.grid; g.fillRect(0, Math.round(hh / 2), w, 1); const b = new Biquad(), t = Math.round(k.get(0)), q = k.get(2);
    const draw = (f, col, fill) => { if (t === 0) b.lowpass(SR, f, q); else if (t === 1) b.highpass(SR, f, q); else if (t === 2) b.bandpass(SR, f, q); else b.notch(SR, f, q);
      const pts = []; for (let x = 0; x <= w; x += 2) { let m = mag(b, xl(x, w)); if (k.get(3) > 0.5) m *= m; pts.push([x, hh - 6 - Math.min(2, m) / 2 * (hh - 16)]); } lvPath(g, pts, col, null, 1.8); };
    if (fc > 20 && Math.abs(fc - k.get(1)) > k.get(1) * 0.01) draw(fc, DISPC.or, false);
    draw(k.get(1), DISPC.bl, true); { const f = k.get(1); if (t === 0) b.lowpass(SR, f, q); else if (t === 1) b.highpass(SR, f, q); else if (t === 2) b.bandpass(SR, f, q); else b.notch(SR, f, q); let m = mag(b, f); if (k.get(3) > 0.5) m *= m; lvRing(g, Math.max(8, Math.min(w - 8, lx(f, w))), hh - 6 - Math.min(2, m) / 2 * (hh - 16), 6); }
  }, { onDown: () => ({ f: k.get(1), q: k.get(2) }), onMove: (x, y, dx, dy, s) => { k.set(1, Math.max(20, Math.min(20000, s.f * Math.pow(2, dx / 30)))); k.set(2, Math.max(0.3, Math.min(12, s.q * Math.pow(2, -dy / 30)))); } });
  k.every(60, () => { const r = k.out(); if (r.length) fc = r[0]; });
  sp = specFeed(k, 3, () => disp.paint());
  // Live: filter section in a light box on the left, the display with the LFO strip flush at its bottom, LFO Amt / Rate / Wave under it and
  // Envelope in its own box, Drive over Dry/Wet on the right
  return k.row(h('div', { class: 'lk-col lk-ebox' }, k.K(1, { n: 'Freq', big: true }), k.S(0, { w: 86 }), k.CH(3, ['12', '24']), k.K(2, { n: 'Res' })),
    k.col(h('div', { class: 'lk-dk lk-edisp lk-afd' }, disp, k.row(h('span', { class: 'lk-st' }, 'LFO'), h('span', { class: 'lk-lb' }, 'Phase'), k.NT(12, { w: 52, cls: 'or' }))),
      k.row(k.K(7, { n: 'LFO Amt' }), k.K(8, { n: 'Rate' }), k.TL('Wave', k.S(9, { w: 80 })), h('div', { class: 'lk-row lk-ebox' }, k.K(4, { n: 'Envelope' }), k.col(k.TL('Attack', k.N(5, { w: 62, fill: false })), k.TL('Release', k.N(6, { w: 62, fill: false })))))),
    k.col(k.K(10), h('span', { class: 'lk-grow' }), k.K(11)));
};
// Auto Pan: L / R display, Amount / Rate / Phase / Shape, Normal / Invert, Hz / sync, Offset, waveform icons (2 x 2)
V[22] = (k) => {
  const disp = k.D(260, 52, (g, w, hh) => {
    const wf = Math.round(k.get(7)), sh = k.get(5), amt = k.get(0), ph = k.get(4) / 360, off = k.get(6) / 360;
    const fn = (x) => { x -= Math.floor(x); let v = wf === 0 ? Math.sin(2 * Math.PI * x) : wf === 1 ? 1 - 4 * Math.abs(x - 0.5) : wf === 2 ? 1 - 2 * x : ((Math.sin(Math.floor(x * 8) * 12.9898) * 43758.5) % 1); if (sh > 0) v = Math.max(-1, Math.min(1, v * (1 + sh * 6))); return v; };
    for (const [c, p] of [[DISPC.bl, 0], [DISPC.or, ph]]) { const pts = []; for (let x = 0; x <= w; x += 2) pts.push([x, hh / 2 - 4 - fn(x / w * 8 + off + p) * amt * (hh / 2 - 10)]); lvPath(g, pts, c, null, 1.5); }
    label(g, 'L', 3, hh - 3, DISPC.bl); label(g, 'R', w - 9, hh - 3, DISPC.or);
  });
  const inv = k.CY(8, ['Normal', 'Invert'], { w: 66, cls: 'lk-plain' });
  return k.col(disp, k.row(k.K(0), k.swap(2, () => k.K(3, { n: 'Rate' }), () => k.K(1)), k.K(4), k.K(5)),
    k.row(inv, h('span', { class: 'lk-grow' }), k.CH(2, ['Hz', '♪'], { v: true, cls: 'sm' }), k.K(6), icoChoice(k, 7, ['M1 6Q4 -1 7 6T13 6', 'M1 9L4 2L10 10L13 4', 'M1 2L12 10V2', 'M1 8H4V3H7V9H10V5H13'], 'g2')));
};
// Chorus-Ensemble: dark box (display, Chorus / Ensemble / Vibrato, HP + freq, Width, Time, Taps) | Rate, Amount, Feedback, invert | Output, Warmth, Dry/Wet
V[20] = (k) => {
  const disp = k.D(230, 52, (g, w, hh) => { const amt = k.get(2), wd = k.get(7); for (const [c, ph] of [[DISPC.bl, 0], [DISPC.or, Math.PI / 2 * wd]]) { const pts = []; for (let x = 0; x <= w; x += 2) pts.push([x, hh / 2 - Math.sin(x / w * Math.PI * 4 + ph) * amt * (hh / 2 - 6)]); lvPath(g, pts, c, null, 1.8); } });
  const box = k.dk(disp, k.CH(0, ['Chorus', 'Ensemble', 'Vibrato'], { cls: 'lk-orb' }),
    k.row(k.col(k.row(k.T(5, '', { cls: 'lk-chkbox' }), ico('M2 11Q6 3 11 3H22')), k.NT(6, { w: 58, cls: 'or' })), k.TL('Width', k.NT(7, { w: 54, cls: 'or' })), k.TL('Time', k.NT(8, { w: 54, cls: 'or' })), k.TL('Taps', k.CH(9, ['1', '2'], { cls: 'lk-orb sm' }))));
  return k.row(k.col(box, k.row(k.K(1), k.K(2), k.K(3), k.T(4, 'Ø', { w: 24 }))), k.sep(), k.col(k.K(11), k.K(10), k.K(12)));
};
// Phaser-Flanger: dark box (notch display, Phaser / Flanger / Doubler, Notches / Center / Spread / Blend / Time) | Hz / sync, Freq, Amount,
// Feedback, invert | Output, Warmth, Dry/Wet
V[21] = (k) => {
  const disp = k.D(240, 52, (g, w, hh) => {
    const mode = Math.round(k.get(0)), n = mode === 0 ? Math.round(k.get(1)) : 12, c = k.get(2), sp = k.get(3);
    for (let j = 0; j < n; j++) { const f = c * Math.pow(2, (j - (n - 1) / 2) * (0.25 + sp * 0.9)), x = lx(Math.max(20, Math.min(20000, f)), w); g.fillStyle = j % 2 ? DISPC.bl : DISPC.or; g.fillRect(Math.round(x), 6, 2, hh - 12); }
  });
  const O = (n, j, ww = 52) => k.TL(n, k.NT(j, { w: ww, cls: 'or' }));
  const box = k.dk(disp, k.CH(0, ['Phaser', 'Flanger', 'Doubler'], { cls: 'lk-orb' }), k.row(O('Notches', 1, 48), O('Center', 2, 60), O('Spread', 3), O('Blend', 4), O('Time', 13)));
  return k.row(k.col(box, k.row(k.CH(6, ['Hz', '♪'], { v: true, cls: 'sm' }), k.swap(6, () => k.K(14, { n: 'Freq' }), () => k.K(5)), k.K(7), k.K(8), k.T(9, 'Ø', { w: 24 }))), k.sep(), k.col(k.K(11), k.K(10), k.K(12)));
};

// ---- Live 12 look for the remaining effects (sections side by side, dark display with cyan curve + orange ring, orange toggles) -----------
// Roar: Input (Drive, Tone) | shaper display (drag: x = Bias, y = Amount) with the Shape modes | Feedback | Output (Compress, Output, Dry/Wet)
const roarShape = (t, x) => { switch (t) { case 0: return Math.tanh(x); case 1: return Math.max(-1, Math.min(1, x)); case 2: { let u = (x + 1) * 0.25; u -= Math.floor(u); return 1 - Math.abs(u * 4 - 2); } case 3: return Math.sin(Math.max(-3, Math.min(3, x)) * 0.94); case 4: return Math.round(Math.max(-1, Math.min(1, x)) * 6) / 6; default: return Math.tanh(x) + Math.sin(x * 37) * 0.06; } };
V[9] = (k) => {
  const disp = k.D(176, 104, (g, w, hh) => {
    const t = Math.round(k.get(0)), dr = Math.pow(10, k.get(1) / 20), a = k.get(6), bias = k.get(5) * 0.5, nrm = t === 0 ? 1 / Math.tanh(Math.max(dr, 1)) : 1;
    const X = (x) => w / 2 + x * (w / 2 - 8), Y = (y) => hh / 2 - Math.max(-1.15, Math.min(1.15, y)) * (hh / 2 - 8);
    g.fillStyle = DISPC.grid; g.fillRect(0, Math.round(hh / 2), w, 1); g.fillRect(Math.round(w / 2), 0, 1, hh);
    lvPath(g, [[X(-1), Y(-1)], [X(1), Y(1)]], DISPC.grid2, null, 1);
    const pts = []; for (let x = -1; x <= 1.0001; x += 0.02) pts.push([X(x), Y((roarShape(t, x * dr + bias) - roarShape(t, bias)) * nrm * a + x * (1 - a))]);
    lvPath(g, pts, DISPC.bl, null, 1.8); lvRing(g, X(bias / 1.5), Y((1 - a) * 0.9 + 0.1), 4.5);
    label(g, ['Soft Sine', 'Hard Clip', 'Fold', 'Sine', 'Bit', 'Noise'][t] || '', 6, 13, DISPC.or);
  }, { onDown: () => ({ b: k.get(5), a: k.get(6) }), onMove: (x, y, dx, dy, s) => { k.set(5, Math.max(-1, Math.min(1, s.b + dx / 80))); k.set(6, Math.max(0, Math.min(1, s.a - dy / 90))); } });
  return k.row(k.sec('Input', k.K(1, { big: true }), k.K(2)), k.sep(),
    k.col(k.dk(disp), k.row(k.S(0, { w: 86 }), k.K(5), k.K(6))), k.sep(),
    k.sec('Feedback', k.K(7, { n: 'Amount' }), k.row(k.K(8, { n: 'Time' }), k.K(9, { n: 'Freq' }))), k.sep(),
    k.sec('Output', k.K(10), k.row(k.K(4), k.K(3))));
};
// Autoduck (FL Studio Mobile; laid out like Live's Glue Compressor sidechain): Audio From | ducking display (threshold line, GR meter, the
// envelope Attack -> Release drawn to scale) with Attack / Release fields | Threshold (big), Amount
V[10] = (k) => {
  const { ctx, d } = k; let gr = 0;
  const srcName = () => { const v = Math.round(k.get(0)); if (v < 1) return 'No Input'; const t = P.state.tracks[v - 1]; return t ? t.name : 'Track hilang'; };
  const src = h('button', { class: 'lv-fld sel lk-src', style: 'width:118px' }, h('span', { class: 'v' }, srcName()), h('i', { class: 'tri' }));
  src.addEventListener('click', () => { const r = src.getBoundingClientRect(), items = [{ label: 'No Input', check: k.get(0) < 1, fn: () => { k.set(0, 0); src.firstChild.textContent = srcName(); if (src._sc) src._sc.update(); } }];
    P.state.tracks.forEach((t, j) => { if (t.kind !== 'auto' && j !== ctx.i) items.push({ label: t.name, check: Math.round(k.get(0)) === j + 1, fn: () => { k.set(0, j + 1); src.firstChild.textContent = srcName(); if (src._sc) src._sc.update(); } }); });
    menu(items, r.left, r.bottom + 1); });
  const disp = k.D(214, 82, (g, w, hh) => {                                   // gain-reduction needle meter (Live Glue Compressor), 0..24 dB
    const cx = w / 2, cy = hh + 18, R = hh + 2, ang = (db) => Math.PI * (1.25 + 0.5 * Math.max(0, Math.min(24, db)) / 24);
    g.lineWidth = 1.2; for (const v of [0, 6, 12, 18, 24]) { const a = ang(v), c = Math.cos(a), sn = Math.sin(a); g.strokeStyle = v === 12 ? DISPC.or : DISPC.ink; g.beginPath(); g.moveTo(cx + c * (R - 12), cy + sn * (R - 12)); g.lineTo(cx + c * (R - 4), cy + sn * (R - 4)); g.stroke();
      g.fillStyle = DISPC.ink; g.font = '600 9px system-ui,sans-serif'; g.textAlign = 'center'; g.fillText(String(v), cx + c * (R - 22), cy + sn * (R - 22) + 3); }
    g.textAlign = 'left'; g.strokeStyle = DISPC.grid2; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, R - 2, ang(0), ang(24)); g.stroke();
    g.strokeStyle = DISPC.or; g.beginPath(); g.arc(cx, cy, R - 2, ang(0), ang(Math.min(24, k.get(2)))); g.stroke();   // Amount: how deep it can duck
    const a = ang(gr); g.strokeStyle = DISPC.bl; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18); g.lineTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6)); g.stroke();
    label(g, 'GR ' + gr.toFixed(1) + ' dB', 6, 12, DISPC.bl, 9);
  });
  k.every(50, () => { const r = k.out(); if (r.length) { gr += ((r[0] || 0) - gr) * 0.5; disp.paint(); } });
  // Sidechain lit while a track is chosen (Live: the Sidechain switch); off = No Input, on = pick the track
  const scBtn = lvTog('Sidechain', () => k.get(0) >= 1, (on) => { if (!on) { k.set(0, 0); src.firstChild.textContent = srcName(); scBtn.update(); } else src.click(); }, { cls: 'lk-t', w: 86 }); src._sc = scBtn;
  const sc = k.sec('', scBtn, k.TL('Audio From', src), h('span', { class: 'lk-lb lk-hint' }, 'Track yang membuat suara ini mengecil')); sc.classList.add('lk-scsec');
  return k.row(sc, k.sep(),
    k.col(k.K(3), k.K(4)), k.sep(),
    k.col(k.dk(disp, k.row(k.K(1, { n: 'Threshold', big: true }), k.K(2, { big: true })))));
};
// Stereolizer (FL Studio Mobile; Live Utility look): goniometer + correlation | Width (big) | Mid / Side | Bass Mono | Balance / Output
V[14] = (k) => {
  let o = null;
  const disp = k.DF(132, 104, (g, w, hh) => {
    const R = Math.min(w / 2 - 8, hh - 40), cx = w / 2, cy = Math.round((hh - 16 + R) / 2) + 2;
    g.strokeStyle = DISPC.grid; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R, Math.PI, 0); g.stroke();
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx - R * 0.7071, cy - R * 0.7071); g.moveTo(cx, cy); g.lineTo(cx + R * 0.7071, cy - R * 0.7071); g.moveTo(cx, cy); g.lineTo(cx, cy - R); g.stroke();
    label(g, 'L', cx - R * 0.72 - 9, cy - R * 0.72, DISPC.ink, 8.5); label(g, 'R', cx + R * 0.72 + 3, cy - R * 0.72, DISPC.ink, 8.5);
    if (o && o.length >= 133) { g.fillStyle = DISPC.bl; for (let j = 0; j < 64; j++) { const sx = o[5 + j * 2], sy = Math.abs(o[6 + j * 2]); g.fillRect(cx + Math.max(-1, Math.min(1, sx * 1.6)) * R - 1, cy - Math.min(1, sy * 1.6) * R - 1, 2, 2); } }
    const wd = k.get(0); lvPath(g, [[cx - R * Math.min(1, wd / 2) * 1, cy - R * 0.25], [cx, cy - R], [cx + R * Math.min(1, wd / 2), cy - R * 0.25]], DISPC.or, null, 1.3);
    const c = o ? Math.max(-1, Math.min(1, o[0])) : 0; g.fillStyle = '#1b1b1d'; g.fillRect(8, hh - 12, w - 16, 6); g.fillStyle = c < 0 ? '#ff6b5a' : DISPC.bl;
    g.fillRect(w / 2, hh - 12, (c * (w - 16)) / 2, 6); label(g, '-1', 8, hh - 14, DISPC.ink, 7.5); label(g, '+1', w - 18, hh - 14, DISPC.ink, 7.5);
  });
  k.every(60, () => { const r = k.out(); if (r.length) { o = r; disp.paint(); } });
  return k.row(k.col(k.dk(disp)), k.sep(), k.col(k.K(0, { big: true }), k.K(4)), k.col(k.K(1), k.K(2)), k.sep(),
    k.col(k.sec('Bass Mono', k.K(3, { n: 'Freq' })), k.K(5, { n: 'Gain' })));
};
// Spacer (FL Studio Mobile; Live Reverb look): Input (Lo Cut, Pre-delay) | early reflections display (L up / R down, drag = Size) with
// Size / Spread / Damping | Dry/Wet
V[15] = (k) => {
  const TL0 = [0.0113, 0.0173, 0.0233, 0.0311, 0.0397, 0.0491], TR0 = [0.0131, 0.0197, 0.0269, 0.0347, 0.0433, 0.0527], G0 = [0.8, 0.66, 0.54, 0.44, 0.34, 0.26];
  const disp = k.DF(176, 84, (g, w, hh) => {
    const sz = 0.3 + k.get(0) * 1.7, pre = k.get(4) / 1000, sp = k.get(1), dm = k.get(2), mid = hh / 2, tmax = 0.11, x = (t) => 8 + (t / tmax) * (w - 16);
    g.fillStyle = DISPC.grid; g.fillRect(0, Math.round(mid), w, 1);
    g.fillStyle = DISPC.ink; g.fillRect(x(0), 8, 2, mid - 8);
    for (let j = 0; j < 6; j++) { const a = G0[j] * (1 - dm * 0.5 * j / 5); g.fillStyle = DISPC.bl;
      g.fillRect(Math.round(x(pre + TL0[j] * sz)), mid - a * (mid - 10), 2, a * (mid - 10)); g.globalAlpha = 0.45 + sp * 0.55; g.fillRect(Math.round(x(pre + TR0[j] * sz * (1 + sp * 0.1))), mid, 2, a * (mid - 10)); g.globalAlpha = 1; }
    label(g, 'L', 3, 14, DISPC.ink, 8.5); label(g, 'R', 3, hh - 5, DISPC.ink, 8.5); label(g, Math.round((pre + TR0[5] * sz) * 1000) + ' ms', w - 44, 13, DISPC.or);
  }, { onDown: () => ({ s: k.get(0) }), onMove: (x, y, dx, dy, s) => k.set(0, Math.max(0, Math.min(1, s.s + dx / 150))) });
  return k.row(k.sec('Input Processing', k.K(5, { n: 'Lo Cut' }), k.K(4, { n: 'Predelay' })), k.sep(),
    k.col(k.dk(disp), k.row(k.K(0), k.K(1), k.K(2, { n: 'Damping' }))), k.sep(), k.col(k.K(3, { n: 'Dry/Wet', big: true })));
};
// Tape Stop (FL Studio Mobile): Play / Sync toggles | speed curve (stop ramp down, start ramp up, Warp bends it; the live speed as a ring) with
// Stop / Start lengths (beats when Sync is on, seconds when off) | Warp
V[52] = (k) => {
  // laid out as FL Studio Mobile's Tape Stop (owner's screenshot): a big tape reel for Start Time on the left and for Stop Time on the right
  // (value in the hub: beats when Sync is on, seconds when off; drag the reel up / down), in the middle Sync, the big Play button and Warp.
  // The reels turn with the tape speed while the effect works (fluid), in the Live colours.
  let sp = 1, st = 0, ang = 0;
  const reel = (kt, kb, name) => {
    const c = k.D(118, 118, (g, w, hh) => {
      const cx = w / 2, cy = hh / 2, R = w / 2 - 6, sync = k.get(1) > 0.5, p = k.def.params[sync ? kb : kt], v = k.get(sync ? kb : kt), f = (v - p.min) / Math.max(1e-9, p.max - p.min);
      g.lineWidth = 6; g.strokeStyle = '#1b1b1d'; g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
      g.save(); g.shadowColor = 'rgba(79,195,240,.6)'; g.shadowBlur = 6; g.strokeStyle = DISPC.bl; g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * f)); g.stroke(); g.restore();
      g.fillStyle = '#2c2c30'; g.beginPath(); g.arc(cx, cy, R - 10, 0, 6.2832); g.fill();
      g.fillStyle = '#1b1b1d'; for (let q = 0; q < 3; q++) { const a = ang + q * 2.0944; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R - 16, a - 0.42, a + 0.42); g.closePath(); g.fill(); }   // reel spokes, turning with the tape
      g.fillStyle = '#3a3a3e'; g.beginPath(); g.arc(cx, cy, 17, 0, 6.2832); g.fill();
      label(g, sync ? (p.items ? p.items[Math.round(v - p.min)] : String(v)) : (v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s'), cx, cy + 4, '#e8e8ec', 11, 'center');
    }, { onDown: () => { const sync = k.get(1) > 0.5; return { k0: sync ? kb : kt, v: k.get(sync ? kb : kt) }; },
      onMove: (x, y, dx, dy, s) => { const p = k.def.params[s.k0]; let v = p.curve === 'log' ? Math.max(p.min, Math.min(p.max, s.v * Math.pow(2, -dy / 40))) : Math.max(p.min, Math.min(p.max, s.v - dy * (p.max - p.min) / 160)); if (p.step || p.items) v = Math.round(v); k.set(s.k0, v); } });
    k.reg(c, kt); const alt = k.reg(h('span', { hidden: true }), kb); alt.update = () => c.paint();   // the reel sets seconds (Sync off) or beats (Sync on)
    const col = k.col(c, alt, h('span', { class: 'lk-lb lk-reel' }, name)); col.classList.add('lk-reelc'); return col;
  };
  const play = k.T(0, '▶', { w: 52, cls: 'lk-tplay' });
  const sync = k.T(1, 'Sync', { w: 52 });
  const rS = reel(2, 3, 'Start Time'), rE = reel(4, 5, 'Stop Time');
  k.every(16, () => { const r = k.out(); if (r.length) { st = r[0]; sp = r[1]; } ang += (k.get(0) > 0.5 ? 1 : sp) * 0.06; k.redraw(); });
  return k.row(rS, k.col(sync, play, k.K(6)), rE);
};

// FL Studio Mobile modules (defs.js FLMFX, C++ only, native/engine/hdfx.cpp): FLM's own controls, compact. Menus and switches in one strip on
// top, the continuous controls as small knobs below (wrapping); Pitcher's note grid as 12 note buttons. Values are FLM's normalized ones.
const flmPanel = (k, only = null, short = null) => {
  const ps = k.def.params, menus = [], togs = [], knobs = [], notes = [], nm = (j) => (short ? short(ps[j].n) : ps[j].n);
  const sel = (j) => { const p = ps[j], n = p.items.length; return k.TL(nm(j), k.reg(lvSel(() => p.items.map((l, q) => ({ label: l, value: q })), () => (p.br ? menuItem(p.br, k.get(j)) : Math.round(k.get(j) * (n - 1))), (q) => k.set(j, n > 1 ? q / (n - 1) : 0), { w: 84, cls: 'lk-s' }), j)); };
  (only || ps.map((_, j) => j)).forEach((j) => {
    const p = ps[j]; if (!p || p.hidden) return;
    if (/^Note /.test(p.n) && p.fmt === 'onoff') notes.push(k.T(j, p.n.slice(5), { w: 30 }));
    else if (p.fmt === 'flmlist') menus.push(sel(j));
    else if (p.fmt === 'onoff') togs.push(k.T(j, nm(j), { w: Math.max(44, Math.min(96, 8 + nm(j).length * 7)) }));
    else knobs.push(k.K(j, { n: nm(j), p: { lawCtx: () => ({ p: k.d.params }) } }));   // a text that reads another param of this module (Autoduck Hold)
  });
  const gr = !only && FLM_GRAPH[k.def.flm], disp = gr ? k.DF(200, 86, (g, w, hh) => gr(g, w, hh, (j) => k.get(j))) : null;   // the module's curve (flmviz.js)
  const body = k.col(menus.length || togs.length ? h('div', { class: 'lk-row lk-flmtop' }, ...menus, ...togs) : null,
    notes.length ? h('div', { class: 'lk-row lk-flmnotes' }, ...notes) : null, h('div', { class: 'lk-row lk-flmk' }, ...knobs));
  return disp ? h('div', { class: 'lk-row lk-flm' }, h('div', { class: 'lk-col lk-flmd' }, disp), body) : body;
};
for (const t of Object.keys(DEVICES)) if (DEVICES[t].view === 'flmfx') V[t] = flmPanel;
VI[34] = flmPanel;   // Transistor Bass: the same compact FLM layout (its Distortion is a switch)
// 3x Osc: FLM's eight pages (Honeydew instruments.rs) as tabs; within a page the controls drop the page's own prefix ("Volume Envelope Attack"
// -> "Attack"). The tab is remembered per track.
const OSC3_PAGES = (() => {
  const r = (a, b) => Array.from({ length: b - a + 1 }, (_, q) => a + q), lfo = (t) => [27, 32, 37, 42, 47, 52, 57].map((x) => x + t), env = (t) => r(0, 11).map((q) => 62 + t + 4 * q);
  const osc = (i) => [1, 4, 7, 10, 13, 16, 19].map((x) => x + i).concat(i ? [21 + i] : [], i === 2 ? [24] : [], [146 + i]);
  return [['Osc', [['Osc 1', osc(0)], ['Osc 2', osc(1)], ['Osc 3', osc(2)], ['Global', [25, 26]]]], ['Pan', [['LFO', lfo(0)], ['Pan', [113, 122, 126]]]],
    ['Vol', [['LFO', lfo(1)], ['Envelope', [...env(0), 114]]]], ['Cut', [['LFO', lfo(2)], ['Envelope', env(1)]]], ['Res', [['LFO', lfo(3)], ['Envelope', env(2)]]],
    ['Pitch', [['LFO', lfo(4)], ['Envelope', env(3)]]], ['Filter', [['Filter', [110, 111, 112, 115, 116]], ['Tracking', [121, 123, 124, 125, 127, 128]]]],
    ['Misc', [['Voices', [117, 118, 119, 120, 129]], ['Echo', r(130, 138)], ['Arpeggio', r(139, 145)]]]];
})();
const osc3Tab = new Map();
VI[36] = (k) => {
  const key = k.ctx.d && k.ctx.d.id, page = h('div', { class: 'lk-row lk-o3p' });
  const short = (n) => n.replace(/^Osc 3 = amplitude modulation$/, 'AM').replace(/^Osc [123] /, '').replace(/^Stereo Phase Randomness$/, 'Phase Rand').replace(/^(Pan|Volume|ModX|ModY|Pitch) (LFO|Envelope) /, '').replace(/^Delay /, '').replace(/^Arpeggio /, '').replace(/^Filter /, '').replace(/^Key Tracking /, 'Key ').replace(/^Velocity Tracking /, 'Vel ');
  const show = (j) => { osc3Tab.set(key, j); page.replaceChildren(...OSC3_PAGES[j][1].map(([title, idx]) => h('div', { class: 'lk-col lk-o3g' }, h('div', { class: 'lk-o3h' }, title), flmPanel(k, idx, short)))); };
  const j0 = osc3Tab.get(key) || 0;
  const tb = lvTabs(OSC3_PAGES.map(([label]) => ({ label })), j0, show, { cls: 'lk-tabs' });
  show(j0);
  return k.col(tb, page);
};
// Slicer: the loop (zone 0, picked from the browser) above the compact FLM controls
VI[35] = (k) => {
  const { i } = k.ctx, t = P.state.tracks[i], z = () => (t.inst.zones && t.inst.zones[0]) || {};
  const name = h('span', { class: 'lk-lb' }), upd = () => { name.textContent = z().sample ? (z().sample.name || String(z().sample.path || '').split('/').pop()) : 'Belum ada loop'; };
  upd(); k.every(500, upd);
  return k.col(h('div', { class: 'lk-row lk-flmtop' }, h('button', { class: 'lv-btn', onclick: () => BR.openBrowser('file', { track: i, zone: 0 }) }, 'Loop\u2026'), name), flmPanel(k));
};

export const KIT = V;
export function kitView(ctx) { if (!V[ctx.d.type]) return null;   // no Live 12 panel yet: the card falls back to the automatic knob layout
  const k = kit(ctx); const el = V[ctx.d.type](k); el.classList.add('lk'); return { el, draw: k.redraw }; }

// ---- Drum Rack chain of one pad (devices.js Drum Rack card): instrument chooser, the instrument's Live 12 panel, the chain's effects in a row.
// Parameters go through project.js padChain* (one undo step per change, no automation lanes: map them through the pad's knobs instead).
export function padChainView(i, k, every) {
  const t = P.state.tracks[i], q = P.padsOf(i)[k], c = q && q.chain, draws = [];
  const r = (e) => e.currentTarget.getBoundingClientRect();
  const pickInst = (e) => { const rc = r(e); menu([{ label: 'Suara pad sendiri (tanpa instrumen)', check: !(c && c.inst), fn: () => P.setPadChainInst(i, k, 0) }, { sep: true },
    ...P.PAD_INSTS.map((ty) => ({ label: INSTRUMENTS[ty].name, check: !!(c && c.inst && c.inst.type === ty), fn: () => P.setPadChainInst(i, k, ty) }))], rc.left, rc.bottom + 1); };
  const pickSample = () => BR.openBrowser('file', { track: i, padChain: k });
  const head = h('div', { class: 'drk-chh' }, h('b', {}, 'Chain'), h('span', { class: 'lk-grow' }),
    h('button', { class: 'lv-btn', onclick: pickInst }, c && c.inst ? INSTRUMENTS[c.inst.type].name + ' ▾' : 'Instrumen ▾'),
    h('button', { class: 'lv-btn', onclick: (e) => fxMenu(r(e), (ty) => P.padChainAddDevice(i, k, ty)) }, '+ Efek'));
  const body = h('div', { class: 'drk-chb' });
  if (c && c.inst) {
    const def = INSTRUMENTS[c.inst.type], ip = c.inst.params;
    const d = { id: 'pc' + t.id + '.' + k, type: c.inst.type, params: new Proxy({}, { get: (_, kk) => ip[kk] ?? (def.params[kk] ? def.params[kk].def : undefined) }) };
    const ctx = { i, di: -1, d, def, every, nested: true, setParam: (kk, v) => P.padChainParam(i, k, +kk, v), autoFn: () => null };
    let el;
    if (def.sampler) {                                                        // Simpler in a pad: its sample + the main controls
      const kk = kit(ctx), K = (n) => kk.K(def.params.findIndex((x) => x.n === n));
      el = h('div', { class: 'lk-col lk-pcs' }, h('div', { class: 'lk-row lk-shead' }, h('span', { class: 'lk-st' }, c.inst.sample ? c.inst.sample.name : 'Belum ada sample'), lvBtn('Sample…', pickSample, { cls: 'lk-t' })),
        h('div', { class: 'lk-row lk-dsk' }, K('Gain'), K('Transp'), K('Frequency'), K('Res'), K('Attack'), K('Decay'), K('Release'), K('Volume')));
      draws.push(kk.redraw);
    } else if (VI[c.inst.type]) { const kk = kit(ctx); el = VI[c.inst.type](kk); draws.push(kk.redraw); }
    if (el) { el.classList.add('lk', 'lk-inst'); body.append(h('div', { class: 'card lkcard lk-rcard drk-chi' }, h('h4', {}, h('span', {}, def.name)), el)); }
  } else body.append(h('div', { class: 'drk-note' }, 'Pad ini memakai suaranya sendiri. Pilih instrumen untuk membuat chain (instrumen + efek), seperti Drum Rack Live.'));
  (c ? c.devices : []).forEach((x, j) => {
    const def = DEVICES[x.type], ctx = { i, di: -1, d: x, def, every, nested: true, setParam: (kk, v) => P.padChainDevParam(i, k, j, kk, v), autoFn: () => null };
    const kv = kitView(ctx); if (kv) draws.push(kv.draw);
    const n = c.devices.length;
    const more = h('button', { class: 'dv-more', 'aria-label': 'Menu efek', onclick: (e) => { const rc = r(e); menu([{ label: 'Geser ke kiri', dim: j <= 0, fn: () => P.padChainMoveDevice(i, k, j, j - 1) }, { label: 'Geser ke kanan', dim: j >= n - 1, fn: () => P.padChainMoveDevice(i, k, j, j + 1) }, { sep: true }, { label: x.bypass ? 'Aktifkan' : 'Bypass', fn: () => P.padChainBypass(i, k, j) }, { label: 'Hapus efek', fn: () => P.padChainRemoveDevice(i, k, j) }], rc.left - 120, rc.bottom); } }, '⋯');
    const hd = h('h4', {}, h('span', {}, def.name), more);
    if (n > 1) reorderGrip(hd, { index: j, siblings: (card) => [...card.parentElement.children].filter((el) => el.classList.contains('lk-pfx')), move: (to) => P.padChainMoveDevice(i, k, j, to) });
    body.append(h('div', { class: 'card lkcard lk-rcard lk-pfx' + (x.bypass ? ' off' : '') }, hd, kv ? kv.el : null));
  });
  return { el: h('div', { class: 'drk-chain' }, head, body), draw: () => { for (const f of draws) f(); } };
}

// ================================================================================================ FL Studio Mobile instruments (30..33)
// DirectWave / GMS / MiniSynth / SuperSaw panels: js/flmpanels.js (tabs as in FLM, Live 12 sections, displays that fill the card)
addFlmPanels(VI);
