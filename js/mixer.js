// Mixer, laid out like Ableton Live 12's: title bar in the track colour, Audio To chooser, sends, pan, volume / peak fields,
// then the meter with its dB scale next to the volume fader, and the activator / Solo / Arm buttons at the bottom. Every section
// has a fixed height on every strip (tracks, returns, master), so the rows line up across the whole mixer.
// Every control works (no placeholders). Meters come from the engine poll. Long-press a fader / pan / send to create automation for it.
import { C } from './theme.js';
import { h, knob, clamp, ask, menu, touchCtrl } from './ui.js';
import { fmtParam } from './defs.js';
import { MASTER, RET0, eng } from './engine.js';
import { offerAutomation } from './automate.js';
import { prefs, savePrefs } from './prefs.js';
import * as P from './project.js';
import { gestureTiming } from './gesture.js';
const { state } = P;

const STRIP_W = 104, VMAX = 1.4, W_MIN = 92, W_MAX = 168;
let stripW = clamp(+prefs.mixW || STRIP_W, W_MIN, W_MAX);          // strip width: drag the grip at the right end of any title bar (Live: drag a strip's edge), double-tap = default
const PAN = { n: 'Pan', min: -1, max: 1, def: 0, fmt: 'pan' };
const WIDTH = { n: 'Width', min: 0, max: 2, def: 1, unit: '%' };   // stereo width: 0 % mono, 100 % as is, 200 % wide
const SEND = (k) => ({ n: 'Send ' + 'AB'[k], min: 0, max: 1, def: 0, unit: '%' });
let root = null, strips = [];
const volToPos = (v) => Math.sqrt(clamp(v / VMAX, 0, 1));
const posToVol = (p) => p * p * VMAX;
const dbText = (v) => (v < 0.001 ? '-∞' : (20 * Math.log10(v)).toFixed(1));
const meterFrac = (lv) => clamp((20 * Math.log10(Math.max(lv, 1e-4)) + 60) / 66, 0, 1);
const ink = (hex) => { const n = parseInt(String(hex).slice(1, 7), 16); if (!Number.isFinite(n)) return '#141414'; return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150 ? '#141414' : '#f4f4f4'; };
let mx = null;                                                    // mixer colours come from the same theme tokens as the arrangement (--text, --line, --dim, --key-*), re-read on theme change
const readMx = () => { const cs = getComputedStyle(document.documentElement), v = (k, d) => cs.getPropertyValue(k).trim() || d; mx = { ink: v('--text', '#cfcfd2'), dim: v('--dim', '#8b8b92'), well: v('--mx-well', '#101011'), rail: v('--dim', '#8b8b92'), edge: v('--line', '#0e0e0f'), cap: v('--key-w', '#d9d9dd'), notch: v('--key-ink', '#444448'), acc: v('--accent', '#ffa722') }; };
window.addEventListener('themechange', () => { mx = null; });

