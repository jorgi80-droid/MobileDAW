// Arrangement view: ruler, track headers, clips, playhead. One canvas, all hit-testing by hand.
// Gestures follow FL Studio Mobile (tap clip = controls, double-tap = editor, long-tap = menus,
// right-edge handle = resize, ruler drag = time selection) on an Ableton-style layout.
import { C, T } from './theme.js';
import { attachGestures } from './gesture.js';
import { menu, ask, modal, toast, clamp } from './ui.js';
import { checkpoint } from './history.js';
import { prefs, savePrefs } from './prefs.js';
import { wavePath, peaksPath } from './waveform.js';
import * as P from './project.js';
import { BAR, BEAT } from './project.js';   // live bindings (they follow the time signature)
import { pickColor } from './colorpick.js';
import { MASTER, RET0 } from './engine.js';
import { INSTRUMENTS, DEVICES } from './defs.js';
const { state, PPQ, SWATCHES } = P;

// Live 12 layout: locator strip + beat ruler on top, time ruler at the bottom (with the grid / zoom fields at its right end), track
// headers on the RIGHT: a title bar in the track colour, the mixer buttons under it, volume / pan sliders when the row is tall enough
// and a level meter along the right edge of every header.
let HEAD = 150;                                                 // header width, chosen by fit() from the canvas width
const RULER = 36, MROW = 13, BOT = 20, HANDLE = 18, TH = 20, METW = 9;   // top ruler (locators + beats) / bottom time ruler / header title bar / meter strip
const FOLD_H = 24, MIN_ROW = 52, ADD_H = 44, XROW_H = 48;                // folded row (title bar only) / smallest open row (title + buttons) / "+" row / Master + FX rows
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
const fh = new Map();     // track id -> row height while a fold / unfold glides; hit tests read the same height, so nothing under the finger jumps
const gl = new Map();     // clip id -> { c, s, l }: drawn start / length while a dragged clip glides onto its snapped position
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
const gridName = () => { const s = snapTicks(); if (!s) return 'Off'; const k = s / (BEAT * 4); return k >= 1 ? (Number.isInteger(k) ? k + ' Bar' : (s / BAR).toFixed(1) + ' Bar') : '1/' + Math.round(1 / k); };
const tx = (tick) => (tick - view.x0) * view.ppt;
const xt = (x) => view.x0 + x / view.ppt;
const LANE_B = () => H - BOT;                                  // bottom edge of the lanes (the time ruler sits below)
// rows have individual heights: a folded track is FOLD_H tall, the others view.rowH (gliding while a fold animates)
// below the tracks: the Master row and one row per effect track (Return A/B stay in the mixer), then the "+" row
const snapRect = () => ({ x: CW + 6, y: 7, w: HEAD - 12, h: RULER - 14 });
const followRect = () => ({ x: CW + 6, y: H - BOT + 3, w: HEAD - 12, h: BOT - 6 });
const badges = () => (CW < 170 ? [] : [['gridbtn', 'Grid ' + (SNAPS[cfg.snap][0] === 'Auto' ? gridName() : SNAPS[cfg.snap][0]), { x: CW - 150, y: H - BOT + 3, w: 92, h: BOT - 6 }], ['zoombtn', (view.ppt / 0.06).toFixed(2) + 'x', { x: CW - 54, y: H - BOT + 3, w: 50, h: BOT - 6 }]]);
let pressed = null;                                           // which corner / badge button is under the finger (drawn highlighted)
const nX = () => 1 + Math.max(0, state.returns.length - 2);
const xInfo = (i) => { const j = i - state.tracks.length; return j === 0 ? { master: true, strip: MASTER, name: 'Master', color: state.master.color || '#4cd964', obj: state.master } : { master: false, k: j + 1, strip: RET0 + j + 1, name: state.returns[j + 1].name, color: state.returns[j + 1].color || '#35d0e0', obj: state.returns[j + 1] }; };
const ROW_MAX = 260;
const rowTarget = (t) => (t.fold ? FOLD_H : t.hx ? Math.round(clamp(view.rowH * t.hx, MIN_ROW, ROW_MAX)) : view.rowH);   // t.hx = own height as a factor of the zoomed row height (drag the header's bottom edge)
const rh = (i) => { const n = state.tracks.length; if (i >= n) return i >= n + nX() ? ADD_H : XROW_H; const t = state.tracks[i], a = fh.size ? fh.get(t.id) : undefined; return a !== undefined ? a : rowTarget(t); };
function rowY(i) { let y = RULER - view.y0; for (let k = 0; k < i; k++) y += rh(k); return y; }
function rowAt(y) { let a = RULER - view.y0; const n = state.tracks.length + nX(); for (let i = 0; i <= n; i++) { const e = a + rh(i); if (y < e) return i; a = e; } return n + 1; }
const contentH = () => { let y = 0; for (let i = 0; i <= state.tracks.length + nX(); i++) y += rh(i); return y; };
// Header layout of one track. Controls only appear when the row is tall enough, so nothing can overlap; a folded row keeps its activator.
function hdr(i) {
  const t = state.tracks[i], y = rowY(i), h = rh(i), x = CW, auto = t.kind === 'auto', L = x + 5, R = x + HEAD - METW - 5, th = Math.min(TH, h - 3);
  const r = { y, h, th, title: { x, y, w: HEAD - METW, h: th }, fold: { x, y, w: 26, h: th } };
  if (h < 46) { r.mute = { x: R - (auto ? 26 : 20), y: y + 3, w: auto ? 26 : 20, h: Math.max(10, th - 6) }; return r; }   // folded: the activator sits in the title bar, as in Live
  const by = y + th + 5, bh = 19, bw = 22, gp = 3;                    // one grid: equal squares, equal gaps, both groups flush with the edges
  r.mute = { x: L, y: by, w: auto ? 36 : bw, h: bh };
  if (!auto) {
    r.solo = { x: L + bw + gp, y: by, w: bw, h: bh }; r.arm = { x: L + (bw + gp) * 2, y: by, w: bw, h: bh };
    r.aut = { x: R - bw, y: by, w: bw, h: bh };
    if (t.kind !== 'audio' && R - bw - gp - 30 >= L + (bw + gp) * 3) r.mon = { x: R - bw - gp - 30, y: by, w: 30, h: bh };
    if (h >= 70) { const sy = by + bh + 5, vw = Math.round((R - L - gp) * 0.6); r.vol = { x: L, y: sy, w: vw, h: 16 }; r.pan = { x: L + vw + gp, y: sy, w: R - L - vw - gp, h: 16 }; }
    if (h >= 96 && state.returns.length >= 2) { const sy = by + bh + 26, hw = Math.round((R - L - gp) / 2); r.sa = { x: L, y: sy, w: hw, h: 16 }; r.sb = { x: L + hw + gp, y: sy, w: R - L - hw - gp, h: 16 }; }   // tall row: Send A / B like the mixer strip
  }
  return r;
}
function xhdr(i) { const y = rowY(i), h = rh(i); return { y, h, act: { x: CW + 5, y: y + TH + 4, w: 28, h: 20 } }; }
const inRect = (r, x, y, p = 0) => x >= r.x - p && x <= r.x + r.w + p && y >= r.y - p && y <= r.y + r.h + p;

function clampView() {
  view.x0 = Math.max(0, view.x0);                           // the arrangement starts flush at the left edge: tick 0 is the first pixel, clips can reach it
  view.y0 = clamp(view.y0, 0, Math.max(0, contentH() - (H - RULER - BOT) + 20));
}

