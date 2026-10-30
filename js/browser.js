// Left drawer: add tracks/devices, file library (samples, SoundFonts, recordings, exports), save/load projects.
// Web version: files live inside the app (IndexedDB) and are imported with the system file picker, so they work offline.
import { h, ask, toast, menu, modal } from './ui.js';
import { DEVICES, INSTRUMENTS, INST_LIST, PRESETS } from './defs.js';
import { eng, backend, MASTER } from './engine.js';
import { dropInfo } from './timeline.js';
import * as P from './project.js';
import { isAutosave } from './autosave.js';
import * as FS from './storage.js';
import * as PR from './presets.js';
import { prefs, savePrefs } from './prefs.js';
import { DEMOS, openDemo } from './demos.js';
const { state } = P;

const AUDIO = /\.(wav|mp3|ogg|oga|flac|m4a|aac|opus|webm)$/i, SF2 = /\.sf2$/i;
const WEB = backend === 'web';
let aside, tab = 'instr', path = (WEB && prefs.browserPath) || null, pending = null, home = null;
let pinned = prefs.browserPin !== false;        // pinned: tapping the arrangement does not close the drawer
let pvPath = null, pvInfo = null, pvPlaying = false, pvRaf = 0, pvBar = null, adding = false;
const scrollMem = new Map(); let curKey = '';

export const isOpen = () => !aside.hidden;
export const isPinned = () => pinned;
export function closeBrowser() { aside.hidden = true; stopPreview(true); stopAudition(); }
export function toggleBrowser() { if (aside.hidden) { aside.hidden = false; render(); } else closeBrowser(); }
export function openBrowser(t, p) {
  tab = t === 'add' ? 'instr' : (t || tab); pending = p || null; aside.hidden = false;
  // the last folder stays: only a SoundFont request jumps to /SoundFonts, and a sample request leaves SoundFonts / presets
  if (WEB) {
    const top = path && topFolder(path);
    if (pending && pending.sf) { if (top !== '/SoundFonts') path = '/SoundFonts'; }
    else if (pending && (!top || top === '/SoundFonts' || top.startsWith('/Presets'))) path = '/Samples';
  } else if (pending && pending.sf) path = null;
  render();
}

// row with optional long-press action and optional drag spec (drag sideways out of the drawer onto the arrangement)
function row(label, fn, sub, cls = '', onLong = null, dr = null) {
  const el = h('div', { class: 'row ' + cls, role: 'button' }, h('span', { class: 'nm' }, label), sub ? h('span', { class: 'sub' }, sub) : null);
  let timer = 0, fired = false, moved = false, y0 = 0, x0 = 0, dragging = false, down = false;
  el.addEventListener('pointerdown', (e) => { down = true; fired = false; moved = false; dragging = false; y0 = e.clientY; x0 = e.clientX; if (onLong) timer = setTimeout(() => { if (!moved) { fired = true; onLong(el.getBoundingClientRect()); } }, 480); });
  el.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (dragging) return dragMove(e);
    if (Math.abs(e.clientY - y0) > 8) { moved = true; clearTimeout(timer); }
    if (dr && !moved && !fired && Math.abs(e.clientX - x0) > 14) { dragging = true; clearTimeout(timer); try { el.setPointerCapture(e.pointerId); } catch (_) {} dragStart(dr, label); dragMove(e); }
  });
  const end = () => clearTimeout(timer);
  el.addEventListener('pointercancel', () => { end(); down = false; if (dragging) { dragging = false; dragEnd(null); } });
  el.addEventListener('pointerup', (e) => { end(); down = false; if (dragging) { dragging = false; dragEnd(e); return; } if (!fired && !moved) fn(); });
  return el;
}
const head = (t, g) => { const e = h('div', { class: 'row', style: 'min-height:28px;color:var(--dim);font-size:11px;pointer-events:none' }, t); if (g) e.dataset.g = g; return e; };
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

// ---- drag from the drawer onto the arrangement: a track row, an effect / Master row, or the "+" row (new track)
let dg = null;
function dragStart(spec, label) {
  stopAudition(); stopPreview();
  const ghost = h('div', { class: 'dgh' }, label), hl = h('div', { class: 'dhl' });
  hl.hidden = true; document.body.append(hl, ghost);
  dg = { spec, label, ghost, hl, tg: null };
  aside.classList.add('dragging');
}
function dragTarget(e) {
  if (e.clientX < aside.getBoundingClientRect().right) return null;      // still over the drawer: dropping here cancels
  const info = dropInfo(e.clientX, e.clientY); if (!info) return null;
  const sp = dg.spec;
  if (info.kind === 'track') { const t = state.tracks[info.i]; return sp.ok(t) ? { ...info, text: t.name || 'Track ' + (info.i + 1) } : { ...info, bad: true }; }
  if (info.kind === 'fx') return sp.fx ? { ...info, i: info.strip, text: (P.tr(info.strip) || {}).name || 'Master' } : { ...info, bad: true };
  return sp.mk ? { ...info, text: 'track baru' } : { ...info, bad: true };
}
function dragMove(e) {
  if (!dg) return;
  dg.ghost.style.transform = `translate(${Math.round(e.clientX + 12)}px,${Math.round(e.clientY - 38)}px)`;
  const tg = dg.tg = dragTarget(e), hl = dg.hl;
  hl.hidden = !tg;
  if (tg) { hl.style.cssText = `left:${tg.left}px;top:${tg.top}px;width:${tg.width}px;height:${tg.h}px`; hl.classList.toggle('bad', !!tg.bad); }
  dg.ghost.textContent = dg.label + (tg && !tg.bad ? '  \u2192  ' + tg.text : '');
}
function dragEnd(e) {
  const d = dg; if (!d) return;
  if (e) dragMove(e);
  dg = null; d.ghost.remove(); d.hl.remove(); aside.classList.remove('dragging');
  const tg = e && d.tg; if (!tg) return;
  if (tg.bad) return toast(d.spec.msg || 'Tidak bisa dijatuhkan di sini.', 2400);
  P.HK.group(() => {                                    // a new track plus what was dropped on it = one undo step (async sample loads too)
    let i = tg.i;
    if (tg.kind === 'new') { if (!P.addTrack(d.spec.mk)) return toast('Batas 64 track tercapai.'); i = state.tracks.length - 1; }
    if (tg.kind !== 'fx') P.selectTrack(i);
    return d.spec.run(i, tg);
  });
}

