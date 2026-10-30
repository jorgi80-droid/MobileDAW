// Mixer, laid out like Ableton Live's: colour tag + name, sends, volume / peak read-outs next to the fader and meter,
// pan, then the activator number and Solo. Every control works (no placeholders). Return A/B and master included. Meters come from the engine poll.
// Long-press a fader / pan / send to create automation for it.
import { C } from './theme.js';
import { h, knob, clamp, ask, menu } from './ui.js';
import { fmtParam } from './defs.js';
import { MASTER, RET0, eng } from './engine.js';
import { offerAutomation } from './automate.js';
import * as P from './project.js';
const { state } = P;

const STRIP_W = 96, VMAX = 1.4;
const PAN = { n: 'Pan', min: -1, max: 1, def: 0, fmt: 'pan' };
const SEND = (k) => ({ n: 'Send ' + 'AB'[k], min: 0, max: 1, def: 0, unit: '%' });
let root = null, strips = [];
const volToPos = (v) => Math.sqrt(clamp(v / VMAX, 0, 1));
const posToVol = (p) => p * p * VMAX;
const dbText = (v) => (v < 0.001 ? '-\u221E' : (20 * Math.log10(v)).toFixed(1));
const meterFrac = (lv) => clamp((20 * Math.log10(Math.max(lv, 1e-4)) + 60) / 66, 0, 1);
let mx = null;                                                    // mixer colours come from the same theme tokens as the arrangement (--text, --line, --dim, --key-*), re-read on theme change
const readMx = () => { const cs = getComputedStyle(document.documentElement), v = (k, d) => cs.getPropertyValue(k).trim() || d; mx = { ink: v('--text', '#cfcfd2'), well: v('--mx-well', '#101011'), rail: v('--dim', '#8b8b92'), edge: v('--line', '#0e0e0f'), cap: v('--key-w', '#d9d9dd'), notch: v('--key-ink', '#444448') }; };
window.addEventListener('themechange', () => { mx = null; });

