// MobileDAW 2: the Tempo panel (tap the BPM) and the Performa panel (tap the CPU / FPS readout). Floating cards over a dimmed screen,
// in the theme's colours. Tempo: a ring you drag around (or the number up / down), -10 / -1 / +1 / +10, TAP, metronome, halve / double,
// type a value, the time signature. Performa: audio CPU now and its history, FPS, underruns, memory, engine and buffer.
import { h, ask, toast, clamp } from '../ui.js';
import * as P from '../project.js';
import { eng } from '../engine.js';
import { fpsNow } from '../fps.js';
import { tapPress } from '../tempo.js';
import { openSigMenu } from '../topbar.js';
const { state } = P;

const BMIN = 20, BMAX = 300;
const setB = (b) => P.setBpm(Math.round(clamp(b, BMIN, BMAX) * 10) / 10);
const svg = (w, hh, body) => { const e = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); e.setAttribute('viewBox', `0 0 ${w} ${hh}`); e.innerHTML = body; return e; };

let open = null;
function card(cls, title, body, onClose) {
  close();
  const x = h('button', { class: 'u2p-x', 'aria-label': 'Tutup' }); x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const c = h('div', { class: 'u2p-card ' + cls, role: 'dialog', 'aria-label': title }, h('header', null, h('b', null, title), x), body);
  const root = h('div', { class: 'u2p' }, h('div', { class: 'u2p-scrim' }), c);
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('in'));
  const done = () => { if (open !== done) return; open = null; onClose && onClose(); root.classList.remove('in'); setTimeout(() => root.remove(), 180); };
  root.firstChild.onclick = done; x.onclick = done;
  open = done; return done;
}
export function close() { if (open) { open(); return true; } return false; }

