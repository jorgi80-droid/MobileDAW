// The seven MiniMeters modules: VU, Waveform, Spectrogram, Spectrum, Stereometer, Loudness, Oscilloscope.
// Every module has  ingest(o)  (one fresh engine frame, ~30 per second),  draw(g, W, H)  (CSS px),  clear()  and a list of options.
// The frame layout (o[...]) is the readOut of class MiniMeters in engine/fx.js - keep both in sync.
import { noteName } from './defs.js';

export const NB = 320, SC = 384, HEAD = 40, END = 2728;
export const O = { A: 40, B: 360, M: 680, S: 1000, scL: 1320, scR: 1704, dots: 2088, dLo: 2344, dMid: 2472, dHi: 2600 };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dbv = (x) => 20 * Math.log10(Math.max(x, 1e-6));
const fdb = (x, d = 1) => (x <= -99 ? '\u2212\u221e' : x.toFixed(d));

// ---- colour themes (MiniMeters ships many; these are five of them) ----
export const THEMES = {
  Default: { a: '#b4c3e0', b: '#ff9d3d', c: '#c9a0ff', bg: '#17191e', panel: '#1d2026', grid: '#2e323b', ink: '#b4c3e0', dim: '#6d6d76', map: [[0, '#000004'], [.2, '#420a68'], [.4, '#932667'], [.6, '#dd513a'], [.8, '#fca50a'], [1, '#fcffa4']] },
  Mono: { a: '#ececf0', b: '#8d8d96', c: '#c8c8d0', bg: '#0d0d0e', panel: '#151516', grid: '#262628', ink: '#c4c4ca', dim: '#707076', map: [[0, '#000000'], [.5, '#6a6a70'], [1, '#ffffff']] },
  Amber: { a: '#ffb347', b: '#ff6f3c', c: '#ffe0a0', bg: '#120d08', panel: '#1a130b', grid: '#2c2113', ink: '#e2c9a0', dim: '#86704f', map: [[0, '#0a0300'], [.35, '#6b2a07'], [.7, '#ff8c1a'], [1, '#fff2c8']] },
  Phosphor: { a: '#5dff8f', b: '#b6ff5d', c: '#7dffd5', bg: '#060d08', panel: '#0b140d', grid: '#14261a', ink: '#a6e8b8', dim: '#4f7c5c', map: [[0, '#000803'], [.4, '#0a5a2a'], [.75, '#4dff7e'], [1, '#eaffe0']] },
  Magenta: { a: '#ff5fb0', b: '#ffa34d', c: '#8f7dff', bg: '#0f0b12', panel: '#17111c', grid: '#2a2033', ink: '#d8c4e4', dim: '#7c6a8a', map: [[0, '#05000a'], [.3, '#4b1070'], [.6, '#d6358f'], [.85, '#ffb36b'], [1, '#fff4d6']] },
};
export const THEME_NAMES = Object.keys(THEMES);

function lut(stops) {                                                 // 256 colours [r,g,b]
  const out = new Uint8ClampedArray(256 * 3), rgb = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  for (let i = 0; i < 256; i++) {
    const t = i / 255; let k = 0; while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1], u = clamp((t - t0) / Math.max(1e-6, t1 - t0), 0, 1), a = rgb(c0), b = rgb(c1);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = a[c] + (b[c] - a[c]) * u;
  }
  return out;
}
const lutCache = new Map();
const lutFor = (th) => { let l = lutCache.get(th); if (!l) { l = lut(THEMES[th].map); lutCache.set(th, l); } return l; };

// ---- frequency scales: position 0..1 along the axis <-> Hz (20 Hz .. 20 kHz) ----
const F0 = 20, F1 = 20000, mel = (f) => 2595 * Math.log10(1 + f / 700), imel = (m) => 700 * (Math.pow(10, m / 2595) - 1);
export function fpos(f, sc) { f = clamp(f, F0, F1); return sc === 'lin' ? (f - F0) / (F1 - F0) : sc === 'mel' ? (mel(f) - mel(F0)) / (mel(F1) - mel(F0)) : Math.log(f / F0) / Math.log(F1 / F0); }
export function pfreq(p, sc) { p = clamp(p, 0, 1); return sc === 'lin' ? F0 + p * (F1 - F0) : sc === 'mel' ? imel(mel(F0) + p * (mel(F1) - mel(F0))) : F0 * Math.pow(F1 / F0, p); }
const TICKS = { log: [30, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000], mel: [100, 200, 500, 1000, 2000, 5000, 10000], lin: [2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000, 18000, 20000] };
const fLabel = (f) => (f >= 1000 ? f / 1000 + 'k' : String(f));
// bin (float, 0..NB-1) of the engine's log spectrum for a frequency; `top` = highest analysed frequency
const binOf = (f, top) => clamp(Math.log(f / 20) / Math.log(Math.max(21, top) / 20) * NB - 0.5, 0, NB - 1);
function sample(arr, off, b) { const i = Math.floor(b), j = Math.min(NB - 1, i + 1), t = b - i; return arr[off + i] + (arr[off + j] - arr[off + i]) * t; }

function text(g, t, x, y, al, col, sz, wt) { g.fillStyle = col; g.font = `${wt || ''} ${sz}px system-ui,sans-serif`; g.textAlign = al || 'left'; g.textBaseline = 'alphabetic'; g.fillText(t, x, y); }
const hline = (g, y, x0, x1, col) => { g.fillStyle = col; g.fillRect(x0, Math.round(y), x1 - x0, 1); };
const vline = (g, x, y0, y1, col) => { g.fillStyle = col; g.fillRect(Math.round(x), y0, 1, y1 - y0); };

