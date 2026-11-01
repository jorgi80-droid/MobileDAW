// Device chain for the selected strip (track, return or master): instrument card, effect cards, "+" card.
// Long-press a knob to create automation for it. Levelness / Analyzer / Autoduck have live meter views.
import { C } from './theme.js';
import { h, knob, menu, modal, fromNorm, toNorm, ask, toast } from './ui.js';
import * as PRS from './presets.js';
import { LAYOUT, buildSynth, DISP } from './devviz.js';
import { FXVIEW } from './fxviz.js';
import { samplerPanel, wavetablePanel } from './liveinst.js';
import { INSTRUMENTS, INST_LIST, DEVICES, INST, fmtParam, noteName, FX_GROUPS } from './defs.js';
import { eng, MASTER, RET0 } from './engine.js';
import { offerAutomation } from './automate.js';
import * as BR from './browser.js';
import * as P from './project.js';
import * as FW from './floatwin.js';
import { buildSuite, minimetersView } from './minimeters.js';
import { kitView, irackView, instKitView, padChainView } from './fxkit.js';
import { prefs } from './prefs.js';
import * as DP from './drumpad.js';
import { reorderGrip } from './reorder.js';
const { state } = P;
const VIEWS = { ...FXVIEW, 16: minimetersView };   // MiniMeters has its own view module

let root = null, timers = [];
const padSel = new Map();
// Folded cards (Live-style vertical strips): remembered per device id / instrument track, also across reloads
const FOLD_KEY = 'mobiledaw.fold';
const folded = new Set((() => { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '[]'); } catch (_) { return []; } })());
const isFolded = (k) => folded.has(k);
function setFolded(k, on) { if (on) folded.add(k); else folded.delete(k); try { localStorage.setItem(FOLD_KEY, JSON.stringify([...folded].slice(-400))); } catch (_) { /* storage unavailable */ } render(); }
function titleFold(head, k) {                 // Live: double-click a device's title bar folds it; here a double tap on the bar (not on its buttons)
  let last = 0;
  head.addEventListener('pointerup', (e) => { if (head._noTap) { head._noTap = false; last = 0; return; } if (e.target.closest && e.target.closest('button') || head.closest('.fw')) return;   // in a floating window a double tap rolls the window up instead
    const now = performance.now(); if (now - last < 320) { last = 0; setFolded(k, !isFolded(k)); } else last = now; });
  return head;
}

const foldBtn = (k, on) => { const b = h('button', { class: 'fold-b', 'aria-label': on ? 'Buka lipatan' : 'Lipat modul', onclick: () => setFolded(k, !on) }, on ? '\u25B8' : '\u25C2'); return b; };
function foldedCard(k, name, pw) {
  const c = h('div', { class: 'card fold', 'aria-label': 'Buka ' + name, onclick: (e) => { if (e.target.closest && e.target.closest('.pw')) return; setFolded(k, false); } }, pw || null, h('span', { class: 'fn' }, name), foldBtn(k, true));
  return c;
}                                 // selected drum pad per track
const stripName = (i) => (i === MASTER ? 'Master' : P.tr(i) ? P.tr(i).name : '');
const live = () => root && root.isConnected && root.dataset.active === '1' && !document.hidden;
function every(ms, fn) { const t = setInterval(() => { if (live()) fn(); }, ms); timers.push(t); }

function knobGrid(def, count) {
  const cols = count > 8 ? Math.ceil(count / 2) : Math.max(1, Math.min(count, 4));
  return h('div', { class: 'knobs', style: `max-width:${cols * 60}px` });
}

// ---- sampler zones (DirectWave: one zone, Keystone: up to 16) ----------------------------------
function zoneEditor(i, k) {
  const t = state.tracks[i], z = t.inst.zones[k], multi = t.inst.type === INST.KEYSTONE;
  const num = (v, lo, hi) => h('input', { type: 'number', value: v, min: lo, max: hi, step: 1, inputmode: 'numeric', style: 'width:70px;height:32px;margin-left:8px;background:var(--bg);border:1px solid var(--line);color:var(--text);border-radius:2px;padding:0 6px;user-select:text' });
  const f = { root: num(z.root, 0, 127), lo: num(z.lo, 0, 127), hi: num(z.hi, 0, 127), vlo: num(z.vlo, 1, 127), vhi: num(z.vhi, 1, 127), tune: num(z.tune, -100, 100) };
  const loop = h('input', { type: 'checkbox', style: 'width:22px;height:22px;margin-left:8px' }); loop.checked = z.loop;
  const row = (label, el, hint) => h('label', { style: 'display:flex;align-items:center;padding:4px 0' }, h('span', { style: 'flex:1' }, label), el, h('span', { style: 'width:34px;color:var(--dim);font-size:11px;margin-left:6px' }, hint || ''));
  const hint = (el) => { const v = Math.round(+el.value); return Number.isFinite(v) ? noteName(Math.max(0, Math.min(127, v))) : ''; };
  const body = h('div', {},
    h('div', { style: 'padding-bottom:6px;color:var(--dim);word-break:break-all' }, z.sample ? z.sample.name : 'Belum ada sample'),
    h('button', { class: 'b', style: 'width:100%;margin-bottom:6px', onclick: () => BR.openBrowser('file', { track: i, zone: k }) }, z.sample ? 'Ganti sample\u2026' : 'Pilih sample\u2026'),
    row('Nada dasar (root)', f.root, hint(f.root)),
    multi ? row('Tuts terendah', f.lo, hint(f.lo)) : null, multi ? row('Tuts tertinggi', f.hi, hint(f.hi)) : null,
    multi ? row('Velocity min', f.vlo) : null, multi ? row('Velocity maks', f.vhi) : null,
    row('Tune (cent)', f.tune), row('Loop sample', loop));
  const acts = [{ label: 'Batal' }];
  if (multi && t.inst.zones.length > 1) acts.push({ label: 'Hapus zona', fn: () => P.removeZone(i, k) });
  acts.push({ label: 'Simpan', go: true, fn: () => {
    const n = (el, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+el.value) || 0));
    P.setZoneField(i, k, 'root', n(f.root, 0, 127));
    if (multi) { const lo = n(f.lo, 0, 127), hi = n(f.hi, 0, 127); P.setZoneField(i, k, 'lo', Math.min(lo, hi)); P.setZoneField(i, k, 'hi', Math.max(lo, hi)); const a = n(f.vlo, 1, 127), b = n(f.vhi, 1, 127); P.setZoneField(i, k, 'vlo', Math.min(a, b)); P.setZoneField(i, k, 'vhi', Math.max(a, b)); }
    P.setZoneField(i, k, 'tune', n(f.tune, -100, 100));
    P.setZoneField(i, k, 'loop', loop.checked);
  } });
  modal(multi ? `Zona ${k + 1}` : 'Sample DirectWave', body, acts);
}