// ------------------------------------------------------------------ drawing
const FONT = (w, s) => `${w} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
function noteBox(c) {
  let lo = 127, hi = 0;
  for (const n of c.notes) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
  if (lo > hi) { lo = 48; hi = 72; }
  if (hi - lo < 11) { const m = (hi + lo) / 2; lo = m - 6; hi = m + 6; }
  return [lo, hi];
}

function washRgba(hex, a) { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex)); if (!m) return `rgba(128,128,128,${a})`; const v = parseInt(m[1], 16); return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`; }
const shadeCache = new Map();
function shade(hex, k) {                 // darken a colour by k (0..1): clip outlines and the note / waveform ink are deep tones of the track colour
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
const inkCache = new Map();
function ink(hex) {                     // text on a colour: dark on light colours, white on dark ones
  let r = inkCache.get(hex); if (r) return r;
  const n = parseInt(String(hex).slice(1, 7), 16) || 0, l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  r = l > 150 ? 'rgba(14,14,18,.9)' : 'rgba(255,255,255,.94)'; inkCache.set(hex, r); return r;
}

function drawClip(t, c, y, hh) {
  const g = gl.get(c.id), cs = g ? g.s : c.start, cl = g ? g.l : c.len;
  const x = tx(cs), w = cl * view.ppt;
  if (x > CW || x + w < 0) return;
  const xs = Math.max(x, 0), xe = Math.min(x + w, CW);
  const isSel = state.sel.clip === c.id || msel.has(c.id);
  const tall = hh >= 40, hd = tall ? 14 : 0, y0 = y + 1, h0 = hh - 2;   // folded / short rows: no title strip, only colour + content
  const col = c.muted ? C('#7c7c82') : t.color;
  ctx.save();
  const cy0 = Math.max(RULER, y0), cy1 = Math.min(LANE_B(), y0 + h0);              // clipped to the clip itself and the lane area: notes never spill while it glides
  ctx.beginPath(); ctx.rect(xs, cy0, Math.max(0, xe - xs), Math.max(0, cy1 - cy0)); ctx.clip();
  // Live 12: the whole clip in the track colour (title strip + body), content in a deep tone of it; a selected clip turns lighter
  const body = c.muted ? C('#8e8e94') : isSel ? tint(t.color, 0.42) : t.color;
  ctx.fillStyle = body; ctx.fillRect(x, y0, w, h0);
  if (tall) { ctx.fillStyle = isSel ? tint(col, 0.25) : col; ctx.fillRect(x, y0, w, hd); ctx.fillStyle = shade(c.muted ? '#7c7c82' : t.color, 0.35); ctx.fillRect(x, y0 + hd, w, 1); }
  ctx.strokeStyle = shade(c.muted ? '#7c7c82' : t.color, 0.5); ctx.lineWidth = 1; ctx.strokeRect(Math.round(x) + 0.5, y0 + 0.5, Math.max(0, Math.round(w) - 1), h0 - 1);
  if (tall && w > 18) {
    ctx.fillStyle = ink(col); ctx.font = FONT(600, 10); ctx.textBaseline = 'middle';
    ctx.fillText(c.name || (c.sample ? c.sample.name : t.name), xs + 5, y0 + hd / 2 + 0.5, Math.max(0, xe - xs - 10));
  }
  const by = y0 + hd + 2, bh = h0 - hd - 4, INK = c.muted ? 'rgba(20,20,24,.55)' : shade(t.color, 0.82);
  if (t.kind === 'auto' && c.pts && bh > 8) {
    const pts = [...c.pts].sort((a, b) => a.t - b.t), yy = (v) => by + bh - v * bh;
    ctx.fillStyle = washRgba(t.color, 0.35); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(x, yy(pts[0].v));
    for (const p of pts) ctx.lineTo(x + p.t * view.ppt, yy(p.v));
    ctx.lineTo(x + w, yy(pts[pts.length - 1].v)); ctx.stroke();
    ctx.lineTo(x + w, by + bh); ctx.lineTo(x, by + bh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = INK; for (const p of pts) { const px = x + p.t * view.ppt; if (px >= xs - 3 && px <= xe + 3) ctx.fillRect(px - 2, yy(p.v) - 2, 4, 4); }   // breakpoints, as in Live's automation
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
  } else if (c.notes && bh > 6) {
    const [lo, hi] = noteBox(c), span = hi - lo + 1, nh = Math.max(1.5, Math.min(bh / span, 6));
    ctx.fillStyle = INK;
    for (const g of P.loopSegs(c)) {                            // looped MIDI: the notes are drawn again in every repeat (no empty bars)
      const gx = x + g.o * view.ppt;
      if (gx > xe || gx + g.len * view.ppt < xs) continue;
      for (const n of c.notes) {
        if (n.t >= g.len) continue;
        const nx = gx + n.t * view.ppt, nw = Math.max(1.5, Math.min(n.d, g.len - n.t) * view.ppt - 0.5);
        if (nx + nw < xs || nx > xe) continue;
        ctx.fillRect(nx, by + (hi - n.p) / span * (bh - nh) , nw, nh);
      }
    }
  }
  if (t.kind === 'audio' && bh > 8) {                             // fades (Live): the faded part is shaded above the fade line; handles on the selected clip
    const spt = 60 / state.bpm / PPQ, fiw = Math.min(w / 2, (c.fadeIn || 0) / spt * view.ppt), fow = Math.min(w / 2, (c.fadeOut || 0) / spt * view.ppt), top = y0 + hd + 1, bot = y0 + h0 - 1;
    ctx.fillStyle = 'rgba(0,0,0,.24)'; ctx.strokeStyle = shade(t.color, 0.6); ctx.lineWidth = 1.2;
    if (fiw > 1) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + fiw, top); ctx.lineTo(x, bot); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(x, bot); ctx.lineTo(x + fiw, top); ctx.stroke(); }
    if (fow > 1) { ctx.beginPath(); ctx.moveTo(x + w, top); ctx.lineTo(x + w - fow, top); ctx.lineTo(x + w, bot); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(x + w - fow, top); ctx.lineTo(x + w, bot); ctx.stroke(); }
    if (isSel && w > 30) {
      const sq = (hx, hy, on) => { ctx.fillStyle = on ? C('#bfe3f5') : tint(t.color, 0.6); ctx.fillRect(Math.round(hx) - 4, Math.round(hy) - 4, 8, 8); ctx.strokeStyle = shade(t.color, 0.7); ctx.lineWidth = 1; ctx.strokeRect(Math.round(hx) - 3.5, Math.round(hy) - 3.5, 7, 7); };
      sq(x + Math.max(5, fiw), top + 4, fiw > 1); sq(x + w - Math.max(5, fow), top + 4, fow > 1);
      ctx.fillStyle = shade(t.color, 0.7); ctx.fillRect(Math.round(x) + 1, bot - 7, 7, 7); ctx.fillRect(Math.round(x + w) - 8, bot - 7, 7, 7);   // Live's clip corner marks
    }
  }
  if (c.ll > 0 && c.len > c.ll && w > 0) {                       // loop restarts: a notch in the title strip and a hairline through the body (Live's loop marks)
    for (const g of P.loopSegs(c)) {
      if (!g.o) continue; const gx = Math.round(x + g.o * view.ppt); if (gx < xs || gx > xe) continue;
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(gx, y0 + hd, 1, h0 - hd);
      if (tall) { ctx.fillStyle = shade(t.color, 0.5); ctx.beginPath(); ctx.moveTo(gx - 4, y0); ctx.lineTo(gx + 4, y0); ctx.lineTo(gx, y0 + 5); ctx.closePath(); ctx.fill(); }
    }
  }
  if (isSel) {
    ctx.strokeStyle = shade(t.color, 0.65); ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.75, y0 + 0.75, w - 1.5, h0 - 1.5);
    if (tall && w > 44 && !msel.size) { const mx = Math.min(x + w, CW) - 12, my = y0 + hd / 2; ctx.fillStyle = shade(t.color, 0.75); for (const d of [-4, 0, 4]) { ctx.beginPath(); ctx.arc(mx + d, my, 1.3, 0, 6.2832); ctx.fill(); } }   // ⋯ : the clip's context menu
    const hl = Math.min(26, h0 - hd - 10), hy = y0 + hd + (h0 - hd - hl) / 2, st = stretchMode && t.kind === 'audio';   // edge grips for touch: pills on both ends
    if (hl > 6 && w > 26) {
      ctx.fillStyle = shade(t.color, 0.7); ctx.fillRect(x + 3, hy, 3, hl);                              // edge grips: slim bars in the clip's ink
      ctx.fillStyle = st ? C('#ffa722') : shade(t.color, 0.7); ctx.fillRect(x + w - 6, hy, 3, hl);
    }
  }
  ctx.restore();
}

