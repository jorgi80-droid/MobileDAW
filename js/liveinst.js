// Ableton-style Sampler and Wavetable device panels (tabs, dark displays, value boxes), built on liveui.js.
// Every control is a real engine parameter (js/engine/live.js); nothing here is decorative.
import { h, knob, fromNorm, toNorm, clamp, menu } from './ui.js';
import { lvLab, lvNum, lvTog, lvBtn, lvChoice, lvSel, lvTabs, lvDisp, lvDrag, lvPath, lvEnvPts, lvRing, DISPC } from './liveui.js';
import { INSTRUMENTS, fmtParam, noteName } from './defs.js';
import { WT_CATS, WT_LIST, WT_COUNT, WT_N_FRAMES, wtTable, wtName, wtCatOf } from './engine/live.js';
import { drawFilter, vizCanvas } from './devviz.js';
import { offerAutomation } from './automate.js';
import * as BR from './browser.js';
import * as P from './project.js';
const { state } = P;

const tabMem = new Map();            // selected tab per track + panel, survives card rebuilds
const SR = 48000;

// ---- parameter bound controls --------------------------------------------------------------------
function binder(i, t, def) {
  const get = (k) => t.inst.params[k] ?? def.params[k].def;
  const set = (k, v) => P.setInstParam(i, k, v);
  const auto = (k) => (rect) => offerAutomation(rect, { kind: 5, strip: P.stripOf(i), param: k, def: def.params[k] }, `${t.name} \u2022 ${def.params[k].n}`);
  const nodes = [];
  const reg = (el) => { nodes.push(el); return el; };
  return {
    get, set, nodes,
    knob: (k, name) => { const p = name ? { ...def.params[k], n: name } : def.params[k]; const el = knob(p, () => get(k), (v) => { set(k, v); redraw(); }, fmtParam, null, auto(k)); el.classList.add('lvk'); return reg(el); },
    num: (k, o = {}) => reg(lvNum(def.params[k], () => get(k), (v) => { set(k, v); redraw(); }, fmtParam, { onLong: auto(k), ...o })),
    tog: (k, label, o = {}) => reg(lvTog(label ?? def.params[k].n, () => get(k) > 0.5, (on) => { set(k, on ? 1 : 0); redraw(); }, o)),
    sel: (k, o = {}) => { const p = def.params[k], items = () => { const out = []; for (let v = p.min; v <= p.max; v += p.step || 1) out.push({ value: v, label: fmtParam(p, v) }); return out; }; return reg(lvSel(items, () => Math.round(get(k)), (v) => { set(k, v); redraw(); }, { ...o, show: (v) => fmtParam(p, v) })); },
    choice: (k, items, o = {}) => reg(lvChoice(items, () => Math.round(get(k)), (v) => { set(k, v); redraw(); }, o)),
  };
}
const draws = [];
const sm = (el) => { el.classList.add('sm'); return el; };
function redraw() { for (const d of draws) d(); }
const sec = (...kids) => h('div', { class: 'lv-sec' }, ...kids);
const row = (...kids) => h('div', { class: 'lv-row' }, ...kids);
const krow = (...kids) => h('div', { class: 'lv-krow' }, ...kids);
const title = (t) => h('div', { class: 'lv-st' }, t);

function keyName(v) { return noteName(clamp(Math.round(v), 0, 127)); }
const zFmt = { keys: (p, v) => keyName(v), int: (p, v) => String(Math.round(v)), ct: (p, v) => Math.round(v) + ' ct', pct: (p, v) => Math.round(v * 100) + ' %', db: (p, v) => v.toFixed(1) + ' dB', pan: (p, v) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? Math.round(-v * 50) + 'L' : Math.round(v * 50) + 'R') };

