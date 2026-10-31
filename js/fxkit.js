// Live 12 device panels for the effects of js/engine/fx3.js (defs.js: kit: true). Every control is bound to a real engine parameter;
// the layout follows the owner's reference images of Live 12 (sections side by side, label above / value below each knob, orange toggles,
// cyan value boxes, dark displays with a cyan curve and hollow orange rings that can be dragged).
import { h, knob, menu, ask, fromNorm, toNorm } from './ui.js';
import { C } from './theme.js';
import { fmtParam, normOf, valOf, MOD_MAP, DEVICES, INSTRUMENTS, FX_GROUPS, IRACK_DEF } from './defs.js';
import { buildSynth } from './devviz.js';
import { OP_ALGOS } from './engine/operator.js';
import { POLI_TGT, POLI_GRID, POLI_MIDI } from './engine/poli.js';
import { lvNum, lvTog, lvBtn, lvChoice, lvSel, lvDisp, lvDrag, lvRing, lvPath, lvTabs, lvEnvPts, DISPC } from './liveui.js';
import { eq8Stages } from './engine/fx3.js';
import { offerAutomation } from './automate.js';
import { Biquad } from './engine/dsp.js';
import { eng, MASTER, RET0 } from './engine.js';
import * as P from './project.js';

const SR = 48000, F0 = 20, F1 = 20000;
const lx = (f, w) => (Math.log(f / F0) / Math.log(F1 / F0)) * w, xl = (x, w) => F0 * Math.pow(F1 / F0, Math.max(0, Math.min(1, x / w)));
const mag = (b, f) => { const w = 2 * Math.PI * f / SR, c1 = Math.cos(w), c2 = Math.cos(2 * w), s1 = Math.sin(w), s2 = Math.sin(2 * w);
  const nr = b.b0 + b.b1 * c1 + b.b2 * c2, ni = -(b.b1 * s1 + b.b2 * s2), dr = 1 + b.a1 * c1 + b.a2 * c2, di = -(b.a1 * s1 + b.a2 * s2); return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di)); };
const grid = (g, w, hh) => { g.fillStyle = DISPC.grid; for (const f of [100, 1000, 10000]) g.fillRect(Math.round(lx(f, w)), 0, 1, hh); };
const label = (g, t, x, y, col = DISPC.ink, sz = 9, al = 'left') => { g.fillStyle = col; g.font = `600 ${sz}px system-ui,sans-serif`; g.textAlign = al; g.textBaseline = 'alphabetic'; g.fillText(t, x, y); g.textAlign = 'left'; };

// ---- the kit: controls bound to device parameters -------------------------------------------------
function kit(ctx) {
  const { i, di, d, def } = ctx, draws = [], ctls = [];
  const get = (k) => d.params[k];
  const redraw = () => { for (const f of draws) f(); };
  const set = (k, v) => { if (ctx.setParam) ctx.setParam(k, v); else P.setDeviceParam(i, di, k, v); redraw(); for (const c of ctls) if (c.update && c._k !== k) c.update(); };
  const auto = (k) => (ctx.autoFn ? ctx.autoFn(k) : ctx.nested ? null : (rect) => offerAutomation(rect, { kind: 4, strip: P.stripOf(i), devId: d.id, param: k, def: def.params[k] }, `${def.name} ${def.params[k].n}`));   // devices inside a rack have no automation lanes (map them to a macro)
  const reg = (el, k) => { el._k = k; ctls.push(el); return el; };
  const lbl = (k, o) => (o && o.n != null ? o.n : def.params[k].n.replace(/^(L\+R|L|R) /, ''));
  const K = (k, o = {}) => { const el = knob({ ...def.params[k], n: lbl(k, o) }, () => get(k), (v) => set(k, v), fmtParam, C('#7ac5ff'), auto(k)); el.classList.add('lk-k'); if (o.big) el.classList.add('big'); if (o.col) el.style.setProperty('--lv-arc', o.col); return reg(el, k); };
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
  const D = (w, hh, draw, drag) => { const c = lvDisp(w, hh, (g) => draw(g, w, hh)); c.classList.add('lk-d'); draws.push(() => c.paint()); if (drag) lvDrag(c, drag); return c; };
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
  return { ctx, d, def, get, set, K, swapN, T, CY, CH, S, N, NT, dk, LN, TL, D, sec, row, col, sep, every, out, swap, redraw, reg, auto };
}
// filter (band) display with a draggable ring: x = freq, y = width (or Q); used by the delays, Beat Repeat, Erosion, Vinyl
function bandDisp(k, w, hh, kf, kw, o = {}) {
  return k.D(w, hh, (g) => {
    grid(g, w, hh);
    const f = k.get(kf), wd = kw != null ? k.get(kw) : 1, on = o.on == null || k.get(o.on) > 0.5;
    const hp = new Biquad(), lp = new Biquad(), bp = new Biquad(); let fn;
    if (o.peak) { bp.bandpass(SR, f, 1 / Math.max(0.05, wd)); fn = (x) => mag(bp, x); }
    else { const kk = Math.pow(2, wd / 2); hp.highpass(SR, Math.max(20, f / kk), 0.707); lp.lowpass(SR, Math.min(20000, f * kk), 0.707); fn = (x) => mag(hp, x) * mag(lp, x); }
    const pts = []; for (let x = 0; x <= w; x += 2) { const m = fn(xl(x, w)); pts.push([x, hh - 4 - Math.min(1.4, m) / 1.4 * (hh - 10)]); }
    lvPath(g, pts, on ? DISPC.bl : DISPC.grid2, hh, 1.6);
    const peak = fn(f); lvRing(g, lx(f, w), hh - 4 - Math.min(1.4, peak) / 1.4 * (hh - 10), 4.5);
  }, { onDown: () => ({ f: k.get(kf), w: kw != null ? k.get(kw) : 0 }),
    onMove: (x, y, dx, dy, s) => { k.set(kf, Math.max(20, Math.min(20000, s.f * Math.pow(2, dx / (w / 10))))); if (kw != null) k.set(kw, Math.max(o.wmin || 0.5, Math.min(o.wmax || 9, s.w + dy / (o.peak ? 30 : 12)))); } });
}

