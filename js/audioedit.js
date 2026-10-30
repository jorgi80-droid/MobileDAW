// Audio editor for the selected audio clip: big waveform, draggable start / end / fade handles (non-destructive),
// cursor with split, normalise, reverse, warp to tempo, pitch shift, fades, level.
import { attachGestures } from './gesture.js';
import { h, menu, toast, bar, clamp, modal, ask, slider } from './ui.js';
import { C } from './theme.js';
import { wavePath, peaksPath } from './waveform.js';
import { checkpoint } from './history.js';
import * as P from './project.js';
const { state, PPQ } = P;

const RULER = 16, GRIP = 16;
let root = null, wave, ov, ctx, octx, stage, info, tools, W = 0, H = 0, dpr = 1, dirty = true, cursor = null, lastHead = -1e9, headDirty = true, drag = null;
const v = { x0: 0, pps: 100 };
let themeBound = false, ro = null;
let ref = null;                                             // { track, clip }

const secPerTick = () => 60 / (state.bpm * PPQ);
const eff = (c) => c.dsample || c.sample;
const region = (c) => { const o = c.offset || 0, e = Math.min(eff(c).duration, o + (P.loopOf(c) || c.len) * secPerTick()); return [o, e]; };
const xs = (t) => (t - v.x0) * v.pps;
const tsec = (x) => v.x0 + x / v.pps;
const cur = () => { const r = P.selectedClip(); return r && state.tracks[r.track].kind === 'audio' ? r : null; };

function fitView(c) { const D = eff(c).duration; v.pps = Math.max(5, (W - 20) / D); v.x0 = -10 / v.pps; }
function clampView(c) {
  const D = eff(c).duration;
  v.pps = clamp(v.pps, Math.max(2, (W - 20) / D * 0.5), 60000);
  v.x0 = clamp(v.x0, -20 / v.pps, Math.max(0, D - (W - 20) / v.pps) + 20 / v.pps);
}


