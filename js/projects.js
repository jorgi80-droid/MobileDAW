// Project manager (FL Studio Mobile Home -> Songs): New Project with name / tempo / time signature / template, Recent projects, and the
// per-project actions Open / Duplicate / Rename / Delete (destructive ones ask first). Files live in Projects/<name>.mdaw.
import { h, modal, toast, ask } from './ui.js';
import { eng } from './engine.js';
import * as P from './project.js';
import * as QS from './quicksave.js';
import { prefs, savePrefs } from './prefs.js';

const clean = (n) => String(n || '').trim().replace(/[^\w\- ]+/g, '').slice(0, 60);
const dir = () => eng.home() + '/Projects';
export const pathOf = (name) => dir() + '/' + name + '.mdaw';
const exists = (name) => { const t = eng.readText(pathOf(name)); return typeof t === 'string' && t.length > 20; };

// Recent: names of projects saved / opened, newest first (missing files are skipped when listed)
export function noteRecent(name) {
  if (!name || name === 'Untitled') return;
  const r = (Array.isArray(prefs.recent) ? prefs.recent : []).filter((x) => x !== name);
  r.unshift(name); prefs.recent = r.slice(0, 8); savePrefs();
}
export const recent = () => (Array.isArray(prefs.recent) ? prefs.recent : []).filter((n) => exists(n));

export async function openProject(name) {
  try {
    const miss = await P.deserialize(eng.readText(pathOf(name)));
    QS.markOpened(name); noteRecent(name);
    return { ok: true, miss };
  } catch (e) { return { error: 'Proyek rusak atau tidak bisa dibaca' + (e && e.message ? ': ' + e.message : '.') }; }
}

// FL Studio Mobile: the time signature is chosen when a project is created (it can still be changed later per bar from the ruler)
const SIGS = [[4, 4], [3, 4], [6, 8], [5, 4], [7, 8], [12, 8], [2, 4]];
export function newProjectDialog(after) {
  const name = h('input', { type: 'text', value: '', placeholder: 'Untitled' });
  const bpm = h('input', { type: 'number', value: 120, min: 20, max: 300, step: 1, inputmode: 'decimal' });
  const o = { sig: 0, demo: false };
  const seg = (opts, get, set) => { const box = h('div', { class: 'seg segc' }); const draw = () => box.replaceChildren(...opts.map(([v, t]) => h('button', { class: 'b' + (get() === v ? ' on' : ''), onclick: () => { set(v); draw(); } }, t))); draw(); return box; };
  const row = (l, el) => h('div', { class: 'xd-row' }, h('div', { class: 'xd-l' }, l), el);
  const body = h('div', { class: 'xdlg' },
    row('Nama', name), row('Tempo (BPM)', bpm),
    row('Birama', seg(SIGS.map(([n, d], k) => [k, n + '/' + d]), () => o.sig, (v) => { o.sig = v; })),
    row('Template', seg([[false, 'Kosong'], [true, 'Demo (synth + drum)']], () => o.demo, (v) => { o.demo = v; })),
    h('div', { class: 'hint' }, QS.isDirty() ? 'Perubahan proyek yang terbuka belum disimpan. Simpan dulu bila perlu (proyek terakhir juga tersimpan otomatis).' : 'Birama bisa diubah lagi nanti per bar lewat ruler (ketuk-ganda angka birama).'));
  modal('Proyek baru', body, [{ label: 'Batal' }, { label: 'Buat', go: true, fn: () => {
    const b = Math.max(20, Math.min(300, +bpm.value || 120)), [n, d] = SIGS[o.sig], nm = clean(name.value) || 'Untitled';
    if (nm !== 'Untitled' && exists(nm)) { toast('Nama "' + nm + '" sudah dipakai proyek lain.'); return false; }
    P.newProject(o.demo);
    const was = P.HK.on; P.HK.on = false;                      // part of creating the project: not an undo step
    try { if (n !== 4 || d !== 4) P.setSig(n, d); P.setBpm(b); P.state.projectName = nm; } finally { P.HK.on = was; P.HK.barrier(); }
    P.emit('all');
    toast(`Proyek "${nm}" dibuat: ${b} BPM, ${n}/${d}.`, 2400);
    if (after) after();
  } }]);
  setTimeout(() => name.focus(), 30);
}

// per-project actions (long-press a project in Browser -> Proyek)
export function projectActions(name, done) {
  return [
    { label: 'Buka', fn: async () => { const r = await openProject(name); toast(r.error || (r.miss.length ? r.miss.length + ' file sample/SoundFont tidak ditemukan.' : 'Proyek dibuka.'), r.error ? 4000 : 2000); if (done) done(r); } },
    { label: 'Duplikat', fn: () => { let k = 2, n2 = name + ' ' + k; while (exists(n2)) n2 = name + ' ' + ++k; eng.writeText(pathOf(n2), eng.readText(pathOf(name))); toast('Disalin sebagai "' + n2 + '".'); if (done) done(); } },
    { label: 'Ganti nama…', fn: () => ask('Nama baru', name, async (v) => {
      const n2 = clean(v); if (!n2 || n2 === name) return;
      if (exists(n2)) return toast('Nama itu sudah dipakai.');
      eng.writeText(pathOf(n2), eng.readText(pathOf(name))); await eng.deleteFile(pathOf(name));
      if (P.state.projectName === name) { P.state.projectName = n2; QS.markOpened(n2); }
      prefs.recent = (prefs.recent || []).map((x) => (x === name ? n2 : x)); savePrefs();
      toast('Nama diganti.'); if (done) done();
    }) },
    { label: 'Hapus…', fn: () => modal('Hapus proyek "' + name + '"?', 'File proyek dihapus dari Projects. Sample yang dipakai tidak ikut terhapus. Tindakan ini tidak bisa di-Urungkan.', [{ label: 'Batal' }, { label: 'Hapus', go: true, fn: async () => { await eng.deleteFile(pathOf(name)); prefs.recent = (prefs.recent || []).filter((x) => x !== name); savePrefs(); toast('Proyek dihapus.'); if (done) done(); } }]) },
  ];
}