function strip(i, pos) {
  const t = P.tr(i), master = i === MASTER, ret = i >= RET0, track = i < MASTER;
  const label = master ? 'Master' : t.name;
  const c = h('canvas', { style: 'width:56px;height:100%' });
  const fader = h('div', { class: 'fader' }, c);
  const vbox = h('button', { class: 'vbox', 'aria-label': 'Volume (dB), ketuk untuk mengetik nilai' }, dbText(t.vol));
  const pbox = h('button', { class: 'vbox pk', 'aria-label': 'Puncak, ketuk untuk mereset' }, '-\u221E');
  const refreshVol = () => { vbox.textContent = dbText(t.vol); };
  const set = (e) => {
    const r = c.getBoundingClientRect();
    const v = posToVol(clamp(1 - (e.clientY - r.top - 9) / (r.height - 18), 0, 1));
    P.setVol(i, Math.abs(v - 1) < 0.025 ? 1 : v); refreshVol();
  };
  vbox.addEventListener('click', () => ask(label + ' \u2022 Volume (dB)', t.vol < 0.001 ? -60 : (20 * Math.log10(t.vol)).toFixed(1), (db) => {
    if (!Number.isFinite(db)) return;
    P.setVol(i, db <= -60 ? 0 : clamp(Math.pow(10, db / 20), 0, VMAX)); refreshVol();
  }, 'number'));
  const st = { peak: 0, shown: -1 };
  pbox.addEventListener('click', () => { st.peak = 0; st.shown = -1; pbox.textContent = '-\u221E'; pbox.classList.remove('hot'); });
  let last = 0, timer = 0, moved = false, y0 = 0;
  fader.addEventListener('pointerdown', (e) => {
    fader.setPointerCapture(e.pointerId);
    moved = false; y0 = e.clientY;
    const now = performance.now();
    if (now - last < 300) { P.setVol(i, master ? 1 : 0.85); refreshVol(); last = 0; fader._drag = false; return; }   // double tap = reset, and the finger must not drag it away again
    set(e);
    last = now; fader._drag = true;
    timer = setTimeout(() => { if (!moved) { fader._drag = false; offerAutomation(fader.getBoundingClientRect(), { kind: 0, strip: P.stripOf(i), param: 0, def: P.AUTO_VOL }, `${label} \u2022 Volume`); } }, 520);
  });
  fader.addEventListener('pointermove', (e) => { if (!fader._drag) return; if (Math.abs(e.clientY - y0) > 6) { moved = true; clearTimeout(timer); } set(e); });
  const up = () => { fader._drag = false; clearTimeout(timer); };
  fader.addEventListener('pointerup', up); fader.addEventListener('pointercancel', up);

  const name = h('div', { class: 'nm', style: `--c:${master ? (t.color || '#b4b4ba') : ret ? (t.color || C('#9a8cd0')) : t.color}`, onclick: () => P.selectTrack(i) }, label);
  const ld = track ? h('div', { class: 'ld', title: 'Voice yang berbunyi \u2022 beban CPU track ini (bagian dari anggaran waktu satu blok audio)' }, '\u2014') : null;
  const kids = ld ? [name, ld] : [name];
  const knobs = [];
  let ob = null;
  if (track) {                                                    // output routing: Master (default) or an effect track, like the SENDS list of FL Studio Mobile
    ob = h('button', { class: 'b outb', 'aria-label': 'Output / routing' }, '\u2192 ' + P.outLabel(t.out));
    ob.addEventListener('click', (e) => {
      const r = ob.getBoundingClientRect();
      menu([{ label: 'Master', check: !(t.out >= 0), fn: () => P.setOut(i, -1) },
        ...state.returns.map((rt, k) => ({ label: rt.name, check: t.out === k, fn: () => P.setOut(i, k) })),
        ...(state.returns.length < P.MAX_FX ? [{ sep: true }, { label: 'Buat FX track baru\u2026', fn: () => { const k = P.addFxTrack(); if (k !== null) P.setOut(i, k); } }] : [])], r.left, r.bottom);
    });
    kids.push(ob);
  }
  let m = null, s = null, a = null;
  if (track) {
    const row = h('div', { class: 'sends' });
    for (const k of [0, 1]) {
      const sk = knob(SEND(k), () => (t.send ? t.send[k] : 0), (v) => P.setSend(i, k, v), fmtParam, C('#ffa722'), (r) => offerAutomation(r, { kind: 2 + k, strip: P.stripOf(i), param: 0, def: P.AUTO_SEND }, `${label} \u2022 Send ${'AB'[k]}`));
      sk.classList.add('sm'); row.append(sk); knobs.push(sk);
    }
    kids.push(row);
  } else kids.push(h('div', { class: 'ld ph', 'aria-hidden': 'true' }), h('div', { class: 'outb ph', 'aria-hidden': 'true' }), h('div', { class: 'sends ph', 'aria-hidden': 'true' }));   // invisible spacers (live.css, v63): return / master volume, pan and buttons sit on the same rows as the tracks'
  kids.push(h('div', { class: 'vrow' }, h('div', { class: 'vals' }, vbox, pbox), fader));
  if (!master) {
    const pk = knob(PAN, () => t.pan, (v) => P.setPan(i, v), fmtParam, C('#ffa722'), (r) => offerAutomation(r, { kind: 1, strip: P.stripOf(i), param: 0, def: P.AUTO_PAN }, `${label} \u2022 Pan`));
    pk.classList.add('sm'); kids.push(pk); knobs.push(pk);
  } else kids.push(h('div', { class: 'ph2' }));
  if (track) {
    m = h('button', { class: 'b m' + (t.mute ? ' on' : ''), onclick: () => P.toggleMute(i), 'aria-label': 'Aktivator / Mute' }, String(i + 1));
    s = h('button', { class: 'b s' + (t.solo ? ' on' : ''), onclick: () => P.toggleSolo(i), 'aria-label': 'Solo' }, 'S');
    a = h('button', { class: 'b a' + (t.arm ? ' on' : ''), onclick: () => P.toggleArm(i), 'aria-label': 'Arm rekam', title: 'Arm untuk rekam' });
    kids.push(h('div', { class: 'ms' }, m, s, a));
  } else if (ret) {
    m = h('button', { class: 'b m' + (t.mute ? ' on' : ''), onclick: () => P.toggleReturnMute(i - RET0), 'aria-label': 'Aktivator / Mute' }, (i - RET0 < 2 ? String.fromCharCode(65 + (i - RET0)) : 'F' + (i - RET0 - 1)));
    kids.push(h('div', { class: 'ms' }, m));
  } else kids.push(h('div', { class: 'ms ph' }));
  const el = h('div', { class: 'strip' + (master ? ' master' : ''), style: `min-width:${STRIP_W}px;width:${STRIP_W}px` }, ...kids);
  return { i, pos, el, c, m, s, a, name, t, master, ret, vbox, pbox, st, knobs, ob, ld };
}

