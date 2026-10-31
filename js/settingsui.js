// Settings panel: screen, audio info, recording latency, MIDI, timeline, storage, offline/PWA, shortcuts, reset.
import { displayHz } from './fps.js';
import { h, modal, menu, toast, clamp } from './ui.js';
import { eng, backend } from './engine.js';
import { prefs, savePrefs, resetPrefs } from './prefs.js';
import { enableMidi, midiNames } from './midi.js';
import { applyTimelinePrefs } from './timeline.js';
import { applyTheme, THEME_NAMES, themeSwatch } from './theme.js';
import { applyViewportMeta, relayoutSoon } from './layout.js';
import { EDGE_LEVELS } from './edgeguard.js';
import * as P from './project.js';
import { isStandalone, canInstall, promptInstall } from './pwa.js';
import { isNativeApp } from './native.js';
import { INSTRUMENTS, DEVICES } from './defs.js';
import * as FS from './storage.js';
import { log, logs, logText, clearLog, setLogLevel } from './log.js';
import { aboutTabs } from './about.js';

const SNAP_NAMES = ['Auto', 'Bar', '1 Beat', '1/2 Beat', '1/4 Beat', 'Triplet', 'Off'];
const section = (title, ...kids) => h('div', { class: 'set' }, h('h4', {}, title), ...kids);
const line = (a, b) => h('div', { class: 'sline' }, h('span', {}, a), h('span', { class: 'sv' }, b));
const btn = (label, fn, on) => h('button', { class: 'b' + (on ? ' on' : ''), style: 'height:30px', onclick: fn }, label);

const installed = () => ['fullscreen', 'standalone', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;
let userExited = false, lastTab = 'Audio', fsFail = 0;
// Open in fullscreen on the first touch (browsers only allow it from a gesture). The installed app is already fullscreen
// through the manifest, so nothing is requested there. After an accidental exit (file picker, back swipe) the next touch re-enters,
// unless the person left fullscreen on purpose with the Layar penuh button / F key.
// Android: an installed app that is only fullscreen through the manifest gets a RESIZED window when the status bar is pulled down (white strip, the
// whole layout jumps). Real Fullscreen-API mode shows the system bars as a transparent overlay on top of the app and never resizes it (the same
// way a native DAW behaves), so the app asks for it on the first touch even when it is installed. iOS home-screen apps have no such API.
export function initAutoFullscreen() {
  if (navigator.standalone === true || isNativeApp() || !document.documentElement.requestFullscreen) return;   // the Android app is immersive full screen by itself
  document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement) userExited = false; });
  addEventListener('pointerdown', () => { if (prefs.fullscreen && !userExited && fsFail < 3 && !document.fullscreenElement) requestFs(); }, true);
}
function requestFs() {
  const el = document.documentElement;
  const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
  if (p && p.then) p.then(() => { try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (_) { /* not supported */ } fsFail = 0; }).catch(() => { fsFail++; });
}
export function toggleFullscreen() {
  if (navigator.standalone === true) return;          // iOS home-screen apps are already fullscreen
  const d = document;
  if (d.fullscreenElement) { userExited = true; d.exitFullscreen && d.exitFullscreen(); return; }
  const el = d.documentElement;
  const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
  if (p && p.then) p.then(() => { try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (_) { /* not supported */ } }).catch(() => toast('Layar penuh tidak didukung browser ini. Pasang aplikasi ke layar utama untuk mode penuh.', 4000));
  else toast('Layar penuh tidak didukung browser ini. Pasang aplikasi ke layar utama untuk mode penuh.', 4000);
}

export async function resetApp() {
  try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); } catch (_) { /* none */ }
  try { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); } catch (_) { /* none */ }
  location.reload();
}

