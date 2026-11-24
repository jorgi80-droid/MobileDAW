// Displays of the effect devices, drawn from the real engine data (eng.devOut) and the real engine formulas:
// Analyzer (spectrum / scope / loudness / stereo / pitch), Levelness (loudness meter with mastering targets),
// Stereolizer, Spacer, EQ curves (draggable), Compressor / Limiter / Autoduck meters, Saturator / Distortion curves, Delay, Reverb.
import { C } from './theme.js';
import { h, menu } from './ui.js';
import { eng } from './engine.js';
import { vizCanvas, DISP, ring } from './devviz.js';
import { Biquad, clamp, TWO_PI } from './engine/dsp.js';
import { noteName, DEVICES } from './defs.js';
import * as P from './project.js';

const CY = '#5fd0e0', OR = '#ffa722', RD = '#e5484d', YL = '#e8d040', GN = '#5fd08a', PU = '#c9a0ff';
const mem = new Map();                                   // per device id: tab / options, survives card rebuilds
const st = (d, init) => { let s = mem.get(d.id); if (!s) { s = { ...init }; mem.set(d.id, s); } return s; };
const f1 = (x) => (x <= -99 ? '\u2014' : x.toFixed(1));
const f2 = (x) => (x <= -99 ? '\u2014' : x.toFixed(2));

function begin(c) {
  const g = c.getContext('2d');
  g.setTransform(c._d, 0, 0, c._d, 0, 0);
  g.fillStyle = DISP.bg; g.fillRect(0, 0, c._w, c._h);
  return g;
}
function txt(g, t, x, y, al = 'left', col = DISP.ink, sz = 9, wt = '') {
  g.fillStyle = col; g.font = `${wt} ${sz}px system-ui,sans-serif`; g.textAlign = al; g.textBaseline = 'alphabetic'; g.fillText(t, x, y);
}
const hl = (g, y, x0, x1, col = DISP.grid) => { g.fillStyle = col; g.fillRect(x0, Math.round(y), x1 - x0, 1); };
const vl = (g, x, y0, y1, col = DISP.grid) => { g.fillStyle = col; g.fillRect(Math.round(x), y0, 1, y1 - y0); };
function path(g, pts, col, fillTo = null, lw = 1.5) {
  if (!pts.length) return;
  g.beginPath(); pts.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = col; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke();
  if (fillTo !== null) { g.lineTo(pts[pts.length - 1][0], fillTo); g.lineTo(pts[0][0], fillTo); g.closePath(); g.fillStyle = col + '30'; g.fill(); }
}
const chip = (label, on, fn, cls = '') => { const b = h('button', { class: 'fv-b' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), onclick: (e) => fn(e, b) }, label); return b; };
const tabBar = (names, cur, pick) => {
  const bs = names.map((n, k) => h('button', { class: 'fv-t' + (k === cur ? ' on' : ''), onclick: () => { bs.forEach((b, m) => b.classList.toggle('on', m === k)); pick(k); } }, n));
  return h('div', { class: 'fv-tabs' }, bs);
};
// horizontal level bar: value in dB between lo..hi, optional marker
function hbar(g, x, y, w, hh, db, lo, hi, col, mark = null) {
  g.fillStyle = '#2a2a2f'; g.fillRect(x, y, w, hh);
  const t = clamp((db - lo) / (hi - lo), 0, 1); g.fillStyle = col; g.fillRect(x, y, w * t, hh);
  if (mark !== null) { g.fillStyle = '#ffffff'; g.fillRect(x + clamp((mark - lo) / (hi - lo), 0, 1) * w - 0.5, y - 1, 1.5, hh + 2); }
}
const levelCol = (db) => (db > -1 ? RD : db > -6 ? YL : GN);