// ================================================================================================ views
const V = {};
// Delay: Left / Right (16th grid when synced, time knob when not), feedback + freeze, filter display with modulation, mode, ping pong, dry/wet
V[17] = (k) => {
  const side = (o, name) => k.col(h('div', { class: 'lk-st c' }, name), k.T(o, 'Sync'),
    k.swap(o, () => k.CH(o + 1, ['1', '2', '3', '4', '5', '6', '8', '16'], { cls: 'g2' }), () => k.K(o + 2, { n: 'Time' })), k.N(o + 3, { w: 58 }));
  return k.row(
    k.sec(null, k.row(side(0, 'Left'), h('div', { class: 'lk-mid' }, k.T(8, '⇄', { cls: 'link', w: 24 })), side(4, 'Right')), k.row(k.K(9), k.T(10, '∞', { cls: 'frz', w: 28 }))), k.sep(),
    k.sec(null, k.row(k.T(11, 'Filter'), k.N(12, { w: 66 }), k.N(13, { w: 48 })), bandDisp(k, 190, 64, 12, 13, { on: 11 }),
      h('div', { class: 'lk-st c' }, 'Modulation'), k.row(k.K(14, { n: 'Rate' }), k.K(15, { n: 'Filter' }), k.K(16, { n: 'Time' }))), k.sep(),
    k.sec('Mode', k.CH(17, ['Repitch', 'Fade', 'Jump'], { v: true }), k.T(18, 'Ping Pong'), k.K(19)));
};
// Filter Delay: three lines L / L+R / R, each: input on, filter on + display, sync grid / time, feedback, pan, volume; dry at the end
V[18] = (k) => {
  const line = (n, name) => { const o = n * 10; return k.row(k.col(k.T(o, name, { w: 34 }), k.T(o + 1, 'On', { w: 34 }), k.N(o + 2, { w: 58 }), k.N(o + 3, { w: 44 })),
    bandDisp(k, 110, 52, o + 2, o + 3, { on: o + 1 }),
    k.col(k.T(o + 4, 'Sync', { w: 44 }), k.swap(o + 4, () => k.S(o + 5, { w: 50 }), () => k.N(o + 6, { w: 60 }))),
    k.K(o + 7, { n: 'Feedback' }), k.K(o + 8, { n: 'Pan' }), k.K(o + 9, { n: 'Volume' })); };
  return k.row(k.col(line(0, 'L'), line(1, 'L+R'), line(2, 'R')), k.sep(), k.sec('Dry', k.K(30, { n: 'Dry' })));
};
// Beat Repeat: position display (interval / offset / gate / grid), the main knobs, filter display, mix modes
V[19] = (k) => {
  const pos = k.D(206, 44, (g, w, hh) => {
    const iv = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16][Math.round(k.get(0))], bars = Math.max(1, iv / 4), beat = w / (bars * 4), off = k.get(1) / 4 * beat, gate = k.get(5) / 4 * beat, gr = [1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 1 / 12, 0.0625][Math.round(k.get(2))] * beat;
    g.fillStyle = DISPC.grid; for (let b = 0; b <= bars * 4; b++) g.fillRect(Math.round(b * beat), hh - 12, 1, 4);
    g.fillStyle = '#ffad32'; g.fillRect(off, 4, Math.min(w - off, gr), hh - 18);
    g.fillStyle = '#5fd08a'; g.fillRect(off + gr, 4, Math.max(0, Math.min(w - off - gr, gate - gr)), hh - 18);
    for (let b = 0; b < bars * 4; b++) label(g, String(b / 4).replace(/^0\./, '.'), b * beat + 2, hh - 1, DISPC.ink, 8);
  });
  const o = k.out; k.every(100, () => { const r = o(); pos.style.outline = r[0] ? '1px solid #ffad32' : ''; });
  return k.row(
    k.col(pos, k.row(k.K(0), k.K(1), k.K(2), k.K(3)), k.row(k.T(15, 'Repeat'), k.T(14, 'No Trpl')), k.row(k.K(4), k.K(5), k.K(6), k.K(7))), k.sep(),
    k.col(bandDisp(k, 120, 50, 9, 10, { on: 8 }), k.row(k.N(9, { w: 58 }), k.N(10, { w: 44 })), k.T(8, 'Filter'), k.CH(11, ['Mix', 'Ins', 'Gate']), k.row(k.K(12), k.K(13))));
};
// Chorus-Ensemble: modulation display, mode buttons, width / time / taps, rate / amount / feedback, warmth / output / dry-wet
V[20] = (k) => {
  const disp = k.D(176, 52, (g, w, hh) => { const amt = k.get(2), wd = k.get(7); for (const [c, ph] of [[DISPC.bl, 0], [DISPC.or, Math.PI / 2 * wd]]) { const pts = []; for (let x = 0; x <= w; x += 2) pts.push([x, hh / 2 - Math.sin(x / w * Math.PI * 4 + ph) * amt * (hh / 2 - 6)]); lvPath(g, pts, c, null, 1.6); } });
  return k.row(
    k.col(disp, k.CH(0, ['Chorus', 'Ensemble', 'Vibrato']), k.row(k.T(5, 'HP'), k.N(6, { w: 56 }), k.K(7), k.K(8), k.S(9, { w: 38 }))), k.sep(),
    k.col(k.row(k.K(1), k.K(2), k.K(3), k.T(4, 'Ø', { w: 24 }))), k.sep(),
    k.col(k.K(11), k.K(10), k.K(12)));
};
// Phaser-Flanger: notch picture, modes, notches / center / spread / blend, rate (Hz or synced) / amount / feedback, output / warmth / dry-wet
V[21] = (k) => {
  const disp = k.D(196, 52, (g, w, hh) => {
    const mode = Math.round(k.get(0)), n = mode === 0 ? Math.round(k.get(1)) : 12, c = k.get(2), sp = k.get(3);
    for (let j = 0; j < n; j++) { const f = c * Math.pow(2, (j - (n - 1) / 2) * (0.25 + sp * 0.9)), x = lx(Math.max(20, Math.min(20000, f)), w); g.fillStyle = j % 2 ? DISPC.bl : DISPC.or; g.fillRect(Math.round(x), 6, 2, hh - 12); }
  });
  return k.row(
    k.col(disp, k.CH(0, ['Phaser', 'Flanger', 'Doubler']), k.row(k.K(1, { n: 'Notches' }), k.K(2), k.K(3), k.K(4), k.K(13))), k.sep(),
    k.col(k.row(k.T(6, 'Sync', { w: 40 }), k.swap(6, () => k.S(14, { w: 54 }), () => k.K(5))), k.row(k.K(7), k.K(8), k.T(9, 'Ø', { w: 24 }))), k.sep(),
    k.col(k.K(11), k.K(10), k.K(12)));
};
// Auto Pan: L / R waveform display, amount / rate / phase / shape / offset, waveform buttons, sync and invert
V[22] = (k) => {
  const W8 = ['Sine', 'Tri', 'Saw', 'Rnd'];
  const disp = k.D(196, 56, (g, w, hh) => {
    const wf = Math.round(k.get(7)), sh = k.get(5), amt = k.get(0), ph = k.get(4) / 360, off = k.get(6) / 360;
    const fn = (x) => { x -= Math.floor(x); let v = wf === 0 ? Math.sin(2 * Math.PI * x) : wf === 1 ? 1 - 4 * Math.abs(x - 0.5) : wf === 2 ? 1 - 2 * x : (Math.sin(Math.floor(x * 8) * 12.9898) * 43758.5) % 1; if (sh > 0) v = Math.max(-1, Math.min(1, v * (1 + sh * 6))); return v; };
    for (const [c, p] of [[DISPC.bl, 0], [DISPC.or, ph]]) { const pts = []; for (let x = 0; x <= w; x += 2) pts.push([x, hh / 2 - fn(x / w * 4 + off + p) * amt * (hh / 2 - 8)]); lvPath(g, pts, c, null, 1.5); }
    label(g, 'L', 3, hh - 3, DISPC.bl); label(g, 'R', w - 9, hh - 3, DISPC.or);
  });
  return k.row(k.col(disp, k.row(k.K(0), k.swap(2, () => k.K(3, { n: 'Rate' }), () => k.K(1)), k.K(4), k.K(5), k.K(6))), k.sep(),
    k.col(k.T(8, 'Invert'), k.T(2, '♪ Sync'), k.CH(7, W8, { cls: 'g2' })));
};
// Gate: level display with the threshold and return lines, attack / hold / release / floor, flip
V[23] = (k) => {
  let lv = -80, gr = 0;
  const disp = k.D(150, 70, (g, w, hh) => {
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
  const vu = k.D(150, 74, (g, w, hh) => {
    const cx = w / 2, cy = hh + 30, R = hh + 18;
    g.strokeStyle = DISPC.grid2; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R - 6, Math.PI * 1.28, Math.PI * 1.72); g.stroke();
    for (const [v, t] of [[0, '0'], [5, '5'], [10, '10'], [15, '15'], [20, '20']]) { const a = Math.PI * 1.28 + (v / 20) * Math.PI * 0.44; label(g, t, cx + Math.cos(a) * (R - 2), cy + Math.sin(a) * (R - 2), DISPC.ink, 9, 'center'); }
    const a = Math.PI * 1.28 + (Math.min(20, shown) / 20) * Math.PI * 0.44; g.strokeStyle = DISPC.bl; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18 - 0); g.lineTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10)); g.stroke();
  });
  k.every(40, () => { const r = k.out(); if (r.length) grv = r[0]; shown += (grv - shown) * 0.35; vu.paint(); });
  return k.row(k.col(k.K(0), k.K(1), k.K(2)), k.sep(), k.col(vu, k.row(k.K(3, { big: true }), k.K(4, { big: true }))), k.sep(), k.col(k.T(6, 'Soft Clip'), k.K(5), k.K(7)));
};
// Channel EQ: curve display with the HP switch and the mid frequency readout, Low / Mid / High / Output
V[25] = (k) => {
  const disp = k.D(268, 92, (g, w, hh) => {
    grid(g, w, hh); const b = [new Biquad(), new Biquad(), new Biquad(), new Biquad()];
    b[0].highpass(SR, 80, 0.707); b[1].lowShelf(SR, 100, 0.7, k.get(1)); b[2].peaking(SR, k.get(3), 0.9, k.get(2)); if (k.get(4) >= 0) b[3].highShelf(SR, 6000, 0.7, k.get(4)); else b[3].lowpass(SR, 20000 * Math.pow(2, k.get(4) / 3), 0.707);
    const yd = (db) => hh / 2 - db / 15 * (hh / 2 - 6), pts = [];
    for (let x = 0; x <= w; x += 2) { const f = xl(x, w); let m = 1; for (let j = k.get(0) > 0.5 ? 0 : 1; j < 4; j++) m *= mag(b[j], f); pts.push([x, yd(20 * Math.log10(m + 1e-9) + k.get(5))]); }
    g.fillStyle = DISPC.grid; g.fillRect(0, Math.round(yd(0)), w, 1); lvPath(g, pts, DISPC.bl, hh, 1.8); lvRing(g, lx(k.get(3), w), yd(k.get(2)), 4.5);
  }, { onDown: () => ({ f: k.get(3), g: k.get(2) }), onMove: (x, y, dx, dy, s) => { k.set(3, Math.max(120, Math.min(7500, s.f * Math.pow(2, dx / 22)))); k.set(2, Math.max(-12, Math.min(12, s.g - dy * 0.25))); } });
  return k.col(disp, h('div', { class: 'lk-bar' }, k.T(0, 'HP 80 Hz'), k.N(3, { w: 76 })), k.row(k.K(1, { big: true }), k.K(2, { big: true }), k.K(4, { big: true }), k.sep(), k.K(5, { big: true })));
};
// Erosion: response display, mode buttons, Freq / Width / Amount
V[26] = (k) => k.row(k.col(bandDisp(k, 196, 66, 1, 2, { peak: true, wmin: 0.08, wmax: 10 }), k.CH(0, ['Noise', 'Wide Noise', 'Sine'])), k.sep(), k.row(k.K(1), k.K(2), k.K(3, { big: true })));
// Redux: sample-rate section (rate, jitter, pre filter) and bit section (bits, quantize, shape, DC shift), dry/wet
V[27] = (k) => k.row(k.sec('Sample Rate', k.row(k.K(0, { big: true }), k.col(k.K(1), k.T(2, 'Pre Filter')))), k.sep(),
  k.sec('Bit Reduction', k.row(k.col(k.T(4, 'Quantize'), k.K(3)), k.col(k.K(5), k.T(6, 'DC Shift')))), k.sep(), k.sec(null, k.K(7)));
