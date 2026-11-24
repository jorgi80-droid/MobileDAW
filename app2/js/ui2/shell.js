// MobileDAW 2: the main screen for touch (a separate app; MobileDAW 1.0 lives in the repository root). The engine, the project format, the
// timeline canvas, the editors and the devices come from 1.0; the frame around them is 2.0's own:
//   - a transport bar at the BOTTOM (Mixer / Rack / Sounds on the left, record / back to start / play / tempo / metronome / loop in the
//     middle, undo / redo / CPU / keyboard on the right), labels under the icons;
//   - a narrow track column on the LEFT (one coloured tile per track with its kind's icon; a tap widens it: name, on / off, solo, pan, volume);
//   - a tap on a clip shows action bubbles over it (Copy / Delete / Snap / Edit / More), a double tap still opens the editor;
//   - the logo button (top right) opens the main menu, a panel that slides in from the right with tabs (Lagu, Proyek, Ekspor, Pengaturan, Bantuan).
// Workflow ideas from mobile DAWs; the look (rounded-square controls, outline icons, the theme's own colours) is MobileDAW's own.
import { $, h, menu, toast, ask, clamp } from '../ui.js';
import { prefs, savePrefs } from '../prefs.js';
import * as P from '../project.js';
import * as TL from '../timeline.js';
import { checkpoint, canUndo, canRedo, undoOp, redoOp } from '../history.js';
import * as PN from './panels.js';
import { fpsNow } from '../fps.js';
import * as QS from '../quicksave.js';
import * as PM from '../projects.js';
import * as BR from '../browser.js';
import { gestureTiming, haptic } from '../gesture.js';
import { THEME_NAMES, applyTheme, currentTheme } from '../theme.js';
const { state } = P;

let api = null, on = false;
export const active = () => on;

