# Serah-terima pekerjaan (untuk sesi berikutnya)

Branch kerja: `claude/gesture-logic-editor-clip-18jqqv` (lanjutan fast-forward dari `ccr-49b1b317-5ba57j` <- `ccr-d4b2cd74-5td2k9`) (repo `jorgi80-droid/MobileDAW`), lanjutan langsung (fast-forward) dari `ccr-591624f7-8xa2wb` <- `ccr-9362ed99-sntgvi`
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
| Port C++: DS Kick/Snare/Tom/HH/Clap/FM, Electric, Tension, Collision, Impulse, Granulator III (`native/engine/inst_live.*`) | selesai, identik bit (golden `play-*`, `params-*`) |
| Port C++: Drift (`drift.*`), Poli (`poli.*`); engine C++ kini mendukung `setBend` (PB Range per instrumen) | selesai, golden `play-*` / `params-*` |
| Port C++: Operator, Analog, Meld, Simpler (`operator.*`, `analog.*`, `meld.*`, `simpler.*`) | selesai, golden `play-*` / `params-*` |
| Port C++: GMS, Moisture, Osphere, DirectWave/Keystone, Sampler (10), Drum Sampler (+ chain per pad), SoundFont, Wavetable, Instrument Rack | selesai (golden `presets-*`, `play-*`, `inst-sampler`, `inst-livesampler`, `inst-drums`, `inst-irack`, `demo-*`) |
| Port C++: Utility, Auto Filter, EQ Three, Saturator (oversampler 4x), Compressor, Limiter, Echo, Reverb, Parametric EQ, Roar (`native/engine/fx*.{h,cpp}`) | selesai, identik bit (golden `fx-*`) |
| Port C++: seluruh fx3.js (Delay ... Spectrum, 16 efek, `fx3*.{h,cpp}`); engine C++ memanggil `tr()` untuk efek tersinkron bar | selesai, golden `fx-*` identik |
| Port C++: seluruh fx4.js (Amp .. Looper, 13 efek, `fx4.{h,cpp}`) | selesai, golden `fx-*` identik |
| Port C++: Autoduck (sidechain lewat `eng.sc`), Stereolizer, Spacer (`native/engine/fxu.*`) | selesai, golden `fx-autoduck`, `fx-autoduck-sc`, `fx-stereolizer`, `fx-spacer` identik |
| Port C++: Level/Analyzer/MiniMeters, fx5 (Spectral), fx6 (modulator + Map), Audio Effect Rack | selesai (golden `fx-*`, `fx-modulators`, `fx-rack`, `fx-spectral-midi`) — SEMUA instrumen dan efek kini punya port C++ |
| Arrangement gaya gambar pemilik: klip warna penuh + isi gelap, fade klip audio + handle (seret), locator outline, garis track tebal, palet warna Live jenuh | selesai (`docs/redesign/40-*.jpg`) |
| Drum Rack: chain per pad (instrumen + efek di pad, `pad.chain`; engine `DrumSynth.cmd/endBlock`, project `setPadChainInst / padChain*`, UI `padChainView` di fxkit.js, tes `tools/drumrack-test.mjs`) | selesai (`docs/redesign/39-drumrack-chain.png`) |
| Ekspor WAV lewat engine native; angka CPU/underrun Web vs Native dari HP | belum |
| Plugin Delay Compensation (PDC): track, send/return, grup, master, chain paralel rack, metronom + count-in, ekspor, rekaman; JS + C++ identik | selesai (`tools/pdc-test.mjs`, golden `core-pdc`, `tools/engine-e2e.mjs`) |
| Ekspor: Mono, pilihan sample rate (resampler Kaiser HQ), rentang Area loop | selesai (`tools/export-test.mjs`) |