function strip(i, pos) {
  const t = P.tr(i), master = i === MASTER, ret = i >= RET0, track = i < MASTER;
  const label = master ? 'Master' : t.name, col = master ? (t.color || '#b4b4ba') : ret ? (t.color || C('#9a8cd0')) : t.color;
  const sec = (cls, ...kids) => h('div', { class: 'mx-sec ' + cls }, ...kids);
  // title bar in the track colour (tap = select the track, its devices show in the Device tab)
  const name = h('button', { class: 'mx-title', style: `--c:${col};--ci:${ink(col)}`, onclick: () => P.selectTrack(i) }, label);
  // I/O: Audio To (tracks route to Master or an effect track), returns and master show where they go
  let ob = null;
  if (track) {
    ob = h('button', { class: 'mx-ch', 'aria-label': 'Output / routing' }, h('span', {}, P.outLabel(t.out)), h('i', { class: 'tri', 'aria-hidden': 'true' }));
    ob.addEventListener('click', () => {
      const r = ob.getBoundingClientRect();
      menu([{ label: 'Master', check: !(t.out >= 0), fn: () => P.setOut(i, -1) },
        ...state.returns.map((rt, k) => ({ label: rt.name, check: t.out === k, fn: () => P.setOut(i, k) })),
        ...(state.returns.length < P.MAX_FX ? [{ sep: true }, { label: 'Buat FX track baru…', fn: () => { const k = P.addFxTrack(); if (k !== null) P.setOut(i, k); } }] : [])], r.left, r.bottom);
    });
  }
  const io = sec('mx-io', h('span', { class: 'mx-lbl' }, 'Audio To'), ob || h('span', { class: 'mx-fix' }, master ? 'Out 1/2' : 'Master'));
  const ld = track ? h('div', { class: 'mx-load', title: 'Voice yang berbunyi • beban CPU track ini (bagian dari anggaran waktu satu blok audio)' }, '—') : h('div', { class: 'mx-load' }, ret ? 'Return' : 'Main');
  // sends (tracks), pan (tracks and returns)
  const knobs = [];
  const sends = sec('mx-sends');
  if (track) {
    for (const k of [0, 1]) {
      const sk = knob(SEND(k), () => (t.send ? t.send[k] : 0), (v) => P.setSend(i, k, v), fmtParam, C('#ffa722'), (r) => offerAutomation(r, { kind: 2 + k, strip: P.stripOf(i), param: 0, def: P.AUTO_SEND }, `${label} • Send ${'AB'[k]}`));
      sk.classList.add('sm'); sends.append(sk); knobs.push(sk);
    }
  }
  const pan = sec('mx-pan');
  if (!master) {
    const pk = knob(PAN, () => t.pan, (v) => P.setPan(i, v), fmtParam, C('#ffa722'), (r) => offerAutomation(r, { kind: 1, strip: P.stripOf(i), param: 0, def: P.AUTO_PAN }, `${label} • Pan`));
    pk.classList.add('sm'); pan.append(pk); knobs.push(pk);
  }
  {
    const wk = knob(WIDTH, () => t.width ?? 1, (v) => P.setWidth(i, Math.abs(v - 1) < 0.02 ? 1 : v), fmtParam, C('#5ac8fa'), (r) => offerAutomation(r, { kind: 7, strip: P.stripOf(i), param: 0, def: P.AUTO_WIDTH }, `${label} • Width`));
    wk.classList.add('sm', 'wd'); pan.append(wk); knobs.push(wk);
  }
  // volume and peak fields (Live: above the meter), then the meter + fader
  const vbox = h('button', { class: 'vbox', 'aria-label': 'Volume (dB), ketuk untuk mengetik nilai' }, dbText(t.vol));
  const pbox = h('button', { class: 'vbox pk', 'aria-label': 'Puncak, ketuk untuk mereset' }, '-∞');
  const refreshVol = () => { vbox.textContent = dbText(t.vol); };
  vbox.addEventListener('click', () => ask(label + ' • Volume (dB)', t.vol < 0.001 ? -60 : (20 * Math.log10(t.vol)).toFixed(1), (db) => {
    if (!Number.isFinite(db)) return;
    P.setVol(i, db <= -60 ? 0 : clamp(Math.pow(10, db / 20), 0, VMAX)); refreshVol();
  }, 'number'));
  const st = { peak: 0, shown: -1, fpos: volToPos(t.vol) };
  pbox.addEventListener('click', () => { st.peak = 0; st.shown = -1; pbox.textContent = '-∞'; pbox.classList.remove('hot'); });
  const c = h('canvas', {});
  const fader = h('div', { class: 'mx-fader', 'aria-label': 'Volume' }, c);
  // relative drag (Live): touching the fader never makes the volume jump; the cap follows the finger from where it was
  let last = 0, timer = 0, d = null;
  fader.addEventListener('pointerdown', (e) => {
    fader.setPointerCapture(e.pointerId);
    const now = performance.now();
    if (now - last < 300) { P.setVol(i, master ? 1 : 0.85); refreshVol(); last = 0; d = null; return; }   // double tap = reset, and the finger must not drag it away again
    last = now;
    d = { y0: e.clientY, p0: volToPos(t.vol), moved: false, span: Math.max(40, c.getBoundingClientRect().height - 24) };
    timer = setTimeout(() => { if (d && !d.moved) { d = null; offerAutomation(fader.getBoundingClientRect(), { kind: 0, strip: P.stripOf(i), param: 0, def: P.AUTO_VOL }, `${label} • Volume`); } }, gestureTiming().longMs);
  });
  fader.addEventListener('pointermove', (e) => {
    if (!d) return;
    const dy = e.clientY - d.y0;
    if (!d.moved) { if (Math.abs(dy) < 4) return; d.moved = true; clearTimeout(timer); fader.classList.add('drag'); touchCtrl((r) => offerAutomation(r, { kind: 0, strip: P.stripOf(i), param: 0, def: P.AUTO_VOL }, `${label} • Volume`)); }
    const v = posToVol(clamp(d.p0 - dy / d.span, 0, 1));
    P.setVol(i, Math.abs(v - 1) < 0.02 ? 1 : v); refreshVol();
  });
  const up = () => { d = null; clearTimeout(timer); fader.classList.remove('drag'); };
  fader.addEventListener('pointerup', up); fader.addEventListener('pointercancel', up);
  const vals = h('div', { class: 'mx-vals' }, vbox, pbox);
  // activator / Solo / Arm (tracks), activator letter (returns)
  let m = null, s = null, a = null;
  const btns = h('div', { class: 'mx-btns' });
  if (track) {
    m = h('button', { class: 'b m' + (t.mute ? ' on' : ''), onclick: () => P.toggleMute(i), 'aria-label': 'Aktivator / Mute' }, String(i + 1));
    s = h('button', { class: 'b s' + (t.solo ? ' on' : ''), onclick: () => P.toggleSolo(i), 'aria-label': 'Solo' }, 'S');
    a = h('button', { class: 'b a' + (t.arm ? ' on' : ''), onclick: () => P.toggleArm(i), 'aria-label': 'Arm rekam', title: 'Arm untuk rekam' });
    btns.append(m, s, a);
  } else if (ret) {
    m = h('button', { class: 'b m' + (t.mute ? ' on' : ''), onclick: () => P.toggleReturnMute(i - RET0), 'aria-label': 'Aktivator / Mute' }, (i - RET0 < 2 ? String.fromCharCode(65 + (i - RET0)) : 'F' + (i - RET0 - 1)));
    btns.append(m);
  }
  // phase invert: tap = both sides, long press = left / right only
  const ph = h('button', { class: 'b ph' + ((t.inv | 0) ? ' on' : ''), 'aria-label': 'Balik fase (polaritas)', title: 'Balik fase' }, '\u00d8');
  { let tm = 0, held = false;
    ph.addEventListener('pointerdown', () => { held = false; tm = setTimeout(() => { held = true; const r = ph.getBoundingClientRect(), f = t.inv | 0;
      menu([['Mati', 0], ['Kiri saja', 1], ['Kanan saja', 2], ['Kiri + kanan', 3]].map(([l, v]) => ({ label: 'Balik fase: ' + l, check: f === v, fn: () => P.setInvert(i, v) })), r.left, r.bottom + 2); }, 450); });
    ph.addEventListener('pointerup', () => { clearTimeout(tm); if (!held) P.setInvert(i, (t.inv | 0) ? 0 : 3); });
    ph.addEventListener('pointercancel', () => clearTimeout(tm)); }
  btns.append(ph);
  let inp = null;
  if (ret) {                                                         // a return has no sends of its own: show who feeds it (Live shows the incoming sends on the return)
    const k = i - RET0, nn = h('span', { class: 'mx-inn' }), nl = h('span', { class: 'mx-inl' });
    inp = () => { const from = state.tracks.filter((q) => q.kind !== 'auto' && ((q.send && q.send[k] > 0) || q.out === k)), a = from.length ? from.length + ' track' : '\u2014', b = from.slice(0, 3).map((q) => q.name).join(', ') + (from.length > 3 ? '\u2026' : ''); if (nn.textContent !== a) nn.textContent = a; if (nl.textContent !== b) nl.textContent = b; };
    sends.classList.add('mx-in'); sends.append(h('span', { class: 'mx-lbl' }, 'Input'), nn, nl); inp();
  }
  const grip = h('div', { class: 'mx-grip', 'aria-label': 'Lebar strip' });
  gripDrag(grip);
  const el = h('div', { class: 'mxs' + (master ? ' master' : ret ? ' ret' : '') + (ret && i === RET0 ? ' ret0' : ''), style: `width:${stripW}px` }, name, io, ld, sends, pan, vals, fader, btns, grip);
  return { i, pos, el, c, m, s, a, ph, name, t, master, ret, vbox, pbox, st, knobs, ob, ld, fader, inp };
}