// ====================================================================================================
//  Analyzer
// ====================================================================================================
const SP_L = 26;
export function analyzerView(ctx) {
  const { i, di, d, every } = ctx, W = 304, H = 132;
  const S = st(d, { tab: 0, freeze: false, peak: true, tilt: false, zoom: 1 });
  const cv = vizCanvas(W, H), ro = h('div', { class: 'fv-ro' }), bar = h('div', { class: 'fv-chips' });
  const sm = new Float32Array(64).fill(-100), pk = new Float32Array(64).fill(-100), fr = new Float32Array(64).fill(-100);
  const histM = [], histS = []; let tick = 0, last = null, cur = null, trails = [];
  const fx = (f) => SP_L + (Math.log(f / 20) / Math.log(1000)) * (W - SP_L - 4);
  const Y0 = 6, Y1 = H - 16, dbY = (db) => Y0 + (clamp(db, -90, 0) / -90) * (Y1 - Y0);
  const bandF = (b) => 20 * Math.pow(1000, (b + 0.5) / 64);
  const tilt = (b) => (S.tilt ? 4.5 * Math.log2(bandF(b) / 1000) : 0);

  function spectrum(g, o) {
    for (const db of [-18, -36, -54, -72]) { hl(g, dbY(db), SP_L, W); txt(g, db + '', SP_L - 3, dbY(db) + 3, 'right'); }
    for (const [f, t] of [[30, '30'], [50, ''], [100, '100'], [200, ''], [500, '500'], [1000, '1k'], [2000, ''], [5000, '5k'], [10000, '10k'], [20000, '']]) { vl(g, fx(f), Y0, Y1); if (t) txt(g, t, fx(f), H - 5, 'center'); }
    const src = S.freeze ? fr : sm, pts = [];
    for (let b = 0; b < 64; b++) pts.push([fx(bandF(b)), dbY(src[b] + tilt(b))]);
    g.save(); g.beginPath(); g.rect(SP_L, Y0 - 2, W - SP_L, Y1 - Y0 + 4); g.clip();
    const gr = g.createLinearGradient(0, Y0, 0, Y1); gr.addColorStop(0, CY + 'cc'); gr.addColorStop(1, CY + '10');
    g.beginPath(); pts.forEach(([x, y], n) => { if (!n) g.moveTo(x, y); else { const [px, py] = pts[n - 1]; g.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2); } });
    g.lineTo(pts[63][0], pts[63][1]); g.strokeStyle = CY; g.lineWidth = 1.5; g.stroke(); g.lineTo(pts[63][0], Y1); g.lineTo(pts[0][0], Y1); g.closePath(); g.fillStyle = gr; g.fill();
    if (S.peak) path(g, Array.from(pk, (v, b) => [fx(bandF(b)), dbY(v + tilt(b))]), OR + 'cc', null, 1);
    g.restore();
    if (cur) {
      const f = 20 * Math.pow(1000, (cur.x - SP_L) / (W - SP_L - 4)), b = clamp(Math.round(Math.log(f / 20) / Math.log(1000) * 64 - 0.5), 0, 63);
      vl(g, cur.x, Y0, Y1, '#ffffff66'); txt(g, `${f >= 1000 ? (f / 1000).toFixed(2) + ' kHz' : Math.round(f) + ' Hz'}  ${f1(src[b] + tilt(b))} dB`, Math.min(cur.x + 4, W - 90), Y0 + 9, 'left', '#fff', 10);
    }
  }
  function scope(g, o) {
    const mid = (Y0 + Y1) / 2, amp = (Y1 - Y0) / 2 - 2;
    for (const v of [-1, -0.5, 0.5, 1]) hl(g, mid - v * amp, SP_L, W); hl(g, mid, SP_L, W, '#3a3a3e');
    for (const v of [1, 0.5, 0, -0.5, -1]) txt(g, v.toFixed(1), SP_L - 3, mid - v * amp + 3, 'right');
    txt(g, `\u00d7${S.zoom}`, W - 4, H - 5, 'right');
    if (!o) return;
    const pts = []; for (let k = 0; k < 96; k++) pts.push([SP_L + (k / 95) * (W - SP_L - 2), mid - clamp(o[74 + k] * S.zoom, -1, 1) * amp]);
    path(g, pts, CY, mid, 1.3);
  }
  function loud(g, o) {
    const lo = -60, hi = 0, y = (v) => Y0 + ((hi - clamp(v, lo, hi)) / (hi - lo)) * (Y1 - Y0);
    for (const v of [-10, -20, -30, -40, -50]) { hl(g, y(v), SP_L, W); txt(g, v + '', SP_L - 3, y(v) + 3, 'right'); }
    txt(g, 'LUFS', W - 4, H - 5, 'right'); txt(g, '\u2014 Momentary', SP_L + 4, H - 5, 'left', CY); txt(g, '\u2014 Short-term', SP_L + 70, H - 5, 'left', OR);
    const line = (arr, col) => { const pts = []; arr.forEach((v, k) => { if (v > -99) pts.push([SP_L + (k / 299) * (W - SP_L - 2), y(v)]); }); path(g, pts, col, null, 1.4); };
    line(histS, OR); line(histM, CY);
    if (o && o[300] > -99) { hl(g, y(o[300]), SP_L, W, '#ffffff55'); txt(g, 'I ' + f1(o[300]), SP_L + 4, y(o[300]) - 3, 'left', '#fff', 10); }
  }
  function stereo(g, o) {
    const cx = 76, cy = (Y0 + Y1) / 2 + 2, R = 66;
    g.strokeStyle = '#2a2a2d'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R, Math.PI, 0); g.stroke();
    g.beginPath(); g.moveTo(cx - R * 0.7071, cy - R * 0.7071); g.lineTo(cx, cy); g.lineTo(cx + R * 0.7071, cy - R * 0.7071); g.moveTo(cx, cy - R); g.lineTo(cx, cy); g.stroke();
    txt(g, 'L', cx - R * 0.7071 - 8, cy - R * 0.7071 + 4, 'center'); txt(g, 'R', cx + R * 0.7071 + 8, cy - R * 0.7071 + 4, 'center'); txt(g, 'M', cx, cy - R - 3, 'center');
    if (o) {
      trails.push(Float32Array.from(o.slice(170, 298))); if (trails.length > 4) trails.shift();
      trails.forEach((tr, k) => { g.fillStyle = CY + ['22', '44', '88', 'ff'][k + 4 - trails.length]; for (let p = 0; p < 64; p++) g.fillRect(cx + clamp(tr[p * 2], -1, 1) * R * 0.95 - 0.8, cy - clamp(tr[p * 2 + 1], -1, 1) * R * 0.95 - 0.8, 1.7, 1.7); });
    }
    const x0 = 160, bw = 132, row = (label, y, v, lo, hi, txtv, center) => {
      txt(g, label, x0, y - 4, 'left', '#8b8b92', 9); txt(g, txtv, x0 + bw, y - 4, 'right', '#cfcfd2', 9);
      g.fillStyle = '#2a2a2f'; g.fillRect(x0, y, bw, 8); vl(g, x0 + bw / 2, y - 1, y + 9, '#555');
      const t = (clamp(v, lo, hi) - lo) / (hi - lo); g.fillStyle = center ? (v < 0 ? RD : GN) : CY;
      if (center) g.fillRect(Math.min(x0 + bw / 2, x0 + t * bw), y, Math.abs(t - 0.5) * bw, 8); else g.fillRect(x0, y, t * bw, 8);
    };
    const corr = o ? o[0] : 0, bal = o ? o[68] : 0, wd = o ? o[69] : 0;
    row('Korelasi', 36, corr, -1, 1, corr.toFixed(2), true); row('Balance', 70, bal, -1, 1, bal === 0 ? 'C' : (bal < 0 ? Math.round(-bal * 100) + 'L' : Math.round(bal * 100) + 'R'), false);
    g.fillStyle = '#2a2a2f'; g.fillRect(x0 + bw / 2 - 1, 62, 2, 8);
    row('Lebar (side)', 104, wd, 0, 1, Math.round(wd * 100) + ' %', false);
    txt(g, 'Peak L', x0, 128, 'left'); txt(g, 'Peak R', x0, 140, 'left');
    hbar(g, x0 + 40, 121, bw - 40, 6, o ? o[66] : -100, -60, 0, levelCol(o ? o[66] : -100)); hbar(g, x0 + 40, 133, bw - 40, 6, o ? o[67] : -100, -60, 0, levelCol(o ? o[67] : -100));
  }
  function pitch(g, o) {
    const f = o ? o[71] : 0;
    if (f > 0) {
      const nn = 12 * Math.log2(f / 440) + 69, r = Math.round(nn), cents = (nn - r) * 100, ok = Math.abs(cents) < 5;
      txt(g, r >= 0 && r < 128 ? noteName(r) : '\u2014', W / 2, 62, 'center', ok ? GN : '#fff', 44, '600'); txt(g, `${f.toFixed(1)} Hz`, W / 2, 84, 'center', '#cfcfd2', 13);
      const bx = 52, bw = W - 104, by = 108; g.fillStyle = '#2a2a2f'; g.fillRect(bx, by, bw, 12);
      for (let c = -50; c <= 50; c += 10) vl(g, bx + (c + 50) / 100 * bw, by - (c % 50 === 0 || c === 0 ? 4 : 0), by + 12, c === 0 ? '#aaa' : '#444');
      g.fillStyle = ok ? GN : OR; g.fillRect(bx + (clamp(cents, -50, 50) + 50) / 100 * bw - 3, by - 3, 6, 18);
      txt(g, '-50', bx, by + 26, 'center'); txt(g, '0', W / 2, by + 26, 'center'); txt(g, '+50', bx + bw, by + 26, 'center'); txt(g, `${cents >= 0 ? '+' : ''}${cents.toFixed(0)} cent`, W / 2, 24, 'center', '#cfcfd2', 11);
    } else txt(g, 'Tidak ada nada yang terdeteksi', W / 2, H / 2, 'center', '#8b8b92', 11);
  }
  const FNS = [spectrum, scope, loud, stereo, pitch];
  function readout(o) {
    if (!o) { ro.textContent = 'Putar audio untuk melihat data'; return; }
    ro.textContent = `RMS ${f1(o[1])} dB \u2022 Peak ${f1(o[70])} dB \u2022 Korelasi ${o[0].toFixed(2)}${o[0] < 0 ? ' (waspada fase)' : ''}${o[298] > -99 ? ` \u2022 M ${f1(o[298])} LUFS` : ''}`;
  }
  function draw() { const g = begin(cv); if (last === null && S.tab !== 4) { FNS[S.tab](g, null); if (S.tab === 0) txt(g, 'Menunggu sinyal\u2026', W / 2, H / 2, 'center', '#8b8b92', 11); } else FNS[S.tab](g, last); }
  const mkChips = () => {
    const c = [];
    c.push(chip(S.freeze ? 'Lanjut' : 'Freeze', S.freeze, (e, b) => { S.freeze = !S.freeze; if (S.freeze) fr.set(sm); mkChips(); draw(); }));
    if (S.tab === 0) { c.push(chip('Peak', S.peak, () => { S.peak = !S.peak; mkChips(); draw(); })); c.push(chip('Tilt 4.5', S.tilt, () => { S.tilt = !S.tilt; mkChips(); draw(); })); }
    if (S.tab === 1) for (const z of [1, 2, 4, 8]) c.push(chip('\u00d7' + z, S.zoom === z, () => { S.zoom = z; mkChips(); draw(); }));
    if (S.tab === 2 || S.tab === 0) c.push(chip('Reset', false, () => { P.setDeviceParam(i, di, 0, (d.params[0] || 0) + 1); histM.length = histS.length = 0; pk.fill(-100); }));
    bar.replaceChildren(...c);
  };
  cv.addEventListener('pointerdown', (e) => { if (S.tab !== 0) return; cv.setPointerCapture(e.pointerId); const r = cv.getBoundingClientRect(); cur = { x: clamp((e.clientX - r.left) * W / r.width, SP_L, W - 4) }; draw(); });
  cv.addEventListener('pointermove', (e) => { if (!cur) return; const r = cv.getBoundingClientRect(); cur.x = clamp((e.clientX - r.left) * W / r.width, SP_L, W - 4); draw(); });
  const endc = () => { cur = null; draw(); }; cv.addEventListener('pointerup', endc); cv.addEventListener('pointercancel', endc);
  const tabs = tabBar(['Spektrum', 'Scope', 'Loudness', 'Stereo', 'Pitch'], S.tab, (k) => { S.tab = k; trails = []; mkChips(); draw(); readout(last); });
  mkChips(); draw();
  every(40, () => {
    const o = eng.devOut(i, di);
    if (!Array.isArray(o) || o.length < 310) { draw(); return; }
    last = o;
    if (!S.freeze) for (let b = 0; b < 64; b++) { const v = clamp(o[2 + b], -100, 0); sm[b] = sm[b] < -99 ? v : sm[b] + (v - sm[b]) * (v > sm[b] ? 0.55 : 0.25); pk[b] = Math.max(sm[b], pk[b] - 0.45); }
    if (++tick % 3 === 0 && !S.freeze) { histM.push(o[298]); histS.push(o[299]); if (histM.length > 300) { histM.shift(); histS.shift(); } }
    readout(o); draw();
  });
  return { el: h('div', { class: 'fv' }, tabs, cv, bar, ro), width: 322 };
}