## Sesi lanjutan: port C++ lengkap, warp mode, SharedArrayBuffer, profil performa
- **Port C++ selesai untuk semua unit** (`native/engine/`): `fx5.*` (Spectral Time/Resonator: STFT + FFT sama dengan dsp.js, `jsHypot` = Math.hypot V8,
  MIDI ke efek `midiScan/midiTo`), `fx6.*` (LFO/Shaper/Envelope Follower; engine `applyMod/runMods`), `fx7.*` (Audio Effect Rack + Instrument Rack;
  perintah `rackCmd` dengan objek siap-pakai kedua `Cmd::p2` untuk instrumen chain), `inst_classic.*` (Sampler/DirectWave/Keystone, Moisture, Osphere,
  GMS, SoundFont, Drum Sampler + chain per pad), `live.*` (Sampler 10, Wavetable 11), `fxm.*` (Level/Analyzer/MiniMeters + Loudness BS.1770).
  - SoundFont ke native: perintah `sf id data rates zones counts` (`cmdtext.js sfArgs`); Android mengirim data lewat kanal sampel sebagai slot
    1000 + id (bridge `stageSoundFont`), lalu `sf id u ...`.
  - Wavetable: 34 set frame dibangun di `commands.cpp prepare` (`wtEnsure`) saat track mendapat instrumen 11 / memilih tabel — tidak pernah di audio thread.
  - **Bug referensi JS diperbaiki**: `DrumSynth.noteOn` — `v.ed = q.d; v.es = q.s; v.er = q.r;` tertelan komentar, jadi Decay/Sustain/Release pad
    sampel tidak berfungsi.
  - Display device di mode native: bridge mengambil readout device yang ditonton per snapshot (`nWatch` / `nDevOut`), poll membawanya (dulu kosong).
  - web.js: `nat.rk` mencatat tipe di dalam rack (instrumen = 1000 + tipe) untuk fallback otomatis.
- **Warp mode klip audio** (`js/engine/audioops.js`, `c.warp.mode`): `beats` WSOLA (bawaan, proyek lama sama), `tones` phase vocoder 4096 / 4x overlap,
  identity phase locking, fase dari mid (stereo terjaga), *transient lock* (frame yang memuat onset disalin 1:1 dan diposisikan agar serangan jatuh
  tepat: error 0,0 ms, tanpa pre-echo), `repitch` resample. Resampler HQ memakai tabel polifase. Panel Warp: baris **Mode**. Tes `tools/stretch-test.mjs`.
- **SharedArrayBuffer** (`js/engine/sabio.js`): ring perintah SPSC (perintah skalar) + blok poll dengan seqlock (posisi, CPU, PDC, meter, load, 8
  readout device). Urutan dijaga dengan nomor urut di setiap perintah (ring dikuras sampai nomor pesan sebelum pesan diterapkan). Aktif hanya bila
  `crossOriginIsolated` (header COOP/COEP di `vercel.json`); WebView Android dan server tanpa header memakai postMessage seperti dulu.
  `Pengaturan` log menulis kanal yang dipakai; `eng.channel()`. Tes `tools/sab-test.mjs`, `ISOLATED=1 node tools/engine-e2e.mjs`.
- **Profil performa + tes perangkat** (`js/perf.js`, Pengaturan -> Audio -> Performa perangkat): profil Otomatis/Rendah/Menengah/Tinggi (buffer
  `latencyHint`, fps UI, reduce motion, Native bila ada), tes ~30 dtk: benchmark engine offline + tes langsung di instance worklet kedua yang senyap
  (CPU audio dari worklet, underrun dari `AudioContext.playbackStats` bila browser punya) + statistik native; laporan teks bisa disimpan ke
  `/Exports/perf-*.txt`. `PERF=1 node tools/engine-e2e.mjs` menjalankannya di Chromium desktop.
- **Belum**: angka dari HP sungguhan (pemilik perlu menjalankan *Tes performa perangkat* di HP kelas rendah/menengah/tinggi dan mengirim laporannya);
  build bridge Android hanya diverifikasi oleh CI APK.