function zonePanel(i, t) {
  const zs = t.inst.zones || [];
  const multi = t.inst.type === INST.KEYSTONE;
  const list = h('div', { class: 'zones' });
  zs.forEach((z, k) => list.append(h('button', { class: 'zone b', onclick: () => zoneEditor(i, k) },
    h('b', {}, multi ? `Zona ${k + 1}` : 'Sample'),
    h('span', { class: 'zn' }, z.sample ? z.sample.name : '(kosong \u2014 ketuk)'),
    h('span', { class: 'zr' }, multi ? `${noteName(z.lo)}\u2013${noteName(z.hi)} \u2022 root ${noteName(z.root)}${z.vlo > 1 || z.vhi < 127 ? ` \u2022 vel ${z.vlo}\u2013${z.vhi}` : ''}${z.loop ? ' \u2022 loop' : ''}` : `root ${noteName(z.root)}${z.loop ? ' \u2022 loop' : ''}`))));
  if (multi && zs.length < P.MAX_ZONES) list.append(h('button', { class: 'b', style: 'height:30px', onclick: () => { const k = P.addZone(i); if (k !== null) zoneEditor(i, k); } }, '+ Zona'));
  return list;
}

// Pitch knob (-24..+24 semitones): part of the main controls of every instrument (Volume panel / knob grid / drum row)
function pitchKnob(i, t) {
  const p = { ...P.PITCH_PARAM, fmt: 'st' };   // display only: "-7 st" instead of a bare "-7"
  return knob(p, () => t.inst.pitch || 0, (v) => P.setPitch(i, v), fmtParam, C('#ffa722'),
    (rect) => offerAutomation(rect, { kind: 5, strip: P.stripOf(i), param: 90, def: p }, `${t.name} \u2022 Pitch`));
}

// ---- floating windows: the same cards, opened as free windows (drag, resize, shrink, minimise). While a window is open the chain shows a placeholder.
const popBtn = (open) => h('button', { class: 'fw-pop', 'aria-label': 'Buka di jendela mengambang', title: 'Jendela mengambang', onclick: (e) => { e.stopPropagation(); open(); } }, '\u29C9');
function floatedCard(key, name, open) {
  return h('div', { class: 'card floated' }, h('h4', {}, h('span', {}, name)),
    h('div', { class: 'fl-msg' }, 'Terbuka di jendela mengambang.'),
    h('div', { class: 'fl-btns' }, h('button', { class: 'b', onclick: open }, 'Tampilkan'), h('button', { class: 'b', onclick: () => FW.closeFloat(key) }, 'Kembalikan')));
}
function locateDev(devId) {
  const find = (i) => { const c = P.tr(i); if (!c) return null; const di = c.devices.findIndex((x) => x.id === devId); return di < 0 ? null : { i, di, d: c.devices[di], n: c.devices.length }; };
  for (let k = 0; k < state.tracks.length; k++) { const r = find(k); if (r) return r; }
  for (let k = 0; k < state.returns.length; k++) { const r = find(RET0 + k); if (r) return r; }
  return find(MASTER);
}
export function openDeviceWindow(devId) {
  const L0 = locateDev(devId); if (!L0) return;
  const mm = L0.d.type === 16, name = DEVICES[L0.d.type].name;
  FW.openFloat({ id: 'd:' + devId, title: name + ' \u2022 ' + stripName(L0.i), sub: stripName(L0.i), mergeHead: !mm, color: '#7ac5ff', fit: !mm, frameless: mm, w: 560, h: 330, minW: mm ? 240 : undefined, minH: mm ? 120 : undefined,
    build(api) {
      const L = locateDev(devId); if (!L) return null;
      api.setTitle(name + ' \u2022 ' + stripName(L.i), stripName(L.i));
      if (mm) return buildSuite({ i: L.i, di: L.di, d: L.d, set: (k, v) => P.setDeviceParam(L.i, L.di, k, v) }, api.every);
      return fxCard(L.i, L.d, L.di, L.n, { every: api.every, floating: true });
    } });
}
export function openInstWindow(trackId) {
  const idx = () => state.tracks.findIndex((x) => x.id === trackId);
  const i0 = idx(); if (i0 < 0 || !state.tracks[i0].inst) return;
  FW.openFloat({ id: 'i:' + trackId, title: INSTRUMENTS[state.tracks[i0].inst.type].name + ' \u2022 ' + state.tracks[i0].name, sub: state.tracks[i0].name, mergeHead: true, color: '#ffa722', fit: true,
    build(api) {
      const i = idx(); if (i < 0 || !state.tracks[i].inst) return null;
      const t = state.tracks[i]; api.setTitle(INSTRUMENTS[t.inst.type].name + ' \u2022 ' + t.name, t.name);
      return instCard(i, t, { floating: true });
    } });
}