// A fully saturated clip colour (pure red, lime...) glares as a big waveform: pull saturation and lightness down a little.
function toneDown(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex;
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g2 = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g2, b), mn = Math.min(r, g2, b), l = (mx + mn) / 2, d = mx - mn;
  let hh = 0, ss = 0;
  if (d) { ss = d / (1 - Math.abs(2 * l - 1)); hh = mx === r ? ((g2 - b) / d) % 6 : mx === g2 ? (b - r) / d + 2 : (r - g2) / d + 4; hh *= 60; if (hh < 0) hh += 360; }
  return `hsl(${Math.round(hh)} ${Math.round(ss * 62)}% ${Math.round(Math.min(l, 0.62) * 88)}%)`;
}
// ------------------------------------------------------------------ drawing
function draw() {
  const r = cur(); if (!r || !W) return;
  const c = r.clip, e0 = eff(c), D = e0.duration, pk = e0.peaks || [];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C('#202022'); ctx.fillRect(0, 0, W, H);
  const top = RULER, hh = H - RULER, mid = top + hh / 2;
  // ruler: adaptive seconds
  ctx.fillStyle = C('#2c2c2f'); ctx.fillRect(0, 0, W, RULER); ctx.fillStyle = C('#141415'); ctx.fillRect(0, RULER - 1, W, 1);
  const steps = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60], stp = steps.find((s) => s * v.pps >= 60) || 60;
  ctx.fillStyle = C('#9a9aa2'); ctx.font = '10px system-ui'; ctx.textBaseline = 'middle';
  for (let t = Math.ceil(v.x0 / stp) * stp; xs(t) < W; t += stp) { const x = Math.round(xs(t)) + 0.5; ctx.fillRect(x, RULER - 5, 1, 5); ctx.fillText(stp < 1 ? t.toFixed(2) + 's' : t.toFixed(stp < 1 ? 2 : 0) + 's', x + 3, RULER / 2); ctx.fillStyle = C('#2c2c30'); ctx.fillRect(x, RULER, 1, hh); ctx.fillStyle = C('#9a9aa2'); }
  ctx.fillStyle = C('#232326'); ctx.fillRect(0, Math.round(top + hh * 0.25), W, 1); ctx.fillRect(0, Math.round(top + hh * 0.75), W, 1);   // faint +/-50% guides
  ctx.fillStyle = C('#3a3a3f'); ctx.fillRect(0, mid, W, 1);
  // waveform: min/max pyramid, drawn as one smooth shape (grey = outside the clip region, track colour = inside)
  const [o, e] = region(c), x0 = Math.round(xs(o)), x1 = Math.round(xs(e));
  const col = toneDown(state.tracks[r.track].color);
  if (e0.pyr || pk.length) {
    const N = e0.pyr ? e0.pyr.l.length : pk.length, geo = { x0: 0, x1: W, s0: v.x0 / D * N, spp: N / D / v.pps, mid, amp: hh * 0.5 * 0.94 };
    const path = e0.pyr ? wavePath(e0.pyr, geo) : peaksPath(pk, geo);
    ctx.fillStyle = C('#5a5a60'); ctx.fill(path);
    ctx.save(); ctx.beginPath(); ctx.rect(Math.max(0, x0), top, Math.max(0, Math.min(W, x1) - Math.max(0, x0)), hh); ctx.clip();
    ctx.fillStyle = col; ctx.fill(path); ctx.restore();
  }
  // outside the region: dim
  ctx.fillStyle = 'rgba(0,0,0,.38)';
  if (x0 > 0) ctx.fillRect(0, top, Math.min(W, x0), hh);
  if (x1 < W) ctx.fillRect(Math.max(0, x1), top, W - x1, hh);
  // fades
  const fi = c.fadeIn || 0, fo = c.fadeOut || 0;
  ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1;
  if (fi > 0) { const fx = xs(o + fi); ctx.beginPath(); ctx.moveTo(x0, top + hh); ctx.lineTo(fx, top); ctx.lineTo(x0, top); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(x0, top + hh); ctx.lineTo(fx, top); ctx.stroke(); }
  if (fo > 0) { const fx = xs(e - fo); ctx.beginPath(); ctx.moveTo(x1, top + hh); ctx.lineTo(fx, top); ctx.lineTo(x1, top); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(x1, top + hh); ctx.lineTo(fx, top); ctx.stroke(); }
  // region brace in the ruler (looped: the repeating piece), Start / End markers as Live's flags, fade handles as small dots
  ctx.fillStyle = state.tracks[r.track].color; ctx.fillRect(Math.max(0, x0), RULER - 4, Math.max(0, Math.min(W, x1) - Math.max(0, x0)), 3);
  ctx.fillStyle = C('#ffa722');
  ctx.fillRect(x0 - 1, top, 2, hh); ctx.fillRect(x1 - 1, top, 2, hh);
  ctx.beginPath(); ctx.moveTo(x0 - 1, top); ctx.lineTo(x0 + 13, top); ctx.lineTo(x0 + 13, top + 11); ctx.lineTo(x0 - 1, top + 15); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x1 + 1, top); ctx.lineTo(x1 - 13, top); ctx.lineTo(x1 - 13, top + 11); ctx.lineTo(x1 + 1, top + 15); ctx.closePath(); ctx.fill();
  ctx.fillStyle = C('#1a1100'); ctx.font = '700 9px system-ui'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText('S', x0 + 6, top + 6.5); ctx.fillText('E', x1 - 6, top + 6.5); ctx.textAlign = 'left';
  for (const fx of [xs(o + fi), xs(e - fo)]) { ctx.beginPath(); ctx.arc(fx, top + 22, 4.5, 0, 6.2832); ctx.fillStyle = C('#ffffff'); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.stroke(); }
  setInfo(c, e0, D, o, e, fi, fo);
}
const stOf = (p) => Math.round(p || 0), ctOf = (p) => Math.round(((p || 0) - Math.round(p || 0)) * 100), pitchOf = (st, ct) => Math.round((st + ct / 100) * 100) / 100;
const gainDb = (g) => (g > 0.0001 ? (g > 1.0005 ? '+' : '') + (20 * Math.log10(g)).toFixed(1) : '-\u221E') + ' dB';
let infoKey = '';
function setInfo(c, e0, D, o, e, fi, fo) {                     // name in bold, then dim label + bright value pairs; rebuilt only when something changed
  const w = c.warp || {};
  const ext = (((e0.path || e0.name || '').split('.').pop()) || '').toUpperCase();
  const items = [['Sample', D.toFixed(2) + ' dtk'], ['Klip', (e - o).toFixed(2) + ' dtk'], ['Mulai', o.toFixed(2)], ['Fade', fi.toFixed(2) + ' / ' + fo.toFixed(2)], ['Level', gainDb(c.gain)]];
  if (ext && ext.length <= 5 && (e0.path || e0.name || '').includes('.')) items.splice(1, 0, ['Format', ext]);
  if (w.pitch) items.push(['Pitch', (stOf(w.pitch) > 0 ? '+' : '') + stOf(w.pitch) + ' st' + (ctOf(w.pitch) ? ' ' + (ctOf(w.pitch) > 0 ? '+' : '') + ctOf(w.pitch) + ' ct' : ''), 1]);
  if (P.loopOf(c)) items.push(['Loop', Math.round(c.len / c.ll * 100) / 100 + 'x', 1]);
  items.push(['Akhir', e.toFixed(2)]);
  if (w.ratio && w.ratio !== 1 || w.pitch) items.push(['Mode warp', 'WSOLA']);
  if (c.srcBpm) items.push(['BPM', c.srcBpm + (c.warpAuto ? ' \u2192 ' + state.bpm : ''), 1]);
  const key = (c.name || e0.name) + '|' + items.map((x) => x[1]).join('|');
  if (key === infoKey) return; infoKey = key;
  info.replaceChildren(h('b', {}, c.name || e0.name), ...items.map(([l, v, hot]) => h('span', { class: hot ? 'hot' : '' }, l, h('i', {}, v))));
}
function drawHead() {
  const r = cur(); octx.setTransform(dpr, 0, 0, dpr, 0, 0); octx.clearRect(0, 0, W, H);
  if (!r) return;
  const c = r.clip, o = c.offset || 0;
  if (cursor !== null) { const x = Math.round(xs(cursor)); octx.fillStyle = 'rgba(255,255,255,.8)'; octx.fillRect(x, RULER, 1, H - RULER); }
  const tick = P.currentTick();
  if (tick >= c.start && tick <= c.start + c.len) { const x = Math.round(xs(o + (tick - c.start) * secPerTick())); octx.fillStyle = C('#ffa722'); octx.fillRect(x, RULER, 2, H - RULER); }
}
export const invalidate = () => { dirty = true; };
export function frame() {
  if (!root || !W) return;
  const r = cur(); if (!r) return;
  if (dirty) { dirty = false; draw(); headDirty = true; }
  const c = r.clip, tick = P.currentTick();
  const x = Math.round(xs((c.offset || 0) + (tick - c.start) * secPerTick()) * dpr) + (cursor === null ? 0 : Math.round(cursor * 1000));
  if (headDirty || x !== lastHead) { lastHead = x; headDirty = false; drawHead(); }
}

