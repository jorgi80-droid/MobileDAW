// Clip editor: piano roll (MIDI), step sequencer (drum clips) and a small audio-clip panel.
// Gestures follow FL Studio Mobile: tap grid = add note, tap note = controls, long-press note = delete menu,
// long-press + drag on empty = rubber-band select, ruler drag = time selection, drag-up lane = velocity.
import { C } from './theme.js';
import { attachGestures } from './gesture.js';
import { bar, menu, ask, toast, h, clamp } from './ui.js';
import { checkpoint } from './history.js';
import * as AE from './audioedit.js';
import { eng } from './engine.js';
import { fmtParam, valOf } from './defs.js';
import * as DP from './drumpad.js';
import * as P from './project.js';
const { state } = P;
import { BAR, BEAT } from './project.js';   // live bindings (they follow the time signature)

let KEYS = 36, VEL = 64;   // key strip width / lane height: set by dims() (narrow piano for MIDI notes, wider for drum names and automation values)
const RULER = 18, LANE_HEAD = 92, STEP = 240;
// Snap values exactly as FL Studio Mobile lists them: fractions of a step (1 step = 1/16 note), fractions of a beat, and a bar.
const sn = (n, f) => ({ 0: n, get 1() { return f(); } });   // read live: BAR / BEAT change with the time signature
const SNAPS = [sn('1/6 Step', () => STEP / 6), sn('1/4 Step', () => STEP / 4), sn('1/3 Step', () => STEP / 3), sn('1/2 Step', () => STEP / 2), sn('1 Step', () => STEP), sn('1/6 Beat', () => BEAT / 6), sn('1/4 Beat', () => BEAT / 4), sn('1/3 Beat', () => BEAT / 3), sn('1/2 Beat', () => BEAT / 2), sn('1 Beat', () => BEAT), sn('Bar', () => BAR)];
const SCALES = { Chromatic: null, Major: [0, 2, 4, 5, 7, 9, 11], Minor: [0, 2, 3, 5, 7, 8, 10], Dorian: [0, 2, 3, 5, 7, 9, 10], Phrygian: [0, 1, 3, 5, 7, 8, 10], Lydian: [0, 2, 4, 6, 7, 9, 11], Mixolydian: [0, 2, 4, 5, 7, 9, 10], 'Harmonic minor': [0, 2, 3, 5, 7, 8, 11], 'Pentatonic major': [0, 2, 4, 7, 9], 'Pentatonic minor': [0, 3, 5, 7, 10], Blues: [0, 3, 5, 6, 7, 10] };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);

const cfg = { snap: 6, snapOn: true, key: 0, scale: 'Chromatic', lock: false, vel: true, lane: 'vel', cc: { k: 'bend', n: 0 }, ccErase: false, mode: 'auto', lastLen: STEP, follow: true };
const v = { x0: 0, ppt: 0.12, top: 84, keyH: 16 };
const sv = { x0: 0, stepW: 30, y0: 0, rowH: 38 };
let side = null, padSel = -1, padTrack = -1;   // drum pad panel (right of the step grid) and the pad it shows
let title = null, fitId = null, needFit = false, lastHx = 0, asel = null, root, tools, host, canvas, ctx, W = 0, H = 0, dpr = 1, dirty = true, sel = new Set(), tsel = null, clipboard = null, drag = null, previewOff = 0;

