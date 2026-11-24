// AudioWorklet entry of the WebAssembly engine: the C++ engine (js/engine/mdaw.wasm) behind the same messages and poll data as
// js/engine/worklet.js (the JS engine, kept as the fallback). The main thread fetches the module and passes it in processorOptions.wasm.
import { WasmEngine } from './wasmengine.js';
import { RingReader, PollWriter, pollViews, POLL_WATCH, POLL_DEVMAX } from './sabio.js';

const NSTRIPS = 73;
const CMDS = new Set(['play', 'playCountIn', 'stop', 'seek', 'tempo', 'tempoMap', 'setSig', 'setMeter', 'loop', 'setMetro', 'setMetroVol', 'masterLimit', 'setPdc', 'trackVol', 'trackPan', 'trackWidth', 'trackInvert', 'trackMute', 'trackSolo', 'trackSend', 'trackOut', 'trackLoad', 'trackInst', 'instParam', 'resetTrack',
  'insertDevice', 'removeDevice', 'devParam', 'devBypass', 'rackCmd', 'preview', 'bend', 'modWheel', 'trackPanLaw', 'trackNotes', 'trackNoteFx', 'trackClips', 'trackCC', 'automation']);

class DawWasmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const po = (options && options.processorOptions) || {};
    this.errAt = -1e9; this.errN = 0; this.bad = 0;
    try { this.e = new WasmEngine(po.wasm, sampleRate); } catch (e) { this.e = null; this.port.postMessage({ fail: String((e && e.message) || e) }); return; }
    this.m = new Int32Array(NSTRIPS * 2); this.ld = new Int32Array(64 * 2); this.tmp = new Float32Array(4096);
    this.watch = []; this.frames = 0; this.busy = 0; this.win = 0; this.cpu = 0;
    this.apply = (name, a) => { try { const er = this.e.call(name, a); if (er) this.cmdErr(name, er); } catch (e) { this.report({ kind: 'engine', msg: name + ': ' + (e && e.message) }); } };
    const sh = po.shared;
    if (sh) {
      this.ring = new RingReader(sh); this.pw = new PollWriter(sh); this.pv = pollViews(sh);
      this.slots = Array.from({ length: POLL_WATCH }, (_, k) => this.pv.dev.subarray(k * POLL_DEVMAX, (k + 1) * POLL_DEVMAX));
    }
    this.port.onmessage = (ev) => this.onMsg(ev.data);
    this.port.postMessage({ ready: true, sr: sampleRate, wasm: true });
  }
  // an instrument / effect the build does not have is not an engine fault: the main thread hears about it once per kind
  cmdErr(name, er) { const m = String(er).split('\n').filter(Boolean); if (m.length) this.report({ kind: 'engine', msg: name + ': ' + m.join('; ') }); }
  report(err) {
    const now = Date.now();
    if (now - this.errAt < 1000) { this.errN++; return; }
    if (this.errN && err && err.msg) err = { ...err, msg: err.msg + ' (+' + this.errN + ' kejadian serupa)' };
    this.errAt = now; this.errN = 0; this.port.postMessage({ err });
  }
  onMsg(m) {
    if (!this.e) return;
    if (this.ring && m && m.seq !== undefined) this.ring.drain(m.seq, this.apply);
    try {
      if (CMDS.has(m.c)) this.apply(m.c, m.a);
      else if (m.c === 'sample') { const er = this.e.loadSample(m.id, m.l, m.r); if (er) this.cmdErr('sample', er); }
      else if (m.c === 'sf') { const er = this.e.loadSoundFont(m.id, m.sf); if (er) this.cmdErr('sf', er); }
      else if (m.c === 'watch') { const l = Array.isArray(m.list) ? m.list : (m.a && Array.isArray(m.a[0]) ? m.a[0] : []); this.watch = l.filter((x) => Array.isArray(x) && x.length === 2); }
    } catch (e) { this.report({ kind: 'engine', msg: (m && m.c) + ': ' + (e && e.message) }); }
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0];
    if (!this.e) return true;
    if (this.ring) this.ring.drain(Infinity, this.apply);
    const t0 = Date.now();
    try { this.e.render(L, R, L.length); } catch (e) { L.fill(0); R.fill(0); this.report({ kind: 'engine', msg: e && e.message }); }
    let ok = true; for (let i = 0; i < L.length; i++) { const v = L[i] + R[i]; if (!(v > -64 && v < 64)) { ok = false; break; } }
    if (!ok) { L.fill(0); if (R !== L) R.fill(0); if (++this.bad >= 3) { this.bad = 0; try { this.e.panic(); } catch (_) { /* nothing more to do */ } } this.report({ kind: 'engine', msg: 'keluaran audio tidak valid (NaN/terlalu keras) - blok dibisukan' }); } else this.bad = 0;
    this.busy += Date.now() - t0; this.frames += L.length; this.win += L.length;
    if (this.win >= sampleRate * 0.5) { this.cpu = Math.min(1.5, this.busy / (this.win / sampleRate * 1000)); this.busy = 0; this.win = 0; }
    if (this.frames >= sampleRate / 30) {
      this.frames = 0;
      if (this.pw) { this.sharePoll(); return true; }
      this.e.fillMeters(this.m);
      let tl = null; if (this.e.tl) { this.e.fillLoad(this.ld); tl = Array.from(this.ld); }
      const dev = {};
      for (const [t, d] of this.watch) { const n = this.e.devOut(t, d, this.tmp); dev[t + ',' + d] = Array.from(this.tmp.subarray(0, n)); }
      this.port.postMessage({ pos: this.e.tickPos(), playing: this.e.playing, cin: this.e.cin > 0 ? 1 : 0, cpu: Math.round(this.cpu * 1000), lat: this.e.pdcOut, m: Array.from(this.m), tl, dev });
    }
    return true;
  }
  sharePoll() {
    const v = this.pv; this.pw.begin();
    this.e.fillMeters(v.m);
    v.head[0] = this.e.tickPos(); v.head[1] = this.e.playing ? 1 : 0; v.head[2] = this.e.cin > 0 ? 1 : 0; v.head[3] = Math.round(this.cpu * 1000); v.head[4] = this.e.pdcOut; v.head[5] = this.e.tl ? 1 : 0; v.head[6] = currentTime;
    if (this.e.tl) this.e.fillLoad(v.tl);
    const nw = Math.min(POLL_WATCH, this.watch.length); v.ctrl[1] = nw;
    for (let k = 0; k < nw; k++) { const [t, d] = this.watch[k]; v.key[k] = (t << 16) | (d & 0xffff); v.len[k] = this.e.devOut(t, d, this.slots[k]) | 0; }
    this.pw.end();
  }
}
registerProcessor('daw-wasm', DawWasmProcessor);
