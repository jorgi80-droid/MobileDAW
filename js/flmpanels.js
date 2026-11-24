// FL Studio Mobile instruments in the device view (types 30..33: DirectWave, GMS, MiniSynth, SuperSaw), drawn as Live 12 devices.
// Same tabs and controls as the FLM modules (owner's screenshots). A tab is a row of titled sections; the controls sit in tight two-row
// columns (label / knob / value) and the graphics take all the width the controls leave, at the full section height, so the card (as wide
// as the device panel) is always full, like Live's Auto Filter / Drift / Simpler. The graphics follow the engine's own formulas
// (js/engine/flmsyn.js): filter response, envelopes (drag the handles), LFO with attack / one shot, GMS oscillator output with the
// modulation kind, sample + zone map, unison and chorus voices, arpeggiator pattern / glide, delay taps, distortion / decimator, chorus,
// phaser response, GMS FX X / Y pads (drag the point).
import { h, menu } from './ui.js';
import { M2, M2_TABLES, M2_WARPS, M2_FILTERS, M2_DIST, M2_SUB, M2_LFO_SHAPES, M2_SOURCES, M2_DESTS, m2Bank, m2Text } from './moistdefs.js';
import { lvTabs, lvBtn, lvPath, lvRing, lvEnvPts, DISPC } from './liveui.js';
import { Biquad } from './engine/dsp.js';
import { cutHz, syncBeats, GMS_SCALE, FLM_SYNC } from './engine/flmsyn.js';
import { SS_ARP_BEATS, SS_DELAY_BEATS } from './engine/hdsaw.js';
import { gmShape, GM_RATE_BEATS } from './engine/hdgms.js';
import { MS_RATE_BEATS, MS_RATES, MS_DELAY_BEATS, msRateIndex, msHarmonic, msAttackRate, msDecayRate, msAmpReleaseRate } from './engine/hdmini.js';
import * as P from './project.js';

const SR = 48000, F0 = 20, F1 = 20000, CY = '#4fc3f0', OR = '#ffad32', WH = '#f2f2f2', DIM = '#3d3d42';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lx = (f, w) => Math.log(f / F0) / Math.log(F1 / F0) * w, xl = (x, w) => F0 * Math.pow(F1 / F0, clamp(x / w, 0, 1));
const mag = (b, f) => { const w = 2 * Math.PI * f / SR, c1 = Math.cos(w), c2 = Math.cos(2 * w), s1 = Math.sin(w), s2 = Math.sin(2 * w);
  const nr = b.b0 + b.b1 * c1 + b.b2 * c2, ni = -(b.b1 * s1 + b.b2 * s2), dr = 1 + b.a1 * c1 + b.a2 * c2, di = -(b.a1 * s1 + b.a2 * s2); return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di)); };
const txt = (g, t, x, y, col = DISPC.ink, sz = 9, al = 'left') => { g.fillStyle = col; g.font = `600 ${sz}px system-ui,sans-serif`; g.textAlign = al; g.textBaseline = 'alphabetic'; g.fillText(t, x, y); g.textAlign = 'left'; };
const vl = (g, x, y0, y1, col = DISPC.grid) => { g.fillStyle = col; g.fillRect(Math.round(x), y0, 1, y1 - y0); };
const hl = (g, y, x0, x1, col = DISPC.grid) => { g.fillStyle = col; g.fillRect(x0, Math.round(y), x1 - x0, 1); };
const item = (k, j) => { const p = k.def.params[j]; return (p.items || [])[Math.round(k.get(j) - (p.min || 0))] || ''; };
const fmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + ' kHz' : Math.round(f) + ' Hz');
const fmtS = (s) => (s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s');
const freqAxis = (g, w, hh, top, bot) => {
  for (const f of [50, 200, 500, 2000, 5000]) vl(g, lx(f, w), top, bot, '#2e2e31');
  for (const [f, t] of [[100, '100'], [1000, '1k'], [10000, '10k']]) { vl(g, lx(f, w), top, bot); txt(g, t, lx(f, w), hh - 3, DISPC.ink, 8, 'center'); }
};

// ---- frame: tab strip + page; titled sections; controls --------------------------------------------------------------------------
const TAB = new Map();
function tabs(k, names, pages, leds = {}) {   // leds: { tab index: () => the section is in use } = Live Sampler's tab LEDs
  const key = k.d.id + ':' + k.d.type, page = h('div', { class: 'flm-pg' });
  let raf = 0;
  const refit = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; if (page.isConnected) fit(page); }); };
  const show = (j) => { TAB.set(key, j); page.replaceChildren(...[].concat(pages[j]())); refit(); };
  const cur = Math.min(TAB.get(key) || 0, names.length - 1);
  const tb = lvTabs(names.map((label, j) => ({ label, lit: leds[j] || (() => false) })), cur, show, { cls: 'lk-tabs flm-tabs lk-flmtabs flm-ltabs' }); show(cur); k.reg(tb, -1);
  const root = h('div', { class: 'lk-flm lk-flmpg' }, tb, page);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(refit).observe(root);
  return root;
}
// Zoom of a tab (Live's zoom: everything scales together). Normal panel: 1 (the rows share the height, the displays fill it). A much taller
// panel (maximised) zooms up to 1.35x instead of leaving wide gaps between the rows; a panel lower than the controls zooms down (0.75 min)
// so nothing is cut. Limited by the width: the displays keep their minimum and the card never has to scroll for it.
function fit(page) {
  page.style.zoom = '';
  const H = page.clientHeight, W = page.clientWidth; if (H < 40 || W < 40) return;
  let nat = 0, slack = 0;
  for (const sec of page.children) {
    let gh = 0;
    for (const g of sec.querySelectorAll('.flm-g')) { let one = 0, two = 0; for (const c of g.children) { if (c.classList.contains('flm-span') || c.classList.contains('lk-ch')) two = Math.max(two, c.offsetHeight); else one = Math.max(one, c.offsetHeight); } gh = Math.max(gh, one * 2 + 2, two); }
    if (sec.classList.contains('flm-ds')) {   // Live section: the display's title + rows + the least graph, or its tallest knob column
      const dk = sec.querySelector('.flm-dk'); let dh = 0; if (dk) { for (const c of dk.children) dh += c.classList.contains('flm-dbox') ? 54 : c.offsetHeight + 2; dh += 10; }
      for (const kc of sec.querySelectorAll('.flm-kc')) { let one = 0; for (const c of kc.children) one += (c.classList.contains('lk-fader') ? 84 : c.offsetHeight) + 2; dh = Math.max(dh, one); }
      nat = Math.max(nat, dh + 8); continue;
    }
    const st = sec.querySelector('.flm-st'), cs = getComputedStyle(sec);
    nat = Math.max(nat, (st ? st.offsetHeight + 2 : 0) + gh + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom));
  }
  for (const d of page.querySelectorAll('.flm-dbox')) slack += Math.max(0, d.offsetWidth - (parseFloat(getComputedStyle(d).minWidth) || 0));
  const need = page.scrollWidth - slack, r = H / Math.max(60, nat), zh = r < 1 ? r : r > 1.8 && !page.querySelector('.flm-ds') ? Math.min(1.35, r / 1.5) : 1;   // Live sections keep one text size: their displays take the spare height
  const z = Math.max(0.75, Math.min(zh, W / Math.max(60, need)));
  if (Math.abs(z - 1) > 0.02) page.style.zoom = z.toFixed(3);
}
// a section: consecutive controls fill tight two-row columns (column by column; a lone last control or a vertical list spans both rows),
// displays stretch between them over the free width. o.sw = on / off switch in the title, o.w = share of the free width (default 1).
const tall = (el) => el.classList.contains('flm-span') || (el.classList.contains('lk-ch') && el.classList.contains('v'));
function FS(title, cells, o = {}) {
  const body = h('div', { class: 'flm-b' }); let run = null, n = 0, grow = false;
  const end = () => { if (run && n % 2) run.lastElementChild.classList.add('flm-span'); run = null; n = 0; };
  for (const c of cells) {
    if (!c) continue;
    if (c.classList.contains('flm-dbox')) { end(); body.append(c); grow = true; continue; }
    if (!run) { run = h('div', { class: 'flm-g' }); body.append(run); }
    if (tall(c) && n % 2) { run.lastElementChild.classList.add('flm-span'); n++; }
    run.append(c); n += tall(c) ? 2 : 1;
  }
  end();
  const sec = h('div', { class: 'flm-sec' + (grow ? ' grow' : '') }, h('div', { class: 'flm-st' }, o.sw || null, h('span', {}, title)), body);
  if (o.w) sec.style.flexGrow = String(o.w);
  return sec;
}
const FC = (label, el) => h('div', { class: 'flm-c' }, h('span', { class: 'flm-l' }, label), el);            // list box / number with its label
const FT = (...ts) => h('div', { class: 'flm-c flm-tc' }, ...ts);                                             // switches stacked in one cell
const STACK = (...els) => h('div', { class: 'flm-c flm-tc flm-span' }, ...els);                              // one cell over both rows
const KN = (k, j, n, o = {}) => k.K(j, { n, ...o });
// envelope knobs column by column so the rows read like Live: Attack Decay / Sustain Release
const ADSR = (k, a, d, s, r) => [KN(k, a, 'Attack'), KN(k, s, 'Sustain'), KN(k, d, 'Decay'), KN(k, r, 'Release')];
const SEL = (k, j, label, w = 84) => FC(label, k.S(j, { w }));
const TG = (k, j, label, w = 76) => k.T(j, label, { w });
const CHV = (k, j, labels) => k.CH(j, labels, { v: true, cls: 'sm' });
const SW = (k, j) => k.T(j, '', { cls: 'flm-sw', w: 14 });
// ---- Live device sections (the redesign): the main knobs in a column, then a dark display that holds the section's title, its graph
// and, under the graph, the secondary values as orange numbers / menus / switches (Operator, Wavetable, Delay of Live 12)
const NUM = (k, j, label, w = 50) => h('div', { class: 'lk-tl' }, h('span', { class: 'lk-lb' }, label), k.NT(j, { w, cls: 'or' }));
const MEN = (k, j, label, w = 76) => h('div', { class: 'lk-tl' }, h('span', { class: 'lk-lb' }, label), k.S(j, { w }));
const CHH = (k, j, labels) => k.CH(j, labels, { cls: 'flm-chh' });
const ADSRN = (k, a, d, s, r) => [NUM(k, a, 'Attack'), NUM(k, d, 'Decay'), NUM(k, s, 'Sustain'), NUM(k, r, 'Release')];
function DS(title, o = {}) {
  const dk = h('div', { class: 'lk-dk flm-dk' }, h('div', { class: 'flm-dt' }, o.sw || null, h('span', {}, title)), o.g || null,
    ...(o.rows || []).map((r) => (r instanceof Node ? r : h('div', { class: 'lk-row flm-dr' }, ...r.filter(Boolean)))));
  const col = (list) => (list ? [h('div', { class: 'lk-col flm-kc' }, ...list.filter(Boolean))] : []);
  const sec = h('div', { class: 'flm-sec flm-ds grow' }, ...col(o.k), dk, ...col(o.r));
  if (o.w) sec.style.flexGrow = String(o.w);
  return sec;
}
const OUT = (k, lvl, pan) => h('div', { class: 'flm-sec flm-ds flm-out' }, h('div', { class: 'lk-col flm-kc' }, k.F(lvl, { n: 'Level', w: 56 })), ...(pan != null ? [h('div', { class: 'lk-col flm-kc' }, KN(k, pan, 'Pan'))] : []));
const lfoRateN = (k, modeK, rateK, syncK) => k.swapN(modeK, (m) => (m === 2 ? MEN(k, syncK, 'Rate', 70) : NUM(k, rateK, 'Rate', 56)));
const lfoRate = (k, modeK, rateK, syncK) => k.swapN(modeK, (m) => (m === 2 ? FC('Rate', k.S(syncK, { w: 70 })) : k.K(rateK, { n: 'Rate' })));

