// MiniMeters: a metering suite with seven modules (VU, Waveform, Spectrogram, Spectrum, Stereometer, Loudness, Oscilloscope) and three layouts:
//   Quad        2 x 2 modules, tap a module's name to choose which one sits in that corner
//   Horizontal  the enabled modules side by side, tap a name to move it left / right or hide it
//   Single      one module with a tab bar (like a single plug-in per module)
// Presets (factory + your own) store layout, modules, options and colour theme. The data comes from the MiniMeters effect (type 16) in the
// engine; the window version (fit: false) fills its window and re-lays itself out on every resize.
import { h, ask, toast } from './ui.js';
import { eng } from './engine.js';
import { fft } from './engine/dsp.js';
import { THEMES, THEME_NAMES, MODULES, MODULE_IDS, makeModule, END, targetFromFile } from './mmdraw.js';

const SKEY = 'mobiledaw.mm.s.', PKEY = 'mobiledaw.mm.presets';
const ENG = { fft: 1, follow: 2, ch: 3 };                         // preset keys -> engine parameter index
const MOD_NAME = Object.fromEntries(MODULES);

// ------------------------------------------------------------------------------------------------ presets
const P1 = (o) => o;
export const FACTORY = [
  P1({ name: 'Default', layout: 'bar', bar: ['spectrogram', 'stereo', 'waveform', 'loudness', 'scope', 'spectrum'], theme: 'Default', eng: { fft: 2, follow: 1, ch: 0 }, opt: {} }),
  P1({ name: 'Quad', layout: 'quad', quad: ['spectrogram', 'spectrum', 'stereo', 'loudness'], theme: 'Default', eng: { fft: 2, follow: 1, ch: 0 }, opt: {} }),
  P1({ name: 'Mastering', layout: 'quad', quad: ['spectrum', 'stereo', 'loudness', 'waveform'], theme: 'Default', eng: { fft: 3, follow: 0, ch: 1 },
    opt: { spectrum: { mode: 'both', smooth: 0.7 }, stereo: { mode: 'scaled', color: 'multi', corr: 'multi' }, loudness: { mode: 's' }, waveform: { ch: 'MS', color: 'multi', secs: 10, hist: true } } }),
  P1({ name: 'Mixing', layout: 'quad', quad: ['spectrum', 'spectrogram', 'stereo', 'vu'], theme: 'Default', eng: { fft: 2, follow: 0, ch: 0 },
    opt: { spectrum: { mode: 'fft', smooth: 0.55 }, spectrogram: { scale: 'mel', mode: 'sharp', tilt: 3 }, stereo: { mode: 'scaled', color: 'rgb', corr: 'single' }, vu: { style: 1, ch: 'M' } } }),
  P1({ name: 'Loudness Check', layout: 'bar', bar: ['loudness', 'vu', 'waveform'], theme: 'Default', eng: { fft: 2, follow: 0, ch: 0 }, opt: { loudness: { mode: 'm' }, waveform: { ch: 'L', color: 'static', secs: 12, hist: false }, vu: { style: 2, ch: 'L' } } }),
  P1({ name: 'Pitch & Tone', layout: 'quad', quad: ['spectrogram', 'scope', 'spectrum', 'loudness'], theme: 'Phosphor', eng: { fft: 3, follow: 1, ch: 0 },
    opt: { spectrogram: { scale: 'log', piano: true, freq: false, mode: 'sharper', tilt: 4.5 }, scope: { cycle: 'single', ch: 'M', follow: 1, zoom: 1 }, spectrum: { mode: 'fft', over: true, scale: 'log', smooth: 0.75 } } }),
  P1({ name: 'Stereo Check', layout: 'bar', bar: ['stereo', 'waveform', 'spectrum'], theme: 'Magenta', eng: { fft: 2, follow: 0, ch: 1 },
    opt: { stereo: { mode: 'liss', color: 'multi', corr: 'multi' }, waveform: { ch: 'MS', color: 'multi', secs: 8, hist: false }, spectrum: { mode: 'fft', smooth: 0.6 } } }),
  P1({ name: 'Spectrum Only', layout: 'single', single: 'spectrum', theme: 'Default', eng: { fft: 3, follow: 0, ch: 0 }, opt: { spectrum: { mode: 'both', smooth: 0.65, over: true } } }),
  P1({ name: 'Spectrogram Only', layout: 'single', single: 'spectrogram', theme: 'Default', eng: { fft: 3, follow: 0, ch: 0 }, opt: { spectrogram: { scale: 'mel', orient: 'h', mode: 'sharp', tilt: 3, freq: true } } }),
  P1({ name: 'Retro VU', layout: 'single', single: 'vu', theme: 'Amber', eng: { fft: 2, follow: 0, ch: 0 }, opt: { vu: { style: 1, ch: 'L', cal: 0 } } }),
  P1({ name: 'Scope (Phosphor)', layout: 'single', single: 'scope', theme: 'Phosphor', eng: { fft: 2, follow: 1, ch: 0 }, opt: { scope: { cycle: 'single', ch: 'LR', follow: 1, zoom: 1 } } }),
];
const userPresets = () => { try { return JSON.parse(localStorage.getItem(PKEY) || '{}') || {}; } catch (_) { return {}; } };
const saveUserPresets = (o) => { try { localStorage.setItem(PKEY, JSON.stringify(o)); } catch (_) { /* storage unavailable */ } };