export const invalidate = () => { dirty = true; };
const cur = () => P.selectedClip();
const ink = (hex) => { const m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#141414'; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 140 ? '#141414' : '#f2f2f2'; };
// Clip title bar (Live: activator + clip name on the clip colour). Same mute flag as the Mute entry of the clip menu.
function updateTitle() {
  if (!title) return;
  const c = cur();
  if (!c) { title.hidden = true; title.replaceChildren(); return; }
  const t = state.tracks[c.track], cl = c.clip, on = !cl.muted;
  title.hidden = false; title.classList.toggle('off', !on);
  title.style.background = t.color; title.style.color = ink(t.color);
  title.replaceChildren(
    h('button', { class: 'ct-act' + (on ? ' on' : ''), 'aria-label': 'Klip aktif', onclick: () => { checkpoint(); P.setClipsMuted([{ i: c.track, c: cl }], on); updateTitle(); invalidate(); } }),
    h('span', { class: 'ct-name' }, cl.name || (cl.dsample || cl.sample || {}).name || t.name));
}
const snapUnit = () => (cfg.snapOn ? Math.round(SNAPS[cfg.snap][1]) : 0);
let CS = 0;   // start tick (on the timeline) of the clip being drawn / edited: bar lines, beats and snapping follow the project's meter map
const snapT = (t) => {
  const s = snapUnit(); if (!s) return Math.round(t);
  const sc = P.state.sigs.length ? P.selectedClip() : null;
  if (!sc) return Math.round(t / s) * s;
  const M = P.MM, a = sc.clip.start + t, j = M.segOfTick(Math.max(0, a)), s0 = M.T[j], e0 = j + 1 < M.m ? M.T[j + 1] : Infinity;   // steps restart at every signature change
  return Math.round(Math.max(s0, Math.min(e0, s0 + Math.round((a - s0) / s) * s)) - sc.clip.start);
};
function barLinesLocal(fn) {                                     // fn(localTick, barIndexInClip)
  if (!P.state.sigs.length) { for (let b = Math.max(0, Math.floor(v.x0 / BAR)); px(b * BAR) < W; b++) fn(b * BAR, b); return; }
  const b0 = P.barAt(P.barCeil(CS));
  for (let k = Math.max(0, P.barAt(CS + v.x0) - b0); px(P.barStart(b0 + k) - CS) < W; k++) fn(P.barStart(b0 + k) - CS, k);
}
function gridLocal(g, fn) {                                      // fn(localTick, kind) kind: 0 sub-beat, 1 beat, 2 bar
  if (!P.state.sigs.length) { for (let q = Math.floor(v.x0 / g) * g; px(q) < W; q += g) fn(q, q % BAR === 0 ? 2 : q % BEAT === 0 ? 1 : 0); return; }
  const M = P.MM, a = CS + v.x0 - g, e = CS + tk(W) + g;
  for (let j = M.segOfTick(Math.max(0, a)); j < M.m; j++) {
    const s0 = M.T[j], e0 = j + 1 < M.m ? M.T[j + 1] : Infinity; if (s0 >= e) break;
    const hi = Math.min(e, e0);
    for (let t = s0 + Math.max(0, Math.floor((a - s0) / g)) * g; t < hi; t += g) { const r = t - s0; fn(t - CS, r % M.bl[j] === 0 ? 2 : r % M.bt[j] === 0 ? 1 : 0); }
  }
}
const clipBars = (cl, b) => (P.state.sigs.length ? P.barStart(P.barAt(cl.start) + b) - cl.start : b * BAR);
const floorT = (t) => { const s = snapUnit(); return s ? Math.floor(t / s) * s : Math.round(t); };
const quantT = (t) => { const s = Math.round(SNAPS[cfg.snap][1]); return Math.round(t / s) * s; };   // explicit Snap/quantize command works even when the grid snap is switched off
const snapLabel = () => 'Snap: ' + (cfg.snapOn ? SNAPS[cfg.snap][0] : 'Off');
const inScale = (p) => { const s = SCALES[cfg.scale]; return !s || s.includes(((p - cfg.key) % 12 + 12) % 12); };
function toScale(p) { if (inScale(p)) return p; for (let d = 1; d < 7; d++) { if (inScale(p - d)) return p - d; if (inScale(p + d)) return p + d; } return p; }
const isAuto = () => { const c = cur(); return c && state.tracks[c.track].kind === 'auto'; };
const isDrum = () => { const c = cur(); return c && state.tracks[c.track].kind === 'drum'; };
const stepsMode = () => isDrum() && cfg.mode !== 'notes';
const pName = (p) => NAMES[p % 12] + (Math.floor(p / 12) - 1);
const padList = () => { const c = cur(); return c && state.tracks[c.track].kind === 'drum' ? P.padsOf(c.track) : []; };
const keyLabel = (p) => { if (isDrum()) { const d = padList().find((x) => x.pitch === p); if (d) return d.name; } return pName(p); };
const pan0 = (n) => n.pan || 0;
function dims() {
  KEYS = isDrum() || isAuto() ? 54 : 48;   // v66: wider piano ruler (Live's is wider than a thumb); every hit test and drawing uses KEYS
  VEL = clamp(Math.round(H * 0.2), 36, 64);   // small panel: the Velocity lane shrinks so the note grid is not eaten by it
}

// ------------------------------------------------------------------ geometry
const px = (t) => KEYS + (t - v.x0) * v.ppt;
const tk = (x) => v.x0 + (x - KEYS) / v.ppt;
const py = (p) => RULER + (v.top - p) * v.keyH;
const pAt = (y) => Math.floor(v.top - (y - RULER) / v.keyH);
const gridBottom = () => H - (cfg.vel ? VEL : 0);
function clampV(c) {
  v.ppt = clamp(v.ppt, 0.02, 1.5); v.keyH = clamp(v.keyH, 8, 44);
  const rows = (gridBottom() - RULER) / v.keyH;
  v.top = clamp(v.top, rows - 1 + 0, 128); v.x0 = clamp(v.x0, 0, Math.max(0, (c ? c.len : BAR) - 200));   // never scroll before the clip start (no empty strip left of bar 1)
}

// ------------------------------------------------------------------ drawing
function drawRoll(t, c) {
  CS = c.start; const gb = gridBottom();
  ctx.fillStyle = C('#1b1b1c'); ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.beginPath(); ctx.rect(KEYS, RULER, W - KEYS, gb - RULER); ctx.clip();
  const p0 = Math.max(0, pAt(gb)), p1 = Math.min(127, pAt(RULER));
  const sc = SCALES[cfg.scale];
  for (let p = p0; p <= p1; p++) {
    const y = py(p);
    ctx.fillStyle = BLACK.has(p % 12) ? C('#1e1e20') : C('#262629');
    if (sc && inScale(p)) ctx.fillStyle = BLACK.has(p % 12) ? C('#272431') : C('#2e2a3a');
    if (sc && ((p - cfg.key) % 12 + 12) % 12 === 0) ctx.fillStyle = C('#3a3350');
    ctx.fillRect(KEYS, y - v.keyH, W - KEYS, v.keyH);
    ctx.fillStyle = p % 12 === 0 ? C('#3d3d42') : C('#1b1b1d'); ctx.fillRect(KEYS, y - 1, W - KEYS, 1);
  }
  const g = [60, 120, 240, 480, 960, 1920, 3840].find((x) => x * v.ppt >= 12) || 3840;
  gridLocal(g, (q, kd) => { if (kd === 2) return; ctx.fillStyle = kd === 1 ? C('#38383d') : C('#2b2b2f'); ctx.fillRect(Math.round(px(q)), RULER, 1, gb - RULER); });
  ctx.fillStyle = C('#4a4a50'); barLinesLocal((q) => ctx.fillRect(Math.round(px(q)), RULER, 1, gb - RULER));   // bar lines per bar (7/8, 5/4 ...)
  ctx.fillStyle = 'rgba(0,0,0,.45)'; const ce = px(c.len); if (ce < W) ctx.fillRect(Math.max(KEYS, ce), RULER, W - ce, gb - RULER);
  if (tsel) { ctx.fillStyle = 'rgba(79,163,224,.2)'; ctx.fillRect(px(tsel.a), RULER, px(tsel.b) - px(tsel.a), gb - RULER); }
  for (const n of c.notes) {
    const x = px(n.t), w = Math.max(3, n.d * v.ppt), y = py(n.p) - v.keyH;
    if (x + w < KEYS || x > W || y > gb || y + v.keyH < RULER) continue;
    ctx.fillStyle = t.color; ctx.globalAlpha = 0.4 + 0.6 * n.v; ctx.fillRect(x, y + 1, w - 1, v.keyH - 2); ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 1.5, w - 2, v.keyH - 3);   // v65: flat note with a hairline outline, like Live (no bevel)
    if (w > 14 && (sel.has(n) || w > 28)) { ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(x + w - 4, y + 3, 2, v.keyH - 6); }   // right edge: resize grip, kept for touch
    if (sel.has(n)) { ctx.strokeStyle = C('#fff'); ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 2, w - 3, v.keyH - 4); }
    if (w > 54 && v.keyH >= 20) { ctx.fillStyle = C('#111'); ctx.font = '9px system-ui'; ctx.textBaseline = 'middle'; ctx.fillText(pName(n.p), x + 3, y + v.keyH / 2 + 1); }
  }
  if (drag && drag.k === 'rect' && !drag.pending) { ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.strokeStyle = C('#fff'); ctx.lineWidth = 1; ctx.fillRect(drag.x, drag.y, drag.w, drag.h); ctx.strokeRect(drag.x, drag.y, drag.w, drag.h); }
  ctx.restore();
  // keys: white keys full width, black keys shorter, so the keyboard reads like a keyboard
  ctx.save(); ctx.beginPath(); ctx.rect(0, RULER, KEYS, gb - RULER); ctx.clip();
  ctx.fillStyle = C('#101011'); ctx.fillRect(0, RULER, KEYS, gb - RULER);
  const bw = Math.round(KEYS * 0.6);   // black key length
  for (let p = p0; p <= p1; p++) {
    const y = py(p) - v.keyH, pc = p % 12, blk = BLACK.has(pc), lit = previewHeld && previewHeld.p === p;
    ctx.fillStyle = lit && !blk ? C('#ffa722') : C('#dedee2'); ctx.fillRect(0, y, KEYS, v.keyH);   // white key (it also runs behind a black key)
    if (blk) {
      ctx.fillStyle = C('#a4a4ab'); ctx.fillRect(bw, Math.round(y + v.keyH / 2), KEYS - bw, 1);   // boundary of the two white keys this black key sits between
      ctx.fillStyle = lit ? C('#ffa722') : C('#1c1c1f'); ctx.fillRect(0, y + 1, bw, v.keyH - 2);
      if (!lit) { ctx.fillStyle = C('#3a3a40'); ctx.fillRect(bw - 2, y + 1, 2, v.keyH - 2); }
    } else if (pc === 0 || pc === 5) { ctx.fillStyle = C('#a4a4ab'); ctx.fillRect(0, y + v.keyH - 1, KEYS, 1); }   // B|C and E|F: no black key between
    if (isDrum() && padList().some((d) => d.pitch === p)) { ctx.fillStyle = blk && !lit ? C('#eee') : C('#111'); ctx.font = '600 9px system-ui'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(keyLabel(p), 3, y + v.keyH / 2, KEYS - 5); }
    else if (pc === 0 || (v.keyH >= 24 && !blk)) { ctx.fillStyle = C('#333'); ctx.font = '600 10px system-ui'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right'; ctx.fillText(pName(p), KEYS - 4, y + v.keyH / 2); ctx.textAlign = 'left'; }   // like Live: only the C keys are named (all white keys when zoomed in)
  }
  ctx.restore();
  // ruler
  ctx.fillStyle = C('#2a2a2d'); ctx.fillRect(0, 0, W, RULER); ctx.fillStyle = C('#9a9aa2'); ctx.font = '10px system-ui'; ctx.textBaseline = 'middle';
  barLinesLocal((q, b) => { if (px(q) >= KEYS - 1) ctx.fillText(String(b + 1), px(q) + 3, RULER / 2); });
  if (tsel) { ctx.fillStyle = C('#4fa3e0'); ctx.fillRect(px(tsel.a), 0, Math.max(2, px(tsel.b) - px(tsel.a)), RULER - 2); ctx.fillStyle = C('#fff'); ctx.font = '700 12px system-ui'; ctx.fillText('+', Math.min(W - 12, px(tsel.a) + 4), RULER / 2); }
  ctx.fillStyle = C('#2a2a2d'); ctx.fillRect(0, 0, KEYS, RULER);
  if (cfg.vel) drawVel(t, c, gb);
}