// option schema helpers: { k, label, type: 'seg' | 'range' | 'toggle', choices, min, max, step, eng (engine param index), fmt }
const seg = (k, label, choices, extra) => ({ k, label, type: 'seg', choices, ...extra });
const rng = (k, label, min, max, step, fmt, extra) => ({ k, label, type: 'range', min, max, step, fmt, ...extra });
const tog = (k, label, extra) => ({ k, label, type: 'toggle', ...extra });

// =====================================================================================================
//  Each factory receives env = { opt(): this module's option object, T(): theme, eng(k): engine param value, clock }
// =====================================================================================================
const FACTORY = {};

// ---------------------------------------------------------------- VU
FACTORY.vu = (env) => {
  const st = { needle: -20, last: -100, pkT: 0, clT: 0, vu: -20 };
  const chIdx = { L: 6, R: 7, M: 8, S: 9 };
  return {
    title: 'VU', def: { style: 1, ch: 'L', cal: 0, peak: -6, clip: -0.3 },
    opts: [seg('style', 'Style', [[1, '1'], [2, '2']]), seg('ch', 'Channel', [['L', 'Left'], ['R', 'Right'], ['M', 'Mid'], ['S', 'Side']]),
      rng('cal', 'Cal', -12, 12, 0.5, (v) => (v > 0 ? '+' : '') + v + ' dB'), rng('peak', 'Peak', -24, 0, 0.5, (v) => v + ' dB'), rng('clip', 'Clip', -6, 0, 0.1, (v) => v + ' dB')],
    ingest(o) {
      const op = env.opt(), ch = op.ch, cal = +op.cal || 0, now = env.clock();
      const lvl = o[chIdx[ch] || 6] + cal;
      st.vu = clamp(lvl + 18, -40, 12);                                // 0 VU = -18 dBFS RMS (EBU / digital convention)
      const pk = ch === 'L' ? Math.max(Math.abs(o[20]), Math.abs(o[21])) : ch === 'R' ? Math.max(Math.abs(o[22]), Math.abs(o[23])) : ch === 'M' ? Math.max(Math.abs(o[34]), Math.abs(o[35])) : Math.max(Math.abs(o[36]), Math.abs(o[37]));
      const pdb = dbv(pk) + cal;
      if (pdb >= (+op.peak)) st.pkT = now + 500; if (pdb >= (+op.clip)) st.clT = now + 900;
    },
    clear() { st.needle = -20; st.vu = -20; },
    draw(g, W, H) {
      const T = env.T(), op = env.opt(), now = env.clock(), light = +op.style === 1;
      const face = light ? '#e8dfb4' : '#1b1b20', ink = light ? '#222' : '#cfcfd6', red = '#d23a2e';
      g.fillStyle = face; g.fillRect(0, 0, W, H);
      if (light) { const gr = g.createRadialGradient(W / 2, H, 4, W / 2, H, Math.max(W, H)); gr.addColorStop(0, 'rgba(255,250,220,.55)'); gr.addColorStop(1, 'rgba(120,100,40,.28)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
      const cx = W / 2, cy = H * 1.02, R = Math.min(H * 0.9, W * 0.5 / Math.sin(0.9)), a0 = -0.9, a1 = 0.9;
      const amp = (vu) => Math.pow(10, vu / 20), lo = amp(-20), hi = amp(3), pos = (vu) => clamp((amp(vu) - lo) / (hi - lo), 0, 1), ang = (vu) => a0 + pos(vu) * (a1 - a0);
      // red zone
      g.lineWidth = Math.max(2, R * 0.035); g.strokeStyle = red; g.beginPath(); g.arc(cx, cy, R * 0.86, ang(0) - Math.PI / 2, ang(3) - Math.PI / 2); g.stroke();
      g.strokeStyle = ink; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R * 0.86, ang(-20) - Math.PI / 2, ang(0) - Math.PI / 2); g.stroke();
      const major = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
      for (const v of major) {
        const a = ang(v) - Math.PI / 2, c = Math.cos(a), s = Math.sin(a), big = [-20, -10, -5, 0, 3].includes(v);
        g.strokeStyle = v > 0 ? red : ink; g.lineWidth = big ? 1.6 : 1;
        g.beginPath(); g.moveTo(cx + c * R * 0.86, cy + s * R * 0.86); g.lineTo(cx + c * R * (big ? 0.78 : 0.81), cy + s * R * (big ? 0.78 : 0.81)); g.stroke();
        if (big || v === -7 || v === 3) text(g, v > 0 ? '+' + v : String(v), cx + c * R * 0.69, cy + s * R * 0.69 + 3, 'center', v > 0 ? red : ink, Math.max(8, R * 0.075), '600');
      }
      text(g, 'VU', cx, cy - R * 0.36, 'center', ink, Math.max(12, R * 0.15), '700');
      st.needle += (st.vu - st.needle) * 0.45;
      const na = ang(clamp(st.needle, -20, 3)) - Math.PI / 2;
      g.strokeStyle = light ? '#111' : '#ff8a3d'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(na) * R * 0.88, cy + Math.sin(na) * R * 0.88); g.stroke();
      g.fillStyle = light ? '#222' : '#2c2c33'; g.beginPath(); g.arc(cx, cy, R * 0.07, 0, 6.2832); g.fill();
      // peak / clip lights
      const lr = Math.max(4, Math.min(7, R * 0.045)), ly = 9;
      for (const [x, on, col, lab] of [[W - 30, now < st.pkT, '#f2d230', 'PK'], [W - 12, now < st.clT, '#ff3b30', 'CL']]) {
        g.fillStyle = on ? col : (light ? 'rgba(0,0,0,.25)' : 'rgba(255,255,255,.12)'); g.beginPath(); g.arc(x, ly + 4, lr, 0, 6.2832); g.fill();
        text(g, lab, x, ly + 4 + lr + 9, 'center', ink, 7.5);
      }
      text(g, ({ L: 'LEFT', R: 'RIGHT', M: 'MID', S: 'SIDE' })[op.ch] || '', 6, 13, 'left', ink, 8.5, '600');
      text(g, (st.vu >= 0 ? '+' : '') + st.vu.toFixed(1), 6, H - 5, 'left', ink, 9);
    },
  };
};