// ---------------------------------------------------------------- Tempo
export function openTempoPanel() {
  const R = 92, CX = 110, CY = 110, A0 = -225, SPAN = 270;                         // a 270 degree ring, 20 BPM at the lower left, 300 at the lower right
  const ang = (b) => A0 + (clamp(b, BMIN, BMAX) - BMIN) / (BMAX - BMIN) * SPAN;
  const pt = (a, r = R) => [CX + r * Math.cos(a * Math.PI / 180), CY + r * Math.sin(a * Math.PI / 180)];
  const arc = (a0, a1) => { const [x0, y0] = pt(a0), [x1, y1] = pt(a1); return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  const ring = svg(220, 220, `<path class="trk" d="${arc(A0, A0 + SPAN)}"/><path class="val" d=""/><circle class="dot" r="9"/>`);
  const big = h('b', { class: 'tp2-bpm' }, ''), sig = h('button', { class: 'tp2-sig' }, '');
  const dial = h('div', { class: 'tp2-dial', role: 'slider', 'aria-label': 'Tempo' }, ring, h('div', { class: 'tp2-mid' }, big, h('span', null, 'BPM'), sig));
  const stepB = (d) => { const b = h('button', { class: 'tp2-step' }, (d > 0 ? '+' : '−') + Math.abs(d)); b.onclick = () => { setB(Math.round(state.bpm) + d); paint(); }; return b; };
  const metro = h('button', { class: 'tp2-chip' }, 'Metronom'), tap = h('button', { class: 'tp2-chip tap' }, 'TAP');
  const half = h('button', { class: 'tp2-chip' }, '÷ 2'), dbl = h('button', { class: 'tp2-chip' }, '× 2'), typ = h('button', { class: 'tp2-chip' }, 'Ketik…');
  const body = h('div', { class: 'tp2' },
    h('div', { class: 'tp2-side' }, stepB(-10), stepB(-1)), dial, h('div', { class: 'tp2-side' }, stepB(10), stepB(1)),
    h('div', { class: 'tp2-row' }, metro, tap, half, dbl, typ));
  const paint = () => {
    const a = ang(state.bpm), [dx, dy] = pt(a);
    ring.querySelector('.val').setAttribute('d', arc(A0, Math.max(A0 + 0.5, a)));
    const d = ring.querySelector('.dot'); d.setAttribute('cx', dx.toFixed(1)); d.setAttribute('cy', dy.toFixed(1));
    big.textContent = state.bpm.toFixed(1); const s = P.sigAtTick(Math.max(0, state.pos)); sig.textContent = 'Birama ' + s.n + '/' + s.d;
    metro.classList.toggle('on', !!state.metro);
  };
  // drag: around the ring = the angle sets the tempo; up / down in the middle = 0.2 BPM per px (fine)
  let d = null;
  dial.addEventListener('pointerdown', (e) => {
    const r = ring.getBoundingClientRect(), k = 220 / r.width, x = (e.clientX - r.left) * k - CX, y = (e.clientY - r.top) * k - CY, onRing = Math.hypot(x, y) > R - 34;
    dial.setPointerCapture(e.pointerId); d = { onRing, y: e.clientY, b: state.bpm, r, k }; if (onRing) fromAngle(e);
  });
  const fromAngle = (e) => { const { r, k } = d, x = (e.clientX - r.left) * k - CX, y = (e.clientY - r.top) * k - CY; let a = Math.atan2(y, x) * 180 / Math.PI; while (a < A0) a += 360; while (a > A0 + 360) a -= 360;
    if (a > A0 + SPAN) a = a - (A0 + SPAN) < (A0 + 360 - a) ? A0 + SPAN : A0; setB(Math.round(BMIN + (a - A0) / SPAN * (BMAX - BMIN))); paint(); };
  dial.addEventListener('pointermove', (e) => { if (!d) return; if (d.onRing) fromAngle(e); else { setB(d.b + (d.y - e.clientY) * 0.2); paint(); } });
  const end = () => { d = null; }; dial.addEventListener('pointerup', end); dial.addEventListener('pointercancel', end);
  metro.onclick = () => { P.toggleMetro(); paint(); };
  tap.onclick = () => { tapPress(); paint(); };
  half.onclick = () => { setB(state.bpm / 2); paint(); }; dbl.onclick = () => { setB(state.bpm * 2); paint(); };
  typ.onclick = () => ask('Tempo (BPM)', state.bpm.toFixed(1), (v) => { if (Number.isFinite(v) && v >= BMIN && v <= BMAX) { setB(v); paint(); } else toast('Tempo antara 20 dan 300 BPM.'); }, 'number');
  sig.onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); openSigMenu(r.left, r.bottom + 4); };
  const tick = setInterval(paint, 250);
  card('tp2c', 'Tempo', body, () => clearInterval(tick)); paint();
}

