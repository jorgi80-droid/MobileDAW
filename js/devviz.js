// Live-style displays for the device chain: oscillator waveform, filter response curve, modulation sources
// (amp envelope, filter envelope, LFO) and the synth panel layout (Osc | Filter | Mod | Voice | extras).
// Everything drawn here comes from the real engine parameters/formulas (js/engine/dsp.js, instruments.js),
// so what the display shows is what the engine plays. Only sources the engine really has are offered.
import { C } from './theme.js';
import { TWO_PI, clamp, wave4, Biquad } from './engine/dsp.js';
import { buildTables, WT_FRAMES } from './engine/instruments.js';
import { state as PS } from './project.js';

const SR = 48000;
const W = 156, H = 42;                       // size of one display in CSS px (compact panel, see .sp in app.css)
// Display palette: Live keeps its device displays dark in every theme, so curves are always read on the same background.
// These are fixed colours on purpose (not mapped through C()): a light theme only changes the panels around the display.
export const DISP = { bg: '#17171a', grid: '#303035', grid2: '#3a3a40', ink: '#a2a2aa' };

// ---- layout of every synth: which parameter index belongs to which panel (each index exactly once) ----
// osc  : tabs with a waveform display      filt : filter response display       amp / env2 / lfo : "Mod Sources" tabs
// voice: Volume / Poly / Glide / Unison    extra: remaining knobs (arp, effects)
// d / s given as dv / sv are fixed values of the engine (Osphere has no decay/sustain knob).
export const LAYOUT = {
  1: { osc: [{ label: 'Osc', kind: 'wave', wave: 0, knobs: [0] }],
       filt: { cut: 1, poles: 1, q: 0.707, knobs: [1] },
       amp: { a: 2, d: 3, s: 4, r: 5, knobs: [2, 3, 4, 5] }, voice: [6] },
  2: { osc: [{ label: 'Osc', kind: 'saw7', det: 0, mix: 1, knobs: [0, 1] }],
       filt: { cut: 2, poles: 1, q: 0.707, knobs: [2] },
       amp: { a: 3, r: 4, knobs: [3, 4] }, voice: [5] },
  4: { filt: { cut: 3, onepole: true, knobs: [3] }, amp: { a: 1, r: 2, knobs: [1, 2] }, voice: [0, 4, 5] },
  9: { filt: { cut: 3, onepole: true, knobs: [3] }, amp: { a: 1, r: 2, knobs: [1, 2] }, voice: [0, 4, 5] },
  5: { osc: [{ label: 'Osc 1', kind: 'wave', wave: 10, oct: 11, fine: 12, lv: 13, knobs: [10, 11, 12, 13] },
             { label: 'Osc 2', kind: 'wave', wave: 14, oct: 15, fine: 16, lv: 17, knobs: [14, 15, 16, 17] },
             { label: 'Osc 3', kind: 'wave', wave: 18, oct: 19, fine: 20, lv: 21, knobs: [18, 19, 20, 21] }],
       filt: { cut: 2, res: 3, poles: 2, env: 4, knobs: [2, 3] },
       amp: { a: 5, d: 6, s: 7, r: 8, knobs: [5, 6, 7, 8] }, env2: { amt: 4, dec: 6, knobs: [4] },
       voice: [0, 1, 9], extra: { title: 'Arp', knobs: [22, 23, 24, 25, 26] } },
  7: { osc: [{ label: 'Osc A', kind: 'wt', pos: 0, knobs: [0] },
             { label: 'Osc B', kind: 'wt', pos: 1, lv: 2, oct: 3, knobs: [1, 2, 3] }],
       filt: { type: 7, cut: 8, res: 9, poles: 1, env: 10, knobs: [7, 8, 9] },
       amp: { a: 11, d: 12, s: 13, r: 14, knobs: [11, 12, 13, 14] }, env2: { amt: 10, dec: 12, knobs: [10] },
       lfo: { rate: 15, depth: 16, mode: 'uni', target: 'Pos A', knobs: [15, 16] },
       voice: [17, 5, 6, 4] },
  8: { osc: [{ label: 'Layer 1', kind: 'wave', wave: 0, lv: 1, oct: 2, det: 3, knobs: [0, 1, 2, 3] },
             { label: 'Layer 2', kind: 'wave', wave: 4, lv: 5, oct: 6, det: 7, knobs: [4, 5, 6, 7] }],
       filt: { cut: 9, res: 10, poles: 1, motion: { depth: 15 }, knobs: [9, 10] },
       amp: { a: 11, dv: 0.4, sv: 0.85, r: 12, knobs: [11, 12] },
       lfo: { rate: 16, depth: 15, mode: 'bi', target: 'Cutoff', knobs: [16, 15] },
       voice: [17], extra: { title: 'Efek', knobs: [8, 13, 14] } },
};