// ====================================================================================================
//  Levelness: mastering loudness meter with targets
// ====================================================================================================
export const TARGETS = [
  { name: 'Spotify / Tidal / SoundCloud', lufs: -14, tp: -1 }, { name: 'Apple Music / Sound Check', lufs: -16, tp: -1 }, { name: 'YouTube', lufs: -14, tp: -1 },
  { name: 'Amazon Music', lufs: -14, tp: -2 }, { name: 'Podcast / Voice', lufs: -16, tp: -1 }, { name: 'EBU R128 (siaran Eropa)', lufs: -23, tp: -1 },
  { name: 'ATSC A/85 (TV AS)', lufs: -24, tp: -2 }, { name: 'Streaming keras', lufs: -11, tp: -1 }, { name: 'Club / CD master', lufs: -9, tp: -0.3 }, { name: 'Vinyl / dinamis', lufs: -18, tp: -1 },
];
export function loudnessView(ctx) {
  const { i, di, d, every } = ctx;
  if (d.target === undefined || d.tpMax === undefined) { const t = TARGETS[0]; d.target = d.target ?? t.lufs; d.tpMax = d.tpMax ?? t.tp; d.tname = d.tname || t.name; }
  const cell = (label, cls = '') => { const v = h('div', { class: 'ln-v ' + cls }, '\u2014'); return [h('div', { class: 'ln' }, h('div', { class: 'ln-l' }, label), v), v]; };
  const [mC, mV] = cell('Momentary'), [sC, sV] = cell('Short-term'), [iC, iV] = cell('Integrated', 'big'), [rC, rV] = cell('LRA (LU)'), [tC, tV] = cell('True peak'), [pC, pV] = cell('Peak'), [gC, gV] = cell('RMS'), [uC, uV] = cell('Gain');
  const pass = h('div', { class: 'ln-pass' }), diff = h('div', { class: 'ln-diff' });
  const cv = vizCanvas(300, 70), hist = [];
  const tname = h('button', { class: 'fv-b wide', onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    menu(TARGETS.map((t) => ({ label: `${t.name}  (${t.lufs} LUFS / ${t.tp} dBTP)`, check: d.target === t.lufs && d.tpMax === t.tp && d.tname === t.name, fn: () => { d.target = t.lufs; d.tpMax = t.tp; d.tname = t.name; tname.textContent = label(); } })), Math.max(6, r.left - 40), r.bottom);
  } }, '');
  const label = () => `Target: ${d.tname}  ${d.target} LUFS \u2022 ${d.tpMax} dBTP`; tname.textContent = label();
  let g0 = 0, lastO = null;
  const match = chip('Cocokkan gain', false, () => {
    if (!lastO || lastO[2] <= -99) return;
    const need = clamp(d.target - (lastO[2] - 0), -24, 24);      // lastO[2] is measured before the gain, so the needed gain is simply target - measured
    P.setDeviceParam(i, di, 1, Math.round(need * 10) / 10); ctx.refreshKnobs && ctx.refreshKnobs();
  });
  const reset = chip('Reset', false, () => { P.setDeviceParam(i, di, 0, (d.params[0] || 0) + 1); hist.length = 0; });
  every(100, () => {
    const o = eng.devOut(i, di); if (!Array.isArray(o) || o.length < 12) return; lastO = o;
    const g = o[10]; g0 = g;
    const ok = (x) => x > -99, add = (x) => (ok(x) ? x + g : x);
    mV.textContent = f1(add(o[0])); sV.textContent = f1(add(o[1])); iV.textContent = f1(add(o[2])); rV.textContent = o[3].toFixed(1); tV.textContent = f1(add(o[4])); pV.textContent = f1(add(o[5])); gV.textContent = f1(add(o[7])); uV.textContent = (g >= 0 ? '+' : '') + g.toFixed(1) + ' dB';
    const tp = add(o[4]); tV.style.color = !ok(tp) ? '' : tp > d.tpMax ? RD : tp > d.tpMax - 1 ? YL : ''; iV.style.color = !ok(o[2]) ? '' : Math.abs(add(o[2]) - d.target) <= 1 ? GN : '';
    if (ok(o[2])) {
      const dl = add(o[2]) - d.target; diff.textContent = `Integrated ${dl >= 0 ? '+' : ''}${dl.toFixed(1)} LU dari target \u2022 gain yang dibutuhkan ${(d.target - o[2] >= 0 ? '+' : '') + (d.target - o[2]).toFixed(1)} dB`;
      pass.replaceChildren(h('span', { class: 'ok' + (Math.abs(dl) <= 1 ? ' y' : ' n') }, (Math.abs(dl) <= 1 ? '\u2713 ' : '\u2717 ') + 'Loudness \u00b11 LU'), h('span', { class: 'ok' + (tp <= d.tpMax ? ' y' : ' n') }, (tp <= d.tpMax ? '\u2713 ' : '\u2717 ') + `True peak \u2264 ${d.tpMax}`), h('span', { class: 'ok' + (o[3] <= 15 ? ' y' : ' n') }, (o[3] <= 15 ? '\u2713 ' : '\u2717 ') + 'LRA \u2264 15'));
    } else { diff.textContent = 'Putar audio untuk mengukur (mulai dari awal lagu agar Integrated akurat)'; pass.replaceChildren(); }
    hist.push(add(o[0])); if (hist.length > 200) hist.shift();
    const gx = begin(cv), W = cv._w, H = cv._h, y = (v) => H - clamp((v + 40) / 40, 0, 1) * (H - 4) - 2;
    gx.fillStyle = OR + '22'; gx.fillRect(0, y(d.target + 1), W, y(d.target - 1) - y(d.target + 1)); hl(gx, y(d.target), 0, W, OR);
    for (const v of [-10, -20, -30]) { hl(gx, y(v), 0, W); txt(gx, v + '', 2, y(v) - 2); }
    txt(gx, 'target ' + d.target, W - 3, y(d.target) - 3, 'right', OR, 9);
    path(gx, hist.map((v, k) => [(k / 199) * W, y(v)]).filter((p, k) => hist[k] > -99), CY, null, 1.6);
  });
  return { el: h('div', { class: 'loud' }, h('div', { class: 'ln-grid' }, mC, sC, iC, rC, tC, pC, gC, uC), cv, diff, pass, tname, h('div', { class: 'fv-chips' }, match, reset)), width: 320 };
}