export function build() {
  if (!root) return;
  const order = [];
  state.tracks.forEach((t, i) => { if (t.kind !== 'auto') order.push(i); });
  state.returns.forEach((_, k) => order.push(RET0 + k));
  order.push(MASTER);
  strips = order.map((i, pos) => strip(i, pos));
  root.replaceChildren(...strips.map((s) => s.el));
  update();
}

export function update() {
  for (const s of strips) {
    s.vbox.textContent = dbText(s.t.vol);
    for (const k of s.knobs) k.update();
    if (s.master) continue;
    if (s.m) s.m.classList.toggle('on', !!s.t.mute);
    if (s.s) s.s.classList.toggle('on', !!s.t.solo);
    if (s.a) s.a.classList.toggle('on', !!s.t.arm);
    s.name.textContent = s.t.name;
    if (s.ob) s.ob.textContent = '\u2192 ' + P.outLabel(s.t.out);
    if (!s.ret) s.name.style.setProperty('--c', s.t.color);
    s.el.classList.toggle('sel', state.sel.track === s.i);
  }
  const m = strips.find((s) => s.master);
  if (m) m.el.classList.toggle('sel', state.sel.track === MASTER);
}

function drawStrip(s, dpr) {
  const c = s.c, w = c.clientWidth, hh = c.clientHeight;
  if (!w || !hh) return;
  if (!mx) readMx();
  const top = 9, span = hh - 18, now = performance.now(), dt = Math.min(0.12, (now - (s.st.t || now)) / 1000); s.st.t = now;
  // ballistics first (instant attack, release of ~26 dB/s as Live's meters, so the bars glide down instead of flickering with every engine poll)
  if (!s.st.disp) s.st.disp = [0, 0];
  const ys = [0, 0];
  for (const ch of [0, 1]) {
    const lv = (state.meters[s.i * 2 + ch] || 0) / 1000;
    let d = s.st.disp[ch]; d = lv >= d ? lv : d * Math.pow(10, -26 * dt / 20); if (d < 1e-4) d = 0; s.st.disp[ch] = d;
    ys[ch] = top + span * (1 - meterFrac(d));
    if (lv > s.st.peak) s.st.peak = lv;
  }
  // v63: nothing visible changed (idle meters, fader untouched, same size / theme) -> keep the canvas as it is. A silent mixer costs no canvas work at 60 Hz.
  const fy = Math.round(top + span * (1 - volToPos(s.t.vol))), py = s.st.peak > 0 ? Math.round(top + span * (1 - meterFrac(s.st.peak))) : -1;
  const key = Math.round(ys[0]) + '|' + Math.round(ys[1]) + '|' + py + '|' + (s.st.peak > 1 ? 1 : 0) + '|' + fy + '|' + w + 'x' + hh + '|' + dpr;
  if (key === s.st.key && s.st.mx === mx) return;
  s.st.key = key; s.st.mx = mx;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); }
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, hh);
  // Live-style level meter: dark inset well, two channels, lit in small segments (green > yellow > red) with a peak-hold tick
  x.fillStyle = mx.well; x.fillRect(0, top - 3, 20, span + 6);
  x.strokeStyle = mx.edge; x.lineWidth = 1; x.strokeRect(0.5, top - 2.5, 19, span + 5);
  const g = x.createLinearGradient(0, top, 0, top + span);
  g.addColorStop(0, C('#e5484d')); g.addColorStop(0.1, C('#e5484d')); g.addColorStop(0.2, C('#f0d84a')); g.addColorStop(0.36, C('#8fd16a')); g.addColorStop(1, C('#4fae3a'));
  for (const ch of [0, 1]) {
    const bx = 2 + ch * 8, y = ys[ch];
    x.fillStyle = g; x.fillRect(bx, y, 7, top + span - y);
  }
  x.fillStyle = mx.well;                                                                  // segment gaps drawn over the bars
  for (let yy = top + 2; yy < top + span; yy += 3) x.fillRect(1, yy, 18, 1);
  if (s.st.peak > 0) { const py = top + span * (1 - meterFrac(s.st.peak)); x.fillStyle = s.st.peak > 1 ? C('#e5484d') : C('#fff'); x.fillRect(1, Math.round(py), 18, 1); }
  x.font = '7.5px system-ui'; x.textBaseline = 'middle'; x.textAlign = 'left';           // dB scale between meter and fader
  for (const db of [0, -6, -12, -24, -36, -48, -60]) {
    const ty = Math.round(top + span * (1 - meterFrac(Math.pow(10, db / 20))));
    x.fillStyle = mx.rail; x.fillRect(21, ty, 2, 1); x.fillStyle = mx.ink; x.fillText(String(-db), 25, ty);   // text ends at ~x34: clear of the fader cap (starts at x37)
  }
  // Live-style fader: narrow dark slot with tick marks, wide grey cap with grooves and a bright centre line
  const pos = volToPos(s.t.vol), y = Math.round(top + span * (1 - pos));
  x.fillStyle = mx.well; x.fillRect(45, top - 2, 4, span + 4);
  x.strokeStyle = mx.edge; x.strokeRect(44.5, top - 2.5, 5, span + 5);
  x.fillStyle = mx.rail;
  for (const db of [6, 0, -6, -12, -24, -36, -48, -60]) { if (db > 3 && VMAX < 1.9) continue; x.fillRect(51, Math.round(top + span * (1 - volToPos(Math.pow(10, db / 20)))), 3, 1); }
  x.fillStyle = mx.ink; x.fillRect(51, Math.round(top + span * (1 - volToPos(1))), 5, 1);
  // v70: Live-style fader handle - an arrow pointing at the meter (tip on the volume line), flat, with the level line through it
  x.beginPath(); x.moveTo(36.5, y + 0.5); x.lineTo(44.5, y - 6.5); x.lineTo(56.5, y - 6.5); x.lineTo(56.5, y + 7.5); x.lineTo(44.5, y + 7.5); x.closePath();
  x.fillStyle = mx.cap; x.fill(); x.strokeStyle = mx.edge; x.lineWidth = 1; x.stroke();
  x.fillStyle = mx.ink; x.fillRect(40, y, 16, 1);
}