## Plugin Delay Compensation (PDC) + opsi ekspor (sesi ini)
- **Laporan latensi**: device dengan latensi punya `lat()` (frame): Saturator `OS4_LATENCY` (37, oversampler 4x, wet + dry), Compressor
  Lookahead (`la`: 0 / 1 / 10 ms), Limiter (`latency`, 1,5 ms), Spectral Time / Spectral Resonator (`Stft.latency` = N = 2048, diukur), Audio
  Effect Rack / Instrument Rack = chain paling lambat. C++: `Device::lat()` (units.h), sama untuk Saturator / Compressor / Limiter. Semua angka
  dicek dengan impuls di `tools/pdc-test.mjs` (dilaporkan == terukur). Device yang di-bypass tidak dihitung (tidak menunda sinyal).
- **Rencana per blok** `Engine.pdcPlan()` (core.js + engine.cpp, dipanggil di awal `chunk()` dan count-in): `chainLat(dev)` per strip;
  track yang bisa berbunyi (punya instrumen / klip) ditunda ke track paling lambat (`pdcMt`), return ditunda ke return paling lambat (`pdcMr`),
  bus langsung ke master (`mixL/mixR` sebelum return ditambahkan) ditunda `pdcMr`. Jadi semua jalur (langsung, send, grup `trackOut`) tiba
  di master dengan `pdcMt + pdcMr`. Metronom (dan count-in) ditunda `pdcClk = pdcMt + pdcMr + rantai master` (`ClickLine`, double).
  `pdcOut = pdcClk + limiter output` = berapa frame output tertinggal dari posisi lagu (`pdcLatency()`; worklet mengirim `lat` di poll, bridge
  Android menaruhnya di akhir snapshot).
- **Ring delay** `PdcLine` / `ClickLine` (dsp.js; C++ di engine.h dengan memori `calloc` sekali di konstruktor, halaman yang tak dipakai tidak
  memakan RAM): ukuran tumbuh 512 .. `PDC_MAX` (16384) hanya saat delay lebih panjang dibutuhkan, mulai dari hening (JS dan C++ sama persis).
  Jalur yang diam / di-mute / dilewati mengosongkan ring-nya (`clear()`), jadi audio basi tidak pernah keluar saat jalur aktif lagi.
  Delay 0 = jalur tidak disentuh: proyek tanpa device berlatensi identik bit dengan sebelum PDC (tes 7 di pdc-test).
- **Rack**: `AudioEffectRack.align()` menunda chain yang lebih cepat ke chain paling lambat (semua chain yang ada dihitung, jadi menyalakan /
  mematikan chain tidak menggeser timing). Rack belum di-port C++ (fallback Web seperti sebelumnya).
- **Perintah** `setPdc(on)` (worklet, OfflineTarget `pdc()`, commands.cpp `SETPDC`), pref `pdc` (default on), Pengaturan -> Audio -> Master.
- **Ekspor**: `preroll()` di web.js merender lalu membuang `pdcLatency()` frame, jadi frame 0 file = posisi awal; mix dan stem (stem tanpa
  limiter output) tetap sejajar sampel. **Rekaman**: offset klip rekaman = `latencyMs` + `pdcMs()` (pemain mendengar lagu terlambat sebanyak itu).
- **Sidechain** (`eng.sc`) membaca sinyal track SETELAH kompensasi. Batas yang diketahui: device sidechain (Autoduck) di track yang
  sinyalnya sendiri belum dikompensasi bisa melihat pemicu terlambat `pd` frame (sama seperti banyak DAW tanpa "sidechain PDC").
- **Opsi ekspor baru** (`exportWav()` di main.js, `finishRender()` di wav.js): Kanal Stereo / Mono ((L + R) / 2), Sample rate Perangkat / 44,1 /
  48 / 88,2 / 96 kHz (WAV; engine tetap merender di rate perangkat lalu `Resampler(from, to, true)` = 64 tap per sisi, jendela Kaiser beta 9,
  pass band 0,91 Nyquist: 18 kHz rata, 23 kHz -> 44,1 kHz teredam habis), Rentang "Area loop". Pref `exportCh`, `exportRate`.
  MP3 tetap memakai resampler lama (output MP3 tidak berubah).
