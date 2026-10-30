// Installed-app behaviour. When MobileDAW is opened from its home-screen icon (display-mode fullscreen/standalone) it acts like
// a native app: no install hints, no web wording, Android back button closes panels first and needs a second press to exit.
// Opened in an ordinary browser tab it offers to install, or - if it is already installed - explains how to open the app.
import { h, toast } from './ui.js';
import { isNativeApp } from './native.js';

const FLAG = 'mobiledaw.installed';            // set once the app has run (or was installed) on this device; storage is shared with the installed app
const SNOOZE = 'mobiledaw.installHintUntil';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* storage blocked */ } },
};
export const isStandalone = () => isNativeApp() || ['fullscreen', 'standalone'].some((m) => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true || (document.referrer || '').startsWith('android-app://');

let deferred = null, card = null;
export const canInstall = () => !!deferred;
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred; deferred = null;
  try { e.prompt(); const r = await e.userChoice; return r && r.outcome === 'accepted'; } catch (_) { return false; }
}

function closeCard() { if (card) { card.remove(); card = null; } }
function showCard(title, text, actions) {
  closeCard();
  const layer = document.getElementById('layer'); if (!layer) return;
  card = h('div', { class: 'pwa-card', role: 'dialog' }, h('b', {}, title), h('div', { class: 'sv' }, text),
    h('div', { class: 'acts' }, ...actions.map((a) => h('button', { class: 'b' + (a.go ? ' go' : ''), onclick: () => { closeCard(); if (a.fn) a.fn(); } }, a.label))));
  layer.append(card);
}
function offerInstall() {
  if (!deferred || (+store.get(SNOOZE) || 0) > Date.now()) return;
  showCard('Pasang MobileDAW', 'Pasang sebagai aplikasi: layar penuh tanpa bilah browser, tetap jalan offline, dan ikon di layar utama.', [
    { label: 'Nanti', fn: () => store.set(SNOOZE, String(Date.now() + 7 * 864e5)) },
    { label: 'Pasang', go: true, fn: async () => { if (await promptInstall()) toast('Memasang\u2026 buka MobileDAW dari ikon di layar utama.', 4000); } }]);
}
function explainInstalled() {
  try { if (sessionStorage.getItem('mobiledaw.openHint')) return; sessionStorage.setItem('mobiledaw.openHint', '1'); } catch (_) { /* ignore */ }
  showCard('MobileDAW sudah terpasang', 'Buka lewat ikon MobileDAW di layar utama atau laci aplikasi agar berjalan layar penuh seperti aplikasi biasa, tanpa bilah alamat browser.', [{ label: 'Tetap di browser' }, { label: 'Mengerti', go: true }]);
}

// Android back: close open panels first (window.onBack), otherwise ask for a second press before leaving.
function guardBack() {
  history.pushState({ daw: 1 }, '');
  let last = 0;
  addEventListener('popstate', () => {
    if (window.onBack && window.onBack()) { history.pushState({ daw: 1 }, ''); return; }
    const now = Date.now();
    if (now - last < 2000) { history.back(); return; }
    last = now; history.pushState({ daw: 1 }, ''); toast('Tekan sekali lagi untuk keluar');
  });
}

export function initPwa(native) {
  const std = isStandalone();
  document.documentElement.classList.toggle('app', std);
  if (native) return;                                   // the Android shell handles all of this itself
  if (std) { store.set(FLAG, '1'); guardBack(); return; }
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; setTimeout(offerInstall, 2500); });
  addEventListener('appinstalled', () => { store.set(FLAG, '1'); deferred = null; closeCard(); toast('MobileDAW terpasang. Buka dari ikon di layar utama.', 4000); });
  if (store.get(FLAG)) setTimeout(explainInstalled, 1500);
}