// every parameter index the layout of one instrument places (used by the self-test)
export function layoutKnobs(type) {
  const L = LAYOUT[type], out = [];
  if (!L) return out;
  for (const o of L.osc || []) out.push(...o.knobs);
  for (const k of ['filt', 'amp', 'env2', 'lfo']) if (L[k]) out.push(...L[k].knobs);
  out.push(...(L.voice || []), ...(L.extra ? L.extra.knobs : []));
  return out;
}

// ---- canvases -------------------------------------------------------------------------------------
export function vizCanvas(w = W, h = H) {
  const d = Math.min(3, window.devicePixelRatio || 1), c = document.createElement('canvas');
  c.width = Math.round(w * d); c.height = Math.round(h * d); c.className = 'viz';
  c.style.width = w + 'px'; c.style.height = h + 'px';
  c._w = w; c._h = h; c._d = d;
  return c;
}
function begin(c) {
  const g = c.getContext('2d');
  g.setTransform(c._d, 0, 0, c._d, 0, 0);
  g.fillStyle = DISP.bg; g.fillRect(0, 0, c._w, c._h);
  return g;
}
const CY = '#5fd0e0', OR = '#ffa722';
// Live 12 handle: a hollow orange ring on the curve (numbered for EQ bands), the curve itself cyan
export function ring(g, x, y, r = 5, label = null) {
  g.beginPath(); g.arc(x, y, r, 0, TWO_PI); g.fillStyle = DISP.bg; g.fill(); g.strokeStyle = OR; g.lineWidth = 1.6; g.stroke();
  if (label != null) { g.fillStyle = OR; g.font = '600 8px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(label), x, y + 0.5); g.textAlign = 'left'; }
}
function line(g, pts, color, fillTo = null, lw = 1.6) {
  g.beginPath(); pts.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = color; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke();
  if (fillTo !== null) { g.lineTo(pts[pts.length - 1][0], fillTo); g.lineTo(pts[0][0], fillTo); g.closePath(); g.fillStyle = color + '28'; g.fill(); }
}
const grid = (g, w, h) => { g.fillStyle = DISP.grid; g.fillRect(0, Math.round(h / 2), w, 1); };

// ---- oscillator displays --------------------------------------------------------------------------
const WAVE_NAMES = ['Saw', 'Square', 'Tri', 'Sine'];
export function drawWave(c, fn, amp = 1, cycles = 2, color = CY) {
  const g = begin(c), w = c._w, h = c._h; grid(g, w, h);
  const pts = [], pad = 5;
  for (let x = 0; x <= w; x += 1.5) { const ph = ((x / w) * cycles) % 1; pts.push([x, h / 2 - fn(ph, (x / w) * cycles) * amp * (h / 2 - pad)]); }
  line(g, pts, color, h / 2);
}
const waveFn = (idx) => (p) => wave4(idx, p, 0.004);
// Super Saw: 7 detuned saws, the spread is exaggerated so the beating is visible in two or three cycles
const SPREAD = [0, -1, 1, -0.66, 0.66, -0.33, 0.33];
function sawStack(det, mix) {
  return (_p, t) => {
    let s = 0, n = 0;
    for (let k = 0; k < 7; k++) {
      const wgt = k ? mix : 1, x = (t * Math.pow(2, (det * SPREAD[k] * 5) / 1200) + k * 0.137) % 1;
      s += wgt * (2 * x - 1); n += wgt;
    }
    return s / Math.max(0.5, n) * 1.15;
  };
}
// Moisture: the real wavetable frame at the chosen position (interpolated between two frames like the engine does)
export function wtFrame(pos) {
  const T = buildTables(), tp = clamp(pos, 0, 1) * (WT_FRAMES - 1), t0 = Math.min(tp | 0, WT_FRAMES - 2), f = tp - t0;
  const a = T.at(t0, 0), b = T.at(t0 + 1, 0), n = 2048;
  const tap = (i) => { i = ((i % n) + n) % n; return T.d[a + i] * (1 - f) + T.d[b + i] * f; };
  return (ph) => { let s = 0; const c = (ph * n) | 0; for (let k = -8; k < 8; k++) s += tap(c + k * 1.4 | 0); return s / 16; };
}

// ---- filter response ------------------------------------------------------------------------------
const F0 = 20, F1 = 20000, DB_TOP = 24, DB_BOT = -36;
function magDb(spec, freqs) {
  const out = new Float64Array(freqs.length);
  let b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  if (spec.onepole) { const g = 1 - Math.exp(-TWO_PI * clamp(spec.f, 10, SR * 0.45) / SR); b0 = g; a1 = -(1 - g); }
  else { const q = new Biquad(); q[spec.type === 1 ? 'highpass' : spec.type === 2 ? 'bandpass' : 'lowpass'](SR, spec.f, spec.q); ({ b0, b1, b2, a1, a2 } = q); }
  const poles = spec.poles || 1;
  for (let i = 0; i < freqs.length; i++) {
    const w = (TWO_PI * freqs[i]) / SR, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
    const db = poles * 10 * Math.log10(Math.max(1e-12, nr * nr + ni * ni) / Math.max(1e-12, dr * dr + di * di));
    out[i] = Number.isFinite(db) ? db : DB_BOT;
  }
  return out;
}
const fx = (f, w) => ((Math.log(f / F0) / Math.log(F1 / F0)) * (w - 2)) + 1;
export function drawFilter(c, spec, sweep = null) {
  const g = begin(c), w = c._w, h = c._h;
  const y = (db) => ((DB_TOP - clamp(db, DB_BOT, DB_TOP)) / (DB_TOP - DB_BOT)) * (h - 4) + 2;
  g.fillStyle = DISP.grid;
  for (const f of [100, 1000, 10000]) g.fillRect(Math.round(fx(f, w)), 0, 1, h);
  g.fillRect(0, Math.round(y(0)), w, 1);
  g.fillStyle = DISP.ink; g.font = '8px system-ui,sans-serif'; g.textBaseline = 'bottom';
  [[100, '100'], [1000, '1k'], [10000, '10k']].forEach(([f, t]) => g.fillText(t, fx(f, w) + 2, h - 1));
  const freqs = new Float64Array(Math.max(8, Math.round(w / 1.5)));
  freqs.forEach((_, i) => { freqs[i] = F0 * Math.pow(F1 / F0, i / (freqs.length - 1)); });
  const curve = (f, color, fill, lw) => {
    const m = magDb({ ...spec, f }, freqs);
    line(g, Array.from(m, (db, i) => [(i / (freqs.length - 1)) * (w - 2) + 1, y(db)]), color, fill ? h : null, lw);
  };
  if (sweep) for (const f of sweep) curve(f, CY + '66', false, 1);          // where the envelope / LFO moves the cutoff to
  curve(spec.f, CY, true, 1.8);
  const m0 = magDb(spec, [spec.f])[0];
  ring(g, fx(spec.f, w), y(m0), 3.8);
}

// ---- modulation sources ---------------------------------------------------------------------------
export function drawAmpEnv(c, a, d, s, r) {
  const g = begin(c), w = c._w, h = c._h, pad = 6;
  const wa = Math.sqrt(a), wd = Math.sqrt(d), wr = Math.sqrt(r), wh = Math.max(0.25, (wa + wd + wr) * 0.35), k = (w - 2 * pad) / (wa + wd + wh + wr);
  const X = [pad, pad + wa * k, pad + (wa + wd) * k, pad + (wa + wd + wh) * k, pad + (wa + wd + wh + wr) * k], sy = pad + (1 - s) * (h - 2 * pad), Y = [h - pad, pad, sy, sy, h - pad];
  line(g, X.map((x, n) => [x, Y[n]]), CY, h - pad);
  for (const n of [1, 2, 3]) ring(g, X[n], Y[n], 3);
}
// Filter envelope as the engine runs it: starts at 1 and decays exponentially (time constant 0.3 x Decay); the cutoff moves Amt x 4 octaves
export function drawFilterEnv(c, amt, decay) {
  const g = begin(c), w = c._w, h = c._h, mid = h / 2; grid(g, w, h);
  const T = Math.max(0.01, decay * 0.3), span = decay * 1.5, pts = [];
  for (let x = 0; x <= w - 4; x += 2) pts.push([x + 2, mid - amt * Math.exp(-(x / (w - 4)) * span / T) * (mid - 6)]);
  line(g, pts, CY, mid);
  ring(g, 4, pts[0][1], 3);
}
export function drawLfo(c, depth, mode) {
  const g = begin(c), w = c._w, h = c._h, pad = 6; grid(g, w, h);
  const pts = [];
  for (let x = 0; x <= w; x += 1.5) {
    const s = Math.sin(TWO_PI * 2 * (x / w));
    pts.push([x, mode === 'uni' ? h - pad - 0.5 * (1 + s) * depth * (h - 2 * pad) : h / 2 - s * depth * (h / 2 - pad)]);
  }
  line(g, pts, CY, mode === 'uni' ? h - pad : h / 2);
}

// ---- Filter device (fx) ---------------------------------------------------------------------------
export function filterDeviceView(D) {            // D: { h, params, get(k), set(k,v), fromNorm, toNorm, refreshKnobs }
  const cv = vizCanvas(176, 54), p = D.params;
  const draw = () => drawFilter(cv, { type: Math.round(D.get(0)), f: D.get(1), q: D.get(2), poles: 1 });
  attachFilterDrag(cv, D, 1, 2, draw);
  draw();
  return { el: cv, draw };
}
// dragging the display moves cutoff (left/right) and resonance (up/down), relative to the touch start
function attachFilterDrag(cv, D, kCut, kRes, redraw) {
  let st = null;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    st = { x: e.clientX, y: e.clientY, c: kCut === null ? 0 : D.toNorm(D.params[kCut], D.get(kCut)), r: kRes === null ? 0 : D.toNorm(D.params[kRes], D.get(kRes)) };
  });
  cv.addEventListener('pointermove', (e) => {
    if (!st) return;
    const dx = (e.clientX - st.x) / cv._w, dy = (st.y - e.clientY) / cv._h;
    if (kCut !== null) D.set(kCut, D.fromNorm(D.params[kCut], st.c + dx));
    if (kRes !== null) D.set(kRes, D.fromNorm(D.params[kRes], st.r + dy * 0.8));
    redraw(); D.refreshKnobs && D.refreshKnobs();
  });
  const end = () => { st = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
}