// Preferences that act on the page itself: CPU meter, reduced motion, keep screen awake.
let wake = null;
async function holdWake() {
  try { if (prefs.keepAwake && navigator.wakeLock && !document.hidden && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (_) { wake = null; /* denied or unsupported */ }
}
export function applyUiPrefs() {
  const box = document.querySelector('.cpubox'); if (box) box.style.display = prefs.showCpu ? '' : 'none';
  const fb = document.querySelector('.fpsbox'); if (fb) fb.style.display = prefs.showFps ? '' : 'none';
  document.documentElement.classList.toggle('reduce-motion', !!prefs.reduceMotion);
  document.documentElement.style.setProperty('--anim', String(prefs.animScale ?? 1));
  if (prefs.keepAwake) holdWake(); else if (wake) { wake.release().catch(() => {}); wake = null; }
}
export function initUiPrefs() {
  applyUiPrefs();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) holdWake(); });
  addEventListener('pointerdown', () => { if (prefs.keepAwake && !wake) holdWake(); }, true);
}

const toggle = (label, key, after) => { const b = btn(label + ': ' + (prefs[key] ? 'ya' : 'tidak'), () => { prefs[key] = !prefs[key]; savePrefs(); b.textContent = label + ': ' + (prefs[key] ? 'ya' : 'tidak'); b.classList.toggle('on', !!prefs[key]); if (after) after(); }, !!prefs[key]); return b; };
const choice = (title, key, opts, after) => {      // opts: [[value, label]]
  const row = h('div', { class: 'segc' });
  for (const [v, l] of opts) row.append(h('button', { class: 'b' + (prefs[key] === v ? ' on' : ''), style: 'height:30px', onclick: (e) => { prefs[key] = v; savePrefs(); for (const x of row.children) x.classList.toggle('on', x === e.currentTarget); if (after) after(); } }, l));
  return h('div', {}, h('div', { class: 'sv' }, title), row);
};

function folderSection() {
  const box = h('div', {}), stat = h('div', { class: 'sv' });
  const paint = () => {
    const i = FS.info();
    stat.textContent = i.mode === 'device' ? (i.perm === 'granted' ? `Terhubung: ${i.name}/ (Samples, SoundFonts, Recordings, Exports, Projects, Presets)` : `Folder ${i.name}/ butuh izin lagi (browser meminta ulang tiap sesi).`)
      : isNativeApp() && !FS.canPick() ? 'Aplikasi Android: sample, proyek, dan preset disimpan di dalam aplikasi. Hasil ekspor juga disalin ke Documents/MobileDAW dan bisa dibagikan. Impor file lewat Browser \u2192 Impor.'
      : isNativeApp() ? 'Belum ada folder MobileDAW. Pilih lokasi sekali (mis. Documents atau Music) dan izinkan akses; aplikasi membuat folder MobileDAW beserta sub-foldernya dan sample di dalamnya langsung bisa dipakai.'
      : i.mode === 'opfs' ? 'Browser ini tidak punya pemilih folder: MobileDAW/ disimpan di dalam aplikasi.' : 'Belum ada folder MobileDAW. Pilih lokasi sekali; aplikasi membuat folder MobileDAW beserta sub-foldernya.';
    const items = [];
    if (FS.canPick()) items.push(btn(i.mode === 'device' ? 'Ganti folder\u2026' : 'Pilih folder & beri izin', async () => { const r = await FS.chooseFolder(); if (r.error) toast(r.error, 5000); else if (r.ok) { await eng.syncFolder(); toast('Folder ' + r.name + ' siap.', 3000); } paint(); }));
    if (i.mode === 'device' && i.perm !== 'granted') items.push(btn('Izinkan akses', async () => { toast(await FS.regrant() ? 'Akses folder aktif.' : 'Izin tidak diberikan.'); if (FS.active()) await eng.syncFolder(); paint(); }));
    if (FS.active()) items.push(btn('Segarkan isi folder', async () => { const r = await eng.syncFolder(); toast(r && (r.added || r.removed) ? `Diperbarui (+${r.added} / \u2212${r.removed}).` : 'Sudah terbaru.'); }));
    if (i.mode === 'device') items.push(btn('Putuskan folder', async () => { await FS.disconnect(); paint(); toast('Folder diputuskan. File di dalamnya tidak dihapus.'); }));
    box.replaceChildren(...items);
  };
  paint();
  return section('Folder MobileDAW', stat, box);
}