function showPeak(s) {
  const p = s.st.peak, db = p < 0.0001 ? -Infinity : 20 * Math.log10(p), key = Math.round(db * 10);
  if (key === s.st.shown) return;
  s.st.shown = key;
  s.pbox.textContent = p < 0.0001 ? '-\u221E' : db.toFixed(1);
  s.pbox.classList.toggle('hot', db > 0);
}

let loadOn = false, loadAt = 0;
function setLoad(on) { if (on !== loadOn) { loadOn = on; eng.trackLoad(on); if (!on) state.load = null; } }
// voices and CPU per track: measured by the engine only while the mixer is visible (no extra load otherwise); the text is refreshed ~4 times per second
function showLoad(now) {
  if (now - loadAt < 250) return; loadAt = now;
  const L = state.load;
  for (const s of strips) {
    if (!s.ld) continue;
    const v = L ? L[s.i * 2] : 0, c = L ? L[s.i * 2 + 1] / 10 : 0, txt = !L ? '\u2014' : v + ' v \u2022 ' + (c < 1 && c > 0 ? '<1' : Math.round(c)) + '%';
    if (s.ld._t !== txt) { s.ld._t = txt; s.ld.textContent = txt; }
    s.ld.classList.toggle('warn', c >= 25); s.ld.classList.toggle('hot', c >= 50);
  }
}
export function frame() {
  if (!root || root.hidden) { setLoad(false); return; }
  setLoad(true); showLoad(performance.now());
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const a = Math.max(0, Math.floor(root.scrollLeft / STRIP_W) - 1), b = Math.ceil((root.scrollLeft + root.clientWidth) / STRIP_W) + 1;   // #view-mix itself is the scroller
  for (const s of strips) if (s.master || (s.pos >= a && s.pos <= b)) { drawStrip(s, dpr); showPeak(s); }
}

export function initMixer(view) {
  root = view;
  P.onChange((w) => { if (w === 'tracks' || w === 'all') build(); else if (w === 'mix' || w === 'sel') update(); });
  build();
}
