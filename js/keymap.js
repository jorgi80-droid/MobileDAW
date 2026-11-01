// Optional keyboard shortcuts for a physical / Bluetooth keyboard. The app is a touch app: every action here also has a touch route, and
// these are this app's own defaults (not FL Studio Mobile shortcuts). Settings -> Pintasan lists every action and lets the user rebind
// (press the new key) or clear it; overrides live in prefs.keymap ({ action: 'Ctrl+K' | '' }). A key never fires while typing in a field.
import { prefs, savePrefs } from './prefs.js';

// [id, label, default combos]
export const ACTIONS = [
  ['play', 'Play / pause', ['Space']],
  ['home', 'Ke awal lagu', ['Home']],
  ['save', 'Simpan (cepat)', ['Ctrl+S']],
  ['saveAs', 'Simpan sebagai…', ['Ctrl+Shift+S']],
  ['undo', 'Urungkan', ['Ctrl+Z']],
  ['redo', 'Ulangi', ['Ctrl+Y', 'Ctrl+Shift+Z']],
  ['copy', 'Copy', ['Ctrl+C']],
  ['cut', 'Cut', ['Ctrl+X']],
  ['paste', 'Paste', ['Ctrl+V']],
  ['duplicate', 'Duplikat pilihan', ['Ctrl+D']],
  ['selectAll', 'Pilih semua (editor aktif)', ['Ctrl+A']],
  ['delete', 'Hapus pilihan', ['Delete', 'Backspace']],
  ['escape', 'Tutup menu / batalkan gestur / lepas pilihan', ['Escape']],
  ['zoomIn', 'Zoom in', ['Equal', 'NumpadAdd', 'Shift+Equal']],
  ['zoomOut', 'Zoom out', ['Minus', 'NumpadSubtract']],
  ['left', 'Kiri: playhead / not terpilih', ['ArrowLeft']],
  ['right', 'Kanan: playhead / not terpilih', ['ArrowRight']],
  ['up', 'Atas: track sebelumnya / not +1', ['ArrowUp']],
  ['down', 'Bawah: track berikutnya / not −1', ['ArrowDown']],
  ['tab', 'Pindah Arrangement / Mixer', ['Tab']],
  ['metro', 'Metronom', ['M']],
  ['rec', 'Rekam', ['R']],
  ['browser', 'Browser', ['B']],
  ['fullscreen', 'Layar penuh', ['F']],
];
export const ACTION_LABEL = Object.fromEntries(ACTIONS.map(([id, l]) => [id, l]));

const KEY_NAME = (code) => code.replace(/^Key/, '').replace(/^Digit/, '');
const MOD_CODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);
// 'Ctrl+Shift+S' style text for a keydown event (Cmd counts as Ctrl); null for a lone modifier key
export function comboOf(e) {
  if (!e.code || MOD_CODES.has(e.code)) return null;
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + KEY_NAME(e.code);
}
// what the user sees: 'Equal' -> '=', 'ArrowLeft' -> '←' ...
const SHOW = { Equal: '=', Minus: '−', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Spasi', Escape: 'Esc', Delete: 'Del', Backspace: '⌫', NumpadAdd: 'Num +', NumpadSubtract: 'Num −' };
export const showCombo = (c) => (c ? c.split('+').map((p) => SHOW[p] || p).join(' + ') : '—');

// combos bound to an action: the user's override (one combo, '' = none) or the defaults
export function combosFor(id) {
  const o = prefs.keymap && Object.prototype.hasOwnProperty.call(prefs.keymap, id) ? prefs.keymap[id] : null;
  if (o !== null && o !== undefined) return o ? [o] : [];
  const a = ACTIONS.find((x) => x[0] === id); return a ? a[2] : [];
}
let table = null;
const build = () => { table = new Map(); for (const [id] of ACTIONS) for (const c of combosFor(id)) if (!table.has(c)) table.set(c, id); return table; };
export function actionFor(combo) { return (table || build()).get(combo) || null; }
// rebind: the combo is taken away from any other action that had it (no two actions share a key)
export function bind(id, combo) {
  if (!prefs.keymap || typeof prefs.keymap !== 'object') prefs.keymap = {};
  if (combo) for (const [other] of ACTIONS) if (other !== id && combosFor(other).includes(combo)) prefs.keymap[other] = combosFor(other).filter((c) => c !== combo)[0] || '';
  prefs.keymap[id] = combo || '';
  savePrefs(); table = null;
}
export function resetKeymap() { prefs.keymap = {}; savePrefs(); table = null; }
export const isTyping = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
