# MobileDAW untuk Android (APK)

APK ini membungkus web app MobileDAW apa adanya dengan [Capacitor 8](https://capacitorjs.com). Mesin audio tetap
mesin JavaScript (AudioWorklet) yang sama dengan versi web. Versi web/PWA tidak berubah: semua perilaku khusus
Android hanya aktif bila `isNativeApp()` (`js/native.js`) bernilai benar.

## Ambil APK dari GitHub Actions (tanpa install apa pun)

1. Push ke branch mana saja. Workflow **Android APK (debug)** (`.github/workflows/android.yml`) membangun APK debug.
2. Buka repo di GitHub → tab **Actions** → run terbaru **Android APK (debug)** → bagian **Artifacts** →
   unduh **MobileDAW-debug-apk** (file ZIP berisi `MobileDAW-debug-<commit>.apk`).
3. Workflow **Tests** menjalankan `node tools/run-tests.mjs` di setiap push.

## Pasang di HP

1. Kirim file `.apk` ke HP (ekstrak dulu dari ZIP artifact), lalu ketuk file itu.
2. Izinkan "Instal aplikasi tidak dikenal" untuk aplikasi pembuka file (Files / Chrome) bila diminta.
3. APK debug ditandatangani dengan kunci debug milik runner GitHub. Setiap runner bisa memakai kunci berbeda, jadi
   bila Android menolak memasang update ("paket bertentangan"), uninstall dulu versi lama.
   **Uninstall menghapus data aplikasi** (library, autosave). Simpan proyek penting lewat menu
   *Ekspor proyek (.mdaw)* / *Ekspor ZIP* dulu; hasilnya ada di `Documents/MobileDAW`.

## Build lokal (Android Studio)

Butuh: Node 22+, JDK 21 (Capacitor 8 tidak bisa dengan JDK 17), Android Studio (SDK 36).

```bash
npm ci                    # sekali
npm run sync              # salin web app ke www/ lalu cap sync android
npm run open              # buka proyek android/ di Android Studio, lalu Run ▶ ke HP (USB debugging)
# atau tanpa Android Studio:
npm run apk               # -> android/app/build/outputs/apk/debug/app-debug.apk
```

- `tools/copy-www.mjs` menyalin `index.html`, `manifest.json`, `css/`, `js/`, `icons/`, `demos/` ke `www/`
  (webDir Capacitor). File sumber tidak dipindah; `www/` tidak di-commit.
- Setiap mengubah file web: jalankan `npm run sync` lagi sebelum build.
- Debug WebView: HP tersambung USB → Chrome desktop → `chrome://inspect`.

## Apa yang berbeda di APK

| Hal | Web / PWA | APK |
|---|---|---|
| Service worker / kartu "Pasang" | ya | tidak (semua file ada di dalam APK) |
| Ekspor WAV/MP3/ZIP/.mdaw/.mid | unduhan browser | disimpan di `Documents/MobileDAW/<Exports\|Projects\|...>` lalu lembar Bagikan terbuka |
| Pilih folder MobileDAW (File System Access) | ya (Chrome) | disembunyikan; library di penyimpanan aplikasi (IndexedDB) |
| Impor sample/proyek/SoundFont | `<input type=file>` | sama (pemilih file Android; jenis file dicek oleh aplikasi) |
| Web MIDI (controller USB) | ya | tidak ada (indikator & menu MIDI disembunyikan) |
| Layar | fullscreen bila dipasang | immersive (status bar & navigasi tersembunyi, geser dari tepi untuk memunculkan), landscape |
| Layar tetap menyala | opsi di Pengaturan | otomatis selama playback, plus opsi yang sama |
| Tombol Back | tutup panel, tekan 2x keluar | sama |
| Ukuran huruf sistem Android | — | diabaikan; pakai Pengaturan → Tampilan → Skala UI |

## Batasan APK (fase 1)

- Mesin audio masih JavaScript di WebView; latensi sama dengan Chrome di HP yang sama. Nilai *base latency*
  terlihat di Pengaturan → Audio (dan tercatat di Pengaturan → Log). Mesin C++ (Oboe) adalah fase 2.
- Tidak ada input MIDI (WebView Android tidak punya Web MIDI).
- File yang sudah ada di `Documents/MobileDAW` dari instalasi sebelumnya tidak bisa ditimpa (aturan Android);
  ekspor dengan nama sama otomatis diberi nama bertanggal.
- File yang ditaruh aplikasi lain di `Documents/MobileDAW` tidak terbaca otomatis: impor lewat Browser → Impor.
- APK debug saja (belum ada APK rilis bertanda tangan / Play Store).
- `demos/SoundFonts/TimGM6mb.sf2` berlisensi GPL v2 dan ikut di dalam APK (lihat `demos/README.txt`).

## Fase 2: engine audio C++ native (sedang berjalan)

Engine audio JS (`js/engine/`) tetap jadi referensi. Port C++-nya ada di `native/engine/`. Kode yang sama dipakai di dua tempat:
host desktop untuk tes kesetaraan (`native/host/golden_host`) dan library Android (`android/app/src/main/cpp/`, output lewat Oboe).

- **Pilih engine:** Pengaturan → Audio → *Engine audio*: Web (bawaan) / Native (C++). Bisa diganti kapan saja tanpa restart.
  Selama proyek memakai instrumen/efek yang belum di-port, proyek otomatis diputar engine Web dan alasannya ditampilkan.
  Pergantian engine hanya terjadi saat transport berhenti.
- **Ukur performa:** Pengaturan → Audio → *Ukur beban CPU* menampilkan beban per blok audio (rata-rata, p50, p99, maks dalam %
  dari waktu blok), jumlah underrun, ukuran buffer, dan latensi output. *Reset statistik* sebelum memutar lagu yang diukur.
- **Tes kesetaraan (golden):** `node tools/golden/golden.mjs` (butuh `cmake` dan `g++`/`clang++`). Skenario yang sama dirender oleh
  engine JS dan engine C++, lalu dibandingkan sampel demi sampel. Lulus bila selisih RMS < −90 dBFS **dan** tidak ada satu sampel pun
  yang selisihnya > −70 dBFS. Skenario yang memakai bagian yang belum di-port ditandai SKIP. `--list` menampilkan semua skenario.

Status port:

| Bagian | Status |
|---|---|
| Transport, loop, tempo/tempo map, birama, metronom, count-in, mixer, send, routing grup, klip audio, automation, CC | selesai, identik |
| Mini Synth, SuperSaw (semua preset bawaan) | selesai, lulus golden |
| GMS, Moisture, Osphere, DirectWave/Keystone/Sampler, Drum Sampler, SoundFont, Wavetable | belum |
| Semua efek audio | belum |
| Ekspor WAV lewat engine native | belum (ekspor memakai engine JS, yang hasilnya identik untuk bagian yang sudah di-port) |
