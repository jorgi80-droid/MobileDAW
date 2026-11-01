// FL Studio Mobile instruments in the device view (types 30..33: DirectWave, GMS, MiniSynth, SuperSaw), drawn as Live 12 devices.
// Same tabs and controls as the FLM modules (owner's screenshots). A tab is a row of titled sections; the controls sit in tight two-row
// columns (label / knob / value) and the graphics take all the width the controls leave, at the full section height, so the card (as wide
// as the device panel) is always full, like Live's Auto Filter / Drift / Simpler. The graphics follow the engine's own formulas
// (js/engine/flmsyn.js): filter response, envelopes (drag the handles), LFO with attack / one shot, GMS oscillator output with the
// modulation kind, sample + zone map, unison and chorus voices, arpeggiator pattern / glide, delay taps, distortion / decimator, chorus,
// phaser response, GMS FX X / Y pads (drag the point).
import { h } from './ui.js';
import { lvTabs, lvPath, lvRing, lvEnvPts, DISPC } from './liveui.js';
import { Biquad } from './engine/dsp.js';
import { cutHz, gmsWaveTable, syncBeats } from './engine/flmsyn.js';
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
function tabs(k, names, pages) {
  const key = k.d.id + ':' + k.d.type, page = h('div', { class: 'flm-pg' });
  let raf = 0;
  const refit = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; if (page.isConnected) fit(page); }); };
  const show = (j) => { TAB.set(key, j); page.replaceChildren(...[].concat(pages[j]())); refit(); };
  const cur = Math.min(TAB.get(key) || 0, names.length - 1);
  const tb = lvTabs(names.map((label) => ({ label })), cur, show, { cls: 'lk-tabs flm-tabs lk-flmtabs' }); show(cur);
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
    const st = sec.querySelector('.flm-st'), cs = getComputedStyle(sec);
    nat = Math.max(nat, (st ? st.offsetHeight + 2 : 0) + gh + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom));
  }
  for (const d of page.querySelectorAll('.flm-dbox')) slack += Math.max(0, d.offsetWidth - (parseFloat(getComputedStyle(d).minWidth) || 0));
  const need = page.scrollWidth - slack, r = H / Math.max(60, nat), zh = r < 1 ? r : r > 1.8 ? Math.min(1.35, r / 1.5) : 1;
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
const lfoRate = (k, modeK, rateK, syncK) => k.swapN(modeK, (m) => (m === 2 ? FC('Rate', k.S(syncK, { w: 70 })) : k.K(rateK, { n: 'Rate' })));

