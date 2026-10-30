# Serah-terima pekerjaan (untuk sesi berikutnya)

Branch kerja: `ccr-9362ed99-sntgvi` (repo `jorgi80-droid/MobileDAW`), lanjutan langsung dari `ccr-34212a29-z1qc7f` (fast-forward,
tidak ada riwayat yang ditulis ulang). Semua pekerjaan sudah di-commit.
Baca juga `README-ANDROID.md` (build, install, status fase 2).

## Aturan kerja dari pemilik proyek
- Jangan merusak fitur yang ada; proyek `.mdaw` lama (termasuk v:2) harus tetap terbuka; app tetap jalan offline.
- Versi web/PWA harus tetap berfungsi; semua perilaku khusus Android di balik `isNativeApp()` (`js/native.js`).
- Setiap file JS yang diubah: `node --check`. Akhir tiap langkah: `node tools/run-tests.mjs` dan `node tools/golden/golden.mjs`.
- File web baru: daftarkan di `ASSETS` di `sw.js`, lalu `node tools/build.mjs`.
- Commit rapi per langkah, push ke branch di atas. Laporan ke pemilik dalam bahasa Indonesia.

## Status
| Bagian | Status |
|---|---|
| Fase 1 (APK Capacitor, ekspor ke Documents + Share, folder MobileDAW via SAF, fullscreen, keep-awake, CI) | selesai, dites pemilik di HP |
| Engine C++ inti (transport, tempo map, birama, metronom, count-in, mixer, send, routing, klip audio, automation, CC) | selesai, identik bit dengan JS |
| Instrumen C++: Mini Synth, SuperSaw | selesai, lulus golden (semua preset) |
| Bridge Android: Oboe + JNI + antrian lock-free, LatencyTuner, pilihan engine Web/Native, fallback otomatis, statistik CPU | selesai, build OK |
| UI: toolbar ringkas simetris, meter FPS|CPU, Pengaturan gaya Preferences Live, jendela Tempo, slider, blur hanya di belakang jendela | selesai |
| UI gaya Ableton Live 12: Arrangement, Clip View (panel properti + piano roll + lane velocity), Mixer, Device chain | selesai (perbandingan di `docs/redesign/*.jpg`) |
| UI Live 12 lanjutan: menu konteks + action bar, Clip View audio (kotak Audio/Pitch/Warp/Region), Fold piano roll, tampilan Drum Rack, Browser (sidebar Library + Places) | selesai (`docs/redesign/6..10-*.jpg`) |
| Logika bar & loop gaya FL Studio Mobile (editor terbuka ke kanan, isi klip tumbuh per bar, klip loop diedit sebagai sumber loop, "Lepas loop") | selesai (`docs/redesign/5-*.jpg`) |
| **Instrument / Effect Rack dengan macro (fitur baru: butuh rantai paralel di engine JS + C++ dan golden test)** | **belum** |
| **Port C++: GMS, Moisture, Osphere, DirectWave/Keystone/Sampler, Drum Sampler, SoundFont, Wavetable** | **belum** |
| **Port C++: semua efek (Utility, EQ Three, Parametric EQ, Compressor, Limiter, Saturator, Auto Filter, Echo, Reverb, Roar, Autoduck, Stereolizer, Spacer, Level/Analyzer/MiniMeters)** | **belum** |
| Ekspor WAV lewat engine native; angka CPU/underrun Web vs Native dari HP | belum |

## Redesign UI Live 12 (sesi ini) - di mana dan bagaimana
- Arrangement (`js/timeline.js`, satu canvas + overlay): konstanta tata letak di atas file (`RULER` = strip locator `MROW` + beat ruler,
  `BOT` = time ruler bawah, `TH` = title bar header, `METW` = meter header; `HEAD` dipilih `fit()` dari lebar layar). Header track: `hdr(i)`
  (title bar warna track, tombol activator/S/arm/In/A, slider vol/pan bila baris >= 70 px); Master/FX: `xhdr(i)`. Animasi: `fh` (tinggi baris
  saat lipat/buka, `animRow()` dipanggil SEBELUM `t.fold` berubah), `gl` (klip meluncur ke posisi snap, `glideClip()` sebelum `c.start/len`
  berubah); keduanya dilangkahkan di `stepMotion()`. Beat ruler: seret vertikal = zoom (gaya Live), horizontal = time selection.
- Clip View (`js/editor.js`): panel properti kiri dibangun `buildProps()` (kotak Clip/Notes/Scale/Drum/Envelope/Sample, `numBox()` = number
  box Live: seret = ubah nilai dengan satu langkah undo, ketuk = daftar). Toolbar hanya perintah tampilan. Lane bawah: `drawVel()` +
  `laneChooser()`, garis pemisah bisa diseret (`cfg.velH`). Fit meluncur + fling: `emo`, `stepEd()`.
- Mixer (`js/mixer.js`): strip `.mxs` dengan bagian bertinggi tetap (`.mx-io`, `.mx-sends`, `.mx-pan`, `.mx-btns`) supaya baris sejajar;
  fader drag relatif, tutup fader meluncur (`st.fpos`).
- Device (`js/devices.js`): menu `⋯` per device, ketuk-ganda title bar = lipat, nama instrumen = pemilih instrumen; `render()` menjaga posisi
  scroll dan memakai FLIP (`flip()`) untuk geser/lipat/hapus/tambah.