// ------------------------------------------------------------------ icons (outline, 24 x 24, drawn for MobileDAW 2.0)
const S = (d, fill) => `<svg viewBox="0 0 24 24" aria-hidden="true" class="${fill ? 'f' : ''}">${d}</svg>`;
const IC = {
  mixer: S('<path d="M6 3v18M12 3v18M18 3v18"/><rect x="3.5" y="13" width="5" height="3" rx="1"/><rect x="9.5" y="6" width="5" height="3" rx="1"/><rect x="15.5" y="10" width="5" height="3" rx="1"/>'),
  rack: S('<rect x="3.5" y="4" width="17" height="5" rx="1.6"/><rect x="3.5" y="11" width="17" height="5" rx="1.6"/><path d="M6.5 19.5h11"/><circle cx="7" cy="6.5" r=".9"/><circle cx="7" cy="13.5" r=".9"/>'),
  sounds: S('<path d="M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 19 8h-7l-2-2.5H5A1.5 1.5 0 0 0 3.5 7z"/><path d="M14 11v5.2"/><circle cx="12.6" cy="16.4" r="1.5"/>'),
  rec: S('<circle cx="12" cy="12" r="6"/>', true),
  rew: S('<path d="M6 6v12M18 6.5v11L9 12z"/>'),
  play: S('<path d="M8.5 5.8v12.4L18.5 12z"/>', true),
  pause: S('<path d="M8 6h3v12H8zM13 6h3v12h-3z"/>', true),
  metro: S('<path d="M9 3.5h6l3.5 17h-13z"/><path d="M12 15l4.5-8"/><path d="M8 16.5h8"/>'),
  loop: S('<path d="M4.5 12V10a4 4 0 0 1 4-4H18l-2.5-2.5M19.5 12v2a4 4 0 0 1-4 4H6l2.5 2.5"/>'),
  undo: S('<path d="M9 7.5 4.5 12 9 16.5"/><path d="M5 12h9.5a5 5 0 0 1 0 10H12"/>'),
  redo: S('<path d="M15 7.5 19.5 12 15 16.5"/><path d="M19 12H9.5a5 5 0 0 0 0 10H12"/>'),
  keys: S('<rect x="3" y="6" width="18" height="12" rx="1.8"/><path d="M8 6v12M12 6v12M16 6v12"/><path d="M6.5 6v6.5M10 6v6.5M14 6v6.5M17.5 6v6.5" stroke-width="2.6"/>'),
  keysOff: S('<path d="M5 8h10.5v10.5"/><path d="M5 5l14 14" />'),
  magnet: S('<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 8h3.5M14.5 8H18"/><path d="M9.5 4v8a2.5 2.5 0 0 0 5 0V4"/>'),
  follow: S('<path d="M4 12h11"/><path d="M11 7.5 15.5 12 11 16.5"/><path d="M19 5v14"/>'),
  save: S('<path d="M5 4.5h11l3.5 3.5v11.5h-14.5z"/><path d="M8 4.5v5h7v-5"/><rect x="8" y="13.5" width="8" height="6" rx="1"/>'),
  arrange: S('<rect x="3.5" y="5" width="9" height="4.5" rx="1.4"/><rect x="8.5" y="11.5" width="12" height="4.5" rx="1.4"/><path d="M3.5 19.5h17"/>'),
  menu: S('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  lane: S('<path d="M5 19V9M10 19V5M15 19v-7M20 19v-4"/>'),
  down: S('<path d="M6 9l6 6 6-6"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  close: S('<path d="M6 6l12 12M18 6 6 18"/>'),
  dup: S('<rect x="3.5" y="6" width="8" height="12" rx="1.6"/><rect x="12.5" y="6" width="8" height="12" rx="1.6" stroke-dasharray="2.2 1.8"/><path d="M16.5 10v4M14.5 12h4"/>'),
  paste: S('<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3h6v1.5"/><path d="M9 11h6M9 15h4"/>'),
  copy: S('<rect x="8" y="8" width="11.5" height="11.5" rx="2"/><path d="M5 15.5V6.5A1.5 1.5 0 0 1 6.5 5H15"/>'),
  trash: S('<path d="M5 7h14M10 7V4.8h4V7M7 7l1 12.5h8L17 7"/>'),
  snap: S('<path d="M5 4v16M19 4v16"/><path d="M8 12h8M13.5 9.5 16 12l-2.5 2.5M10.5 9.5 8 12l2.5 2.5"/>'),
  edit: S('<path d="M4.5 19.5 5.5 15 15.8 4.7a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L9 18.5z"/><path d="M13.8 6.7l3.5 3.5"/>'),
  more: S('<circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/>', true),
  power: S('<path d="M12 4v7"/><path d="M7.2 7.2a7 7 0 1 0 9.6 0"/>'),
  piano: S('<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M8 5v14M12 5v14M16 5v14"/><path d="M6.6 5v7.5M10.6 5v7.5M14.6 5v7.5M18.2 5v7.5" stroke-width="2.4"/>'),
  drum: S('<rect x="4" y="5" width="4.2" height="4.2" rx="1"/><rect x="9.9" y="5" width="4.2" height="4.2" rx="1"/><rect x="15.8" y="5" width="4.2" height="4.2" rx="1"/><rect x="4" y="10.9" width="4.2" height="4.2" rx="1"/><rect x="9.9" y="10.9" width="4.2" height="4.2" rx="1"/><rect x="15.8" y="10.9" width="4.2" height="4.2" rx="1"/><rect x="4" y="16.8" width="4.2" height="2.6" rx="1"/><rect x="9.9" y="16.8" width="4.2" height="2.6" rx="1"/><rect x="15.8" y="16.8" width="4.2" height="2.6" rx="1"/>'),
  wave: S('<path d="M3 12h2M6.5 8v8M9.5 5v14M12.5 9v6M15.5 6.5v11M18.5 10v4M21 12h0"/>'),
  auto: S('<path d="M3 17c3 0 4-9 7-9s3.5 7 6.5 7 3-4 4.5-4"/><circle cx="10" cy="8" r="1.5"/><circle cx="16.5" cy="15" r="1.5"/>'),
  bus: S('<path d="M5 19V10M9.5 19V5M14 19v-7M18.5 19V8"/>'),
  back: S('<path d="M14.5 6 8.5 12l6 6"/>'),
};
// the track header's fold button (Live): a ring with a triangle, down = open, right = folded
const FOLD = (folded) => `<i class="tc-fold" aria-label="Lipat track"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/><path d="${folded ? 'M8 6l5 4-5 4z' : 'M6 8h8l-4 5z'}"/></svg></i>`;
const kindIcon = (t) => (t.kind === 'drum' ? IC.drum : t.kind === 'audio' ? IC.wave : t.kind === 'auto' ? IC.auto : IC.piano);
const btn = (cls, ic, label, aria) => { const b = h('button', { class: 'u2b ' + cls, 'aria-label': aria || label || '' }); b.innerHTML = ic + (label ? `<span class="lb">${label}</span>` : ''); return b; };

// ------------------------------------------------------------------ bottom bar
let bar, el = {};
// Two bars with fixed places, balanced left / centre / right:
//   top:    menu + song name + undo / redo  |  back to start, record, play + the clock  |  Snap, Loop, Ikuti, metronome, BPM, save
//   bottom: + Track  |  the views (Aransemen, Mixer, Rack, Suara, Keys), equal widths  |  CPU
// Nothing sits over the ruler or the clips (the clip tools are a rail at the right edge of the lanes).
function buildBar() {
  const top = h('header', { id: 'top2' });
  const L = h('div', { class: 't2-l' }), M = h('div', { class: 't2-c' }), R = h('div', { class: 't2-r' });
  logo = btn('ic', IC.menu, '', 'Menu utama'); logo.id = 'logo2';
  title = h('button', { id: 'title2', 'aria-label': 'Nama lagu' }, h('b', null, ''), h('span', null, 'Lagu'));
  el.undo = btn('ic', IC.undo, '', 'Urungkan'); el.redo = btn('ic', IC.redo, '', 'Ulangi');
  L.append(logo, title, h('i', { class: 'sep' }), el.undo, el.redo);
  el.rew = btn('tp', IC.rew, '', 'Kembali ke awal'); el.rec = btn('tp rec', IC.rec, '', 'Rekam'); el.play = btn('tp play', IC.play, '', 'Play / pause');
  el.clock = h('button', { class: 'clock', 'aria-label': 'Posisi' }, h('b', null, '1.1.1'), h('span', null, '0:00'));
  M.append(h('div', { class: 'tpill' }, el.rew, el.rec, el.play), el.clock);
  const pill = (ic, label, aria) => btn('pill', ic, label, aria);
  tools = { snap: pill(IC.magnet, 'Snap', 'Snap ke grid'), loop: pill(IC.loop, 'Loop', 'LOOP'), follow: pill(IC.follow, 'Ikuti', 'Ikuti playhead'), save: btn('ic save', IC.save, '', 'Simpan') };
  el.metro = pill(IC.metro, '', 'Metronom');
  el.bpm = h('button', { class: 'u2b bpm', 'aria-label': 'Tempo' }, h('b', null, '120'), h('span', { class: 'lb' }, 'BPM'));
  R.append(h('div', { class: 'tg' }, tools.loop, tools.follow, el.metro), el.bpm, tools.save);   // Snap sits in the corner above the track column (buildCol)
  top.append(L, M, R);
  $('#app').insertBefore(top, $('#body'));

  bar = h('footer', { id: 'bar2' });
  const BL = h('div', { class: 'b2-l' }), BM = h('nav', { class: 'b2-c' }), BR2 = h('div', { class: 'b2-r' });
  el.add = btn('tab add', IC.plus, 'Track', 'Tambah track');
  el.arr = btn('tab', IC.arrange, 'Aransemen', 'ARANSEMEN'); el.mix = btn('tab', IC.mixer, 'Mixer', 'MIXER'); el.rack = btn('tab', IC.rack, 'Rack', 'RACK');
  el.snd = btn('tab', IC.sounds, 'Suara', 'SUARA'); el.keys = btn('tab', IC.keys, 'Keys', 'Keyboard');
  el.cpu = h('button', { class: 'u2cpu', 'aria-label': 'Performa' }, h('b', null, 'CPU 0 %'), h('span', null, '60 FPS'));
  for (const [b, k] of [[el.rack, 'fx'], [el.mix, 'solo']]) b.append(h('i', { class: 'bdg', 'data-k': k }));   // badges: effects on the track / a solo is on
  BL.append(el.add); BM.append(el.arr, el.mix, el.rack, el.snd, el.keys); BR2.append(el.cpu);
  bar.append(BL, BM, BR2);
  $('#app').append(bar);

  logo.onclick = () => (mm.classList.contains('open') ? closeMenu() : openMenu());
  title.onclick = () => openMenu('proyek');
  el.clock.onclick = () => P.seekTo(0);
  el.undo.onclick = undoOp; el.redo.onclick = redoOp;
  el.rew.onclick = () => P.seekTo(0);
  el.rec.onclick = () => api.toggleRec();
  el.play.onclick = () => P.togglePlay();
  el.metro.onclick = () => P.toggleMetro();
  holdTap(tools.snap, () => { TL.v2SnapToggle(); syncSnap(); }, () => { const r = tools.snap.getBoundingClientRect(); TL.v2SnapMenu(r.left, r.bottom + 4); });
  tools.follow.onclick = () => { TL.v2SetFollow(!TL.v2Follow()); syncSnap(); };
  tools.loop.onclick = () => { P.setLoop({ on: !state.loop.on }); syncSnap(); toast(state.loop.on ? 'Loop nyala.' : 'Loop mati.', 900); };
  holdTap(tools.save, () => QS.quickSave(), () => QS.saveAs());
  el.add.onclick = () => { const r = el.add.getBoundingClientRect(); TL.v2AddMenu(r.left, r.top - 170); };
  el.arr.onclick = () => { closeMenu(); if (BR.isOpen()) BR.closeBrowser(); if (api.getView() !== 'arr') api.showView('arr'); api.setShut(true); };
  el.mix.onclick = () => { closeMenu(); api.showView(api.getView() === 'mix' ? 'arr' : 'mix'); };
  el.rack.onclick = () => togglePanel('dev');
  el.keys.onclick = () => togglePanel('keys');
  el.snd.onclick = () => { closeMenu(); BR.toggleBrowser(); };
  el.cpu.onclick = () => PN.openPerfPanel();
  { // BPM: tap = the Tempo window (tap tempo, time signature), a vertical drag = change the tempo
    const b = el.bpm; let d = null;
    // the tap opens the window from 'click' (reliable for touch too); a drag that changed the tempo swallows that click
    let dragged = false;
    b.addEventListener('pointerdown', (e) => { try { b.setPointerCapture(e.pointerId); } catch (_) { /* gone */ } d = { y: e.clientY, b: state.bpm, moved: false }; dragged = false; });
    b.addEventListener('pointermove', (e) => { if (!d) return; const dy = d.y - e.clientY; if (!d.moved && Math.abs(dy) > 10) { d.moved = true; dragged = true; d.y = e.clientY; } if (d.moved) P.setBpm(clamp(Math.round(d.b + (d.y - e.clientY) * 0.25), 20, 999)); });
    b.addEventListener('pointerup', () => { d = null; });
    b.addEventListener('pointercancel', () => { d = null; });
    b.addEventListener('click', () => { if (dragged) { dragged = false; return; } PN.openTempoPanel(); });
  }
}
function togglePanel(t) {
  closeMenu();
  if (api.getView() !== 'arr') api.showView('arr');
  if (api.getTab() === t && !api.isShut()) api.setShut(true); else api.showTab(t);
}
let last = '';
export function readouts() {
  if (!on) return;
  PN.sample();
  { const f = Math.round(fpsNow() || 0) + ' FPS'; if (el.cpu.lastChild.textContent !== f) el.cpu.lastChild.textContent = f; }
  const tab = api.getTab(), shut = api.isShut(), v = api.getView();
  const t = state.tracks[state.sel.track], nfx = t && t.devices ? t.devices.length : 0, solo = state.tracks.some((q) => q.solo);
  { const p = Math.max(0, state.pos), bi = P.barAt(p), bt = P.beatLenAt(p), off = p - P.barStart(bi), pos = `${bi + 1}.${Math.floor(off / bt) + 1}.${Math.floor((off % bt) / Math.max(60, bt / 4)) + 1}`;
    const sec = P.tickToSec(p), tt = Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0'), nm = state.projectName || 'Tanpa nama';
    if (el.clock._p !== pos || el.clock._t !== tt) { el.clock._p = pos; el.clock._t = tt; el.clock.firstChild.textContent = pos; el.clock.lastChild.textContent = tt; }
    if (title._n !== nm) { title._n = nm; title.firstChild.textContent = nm; } }
  const k = [state.playing, P.rec.on, state.metro, state.loop.on, Math.round(state.bpm * 100), canUndo(), canRedo(), v, tab, shut, BR.isOpen(), Math.round(state.cpu * 100), nfx, solo].join('|');
  if (k === last) return; last = k;
  el.play.innerHTML = state.playing ? IC.pause : IC.play; el.play.classList.toggle('on', !!state.playing);
  el.rec.classList.toggle('on', !!P.rec.on); el.metro.classList.toggle('on', !!state.metro); syncSnap();
  el.bpm.firstChild.textContent = Number.isInteger(state.bpm) ? String(state.bpm) : state.bpm.toFixed(1);
  el.undo.disabled = !canUndo(); el.redo.disabled = !canRedo();
  el.arr.classList.toggle('on', v === 'arr' && shut && !BR.isOpen()); el.mix.classList.toggle('on', v === 'mix'); el.rack.classList.toggle('on', v === 'arr' && tab === 'dev' && !shut); el.keys.classList.toggle('on', v === 'arr' && tab === 'keys' && !shut);
  el.snd.classList.toggle('on', BR.isOpen());
  { const a = el.rack.querySelector('.bdg'), b = el.mix.querySelector('.bdg'); a.textContent = nfx ? String(nfx) : ''; a.hidden = !nfx; b.textContent = 'S'; b.hidden = !solo; }
  const c = Math.round(clamp(state.cpu * 100, 0, 999)); el.cpu.firstChild.textContent = 'CPU ' + c + ' %'; el.cpu.classList.toggle('hot', c > 80); el.cpu.classList.toggle('warm', c > 55 && c <= 80);
}

// ------------------------------------------------------------------ track column (left of the timeline)
let col, rowsEl, topEl, addEl, colSig = '';
const wide = () => !!prefs.ui2Wide;
function buildCol() {
  const va = $('#view-arr');
  col = h('div', { id: 'tcol2' });
  topEl = h('div', { class: 'tc-top' }, tools.snap);   // the empty corner left of the ruler holds Snap (tap = on / off, long press = grid)
  rowsEl = h('div', { class: 'tc-rows' });
  col.append(topEl, rowsEl);
  va.prepend(col);
  // a vertical drag anywhere on the column scrolls the tracks with the timeline
  let d = null;
  rowsEl.addEventListener('pointerdown', (e) => { if (e.target.closest('.tc-pan, .tc-vol, .tc-b')) return; d = { y: e.clientY, id: e.pointerId, moved: false }; }, true);
  rowsEl.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return; const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) > gestureTiming().slop) { d.moved = true; try { rowsEl.setPointerCapture(e.pointerId); } catch (_) { /* gone */ } }
    if (d.moved) { TL.v2Scroll(-dy); d.y = e.clientY; }
  });
  const end = (e) => { if (d && d.moved) { const kill = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; rowsEl.addEventListener('click', kill, { capture: true, once: true }); setTimeout(() => rowsEl.removeEventListener('click', kill, true), 0); } d = null; };
  rowsEl.addEventListener('pointerup', end); rowsEl.addEventListener('pointercancel', end);
  rowsEl.addEventListener('wheel', (e) => { TL.v2Scroll(e.deltaY); e.preventDefault(); }, { passive: false });
  applyWide();
}
function applyWide() { document.documentElement.classList.toggle('tc-wide', wide()); colSig = ''; requestAnimationFrame(() => { TL.fitNow(); }); }
function syncSnap() { if (!tools) return; tools.snap.classList.toggle('on', TL.v2SnapOn()); tools.snap.querySelector('.lb').textContent = TL.v2SnapOn() ? 'Snap ' + TL.v2SnapName() : 'Snap'; tools.follow.classList.toggle('on', TL.v2Follow()); tools.loop.classList.toggle('on', !!state.loop.on); }
// tap / long press on one element (the long press does not also fire the tap)
function holdTap(b, tap, long) {
  let t = 0, fired = false;
  b.addEventListener('pointerdown', (e) => { fired = false; clearTimeout(t); t = setTimeout(() => { fired = true; haptic(10); long(e); }, gestureTiming().longMs); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => clearTimeout(t));
  b.addEventListener('pointermove', (e) => { if (e.buttons && (Math.abs(e.movementY) > 2 || Math.abs(e.movementX) > 2)) clearTimeout(t); });
  b.addEventListener('click', (e) => { if (fired) { fired = false; e.preventDefault(); return; } tap(e); });
}
const VMAX = 1.4;
function rowEl(kind, i) {
  const r = h('div', { class: 'tc-row' });
  const tile = h('button', { class: 'tc-tile', 'aria-label': 'Track' });
  r.append(tile);
  if (kind === 'trk') {
    // wide column: the name with Mute / Solo / Rekam, and the pan under it (the volume is in the Mixer)
    const name = h('button', { class: 'tc-name' }), mu = h('button', { class: 'tc-b tc-m', 'aria-label': 'Mute' }, 'M'), so = h('button', { class: 'tc-b tc-solo', 'aria-label': 'Solo' }, 'S'), rc = h('button', { class: 'tc-b tc-rec', 'aria-label': 'Rekam' }, h('i'));
    // the volume fader stays the long bar; the pan is its own small ring next to M / S / R (drag sideways, double tap = centre)
    const pan = h('div', { class: 'tc-pan tc-ring', 'aria-label': 'Pan' }, h('i')), vol = h('div', { class: 'tc-vol', 'aria-label': 'Volume' }, h('i'), h('em')), db = h('span', { class: 'db' });
    name.append(h('span', { class: 'nm' }), h('span', { class: 'tc-bs' }, pan, mu, so, rc)); r.append(name, h('div', { class: 'tc-ctl' }, vol, db));
    dragVal(vol, 'x', () => Math.sqrt(clamp(state.tracks[r._i].vol / VMAX, 0, 1)), (u) => P.setVol(r._i, u * u * VMAX), () => P.setVol(r._i, 1));
    mu.onclick = (e) => { e.stopPropagation(); P.toggleMute(r._i); colSig = ''; };
    so.onclick = (e) => { e.stopPropagation(); P.toggleSolo(r._i); colSig = ''; };
    rc.onclick = (e) => { e.stopPropagation(); P.toggleArm(r._i); colSig = ''; };
    holdTap(name, () => P.selectTrack(r._i), () => { const b = name.getBoundingClientRect(); TL.v2HeadMenu(r._i, b.left + 20, b.bottom); });
    dragVal(pan, 'x', () => (clamp(state.tracks[r._i].pan, -1, 1) + 1) / 2, (u) => P.setPan(r._i, Math.round((u * 2 - 1) * 100) / 100), () => P.setPan(r._i, 0));
  }
  // the tile: tap = widen / narrow the column (and select the track), long press = the track menu
  tile.addEventListener('click', (e) => { const f = e.target.closest && e.target.closest('.tc-fold'); if (!f) return; e.stopPropagation(); e.preventDefault(); if (r._kind === 'trk') { TL.v2Fold(r._i); colSig = ''; } }, true);
  holdTap(tile, () => {
    if (r._kind === 'trk') P.selectTrack(r._i); else if (r._kind === 'x') P.selectTrack(r._strip);
    prefs.ui2Wide = !wide(); savePrefs(); applyWide();
  }, () => { const b = tile.getBoundingClientRect(); if (r._kind === 'trk') TL.v2HeadMenu(r._i, b.right, b.top); else if (r._kind === 'x') TL.v2XHeadMenu(r._i, b.right, b.top); });
  return r;
}
// a value control dragged along one axis (relative: the value follows the finger's distance), double tap = its default
function dragVal(e, axis, get, set, reset) {
  let d = null, lastTap = 0;
  e.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation(); e.setPointerCapture(ev.pointerId);
    const now = performance.now(); if (now - lastTap < gestureTiming().dtapMs) { checkpoint(); reset(); lastTap = 0; colSig = ''; return; } lastTap = now;
    d = { p: axis === 'x' ? ev.clientX : ev.clientY, u: get(), moved: false };
  });
  e.addEventListener('pointermove', (ev) => {
    if (!d) return; const p = axis === 'x' ? ev.clientX : ev.clientY, span = axis === 'x' ? Math.max(100, e.clientWidth) : 120;
    const du = (axis === 'x' ? p - d.p : d.p - p) / span; if (!d.moved && Math.abs(du) * span < 3) return;
    if (!d.moved) { d.moved = true; checkpoint(); }
    set(clamp(d.u + du, 0, 1)); colSig = '';
  });
  const end = () => { d = null; }; e.addEventListener('pointerup', end); e.addEventListener('pointercancel', end);
}
function syncCol() {
  if (!col) return;
  const g = TL.v2Geom(), n = g.n, nn = n + g.nx;
  topEl.style.height = g.ruler + 'px'; col.style.setProperty('--tc-top', g.ruler + 'px');
  const parts = [wide(), state.sel.track];
  for (let i = 0; i < n; i++) { const t = state.tracks[i]; parts.push(t.id, t.kind, t.name, t.color, t.mute, t.solo, !!t.arm, Math.round(t.vol * 100), Math.round(t.pan * 100), !!t.fold); }
  for (let i = n; i < nn; i++) { const x = TL.v2XRow(i); parts.push(x.name, x.color); }
  const sig = parts.join('|');
  if (sig !== colSig) {
    colSig = sig;
    const want = nn; let kids = [...rowsEl.querySelectorAll('.tc-row')];
    while (kids.length > want) kids.pop().remove();
    for (let i = 0; i < want; i++) {
      const kind = i < n ? 'trk' : 'x';
      let r = kids[i];
      if (!r || r._kind !== kind) { const nr = rowEl(kind, i); nr._kind = kind; if (r) r.replaceWith(nr); else rowsEl.append(nr); r = nr; kids[i] = r; }
      r._i = i;
      const tile = r.firstChild;
      if (kind === 'trk') {
        const t = state.tracks[i]; r.style.setProperty('--tc', t.color); tile.innerHTML = FOLD(!!t.fold) + '<span class="tc-nm"></span>'; tile.lastChild.textContent = t.name;
        r.classList.toggle('sel', state.sel.track === i); r.classList.toggle('muted', !!t.mute); r.classList.toggle('auto', t.kind === 'auto'); r.classList.toggle('fold', !!t.fold);
        r.querySelector('.tc-name .nm').textContent = t.name;
        r.querySelector('.tc-m').classList.toggle('on', !!t.mute); r.querySelector('.tc-solo').classList.toggle('on', !!t.solo);
        const rc = r.querySelector('.tc-rec'); rc.classList.toggle('on', !!t.arm); rc.disabled = !['audio', 'midi', 'drum'].includes(t.kind);
        const u = Math.sqrt(clamp(t.vol / VMAX, 0, 1)); r.querySelector('.tc-vol').style.setProperty('--u', u.toFixed(4)); r.querySelector('.tc-ctl .db').textContent = t.vol > 1e-4 ? (20 * Math.log10(t.vol)).toFixed(1) + ' dB' : '-\u221e';
        const pn = Math.round(clamp(t.pan, -1, 1) * 50), pe = r.querySelector('.tc-pan'); pe.style.setProperty('--a', (clamp(t.pan, -1, 1) * 135).toFixed(1) + 'deg'); pe.title = 'Pan ' + (pn === 0 ? 'C' : Math.abs(pn) + (pn < 0 ? 'L' : 'R'));
        tile.setAttribute('aria-label', t.name);
      } else {
        const x = TL.v2XRow(i); r._strip = x.strip; r.style.setProperty('--tc', x.color); tile.innerHTML = '<span class="tc-nm"></span>'; tile.lastChild.textContent = x.name; r.classList.toggle('sel', state.sel.track === x.strip); r.classList.add('xrow'); tile.setAttribute('aria-label', x.name);
      }
    }
    syncSnap();
  }
  for (const r of rowsEl.querySelectorAll('.tc-row')) {
    const b = TL.v2Row(r._i), hh = Math.max(0, b.h - 1); r.style.transform = `translateY(${Math.round(b.y - g.ruler)}px)`; r.style.height = hh + 'px';
    // the wide column fits its row: two lines (buttons, fader) from 62 px, one line (fader + buttons) from 34 px, the name only below
    const size = hh >= 62 ? 'tall' : hh >= 34 ? 'short' : 'tiny';
    if (r._size !== size) { r._size = size; r.classList.toggle('short', size === 'short'); r.classList.toggle('tiny', size === 'tiny'); }
  }
  col.style.height = g.H ? g.H + 'px' : '';
}

