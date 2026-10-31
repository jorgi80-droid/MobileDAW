# Serah-terima pekerjaan (untuk sesi berikutnya)

Branch kerja: `ccr-d4b2cd74-5td2k9` (repo `jorgi80-droid/MobileDAW`), lanjutan langsung (fast-forward) dari `ccr-591624f7-8xa2wb` <- `ccr-9362ed99-sntgvi`
<- `ccr-34212a29-z1qc7f`. Tidak ada riwayat yang ditulis ulang. Semua pekerjaan sudah di-commit.
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
| Audio Effect Rack dengan macro (engine JS; port C++ belum) | selesai |
| Instrument Rack (instrumen + efek per chain, zona Key / Vel / Chain, macro) | selesai (instrumen bersampel di dalam chain belum) |
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
- Catatan: UI berskala 0,7 secara default (`prefs.uiScale`, prefs v3 memindahkan pengguna lama ke 70 % sekali), jadi koordinat layar = koordinat CSS x 0,7 saat mengetes klik dengan Playwright.

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
  tepi bawah header (strip overview sudah dihapus atas permintaan pemilik); loop brace = hit `loop/loopL/loopR` di pita bawah ruler (memakai `P.setLoop`), kecerahan `loopA` dilangkahkan di
  `stepMotion()`; Header baris >= 96 px juga menampilkan Send A/B (`r.sa/r.sb` di `hdr()`). `openLaneMenu()` diekspor untuk Clip View.
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

## Panjang pattern & loop (sama di semua DAW)
- Pattern MIDI / drum = bilangan bar penuh: not yang masuk ke bar 9 membuat pattern 9 bar (`wholeBars()` di `js/editor.js`).
- Klip yang ditarik lebih panjang dari pattern mengulang pattern itu (`P.patternLen(c)`): pola 9 bar berulang di bar 10, 19, 28 ...;
  pola 8 bar di bar 9, 17 ... Klip yang dipotong lebih pendek menyimpan panjang pattern (`c.ll`), jadi saat ditarik lagi yang diulang
  tetap seluruh pattern. Memotong klip tidak menghapus not. Editor selalu membuka seluruh pattern (`contentEnd()` = `c.ll` bila ada),
  jadi edit berlaku ke semua pengulangan; pattern yang tumbuh di klip terpotong hanya menambah `c.ll`, panjang klip tetap (`growTo()`).

## Perangkat Live 12 (efek + instrumen) - status pekerjaan
Permintaan pemilik: SEMUA efek dan instrumen diganti dengan set stok Ableton Live 12, tampilan harus sama dengan gambar referensi
(tata letak, UI, bahasa visual), semua kontrol berfungsi, tidak ada tombol dummy. Gambar referensi ada di zip yang diunggah pemilik
(sekarang disimpan di `docs/refs/`).
- Selesai: kit panel `js/fxkit.js` (`kit()`: K knob, T toggle, CH pilihan, S dropdown, N kotak nilai cyan, D display + drag, sec/row/col/sep, swap;
  `V[type]` = panel per efek; `def.kit: true` di defs.js), engine `js/engine/fx3.js` (17-32) dan `js/engine/fx4.js` (33-45), `FX_GROUPS` (kategori
  browser Live 12), `tools/fx-test.mjs` (setiap parameter harus terdengar; `PRE` = prasyarat, `NO_AUDIO`, `TODO`).
  Panel Live 12 jadi: 0 Utility, 1 Auto Filter, 2 EQ Three, 3 Saturator, 4 Compressor, 5 Limiter, 6 Echo, 7 Reverb, 17 Delay, 18 Filter Delay,
  19 Beat Repeat, 20 Chorus-Ensemble, 21 Phaser-Flanger, 22 Auto Pan, 23 Gate, 24 Glue Compressor, 25 Channel EQ, 26 Erosion, 27 Redux,
  28 Vinyl Distortion, 29 Drum Buss, 30 Tuner, 31 EQ Eight, 32 Spectrum (perbandingan: `docs/redesign/20-*.jpg`, `21-*.jpg`).
