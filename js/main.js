// Boot + wiring: transport, views, detail tabs, resizable panel, main frame loop.
import { shouldDraw, recordCost } from './fps.js';
import { $, h, setIcon, menu, ask, modal, toast, closeAll, clamp } from './ui.js';
import { eng, MASTER, hasNative, backend, backendError } from './engine.js';
import { prefs, savePrefs } from './prefs.js';
import { initLayout } from './layout.js';
import { initFloat } from './floatwin.js';
import { initEdgeGuard } from './edgeguard.js';
import { applyTheme, C } from './theme.js';
import { enableMidi } from './midi.js';
import { openSettings, toggleFullscreen, initAutoFullscreen, initUiPrefs } from './settingsui.js';
import { initLog, log } from './log.js';
import * as FS from './storage.js';
import { initPwa, isStandalone } from './pwa.js';
import { isNativeApp, initNative, setAwake } from './native.js';
import * as P from './project.js';
import { checkpoint, clearHistory, canUndo, canRedo, undoOp, redoOp } from './history.js';
import * as TL from './timeline.js';
import * as ED from './editor.js';
import * as DV from './devices.js';
import * as KB from './keys.js';
import * as MX from './mixer.js';
import * as BR from './browser.js';
import { initTopbar, topbarUpdate } from './topbar.js';
import { startAutosave, restore, saveNow } from './autosave.js';
import { makeZip } from './zip.js';
import * as Tempo from './tempo.js';
import { exportMidi, importMidi } from './midiio.js';
const { state } = P;

let view = 'arr', tab = 'dev';
const panes = {};

// ------------------------------------------------------------------ transport + readouts
function icons() {
  for (const [id, n] of [['browser', 'list'], ['play', 'play'], ['stop', 'stop'], ['rew', 'rew'], ['rec', 'rec'], ['metro', 'metro'], ['undo', 'undo'], ['redo', 'redo'], ['menu', 'menu']]) setIcon($('#btn-' + id), n);
}
function tapTempo() { const b = openTapChip(); return b; }
function openTapChip() { const b = Tempo.tapPress(); if (b) toast(b.toFixed(1) + ' BPM', 900); return b; }
function wireTransport() {
  $('#btn-play').onclick = () => P.togglePlay();
  $('#btn-stop').onclick = async () => { if (P.rec.on) { await toggleRec(); return; } if (!state.playing) P.seekTo(0); P.stop(); };
  $('#btn-rew').onclick = () => P.seekTo(0);
  $('#btn-rec').onclick = toggleRec;
  {   // tap = metronome on/off, hold = count-in, record in loop, punch in/out
    const b = $('#btn-metro'); let tmr = 0, long = false;
    const openMenu = () => {
      long = true; const r = b.getBoundingClientRect(), q = state.punch;
      menu([
        ...[[0, 'Count-in: mati'], [1, 'Count-in: 1 bar'], [2, 'Count-in: 2 bar'], [4, 'Count-in: 4 bar']].map(([n, label]) => ({ label, check: state.countIn === n, fn: () => P.setCountIn(n) })),
        { sep: true },
        { label: 'Punch-in/out', check: q.on, fn: () => P.setPunch({ on: !q.on }) },
      ], r.left, r.bottom + 4);
    };
    b.addEventListener('pointerdown', () => { long = false; clearTimeout(tmr); tmr = setTimeout(openMenu, 450); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(tmr));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    b.onclick = () => { if (long) { long = false; return; } P.toggleMetro(); };
  }
  $('#btn-undo').onclick = undoOp;
  $('#btn-redo').onclick = redoOp;
  $('#btn-browser').onclick = BR.toggleBrowser;
  $('#btn-menu').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    menu([
      { label: 'Urungkan', dim: !canUndo(), fn: undoOp },
      { label: 'Ulangi', dim: !canRedo(), fn: redoOp },
      { label: 'Ke awal', fn: () => P.seekTo(0) },
      { sep: true },
      { label: 'Pengaturan\u2026', fn: openSettings },
      ...(isStandalone() ? [] : [{ label: 'Layar penuh', fn: toggleFullscreen }]),
      { sep: true },
      { label: 'Simpan proyek\u2026', fn: () => BR.openBrowser('proj') },
      { label: 'Buka proyek\u2026', fn: () => BR.openBrowser('proj') },
      { label: 'Demo song\u2026', fn: () => BR.openBrowser('proj') },
      { label: 'Ekspor audio (WAV/MP3/stem)\u2026', fn: exportWav },
      { label: 'Ekspor MIDI (.mid)', fn: exportMidi },
      { label: 'Impor MIDI (.mid)\u2026', fn: importMidi },
      { label: 'Ekspor proyek (.mdaw)', fn: exportMdaw },
      { label: 'Ekspor ZIP (proyek + sample)\u2026', fn: exportZip },
      { label: 'Proyek baru (kosong)', fn: () => modal('Proyek baru', 'Perubahan yang belum disimpan akan hilang.', [{ label: 'Batal' }, { label: 'Buat baru', go: true, fn: () => P.newProject(false) }]) },
      { sep: true },
      { label: 'Tempo\u2026', fn: Tempo.openTempo },
      { label: 'Nama proyek\u2026', fn: () => ask('Nama proyek', state.projectName, (v) => { if (v && v.trim()) state.projectName = v.trim(); }) },
    ], r.left - 150, r.bottom + 2);
  };
  // BPM: drag vertically to change, tap for options
  const bpm = $('#rd-bpm');
  let d = null;
  bpm.addEventListener('pointerdown', (e) => { bpm.setPointerCapture(e.pointerId); d = { y: e.clientY, b: state.bpm, moved: false }; });
  bpm.addEventListener('pointermove', (e) => { if (!d) return; const dy = d.y - e.clientY; if (Math.abs(dy) > 4) d.moved = true; if (d.moved) P.setBpm(Math.round((d.b + dy * 0.25) * 100) / 100); });
  bpm.addEventListener('pointerup', (e) => {
    if (d && !d.moved) Tempo.openTempo();
    d = null;
  });
  bpm.addEventListener('pointercancel', () => { d = null; });
}