// v71: output meter for the Volume panel (it had no display, so the column stood half empty). Stereo peak bars of THIS track with a
// -60..+6 dB scale, the same green > yellow > red ramp as the mixer, and a 1.5 s peak hold. Reads the meters the engine already reports.
function drawOutMeter(c, ti, st) {
  const g = begin(c), w = c._w, hh = c._h, x0 = 18, x1 = w - 6, span = x1 - x0, fr = (db) => clamp((db + 60) / 66, 0, 1);
  const now = performance.now(), dt = Math.min(0.1, (now - (st.t || now)) / 1000); st.t = now;
  g.font = '8px system-ui'; g.textBaseline = 'middle'; g.fillStyle = DISP.dim || '#8b8b92';
  for (const db of [-48, -24, -12, -6, 0]) { const x = Math.round(x0 + span * fr(db)) + 0.5; g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(x, 4, 1, hh - 16); g.fillStyle = '#7d7d85'; g.textAlign = 'center'; g.fillText(String(db), x, hh - 6); }
  g.textAlign = 'left';
  for (const ch of [0, 1]) {
    const lv = ti >= 0 ? (PS.meters[ti * 2 + ch] || 0) / 1000 : 0;
    let d = st.d[ch]; d = lv >= d ? lv : d * Math.pow(10, -26 * dt / 20); st.d[ch] = d;
    if (lv > st.pk[ch] || now - st.pt[ch] > 1500) { st.pk[ch] = lv; st.pt[ch] = now; }
    const y = 5 + ch * 11, db = d > 1e-4 ? 20 * Math.log10(d) : -99, len = span * fr(db);
    g.fillStyle = '#0c0c0d'; g.fillRect(x0, y, span, 8);
    if (len > 0) { const gr = g.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, '#4fae3a'); gr.addColorStop(fr(-12), '#8fd16a'); gr.addColorStop(fr(-3), '#f0d84a'); gr.addColorStop(fr(0), '#e5484d'); gr.addColorStop(1, '#e5484d'); g.fillStyle = gr; g.fillRect(x0, y, len, 8); }
    const pk = st.pk[ch] > 1e-4 ? fr(20 * Math.log10(st.pk[ch])) : 0; if (pk > 0) { g.fillStyle = st.pk[ch] > 1 ? '#e5484d' : '#e8e8ec'; g.fillRect(Math.round(x0 + span * pk) - 1, y, 2, 8); }
    g.fillStyle = '#8b8b92'; g.fillText(ch ? 'R' : 'L', 6, y + 4.5);
  }
}

