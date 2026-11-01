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

export async function importDialog(after) {
  const f = await pickFile();
  if (!f) return;
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

function report(r, secs) {
  const R = r.report, li = (t) => h('li', {}, t);
  const sec = (title, items, cls = '') => (items.length ? h('div', { class: 'imp-sec ' + cls }, h('b', {}, title), h('ul', {}, ...items.slice(0, 40).map(li), ...(items.length > 40 ? [li('… dan ' + (items.length - 40) + ' lagi')] : []))) : null);
  const body = h('div', { class: 'imp-rep' },
    h('div', { class: 'sv' }, `Dari ${r.app}: ${R.tracks} track, ${R.clips} klip, ${R.notes} not, ${R.samplesFound} sample ditemukan, dalam ${secs.toFixed(1)} dtk. Tersimpan sebagai Projects/${r.name}.mdaw.`),
    sec('Plugin tidak tersedia (device diganti placeholder yang meneruskan audio apa adanya)', R.plugins.map((p) => p.name + (p.n > 1 ? ' ×' + p.n : ''))),
    sec('Sample tidak ada di arsip (klip / pad tetap ada, tanpa suara)', [...R.samplesMissing, ...r.missingOnOpen.filter((p) => !/\/_missing\//.test(p))], 'warn'),
    sec('Tidak dikonversi', R.skipped, 'warn'),
    sec('Catatan', R.warnings));
  modal('Impor selesai: ' + r.name, body, [{ label: 'OK', go: true }]);
  [...document.querySelectorAll('#layer .modal:not(.closing)')].pop()?.classList.add('big');
  toast('Proyek diimpor: ' + r.name, 2500);
}
