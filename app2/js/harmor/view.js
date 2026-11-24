// Harmor (instrument 38) plug-in window, in Ableton Live 12's visual language (charcoal / graphite panels, orange accent, ring knobs,
// compact labels, thin rules) and laid out for a phone first: a top bar (name, pages, preset / status, output meter, volume), ONE sound
// page at a time (TIMBRE, PITCH, FILTER, UNISON, MODULES) and a large editor under it (ENV, HARM, IMG, FX, ADV). Every control is a
// parameter of the instrument (k.get / k.set: undo, automation by long press, saved with the project); every display is drawn from the
// same values the engine uses (js/harmor/schema.js) or from the engine itself (devOut 998: meter + the newest voice's partials).
// Touch first: drag a knob up / down, double tap = default, long press = automation; editors: drag to draw / move, pinch to zoom, two
// fingers to pan, tap to add, double tap to delete. MobileDAW's own drawing: no Image-Line or Ableton artwork.
import { h, menu, toast, ask } from '../ui.js';
import { fmtParam, normOf, valOf, noteName, DEVICES } from '../defs.js';
import * as P from '../project.js';
import { eng } from '../engine.js';
import { HM, HM_WAVES, HM_QUALITY, HM_FILTERS, HM_SLOPES, HM_LFO_SHAPES, HM_LFO_DEST, HM_ENVS, HM_FX, HM_MAXP, HM_ISLOT } from './schema.js';

const OR = '#ff9d2e', OR2 = 'rgba(255,157,46,.22)', INK = '#d6d6d6', DIM = '#8a8a8a', GRID = 'rgba(255,255,255,.07)', GRID2 = 'rgba(255,255,255,.14)', BL = '#5fd4f5';
const C01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
let KID = 0;
const STATE = new Map();                               // per instrument: the open page / editor / selections (survive a redraw)
const E = (e, s) => HM.ENV + HM.ENV_STRIDE * e + s;
const F = (f, s) => HM.F + HM.F_STRIDE * f + s;
const L = (l, s) => HM.L + HM.L_STRIDE * l + s;
const FXP = (k, s) => HM.FX + HM.FX_STRIDE * k + s;