// display that fills its box (the free width, the section height); redrawn sharp at any size, zoom or pixel density
function disp(k, draw, drag, o = {}) {
  const c = k.D(160, 100, () => {}, drag), box = h('div', { class: 'flm-dbox' }, c);
  if (o.min) box.style.minWidth = o.min + 'px';
  if (o.w) box.style.flexGrow = String(o.w);
  let w = 0, hh = 0, sc = 1;
  c.paint = () => { if (!w || !c.isConnected) return; const g = c.getContext('2d'); g.setTransform(sc, 0, 0, sc, 0, 0); g.fillStyle = DISPC.bg; g.fillRect(0, 0, w, hh); g.save(); draw(g, w, hh); g.restore(); };
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
// Operator). Drag a handle: time left / right (x2 per 28 px), sustain up / down. s == null: attack / decay envelope (GMS filter / mod).
function envPts(w, hh, A, D, S, R, pad) {                                       // top margin 2 x pad: the label line stays clear of the curve
  if (S == null) { const wa = Math.sqrt(A), wd = Math.sqrt(D), kx = (w - 2 * pad) * 0.82 / Math.max(1e-6, wa + wd);
    return [[pad, hh - pad], [pad + wa * kx, 2 * pad], [pad + (wa + wd) * kx, hh - pad], [w - pad, hh - pad]]; }
  return lvEnvPts(w, hh - pad, A, D, S, R, pad).map(([x, y]) => [x, y + pad]);
}
function env(k, a, d, s, r, col = CY, lab = null) {
  const PAD = 9, lim = (j, v) => clamp(v, k.def.params[j].min, k.def.params[j].max);
  const pts = (w, hh) => envPts(w, hh, k.get(a), k.get(d), s == null ? null : k.get(s), r == null ? 0 : k.get(r), PAD);
  const hs = (q) => (s == null ? [[1, q[1]], [2, q[2]]] : [[1, q[1]], [2, q[2]], [4, q[4]]]);
  let box = null;
  box = disp(k, (g, w, hh) => {
    for (let j = 1; j < 8; j++) vl(g, w * j / 8, 0, hh, j % 2 ? '#2e2e31' : DISPC.grid);
    hl(g, hh - PAD, 0, w, DISPC.grid2);
    const q = pts(w, hh);
    if (s != null) { g.setLineDash([2, 3]); g.strokeStyle = DISPC.grid2; g.lineWidth = 1; g.beginPath(); g.moveTo(q[2][0], q[2][1] + 0.5); g.lineTo(w, q[2][1] + 0.5); g.stroke(); g.setLineDash([]); }
    lvPath(g, q, col, hh - PAD, 1.9);
    for (const [, p] of hs(q)) lvRing(g, p[0], p[1], 4.2);
    if (lab) txt(g, lab(), w - 6, 13, col, 9, 'right');
  }, {
    onDown: (x, y) => { const c = box.cv, q = pts(c._w, c._h); let n = 1, bd = 1e9; for (const [m, p] of hs(q)) { const dd = Math.hypot(p[0] - x, p[1] - y); if (dd < bd) { bd = dd; n = m; } }
      return { n, A: k.get(a), D: k.get(d), S: s == null ? 0 : k.get(s), R: r == null ? 0 : k.get(r), H: c._h }; },
    onMove: (x, y, dx, dy, st) => { const f = Math.pow(2, dx / 28);
      if (st.n === 1) k.set(a, lim(a, st.A * f));
      else if (st.n === 2) { k.set(d, lim(d, st.D * f)); if (s != null) k.set(s, clamp(st.S - dy / Math.max(20, st.H - 3 * PAD), 0, 1)); }
      else if (r != null) k.set(r, lim(r, st.R * f)); },
  });
  return box;
}

// ---- filter response in dB over a log frequency axis, handle at the cutoff; drag: cutoff (x) / resonance (y).
// type(): -1 off, 0 low-pass, 1 high-pass, 2 band-pass; two(): 24 dB slope (GMS LP 24: two stages, half resonance each, as the engine)
function filt(k, cut, res, type, two) {
  let box = null;
  box = disp(k, (g, w, hh) => {
    const top = 4, bot = hh - 13, Y = (db) => top + (18 - clamp(db, -48, 18)) / 66 * (bot - top);
    freqAxis(g, w, hh, top, bot); hl(g, Y(0), 0, w, DISPC.grid2);
    const t = type(), f = cutHz(k.get(cut)), dbl = !!(two && two()), q = 0.5 + Math.pow(k.get(res) / 100 * (dbl ? 0.5 : 1), 2) * 18, bq = new Biquad();
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
    const sh = Math.round(k.get(o.shape)), a = o.amt == null ? 1 : k.get(o.amt) / 100, mode = o.mode == null ? 2 : Math.round(k.get(o.mode));
    const per = mode === 2 ? syncBeats(k.get(o.sync)) * 60 / (P.state.bpm || 120) : 1 / Math.max(0.01, k.get(o.rate));
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

// ---- GMS oscillators: A (white, faint), B (cyan, faint) and the output (bright) with balance and the modulation kind as the engine
// computes it: Mix, FM (B moves A's phase), Ring (A x B), Sync (B restarts with A, its rate raised by the amount)
function gmsOsc(k) {
  return disp(k, (g, w, hh) => {
    const A = gmsWaveTable(k.get(7)), B = gmsWaveTable(k.get(8)), N = 2048, rd = (t, p) => t[Math.floor((p - Math.floor(p)) * N) % N];
    const ratio = Math.pow(2, (k.get(9) + k.get(10) / 100) / 12), ph0 = k.get(11), bal = (k.get(12) + 100) / 200, kind = Math.round(k.get(15)), m = clamp(k.get(14) / 100, 0, 1);
    const mid = hh / 2, amp = mid - 18, pa = [], pb = [], po = [];
    vl(g, w / 2, 0, hh); hl(g, mid, 0, w, DISPC.grid2);
    for (let x = 0; x <= w; x++) {
      const p = x / w * 2, fa = p - Math.floor(p), q = kind === 3 ? fa * ratio * Math.pow(2, m * 3) : ph0 + p * ratio;
      const b = rd(B, q), a0 = rd(A, p);
      let a = kind === 1 ? rd(A, p + b * m * 0.6) : a0;
      if (kind === 2) a = a * (1 - m) + a * b * m;
      pa.push([x, mid - a0 * amp]); pb.push([x, mid - b * amp]); po.push([x, mid - (a * (1 - bal) + b * bal) * amp]);
    }
    lvPath(g, pa, 'rgba(242,242,242,.25)', null, 1.2); lvPath(g, pb, 'rgba(79,195,240,.4)', null, 1.2); lvPath(g, po, WH, null, 1.8);
    const ta = 'A ' + item(k, 7); txt(g, ta, 6, 13, WH); g.font = '600 9px system-ui,sans-serif'; txt(g, 'B ' + item(k, 8), 18 + g.measureText(ta).width, 13, CY);
    txt(g, item(k, 15) + ' ' + Math.round(m * 100), w - 6, 13, OR, 9, 'right');
  });
}
// ---- MiniSynth: the oscillator kind's wave with the Modifier applied, the same formulas as the engine (pulse width, second voice pitch up
// to +24 st, SuperSaw detune, spread voices), drawn at full height
const SS8 = [0, -1, 1, -0.6, 0.6, -0.3, 0.3, -0.85];
function miniWave(k) {
  return disp(k, (g, w, hh) => {
    const kind = Math.round(k.get(0)), m = k.get(1) / 100, fr = (p) => p - Math.floor(p), saw = (p) => 2 * fr(p) - 1, pul = (p, pw = 0.5) => (fr(p) < pw ? -1 : 1);
    const r2 = Math.pow(2, m * 2), pw = 0.5 - m * 0.45, sp = Math.pow(2, ((kind === 8 ? 12 : 7) + m * 0.25) / 12), mid = hh / 2, vs = [];
    vl(g, w / 2, 0, hh); hl(g, mid, 0, w, DISPC.grid2);
    for (let x = 0; x <= w; x++) {
      const p = x / w * 2; let v;
      switch (kind) {
        case 0: v = 0.6 * saw(p) + 0.4 * pul(p, pw); break; case 1: v = saw(p) + saw(p * r2); break; case 2: v = pul(p) + pul(p + m * 0.5); break;
        case 3: v = pul(p) + saw(p * r2); break; case 4: v = pul(p) + pul(p * r2); break;
        case 5: v = 0; for (let u = 0; u < 8; u++) v += saw(p * Math.pow(2, SS8[u] * m * 0.5 / 12) + u * 0.137); break;
        case 6: v = 0.7 * saw(p) + m * 0.6 * Math.sin(6 * Math.PI * p) * Math.sin(2 * Math.PI * p); break;
        case 7: v = saw(p) + saw(p + 0.15 + m * 0.35); break; default: v = saw(p) + saw(p * sp);
      }
      vs.push(v);
    }
    const pk = Math.max(0.05, ...vs.map(Math.abs)), A = mid - 18;
    lvPath(g, vs.map((v, x) => [x, mid - v / pk * A]), WH, null, 1.8);
    txt(g, item(k, 0), 6, 13, WH); txt(g, 'Modifier ' + Math.round(m * 100), w - 6, 13, OR, 9, 'right');
  });
}
// ---- SuperSaw oscillator: one voice (saw / pulse, Supersync with the sync amount and its own pulse width) and the sub oscillator
function ssWave(k) {
  return disp(k, (g, w, hh) => {
    const pm = k.get(0) > 0.5, sync = Math.round(k.get(1)) === 1, pw = clamp(k.get(sync ? 11 : 3) / 100, 0.02, 0.98), r2 = Math.pow(2, clamp(k.get(10) / 100, 0, 1) * 4), sub = k.get(4) / 100;
    const mid = hh / 2, amp = mid - 18, pts = [], sp = [];
    vl(g, w / 2, 0, hh); hl(g, mid, 0, w, DISPC.grid2);
    for (let x = 0; x <= w; x++) {
      const p = x / w * 2, q = p - Math.floor(p); let v;
      if (sync) { const s = (q * r2) % 1; v = pm ? (s < pw ? 1 : -1) : 2 * s - 1; } else v = pm ? (q < pw ? -1 : 1) : 2 * q - 1;
      pts.push([x, mid - v * amp]); const s2 = p / 2; sp.push([x, mid - (2 * (s2 - Math.floor(s2)) - 1) * amp * sub]);
    }
    if (sub > 0) lvPath(g, sp, 'rgba(255,173,50,.6)', null, 1.3);
    lvPath(g, pts, WH, null, 1.8);
    txt(g, (sync ? 'Supersync' : 'Supersaw') + (pm ? ' · Pulse' : ''), 6, 13, WH); if (sub > 0) txt(g, 'Sub ' + Math.round(sub * 100), w - 6, 13, OR, 9, 'right');
  });
}
// ---- voices in the stereo field: x = pan, y = pitch offset; SuperSaw unison (detune in cents, spread curve, unison pan) and GMS
// voices (scale intervals + chorus detune / stereo, keyboard below with the notes a C4 plays)
function ssUnison(k) {
  return disp(k, (g, w, hh) => {
    const nu = clamp(Math.round(k.get(5)) + 1, 1, 9), det = k.get(6) / 100, upan = k.get(7) / 100, ex = Math.pow(2, (0.5 - k.get(8) / 100) * 2.5), mid = hh / 2, A = mid - 16;
    vl(g, w / 2, 4, hh - 4, DISPC.grid2); hl(g, mid, 0, w, DISPC.grid2); hl(g, mid - A, 0, w); hl(g, mid + A, 0, w);
    txt(g, '+100 ct', 6, mid - A - 3); txt(g, '-100 ct', 6, mid + A + 11); txt(g, 'L', 6, mid - 4, DISPC.ink, 9); txt(g, 'R', w - 6, mid - 4, DISPC.ink, 9, 'right');
    for (let u = 0; u < nu; u++) {
      const x0 = nu === 1 ? 0 : u / (nu - 1) * 2 - 1, off = Math.sign(x0) * Math.pow(Math.abs(x0), ex), px = w / 2 + x0 * upan * (w / 2 - 16), py = mid - off * det * A;
      g.fillStyle = 'rgba(79,195,240,.5)'; g.fillRect(Math.round(px), Math.min(mid, py), 1, Math.abs(py - mid)); lvRing(g, px, py, 4);
    }
    txt(g, nu === 1 ? 'Single' : nu + ' voices', w - 6, 13, WH, 9, 'right');
  });
}
const GMS_SCALE = [[0, 0, 0, 0], [0, 7, 12, 19], [0, 12, -12, 24]];
function gmsVoices(k) {
  return disp(k, (g, w, hh) => {
    const nv = clamp(Math.round(k.get(45)) + 1, 1, 4), sc = GMS_SCALE[clamp(Math.round(k.get(46)), 0, 2)], det = k.get(41) / 100 * 0.3, wide = k.get(42) / 100, tr = Math.round(k.get(39));
    const kb = clamp(Math.round(hh * 0.3), 18, 34), fh = hh - kb - 3, Y = (st) => 8 + (24 - st) / 36 * (fh - 16);
    vl(g, w / 2, 4, fh, DISPC.grid2);
    for (const [st, t] of [[24, '+24'], [12, '+12'], [0, '0'], [-12, '-12']]) { hl(g, Y(st), 0, w, st ? DISPC.grid : DISPC.grid2); txt(g, t, 4, Y(st) - 2, DISPC.ink, 8); }
    const vs = [];
    for (let u = 0; u < nv; u++) { const st = sc[u] + (u ? (u & 1 ? 1 : -1) * det * Math.ceil(u / 2) : 0), sp = nv > 1 ? (u / (nv - 1) * 2 - 1) * wide : 0; vs.push(st); const px = w / 2 + sp * (w / 2 - 22), py = Y(st); lvRing(g, px, py, 4.5); txt(g, (sc[u] > 0 ? '+' : '') + sc[u], px + 7, py + 3, CY, 8); }
    // keyboard C3..B6 (48 keys): the notes a C4 plays (transpose + intervals)
    const y0 = hh - kb, lo = 48, nW = 28, kw = w / nW, on = new Set(vs.map((st) => 60 + tr + Math.round(st)));
    let wi = 0;
    for (let n = lo; n < lo + 48; n++) { if ([1, 3, 6, 8, 10].includes(n % 12)) continue; g.fillStyle = on.has(n) ? CY : '#d8d8dc'; g.fillRect(Math.round(wi * kw) + 0.5, y0, Math.max(1, Math.round(kw) - 1), kb); wi++; }
    wi = 0;
    for (let n = lo; n < lo + 48; n++) { if ([1, 3, 6, 8, 10].includes(n % 12)) { g.fillStyle = on.has(n) ? CY : '#1c1c1e'; g.fillRect(Math.round(wi * kw - kw * 0.3), y0, Math.max(1, Math.round(kw * 0.6)), kb * 0.6); } else wi++; }
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
    if (!s) txt(g, zs.length ? 'Belum ada sample: ketuk zona di kiri' : 'Tambah zona di kiri', w / 2, mid - 6, DISPC.ink, 10, 'center');
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
  });
}
// ---- effects ----------------------------------------------------------------------------------------------------------------------
// delay taps over the beat grid: dry (grey), then each repeat at the tempo time, height = mix x feedback^n, fading with the filter
function taps(k, o) {
  return disp(k, (g, w, hh) => {
    const on = o.on == null || k.get(o.on) > 0.5, bt = syncBeats(k.get(o.time)), fb = clamp(k.get(o.fb) / 100 * 0.9, 0, 0.95), damp = clamp(k.get(o.filt) / 100, 0, 0.98), mix = k.get(o.mix) / 100;
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
    const gn = o.gain == null ? 1 : Math.pow(10, k.get(o.gain) / 20), dec = o.decim == null ? 0 : k.get(o.decim) / 100, hold = 1 + dec * 31, bits = Math.pow(2, 16 - dec * 12);
    const mid = hh / 2, sc = (mid - 10) / Math.max(1, gn), N = 220, pin = [], pout = [];
    hl(g, mid, 0, w, DISPC.grid2); hl(g, mid - sc, 0, w); hl(g, mid + sc, 0, w);
    for (let x = 0; x <= w; x++) {
      const n = x / w * N, nh = dec > 0 ? Math.floor(n / hold) * hold : n, s0 = Math.sin(2 * Math.PI * n / 110), s1 = Math.sin(2 * Math.PI * nh / 110);
      let v = dr > 0 ? Math.tanh(s1 * drive) * nrm : s1; if (dec > 0) v = Math.round(v * bits) / bits; v *= gn;
      pin.push([x, mid - s0 * sc]); pout.push([x, mid - clamp(v, -1.6, 1.6) * sc]);
    }
    lvPath(g, pin, DIM, null, 1.2); lvPath(g, pout, on ? OR : DISPC.grid2, null, 1.9);
    txt(g, 'Drive ' + Math.round(dr * 100) + (dec > 0 ? ' · Decim ' + Math.round(dec * 100) : '') + (gn !== 1 ? ` · ${(20 * Math.log10(gn)).toFixed(1)} dB` : ''), 6, 12, on ? WH : DISPC.ink, 9);
  }, null, { min: o.min });
}
// chorus: the two modulated delay lines (L sine, R cosine) over 2 s, depth = Mod, brightness = Mix
function chorusDisp(k, o) {
  return disp(k, (g, w, hh) => {
    const on = k.get(o.on) > 0.5, hz = 0.1 + k.get(o.rate) / 100 * 4, dep = k.get(o.mod) / 100, mix = k.get(o.mix) / 100, mid = hh / 2, A = (mid - 14) * Math.max(0.04, dep), L = [], R = [];
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
    const on = k.get(o.on) > 0.5, f0 = 80 + k.get(o.freq) / 100 * 1500, wd = k.get(o.width) / 100, fbk = k.get(o.fb) / 100 * 0.85, mix = k.get(o.mix) / 100;
    const f1 = Math.min(SR * 0.45, f0 * Math.pow(2, wd * 5)), fc = Math.min(SR * 0.45, f0 * Math.pow(2, wd * 2.5)), top = 4, bot = hh - 13, Y = (db) => top + (12 - clamp(db, -36, 12)) / 48 * (bot - top);
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
    txt(g, fmtHz(f0) + ' – ' + fmtHz(f1), 6, 13, on ? WH : DISPC.ink, 9);
  }, null, { min: o.min });
}
// GMS FX slot: X / Y pad (what X and Y do depends on the kind, as in the FLM guide), the LFO sweep of X in orange; drag the point
const GMS_XY = [['Drive', 'Tone'], ['Depth', 'Feedback'], ['Width', 'Feedback'], ['Cutoff', 'Reso'], ['Cutoff', 'Reso'], ['Feedback', 'Damp'], ['Size', 'Wet'], ['Pan', 'Width'], ['Freq', '-'], ['Vowel', 'Shift']];
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
      txt(g, (k.get(48) > 0.5 ? 'Mono' : 'Poly ' + Math.round(k.get(43))) + (k.get(46) > 0.5 ? ' · Legato' : ''), w - 6, 13, DISPC.ink, 9, 'right');
      return;
    }
    const rng = clamp(Math.round(k.get(50)) + 1, 1, 4), step = syncBeats(k.get(49)), held = [60, 64, 67], n = held.length, total = n * rng;
    const span = 8, steps = Math.min(96, Math.max(1, Math.floor(span / step + 1e-6))), lo = 60, hi = 67 + 12 * (rng - 1), top = 18, bot = hh - 6;
    const Y = (p) => bot - (p - lo + 1) / (hi - lo + 2) * (bot - top), rowH = Math.max(2, (bot - top) / (hi - lo + 2) - 1);
    for (let b = 0; b <= span; b++) vl(g, 6 + b / span * (w - 12), top - 4, bot, b % 4 ? DISPC.grid : DISPC.grid2);
    let seed = 0x2545f491;
    for (let s = 0; s < steps; s++) {
      let idx;
      if (mode === 1) idx = s % total; else if (mode === 2) idx = total - 1 - (s % total);
      else if (mode === 3) { const cyc = Math.max(1, total * 2 - 2), q = s % cyc; idx = q < total ? q : cyc - q; }
      else { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; idx = (seed >>> 8) % total; }
      const p = held[idx % n] + 12 * Math.floor(idx / n), x = 6 + s * step / span * (w - 12), ww = Math.max(1.5, step / span * (w - 12) - 1.5);
      g.fillStyle = CY; g.fillRect(x + 0.5, Y(p) - rowH / 2, ww, rowH);
    }
    txt(g, item(k, 51) + ' · ' + item(k, 49) + ' · ' + item(k, 50), 6, 13, WH, 9);
  });
}