// ---------------------------------------------------------------- Performa
const HIST = 240, hist = new Float32Array(HIST); let hn = 0, lastAt = 0;
export function sample() { const now = performance.now(); if (now - lastAt < 250) return; lastAt = now; hist[hn % HIST] = clamp(state.cpu, 0, 1.2); hn++; }   // called with the readouts: 4 per second, the last minute
export function openPerfPanel() {
  const cpuB = h('b', null, ''), bar = h('i'), cv = h('canvas', { class: 'pf2-graph' });
  const cell = (k) => { const v = h('b', null, '–'); return [h('div', { class: 'pf2-cell' }, h('span', null, k), v), v]; };
  const [cF, vF] = cell('FPS'), [cU, vU] = cell('Underrun'), [cM, vM] = cell('Memori'), [cE, vE] = cell('Engine'), [cB, vB] = cell('Buffer'), [cS, vS] = cell('Sample rate');
  const reset = h('button', { class: 'tp2-chip' }, 'Reset statistik');
  const body = h('div', { class: 'pf2' },
    h('div', { class: 'pf2-top' }, h('span', null, 'CPU audio'), cpuB), h('div', { class: 'pf2-bar' }, bar), cv,
    h('div', { class: 'pf2-grid' }, cF, cU, cM, cE, cB, cS), h('div', { class: 'tp2-row' }, reset));
  let stats = null;
  const poll = async () => { try { stats = eng.nativeStats ? await eng.nativeStats(false) : null; } catch (_) { stats = null; } };
  reset.onclick = async () => { try { if (eng.nativeStats) await eng.nativeStats(true); } catch (_) { /* web engine: nothing to reset */ } hist.fill(0); hn = 0; toast('Statistik direset.', 1000); };
  const paint = () => {
    const c = Math.round(clamp(state.cpu * 100, 0, 999));
    cpuB.textContent = c + ' %'; bar.style.width = Math.min(100, c) + '%'; bar.className = c > 80 ? 'hot' : c > 55 ? 'warm' : '';
    vF.textContent = Math.round(fpsNow() || 0) + ' fps';
    vU.textContent = stats && stats.blocks ? String(stats.xruns) : '–';
    const m = performance.memory; vM.textContent = m ? Math.round(m.usedJSHeapSize / 1048576) + ' MB' : '–';
    const inf = eng.info ? eng.info() || {} : {};
    vE.textContent = inf.active === 'native' ? 'Native (C++)' : 'Web (WASM)';
    vB.textContent = stats && stats.buffer ? stats.buffer + ' frame' : '–';
    vS.textContent = (inf.sampleRate || (stats && stats.sampleRate) || 48000).toLocaleString('id-ID') + ' Hz';
    // the history graph: the last minute of audio CPU, 0..100 %
    const r = cv.getBoundingClientRect(), dpr = Math.min(3, devicePixelRatio || 1), W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'), st = getComputedStyle(document.documentElement), ac = st.getPropertyValue('--accent').trim() || '#e8dcc4', tx = st.getPropertyValue('--text').trim() || '#ddd';
    g.clearRect(0, 0, W, H); g.globalAlpha = 0.12; g.fillStyle = tx; for (const q of [0.25, 0.5, 0.75]) g.fillRect(0, Math.round(H * q), W, 1); g.globalAlpha = 1;
    const n = Math.min(hn, HIST); if (n > 1) {
      g.beginPath(); for (let k = 0; k < n; k++) { const v = hist[(hn - n + k) % HIST], x = W - (n - 1 - k) * W / (HIST - 1), y = H - Math.min(1, v) * (H - 2) - 1; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
      g.strokeStyle = ac; g.lineWidth = 1.5 * dpr; g.stroke(); g.lineTo(W, H); g.lineTo(W - (n - 1) * W / (HIST - 1), H); g.closePath(); g.globalAlpha = 0.15; g.fillStyle = ac; g.fill(); g.globalAlpha = 1;
    } else { g.fillStyle = tx; g.globalAlpha = 0.5; g.font = `${12 * dpr}px system-ui`; g.textAlign = 'center'; g.fillText('Putar lagu untuk melihat grafik', W / 2, H / 2); g.globalAlpha = 1; }
  };
  const tick = setInterval(() => { paint(); }, 250), slow = setInterval(poll, 1000); poll();
  card('pf2c', 'Performa', body, () => { clearInterval(tick); clearInterval(slow); }); requestAnimationFrame(paint);
}

// ---------------------------------------------------------------- the piano roll's More... (two columns of commands + a transpose stepper)
// cols: [[{ label, fn }]...]; step(d): transpose the selection by d semitones (the panel shows the total since it opened)
export function moreGrid(cols, step) {
  let total = 0;
  const val = h('b', { class: 'mg-val' }, '0');
  const arrow = (d) => { const b = h('button', { class: 'mg-arr', 'aria-label': d > 0 ? 'Naik 1 semitone' : 'Turun 1 semitone' }); b.innerHTML = `<svg viewBox="0 0 24 24"><path d="${d > 0 ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}"/></svg>`; b.onclick = () => { step(d); total += d; val.textContent = (total > 0 ? '+' : '') + total; }; return b; };
  let done = () => {};
  const col = (items) => h('div', { class: 'mg-col' }, ...items.map((it) => { const b = h('button', { class: 'mg-it' + (it.dim ? ' dim' : '') }, it.label); b.onclick = () => { if (it.dim) return; done(); it.fn(); }; return b; }));
  const body = h('div', { class: 'mg' }, ...cols.map(col), h('div', { class: 'mg-step' }, arrow(1), val, arrow(-1)));
  done = card('mgc', 'Aksi not', body);
  return done;
}