// ------------------------------------------------------------------------------------------------ per-device state (shared by the chain card and the window)
const states = new Map();
const defaults = (id) => { const d = makeModule(id, { opt: () => ({}), T: () => THEMES.Default, themeName: () => 'Default', clock: () => 0, eng: () => 0 }).def; return { ...d }; };
function blank() {
  const opt = {}; for (const id of MODULE_IDS) opt[id] = defaults(id);
  return { layout: 'quad', quad: ['spectrogram', 'spectrum', 'stereo', 'loudness'], bar: ['spectrogram', 'stereo', 'waveform', 'loudness', 'scope', 'spectrum'], single: 'spectrum', theme: 'Default', opt, preset: 'Quad', paused: false };
}
function stateFor(devId) {
  let S = states.get(devId);
  if (S) return S;
  S = blank();
  try { const j = JSON.parse(localStorage.getItem(SKEY + devId) || 'null'); if (j && typeof j === 'object') { Object.assign(S, j); for (const id of MODULE_IDS) S.opt[id] = { ...defaults(id), ...(j.opt && j.opt[id]) }; } } catch (_) { /* bad data: keep defaults */ }
  if (!THEMES[S.theme]) S.theme = 'Default';
  S.quad = (S.quad || []).filter((x) => MODULE_IDS.includes(x)); while (S.quad.length < 4) S.quad.push(MODULE_IDS[S.quad.length]);
  S.bar = (S.bar || []).filter((x) => MODULE_IDS.includes(x)); if (!S.bar.length) S.bar = ['spectrum'];
  if (!MODULE_IDS.includes(S.single)) S.single = 'spectrum';
  states.set(devId, S); return S;
}
let saveT = 0;
const persist = (devId) => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(SKEY + devId, JSON.stringify(states.get(devId))); } catch (_) { /* storage unavailable */ } }, 400); };

