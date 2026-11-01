// Import UI: pick a .flm / .flp / .als / .zip, show a progress window while it converts (it can take a while for big projects), then a
// report: what was converted, which samples / plugins are missing and what was skipped. The project is saved as Projects/<name>.mdaw.
import { h, modal, toast } from '../ui.js';
import { eng } from '../engine.js';
import * as P from '../project.js';
import * as QS from '../quicksave.js';
import { importProject } from './index.js';
import { decide, summary, count, describe } from './fxmap.js';
import { MASTER, RET0 } from '../engine.js';

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
    sec('Punya padanan stock plugin, tetapi parameternya belum bisa dikonversi persis (pakai "Ganti seluruh modul" untuk memasangnya dalam keadaan bypass)', fx.layout)];
}
const missingLeft = () => [P.state.master, ...P.state.returns, ...P.state.tracks].reduce((n, c) => n + c.devices.filter((d) => d.missing).length, 0);

// "replace every missing module with MDAW stock plugins": progress window, one undo step, then the same summary
export async function replaceAllMissing() {
  const items = [];
  const chains = [[MASTER, P.state.master], ...P.state.returns.map((r, k) => [RET0 + k, r]), ...P.state.tracks.map((t, k) => [k, t])];
  for (const [i, c] of chains) c.devices.forEach((d) => { if (d.missing) items.push({ i, id: d.id }); });
  if (!items.length) return toast('Tidak ada modul yang hilang di proyek ini.', 2000);
  const bar = h('i', { class: 'imp-fill' }), label = h('div', { class: 'imp-l' }, 'Menyesuaikan dan memproses parameter modul ke plugin bawaan\u2026'), pct = h('b', {}, '0%');
  const win = h('div', { class: 'scrim imp-scrim', style: 'background:var(--scrim)' }, h('div', { class: 'modal imp' }, h('h3', {}, 'Mengganti modul yang hilang'), label, h('div', { class: 'imp-bar' }, bar), h('div', { class: 'imp-row' }, pct, h('span', {}, items.length + ' modul'))));
  document.getElementById('layer').append(win);
  const S = summary();
  await P.HK.group(async () => {
    for (let k = 0; k < items.length; k++) {
      const { i, id } = items[k], c = P.tr(i), di = c ? c.devices.findIndex((d) => d.id === id) : -1;
      if (di < 0) continue;
      const m = c.devices[di].missing, r = decide(m, 'all');
      count(S, m, r);
      if (r.apply) {
        P.replaceDevice(i, di, r.type);
        const nd = P.tr(i).devices[di];
        r.params.forEach((v, kk) => { if (Number.isFinite(v) && nd.params[kk] !== v) P.setDeviceParam(i, di, kk, v); });
        if (!!nd.bypass !== !!r.bypass) P.toggleBypass(i, di);
        nd.from = { ...m, how: r.how, note: r.note };
      }
      const v = Math.round((k + 1) / items.length * 100); bar.style.width = v + '%'; pct.textContent = v + '%';
      if (k % 4 === 3) await new Promise((res) => setTimeout(res, 0));
    }
  });
  P.emit('devices');
  win.remove();
  const fx = describe(S);
  modal('Modul diganti: ' + fx.applied + ' diterapkan, ' + fx.notApplied + ' tidak', h('div', { class: 'imp-rep' }, ...fxSections(fx), h('div', { class: 'sv' }, 'Bisa dibatalkan sekaligus dengan Urungkan. Plugin yang dipasang bypass: nyalakan lalu atur; nilai asli dari proyek tersimpan di device.')), [{ label: 'OK', go: true }]);
  [...document.querySelectorAll('#layer .modal:not(.closing)')].pop()?.classList.add('big');
  return S;
}

function report(r, secs) {
  const R = r.report;
  const left = missingLeft();
  const body = h('div', { class: 'imp-rep' },
    h('div', { class: 'sv' }, `Dari ${r.app}: ${R.tracks} track, ${R.clips} klip, ${R.notes} not, ${R.samplesFound} sample ditemukan, dalam ${secs.toFixed(1)} dtk. Tersimpan sebagai Projects/${r.name}.mdaw.`),
    sec('Instrumen', (R.instruments || []).map((x) => `${x.track}: ${x.from} \u2192 ${x.to}`)),
    ...fxSections(r.fx),
    sec('Sample tidak ada di arsip (klip / pad tetap ada, tanpa suara)', [...R.samplesMissing, ...r.missingOnOpen.filter((p) => !/\/_missing\//.test(p))], 'warn'),
    sec('Tidak dikonversi', R.skipped, 'warn'),
    sec('Catatan', R.warnings));
  modal('Impor selesai: ' + r.name, body, [...(left ? [{ label: 'Ganti seluruh modul hilang (' + left + ') dengan stock plugin', fn: () => { setTimeout(replaceAllMissing, 50); } }] : []), { label: 'OK', go: true }]);
  [...document.querySelectorAll('#layer .modal:not(.closing)')].pop()?.classList.add('big');
  toast('Proyek diimpor: ' + r.name, 2500);
}
