// The C++ engine as WebAssembly (js/engine/mdaw.wasm, built by native/wasm/build.sh) for Node tests: load it, send command text, render.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function loadWasmEngine(sr, file = path.join(root, 'js/engine/mdaw.wasm')) {
  const wasi = { fd_close: () => 0, fd_seek: () => 0, fd_write: (fd, iov, n, out) => { const m = new DataView(x.memory.buffer); let t = 0; for (let i = 0; i < n; i++) t += m.getUint32(iov + i * 8 + 4, true); m.setUint32(out, t, true); return 0; } };
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(file), { wasi_snapshot_preview1: wasi }), x = instance.exports;
  if (x._initialize) x._initialize();
  x.mdaw_init(sr);
  const enc = new TextEncoder(), dec = new TextDecoder();
  const cstr = (p) => { const u = new Uint8Array(x.memory.buffer); let e = p; while (u[e]) e++; return dec.decode(u.subarray(p, e)); };
  let blobLen = 0;
  return {
    x,
    setBlob(f32) { blobLen = f32.length; const p = x.mdaw_blob(blobLen); new Float32Array(x.memory.buffer, p, blobLen).set(f32); },
    // runs command lines; returns the error text ('' when all ran)
    cmd(text) { const b = enc.encode(text), p = x.mdaw_text(b.length); new Uint8Array(x.memory.buffer, p, b.length).set(b); return x.mdaw_cmd(b.length, blobLen) ? cstr(x.mdaw_errors()) : ''; },
    render(L, R, n) { for (let at = 0; at < n; at += 128) { const k = Math.min(128, n - at); x.mdaw_render(k); L.set(new Float32Array(x.memory.buffer, x.mdaw_out(0), k), at); R.set(new Float32Array(x.memory.buffer, x.mdaw_out(1), k), at); } },
    poll() { return new Float64Array(x.memory.buffer, x.mdaw_poll(), 4 + 73 * 2); },
  };
}