// ------------------------------------------------------------------ recording (audio from the microphone, MIDI from keys/pads/controller)
function recMsg(r) {
  if (r.error) return r.error;
  if (r.empty) return r.kind === 'audio' ? 'Tidak ada audio yang terekam.' : 'Tidak ada not yang direkam.';
  const k = r.kind === 'audio' ? 'audio' : 'MIDI';
  return r.takes > 1 ? `${r.takes} take ${k} ditambahkan (hanya take terakhir yang bunyi).` : `Rekaman ${k} ditambahkan sebagai klip.`;
}
async function toggleRec() {
  if (P.rec.on) {
    const r = await P.stopRecording();
    if (!r) return;
    toast(recMsg(r), r.error ? 5000 : 3000);
    return;
  }
  const r = await P.startRecording();
  if (r && r.error) toast(r.error, 5000); else toast('Merekam\u2026 tekan REC lagi atau Stop untuk selesai.', 3000);
}

// ------------------------------------------------------------------ project export: .mdaw (project file) and .zip (project + every sample / SoundFont it uses)
const fileStem = () => (state.projectName || 'Untitled').replace(/[^\w\- ]+/g, '').trim() || 'Untitled';
function exportMdaw() {
  const n = fileStem(), path = eng.home() + '/Projects/' + n + '.mdaw';
  eng.writeText(path, P.serialize()); saveNow();
  if (backend === 'web') setTimeout(() => eng.download(path), 80);
  toast('Proyek diekspor: ' + n + '.mdaw');
}
function usedFiles() {
  const set = new Set();
  for (const t of state.tracks) {
    for (const c of t.clips || []) if (c.sample && c.sample.path) set.add(c.sample.path);
    if (t.inst) { if (t.inst.sf && t.inst.sf.path) set.add(t.inst.sf.path); for (const z of t.inst.zones || []) if (z.sample && z.sample.path) set.add(z.sample.path); }
  }
  return [...set];
}
async function exportZip() {
  if (backend !== 'web') return toast('Ekspor ZIP tersedia di versi web. Di aplikasi Android, salin folder MobileDAW.');
  const n = fileStem(), files = [{ name: n + '.mdaw', data: P.serialize() }], missing = [];
  toast('Membuat ZIP\u2026', 1500);
  for (const p of usedFiles()) {
    const d = await eng.readBytes(p);
    if (d && typeof d !== 'string') files.push({ name: p.replace(/^\/+/, ''), data: d }); else missing.push(p);
  }
  eng.downloadBlob(makeZip(files), n + '.zip');
  toast(missing.length ? `ZIP dibuat. ${missing.length} file tidak ditemukan dan dilewati.` : `ZIP dibuat (${files.length} file).`, 3500);
}

