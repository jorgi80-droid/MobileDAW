// Offline cache. The cache name contains a hash of every file, so a new deploy replaces the old cache automatically.
const CACHE = 'mobiledaw-7c7ddf1c5b5e';
const ASSETS = ["./", "./css/app.css", "./css/ableton.css", "./css/float.css", "./css/live.css", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./index.html", "./js/about.js", "./js/aboutdata.js", "./js/audioedit.js", "./js/automate.js", "./js/autosave.js", "./js/browser.js", "./js/colorpick.js", "./js/defs.js", "./js/demos.js", "./js/devices.js", "./js/devviz.js", "./js/drumpad.js", "./js/edgeguard.js", "./js/editor.js", "./js/engine.js", "./js/engine/audioops.js", "./js/engine/cmdtext.js", "./js/engine/core.js", "./js/engine/dsp.js", "./js/engine/fx.js", "./js/engine/fx2.js", "./js/engine/instruments.js", "./js/engine/live.js", "./js/engine/meter.js", "./js/engine/mp3.js", "./js/engine/mp3tables.js", "./js/engine/nativesink.js", "./js/engine/sf2.js", "./js/engine/smf.js", "./js/engine/stretchworker.js", "./js/engine/tmap.js", "./js/engine/wav.js", "./js/engine/web.js", "./js/engine/worklet.js", "./js/floatwin.js", "./js/fps.js", "./js/fxviz.js", "./js/gesture.js", "./js/history.js", "./js/keys.js", "./js/layout.js", "./js/liveinst.js", "./js/liveui.js", "./js/log.js", "./js/main.js", "./js/midi.js", "./js/midiio.js", "./js/minimeters.js", "./js/mmdraw.js", "./js/native.js", "./js/mixer.js", "./js/prefs.js", "./js/presetlib.js", "./js/presets.js", "./js/project.js", "./js/pwa.js", "./js/safdir.js", "./js/settingsui.js", "./js/storage.js", "./js/tempo.js", "./js/theme.js", "./js/timeline.js", "./js/topbar.js", "./js/ui.js", "./js/uiscale.js", "./js/waveform.js", "./js/zip.js", "./manifest.json"];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('mobiledaw-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);
  if (url.origin !== location.origin) return;
  e.respondWith(caches.match(r, { ignoreSearch: true }).then((hit) => hit || fetch(r).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); }
    return res;
  }).catch(() => (r.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
