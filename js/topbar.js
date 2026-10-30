// Live-style control bar extras: tap tempo, time signature, quantize/snap, time readout, sample rate, MIDI and CPU.
import { fpsNow } from './fps.js';
import { $, menu, toast, ask } from './ui.js';
import { eng } from './engine.js';
import { prefs, savePrefs } from './prefs.js';
import * as P from './project.js';
import * as TL from './timeline.js';
import { openSettings } from './settingsui.js';

const SNAP_NAMES = ['Auto', 'Bar', '1 Beat', '1/2 Beat', '1/4 Beat', 'Triplet', 'Off'];   // same order as the timeline's snap table
const cache = {};
const set = (id, text) => { if (cache[id] !== text) { cache[id] = text; const el = $('#' + id); if (el) el.textContent = text; } };
const below = (e) => { const r = e.currentTarget.getBoundingClientRect(); return [r.left, r.bottom]; };
let srAt = 0;

export function initTopbar({ tap }) {
  $('#btn-tap').onclick = tap;
  $('#rd-sig').onclick = (e) => menu([
    ...P.SIGS.map(([n, d]) => ({ label: n + ' / ' + d, check: P.state.sig.n === n && P.state.sig.d === d, fn: () => P.setSig(n, d) })),
    { sep: true },
    { label: 'Birama baru di bar ' + (P.barAt(Math.max(0, P.state.pos)) + 1) + ' (playhead)\u2026', fn: () => TL.sigDialog(P.barAt(Math.max(0, P.state.pos))) },
    ...P.state.sigs.map((c) => ({ label: 'Hapus ' + c.n + '/' + c.d + ' di bar ' + (c.bar + 1), fn: () => { P.removeSigAt(c.bar); TL.invalidate(); } })),
    { sep: true },
    { label: 'Kustom\u2026', fn: () => ask('Birama (mis. 5/8, 11/8)', P.sigText(), (v) => { const m = /^\s*(\d{1,2})\s*\/\s*(1|2|4|8|16)\s*$/.exec(String(v)); if (m && +m[1] >= 1 && +m[1] <= 32) P.setSig(+m[1], +m[2]); else toast('Format birama: pembilang 1-32 / penyebut 1, 2, 4, 8, atau 16.'); }) },
  ], ...below(e));
  $('#btn-follow').onclick = () => { prefs.follow = !prefs.follow; savePrefs(); TL.applyTimelinePrefs(); };
  $('#midi-ind').onclick = () => openSettings();
  let t = 0;
  window.addEventListener('midiact', () => { const el = $('#midi-ind'); el.classList.add('act'); clearTimeout(t); t = setTimeout(() => el.classList.remove('act'), 140); });
}

export function topbarUpdate() {
  { const sg = P.sigAtTick(Math.max(0, P.state.pos)); set('rd-sig', sg.n + ' / ' + sg.d); }
  $('#btn-follow').classList.toggle('on', !!prefs.follow);
  const sec = Math.max(0, P.state.pos) / P.PPQ * 60 / P.state.bpm;
  set('rd-time', `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')}`);
  set('cpu-t', Math.round(Math.min(1, P.state.cpu) * 100) + '%');
  set('fps-t', fpsNow() ? String(fpsNow()) : '--');
  const now = performance.now();
  if (now - srAt > 1500) { srAt = now; try { const i = eng.info && eng.info(); if (i && i.sampleRate) set('rd-sr', (i.sampleRate / 1000).toFixed(1) + ' kHz'); } catch (_) { /* not ready yet */ } }
}
