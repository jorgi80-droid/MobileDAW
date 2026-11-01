// Drum pad panel for the step sequencer: Mixer (gain, pan, mute, solo), Sample (replace, reverse, pitch, start, end) and Envelope
// (attack, decay, sustain, release) tabs for the selected pad. Knobs only, no faders. Tap a pad name in the step grid to open it.
import { h, knob, menu, modal, ask, toast } from './ui.js';
import { C } from './theme.js';
import { fmtParam } from './defs.js';
import * as BR from './browser.js';
import * as P from './project.js';
import { checkpoint } from './history.js';

const K = {
  gain: { n: 'Gain', min: -36, max: 6, def: 0, unit: 'dB' },
  pan: { n: 'Pan', min: -1, max: 1, def: 0, fmt: 'pan' },
  pit: { n: 'Pitch', min: -12, max: 12, def: 0, step: 1, unit: 'st' },
  dec: { n: 'Decay', min: 0.25, max: 3, def: 1, curve: 'log', unit: 'x' },
  start: { n: 'Start', min: 0, max: 0.95, def: 0, unit: '%' },
  end: { n: 'End', min: 0.05, max: 1, def: 1, unit: '%' },
  a: { n: 'ATK', min: 0, max: 1, def: 0, unit: 's' },
  d: { n: 'DEC', min: 0, max: 2, def: 0, unit: 's' },
  s: { n: 'SUS', min: 0, max: 1, def: 1, unit: '%' },
  r: { n: 'REL', min: 0, max: 2, def: 0, unit: 's' },
};
let tab = 'mix';
const TABS = [['mix', 'Mixer'], ['smp', 'Sample'], ['env', 'Envelope']];

export function padPanel(track, k, { onClose, onChange }) {
  const root = h('div', { class: 'pp' });
  const build = () => {
    const t = P.tr(track), ps = P.padsOf(track), q = ps[k];
    if (!t || !q) { root.replaceChildren(); return; }
    const col = C('#ffa722');
    const kn = (f) => knob(K[f], () => q[f], (v) => P.setPad(track, k, f, v), fmtParam, col);
    const B = (label, fn, on) => h('button', { class: 'b' + (on ? ' on' : ''), onclick: fn }, label);
    const redraw = () => { build(); onChange && onChange(); };
    const pickSample = () => BR.openBrowser('file', { track, pad: k, done: () => redraw() });

    const head = h('div', { class: 'pp-h' },
      h('button', { class: 'pp-name', onclick: () => ask('Nama pad', q.name, (n) => { P.setPad(track, k, 'name', String(n || '').trim().slice(0, 14) || q.name); redraw(); }) }, q.name),
      ...TABS.map(([id, l]) => h('button', { class: 'b' + (tab === id ? ' on' : ''), onclick: () => { tab = id; build(); } }, l)),
      h('button', { class: 'b', 'aria-label': 'Tutup', onclick: () => onClose && onClose() }, '\u2715'));

    const body = h('div', { class: 'pp-b' });
    if (tab === 'mix') {
      body.append(h('div', { class: 'knobs' }, kn('gain'), kn('pan')),
        h('div', { class: 'pp-r' },
          B('Mute', () => { P.setPad(track, k, 'mute', !q.mute); redraw(); }, q.mute),
          B('Solo', () => { P.setPad(track, k, 'solo', !q.solo); redraw(); }, q.solo),
          B('Hapus pad', () => {
            if (ps.length < 2) return toast('Minimal harus ada satu pad.');
            modal('Hapus pad "' + q.name + '"?', h('div', { class: 'sv' }, 'Step pad ini di semua klip track ikut terhapus.'), [{ label: 'Batal' }, { label: 'Hapus', go: true, fn: () => { checkpoint(); P.removePad(track, k); onClose && onClose(true); } }]);
          })));
    } else if (tab === 'smp') {
      const nm = q.sample ? q.sample.name : 'Sintetis bawaan';
      body.append(h('div', { class: 'pp-r' }, h('button', { class: 'b pp-file', onclick: pickSample }, nm), B('Ganti\u2026', pickSample),
        ...(q.sample && P.padHasSynth(track, k) ? [B('Bawaan', () => { if (P.resetPadSound(track, k)) redraw(); })] : [])));
      if (q.sample) body.append(h('div', { class: 'knobs' }, kn('pit'), kn('start'), kn('end')), h('div', { class: 'pp-r' }, B('REV', () => { P.setPad(track, k, 'rev', !q.rev); redraw(); }, q.rev)));
      else body.append(h('div', { class: 'knobs' }, kn('pit'), kn('dec')));
    } else if (q.sample) {
      body.append(h('div', { class: 'knobs' }, kn('a'), kn('d'), kn('s'), kn('r')), h('div', { class: 'sv pp-hint' }, 'REL 0 = sample dimainkan sampai habis. REL > 0 = sample memudar saat step berakhir.'));
    } else {
      body.append(h('div', { class: 'sv pp-hint' }, 'Envelope berlaku untuk pad sample. Pad sintetis bawaan memakai Decay di tab Sample.'));
    }
    root.replaceChildren(head, body);
  };
  build();
  return root;
}

// replace the sound of pad k with a file (drum channel menu: Load Sample)
export function pickPadSample(track, k, done) { BR.openBrowser('file', { track, pad: k, done }); }
// "+ Sample" in the step toolbar: a new pad from a file
export function addPad(track, done) {
  if (P.padsOf(track).length >= P.MAX_PADS) return toast('Batas 16 pad tercapai.');
  BR.openBrowser('file', { track, pad: 'new', done });
}