// ====================================================================================================
//  Stereolizer
// ====================================================================================================
export function stereolizerView(ctx) {
  const { i, di, every } = ctx, W = 230, H = 112, cv = vizCanvas(W, H), ro = h('div', { class: 'fv-ro' }); let trails = [];
  every(40, () => {
    const o = eng.devOut(i, di), g = begin(cv), cx = 56, cy = 58, R = 50;
    g.strokeStyle = '#2a2a2d'; g.beginPath(); g.arc(cx, cy, R, Math.PI, 0); g.stroke(); g.beginPath(); g.moveTo(cx - R * 0.7071, cy - R * 0.7071); g.lineTo(cx, cy); g.lineTo(cx + R * 0.7071, cy - R * 0.7071); g.moveTo(cx, cy - R); g.lineTo(cx, cy); g.stroke();
    txt(g, 'L', cx - R * 0.7071 - 6, cy - R * 0.7071 + 3, 'center'); txt(g, 'R', cx + R * 0.7071 + 6, cy - R * 0.7071 + 3, 'center');
    const ok = Array.isArray(o) && o.length >= 133;
    if (ok) {
      trails.push(Float32Array.from(o.slice(5, 133))); if (trails.length > 4) trails.shift();
      trails.forEach((tr, k) => { g.fillStyle = PU + ['22', '44', '88', 'ff'][k + 4 - trails.length]; for (let p = 0; p < 64; p++) g.fillRect(cx + clamp(tr[p * 2], -1, 1) * R - 0.8, cy - clamp(tr[p * 2 + 1], -1, 1) * R - 0.8, 1.7, 1.7); });
    }
    const x0 = 118, bw = 106, c = ok ? o[0] : 0;
    txt(g, 'Korelasi', x0, 16, 'left'); txt(g, c.toFixed(2), x0 + bw, 16, 'right', '#cfcfd2');
    g.fillStyle = '#2a2a2f'; g.fillRect(x0, 20, bw, 8); vl(g, x0 + bw / 2, 19, 29, '#666'); g.fillStyle = c < 0 ? RD : GN; g.fillRect(Math.min(x0 + bw / 2, x0 + (c + 1) / 2 * bw), 20, Math.abs(c) / 2 * bw, 8);
    const m = ok ? o[1] : -100, s = ok ? o[2] : -100;
    txt(g, 'Mid', x0, 48, 'left'); txt(g, f1(m) + ' dB', x0 + bw, 48, 'right', '#cfcfd2'); hbar(g, x0, 52, bw, 7, m, -60, 0, CY);
    txt(g, 'Side', x0, 76, 'left'); txt(g, f1(s) + ' dB', x0 + bw, 76, 'right', '#cfcfd2'); hbar(g, x0, 80, bw, 7, s, -60, 0, PU);
    txt(g, 'L', x0, 104, 'left'); hbar(g, x0 + 10, 98, 44, 6, ok ? o[3] : -100, -60, 0, levelCol(ok ? o[3] : -100)); txt(g, 'R', x0 + 60, 104, 'left'); hbar(g, x0 + 70, 98, 36, 6, ok ? o[4] : -100, -60, 0, levelCol(ok ? o[4] : -100));
    ro.textContent = ok ? (c < 0 ? 'Korelasi negatif: sinyal bisa hilang di mono' : 'Aman untuk mono') : 'Putar audio untuk melihat data';
  });
  return { el: h('div', { class: 'fv' }, cv, ro), width: 246 };
}

// ====================================================================================================
//  Spacer: early-reflection map
// ====================================================================================================
export function spacerView(ctx) {
  const { d } = ctx, cv = vizCanvas(200, 70), TL = [0.0113, 0.0173, 0.0233, 0.0311, 0.0397, 0.0491], TR = [0.0131, 0.0197, 0.0269, 0.0347, 0.0433, 0.0527], G = [0.8, 0.66, 0.54, 0.44, 0.34, 0.26];
  const draw = () => {
    const g = begin(cv), W = 200, H = 70, size = d.params[0], sp = d.params[1], mix = d.params[3], pre = d.params[4] / 1000, sc = 0.4 + size * 1.6, tmax = 0.2;
    hl(g, H / 2, 0, W, '#3a3a3e'); txt(g, 'L', 3, 11, 'left', CY); txt(g, 'R', 3, H - 4, 'left', OR); txt(g, '0', 14, H / 2 - 2); txt(g, '200 ms', W - 3, H / 2 - 2, 'right');
    g.fillStyle = '#fff'; g.fillRect(14, 8, 2, H - 16);
    for (let t = 0; t < 6; t++) for (const [T, col, up] of [[TL, CY, 1], [TR, OR, -1]]) {
      const x = 14 + (((T[t] * sc + pre) / tmax) * (W - 20)), a = G[t] * mix * 1.4 * (H / 2 - 6) / 1.4 * 1.6;
      g.fillStyle = col; g.fillRect(x - 1, up > 0 ? H / 2 - a : H / 2, 2, a);
    }
    const hx = 14 + ((sp * 0.014) / tmax) * (W - 20); g.fillStyle = PU; g.fillRect(hx - 1, H - 20, 2, 12); txt(g, 'Haas', hx + 3, H - 10, 'left', PU, 8);
  };
  draw();
  return { el: h('div', { class: 'fv' }, cv, h('div', { class: 'fv-ro' }, 'Pantulan awal kiri / kanan + sisi terdekorelasi')), draw, width: 216 };
}