// ------------------------------------------------------------------ editing
const touch = (r) => { P.touchClips(r.track); P.emit('notes'); dirty = true; };
function setStart(r, t) {              // move the clip start inside the sample: audio stays where it is on the timeline
  const c = r.clip, [o, e] = region(c), nt = clamp(t, 0, e - 0.02), dTick = (nt - o) / secPerTick();
  c.start = Math.max(0, c.start + dTick); c.len = Math.max(PPQ / 32, Math.round(c.len - dTick)); c.offset = nt;
  if (P.loopOf(c)) c.ll = Math.max(PPQ / 32, Math.round(c.ll - dTick));            // looped clip: the repeating piece shrinks with it
}
const setEnd = (r, t) => {
  const c = r.clip, [o] = region(c), nl = Math.max(PPQ / 32, Math.round((clamp(t, o + 0.02, eff(c).duration) - o) / secPerTick()));
  if (P.loopOf(c)) { const reps = Math.max(2, Math.round(c.len / c.ll)); c.ll = nl; c.len = nl * reps; } else c.len = nl;   // looped: keep the number of repeats
};

async function run(r, opts, okMsg) {
  checkpoint(); toast('Memproses audio\u2026', 9000);
  await new Promise((res) => setTimeout(res, 30));
  const out = await P.setClipAudio(r.track, r.clip.id, opts);
  toast(out.error || okMsg, 2600);
  if (!out.error) { fitView(r.clip); dirty = true; build(); }
}
function peakOf(c) {
  const e0 = eff(c), pk = e0.peaks || [], [o, e] = region(c), D = e0.duration;
  let m = 0; for (let b = Math.floor(o / D * pk.length); b <= Math.min(pk.length - 1, Math.ceil(e / D * pk.length)); b++) if (pk[b] > m) m = pk[b];
  return m;
}