export function harmorView(k) {
  const def = k.def, i = () => k.ctx.i, t = () => P.state.tracks[k.ctx.i];
  const st = STATE.get(k.d.id) || { sec: 0, env: 0, harmT: 0, harmMode: 0, fxOpen: -1, zoom: 1, ofs: 0, hz: 1 }; STATE.set(k.d.id, st);
  const status = h('span', { class: 'hm-status' }, ''), say = (j) => { const p = def.params[j]; status.textContent = p ? p.n + '  ' + fmtParam(p, k.get(j)) : ''; };
  const regDraw = (fn) => { k.reg({ update: fn, _k: -2 }, -2); return fn; };

  // ---------------------------------------------------------------- controls
  function knob(j, label, o = {}) {
    const p = def.params[j], NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 40 40'); svg.setAttribute('class', 'hm-kn');
    const mk = (tg, a) => { const e = document.createElementNS(NS, tg); for (const [x, y] of Object.entries(a)) e.setAttribute(x, y); svg.append(e); return e; };
    const R = 15, A0 = Math.PI * 0.75, A1 = Math.PI * 2.25, arc = (a0, a1) => { const q = (a) => [20 + R * Math.cos(a), 20 + R * Math.sin(a)], [x0, y0] = q(a0), [x1, y1] = q(a1); return `M${x0} ${y0} A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`; };
    mk('path', { d: arc(A0, A1), fill: 'none', stroke: '#141414', 'stroke-width': 3.2, 'stroke-linecap': 'round' });
    const val = mk('path', { d: '', fill: 'none', stroke: OR, 'stroke-width': 3.2, 'stroke-linecap': 'round' });
    const gid = 'hmk' + (++KID), df = document.createElementNS(NS, 'defs'), rg = document.createElementNS(NS, 'radialGradient'); rg.setAttribute('id', gid); rg.setAttribute('cx', '40%'); rg.setAttribute('cy', '32%'); rg.setAttribute('r', '75%');
    for (const [o2, c] of [['0', '#d9d4cf'], ['0.45', '#8d8782'], ['1', '#3d3836']]) { const st2 = document.createElementNS(NS, 'stop'); st2.setAttribute('offset', o2); st2.setAttribute('stop-color', c); rg.append(st2); } df.append(rg); svg.append(df);
    mk('circle', { cx: 20, cy: 20, r: 11.5, fill: '#151314' });
    mk('circle', { cx: 20, cy: 20, r: 9.5, fill: `url(#${gid})`, stroke: '#0c0b0b', 'stroke-width': 0.8, class: 'face' });   // a brushed metal cap
    const ptr = mk('line', { x1: 20, y1: 20, x2: 20, y2: 11, stroke: '#1a1617', 'stroke-width': 2, 'stroke-linecap': 'round' }); val.style.stroke = 'var(--kc, ' + OR + ')';
    const vt = h('span', { class: 'hm-kv' }), bip = o.bip ?? (p.min < 0 && p.max > 0);
    const draw = () => { const v = normOf(p, k.get(j)), a = A0 + (A1 - A0) * v, z = bip ? A0 + (A1 - A0) * normOf(p, 0) : A0;
      val.setAttribute('d', Math.abs(a - z) < 0.02 ? '' : arc(Math.min(a, z), Math.max(a, z))); ptr.setAttribute('x2', 20 + 9 * Math.cos(a)); ptr.setAttribute('y2', 20 + 9 * Math.sin(a)); vt.textContent = fmtParam(p, k.get(j)); };
    const root = h('div', { class: 'hm-k' + (o.size ? ' ' + o.size : '') }, h('span', { class: 'hm-kl' }, label || p.n), svg, vt);
    dragV(svg, j, (v) => valOf(p, C01(v)), () => normOf(p, k.get(j)), () => { draw(); say(j); }, p.step);
    root.update = draw; draw(); return k.reg(root, j);
  }
  // vertical drag on a 0..1 position (200 px = full range, fine with two fingers), double tap = default, long press = automation
  function dragV(el, j, toVal, getN, after, step) {
    let s = null, lp = 0, lastTap = 0;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId); s = { y: e.clientY, n: getN(), moved: false }; say(j);
      const now = Date.now(); if (now - lastTap < 300) { k.set(j, def.params[j].def); after(); s = null; lastTap = 0; return; } lastTap = now;
      clearTimeout(lp); lp = setTimeout(() => { if (s && !s.moved) { const fn = k.auto(j); if (fn) fn(el.getBoundingClientRect()); s = null; } }, 600); e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => { if (!s) return; const dy = s.y - e.clientY; if (Math.abs(dy) > 3) s.moved = true; if (!s.moved) return;
      let v = toVal(s.n + dy / 200); if (step) v = Math.round(v / step) * step; if (v !== k.get(j)) { k.set(j, v); after(); } });
    const end = () => { clearTimeout(lp); s = null; }; el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  function chips(j, items, o = {}) {
    const p = def.params[j], bs = items.map((n, q) => h('button', { class: 'hm-chip', onclick: () => { k.set(j, (p.min || 0) + q); draw(); say(j); if (o.after) o.after(); } }, n));
    const draw = () => { const c = Math.round(k.get(j) - (p.min || 0)); bs.forEach((b, q) => b.classList.toggle('on', q === c)); };
    const root = h('div', { class: 'hm-chips' + (o.cls ? ' ' + o.cls : '') }, ...bs); root.update = draw; draw(); return k.reg(root, j);
  }
  function dd(j, items, o = {}) {
    const p = def.params[j], b = h('button', { class: 'hm-dd' + (o.cls ? ' ' + o.cls : '') });
    const draw = () => { b.textContent = (items[Math.round(k.get(j) - (p.min || 0))] || '') + ' ▾'; };
    b.onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(), c = Math.round(k.get(j) - (p.min || 0)); menu(items.map((n, q) => ({ label: n, check: q === c, fn: () => { k.set(j, (p.min || 0) + q); draw(); say(j); if (o.after) o.after(); } })), r.left, r.bottom + 2); };
    b.update = draw; draw(); return k.reg(b, j);
  }
  function tog(j, label, o = {}) {
    const b = h('button', { class: 'hm-tog' + (o.cls ? ' ' + o.cls : '') }, h('i'), label);
    const draw = () => b.classList.toggle('on', k.get(j) > 0.5);
    b.onclick = () => { k.set(j, k.get(j) > 0.5 ? 0 : 1); draw(); say(j); if (o.after) o.after(); };
    b.update = draw; draw(); return k.reg(b, j);
  }
  function num(j, label) {                              // a value box: vertical drag in steps (voices, partials ...)
    const p = def.params[j], v = h('b'), root = h('div', { class: 'hm-num' }, h('span', {}, label), v);
    const draw = () => { v.textContent = fmtParam(p, k.get(j)); };
    dragV(root, j, (x) => valOf(p, C01(x)), () => normOf(p, k.get(j)), () => { draw(); say(j); }, p.step || 1);
    root.update = draw; draw(); return k.reg(root, j);
  }
  // a canvas filling its box; draw(g, w, hh); o.touch = pointer handlers in local coordinates
  function disp(draw, o = {}) {
    const c = h('canvas'), box = h('div', { class: 'hm-disp' + (o.cls ? ' ' + o.cls : '') }, c); let w = 0, hh = 0, sc = 1;
    const paint = () => { if (!w) return; const g = c.getContext('2d'); g.setTransform(sc, 0, 0, sc, 0, 0); g.fillStyle = '#181818'; g.fillRect(0, 0, w, hh); k.inDraw(() => draw(g, w, hh)); };
    const size = () => { const W = box.clientWidth, H = box.clientHeight; if (W < 8 || H < 8) return; const s = Math.min(3, window.devicePixelRatio || 1); if (W === w && H === hh && s === sc) return; w = W; hh = H; sc = s; c.width = Math.round(w * sc); c.height = Math.round(hh * sc); c.style.width = w + 'px'; c.style.height = hh + 'px'; paint(); };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(size).observe(box); else requestAnimationFrame(size);
    regDraw(paint); box.paint = paint; box.size = () => [w, hh];
    if (o.touch) touchArea(c, o.touch, () => [w, hh], paint);
    return box;
  }
  // pointer gestures: one finger = down / move / up (x, y in the box), two fingers = pinch / pan (o.pinch(scale, cx, dx, dy)), tap / double tap
  function touchArea(el, T, size, paint) {
    el.style.touchAction = 'none'; const pts = new Map(); let one = null, two = null, lastTap = 0;
    const loc = (e) => { const r = el.getBoundingClientRect(), [w, hh] = size(); return [(e.clientX - r.left) * w / r.width, (e.clientY - r.top) * hh / r.height]; };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId); pts.set(e.pointerId, loc(e));
      if (pts.size === 2 && T.pinch) { if (one && T.cancel) T.cancel(one); one = null; const [a, b] = [...pts.values()]; two = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 }; return; }
      if (pts.size > 1) return;
      const [x, y] = loc(e), now = Date.now(), dbl = now - lastTap < 300; lastTap = now;
      if (dbl && T.dbl) { T.dbl(x, y); paint(); one = null; return; }
      one = T.down ? T.down(x, y) : null; paint();
    });
    el.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, loc(e));
      if (two && pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2; T.pinch(d / two.d, cx, cx - two.cx, cy - two.cy); two = { d, cx, cy }; paint(); return; }
      if (one && T.move) { const [x, y] = loc(e); T.move(x, y, one); paint(); }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) two = null; if (one && pts.size === 0) { if (T.up) T.up(one); one = null; paint(); } };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  const txt = (g, s, x, y, col = DIM, sz = 10, al = 'left') => { g.fillStyle = col; g.font = `500 ${sz}px system-ui,sans-serif`; g.textAlign = al; g.textBaseline = 'alphabetic'; g.fillText(s, x, y); g.textAlign = 'left'; };
  // a section: an italic title-case name and its knob colour (--kc) by family, as the owner's reference groups them
  const KC = [[/^TIMBRE|^HARM|^KUALITAS/, '#45d0e6'], [/^MIX|^VOLUME|^VELOCITY/, '#ffb347'], [/^PITCH|^VIBRATO|^VOICE|^ARTIK/, '#f2c94c'], [/^FILTER|^RESPONS/, '#3ddc97'],
    [/^UNISON|^SALINAN|^STEREO/, '#9fa8ff'], [/^PRISM|^PLUCK/, '#ff8a5c'], [/^BLUR|^PHASER/, '#c6f05a']];
  const tcase = (t) => t.split(' ').map((w) => (w.length > 2 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w)).join(' ');
  const panel = (title, body, o = {}) => { const c = (KC.find(([re]) => re.test(title)) || [0, ''])[1];
    return h('div', { class: 'hm-p' + (o.cls ? ' ' + o.cls : ''), style: c ? '--kc:' + c : '' }, h('div', { class: 'hm-ph' }, o.on != null ? tog(o.on, '', { cls: 'led' }) : null, h('b', {}, tcase(title)), ...(o.head || [])), body); };
  const row = (...a) => h('div', { class: 'hm-row' }, ...a.filter(Boolean));
  const colm = (...a) => h('div', { class: 'hm-col' }, ...a.filter(Boolean));

  // ---------------------------------------------------------------- model mirrors (what the engine computes, for the displays)
  const timbreAmps = (tt, n) => {                       // amplitude + phase of partials 1..n of timbre tt (harmor.cpp buildTimbre)
    const w = Math.round(k.get(HM.T * (tt + 1))), tab = tableOf(tt), a = new Float32Array(n), ph = new Float32Array(n);
    for (let q = 0; q < n; q++) { const hh = q + 1; let A = 0, PH = 0;
      if (w === 0) A = hh === 1 ? 1 : 0; else if (w === 1) { A = 2 / (Math.PI * hh); PH = hh & 1 ? 0 : Math.PI; } else if (w === 2) A = hh & 1 ? 4 / (Math.PI * hh) : 0;
      else if (w === 3) { A = hh & 1 ? 8 / (Math.PI * Math.PI * hh * hh) : 0; PH = ((hh - 1) / 2) & 1 ? Math.PI : 0; } else A = tab ? 1 : 1 / hh;
      if (tab) { A *= tab.lv[q] ?? 0; PH += (tab.ph[q] ?? 0) * 2 * Math.PI; }
      a[q] = A; ph[q] = PH; }
    return { a, ph };
  };
  const tableOf = (tt) => { const x = t() && t().inst.hmT && t().inst.hmT[tt]; return x && x.lv ? x : null; };
  const filterResp = (f, lf) => {                       // harmor.cpp buildFilter + flt, at log2 frequency lf (no modulation)
    if (k.get(F(f, 0)) <= 0.5) return 1;
    const type = Math.round(k.get(F(f, 1))), sl = Math.round(k.get(F(f, 6))), n = [2, 4, 8][sl] || 4, res = C01(k.get(F(f, 3))), wd = Math.max(0.05, k.get(F(f, 4))), ofs = k.get(F(f, 5));
    const bw = [1, 0.5, 0.25][sl] || 0.5, peak = 15 * res * res, x = lf - Math.log2(Math.max(16, k.get(F(f, 2))));
    let g;
    if (type === 1) g = 1 / Math.sqrt(1 + Math.pow(2, -2 * n * x)); else if (type === 2) g = Math.exp(-0.5 * (x / bw) ** 2); else if (type === 3) g = 1 - 0.9999 * Math.exp(-0.5 * (x / bw) ** 2);
    else if (type === 4) { const F3 = [[800, 1150, 2900], [400, 1700, 2600], [290, 2100, 3000], [450, 800, 2830], [325, 700, 2530]], G = [1, 0.5, 0.25], BW = [80, 90, 120], cut = lf - x;
      const vo = Math.max(0, Math.min(4, (cut - Math.log2(200)) / (Math.log2(5000) - Math.log2(200)) * 4)), i0 = Math.min(3, Math.floor(vo)), fr = vo - i0; g = 0.02;
      for (let q = 0; q < 3; q++) { const fk = F3[i0][q] + (F3[i0 + 1][q] - F3[i0][q]) * fr, wo = 1.44 * BW[q] / fk * (1 - 0.75 * res) + 0.02; g += G[q] * Math.exp(-0.5 * ((lf - Math.log2(fk)) / wo) ** 2); } return Math.min(1.5, g); }
    else if (type === 5) g = 1; else g = 1 / Math.sqrt(1 + Math.pow(2, 2 * n * x));
    if (peak > 0) g *= 1 + peak * Math.exp(-0.5 * ((x - ofs) / wd) ** 2);
    const mix = C01(k.get(F(f, 8))); return 1 - mix + mix * g;
  };

  // ---------------------------------------------------------------- live data (meter + partials of the newest voice)
  let live = { pk: [0, 0], hold: [0, 0], f0: 0, parts: new Float32Array(0), on: 0 };
  const meter = disp((g, w, hh) => {
    for (let c = 0; c < 2; c++) { const y = 3 + c * (hh - 4) / 2, bh = (hh - 8) / 2, lv = (db) => C01((db + 60) / 60) * w, v = live.pk[c] > 0 ? 20 * Math.log10(live.pk[c]) : -99, ho = live.hold[c] > 0 ? 20 * Math.log10(live.hold[c]) : -99;
      g.fillStyle = '#101010'; g.fillRect(0, y, w, bh); g.fillStyle = v > -3 ? '#ff5a4a' : v > -12 ? '#ffd24a' : '#5ad46a'; g.fillRect(0, y, lv(v), bh); g.fillStyle = INK; g.fillRect(Math.max(0, lv(ho) - 1), y, 1.5, bh); }
  }, { cls: 'hm-meter' });
  const partials = disp((g, w, hh) => {                 // the newest voice's partials (dB, -72 .. 0) at their frequency (log axis)
    for (const f of [100, 1000, 10000]) { const x = Math.log(f / 20) / Math.log(1000) * w; g.fillStyle = GRID2; g.fillRect(Math.round(x), 0, 1, hh); txt(g, f >= 1000 ? f / 1000 + 'k' : String(f), x + 2, 10, DIM, 9); }
    for (let d = -12; d >= -60; d -= 12) { const y = (-d / 72) * hh; g.fillStyle = GRID; g.fillRect(0, Math.round(y), w, 1); }
    const n = live.parts.length; if (!n || !live.f0) { txt(g, 'Mainkan not untuk melihat partial', w / 2, hh / 2 + 4, DIM, 10, 'center'); return; }
    g.fillStyle = OR; for (let q = 0; q < n; q++) { const a = live.parts[q]; if (!(a > 1e-5)) continue; const f = live.f0 * (q + 1); if (f > 20000) break; const x = Math.log(f / 20) / Math.log(1000) * w, db = 20 * Math.log10(a * 4), y = C01(-db / 72) * hh; g.fillRect(Math.round(x), y, Math.max(1.5, w / 400), hh - y); }
    txt(g, noteName(Math.round(69 + 12 * Math.log2(live.f0 / 440))) + '  ' + live.on + ' voice', 6, hh - 6, INK, 10);
  }, { cls: 'hm-parts' });
  k.every(50, () => { const o = eng.devOut(i(), 998); if (!o || o.length < 5) { if (live.f0) { live = { ...live, f0: 0, parts: new Float32Array(0), on: 0 }; partials.paint(); } live.pk = [0, 0]; meter.paint(); return; }
    live.pk = [o[0], o[1]]; live.hold = live.hold.map((x, c) => Math.max(o[c], x * 0.92)); live.on = o[2]; live.f0 = o[3]; const K = Math.min(o[4] | 0, o.length - 5); live.parts = Float32Array.from(o.slice(5, 5 + K)); meter.paint(); specRow(); });

  // ---------------------------------------------------------------- sound pages
  const waveThumb = (tt) => disp((g, w, hh) => {
    const { a, ph } = timbreAmps(tt, 64), mid = hh / 2, pts = []; let pk = 1e-9;
    for (let x = 0; x <= 128; x++) { const th = 2 * Math.PI * x / 128; let y = 0; for (let q = 0; q < 64; q++) if (a[q]) y += a[q] * Math.sin((q + 1) * th + ph[q]); pts.push(y); pk = Math.max(pk, Math.abs(y)); }
    g.fillStyle = GRID; g.fillRect(0, Math.round(mid), w, 1);
    g.beginPath(); pts.forEach((y, x) => { const X = 6 + (w - 12) * x / 128, Y = mid - y / pk * (hh / 2 - 6); x ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.strokeStyle = OR; g.lineWidth = 1.6; g.stroke();
    txt(g, (tt ? 'B' : 'A') + '  ' + (HM_WAVES[Math.round(k.get(HM.T * (tt + 1)))] || ''), 6, 12, INK, 10);
  }, { cls: 'hm-wave', touch: { down: () => { st.sec = 6; st.harmT = tt; show(); return null; } } });
  const timbrePage = () => {
    const tb = (tt) => panel('TIMBRE ' + (tt ? 'B' : 'A'), colm(waveThumb(tt), row(colm(dd(HM.T * (tt + 1), HM_WAVES, { after: redrawAll }), h('button', { class: 'hm-btn sm', onclick: () => { st.sec = 6; st.harmT = tt; show(); } }, 'Edit harmonik')),
      knob(HM.T * (tt + 1) + 1, 'Level'), knob(HM.T * (tt + 1) + 2, 'Phase Rnd'))), { cls: 'tb' });
    const mixP = panel('MIX', colm(chips(HM.BLEND, ['Mix', 'Morph']), row(knob(HM.MIX, 'A ↔ B'), knob(HM.STRETCH, 'Stretch'), knob(HM.SUB, 'Sub'))), { cls: 'mix' });
    return [h('div', { class: 'hm-grid g-timbre' }, tb(0), mixP, tb(1))];
  };
  // pitch over time for one note (2 s): the glide from a note 2 semitones below, then the vibrato after its delay (cents, ±depth)
  const pitchDisp = () => disp((g, w, hh) => {
    const T = 2, gl = k.get(HM.GLIDE), rt = k.get(HM.VIB_RATE), dp = k.get(HM.VIB_DEPTH), dl = k.get(HM.VIB_DELAY), rng = Math.max(250, dp * 1.25), mid = hh / 2, Y = (c) => mid - c / rng * (mid - 14), X = (tt) => 8 + tt / T * (w - 16);
    for (let tt = 0; tt <= T + 1e-9; tt += 0.25) { g.fillStyle = tt % 1 ? GRID : GRID2; g.fillRect(Math.round(X(tt)), 0, 1, hh); if (!(tt % 0.5)) txt(g, tt + ' s', X(tt) + 3, hh - 4, DIM, 9); }
    for (const c of [-200, -100, 100, 200]) if (Math.abs(c) <= rng) { g.fillStyle = GRID; g.fillRect(0, Math.round(Y(c)), w, 1); txt(g, (c > 0 ? '+' : '') + c + ' ct', 4, Y(c) - 3, DIM, 9); }
    g.fillStyle = GRID2; g.fillRect(0, Math.round(mid), w, 1);
    if (dl > 0 && dl < T) { g.fillStyle = 'rgba(95,212,245,.10)'; g.fillRect(X(0), 0, X(dl) - X(0), hh); txt(g, 'Delay', X(dl) - 4, 12, BL, 9, 'right'); }
    g.beginPath(); for (let x = 0; x <= w - 16; x += 1.5) { const tt = x / (w - 16) * T, gc = gl > 0 ? -200 * Math.exp(-tt / Math.max(1e-3, gl / 3)) : 0, vc = tt > dl ? dp * Math.min(1, (tt - dl) / 0.15) * Math.sin(2 * Math.PI * rt * (tt - dl)) : 0, y = Y(gc + vc); x ? g.lineTo(8 + x, y) : g.moveTo(8 + x, y); }
    g.strokeStyle = OR; g.lineWidth = 2; g.stroke();
    const co = Math.round(k.get(HM.PITCH)), fi = k.get(HM.FINE);
    txt(g, `Glide ${Math.round(gl * 1000)} ms  •  Vibrato ${rt.toFixed(2)} Hz ±${Math.round(dp)} ct  •  ${co >= 0 ? '+' : ''}${co} st ${fi >= 0 ? '+' : ''}${fi.toFixed(0)} ct`, w - 8, 14, INK, 10, 'right');
  }, { cls: 'hm-pitch' });
  const pitchPage = () => [h('div', { class: 'hm-grid' },
    panel('PITCH', row(knob(HM.PITCH, 'Coarse'), knob(HM.FINE, 'Fine'), knob(HM.GLIDE, 'Glide'))),
    panel('VOICE', colm(row(tog(HM.MONO, 'Mono'), tog(HM.LEGATO, 'Legato')), row(num(HM.POLY, 'Voices')))),
    panel('VIBRATO', row(knob(HM.VIB_RATE, 'Rate'), knob(HM.VIB_DEPTH, 'Depth'), knob(HM.VIB_DELAY, 'Delay'))),
    panel('ARTIKULATOR PITCH', row(tog(E(1, 0), 'On'), knob(E(1, 1), 'Depth'), h('button', { class: 'hm-btn', onclick: () => { st.sec = 5; st.env = 1; show(); } }, 'Edit envelope'))))];
  const filtDisp = () => disp((g, w, hh) => {
    const lx = (x) => Math.log2(20) + x / w * Math.log2(1000), y0 = 12, bot = hh - 4, Y = (db) => y0 + (bot - y0) * C01((24 - db) / 72);
    for (const f of [100, 1000, 10000]) { const x = Math.log(f / 20) / Math.log(1000) * w; g.fillStyle = GRID2; g.fillRect(Math.round(x), 0, 1, hh); txt(g, f >= 1000 ? f / 1000 + 'k' : String(f), x + 2, 10, DIM, 9); }
    for (const d of [12, 0, -12, -24, -36]) { g.fillStyle = d === 0 ? GRID2 : GRID; g.fillRect(0, Math.round(Y(d)), w, 1); }
    for (let f = 0; f < 2; f++) { if (k.get(F(f, 0)) <= 0.5) continue; g.beginPath(); for (let x = 0; x <= w; x += 2) { const db = 20 * Math.log10(Math.max(1e-6, filterResp(f, lx(x)))); x ? g.lineTo(x, Y(db)) : g.moveTo(x, Y(db)); } g.strokeStyle = f ? 'rgba(95,212,245,.7)' : 'rgba(255,157,46,.6)'; g.lineWidth = 1; g.stroke(); }
    g.beginPath(); for (let x = 0; x <= w; x += 2) { const db = 20 * Math.log10(Math.max(1e-6, filterResp(0, lx(x)) * filterResp(1, lx(x)))); x ? g.lineTo(x, Y(db)) : g.moveTo(x, Y(db)); }
    const path = new Path2D(); path.addPath(new Path2D()); g.strokeStyle = OR; g.lineWidth = 2; g.stroke(); g.lineTo(w, bot); g.lineTo(0, bot); g.closePath(); g.fillStyle = OR2; g.fill();
    for (let f = 0; f < 2; f++) if (k.get(F(f, 0)) > 0.5) { const x = Math.log(k.get(F(f, 2)) / 20) / Math.log(1000) * w, db = 20 * Math.log10(Math.max(1e-6, filterResp(0, Math.log2(k.get(F(f, 2)))) * filterResp(1, Math.log2(k.get(F(f, 2)))))); g.beginPath(); g.arc(x, Y(db), 5, 0, 7); g.strokeStyle = f ? BL : '#fff'; g.lineWidth = 1.5; g.stroke(); txt(g, String(f + 1), x + 7, Y(db) - 5, INK, 10); }
  }, { cls: 'hm-filt', touch: {                         // drag: x = the nearest filter's cutoff, y = its resonance
    down: (x) => { const [w] = filt.size(); let f = 0, best = 1e9; for (let q = 0; q < 2; q++) if (k.get(F(q, 0)) > 0.5) { const d = Math.abs(Math.log(k.get(F(q, 2)) / 20) / Math.log(1000) * w - x); if (d < best) { best = d; f = q; } } return { f, x, c: k.get(F(f, 2)), r: k.get(F(f, 3)) }; },
    move: (x, y, s) => { const [w, hh] = filt.size(); k.set(F(s.f, 2), Math.max(20, Math.min(20000, s.c * Math.pow(1000, (x - s.x) / w)))); say(F(s.f, 2)); void y; void hh; },
    pinch: (sc) => { const j = F(0, 3); k.set(j, C01(k.get(j) * sc)); say(j); } } });
  let filt;
  const filterPage = () => { filt = filtDisp();
    const fp = (f) => panel('FILTER ' + (f + 1), row(knob(F(f, 2), 'Cutoff'), knob(F(f, 3), 'Res'), knob(F(f, 4), 'Width'), knob(F(f, 5), 'Offset'), knob(F(f, 7), 'Key'), knob(F(f, 8), 'Mix')),
      { on: F(f, 0), cls: 'flt', head: [dd(F(f, 1), HM_FILTERS, { after: () => filt.paint(), cls: 'sm' }), chips(F(f, 6), HM_SLOPES, { after: () => filt.paint(), cls: 'sm' }),
        h('button', { class: 'hm-btn sm', onclick: () => { st.sec = 5; st.env = 2 + f; show(); } }, 'Env')] });
    return [h('div', { class: 'hm-grid g-2' }, fp(0), fp(1)), panel('RESPONS', h('div', { class: 'hm-side' }, filt, row(knob(HM.SELFOSC, 'Self-Osc', { size: 'sm' }), knob(HM.VEL_FLT, 'Vel > Cut', { size: 'sm' }))), { cls: 'wide grow' })]; };
  const uniDisp = () => disp((g, w, hh) => {
    const n = Math.round(k.get(HM.U_VOICES)), det = k.get(HM.U_DETUNE), ps = k.get(HM.U_PITCH), sp = k.get(HM.U_SPREAD), vd = k.get(HM.U_VOLDIST), mid = hh / 2;
    g.fillStyle = GRID2; g.fillRect(w / 2, 0, 1, hh); txt(g, 'L', 4, 12, DIM, 10); txt(g, 'R', w - 12, 12, DIM, 10);
    for (let u = 0; u < n; u++) { const pos = n === 1 ? 0 : -1 + 2 * u / (n - 1), cen = 1 - Math.abs(pos), wgt = Math.max(0, 1 + vd * (2 * cen - 1)), x = w / 2 + pos * sp * (w / 2 - 16), cents = pos * det + pos * ps * 100, y = mid - Math.max(-1, Math.min(1, cents / 150)) * (mid - 14);
      g.beginPath(); g.arc(x, y, 4 + 5 * Math.min(1.5, wgt) / 1.5, 0, 7); g.fillStyle = OR2; g.fill(); g.strokeStyle = OR; g.lineWidth = 1.5; g.stroke(); }
    txt(g, n + ' salinan', 6, hh - 6, INK, 10);
  }, { cls: 'hm-uni' });
  const unisonPage = () => [panel('UNISON', uniDisp(), { cls: 'wide grow' }), h('div', { class: 'hm-grid' }, panel('SALINAN', row(num(HM.U_VOICES, 'Unison'), knob(HM.U_DETUNE, 'Detune'), knob(HM.U_PITCH, 'Pitch'))),
    panel('STEREO', row(knob(HM.U_SPREAD, 'Spread'), knob(HM.U_PHASE, 'Phase'), knob(HM.U_VOLDIST, 'Vol Dist'))))];
  const modulesPage = () => [h('div', { class: 'hm-grid g-mod' },
    panel('PRISM', row(knob(HM.PRISM_AMT, 'Amount'), chips(HM.PRISM_MODE, ['Scatter', 'Shift']))),
    panel('PLUCK', row(knob(HM.PLUCK_AMT, 'Amount'), knob(HM.PLUCK_TIME, 'Time'), knob(HM.PLUCK_DAMP, 'Damp'))),
    panel('BLUR', row(knob(HM.BLUR_ATT, 'Attack'), knob(HM.BLUR_REL, 'Release'), knob(HM.BLUR_HARM, 'Harm'))),
    panel('PHASER', row(knob(HM.SPH_DEPTH, 'Depth'), knob(HM.SPH_DENS, 'Notches'), knob(HM.SPH_SPEED, 'Speed'), knob(HM.SPH_SHARP, 'Sharp'), knob(HM.SPH_OFS, 'Offset'))))];

  // ---------------------------------------------------------------- editor: articulators (multi-point) + LFOs
  const envPts = (e) => {                               // the articulator's points [t (s, absolute), level, curve], sustain, loop (AHDSR made into points)
    const n = Math.round(k.get(E(e, 2)));
    if (n >= 2) { const pts = []; let tt = 0; for (let j = 0; j < n; j++) { tt += j ? Math.max(0, k.get(E(e, 10 + 3 * j))) : 0; pts.push([tt, C01(k.get(E(e, 11 + 3 * j))), k.get(E(e, 12 + 3 * j))]); } const s = Math.round(k.get(E(e, 3))), l = Math.round(k.get(E(e, 4))); return { pts, sus: s >= 1 && s < n ? s : -1, loop: s >= 1 && l >= 0 && l < s ? l : -1, ahdsr: false }; }
    const A = k.get(E(e, 5)), Hd = k.get(E(e, 6)), D = k.get(E(e, 7)), S = k.get(E(e, 8)), R = k.get(E(e, 9));
    return { pts: [[0, 0, 0], [A, 1, 0], [A + Hd, 1, 0], [A + Hd + D, S, 0.6], [A + Hd + D + Math.max(0.2, R) + R, 0, 0.6]].map((p, j) => (j === 4 ? [A + Hd + D + R + 0.0001, 0, 0.6] : p)), sus: 3, loop: -1, ahdsr: true };
  };
  const writePts = (e, ev) => {                         // points back into the parameters (time from the previous point)
    k.set(E(e, 2), ev.pts.length); ev.pts.forEach(([tt, lv, cv], j) => { k.set(E(e, 10 + 3 * j), j ? Math.max(0, tt - ev.pts[j - 1][0]) : 0); k.set(E(e, 11 + 3 * j), C01(lv)); k.set(E(e, 12 + 3 * j), Math.max(-1, Math.min(1, cv))); });
    k.set(E(e, 3), ev.sus); k.set(E(e, 4), ev.loop);
  };
  const shape = (x, c) => (c >= 0 ? 1 - Math.pow(1 - x, 1 + 6 * c) : Math.pow(x, 1 - 6 * c));
  let envD, selPt = -1;
  const envEditor = () => {
    const e = st.env;
    const span = () => { const ev = envPts(e); return Math.max(0.5, ev.pts[ev.pts.length - 1][0] * 1.15); };
    const X = (tt, w) => 14 + (tt / (span() / st.zoom) - st.ofs) * (w - 28), Tm = (x, w) => ((x - 14) / (w - 28) + st.ofs) * (span() / st.zoom);
    envD = disp((g, w, hh) => {
      const ev = envPts(e), top = 10, bot = hh - 16, Y = (v) => bot - (bot - top) * v, on = k.get(E(e, 0)) > 0.5;
      const sp = span() / st.zoom, step = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5].find((s) => (w - 28) * s / sp > 50) || 5;
      for (let tt = Math.ceil(st.ofs * sp / step) * step; tt < (st.ofs + 1) * sp; tt += step) { const x = X(tt, w); g.fillStyle = GRID; g.fillRect(Math.round(x), top, 1, bot - top); txt(g, (tt < 1 ? Math.round(tt * 1000) + ' ms' : tt.toFixed(tt < 10 ? 2 : 1) + ' s'), x + 2, hh - 4, DIM, 9); }
      for (const v of [0, 0.5, 1]) { g.fillStyle = v === 0 ? GRID2 : GRID; g.fillRect(0, Math.round(Y(v)), w, 1); }
      if (ev.loop >= 0) { g.fillStyle = 'rgba(95,212,245,.12)'; g.fillRect(X(ev.pts[ev.loop][0], w), top, X(ev.pts[ev.sus][0], w) - X(ev.pts[ev.loop][0], w), bot - top); }
      g.beginPath(); g.moveTo(X(ev.pts[0][0], w), Y(ev.pts[0][1]));
      for (let j = 1; j < ev.pts.length; j++) { const [t0, v0] = ev.pts[j - 1], [t1, v1, c] = ev.pts[j]; for (let q = 1; q <= 24; q++) { const x = q / 24; g.lineTo(X(t0 + (t1 - t0) * x, w), Y(v0 + (v1 - v0) * shape(x, c))); } }
      g.strokeStyle = on ? OR : '#777'; g.lineWidth = 2; g.stroke(); g.lineTo(X(ev.pts[ev.pts.length - 1][0], w), bot); g.lineTo(X(ev.pts[0][0], w), bot); g.closePath(); g.fillStyle = on ? OR2 : 'rgba(150,150,150,.1)'; g.fill();
      ev.pts.forEach(([tt, v], j) => { const x = X(tt, w), y = Y(v); g.beginPath(); g.arc(x, y, j === selPt ? 7 : 5, 0, 7); g.fillStyle = j === ev.sus ? BL : '#ececec'; g.fill(); if (j === selPt) { g.strokeStyle = OR; g.lineWidth = 2; g.stroke(); } });
      if (ev.sus >= 0) txt(g, 'S', X(ev.pts[ev.sus][0], w) + 7, Y(ev.pts[ev.sus][1]) - 6, BL, 10);
      txt(g, HM_ENVS[e] + (ev.ahdsr ? '  •  AHDSR' : '  •  ' + ev.pts.length + ' titik') + (on ? '' : '  (off)'), w - 8, 14, INK, 10, 'right');   // top right: the first point sits at the top left
    }, { cls: 'hm-env', touch: {
      down: (x, y) => { const [w, hh] = envD.size(), ev = envPts(e), Y = (v) => hh - 16 - (hh - 26) * v; let best = 1e9, j0 = -1; ev.pts.forEach(([tt, v], j) => { const d = Math.hypot(X(tt, w) - x, Y(v) - y); if (d < best) { best = d; j0 = j; } });
        if (best < 22) { selPt = j0; return { kind: 'pt', j: j0, ev }; }
        for (let j = 1; j < ev.pts.length; j++) { const xa = X(ev.pts[j - 1][0], w), xb = X(ev.pts[j][0], w); if (x > xa + 8 && x < xb - 8) { const ev2 = ev.ahdsr ? (writePts(e, ev), envPts(e)) : ev; return { kind: 'curve', j, ev: ev2, y, c: ev2.pts[j][2], add: { x, y } }; } }
        return null; },
      move: (x, y, s) => { if (!s) return; const [w, hh] = envD.size(); s.moved = true; let ev = s.ev; if (ev.ahdsr) { writePts(e, ev); ev = s.ev = envPts(e); }
        if (s.kind === 'pt') { const j = s.j, lo = j ? ev.pts[j - 1][0] : 0, hi = j < ev.pts.length - 1 ? ev.pts[j + 1][0] : 1e9;
          const tt = j === 0 ? 0 : Math.max(lo, Math.min(hi, Tm(x, w))), lv = C01((hh - 16 - y) / (hh - 26)), d = tt - ev.pts[j][0];
          ev.pts[j][0] = tt; ev.pts[j][1] = lv; if (j < ev.pts.length - 1 && hi === 1e9) void d; writePts(e, ev); }
        else { ev.pts[s.j][2] = Math.max(-1, Math.min(1, s.c + (s.y - y) / 80 * (ev.pts[s.j][1] >= ev.pts[s.j - 1][1] ? -1 : 1))); writePts(e, ev); } },
      up: (s) => { if (s && s.kind === 'curve' && !s.moved) {   // a tap between points: a new point there
          const [w, hh] = envD.size(), ev = envPts(e); if (ev.pts.length >= HM.ENV_PTS) { toast('Maksimal 16 titik.'); return; }
          const tt = Tm(s.add.x, w), lv = C01((hh - 16 - s.add.y) / (hh - 26)); let j = ev.pts.findIndex((p) => p[0] > tt); if (j < 1) j = ev.pts.length;
          ev.pts.splice(j, 0, [tt, lv, 0]); if (ev.sus >= j) ev.sus++; if (ev.loop >= j) ev.loop++; selPt = j; writePts(e, ev); } envD.paint(); },
      dbl: (x, y) => { const [w, hh] = envD.size(), ev = envPts(e), Y = (v) => hh - 16 - (hh - 26) * v; const j = ev.pts.findIndex(([tt, v]) => Math.hypot(X(tt, w) - x, Y(v) - y) < 22);
        if (j > 0 && ev.pts.length > 2) { const ev2 = ev.ahdsr ? (writePts(e, ev), envPts(e)) : ev; ev2.pts.splice(j, 1); if (ev2.sus === j) ev2.sus = -1; else if (ev2.sus > j) ev2.sus--; if (ev2.loop >= j) ev2.loop = ev2.loop === j ? -1 : ev2.loop - 1; if (ev2.loop >= ev2.sus) ev2.loop = -1; selPt = -1; writePts(e, ev2); } },
      pinch: (sc, cx, dx) => { const [w] = envD.size(); st.zoom = Math.max(1, Math.min(32, st.zoom * sc)); st.ofs = Math.max(0, Math.min(1 - 1 / st.zoom, st.ofs - dx / (w - 28) / st.zoom)); void cx; } } });
    const ptBtn = (label, fn) => h('button', { class: 'hm-btn sm', onclick: () => { const ev = envPts(e); if (ev.ahdsr) { writePts(e, ev); } const ev2 = envPts(e); fn(ev2); writePts(e, ev2); envD.paint(); } }, label);
    const isAhd = Math.round(k.get(E(e, 2))) < 2;
    const tools = row(tog(E(e, 0), 'On', { after: () => envD.paint() }), knob(E(e, 1), 'Depth'),
      ptBtn('Sustain', (ev) => { if (selPt > 0 && selPt < ev.pts.length - 1) ev.sus = ev.sus === selPt ? -1 : selPt; else toast('Pilih titik di tengah dulu.'); if (ev.loop >= ev.sus) ev.loop = -1; }),
      ptBtn('Loop', (ev) => { if (ev.sus < 0) { toast('Loop butuh titik sustain.'); return; } if (selPt >= 0 && selPt < ev.sus) ev.loop = ev.loop === selPt ? -1 : selPt; else toast('Pilih titik sebelum sustain.'); }),
      h('button', { class: 'hm-btn sm', onclick: () => { st.zoom = 1; st.ofs = 0; envD.paint(); } }, 'Fit'),
      h('button', { class: 'hm-btn sm', onclick: () => { k.set(E(e, 2), 0); selPt = -1; show(); } }, 'AHDSR'),
      ...(isAhd ? [[5, 'A'], [6, 'H'], [7, 'D'], [8, 'S'], [9, 'R']].map(([s, n]) => knob(E(e, s), n)) : []));
    return h('div', { class: 'hm-col grow' }, envD, tools, h('div', { class: 'hm-hint' }, 'Ketuk di antara titik = titik baru • geser titik = waktu / level • geser garis = kurva • ketuk 2× titik = hapus • cubit = zoom'));
  };
  const lfoEditor = (l) => {
    const d = disp((g, w, hh) => { const shp = Math.round(k.get(L(l, 1))), mid = hh / 2, a = (hh - 20) / 2, depth = C01(k.get(L(l, 3))), ph0 = C01(k.get(L(l, 2))); let sv = 0.3;
      g.fillStyle = GRID2; g.fillRect(0, Math.round(mid), w, 1); g.beginPath();
      for (let x = 0; x <= w; x++) { const ph = (x / w * 2 + ph0) % 1; let y; if (shp === 0) y = Math.sin(2 * Math.PI * ph); else if (shp === 1) y = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph; else if (shp === 2) y = 2 * ph - 1; else if (shp === 3) y = ph < 0.5 ? 1 : -1; else { if (x % Math.max(1, Math.round(w / 8)) === 0) sv = Math.sin(x * 12.9898) * 0.9; y = sv; }
        const Y = mid - y * a * Math.max(0.15, depth); x ? g.lineTo(x, Y) : g.moveTo(x, Y); }
      g.strokeStyle = OR; g.lineWidth = 2; g.stroke(); txt(g, 'LFO ' + (l + 1) + '  →  ' + HM_LFO_DEST[Math.round(k.get(L(l, 4)))], 8, 14, INK, 10); }, { cls: 'hm-env' });
    return h('div', { class: 'hm-col grow' }, d, row(colm(chips(L(l, 1), HM_LFO_SHAPES, { after: () => d.paint() }), row(dd(L(l, 4), HM_LFO_DEST, { after: () => d.paint() }), tog(L(l, 5), 'Retrig'))),
      knob(L(l, 0), 'Rate'), knob(L(l, 2), 'Phase'), knob(L(l, 3), 'Depth')));
  };
  const envTab = () => { const names = [...HM_ENVS.map((n) => n), 'LFO 1', 'LFO 2'], body = h('div', { class: 'hm-edbody grow' });
    const draw = () => { selPt = -1; body.replaceChildren(st.env < 10 ? envEditor() : lfoEditor(st.env - 10)); sel.forEach((b, q) => b.classList.toggle('on', q === st.env)); };
    const sel = names.map((n, q) => h('button', { class: 'hm-chip' + (q < 10 && k.get(E(q, 0)) > 0.5 ? ' lit' : ''), onclick: () => { st.env = q; st.zoom = 1; st.ofs = 0; draw(); } }, n));
    draw(); return [h('div', { class: 'hm-chips scroll' }, ...sel), body]; };

  // ---------------------------------------------------------------- editor: harmonic level / phase drawing
  const harmTab = () => {
    const tt = st.harmT, view = () => Math.max(8, Math.min(HM_MAXP, Math.round(64 / st.hz)));
    const cur = () => { const x = tableOf(tt); if (x) return { lv: Float32Array.from(x.lv), ph: Float32Array.from(x.ph) }; const { a } = timbreAmps(tt, HM_MAXP); let m = 1e-9; for (const v of a) m = Math.max(m, v); return { lv: Float32Array.from(a, (v) => v / m), ph: new Float32Array(HM_MAXP) }; };
    let tab = null, dirty = 0;
    const commit = () => { clearTimeout(dirty); dirty = setTimeout(async () => { const r = await (await import('./harmor.js')).harmorSetTable(i(), tt, tab.lv, tab.ph); if (r && r.error) toast(r.error); bars.paint(); }, 60); };
    const bars = disp((g, w, hh) => {
      const n = view(), ofs = Math.max(0, Math.min(HM_MAXP - n, Math.round(st.hofs || 0))), data = tab || cur(), ph = st.harmMode === 1, bw = (w - 8) / n, top = 16, bot = hh - 14;
      for (const v of [0.25, 0.5, 0.75]) { g.fillStyle = GRID; g.fillRect(0, Math.round(bot - (bot - top) * v), w, 1); }
      for (let q = 0; q < n; q++) { const j = ofs + q, v = ph ? data.ph[j] : data.lv[j], x = 4 + q * bw;
        g.fillStyle = ph ? BL : OR; const y = bot - (bot - top) * C01(v); g.fillRect(x + Math.min(1, bw * 0.15), y, Math.max(1, bw - Math.max(1, bw * 0.3)), bot - y);
        if (bw > 16 || (j + 1) % (bw > 6 ? 4 : 16) === 0 || j === 0) txt(g, String(j + 1), x + bw / 2, hh - 3, DIM, 9, 'center'); }
      txt(g, 'Timbre ' + (tt ? 'B' : 'A') + ' • ' + (ph ? 'fase' : 'level') + ' • partial ' + (ofs + 1) + '–' + (ofs + n) + (tableOf(tt) ? '' : '  (gambar untuk mulai mengedit)'), 6, 12, INK, 10);
    }, { cls: 'hm-harm grow', touch: {
      down: (x, y) => { if (!tab) { tab = cur(); if (Math.round(k.get(HM.T * (tt + 1))) !== 4) { k.set(HM.T * (tt + 1), 4); } } return paintAt(x, y, null); },
      move: (x, y, s) => paintAt(x, y, s),
      pinch: (sc, cx, dx) => { const [w] = bars.size(), n0 = view(); st.hz = Math.max(64 / HM_MAXP, Math.min(8, st.hz * sc)); const n1 = view(); st.hofs = Math.max(0, Math.min(HM_MAXP - n1, (st.hofs || 0) + (n0 - n1) * (cx / w) - dx / (w - 8) * n1)); } } });
    function paintAt(x, y, s) {                         // draw: every bar crossed between the last point and this one
      const [w, hh] = bars.size(), n = view(), ofs = Math.max(0, Math.min(HM_MAXP - n, Math.round(st.hofs || 0))), bw = (w - 8) / n, top = 16, bot = hh - 14;
      const q = Math.max(0, Math.min(n - 1, Math.floor((x - 4) / bw))), v = C01((bot - y) / (bot - top)), arr = st.harmMode === 1 ? tab.ph : tab.lv;
      if (s) { const a = Math.min(s.q, q), b = Math.max(s.q, q); for (let r = a; r <= b; r++) arr[ofs + r] = b === a ? v : s.v + (v - s.v) * (r - s.q) / (q - s.q); } else arr[ofs + q] = v;
      commit(); return { q, v };
    }
    const preset = (name, fn) => h('button', { class: 'hm-btn sm', onclick: () => { tab = cur(); for (let j = 0; j < HM_MAXP; j++) tab.lv[j] = fn(j + 1); if (Math.round(k.get(HM.T * (tt + 1))) !== 4) k.set(HM.T * (tt + 1), 4); commit(); } }, name);
    return [row(h('div', { class: 'hm-chips' }, ...[0, 1].map((q) => h('button', { class: 'hm-chip' + (st.harmT === q ? ' on' : ''), onclick: () => { st.harmT = q; show(); } }, 'Timbre ' + (q ? 'B' : 'A')))),
      h('div', { class: 'hm-chips' }, ...['Level', 'Fase'].map((n, q) => h('button', { class: 'hm-chip' + (st.harmMode === q ? ' on' : ''), onclick: () => { st.harmMode = q; show(); } }, n))),
      h('button', { class: 'hm-btn sm', onclick: () => { st.hz = Math.min(8, st.hz * 2); bars.paint(); } }, 'Zoom +'), h('button', { class: 'hm-btn sm', onclick: () => { st.hz = Math.max(64 / HM_MAXP, st.hz / 2); bars.paint(); } }, 'Zoom −')),
    bars, row(preset('1/k', (n) => 1 / n), preset('Ganjil', (n) => (n & 1 ? 1 / n : 0)), preset('Organ', (n) => ([1, 2, 3, 4, 6, 8].includes(n) ? 0.6 : 0)), preset('Bel', (n) => Math.exp(-n / 9) * (n % 3 ? 1 : 0.2)),
      h('button', { class: 'hm-btn sm', onclick: async () => { tab = null; (await import('./harmor.js')).harmorSetTable(i(), tt, null); k.set(HM.T * (tt + 1), tt ? 2 : 1); show(); } }, 'Reset')),
    h('div', { class: 'hm-hint' }, 'Geser jari = gambar level / fase tiap partial (langsung terdengar) • cubit = zoom • dua jari = geser')];
  };

  // ---------------------------------------------------------------- editor: image synthesis / resynthesis
  const imgTab = () => {
    // vocal / image g (0..7): image 0 = the main map, 1..7 = more vocals in this Harmor; a note's Vokal value (piano roll lane) picks one
    const vg = Math.max(0, Math.min(7, st.img | 0)), IP = (o, legacy) => (vg ? HM.IMG + HM.IMG_STRIDE * (vg - 1) + o : legacy);
    const hmAll = (q) => (q ? ((t() && t().inst.hmI) || {})[q] : t() && t().inst.hm) || null;
    const hm = hmAll(vg), H = () => import('./harmor.js');
    if (st.resQ == null && hm && hm.src === 'audio' && hm.opts && hm.opts.quality != null) st.resQ = hm.opts.quality;   // the quality the map was made at
    const map = disp((g, w, hh) => {
      const m = mapView(); if (!m) { txt(g, vg ? 'Vokal ' + (vg + 1) + ' kosong — muat audio (kanan). Not dengan Vokal ' + (vg + 1) + ' memakai vokal 1.' : 'Belum ada peta — muat audio atau gambar (kanan).', w / 2, hh / 2, DIM, 11, 'center'); return; }
      const { frames, bins, data } = m, img = g.createImageData(Math.max(1, Math.round(w)), Math.max(1, Math.round(hh))), W = img.width, Hh = img.height;
      for (let x = 0; x < W; x++) { const f = Math.min(frames - 1, Math.floor(x / W * frames)); for (let y = 0; y < Hh; y++) { const b = Math.min(bins - 1, Math.floor((1 - y / Hh) * bins)), a = data[16 + f * bins + b] || 0, db = a > 0 ? 20 * Math.log10(a) : -120, v = C01((db + 66) / 60), o = (y * W + x) * 4;
        img.data[o] = 30 + 225 * v; img.data[o + 1] = 22 + 135 * v * v; img.data[o + 2] = 18 + 30 * v; img.data[o + 3] = 255; } }
      { const c2 = document.createElement('canvas'); c2.width = W; c2.height = Hh; c2.getContext('2d').putImageData(img, 0, 0); g.imageSmoothingEnabled = false; g.drawImage(c2, 0, 0, w, hh); }   // through a canvas: putImageData ignores the display scale
      { const xa = C01(k.get(IP(HM_ISLOT.START, HM.MAP_START))) * w, xb = Math.max(xa, C01(k.get(IP(HM_ISLOT.END, HM.MAP_END))) * w), lp = k.get(IP(HM_ISLOT.LOOP, HM.MAP_LOOP)) > 0.5;   // the play range: outside it dimmed, Start / End lines
        g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, xa, hh); g.fillRect(xb, 0, w - xb, hh);
        if (lp) { g.fillStyle = 'rgba(95,212,245,.55)'; g.fillRect(xa, 0, xb - xa, 2); }   // Loop: a thin bar over the looped range (the map stays readable)
        g.fillStyle = OR; g.fillRect(Math.round(xa), 0, 2, hh); g.fillStyle = lp ? BL : '#e6e6e6'; g.fillRect(Math.round(xb) - 2, 0, 2, hh);
        txt(g, 'Start', xa + 4, hh - 6, OR, 9); txt(g, lp ? 'Loop End' : 'End', xb - 4, hh - 6, lp ? BL : INK, 9, 'right'); }
      txt(g, (hm ? (hm.src === 'image' ? 'Gambar: ' : 'Audio: ') + hm.path.split('/').pop() : '') + '  •  ' + frames + ' frame × ' + bins + (m.layout ? ' pita log' : ' partial') + (hm && hm.src === 'image' ? '  •  geser = pan, cubit = zoom' : ''), 6, 12, INK, 10);
    }, { cls: 'hm-map grow', touch: hm && hm.src === 'image' ? { down: (x, y) => ({ x, y, o: { ...(t().inst.hm.opts || {}) } }), move: (x, y, s) => { s.dx = x - s.x; s.dy = y - s.y; },
      up: (s) => { if (!s || (!s.dx && !s.dy)) return; const [w, hh] = map.size(), o = s.o, cw = (o.x1 ?? 1) - (o.x0 ?? 0), chh = (o.y1 ?? 1) - (o.y0 ?? 0), mx = -s.dx / w * cw, my = s.dy / hh * chh;
        const nx0 = Math.max(0, Math.min(1 - cw, (o.x0 ?? 0) + mx)), ny0 = Math.max(0, Math.min(1 - chh, (o.y0 ?? 0) + my)); applyImg({ ...o, x0: nx0, x1: nx0 + cw, y0: ny0, y1: ny0 + chh }); },
      pinch: (sc) => { const o = { ...(t().inst.hm.opts || {}) }, cx = ((o.x0 ?? 0) + (o.x1 ?? 1)) / 2, cy = ((o.y0 ?? 0) + (o.y1 ?? 1)) / 2, cw = Math.max(0.05, Math.min(1, ((o.x1 ?? 1) - (o.x0 ?? 0)) / sc)), ch = Math.max(0.05, Math.min(1, ((o.y1 ?? 1) - (o.y0 ?? 0)) / sc));
        const x0 = Math.max(0, Math.min(1 - cw, cx - cw / 2)), y0 = Math.max(0, Math.min(1 - ch, cy - ch / 2)); pend = { ...o, x0, x1: x0 + cw, y0, y1: y0 + ch }; clearTimeout(pendT); pendT = setTimeout(() => applyImg(pend), 350); } } : null });
    let pend = null, pendT = 0;
    const applyImg = async (o) => { const r = await (await H()).harmorLoadImage(i(), t().inst.hm.path, o); if (r.error) toast(r.error); map.paint(); };
    const mapView = () => { const id = Math.round(k.get(IP(HM_ISLOT.A, HM.MAP_A))); if (!(id >= 0)) return null; const b = eng.sampleBuffers && eng.sampleBuffers(id); if (!b || !b.l || Math.abs(b.l[0] - 4096.5) > 1e-3) return null; return { frames: Math.round(b.l[1]), bins: Math.round(b.l[2]), layout: Math.round(b.l[4]), data: b.l }; };
    const imgOpts = () => (hm && hm.src === 'image' ? hm.opts || {} : {});
    const optBtn = (label, key, vals, names) => { const cur = imgOpts()[key] ?? vals[0]; return h('div', { class: 'hm-chips' }, h('span', { class: 'hm-lab' }, label), ...vals.map((v, q) => h('button', { class: 'hm-chip' + (cur === v ? ' on' : ''), onclick: () => { if (!hm || hm.src !== 'image') { toast('Muat gambar dulu.'); return; } applyImg({ ...imgOpts(), [key]: v }).then(showEd); } }, names[q]))); };
    // the map takes the room (left, full height); a narrow side column holds the source, the play controls and the options (small knobs)
    const loadAudio = async () => { const f = await eng.importFiles('audio/*,.wav,.mp3,.flac,.ogg,.aif,.aiff,.m4a'); if (!f.length) return; const q = Math.round(st.resQ ?? 1);
      const r = await (await H()).harmorLoadAudio(i(), f[0], { quality: q, image: vg }, (x) => { status.textContent = 'Menganalisis ' + Math.round(x * 100) + ' %'; }); if (r.error) toast(r.error, 5000); show(); };
    const loadImage = async () => { if (vg) { toast('Gambar hanya untuk Vokal 1; vokal lain dari audio.'); return; } const f = await eng.importFiles('image/*,.png,.jpg,.jpeg,.webp,.bmp,.gif'); if (!f.length) return; toast('Membuat peta…', 6000); const r = await (await H()).harmorLoadImage(i(), f[0], { seconds: 2 }); toast(r.error || 'Gambar dimuat.'); show(); };
    const rp = hm && hm.src === 'audio' && hm.report;
    const info = h('div', { class: 'hm-report' }, rp ? (rp.pitched ? `${noteName(Math.round(rp.note))} ${rp.hz.toFixed(1)} Hz • ${rp.partials} partial • ${Math.round(rp.voiced * 100)} % bernada` : `Tanpa nada: ${rp.why}`) : hm && hm.src === 'image' ? 'Peta dari gambar' : 'Vokal / instrumen bernada tunggal paling akurat');
    // the vocals of this Harmor: 1..8 (a dot = loaded); the selected one is shown and edited here
    const vocals = h('div', { class: 'hm-chips hm-vocals' }, h('span', { class: 'hm-lab' }, 'Vokal'), ...Array.from({ length: 8 }, (_, q) => { const x = hmAll(q);
      return h('button', { class: 'hm-chip' + (q === vg ? ' on' : '') + (x ? ' has' : ''), title: x ? (x.name || x.path.split('/').pop()) : 'kosong', onclick: () => { st.img = q; show(); } }, String(q + 1) + (x ? ' ' + (x.name || '•') : '')); }));
    const src = h('div', { class: 'hm-imgsrc' }, vocals,
      row(h('button', { class: 'hm-btn prim', onclick: loadAudio }, 'Audio…'), h('button', { class: 'hm-btn', onclick: loadImage }, 'Gambar…'), h('button', { class: 'hm-btn', onclick: async () => { (await H()).harmorClearMap(i(), vg); show(); } }, 'Hapus'),
        h('button', { class: 'hm-btn', title: 'Nama vokal ini (tampil di not piano roll)', onclick: () => { if (!hm) { toast('Muat audio dulu.'); return; } ask('Nama Vokal ' + (vg + 1), hm.name || hm.path.split('/').pop().replace(/\.[^.]+$/, ''), (v) => { const nm = String(v || '').trim().slice(0, 24); if (nm) hm.name = nm; else delete hm.name; P.emit('devices'); show(); }); } }, 'Nama')),
      h('div', { class: 'hm-chips' }, h('span', { class: 'hm-lab' }, 'Kualitas'), ...HM_QUALITY.map((n, q) => h('button', { class: 'hm-chip' + ((st.resQ ?? 1) === q ? ' on' : ''), onclick: () => { st.resQ = q; show(); } }, n))), info);
    const S = { size: 'sm' };
    const play = h('div', { class: 'hm-kgrid' }, knob(IP(HM_ISLOT.START, HM.MAP_START), 'Start', S), knob(IP(HM_ISLOT.END, HM.MAP_END), 'End', S), knob(HM.MAP_SPEED, 'Speed', S), knob(IP(HM_ISLOT.SHIFT, HM.MAP_SHIFT), vg ? 'Shift +' : 'Shift', S),
      knob(HM.MAP_MIX, 'Mix', S), knob(IP(HM_ISLOT.LEVEL, HM.MAP_LEVEL), vg ? 'Level ×' : 'Level', S), knob(IP(HM_ISLOT.NOISE, HM.MAP_NOISE), vg ? 'Noise ×' : 'Noise', S), knob(HM.MAP_FDEV, 'Freq Dev', S));
    const tg = h('div', { class: 'hm-tgrid' }, tog(IP(HM_ISLOT.LOOP, HM.MAP_LOOP), 'Loop', { after: () => map.paint() }), tog(HM.MAP_INTERP, 'Interp'), tog(HM.MAP_FORMANT, 'Formant'), tog(HM.MAP_PHASE, 'Fase'));
    const imgOpt = hm && hm.src === 'image' ? h('div', { class: 'hm-opts' }, optBtn('Peta', 'layout', [0, 1], ['Harm', 'Frek']), optBtn('Gamma', 'gamma', [1, 0.5, 2], ['1', '.5', '2']), optBtn('Rentang', 'rangeDb', [60, 40, 90], ['60', '40', '90']),
      optBtn('Durasi', 'seconds', [2, 1, 4, 8], ['2', '1', '4', '8 s']), optBtn('Stereo', 'stereo', [false, true], ['Mono', 'Warna'])) : null;
    const side = h('div', { class: 'hm-imgside' }, src, play, tg, imgOpt);
    return [h('div', { class: 'hm-img' }, map, side)];
  };

  // ---------------------------------------------------------------- editor: effects rack (only the effects in use; + adds one), advanced
  const fxTab = () => {
    const order = () => { const o = [], used = new Set(); for (let s = 0; s < HM_FX.length; s++) { const q = Math.round(k.get(HM.FX_ORDER + s)); if (q >= 0 && q < HM_FX.length && !used.has(q)) { used.add(q); o.push(q); } } for (let q = 0; q < HM_FX.length; q++) if (!used.has(q)) o.push(q); return o; };
    const on = (q) => k.get(FXP(q, 0)) > 0.5;
    const move = (q, d) => { const o = order(), act = o.filter(on), a = act.indexOf(q), b = a + d; if (a < 0 || b < 0 || b >= act.length) return; const ia = o.indexOf(act[a]), ib = o.indexOf(act[b]); [o[ia], o[ib]] = [o[ib], o[ia]]; o.forEach((x, s) => k.set(HM.FX_ORDER + s, x)); show(); };
    const add = (q) => { const o = order().filter((x) => x !== q), last = o.filter(on).pop(); o.splice(last == null ? 0 : o.indexOf(last) + 1, 0, q); o.forEach((x, s) => k.set(HM.FX_ORDER + s, x)); k.set(FXP(q, 0), 1); show(); };   // a new effect goes after the last one in use
    const act = order().filter(on), free = order().filter((q) => !on(q));
    const addBtn = h('button', { class: 'hm-btn prim hm-fxadd', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); if (!free.length) { toast('Semua efek sudah dipakai.'); return; } menu(free.map((q) => ({ label: HM_FX[q][0], fn: () => add(q) })), r.left, r.bottom + 2); } }, '+ Tambah FX');
    const mods = act.map((q, s) => {
      const [name, type] = HM_FX[q], dp = (DEVICES[type] && DEVICES[type].params) || [];
      const head = h('div', { class: 'hm-fxh' }, h('span', { class: 'hm-fxn' }, String(s + 1)), h('b', {}, name),
        h('button', { class: 'hm-btn sm', title: 'Naik', onclick: () => move(q, -1) }, '▲'), h('button', { class: 'hm-btn sm', title: 'Turun', onclick: () => move(q, 1) }, '▼'),
        h('button', { class: 'hm-btn sm hm-fxx', title: 'Hapus efek', onclick: () => { k.set(FXP(q, 0), 0); show(); } }, '×'));
      return h('div', { class: 'hm-fx' }, head, h('div', { class: 'hm-fxb' }, knob(FXP(q, 1), 'Mix', { size: 'sm' }), ...dp.map((pp, j) => (pp.hidden ? null : knob(FXP(q, 2 + j), pp.n, { size: 'sm' }))).filter(Boolean)));
    });
    return [h('div', { class: 'hm-fxbar' }, addBtn, h('span', { class: 'hm-hint' }, act.length ? act.length + ' efek aktif • urutan = jalur sinyal (atas ke bawah)' : 'Belum ada efek. Ketuk + Tambah FX.')),
      h('div', { class: 'hm-fxlist' }, ...mods)];
  };
  // the plain volume ADSR (used while the Volume articulator is off): a held note of 1 s, then the release
  const adsrDisp = () => disp((g, w, hh) => {
    const A = k.get(HM.ATT), D = k.get(HM.DEC), S = C01(k.get(HM.SUS)), R = k.get(HM.REL), hold = Math.max(A + D, 1), T = (hold + R) * 1.08, top = 18, bot = hh - 16, X = (tt) => 10 + tt / T * (w - 20), Y = (v) => bot - (bot - top) * v;
    const step = [0.05, 0.1, 0.25, 0.5, 1, 2, 5].find((s2) => (w - 20) * s2 / T > 60) || 5;
    for (let tt = 0; tt < T; tt += step) { g.fillStyle = GRID; g.fillRect(Math.round(X(tt)), top, 1, bot - top); txt(g, tt < 1 ? Math.round(tt * 1000) + ' ms' : tt.toFixed(1) + ' s', X(tt) + 2, hh - 4, DIM, 9); }
    g.fillStyle = 'rgba(95,212,245,.08)'; g.fillRect(X(0), top, X(hold) - X(0), bot - top); txt(g, 'nada ditahan', X(hold) - 4, top + 12, BL, 9, 'right');
    const lv = (tt) => (tt < A ? tt / Math.max(1e-4, A) : tt < A + D ? 1 - (1 - S) * (tt - A) / Math.max(1e-4, D) : tt < hold ? S : S * Math.max(0, 1 - (tt - hold) / Math.max(1e-4, R)));
    g.beginPath(); for (let x = 0; x <= w - 20; x += 1.5) { const v = lv(x / (w - 20) * T), y = Y(v); x ? g.lineTo(10 + x, y) : g.moveTo(10 + x, y); } g.strokeStyle = OR; g.lineWidth = 2; g.stroke();
    g.lineTo(w - 10, bot); g.lineTo(10, bot); g.closePath(); g.fillStyle = OR2; g.fill();
    txt(g, `A ${Math.round(A * 1000)} ms  •  D ${Math.round(D * 1000)} ms  •  S ${Math.round(S * 100)} %  •  R ${Math.round(R * 1000)} ms`, w - 8, 12, INK, 10, 'right');
  }, { cls: 'hm-adsr' });
  const advTab = () => [h('div', { class: 'hm-grid' },
    panel('KUALITAS', colm(chips(HM.QUALITY, HM_QUALITY), row(num(HM.PARTIALS, 'Partial'), num(HM.POLY, 'Voices')),
      h('div', { class: 'hm-hint' }, 'Draft 64 / Normal 256 / High 516 partial per voice. Saat banyak voice berbunyi, partial tertinggi dikurangi otomatis agar CPU HP aman.'))),
    panel('VOLUME (saat artikulator Volume off)', row(knob(HM.ATT, 'A'), knob(HM.DEC, 'D'), knob(HM.SUS, 'S'), knob(HM.REL, 'R'))),
    panel('VELOCITY', row(knob(HM.VELS, 'Vel > Vol'), knob(HM.VEL_FLT, 'Vel > Cut')))), panel('VOLUME  •  ADSR', adsrDisp(), { cls: 'wide grow' })];

  // ---------------------------------------------------------------- frame (owner's reference layout): the sound modules on top (pages picked
  // on a vertical strip at the left), the editor under them (ENV HARM IMG FX ADV on its header), the live output spectrum down the right
  const edt = h('span', { class: 'hm-edt' }, '');
  const UP = [['TIMBRE', timbrePage], ['PITCH', pitchPage], ['FILTER', filterPage], ['UNISON', unisonPage], ['MOD', modulesPage]];
  const ED = [['ENV', envTab], ['HARM', harmTab], ['IMG', imgTab], ['FX', fxTab], ['ADV', advTab]];
  if ((st.sec | 0) >= UP.length) { st.ed = (st.sec | 0) - UP.length; st.sec = 0; }   // a page remembered from the one-row layout
  if (st.ed == null) st.ed = 0;
  const mainU = h('div', { class: 'hm-main up' }), mainE = h('div', { class: 'hm-main ed' });
  const tabU = UP.map(([n], q) => h('button', { class: 'hm-pt', onclick: () => { st.sec = q; show(); } }, n));
  const tabE = ED.map(([n], q) => h('button', { class: 'hm-pt', onclick: () => { st.ed = q; show(); } }, n));
  function show() {
    st.sec = Math.max(0, Math.min(UP.length - 1, st.sec | 0)); st.ed = Math.max(0, Math.min(ED.length - 1, st.ed | 0));
    tabU.forEach((b, q) => b.classList.toggle('on', q === st.sec)); tabE.forEach((b, q) => b.classList.toggle('on', q === st.ed));
    mainU.className = 'hm-main up pg-' + UP[st.sec][0].toLowerCase(); mainE.className = 'hm-main ed pg-' + ED[st.ed][0].toLowerCase();
    mainU.replaceChildren(...[].concat(UP[st.sec][1]())); mainE.replaceChildren(...[].concat(ED[st.ed][1]())); mainU.scrollTop = 0; mainE.scrollTop = 0; edt.textContent = ['Artikulator', 'Harmonik', 'Peta gambar / resintesis', 'Efek', 'Lanjutan'][st.ed];
  }
  function redrawAll() { k.redraw && k.redraw(); }
  // the output spectrum: the newest voice's partials, one row per update, scrolling up (frequency across, log 40 Hz .. 16 kHz)
  const specC = h('canvas'), spec = h('div', { class: 'hm-spec' }, specC);
  let sw = 0, sh = 0, sdp = 1;
  const specSize = () => { const W = spec.clientWidth, Hh = spec.clientHeight; if (W < 8 || Hh < 8) return; const d = Math.min(2, window.devicePixelRatio || 1); if (W === sw && Hh === sh && d === sdp) return;
    sw = W; sh = Hh; sdp = d; specC.width = Math.round(W * d); specC.height = Math.round(Hh * d); const g = specC.getContext('2d'); g.fillStyle = '#100c0e'; g.fillRect(0, 0, specC.width, specC.height); };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(specSize).observe(spec);
  function specRow() {
    if (!sw) return; const g = specC.getContext('2d'), W = specC.width, Hh = specC.height, rh = Math.max(2, Math.round(2 * sdp));
    g.drawImage(specC, 0, -rh); g.fillStyle = 'rgba(16,12,14,1)'; g.fillRect(0, Hh - rh, W, rh);
    const n = live.parts.length; if (!n || !live.f0) return;
    for (let q = 0; q < n; q++) { const a = live.parts[q]; if (!(a > 1e-5)) continue; const f = live.f0 * (q + 1); if (f > 16000) break; const x = Math.log(f / 40) / Math.log(400) * W; if (x < 0) continue;
      const v = C01((20 * Math.log10(a * 4) + 60) / 60); g.fillStyle = `rgba(${Math.round(150 + 105 * v)},${Math.round(40 + 60 * v * v)},${Math.round(120 + 100 * v)},${0.25 + 0.75 * v})`; g.fillRect(Math.round(x) - sdp, Hh - rh, 2 * sdp + Math.round(2 * v * sdp), rh); }
  }
  const tr = t(), src = tr && tr.inst && tr.inst.hm ? tr.inst.hm.path.split('/').pop() : 'additive';
  const top = h('div', { class: 'hm-top' }, h('div', { class: 'hm-logo' }, h('b', {}, 'Harmor'), h('small', {}, src)), h('div', { class: 'hm-stat' }, status), meter, knob(HM.VOL, 'Vol'));
  const upper = h('div', { class: 'hm-up' }, h('div', { class: 'hm-pts vert' }, ...tabU), mainU);
  const editor = h('div', { class: 'hm-edz' }, h('div', { class: 'hm-edh' }, edt, h('div', { class: 'hm-pts' }, ...tabE)), mainE);
  const body = h('div', { class: 'hm-body' }, upper, editor, spec);
  const root = h('div', { class: 'hm' }, top, body);
  show();
  return root;
}