function setWidth(w) { stripW = clamp(Math.round(w), W_MIN, W_MAX); for (const s of strips) s.el.style.width = stripW + 'px'; root && root.classList.toggle('mx-wide', stripW >= 132); }
function gripDrag(g) {
  let d = null, last = 0;
  g.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation(); g.setPointerCapture(e.pointerId);
    const now = performance.now(); if (now - last < 300) { setWidth(STRIP_W); prefs.mixW = STRIP_W; savePrefs(); last = 0; return; }
    last = now; d = { x: e.clientX, w: stripW, k: g.parentElement.getBoundingClientRect().width / stripW || 1 }; g.classList.add('drag');
  });
  g.addEventListener('pointermove', (e) => { if (d) setWidth(d.w + (e.clientX - d.x) / d.k); });
  const up = () => { if (!d) return; d = null; g.classList.remove('drag'); prefs.mixW = stripW; savePrefs(); };
  g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
}

export function build() {
  if (!root) return;
  const order = [];
  state.tracks.forEach((t, i) => { if (t.kind !== 'auto') order.push(i); });
  state.returns.forEach((_, k) => order.push(RET0 + k));
  order.push(MASTER);
  strips = order.map((i, pos) => strip(i, pos));
  root.replaceChildren(...strips.map((s) => s.el)); root.classList.toggle('mx-wide', stripW >= 132);
  update();
}

