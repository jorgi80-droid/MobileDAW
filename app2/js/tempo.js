// Tempo panel: the FL Studio Mobile set of tempo controls (big readout you can drag, +/- steps, tap, type, halve/double)
// drawn in Ableton Live's flat, dark style. Also holds the shared tap-tempo logic and "sync every audio clip".
import { h, modal, ask, toast, clamp } from './ui.js';
import { checkpoint } from './history.js';
import * as P from './project.js';
import { prefs, savePrefs } from './prefs.js';
import * as TL from './timeline.js';
import { openSigMenu } from './topbar.js';
const { state } = P;

const fmt = (b) => (Math.round(b * 100) / 100).toFixed(2);
const setB = (b) => P.setBpm(Math.round(clamp(b, 20, 300) * 100) / 100);

// ---------------------------------------------------------------- tap tempo (shared by the top bar "Tap" chip and the panel)
let taps = [];
export function tapPress() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2200) taps = [];
  taps.push(now); if (taps.length > 8) taps.shift();
  if (taps.length < 2) { toast('Ketuk lagi sesuai ketukan\u2026', 1200); return null; }
  const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
  setB(Math.round(60000 / avg * 10) / 10);
  return state.bpm;
}
export const resetTaps = () => { taps = []; };

// ---------------------------------------------------------------- sync every audio clip to the project tempo
export async function syncAllClips() {
  const list = [];
  state.tracks.forEach((t, i) => { if (t.kind === 'audio') for (const c of t.clips) list.push({ i, c }); });
  if (!list.length) return toast('Belum ada klip audio.');
  checkpoint(); toast('Mendeteksi dan menyamakan tempo\u2026', 8000);
  let ok = 0, skipped = 0, firstErr = '';
  for (const { i, c } of list) {
    await new Promise((r) => setTimeout(r, 0));                 // let the toast paint between clips
    let src = c.srcBpm;
    if (!(src > 0)) { const d = P.detectClipBpm(i, c.id); if (d.error) { skipped++; firstErr = firstErr || d.error; continue; } src = d.bpm; }
    const out = await P.syncClipToTempo(i, c.id, src, true);
    if (out.error) { skipped++; firstErr = firstErr || out.error; } else ok++;
  }
  toast(`${ok} klip disamakan ke ${fmt(state.bpm)} BPM${skipped ? `, ${skipped} dilewati (${firstErr})` : ''}.`, skipped ? 5200 : 2800);
}