// ---- audition: plays a short phrase on a scratch strip (the first unused track slot) so the project is never touched
const SCRATCH_OK = new Set([1, 2, 3, 5, 7, 8, 11]);                      // sampler / SoundFont instruments need their own samples, so they have no audition
let au = null, auKey = '';
const scratchStrip = () => (state.tracks.length < 64 ? state.tracks.length : -1);
function stopAudition() {
  if (!au) return; const a = au; au = null; auKey = '';
  a.timers.forEach(clearTimeout);
  for (const p of a.on) eng.preview(a.s, p, 0, false);
  eng.resetTrack(a.s);
  updAud();
}
function startAudition(sp) {
  if (auKey === sp.key) return stopAudition();
  stopAudition(); stopPreview();
  const s = scratchStrip(); if (s < 0) return toast('Audition butuh satu slot track kosong (batas 64 track).');
  const def = INSTRUMENTS[sp.type]; if (!def) return;
  eng.resetTrack(s); eng.trackInst(s, sp.type);
  def.params.forEach((q, k) => { if (k === 90 && sp.type === 11) return; eng.instParam(s, k, sp.p && sp.p[k] !== undefined ? sp.p[k] : q.def); });
  eng.instParam(s, 90, 0); eng.trackVol(s, sp.vol !== undefined ? sp.vol : 0.85); eng.trackPan(s, sp.pan || 0);
  (sp.devs || []).forEach((d, di) => {
    const dd = DEVICES[d.type]; if (!dd) return;
    eng.insertDevice(s, di, d.type);
    (d.params || dd.params.map((q) => q.def)).forEach((v, pi) => eng.devParam(s, di, pi, v));
    if (d.bypass) eng.devBypass(s, di, true);
  });
  const steps = sp.drum ? [[36], [38], [42], [38]] : sp.bass ? [[36], [43], [36], [48]] : sp.chord ? [[60, 64, 67], [62, 65, 69]] : [[60], [64], [67], [72]];
  const step = sp.chord ? 700 : 330, gate = sp.chord ? 600 : 290, a = { s, on: new Set(), timers: [] };
  au = a; auKey = sp.key;
  steps.forEach((ps, k) => {
    a.timers.push(setTimeout(() => { if (au !== a) return; for (const p of ps) { eng.preview(s, p, 0.8, true); a.on.add(p); } }, 40 + k * step));
    a.timers.push(setTimeout(() => { if (au !== a) return; for (const p of ps) { eng.preview(s, p, 0, false); a.on.delete(p); } }, 40 + k * step + gate));
  });
  a.timers.push(setTimeout(() => { if (au === a) stopAudition(); }, 40 + steps.length * step + (sp.tail || 1000)));
  updAud();
}
function audBtn(sp) {
  const b = h('button', { class: 'pv' + (auKey === sp.key ? ' on' : ''), 'aria-label': 'Dengar', 'data-a': sp.key });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('pointerup', (e) => { e.stopPropagation(); startAudition(sp); });
  return b;
}
const withAud = (r, sp) => { if (sp) r.prepend(audBtn(sp)); return r; };
function updAud() { if (aside) for (const b of aside.querySelectorAll('.pv[data-a]')) b.classList.toggle('on', b.dataset.a === auKey); }
const synthP = () => { const f = (PRESETS[1] || []).find((x) => x.name === 'Brass Stab'); return f ? f.p : {}; };   // source sound for effect audition
const fxAud = (devs, extra) => ({ key: 'fx' + JSON.stringify(devs.map((d) => d.type)) + (extra && extra.key || ''), type: 1, p: synthP(), devs, chord: true, tail: 1800, ...(extra || {}) });
const instAud = (key, type, p, cat) => (SCRATCH_OK.has(type) ? { key, type, p, bass: cat === 'Bass', drum: type === 3 } : null);

// ---- add by tap (selected track) or by drag (any track)
function toMidiTarget() {
  const i = state.sel.track, t = state.tracks[i];
  if (t && t.kind === 'midi') return i;
  if (!P.addTrack('midi')) { toast('Batas 64 track tercapai.'); return -1; }
  const n = state.tracks.length - 1; P.selectTrack(n); return n;
}
function tapInst(k) { P.HK.group(() => { const i = toMidiTarget(); if (i < 0) return; P.setInstrument(i, k); toast(INSTRUMENTS[k].name + ' dipasang di ' + (state.tracks[i].name || 'track') + '.'); }); }
function applyFactory(i, type, pr) {
  P.HK.group(() => { if (state.tracks[i].inst.type !== type) P.setInstrument(i, type); P.applyPreset(i, pr); });
  toast('Preset "' + pr.name + '" dipasang.');
}
function tapFactory(type, pr) { P.HK.group(() => { const i = toMidiTarget(); if (i >= 0) applyFactory(i, type, pr); }); }
function tapUserInst(full) {
  P.HK.group(() => { const i = toMidiTarget(); if (i < 0) return; const r = PR.applyPresetFile(full, i); toast(r.error || r.msg, r.error ? 4000 : 2200); });
}
function tapMixer(full) { const r = PR.applyPresetFile(full, state.sel.track); toast(r.error || r.msg, r.error ? 4000 : 2200); }
function tapFx(type) {
  const i = state.sel.track, t = P.tr(i);
  if (!t) return toast('Pilih track dulu.');
  if (t.kind === 'auto') return toast('Pilih track biasa untuk memasang efek.');
  if (t.devices.length >= 16) return toast('Maksimal 16 efek per track.');
  P.addDevice(i, type); toast(DEVICES[type].name + ' ditambahkan ke ' + (t.name || 'Master') + '.');
}
const newTrackRow = (label, kind, then) => row(label, () => { if (!P.addTrack(kind)) return toast('Batas 64 track tercapai.'); P.selectTrack(state.tracks.length - 1); if (then) then(); });
const dInst = (k) => ({ ok: (t) => t.kind === 'midi', mk: 'midi', msg: 'Instrumen hanya untuk track synth (MIDI).', run: (i) => { P.setInstrument(i, k); toast(INSTRUMENTS[k].name + ' dipasang.'); } });
const dFx = (type) => ({ ok: (t) => t.kind !== 'auto', fx: true, msg: 'Efek tidak bisa dipasang di lane automasi.', run: (i) => { const t = P.tr(i); if (t.devices.length >= 16) return toast('Maksimal 16 efek per track.'); P.addDevice(i, type); toast(DEVICES[type].name + ' ditambahkan ke ' + (t.name || 'Master') + '.'); } });
const dFactory = (type, pr) => ({ ok: (t) => t.kind === 'midi', mk: 'midi', msg: 'Preset instrumen hanya untuk track synth (MIDI).', run: (i) => applyFactory(i, type, pr) });
const dUserInst = (full) => ({ ok: (t) => t.kind === 'midi', mk: 'midi', msg: 'Preset instrumen hanya untuk track synth (MIDI).', run: (i) => { const r = PR.applyPresetFile(full, i); toast(r.error || r.msg, r.error ? 4000 : 2200); } });
const dMixer = (full) => ({ ok: (t) => t.kind !== 'auto', msg: 'Preset mixer tidak bisa dipasang di lane automasi.', run: (i) => { const r = PR.applyPresetFile(full, i); toast(r.error || r.msg, r.error ? 4000 : 2200); } });
function sampleDrag(full) {
  return { ok: (t) => t.kind === 'audio', mk: 'audio', msg: 'Sample hanya bisa dijatuhkan di track audio atau baris + (track baru).', run: (i, info) => dropSample(full, i, info) };
}
async function dropSample(full, i, info) {
  if (adding) return;
  adding = true;
  try {
    stopPreview(); toast('Memuat sample\u2026', 4000);
    const at = P.beatRound(info && info.tick != null ? info.tick : state.pos), c = await P.addAudioClip(i, full, at);
    if (!c) return toast('Sample tidak bisa dimuat (format atau file terlalu panjang).');
    toast('Klip ditambahkan di track ' + (state.tracks[i].name || (i + 1)) + '.');
  } finally { adding = false; }
}

