// Arrangement view: ruler, track headers, clips, playhead. One canvas, all hit-testing by hand.
// Gestures follow FL Studio Mobile (tap clip = controls, double-tap = editor, long-tap = menus,
// right-edge handle = resize, ruler drag = time selection) on an Ableton-style layout.
import { C, T } from './theme.js';
import { attachGestures } from './gesture.js';
import { bar, menu, ask, modal, toast, clamp } from './ui.js';
import { checkpoint } from './history.js';
import { prefs, savePrefs } from './prefs.js';
import { wavePath, peaksPath } from './waveform.js';
import * as P from './project.js';
import { BAR, BEAT } from './project.js';   // live bindings (they follow the time signature)
import { pickColor } from './colorpick.js';
import { MASTER, RET0 } from './engine.js';
import { INSTRUMENTS, DEVICES } from './defs.js';
const { state, PPQ, COLORS } = P;

const HEAD = 132, NAMEW = 68, RULER = 28, HANDLE = 18, MROW = 10;       // track headers sit on the RIGHT of the clip area, like the Live reference
const FOLD_H = 28, MIN_ROW = 56, ADD_H = 34, XROW_H = 44;                  // folded row / smallest unfolded row (name + buttons + volume fit) / "+" row
export const view = { x0: 0, ppt: 0.06, y0: 0, rowH: 72 };
let CW = 0;                                                    // width of the clip area = canvas width - HEAD
const sn = (n, f) => ({ 0: n, get 1() { return f(); } });   // snap values are read live: BAR / BEAT change with the time signature
const SNAPS = [sn('Auto', () => -1), sn('Bar', () => BAR), sn('1 Beat', () => BEAT), sn('1/2 Beat', () => BEAT / 2), sn('1/4 Beat', () => BEAT / 4), sn('Triplet', () => BEAT / 3), sn('Off', () => 0)];
const cfg = { snap: prefs.snap, follow: prefs.follow };
export function applyTimelinePrefs() { cfg.snap = prefs.snap; cfg.follow = prefs.follow; invalidate(); }
let marq = null, clipM = null, selbar = null, selW = 0;   // marq = rubber-band rectangle in world coordinates (tick, content-y) so it survives scrolling
let stretchMode = false;                                       // audio clips: the right handle stretches the audio (keeps pitch) instead of trimming
export const isStretch = () => stretchMode;
const live = new Map();                                        // clip id -> stretch factor while dragging / rendering (the old waveform is scaled so the clip never jumps)
const msel = new Set();   // ids of the picked clips: long-press a clip, or long-press an empty spot and drag a rectangle (no mode button)
let canvas, ctx, W = 0, H = 0, dpr = 1, dirty = true, hooks = {}, sel = null, touchedAt = 0;

export const invalidate = () => { dirty = true; };
export function snapTicks() {
  const m = SNAPS[cfg.snap][1];
  if (m >= 0) return m;
  for (const t of [120, 240, 480, 960, 1920, 3840, 7680, 15360]) if (t * view.ppt >= 26) return t;
  return 15360;
}
// grid ticks in [a, b) aligned to the start of each signature segment (with a single signature this is the plain grid)
function eachGrid(a, b, g, fn) {
  const M = P.MM;
  for (let j = M.segOfTick(Math.max(0, a)); j < M.m; j++) {
    const s0 = M.T[j], e0 = j + 1 < M.m ? M.T[j + 1] : Infinity;
    if (s0 >= b) break;
    const hi = Math.min(b, e0);
    for (let t = s0 + Math.max(0, Math.floor((a - s0) / g)) * g; t < hi; t += g) fn(t, j);
  }
}
const snapT = (t) => {
  const s = snapTicks(); if (!s) return Math.round(t);
  if (!P.state.sigs.length) return Math.round(t / s) * s;
  if (SNAPS[cfg.snap][0] === 'Bar') return Math.round(P.barRound(t));
  const M = P.MM, j = M.segOfTick(Math.max(0, t)), s0 = M.T[j], e0 = j + 1 < M.m ? M.T[j + 1] : Infinity;   // steps restart at every signature change
  return Math.round(Math.max(s0, Math.min(e0, s0 + Math.round((t - s0) / s) * s)));
};
const gridT = () => { for (const t of [120, 240, 480, 960, 1920, 3840, 7680, 15360, 30720]) if (t * view.ppt >= 14) return t; return 30720; };
const tx = (tick) => (tick - view.x0) * view.ppt;
const xt = (x) => view.x0 + x / view.ppt;
// rows have individual heights: a folded track is FOLD_H tall, the others view.rowH
// below the tracks: the Master row and one row per effect track (Return A/B stay in the mixer), then the "+" row
const snapRect = () => ({ x: CW + 5, y: 3, w: HEAD - 10, h: RULER - 7 });
const badges = () => (CW < 150 ? [] : [['gridbtn', SNAPS[cfg.snap][0], { x: CW - 124, y: H - 28, w: 58, h: 22 }], ['zoombtn', (view.ppt / 0.06).toFixed(2) + 'x', { x: CW - 62, y: H - 28, w: 54, h: 22 }]]);
let pressed = null;                                           // which corner / badge button is under the finger (drawn highlighted)
const nX = () => 1 + Math.max(0, state.returns.length - 2);
const xInfo = (i) => { const j = i - state.tracks.length; return j === 0 ? { master: true, strip: MASTER, name: 'MASTER', color: state.master.color || '#4cd964', obj: state.master } : { master: false, k: j + 1, strip: RET0 + j + 1, name: state.returns[j + 1].name, color: state.returns[j + 1].color || '#35d0e0', obj: state.returns[j + 1] }; };
const rh = (i) => (i >= state.tracks.length + nX() ? ADD_H : i === state.tracks.length ? FOLD_H : i > state.tracks.length ? XROW_H : state.tracks[i].fold ? FOLD_H : view.rowH);
function rowY(i) { let y = RULER - view.y0; for (let k = 0; k < i; k++) y += rh(k); return y; }
function rowAt(y) { let a = RULER - view.y0; const n = state.tracks.length + nX(); for (let i = 0; i <= n; i++) { const e = a + rh(i); if (y < e) return i; a = e; } return n + 1; }
const contentH = () => { let y = 0; for (let i = 0; i <= state.tracks.length + nX(); i++) y += rh(i); return y; };
// Header layout of one track. Controls only appear when the row is tall enough, so nothing can overlap.
function hdr(i) {
  const t = state.tracks[i], y = rowY(i), h = rh(i), x = CW + NAMEW, auto = t.kind === 'auto';
  const r = { y, h, fold: { x: CW, y, w: 26, h: Math.min(h, 26) }, mute: { x: x + 3, y: y + 2, w: auto ? 58 : 28, h: 24 }, solo: auto ? null : { x: x + 33, y: y + 2, w: 28, h: 24 } };
  if (!t.fold) { if (h >= 48) r.vol = { x: x + 4, y: y + 31, w: 56, h: 13 }; if (h >= 64) r.pan = { x: x + 4, y: y + 47, w: 56, h: 13 }; }
  if (!t.fold && !auto && h >= 64) {                                   // status badges in the name block (Live: Arm, Monitor) + automation lane toggle
    const by = y + h - 23, mon = t.kind !== 'audio';
    r.arm = { x: CW + 2, y: by, w: 18, h: 18 };
    if (mon) r.mon = { x: CW + 22, y: by, w: 22, h: 18 };
    r.aut = { x: CW + (mon ? 46 : 22), y: by, w: 16, h: 18 };
  }
  return r;
}
const inRect = (r, x, y, p = 0) => x >= r.x - p && x <= r.x + r.w + p && y >= r.y - p && y <= r.y + r.h + p;

function clampView() {
  view.x0 = Math.max(0, view.x0);                           // the arrangement starts flush at the left edge: tick 0 is the first pixel, clips can reach it
  view.y0 = clamp(view.y0, 0, Math.max(0, contentH() - (H - RULER) + 20));
}

// ------------------------------------------------------------------ drawing
function noteBox(c) {
  let lo = 127, hi = 0;
  for (const n of c.notes) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
  if (lo > hi) { lo = 48; hi = 72; }
  if (hi - lo < 11) { const m = (hi + lo) / 2; lo = m - 6; hi = m + 6; }
  return [lo, hi];
}