function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C('#1d1d1f'); ctx.fillRect(0, 0, W, H);
  const n = state.tracks.length, g = gridT(), LB = LANE_B(), nn = n + nX();
  ctx.save(); ctx.beginPath(); ctx.rect(0, RULER, CW, LB - RULER); ctx.clip();
  // lanes: one flat grey per track, the selected track a step lighter (as Live highlights the selected track's lane)
  for (let i = Math.max(0, rowAt(RULER)); i <= Math.min(n - 1, rowAt(LB)); i++) {
    const y = rowY(i), h = rh(i);
    ctx.fillStyle = state.sel.track === i ? C('#333337') : C('#2a2a2c'); ctx.fillRect(0, y, CW, h);
    ctx.fillStyle = C('#141415'); ctx.fillRect(0, y + h - 2, CW, 2);                     // Live: a heavy line between tracks
  }
  const xl = [];                                                                       // captions of the Master / effect lanes, drawn after the grid
  for (let i = Math.max(n, rowAt(RULER)); i < nn && i <= rowAt(LB); i++) {             // Master / effect track rows: no clips, they only mix
    const y = rowY(i), h = rh(i), x = xInfo(i);
    ctx.fillStyle = state.sel.track === x.strip ? C('#2f2f33') : C('#252527'); ctx.fillRect(0, y, CW, h);   // theme background first, so the tint below is a real transparent wash in dark AND light themes
    ctx.fillStyle = washRgba(x.color, 0.06); ctx.fillRect(0, y, CW, h); ctx.fillStyle = C('#141415'); ctx.fillRect(0, y + h - 1, CW, 1);
    const src = x.master ? state.tracks.filter((q) => q.kind !== 'auto' && !q.mute).length : state.tracks.filter((q) => q.out === x.k && !q.mute).length;
    xl.push({ y, h, t: `${src} track aktif → ${x.name}` });
  }
  const gy1 = Math.min(LB, rowY(nn));                                                   // grid only over the rows, not over the "+" row and the empty space below
  // grid: beats faint, bars stronger (drawn per bar, so 7/8 and signature changes stay right)
  const tEnd = view.x0 + CW / view.ppt + g;
  eachGrid(view.x0 - g, tEnd, g, (t, j) => {
    const x = Math.round(tx(t));
    if (x < 0 || x > CW) return;
    const r = t - P.MM.T[j];
    if (r % P.MM.bl[j] === 0) return;
    ctx.fillStyle = r % P.MM.bt[j] === 0 ? C('#323236') : C('#2b2b2e');
    ctx.fillRect(x, RULER, 1, gy1 - RULER);
  });
  ctx.fillStyle = C('#404045');
  for (let b = Math.max(0, P.barAt(view.x0)); tx(P.barStart(b)) < CW; b++) { const x = Math.round(tx(P.barStart(b))); if (x >= 0) ctx.fillRect(x, RULER, 1, gy1 - RULER); }
  if (P.state.sigs.length) { ctx.fillStyle = 'rgba(255,167,34,.3)'; for (const c of P.state.sigs) { const x = Math.round(tx(P.barStart(c.bar))); if (x >= 0 && x <= CW) ctx.fillRect(x, RULER, 1, gy1 - RULER); } }
  for (const m of state.markers) { const x = Math.round(tx(m.t)); if (x < 0 || x > CW) continue; ctx.fillStyle = C('#0e0e10'); ctx.fillRect(x, RULER, 1, gy1 - RULER); }   // Live: a dark line down from every locator
  const PU = state.punch;
  if (PU.on && PU.end > PU.start) { const a0 = Math.max(0, tx(PU.start)); ctx.fillStyle = 'rgba(255,54,54,.07)'; ctx.fillRect(a0, RULER, Math.max(0, Math.min(CW, tx(PU.end)) - a0), gy1 - RULER); ctx.fillStyle = 'rgba(255,54,54,.55)'; for (const e of [PU.start, PU.end]) { const lx = Math.round(tx(e)); if (lx >= 0 && lx <= CW) ctx.fillRect(lx, RULER, 1, gy1 - RULER); } }
  if (xl.length) {                                                                        // caption on a small pill, so the grid never cuts through the letters
    ctx.font = FONT(600, 10); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (const l of xl) {
      if (l.h < 22) continue;
      const w = Math.round(ctx.measureText(l.t).width + 20), x = Math.round(CW / 2 - w / 2), y = Math.round(l.y + l.h / 2 - 9);
      ctx.fillStyle = C('#1f1f21'); ctx.fillRect(x, y, w, 18); ctx.strokeStyle = C('#141415'); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 17);
      ctx.fillStyle = C('#8b8b92'); ctx.fillText(l.t, CW / 2, l.y + l.h / 2 + 0.5);
    }
    ctx.textAlign = 'left';
  }
  // the "+" row: Live's "Drop Files and Devices Here" area
  { const y = rowY(nn), h = rh(nn);
    if (y < LB && y + h > RULER && CW > 120) {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = C('#3c3c41'); ctx.lineWidth = 1; ctx.strokeRect(6.5, y + 6.5, CW - 13, h - 13); ctx.setLineDash([]);
      ctx.fillStyle = C('#6c6c73'); ctx.font = FONT(500, 11); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText('Seret sample, instrumen, atau efek ke sini • ketuk + untuk track baru', CW / 2, y + h / 2 + 0.5, CW - 30); ctx.textAlign = 'left';
    } }
  ctx.restore();
  // clips
  const first = Math.max(0, rowAt(RULER)), last = Math.min(n - 1, rowAt(LB));
  for (let i = first; i <= last; i++) { const y = rowY(i), h = rh(i); for (const c of state.tracks[i].clips) drawClip(state.tracks[i], c, y, h); }
  if (sel) { const a = Math.max(0, tx(sel.a)), b = Math.min(CW, tx(sel.b)); ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(a, RULER, Math.max(0, b - a), gy1 - RULER); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(Math.round(a), RULER, 1, gy1 - RULER); ctx.fillRect(Math.round(b), RULER, 1, gy1 - RULER); }   // Live: the selection is a white wash with bright edges
  if (marq) {
    const ax = tx(marq.t0), bx = tx(marq.t1), ay = RULER - view.y0 + marq.y0, by = RULER - view.y0 + marq.y1;
    const x = Math.min(ax, bx), y = Math.min(ay, by), w = Math.abs(bx - ax), hh = Math.abs(by - ay);
    ctx.save(); ctx.beginPath(); ctx.rect(0, RULER, CW, LB - RULER); ctx.clip();
    ctx.fillStyle = 'rgba(120,182,230,.16)'; ctx.fillRect(x, y, w, hh); ctx.strokeStyle = 'rgba(160,205,240,.9)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w, hh); ctx.restore();
  }
  drawRuler(g);
  drawTimeRuler();
  drawHeads();
  if (msel.size) placeBar();
}

let loopA = 0;                                                   // drawn brightness of the loop brace (eases to 1 when the loop is on)
const PUon = () => state.punch.on && state.punch.end > state.punch.start;
function drawRuler(g) {
  ctx.fillStyle = C('#202022'); ctx.fillRect(0, 0, CW, MROW);                              // locator strip
  ctx.fillStyle = C('#2c2c2f'); ctx.fillRect(0, MROW, CW, RULER - MROW);                   // beat time ruler
  ctx.fillStyle = C('#141415'); ctx.fillRect(0, MROW - 1, CW, 1); ctx.fillRect(0, RULER - 1, CW, 1);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, CW, RULER); ctx.clip();
  if (sel) { ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(tx(sel.a), MROW, tx(sel.b) - tx(sel.a), RULER - MROW - 1); }
  // loop brace along the bottom of the beat ruler: grey when the loop is off, lit when it is on (Live's Arrangement Loop)
  const LP = state.loop;
  if (LP && LP.end > LP.start) {
    const a = Math.round(tx(LP.start)), b = Math.round(tx(LP.end));
    if (b > 0 && a < CW) {
      const brace = () => { ctx.fillRect(a, RULER - 7, b - a, 5); ctx.fillRect(a, RULER - 12, 3, 10); ctx.fillRect(b - 3, RULER - 12, 3, 10); };
      ctx.fillStyle = C('#4c4c52'); brace();
      if (loopA > 0.01) { ctx.globalAlpha = loopA; ctx.fillStyle = T('--accent'); brace(); ctx.globalAlpha = 1; }   // on / off fades (Live's lit brace)
      if (drag && (drag.k === 'loop' || drag.k === 'loopL' || drag.k === 'loopR')) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(a, RULER - 7, b - a, 1); }
    }
  }
  ctx.font = FONT(500, 10); ctx.textBaseline = 'top';
  const barPx = BAR * view.ppt; let k = 1; while (barPx * k < 34) k *= 2;
  const chg = new Map(P.state.sigs.map((c) => [c.bar, c]));
  ctx.fillStyle = C('#4a4a50');
  eachGrid(view.x0 - g, view.x0 + CW / view.ppt + g, g, (t, j) => { const r = (t - P.MM.T[j]) % P.MM.bl[j]; if (r) ctx.fillRect(Math.round(tx(t)), r % P.MM.bt[j] ? RULER - 4 : RULER - 6, 1, r % P.MM.bt[j] ? 3 : 5); });
  for (let b = Math.floor(Math.max(0, P.barAt(view.x0)) / k) * k; tx(P.barStart(b)) < CW; b++) {
    const c = chg.get(b), x = Math.round(tx(P.barStart(b)));
    if (b % k && !c) { ctx.fillStyle = C('#4a4a50'); ctx.fillRect(x, RULER - 8, 1, 7); continue; }   // unlabelled bars: a longer tick
    ctx.fillStyle = c ? C('#ffa722') : C('#6a6a70'); ctx.fillRect(x, MROW, 1, RULER - MROW - 1);
    const lab = String(b + 1); ctx.fillStyle = c ? C('#ffa722') : C('#b4b4ba'); ctx.fillText(lab, x + 4, MROW + 3);
    if (c) { ctx.font = FONT(700, 9); ctx.fillText(c.n + '/' + c.d, x + 8 + ctx.measureText(lab).width, MROW + 4); ctx.font = FONT(500, 10); }
  }
  if (PUon()) { ctx.fillStyle = C('#ff3636'); ctx.fillRect(tx(state.punch.start), RULER - 3, tx(state.punch.end) - tx(state.punch.start), 2); ctx.fillRect(tx(state.punch.start) - 1, RULER - 11, 4, 9); ctx.fillRect(tx(state.punch.end) - 3, RULER - 11, 4, 9); }
  // locators (markers): a flag with its name on the locator strip
  ctx.font = FONT(600, 9); ctx.textBaseline = 'middle';
  const ml = state.markers;
  for (let k2 = 0; k2 < ml.length; k2++) {
    const m = ml[k2], x = Math.round(tx(m.t));
    if (x > CW + 4) break;
    const nx = k2 + 1 < ml.length ? Math.round(tx(ml[k2 + 1].t)) : CW + 200, w = Math.min(nx - x - 3, ctx.measureText(m.name).width + 16);
    if (x + Math.max(8, w) < 0) continue;
    ctx.fillStyle = C('#3a3a3e'); ctx.strokeStyle = C('#d6d6da'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 0.5, 0.5); ctx.lineTo(x + 9, MROW / 2); ctx.lineTo(x + 0.5, MROW - 1); ctx.closePath(); ctx.fill(); ctx.stroke();   // Live: outlined flag
    if (w > 18) { ctx.save(); ctx.beginPath(); ctx.rect(x + 1, 0, w, MROW); ctx.clip(); ctx.fillStyle = C('#d6d6da'); ctx.fillText(m.name, x + 12, MROW / 2); ctx.restore(); }
  }
  ctx.textBaseline = 'top';
  ctx.restore();
}
// time ruler (min:sec) under the lanes, like the one at the bottom of Live's Arrangement; the grid and zoom fields sit at its right end
function drawTimeRuler() {
  const y = H - BOT;
  ctx.fillStyle = C('#2c2c2f'); ctx.fillRect(0, y, CW, BOT); ctx.fillStyle = C('#141415'); ctx.fillRect(0, y, CW, 1);
  ctx.save(); ctx.beginPath(); ctx.rect(0, y, CW, BOT); ctx.clip();
  const s0 = Math.max(0, P.tickToSec(view.x0)), s1 = P.tickToSec(view.x0 + CW / view.ppt), pps = CW / Math.max(1e-6, s1 - s0);
  let st = 1; for (const q of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) { st = q; if (q * pps >= 58) break; }
  ctx.font = FONT(500, 9.5); ctx.textBaseline = 'middle';
  for (let s = Math.floor(s0 / st) * st; s <= s1 + st; s += st) {
    const x = Math.round(tx(P.secToTick(s))); if (x < -40 || x > CW) continue;
    ctx.fillStyle = C('#55555b'); ctx.fillRect(x, y + 1, 1, 6);
    const mm = Math.floor(s / 60), ss = s - mm * 60;
    ctx.fillStyle = C('#9a9aa2'); ctx.fillText(`${mm}:${(st < 1 ? ss.toFixed(1) : String(Math.floor(ss))).padStart(st < 1 ? 4 : 2, '0')}`, x + 4, y + BOT / 2 + 1);
  }
  ctx.restore();
  ctx.font = FONT(600, 10); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const bg = badges(); if (bg.length) { ctx.fillStyle = C('#2c2c2f'); ctx.fillRect(bg[0][2].x - 8, y + 1, CW - bg[0][2].x + 8, BOT - 1); ctx.fillStyle = C('#141415'); ctx.fillRect(bg[0][2].x - 8, y + 1, 1, BOT - 1); }
  for (const [type, lbl, r] of bg) {                         // Live-style fields: flat, 1 px border, lighter while pressed
    ctx.fillStyle = pressed === type ? C('#55555b') : C('#3a3a3e'); ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = C('#141415'); ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = C('#d4d4d8'); ctx.fillText(lbl, r.x + r.w / 2, r.y + r.h / 2 + 0.5, r.w - 6);
  }
  ctx.textAlign = 'left';
}