// ====================================================================================================
//  EQ curves
// ====================================================================================================
const NF = 140, F0 = 20, F1 = 20000;
function bqDb(b, w) {
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b.b0 + b.b1 * c1 + b.b2 * c2, ni = -(b.b1 * s1 + b.b2 * s2), dr = 1 + b.a1 * c1 + b.a2 * c2, di = -(b.a1 * s1 + b.a2 * s2);
  return 10 * Math.log10(Math.max(1e-12, nr * nr + ni * ni) / Math.max(1e-12, dr * dr + di * di));
}
function eqView(ctx, spec) {
  const { d } = ctx, W = spec.w || 236, H = 96, cv = vizCanvas(W, H), SR = 48000, RNG = spec.range;
  const fx = (f) => (Math.log(f / F0) / Math.log(F1 / F0)) * (W - 4) + 2, xf = (x) => F0 * Math.pow(F1 / F0, clamp((x - 2) / (W - 4), 0, 1));
  const gy = (db) => H / 2 - (clamp(db, -RNG, RNG) / RNG) * (H / 2 - 6);
  const yg = (y) => clamp((H / 2 - y) / (H / 2 - 6) * RNG, -RNG, RNG);
  const filters = () => spec.filters(d.params).map((f) => { const b = new Biquad(); b[f.kind](SR, f.f, f.q, f.g); return b; });
  const draw = () => {
    const g = begin(cv), bs = filters();
    for (const f of [100, 1000, 10000]) { vl(g, fx(f), 0, H); txt(g, f >= 1000 ? f / 1000 + 'k' : f + '', fx(f) + 2, H - 3); }
    for (const v of [-RNG / 2, 0, RNG / 2]) hl(g, gy(v), 0, W, v === 0 ? '#3a3a3e' : '#2a2a2d'); txt(g, '+' + RNG, 3, 10); txt(g, '-' + RNG, 3, H - 3);
    const pts = []; for (let k = 0; k < NF; k++) { const f = F0 * Math.pow(F1 / F0, k / (NF - 1)), w = TWO_PI * f / SR; pts.push([fx(f), gy(bs.reduce((s, b) => s + bqDb(b, w), 0))]); }
    path(g, pts, CY, H / 2, 1.8);
    spec.nodes.forEach((n, k) => { const f = d.params[n.f], gdb = n.g === null ? 0 : d.params[n.g]; ring(g, fx(f), gy(gdb), 6, k + 1); });   // Live 12 EQ: numbered orange rings
  };
  let drag = null;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId); const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
    let best = null, bd = 900; for (const n of spec.nodes) { const dx = fx(d.params[n.f]) - x, dy = gy(n.g === null ? 0 : d.params[n.g]) - y, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = n; } }
    drag = best;
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return; const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height, def = ctx.def.params;
    const lo = def[drag.f].min, hi = def[drag.f].max; ctx.set(drag.f, clamp(xf(x), lo, hi));
    if (drag.g !== null) ctx.set(drag.g, Math.round(yg(y) * 10) / 10);
    draw(); ctx.refreshKnobs && ctx.refreshKnobs();
  });
  const end = () => { drag = null; }; cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  draw();
  return { el: h('div', { class: 'fv' }, cv), draw, width: W + 16 };
}
export const eq3View = (ctx) => eqView(ctx, {
  range: 15, nodes: [{ f: 4, g: 0, col: CY }, { f: 3, g: 1, col: OR }, { f: 5, g: 2, col: PU }],
  filters: (p) => [{ kind: 'lowShelf', f: p[4], q: 0.707, g: p[0] }, { kind: 'peaking', f: p[3], q: 0.8, g: p[1] }, { kind: 'highShelf', f: p[5], q: 0.707, g: p[2] }],
});
export const peqView = (ctx) => eqView(ctx, {
  range: 18, w: 300, nodes: [{ f: 0, g: 1, col: CY }, { f: 2, g: 3, col: OR }, { f: 5, g: 6, col: GN }, { f: 8, g: 9, col: PU }],
  filters: (p) => [{ kind: 'lowShelf', f: p[0], q: 0.707, g: p[1] }, { kind: 'peaking', f: p[2], q: p[4], g: p[3] }, { kind: 'peaking', f: p[5], q: p[7], g: p[6] }, { kind: 'highShelf', f: p[8], q: 0.707, g: p[9] }],
});

// ====================================================================================================
//  Dynamics: compressor, limiter, autoduck
// ====================================================================================================
export function compressorView(ctx) {
  const { i, di, d, every } = ctx, W = 214, H = 112, cv = vizCanvas(W, H), ro = h('div', { class: 'fv-ro' });
  let o = null, hold = 0;
  const cx = (db) => 22 + ((db + 60) / 60) * 92, cy = (db) => 100 - ((clamp(db, -60, 12) + 60) / 72) * 92;
  const out = (x) => {                                // same knee law as the engine
    const thr = d.params[0], ratio = Math.max(1, d.params[1]), knee = Math.max(0.01, d.params[5] ?? 6), slope = 1 / ratio - 1, over = x - thr; let red = 0;
    if (2 * over > knee) red = slope * over; else if (2 * over > -knee) red = slope * (over + knee / 2) * (over + knee / 2) / (2 * knee);
    return x + red + d.params[4];
  };
  const draw = () => {
    const g = begin(cv);
    for (const v of [-48, -36, -24, -12, 0]) { vl(g, cx(v), 8, 100); hl(g, cy(v), 22, 114); txt(g, v + '', cx(v), H - 3, 'center'); }
    path(g, [[cx(-60), cy(-60)], [cx(0), cy(0)]], '#555', null, 1);
    const pts = []; for (let x = -60; x <= 0; x += 1.5) pts.push([cx(x), cy(out(x))]); path(g, pts, CY, null, 2);
    ring(g, cx(d.params[0]), cy(out(d.params[0])), 4.5);
    if (o) { const li = clamp(o[1], -60, 0); g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx(li), cy(out(li)), 2.4, 0, TWO_PI); g.fill(); }
    // meters: input, output, gain reduction
    const mx = 128; txt(g, 'IN', mx, 16, 'left'); txt(g, 'OUT', mx, 44, 'left'); txt(g, 'GR', mx, 72, 'left');
    hbar(g, mx, 20, 78, 8, o ? o[1] : -100, -60, 0, levelCol(o ? o[1] : -100)); hbar(g, mx, 48, 78, 8, o ? o[2] : -100, -60, 0, levelCol(o ? o[2] : -100));
    const gr = o ? Math.max(0, o[0]) : 0; hold = Math.max(gr, hold - 0.4);
    g.fillStyle = '#2a2a2f'; g.fillRect(mx, 76, 78, 8); g.fillStyle = OR; g.fillRect(mx + 78 - Math.min(1, gr / 24) * 78, 76, Math.min(1, gr / 24) * 78, 8); g.fillStyle = '#fff'; g.fillRect(mx + 78 - Math.min(1, hold / 24) * 78 - 1, 75, 1.5, 10);
    txt(g, `-${gr.toFixed(1)} dB`, mx + 78, 100, 'right', '#cfcfd2', 11, '600');
  };
  draw(); every(50, () => { const r = eng.devOut(i, di); o = Array.isArray(r) && r.length >= 3 ? r : null; draw(); ro.textContent = o ? '' : ''; });
  return { el: h('div', { class: 'fv' }, cv), draw, width: 230 };
}
export function limiterView(ctx) {
  const { i, di, d, every } = ctx, W = 210, H = 84, cv = vizCanvas(W, H); let o = null, hold = 0, pkh = -100;
  const draw = () => {
    const g = begin(cv), x0 = 36, bw = 164;
    txt(g, 'IN', 4, 18, 'left'); txt(g, 'OUT', 4, 40, 'left'); txt(g, 'GR', 4, 62, 'left');
    for (const v of [-48, -36, -24, -12, -6, 0]) { vl(g, x0 + ((v + 60) / 60) * bw, 8, 70); txt(g, v + '', x0 + ((v + 60) / 60) * bw, H - 3, 'center', '#8b8b92', 8); }
    hbar(g, x0, 10, bw, 9, o ? o[1] : -100, -60, 0, levelCol(o ? o[1] : -100)); hbar(g, x0, 32, bw, 9, o ? o[2] : -100, -60, 0, levelCol(o ? o[2] : -100), d.params[0]);
    const gr = o ? Math.max(0, o[0]) : 0; hold = Math.max(gr, hold - 0.3); pkh = Math.max(o ? o[2] : -100, pkh - 0.2);
    g.fillStyle = '#2a2a2f'; g.fillRect(x0, 54, bw, 9); g.fillStyle = OR; g.fillRect(x0 + bw - Math.min(1, gr / 24) * bw, 54, Math.min(1, gr / 24) * bw, 9); g.fillStyle = '#fff'; g.fillRect(x0 + bw - Math.min(1, hold / 24) * bw - 1, 53, 1.5, 11);
    txt(g, `-${gr.toFixed(1)}`, W - 4, 52, 'right', '#cfcfd2', 10, '600'); 
  };
  draw(); every(50, () => { const r = eng.devOut(i, di); o = Array.isArray(r) && r.length >= 3 ? r : null; draw(); });
  return { el: h('div', { class: 'fv' }, cv), draw, width: 226 };
}
export function duckView(ctx) {
  const { i, di, d, every } = ctx, cv = vizCanvas(170, 34);
  const draw = (gr = 0) => { const g = begin(cv); txt(g, 'GR', 3, 14, 'left'); g.fillStyle = '#2a2a2f'; g.fillRect(22, 6, 120, 10); g.fillStyle = OR; g.fillRect(142 - Math.min(1, gr / Math.max(1, d.params[2])) * 120, 6, Math.min(1, gr / Math.max(1, d.params[2])) * 120, 10); txt(g, `-${gr.toFixed(1)} dB`, 167, 14, 'right', '#cfcfd2', 9); txt(g, 'Sumber sidechain: pilih track di bawah', 3, 29); };
  draw(); every(60, () => { const o = eng.devOut(i, di); draw(Array.isArray(o) && o.length ? Math.abs(o[0]) : 0); });
  return { el: h('div', { class: 'fv' }, cv), draw: () => draw(0), width: 190 };
}