// Vinyl Distortion: Tracing Model and Pinch, each with display + On / drive / freq / width, pinch type and stereo mode; crackle and drive
V[28] = (k) => {
  const part = (o, title, extra) => k.col(h('div', { class: 'lk-st' }, title), bandDisp(k, 176, 48, o + 2, o + 3, { peak: true, on: o, wmin: 0.1, wmax: 10 }),
    k.row(k.T(o, 'On', { w: 34 }), k.N(o + 1, { w: 46 }), k.LN('Freq', k.N(o + 2, { w: 64 })), k.LN('B', k.N(o + 3, { w: 44 }))), extra);
  return k.row(k.col(part(0, 'Tracing Model', null), part(4, 'Pinch', k.row(k.CH(9, ['Soft', 'Hard']), k.CH(8, ['Stereo', 'Mono'])))), k.sep(),
    k.col(h('div', { class: 'lk-st c' }, 'Crackle'), k.K(10, { n: 'Volume' }), k.K(11), k.K(12)));
};
// Drum Buss: drive + type, trim / comp, crunch / damp / transients, boom section with meters, output / dry-wet
V[29] = (k) => {
  let bm = -80, ov = -80;
  const met = k.D(66, 120, (g, w, hh) => {
    const y = (db) => 6 + (Math.min(0, Math.max(-60, db)) / -60) * (hh - 22);
    g.fillStyle = '#ffad32'; g.fillRect(8, y(bm), 18, hh - 16 - y(bm)); g.fillStyle = '#5fd08a'; g.fillRect(40, y(ov), 18, hh - 16 - y(ov));
    label(g, 'Bass', 4, hh - 3, DISPC.ink, 8); label(g, 'Out', 39, hh - 3, DISPC.ink, 8);
  });
  k.every(50, () => { const r = k.out(); if (r.length) { bm = r[0]; ov = r[1]; met.paint(); } });
  return k.row(k.col(k.K(0, { big: true }), k.CH(1, ['Soft', 'Medium', 'Hard'], { v: true }), k.TL('Trim', k.N(2, { w: 62 })), k.T(3, 'Comp')), k.sep(),
    k.col(k.K(4), k.K(5), k.K(6)), k.sep(), k.col(k.K(7), k.K(8), k.K(9)), k.sep(), k.col(met, k.K(10), k.TL('Dry/Wet', k.N(11, { w: 62 }))));
};
// Tuner: arc meter with the cents dot, note + frequency, reference; display options: strobe / histogram and Hz / cents readout
const NN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
V[30] = (k) => {
  const ui = { strobe: false, hz: true }; let hz = 0, cl = 0, ph = 0;
  const disp = k.D(300, 132, (g, w, hh) => {
    const ref = k.get(0), midi = hz > 0 ? 69 + 12 * Math.log2(hz / ref) : 0, n = Math.round(midi), cents = hz > 0 ? (midi - n) * 100 : 0;
    const cx = w / 2, cy = 112, R = 92;
    if (ui.strobe) { ph += cents * 0.02; for (let j = 0; j < 24; j++) { const x = ((j * 14 + ph * 10) % (w + 14) + w + 14) % (w + 14) - 7; g.fillStyle = hz > 0 && Math.abs(cents) < 3 ? '#5fd08a' : DISPC.or; g.fillRect(x, 26, 7, 40); } }
    else {
      g.strokeStyle = DISPC.or; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, Math.PI * 1.2, Math.PI * 1.8); g.stroke();
      label(g, '0', cx, 18, DISPC.ink, 10, 'center'); label(g, '-50', 18, 62, DISPC.ink, 10); label(g, '+50', w - 34, 62, DISPC.ink, 10);
      if (hz > 0) { const a = Math.PI * 1.5 + (Math.max(-50, Math.min(50, cents)) / 50) * Math.PI * 0.3; g.fillStyle = Math.abs(cents) < 3 ? '#5fd08a' : DISPC.or; g.beginPath(); g.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 9, 0, 7); g.fill(); }
    }
    label(g, hz > 0 ? NN[((n % 12) + 12) % 12] : '—', cx - 34, hh - 18, DISPC.or, 30, 'right');
    label(g, hz > 0 ? (ui.hz ? hz.toFixed(1) + ' Hz' : (cents >= 0 ? '+' : '') + cents.toFixed(1) + ' ct') : '', cx - 20, hh - 18, DISPC.or, 28);
  });
  k.every(80, () => { const r = k.out(); if (r.length) { hz = r[0]; cl = r[1]; } disp.paint(); });
  const opt = (label2, key) => { const b = h('button', { class: 'lv-btn lk-t' + (ui[key] ? ' on' : ''), onclick: () => { ui[key] = !ui[key]; b.classList.toggle('on', ui[key]); disp.paint(); } }, label2); return b; };
  return k.col(disp, k.row(opt('Strobe', 'strobe'), opt('Hz', 'hz'), h('span', { class: 'lk-grow' }), k.LN('Reference', k.N(0, { w: 64 }))));
};