- Panel Live 12 jadi juga untuk 33-45: Amp, Cabinet, Overdrive, Pedal, Dynamic Tube, Multiband Dynamics, Resonators, Corpus, Vocoder, Shifter,
  Grain Delay, Hybrid Reverb, Looper (perbandingan dengan gambar referensi: `docs/redesign/22-fx-live12-1..3.jpg`). Cabinet, Overdrive, Pedal,
  Dynamic Tube, Shifter, Looper tidak ada di gambar referensi: tata letak mengikuti device Live 12 aslinya.
  Parameter baru (ditambahkan di akhir): Multiband 34-36 Solo per band; Corpus 23-27 LFO Shape / Sync / Sync Rate / Phase / Offset; Vocoder 18-19
  Noise Rate / Crackle (pad XY carrier). Grain Delay: tombol sumbu X/Y adalah status UI per device (`GD` di fxkit.js), bukan parameter.
- fx-test: tidak ada TODO lagi (Corpus Ratio butuh Hit != 50 %, Vocoder Unvoiced / Fast butuh Sens. 100 % sebagai prasyarat); Looper punya tes
  transport sendiri (rekam -> putar -> overdub -> clear). `FX=33,34 node tools/ui-shots.mjs <folder> devs` = screenshot efek tertentu saja.
- Gambar referensi dari pemilik (zip `Ui_Refrences.zip`, 61 gambar: arrangement / clip / efek / instrumen) disimpan di `docs/refs/`.
- Jadi juga: 46 Spectral Time, 47 Spectral Resonator (`js/engine/fx5.js`, STFT bersama `Stft`: Hann, overlap 4x, latensi 2048 sampel), modulator
  48 LFO, 49 Shaper, 50 Envelope Follower (`js/engine/fx6.js`; perbandingan `docs/redesign/23-fx-spectral.jpg`, `24-modulators.jpg`).
  - MIDI ke efek: device dengan `midiIn` (Spectral Resonator mode MIDI) menerima not track sendiri atau track di MIDI From (`core.js midiTo`).
  - Map modulator: `d.map = { s: stripOf, id: device id | 'inst', k }` di project; engine menerima target lewat parameter tersembunyi
    (`MOD_MAP[type]` + 5..11: strip, indeks device (-1 = instrumen), parameter, min, max, log, nilai dasar). `fixMods()` (project.js) menulis
    ulang setiap kali track/device berubah (dipanggil dari `emit`) dan saat nilai target berubah. `core.js applyMod()` menulis nilai ke device
    target tiap blok; `runMods()` menjaga modulator tetap jalan di strip yang diam. Mode Remap (Min..Max) / Mod (sekitar nilai target, ± bipolar).
- fx-test (diperbaiki): dulu noise uji berbeda tiap render sehingga semua parameter tampak "terdengar". Sekarang input identik; prasyarat
  ditulis di `PRE` (sama seperti Live: Attack envelope butuh Env Amount, dst.). Modulator dites lewat pemetaan (remap/mod) di akhir tes.
- Audio Effect Rack (51, jadi; `docs/redesign/25-audio-effect-rack.jpg`): engine `js/engine/fx7.js` (maks 8 chain paralel, mixer per chain
  vol/pan/aktivator/solo, 8 macro dengan Map ke parameter device di dalam rack (Min/Max, kurva log), Chain Select Editor (zona 0..127 per chain
  + Chain Selector)). Perintah engine satu pintu `rackCmd(t, d, op, c, j, a, b)` (0 reset, 1 sisip, 2 parameter, 3 bypass, 4 hapus) lewat
  web.js / worklet.js / engine.js; device di dalam rack dibuat engine (`e.mk(type)`). devOut device di dalam rack: indeks
  `1000 + rack * 256 + chain * 16 + j`. Project: `d.chains = [{ id, name, devices }]`, `d.macroMap[m] = { c, id, k }`; fungsi `rack*` di
  project.js (setiap perubahan struktur = satu langkah undo berupa snapshot, `case 'rack'` di swapRec); `rackSync` dipanggil di semua tempat
  device dikirim ulang ke engine (muat proyek, pindah device, undo). Isi rack: hanya efek kit (tanpa modulator / rack bersarang); device di
  dalam rack tidak punya lane otomasi (pakai macro). UI: `V[51]` di fxkit.js (`ctx.setParam` / `ctx.outD` / `ctx.nested` untuk kartu di dalam).
  `node tools/ui-shots.mjs <folder> rack` = screenshot rack berisi dua chain.