// ------------------------------------------------------------------ WAV export (offline render in the native engine)
function projectEnd() {
  let e = 0;
  for (const t of state.tracks) for (const c of t.clips) if (!c.muted) e = Math.max(e, c.start + c.len);
  return e > 0 ? P.barCeil(e) : 0;
}
const clean = (n) => (n || '').trim().replace(/[^\w\- ]+/g, '') || 'Export';
function exportWav() {
  const full = projectEnd();
  if (!full) return toast('Belum ada klip untuk diekspor.');
  const name = h('input', { type: 'text', value: state.projectName });
  const bars = Math.max(1, P.barAt(full - 1) + 1);
  const from = h('input', { type: 'number', value: 1, min: 1, max: bars, style: 'width:70px;height:30px' }), to = h('input', { type: 'number', value: bars, min: 1, max: 999, style: 'width:70px;height:30px' });
  const manual = h('span', { style: 'display:none;align-items:center;gap:6px;margin-left:8px' }, 'bar', from, 's/d', to);
  const info = h('div', { class: 'hint', style: 'padding:6px 0 0' });
  const o = {
    fmt: prefs.exportFmt === 'mp3' ? 'mp3' : 'wav', bits: [16, 24, 32].includes(prefs.exportBits) ? prefs.exportBits : 16, kbps: [128, 192, 256, 320].includes(prefs.exportKbps) ? prefs.exportKbps : 192,
    stems: !!prefs.exportStems, ret: prefs.exportRet !== false, master: !!prefs.exportMaster, range: ['all', 'manual'].includes(prefs.exportRange) ? prefs.exportRange : 'all', tail: [0, 3, 10].includes(prefs.exportTail) ? prefs.exportTail : 3, norm: !!prefs.exportNorm,
  };
  const rows = [];
  const seg = (label, opts, get, set) => {
    const box = h('div', { class: 'seg', style: 'display:flex;flex-wrap:wrap' });
    const draw = () => { box.replaceChildren(...opts.map(([v, t]) => h('button', { class: 'b' + (get() === v ? ' on' : ''), onclick: () => { set(v); draw(); refresh(); } }, t))); };
    draw(); const row = h('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:8px' }, h('div', { style: 'width:74px;flex:none;color:var(--dim);font-size:12px' }, label), box); rows.push(row); return row;
  };
  const tog = (label, key, text) => { const b = h('button', { class: 'b' + (o[key] ? ' on' : ''), onclick: () => { o[key] = !o[key]; b.classList.toggle('on', o[key]); refresh(); } }, text); return h('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:8px' }, h('div', { style: 'width:74px;flex:none;color:var(--dim);font-size:12px' }, label), b); };
  const fmtRow = seg('Format', [['w16', 'WAV 16'], ['w24', 'WAV 24'], ['w32', 'WAV 32f'], ['mp3', 'MP3']], () => (o.fmt === 'mp3' ? 'mp3' : 'w' + o.bits), (v) => { if (v === 'mp3') o.fmt = 'mp3'; else { o.fmt = 'wav'; o.bits = +v.slice(1); } });
  const kbpsRow = seg('Kualitas', [[128, '128'], [192, '192'], [256, '256'], [320, '320 kbps']], () => o.kbps, (v) => { o.kbps = v; });
  const modeRow = seg('Mode', [[false, 'Mixdown'], [true, 'Stem per track']], () => o.stems, (v) => { o.stems = v; });
  const stemOpts = h('div', { style: 'display:flex;gap:6px;margin-top:8px;padding-left:82px' });
  const retB = h('button', { class: 'b' + (o.ret ? ' on' : ''), onclick: () => { o.ret = !o.ret; retB.classList.toggle('on', o.ret); refresh(); } }, 'Sertakan Return'), mstB = h('button', { class: 'b' + (o.master ? ' on' : ''), onclick: () => { o.master = !o.master; mstB.classList.toggle('on', o.master); refresh(); } }, 'Sertakan Master');
  stemOpts.append(retB, mstB);
  const rangeRow = seg('Rentang', [['all', 'Seluruh proyek'], ['manual', 'Manual']], () => o.range, (v) => { o.range = v; });
  rangeRow.append(manual);
  const tailRow = seg('Ekor efek', [[0, '0 dtk'], [3, '3 dtk'], [10, '10 dtk']], () => o.tail, (v) => { o.tail = v; });
  const normRow = tog('Normalisasi', 'norm', 'Puncak ke \u22120,1 dBFS');
  const span = () => {
    if (o.range === 'loop') return state.loop.on && state.loop.end > state.loop.start ? [state.loop.start, state.loop.end] : null;
    if (o.range === 'manual') { const a = Math.max(1, Math.floor(+from.value) || 1), b = Math.max(a, Math.floor(+to.value) || a); return [P.barStart(a - 1), P.barStart(b)]; }
    return [0, full];
  };
  const itemsOf = () => {
    if (!o.stems) return [{ name: clean(name.value), kind: 'mix' }];
    const it = state.tracks.map((t, i) => ({ name: t.name || 'Track ' + (i + 1), kind: 'track', idx: i })).filter((x) => state.tracks[x.idx].clips.length);
    if (o.ret) state.returns.forEach((r, k) => { if ((r.devices || []).length && state.tracks.some((t) => (t.send && t.send[k] > 0) || t.out === k)) it.push({ name: r.name || 'Return ' + (k + 1), kind: 'return', idx: k }); });
    if (o.master) it.push({ name: 'Master', kind: 'mix' });
    return it;
  };
  function refresh() {
    kbpsRow.style.display = o.fmt === 'mp3' ? 'flex' : 'none'; stemOpts.style.display = o.stems ? 'flex' : 'none'; manual.style.display = o.range === 'manual' ? 'inline-flex' : 'none';
    const sp = span(), n = itemsOf().length;
    if (!sp) { info.textContent = 'Area loop belum aktif: nyalakan Loop dan atur rentangnya di ruler.'; return; }
    const sec = P.tickToSec(sp[1]) - P.tickToSec(sp[0]) + o.tail, mb = (sec * (o.fmt === 'mp3' ? o.kbps * 125 : 48000 * 2 * (o.bits / 8)) * n) / 1048576;
    info.textContent = `${((P.barAt(sp[1]) - P.barAt(sp[0]) + (sp[1] - P.barStart(P.barAt(sp[1]))) / P.barLenAt(sp[1]) - (sp[0] - P.barStart(P.barAt(sp[0]))) / P.barLenAt(sp[0]))).toFixed(1).replace('.', ',')} bar + ekor ${o.tail} dtk, ${n} file (\u00b1${mb < 10 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} MB). ${o.fmt === 'wav' && o.bits === 16 ? '16-bit memakai dither. ' : ''}${o.stems ? 'Stem dikemas dalam satu ZIP; tiap stem tanpa rantai master. ' : ''}${hasNative || FS.isDevice() ? 'Disimpan di folder MobileDAW/Exports.' : isNativeApp() ? 'Disimpan di Documents/MobileDAW/Exports lalu bisa dibagikan.' : 'Diunduh ke perangkat dan tersimpan di File \u2192 Exports.'}`;
  }
  from.oninput = to.oninput = refresh;
  const body = h('div', {}, name, fmtRow, kbpsRow, modeRow, stemOpts, rangeRow, tailRow, normRow, info);
  refresh();
  const close = modal('Ekspor audio', body, [{ label: 'Batal' }, { label: 'Ekspor', go: true, fn: () => {
    const sp = span(), items = itemsOf();
    if (!sp) { toast('Area loop belum aktif.'); return false; }
    if (!items.length) { toast('Tidak ada track untuk diekspor.'); return false; }
    Object.assign(prefs, { exportFmt: o.fmt, exportBits: o.bits, exportKbps: o.kbps, exportStems: o.stems, exportRet: o.ret, exportMaster: o.master, exportRange: o.range, exportTail: o.tail, exportNorm: o.norm }); savePrefs();
    runExport({ name: clean(name.value), items, sp, o });
  } }]);
  body.parentNode && body.parentNode.classList.add('big');
}
async function runExport({ name, items, sp, o }) {
  if (!hasNative && backend !== 'web') { toast('Ekspor butuh browser dengan AudioWorklet.'); return; }
  const ext = o.fmt === 'mp3' ? 'mp3' : 'wav';
  const msg = h('div', {}, 'Merender\u2026 0%');
  const overlay = h('div', { class: 'scrim', style: 'background:var(--scrim)' },
    h('div', { class: 'modal' }, h('h3', {}, 'Mengekspor ' + (o.stems ? name + ' (stem)' : name + '.' + ext)), msg,
      h('div', { class: 'acts' }, h('button', { class: 'b', onclick: () => { eng.cancelExport(); msg.textContent = 'Membatalkan\u2026'; } }, 'Batal'))));
  document.getElementById('layer').append(overlay);   // tidak bisa ditutup: edit saat render mengubah hasil
  window.onExport = (p, label) => { msg.textContent = `${label ? label + ': ' : 'Merender: '}${p}%`; };
  window.onExportDone = (r) => {
    overlay.remove(); window.onExport = null; window.onExportDone = null;
    eng.loop(state.loop.on, state.loop.start, state.loop.end); eng.metro(state.metro); P.seekTo(0);
    toast(r.ok ? 'Tersimpan: ' + r.path : (r.cancelled ? 'Ekspor dibatalkan.' : 'Ekspor gagal: ' + r.error), r.ok ? 5000 : 4000);
  };
  msg.textContent = 'Menyiapkan audio\u2026';
  await P.ensureBakes();                                   // audio clips on a tempo map / with swing must be rendered before the export copies the sample bank
  P.stop();
  const job = { dir: `${eng.home()}/Exports`, name, format: ext, bits: o.bits, kbps: o.kbps, startTick: sp[0], endTick: sp[1], bpm: state.bpm, secs: P.tickToSec(sp[1]) - P.tickToSec(sp[0]), tailSec: o.tail, normalize: o.norm, zip: o.stems, items };
  if (eng.exportJob(job) !== true) { overlay.remove(); window.onExport = null; window.onExportDone = null; toast('Ekspor lain masih berjalan atau tidak didukung.'); }
}

