// User presets stored as .json files in the MobileDAW folder:  Presets/Instruments  and  Presets/Mixer.
//   instrument preset = synth type + its knob values + pitch
//   mixer preset      = volume, pan, sends and the whole effect chain (devices with their settings) of one track
import { eng } from './engine.js';
import { INSTRUMENTS, DEVICES, FLM_FMT, migrateFlmParams } from './defs.js';
import * as P from './project.js';
import { log } from './log.js';

export const DIR_INST = '/Presets/Instruments', DIR_MIX = '/Presets/Mixer', DIR_RACK = '/Presets/Racks', DIR_KIT = '/Presets/Kits';
const clean = (n) => (n || '').trim().replace(/[\\/:*?"<>|]+/g, '').slice(0, 60);
const num = (v, d) => (Number.isFinite(+v) ? +v : d);

export function saveInstrumentPreset(i, name) {
  const t = P.state.tracks[i]; name = clean(name);
  if (!t || !t.inst || t.kind !== 'midi') return { error: 'Pilih track synth dulu.' };
  if (!name) return { error: 'Nama kosong.' };
  const def = INSTRUMENTS[t.inst.type];
  const p = def.params.map((q, k) => num(t.inst.params[k], q.def));
  const path = `${DIR_INST}/${def.name} - ${name}.json`;
  eng.writeText(path, JSON.stringify({ app: 'mobiledaw', kind: 'instrument', type: t.inst.type, inst: def.name, name, p, pitch: t.inst.pitch || 0, flm: FLM_FMT }));
  log('info', 'preset instrumen disimpan', path);
  return { path };
}
export function saveMixerPreset(i, name) {
  const t = P.tr(i); name = clean(name);
  if (!t) return { error: 'Pilih track dulu.' };
  if (!name) return { error: 'Nama kosong.' };
  const path = `${DIR_MIX}/${name}.json`;
  eng.writeText(path, JSON.stringify({ app: 'mobiledaw', kind: 'mixer', name, vol: num(t.vol, 1), pan: num(t.pan, 0), send: (t.send || [0, 0]).map((v) => num(v, 0)),
    devices: t.devices.map((d) => ({ type: d.type, params: d.params.slice(), bypass: !!d.bypass })) }));
  log('info', 'preset mixer disimpan', path);
  return { path };
}
function read(path) {
  try { const o = JSON.parse(eng.readText(path)); return o && o.app === 'mobiledaw' ? flmUp(o) : null; } catch (_) { return null; }
}
// presets saved before the FL Studio Mobile manual corrections: GMS / MiniSynth / SuperSaw values -> the current format (defs.js)
function flmUp(o) {
  if (o.flm >= FLM_FMT) return o;
  if (o.kind === 'instrument' && Array.isArray(o.p)) migrateFlmParams(o.type, o.p);
  if (o.kind === 'rack' && o.inst && Array.isArray(o.inst.p)) migrateFlmParams(o.inst.type, o.inst.p);
  o.flm = FLM_FMT;
  return o;
}
export const readPreset = read;   // parsed preset file or null (used by the browser to list / audition presets)
// Apply a preset file to a track. Returns { ok, msg } or { error }.
export function applyPresetFile(path, i) { return P.HK.group(() => applyPresetFileInner(path, i)); }   // one undo step per preset
function applyPresetFileInner(path, i) {
  const o = read(path), t = P.state.tracks[i];
  if (!o) return { error: 'File preset rusak atau bukan preset MobileDAW.' };
  if (!t) return { error: 'Pilih track dulu.' };
  try {
    if (o.kind === 'instrument') {
      if (t.kind !== 'midi') return { error: 'Preset instrumen hanya untuk track synth (MIDI).' };
      if (!INSTRUMENTS[o.type]) return { error: 'Instrumen preset ini tidak ada di versi ini.' };
      if (t.inst.type !== o.type) P.setInstrument(i, o.type);
      const def = INSTRUMENTS[o.type];
      def.params.forEach((q, k) => P.setInstParam(i, k, Math.min(q.max, Math.max(q.min, num(o.p && o.p[k], q.def)))));
      P.setPitch(i, num(o.pitch, 0));
      P.emit('devices');
      return { ok: true, msg: `Preset "${o.name}" dipasang.` };
    }
    if (o.kind === 'mixer') {
      P.setVol(i, Math.min(2, Math.max(0, num(o.vol, 1)))); P.setPan(i, Math.min(1, Math.max(-1, num(o.pan, 0))));
      (o.send || []).slice(0, 2).forEach((v, k) => P.setSend(i, k, Math.min(1, Math.max(0, num(v, 0)))));
      while (t.devices.length) P.removeDevice(i, t.devices.length - 1);
      for (const d of (o.devices || []).slice(0, 16)) {
        const def = DEVICES[d.type]; if (!def) continue;
        P.addDevice(i, d.type);
        const di = t.devices.length - 1;
        def.params.forEach((q, k) => P.setDeviceParam(i, di, k, Math.min(q.max, Math.max(q.min, num(d.params && d.params[k], q.def)))));
        if (d.bypass) P.toggleBypass(i, di);
      }
      P.emit('devices'); P.emit('mix');
      return { ok: true, msg: `Preset mixer "${o.name}" dipasang.` };
    }
  } catch (e) { log('error', 'applyPresetFile', path, e); return { error: 'Gagal memasang preset: ' + ((e && e.message) || e) }; }
  return { error: 'Jenis preset tidak dikenal.' };
}
// presets of one instrument type, for the Preset menu in the Device tab
export function userInstrumentPresets(type) {
  const d = eng.listDir(DIR_INST), out = [];
  for (const it of (d && d.items) || []) {
    if (!/\.json$/i.test(it.name)) continue;
    const o = read(DIR_INST + '/' + it.name);
    if (o && o.kind === 'instrument' && o.type === type) out.push({ name: o.name || it.name.replace(/\.json$/i, ''), path: DIR_INST + '/' + it.name });
  }
  return out;
}

// Rack presets (FL Studio Mobile Rack Preset): the effect chain of a track (all modules with every setting, racks with their chains and
// macros) and, for a synth track, its instrument. Load = replace the chain; Insert = put the modules at a position in the current chain.
export function saveRackPreset(i, name, from = 0, to = Infinity) {
  const t = P.tr(i); name = clean(name);
  if (!t) return { error: 'Pilih track dulu.' };
  if (!name) return { error: 'Nama kosong.' };
  const devices = P.devicesSnapshot(i, from, to).map((d) => ({ ...d, name: (DEVICES[d.type] || {}).name }));
  const inst = from === 0 && to === Infinity && t.inst && t.kind === 'midi' ? { type: t.inst.type, name: INSTRUMENTS[t.inst.type].name, p: INSTRUMENTS[t.inst.type].params.map((q, k) => num(t.inst.params[k], q.def)), pitch: t.inst.pitch || 0 } : null;
  const path = `${DIR_RACK}/${name}.json`;
  eng.writeText(path, JSON.stringify({ app: 'mobiledaw', kind: 'rack', name, devices, inst, flm: FLM_FMT }));
  return { path, n: devices.length };
}
export function rackPresets() {
  const d = eng.listDir(DIR_RACK), out = [];
  for (const it of (d && d.items) || []) { if (!/\.json$/i.test(it.name)) continue; const o = read(DIR_RACK + '/' + it.name); if (o && o.kind === 'rack') out.push({ name: o.name || it.name.replace(/\.json$/i, ''), path: DIR_RACK + '/' + it.name, n: (o.devices || []).length, inst: !!o.inst }); }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
// mode 'replace' (Load Rack Preset) or 'insert' at position `at`. Returns { msg } or { error }.
export function applyRackPreset(path, i, mode = 'replace', at = 0) {
  const o = read(path), t = P.tr(i);
  if (!o || o.kind !== 'rack') return { error: 'File rack preset rusak.' };
  if (!t) return { error: 'Pilih track dulu.' };
  let r = null;
  P.HK.group(() => {
    if (mode === 'replace' && o.inst && t.kind === 'midi' && INSTRUMENTS[o.inst.type]) {
      if (t.inst.type !== o.inst.type) P.setInstrument(i, o.inst.type);
      INSTRUMENTS[o.inst.type].params.forEach((q, k) => P.setInstParam(i, k, Math.min(q.max, Math.max(q.min, num(o.inst.p && o.inst.p[k], q.def)))));
      P.setPitch(i, num(o.inst.pitch, 0));
    }
    r = mode === 'replace' ? P.replaceChain(i, o.devices || []) : P.insertDeviceCopies(i, at, o.devices || []);
  });
  P.emit('devices');
  const miss = r.skipped.length ? ` ${r.skipped.length} modul dilewati (tidak dikenal / rantai penuh): ${r.skipped.join(', ')}.` : '';
  return { msg: `Rack preset "${o.name}": ${r.added} modul${mode === 'replace' ? ' (rantai diganti)' : ' disisipkan'}.${miss}` };
}

// Drum kits (FL Studio Mobile "Save Template" / "My Drumsets"): the pads of a drum track with every setting (level, pan, pitch, decay, start / end,
// reverse, ADSR, cut group, poly, hold, shift, mute) and the sample FILE of each pad (path + name); the audio itself stays in the sample folder.
// Pads that hold an instrument chain are not saved (they need that instrument's full state). Loading is one undo step.
export function saveKit(i, name) {
  const t = P.tr(i); name = clean(name);
  if (!t || t.kind !== 'drum') return { error: 'Pilih track drum dulu.' };
  if (!name) return { error: 'Nama kosong.' };
  const all = P.padsOf(i), pads = [];
  for (const q of all) {
    if (q.chain && q.chain.inst) continue;
    const { sample, chain, solo, ...rest } = q;
    pads.push({ ...rest, sample: sample ? { path: sample.path, name: sample.name } : null });
  }
  if (!pads.length) return { error: 'Tidak ada pad yang bisa disimpan.' };
  const path = `${DIR_KIT}/${name}.json`;
  eng.writeText(path, JSON.stringify({ app: 'mobiledaw', kind: 'kit', name, pads }));
  log('info', 'kit drum disimpan', path);
  return { path, n: pads.length, skipped: all.length - pads.length };
}
export function kitList() {
  const d = eng.listDir(DIR_KIT), out = [];
  for (const it of (d && d.items) || []) {
    if (!/\.json$/i.test(it.name)) continue;
    const o = read(DIR_KIT + '/' + it.name);
    if (o && o.kind === 'kit' && Array.isArray(o.pads)) out.push({ name: o.name || it.name.replace(/\.json$/i, ''), path: DIR_KIT + '/' + it.name, n: o.pads.length });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
export async function applyKit(path, i) {
  const o = read(path), t = P.tr(i);
  if (!o || o.kind !== 'kit' || !Array.isArray(o.pads)) return { error: 'File kit drum rusak.' };
  if (!t || t.kind !== 'drum') return { error: 'Pilih track drum dulu.' };
  const list = []; let missing = 0;
  for (const q of o.pads.slice(0, P.MAX_PADS)) {
    if (!q || !Number.isFinite(q.pitch)) continue;
    let sample = null;
    if (q.sample && q.sample.path) { sample = await P.loadSampleObj(q.sample.path); if (!sample) missing++; }
    list.push({ ...q, sample, solo: false, kind: q.sample ? -1 : q.kind });   // a sample pad has no built-in sound (kind -1); a missing file leaves it silent
  }
  if (!list.length) return { error: 'Kit ini kosong.' };
  P.setPadKit(i, list);
  return { msg: `Kit "${o.name}": ${list.length} pad dimuat.` + (missing ? ` ${missing} sample tidak ditemukan (pad itu diam).` : ''), missing };
}