- Instrument Rack (instrumen tipe 12, jadi; `docs/redesign/26-instrument-rack.jpg`): `InstrumentRack` di `js/engine/fx7.js` (turunan rack efek;
  chain = instrumen + efek; not diarahkan per zona Key (122 + 2c) / Vel (138 + 2c) / Chain; note-off ke chain yang menerima note-on; instrumen
  dirender per potongan sampel ke buffer chain, efek + mix sekali per blok lewat `endBlock` yang dipanggil core.js). Parameter rack disimpan di
  `t.inst.params[100 + k]` karena parameter instrumen 90 = Pitch engine (`IRACK_DEF` = definisi tanpa geseran, `INSTRUMENTS[12]` = 100 placeholder
  + IRACK_DEF). Semua fungsi `rack*` di project.js menerima `di = -1` untuk Instrument Rack (`R(i, di)`), plus `rackSetChainInst`,
  `rackInstParam`. Instrumen yang boleh di dalam chain: `IRACK_INSTS` = Mini Synth, SuperSaw, GMS, Moisture, Osphere (tanpa data sampel);
  Sampler / Wavetable / DirectWave / Keystone / SoundFont / Drum belum (butuh data sampel per chain). devOut: 999 = meter chain,
  2000 + chain * 16 + j = efek di dalam. UI: `rackPanel()` di fxkit.js dipakai kedua rack (`irackView()` dari devices.js instCard).
  `node tools/ui-shots.mjs <folder> irack`.