let lastPos = '', lastBpm = '';
function readouts() {
  const p = Math.max(0, state.pos), bi = P.barAt(p), bar = bi + 1, bt = P.beatLenAt(p), off = p - P.barStart(bi), beat = Math.floor(off / bt) + 1, six = Math.floor((off % bt) / Math.max(60, bt / 4)) + 1;
  const s = `${bar}.${beat}.${six}`;
  if (s !== lastPos) { $('#rd-pos').textContent = s; lastPos = s; }
  const b = P.bpmAt(Math.max(0, state.pos)).toFixed(2);
  if (b !== lastBpm) { $('#rd-bpm').textContent = b; lastBpm = b; }
  { const pb = $('#btn-play'); if (pb.classList.contains('on') !== !!state.playing) { pb.classList.toggle('on', !!state.playing); setIcon(pb, state.playing ? 'pause' : 'play'); } }   // one button: play / pause
  $('#btn-rec').classList.toggle('on', P.rec.on);
  $('#btn-metro').classList.toggle('on', state.metro);
  { const ci = state.countIn ? String(state.countIn) : ''; if ($('#btn-metro').dataset.ci !== ci) { if (ci) $('#btn-metro').dataset.ci = ci; else delete $('#btn-metro').dataset.ci; } $('#btn-metro').classList.toggle('pun', !!(state.punch.on || state.recLoop)); }
  $('#btn-undo').disabled = !canUndo(); $('#btn-redo').disabled = !canRedo();
  topbarUpdate();
  setAwake(state.playing || !!prefs.keepAwake);       // Android app: screen stays on during playback (no-op in the browser)
  const cpu = $('#cpu i'); cpu.style.width = clamp(state.cpu * 100, 0, 100) + '%'; cpu.style.background = state.cpu > 0.8 ? C('#e5484d') : state.cpu > 0.55 ? C('#e8d040') : C('#7ac555');
}