// ------------------------------------------------------------------ clip bubbles
let bub = null, bubEl;
// Clip bubbles (Honeydew src/ui/clips.rs): Salin = to the clipboard, Gandakan = a copy right after the clip, Hapus, Snap (edges to the grid),
// Edit (its editor; a double tap does the same), Lainnya = Honeydew's More... (Slice at the playhead, Unlink loop, Combine, Mute / Unmute, Chop...)
function buildBubbles() {
  bubEl = h('div', { id: 'bub2', hidden: true });
  const mk = (ic, label, fn) => { const b = btn('bub', ic, label); b.onclick = (e) => { e.stopPropagation(); fn(e); }; return b; };
  bubEl.append(
    mk('', 'Salin', () => { const c = cur(); if (c) TL.v2CopyClip(bub.i, c); }),
    mk('', 'Hapus', () => { const c = cur(); if (!c) return; checkpoint(); P.removeClip(bub.i, c.id); hideBub(); }),
    mk('', 'Snap', () => { const c = cur(); if (c) TL.v2Snap(bub.i, c); }),
    mk('', 'Edit', () => { const c = cur(); if (!c) return; hideBub(); api.openEditor(); }),
    mk('', 'Lainnya', (e) => moreMenu(e)),
  );
  insEl = h('div', { id: 'ins2', hidden: true });
  insEl.append(mk(IC.plus, 'Klip baru', () => { const q = ins; hideIns(); if (q) TL.v2NewClip(q.i, q.tick, q.sub); }), mk(IC.paste, 'Tempel', () => { const q = ins; hideIns(); if (q) TL.v2Paste(q.i, q.tick); }));
  $('#view-arr').append(bubEl, insEl);
}
const cur = () => { if (!bub) return null; const t = state.tracks[bub.i]; return t ? t.clips.find((c) => c.id === bub.id) || null : null; };
function hideBub() { bub = null; bubEl.hidden = true; }
export function clipTap(i, c, tick) { if (!on) return; hideIns(); bub = { i, id: c.id, tick }; bubEl.hidden = false; placeBub(); }
// the insert menu (Honeydew insert.rs): a tap on empty space of the current track; a second tap on the same cell hides it
let ins = null, insEl;
function hideIns() { ins = null; if (insEl) insEl.hidden = true; }
export function emptyTap(i, tick, sub) {
  if (!on) return;
  if (ins && ins.i === i && ins.tick === tick) return hideIns();
  ins = { i, tick, sub }; insEl.querySelector('.bub:last-child').disabled = !TL.v2HasClipboard(); insEl.hidden = false; placeIns();
}
function placeIns() {
  if (!ins) return;
  if (state.sel.track !== ins.i || state.sel.clip || api.getView() !== 'arr' || TL.v2Busy()) return hideIns();
  const p = TL.v2TickX(ins.i, ins.tick), g = TL.v2Geom(), off = col ? col.offsetWidth : 0, bw = insEl.offsetWidth || 140, bh = insEl.offsetHeight || 54;
  const x = off + clamp(p.x - bw / 2, 4, Math.max(4, g.W - bw - 4));
  let y = p.y - bh - 4; if (y < g.ruler + 2) y = p.y + p.h + 4;
  insEl.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
}
function moreMenu(e) {
  const c = cur(); if (!c) return; const i = bub.i, r = e.currentTarget.getBoundingClientRect(), audio = state.tracks[i].kind === 'audio';
  menu([
    { label: 'Gandakan', fn: () => { TL.v2Copy(i, c); if (bub) bub.id = state.sel.clip; } },
    { label: 'Potong di playhead', dim: !TL.v2CanSlice(c), fn: () => TL.v2Slice(i, c) },
    { label: 'Lepas loop', dim: !TL.v2CanUnlink(c), fn: () => TL.v2Unlink(i, c) },
    { label: 'Gabung', dim: !TL.v2CanCombine(i, c), fn: () => TL.v2Combine(i, c) },
    { label: 'Bisukan', dim: !!c.muted, fn: () => TL.v2SetMuted(i, c, true) },
    { label: 'Bunyikan', dim: !c.muted, fn: () => TL.v2SetMuted(i, c, false) },
    { label: 'Potong rata\u2026', sub: [...[6, 4, 3, 2, 1].map((n) => ({ label: n === 1 ? 'Tiap 1 ketuk' : 'Tiap 1/' + n + ' ketuk', fn: () => TL.v2Chop(i, c, { every: n }) })), ...(audio ? [{ label: 'Di transien', fn: () => TL.v2Chop(i, c, { transients: true }) }] : [])] },
    { label: 'Ganti nama\u2026', fn: () => TL.v2Rename(i, c) },
    { sep: true },
    { label: 'Semua perintah klip\u2026', fn: () => TL.v2ClipMenu(i, c, r.left, r.bottom + 4) },
  ], r.left, r.bottom + 4);
}
function placeBub() {   // the bubbles float just above the selected clip (below it when there is no room), centred on its visible part
  if (!bub) return;
  const c = cur();
  if (!c || state.sel.clip !== bub.id || TL.v2Busy() || api.getView() !== 'arr') { if (!c || state.sel.clip !== bub.id) hideBub(); else bubEl.hidden = true; return; }
  const b = TL.v2ClipBox(bub.i, bub.id), g = TL.v2Geom(); if (!b) return hideBub();
  bubEl.hidden = false;
  const off = col ? col.offsetWidth : 0, bw = bubEl.offsetWidth || 260, bh = bubEl.offsetHeight || 46, vx0 = Math.max(0, b.x), vx1 = Math.min(g.W, b.x + b.w);
  const x = off + clamp((vx0 + vx1) / 2 - bw / 2, 6, Math.max(6, g.W - bw - 6));
  let y = b.y - bh - 6; if (y < g.ruler + 2) y = b.y + b.h + 6; if (y + bh > g.laneB) y = clamp(b.y + 6, g.ruler + 2, Math.max(g.ruler + 2, g.laneB - bh - 2));
  bubEl.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
}

