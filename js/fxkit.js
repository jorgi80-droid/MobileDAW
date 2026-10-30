// Live 12 device panels for the effects of js/engine/fx3.js (defs.js: kit: true). Every control is bound to a real engine parameter;
// the layout follows the owner's reference images of Live 12 (sections side by side, label above / value below each knob, orange toggles,
// cyan value boxes, dark displays with a cyan curve and hollow orange rings that can be dragged).
import { h, knob } from './ui.js';
import { C } from './theme.js';
import { fmtParam } from './defs.js';
import { lvNum, lvTog, lvChoice, lvSel, lvDisp, lvDrag, lvRing, lvPath, lvTabs, DISPC } from './liveui.js';
import { eq8Stages } from './engine/fx3.js';
import { offerAutomation } from './automate.js';
import { Biquad } from './engine/dsp.js';
import { eng } from './engine.js';
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
  const set = (k, v) => { P.setDeviceParam(i, di, k, v); redraw(); for (const c of ctls) if (c.update && c._k !== k) c.update(); };
  const auto = (k) => (rect) => offerAutomation(rect, { kind: 4, strip: P.stripOf(i), devId: d.id, param: k, def: def.params[k] }, `${def.name} ${def.params[k].n}`);
  const reg = (el, k) => { el._k = k; ctls.push(el); return el; };
  const lbl = (k, o) => (o && o.n != null ? o.n : def.params[k].n.replace(/^(L\+R|L|R) /, ''));
  const K = (k, o = {}) => { const el = knob({ ...def.params[k], n: lbl(k, o) }, () => get(k), (v) => set(k, v), fmtParam, C('#7ac5ff'), auto(k)); el.classList.add('lk-k'); if (o.big) el.classList.add('big'); return reg(el, k); };
  const T = (k, text, o = {}) => reg(lvTog(text, () => get(k) > 0.5, (b) => set(k, b ? 1 : 0), { cls: 'lk-t ' + (o.cls || ''), w: o.w }), k);
  const CH = (k, labels, o = {}) => { const p = def.params[k]; return reg(lvChoice(labels.map((l) => ({ label: l })), () => Math.round(get(k) - p.min), (j) => set(k, j + p.min), { cls: 'lk-ch ' + (o.v ? 'v ' : '') + (o.cls || '') }), k); };
  const S = (k, o = {}) => { const p = def.params[k], items = p.items || Array.from({ length: Math.round(p.max - p.min) + 1 }, (_, j) => fmtParam(p, p.min + j)); return reg(lvSel(() => items.map((l, j) => ({ label: l, value: j + p.min })), () => Math.round(get(k)), (v) => set(k, v), { w: o.w || 76, cls: 'lk-s', show: o.short ? (v) => o.short[Math.round(v - p.min)] : null }), k); };
  const N = (k, o = {}) => reg(lvNum(def.params[k], () => get(k), (v) => set(k, v), fmtParam, { fill: o.fill !== false, w: o.w || 64, onLong: auto(k), label: def.params[k].n, cls: 'lk-n' }), k);
  const LN = (text, el) => h('div', { class: 'lk-ln' }, h('span', {}, text), el);           // label left, control right (Live rows like "Freq [5.08 kHz]")
  const TL = (text, ...kids) => h('div', { class: 'lk-tl' }, h('span', { class: 'lk-lb' }, text), ...kids);   // title above a control
  const D = (w, hh, draw, drag) => { const c = lvDisp(w, hh, (g) => draw(g, w, hh)); c.classList.add('lk-d'); draws.push(() => c.paint()); if (drag) lvDrag(c, drag); return c; };
  const sec = (title, ...kids) => h('div', { class: 'lk-sec' }, title ? h('div', { class: 'lk-st' }, title) : null, ...kids.filter(Boolean));
  const row = (...kids) => h('div', { class: 'lk-row' }, ...kids.filter(Boolean));
  const col = (...kids) => h('div', { class: 'lk-col' }, ...kids.filter(Boolean));
  const sep = () => h('div', { class: 'lk-sep' });
  const every = (ms, fn) => ctx.every(ms, fn);
  const out = () => { const o = eng.devOut(i, di); return Array.isArray(o) ? o : o ? Array.from(o) : []; };
  // a box whose content follows a parameter (Live: Sync on shows the 16th grid, off shows the time knob)
  const swap = (k, on, off) => { const box = h('div', { class: 'lk-swap' }); const fill = () => box.replaceChildren(get(k) > 0.5 ? on() : off()); fill(); draws.push(() => { const want = get(k) > 0.5; if (box._on !== want) { box._on = want; fill(); } }); box._on = get(k) > 0.5; return box; };
  return { d, get, set, K, T, CH, S, N, LN, TL, D, sec, row, col, sep, every, out, swap, redraw };
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

export const KIT = V;
export function kitView(ctx) { if (!V[ctx.d.type]) return null;   // no Live 12 panel yet: the card falls back to the automatic knob layout
  const k = kit(ctx); const el = V[ctx.d.type](k); el.classList.add('lk'); return { el, draw: k.redraw }; }
