// Web backend of the `eng` interface: AudioWorklet engine + offline file library (IndexedDB) + recording + MIDI + WAV export.
import { Engine, NSTRIPS, MASTER, RET0, NFX } from './core.js';
import { sabAvailable, makeShared, RingWriter, PollReader } from './sabio.js';
import { parseSf2 } from './sf2.js';
import { encodeWav, finishRender, postRender } from './wav.js';
import { Mp3Encoder, Resampler, mp3Rate, concatBytes } from './mp3.js';
import { makeZip } from '../zip.js';
import { buildPyramid } from '../waveform.js';
import * as FS from '../storage.js';
import { log } from '../log.js';
import { prefs } from '../prefs.js';
import { isNativeApp, saveAndShare, subFor, pickerAccept, accepts } from '../native.js';
import { createNativeSink } from './nativesink.js';

export const FOLDERS = ['/Samples', '/SoundFonts', '/Recordings', '/Projects', '/Exports', '/Presets/Mixer', '/Presets/Instruments'];
const NO_MIRROR = /\/_autosave\.mdaw$/;   // rewritten every few seconds: stays in the app's own storage only
const TEXT_RE = /\.(mdaw|json)$/i;
const dcache = new Map(); let dbytes = 0; const DMAX = 2e9;   // decoded samples (LRU): a preview makes the following "add" instant, and re-adding costs no decode
const dcDrop = (path) => { const d = dcache.get(path); if (d) { dbytes -= d.bytes; dcache.delete(path); } };
const DROP_RE = /^\/(Samples|SoundFonts|Recordings|Exports)\//;
const AUDIO_RE = /\.(wav|mp3|ogg|oga|flac|m4a|aac|opus|webm)$/i;