export function update() {
  for (const s of strips) {
    if (s.inp) s.inp();
    s.vbox.textContent = dbText(s.t.vol);
    for (const k of s.knobs) k.update();
    s.el.classList.toggle('sel', state.sel.track === s.i);
    if (s.master) continue;
    if (s.m) s.m.classList.toggle('on', !!s.t.mute);
    if (s.s) s.s.classList.toggle('on', !!s.t.solo);
    if (s.ph) { const f = s.t.inv | 0; s.ph.classList.toggle('on', !!f); s.ph.textContent = f === 1 ? '\u00d8L' : f === 2 ? '\u00d8R' : '\u00d8'; }
    if (s.a) s.a.classList.toggle('on', !!s.t.arm);
    s.name.textContent = s.t.name;
    if (s.ob) s.ob.firstChild.textContent = P.outLabel(s.t.out);
    if (!s.ret) { s.name.style.setProperty('--c', s.t.color); s.name.style.setProperty('--ci', ink(s.t.color)); }
  }
}

// Meter (two channels, smooth bars green -> yellow -> red with a peak-hold line) with its dB scale, then Live's volume fader:
// a thin slot with tick marks and a triangular cap pointing at the meter.
function drawStrip(s, dpr, dt) {
  const c = s.c, w = c.clientWidth, hh = c.clientHeight;
  if (!w || !hh) return;
  if (!mx) readMx();
  const top = 10, span = hh - 20;
  // ballistics first (instant attack, release of ~26 dB/s as Live's meters, so the bars glide down instead of flickering with every engine poll)
  if (!s.st.disp) s.st.disp = [0, 0];
  const ys = [0, 0];
  for (const ch of [0, 1]) {
    const lv = (state.meters[s.i * 2 + ch] || 0) / 1000;
    let d = s.st.disp[ch]; d = lv >= d ? lv : d * Math.pow(10, -26 * dt / 20); if (d < 1e-4) d = 0; s.st.disp[ch] = d;
    ys[ch] = top + span * (1 - meterFrac(d));
    if (lv > s.st.peak) s.st.peak = lv;
  }
  // the cap glides to a new value (reset, undo, typed value, automation); while the finger drags it, it follows exactly
  const tp = volToPos(s.t.vol);
  if (s.fader.classList.contains('drag') || prefs.reduceMotion) s.st.fpos = tp;
  else { s.st.fpos += (tp - s.st.fpos) * (1 - Math.exp(-dt * 22)); if (Math.abs(tp - s.st.fpos) * span < 0.25) s.st.fpos = tp; }
  // nothing visible changed (idle meters, fader still, same size / theme) -> keep the canvas as it is. A silent mixer costs no canvas work.
  const fy = Math.round((top + span * (1 - s.st.fpos)) * 2), py = s.st.peak > 0 ? Math.round(top + span * (1 - meterFrac(s.st.peak))) : -1;
  const key = Math.round(ys[0] * 2) + '|' + Math.round(ys[1] * 2) + '|' + py + '|' + (s.st.peak > 1 ? 1 : 0) + '|' + fy + '|' + w + 'x' + hh + '|' + dpr;
  if (key === s.st.key && s.st.mx === mx) return;
  s.st.key = key; s.st.mx = mx;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); }
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, hh);
  const M0 = Math.round(w / 2 - 12), FX = M0 + 27;                                        // meter left edge / fader slot x: scale | meter | fader, centred in the strip
  x.fillStyle = mx.well; x.fillRect(M0, top - 2, 15, span + 4);
  x.strokeStyle = mx.edge; x.lineWidth = 1; x.strokeRect(M0 + 0.5, top - 1.5, 14, span + 3);
  const g = x.createLinearGradient(0, top, 0, top + span);
  g.addColorStop(0, C('#e5484d')); g.addColorStop(0.09, C('#e5484d')); g.addColorStop(0.1, C('#f0d84a')); g.addColorStop(0.28, C('#c9e04a')); g.addColorStop(0.42, C('#6ccf4a')); g.addColorStop(1, C('#3f9a33'));
  for (const ch of [0, 1]) { const bx = M0 + 2 + ch * 6, y = ys[ch]; if (y < top + span) { x.fillStyle = g; x.fillRect(bx, y, 5, top + span - y); } }
  if (s.st.peak > 0) { const yy = Math.round(top + span * (1 - meterFrac(s.st.peak))); x.fillStyle = s.st.peak > 1 ? C('#e5484d') : mx.ink; x.fillRect(M0 + 1, yy, 13, 1); }
  x.font = '600 8px system-ui, sans-serif'; x.textBaseline = 'middle'; x.textAlign = 'right';           // dB scale left of the meter (the fader cap never covers it)
  for (const db of [0, -6, -12, -18, -24, -36, -48, -60]) {
    const ty = Math.round(top + span * (1 - meterFrac(Math.pow(10, db / 20))));
    x.fillStyle = mx.rail; x.fillRect(M0 - 4, ty, 3, 1); x.fillStyle = mx.dim; x.fillText(String(-db), M0 - 6, ty);
  }
  x.textAlign = 'left';
  x.fillStyle = mx.well; x.fillRect(FX, top - 2, 4, span + 4); x.strokeStyle = mx.edge; x.strokeRect(FX - 0.5, top - 2.5, 5, span + 5);
  x.fillStyle = mx.rail;
  for (const db of [6, 0, -6, -12, -24, -36, -48, -60]) { if (db > 3 && VMAX < 1.9) continue; x.fillRect(FX + 7, Math.round(top + span * (1 - volToPos(Math.pow(10, db / 20)))), 3, 1); }
  x.fillStyle = mx.acc; x.fillRect(FX + 7, Math.round(top + span * (1 - volToPos(1))), 5, 1);              // 0 dB mark
  const y = top + span * (1 - s.st.fpos);
  x.beginPath(); x.moveTo(FX - 7.5, y); x.lineTo(FX + 1.5, y - 7.5); x.lineTo(FX + 15.5, y - 7.5); x.lineTo(FX + 15.5, y + 7.5); x.lineTo(FX + 1.5, y + 7.5); x.closePath();
  x.fillStyle = mx.cap; x.fill(); x.strokeStyle = mx.edge; x.lineWidth = 1; x.stroke();
  x.fillStyle = mx.notch; x.fillRect(FX - 3, Math.round(y), 17, 1);
}

