// Android app shell (Capacitor). Everything here does nothing in the browser / PWA: isNativeApp() is false there and every helper returns early.
// The plugins are reached through window.Capacitor.Plugins (injected by the Android WebView), so the web app needs no bundler and no npm import.
import { log } from './log.js';

const cap = () => globalThis.Capacitor;
export const isNativeApp = () => { try { const c = cap(); return !!(c && c.isNativePlatform && c.isNativePlatform()); } catch (_) { return false; } };
const plugin = (name) => (isNativeApp() && cap().Plugins ? cap().Plugins[name] || null : null);

// ---- files: Documents/MobileDAW/<sub folder>/<name>, then the Android share sheet
export const DOC_ROOT = 'MobileDAW';
const CHUNK = 3 << 20;                                   // 3 MB per bridge call (multiple of 3: every piece is complete base64 on its own)
const toBlob = (data) => (data instanceof Blob ? data : new Blob([typeof data === 'string' ? new TextEncoder().encode(data) : data]));
const b64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => { const s = String(r.result); res(s.slice(s.indexOf(',') + 1)); };
  r.onerror = () => rej(r.error || new Error('baca data gagal'));
  r.readAsDataURL(blob);
});
// A big WAV is written in pieces: the whole file never has to exist as one base64 string on both sides of the bridge.
async function writeChunked(fs, path, directory, blob) {
  if (!blob.size) { await fs.writeFile({ path, directory, data: '', recursive: true }); return; }
  for (let at = 0; at < blob.size; at += CHUNK) {
    const data = await b64(blob.slice(at, at + CHUNK));
    if (at === 0) await fs.writeFile({ path, directory, data, recursive: true });
    else await fs.appendFile({ path, directory, data });
  }
}
let permAsked = false;
async function ensurePerm(fs) {                           // only Android 10 and older ask; newer versions answer "granted" straight away
  if (permAsked) return;
  permAsked = true;
  try { const p = await fs.checkPermissions(); if (p.publicStorage !== 'granted') await fs.requestPermissions(); } catch (e) { log('warn', 'izin penyimpanan', e); }
}
const stamp = (name) => { const d = new Date(), p = (n) => String(n).padStart(2, '0'), i = name.lastIndexOf('.'), s = ` ${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; return i > 0 ? name.slice(0, i) + s + name.slice(i) : name + s; };

// Saves `data` (Blob | ArrayBuffer | Uint8Array | string) as Documents/MobileDAW/<sub>/<name> and opens the share sheet.
// Returns { ok, where, uri } or { error }. A file left by an earlier install of the app cannot be overwritten (Android gives it to nobody),
// so a name clash falls back to a dated name; if Documents is not writable at all, the file goes to the app's cache and is only shared.
export async function saveAndShare(sub, name, data, share = true) {
  const fs = plugin('Filesystem');
  if (!fs) return { error: 'Filesystem tidak tersedia' };
  await ensurePerm(fs);
  const blob = toBlob(data), safe = String(name).replace(/[\\/:*?"<>|]+/g, '_');
  let res = null, lastErr = null;
  for (const [directory, path, where] of [
    ['DOCUMENTS', `${DOC_ROOT}/${sub}/${safe}`, `Documents/${DOC_ROOT}/${sub}/${safe}`],
    ['DOCUMENTS', `${DOC_ROOT}/${sub}/${stamp(safe)}`, `Documents/${DOC_ROOT}/${sub}/${stamp(safe)}`],
    ['CACHE', `share/${safe}`, ''],
  ]) {
    try { await writeChunked(fs, path, directory, blob); res = { directory, path, where }; break; } catch (e) { lastErr = e; log('warn', 'simpan ' + directory + '/' + path, e); }
  }
  if (!res) return { error: (lastErr && lastErr.message) || String(lastErr) };
  let uri = '';
  try { uri = (await fs.getUri({ path: res.path, directory: res.directory })).uri; } catch (e) { log('warn', 'getUri', e); }
  log('info', 'tersimpan:', res.where || '(cache) ' + res.path, blob.size + ' byte');
  if (share && uri) shareFile(uri, safe);
  return { ok: true, where: res.where, uri };
}
export async function shareFile(uri, title) {
  const sh = plugin('Share');
  if (!sh) return false;
  try { await sh.share({ title, dialogTitle: 'Bagikan ' + title, files: [uri] }); return true; } catch (e) { if (!/cancel/i.test(String(e && e.message))) log('warn', 'bagikan', e); return false; }
}
// Which Documents/MobileDAW sub-folder a downloaded file belongs in.
export const subFor = (name) => (/\.(mdaw|zip)$/i.test(name) && !/ stems\.zip$/i.test(name) ? 'Projects' : 'Exports');

// ---- screen kept on (playback, or the "Layar tetap menyala" preference)
let awake = false;
export function setAwake(on) {
  const ka = plugin('KeepAwake');
  if (!ka || on === awake) return;
  awake = on;
  Promise.resolve(on ? ka.keepAwake() : ka.allowSleep()).catch((e) => log('warn', 'keep-awake', e));
}

// ---- start-up: class on <html>, Android back button (closes panels first, then needs a second press to leave)
export function initNative(toast) {
  if (!isNativeApp()) return false;
  const root = document.documentElement;
  root.classList.add('app', 'native-app');
  const app = plugin('App');
  if (app) {
    let last = 0;
    app.addListener('backButton', () => {
      if (window.onBack && window.onBack()) return;
      const now = Date.now();
      if (now - last < 2000) { app.exitApp(); return; }
      last = now; if (toast) toast('Tekan sekali lagi untuk keluar');
    });
  }
  log('info', 'aplikasi Android (Capacitor)');
  return true;
}