// display that fills its box (the free width, the section height); redrawn sharp at any size, zoom or pixel density
function disp(k, draw, drag, o = {}) {
  const c = k.D(160, 100, () => {}, drag), box = h('div', { class: 'flm-dbox' }, c);
  if (o.min) box.style.minWidth = o.min + 'px';
  if (o.w) box.style.flexGrow = String(o.w);
  let w = 0, hh = 0, sc = 1;
  c.paint = () => { if (!w || !c.isConnected) return; const g = c.getContext('2d'); g.setTransform(sc, 0, 0, sc, 0, 0); g.fillStyle = DISPC.bg; g.fillRect(0, 0, w, hh); g.save(); k.inDraw(() => draw(g, w, hh)); g.restore(); };
  const size = () => {
    const W = Math.floor(box.clientWidth), H = Math.floor(box.clientHeight); if (W < 8 || H < 8) return;
    const r = box.getBoundingClientRect(), z = box.offsetWidth > 0 && r.width > 0 ? r.width / box.offsetWidth : 1, s = Math.min(4, (window.devicePixelRatio || 1) * z);
    if (W === w && H === hh && Math.abs(s - sc) < 0.01) return;
    w = W; hh = H; sc = s; c.width = Math.round(w * sc); c.height = Math.round(hh * sc); c.style.width = w + 'px'; c.style.height = hh + 'px'; c._w = w; c._h = hh; c.paint();
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(size).observe(box); else requestAnimationFrame(size);
  box.cv = c;
  return box;
}

// ---- envelopes: curve over a time grid with handles at the attack peak, the decay / sustain corner and the release end (Live: Drift,
// Operator). Drag a handle: time left / right (x2 per 28 px), sustain up / down. s == null: attack / decay envelope (GMS mod envelope);
// s == 'hold': attack, held at the peak while the key is down (dashed key-up line), Decay after the release (GMS filter, FLM manual).
function envPts(w, hh, A, D, S, R, pad, hold) {                                 // top margin 2 x pad: the label line stays clear of the curve
  if (hold) { const wa = Math.sqrt(A), wd = Math.sqrt(D), kx = (w - 2 * pad) * 0.62 / Math.max(1e-6, wa + wd), x1 = pad + wa * kx, x2 = x1 + (w - 2 * pad) * 0.3;
    return [[pad, hh - pad], [x1, 2 * pad], [x2, 2 * pad], [x2 + wd * kx, hh - pad], [w - pad, hh - pad]]; }
  if (S == null) { const wa = Math.sqrt(A), wd = Math.sqrt(D), kx = (w - 2 * pad) * 0.82 / Math.max(1e-6, wa + wd);
    return [[pad, hh - pad], [pad + wa * kx, 2 * pad], [pad + (wa + wd) * kx, hh - pad], [w - pad, hh - pad]]; }
  return lvEnvPts(w, hh - pad, A, D, S, R, pad).map(([x, y]) => [x, y + pad]);
}
// law (optional): { a, d, r } = knob value -> seconds, for envelopes whose knobs are sliders (FLM MiniSynth); the handles then move the
// knobs linearly instead of scaling a time
function env(k, a, d, s, r, col = CY, lab = null, law = null) {
  const PAD = 9, lim = (j, v) => clamp(v, k.def.params[j].min, k.def.params[j].max), hold = s === 'hold';
  if (hold) s = null;
  const T = (j, f) => (law ? f(k.get(j)) : k.get(j));
  const pts = (w, hh) => envPts(w, hh, T(a, law && law.a), T(d, law && law.d), s == null ? null : k.get(s), r == null ? 0 : T(r, law && law.r), PAD, hold);
  const hs = (q) => (hold ? [[1, q[1]], [2, q[3]]] : s == null ? [[1, q[1]], [2, q[2]]] : [[1, q[1]], [2, q[2]], [4, q[4]]]);
  let box = null;
  box = disp(k, (g, w, hh) => {
    for (let j = 1; j < 8; j++) vl(g, w * j / 8, 0, hh, j % 2 ? '#2e2e31' : DISPC.grid);
    hl(g, hh - PAD, 0, w, DISPC.grid2);
    const q = pts(w, hh);
    if (s != null) { g.setLineDash([2, 3]); g.strokeStyle = DISPC.grid2; g.lineWidth = 1; g.beginPath(); g.moveTo(q[2][0], q[2][1] + 0.5); g.lineTo(w, q[2][1] + 0.5); g.stroke(); g.setLineDash([]); }
    if (hold) { g.setLineDash([2, 3]); g.strokeStyle = DISPC.grid2; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(q[2][0]) + 0.5, PAD); g.lineTo(Math.round(q[2][0]) + 0.5, hh - PAD); g.stroke(); g.setLineDash([]); txt(g, 'key up', q[2][0] + 3, hh - PAD - 3, DISPC.ink, 8); }
    lvPath(g, q, col, hh - PAD, 1.9);
    for (const [, p] of hs(q)) lvRing(g, p[0], p[1], 4.2);
    if (lab) txt(g, lab(), w - 6, 13, col, 9, 'right');
  }, {
    onDown: (x, y) => { const c = box.cv, q = pts(c._w, c._h); let n = 1, bd = 1e9; for (const [m, p] of hs(q)) { const dd = Math.hypot(p[0] - x, p[1] - y); if (dd < bd) { bd = dd; n = m; } }
      return { n, A: k.get(a), D: k.get(d), S: s == null ? 0 : k.get(s), R: r == null ? 0 : k.get(r), H: c._h }; },
    onMove: (x, y, dx, dy, st) => { const f = Math.pow(2, dx / 28);
      if (law) { if (st.n === 1) k.set(a, lim(a, st.A + dx * 0.6)); else if (st.n === 2) { k.set(d, lim(d, st.D + dx * 0.6)); if (s != null) k.set(s, clamp(st.S - dy / Math.max(20, st.H - 3 * PAD), 0, 1)); } else if (r != null) k.set(r, lim(r, st.R + dx * 0.6)); return; }
      if (st.n === 1) k.set(a, lim(a, st.A * f));
      else if (st.n === 2) { k.set(d, lim(d, st.D * f)); if (s != null) k.set(s, clamp(st.S - dy / Math.max(20, st.H - 3 * PAD), 0, 1)); }
      else if (r != null) k.set(r, lim(r, st.R * f)); },
  });
  return box;
}

// ---- filter response in dB over a log frequency axis, handle at the cutoff; drag: cutoff (x) / resonance (y).
// type(): -1 off, 0 low-pass, 1 high-pass, 2 band-pass; two(): 24 dB slope (GMS LP 24: two stages, half resonance each, as the engine)
function filt(k, cut, res, type, two, hzOf) {
  let box = null;
  box = disp(k, (g, w, hh) => {
    const top = 4, bot = hh - 13, Y = (db) => top + (18 - clamp(db, -48, 18)) / 66 * (bot - top);
    freqAxis(g, w, hh, top, bot); hl(g, Y(0), 0, w, DISPC.grid2);
    const t = type(), f = hzOf ? hzOf(k.get(cut)) : cutHz(k.get(cut)), dbl = !!(two && two()), q = 0.5 + Math.pow(k.get(res) / 100 * (dbl ? 0.5 : 1), 2) * 18, bq = new Biquad();
    if (t < 0) { lvPath(g, [[0, Y(0)], [w, Y(0)]], DISPC.grid2, bot, 1.6); txt(g, 'Filter Off', 6, 13); return; }
    if (t === 1) bq.highpass(SR, f, q); else if (t === 2) bq.bandpass(SR, f, q); else bq.lowpass(SR, f, q);
    const dbAt = (x) => 20 * Math.log10(Math.max(1e-6, mag(bq, x))) * (dbl ? 2 : 1), pts = [];
    for (let x = 0; x <= w; x += 2) pts.push([x, Y(dbAt(xl(x, w)))]);
    lvPath(g, pts, CY, bot, 1.9); lvRing(g, lx(f, w), Y(dbAt(f)), 5);
    txt(g, fmtHz(f), 6, 13); txt(g, ['Low-pass', 'High-pass', 'Band-pass'][t] + (dbl ? ' 24' : ''), w - 6, 13, DISPC.ink, 9, 'right');
  }, { onDown: () => ({ c: k.get(cut), r: k.get(res) }), onMove: (x, y, dx, dy, s) => { const W = box.cv._w || 150; k.set(cut, clamp(s.c + dx / (W / 100), 0, 100)); k.set(res, clamp(s.r - dy * 0.8, 0, 100)); } });
  return box;
}

// ---- LFO: two cycles at the set rate (label), height = amount (negative = inverted), attack fade-in and One Shot hold as the engine
// plays them; the full-size wave shows faintly behind. o: shape, amt, mode (Hertz / One Shot / Tmp Sync), rate (Hz), sync (tempo list), att
function lfo(k, o) {
  return disp(k, (g, w, hh) => {
    const sh = Math.round(k.get(o.shape)), a = o.amt == null ? 1 : o.depth ? o.depth(k.get(o.amt)) : k.get(o.amt) / 100, mode = o.mode == null ? 2 : Math.round(k.get(o.mode));
    const per = mode === 2 ? (o.beats ? o.beats(k.get(o.sync)) : syncBeats(k.get(o.sync))) * 60 / (P.state.bpm || 120) : 1 / Math.max(0.01, k.get(o.rate));
    const span = (mode === 1 ? 1.5 : 2) * per, att = o.att == null ? 0 : k.get(o.att), mid = hh / 2, amp = mid - 10;
    for (let j = 1; j < 4; j++) vl(g, w * j / 4, 0, hh); hl(g, mid, 0, w, DISPC.grid2);
    const ghost = [], live = [];
    for (let x = 0; x <= w; x++) {
      const t = x / w * span; let p = t / per, c = Math.floor(p);
      if (mode === 1 && p >= 1) { p = 0.9999; c = 0; } else p -= c;
      let rv = Math.sin((c + 1) * 78.233) * 43758.5453; rv = (rv - Math.floor(rv)) * 1.8 - 0.9;
      const v = sh === 0 ? Math.sin(2 * Math.PI * p) : sh === 1 ? 1 - 2 * p : sh === 2 ? (p < 0.5 ? 1 : -1) : rv, ramp = att > 0.0005 ? Math.min(1, t / att) : 1;
      ghost.push([x, mid - v * amp]); live.push([x, mid - v * a * ramp * amp]);
    }
    lvPath(g, ghost, DIM, null, 1.2); lvPath(g, live, OR, null, 1.9);
    txt(g, mode === 2 ? item(k, o.sync) : mode === 1 ? 'One Shot ' + k.get(o.rate).toFixed(2) + ' Hz' : k.get(o.rate).toFixed(2) + ' Hz', 6, 13);
    if (att > 0.0005) txt(g, 'Attack ' + fmtS(att), w - 6, 13, DISPC.ink, 9, 'right');
  });
}