function showPeak(s) {
  const p = s.st.peak, db = p < 0.0001 ? -Infinity : 20 * Math.log10(p), key = Math.round(db * 10);
  if (key === s.st.shown) return;
  s.st.shown = key;
  s.pbox.textContent = p < 0.0001 ? '-∞' : db.toFixed(1);
  s.pbox.classList.toggle('hot', db > 0);
}

let loadOn = false, loadAt = 0;
function setLoad(on) { if (on !== loadOn) { loadOn = on; eng.trackLoad(on); if (!on) state.load = null; } }
// voices and CPU per track: measured by the engine only while the mixer is visible (no extra load otherwise); the text is refreshed ~4 times per second
function showLoad(now) {
  if (now - loadAt < 250) return; loadAt = now;
  const L = state.load;
  for (const s of strips) {
    if (s.master || s.ret) continue;
    const v = L ? L[s.i * 2] : 0, c = L ? L[s.i * 2 + 1] / 10 : 0, txt = !L ? '—' : v + ' v • ' + (c < 1 && c > 0 ? '<1' : Math.round(c)) + '%';
    if (s.ld._t !== txt) { s.ld._t = txt; s.ld.textContent = txt; }
    s.ld.classList.toggle('warn', c >= 25); s.ld.classList.toggle('hot', c >= 50);
  }
}
let lastT = 0;
export function frame() {
  if (!root || root.hidden) { setLoad(false); lastT = 0; return; }
  setLoad(true);
  const now = performance.now(), dt = clamp((now - (lastT || now)) / 1000, 0.001, 0.12); lastT = now;
  showLoad(now);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const a = Math.max(0, Math.floor(root.scrollLeft / stripW) - 1), b = Math.ceil((root.scrollLeft + root.clientWidth) / stripW) + 1;   // #view-mix itself is the scroller
  for (const s of strips) if (s.master || s.ret || (s.pos >= a && s.pos <= b)) { drawStrip(s, dpr, dt); showPeak(s); }
}

export function initMixer(view) {
  root = view;
  P.onChange((w) => { if (w === 'tracks' || w === 'all') build(); else if (w === 'mix' || w === 'sel') update(); });
  build();
}
