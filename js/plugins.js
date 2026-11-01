// Plugin host (docs/PLUGIN-SDK.md). A MobileDAW plugin is one ES module (.js) in the library folder /Plugins that exports
//   export const manifest = { id, name, version, api: 1, kind: 'effect', params: [...], presets?: [...] }
//   export default class { constructor(sampleRate, ctx) ... process(L, R, n) ... }
// Loading: the module is validated here (manifest, class), registered for the main thread (offline export uses the Engine class there) and
// added to the AudioWorklet scope (the real-time engine), both in globalThis.__mdawPlugins (device type -> module). The device type is
// PLUGIN_BASE + a slot given out per plugin id for this session; projects store { id, version } and are mapped back on load (a plugin that
// is not installed becomes a pass-through placeholder that keeps its parameter values, so nothing is lost).
// The native (C++) engine cannot run JS plugins: projects that use one play on the Web engine (automatic fallback).
import { DEVICES, FX_GROUPS } from './defs.js';
import { eng } from './engine.js';
import { log } from './log.js';

export const PLUGIN_BASE = 1000, PLUGIN_DIR = '/Plugins', PLUGIN_API = 1;
export const plugins = new Map();            // id -> { id, type, manifest, path, error, missing }
const byType = new Map();
let nextSlot = 0;
const reg = () => (globalThis.__mdawPlugins = globalThis.__mdawPlugins || new Map());
const typeFor = (id) => { const p = plugins.get(id); if (p) return p.type; const t = PLUGIN_BASE + nextSlot++; return t; };

// manifest check: returns an error text or '' (every rule is in docs/PLUGIN-SDK.md)
export function validateManifest(m) {
  if (!m || typeof m !== 'object') return 'tidak ada `export const manifest`';
  if (m.api !== PLUGIN_API) return `api ${m.api} tidak didukung (host: ${PLUGIN_API})`;
  if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(m.id)) return 'id tidak valid (huruf/angka/.-_, 3..64 karakter)';
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 40) return 'name wajib (maks 40 karakter)';
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+/.test(m.version)) return 'version harus semver (mis. 1.0.0)';
  if (m.kind !== 'effect') return 'kind harus "effect" (instrumen plugin belum didukung)';
  if (!Array.isArray(m.params) || m.params.length > 64) return 'params harus array (maks 64)';
  for (const [k, p] of m.params.entries()) {
    if (!p || typeof p.name !== 'string') return `params[${k}]: name wajib`;
    if (!(Number.isFinite(p.min) && Number.isFinite(p.max) && p.max > p.min)) return `params[${k}]: min < max wajib`;
    if (!(Number.isFinite(p.def) && p.def >= p.min && p.def <= p.max)) return `params[${k}]: def harus di antara min dan max`;
    if (p.curve === 'log' && !(p.min > 0)) return `params[${k}]: curve log butuh min > 0`;
  }
  if (m.presets !== undefined && (!Array.isArray(m.presets) || m.presets.some((q) => !q || typeof q.name !== 'string' || !Array.isArray(q.params)))) return 'presets: [{ name, params: [...] }]';
  return '';
}
const toParams = (m) => m.params.map((p) => ({ n: p.name.slice(0, 16), min: p.min, max: p.max, def: p.def, ...(p.unit ? { unit: String(p.unit).slice(0, 6) } : {}), ...(p.curve === 'log' ? { curve: 'log' } : {}), ...(p.step ? { step: p.step } : {}), ...(p.toggle ? { step: 1, fmt: 'onoff' } : {}) }));
function addToBrowser(type) {
  let g = FX_GROUPS.find((x) => x[0] === 'plug');
  if (!g) { g = ['plug', 'Plugin', []]; FX_GROUPS.push(g); }
  if (!g[2].includes(type)) g[2].push(type);
}