// ------------------------------------------------------------------ views + tabs
function showView(v) {
  view = v;
  $('#view-arr').hidden = v !== 'arr'; $('#view-mix').hidden = v !== 'mix';
  for (const b of document.querySelectorAll('.seg .b')) b.classList.toggle('on', b.dataset.view === v);
  if (v === 'mix') MX.update();
  TL.invalidate();
}
// Device tab: "maximize" opens the panel to half of the arrangement (the arrangement stays visible above it).
// Clip / Keys tabs (piano roll, audio editor, drum step): maximize still covers the whole arrangement.
let halfPrev = '';
const HALF = 0.5;
const halfPx = () => Math.round($('#view-arr').getBoundingClientRect().height * HALF);
// Device tab: FIXED height (57% of the arrangement area, measured from the reference screenshot) so no effect panel is ever cut off.
// Clip / Keys keep their own height (the one the person dragged to).
const DEVH = 0.57;
let otherH = '';
const devPx = () => Math.round($('#view-arr').getBoundingClientRect().height * DEVH);
function applyDevHeight() {
  const v = $('#view-arr');
  if (tab !== 'dev' || v.classList.contains('max') || v.classList.contains('shut')) return;
  const px = devPx() + 'px', d = $('#detail');
  if (d.style.height !== px) { d.style.height = px; TL.fitNow(); ED.fitNow(); }
}
function leaveHalf() {
  const v = $('#view-arr');
  if (!v.classList.contains('half')) return;
  v.classList.remove('half'); $('#detail').style.height = halfPrev; halfPrev = '';
}
function setMax(on) {
  const v = $('#view-arr'), d = $('#detail');
  if (on) { setShut(false); leaveHalf(); }
  v.classList.toggle('max', on);
  if (on) { if (tab === 'dev') d.style.height = ''; }   // maximised: the panel takes the whole area (CSS), the fixed height returns afterwards
  setIcon($('#btn-max'), on ? 'collapse' : 'expand');
  if (!on) applyDevHeight();
  TL.fitNow(); ED.fitNow();
}
function setShut(on) {
  const v = $('#view-arr');
  if (v.classList.contains('shut') === on) return;
  v.classList.toggle('shut', on);
  if (on) { v.classList.remove('max'); leaveHalf(); }
  setIcon($('#btn-shut'), on ? 'up' : 'down');
  setIcon($('#btn-max'), 'expand');
  if (!on) applyDevHeight();
  TL.fitNow(); ED.fitNow();
}
function showTab(t) {
  setShut(false);
  { const d = $('#detail'); if (tab !== 'dev' && t === 'dev') otherH = d.style.height; }    // remember the editor height while Device is open
  const wasDev = tab === 'dev';
  tab = t;
  if (t !== 'dev' && wasDev && !$('#view-arr').classList.contains('max')) { $('#detail').style.height = otherH; TL.fitNow(); ED.fitNow(); }
  { const v = $('#view-arr');
    if (t === 'dev' && v.classList.contains('max')) { v.classList.remove('max'); setIcon($('#btn-max'), 'expand'); TL.fitNow(); ED.fitNow(); }
    if (t !== 'dev' && v.classList.contains('half')) { leaveHalf(); setIcon($('#btn-max'), 'expand'); TL.fitNow(); ED.fitNow(); } }
  for (const [k, el] of Object.entries(panes)) { el.style.display = k === t ? '' : 'none'; el.dataset.active = k === t ? '1' : '0'; }
  for (const b of document.querySelectorAll('#dtabs .b[data-tab]')) b.classList.toggle('on', b.dataset.tab === t);
  if (t === 'dev') { applyDevHeight(); DV.render(); } else if (t === 'keys') KB.render(); else ED.refresh();
  const title = $('#dtitle');
  if (t === 'clip') { const c = P.selectedClip(); title.textContent = c ? (c.clip.name || state.tracks[c.track].name) : ''; }
  else if (t === 'keys') title.textContent = state.tracks[state.sel.track] ? state.tracks[state.sel.track].name : '';
}
function wireSplit() {
  const split = $('#split'), body = $('#view-arr'), detail = $('#detail'), tabs = $('#dtabs');
  let on = false, moved = false, y0 = 0, raf = 0, nextH = 0, shut = false, h0 = 0, onPill = false;
  const apply = () => {
    raf = 0;
    if (shut) { setShut(true); return; }
    setShut(false); detail.style.height = nextH + 'px'; TL.fitNow(); ED.fitNow();   // one resize + redraw per frame
  };
  // The handle is relative: the panel follows the finger by the distance moved, so grabbing it anywhere works
  // (the thin grip, the tall invisible zone around it, or the empty part of the tab bar next to Device / Clip / Keys).
  const down = (e) => {
    if (e.target.closest && e.target.closest('#dtabs .b')) return;      // real buttons keep their own tap
    onPill = e.target === split; try { tabs.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
    on = true; moved = false; y0 = e.clientY; h0 = detail.getBoundingClientRect().height; shut = body.classList.contains('shut'); if (shut) h0 = 0;
    split.classList.add('grab');
  };
  const move = (e) => {
    if (!on) return;
    if (Math.abs(e.clientY - y0) > 6) moved = true;
    if (!moved) return;
    const r = body.getBoundingClientRect();
    const h = h0 + (y0 - e.clientY);
    shut = tab === 'dev' ? h < h0 - 40 : h < 56;                // dragged down: shut the panel completely (Device: a clear downward drag)
    nextH = tab === 'dev' ? devPx() : clamp(h, 90, r.height - 70);   // the Device panel has a fixed height (it can only be shut); editors may be resized
    if (!raf) raf = requestAnimationFrame(apply);
  };
  const end = (e) => {
    if (on && !moved) { if (onPill) setShut(!body.classList.contains('shut')); }   // a plain tap on the handle toggles; the tab bar keeps its own taps
    on = false; onPill = false; split.classList.remove('grab');
  };
  // The pill now lives inside the tab bar (behind the buttons), so one set of listeners on the bar covers the pill, the empty bar and the title.
  tabs.addEventListener('pointerdown', down); tabs.addEventListener('pointermove', move);
  tabs.addEventListener('pointerup', end); tabs.addEventListener('pointercancel', end);
}

// ------------------------------------------------------------------ frame loop
let lastPoll = 0;
let errAt = 0;
function guard(fn) { try { fn(); } catch (e) { if (performance.now() - errAt > 3000) { errAt = performance.now(); toast('Kesalahan tampilan: ' + (e && e.message), 4000); } console.error(e); } }
function loop(ts) {
  if (document.hidden) { requestAnimationFrame(loop); return; }
  if (ts - lastPoll > 32) { lastPoll = ts; guard(() => { P.applyPoll(eng.poll()); readouts(); }); }
  if (!shouldDraw(ts)) { requestAnimationFrame(loop); return; }      // frame pacing: Auto / 60 Hz / 120 Hz
  const t0 = performance.now();
  guard(() => { if (view === 'arr') { TL.frame(); if (tab === 'clip') ED.frame(); } else MX.frame(); });
  recordCost(performance.now() - t0);
  requestAnimationFrame(loop);
}
// Anything that slips through (a failing promise, an error in a pointer handler) is logged and shown at most once per 3 s instead of
// silently breaking the app or flooding the screen.
window.addEventListener('error', (ev) => { if (performance.now() - errAt > 3000) { errAt = performance.now(); toast('Kesalahan: ' + ((ev.error && ev.error.message) || ev.message || ''), 4000); } console.error(ev.error || ev.message); });
window.addEventListener('unhandledrejection', (ev) => { if (performance.now() - errAt > 3000) { errAt = performance.now(); toast('Kesalahan: ' + ((ev.reason && ev.reason.message) || ev.reason || ''), 4000); } console.error(ev.reason); });
globalThis.onEngineError = (e) => {
  log('error', 'engine', e && (e.kind || ''), e && e.msg);
  if (e.kind === 'dev') { const t = P.tr(e.strip); if (t && t.devices[e.dev]) { t.devices[e.dev].bypass = true; P.emit('devices'); } toast(`Efek dimatikan karena error: ${e.msg || ''}. Audio tetap berjalan.`, 5000); }
  else if (e.kind === 'inst') toast(`Instrumen di track ${e.strip + 1} dimatikan karena error: ${e.msg || ''}`, 5000);
  else toast('Error engine audio: ' + (e.msg || ''), 5000);
};

// ------------------------------------------------------------------ keyboard (external keyboards) + back button
const PIANO = { KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24 };
const heldKeys = new Map();
function keys() {
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod && tab === 'keys' && view === 'arr' && e.code in PIANO) {   // typing keyboard as piano
      e.preventDefault();
      if (e.repeat || heldKeys.has(e.code)) return;
      const i = state.sel.track, t = state.tracks[i];
      if (!t || (t.kind !== 'midi' && t.kind !== 'drum')) return;
      const pitch = 48 + PIANO[e.code];
      heldKeys.set(e.code, { i, pitch });
      P.noteEvent(i, pitch, 0.8, true);
      return;
    }
    if (e.code === 'Space') { e.preventDefault(); P.togglePlay(); }
    else if (e.code === 'Home') P.seekTo(0);
    else if (mod && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redoOp() : undoOp(); }
    else if (mod && e.code === 'KeyY') { e.preventDefault(); redoOp(); }
    else if (e.code === 'Delete' || e.code === 'Backspace') { if (!TL.deleteSelected()) { const c = P.selectedClip(); if (c) { checkpoint(); P.removeClip(c.track, c.clip.id); } } }
    else if (e.code === 'Escape') TL.clearSelection();
    else if (e.code === 'KeyM') P.toggleMetro();
    else if (e.code === 'KeyB') BR.toggleBrowser();
    else if (e.code === 'KeyR') toggleRec();
    else if (e.code === 'KeyF') toggleFullscreen();
    else if (e.code === 'Tab') { e.preventDefault(); showView(view === 'arr' ? 'mix' : 'arr'); }
  });
  window.addEventListener('keyup', (e) => {
    const h = heldKeys.get(e.code);
    if (h) { heldKeys.delete(e.code); P.noteEvent(h.i, h.pitch, 0, false); }
  });
  window.onBack = () => {
    if (closeAll()) return true;
    if (BR.isOpen()) { BR.closeBrowser(); return true; }
    if ($('#view-arr').classList.contains('max')) { setMax(false); return true; }
    if (view === 'mix') { showView('arr'); return true; }
    if (tab !== 'dev') { showTab('dev'); return true; }
    return false;
  };
}