function instCard(i, t, o = {}) {
  const def = INSTRUMENTS[t.inst.type];
  const fk = 'i' + t.id;
  if (!o.floating && FW.isOpen('i:' + t.id)) return floatedCard('i:' + t.id, def.name, () => openInstWindow(t.id));
  if (!o.floating && isFolded(fk)) return foldedCard(fk, def.name, null);
  const head = h('h4', {}, h('i', { class: 'pdot' }));
  if (t.kind === 'midi') head.append(h('button', { class: 'dv-name', 'aria-label': 'Ganti instrumen', onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    menu(INST_LIST.map((k) => ({ label: INSTRUMENTS[k].name, check: t.inst.type === k, fn: () => P.setInstrument(i, k) })), r.left, r.bottom);
  } }, h('span', {}, def.name), h('i', { class: 'tri', 'aria-hidden': 'true' })));
  else head.append(h('span', {}, def.name));
  titleFold(head, fk);
  if (t.inst.sub) head.append(h('span', { class: 'dv-miss-chip sub', title: 'Program asli tidak ada di arsip: diganti preset SoundFont General MIDI yang paling mirip' }, 'pengganti ' + (t.inst.sub.from || '') + ' "' + (t.inst.sub.library || '') + '" \u2192 ' + (t.inst.sub.gm || '')));
  if (t.inst.missing) {                                  // imported instrument whose program / sample is not available: the pattern is kept, the chip says what is missing
    const x = t.inst.missing, what = x.sample ? 'sample ' + x.sample.split('/').pop() : x.library ? 'program ' + x.library.replace(/^.*\//, '').replace(/\.\w+$/, '') : x.name;
    head.append(h('span', { class: 'dv-miss-chip', title: 'Muat sample di zona untuk membunyikan pattern ini' }, '\u26a0 ' + (x.name || 'Instrumen') + ': ' + what + ' tidak tersedia'));
  }
  if (t.kind === 'midi') {
    const presets = P.presetsFor(t.inst.type);
    head.append(h('button', { class: 'pre', 'aria-label': 'Preset', style: 'width:auto;padding:0 6px;font-size:11px', onclick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const items = [{ label: 'Simpan preset ke folder\u2026', fn: () => ask('Nama preset', '', (n) => { const x = PRS.saveInstrumentPreset(i, n); toast(x.error || 'Preset tersimpan di Presets/Instruments.'); }) }];
      const mine = PRS.userInstrumentPresets(t.inst.type);
      if (mine.length) { items.push({ sep: true }, { label: 'PRESET SAYA', dim: true }); for (const m of mine) items.push({ label: m.name, fn: () => { const x = PRS.applyPresetFile(m.path, i); if (x.error) toast(x.error, 4000); } }); }
      let cat = null;
      for (const pr of presets) {
        if (pr.cat && pr.cat !== cat) { cat = pr.cat; items.push({ sep: true }); items.push({ label: cat.toUpperCase(), dim: true }); }
        items.push({ label: pr.name, fn: () => P.applyPreset(i, pr) });
      }
      menu(items, r.left - 60, r.bottom);
    } }, 'Preset'));
  }
  if (!o.floating) head.append(popBtn(() => openInstWindow(t.id)));
  if (!o.floating) head.append(foldBtn(fk, false));
  if (def.view === 'kit') { const kv = instKitView(i, t, o.every || every); if (kv) return h('div', { class: 'card lkcard lvcard' }, head, kv.el); }   // Live 12 instruments (fxkit.js VI)
  if (def.view === 'irack') { const rv = irackView(i, t, o.every || every); return h('div', { class: 'card lkcard lvcard' }, head, rv.el); }   // Instrument Rack (fxkit.js rackPanel)
  if (def.view === 'lsampler' || def.view === 'lwavetable') {
    const pn = def.view === 'lsampler' ? samplerPanel(i, t) : wavetablePanel(i, t);
    return h('div', { class: 'card lvcard' }, head, pn.el);
  }
  const body = knobGrid(def, def.params.length + 1);   // +1 = the Pitch knob, which lives in the same grid
  let envRedraw = null;
  // Live-style panels (Osc / Filter / Mod Sources / Voice) with displays; instruments without a layout keep the plain knob grid
  const syn = t.kind === 'midi' && LAYOUT[t.inst.type] ? buildSynth({
    type: t.inst.type, t, def, h, knob, fmt: fmtParam, fromNorm, toNorm, pitch: () => pitchKnob(i, t),
    get: (k) => t.inst.params[k] ?? def.params[k].def,
    set: (k, v) => P.setInstParam(i, k, v),
    auto: (rect, k) => offerAutomation(rect, { kind: 5, strip: P.stripOf(i), param: k, def: def.params[k] }, `${t.name} \u2022 ${def.params[k].n}`),
  }) : null;
  const EM = syn ? null : ({ 1: { a: 2, d: 3, s: 4, r: 5 }, 2: { a: 3, r: 4 } })[t.inst.type];
  if (EM && t.kind === 'midi') {                     // amp-envelope display (Live shows the same next to its ADSR knobs)
    const cv = h('canvas', { class: 'envcv', width: 190, height: 56 }), ro = h('div', { class: 'envro' });
    const val = (k, fb) => (k === undefined ? fb : (t.inst.params[k] ?? def.params[k].def));
    envRedraw = () => {
      const a = val(EM.a, 0.01), dd = val(EM.d, 0.001), s = val(EM.s, 1), r = val(EM.r, 0.2);
      const g = cv.getContext('2d'), w = cv.width, hh = cv.height;
      g.fillStyle = DISP.bg; g.fillRect(0, 0, w, hh);
      const wa = Math.sqrt(a), wd = Math.sqrt(dd), wr = Math.sqrt(r), wh = Math.max(0.25, (wa + wd + wr) * 0.35), k = (w - 12) / (wa + wd + wh + wr);
      const X = [6, 6 + wa * k, 6 + (wa + wd) * k, 6 + (wa + wd + wh) * k, 6 + (wa + wd + wh + wr) * k], sy = 6 + (1 - s) * (hh - 12), Y = [hh - 6, 6, sy, sy, hh - 6];
      g.beginPath(); X.forEach((x, n) => (n ? g.lineTo(x, Y[n]) : g.moveTo(x, Y[n])));
      g.strokeStyle = '#5fd0e0'; g.lineWidth = 1.6; g.stroke();
      g.lineTo(X[0], hh - 6); g.closePath(); g.fillStyle = 'rgba(95,208,224,.16)'; g.fill();
      g.fillStyle = '#ffa722'; for (const n of [1, 2, 3]) { g.beginPath(); g.arc(X[n], Y[n], 2.8, 0, 6.2832); g.fill(); }
      const parts = [['A', EM.a, a], ['D', EM.d, dd], ['S', EM.s, s], ['R', EM.r, r]].filter((x) => x[1] !== undefined);
      ro.textContent = parts.map(([l, kk, v]) => `${l} ${fmtParam(def.params[kk], v)}`).join('   ');
    };
    body.prepend(h('div', { class: 'envbox' }, cv, ro)); body.classList.add('wide'); envRedraw();
  }
  if (!syn) def.params.forEach((p, k) => body.append(knob(p, () => t.inst.params[k] ?? p.def, (v) => { P.setInstParam(i, k, v); if (envRedraw) envRedraw(); }, fmtParam, C('#ffa722'),
    (rect) => offerAutomation(rect, { kind: 5, strip: P.stripOf(i), param: k, def: p }, `${t.name} \u2022 ${p.n}`))));
  if (!syn) body.append(pitchKnob(i, t));
  if (t.inst.type === INST.DRUM) {
    // Live 12 Drum Rack: 4 x 4 pads (first pad bottom left), each with its name and M / ▶ / S (mute, play, solo); tap = play + select.
    // Right: the selected pad (Level, Pan, Pitch, Decay, sample, start / end, reverse) and the rack's Pitch.
    const PD = P.padsOf(i);
    let cur = Math.min(padSel.get(t.id) ?? 0, PD.length - 1);
    const pads = h('div', { class: 'drk-pads' }), side = h('div', { class: 'drk-side' });
    const PK = [{ n: 'Level', min: -24, max: 6, def: 0, unit: 'dB' }, { n: 'Pitch', min: -12, max: 12, def: 0, unit: 'st' }, { n: 'Decay', min: 0.25, max: 3, def: 1, curve: 'log', unit: 'x' }];
    const PAN = { n: 'Pan', min: -1, max: 1, def: 0, fmt: 'pan' }, ST = { n: 'Start', min: 0, max: 0.95, def: 0, unit: '%' }, EN = { n: 'End', min: 0.05, max: 1, def: 1, unit: '%' };
    const col = C('#ffa722');
    const sbtn = (label, on, fn, cls = '') => { const b = h('button', { class: 'lv-btn drk-b ' + cls + (on ? ' on' : ''), onclick: (e) => { e.stopPropagation(); fn(b); } }, label); b.addEventListener('pointerdown', (e) => e.stopPropagation()); return b; };
    const showSide = () => {
      const q = PD[cur], pk = (j) => { const idx = cur * 3 + j, p = PK[j]; return knob(p, () => t.inst.params[idx] ?? p.def, (v) => P.setInstParam(i, idx, v), fmtParam, col, (rect) => offerAutomation(rect, { kind: 5, strip: P.stripOf(i), param: idx, def: p }, `${t.name} • ${q.name} ${p.n}`)); };
      const pf = (f, p) => knob(p, () => q[f], (v) => P.setPad(i, cur, f, v), fmtParam, col);
      const pick = () => BR.openBrowser('file', { track: i, pad: cur, done: () => render() });
      if (q.chain && q.chain.inst) {                 // the pad plays its chain: Level / Pan / Pitch (shifts the note the chain receives) only
        side.replaceChildren(h('div', { class: 'drk-st' }, h('b', {}, q.name), h('span', {}, noteName(q.pitch))), h('div', { class: 'drk-kn' }, pk(0), pf('pan', PAN), pk(1)),
          h('div', { class: 'drk-kn drk-note' }, 'Pad ini memainkan chain ' + INSTRUMENTS[q.chain.inst.type].name + ' (C3 + Pitch). Atur suaranya di kolom Chain.'),
          h('div', { class: 'drk-rack' }, h('span', {}, 'Rack'), pitchKnob(i, t)));
        return;
      }
      side.replaceChildren(
        h('div', { class: 'drk-st' }, h('b', {}, q.name), h('span', {}, noteName(q.pitch))),
        h('div', { class: 'drk-kn' }, pk(0), pf('pan', PAN), pk(1), pk(2)),
        h('div', { class: 'drk-smp' }, h('button', { class: 'lv-btn drk-file', onclick: pick }, q.sample ? q.sample.name : 'Sintetis bawaan • pilih sample…'),
          q.sample ? sbtn('Rev', q.rev, (b) => { P.setPad(i, cur, 'rev', !q.rev); b.classList.toggle('on', q.rev); }) : null),
        q.sample ? h('div', { class: 'drk-kn' }, pf('start', ST), pf('end', EN)) : h('div', { class: 'drk-kn drk-note' }, 'Pad sintetis: suara diatur dengan Level, Pitch dan Decay.'),
        h('div', { class: 'drk-rack' }, h('span', {}, 'Rack'), pitchKnob(i, t)));
    };
    const cells = [];
    for (let k = 0; k < P.MAX_PADS; k++) {
      const d = PD[k];
      if (!d) { cells.push(h('button', { class: 'drk-pad empty', 'aria-label': 'Tambah pad', onclick: () => DP.addPad(i) }, h('span', { class: 'drk-n' }, '+'), h('small', {}, 'Drop Sample'))); continue; }
      const play = sbtn('▶', false, () => {}, 'pl');
      play.addEventListener('pointerdown', () => P.noteEvent(i, d.pitch, 0.9, true)); ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => play.addEventListener(ev, () => P.noteEvent(i, d.pitch, 0, false)));
      const b = h('div', { class: 'drk-pad' + (k === cur ? ' sel' : '') + (d.mute ? ' mut' : ''), role: 'button', 'aria-label': d.name },
        h('div', { class: 'drk-top' }, h('span', { class: 'drk-n' }, d.name), h('small', {}, noteName(d.pitch))),
        h('div', { class: 'drk-ms' }, sbtn('M', d.mute, (x) => { P.setPad(i, k, 'mute', !d.mute); x.classList.toggle('on', d.mute); b.classList.toggle('mut', d.mute); }), play, sbtn('S', d.solo, (x) => { P.setPad(i, k, 'solo', !d.solo); x.classList.toggle('on', d.solo); }, 'so')));
      const top = b.firstChild;
      top.addEventListener('pointerdown', (e) => { top.setPointerCapture(e.pointerId); b.classList.add('hit'); const was = cur; cur = k; padSel.set(t.id, k); cells.forEach((x, m) => x.classList.toggle('sel', m === k)); showSide(); P.noteEvent(i, d.pitch, 0.9, true); if (was !== k) setTimeout(render, 0); });
      const off = () => { b.classList.remove('hit'); P.noteEvent(i, d.pitch, 0, false); };
      top.addEventListener('pointerup', off); top.addEventListener('pointercancel', off);
      cells.push(b);
    }
    for (let r = 3; r >= 0; r--) for (let c = 0; c < 4; c++) pads.append(cells[r * 4 + c]);   // Live: the first pad is bottom left
    showSide();
    const chain = padChainView(i, cur, o.every || every);
    return h('div', { class: 'card drack drk' }, head, h('div', { class: 'drk-body' }, pads, side, chain.el));
  }
  if (def.view === 'soundfont') {
    const sf = t.inst.sf;
    const pick = h('button', { class: 'b', style: 'width:100%;margin:6px 0 4px', onclick: () => BR.openBrowser('file', { track: i, sf: true }) }, sf ? sf.path.split('/').pop() : 'Pilih file SoundFont (.sf2)\u2026');
    const pr = sf ? h('button', { class: 'b', style: 'width:100%;margin-bottom:6px', onclick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      menu(sf.presets.map((n, k) => ({ label: `${k + 1}. ${n}`, check: k === sf.preset, fn: () => P.setSfPreset(i, k) })), r.left, r.bottom);
    } }, `Preset: ${sf.presets[sf.preset] || '-'}`) : null;
    body.classList.add('wide');
    return h('div', { class: 'card', style: 'min-width:230px' }, head, h('div', { class: 'inst-row' }, h('div', { class: 'inst-side' }, pick, pr), body));
  }
  if (def.view === 'sampler' || def.view === 'sampler1') { body.classList.add('wide'); return h('div', { class: 'card' + (syn ? ' syn' : ''), style: syn ? '' : 'min-width:260px' }, head, h('div', { class: 'inst-row' }, h('div', { class: 'inst-side' }, zonePanel(i, t)), syn ? syn.el : body)); }
  return h('div', { class: 'card' + (syn ? ' syn' : '') }, head, syn ? syn.el : body);
}