- Tes: `tools/pdc-test.mjs`, `tools/export-test.mjs` (keduanya di run-tests), golden `core-pdc` (identik), `tools/engine-e2e.mjs` (Chromium
  sungguhan: latensi dari worklet + ekspor mono 44,1 kHz 24-bit; butuh Playwright, tidak di CI).

## Gestur klip + editor layar penuh (logika FL Studio Mobile, sesi ini)
- Tombol tab **Clip dihapus**: bar bawah hanya Device dan Keys. Editor klip (piano roll / drum step / audio editor / titik otomasi) dibuka lewat
  **ketuk-ganda klip** atau item **Edit** (paling atas) di menu klip, SELALU layar penuh (`openEditor()` / `closeEditor()` di `js/main.js`,
  kelas `#view-arr.edfull` + `max`). Tutup: tombol ✕ (`#btn-edclose`) di bar tab, tombol Back, atau ketuk Device / Keys (kembali ke tab
  sebelumnya, panel tertutup lagi bila sebelumnya tertutup). Klip yang diedit hilang (hapus / undo) = editor tertutup sendiri.
- **Ketuk-ganda ruang kosong** di baris track = klip baru 1 bar mulai di bar di bawah jari (`newClipAt()` di `js/timeline.js`; dipendekkan agar
  tidak menabrak klip berikutnya; track audio membuka pemilih sample di bar itu).
- Ketuk klip terpilih = menu klip, tapi ditunda `DTAP_MS` (330 ms) agar ketukan kedua (ketuk-ganda) membatalkannya dan membuka editor.
  Tombol `⋯` di klip tetap membuka menu seketika. Uji: `TL.openEditor()` (diekspor) dipakai `tools/ui-shots.mjs` dan `tools/ui-perf.mjs`.
- Bar Device / Keys saat panel tertutup 12 px lebih tinggi (36 px, akhir `css/ableton.css`), sesuai gambar referensi pemilik.

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
- Logika bar/loop (`js/editor.js`, blok "Pattern length"): `contentEnd(c)` = panjang isi (loop source bila klip di-loop), `P.fitPattern(c, kind)`
  mengukur ulang pattern setelah tiap edit (lihat "Panjang pattern & loop"); `grew()` tinggal stub untuk pemanggil lama. Editor TIDAK lagi memanggil `bakeLoop` saat dibuka; pengulangan digambar sebagai ghost.
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

## Tahap output engine (sesi ini)
- **Limiter pengaman master**: `core.js` / `engine.cpp` menjalankan device Limiter (tipe 5: look-ahead 1,5 ms, ceiling -0,3 dBFS, release
  80 ms) pada `mixL/mixR` setelah fader master, sebelum output (dulu hard clip di +-1). Perintah engine `masterLimit(on)` (worklet, web.js,
  OfflineTarget, commands.cpp, engine.js lama); pref `masterLimit` (default on) di Pengaturan -> Audio -> Master. Ekspor mix memakai status
  yang sama, stem selalu tanpa limiter. Golden `core-limiter` (mix +10 dB di atas 0 dBFS, on/off/on).
- **Mute / solo tanpa klik**: strip punya `mg` (fade mute/solo, konstanta 1,5 ms, `mgK`); strip baru benar-benar diam (allOff) setelah
  `mg < 1e-4`. **Send di-smooth** (`sg0/sg1`, koefisien sama dengan fader). JS + C++ identik; golden `core-mute-fade`; `tools/click-test.mjs`.
- **Osilator band-limited v2** (`polyBlep` di dsp.js + dsp.h, dipakai Mini Synth, SuperSaw, Analog, Drift, Meld, Poli, Wavetable lama):
  step sinc 16 sampel berjendela Blackman (cutoff 19,5 kHz, tabel `blepInit(sr)` dibuat di konstruktor Engine). Aliasing saw/square
  -30 dB -> -94..-100 dB, high-end rata. Biaya: SuperSaw 12 voice 1,9 -> 3,3 % real time (desktop). `tools/alias-test.mjs`.