// ------------------------------------------------------------------ main menu (logo button, panel from the right)
let logo, mm, mmBody, mmTab = 'lagu', tools = null, title = null;
const TABS = [['lagu', 'LAGU'], ['proyek', 'PROYEK'], ['ekspor', 'EKSPOR'], ['atur', 'PENGATURAN'], ['bantu', 'BANTUAN']];
function buildMenu() {
  mm = h('div', { id: 'mm2', 'aria-hidden': 'true' });
  const scrim = h('div', { class: 'u2m-scrim' }), pan = h('aside', { class: 'u2m-pan' });
  const x = btn('u2m-x', IC.close, '', 'Tutup');
  const tabs = h('nav', { class: 'u2m-tabs' }, ...TABS.map(([k, n]) => { const b = h('button', { class: 'u2m-t', 'data-k': k }, n); b.onclick = () => { mmTab = k; renderMenu(); }; return b; }));
  mmBody = h('div', { class: 'u2m-body' });
  pan.append(h('header', { class: 'u2m-hd' }, h('div', null, h('b', null, 'MobileDAW 2'), h('span', null, 'versi 2.0')), x), tabs, mmBody);
  mm.append(scrim, pan); $('#app').append(mm);
  scrim.onclick = closeMenu; x.onclick = closeMenu;
  QS.onSaveState((d) => { logo.classList.toggle('unsaved', d); tools.save.classList.toggle('unsaved', d); title.lastChild.textContent = d ? 'Belum disimpan' : 'Tersimpan'; });
}
export function openMenu(tab) { if (tab) mmTab = tab; renderMenu(); mm.classList.add('open'); mm.setAttribute('aria-hidden', 'false'); }
export function closeMenu() { if (!mm || !mm.classList.contains('open')) return false; mm.classList.remove('open'); mm.setAttribute('aria-hidden', 'true'); return true; }
const big = (label, fn, cls = '') => { const b = h('button', { class: 'u2m-big ' + cls }, label); b.onclick = fn; return b; };
const row = (label, ...kids) => h('div', { class: 'u2m-row' }, h('span', { class: 'u2m-k' }, label), ...kids);
const fmtLen = (sec) => { const s = Math.max(0, Math.round(sec)); return Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 'd'; };
function renderMenu() {
  for (const b of mm.querySelectorAll('.u2m-t')) b.classList.toggle('on', b.dataset.k === mmTab);
  mmBody.replaceChildren();
  const B = mmBody, done = (fn) => () => { closeMenu(); fn(); };
  if (mmTab === 'lagu') {
    B.append(h('div', { class: 'u2m-grid' }, big('Lagu baru', done(() => PM.newProjectDialog())), big('Buka…', done(() => BR.openBrowser('proj'))), big('Impor…', done(() => api.importDialog()))));
    const L = PM.recent();
    B.append(h('h3', null, 'Terakhir dibuka'));
    if (!L.length) B.append(h('p', { class: 'u2m-dim' }, 'Belum ada lagu tersimpan. Simpan lagu dari tab PROYEK.'));
    const list = h('div', { class: 'u2m-list' });
    for (const n of L.slice(0, 30)) { const it = h('button', { class: 'u2m-song' }, h('b', null, n), h('span', null, n === state.projectName ? 'sedang dibuka' : '')); it.onclick = done(() => PM.openProject(n).then((r) => PM.openedToast(r))); list.append(it); }
    B.append(list);
  } else if (mmTab === 'proyek') {
    B.append(h('div', { class: 'u2m-grid' }, big('Simpan', done(() => QS.quickSave())), big('Simpan sebagai…', done(() => QS.saveAs())), big('Render cepat', done(() => api.exportWav()))));
    const end = state.tracks.reduce((m, t) => t.clips.reduce((a, c) => Math.max(a, c.start + c.len), m), 0);
    const bpmV = h('button', { class: 'u2m-fld' }, state.bpm.toFixed(1) + ' BPM'); bpmV.onclick = done(() => PN.openTempoPanel());
    const step = (d) => () => { P.setBpm(clamp(Math.round(state.bpm) + d, 20, 999)); bpmV.textContent = state.bpm.toFixed(1) + ' BPM'; };
    const nm = h('button', { class: 'u2m-fld' }, state.projectName || 'Tanpa nama'); nm.onclick = () => ask('Nama lagu', state.projectName, (v) => { if (v && v.trim()) { state.projectName = v.trim(); renderMenu(); } });
    B.append(h('h3', null, 'Info lagu'),
      row('Nama', nm),
      row('Panjang', h('span', { class: 'u2m-v' }, fmtLen(P.tickToSec(end)))),
      row('Tempo', big('−', step(-1), 'sq'), bpmV, big('+', step(1), 'sq')),
      row('Track', h('span', { class: 'u2m-v' }, String(state.tracks.length))),
      row('Sample rate', h('span', { class: 'u2m-v' }, (api.sampleRate() || 48000).toLocaleString('id-ID') + ' Hz')));
  } else if (mmTab === 'ekspor') {
    B.append(h('div', { class: 'u2m-grid' }, big('Audio (WAV / MP3 / stem)', done(() => api.exportWav())), big('MIDI (.mid)', done(() => api.exportMidi())), big('Proyek (.mdaw)', done(() => api.exportMdaw())), big('ZIP (lagu + sample)', done(() => api.exportZip()))));
    B.append(h('p', { class: 'u2m-dim' }, 'Semua berkas disimpan di folder MobileDAW di perangkat. Tidak butuh internet.'));
  } else if (mmTab === 'atur') {
    const seg = (vals, cur, fn) => h('div', { class: 'u2m-seg' }, ...vals.map(([v, n]) => { const b = h('button', { class: cur === v ? 'on' : '' }, n); b.onclick = () => fn(v); return b; }));
    const th = h('button', { class: 'u2m-fld' }, THEME_NAMES[currentTheme()] || currentTheme());
    th.onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(Object.keys(THEME_NAMES).map((k) => ({ label: THEME_NAMES[k], check: currentTheme() === k, fn: () => { prefs.theme = k; savePrefs(); applyTheme(k); renderMenu(); } })), r.left, r.bottom + 2); };
    B.append(h('h3', null, 'Tampilan'),
      row('Tema', th),
      row('Kolom track', seg([[false, 'Ikon'], [true, 'Lebar']], wide(), (v) => { prefs.ui2Wide = v; savePrefs(); applyWide(); renderMenu(); })),
      row('Ikuti playhead', seg([[true, 'Nyala'], [false, 'Mati']], TL.v2Follow(), (v) => { TL.v2SetFollow(v); renderMenu(); })),
      row('Snap ke grid', seg([[true, 'Nyala'], [false, 'Mati']], TL.v2SnapOn(), (v) => { if (v !== TL.v2SnapOn()) TL.v2SnapToggle(); syncSnap(); renderMenu(); })),
      h('div', { class: 'u2m-grid one' }, big('Semua pengaturan (audio, MIDI, sentuhan, skala)…', done(() => api.openSettings()))));
  } else {
    B.append(h('div', { class: 'u2m-grid' }, big('Tutorial interaktif', done(() => api.tutorial())), big('Tentang MobileDAW', done(() => api.about()))));
    B.append(h('h3', null, 'Gerakan dasar'), ...[
      ['Ketuk klip', 'muncul tombol Salin, Gandakan, Hapus, Snap, Edit, Lainnya'],
      ['Ketuk ruang kosong di track aktif', 'Klip baru / Tempel di ketukan itu (ketuk lagi = tutup)'],
      ['Ketuk dua kali klip', 'buka editor (piano roll / step / audio)'],
      ['Ketuk dua kali area kosong', 'klip baru 1 bar'],
      ['Seret penggaris ke samping', 'pilih rentang waktu (lalu menu rentang)'],
      ['Tahan klip', 'pilih banyak klip'],
      ['Ketuk ikon track', 'lebarkan / sempitkan kolom track'],
      ['Tahan ikon track', 'menu track (warna, nama, hapus, output)'],
      ['Ketuk magnet', 'snap nyala / mati; tahan = pilihan grid'],
    ].map(([a, b]) => row(a, h('span', { class: 'u2m-v' }, b))));
  }
}