// ================================================================================================ redesigned originals
// Utility: Input (phase L / R, channel, width, mono, bass mono + freq) | Output (gain, balance, mute, DC)
V[0] = (k) => k.row(
  k.sec('Input', k.row(k.T(2, 'ØL', { w: 34 }), k.T(4, 'ØR', { w: 34 })), k.S(5, { w: 76 }), k.K(6), k.T(3, 'Mono', { w: 72 }), k.row(k.T(7, 'Bass Mono'), k.N(8, { w: 56 }))), k.sep(),
  k.sec('Output', k.K(0, { n: 'Gain' }), k.K(1), k.row(k.T(9, 'Mute', { w: 40 }), k.T(10, 'DC', { w: 30 }))));
// Auto Filter: Freq / type / slope / Res | filter + LFO display, LFO amount / rate / wave / phase, envelope | Drive / Dry/Wet
V[1] = (k) => {
  let fc = 0, lfo = 0;
  const disp = k.D(214, 76, (g, w, hh) => {
    grid(g, w, hh); const b = new Biquad(), t = Math.round(k.get(0)), q = k.get(3) > 0.5 ? k.get(2) * 0.8 : k.get(2);
    const draw = (f, col, fill) => { if (t === 0) b.lowpass(SR, f, q); else if (t === 1) b.highpass(SR, f, q); else if (t === 2) b.bandpass(SR, f, q); else b.notch(SR, f, q);
      const pts = []; for (let x = 0; x <= w; x += 2) { let m = mag(b, xl(x, w)); if (k.get(3) > 0.5) m *= m; pts.push([x, hh - 6 - Math.min(2, m) / 2 * (hh - 12)]); } lvPath(g, pts, col, fill ? hh : null, 1.7); };
    if (fc > 20 && Math.abs(fc - k.get(1)) > k.get(1) * 0.01) draw(fc, DISPC.or, false);
    draw(k.get(1), DISPC.bl, true); lvRing(g, lx(k.get(1), w), hh * 0.3, 4.5);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, hh - 13, w, 13); label(g, 'LFO', 4, hh - 3, DISPC.ink, 9); label(g, 'Ø ' + Math.round(k.get(12)) + '°', 40, hh - 3, DISPC.or, 9);
  }, { onDown: () => ({ f: k.get(1), q: k.get(2) }), onMove: (x, y, dx, dy, s) => { k.set(1, Math.max(20, Math.min(20000, s.f * Math.pow(2, dx / 21)))); k.set(2, Math.max(0.3, Math.min(12, s.q * Math.pow(2, -dy / 30)))); } });
  k.every(60, () => { const r = k.out(); if (r.length) { fc = r[0]; lfo = r[2]; disp.paint(); } });
  return k.row(k.col(k.K(1, { n: 'Freq' }), k.S(0, { w: 76 }), k.CH(3, ['12', '24']), k.K(2, { n: 'Res' })), k.sep(),
    k.col(disp, k.row(k.K(7, { n: 'LFO Amt' }), k.K(8, { n: 'Rate' }), k.col(k.S(9, { w: 64 }), k.K(12, { n: 'Phase' })), k.K(4, { n: 'Envelope' }), k.K(5, { n: 'Attack' }), k.K(6, { n: 'Release' }))), k.sep(),
    k.col(k.K(10), k.K(11)));
};
// EQ Three: GainLow / GainMid / GainHi with L / M / H kill switches, FreqLow, 24 / 48, FreqHi
V[2] = (k) => k.col(k.row(k.col(k.K(0), k.T(6, 'L', { w: 30 })), k.col(k.K(1), k.T(7, 'M', { w: 30 })), k.col(k.K(2), k.T(8, 'H', { w: 30 }))),
  k.row(k.K(4), k.CH(9, ['24', '48'], { v: true }), k.K(5)));