- **Retrigger tanpa klik**: `Adsr.start()` (dsp.js + dsp.h) tidak lagi mengembalikan level ke 0; voice yang di-retrigger / dicuri naik dari
  level saat ini. Golden `core-retrigger`.

## Suara drum step + DirectWave (sesi ini)
- Kit bawaan Drum Sampler (`DrumSynth`, `js/engine/instruments.js`, pad 36 kick / 38 snare / 39 clap / 42 closed hat / 46 open hat / 41 tom)
  ditulis ulang gaya 909/808: transien (klik beater, senar snare, stick), badan dengan sapuan pitch, saturasi lembut `satN()` (harmonik
  yang bisa dimainkan speaker HP), hat = 6 osilator kotak rasio 808 lewat band-pass + high-pass. Balance mix `KIT_MIX` (kick -5,6 dBFS
  puncak, hat ~9 dB di bawahnya; satu beat penuh tetap di bawah 0 dBFS). Semua deterministik (lcg).
- Sampel (pad Drum Sampler dan DirectWave / Keystone): interpolasi Hermite 4 titik `herm()`, velocity 1 = unity (pad gain 1; DirectWave
  Gain 80 % = unity, `SMP_UNITY`), attack <= 2 ms = instan (0,12 ms anti-klik), Cutoff >= 18 kHz = tanpa filter, di bawahnya LP 12 dB
  (biquad, dulu 1-pole yang selalu aktif), voice yang dicuri fade 1,5 ms. DirectWave parameter baru 6 **Mode** Gate / One-shot (+ preset
  "One-Shot Drum"). Keduanya tetap engine Web (belum di-port C++).
- Ukur / tes: `node tools/drum-punch.mjs [--check]` (level, transien, pita 150-500 Hz, ekor, beat penuh tanpa clipping; di run-tests).

## Pattern clip (MIDI / drum): model data, panjang, pengulangan (audit + perbaikan sesi ini)
Empat hal terpisah (project.js, blok "pattern clips"):
- **Data pattern** `c.notes` / `c.cc` = sumber; pengulangan TIDAK pernah menyalinnya. Hanya "Lepas loop" / "Unlink Loop" / "Ulangi" (atas
  permintaan) yang mengubah pengulangan menjadi not biasa (`bakeLoop`, sekarang ikut `c.lp` dan lane CC).
- **Panjang sumber (siklus)** `P.patternOf(c)` = `c.ll` bila ada, kalau tidak `c.len`.
- **Panjang klip** `c.len` (instance di arrangement; boleh berakhir di tengah siklus).
- **Posisi loop** `c.lp` = di mana klip mulai di dalam siklus (trim kiri / split). Pemutaran: `sourcePos = (local + lp) % siklus`.
  `P.loopSegs(c)` memberi potongan-potongannya; `P.clipNoteEvents(c, kind, f)` = daftar event yang dikirim `syncClips` ke engine JS dan C++
  (satu event per not per siklus, dipotong di akhir siklus / klip: tidak ada not menggantung atau terpicu dua kali). Engine tidak diubah:
  ia tetap menerima daftar event datar (identik dengan algoritma lama untuk klip tanpa `lp`, dites pada 300 klip acak).
Auto vs manual:
- `c.pb` = panjang dasar pattern (saat dibuat, atau dipilih di baris **Pattern** panel Clip). Panjang otomatis = `P.autoPattern(c)` =
  dasar yang tumbuh untuk memuat semua not / titik CC, dibulatkan: piano roll 1, 4, 8, 16 ... 1024 bar (`P.PATTERN_BARS`), drum step bar
  bulat apa saja. `P.fitPattern(c, kind)` dipanggil setelah SETIAP edit not (tumbuh DAN menyusut, tidak pernah di bawah dasar, tidak
  memindah / menghapus not; bar kosong di tengah tetap).
