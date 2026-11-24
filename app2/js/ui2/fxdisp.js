// MobileDAW 2: the graphic at the left of an effect card, in the card's family colour, redrawn while the rack is on screen.
//   EQ & Filter     the frequency response, computed from the module's bands / cutoff (RBJ biquads, log 20 Hz - 20 kHz)
//   Echo & Reverb   delay taps (time, feedback, ping-pong) or the reverb's decaying tail (decay, pre-delay)
//   Level & Dinamika the transfer curve (threshold, ratio) with the live input on it, else the live level
//   Modulasi        the LFO moving at its rate and depth
//   Pitch & Stereo  the stereo field (width) with the live level
//   Note FX / Alat  the notes / the live level
// Behind every graphic runs the track's live level as a scrolling waveform. Values are read through the module's own display
// formatter (fmtParam), so a graphic always agrees with the numbers on the dials.
import { h, clamp } from '../ui.js';
import { fmtParam } from '../defs.js';
import * as P from '../project.js';

const { state } = P;
const FS = 48000;

// "1.2 kHz" -> 1200, "-3.0 dB" -> -3, "250 ms" -> 0.25 (s), "40 %" -> 0.4, "1/4" -> beats
function parse(text) {
  const t = String(text).trim(), fr = t.match(/^(\d+)\s*\/\s*(\d+)/);
  if (fr) return { v: +fr[1] / +fr[2] * 4, u: 'beat' };
  const m = t.match(/(-?\d+(?:[.,]\d+)?)\s*(k?)(hz|ms|s|db|%|st)?/i); if (!m) return null;
  let v = parseFloat(m[1].replace(',', '.')); const u = (m[3] || '').toLowerCase();
  if (m[2]) v *= 1000;
  if (u === 'ms') return { v: v / 1000, u: 's' };
  if (u === '%') return { v: v / 100, u: '%' };
  return { v, u };
}

// RBJ biquad magnitude (dB) at frequency f
function biquad(kind, f0, gdb, q) {
  const w0 = 2 * Math.PI * clamp(f0, 10, FS * 0.45) / FS, A = Math.pow(10, gdb / 40), al = Math.sin(w0) / (2 * Math.max(0.1, q)), c = Math.cos(w0);
  let b0, b1, b2, a0, a1, a2;
  switch (kind) {
    case 'lp': b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case 'hp': b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case 'bp': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case 'notch': b0 = 1; b1 = -2 * c; b2 = 1; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case 'ls': { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * c + s); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - s); a0 = (A + 1) + (A - 1) * c + s; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - s; break; }
    case 'hs': { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * c + s); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - s); a0 = (A + 1) - (A - 1) * c + s; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - s; break; }
    default: b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A;   // peak
  }
  return (f) => {
    const w = 2 * Math.PI * f / FS, cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = b0 + b1 * cw + b2 * c2, ni = -(b1 * sw + b2 * s2), dr = a0 + a1 * cw + a2 * c2, di = -(a1 * sw + a2 * s2);
    return 10 * Math.log10(Math.max(1e-12, (nr * nr + ni * ni) / (dr * dr + di * di)));
  };
}
const kindOf = (s) => { s = String(s || '').toLowerCase();
  return /low ?shelf|l\.?shelf/.test(s) ? 'ls' : /high ?shelf|h\.?shelf/.test(s) ? 'hs' : /notch/.test(s) ? 'notch' : /band ?pass|bp\b/.test(s) ? 'bp'
    : /high ?pass|hp|hi-?cut? off|low ?cut/.test(s) ? 'hp' : /low ?pass|lp|hi(gh)? ?cut/.test(s) ? 'lp' : 'peak'; };

