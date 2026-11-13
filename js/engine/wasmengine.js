// The C++ engine (native/engine, the one the Android app runs) as WebAssembly: js/engine/mdaw.wasm, built by native/wasm/build.sh.
// WasmEngine wraps one instance with the calls the AudioWorklet processor needs (commands by name + arguments, samples, SoundFonts,
// render, meters, device read-outs). Commands travel as the text lines of js/engine/cmdtext.js, the same encoding the Android bridge and
// the golden tests use; Float32Array arguments go through the float side buffer. No TextEncoder here: the AudioWorklet scope has none.
import { encode, sfArgs } from './cmdtext.js';

const NSTRIPS = 73, POLL_HEAD = 4;
export class WasmEngine {
  // module: a compiled WebAssembly.Module or the bytes of mdaw.wasm
  constructor(module, sr) {
    const mod = module instanceof WebAssembly.Module ? module : new WebAssembly.Module(module);
    const wasi = { fd_close: () => 0, fd_seek: () => 0, fd_write: (fd, iov, n, out) => { const m = new DataView(this.x.memory.buffer); let t = 0; for (let i = 0; i < n; i++) t += m.getUint32(iov + i * 8 + 4, true); m.setUint32(out, t, true); return 0; } };
    this.x = new WebAssembly.Instance(mod, { wasi_snapshot_preview1: wasi }).exports;
    if (this.x._initialize) this.x._initialize();
    this.x.mdaw_init(sr);
    this.sr = sr; this.tl = false; this.playing = false; this.cin = 0; this.pdcOut = 0; this.pos = 0; this.parts = []; this.partLen = 0;
    this.f32 = (a) => { const off = this.partLen; this.parts.push(a); this.partLen += a.length; return '@' + off + ':' + a.length; };
  }
  // runs command lines (with the collected float data); returns '' or the engine's error text
  run(text) {
    const x = this.x, n = text.length, bl = this.partLen;
    if (bl) { const p = x.mdaw_blob(bl), v = new Float32Array(x.memory.buffer, p, bl); let o = 0; for (const a of this.parts) { v.set(a, o); o += a.length; } this.parts = []; this.partLen = 0; }
    const tp = x.mdaw_text(n), u = new Uint8Array(x.memory.buffer, tp, n);
    for (let i = 0; i < n; i++) u[i] = text.charCodeAt(i);
    if (!x.mdaw_cmd(n, bl)) return '';
    const m = new Uint8Array(x.memory.buffer); let p = x.mdaw_errors(), s = ''; while (m[p]) s += String.fromCharCode(m[p++]);
    return s;
  }
  call(name, args) { if (name === 'trackLoad') this.tl = !!(args && args[0]); return this.run(encode(name, args || [], this.f32)); }
  loadSample(id, l, r) { return this.run(`sample ${id} ${this.f32(l)}${r && r !== l ? ' ' + this.f32(r) : ''}`); }
  loadSoundFont(id, sf) { return this.run(encode('sf', sfArgs(id, sf), this.f32)); }
  render(L, R, n) {
    const x = this.x;
    for (let at = 0; at < n; at += 128) {
      const k = Math.min(128, n - at); x.mdaw_render(k);
      L.set(new Float32Array(x.memory.buffer, x.mdaw_out(0), k), at); if (R !== L) R.set(new Float32Array(x.memory.buffer, x.mdaw_out(1), k), at);
    }
  }
  // refreshes pos / playing / cin / pdcOut and writes the meters (2 x NSTRIPS, x 1000) into m
  fillMeters(m) {
    const v = new Float64Array(this.x.memory.buffer, this.x.mdaw_poll(), POLL_HEAD + NSTRIPS * 2);
    this.pos = v[0]; this.playing = v[1] > 0; this.cin = v[2]; this.pdcOut = v[3];
    for (let i = 0; i < NSTRIPS * 2 && i < m.length; i++) m[i] = v[POLL_HEAD + i];
  }
  tickPos() { return this.pos; }
  fillLoad(out) { const v = new Int32Array(this.x.memory.buffer, this.x.mdaw_load(), 128); for (let i = 0; i < out.length && i < 128; i++) out[i] = v[i]; }
  devOut(t, d, out) { const n = Math.min(out.length, this.x.mdaw_devout(t, d)); if (n > 0) out.set(new Float32Array(this.x.memory.buffer, this.x.mdaw_dev(), n)); return n > 0 ? n : 0; }
  panic() { this.x.mdaw_panic(); }
}