// ====================================================================================================
//  Saturator / Distortion transfer curves, Delay taps, Reverb tail
// ====================================================================================================
const shape = (type, x) => { if (type === 0) return Math.tanh(x); if (type === 1) return clamp(x, -1, 1); let u = (x + 1) * 0.25; u -= Math.floor(u); return 1 - Math.abs(u * 4 - 2); };
export function curveView(ctx, kind) {
  const { d } = ctx, W = 150, H = 90, cv = vizCanvas(W, H);
  const draw = () => {
    const g = begin(cv), p = d.params, drive = Math.pow(10, (kind === 'sat' ? p[0] : p[1]) / 20), mix = kind === 'sat' ? p[1] : p[3], type = kind === 'sat' ? 0 : Math.round(p[0]);
    const out = Math.pow(10, p[kind === 'sat' ? 2 : 4] / 20), norm = kind === 'sat' ? 1 / Math.tanh(Math.max(drive, 1)) : 1, X = (x) => W / 2 + x * (W / 2 - 6), Y = (y) => H / 2 - clamp(y, -1.2, 1.2) * (H / 2 - 6);
    hl(g, H / 2, 0, W, '#3a3a3e'); vl(g, W / 2, 0, H, '#3a3a3e'); path(g, [[X(-1), Y(-1)], [X(1), Y(1)]], '#555', null, 1);
    const pts = []; for (let k = -1; k <= 1.0001; k += 0.01) { const w = shape(type, k * drive) * norm; pts.push([X(k), Y((k * (1 - mix) + w * mix) * out)]); }
    path(g, pts, CY, null, 2); txt(g, kind === 'sat' ? 'tanh' : ['soft', 'hard', 'fold'][type], W - 4, 11, 'right', '#8b8b92');
  };
  draw(); return { el: h('div', { class: 'fv' }, cv), draw, width: 166 };
}
export function delayView(ctx) {
  const { d } = ctx, W = 200, H = 64, cv = vizCanvas(W, H);
  const draw = () => {
    const g = begin(cv), t = d.params[0], fb = d.params[1], mix = d.params[2], pp = d.params[3] > 0.5, span = Math.min(2000, Math.max(t * 6.4, 400));
    hl(g, H - 12, 0, W, '#3a3a3e'); g.fillStyle = '#fff'; g.fillRect(8, 6, 2, H - 18);
    let a = mix, n = 1; while (a > 0.02 && n < 20) { const x = 8 + (t * n / span) * (W - 14); if (x > W - 2) break; g.fillStyle = pp ? (n % 2 ? CY : OR) : CY; const hh = a * (H - 24) * 1.4; g.fillRect(x - 1, H - 12 - Math.min(H - 20, hh), 3, Math.min(H - 20, hh)); a *= Math.max(0.02, fb) * (fb > 0 ? 1 : 0); n++; if (fb <= 0) break; }
    txt(g, Math.round(span) + ' ms', W - 3, H - 2, 'right'); txt(g, pp ? 'Ping-Pong' : 'Stereo', 4, H - 2);
  };
  draw(); return { el: h('div', { class: 'fv' }, cv), draw, width: 216 };
}
export function reverbView(ctx) {
  const { d } = ctx, W = 200, H = 64, cv = vizCanvas(W, H);
  const draw = () => {
    const g = begin(cv), size = d.params[0], damp = d.params[1], pre = (d.params[3] || 0) / 1000, fb = 0.7 + 0.28 * size, rt = Math.min(20, 0.032 * 60 / (-20 * Math.log10(fb))) * (1 - damp * 0.35), span = Math.max(1, rt * 1.25);
    for (const v of [-20, -40]) hl(g, 4 + (-v / 60) * (H - 20), 0, W);
    const pts = [], x0 = 6 + (pre / span) * (W - 10); for (let k = 0; k <= 80; k++) { const tt = (k / 80) * (span - pre), db = -60 * tt / rt; pts.push([x0 + (k / 80) * (W - 10 - (x0 - 6)), 4 + (clamp(-db, 0, 60) / 60) * (H - 20)]); }
    path(g, pts, CY, H - 16, 1.6); g.fillStyle = '#fff'; g.fillRect(6, 4, 2, H - 20);
    txt(g, `RT60 \u2248 ${rt.toFixed(1)} s`, W - 4, 12, 'right', '#cfcfd2', 10); txt(g, span.toFixed(1) + ' s', W - 3, H - 3, 'right');
  };
  draw(); return { el: h('div', { class: 'fv' }, cv), draw, width: 216 };
}


// ====================================================================================================
//  Auto Filter / Echo / Roar / Level (Swiss-Army-style meter)
// ====================================================================================================
const bqMag = (b, f, sr) => {                       // |H| of a biquad at frequency f
  const w = TWO_PI * f / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b.b0 + b.b1 * c1 + b.b2 * c2, ni = -(b.b1 * s1 + b.b2 * s2), dr = 1 + b.a1 * c1 + b.a2 * c2, di = -(b.a1 * s1 + b.a2 * s2);
  return Math.sqrt((nr * nr + ni * ni) / Math.max(1e-12, dr * dr + di * di));
};
const chipRow = (items) => h('div', { class: 'fv-chips' }, items);
const grp = (n, cur, pick) => { const bs = n.map((l, k) => chip(l, k === cur, () => { pick(k); bs.forEach((b, m) => b.classList.toggle('on', m === k)); })); return bs; };

