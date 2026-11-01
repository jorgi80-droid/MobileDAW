// Import UI: pick a .flm / .flp / .als / .zip, show a progress window while it converts (it can take a while for big projects), then a
// report: what was converted, which samples / plugins are missing and what was skipped. The project is saved as Projects/<name>.mdaw.
import { h, modal, toast } from '../ui.js';
import { eng } from '../engine.js';
import * as P from '../project.js';
import * as QS from '../quicksave.js';
import { importProject } from './index.js';

function pickFile() {
  return new Promise((res) => {
    const inp = h('input', { type: 'file', accept: '.flm,.flp,.als,.zip,application/zip', style: 'display:none' });
    inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); res(f || null); });
    document.body.append(inp); inp.click();
  });
}

// import options, asked once the file is chosen (the only place this choice exists): modules MobileDAW does not have -> stock plugins.
// On: every module with a stock equivalent becomes that plugin (an exact match plays as before; one whose parameters cannot be converted
// exactly is put in bypassed, ready to adjust). Off: only the exact matches; the others stay "[Plugin tidak tersedia]" placeholders.
function importOptions(f) {
  return new Promise((res) => {
    const cb = h('input', { type: 'checkbox', checked: true, class: 'imp-cb' });
    const body = h('div', { class: 'imp-opt' },
      h('label', { class: 'imp-ck' }, cb, h('span', {}, 'Ganti modul yang hilang dengan stock plugin')),
      h('div', { class: 'sv' }, 'Modul yang setara langsung bunyi sama; yang hanya mirip dipasang dalam keadaan bypass. Tanpa centang: hanya yang setara, sisanya tetap placeholder.'));
    modal('Impor ' + f.name, body, [{ label: 'Batal', fn: () => res(null) }, { label: 'Impor', go: true, fn: () => res(cb.checked ? 'all' : 'map') }]);
    const sc = [...document.querySelectorAll('#layer .scrim')].pop(); if (sc) sc.addEventListener('pointerdown', () => res(null));
  });
}

export async function importDialog(after) {
  const f = await pickFile();
  if (!f) return;
  const fxMode = await importOptions(f);
  if (!fxMode) return;
  const bar = h('i', { class: 'imp-fill' }), label = h('div', { class: 'imp-l' }, 'Membaca file…'), pct = h('b', {}, '0%');
  const win = h('div', { class: 'scrim imp-scrim', style: 'background:var(--scrim)' }, h('div', { class: 'modal imp' }, h('h3', {}, 'Mengimpor ' + f.name), label, h('div', { class: 'imp-bar' }, bar), h('div', { class: 'imp-row' }, pct, h('span', {}, 'Jangan tutup aplikasi selama konversi.'))));
  document.getElementById('layer').append(win);                 // not closable: the project is being written
  const t0 = Date.now();
  const onProgress = (fr, l) => { const v = Math.round(Math.max(0, Math.min(1, fr)) * 100); bar.style.width = v + '%'; pct.textContent = v + '%'; if (l) label.textContent = l; };
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    P.stop();
    const io = {
      home: eng.home(),
      saveBytes: async (path, bytes) => { await eng.saveBytes(path, bytes.buffer.byteLength === bytes.byteLength ? bytes.buffer : bytes.slice().buffer); },
      writeText: async (path, text) => { eng.writeText(path, text); },
      open: async (text, prog) => P.deserialize(text, prog),
      fxMode,
      ensureSoundFont: async (path) => { if (!eng.fileSize(path)) { const r = await fetch('demos/SoundFonts/' + path.split('/').pop()); if (r.ok) await eng.saveBytes(path, await r.arrayBuffer()); } },
    };
    const r = await importProject(f.name, buf, io, onProgress);
    QS.markOpened(r.name);
    win.remove();
    report(r, (Date.now() - t0) / 1000);
    if (after) after(r);
  } catch (e) {
    win.remove();
    modal('Impor gagal', h('div', { class: 'sv' }, (e && e.message) || String(e)), [{ label: 'Tutup', go: true }]);
  }
}

const li = (t) => h('li', {}, t);
const sec = (title, items, cls = '') => (items && items.length ? h('div', { class: 'imp-sec ' + cls }, h('b', {}, title), h('ul', {}, ...items.slice(0, 40).map(li), ...(items.length > 40 ? [li('\u2026 dan ' + (items.length - 40) + ' lagi')] : []))) : null);
// the module part of a report: how many modules became MDAW stock plugins and why the others did not
function fxSections(fx) {
  if (!fx) return [];
  return [h('div', { class: 'imp-sec' }, h('b', {}, 'Modul efek / plugin'), ...fx.lines.map((l) => h('div', { class: 'sv' }, l))),
    sec('Tidak diterapkan: MobileDAW tidak punya plugin dengan fungsi yang sama', fx.none, 'warn'),
    sec('Tidak diterapkan: modul belum dikenali (tetap placeholder "[Plugin tidak tersedia]")', fx.unknown, 'warn'),
    sec('Punya padanan stock plugin, tetapi parameternya belum bisa dikonversi persis (centang "Ganti modul yang hilang" saat impor untuk memasangnya dalam keadaan bypass)', fx.layout)];
}
function report(r, secs) {
  const R = r.report;
  const body = h('div', { class: 'imp-rep' },
    h('div', { class: 'sv' }, `Dari ${r.app}: ${R.tracks} track, ${R.clips} klip${R.pitched ? ` (${R.pitched} klip audio dengan pitch)` : ''}, ${R.notes} not, ${R.samplesFound} sample ditemukan, dalam ${secs.toFixed(1)} dtk. Tersimpan sebagai Projects/${r.name}.mdaw.`),
    sec('Instrumen', (R.instruments || []).map((x) => `${x.track}: ${x.from} \u2192 ${x.to}`)),
    ...fxSections(r.fx),
    sec('Sample tidak ada di arsip (klip / pad tetap ada, tanpa suara)', [...R.samplesMissing, ...r.missingOnOpen.filter((p) => !/\/_missing\//.test(p))], 'warn'),
    sec('Tidak dikonversi', R.skipped, 'warn'),
    sec('Catatan', R.warnings));
  modal('Impor selesai: ' + r.name, body, [{ label: 'OK', go: true }]);
  [...document.querySelectorAll('#layer .modal:not(.closing)')].pop()?.classList.add('big');
  toast('Proyek diimpor: ' + r.name, 2500);
}