// ---------------------------------------------------------------- Waveform
FACTORY.waveform = (env) => {
  const RING = 1024, F = { mnL: new Float32Array(RING), mxL: new Float32Array(RING), mnR: new Float32Array(RING), mxR: new Float32Array(RING), mnM: new Float32Array(RING), mxM: new Float32Array(RING), mnS: new Float32Array(RING), mxS: new Float32Array(RING), lo: new Float32Array(RING), mid: new Float32Array(RING), hi: new Float32Array(RING) };
  let total = 0;
  const at = (age) => (total - 1 - age) & (RING - 1);
  const e = (d) => Math.pow(10, clamp(d, -90, 6) / 20);
  const LANES = { L: [['L']], R: [['R']], M: [['M']], S: [['S']], LR: [['L'], ['R']], MS: [['M'], ['S']] };
  return {
    title: 'Waveform', def: { ch: 'LR', color: 'multi', secs: 6, hist: false, loop: false },
    opts: [seg('ch', 'Channels', [['L', 'L'], ['R', 'R'], ['M', 'M'], ['S', 'S'], ['LR', 'L / R'], ['MS', 'M / S']]), seg('color', 'Color', [['static', 'Static'], ['multi', 'Multi-Band'], ['map', 'Color Map']]),
      rng('secs', 'Speed', 2, 30, 1, (v) => v + ' s'), tog('hist', 'Peak History'), tog('loop', 'Loop')],
    ingest(o) {
      const j = total & (RING - 1);
      F.mnL[j] = o[20]; F.mxL[j] = o[21]; F.mnR[j] = o[22]; F.mxR[j] = o[23]; F.mnM[j] = o[34]; F.mxM[j] = o[35]; F.mnS[j] = o[36]; F.mxS[j] = o[37];
      F.lo[j] = o[24]; F.mid[j] = o[25]; F.hi[j] = o[26]; total++;
    },
    clear() { total = 0; for (const k in F) F[k].fill(0); },
    draw(g, W, H) {
      const T = env.T(), op = env.opt(), lanes = LANES[op.ch] || LANES.LR, nL = lanes.length, mapL = lutFor(env.themeName());
      g.fillStyle = T.bg; g.fillRect(0, 0, W, H);
      const frames = clamp(Math.round((+op.secs || 6) * 30), 30, RING - 4), fpp = frames / Math.max(1, W);
      const laneH = H / nL;
      for (let li = 0; li < nL; li++) {
        const ch = lanes[li][0], y0 = li * laneH, mid = y0 + laneH / 2, amp = laneH / 2 - 3;
        hline(g, mid, 0, W, T.grid); if (nL > 1 && li) hline(g, y0, 0, W, T.grid);
        const mn = F['mn' + ch], mx = F['mx' + ch];
        const cursor = op.loop ? (total % frames) / fpp : -1;
        for (let x = 0; x < W; x++) {
          let a, b;
          if (op.loop) {                                                    // static display: the write position sweeps across and wraps
            const base = total - (total % frames), k0 = x <= cursor ? base + Math.floor(x * fpp) : base - frames + Math.floor(x * fpp), k1 = k0 + Math.max(1, Math.ceil(fpp));
            a = total - 1 - k1; b = total - 1 - k0;
          } else { a = Math.floor((W - 1 - x) * fpp); b = Math.max(a, Math.ceil((W - x) * fpp) - 1); }
          if (a < 0 && b < 0) continue; a = Math.max(0, a);
          if (op.loop && (b > total - 1 || b > RING - 4)) continue;
          let lo = 1, hi = -1, el = 0, em = 0, eh = 0, n = 0;
          for (let k = a; k <= b && k < RING - 2; k++) { const j = at(k); if (mn[j] < lo) lo = mn[j]; if (mx[j] > hi) hi = mx[j]; el += F.lo[j]; em += F.mid[j]; eh += F.hi[j]; n++; }
          if (!n || lo > hi) continue;
          let col;
          if (op.color === 'multi') {
            const r = e(el / n), gg = e(em / n), bb = e(eh / n), m = Math.max(r, gg, bb, 1e-6);
            col = `rgb(${Math.round(70 + 185 * Math.pow(r / m, 1.4))},${Math.round(70 + 185 * Math.pow(gg / m, 1.4))},${Math.round(70 + 185 * Math.pow(bb / m, 1.4))})`;
          } else if (op.color === 'map') { const q = clamp(Math.round(Math.max(Math.abs(lo), Math.abs(hi)) * 255), 0, 255); col = `rgb(${mapL[q * 3]},${mapL[q * 3 + 1]},${mapL[q * 3 + 2]})`; }
          else col = T.a;
          g.fillStyle = col;
          const yt = mid - clamp(hi, -1, 1) * amp, hh = Math.max(1, (clamp(hi, -1, 1) - clamp(lo, -1, 1)) * amp);
          g.fillRect(x, yt, 1, hh);
        }
        if (op.hist) {                                                      // multi-band level history on top of the waveform
          for (const [arr, col] of [[F.lo, '#ff5a4d'], [F.mid, '#5dd86a'], [F.hi, '#5aa8ff']]) {
            g.beginPath(); let started = false;
            for (let x = 0; x < W; x += 2) { const a = Math.floor((W - 1 - x) * fpp); if (a > total - 1) continue; const v = arr[at(a)], y = y0 + laneH - 3 - clamp((v + 60) / 60, 0, 1) * (laneH - 6); if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y); }
            g.strokeStyle = col; g.globalAlpha = 0.85; g.lineWidth = 1; g.stroke(); g.globalAlpha = 1;
          }
        }
        if (cursor >= 0) vline(g, cursor, y0, y0 + laneH, T.ink);
        text(g, ch === 'L' && nL === 1 ? 'L' : ch, W - 4, y0 + 11, 'right', T.dim, 9);
      }
    },
  };
};