// Saturator: curve display, Drive, type, soft clip | Tone, Output, Dry/Wet
V[3] = (k) => {
  const disp = k.D(150, 90, (g, w, hh) => {
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
  let o = [0, -80, -80], grs = 0;
  const disp = k.D(250, 112, (g, w, hh) => {
    const L0 = 34, W0 = 150, cx = (db) => L0 + ((db + 60) / 60) * W0, cy = (db) => hh - 14 - ((Math.max(-60, Math.min(12, db)) + 60) / 72) * (hh - 22);
    const thr = k.get(0), ratio = Math.max(1, k.get(1)), knee = Math.max(0.01, k.get(5)), mode = Math.round(k.get(7));
    const tf = (x) => { if (mode === 2) return x < thr ? thr + (x - thr) * ratio : x; const over = x - thr, slope = 1 / ratio - 1; let r = 0; if (2 * over > knee) r = slope * over; else if (2 * over > -knee) r = slope * (over + knee / 2) * (over + knee / 2) / (2 * knee); return x + r; };
    g.fillStyle = DISPC.grid; for (const v of [-48, -36, -24, -12, 0]) { g.fillRect(Math.round(cx(v)), 6, 1, hh - 20); g.fillRect(L0, Math.round(cy(v)), W0, 1); }
    const pts = []; for (let x = -60; x <= 0; x += 1) pts.push([cx(x), cy(tf(x))]); lvPath(g, pts, DISPC.bl, null, 1.8); lvRing(g, cx(thr), cy(tf(thr)), 4.5);
    const met = (x, db, col) => { const y = cy(db); g.fillStyle = '#1b1b1d'; g.fillRect(x, 6, 10, hh - 20); g.fillStyle = col; g.fillRect(x, y, 10, hh - 14 - y); };
    met(8, o[1], '#5fd08a'); g.fillStyle = '#1b1b1d'; g.fillRect(W0 + 46, 6, 10, hh - 20); g.fillStyle = '#ffad32'; g.fillRect(W0 + 46, 6, 10, Math.min(hh - 20, grs * 2)); met(W0 + 72, o[2], '#5fd08a');
    label(g, 'Thresh', L0 + 2, 12, DISPC.ink); label(g, 'GR', W0 + 44, hh - 3, DISPC.ink, 8); label(g, 'Out', W0 + 70, hh - 3, DISPC.ink, 8); label(g, thr.toFixed(1) + ' dB', L0 + 2, hh - 3, DISPC.bl, 9);
  }, { onDown: () => ({ t: k.get(0) }), onMove: (x, y, dx, dy, s) => k.set(0, Math.max(-60, Math.min(0, s.t - dy * 0.4))) });
  k.every(50, () => { const r = k.out(); if (r.length) { o = r; grs += (r[0] - grs) * 0.4; disp.paint(); } });
  return k.row(k.col(k.K(1), k.K(2), k.K(3), k.T(11, 'Auto')), k.sep(),
    k.col(disp, h('div', { class: 'lk-bar' }, k.LN('Knee', k.N(5, { w: 56 })), k.LN('Look', k.S(9, { w: 58 })), k.LN('Env', k.CH(10, ['Lin', 'Log'])))), k.sep(),
    k.col(k.T(8, 'Makeup', { w: 68 }), k.CH(7, ['Peak', 'RMS', 'Expand'], { v: true }), k.K(4), k.K(6)));
};
// Limiter: gain reduction display | Gain, Ceiling, Release
V[5] = (k) => {
  let o = [0, -80, -80];
  const disp = k.D(150, 90, (g, w, hh) => { const y = (db) => 6 + (Math.min(0, Math.max(-48, db)) / -48) * (hh - 18);
    for (const [x, db, col, t] of [[10, o[1], '#5fd08a', 'In'], [60, -o[0], '#ffad32', 'GR'], [110, o[2], '#5fd08a', 'Out']]) { g.fillStyle = '#1b1b1d'; g.fillRect(x, 6, 26, hh - 18); g.fillStyle = col; if (t === 'GR') g.fillRect(x, 6, 26, Math.min(hh - 18, o[0] * (hh - 18) / 24)); else g.fillRect(x, y(db), 26, hh - 12 - y(db)); label(g, t, x + 4, hh - 2, DISPC.ink, 8); }
    g.fillStyle = DISPC.or; g.fillRect(104, y(k.get(0)), 38, 2); });
  k.every(50, () => { const r = k.out(); if (r.length) { o = r; disp.paint(); } });
  return k.row(disp, k.sep(), k.col(k.K(2), k.K(0)), k.col(k.K(1)));
};
// Echo: Echo / Modulation / Character tabs. Echo: Left + Right (sync + note or time, link), tunnel display with filter, Input / Feedback, Reverb / Stereo, Output / Dry/Wet, Stereo / Ping Pong
V[6] = (k) => {
  const page = h('div', { class: 'lk-page' });
  const tunnel = k.D(200, 92, (g, w, hh) => {
    const fb = k.get(1), tl = k.get(0), tr = k.get(6);
    for (let r = 0; r < 9; r++) { const a = Math.pow(fb, r), rad = 18 + r * 9 * (0.6 + tl / 1500); if (rad > w / 2) break; g.strokeStyle = r % 2 ? DISPC.bl : DISPC.or; g.globalAlpha = Math.max(0.15, a); g.lineWidth = 1.5; g.beginPath(); g.arc(w / 2, hh - 4, rad * (r % 2 ? tr / Math.max(1, tl) : 1), Math.PI, 0); g.stroke(); }
    g.globalAlpha = 1; g.fillStyle = DISPC.or; for (let y = 6; y < hh - 4; y += 6) g.fillRect(w / 2 - 1, y, 2, 2);
  });
  const filt = k.D(200, 34, (g, w, hh) => { grid(g, w, hh); const hp = new Biquad(), lp = new Biquad(); hp.highpass(SR, k.get(5), 0.707); lp.lowpass(SR, k.get(4), 0.707);
    const pts = []; for (let x = 0; x <= w; x += 2) { const f = xl(x, w); pts.push([x, hh - 3 - Math.min(1.2, mag(hp, f) * mag(lp, f)) / 1.2 * (hh - 8)]); } lvPath(g, pts, DISPC.bl, hh, 1.5); lvRing(g, lx(k.get(5), w), hh / 2, 3.5); lvRing(g, lx(k.get(4), w), hh / 2, 3.5); },
    { onDown: (x) => ({ hp: Math.abs(x - lx(k.get(5), 200)) < Math.abs(x - lx(k.get(4), 200)), f: 0 }), onMove: (x, y, dx, dy, s) => { if (s.hp) k.set(5, Math.max(20, Math.min(2000, xl(x, 200)))); else k.set(4, Math.max(200, Math.min(20000, xl(x, 200)))); } });
  const side = (n, kt, kd) => k.col(h('div', { class: 'lk-st c' }, n), k.T(8, 'Sync', { w: 48 }), k.swap(8, () => k.S(kd, { w: 56 }), () => k.N(kt, { w: 56 })));
  const tabs = [
    () => k.row(k.col(k.row(side('Left', 0, 9), h('div', { class: 'lk-mid' }, k.T(7, '⇄', { cls: 'link', w: 24 })), side('Right', 6, 10)), k.row(k.K(13), k.K(1))), k.sep(),
      k.col(tunnel, filt, k.row(k.LN('HP', k.N(5, { w: 58 })), k.LN('LP', k.N(4, { w: 64 })))), k.sep(),
      k.col(k.row(k.K(11), k.K(12)), k.CH(3, ['Stereo', 'Ping Pong'], { v: true }), k.row(k.K(14), k.K(2)))),
    () => k.row(k.K(15, { n: 'Rate', big: true }), k.K(16, { n: 'Amount', big: true })),
    () => k.row(k.K(17, { n: 'Drive', big: true }), k.K(14), k.K(2)),
  ];
  const t = lvTabs([{ label: 'Echo' }, { label: 'Modulation' }, { label: 'Character' }], 0, (j) => page.replaceChildren(tabs[j]()), { cls: 'lk-tabs' });
  page.replaceChildren(tabs[0]());
  return k.col(t, page);
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
V[31] = (k) => {
  let sel = 2; const W = 300, H = 120, ctlBox = h('div', { class: 'lk-col' });
  const yd = (db) => H / 2 - db / 15 * (H / 2 - 8), dy = (y) => (H / 2 - y) / (H / 2 - 8) * 15;
  const disp = k.D(W, H, (g) => {
    grid(g, W, H); g.fillStyle = DISPC.grid; for (const v of [-12, -6, 0, 6, 12]) g.fillRect(0, Math.round(yd(v)), W, 1); for (const v of [12, 6, 0, -6, -12]) label(g, String(v), 3, yd(v) - 2, DISPC.ink, 8);
    const sc = k.get(40), st = []; for (let b = 0; b < 8; b++) if (k.get(b * 5) > 0.5) st.push(...eq8Stages(SR, Math.round(k.get(b * 5 + 1)), k.get(b * 5 + 2), k.get(b * 5 + 3) * sc, k.get(b * 5 + 4)));
    const pts = []; for (let x = 0; x <= W; x += 2) { let m = 1; const f = xl(x, W); for (const b of st) m *= mag(b, f); pts.push([x, yd(20 * Math.log10(m + 1e-9) + k.get(41))]); }
    lvPath(g, pts, DISPC.bl, H / 2, 1.8);
    for (let b = 0; b < 8; b++) { if (k.get(b * 5) < 0.5) continue; const t = Math.round(k.get(b * 5 + 1)), gy = t === 2 || t === 3 || t === 5 ? yd(k.get(b * 5 + 3) * sc) : H / 2; g.globalAlpha = b === sel ? 1 : 0.75; lvRing(g, lx(k.get(b * 5 + 2), W), gy, 6.5); label(g, String(b + 1), lx(k.get(b * 5 + 2), W), gy + 3, DISPC.or, 8, 'center'); g.globalAlpha = 1; }
  }, { onDown: (x, y) => { let best = sel, bd = 1e9; for (let b = 0; b < 8; b++) { if (k.get(b * 5) < 0.5) continue; const dd = Math.abs(lx(k.get(b * 5 + 2), W) - x) + Math.abs(yd(k.get(b * 5 + 3)) - y) * 0.5; if (dd < bd) { bd = dd; best = b; } } if (best !== sel) { sel = best; fillCtl(); } return { f: k.get(sel * 5 + 2), g: k.get(sel * 5 + 3) }; },
    onMove: (x, y, ddx, ddy, s) => { k.set(sel * 5 + 2, Math.max(10, Math.min(22000, s.f * Math.pow(2, ddx / (W / 10))))); k.set(sel * 5 + 3, Math.max(-15, Math.min(15, s.g - ddy * 15 / (H / 2 - 8)))); } });
  function fillCtl() { ctlBox.replaceChildren(h('div', { class: 'lk-st c' }, 'Band ' + (sel + 1)), k.K(sel * 5 + 2, { n: 'Freq' }), k.K(sel * 5 + 3, { n: 'Gain' }), k.K(sel * 5 + 4, { n: 'Q' })); disp.paint(); }
  fillCtl();
  const cells = h('div', { class: 'lk-eq8' }, ...Array.from({ length: 8 }, (_, b) => { const c = h('div', { class: 'lk-cell' }, k.S(b * 5 + 1, { w: 34, short: ['LC48', 'LC12', 'LS', 'Bell', 'Ntch', 'HS', 'HC12', 'HC48'] }), k.T(b * 5, String(b + 1), { w: 34 })); c.addEventListener('pointerdown', () => { if (sel !== b) { sel = b; fillCtl(); } }, true); return c; }));
  return k.row(ctlBox, k.sep(), k.col(disp, cells), k.sep(), k.col(k.TL('Scale', k.N(40, { w: 60 })), k.TL('Gain', k.N(41, { w: 60 }))));
};
// Spectrum: Block / Channel / Avg / Graph / Max / Scale X / Auto | spectrum display (L+R or one channel, bins or line, peak hold)
V[32] = (k) => {
  let sp = null, mx = null; const W = 300, H = 132;
  const disp = k.D(W, H, (g) => {
    const lin = Math.round(k.get(5)) === 0, auto = k.get(6) > 0.5; let lo = -120, hi = 0;
    if (sp && auto) { let a = -200, b = 0; for (const v of sp) { if (v > a) a = v; } hi = Math.min(0, Math.ceil(a / 6) * 6 + 6); lo = hi - 72; }
    const yd = (db) => 4 + (hi - Math.max(lo, Math.min(hi, db))) / (hi - lo) * (H - 18), N = sp ? sp.length : 256;
    g.fillStyle = DISPC.grid; for (let d = Math.ceil(lo / 12) * 12; d <= hi; d += 12) { g.fillRect(0, Math.round(yd(d)), W, 1); label(g, String(d), 3, yd(d) - 2, DISPC.ink, 8); }
    const st = Math.round(k.get(5)) === 2;
    if (st) for (let o = 1; o <= 9; o++) { const f = 32.703 * Math.pow(2, o - 1), x = Math.log(f / 20) / Math.log(1000) * W; g.fillRect(Math.round(x), 0, 1, H - 12); label(g, 'C' + o, x + 2, H - 2, DISPC.ink, 8); }
    else if (!lin) for (const f of [100, 1000, 10000]) { const x = Math.log(f / 20) / Math.log(1000) * W; g.fillRect(Math.round(x), 0, 1, H - 12); label(g, f >= 1000 ? f / 1000 + 'k' : String(f), x + 2, H - 2, DISPC.ink, 8); }
    else for (const f of [5000, 10000, 15000, 20000]) { const x = f / (SR / 2) * W; g.fillRect(Math.round(x), 0, 1, H - 12); label(g, f / 1000 + 'k', x + 2, H - 2, DISPC.ink, 8); }
    if (!sp) return;
    if (Math.round(k.get(3)) === 1) { g.fillStyle = 'rgba(79,195,240,.85)'; for (let b = 0; b < N; b++) { const x = b / N * W, y = yd(sp[b]); g.fillRect(x, y, Math.max(1, W / N - 0.5), H - 12 - y); } }
    else lvPath(g, Array.from(sp, (v, b) => [b / (N - 1) * W, yd(v)]), DISPC.bl, H - 12, 1.4);
    if (k.get(4) > 0.5 && mx) lvPath(g, Array.from(mx, (v, b) => [b / (N - 1) * W, yd(v)]), DISPC.or, null, 1);
  });
  k.every(60, () => { const r = k.out(); if (r.length) { sp = r; if (k.get(4) > 0.5) { mx = mx && mx.length === r.length ? mx.map((v, j) => Math.max(v - 0.15, r[j])) : r.slice(); } else mx = null; disp.paint(); } });
  return k.row(k.col(k.LN('Block', k.S(0, { w: 70 })), k.LN('Channel', k.CH(1, ['L', 'R', 'L+R'])), k.LN('Avg', k.N(2, { w: 50 })), k.LN('Graph', k.CH(3, ['Line', 'Bins'])), k.T(4, 'Max'), k.LN('Scale X', k.CH(5, ['Lin', 'Log', 'ST'])), k.T(6, 'Auto')), k.sep(), disp);
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
  const O = (j) => k.K(j, { col: ORK });
  return k.row(k.col(pic, k.CH(0, AMPN, { cls: 'spc' }), k.row(O(1), O(2), O(3), O(4), O(5))), k.sep(),
    k.col(k.TL('Output', k.T(7, 'Mono', { inv: true })), h('span', { class: 'lk-grow' }), O(6), O(8)));
};
// Cabinet: cabinet picture (speakers of the chosen model, the microphone ring at its position: tap / drag to move it) | microphone, position | Output Mono, Dry/Wet
V[34] = (k) => {
  const W = 200, H = 96, MX = [0.5, 0.78, 1.1];
  const pic = k.D(W, H, (g) => {
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
V[35] = (k) => k.row(k.col(bandDisp(k, 190, 72, 0, 1, { wmin: 0.5, wmax: 9 }), k.row(k.LN('Freq', k.N(0, { w: 70 })), k.LN('Width', k.N(1, { w: 50 })))), k.sep(),
  k.col(k.K(2, { big: true }), k.K(3)), k.sep(), k.col(k.K(4), k.K(5)));
// Pedal: OD / Distort / Fuzz, Gain, Output | Bass / Mid / Treble with the Mid frequency switch | Sub, Dry/Wet
V[36] = (k) => k.row(k.col(k.CH(0, ['OD', 'Distort', 'Fuzz'], { v: true }), k.K(2)), k.col(k.K(1, { big: true })), k.sep(),
  k.col(k.row(k.K(3), k.K(4), k.K(5)), k.TL('Mid Freq', k.CH(6, ['Low', 'Mid', 'High']))), k.sep(), k.col(k.T(7, 'Sub'), h('span', { class: 'lk-grow' }), k.K(8)));
// Dynamic Tube: tube curve (drag: x = Bias, y = Drive), tube A / B / C | Drive, Bias | Envelope, Attack, Release | Tone, Output, Dry/Wet
V[37] = (k) => {
  const disp = k.D(150, 86, (g, w, hh) => {
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
  return k.row(split, input, k.col(h('div', { class: 'lk-st c' }, ' '), disp), k.col(rdBox, vb), outs, k.sep(), k.col(k.K(31), k.K(30), k.K(29)));
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
    k.col(k.T(14, 'LFO'), k.row(k.K(15, { n: 'Amount' }), k.TL('Shape', k.S(23, { w: 66 }))), k.row(k.swap(24, () => k.K(25, { n: 'Rate' }), () => k.K(16, { n: 'Rate' })), k.CH(24, ['Hz', '♪'], { v: true, cls: 'sm' })),
      k.row(k.K(26, { n: 'Phase' }), k.K(27, { n: 'Offset' }))), k.sep(),
    k.col(k.T(17, 'Filter'), h('span', { class: 'lk-grow' }), k.K(18), k.K(19)), k.sep(), k.col(k.K(20), k.K(21), k.K(22)));
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
  const W = 250, H = 110;
  const bands = k.D(W, H, (g) => {
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
  const disp = k.D(206, 62, (g, w, hh) => {
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
  const xk = () => (st.x === 2 && k.get(0) > 0.5 ? 1 : st.x), W = 330, H = 140;
  const xy = k.D(W, H, (g) => {
    g.fillStyle = DISPC.grid; for (let j = 1; j < 10; j++) { g.fillRect(Math.round(j * W / 10), 0, 1, H); g.fillRect(0, Math.round(j * H / 10), W, 1); }
    const px = k.def.params[xk()], py = k.def.params[st.y]; lvRing(g, 8 + normOf(px, k.get(xk())) * (W - 16), H - 8 - normOf(py, k.get(st.y)) * (H - 16), 6);
  }, { onDown: () => ({}), onMove: (x, y) => { const a = xk(); k.set(a, valOf(k.def.params[a], (x - 8) / (W - 16))); k.set(st.y, valOf(k.def.params[st.y], (H - 8 - y) / (H - 16))); } });
  const axisBtns = (items, key) => { const bs = items.map(([j, t]) => h('button', { class: 'lv-btn lk-ax', onclick: () => { st[key] = j; paint(); xy.paint(); } }, t)); const paint = () => bs.forEach((b, n) => b.classList.toggle('on', items[n][0] === st[key])); paint(); return bs; };
  const ys = axisBtns([[3, 'Spray'], [4, 'Frequency'], [5, 'Pitch'], [6, 'Rand Pitch'], [7, 'Feedback'], [8, 'DryWet']], 'y');
  const left = k.col(...[3, 4, 5, 6, 7, 8].map((j, n) => k.row(k.N(j, { w: 58, fill: false }), ys[n])),
    k.CH(1, ['1', '2', '3', '4', '5', '6', '8', '16'], { cls: 'g4' }), k.row(k.T(0, 'Sync', { w: 44 }), k.N(2, { w: 62 })));
  return k.row(left, k.sep(), k.col(xy, h('div', { class: 'lk-axr' }, ...axisBtns([[2, 'Delay Time'], [3, 'Spray'], [4, 'Frequency'], [5, 'Pitch'], [6, 'Rand Pitch'], [7, 'Feedback']], 'x'))));
};
// Hybrid Reverb: Send, Predelay, Feedback | Reverb tab (IR picture with IR Decay / Size, Routing, Algorithm, Freeze, Mod, Diffusion; Convolution IR, Blend,
// Decay / Size / Damping) or EQ tab (Low Cut / High Cut curve with draggable rings; the tab's box = EQ on) | Stereo, Vintage, Bass Mono, Dry/Wet
V[44] = (k) => {
  const page = h('div', { class: 'lk-page' }), W = 440;
  const ir = k.D(W, 74, (g, w, hh) => {
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
  return k.row(k.col(k.K(0), k.K(1), k.TL('Feedback', k.N(2, { w: 56 }))), k.col(t, page), k.col(k.K(18), k.TL('Vintage', k.S(19, { w: 64 })), k.TL('Bass', k.T(20, 'Mono')), k.K(21)));
};
// Looper: state display (length, position), transport button (Record -> Overdub -> Play -> Overdub ...), Stop, Clear | Record length, Monitor |
// Speed, Reverse | Feedback, Volume
V[45] = (k) => {
  let o = [0, 0, 0, 0]; const ST = ['Stopped', 'Recording', 'Playing', 'Overdub'];
  const disp = k.D(176, 66, (g, w, hh) => {
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
    k.col(k.TL('Record', k.S(1, { w: 76 })), k.TL('Monitor', k.S(5, { w: 96 }))), k.sep(), k.col(k.K(2), k.T(3, 'Reverse')), k.col(k.K(4), k.K(7)));
};

// ================================================================================================ Live 12 set, part 3: spectral (engine: js/engine/fx5.js)
// scrolling sonogram (cyan on dark, newest column right); col(o) returns the 48 band levels in dB or null; ▶ pauses it like Live's display button
function sonogram(k, w, hh, col) {
  const off = document.createElement('canvas'); off.width = w; off.height = hh; const og = off.getContext('2d'); og.fillStyle = DISPC.bg; og.fillRect(0, 0, w, hh);
  let run = true;
  const c = k.D(w, hh, (g) => { g.drawImage(off, 0, 0, w, hh); });
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
    k.col(k.CH(9, ['None', 'Chorus', 'Wander', 'Granular'], { v: true }), k.K(10), k.TL('Pch.Mod', k.N(11, { w: 64, fill: false }))),
    disp, k.col(k.TL('Unison', k.S(15, { w: 50 })), k.K(16), k.K(17), k.K(18)));
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
  const disp = k.D(370, 92, (g, w, hh) => {
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
    const n = lv.length; if (!n) return; g.fillStyle = '#6b6b70'; for (let j = 0; j < n; j++) { const v = Math.min(1, lv[j] * 1.2); g.fillRect(j / n * w, hh - 2 - v * (hh - 8), Math.max(1, w / n - 0.5), v * (hh - 8)); }
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
        cards.push(h('div', { class: 'card lkcard lk-rcard' + (x.bypass ? ' off' : '') }, h('h4', {}, pw, h('span', {}, def.name), more), kv ? kv.el : null));
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
  const envs = k.sec('Envelopes', k.row(h('span', { class: 'lk-lb' }, '1'), k.K(31, { n: 'Attack' }), k.K(32, { n: 'Decay' }), k.K(33, { n: 'Sustain' }), k.K(34, { n: 'Release' })),
    h('div', { class: 'lk-envw' }, envD, envTabs), k.row(k.T(39, '⟳', { w: 22 }), k.K(35, { n: 'Attack' }), k.K(36, { n: 'Decay' }), k.K(37, { n: 'Sustain' }), k.K(38, { n: 'Release' })));
  const page = h('div', { class: 'lk-page' });
  const lfoD = k.D(170, 52, (g, w, hh) => { const wf = Math.round(k.get(40)), pts = []; for (let x = 0; x <= w; x++) { const t = x / w * 4, a = t - Math.floor(t); let v; switch (wf) { case 1: v = 1 - 4 * Math.abs(a - 0.5); break; case 2: v = 2 * a - 1; break; case 3: v = 1 - 2 * a; break; case 4: v = a < 0.5 ? 1 : -1; break; case 5: { const r = Math.sin(Math.floor(t) * 12.9898) * 43758.5; v = (r - Math.floor(r)) * 2 - 1; break; } case 6: v = Math.sin(t * 2.1) * 0.6 + Math.sin(t * 5.3) * 0.3; break; case 7: v = t < 1 ? 1 - 2 * a : -1; break; case 8: v = t < 1 ? 2 * Math.exp(-a * 5) - 1 : -1; break; default: v = Math.sin(2 * Math.PI * a); } pts.push([x, hh / 2 - v * k.get(47) * (hh / 2 - 6)]); } lvPath(g, pts, DISPC.bl, null, 1.6); });
  const tabs = [
    () => k.row(k.col(k.swapN(41, (m) => k.K([42, 43, 44, 45][m], { n: ['Rate', 'Ratio', 'Time', 'Rate'][m] })), k.K(47, { n: 'Amount' })), k.CH(41, ['Hz', '1:1', 'ms', '♪'], { cls: 'g2 sm' }),
      k.col(k.dk(k.row(waveSel(k, 40, DB), h('span', { class: 'lk-grow' }), k.T(46, 'R', { cls: 'lk-r', w: 22 })), lfoD), k.row(k.TL('Mod', k.S(48, { w: 64 })), k.N(49, { w: 60, fill: false })))),
    () => k.col(...[0, 1, 2].map((m) => k.row(k.S(59 + m * 3, { w: 76 }), h('span', { class: 'lk-lb' }, '→'), k.S(60 + m * 3, { w: 96 }), k.N(61 + m * 3, { w: 60, fill: false })))),
  ];
  const tb = lvTabs([{ label: 'LFO' }, { label: 'Mod' }], 0, (j) => page.replaceChildren(tabs[j]()), { cls: 'lk-tabs' }); page.replaceChildren(tabs[0]());
  const glob = k.row(k.col(k.TL('Mode', k.S(50, { w: 80 })), k.TL('Voices', k.S(51, { w: 80 })), k.TL('Drift', k.N(52, { w: 80 })), k.T(53, 'Legato', { w: 80 }), k.TL('Glide', k.N(54, { w: 80, fill: false }))), k.sep(),
    k.col(k.K(55), k.TL('Vel > Vol', k.N(56, { w: 80 })), k.TL('Transpose', k.N(57, { w: 80, fill: false })), k.TL('PB Range', k.N(58, { w: 80 }))));
  return k.row(osc, k.sep(), filt, k.sep(), envs, k.sep(), k.col(tb, page), k.sep(), glob);
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
    const o = st.sel, b = o * 16, W = 210, H = 76, X0 = 8;
    const env = k.D(W, H, (g, w, hh) => {
      const db = (x) => hh - 6 - Math.max(0, (k.get(x) + 60) / 60) * (hh - 12), a = Math.sqrt(k.get(b + 10)), d = Math.sqrt(k.get(b + 11)), r = Math.sqrt(k.get(b + 13)), hold = Math.max(8, (a + d + r) * 0.4), K = (w - 2 * X0) / (a + d + hold + r + 1e-9);
      const pts = [[X0, db(b + 14)], [X0 + a * K, db(b + 15)], [X0 + (a + d) * K, db(b + 12)], [X0 + (a + d + hold) * K, db(b + 12)], [X0 + (a + d + hold + r) * K, hh - 6]];
      lvPath(g, pts, '#f08a24', hh, 1.6); g.strokeStyle = '#f08a24'; g.lineWidth = 1.3; for (const n of [0, 1, 2, 4]) g.strokeRect(pts[n][0] - 3, pts[n][1] - 3, 6, 6);
    }, { onDown: (x) => ({ which: x < W * 0.3 ? b + 15 : b + 12, v: k.get(x < W * 0.3 ? b + 15 : b + 12) }), onMove: (x, y, dx, dy, s) => k.set(s.which, Math.max(-60, Math.min(0, s.v - dy * 0.4))) });
    const T = (n, j, o2 = {}) => k.TL(n, k.NT(j, { w: o2.w || 58, cls: 'or' }));
    right.replaceChildren(k.dk(env, h('div', { class: 'lk-opeh', style: `--opc:${OPC[o]}` }, h('i', {}), 'Envelope ' + 'ABCD'[o]),
      k.row(T('Attack', b + 10), T('Decay', b + 11), T('Sustain', b + 12)), k.row(T('Initial', b + 14), T('Peak', b + 15), T('Release', b + 13)),
      k.row(k.TL('Loop', k.S(64 + o, { w: 70, cls: 'dk or' })), k.TL('Wave', k.S(b + 7, { w: 70, cls: 'dk or' }))), k.row(T('Feedback', b + 8), T('Vel > Lvl', b + 9))));
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
  return k.row(h('div', { class: 'lk-ops' }, ...rows), right, k.sep(), glob, k.sep(), g2);
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
  return k.row(h('div', { class: 'lk-ancol' }, osc(0), noise, osc(1)), disp, h('div', { class: 'lk-ancol' }, fil(0), fil(1), k.row(amp(0), amp(1))), h('div', { class: 'lk-ancol' }, lfo(0), lfo(1), glob));
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
  return k.row(osc, k.sep(), lfo, k.sep(), mods, k.sep(), glob);
};
export function instKitView(i, t, every) {
  const def = INSTRUMENTS[t.inst.type]; if (!VI[t.inst.type]) return null;
  const d = { id: 'in' + t.id, type: t.inst.type, params: new Proxy({}, { get: (_, kk) => t.inst.params[kk] ?? (def.params[kk] ? def.params[kk].def : undefined) }) };
  const ctx = { i, di: -1, d, def, every, setParam: (kk, v) => P.setInstParam(i, +kk, v),
    autoFn: (kk) => (rect) => offerAutomation(rect, { kind: 5, strip: P.stripOf(i), param: +kk, def: def.params[kk] }, `${t.name} • ${def.params[kk].n}`) };
  const k = kit(ctx), el = VI[t.inst.type](k); el.classList.add('lk', 'lk-inst'); return { el, draw: k.redraw };
}

export const KIT = V;
export function kitView(ctx) { if (!V[ctx.d.type]) return null;   // no Live 12 panel yet: the card falls back to the automatic knob layout
  const k = kit(ctx); const el = V[ctx.d.type](k); el.classList.add('lk'); return { el, draw: k.redraw }; }
