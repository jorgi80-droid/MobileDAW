// MobileDAW folder: a real folder (MobileDAW/) with Samples, SoundFonts, Recordings, Exports, Projects and Presets/*.
// A web page cannot write to shared storage silently, so the person picks a location ONCE (system folder picker, read/write permission)
// and the app creates MobileDAW/ and its sub-folders inside it. The handle is remembered in IndexedDB. Browsers without the folder picker
// fall back to the app's private file system (OPFS): same folder tree, kept inside the app.
import { log } from './log.js';

export const TREE = ['Samples', 'SoundFonts', 'Recordings', 'Exports', 'Projects', 'Presets/Mixer', 'Presets/Instruments'];
const ROOT = 'MobileDAW';
export const canPick = () => typeof globalThis.showDirectoryPicker === 'function';
export const canOpfs = () => !!(navigator.storage && navigator.storage.getDirectory);

const st = { mode: 'none', root: null, perm: 'none', name: '', scanErr: 0, scanCount: 0 };   // mode: device | opfs | none ; perm: granted | prompt | none
export const info = () => ({ mode: st.mode, perm: st.perm, name: st.name, scanErr: st.scanErr, scanCount: st.scanCount });
export const active = () => st.mode !== 'none' && st.perm === 'granted';
export const isDevice = () => st.mode === 'device' && st.perm === 'granted';

// ---- remember the picked folder (FileSystemDirectoryHandle can be stored in IndexedDB)
function idb() {
  return new Promise((res) => {
    if (!('indexedDB' in globalThis)) return res(null);
    const rq = indexedDB.open('mobiledaw-fs', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('h');
    rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null);
  });
}
async function kv(op, key, val) {
  const db = await idb(); if (!db) return null;
  return new Promise((res) => {
    const tx = db.transaction('h', op === 'get' ? 'readonly' : 'readwrite'), s = tx.objectStore('h');
    const r = op === 'get' ? s.get(key) : op === 'put' ? s.put(val, key) : s.delete(key);
    r.onsuccess = () => res(r.result ?? null); r.onerror = () => res(null);
  });
}

// Android's folder access (SAF) costs ~50-150 ms per call, so folder handles are cached by path (cleared on every rescan, on removal and
// after any failure) and a path is never walked part by part twice.
const dirCache = new Map(), fileCache = new Map();
const dropCaches = () => { dirCache.clear(); fileCache.clear(); };
async function sub(dir, path, create) {
  const isRoot = dir === st.root, key = path.split('/').filter(Boolean).join('/');
  if (isRoot && dirCache.has(key)) return dirCache.get(key);
  let d = dir, acc = '';
  for (const part of path.split('/').filter(Boolean)) {
    acc += (acc ? '/' : '') + part;
    if (isRoot && dirCache.has(acc)) { d = dirCache.get(acc); continue; }
    d = await d.getDirectoryHandle(part, { create });
    if (isRoot) dirCache.set(acc, d);
  }
  return d;
}
async function ensureTree(root) { for (const p of TREE) await sub(root, p, true); }

async function useRoot(root, mode) {
  dropCaches(); st.root = root; st.mode = mode; st.name = mode === 'opfs' ? 'penyimpanan aplikasi' : root.name;
  await ensureTree(root);
}

// Called at start-up. Returns the state; never throws.
export async function initStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const saved = await kv('get', 'root');
    if (saved && canPick()) {
      let p = 'prompt';
      try { p = await saved.queryPermission({ mode: 'readwrite' }); } catch (_) { /* old API */ }
      st.root = saved; st.mode = 'device'; st.name = saved.name; st.perm = p === 'granted' ? 'granted' : 'prompt';
      if (st.perm === 'granted') await ensureTree(saved);
      log('info', 'folder tersimpan:', saved.name, st.perm);
      return info();
    }
    if (!canPick() && canOpfs()) {
      await useRoot(await sub(await navigator.storage.getDirectory(), ROOT, true), 'opfs'); st.perm = 'granted';
      log('info', 'folder MobileDAW di penyimpanan aplikasi (OPFS)');
    }
  } catch (e) { log('error', 'initStorage', e); st.mode = 'none'; st.perm = 'none'; }
  return info();
}