// ---------------------------------------------------------------- Spectrogram
FACTORY.spectrogram = (env) => {
  const COLS = 512, RH = 256, off = document.createElement('canvas'); off.width = COLS; off.height = RH;
  const og = off.getContext('2d'), col = og.createImageData(1, RH), prev = new Float32Array(NB);
  let head = 0, rows = null, rowKey = '', sr = 48000, acc = 0, fresh = false;
  const rowMap = (sc, top) => {                                         // row -> fractional engine bin for the chosen scale
    const key = sc + '|' + Math.round(top); if (key === rowKey && rows) return rows;
    rows = new Float32Array(RH); for (let r = 0; r < RH; r++) rows[r] = binOf(pfreq(1 - r / (RH - 1), sc), top); rowKey = key; return rows;
  };
  const reset = () => { og.clearRect(0, 0, COLS, RH); og.fillStyle = '#000'; og.fillRect(0, 0, COLS, RH); head = 0; prev.fill(-120); };
  reset();
  return {
    title: 'Spectrogram', def: { scale: 'mel', orient: 'h', tilt: 3, mode: 'sharp', piano: false, freq: false, loop: false, speed: 1, eng: { fft: 2 } },
    opts: [seg('scale', 'Scale', [['mel', 'Mel'], ['log', 'Log'], ['lin', 'Linear']], { clear: true }), seg('orient', 'Orientation', [['h', 'Horizontal'], ['v', 'Vertical']]),
      seg('fft', 'FFT Size', [[0, '1024'], [1, '2048'], [2, '4096'], [3, '8192']], { eng: 1 }), rng('tilt', 'Tilt', 0, 9, 0.5, (v) => v + ' dB/oct'),
      seg('mode', 'Mode', [['sharper', 'Sharper'], ['sharp', 'Sharp'], ['classic', 'Classic']]), seg('speed', 'Speed', [[0.5, '\u00bd\u00d7'], [1, '1\u00d7'], [2, '2\u00d7']]),
      tog('piano', 'Piano Overlay'), tog('freq', 'Frequency Overlay'), tog('loop', 'Loop', { clear: true })],
    ingest(o) {
      const op = env.opt(); sr = o[31] || 48000; const top = Math.min(20000, sr * 0.49), map = rowMap(op.scale, top), L = lutFor(env.themeName());
      const tilt = +op.tilt || 0, sharp = op.mode === 'sharp' || op.mode === 'sharper', plus = op.mode === 'sharper';
      acc += +op.speed || 1; fresh = true;
      while (acc >= 1) {
        acc -= 1;
        for (let r = 0; r < RH; r++) {
          const b = map[r], f = pfreq(1 - r / (RH - 1), op.scale);
          let v = sample(o, O.M, b);
          if (sharp) { const i = Math.round(b), a = o[O.M + Math.max(0, i - 2)], c = o[O.M + Math.min(NB - 1, i + 2)]; v += 0.7 * (v - (a + c) * 0.5); }
          v += tilt * Math.log2(f / 1000);
          if (plus) { const p = prev[Math.round(b)]; if (p > v) v = v + (p - v) * 0.25; }
          const q = Math.round(clamp((v + 88) / 80, 0, 1) * 255);
          col.data[r * 4] = L[q * 3]; col.data[r * 4 + 1] = L[q * 3 + 1]; col.data[r * 4 + 2] = L[q * 3 + 2]; col.data[r * 4 + 3] = 255;
        }
        if (op.loop) { og.putImageData(col, head, 0); head = (head + 1) % COLS; }
        else { og.globalCompositeOperation = 'copy'; og.drawImage(off, -1, 0); og.globalCompositeOperation = 'source-over'; og.putImageData(col, COLS - 1, 0); }
      }
      for (let b = 0; b < NB; b++) prev[b] = o[O.M + b];
    },
    clear: reset,
    draw(g, W, H) {
      const T = env.T(), op = env.opt(); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      const vert = op.orient === 'v'; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'low';
      g.save();
      if (vert) { g.transform(0, -H / COLS, -W / RH, 0, W, H); g.drawImage(off, 0, 0); } else g.drawImage(off, 0, 0, W, H);
      g.restore();
      const axisLen = vert ? W : H, fy = (f) => { const p = fpos(f, op.scale); return vert ? p * W : H - p * H; };
      if (op.loop) { if (vert) hline(g, H - (head / COLS) * H, 0, W, '#ffffffaa'); else vline(g, (head / COLS) * W, 0, H, '#ffffffaa'); }
      if (op.freq) for (const f of TICKS[op.scale].concat(op.scale === 'log' ? [] : [])) {
        const p = fy(f); g.fillStyle = 'rgba(255,255,255,.16)';
        if (vert) { g.fillRect(Math.round(p), 0, 1, H); text(g, fLabel(f), p + 2, H - 3, 'left', 'rgba(255,255,255,.7)', 8.5); } else { g.fillRect(0, Math.round(p), W, 1); text(g, fLabel(f), W - 3, p - 2, 'right', 'rgba(255,255,255,.7)', 8.5); }
      }
      if (op.piano) {                                                       // keyboard strip + a line at every C
        const kw = 11, black = [1, 3, 6, 8, 10];
        for (let n = 24; n <= 108; n++) {
          const f = 440 * Math.pow(2, (n - 69) / 12), a = fy(440 * Math.pow(2, (n - 69 - 0.5) / 12)), b = fy(440 * Math.pow(2, (n - 69 + 0.5) / 12)), isB = black.includes(n % 12);
          if (f < 20 || f > 20000) continue;
          g.fillStyle = isB ? '#111' : '#e8e8ee';
          if (vert) g.fillRect(Math.min(a, b), 0, Math.abs(b - a) - 0.5, isB ? kw * 0.6 : kw); else g.fillRect(0, Math.min(a, b) + 0.25, isB ? kw * 0.6 : kw, Math.abs(b - a) - 0.5);
          if (n % 12 === 0) { if (vert) { g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(Math.round(fy(f)), 0, 1, H); text(g, noteName(n), Math.min(a, b) + 1, kw + 8, 'left', 'rgba(255,255,255,.75)', 8); } else { g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, Math.round(fy(f)), W, 1); text(g, noteName(n), kw + 2, fy(f) - 1, 'left', 'rgba(255,255,255,.75)', 8); } }
        }
      }
    },
  };
};