// ---- live views live in fxviz.js (analyzer, loudness, EQ curves, dynamics meters, ...)
function duckSource(i, di, d) {
  const name = () => (d.params[0] < 1 ? 'Off' : (state.tracks[d.params[0] - 1] ? state.tracks[d.params[0] - 1].name : 'Track hilang'));
  const b = h('button', { class: 'b', style: 'width:100%;height:30px;margin:2px 0', onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const items = [{ label: 'Off', check: d.params[0] < 1, fn: () => { P.setDeviceParam(i, di, 0, 0); b.textContent = 'Sumber: Off'; } }];
    state.tracks.forEach((t, k) => { if (t.kind !== 'auto' && k !== i) items.push({ label: t.name, check: d.params[0] === k + 1, fn: () => { P.setDeviceParam(i, di, 0, k + 1); b.textContent = 'Sumber: ' + t.name; } }); });
    menu(items, r.left, r.bottom);
  } }, 'Sumber: ' + name());
  return b;
}

// Effect displays used to stack their buttons under the graph. Here the graph stays on the left and every button row / tab bar moves
// into a column to its right, so the card is wide instead of tall and fits the fixed Device height without hiding anything.
function sideLayout(el) {
  try {
    if (!(el.classList.contains('fv') || el.classList.contains('loud')) || el.classList.contains('fv-wide')) return;
    const kids = [...el.children];
    const isMain = (c) => c.tagName === 'CANVAS' || c.classList.contains('fv-ro') || c.classList.contains('ln-grid');
    const main = kids.filter(isMain), side = kids.filter((c) => !isMain(c));
    if (!side.length || !main.length) return;
    el.replaceChildren(h('div', { class: 'fv-main' }, main), h('div', { class: 'fv-side' }, side));
    el.classList.add('fv-wide');
  } catch (e) { console.error('sideLayout', e); }
}

