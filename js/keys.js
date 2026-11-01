// On-screen keyboard and drum pads (multi-touch). Notes go to the selected track's instrument through eng.preview.
import { h } from './ui.js';
import { eng } from './engine.js';
import * as P from './project.js';
import * as ED from './editor.js';
import { prefs, savePrefs } from './prefs.js';
import { noteName, octaveOf } from './defs.js';
import { degreeChord, chordName, invert } from './chords.js';
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

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nn = (p) => noteName(p);

// Live 12 / Push style: a slim bar on top (octave number box with arrows, scale switch that mirrors the Clip View scale), then the
// keyboard (octave bands: every C has a darker seam and its name; out-of-scale keys dimmed, the root marked) or the drum pads
// (pad grid in Drum Rack order: first pad bottom-left, face in the track colour while held, brightness = velocity).
export function render() {
  if (!root) return;
  const i = state.sel.track, t = state.tracks[i];
  if (!t || t.kind === 'audio' || t.kind === 'auto') { root.replaceChildren(h('div', { class: 'hint' }, 'Pilih track synth atau drum untuk memakai keyboard dan pad.')); return; }
  const col = t.color || 'var(--accent)';
  if (t.kind === 'drum') {
    const pads = P.padsOf(i), n = pads.length, cols = n <= 6 ? 3 : 4, rows = Math.max(1, Math.ceil(n / cols));
    const g = h('div', { class: 'padgrid', style: `--cols:${cols};--rows:${rows};--tc:${col}` });
    pads.forEach((d, k) => {
      const b = h('button', { class: 'bigpad', style: `grid-column:${(k % cols) + 1};grid-row:${rows - Math.floor(k / cols)}` }, h('span', { class: 'pn' }, d.name), h('small', {}, nn(d.pitch)));
      press(b, i, d.pitch, (y) => 0.5 + 0.5 * y); g.append(b);
    });
    root.replaceChildren(h('div', { class: 'kb-bar' }, h('span', { class: 'kb-t' }, 'Pad'), h('span', { class: 'kb-sub' }, t.name || 'Drum'), h('span', { class: 'grow' }), h('span', { class: 'kb-sub' }, 'Ketuk lebih ke bawah = lebih keras')), g);
    return;
  }
  const mode = MODES.some((m) => m[0] === prefs.keyMode) ? prefs.keyMode : 'classic';
  if (mode !== 'classic') return renderAlt(i, t, col, mode);
  const W = root.clientWidth || 800, nOct = W >= 900 ? 3 : 2, whites = nOct * 7, base = (octave + 1) * 12;
  const th = ED.getTheory(), steps = prefs.keysScale !== false ? ED.scaleSteps() : null;
  const inSc = (p) => !steps || steps.includes(((p - th.key) % 12 + 12) % 12), isRoot = (p) => steps && ((p - th.key) % 12 + 12) % 12 === 0;
  const keys = h('div', { class: 'piano pw', style: `--whites:${whites}` });
  for (let o = 0; o < nOct; o++) {
    WHITE.forEach((semi, k) => {
      const p = base + o * 12 + semi;
      const w = h('button', { class: 'wk' + (semi === 0 ? ' c' : '') + (inSc(p) ? '' : ' out') + (isRoot(p) ? ' root' : ''), 'aria-label': 'Nada ' + nn(p) }, semi === 0 ? h('span', {}, 'C' + (octave + o)) : '');
      press(w, i, p, (y) => 0.35 + 0.65 * y);
      keys.append(w);
      if (BLACK_AT[k] !== undefined) {
        const bp = base + o * 12 + BLACK_AT[k];
        const b = h('button', { class: 'bk' + (steps && inSc(bp) ? ' in' : '') + (isRoot(bp) ? ' root' : ''), style: `left:calc(${((o * 7 + k + 1) / whites) * 100}% - ${31 / whites}%);width:${62 / whites}%`, 'aria-label': 'Nada ' + nn(bp) });
        press(b, i, bp, (y) => 0.35 + 0.65 * y);
        keys.append(b);
      }
    });
  }
  const step = (d) => { octave = Math.max(0, Math.min(8 - nOct, octave + d)); render(); };
  const sc = ED.scaleSteps();
  const bar = h('div', { class: 'kb-bar' },
    h('span', { class: 'kb-t' }, 'Keys'),
    h('div', { class: 'kb-oct' },
      h('button', { class: 'kb-a', 'aria-label': 'Oktaf turun', disabled: octave <= 0 ? '' : null, onclick: () => step(-1) }, '\u2039'),
      h('span', { class: 'kb-v' }, nn(base) + ' \u2013 ' + nn(base + nOct * 12 - 1)),
      h('button', { class: 'kb-a', 'aria-label': 'Oktaf naik', disabled: octave >= 8 - nOct ? '' : null, onclick: () => step(1) }, '\u203a')),
    sc ? h('button', { class: 'kb-sw' + (prefs.keysScale !== false ? ' on' : ''), onclick: () => { prefs.keysScale = prefs.keysScale === false; savePrefs(); render(); } }, 'Skala ' + NAMES[th.key] + ' ' + th.scale) : h('span', { class: 'kb-sub' }, 'Kromatik (skala diatur di Clip View)'),
    modeSeg(), h('span', { class: 'grow' }), h('span', { class: 'kb-sub' }, 'Ketuk lebih ke bawah = lebih keras'));
  root.replaceChildren(bar, h('div', { class: 'kb-body' }, bendWheel(i), keys));
}