// ------------------------------------------------------------------------------------------------ the suite
// ctx: { i, di, d, set(paramIndex, value) }  every(ms, fn)  opts: { compact }
export function buildSuite(ctx, every, opts = {}) {
  const S = stateFor(ctx.d.id), compact = !!opts.compact, mods = new Map();
  const T = () => THEMES[S.theme] || THEMES.Default;
  const env = (id) => ({ opt: () => S.opt[id], T, themeName: () => S.theme, clock: () => performance.now(), eng: (k) => ctx.d.params[k] });
  const mod = (id) => { let m = mods.get(id); if (!m) { m = makeModule(id, env(id)); mods.set(id, m); } return m; };
  const getOpt = (id, od) => (od.eng ? ctx.d.params[od.eng] : S.opt[id][od.k]);
  const setOpt = (id, od, v) => {
    if (od.eng) ctx.set(od.eng, +v); else S.opt[id][od.k] = v;
    if (od.clear) mod(id).clear();
    persist(ctx.d.id);
  };

  const root = h('div', { class: 'mm' + (compact ? ' compact' : '') });
  const grid = h('div', { class: 'mm-grid' }), tabs = h('div', { class: 'mm-tabs', hidden: true });
  let cells = [], lastO = null, overlay = null, dpr = Math.min(3, window.devicePixelRatio || 1), gone = false;
  const css = () => { const t = T(); root.style.setProperty('--mm-a', t.a); root.style.setProperty('--mm-b', t.b); root.style.setProperty('--mm-c', t.c); root.style.setProperty('--mm-bg', t.bg); root.style.setProperty('--mm-panel', t.panel); root.style.setProperty('--mm-line', t.grid); root.style.setProperty('--mm-ink', t.ink); root.style.setProperty('--mm-dim', t.dim); };

  // ---- popups
  function closeOverlay() { if (overlay) { overlay.remove(); overlay = null; } }
  function popup(anchor, node) {
    closeOverlay();
    const pop = h('div', { class: 'mm-pop' }, node); overlay = pop; root.append(pop);
    const rr = root.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    const pw = Math.min(pop.offsetWidth || 190, rr.width - 8);
    pop.style.left = Math.max(4, Math.min(ar.left - rr.left, rr.width - pw - 4)) + 'px';
    const below = ar.bottom - rr.top + 2; pop.style.top = (below + 60 > rr.height ? Math.max(4, ar.top - rr.top - pop.offsetHeight - 2) : below) + 'px';
    const away = (e) => { if (!pop.contains(e.target) && !(e.target.closest && e.target.closest('.mm-pop'))) { closeOverlay(); root.removeEventListener('pointerdown', away, true); } };
    setTimeout(() => root.addEventListener('pointerdown', away, true), 0);
    return pop;
  }
  const menuNode = (items) => h('div', {}, items.map((it) => it.sep ? h('div', { class: 'mi sep' }) : it.hd ? h('div', { class: 'mi hd' }, it.hd) : h('div', { class: 'mi' + (it.check ? ' ck' : ''), onclick: () => { closeOverlay(); it.fn(); } }, it.label)));

  // ---- presets
  function applyPreset(p) {
    const base = blank();
    Object.assign(S, { layout: p.layout || 'quad', theme: p.theme || 'Default', preset: p.name, paused: false });
    if (p.quad) S.quad = p.quad.slice(0, 4); if (p.bar) S.bar = p.bar.slice(); if (p.single) S.single = p.single;
    for (const id of MODULE_IDS) S.opt[id] = { ...base.opt[id], ...((p.opt && p.opt[id]) || {}) };
    if (p.eng) for (const [k, v] of Object.entries(p.eng)) if (ENG[k]) ctx.set(ENG[k], +v);
    for (const m of mods.values()) m.clear();
    persist(ctx.d.id); css(); renderGrid();
  }
  const snapshot = (name) => ({ name, layout: S.layout, quad: S.quad.slice(), bar: S.bar.slice(), single: S.single, theme: S.theme, eng: { fft: ctx.d.params[1], follow: ctx.d.params[2], ch: ctx.d.params[3] }, opt: JSON.parse(JSON.stringify(S.opt)) });
  function presetMenu(anchor) {
    const up = userPresets(), items = [{ hd: 'Preset' }, ...FACTORY.map((p) => ({ label: p.name, check: S.preset === p.name, fn: () => applyPreset(p) }))];
    const names = Object.keys(up);
    if (names.length) items.push({ sep: true }, { hd: 'Preset saya' }, ...names.map((n) => ({ label: n, check: S.preset === n, fn: () => applyPreset(up[n]) })));
    items.push({ sep: true }, { label: 'Simpan preset saat ini\u2026', fn: () => ask('Nama preset', S.preset && !FACTORY.some((p) => p.name === S.preset) ? S.preset : '', (n) => { n = String(n || '').trim().slice(0, 40); if (!n) return; const all = userPresets(); all[n] = snapshot(n); saveUserPresets(all); S.preset = n; persist(ctx.d.id); psBtn.textContent = n; toast('Preset tersimpan.'); }) });
    if (names.length) items.push({ label: 'Hapus preset saya\u2026', fn: () => popup(anchor, menuNode(names.map((n) => ({ label: 'Hapus: ' + n, fn: () => { const all = userPresets(); delete all[n]; saveUserPresets(all); toast('Preset dihapus.'); } })))) });
    popup(anchor, menuNode(items));
  }

  // ---- option panel of one module
  function optionsPanel(id, cell) {
    if (cell.opt) { cell.opt.remove(); cell.opt = null; cell.gear.classList.remove('on'); return; }
    for (const c of cells) if (c.opt) { c.opt.remove(); c.opt = null; c.gear.classList.remove('on'); }
    const m = mod(id), rows = [];
    for (const od of m.opts) {
      const row = h('div', { class: 'row' }, h('label', {}, od.label));
      if (od.type === 'seg') {
        const bs = od.choices.map(([v, lab]) => h('button', { class: 'mm-btn' + (String(getOpt(id, od)) === String(v) ? ' on' : ''), onclick: () => { setOpt(id, od, typeof od.choices[0][0] === 'number' ? +v : v); bs.forEach((b, k) => b.classList.toggle('on', String(od.choices[k][0]) === String(v))); } }, lab));
        row.append(...bs);
      } else if (od.type === 'toggle') {
        const b = h('button', { class: 'mm-btn' + (getOpt(id, od) ? ' on' : ''), onclick: () => { const v = !(od.eng ? ctx.d.params[od.eng] >= 0.5 : S.opt[id][od.k]); setOpt(id, od, od.eng ? (v ? 1 : 0) : v); b.classList.toggle('on', v); b.textContent = v ? 'On' : 'Off'; } }, getOpt(id, od) ? 'On' : 'Off');
        row.append(b);
      } else if (od.type === 'range') {
        const lab = h('span', { style: 'min-width:46px;text-align:right' }, od.fmt(+getOpt(id, od)));
        const inp = h('input', { type: 'range', min: od.min, max: od.max, step: od.step, value: getOpt(id, od) }); inp.addEventListener('input', () => { setOpt(id, od, +inp.value); lab.textContent = od.fmt(+inp.value); });
        row.append(inp, lab);
      } else if (od.type === 'file') {
        const fi = h('input', { type: 'file', accept: 'audio/*,.wav,.mp3,.flac', hidden: true });
        const pick = h('button', { class: 'mm-btn', onclick: () => fi.click() }, m.target.arr ? m.target.name : 'Pilih file\u2026');
        fi.addEventListener('change', async () => { const f = fi.files && fi.files[0]; if (!f) return; try { toast('Menghitung kurva target\u2026'); m.target.arr = await targetFromFile(f, fft); m.target.name = f.name.slice(0, 28); pick.textContent = m.target.name; } catch (e) { toast('File tidak bisa dibaca: ' + (e && e.message ? e.message : 'format tidak didukung'), 4000); } });
        row.append(pick, fi, h('button', { class: 'mm-btn', onclick: () => { m.target.arr = null; pick.textContent = 'Pilih file\u2026'; } }, 'Hapus'));
      }
      rows.push(row);
    }
    if (id === 'loudness') rows.push(h('div', { class: 'row' }, h('label', {}, 'Reset'), h('button', { class: 'mm-btn', onclick: () => { m.clear(); ctx.set(0, (ctx.d.params[0] || 0) + 1); } }, 'Reset max / terintegrasi')));
    if (id === 'waveform' || id === 'spectrogram') rows.push(h('div', { class: 'row' }, h('label', {}, 'Tampilan'), h('button', { class: 'mm-btn', onclick: () => m.clear() }, 'Bersihkan')));
    const p = h('div', { class: 'mm-opt' }, rows); cell.el.append(p); cell.opt = p; cell.gear.classList.add('on');
  }

  // ---- layout
  function slotMenu(anchor, cell) {
    const id = cell.id;
    if (S.layout === 'quad') popup(anchor, menuNode(MODULES.map(([k, n]) => ({ label: n, check: k === id, fn: () => { S.quad[cell.slot] = k; persist(ctx.d.id); renderGrid(); } }))));
    else if (S.layout === 'bar') {
      const k = S.bar.indexOf(id);
      popup(anchor, menuNode([{ label: '\u25C0  Geser ke kiri', fn: () => { if (k > 0) { [S.bar[k - 1], S.bar[k]] = [S.bar[k], S.bar[k - 1]]; persist(ctx.d.id); renderGrid(); } } }, { label: 'Geser ke kanan  \u25B6', fn: () => { if (k < S.bar.length - 1) { [S.bar[k + 1], S.bar[k]] = [S.bar[k], S.bar[k + 1]]; persist(ctx.d.id); renderGrid(); } } },
        { label: 'Sembunyikan modul', fn: () => { if (S.bar.length > 1) { S.bar.splice(k, 1); persist(ctx.d.id); renderGrid(); } } }]));
    }
  }
  function renderGrid() {
    closeOverlay();
    for (const c of cells) { if (c.ro) c.ro.disconnect(); }
    cells = []; grid.replaceChildren();
    const ids = S.layout === 'quad' ? S.quad.slice(0, 4) : S.layout === 'bar' ? S.bar.slice() : [S.single];
    grid.style.cssText = S.layout === 'quad' ? 'grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr'
      : S.layout === 'bar' ? `grid-template-columns:repeat(${ids.length},minmax(${compact ? 110 : 130}px,1fr));grid-template-rows:1fr;overflow-x:auto;overflow-y:hidden` : 'grid-template-columns:1fr;grid-template-rows:1fr';
    ids.forEach((id, slot) => {
      const cv = h('canvas'), cell = { id, slot, el: h('div', { class: 'mm-mod' }), cv, g: cv.getContext('2d'), W: 0, H: 0, opt: null, ro: null };
      const nm = h('div', { class: 'mm-nm' }, MOD_NAME[id]);
      cell.gear = h('button', { class: 'mm-gear', 'aria-label': 'Pengaturan ' + MOD_NAME[id], onclick: (e) => { e.stopPropagation(); optionsPanel(id, cell); } }, '\u2699');
      cell.el.append(cv, nm, cell.gear);
      if (S.layout !== 'single') { nm.style.pointerEvents = 'auto'; nm.style.cursor = 'pointer'; nm.addEventListener('click', (e) => slotMenu(nm, cell)); }
      const m = mod(id);
      if (m.pointer) {
        const pt = (e) => { const r = cv.getBoundingClientRect(); m.pointer(e.clientX - r.left); };
        cv.addEventListener('pointerdown', (e) => { try { cv.setPointerCapture(e.pointerId); } catch (_) { /* gone */ } pt(e); });
        cv.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') pt(e); });
        const up = () => m.pointer(null); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      }
      const size = () => { const r = cell.el.getBoundingClientRect(); const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height)); if (W === cell.W && H === cell.H) return; cell.W = W; cell.H = H; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); };
      if (typeof ResizeObserver !== 'undefined') { cell.ro = new ResizeObserver(size); cell.ro.observe(cell.el); }
      grid.append(cell.el); cells.push(cell); size();
    });
    tabs.hidden = S.layout !== 'single';
    if (S.layout === 'single') tabs.replaceChildren(...MODULES.map(([k, n]) => h('button', { class: 'mm-btn' + (k === S.single ? ' on' : ''), onclick: () => { S.single = k; persist(ctx.d.id); renderGrid(); } }, n)));
    layBtn.textContent = '\u25A6 ' + ({ quad: 'Quad', bar: 'Horizontal', single: 'Single' })[S.layout];
    pauseBtn.classList.toggle('on', S.paused); psBtn.textContent = S.preset || 'Preset';
    draw();
  }

  // ---- settings popup (layout, theme, modules of the horizontal bar)
  function settings(anchor) {
    const node = h('div', { style: 'padding:8px;display:grid;gap:7px;min-width:210px' });
    const row = (label, ...kids) => h('div', { class: 'row', style: 'display:flex;gap:3px;align-items:center;flex-wrap:wrap' }, h('label', { style: 'min-width:60px;color:var(--mm-dim);font-size:9.5px;text-transform:uppercase' }, label), ...kids);
    const th = THEME_NAMES.map((n) => h('button', { class: 'mm-btn' + (S.theme === n ? ' on' : ''), onclick: () => { S.theme = n; persist(ctx.d.id); css(); th.forEach((b, k) => b.classList.toggle('on', THEME_NAMES[k] === n)); } }, n));
    const ly = [['quad', 'Quad'], ['bar', 'Horizontal'], ['single', 'Single']].map(([k, n]) => h('button', { class: 'mm-btn' + (S.layout === k ? ' on' : ''), onclick: () => { S.layout = k; persist(ctx.d.id); closeOverlay(); renderGrid(); } }, n));
    node.append(row('Layout', ...ly), row('Warna', ...th));
    const mm = MODULES.map(([k, n]) => h('button', { class: 'mm-btn' + (S.bar.includes(k) ? ' on' : ''), onclick: () => { const at = S.bar.indexOf(k); if (at >= 0) { if (S.bar.length > 1) S.bar.splice(at, 1); } else S.bar.push(k); persist(ctx.d.id); mm.forEach((b, i) => b.classList.toggle('on', S.bar.includes(MODULES[i][0]))); if (S.layout === 'bar') renderGrid(); } }, n));
    node.append(row('Modul (bar)', ...mm), row('Data', h('button', { class: 'mm-btn', onclick: () => { for (const m of mods.values()) m.clear(); ctx.set(0, (ctx.d.params[0] || 0) + 1); closeOverlay(); } }, 'Reset semua meter')));
    popup(anchor, node);
  }

  // ---- toolbar
  const psBtn = h('button', { class: 'mm-btn ps', onclick: (e) => presetMenu(e.currentTarget) }, S.preset || 'Preset');
  const layBtn = h('button', { class: 'mm-btn', onclick: (e) => popup(e.currentTarget, menuNode([['quad', 'Quad'], ['bar', 'Horizontal'], ['single', 'Single']].map(([k, n]) => ({ label: n, check: S.layout === k, fn: () => { S.layout = k; persist(ctx.d.id); renderGrid(); } })))) }, '\u25A6 Quad');
  const pauseBtn = h('button', { class: 'mm-btn', 'aria-label': 'Jeda semua meter', title: 'Jeda', onclick: () => { S.paused = !S.paused; pauseBtn.classList.toggle('on', S.paused); pauseBtn.textContent = S.paused ? '\u25B6' : '\u2759\u2759'; persist(ctx.d.id); } }, S.paused ? '\u25B6' : '\u2759\u2759');
  const rstBtn = h('button', { class: 'mm-btn', 'aria-label': 'Reset meter', title: 'Reset', onclick: () => { for (const m of mods.values()) m.clear(); ctx.set(0, (ctx.d.params[0] || 0) + 1); } }, '\u21BA');
  const setBtn = h('button', { class: 'mm-btn', 'aria-label': 'Pengaturan', title: 'Pengaturan', onclick: (e) => settings(e.currentTarget) }, '\u2699');
  const tool = h('div', { class: 'mm-tool' }, h('span', { class: 'mm-logo' }, 'Mini', h('b', {}, 'Meters')), psBtn, layBtn, h('span', { class: 'mm-sp' }), pauseBtn, rstBtn, setBtn);
  // Like the real MiniMeters the modules fill the window edge to edge with no chrome; tap the small handle (top right) to show the controls for a few seconds.
  const more = h('button', { class: 'mm-more', 'aria-label': 'Tampilkan kontrol', title: 'Kontrol' }, '\u22EF');
  let uiT = 0;
  const showUi = (on) => { clearTimeout(uiT); root.classList.toggle('ui', on); if (!on) closeOverlay(); else uiT = setTimeout(() => { if (!overlay && !cells.some((c) => c.opt)) root.classList.remove('ui'); else showUi(true); }, 6000); };
  more.addEventListener('click', (e) => { e.stopPropagation(); showUi(!root.classList.contains('ui')); });
  root.addEventListener('pointerdown', () => { if (root.classList.contains('ui')) showUi(true); }, true);   // any touch keeps the controls up
  root.append(grid, tool, tabs, more);
  css();

  // ---- frame loop
  function draw() {
    if (gone) return;
    for (const c of cells) {
      if (!c.W || !c.H) continue;
      const g = c.g; g.setTransform(dpr, 0, 0, dpr, 0, 0);
      try { mod(c.id).draw(g, c.W, c.H); } catch (e) { console.error('minimeters draw', c.id, e); }
    }
  }
  function tick() {
    const o = eng.devOut(ctx.i, ctx.di);
    if (Array.isArray(o) && o.length >= END) {
      if (o !== lastO && !S.paused) {
        lastO = o;
        const seen = new Set(cells.map((c) => c.id));
        for (const id of seen) { try { mod(id).ingest(o); } catch (e) { console.error('minimeters ingest', id, e); } }
      }
    }
    draw();
  }
  renderGrid();
  every(33, tick);

  return {
    el: root,
    destroy() { gone = true; clearTimeout(uiT); for (const c of cells) if (c.ro) c.ro.disconnect(); closeOverlay(); },
    onResize() { dpr = Math.min(3, window.devicePixelRatio || 1); closeOverlay(); },
  };
}

// compact version for the device chain (the full suite lives in the floating window)
export function minimetersView(ctx) {
  const suite = buildSuite(ctx, ctx.every, { compact: true });
  const box = h('div', { class: 'mmbox', style: 'width:340px;height:214px' }, suite.el);
  return { el: box, draw() { /* knobs of this device are hidden: nothing to redraw */ } };
}