// module menu helpers: effect picker, device clipboard (Copy / Paste module, Copy All / Paste All), rack preset picker
let devClip = null;
function fxPick(r, fn) { menu(FX_GROUPS.flatMap(([, label, ks]) => [{ label: label.toUpperCase(), dim: true }, ...ks.filter((k) => DEVICES[k]).map((k) => ({ label: DEVICES[k].name, fn: () => fn(k) }))]), Math.max(8, r.left - 40), Math.max(8, r.top - 120)); }
const report = (x) => { if (x && x.skipped && x.skipped.length) toast(`${x.added} modul ditempel; ${x.skipped.length} dilewati: ${x.skipped.join(', ')}.`, 4000); else if (x) toast(x.added + ' modul ditempel.', 1200); };
function pasteDevs(i, at) { if (!devClip) return; report(P.insertDeviceCopies(i, at, devClip)); }
function presetPick(r, i, mode, at) {
  const L = PRS.rackPresets();
  if (!L.length) return toast('Belum ada rack preset. Simpan dulu lewat menu + (Simpan rantai) atau menu modul.', 3500);
  menu([{ label: mode === 'replace' ? 'MUAT (GANTI RANTAI)' : 'SISIPKAN', dim: true }, ...L.map((p) => ({ label: `${p.name} (${p.n} modul${p.inst ? ' + instrumen' : ''})`, fn: () => { const x = PRS.applyRackPreset(p.path, i, mode, at); toast(x.error || x.msg, 3500); } }))], Math.max(8, r.left - 40), Math.max(8, r.top - 60));
}