- Belum ada: instrumen bersampel di dalam Instrument Rack, Drum Rack versi rack (pad = chain), External Audio Effect (tidak mungkin di HP).
- Instrumen Live 12: **Simpler jadi** (tipe 18, engine `js/engine/simpler.js`: sampel = zona 0 dari sistem zona (200 + field, `isSampler`/`bigZ`
  di project.js), Classic (start/length/loop + fade, Snap, Voices, Retrig) / 1-Shot (Trigger/Gate, fade in/out) / Slice (Transients /
  Beats / Region dari C1, Mono/Poly), Warp Re-Pitch / Beats (dua grain), filter + circuit, LFO, pitch envelope, glide; panel `VI[18]`
  dengan tab Sample / Controls; `docs/redesign/33-simpler.jpg`). inst-test memberi instrumen `sampler: true` sampel uji di bank slot 0;
  `PRE` boleh berisi `n` (not uji khusus, mis. Slice mulai C1). ui-shots memuat 'Loop Tone.wav' ke instrumen bersampel; `TAB=Controls`.
  Jarak tepi layar: variabel `--edge-x` (22 px) untuk toolbar, bar Device/Clip/Keys, rantai device (permintaan pemilik).
  **Meld jadi** (tipe 17, engine `js/engine/meld.js`: dua engine A/B dengan 8 tipe osilator `MELD_OSC` + macro Shape/Tone,
  filter SVF 12/24 / Ladder / Comb, mix, envelope A/M, LFO 1 + FX (attenuverter, fade-in) + LFO 2, kisi modulasi per engine, Copy to B,
  Poly/Mono, Stack, Spread, Drive, Limit; engine B mulai di indeks 91 agar parameter 90 (Pitch engine) kosong; panel `VI[17]`;
  `docs/redesign/32-meld.jpg`). Format Hz < 10 kini dengan desimal.
  **Poli jadi** (tipe 16, engine `js/engine/poli.js`: saw / pulse / sub / noise / ring, XMod, HPF + Sub boost, LPF 24 dB, envelope
  filter dengan Loop, LFO dengan fade-in, kisi modulasi `POLI_GRID` / `POLI_MIDI`, chorus A/B/C, random pan, glide, Poly/Mono/Unison;
  panel `VI[16]`; `docs/redesign/30-poli.jpg`).
  **Analog jadi** (tipe 15, engine `js/engine/analog.js`: Osc1/Osc2/Noise -> Fil1/Fil2 (F1/F2, To F2, Follow) -> Amp1/Amp2,
  envelope LIN/EXP + Free, LFO1/LFO2 global, unison, glide, legato, vibrato; panel `VI[15]` dengan display kontekstual (ketuk baris = detail
  bagian itu); `docs/redesign/29-analog.jpg`). Parameter instrumen 90 sengaja dibiarkan kosong (Pitch engine).
  **Operator jadi** (tipe 14, engine `js/engine/operator.js`: 4 operator FM, 11 algoritma `OP_ALGOS`, envelope per operator
  dengan Initial / Peak / Loop, filter, Tone, Spread; panel `VI[14]`; `docs/redesign/28-operator.jpg`).
  **Drift jadi** (tipe 13, engine `js/engine/drift.js`, panel `VI[13]` di fxkit.js lewat `instKitView()`; `docs/redesign/27-drift.jpg`).
  Pola instrumen baru: `INSTRUMENTS[n] = { view: 'kit', full: true, params }` (full = project mengirim SEMUA parameter, tersimpan atau default,
  jadi default engine tidak penting); panel `VI[n](k)` memakai kit yang sama dengan efek (`k.get/set/K/S/N/...`, otomasi kind 5);
  `setBend(st)` opsional (core.bend memanggilnya; Drift menskalakan dengan PB Range). Tes: `tools/inst-test.mjs` (setiap parameter harus
  terdengar, `PRE` / `NO_AUDIO` per instrumen, plus tes khusus PB Range / Legato), ikut `run-tests`. "Note PB" Drift tidak dibuat (butuh MPE).
  Belum: Wavetable (redesign), Sampler (redesign), Drum Rack (redesign), Impulse, Electric, Collision,
  Tension, Granulator III, DS Kick / Snare / Tom / HH / Clap / FM. Tipe instrumen lama tetap bisa dimuat (proyek lama).
- Aturan: parameter baru selalu DITAMBAHKAN di akhir (indeks lama tetap), `migrate()` bila arti berubah; efek tanpa padanan Live 12 masuk
  'Lainnya (lama)'; native engine otomatis kembali ke engine web untuk device yang belum di-port.

## Kerapian panel efek (sesi ini)
- Beat Repeat, Delay, Echo, Auto Filter, Auto Pan, Chorus-Ensemble, Phaser-Flanger, Drum Buss ditata ulang mengikuti gambar referensi
  (nilai di dalam display gelap, tombol Sync/Time gaya Live `syncBtn`, ikon bentuk gelombang `icoChoice`, grid 16th urut kolom `g2c`);
  `docs/redesign/31-fx-rapi-*.jpg`. Badan panel: kolom sama tinggi dan isi dipusatkan vertikal (`.lkcard > .lk`), jadi kontrol bawah
  (Dry/Wet, Feedback) sejajar seperti di Live. Screenshot per kartu: `CARD=1 FX=17 node tools/ui-shots.mjs <folder> devs` (file `card-<tipe>.png`).

## Menunggu keputusan pemilik
- **Instrument / Effect Rack dengan macro**: usulan desain ada di laporan sesi ini (rantai paralel = node "rack" berisi beberapa chain,
  mixer per chain, 8 macro yang memetakan ke parameter device di dalamnya; butuh engine JS + C++ + golden). Belum dikerjakan.
- **Isi klip menyusut otomatis** saat not terakhir dihapus (seperti FL Studio Mobile): sekarang hanya memanjang (`growTo`). Belum dikerjakan.
