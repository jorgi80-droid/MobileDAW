// Moisture (instrument 37) panel: a plug-in window of its own (not the Live device look), laid out like a modern wavetable synth: a top
// bar (logo, pages, preset, master), the sound sources in one row (SUB, OSC A, OSC B, NOISE, FILTER) and the modulators under them
// (MACROS, ENV 1-3, LFO 1-8, VOICING); pages FX, MATRIX, GLOBAL. MobileDAW's own drawing (no third-party artwork). Opens only in a
// floating window (def.floatOnly, as MiniMeters). Controls bind to the instrument's parameters through the device kit (k.get / k.set /
// k.auto: long press = automation), values shown in the status line while touched.
import { h, menu } from './ui.js';
import { M2, M2_TABLES, M2_WARPS, M2_FILTERS, M2_DIST, M2_SUB, M2_LFO_SHAPES, M2_SOURCES, M2_DESTS, m2Bank, m2Text } from './moistdefs.js';
import { m2Frames } from './flmpanels.js';
import { fmtParam } from './defs.js';
import * as P from './project.js';
import { eng } from './engine.js';
const CUST = new Map();
function customFrames(id) {   // a loaded wavetable (sample id) as 24 frames x 129 points for the display
  if (CUST.has(id)) return CUST.get(id);
  const b = eng.sampleBuffers && eng.sampleBuffers(id); if (!b || !b.l || b.l.length < 2048) return null;
  const F = Math.floor(b.l.length / 2048), n = Math.min(24, F), out = [];
  for (let q = 0; q < n; q++) { const f = n === 1 ? 0 : Math.round(q * (F - 1) / (n - 1)), pts = []; let pk = 1e-9; for (let i = 0; i <= 128; i++) { const y = b.l[f * 2048 + Math.min(2047, i * 16)]; pts.push(y); pk = Math.max(pk, Math.abs(y)); } out.push(pts.map((y) => y / pk)); }
  CUST.set(id, out); return out;
}

const C01 = (v) => Math.min(1, Math.max(0, v));
const PAGE = new Map(), SEL = new Map();
const AC = '#38c8ff', AC2 = '#7be2c8', OR = '#ffb347', INK = '#cfd8e3', DIM = '#7d8a99';