// Overlay layer: playhead + header meters. It is redrawn every frame while playing, the heavy static layer is not.
const meterFrac = (lv) => clamp((20 * Math.log10(Math.max(lv, 1e-4)) + 60) / 66, 0, 1);
let lastMeterKey = 0;
const mDisp = []; let mT = 0;                 // displayed levels: instant attack, ~26 dB/s release (same ballistics as the mixer), so header bars glide instead of flickering
function smoothMeters() {
  const now = performance.now(), dt = Math.min(0.12, (now - (mT || now)) / 1000); mT = now;
  const m = state.meters, n = m.length, k = Math.pow(10, -26 * dt / 20);
  for (let j = 0; j < n; j++) { const lv = (m[j] || 0) / 1000; let d = mDisp[j] || 0; d = lv >= d ? lv : d * k; mDisp[j] = d < 1e-4 ? 0 : d; }
}
const stripOfRow = (i) => (i < state.tracks.length ? (state.tracks[i].kind === 'auto' ? -1 : i) : xInfo(i).strip);
function meterKey() {                        // changes whenever a visible bar would change (24 steps), so the overlay is only redrawn when needed
  let k = 0; const nn = state.tracks.length + nX();
  for (let i = 0; i < nn; i++) { const s = stripOfRow(i); if (s < 0) continue; k = (k * 31 + Math.round(meterFrac(mDisp[s * 2] || 0) * 24) * 25 + Math.round(meterFrac(mDisp[s * 2 + 1] || 0) * 24)) | 0; }
  return k;
}
function drawMeters() {                      // Live: a slim stereo meter along the right edge of every track header, same scale as the mixer
  const mx = CW + HEAD - METW + 1, nn = state.tracks.length + nX();
  octx.save(); octx.beginPath(); octx.rect(CW, RULER, HEAD, LANE_B() - RULER); octx.clip();
  for (let i = Math.max(0, rowAt(RULER)); i <= Math.min(nn - 1, rowAt(LANE_B())); i++) {
    const s = stripOfRow(i); if (s < 0) continue;
    const y = rowY(i) + 3, hh = rh(i) - 7; if (hh < 6) continue;
    for (let ch = 0; ch < 2; ch++) {
      const f = meterFrac(mDisp[s * 2 + ch] || 0), bx = mx + 1 + ch * 3.5;
      if (f > 0.01) {
        const top = y + hh * (1 - f), yel = y + hh * (1 - 0.8), red = y + hh * (1 - 0.93);
        octx.fillStyle = '#4fae3a'; octx.fillRect(bx, Math.max(top, yel), 2.5, y + hh - Math.max(top, yel));
        if (top < yel) { octx.fillStyle = '#e8cf3a'; octx.fillRect(bx, Math.max(top, red), 2.5, yel - Math.max(top, red)); }
        if (top < red) { octx.fillStyle = '#e5484d'; octx.fillRect(bx, top, 2.5, red - top); }
      }
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
  const x = Math.round(px * dpr) / dpr;
  if (px >= 0) { octx.fillStyle = 'rgba(0,0,0,.35)'; octx.fillRect(x + 1.5, RULER, 1, LANE_B() - RULER); octx.fillStyle = C('#ffa722'); octx.fillRect(x, RULER, 1.5, LANE_B() - RULER); }
  octx.fillStyle = C('#ffa722'); octx.beginPath(); octx.moveTo(x - 5.5, MROW); octx.lineTo(x + 6.5, MROW); octx.lineTo(x + 0.75, MROW + 8); octx.closePath(); octx.fill();
  octx.restore();
}

const VMAX = 1.4;
const dbTxt = (v) => (v < 0.001 ? '-∞' : (20 * Math.log10(v)).toFixed(1));
const panTxt = (p) => (Math.abs(p) < 0.02 ? 'C' : Math.round(Math.abs(p) * 50) + (p < 0 ? 'L' : 'R'));
function cut2(txt, maxW) {                    // text that fits maxW, with an ellipsis when it does not
  if (ctx.measureText(txt).width <= maxW) return txt;
  let t = txt; while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
function foldTri(cx, cy, folded, col) {        // Live 12 fold toggle: a ring with a small triangle (right = folded, down = open)
  ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, 5.5, 0, 6.2832); ctx.stroke();
  ctx.fillStyle = col; ctx.beginPath();
  if (folded) { ctx.moveTo(cx - 1.5, cy - 3); ctx.lineTo(cx + 2.5, cy); ctx.lineTo(cx - 1.5, cy + 3); }
  else { ctx.moveTo(cx - 3, cy - 1.5); ctx.lineTo(cx + 3, cy - 1.5); ctx.lineTo(cx, cy + 2.5); }
  ctx.closePath(); ctx.fill();
}
// header button: flat grey with a 1 px border when off, filled with its colour when on (activator yellow, solo blue, arm red)
function drawBtn(r, label, on, col, quiet) {
  if (quiet) { ctx.fillStyle = C('#3e3e43'); ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeStyle = C('#141415'); ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);   // quiet switch: only the text lights up (input monitoring is on by default)
    ctx.fillStyle = on ? col : C('#8b8b92'); ctx.font = FONT(700, 10); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5, r.w - 2); ctx.textAlign = 'left'; return; }
  ctx.fillStyle = on ? col : C('#3e3e43'); ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = C('#141415'); ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  if (label === 'arm') { ctx.fillStyle = on ? '#ffffff' : C('#8b8b92'); ctx.beginPath(); ctx.arc(cx, cy, Math.min(4.5, r.h / 2 - 3), 0, 6.2832); ctx.fill(); return; }
  if (label === 'aut') {                       // automation: a small breakpoint envelope
    ctx.strokeStyle = on ? '#15151a' : C('#b4b4ba'); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(cx - 6, cy + 4); ctx.lineTo(cx - 2, cy - 3); ctx.lineTo(cx + 2, cy + 1); ctx.lineTo(cx + 6, cy - 4); ctx.stroke(); return;
  }
  ctx.fillStyle = on ? '#15151a' : C('#c8c8cc'); ctx.font = FONT(700, r.h < 16 ? 9 : 10.5); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + 0.5, r.w - 2); ctx.textAlign = 'left';
}
// Live's header slider: a dark well, a grey fill up to the value (from the centre for pan) and the value written over it
function drawSlider(r, frac, label, fromCenter) {
  ctx.fillStyle = C('#19191a'); ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = T('--lv-sel');
  if (fromCenter) { const c = r.x + r.w / 2, e = r.x + frac * r.w; if (Math.abs(e - c) >= 1) ctx.fillRect(Math.min(c, e), r.y + 1, Math.abs(e - c), r.h - 2); }
  else ctx.fillRect(r.x + 1, r.y + 1, Math.max(0, frac * (r.w - 2)), r.h - 2);
  ctx.strokeStyle = C('#141415'); ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  ctx.font = FONT(700, 9.5); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = C('#f2f2f4'); ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5, r.w - 4); ctx.textAlign = 'left';
}
function drawSwitch(r, label, on, isPressed) {   // Live-style switch: LED + text in a flat field
  ctx.fillStyle = isPressed ? C('#55555b') : C('#3a3a3e'); ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = C('#141415'); ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  const ly = r.y + r.h / 2; ctx.fillStyle = on ? T('--accent') : C('#55555b'); ctx.beginPath(); ctx.arc(r.x + 10, ly, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = on ? C('#e0e0e4') : C('#8b8b92'); ctx.font = FONT(600, 10); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillText(label, r.x + r.w / 2 + 6, ly + 0.5, r.w - 24); ctx.textAlign = 'left';
}
function drawHeads() {
  const hx = CW, n = state.tracks.length, LB = LANE_B();
  ctx.fillStyle = C('#1f1f21'); ctx.fillRect(hx, 0, HEAD, H);
  ctx.save(); ctx.beginPath(); ctx.rect(hx, RULER, HEAD, LB - RULER); ctx.clip();
  const nn = n + nX(), lanes = new Set();
  for (const q of state.tracks) if (q.kind === 'auto' && q.target) lanes.add(q.target.strip);
  for (let i = Math.max(0, rowAt(RULER)); i <= Math.min(nn, rowAt(LB)); i++) {
    const y = rowY(i), h = rh(i);
    if (i === nn) {                                                                          // "+" row: one wide button
      const r = { x: hx + 6, y: y + 8, w: HEAD - METW - 12, h: Math.min(28, h - 16) };
      ctx.fillStyle = C('#2c2c2f'); ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeStyle = C('#3c3c41'); ctx.lineWidth = 1; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.fillStyle = C('#b4b4ba'); ctx.font = FONT(600, 11); ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText('+  Track', r.x + r.w / 2, r.y + r.h / 2 + 0.5); ctx.textAlign = 'left';
      continue;
    }
    const meterWell = () => { ctx.fillStyle = C('#161617'); ctx.fillRect(hx + HEAD - METW, y, METW, h - 1); ctx.fillStyle = C('#101011'); ctx.fillRect(hx + HEAD - METW + 2, y + 3, 2.5, h - 7); ctx.fillRect(hx + HEAD - METW + 5.5, y + 3, 2.5, h - 7); };
    if (i >= n) {                                                                            // Master / effect track header
      const x = xInfo(i), on = state.sel.track === x.strip, fx = !x.master, rt = fx ? state.returns[x.k] : null, r = xhdr(i);
      ctx.fillStyle = on ? C('#3a3a3e') : C('#2c2c2f'); ctx.fillRect(hx, y, HEAD, h - 1);
      ctx.fillStyle = x.color; ctx.fillRect(hx, y, HEAD - METW, Math.min(TH, h - 3));
      ctx.fillStyle = ink(x.color); ctx.font = FONT(700, 11); ctx.textBaseline = 'middle'; ctx.fillText(cut2(x.name, HEAD - METW - 16), hx + 8, y + Math.min(TH, h - 3) / 2 + 0.5);
      if (h >= 44) {
        if (fx) drawBtn(r.act, x.k < 2 ? 'AB'[x.k] : 'F' + (x.k - 1), !rt.mute, T('--mute'));
        ctx.fillStyle = C('#8b8b92'); ctx.font = FONT(500, 10); ctx.textBaseline = 'middle';
        ctx.fillText(x.master ? 'Master • ' + dbTxt(state.master.vol) + ' dB' : 'FX track • ' + dbTxt(rt.vol) + ' dB', hx + (fx ? 40 : 8), r.act.y + r.act.h / 2 + 0.5, HEAD - METW - (fx ? 46 : 14));
      }
      meterWell();
      ctx.fillStyle = C('#141415'); ctx.fillRect(hx, y + h - 1, HEAD, 1);
      continue;
    }
    const t = state.tracks[i], on = state.sel.track === i, r = hdr(i), auto = t.kind === 'auto';
    ctx.fillStyle = on ? C('#3a3a3e') : C('#2c2c2f'); ctx.fillRect(hx, y, HEAD, h - 1);                    // selected track: the whole header a step lighter
    ctx.fillStyle = t.color; ctx.fillRect(hx, y, HEAD - METW, r.th);                                      // title bar in the track colour
    if (t.mute) { ctx.fillStyle = 'rgba(30,30,34,.35)'; ctx.fillRect(hx, y, HEAD - METW, r.th); }          // deactivated track: the title dims, as in Live
    const ik = ink(t.color);
    foldTri(hx + 12, y + r.th / 2, !!t.fold, ik);
    ctx.fillStyle = ik; ctx.font = FONT(on ? 700 : 600, 11); ctx.textBaseline = 'middle';
    const nameR = h < 46 ? r.mute.x - 4 : hx + HEAD - METW - 6;
    ctx.fillText(cut2(t.name, nameR - hx - 28), hx + 24, y + r.th / 2 + 0.5);                           // one line + ellipsis, never split mid-word (as Live's track names)
    if (h < 46) { drawBtn(r.mute, auto ? 'On' : String(i + 1), !t.mute, T('--mute')); }
    else {
      drawBtn(r.mute, auto ? 'On' : String(i + 1), !t.mute, T('--mute'));
      if (r.solo) drawBtn(r.solo, 'S', t.solo, T('--solo'));
      if (r.arm) drawBtn(r.arm, 'arm', !!t.arm, T('--rec'));
      if (r.mon) drawBtn(r.mon, 'In', t.mon !== false, T('--lv-orink'), true);
      if (r.aut) drawBtn(r.aut, 'aut', lanes.has(t.id), T('--accent'));
      if (auto && h >= 46) { ctx.fillStyle = C('#8b8b92'); ctx.font = FONT(500, 10); ctx.textBaseline = 'middle'; ctx.fillText(cut2('Otomasi', HEAD - METW - 50), r.mute.x + r.mute.w + 8, r.mute.y + r.mute.h / 2 + 0.5); }
      if (r.vol) drawSlider(r.vol, Math.sqrt(clamp(t.vol / VMAX, 0, 1)), dbTxt(t.vol) + ' dB', false);
      if (r.pan) drawSlider(r.pan, (clamp(t.pan, -1, 1) + 1) / 2, panTxt(t.pan), true);
      for (const [k, rc] of [[0, r.sa], [1, r.sb]]) if (rc) { const v = (t.send && t.send[k]) || 0; drawSlider(rc, v, 'AB'[k] + ' ' + Math.round(v * 100) + '%', false); }
    }
    if (!auto) meterWell(); else { ctx.fillStyle = C('#161617'); ctx.fillRect(hx + HEAD - METW, y, METW, h - 1); }
    ctx.fillStyle = C('#141415'); ctx.fillRect(hx, y + h - 2, HEAD, 2);                  // the same heavy line as the lane
    if (!t.fold && h >= MIN_ROW && (on || (drag && drag.k === 'rowh' && drag.i === i))) { ctx.fillStyle = drag && drag.k === 'rowh' && drag.i === i ? T('--accent') : C('#46464c'); ctx.fillRect(hx + (HEAD - METW) / 2 - 8, y + h - 3, 16, 1); }   // grip of the selected track: drag the bottom edge = row height
  }
  ctx.restore();
  ctx.fillStyle = C('#141415'); ctx.fillRect(hx, 0, 1, H);                                   // hairline between clip area and headers
  // top corner: Snap switch (tap: snap, follow, select / fold options)
  ctx.fillStyle = C('#2c2c2f'); ctx.fillRect(hx + 1, 0, HEAD - 1, RULER); ctx.fillStyle = C('#141415'); ctx.fillRect(hx, RULER - 1, HEAD, 1);
  drawSwitch(snapRect(), 'Snap ' + SNAPS[cfg.snap][0], cfg.snap !== SNAPS.length - 1, pressed === 'corner');
  // bottom corner: Follow switch (the arrangement scrolls with the playhead)
  ctx.fillStyle = C('#2c2c2f'); ctx.fillRect(hx + 1, H - BOT, HEAD - 1, BOT); ctx.fillStyle = C('#141415'); ctx.fillRect(hx, H - BOT, HEAD, 1);
  drawSwitch(followRect(), 'Follow', cfg.follow, pressed === 'follow');
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
  if (fh.size) {                                             // fold / unfold: row heights glide to their new size
    const k = ease(dt, 16);
    for (const t of state.tracks) {
      const a = fh.get(t.id); if (a === undefined) continue;
      const tg = rowTarget(t), nv = a + (tg - a) * k;
      if (Math.abs(tg - nv) < 0.5) fh.delete(t.id); else fh.set(t.id, nv);
    }
    for (const id of fh.keys()) if (!state.tracks.some((t) => t.id === id)) fh.delete(id);
    clampView(); moved = true;
  }
  { const tg = state.loop.on ? 1 : 0; if (loopA !== tg) { loopA = prefs.reduceMotion ? tg : loopA + (tg - loopA) * ease(dt, 14); if (Math.abs(tg - loopA) < 0.01) loopA = tg; moved = true; } }
  if (gl.size) {                                             // dragged clips glide onto their snapped position instead of jumping a grid step
    const k = ease(dt, 30);
    for (const [id, g] of gl) {
      g.s += (g.c.start - g.s) * k; g.l += (g.c.len - g.l) * k;
      if (Math.abs(g.c.start - g.s) * view.ppt < 0.3 && Math.abs(g.c.len - g.l) * view.ppt < 0.3) gl.delete(id);
    }
    moved = true;
  }
  return moved;
}
function animRow(t) { if (!prefs.reduceMotion && !fh.has(t.id)) fh.set(t.id, rowTarget(t)); }   // call before t.fold changes
function glideClip(c) { if (!prefs.reduceMotion && !gl.has(c.id)) gl.set(c.id, { c, s: c.start, l: c.len }); }   // call before c.start / c.len change

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
    const LP = state.loop;                                        // loop brace along the bottom of the beat ruler: ends = start / end, middle = move, tap = on / off
    if (y > RULER - 15 && LP.end > LP.start) {
      const a = tx(LP.start), b = tx(LP.end), ez = Math.min(14, Math.max(6, (b - a) / 3));
      if (x > a - 10 && x < b + 10) return Math.abs(x - a) < ez ? { type: 'loopL', tick: xt(x) } : Math.abs(x - b) < ez ? { type: 'loopR', tick: xt(x) } : { type: 'loop', tick: xt(x) };
    }
    return { type: 'ruler', tick: xt(x) };
  }
  if (y >= H - BOT) {                                                                            // time ruler: grid / zoom fields at its right end, Follow under the headers
    for (const [type, , r] of badges()) if (inRect(r, x, y, 3)) return { type };
    return x >= CW ? { type: 'follow' } : { type: 'tbar', tick: xt(x) };
  }
  const i = rowAt(y);
  if (x >= CW) {
    const n0 = state.tracks.length;
    if (i === n0 + nX()) return { type: 'add' };
    if (i < 0 || i > n0 + nX()) return { type: 'none' };
    if (i >= n0) { const xi = xInfo(i); return { type: 'xhead', x: xi, mute: !xi.master && rh(i) >= 44 && inRect(xhdr(i).act, x, y, 3) }; }
    if (!state.tracks[i].fold && rowY(i) + rh(i) - y < 8) return { type: 'rowh', i };          // bottom edge of a header: row height
    const r = hdr(i);
    for (const [k, key] of [[0, 'mute'], [1, 'solo'], [2, 'fold'], [3, 'vol'], [4, 'pan'], [5, 'arm'], [6, 'mon'], [7, 'aut'], [8, 'sa'], [9, 'sb']]) if (r[key] && inRect(r[key], x, y, key === 'vol' || key === 'pan' || key === 'sa' || key === 'sb' ? 1 : 2)) return { type: 'head', i, btn: k };
    return { type: 'head', i };
  }
  if (i < 0 || i >= state.tracks.length) return { type: 'empty', i, tick: xt(x) };
  const tick = xt(x);
  const clips = state.tracks[i].clips;
  for (let k = clips.length - 1; k >= 0; k--) {
    const c = clips[k];
    if (tick >= c.start && tick <= c.start + c.len) {
      const wpx = tx(c.start + c.len) - tx(c.start), hz = Math.min(HANDLE, wpx / 2.5);   // handles never take more than 40% of a narrow clip, so it stays movable
      if (state.sel.clip === c.id && state.tracks[i].kind === 'audio' && wpx > 30) {   // fade handles (top corners of the body): drag = fade length
        const spt = 60 / state.bpm / PPQ, y0 = rowY(i) + 1, top = y0 + (rh(i) >= 40 ? 14 : 0) + 5, fx = tx(c.start) + Math.max(5, Math.min(wpx / 2, (c.fadeIn || 0) / spt * view.ppt)), gx = tx(c.start + c.len) - Math.max(5, Math.min(wpx / 2, (c.fadeOut || 0) / spt * view.ppt));
        if (Math.abs(y - top) < 11) { if (Math.abs(x - fx) < 12) return { type: 'clip', i, c, tick, zone: 'fadeIn' }; if (Math.abs(x - gx) < 12) return { type: 'clip', i, c, tick, zone: 'fadeOut' }; }
      }
      if (state.sel.clip === c.id && rh(i) >= 40 && wpx > 44) { const mx = Math.min(tx(c.start + c.len), CW) - 12, my = rowY(i) + 8; if (Math.abs(x - mx) < 13 && Math.abs(y - my) < 11) return { type: 'clip', i, c, tick, zone: 'menu' }; }
      const edgeR = tx(c.start + c.len) - x < hz, edgeL = !edgeR && x - tx(c.start) < hz;
      return { type: 'clip', i, c, tick, zone: edgeR ? 'right' : edgeL ? 'left' : 'body' };
    }
  }
  return { type: 'empty', i, tick };
}

