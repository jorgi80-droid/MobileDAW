// Example MobileDAW plugin with WebAssembly DSP (docs/PLUGIN-SDK.md): a gain stage whose inner loop runs in a 97-byte wasm module
// (gain(ptr, n, g): multiply n float32 at ptr by g). The module is compiled once when the plugin loads (top-level await works in the
// AudioWorklet scope and on the main thread); every instance gets its own memory. Audio is copied into wasm memory per block.
export const manifest = {
  id: 'org.mobiledaw.example.wasmgain',
  name: 'WASM Gain',
  version: '1.0.0',
  api: 1,
  kind: 'effect',
  params: [{ name: 'Gain', min: -24, max: 12, def: 0, unit: 'dB' }],
};

const WASM = new Uint8Array([0,97,115,109,1,0,0,0,1,7,1,96,3,127,127,125,0,3,2,1,0,5,3,1,0,1,7,14,2,3,109,101,109,2,0,4,103,97,105,110,0,0,10,53,1,51,1,1,127,2,64,3,64,32,3,32,1,79,13,1,32,0,32,3,65,4,108,106,32,0,32,3,65,4,108,106,42,2,0,32,2,148,56,2,0,32,3,65,1,106,33,3,12,0,11,11,11]);
const mod = await WebAssembly.compile(WASM);   // once per scope

export default class WasmGain {
  constructor() {
    this.inst = new WebAssembly.Instance(mod, {});    // synchronous: the module is already compiled
    this.mem = new Float32Array(this.inst.exports.mem.buffer, 0, 256);   // L at 0, R at 128 floats
    this.g = 1;
  }
  setParam(i, v) { if (i === 0) this.g = Math.pow(10, v / 20); }
  process(L, R, n) {
    const m = this.mem; m.set(L.subarray(0, n), 0); m.set(R.subarray(0, n), 128);
    this.inst.exports.gain(0, n, this.g); this.inst.exports.gain(512, n, this.g);
    L.set(m.subarray(0, n)); R.set(m.subarray(128, 128 + n));
  }
}