- Logika bar/loop (`js/editor.js`, blok "Pattern length"): `contentEnd(c)` = panjang isi (loop source bila klip di-loop), `growTo(c, end)`
  memperpanjang isi per bar penuh (klip loop: `c.ll` bertambah; bila mencapai `c.len`, loop hilang dan klip memanjang), `grew()` = sesudah
  edit diskrit (panel + arrangement ikut). Editor TIDAK lagi memanggil `bakeLoop` saat dibuka; pengulangan digambar sebagai ghost.
  "Lepas loop" = `P.bakeLoop` (panel Clip + action bar klip). Step grid: `clampSteps()`, `fitSteps()` (isi + 1 bar terbuka).
- Fold (`cfg.fold`): baris diindeks `rI(p)` / `rP(i)`; `foldRows` dihitung saat menggambar (tidak saat drag).
- Audio: `AE.panel(ui)` membangun kotak panel kiri; `AE.onPanel()` memberi tahu editor saat kontrol audio dibangun ulang.
- CSS semua bagian ini ada di akhir `css/ableton.css` (berurutan: Arrangement, Clip View, Mixer, Device View, menu, audio, Drum Rack, Browser).
- Screenshot untuk membandingkan: `node tools/ui-shots.mjs <folder> [arr] [clip] [dev] [mix]` (server statis + Chromium Playwright bawaan,
  proyek uji tetap; `THEME=light`, `VW`/`VH` untuk ukuran). Jalankan sekali di commit lama dan sekali di working tree, lalu bandingkan.
- Catatan: UI berskala 0,8 (`prefs.uiScale`), jadi koordinat layar = koordinat CSS x 0,8 saat mengetes klik dengan Playwright.

## Peta kode
- UI web: `index.html`, `css/app.css`, `css/live.css`, `css/float.css`, **`css/ableton.css` (dimuat terakhir: tempat semua gaya Ableton baru)**, `js/*.js`.
  Tema warna lewat variabel CSS di `js/theme.js` (4 tema: Gelap, Live, Terang, Hitam) - gaya baru harus memakai variabel, bukan warna tetap.
- Engine JS (referensi): `js/engine/core.js`, `instruments.js`, `live.js`, `fx.js`, `fx2.js`, `dsp.js`, `sf2.js`, `tmap.js`, `meter.js`.
- Engine C++: `native/engine/` (`engine.cpp` = core.js, `instruments.cpp`, `dsp.h`, `commands.cpp`, `units.cpp` = registry port).
  Aturan numerik di `native/engine/jsmath.h`: buffer float, matematika double, urutan operasi sama dengan JS, `-ffp-contract=off`, `jsRound`.
  Audio thread tidak boleh alokasi: objek dibuat di `prepare()` (commands.cpp), diganti di `apply()`, yang lama ke retire queue.
- Golden test: `tools/golden/golden.mjs` + `scenarios.mjs` (skenario `presets-<instrumen>` dan `play-<instrumen>` dibuat otomatis untuk
  instrumen di `SYNTHS`). Lulus: RMS selisih < -90 dBFS dan tiap sampel < -70 dBFS. Bagian belum di-port = SKIP.
- Android: `android/app/src/main/java/com/mobiledaw/app/` (`MainActivity`, `DawFolderPlugin`, `NativeEnginePlugin`), `android/app/src/main/cpp/bridge.cpp`.
- Jembatan JS: `js/engine/nativesink.js`, `js/engine/cmdtext.js`; logika Web/Native di `js/engine/web.js` (cari `nat.`).

## Cara port satu instrumen / efek (pola yang sudah terbukti)
1. Baca kelas JS-nya; tulis kelas C++ di `instruments.cpp`/`instruments.h` (atau file efek baru) dengan nama dan urutan operasi sama.
2. Daftarkan di `units.cpp` (`makeInstrument`/`makeDevice` + `instPorted`/`devPorted`); file baru ke `native/CMakeLists.txt`.
3. `Math.random` di `fx2.js` (Auto Filter S&H, Roar noise) harus diganti LCG berseed di JS dan C++ sebelum efek itu di-port.
4. Tambah skenario golden (instrumen: masukkan tipe ke `SYNTHS`; efek: buat skenario baru dengan semua preset/parameter).
5. `node tools/golden/golden.mjs <skenario>` sampai lulus, lalu `node tools/run-tests.mjs`, commit, push, cek CI.

## Catatan UI dari pemilik (harus dipenuhi)
- Bahasa desain Ableton Live 12 untuk SEMUA bagian, presisi, simetris, rapi, tidak bertumpuk, animasi halus (target >90 fps).
- Referensi: manual Live 12 - arrangement-view, clip-view, audio-clips-tempo-and-warping, editing-midi, mixing,
  working-with-instruments-and-effects, instrument-drum-and-effect-racks, live-concepts (ableton.com/en/live-manual/12/...).
- Toolbar hanya: Browser, Tempo, Undo/Redo | Play/Pause, Rekam, Metronom | FPS+CPU, Arrange/Mixer, menu.
- Klip yang dipilih tidak boleh ikut buram saat ada popup aksi klip.