const FX_GROUPS = [['dyn', 'Dinamika', [4, 5, 10]], ['eq', 'EQ & Filter', [2, 8, 1]], ['time', 'Delay & Reverb', [6, 7]], ['color', 'Distorsi', [3, 9]], ['util', 'Utilitas', [0, 12, 13, 14, 15]]];
function tabInstr() {
  const t = P.tr(state.sel.track), out = [head('Track baru', 'track'),
    newTrackRow('Track synth (MIDI)', 'midi'), newTrackRow('Track drum (step sequencer)', 'drum'),
    newTrackRow('Track audio', 'audio', () => { tab = 'file'; render(); toast('Pilih atau seret sample dari tab Sample.'); }),
    head('Instrumen', 'instr'), h('div', { class: 'hint' }, 'Ketuk = pasang ke track terpilih (atau track baru). Seret ke track di arrangement. \u25B6 = dengar dulu.')];
  for (const k of INST_LIST) out.push(withAud(row(INSTRUMENTS[k].name, () => tapInst(k), t && t.kind === 'midi' && t.inst && t.inst.type === k ? 'terpasang' : '', '', null, dInst(k)), instAud('i' + k, k, null, '')));
  return out;
}
function tabFx() {
  const out = [], used = new Set(FX_GROUPS.flatMap((g) => g[2]));
  const rest = Object.keys(DEVICES).map(Number).filter((k) => !used.has(k));
  out.push(h('div', { class: 'hint' }, 'Ketuk = tambah ke track terpilih. Seret ke track atau Master di arrangement. \u25B6 = dengar dulu.'));
  for (const [g, label, ks] of FX_GROUPS) {
    out.push(head(label, g));
    for (const k of (g === 'util' ? ks.concat(rest) : ks)) if (DEVICES[k]) out.push(withAud(row(DEVICES[k].name, () => tapFx(k), '', '', null, dFx(k)), fxAud([{ type: k }])));
  }
  return out;
}
function userPresets(dir) {
  const d = eng.listDir(dir), out = [];
  for (const it of (d && d.items) || []) { if (it.dir || !/\.json$/i.test(it.name)) continue; const full = dir + '/' + it.name, o = PR.readPreset(full); if (o) out.push({ full, o }); }
  return out.sort((a, b) => String(a.o.name).localeCompare(String(b.o.name)));
}
function tabPreset() {
  const out = [head('Preset instrumen saya', 'usr')];
  presetRows(out, PR.DIR_INST);
  for (const { full, o } of userPresets(PR.DIR_INST)) {
    if (o.kind !== 'instrument' || !INSTRUMENTS[o.type]) continue;
    const pm = Object.fromEntries((o.p || []).map((v, k) => [k, v]));
    out.push(withAud(row(o.name || 'Preset', () => tapUserInst(full), o.inst || INSTRUMENTS[o.type].name, '', (rect) => fileMenu(full, rect), dUserInst(full)), instAud('u' + full, o.type, pm, '')));
  }
  out.push(head('Preset mixer saya', 'mix'));
  presetRows(out, PR.DIR_MIX);
  for (const { full, o } of userPresets(PR.DIR_MIX)) {
    if (o.kind !== 'mixer') continue;
    const devs = (o.devices || []).filter((d) => DEVICES[d.type]).slice(0, 8);
    out.push(withAud(row(o.name || 'Preset', () => tapMixer(full), devs.length + ' efek', '', (rect) => fileMenu(full, rect), dMixer(full)), devs.length ? fxAud(devs, { key: 'm' + full, vol: Math.min(1, +o.vol || 0.85), pan: +o.pan || 0 }) : null));
  }
  for (const k of Object.keys(PRESETS)) {
    const type = +k, def = INSTRUMENTS[type]; if (!def) continue;
    out.push(head(def.name + ' (bawaan)', 'i' + type));
    for (const pr of P.presetsFor(type)) out.push(withAud(row(pr.name, () => tapFactory(type, pr), pr.cat || '', '', null, dFactory(type, pr)), instAud('p' + type + '.' + pr.name, type, pr.p, pr.cat)));
  }
  return out;
}
async function addSample(file) {
  if (adding) return;                               // a second tap while the first sample is still loading is ignored
  adding = true;
  try { await addSample0(file); } finally { adding = false; }
}
async function addSample0(file) {
  stopPreview();
  if (pending && pending.pad !== undefined) {      // sample for a drum pad: a new pad ('new') or replace the sound of an existing one
    toast('Memuat sample\u2026', 4000);
    const pd = pending, r = pd.pad === 'new' ? await P.addPadSample(pd.track, file) : await P.setPadSample(pd.track, pd.pad, file);
    if (!r || r.error) return toast((r && r.error) || 'Sample tidak bisa dimuat.', 3500);
    if (pd.pad === 'new') toast('Pad sample ditambahkan.'); else { pending = null; closeBrowser(); toast('Sample pad diganti.'); }   // adding pads: the drawer stays so several samples can follow
    if (pd.done) pd.done(r.k);
    return;
  }
  if (pending && pending.zone != null) {          // sample for a DirectWave / Keystone zone
    toast('Memuat sample\u2026', 4000);
    const sm = await P.setZoneSample(pending.track, pending.zone, file);
    if (!sm) return toast('Sample tidak bisa dimuat (format atau file terlalu panjang).');
    pending = null; closeBrowser(); toast('Sample dipasang ke zona.');
    return;
  }
  const i = pending ? pending.track : state.sel.track, t = state.tracks[i];
  if (!t || t.kind !== 'audio') return toast('Pilih track audio dulu (tab Instrumen \u2192 Track audio).');
  const at = pending && pending.at != null ? pending.at : P.beatRound(state.pos);
  toast('Memuat sample\u2026', 4000);
  const c = await P.addAudioClip(i, file, at);
  if (!c) return toast('Sample tidak bisa dimuat (format atau file terlalu panjang).');
  pending = null; toast('Klip ditambahkan di track ' + (t.name || (i + 1)) + '.');   // the drawer and its folder stay as they are
}
async function useSoundFont(file) {
  const i = pending && pending.sf ? pending.track : state.sel.track, t = state.tracks[i];
  if (!t || !t.inst || t.inst.type !== 6) return toast('Pilih track synth dengan instrumen SoundFont dulu.');
  toast('Memuat SoundFont\u2026', 6000);
  const r = await P.setSoundFont(i, file);
  if (r && r.error) return toast(r.error, 4000);
  pending = null; closeBrowser(); toast(`SoundFont dimuat: ${r.presets.length} preset.`);
}

