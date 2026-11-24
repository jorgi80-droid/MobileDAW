// App log: a small ring buffer (kept in localStorage) that collects errors, warnings and key events so problems can be read
// and copied from Pengaturan > Log. Level 0 = error only, 1 = + warn, 2 = + info (storage, export, project events).
const KEY = 'mobiledaw.log.v1', MAX = 200;
let items = [], level = 1, timer = 0, hooked = false;
try { const s = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(s)) items = s.slice(-MAX); } catch (_) { /* corrupt log: start empty */ }
const RANK = { error: 0, warn: 1, info: 2 };
const text = (v) => { try { if (v instanceof Error) return v.message || String(v); return typeof v === 'string' ? v : JSON.stringify(v); } catch (_) { return String(v); } };
function persist() { clearTimeout(timer); timer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX))); } catch (_) { /* storage full or blocked */ } }, 800); }

export function setLogLevel(n) { level = n === 0 || n === 2 ? n : 1; }
export function log(kind, ...parts) {
  const k = RANK[kind] === undefined ? 'info' : kind;
  if (RANK[k] > level) return;
  const msg = parts.map(text).join(' ').slice(0, 400);
  const last = items[items.length - 1];
  if (last && last.k === k && last.m === msg) { last.n = (last.n || 1) + 1; last.t = Date.now(); }   // repeated message: count it, do not flood the buffer
  else items.push({ t: Date.now(), k, m: msg });
  if (items.length > MAX) items.splice(0, items.length - MAX);
  persist();
}
export const logs = () => items.slice();
export function clearLog() { items = []; try { localStorage.removeItem(KEY); } catch (_) { /* ignore */ } }
const pad = (n) => String(n).padStart(2, '0');
export function logText() {
  return items.map((e) => { const d = new Date(e.t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} [${e.k.toUpperCase()}] ${e.m}${e.n > 1 ? ' (x' + e.n + ')' : ''}`; }).join('\n');
}
// Capture uncaught errors and console.error / console.warn once.
export function initLog(lv) {
  setLogLevel(lv);
  if (hooked) return; hooked = true;
  addEventListener('error', (e) => log('error', (e.error && e.error.message) || e.message || 'error', e.filename ? '(' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''));
  addEventListener('unhandledrejection', (e) => log('error', 'promise:', (e.reason && e.reason.message) || e.reason));
  for (const k of ['error', 'warn']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => { try { log(k, ...a); } catch (_) { /* never break the console */ } orig(...a); };
  }
  log('info', 'MobileDAW dimulai');
}