// Android app: which audio engine plays (Web = AudioWorklet, Native = C++ with Oboe). Changing it needs no restart and keeps the project.
function engineSection() {
  if (!isNativeApp() || !eng.engineInfo || !eng.engineInfo().available) return null;
  const stat = h('div', { class: 'sv' }), meas = h('div', { class: 'sv' });
  const stripName = (t) => (t < 64 ? (P.state.tracks[t] ? P.state.tracks[t].name : 'Track ' + (t + 1)) : t === 64 ? 'Master' : 'Return ' + String.fromCharCode(65 + t - 65));
  const paint = () => {
    const i = eng.engineInfo(), b = i.blocker;
    stat.textContent = i.active === 'native' ? 'Aktif: Native (C++ dengan Oboe).'
      : i.want === 'native' ? (b && b.notReady ? 'Native sedang disiapkan\u2026' : b ? `Aktif: Web. Engine native belum bisa memutar ${b.inst ? 'instrumen ' + ((INSTRUMENTS[b.inst] || {}).name || b.inst) : 'efek ' + ((DEVICES[b.dev] || {}).name || b.dev)} di ${stripName(b.strip)}; proyek otomatis memakai engine Web.` : i.pending ? 'Beralih ke Native setelah transport berhenti.' : 'Aktif: Web.')
      : 'Aktif: Web (AudioWorklet).';
  };
  const measure = async (reset) => {
    const w = Math.round(P.state.cpu * 100);
    const s = await eng.nativeStats(reset);
    if (reset) { meas.textContent = 'Statistik direset. Putar lagu lalu tekan Ukur.'; return; }
    meas.textContent = (s && s.blocks ? `Native: ${s.blocks} blok, rata-rata ${s.mean.toFixed(1)}%, p50 ${s.p50}%, p99 ${s.p99}%, maks ${s.max.toFixed(1)}% dari waktu blok, underrun ${s.xruns}, blok dibisukan ${s.bad}, buffer ${s.buffer} frame (burst ${s.burst}) @ ${s.sampleRate} Hz${s.latencyMs >= 0 ? ', latensi ' + s.latencyMs.toFixed(1) + ' ms' : ''}. ` : 'Native: belum ada data (pilih Native lalu putar lagu). ')
      + `Beban CPU saat ini: ${w}%.`;
    log('info', 'ukur CPU: ' + meas.textContent);
  };
  paint();
  const onChange = () => { if (!stat.isConnected) { removeEventListener('enginechange', onChange); return; } paint(); };   // gone with the settings panel
  addEventListener('enginechange', onChange);
  return section('Engine audio',
    choice('Mesin yang memutar audio', 'engine', [['web', 'Web'], ['native', 'Native (C++)']], async () => { stat.textContent = 'Beralih\u2026'; await eng.setEngine(prefs.engine); paint(); }),
    stat,
    h('div', { class: 'sv' }, 'Native = engine C++ dengan Oboe (latensi rendah). Selama sebuah instrumen/efek di proyek belum tersedia di engine native, proyek diputar oleh engine Web. Berganti engine tidak perlu memulai ulang dan proyek tetap utuh.'),
    btn('Ukur beban CPU', () => measure(false)), btn('Reset statistik', () => measure(true)), meas);
}