// ---- GMS oscillators (js/engine/hdgms.js): A (white, faint), B (cyan, faint) and the sum (bright) with the balance (A g (1 - |b|), B g b)
// and the osc mod as the engine computes it: Ring (A x (1 + 3 m B)), FM (A read at its phase + (B + 1) m cycles), Sync (A runs 2^m faster
// and restarts with B), Filter (B moves the cutoff: not a waveform change)
function gmsOsc(k) {
  return disp(k, (g, w, hh) => {
    const o = 63 * 1024, A = gmShape(k.get(7)), B = gmShape(k.get(8)), N = 1024, rd = (t, p) => t[o + Math.floor((p - Math.floor(p)) * N) % N];   // the 64-harmonic tables
    const ratio = Math.pow(2, (Math.round(k.get(9)) + k.get(10) / 100) / 12), ph0 = k.get(11), bal = clamp(k.get(12) / 100, -1, 1), kind = Math.round(k.get(15)), m = clamp(k.get(14) / 100, 0, 1), act = m > 0.001;
    const mid = hh / 2, pa = [], pb = [], po = [], va = [], vb = [], vo = [];
    vl(g, w / 2, 0, hh); hl(g, mid, 0, w, DISPC.grid2);
    for (let x = 0; x <= w; x++) {
      const p = x / w * 2, q = ph0 + p * ratio, b = rd(B, q), a0 = rd(A, p);
      let a = a0;
      if (act && kind === 1) a = rd(A, p + (b + 1) * m); else if (act && kind === 0) a = a0 * (1 + 3 * m * b);
      else if (kind === 2) { const bp = p * ratio; a = rd(A, (bp - Math.floor(bp)) / ratio * Math.pow(2, m)); }
      va.push(a0); vb.push(b); vo.push((1 - Math.abs(bal)) * a + bal * b);
    }
    const pk = Math.max(0.05, ...va.map(Math.abs), ...vb.map(Math.abs), ...vo.map(Math.abs)), amp = (mid - 18) / pk;
    for (let x = 0; x <= w; x++) { pa.push([x, mid - va[x] * amp]); pb.push([x, mid - vb[x] * amp]); po.push([x, mid - vo[x] * amp]); }
    lvPath(g, pa, 'rgba(242,242,242,.25)', null, 1.2); lvPath(g, pb, 'rgba(79,195,240,.4)', null, 1.2); lvPath(g, po, WH, null, 1.8);
    const ta = 'A ' + item(k, 7); txt(g, ta, 6, 13, WH); g.font = '600 9px system-ui,sans-serif'; txt(g, 'B ' + item(k, 8), 18 + g.measureText(ta).width, 13, CY);
    txt(g, item(k, 15) + ' ' + Math.round(m * 100), w - 6, 13, OR, 9, 'right');
  });
}
// ---- MiniSynth: the oscillator kind's wave with the Modifier applied, the same formulas as the engine (Saw: square width 0 at 0 / 100,
// second wave -24..+24 st, Pulse: two squares cancelling at 0 / 100, SuperSaw detune, spread voices), drawn at full height
const SS8 = [0, -1, 1, -0.6, 0.6, -0.3, 0.3, -0.85];
// MiniSynth oscillator: two cycles of the OSC Kind as the engine sums it from FLM's base wave (js/engine/hdmini.js: one table, read at
// fixed offsets or intervals), the Modifier's meaning for that kind as the label
let MSW = null;
function msWave() {                                                             // the base wave with 48 harmonics, 512 points (display only)
  if (MSW) return MSW;
  MSW = new Float32Array(512);
  for (let h = 1; h <= 48; h++) { const [mg, ph] = msHarmonic(h); for (let n = 0; n < 512; n++) MSW[n] += mg * Math.cos(ph + 2 * Math.PI * h * n / 512); }
  return MSW;
}
const MS_SPREAD = [-0.05, -0.0375, -0.025, -0.0125, 0, 0.0125, 0.025, 0.0375];
function miniWave(k) {
  return disp(k, (g, w, hh) => {
    const kind = Math.round(k.get(0)), m = clamp(k.get(1) / 100, 0, 1), T = msWave(), S = (p) => { const x = (p - Math.floor(p)) * 512, i = Math.floor(x), f = x - i; return T[i] + (T[(i + 1) % 512] - T[i]) * f; };
    const st = Math.trunc(Math.fround(Math.fround(m) * 2 - 1) * 12), r = Math.pow(2, st / 12 + 0.00625), d = 1 - m, mid = hh / 2, vs = [];
    vl(g, w / 2, 0, hh); hl(g, mid, 0, w, DISPC.grid2);
    for (let x = 0; x <= w; x++) {
      const p = x / w * 2; let v;
      switch (kind) {
        case 0: v = 2 * S(p) - S(p + d); break; case 1: v = S(p) + S(p * r); break; case 2: v = S(p) - S(p + d); break;
        case 3: v = S(p) - S(p + 0.5) + S(p * r); break; case 4: v = S(p) - S(p + 0.5625) + S(p * r) - S(p * r + 0.5625); break;
        case 5: v = 0; for (let u = 0; u < 8; u++) v += 0.5 * S(p * (1 + m * MS_SPREAD[u]) + u * 0.137); break;
        case 6: v = S(p); for (let u = 1; u <= 5; u++) v += S(p + u * m / 2); v *= 0.5; break;
        case 7: v = S(p) + S(p + d); break;
        case 8: v = S(p * (0.5 - 0.005 * m)) + S(p) + S(p * (2 + 0.02 * m)); break;
        default: v = S(p * (1.5 - 0.015 * m)) + S(p) + S(p * (2 + 0.02 * m));
      }
      vs.push(v);
    }
    const pk = Math.max(0.05, ...vs.map(Math.abs)), A = mid - 18;
    lvPath(g, vs.map((v, x) => [x, mid - v / pk * A]), WH, null, 1.8);
    const info = kind === 0 || kind === 2 || kind === 7 ? (kind === 2 && (m <= 0 || m >= 1) ? 'Cancelled (silent)' : 'Offset ' + Math.round(d * 100) + ' %')
      : kind === 1 || kind === 3 || kind === 4 ? (st > 0 ? '+' : '') + st + ' st' : kind === 5 ? 'Detune ' + Math.round(m * 100) : 'Modifier ' + Math.round(m * 100);
    txt(g, item(k, 0), 6, 13, WH); txt(g, info, w - 6, 13, OR, 9, 'right');
  });
}
// ---- SuperSaw oscillator: one voice (saw / pulse, Supersync with the sync amount and its own pulse width) and the sub oscillator
function ssWave(k) {
  return disp(k, (g, w, hh) => {
    const pm = k.get(0) > 0.5, sync = Math.round(k.get(1)) === 1, pw = sync ? clamp(k.get(11) / 100, 0, 1) * 0.5 : clamp(k.get(3) / 100, 0, 1) * 0.5, r2 = 1 + 5 * clamp(k.get(10) / 100, 0, 1), sb = clamp(k.get(4) / 100, 0, 1), sub = sb * sb < 0.001 ? 0 : sb * sb;   // hdsaw.js: Supersync = R = 1 + 5 S slave pulses of width W / 2; sub level = knob squared
    const mid = hh / 2, amp = mid - 18, pts = [], sp = [];
    vl(g, w / 2, 0, hh); hl(g, mid, 0, w, DISPC.grid2);
    for (let x = 0; x <= w; x++) {
      const p = x / w * 2, q = p - Math.floor(p); let v;
      if (sync) { const s = (q * r2) % 1; v = s < pw ? 1 : -1; } else v = pm ? (pw <= 1e-4 ? 0 : q < pw ? 2 * pw - 2 : 2 * pw) : 2 * q - 1;
      pts.push([x, mid - v * amp]); const s2 = p / 2; sp.push([x, mid - (2 * (s2 - Math.floor(s2)) - 1) * amp * sub]);
    }
    if (sub > 0) lvPath(g, sp, 'rgba(255,173,50,.6)', null, 1.3);
    lvPath(g, pts, WH, null, 1.8);
    txt(g, (sync ? 'Supersync · ' + r2.toFixed(2) + 'x' : 'Supersaw') + (pm && !sync ? ' · Pulse ' + Math.round(pw * 100) + ' %' : ''), 6, 13, WH); if (sub > 0) txt(g, 'Sub ' + Math.round(sub * 100), w - 6, 13, OR, 9, 'right');
  });
}
// ---- voices in the stereo field: x = pan, y = pitch offset; SuperSaw unison (detune in cents, spread curve, unison pan) and GMS
// voices (scale intervals + chorus detune / stereo, keyboard below with the notes a C4 plays)
function ssUnison(k) {
  return disp(k, (g, w, hh) => {
    const nu = clamp(Math.round(k.get(5)) + 1, 1, 12), dk = clamp(k.get(6) / 100, 0, 1), det = dk * dk, upan = clamp(k.get(7) / 100, 0, 1), cv = 2 * clamp(k.get(8) / 100, 0, 1) - 1, ex = 1 + cv * (cv >= 0 ? 4 : 0.9), mid = hh / 2, A = mid - 16;   // hdsaw.js: +-Detune^2 semitones, voice k at 2 x^e - 1
    vl(g, w / 2, 4, hh - 4, DISPC.grid2); hl(g, mid, 0, w, DISPC.grid2); hl(g, mid - A, 0, w); hl(g, mid + A, 0, w);
    txt(g, '+100 ct', 6, mid - A - 3); txt(g, '-100 ct', 6, mid + A + 11); txt(g, 'L', 6, mid - 4, DISPC.ink, 9); txt(g, 'R', w - 6, mid - 4, DISPC.ink, 9, 'right');
    for (let u = 0; u < nu; u++) {
      const xu = nu === 1 ? 0.5 : u / (nu - 1), x0 = 2 * xu - 1, off = nu === 1 ? 0 : 2 * Math.pow(xu, ex) - 1, px = w / 2 + (nu > 1 && upan >= 0.001 ? x0 * upan : 0) * (w / 2 - 16), py = mid - off * det * A;
      g.fillStyle = 'rgba(79,195,240,.5)'; g.fillRect(Math.round(px), Math.min(mid, py), 1, Math.abs(py - mid)); lvRing(g, px, py, 4);
    }
    txt(g, nu === 1 ? 'Single' : nu + ' voices', w - 6, 13, WH, 9, 'right');
  });
}
function gmsVoices(k) {
  return disp(k, (g, w, hh) => {
    const nv = clamp(Math.round(k.get(45)) + 1, 1, 4), sc = GMS_SCALE[clamp(Math.round(k.get(46)), 0, 2)].map((x, u) => (u % 2 ? x : 0)), det = k.get(41) / 100 * 0.5,   // odd copies x 1.5 (Chord, +7 st) or x 2 (Octave, +12 st); Detune = the spread in semitones
      wide = k.get(42) / 100, tr = Math.round(k.get(39));
    const kb = clamp(Math.round(hh * 0.3), 18, 34), fh = hh - kb - 3, Y = (st) => 8 + (38 - st) / 44 * (fh - 16);
    vl(g, w / 2, 4, fh, DISPC.grid2);
    for (const [st, t] of [[36, '+36'], [24, '+24'], [12, '+12'], [0, '0']]) { hl(g, Y(st), 0, w, st ? DISPC.grid : DISPC.grid2); txt(g, t, 4, Y(st) - 2, DISPC.ink, 8); }
    const vs = [];
    for (let u = 0; u < nv; u++) { const st = sc[u] + (u ? (u & 1 ? 1 : -1) * det * Math.ceil(u / 2) : 0), sp = nv > 1 ? (u / (nv - 1) * 2 - 1) * wide : 0; vs.push(st); const px = w / 2 + sp * (w / 2 - 22), py = Y(st); lvRing(g, px, py, 4.5); txt(g, (sc[u] > 0 ? '+' : '') + sc[u], px + 7, py + 3, CY, 8); }
    // keyboard C3..C7 (49 keys): the notes a C4 plays (transpose + intervals)
    const y0 = hh - kb, lo = 48, nK = 49, nW = 29, kw = w / nW, on = new Set(vs.map((st) => 60 + tr + Math.round(st)));
    let wi = 0;
    for (let n = lo; n < lo + nK; n++) { if ([1, 3, 6, 8, 10].includes(n % 12)) continue; g.fillStyle = on.has(n) ? CY : '#d8d8dc'; g.fillRect(Math.round(wi * kw) + 0.5, y0, Math.max(1, Math.round(kw) - 1), kb); wi++; }
    wi = 0;
    for (let n = lo; n < lo + nK; n++) { if ([1, 3, 6, 8, 10].includes(n % 12)) { g.fillStyle = on.has(n) ? CY : '#1c1c1e'; g.fillRect(Math.round(wi * kw - kw * 0.3), y0, Math.max(1, Math.round(kw * 0.6)), kb * 0.6); } else wi++; }
    txt(g, item(k, 46) + ' · ' + item(k, 45), w - 6, 12, WH, 9, 'right');
  });
}
// ---- DirectWave: waveform of the first zone with a sample (reversed with Reverse, loop bar with Loop), zone map below (each zone's key
// range on a 128-key strip, root in orange: DirectWave's zone list as a picture)
function dwSample(k) {
  const i = k.ctx.i;
  return disp(k, (g, w, hh) => {
    const t = P.state.tracks[i], zs = (t && t.inst && t.inst.zones) || [], kb = 18, wh = hh - kb - 2, mid = wh / 2 + 1;
    const zi = zs.findIndex((z) => z && z.sample), z = zs[zi], s = z && z.sample;
    hl(g, mid, 0, w, DISPC.grid2);
    if (!s) { g.strokeStyle = WH; g.lineWidth = 2; g.beginPath(); g.moveTo(w / 2 - 9, mid - 16); g.lineTo(w / 2 + 9, mid - 16); g.moveTo(w / 2, mid - 25); g.lineTo(w / 2, mid - 7); g.stroke(); txt(g, 'Ketuk untuk menambahkan sample', w / 2, mid + 14, DISPC.ink, 10, 'center'); }
    else {
      const pk = s.peaks || [], n = pk.length, rev = k.get(8) > 0.5, A = mid - 12;
      g.fillStyle = 'rgba(79,195,240,.82)';
      for (let x = 0; x < w; x++) { const j = Math.floor((rev ? w - 1 - x : x) / w * n), a = Math.min(1, Math.abs(pk[j] || 0)), hg = Math.max(0.5, a * A); g.fillRect(x, mid - hg, 1, hg * 2); }
      if (k.get(9) > 0.5 || z.loop) { g.fillStyle = OR; g.fillRect(0, 1, w, 2); txt(g, 'Loop', w - 6, 14, OR, 9, 'right'); }
      txt(g, s.name + (zs.length > 1 ? `  ·  zona ${zi + 1} / ${zs.length}` : '') + (rev ? '  ·  Reverse' : ''), 6, 14, WH, 9);
      if (s.duration) txt(g, fmtS(s.duration), w - 6, wh - 4, DISPC.ink, 9, 'right');
    }
    const y0 = hh - kb, X = (m) => m / 128 * w;
    g.fillStyle = '#1c1c1e'; g.fillRect(0, y0, w, kb);
    for (let m = 0; m <= 120; m += 12) { vl(g, X(m), y0, hh, '#3a3a3e'); if (m % 24 === 0) txt(g, 'C' + (m / 12 - 1), X(m) + 2, hh - 3, DISPC.ink, 8); }
    zs.forEach((q, j) => { if (!q) return; const x0 = X(q.lo), x1 = X(q.hi + 1); g.fillStyle = j === zi ? 'rgba(79,195,240,.5)' : 'rgba(79,195,240,.28)'; g.fillRect(x0, y0 + 2, Math.max(2, x1 - x0), kb - 4); g.fillStyle = OR; g.fillRect(X(q.root), y0, Math.max(2, X(1)), kb); });
  }, { onDown: () => ({ moved: false }), onMove: (x, y, dx, dy, st) => { if (Math.abs(dx) + Math.abs(dy) > 8) st.moved = true; },   // tap: add a sample (empty) or edit the zone
    onUp: (x, y, st) => { if (st.moved) return; const t = P.state.tracks[i], zs = (t && t.inst && t.inst.zones) || [], zi = Math.max(0, zs.findIndex((z) => z && z.sample)); document.dispatchEvent(new CustomEvent('mdaw-zone', { detail: { i, k: zi } })); } });
}
// ---- effects ----------------------------------------------------------------------------------------------------------------------
// delay taps over the beat grid: dry (grey), then each repeat at the tempo time, height = mix x feedback^n, fading with the filter
function taps(k, o) {
  return disp(k, (g, w, hh) => {
    const on = o.on == null || k.get(o.on) > 0.5, bt = o.beats ? o.beats(k.get(o.time)) : syncBeats(k.get(o.time)), fb = clamp(k.get(o.fb) / 100 * (o.flm ? 1 : 0.9), 0, o.flm ? 0.999 : 0.95), damp = o.flm ? clamp(1 - k.get(o.filt) / 100, 0, 0.98) : clamp(k.get(o.filt) / 100, 0, 0.98), mix = o.flm ? (k.get(o.mix) / 100) ** 2 : k.get(o.mix) / 100;   // flm: MiniSynth's laws (feedback as is, the loop low-pass opens with Filter, mix squared)
    const span = clamp(bt * 6, 2, 32), top = 18, base = hh - 6, X = (b) => 6 + b / span * (w - 12), stp = span > 16 ? 4 : span > 6 ? 1 : 0.25;
    for (let b = 0; b <= span + 1e-9; b += stp) vl(g, X(b), top - 6, base, Math.abs(b % 4) < 1e-9 ? DISPC.grid2 : DISPC.grid);
    hl(g, base, 0, w, DISPC.grid2);
    const dh = (1 - mix * 0.5) * (base - top); g.fillStyle = '#8a8a90'; g.fillRect(X(0) - 1.5, base - dh, 3, dh);
    g.fillStyle = DIM; for (let n = 1, ga = 0.9; n * bt <= span + 1e-9 && n < 64 && ga > 0.01; n++, ga *= fb) { const hg = Math.max(1, ga * (base - top)); g.fillRect(X(n * bt) - 1.5, base - hg, 3, hg); }
    let a = mix, tone = 1;
    for (let n = 1; n * bt <= span + 1e-9 && n < 64 && a > 0.004; n++) {
      const x = X(n * bt), hg = Math.max(1, a * (base - top));
      g.fillStyle = on ? `rgba(79,195,240,${(0.3 + 0.7 * tone).toFixed(3)})` : DISPC.grid2; g.fillRect(x - 1.5, base - hg, 3, hg);
      a *= fb; tone *= 1 - damp * 0.45;
    }
    txt(g, item(k, o.time), 6, 12, on ? WH : DISPC.ink, 9);
  }, null, { min: o.min });
}
// distortion: a sine through the drive (tanh), the decimator (sample hold + bit reduction) and the gain, input faint behind
function distWave(k, o) {
  return disp(k, (g, w, hh) => {
    const on = o.on == null || k.get(o.on) > 0.5, dr = k.get(o.drive) / 100, drive = 1 + dr * o.dmax, nrm = dr > 0 ? 1 / Math.tanh(drive) : 1;
    const gn = o.gain == null ? 1 : Math.pow(10, k.get(o.gain) / 20), dec = o.decim == null ? 0 : k.get(o.decim) / 100, hold = o.flm ? Math.max(1, Math.trunc(64 * dec * dec) / 4) : 1 + dec * 31, bits = o.flm ? 65536 : Math.pow(2, 16 - dec * 12);
    // flm (MiniSynth): D = 20 v^2, y = 1 - (1 - x) 10^(-D x) (mirrored below 0), x (0.7 (1 - D / 16)^8 + 0.3); the Decimator holds frames
    const D = 20 * dr * dr, dgn = 0.7 * Math.pow(1 - D / 16, 8) + 0.3, od = (x) => (x >= 0 ? 1 - (1 - x) * Math.pow(10, -D * x) : -1 + (1 + x) * Math.pow(10, D * x)) * dgn;
    const mid = hh / 2, sc = (mid - 10) / Math.max(1, gn), N = 220, pin = [], pout = [];
    hl(g, mid, 0, w, DISPC.grid2); hl(g, mid - sc, 0, w); hl(g, mid + sc, 0, w);
    for (let x = 0; x <= w; x++) {
      const n = x / w * N, nh = dec > 0 ? Math.floor(n / hold) * hold : n, s0 = Math.sin(2 * Math.PI * n / 110), s1 = Math.sin(2 * Math.PI * nh / 110);
      let v = o.flm ? od(s1 * 0.6) / 0.6 : dr > 0 ? Math.tanh(s1 * drive) * nrm : s1; if (dec > 0) v = Math.round(v * bits) / bits; v *= gn;
      pin.push([x, mid - s0 * sc]); pout.push([x, mid - clamp(v, -1.6, 1.6) * sc]);
    }
    lvPath(g, pin, DIM, null, 1.2); lvPath(g, pout, on ? OR : DISPC.grid2, null, 1.9);
    txt(g, 'Drive ' + Math.round(dr * 100) + (dec > 0 ? ' · Decim ' + Math.round(dec * 100) : '') + (gn !== 1 ? ` · ${(20 * Math.log10(gn)).toFixed(1)} dB` : ''), 6, 12, on ? WH : DISPC.ink, 9);
  }, null, { min: o.min });
}
// chorus: the two modulated delay lines (L sine, R cosine) over 2 s, depth = Mod, brightness = Mix
function chorusDisp(k, o) {
  return disp(k, (g, w, hh) => {
    const on = k.get(o.on) > 0.5, hz = o.flm ? 4 * (k.get(o.rate) / 100) ** 2 + 0.2 : 0.1 + k.get(o.rate) / 100 * 4, dep = k.get(o.mod) / 100, mix = k.get(o.mix) / 100, mid = hh / 2, A = (mid - 14) * Math.max(0.04, dep), L = [], R = [];
    hl(g, mid, 0, w, DISPC.grid2); for (let j = 1; j < 4; j++) vl(g, w * j / 4, 0, hh);
    for (let x = 0; x <= w; x++) { const ph = 2 * Math.PI * hz * (x / w * 2); L.push([x, mid - Math.sin(ph) * A]); R.push([x, mid - Math.cos(ph) * A]); }
    const al = on ? 0.35 + 0.65 * mix : 0.25;
    lvPath(g, R, `rgba(255,173,50,${al.toFixed(2)})`, null, 1.5); lvPath(g, L, `rgba(79,195,240,${al.toFixed(2)})`, null, 1.8);
    txt(g, hz.toFixed(2) + ' Hz', 6, 12, on ? WH : DISPC.ink, 9); txt(g, 'L', w - 18, 12, CY, 9); txt(g, 'R', w - 8, 12, OR, 9);
  }, null, { min: o.min });
}
// phaser: response of the 6 all-pass stages with feedback at the middle of the sweep, the sweep range shaded (engine Phaser)
function phaserDisp(k, o) {
  return disp(k, (g, w, hh) => {
    const on = k.get(o.on) > 0.5, wd = k.get(o.width) / 100, mix = k.get(o.mix) / 100;
    // flm (MiniSynth): allpass frequency 50 + 19950 (Freq^2 + sweep) Hz, sweep 0 .. Width^3, feedback 0.98 cbrt(v)
    const f0 = o.flm ? 50 + 19950 * Math.max(1e-5, (k.get(o.freq) / 100) ** 2) : 80 + k.get(o.freq) / 100 * 1500, fbk = o.flm ? 0.98 * Math.cbrt(k.get(o.fb) / 100) : k.get(o.fb) / 100 * 0.85;
    const f1 = o.flm ? Math.min(SR * 0.45, f0 + 19950 * wd * wd * wd) : Math.min(SR * 0.45, f0 * Math.pow(2, wd * 5)), fc = o.flm ? Math.min(SR * 0.45, (f0 + f1) / 2) : Math.min(SR * 0.45, f0 * Math.pow(2, wd * 2.5)), top = 4, bot = hh - 13, Y = (db) => top + (12 - clamp(db, -36, 12)) / 48 * (bot - top);
    g.fillStyle = 'rgba(255,173,50,.12)'; g.fillRect(lx(f0, w), top, Math.max(2, lx(f1, w) - lx(f0, w)), bot - top);
    freqAxis(g, w, hh, top, bot); hl(g, Y(0), 0, w, DISPC.grid2);
    const t = Math.tan(Math.PI * fc / SR), a = (t - 1) / (t + 1), pts = [];
    for (let x = 0; x <= w; x += 2) {
      const om = 2 * Math.PI * xl(x, w) / SR, cr = Math.cos(om), ci = -Math.sin(om);                      // z^-1 = e^(-j w)
      const nr = a + cr, ni = ci, dr = 1 + a * cr, di = a * ci, dd = dr * dr + di * di, ar = (nr * dr + ni * di) / dd, ai = (ni * dr - nr * di) / dd;
      let pr = 1, pi = 0; for (let s = 0; s < 6; s++) { const r2 = pr * ar - pi * ai; pi = pr * ai + pi * ar; pr = r2; }
      const zr = cr * pr - ci * pi, zi = cr * pi + ci * pr, qr = 1 - fbk * zr, qi = -fbk * zi, qd = qr * qr + qi * qi;   // y = A^6 (x + fb z^-1 y)
      const yr = (pr * qr + pi * qi) / qd, yi = (pi * qr - pr * qi) / qd, hr = 1 - mix * 0.5 + mix * yr, hi = mix * yi;
      pts.push([x, Y(20 * Math.log10(Math.max(1e-5, Math.sqrt(hr * hr + hi * hi))))]);
    }
    lvPath(g, pts, on ? CY : DISPC.grid2, bot, 1.8);
    const narrow = w < 170;                                                      // a narrow display: the range and the speed on two lines
    txt(g, narrow ? fmtHz(f0) : fmtHz(f0) + ' – ' + fmtHz(f1), 6, 13, on ? WH : DISPC.ink, 9);
    if (o.speed != null) { if (narrow) txt(g, MS_RATES[msRateIndex(k.get(o.speed))], 6, 24, on ? OR : DISPC.ink, 9); else txt(g, 'Speed ' + MS_RATES[msRateIndex(k.get(o.speed))], w - 6, 13, on ? OR : DISPC.ink, 9, 'right'); }
  }, null, { min: o.min });
}
// GMS FX slot: X / Y pad (what X and Y do depends on the kind, as in the FLM guide), the LFO sweep of X in orange; drag the point
// X / Y of each kind, named as in the FL Studio Mobile manual (Ring Mod has no Y)
const GMS_XY = [['Amount', 'LPF'], ['Depth', 'Feedback'], ['Depth', 'Feedback'], ['Cutoff', 'Res'], ['Cutoff', 'Res'], ['Feedback', 'Filter'], ['Feedback', 'Wet'], ['Pan', 'Binaural'], ['Freq', '—'], ['Vowel', 'Throat']];
function fxPad(k, o) {
  let box = null;
  box = disp(k, (g, w, hh) => {
    const on = k.get(o) > 0.5, kind = Math.round(k.get(o + 1)), sw = Math.abs(k.get(o + 2) / 100) * 0.5, X = k.get(o + 3) / 100, Yv = k.get(o + 4) / 100, M = 8;
    if (!on) g.globalAlpha = 0.5;
    for (let j = 1; j < 4; j++) { vl(g, w * j / 4, 0, hh); hl(g, hh * j / 4, 0, w); }
    const px = M + X * (w - 2 * M), py = hh - M - Yv * (hh - 2 * M), lo = M + clamp(X - sw, 0, 1) * (w - 2 * M), hi = M + clamp(X + sw, 0, 1) * (w - 2 * M);
    vl(g, px, 0, hh, '#2f5b66'); hl(g, py, 0, w, '#2f5b66');
    if (sw > 0) { g.fillStyle = 'rgba(255,173,50,.55)'; g.fillRect(lo, py - 2, Math.max(2, hi - lo), 4); }
    lvRing(g, px, py, 5);
    const [nx, ny] = GMS_XY[kind] || ['X', 'Y'];
    txt(g, item(k, o + 1), 5, 12, WH, 9); txt(g, 'X ' + nx, w - 5, hh - 4, DISPC.ink, 8, 'right');
    g.save(); g.translate(11, hh - 5); g.rotate(-Math.PI / 2); txt(g, 'Y ' + ny, 0, 0, DISPC.ink, 8); g.restore();   // axis label along the left edge
  }, { onDown: () => ({ x: k.get(o + 3), y: k.get(o + 4) }), onMove: (x, y, dx, dy, s) => { const c = box.cv; k.set(o + 3, Math.round(clamp(s.x + dx / Math.max(20, c._w - 16) * 100, 0, 100))); k.set(o + 4, Math.round(clamp(s.y - dy / Math.max(20, c._h - 16) * 100, 0, 100))); } }, { min: 72 });
  return box;
}
// SuperSaw wheels: pitch wheel range on a semitone ruler, mod wheel position -> modulation of the destination (bipolar amount)
function ssWheels(k) {
  return disp(k, (g, w, hh) => {
    const pr = Math.round(k.get(40)), amt = k.get(41) / 100, sp = Math.round(w * 0.56), mid = hh / 2 + 6;
    const L0 = 10, L1 = sp - 10, X = (st) => L0 + (st + 24) / 48 * (L1 - L0);
    txt(g, 'Pitch Wheel', L0, 13, DISPC.ink, 9);
    g.fillStyle = 'rgba(79,195,240,.25)'; g.fillRect(X(-pr), mid - 18, Math.max(1, X(pr) - X(-pr)), 36);
    hl(g, mid, L0, L1, DISPC.grid2);
    for (let s = -24; s <= 24; s++) vl(g, X(s), mid - (s % 12 ? 3 : 8), mid + (s % 12 ? 4 : 9), s % 12 ? DISPC.grid2 : DISPC.ink);
    for (const s of [-24, -12, 0, 12, 24]) txt(g, (s > 0 ? '+' : '') + s, X(s), mid + 22, DISPC.ink, 8, 'center');
    vl(g, X(-pr), mid - 18, mid + 18, CY); vl(g, X(pr), mid - 18, mid + 18, CY);
    txt(g, '±' + pr + ' st', X(0), mid - 24, CY, 10, 'center');
    vl(g, sp, 6, hh - 6, DISPC.grid2);
    const R0 = sp + 12, R1 = w - 12, A = hh / 2 - 22;
    txt(g, 'Mod Wheel → ' + item(k, 42), R0, 13, DISPC.ink, 9);
    hl(g, mid, R0, R1, DISPC.grid2); vl(g, R0, mid - A, mid + A, DISPC.grid);
    lvPath(g, [[R0, mid], [R1, mid - amt * A]], OR, mid, 1.9); lvRing(g, R1, mid - amt * A, 4);
    txt(g, (amt > 0 ? '+' : '') + Math.round(amt * 100), R1, mid - amt * A + (amt >= 0 ? -8 : 16), OR, 9, 'right');
  });
}
// SuperSaw arpeggiator: the pattern a held C major chord plays over two bars (mode, rate, octave range as the engine's Arp); with the
// arpeggiator off: the glide between two notes (Slide time, Constant, Legato / Mono)
function ssArp(k) {
  return disp(k, (g, w, hh) => {
    const mode = Math.round(k.get(51));
    if (!mode) {
      const sl = k.get(45), span = Math.max(0.6, sl * 3), X = (s) => 8 + s / span * (w - 16), y1 = hh * 0.68, y2 = hh * 0.3, t0 = span * 0.3, pts = [];
      for (let j = 1; j < 4; j++) vl(g, w * j / 4, 0, hh);
      for (let x = X(0); x <= X(span); x += 2) { const s = (x - 8) / (w - 16) * span; pts.push([x, s < t0 ? y1 : y2 + (y1 - y2) * Math.exp(-(s - t0) / Math.max(0.005, sl / 3))]); }
      lvPath(g, pts, CY, null, 2); vl(g, X(t0), 16, hh - 6, DISPC.grid2); vl(g, X(t0 + sl), 16, hh - 6, DISPC.grid2);
      txt(g, 'Glide ' + fmtS(sl) + (k.get(47) > 0.5 ? ' · Constant' : ''), 6, 13, WH, 9);
      txt(g, (k.get(48) > 0.5 ? 'Mono' : 'Poly ' + Math.round(k.get(43)) + ' · held notes slide') + (k.get(46) > 0.5 ? ' · Legato' : ''), w - 6, 13, DISPC.ink, 9, 'right');
      return;
    }
    const rng = clamp(Math.round(k.get(50)) + 1, 1, 4), step = SS_ARP_BEATS[clamp(Math.round(k.get(49)), 0, 5)], held = [60, 64, 67], n = held.length, total = n * rng;
    const span = 8, steps = Math.min(96, Math.max(1, Math.floor(span / step + 1e-6))), lo = 60, hi = 67 + 12 * (rng - 1), top = 18, bot = hh - 6;
    const Y = (p) => bot - (p - lo + 1) / (hi - lo + 2) * (bot - top), rowH = Math.max(2, (bot - top) / (hi - lo + 2) - 1);
    for (let b = 0; b <= span; b++) vl(g, 6 + b / span * (w - 12), top - 4, bot, b % 4 ? DISPC.grid : DISPC.grid2);
    let seed = 0x2545f491;
    for (let s = 0; s < steps; s++) {
      let idx;
      if (mode === 1) idx = s % total; else if (mode === 2) idx = total - 1 - (s % total);
      else if (mode === 3) { const cyc = Math.max(1, total * 2 - 2), q = s % cyc; idx = q < total ? q : cyc - q; }
      else if (mode === 4) { const cyc = total * 2, q = s % cyc; idx = q < total ? q : cyc - 1 - q; }   // Up/Down 2: top and bottom twice
      else { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; idx = (seed >>> 8) % total; }
      const p = held[idx % n] + 12 * Math.floor(idx / n), x = 6 + s * step / span * (w - 12), ww = Math.max(1.5, step / span * (w - 12) - 1.5);
      g.fillStyle = CY; g.fillRect(x + 0.5, Y(p) - rowH / 2, ww, rowH);
    }
    txt(g, item(k, 51) + ' · ' + item(k, 49) + ' · ' + item(k, 50), 6, 13, WH, 9);
  });
}