const canvasOrigin = () => canvas.getBoundingClientRect();
// Live's clip context menu: edit commands with their shortcuts, then clip commands, then the clip view
function clipMenu(i, c, tick, sx, sy) {
  const t = state.tracks[i], r = canvasOrigin();
  menu([
    { label: 'Edit', fn: () => { P.selectClip(i, c.id); if (hooks.openEditor) hooks.openEditor(); } },   // piano roll / drum step / audio editor, full screen
    { sep: true },
    { label: 'Cut', fn: () => { copyList([{ i, c }]); checkpoint(); P.removeClip(i, c.id); } },
    { label: 'Copy', fn: () => copyList([{ i, c }]) },
    { label: 'Duplicate', fn: () => { checkpoint(); P.duplicateClip(i, c.id); invalidate(); } },
    { label: 'Delete', fn: () => { checkpoint(); P.removeClip(i, c.id); } },
    { sep: true },
    { label: 'Rename', fn: () => renameClip(i, c) },
    { label: 'Split', fn: () => { checkpoint(); P.splitClip(i, c.id, snapT(tick)); } },
    { label: 'Snap Edges to Grid', fn: () => snapClip(i, c) },
    { label: c.muted ? 'Activate Clip' : 'Deactivate Clip', fn: () => { checkpoint(); P.setClipsMuted([{ i, c }], !c.muted); invalidate(); } },
    ...(c.notes && P.loopOf(c) ? [{ label: 'Unlink Loop', fn: () => { checkpoint(); P.bakeLoop(c, i); P.emit('clips'); invalidate(); toast('Pengulangan jadi not biasa.', 1600); } }] : []),
    ...(t.kind === 'audio' ? [{ label: 'Stretch Mode', check: stretchMode, fn: () => { stretchMode = !stretchMode; toast(stretchMode ? 'Mode stretch: tarik ujung kanan klip audio untuk meregangkan (pitch tetap).' : 'Mode stretch mati: tarik ujung kanan untuk memotong.', 3200); invalidate(); } }] : []),
  ], sx != null ? sx : r.left + clamp(tx(c.start), 0, Math.max(0, CW - 220)), sy != null ? sy : r.top + Math.max(RULER, rowY(i)) + 20);
}
function renameClip(i, c) { ask('Nama klip', c.name || '', (v) => { checkpoint(); c.name = String(v || '').trim().slice(0, 40); P.emit('clips'); invalidate(); }); }
function snapClip(i, c) {
  const a = Math.max(0, snapT(c.start)), e = snapT(c.start + c.len);
  if (a === c.start && e - a === c.len) return toast('Tepi klip sudah pas di grid.');
  if (e - a < 1) return toast('Klip terlalu pendek untuk di-snap.');
  checkpoint(); c.len = e - a; c.start = a; P.syncClips(i); P.touchClips(i); invalidate();
}