// ------------------------------------------------------------------ boot
function boot() {
  initLog(prefs.logLevel);
  initNative(toast);                                   // Android app (Capacitor): back button, html.native-app; nothing in the browser
  applyTheme(prefs.theme);
  initEdgeGuard();
  initLayout();
  initFloat();
  icons(); wireTransport(); wireSplit(); keys();
  window.addEventListener('themechange', () => { try { MX.build(); DV.render(); } catch (_) { /* views not ready yet */ } });   // knobs/strips take their colours when built
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  const dbody = $('#dbody');
  for (const k of ['dev', 'clip', 'keys']) { const el = h('div', { class: k === 'clip' ? 'ed-root' : 'pane', style: 'position:absolute;inset:0' }); dbody.append(el); panes[k] = el; }
  DV.initDevices(panes.dev); KB.initKeys(panes.keys); ED.initEditor(panes.clip);
  MX.initMixer($('#view-mix'));
  BR.initBrowser($('#browser'));
  initTopbar({ tap: tapTempo });
  TL.initTimeline($('#arr'), {
    openEditor: () => { showTab('clip'); if (window.innerHeight < 700) setMax(true); },
    pickAudio: (at) => BR.openBrowser('file', { track: state.sel.track, at }),
  });
  $('#btn-max').onclick = () => { const c = $('#view-arr').classList; setMax(!(c.contains('max') || c.contains('half'))); };
  window.addEventListener('applayout', () => { applyDevHeight(); });
  setIcon($('#btn-max'), 'expand'); setIcon($('#btn-shut'), 'down');
  $('#btn-shut').onclick = () => setShut(!$('#view-arr').classList.contains('shut'));
  for (const b of document.querySelectorAll('.seg .b')) b.onclick = () => showView(b.dataset.view);
  for (const b of document.querySelectorAll('#dtabs .b[data-tab]')) b.onclick = () => { if (b.dataset.tab === tab && !$('#view-arr').classList.contains('shut') && !$('#view-arr').classList.contains('max') && !$('#view-arr').classList.contains('half')) setShut(true); else showTab(b.dataset.tab); };   // tapping the open tab folds the panel away
  // tapping the arrangement while the drawer is open closes it
  $('#main').addEventListener('pointerdown', () => { if (BR.isOpen() && !BR.isPinned()) BR.closeBrowser(); }, true);
  P.onChange((w) => {
    if (w === 'recend' && P.rec.last) toast(recMsg(P.rec.last), P.rec.last.error ? 5000 : 3000);
    if (w === 'all') clearHistory();   // track edits are undoable now, so only loading a project starts a fresh history
    if (w === 'sel' || w === 'all' || w === 'clips') { if (tab === 'clip') { ED.refresh(); const c = P.selectedClip(); $('#dtitle').textContent = c ? (c.clip.name || state.tracks[c.track].name) : ''; } else if (tab === 'dev') DV.render(); else if (tab === 'keys') KB.render(); }
    if (w === 'sel') MX.update();
  });
  Promise.resolve(eng.start()).catch((e) => showFatal(e));
  if (backendError()) showFatal(backendError());
  Promise.resolve(eng.init ? eng.init() : null).catch(() => {}).then(() => {
    eng.setLatencyMs(prefs.latencyMs); eng.metroVol(prefs.metroVol ?? 1);
    restore().then((ok) => { if (!ok) P.newProject(true); }).catch(() => P.newProject(true)).then(() => { showTab('dev'); startAutosave(); });
    if (prefs.midiOn && !isNativeApp()) enableMidi(true);   // no Web MIDI in the Android WebView
    if (isNativeApp() && eng.setEngine) {                 // Android: C++ engine when chosen in Pengaturan -> Audio (falls back to Web by itself)
      addEventListener('enginechange', (e) => engineToast(e.detail));
      if (prefs.engine === 'native') eng.setEngine('native');
    }
    initAutoFullscreen();
    initUiPrefs();
    askFolder();
    initPwa(backend === 'native' || isNativeApp());
    registerServiceWorker();
  });
  requestAnimationFrame(loop);
  window.__dawBooted = true;
}
// First start: ask once for a place to keep MobileDAW/ (samples, exports, presets...). The system picker needs a tap, so this is a dialog with a button.
// When the folder was chosen earlier but the browser asks for write access again, the first tap re-confirms it.
function askFolder() {
  if (backend !== 'web') return;
  const i = FS.info();
  if (i.mode === 'opfs' || (i.mode === 'device' && i.perm === 'granted')) return;
  if (i.mode === 'device') {   // saved folder, permission has to be confirmed again
    const again = async () => { removeEventListener('pointerup', again, true); if (await FS.regrant()) { await eng.syncFolder(); toast('Akses folder ' + i.name + ' aktif.', 2500); } };
    addEventListener('pointerup', again, true);
    return;
  }
  if (prefs.folderAsked || !FS.canPick()) return;
  const msg = h('div', { class: 'hint', style: 'padding:0 0 4px' }, 'MobileDAW menyimpan sample, hasil ekspor, proyek, dan preset di folder MobileDAW. Pilih lokasinya sekali dan beri izin menulis; aplikasi membuat folder MobileDAW beserta sub-foldernya, jadi tidak perlu impor file lagi.');
  modal('Izin penyimpanan', msg, [
    { label: 'Nanti', fn: () => { prefs.folderAsked = true; savePrefs(); } },
    { label: 'Pilih folder', go: true, fn: () => { prefs.folderAsked = true; savePrefs(); FS.chooseFolder().then(async (r) => { if (r.error) toast(r.error, 5000); else if (r.ok) { const s = await eng.syncFolder(); toast('Folder ' + r.name + ' siap' + (s && s.added ? `, ${s.added} file ditemukan.` : '.'), 3500); } }); } },
  ]);
}
let lastEngine = 'web';
function engineToast(i) {
  if (i.active === lastEngine) return;
  lastEngine = i.active;
  toast(i.active === 'native' ? 'Engine audio: Native (C++)' : i.want === 'native' ? 'Engine audio: Web (proyek ini memakai instrumen/efek yang belum ada di engine native)' : 'Engine audio: Web', 3500);
}
function showFatal(e) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--bg,#1b1b1c);color:var(--text,#eee);padding:24px;font:15px/1.5 system-ui';
  d.innerHTML = '<h2>MobileDAW tidak bisa memulai mesin audio</h2><p></p>';
  d.querySelector('p').textContent = (e && e.message) || String(e);
  document.body.append(d);
}
function registerServiceWorker() {
  if (backend === 'native' || isNativeApp() || !('serviceWorker' in navigator) || location.protocol === 'file:') return;   // the APK carries every file itself
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline caching unavailable (private mode or insecure origin) */ });
}
boot();
