# Serah-terima pekerjaan (untuk sesi berikutnya)

Branch kerja: `ccr-591624f7-8xa2wb` (repo `jorgi80-droid/MobileDAW`), lanjutan langsung (fast-forward) dari `ccr-9362ed99-sntgvi`,
yang sendiri lanjutan dari `ccr-34212a29-z1qc7f`. Tidak ada riwayat yang ditulis ulang. Semua pekerjaan sudah di-commit.
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
| Perombakan UI Live 12 tahap 2 (Fase 0-8): fondasi CSS/token, control bar + jendela global, internal device, tab Keys, arrangement (tinggi baris, overview, loop brace), Clip View (Transform + Envelopes), mixer (lebar strip, input return, send di header) | selesai (`docs/redesign/11..17-*.jpg`, `docs/redesign/PERF.md`) |
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

## Redesign UI Live 12 tahap 2 - di mana dan bagaimana
- **Token desain** (satu-satunya sumber ukuran): blok `:root` di awal `css/app.css` - jarak `--sp-1..7`, radius `--r-1..4`, tinggi kontrol
  `--ctl-xs/s/ctl/m/l` + `--row` (sentuh minimal `--ctl` = 28 px), huruf `--fs-1..7` + `--fw-*` + `--fs-cap/--ls-cap`, gerak `--d1..d8` x `--anim`
  dan `--e-std/in/out`. CSS baru selalu memakai token. `tools/css-audit.py` mencari aturan mati dan deklarasi yang selalu tertimpa
  (`--write` menghapusnya; cek dulu nama yang dilaporkan, kelas yang dirangkai di JS tidak terlihat).
- **Jendela global** (akhir `css/ableton.css`, blok "Control bar + global windows"): `.modal`, `.pwa-card`, `.toast`, `.fw` memakai title strip,
  tombol Live datar, `.segc` (opsi tergabung), `.b.sw` (switch LED), input = well gelap dengan angka amber. Dialog ekspor (`exportWav` di
  `js/main.js`) memakai kelas `xd-*`, bukan style inline.
- **Device** (blok "Device internals"): skala huruf/tinggi kontrol seragam untuk semua `.card`; tombol device 20 px dengan margin sentuh tak
  terlihat 4-5 px (`::after` + `overflow: clip` + `overflow-clip-margin`; jangan pakai `scale` saat ditekan, itu memperkecil area sentuh).
  Kartu tumbuh setinggi isinya (`min-height: max-content`) dan rantai device bisa digulir, jadi tidak ada yang terpotong di layar pendek.
- **Keys** (`js/keys.js`): bar atas `.kb-bar` (oktaf, switch skala dari `ED.scaleSteps()` / `ED.getTheory()`), `.kb-body` (pitch wheel + piano),
  pad dalam urutan Drum Rack (pad pertama kiri bawah) berwarna track (`--tc`).
- **Arrangement** (`js/timeline.js`): tinggi baris per track = `t.hx` (opsional, faktor terhadap `view.rowH`; `rowTarget()`), hit `rowh` di
  tepi bawah header; loop brace = hit `loop/loopL/loopR` di pita bawah ruler (memakai `P.setLoop`), kecerahan `loopA` dilangkahkan di
  `stepMotion()`; strip overview = elemen `#arr-ov` (index.html) dengan `initOverview()`/`drawOv()` (digambar dari `frame()`).
  Header baris >= 96 px juga menampilkan Send A/B (`r.sa/r.sb` di `hdr()`). `openLaneMenu()` diekspor untuk Clip View.
- **Clip View** (`js/editor.js`): kotak `Transform` (`TOOLS`, `transform()`: Quantize, Humanize, Strum, Arpeggiate, Legato; satu langkah undo)
  dan kotak `Envelopes` (lane otomasi yang menarget track klip + kurvanya di rentang klip).
- **Mixer** (`js/mixer.js`): lebar strip `stripW` (`prefs.mixW`, grip `.mx-grip` di ujung title bar), strip Return menampilkan input (`inp()`).

## Cara menguji UI
- Jalankan server: `python3 -m http.server 8765` di root repo (background).
- Screenshot: `node tools/ui-shots.mjs <folder> [arr] [clip] [dev] [mix] [win] [keys] [devs]` (`THEME=<id>`, `VW`/`VH`); bandingkan dengan run di
  commit lama (mis. `git worktree add /tmp/base <commit>` lalu jalankan alat yang sama di sana). Gabungkan: `node tools/ui-compare.mjs out.jpg "Judul" sebelum.png sesudah.png [...]`.
- Biaya render: `node tools/ui-perf.mjs [detik]` (lihat `docs/redesign/PERF.md`).
- Interaksi: Playwright dengan klik/drag nyata; koordinat mouse dari `locator.boundingBox()` (UI berskala 0,8). Menu dari `ui.menu()` baru
  menerima ketukan 350 ms setelah muncul (`armed()`), jadi tunggu sebelum mengklik itemnya. Tutup popup: `(await import('./js/ui.js')).closeAll()`.

## Peta kode
- UI web: `index.html`, `css/app.css`, `css/live.css`, `css/float.css`, **`css/ableton.css` (dimuat terakhir: tempat semua gaya Ableton baru)**, `js/*.js`.
  Tema warna lewat variabel CSS di `js/theme.js` (9 tema: 4 dasar + 5 turunan seperti tema bawaan Live) - gaya baru harus memakai variabel, bukan warna tetap.
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

## Menunggu keputusan pemilik
- **Instrument / Effect Rack dengan macro**: usulan desain ada di laporan sesi ini (rantai paralel = node "rack" berisi beberapa chain,
  mixer per chain, 8 macro yang memetakan ke parameter device di dalamnya; butuh engine JS + C++ + golden). Belum dikerjakan.
- **Isi klip menyusut otomatis** saat not terakhir dihapus (seperti FL Studio Mobile): sekarang hanya memanjang (`growTo`). Belum dikerjakan.