// Live 12 Clip View for audio: the clip's audio settings live in the properties panel on the left (Audio, Pitch, Warp and Region boxes, built
// by panel() with the panel's own controls); the toolbar above the waveform keeps only the view / edit commands.
let panelHook = null;
export const onPanel = (fn) => { panelHook = fn; };
function build() {
  const r = cur(); if (!r) return;
  const c = r.clip, w = c.warp || { ratio: 1, rev: false, beats: 0, pitch: 0 };
  const B = (label, fn, on, cls = '') => h('button', { class: 'b' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), onclick: fn }, label);
  const G = (...kids) => h('div', { class: 'ed-g' }, kids.filter(Boolean));
  tools.replaceChildren(...[
    G(B('Split', () => splitAt(r, cursor)), B('Fit', () => { fitView(c); dirty = true; })),
    (w.rev || w.ratio !== 1 || w.pitch || c.warpAuto) ? G(B('Asli', () => run(r, { reset: true }, 'Klip dikembalikan ke audio asli.'), false, 'reset')) : null,
  ].filter(Boolean));
  if (panelHook) panelHook();
}
// ui = the panel's control factories: { sec(title, ...rows), row(label, ctl), val(text), ch(text, fn(x, y)), sw(text, on, fn), btn(text, fn) }
export function panel(ui) {
  const r = cur(); if (!r || !root) return [];
  const c = r.clip, w = c.warp || { ratio: 1, rev: false, beats: 0, pitch: 0 };
  const dbOf = (g) => (g > 0.004 ? clamp(20 * Math.log10(g), -48, 18) : -48);          // slider works in dB: -inf .. +18 (= the x8 normalise ceiling), 0 dB = unity
  const lvl = slider({ label: 'Gain', min: -48, max: 18, home: 0, step: 0.1, speed: 0.5, value: dbOf(c.gain), width: 172, fmt: (db) => (db <= -48 ? '-∞' : (db > 0 ? '+' : '') + db.toFixed(1)) + ' dB', onStart: () => checkpoint(), onInput: (db) => { c.gain = db <= -48 ? 0 : Math.pow(10, db / 20); touch(r); } });
  const st = stOf(w.pitch), ct = ctOf(w.pitch), sgn = (n) => (n > 0 ? '+' : '') + n;
  const own = c.swing != null && c.swing >= 0, setSw = (v) => { checkpoint(); if (v == null) delete c.swing; else c.swing = v; P.scheduleBake(60); P.emit('clips'); build(); };
  const regionMenu = (x, y) => menu([
    { label: 'Ketik Start (dtk)…', fn: () => ask('Start dalam sample (detik)', +region(c)[0].toFixed(3), (v) => { if (Number.isFinite(v) && v >= 0 && v < region(c)[1] - 0.02) { checkpoint(); setStart(r, v); touch(r); build(); } else toast('Start harus sebelum End dan di dalam sample.'); }, 'number') },
    { label: 'Ketik End (dtk)…', fn: () => ask('End dalam sample (detik)', +region(c)[1].toFixed(3), (v) => { if (Number.isFinite(v) && v > region(c)[0] + 0.02 && v <= eff(c).duration) { checkpoint(); setEnd(r, v); touch(r); build(); } else toast('End harus setelah Start dan di dalam sample.'); }, 'number') },
  ], x, y);
  const [o, e] = region(c);
  return [
    ui.sec('Audio', h('div', { class: 'cp-line cp-full' }, lvl),
      h('div', { class: 'cp-grid g2' },
        ui.btn('Normalisasi', () => { const m = peakOf(c); if (m < 0.001) return toast('Audio terlalu pelan atau kosong.'); checkpoint(); c.gain = Math.min(8, 0.98 / m); touch(r); build(); toast(`Level dinaikkan ke ${gainDb(c.gain)}.`); }),
        ui.sw('Reverse', !!w.rev, () => run(r, { rev: !w.rev }, w.rev ? 'Kembali normal.' : 'Klip dibalik.')),
        ui.btn('Fade…', (ev) => { const q = ev.currentTarget.getBoundingClientRect(); menu([['Tanpa fade', 0], ['10 ms', 0.01], ['50 ms', 0.05], ['200 ms', 0.2], ['1 detik', 1]].map(([l, sc]) => ({ label: l, fn: () => { checkpoint(); const [o2, en] = region(c), mx = (en - o2) / 2; c.fadeIn = Math.min(sc, mx); c.fadeOut = Math.min(sc, mx); touch(r); } })), q.left, q.bottom + 2); }))),
    ui.sec('Pitch',
      ui.row('Transpose', ui.ch(sgn(st) + ' st', (x, y) => menu(Array.from({ length: 25 }, (_, k) => k - 12).map((v) => ({ label: sgn(v) + ' semitone', check: st === v, fn: () => run(r, { pitch: pitchOf(v, ct) }, `Transpose ${sgn(v)} semitone.`) })), x, y))),
      ui.row('Detune', ui.ch(sgn(ct) + ' ct', (x, y) => menu([-50, -25, -10, -5, 0, 5, 10, 25, 50].map((v) => ({ label: sgn(v) + ' cent', check: ct === v, fn: () => run(r, { pitch: pitchOf(st, v) }, `Detune ${sgn(v)} cent.`) })), x, y)))),
    ui.sec('Warp',
      h('div', { class: 'cp-line' }, ui.sw('Sync', !!c.warpAuto, () => quickSync(r)), ui.btn(c.srcBpm ? (+c.srcBpm.toFixed(2)) + ' BPM' : 'BPM…', () => bpmPanel(r))),
      ui.row('Regangkan', ui.ch(w.beats ? w.beats + ' beat' : 'Mati', (x, y) => menu([1, 2, 4, 8, 16].map((b) => ({ label: `Regangkan ke ${b} beat`, check: w.beats === b, fn: () => run(r, { beats: b }, `Di-warp ke ${b} beat pada ${state.bpm} BPM.`) })), x, y))),
      w.beats && !c.warpAuto ? h('div', { class: 'cp-line' }, ui.btn('Sesuaikan tempo', () => { checkpoint(); P.retempoClip(r.track, c.id).then((q) => { toast(q.error || 'Warp disesuaikan dengan tempo sekarang.'); fitView(c); dirty = true; build(); }); })) : null,
      P.gridLocked(c) ? ui.row('Groove', ui.ch(Math.round(P.swingOf(c) * 100) + '%' + (own ? '' : ' global'), (x, y) => menu([{ label: 'Ikuti swing global (' + Math.round(state.groove.amt * 100) + '%)', check: !own, fn: () => setSw(null) },
        ...[0, 25, 50, 60, 75, 100].map((q) => ({ label: q + '%', check: own && Math.round(c.swing * 100) === q, fn: () => setSw(q / 100) }))], x, y))) : null),
    ui.sec('Region',
      ui.row('Start', ui.ch(o.toFixed(2) + ' s', regionMenu)), ui.row('End', ui.ch(e.toFixed(2) + ' s', regionMenu)),
      ui.row('Loop', ui.ch(P.loopOf(c) ? Math.round(c.len / c.ll * 100) / 100 + 'x' : 'Mati', (x, y) => menu([{ label: 'Loop mati', check: !P.loopOf(c), fn: () => { checkpoint(); P.setAudioLoop(r.track, c.id, 1); toast('Loop dimatikan.'); fitView(c); dirty = true; build(); } },
        ...[2, 4, 8, 16].map((n) => ({ label: `Ulangi ${n}x`, check: P.loopOf(c) && Math.round(c.len / c.ll) === n, fn: () => { checkpoint(); P.setAudioLoop(r.track, c.id, n); toast(`Klip diulang ${n}x.`); fitView(c); dirty = true; build(); } }))], x, y)))),
  ];
}
// ------------------------------------------------------------------ sample tempo: detect, edit, sync to the project
const live = (id) => { const q = cur(); return q && q.clip.id === id ? q : null; };
const tick0 = () => new Promise((res) => setTimeout(res, 30));
function afterTempoChange(r) { const q = cur(); if (!q) return; fitView(q.clip); dirty = true; build(); }