export function fxDisplay(o) {
  // o: { def, d, family, strip, every, get(k) }
  const { def, family, strip, get } = o;
  const cv = h('canvas', { class: 'u2fx-cv' }), lab = h('span', { class: 'u2fx-l' }), el = h('div', { class: 'u2fx' }, cv, lab);
  const ps = def.params;
  const pick = (re, from = 0) => { for (let k = from; k < ps.length; k++) if (!ps[k].hidden && re.test(ps[k].n)) return k; return -1; };
  // the graphic follows a knob smoothly: numeric values ease toward their target each frame (lists switch at once)
  const sm = new Map(); let fno = 0;
  const sget = (k) => {
    const t = get(k); if (ps[k].items || !Number.isFinite(t)) return t;
    let c = sm.get(k); if (!c) { c = { v: t, f: fno }; sm.set(k, c); return t; }
    if (c.f !== fno) { c.f = fno; c.v += (t - c.v) * 0.3; if (Math.abs(t - c.v) < Math.abs(ps[k].max - ps[k].min) * 1e-4) c.v = t; }
    return c.v;
  };
  const txt = (k) => (k < 0 ? '' : fmtParam(ps[k], sget(k)));
  const val = (k, fb) => { if (k < 0) return fb; const r = parse(txt(k)); return r ? r : fb; };
  const norm = (k, fb = 0.5) => (k < 0 ? fb : clamp((sget(k) - ps[k].min) / ((ps[k].max - ps[k].min) || 1), 0, 1));
  const hist = new Float32Array(96); let hp = 0, phase = 0, last = performance.now(), color = null, mv = 0, pkv = 0;
  const level = () => { const m = state.meters || []; return Math.max(m[strip * 2] || 0, m[strip * 2 + 1] || 0) / 1000; };
  const db2 = (lv) => clamp((20 * Math.log10(Math.max(lv, 1e-5)) + 60) / 60, 0, 1);

  function frame() {
    const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    if (!color) color = getComputedStyle(el).getPropertyValue('--cc').trim() || '#c9b3ff';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; fno++;

    hist[hp] = db2(level()); hp = (hp + 1) % hist.length;
    // background: the live level as a scrolling, mirrored waveform
    g.fillStyle = color; g.globalAlpha = 0.13;
    const bw = W / hist.length;
    for (let n = 0; n < hist.length; n++) { const a = hist[(hp + n) % hist.length], hh = a * (H - 10) * 0.5; g.fillRect(n * bw, H / 2 - hh, Math.max(1, bw - 1), hh * 2); }
    g.globalAlpha = 1;
    // grid
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1;
    for (let n = 1; n < 4; n++) { g.beginPath(); g.moveTo(0, Math.round(H * n / 4) + 0.5); g.lineTo(W, Math.round(H * n / 4) + 0.5); g.stroke(); }
    const fillUnder = (pts, base) => {
      const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, color + '3a'); gr.addColorStop(1, color + '04');
      g.beginPath(); pts.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y))); g.lineTo(pts[pts.length - 1][0], base); g.lineTo(pts[0][0], base); g.closePath(); g.fillStyle = gr; g.fill();
      g.beginPath(); pts.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y))); g.strokeStyle = color; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
    };
    let label = '';
    if (family === 'eq') {
      const fx = (x) => 20 * Math.pow(1000, x / W), RANGE = 24, ydb = (db) => H / 2 - clamp(db, -RANGE, RANGE) / RANGE * (H / 2 - 6);
      const bands = [], dots = [];
      for (let b = 1; b <= 8; b++) {
        const gk = pick(new RegExp('^gain ' + b + '$', 'i')), fk = pick(new RegExp('^freq(uency)? ' + b + '$', 'i')); if (fk < 0) continue;
        const qk = pick(new RegExp('^(bandwidth|q|width) ' + b + '$', 'i')), kk = pick(new RegExp('^kind ' + b + '$', 'i'));
        const bwv = val(qk, { v: 1 }).v, q = qk >= 0 && /%/.test(txt(qk)) ? 0.3 + (1 - bwv) * 6 : clamp(bwv || 1, 0.2, 18);
        const f0 = val(fk, { v: 1000 }).v; bands.push(biquad(kindOf(txt(kk)), f0, gk < 0 ? 0 : val(gk, { v: 0 }).v, q)); dots.push([b, f0]);
      }
      if (!bands.length) {   // a filter: cutoff + resonance + type
        const ck = pick(/cutoff|freq/i), rk = pick(/reso|^q$|peak/i), tk = pick(/type|mode|kind|filter/i);
        const f0 = ck < 0 ? 1000 : (/hz/i.test(txt(ck)) ? val(ck, { v: 1000 }).v : 20 * Math.pow(1000, norm(ck)));
        bands.push(biquad(tk >= 0 && isNaN(parseFloat(txt(tk))) ? kindOf(txt(tk)) : 'lp', f0, 0, 0.7 + norm(rk, 0) * 8));
        label = ck >= 0 ? txt(ck) : '';
      }
      const pts = []; for (let x = 0; x <= W; x += 2) { const f = fx(x); let s = 0; for (const b of bands) s += b(f); pts.push([x, ydb(s)]); }
      g.strokeStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.moveTo(0, H / 2 + 0.5); g.lineTo(W, H / 2 + 0.5); g.stroke();
      fillUnder(pts, H);
      const xf = (f) => Math.log(clamp(f, 20, 20000) / 20) / Math.log(1000) * W;   // each band: a numbered handle on the curve
      for (const [b, f0] of dots) { let sdb = 0; for (const bq of bands) sdb += bq(f0); const x = xf(f0), y = ydb(sdb);
        g.fillStyle = color; g.beginPath(); g.arc(x, y, 8, 0, 6.283); g.fill(); g.fillStyle = '#15161a'; g.font = '700 10px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(b), x, y + 0.5); }
      for (const [f, t] of [[100, '100'], [1000, '1k'], [10000, '10k']]) { g.fillStyle = 'rgba(255,255,255,.35)'; g.font = '500 9px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(t, xf(f), H - 3); }
      if (!label) label = bands.length + ' band';
    } else if (family === 'echo') {
      const isRev = /reverb|room|hall|plate/i.test(def.name) || pick(/decay|room|size/i) >= 0 && pick(/feedback|fdbk/i) < 0;
      if (isRev) {
        const dk = pick(/decay|time|size/i), pk = pick(/pre/i), dampk = pick(/damp|hi.?cut|high/i);
        let dec = val(dk, { v: 2, u: 's' }); let T = dec.u === 's' ? dec.v : 0.4 + norm(dk) * 6;
        const pre = pk < 0 ? 0.02 : (val(pk, { v: 0.02 }).u === 's' ? val(pk, { v: 0.02 }).v : norm(pk) * 0.2), span = Math.max(0.6, pre + T * 1.2);
        const x0 = pre / span * W; let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        g.strokeStyle = color; g.globalAlpha = 0.85;
        for (let x = x0; x < W; x += 2) { const t = (x - x0) / W * span, a = Math.exp(-6.9 * t / T) * (0.35 + 0.65 * rnd()) * (1 - norm(dampk, 0) * 0.3 * (x / W)); g.beginPath(); g.moveTo(x + 0.5, H / 2 - a * (H / 2 - 4)); g.lineTo(x + 0.5, H / 2 + a * (H / 2 - 4)); g.stroke(); }
        g.globalAlpha = 1; g.fillStyle = color; g.fillRect(x0 - 1, 4, 2, H - 8);
        label = (T >= 1 ? T.toFixed(1) + ' s' : Math.round(T * 1000) + ' ms') + ' tail';
      } else {
        const tk = pick(/time|delay/i), fk = pick(/feedback|fdbk/i), mk = pick(/mode|ping|stereo/i), tv = val(tk, { v: 0.25, u: 's' });
        const sec = tv.u === 'beat' ? tv.v * 60 / (state.bpm || 120) : tv.u === 's' ? tv.v : 0.05 + norm(tk) * 1.2;
        const fb = fk < 0 ? 0.5 : clamp(val(fk, { v: 0.5 }).u === '%' ? val(fk, { v: 0.5 }).v : norm(fk), 0, 0.98), pp = /ping/i.test(txt(mk));
        const span = Math.max(sec * 6, 0.5);
        g.fillStyle = color;
        for (let n = 0, a = 1, t = 0; t < span && a > 0.02; n++, t += sec, a = n ? a * Math.max(fb, 0.05) : 1) {
          const x = 6 + t / span * (W - 12), hh = a * (H - 12) * (pp ? 0.5 : 1), y = pp ? (n % 2 ? H / 2 : H / 2 - hh) : H - 6 - hh;
          g.globalAlpha = n ? 0.9 : 1; g.beginPath(); g.roundRect(x - 3, y, 6, Math.max(2, hh), 3); g.fill();
        }
        g.globalAlpha = 1; label = txt(tk) + (fk >= 0 ? ' • fb ' + txt(fk) : '');
      }
    } else if (family === 'level') {
      const thk = pick(/thresh|ceiling|duck/i), rk = pick(/ratio/i);
      if (thk >= 0 && rk >= 0) {
        const th = val(thk, { v: -12 }).v, r = Math.max(1, val(rk, { v: 4 }).v), X = (db) => (db + 60) / 60 * (W - 8) + 4, Y = (db) => H - 4 - (db + 60) / 60 * (H - 8);
        const out = (i) => (i < th ? i : th + (i - th) / r), pts = []; for (let i = -60; i <= 0; i += 1) pts.push([X(i), Y(out(i))]);
        g.strokeStyle = 'rgba(255,255,255,.15)'; g.beginPath(); g.moveTo(X(-60), Y(-60)); g.lineTo(X(0), Y(0)); g.stroke();
        fillUnder(pts, H);
        const inDb = clamp(20 * Math.log10(Math.max(level(), 1e-5)), -60, 0); g.fillStyle = '#fff'; g.beginPath(); g.arc(X(inDb), Y(out(inDb)), 4, 0, 6.283); g.fill();
        label = txt(thk) + ' • ' + txt(rk);
      } else {
        const pts = []; for (let n = 0; n < hist.length; n++) pts.push([n * bw, H - 4 - hist[(hp + n) % hist.length] * (H - 8)]);
        fillUnder(pts, H); const lv = level(); label = lv > 1e-5 ? (20 * Math.log10(lv)).toFixed(1) + ' dB' : '-∞ dB';
      }
    } else if (family === 'mod') {
      const rk = pick(/rate|speed|freq/i), dk = pick(/depth|amount|mod|feedback/i), rv = val(rk, { v: 1 });
      const hz = rv.u === 'hz' ? rv.v : 0.2 + norm(rk) * 6, dep = norm(dk, 0.6);
      phase += dt * hz * Math.PI * 2;
      const pts = []; for (let x = 0; x <= W; x += 2) pts.push([x, H / 2 - Math.sin(phase + x / W * Math.PI * 4) * dep * (H / 2 - 6)]);
      g.beginPath(); pts.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y))); g.strokeStyle = color; g.lineWidth = 2.2; g.stroke();
      g.globalAlpha = 0.35; g.beginPath(); pts.forEach(([x, y], n) => (n ? g.lineTo(x, H - y) : g.moveTo(x, H - y))); g.stroke(); g.globalAlpha = 1;
      label = (rk >= 0 ? txt(rk) : hz.toFixed(2) + ' Hz');
    } else if (family === 'pitch') {
      const wk = pick(/width|stereo|spread|sep/i), pk = pick(/pitch|semi|shift|coarse|tune/i), wid = wk < 0 ? 0.5 : norm(wk), lv = db2(level());
      const cx = W / 2, cy = H - 4, R = Math.min(W / 2 - 6, H - 8);
      g.strokeStyle = 'rgba(255,255,255,.15)'; g.beginPath(); g.arc(cx, cy, R, Math.PI, 2 * Math.PI); g.stroke();
      const a = wid * Math.PI / 2; const gr = g.createRadialGradient(cx, cy, 2, cx, cy, R); gr.addColorStop(0, color + 'aa'); gr.addColorStop(1, color + '10');
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R * (0.35 + 0.65 * lv), -Math.PI / 2 - a, -Math.PI / 2 + a); g.closePath(); g.fillStyle = gr; g.fill(); g.strokeStyle = color; g.lineWidth = 2; g.stroke();
      label = (wk >= 0 ? 'Width ' + txt(wk) : '') + (pk >= 0 ? (wk >= 0 ? ' • ' : '') + txt(pk) : '');
    } else if (family === 'inst') {   // instruments: the amp envelope (A / D / S / R) over the live level
      const fa = pick(/^(amp |master )?(attack|atk|att)$/i), fd = pick(/^(amp |master )?(decay|dec)$/i), fs = pick(/^(amp |master )?(sustain|sus)$/i), fr = pick(/^(amp |master )?(release|rel)$/i);
      if (fa >= 0 || fd >= 0) {
        const a = 0.06 + norm(fa, 0.1) * 0.8, dd = 0.06 + norm(fd, 0.3) * 0.8, sl = fs >= 0 ? norm(fs) : 0.7, rr = 0.06 + norm(fr, 0.3) * 0.8, hold = 0.45, k = (W - 12) / (a + dd + hold + rr);
        const x1 = 6 + a * k, x2 = x1 + dd * k, x3 = x2 + hold * k, x4 = x3 + rr * k, top = Math.min(52, H * 0.35), bot = Math.max(top + 20, H - 40), ys = top + (1 - sl) * (bot - top);   // between the title bar and the buttons
        fillUnder([[6, bot], [x1, top], [x2, ys], [x3, ys], [x4, bot]], bot);
        g.fillStyle = '#fff'; for (const [x, y] of [[x1, top], [x2, ys], [x3, ys]]) { g.beginPath(); g.arc(x, y, 3, 0, 6.283); g.fill(); }
        label = 'A ' + txt(fa) + (fr >= 0 ? '  R ' + txt(fr) : '');
      } else {
        const pts = []; for (let n = 0; n < hist.length; n++) pts.push([n * bw, H / 2 - hist[(hp + n) % hist.length] * (H / 2 - 4)]);
        g.beginPath(); pts.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y))); g.strokeStyle = color; g.lineWidth = 2; g.stroke();
        g.beginPath(); pts.forEach(([x, y], n) => (n ? g.lineTo(x, H - y) : g.moveTo(x, H - y))); g.stroke();
        const lv = level(); label = lv > 1e-5 ? (20 * Math.log10(lv)).toFixed(1) + ' dB' : '';
      }
    } else if (family === 'flmnote') {   // note effects have no graph of their own: their settings, read from the module (no decoration)
      const T0 = 50, ks = ps.map((_, k) => k).filter((k) => !ps[k].hidden && ps[k].n && !/^on$/i.test(ps[k].n)).slice(0, Math.max(2, Math.floor((H - T0 - 6) / 26)));   // below the title bar
      const rh = Math.min(30, (H - T0 - 6) / Math.max(1, ks.length));
      g.textBaseline = 'middle';
      ks.forEach((k, n) => { const y = T0 + rh * (n + 0.5);
        g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '500 11px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(ps[k].n, 10, y, W * 0.5);
        g.fillStyle = '#ececef'; g.font = '700 14px system-ui, sans-serif'; g.textAlign = 'right'; g.fillText(fmtParam(ps[k], get(k)), W - 14, y, W * 0.45);
        if (n < ks.length - 1) { g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(10, Math.round(y + rh / 2), W - 24, 1); } });
      g.textAlign = 'left'; label = '';
    } else {
      const pts = []; for (let n = 0; n < hist.length; n++) pts.push([n * bw, H / 2 - hist[(hp + n) % hist.length] * (H / 2 - 4)]);
      g.beginPath(); pts.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y))); g.strokeStyle = color; g.lineWidth = 2; g.stroke();
      g.beginPath(); pts.forEach(([x, y], n) => (n ? g.lineTo(x, H - y) : g.moveTo(x, H - y))); g.stroke();
      const lv = level(); label = lv > 1e-5 ? (20 * Math.log10(lv)).toFixed(1) + ' dB' : '-∞ dB';
    }
    // the live level: a thin meter at the right edge with a falling peak
    const mlv = db2(level()); mv = Math.max(mlv, mv - dt * 1.2); pkv = mlv >= pkv ? mlv : Math.max(mlv, pkv - dt * 0.35);
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(W - 6, 6, 3, H - 12);
    const mg = g.createLinearGradient(0, H - 6, 0, 6); mg.addColorStop(0, 'rgba(255,255,255,.55)'); mg.addColorStop(1, 'rgba(255,255,255,.85)');
    g.fillStyle = mg; g.fillRect(W - 6, 6 + (1 - mv) * (H - 12), 3, mv * (H - 12));
    if (pkv > 0.02) { g.fillStyle = "rgba(255,255,255,.7)"; g.fillRect(W - 7, 6 + (1 - pkv) * (H - 12), 5, 1.5); }
    if (lab.textContent !== label) lab.textContent = label;
  }
  el.sync = frame;
  o.every(50, frame);
  requestAnimationFrame(frame);
  return el;
}