// ---------------------------------------------------------------- panel
// Layout (landscape phone, no scrolling): header / [BPM display | 4x2 button grid] / sync button + one-line note.
export function openTempo() {
  const big = h('div', { class: 'tp-big' }, fmt(state.bpm));
  const btn = (label, fn, cls = '') => h('button', { class: 'b tp-b ' + cls, onclick: fn }, label);
  const step = (d) => btn((d > 0 ? '+' : '\u2212') + Math.abs(d), () => setB(state.bpm + d));

  // the readout itself is the drag control (like a Live number box): right / up raises, left / down lowers, 1 px = 0.05 BPM
  const disp = h('div', { class: 'tp-disp', role: 'slider', 'aria-label': 'Tempo' }, big, h('div', { class: 'tp-unit' }, 'BPM'), h('div', { class: 'tp-hint' }, '\u2194 seret'));
  let d = null;
  disp.addEventListener('pointerdown', (e) => { disp.setPointerCapture(e.pointerId); d = { x: e.clientX, y: e.clientY, b: state.bpm }; disp.classList.add('act'); });
  disp.addEventListener('pointermove', (e) => { if (d) setB(d.b + ((e.clientX - d.x) - (e.clientY - d.y)) * 0.05); });
  const end = () => { d = null; disp.classList.remove('act'); };
  disp.addEventListener('pointerup', end); disp.addEventListener('pointercancel', end);

  const tapBtn = btn('TAP', () => { tapPress(); }, 'tp-tap');
  const half = btn('\u00F7 2', () => setB(state.bpm / 2)), dbl = btn('\u00D7 2', () => setB(state.bpm * 2));
  const typ = btn('Ketik\u2026', () => ask('Tempo (BPM)', fmt(state.bpm), (v) => { if (Number.isFinite(v) && v >= 20 && v <= 300) setB(v); else toast('Tempo harus antara 20 dan 300 BPM.'); }, 'number'));
  const nAudio = () => state.tracks.reduce((n, t) => n + (t.kind === 'audio' ? t.clips.length : 0), 0);
  const syncBtn = btn('Samakan semua klip audio ke tempo ini', () => syncAllClips(), 'tp-wide');
  const sub = h('div', { class: 'tp-sub' });
  // tempo lane (automation of the tempo, drawn in Arrange) + global swing
  const laneBtn = btn('Lane tempo', () => {
    const t = P.addAutoTrack({ kind: 6, strip: 'master', param: 0, def: P.TEMPO_DEF }, 'Tempo');
    if (t) { toast('Lane Tempo siap. Ketuk-ganda klipnya untuk mengedit titik.', 3200); done(); } else toast('Jumlah track sudah maksimum.');
  }, 'tp-lane');
  const swLbl = h('span', { class: 'tp-swl' }), swGrid = btn('1/16', () => { const g = state.groove.grid === 240 ? 480 : state.groove.grid === 480 ? 120 : 240; P.setGroove({ grid: g }); paintSw(); }, 'tp-swg');
  const sw = h('input', { type: 'range', min: '0', max: '100', step: '1', class: 'tp-sw sl', 'aria-label': 'Swing global' });
  sw.addEventListener('input', () => { P.setGroove({ amt: +sw.value / 100 }); paintSw(); });
  const paintSw = () => { sw.value = String(Math.round(state.groove.amt * 100)); sw.style.setProperty('--p', sw.value + '%'); swLbl.textContent = 'Swing ' + sw.value + '%'; swGrid.textContent = state.groove.grid === 480 ? '1/8' : state.groove.grid === 120 ? '1/32' : '1/16'; };
  const row = h('div', { class: 'tp-row' }, laneBtn, swLbl, sw, swGrid);
  // time signature + follow playhead live here (the control bar only keeps the essentials)
  const sigBtn = btn('', (e) => { const r = e.currentTarget.getBoundingClientRect(); openSigMenu(r.left, r.bottom + 4); }, 'tp-sig');
  const folBtn = btn('Ikuti playhead', () => { prefs.follow = !prefs.follow; savePrefs(); TL.applyTimelinePrefs(); paintMeta(); }, 'tp-fol');
  const paintMeta = () => { const sg = P.sigAtTick(Math.max(0, state.pos)); sigBtn.textContent = 'Birama ' + sg.n + ' / ' + sg.d; folBtn.classList.toggle('on', !!prefs.follow); };
  const meta = h('div', { class: 'tp-meta' }, sigBtn, folBtn);
  let closeModal = () => {};
  const done = () => { off(); resetTaps(); closeModal(); };

  const body = h('div', { class: 'tempo' },
    h('div', { class: 'tp-head' }, h('span', { class: 'tp-title' }, 'Tempo'), h('button', { class: 'b tp-done', onclick: () => done() }, 'Selesai')),
    h('div', { class: 'tp-main' }, disp,
      h('div', { class: 'tp-grid' }, step(-1), step(-0.1), step(0.1), step(1), half, dbl, tapBtn, typ)),
    meta, syncBtn, row, sub);

  const paint = () => {
    big.textContent = fmt(state.bpm); paintMeta();
    const n = nAudio();
    paintSw();
    if (P.tempoMapOn()) { sub.textContent = 'Tempo mengikuti lane otomasi. Kotak BPM menskalakan seluruh kurva.'; return; }
    sub.textContent = n ? `${n} klip audio \u2022 BPM dideteksi otomatis, di-stretch tanpa ubah pitch.` : 'Belum ada klip audio. Deteksi BPM per klip ada di Editor audio.';
  };
  paint();
  const off = P.onChange((w) => { if (!body.isConnected) { off(); return; } if (w === 'transport' || w === 'clips' || w === 'all') paint(); });
  closeModal = modal('Tempo', body, []);
}