// bottom lane: Velocity / Pan tabs (FL Studio Mobile: "drag-up panel" with two tabs)
// ---- controller lanes (pitch bend, CC) of the clip: c.cc = [{ k: 'bend' | 'cc', n, pts: [{ t, v }] }]  (bend -1..1 = +-2 semitones, cc 0..127)
const CC_RES = 60;
const CC_LIST = [['bend', 0, 'Pitch Bend'], ['cc', 1, 'Mod Wheel (CC1) - hanya disimpan / ekspor'], ['cc', 7, 'Volume (CC7)'], ['cc', 10, 'Pan (CC10)'], ['cc', 11, 'Ekspresi (CC11)'], ['cc', 64, 'Sustain (CC64) - hanya disimpan / ekspor']];
const ccName = () => (cfg.cc.k === 'bend' ? 'Bend' : 'CC' + cfg.cc.n);
let ccLast = null;
const ccFind = (c, create) => { let l = (c.cc || []).find((q) => q.k === cfg.cc.k && q.n === cfg.cc.n); if (!l && create) { if (!c.cc) c.cc = []; l = { k: cfg.cc.k, n: cfg.cc.n, pts: [] }; c.cc.push(l); } return l; };
const ccSetPt = (l, t, v) => { const i = l.pts.findIndex((q) => q.t === t); if (i >= 0) l.pts[i].v = v; else { l.pts.push({ t, v }); l.pts.sort((a, b) => a.t - b.t); } };
function ccPaint(c, x, y) {
  const gb = gridBottom(), f = clamp(1 - (y - gb - 4) / (VEL - 8), 0, 1), bend = cfg.cc.k === 'bend';
  const val = bend ? (Math.abs(f * 2 - 1) < 0.05 ? 0 : Math.round((f * 2 - 1) * 100) / 100) : Math.round(f * 127);
  const t = clamp(Math.round(tk(x) / CC_RES) * CC_RES, 0, c.len), l = ccFind(c, !cfg.ccErase);
  if (!l) return false;
  if (cfg.ccErase) { l.pts = l.pts.filter((q) => Math.abs(q.t - t) > 90); if (!l.pts.length) { c.cc = c.cc.filter((z) => z !== l); if (!c.cc.length) delete c.cc; } return true; }
  const a = ccLast ? ccLast.t : t, v0 = ccLast ? ccLast.v : val, st = a <= t ? CC_RES : -CC_RES;
  for (let u = a; st > 0 ? u <= t : u >= t; u += st) { const vv = a === t ? val : v0 + (val - v0) * (u - a) / (t - a); ccSetPt(l, u, bend ? Math.round(vv * 100) / 100 : Math.round(vv)); }
  ccLast = { t, v: val };
  return true;
}
function ccMenu(x, y) {
  const has = (k, n) => (cur().clip.cc || []).some((l) => l.k === k && l.n === n && l.pts.length);
  menu([
    ...CC_LIST.map(([k, n, label]) => ({ label: label + (has(k, n) ? ' \u2022' : ''), check: cfg.cc.k === k && cfg.cc.n === n, fn: () => { cfg.cc = { k, n }; invalidate(); } })),
    { label: 'Nomor CC lain\u2026', fn: () => ask('Nomor CC (0-127)', cfg.cc.k === 'cc' ? cfg.cc.n : 74, (v) => { if (Number.isFinite(v) && v >= 0 && v <= 127) { cfg.cc = { k: 'cc', n: Math.round(v) }; invalidate(); } }, 'number') },
    { sep: true },
    { label: 'Mode hapus titik (seret di lane)', check: cfg.ccErase, fn: () => { cfg.ccErase = !cfg.ccErase; invalidate(); } },
    { label: 'Hapus seluruh lane ini', dim: !has(cfg.cc.k, cfg.cc.n), fn: () => { checkpoint(); const c = cur().clip; c.cc = (c.cc || []).filter((l) => !(l.k === cfg.cc.k && l.n === cfg.cc.n)); if (!c.cc.length) delete c.cc; changed(); } },
  ], x, y);
}
function drawCC(t, c, gb) {
  ctx.save(); ctx.beginPath(); ctx.rect(KEYS, gb, W - KEYS, VEL); ctx.clip();
  const bend = cfg.cc.k === 'bend', top = gb + 4, hh = VEL - 8, yv = (v) => (bend ? top + (1 - (v + 1) / 2) * hh : top + (1 - v / 127) * hh);
  ctx.fillStyle = C('#3a3a3f'); ctx.fillRect(KEYS, Math.round(bend ? gb + VEL / 2 : gb + VEL - 4), W - KEYS, 1);
  const l = (c.cc || []).find((q) => q.k === cfg.cc.k && q.n === cfg.cc.n);
  if (!l || !l.pts.length) { ctx.fillStyle = C('#6c6c73'); ctx.font = '10px system-ui'; ctx.textBaseline = 'middle'; ctx.fillText('Ketuk atau seret untuk menggambar ' + ccName() + (cfg.ccErase ? ' (mode hapus)' : ''), KEYS + 8, gb + VEL / 2); ctx.restore(); return; }
  ctx.strokeStyle = t.color; ctx.fillStyle = t.color; ctx.lineWidth = 1.5; ctx.beginPath();
  let first = true; for (const q of l.pts) { const x = px(q.t); if (first) { ctx.moveTo(x, yv(q.v)); first = false; } else ctx.lineTo(x, yv(q.v)); }
  ctx.stroke();
  for (const q of l.pts) { const x = px(q.t); if (x < KEYS - 3 || x > W + 3) continue; ctx.fillRect(x - 1.5, yv(q.v) - 1.5, 3, 3); }
  ctx.restore();
}
function drawVel(t, c, gb) {
  ctx.fillStyle = C('#202022'); ctx.fillRect(0, gb, W, VEL); ctx.fillStyle = C('#0e0e0f'); ctx.fillRect(0, gb, W, 1);
  const rh3 = (VEL - 1) / 3;
  for (const [k, label, row] of [['vel', 'Vel', 0], ['pan', 'Pan', 1], ['cc', ccName(), 2]]) {
    const on = cfg.lane === k, y = gb + 1 + row * rh3;
    ctx.fillStyle = on ? C('#ffa722') : C('#2d2d30'); ctx.fillRect(2, y + 1, KEYS - 4, rh3 - 2);
    ctx.fillStyle = on ? C('#111') : C('#8b8b92'); ctx.font = '600 9px system-ui'; ctx.textBaseline = 'middle'; ctx.fillText(label, 6, y + rh3 / 2);
  }
  if (cfg.lane === 'cc') { drawCC(t, c, gb); return; }
  ctx.save(); ctx.beginPath(); ctx.rect(KEYS, gb, W - KEYS, VEL); ctx.clip();
  const isPan = cfg.lane === 'pan', cy = gb + VEL / 2, half = (VEL - 8) / 2;
  if (isPan) { ctx.fillStyle = C('#3a3a3f'); ctx.fillRect(KEYS, Math.round(cy), W - KEYS, 1); }
  for (const n of c.notes) {
    const x = px(n.t); if (x < KEYS - 4 || x > W) continue;
    ctx.fillStyle = sel.has(n) ? C('#fff') : t.color;
    if (isPan) { const yy = cy + pan0(n) * half; ctx.fillRect(x, Math.min(cy, yy), 4, Math.max(2, Math.abs(yy - cy))); ctx.fillRect(x - 2, yy - 2, 8, 4); }
    else { const y0 = gb + VEL - 3 - n.v * (VEL - 8); ctx.fillRect(x + 1, y0, 2, gb + VEL - 3 - y0 + 1); ctx.fillRect(x - 1, y0 - 1, 6, 4); }
  }
  ctx.restore();
}

function drawSteps(t, c) {
  ctx.fillStyle = C('#1b1b1c'); ctx.fillRect(0, 0, W, H);
  const PD = padList(), steps = Math.ceil(c.len / STEP), n = PD.length, SPBT = Math.max(1, Math.round(P.beatLenAt(c.start) / STEP)), SPB = Math.max(1, Math.round(P.barLenAt(c.start) / STEP));   // steps per beat / per bar follow the time signature
  const hdr = 18, LH = stepLaneH(), GB = H - LH;
  ctx.save(); ctx.beginPath(); ctx.rect(LANE_HEAD, hdr, W - LANE_HEAD, GB - hdr); ctx.clip();
  const byRow = PD.map((d) => c.notes.filter((x) => x.p === d.pitch));
  for (let r = 0; r < n; r++) {
    const y = hdr + r * sv.rowH - sv.y0;
    if (y > GB || y + sv.rowH < hdr) continue;
    for (let s = Math.max(0, Math.floor((-LANE_HEAD + sv.x0) / sv.stepW)); s < steps; s++) {
      const x = LANE_HEAD + s * sv.stepW - sv.x0;
      if (x > W) break; if (x + sv.stepW < LANE_HEAD) continue;
      const hit = byRow[r].find((q) => Math.abs(q.t - s * STEP) < STEP / 2);
      ctx.fillStyle = hit ? t.color : (Math.floor(s / SPBT) % 2 ? C('#2b2b2f') : C('#232326'));
      ctx.fillRect(x + 1, y + 1, sv.stepW - 2, sv.rowH - 2);
      if (hit) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x + 1, y + 1, sv.stepW - 2, (1 - hit.v) * (sv.rowH - 2)); }
    }
  }
  ctx.fillStyle = C('#46464d');                       // v71: bar boundaries, so long patterns read in bars like FL Studio's step sequencer
  for (let s = SPB; s < steps; s += SPB) { const x = Math.round(LANE_HEAD + s * sv.stepW - sv.x0) - 1; if (x > LANE_HEAD && x < W) ctx.fillRect(x, hdr, 2, Math.min(GB, hdr + n * sv.rowH - sv.y0) - hdr); }
  ctx.restore();
  ctx.fillStyle = C('#242426'); ctx.fillRect(0, 0, W, hdr);
  ctx.fillStyle = C('#9a9aa2'); ctx.font = '10px system-ui'; ctx.textBaseline = 'middle';
  for (let s = 0; s < steps; s += SPBT) { const x = LANE_HEAD + s * sv.stepW - sv.x0; if (x > LANE_HEAD - 10 && x < W) ctx.fillText(s % SPB === 0 ? 'Bar ' + (s / SPB + 1) : String(Math.round(s % SPB / SPBT) + 1), x + 3, hdr / 2); }
  ctx.save(); ctx.beginPath(); ctx.rect(0, hdr, LANE_HEAD, GB - hdr); ctx.clip();
  for (let r = 0; r < n; r++) {
    const y = hdr + r * sv.rowH - sv.y0;
    ctx.fillStyle = r === padSel ? C('#3a3a40') : C('#2d2d30'); ctx.fillRect(0, y, LANE_HEAD - 1, sv.rowH - 1);
    ctx.fillStyle = t.color; ctx.fillRect(0, y, r === padSel ? 7 : 4, sv.rowH - 1);
    const dim = PD[r].mute;
    ctx.fillStyle = dim ? C('#6a6a72') : (r === padSel ? C('#ffa722') : C('#d6d6da')); ctx.font = '600 12px system-ui'; ctx.textBaseline = 'middle'; ctx.fillText(PD[r].name, 12, y + sv.rowH / 2, LANE_HEAD - 16);
  }
  ctx.restore();
  if (LH) {                                                                           // velocity lane of the selected pad (FL Studio Mobile graph editor)
    const r = laneRow(), pitch = PD[r] ? PD[r].pitch : -1, y0 = GB, inner = LH - 10;
    ctx.fillStyle = C('#161617'); ctx.fillRect(0, y0, W, LH); ctx.fillStyle = C('#0e0e0f'); ctx.fillRect(0, y0, W, 1);
    ctx.fillStyle = C('#2d2d30'); ctx.fillRect(0, y0 + 1, LANE_HEAD - 1, LH - 1);
    ctx.fillStyle = C('#8b8b92'); ctx.font = '600 10px system-ui'; ctx.textBaseline = 'top'; ctx.fillText('Velocity', 8, y0 + 6); ctx.fillStyle = C('#d6d6da'); ctx.font = '600 11px system-ui'; ctx.fillText(PD[r] ? PD[r].name : '', 8, y0 + 22, LANE_HEAD - 12);
    ctx.save(); ctx.beginPath(); ctx.rect(LANE_HEAD, y0 + 1, W - LANE_HEAD, LH - 1); ctx.clip();
    for (let s = 0; s < steps; s++) {
      const x = LANE_HEAD + s * sv.stepW - sv.x0; if (x > W) break; if (x + sv.stepW < LANE_HEAD) continue;
      const hit = byRow[r] ? byRow[r].find((q) => Math.abs(q.t - s * STEP) < STEP / 2) : null;
      ctx.fillStyle = Math.floor(s / SPBT) % 2 ? C('#1d1d20') : C('#19191b'); ctx.fillRect(x + 1, y0 + 4, sv.stepW - 2, inner + 2);
      if (hit) { const bh = Math.max(2, hit.v * inner), bw = Math.max(3, Math.min(10, sv.stepW * 0.35)); ctx.fillStyle = t.color; ctx.fillRect(Math.round(x + sv.stepW / 2 - bw / 2), y0 + 5 + inner - bh, bw, bh); ctx.fillRect(Math.round(x + sv.stepW / 2 - bw / 2) - 2, y0 + 5 + inner - bh, bw + 4, 2); }
    }
    ctx.restore();
  }
}