// =============================================================================================== Sampler
export function samplerPanel(i, t) {
  const def = INSTRUMENTS[t.inst.type], B = binder(i, t, def);
  draws.length = 0;
  const zs = t.inst.zones || (t.inst.zones = [P.newZone()]);
  const key = t.id + ':smp';
  const mem = tabMem.get(key) || { tab: 1, zone: 0 };
  tabMem.set(key, mem);
  mem.zone = clamp(mem.zone, 0, zs.length - 1);
  const Z = () => zs[mem.zone], zk = () => mem.zone;
  const frames = () => { const s = Z().sample; return s && s.pyr ? s.pyr.l.length : 0; };
  const zset = (f, v, quiet = true) => { P.setZoneField(i, zk(), f, v, quiet); };

  // zone selector (Live shows it in the Zone tab; here it is available everywhere because the Sample tab edits the selected zone)
  const zoneSel = lvSel(() => zs.map((z, k) => ({ value: k, label: `${k + 1}. ${z.sample ? z.sample.name : '(kosong)'}` })), () => mem.zone, (k) => { mem.zone = k; build(); }, { w: 150, show: (k) => `Zone ${k + 1}/${zs.length}` });
  const zoneAdd = lvBtn('+', () => { const k = P.addZone(i); if (k !== null) { mem.zone = k; } }, { w: 22 });
  const zoneDel = lvBtn('\u00D7', () => { if (zs.length > 1) { P.removeZone(i, zk()); mem.zone = Math.max(0, mem.zone - 1); } }, { w: 22 });
  const pick = () => BR.openBrowser('file', { track: i, zone: zk() });

  const body = h('div', { class: 'lv-pane' });
  const tabs = [{ label: 'Zone' }, { label: 'Sample' }, { label: 'Pitch/Osc', led: true }, { label: 'Filter/Global', led: true }, { label: 'Modulation', led: true }, { label: 'MIDI' }];
  const bar = lvTabs(tabs, mem.tab, (k) => { mem.tab = k; build(); });
  const lit = () => { const g = (k) => B.get(k); const L = [false, false, g(22) !== 0 || g(26) > 0 || g(3) !== 0 || g(4) > 0 || g(33) > 0.5, g(9) > 0.5, g(27) > 0 || g(28) > 0 || g(29) > 0 || g(13) !== 0, false]; [...bar.children].forEach((b, k) => b.classList.toggle('lit', !!L[k])); };

  // ---- Zone tab: key / velocity map
  const zoneTab = () => {
    const W = 560, H = 120, rl = 12;
    const kx = (k) => (k / 128) * W;
    const cv = lvDisp(W, H, (g, w, hh) => {
      g.fillStyle = '#2e2e31'; g.fillRect(0, 0, w, rl);
      for (let k = 0; k < 128; k++) { const blk = [1, 3, 6, 8, 10].includes(k % 12); g.fillStyle = blk ? '#4a4a4f' : '#6a6a70'; if (!blk) g.fillRect(kx(k) + 0.5, 2, kx(k + 1) - kx(k) - 1, rl - 3); }
      g.fillStyle = DISPC.ink; g.font = '8px system-ui'; g.textBaseline = 'top';
      for (let o = 0; o < 11; o++) g.fillText('C' + (o - 2), kx(o * 12) + 2, 2);
      g.fillStyle = DISPC.grid; for (let o = 0; o < 11; o++) g.fillRect(Math.round(kx(o * 12)), rl, 1, hh - rl);
      const vy = (v) => rl + (1 - v / 127) * (hh - rl - 2);
      zs.forEach((z, k) => {
        const x0 = kx(z.lo), x1 = kx(z.hi + 1), y0 = vy(z.vhi), y1 = vy(z.vlo - 1);
        g.fillStyle = k === mem.zone ? DISPC.sel : DISPC.selD; g.fillRect(x0, y0, x1 - x0, y1 - y0);
        g.strokeStyle = k === mem.zone ? DISPC.or : DISPC.bl; g.lineWidth = k === mem.zone ? 1.5 : 1; g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
        g.fillStyle = '#fff'; g.font = '9px system-ui'; g.textBaseline = 'top'; g.fillText(String(k + 1), x0 + 3, y0 + 2);
        const rx = kx(z.root + 0.5); g.fillStyle = DISPC.or; g.fillRect(rx - 1, y1 - 5, 2, 5);
      });
    });
    draws.push(() => cv.paint());
    lvDrag(cv, {
      onDown: (x, y) => {
        if (y < rl) return false;
        const key = clamp(Math.floor((x / W) * 128), 0, 127); let hit = -1;
        for (let k = zs.length - 1; k >= 0; k--) if (key >= zs[k].lo && key <= zs[k].hi) { hit = k; break; }
        if (hit < 0) return false;
        if (hit !== mem.zone) { mem.zone = hit; cv.paint(); }
        const z = zs[hit], edge = Math.abs(x - kx(z.lo)) < 8 ? 'lo' : Math.abs(x - kx(z.hi + 1)) < 8 ? 'hi' : 'move';
        return { edge, lo: z.lo, hi: z.hi, key };
      },
      onMove: (x, y, dx, dy, s) => {
        const z = Z(), d = Math.round((dx / W) * 128);
        if (s.edge === 'lo') zset('lo', clamp(s.lo + d, 0, z.hi)); else if (s.edge === 'hi') zset('hi', clamp(s.hi + d, z.lo, 127));
        else { const n = clamp(d, -s.lo, 127 - s.hi); zset('lo', s.lo + n); zset('hi', s.hi + n); }
        cv.paint();
      },
      onUp: () => { P.setZoneField(i, zk(), 'lo', Z().lo); },
    });
    const z = Z();
    const kn = (f, name, lo, hi, fmt) => lvLab(name, lvNum({ n: name, min: lo, max: hi, def: lo, step: 1 }, () => Z()[f], (v) => { zset(f, Math.round(v)); cv.paint(); }, fmt || zFmt.int, { w: 46 }));
    return [sec(row(lvLab('Zone', zoneSel), zoneAdd, zoneDel), cv), sec(title('Key'), row(kn('lo', 'Low', 0, 127, zFmt.keys), kn('hi', 'High', 0, 127, zFmt.keys), kn('root', 'Root', 0, 127, zFmt.keys)), title('Velocity'), row(kn('vlo', 'Low', 1, 127), kn('vhi', 'High', 1, 127)),
      row(lvLab('Sample', lvBtn(Z().sample ? Z().sample.name : 'Pilih sample\u2026', pick, { cls: 'wide' }))))];
  };

  // ---- Sample tab: waveform with start / end / loop markers (Live "Sample" tab)
  const sampleTab = () => {
    const W = 876, H = 118, z0 = Z();
    const nf = frames();
    const px = (f) => 4 + f * (W - 8);
    const cv = lvDisp(W, H, (g, w, hh) => {
      const z = Z(), s = z.sample;
      if (!s) { g.fillStyle = DISPC.ink; g.font = '11px system-ui'; g.textAlign = 'center'; g.fillText('Ketuk "Sample" untuk memilih file audio', w / 2, hh / 2 + 4); g.textAlign = 'start'; return; }
      const x0 = px(Math.min(z.s0, z.s1)), x1 = px(Math.max(z.s0, z.s1));
      g.fillStyle = DISPC.selD; g.fillRect(x0, 12, x1 - x0, hh - 12);
      if (z.sus) { const a = px(Math.min(z.l0, z.l1)), b = px(Math.max(z.l0, z.l1)); g.fillStyle = DISPC.sel; g.fillRect(a, 12, b - a, hh - 12); }
      const pk = s.peaks || [], n = pk.length, mid1 = 12 + (hh - 12) * 0.25, mid2 = 12 + (hh - 12) * 0.75, amp = (hh - 12) * 0.22;
      for (const mid of [mid1, mid2]) {
        g.beginPath(); g.moveTo(4, mid);
        for (let x = 0; x <= W - 8; x++) { const a = pk[Math.min(n - 1, Math.floor((x / (W - 8)) * n))] || 0; g.lineTo(4 + x, mid - a * amp); }
        for (let x = W - 8; x >= 0; x--) { const a = pk[Math.min(n - 1, Math.floor((x / (W - 8)) * n))] || 0; g.lineTo(4 + x, mid + a * amp); }
        g.closePath(); g.fillStyle = DISPC.or; g.fill();
      }
      g.fillStyle = '#ffffff30'; g.fillRect(4, Math.round(mid1), W - 8, 1); g.fillRect(4, Math.round(mid2), W - 8, 1);
      const tri = (x, up, col) => { g.fillStyle = col; g.beginPath(); if (up) { g.moveTo(x - 4, 1); g.lineTo(x + 4, 1); g.lineTo(x, 9); } else { g.moveTo(x - 4, hh - 1); g.lineTo(x + 4, hh - 1); g.lineTo(x, hh - 9); } g.fill(); g.fillRect(x, 9, 1, hh - 18); };
      tri(x0, true, DISPC.bl); tri(x1, true, DISPC.bl);
      if (z.sus) { tri(px(Math.min(z.l0, z.l1)), false, '#ffffff'); tri(px(Math.max(z.l0, z.l1)), false, '#ffffff'); }
      g.fillStyle = DISPC.ink; g.font = '8px system-ui'; g.textBaseline = 'bottom';
      const secs = nf && s.duration ? s.duration : 0;
      for (let q = 0; q <= 4; q++) g.fillText((secs * q / 4).toFixed(2) + 's', 6 + q * ((W - 40) / 4), hh - 1);
    });
    draws.push(() => cv.paint());
    lvDrag(cv, {
      onDown: (x, y) => {
        const z = Z(); if (!z.sample) return false;
        const cand = [['s0', px(z.s0), 0], ['s1', px(z.s1), 0]]; if (z.sus) cand.push(['l0', px(z.l0), 1], ['l1', px(z.l1), 1]);
        let best = null, bd = 22;
        for (const [f, xx, low] of cand) { const d = Math.abs(x - xx) + (low === (y > H / 2 ? 1 : 0) ? 0 : 6); if (d < bd) { bd = d; best = f; } }
        return best ? { f: best } : false;
      },
      onMove: (x, y, dx, dy, s) => { const v = clamp((x - 4) / (W - 8), 0, 1); zset(s.f, v); cv.paint(); fieldsUpdate(); },
      onUp: (x, y, s) => { P.setZoneField(i, zk(), s.f, Z()[s.f]); },
    });
    const fr = Math.max(1, nf - 1);
    const pf = (name, f, o = {}) => lvLab(name, lvNum({ n: name, min: 0, max: fr, def: o.def ?? 0, step: 1 }, () => Math.round(Z()[f] * fr), (v) => { zset(f, v / fr); cv.paint(); }, (p, v) => String(Math.round(v)), { w: 66, px: 220 }));
    const upd = [];
    const fieldsUpdate = () => { for (const e of upd) e.update(); };
    const keep = (e) => { upd.push(e); return e; };
    const zn = (name, f, lo, hi, def, fmt, w = 46, step = 1) => lvLab(name, keep(lvNum({ n: name, min: lo, max: hi, def, step }, () => Z()[f], (v) => { zset(f, v); cv.paint(); }, fmt, { w })));
    const sustain = lvChoice([{ label: '\u21E5', title: 'Off' }, { label: '\u21C9', title: 'Forward' }, { label: '\u21C6', title: 'Back-and-forth' }], () => Z().sus, (v) => { zset('sus', v); cv.paint(); });
    const revBtn = lvTog('Off', () => Z().rev, (on) => { zset('rev', on); revBtn.textContent = on ? 'On' : 'Off'; cv.paint(); });
    revBtn.textContent = Z().rev ? 'On' : 'Off';
    const snap = B.tog(31, 'Off'); snap.textContent = B.get(31) > 0.5 ? 'On' : 'Off'; snap.addEventListener('click', () => { snap.textContent = B.get(31) > 0.5 ? 'On' : 'Off'; });
    const rel = B.tog(30, 'Off'); rel.textContent = B.get(30) > 0.5 ? 'On' : 'Off'; rel.addEventListener('click', () => { rel.textContent = B.get(30) > 0.5 ? 'On' : 'Off'; });
    const interp = B.sel(8, { w: 52 });
    const volv = lvLab('Vol', keep(lvNum({ n: 'Vol', min: -36, max: 12, def: 0 }, () => Z().vol, (v) => zset('vol', v), zFmt.db, { w: 56 })));
    const panv = lvLab('Pan', keep(lvNum({ n: 'Pan', min: -1, max: 1, def: 0 }, () => Z().pan, (v) => zset('pan', v), zFmt.pan, { w: 56 })));
    const info = h('div', { class: 'lv-info' }, z0.sample ? z0.sample.name : '(kosong)');
    // Live: zone + sample name above the waveform, then two rows of labelled fields in equal columns
    const head = h('div', { class: 'smp-head' }, lvLab('Zone', zoneSel), zoneAdd, zoneDel, h('span', { class: 'lk-grow' }), info);
    const rootK = zn('Root', 'root', 0, 127, 60, zFmt.keys, 48), detK = zn('Detune', 'tune', -100, 100, 0, zFmt.ct, 48);
    return [sec(head, cv, h('div', { class: 'smp-grid' },
      lvLab('Reverse', revBtn), lvLab('Sample', lvBtn(z0.sample ? z0.sample.name : 'Pilih\u2026', pick, { cls: 'wide' }), 'span3'), volv, keep(pf('Sample Start', 's0')), lvLab('Sustain Mode', sustain), keep(pf('Loop Start', 'l0')), zn('Crossfade', 'xf', 0, 1, 0, zFmt.pct, 52, 0.01),
      lvLab('Snap', snap), rootK, detK, lvLab('Scale', B.num(6, { w: 48, label: 'Scale' })), panv, keep(pf('Sample End', 's1', { def: fr })), lvLab('Release Mode', rel), keep(pf('Loop End', 'l1', { def: fr })), lvLab('Interpol', interp)))];
  };

  // ---- Pitch/Osc tab
  const pitchTab = () => {
    const cv = lvDisp(150, 74, (g, w, hh) => {
      g.fillStyle = DISPC.grid; g.fillRect(0, Math.round(hh / 2), w, 1);
      const amt = B.get(22), dec = B.get(23), pts = [];
      for (let x = 0; x <= w - 6; x += 2) { const tt = (x / (w - 6)) * 1.2; const v = amt * Math.exp(-tt * 4.6 / Math.max(0.02, dec)); pts.push([x + 3, hh / 2 - clamp(v / 48, -1, 1) * (hh / 2 - 6)]); }
      lvPath(g, pts, DISPC.bl, hh / 2);
      g.fillStyle = DISPC.ink; g.font = '8px system-ui'; g.fillText('Pitch Envelope', 4, 10);
    });
    draws.push(() => cv.paint());
    const owv = lvDisp(96, 74, (g, w, hh) => {
      const on = B.get(33) > 0.5, sh = Math.round(B.get(34)), pts = [];
      g.fillStyle = DISPC.grid; g.fillRect(0, Math.round(hh / 2), w, 1);
      for (let x = 0; x <= w - 6; x += 1) {
        const ph = ((x / (w - 6)) * 2) % 1;
        const y = sh === 0 ? Math.sin(6.2832 * ph) : sh === 1 ? 4 * Math.abs(ph - 0.5) - 1 : sh === 2 ? 2 * ph - 1 : sh === 3 ? (ph < 0.5 ? 1 : -1) : Math.sin(x * 12.9898 + 4.1) * Math.cos(x * 78.233);
        pts.push([x + 3, hh / 2 - y * (hh / 2 - 8)]);
      }
      g.globalAlpha = on ? 1 : 0.4; lvPath(g, pts, DISPC.bl, hh / 2); g.globalAlpha = 1;
      g.fillStyle = DISPC.ink; g.font = '8px system-ui'; g.fillText('Oscillator', 4, 10);
    });
    draws.push(() => owv.paint());
    const wave = B.choice(34, [{ label: 'Sin', title: 'Sine' }, { label: 'Tri', title: 'Triangle' }, { label: 'Saw', title: 'Saw' }, { label: 'Sqr', title: 'Square' }, { label: 'Nz', title: 'Noise' }]);
    return [sec(title('Pitch Envelope'), row(cv, krow(B.knob(22, 'Amount'), B.knob(23, 'Decay')))), sec(title('Pitch'), krow(B.knob(2), B.knob(3), B.knob(4), B.knob(26, 'LFO \u2192 Pitch'))),
      sec(row(B.tog(33, 'Osc', { w: 34 }), lvLab('Wave', wave)), owv, row(lvLab('Level', B.num(35, { w: 52, fill: true })), lvLab('Semi', B.num(36, { w: 44 })), lvLab('Detune', B.num(37, { w: 50 })), lvLab('Sample', B.num(38, { w: 52, fill: true }))))];
  };

  // ---- Filter/Global tab
  const filterTab = () => {
    const cv = vizCanvas(170, 74);
    const spec = () => ({ type: Math.round(B.get(10)), f: B.get(11), q: B.get(12), poles: 1 });
    const draw = () => { drawFilter(cv, spec(), Math.abs(B.get(13)) > 0.01 ? [clamp(B.get(11) * Math.pow(2, 6 * B.get(13)), 30, SR * 0.45)] : null); cv.style.opacity = B.get(9) > 0.5 ? 1 : 0.45; };
    draws.push(draw); draw();
    lvDrag(cv, { onDown: () => ({ c: toNorm(def.params[11], B.get(11)), r: toNorm(def.params[12], B.get(12)) }), onMove: (x, y, dx, dy, s) => { B.set(11, fromNorm(def.params[11], s.c + dx / 170)); B.set(12, fromNorm(def.params[12], s.r - dy / 80)); redraw(); B.nodes.forEach((n) => n.update && n.update()); } });
    return [sec(row(B.tog(9, 'Filter', { w: 44 }), lvLab('Type', B.sel(10, { w: 76 }))), cv), sec(title('Filter'), krow(B.knob(11, 'Freq'), B.knob(12, 'Res'), B.knob(13, 'Env Amt'), B.knob(27, 'LFO Amt'))),
      sec(title('Global'), krow(B.knob(0), B.knob(1), B.knob(5), B.knob(7), B.knob(32, 'Time')))];
  };

  // ---- Modulation tab: amp envelope, filter envelope, LFO
  const envBox = (name, ks) => {
    const cv = lvDisp(130, 62, (g, w, hh) => {
      const [a, d, s, r] = ks.map((k) => B.get(k));
      lvPath(g, lvEnvPts(w, hh, a * B.get(32), d * B.get(32), s, r * B.get(32)), DISPC.bl, hh - 4);
      for (const pt of lvEnvPts(w, hh, a, d, s, r).slice(1, 4)) lvRing(g, pt[0], pt[1]);
    });
    draws.push(() => cv.paint());
    return sec(title(name), row(cv), krow(...['A', 'D', 'S', 'R'].map((n, q) => B.knob(ks[q], n))));
  };
  const modTab = () => {
    const cv = lvDisp(110, 62, (g, w, hh) => {
      g.fillStyle = DISPC.grid; g.fillRect(0, Math.round(hh / 2), w, 1);
      const sh = Math.round(B.get(24)), pts = [];
      for (let x = 0; x <= w - 4; x += 1.5) { const ph = ((x / (w - 4)) * 2) % 1; const y = sh === 0 ? Math.sin(6.2832 * ph) : sh === 1 ? 4 * Math.abs(ph - 0.5) - 1 : sh === 2 ? 2 * ph - 1 : sh === 3 ? (ph < 0.5 ? 1 : -1) : Math.sin(x * 12.9898) % 1; pts.push([x + 2, hh / 2 - y * (hh / 2 - 6)]); }
      lvPath(g, pts, DISPC.bl);
    });
    draws.push(() => cv.paint());
    return [envBox('Amp Envelope', [14, 15, 16, 17]), envBox('Filter Envelope', [18, 19, 20, 21]), sec(title('LFO'), row(cv, lvLab('Shape', B.sel(24, { w: 66 }))), krow(B.knob(25, 'Rate'), B.knob(27, 'Filter'), B.knob(26, 'Pitch'), B.knob(28, 'Volume'), B.knob(29, 'Pan')))];
  };
  const midiTab = () => {
    const vcv = lvDisp(110, 74, (g, w, hh) => {
      const vv = B.get(7), pts = [];
      g.fillStyle = DISPC.grid; g.fillRect(0, hh - 12, w, 1); g.fillRect(6, 0, 1, hh);
      for (let x = 0; x <= w - 12; x += 2) { const vel = x / (w - 12); pts.push([x + 6, hh - 12 - ((1 - vv) + vv * vel) * (hh - 22)]); }
      lvPath(g, pts, DISPC.bl, hh - 12);
      g.fillStyle = DISPC.ink; g.font = '8px system-ui'; g.fillText('Volume < Velocity', 10, 10); g.fillText('Velocity', w - 34, hh - 2);
    });
    draws.push(() => vcv.paint());
    const kv = (st) => lvLab(st.n, st.el);
    const nv = h('div', { class: 'lv-info' }, '');
    return [sec(title('Velocity'), vcv, krow(B.knob(7, 'Vol<Vel'))),
      sec(title('Voices'), krow(B.knob(5), B.knob(4, 'Spread'), B.knob(32, 'Time'))),
      sec(title('Keyboard'), krow(B.knob(6, 'Scale'), B.knob(2, 'Transpose'), B.knob(3, 'Detune'))),
      sec(title('Playback'), row(lvLab('Interpol', B.sel(8, { w: 60 })), lvLab('Snap', B.tog(31, 'Snap')), lvLab('Release Mode', B.tog(30, 'Rel'))), row(lvLab('Pan', B.num(1, { w: 52 })), lvLab('Volume', B.num(0, { w: 56, fill: true }))))];
  };

  function build() {
    draws.length = 0;
    const makers = [zoneTab, sampleTab, pitchTab, filterTab, modTab, midiTab];
    body.replaceChildren(...makers[mem.tab]());
    [...bar.children].forEach((b, k) => b.classList.toggle('on', k === mem.tab));
    lit();
  }
  build();
  return { el: h('div', { class: 'lv-dev smp' }, bar, body), refresh: () => { redraw(); lit(); } };
}