function fxCard(i, d, di, n, o = {}) {
  const def = DEVICES[d.type];
  const pw = h('button', { class: 'pw' + (d.bypass ? '' : ' on'), 'aria-label': 'Bypass', onclick: () => P.toggleBypass(i, di) });
  // device menu (Live: the title bar's context menu): float, fold, move left / right, delete
  const more = h('button', { class: 'dv-more', 'aria-label': 'Menu device', onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const full = (P.tr(i) || { devices: [] }).devices.length >= 16;
    menu([
      ...(o.floating ? [] : [{ label: 'Buka di jendela mengambang', fn: () => openDeviceWindow(d.id) }, { label: 'Lipat', fn: () => setFolded(d.id, true) }, { sep: true }]),
      { label: 'Geser ke kiri', dim: di <= 0, fn: () => { if (di > 0) P.moveDevice(i, di, di - 1); } },
      { label: 'Geser ke kanan', dim: di >= n - 1, fn: () => { if (di < n - 1) P.moveDevice(i, di, di + 1); } },
      { label: 'Sisip efek di kiri\u2026', dim: full, fn: () => fxPick(r, (ty) => P.insertDeviceAt(i, di, ty)) },
      { label: 'Sisip efek di kanan\u2026', dim: full, fn: () => fxPick(r, (ty) => P.insertDeviceAt(i, di + 1, ty)) },
      { label: 'Ganti dengan\u2026', fn: () => fxPick(r, (ty) => P.replaceDevice(i, di, ty)) },
      { sep: true },
      { label: 'Copy modul', fn: () => { devClip = P.devicesSnapshot(i, di, di + 1); toast(def.name + ' disalin.', 1200); } },
      { label: 'Paste di kanan', dim: !devClip || full, fn: () => pasteDevs(i, di + 1) },
      { label: 'Reset parameter', fn: () => { P.resetDevice(i, di); toast(def.name + ': parameter kembali ke awal.', 1400); } },
      { label: 'Simpan modul sebagai preset\u2026', fn: () => ask('Nama preset', def.name, (nm) => { const x = PRS.saveRackPreset(i, nm, di, di + 1); toast(x.error || 'Preset tersimpan di Presets/Racks.'); }) },
      { label: 'Sisip preset di kanan\u2026', dim: full, fn: () => presetPick(r, i, 'insert', di + 1) },
      { sep: true },
      { label: d.bypass ? 'Aktifkan' : 'Bypass', fn: () => P.toggleBypass(i, di) },
      { label: 'Hapus device', fn: () => P.removeDevice(i, di) },
    ], r.left - 120, r.bottom);
  } }, '\u22EF');
  const dname = d.missing ? '[Tidak tersedia] ' + d.missing.name : def.name;
  if (!o.floating && FW.isOpen('d:' + d.id)) return floatedCard('d:' + d.id, dname, () => openDeviceWindow(d.id));
  if (!o.floating && isFolded(d.id)) { const c = foldedCard(d.id, dname, pw); if (d.bypass) c.classList.add('off'); return c; }

  let view = null;
  const ids = () => new Set((P.tr(i) || { devices: [] }).devices.map((x) => String(x.id)));   // the chain's effect cards (dataset keys are strings)
  const grip = (hd) => (o.floating || o.nested || n < 2 ? hd : reorderGrip(hd, { index: di, siblings: (card) => { const k = ids(); return [...card.parentElement.children].filter((el) => k.has(el.dataset.k)); }, move: (to) => P.moveDevice(i, di, to) }));
  if (d.missing) {                                     // imported plugin MDAW does not have: a named placeholder (neutral, audio passes through)
    const x = d.missing, hd = grip(titleFold(h('h4', {}, pw, h('span', {}, '[Plugin tidak tersedia] ' + x.name), more), d.id));
    return h('div', { class: 'card dv-missing' + (d.bypass ? ' off' : '') }, hd, h('div', { class: 'dvm-b' },
      h('b', {}, x.name), h('span', {}, 'dari ' + (x.app || 'proyek impor') + (x.preset ? ' \u2022 preset ' + x.preset : '')),
      h('span', {}, (x.params && x.params.length ? x.params.length + ' nilai parameter asli disimpan. ' : '') + 'Plugin ini tidak ada di MDAW: audio diteruskan tanpa diproses. Ganti dengan efek MDAW lewat menu \u22EF \u2192 Ganti dengan.')));
  }
  const knobsDiv = h('div', { class: 'knobs side' });
  const ctx = { i, di, d, def, every: o.every || every, set: (k, v) => P.setDeviceParam(i, di, k, v), refreshKnobs: () => { for (const c of knobsDiv.children) if (c.update) c.update(); } };
  if (def.kit) {                                                                   // Live 12 panel (js/fxkit.js): the panel lays out every control itself
    let kv = null; try { kv = kitView(ctx); } catch (e) { console.error('fxkit', e); }
    if (kv) return h('div', { class: 'card lkcard' + (d.bypass ? ' off' : '') }, grip(titleFold(h('h4', {}, pw, h('span', {}, def.name), o.floating ? null : popBtn(() => openDeviceWindow(d.id)), more, o.floating ? null : foldBtn(d.id, false)), d.id)), kv.el);
  }
  if (VIEWS[d.type]) { try { view = VIEWS[d.type](ctx); } catch (e) { console.error('fxviz', e); view = null; } }
  // knobs sit beside the display and flow in columns (the number of rows follows the panel height), so a half-height panel needs no scrolling
  // a device may list its knobs band by band (sideOrder, -1 = empty cell) so each column reads Freq / Gain / Q like Live's EQ
  if (def.sideRows) knobsDiv.style.setProperty('--kr', String(def.sideRows));
  if (def.sideRows >= 3) knobsDiv.classList.add('r3');                                // v65: three knob rows must fit the 212 px Device panel: tighter rows
  (def.sideOrder || def.params.map((_, k) => k)).forEach((k) => {
    if (k < 0) { knobsDiv.append(h('div', { class: 'k-sp', 'aria-hidden': 'true' })); return; }
    const p = def.params[k];
    if (p.hidden) return;
    if (p.fmt === 'src') { knobsDiv.append(duckSource(i, di, d)); return; }
    knobsDiv.append(knob(p, () => d.params[k], (v) => {
      P.setDeviceParam(i, di, k, v);
      if (view && view.draw) view.draw();
    }, fmtParam, C('#7ac5ff'), (rect) => offerAutomation(rect, { kind: 4, strip: P.stripOf(i), devId: d.id, param: k, def: p }, `${stripName(i)} \u2022 ${def.name} ${p.n}`)));
  });
  if (view && view.el) sideLayout(view.el);
  const body = view ? h('div', { class: 'fxv' }, view.el, knobsDiv.children.length ? knobsDiv : null) : knobsDiv;
  return h('div', { class: 'card' + (d.bypass ? ' off' : '') }, grip(titleFold(h('h4', {}, pw, h('span', {}, def.name), o.floating ? null : popBtn(() => openDeviceWindow(d.id)), more, o.floating ? null : foldBtn(d.id, false)), d.id)), body);
}