// load one plugin from its source text; returns { ok, id, name } or { error }
export async function loadPluginSource(text, path = '') {
  let url = '', M;
  try { url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' })); M = await import(/* @vite-ignore */ url); }
  catch (e) { return { error: 'modul tidak bisa dimuat: ' + (e && e.message || e) }; }
  const err = validateManifest(M.manifest) || (typeof M.default !== 'function' ? 'tidak ada `export default class`' : '') || (typeof (M.default.prototype || {}).process !== 'function' ? 'kelas plugin tidak punya process(L, R, n)' : '');
  if (err) return { error: err };
  try { const probe = new M.default(48000, { sidechain: new Float32Array(80), api: PLUGIN_API }); const L = new Float32Array(128), R = new Float32Array(128); probe.process(L, R, 128); }   // constructed and run once here: a broken plugin never reaches the audio thread
  catch (e) { return { error: 'plugin gagal saat diuji: ' + (e && e.message || e) }; }
  const m = M.manifest, old = plugins.get(m.id);
  if (old && !old.missing && old.manifest.version !== m.version) log('warn', `plugin ${m.id}: versi ${old.manifest.version} diganti ${m.version}`);
  const type = typeFor(m.id);
  reg().set(type, M);
  try { if (eng.loadPluginModule) await eng.loadPluginModule(type, url); }
  catch (e) { reg().delete(type); return { error: 'AudioWorklet menolak plugin: ' + (e && e.message || e) }; }
  DEVICES[type] = { name: m.name, params: toParams(m), plugin: { id: m.id, version: m.version }, presets: m.presets || null };
  const info = { id: m.id, type, manifest: m, path, error: '', missing: false };
  plugins.set(m.id, info); byType.set(type, info); addToBrowser(type);
  log('info', `plugin dimuat: ${m.name} ${m.version} (${m.id})`);
  return { ok: true, id: m.id, name: m.name, type };
}
// every .js in /Plugins of the library (app start, before the project is restored)
export async function loadInstalledPlugins() {
  const d = eng.listDir ? eng.listDir(PLUGIN_DIR) : null, out = [];
  for (const it of (d && d.items) || []) {
    if (it.dir || !/\.m?js$/i.test(it.name)) continue;
    const path = PLUGIN_DIR + '/' + it.name;
    try {
      const b = await eng.readBytes(path); if (!b) continue;
      const r = await loadPluginSource(new TextDecoder().decode(b), path);
      if (r.error) log('warn', `plugin ${it.name}: ${r.error}`);
      out.push({ path, ...r });
    } catch (e) { log('warn', `plugin ${it.name}: ${e && e.message || e}`); }
  }
  return out;
}
// install a plugin file chosen by the user: checked first, then saved to /Plugins
export async function installPlugin(name, text) {
  const r = await loadPluginSource(text, PLUGIN_DIR + '/' + name);
  if (r.error) return r;
  await eng.saveBytes(PLUGIN_DIR + '/' + name.replace(/[\\/:*?"<>|]+/g, '_'), new TextEncoder().encode(text).buffer);
  return r;
}
// project load: device objects that carry { plugin: { id, version } } get this session's type; a plugin that is not installed becomes a placeholder
export function resolvePluginDevice(d) {
  if (!d || !d.plugin || !d.plugin.id) return;
  let p = plugins.get(d.plugin.id);
  if (!p) {
    const type = typeFor(d.plugin.id), params = (d.params || []).map((v, k) => ({ n: 'Param ' + (k + 1), min: Math.min(0, v), max: Math.max(1, v), def: v }));
    DEVICES[type] = { name: (d.plugin.name || d.plugin.id) + ' (plugin tidak ada)', params, plugin: { ...d.plugin, missing: true } };
    p = { id: d.plugin.id, type, manifest: null, path: '', error: 'tidak terpasang', missing: true }; plugins.set(d.plugin.id, p); byType.set(type, p);
    log('warn', `plugin ${d.plugin.id} ${d.plugin.version || ''} tidak terpasang: device dipertahankan sebagai placeholder (tanpa suara)`);
  } else if (p.manifest && d.plugin.version && p.manifest.version.split('.')[0] !== String(d.plugin.version).split('.')[0]) {
    log('warn', `plugin ${d.plugin.id}: proyek dibuat dengan versi ${d.plugin.version}, terpasang ${p.manifest.version} (versi mayor berbeda)`);
  }
  d.type = p.type;
}
export const pluginInfo = (type) => byType.get(type) || null;