function selMenu() {
  const r = canvasOrigin();
  const a = sel.a, b = sel.b, len = b - a;
  menu([
    { label: 'Deselect', fn: () => { sel = null; invalidate(); } }, { sep: true },
    { label: 'Insert space', fn: () => { checkpoint(); cutAll(a); shift(a, len); sel = null; } },
    { label: 'Duplicate', fn: () => { checkpoint(); cutAll(a); cutAll(b); dupRange(a, b); sel = null; } },
    { label: 'Delete', fn: () => { checkpoint(); cutAll(a); cutAll(b); delRange(a, b); sel = null; } },
    { label: 'Delete space', fn: () => { checkpoint(); cutAll(a); cutAll(b); delRange(a, b); shift(b, -len); sel = null; } },
    { label: 'Trim', fn: () => { checkpoint(); cutAll(a); cutAll(b); delRange(0, a); delRange(b, 1e9); shift(a, -a); sel = null; } },
  ], r.left + clamp(tx(a), 0, Math.max(0, CW - 200)), r.top + RULER + 4);
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
  const recolor = () => { const before = xi.obj.color; pickColor({ title: 'Warna ' + xi.name, name: xi.name, color: xi.color, swatches: SWATCHES, onChange: (c) => { xi.obj.color = c; invalidate(); }, onDone: (c) => { if (c !== before) { P.noteColor(xi.master ? 'master' : 'ret' + xi.k, before); P.emit('tracks'); } } }); };
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
    { label: 'Warna', fn: () => { const before = t.color; pickColor({ title: 'Warna track', name: t.name, color: t.color, swatches: SWATCHES, onChange: (c) => { t.color = c; invalidate(); }, onDone: (c) => { if (c !== before) { P.noteColor(t.id, before); P.emit('tracks'); } } }); } },
    { label: t.fold ? 'Buka track' : 'Lipat track', fn: () => toggleFold(i) },
    { label: 'Pindah ke atas', fn: () => swapTrack(i, i - 1) },
    { label: 'Pindah ke bawah', fn: () => swapTrack(i, i + 1) },
    { sep: true },
    { label: 'Hapus track', fn: () => { P.removeTrack(i); } },
  ], r.left + x, r.top + y);
}
// Automation lane chooser (Live: the A button of a track): pick a parameter; its lane (an automation track) is created right below this track,
// or selected when it already exists. Existing lanes can be folded / opened together.
// Clip View (Envelopes box): the same lane menu, placed at a screen point
export function openLaneMenu(i, sx, sy) { const r = canvasOrigin(); laneMenu(i, sx - r.left, sy - r.top); }
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
  if (mine.length) { const allFold = mine.every((q) => q.fold); items.push({ sep: true }, { label: (allFold ? 'Buka' : 'Lipat') + ' semua lane track ini (' + mine.length + ')', fn: () => { for (const q of mine) { animRow(q); q.fold = !allFold; } clampView(); invalidate(); } }); }
  menu(items, r.left + x, r.top + y);
}
function toggleFold(i) { const t = state.tracks[i]; if (!t) return; animRow(t); t.fold = !t.fold; clampView(); invalidate(); }
function foldAll(on) { for (const t of state.tracks) { if (!!t.fold !== on) animRow(t); t.fold = on; } clampView(); invalidate(); }
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
  y = clamp(y, RULER + 4, Math.max(RULER + 4, H - BOT - bh - 4));
  selbar.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  selbar.classList.toggle('hide', !!drag);
}
function clearSel() { if (!msel.size) return; msel.clear(); marq = null; updateBar(); invalidate(); }
export function openEditor() { if (hooks.openEditor) hooks.openEditor(); }   // the selected clip's editor (full screen)
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
function groupMenu(btn) {                                            // the commands for the picked clips (one place, as the single-clip menu)
  const r = btn.getBoundingClientRect(), L = selList(), allMuted = L.length && L.every(({ c }) => c.muted);
  menu([
    { label: 'Copy', fn: selCopy }, { label: 'Duplicate', fn: selDup }, { label: 'Combine', fn: selCombine }, { label: 'Delete', fn: selDelete },
    { sep: true },
    { label: allMuted ? 'Activate Clips' : 'Deactivate Clips', fn: selMute }, { label: 'Select All', fn: selAll }, { label: 'Deselect', fn: clearSel },
  ], r.left, r.bottom + 2);
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
  const more = mk('menu', '\u22EF', () => groupMenu(more), 'sel'); cnt.hidden = false;
  selbar.append(cnt, more);                                          // only the count + ⋯: every group command lives in one menu
  host.append(selbar); updateBar();
}
// double tap on empty space (FL Studio Mobile): a 1-bar clip starting at the bar under the finger, shortened so it never runs into the
// next clip. Audio tracks open the sample picker at that bar instead (an audio clip needs a file).
const DTAP_MS = 330;                                             // a little longer than the recogniser's double-tap window (320 ms)
let menuWait = 0;
function newClipAt(i, tick) {
  const tk = state.tracks[i]; if (!tk) return;
  const at = Math.max(0, P.barFloor(Math.max(0, tick)));
  if (tk.kind === 'audio') { if (hooks.pickAudio) hooks.pickAudio(at); return; }
  if (tk.clips.some((c) => at >= c.start && at < c.start + c.len)) return;
  const next = tk.clips.reduce((m, c) => (c.start > at && c.start < m ? c.start : m), Infinity), len = Math.min(P.barLenAt(at), next - at);
  if (!(len > 0)) return;
  checkpoint(); P.addClip(i, at, len); invalidate();
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
  if (y > H - BOT - 22) view.y0 += 9; else if (y < RULER + 22 && view.y0 > 0) view.y0 -= 9; else return;
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
  ], o.left + CW - 54, o.top + H - BOT);
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
        case 'gridbtn': { const o = canvasOrigin(); return menu(SNAPS.map((s, k) => ({ label: s[0], check: cfg.snap === k, fn: () => { cfg.snap = k; invalidate(); } })), o.left + CW - 150, o.top + H - BOT); }
        case 'zoombtn': return zoomMenu();
        case 'marker': return markerMenu(t.m, x, y);
        case 'mrow': return markerRowMenu(t.tick, x, y);
        case 'ruler': case 'tbar': sel = null; P.seekTo(Math.max(0, snapT(t.tick))); return invalidate();
        case 'loop': case 'loopL': case 'loopR': P.setLoop({ on: !state.loop.on }); toast(state.loop.on ? 'Loop aktif.' : 'Loop mati.', 900); return invalidate();
        case 'follow': prefs.follow = !cfg.follow; savePrefs(); cfg.follow = prefs.follow; return invalidate();
        case 'add': return addMenu(x, y);
        case 'xhead':
          if (t.mute) P.toggleReturnMute(t.x.k); else P.selectTrack(t.x.strip);
          return invalidate();
        case 'head':
          if (t.btn === 0) P.toggleMute(t.i); else if (t.btn === 1) P.toggleSolo(t.i); else if (t.btn === 2) toggleFold(t.i); else if (t.btn === 5) P.toggleArm(t.i); else if (t.btn === 6) P.toggleMonitor(t.i); else if (t.btn === 7) laneMenu(t.i, x, y); else P.selectTrack(t.i);
          return invalidate();
        case 'clip':
          if (msel.size) { if (msel.has(t.c.id)) msel.delete(t.c.id); else msel.add(t.c.id); P.selectClip(t.i, t.c.id); updateBar(); return invalidate(); }   // a selection exists: taps add / remove clips
          if (t.zone === 'menu') { const r = canvasOrigin(); clipMenu(t.i, t.c, t.tick, r.left + x, r.top + y); return invalidate(); }   // its ⋯ = the context menu at once
          if (state.sel.clip === t.c.id) {                 // tap the selected clip = its context menu, held back for the double-tap window (a double tap opens the editor instead)
            const r = canvasOrigin(), sx = r.left + x, sy = r.top + y, { i, c, tick } = t;
            clearTimeout(menuWait); menuWait = setTimeout(() => { menuWait = 0; if (state.sel.clip === c.id) clipMenu(i, c, tick, sx, sy); }, DTAP_MS);
            return invalidate();
          }
          P.selectClip(t.i, t.c.id); return invalidate();                                  // first tap only selects, as in Live
        case 'empty': if (msel.size) { msel.clear(); updateBar(); } sel = null; if (t.i >= 0 && t.i < state.tracks.length) { state.sel.clip = null; P.selectTrack(t.i); } return invalidate();
      }
    },
    dtap(x, y, t) {
      if (t.type === 'rowh') { const tr = state.tracks[t.i]; if (tr && tr.hx) { animRow(tr); delete tr.hx; invalidate(); } return; }   // double-tap the grip: back to the normal height
      clearTimeout(menuWait); menuWait = 0;
      if (t.type === 'clip' && hooks.openEditor) { if (msel.size) { msel.clear(); updateBar(); } P.selectClip(t.i, t.c.id); hooks.openEditor(); return; }   // double tap a clip = its editor, full screen
      if (t.type === 'empty' && t.i >= 0 && t.i < state.tracks.length && !msel.size) newClipAt(t.i, t.tick);            // double tap empty space = a new 1-bar clip there
    },
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
      if (t.type === 'rowh') { fh.delete(state.tracks[t.i].id); drag = { k: 'rowh', i: t.i, y0, h0: rh(t.i) }; return true; }
      if (t.type === 'loop' || t.type === 'loopL' || t.type === 'loopR') { drag = { k: t.type, s0: state.loop.start, e0: state.loop.end, t0: t.tick }; return true; }
      if (t.type === 'head' && (t.btn === 3 || t.btn === 4)) { const rc = hdr(t.i)[t.btn === 3 ? 'vol' : 'pan']; if (rc) { drag = { k: t.btn === 3 ? 'hvol' : 'hpan', i: t.i, rc }; return true; } }
      if (t.type === 'head' && (t.btn === 8 || t.btn === 9)) { const rc = hdr(t.i)[t.btn === 8 ? 'sa' : 'sb']; if (rc) { drag = { k: 'hsend', s: t.btn - 8, i: t.i, rc }; return true; } }
      if (t.type === 'ruler') { drag = { k: 'rpend', a: snapT(t.tick), tick0: t.tick, p0: view.ppt }; return true; }   // direction decides: Live zoom (vertical) or time selection (horizontal)
      if (t.type === 'clip' && msel.has(t.c.id)) {                // group move / group resize of every picked clip
        checkpoint(); P.selectClip(t.i, t.c.id);
        if (t.zone === 'left' && t.c.notes) P.bakeLoop(t.c, t.i);          // trimming the left edge of a looped clip: turn the repeats into real notes first
        if (t.zone === 'right' && stretchMode && state.tracks[t.i].kind === 'audio') { delete t.c.ll; delete t.c.lp; }
        drag = { ll0: P.patternLen(t.c, state.tracks[t.i].kind), had: t.c.ll > 0, lp0: t.c.lp || 0, looped: !!P.loopOf(t.c), k: t.zone === 'right' ? 'gresize' : 'gmove', t0: t.tick, refStart: t.c.start, refEnd: t.c.start + t.c.len, row0: rowAt(y0), items: selList().map(({ i, c }) => ({ i, cur: i, c, start: c.start, len: c.len, ll0: P.patternLen(c, state.tracks[i].kind), had: c.ll > 0 })) };
        return true;
      }
      if (t.type === 'empty' && fromLong) return !!marq;
      if (t.type === 'clip' && msel.size) { msel.clear(); updateBar(); }   // dragging a clip outside the selection drops the selection
      if (t.type === 'clip' && (t.zone === 'fadeIn' || t.zone === 'fadeOut')) { checkpoint(); drag = { k: t.zone, c: t.c, i: t.i }; return true; }
      if (t.type === 'clip') {
        checkpoint(); P.selectClip(t.i, t.c.id);
        if (t.zone === 'left' && t.c.notes) P.bakeLoop(t.c, t.i);          // trimming the left edge of a looped clip: turn the repeats into real notes first
        if (t.zone === 'right' && stretchMode && state.tracks[t.i].kind === 'audio') { delete t.c.ll; delete t.c.lp; }
        drag = { ll0: P.patternLen(t.c, state.tracks[t.i].kind), had: t.c.ll > 0, lp0: t.c.lp || 0, looped: !!P.loopOf(t.c), k: t.zone === 'right' ? (stretchMode && state.tracks[t.i].kind === 'audio' ? 'stretch' : 'resize') : t.zone === 'left' ? 'resizeL' : 'move', c: t.c, i: t.i, start: t.c.start, len: t.c.len, off: t.tick - t.c.start, t0: t.tick,
          offset: t.c.offset || 0, notes: t.c.notes ? t.c.notes.map((n) => ({ ...n })) : null, pts: t.c.pts ? t.c.pts.map((n) => ({ ...n })) : null };
        return true;
      }
      return false;
    },
    drag(x, y, dx, dy) {
      if (!drag) return;
      const tick = xt(x);
      if (drag.k === 'hsend') { P.setSend(drag.i, drag.s, Math.round(clamp((x - drag.rc.x) / drag.rc.w, 0, 1) * 100) / 100); P.emit('mix'); invalidate(); return; }
      if (drag.k === 'hvol' || drag.k === 'hpan') {
        const u = clamp((x - drag.rc.x) / drag.rc.w, 0, 1);
        if (drag.k === 'hvol') { const v = u * u * VMAX; P.setVol(drag.i, Math.abs(v - 1) < 0.03 ? 1 : v); }
        else { const v = u * 2 - 1; P.setPan(drag.i, Math.abs(v) < 0.06 ? 0 : v); }
        P.emit('mix'); invalidate(); return;
      }
      if (drag.k === 'rowh') { const tr = state.tracks[drag.i]; if (tr) { const nh = clamp(drag.h0 + (y - drag.y0), MIN_ROW, ROW_MAX); tr.hx = nh / view.rowH; clampView(); } invalidate(); return; }
      if (drag.k === 'loop') { const len = drag.e0 - drag.s0, ns = Math.max(0, snapT(drag.s0 + (tick - drag.t0))); if (ns !== state.loop.start) P.setLoop({ start: ns, end: ns + len }); edgeScroll(x); invalidate(); return; }
      if (drag.k === 'loopL') { const v = clamp(snapT(tick), 0, state.loop.end - (snapTicks() || BEAT)); if (v !== state.loop.start) P.setLoop({ start: v }); edgeScroll(x); invalidate(); return; }
      if (drag.k === 'loopR') { const v = Math.max(snapT(tick), state.loop.start + (snapTicks() || BEAT)); if (v !== state.loop.end) P.setLoop({ end: v }); edgeScroll(x); invalidate(); return; }
      if (drag.k === 'marker') { P.editMarker(drag.id, { t: Math.max(0, snapT(tick)) }); invalidate(); return; }
      if (drag.k === 'punchL') { P.setPunch({ start: Math.min(snapT(tick), state.punch.end - BEAT) }); invalidate(); return; }
      if (drag.k === 'punchR') { P.setPunch({ end: Math.max(snapT(tick), state.punch.start + BEAT) }); invalidate(); return; }
      if (drag.k === 'rpend') {
        if (Math.abs(dy) > Math.abs(dx) * 1.15) { drag.k = 'rzoom'; stopMotion(); } else { drag.k = 'sel'; sel = { a: drag.a, b: drag.a }; }
      }
      if (drag.k === 'rzoom') {                                  // Live's beat ruler: drag down = zoom in, up = zoom out, sideways = scroll; the bar under the finger stays under it
        view.ppt = clamp(drag.p0 * Math.exp(dy * 0.011), PMIN, PMAX); view.x0 = Math.max(0, drag.tick0 - x / view.ppt); clampView(); invalidate(); return;
      }
      if (drag.k === 'sel') { sel = { a: Math.min(drag.a, snapT(tick)), b: Math.max(drag.a, snapT(tick)) }; }
      else if (drag.k === 'marq') {
        marq.t1 = xt(clamp(x, 0, CW)); marq.y1 = clamp(y, RULER, H - BOT) - RULER + view.y0;
        const o = canvasOrigin();
        if (Math.hypot(x - (marq.sx - o.left), y - (marq.sy - o.top)) > 10) marq.moved = true;
        const ta = Math.min(marq.t0, marq.t1), tb = Math.max(marq.t0, marq.t1), ya = Math.min(marq.y0, marq.y1), yb = Math.max(marq.y0, marq.y1);
        msel.clear();
        let wy = 0;
        state.tracks.forEach((t, i) => { const ry = wy, rb = wy + rh(i); wy = rb; if (rb < ya || ry > yb) return; for (const c of t.clips) if (c.start + c.len >= ta && c.start <= tb) msel.add(c.id); });
      } else if (drag.k === 'gmove') {
        const minS = Math.min(...drag.items.map((it) => it.start));
        const d = Math.max(snapT(drag.refStart + (tick - drag.t0)) - drag.refStart, -minS), tr = new Set();
        for (const it of drag.items) { if (it.c.start !== it.start + d) glideClip(it.c); it.c.start = it.start + d; }
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
        for (const it of drag.items) { if (it.c.len !== Math.max(s, it.len + d)) glideClip(it.c); it.c.len = Math.max(s, it.len + d); applyLoop(it.c, it.ll0, it.len, it.had); tr.add(it.i); }
        for (const i of tr) P.touchClips(i);
        P.emit('notes');
      }
      else if (drag.k === 'fadeIn' || drag.k === 'fadeOut') {          // fade length in seconds, at most half the clip
        const c = drag.c, spt = 60 / state.bpm / PPQ, half = c.len / 2 * spt, sec = drag.k === 'fadeIn' ? (tick - c.start) * spt : (c.start + c.len - tick) * spt;
        c[drag.k] = Math.round(clamp(sec, 0, half) * 1000) / 1000;
        P.touchClips(drag.i); P.emit('notes');
      }
      else if (drag.k === 'move') {
        const ns = Math.max(0, snapT(drag.start + (tick - drag.t0)));
        if (ns !== drag.c.start) glideClip(drag.c);
        drag.c.start = ns;
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
        const s = snapTicks() || 1, nl = Math.max(s, snapT(drag.start + drag.len + (tick - drag.t0)) - drag.start);
        if (nl !== drag.c.len) glideClip(drag.c);
        drag.c.len = nl;
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
    const ty = canvas._last.type; if (ty === 'corner' || ty === 'gridbtn' || ty === 'zoombtn' || ty === 'follow') { pressed = ty; invalidate(); }
  }, true);
  const release = (e) => { down.delete(e.pointerId); if (!down.size) touching = false; if (pressed) { pressed = null; invalidate(); } };
  ov.addEventListener('pointerup', release, true); ov.addEventListener('pointercancel', release, true);
}