// ---------------------------------------------------------------- Spectrum
FACTORY.spectrum = (env) => {
  const sm = [new Float32Array(NB).fill(-120), new Float32Array(NB).fill(-120)], tgt = { arr: null, name: '' };
  let dom = { f: 0, db: -100 }, sr = 48000, cur = null, mean = -60;
  const DB0 = 0, DB1 = -90;
  return {
    title: 'Spectrum', def: { mode: 'fft', smooth: 0.6, ch: 0, over: true, scale: 'log', eng: { fft: 2, ch: 0 } },
    opts: [seg('mode', 'Mode', [['fft', 'FFT'], ['bars', 'Color Bars'], ['both', 'Both']]), rng('smooth', 'Smoothing', 0, 0.95, 0.05, (v) => Math.round(v * 100) + '%'),
      seg('ch', 'Channel', [[0, 'Left / Right'], [1, 'Mid / Side']], { eng: 3 }), tog('over', 'dB / Hz / Note'),
      seg('fft', 'FFT Size', [[0, '1024'], [1, '2048'], [2, '4096'], [3, '8192'], [4, '16384']], { eng: 1 }), seg('scale', 'Scale', [['mel', 'Mel'], ['log', 'Log'], ['lin', 'Linear']]),
      { k: 'target', type: 'file', label: 'Target' }],
    target: tgt,
    ingest(o) {
      const k = clamp(+env.opt().smooth, 0, 0.95); sr = o[31] || 48000;
      for (let c = 0; c < 2; c++) { const s = sm[c], off = c ? O.B : O.A; for (let b = 0; b < NB; b++) { const v = clamp(o[off + b], -120, 6); s[b] = s[b] < -119 ? v : s[b] * k + v * (1 - k); } }
      dom = { f: o[27], db: o[28] };
      let m = 0; for (let b = 40; b < NB - 40; b++) m += sm[0][b] + sm[1][b]; mean = mean * 0.9 + (m / ((NB - 80) * 2)) * 0.1;
    },
    clear() { sm[0].fill(-120); sm[1].fill(-120); },
    pointer(x) { cur = x; },
    draw(g, W, H) {
      const T = env.T(), op = env.opt(), top = Math.min(20000, sr * 0.49), L = 28, R = 6, TP = 14, BT = 14, w = W - L - R, h = H - TP - BT;
      g.fillStyle = T.bg; g.fillRect(0, 0, W, H);
      if (w < 20 || h < 20) return;
      const X = (f) => L + fpos(f, op.scale) * w, Y = (db) => TP + (clamp(db, DB1, DB0) - DB0) / (DB1 - DB0) * h;
      for (let db = -18; db >= -72; db -= 18) { hline(g, Y(db), L, W - R, T.grid); text(g, String(db), L - 3, Y(db) + 3, 'right', T.dim, 8.5); }
      for (const f of TICKS[op.scale]) { vline(g, X(f), TP, TP + h, T.grid); text(g, fLabel(f), X(f), H - 3, 'center', T.dim, 8.5); }
      const n = Math.max(24, Math.floor(w / 2)), val = (arr, off, x) => sample(arr, off, binOf(pfreq((x - L) / w, op.scale), top));
      g.save(); g.beginPath(); g.rect(L, TP, w, h); g.clip();
      const colors = [T.a, T.b], nCh = 2;
      if (op.mode === 'bars' || op.mode === 'both') {
        const bars = clamp(Math.round(w / 7), 20, 96), bw = w / bars, ch = op.mode === 'both' ? 0.5 : 1;
        for (let k = 0; k < bars; k++) {
          const p0 = k / bars, p1 = (k + 1) / bars, b0 = binOf(pfreq(p0, op.scale), top), b1 = Math.max(b0, binOf(pfreq(p1, op.scale), top));
          let v = -120; for (let b = Math.floor(b0); b <= Math.ceil(b1); b++) v = Math.max(v, (sm[0][Math.min(NB - 1, b)] + sm[1][Math.min(NB - 1, b)]) * 0.5);
          const y = Y(v), g2 = g.createLinearGradient(0, TP + h, 0, TP); g2.addColorStop(0, T.a); g2.addColorStop(0.6, T.c); g2.addColorStop(1, T.b);
          g.globalAlpha = ch * 0.9; g.fillStyle = g2; g.fillRect(L + k * bw + 0.5, y, Math.max(1, bw - 1.5), TP + h - y); g.globalAlpha = 1;
        }
      }
      if (op.mode === 'fft' || op.mode === 'both') {
        for (let c = nCh - 1; c >= 0; c--) {
          g.beginPath();
          for (let k = 0; k <= n; k++) { const x = L + (k / n) * w, y = Y(val(sm[c], 0, x)); if (!k) g.moveTo(x, y); else g.lineTo(x, y); }
          g.strokeStyle = colors[c]; g.lineWidth = 1.4; g.lineJoin = 'round'; g.stroke();
          g.lineTo(L + w, TP + h); g.lineTo(L, TP + h); g.closePath(); g.globalAlpha = 0.16; g.fillStyle = colors[c]; g.fill(); g.globalAlpha = 1;
        }
      }
      if (tgt.arr) {                                                        // target curve of a dropped file, aligned to the level of the live signal
        let m = 0; for (let b = 40; b < NB - 40; b++) m += tgt.arr[b]; const shift = mean - m / (NB - 80);
        g.beginPath(); for (let k = 0; k <= n; k++) { const x = L + (k / n) * w, y = Y(val(tgt.arr, 0, x) + shift); if (!k) g.moveTo(x, y); else g.lineTo(x, y); }
        g.setLineDash([4, 3]); g.strokeStyle = T.ink; g.lineWidth = 1.2; g.stroke(); g.setLineDash([]);
      }
      g.restore();
      text(g, op.ch ? 'M' : 'L', L + 4, TP + 10, 'left', T.a, 9, '700'); text(g, op.ch ? 'S' : 'R', L + 16, TP + 10, 'left', T.b, 9, '700');
      if (tgt.arr) text(g, 'Target: ' + tgt.name, L + 30, TP + 10, 'left', T.ink, 8.5);
      if (op.over && dom.f > 0 && dom.db > -60) {
        const nn = 12 * Math.log2(dom.f / 440) + 69, r = Math.round(nn);
        text(g, `${dom.f >= 1000 ? (dom.f / 1000).toFixed(2) + ' kHz' : dom.f.toFixed(1) + ' Hz'}  ${r >= 0 && r < 128 ? noteName(r) : ''}  ${dom.db.toFixed(1)} dB`, W - R - 4, TP + 11, 'right', T.ink, 10, '600');
      }
      if (cur !== null) {
        const x = clamp(cur, L, W - R), f = pfreq((x - L) / w, op.scale); vline(g, x, TP, TP + h, '#ffffff66');
        const v = val(sm[0], 0, x); text(g, `${f >= 1000 ? (f / 1000).toFixed(2) + 'k' : Math.round(f)} Hz  ${fdb(v)} dB`, Math.min(x + 4, W - 96), TP + 24, 'left', '#fff', 10);
      }
    },
  };
};