// FX tab: ONE panel. The effects are listed on the left, each with its on / off switch (a square, lit = on); the chosen effect's display and
// settings fill the panel. The choice is remembered per instrument.
const FXSEL = new Map();
function fxPage(k, list) {
  const key = k.d.id + ':' + k.d.type + ':fx', host = h('div', { class: 'flm-fxh' });
  const show = (j) => { FXSEL.set(key, j); host.replaceChildren(list[j].build()); };
  const cur = Math.min(FXSEL.get(key) || 0, list.length - 1);
  const tb = lvTabs(list.map((f) => (f.on != null ? { label: f.name, check: () => k.get(f.on) > 0.5, onCheck: () => k.set(f.on, k.get(f.on) > 0.5 ? 0 : 1) } : { label: f.name })), cur, show, { cls: 'flm-fxsel' });
  show(cur); k.reg(tb, -1);
  return h('div', { class: 'flm-fxw' }, tb, host);
}
// ================================================================================================ panels
export function addFlmPanels(VI) {
  // DirectWave: zones (sample / root / key and velocity range / level / pan) are edited in the zone list next to this panel
  // DirectWave (native/engine/hddw.cpp): filter / frequency envelopes are FLM's sliders (time shown by their law at 44.1 kHz), cutoff
  // 2^(4 + 10.4 x) Hz, LFO depth a |a|, frequency envelope 4 a^3 octaves
  const dwA = (x) => { const v = clamp(x / 100, 0, 1); return v <= 0 ? 0 : 0.28768 * 500 * Math.pow(v, 4) / 0.0002 / 44100; }, dwD = (x) => 3 * 50 * Math.pow(clamp(x / 100, 0, 1), 4) / 0.0002 / 44100;
  const dwLaw = { a: dwA, d: dwD, r: dwD }, dwHz = (x) => Math.min(22000, Math.pow(2, 4 + 10.4 * clamp(x / 100, 0, 1))), dwBeats = (i) => [0.125, 0.25, 0.5, 0.75, 1, 2, 4, 8, 16, 32][clamp(Math.round(i), 0, 9)];
  VI[30] = (k) => tabs(k, ['SAMPLE', 'FILTER', 'FLT ENV', 'FRQ ENV', 'LFO'], [
    () => [DS('Sample', { g: dwSample(k), w: 2, rows: [[lvBtn('Zona', (e) => document.dispatchEvent(new CustomEvent('mdaw-zone', { detail: { i: k.ctx.i, list: true, rect: e.currentTarget.getBoundingClientRect() } })), { cls: 'lk-t' }), NUM(k, 0, 'Pitch'), NUM(k, 1, 'Fine'), NUM(k, 7, 'PB Range'), NUM(k, 6, 'Slide'), TG(k, 8, 'Reverse', 58), TG(k, 9, 'Loop', 46), TG(k, 10, 'Legato', 54), TG(k, 11, 'Mono', 46)]] }),
      DS('Amp Envelope', { g: env(k, 2, 3, 4, 5), rows: [ADSRN(k, 2, 3, 4, 5)] }), OUT(k, 34)],
    () => [DS('Filter', { k: [KN(k, 12, 'Cutoff'), KN(k, 13, 'Reso')], g: filt(k, 12, 13, () => Math.round(k.get(16)) - 1, null, dwHz), rows: [CHH(k, 16, ['Off', 'Lowpass', 'Highpass', 'Bandpass']), [NUM(k, 14, 'Kbd Trk'), NUM(k, 15, 'Vel Trk')]] })],
    () => [DS('Filter Envelope', { g: env(k, 17, 18, 19, 20, OR, () => 'Amount ' + Math.round(k.get(21)), dwLaw), rows: [ADSRN(k, 17, 18, 19, 20)], r: [KN(k, 21, 'Amount')] })],
    () => [DS('Frequency Envelope', { g: env(k, 22, 23, 24, 25, OR, () => 'Amount ' + Math.round(k.get(26)) + '  =  ' + (48 * Math.pow(k.get(26) / 100, 3)).toFixed(1) + ' st', dwLaw), rows: [ADSRN(k, 22, 23, 24, 25)], r: [KN(k, 26, 'Amount')] })],
    () => [DS('LFO', { k: [KN(k, 32, 'Amount')], g: lfo(k, { shape: 30, amt: 32, mode: 27, rate: 28, sync: 29, att: 31, beats: dwBeats, depth: (x) => Math.sign(x) * (x / 100) ** 2 }),
      rows: [CHH(k, 27, ['Hertz', 'One Shot', 'Tmp Sync']), [lfoRateN(k, 27, 28, 29), MEN(k, 30, 'Shape'), NUM(k, 31, 'Attack')], CHH(k, 33, ['Filter', 'Frequency', 'Level', 'Pan'])] })],
  ], { 0: () => ((P.state.tracks[k.ctx.i].inst.zones) || []).some((z) => z && z.sample), 1: () => Math.round(k.get(16)) > 0, 2: () => k.get(21) !== 0, 3: () => k.get(26) !== 0, 4: () => k.get(32) !== 0 });
  // GMS (js/engine/hdgms.js): envelope knobs are FLM's sliders (the curves show their time: attack 2.53 v^4 s, decay 3 x 22.7 v^7 s)
  const gmA = (x) => 2.53 * Math.pow(clamp(x / 100, 0, 1), 4), gmD = (x) => 3 * 22.7 * Math.pow(clamp(x / 100, 0, 1), 7) + 0.0003;
  const gmLaw = { a: gmA, d: gmD, r: (x) => 3 * (clamp(x / 100, 0, 1) + 0.001) / 8.82 }, gmLawEg = { a: gmA, d: gmD, r: (x) => 3 * (200 * Math.pow(clamp(x / 100, 0, 1), 4) + 0.001) / 8.82 }, gmLawAD = { a: gmA, d: gmD, r: gmD };
  const gmHz = (x) => 32 * Math.pow(2, 9.27 * clamp(x / 100, 0, 1)), gmBeats = (i) => GM_RATE_BEATS[clamp(Math.round(i), 0, 9)];
  VI[31] = (k) => tabs(k, ['FILTER', 'OSC', 'MOD', 'LEVEL', 'EG', 'LFO', 'VOICES', 'FX'], [
    () => [DS('Filter', { k: [KN(k, 0, 'Cutoff'), KN(k, 1, 'Reso')], g: filt(k, 0, 1, () => [0, 0, 1][Math.round(k.get(6))] ?? 0, () => Math.round(k.get(6)) === 1, gmHz), rows: [CHH(k, 6, ['LP 12', 'LP 24', 'HP']), [NUM(k, 5, 'Kbd')]] }),
      DS('Filter Envelope', { g: env(k, 2, 3, 'hold', null, OR, () => 'Amount ' + Math.round(k.get(4)), gmLawAD), rows: [[NUM(k, 2, 'Attack'), NUM(k, 3, 'Decay'), NUM(k, 4, 'Amount')]] })],
    () => [DS('Oscillators', { g: gmsOsc(k), rows: [[MEN(k, 7, 'Osc A', 96), MEN(k, 8, 'Osc B', 96), NUM(k, 9, 'Pitch B'), NUM(k, 10, 'Fine B'), NUM(k, 11, 'Phase B')]], r: [KN(k, 12, 'Balance'), KN(k, 13, 'Noise')] })],
    () => [DS('Modulation', { k: [KN(k, 14, 'Amount')], g: gmsOsc(k), rows: [CHH(k, 15, ['Ring', 'FM', 'Sync', 'Filter']), [MEN(k, 19, 'PB Range', 66), MEN(k, 20, 'MW Dest', 82), NUM(k, 21, 'MW Amt')]] }),
      DS('Mod Envelope', { g: env(k, 16, 17, null, null, OR, () => 'Contour ' + Math.round(k.get(18)), gmLawAD), rows: [[NUM(k, 16, 'Attack'), NUM(k, 17, 'Decay'), NUM(k, 18, 'Contour')]] })],
    () => [DS('Amp Envelope', { g: env(k, 24, 25, 26, 27, CY, null, gmLaw), rows: [ADSRN(k, 24, 25, 26, 27)] }), OUT(k, 22, 23)],
    () => [DS('Envelope Generator', { g: env(k, 29, 30, 31, 32, OR, () => 'Contour ' + Math.round(k.get(28)) + ' → ' + item(k, 34), gmLawEg), rows: [[...ADSRN(k, 29, 30, 31, 32), TG(k, 33, 'Vel', 40)], CHH(k, 34, ['Filter', 'Osc. Mod', 'Pitch'])], r: [KN(k, 28, 'Contour')] })],
    () => [DS('LFO', { k: [KN(k, 35, 'Contour')], g: lfo(k, { shape: 36, amt: 35, sync: 38, beats: gmBeats }), rows: [[MEN(k, 38, 'Rate'), MEN(k, 36, 'Shape'), MEN(k, 37, 'Dest', 84)]] })],
    () => [DS('Voices', { g: gmsVoices(k), rows: [[MEN(k, 45, 'Voices'), MEN(k, 46, 'Scale'), NUM(k, 41, 'Detune'), NUM(k, 42, 'Stereo')], [NUM(k, 39, 'Transpose', 56), NUM(k, 40, 'Slide'), TG(k, 43, 'Mono', 46), TG(k, 44, 'Auto', 46)]] })],
    () => [fxPage(k, [0, 1, 2].map((n) => { const o = 47 + n * 7, xy = (j) => k.swapN(o + 1, (m) => NUM(k, o + 3 + j, (GMS_XY[m] || ['X', 'Y'])[j]));   // X / Y named by the kind
      return { name: 'FX ' + (n + 1), on: o, build: () => DS('FX ' + (n + 1), { g: fxPad(k, o), rows: [[MEN(k, o + 1, 'Kind', 74), xy(0), xy(1)], [MEN(k, o + 5, 'LFO Rate', 74), NUM(k, o + 2, 'LFO Amt'), MEN(k, o + 6, 'Shape', 60)]] }) }; }))],
  ], { 2: () => k.get(14) !== 0, 4: () => k.get(28) !== 0, 5: () => k.get(35) !== 0, 7: () => [47, 54, 61].some((o) => k.get(o) > 0.5) });
  // MiniSynth (js/engine/hdmini.js): the displays use the engine's own laws; envelope knobs are FLM's sliders (the curve shows their time)
  const msT = 1 / 44100, msLaw = { a: (x) => { const v = x / 100; return v < 0.001 ? 0 : 0.28768 / msAttackRate(v) * msT; }, d: (x) => { const v = x / 100; return v < 0.0177 ? 0 : 3 / msDecayRate(v) * msT; }, r: (x) => 3 / msAmpReleaseRate(x / 100) * msT };
  const msLawF = { ...msLaw, r: msLaw.d }, msHz = (x) => Math.min(20000, Math.pow(2, 4 + 10.3 * clamp(x / 100, 0, 1)));
  VI[32] = (k) => tabs(k, ['OSC', 'FILTER', 'FLT EG', 'LFO', 'MASTER', 'FX'], [
    () => [DS('Oscillator', { k: [KN(k, 1, 'Modifier')], g: miniWave(k), rows: [[MEN(k, 0, 'Kind', 116), NUM(k, 2, 'Noise'), NUM(k, 3, 'Transpose', 56)]] }), OUT(k, 43)],
    () => [DS('Filter', { k: [KN(k, 4, 'Cutoff'), KN(k, 7, 'Reso')], g: filt(k, 4, 7, () => 0, () => true, msHz), rows: [[NUM(k, 5, 'Kbd Trk'), NUM(k, 6, 'Vel Trk')]] })],
    () => [DS('Filter Envelope', { g: env(k, 8, 9, 10, 11, OR, () => 'Amount ' + Math.round(k.get(12)), msLawF), rows: [ADSRN(k, 8, 9, 10, 11)], r: [KN(k, 12, 'Amount')] })],
    () => [DS('LFO', { k: [KN(k, 13, 'Amount')], g: lfo(k, { shape: 15, amt: 13, sync: 14, beats: (i) => MS_RATE_BEATS[clamp(Math.round(i), 0, 11)], depth: (x) => Math.sign(x) * (x / 100) ** 2 }),
      rows: [[MEN(k, 14, 'Rate', 70), MEN(k, 15, 'Shape', 70), MEN(k, 16, 'Dest', 70)], [NUM(k, 17, 'Mod Wheel'), MEN(k, 18, 'MW Dest', 70)]] })],
    () => [DS('Master Envelope', { g: env(k, 19, 20, 21, 22, CY, null, msLaw), rows: [ADSRN(k, 19, 20, 21, 22), CHH(k, 23, ['Poly', 'Mono', 'Lead'])], r: [KN(k, 24, 'Slide')] })],
    () => [fxPage(k, [
      { name: 'Distortion', on: 25, build: () => DS('Distortion', { g: distWave(k, { on: 25, drive: 26, dmax: 20, decim: 27, min: 84, flm: true }), rows: [[NUM(k, 26, 'Drive'), NUM(k, 27, 'Decim')]] }) },
      { name: 'Delay', on: 28, build: () => DS('Delay', { g: taps(k, { on: 28, time: 32, fb: 29, filt: 30, mix: 31, min: 84, flm: true, beats: (i) => MS_DELAY_BEATS[clamp(Math.round(i), 0, 3)] }), rows: [[MEN(k, 32, 'Time', 56), NUM(k, 29, 'Feedback'), NUM(k, 30, 'Filter'), NUM(k, 31, 'Mix')]] }) },
      { name: 'Chorus', on: 33, build: () => DS('Chorus', { g: chorusDisp(k, { on: 33, rate: 34, mod: 35, mix: 36, min: 84, flm: true }), rows: [[NUM(k, 34, 'Rate'), NUM(k, 35, 'Mod'), NUM(k, 36, 'Mix')]] }) },
      { name: 'Phaser', on: 37, build: () => DS('Phaser', { g: phaserDisp(k, { on: 37, speed: 38, width: 39, fb: 40, freq: 41, mix: 42, min: 84, flm: true }), rows: [[NUM(k, 38, 'Speed'), NUM(k, 39, 'Width'), NUM(k, 40, 'Feedback'), NUM(k, 41, 'Freq'), NUM(k, 42, 'Mix')]] }) }])],
  ], { 2: () => k.get(12) !== 0, 3: () => k.get(13) !== 0, 5: () => [25, 28, 33, 37].some((o) => k.get(o) > 0.5) });
  // SuperSaw (redesign 2026-11-16): one or two sections a tab as the other FLM synths (the old OSC tab held three side by side, ~1200 px):
  // OSC = the oscillator + its unison, SYNC = Supersync's own sweep envelope (lit while the Osc Mode is Supersync), AMP = the amp envelope + output
  VI[33] = (k) => tabs(k, ['OSC', 'SYNC', 'FILTER', 'LFO', 'AMP', 'MOD', 'VOICES', 'FX'], [
    () => [DS('Oscillator', { g: ssWave(k), rows: [CHH(k, 1, ['Supersaw', 'Supersync']), [TG(k, 0, 'Pulse', 46), TG(k, 2, 'Retrig', 50), NUM(k, 3, 'PW'), NUM(k, 4, 'Sub Osc')]] }),
      DS('Unison', { k: [KN(k, 6, 'Detune')], g: ssUnison(k), rows: [[MEN(k, 5, 'Voices', 66), NUM(k, 9, 'Phase'), NUM(k, 8, 'Spread'), NUM(k, 7, 'Pan')]] })],
    () => [DS('Supersync', { k: [KN(k, 10, 'Sync')], g: env(k, 12, 13, 14, 15, OR), rows: [[NUM(k, 11, 'Sync PW'), NUM(k, 16, 'Amount'), TG(k, 17, 'Flip', 40)], ADSRN(k, 12, 13, 14, 15)] })],
    () => [DS('Filter', { k: [KN(k, 18, 'Cutoff'), KN(k, 19, 'Reso')], g: filt(k, 18, 19, () => 0), rows: [[NUM(k, 20, 'Kbd Trk'), NUM(k, 21, 'Vel Trk')]] }),
      DS('Filter Envelope', { g: env(k, 22, 23, 24, 25, OR, () => 'Amount ' + Math.round(k.get(26))), rows: [ADSRN(k, 22, 23, 24, 25)], r: [KN(k, 26, 'Amount')] })],
    () => [DS('LFO', { k: [KN(k, 32, 'Amount')], g: lfo(k, { shape: 30, amt: 32, mode: 27, rate: 28, sync: 29, att: 31 }),
      rows: [CHH(k, 27, ['Hertz', 'One Shot', 'Tmp Sync']), [lfoRateN(k, 27, 28, 29), MEN(k, 30, 'Shape'), NUM(k, 31, 'Attack'), MEN(k, 33, 'Target', 108)]] })],
    () => [DS('Amp Envelope', { g: env(k, 36, 37, 38, 39), rows: [ADSRN(k, 36, 37, 38, 39)] }), OUT(k, 34, 35)],
    () => [DS('Wheels', { g: ssWheels(k), rows: [[NUM(k, 40, 'PW Range'), NUM(k, 41, 'MW Amount', 56), MEN(k, 42, 'MW Dest', 108)]] })],
    () => [DS('Voices / Arpeggiator', { g: ssArp(k), rows: [[NUM(k, 43, 'Poly'), NUM(k, 44, 'Transpose', 56), NUM(k, 45, 'Slide'), TG(k, 46, 'Legato', 52), TG(k, 47, 'Constant', 62), TG(k, 48, 'Mono', 46)], [MEN(k, 51, 'Mode', 92), MEN(k, 49, 'Rate', 70), MEN(k, 50, 'Range', 70)]] })],
    () => [fxPage(k, [
      { name: 'Distortion', build: () => DS('Distortion', { k: [KN(k, 52, 'Drive')], g: distWave(k, { drive: 52, dmax: 99, gain: 53 }), rows: [[NUM(k, 53, 'Gain')]] }) },
      { name: 'Delay', build: () => DS('Delay', { g: taps(k, { time: 54, fb: 55, filt: 56, mix: 57, beats: (i) => SS_DELAY_BEATS[clamp(Math.round(i), 0, 4)] }), rows: [[MEN(k, 54, 'Time', 64), NUM(k, 55, 'Feedback'), NUM(k, 56, 'Filter'), NUM(k, 57, 'Mix')]] }) }])],
  ], { 1: () => Math.round(k.get(1)) === 1, 3: () => k.get(32) !== 0, 7: () => k.get(52) > 0 || k.get(57) > 0 });
}