// ---- synth panels ---------------------------------------------------------------------------------
const tabState = new Map();                      // selected tab per track + panel, survives card rebuilds
// D: { type, t, def, h, knob, fmt, get(k), set(k,v), auto(rect,k), fromNorm, toNorm }
export function buildSynth(D) {
  const L = LAYOUT[D.type];
  if (!L) return null;
  const { h, def } = D, P = def.params, v = (k) => D.get(k), f = (k) => fmtS(P[k], v(k)).replace(' ', '');
  const SHORT = { 'Low-pass': 'LP', 'High-pass': 'HP', 'Band-pass': 'BP' }, fmtS = (p, x) => { const r = D.fmt(p, x); return SHORT[r] || r; };
  const allKnobs = [], draws = [];
  const refresh = (knobs) => { for (const d of draws) d(); if (knobs) for (const k of allKnobs) if (k.isConnected) k.update(); };
  const mk = (k) => {
    if (k === 'pitch') { const pk = D.pitch(); pk.classList.add('sm'); allKnobs.push(pk); return pk; }   // Pitch joins the Volume panel
    // v67: the tab above already says which oscillator / layer ("Osc 1", "Layer 2"), so the label drops the "O1 " / "L2 " prefix: "Wave", "Level" fit the 35 px column instead of "O1 Wa..."
    const p0 = P[k], pd = /^[OL]\d\s/.test(p0.n) ? { ...p0, n: p0.n.replace(/^[OL]\d\s/, '') } : p0;
    const kn = D.knob(pd, () => v(k), (x) => { D.set(k, x); refresh(false); }, fmtS, C('#ffa722'), (rect) => D.auto(rect, k));
    kn.classList.add('sm'); allKnobs.push(kn); return kn;
  };
  // one panel: title, optional tab buttons, display canvas, readout line, knobs of the selected tab
  const panel = (title, tabs, key, drag) => {
    const sel = clamp(tabState.get(D.t.id + ':' + key) ?? 0, 0, tabs.length - 1);
    const head = h('div', { class: 'sp-h' }, h('b', {}, tabs.length > 1 ? '' : title));
    const showDisplay = tabs.some((t) => t.draw);
    const cv = showDisplay ? vizCanvas() : null, ro = h('div', { class: 'sp-ro' }), kn = h('div', { class: 'sp-k' });
    let cur = sel;
    const btns = tabs.map((t, n) => h('button', { class: 'st' + (n === cur ? ' on' : ''), onclick: () => show(n) }, t.label));
    if (tabs.length > 1) head.append(...btns);
    const draw = () => { const tb = tabs[cur]; if (cv && tb.draw) tb.draw(cv); ro.textContent = tb.ro ? tb.ro() : ''; };
    function show(n) {
      cur = n; tabState.set(D.t.id + ':' + key, n);
      btns.forEach((b, m) => b.classList.toggle('on', m === n));
      kn.replaceChildren(...tabs[n].knobs.map(mk)); draw();
    }
    kn.replaceChildren(...tabs[cur].knobs.map(mk)); draw(); draws.push(draw);
    if (cv && tabs.some((t) => t.live)) {                     // v71: live display (output meter) - ~30 fps while the panel is on screen, stops once removed
      let seen = false, born = performance.now(), last = 0;
      const quiet = () => { const k = PS.tracks.indexOf(D.t); return !(PS.meters[k * 2] || PS.meters[k * 2 + 1]) && mst.d[0] < 1e-4 && mst.d[1] < 1e-4 && performance.now() - Math.max(mst.pt[0], mst.pt[1]) > 1600; };
      let drawnQuiet = false;   // v73: no canvas work while the panel is hidden, the app is in the background, or the meter has nothing to show
      const loop = (ts) => {
        if (cv.isConnected) seen = true; else if (seen || ts - born > 3000) return;
        if (cv.isConnected && !document.hidden && cv.offsetParent !== null && ts - last > 33) { const q = quiet(); if (!q || !drawnQuiet) { last = ts; draw(); } drawnQuiet = q; }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    if (drag && cv) attachFilterDrag(cv, { ...drag, params: P, get: v, set: (k, x) => D.set(k, x), fromNorm: D.fromNorm, toNorm: D.toNorm, refreshKnobs: () => refresh(true) }, drag.cut, drag.res, () => refresh(false));
    return h('div', { class: 'sp' }, head, cv, showDisplay ? ro : null, kn);
  };

  const out = [];
  // 2) oscillators
  if (L.osc) out.push(panel('Osc', L.osc.map((o) => {
    const wn = o.wave !== undefined ? () => WAVE_NAMES[Math.round(v(o.wave))] : null;
    const bits = () => [wn && wn(), o.oct !== undefined && 'Oct ' + f(o.oct), o.fine !== undefined && f(o.fine), o.det !== undefined && f(o.det), o.lv !== undefined && 'Lvl ' + f(o.lv)].filter(Boolean).join(' \u2022 ');
    if (o.kind === 'wave') return { label: o.label, knobs: o.knobs, ro: bits, draw: (c) => drawWave(c, waveFn(Math.round(v(o.wave))), o.lv !== undefined ? 0.25 + 0.75 * v(o.lv) : 1, 2) };
    if (o.kind === 'saw7') return { label: o.label, knobs: o.knobs, ro: () => `Detune ${f(o.det)} \u2022 Mix ${f(o.mix)}`, draw: (c) => drawWave(c, sawStack(v(o.det), v(o.mix)), 0.9, 3) };
    return { label: o.label, knobs: o.knobs, ro: () => 'Posisi ' + f(o.pos) + (o.lv !== undefined ? ` \u2022 Lvl ${f(o.lv)} \u2022 Oct ${f(o.oct)}` : ''), draw: (c) => drawWave(c, wtFrame(v(o.pos)), o.lv !== undefined ? 0.3 + 0.7 * v(o.lv) : 1, 1, o.label === 'Osc B' ? '#c9a0ff' : CY) };
  }), 'osc'));

  // 3) filter
  const fl = L.filt, fspec = () => ({
    type: fl.type !== undefined ? Math.round(v(fl.type)) : 0, f: v(fl.cut), q: fl.res !== undefined ? v(fl.res) : (fl.q || 0.707), poles: fl.poles, onepole: !!fl.onepole,
  });
  const sweep = () => {
    const f0 = v(fl.cut), lim = (x) => clamp(x, 30, SR * 0.45);
    if (fl.env !== undefined) { const m = v(fl.env); return Math.abs(m) > 0.01 ? [lim(f0 * Math.pow(2, 4 * m))] : null; }
    if (fl.motion) { const m = v(fl.motion.depth); return m > 0.01 ? [lim(f0 * Math.pow(2, -2 * m)), lim(f0 * Math.pow(2, 2 * m))] : null; }
    return null;
  };
  const ftype = () => (fl.onepole ? 'LP 6dB' : ['LP', 'HP', 'BP'][fspec().type] + (fl.poles === 2 ? ' 24dB' : ' 12dB'));
  out.push(panel('Filter', [{ label: 'Filter', knobs: fl.knobs, ro: () => `${ftype()} \u2022 ${f(fl.cut)}${fl.res !== undefined ? ' \u2022 Q ' + f(fl.res) : ''}`, draw: (c) => drawFilter(c, fspec(), sweep()) }], 'filt', { cut: fl.cut, res: fl.res !== undefined ? fl.res : null }));

  // 4) mod sources: Amp / Env 2 / LFO 1 (Env 3 and LFO 2 do not exist in the engine, so they are not offered)
  const mods = [], A = L.amp;
  const av = (k, lit) => (k !== undefined ? v(k) : lit);
  mods.push({ label: 'Amp', knobs: A.knobs, ro: () => [A.a !== undefined && 'A ' + f(A.a), A.d !== undefined && 'D ' + f(A.d), A.s !== undefined && 'S ' + f(A.s), 'R ' + f(A.r)].filter(Boolean).join(' '),
    draw: (c) => drawAmpEnv(c, av(A.a, 0.01), av(A.d, A.dv ?? 0.001), av(A.s, A.sv ?? 1), av(A.r, 0.2)) });
  if (L.env2) mods.push({ label: 'Env 2', knobs: L.env2.knobs, ro: () => `Amt ${v(L.env2.amt).toFixed(2)} \u2022 Decay ${f(L.env2.dec)} \u2022 \u2248 ${(4 * v(L.env2.amt)).toFixed(1)} oktaf`, draw: (c) => drawFilterEnv(c, v(L.env2.amt), v(L.env2.dec)) });
  if (L.lfo) mods.push({ label: 'LFO 1', knobs: L.lfo.knobs, ro: () => `${f(L.lfo.rate)} \u2022 ${f(L.lfo.depth)} \u2192 ${L.lfo.target}`, draw: (c) => drawLfo(c, v(L.lfo.depth), L.lfo.mode) });
  out.push(panel('Mod', mods, 'mod'));

  // 5) Volume / Poly / Glide / Unison, then the remaining controls
  const ti = () => PS.tracks.indexOf(D.t), mst = { d: [0, 0], pk: [0, 0], pt: [0, 0] };
  const outTab = (label, knobs) => ({ label, knobs, live: true, draw: (c) => drawOutMeter(c, ti(), mst), ro: () => { const m = Math.max(mst.pk[0], mst.pk[1]); return 'Output ' + (m > 1e-4 ? (20 * Math.log10(m)).toFixed(1) + ' dB' : '\u2212\u221E dB'); } });
  out.push(panel('Volume', [outTab('Voice', D.pitch ? ['pitch', ...L.voice] : L.voice)], 'voice'));
  if (L.extra) out.push(panel(L.extra.title, [{ label: L.extra.title, knobs: L.extra.knobs }], 'extra'));

  return { el: h('div', { class: 'sps' }, ...out), refresh };
}