// ---------------------------------------------------------------- Stereometer
FACTORY.stereo = (env) => {
  const KEEP = 5, trails = [], st = { corr: [0, 0, 0, 0], bal: [0, 0, 0], k: [0, 0, 0] };
  return {
    title: 'Stereometer', def: { mode: 'scaled', color: 'rgb', corr: 'multi' },
    opts: [seg('mode', 'Display', [['scaled', 'Scaled'], ['linear', 'Linear'], ['liss', 'Lissajous']]), seg('color', 'Color', [['static', 'Static'], ['rgb', 'RGB'], ['multi', 'Multi-Band']]), seg('corr', 'Correlation', [['single', 'Single-Band'], ['multi', 'Multi-Band']])],
    ingest(o) {
      const fr = { all: Float32Array.from(o.slice(O.dots, O.dots + 256)), lo: Float32Array.from(o.slice(O.dLo, O.dLo + 128)), mid: Float32Array.from(o.slice(O.dMid, O.dMid + 128)), hi: Float32Array.from(o.slice(O.dHi, O.dHi + 128)), bal: [o[24], o[25], o[26]] };
      trails.push(fr); if (trails.length > KEEP) trails.shift();
      for (let i = 0; i < 4; i++) st.corr[i] = o[i];
    },
    clear() { trails.length = 0; },
    draw(g, W, H) {
      const T = env.T(), op = env.opt(), multi = op.corr === 'multi', cH = multi ? 54 : 22, area = Math.max(20, H - cH - 4), size = Math.min(W - 8, area), cx = W / 2, cy = 2 + area / 2, R = size / 2 - 3;
      g.fillStyle = T.bg; g.fillRect(0, 0, W, H);
      // guides
      g.strokeStyle = T.grid; g.lineWidth = 1; g.beginPath();
      if (op.mode === 'liss') { g.rect(cx - R, cy - R, R * 2, R * 2); g.moveTo(cx - R, cy + R); g.lineTo(cx + R, cy - R); g.moveTo(cx - R, cy - R); g.lineTo(cx + R, cy + R); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); }
      else { g.moveTo(cx, cy - R); g.lineTo(cx + R, cy); g.lineTo(cx, cy + R); g.lineTo(cx - R, cy); g.closePath(); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx - R * 0.7071, cy - R * 0.7071); g.lineTo(cx + R * 0.7071, cy + R * 0.7071); g.moveTo(cx + R * 0.7071, cy - R * 0.7071); g.lineTo(cx - R * 0.7071, cy + R * 0.7071); }
      g.stroke();
      if (op.mode === 'liss') { text(g, 'L', cx - R - 1, cy + R + 9, 'center', T.dim, 8.5); text(g, 'R', cx + R + 1, cy - R - 2, 'center', T.dim, 8.5); }
      else { text(g, 'L', cx - R * 0.7071 - 6, cy - R * 0.7071 + 3, 'center', T.dim, 8.5); text(g, 'R', cx + R * 0.7071 + 6, cy - R * 0.7071 + 3, 'center', T.dim, 8.5); text(g, '+', cx, cy - R - 2, 'center', T.dim, 9); text(g, '\u2212', cx, cy + R + 9, 'center', T.dim, 9); }
      // dots
      const scl = (v) => (op.mode === 'scaled' ? Math.sign(v) * Math.pow(Math.min(1, Math.abs(v) * 1.3), 0.45) : clamp(v, -1, 1));
      const plot = (arr, n, color, a) => {
        g.fillStyle = color; g.globalAlpha = a;
        for (let p = 0; p < n; p++) {
          let sx = arr[p * 2], my = arr[p * 2 + 1], x, y;
          if (op.mode === 'liss') { const l = (my + sx) * 0.7071, r = (my - sx) * 0.7071; x = scl(l); y = scl(r); } else { x = scl(sx); y = scl(my); }
          g.fillRect(cx + x * R - 0.9, cy - y * R - 0.9, 1.8, 1.8);
        }
      };
      const nT = trails.length; g.save(); g.beginPath(); g.rect(cx - R - 2, cy - R - 2, R * 2 + 4, R * 2 + 4); g.clip();
      if (op.color === 'multi') g.globalCompositeOperation = 'lighter';
      trails.forEach((fr, k) => {
        const a = (k + 1) / nT * 0.9, a2 = a * (op.color === 'multi' ? 0.75 : 1);
        if (op.color === 'multi') { plot(fr.lo, 64, '#ff4d3d', a2); plot(fr.mid, 64, '#40e070', a2); plot(fr.hi, 64, '#4d8dff', a2); }
        else if (op.color === 'rgb') { const [lo, mi, hi] = fr.bal, m = Math.max(1e-6, Math.pow(10, Math.max(lo, mi, hi) / 20)), c = (d) => Math.round(70 + 185 * Math.pow(Math.pow(10, d / 20) / m, 1.2)); plot(fr.all, 128, `rgb(${c(lo)},${c(mi)},${c(hi)})`, a); }
        else plot(fr.all, 128, T.a, a);
      });
      g.restore(); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      // correlation meter(s)
      const rows = multi ? [['LOW', st.corr[1]], ['MID', st.corr[2]], ['HIGH', st.corr[3]], ['ALL', st.corr[0]]] : [['', st.corr[0]]], rh = multi ? 11 : 12, x0 = multi ? 30 : 8, bw = W - x0 - 28, y0 = H - cH + 2;
      rows.forEach(([lab, v], k) => {
        const y = y0 + k * (rh + 2) + (multi ? 0 : 4);
        g.fillStyle = '#26262b'; g.fillRect(x0, y, bw, rh - 2); vline(g, x0 + bw / 2, y - 1, y + rh - 1, T.ink);
        const t = (clamp(v, -1, 1) + 1) / 2; g.fillStyle = v < 0 ? '#e5484d' : v < 0.35 ? '#e8d040' : '#5fd08a';
        g.fillRect(Math.min(x0 + bw / 2, x0 + t * bw), y, Math.abs(t - 0.5) * bw, rh - 2);
        if (lab) text(g, lab, x0 - 3, y + rh - 3, 'right', T.dim, 8); text(g, v.toFixed(2), W - 3, y + rh - 3, 'right', T.ink, 8.5);
      });
      if (!multi) { text(g, '\u22121', x0, y0 + 2, 'left', T.dim, 7.5); text(g, '+1', x0 + bw, y0 + 2, 'right', T.dim, 7.5); }
    },
  };
};