// Must run from a tap. Opens the system picker, asks for read/write permission and creates MobileDAW/ with its sub-folders.
export async function chooseFolder() {
  if (!canPick()) return { error: 'Browser ini tidak punya pemilih folder. Gunakan Chrome/Edge terbaru; sementara file disimpan di penyimpanan aplikasi.' };
  try {
    const picked = await showDirectoryPicker({ id: 'mobiledaw', mode: 'readwrite', startIn: 'documents' });
    if ((await picked.requestPermission({ mode: 'readwrite' })) !== 'granted') return { error: 'Izin tulis ditolak.' };
    const root = picked.name === ROOT ? picked : await picked.getDirectoryHandle(ROOT, { create: true });
    await useRoot(root, 'device'); st.perm = 'granted';
    await kv('put', 'root', root);
    log('info', 'folder dipilih:', picked.name + (picked.name === ROOT ? '' : '/' + ROOT));
    return { ok: true, name: picked.name === ROOT ? ROOT : picked.name + '/' + ROOT };
  } catch (e) {
    if (e && e.name === 'AbortError') return { cancelled: true };
    log('error', 'chooseFolder', e);
    return { error: e && e.name === 'SecurityError' ? 'Folder ini diblokir browser. Buat atau pilih folder lain (bukan Downloads / folder sistem).' : (e && e.message) || String(e) };
  }
}
// Must run from a tap: the browser forgets write permission between sessions unless the person chose "allow every time".
export async function regrant() {
  if (!st.root || st.mode !== 'device') return false;
  try {
    const ok = (await st.root.requestPermission({ mode: 'readwrite' })) === 'granted';
    st.perm = ok ? 'granted' : 'prompt';
    if (ok) await ensureTree(st.root);
    return ok;
  } catch (e) { log('warn', 'regrant', e); return false; }
}
export async function disconnect() { dropCaches(); await kv('del', 'root'); st.root = null; st.mode = 'none'; st.perm = 'none'; st.name = ''; if (canOpfs() && !canPick()) await initStorage(); }

