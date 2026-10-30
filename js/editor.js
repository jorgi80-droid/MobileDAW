// Clip editor: piano roll (MIDI), step sequencer (drum clips) and a small audio-clip panel.
// Gestures follow FL Studio Mobile: tap grid = add note, tap note = controls, long-press note = delete menu,
// long-press + drag on empty = rubber-band select, ruler drag = time selection, drag-up lane = velocity.
import { C, T } from './theme.js';
import { attachGestures } from './gesture.js';
import { bar, menu, ask, toast, h, clamp } from './ui.js';
import { checkpoint } from './history.js';
import * as AE from './audioedit.js';
import { eng } from './engine.js';
import { fmtParam, valOf } from './defs.js';
import * as DP from './drumpad.js';
import * as P from './project.js';
import * as TL from './timeline.js';
import { prefs } from './prefs.js';
const { state } = P;
import { BAR, BEAT } from './project.js';   // live bindings (they follow the time signature)

let KEYS = 36, VEL = 64;   // key strip width / lane height: set by dims() (narrow piano for MIDI notes, wider for drum names and automation values)
const RULER = 22, LANE_HEAD = 92, STEP = 240;
// Snap values exactly as FL Studio Mobile lists them: fractions of a step (1 step = 1/16 note), fractions of a beat, and a bar.
const sn = (n, f) => ({ 0: n, get 1() { return f(); } });   // read live: BAR / BEAT change with the time signature
const SNAPS = [sn('1/6 Step', () => STEP / 6), sn('1/4 Step', () => STEP / 4), sn('1/3 Step', () => STEP / 3), sn('1/2 Step', () => STEP / 2), sn('1 Step', () => STEP), sn('1/6 Beat', () => BEAT / 6), sn('1/4 Beat', () => BEAT / 4), sn('1/3 Beat', () => BEAT / 3), sn('1/2 Beat', () => BEAT / 2), sn('1 Beat', () => BEAT), sn('Bar', () => BAR)];
const SCALES = { Chromatic: null, Major: [0, 2, 4, 5, 7, 9, 11], Minor: [0, 2, 3, 5, 7, 8, 10], Dorian: [0, 2, 3, 5, 7, 9, 10], Phrygian: [0, 1, 3, 5, 7, 8, 10], Lydian: [0, 2, 4, 6, 7, 9, 11], Mixolydian: [0, 2, 4, 5, 7, 9, 10], 'Harmonic minor': [0, 2, 3, 5, 7, 8, 11], 'Pentatonic major': [0, 2, 4, 7, 9], 'Pentatonic minor': [0, 3, 5, 7, 10], Blues: [0, 3, 5, 6, 7, 10] };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);

const cfg = { snap: 6, snapOn: true, fold: false, key: 0, scale: 'Chromatic', lastScale: 'Major', lock: false, vel: true, velH: 0, lane: 'vel', cc: { k: 'bend', n: 0 }, ccErase: false, mode: 'auto', lastLen: STEP, follow: true };   // velH: lane height dragged by the user (0 = automatic)
const v = { x0: 0, ppt: 0.12, top: 84, keyH: 16 };
const sv = { x0: 0, stepW: 30, y0: 0, rowH: 38 };
let side = null, padSel = -1, padTrack = -1;   // drum pad panel (right of the step grid) and the pad it shows
let props = null, fitId = null, needFit = false, lastHx = 0, asel = null, root, tools, host, canvas, ctx, W = 0, H = 0, dpr = 1, dirty = true, sel = new Set(), tsel = null, clipboard = null, drag = null, previewOff = 0;

export const invalidate = () => { dirty = true; };
const cur = () => P.selectedClip();
const ink = (hex) => { const m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#141414'; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 140 ? '#141414' : '#f2f2f2'; };
const updateTitle = () => buildProps();   // the clip's name / activator live at the top of the properties panel
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
  VEL = cfg.velH ? clamp(cfg.velH, 40, Math.max(40, Math.round(H * 0.55))) : clamp(Math.round(H * 0.24), 44, 84);   // small panel: the lane shrinks so the note grid is not eaten by it
}

// ------------------------------------------------------------------ geometry
const px = (t) => KEYS + (t - v.x0) * v.ppt;
const tk = (x) => v.x0 + (x - KEYS) / v.ppt;
// Fold (Live): only the rows that hold notes are shown (every in-scale row when a scale is on, every pad row for a drum clip). Rows are then
// counted by index instead of pitch: rI(p) = row of a pitch, rP(i) = pitch of a row (-1 = an empty row past the last one).
let foldRows = null;
function computeFold(c) {
  const set = new Set(c.notes.map((n) => n.p));
  if (isDrum()) for (const d of padList()) set.add(d.pitch);
  else if (SCALES[cfg.scale]) for (let p = 0; p < 128; p++) if (inScale(p)) set.add(p);
  if (!set.size) set.add(60);
  return [...set].sort((a, b) => a - b);
}
const NROWS = () => (foldRows ? foldRows.length : 128);
function rI(p) { if (!foldRows) return p; let a = 0, b = foldRows.length; while (a < b) { const m = (a + b) >> 1; if (foldRows[m] < p) a = m + 1; else b = m; } return a; }
const rP = (i) => (!foldRows ? i : i >= 0 && i < foldRows.length ? foldRows[i] : -1);
const rowAtY = (y) => Math.floor(v.top - (y - RULER) / v.keyH);
const py = (p) => RULER + (v.top - rI(p)) * v.keyH;
const pAt = (y) => rP(rowAtY(y));
const gridBottom = () => H - (cfg.vel ? VEL : 0);
function clampV(c) {
  v.ppt = clamp(v.ppt, 0.02, 1.5); v.keyH = clamp(v.keyH, 8, 44);
  const rows = (gridBottom() - RULER) / v.keyH;
  const room = Math.max(1, W - KEYS) / v.ppt;                                       // never scroll before the clip start; to the right the editor stays open 8 bars past the clip end
  v.top = clamp(v.top, Math.min(rows - 1, NROWS()), NROWS()); v.x0 = clamp(v.x0, 0, Math.max(0, (c ? (c.pts ? c.len : c.len + 8 * BAR) : BAR) - room * (c && c.pts ? 0.5 : 0.85)));
}