// ---------------------------------------------------------------- Loudness
FACTORY.loudness = (env) => {
  const st = { pk: -100, pkHold: -100, pkAt: 0, max: -100, val: -100, rmsS: 1e-9, vmax: -100, maxPk: -100 };
  const MODES = { m: ['LUFS-M', 'MOMENTARY'], s: ['LUFS-S', 'SHORT-TERM'], rf: ['RMS-F', 'FAST 0.3 s'], rs: ['RMS-S', 'SLOW 1.0 s'] };
  return {
    title: 'Loudness', def: { mode: 'm' },
    opts: [seg('mode', 'Mode', [['m', 'LUFS Momentary'], ['s', 'LUFS Short-Term'], ['rf', 'RMS Fast'], ['rs', 'RMS Slow']])],
    ingest(o) {
      const mode = env.opt().mode, now = env.clock();
      const pk = Math.max(o[4], o[5]); st.pk = pk; if (pk >= st.pkHold || now - st.pkAt > 1400) { st.pkHold = pk; st.pkAt = now; } st.maxPk = Math.max(st.maxPk, pk);
      const rmsFast = o[17]; st.rmsS += (Math.pow(10, rmsFast / 10) - st.rmsS) * (1 - Math.exp(-1 / 30));
      st.val = mode === 'm' ? o[10] : mode === 's' ? o[11] : mode === 'rf' ? rmsFast : 10 * Math.log10(Math.max(st.rmsS, 1e-10));
      st.vmax = Math.max(st.vmax, st.val);
    },
    clear() { st.maxPk = -100; st.vmax = -100; st.pkHold = -100; },
    reset() { this.clear(); },
    draw(g, W, H) {
      const T = env.T(), op = env.opt(), [unit, sub] = MODES[op.mode] || MODES.m; g.fillStyle = T.bg; g.fillRect(0, 0, W, H);
      const lo = -60, hi = 0, colw = W / 2, bh = Math.max(20, H - 70), by = 52, Y = (v) => by + (1 - (clamp(v, lo, hi) - lo) / (hi - lo)) * bh;
      const side = (x, label, val, held, maxv, color, hold) => {
        text(g, label, x + colw / 2, 24, 'center', T.dim, 8.5, '600');
        text(g, fdb(val), x + colw / 2, 46, 'center', val > -1 && label === 'PEAK' ? '#ff5a4d' : T.ink, Math.min(26, Math.max(14, colw * 0.22)), '700');
        const bx = x + colw / 2 - 9, bw = 18; g.fillStyle = '#1d1d22'; g.fillRect(bx, by, bw, bh);
        if (bh > 70) for (const v of [0, -12, -24, -36, -48]) { hline(g, Y(v), bx - 4, bx, T.dim); text(g, String(v), bx - 6, Y(v) + 3, 'right', T.dim, 8); }
        const yv = Y(val); const gr = g.createLinearGradient(0, by + bh, 0, by); gr.addColorStop(0, color); gr.addColorStop(0.75, color); gr.addColorStop(0.9, '#e8d040'); gr.addColorStop(1, '#e5484d');
        g.fillStyle = gr; g.fillRect(bx, yv, bw, by + bh - yv);
        if (hold > -99) hline(g, Y(hold), bx - 1, bx + bw + 1, '#ffffff');
        if (H > 90) text(g, 'MAX ' + fdb(maxv), x + colw / 2, H - 4, 'center', T.dim, 8.5);
      };
      side(0, 'PEAK', st.pk, st.pkHold, st.maxPk, T.a, st.pkHold);
      side(colw, unit, st.val, st.vmax, st.vmax, T.b, st.vmax);
      if (H > 110) { text(g, sub, W - 4, H - 14, 'right', T.dim, 7.5); text(g, 'dBFS', 4, H - 14, 'left', T.dim, 7.5); }
      vline(g, colw, 4, H - 4, T.grid);
    },
  };
};

