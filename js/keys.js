// On-screen keyboard and drum pads (multi-touch). Notes go to the selected track's instrument through eng.preview.
import { h } from './ui.js';
import { eng } from './engine.js';
import * as P from './project.js';
const { state } = P;

let root = null, octave = 3;
const WHITE = [0, 2, 4, 5, 7, 9, 11], BLACK_AT = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10 };   // black key sits after white index -> semitone

function press(el, track, pitch, getVel) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('hit');
    const r = el.getBoundingClientRect();
    P.noteEvent(track, pitch, getVel ? getVel((e.clientY - r.top) / r.height) : 0.85, true);
  });
  const off = () => { el.classList.remove('hit'); P.noteEvent(track, pitch, 0, false); };
  el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
}

export function render() {
  if (!root) return;
  const i = state.sel.track, t = state.tracks[i];
  if (!t || t.kind === 'audio' || t.kind === 'auto') { root.replaceChildren(h('div', { class: 'hint' }, 'Pilih track synth atau drum untuk memakai keyboard dan pad.')); return; }
  if (t.kind === 'drum') {
    const g = h('div', { class: 'padgrid' });
    for (const d of P.padsOf(i)) { const b = h('button', { class: 'bigpad' }, d.name); press(b, i, d.pitch, (y) => 0.5 + 0.5 * y); g.append(b); }
    root.replaceChildren(g); return;
  }
  const keys = h('div', { class: 'piano pw' });
  const base = (octave + 1) * 12;
  for (let o = 0; o < 2; o++) {
    WHITE.forEach((semi, k) => {
      const p = base + o * 12 + semi;
      const w = h('button', { class: 'wk', 'aria-label': 'Nada ' + p }, semi === 0 ? 'C' + (octave + o) : '');
      press(w, i, p, (y) => 0.35 + 0.65 * y);
      keys.append(w);
      if (BLACK_AT[k] !== undefined) {
        const b = h('button', { class: 'bk', style: `left:calc(${((o * 7 + k + 1) / 14) * 100}% - 2.2%)`, 'aria-label': 'Nada ' + (base + o * 12 + BLACK_AT[k]) });
        press(b, i, base + o * 12 + BLACK_AT[k], (y) => 0.35 + 0.65 * y);
        keys.append(b);
      }
    });
  }
  const oct = h('div', { class: 'octs' },
    h('button', { class: 'b', onclick: () => { octave = Math.max(0, octave - 1); render(); } }, 'Oktaf \u2212'),
    h('button', { class: 'b', onclick: () => { octave = Math.min(7, octave + 1); render(); } }, 'Oktaf +'));
  root.replaceChildren(oct, keys, bendWheel(i));
}

// Pitch bend wheel (like the Live keyboard controller): drag up/down = +-2 semitones, springs back to the centre on release
function bendWheel(track) {
  const thumb = h('div', { class: 'pbw-thumb' }), lab = h('div', { class: 'pbw-l' }, 'Pitch');
  const wheel = h('div', { class: 'pbw', 'aria-label': 'Pitch bend' }, h('div', { class: 'pbw-slot' }, h('div', { class: 'pbw-mid' }), thumb), lab);
  let st = 0, raf = 0, down = false;
  const show = () => { thumb.style.top = (50 - st / 2 * 50) + '%'; thumb.classList.toggle('on', st !== 0); };
  const set = (v) => { st = Math.max(-2, Math.min(2, v)); show(); P.setBend(track, st); };
  const at = (e) => { const r = wheel.querySelector('.pbw-slot').getBoundingClientRect(); const n = (e.clientY - r.top) / r.height; const v = (0.5 - n) * 4; set(Math.abs(v) < 0.08 ? 0 : v); };
  wheel.addEventListener('pointerdown', (e) => { e.preventDefault(); cancelAnimationFrame(raf); down = true; wheel.setPointerCapture(e.pointerId); at(e); });
  wheel.addEventListener('pointermove', (e) => { if (down) at(e); });
  const up = () => {
    if (!down) return; down = false;
    const back = () => { if (down) return; st *= 0.55; if (Math.abs(st) < 0.03) { set(0); return; } set(st); raf = requestAnimationFrame(back); };
    raf = requestAnimationFrame(back);
  };
  wheel.addEventListener('pointerup', up); wheel.addEventListener('pointercancel', up);
  show();
  return wheel;
}

export function initKeys(container) {
  root = container;
  P.onChange((w) => { if ((w === 'sel' || w === 'tracks' || w === 'all') && root.isConnected && root.dataset.active === '1') render(); });
}