// =============================================================================================== Wavetable
const MX_SRC = ['Env 2', 'Env 3', 'LFO 1', 'LFO 2', 'Vel', 'Key'];
const MX_DST = ['Osc1 Pos', 'Osc1 Pitch', 'Osc2 Pos', 'Osc2 Pitch', 'Filter Freq', 'Filter Res', 'Osc1 Gain', 'Osc2 Gain'];
const MX0 = 53;

export function wavetablePanel(i, t) {
  const def = INSTRUMENTS[t.inst.type], B = binder(i, t, def);
  draws.length = 0;
  const key = t.id + ':wt';
  const mem = tabMem.get(key) || { osc: 0, mod: 0 };
  tabMem.set(key, mem);
  const base = (n) => (n ? 9 : 0);

  // ---- left column: sub oscillator
  const subOct = B.choice(21, [{ label: '0' }, { label: '-1' }, { label: '-2' }], { cls: 'oct' });
  const subTog = B.tog(18, 'Sub', { cls: 'wide' });
  const left = h('div', { class: 'lv-sec wtl' }, subTog, sm(B.knob(19, 'Gain')), sm(B.knob(20, 'Tone')), lvLab('Octave', subOct), lvLab('Transpose', B.num(22, { w: 62 })));

  // ---- oscillator area
  const oscBox = h('div', { class: 'wto' });
  const oscTabs = lvTabs([{ label: 'Osc 1', check: () => B.get(8) > 0.5, onCheck: () => B.set(8, B.get(8) > 0.5 ? 0 : 1) }, { label: 'Osc 2', check: () => B.get(17) > 0.5, onCheck: () => B.set(17, B.get(17) > 0.5 ? 0 : 1) }], mem.osc, (k) => { mem.osc = k; buildOsc(); }, { cls: 'wtabs' });
  const frameCache = new Map();
  function frameCurves(idx) {
    let c = frameCache.get(idx); if (c) return c;
    const T = wtTable(idx), N = 96; c = [];
    for (let f = 0; f < WT_N_FRAMES; f++) { const o = T.at(f, 0), a = new Float32Array(N); for (let x = 0; x < N; x++) a[x] = T.d[o + Math.floor((x / N) * 2048)]; c.push(a); }
    frameCache.set(idx, c); if (frameCache.size > 6) frameCache.delete(frameCache.keys().next().value);
    return c;
  }
  function buildOsc() {
    const b = base(mem.osc), W = 208, H = 78;
    const tabIdx = () => Math.round(B.get(b)), cat = () => wtCatOf(tabIdx());
    const cv = lvDisp(W, H, (g, w, hh) => {
      const cur = frameCurves(tabIdx()), pos = clamp(B.get(b + 1), 0, 1), pad = 8, wv = w - 40, step = (hh - 30) / (WT_N_FRAMES - 1), amp = 11;
      const on = B.get(b + 8) > 0.5;
      for (let f = 0; f < WT_N_FRAMES; f++) {
        const y0 = hh - 14 - f * step, xo = f * 1.2;
        g.beginPath(); for (let x = 0; x < cur[f].length; x++) { const X = pad + xo + (x / (cur[f].length - 1)) * wv, Y = y0 - cur[f][x] * amp; x ? g.lineTo(X, Y) : g.moveTo(X, Y); }
        g.strokeStyle = on ? '#8e8e96' : '#5a5a60'; g.globalAlpha = 0.55; g.lineWidth = 1; g.stroke(); g.globalAlpha = 1;
      }
      const tp = pos * (WT_N_FRAMES - 1), f0 = Math.min(WT_N_FRAMES - 2, Math.floor(tp)), fr = tp - f0, y0 = hh - 14 - tp * step, xo = tp * 1.2;
      g.beginPath(); for (let x = 0; x < cur[f0].length; x++) { const v = cur[f0][x] * (1 - fr) + cur[f0 + 1][x] * fr, X = pad + xo + (x / (cur[f0].length - 1)) * wv, Y = y0 - v * amp; x ? g.lineTo(X, Y) : g.moveTo(X, Y); }
      g.strokeStyle = on ? DISPC.or : DISPC.orD; g.lineWidth = 2; g.stroke();
      const sx = w - 14, top = 8, bot = hh - 8;
      g.fillStyle = DISPC.grid; g.fillRect(sx, top, 1.5, bot - top); g.fillStyle = on ? DISPC.or : DISPC.orD; const py = bot - pos * (bot - top); g.fillRect(sx - 3.5, py - 3.5, 8, 7);
      g.fillStyle = on ? DISPC.or : DISPC.orD; g.font = '600 10px system-ui'; g.textAlign = 'right'; g.fillText(Math.round(pos * 100) + ' %', w - 4, hh - 1); g.textAlign = 'start';
    });
    draws.push(() => cv.paint());
    lvDrag(cv, { onDown: () => ({ p: B.get(b + 1) }), onMove: (x, y, dx, dy, s) => { B.set(b + 1, clamp(s.p - dy / (H - 16), 0, 1)); redraw(); B.nodes.forEach((n) => n.update && n.update()); } });
    const catSel = lvSel(() => WT_CATS.map((c, k) => ({ value: k, label: c.name })), cat, (k) => { B.set(b, WT_CATS[k].first); frameCache.clear(); buildOsc(); }, { w: 96, cls: 'or' });
    const tabSel = lvSel(() => WT_LIST.map((w, k) => ({ value: k, label: w.name, dim: false })).filter((w) => WT_LIST[w.value].cat === cat()), tabIdx, (k) => { B.set(b, k); redraw(); }, { w: 108, cls: 'or' });
    const step = (d) => lvBtn(d < 0 ? '\u25C2' : '\u25B8', () => { B.set(b, (tabIdx() + d + WT_COUNT) % WT_COUNT); buildOsc(); }, { w: 18, cls: 'mini' });
    const mode = B.sel(b + 4, { w: 62 });
    const fxn = lvLab('FX 1', B.num(b + 2, { w: 52, label: 'FX 1', fill: true })), fxn2 = lvLab('FX 2', B.num(b + 3, { w: 52, label: 'FX 2', fill: true }));
    oscBox.replaceChildren(oscTabs, h('div', { class: 'wtm' }, row(catSel, tabSel, step(-1), step(1)), cv, row(lvLab('Mode', mode), fxn, fxn2, lvLab('Semi', B.num(b + 6, { w: 48 })), lvLab('Det', B.num(b + 7, { w: 52 })), lvLab('Gain', B.num(b + 5, { w: 52 })))));
    [...oscTabs.children].forEach((x, k) => x.classList.toggle('on', k === mem.osc)); oscTabs.update();
  }
  buildOsc();

  // ---- filter
  const fcv = vizCanvas(176, 58);
  const fdraw = () => { drawFilter(fcv, { type: Math.round(B.get(31)), f: B.get(32), q: B.get(33), poles: 1 }, Math.abs(M(4, 0)) > 0.01 ? [clamp(B.get(32) * Math.pow(2, 6 * Math.abs(M(4, 0))), 30, SR * 0.45)] : null); fcv.style.opacity = B.get(30) > 0.5 ? 1 : 0.45; };
  function M(d, s) { return B.get(MX0 + s * 8 + d); }
  draws.push(fdraw); fdraw();
  lvDrag(fcv, { onDown: () => ({ c: toNorm(def.params[32], B.get(32)), r: toNorm(def.params[33], B.get(33)) }), onMove: (x, y, dx, dy, s) => { B.set(32, fromNorm(def.params[32], s.c + dx / 176)); B.set(33, fromNorm(def.params[33], s.r - dy / 90)); redraw(); B.nodes.forEach((n) => n.update && n.update()); } });
  const filt = sec(row(B.tog(30, 'Filter', { w: 46 }), B.sel(31, { w: 76 })), fcv, krow(B.knob(32, 'Freq'), B.knob(33, 'Res'), B.knob(34, 'Drive')));

  // ---- filter 2 (serial or parallel with filter 1)
  const fcv2 = vizCanvas(176, 58);
  const fdraw2 = () => { drawFilter(fcv2, { type: Math.round(B.get(102)), f: B.get(103), q: B.get(104), poles: 1 }, null); fcv2.style.opacity = B.get(101) > 0.5 ? 1 : 0.45; };
  draws.push(fdraw2); fdraw2();
  lvDrag(fcv2, { onDown: () => ({ c: toNorm(def.params[103], B.get(103)), r: toNorm(def.params[104], B.get(104)) }), onMove: (x, y, dx, dy, s) => { B.set(103, fromNorm(def.params[103], s.c + dx / 176)); B.set(104, fromNorm(def.params[104], s.r - dy / 90)); redraw(); B.nodes.forEach((n) => n.update && n.update()); } });
  const route = B.choice(105, [{ label: 'Ser', title: 'Serial' }, { label: 'Par', title: 'Parallel' }]);
  const filt2 = sec(row(B.tog(101, 'Filter 2', { w: 46 }), B.sel(102, { w: 76 }), route), fcv2, krow(B.knob(103, 'Freq'), B.knob(104, 'Res')));

  // ---- modulation sources
  const modBox = h('div', { class: 'lv-sec wtmod' });
  const SRC = [{ n: 'Amp', k: 35, env: true }, { n: 'Env 2', k: 39, env: true }, { n: 'Env 3', k: 43, env: true }, { n: 'LFO 1', k: 47 }, { n: 'LFO 2', k: 50 }];
  const modTabs = lvTabs(SRC.map((s) => ({ label: s.n })), mem.mod, (k) => { mem.mod = k; buildMod(); }, { cls: 'wtabs sm' });
  function buildMod() {
    const s = SRC[mem.mod], W = 150, H = 54;
    let cv;
    if (s.env) cv = lvDisp(W, H, (g, w, hh) => { const [a, d, su, r] = [0, 1, 2, 3].map((q) => B.get(s.k + q)); lvPath(g, lvEnvPts(w, hh, a, d, su, r), DISPC.bl, hh - 4); for (const pt of lvEnvPts(w, hh, a, d, su, r).slice(1, 4)) lvRing(g, pt[0], pt[1]); });
    else cv = lvDisp(W, H, (g, w, hh) => {
      g.fillStyle = DISPC.grid; g.fillRect(0, Math.round(hh / 2), w, 1);
      const sh = Math.round(B.get(s.k)), att = B.get(s.k + 2), pts = [];
      for (let x = 0; x <= w - 4; x += 1.5) { const u = x / (w - 4), ph = (u * 3) % 1, a = att > 0.001 ? Math.min(1, u * 3 / (att * B.get(s.k + 1) + 0.01) * 0.3) : 1; const y = (sh === 0 ? Math.sin(6.2832 * ph) : sh === 1 ? 4 * Math.abs(ph - 0.5) - 1 : sh === 2 ? 2 * ph - 1 : sh === 3 ? (ph < 0.5 ? 1 : -1) : Math.sin(Math.floor(u * 9) * 12.9898)) * a; pts.push([x + 2, hh / 2 - y * (hh / 2 - 6)]); }
      lvPath(g, pts, DISPC.bl);
    });
    draws.push(() => cv.paint());
    const kn = s.env ? krow(...['A', 'D', 'S', 'R'].map((n, q) => B.knob(s.k + q, n))) : h('div', {}, row(lvLab('Shape', B.sel(s.k, { w: 66 })), lvLab('Attack', B.num(s.k + 2, { w: 52 }))), krow(B.knob(s.k + 1, 'Rate')));
    modBox.replaceChildren(modTabs, cv, kn);
    [...modTabs.children].forEach((x, k) => x.classList.toggle('on', k === mem.mod));
  }
  buildMod();

  // ---- matrix (rows = destinations, columns = sources)
  const mx = h('div', { class: 'wtx' });
  mx.append(h('div', { class: 'mc corner' }));
  for (const sname of MX_SRC) mx.append(h('div', { class: 'mc hd' }, sname));
  MX_DST.forEach((dn, d) => {
    mx.append(h('div', { class: 'mc rl' }, dn));
    MX_SRC.forEach((sn, s) => {
      const k = (MX0 + s * 8 + d) === 90 ? 106 : MX0 + s * 8 + d, p = def.params[k];   // 90 = instrument pitch, so Vel>Filter Res uses 106
      const cell = lvNum(p, () => B.get(k), (v) => { B.set(k, Math.abs(v) < 0.02 ? 0 : v); redraw(); cell.paintCell(); }, (pp, v) => (Math.abs(v) < 0.005 ? '' : String(Math.round(v * 100))), { cls: 'mx', px: 90, label: `${sn} \u2192 ${dn}`, onLong: null });
      cell.paintCell = () => { const v = B.get(k); cell.style.setProperty('--f', String(Math.abs(v))); cell.classList.toggle('neg', v < 0); cell.classList.toggle('pos', v > 0); };
      cell.paintCell(); B.nodes.push(cell); mx.append(cell);
    });
  });

  // ---- global: unison, voices, glide, volume
  const glob = sec(title('Unison'), row(lvLab('Mode', B.sel(26, { w: 78 })), lvLab('Voices', B.num(27, { w: 40 })), lvLab('Amount', B.num(28, { w: 50, fill: true }))),
    title('Global'), row(lvLab('Mono', B.tog(23, 'Mono')), lvLab('Voices', B.num(25, { w: 40 })), B.knob(24, 'Glide'), B.knob(29, 'Volume')));

  return { el: h('div', { class: 'lv-dev wt' }, left, h('div', { class: 'lv-sec wtc' }, oscBox), filt, filt2, modBox, h('div', { class: 'lv-sec wtmx' }, title('Matrix'), mx), glob), refresh: () => { redraw(); B.nodes.forEach((n) => n.update && n.update()); } };
}