// ---------------------------------------------------------------- Oscilloscope
FACTORY.scope = (env) => {
  let o2 = null, f0 = 0, sr = 48000;
  return {
    title: 'Oscilloscope', def: { cycle: 'multi', zoom: 1, ch: 'LR', follow: 1, eng: { follow: 1 } },
    opts: [tog('follow', 'Follow Pitch', { eng: 2 }), seg('cycle', 'Cycle', [['multi', 'Multi'], ['single', 'Single']]), seg('ch', 'Channels', [['LR', 'L / R'], ['M', 'Mid'], ['S', 'Side']]), seg('zoom', 'Zoom', [[1, '\u00d71'], [2, '\u00d72'], [4, '\u00d74']])],
    ingest(o) { o2 = { L: Float32Array.from(o.slice(O.scL, O.scL + SC)), R: Float32Array.from(o.slice(O.scR, O.scR + SC)) }; f0 = o[27]; sr = o[31] || 48000; },
    clear() { o2 = null; },
    draw(g, W, H) {
      const T = env.T(), op = env.opt(); g.fillStyle = T.bg; g.fillRect(0, 0, W, H);
      const mid = H / 2, amp = H / 2 - 5;
      for (const v of [-1, -0.5, 0.5, 1]) hline(g, mid - v * amp, 0, W, T.grid); hline(g, mid, 0, W, '#34343a');
      for (let k = 1; k < 8; k++) vline(g, (k / 8) * W, 0, H, T.grid);
      if (!o2) return;
      const span = 1536; let n = SC;
      if (op.cycle === 'single' && f0 > 20) n = clamp(Math.round((sr / f0) / (span / SC)), 24, SC);       // exactly one period of the detected pitch fills the width
      const z = +op.zoom || 1, lines = op.ch === 'LR' ? [[o2.L, T.a], [o2.R, T.b]] : op.ch === 'M' ? [[o2.L.map((v, i) => (v + o2.R[i]) * 0.5), T.a]] : [[o2.L.map((v, i) => (v - o2.R[i]) * 0.5), T.b]];
      for (const [arr, col] of lines) {
        g.beginPath(); for (let p = 0; p < n; p++) { const x = (p / (n - 1)) * W, y = mid - clamp(arr[p] * z, -1, 1) * amp; if (!p) g.moveTo(x, y); else g.lineTo(x, y); }
        g.strokeStyle = col; g.lineWidth = 1.3; g.lineJoin = 'round'; g.stroke();
      }
      if (f0 > 0) text(g, `${f0 >= 1000 ? (f0 / 1000).toFixed(2) + 'k' : f0.toFixed(1)} Hz`, W - 4, H - 4, 'right', T.dim, 8.5);
    },
  };
};

export const MODULES = [['vu', 'VU'], ['waveform', 'Waveform'], ['spectrogram', 'Spectrogram'], ['spectrum', 'Spectrum'], ['stereo', 'Stereometer'], ['loudness', 'Loudness'], ['scope', 'Oscilloscope']];
export const MODULE_IDS = MODULES.map((m) => m[0]);
export const makeModule = (id, env) => FACTORY[id](env);

// Average spectrum of an audio file in the engine's log bins (for the Spectrum "target curve"). Runs on the main thread, ~0.3 s per minute of audio.
export async function targetFromFile(file, fftFn) {
  const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100);
  const buf = await ctx.decodeAudioData(await file.arrayBuffer()), sr = buf.sampleRate, N = 4096, hop = Math.max(N, Math.floor(buf.length / 600));
  const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a, re = new Float32Array(N), im = new Float32Array(N), pow = new Float64Array(N / 2), win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  let frames = 0;
  for (let s = 0; s + N <= buf.length; s += hop) { for (let i = 0; i < N; i++) { re[i] = (a[s + i] + b[s + i]) * 0.5 * win[i]; im[i] = 0; } fftFn(re, im, N); for (let k = 1; k < N / 2; k++) pow[k] += re[k] * re[k] + im[k] * im[k]; frames++; }
  if (!frames) throw new Error('File terlalu pendek');
  const top = Math.min(20000, sr * 0.49), binHz = sr / N, out = new Float32Array(NB);
  for (let i = 0; i < NB; i++) {
    const f0 = 20 * Math.pow(top / 20, i / NB), f1 = 20 * Math.pow(top / 20, (i + 1) / NB); let k0 = Math.max(1, Math.floor(f0 / binHz)), k1 = Math.max(k0, Math.min(N / 2 - 1, Math.ceil(f1 / binHz) - 1)), m = 0;
    if (k1 === k0 && f1 / binHz - f0 / binHz < 1) { m = pow[Math.min(N / 2 - 1, Math.round((f0 + f1) / 2 / binHz))]; } else for (let k = k0; k <= k1; k++) m = Math.max(m, pow[k]);
    out[i] = 10 * Math.log10(Math.max(m / frames, 1e-14)) + 20 * Math.log10(4 / N) - 3 + 6;
  }
  return out;
}