let ov, octx, headPx = -1e9, headDirty = true;
function headX(c, t, tick) {
  if (t.kind === 'drum' && stepsMode()) return LANE_HEAD + ((tick - c.clip.start) / STEP) * sv.stepW - sv.x0;
  return px(tick - c.clip.start);
}
function drawHeadEd(c, t, tick) {
  octx.setTransform(dpr, 0, 0, dpr, 0, 0); octx.clearRect(0, 0, W, H);
  if (tick < c.clip.start || tick > c.clip.start + c.clip.len) return;
  const x = Math.round(headX(c, t, tick)), steps = t.kind === 'drum' && stepsMode(), left = steps ? LANE_HEAD : KEYS, top = steps ? 18 : (t.kind === 'auto' ? AR : RULER), bottom = !steps && t.kind !== 'auto' ? gridBottom() : H;
  if (x < left || x > W) return;
  octx.fillStyle = steps ? 'rgba(255,167,34,.9)' : C('#ffa722'); octx.fillRect(x, top, 2, bottom - top);
}
export function frame() {
  if (!canvas || !canvas.isConnected || !W) return;
  const c = cur();
  if (!c) return;
  const t = state.tracks[c.track];
  if (t.kind === 'audio') { AE.frame(); return; }
  if (!c.clip.notes && t.kind !== 'auto') return;
  dims();
  if (state.playing && cfg.follow && !drag && !stepsMode() && t.kind !== 'auto' && W > KEYS + 40) {
    // continuous follow (same behaviour as the arrangement): the roll scrolls under the playhead one device pixel at a time
    const rel = P.currentTick() - c.clip.start, vis = (W - KEYS) / v.ppt, q = v.ppt * dpr;
    const maxX = Math.max(0, c.clip.len - vis + 24 / v.ppt);                  // never scroll past the end of the clip; a clip that fits the view does not scroll at all
    if (rel >= -1 && rel <= c.clip.len + 1 && maxX > 0) {
      let target = v.x0;
      if (rel < v.x0 || rel > v.x0 + vis) target = rel - vis * 0.1; else if (rel > v.x0 + vis * 0.45) target = rel - vis * 0.45;
      target = Math.min(maxX, Math.max(0, Math.round(target * q) / q));
      if (target > v.x0 || rel < v.x0 || rel > v.x0 + vis) { if (target !== v.x0) { v.x0 = target; dirty = true; } }
    }
  }
  if (dirty) {
    dirty = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (t.kind === 'auto') drawAuto(t, c.clip); else if (stepsMode()) drawSteps(t, c.clip); else drawRoll(t, c.clip);
    headDirty = true;
  }
  const tick = P.currentTick(), hxCss = headX(c, t, tick), hx = Math.round(hxCss * dpr);
  if (headDirty || hx !== headPx) { headPx = hx; headDirty = false; drawHeadEd(c, t, tick); }
}

// ------------------------------------------------------------------ note operations
const selNotes = () => [...sel];
let previewHeld = null;
function notePreview(p, vel = 0.8) {
  const c = cur(); if (!c) return;
  if (previewHeld) eng.preview(previewHeld.track, previewHeld.p, 0, false);   // release the previous preview first, otherwise its note-off is lost and it hangs
  eng.preview(c.track, p, vel, true);
  previewHeld = { track: c.track, p }; invalidate();
  clearTimeout(previewOff);
  previewOff = setTimeout(() => { eng.preview(c.track, p, 0, false); previewHeld = null; invalidate(); }, 220);
}
function changed() { const c = cur(); if (c) P.clipChanged(c.track); invalidate(); }