// ================================================================================================ panels
export function addFlmPanels(VI) {
  // DirectWave: zones (sample / root / key and velocity range / level / pan) are edited in the zone list next to this panel
  VI[30] = (k) => tabs(k, ['SAMPLE', 'FILTER', 'FLT ENV', 'FRQ ENV', 'LFO'], [
    () => [FS('Sample', [dwSample(k)], { w: 2 }),
      FS('Pitch', [KN(k, 0, 'Pitch'), KN(k, 1, 'Fine Tune'), FC('PB Range', k.N(7, { w: 58 })), KN(k, 6, 'Slide Time')]),
      FS('Amp Envelope', [env(k, 2, 3, 4, 5), ...ADSR(k, 2, 3, 4, 5)]),
      FS('Playback', [FT(TG(k, 8, 'Reverse', 70), TG(k, 9, 'Loop', 70)), FT(TG(k, 10, 'Legato', 70), TG(k, 11, 'Mono', 70))]),
      FS('Output', [KN(k, 34, 'Level', { big: true })])],
    () => [FS('Filter', [filt(k, 12, 13, () => Math.round(k.get(16)) - 1), KN(k, 12, 'Cutoff', { big: true }), KN(k, 13, 'Resonance'), KN(k, 14, 'Kbd Trk'), KN(k, 15, 'Vel Trk')]),
      FS('Type', [CHV(k, 16, ['Off', 'Lowpass', 'Highpass', 'Bandpass'])])],
    () => [FS('Filter Envelope', [env(k, 17, 18, 19, 20, OR, () => 'Amount ' + Math.round(k.get(21))), ...ADSR(k, 17, 18, 19, 20), KN(k, 21, 'Amount', { big: true })])],
    () => [FS('Frequency Envelope', [env(k, 22, 23, 24, 25, OR, () => 'Amount ' + Math.round(k.get(26)) + '  =  ' + (k.get(26) / 100 * 12).toFixed(1) + ' st'), ...ADSR(k, 22, 23, 24, 25), KN(k, 26, 'Amount', { big: true })])],
    () => [FS('Mode', [CHV(k, 27, ['Hertz', 'One Shot', 'Tmp Sync'])]),
      FS('LFO', [lfo(k, { shape: 30, amt: 32, mode: 27, rate: 28, sync: 29, att: 31 }), lfoRate(k, 27, 28, 29), SEL(k, 30, 'Shape', 76), KN(k, 31, 'Attack'), KN(k, 32, 'Amount')]),
      FS('Destination', [CHV(k, 33, ['Filter', 'Frequency', 'Level', 'Pan'])])],
  ]);
  VI[31] = (k) => tabs(k, ['FILTER', 'OSC', 'MOD', 'LEVEL', 'EG', 'LFO', 'VOICES', 'FX'], [
    () => [FS('Filter', [filt(k, 0, 1, () => [0, 0, 1][Math.round(k.get(6))] ?? 0, () => Math.round(k.get(6)) === 1), KN(k, 0, 'Cutoff', { big: true }), KN(k, 1, 'Res')]),
      FS('Mode', [STACK(CHV(k, 6, ['LP 12', 'LP 24', 'HP']), TG(k, 5, 'Kbd', 72))]),
      FS('Filter Envelope', [env(k, 2, 3, null, null, OR, () => 'Amount ' + Math.round(k.get(4))), KN(k, 2, 'Attack'), KN(k, 3, 'Decay'), KN(k, 4, 'Amount', { big: true })])],
    () => [FS('Oscillators', [SEL(k, 7, 'Osc A', 100), SEL(k, 8, 'Osc B', 100), gmsOsc(k)]),
      FS('Osc B', [KN(k, 9, 'Pitch B'), KN(k, 10, 'Fine B'), KN(k, 11, 'Phase B')]), FS('Mix', [KN(k, 12, 'Balance'), KN(k, 13, 'Noise')])],
    () => [FS('Modulation', [CHV(k, 15, ['Mix', 'FM', 'Ring', 'Sync']), KN(k, 14, 'Amount', { big: true }), gmsOsc(k)]),
      FS('Mod Envelope', [env(k, 16, 17, null, null, OR, () => 'EG Amount ' + Math.round(k.get(18))), KN(k, 16, 'Attack'), KN(k, 17, 'Decay'), KN(k, 18, 'EG Amount')]),
      FS('Wheels', [FC('PB Range', k.N(19, { w: 58 })), SEL(k, 20, 'MW Dest', 82), KN(k, 21, 'MW Amount')])],
    () => [FS('Output', [KN(k, 22, 'Level', { big: true }), KN(k, 23, 'Pan')]),
      FS('Amp Envelope', [env(k, 24, 25, 26, 27), ...ADSR(k, 24, 25, 26, 27)])],
    () => [FS('Envelope Generator', [env(k, 29, 30, 31, 32, OR, () => 'Contour ' + Math.round(k.get(28)) + ' → ' + item(k, 34)), ...ADSR(k, 29, 30, 31, 32)]),
      FS('Routing', [KN(k, 28, 'Contour', { big: true }), FT(TG(k, 33, 'Vel', 72)), CHV(k, 34, ['Filter', 'Osc. Mod', 'Pitch'])])],
    () => [FS('LFO', [lfo(k, { shape: 36, amt: 35, sync: 38 }), KN(k, 35, 'Amount', { big: true }), SEL(k, 38, 'Rate', 76), SEL(k, 36, 'Shape', 76)]),
      FS('Destination', [CHV(k, 37, ['FLT', 'OSC', 'PITCH'])])],
    () => [FS('Voices', [SEL(k, 45, 'Voices', 76), SEL(k, 46, 'Scale', 76), gmsVoices(k)]), FS('Chorus', [KN(k, 41, 'Detune'), KN(k, 42, 'Stereo')]),
      FS('Glide', [KN(k, 39, 'Transpose'), KN(k, 40, 'Slide'), FT(TG(k, 43, 'Mono', 70), TG(k, 44, 'Auto', 70))])],
    () => [0, 1, 2].map((s) => { const o = 47 + s * 7; return FS('FX ' + (s + 1), [SEL(k, o + 1, 'Kind', 74), SEL(k, o + 5, 'LFO Rate', 74), KN(k, o + 3, 'X'), KN(k, o + 4, 'Y'), KN(k, o + 2, 'LFO Amt'), SEL(k, o + 6, 'Shape', 60), fxPad(k, o)], { sw: SW(k, o) }); }),
  ]);
  VI[32] = (k) => tabs(k, ['OSC', 'FILTER', 'FLT EG', 'LFO', 'MASTER', 'FX'], [
    () => [FS('Oscillator', [SEL(k, 0, 'Kind', 116), KN(k, 1, 'Modifier', { big: true }), miniWave(k)]),
      FS('Tone', [KN(k, 2, 'Noise'), KN(k, 3, 'Transpose')]), FS('Output', [KN(k, 43, 'Level', { big: true })])],
    () => [FS('Filter', [filt(k, 4, 7, () => 0), KN(k, 4, 'Cutoff', { big: true }), KN(k, 7, 'Res'), KN(k, 5, 'Kbd Trk'), KN(k, 6, 'Vel Trk')])],
    () => [FS('Filter Envelope', [env(k, 8, 9, 10, 11, OR, () => 'Amount ' + Math.round(k.get(12))), ...ADSR(k, 8, 9, 10, 11), KN(k, 12, 'Amount', { big: true })])],
    () => [FS('LFO', [lfo(k, { shape: 15, amt: 13, sync: 14 }), KN(k, 13, 'Amount', { big: true }), SEL(k, 14, 'Rate', 70), SEL(k, 15, 'Shape', 70), SEL(k, 16, 'Dest', 70)]),
      FS('Mod Wheel', [KN(k, 17, 'Amount'), SEL(k, 18, 'Dest', 70)])],
    () => [FS('Master Envelope', [env(k, 19, 20, 21, 22), ...ADSR(k, 19, 20, 21, 22)]),
      FS('Voices', [CHV(k, 23, ['Poly', 'Mono', 'Lead']), KN(k, 24, 'Slide')])],
    () => [FS('Distortion', [KN(k, 26, 'Drive'), KN(k, 27, 'Decim'), distWave(k, { on: 25, drive: 26, dmax: 20, decim: 27, min: 84 })], { sw: SW(k, 25) }),
      FS('Delay', [SEL(k, 32, 'Time', 58), KN(k, 31, 'Mix'), KN(k, 29, 'Feedback'), KN(k, 30, 'Filter'), taps(k, { on: 28, time: 32, fb: 29, filt: 30, mix: 31, min: 84 })], { sw: SW(k, 28) }),
      FS('Chorus', [KN(k, 34, 'Rate'), KN(k, 35, 'Mod'), KN(k, 36, 'Mix'), chorusDisp(k, { on: 33, rate: 34, mod: 35, mix: 36, min: 84 })], { sw: SW(k, 33) }),
      FS('Phaser', [KN(k, 38, 'Speed'), KN(k, 39, 'Width'), KN(k, 40, 'Feedback'), KN(k, 41, 'Freq'), KN(k, 42, 'Mix'), phaserDisp(k, { on: 37, width: 39, fb: 40, freq: 41, mix: 42, min: 84 })], { sw: SW(k, 37) })],
  ]);
  VI[33] = (k) => tabs(k, ['OSC', 'FILTER', 'LFO', 'LEVEL', 'MOD', 'VOICES', 'FX'], [
    () => [FS('Oscillator', [STACK(CHV(k, 1, ['Supersaw', 'Supersync']), TG(k, 0, 'Pulse Mode', 72), TG(k, 2, 'Retrig', 72)), KN(k, 3, 'Pulse Width'), KN(k, 4, 'Sub Osc'), ssWave(k)]),
      FS('Unison', [SEL(k, 5, 'Voices', 66), KN(k, 9, 'Phase'), KN(k, 6, 'Detune', { big: true }), KN(k, 8, 'Spread'), KN(k, 7, 'Pan'), ssUnison(k)]),
      FS('Supersync', [KN(k, 10, 'Sync', { big: true }), KN(k, 11, 'Sync PW'), KN(k, 16, 'Amount'), FT(TG(k, 17, 'Flip', 56))]),
      FS('Sync Envelope', [...ADSR(k, 12, 13, 14, 15)])],
    () => [FS('Filter', [filt(k, 18, 19, () => 0), KN(k, 18, 'Cutoff', { big: true }), KN(k, 19, 'Res'), KN(k, 20, 'Kbd Trk'), KN(k, 21, 'Vel Trk')]),
      FS('Filter Envelope', [env(k, 22, 23, 24, 25, OR, () => 'Amount ' + Math.round(k.get(26))), ...ADSR(k, 22, 23, 24, 25), KN(k, 26, 'Amount', { big: true })])],
    () => [FS('Mode', [CHV(k, 27, ['Hertz', 'One Shot', 'Tmp Sync'])]),
      FS('LFO', [lfo(k, { shape: 30, amt: 32, mode: 27, rate: 28, sync: 29, att: 31 }), lfoRate(k, 27, 28, 29), SEL(k, 30, 'Shape', 76), KN(k, 31, 'Attack'), KN(k, 32, 'Amount')]),
      FS('Destination', [SEL(k, 33, 'Target', 108)])],
    () => [FS('Output', [KN(k, 34, 'Level', { big: true }), KN(k, 35, 'Pan')]),
      FS('Amp Envelope', [env(k, 36, 37, 38, 39), ...ADSR(k, 36, 37, 38, 39)])],
    () => [FS('Pitch Wheel', [FC('PW Range', k.N(40, { w: 58 }))]), FS('Mod Wheel', [KN(k, 41, 'Amount', { big: true }), SEL(k, 42, 'Dest', 108)]), FS('Wheels', [ssWheels(k)])],
    () => [FS('Voices', [FC('Poly', k.N(43, { w: 58 })), KN(k, 44, 'Transpose')]),
      FS('Glide', [KN(k, 45, 'Slide'), STACK(TG(k, 46, 'Legato'), TG(k, 47, 'Constant'), TG(k, 48, 'Mono Mode'))]),
      FS('Arpeggiator', [SEL(k, 51, 'Mode', 92), SEL(k, 49, 'Rate', 70), SEL(k, 50, 'Range', 70), ssArp(k)])],
    () => [FS('Distortion', [KN(k, 52, 'Drive', { big: true }), KN(k, 53, 'Gain'), distWave(k, { drive: 52, dmax: 25, gain: 53 })]),
      FS('Delay', [SEL(k, 54, 'Time', 64), KN(k, 55, 'Feedback'), KN(k, 56, 'Filter'), KN(k, 57, 'Mix', { big: true }), taps(k, { time: 54, fb: 55, filt: 56, mix: 57 })])],
  ]);
}