// ================================================================================================ Moisture (37)
// The Serum-style wavetable synth (native/engine/moist2.cpp): Serum's page order (OSC with the sources, the modulators, MATRIX, FX, GLOBAL)
// and its sections (OSC A / B with the wavetable in 3D, SUB, NOISE, FILTER, ENV 1-3, LFO 1-8, VOICING, MACROS), in MobileDAW's own drawing.
const m2c = (v) => Math.min(1, Math.max(0, v));
// a menu over a normalized parameter that holds a list index (Serum's continuous-coded lists: filter type, warp mode, ...)
function SM(k, j, items, n, label, w = 92) {
  const b = lvBtn('', (e) => { const r = e.currentTarget.getBoundingClientRect(), cur = Math.round(m2c(k.get(j)) * (n - 1));
    menu(items.map((t, i) => ({ label: t, check: i === cur, fn: () => { k.set(j, n > 1 ? i / (n - 1) : 0); b.update(); } })), r.left, r.bottom + 1); }, { cls: 'lk-t m2-sm', w });
  b.update = () => { b.textContent = m2Text(j, k.get(j)); }; b.update(); k.reg(b, j);
  return label ? h('div', { class: 'lk-tl' }, h('span', { class: 'lk-lb' }, label), b) : b;
}
// the wavetables for the display (the engine builds the same shapes with 2048 points and band-limits them)
const M2_DRAW = new Map();
export function m2Frames(t) {
  if (M2_DRAW.has(t)) return M2_DRAW.get(t);
  const N = 128, F = 24, out = [], TAU = Math.PI * 2, sh = (k, x) => (k === 0 ? Math.sin(TAU * x) : k === 1 ? (x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4) : k === 2 ? 2 * x - 1 : x < 0.5 ? 1 : -1);
  const add = (amp) => (x) => { let s = 0; for (let h2 = 1; h2 < amp.length; h2++) if (amp[h2]) s += amp[h2] * Math.sin(TAU * h2 * x); return s; };
  for (let f = 0; f < F; f++) {
    const u = f / (F - 1); let fn;
    switch (t) {
      case 0: { const y = u * 3, k = Math.min(2, Math.floor(y)), fr = y - k; fn = (x) => (1 - fr) * sh(k, x) + fr * sh(k + 1, x); break; }
      case 1: { const cut = 2 + u * u * 40, a = [0]; for (let q = 1; q < 48; q++) a.push(1 / q / Math.sqrt(1 + Math.pow(q / cut, 4))); fn = add(a); break; }
      case 2: { const w = 0.5 - 0.47 * u; fn = (x) => (x < w ? 1 : -1) - (2 * w - 1); break; }
      case 3: { const a = new Array(34).fill(0); a[1] = 0.5; a[1 + Math.round(u * 31)] += 1; fn = add(a); break; }
      case 4: { const a = [0]; for (let q = 1; q < 40; q++) a.push(Math.exp(-0.5 * Math.pow((q * 110 - (300 + 600 * Math.abs(Math.sin(u * 3)))) / 120, 2)) + 0.5 * Math.exp(-0.5 * Math.pow((q * 110 - (1200 + 1200 * u)) / 200, 2))); fn = add(a); break; }
      case 5: { const r = 1 + 7 * u; fn = (x) => (2 * ((x * r) % 1) - 1) * (1 - x * 0.3); break; }
      case 6: { const g = 1 + 7 * u; fn = (x) => Math.sin(g * Math.sin(TAU * x)); break; }
      case 7: { const a = new Array(18).fill(0); const D = [[1, 1, 1, 0, 0], [1, 1, 1, 1, 1], [0, 1, 0.75, 0, 0], [1, 1, 0, 0, 1]][Math.min(3, Math.floor(u * 4))]; [1, 2, 3, 4, 8].forEach((q, i) => { a[q] = D[i]; }); fn = add(a); break; }
      case 8: { const cut = 1 + u * u * 30, a = [0]; for (let q = 1; q < 48; q++) a.push(q % 2 ? 1 / q / Math.sqrt(1 + Math.pow(q / cut, 4)) : 0); fn = add(a); break; }
      default: { const st = 2 + Math.round(u * 31); fn = (x) => Math.floor(Math.sin(TAU * x) * st) / st; }
    }
    const pts = []; let pk = 1e-9; for (let i = 0; i <= N; i++) { const y = fn(i / N); pts.push(y); pk = Math.max(pk, Math.abs(y)); }
    out.push(pts.map((y) => y / pk));
  }
  M2_DRAW.set(t, out); return out;
}
// OSC display: the frames stacked in depth (back to front), the playing frame bright; drag up / down = WT Pos
function m2Wave(k, tblK, posK, warpK, warpModeK, onK) {
  return disp(k, (g, w, hh) => {
    const on = k.get(onK) > 0.5, fr = m2Frames(Math.round(k.get(tblK)) || 0), F = fr.length, pos = m2c(k.get(posK)), cur = Math.round(pos * (F - 1));
    const depth = Math.min(hh * 0.32, 26), dx = Math.min(w * 0.18, 34), ww = w - dx - 12, amp = (hh - depth - 18) * 0.42, by = hh - 10 - amp;
    for (let f = 0; f < F; f++) {
      const z = f / (F - 1), ox = 6 + dx * (1 - z), oy = by - depth * (1 - z), isCur = f === cur;
      g.strokeStyle = isCur ? (on ? '#5fd3ff' : '#888') : 'rgba(95,211,255,' + (on ? 0.08 + 0.12 * z : 0.05) + ')'; g.lineWidth = isCur ? 2 : 1; g.beginPath();
      const pts = fr[f]; for (let i = 0; i < pts.length; i++) { const x = ox + ww * i / (pts.length - 1), y = oy - pts[i] * amp * (isCur ? 1 : 0.8); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    }
    txt(g, M2_TABLES[Math.round(k.get(tblK))] || 'Custom', 6, 12, DISPC.ink, 9); txt(g, 'Frame ' + (1 + Math.round(pos * 255)), w - 6, 12, '#5fd3ff', 9, 'right');
    const wm = Math.round(m2c(k.get(warpModeK)) * (M2_WARPS.length - 1)); if (wm) txt(g, M2_WARPS[wm] + ' ' + Math.round(k.get(warpK) * 100) + '%', w - 6, hh - 3, OR, 8, 'right');
  }, { onDown: () => ({ v: k.get(posK) }), onMove: (x, y, dx2, dy2, st) => { k.set(posK, m2c(st.v - dy2 / 120)); } }, { min: 150, w: 1.4 });
}
// filter response (the engine's SVF families) at the cutoff / resonance, with the type's name
function m2Filt(k) {
  return disp(k, (g, w, hh) => {
    const on = k.get(216) > 0.5, ti = Math.round(m2c(k.get(44)) * 95), T = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 1], [0, 2], [0, 3], [0, 4], [1, 1], [1, 2], [1, 3], [1, 4], [2, 2], [2, 4], [3, 2], [3, 4], [4, 2], [4, 4]][ti] || [0, 2];
    const fc = 8 * Math.pow(2756.25, m2c(k.get(45))), Q = 1 / (2 - 1.97 * m2c(k.get(46))), top = 16, bot = hh - 12;
    freqAxis(g, w, hh, top, bot);
    g.strokeStyle = on ? CY : '#777'; g.lineWidth = 2; g.beginPath();
    for (let x = 0; x <= w; x += 2) { const f = xl(x, w), r = f / fc; let m;
      const lp2 = 1 / Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(r / Q, 2)), hp2 = r * r * lp2, bp = (r / Q) * lp2, lp1 = 1 / Math.sqrt(1 + r * r), hp1 = r * lp1;
      const p2 = T[1] >= 3 ? 2 : 1, one = T[1] % 2 === 1;
      m = T[0] === 0 ? (one ? lp1 : 1) * Math.pow(lp2, T[1] >= 2 ? Math.floor(T[1] / 2) : 0) : T[0] === 1 ? (one ? hp1 : 1) * Math.pow(hp2, T[1] >= 2 ? Math.floor(T[1] / 2) : 0) : T[0] === 2 ? Math.pow(bp, p2) : T[0] === 3 ? 1 + bp * 2 : Math.abs(1 - bp);
      const db = 20 * Math.log10(Math.max(1e-5, m)), y = top + (bot - top) * (1 - (db + 36) / 54); x ? g.lineTo(x, Math.max(top - 6, Math.min(bot, y))) : g.moveTo(x, y); }
    g.stroke(); txt(g, M2_FILTERS[ti] || 'Low 12', 6, 12, DISPC.ink, 9); txt(g, m2Text(45, k.get(45)), w - 6, 12, CY, 9, 'right');
  }, { onDown: () => ({ c: k.get(45), r: k.get(46) }), onMove: (x, y, dx2, dy2, st) => { k.set(45, m2c(st.c + dx2 / 200)); k.set(46, m2c(st.r - dy2 / 150)); } }, { min: 150, w: 1.2 });
}
// envelope (AHDSR in Serum's laws), LFO shape
function m2Env(k, base, sel) {
  return disp(k, (g, w, hh) => {
    const o = [[35, 36, 37, 38, 39], [51, 52, 53, 54, 55], [56, 57, 58, 59, 60]][sel()], T = (j) => 32 * Math.pow(m2c(k.get(j)), 5), A = T(o[0]), Hd = T(o[1]), D = T(o[2]), S = m2c(k.get(o[3])), R = T(o[4]);
    const sq = (t) => Math.sqrt(t + 1e-4), tot = sq(A) + sq(Hd) + sq(D) + 0.6 + sq(R), kx = (w - 16) / tot, top = 18, bot = hh - 10, Y = (v) => bot - (bot - top) * v;
    let x = 8; const pts = [[x, Y(0)]]; x += sq(A) * kx; pts.push([x, Y(1)]); x += sq(Hd) * kx; pts.push([x, Y(1)]); x += sq(D) * kx; pts.push([x, Y(S)]); x += 0.6 * kx; pts.push([x, Y(S)]); x += sq(R) * kx; pts.push([x, Y(0)]);
    g.fillStyle = 'rgba(95,211,255,0.12)'; g.beginPath(); pts.forEach(([a, b2], i) => (i ? g.lineTo(a, b2) : g.moveTo(a, b2))); g.lineTo(pts[pts.length - 1][0], bot); g.closePath(); g.fill();
    g.strokeStyle = '#5fd3ff'; g.lineWidth = 2; g.beginPath(); pts.forEach(([a, b2], i) => (i ? g.lineTo(a, b2) : g.moveTo(a, b2))); g.stroke();
    txt(g, 'ENV ' + (sel() + 1), 6, 12, DISPC.ink, 9); void base;
  }, null, { min: 160, w: 1.2 });
}
function m2Lfo(k, sel) {
  return disp(k, (g, w, hh) => {
    const j = sel(), shp = Math.round(k.get(M2.LFO_SHAPE + j)), top = 16, bot = hh - 10, mid = (top + bot) / 2, a = (bot - top) / 2;
    g.strokeStyle = OR; g.lineWidth = 2; g.beginPath(); let sv = 0.6;
    for (let x = 0; x <= w - 12; x++) { const ph = (x / (w - 12) * 2) % 1; let y;
      if (shp === 0) y = Math.sin(ph * 2 * Math.PI); else if (shp === 1) y = ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4; else if (shp === 2) y = 2 * ph - 1; else if (shp === 3) y = 1 - 2 * ph; else if (shp === 4) y = ph < 0.5 ? 1 : -1; else { if (x % Math.round((w - 12) / 8) === 0) sv = Math.sin(x * 12.9898) % 1; y = sv; }
      const X = 6 + x, Y = mid - y * a; x ? g.lineTo(X, Y) : g.moveTo(X, Y); }
    g.stroke(); txt(g, 'LFO ' + (j + 1) + ' · ' + M2_LFO_SHAPES[shp], 6, 12, DISPC.ink, 9);
    const rk = j < 4 ? 61 + j : 260 + j - 4; txt(g, k.get(M2.LFO_SYNC + j) > 0.5 ? m2Text(rk, k.get(rk)) : (Math.pow(2, -6 + 13 * m2c(k.get(rk)))).toFixed(2) + ' Hz', w - 6, 12, OR, 9, 'right');
  }, null, { min: 160, w: 1 });
}
const M2SEL = new Map();
function m2Picker(k, key, n, label, after) {   // 1..n buttons (ENV 1-3, LFO 1-8)
  const id = k.d.id + ':' + key, get = () => M2SEL.get(id) || 0;
  const bs = Array.from({ length: n }, (_, i) => { const b = lvBtn(String(i + 1), () => { M2SEL.set(id, i); bs.forEach((x, q) => x.classList.toggle('on', q === i)); after(); }, { cls: 'lk-t m2-pk' }); b.classList.toggle('on', i === get()); return b; });
  return { el: h('div', { class: 'lk-row m2-pks' }, h('span', { class: 'lk-lb' }, label), ...bs), get };
}
export function addMoisturePanel(VI) {
  VI[37] = (k) => tabs(k, ['OSC', 'MOD', 'MATRIX', 'FX', 'GLOBAL'], [
    () => [
      ...[['OSC A', 212, 300, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 10, 168], ['OSC B', 213, 301, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 23, 169]].map(([t, on, tb, vol, pan, oct, semi, fine, uni, det, bl, warp, pos, rnd, ph, crs, wm]) =>
        DS(t, { sw: k.T(on, '', { cls: 'flm-sw', w: 14 }), k: [KN(k, pos, 'WT Pos'), KN(k, warp, 'Warp')], g: m2Wave(k, tb, pos, warp, wm, on), r: [KN(k, pan, 'Pan'), KN(k, vol, 'Level')],
          rows: [[MEN(k, tb, 'Wavetable', 108), SM(k, wm, M2_WARPS, M2_WARPS.length, 'Warp mode', 96)], [NUM(k, oct, 'Oct', 40), NUM(k, semi, 'Semi', 40), NUM(k, fine, 'Fine', 44), NUM(k, crs, 'Coarse', 56)],
            [NUM(k, uni, 'Unison', 40), NUM(k, det, 'Detune', 44), NUM(k, bl, 'Blend', 44), NUM(k, ph, 'Phase', 40), NUM(k, rnd, 'Rand', 44)]] })),
      h('div', { class: 'flm-sec m2-stack' },
        DS('SUB', { sw: k.T(215, '', { cls: 'flm-sw', w: 14 }), k: [KN(k, 33, 'Level')], rows: [[SM(k, 170, M2_SUB, 6, 'Shape', 84), NUM(k, 171, 'Oct', 40), NUM(k, 34, 'Pan', 40)]] }),
        DS('NOISE', { sw: k.T(214, '', { cls: 'flm-sw', w: 14 }), k: [KN(k, 27, 'Level')], rows: [[NUM(k, 28, 'Pitch', 44), NUM(k, 29, 'Fine', 44), NUM(k, 30, 'Pan', 40)]] })),
      DS('FILTER', { sw: k.T(216, '', { cls: 'flm-sw', w: 14 }), k: [KN(k, 45, 'Cutoff'), KN(k, 46, 'Res')], g: m2Filt(k), r: [KN(k, 47, 'Drive'), KN(k, 49, 'Mix')],
        rows: [[SM(k, 44, M2_FILTERS, 96, 'Type', 92), NUM(k, 50, 'Pan', 40), NUM(k, 48, 'Fat', 40)], [h('span', { class: 'lk-lb' }, 'Route'), k.T(40, 'A', { w: 26 }), k.T(41, 'B', { w: 26 }), k.T(42, 'N', { w: 26 }), k.T(43, 'S', { w: 26 })]] })],
    () => { let envD, lfoD; const ep = m2Picker(k, 'env', 3, 'ENV', () => { envD.cv.paint(); rows(); }), lp = m2Picker(k, 'lfo', 8, 'LFO', () => { lfoD.cv.paint(); lrow(); });
      envD = m2Env(k, 0, ep.get); lfoD = m2Lfo(k, lp.get);
      const er = h('div', { class: 'lk-row flm-dr' }), lr = h('div', { class: 'lk-row flm-dr' });
      const rows = () => { const o = [[35, 36, 37, 38, 39], [51, 52, 53, 54, 55], [56, 57, 58, 59, 60]][ep.get()]; er.replaceChildren(NUM(k, o[0], 'Attack', 50), NUM(k, o[1], 'Hold', 50), NUM(k, o[2], 'Decay', 50), NUM(k, o[3], 'Sustain', 50), NUM(k, o[4], 'Release', 50)); };
      const lrow = () => { const j = lp.get(), rk = j < 4 ? 61 + j : 260 + j - 4; lr.replaceChildren(MEN(k, M2.LFO_SHAPE + j, 'Shape', 84), NUM(k, rk, 'Rate', 56), k.T(M2.LFO_SYNC + j, 'BPM', { w: 40 }), MEN(k, M2.LFO_MODE + j, 'Mode', 64), NUM(k, 273 + j, 'Rise', 44), NUM(k, 281 + j, 'Delay', 44)); };
      rows(); lrow();
      return [DS('ENVELOPES', { g: envD, rows: [ep.el, er] }), DS('LFO', { g: lfoD, rows: [lp.el, lr] }),
        DS('VOICING', { rows: [[k.T(M2.MONO, 'Mono', { w: 48 }), k.T(M2.LEGATO, 'Legato', { w: 56 }), NUM(k, M2.VOICES, 'Voices', 44)], [NUM(k, 65, 'Porta', 56), NUM(k, 66, 'Curve', 44)], [NUM(k, 166, 'Bend +', 44), NUM(k, 167, 'Bend -', 44)]] }),
        DS('MACROS', { k: [KN(k, 218, 'Macro 1'), KN(k, 219, 'Macro 2')], r: [KN(k, 220, 'Macro 3'), KN(k, 221, 'Macro 4')], rows: [] })]; },
    () => { const list = h('div', { class: 'm2-mx' });
      list.append(h('div', { class: 'm2-mxh' }, ...['#', 'Source', 'Amount', 'Destination', 'Output'].map((t) => h('span', {}, t))));
      for (let r = 0; r < M2.ROUTES; r++) { const dj = M2.ROUTE + 2 * r + 1, b = m2Bank(r);
        const dst = lvBtn('', (e) => { const rc = e.currentTarget.getBoundingClientRect(), cur = Math.round(k.get(dj));
          menu([{ label: '—', check: cur < 0, fn: () => { k.set(dj, -1); dst.update(); } }, ...M2_DESTS.map(([pi, n]) => ({ label: n, check: pi === cur, fn: () => { k.set(dj, pi); dst.update(); } }))], rc.left, rc.bottom + 1); }, { cls: 'lk-t m2-sm', w: 110 });
        dst.update = () => { const cur = Math.round(k.get(dj)), d = M2_DESTS.find(([pi]) => pi === cur); dst.textContent = d ? d[1] : '—'; }; dst.update(); k.reg(dst, dj);
        list.append(h('div', { class: 'm2-mxr' }, h('span', { class: 'lk-lb' }, String(r + 1)), k.S(M2.ROUTE + 2 * r, { w: 96 }), k.NT(b, { w: 54, cls: 'or' }), dst, k.NT(b + 1, { w: 50, cls: 'or' }))); }
      return [h('div', { class: 'flm-sec m2-mxs grow' }, h('div', { class: 'flm-st' }, h('span', {}, 'MATRIX')), list)]; },
    () => [fxPage(k, [
      { name: 'Hyper/Dimension', on: 163, build: () => DS('Hyper / Dimension', { k: [KN(k, 148, 'Rate'), KN(k, 149, 'Detune')], r: [KN(k, 152, 'Size'), KN(k, 153, 'Mix Dim')], rows: [[NUM(k, 150, 'Unison', 44), k.T(151, 'Retrig', { w: 52 }), NUM(k, 147, 'Mix', 44)]] }) },
      { name: 'Distortion', on: 154, build: () => DS('Distortion', { k: [KN(k, 97, 'Drive')], r: [KN(k, 96, 'Mix')], rows: [[SM(k, 99, M2_DIST, 13, 'Mode', 104), SM(k, 102, ['Pre', 'Post'], 2, 'Filter', 56)], [NUM(k, 98, 'L/B/H', 44), NUM(k, 100, 'Freq', 56), NUM(k, 101, 'BW', 44)]] }) },
      { name: 'Flanger', on: 155, build: () => DS('Flanger', { k: [KN(k, 105, 'Rate'), KN(k, 106, 'Depth')], r: [KN(k, 107, 'Feed'), KN(k, 103, 'Mix')], rows: [[k.T(104, 'BPM', { w: 40 }), NUM(k, 108, 'Phase', 44)]] }) },
      { name: 'Phaser', on: 156, build: () => DS('Phaser', { k: [KN(k, 111, 'Rate'), KN(k, 112, 'Depth')], r: [KN(k, 114, 'Feed'), KN(k, 109, 'Mix')], rows: [[k.T(110, 'BPM', { w: 40 }), NUM(k, 113, 'Freq', 56), NUM(k, 115, 'Phase', 44)]] }) },
      { name: 'Chorus', on: 157, build: () => DS('Chorus', { k: [KN(k, 118, 'Rate'), KN(k, 121, 'Depth')], r: [KN(k, 122, 'Feed'), KN(k, 116, 'Mix')], rows: [[k.T(117, 'BPM', { w: 40 }), NUM(k, 119, 'Delay 1', 50), NUM(k, 120, 'Delay 2', 50), NUM(k, 123, 'Filter', 56)]] }) },
      { name: 'Delay', on: 158, build: () => DS('Delay', { k: [KN(k, 132, 'Feedback')], r: [KN(k, 124, 'Mix')], rows: [[k.T(127, 'BPM', { w: 40 }), k.T(128, 'Link', { w: 40 }), SM(k, 131, ['Normal', 'Ping-Pong', 'Tap->Delay'], 3, 'Mode', 88)],
        [NUM(k, 129, 'Left', 50), NUM(k, 130, 'Right', 50), NUM(k, 133, 'Off L', 44), NUM(k, 134, 'Off R', 44)], [NUM(k, 125, 'Freq', 56), NUM(k, 126, 'BW', 44)]] }) },
      { name: 'Compressor', on: 159, build: () => DS('Compressor', { k: [KN(k, 135, 'Thresh'), KN(k, 136, 'Ratio')], r: [KN(k, 139, 'Gain'), KN(k, 269, 'Mix')], rows: [[NUM(k, 137, 'Attack', 50), NUM(k, 138, 'Release', 50), k.T(140, 'Multiband', { w: 70 })]] }) },
      { name: 'Reverb', on: 160, build: () => DS('Reverb', { k: [KN(k, 82, 'Size'), KN(k, 85, 'Damp')], r: [KN(k, 87, 'Width'), KN(k, 81, 'Mix')], rows: [[NUM(k, 83, 'Pre Dly', 50), NUM(k, 84, 'Low Cut', 50), NUM(k, 86, 'High Cut', 50)]] }) },
      { name: 'EQ', on: 161, build: () => DS('EQ', { k: [KN(k, 88, 'Freq L'), KN(k, 92, 'Gain L')], r: [KN(k, 89, 'Freq H'), KN(k, 93, 'Gain H')], rows: [[SM(k, 94, ['Shelf', 'Peak', 'Cut'], 3, 'Type L', 64), NUM(k, 90, 'Q L', 44), SM(k, 95, ['Shelf', 'Peak', 'Cut'], 3, 'Type H', 64), NUM(k, 91, 'Q H', 44)]] }) },
      { name: 'Filter', on: 162, build: () => DS('FX Filter', { k: [KN(k, 143, 'Cutoff'), KN(k, 144, 'Res')], r: [KN(k, 145, 'Drive'), KN(k, 141, 'Mix')], rows: [[SM(k, 142, M2_FILTERS, 96, 'Type', 92), NUM(k, 268, 'Pan', 44), NUM(k, 146, 'Var', 44)]] }) }])],
    () => [DS('MASTER', { k: [KN(k, 0, 'Master')], rows: [[NUM(k, 66, 'Port Curve', 56), k.T(164, 'A Key', { w: 52 }), k.T(165, 'B Key', { w: 52 })], [NUM(k, 172, 'A Uni Width', 56), NUM(k, 173, 'B Uni Width', 56)], [NUM(k, 176, 'A Uni WT', 50), NUM(k, 177, 'B Uni WT', 50)]] }),
      DS('WAVETABLES & PRESETS', { rows: [[lvBtn('Muat wavetable A (.wav)\u2026', () => document.dispatchEvent(new CustomEvent('mdaw-m2wt', { detail: { i: k.ctx.i, osc: 0 } })), { cls: 'lk-t' })],
        [lvBtn('Muat wavetable B (.wav)\u2026', () => document.dispatchEvent(new CustomEvent('mdaw-m2wt', { detail: { i: k.ctx.i, osc: 1 } })), { cls: 'lk-t' })],
        [lvBtn('Impor preset Serum (.fxp)\u2026', () => document.dispatchEvent(new CustomEvent('mdaw-m2fxp', { detail: { i: k.ctx.i } })), { cls: 'lk-t' })]] })],
  ], { 0: () => k.get(212) > 0.5 || k.get(213) > 0.5, 2: () => { for (let r = 0; r < M2.ROUTES; r++) if (k.get(M2.ROUTE + 2 * r) > 0) return true; return false; }, 3: () => [154, 155, 156, 157, 158, 159, 160, 161, 162, 163].some((j) => k.get(j) > 0.5) });
}