// ------------------------------------------------------------------ boot + frame
export function initUi2(a) {
  api = a; on = true;
  document.documentElement.classList.add('ui2');
  TL.setV2(true);
  buildBar(); buildCol(); buildBubbles(); buildMenu(); buildEdFab();
  api.setShut(true);                        // 2.0 starts with the whole screen for the arrangement; Rack / Keyboard open the panel
  P.onChange((w) => { if (w === 'all' || w === 'tracks' || w === 'mix' || w === 'sel') colSig = ''; if (w === 'all') { hideBub(); hideIns(); } });
  addEventListener('themechange', () => { colSig = ''; });
  readouts();
}
// ------------------------------------------------------------------ the clip editor, full screen and simple: Vel / Pan lane, every tool in one menu, close
let edf = null;
function buildEdFab() {
  const lane = btn('ef', IC.lane, 'Vel', 'Lane velocity'), more = btn('ef', IC.more, '', 'Alat editor'), shut = btn('ef shut', IC.down, '', 'Tutup editor');
  edf = h('div', { id: 'edf2' }, lane, more, shut);
  $('#view-arr').append(edf);
  const tool = (txt) => [...document.querySelectorAll('.ed-tools .b')].find((b) => b.textContent.trim() === txt);
  lane.onclick = () => { const b = tool('Lane'); if (b) b.click(); };
  shut.onclick = () => { const b = $('#btn-edclose'); if (b) b.click(); };
  more.onclick = () => {   // every toolbar command of the editor (the toolbar row itself is hidden in MobileDAW 2)
    const r = more.getBoundingClientRect(), items = [...document.querySelectorAll('.ed-tools .b')].filter((b) => b.offsetParent !== null || true).map((b) => ({ label: b.textContent.trim(), check: b.classList.contains('on'), fn: () => b.click() })).filter((x) => x.label && x.label !== 'Lane');
    menu(items.length ? items : [{ label: 'Tidak ada alat untuk klip ini', dim: true }], r.right - 220, r.bottom + 4);
  };
}
function syncEdFab() {
  const full = $('#view-arr').classList.contains('edfull'); edf.hidden = !full; if (!full) return;
  const b = [...document.querySelectorAll('.ed-tools .b')].find((q) => q.textContent.trim() === 'Lane'); edf.firstChild.hidden = !b; if (b) edf.firstChild.classList.toggle('on', b.classList.contains('on'));
}
export function frame() { if (!on) return; syncCol(); placeBub(); placeIns(); syncEdFab(); }
export function back() { if (PN.close()) return true; if (closeMenu()) return true; if (bub) { hideBub(); return true; } if (ins) { hideIns(); return true; } return false; }