async function quickSync(r) {
  const c = r.clip;
  if (c.warpAuto) { checkpoint(); const out = await P.unsyncClip(r.track, c.id); toast(out.error || 'Sync dimatikan, klip kembali ke tempo aslinya.'); afterTempoChange(r); return; }
  checkpoint(); toast('Mendeteksi tempo\u2026', 6000); await tick0();
  if (!(c.srcBpm > 0)) { const d = P.detectClipBpm(r.track, c.id); if (d.error) return toast(d.error, 4200); P.setClipSrcBpm(r.track, c.id, d.bpm); }
  const out = await P.syncClipToTempo(r.track, c.id, c.srcBpm, true);
  toast(out.error || `Disamakan: ${+c.srcBpm.toFixed(2)} \u2192 ${state.bpm} BPM.`, out.error ? 4500 : 2600);
  afterTempoChange(r);
}

function bpmPanel(r) {
  const id = r.clip.id; let taps = [], det = null;
  const big = h('div', { class: 'tp-big' }), note = h('div', { class: 'info' });
  const swBtn = h('button', { class: 'b' }, ''), syncB = h('button', { class: 'b tp-tap' }, '');
  const paint = () => {
    const q = live(id); if (!q) return; const c = q.clip;
    big.textContent = c.srcBpm ? (+c.srcBpm.toFixed(2)).toFixed(2) : '\u2014';
    syncB.textContent = `Sync ke ${state.bpm} BPM`;
    swBtn.textContent = c.warpAuto ? 'Aktif' : 'Mati'; swBtn.classList.toggle('on', !!c.warpAuto);
    if (det && det.error) note.textContent = det.error;
    else if (det) note.textContent = `Terdeteksi ${det.bpm} BPM${det.exact ? `, panjang pas ${Math.round(det.beats)} beat` : ''}, keyakinan ${Math.round(det.conf * 100)}%. Kalau terdengar dua kali lipat atau setengah dari aslinya, pakai \u00D72 atau \u00F72.`;
    else note.textContent = c.srcBpm ? 'Sync meregangkan audio ke tempo proyek tanpa mengubah pitch.' : 'BPM sample belum diketahui: tekan Deteksi, ketuk sesuai ketukan, atau ketik manual.';
  };
  const apply = async (v) => {                                      // set the sample BPM; a synced clip re-stretches at once
    const q = live(id); if (!q) return toast('Klip tidak ada lagi.');
    checkpoint(); P.setClipSrcBpm(q.track, id, v);
    if (q.clip.warpAuto && q.clip.srcBpm) { const out = await P.syncClipToTempo(q.track, id, q.clip.srcBpm, true); if (out.error) toast(out.error, 4500); }
    afterTempoChange(q); paint();
  };
  const run = (label, fn, cls = '') => h('button', { class: 'b ' + cls, onclick: fn }, label);
  const detect = async () => { note.textContent = 'Menganalisis\u2026'; await tick0(); const q = live(id); if (!q) return; det = P.detectClipBpm(q.track, id); if (!det.error) await apply(det.bpm); paint(); };
  syncB.onclick = async () => {
    const q = live(id); if (!q) return;
    if (!(q.clip.srcBpm > 0)) { await detect(); if (!(live(id) && live(id).clip.srcBpm > 0)) return; }
    const q2 = live(id); checkpoint(); note.textContent = 'Meregangkan audio\u2026'; await tick0();
    const out = await P.syncClipToTempo(q2.track, id, q2.clip.srcBpm, true);
    toast(out.error || 'Klip disamakan dengan tempo proyek.', out.error ? 4500 : 2200); afterTempoChange(q2); paint();
  };
  swBtn.onclick = async () => {
    const q = live(id); if (!q) return; const c = q.clip;
    if (c.warpAuto) { c.warpAuto = false; P.emit('clips'); }
    else if (c.srcBpm > 0) { checkpoint(); const out = await P.syncClipToTempo(q.track, id, c.srcBpm, true); if (out.error) toast(out.error, 4500); afterTempoChange(q); }
    else toast('Isi BPM sample dulu (Deteksi / Tap / Ketik).');
    paint();
  };
  const body = h('div', { class: 'bpmp' },
    h('div', { class: 'tp-disp' }, big, h('div', { class: 'tp-unit' }, 'BPM sample')),
    h('div', { class: 'row' }, run('Deteksi', detect), run('\u00F7 2', () => { const q = live(id); if (q && q.clip.srcBpm) apply(q.clip.srcBpm / 2); }), run('\u00D7 2', () => { const q = live(id); if (q && q.clip.srcBpm) apply(q.clip.srcBpm * 2); }),
      run('Tap', () => { const now = performance.now(); if (taps.length && now - taps[taps.length - 1] > 2200) taps = []; taps.push(now); if (taps.length > 8) taps.shift(); if (taps.length >= 2) { det = null; apply(Math.round(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)) * 10) / 10); } }),
      run('Ketik', () => ask('BPM sample', live(id) && live(id).clip.srcBpm || state.bpm, (v) => { if (Number.isFinite(v) && v >= 20 && v <= 400) { det = null; apply(v); } else toast('BPM sample harus 20 sampai 400.'); }, 'number'))),
    note,
    h('div', { class: 'row' }, syncB),
    h('div', { class: 'sw' }, h('span', { style: 'flex:1' }, 'Ikuti tempo proyek otomatis'), swBtn),
    h('div', { class: 'row' }, run('Lepas sync (audio asli)', async () => { const q = live(id); if (!q) return; checkpoint(); const out = await P.unsyncClip(q.track, id); toast(out.error || 'Kembali ke audio asli.'); afterTempoChange(q); paint(); })));
  paint();
  modal('Tempo sample', body, [{ label: 'Selesai', go: true }]);
}

