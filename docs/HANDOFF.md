# Serah-terima pekerjaan (untuk sesi berikutnya)

Branch kerja: `ccr-34212a29-z1qc7f` (repo `jorgi80-droid/MobileDAW`). Semua pekerjaan sudah di-commit dan CI hijau.
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
| **UI gaya Ableton Live 12 untuk Arrangement, Clip View/piano roll, Mixer, Device/Rack, menu konteks, browser** | **belum** |
| **Port C++: GMS, Moisture, Osphere, DirectWave/Keystone/Sampler, Drum Sampler, SoundFont, Wavetable** | **belum** |
| **Port C++: semua efek (Utility, EQ Three, Parametric EQ, Compressor, Limiter, Saturator, Auto Filter, Echo, Reverb, Roar, Autoduck, Stereolizer, Spacer, Level/Analyzer/MiniMeters)** | **belum** |
| Ekspor WAV lewat engine native; angka CPU/underrun Web vs Native dari HP | belum |

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
