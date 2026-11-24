// The MobileDAW folder on an Android phone's storage, for the Android app (Capacitor). The WebView has no File System Access API, so the
// DawFolder plugin (android/.../DawFolderPlugin.java, Storage Access Framework) does the work and this file wraps it in objects that behave
// like FileSystemDirectoryHandle / FileSystemFileHandle for exactly what js/storage.js uses. storage.js then runs unchanged on the phone folder.
// Handles hold plain data only (tree, path, name), so the root can be kept in IndexedDB like a real handle and rebuilt with safFrom().
// Big files are read by the WebView straight from the content:// URI (no base64 over the bridge); writes go over the bridge in 3 MB pieces.
import { plugin, CHUNK, toBlob, b64 } from './native.js';

const P = () => plugin('DawFolder');
export const hasSaf = () => !!P();
const join = (a, b) => (a ? a + '/' + b : '/' + b).replace(/\/+/g, '/');
const notFound = (what) => { const e = new Error('tidak ditemukan: ' + what); e.name = 'NotFoundError'; return e; };
const typeMismatch = (what) => { const e = new Error('jenis salah: ' + what); e.name = 'TypeMismatchError'; return e; };

async function readUri(tree, path, uri) {
  const c = globalThis.Capacitor;
  if (uri && c && c.convertFileSrc) {
    try { const r = await fetch(c.convertFileSrc(uri)); if (r.ok) return await r.arrayBuffer(); } catch (_) { /* fall back to the bridge */ }
  }
  const { data } = await P().read({ tree, path });
  const bin = atob(data), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

class SafFile {
  constructor(tree, path, name, info) { this.tree = tree; this.path = path; this.name = name; this.kind = 'file'; if (info) this.info = info; }
  async getFile() {
    let i = this.info;
    if (!i) { i = await P().stat({ tree: this.tree, path: this.path }); if (!i.exists) throw notFound(this.path); this.info = i; }
    const { tree, path } = this, uri = i.uri;
    this.info = null;                                   // the next getFile() asks again (the file may change from outside)
    return { name: this.name, size: i.size, lastModified: i.time, type: '', arrayBuffer: () => readUri(tree, path, uri) };
  }
  async createWritable() {
    const parts = [], { tree, path } = this;
    return {
      write: async (d) => { parts.push(d && typeof d.arrayBuffer === 'function' && !(d instanceof Blob) ? await d.arrayBuffer() : d); },
      close: async () => {
        const blob = new Blob(parts.map((d) => toBlob(d)));
        if (!blob.size) { await P().write({ tree, path, data: '', append: false }); return; }
        for (let at = 0; at < blob.size; at += CHUNK) await P().write({ tree, path, data: await b64(blob.slice(at, at + CHUNK)), append: at > 0 });
      },
    };
  }
}

class SafDir {
  constructor(tree, path, name) { this.tree = tree; this.path = path; this.name = name; this.kind = 'directory'; }
  async getDirectoryHandle(name, opt) {
    const path = join(this.path, name);
    if (opt && opt.create) await P().mkdir({ tree: this.tree, path });
    else { const s = await P().stat({ tree: this.tree, path }); if (!s.exists) throw notFound(path); if (!s.dir) throw typeMismatch(path); }
    return new SafDir(this.tree, path, name);
  }
  async getFileHandle(name, opt) {
    const path = join(this.path, name);
    if (opt && opt.create) return new SafFile(this.tree, path, name);   // created by the first write
    const s = await P().stat({ tree: this.tree, path });
    if (!s.exists) throw notFound(path);
    if (s.dir) throw typeMismatch(path);
    return new SafFile(this.tree, path, name, s);
  }
  async removeEntry(name) { await P().remove({ tree: this.tree, path: join(this.path, name) }); }
  async *entries() {
    const { entries } = await P().list({ tree: this.tree, path: this.path });
    for (const e of entries) {
      const path = join(this.path, e.name);
      yield [e.name, e.dir ? new SafDir(this.tree, path, e.name) : new SafFile(this.tree, path, e.name, { exists: true, size: e.size, time: e.time, uri: e.uri })];
    }
  }
  async *values() { for await (const [, h] of this.entries()) yield h; }
  async queryPermission() { try { return (await P().check({ tree: this.tree })).granted ? 'granted' : 'prompt'; } catch (_) { return 'prompt'; } }
  async requestPermission() { return this.queryPermission(); }   // a revoked folder cannot be re-granted in place: it has to be picked again
}

// System folder picker (must run from a tap). Resolves to the picked folder, or throws AbortError when the person cancels.
export async function safPick() {
  const r = await P().pick();
  if (!r || r.cancelled || !r.tree) { const e = new Error('dibatalkan'); e.name = 'AbortError'; throw e; }
  await P().reset();
  return new SafDir(r.tree, '', r.name || 'folder');
}
// A handle read back from IndexedDB (plain object) -> working handle
export const safFrom = (o) => (o && o.tree ? new SafDir(o.tree, o.path || '', o.name || 'folder') : null);
export const safRelease = (o) => (o && o.tree && P() ? P().release({ tree: o.tree }).catch(() => {}) : null);