// ------------------------------------------------------------------ file library (IndexedDB, works offline)
const lib = {
  db: null, meta: new Map(), texts: new Map(),
  open() {
    return new Promise((res) => {
      if (!('indexedDB' in globalThis)) return res(null);
      const rq = indexedDB.open('mobiledaw', 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore('meta', { keyPath: 'path' }); rq.result.createObjectStore('data'); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    });
  },
  async init() {
    this.db = await this.open();
    if (!this.db) return;
    await new Promise((res) => {
      const tx = this.db.transaction('meta').objectStore('meta').openCursor();
      tx.onsuccess = () => { const c = tx.result; if (c) { this.meta.set(c.value.path, c.value); c.continue(); } else res(); };
      tx.onerror = () => res();
    });
    const texts = [...this.meta.values()].filter((m) => m.text);
    await Promise.all(texts.map((m) => this.rawGet(m.path).then((d) => { if (typeof d === 'string') this.texts.set(m.path, d); })));
  },
  rawGet(path) {
    const m = this.meta.get(path);
    if (m && m.ext) return FS.readFile(path);      // file that lives only in the MobileDAW folder (put there from outside the app)
    return new Promise((res) => { if (!this.db) return res(null); const r = this.db.transaction('data').objectStore('data').get(path); r.onsuccess = () => res(r.result ?? null); r.onerror = () => res(null); });
  },
  async put(path, data) {
    dcDrop(path);
    const text = typeof data === 'string', rec = { path, size: text ? data.length : data.byteLength, time: Date.now(), text };
    this.meta.set(path, rec);
    if (text) this.texts.set(path, data);
    if (FS.active() && !NO_MIRROR.test(path)) this.mirror(path, data);
    if (!this.db) return;
    await new Promise((res) => { const tx = this.db.transaction(['meta', 'data'], 'readwrite'); tx.objectStore('meta').put(rec); tx.objectStore('data').put(data, path); tx.oncomplete = res; tx.onerror = res; tx.onabort = res; });
  },
  // Folder writes are queued per path so two quick saves of the same file cannot interleave.
  queue: new Map(),
  mirror(path, data) {
    const prev = this.queue.get(path) || Promise.resolve();
    const job = prev.catch(() => {}).then(() => FS.writeFile(path, data)).then((ok) => { if (!ok) log('warn', 'tidak tersalin ke folder:', path); else { const m = this.meta.get(path); if (m) m.mirrored = true; } });
    this.queue.set(path, job); job.finally(() => { if (this.queue.get(path) === job) this.queue.delete(path); });
    return job;
  },
  // Make the library match the MobileDAW folder: new files appear, removed files disappear, files only in the app are copied out.
  // Only one scan runs at a time (a second tap joins the running one) and it always finishes: the scan has time limits on every call.
  progress: null, running: null,
  sync(onProgress) {
    if (this.running) { if (onProgress) this.progress = onProgress; return this.running; }
    this.progress = onProgress || null;
    const job = this.doSync().catch((e) => { log('error', 'sinkron folder', e); return { added: 0, removed: 0, copied: 0, errors: 1 }; });
    this.running = job; job.finally(() => { this.running = null; this.progress = null; });
    return job;
  },
  async doSync() {
    if (!FS.active()) return { added: 0, removed: 0, copied: 0, errors: 0 };
    const known = new Map();                              // quick scan: files already known are not opened again (that is what made scanning slow)
    for (const [p, m] of this.meta) { if (m.keep) continue; if (m.ext) known.set(p, { size: m.size, time: m.time }); else if (m.ftime != null) known.set(p, { size: m.size, time: m.ftime }); }
    const found = await FS.scan((n) => { if (this.progress) this.progress(n); }, known, AUDIO_RE), seen = new Set();
    let added = 0, removed = 0, copied = 0;
    const errors = found.errors || 0;
    if (!found.length && errors && !found.dirs.length) return { added, removed, copied, errors };   // the folder could not be read at all: keep what we know instead of wiping the list
    const dbPut = (rec) => (this.db ? new Promise((res) => { const tx = this.db.transaction(['meta', 'data'], 'readwrite'); tx.objectStore('meta').put(rec); tx.objectStore('data').delete(rec.path); tx.oncomplete = res; tx.onerror = res; tx.onabort = res; }) : null);
    for (const f of found) {
      seen.add(f.path);
      const m = this.meta.get(f.path);
      if (m && !m.ext && m.size === f.size && (m.ftime == null || m.ftime === f.time)) { if (m.ftime == null) m.ftime = f.time; continue; }   // same file in both places
      if (m && m.ext && m.time === f.time && (!TEXT_RE.test(f.path) || this.texts.has(f.path))) continue;   // unchanged since the last scan (a changed copy in the folder wins)
      dcDrop(f.path);                                       // changed from outside: forget the decoded copy
      const rec = { path: f.path, size: f.size, time: f.time, text: false, ext: true };
      if (TEXT_RE.test(f.path) && f.size < 8e6) {          // projects and presets are read as text right away (readText is synchronous)
        const buf = await FS.readFile(f.path);
        if (buf) { const t = new TextDecoder().decode(buf); this.texts.set(f.path, t); rec.text = true; rec.size = t.length; }
      }
      this.meta.set(f.path, rec); added++;
      await dbPut(rec);
    }
    for (const d of found.empty || []) {                  // empty folders are kept visible with an invisible marker
      const kp = d + '/.keep';
      if (this.meta.has(kp)) { seen.add(kp); continue; }
      const rec = { path: kp, size: 0, time: 0, text: false, ext: true, keep: true };
      this.meta.set(kp, rec); seen.add(kp); added++; await dbPut(rec);
    }
    if (!errors || found.length) {                         // never delete entries after a scan that failed halfway
      for (const [path, m] of [...this.meta]) {
        if (seen.has(path)) continue;
        if (errors && m.ext) continue;                     // could be one of the unreadable entries
        if (m.keep && !m.ext) { await FS.mkdir(path.slice(0, -5)); continue; }
        if (m.ext) { this.meta.delete(path); this.texts.delete(path); if (!m.keep) removed++; if (this.db) await new Promise((res) => { const tx = this.db.transaction(['meta', 'data'], 'readwrite'); tx.objectStore('meta').delete(path); tx.objectStore('data').delete(path); tx.oncomplete = res; tx.onerror = res; }); }
        else if (!errors && FS.isDevice() && !NO_MIRROR.test(path) && (m.mirrored || DROP_RE.test(path))) {   // it was copied to the folder before and is gone now: the folder is the truth, so it leaves the list
          dcDrop(path); this.meta.delete(path); this.texts.delete(path); removed++;
          if (this.db) await new Promise((res) => { const tx = this.db.transaction(['meta', 'data'], 'readwrite'); tx.objectStore('meta').delete(path); tx.objectStore('data').delete(path); tx.oncomplete = res; tx.onerror = res; tx.onabort = res; });
        }
        else if (!NO_MIRROR.test(path) && FOLDERS.some((d) => path.startsWith(d + '/'))) { const d = await this.rawGet(path); if (d != null) { await FS.writeFile(path, d); copied++; } }
      }
    }
    log('info', `sinkron folder: +${added} -${removed} disalin ${copied} gagal dibaca ${errors}`);
    for (const f of found) if (f.lazy) known.set(f.path, { size: -1, time: 0 });
    this.verifyBg(found, known);

    return { added, removed, copied, errors };
  },
  // Files the quick scan skipped are checked in the background; changed ones are updated and the browser list redraws.
  vtok: 0,
  async verifyBg(found, known) {
    const tok = ++this.vtok, cached = new Map();
    for (const f of found) if (f.cached) cached.set(f.path, known.get(f.path));
    if (!cached.size) { if (this.afterSync) this.afterSync(); return; }
    let ch = [];
    try { ch = await FS.verify(found.handles, cached); } catch (e) { log('warn', 'verifikasi folder', e); return; }
    if (tok !== this.vtok) return;
    if (!ch.length) { if (this.afterSync) this.afterSync(); return; }
    for (const f of ch) {
      dcDrop(f.path);
      const rec = { path: f.path, size: f.size, time: f.time, text: false, ext: true };
      if (TEXT_RE.test(f.path) && f.size < 8e6) { const buf = await FS.readFile(f.path); if (buf) { const t = new TextDecoder().decode(buf); this.texts.set(f.path, t); rec.text = true; rec.size = t.length; } }
      this.meta.set(f.path, rec);
      if (this.db) await new Promise((res) => { const tx = this.db.transaction(['meta', 'data'], 'readwrite'); tx.objectStore('meta').put(rec); tx.objectStore('data').delete(rec.path); tx.oncomplete = res; tx.onerror = res; tx.onabort = res; });
    }
    log('info', `verifikasi folder: ${ch.length} file berubah`);
    try { window.dispatchEvent(new CustomEvent('libchange', { detail: { changed: ch.length } })); } catch (_) { /* no window */ }
    if (this.afterSync) this.afterSync();
  },
  async del(path) {
    dcDrop(path);
    this.meta.delete(path); this.texts.delete(path);
    if (FS.active()) FS.removeFile(path);
    if (!this.db) return;
    await new Promise((res) => { const tx = this.db.transaction(['meta', 'data'], 'readwrite'); tx.objectStore('meta').delete(path); tx.objectStore('data').delete(path); tx.oncomplete = res; tx.onerror = res; });
  },
};

const folderFor = (name) => (/\.sf2$/i.test(name) ? '/SoundFonts' : /\.mdaw$/i.test(name) ? '/Projects' : '/Samples');
const safeName = (n) => n.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'file';

// ------------------------------------------------------------------ offline target used for WAV export
// Same method names as the live backend, applied directly to an Engine in this thread.
class OfflineTarget {
  constructor(sr, bank, sfs) { this.e = new Engine(sr); for (let i = 0; i < bank.length; i++) if (bank[i]) this.e.bank[i] = { l: bank[i].l, r: bank[i].r, frames: bank[i].l.length, rate: sr }; for (let i = 0; i < sfs.length; i++) this.e.sfs[i] = sfs[i]; }
  play() { this.e.play(); } playCountIn() { this.e.play(); } stop() { this.e.stop(); } seek(t) { this.e.seek(t); } tempo(b) { this.e.tempo(b); } tempoMap(on, f) { this.e.tempoMap(on, f); } sig(bt, n) { this.e.setSig(bt, n); } meter(f) { this.e.setMeter(f); }
  loop(on, s, e) { this.e.loop(on, s, e); } metro(on) { this.e.setMetro(on); } metroVol(v) { this.e.setMetroVol(v); } masterLimit(on) { this.e.masterLimit(on); } pdc(on) { this.e.setPdc(on); }
  trackVol(t, v) { this.e.trackVol(t, v); } trackPan(t, v) { this.e.trackPan(t, v); } trackWidth(t, v) { this.e.trackWidth(t, v); } trackInvert(t, f) { this.e.trackInvert(t, f); } trackMute(t, m) { this.e.trackMute(t, m); } trackSolo(t, m) { this.e.trackSolo(t, m); }
  trackInst(t, ty) { this.e.trackInst(t, ty); } instParam(t, i, v) { this.e.instParam(t, i, v); }
  trackNotes(t, f, n) { this.e.trackNotes(t, f, n); } trackClips(t, f, n) { this.e.trackClips(t, f, n); } trackCC(t, f, n) { this.e.trackCC(t, f, n); } resetTrack(t) { this.e.resetTrack(t); }
  insertDevice(t, i, ty) { this.e.insertDevice(t, i, ty); } removeDevice(t, i) { this.e.removeDevice(t, i); } devParam(t, d, p, v) { this.e.devParam(t, d, p, v); } devBypass(t, d, b) { this.e.devBypass(t, d, b); } rackCmd(t, d, op, c, j, a, b) { this.e.rackCmd(t, d, op, c, j, a, b); }
  send(t, k, v) { this.e.trackSend(t, k, v); } trackOut(t, k) { this.e.trackOut(t, k); } automation(f, n) { this.e.automation(f, n); }
  // konfigurasi stem: track = hanya track itu (tanpa send, tanpa rantai master); return = hanya bus efek k (track tidak langsung ke master)
  stemTrack(t) { const e = this.e; this.rawMaster(); e.s[t].solo = true; e.s[t].send[0] = 0; e.s[t].send[1] = 0; e.lanes = e.lanes.filter((l) => !((l.kind === 2 || l.kind === 3) && l.track === t)); }
  stemReturn(k) { const e = this.e; this.rawMaster(); e.noDirect = true; for (let j = 0; j < NFX; j++) if (j !== k) e.s[RET0 + j].mute = true; }
  // Track Freeze: only track t, before its fader (volume 1, centre, width 100 %, no inversion, no sends, straight to the master), without
  // the automation of its mixer controls (those keep working live on the frozen audio); the master chain and the output limiter are off
  freezeTrack(t) {
    const e = this.e, s = e.s[t]; this.rawMaster(); s.solo = true; s.send[0] = s.send[1] = 0; s.vol = 1; s.pan = 0; s.width = 1; s.inv = 0; s.out = -1;
    const a = Math.PI * 0.25; s.gl = Math.cos(a) * 1.41421356; s.gr = Math.sin(a) * 1.41421356;   // fader already at its target: no ramp in the first milliseconds
    e.lanes = e.lanes.filter((l) => !(l.track === t && [0, 1, 2, 3, 7].includes(l.kind)));
  }
  rawMaster() { const e = this.e, m = e.s[MASTER]; for (const d of m.dev) d.bypass = true; m.vol = 1; m.gl = 1; e.lanes = e.lanes.filter((l) => l.track !== MASTER); }
  preview() {} bend(t, st) { this.e.bend(t, st); } devOut() { return []; } poll() { return null; } start() { return this.e.sr; }
}

export function createWebBackend() {
  const st = { ctx: null, node: null, ready: false, queue: [], poll: { pos: 0, playing: false, cpu: 0, m: new Array(NSTRIPS * 2).fill(0) }, dev: {}, wanted: new Map(), watchKey: '', bank: new Array(256).fill(null), sfs: [], sfPaths: new Map(), exporting: false, cancel: false, rec: null, midi: null, midiNames: [], latencyMs: 0, starting: null, seq: 0, ring: null, pr: null, sab: false };
  const me = {};

  function post(c, ...a) {
    note(c, a);
    if (nat.mirror) { if (!(TRANSPORT.has(c) && !nat.on)) nat.sink.send(c, a); }        // native engine: every command; play / preview only while it is the one sounding
    if (nat.only || (nat.on && TRANSPORT.has(c))) return;                               // the worklet stays stopped (and silent) while the native engine plays
    const seq = ++st.seq;                                                               // global order of the ring and the message commands
    if (st.ready) { if (!(st.ring && st.ring.push(seq, c, a))) st.node.port.postMessage({ c, a, seq }); } else st.queue.push({ c, a, seq });
    if (c === 'stop' && nat.pending) setTimeout(evaluate, 0);
  }

  // ---- Android: the C++ engine (Pengaturan -> Audio -> Engine audio). The worklet keeps receiving every command, so its state is always
  // complete and going back to Web is instant. While the native engine is selected it receives the same command stream (nativesink.js).
  // It only plays when every instrument and effect of the project is ported; otherwise the Web engine plays (automatic fallback). A switch
  // happens only while the transport is stopped.
  const TRANSPORT = new Set(['play', 'playCountIn', 'preview', 'bend']);
  const nat = { sink: isNativeApp() ? createNativeSink() : null, want: false, ready: false, mirror: false, on: false, only: false, pending: false, inst: new Array(NSTRIPS).fill(0), dev: Array.from({ length: NSTRIPS }, () => []), rk: Array.from({ length: NSTRIPS }, () => new Set()), replay: null };   // rk: device types ever put into a rack on the strip (kept until the strip is reset: a conservative check)
  function note(c, a) {                                    // instrument / effect types per strip, to know whether the native engine can play the project
    const t = a[0] | 0; if (t < 0 || t >= NSTRIPS) return;
    if (c === 'trackInst') nat.inst[t] = a[1] | 0;
    else if (c === 'resetTrack') { nat.inst[t] = 0; nat.dev[t] = []; nat.rk[t].clear(); }
    else if (c === 'rackCmd') {                            // device / instrument types put into racks (instruments as 1000 + type); -1 = a chain op on an effect rack (unknown)
      const op = a[2] | 0, k = op === 1 ? a[5] | 0 : op === 5 && a[1] < 0 && a[5] > 0 ? 1000 + (a[5] | 0) : op >= 5 && a[1] >= 0 ? -1 : null;
      if (k === null || nat.rk[t].has(k)) return; nat.rk[t].add(k);
    }
    else if (c === 'insertDevice') { const d = nat.dev[t]; if (d.length < 16) d.splice(Math.max(0, Math.min(d.length, a[1] | 0)), 0, a[2] | 0); }
    else if (c === 'removeDevice') { const d = nat.dev[t], i = a[1] | 0; if (i >= 0 && i < d.length) d.splice(i, 1); }
    else return;
    if (nat.want) evaluateSoon();
  }
  // first thing the native engine cannot play: { strip, inst } or { strip, dev } (types from defs.js), or null
  function blocker() {
    if (!nat.ready) return { notReady: true };
    for (let t = 0; t < NSTRIPS; t++) {
      if (nat.inst[t] && !nat.sink.inst.has(nat.inst[t])) return { strip: t, inst: nat.inst[t] };
      for (const d of nat.dev[t]) if (!nat.sink.dev.has(d)) return { strip: t, dev: d };
      for (const d of nat.rk[t]) if (d >= 1000 ? !nat.sink.inst.has(d - 1000) : !nat.sink.dev.has(d)) return d >= 1000 ? { strip: t, inst: d - 1000 } : { strip: t, dev: d };
    }
    return null;
  }
  function evaluate() {
    if (!nat.sink) return;
    const want = nat.want && nat.ready && !blocker();
    if (want === nat.on) { nat.pending = false; return; }
    if (st.poll.playing) { nat.pending = true; return; }   // never switch in the middle of playback: at the next stop
    nat.pending = false;
    const pos = Math.max(0, st.poll.pos || 0);
    if (want) {
      nat.on = true;
      if (st.node) { try { st.node.disconnect(); } catch (_) { /* not connected */ } }
      nat.sink.send('seek', [pos]); nat.sink.setActive(true);
      log('info', 'mesin audio: Native (C++/Oboe)');
    } else {
      nat.on = false;
      nat.sink.send('stop', []); nat.sink.setActive(false);
      if (st.ready) st.node.port.postMessage({ c: 'seek', a: [pos] });
      if (st.node && st.ctx) st.node.connect(st.ctx.destination);
      log('info', 'mesin audio: Web (AudioWorklet)' + (nat.want ? ' - native belum bisa memutar proyek ini' : ''));
    }
    try { window.dispatchEvent(new CustomEvent('enginechange', { detail: me.engineInfo() })); } catch (_) { /* no window */ }
  }
  let evalQ = false;
  const evaluateSoon = () => { if (!evalQ) { evalQ = true; setTimeout(() => { evalQ = false; evaluate(); }, 50); } };
  async function startNative() {
    await me.start();
    const r = await nat.sink.start(st.ctx.sampleRate);
    if (r.sr !== st.ctx.sampleRate) log('warn', `native ${r.sr} Hz, web ${st.ctx.sampleRate} Hz`);
    // bring the native engine up to date: the whole project (project.js syncAll) and every sample already loaded
    nat.only = true; nat.mirror = true;
    try { if (nat.replay) nat.replay(); } finally { nat.only = false; }
    st.bank.forEach((b, id) => { if (b) nat.sink.sample(id, b.l, b.r); });
    st.sfs.forEach((sf, id) => { if (sf) nat.sink.soundFont(id, sf); });
    if (st.watchList) nat.sink.send('watch', [st.watchList]);   // the displays that are open now
    nat.ready = true;
    log('info', `engine native siap: ${r.sr} Hz, instrumen ${[...nat.sink.inst].join(',') || '-'}, efek ${[...nat.sink.dev].join(',') || '-'}`);
  }
  // pref = 'web' | 'native'. Can be changed at any time (no restart, the project stays as it is).
  me.setEngine = async (pref) => {
    nat.want = pref === 'native' && !!nat.sink;
    if (nat.want && !nat.mirror) { try { await startNative(); } catch (e) { log('error', 'engine native gagal mulai', e); nat.want = false; } }
    evaluate();
    return me.engineInfo();
  };
  me.engineInfo = () => ({ available: !!nat.sink, want: nat.want ? 'native' : 'web', active: nat.on ? 'native' : 'web', pending: nat.pending, blocker: nat.want ? blocker() : null });
  me.setReplay = (fn) => { nat.replay = fn; };
  me.nativeStats = (reset) => (nat.sink && nat.ready ? nat.sink.stats(reset) : Promise.resolve(null));
  if (nat.sink) {
    nat.sink.onPoll = (d) => {
      if (!nat.on) return;
      d.rx = performance.now(); d.tl = null; d.dev = d.dev || {}; st.poll = d; st.dev = d.dev;   // device read-outs of the watched displays (bridge nDevOut)
      if (nat.pending && !d.playing) evaluate();
    };
    nat.sink.onErrors = (msg) => { const m = String(msg).split('\n').filter((x) => x && !/^unsupported/.test(x)); if (m.length) log('warn', 'engine native: ' + m.join('; ')); };
  }

  async function boot() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC || !AC.prototype || !globalThis.AudioWorkletNode) throw new Error('Browser ini tidak mendukung AudioWorklet. Gunakan Chrome atau Edge terbaru.');
    const hint = ['interactive', 'balanced', 'playback'].includes(prefs.latencyHint) ? prefs.latencyHint : 'interactive';
    try { st.ctx = new AC(prefs.sampleRate ? { latencyHint: hint, sampleRate: prefs.sampleRate } : { latencyHint: hint }); }
    catch (e) { log('warn', 'AudioContext dengan pengaturan sendiri gagal, memakai bawaan', e); st.ctx = new AC({ latencyHint: 'interactive' }); }
    log('info', `audio: ${st.ctx.sampleRate} Hz, latensi ${hint}`);
    const latLog = () => log('info', `latensi audio: base ${((st.ctx.baseLatency || 0) * 1000).toFixed(1)} ms, output ${((st.ctx.outputLatency || 0) * 1000).toFixed(1)} ms, status ${st.ctx.state}`);
    latLog(); st.ctx.addEventListener('statechange', () => { if (st.ctx.state === 'running') latLog(); });
    await st.ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
    // SharedArrayBuffer channels (sabio.js) only when the page is cross-origin isolated (COOP / COEP headers); otherwise postMessage only
    let shared = null;
    if (sabAvailable()) { try { shared = makeShared(NSTRIPS, 64); } catch (e) { shared = null; log('warn', 'SharedArrayBuffer tidak bisa dibuat', e); } }
    st.node = new AudioWorkletNode(st.ctx, 'daw', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: shared ? { shared } : {} });
    if (shared) { st.ring = new RingWriter(shared); st.pr = new PollReader(shared); st.sab = true; setInterval(sabPoll, 100); }
    log('info', 'kanal engine: ' + (shared ? 'SharedArrayBuffer (ring buffer perintah + blok poll)' : 'postMessage (halaman tidak cross-origin isolated)'));
    st.node.connect(st.ctx.destination);
    st.node.port.onmessage = (ev) => {
      const d = ev.data;
      if (d.ready) { st.ready = true; for (const q of st.queue) st.node.port.postMessage(q); st.queue = []; }
      else if (d.err) { if (globalThis.onEngineError) globalThis.onEngineError(d.err); }
      else if (d.m && !nat.on) { d.rx = performance.now(); st.poll = d; st.dev = d.dev || {}; if (nat.pending && !d.playing) evaluate(); }   // rx = arrival time: the playhead clock needs it (a poll may be read several times)
    };
    const resume = () => { if (st.ctx.state !== 'running') st.ctx.resume().catch(() => {}); };
    // The browser may suspend / interrupt the audio context (phone call, tab switch, screen lock): bring it back when the app is visible again
    document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
    st.ctx.onstatechange = () => { if (st.ctx.state === 'interrupted' || (st.ctx.state === 'suspended' && !document.hidden)) resume(); };
    st.node.onprocessorerror = () => { if (globalThis.onEngineError) globalThis.onEngineError({ kind: 'engine', msg: 'prosesor audio berhenti, muat ulang aplikasi' }); };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, resume, true);
    setInterval(pruneWatch, 250);
    return st.ctx.sampleRate;
  }
  // shared poll block -> st.poll (the playhead clock gets the time the block was written, from the audio clock)
  function sabPoll() {
    if (!st.pr || nat.on) return st.poll;
    const d = st.pr.read();
    if (d && d !== st.sabLast) {
      st.sabLast = d; d.rx = performance.now() - Math.max(0, (st.ctx.currentTime - d.t) * 1000);
      st.poll = d; st.dev = d.dev; if (nat.pending && !d.playing) evaluate();
    }
    return st.poll;
  }
  function pruneWatch() {
    const now = Date.now(), list = [];
    for (const [k, t] of st.wanted) { if (now - t > 1500) st.wanted.delete(k); else list.push(k.split(',').map(Number)); }
    const key = list.join(';');
    if (key !== st.watchKey) { st.watchKey = key; st.watchList = list; post('watch', list); }
  }

  // ---- engine commands
  me.start = () => (st.starting = st.starting || boot().then((sr) => { me.sampleRate = sr; return sr; }));
  me.ready = () => me.start();
  const cmd = (name, wire = name) => (...a) => post(wire, ...a);
  Object.assign(me, {
    play: () => { if (st.ctx) st.ctx.resume().catch(() => {}); post('play'); }, playCountIn: (b) => { if (st.ctx) st.ctx.resume().catch(() => {}); post('playCountIn', b); }, stop: cmd('stop'), seek: cmd('seek'), tempo: cmd('tempo'), tempoMap: cmd('tempoMap'), sig: cmd('setSig'), meter: cmd('setMeter'), loop: cmd('loop'), metro: cmd('metro', 'setMetro'), metroVol: cmd('metroVol', 'setMetroVol'),
    trackVol: cmd('trackVol'), trackPan: cmd('trackPan'), trackWidth: cmd('trackWidth'), trackInvert: cmd('trackInvert'), trackMute: cmd('trackMute'), trackSolo: cmd('trackSolo'), trackInst: cmd('trackInst'), instParam: cmd('instParam'),
    trackNotes: cmd('trackNotes'), trackCC: cmd('trackCC'), trackClips: cmd('trackClips'), resetTrack: cmd('resetTrack'), insertDevice: cmd('insertDevice'), removeDevice: cmd('removeDevice'),
    devParam: cmd('devParam'), devBypass: cmd('devBypass'), rackCmd: cmd('rackCmd'), preview: cmd('preview'), bend: cmd('bend'), send: cmd('trackSend'), trackOut: cmd('trackOut'), trackLoad: cmd('trackLoad'), automation: cmd('automation'),
    masterLimit: (on) => { st.limOn = !!on; post('masterLimit', !!on); },   // output-stage safety limiter (also used by the mix export)
    pdc: (on) => { st.pdcOn = !!on; post('setPdc', !!on); },              // plugin delay compensation (also used by every export)
    pdcMs: () => { const sr = nat.on && nat.sink && nat.sink.sr ? nat.sink.sr : st.ctx ? st.ctx.sampleRate : 0; return sr && st.poll && st.poll.lat ? st.poll.lat / sr * 1000 : 0; },   // how far the heard output trails the song position
    poll: () => (st.pr && !nat.on ? sabPoll() : st.poll),
    channel: () => (st.sab ? 'sab' : 'message'),
    audioContext: () => st.ctx,                                            // perf.js: the live device test runs its own silent worklet instance
    devOut: (t, d) => { st.wanted.set(t + ',' + d, Date.now()); return st.dev[t + ',' + d] || []; },
  });

  // ---- samples and soundfonts
  async function decode(path) {
    const hit = dcache.get(path);
    if (hit) { dcache.delete(path); dcache.set(path, hit); return hit; }
    const [bytes] = await Promise.all([lib.rawGet(path), me.start()]);   // read the file while the audio context boots
    if (!bytes) throw new Error('File tidak ditemukan: ' + path);
    const buf = await st.ctx.decodeAudioData(bytes);                      // bytes is a fresh copy from IndexedDB / the folder: no slice needed
    if (buf.length * 2 > 90e6) throw new Error('Audio terlalu panjang untuk dimuat ke RAM (maks sekitar 8 menit stereo).');
    const l = buf.getChannelData(0).slice(), r = buf.numberOfChannels > 1 ? buf.getChannelData(1).slice() : l;
    const d = { l, r, sr: buf.sampleRate, bytes: (l === r ? 1 : 2) * l.byteLength, pk: null, pyr: null };
    dcache.set(path, d); dbytes += d.bytes;
    for (const [k, v] of dcache) { if (dbytes <= DMAX || dcache.size <= 1) break; if (k !== path) { dbytes -= v.bytes; dcache.delete(k); } }
    return d;
  }
  const peaksFromPyr = (pyr, n) => {                  // 0..1 peak per bin, taken from the 64-sample blocks of the pyramid
    const { mn, mx } = pyr.lv[0], nb = mn.length, bins = Math.min(n, Math.max(1, nb)), out = new Array(bins);
    for (let b = 0; b < bins; b++) {
      let m = 0;
      for (let i = Math.floor(b * nb / bins), e = Math.max(i + 1, Math.floor((b + 1) * nb / bins)); i < e && i < nb; i++) { const a = Math.max(-mn[i], mx[i]); if (a > m) m = a; }
      out[b] = Math.round(Math.min(1, m) * 1000) / 1000;
    }
    return out;
  };
  me.loadSample = async (id, path) => {
    try {
      const d = await decode(path), { l, r, sr } = d;
      st.bank[id] = { l, r };
      st.node.port.postMessage({ c: 'sample', id, l, r });   // structured clone = a copy: the main thread keeps its own for WAV export
      if (nat.mirror) nat.sink.sample(id, l, r);
      d.pyr = d.pyr || buildPyramid(l, r);                   // built once per file, shared with the preview and later re-adds
      return { id, duration: l.length / sr, peaks: peaksFromPyr(d.pyr, 2048), pyr: d.pyr };
    } catch (e) { return { error: e.message || String(e) }; }
  };
  // direct buffer registration (reversed / stretched / recorded audio)
  me.putSampleBuffers = async (id, l, r) => { await me.start(); st.bank[id] = { l, r }; st.node.port.postMessage({ c: 'sample', id, l, r }); if (nat.mirror) nat.sink.sample(id, l, r); const pyr = buildPyramid(l, r); return { id, duration: l.length / st.ctx.sampleRate, peaks: peaksFromPyr(pyr, 2048), pyr }; };
  me.sampleBuffers = (id) => st.bank[id];
  // ---- sample preview for the file browser (plays straight to the output, independent of the project transport)
  const pv = { src: null, tok: 0, t0: 0, dur: 0 };
  const stopSrc = () => { const s0 = pv.src; pv.src = null; if (s0) { s0.onended = null; try { s0.stop(); } catch (_) { /* already stopped */ } try { s0.disconnect(); } catch (_) { /* ignore */ } } };
  me.previewFile = async (path, onEnd) => {
    const tok = ++pv.tok; stopSrc();
    try {
      const d = await decode(path);
      if (tok !== pv.tok) return null;                     // a newer preview or a stop came in while decoding
      if (!d.pk) { const pyr = d.pyr || (d.pyr = buildPyramid(d.l, d.r)); d.pk = peaksFromPyr(pyr, 480); }
      const ctx = st.ctx; if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const mono = d.l === d.r, buf = ctx.createBuffer(mono ? 1 : 2, d.l.length, d.sr);
      buf.copyToChannel(d.l, 0); if (!mono) buf.copyToChannel(d.r, 1);
      const src = ctx.createBufferSource(), g = ctx.createGain(); g.gain.value = 0.9;
      src.buffer = buf; src.connect(g); g.connect(ctx.destination);
      src.onended = () => { if (pv.src === src) { pv.src = null; if (onEnd) onEnd(); } };
      pv.src = src; pv.t0 = ctx.currentTime; pv.dur = d.l.length / d.sr; src.start();
      return { duration: pv.dur, peaks: d.pk };
    } catch (e) { return tok === pv.tok ? { error: e.message || String(e) } : null; }
  };
  me.stopPreview = () => { pv.tok++; stopSrc(); };
  // Background decode of the samples in the MobileDAW/Samples folder: when one is added to the arrangement it is already in memory (no loading).
  // Runs one file at a time in idle moments, small files first, until about 3/4 of the decode cache is used; never while a transport is running.
  let pfRun = false, pfAgain = false;
  me.prefetch = async () => {
    if (pfRun) { pfAgain = true; return; }
    pfRun = true;
    try {
      do {
        pfAgain = false;
        const list = [...lib.meta.values()].filter((m) => !m.keep && m.path.startsWith('/Samples/') && AUDIO_RE.test(m.path) && !dcache.has(m.path) && m.size < 40e6).sort((a, b) => (a.size < 0 ? 0 : a.size) - (b.size < 0 ? 0 : b.size));
        for (const m of list) {
          if (dbytes > DMAX * 0.75) break;
          try { const d = await decode(m.path); if (!d.pyr) d.pyr = buildPyramid(d.l, d.r); } catch (_) { /* unreadable: skipped */ }
          await new Promise((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 200 }) : setTimeout(r, 8)));
        }
      } while (pfAgain);
    } finally { pfRun = false; }
  };
  lib.afterSync = () => { me.prefetch().catch(() => {}); };
  me.previewPos = () => (pv.src && st.ctx ? Math.min(pv.dur, Math.max(0, st.ctx.currentTime - pv.t0)) : -1);
  me.loadSoundFont = async (path) => {
    try {
      let id = st.sfPaths.get(path);
      if (id === undefined) {
        const bytes = await lib.rawGet(path);
        if (!bytes) throw new Error('File tidak ditemukan: ' + path);
        const sf = parseSf2(bytes);
        id = st.sfs.length; if (id >= 8) throw new Error('Maksimal 8 SoundFont dimuat sekaligus.');
        st.sfs[id] = sf; st.sfPaths.set(path, id);
        await me.start();
        st.node.port.postMessage({ c: 'sf', id, sf });
        if (nat.mirror) nat.sink.soundFont(id, sf);
      }
      return { id, presets: st.sfs[id].presets.map((p) => p.name) };
    } catch (e) { return { error: e.message || String(e) }; }
  };

  // ---- file library
  me.hasStorage = () => !!lib.db;
  me.requestStorage = () => { try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) { /* ignore */ } return true; };
  me.home = () => '';
  me.listDir = (p) => {
    p = (p || '').replace(/\/+$/, '');
    if (!p) return { path: '', parent: '', items: FOLDERS.map((f) => ({ name: f.slice(1), dir: true, size: 0 })) };
    const files = [], dirs = new Map();
    for (const m of lib.meta.values()) {
      if (!m.path.startsWith(p + '/')) continue;
      const rest = m.path.slice(p.length + 1), cut = rest.indexOf('/');
      if (cut < 0) { if (!m.keep) files.push({ name: rest, dir: false, size: Math.max(0, m.size) }); }
      else { const n = rest.slice(0, cut); dirs.set(n, (dirs.get(n) || 0) + (m.keep ? 0 : 1)); }   // sub-folders made in the MobileDAW folder show up too
    }
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
    const items = [...[...dirs].map(([name, count]) => ({ name, dir: true, size: 0, count })).sort(byName), ...files.sort(byName)];
    const up = p.lastIndexOf('/');
    return { path: p, parent: up > 0 ? p.slice(0, up) : '', items };
  };
  // Every folder below a top folder (including itself), for the "move to" list.
  me.allDirs = (top) => {
    const set = new Set([top]);
    for (const m of lib.meta.values()) {
      if (!m.path.startsWith(top + '/')) continue;
      const parts = m.path.split('/').slice(0, -1);
      for (let k = top.split('/').length; k <= parts.length; k++) set.add(parts.slice(0, k).join('/'));
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  };
  // ---- organising: new folder, move / rename file, rename / delete folder
  const badName = (n) => !n || /[\\/:*?"<>|]/.test(n) || n === '.' || n === '..' || n[0] === '.';
  const metaPut = (rec) => (lib.db ? new Promise((res) => { const tx = lib.db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(rec); tx.oncomplete = res; tx.onerror = res; tx.onabort = res; }) : null);
  const metaDel = (path) => (lib.db ? new Promise((res) => { const tx = lib.db.transaction(['meta', 'data'], 'readwrite'); tx.objectStore('meta').delete(path); tx.objectStore('data').delete(path); tx.oncomplete = res; tx.onerror = res; tx.onabort = res; }) : null);
  me.mkdir = async (path) => {
    const name = path.split('/').pop();
    if (badName(name) || !FOLDERS.some((f) => path.startsWith(f + '/'))) return { error: 'Nama folder tidak valid.' };
    if (me.allDirs(FOLDERS.find((f) => path.startsWith(f + '/'))).includes(path)) return { error: 'Folder sudah ada.' };
    const dev = FS.active();
    if (dev && !(await FS.mkdir(path))) return { error: 'Folder tidak bisa dibuat di perangkat.' };
    const rec = { path: path + '/.keep', size: 0, time: 0, text: false, ext: dev, keep: true };
    lib.meta.set(rec.path, rec); await metaPut(rec);
    return { ok: true };
  };
  me.movePath = async (from, to) => {                      // one file; `to` is the full new path
    if (from === to) return { ok: true };
    const name = to.split('/').pop();
    if (badName(name)) return { error: 'Nama file tidak valid.' };
    if (lib.meta.has(to)) return { error: 'Sudah ada file bernama ' + name + ' di folder tujuan.' };
    const m = lib.meta.get(from);
    if (!m) return { error: 'File tidak ditemukan.' };
    if (m.ext) {                                            // lives in the device folder only: stream-copy, then remove the old one
      if (!(await FS.copyFile(from, to))) return { error: 'File tidak bisa dipindahkan.' };
      await FS.removeFile(from);
      const rec = { ...m, path: to }; lib.meta.delete(from); lib.meta.set(to, rec);
      if (lib.texts.has(from)) { lib.texts.set(to, lib.texts.get(from)); lib.texts.delete(from); }
      await metaDel(from); await metaPut(rec);
    } else {
      const d = await lib.rawGet(from);
      if (d == null) return { error: 'File tidak bisa dibaca.' };
      await lib.put(to, d); await lib.del(from);
    }
    for (const [id, p] of st.sfPaths) if (p === from) st.sfPaths.delete(from);
    return { ok: true };
  };
  me.renameDir = async (from, newName) => {
    const top = FOLDERS.find((f) => from.startsWith(f + '/'));
    const to = from.slice(0, from.lastIndexOf('/') + 1) + newName;
    if (!top || badName(newName)) return { error: 'Nama folder tidak valid.' };
    if (to === from) return { ok: true };
    if (me.allDirs(top).includes(to)) return { error: 'Folder dengan nama itu sudah ada.' };
    const moved = [];
    if (FS.active()) await FS.mkdir(to);
    for (const m of [...lib.meta.values()]) {
      if (!m.path.startsWith(from + '/')) continue;
      const np = to + m.path.slice(from.length);
      if (m.keep) { lib.meta.delete(m.path); await metaDel(m.path); const rec = { ...m, path: np }; lib.meta.set(np, rec); await metaPut(rec); continue; }
      const r = await me.movePath(m.path, np);
      if (r.error) return { error: r.error + ' (sebagian file sudah dipindah)' };
      moved.push([m.path, np]);
    }
    if (FS.active()) await FS.removeDir(from);
    return { ok: true, moved };
  };
  me.deleteDir = async (path) => {
    if (!FOLDERS.some((f) => path.startsWith(f + '/'))) return false;
    for (const m of [...lib.meta.values()]) if (m.path.startsWith(path + '/')) { lib.meta.delete(m.path); lib.texts.delete(m.path); await metaDel(m.path); }
    if (FS.active()) await FS.removeDir(path);
    return true;
  };
  me.readText = (p) => lib.texts.get(p) ?? '';
  me.writeText = (p, t) => { lib.put(p, t); return true; };
  me.deleteFile = async (p) => { await lib.del(p); return true; };
  me.fileSize = (p) => (lib.meta.get(p) || {}).size || 0;
  me.saveBytes = async (path, bytes) => { await lib.put(path, bytes); return true; };
  me.readBytes = (p) => lib.rawGet(p);
  // Android app: <a download> does nothing in the WebView, so the file goes to Documents/MobileDAW/<Exports|Projects> and the share sheet opens
  const nativeSave = (sub, name, data) => saveAndShare(sub, name, data).then((r) => import('../ui.js').then(({ toast }) => toast(r.ok ? (r.where ? 'Disimpan di ' + r.where : 'Siap dibagikan: ' + name) : 'Gagal menyimpan: ' + r.error, 4500))).catch((e) => log('error', 'simpan file', e));
  me.downloadBlob = (blob, name) => {
    if (isNativeApp()) { nativeSave(subFor(name), name, blob); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  };
  me.importFiles = (accept = 'audio/*,.sf2,.mdaw,.zip,.wav,.mp3,.ogg,.flac,.m4a') => new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.accept = pickerAccept(accept); inp.style.display = 'none';
    document.body.append(inp);
    inp.onchange = async () => {
      const out = [];
      for (const f of inp.files) {
        if (!accepts(accept, f)) { log('warn', 'jenis file tidak didukung, dilewati:', f.name); continue; }
        if (/\.zip$/i.test(f.name)) {   // project bundle: the .mdaw goes to Projects, everything else to the folder it came from
          try {
            const { readZip } = await import('../zip.js');
            for (const e of await readZip(await f.arrayBuffer())) {
              const base = safeName(e.name.split('/').pop()), top = '/' + (e.name.split('/')[0] || '');
              const path = /\.mdaw$/i.test(base) ? '/Projects/' + base : (FOLDERS.includes(top) && e.name.includes('/') ? top : folderFor(base)) + '/' + base;
              await lib.put(path, /\.mdaw$/i.test(base) ? new TextDecoder().decode(e.data) : e.data.slice().buffer); out.push(path);
            }
          } catch (_) { /* damaged zip: skipped */ }
          continue;
        }
        const path = folderFor(f.name) + '/' + safeName(f.name); await lib.put(path, await f.arrayBuffer()); out.push(path);
      }
      inp.remove(); res(out);
    };
    inp.addEventListener('cancel', () => { inp.remove(); res([]); });
    inp.click();
  });
  me.download = (path) => {
    lib.rawGet(path).then((d) => {
      if (!d) return;
      if (isNativeApp()) { const dir = path.split('/').filter(Boolean).slice(0, -1).join('/'); nativeSave(dir || 'Exports', path.split('/').pop(), d); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([d])); a.download = path.split('/').pop(); document.body.append(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    });
  };

  // ---- recording (microphone)
  me.recStart = async () => {
    if (st.rec) return true;
    try {
      await me.start();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
      const src = st.ctx.createMediaStreamSource(stream), node = new AudioWorkletNode(st.ctx, 'rec', { numberOfInputs: 1, numberOfOutputs: 0 });
      const chunks = [];
      node.port.onmessage = (e) => chunks.push(e.data);
      src.connect(node); node.port.postMessage(true);
      st.rec = { stream, src, node, chunks };
      return true;
    } catch (e) { return { error: e.name === 'NotAllowedError' ? 'Izin mikrofon ditolak. Aktifkan di pengaturan situs browser.' : (e.message || String(e)) }; }
  };
  me.recStop = async (path) => {
    const r = st.rec; if (!r) return { error: 'Tidak sedang merekam' };
    st.rec = null;
    r.node.port.postMessage(false); r.src.disconnect(); r.node.disconnect(); r.stream.getTracks().forEach((t) => t.stop());
    const frames = r.chunks.reduce((a, c) => a + c.length, 0);
    if (!frames) return { error: 'Tidak ada audio yang terekam' };
    const all = new Float32Array(frames); let o = 0; for (const c of r.chunks) { all.set(c, o); o += c.length; }
    await lib.put(path, encodeWav([all], null, frames, st.ctx.sampleRate, 16, 1));
    return { frames, duration: frames / st.ctx.sampleRate, path };
  };
  me.isRecording = () => !!st.rec;

  // ---- MIDI input
  me.midiInit = async (onMessage) => {
    if (!navigator.requestMIDIAccess) return { error: 'Browser ini tidak mendukung Web MIDI.' };
    try {
      try { st.midi = await navigator.requestMIDIAccess({ sysex: true }); } catch (_) { st.midi = await navigator.requestMIDIAccess(); }   // sysex is only needed for MMC transport messages
      const hook = () => { st.midiNames = []; for (const i of st.midi.inputs.values()) { const nm = i.name || 'MIDI input'; st.midiNames.push(nm); i.onmidimessage = (m) => onMessage(m.data, nm); } };
      st.midi.onstatechange = hook; hook();
      return { devices: st.midiNames };
    } catch (e) { return { error: 'Izin MIDI ditolak atau tidak tersedia.' }; }
  };
  me.midiDevices = () => st.midiNames.slice();

  me.setLatencyMs = (v) => { st.latencyMs = v; };
  me.latencyMs = () => st.latencyMs;
  me.info = () => ({ sampleRate: st.ctx ? st.ctx.sampleRate : 0, baseLatency: st.ctx ? Math.round((st.ctx.baseLatency || 0) * 1000) : 0, outputLatency: st.ctx ? Math.round((st.ctx.outputLatency || 0) * 1000) : 0, state: st.ctx ? st.ctx.state : 'none' });

  // ---- WAV export: render the project in this thread, as fast as the CPU allows
  // PDC: the output trails the song by off.e.pdcLatency() frames (compensation + master chain + output limiter when on). Render that much and
  // drop it, so frame 0 of every file is the start position: the mix and the stems (which run without the output limiter) line up exactly.
  function preroll(off) {
    let k = off.e.pdcLatency(); const l = new Float32Array(4096), r = new Float32Array(4096);
    while (k > 0) { const n = Math.min(4096, k); off.e.render(l, r, n); k -= n; }
  }
  // Track Freeze render (project.js freezeTrack): the track's instrument + devices + automation offline, frame 0 = song start (PDC pre-roll)
  me.renderTrack = async (strip, secs, replay, onProgress) => {
    await me.start();
    const sr = st.ctx.sampleRate, off = new OfflineTarget(sr, st.bank, st.sfs);
    replay(off); off.masterLimit(false); off.pdc(st.pdcOn !== false); off.freezeTrack(strip);
    off.loop(false, 0, 0); off.metro(false); off.seek(0); off.e.settle(); off.play(); preroll(off);
    const total = Math.max(1, Math.floor(secs * sr)), L = new Float32Array(total), R = new Float32Array(total); let done = 0, t0 = Date.now();
    while (done < total) { const n = Math.min(4096, total - done); off.e.render(L.subarray(done, done + n), R.subarray(done, done + n), n); done += n; if (Date.now() - t0 > 50) { onProgress && onProgress(done / total); await new Promise((r) => setTimeout(r, 0)); t0 = Date.now(); } }
    return { l: L, r: R, sr };
  };
  me.exportWav = (path, endTick, bpm, bits, replay) => {
    if (st.exporting) return false;
    st.exporting = true; st.cancel = false;
    (async () => {
      let result = { ok: false, cancelled: false, path, error: '' };
      try {
        await me.start();
        const sr = st.ctx.sampleRate, off = new OfflineTarget(sr, st.bank, st.sfs);
        replay(off); off.masterLimit(st.limOn !== false); off.pdc(st.pdcOn !== false);   // the export sounds like playback
        off.loop(false, 0, 0); off.metro(false); off.seek(0); off.e.settle(); off.play(); preroll(off);
        const total = Math.floor(((globalThis.__exportSecs > 0 ? globalThis.__exportSecs : endTick / 960 * 60 / bpm) + 3) * sr), chunk = 4096, L = [], R = [];
        let done = 0, lastYield = Date.now();
        while (done < total && !st.cancel) {
          const n = Math.min(chunk, total - done), l = new Float32Array(n), r = new Float32Array(n);
          off.e.render(l, r, n); L.push(l); R.push(r); done += n;
          if (Date.now() - lastYield > 60) { globalThis.onExport && globalThis.onExport(Math.floor(done * 100 / total)); await new Promise((res) => setTimeout(res, 0)); lastYield = Date.now(); }
        }
        if (st.cancel) result = { ok: false, cancelled: true, path, error: '' };
        else {
          const wav = encodeWav(L, R, done, sr, bits);
          await lib.put(path, wav);
          if (!FS.isDevice()) me.download(path);          // with a device folder the file is already in MobileDAW/Exports
          result = { ok: true, cancelled: false, path, error: '' };
        }
      } catch (e) { result.error = e.message || String(e); }
      st.exporting = false;
      globalThis.onExportDone && globalThis.onExportDone(result);
    })();
    return true;
  };

  // ---- ekspor bertahap: render offline (mixdown atau stem) lalu enkode WAV / MP3, hasil tunggal atau ZIP
  // job = { dir, name, format: 'wav'|'mp3', bits, kbps, startTick, endTick, bpm, tailSec, normalize, zip, items: [{ name, kind: 'mix'|'track'|'return', idx }] }
  me.exportJob = (job, replay) => {
    if (st.exporting) return false;
    st.exporting = true; st.cancel = false;
    const tick = () => new Promise((res) => setTimeout(res, 0));
    (async () => {
      let result = { ok: false, cancelled: false, path: '', error: '' };
      const report = (frac, label) => { globalThis.onExport && globalThis.onExport(Math.max(0, Math.min(99, Math.floor(frac * 100))), label); };
      try {
        await me.start();
        const sr = st.ctx.sampleRate, items = job.items, ext = job.format === 'mp3' ? 'mp3' : 'wav', files = [];
        const total = Math.max(1, Math.floor(((job.secs > 0 ? job.secs : (job.endTick - job.startTick) / 960 * 60 / job.bpm) + job.tailSec) * sr));
        const used = new Set(), uniq = (n) => { let b = (n || 'Track').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Track', k = b, i = 2; while (used.has(k.toLowerCase())) k = b + ' ' + i++; used.add(k.toLowerCase()); return k; };
        for (let n = 0; n < items.length && !st.cancel; n++) {
          const it = items[n], base = n / items.length, span = 1 / items.length, label = items.length > 1 ? `${it.name} (${n + 1}/${items.length})` : it.name;
          const off = new OfflineTarget(sr, st.bank, st.sfs);
          replay(off); off.masterLimit(it.kind === 'mix' && st.limOn !== false); off.pdc(st.pdcOn !== false);   // stems stay raw (no master limiter), the mix sounds like playback
          if (it.kind === 'track') off.stemTrack(it.idx); else if (it.kind === 'return') off.stemReturn(it.idx);
          off.loop(false, 0, 0); off.metro(false); off.seek(job.startTick); off.e.settle(); off.play(); preroll(off);
          let L = [], R = [], done = 0, peak = 0, lastYield = Date.now();
          while (done < total && !st.cancel) {
            const c = Math.min(4096, total - done), l = new Float32Array(c), r = new Float32Array(c);
            off.e.render(l, r, c);
            for (let i = 0; i < c; i++) { const a = l[i] < 0 ? -l[i] : l[i], b = r[i] < 0 ? -r[i] : r[i]; if (a > peak) peak = a; if (b > peak) peak = b; }
            L.push(l); R.push(r); done += c;
            if (Date.now() - lastYield > 60) { report(base + span * 0.75 * done / total, label); await tick(); lastYield = Date.now(); }
          }
          if (st.cancel) break;
          if ((job.tailMode && job.tailMode !== 'leave') || job.trimStart) { ({ L, R } = postRender(L, R, Math.round(job.secs * sr), { tail: job.tailMode || 'leave', trimStart: !!job.trimStart })); peak = -1; }   // Wrap / Cut Remainder, Trim Silence
          const mono = job.channels === 1, rate = job.format !== 'mp3' && job.rate > 0 ? job.rate : sr;
          ({ L, R, frames: done } = finishRender(L, R, sr, { mono, rate, normalize: job.normalize, peak }));
          let data;
          if (job.format === 'mp3') {
            const outSr = mp3Rate(sr), rs = outSr !== sr ? [new Resampler(sr, outSr), new Resampler(sr, outSr)] : null, enc = new Mp3Encoder(outSr, mono ? 1 : 2, job.kbps), parts = [];
            for (let k = 0; k < L.length && !st.cancel; k++) {
              let l = L[k], r = R[k]; if (rs) { l = rs[0].process(l); r = rs[1].process(r); }
              for (const f of enc.encode(l, r, l.length)) parts.push(f);
              L[k] = R[k] = null;
              if (Date.now() - lastYield > 60) { report(base + span * (0.75 + 0.25 * (k + 1) / L.length), label + ' \u2014 MP3'); await tick(); lastYield = Date.now(); }
            }
            if (st.cancel) break;
            for (const f of enc.finish()) parts.push(f);
            data = concatBytes(parts).buffer;
          } else { report(base + span * 0.9, label); await tick(); data = encodeWav(L, mono ? null : R, done, rate, job.bits, mono ? 1 : 2); }
          L = R = null;
          files.push({ name: uniq(job.zip || items.length > 1 ? it.name : job.name) + '.' + ext, data });
        }
        if (st.cancel) result = { ok: false, cancelled: true, path: '', error: '' };
        else if (files.length === 1 && !job.zip) {
          const path = `${job.dir}/${files[0].name}`;
          await lib.put(path, files[0].data); if (!FS.isDevice()) me.download(path);
          result = { ok: true, cancelled: false, path, error: '' };
        } else if (job.zip || !FS.isDevice()) {
          const path = `${job.dir}/${job.name} stems.zip`, blob = makeZip(files.map((f) => ({ name: `${job.name}/${f.name}`, data: f.data })));
          await lib.put(path, await blob.arrayBuffer()); if (!FS.isDevice()) me.download(path);
          result = { ok: true, cancelled: false, path, error: '' };
        } else {
          for (const f of files) await lib.put(`${job.dir}/${job.name}/${f.name}`, f.data);
          result = { ok: true, cancelled: false, path: `${job.dir}/${job.name}/`, error: '' };
        }
      } catch (e) { result.error = e.message || String(e); }
      st.exporting = false;
      globalThis.onExportDone && globalThis.onExportDone(result);
    })();
    return true;
  };
  me.cancelExport = () => { st.cancel = true; return true; };

  me.syncFolder = (onProgress) => lib.sync(onProgress);
  me.init = async () => { await lib.init(); await FS.initStorage(); await Promise.race([lib.sync().catch((e) => log('warn', 'sinkron folder gagal', e)), new Promise((r) => setTimeout(r, 8000))]);
    let lastSync = Date.now();                              // coming back from the file manager: pick up new / changed / removed files by itself
    document.addEventListener('visibilitychange', () => { if (!document.hidden && FS.active() && Date.now() - lastSync > 15000) { lastSync = Date.now(); lib.sync().then((r) => { if (r && (r.added || r.removed)) { try { window.dispatchEvent(new CustomEvent('libchange')); } catch (_) { /* no window */ } } }).catch(() => {}); } });
  };   // a slow folder scan goes on in the background instead of holding up start-up
  return me;
}
