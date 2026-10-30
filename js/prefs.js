// User preferences, kept in localStorage (survive reloads, work offline).
const KEY = 'mobiledaw.prefs.v1';
const VERSION = 2;
const DEFAULTS = { v: VERSION, snap: 0, follow: true, latencyMs: 0, midiOn: false, midiDevice: 'any', fullscreen: true, theme: 'dark', uiScale: 0.8, latencyHint: 'interactive', sampleRate: 0, exportBits: 16, exportFmt: 'wav', exportKbps: 192, exportTail: 3, exportNorm: false, exportRange: 'all', exportStems: false, exportRet: true, exportMaster: false, logLevel: 1, showCpu: true, showFps: true, fpsMode: 'auto', reduceMotion: false, animScale: 1, keepAwake: false, folderAsked: false, edgeGuard: 1, metroVol: 1 };
let data = { ...DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  Object.assign(data, saved);
  if (saved.v !== VERSION) { data.fullscreen = true; data.uiScale = 0.8; data.v = VERSION; }   // v2: fullscreen on by default, UI scale 80%, margin settings removed
} catch (_) { /* private mode or corrupt value: use defaults */ }
for (const k of ['cover', 'padL', 'padR', 'padT', 'padB']) delete data[k];
export const prefs = data;
export function savePrefs() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) { /* storage full or blocked */ } }
export function resetPrefs() { Object.assign(data, DEFAULTS); savePrefs(); }
export const DEFAULT_PREFS = DEFAULTS;
