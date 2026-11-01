// Save / Quick Save (FL Studio Mobile: a swipe on the save control saves without a dialog) and the saved / unsaved indicator.
// - save(): asks for a name (Save As) and writes Projects/<name>.mdaw.
// - quickSave(): overwrites the open project's file without a dialog. Recovery rule: the version on disk is first copied to
//   Projects/_backup_<name>.mdaw (one level), so an unwanted overwrite can be undone from the Proyek browser. A project that was never
//   saved under a name gets the dialog instead (nothing is overwritten silently).
// - the indicator: a dot on the menu button while the project differs from the last save (checked when idle, never during a drag).
import { eng } from './engine.js';
import * as P from './project.js';
import { ask, toast } from './ui.js';
import { haptic } from './gesture.js';

const dir = () => eng.home() + '/Projects';
export const BACKUP_PREFIX = '_backup_';
export const isHiddenProject = (name) => name.startsWith('_');               // autosave + backups do not show in the project list
const clean = (n) => String(n || '').trim().replace(/[^\w\- ]+/g, '');
export const projectPath = (name) => dir() + '/' + name + '.mdaw';

let savedText = null, savedName = null, dirty = false, maybe = false;
const listeners = new Set();
export const onSaveState = (f) => { listeners.add(f); f(dirty); };
function setDirty(d) { if (d === dirty) return; dirty = d; for (const f of listeners) f(d); }
export const isDirty = () => dirty;
export const hasName = () => !!savedName && savedName === P.state.projectName;

function write(name) {
  const txt = P.serialize(), path = projectPath(name);
  eng.writeText(path, txt);
  P.state.projectName = name; savedName = name; savedText = txt; maybe = false; setDirty(false);
  return path;
}
export function saveAs(after) {
  const cur = P.state.projectName === 'Untitled' ? '' : P.state.projectName;
  ask('Simpan proyek sebagai', cur, (n) => {
    n = clean(n); if (!n) return toast('Nama proyek kosong.');
    write(n); toast('Tersimpan: ' + n); if (after) after();
  });
}
export function quickSave() {
  const name = clean(P.state.projectName);
  if (!name || name === 'Untitled' || savedName !== P.state.projectName) {        // never saved under this name yet: ask once (nothing is overwritten blindly)
    const path = name && name !== 'Untitled' ? projectPath(name) : null, prev = path ? eng.readText(path) : null;
    if (!(typeof prev === 'string' && prev.length > 20)) return saveAs();
    // a file with this name exists (project opened from the list): it is overwritten, with a backup of what was there
  }
  const path = projectPath(name), old = eng.readText(path);
  if (typeof old === 'string' && old.length > 20) { const txt = P.serialize(); if (txt === old) { savedName = name; savedText = txt; setDirty(false); return toast('Sudah tersimpan: ' + name, 1200); } eng.writeText(dir() + '/' + BACKUP_PREFIX + name + '.mdaw', old); }
  write(name); haptic(18);
  toast('Simpan cepat: ' + name + (typeof old === 'string' && old.length > 20 ? ' (versi sebelumnya disimpan sebagai cadangan)' : ''), 2200);
}
// a project was opened from a file: that file is its save target and it starts clean
export function markOpened(name) { savedName = name; try { savedText = P.serialize(); } catch (_) { savedText = null; } maybe = false; setDirty(false); }

export function initSaveState() {
  let down = 0;
  addEventListener('pointerdown', () => { down++; }, true);
  const lift = () => { down = Math.max(0, down - 1); }; addEventListener('pointerup', lift, true); addEventListener('pointercancel', lift, true);
  P.onChange((w) => {
    if (w === 'sel' || w === 'history') return;
    if (w === 'all') { savedName = null; savedText = null; }                       // another project: unknown until it is saved
    maybe = true;
  });
  setInterval(() => {
    if (!maybe || down > 0 || document.hidden) return;
    maybe = false;
    const run = () => { if (savedText === null) { setDirty(P.state.projectName !== 'Untitled' || P.state.tracks.some((t) => t.clips.length)); return; } setDirty(P.serialize() !== savedText); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 }); else run();
  }, 2500);
}