function splitAt(r, t) {
  const c = r.clip, [o, e] = region(c);
  const sec = t !== null && t > o + 0.01 && t < e - 0.01 ? t : null;
  if (sec === null) return toast('Ketuk waveform untuk menaruh kursor di titik pemisah.');
  checkpoint(); P.splitClip(r.track, c.id, Math.round(c.start + (sec - o) / secPerTick()));
  toast('Klip dipisah di kursor.'); cursor = null; refresh();
}

// ------------------------------------------------------------------ gestures
function hit(x, y) {
  const r = cur(); if (!r) return null;
  const c = r.clip, [o, e] = region(c), x0 = xs(o), x1 = xs(e), top = RULER;
  const fi = xs(o + (c.fadeIn || 0)), fo = xs(e - (c.fadeOut || 0));
  if (Math.abs(x - fi) < 16 && y > top + 10 && y < top + 34) return { k: 'fi' };   // fade dots sit just under the Start / End flags
  if (Math.abs(x - fo) < 16 && y > top + 10 && y < top + 34) return { k: 'fo' };
  if (Math.abs(x - x0) < GRIP) return { k: 'hs' };
  if (Math.abs(x - x1) < GRIP) return { k: 'he' };
  return { k: 'wave' };
}
function handlers() {
  return {
    hit,
    tap(x, y, t) {
      const r = cur(); if (!r || !t) return;
      cursor = clamp(tsec(x), 0, eff(r.clip).duration); dirty = true; headDirty = true;
      const q = ov.getBoundingClientRect();
      bar([{ label: 'Split di sini', fn: () => splitAt(r, cursor) }, { label: 'Awal di sini', fn: () => { checkpoint(); setStart(r, cursor); touch(r); } }, { label: 'Akhir di sini', fn: () => { checkpoint(); setEnd(r, cursor); touch(r); } },
        { label: 'Putar dari sini', fn: () => { const c = r.clip; P.seekTo(Math.max(0, c.start + (cursor - (c.offset || 0)) / secPerTick())); P.play(); } }], q.left + clamp(x - 130, 4, W - 300), q.top + Math.max(RULER + 4, y - 44));
    },
    dragStart(x0, y0, t) { if (t && t.k !== 'wave') { checkpoint(); drag = t.k; return true; } return false; },
    drag(x) {
      const r = cur(); if (!r || !drag) return;
      const c = r.clip, t = clamp(tsec(x), 0, eff(c).duration), [o, e] = region(c);
      if (drag === 'hs') setStart(r, t); else if (drag === 'he') setEnd(r, t);
      else if (drag === 'fi') c.fadeIn = clamp(t - o, 0, (e - o) * 0.9); else if (drag === 'fo') c.fadeOut = clamp(e - t, 0, (e - o) * 0.9);
      touch(r);
    },
    dragEnd() { drag = null; },
    pan(dx) { const r = cur(); if (!r) return; v.x0 -= dx / v.pps; clampView(r.clip); dirty = true; },
    pinch(cx, cy, sx) { const r = cur(); if (!r) return; const t = tsec(cx); v.pps *= sx; v.x0 = t - cx / v.pps; clampView(r.clip); dirty = true; },
    wheel(e, p) { const r = cur(); if (!r) return; const t = tsec(p.x); v.pps *= Math.exp(-e.deltaY * 0.002); v.x0 = t - p.x / v.pps; clampView(r.clip); dirty = true; },
  };
}