// ---- file operations (paths look like /Samples/kick.wav; Presets/Mixer is a nested folder)
async function parent(path, create) { const parts = path.split('/').filter(Boolean), name = parts.pop(); return { dir: await sub(st.root, parts.join('/'), create), name }; }
export async function writeFile(path, data) {
  if (!active()) return false;
  try {
    const { dir, name } = await parent(path, true);
    const fh = await dir.getFileHandle(name, { create: true }), w = await fh.createWritable();
    await w.write(data); await w.close();
    return true;
  } catch (e) { log('error', 'tulis folder gagal', path, e); return false; }
}
export async function readFile(path) {
  if (!active()) return null;
  for (let k = 0; k < 2; k++) {
    try {
      let fh = k === 0 ? fileCache.get(path) : null;
      if (!fh) { const { dir, name } = await parent(path, false); fh = await dir.getFileHandle(name); fileCache.set(path, fh); }
      return await (await fh.getFile()).arrayBuffer();
    } catch (_) { fileCache.delete(path); if (k === 0) dirCache.clear(); }     // stale handle (file replaced from outside): walk the path again once
  }
  return null;
}
export async function removeFile(path) {
  if (!active()) return false;
  fileCache.delete(path);
  try { const { dir, name } = await parent(path, false); await dir.removeEntry(name); return true; } catch (_) { return false; }
}
// ---- scanning. Android's folder access (SAF) is slow per call and its directory iterator goes stale when awaits happen between steps
// ("A requested file or directory could not be found at the time an operation was processed"). So: list a folder in one quick loop
// first, handle the entries afterwards, give every call a time limit and never let one broken entry abort the whole scan.
const withTimeout = (p, ms, what) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('waktu habis: ' + what)), ms);
  Promise.resolve(p).then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
});
async function listEntries(dir) {
  let last;
  for (let k = 0; k < 3; k++) {                                   // the directory iterator can fail once while the folder is being changed from outside: try again
    const out = [];
    const grab = async (it) => { for await (const e of it) out.push(e); };
    try { await withTimeout(grab(dir.entries()), 20000, 'daftar folder'); return out; } catch (e1) { last = e1; }
    out.length = 0;
    try { await withTimeout(grab(dir.values()), 20000, 'daftar folder'); return out.map((h) => [h.name, h]); } catch (e2) { last = last || e2; }
    await new Promise((r) => setTimeout(r, 250 * (k + 1)));
  }
  throw last;
}
async function fileInfo(h) {
  let err;
  for (let k = 0; k < 2; k++) {
    try { const f = await withTimeout(h.getFile(), 10000, 'baca file'); return { size: f.size, time: f.lastModified }; } catch (e) { err = e; }
  }
  throw err;
}
// Every file in the tree: [{ path, size, time }] (+ .dirs: every folder, .empty: folders without content, .errors: entries that could not be read,
// .handles: path -> file handle). `known` (Map path -> { size, time }) makes the scan FAST: files already known are not opened again (opening
// a file is the slow part on Android), their old size / time are returned with cached: true; verify() checks them afterwards in the background.
export async function scan(onProgress, known, lazyRe) {
  const out = [];
  out.dirs = []; out.empty = []; out.errors = 0; out.handles = new Map();
  if (!active()) return out;
  dropCaches();
  let count = 0;
  const walk = async (dir, base, depth) => {
    let entries;
    try { entries = await listEntries(dir); } catch (e) { out.errors++; log('warn', 'scan folder', base || '/', e); return; }
    if (!entries.length && base) out.empty.push(base);
    const files = [], subs = [];
    for (const [name, h] of entries) {
      if (!name || name[0] === '.') continue;                       // hidden / trash files
      if (h.kind === 'directory') { out.dirs.push(base + '/' + name); if (depth < 8) subs.push([name, h]); }
      else files.push([name, h]);
    }
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const [name, h] = files[next++], path = base + '/' + name, k = known && known.get(path);
        out.handles.set(path, h);
        if (k) { out.push({ path, size: k.size, time: k.time, cached: true }); count++; continue; }
        if (lazyRe && lazyRe.test(name)) { out.push({ path, size: -1, time: 0, cached: true, lazy: true }); count++; continue; }   // new audio file: listed by name now, size is filled in by verify()
        try { const fi = await fileInfo(h); out.push({ path, size: fi.size, time: fi.time }); count++; if (onProgress && count % 10 === 0) onProgress(count); }
        catch (e) { out.errors++; log('warn', 'scan file', path, e); }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    let si = 0;                                                       // sub-folders: three at a time
    const sw = async () => { while (si < subs.length) { const [name, h] = subs[si++]; await walk(h, base + '/' + name, depth + 1); } };
    await Promise.all([sw(), sw(), sw()]);
  };
  try { await walk(st.root, '', 0); } catch (e) { out.errors++; log('warn', 'scan folder', e); }
  if (onProgress) onProgress(count);
  st.scanErr = out.errors; st.scanCount = out.length;
  return out;
}
// Background check of files the quick scan did not open: returns [{ path, size, time }] of the ones that changed since the last scan.
export async function verify(handles, known, onProgress) {
  const changed = [], list = [...handles].filter(([p]) => known.has(p));
  let next = 0, done = 0;
  const worker = async () => {
    while (next < list.length) {
      const [path, h] = list[next++], k = known.get(path);
      try { const fi = await fileInfo(h); if (fi.size !== k.size || fi.time !== k.time) changed.push({ path, size: fi.size, time: fi.time }); } catch (_) { /* unreadable now: the next scan decides */ }
      if (onProgress && ++done % 25 === 0) onProgress(done, list.length);
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  return changed;
}

// ---- folder operations (paths like /Samples/Drums)
export async function mkdir(path) {
  if (!active()) return false;
  try { await sub(st.root, path, true); return true; } catch (e) { log('error', 'buat folder gagal', path, e); return false; }
}
export async function removeDir(path) {
  if (!active()) return false;
  dropCaches();
  try { const { dir, name } = await parent(path, false); await dir.removeEntry(name, { recursive: true }); return true; } catch (_) { return false; }
}
// Copy by streaming the File into the new file: a 60 MB sample is never held in memory.
export async function copyFile(from, to) {
  if (!active()) return false;
  try {
    const a = await parent(from, false), b = await parent(to, true);
    const f = await (await a.dir.getFileHandle(a.name)).getFile();
    const fh = await b.dir.getFileHandle(b.name, { create: true }), w = await fh.createWritable();
    await w.write(f); await w.close();
    return true;
  } catch (e) { log('error', 'salin file gagal', from, '->', to, e); return false; }
}