function logSection() {
  const view = h('div', { class: 'logbox' });
  const paint = () => {
    const L = logs();
    view.replaceChildren(...(L.length ? L.slice(-120).map((e) => { const d = new Date(e.t), p = (n) => String(n).padStart(2, '0'); return h('div', { class: e.k === 'error' ? 'e' : e.k === 'warn' ? 'w' : 'i' }, `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${e.m}${e.n > 1 ? ' (x' + e.n + ')' : ''}`); }) : [h('div', { class: 'i' }, 'Log kosong.')]));
    view.scrollTop = view.scrollHeight;
  };
  paint();
  return section('Log',
    choice('Tingkat detail', 'logLevel', [[0, 'Error'], [1, 'Error + peringatan'], [2, 'Semua']], () => { setLogLevel(prefs.logLevel); log('info', 'tingkat log diubah'); paint(); }),
    view,
    btn('Salin', async () => { try { await navigator.clipboard.writeText(logText() || '(kosong)'); toast('Log disalin.'); } catch (_) { toast('Tidak bisa menyalin. Tekan lama pada teks log untuk memilih.', 3500); } }),
    btn('Bagikan', async () => { try { if (navigator.share) await navigator.share({ title: 'Log MobileDAW', text: logText() }); else toast('Berbagi tidak didukung. Pakai Salin.'); } catch (_) { /* cancelled */ } }),
    btn('Muat ulang', paint), btn('Bersihkan', () => { clearLog(); paint(); toast('Log dibersihkan.'); }));
}