function fit() {
  if (!stage) return;
  const q = stage.getBoundingClientRect();
  const nd = Math.min(window.devicePixelRatio || 1, 3), nw = Math.round(q.width), nh = Math.round(q.height);
  if (nw < 2 || nh < 2 || (nw === W && nh === H && nd === dpr)) return;
  dpr = nd; W = nw; H = nh;
  for (const cv of [wave, ov]) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
  const r = cur(); if (r) clampView(r.clip);
  dirty = true; frame();
}

export function mount(host) {
  const r = cur(); if (!r) return;
  root = h('div', { style: 'position:absolute;inset:0;display:flex;flex-direction:column' });
  tools = h('div', { class: 'ed-tools' });
  info = h('div', { class: 'ae-info' });
  stage = h('div', { class: 'cv-wrap', style: 'flex:1;min-height:0' });
  wave = h('canvas', {}); ov = h('canvas', {});
  stage.append(wave, ov); root.append(tools, info, stage);
  host.replaceChildren(root);
  ctx = wave.getContext('2d', { alpha: false }); octx = ov.getContext('2d');
  attachGestures(ov, handlers());
  if (ro) ro.disconnect();                        // mount() runs every time a clip is opened: do not stack observers / listeners
  ro = new ResizeObserver(fit); ro.observe(stage);
  if (!themeBound) { window.addEventListener('themechange', invalidate); themeBound = true; }
  W = 0; H = 0; cursor = null; dirty = true; infoKey = '';
  build(); fit(); fitView(r.clip); dirty = true; frame();
}
export function refresh() { const r = cur(); if (!r || !root || !root.isConnected) return false; build(); dirty = true; return true; }
export const unmount = () => { root = null; };