export function autoFilterView(ctx) {
  const { i, di, d, every } = ctx, W = 230, H = 104, cv = vizCanvas(W, H), SR = 48000;
  const fx = (f) => (Math.log(f / 20) / Math.log(1000)) * (W - 8) + 4, xf = (x) => 20 * Math.pow(1000, clamp((x - 4) / (W - 8), 0, 1));
  const gy = (db) => 8 + (1 - (clamp(db, -30, 18) + 30) / 48) * (H - 20);
  let cur = d.params[1];
  const draw = () => {
    const g = begin(cv), p = d.params, bq = new Biquad(), ty = Math.round(p[0]), q = p[3] > 0.5 ? p[2] * 0.8 : p[2];
    for (const db of [-24, -12, 0, 12]) hl(g, gy(db), 0, W);
    for (const f of [100, 1000, 10000]) { vl(g, fx(f), 0, H - 12); txt(g, f >= 1000 ? f / 1000 + 'k' : f + '', fx(f) + 2, H - 2); }
    if (ty === 0) bq.lowpass(SR, p[1], q); else if (ty === 1) bq.highpass(SR, p[1], q); else if (ty === 2) bq.bandpass(SR, p[1], q); else bq.notch(SR, p[1], q);
    const pts = []; for (let x = 4; x <= W - 4; x += 2) { const f = xf(x); let m = bqMag(bq, f, SR); if (p[3] > 0.5) m *= m; pts.push([x, gy(20 * Math.log10(m + 1e-6))]); }
    path(g, pts, CY, H - 12, 1.7);
    const x0 = fx(p[1]); g.beginPath(); g.arc(x0, gy(0) + (ty === 3 ? 0 : 0), 5, 0, TWO_PI); g.strokeStyle = OR; g.lineWidth = 1.8; g.stroke();
    if (cur > 20 && Math.abs(cur - p[1]) > p[1] * 0.01) { g.beginPath(); g.arc(fx(cur), gy(0), 3.2, 0, TWO_PI); g.fillStyle = OR; g.fill(); }
  };
  let drag = false;
  const move = (e) => {
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width), y = (e.clientY - r.top) * (H / r.height);
    const pf = DEVICES[1].params[1], pq = DEVICES[1].params[2];
    P.setDeviceParam(i, di, 1, clamp(xf(x), pf.min, pf.max)); P.setDeviceParam(i, di, 2, clamp(pq.min * Math.pow(pq.max / pq.min, 1 - clamp((y - 8) / (H - 20), 0, 1)), pq.min, pq.max));
    ctx.refreshKnobs && ctx.refreshKnobs(); draw();
  };
  cv.style.touchAction = 'none';
  cv.addEventListener('pointerdown', (e) => { drag = true; cv.setPointerCapture(e.pointerId); move(e); });
  cv.addEventListener('pointermove', (e) => { if (drag) move(e); });
  cv.addEventListener('pointerup', () => { drag = false; }); cv.addEventListener('pointercancel', () => { drag = false; });
  const types = grp(['LP', 'HP', 'BP', 'Notch'], Math.round(d.params[0]), (k) => { P.setDeviceParam(i, di, 0, k); draw(); });
  const slope = grp(['12', '24'], Math.round(d.params[3]), (k) => { P.setDeviceParam(i, di, 3, k); draw(); });
  const shapes = grp(['Sin', 'Tri', 'Saw', 'Sq', 'S&H'], Math.round(d.params[9]), (k) => P.setDeviceParam(i, di, 9, k));
  draw(); every(60, () => { const o = eng.devOut(i, di); if (Array.isArray(o) && o.length > 1 && (d.params[4] !== 0 || d.params[7] > 0)) { cur = o[0]; draw(); } });
  return { el: h('div', { class: 'fv' }, cv, chipRow([...types, ...slope]), chipRow(shapes)), draw, width: 246 };
}

export function echoView(ctx) {
  const { d, every } = ctx, i = ctx.i, di = ctx.di, W = 250, H = 92, cv = vizCanvas(W, H), fc = vizCanvas(W, 40);
  const DIVB = [0.25, 0.5, 1, 2, 4, 1 / 6, 1 / 3, 2 / 3], DN = ['1/16', '1/8', '1/4', '1/2', '1 bar', '1/16T', '1/8T', '1/4T'];
  const times = () => { const p = d.params, spb = 60000 / P.state.bpm, l = p[8] > 0.5 ? DIVB[Math.round(p[9])] * spb : p[0]; return [l, p[7] > 0.5 ? l : (p[8] > 0.5 ? DIVB[Math.round(p[10])] * spb : p[6])]; };
  const draw = () => {
    const g = begin(cv), p = d.params, [tl, tr] = times(), fb = p[1], pp = p[3] > 0.5, span = Math.min(8000, Math.max(tl, tr) * 7), cx = W / 2, cy = H - 8;
    g.fillStyle = '#fff'; g.fillRect(cx - 1, cy - (H - 14), 2, H - 14);
    let a = 1, n = 1;
    while (a > 0.03 && n < 24) {
      for (const [t, col, ph] of [[tl, OR, 0], [tr, CY, 1]]) {
        const rad = (t * n / span) * (cx - 6); if (rad > cx - 4) { a = 0; break; }
        const side = pp ? (n % 2 ? 0 : 1) : ph; if (!pp && ph === 1 && Math.abs(tl - tr) < 1) continue;
        g.beginPath(); g.arc(cx, cy, rad, Math.PI, 0); g.strokeStyle = pp ? (side ? CY : OR) : col; g.globalAlpha = clamp(a * 1.4, 0.15, 1); g.lineWidth = 1.5; g.stroke(); g.globalAlpha = 1;
        if (pp) break;
      }
      a *= Math.max(0.03, fb); n++;
    }
    txt(g, p[8] > 0.5 ? `L ${DN[Math.round(p[9])]}  R ${p[7] > 0.5 ? DN[Math.round(p[9])] : DN[Math.round(p[10])]}` : `L ${Math.round(tl)} ms  R ${Math.round(tr)} ms`, 4, 11);
    // filter band
    const gf = begin(fc), hp = new Biquad(), lp = new Biquad(); hp.highpass(48000, p[5], 0.707); lp.lowpass(48000, p[4], 0.707);
    const pts = []; for (let x = 4; x < W - 4; x += 2) { const f = 20 * Math.pow(1000, (x - 4) / (W - 8)); pts.push([x, 34 - clamp(bqMag(hp, f, 48000) * bqMag(lp, f, 48000), 0, 1.2) * 28]); }
    path(gf, pts, CY, 36, 1.5); txt(gf, `HP ${Math.round(p[5])}`, 4, 11); txt(gf, `LP ${p[4] >= 1000 ? (p[4] / 1000).toFixed(1) + 'k' : Math.round(p[4])}`, W - 4, 11, 'right');
  };
  const b = (k, label) => chip(label, d.params[k] > 0.5, (e, el) => { P.setDeviceParam(i, di, k, d.params[k] > 0.5 ? 0 : 1); el.classList.toggle('on', d.params[k] > 0.5); draw(); });
  const divBtn = (k, name) => { const el = chip('', false, (e) => { const r = el.getBoundingClientRect(); menu(DN.map((l, m) => ({ label: l, check: Math.round(d.params[k]) === m, fn: () => { P.setDeviceParam(i, di, k, m); lab(); draw(); } })), r.left, r.bottom); }, 'wide'); const lab = () => { el.textContent = `${name} ${DN[Math.round(d.params[k])]}`; }; lab(); return el; };
  draw(); every(250, draw);
  return { el: h('div', { class: 'fv' }, cv, fc, chipRow([b(8, 'Sync'), b(7, 'Link'), b(3, 'Ping-Pong'), divBtn(9, 'L'), divBtn(10, 'R')])), draw, width: 266 };
}