let ov, octx, hostEl;
function fit() {
  const r = hostEl.getBoundingClientRect();
  const nd = Math.min(window.devicePixelRatio || 1, 3), nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
  if (nw === W && nh === H && nd === dpr) return;            // nothing changed: do not clear the canvases
  dpr = nd; W = nw; H = nh; HEAD = W >= 1100 ? 172 : W >= 760 ? 152 : 132; CW = Math.max(60, W - HEAD);
  for (const c of [canvas, ov]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }
  clampView();
  draw(); drawHead(P.currentTick()); dirty = false; headDirty = false;   // redraw in the same frame: no black flash while resizing
}
export const fitNow = () => fit();
// Drop target under a screen point while a browser item is dragged: a track row, a Master / effect row, or the "+" row. Reads layout only.
export function dropInfo(cx, cy) {
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect(), x = cx - r.left, y = cy - r.top;
  if (x < 0 || y < RULER || x > r.width || y > r.height - BOT) return null;
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
  P.onChange((w) => { if (w === 'all') { stopMotion(); view.x0 = 0; view.y0 = 0; sel = null; msel.clear(); fh.clear(); gl.clear(); } if (msel.size && !drag) updateBar(); invalidate(); });
  ov.addEventListener('contextmenu', (e) => {                    // right click (mouse / trackpad): Live's clip context menu
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, t = hit(x, y);
    if (t.type !== 'clip') return;
    e.preventDefault(); P.selectClip(t.i, t.c.id); invalidate(); clipMenu(t.i, t.c, t.tick, e.clientX, e.clientY);
  });
}