function washRgba(hex, a) { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex)); if (!m) return `rgba(128,128,128,${a})`; const v = parseInt(m[1], 16); return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`; }
const shadeCache = new Map();
function shade(hex, k) {                 // darken a colour by k (0..1): Live's clip title strip is a deeper tone of the track colour
  const key = hex + k; let r = shadeCache.get(key);
  if (r) return r;
  const n = parseInt(hex.slice(1, 7), 16), m = (v) => Math.round(v * (1 - k));
  r = `rgb(${m(n >> 16)},${m((n >> 8) & 255)},${m(n & 255)})`; shadeCache.set(key, r); return r;
}
// Right-edge resize of MIDI / drum / audio clips: pulling a clip longer than its content makes the content repeat (c.ll = repeat length)
function applyLoop(c, ll0, len0, hadLl) {
  if (c.pts) return;
  if (c.len === len0 && !hadLl) return;
  if (c.len === ll0 && !hadLl) { delete c.ll; delete c.lp; } else c.ll = ll0;
}
const tintCache = new Map();
function tint(hex, k) {                 // mix a colour with white by k (0..1): Live's clip body is a pale tone of the track colour under a saturated title strip
  const key = hex + k; let r = tintCache.get(key);
  if (r) return r;
  const n = parseInt(hex.slice(1, 7), 16), m = (v) => Math.round(v + (255 - v) * k);
  r = `rgb(${m(n >> 16)},${m((n >> 8) & 255)},${m(n & 255)})`; tintCache.set(key, r); return r;
}
const INK0 = 'rgba(12,12,18,.72)';

function drawClip(t, c, y, hh) {
  const x = tx(c.start), w = c.len * view.ppt;
  if (x > CW || x + w < 0) return;
  const xs = Math.max(x, 0), xe = Math.min(x + w, CW);
  const isSel = state.sel.clip === c.id || msel.has(c.id);
  const tall = hh >= 44, hd = tall ? 13 : 0;                 // folded / short rows: no title strip, only colour + content
  ctx.save();
  ctx.beginPath(); ctx.rect(0, RULER, CW, H - RULER); ctx.clip();
  ctx.fillStyle = c.muted ? C('#a9a9ae') : tint(t.color, tall ? 0.42 : 0.2); ctx.fillRect(x, y + 1, w, hh - 2);   // pale body, like Live
  if (tall) { ctx.fillStyle = c.muted ? C('#85858a') : t.color; ctx.fillRect(x, y + 1, w, hd); }                   // saturated title strip
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x, y + 1, 1, hh - 2); ctx.fillRect(x + w - 1, y + 1, 1, hh - 2); ctx.fillRect(x, y + 1, w, 1); ctx.fillRect(x, y + hh - 2, w, 1);
  if (tall && w > 20) { ctx.fillStyle = INK0; ctx.font = '600 10px system-ui'; ctx.textBaseline = 'middle'; ctx.fillText(c.name || (c.sample ? c.sample.name : t.name), Math.max(x, 0) + 4, y + 1 + hd / 2 + 0.5, Math.max(0, xe - xs - 8)); }
  const by = y + 3 + hd, bh = hh - 6 - hd, INK = c.muted ? 'rgba(12,12,18,.38)' : INK0;
  if (t.kind === 'auto' && c.pts && bh > 8) {
    const pts = [...c.pts].sort((a, b) => a.t - b.t), yy = (v) => by + bh - v * bh;
    ctx.fillStyle = 'rgba(12,12,18,.16)'; ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(x, yy(pts[0].v));
    for (const p of pts) ctx.lineTo(x + p.t * view.ppt, yy(p.v));
    ctx.lineTo(x + w, yy(pts[pts.length - 1].v)); ctx.stroke();
    ctx.lineTo(x + w, by + bh); ctx.lineTo(x, by + bh); ctx.closePath(); ctx.fill();
  } else if (t.kind === 'audio' && (c.dsample || c.sample) && ((c.dsample || c.sample).pyr || (c.dsample || c.sample).peaks) && bh > 8) {
    const es = c.dsample || c.sample, lk = live.get(c.id) || 1, o = c.offset || 0;
    ctx.fillStyle = INK;
    for (const g of P.loopSegs(c)) {                            // a clip longer than its audio repeats it: every repeat is drawn from the start of the content
      const sx = x + g.o * view.ppt, sw = g.len * view.ppt;
      if (sx > xe || sx + sw < xs) continue;
      const dur = (g.len / PPQ) * 60 / state.bpm / lk, px0 = Math.floor(Math.max(xs, sx)), px1 = Math.ceil(Math.min(xe, sx + sw));
      if (px1 <= px0) continue;
      const sec0 = o + (g.s / PPQ) * 60 / state.bpm / lk + (px0 - sx) / sw * dur, spp0 = dur / sw / es.duration;
      if (es.pyr) {
        const N = es.pyr.l.length;
        ctx.fill(wavePath(es.pyr, { x0: px0, x1: px1, s0: sec0 / es.duration * N, spp: spp0 * N, mid: by + bh / 2, amp: bh * 0.5 * 0.96 }));
      } else if (es.peaks) {
        const N = es.peaks.length;
        ctx.fill(peaksPath(es.peaks, { x0: px0, x1: px1, s0: sec0 / es.duration * N, spp: spp0 * N, mid: by + bh / 2, amp: bh * 0.5 * 0.96 }));
      }
    }
  } else if (c.notes && bh > 8) {
    const [lo, hi] = noteBox(c), span = hi - lo + 1, nh = Math.max(1.5, bh / span);
    ctx.fillStyle = INK;
    for (const g of P.loopSegs(c)) {                            // looped MIDI: the notes are drawn again in every repeat (no empty bars)
      const gx = x + g.o * view.ppt;
      if (gx > xe || gx + g.len * view.ppt < xs) continue;
      for (const n of c.notes) {
        if (n.t >= g.len) continue;
        const nx = gx + n.t * view.ppt, nw = Math.max(1.5, Math.min(n.d, g.len - n.t) * view.ppt);
        if (nx + nw < xs || nx > xe) continue;
        ctx.fillRect(nx, by + (hi - n.p) / span * bh, nw, nh);
      }
    }
  }
  if (c.ll > 0 && c.len > c.ll && w > 0) {                       // thin marks where the loop restarts
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    for (const g of P.loopSegs(c)) { if (!g.o) continue; const gx = x + g.o * view.ppt; if (gx >= xs && gx <= xe) ctx.fillRect(Math.round(gx), y + 1, 1, hh - 2); }
  }
  if (isSel) {
    ctx.strokeStyle = C('#fff'); ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 2, w - 2, hh - 4);
    const hy = y + hh / 2 - Math.min(12, hh / 2 - 4), hl = Math.min(24, hh - 8), st = stretchMode && t.kind === 'audio';
    ctx.fillStyle = C('#fff'); ctx.fillRect(x + 2, hy, 4, hl);
    if (st) { ctx.fillStyle = C('#ffa722'); ctx.fillRect(x + w - 10, hy - 2, 8, hl + 4); ctx.fillStyle = C('#1a1100'); ctx.fillRect(x + w - 8, hy + hl / 2 - 1, 4, 2); } else ctx.fillRect(x + w - 6, hy, 4, hl);
  }
  ctx.restore();
}

function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C('#1b1b1c'); ctx.fillRect(0, 0, W, H);
  const n = state.tracks.length, g = gridT();
  // rows
  for (let i = Math.max(0, rowAt(RULER)); i <= Math.min(n - 1, rowAt(H)); i++) {
    const y = rowY(i), h = rh(i);
    ctx.fillStyle = i % 2 ? C('#202022') : C('#232325'); ctx.fillRect(0, y, CW, h);
    ctx.fillStyle = C('#0e0e0f'); ctx.fillRect(0, y + h - 1, CW, 1);
  }
  const xl = [];                                                                       // captions of the Master / effect lanes, drawn after the grid
  for (let i = Math.max(n, rowAt(RULER)); i < n + nX() && i <= rowAt(H); i++) {          // Master / effect track rows: no clips, they only mix
    const y = rowY(i), h = rh(i), x = xInfo(i);
    ctx.fillStyle = C('#232325'); ctx.fillRect(0, y, CW, h);                                   // theme background first, so the tint below is a real transparent wash in dark AND light themes
    ctx.fillStyle = washRgba(x.color, 0.2); ctx.fillRect(0, y, CW, h); ctx.fillStyle = C('#0e0e0f'); ctx.fillRect(0, y + h - 1, CW, 1);   // lane = light transparent wash of the Master / FX track colour
    const src = x.master ? state.tracks.filter((q) => q.kind !== 'auto' && !q.mute).length : state.tracks.filter((q) => q.out === x.k && !q.mute).length;
    xl.push({ y, h, t: `Active Track : ${src}`, wash: washRgba(x.color, 0.2) });
  }
  // grid + loop
  const tEnd = view.x0 + CW / view.ppt + g;
  eachGrid(view.x0 - g, tEnd, g, (t, j) => {
    const x = Math.round(tx(t)) + 0.5;
    if (x < 0 || x > CW) return;
    const r = t - P.MM.T[j];
    if (r % P.MM.bl[j] === 0) return;                         // bar lines are drawn below
    ctx.fillStyle = r % P.MM.bt[j] === 0 ? C('#2c2c30') : C('#262629');
    ctx.fillRect(x, RULER, 1, H - RULER);
  });
  ctx.fillStyle = C('#3b3b40');   // bar lines: drawn per bar, so they stay right when the bar length is not a multiple of the grid step (e.g. 7/8) and after a signature change
  for (let b = Math.max(0, P.barAt(view.x0)); tx(P.barStart(b)) < CW; b++) { const x = Math.round(tx(P.barStart(b))) + 0.5; if (x >= 0) ctx.fillRect(x, RULER, 1, H - RULER); }
  if (P.state.sigs.length) { ctx.fillStyle = 'rgba(255,167,34,.28)'; for (const c of P.state.sigs) { const x = Math.round(tx(P.barStart(c.bar))) + 0.5; if (x >= 0 && x <= CW) ctx.fillRect(x, RULER, 1, H - RULER); } }
  for (const m of state.markers) { const x = Math.round(tx(m.t)) + 0.5; if (x < 0 || x > CW) continue; ctx.globalAlpha = 0.35; ctx.fillStyle = m.color; ctx.fillRect(x, RULER, 1, H - RULER); ctx.globalAlpha = 1; }
  const PU = state.punch;
  if (PU.on && PU.end > PU.start) { const a0 = Math.max(0, tx(PU.start)); ctx.fillStyle = 'rgba(255,54,54,.07)'; ctx.fillRect(a0, RULER, Math.max(0, Math.min(CW, tx(PU.end)) - a0), H - RULER); ctx.fillStyle = 'rgba(255,54,54,.55)'; for (const e of [PU.start, PU.end]) { const lx = Math.round(tx(e)); if (lx >= 0 && lx <= CW) ctx.fillRect(lx, RULER, 1, H - RULER); } }
  if (xl.length) {                                                                        // v63: caption sits on a small pill, grid lines no longer cut through the letters
    ctx.font = '600 10px system-ui'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (const l of xl) {
      const w = Math.round(ctx.measureText(l.t).width + 20), x = Math.round(CW / 2 - w / 2), y = Math.round(l.y + l.h / 2 - 9);
      ctx.fillStyle = C('#232325'); ctx.fillRect(x, y, w, 18); ctx.fillStyle = l.wash; ctx.fillRect(x, y, w, 18);
      ctx.fillStyle = C('#8b8b92'); ctx.fillText(l.t, CW / 2, l.y + l.h / 2 + 0.5);
    }
    ctx.textAlign = 'left';
  }
  // clips
  const first = Math.max(0, rowAt(RULER)), last = Math.min(n - 1, rowAt(H));
  for (let i = first; i <= last; i++) { const y = rowY(i); for (const c of state.tracks[i].clips) drawClip(state.tracks[i], c, y, rh(i)); }
  if (sel) { const a = Math.max(0, tx(sel.a)), b = Math.min(CW, tx(sel.b)); ctx.fillStyle = 'rgba(79,163,224,.22)'; ctx.fillRect(a, RULER, Math.max(0, b - a), H - RULER); }
  if (marq) {
    const ax = tx(marq.t0), bx = tx(marq.t1), ay = RULER - view.y0 + marq.y0, by = RULER - view.y0 + marq.y1;
    const x = Math.min(ax, bx), y = Math.min(ay, by), w = Math.abs(bx - ax), hh = Math.abs(by - ay);
    ctx.save(); ctx.beginPath(); ctx.rect(0, RULER, CW, H - RULER); ctx.clip();
    ctx.fillStyle = 'rgba(255,167,34,.16)'; ctx.fillRect(x, y, w, hh); ctx.strokeStyle = C('#ffa722'); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w, hh); ctx.restore();
  }
  drawRuler(g);
  drawHeads();
  if (msel.size) placeBar();
}

const PUon = () => state.punch.on && state.punch.end > state.punch.start;
function drawRuler(g) {
  ctx.fillStyle = C('#2a2a2d'); ctx.fillRect(0, 0, CW, RULER);
  ctx.fillStyle = C('#0e0e0f'); ctx.fillRect(0, RULER - 1, CW, 1);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, CW, RULER); ctx.clip();
  ctx.font = '10px system-ui'; ctx.textBaseline = 'top'; ctx.fillStyle = C('#9a9aa2');
  const barPx = BAR * view.ppt; let k = 1; while (barPx * k < 38) k *= 2;
  const chg = new Map(P.state.sigs.map((c) => [c.bar, c]));
  for (let b = Math.floor(Math.max(0, P.barAt(view.x0)) / k) * k; tx(P.barStart(b)) < CW; b++) {
    const c = chg.get(b);
    if (b % k && !c) continue;                                 // bars with a signature change are always labelled
    const x = Math.round(tx(P.barStart(b))) + 0.5;
    ctx.fillStyle = c ? C('#ffa722') : C('#9a9aa2');
    ctx.fillRect(x, MROW + 1, 1, RULER - MROW - 2);
    const lab = String(b + 1); ctx.fillText(lab, x + 3, MROW + 3);
    const lx = x + 3 + ctx.measureText(lab).width + 5;                       // bar number, then signature change or time on the same line: one thin row instead of two
    if (c) { ctx.font = '600 9px system-ui'; ctx.fillText(c.n + '/' + c.d, lx, MROW + 4); ctx.font = '10px system-ui'; }
    else if (barPx * k >= 82) {
      const sec = Math.max(0, P.tickToSec(P.barStart(b))), mm = Math.floor(sec / 60), ss = Math.floor(sec % 60);
      ctx.font = '9px system-ui'; ctx.globalAlpha = 0.7; ctx.fillText(`${mm}:${String(ss).padStart(2, '0')}`, lx, MROW + 4); ctx.globalAlpha = 1; ctx.font = '10px system-ui';
    }
  }
  ctx.fillStyle = C('#55555b');
  eachGrid(view.x0 - g, view.x0 + CW / view.ppt + g, g, (t, j) => { if ((t - P.MM.T[j]) % P.MM.bl[j]) ctx.fillRect(Math.round(tx(t)), RULER - 4, 1, 3); });
  if (PUon()) { ctx.fillStyle = C('#ff3636'); ctx.fillRect(tx(state.punch.start), RULER - 3, tx(state.punch.end) - tx(state.punch.start), 2); ctx.fillRect(tx(state.punch.start) - 1, RULER - 9, 4, 7); ctx.fillRect(tx(state.punch.end) - 3, RULER - 9, 4, 7); }
  if (sel) { ctx.fillStyle = C('#4fa3e0'); ctx.fillRect(tx(sel.a), 0, tx(sel.b) - tx(sel.a), 3); }
  ctx.font = '600 9px system-ui'; ctx.textBaseline = 'middle';
  ctx.fillStyle = C('#1d1d20'); ctx.fillRect(0, 0, CW, MROW);
  const ml = state.markers;
  for (let k = 0; k < ml.length; k++) {
    const m = ml[k], x = Math.round(tx(m.t));
    if (x > CW + 4) break;
    const nx = k + 1 < ml.length ? Math.round(tx(ml[k + 1].t)) : CW + 200, w = Math.min(nx - x - 3, ctx.measureText(m.name).width + 14);
    if (x + Math.max(8, w) < 0) continue;
    ctx.fillStyle = m.color; ctx.fillRect(x, 0, 1, MROW); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 7, 0); ctx.lineTo(x, 7); ctx.closePath(); ctx.fill();
    if (w > 18) { ctx.save(); ctx.beginPath(); ctx.rect(x + 1, 0, w, MROW); ctx.clip(); ctx.fillStyle = m.color; ctx.fillText(m.name, x + 9, MROW / 2 + 1); ctx.restore(); }
  }
  ctx.textBaseline = 'top'; ctx.font = '10px system-ui';
  ctx.restore();
}

// Overlay layer: only the playhead. It is redrawn every frame while playing, the heavy static layer is not.
const meterFrac = (lv) => clamp((20 * Math.log10(Math.max(lv, 1e-4)) + 60) / 66, 0, 1);
let lastMeterKey = 0;
const mDisp = []; let mT = 0;                 // displayed levels: instant attack, ~26 dB/s release (same ballistics as the mixer), so header bars glide instead of flickering
function smoothMeters() {
  const now = performance.now(), dt = Math.min(0.12, (now - (mT || now)) / 1000); mT = now;
  const m = state.meters, n = state.tracks.length * 2, k = Math.pow(10, -26 * dt / 20);
  for (let j = 0; j < n; j++) { const lv = (m[j] || 0) / 1000; let d = mDisp[j] || 0; d = lv >= d ? lv : d * k; mDisp[j] = d < 1e-4 ? 0 : d; }
}
function meterKey() {                        // changes whenever a visible bar would change (24 steps), so the overlay is only redrawn when needed
  let k = 0; const n = state.tracks.length;
  for (let i = 0; i < n; i++) k = (k * 31 + Math.round(meterFrac(mDisp[i * 2] || 0) * 24) * 25 + Math.round(meterFrac(mDisp[i * 2 + 1] || 0) * 24)) | 0;
  return k;
}
function drawMeters() {                      // two thin level bars per track at the right edge of the name block, same scale as the mixer
  const hx = CW, n = state.tracks.length, m = state.meters;
  octx.save(); octx.beginPath(); octx.rect(hx, RULER, HEAD, H - RULER); octx.clip();
  for (let i = Math.max(0, rowAt(RULER)); i <= Math.min(n - 1, rowAt(H)); i++) {
    if (state.tracks[i].kind === 'auto') continue;
    const y = rowY(i), hh = rh(i) - 7; if (hh < 6) continue;
    for (let ch = 0; ch < 2; ch++) {
      const f = meterFrac(mDisp[i * 2 + ch] || 0), bx = hx + NAMEW - 6 + ch * 3;
      octx.fillStyle = 'rgba(16,16,17,.75)'; octx.fillRect(bx, y + 3, 2, hh);
      if (f > 0.01) { octx.fillStyle = f > 0.93 ? '#e5484d' : f > 0.8 ? '#f0d84a' : '#4fae3a'; octx.fillRect(bx, y + 3 + hh * (1 - f), 2, hh * f); }
    }
  }
  octx.restore();
}
function drawHead(tick) {
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, W, H);
  drawMeters();
  const px = tx(tick);
  if (px < -6 || px > CW + 6) return;
  octx.save(); octx.beginPath(); octx.rect(0, 0, CW, H); octx.clip();
  octx.fillStyle = C('#ffa722');
  if (px >= 0) octx.fillRect(Math.round(px * dpr) / dpr, RULER, 2, H - RULER);
  octx.beginPath(); octx.moveTo(px - 5, 0); octx.lineTo(px + 5, 0); octx.lineTo(px, 8); octx.fill();
  octx.restore();
}

const VMAX = 1.4;
const dbTxt = (v) => (v < 0.001 ? '-\u221E' : (20 * Math.log10(v)).toFixed(1));
const panTxt = (p) => (Math.abs(p) < 0.02 ? 'C' : (p < 0 ? 'L' : 'R') + Math.round(Math.abs(p) * 50));
function cut2(txt, maxW) {                    // text that fits maxW, with an ellipsis when it does not
  if (ctx.measureText(txt).width <= maxW) return txt;
  let t = txt; while (t.length > 1 && ctx.measureText(t + '\u2026').width > maxW) t = t.slice(0, -1);
  return t + '\u2026';
}
function foldIcon(cx, cy, folded) {            // circled triangle, as the fold button in Live's track headers
  ctx.strokeStyle = 'rgba(15,15,20,.75)'; ctx.fillStyle = 'rgba(15,15,20,.75)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  if (folded) { ctx.moveTo(cx - 2, cy - 3.5); ctx.lineTo(cx + 3.5, cy); ctx.lineTo(cx - 2, cy + 3.5); }
  else { ctx.moveTo(cx - 3.5, cy - 2); ctx.lineTo(cx + 3.5, cy - 2); ctx.lineTo(cx, cy + 3.5); }
  ctx.closePath(); ctx.fill();
}
function drawBtn(r, label, active, col) {
  ctx.fillStyle = active ? col : C('#4a4a50'); ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = active ? '#15151a' : C('#c4c4ca'); ctx.font = '700 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5); ctx.textAlign = 'left';
}
function drawBadge(r, label, on, col) {            // small status badge on the track colour: lit = state is on
  ctx.fillStyle = on ? col : 'rgba(20,20,26,.38)'; ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = on ? '#15151a' : 'rgba(255,255,255,.72)';
  if (label === 'arm') { ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + r.h / 2, 4.5, 0, 6.2832); if (on) ctx.fillStyle = '#fff'; ctx.fill(); return; }
  ctx.font = '700 9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5); ctx.textAlign = 'left';
}
function drawBar(r, frac, fillCol, label, fromCenter) {
  ctx.fillStyle = C('#1b1b1c'); ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = fillCol;
  if (fromCenter) { const c = r.x + r.w / 2, e = r.x + frac * r.w; ctx.fillRect(Math.min(c, e), r.y, Math.abs(e - c) || 1, r.h); }
  else ctx.fillRect(r.x, r.y, Math.max(1, frac * r.w), r.h);
  if (fromCenter) { ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(Math.round(r.x + r.w / 2), r.y, 1, r.h); }   // centre detent mark
  ctx.font = '600 9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(12,12,14,.85)'; ctx.strokeText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5);   // dark halo: readable over any fill
  ctx.fillStyle = '#fff'; ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5); ctx.textAlign = 'left';
}
function drawHeads() {
  const hx = CW, n = state.tracks.length;
  ctx.fillStyle = C('#242426'); ctx.fillRect(hx, 0, HEAD, H);
  ctx.save(); ctx.beginPath(); ctx.rect(hx, RULER, HEAD, H - RULER); ctx.clip();
  const nn = n + nX(), lanes = new Set();
  for (const q of state.tracks) if (q.kind === 'auto' && q.target) lanes.add(q.target.strip);
  for (let i = Math.max(0, rowAt(RULER)); i <= Math.min(nn, rowAt(H)); i++) {
    const y = rowY(i), h = rh(i);
    if (i >= n && i < nn) {                                                                  // Master / effect track header
      const x = xInfo(i), on = state.sel.track === x.strip, fx = !x.master, rt = fx ? state.returns[x.k] : null;
      ctx.fillStyle = C('#34343a'); ctx.fillRect(hx + NAMEW, y, HEAD - NAMEW, h - 1);
      ctx.fillStyle = x.color; ctx.fillRect(hx, y, NAMEW, h - 1);
      if (on) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(hx + 1, y + 1, NAMEW - 2, h - 3); }
      ctx.fillStyle = '#15151a'; ctx.font = '700 11px system-ui'; ctx.textBaseline = 'middle'; ctx.fillText(cut2(x.name, NAMEW - 12), hx + 6, y + h / 2 + 0.5);
      if (fx) drawBtn({ x: hx + NAMEW + 3, y: y + 2, w: 58, h: 24 }, 'On', !rt.mute, C('#f2c744'));
      else { ctx.fillStyle = C('#8b8b92'); ctx.font = '600 10px system-ui'; ctx.fillText('Mix', hx + NAMEW + 8, y + 14); }
      ctx.fillStyle = C('#0e0e0f'); ctx.fillRect(hx + NAMEW, y, 1, h);
      continue;
    }
    if (i === nn) {
      ctx.fillStyle = C('#8b8b92'); ctx.font = '22px system-ui'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText('+', hx + HEAD / 2, y + h / 2); ctx.textAlign = 'left'; continue;
    }
    const t = state.tracks[i], on = state.sel.track === i, r = hdr(i);
    ctx.fillStyle = C('#34343a'); ctx.fillRect(hx + NAMEW, y, HEAD - NAMEW, h - 1);          // control column
    ctx.fillStyle = t.color; ctx.fillRect(hx, y, NAMEW, h - 1);                                // name block, full height, in the track colour
    if (on) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(hx + 1, y + 1, NAMEW - 2, h - 3); }   // selection = white frame, the colour itself never changes
    foldIcon(hx + 13, y + Math.min(h, 26) / 2, !!t.fold);
    ctx.fillStyle = '#15151a'; ctx.font = '600 11px system-ui'; ctx.textBaseline = 'middle';
    if (t.fold) ctx.fillText(cut2(t.name, NAMEW - 30), hx + 24, y + h / 2 + 0.5);
    else {
      ctx.fillText(cut2(t.name, NAMEW - 30), hx + 24, y + 13);                                   // one line + ellipsis, never split mid-word (as Live's track names)
      if (h >= 64) { ctx.fillStyle = 'rgba(15,15,20,.6)'; ctx.font = '9px system-ui'; ctx.fillText(t.kind === 'audio' ? 'Audio' : t.kind === 'drum' ? 'Drum' : t.kind === 'auto' ? 'Otomasi' : 'MIDI', hx + 6, y + h - (r.arm ? 30 : 9)); }
    }
    if (r.arm) drawBadge(r.arm, 'arm', !!t.arm, '#e5484d');
    if (r.mon) drawBadge(r.mon, 'Mon', t.mon !== false, '#4fa3e0');
    if (r.aut) drawBadge(r.aut, 'A', lanes.has(t.id), '#ffa722');
    drawBtn(r.mute, t.kind === 'auto' ? 'On' : String(i + 1), !t.mute, C('#f2c744'));
    if (r.solo) drawBtn(r.solo, 'S', t.solo, C('#4fa3e0'));
    if (r.vol) drawBar(r.vol, Math.sqrt(clamp(t.vol / VMAX, 0, 1)), C('#8a8a92'), dbTxt(t.vol) + ' dB', false);
    if (r.pan) drawBar(r.pan, (clamp(t.pan, -1, 1) + 1) / 2, C('#ffa722'), panTxt(t.pan), true);
    ctx.fillStyle = C('#0e0e0f'); ctx.fillRect(hx + NAMEW, y, 1, h);
  }
  ctx.restore();
  // corner: compact snap button with a border
  ctx.fillStyle = C('#2a2a2d'); ctx.fillRect(hx, 0, HEAD, RULER); ctx.fillStyle = C('#0e0e0f'); ctx.fillRect(hx, RULER - 1, HEAD, 1); ctx.fillRect(hx, 0, 1, H);
  {
    // Live-style switch: flat control, LED on the left (accent when snapping), neutral text - same look as every toggle in the app
    const r = snapRect(), off = cfg.snap === SNAPS.length - 1;
    ctx.fillStyle = pressed === 'corner' ? C('#4a4a50') : C('#38383c'); ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = C('#0e0e0f'); ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    const ly = r.y + r.h / 2; ctx.fillStyle = off ? C('#4a4a50') : T('--accent'); ctx.beginPath(); ctx.arc(r.x + 10, ly, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = off ? C('#8b8b92') : C('#cfcfd2'); ctx.font = '600 10px system-ui'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText('Snap  ' + SNAPS[cfg.snap][0], r.x + r.w / 2 + 6, ly + 0.5, r.w - 22); ctx.textAlign = 'left';
  }
  // bottom-right of the clip area: grid size + zoom, real buttons (tap the grid size for the snap list, the zoom for fit / reset / zoom steps)
  ctx.font = '600 10px system-ui'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  for (const [type, lbl, r] of badges()) {
    ctx.fillStyle = pressed === type ? 'rgba(90,90,98,.92)' : 'rgba(0,0,0,.55)'; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = pressed === type ? 'rgba(255,167,34,.9)' : 'rgba(255,255,255,.2)'; ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = C('#d6d6da'); ctx.fillText(lbl, r.x + r.w / 2, r.y + r.h / 2 + 0.5, r.w - 6);
  }
  ctx.textAlign = 'left';
}

// ------------------------------------------------------------------ motion
// Every movement of the view that is not a finger dragging it goes through here, so it eases instead of jumping: zoom buttons and
// presets, scrolling to a seek target, follow-playhead catch-up, fling after a swipe, spring-back after an over-zoom.
const PMIN = 0.004, PMAX = 1.2;
const mo = { tppt: null, tx0: null, vx: 0, vy: 0, fx: null, last: 0, lastTick: 0 };   // tppt/tx0 = glide target; vx/vy = fling speed (px/s); fx = float scroll position while following
let touching = false;
const ease = (dt, rate) => 1 - Math.exp(-dt * rate / Math.max(0.3, prefs.animScale || 1));   // frame-rate independent smoothing factor
const centreTick = () => view.x0 + CW / (2 * view.ppt);
function stopMotion() { mo.tppt = mo.tx0 = mo.fx = null; mo.vx = mo.vy = 0; }
function glideTo(x0, ppt) {                                  // ease to scroll position x0 and zoom ppt (both optional)
  const tp = ppt == null ? view.ppt : clamp(ppt, PMIN, PMAX);
  x0 = Math.max(0, x0 == null ? view.x0 : x0);
  mo.vx = mo.vy = 0; mo.fx = null;
  if (prefs.reduceMotion) { view.ppt = tp; view.x0 = x0; clampView(); mo.tppt = mo.tx0 = null; invalidate(); return; }
  mo.tppt = tp; mo.tx0 = x0; invalidate();
}
function zoomAt(factor, fx = CW / 2) {                       // zoom around screen x = fx: the tick under that point stays under it
  const base = mo.tppt != null ? mo.tppt : view.ppt, tp = clamp(base * factor, PMIN, PMAX);
  const ft = mo.tppt != null ? mo.tx0 + fx / base : xt(fx);
  glideTo(ft - fx / tp, tp);
}
function fitTo(a, b) {                                       // show the tick range [a, b] across the clip area
  const span = Math.max(b - a, BAR), tp = clamp(CW * 0.92 / span, PMIN, PMAX);
  glideTo(a - (CW / tp - span) / 2, tp);
}
function stepMotion(dt) {
  let moved = false;
  if (mo.tppt != null) {                                     // glide: zoom eases in log space, the centre tick eases linearly
    const k = ease(dt, 12), lp = Math.log(view.ppt), lt = Math.log(mo.tppt), c0 = centreTick(), tc = mo.tx0 + CW / (2 * mo.tppt);
    const np = Math.exp(lp + (lt - lp) * k), nc = c0 + (tc - c0) * k;
    if (Math.abs(lt - lp) < 0.003 && Math.abs(tc - c0) * np < 0.5) { view.ppt = mo.tppt; view.x0 = mo.tx0; mo.tppt = mo.tx0 = null; }
    else { view.ppt = np; view.x0 = Math.max(0, nc - CW / (2 * np)); }
    moved = true;
  }
  if (mo.vx || mo.vy) {                                      // fling: friction decay, stops dead at the left wall and at the vertical ends
    const f = Math.exp(-dt * 3.2);
    let nx = view.x0 - mo.vx * dt / view.ppt;
    if (nx <= 0) { nx = 0; mo.vx = 0; }
    view.x0 = nx;
    view.y0 -= mo.vy * dt; const y1 = view.y0; clampView(); if (view.y0 !== y1) mo.vy = 0;
    mo.vx *= f; mo.vy *= f;
    if (Math.abs(mo.vx) < 10) mo.vx = 0;
    if (Math.abs(mo.vy) < 10) mo.vy = 0;
    moved = true;
  }
  return moved;
}

let lastHeadPx = -1e9, headDirty = true;
const FOLLOW_AT = 0.38;                       // playhead stays at this fraction of the width while the arrangement scrolls under it
export function frame() {
  if (!W) return;
  const now = performance.now(), dt = clamp((now - (mo.last || now)) / 1000, 0.001, 0.05); mo.last = now;
  const tick = P.currentTick();   // extrapolated between engine polls: smooth at 60-120 Hz
  const vis = CW / view.ppt, q = view.ppt * dpr;
  const idle = !drag && !touching && now - touchedAt > 1500 && CW > 40 && mo.tppt == null && !mo.vx && !mo.vy;
  if (state.playing && cfg.follow && idle) {
    // Follow: once the playhead reaches the anchor the content moves under it. The scroll position is chased with the playhead's own speed as
    // feed-forward, so it starts without a jerk, never lags, and a seek or a return after manual scrolling glides in instead of jumping.
    // The position is kept as a float and shown on whole device pixels, so the playhead never wobbles by one pixel.
    const A = Math.round(CW * dpr * FOLLOW_AT) / q;
    if (mo.fx !== null && Math.abs(mo.fx - view.x0) > 2 / q) mo.fx = view.x0;                  // someone else moved the view: start from there
    if (mo.fx === null && (tick > view.x0 + A || tick < view.x0 || tick > view.x0 + vis) && tick - A > 0) mo.fx = view.x0;   // engage
    if (mo.fx !== null) {
      const want = Math.max(0, tick - A);
      if (want <= 0 && view.x0 <= 0.5 / q) { mo.fx = null; }                                      // playhead is left of the anchor again, view at the start
      else {
        mo.fx = Math.max(0, mo.fx + (state.bpm / 60 * PPQ) * dt + (want - mo.fx) * ease(dt, 10));
        const nx = Math.round(mo.fx * q) / q;
        if (nx !== view.x0) { view.x0 = nx; dirty = true; }
      }
    }
  } else if (mo.fx !== null) mo.fx = null;
  if (!state.playing && cfg.follow && idle && tick !== mo.lastTick && (tick < view.x0 || tick > view.x0 + vis)) glideTo(tick - vis * 0.12);   // stop / rewind / marker jump out of view: scroll there smoothly
  if (stepMotion(dt)) dirty = true;
  mo.lastTick = tick;
  if (dirty) { dirty = false; draw(); headDirty = true; }
  const px = Math.round(tx(tick) * dpr);
  smoothMeters();
  const mk = state.playing || lastMeterKey ? meterKey() : 0;
  if (headDirty || px !== lastHeadPx || mk !== lastMeterKey) { lastHeadPx = px; lastMeterKey = mk; headDirty = false; drawHead(tick); }
}

// Dragging a clip (or its edge) near the left / right border scrolls the arrangement so the clip can reach tick 0 and far bars.
function edgeScroll(x) {
  const M = 28, step = 14 / view.ppt;
  if (x < M && view.x0 > 0) { view.x0 = Math.max(0, view.x0 - step * (1 - Math.max(0, x) / M)); }
  else if (x > CW - M && x < CW) view.x0 += step * (1 - (CW - x) / M);
}

// ------------------------------------------------------------------ hit testing + actions
function hit(x, y) {
  if (y < RULER) {
    if (x >= CW) return { type: 'corner' };
    if (y < MROW + 2) { let best = null, bd = 18; for (const m of state.markers) { const d = Math.abs(x - tx(m.t)); if (d < bd) { bd = d; best = m; } } return best ? { type: 'marker', m: best } : { type: 'mrow', tick: xt(x) }; }
    if (PUon() && y > RULER - 11) {
      const dl = Math.abs(x - tx(state.punch.start)), dr = Math.abs(x - tx(state.punch.end));
      if (Math.min(dl, dr) < 14) return { type: dl <= dr ? 'punchL' : 'punchR' };
    }
    return { type: 'ruler', tick: xt(x) };
  }
  if (x < CW) for (const [type, , r] of badges()) if (inRect(r, x, y, 3)) return { type };      // grid-size and zoom buttons (bottom right of the clip area)
  const i = rowAt(y);
  if (x >= CW) {
    const n0 = state.tracks.length;
    if (i === n0 + nX()) return { type: 'add' };
    if (i < 0 || i > n0 + nX()) return { type: 'none' };
    if (i >= n0) { const xi = xInfo(i); return { type: 'xhead', x: xi, mute: !xi.master && x >= CW + NAMEW && x <= CW + NAMEW + 64 && y - rowY(i) < 30 }; }
    const r = hdr(i);
    for (const [k, key] of [[0, 'mute'], [1, 'solo'], [2, 'fold'], [3, 'vol'], [4, 'pan'], [5, 'arm'], [6, 'mon'], [7, 'aut']]) if (r[key] && inRect(r[key], x, y, key === 'vol' || key === 'pan' ? 1 : 2)) return { type: 'head', i, btn: k };
    return { type: 'head', i };
  }
  if (i < 0 || i >= state.tracks.length) return { type: 'empty', i, tick: xt(x) };
  const tick = xt(x);
  const clips = state.tracks[i].clips;
  for (let k = clips.length - 1; k >= 0; k--) {
    const c = clips[k];
    if (tick >= c.start && tick <= c.start + c.len) {
      const wpx = tx(c.start + c.len) - tx(c.start), hz = Math.min(HANDLE, wpx / 2.5);   // handles never take more than 40% of a narrow clip, so it stays movable
      const edgeR = tx(c.start + c.len) - x < hz, edgeL = !edgeR && x - tx(c.start) < hz;
      return { type: 'clip', i, c, tick, zone: edgeR ? 'right' : edgeL ? 'left' : 'body' };
    }
  }
  return { type: 'empty', i, tick };
}

const canvasOrigin = () => canvas.getBoundingClientRect();
function clipBar(i, c, tick) {
  const r = canvasOrigin(), t = state.tracks[i];
  const x = r.left + clamp(tx(c.start), 0, Math.max(0, CW - 250)), y = r.top + Math.max(RULER, rowY(i)) - 38;
  bar([
    { label: 'Copy', fn: () => copyList([{ i, c }]) },
    { label: 'Cut', fn: () => { copyList([{ i, c }]); checkpoint(); P.removeClip(i, c.id); } },
    { label: 'Hapus', fn: () => { checkpoint(); P.removeClip(i, c.id); } },
    { label: 'Duplikat', fn: () => { checkpoint(); P.duplicateClip(i, c.id); invalidate(); } },     // v65 (FL Studio Mobile: copy + paste next to the clip in one tap)
    { label: 'Snap', fn: () => {                                                                       // v65: snap both clip edges to the grid
      const a = Math.max(0, snapT(c.start)), e = snapT(c.start + c.len);
      if (a === c.start && e - a === c.len) return toast('Tepi klip sudah pas di grid.');
      if (e - a < 1) return toast('Klip terlalu pendek untuk di-snap.');
      checkpoint(); c.len = e - a; c.start = a; P.syncClips(i); P.touchClips(i); invalidate();
    } },
    { label: c.muted ? 'Unmute' : 'Mute', fn: () => { checkpoint(); P.setClipsMuted([{ i, c }], !c.muted); invalidate(); } },
    { label: 'Trim', fn: () => { checkpoint(); P.splitClip(i, c.id, snapT(tick)); } },
    ...(t.kind === 'audio' ? [{ label: stretchMode ? 'Stretch \u2713' : 'Stretch', fn: () => { stretchMode = !stretchMode; toast(stretchMode ? 'Mode stretch: tarik ujung kanan klip audio untuk meregangkan (pitch tetap).' : 'Mode stretch mati: tarik ujung kanan untuk memotong.', 3200); invalidate(); } }] : []),
    { label: 'Edit', fn: () => hooks.openEditor && hooks.openEditor() },
  ], x, y);
}

function selMenu() {
  const r = canvasOrigin();
  const a = sel.a, b = sel.b, len = b - a;
  bar([
    { label: 'Deselect', fn: () => { sel = null; invalidate(); } },
    { label: 'Insert space', fn: () => { checkpoint(); cutAll(a); shift(a, len); sel = null; } },
    { label: 'Duplicate', fn: () => { checkpoint(); cutAll(a); cutAll(b); dupRange(a, b); sel = null; } },
    { label: 'Delete', fn: () => { checkpoint(); cutAll(a); cutAll(b); delRange(a, b); sel = null; } },
    { label: 'Delete space', fn: () => { checkpoint(); cutAll(a); cutAll(b); delRange(a, b); shift(b, -len); sel = null; } },
    { label: 'Trim', fn: () => { checkpoint(); cutAll(a); cutAll(b); delRange(0, a); delRange(b, 1e9); shift(a, -a); sel = null; } },
  ], r.left + clamp(tx(a), 0, Math.max(0, CW - 330)), r.top + RULER + 4);
}
function cutAll(tick) {
  state.tracks.forEach((t, i) => { if (t.kind !== 'audio') for (const c of [...t.clips]) if (tick > c.start && tick < c.start + c.len) P.splitClip(i, c.id, tick); });
}
function shift(from, delta) {
  state.tracks.forEach((t, i) => { let ch = false; for (const c of t.clips) if (c.start >= from) { c.start = Math.max(0, c.start + delta); ch = true; } if (ch) P.syncClips(i); });
  P.emit('clips');
}
function delRange(a, b) {
  state.tracks.forEach((t, i) => { const n = t.clips.length; t.clips = t.clips.filter((c) => !(c.start >= a && c.start + c.len <= b)); if (t.clips.length !== n) P.syncClips(i); });
  P.emit('clips');
}
function dupRange(a, b) {
  const len = b - a; shift(b, len);
  state.tracks.forEach((t, i) => {
    const add = t.clips.filter((c) => c.start >= a && c.start + c.len <= b).map((c) => ({ ...c, notes: c.notes && c.notes.map((n) => ({ ...n })) }));
    for (const c of add) P.pasteClip(i, { kind: t.kind, clip: c }, c.start + len);
    if (add.length) P.syncClips(i);
  });
  P.emit('clips');
}

function xheadMenu(xi, x, y) {
  const r = canvasOrigin();
  const recolor = () => { const before = xi.obj.color; pickColor({ title: 'Warna ' + xi.name, name: xi.name, color: xi.color, swatches: COLORS, onChange: (c) => { xi.obj.color = c; invalidate(); }, onDone: (c) => { if (c !== before) { P.noteColor(xi.master ? 'master' : 'ret' + xi.k, before); P.emit('tracks'); } } }); };
  if (xi.master) return menu([{ label: 'Pilih Master (modul efek)', fn: () => P.selectTrack(MASTER) }, { label: 'Warna', fn: recolor }, { label: 'Buat FX track', dim: state.returns.length >= P.MAX_FX, fn: () => addFx() }], r.left + x, r.top + y);
  menu([
    { label: 'Pilih (modul efek)', fn: () => P.selectTrack(xi.strip) },
    { label: 'Warna', fn: recolor },
    { label: 'Ganti nama', fn: () => ask('Nama FX track', xi.name, (v) => v && P.renameFx(xi.k, v.trim())) },
    { sep: true },
    { label: 'Hapus FX track', fn: () => modal('Hapus ' + xi.name + '?', 'Track yang masuk ke sini kembali ke Master. Modul efek di FX track ini ikut terhapus.', [{ label: 'Batal' }, { label: 'Hapus', go: true, fn: () => { checkpoint(); P.removeFxTrack(xi.k); } }]) },
  ], r.left + x, r.top + y);
}
function addFx() { const k = P.addFxTrack(); if (k === null) return toast('Batas FX track tercapai.'); P.selectTrack(RET0 + k); toast('FX track dibuat. Arahkan track ke sini lewat tombol \u2192 di Mixer atau menu Output (tekan lama nama track).', 3600); }
function headMenu(i, x, y) {
  const t = state.tracks[i], r = canvasOrigin();
  menu([
    ...(t.kind !== 'auto' ? [{ label: 'Output: ' + P.outLabel(t.out) + '\u2026', fn: () => menu([{ label: 'Master', check: !(t.out >= 0), fn: () => P.setOut(i, -1) }, ...state.returns.map((rt, k) => ({ label: rt.name, check: t.out === k, fn: () => P.setOut(i, k) })), ...(state.returns.length < P.MAX_FX ? [{ sep: true }, { label: 'Buat FX track baru\u2026', fn: () => { const k = P.addFxTrack(); if (k !== null) P.setOut(i, k); } }] : [])], r.left + x, r.top + y) }] : []),
    ...(t.kind === 'audio' || t.kind === 'midi' || t.kind === 'drum' ? [{ label: t.arm ? 'Matikan Arm rekam' : 'Arm untuk rekam', fn: () => P.toggleArm(i) }] : []),
    ...(t.kind === 'midi' || t.kind === 'drum' ? [{ label: 'Monitor input: ' + (t.mon === false ? 'mati' : 'nyala'), fn: () => P.toggleMonitor(i) }] : []),
    ...(t.kind !== 'auto' ? [{ label: 'Lane otomasi\u2026', fn: () => laneMenu(i, x, y) }] : []),
    { label: 'Ganti nama', fn: () => ask('Nama track', t.name, (v) => v && P.renameTrack(i, v.trim())) },
    { label: 'Warna', fn: () => { const before = t.color; pickColor({ title: 'Warna track', name: t.name, color: t.color, swatches: COLORS, onChange: (c) => { t.color = c; invalidate(); }, onDone: (c) => { if (c !== before) { P.noteColor(t.id, before); P.emit('tracks'); } } }); } },
    { label: t.fold ? 'Buka track' : 'Lipat track', fn: () => toggleFold(i) },
    { label: 'Pindah ke atas', fn: () => swapTrack(i, i - 1) },
    { label: 'Pindah ke bawah', fn: () => swapTrack(i, i + 1) },
    { sep: true },
    { label: 'Hapus track', fn: () => { P.removeTrack(i); } },
  ], r.left + x, r.top + y);
}
// Automation lane chooser (Live: the A button of a track): pick a parameter; its lane (an automation track) is created right below this track,
// or selected when it already exists. Existing lanes can be folded / opened together.
function laneMenu(i, x, y) {
  const t = state.tracks[i], r = canvasOrigin(), sid = P.stripOf(i); if (!t || t.kind === 'auto') return;
  const open = (target, label) => {
    let a = null, made = false;
    P.HK.group(() => {                                                       // creating the lane and moving it below this track = ONE undo step
      const before = state.tracks.length; a = P.addAutoTrack(target, label);
      if (a && state.tracks.length > before) { made = true; for (let k = state.tracks.length - 1; k > i + 1; k--) P.swapTracks(k, k - 1); }
    });
    if (!a) return toast('Jumlah track sudah maksimum.', 2400);
    toast(made ? 'Lane otomasi dibuat di bawah track ini.' : 'Lane ini sudah ada, dipilih.', 2000);
    const at = state.tracks.indexOf(a); if (at >= 0) { a.fold = false; P.selectTrack(at); } invalidate();
  };
  const list = (base, defs, lbl) => defs.map((p, k) => ({ label: p.n, fn: () => open({ ...base, param: k, def: p }, `${t.name} \u2022 ${lbl ? lbl + ' ' : ''}${p.n}`) }));
  const items = [
    { label: 'Volume', fn: () => open({ kind: 0, strip: sid, param: 0, def: P.AUTO_VOL }, `${t.name} \u2022 Volume`) },
    { label: 'Pan', fn: () => open({ kind: 1, strip: sid, param: 0, def: P.AUTO_PAN }, `${t.name} \u2022 Pan`) },
    { label: 'Send A', fn: () => open({ kind: 2, strip: sid, param: 0, def: P.AUTO_SEND }, `${t.name} \u2022 Send A`) },
    { label: 'Send B', fn: () => open({ kind: 3, strip: sid, param: 0, def: P.AUTO_SEND }, `${t.name} \u2022 Send B`) },
  ];
  const idef = t.kind === 'midi' && t.inst && INSTRUMENTS[t.inst.type];
  if (idef && idef.params.length) items.push({ label: 'Instrumen: ' + idef.name + '\u2026', fn: () => menu(list({ kind: 5, strip: sid }, idef.params, ''), r.left + x, r.top + y) });
  for (const d of t.devices) { const dd = DEVICES[d.type]; if (dd && dd.params && dd.params.length) items.push({ label: 'Efek: ' + dd.name + '\u2026', fn: () => menu(list({ kind: 4, strip: sid, devId: d.id }, dd.params, dd.name), r.left + x, r.top + y) }); }
  const mine = state.tracks.filter((q) => q.kind === 'auto' && q.target && q.target.strip === sid);
  if (mine.length) { const allFold = mine.every((q) => q.fold); items.push({ sep: true }, { label: (allFold ? 'Buka' : 'Lipat') + ' semua lane track ini (' + mine.length + ')', fn: () => { for (const q of mine) q.fold = !allFold; clampView(); invalidate(); } }); }
  menu(items, r.left + x, r.top + y);
}
function toggleFold(i) { const t = state.tracks[i]; if (!t) return; t.fold = !t.fold; clampView(); invalidate(); }
function foldAll(on) { for (const t of state.tracks) t.fold = on; view.y0 = 0; clampView(); invalidate(); }
function swapTrack(i, j) { P.swapTracks(i, j); }

function addMenu(x, y) {
  const r = canvasOrigin();
  menu([
    { label: 'Track synth (MIDI)', fn: () => { const t = P.addTrack('midi'); if (t) P.selectTrack(state.tracks.length - 1); } },
    { label: 'Track drum (step sequencer)', fn: () => { const t = P.addTrack('drum'); if (t) P.selectTrack(state.tracks.length - 1); } },
    { label: 'Track audio', fn: () => { const t = P.addTrack('audio'); if (t) { P.selectTrack(state.tracks.length - 1); if (hooks.pickAudio) hooks.pickAudio(); } } },
    { sep: true },
    { label: 'FX track (routing / grup)', dim: state.returns.length >= P.MAX_FX, fn: () => addFx() },
  ], r.left + x, r.top + y);
}


// ------------------------------------------------------------------ multi-clip selection (gesture only, no mode button)
// Long-press a clip = add it to the selection. Long-press an empty spot and drag = rubber-band rectangle. Tap a clip while
// a selection exists = add / remove it. Tap an empty spot = clear. A floating bar with the actions follows the selection.
const selList = () => { const out = []; state.tracks.forEach((t, i) => { for (const c of t.clips) if (msel.has(c.id)) out.push({ i, c }); }); return out; };
function prune() { if (!msel.size) return; const live = new Set(); for (const t of state.tracks) for (const c of t.clips) live.add(c.id); for (const id of [...msel]) if (!live.has(id)) msel.delete(id); }
function updateBar() {
  if (!selbar) return;
  prune();
  const L = selList(), n = L.length;
  selbar.classList.toggle('open', n > 0);
  selbar.querySelector('.cnt').textContent = n + ' klip';
  const mb = selbar.querySelector('[data-a="mute"]'); if (mb) mb.textContent = n && L.every(({ c }) => c.muted) ? 'Unmute' : 'Mute';
  for (const b of selbar.querySelectorAll('[data-need]')) b.disabled = b.dataset.need === 'sel' ? !n : b.dataset.need === 'one' ? n !== 1 : !clipM;
  selW = n ? selbar.offsetWidth : 0;
  if (n) placeBar();
}
// the bar sits just under the selected clips (above them when there is no room), always inside the visible clip area
function placeBar() {
  if (!selbar || !msel.size) return;
  let a = 1e9, b = -1e9, top = 1e9, bot = -1e9;
  state.tracks.forEach((t, i) => { for (const c of t.clips) if (msel.has(c.id)) { const y = rowY(i); a = Math.min(a, tx(c.start)); b = Math.max(b, tx(c.start + c.len)); top = Math.min(top, y); bot = Math.max(bot, y + rh(i)); } });
  if (a > b) return;
  const w = selW || 200, bh = 32;
  let x = clamp((a + b) / 2 - w / 2, 4, Math.max(4, CW - w - 4));
  let y = bot + 6; if (y + bh > H - 4) y = top - bh - 6;
  y = clamp(y, RULER + 4, Math.max(RULER + 4, H - bh - 4));
  selbar.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  selbar.classList.toggle('hide', !!drag);
}
function clearSel() { if (!msel.size) return; msel.clear(); marq = null; updateBar(); invalidate(); }
export function clearSelection() { const had = msel.size > 0; clearSel(); return had; }
function selAll() {
  const all = []; for (const t of state.tracks) for (const c of t.clips) all.push(c.id);
  if (all.length && all.every((id) => msel.has(id))) msel.clear(); else for (const id of all) msel.add(id);
  updateBar(); invalidate();
}
function copyList(L) {
  if (!L.length) return;
  const base = Math.min(...L.map((x) => x.c.start)), ti0 = Math.min(...L.map((x) => x.i));
  clipM = { base, ti0, items: L.map(({ i, c }) => { const copy = JSON.parse(JSON.stringify(c, (k, v) => (k === 'sample' || k === 'dsample' ? undefined : v))); if (c.sample) copy.sample = c.sample; if (c.dsample) copy.dsample = c.dsample; return { dt: i - ti0, kind: state.tracks[i].kind, clip: copy, rel: c.start - base }; }) };
  toast(`${L.length} klip disalin. Tekan lama di grid kosong lalu pilih Paste.`); updateBar();
}
const selCopy = () => copyList(selList());
// paste the clipboard with its first clip at `at` on track `t0`; the pasted clips become the selection so they can be moved right away
function pasteClips(t0, at) {
  if (!clipM) return toast('Belum ada klip yang disalin.');
  checkpoint();
  const fresh = [];
  for (const it of clipM.items) { const c = P.pasteClip(t0 + it.dt, { kind: it.kind, clip: it.clip }, at + it.rel); if (c) fresh.push(c.id); }
  if (!fresh.length) return toast('Jenis track tidak cocok dengan klip.');
  msel.clear(); for (const id of fresh) msel.add(id);
  updateBar(); invalidate();
}
function selPaste() { pasteClips(Math.max(0, state.sel.track || 0), Math.max(0, snapT(P.currentTick()))); }
function selDelete() {
  const L = selList(); if (!L.length) return;
  checkpoint(); for (const { i, c } of L) P.removeClip(i, c.id);
  msel.clear(); updateBar(); invalidate();
}
export function deleteSelected() { if (!selList().length) return false; selDelete(); return true; }
function selDup() {
  const L = selList(); if (!L.length) return;
  checkpoint(); const span = Math.max(...L.map((x) => x.c.start + x.c.len)) - Math.min(...L.map((x) => x.c.start)), fresh = [];
  for (const { i, c } of L) { P.duplicateClip(i, c.id); const d = state.tracks[i].clips.find((x) => x.id === state.sel.clip); if (d) { d.start = c.start + span; P.touchClips(i); fresh.push(d.id); } }
  msel.clear(); for (const id of fresh) msel.add(id);
  P.emit('clips'); updateBar(); invalidate();
}
function selMute() {
  const L = selList(); if (!L.length) return;
  const m = !L.every(({ c }) => c.muted);               // all muted -> unmute, otherwise mute everything picked
  checkpoint(); P.setClipsMuted(L, m); updateBar(); invalidate();
}
function selCombine() {                                                     // v66: FL Studio Mobile "Combine"
  const L = selList(); if (!L.length) return;
  const ti = L[0].i;
  if (!L.every(({ i }) => i === ti)) return toast('Gabung hanya untuk klip di track yang sama.');
  checkpoint();
  const r = P.combineClips(ti, L.map(({ c }) => c.id));
  if (r.error) return toast(r.error);
  msel.clear(); msel.add(r.id); updateBar(); invalidate(); toast(`${L.length} klip digabung jadi satu.`);
}
function buildSelBar(host) {
  selbar = document.createElement('div'); selbar.className = 'selbar bar';
  const mk = (a, label, fn, need) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'b'; b.dataset.a = a; if (need) b.dataset.need = need; b.textContent = label; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); b.addEventListener('pointerdown', (e) => e.stopPropagation()); return b; };
  const cnt = document.createElement('span'); cnt.className = 'cnt'; cnt.hidden = true;
  selbar.append(cnt, mk('copy', 'Copy', selCopy, 'sel'), mk('dup', 'Duplicate', selDup, 'sel'), mk('comb', 'Gabung', selCombine, 'sel'), mk('del', 'Hapus', selDelete, 'sel'), mk('mute', 'Mute', selMute, 'sel'));
  host.append(selbar); updateBar();
}
// long-press on an empty spot (no drag): new clip / paste exactly where the finger was
function emptyMenu(i, tick, sx, sy) {
  const tk = state.tracks[i], at = Math.max(0, snapT(tick));
  menu([
    { label: tk.kind === 'audio' ? 'Tambah sample\u2026' : 'Klip baru (1 bar)', fn: () => { if (tk.kind === 'audio') hooks.pickAudio && hooks.pickAudio(at); else { checkpoint(); P.addClip(i, at, P.barLenAt(at)); } } },
    { label: 'Paste', dim: !clipM, fn: () => pasteClips(i, at) },
    { label: 'Tambah marker di playhead', fn: () => { P.addMarker(Math.round(P.currentTick())); invalidate(); } }, { label: 'Marker sebelumnya', fn: () => P.jumpMarker(-1) }, { label: 'Marker berikutnya', fn: () => P.jumpMarker(1) }, { sep: true }, { label: 'Pilih semua klip', fn: () => selAll() },
  ], sx, sy);
}
function edgeScrollY(y) {
  if (y > H - 26) view.y0 += 9; else if (y < RULER + 22 && view.y0 > 0) view.y0 -= 9; else return;
  clampView();
}

function zoomMenu() {
  const o = canvasOrigin(), sc = P.selectedClip(), end = state.tracks.reduce((m, t) => t.clips.reduce((a, c) => Math.max(a, c.start + c.len), m), 0);
  menu([
    { label: 'Fit proyek', dim: !end, fn: () => fitTo(0, end) },
    { label: 'Fit klip terpilih', dim: !sc, fn: () => fitTo(sc.clip.start, sc.clip.start + sc.clip.len) },
    { label: 'Reset zoom (1.00x)', fn: () => glideTo(centreTick() - CW / (2 * 0.06), 0.06) },
    { label: 'Zoom in', fn: () => zoomAt(1.7) },
    { label: 'Zoom out', fn: () => zoomAt(1 / 1.7) },
    { sep: true },
    { label: 'Ikuti playhead', check: cfg.follow, fn: () => { prefs.follow = !prefs.follow; savePrefs(); cfg.follow = prefs.follow; invalidate(); } },
  ], o.left + CW - 62, o.top + H - 30);
}

// ------------------------------------------------------------------ markers
function markerMenu(m, x, y) {
  const o = canvasOrigin();
  menu([
    { label: 'Lompat ke marker', fn: () => P.seekTo(m.t) },
    { label: 'Ganti nama\u2026', fn: () => ask('Nama marker', m.name, (v) => { if (String(v).trim()) P.editMarker(m.id, { name: String(v).trim().slice(0, 24) }); invalidate(); }) },
    { label: 'Warna\u2026', fn: () => menu(P.MARKER_COLORS.map((c) => ({ label: '\u25A0 ' + c, check: m.color === c, fn: () => { P.editMarker(m.id, { color: c }); invalidate(); } })), o.left + x, o.top + y) },
    { label: 'Pindahkan ke playhead', fn: () => { P.editMarker(m.id, { t: Math.round(P.currentTick()) }); invalidate(); } },
    { sep: true },
    { label: 'Hapus marker', fn: () => { P.removeMarker(m.id); invalidate(); } },
  ], o.left + x, o.top + y);
}
function markerRowMenu(tick, x, y) {
  const o = canvasOrigin();
  menu([
    { label: 'Tambah marker di sini', fn: () => { P.addMarker(snapT(tick)); invalidate(); } },
    { label: 'Tambah marker di playhead', fn: () => { P.addMarker(Math.round(P.currentTick())); invalidate(); } },
    { sep: true },
    { label: 'Marker sebelumnya', dim: !state.markers.length, fn: () => P.jumpMarker(-1) },
    { label: 'Marker berikutnya', dim: !state.markers.length, fn: () => P.jumpMarker(1) },
    { sep: true },
    { label: 'Ubah birama di bar ' + (P.barAt(tick) + 1) + '\u2026', fn: () => sigDialog(P.barAt(Math.max(0, tick))) },
    ...(P.state.sigs.some((c) => c.bar === P.barAt(Math.max(0, tick))) ? [{ label: 'Hapus perubahan birama di bar ' + (P.barAt(tick) + 1), fn: () => { P.removeSigAt(P.barAt(Math.max(0, tick))); invalidate(); } }] : []),
  ], o.left + x, o.top + y);
}
// signature change at a bar (bar 0 = whole project): asks for "5/8" style input
export function sigDialog(bar) {
  const cur = P.sigTextAt(P.barStart(bar));
  ask('Birama mulai bar ' + (bar + 1) + ' (mis. 3/4, 7/8)', cur, (v) => {
    const m = /^\s*(\d{1,2})\s*\/\s*(1|2|4|8|16)\s*$/.exec(String(v));
    if (!m || +m[1] < 1 || +m[1] > 32) return toast('Format birama: pembilang 1-32 / penyebut 1, 2, 4, 8, atau 16.');
    if (P.setSigAt(bar, +m[1], +m[2]) === false) toast('Maksimal ' + P.MAX_SIG_CHANGES + ' perubahan birama.'); invalidate();
  });
}

// ------------------------------------------------------------------ gestures
let drag = null;
function setup() {
  attachGestures(ov, {
    hit,
    tap(x, y, t) {
      touchedAt = performance.now();
      switch (t.type) {
        case 'corner': return menu([...SNAPS.map((s, k) => ({ label: s[0], check: cfg.snap === k, fn: () => { cfg.snap = k; invalidate(); } })), { sep: true }, { label: 'Ikuti playhead', check: cfg.follow, fn: () => { cfg.follow = !cfg.follow; } }, { label: 'Pilih semua klip', fn: () => selAll() }, { label: 'Batal pilihan', dim: !msel.size, fn: () => clearSel() }, { sep: true }, { label: 'Lipat semua track', fn: () => foldAll(true) }, { label: 'Buka semua track', fn: () => foldAll(false) }], canvasOrigin().left + Math.max(0, CW - 20), canvasOrigin().top + RULER);
        case 'gridbtn': { const o = canvasOrigin(); return menu(SNAPS.map((s, k) => ({ label: s[0], check: cfg.snap === k, fn: () => { cfg.snap = k; invalidate(); } })), o.left + CW - 124, o.top + H - 30); }
        case 'zoombtn': return zoomMenu();
        case 'marker': return markerMenu(t.m, x, y);
        case 'mrow': return markerRowMenu(t.tick, x, y);
        case 'ruler': sel = null; P.seekTo(Math.max(0, snapT(t.tick))); return invalidate();
        case 'add': return addMenu(x, y);
        case 'xhead':
          if (t.mute) P.toggleReturnMute(t.x.k); else P.selectTrack(t.x.strip);
          return invalidate();
        case 'head':
          if (t.btn === 0) P.toggleMute(t.i); else if (t.btn === 1) P.toggleSolo(t.i); else if (t.btn === 2) toggleFold(t.i); else if (t.btn === 5) P.toggleArm(t.i); else if (t.btn === 6) P.toggleMonitor(t.i); else if (t.btn === 7) laneMenu(t.i, x, y); else P.selectTrack(t.i);
          return invalidate();
        case 'clip':
          if (msel.size) { if (msel.has(t.c.id)) msel.delete(t.c.id); else msel.add(t.c.id); P.selectClip(t.i, t.c.id); updateBar(); return invalidate(); }   // a selection exists: taps add / remove clips
          P.selectClip(t.i, t.c.id); clipBar(t.i, t.c, t.tick); return invalidate();
        case 'empty': if (msel.size) { msel.clear(); updateBar(); } sel = null; if (t.i >= 0 && t.i < state.tracks.length) { state.sel.clip = null; P.selectTrack(t.i); } return invalidate();
      }
    },
    dtap(x, y, t) { if (t.type === 'clip' && hooks.openEditor) { if (msel.size) { msel.clear(); updateBar(); } hooks.openEditor(); } },
    long(x, y, t) {
      touchedAt = performance.now();
      const r = canvasOrigin();
      if (t.type === 'mrow') { const m = P.addMarker(snapT(t.tick)); toast('Marker \u201c' + m.name + '\u201d ditambahkan.', 1600); invalidate(); return false; }
      if (t.type === 'marker') { drag = { k: 'marker', id: t.m.id }; return true; }
      if (t.type === 'xhead') xheadMenu(t.x, x, y);
      else if (t.type === 'head') headMenu(t.i, x, y);
      else if (t.type === 'clip') {
        // long-press a clip = pick it (more clips: just tap them); the floating bar offers copy / cut / paste / delete ...
        if (msel.has(t.c.id)) msel.delete(t.c.id); else msel.add(t.c.id);
        P.selectClip(t.i, t.c.id); updateBar(); invalidate();
      } else if (t.type === 'empty' && t.i >= 0 && t.i < state.tracks.length) {
        // long-press on empty space: keep the finger as a drag = rubber-band rectangle; lift without moving = new clip / paste menu
        P.selectTrack(t.i); msel.clear(); updateBar();
        const tk = xt(x), yw = y - RULER + view.y0;
        marq = { t0: tk, t1: tk, y0: yw, y1: yw, sx: r.left + x, sy: r.top + y, i: t.i, tick: t.tick, moved: false };
        drag = { k: 'marq' }; invalidate();
        return true;
      }
      return false;
    },
    dragStart(x0, y0, t, fromLong) {
      touchedAt = performance.now();
      if (t.type === 'punchL' || t.type === 'punchR') { drag = { k: t.type }; return true; }
      if (t.type === 'marker') { drag = { k: 'marker', id: t.m.id }; return true; }
      if (t.type === 'head' && (t.btn === 3 || t.btn === 4)) { const rc = hdr(t.i)[t.btn === 3 ? 'vol' : 'pan']; if (rc) { drag = { k: t.btn === 3 ? 'hvol' : 'hpan', i: t.i, rc }; return true; } }
      if (t.type === 'ruler') { drag = { k: 'sel', a: snapT(t.tick) }; sel = { a: drag.a, b: drag.a }; return true; }
      if (t.type === 'clip' && msel.has(t.c.id)) {                // group move / group resize of every picked clip
        checkpoint(); P.selectClip(t.i, t.c.id);
        if (t.zone === 'left' && t.c.notes) P.bakeLoop(t.c, t.i);          // trimming the left edge of a looped clip: turn the repeats into real notes first
        if (t.zone === 'right' && stretchMode && state.tracks[t.i].kind === 'audio') { delete t.c.ll; delete t.c.lp; }
        drag = { ll0: P.contentLen(t.c, state.tracks[t.i].kind), had: t.c.ll > 0, lp0: t.c.lp || 0, looped: !!P.loopOf(t.c), k: t.zone === 'right' ? 'gresize' : 'gmove', t0: t.tick, refStart: t.c.start, refEnd: t.c.start + t.c.len, row0: rowAt(y0), items: selList().map(({ i, c }) => ({ i, cur: i, c, start: c.start, len: c.len, ll0: P.contentLen(c, state.tracks[i].kind), had: c.ll > 0 })) };
        return true;
      }
      if (t.type === 'empty' && fromLong) return !!marq;
      if (t.type === 'clip' && msel.size) { msel.clear(); updateBar(); }   // dragging a clip outside the selection drops the selection
      if (t.type === 'clip') {
        checkpoint(); P.selectClip(t.i, t.c.id);
        if (t.zone === 'left' && t.c.notes) P.bakeLoop(t.c, t.i);          // trimming the left edge of a looped clip: turn the repeats into real notes first
        if (t.zone === 'right' && stretchMode && state.tracks[t.i].kind === 'audio') { delete t.c.ll; delete t.c.lp; }
        drag = { ll0: P.contentLen(t.c, state.tracks[t.i].kind), had: t.c.ll > 0, lp0: t.c.lp || 0, looped: !!P.loopOf(t.c), k: t.zone === 'right' ? (stretchMode && state.tracks[t.i].kind === 'audio' ? 'stretch' : 'resize') : t.zone === 'left' ? 'resizeL' : 'move', c: t.c, i: t.i, start: t.c.start, len: t.c.len, off: t.tick - t.c.start, t0: t.tick,
          offset: t.c.offset || 0, notes: t.c.notes ? t.c.notes.map((n) => ({ ...n })) : null, pts: t.c.pts ? t.c.pts.map((n) => ({ ...n })) : null };
        return true;
      }
      return false;
    },
    drag(x, y, dx, dy) {
      if (!drag) return;
      const tick = xt(x);
      if (drag.k === 'hvol' || drag.k === 'hpan') {
        const u = clamp((x - drag.rc.x) / drag.rc.w, 0, 1);
        if (drag.k === 'hvol') { const v = u * u * VMAX; P.setVol(drag.i, Math.abs(v - 1) < 0.03 ? 1 : v); }
        else { const v = u * 2 - 1; P.setPan(drag.i, Math.abs(v) < 0.06 ? 0 : v); }
        P.emit('mix'); invalidate(); return;
      }
      if (drag.k === 'marker') { P.editMarker(drag.id, { t: Math.max(0, snapT(tick)) }); invalidate(); return; }
      if (drag.k === 'punchL') { P.setPunch({ start: Math.min(snapT(tick), state.punch.end - BEAT) }); invalidate(); return; }
      if (drag.k === 'punchR') { P.setPunch({ end: Math.max(snapT(tick), state.punch.start + BEAT) }); invalidate(); return; }
      if (drag.k === 'sel') { sel = { a: Math.min(drag.a, snapT(tick)), b: Math.max(drag.a, snapT(tick)) }; }
      else if (drag.k === 'marq') {
        marq.t1 = xt(clamp(x, 0, CW)); marq.y1 = clamp(y, RULER, H) - RULER + view.y0;
        const o = canvasOrigin();
        if (Math.hypot(x - (marq.sx - o.left), y - (marq.sy - o.top)) > 10) marq.moved = true;
        const ta = Math.min(marq.t0, marq.t1), tb = Math.max(marq.t0, marq.t1), ya = Math.min(marq.y0, marq.y1), yb = Math.max(marq.y0, marq.y1);
        msel.clear();
        let wy = 0;
        state.tracks.forEach((t, i) => { const ry = wy, rb = wy + rh(i); wy = rb; if (rb < ya || ry > yb) return; for (const c of t.clips) if (c.start + c.len >= ta && c.start <= tb) msel.add(c.id); });
      } else if (drag.k === 'gmove') {
        const minS = Math.min(...drag.items.map((it) => it.start));
        const d = Math.max(snapT(drag.refStart + (tick - drag.t0)) - drag.refStart, -minS), tr = new Set();
        for (const it of drag.items) it.c.start = it.start + d;
        // vertical drag moves the whole group by the same number of tracks; shrink the step until every clip lands on a track of its own kind
        let dr = clamp(rowAt(y), 0, state.tracks.length - 1) - drag.row0;
        const okRow = (n) => drag.items.every((it) => { const t = state.tracks[it.i + n]; return t && t.kind === state.tracks[it.i].kind; });
        while (dr !== 0 && !okRow(dr)) dr += dr > 0 ? -1 : 1;
        for (const it of drag.items) {
          tr.add(it.cur);
          if (it.i + dr !== it.cur && P.moveClipToTrack(it.cur, it.c.id, it.i + dr)) it.cur = it.i + dr;
          tr.add(it.cur);
        }
        for (const i of tr) P.touchClips(i);
        P.emit('notes');
      } else if (drag.k === 'gresize') {
        const s = snapTicks() || 1, d = snapT(drag.refEnd + (tick - drag.t0)) - drag.refEnd, tr = new Set();
        for (const it of drag.items) { it.c.len = Math.max(s, it.len + d); applyLoop(it.c, it.ll0, it.len, it.had); tr.add(it.i); }
        for (const i of tr) P.touchClips(i);
        P.emit('notes');
      }
      else if (drag.k === 'move') {
        drag.c.start = Math.max(0, snapT(drag.start + (tick - drag.t0)));
        const r = clamp(rowAt(y), 0, state.tracks.length - 1);
        if (r !== drag.i && P.moveClipToTrack(drag.i, drag.c.id, r)) drag.i = r;
        P.touchClips(drag.i); P.emit('notes');
      } else if (drag.k === 'stretch') {
        const s = snapTicks() || 1, r0 = drag.c.warp ? drag.c.warp.ratio || 1 : 1;
        let nl = Math.max(s, snapT(drag.start + drag.len + (tick - drag.t0)) - drag.start);
        nl = clamp(nl, drag.len * 0.25 / r0, drag.len * 4 / r0);          // the stretch engine works between 0.25x and 4x of the original
        drag.c.len = Math.max(1, Math.round(nl)); drag.newLen = drag.c.len;
        live.set(drag.c.id, drag.c.len / drag.len);                  // waveform follows the finger (scaled), the real render happens on release
        P.emit('notes');
      } else if (drag.k === 'resize') {
        const s = snapTicks() || 1;
        drag.c.len = Math.max(s, snapT(drag.start + drag.len + (tick - drag.t0)) - drag.start);
        applyLoop(drag.c, drag.ll0, drag.len, drag.had);
        P.touchClips(drag.i); P.emit('notes');
      } else if (drag.k === 'resizeL') {
        // left edge: the end stays put, the start moves, and the content stays where it is in time (audio: offset into the sample, MIDI: note times)
        const c = drag.c, s = snapTicks() || 1, end = drag.start + drag.len, isAudio = state.tracks[drag.i].kind === 'audio';
        const offTicks = drag.offset * state.bpm / 60 * PPQ;           // how far the clip can still be stretched to the left before the sample starts
        let ns = snapT(drag.start + (tick - drag.t0));
        ns = Math.max(0, isAudio && !drag.looped ? Math.max(ns, drag.start - offTicks) : ns);
        ns = Math.min(ns, end - Math.min(s, drag.len));
        const shift = ns - drag.start;
        c.start = ns; c.len = end - ns;
        if (isAudio && drag.looped) c.lp = (((drag.lp0 + shift) % c.ll) + c.ll) % c.ll;          // looped audio: the loop phase moves, the loop keeps repeating to the left
        else if (isAudio) c.offset = Math.max(0, drag.offset + shift / PPQ * 60 / state.bpm);
        else if (drag.notes) {
          c.notes = drag.notes.map((n) => { const t = n.t - shift; return t < 0 ? { ...n, t: 0, d: n.d + t } : { ...n, t }; }).filter((n) => n.d > 0);
        } else if (drag.pts) c.pts = drag.pts.map((p) => ({ ...p, t: p.t - shift })).filter((p) => p.t >= 0 && p.t <= c.len);
        P.touchClips(drag.i); P.emit('notes');
      }
      if (drag.k === 'move' || drag.k === 'resize' || drag.k === 'stretch' || drag.k === 'resizeL' || drag.k === 'gmove' || drag.k === 'gresize' || drag.k === 'marq') { edgeScroll(x); if (drag.k === 'marq') edgeScrollY(y); }
      invalidate();
    },
    dragEnd(x, y, t, cancel) {
      if (drag && drag.k === 'sel') { if (sel && sel.b - sel.a < BEAT / 4) sel = null; else selMenu(); }
      if (drag && drag.k === 'marq') {
        const m = marq; marq = null; drag = null;
        if (m && !m.moved && !cancel) { msel.clear(); updateBar(); emptyMenu(m.i, m.tick, m.sx, m.sy); } else updateBar();
        invalidate(); return;
      }
      if (drag && drag.k === 'stretch') {
        const d = drag, c = d.c, nl = d.newLen || d.len; drag = null;
        if (cancel || nl === d.len) { live.delete(c.id); c.len = d.len; P.touchClips(d.i); P.emit('notes'); updateBar(); invalidate(); return; }
        // the clip keeps the length it was dragged to while the audio renders in the background (no jump back), then the new buffer takes over
        const r0 = c.warp ? c.warp.ratio || 1 : 1, k = nl / d.len;
        live.set(c.id, k); c.len = nl;
        P.restretchClip(d.i, c.id, r0 * k, { len: nl }).then((o) => {
          live.delete(c.id);
          if (o.error) { c.len = d.len; P.touchClips(d.i); toast(o.error, 4500); } else toast('Audio diregangkan.', 1200);
          P.emit('notes'); invalidate();
        });
        updateBar(); invalidate(); return;
      }
      drag = null; updateBar(); invalidate();
    },
    pan(dx, dy) {
      touchedAt = performance.now();
      const last = canvas._last;
      if (!(last && last.type === 'head')) view.x0 -= dx / view.ppt;
      view.y0 -= dy; clampView(); invalidate();
    },
    panEnd(vx, vy) {                                          // finger lifted while moving: keep gliding with friction (fling)
      touchedAt = performance.now();
      const last = canvas._last, cap = (v) => clamp(v, -5000, 5000);
      mo.vx = last && last.type === 'head' ? 0 : cap(vx); mo.vy = cap(vy);
      if (Math.hypot(mo.vx, mo.vy) < 90 || prefs.reduceMotion) mo.vx = mo.vy = 0;
    },
    pinch(cx, cy, sx, sy) {
      touchedAt = performance.now();
      const tick = xt(cx); view.ppt = clamp(view.ppt * sx, PMIN / 1.25, PMAX * 1.25); view.x0 = tick - cx / view.ppt;   // a little give past the limits, then it springs back (pinchEnd)
      const oh = view.rowH; view.rowH = clamp(oh * sy, MIN_ROW, 170); view.y0 = (cy - RULER + view.y0) * (view.rowH / oh) - (cy - RULER);
      clampView(); invalidate();
    },
    pinchEnd() {
      touchedAt = performance.now();
      const tp = clamp(view.ppt, PMIN, PMAX);
      if (tp !== view.ppt) glideTo(centreTick() - CW / (2 * tp), tp);
    },
    wheel(e, p) {
      touchedAt = performance.now();
      if (e.ctrlKey) { zoomAt(Math.exp(-e.deltaY * 0.002), p.x); return; }
      stopMotion();
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) view.x0 += (e.shiftKey ? e.deltaY : e.deltaX) / view.ppt; else view.y0 += e.deltaY;
      clampView(); invalidate();
    },
  });
  const down = new Set();
  ov.addEventListener('pointerdown', (e) => {
    const r = ov.getBoundingClientRect(); canvas._last = hit(e.clientX - r.left, e.clientY - r.top);
    down.add(e.pointerId); touching = true; touchedAt = performance.now(); stopMotion();   // a touch stops any glide or fling right where it is
    const ty = canvas._last.type; if (ty === 'corner' || ty === 'gridbtn' || ty === 'zoombtn') { pressed = ty; invalidate(); }
  }, true);
  const release = (e) => { down.delete(e.pointerId); if (!down.size) touching = false; if (pressed) { pressed = null; invalidate(); } };
  ov.addEventListener('pointerup', release, true); ov.addEventListener('pointercancel', release, true);
}

let ov, octx, hostEl;
function fit() {
  const r = hostEl.getBoundingClientRect();
  const nd = Math.min(window.devicePixelRatio || 1, 3), nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
  if (nw === W && nh === H && nd === dpr) return;            // nothing changed: do not clear the canvases
  dpr = nd; W = nw; H = nh; CW = Math.max(60, W - HEAD);
  for (const c of [canvas, ov]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }
  clampView();
  draw(); drawHead(P.currentTick()); dirty = false; headDirty = false;   // redraw in the same frame: no black flash while resizing
}
export const fitNow = () => fit();
// Drop target under a screen point while a browser item is dragged: a track row, a Master / effect row, or the "+" row. Reads layout only.
export function dropInfo(cx, cy) {
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect(), x = cx - r.left, y = cy - r.top;
  if (x < 0 || y < RULER || x > r.width || y > r.height) return null;
  const n = state.tracks.length, i = Math.min(rowAt(y), n + nX()), top = r.top + rowY(i);
  const base = { i, tick: x < CW ? Math.max(0, xt(x)) : null, top, h: rh(i), left: r.left, width: r.width };
  if (i < n) return { ...base, kind: 'track' };
  if (i < n + nX()) return { ...base, kind: 'fx', strip: xInfo(i).strip };
  return { ...base, kind: 'new' };
}
export function initTimeline(host, h) {
  hooks = h; hostEl = host;
  const wrap = document.createElement('div'); wrap.className = 'cv-wrap'; wrap.style.cssText = 'position:absolute;inset:0';
  canvas = document.createElement('canvas'); ov = document.createElement('canvas');
  wrap.append(canvas, ov); host.append(wrap);
  ctx = canvas.getContext('2d', { alpha: false }); octx = ov.getContext('2d');
  new ResizeObserver(fit).observe(host);
  window.addEventListener('themechange', invalidate); window.addEventListener('applayout', fit);
  fit(); setup(); buildSelBar(host);
  P.onChange((w) => { if (w === 'all') { stopMotion(); view.x0 = 0; view.y0 = 0; sel = null; msel.clear(); } if (msel.size && !drag) updateBar(); invalidate(); });
}