- `c.cm` = panjang klip diatur tangan (resize kanan/kiri, grup, panel "Panjang"; `P.setClipLength`). Klip manual tidak pernah dipendekkan /
  dipanjangkan oleh edit not, hanya siklusnya (`c.ll`) yang berubah. Klip tanpa `cm` mengikuti pattern-nya (len = siklus).
- Proyek lama tanpa `pb`: piano roll mulai dari 1 bar (siklus dari not), drum memakai panjang yang dimilikinya (`basePattern`). Klip lama
  dengan `ll != len` atau `lp` dianggap manual (`P.clipManual`).
- Panel Clip: "Panjang" = panjang klip (tidak lagi menghapus not di luar panjang baru untuk klip pattern), "Pattern" = panjang siklus manual
  (menu ukuran yang sah; "Otomatis (dari not)" = dasar 1 bar), "Loop" = siklus x pengulangan, "Lepas loop".
- Arrangement: resize kanan/kiri/grup hanya mengubah `len` (+ `lp` untuk trim kiri), snap seperti biasa; trim kiri dan split klip ber-loop
  tidak lagi melakukan `bakeLoop`. Split klip biasa (tanpa loop) tetap membagi not ke kedua bagian seperti dulu.
- Editor: menampilkan sumber dari 0; klip = jendela `[lp, lp + len)` (`winOf()`), pengulangan sebagai ghost, playhead / follow / seek ikut `lp`.
- Tes: `tools/pattern-test.mjs` (di run-tests; semua kasus spesifikasi + regresi), `tools/pattern-ui-test.mjs` (Chromium emulasi Pixel 7,
  sentuhan nyata; butuh Playwright + Chromium, tidak di CI), bagian "pattern sizes" di `tools/clipview-test.mjs`.
- Uji UI: `TL.probe(tick, track)` dan `ED.probe(tick, pitch)` memberi koordinat layout; kirim PointerEvent `pointerType: 'touch'` dengan
  koordinat x `emuK()` (shim skala UI membaginya kembali).

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
  **Wavetable didesain ulang** (tipe 11, engine lama tidak berubah; `view: 'kit'`, panel `VI[11]` di fxkit.js; tiga baris selebar sama:
  Osc 1 | Osc 2 | Sub, Amp / Env 2 / Env 3 / LFO 1 / LFO 2, Filter | Filter 2 | Matrix | Unison+Global; `docs/redesign/34-wavetable.jpg`).
  `wavetablePanel` di liveinst.js tidak dipakai lagi (hanya cadangan untuk view 'lwavetable').
  **Simpler ditata ulang**: tab Controls = grid 3 x 2 (display di atas strip kontrolnya), tab Sample satu baris bawah, kedua tab sama ukuran
  (`docs/redesign/33-simpler-rapi.jpg`, CSS `.lk-simp/.lk-sgrid`). Pola grid ini (`.lk-dk` + `.lk-sev` + `.lk-shead`) dipakai untuk panel berikutnya.
  **Sesi ini juga jadi**: Sampler (tata letak Live 12, `docs/redesign/37-*.jpg`), Drum Rack (pad 4 x 4 dengan M / ▶ / S, panel pad
  terpilih), jendela mengambang (header kartu = bar judul jendela lewat `mergeHead` di floatwin.js, nama tampil sekali, tombol jendela
  satu grup; `38-float.png`), instrumen baru: DS Kick / Snare / Tom / HH / Clap / FM (19..24, `js/engine/ds.js`), Electric 25, Tension 26,
  Collision 27 (`js/engine/phys.js`), Impulse 28 (`js/engine/impulse.js`, 8 slot = zona 0..7, C3..G3, parameter slot 92 + k * 13 + f),
  Granulator III 29 (`js/engine/granulator.js`, zona 0). Perbandingan: `docs/redesign/35-*.jpg`, `36-*.jpg`. Semua lulus inst-test.
  Pola panel: `hitDisp()` di fxkit.js menggambar bunyi dari engine asli (render offline) - ketuk = audisi.
  Belum: port C++ untuk semua instrumen / efek baru (engine native otomatis kembali ke Web), Drum Rack dengan chain per pad,
  dan External Instrument (tidak mungkin di HP). Tipe instrumen lama tetap bisa dimuat (proyek lama).
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