export function openSettings() {
  const body = h('div', { class: 'settings' });
  const info = eng.info();
  const midiLine = h('div', { class: 'sv' });
  const midiBox = h('div', {});
  const storage = h('div', { class: 'sv' }, 'menghitung\u2026');
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then((e) => { storage.textContent = `${(e.usage / 1048576).toFixed(1)} MB terpakai dari ${(e.quota / 1073741824).toFixed(1)} GB`; }).catch(() => { storage.textContent = 'tidak tersedia'; });
  else storage.textContent = 'tidak tersedia';

  const fillMidi = () => {
    const names = midiNames();
    midiLine.textContent = names.length ? names.join(', ') : (prefs.midiOn ? 'Tidak ada perangkat terdeteksi. Colok controller USB lalu buka lagi.' : 'Belum diaktifkan');
    midiBox.replaceChildren(
      btn(prefs.midiOn ? 'Muat ulang perangkat MIDI' : 'Aktifkan MIDI', async () => { const r = await enableMidi(); if (!(r && r.error)) { savePrefs(); fillMidi(); toast(names.length ? 'MIDI aktif.' : 'MIDI aktif. Colok controller untuk mulai.'); } }),
      btn('Perangkat: ' + (prefs.midiDevice === 'any' ? 'Semua' : prefs.midiDevice), (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        menu([{ label: 'Semua perangkat', check: prefs.midiDevice === 'any', fn: () => { prefs.midiDevice = 'any'; savePrefs(); fillMidi(); } }, ...midiNames().map((n) => ({ label: n, check: prefs.midiDevice === n, fn: () => { prefs.midiDevice = n; savePrefs(); fillMidi(); } }))], r.left, r.bottom);
      }));
    const links = Object.entries(P.state.ccLinks);
    if (links.length) midiBox.append(h('div', { style: 'margin-top:6px' }, ...links.map(([cc, l]) => h('div', { class: 'sline' }, h('span', {}, `CC ${cc} \u2192 ${l.label}`), btn('Lepas', () => { P.unlinkCc(cc); fillMidi(); })))));
  };
  fillMidi();

  const lat = h('input', { type: 'number', min: 0, max: 500, step: 1, value: prefs.latencyMs, inputmode: 'numeric', style: 'width:80px;height:32px;background:var(--bg);border:1px solid var(--line);color:var(--text);border-radius:2px;padding:0 6px;user-select:text', onchange: (e) => { const v = Math.max(0, Math.min(500, Math.round(+e.target.value) || 0)); prefs.latencyMs = v; e.target.value = v; eng.setLatencyMs(v); savePrefs(); } });
  const snapBtn = btn('Snap awal: ' + SNAP_NAMES[prefs.snap], (e) => { const r = e.currentTarget.getBoundingClientRect(); menu(SNAP_NAMES.map((n, k) => ({ label: n, check: prefs.snap === k, fn: () => { prefs.snap = k; savePrefs(); applyTimelinePrefs(); snapBtn.textContent = 'Snap awal: ' + n; } })), r.left, r.bottom); });
  const follow = btn('Ikuti playhead: ' + (prefs.follow ? 'ya' : 'tidak'), () => { prefs.follow = !prefs.follow; savePrefs(); applyTimelinePrefs(); follow.textContent = 'Ikuti playhead: ' + (prefs.follow ? 'ya' : 'tidak'); follow.classList.toggle('on', prefs.follow); }, prefs.follow);
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;

  const scaleVal = h('span', { class: 'sval' });
  const scaleSlider = h('input', { type: 'range', class: 'sl', min: 50, max: 160, step: 5, value: Math.round((prefs.uiScale || 0.7) * 100), 'aria-label': 'Skala UI' });
  const paintScale = () => { scaleSlider.style.setProperty('--p', ((scaleSlider.value - 50) / 110 * 100) + '%'); scaleVal.textContent = scaleSlider.value + '%'; };
  const commitScale = () => { prefs.uiScale = +scaleSlider.value / 100; savePrefs(); applyViewportMeta(); relayoutSoon(); };   // applied on release so the slider is not rebuilt while dragging
  const stepScale = (d, label, name) => h('button', { class: 'b step', 'aria-label': name, onclick: () => { scaleSlider.value = clamp(+scaleSlider.value + d, 50, 160); paintScale(); commitScale(); } }, label);
  scaleSlider.addEventListener('input', paintScale); scaleSlider.addEventListener('change', commitScale);
  paintScale();
  const mVal = h('span', { class: 'sval' });
  const mSlider = h('input', { type: 'range', class: 'sl', min: 0, max: 150, step: 5, value: Math.round((prefs.metroVol ?? 1) * 100), 'aria-label': 'Level metronom' });
  const paintMetro = () => { mSlider.style.setProperty('--p', (mSlider.value / 150 * 100) + '%'); mVal.textContent = mSlider.value + '%'; };
  const liveMetro = () => { paintMetro(); prefs.metroVol = +mSlider.value / 100; eng.metroVol(prefs.metroVol); };   // heard immediately, also while the song is playing
  const stepMetro = (d, label, name) => h('button', { class: 'b step', 'aria-label': name, onclick: () => { mSlider.value = clamp(+mSlider.value + d, 0, 150); liveMetro(); savePrefs(); } }, label);
  mSlider.addEventListener('input', liveMetro); mSlider.addEventListener('change', savePrefs);
  paintMetro();
  // theme library (inspired by Live's built-in themes): one card per theme with a preview of its colours
  const themeRow = h('div', { class: 'thm-grid' }, ...Object.entries(THEME_NAMES).map(([k, n]) => {
    const [bg, pn, ctl, tx] = themeSwatch(k);
    return h('button', { class: 'thm' + (prefs.theme === k ? ' on' : ''), 'aria-label': n, onclick: (e) => { prefs.theme = k; savePrefs(); applyTheme(k); for (const x of e.currentTarget.parentElement.children) x.classList.toggle('on', x === e.currentTarget); } },
      h('span', { class: 'thm-pv', style: `background:${bg}` }, h('i', { style: `background:${pn}` }), h('i', { style: `background:${ctl}` }), h('b', { style: `color:${tx}` }, 'Aa')), h('span', { class: 'thm-n' }, n));
  }));
  const fsBox = [];
  const tabs = {
    Audio: [
      section('Audio', line('Mesin', backend === 'web' ? 'Web Audio (AudioWorklet)' : backend === 'native' ? 'Native (aplikasi Android)' : 'Tidak tersedia'), line('Sample rate', info.sampleRate ? info.sampleRate + ' Hz' : '\u2014'),
        line('Latensi output', info.baseLatency || info.outputLatency ? `${info.baseLatency} + ${info.outputLatency} ms` : '\u2014'), line('Status', info.state), line('Beban CPU', Math.round(P.state.cpu * 100) + ' %')),
      engineSection(),
      section('Mesin audio',
        choice('Mode latensi', 'latencyHint', [['interactive', 'Rendah'], ['balanced', 'Seimbang'], ['playback', 'Stabil']]),
        choice('Sample rate', 'sampleRate', [[0, 'Otomatis'], [44100, '44.1 kHz'], [48000, '48 kHz']]),
        h('div', { class: 'sv' }, 'Rendah = respons cepat, Stabil = buffer besar (cocok jika audio terputus-putus). Berlaku setelah aplikasi dimuat ulang.'),
        btn('Terapkan & muat ulang', () => { savePrefs(); location.reload(); })),
      section('Master', toggle('Limiter pengaman master', 'masterLimit', () => eng.masterLimit(prefs.masterLimit !== false)),
        h('div', { class: 'sv' }, 'Brickwall look-ahead 1,5 ms dengan ceiling -0,3 dBFS di tahap output (juga untuk ekspor mix, tidak untuk stem). Mix yang melewati 0 dBFS diredam halus, tidak terpotong kasar. Matikan untuk output tanpa proses apa pun.')),
      section('Metronom', h('div', { class: 'sv' }, 'Level metronom (juga untuk count-in)'),
        h('div', { class: 'scalebox' }, h('div', { class: 'srow' }, stepMetro(-5, '\u2212', 'Pelankan'), mSlider, stepMetro(5, '+', 'Keraskan'), mVal), h('div', { class: 'marks' }, h('span', {}, 'Pelan'), h('span', {}, 'Keras')))),
      section('Rekaman', h('div', { class: 'sline' }, h('span', {}, 'Kompensasi latensi (ms)'), lat), h('div', { class: 'sv' }, 'Dipotong dari awal setiap rekaman audio agar sejajar dengan ketukan. Naikkan jika rekaman terdengar terlambat.')),
      section('Ekspor', choice('Kedalaman bit awal', 'exportBits', [[16, '16-bit'], [24, '24-bit'], [32, '32-bit float']])),
      isNativeApp() ? null : section('MIDI', midiLine, midiBox, h('div', { class: 'sv', style: 'margin-top:6px' }, 'Tekan lama pada knob/fader lalu pilih \"Hubungkan ke MIDI CC\". Pad drum: nada 48\u201353. Transport: MMC dan pesan Start/Stop MIDI.')),
    ],
    Tampilan: [
      section('Tampilan', h('div', { class: 'sv' }, 'Tema'), themeRow,
        h('div', { class: 'sv', style: 'margin-top:8px' }, 'Skala UI'),
        h('div', { class: 'scalebox' }, h('div', { class: 'srow' }, stepScale(-5, '\u2212', 'Perkecil'), scaleSlider, stepScale(5, '+', 'Perbesar'), scaleVal), h('div', { class: 'marks' }, h('span', {}, 'Kecil'), h('span', {}, 'Besar'))),
        h('div', { class: 'sv' }, 'Zona tepi layar: sentuhan yang mulai di tepi atas, bawah dan samping diabaikan agar status bar dan bilah navigasi tidak terbuka tak sengaja.'),
        btn('Zona tepi layar: ' + EDGE_LEVELS[prefs.edgeGuard ?? 1], (e) => { prefs.edgeGuard = ((prefs.edgeGuard ?? 1) + 1) % 3; savePrefs(); e.currentTarget.textContent = 'Zona tepi layar: ' + EDGE_LEVELS[prefs.edgeGuard]; relayoutSoon(); }),
        toggle('Tampilkan meter CPU', 'showCpu', applyUiPrefs), toggle('Tampilkan FPS', 'showFps', applyUiPrefs),
        choice('Refresh rate tampilan', 'fpsMode', [['auto', 'Auto (30\u2013120)'], ['60', '60 Hz'], ['120', '120 Hz']]),
        h('div', { class: 'sv' }, 'Refresh rate yang dilaporkan browser: ' + displayHz() + ' Hz. Kalau angka ini 60 padahal layar HP 120 Hz, aktifkan refresh rate tinggi untuk Chrome / aplikasi ini di pengaturan layar Android (Smooth display / Tingkat penyegaran).'),
        h('div', { class: 'sv' }, 'Auto menyesuaikan kemampuan HP: mulus saat menulis not di piano roll dan menyusun sample, dan turun otomatis kalau HP mulai berat. 60 Hz mengunci 60 fps. 120 Hz mengunci 120 fps (hanya tercapai di layar 120 Hz).'), choice('Skala animasi', 'animScale', [[0.5, '0,5x'], [1, '1x'], [1.5, '1,5x'], [2, '2x']], applyUiPrefs), toggle('Kurangi animasi', 'reduceMotion', applyUiPrefs), toggle('Layar tetap menyala', 'keepAwake', applyUiPrefs)),
      isStandalone()
        ? section('Aplikasi', h('div', { class: 'sv' }, 'Berjalan sebagai aplikasi terpasang, layar penuh.'))
        : section('Layar', h('div', { class: 'sv' }, 'Di tab browser, Chrome selalu menampilkan pesan keluar layar penuh sendiri. Pasang MobileDAW ke layar utama agar berjalan seperti aplikasi biasa tanpa pesan itu.'),
          btn('Layar penuh', toggleFullscreen), btn('Layar penuh otomatis: ' + (prefs.fullscreen ? 'ya' : 'tidak'), (e) => { prefs.fullscreen = !prefs.fullscreen; savePrefs(); e.currentTarget.textContent = 'Layar penuh otomatis: ' + (prefs.fullscreen ? 'ya' : 'tidak'); }),
          ...(canInstall() ? [btn('Pasang aplikasi', () => promptInstall())] : [])),
      section('Timeline', snapBtn, follow),
    ],
    Penyimpanan: [
      folderSection(),
      section('Ruang', storage, btn('Minta penyimpanan permanen', () => { eng.requestStorage(); toast('Permintaan dikirim. Browser memutuskan apakah file dijaga permanen.', 3500); })),
      isNativeApp() ? section('Offline', line('Aplikasi', 'Android (APK), semua file ada di dalam aplikasi')) : section('Offline', line('Service worker', sw ? 'aktif, siap offline' : 'belum aktif (muat ulang sekali)'), btn('Perbarui aplikasi', resetApp)),
    ],
    Log: [logSection()],
    About: aboutTabs(),
    Lainnya: [
      section('Pintasan keyboard', h('div', { class: 'sv' }, 'Spasi: play/stop \u2022 Home: ke awal \u2022 R: rekam \u2022 M: metronom \u2022 B: browser \u2022 Tab: arrange/mixer \u2022 Ctrl+Z / Ctrl+Y: urungkan/ulangi \u2022 Delete: hapus klip \u2022 F: layar penuh. Di tab Keys, baris Z\u2013M dan Q\u2013I memainkan piano.')),
      section('Reset', btn('Kembalikan pengaturan awal', () => { resetPrefs(); eng.setLatencyMs(0); setLogLevel(prefs.logLevel); applyTimelinePrefs(); applyTheme(prefs.theme); applyViewportMeta(); applyUiPrefs(); relayoutSoon(); scaleSlider.value = Math.round(prefs.uiScale * 100); paintScale(); eng.metroVol(prefs.metroVol ?? 1); toast('Pengaturan dikembalikan.'); })),
    ],
  };
  const tabBar = h('div', { class: 'btabs', style: 'margin:-2px -2px 10px;flex-wrap:wrap' }), pane = h('div', { class: 'settings' });
  const show = (name) => { for (const b of tabBar.children) b.classList.toggle('on', b.dataset.t === name); pane.replaceChildren(...tabs[name].filter(Boolean)); lastTab = name; };
  for (const name of Object.keys(tabs)) tabBar.append(h('button', { class: 'b', 'data-t': name, onclick: () => show(name) }, name));
  const wrap = h('div', { class: 'prefs' }, tabBar, pane);   // Live-style preferences: tab list on the left, page on the right
  show(lastTab in tabs ? lastTab : 'Audio');
  modal('Pengaturan', wrap, [{ label: 'Tutup', go: true }]);
  [...document.querySelectorAll('#layer .modal:not(.closing)')].pop()?.classList.add('big', 'prefsw');
}