const roarShape = (t, x) => { switch (t) { case 0: return Math.tanh(x); case 1: return clamp(x, -1, 1); case 2: { let u = (x + 1) * 0.25; u -= Math.floor(u); return 1 - Math.abs(u * 4 - 2); } case 3: return Math.sin(clamp(x, -3, 3) * 0.94); case 4: return Math.round(clamp(x, -1, 1) * 6) / 6; default: return Math.tanh(x); } };
export function roarView(ctx) {
  const { d } = ctx, i = ctx.i, di = ctx.di, W = 200, H = 100, cv = vizCanvas(W, H);
  const draw = () => {
    const g = begin(cv), p = d.params, t = Math.round(p[0]), dr = Math.pow(10, p[1] / 20), a = p[6], mix = p[3], bias = p[5] * 0.5, out = Math.pow(10, p[4] / 20);
    const X = (x) => W / 2 + x * (W / 2 - 6), Y = (y) => H / 2 - clamp(y, -1.2, 1.2) * (H / 2 - 6), nrm = t === 0 ? 1 / Math.tanh(Math.max(dr, 1)) : 1;
    hl(g, H / 2, 0, W, '#3a3a3e'); vl(g, W / 2, 0, H, '#3a3a3e'); path(g, [[X(-1), Y(-1)], [X(1), Y(1)]], '#555', null, 1);
    const pts = []; for (let k = -1; k <= 1.0001; k += 0.01) { const w = (roarShape(t, k * dr + bias) - roarShape(t, bias)) * nrm * a + k * (1 - a); pts.push([X(k), Y((k * (1 - mix) + w * mix) * out * 1.6)]); }
    path(g, pts, CY, null, 2);
    if (p[7] > 0.01) txt(g, `Feedback ${Math.round(p[7] * 100)}%  ${p[8] < 10 ? p[8].toFixed(1) : Math.round(p[8])} ms`, 4, H - 4, 'left', CY, 9);
  };
  const bs = grp(['Soft', 'Hard', 'Fold', 'Sine', 'Bit', 'Noise'], Math.round(d.params[0]), (k) => { P.setDeviceParam(i, di, 0, k); draw(); });
  draw(); return { el: h('div', { class: 'fv' }, cv, chipRow(bs)), draw, width: 216 };
}

export function levelView(ctx) {
  const { i, di, d, every } = ctx, W = 400, H = 116, cv = vizCanvas(W, H);
  if (d.target === undefined || d.tpMax === undefined) { const t = TARGETS[0]; d.target = d.target ?? t.lufs; d.tpMax = d.tpMax ?? t.tp; d.tname = d.tname || t.name; }
  let lastO = null;
  const bar = (g, x, db, col) => { const bw = 14, top = 8, bh = H - 22, t = clamp((db + 60) / 60, 0, 1); g.fillStyle = '#26262b'; g.fillRect(x, top, bw, bh); const gr = g.createLinearGradient(0, top + bh, 0, top); gr.addColorStop(0, '#2fae5a'); gr.addColorStop(0.75, '#a8d040'); gr.addColorStop(0.9, '#e8d040'); gr.addColorStop(1, RD); g.fillStyle = gr; g.fillRect(x, top + bh * (1 - t), bw, bh * t); };
  const draw = (o) => {
    const g = begin(cv); if (!o) o = lastO;
    const gn = o ? o[10] : 0, ok = (x) => x > -99, add = (x) => (ok(x) ? x + gn : x);
    // numbers
    const rows = [['Short Term', o ? add(o[1]) : -100, '#e6e6ea'], ['Integrated', o ? add(o[2]) : -100, '#e6e6ea'], ['True Peak', o ? add(o[4]) : -100, o && ok(o[4]) && add(o[4]) > d.tpMax ? RD : '#e6e6ea']];
    rows.forEach(([l, v, col], k) => { txt(g, l, 6, 14 + k * 30, 'left', '#8b8b92', 8.5); txt(g, ok(v) ? v.toFixed(1) : '\u2014', 6, 30 + k * 30, 'left', col, 15, '600'); });
    if (o && ok(o[1]) && ok(o[4])) txt(g, `PSR ${(add(o[4]) - add(o[1])).toFixed(1)}   PLR ${ok(o[2]) ? (add(o[4]) - add(o[2])).toFixed(1) : '\u2014'}`, 6, H - 5, 'left', '#8b8b92', 8.5);
    vl(g, 96, 4, H - 4, '#303035');
    // peak bars L / R
    bar(g, 104, o ? add(o[8]) : -100); bar(g, 122, o ? add(o[9]) : -100);
    for (const db of [0, -6, -12, -24, -48]) { const y = 8 + (H - 22) * (1 - (db + 60) / 60); hl(g, y, 104, 136, '#00000066'); txt(g, db + '', 138, y + 3, 'left', '#6c6c74', 7.5); }
    vl(g, 160, 4, H - 4, '#303035');
    // goniometer
    const cx = 220, cy = H / 2, R = 48; g.beginPath(); g.arc(cx, cy, R, 0, TWO_PI); g.strokeStyle = '#303035'; g.lineWidth = 1; g.stroke();
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke(); txt(g, 'L', cx - R * 0.72 - 3, cy - R * 0.72, 'right', '#6c6c74', 8); txt(g, 'R', cx + R * 0.72 + 3, cy - R * 0.72, 'left', '#6c6c74', 8);
    if (o && o.length >= 140) { g.fillStyle = GN; g.globalAlpha = 0.75; for (let k = 0; k < 64; k++) { const sx = o[12 + k * 2], my = o[13 + k * 2]; g.fillRect(cx + clamp(sx * 2.4, -1, 1) * R, cy - clamp(my * 1.7, -1, 1) * R, 2, 2); } g.globalAlpha = 1; }
    vl(g, 276, 4, H - 4, '#303035');
    // spectrum
    if (o && o.length >= 188) for (let b = 0; b < 48; b++) { const t = clamp((o[140 + b] + 90) / 80, 0, 1), bw = (W - 284) / 48, hh = t * (H - 14); g.fillStyle = `hsl(${200 - t * 90},80%,${38 + t * 22}%)`; g.fillRect(282 + b * bw, H - 6 - hh, bw - 0.6, hh); }
    txt(g, '30', 282, H - 0.5, 'left', '#6c6c74', 7); txt(g, '18k', W - 3, H - 0.5, 'right', '#6c6c74', 7);
  };
  const tname = chip('', false, (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    menu(TARGETS.map((t) => ({ label: `${t.name}  (${t.lufs} LUFS / ${t.tp} dBTP)`, check: d.target === t.lufs && d.tpMax === t.tp && d.tname === t.name, fn: () => { d.target = t.lufs; d.tpMax = t.tp; d.tname = t.name; tname.textContent = label(); draw(); } })), r.left, r.top - 200);
  }, 'wide');
  const label = () => `${d.target} LUFS \u2022 ${d.tpMax} dBTP`; tname.textContent = label();
  const match = chip('Match gain', false, () => { if (!lastO || lastO[2] <= -99) return; P.setDeviceParam(i, di, 1, Math.round(clamp(d.target - lastO[2], -24, 24) * 10) / 10); ctx.refreshKnobs && ctx.refreshKnobs(); });
  const reset = chip('Reset', false, () => { P.setDeviceParam(i, di, 0, (d.params[0] || 0) + 1); });
  draw(null); every(50, () => { const o = eng.devOut(i, di); if (Array.isArray(o) && o.length >= 12) { lastO = o; draw(o); } });
  return { el: h('div', { class: 'fv' }, cv, chipRow([tname, match, reset])), draw: () => draw(null), width: 416 };
}

// device type -> factory
export const FXVIEW = { 1: autoFilterView, 2: eq3View, 3: (c) => curveView(c, 'sat'), 4: compressorView, 5: limiterView, 6: echoView, 7: reverbView, 8: peqView, 9: roarView, 10: duckView, 12: levelView, 13: analyzerView, 14: stereolizerView, 15: spacerView };