## Port C++ (sesi ini) - catatan
- Semua instrumen sesi lalu dan 10 efek inti sudah di C++; tiap port lulus golden identik bit. Skenario baru: `params-<instrumen>` (setiap parameter
  min/max, dengan sample uji untuk Impulse/Granulator) dan `fx-<efek>` (synth lewat efek, setiap parameter min/maks/tengah). Untuk efek baru:
  tambahkan tipe ke `FX_PORTED` di `tools/golden/scenarios.mjs`; untuk instrumen: `PARAM_SYNTHS` / `SYNTHS`.
- Math.random tidak boleh dipakai di engine (Auto Filter S&H dan Roar kini LCG berseed). Umpan balik yang chaotic (contoh lama: DS FM Feedback)
  tidak bisa identik antar-implementasi sin(); buat stabil (rata-rata dua sampel) sebelum port.
- Semua kelas instrumen WAJIB punya allOff() (engine memanggilnya saat Stop/panic); inst-test sekarang memeriksanya.
- Drum Rack chain: pad.chain = { inst: { type, params, sample }, devices }. Note pad memainkan instrumen chain di C3 + Pitch pad; Level/Pan/Mute/Solo pad
  berlaku untuk chain; rackCmd op 7 = kosongkan satu chain. Simpler di pad memakai sample sendiri (browser `padChain`). DrumSynth belum di-port C++,
  jadi track drum tetap di engine Web.

## Sisa master prompt (sesi ini): kurva automasi, width/invert, freeze, real-time vs offline, Plugin SDK
- **Kurva automasi** (`js/autocurve.js`): tiap titik punya bentuk segmen `s` (0 linear, 1 step, 2 halus S, 3 lengkung `k`, 4 Bézier).
  Segmen non-linear dikirim ke engine sebagai breakpoint padat (engine JS dan C++ tetap interpolasi linear, jadi golden tetap identik).
  Proyek lama (tanpa `s`) = linear. Tes: `tools/autocurve-test.mjs`.
- **Mixer: stereo width + phase invert** per channel (engine `stereo()`, automasi kind 7; JS + C++). Tes: `tools/mixer-test.mjs`,
  golden `core-width-invert`.
- **Track Freeze**: render offline track ke `/Frozen/<id>.wav`, diputar sebagai klip; otomatis unfreeze kalau isi track berubah
  (`freezeKey`). `Engine.settle()` dipakai render offline supaya fader/ramp sudah diam sebelum frame pertama. Fade klip `-1` = tanpa fade.
  Tes: `tools/freeze-e2e.mjs` (mix beku = mix live, beda -105.8 dB).
- **Real-time vs offline**: `tools/rt-offline-test.mjs` menjalankan worklet asli di OfflineAudioContext dan membandingkan dengan Engine
  (ekspor): SuperSaw identik bit; Moisture berbeda di nada pertama karena tabel dibangun bertahap di worklet (terdokumentasi).
- **Plugin SDK** (`js/plugins.js`, `docs/PLUGIN-SDK.md`, contoh di `plugins/examples/`): plugin efek = satu modul JS (+ WASM opsional)
  di folder `/Plugins`, berjalan di AudioWorklet dan di ekspor. Device type plugin >= 1000 diberikan per sesi; proyek menyimpan
  `plugin.id`/`version`. Plugin hilang = placeholder diam yang menyimpan parameter. Error/NaN di plugin = blok dibisukan + bypass.
  Engine Native tidak bisa menjalankan plugin JS -> proyek dengan plugin otomatis diputar engine Web. VST/VST3/AU tidak didukung.
  Tes: `tools/plugin-test.mjs` (masuk run-tests), `tools/plugin-e2e.mjs` (Chromium).
- **Belum bisa dari sandbox**: pengukuran CPU/underrun di HP sungguhan. Gunakan tes perangkat di Pengaturan -> Audio -> Performa.