// ---- keyboard modes (FL Studio Mobile Controllers): Classic, Scale (only the notes of the Clip View key / scale, as equal keys), Chord (one
// strip per scale degree: top zone = root position, middle = 1st inversion, bottom = 2nd inversion; Hold = chord keeps sounding until the
// strip is touched again) and Strum (the chord's notes one after another: top half strums down from the highest note, bottom half up).
const MODES = [['classic', 'Klasik'], ['scale', 'Skala'], ['chord', 'Chord'], ['strum', 'Strum']];
function modeSeg() {
  const cur = MODES.some((m) => m[0] === prefs.keyMode) ? prefs.keyMode : 'classic';
  return h('div', { class: 'kb-seg' }, ...MODES.map(([k, l]) => h('button', { class: 'kb-sw' + (cur === k ? ' on' : ''), onclick: () => { releaseAll(); prefs.keyMode = k; savePrefs(); render(); } }, l)));
}
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const scaleOf = () => { const st = ED.scaleSteps(); return st && st.length >= 5 ? st : MAJOR; };
const held = new Map();                                          // strip / pointer -> { track, notes, timers }
function releaseAll() { for (const [k, x] of held) { for (const tm of x.timers) clearTimeout(tm); for (const p of x.notes) P.noteEvent(x.track, p, 0, false); held.delete(k); } }
function playNotes(key, track, notes, vel, gapMs) {             // gapMs = 0: together; > 0: one after another (strum); a tiny spread humanises Chord
  const x = { track, notes: [], timers: [] }; held.set(key, x);
  notes.forEach((p, k) => { const go = () => { x.notes.push(p); P.noteEvent(track, p, vel, true); }; if (k && gapMs > 0) x.timers.push(setTimeout(go, k * gapMs)); else go(); });
}
function stopNotes(key) { const x = held.get(key); if (!x) return; for (const tm of x.timers) clearTimeout(tm); for (const p of x.notes) P.noteEvent(x.track, p, 0, false); held.delete(key); }
function renderAlt(i, t, col, mode) {
  const th = ED.getTheory(), steps = scaleOf(), key = ED.scaleSteps() ? th.key : 0, oct = Math.max(1, Math.min(6, octave + 1));
  const body = h('div', { class: 'kb-alt kb-' + mode, style: `--tc:${col}` });
  const bar = h('div', { class: 'kb-bar' }, h('span', { class: 'kb-t' }, 'Keys'),
    h('div', { class: 'kb-oct' }, h('button', { class: 'kb-a', 'aria-label': 'Oktaf turun', onclick: () => { octave = Math.max(0, octave - 1); render(); } }, '\u2039'), h('span', { class: 'kb-v' }, 'Oktaf ' + octaveOf((oct + 1) * 12)), h('button', { class: 'kb-a', 'aria-label': 'Oktaf naik', onclick: () => { octave = Math.min(6, octave + 1); render(); } }, '\u203a')),
    h('span', { class: 'kb-sub' }, (ED.scaleSteps() ? NAMES[th.key] + ' ' + th.scale : 'C Major (atur skala di Clip View)')), modeSeg());
  if (mode === 'scale') {                                         // two octaves of scale notes as equal keys; velocity from the touch height
    const n = steps.length * 2 + 1;
    for (let k = 0; k < n; k++) {
      const p = (oct + 1) * 12 + key + steps[k % steps.length] + Math.floor(k / steps.length) * 12;
      const b = h('button', { class: 'sk' + ((p - key) % 12 === 0 ? ' root' : ''), 'aria-label': 'Nada ' + nn(p) }, h('span', {}, nn(p)));
      press(b, i, p, (y) => 0.35 + 0.65 * y); body.append(b);
    }
  } else {
    const ext = prefs.chord7 ? 4 : 3, gap = mode === 'strum' ? clampMs(prefs.strumMs) : 0;
    bar.append(h('button', { class: 'kb-sw' + (prefs.chord7 ? ' on' : ''), onclick: () => { prefs.chord7 = !prefs.chord7; savePrefs(); render(); } }, '7th'),
      mode === 'strum' ? h('div', { class: 'kb-seg' }, ...[[15, 'Cepat'], [35, 'Normal'], [70, 'Lambat']].map(([ms, l]) => h('button', { class: 'kb-sw' + (clampMs(prefs.strumMs) === ms ? ' on' : ''), onclick: () => { prefs.strumMs = ms; savePrefs(); render(); } }, l)))
        : h('button', { class: 'kb-sw' + (prefs.chordHold ? ' on' : ''), onclick: () => { releaseAll(); prefs.chordHold = !prefs.chordHold; savePrefs(); render(); } }, 'Hold'));
    for (let d = 0; d < steps.length; d++) {
      const ch = degreeChord(key, steps, d, ext, oct), name = chordName(ch), k0 = 's' + d;
      const strip = h('div', { class: 'chs' + (held.has(k0) ? ' on' : '') }, h('b', {}, name), ...(mode === 'chord' ? ['Root', '1st inv', '2nd inv'] : ['\u2193 Strum', '\u2191 Strum']).map((l) => h('i', {}, l)));
      strip.addEventListener('pointerdown', (e) => {
        e.preventDefault(); try { strip.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
        const r = strip.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
        if (mode === 'chord' && prefs.chordHold && held.has(k0)) { stopNotes(k0); strip.classList.remove('on'); return; }   // latch: touch again = stop
        if (mode === 'chord' && prefs.chordHold) { for (const k of [...held.keys()]) stopNotes(k); body.querySelectorAll('.chs.on').forEach((x) => x.classList.remove('on')); }
        stopNotes(k0);
        const notes = mode === 'chord' ? invert(ch, y < 0.38 ? 0 : y < 0.69 ? 1 : 2) : (y < 0.5 ? ch.slice().reverse() : ch);
        playNotes(k0, i, notes, 0.8, mode === 'chord' ? 0 : gap); strip.classList.add('on');
      });
      const up = () => { if (mode === 'chord' && prefs.chordHold) return; stopNotes(k0); strip.classList.remove('on'); };
      strip.addEventListener('pointerup', up); strip.addEventListener('pointercancel', up);
      body.append(strip);
    }
  }
  root.replaceChildren(bar, h('div', { class: 'kb-body' }, bendWheel(i), body));
}
const clampMs = (v) => ([15, 35, 70].includes(+v) ? +v : 35);

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
