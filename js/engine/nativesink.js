// Android app: the C++ audio engine (NativeEngine plugin, Oboe output) as a second receiver of the engine command stream.
// web.js sends every command to the AudioWorklet as before and, while the native engine is in use, also here. Commands are batched per
// microtask into one plugin call; every plugin call goes through one promise chain, so commands and sample data arrive in the order the
// app produced them. Nothing here waits for the audio thread. Returns null in the browser (no plugin).
import { plugin } from '../native.js';
import { encode, sfArgs } from './cmdtext.js';

const CHUNK = 1 << 18;                     // frames per sample-data call (1 MB of float32, 1.4 MB base64)
const b64 = (u8) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => { const s = String(r.result); res(s.slice(s.indexOf(',') + 1)); }; r.onerror = () => rej(r.error); r.readAsDataURL(new Blob([u8])); });

export function createNativeSink() {
  const P = plugin('NativeEngine');
  if (!P) return null;
  const s = { sr: 0, inst: new Set(), dev: new Set(), onPoll: null, onErrors: null, started: null };
  let chain = Promise.resolve(), lines = [], queued = false;
  const run = (fn) => { chain = chain.then(fn).catch((e) => { if (s.onErrors) s.onErrors(String((e && e.message) || e)); }); return chain; };
  const flush = () => {
    queued = false;
    if (!lines.length) return;
    const text = lines.join('\n'); lines = [];
    run(() => P.cmd({ text }).then((r) => { if (r && r.errors && s.onErrors) s.onErrors(r.errors); }));
  };
  // -> { sr, inst: [types], dev: [types] } of the ported instruments / effects
  s.start = (sr) => (s.started = s.started || P.start({ sr }).then((r) => {
    s.sr = r.sr; for (const t of r.inst || []) s.inst.add(t); for (const t of r.dev || []) s.dev.add(t);
    P.addListener('poll', (d) => { if (s.onPoll) s.onPoll(d); if (d.errors && s.onErrors) s.onErrors('engine: ' + d.errors); });
    return r;
  }));
  s.send = (name, args) => {
    if (name === 'watch') { flush(); const list = Array.isArray(args[0]) ? args[0] : []; run(() => P.watch({ list })); return; }   // device read-outs for the open displays
    lines.push(encode(name, args)); if (!queued) { queued = true; queueMicrotask(flush); }
  };
  s.sample = (id, l, r) => {
    flush();
    const stereo = !!(r && r !== l);
    run(async () => {
      await P.sampleBegin({ id, frames: l.length, stereo });
      for (const [ch, a] of stereo ? [[0, l], [1, r]] : [[0, l]]) {
        for (let at = 0; at < a.length; at += CHUNK) {
          const part = a.subarray(at, Math.min(a.length, at + CHUNK));
          await P.sampleData({ id, ch, at, data: await b64(new Uint8Array(part.buffer, part.byteOffset, part.byteLength)) });
        }
      }
      await P.sampleEnd({ id });
    });
  };
  // SoundFont: the sample data goes through the sample channel (slot 1000 + id), then the zone table as one text command
  s.soundFont = (id, sf) => { s.sample(1000 + id, Float32Array.from(sf.data), null); run(() => P.cmd({ text: encode('sf', sfArgs(id, sf, false)) }).then((r) => { if (r && r.errors && s.onErrors) s.onErrors(r.errors); })); };
  s.setActive = (on) => { flush(); return run(() => P.setActive({ on })); };
  s.stats = (reset = false) => P.stats({ reset });
  s.idle = () => { flush(); return chain; };
  return s;
}