// pitch-class histogram -> best matching scales (FL Studio Mobile "Guess Scale?": the best three guesses, with an option to see more)
function guessScales(notes) {
  const hist = new Array(12).fill(0); let total = 0;
  for (const n of notes) { const w = Math.max(60, n.d) * (0.5 + n.v); hist[n.p % 12] += w; total += w; }
  if (!total) return [];
  const out = [];
  for (const [name, deg] of Object.entries(SCALES)) {
    if (!deg) continue;
    for (let key = 0; key < 12; key++) {
      let inside = 0; for (const d of deg) inside += hist[(key + d) % 12];
      out.push({ key, scale: name, score: inside / total + 0.12 * hist[key] / total - 0.01 * deg.length });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
function guessMenu(notes, x, y) {
  if (!notes.length) return toast('Pilih not dulu untuk menebak skala.');
  const all = guessScales(notes), pick = (g) => ({ label: NAMES[g.key] + ' ' + g.scale, check: cfg.key === g.key && cfg.scale === g.scale, fn: () => { cfg.key = g.key; cfg.scale = g.scale; toolbar(); invalidate(); } });
  menu([...all.slice(0, 3).map(pick), { label: 'Lihat lainnya\u2026', fn: () => menu(all.slice(3, 11).map(pick), x, y) }], x, y);
}

const growTo = (c, end) => { if (end > c.len) c.len = P.state.sigs.length ? Math.max(c.len, P.barCeil(c.start + end) - c.start) : Math.ceil(end / BAR) * BAR; };   // clip grows (whole bars) instead of silently dropping notes pushed past its end

function ops() {
  const c = cur().clip;
  return {
    copy: () => { clipboard = selNotes().map((n) => ({ ...n })); toast(clipboard.length + ' not disalin. Tekan lama di grid untuk paste.'); },
    del: () => { checkpoint(); c.notes = c.notes.filter((n) => !sel.has(n)); sel.clear(); changed(); },
    snap: () => { checkpoint(); for (const n of sel) { n.t = clamp(quantT(n.t), 0, c.len - 1); } changed(); },
    legato: () => { checkpoint(); const all = [...c.notes].sort((a, b) => a.t - b.t); for (const n of sel) { const nx = all.find((o) => o.t > n.t && o.p === n.p); n.d = nx ? nx.t - n.t : Math.max(n.d, c.len - n.t); } changed(); },
    humanize: () => { checkpoint(); for (const n of sel) { const e = n.t + n.d; n.t = clamp(Math.round(n.t + (Math.random() - 0.5) * 36), 0, c.len - 1); n.d = Math.max(30, Math.round(e + (Math.random() - 0.5) * 36) - n.t); } changed(); },
    shift: (d) => { checkpoint(); for (const n of sel) n.p = clamp(n.p + d, 0, 127); changed(); },
    double: (d) => { checkpoint(); const add = selNotes().map((n) => ({ ...n, p: clamp(n.p + d * 12, 0, 127) })); c.notes.push(...add); sel = new Set(add); changed(); },
    length: (d) => { checkpoint(); for (const n of sel) n.d = Math.min(d, c.len - n.t); cfg.lastLen = d; changed(); },
    scale: () => { checkpoint(); for (const n of sel) n.p = toScale(n.p); changed(); },
  };
}
function bump(o, x, y) {
  bar([{ label: '\u22121', keep: true, fn: () => o.shift(-1) }, { label: '+1', keep: true, fn: () => o.shift(1) }, { label: 'Selesai', fn: () => {} }], x, y);
}
function noteBar(n, x, y) {
  if (!sel.size) return;
  const o = ops(), r = canvas.getBoundingClientRect(), ax = r.left + x, ay = r.top + y;
  bar([
    { label: 'Copy', fn: o.copy }, { label: 'Del', fn: o.del }, { label: 'Snap', fn: o.snap },
    { label: 'More\u2026', keep: true, fn: () => menu([
      { label: 'Legato', fn: o.legato }, { label: 'Snap ke skala', fn: o.scale }, { label: 'Tebak skala?', fn: () => guessMenu(selNotes(), ax, ay) }, { label: 'Humanize', fn: o.humanize },
      { label: 'Double up (+1 oktaf)', fn: () => o.double(1) }, { label: 'Double down (\u22121 oktaf)', fn: () => o.double(-1) },
      { label: 'Panjang not\u2026', fn: () => menu([['1/16', 240], ['1/8', 480], ['1/4', 960], ['1/2', 1920], ['Whole', 3840]].map(([l, d]) => ({ label: l, fn: () => o.length(d) })), ax, ay) },
      { label: 'Transpose\u2026', fn: () => ask('Transpose (semitone)', 0, (q) => Number.isFinite(q) && o.shift(Math.round(q)), 'number') },
      { label: '+1 / \u22121 semitone', fn: () => bump(o, ax, ay) },
    ], ax, ay) },
  ], r.left + clamp(x - 90, 6, Math.max(6, W - 250)), r.top + Math.max(RULER, y - 46));
}

function timeMenu(x) {
  const c = cur().clip, a = tsel.a, b = tsel.b, len = b - a, r = canvas.getBoundingClientRect();
  const inRange = () => c.notes.filter((n) => n.t >= a && n.t < b);
  const ax = r.left + clamp(x, 6, W - 6), ay = r.top + RULER + 6;
  bar([
    { label: 'Select', fn: () => { sel = new Set(inRange()); tsel = null; invalidate(); if (sel.size) noteBar(null, clamp(x, 60, W - 60), RULER + 60); } },
    { label: 'Insert space', fn: () => { checkpoint(); for (const n of c.notes) if (n.t >= a) n.t += len; growTo(c, Math.max(0, ...c.notes.map((n) => n.t + n.d))); tsel = null; changed(); P.clipChanged(cur().track); } },
    { label: 'Duplicate', fn: () => { checkpoint(); const add = inRange().map((n) => ({ ...n })); for (const n of c.notes) if (n.t >= b) n.t += len; for (const n of add) { n.t += len; c.notes.push(n); } growTo(c, Math.max(b + len, ...c.notes.map((n) => n.t + n.d))); tsel = null; changed(); } },
    { label: 'Delete space', fn: () => { checkpoint(); c.notes = c.notes.filter((n) => !(n.t >= a && n.t < b)); for (const n of c.notes) if (n.t >= b) n.t -= len; tsel = null; sel.clear(); changed(); } },
    { label: 'More\u2026', keep: true, fn: () => menu([
      { label: 'Trim selection', fn: () => { checkpoint(); c.notes = c.notes.filter((n) => n.t >= a && n.t < b); for (const n of c.notes) n.t -= a; sel.clear(); tsel = null; changed(); } },
      { label: 'Tebak skala?', fn: () => guessMenu(inRange(), ax, ay) },
      { label: 'Snap ke skala', fn: () => { checkpoint(); for (const n of inRange()) n.p = toScale(n.p); changed(); } },
      { label: 'Deselect', fn: () => { tsel = null; invalidate(); } },
    ], ax, ay) },
  ], r.left + clamp(x - 120, 6, Math.max(6, W - 330)), r.top + RULER + 2);
}

// ------------------------------------------------------------------ gestures: piano roll
function hitRoll(x, y) {
  dims(); const c = cur().clip, gb = gridBottom();
  if (y < RULER) { if (tsel && x >= px(tsel.a) - 6 && x <= Math.max(px(tsel.b), px(tsel.a) + 24)) return { type: 'rsel', tick: tk(x) }; return { type: 'ruler', tick: tk(x) }; }
  if (cfg.vel && y >= gb) {
    if (x < KEYS) return { type: 'tab', lane: ['vel', 'pan', 'cc'][Math.min(2, Math.floor((y - gb) / (VEL / 3)))] };
    return { type: 'lane', x };
  }
  if (x < KEYS) { const p = clamp(pAt(y), 0, 127); notePreview(p); return { type: 'keys', p }; }
  const p = pAt(y), t = tk(x);
  for (let i = c.notes.length - 1; i >= 0; i--) {
    const n = c.notes[i];
    if (n.p === p && t >= n.t && t <= n.t + n.d + 6 / v.ppt) { const edge = px(n.t + n.d) - x < Math.min(16, Math.max(6, n.d * v.ppt * 0.4)); return { type: 'note', n, zone: edge ? 'right' : 'body' }; }
  }
  return { type: 'grid', t, p };
}

// Lane editing: dragging across the bars paints their velocity / pan; bars at the same time (a chord) move together.
function laneSet(c, x, y) {
  if (cfg.lane === 'cc') return ccPaint(c, x, y);
  const gb = gridBottom(); let d0 = 14;
  for (const n of c.notes) { const d = Math.abs(px(n.t) + 2 - x); if (d < d0) d0 = d; }
  if (d0 >= 14) return false;
  const val = cfg.lane === 'pan' ? clamp((y - gb - VEL / 2) / ((VEL - 8) / 2), -1, 1) : clamp(1 - (y - gb - 4) / (VEL - 8), 0.02, 1);
  for (const n of c.notes) if (Math.abs(px(n.t) + 2 - x) <= d0 + 2) { if (cfg.lane === 'pan') n.pan = Math.abs(val) < 0.06 ? 0 : val; else n.v = val; }
  return true;
}

function rollHandlers() {
  return {
    hit: (x, y) => (cur() ? hitRoll(x, y) : null),
    tap(x, y, t) {
      const c = cur().clip;
      if (t.type === 'note') { sel = new Set([t.n]); invalidate(); notePreview(t.n.p, t.n.v); noteBar(t.n, x, y); }
      else if (t.type === 'grid') {
        sel.clear();
        let p = clamp(t.p, 0, 127); if (cfg.lock) p = toScale(p);
        const at = clamp(floorT(t.t), 0, c.len - 1);
        checkpoint(); const n = { t: at, d: Math.min(cfg.lastLen, c.len - at), p, v: 0.8 }; c.notes.push(n); sel.add(n); notePreview(p); changed();
      } else if (t.type === 'tab') { if (t.lane === 'cc' && cfg.lane === 'cc') { const r = canvas.getBoundingClientRect(); ccMenu(r.left + x, r.top + y); } cfg.lane = t.lane; invalidate(); }
      else if (t.type === 'lane') { checkpoint(); if (laneSet(c, x, y)) changed(); ccLast = null; }
      else if (t.type === 'rsel') { if (tsel) timeMenu(x); }
      else if (t.type === 'ruler') { tsel = null; P.seekTo(Math.max(0, cur().clip.start + snapT(t.tick))); invalidate(); }
    },
    long(x, y, t) {
      if (t.type === 'note') {
        sel = new Set(sel.has(t.n) ? sel : [t.n]); invalidate();
        const r = canvas.getBoundingClientRect();
        menu([{ label: 'Hapus', fn: () => ops().del() }, { label: 'Copy', fn: () => ops().copy() }], r.left + x, r.top + y);
        return false;
      }
      if (t.type === 'grid') { drag = { k: 'rect', pending: true, x0: x, y0: y, x, y, w: 0, h: 0, at: t }; return true; }
      return false;
    },
    dragStart(x0, y0, t, fromLong) {
      if (fromLong) return true;
      const c = cur().clip;
      if (t.type === 'note') {
        if (!sel.has(t.n)) sel = new Set([t.n]);
        checkpoint();
        drag = { k: t.zone === 'right' ? 'resize' : 'move', lead: t.n, base: selNotes().map((n) => ({ n, t: n.t, p: n.p, d: n.d })), lastP: t.n.p };
        return true;
      }
      if (t.type === 'keys') { drag = { k: 'keys', p: t.p }; return true; }
      if (t.type === 'lane') { checkpoint(); drag = { k: 'lane' }; return true; }
      if (t.type === 'ruler' || t.type === 'rsel') { drag = { k: 'tsel', a: snapT(t.tick) }; tsel = { a: drag.a, b: drag.a }; return true; }
      return false;
    },
    drag(x, y, dx, dy) {
      const c = cur().clip;
      if (!drag) return;
      if (drag.k === 'rect') {
        drag.pending = drag.pending && Math.hypot(x - drag.x0, y - drag.y0) < 6;
        drag.x = Math.min(x, drag.x0); drag.y = Math.min(y, drag.y0); drag.w = Math.abs(x - drag.x0); drag.h = Math.abs(y - drag.y0);
        const t0 = tk(drag.x), t1 = tk(drag.x + drag.w), p1 = pAt(drag.y), p0 = pAt(drag.y + drag.h);
        sel = new Set(c.notes.filter((n) => n.t + n.d >= t0 && n.t <= t1 && n.p >= p0 && n.p <= p1));
      } else if (drag.k === 'move') {
        // snap the grabbed note, then move the whole selection by the same amount so relative timing survives
        const lead = drag.base.find((b) => b.n === drag.lead) || drag.base[0];
        let dt = snapT(lead.t + dx / v.ppt) - lead.t;
        let dp = -Math.round(dy / v.keyH);
        const minT = Math.min(...drag.base.map((b) => b.t)), maxT = Math.max(...drag.base.map((b) => b.t)), minP = Math.min(...drag.base.map((b) => b.p)), maxP = Math.max(...drag.base.map((b) => b.p));
        dt = clamp(dt, -minT, c.len - 1 - maxT); dp = clamp(dp, -minP, 127 - maxP);
        for (const b of drag.base) { b.n.t = b.t + dt; b.n.p = cfg.lock ? clamp(toScale(b.p + dp), 0, 127) : b.p + dp; }
        if (drag.lead.p !== drag.lastP) { drag.lastP = drag.lead.p; notePreview(drag.lead.p, drag.lead.v); }
        P.touchClips(cur().track); P.emit('notes');
      } else if (drag.k === 'resize') {
        const s = snapUnit() || 1, lead = drag.base.find((b) => b.n === drag.lead) || drag.base[0];
        const dd = Math.max(s, snapT(lead.t + lead.d + dx / v.ppt) - lead.t) - lead.d;
        for (const b of drag.base) { b.n.d = clamp(b.d + dd, Math.min(s, 30), Math.max(1, c.len - b.t)); }
        cfg.lastLen = drag.lead.d; P.touchClips(cur().track); P.emit('notes');
      } else if (drag.k === 'keys') {
        const p = clamp(pAt(y), 0, 127); if (p !== drag.p) { drag.p = p; notePreview(p); }
      } else if (drag.k === 'lane') {
        if (laneSet(c, x, y)) { P.touchClips(cur().track); P.emit('notes'); }
      } else if (drag.k === 'tsel') { const q = snapT(tk(x)); tsel = { a: Math.min(drag.a, q), b: Math.max(drag.a, q) }; }
      invalidate();
    },
    dragEnd(x, y) {
      if (drag && drag.k === 'rect' && drag.pending) {
        const r = canvas.getBoundingClientRect(), at = drag.at;
        menu([{ label: 'Paste di sini', dim: !clipboard, fn: () => pasteAt(at.t, at.p) }, { label: 'Pilih semua', fn: () => { sel = new Set(cur().clip.notes); invalidate(); } }], r.left + x, r.top + y);
      } else if (drag && drag.k === 'rect' && sel.size) noteBar(null, x, y);
      else if (drag && drag.k === 'tsel') { if (tsel && tsel.b - tsel.a < BEAT / 4) tsel = null; else timeMenu(x); }
      else if (drag && drag.k === 'keys') { eng.preview(cur().track, drag.p, 0, false); }
      drag = null; ccLast = null; invalidate();
    },
    pan(dx, dy) { v.x0 -= dx / v.ppt; v.top += dy / v.keyH; clampV(cur() && cur().clip); invalidate(); },
    pinch(cx, cy, sx, sy) {
      const t = tk(cx), p = (v.top - (cy - RULER) / v.keyH);
      v.ppt *= sx; v.keyH *= sy; v.x0 = t - (cx - KEYS) / v.ppt; v.top = p + (cy - RULER) / v.keyH; clampV(cur() && cur().clip); invalidate();
    },
    wheel(e) { if (e.ctrlKey) v.ppt *= Math.exp(-e.deltaY * 0.002); else if (e.shiftKey) v.x0 += e.deltaY / v.ppt; else v.top -= e.deltaY / v.keyH; clampV(cur() && cur().clip); invalidate(); },
  };
}

function pasteAt(t, p) {
  if (!clipboard || !clipboard.length) return toast('Belum ada not yang disalin.');
  const c = cur().clip, base = Math.min(...clipboard.map((n) => n.t)), pb = clipboard[0].p, at = clamp(floorT(t), 0, c.len - 1);
  checkpoint(); sel = new Set();
  for (const n of clipboard) { const q = { ...n, t: at + n.t - base, p: clamp(n.p + (p - pb), 0, 127) }; if (q.t < c.len) { c.notes.push(q); sel.add(q); } }
  changed();
}

// ------------------------------------------------------------------ gestures: step sequencer
function hitStep(x, y) {
  const c = cur().clip, hdr = 18;
  if (y < hdr) return { type: 'none' };
  const LH = stepLaneH();
  if (LH && y >= H - LH) { if (x < LANE_HEAD) return { type: 'none' }; return { type: 'vlane', s: Math.floor((x - LANE_HEAD + sv.x0) / sv.stepW) }; }
  if (y >= H - LH) return { type: 'none' };
  const r = Math.floor((y - hdr + sv.y0) / sv.rowH);
  const PD = padList();
  if (r < 0 || r >= PD.length) return { type: 'none' };
  if (x < LANE_HEAD) { notePreview(PD[r].pitch, 0.9); return { type: 'lane', r }; }
  const s = Math.floor((x - LANE_HEAD + sv.x0) / sv.stepW);
  if (s < 0 || s * STEP >= c.len) return { type: 'none' };
  const n = c.notes.find((q) => q.p === PD[r].pitch && Math.abs(q.t - s * STEP) < STEP / 2);
  return { type: 'cell', r, s, n };
}
function laneMenu(r, x, y) {
  const c = cur().clip, p = padList()[r].pitch, steps = Math.ceil(c.len / STEP), rect = canvas.getBoundingClientRect();
  const fill = (every) => { checkpoint(); c.notes = c.notes.filter((n) => n.p !== p); for (let s = 0; s < steps; s += every) c.notes.push({ t: s * STEP, d: 200, p, v: 0.85 }); changed(); };
  menu([
    { label: 'Isi tiap step', fn: () => fill(1) }, { label: 'Isi tiap 2 step', fn: () => fill(2) }, { label: 'Isi tiap 4 step', fn: () => fill(4) },
    { label: 'Kosongkan', fn: () => { checkpoint(); c.notes = c.notes.filter((n) => n.p !== p); changed(); } },
    { sep: true }, { label: 'Pengaturan pad\u2026', fn: () => openPad(r) },
  ], rect.left + x, rect.top + y);
}
function laneVel(x, y) {                           // set the velocity of the step under the finger in the lane (only steps that are on)
  const LH = stepLaneH(), c = cur().clip, p = padList()[laneRow()].pitch, s = Math.floor((x - LANE_HEAD + sv.x0) / sv.stepW);
  const n = c.notes.find((q) => q.p === p && Math.abs(q.t - s * STEP) < STEP / 2); if (!n) return;
  n.v = clamp(1 - (y - (H - LH) - 5) / (LH - 10), 0.05, 1); P.touchClips(cur().track); P.emit('notes'); invalidate();
}
function paintStep(r, s, add) {                     // set one cell of the step grid on / off (paint gesture)
  const c = cur().clip, p = padList()[r].pitch;
  if (s < 0 || s * STEP >= c.len) return;
  const n = c.notes.find((q) => q.p === p && Math.abs(q.t - s * STEP) < STEP / 2);
  if (add && !n) { c.notes.push({ t: s * STEP, d: 200, p, v: 0.85 }); notePreview(p, 0.6); }
  else if (!add && n) c.notes = c.notes.filter((q) => q !== n);
  else return;
  P.touchClips(cur().track); P.emit('notes'); invalidate();
}
function stepHandlers() {
  return {
    hit: (x, y) => (cur() ? hitStep(x, y) : null),
    tap(x, y, t) {
      if (t.type === 'vlane') { checkpoint(); laneVel(x, y); return; }
      if (t.type === 'lane') { openPad(t.r, true); return; }
      if (t.type !== 'cell') return;
      const c = cur().clip; checkpoint();
      if (t.n) c.notes = c.notes.filter((q) => q !== t.n);
      else { c.notes.push({ t: t.s * STEP, d: 200, p: padList()[t.r].pitch, v: 0.85 }); notePreview(padList()[t.r].pitch, 0.85); }
      changed();
    },
    long(x, y, t) {
      if (t.type === 'lane') { laneMenu(t.r, x, y); return false; }
      if (t.type !== 'cell') return false;
      checkpoint(); drag = { k: 'paint', r: t.r, add: !t.n, last: t.s }; paintStep(t.r, t.s, drag.add); return true;   // v71 (FL Studio Mobile): hold a step, then slide along the row to paint / erase
    },
    dragStart(x0, y0, t, fromLong) { if (t.type === 'vlane') { checkpoint(); drag = { k: 'vlane' }; laneVel(x0, y0); return true; } if (fromLong && drag && drag.k === 'paint') return true; if (t.type === 'cell' && t.n) { checkpoint(); drag = { k: 'svel', n: t.n, v0: t.n.v }; return true; } return false; },
    drag(x, y, dx, dy) {
      if (drag && drag.k === 'vlane') { laneVel(x, y); return; }
      if (drag && drag.k === 'paint') { const s = Math.floor((x - LANE_HEAD + sv.x0) / sv.stepW), d = s > drag.last ? 1 : -1; for (let k = drag.last; k !== s; k += d) paintStep(drag.r, k + d, drag.add); drag.last = s; return; }
      if (drag && drag.k === 'svel') { drag.n.v = clamp(drag.v0 - dy / sv.rowH, 0.05, 1); P.touchClips(cur().track); P.emit('notes'); invalidate(); } },
    dragEnd() { drag = null; invalidate(); },
    pan(dx, dy) { sv.x0 = Math.max(0, sv.x0 - dx); sv.y0 = clamp(sv.y0 - dy, 0, Math.max(0, padList().length * sv.rowH - (H - 18 - stepLaneH()))); invalidate(); },
    pinch(cx, cy, sx, sy) { svAuto = false; const s = (cx - LANE_HEAD + sv.x0) / sv.stepW; sv.stepW = clamp(sv.stepW * sx, 14, 80); sv.x0 = Math.max(0, s * sv.stepW - (cx - LANE_HEAD)); sv.rowH = clamp(sv.rowH * sy, 26, 70); invalidate(); },
  };
}


// ------------------------------------------------------------------ automation curve editor
const AR = 18, PT = 7;
const ay = (v) => AR + 8 + (1 - v) * (H - AR - 16);
const av = (y) => clamp(1 - (y - AR - 8) / (H - AR - 16), 0, 1);
function autoFmt(t, v) { const d = t.target.def; return fmtParam(d, valOf(d, v)); }

function drawAuto(t, c) {
  CS = c.start;
  ctx.fillStyle = C('#1b1b1c'); ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.beginPath(); ctx.rect(KEYS, AR, W - KEYS, H - AR); ctx.clip();
  for (const q of [0, 0.25, 0.5, 0.75, 1]) { ctx.fillStyle = q === 0.5 ? C('#38383d') : C('#2b2b2f'); ctx.fillRect(KEYS, ay(q), W - KEYS, 1); }
  const g = [120, 240, 480, 960, 1920, 3840].find((x) => x * v.ppt >= 12) || 3840;
  gridLocal(g, (q, kd) => { if (kd === 2) return; ctx.fillStyle = kd === 1 ? C('#38383d') : C('#2b2b2f'); ctx.fillRect(Math.round(px(q)), AR, 1, H - AR); });
  ctx.fillStyle = C('#4a4a50'); barLinesLocal((q) => ctx.fillRect(Math.round(px(q)), AR, 1, H - AR));
  ctx.fillStyle = 'rgba(0,0,0,.45)'; const ce = px(c.len); if (ce < W) ctx.fillRect(Math.max(KEYS, ce), AR, W - ce, H - AR);
  const pts = [...c.pts].sort((a, b) => a.t - b.t);
  ctx.strokeStyle = C('#8ea2c0'); ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(px(0), ay(pts[0].v));
  for (const p of pts) ctx.lineTo(px(p.t), ay(p.v));
  ctx.lineTo(px(c.len), ay(pts[pts.length - 1].v)); ctx.stroke();
  ctx.fillStyle = 'rgba(142,162,192,.16)'; ctx.lineTo(px(c.len), H); ctx.lineTo(px(0), H); ctx.closePath(); ctx.fill();
  for (const p of pts) {
    const on = p === asel;
    ctx.fillStyle = on ? C('#fff') : C('#ffa722'); ctx.beginPath(); ctx.arc(px(p.t), ay(p.v), on ? PT + 2 : PT, 0, 6.2832); ctx.fill();
  }
  const shown = asel || (drag && drag.k === 'apt' ? drag.p : null);
  if (shown) { ctx.fillStyle = C('#fff'); ctx.font = '600 12px system-ui'; ctx.textBaseline = 'middle'; const lx = Math.min(W - 70, px(shown.t) + 10); ctx.fillText(autoFmt(t, shown.v), lx, Math.max(AR + 12, ay(shown.v) - 14)); }
  ctx.restore();
  ctx.fillStyle = C('#242426'); ctx.fillRect(0, AR, KEYS, H - AR);
  ctx.fillStyle = C('#9a9aa2'); ctx.font = '10px system-ui'; ctx.textBaseline = 'middle';
  for (const q of [1, 0.5, 0]) ctx.fillText(autoFmt(t, q), 3, Math.max(AR + 7, Math.min(H - 7, ay(q))), KEYS - 5);
  ctx.fillStyle = C('#2a2a2d'); ctx.fillRect(0, 0, W, AR); ctx.fillStyle = C('#9a9aa2');
  barLinesLocal((q, b) => { if (px(q) >= KEYS - 1) ctx.fillText(String(b + 1), px(q) + 3, AR / 2); });
}

function autoHandlers() {
  const clipC = () => cur().clip;
  const find = (x, y) => clipC().pts.find((p) => Math.hypot(px(p.t) - x, ay(p.v) - y) <= PT + 9);
  return {
    hit: (x, y) => { if (y < AR) return { type: 'ruler', tick: tk(x) }; const p = find(x, y); return p ? { type: 'pt', p } : { type: 'plot', t: tk(x), v: av(y) }; },
    tap(x, y, t) {
      const c = clipC();
      if (t.type === 'pt') { asel = t.p; invalidate(); }
      else if (t.type === 'plot' && x > KEYS) {
        checkpoint();
        const p = { t: clamp(snapT(t.t), 0, c.len), v: t.v };
        c.pts.push(p); c.pts.sort((a, b) => a.t - b.t); asel = p; changed();
      } else if (t.type === 'ruler') P.seekTo(Math.max(0, c.start + snapT(t.tick)));
    },
    long(x, y, t) {
      if (t.type !== 'pt') return false;
      asel = t.p; invalidate();
      const r = canvas.getBoundingClientRect(), c = clipC();
      menu([{ label: 'Hapus titik', fn: () => { if (c.pts.length < 2) return toast('Klip otomasi butuh minimal dua titik.'); checkpoint(); c.pts = c.pts.filter((q) => q !== t.p); asel = null; changed(); } }], r.left + x, r.top + y);
      return false;
    },
    dragStart(x0, y0, t) { if (t.type === 'pt') { checkpoint(); asel = t.p; drag = { k: 'apt', p: t.p }; return true; } return false; },
    drag(x, y) {
      if (!drag || drag.k !== 'apt') return;
      drag.p.t = clamp(snapT(tk(x)), 0, clipC().len); drag.p.v = av(y);
      clipC().pts.sort((a, b) => a.t - b.t);
      P.touchClips(cur().track); P.emit('notes'); invalidate();
    },
    dragEnd() { drag = null; invalidate(); },
    pan(dx) { v.x0 -= dx / v.ppt; clampV(clipC()); invalidate(); },
    pinch(cx, cy, sx) { const t = tk(cx); v.ppt *= sx; v.x0 = t - (cx - KEYS) / v.ppt; clampV(clipC()); invalidate(); },
    wheel(e) { if (e.ctrlKey) v.ppt *= Math.exp(-e.deltaY * 0.002); else v.x0 += e.deltaY / v.ppt; clampV(clipC()); invalidate(); },
  };
}

// ------------------------------------------------------------------ chrome
// Snap: short tap switches the grid snap on/off, long-press opens the snap options (FL Studio Mobile behaviour).
function snapButton() {
  const el = h('button', { class: 'b' + (cfg.snapOn ? ' on' : '') }, snapLabel());
  let timer = 0, fired = false;
  const open = () => { fired = true; const r = el.getBoundingClientRect(); menu(SNAPS.map((s2, k) => ({ label: s2[0], check: cfg.snapOn && cfg.snap === k, fn: () => { cfg.snap = k; cfg.snapOn = true; toolbar(); } })), r.left, r.bottom + 2); };
  el.addEventListener('pointerdown', () => { fired = false; clearTimeout(timer); timer = setTimeout(open, 430); });
  el.addEventListener('pointerup', () => { clearTimeout(timer); if (!fired) { cfg.snapOn = !cfg.snapOn; toolbar(); } });
  el.addEventListener('pointercancel', () => clearTimeout(timer)); el.addEventListener('pointerleave', () => clearTimeout(timer));
  return el;
}

function fitView(c) {
  dims(); const gb = gridBottom(); let lo = 127, hi = 0;
  for (const n of c.notes) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
  if (hi < lo) { lo = hi = isDrum() ? 38 : 60; }
  const span = hi - lo + 1;
  v.keyH = clamp((gb - RULER) / Math.max(span + 3, 12), 10, 24);
  const rows = (gb - RULER) / v.keyH;
  v.top = (lo + hi) / 2 + rows / 2 + 0.5;
  v.ppt = clamp((W - KEYS - 6) / Math.max(c.len, 1), 0.02, 0.5); v.x0 = 0;
  clampV(c);
}

// ------------------------------------------------------------------ drum pad panel (gain / sample / envelope knobs of one pad)
function syncSide() {
  if (!side) return;
  const c = cur();
  if (c && padTrack !== c.track) padSel = -1;
  const ok = c && stepsMode() && padSel >= 0 && padSel < padList().length;
  if (!ok) { if (padSel >= 0 && !(c && stepsMode())) padSel = -1; side.hidden = true; side.replaceChildren(); return; }
  side.hidden = false;
  side.replaceChildren(DP.padPanel(c.track, padSel, { onClose: (removed) => { if (removed) padSel = Math.min(padSel, padList().length - 1); else padSel = -1; syncSide(); invalidate(); setTimeout(fit, 0); }, onChange: () => invalidate() }));
  setTimeout(fit, 0);
}
function openPad(r, toggle) {
  if (toggle && padSel === r && side && !side.hidden) { closePad(); return; }
  padSel = r; padTrack = cur() ? cur().track : -1; syncSide(); invalidate();
}
function closePad() { padSel = -1; syncSide(); invalidate(); }

function toolbar() {
  tools.replaceChildren();
  const c = cur(); if (!c) return;
  const t = state.tracks[c.track];
  const B = (label, fn, on) => h('button', { class: 'b' + (on ? ' on' : ''), onclick: fn }, label);
  const SEP = () => h('i', { class: 'ed-sep', 'aria-hidden': 'true' });   // v67: hairline between the toolbar groups (grid | view | clip)
  const at = (e) => { const r = e.currentTarget.getBoundingClientRect(); return [r.left, r.bottom + 2]; };
  if (t.kind === 'audio') return;
  if (t.kind === 'auto') {
    tools.append(
      snapButton(),
      B('Ratakan', () => { checkpoint(); const v0 = c.clip.pts.length ? c.clip.pts[0].v : 0.5; c.clip.pts = [{ t: 0, v: v0 }, { t: c.clip.len, v: v0 }]; asel = null; changed(); }),
      B('Panjang klip', (e) => menu([1, 2, 4, 8].map((b) => ({ label: b + ' bar', check: c.clip.len === clipBars(c.clip, b), fn: () => { checkpoint(); c.clip.len = clipBars(c.clip, b); c.clip.pts = c.clip.pts.filter((p) => p.t <= c.clip.len); if (!c.clip.pts.length) c.clip.pts = [{ t: 0, v: 0.5 }]; P.clipChanged(c.track); invalidate(); } })), ...at(e))),
    );
    return;
  }
  if (t.kind === 'drum') tools.append(B(stepsMode() ? 'Step' : 'Notes', () => { cfg.mode = stepsMode() ? 'notes' : 'steps'; sel.clear(); refresh(); }, true));
  if (t.kind === 'drum' && stepsMode()) tools.append(B('+ Sample', () => DP.addPad(c.track, (k) => { openPad(k); })), B('Pad', () => (padSel >= 0 ? closePad() : openPad(Math.max(0, Math.min(padSel, padList().length - 1))))));
  if (!stepsMode()) {
    tools.append(
      snapButton(),
      B(`${NAMES[cfg.key]} ${cfg.scale}`, (e) => menu([
        ...Object.keys(SCALES).map((s) => ({ label: s, check: cfg.scale === s, fn: () => { cfg.scale = s; toolbar(); invalidate(); } })), { sep: true },
        ...NAMES.map((n, k) => ({ label: 'Root ' + n, check: cfg.key === k, fn: () => { cfg.key = k; toolbar(); invalidate(); } })), { sep: true },
        { label: 'Kunci not ke skala', check: cfg.lock, fn: () => { cfg.lock = !cfg.lock; } },
      ], ...at(e))),
      B('Lane Vel/Pan/CC', () => { cfg.vel = !cfg.vel; clampV(cur().clip); invalidate(); toolbar(); }, cfg.vel),
      SEP(),
      B('Pilih semua', () => { sel = new Set(c.clip.notes); invalidate(); if (sel.size) noteBar(null, 80, RULER + 60); }),
      B('Fit', () => { fitView(c.clip); invalidate(); }),
      B('Ikuti', () => { cfg.follow = !cfg.follow; toolbar(); }, cfg.follow),
    );
  }
  tools.append(SEP(), B('Panjang klip', (e) => menu([1, 2, 4, 8].map((b) => ({ label: b + ' bar', check: c.clip.len === clipBars(c.clip, b), fn: () => { checkpoint(); c.clip.len = clipBars(c.clip, b); c.clip.notes && (c.clip.notes = c.clip.notes.filter((n) => n.t < c.clip.len)); P.clipChanged(c.track); invalidate(); } })), ...at(e))));
  const own = c.clip.swing != null && c.clip.swing >= 0, setSw = (v) => { checkpoint(); if (v == null) delete c.clip.swing; else c.clip.swing = v; P.clipChanged(c.track); toolbar(); };
  tools.append(B('Swing ' + Math.round(P.swingOf(c.clip) * 100) + '%' + (own ? '' : ' (global)'), (e) => menu([
    { label: 'Ikuti swing global (' + Math.round(state.groove.amt * 100) + '%)', check: !own, fn: () => setSw(null) },
    ...[0, 25, 50, 60, 75, 100].map((v) => ({ label: v + '%', check: own && Math.round(c.clip.swing * 100) === v, fn: () => setSw(v / 100) })),
    { label: 'Ketik\u2026', fn: () => ask('Swing klip (0-100%)', String(Math.round(P.swingOf(c.clip) * 100)), (v) => { if (Number.isFinite(v) && v >= 0 && v <= 100) setSw(v / 100); }, 'number') },
  ], ...at(e)), own));
  if (t.kind !== 'drum') {
    const xp = c.clip.xpose | 0, setX = (v) => { checkpoint(); P.setClipXpose(c.track, c.clip.id, v); toolbar(); invalidate(); };
    tools.append(B(`Transpose ${xp > 0 ? '+' : ''}${xp} st`, (e) => menu([
      ...[-24, -12, -7, -5, -2, -1, 0, 1, 2, 5, 7, 12, 24].map((v) => ({ label: (v > 0 ? '+' : '') + v + ' semitone', check: xp === v, fn: () => setX(v) })),
      { label: 'Ketik\u2026', fn: () => ask('Transpose klip (-48 sampai +48 semitone)', String(xp), (v) => { if (Number.isFinite(v) && v >= -48 && v <= 48) setX(v); else toast('Transpose harus -48 sampai +48.'); }, 'number') },
    ], ...at(e)), !!xp, 'dd'));
  }
  tools.append(
    SEP(),
    B('Ulangi isi', (e) => menu([2, 4, 8].map((n) => ({ label: `Ulangi ${n}x`, fn: () => { checkpoint(); const o = P.repeatClipContent(c.track, c.clip.id, n); if (o.error) toast(o.error); else { needFit = true; refresh(); } } })), ...at(e)), false, 'dd'),
    B('Panjang (beat)', () => ask('Panjang klip (beat)', String(Math.round(c.clip.len / BEAT * 100) / 100), (v) => { if (Number.isFinite(v) && v >= 0.25 && v <= 512) { checkpoint(); c.clip.len = Math.max(P.PPQ / 4, Math.round(v * BEAT)); c.clip.notes && (c.clip.notes = c.clip.notes.filter((n) => n.t < c.clip.len)); P.clipChanged(c.track); invalidate(); toolbar(); } else toast('Panjang harus 0,25 sampai 512 beat.'); }, 'number')),
    h('span', { class: 'ct-sig' }, 'Sign. ' + P.sigAtTick(c.clip.start).n + '/' + P.sigAtTick(c.clip.start).d),
  );
}

function showCanvas(on) { canvas.style.display = ov.style.display = on ? '' : 'none'; }

export function refresh() {
  if (!host) return;
  updateTitle();
  const c = cur();
  tsel = null; drag = null;
  if (c && c.clip.ll && c.clip.notes && host && host.isConnected) P.bakeLoop(c.clip, c.track);   // the piano roll edits real notes: a looped clip is unrolled when it is opened
  if (!c) { padSel = -1; syncSide(); showCanvas(false); tools.replaceChildren(); host.replaceChildren(h('div', { class: 'hint' }, 'Belum ada klip yang dipilih. Ketuk klip di arrangement, lalu ketuk dua kali untuk membuka editor.')); return; }
  const t = state.tracks[c.track];
  if (t.kind === 'audio') { padSel = -1; syncSide(); showCanvas(false); tools.replaceChildren(); AE.mount(host); return; }
  asel = null;
  host.replaceChildren(); showCanvas(true);
  if (fitId !== c.clip.id) { fitId = c.clip.id; needFit = true; }
  dims(); toolbar();
  sel = new Set([...sel].filter((n) => c.clip.notes.includes(n)));
  if (stepsMode()) { /* handlers read the mode on every event */ }
  syncSide();
  fit(); tryFit(); invalidate();
}

const stepLaneH = () => (H >= 150 ? 56 : 0);          // v72: FL Studio Mobile graph lane (velocity of the selected pad) under the grid when the panel is tall enough
const laneRow = () => Math.max(0, Math.min(padList().length - 1, padSel));
let svAuto = true;                                  // v71: the step grid follows the panel size until the user pinches it
function fitSteps(c, reset) {                              // FL Studio Mobile: the steps fill the width, the pad rows fill the height
  const steps = Math.max(1, Math.ceil(c.len / STEP)), SPB = Math.max(1, Math.round(P.barLenAt(c.start) / STEP)), n = Math.max(1, padList().length), room = W - LANE_HEAD - 2;
  let vis = steps; if (room / vis < 22) vis = Math.max(SPB, Math.floor(room / 22 / SPB) * SPB);   // too narrow for the whole clip: whole bars that stay tappable
  sv.stepW = clamp(room / vis, 14, 80); sv.rowH = clamp((H - 18 - stepLaneH()) / n, 26, 70);
  if (reset) { sv.x0 = 0; sv.y0 = 0; } else { sv.x0 = clamp(sv.x0, 0, Math.max(0, steps * sv.stepW - room)); sv.y0 = clamp(sv.y0, 0, Math.max(0, n * sv.rowH - (H - 18 - stepLaneH()))); }   // a refresh keeps where the user scrolled
}
function tryFit() {
  const c = cur(); if (!(W > 1 && H > 1 && c && c.clip.notes)) return;
  if (needFit) { fitView(c.clip); if (stepsMode()) { svAuto = true; fitSteps(c.clip, true); } needFit = false; dirty = true; }
  else if (svAuto && stepsMode()) { fitSteps(c.clip, false); dirty = true; }
}

function fit() {
  const r = canvas.parentElement.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  const nd = Math.min(window.devicePixelRatio || 1, 3), nw = Math.round(r.width), nh = Math.round(r.height);
  if (nw === W && nh === H && nd === dpr) return;
  dpr = nd; W = nw; H = nh; dims();
  for (const c of [canvas, ov]) { c.style.width = W + 'px'; c.style.height = H + 'px'; c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  tryFit();
  if (cur() && cur().clip.notes) clampV(cur().clip);
  dirty = true; frame();   // redraw in the same frame: no flicker while the panel is resized
}
export const fitNow = () => fit();

export function initEditor(container) {
  root = container;
  root.replaceChildren();
  tools = h('div', { class: 'ed-tools' });
  const stage = h('div', { class: 'ed-canvas' });
  host = h('div', { class: 'ed-host' });
  canvas = h('canvas', {}); ov = h('canvas', {});
  side = h('div', { class: 'ed-side' }); side.hidden = true;
  stage.append(canvas, ov, host);
  const body = h('div', { class: 'ed-body' }, stage, side);
  title = h('div', { class: 'clip-title' }); title.hidden = true;
  root.append(title, tools, body);
  ctx = canvas.getContext('2d', { alpha: false }); octx = ov.getContext('2d');
  window.addEventListener('themechange', invalidate); window.addEventListener('applayout', fit);
  const R = rollHandlers(), S = stepHandlers(), A = autoHandlers();
  const route = (name) => (...a) => { const cc = cur(); if (!cc) return undefined; if (cc.clip.ll && cc.clip.notes && P.loopOf(cc.clip) && name !== 'hit' && name !== 'pan' && name !== 'pinch' && name !== 'wheel') P.bakeLoop(cc.clip, cc.track); return (isAuto() ? A : stepsMode() ? S : R)[name]?.(...a); };
  attachGestures(ov, Object.fromEntries(['hit', 'tap', 'dtap', 'long', 'dragStart', 'drag', 'dragEnd', 'pan', 'pinch', 'wheel'].map((k) => [k, route(k)])));
  new ResizeObserver(fit).observe(stage);
  P.onChange((w) => { if (w === 'clips' || w === 'tracks') updateTitle(); if (w === 'notes' || w === 'clips' || w === 'tracks') invalidate(); if (w === 'devices' && stepsMode()) { toolbar(); invalidate(); } });
}

// Key / scale chips in the top bar read and set the piano roll's scale highlight.
export const KEY_NAMES = NAMES;
export const SCALE_NAMES = Object.keys(SCALES);
export const getTheory = () => ({ key: cfg.key, scale: cfg.scale });
export function setTheory(key, scale) { if (key !== undefined) cfg.key = key; if (scale !== undefined) cfg.scale = scale; invalidate(); }