function fileMenu(file, rect) {
  menu([
    { label: 'Unduh ke perangkat', fn: () => eng.download(file) },
    { label: 'Hapus dari aplikasi', fn: async () => { await eng.deleteFile(file); toast('File dihapus.'); render(); } },
  ], rect.left + 20, rect.top + 20);
}

async function doImport() {
  const files = await eng.importFiles();
  if (!files.length) return;
  if (files[0].startsWith('/SoundFonts')) path = '/SoundFonts'; else if (files[0].startsWith('/Projects')) { tab = 'proj'; } else path = '/Samples';
  toast(files.length + ' file diimpor.');
  render();
}

const FOLDERS_UI = [['/Samples', 'Samples'], ['/SoundFonts', 'SoundFonts'], ['/Recordings', 'Recordings'], ['/Exports', 'Exports'], ['/Presets/Instruments', 'Preset instrumen'], ['/Presets/Mixer', 'Preset mixer']];
async function connectFolder() {
  const r = await FS.chooseFolder();
  if (r.error) return toast(r.error, 5000);
  if (r.cancelled) return;
  toast('Folder ' + r.name + ' siap.', 3500);
  const s = await eng.syncFolder(); if (s && s.added) toast(`${s.added} file ditemukan di folder.`, 3000);
  render();
}
let scanning = false;
async function rescan(msg) {                         // always ends: the status text and the list are refreshed even when the scan fails
  if (scanning) return;
  scanning = true;
  let r = null;
  try {
    r = await eng.syncFolder((n) => { if (msg && msg.isConnected) msg.textContent = n + '\u2026'; });
  } catch (e) { toast('Pemindaian gagal: ' + ((e && e.message) || e), 4000); }
  scanning = false;
  if (r) {
    const bad = r.errors ? ` (${r.errors} item tidak bisa dibaca, lihat Pengaturan \u2192 Log)` : '';
    toast((r.added || r.removed ? `Folder diperbarui (+${r.added} / \u2212${r.removed}).` : 'Folder sudah terbaru.') + bad, r.errors ? 4500 : 2200);
  }
  render();
}
function folderBar() {                               // compact status: a dot button (tap = rescan) and, only when action is needed, a slim warning row
  const i = FS.info(), dot = h('button', { class: 'fdot', 'aria-label': 'Status folder' }, h('i'), h('span', {}, '\u27F3')), msg = dot.querySelector('span');
  const mk = (txt, label, fn) => h('div', { class: 'fwarn' }, h('span', {}, txt), h('button', { class: 'chip on', onclick: fn }, label));
  let warn = null;
  if (i.mode === 'device' && i.perm === 'granted') {
    dot.classList.add('ok'); dot.title = i.name + '/ terhubung \u2022 ketuk untuk menyegarkan';
    if (scanning) msg.textContent = '\u2026';
    dot.addEventListener('click', () => { msg.textContent = '\u2026'; rescan(msg); });
  } else if (i.mode === 'device') {
    dot.classList.add('warn');
    const grant = async () => { if (await FS.regrant()) { toast('Akses folder aktif.'); rescan(msg); } else { toast('Izin tidak diberikan.'); render(); } };
    warn = mk(i.name + '/ \u2022 izin perlu dikonfirmasi', 'Izinkan', grant);
    dot.addEventListener('click', grant);
  } else if (i.mode === 'opfs') {
    dot.classList.add('ok'); dot.addEventListener('click', () => toast('MobileDAW/ di penyimpanan aplikasi (browser tanpa pemilih folder).', 3000));
  } else {
    dot.classList.add('warn'); warn = mk('Belum ada folder MobileDAW', 'Pilih folder', connectFolder);
    dot.addEventListener('click', connectFolder);
  }
  return { dot, warn };
}