export function moistureView(k) {
  const key = k.d.id, def = k.def;
  const status = h('span', { class: 'm2x-status' }, ''), say = (j) => { const p = def.params[j]; status.textContent = p ? p.n + ': ' + fmtParam(p, k.get(j)) : ''; };
  const regDraw = (fn) => { const el = { update: fn, _k: -2 }; k.reg(el, -2); return fn; };

  // ---- controls
  function knob(j, label, o = {}) {
    const S = 34, r = 13, NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 34 34'); svg.setAttribute('class', 'm2x-kn');
    const mk = (t, a) => { const e = document.createElementNS(NS, t); for (const [x, y] of Object.entries(a)) e.setAttribute(x, y); svg.append(e); return e; };
    const arcP = (a0, a1) => { const p = (a) => [S / 2 + r * Math.cos(a), S / 2 + r * Math.sin(a)], [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`; };
    const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
    mk('circle', { cx: 17, cy: 17, r: 10.5, fill: '#2e3640', stroke: '#11151a', 'stroke-width': 1.5 });
    mk('path', { d: arcP(A0, A1), fill: 'none', stroke: '#11151a', 'stroke-width': 3, 'stroke-linecap': 'round' });
    const val = mk('path', { d: '', fill: 'none', stroke: o.col || AC, 'stroke-width': 3, 'stroke-linecap': 'round' }), ptr = mk('line', { x1: 17, y1: 17, x2: 17, y2: 8, stroke: '#e8eef5', 'stroke-width': 2, 'stroke-linecap': 'round' });
    const bip = o.bip, draw = () => { const v = C01(k.get(j)), a = A0 + (A1 - A0) * v, z = bip ? (A0 + A1) / 2 : A0;
      val.setAttribute('d', Math.abs(a - z) < 0.02 ? '' : arcP(Math.min(a, z), Math.max(a, z)));
      ptr.setAttribute('x2', 17 + 8 * Math.cos(a)); ptr.setAttribute('y2', 17 + 8 * Math.sin(a)); };
    const root = h('div', { class: 'm2x-k' + (o.big ? ' big' : '') }, svg, h('span', { class: 'm2x-kl' }, label));
    drag(svg, j, 0.005, () => { draw(); say(j); });
    root.update = draw; draw(); return k.reg(root, j);
  }
  function drag(el, j, sens, after, step) {
    let st = null, t0 = 0, lp = 0;
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); st = { y: e.clientY, v: C01(k.get(j)), moved: false }; say(j); t0 = Date.now();
      clearTimeout(lp); lp = setTimeout(() => { if (st && !st.moved) { const fn = k.auto(j); if (fn) fn(el.getBoundingClientRect()); st = null; } }, 600); e.preventDefault(); });
    el.addEventListener('pointermove', (e) => { if (!st) return; const dy = st.y - e.clientY; if (Math.abs(dy) > 2) st.moved = true; if (!st.moved) return;
      let v = C01(st.v + dy * sens * (e.shiftKey ? 0.2 : 1)); if (step) v = Math.round(v / step) * step; k.set(j, v); after(); });
    const end = () => { clearTimeout(lp); st = null; }; el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => { k.set(j, def.params[j].def); after(); });
    void t0;
  }
  function numBox(j, label, o = {}) {   // label + value, vertical drag (Oct / Semi / Unison ...)
    const v = h('span', { class: 'm2x-nv' }), p = def.params[j], n = o.n || 0;
    const draw = () => { const x = k.get(j); v.textContent = o.txt ? o.txt(x) : p.fmt === 'srm' || p.fmt === 'list' || p.fmt === 'onoff' ? fmtParam(p, x) : String(Math.round(x)); };
    const root = h('div', { class: 'm2x-nb' + (o.cls ? ' ' + o.cls : '') }, label ? h('span', { class: 'm2x-nl' }, label) : null, v);
    if (p.min === 0 && p.max === 1) drag(root, j, n ? 1 / (n - 1) / 14 : 0.004, () => { draw(); say(j); }, n ? 1 / (n - 1) : 0);
    else { let st = null; root.addEventListener('pointerdown', (e) => { root.setPointerCapture(e.pointerId); st = { y: e.clientY, v: k.get(j) }; say(j); });
      root.addEventListener('pointermove', (e) => { if (!st) return; const nv = Math.max(p.min, Math.min(p.max, Math.round(st.v + (st.y - e.clientY) / 10))); if (nv !== k.get(j)) { k.set(j, nv); draw(); say(j); } });
      root.addEventListener('pointerup', () => { st = null; }); }
    root.update = draw; draw(); return k.reg(root, j);
  }
  function led(j, label, o = {}) {   // on / off square with a caption
    const b = h('button', { class: 'm2x-led' + (o.cls ? ' ' + o.cls : '') }, h('i'), label ? h('span', {}, label) : null);
    const draw = () => b.classList.toggle('on', k.get(j) > 0.5); b.onclick = () => { k.set(j, k.get(j) > 0.5 ? 0 : 1); draw(); say(j); };
    b.update = draw; draw(); return k.reg(b, j);
  }
  function pick(j, items, n, o = {}) {   // dropdown over a list index (n > 0: a normalized Serum list; 0: an integer list parameter)
    const b = h('button', { class: 'm2x-dd' + (o.cls ? ' ' + o.cls : '') });
    const cur = () => (n ? Math.round(C01(k.get(j)) * (n - 1)) : Math.round(k.get(j)));
    const draw = () => { b.textContent = (o.txt ? o.txt() : items[cur()] || (n ? m2Text(j, k.get(j)) : '')) + ' ▾'; };
    b.onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(items.map((t, i) => ({ label: t, check: i === cur(), fn: () => { k.set(j, n ? (n > 1 ? i / (n - 1) : 0) : i); draw(); say(j); } })), r.left, r.bottom + 2); };
    b.update = draw; draw(); return k.reg(b, j);
  }
  // canvas display that follows its box and the device redraws
  function disp(draw, o = {}) {
    const c = h('canvas', { class: 'm2x-cv' }), box = h('div', { class: 'm2x-disp' + (o.cls ? ' ' + o.cls : '') }, c); let w = 0, hh = 0, sc = 1;
    const paint = () => { if (!w) return; const g = c.getContext('2d'); g.setTransform(sc, 0, 0, sc, 0, 0); g.clearRect(0, 0, w, hh); const gr = g.createLinearGradient(0, 0, 0, hh); gr.addColorStop(0, '#131a22'); gr.addColorStop(1, '#0d1217'); g.fillStyle = gr; g.fillRect(0, 0, w, hh);
      g.strokeStyle = 'rgba(120,150,180,0.08)'; g.lineWidth = 1; for (let x = 0; x < w; x += 24) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, hh); g.stroke(); } for (let y = 0; y < hh; y += 24) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke(); }
      k.inDraw(() => draw(g, w, hh)); };
    const size = () => { const W = box.clientWidth, H = box.clientHeight; if (W < 8 || H < 8) return; const s = Math.min(3, window.devicePixelRatio || 1); if (W === w && H === hh && s === sc) return; w = W; hh = H; sc = s; c.width = Math.round(w * sc); c.height = Math.round(hh * sc); c.style.width = w + 'px'; c.style.height = hh + 'px'; paint(); };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(size).observe(box); else requestAnimationFrame(size);
    regDraw(paint); box.paint = paint;
    if (o.drag) { let st = null; c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); st = { x: e.clientX, y: e.clientY, s: o.drag.down() }; });
      c.addEventListener('pointermove', (e) => { if (st) { o.drag.move(e.clientX - st.x, e.clientY - st.y, st.s); paint(); } }); c.addEventListener('pointerup', () => { st = null; }); }
    return box;
  }
  const txt = (g, s, x, y, col = DIM, sz = 9, al = 'left') => { g.fillStyle = col; g.font = `600 ${sz}px system-ui,sans-serif`; g.textAlign = al; g.fillText(s, x, y); };
  const panel = (title, onJ, body, o = {}) => h('div', { class: 'm2x-p' + (o.cls ? ' ' + o.cls : '') }, h('div', { class: 'm2x-ph' }, onJ != null ? led(onJ, '') : null, h('b', {}, title), ...(o.head || [])), body);
  const row = (...a) => h('div', { class: 'm2x-row' }, ...a.filter(Boolean)), col = (...a) => h('div', { class: 'm2x-col' }, ...a.filter(Boolean));

  // ---- displays
  const wave = (tb, pos, warp, wm, on, smp) => disp((g, w, hh) => {
    const T = Math.round(k.d.params[tb] ?? 0), sid = Math.round(k.d.params[smp] ?? -1), fr = (sid >= 0 && customFrames(sid)) || m2Frames(T), F = fr.length, p = C01(k.get(pos)), cur = Math.round(p * (F - 1)), lit = k.get(on) > 0.5;
    const depth = hh * 0.35, dx = w * 0.16, ww = w - dx - 14, amp = (hh - depth - 22) * 0.42, by = hh - 12 - amp;
    for (let f = 0; f < F; f++) { const z = f / (F - 1 || 1), ox = 7 + dx * (1 - z), oy = by - depth * (1 - z), isC = f === cur, pts = fr[f];
      if (isC) { g.fillStyle = lit ? 'rgba(56,200,255,0.18)' : 'rgba(150,150,150,0.1)'; g.beginPath(); g.moveTo(ox, oy); pts.forEach((y, i) => g.lineTo(ox + ww * i / (pts.length - 1), oy - y * amp)); g.lineTo(ox + ww, oy); g.closePath(); g.fill(); }
      g.strokeStyle = isC ? (lit ? AC : '#8a96a3') : `rgba(123,226,200,${lit ? 0.07 + 0.16 * z : 0.05})`; g.lineWidth = isC ? 2 : 1; g.beginPath();
      pts.forEach((y, i) => { const X = ox + ww * i / (pts.length - 1), Y = oy - y * amp * (isC ? 1 : 0.85); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke(); }
    const w2 = sid >= 0 ? (((P.state.tracks[k.ctx.i] || {}).inst || {}).wt || [])[tb - 300]?.name?.replace(/\.wav$/i, '') || 'Custom' : M2_TABLES[T] || ''; txt(g, w2, w / 2, hh - 4, INK, 9, 'center'); void warp; void wm;
  }, { drag: { down: () => k.get(pos), move: (dx, dy, s) => { k.set(pos, C01(s - dy / 140)); say(pos); } } });
  const filt = () => disp((g, w, hh) => {
    const on = k.get(216) > 0.5, ti = Math.round(C01(k.get(44)) * 95), T = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 1], [0, 2], [0, 3], [0, 4], [1, 1], [1, 2], [1, 3], [1, 4], [2, 2], [2, 4], [3, 2], [3, 4], [4, 2], [4, 4]][ti] || [0, 2];
    const fc = 8 * Math.pow(2756.25, C01(k.get(45))), Q = 1 / (2 - 1.97 * C01(k.get(46))), top = 14, bot = hh - 8, X = (x) => 20 * Math.pow(1000, x / w);
    g.beginPath(); for (let x = 0; x <= w; x += 2) { const r = X(x) / fc, lp2 = 1 / Math.sqrt((1 - r * r) ** 2 + (r / Q) ** 2), hp2 = r * r * lp2, bp = (r / Q) * lp2, lp1 = 1 / Math.sqrt(1 + r * r), hp1 = r * lp1, n2 = Math.floor(T[1] / 2), odd = T[1] % 2;
      const m = T[0] === 0 ? (odd ? lp1 : 1) * Math.pow(lp2, n2) : T[0] === 1 ? (odd ? hp1 : 1) * Math.pow(hp2, n2) : T[0] === 2 ? Math.pow(bp, T[1] / 2) : T[0] === 3 ? 1 + 2 * bp : Math.abs(1 - bp);
      const y = Math.max(top - 4, Math.min(bot, top + (bot - top) * (1 - (20 * Math.log10(Math.max(1e-5, m)) + 36) / 54))); x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.lineTo(w, bot); g.lineTo(0, bot); g.closePath(); g.fillStyle = on ? 'rgba(56,200,255,0.16)' : 'rgba(150,150,150,0.08)'; g.fill(); g.strokeStyle = on ? AC : '#7a8592'; g.lineWidth = 2; g.stroke();
    txt(g, M2_FILTERS[ti] || 'Low 12', 6, 11, INK, 9); txt(g, m2Text(45, k.get(45)), w - 6, 11, AC, 9, 'right');
  }, { drag: { down: () => [k.get(45), k.get(46)], move: (dx, dy, s) => { k.set(45, C01(s[0] + dx / 220)); k.set(46, C01(s[1] - dy / 160)); say(45); } } });
  const envD = (sel) => disp((g, w, hh) => {
    const o = [[35, 36, 37, 38, 39], [51, 52, 53, 54, 55], [56, 57, 58, 59, 60]][sel()], T = (j) => 32 * Math.pow(C01(k.get(j)), 5), sq = (t) => Math.sqrt(t + 1e-4);
    const A = T(o[0]), Hd = T(o[1]), D = T(o[2]), S = C01(k.get(o[3])), R = T(o[4]), tot = sq(A) + sq(Hd) + sq(D) + 0.7 + sq(R), kx = (w - 16) / tot, top = 10, bot = hh - 8, Y = (v) => bot - (bot - top) * v;
    let x = 8; const pts = [[x, Y(0)]]; x += sq(A) * kx; pts.push([x, Y(1)]); x += sq(Hd) * kx; pts.push([x, Y(1)]); x += sq(D) * kx; pts.push([x, Y(S)]); x += 0.7 * kx; pts.push([x, Y(S)]); x += sq(R) * kx; pts.push([x, Y(0)]);
    g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); g.lineTo(pts[pts.length - 1][0], bot); g.closePath(); g.fillStyle = 'rgba(56,200,255,0.16)'; g.fill();
    g.strokeStyle = AC; g.lineWidth = 2; g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); g.stroke();
    g.fillStyle = '#e8eef5'; for (const [a, b] of pts.slice(1, -1)) { g.beginPath(); g.arc(a, b, 3, 0, 7); g.fill(); }
  });
  const lfoD = (sel) => disp((g, w, hh) => {
    const j = sel(), shp = Math.round(k.get(M2.LFO_SHAPE + j)), top = 10, bot = hh - 8, mid = (top + bot) / 2, a = (bot - top) / 2; let sv = 0.4;
    g.strokeStyle = AC; g.lineWidth = 2; g.beginPath();
    for (let x = 0; x <= w - 12; x++) { const ph = (x / (w - 12) * 2) % 1; let y;
      if (shp === 0) y = Math.sin(ph * 2 * Math.PI); else if (shp === 1) y = ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4; else if (shp === 2) y = 2 * ph - 1; else if (shp === 3) y = 1 - 2 * ph; else if (shp === 4) y = ph < 0.5 ? 1 : -1; else { if (x % Math.max(1, Math.round((w - 12) / 8)) === 0) sv = ((Math.sin(x * 12.9898) * 43758.5) % 1) * 2 - 1; y = sv; }
      const X = 6 + x, Y = mid - y * a; x ? g.lineTo(X, Y) : g.moveTo(X, Y); }
    g.stroke(); txt(g, M2_LFO_SHAPES[shp], 6, 11, INK, 9);
  });
  const tabsRow = (id, n, names, onSel) => { const sid = key + ':' + id, get = () => SEL.get(sid) || 0;
    const bs = Array.from({ length: n }, (_, i) => h('button', { class: 'm2x-tab' + (i === get() ? ' on' : ''), onclick: () => { SEL.set(sid, i); bs.forEach((b, q) => b.classList.toggle('on', q === i)); onSel(); } }, names[i]));
    return { el: h('div', { class: 'm2x-tabs' }, ...bs), get }; };

  // ---- OSC page
  function oscPanel(t, on, tb, smp, vol, pan, oct, semi, fine, crs, uni, det, bl, warp, pos, rnd, ph, wm) {
    return panel(t, on, col(
      row(pick(tb, M2_TABLES, 0, { cls: 'wide', txt: () => (k.get(smp) >= 0 ? 'Custom table' : M2_TABLES[Math.round(k.get(tb))]) })),
      row(numBox(oct, 'OCT'), numBox(semi, 'SEM'), numBox(fine, 'FIN'), numBox(crs, 'CRS')),
      wave(tb, pos, warp, wm, on, smp),
      row(numBox(pos, 'WT', { txt: (v) => String(1 + Math.round(C01(v) * 255)) }), numBox(ph, 'φ'), numBox(rnd, 'RAND')),
      row(numBox(uni, 'UNI', { n: 17 }), knob(det, 'DETUNE'), knob(bl, 'BLEND'), knob(pan, 'PAN', { bip: true }), knob(vol, 'LEVEL')),
      row(pick(wm, M2_WARPS, M2_WARPS.length, { cls: 'warp' }), knob(warp, 'WARP', { col: OR }), knob(pos, 'WT POS'))), { cls: 'osc' });
  }
  const oscPage = () => {
    // SUB: its shape (two cycles, height = level); NOISE: a noise trace (brightness = pitch, height = level) — they fill the narrow columns
    const subD = disp((g, w, hh) => { const on = k.get(215) > 0.5, sh = Math.round(k.get(170)), lv = C01(k.get(33)), mid = hh / 2, amp = (hh / 2 - 6) * (0.25 + 0.75 * lv);
      const f = (x) => { const p = x - Math.floor(x); return sh === 0 ? Math.sin(2 * Math.PI * p) : sh === 1 ? Math.max(-1, Math.min(1, 1.6 * Math.sin(2 * Math.PI * p))) : sh === 2 ? 1 - 4 * Math.abs(p - 0.5) : sh === 3 ? 2 * p - 1 : sh === 4 ? (p < 0.5 ? 1 : -1) : (p < 0.2 ? 1 : -1); };
      g.beginPath(); for (let x = 0; x <= w; x++) { const y = mid - f(2 * x / w) * amp; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.strokeStyle = on ? AC : '#4a5664'; g.lineWidth = 1.6; g.stroke(); }, { cls: 'side' });
    const noiseD = disp((g, w, hh) => { const on = k.get(214) > 0.5, lv = C01(k.get(27)), pt = C01(k.get(28)), mid = hh / 2, amp = (hh / 2 - 6) * (0.25 + 0.75 * lv); let s0 = 9781, y = 0;
      const sm = 0.15 + 0.8 * (1 - pt); g.beginPath(); for (let x = 0; x <= w; x++) { s0 = (Math.imul(s0, 1664525) + 1013904223) >>> 0; y = y * sm + (s0 / 4294967296 * 2 - 1) * (1 - sm) * 2.2; const Y = mid - Math.max(-1, Math.min(1, y)) * amp; x ? g.lineTo(x, Y) : g.moveTo(x, Y); }
      g.strokeStyle = on ? AC2 : '#4a5664'; g.lineWidth = 1; g.stroke(); }, { cls: 'side' });
    const sub = panel('SUB', 215, col(row(pick(170, M2_SUB, 6, { cls: 'wide' })), row(numBox(171, 'OCT')), subD, row(knob(34, 'PAN', { bip: true }), knob(33, 'LEVEL'))), { cls: 'sm' });
    const noise = panel('NOISE', 214, col(noiseD, row(knob(29, 'FINE', { bip: true }), knob(30, 'PAN', { bip: true })), row(knob(28, 'PITCH'), knob(27, 'LEVEL'))), { cls: 'sm' });
    const fil = panel('FILTER', 216, col(row(pick(44, M2_FILTERS, 96, { cls: 'wide' })), filt(), row(led(40, 'A'), led(41, 'B'), led(42, 'N'), led(43, 'S')),
      row(knob(45, 'CUTOFF'), knob(46, 'RES'), knob(50, 'PAN', { bip: true })), row(knob(47, 'DRIVE'), knob(48, 'FAT'), knob(49, 'MIX'))), { cls: 'fil' });
    const top = h('div', { class: 'm2x-srcs' }, sub,
      oscPanel('OSC A', 212, 300, 302, 1, 2, 3, 4, 5, 10, 6, 7, 8, 9, 11, 12, 13, 168), oscPanel('OSC B', 213, 301, 303, 14, 15, 16, 17, 18, 23, 19, 20, 21, 22, 24, 25, 26, 169), noise, fil);
    // modulators
    let envBox, lfoBox, envRow, lfoRow;
    const et = tabsRow('env', 3, ['ENV 1', 'ENV 2', 'ENV 3'], () => { envBox.paint(); envKn(); }), lt = tabsRow('lfo', 8, ['LFO 1', 'LFO 2', 'LFO 3', 'LFO 4', 'LFO 5', 'LFO 6', 'LFO 7', 'LFO 8'], () => { lfoBox.paint(); lfoKn(); });
    envBox = envD(et.get); lfoBox = lfoD(lt.get); envRow = row(); lfoRow = row();
    const envKn = () => { const o = [[35, 36, 37, 38, 39], [51, 52, 53, 54, 55], [56, 57, 58, 59, 60]][et.get()]; envRow.replaceChildren(knob(o[0], 'ATK'), knob(o[1], 'HOLD'), knob(o[2], 'DEC'), knob(o[3], 'SUS'), knob(o[4], 'REL')); };
    const lfoKn = () => { const j = lt.get(), rk = j < 4 ? 61 + j : 260 + j - 4; lfoRow.replaceChildren(col(pick(M2.LFO_SHAPE + j, M2_LFO_SHAPES, 0), pick(M2.LFO_MODE + j, ['Trig', 'Env', 'Free'], 0)), led(M2.LFO_SYNC + j, 'BPM'), knob(rk, 'RATE'), knob(273 + j, 'RISE'), knob(281 + j, 'DELAY'), knob(j < 4 ? 223 + j : 264 + j - 4, 'SMOOTH')); };
    envKn(); lfoKn();
    const macros = panel('MACROS', null, h('div', { class: 'm2x-mac' }, knob(218, 'MACRO 1', { big: true }), knob(219, 'MACRO 2', { big: true }), knob(220, 'MACRO 3', { big: true }), knob(221, 'MACRO 4', { big: true })), { cls: 'mac' });
    const env = h('div', { class: 'm2x-p mod' }, et.el, envBox, envRow), lfo = h('div', { class: 'm2x-p mod wide' }, lt.el, lfoBox, lfoRow);
    const voi = panel('VOICING', null, col(row(led(M2.MONO, 'MONO'), numBox(M2.VOICES, 'POLY')), row(led(M2.LEGATO, 'LEGATO')), row(knob(65, 'PORTA'), knob(66, 'CURVE', { bip: true })), row(numBox(166, 'BEND +'), numBox(167, 'BEND -'))), { cls: 'voi' });
    return [top, h('div', { class: 'm2x-mods' }, macros, env, lfo, voi)];
  };
  // ---- FX page
  const FX = [['HYPER / DIMENSION', 163, () => [knob(148, 'RATE'), knob(149, 'DETUNE'), numBox(150, 'UNISON', { txt: (v) => String(1 + Math.round(C01(v) * 7)) }), led(151, 'RETRIG'), knob(147, 'MIX'), knob(152, 'SIZE'), knob(153, 'DIM MIX')]],
    ['DISTORTION', 154, () => [pick(99, M2_DIST, 13), knob(97, 'DRIVE'), knob(100, 'FREQ'), knob(101, 'BW'), knob(98, 'L/B/H'), pick(102, ['Pre', 'Post'], 2), knob(96, 'MIX')]],
    ['FLANGER', 155, () => [led(104, 'BPM'), knob(105, 'RATE'), knob(106, 'DEPTH'), knob(107, 'FEED', { bip: true }), knob(108, 'PHASE'), knob(103, 'MIX')]],
    ['PHASER', 156, () => [led(110, 'BPM'), knob(111, 'RATE'), knob(112, 'DEPTH'), knob(113, 'FREQ'), knob(114, 'FEED'), knob(115, 'PHASE'), knob(109, 'MIX')]],
    ['CHORUS', 157, () => [led(117, 'BPM'), knob(118, 'RATE'), knob(119, 'DELAY 1'), knob(120, 'DELAY 2'), knob(121, 'DEPTH'), knob(122, 'FEED'), knob(123, 'LPF'), knob(116, 'MIX')]],
    ['DELAY', 158, () => [led(127, 'BPM'), led(128, 'LINK'), pick(131, ['Normal', 'Ping-Pong', 'Tap->Delay'], 3), knob(129, 'LEFT'), knob(130, 'RIGHT'), knob(132, 'FEEDBACK'), knob(125, 'FREQ'), knob(126, 'BW'), knob(124, 'MIX')]],
    ['COMPRESSOR', 159, () => [knob(135, 'THRESH'), knob(136, 'RATIO'), knob(137, 'ATTACK'), knob(138, 'RELEASE'), knob(139, 'GAIN'), led(140, 'MULTIBAND'), knob(269, 'MIX')]],
    ['REVERB', 160, () => [knob(82, 'SIZE'), knob(83, 'PRE DLY'), knob(84, 'LOW CUT'), knob(85, 'DAMP'), knob(86, 'HIGH CUT'), knob(87, 'WIDTH'), knob(81, 'MIX')]],
    ['EQ', 161, () => [pick(94, ['Shelf', 'Peak', 'Cut'], 3), knob(88, 'FREQ L'), knob(90, 'Q L'), knob(92, 'GAIN L', { bip: true }), pick(95, ['Shelf', 'Peak', 'Cut'], 3), knob(89, 'FREQ H'), knob(91, 'Q H'), knob(93, 'GAIN H', { bip: true })]],
    ['FILTER', 162, () => [pick(142, M2_FILTERS, 96), knob(143, 'CUTOFF'), knob(144, 'RES'), knob(145, 'DRIVE'), knob(146, 'VAR'), knob(268, 'PAN', { bip: true }), knob(141, 'MIX')]]];
  // only the effects in use (their on switch), in Serum's fixed chain order; + Tambah FX turns one on, × turns it off
  const fxPage = () => {
    const act = FX.filter(([, on]) => k.get(on) > 0.5), free = FX.filter(([, on]) => k.get(on) <= 0.5);
    const add = h('button', { class: 'm2x-btn prim m2x-fxadd', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); if (!free.length) return;
      menu(free.map(([name, on]) => ({ label: name, fn: () => { k.set(on, 1); show(PAGE.get(pid) || 0); } })), r.left, r.bottom + 2); } }, '+ Tambah FX');
    const mods = act.map(([name, on, ctl]) => h('div', { class: 'm2x-fx' }, h('div', { class: 'm2x-fxh' }, h('b', {}, name),
      h('button', { class: 'm2x-fxx', title: 'Hapus efek', onclick: () => { k.set(on, 0); show(PAGE.get(pid) || 0); } }, '×')), h('div', { class: 'm2x-fxb' }, ...ctl())));
    return [h('div', { class: 'm2x-fxbar' }, add, h('span', { class: 'm2x-note' }, act.length ? act.length + ' efek aktif • urutan rantai tetap (atas ke bawah)' : 'Belum ada efek. Ketuk + Tambah FX.')),
      h('div', { class: 'm2x-fxlist' }, ...mods)];
  };
  // ---- MATRIX page
  const matrixPage = () => { const hd = () => ['#', 'SOURCE', 'AMOUNT', 'DESTINATION', 'OUTPUT'].map((t) => h('span', { class: 'm2x-mxh' }, t)), cols = [h('div', { class: 'm2x-mx' }, ...hd()), h('div', { class: 'm2x-mx' }, ...hd())], half = Math.ceil(M2.ROUTES / 2);
    for (let r = 0; r < M2.ROUTES; r++) { const sj = M2.ROUTE + 2 * r, dj = sj + 1, b = m2Bank(r);
      const dst = h('button', { class: 'm2x-dd' }); const dd = () => { const cur = Math.round(k.get(dj)), d = M2_DESTS.find(([pi]) => pi === cur); dst.textContent = (d ? d[1] : '—') + ' ▾'; };
      dst.onclick = (e) => { const rc = e.currentTarget.getBoundingClientRect(), cur = Math.round(k.get(dj)); menu([{ label: '—', check: cur < 0, fn: () => { k.set(dj, -1); dd(); } }, ...M2_DESTS.map(([pi, n]) => ({ label: n, check: pi === cur, fn: () => { k.set(dj, pi); dd(); } }))], rc.left, rc.bottom + 2); };
      dst.update = dd; dd(); k.reg(dst, dj);
      cols[r < half ? 0 : 1].append(h('span', { class: 'm2x-mxn' }, String(r + 1)), pick(sj, M2_SOURCES, 0), numBox(b, ''), dst, numBox(b + 1, '')); }
    return [h('div', { class: 'm2x-mxw' }, ...cols)]; };
  // ---- GLOBAL page
  const ev = (name, detail) => () => document.dispatchEvent(new CustomEvent(name, { detail: { i: k.ctx.i, ...detail } }));
  const tName = (o) => (o ? 'B' : 'A');
  const globalPage = () => [h('div', { class: 'm2x-glob' },
    panel('MASTER', null, row(knob(0, 'MASTER'), knob(172, 'A UNI WIDTH'), knob(173, 'B UNI WIDTH'), knob(176, 'A UNI WT', { bip: true }), knob(177, 'B UNI WT', { bip: true }), led(164, 'A KEYTRACK'), led(165, 'B KEYTRACK'))),
    panel('WAVETABLES', null, col(...[0, 1].map((o) => row(h('button', { class: 'm2x-btn', onclick: ev('mdaw-m2wt', { osc: o }) }, 'Muat wavetable ' + tName(o) + ' (.wav)…'), h('button', { class: 'm2x-btn', onclick: ev('mdaw-m2wtclr', { osc: o }) }, 'Bawaan'))))),
    panel('PRESET', null, col(row(h('button', { class: 'm2x-btn prim', onclick: ev('mdaw-m2fxp') }, 'Impor preset Serum (.fxp)…')),
      h('p', { class: 'm2x-note' }, 'Parameter dan wavetable preset dibaca dari file .fxp. Routing modulasi Serum belum terdokumentasi, jadi matriks diisi ulang manual.'))))];

  // ---- frame
  const pages = [['OSC', oscPage], ['FX', fxPage], ['MATRIX', matrixPage], ['GLOBAL', globalPage]], pid = key + ':page';
  const body = h('div', { class: 'm2x-body' });
  const show = (j) => { PAGE.set(pid, j); tabsEls.forEach((b, q) => b.classList.toggle('on', q === j)); body.className = 'm2x-body pg-' + pages[j][0].toLowerCase(); body.replaceChildren(...pages[j][1]()); };
  const tabsEls = pages.map(([n], j) => h('button', { class: 'm2x-pt', onclick: () => show(j) }, h('i'), n));
  const tr = P.state.tracks[k.ctx.i], from = (tr && tr.inst && tr.inst.from && tr.inst.from.name) || '';
  const top = h('div', { class: 'm2x-top' }, h('div', { class: 'm2x-logo' }, h('span', {}, 'MOISTURE'), h('small', {}, 'wavetable')), h('div', { class: 'm2x-pts' }, ...tabsEls),
    h('div', { class: 'm2x-preset' }, h('div', { class: 'm2x-pn' }, from || 'Init'), status), knob(0, 'MAIN', { big: true }));
  const root = h('div', { class: 'm2x' }, top, body);
  show(Math.min(PAGE.get(pid) || 0, pages.length - 1));
  return root;
}
