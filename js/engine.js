// Backends of the `eng` interface (everything the UI needs from an audio engine):
//   native : the Android app (C++ engine through the WebView bridge)
//   web    : AudioWorklet engine in the browser (PWA, works offline, no server needed)
//   mock   : browsers without AudioWorklet - the transport advances but there is no sound
import { createWebBackend } from './engine/web.js';

const N = typeof window !== 'undefined' ? window.NativeDaw : undefined;
export const hasNative = !!N;
export const MASTER = 64, RET0 = 65;   // strips: 0-63 tracks, 64 master, 65/66 return A/B
const canWeb = !N && typeof AudioWorkletNode !== 'undefined' && typeof AudioContext !== 'undefined';
export const backend = N ? 'native' : canWeb ? 'web' : 'mock';
export const hooks = { replay: null };   // set by project.js: pushes the whole project into `eng` (used for offline WAV export)

const mock = { playing: false, pos: 0, bpm: 120, last: 0, loop: { on: false, s: 0, e: 3840 } };
function mockCall(name, a) {
  switch (name) {
    case 'start': return 48000;
    case 'play': mock.playing = true; mock.last = Date.now(); return null;
    case 'stop': mock.playing = false; return null;
    case 'seek': mock.pos = a[0]; return null;
    case 'tempo': mock.bpm = a[0]; return null;
    case 'loop': mock.loop = { on: a[0], s: a[1], e: a[2] }; return null;
    case 'poll': {
      const now = Date.now();
      if (mock.playing) {
        mock.pos += (now - mock.last) / 1000 * mock.bpm / 60 * 960;
        if (mock.loop.on && mock.pos >= mock.loop.e) mock.pos = mock.loop.s + (mock.pos - mock.loop.e);
      }
      mock.last = now;
      return { pos: mock.pos, playing: mock.playing, cpu: 0, m: new Array(146).fill(0) };
    }
    case 'devOut': return [];
    case 'home': return '';
    case 'hasStorage': return false;
    case 'listDir': return { path: a[0], parent: '', items: [] };
    case 'loadSample': return { error: 'Tidak ada engine native (mode browser)' };
    default: return null;
  }
}

function call(name, ...args) {
  if (!N) return mockCall(name, args);
  const r = N.call(name, JSON.stringify(args));
  try { return JSON.parse(r); } catch (e) { return r; }
}



const nativeEng = {
  start: () => call('start'),
  play: () => call('play'), playCountIn: () => call('play'), stop: () => call('stop'), seek: (t) => call('seek', t),
  tempo: (b) => call('tempo', b), tempoMap: (on, f) => call('tempoMap', on, f), sig: (bt, n) => call('setSig', bt, n), meter: (f) => call('setMeter', f), loop: (on, s, e) => call('loop', on, s, e), metro: (on) => call('metro', on), metroVol: (v) => call('metroVol', v),
  trackVol: (t, v) => call('trackVol', t, v), trackPan: (t, v) => call('trackPan', t, v),
  trackMute: (t, m) => call('trackMute', t, m), trackSolo: (t, s) => call('trackSolo', t, s),
  trackInst: (t, type) => call('trackInst', t, type), instParam: (t, i, v) => call('instParam', t, i, v),
  trackNotes: (t, flat, n) => call('trackNotes', t, flat.filter((_, k) => k % 5 < 4), n),   // the native engine still takes [start, len, pitch, vel]
  trackClips: (t, flat, n) => call('trackClips', t, flat.filter((_, k) => k % 7 < 4), n),
  resetTrack: (t) => call('resetTrack', t),
  insertDevice: (t, i, type) => call('insertDevice', t, i, type), removeDevice: (t, i) => call('removeDevice', t, i),
  devParam: (t, d, p, v) => call('devParam', t, d, p, v), devBypass: (t, d, b) => call('devBypass', t, d, b),
  preview: (t, pitch, vel, on) => call('preview', t, pitch, vel, on),
  bend: (t, st) => call('bend', t, st),
  send: (t, idx, v) => call('trackSend', t, idx, v), automation: (flat, n) => call('automation', flat, n),
  devOut: (t, d) => call('devOut', t, d),
  poll: () => call('poll'),
  loadSample: (id, path) => call('loadSample', id, path),
  hasStorage: () => call('hasStorage'), requestStorage: () => call('requestStorage'),
  home: () => call('home'), listDir: (p) => call('listDir', p),
  exportWav: (path, endTick, bpm, bits) => call('exportWav', path, endTick, bpm, bits), exportJob: () => false, cancelExport: () => call('cancelExport'),
  readText: (p) => call('readText', p), writeText: (p, t) => call('writeText', p, t),

  // features that only exist in the web backend
  recStart: () => ({ error: 'Rekam audio hanya tersedia di versi web.' }), recStop: () => ({ error: 'Rekam audio hanya tersedia di versi web.' }), isRecording: () => false,
  midiInit: async () => ({ error: 'Input MIDI hanya tersedia di versi web.' }), midiDevices: () => [],
  loadSoundFont: async () => ({ error: 'SoundFont hanya tersedia di versi web.' }), putSampleBuffers: async () => ({ error: 'Tidak tersedia' }), sampleBuffers: () => null,
  readBytes: async () => null, downloadBlob: () => {}, importFiles: async () => [], deleteFile: () => false, download: () => {}, saveBytes: async () => false, fileSize: () => 0,
  setLatencyMs: () => {}, latencyMs: () => 0, info: () => ({ sampleRate: 48000, baseLatency: 0, outputLatency: 0, state: 'native' }), init: async () => {}, ready: async () => 48000,
};

let web = null, webBroken = null;
if (backend === 'web') { try { web = createWebBackend(); } catch (e) { webBroken = e; } }
// Offline export swaps the target so project.js can replay the whole project into an offline engine.
let target = web || nativeEng;
const webApi = web && {
  ...web,
  exportWav: (path, endTick, bpm, bits) => web.exportWav(path, endTick, bpm, bits, (off) => { target = off; try { hooks.replay && hooks.replay(); } finally { target = webApi; } }),
  exportJob: (job) => web.exportJob(job, (off) => { target = off; try { hooks.replay && hooks.replay(); } finally { target = webApi; } }),
};
if (webApi) target = webApi;
export const eng = new Proxy({}, { get: (_, k) => { const v = target[k]; return v !== undefined ? v : () => null; } });
export const backendError = () => webBroken;