// ---- sample preview: play from the list, waveform + "Tambah" in the bar under the list
async function startPreview(full) {
  stopAudition();
  if (pvPath === full && pvPlaying) return stopPreview();
  pvPath = full; pvPlaying = true; if (!pvInfo || pvInfo.path !== full) pvInfo = null;
  updPreview();
  const r = await eng.previewFile(full, () => { pvPlaying = false; cancelAnimationFrame(pvRaf); updPreview(); });
  if (!r || pvPath !== full) return;                 // superseded by another preview or stopped
  if (r.error) { pvPlaying = false; pvPath = null; pvInfo = null; updPreview(); return toast(r.error, 3500); }
  pvInfo = { path: full, duration: r.duration, peaks: r.peaks };
  updPreview(); tickPreview();
}
function stopPreview(clear) {
  eng.stopPreview(); pvPlaying = false; cancelAnimationFrame(pvRaf);
  if (clear) { pvPath = null; pvInfo = null; }
  if (!aside.hidden || !clear) updPreview();
}
function tickPreview() {
  cancelAnimationFrame(pvRaf);
  const step = () => { if (!pvPlaying || !pvBar || !pvBar.isConnected) return; drawPreview(); pvRaf = requestAnimationFrame(step); };
  step();
}
const mmss = (t) => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') + '.' + Math.floor((t % 1) * 10); };
function drawPreview() {
  const cv = pvBar && pvBar.querySelector('canvas'); if (!cv) return;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, hgt = cv.clientHeight;
  if (!w || !hgt) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); }
  const g = cv.getContext('2d'), cs = getComputedStyle(cv), accent = cs.getPropertyValue('--accent').trim() || '#ffa726', dim = cs.getPropertyValue('--dim').trim() || '#888';
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hgt);
  const pk = pvInfo && pvInfo.peaks, mid = hgt / 2;
  g.fillStyle = dim; g.globalAlpha = 0.35; g.fillRect(0, mid, w, 1); g.globalAlpha = 1;
  if (!pk || !pk.length) return;
  const pos = pvPlaying ? eng.previewPos() : -1, frac = pos >= 0 && pvInfo.duration ? pos / pvInfo.duration : -1;
  for (let x = 0; x < w; x++) {
    const a = pk[Math.min(pk.length - 1, Math.floor(x / w * pk.length))], hh = Math.max(1, a * (mid - 2));
    g.fillStyle = frac >= 0 && x / w <= frac ? accent : dim; g.globalAlpha = frac >= 0 && x / w <= frac ? 1 : 0.8;
    g.fillRect(x, mid - hh, 1, hh * 2);
  }
  g.globalAlpha = 1;
  if (frac >= 0) { g.fillStyle = accent; g.fillRect(Math.round(frac * w), 0, 1.5, hgt); const t = pvBar.querySelector('.pd'); if (t) t.textContent = mmss(pos) + ' / ' + mmss(pvInfo.duration); }
}
function fillBar() {
  const dur = pvInfo ? pvInfo.duration : 0;
  pvBar.replaceChildren(
    h('div', { class: 'pt' }, h('div', { class: 'pn' }, baseName(pvPath)), h('div', { class: 'pd' }, pvInfo ? mmss(dur) : 'memuat\u2026')),
    h('div', { class: 'pr' },
      h('button', { class: 'b pp' + (pvPlaying ? ' on' : ''), 'aria-label': pvPlaying ? 'Stop' : 'Putar', onclick: () => startPreview(pvPath) }, pvPlaying ? '\u25A0' : '\u25B6'),
      h('canvas', { onclick: () => startPreview(pvPath) }),
      h('button', { class: 'b go', onclick: () => addSample(pvPath) }, 'Tambah')));
  drawPreview();
}
function updPreview() {
  if (!aside || aside.hidden) return;
  for (const b of aside.querySelectorAll('.pv')) b.classList.toggle('on', pvPlaying && b.dataset.p === pvPath);
  for (const r of aside.querySelectorAll('.frow')) r.classList.toggle('sel', r.dataset.p === pvPath);
  if (tab !== 'file' || !pvPath) { if (pvBar) { pvBar.remove(); pvBar = null; } return; }
  if (!pvBar || !pvBar.isConnected) { pvBar = h('div', { class: 'pbar' }); aside.append(pvBar); }
  fillBar();
}
function presetRows(out, dir) {
  const i = state.sel.track, t = state.tracks[i], isInst = dir === PR.DIR_INST;
  out.push(row(isInst ? 'Simpan preset instrumen dari track terpilih\u2026' : 'Simpan preset mixer dari track terpilih\u2026', () => {
    if (!t) return toast('Pilih track dulu.');
    if (isInst && t.kind !== 'midi') return toast('Pilih track synth (MIDI) dulu.');
    ask('Nama preset', '', (n) => { const r = isInst ? PR.saveInstrumentPreset(i, n) : PR.saveMixerPreset(i, n); if (r.error) toast(r.error); else { toast('Preset tersimpan.'); setTimeout(render, 80); } });
  }, '', 'act'));
}
// ---- organising files: select several, move, rename, new folder
let selMode = false; const picked = new Set();
const topFolder = (p) => (FOLDERS_UI.find(([f]) => p === f || p.startsWith(f + '/')) || [])[0];
const baseName = (p) => p.split('/').pop();
function movedOk(from, to) { P.renamePath(from, to); }
async function moveFiles(files, destDir) {
  let ok = 0, err = '';
  for (const f of files) {
    const to = destDir + '/' + baseName(f), r = await eng.movePath(f, to);
    if (r && r.ok) { ok++; movedOk(f, to); } else err = (r && r.error) || 'gagal';
  }
  toast(ok ? `${ok} file dipindahkan ke ${destDir}.` + (err ? ' ' + err : '') : err, 3500);
  picked.clear(); selMode = false; render();
}
function newFolderIn(dir, then) {
  ask('Nama folder baru', '', async (n) => {
    n = (n || '').trim(); if (!n) return;
    const r = await eng.mkdir(dir + '/' + n);
    if (r && r.error) return toast(r.error, 3500);
    if (then) then(dir + '/' + n); else { toast('Folder dibuat.'); render(); }
  });
}
function pickFolder(files) {                          // "move to" dialog: every folder below the same top folder, plus a new one
  const top = topFolder(files[0]) || '/Samples', dirs = eng.allDirs(top);
  const body = h('div', { class: 'bigrows', style: 'max-height:46vh;overflow-y:auto;margin:6px 0' });
  let close;
  const go = (d) => { close && close(); moveFiles(files, d); };
  for (const d of dirs) body.append(row(d === top ? top.slice(1) + ' (utama)' : d.slice(top.length + 1), () => go(d), '', 'dir'));
  body.append(row('+ Folder baru\u2026', () => { close && close(); newFolderIn(top, (nd) => moveFiles(files, nd)); }, '', 'act'));
  close = modal('Pindahkan ' + files.length + ' file ke\u2026', body, [{ label: 'Batal' }]);
}
function dirMenu(full, rect) {
  const name = baseName(full);
  menu([
    { label: 'Ganti nama folder', fn: () => ask('Nama baru untuk ' + name, name, async (n) => {
      n = (n || '').trim(); if (!n || n === name) return;
      toast('Mengganti nama\u2026', 4000);
      const r = await eng.renameDir(full, n);
      if (r.error) return toast(r.error, 4000);
      const to = full.slice(0, full.lastIndexOf('/') + 1) + n;
      for (const [a, b] of r.moved || []) movedOk(a, b);
      if (path === full || (path && path.startsWith(full + '/'))) path = to + path.slice(full.length);
      toast('Folder diganti nama.'); render();
    }) },
    { label: 'Folder baru di dalamnya', fn: () => newFolderIn(full) },
    { label: 'Hapus folder beserta isinya', fn: () => modal('Hapus folder?', h('div', { class: 'hint' }, `Folder "${name}" dan semua file di dalamnya akan dihapus.`), [{ label: 'Batal' }, { label: 'Hapus', go: true, fn: async () => { await eng.deleteDir(full); toast('Folder dihapus.'); render(); } }]) },
  ], rect.left + 20, rect.top + 20);
}
function fileMenu2(full, rect) {
  const name = baseName(full);
  menu([
    { label: 'Pindahkan ke folder\u2026', fn: () => pickFolder([full]) },
    { label: 'Ganti nama', fn: () => ask('Nama baru', name, async (n) => {
      n = (n || '').trim().replace(/[\\/:*?"<>|]+/g, '_'); if (!n || n === name) return;
      const to = full.slice(0, full.lastIndexOf('/') + 1) + n, r = await eng.movePath(full, to);
      if (r && r.ok) { movedOk(full, to); toast('Nama diganti.'); } else toast((r && r.error) || 'Gagal.', 3500);
      render();
    }) },
    { label: 'Unduh ke perangkat', fn: () => eng.download(full) },
    { label: 'Hapus dari aplikasi', fn: async () => { await eng.deleteFile(full); toast('File dihapus.'); render(); } },
  ], rect.left + 20, rect.top + 20);
}

function tabFiles(list, headEl) {
  if (WEB) {
    if (!FOLDERS_UI.some(([f]) => path === f || (path && path.startsWith(f + '/')))) path = '/Samples';
    const topOf = topFolder(path);
    const places = h('div', { class: 'places' }, ...FOLDERS_UI.map(([f, l]) => h('button', { class: 'pl' + (topOf === f ? ' on' : ''), onclick: () => { path = f; picked.clear(); selMode = false; render(); } }, l)));
    const d = eng.listDir(path), items = (d && d.items) || [];
    const isPreset = path.startsWith('/Presets/');
    const out = [], hd = [], fi = FS.info(), fb = folderBar();
    hd.push(h('div', { class: 'ftb' }, fb.dot, places, h('div', { class: 'ftools' },
      h('button', { class: 'chip', 'aria-label': 'Folder baru', title: 'Folder baru', onclick: () => newFolderIn(path) }, '+'),
      !isPreset ? h('button', { class: 'chip' + (selMode ? ' on' : ''), 'aria-label': 'Pilih beberapa file', title: 'Pilih beberapa file', onclick: () => { selMode = !selMode; picked.clear(); render(); } }, '\u2611') : null,
      fi.mode !== 'device' ? h('button', { class: 'chip', onclick: doImport }, 'Impor') : null)));
    if (fb.warn) hd.push(fb.warn);
    if (path !== topOf) {                          // breadcrumb only inside a sub folder (the top folder is already shown in the strip above)
      const crumbs = h('div', { class: 'fcr' });
      let acc = topOf; crumbs.append(h('button', { class: 'chip', onclick: () => { path = topOf; picked.clear(); render(); } }, topOf.slice(1)));
      for (const part of path.slice(topOf.length).split('/').filter(Boolean)) { acc += '/' + part; const to = acc; crumbs.append('\u203a', h('button', { class: 'chip', onclick: () => { path = to; picked.clear(); render(); } }, part)); }
      hd.push(crumbs);
    }
    if (selMode) {
      const files = items.filter((x) => !x.dir).map((x) => path + '/' + x.name);
      hd.push(h('div', { class: 'fsel' },
        h('span', {}, picked.size + ' dipilih'),
        h('button', { class: 'chip', onclick: () => { if (picked.size === files.length) picked.clear(); else files.forEach((f) => picked.add(f)); render(); } }, 'Semua'),
        h('button', { class: 'chip on', onclick: () => (picked.size ? pickFolder([...picked]) : toast('Pilih file dulu.')) }, 'Pindahkan\u2026'),
        h('button', { class: 'chip', onclick: () => { if (!picked.size) return toast('Pilih file dulu.'); const fs = [...picked]; modal('Hapus file?', h('div', { class: 'hint' }, fs.length + ' file akan dihapus dari aplikasi dan folder MobileDAW.'), [{ label: 'Batal' }, { label: 'Hapus', go: true, fn: async () => { for (const f of fs) await eng.deleteFile(f); picked.clear(); toast('File dihapus.'); render(); } }]); } }, 'Hapus')));
    }
    if (path !== topOf) out.push(row('..', () => { path = (d && d.parent) || topOf; picked.clear(); render(); }, '', 'dir'));
    if (isPreset) presetRows(out, topOf);
    let n = 0;
    for (const it of items) {
      const full = path + '/' + it.name;
      if (it.dir) { n++; out.push(row(it.name, () => { path = full; picked.clear(); render(); }, it.count != null ? it.count + ' file' : '', 'dir', (rect) => dirMenu(full, rect))); continue; }
      const isAudio = AUDIO.test(it.name), isSf = SF2.test(it.name), isJson = /\.json$/i.test(it.name);
      if (!isAudio && !isSf && !(isPreset && isJson)) continue;
      n++;
      if (isPreset) out.push(row(it.name.replace(/\.json$/i, ''), () => { const r = PR.applyPresetFile(full, state.sel.track); toast(r.error || r.msg, r.error ? 4000 : 2200); }, kb(it.size), '', (rect) => fileMenu(full, rect)));
      else if (selMode) { const r = row((picked.has(full) ? '\u2611 ' : '\u2610 ') + it.name, () => { if (picked.has(full)) picked.delete(full); else picked.add(full); render(); }, kb(it.size), picked.has(full) ? 'on' : ''); out.push(r); }
      else {
        const r = row(it.name, () => (isSf ? useSoundFont(full) : addSample(full)), kb(it.size), 'frow' + (pvPath === full ? ' sel' : ''), (rect) => fileMenu2(full, rect), isAudio && !pending ? sampleDrag(full) : null);
        r.dataset.p = full;
        if (isAudio) {
          const b = h('button', { class: 'pv' + (pvPlaying && pvPath === full ? ' on' : ''), 'aria-label': 'Putar preview', 'data-p': full });
          b.addEventListener('pointerdown', (e) => e.stopPropagation());
          b.addEventListener('pointerup', (e) => { e.stopPropagation(); startPreview(full); });
          r.prepend(b);
        }
        out.push(r);
      }
    }
    const i = FS.info(), where = i.mode === 'device' ? i.name + '/' + path.slice(1) : 'MobileDAW' + path;
    if (!n && i.mode === 'device' && i.scanErr > 0) out.push(h('div', { class: 'hint' }, `Folder ${where} tidak bisa dibaca penuh (${i.scanErr} item gagal). Ketuk Segarkan lagi; kalau tetap gagal, pilih ulang folder MobileDAW (lihat Pengaturan \u2192 Log).`));
    else if (!n) out.push(h('div', { class: 'hint' }, `Folder ${where} masih kosong.` + (i.mode === 'device' ? ' Salin file ke folder ini dengan aplikasi File, lalu ketuk Segarkan.' : isPreset ? '' : ' Pilih folder MobileDAW di atas agar sample bisa langsung dipakai dari penyimpanan, atau impor file sekali.')));
    list.append(...out);
    if (headEl) headEl.append(...hd);
    return;
  }
  if (!eng.hasStorage()) {
    list.append(h('div', { class: 'hint' }, 'Izin "Akses semua file" diperlukan agar sample dan preset di memori internal bisa dibaca. Tanpa izin, hanya folder aplikasi yang tersedia.',
      h('div', {}, h('button', { class: 'b', onclick: () => eng.requestStorage() }, 'Beri izin'), ' ', h('button', { class: 'b', onclick: () => render() }, 'Cek lagi'))));
  }
  home = home || eng.home();
  if (!path) path = home + '/Samples';
  const d = eng.listDir(path);
  const items = (d && d.items) || [];
  const out = [h('div', { class: 'row', style: 'min-height:30px;color:var(--dim);font-size:11px;word-break:break-all' }, path)];
  if (d && d.parent && path !== home) out.push(row('..', () => { path = d.parent; render(); }, '', 'dir'));
  for (const it of items) {
    if (it.dir) out.push(row(it.name, () => { path = path + '/' + it.name; render(); }, '', 'dir'));
    else if (AUDIO.test(it.name)) out.push(row(it.name, () => addSample(path + '/' + it.name), kb(it.size)));
  }
  if (!items.length) out.push(h('div', { class: 'hint' }, 'Folder kosong. Letakkan sample WAV/MP3/FLAC/OGG di ' + home + '/Samples.'));
  list.append(...out);
}

let demoBusy = false;
function tabProjects(list) {
  const dir = WEB ? '/Projects' : (home = home || eng.home()) + '/Projects';
  const save = () => ask('Nama proyek', state.projectName === 'Untitled' ? '' : state.projectName, (n) => {
    n = (n || '').trim().replace(/[^\w\- ]+/g, '');
    if (!n) return;
    state.projectName = n; eng.writeText(dir + '/' + n + '.mdaw', P.serialize()); toast('Tersimpan: ' + n); setTimeout(render, 60);
  });
  list.append(...[
    row('Simpan proyek\u2026', save),
    WEB ? row('Unduh proyek ke perangkat', () => { const n = (state.projectName || 'Untitled').replace(/[^\w\- ]+/g, '') || 'Untitled'; eng.writeText(dir + '/' + n + '.mdaw', P.serialize()); setTimeout(() => eng.download(dir + '/' + n + '.mdaw'), 80); }) : null,
    WEB ? row('Buka proyek (.mdaw / .zip) dari perangkat\u2026', async () => { const f = await eng.importFiles('.mdaw,.zip'); if (f.length) { toast('Proyek diimpor.'); render(); } }) : null,
    row('Proyek baru (demo)', () => { P.newProject(true); closeBrowser(); }),
    row('Proyek baru (kosong)', () => { P.newProject(false); closeBrowser(); }),
    head('Demo song (instrumen virtual)'),
    ...DEMOS.map((d) => row(d.title, async () => {
      if (demoBusy) return;
      demoBusy = true;
      try {
        const miss = await openDemo(d, (k, n) => toast('Menyiapkan demo\u2026 ' + k + '/' + n, 1500));
        closeBrowser(); toast(miss.length ? miss.length + ' file sample/SoundFont tidak ditemukan.' : d.title + ' dibuka. Tekan Play.');
      } catch (e) { toast('Demo gagal dibuka: ' + ((e && e.message) || e), 4500); }
      demoBusy = false;
    }, d.time)),
    head('Proyek tersimpan')].filter(Boolean));
  const d = eng.listDir(dir);
  const files = ((d && d.items) || []).filter((x) => !x.dir && /\.mdaw$/i.test(x.name) && !isAutosave(x.name));
  if (!files.length) list.append(h('div', { class: 'hint' }, 'Belum ada proyek tersimpan. Proyek yang sedang dibuka disimpan otomatis setiap 5 detik.'));
  for (const f of files) {
    const full = dir + '/' + f.name;
    list.append(row(f.name.replace(/\.mdaw$/i, ''), async () => {
      try {
        const miss = await P.deserialize(eng.readText(full));
        closeBrowser(); toast(miss.length ? miss.length + ' file sample/SoundFont tidak ditemukan.' : 'Proyek dibuka.');
      } catch (e) { toast('Proyek rusak atau tidak bisa dibaca' + (e && e.message ? ': ' + e.message : '.'), 4500); }
    }, kb(f.size), '', WEB ? (rect) => fileMenu(full, rect) : null));
  }
}

let q = '', cat = 'all';
const TABS = [['instr', 'Instrumen'], ['fx', 'Efek Audio'], ['file', 'Sample'], ['preset', 'Preset'], ['proj', 'Proyek']];
const HOLD = { instr: 'Cari instrumen\u2026', fx: 'Cari efek\u2026', file: 'Cari sample\u2026', preset: 'Cari preset\u2026', proj: 'Cari proyek\u2026' };
function chipsFor() {
  if (tab === 'instr') return [['all', 'Semua'], ['track', 'Track baru'], ['instr', 'Instrumen']];
  if (tab === 'fx') return [['all', 'Semua'], ...FX_GROUPS.map((g) => [g[0], g[1]])];
  if (tab === 'preset') return [['all', 'Semua'], ['usr', 'Saya'], ['mix', 'Mixer'], ...Object.keys(PRESETS).filter((k) => INSTRUMENTS[k]).map((k) => ['i' + k, INSTRUMENTS[k].name])];
  return [];
}
function applyFilter(list, cnt) {              // hides rows / section heads that do not match the search text or the category chip
  let g = '', shown = 0, headEl = null, headHas = false;
  const closeHead = () => { if (headEl) headEl.hidden = (q || cat !== 'all') ? !headHas : false; };
  for (const el of list.children) {
    if (el.style.pointerEvents === 'none') { closeHead(); headEl = el; headHas = false; g = el.dataset.g || ''; continue; }
    const ok = (!q || el.textContent.toLowerCase().includes(q)) && (cat === 'all' || !g || g === cat);
    el.hidden = !ok; if (ok) { shown++; headHas = true; }
  }
  closeHead();
  if (cnt) cnt.textContent = (q || cat !== 'all') ? String(shown) : '';
  const c = aside && aside.querySelector('.sclr'); if (c) c.hidden = !(q || cat !== 'all');
}
function render() {
  if (tab !== 'file') stopPreview();
  if (tab === 'file') stopAudition();
  const cl = chipsFor(); if (!cl.some(([k]) => k === cat)) cat = 'all';
  const tabs = h('div', { class: 'btabs' },
    h('div', { class: 'bt' }, ...TABS.map(([k, l]) => h('button', { class: 'b' + (tab === k ? ' on' : ''), onclick: () => { if (tab !== k) { stopAudition(); cat = 'all'; } tab = k; render(); } }, l))),
    h('button', { class: 'b bx' + (pinned ? ' pinon' : ''), 'aria-label': 'Sematkan', title: 'Sematkan: drawer tetap terbuka saat arrangement disentuh', onclick: () => { pinned = !pinned; prefs.browserPin = pinned; savePrefs(); toast(pinned ? 'Drawer disematkan: tetap terbuka.' : 'Drawer menutup saat arrangement disentuh.', 1800); render(); } }, 'Pin'),
    h('button', { class: 'b bx', 'aria-label': 'Tutup', onclick: closeBrowser }, '\u2715'));
  const list = h('div', { class: 'blist' }), bhead = h('div', { class: 'bfhead' });
  if (tab === 'instr') list.append(...tabInstr()); else if (tab === 'fx') list.append(...tabFx()); else if (tab === 'file') tabFiles(list, bhead); else if (tab === 'preset') list.append(...tabPreset()); else tabProjects(list);
  const cnt = h('span', { class: 'cnt' });
  const search = h('input', { type: 'search', class: 'bsearch', placeholder: HOLD[tab], value: q, oninput: (e) => { q = e.target.value.trim().toLowerCase(); applyFilter(list, cnt); } });
  const clr = h('button', { class: 'sclr', 'aria-label': 'Hapus pencarian', onclick: () => { q = ''; cat = 'all'; render(); } }, '\u2715');
  const sbar = h('div', { class: 'sbar' }, h('span', { class: 'sico' }), search, cnt, clr);
  const chips = h('div', { class: 'chips' }, ...cl.map(([k, l]) => h('button', { class: 'chip' + (cat === k ? ' on' : ''), onclick: () => { cat = k; render(); } }, l)));
  pvBar = null;
  aside.replaceChildren(tabs, sbar, chips, bhead, list);
  { const on = aside.querySelector('.bt .b.on'); if (on) { const pn = on.parentNode; pn.scrollLeft = on.offsetLeft - (pn.clientWidth - on.offsetWidth) / 2; } }
  { const on = aside.querySelector('.places .pl.on'); if (on) { const pn = on.parentNode; pn.scrollLeft = on.offsetLeft - (pn.clientWidth - on.offsetWidth) / 2; } }   // keep the active place centred in the strip
  applyFilter(list, cnt);
  curKey = tab + '|' + (tab === 'file' ? path : '');
  list.scrollTop = scrollMem.get(curKey) || 0;       // coming back to a folder (or re-rendering it) keeps the scroll position
  { const key = curKey; list.addEventListener('scroll', () => scrollMem.set(key, list.scrollTop), { passive: true }); }
  if (WEB && path && prefs.browserPath !== path) { prefs.browserPath = path; savePrefs(); }   // the last folder survives closing the drawer and reloading the app
  if (tab === 'file' && pvPath) updPreview();
}

window.addEventListener('libchange', () => { if (aside && !aside.hidden) { try { render(); } catch (e) { console.error('browser libchange', e); } } });   // background check found changed files
export function initBrowser(el) {
  aside = el;
  P.onChange((w) => { if (!aside.hidden && (tab === 'instr' || tab === 'fx' || tab === 'preset') && (w === 'sel' || w === 'tracks') && !dg) render(); if (w === 'all') stopAudition(); });
}
