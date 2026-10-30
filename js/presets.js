// User presets stored as .json files in the MobileDAW folder:  Presets/Instruments  and  Presets/Mixer.
//   instrument preset = synth type + its knob values + pitch
//   mixer preset      = volume, pan, sends and the whole effect chain (devices with their settings) of one track
import { eng } from './engine.js';
import { INSTRUMENTS, DEVICES } from './defs.js';
import * as P from './project.js';
import { log } from './log.js';

export const DIR_INST = '/Presets/Instruments', DIR_MIX = '/Presets/Mixer';
const clean = (n) => (n || '').trim().replace(/[\\/:*?"<>|]+/g, '').slice(0, 60);
const num = (v, d) => (Number.isFinite(+v) ? +v : d);

export function saveInstrumentPreset(i, name) {
  const t = P.state.tracks[i]; name = clean(name);
  if (!t || !t.inst || t.kind !== 'midi') return { error: 'Pilih track synth dulu.' };
  if (!name) return { error: 'Nama kosong.' };
  const def = INSTRUMENTS[t.inst.type];
  const p = def.params.map((q, k) => num(t.inst.params[k], q.def));
  const path = `${DIR_INST}/${def.name} - ${name}.json`;
  eng.writeText(path, JSON.stringify({ app: 'mobiledaw', kind: 'instrument', type: t.inst.type, inst: def.name, name, p, pitch: t.inst.pitch || 0 }));
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
  try { const o = JSON.parse(eng.readText(path)); return o && o.app === 'mobiledaw' ? o : null; } catch (_) { return null; }
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