// ------------------------------------------------------------------ drawing
// Live 12 note editor: white-key rows lighter than black-key rows, every other bar a shade darker, in-scale rows lit when a scale is
// on (the root a little warmer), notes in the clip colour shaded by velocity, the clip's extent as a brace in the ruler.
const FONT = (w, s) => `${w} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const velCache = new Map();
function velCol(hex, vel, selected) {            // note colour: low velocity = paler / greyer, high = the full clip colour (Live shades notes by velocity)
  const q = Math.round(clamp(vel, 0, 1) * 12), key = hex + q + (selected ? 's' : '');
  let r = velCache.get(key); if (r) return r;
  const n = parseInt(String(hex).slice(1, 7), 16), b = Number.isFinite(n) ? n : 0x8a8a8a, k = 0.3 + 0.7 * q / 12;
  let c = [b >> 16, (b >> 8) & 255, b & 255].map((x) => 118 + (x - 118) * k);
  if (selected) c = c.map((x) => x + (255 - x) * 0.4);
  r = `rgb(${c.map((x) => Math.round(x)).join(',')})`; velCache.set(key, r); return r;
}
const shadeC = (hex, k) => { const n = parseInt(String(hex).slice(1, 7), 16) || 0; return `rgb(${[n >> 16, (n >> 8) & 255, n & 255].map((x) => Math.round(x * (1 - k))).join(',')})`; };
const laneTop = () => gridBottom() + 9, laneH = () => VEL - 14;   // value area of the controller lane (below its split line)
function barSpans(fn) {                                        // fn(x0, x1, barIndexInClip) for every visible bar
  const L = []; barLinesLocal((q, b) => L.push([q, b]));
  for (let k = 0; k < L.length; k++) fn(px(L[k][0]), k + 1 < L.length ? px(L[k + 1][0]) : px(L[k][0] + BAR), L[k][1]);
}
function drawRoll(t, c) {
  CS = c.start; const gb = gridBottom();
  ctx.fillStyle = C('#1b1b1c'); ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.beginPath(); ctx.rect(KEYS, RULER, W - KEYS, gb - RULER); ctx.clip();
  if (!drag) foldRows = cfg.fold ? computeFold(c) : null;                       // a drag keeps the rows it started with
  const i0 = Math.max(0, rowAtY(gb)), i1 = Math.min(NROWS() - 1, rowAtY(RULER));
  const sc = SCALES[cfg.scale];
  for (let i = i0; i <= i1; i++) {
    const p = rP(i), y = py(p), blk = BLACK.has(p % 12), ins = !sc || inScale(p);
    ctx.fillStyle = sc ? (ins ? (blk ? C('#2c2c30') : C('#323236')) : C('#1f1f21')) : (blk ? C('#232325') : C('#2b2b2e'));
    ctx.fillRect(KEYS, y - v.keyH, W - KEYS, v.keyH);
    if (sc && ((p - cfg.key) % 12 + 12) % 12 === 0) { ctx.fillStyle = 'rgba(255,167,34,.10)'; ctx.fillRect(KEYS, y - v.keyH, W - KEYS, v.keyH); }   // root rows
    ctx.fillStyle = p % 12 === 0 ? C('#3c3c41') : C('#1f1f21'); ctx.fillRect(KEYS, y - 1, W - KEYS, 1);
  }
  ctx.fillStyle = document.documentElement.dataset.theme === 'light' ? 'rgba(0,0,0,.05)' : 'rgba(0,0,0,.13)'; barSpans((a, b, k) => { if (k % 2) ctx.fillRect(a, RULER, b - a, gb - RULER); });   // every other bar darker
  const g = [60, 120, 240, 480, 960, 1920, 3840].find((x) => x * v.ppt >= 12) || 3840;
  gridLocal(g, (q, kd) => { if (kd === 2) return; ctx.fillStyle = kd === 1 ? C('#3a3a3f') : C('#303034'); ctx.fillRect(Math.round(px(q)), RULER, 1, gb - RULER); });
  ctx.fillStyle = C('#4c4c52'); barLinesLocal((q) => ctx.fillRect(Math.round(px(q)), RULER, 1, gb - RULER));   // bar lines per bar (7/8, 5/4 ...)
  const ll = P.loopOf(c), ce = px(c.len);
  if (ll) {                                                                        // looped clip: the repeats after the loop source, drawn as ghosts that follow every edit
    const le = px(ll); if (le < W) { ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fillRect(Math.max(KEYS, le), RULER, Math.min(W, ce) - Math.max(KEYS, le), gb - RULER); }
    ctx.globalAlpha = 0.4;
    for (let o = ll; o < c.len && px(o) < W; o += ll) {
      if (px(o + ll) < KEYS) continue;
      for (const n of c.notes) {
        if (n.t >= ll) continue;
        const x = px(o + n.t), w = Math.max(3, Math.min(n.d, ll - n.t, c.len - o - n.t) * v.ppt), y = py(n.p) - v.keyH;
        if (x + w < KEYS || x > W || y > gb || y + v.keyH < RULER) continue;
        ctx.fillStyle = velCol(t.color, n.v, false); ctx.fillRect(x, y + 1, w - 1, v.keyH - 1);
      }
    }
    ctx.globalAlpha = 1; ctx.fillStyle = t.color;
    for (let o = ll; o < c.len; o += ll) { const x = Math.round(px(o)); if (x > W) break; if (x >= KEYS) ctx.fillRect(x, RULER, 1, gb - RULER); }   // loop restarts
  }
  ctx.fillStyle = 'rgba(0,0,0,.26)'; if (ce < W) ctx.fillRect(Math.max(KEYS, ce), RULER, W - ce, gb - RULER);   // past the clip end: still open, a note there makes the clip longer
  if (tsel) { ctx.fillStyle = 'rgba(120,182,230,.18)'; ctx.fillRect(px(tsel.a), RULER, px(tsel.b) - px(tsel.a), gb - RULER); }
  const nInk = ink(t.color) === '#141414' ? 'rgba(14,14,18,.82)' : 'rgba(255,255,255,.9)';
  ctx.font = FONT(600, 9); ctx.textBaseline = 'middle';
  for (const n of c.notes) {
    const x = px(n.t), w = Math.max(3, n.d * v.ppt), y = py(n.p) - v.keyH;
    if (x + w < KEYS || x > W || y > gb || y + v.keyH < RULER) continue;
    const s = sel.has(n);
    ctx.fillStyle = velCol(t.color, n.v, s); ctx.fillRect(x, y + 1, w - 1, v.keyH - 1);
    ctx.strokeStyle = s ? C('#ffffff') : shadeC(t.color, 0.6); ctx.lineWidth = s ? 1.5 : 1; ctx.strokeRect(x + 0.5, y + 1.5, w - 2, v.keyH - 2);   // flat note, hairline outline (Live: no bevel)
    if (w > 16 && (s || w > 30)) { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x + w - 5, y + 4, 2, Math.max(2, v.keyH - 7)); }   // right edge: resize grip, kept for touch
    if (w > 34 && v.keyH >= 13) { ctx.fillStyle = nInk; ctx.fillText(pName(n.p), x + 4, y + v.keyH / 2 + 1, w - 9); }
  }
  if (drag && drag.k === 'rect' && !drag.pending) { ctx.fillStyle = 'rgba(120,182,230,.14)'; ctx.strokeStyle = 'rgba(170,210,240,.9)'; ctx.lineWidth = 1; ctx.fillRect(drag.x, drag.y, drag.w, drag.h); ctx.strokeRect(drag.x + 0.5, drag.y + 0.5, drag.w, drag.h); }
  ctx.restore();
  // keys: white keys full width, black keys shorter, so the keyboard reads like a keyboard; only the C keys are named (all white keys when zoomed in)
  ctx.save(); ctx.beginPath(); ctx.rect(0, RULER, KEYS, gb - RULER); ctx.clip();
  ctx.fillStyle = C('#101011'); ctx.fillRect(0, RULER, KEYS, gb - RULER);
  const bw = Math.round(KEYS * 0.58);   // black key length
  for (let i = i0; i <= i1; i++) {
    const p = rP(i), y = py(p) - v.keyH, pc = p % 12, blk = BLACK.has(pc), lit = previewHeld && previewHeld.p === p;
    if (foldRows) {                                                              // folded: every row named, a strip in the key's colour (Live's folded key column)
      ctx.fillStyle = lit ? C('#ffa722') : blk ? T('--key-b') : T('--key-w'); ctx.fillRect(0, y, 7, v.keyH);
      ctx.fillStyle = C('#2c2c2f'); ctx.fillRect(7, y, KEYS - 8, v.keyH); ctx.fillStyle = C('#1f1f21'); ctx.fillRect(0, y + v.keyH - 1, KEYS, 1);
      ctx.fillStyle = lit ? C('#ffad32') : C('#d0d0d4'); ctx.font = FONT(600, 9); ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(keyLabel(p), 10, y + v.keyH / 2, KEYS - 12);
      continue;
    }
    ctx.fillStyle = lit && !blk ? C('#ffa722') : T('--key-w'); ctx.fillRect(0, y, KEYS - 1, v.keyH);   // white key (it also runs behind a black key); key colours are theme tokens
    if (blk) {
      ctx.fillStyle = C('#9c9ca3'); ctx.fillRect(bw, Math.round(y + v.keyH / 2), KEYS - bw, 1);   // boundary of the two white keys this black key sits between
      ctx.fillStyle = lit ? C('#ffa722') : T('--key-b'); ctx.fillRect(0, y + 1, bw, v.keyH - 2);
      if (!lit) { ctx.fillStyle = C('#3a3a40'); ctx.fillRect(bw - 2, y + 1, 2, v.keyH - 2); }
    } else if (pc === 0 || pc === 5) { ctx.fillStyle = C('#9c9ca3'); ctx.fillRect(0, y + v.keyH - 1, KEYS, 1); }   // B|C and E|F: no black key between
    if (isDrum() && padList().some((d) => d.pitch === p)) { ctx.fillStyle = blk && !lit ? '#eeeeee' : '#111111'; ctx.font = FONT(600, 9); ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(keyLabel(p), 3, y + v.keyH / 2, KEYS - 5); }
    else if (pc === 0 || (v.keyH >= 24 && !blk)) { ctx.fillStyle = T('--key-ink'); ctx.font = FONT(600, 9.5); ctx.textBaseline = 'middle'; ctx.textAlign = 'right'; ctx.fillText(pName(p), KEYS - 5, y + v.keyH / 2); ctx.textAlign = 'left'; }
  }
  ctx.fillStyle = C('#141415'); ctx.fillRect(KEYS - 1, RULER, 1, gb - RULER);
  ctx.restore();
  drawEdRuler(t, c);
  if (cfg.vel) drawVel(t, c, gb);
}
// ruler of the clip editor: bar numbers + beat ticks, the clip's extent as a brace in the clip colour, the time selection
function drawEdRuler(t, c) {
  ctx.fillStyle = C('#2c2c2f'); ctx.fillRect(0, 0, W, RULER); ctx.fillStyle = C('#141415'); ctx.fillRect(0, RULER - 1, W, 1);
  ctx.save(); ctx.beginPath(); ctx.rect(KEYS, 0, W - KEYS, RULER); ctx.clip();
  const L = contentEnd(c), a = Math.max(KEYS, px(0)), b = Math.min(W, px(L)), e = Math.min(W, px(c.len));
  if (b > a) { ctx.fillStyle = t.color; ctx.fillRect(a, RULER - 6, b - a, 4); ctx.fillStyle = shadeC(t.color, 0.45); ctx.fillRect(a, RULER - 2, b - a, 1); }   // the loop brace: the content (loop source)
  if (e > b && L < c.len) { ctx.globalAlpha = 0.4; ctx.fillStyle = t.color; ctx.fillRect(Math.max(KEYS, b), RULER - 5, e - Math.max(KEYS, b), 2); ctx.globalAlpha = 1; }   // the clip's repeats
  if (L < c.len && px(L) >= KEYS && px(L) <= W) { const x = Math.round(px(L)); ctx.fillStyle = t.color; ctx.beginPath(); ctx.moveTo(x - 5, RULER - 7); ctx.lineTo(x + 1, RULER - 7); ctx.lineTo(x + 1, RULER - 1); ctx.closePath(); ctx.fill(); }   // loop end marker
  ctx.fillStyle = C('#4a4a50'); gridLocal(BEAT, (q, kd) => { if (kd !== 2) ctx.fillRect(Math.round(px(q)), RULER - 9, 1, 3); });
  ctx.font = FONT(500, 10); ctx.textBaseline = 'middle';
  barLinesLocal((q, bi) => { const x = Math.round(px(q)); if (x < KEYS - 1) return; ctx.fillStyle = C('#6a6a70'); ctx.fillRect(x, 3, 1, RULER - 4); ctx.fillStyle = C('#b4b4ba'); ctx.fillText(String(bi + 1), x + 4, RULER / 2 - 2); });
  if (tsel) { ctx.fillStyle = 'rgba(120,182,230,.45)'; ctx.fillRect(px(tsel.a), 0, Math.max(2, px(tsel.b) - px(tsel.a)), RULER - 1); ctx.fillStyle = C('#fff'); ctx.font = FONT(700, 12); ctx.fillText('+', Math.min(W - 12, px(tsel.a) + 4), RULER / 2); }
  ctx.restore();
  ctx.fillStyle = C('#2c2c2f'); ctx.fillRect(0, 0, KEYS - 1, RULER - 1); ctx.fillStyle = C('#141415'); ctx.fillRect(KEYS - 1, 0, 1, RULER);
  if (!isDrum() && SCALES[cfg.scale]) { ctx.fillStyle = T('--lv-orink'); ctx.font = FONT(700, 9); ctx.textBaseline = 'middle'; ctx.fillText(NAMES[cfg.key] + ' ' + cfg.scale.slice(0, 3), 4, RULER / 2, KEYS - 7); }   // Live 12: the active scale in the editor corner
}

// bottom lane: Velocity / Pan / controller lanes, chosen with the lane header (Live: the chooser at the left of each MIDI editor lane)
// ---- controller lanes (pitch bend, CC) of the clip: c.cc = [{ k: 'bend' | 'cc', n, pts: [{ t, v }] }]  (bend -1..1 = +-2 semitones, cc 0..127)
const CC_RES = 60;
const CC_LIST = [['bend', 0, 'Pitch Bend'], ['cc', 1, 'Mod Wheel (CC1) - hanya disimpan / ekspor'], ['cc', 7, 'Volume (CC7)'], ['cc', 10, 'Pan (CC10)'], ['cc', 11, 'Ekspresi (CC11)'], ['cc', 64, 'Sustain (CC64) - hanya disimpan / ekspor']];
const ccName = () => (cfg.cc.k === 'bend' ? 'Bend' : 'CC' + cfg.cc.n);
let ccLast = null;
const ccFind = (c, create) => { let l = (c.cc || []).find((q) => q.k === cfg.cc.k && q.n === cfg.cc.n); if (!l && create) { if (!c.cc) c.cc = []; l = { k: cfg.cc.k, n: cfg.cc.n, pts: [] }; c.cc.push(l); } return l; };
const ccSetPt = (l, t, v) => { const i = l.pts.findIndex((q) => q.t === t); if (i >= 0) l.pts[i].v = v; else { l.pts.push({ t, v }); l.pts.sort((a, b) => a.t - b.t); } };
function ccPaint(c, x, y) {
  const f = clamp(1 - (y - laneTop()) / laneH(), 0, 1), bend = cfg.cc.k === 'bend';
  const val = bend ? (Math.abs(f * 2 - 1) < 0.05 ? 0 : Math.round((f * 2 - 1) * 100) / 100) : Math.round(f * 127);
  const t = clamp(Math.round(tk(x) / CC_RES) * CC_RES, 0, contentEnd(c)), l = ccFind(c, !cfg.ccErase);
  if (!l) return false;
  if (cfg.ccErase) { l.pts = l.pts.filter((q) => Math.abs(q.t - t) > 90); if (!l.pts.length) { c.cc = c.cc.filter((z) => z !== l); if (!c.cc.length) delete c.cc; } return true; }
  const a = ccLast ? ccLast.t : t, v0 = ccLast ? ccLast.v : val, st = a <= t ? CC_RES : -CC_RES;
  for (let u = a; st > 0 ? u <= t : u >= t; u += st) { const vv = a === t ? val : v0 + (val - v0) * (u - a) / (t - a); ccSetPt(l, u, bend ? Math.round(vv * 100) / 100 : Math.round(vv)); }
  ccLast = { t, v: val };
  return true;
}
function laneChooser(x, y) {
  const c = cur().clip, has = (k, n) => (c.cc || []).some((l) => l.k === k && l.n === n && l.pts.length);
  menu([
    { label: 'Velocity', check: cfg.lane === 'vel', fn: () => { cfg.lane = 'vel'; invalidate(); } },
    { label: 'Pan (per not)', check: cfg.lane === 'pan', fn: () => { cfg.lane = 'pan'; invalidate(); } },
    { sep: true },
    ...CC_LIST.map(([k, n, label]) => ({ label: label + (has(k, n) ? ' •' : ''), check: cfg.lane === 'cc' && cfg.cc.k === k && cfg.cc.n === n, fn: () => { cfg.cc = { k, n }; cfg.lane = 'cc'; invalidate(); } })),
    { label: 'Nomor CC lain…', fn: () => ask('Nomor CC (0-127)', cfg.cc.k === 'cc' ? cfg.cc.n : 74, (v) => { if (Number.isFinite(v) && v >= 0 && v <= 127) { cfg.cc = { k: 'cc', n: Math.round(v) }; cfg.lane = 'cc'; invalidate(); } }, 'number') },
    ...(cfg.lane === 'cc' ? [{ sep: true },
      { label: 'Mode hapus titik (seret di lane)', check: cfg.ccErase, fn: () => { cfg.ccErase = !cfg.ccErase; invalidate(); } },
      { label: 'Hapus seluruh lane ' + ccName(), dim: !has(cfg.cc.k, cfg.cc.n), fn: () => { checkpoint(); const cl = cur().clip; cl.cc = (cl.cc || []).filter((l) => !(l.k === cfg.cc.k && l.n === cfg.cc.n)); if (!cl.cc.length) delete cl.cc; changed(); } }] : []),
  ], x, y);
}
function drawCC(t, c, gb) {
  ctx.save(); ctx.beginPath(); ctx.rect(KEYS, gb + 2, W - KEYS, VEL - 2); ctx.clip();
  const bend = cfg.cc.k === 'bend', top = laneTop(), hh = laneH(), yv = (v) => (bend ? top + (1 - (v + 1) / 2) * hh : top + (1 - v / 127) * hh);
  ctx.fillStyle = C('#3a3a3f'); ctx.fillRect(KEYS, Math.round(bend ? top + hh / 2 : top + hh), W - KEYS, 1);
  const l = (c.cc || []).find((q) => q.k === cfg.cc.k && q.n === cfg.cc.n);
  if (!l || !l.pts.length) { ctx.fillStyle = C('#6c6c73'); ctx.font = FONT(500, 10); ctx.textBaseline = 'middle'; ctx.fillText('Ketuk atau seret untuk menggambar ' + ccName() + (cfg.ccErase ? ' (mode hapus)' : ''), KEYS + 8, top + hh / 2); ctx.restore(); return; }
  ctx.strokeStyle = t.color; ctx.lineWidth = 1.5; ctx.beginPath();
  let first = true; for (const q of l.pts) { const x = px(q.t); if (first) { ctx.moveTo(x, yv(q.v)); first = false; } else ctx.lineTo(x, yv(q.v)); }
  ctx.stroke();
  ctx.lineTo(px(l.pts[l.pts.length - 1].t), top + hh); ctx.lineTo(px(l.pts[0].t), top + hh); ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fill();
  ctx.fillStyle = t.color; for (const q of l.pts) { const x = px(q.t); if (x < KEYS - 3 || x > W + 3) continue; ctx.fillRect(x - 1.5, yv(q.v) - 1.5, 3, 3); }
  ctx.restore();
}
function drawVel(t, c, gb) {
  ctx.fillStyle = C('#222224'); ctx.fillRect(0, gb, W, VEL);
  ctx.fillStyle = C('#141415'); ctx.fillRect(0, gb, W, 1); ctx.fillStyle = C('#3a3a3f'); ctx.fillRect(0, gb + 1, W, 1);   // split line: drag it to resize the lane
  ctx.fillStyle = C('#5a5a60'); ctx.fillRect(Math.round(KEYS + (W - KEYS) / 2 - 14), gb + 3, 28, 2);                    // grip mark on the split line
  // lane header: lane name with a chooser arrow, the value of the selected note under it
  ctx.fillStyle = C('#2c2c2f'); ctx.fillRect(0, gb + 2, KEYS - 1, VEL - 2); ctx.fillStyle = C('#141415'); ctx.fillRect(KEYS - 1, gb + 2, 1, VEL - 2);
  const nm = cfg.lane === 'vel' ? 'Vel' : cfg.lane === 'pan' ? 'Pan' : ccName();
  ctx.fillStyle = C('#d0d0d4'); ctx.font = FONT(700, 10); ctx.textBaseline = 'middle'; ctx.fillText(nm, 5, gb + 13, KEYS - 16);
  ctx.fillStyle = C('#8b8b92'); ctx.beginPath(); ctx.moveTo(KEYS - 12, gb + 11); ctx.lineTo(KEYS - 5, gb + 11); ctx.lineTo(KEYS - 8.5, gb + 15); ctx.closePath(); ctx.fill();
  const lead = sel.size ? [...sel][0] : null;
  if (lead && cfg.lane !== 'cc' && VEL >= 44) { ctx.fillStyle = T('--lv-orink'); ctx.font = FONT(700, 11); ctx.fillText(cfg.lane === 'pan' ? (Math.abs(pan0(lead)) < 0.02 ? 'C' : Math.round(Math.abs(pan0(lead)) * 50) + (pan0(lead) < 0 ? 'L' : 'R')) : String(Math.round(lead.v * 127)), 5, gb + 30, KEYS - 8); }
  if (cfg.lane === 'cc') { drawCC(t, c, gb); return; }
  ctx.save(); ctx.beginPath(); ctx.rect(KEYS, gb + 2, W - KEYS, VEL - 2); ctx.clip();
  const isPan = cfg.lane === 'pan', top = laneTop(), hh = laneH(), cy = top + hh / 2, bottom = top + hh;
  for (const q of isPan ? [0.5] : [0, 0.25, 0.5, 0.75]) { ctx.fillStyle = q === 0.5 && isPan ? C('#3a3a3f') : C('#2b2b2e'); ctx.fillRect(KEYS, Math.round(top + q * hh), W - KEYS, 1); }
  ctx.fillStyle = C('#3a3a3f'); ctx.fillRect(KEYS, Math.round(bottom), W - KEYS, 1);
  ctx.fillStyle = 'rgba(0,0,0,.22)'; const ce = px(contentEnd(c)); if (ce < W) ctx.fillRect(Math.max(KEYS, ce), gb + 2, W - ce, VEL - 2);
  for (const pass of [0, 1]) {                                   // selected notes drawn last, on top
    for (const n of c.notes) {
      const s = sel.has(n); if ((pass === 1) !== s) continue;
      const x = Math.round(px(n.t)) + 0.5; if (x < KEYS - 4 || x > W + 4) continue;
      const col = s ? C('#ffffff') : velCol(t.color, isPan ? 1 : n.v, false);
      const y = isPan ? cy + pan0(n) * hh / 2 : top + (1 - n.v) * hh, from = isPan ? cy : bottom;
      ctx.fillStyle = col; ctx.fillRect(x - 0.75, Math.min(from, y), 1.5, Math.max(1, Math.abs(from - y)));          // stem
      ctx.beginPath(); ctx.arc(x, y, s ? 3.6 : 3, 0, 6.2832); ctx.fill();                                              // head
      if (!s) { ctx.strokeStyle = shadeC(t.color, 0.6); ctx.lineWidth = 1; ctx.stroke(); }
    }
  }
  ctx.restore();
}

function drawSteps(t, c) {
  ctx.fillStyle = C('#1b1b1c'); ctx.fillRect(0, 0, W, H);
  const PD = padList(), steps = Math.ceil(contentEnd(c) / STEP), n = PD.length, SPBT = Math.max(1, Math.round(P.beatLenAt(c.start) / STEP)), SPB = Math.max(1, Math.round(P.barLenAt(c.start) / STEP));   // steps per beat / per bar follow the time signature
  const shown = Math.max(steps + SPB, Math.ceil((sv.x0 + W - LANE_HEAD) / sv.stepW) + 1);   // the grid stays open to the right (FL Studio Mobile): a step past the end makes the pattern longer
  const hdr = 18, LH = stepLaneH(), GB = H - LH;
  ctx.save(); ctx.beginPath(); ctx.rect(LANE_HEAD, hdr, W - LANE_HEAD, GB - hdr); ctx.clip();
  const byRow = PD.map((d) => c.notes.filter((x) => x.p === d.pitch));
  for (let r = 0; r < n; r++) {
    const y = hdr + r * sv.rowH - sv.y0;
    if (y > GB || y + sv.rowH < hdr) continue;
    for (let s = Math.max(0, Math.floor(sv.x0 / sv.stepW)); s < shown; s++) {
      const x = LANE_HEAD + s * sv.stepW - sv.x0;
      if (x > W) break; if (x + sv.stepW < LANE_HEAD) continue;
      const hit = s < steps ? byRow[r].find((q) => Math.abs(q.t - s * STEP) < STEP / 2) : null, odd = Math.floor(s / SPBT) % 2;
      ctx.fillStyle = hit ? velCol(t.color, hit.v, false) : s < steps ? (odd ? C('#303034') : C('#28282b')) : (odd ? C('#252528') : C('#212123'));
      ctx.fillRect(x + 1, y + 1, sv.stepW - 2, sv.rowH - 2);
      if (hit) { ctx.strokeStyle = shadeC(t.color, 0.6); ctx.lineWidth = 1; ctx.strokeRect(x + 1.5, y + 1.5, sv.stepW - 3, sv.rowH - 3); }
    }
  }
  ctx.fillStyle = C('#46464d');                       // v71: bar boundaries, so long patterns read in bars like FL Studio's step sequencer
  for (let s = SPB; s < shown; s += SPB) { const x = Math.round(LANE_HEAD + s * sv.stepW - sv.x0) - 1; if (x > LANE_HEAD && x < W) ctx.fillRect(x, hdr, 2, Math.min(GB, hdr + n * sv.rowH - sv.y0) - hdr); }
  { const xe = Math.round(LANE_HEAD + steps * sv.stepW - sv.x0); if (xe > LANE_HEAD && xe < W) { ctx.fillStyle = t.color; ctx.fillRect(xe - 1, hdr, 2, Math.min(GB, hdr + n * sv.rowH - sv.y0) - hdr); } }   // end of the pattern
  ctx.restore();
  ctx.fillStyle = C('#2c2c2f'); ctx.fillRect(0, 0, W, hdr); ctx.fillStyle = C('#141415'); ctx.fillRect(0, hdr - 1, W, 1);
  ctx.save(); ctx.beginPath(); ctx.rect(LANE_HEAD, 0, W - LANE_HEAD, hdr); ctx.clip();
  { const a = LANE_HEAD - sv.x0, b = Math.min(W, LANE_HEAD + steps * sv.stepW - sv.x0); if (b > LANE_HEAD) { ctx.fillStyle = t.color; ctx.fillRect(Math.max(LANE_HEAD, a), hdr - 4, b - Math.max(LANE_HEAD, a), 3); } }   // pattern length brace
  ctx.textBaseline = 'middle';
  for (let s = 0; s < shown; s += SPBT) {                                      // bar numbers at bar starts, beat ticks between (FL Studio Mobile / Live)
    const x = Math.round(LANE_HEAD + s * sv.stepW - sv.x0); if (x < LANE_HEAD - 30 || x > W) continue;
    if (s % SPB === 0) { ctx.fillStyle = C('#6a6a70'); ctx.fillRect(x, 2, 1, hdr - 3); ctx.fillStyle = s < steps ? C('#d0d0d4') : C('#7a7a80'); ctx.font = FONT(700, 10); ctx.fillText(String(s / SPB + 1), x + 4, hdr / 2 - 1); }
    else { ctx.fillStyle = C('#4a4a50'); ctx.fillRect(x, hdr - 8, 1, 4); }
  }
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(0, hdr, LANE_HEAD, GB - hdr); ctx.clip();
  for (let r = 0; r < n; r++) {
    const y = hdr + r * sv.rowH - sv.y0;
    ctx.fillStyle = r === padSel ? C('#3c3c40') : C('#2c2c2f'); ctx.fillRect(0, y, LANE_HEAD - 1, sv.rowH - 1);
    ctx.fillStyle = t.color; ctx.fillRect(0, y, r === padSel ? 6 : 3, sv.rowH - 1);
    ctx.fillStyle = C('#141415'); ctx.fillRect(0, y + sv.rowH - 1, LANE_HEAD, 1);
    const dim = PD[r].mute;
    ctx.fillStyle = dim ? C('#6a6a72') : (r === padSel ? C('#ffad32') : C('#d6d6da')); ctx.font = FONT(600, 11.5); ctx.textBaseline = 'middle'; ctx.fillText(PD[r].name, 12, y + sv.rowH / 2, LANE_HEAD - 16);
  }
  ctx.restore();
  if (LH) {                                                                           // velocity lane of the selected pad (FL Studio Mobile graph editor)
    const r = laneRow(), pitch = PD[r] ? PD[r].pitch : -1, y0 = GB, inner = LH - 10;
    ctx.fillStyle = C('#161617'); ctx.fillRect(0, y0, W, LH); ctx.fillStyle = C('#0e0e0f'); ctx.fillRect(0, y0, W, 1);
    ctx.fillStyle = C('#2d2d30'); ctx.fillRect(0, y0 + 1, LANE_HEAD - 1, LH - 1);
    ctx.fillStyle = C('#8b8b92'); ctx.font = '600 10px system-ui'; ctx.textBaseline = 'top'; ctx.fillText('Velocity', 8, y0 + 6); ctx.fillStyle = C('#d6d6da'); ctx.font = '600 11px system-ui'; ctx.fillText(PD[r] ? PD[r].name : '', 8, y0 + 22, LANE_HEAD - 12);
    ctx.save(); ctx.beginPath(); ctx.rect(LANE_HEAD, y0 + 1, W - LANE_HEAD, LH - 1); ctx.clip();
    for (let s = Math.max(0, Math.floor(sv.x0 / sv.stepW)); s < shown; s++) {
      const x = LANE_HEAD + s * sv.stepW - sv.x0; if (x > W) break; if (x + sv.stepW < LANE_HEAD) continue;
      const hit = byRow[r] && s < steps ? byRow[r].find((q) => Math.abs(q.t - s * STEP) < STEP / 2) : null;
      ctx.fillStyle = Math.floor(s / SPBT) % 2 ? C('#1d1d20') : C('#19191b'); ctx.fillRect(x + 1, y0 + 4, sv.stepW - 2, inner + 2);
      if (hit) { const bh = Math.max(2, hit.v * inner), bw = Math.max(3, Math.min(10, sv.stepW * 0.35)); ctx.fillStyle = t.color; ctx.fillRect(Math.round(x + sv.stepW / 2 - bw / 2), y0 + 5 + inner - bh, bw, bh); ctx.fillRect(Math.round(x + sv.stepW / 2 - bw / 2) - 2, y0 + 5 + inner - bh, bw + 4, 2); }
    }
    ctx.restore();
  }
}

let ov, octx, headPx = -1e9, headDirty = true;
function headX(c, t, tick) {
  if (t.kind === 'drum' && stepsMode()) { let rel = tick - c.clip.start; const ll = P.loopOf(c.clip); if (ll && rel >= 0 && rel <= c.clip.len) rel %= ll; return LANE_HEAD + (rel / STEP) * sv.stepW - sv.x0; }   // a looped pattern: the playhead runs round the source steps
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
  const now = performance.now(), dt = clamp((now - (emo.last || now)) / 1000, 0.001, 0.05); emo.last = now;
  if (stepEd(c, dt)) dirty = true;
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
function grew(c, end) { if (!growTo(c, end)) return false; setTimeout(() => { P.emit('clips'); buildProps(); }, 0); return true; }   // after the edit's own changed(): arrangement + panel show the new length

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

// Pattern length (FL Studio Mobile): the editors are open to the right. A note placed, moved or stretched past the end makes the clip's content
// grow in whole bars instead of being squeezed against the end. A looped clip (dragged longer than its content in the arrangement) is edited as
// its loop source: every repeat follows the edit, and content growing past the loop length makes the loop longer (the clip grows when the loop
// reaches the clip's own length).
const MAX_BARS = 256;
const contentEnd = (c) => P.loopOf(c) || c.len;
// FL Studio Mobile: a pattern is 1, 2, 4, 8, 16 ... bars long. Content reaching into bar 9 makes the pattern 16 bars, so a clip dragged
// longer than its content loops every 16 bars (an 8-bar pattern loops every 8).
const wholeBars = (c, end) => { const b0 = P.barAt(c.start), nb = Math.max(1, P.barAt(c.start + Math.max(1, end) - 1) - b0 + 1); let k = 1; while (k < nb) k *= 2; return Math.max(P.beatLenAt(c.start), P.barStart(b0 + k) - c.start); };
const maxEnd = () => MAX_BARS * BAR;
function growTo(c, end) {
  const ll = P.loopOf(c), L = ll || c.len;
  if (!(end > L)) return false;
  const nl = Math.min(maxEnd(), wholeBars(c, end));
  if (ll) { if (nl >= c.len) { c.len = nl; delete c.ll; delete c.lp; } else c.ll = nl; } else c.len = nl;
  return true;
}
const notesEnd = (list) => { let e = 0; for (const n of list) if (n.t + n.d > e) e = n.t + n.d; return e; };

function ops() {
  const c = cur().clip;
  return {
    copy: () => { clipboard = selNotes().map((n) => ({ ...n })); toast(clipboard.length + ' not disalin. Tekan lama di grid untuk paste.'); },
    del: () => { checkpoint(); c.notes = c.notes.filter((n) => !sel.has(n)); sel.clear(); changed(); },
    snap: () => { checkpoint(); for (const n of sel) { n.t = Math.max(0, quantT(n.t)); } grew(c, notesEnd(sel)); changed(); },
    legato: () => { checkpoint(); const all = [...c.notes].sort((a, b) => a.t - b.t); for (const n of sel) { const nx = all.find((o) => o.t > n.t && o.p === n.p); n.d = nx ? nx.t - n.t : Math.max(n.d, contentEnd(c) - n.t); } changed(); },
    humanize: () => { checkpoint(); for (const n of sel) { const e = n.t + n.d; n.t = Math.max(0, Math.round(n.t + (Math.random() - 0.5) * 36)); n.d = Math.max(30, Math.round(e + (Math.random() - 0.5) * 36) - n.t); } grew(c, notesEnd(sel)); changed(); },
    shift: (d) => { checkpoint(); for (const n of sel) n.p = clamp(n.p + d, 0, 127); changed(); },
    double: (d) => { checkpoint(); const add = selNotes().map((n) => ({ ...n, p: clamp(n.p + d * 12, 0, 127) })); c.notes.push(...add); sel = new Set(add); changed(); },
    length: (d) => { checkpoint(); for (const n of sel) n.d = d; cfg.lastLen = d; grew(c, notesEnd(sel)); changed(); },
    scale: () => { checkpoint(); for (const n of sel) n.p = toScale(n.p); changed(); },
  };
}

// ---- MIDI Tools: Transform (Live 12). Every tool works on the picked notes, or on all notes of the clip when none are picked; one undo step each.
const TOOLS = ['Quantize', 'Humanize', 'Strum', 'Arpeggiate', 'Legato'];
const ARP = ['Up', 'Down', 'Up-Down', 'Converge'];
const tp = { amt: 100, hum: 30, strum: 40, rate: 240, style: 0 };   // Quantize amount %, Humanize amount %, Strum ticks per note (+ = low to high), Arp step / style
const chords = (list) => { const g = []; for (const n of [...list].sort((a, b) => a.t - b.t || a.p - b.p)) { const last = g[g.length - 1]; if (last && Math.abs(n.t - last[0].t) <= 12) last.push(n); else g.push([n]); } return g; };
function transform(tool) {
  const c = cur(); if (!c || !c.clip.notes) return;
  const cl = c.clip, list = sel.size ? selNotes() : [...cl.notes]; if (!list.length) return toast('Klip ini belum berisi not.');
  checkpoint();
  if (tool === 'Quantize') { const k = tp.amt / 100; for (const n of list) n.t = Math.max(0, Math.round(n.t + (quantT(n.t) - n.t) * k)); }
  else if (tool === 'Humanize') {
    const a = tp.hum / 100;
    for (const n of list) { const e = n.t + n.d; n.t = Math.max(0, Math.round(n.t + (Math.random() - 0.5) * 60 * a)); n.d = Math.max(30, Math.round(e + (Math.random() - 0.5) * 60 * a) - n.t); n.v = clamp((n.v ?? 0.8) + (Math.random() - 0.5) * 0.3 * a, 0.05, 1); }
  } else if (tool === 'Strum') {
    for (const ch of chords(list)) { const o = tp.strum >= 0 ? ch : [...ch].reverse(), st = Math.abs(tp.strum); o.forEach((n, k) => { const e = n.t + n.d, sh = Math.min(k * st, n.d - 30); n.t += Math.max(0, sh); n.d = e - n.t; }); }
  } else if (tool === 'Arpeggiate') {
    const out = [], drop = new Set();
    for (const ch of chords(list)) {
      if (ch.length < 2) continue;
      const ps = [...ch].sort((a, b) => a.p - b.p), t0 = ch[0].t, end = Math.max(...ch.map((n) => n.t + n.d)), seq = [];
      if (tp.style === 0) seq.push(...ps); else if (tp.style === 1) seq.push(...[...ps].reverse());
      else if (tp.style === 2) seq.push(...ps, ...[...ps].reverse().slice(1, -1));
      else { let a = 0, b = ps.length - 1; while (a <= b) { seq.push(ps[a++]); if (a <= b) seq.push(ps[b--]); } }
      for (let t = t0, k = 0; t < end; t += tp.rate, k++) { const src = seq[k % seq.length]; out.push({ ...src, t, d: Math.max(30, Math.min(tp.rate - 10, end - t)) }); }
      for (const n of ch) drop.add(n);
    }
    if (!out.length) { toast('Arpeggiate butuh akor (minimal 2 not yang mulai bersamaan).'); return; }
    cl.notes = cl.notes.filter((n) => !drop.has(n)).concat(out); sel = new Set(out);
  } else if (tool === 'Legato') {
    const all = [...cl.notes].sort((a, b) => a.t - b.t), starts = [...new Set(all.map((n) => n.t))];
    for (const n of list) { const nx = starts.find((t) => t > n.t + 1); n.d = nx ? nx - n.t : Math.max(n.d, contentEnd(cl) - n.t); }
  }
  grew(cl, notesEnd(new Set(cl.notes))); changed(); buildProps();
  toast(tool + ': ' + list.length + ' not' + (sel.size ? ' terpilih' : ''), 1200);
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
    { label: 'Insert space', fn: () => { checkpoint(); for (const n of c.notes) if (n.t >= a) n.t += len; grew(c, Math.max(0, ...c.notes.map((n) => n.t + n.d))); tsel = null; changed(); P.clipChanged(cur().track); } },
    { label: 'Duplicate', fn: () => { checkpoint(); const add = inRange().map((n) => ({ ...n })); for (const n of c.notes) if (n.t >= b) n.t += len; for (const n of add) { n.t += len; c.notes.push(n); } grew(c, Math.max(b + len, ...c.notes.map((n) => n.t + n.d))); tsel = null; changed(); } },
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
  if (cfg.vel && y >= gb - 4 && y <= gb + 5 && x >= KEYS) return { type: 'lsplit' };   // the split line above the lane: drag to resize it
  if (cfg.vel && y >= gb) {
    if (x < KEYS) return { type: 'lanehead' };
    return { type: 'lane', x };
  }
  if (foldRows && pAt(y) < 0) return { type: 'none' };
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
  let d0 = 14;
  for (const n of c.notes) { const d = Math.abs(px(n.t) - x); if (d < d0) d0 = d; }
  if (d0 >= 14) return false;
  const top = laneTop(), hh = laneH(), val = cfg.lane === 'pan' ? clamp((y - top - hh / 2) / (hh / 2), -1, 1) : clamp(1 - (y - top) / hh, 0.02, 1);
  for (const n of c.notes) if (Math.abs(px(n.t) - x) <= d0 + 2) { if (cfg.lane === 'pan') n.pan = Math.abs(val) < 0.06 ? 0 : val; else n.v = val; }
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
        const at = clamp(floorT(t.t), 0, maxEnd() - cfg.lastLen);
        checkpoint(); const n = { t: at, d: cfg.lastLen, p, v: 0.8 }; c.notes.push(n); sel.add(n); notePreview(p); grew(c, at + n.d); changed();
      } else if (t.type === 'lanehead') { const r = canvas.getBoundingClientRect(); laneChooser(r.left + x, r.top + y); }
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
      if (t.type === 'lsplit') { drag = { k: 'lsplit' }; return true; }
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
        const minT = Math.min(...drag.base.map((b) => b.t)), maxT = Math.max(...drag.base.map((b) => b.t)), minP = Math.min(...drag.base.map((b) => rI(b.p))), maxP = Math.max(...drag.base.map((b) => rI(b.p)));
        dt = clamp(dt, -minT, maxEnd() - BAR - maxT); dp = clamp(dp, -minP, NROWS() - 1 - maxP);   // rows: pitches, or folded rows
        for (const b of drag.base) { const np = foldRows ? rP(rI(b.p) + dp) : b.p + dp; b.n.t = b.t + dt; b.n.p = cfg.lock && !foldRows ? clamp(toScale(np), 0, 127) : np; }
        if (growTo(c, notesEnd(drag.base.map((b) => b.n)))) drag.grew = true;
        if (drag.lead.p !== drag.lastP) { drag.lastP = drag.lead.p; notePreview(drag.lead.p, drag.lead.v); }
        P.touchClips(cur().track); P.emit('notes');
      } else if (drag.k === 'resize') {
        const s = snapUnit() || 1, lead = drag.base.find((b) => b.n === drag.lead) || drag.base[0];
        const dd = Math.max(s, snapT(lead.t + lead.d + dx / v.ppt) - lead.t) - lead.d;
        for (const b of drag.base) { b.n.d = clamp(b.d + dd, Math.min(s, 30), Math.max(1, maxEnd() - b.t)); }
        if (growTo(c, notesEnd(drag.base.map((b) => b.n)))) drag.grew = true;
        cfg.lastLen = drag.lead.d; P.touchClips(cur().track); P.emit('notes');
      } else if (drag.k === 'keys') {
        const p = clamp(pAt(y), 0, 127); if (p !== drag.p) { drag.p = p; notePreview(p); }
      } else if (drag.k === 'lane') {
        if (laneSet(c, x, y)) { P.touchClips(cur().track); P.emit('notes'); }
      } else if (drag.k === 'tsel') { const q = snapT(tk(x)); tsel = { a: Math.min(drag.a, q), b: Math.max(drag.a, q) }; }
      else if (drag.k === 'lsplit') { cfg.velH = clamp(Math.round(H - y), 40, Math.round(H * 0.55)); dims(); clampV(c); }
      invalidate();
    },
    dragEnd(x, y) {
      if (drag && drag.k === 'rect' && drag.pending) {
        const r = canvas.getBoundingClientRect(), at = drag.at;
        menu([{ label: 'Paste di sini', dim: !clipboard, fn: () => pasteAt(at.t, at.p) }, { label: 'Pilih semua', fn: () => { sel = new Set(cur().clip.notes); invalidate(); } }], r.left + x, r.top + y);
      } else if (drag && drag.k === 'rect' && sel.size) noteBar(null, x, y);
      else if (drag && drag.k === 'tsel') { if (tsel && tsel.b - tsel.a < BEAT / 4) tsel = null; else timeMenu(x); }
      else if (drag && drag.k === 'keys') { eng.preview(cur().track, drag.p, 0, false); }
      if (drag && drag.grew) { P.emit('clips'); buildProps(); }       // the clip grew while notes were dragged past its end: arrangement + panel follow
      drag = null; ccLast = null; invalidate();
    },
    pan(dx, dy) { emo.t = null; v.x0 -= dx / v.ppt; v.top += dy / v.keyH; clampV(cur() && cur().clip); invalidate(); },
    panEnd(vx, vy) { fling(vx, vy); },
    pinch(cx, cy, sx, sy) {
      emo.t = null;
      const t = tk(cx), p = (v.top - (cy - RULER) / v.keyH);
      v.ppt *= sx; v.keyH *= sy; v.x0 = t - (cx - KEYS) / v.ppt; v.top = p + (cy - RULER) / v.keyH; clampV(cur() && cur().clip); invalidate();
    },
    wheel(e) { if (e.ctrlKey) v.ppt *= Math.exp(-e.deltaY * 0.002); else if (e.shiftKey) v.x0 += e.deltaY / v.ppt; else v.top -= e.deltaY / v.keyH; clampV(cur() && cur().clip); invalidate(); },
  };
}

function pasteAt(t, p) {
  if (!clipboard || !clipboard.length) return toast('Belum ada not yang disalin.');
  const c = cur().clip, base = Math.min(...clipboard.map((n) => n.t)), pb = clipboard[0].p, at = clamp(floorT(t), 0, maxEnd() - BAR);
  checkpoint(); sel = new Set();
  for (const n of clipboard) { const q = { ...n, t: at + n.t - base, p: clamp(n.p + (p - pb), 0, 127) }; c.notes.push(q); sel.add(q); }
  grew(c, notesEnd(sel)); changed();
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
  if (s < 0 || s * STEP >= maxEnd()) return { type: 'none' };
  const n = s * STEP < contentEnd(c) ? c.notes.find((q) => q.p === PD[r].pitch && Math.abs(q.t - s * STEP) < STEP / 2) : null;
  return { type: 'cell', r, s, n };
}
function laneMenu(r, x, y) {
  const c = cur().clip, p = padList()[r].pitch, steps = Math.ceil(contentEnd(c) / STEP), rect = canvas.getBoundingClientRect();
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
  if (s < 0 || s * STEP >= maxEnd()) return;
  const n = c.notes.find((q) => q.p === p && Math.abs(q.t - s * STEP) < STEP / 2);
  if (add && !n) { c.notes.push({ t: s * STEP, d: 200, p, v: 0.85 }); notePreview(p, 0.6); if (growTo(c, s * STEP + 200) && drag) drag.grew = true; }
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
      else { c.notes.push({ t: t.s * STEP, d: 200, p: padList()[t.r].pitch, v: 0.85 }); notePreview(padList()[t.r].pitch, 0.85); grew(c, t.s * STEP + 200); }
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
    dragEnd() { if (drag && drag.grew) { P.emit('clips'); buildProps(); } drag = null; invalidate(); },
    panEnd(vx, vy) { fling(vx, vy); },
    pan(dx, dy) { sv.x0 = sv.x0 - dx; sv.y0 = sv.y0 - dy; clampSteps(); invalidate(); },
    pinch(cx, cy, sx, sy) { svAuto = false; const s = (cx - LANE_HEAD + sv.x0) / sv.stepW; sv.stepW = clamp(sv.stepW * sx, 14, 80); sv.x0 = s * sv.stepW - (cx - LANE_HEAD); sv.rowH = sv.rowH * sy; clampSteps(); invalidate(); },
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
  ctx.strokeStyle = t.color; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(px(0), ay(pts[0].v));
  for (const p of pts) ctx.lineTo(px(p.t), ay(p.v));
  ctx.lineTo(px(c.len), ay(pts[pts.length - 1].v)); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.lineTo(px(c.len), H); ctx.lineTo(px(0), H); ctx.closePath(); ctx.fill();
  for (const p of pts) {
    const on = p === asel;
    ctx.beginPath(); ctx.arc(px(p.t), ay(p.v), on ? 6 : 4.5, 0, 6.2832); ctx.fillStyle = on ? C('#ffffff') : t.color; ctx.fill();
    ctx.strokeStyle = on ? t.color : shadeC(t.color, 0.6); ctx.lineWidth = on ? 2 : 1; ctx.stroke();
  }
  const shown = asel || (drag && drag.k === 'apt' ? drag.p : null);
  if (shown) { ctx.fillStyle = C('#fff'); ctx.font = '600 12px system-ui'; ctx.textBaseline = 'middle'; const lx = Math.min(W - 70, px(shown.t) + 10); ctx.fillText(autoFmt(t, shown.v), lx, Math.max(AR + 12, ay(shown.v) - 14)); }
  ctx.restore();
  ctx.fillStyle = C('#242426'); ctx.fillRect(0, AR, KEYS, H - AR);
  ctx.fillStyle = C('#9a9aa2'); ctx.font = '10px system-ui'; ctx.textBaseline = 'middle';
  for (const q of [1, 0.5, 0]) ctx.fillText(autoFmt(t, q), 3, Math.max(AR + 7, Math.min(H - 7, ay(q))), KEYS - 5);
  ctx.fillStyle = C('#2c2c2f'); ctx.fillRect(0, 0, W, AR); ctx.fillStyle = C('#141415'); ctx.fillRect(0, AR - 1, W, 1); ctx.fillStyle = C('#b4b4ba');
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
    pan(dx) { emo.t = null; v.x0 -= dx / v.ppt; clampV(clipC()); invalidate(); },
    panEnd(vx) { fling(vx, 0); },
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

// Fit: the view glides to the notes (zoom in log space) instead of jumping; a fling keeps scrolling with friction after a swipe.
const emo = { t: null, vx: 0, vy: 0, last: 0 };
const eease = (dt, r) => 1 - Math.exp(-dt * r / Math.max(0.3, prefs.animScale || 1));
function fitView(c, glide) {
  dims(); const gb = gridBottom(); let lo = 127, hi = 0;
  for (const n of c.notes) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
  if (hi < lo) { lo = hi = isDrum() ? 38 : 60; }
  foldRows = cfg.fold ? computeFold(c) : null;
  if (foldRows) { lo = 0; hi = foldRows.length - 1; }                             // folded: rows are indices, all of them on screen when they fit
  const span = hi - lo + 1, keyH = foldRows ? clamp((gb - RULER) / Math.max(span, 4), 12, 30) : clamp((gb - RULER) / Math.max(span + 3, 12), 10, 24), rows = (gb - RULER) / keyH;
  const T = { keyH, top: foldRows ? Math.min(span, (lo + hi) / 2 + rows / 2 + 0.5) : (lo + hi) / 2 + rows / 2 + 0.5, ppt: clamp((W - KEYS - 6) / Math.max(c.len + BAR, 1), 0.02, 0.5), x0: 0 };   // the clip plus one open bar after it
  const old = { ...v }; Object.assign(v, T); clampV(c); Object.assign(T, { keyH: v.keyH, top: v.top, ppt: v.ppt, x0: v.x0 });
  if (glide && !prefs.reduceMotion && W > 0) { Object.assign(v, old); emo.t = T; emo.vx = emo.vy = 0; invalidate(); }
}
function fling(vx, vy) {
  const cap = (q) => clamp(q, -4000, 4000);
  emo.vx = cap(vx); emo.vy = isAuto() ? 0 : cap(vy);
  if (Math.hypot(emo.vx, emo.vy) < 90 || prefs.reduceMotion) emo.vx = emo.vy = 0;
}
function stepEd(c, dt) {
  let moved = false;
  if (emo.t) {
    const k = eease(dt, 14), T = emo.t;
    v.ppt = Math.exp(Math.log(v.ppt) + (Math.log(T.ppt) - Math.log(v.ppt)) * k); v.x0 += (T.x0 - v.x0) * k; v.keyH += (T.keyH - v.keyH) * k; v.top += (T.top - v.top) * k;
    if (Math.abs(Math.log(T.ppt / v.ppt)) < 0.003 && Math.abs(T.x0 - v.x0) * v.ppt < 0.5 && Math.abs(T.keyH - v.keyH) < 0.05 && Math.abs(T.top - v.top) * v.keyH < 0.5) { Object.assign(v, T); emo.t = null; }
    moved = true;
  }
  if (emo.vx || emo.vy) {
    if (stepsMode()) {
      const wx = sv.x0 - emo.vx * dt, wy = sv.y0 - emo.vy * dt;
      sv.x0 = wx; sv.y0 = wy; clampSteps();
      if (Math.abs(sv.x0 - wx) > 1e-6) emo.vx = 0; if (Math.abs(sv.y0 - wy) > 1e-6) emo.vy = 0;
    } else {
      const wx = v.x0 - emo.vx * dt / v.ppt, wt = v.top + emo.vy * dt / v.keyH;
      v.x0 = wx; v.top = wt; clampV(c.clip);
      if (Math.abs(v.x0 - wx) > 1e-6) emo.vx = 0; if (Math.abs(v.top - wt) > 1e-6) emo.vy = 0;
    }
    const f = Math.exp(-dt * 3.4); emo.vx *= f; emo.vy *= f;
    if (Math.abs(emo.vx) < 10) emo.vx = 0; if (Math.abs(emo.vy) < 10) emo.vy = 0;
    moved = true;
  }
  return moved;
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

// ------------------------------------------------------------------ clip properties (Live 12 Clip View: the panel left of the editor)
// Clip box (activator + name on the clip colour, signature, position, length, groove), Notes box (transpose, x2 / :2, legato,
// quantize, humanize, repeat), Scale box (Live 12 scale mode: root + scale, lock to scale) and the drum / envelope boxes.
// Values are Live number boxes: drag up / down to change, tap for a list or to type a value.
const PANEL_KEY = 'mobiledaw.clipPanel';
let panelOpen = (() => { try { const x = localStorage.getItem(PANEL_KEY); return x === null ? null : x === '1'; } catch (_) { return null; } })();
const panelShown = () => (panelOpen === null ? !root || root.clientWidth >= 640 : panelOpen);   // automatic until the user opens / closes it
function setPanel(on) { panelOpen = on; try { localStorage.setItem(PANEL_KEY, on ? '1' : '0'); } catch (_) { /* storage unavailable */ } buildProps(); fit(); }
let numDrag = false;                                           // a number box is being dragged: the panel is not rebuilt under the finger
function numBox(o) {
  const el = h('button', { class: 'cp-num' }, o.fmt(o.get()));
  let id = null, y0 = 0, v0 = 0, moved = false;
  el.update = () => { el.textContent = o.fmt(o.get()); };
  el.addEventListener('pointerdown', (e) => { id = e.pointerId; try { el.setPointerCapture(id); } catch (_) { /* pointer gone */ } y0 = e.clientY; v0 = o.get(); moved = false; });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    if (!moved) { if (Math.abs(e.clientY - y0) < 5) return; moved = true; numDrag = true; el.classList.add('drag'); if (o.begin) o.begin(); }
    const nv = clamp(v0 + Math.round((y0 - e.clientY) / (o.px || 8)) * (o.step || 1), o.min, o.max);
    if (nv !== o.get()) o.set(nv);
    el.update();
  });
  const end = (e, cancel) => {
    if (e.pointerId !== id) return; id = null;
    if (moved) { numDrag = false; el.classList.remove('drag'); if (o.end) o.end(); buildProps(); }
    else if (!cancel && o.tap) { const r = el.getBoundingClientRect(); o.tap(r.left, r.bottom + 2); }
  };
  el.addEventListener('pointerup', (e) => end(e, false)); el.addEventListener('pointercancel', (e) => end(e, true));
  return el;
}
const posTxt = (tick) => { const b = P.barAt(tick), r = tick - P.barStart(b), bl = P.beatLenAt(tick); return `${b + 1}.${Math.floor(r / bl) + 1}.${Math.floor((r % bl) / (bl / 4)) + 1}`; };
const lenTxt = (len, at) => { const bl = P.barLenAt(at), bt = P.beatLenAt(at), bars = Math.floor(len / bl), r = len - bars * bl; return `${bars}.${Math.floor(r / bt)}.${Math.floor((r % bt) / (bt / 4))}`; };
function stretchNotes(k) {                                     // Live's x2 / :2: note positions (from the first selected note) and lengths
  const c = cur().clip, ns = [...sel]; if (!ns.length) return;
  checkpoint();
  const t0 = Math.min(...ns.map((n) => n.t));
  for (const n of ns) { n.t = Math.round(t0 + (n.t - t0) * k); n.d = Math.max(30, Math.round(n.d * k)); }
  grew(c, notesEnd(c.notes));
  changed();
}
function buildProps() {
  if (!props) return;
  if (numDrag) { for (const el of props.querySelectorAll('.cp-num')) el.update(); return; }
  const c = cur();
  if (!c) { props.hidden = true; props.replaceChildren(); return; }
  props.hidden = false;
  const t = state.tracks[c.track], cl = c.clip, on = !cl.muted, kind = t.kind, open = panelShown();
  const name = cl.name || (cl.dsample || cl.sample || {}).name || t.name;
  props.classList.toggle('min', !open);
  props.style.setProperty('--cc', t.color); props.style.setProperty('--ci', ink(t.color));
  if (!open) { props.replaceChildren(h('button', { class: 'cp-strip', 'aria-label': 'Tampilkan properti klip', onclick: () => setPanel(true) }, h('span', {}, name))); return; }
  const row = (label, ctl) => h('div', { class: 'cp-row' }, h('span', { class: 'cp-l' }, label), ctl);
  const sec = (title, ...kids) => h('section', { class: 'cp-sec' }, h('h5', {}, title), ...kids.filter(Boolean));
  const val = (txt) => h('span', { class: 'cp-val' }, txt);
  const ch = (txt, fn) => h('button', { class: 'cp-ch', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); fn(r.left, r.bottom + 2); } }, h('span', {}, txt), h('i', { class: 'tri', 'aria-hidden': 'true' }));
  const sw = (txt, onv, fn) => h('button', { class: 'cp-sw' + (onv ? ' on' : ''), onclick: fn }, txt);
  const btn = (txt, fn, cls) => h('button', { class: 'cp-b' + (cls ? ' ' + cls : ''), onclick: fn }, txt);
  const kids = [h('div', { class: 'cp-head' + (on ? '' : ' off') },
    h('button', { class: 'cp-act' + (on ? ' on' : ''), 'aria-label': on ? 'Matikan klip' : 'Aktifkan klip', onclick: () => { checkpoint(); P.setClipsMuted([{ i: c.track, c: cl }], on); buildProps(); invalidate(); } }),
    h('button', { class: 'cp-name', 'aria-label': 'Ganti nama klip', onclick: () => ask('Nama klip', name, (x) => { checkpoint(); cl.name = String(x || '').trim().slice(0, 40); P.emit('clips'); }) }, name),
    h('button', { class: 'cp-hide', 'aria-label': 'Sembunyikan panel properti', onclick: () => setPanel(false) }, '◂'))];
  // ---- Clip box
  const sg = P.sigAtTick(cl.start), lenMenu = (x, y) => menu([...[1, 2, 4, 8].map((b) => ({ label: b + ' bar', check: cl.len === clipBars(cl, b), fn: () => { checkpoint(); cl.len = clipBars(cl, b); trimToLen(cl); P.clipChanged(c.track); P.emit('clips'); } })),
    { label: 'Ketik panjang (beat)…', fn: () => ask('Panjang klip (beat)', String(Math.round(cl.len / BEAT * 100) / 100), (x2) => { if (Number.isFinite(x2) && x2 >= 0.25 && x2 <= 512) { checkpoint(); cl.len = Math.max(P.PPQ / 4, Math.round(x2 * BEAT)); trimToLen(cl); P.clipChanged(c.track); P.emit('clips'); } else toast('Panjang harus 0,25 sampai 512 beat.'); }, 'number') }], x, y);
  const editable = !!cl.notes || kind === 'auto';
  const lenBox = editable ? numBox({ get: () => Math.round(cl.len / BEAT), set: (b) => { cl.len = Math.max(BEAT, b * BEAT); P.clipChanged(c.track); }, fmt: () => lenTxt(cl.len, cl.start), min: 1, max: 512, px: 7, begin: () => checkpoint(), end: () => { trimToLen(cl); P.clipChanged(c.track); P.emit('clips'); }, tap: lenMenu }) : val(lenTxt(cl.len, cl.start));
  const own = cl.swing != null && cl.swing >= 0, setSw = (x) => { checkpoint(); if (x == null) delete cl.swing; else cl.swing = x; P.clipChanged(c.track); buildProps(); };
  const ll = cl.notes ? P.loopOf(cl) : 0;
  kids.push(sec('Clip',
    row('Signature', val(sg.n + ' / ' + sg.d)),
    row('Posisi', val(posTxt(cl.start))),
    row('Panjang', lenBox),
    ll ? row('Loop', val(lenTxt(ll, cl.start) + ' \u00D7' + (Math.round(cl.len / ll * 10) / 10))) : null,
    ll ? h('div', { class: 'cp-line' }, btn('Lepas loop', () => { checkpoint(); P.bakeLoop(cl, c.track); P.emit('clips'); refresh(); toast('Pengulangan jadi not biasa (bisa diedit satu per satu).', 2200); })) : null,
    cl.notes ? row('Groove', ch(Math.round(P.swingOf(cl) * 100) + '%' + (own ? '' : ' global'), (x, y) => menu([
      { label: 'Ikuti swing global (' + Math.round(state.groove.amt * 100) + '%)', check: !own, fn: () => setSw(null) },
      ...[0, 25, 50, 60, 75, 100].map((q) => ({ label: q + '%', check: own && Math.round(cl.swing * 100) === q, fn: () => setSw(q / 100) })),
      { label: 'Ketik…', fn: () => ask('Swing klip (0-100%)', String(Math.round(P.swingOf(cl) * 100)), (q) => { if (Number.isFinite(q) && q >= 0 && q <= 100) setSw(q / 100); }, 'number') },
    ], x, y))) : null));
  // ---- Notes box (MIDI / drum clips)
  if (cl.notes) {
    const all = (fn) => () => { const had = sel.size > 0; if (!had) sel = new Set(cur().clip.notes); if (sel.size) fn(); if (!had) sel.clear(); invalidate(); };
    const xp = cl.xpose | 0, fmtX = (q) => (q > 0 ? '+' : '') + q + ' st';
    kids.push(sec('Notes',
      kind !== 'drum' ? row('Transpose', numBox({ get: () => cl.xpose | 0, set: (q) => P.setClipXpose(c.track, cl.id, q), fmt: () => fmtX(cl.xpose | 0), min: -48, max: 48, px: 7, begin: () => checkpoint(),
        tap: (x, y) => menu([-24, -12, -7, -5, -2, -1, 0, 1, 2, 5, 7, 12, 24].map((q) => ({ label: fmtX(q), check: xp === q, fn: () => { checkpoint(); P.setClipXpose(c.track, cl.id, q); } })), x, y) })) : null,
      h('div', { class: 'cp-grid' },
        btn('×2', all(() => stretchNotes(2))), btn(':2', all(() => stretchNotes(0.5))), btn('Legato', all(() => ops().legato())),
        btn('Quantize', all(() => ops().snap())), btn('Humanize', all(() => ops().humanize())),
        btn('Ulangi…', (e) => { const r = e.currentTarget.getBoundingClientRect(); menu([2, 4, 8].map((n) => ({ label: `Ulangi isi ${n}x`, fn: () => { checkpoint(); const o = P.repeatClipContent(c.track, cl.id, n); if (o.error) toast(o.error); else { needFit = true; refresh(); } } })), r.left, r.bottom + 2); })),
      h('div', { class: 'cp-hint' }, 'Tanpa not terpilih: berlaku untuk semua not')));
  }
  // ---- MIDI Tools: Transform box
  if (cl.notes) {
    const tool = TOOLS.includes(cfg.tool) ? cfg.tool : 'Quantize', pick = (k) => { cfg.tool = k; buildProps(); };
    const par = tool === 'Quantize' ? row('Jumlah', numBox({ get: () => tp.amt, set: (q) => { tp.amt = q; }, fmt: () => tp.amt + ' %', min: 0, max: 100, step: 5, px: 5 }))
      : tool === 'Humanize' ? row('Jumlah', numBox({ get: () => tp.hum, set: (q) => { tp.hum = q; }, fmt: () => tp.hum + ' %', min: 0, max: 100, step: 5, px: 5 }))
      : tool === 'Strum' ? row('Strum', numBox({ get: () => tp.strum, set: (q) => { tp.strum = q; }, fmt: () => (tp.strum > 0 ? '↑ ' : tp.strum < 0 ? '↓ ' : '') + Math.round(Math.abs(tp.strum) / P.PPQ * 1000 * 60 / state.bpm) + ' ms', min: -240, max: 240, step: 10, px: 4 }))
      : tool === 'Arpeggiate' ? h('div', { class: 'cp-line' }, ch(ARP[tp.style], (x, y) => menu(ARP.map((a, k) => ({ label: a, check: tp.style === k, fn: () => { tp.style = k; buildProps(); } })), x, y)),
        ch(['1/32', '1/16', '1/8', '1/4'][[120, 240, 480, 960].indexOf(tp.rate)] || '1/16', (x, y) => menu([[120, '1/32'], [240, '1/16'], [480, '1/8'], [960, '1/4']].map(([r, l]) => ({ label: l, check: tp.rate === r, fn: () => { tp.rate = r; buildProps(); } })), x, y)))
      : h('div', { class: 'cp-hint' }, 'Setiap not disambung sampai not berikutnya.');
    kids.push(sec('Transform',
      row('Alat', ch(tool, (x, y) => menu(TOOLS.map((k) => ({ label: k, check: k === tool, fn: () => pick(k) })), x, y))),
      par,
      h('div', { class: 'cp-line' }, btn('Terapkan', () => transform(tool), 'go')),
      h('div', { class: 'cp-hint' }, sel.size ? sel.size + ' not terpilih' : 'Tanpa not terpilih: semua not')));
  }
  // ---- Envelopes box: the automation lanes that drive this clip's track, each with its curve over the clip's span
  if (kind !== 'auto') {
    const sid = P.stripOf(c.track), lanes = state.tracks.map((a, k) => [a, k]).filter(([a]) => a.kind === 'auto' && a.target && a.target.strip === sid);
    const spark = (a) => {
      const cv = h('canvas', { class: 'cp-env', width: 200, height: 36 }), g = cv.getContext('2d'), W2 = 200, H2 = 36, s0 = cl.start, span = Math.max(1, cl.len);
      g.fillStyle = T('--lv-well'); g.fillRect(0, 0, W2, H2);
      const valAt = (tt) => { for (const ac of a.clips) { if (tt < ac.start || tt > ac.start + ac.len || !ac.pts || !ac.pts.length) continue; const r = tt - ac.start, ps = ac.pts; if (r <= ps[0].t) return ps[0].v; for (let k = 1; k < ps.length; k++) if (r <= ps[k].t) { const p0 = ps[k - 1], p1 = ps[k]; return p0.v + (p1.v - p0.v) * ((r - p0.t) / Math.max(1, p1.t - p0.t)); } return ps[ps.length - 1].v; } return null; };
      g.strokeStyle = a.color || T('--accent'); g.lineWidth = 1.5; g.beginPath(); let pen = false;
      for (let x = 0; x <= W2; x += 2) { const v = valAt(s0 + span * x / W2); if (v == null) { pen = false; continue; } const y = 3 + (1 - v) * (H2 - 6); if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; } }
      g.stroke(); return cv;
    };
    const open = (k) => { const a = state.tracks[k], ac = a.clips.find((q) => q.start < cl.start + cl.len && q.start + q.len > cl.start) || a.clips[0]; P.selectTrack(k); if (ac) P.selectClip(k, ac.id); };
    kids.push(sec('Envelopes',
      ...(lanes.length ? lanes.map(([a, k]) => h('div', { class: 'cp-envrow' }, h('div', { class: 'cp-row' }, h('span', { class: 'cp-l' }, (String(a.name || '').includes('\u2022') ? a.name.split('\u2022').pop().trim() : P.autoLabel(a))), btn('Edit', () => open(k), 'sm')), spark(a)))
        : [h('div', { class: 'cp-hint' }, 'Belum ada otomasi untuk track ini.')]),
      h('div', { class: 'cp-line' }, btn('+ Otomasi…', (e) => { const r = e.currentTarget.getBoundingClientRect(); TL.openLaneMenu(c.track, r.left, r.bottom + 2); }))));
  }
  // ---- Scale box (Live 12 scale mode)
  if (kind === 'midi') {
    const scOn = !!SCALES[cfg.scale];
    kids.push(sec('Scale',
      h('div', { class: 'cp-line' }, sw('Scale', scOn, () => { if (scOn) { cfg.lastScale = cfg.scale; cfg.scale = 'Chromatic'; } else cfg.scale = cfg.lastScale || 'Major'; buildProps(); invalidate(); })),
      h('div', { class: 'cp-line' },
        ch(NAMES[cfg.key], (x, y) => menu(NAMES.map((n, k) => ({ label: n, check: cfg.key === k, fn: () => { cfg.key = k; buildProps(); invalidate(); } })), x, y)),
        ch(scOn ? cfg.scale : cfg.lastScale || 'Major', (x, y) => menu(Object.keys(SCALES).filter((q) => SCALES[q]).map((q) => ({ label: q, check: scOn && cfg.scale === q, fn: () => { cfg.scale = q; cfg.lastScale = q; buildProps(); invalidate(); } })), x, y))),
      h('div', { class: 'cp-line' }, sw('Kunci ke skala', cfg.lock, () => { cfg.lock = !cfg.lock; buildProps(); }), btn('Tebak', (e) => { const r = e.currentTarget.getBoundingClientRect(); guessMenu(sel.size ? selNotes() : cl.notes, r.left, r.bottom + 2); }, 'sm'))));
  }
  // ---- Drum box
  if (kind === 'drum') {
    kids.push(sec('Drum',
      h('div', { class: 'cp-seg' }, sw('Step', stepsMode(), () => { if (!stepsMode()) { cfg.mode = 'steps'; sel.clear(); refresh(); } }), sw('Notes', !stepsMode(), () => { if (stepsMode()) { cfg.mode = 'notes'; sel.clear(); refresh(); } })),
      h('div', { class: 'cp-line' }, btn('+ Sample', () => DP.addPad(c.track, (k) => { openPad(k); })), btn('Pad', () => (padSel >= 0 ? closePad() : openPad(Math.max(0, Math.min(padSel, padList().length - 1))))))));
  }
  // ---- Envelope box (automation clips)
  if (kind === 'auto') {
    kids.push(sec('Envelope', row('Target', val(P.autoLabel(t))),
      h('div', { class: 'cp-line' }, btn('Ratakan', () => { checkpoint(); const v0 = cl.pts.length ? cl.pts[0].v : 0.5; cl.pts = [{ t: 0, v: v0 }, { t: cl.len, v: v0 }]; asel = null; changed(); }))));
  }
  if (kind === 'audio') kids.push(...AE.panel({ sec, row, val, ch, sw, btn }), sec('Sample', row('File', val(((cl.dsample || cl.sample) || {}).name || '-'))));   // Audio / Pitch / Warp / Region boxes
  props.replaceChildren(h('div', { class: 'cp-in' }, ...kids));
}
function trimToLen(cl) {                                     // after a length change: notes / points past the new end go (the change is one undo step)
  if (cl.ll && cl.ll >= cl.len) { delete cl.ll; delete cl.lp; }   // shortened to (or below) its loop: not looped any more
  if (cl.notes) cl.notes = cl.notes.filter((n) => n.t < cl.len);
  if (cl.pts) { cl.pts = cl.pts.filter((q) => q.t <= cl.len); if (!cl.pts.length) cl.pts = [{ t: 0, v: 0.5 }]; }
}

// Editor toolbar: only the view commands (grid snap, fit, follow, selection, lane); the clip's properties live in the panel on the left.
function toolbar() {
  tools.replaceChildren();
  buildProps();
  const c = cur(); if (!c) return;
  const t = state.tracks[c.track];
  const B = (label, fn, on) => h('button', { class: 'b' + (on ? ' on' : ''), onclick: fn }, label);
  const SEP = () => h('i', { class: 'ed-sep', 'aria-hidden': 'true' });   // hairline between the toolbar groups
  if (t.kind === 'audio') return;
  if (t.kind === 'auto') { tools.append(snapButton()); return; }
  if (t.kind === 'drum') tools.append(h('div', { class: 'ed-g' }, B('Step', () => { if (!stepsMode()) { cfg.mode = 'steps'; sel.clear(); refresh(); } }, stepsMode()), B('Notes', () => { if (stepsMode()) { cfg.mode = 'notes'; sel.clear(); refresh(); } }, !stepsMode())));
  if (stepsMode()) return;
  if (t.kind === 'drum') tools.append(SEP());
  tools.append(
    snapButton(), B('Fold', () => { cfg.fold = !cfg.fold; const ppt = v.ppt, x0 = v.x0; emo.t = null; fitView(c.clip, false); v.ppt = ppt; v.x0 = x0; clampV(c.clip); toolbar(); invalidate(); }, cfg.fold), SEP(),   // rows change at once, the time axis stays
    B('Fit', () => fitView(c.clip, true)),
    B('Ikuti', () => { cfg.follow = !cfg.follow; toolbar(); }, cfg.follow),
    B('Pilih semua', () => { sel = new Set(c.clip.notes); invalidate(); if (sel.size) noteBar(null, 80, RULER + 60); }), SEP(),
    B('Lane', () => { cfg.vel = !cfg.vel; clampV(cur().clip); invalidate(); toolbar(); }, cfg.vel),
  );
}

function showCanvas(on) { canvas.style.display = ov.style.display = on ? '' : 'none'; }

export function refresh() {
  if (!host) return;
  updateTitle();
  const c = cur();
  tsel = null; drag = null;
  if (!c) { padSel = -1; syncSide(); showCanvas(false); tools.replaceChildren(); host.replaceChildren(h('div', { class: 'hint' }, 'Belum ada klip yang dipilih. Ketuk klip di arrangement, lalu ketuk dua kali untuk membuka editor.')); return; }
  const t = state.tracks[c.track];
  if (t.kind === 'audio') { padSel = -1; syncSide(); showCanvas(false); tools.replaceChildren(); AE.mount(host); return; }
  asel = null;
  host.replaceChildren(); showCanvas(true);
  if (fitId !== c.clip.id) { fitId = c.clip.id; needFit = true; }
  dims(); toolbar();
  sel = new Set([...sel].filter((n) => (c.clip.notes || []).includes(n)));   // an automation / audio clip has no notes: the old pick is dropped
  if (stepsMode()) { /* handlers read the mode on every event */ }
  syncSide();
  fit(); tryFit(); invalidate();
}

const stepLaneH = () => (H >= 150 ? 56 : 0);          // v72: FL Studio Mobile graph lane (velocity of the selected pad) under the grid when the panel is tall enough
const laneRow = () => Math.max(0, Math.min(padList().length - 1, padSel));
let svAuto = true;                                  // v71: the step grid follows the panel size until the user pinches it
// the pad rows never get shorter than what fills the panel (no empty band under them), the grid scrolls from step 1 to 4 bars past the pattern end
function clampSteps() {
  const c = cur(); if (!c) return;
  const n = Math.max(1, padList().length), gridH = H - 18 - stepLaneH(), SPB = Math.max(1, Math.round(P.barLenAt(c.clip.start) / STEP)), room = W - LANE_HEAD - 2;
  sv.rowH = clamp(sv.rowH, Math.max(26, Math.min(70, gridH / n)), 70);
  sv.x0 = clamp(sv.x0, 0, Math.max(0, (Math.ceil(contentEnd(c.clip) / STEP) + 4 * SPB) * sv.stepW - room));
  sv.y0 = clamp(sv.y0, 0, Math.max(0, n * sv.rowH - gridH));
}
function fitSteps(c, reset) {                              // FL Studio Mobile: the pattern plus one open bar fill the width, the pad rows fill the height
  const steps = Math.max(1, Math.ceil(contentEnd(c) / STEP)), SPB = Math.max(1, Math.round(P.barLenAt(c.start) / STEP)), n = Math.max(1, padList().length), room = W - LANE_HEAD - 2;
  let vis = steps + SPB; if (room / vis < 22) vis = Math.max(SPB, Math.floor(room / 22 / SPB) * SPB);   // too narrow: whole bars that stay tappable
  sv.stepW = clamp(room / vis, 14, 80); sv.rowH = clamp((H - 18 - stepLaneH()) / n, 26, 70);
  if (reset) { sv.x0 = 0; sv.y0 = 0; }
  clampSteps();                                                // a refresh keeps where the user scrolled
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
  root.replaceChildren(); root.classList.add('lv12');
  props = h('div', { class: 'cp' }); props.hidden = true;
  tools = h('div', { class: 'ed-tools' });
  const stage = h('div', { class: 'ed-canvas' });
  host = h('div', { class: 'ed-host' });
  canvas = h('canvas', {}); ov = h('canvas', {});
  side = h('div', { class: 'ed-side' }); side.hidden = true;
  stage.append(canvas, ov, host);
  const body = h('div', { class: 'ed-body' }, stage, side);
  root.append(props, h('div', { class: 'ed-main' }, tools, body));
  ctx = canvas.getContext('2d', { alpha: false }); octx = ov.getContext('2d');
  window.addEventListener('themechange', invalidate); window.addEventListener('applayout', fit);
  AE.onPanel(() => buildProps());                     // the audio editor rebuilt its controls: the panel shows the clip's new audio settings
  const R = rollHandlers(), S = stepHandlers(), A = autoHandlers();
  const route = (name) => (...a) => { if (!cur()) return undefined; return (isAuto() ? A : stepsMode() ? S : R)[name]?.(...a); };   // a looped clip is edited as its loop source (no unrolling)
  attachGestures(ov, Object.fromEntries(['hit', 'tap', 'dtap', 'long', 'dragStart', 'drag', 'dragEnd', 'pan', 'panEnd', 'pinch', 'wheel'].map((k) => [k, route(k)])));
  ov.addEventListener('pointerdown', () => { emo.vx = emo.vy = 0; emo.t = null; }, true);   // a touch stops a fling or a Fit glide where it is
  new ResizeObserver(fit).observe(stage);
  P.onChange((w) => { if (w === 'clips' || w === 'tracks') updateTitle(); if (w === 'notes' || w === 'clips' || w === 'tracks') invalidate(); if (w === 'devices' && stepsMode()) { toolbar(); invalidate(); } });
}

// Key / scale chips in the top bar read and set the piano roll's scale highlight.
export const KEY_NAMES = NAMES;
export const SCALE_NAMES = Object.keys(SCALES);
export const getTheory = () => ({ key: cfg.key, scale: cfg.scale });
export const scaleSteps = () => SCALES[cfg.scale] || null;   // semitones of the Clip View scale from its key, null = chromatic (Keys tab highlight)
export function setTheory(key, scale) { if (key !== undefined) cfg.key = key; if (scale !== undefined) { cfg.scale = scale; if (SCALES[scale]) cfg.lastScale = scale; } buildProps(); invalidate(); }