// Device chain of the selected strip. A re-render of the same strip keeps the scroll position, and cards that moved (reorder, fold,
// delete) glide to their new place while new ones fade in (FLIP); switching to another strip crossfades the chain.
let lastStrip = null;
const dur = (ms) => Math.round(ms * Math.max(0, prefs.animScale ?? 1));
const quiet = () => prefs.reduceMotion || !(prefs.animScale > 0) || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
function flip(scroll, before) {
  if (!before.size || quiet()) return;
  const ease = 'cubic-bezier(.2,.8,.2,1)';
  for (const el of scroll.children) {
    const k = el.dataset.k; if (!k) continue;
    const x0 = before.get(k), x1 = el.getBoundingClientRect().left;
    if (x0 === undefined) el.animate([{ opacity: 0, transform: 'translateY(6px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: dur(220), easing: ease });
    else if (Math.abs(x0 - x1) > 1) el.animate([{ transform: `translateX(${x0 - x1}px)` }, { transform: 'none' }], { duration: dur(240), easing: ease });
  }
}
export function render() {
  if (!root) return;
  for (const t of timers) clearInterval(t);
  timers = [];
  const i = state.sel.track, t = P.tr(i);
  const old = root.firstElementChild && root.firstElementChild.classList.contains('dev-scroll') ? root.firstElementChild : null;
  const same = old && lastStrip === i && t, sl = same ? old.scrollLeft : 0, before = new Map();
  if (same) for (const el of old.children) if (el.dataset.k) before.set(el.dataset.k, el.getBoundingClientRect().left);
  const scroll = h('div', { class: 'dev-scroll' });
  scroll.style.setProperty('--sc', root.clientWidth >= 1150 ? '3' : '2');   // synth panels per row
  const put = (el, k) => { el.dataset.k = k; scroll.append(el); };
  lastStrip = i;
  if (!t) { scroll.append(h('div', { class: 'hint' }, 'Tambahkan track lewat tombol + di arrangement.')); root.replaceChildren(scroll); return; }
  if (t.kind === 'auto') {
    scroll.append(h('div', { class: 'hint' }, 'Ini track otomasi untuk ', h('b', {}, P.autoLabel(t)), '. Ketuk-ganda klipnya untuk mengedit titik.'));
    root.replaceChildren(scroll); return;
  }
  if (i < MASTER && t.inst) put(instCard(i, t), 'i' + t.id);
  else if (i < MASTER) put(h('div', { class: 'card dev-src' }, h('h4', {}, h('i', { class: 'pdot' }), h('span', {}, 'Audio')), h('div', { class: 'dev-src-b' }, h('b', {}, 'Klip audio'), 'diputar lalu lewat rantai efek di kanan')), 'src');
  t.devices.forEach((d, di) => put(fxCard(i, d, di, t.devices.length), d.id));
  const full = t.devices.length >= 16;
  const add = h('button', { class: 'card addcard dev-drop b', 'aria-label': 'Tambah efek', onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect(), n = t.devices.length;
    menu([
      { label: 'RACK PRESET', dim: true },
      { label: 'Simpan rantai sebagai Rack Preset\u2026', dim: !n && !(t.inst && t.kind === 'midi'), fn: () => ask('Nama rack preset', '', (nm) => { const x = PRS.saveRackPreset(i, nm); toast(x.error || `Rack preset tersimpan (${x.n} modul${t.inst && t.kind === 'midi' ? ' + instrumen' : ''}).`); }) },
      { label: 'Muat Rack Preset (ganti rantai)\u2026', fn: () => presetPick(r, i, 'replace', 0) },
      { label: 'Sisip Rack Preset di akhir\u2026', dim: full, fn: () => presetPick(r, i, 'insert', n) },
      { label: 'Copy semua modul', dim: !n, fn: () => { devClip = P.devicesSnapshot(i); toast(n + ' modul disalin.', 1200); } },
      { label: 'Paste semua (ganti rantai)\u2026', dim: !devClip, fn: () => modal('Ganti rantai efek?', `${n} modul di rantai ini diganti dengan ${devClip.length} modul yang disalin. Bisa dibatalkan dengan Urungkan.`, [{ label: 'Batal' }, { label: 'Ganti', go: true, fn: () => { const x = P.replaceChain(i, devClip); report(x); } }]) },
      { label: 'Paste di akhir', dim: !devClip || full, fn: () => pasteDevs(i, n) },
      ...(full ? [{ label: 'Rantai penuh (16 efek)', dim: true }] : FX_GROUPS.flatMap(([, label, ks]) => [{ label: label.toUpperCase(), dim: true }, ...ks.filter((k) => DEVICES[k]).map((k) => ({ label: DEVICES[k].name, fn: () => P.addDevice(i, k) }))])),
    ], Math.max(8, r.left - 40), Math.max(8, r.top - 120));
  } }, h('b', { 'aria-hidden': 'true' }, '+'), h('span', {}, full ? 'Rantai penuh (16 efek)' : 'Ketuk untuk menambah efek'), h('small', {}, 'atau seret efek dari Browser ke sini'));
  put(add, 'add');
  root.replaceChildren(scroll);
  if (same) { scroll.scrollLeft = sl; flip(scroll, before); }
  else if (old && !quiet()) scroll.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: dur(170), easing: 'ease-out' });
  const title = document.getElementById('dtitle');
  if (title) title.textContent = stripName(i);
}

export function initDevices(container) {
  root = container;
  const rows = () => { const hh = root.clientHeight; if (hh > 0) root.style.setProperty('--kr', String(Math.max(1, Math.min(5, Math.floor((hh - 24 - 16) / 68))))); };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(rows).observe(root); rows();
  P.onChange((w) => { if (['devices', 'tracks', 'all', 'sel'].includes(w) && root.isConnected && root.dataset.active === '1') render(); });
  P.onChange((w) => { if (['devices', 'tracks', 'all'].includes(w)) FW.refreshAll(); });          // open windows follow undo / redo / structure changes
  FW.onFloatChange(() => { if (root.isConnected && root.dataset.active === '1') render(); });
}
