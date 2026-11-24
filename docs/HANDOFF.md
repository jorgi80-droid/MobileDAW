# Serah-terima pekerjaan (untuk sesi berikutnya)

Branch kerja terbaru: `ccr-beaae46f-5tn5nu` (fast-forward dari `ccr-b8ee185e-5l32id` <- `claude/gesture-logic-editor-clip-18jqqv`). Sebelumnya: `claude/gesture-logic-editor-clip-18jqqv` (lanjutan fast-forward dari `ccr-49b1b317-5ba57j` <- `ccr-d4b2cd74-5td2k9`) (repo `jorgi80-droid/MobileDAW`), lanjutan langsung (fast-forward) dari `ccr-591624f7-8xa2wb` <- `ccr-9362ed99-sntgvi`
<- `ccr-34212a29-z1qc7f`. Tidak ada riwayat yang ditulis ulang. Semua pekerjaan sudah di-commit.
Baca juga `README-ANDROID.md` (build, install, status fase 2).

## Aturan kerja dari pemilik proyek
- Jangan merusak fitur yang ada; proyek `.mdaw` lama (termasuk v:2) harus tetap terbuka; app tetap jalan offline.
- Versi web/PWA harus tetap berfungsi; semua perilaku khusus Android di balik `isNativeApp()` (`js/native.js`).
- Setiap file JS yang diubah: `node --check`. Akhir tiap langkah: `node tools/run-tests.mjs` dan `node tools/golden/golden.mjs`.
- File web baru: daftarkan di `ASSETS` di `sw.js`, lalu `node tools/build.mjs`.
- Commit rapi per langkah, push ke branch di atas. Laporan ke pemilik dalam bahasa Indonesia.
- Plugin mendatang (aturan pemilik, 2 Nov 2026): tampilan plugin tidak diubah dan selalu tampil di jendela mengambang; saat jendela
  di-minimize, kartu device menampilkan pesan "klik tampilkan untuk menampilkan plugin" (dengan tombol Tampilkan). Berlaku untuk semua
  plugin baru.
- **Arah utama (pemilik, 9 Nov 2026): Design dan visual = Ableton Live. Mesin = FL Studio Mobile.** Semua tampilan (Arrangement, Mixer,
  Clip View, editor audio, piano roll, device) meniru Ableton Live 12: rapi, simetris, padat. Semua perilaku suara/engine (instrumen,
  efek, mixer, level/pan law, drum sampler, import FLM) meniru FL Studio Mobile (referensi: Honeydew, GPL-3.0, dengan atribusi).
- Tidak ada pilihan "model MobileDAW / model FL Studio Mobile" di UI (pemilik, 12 Nov 2026): mesin selalu memakai hukum FL Studio Mobile
  dari Honeydew; data lama dikonversi otomatis saat dibuka. Modul FX dan instrumen virtual gaya Ableton Live tetap ada.
- **Satu mesin C++ untuk semua (pemilik, 13 Nov 2026).** Mesin audio = `native/engine` (C++): di Android lewat Oboe, di web/PWA lewat
  WebAssembly (`js/engine/mdaw.wasm`, dibangun `sh native/wasm/build.sh`; butuh `clang`, `lld`, `wasi-libc`, `libc++-18-dev-wasm32`,
  `libclang-rt-18-dev-wasm32`). Port baru ditulis sekali di C++. Setiap kali `native/engine` berubah: bangun ulang `mdaw.wasm`, jalankan
  `node tools/golden/wasm-golden.mjs` dan `node tools/wasm-web-test.mjs`. Mesin JS (`js/engine/core.js` dst.) masih jadi cadangan
  (`prefs.webEngine = 'js'`, atau otomatis kalau WASM gagal dimuat) dan masih dipakai untuk ekspor/freeze offline sampai itu dipindah.
- Kode hasil dekompilasi software berhak cipta (mis. libFLM.so, VST komersial seperti reFX Nexus) tidak dipakai dan tidak di-port.

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
| Modul efek FL Studio Mobile (32 tipe, DSP Honeydew, C++ saja: `native/engine/hdfx.*`, `hdfx2.*`; device 100 + id FLM; tabel `js/flmfx.js`; panel `flmPanel` di fxkit.js; impor persis di `fxmap.js flmExact`) | selesai: sampel demi sampel identik dengan kode Rust Honeydew (Multi FX ≤ -90 dB), golden `fx-flm`, `tools/flmfx-test.mjs` |
| Arrangement gaya gambar pemilik: klip warna penuh + isi gelap, fade klip audio + handle (seret), locator outline, garis track tebal, palet warna Live jenuh | selesai (`docs/redesign/40-*.jpg`) |
| Drum Rack: chain per pad (instrumen + efek di pad, `pad.chain`; engine `DrumSynth.cmd/endBlock`, project `setPadChainInst / padChain*`, UI `padChainView` di fxkit.js, tes `tools/drumrack-test.mjs`) | selesai (`docs/redesign/39-drumrack-chain.png`) |
| Ekspor WAV lewat engine native; angka CPU/underrun Web vs Native dari HP | belum |
| Plugin Delay Compensation (PDC): track, send/return, grup, master, chain paralel rack, metronom + count-in, ekspor, rekaman; JS + C++ identik | selesai (`tools/pdc-test.mjs`, golden `core-pdc`, `tools/engine-e2e.mjs`) |
| Ekspor: Mono, pilihan sample rate (resampler Kaiser HQ), rentang Area loop | selesai (`tools/export-test.mjs`) |
| Kontrol sentuh gaya FL Studio Mobile: pengaturan gestur, ketuk-ganda bersih, batal gestur, Kontrol Klip tidak modal, Snap ketuk/tahan, reorder device, seleksi latar, titik otomasi banyak, menu pad drum, Simpan cepat geser + cadangan, pintasan keyboard yang bisa diubah | selesai (`docs/GESTURES.md`, `tools/gesture-test.mjs`, `tools/touch-ui-test.mjs`) |

## Workflow ala FL Studio Mobile: manual resmi sebagai acuan (sesi ini)
Sumber: PDF manual resmi (Playlist, Editors, Rack, Home Panel, dst.) yang diberikan pemilik. Celah workflow yang ditemukan dan ditutup:
- **Drum Sampler, tab "Seq"** (Hold, Cut Group A/B/C, Poly, Shift). Field pad 12–15 di blok `200 + pad*16` (`instruments.js` DrumSynth + padanan
  C++ `inst_classic.{h,cpp}`). Choke = fade 6 ms (tanpa klik): sample lewat tahap release, suara bawaan lewat rampa gain `cf`. Hold melepas
  pad sekian detik setelah dipukul (sample: release min 4 ms; bawaan: fade). Shift = tunda (0–250 ms; shift negatif butuh look-ahead, tidak ada).
  Default (cut 0, poly on, hold 0, shift 0) **identik bit** dengan sebelumnya. Tes: `drumseq-test` (perilaku), golden `inst-drumcut` (JS = C++).
  UI: `drumpad.js` tab Seq; `project.js` `newPad` / `sendPad` / `PAD_FIELD_PARAM`. AUX per pad belum.
- **Menu header track** (long-press): **Duplikat track** (`P.duplicateTrack`: salinan independen di bawah aslinya, id baru, sample dipakai bersama,
  freeze/arm/solo tidak ikut, lane otomasi tetap di aslinya, sidechain Autoduck mengikuti lewat `remapSources`, satu langkah urung),
  **Simpan sebagai MIDI** (per track, `midiio.js buildProjectMidi(only)`), **Impor MIDI ke track ini** (not jadi satu klip di playhead, drum lewat peta GM),
  **Sync semua sample** (audio, deteksi BPM + `syncClipToTempo` per klip, yang tak terdeteksi dilewati dan dihitung), **Simpan / Muat kit drum**
  (`presets.js saveKit / kitList / applyKit`, `/Presets/Kits/*.json`, pad + file sample; pad ber-chain dilewati; `P.setPadKit` + record undo `kit`).
  Tes: `track-dup-test`, `drumkit-test`, `channel-ui-test` (Chromium, bukan bagian run-tests).
- `js/engine.js`: Proxy `eng` kini menerima penetapan properti (`set` trap) agar tes bisa mengganti filesystem; tidak mengubah perilaku app.
- Masih terbuka dari manual: Slide Notes, Pan/Pitch per step, envelope Vol/Pan/Pitch per klip, rekam otomasi saat merekam, Notes Track di bawah
  channel drum, AUX per pad, mod wheel, monitoring input (lihat `docs/PARITY.md`).

## Modul besar di jendela mengambang (sesi ini)
Aturan pemilik (diperjelas): **hanya modul berukuran besar** (mis. MiniMeters) yang otomatis tampil di jendela mengambang; instrumen dan
efek yang muat di kartu rak tetap tampil di bawah seperti biasa. Saat jendela modul besar dikecilkan, kartunya menampilkan
**"Klik Tampilkan untuk menampilkan plugin"** dengan tombol Tampilkan. Modul lain tetap bisa dibuka ke jendela lewat tombol ⧉.
- "Besar" ditandai `big: true` di definisi modul (`js/defs.js`) — saat ini **MiniMeters (16)**. Tambah flag itu untuk modul besar lain.
- Preferensi `floatPlugins` (prefs.js, **default ON**, VERSION 5) = "Modul besar otomatis ke jendela mengambang" (Pengaturan → Tampilan).
  Bukan kunci lama → ditangani DEFAULTS; migrasi hanya memaksa ON untuk proyek lama tanpa kunci itu dan menghormati pilihan eksplisit.
- Sistem jendela mengambang (`js/floatwin.js`: geser/ubah ukuran/gulung/kecilkan, chip di tray) + `isMin(id)`.
- `js/devices.js`: `bigMod(def)`; `instCard` / `fxCard` merender **kartu launcher** (`floatedCard`) hanya kalau jendelanya terbuka
  (pop-out manual) atau `floatPlugins && bigMod(def)`. Selain itu panel penuh inline seperti biasa; fold bekerja normal lagi. Pesan kartu
  ikut status jendela (tertutup / terbuka+Tutup / **diminimize → "Klik Tampilkan untuk menampilkan plugin." + `.fl-min`**); device view
  re-render pada `FW.onFloatChange`.
- CSS `css/float.css`: `.card.floated .b.prim`, `.card.floated.fl-min` (tepi aksen).
- Tes: `tools/float-ui-test.mjs` (Chromium, bukan bagian run-tests): MiniMeters jadi launcher sedangkan MiniSynth/Echo tetap inline;
  Tampilkan membuka jendela; minimize → pesan persis + chip; pop-out manual mengambangkan efek kecil; OFF → MiniMeters pun inline. Alat
  screenshot/sentuh menyuntik `floatPlugins:false` untuk menangkap panel inline.
- VST pihak ketiga (mis. reFX Nexus) **tidak** di-port/dekompilasi. Kerangka ini untuk plugin MobileDAW sendiri.

## Sesi ini: impor proyek FL Studio Mobile (.flm), FL Studio (.flp), Ableton (.als)
Dokumen lengkap: **`docs/IMPORT.md`** (format FLM yang dipetakan, aturan placeholder, alur + progres, tes).
- Kode: `js/import/flm.js` (pembaca FLM + `flmToModel`), `als.js` (gzip XML, parser XML kecil tanpa DOM), `flp.js` (event, eksperimental),
  `build.js` (model netral -> JSON MDAW: placeholder plugin `d.missing`, klip sample hilang + file hening, DirectWave / pad hilang tetap
  dengan pattern), `index.js` (ZIP -> parse -> build -> salin sample -> simpan -> `P.deserialize(text, onProgress)`), `ui.js` (pemilih
  file, jendela progres, laporan). `P.deserialize` kini menerima `onProgress`.
- Lokasi sample: FLM -> `/FLM/<proyek>/<folder asli>` (folder library baru: `FOLDERS` di web.js, `TREE` di storage.js, Browser),
  FLP/ALS -> `/Samples/Imports/<proyek>/`. Ekspor ZIP kini juga membawa sample pad drum; impor ZIP mempertahankan path folder library.
- UI: Browser -> Proyek -> Impor proyek…, menu ⋮ -> Impor -> Proyek FLM / FLP / Ableton (lalu dialog pilihan modul). Kartu device `.dv-missing` ("[Plugin tidak
  tersedia] <nama>"), chip `.dv-miss-chip` di kartu instrumen.
- Tes: `tools/import-test.mjs` (run-tests; `FLM_ZIP=` untuk arsip asli), `tools/import-ui-test.mjs` (`IMPORT_FILE=`; Chromium).
- Migrasi modul -> stock plugin: `js/import/fxmap.js` (`decide`, `migrateJson` saat impor; mode dari dialog pilihan impor
  `importOptions` di `import/ui.js`: dicentang = 'all', tidak = 'map'), detail di IMPORT.md. Tes: bagian fxmap + null test engine di
  `import-test`, dialog pilihan + menu tanpa "Ganti modul" di `import-ui-test`.
- **Belum**: tipe efek FLM 4, 9, 16, 30, 35, 45 belum dikenali; parameter Compressor / Autoduck / Multiband / Tape Delay dll. belum
  dikonversi (dipasang bypass bila "Ganti modul yang hilang" dicentang saat impor), routing send / bus FLM dan routing insert FLP, otomasi parameter plugin + otomasi master, FLP diuji hanya
  dengan file buatan.

## Sesi sebelumnya (lanjutan prompt FL Studio Mobile): implementasi menyeluruh
Matriks paritas + hasil acceptance: **`docs/PARITY.md`**. Peta gestur diperbarui: `docs/GESTURES.md`.
- **Reorder modul bersama** `js/reorder.js` (`reorderGrip(head, { index, siblings, move })`): rantai utama (`devices.js`), Audio /
  Instrument Rack (`fxkit.js`, kartu `.lk-rfx`, `P.rackMoveDevice` -> `rackSync`), chain pad Drum Rack (`.lk-pfx`, `P.padChainMoveDevice` baru).
  `tools/chain-order-test.mjs`: urutan = urutan sinyal (rantai utama + rack), urutan baru identik dengan rantai yang dibangun baru.
- **Menu modul** (`devices.js`): Sisip kiri/kanan (`P.insertDeviceAt`), Ganti (`P.replaceDevice`), Copy / Paste (`P.devicesSnapshot`,
  `P.insertDeviceCopies` = salinan dengan id baru termasuk chain/macro rack, tipe tak dikenal dilaporkan), Reset (`P.resetDevice`),
  rantai (`P.replaceChain`). **Rack Preset** di `presets.js` (`saveRackPreset`, `rackPresets`, `applyRackPreset`; folder `/Presets/Racks`).
- **CTRL**: `ui.js touchCtrl()/lastControl()` (knob, kit number box `liveui.js`, fader mixer mencatat tawaran otomasinya saat digerakkan),
  `automate.js ctrlButton()` + item "Link ke track otomasi terpilih" (`P.retargetAutoTrack`, undo `atgt`). Tombol CTRL di toolbar sudah dihapus (diganti tombol Rewind `#btn-rew`); menu yang sama tetap lewat tekan-tahan kontrol (`ctrlButton()` dipanggil dari tes).
- **Wave Editor**: `js/engine/waveops.js` (murni, `tools/waveops-test.mjs`), `P.editClipAudio(i, id, op, a, b)` (seleksi dipetakan ke sample
  sumber lewat ratio / reverse warp, hasil 32-bit float di `/Samples/Edits/`, region klip ikut sisip/hapus), menu `selMenu` di `audioedit.js`.
- **Piano roll**: Ghost Notes (`ghostList`, cache dikosongkan saat not/klip berubah; pref `ghostNotes`). Velocity / panjang default
  (`defVel`, `defLen`), penamaan oktaf `defs.js setOctaveNaming/octaveOf` (pref `midC`).
- **Step**: graph Note Repeat (`n.rpt` 2..8, diekspansi di `clipNoteEvents` -> kedua engine tanpa perubahan engine; lane head = pilih mode).
- **Keys**: mode Klasik / Skala / Chord / Strum (`keys.js renderAlt`, teori di `js/chords.js`, `tools/chords-test.mjs`; pref `keyMode`,
  `chord7`, `chordHold`, `strumMs`).
- **Proyek**: `js/projects.js` (dialog New Project nama/tempo/birama/template, Recent `prefs.recent`, Duplikat / Ganti nama / Hapus).
- **Ekspor**: rentang Seleksi (`TL.timeSelection()`), tail Leave / Wrap / Cut + Trim Silence (`wav.js postRender`, dipanggil di `web.js exportJob`).
- **Pengaturan**: tab Editor baru.
- **Belum** (alasan di PARITY.md): slide note, cut group / poly / shift / AUX per pad, pan/pitch per step, sub-track, rekam otomasi,
  envelope per klip audio, placeholder plugin hilang, monitoring input + peringatan headphone, MIDI di APK, FLAC/AAC/OGG.

## Sesi sebelumnya: kontrol sentuh disempurnakan (prompt "Workflow FL Studio Mobile Touch")
Peta lengkap per layar: **`docs/GESTURES.md`**. Ringkasan teknis:
- **`js/gesture.js` v2**: ambang dari pref (`longMs`, `touchSlop`, `dtapMs`, dibaca per gestur lewat `gestureTiming()`; mouse slop 4 px),
  `haptic(ms)` (navigator.vibrate, pref `haptics`), handler opsional `defer(target)` = ketukan tunggal ditunda dan TIDAK dikirim bila
  jadi ketuk-ganda, `cancelGestures()` global (Escape) -> `dragEnd(x, y, t, true)`; attachGestures mengembalikan `{ cancel, pending }`.
  Tombol tekan-lama lain (Snap editor, metronom, knob `ui.js`, fader mixer, header device) memakai `gestureTiming().longMs`.
- **`history.js revertLast()`**: membatalkan checkpoint terakhir tanpa meninggalkan redo (dipakai semua drag yang dibatalkan:
  klip, not, step, titik otomasi).
- **Arrangement**: ketuk klip = pilih + Kontrol Klip setelah jeda ketuk-ganda (pref `tapClipMenu`); menu klip memakai
  `menu(..., { passThrough: true })` (`ui.js floating()`: tanpa scrim, sentuhan di luar menutup DAN diteruskan). Saklar Snap kanan atas:
  ketuk = on/off (`toggleSnap`, `cfg.lastSnap`), tekan lama = menu (`cornerMenu`). Hapus track lewat dialog. Menu klip: Combine with
  Next Clip (`combineNext`). Zoom: Fit seleksi waktu. Saat menyeret klip: `drawDragAids()` (bayangan asal + gelembung posisi/panjang).
  `keyAction(a)` = bagian pintasan keyboard untuk arrangement. `testState()` untuk tes UI.
- **Editor**: seret 1 jari di latar piano roll / otomasi = scroll (pref `rollDrag` bawaan 'pan', prefs v4 memigrasi), tekan lama 1 dtk (`longMs` per target di gesture.js, getar) + seret = kotak seleksi; 'select' = gaya FLM; batal = not kembali. Editor otomasi:
  pilihan banyak titik (`aset`), kotak seleksi, geser grup, bar Copy / Hapus / Paste / Batal pilih, `aclip` + `autoPaste()` (kurva
  tempelan menggantikan rentangnya). Menu tekan-lama pad drum: Load Sample (`DP.pickPadSample`), Clone (`P.clonePad`), Set MIDI Key
  (`P.setPadKey`: not di semua klip track ikut; dialog + `midi.js learnNote()` dari controller), Hapus pad (konfirmasi).
  `keyAction(a)` untuk piano roll.
- **Device**: `reorderGrip()` di `devices.js` (tekan lama title bar lalu geser; kelas CSS `dv-lift`, `dv-ins-b/a`; `P.moveDevice`).
  `head._noTap` mencegah ketuk-ganda lipat setelah reorder. Knob: penyesuaian halus (geser menjauh ke samping, inkremental).
- **Simpan**: `js/quicksave.js` (Simpan sebagai, Simpan cepat dengan cadangan `_backup_<nama>.mdaw`, indikator belum tersimpan
  `#btn-menu.unsaved`, `markOpened()` dipanggil Browser saat membuka proyek). Baris menu bisa digeser (`menu` item `swipe`, `swipeLabel`).
  File berawalan `_` tidak tampil di daftar proyek; cadangan tampil di bagian Cadangan.
- **Pintasan keyboard**: `js/keymap.js` (`ACTIONS`, `comboOf`, `actionFor`, `bind`, pref `keymap`), dispatcher `runKey()` di `main.js`
  (editor terbuka -> `ED.keyAction`, lainnya `TL.keyAction`). Pengaturan -> **Pintasan** (ubah / kosongkan / bawaan) dan -> **Sentuhan**
  (ambang, getar, perilaku ketuk klip / seret latar, area uji gestur).
- Tes: `tools/gesture-test.mjs` (di run-tests), `tools/touch-ui-test.mjs` (45 cek, Playwright), `tools/pattern-ui-test.mjs` tetap lulus.
- Android: izin `VIBRATE` ditambahkan ke manifest (izin normal, tanpa dialog) agar `navigator.vibrate` jalan di WebView; build APK hanya
  diverifikasi CI.
- **Belum / batas**: audio editor sudah punya pinch berpusat (horizontal) tetapi belum dites di touch-ui-test. Reorder modul di
  dalam Audio Effect Rack / chain pad masih lewat menu (gestur hanya untuk rantai utama).

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
  MP3: lihat bagian "Kualitas MP3" di bawah (sekarang ikut memilih 44,1 / 48 kHz lewat resampler HQ yang sama).
- Tes: `tools/pdc-test.mjs`, `tools/export-test.mjs` (keduanya di run-tests), golden `core-pdc` (identik), `tools/engine-e2e.mjs` (Chromium
  sungguhan: latensi dari worklet + ekspor mono 44,1 kHz 24-bit; butuh Playwright, tidak di CI).

## Instrumen lama diganti, preset dipindah, tata letak panel, Tape Stop (sesi ini)
- Tipe 1 / 2 / 4 / 5 tidak ditawarkan lagi (INST_LIST, IRACK_INSTS, PAD_INSTS); `project.js migrateClassic` mengonversi proyek lama saat
  dibuka (defs.js `migrateClassicInst` / `CLASSIC_TO_FLM`), preset lama dikonversi ke 31 / 32 / 33 di akhir defs.js. Engine klasik tetap
  (golden, audisi efek browser.js).
- Panel FLM (`fxkit.js` flmTabs / FS / FC / FT / flmCanvas): section berjudul, grid 2 baris (`.flm-g`), display `flmCanvas` mengisi
  tinggi section (ResizeObserver, `_maxW` saat halaman melebihi layar). Kartu `.flm-card` lebar = isi. `devices.js fitKit`: zoom panel Live
  lain agar muat tinggi panel (0,7–1,15×); `lvDrag` sudah menormalkan koordinat jadi aman untuk zoom.
- Tape Stop = device 52 (`fx8.js`, buffer cincin, kecepatan turun / naik dengan kurva Warp, crossfade ke live). fx-test: tes khusus.
  **Port C++ (sesi ini): `native/engine/fx8.{h,cpp}` `TapeStop`** — satu-satunya efek yang belum di-port; kini `devPorted(52)` dan golden
  `fx-tapestop` identik bit. Dengan ini **benar-benar semua instrumen (1–33) dan efek (0–52) punya port C++** — proyek apa pun bisa jalan
  penuh native di Android tanpa fallback Web.
- Impor FLM: `fxmap.js resolveFlmAutomation` (otomasi plugin), FLM_TYPES baru (2 / 23 / 52 synth, 6 / 15 / 32 / 35 / 42 / 46 efek).
- Presisi impor FLM (`docs/IMPORT.md` bagian "Presisi"): tick pecahan (1/128 ketuk = 7,5 tick, `build.js T`), level bawaan f32 0,85312408 =
  0 dB (`flm.js LVL0`; berlaku juga untuk FLP / ALS: gain model 1 = 0 dB), velocity = mentah / 32767 sampai 2 (boost; engine memakai
  `min(127, vel*127)` untuk zona velocity di JS dan C++), DirectWave `PRMS[1..16]` (`dwParamsFromFlm`, `dwPitchSt` knob bertingkat ke arah
  nol, `dwFineCt`; pitch / fine per lapisan → root / tune zona), mute track dari `RPRM[2]`, `report.precision` di laporan impor.

## Instrumen FL Studio Mobile: DirectWave / GMS / MiniSynth / SuperSaw (tipe 30-33, sesi ini)
- Mesin `js/engine/flmsyn.js` (kelas FlmDirectWave / FlmGms / FlmMiniSynth / FlmSuperSaw, dasar bersama `Voices`: poly dengan batas,
  mono, legato, slide konstan / per oktaf; `Svf` filter ZDF; LFO per voice Hertz / One Shot / tempo; FX Delay / ModDelay / Phaser / Reverb /
  decimator; wavetable GMS band-limited per oktaf lewat FFT). Parameter di `defs.js` (full: true, `flm: true`, DirectWave `zones: true`
  = zona 100 + k * 8 seperti DirectWave Klasik). Panel `fxkit.js` VI[30..33] memakai `flmTabs` (tab FLM, ingat tab per track).
- Tipe lama 1 / 2 / 4 / 5 tidak diubah (nama + " Klasik"), jadi proyek lama, preset lama, demo dan golden tetap identik. Track synth baru =
  32 (MiniSynth).
- **Port C++ (sesi ini)**: keempat instrumen FLM (30/31/32/33) di-port ke `native/engine/flmsyn.{h,cpp}` — primitif bersama (Svf ZDF,
  FlmVoices poly/mono/legato/slide/polySlide, LFO, Delay/ModDelay/Phaser/Reverb, decimate, Arp, wavetable FFT GMS, bank sample DirectWave)
  ditulis ulang di C++ dengan aturan jsmath.h (double skalar, buffer float, urutan operasi JS, tanpa FMA). Diverifikasi golden
  `params-/play-/presets-minisynth`, `-supersaw`, `-gms` dan `inst-flmdw` — identik / selisih ≤ −156 dB (ambang −90/−70). Hook
  `Instrument::setSongPos` ditambah (engine.cpp memanggilnya per blok seperti core.js) untuk LFO Tempo-Sync SuperSaw. `GmsVoice` FLM diberi
  nama `GmsFlmVoice` agar tidak bentrok dengan GMS klasik di `inst_classic.h`. Registry `instPorted` + `units.cpp` + `CMakeLists` diperbarui.
  **Tidak ada lagi fallback Web untuk 30–33** — semua instrumen MobileDAW kini punya port C++.
- **Perbaikan lag playback (Android)**: `android/app/src/main/cpp/bridge.cpp` melaporkan instrumen ter-port hanya untuk `t < 32`, jadi
  **MiniSynth (32) & SuperSaw (33) tidak pernah dilaporkan ke sisi JS** → `blocker()` (web.js) menganggap proyek belum didukung native →
  Android **jatuh ke engine Web yang lebih lambat** untuk proyek FLM → under-run/suara tersendat saat playback di proyek berat. Loop
  diperbaiki ke `t < 64` (efek sudah `< 64`); `instPorted()` tetap menyaring tipe yang belum didukung. Gabung dengan port 30–33, proyek
  FLM (termasuk hasil impor) kini jalan penuh di native C++ di Android — jauh lebih ringan. (Tidak teruji otomatis: butuh build NDK/HP;
  golden desktop tak terpengaruh karena pakai host terpisah.)
- Rincian kontrol, batas (kurva buatan MDAW, mod wheel belum ada sumbernya) dan tes: `docs/FLM-INSTRUMENTS.md`.

## Kualitas MP3 + instrumen impor FLM (sesi ini)
- **Encoder MP3** (`js/engine/mp3.js`): dulu satu global_gain per granule tanpa scalefactor dan tanpa bit reservoir (noise putih, kalah dari
  LAME pada musik asli). Sekarang: `_mask()` = ambang masking per scalefactor band (energi band disebar per Bark, -10 / -27 dB per Bark,
  offset -12 dB di 128 kbps sampai -24 dB di 320 kbps), `_quant()` = outer loop ISO (perkuat band yang noisenya di atas ambang lewat
  scalefactor, `scalefac_compress` terkecil, simpan hasil terbaik), lalu bila semua band sudah di bawah ambang, step dikasarkan untuk menabung
  bit ke **reservoir** (maks. 511 byte, `main_data_begin`) - tetapi tidak melebihi yang bisa ditampung reservoir (CBR: bit tidak dibuang).
  Main data ditulis ke aliran virtual (`this.ms`) dan frame baru dikeluarkan saat slotnya pasti penuh (`_emit`). Long block saja (belum ada
  short block: transien tajam di 320 kbps sedikit di bawah LAME).
- Ukuran (`tools/mp3-quality-test.mjs`, NMR = noise vs ambang masking per band kritis, perkiraan perseptual, bukan tes dengar): pada rekaman
  vokal dari arsip FLM pemilik 320 kbps: MDAW SNR 52,4 dB / NMR -34,7 dB / 0,0 % sel terdengar, LAME 51,9 / -34,8 / 0,0 %; 192 kbps:
  MDAW 0,9 %, LAME 0,2 %; 128 kbps: MDAW 4,4 %, LAME 6,7 %. Loop drum 320 kbps: MDAW 3,8 %, LAME 2,9 %. Kecepatan ~10x realtime (Node).
- **Ekspor**: MP3 memakai Sample rate Otomatis / 44,1 / 48 kHz (resample HQ di `finishRender`), default bitrate 320; preset "WAV 16-bit · 44,1
  kHz" dan "MP3 320 kbps · 44,1 kHz" di dialog. Tes: `export-test` (struktur aliran MP3, reservoir, CBR), `tools/export-ui-test.mjs`.
- **Instrumen impor FLM** (`flm.js` `synthOf`, `build.js` `instrumentOf`, `gm.js`): semua modul DirectWave kanal → zona DirectWave MDAW
  (root key dari ZONE +1024, rentang penuh; lapisan yang berbunyi bersamaan tetap berbunyi bersamaan); parameter DirectWave FLM disimpan
  mentah di `inst.from.layers[].params` (artinya belum dipetakan). Program library bawaan FLM (`@R@ DirectWave Samples/...`) tidak ada di arsip
  → SoundFont GM bawaan (`/SoundFonts/TimGM6mb.sf2`, disalin dari `demos/` bila belum ada) preset terdekat dari nama (`gmFor`), chip
  "pengganti ..." di kartu instrumen. GMS / MiniSynth / SuperSaw dikenali dari type id (`FLM_TYPES[t].synth`, belum diketahui) atau nama /
  path preset → instrumen MDAW 5 / 1 / 2 dengan preset bernama sama bila ada (`presetFor`), nilai asli di `inst.from`.

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
  kategori terdekat (grup 'Lainnya (lama)' sudah dibubarkan; `HIDDEN_FX` = efek lama yang hanya mengulang efek baru); native engine otomatis kembali ke engine web untuk device yang belum di-port.

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

## Toolbar, header track, daftar tanpa duplikat (sesi ini)
- Toolbar: tombol Rewind (`#btn-rew`, kembali ke awal) di grup transport; tombol CTRL dihapus (menu otomasi/MIDI CC lewat tekan-tahan kontrol).
- Header track (`js/timeline.js`), meniru Live (gambar acuan pemilik): dua tampilan kolom header. **Penuh** = kolom berwarna sempit (HANYA nama, ~40%
  lebar) + kolom mixer abu-abu yang lebar di kanan (aktivator, S, arm, otomasi; volume + pan; Send A/B; field Output "Master"); semua muat di
  baris 72 px (tombol In/Auto/Off tidak ditampilkan lagi di header). **Ringkas** = hanya blok nama berwarna (+ aktivator kecil). Ketuk badan header
  mana pun = ganti Penuh <-> Ringkas (`prefs.headFull`, `setHeadFull`); segitiga = lipat satu track; tinggi baris tetap diseret dari tepi bawah.
  Pref `tapFold` mematikan ketuk-ganti.
- Monitor tiga mode lewat menu tekan-tahan header "Monitor input" (`P.setMonitor/monMode/monSounds`, `t.mon`: undefined = In, 'auto', false = Off; Auto = bunyi hanya saat track arm; undo
  lewat 'val' k 'mon'). Baris Out: ketuk = menu routing (`outMenu`).
- Lebar kolom: tiap tampilan punya lebar sendiri (`prefs.headW` penuh 150..460, otomatis 236 / 280 / 310 px, `prefs.headWc` ringkas 56..160); seret tepi kiri kolom,
  ketuk-ganda tepi = otomatis, atau menu tekan-tahan "Lebar kolom track...". Tes: `node tools/header-ui-test.mjs` (di luar run-tests).
- Duplikat: grup efek 'Lainnya (lama)' dibubarkan (Autoduck -> Dynamics, Stereolizer / Spacer -> Utilities); Parametric EQ, Level, Analyzer
  disembunyikan dari picker (`HIDDEN_FX`, tetap berfungsi di proyek lama). Tab Preset tidak lagi menampilkan seksi Klasik MiniSynth / SuperSaw /
  GMS (preset yang sama sudah ada di tipe FL). DirectWave Klasik kemudian juga dihapus (lihat "Instrumen klasik dihapus").
  Label ganda dalam kartu: tab pertama Echo kini "Time", Simpler tanpa sample menulis "Tanpa sample".
- Preview sample di Browser: bar waveform / Tambah (`.pbar`) kini ditaruh di dalam kolom `.bmain` di bawah daftar (dulu jadi kolom ketiga dan
  memotong daftar sample). Tes: `node tools/browser-preview-test.mjs`.
- Garis lebih tegas: grid timeline (sub-beat #3a3a3f, beat #4a4a50, bar #74747c), pemisah track / header / ruler lebih gelap dan 2 px, token
  tema gelap `--lv-edge` / `--lv-div` / `--sep` / `--line` lebih kontras. Tinggi panel Device tetap 57% (DEVH) karena kartu instrumen terpotong bila lebih
  rendah; ruang arrangement bertambah lewat mode header Ringkas dan tombol tutup panel bawah.
- Slider header (volume, pan, Send A/B) menyeret RELATIF dari nilai awal (tidak melompat ke jari); geser jari > 26 px di atas / bawah slider = kontrol halus
  (1/5 kecepatan). Slider volume/pan setinggi 18 px dan ~190 px lebar di lebar otomatis. Tes presisi ada di `tools/header-ui-test.mjs`.
- Chrome lebih tipis supaya arrangement lebih penuh: toolbar atas 35 px (`--top-h`, kontrol `--cb-h` 28 px = batas sentuh, tombol transport 47 px), margin atas layout 2
  (`INSET.t`), ruler atas 34 px (`RULER`/`MROW`) dan ruler bawah 19 px (`BOT`), tab bar Device/Keys 31 px, dan saat panel bawah ditutup 35 px
  (dulu 46). Ukuran ini kompromi: versi 32/26/31/18/28 dinilai terlalu kecil. Semua konstanta ada di `css/app.css`, `css/ableton.css`, `js/timeline.js`, `js/layout.js`.

## Pan klip, lane Pan drum, header elastis (sesi ini)
- Pan per klip audio: event klip stride 8 (`pan` di akhir; `eng.trackClips(i, f, n, 8)` dari project.js), balance (tengah tidak mengubah sisi mana pun, jadi proyek
  tanpa pan klip identik bit). JS `core.js` + C++ `Clip.pan` (`engine.h`, `commands.cpp prepClips`, `engine.cpp`), golden `core-clip-pan` (124 skenario, semua identik),
  `tools/clip-pan-test.mjs`. UI: slider Pan di panel Audio klip (`audioedit.js`); impor FLM mengisi `c.pan` dari PRMS klip.
- Graph editor drum: lane Pan per step (menu di nama lane); memakai `note.pan` yang sudah ada (engine menerapkan pan not dari awal step, bukan per suara).
  Pitch per step (sesi ini): lane Pitch (-12..+12) di graph editor; event not stride 6 (`clipNoteEvents(c, kind, f, true)` + `eng.trackNotes(i, f, n, 6)`),
  `sevSt` di core.js / engine.cpp, `noteOnSt` (Instrument default = noteOn; DrumSynth menggeser pitch pad / chain). Golden `inst-drumpitch` identik, nilai 0 identik bit.
  Slide Notes belum.
- Header track seperti Live: kontrol kecil berukuran TETAP (tombol 16 px, field 15 px, teks 10 px; tidak membesar mengikuti tinggi baris): baris 1 = aktivator / S /
  arm / otomasi, baris 2 = volume + pan, baris 3 = Send A | Send B, baris 4 = Output (Master) selebar kolom; SEMUA kontrol 15 px (tombol = fader); tinggi track default 78 px agar baris Output tidak menyentuh garis pemisah. Kolom header otomatis ~1/5 layar (262 / 240 / 208 px),
  kolom nama 36 %. Baris pendek melepas baris 3 lalu baris 2. Baris terlipat: meter level HORIZONTAL (L di atas R) di samping tombol M/S/arm (`r.hm`,
  `drawMeters`); baris terbuka: meter vertikal di tepi kanan header. Area sentuh slider +2 px; geser relatif + mode halus (jari menjauh dari slider).
- Otomasi Level Master diimpor sebagai lane master; metode Replica + audit arsip FLM: `docs/replica/`.

- Klip arrangement direplika dari Live (metode Replica): `docs/replica/CLIP-RECON.md` (warna klip penuh, isi hitam / putih menurut luminansi, klip nonaktif abu netral di semua tema).

## Slide Notes (sesi ini)
- Not dengan `n.sl` (tombol Slide di bar not piano roll, track synth): tidak dimainkan; `P.slideLane(c, f)` menulis lane trackCC **kind 4** (semitone persis): dari 0 di awal
  slide ke (nada slide - nada not yang berbunyi) di akhir slide, bertahan sampai not itu selesai, lalu 0. Slide berantai melanjutkan dari nilai terakhir.
- Engine: `bend(t, st, sl)` (JS) / `Engine::bend(t, st, sl)` (C++): roda (lane kind 0, +-2) + slide; instrumen dengan PB range sendiri memakai `setBendSl(st, sl)`
  (FLM synth: roda diskalakan, slide tidak), lainnya `setBend(st + sl)` / bend per suara. Tanpa slide semuanya identik bit. Golden `core-slide`, `tools/slide-test.mjs`.
- Batas: slide menggeser semua suara track (akor ikut bergeser); glide velocity / pan belum; flag slide di file .flm belum diketahui sehingga impor belum memakainya.

## Kalibrasi FLM dari stem pemilik (sesi ini)
- `docs/IMPORT.md` bagian "Kalibrasi dari stem pemilik": not FLM = MIDI (NOTE_OFS 0, dulu +12), tipe 0 = MiniSynth, patch default FLM terkalibrasi
  (`build.js FLM_DEFAULT`), `lvl` param FLM synth kini sampai +12 dB. Tes: `tools/flm-stem-test.mjs` (`FLM_STEMS=` arsip).
- Dampak pada proyek FLM lama yang diimpor ulang: track synth / GM berbunyi satu oktaf lebih rendah dari sebelumnya = sesuai FL Studio Mobile. Proyek .mdaw yang
  sudah tersimpan tidak berubah (konversi hanya saat impor).

## Replica diff (sesi ini)
- Alat paket replica disalin: `tools/imgdiff.py` (diff tata letak screenshot, pustaka standar), `tools/parity.py`. `tools/replica-arr-shot.mjs` merender
  arrangement dalam keadaan referensi. Hasil dan iterasi: `docs/replica/CLIP-RECON.md` (48,3 -> 59,6).
- Perubahan dari diff: gelombang stereo dua jalur (`stereoPyr` di timeline.js, piramida per kanal dibuat sekali per sample, hanya bila tinggi isi >= 34 px);
  baris Master / FX 26 px (`XROW_H`), aktivator FX dan field level di kolom mixer, keterangan "x track aktif" hanya bila baris >= 40 px.

## New Song 1 dari pemilik (sesi ini)
- Rack tiap instrumen berisi 23 modul efek FLM (preset Default, beberapa preset bawaan). Yang pasti dari preset bawaan: 15 Stereoizer, 36 Multiband Compressor
  (MBand Comp), 34 Spacer, 46 Tremolo, 43 Wow & Flutter (sudah dikenal). Nilai bawaan semua modul dicatat di `docs/replica/FLM-DEFAULTS.md`.
- 10 tipe belum bernama di rack ini (3, 9, 13, 16, 18, 27, 28, 30, 41, 44): posisi slotnya ada di `docs/replica/UNKNOWN-FLM-MODULES.md` (arsip "New Song 1").
  Urutan rack tidak alfabetis, jadi nama TIDAK ditebak dari urutan.
- Importer: pencocokan preset synth tidak lagi menebak dari satu kata ("Lead Super" dulu jadi "EDM Lead"); preset FLM yang tidak ada di MobileDAW
  dilaporkan apa adanya ("preset FLM ... belum ada di MobileDAW: setelan awal").

- Screenshot pemilik (New Song 1): tipe 18 = Tape Delay, 16 = Trance Delay (tebakan 11 dicabut); arti angka Reverb, MiniSynth (osc / filter) dan konfirmasi
  DirectWave: `docs/replica/FLM-PARAM-EVIDENCE.md`. Importer memakai p6..p12 + p17 MiniSynth untuk preset FLM yang tidak ada di MobileDAW. Tes di `flm-stem-test`.

## Instrumen klasik dihapus (sesi ini)
- Mini Synth / SuperSaw / GMS / DirectWave Klasik (tipe 1 / 2 / 5 / 4) tidak muncul lagi di mana pun di aplikasi: tab Preset tidak punya seksi
  "DirectWave – preset tambahan" lagi (6 presetnya dikonversi ke DirectWave FLM tipe 30, sama seperti preset klasik lain ke 31 / 32 / 33), `PRESETS[1/2/4/5]`
  dihapus setelah konversi (akhir defs.js), audisi efek di Browser memakai MiniSynth (32, preset "Brass Stab" hasil konversi), `SCRATCH_OK` kini 3/7/8/11/31/32/33.
- `P.setInstrument` memetakan tipe klasik ke kembarannya (`CLASSIC_TO_FLM`), jadi tidak ada jalur di aplikasi yang bisa membuat instrumen klasik lagi.
- File lama tetap terbuka: proyek .mdaw (`project.js migrateClassic`, sudah ada) dan kini juga preset .json pengguna (instrumen + Rack preset;
  `presets.js classicUp`, file tidak ditulis ulang).
- Kode engine klasik (JS `instruments.js` MiniSynth / SuperSaw / Gms, C++ `inst_classic.*`) TIDAK dihapus: kelas Sampler dipakai Keystone (9), DrumSynth (3) di file
  yang sama, dan banyak tes engine + skenario golden memakai tipe 1/2 sebagai sumber sinyal sederhana. Engine-nya hanya tidak terjangkau dari UI.

## Mix per modul (sesi ini)
- Setiap efek punya Mix (dry/wet 0..1) dan Gain (dB) seragam, di luar daftar parameter efek itu sendiri: devParam indeks `MIX_P = 1000` / `GAIN_P = 1001`
  (`js/engine/dsp.js devSet / fxRun`, C++ `units.h devSet / fxRun`). Engine menerima Gain sebagai faktor linear (dihitung sekali di `project.js`, jadi
  JS dan C++ mendapat angka yang sama). Mix 1 + Gain 1 = jalur lama persis (bit sama); selain itu dry disalin, ditunda sebesar `lat()` efek (PdcLine,
  dibersihkan saat aktif lagi) lalu dicampur, Mix/Gain di-ramp linear per blok. Dipakai di rantai track / Master / return, di dalam Audio/Instrument Rack
  dan di chain pad Drum Rack; otomasi (lane kind 4 param 1000) dan modulator juga lewat `devSet`.
- Data: `d.mix` (0..1) dan `d.gain` (dB), hanya ditulis bila beda dari bawaan (file lama tidak berubah). `P.setDeviceWet(i, di, 'mix'|'gain', v)` dengan undo
  (`val` k `wet`), Reset parameter juga mereset Mix/Gain, preset mixer menyimpan keduanya, Copy/Paste dan Rack preset ikut (salinan JSON).
- UI: chip di judul kartu efek (`devices.js wetChip`, abu-abu "Mix" saat bawaan, oranye dengan nilainya bila diubah), ketuk = dialog dua knob + Reset.
  Modulator (48/49/50) dan placeholder plugin hilang tidak punya chip. Belum: chip di kartu efek di dalam rack / pad chain, dan lane otomasi Mix di picker
  otomasi (engine sudah bisa). C++: blok dry 128 frame ada di objek Device; ring latency dialokasikan saat pertama dipakai (sama seperti JS).
- Tes: `tools/fx-mix-test.mjs` (bit sama di Mix 100 %, dry persis di Mix 0 % termasuk Compressor look-ahead 10 ms, Gain, 50 %, simpan/muat), golden
  `core-fx-mix`, screenshot `node tools/ui-shots.mjs <dir> wet`.

## Placeholder modul hilang (sesi ini)
- `project.js placeholderOf / devOrPlaceholder / fixChain`: device dengan tipe yang tidak ada (MultiFX yang dihapus = "MultiFX", atau tipe dari versi
  MobileDAW yang lebih baru) tidak dibuang lagi. Ia jadi placeholder tipe 0 (Utility di nilai bawaan = audio lewat utuh) dengan `missing: { name, app:
  'MobileDAW', orig }`, `orig` = device asli persis (id sama). Disimpan begitu ke file; begitu tipenya dikenal lagi, `devOrPlaceholder` mengembalikan
  device aslinya. Berlaku di rantai track / Master / return (`syncDevices`), di dalam Audio/Instrument Rack (`rackSync`), chain pad Drum Rack (saat
  buka proyek), paste modul dan Rack preset (`insertDeviceCopies` -> `held` dilaporkan), preset mixer (simpan = modul aslinya, muat = placeholder).
- Lane otomasi ke modul placeholder tetap di file tapi tidak dimainkan (`resolveTarget` -> null), supaya tidak menggerakkan Utility.
- Kartu: "[Plugin tidak tersedia] <nama>", "tipe modul N", teks bahwa datanya disimpan utuh. Placeholder FLM lama (`missing` tanpa `orig`) tidak berubah.
- Belum: instrumen dengan tipe tidak dikenal (track synth / chain Instrument Rack) masih seperti sebelumnya (chain rack: instrumen dikosongkan).
- Tes: `tools/placeholder-test.mjs`.

## Slide Notes: velocity + pan (sesi ini)
- `P.slideLane` kini juga menulis trackCC kind 5 (rasio gain = velocity not slide / velocity not yang berbunyi) dan kind 6 (offset pan = pan not slide -
  pan not itu), dengan pola titik yang sama seperti kind 4, kembali ke 1 / 0 di akhir not. Lane 5 / 6 hanya dikirim bila ada slide yang mengubah nilainya,
  jadi proyek lama yang slide-nya ber-velocity / pan sama mendapat lane persis seperti dulu.
- Engine (JS `core.js applyCC`, C++ `engine.cpp applyCC`, `commands.cpp prepCC`, `CCData lane[7]`): kind 5 dikalikan ke `ccG` (0..4), kind 6 ditambah ke
  `ccP` (dibatasi -1..1). JS `trackCC` kini membatasi n ke panjang array seperti `commands.cpp count` (ketahuan saat membuat golden: n yang kebesaran
  membuat JS membaca undefined).
- Batas: level / pan berlaku untuk seluruh track (bukan per suara), velocity dipetakan sebagai rasio gain (respon velocity tiap instrumen tidak diikuti).
- Tes: `slide-test` (lane + -6 dB + pan kanan), golden `core-slide-vp`.

## Sub-track di bawah track drum / synth (sesi ini)
- Data di dalam track (urutan track dan strip engine tidak berubah): `t.subs = [{ id, name, kind: 'steps' | 'notes', mute }]` (maks 8, hanya drum / midi),
  klip di sub-track punya `c.sub = id`. `project.js addSub / removeSub / setSub / setClipSub / subsOf / subOfClip`; `syncClips` mengirim not semua baris
  ke instrumen track itu (baris yang di-mute dilewati, termasuk lane CC dan slide). Buka file: `fixSubs` membersihkan entri rusak, klip yang menunjuk
  sub-track yang hilang kembali ke baris utama. `moveClipToTrack` ke track lain = baris utama track tujuan. Duplikat track ikut menyalin sub-track.
  Undo: snapshot klip di `history.js` kini juga menyimpan `t.subs` (pemanggil `checkpoint()` dulu, seperti edit klip).
- Arrangement (`timeline.js`): tinggi track = baris utama + n x `SUBH` (setengah tinggi baris, 24..56 px); `rhMain`, `laneBox`, `laneAt`, `subHdr`.
  Header sub-track: tepi warna, "↳ nama", jenis editor, tombol M; ketuk = menu (mute, ganti nama, Editor Step / Notes, hapus), M = mute. Ketuk ganda /
  tekan lama di baris sub-track = klip baru di baris itu; seret klip naik / turun memindah antar baris track yang sama. Track dilipat = sub-track
  disembunyikan (klipnya tampil di baris tipis). Menu header track: "Tambah sub-track…" (Step track / Notes track).
- Editor (`editor.js stepsMode`): klip sub-track drum dibuka di editor sub-track itu (Step / Notes); pilihan Step / Notes klip biasa dikembalikan sesudahnya.
- Belum: impor sub-track dari file .flm (formatnya belum diketahui), mixer per sub-track (sengaja: FLM memakai channel yang sama).
- Tes: `tools/subtrack-test.mjs` (run-tests), `tools/subtrack-ui-test.mjs` (Playwright, `SHOT=` untuk screenshot).

## Panel FX gaya Live untuk Roar / Autoduck / Stereolizer / Spacer / Tape Stop (sesi ini)
- `js/fxkit.js` V[9], V[10], V[14], V[15], V[52] + `kit: true`. Rincian, acuan dan skor imgdiff: `docs/replica/FX-PANELS.md`.
- Autoduck: sumber sidechain lewat tombol "Audio From" sendiri (bukan knob), tombol Sidechain menyala bila ada sumber (mati = No Input).
- Tape Stop: Play / Sync jadi tombol; panjang Stop / Start = daftar ketukan saat Sync, knob detik saat Sync mati (`k.swap`).
- Mix & Gain: tekan lama knob Mix di dialog = lane otomasi (target kind 4, param `MIX_P`; `autoCurrent` membaca `wetOf(d).mix`). Tes di `fx-mix-test`.
- Tersisa dari tampilan FX: MiniMeters tetap tampilannya sendiri (suite meter); Parametric EQ / Level / Analyzer disembunyikan dari picker dan
  tetap memakai tampilan lama; chip Mix belum ada di kartu efek di dalam rack / chain pad.

## Replika panel FX dari referensi pemilik, putaran 2 (sesi ini)
- Detail, skor sebelum / sesudah dan sisa perbedaan: `docs/replica/FX-PANELS.md` (bagian Putaran 2). Skor: `tools/replica-fx-score.sh`.
- Engine: ChannelEq punya `readOut` spektrum 128 bin (JS fx3.js + C++ fx3.h/fx3.cpp, hanya tampilan); Drum Buss parameter 12 "Audition"
  (Boom Audition: keluaran = band Boom saja; mati = jalur lama bit sama). Golden 125/125 identik.
- ui-shots: `PLAY=1` memutar lagu demo (dari awal untuk tiap modul), `CARD=1` memotret kartu efek di ukuran panel normal.

## Cahaya ruler, bayangan, animasi (sesi ini)
- Ruler arrangement: di belakang beat ruler ada cahaya dengan warna klip di bawahnya (`timeline.js clipColorAt`: track terpilih dulu, lalu track
  aktif teratas; kolom 4 px, naik dari tepi bawah ruler dan memudar ke atas). Lapisan overlay: sorot cahaya bulat di playhead dengan warna klip yang
  sedang dilewati, membesar / menyala mengikuti level Master saat diputar, berkas cahaya tipis turun ke lane, bendera playhead bercahaya. Diam
  (atau Kurangi animasi) = cahaya tetap pelan.
- Klip: bayangan lembut kanan-bawah (dua pita gelap, tanpa blur supaya murah) dan glow warna klip saat dipilih.
- Bayangan: satu sumber cahaya dari atas; kartu efek = bayangan kontak + bayangan lebar, menu / modal melayang lebih tinggi, bar atas punya bayangan.
- Animasi: tombol Play bernapas (glow oranye) saat lagu jalan, Record berdenyut merah saat merekam, tombol bar atas / segmen / tab memantul
  saat disentuh. Semua mati dengan Kurangi animasi / prefers-reduced-motion.
- Tangkapan: `PLAY=1 FRAMES=30 node tools/ui-shots.mjs <dir> glow` (frame untuk GIF).

## MiniMeters gaya video referensi + blur (sesi ini)
- Video pemilik (strip horizontal MiniMeters): bawaan baru di `mmdraw.js` (pilihan lama tetap ada di Opsi tiap modul):
  Spectrum mode "Flow" (isian gradasi merah-oranye -> teal sepanjang frekuensi, garis puncak abu-abu, label 100Hz / 1kHz / 10kHz, kotak buram
  "dB | Hz | nada +-Cents" yang memendek di modul sempit); Stereometer mode "Polar" (setengah lingkaran, titik-titik hijau pucat, aditif);
  Loudness tampilan "Bars" (skala 0 6 12 24 36 50, dua batang L/R dengan garis puncak, kotak teal "-6.56RMS" / "-11.6LUFS"); Waveform warna
  "Glow" (rendah merah, tengah merah muda-putih, tinggi biru) satu lajur Mid. `glassBox` = kotak dengan gambar di belakangnya diburamkan (canvas filter).
- Kartu di rantai: tata letak Horizontal bawaan (Spectrogram, Waveform, Stereo, Loudness, Spectrum), 560 x 226 (pas di panel Device Pixel 7).
- Blur: menu, dialog, jendela mengambang dan popup MiniMeters jadi kaca buram (backdrop-filter, warna 80 %), scrim ikut buram; mati dengan Kurangi
  animasi; tanpa dukungan backdrop-filter warnanya kembali padat.
- Glow ruler (permintaan pemilik): HANYA di kiri-kanan playhead, di dalam ruler (sorot bulat 20..34 px warna klip yang dilewati, menyala dengan level
  Master). Tidak ada pita warna di bar lain (sudah atau belum dilewati) dan tidak ada cahaya di grid / lane.

## Audit UI di HP pemilik (Oppo Find X8) (sesi ini)
- `tools/ui-audit.mjs` (Playwright, 920 x 419 CSS px, DPR 3 = Find X8 lanskap): buka setiap efek dan instrumen di panel Device, cek teks terpotong /
  keluar kartu, kontrol bertumpuk, kontrol terpotong, ukuran huruf efektif (zoom ikut), dan isi tinggi panel. `SHOTDIR=` menyimpan screenshot layar
  per modul. Catatan: rect di app memakai piksel layout (uiscale K), jadi screenshot per kartu dibuat layar penuh.
- Hasil awal -> akhir: 21 -> 6 temuan (6 sisa = overlay yang memang ada di Live: tombol play / kotak Harmonics di dalam display Spectral, gagang
  MiniMeters, tombol 1/2 Drift), ukuran huruf 6,5..12,5 px -> 8..12 px (14 / 17 = angka besar Meld dan MiniMeters), panel isi < 70 % 16 -> 8.
- `devices.js fitKit`: SATU zoom untuk semua panel (tinggi panel / DESIGN_H 250, 0,6..1,2); panel yang lebih tinggi menyusut sendiri (min 0,6),
  panel yang lebih pendek tidak diperbesar tetapi kontrolnya disebar ke tinggi panel (`lk-fill`). Dulu tiap panel di-zoom sendiri 0,7..1,15.
- Wavetable: tiga baris jadi tab (Oscillators / Envelopes-LFOs / Filter-Matrix) - dulu baris bawah terpotong walau di 0,6x. Tension: dua kolom.
  Knob melebar mengikuti labelnya, tombol mengikuti teksnya (tidak terpotong: "Pitch Decay", "Finger Mass", "4x10 Bass").
  Panel synth lama (Keystone / Moisture / Osphere): display 104 px (dulu 42), isi 52 -> 82..84 %.
- Belum: SoundFont (hanya tombol file + 2 knob, isi 23 %), Redux / Autoduck / Tape Stop / Looper / Overdrive masih 58..69 %; Echo, Filter Delay,
  Simpler, Operator, Sampler, Wavetable masih perlu 0,84..0,9x (sedikit lebih kecil dari panel lain).

## Modul efek FL Studio Mobile (port Honeydew, sesi ini)
- 32 modul efek FLM (semua efek di `effect_info` Honeydew kecuali Tuner/Analyzer dan modul tambahan Honeydew sendiri: Lemon, Dynamic EQ, Modulator, De-esser, Denoise, Half Time) diport tangan ke C++: `native/engine/hdfx.cpp` (lib.rs, biquad.rs, reverbs.rs, comb.rs) dan `hdfx2.cpp` (multiband, tape stop, spreader, waveshaper, pitcher, pitcher 2, Multi FX di atas bank `hdmfx`). Aritmetika f32 seperti Rust.
- Device = `100 + id FLM` (`FLMFX_BASE`). Parameter = nilai ternormalisasi FLM (0..1, seperti tersimpan di .flm), indeks sama dengan PRMS; param 0 (On) tersembunyi dan tetap 1 (bypass device yang mematikan); setelahnya Post Gain / Rack Mix / Wet Pan (SMPR, tersembunyi), Pitcher: 12 not C..B (CSTM).
- Verifikasi: harness di scratchpad merender sinyal yang sama lewat crate Rust Honeydew (`AudioEffect`) dan lewat C++: 56 + 14 kasus, selisih 0 (identik bit) kecuali Multi FX (bank double: -90..-120 dB). Desktop vs WASM: -97.8 dB (libm float berbeda di bit terakhir).
- "Merge": modul FLM yang fungsinya sudah ada di MobileDAW (EQ, Compressor, Reverb, Chorus, Phaser, Filter, Gate, Limiter, dst.) tidak ditawarkan dua kali di browser; proyek FLM yang diimpor tetap memakai DSP FLM-nya dengan nama modulnya. Ditawarkan di browser (grup "FL Studio Mobile"): Multi FX, Trance Delay, Tape Delay, Wow & Flutter, Waveshaper, Pitcher, Pitcher 2, Comb Filter, Spreader.
- Impor: setiap modul FLM bertipe yang dikenal -> modul itu sendiri dengan nilai persis (juga bila mode ganti = 'none'); otomasi FLM ke param modul / 0x7FC0..2 diteruskan apa adanya. Tipe 25 ternyata Pitcher (bukan Waveshaper seperti tebakan lama), 41 = Waveshaper, 11 = Chorus, 44 = Spreader.
- Mesin JS cadangan: modul ini tidak ada (placeholder lewat-saja supaya indeks device berikutnya tetap).
- Teks nilai knob = hukum tampilan FLM (`js/fxlaw.js`, port display.rs + formatter modul Honeydew; hukum per parameter di `flmfx.js law`, menu dengan breakpoint indeks `br`). Diekspor dari tabel Rust Honeydew lewat crate sementara; 145.964 teks (401 nilai x 364 parameter) identik dengan Rust; fixture 4.732 teks di `tools/fixtures/flmfx-text.json` dicek `flmfx-test`.
- Comb Filter mode "MIDI Note" mengikuti not track-nya sendiri (`midiIn`, `midiFrom() = 0`; Honeydew sendiri belum menyambungkannya).
- Grafik panel gaya Live (`js/flmviz.js`): respons Equalizer / Graphic EQ / Tuned EQ / Filter (koefisien biquad yang sama dengan engine), kurva transfer Compressor / Limiter / Distortion / Waveshaper, bentuk gain Tremolo / Autoduck, ketukan echo Tape / Trance Delay, peluruhan Reverb, pita Multiband.
- Grafik kini ada di 31 dari 32 modul (Leveller cukup knob). Kurva respons Equalizer / Graphic EQ / Tuned EQ / Filter / Comb (`FLM_RESP`) dicek otomatis terhadap engine: 36 sinus lewat WASM, selisih <= 0.5 dB.
- Proyek .flm lama: saat dibuka, modul FLM yang dulu jadi pengganti / placeholder ditawarkan dikonversi ke DSP FLM (`projects.js offerFlmUpgrade`, `fxmap.js upgradeFlmJson`); lane otomasi ikut dipindah (Mix, Tape Stop Play, Leveller, Graphic EQ), yang tak bisa dipindah dihapus dan dilaporkan.
- Transistor Bass (FLM 19 -> instrumen 34, C++ saja: `native/engine/hdtb.*`): identik bit dengan Rust Honeydew (6 kasus), golden `inst-flmtb`, impor nilai persis, panel ringkas FLM.
- Note effect FLM (47 Note Echo, 48 Transpose, 49 Randomizer, 50 Scale, 51 Arpeggiator -> device 147..151, `noteFx`): C++ saja (`native/engine/hdnfx.*`, port note_effects.rs + Arpeggiator sequencer.rs). Cara kerja seperti Honeydew: daftar not track diolah sebelum diputar, saat not sampai di engine (`commands.cpp` `trackNoteFx` lalu `prepNotes`, di luar thread audio). `project.js` mengirim `trackNoteFx` sebelum `trackNotes` dan mengirim ulang saat rantai berubah (`nfxCheck` di `emit`). Bypass device = Enable 0. Diverifikasi: 19 kasus daftar not identik dengan Rust, golden `nfx-flm`, tes pitch Transpose / urutan Arpeggiator di WASM.
- Belum (note effect): permainan keyboard langsung belum lewat note effect (Honeydew LiveNoteChain); otomasi parameter note effect belum (Honeydew `changes`); Key / Scale di Scale belum menulis ulang 12 not (atur not langsung).
- Slicer (FLM 33 -> instrumen 35, C++ saja: `native/engine/hdslicer.*`, port slicer.rs): detektor transien + player identik dengan Rust (20 kasus audio, 6 Sensitivity: posisi potongan sama). Loop = zona 0 (`project.js` isSampler, param 100), Sensitivity = param 7, First Key = param 8 (0 = 48 seperti FLM). Deteksi dijalankan sekali saat loop / Sensitivity berubah (di web di thread audio: sekali per perubahan). Impor: CSTM PATH (loop) + SENS. Golden `inst-flmslicer`.
- Catatan Slicer: sampel di bank sudah di-resample ke rate engine, sedangkan Honeydew mendeteksi di rate file aslinya, jadi posisi potongan bisa bergeser sedikit untuk file yang bukan 44.1 kHz. Cue marker (Sensitivity 0) belum dibaca dari file. Klip AUTO (not per potongan) belum.
- Impor FLM, detail klip & tata letak (Honeydew audio_clips.rs / read.rs): envelope di dalam klip audio (kunci +-1 Level, +-2 Pan; titik FLM apa adanya, linear antar titik) -> `c.genv` / `c.penv` [detik sumber, nilai] + `c.genvRef`; engine C++ / WASM / core.js membacanya lewat `trackClips` stride 10 + array titik [detik, gain, pan] (`project.js clipEnvFlat`, golden `core-clipenv`, `clip-pan-test`). Garis merah di klip timeline. Envelope Speed (+-3) hanya dilaporkan.
- Speed klip (stretch mati) kini semitone bulat seperti FLM: trunc(48 v - 24) (dulu (v - 0.5) * 48 -> -4.16 bukan -4 di 48 klip Caest La vie). Reverse slot klip (MAIN @1036) -> warp.rev, Mute slot -> klip di-mute; Length / Sample Start slot non-default dilaporkan.
- 24 Tuner / 26 Analyzer dikenali (alat ukur -> Tuner / Spectrum): HIPDUT kini 95/95 modul persis tanpa placeholder.
- Loop proyek (HEAD @272/@280) -> loop region; kanal "zipped" (CHHD @1024) -> track dilipat; urutan kanal dibaca f64 @1028 (dulu setengah atas sebagai f32). Rentang kunci instrumen (ADD1): not di luar rentang tidak diimpor (synth), zona DirectWave lo/hi, Slicer First Note = kunci bawah.
- 3x Osc (FLM 39 -> instrumen 36, C++ saja: `native/engine/hd3osc.*`, port three_osc/*: 3 osilator + tabel mip HQ, 8 filter, envelope / LFO per target, tracking, Mono / Porta / Gate, Echo / Fat Mode, Arpeggio 88 chord): identik bit dengan Rust Honeydew (35 kasus, harness di luar repo), golden `inst-flm3osc` (WASM = desktop). 149 param FLM (`js/flm3osc.js`, dibangkitkan dari instruments.rs) + param 149 = D (subdivisi TDIV, impor dari file). Teks nilai: 46.917 teks identik dengan Rust, fixture `tools/fixtures/flm3osc-text.json`. Panel: 8 tab seperti halaman FLM (Osc per osilator, LFO / Envelope terpisah). Enable off membekukan voice (seperti FLM). Tabel mip dibangun sekali saat HQ Mode pertama dipakai (sekitar 6 MB per bentuk).
- Catatan 3x Osc: bentuk Custom (WAV dari CSTM PATH) belum dibaca: diam, seperti FLM sebelum file dimuat. Proyek lama yang mengimpor 3x Osc sebagai placeholder tidak menyimpan nilai knobnya: impor ulang file .flm.
### Fader gaya Live, titik seret presisi, instrumen FLM sebagai device Live
- **Fader vertikal** (`k.F` di `js/fxkit.js`, item `{ f: j }` di `js/flmlive.js`): alur sempit + isi nilai + pegangan segitiga hitam + kotak nilai, mengisi tinggi kolom. Dipakai di Limiter, Distortion, Chorus, Flanger, Phaser, Stereoizer, Tape Delay, Leveller, Pitcher, Gate, Reverb, Pitcher 2, Transpose, dan Output/Level instrumen FLM 30..36.
- **Titik seret**: posisi dihitung balik dari hukum `pos` titik itu (bisection di `flmLivePart` onMove), jadi titik selalu di bawah jari. `kx`/`ky` tidak dipakai lagi.
- **Beberapa display per card**: spec `{ parts: [...] }`; `D.graph` = fungsi gambar sendiri (`FLM_IGRAPH` di `js/flmviz.js`), `D.cap` = judul display tanpa grafik.
- **Transistor Bass / Slicer / 3x Osc** memakai `flmLive` (`FLM_LIVE.i34`, `.i35`, `OSC3_LIVE`). Gambar 3x Osc (LFO, envelope, filter, echo) skematis, bukan sumbu waktu/Hz asli; gelombang + cutoff Transistor Bass memakai rumus `hdtb.cpp`.
- Tes: `node tools/flmfx-shots.mjs` menyeret 30 titik efek + ring filter Transistor Bass + LFO/envelope 3x Osc + fader Limiter dengan mouse nyata.
- **Fader = volume mixer Live** (gambar pemilik): kotak nilai bulat di atas, batang meter gelap terisi nilai, pegangan segitiga terang di kanan, garis skala. CSS `.lk-fader / .lk-ft / .lk-fh`.
- **DirectWave / GMS / MiniSynth / SuperSaw** (`js/flmpanels.js`): tiap tab disusun dari `DS(title, { k, g, rows, r, sw })` = kolom knob utama | display gelap (judul, grafik, baris angka oranye `NUM` / menu `MEN` / tombol mode `CHH`) | kolom knob; `OUT` = fader Level (+ Pan). `FS` lama tidak dipakai lagi. Teks satu ukuran (tanpa zoom-up) di halaman `DS`.
- **SoundFont**: daftar preset = display gelap (tombol file di baris judul), knob Pitch, fader Gain.
- **DirectWave tanpa panel zona**: ketuk display Sample = pilih sample (kosong) / edit zona; tombol `Zona` di baris display dan menu `⋯` = daftar zona + `+ Zona` (event `mdaw-zone`, dijawab `devices.js`).
- **Tab FX instrumen = satu panel** (`fxPage` di `flmpanels.js`): daftar efek di kiri dengan kotak saklar on/off (`lvTabs` `check`), satu bagian `DS` untuk efek terpilih.
- **Tab ala Sampler Live**: `tabs(k, names, pages, leds)`; LED tab menyala saat bagiannya dipakai (amount ≠ 0, filter aktif, ada efek on). CSS `.flm-ltabs`.
- **Title bar**: tombol `⇄` (`swapBtn`) ganti modul / instrumen cepat; instrumen punya menu `⋯`; tombol header satu ukuran; `.menu` dibatasi tinggi layar dan bisa digulir. Card synth FLM lebar 500 px.
- **Arrangement mengikuti manual Live 12 bab 6** (`js/timeline.js`): (strip Overview sempat ada, dihapus atas permintaan pemilik: `OV = 0`), pojok header **Set / ◀ / ▶ locator** + Snap (`cornerRects`), tombol **H / W** (Optimize Height / Width) di kanan bawah, pita grid selang-seling, **insert marker biru berkedip** saat stop. Tes: `node tools/arr-live-test.mjs` (screenshot di `docs/redesign/arr`).
- **Tema fleksibel** (`js/theme.js`): `setThemeAdjust({ tone, brightness, contrast, intensity, hue })` di atas tema mana pun (`ACT` = tema + penyesuaian; `prefs.themeAdj`), `prefs.gridInt` = Grid Line Intensity. Slider di Pengaturan → Tampilan. Tema baru: Dark Neutral Medium Contrast, Light Neutral Medium / Low Contrast. Warna klip tidak ikut berubah.
- **Control bar**: tombol terpisah, rata, tanpa garis luar, radius 4 px, satu tinggi; ikon metronom dua titik dan ikon browser panel ala Live (`ui.js` `metro`, `panel`).
- **Arrangement, lanjutan**: tombol **Automation Mode** di pojok header (`prefs.autoMode`; mati = lane otomasi tinggi 0), **Waveform Vertical Zoom** (`prefs.waveZoom`, lencana `≈1x` kanan bawah; `wavePath`/`peaksPath` opsi `gain`), warna klip + header ikut Color Intensity / Hue (`theme.js tone()`). Kotak tempo, FPS/CPU, Arrange/Mixer ikut gaya rata.
- **SoundFont**: daftar preset menggulir di dalam card (`.lk-sf .lk-sflist` flex 1 1 0), card tidak lagi memanjang.
- **Semua 32 efek FLM di daftar FX** (`defs.js FLM_PICK`, grup "FL Studio Mobile"): di menu bertanda ` (FLM)`, di Browser label `FLM DSP` (beberapa namanya sama dengan device Live).
- **Grid / ruler / klip**: garis grid warna tinta tema (hitam di tema terang, putih di gelap) dengan 4 tingkat (bar berlabel > bar > beat > sub), dikali Grid Line Intensity; ruler pakai tinta yang sama, angka `--text`. Klip rata (tanpa bayangan / glow), klip terpilih = badan lebih terang + tepi dalam terang.
- **Slider penyesuaian tema**: gaya Live (track tipis, isi dari tengah untuk nilai bipolar, nilai oranye saat diubah).
- **Lock Envelopes** (Live, manual 6.1): tombol gembok di pojok header (`prefs.lockEnv`, default mati = otomasi ikut klip). `project.js moveEnvelopes(strip, s0, len, delta)` memindah titik semua lane otomasi strip itu dalam rentang klip, menimpa tujuan, menjaga nilai di tepi. Dipanggil di akhir seret `move` / `gmove` (track sama saja). Tes: `arr-live-test.mjs` (seret klip 4 bar: puncak otomasi bar 2 -> 6; dengan Lock: tetap bar 2).
- **Ruler urutan Live 12**: angka bar di atas `[0, LT)`, area scrub (locator, loop brace, punch) di bawah `[LT, RULER)`; `RULER = 38`.
- **Slicer**: garis slice + nama tuts di display dari `js/slicerdetect.js` (port JS deteksi Honeydew yang sama dengan `hdslicer.cpp`; tes `flmfx-test`: 4 slice di posisi yang sama dengan yang dimainkan mesin).
- Tab di title bar semua device / instrumen (Drift, Meld, Wavetable, Simpler, Poli ...) bergaya tab Sampler Live. Not MIDI di klip lebih tebal (4/5 baris nada, 2..7 px). Perbandingan: `docs/redesign/arr/compare-live.png`.
- **Referensi Live 12 kedua**: `docs/refs/live12/` (130 gambar dari empat zip pemilik yang terpotong 10 MB, diselamatkan dari header lokal; `INDEX.md` mengelompokkannya). Dari situ: menu grid ala Live (`timeline.js gridMenu`: Snap to Grid, Adaptive Grid Widest..Narrowest = `prefs.adaptPx`, Fixed Grid 8 Bars..1/32 = SNAPS 7..11 ditambahkan di belakang agar indeks lama tetap, Narrow / Widen, Triplet Grid = `prefs.tripGrid`, Zoom / Fit), send di header dalam dB (-inf), tombol nomor track oranye, track terlipat menampilkan klip sebagai pita tipis.
- **Automation Mode = otomasi di atas klip** (refs/live12/112-115): saat mode nyala, lane otomasi pertama sebuah track digambar di lane track itu (garis merah + titik + nama parameter, klip sedikit diredupkan). Hanya tampilan; edit tetap di lane otomasi.
- **Editor MIDI: Randomize / Ramp velocity** (refs/live12/010, `editor.js velTool`): di toolbar saat lane Velocity terbuka; pada not terpilih (atau semua). Tes di `arr-live-test.mjs`.
- Pemilik: **tidak ada mixer di bawah arrangement, tidak ada Session View** (2026-11-15).
- **Pegangan klip ala Honeydew** (`timeline.js selHandles / handleHit / drawHandles`, dari Honeydew `src/ui/clips.rs handle_rects`, GPL): pada klip terpilih kapsul awal (0.5 U di dalam tepi kiri) = trim awal dengan isi tetap di tempat, kapsul akhir (0.15 U di luar tepi kanan) = panjang, dan untuk klip audio yang tidak di-loop batang ↔ di bawah ujung kanan = **stretch langsung** (tanpa mode Stretch; batas mesin tetap 0.25x–4x, Honeydew 0.2x–10x). Kotak fade Live di sudut atas didahulukan. U = 22 px. Pemilik: tampilannya **sederhana** (bukan gaya Honeydew): garis tipis 2 px di tepi kiri/kanan klip terpilih, tab kecil gelap 18x9 px dengan panah ganda di bawah ujung kanan klip audio = stretch; area sentuh tetap ukuran Honeydew. Tes: `arr-live-test.mjs` (kapsul, stretch, fade).
- Tinta isi klip (waveform / not / nama) gelap untuk semua warna kecuali yang sangat gelap (ambang luminans 75), seperti Live 12.
- **Chop… dan Tempo… dari Honeydew** (menu klip; `timeline.js chopClip / tempoClip`, dari `clips.rs every_ticks / chop` dan Half/Double): potong klip tiap 1/6..1 beat (mengikuti grid isi klip, offset diperhitungkan) atau klip audio di transien (deteksi Slicer, Sensitivity 0.25), maks 256 potong, satu undo; Half/Double Time = stretch 2x / 0.5x. Tes: `arr-live-test.mjs`.
- Font arrangement disamakan dengan Live: nama track 10.5 px regular, nama klip regular, angka ruler 9.5 px regular abu.
- **Header track = Live 12** (refs/live12/058, `timeline.js hdr`): tiga kolom ½ / ¼ / ¼: baris 1 aktivator (nomor) | S | arm, baris 2 volume | pan, baris 3 send A | send B (nilai dB polos). Tidak ada tombol otomasi dan isian output di header (ada di menu header: Output…, Lane otomasi…). Grid tema gelap lebih terang, tepi klip tipis. `header-ui-test.mjs` diperbarui.
- **Referensi resmi Live 12** (`docs/refs/live12-official/01..05`, dari pemilik): garis antar-track tipis 1 px, area drop hanya teks "Seret file dan device ke sini" (tanpa kotak), blok nama berwarna ~46% lebar header, tema baru **Dark (Live 12)** (`live12`: abu sedikit lebih terang dan dingin, LIB `tint`). Perbandingan: `docs/redesign/arr/compare-live12-official.png`.
- **Warna & garis dari sampel piksel referensi resmi** (refs/live12-official/02): lane & ruler tema Dark (Live 12) = #323440; grid gelap sangat halus (3-5 level dari lane); grid juga tergambar samar di badan klip (beat 8%, bar 12% hitam); klip tanpa outline; strip nama warna sama + garis 14%; waveform = nada gelap warna klip (shade 0.72), not = nada tergelap (0.85); pita selang-seling hampir tak terlihat di tema gelap; area scrub warna ruler.
- **Tema Light (Live 12)** (`live12light`, sampel refs/live12-official 04): lane/ruler/header #a1a5ae, pita #989ca5. Track terlipat: klip mengisi baris dengan warnanya + "..." (Live). Kontrol header 14 px, teks 9.5 px. Perbandingan terang: `docs/redesign/arr/compare-live12-light.png`.
- **Control bar = Live 12** (sampel refs/live12-official): bar `--panel`, kotak isian/tombol lebih terang 8% putih tanpa garis, radius 2 px, teks abu terang regular 13 px (tempo tidak oranye lagi); isian baru: posisi lagu "1. 1. 1" (`#rd-pos2`, ketuk = ke awal), birama "4 / 4" (`#rd-sig2`, ketuk = jendela Tempo), loop start / saklar loop / panjang loop (`#rd-lst`, `#btn-loop`, `#rd-llen`, ketuk = geser per bar / loop ke klip). Play/rec/stop tanpa kotak. `docs/redesign/arr/controlbar-live12.png`.
- **Lane otomasi = Live 12**: tanpa kotak klip; satu envelope merah bersambung sepanjang lane (nilai ditahan sebelum titik pertama / sesudah terakhir), titik bulat kecil; lane sedikit lebih gelap; header abu dengan garis warna track induk, nama parameter saja (tanpa "Auto:") dan nama track di bawahnya; potongan otomasi terpilih = bingkai terang. Baris Master / return tanpa rona warna di lane. `docs/redesign/arr/automation-lane-*.png`.
- Belum: instrumen replika Live (Drift, Operator, Analog, Poli, Meld, Wavetable, Simpler, Impulse, Granulator, Electric/Tension/Collision, DS) tidak diubah; penanda slice di display Slicer belum ada.

- **Card modul FLM = device Live** (permintaan pemilik: bahasa desain, perilaku dan interaksi card FX Ableton Live): `fxkit.js flmLive` + komposisi per modul di `js/flmlive.js` (37 efek + Transistor Bass / Slicer), dibangun dari bagian yang sama dengan panel Live 12 (`k.dk` display gelap, `k.NT` angka oranye, `k.TL`, `lk-ch`). Pola: kolom knob kiri (`L`) | display (`D`: grafik `flmviz`, `handles` yang diseret seperti Live - EQ band bernomor, ring Filter freq/reso, Threshold Compressor / Gate / Limiter, crossover Multiband, X/Y Waveshaper & Multi FX, 8 band Graphic / Tuned EQ; `tabs` = tombol mode di bawah grafik; `rows` = baris angka di dalam display, `table` = tabel band ala Multiband Dynamics; `tap` keyboard Pitcher; `piano` Scale) | baris knob di bawah display (`B`, ala Chorus-Ensemble / Phaser-Flanger / Auto Pan) | kolom kanan (`R`) dengan Dry/Wet di bawah (`'-'`). Equalizer meniru EQ Eight: band terpilih (Freq / Gain / Q di kiri, tombol 1-4 + tipe + channel di bawah display). `{ sw }` = Sync ala Live (menu saat Sync, knob saat bebas). Tes interaksi nyata di `tools/flmfx-shots.mjs` (seret ring Filter, ketuk keyboard Pitcher 2). 3x Osc masih memakai `flmLayout` (tab).
- Card UI modul FLM (37 efek + Transistor Bass / Slicer / 3x Osc), dibuat sederhana seperti device Live (aturan pemilik: sangat mirip Live, padat tapi tidak bertumpuk, rapi, simetris, ukuran seragam, teks tidak keluar border, tanpa ruang kosong, acuan HP Oppo Find X8): `fxkit.js flmLayout` + data `js/flmlayout.js`, CSS blok "FLM module cards" di `css/ableton.css`.
  Tiga bagian: (1) kolom display - display modul (atau keyboard) mengisi sisa lebar, SEMUA pemilih modul (menu, switch, tombol mode) dalam satu bar di bawahnya; tanpa display bar itu jadi baris atas; (2) grid knob saja, sel seragam (`--fc-w` 68, `--fc-h` 72), jumlah baris dihitung dari tinggi (`fit()`); (3) kolom Output (grup Output/Mix) di kanan di balik satu garis, seperti Dry/Wet Live.
  Modul dengan grup kembar (Band EQ, Low/Mid/High, Arp 1/2, Wow/Flutter/Random, Osc 1-3, LFO/Envelope 3x Osc) memakai satu kolom bertajuk per grup (switch dalam satu baris, menu di bawah judul; banyak menu = baris label + menu dua kolom). `lk-notab`: card tidak dipecah tab oleh rak.
  Label disingkat seperti Live (`flmShort`, `flmSwitch`); Sync seperti Live; not = keyboard piano; Pitcher / Pitcher 2: keyboard display bisa diketuk. Lembar screenshot: `docs/redesign/flmfx/cards-*.png`.
- `fxlaw.js menuItem` kini membandingkan dengan breakpoint f32 (`f(b)`): breakpoint dicetak sebagai f32 terpendek (0.7 = 0.699999988). Modul tambahan Honeydew (bukan FLM) sengaja tidak diport (keputusan pemilik).
- Tema terang = warna sampel dari referensi Live 12 light (pemilik 2026-11-16): toolbar `--tb-bg #7d818d` dengan field `--tb-fld #a1a5ae`, lane/header/body device #a1a5ae, judul device #bbbbc5, display #21252e, menu #dedfe3. Border tipis gelap: `--line #5c5f68`, `--sep #6e717a` (canvas memetakan garis lewat anchor `--line`), field toolbar memakai `box-shadow: inset 0 0 0 1px var(--line)` (css/ableton.css).
- Arrangement seperti Live 12: area "Seret file dan device ke sini" (baris "+", indeks nn) melebar mengisi ruang kosong di bawah track, baris Master / FX menempel di dasar lane, grid berlanjut sampai bawah. Urutan di layar: track, baris "+", Master/FX (tidak urut indeks) — pakai `rowY`/`rowAt`/`visRows()` di timeline.js, jangan menjumlah `rh()` sendiri. Tombol "+ Track" hanya bagian atas baris itu.
- Header track + garis tema terang = Live 12 light (pemilik 2026-11-16, "border abu-abu cenderung hitam"): token `--hd-*` di theme.js (bg #a1a5ae, field #d2d4da, border/garis #3a3c43, volume #05c9d9 di atas #e1e2e7, teks #0f1014); timeline.js `HD(token, warnaGelap)` memakai token bila tema punya, selain itu warna gelap lama lewat C(). Garis tipis antara blok nama dan kolom mixer.
- Control bar (dua tema): field persegi dengan outline tipis `--tb-line` (gelap #1c1e25, terang #3a3c43), tetangga berbagi satu border, transport = ikon polos tanpa kotak (rekam lingkaran abu/hitam, merah saat aktif). arr-live-test kini memeriksa radius 0.
- Baris Master / FX di arrangement: garis atas pada baris pertama (karena kini di bawah area drop), pemisah blok nama | kolom mixer. Meter FPS/CPU: satu field ukuran tetap 82 px, FPS di atas CPU, beban CPU = garis 2 px di tepi bawah; tidak pernah disembunyikan / terpotong di layar sempit (css/ableton.css blok terakhir).
- Catatan: pattern-ui-test kadang gagal pada run pertama tepat setelah `build.mjs`, lalu lulus pada run berikutnya tanpa perubahan (terlihat dua kali, 2026-11-16) - belum ditelusuri.
- Meter FPS/CPU (redesign 2, pemilik 2026-11-16): satu baris "30 FPS | CPU [bar] 0%", lebar tetap, angka tabular; di lebar m/s tanpa caption ("30 | [bar] 0%"). Kolom kanan toolbar `minmax(min-content, 1fr)` agar meter / Arrange-Mixer / menu tak pernah terpotong; di lebar m tombol transport 34 px dan readout loop lebih sempit. Muat penuh mulai viewport 640 px landscape; di bawah itu (600 px) grup kiri (redo) masih terpotong ±57 px.
- Tombol card FX / instrumen + Device/Keys (pemilik 2026-11-16, Live 12): `.lv-btn` persegi (radius 1px) dengan outline 1px `--btn-bd` (terang #3a3c43, Dark Live 12 #16171c, lainnya `--lv-edge`); varian bergaris warna (cyan/oranye, tuts piano, tombol bulat) tetap. Tab seksi di judul card persegi, tab terbuka = warna body + garis oranye atas. Judul card: ⇄ ⧉ ⋯ ▾ ikon polos tanpa kotak; Mix / Preset field persegi kecil (Mix aktif = oranye). Device / Keys = pasangan field seperti Arrange/Mixer. Contoh: `docs/redesign/buttons/`.
- Impor FLM (2026-11-16): STR1/STRC per Honeydew `read.rs slot()` + `sample_cache.rs str1()` — STR1 menang penuh (mode, rasio, semitone); STRC saja = mode 1 + semitone dibulatkan; rasio hanya saat SYNC on, semitone selalu; Speed (PRMS[2]) selalu resample di atasnya (digabung jadi satu warp: rasio x 2^(-rp/12), pitch st+rp). Pad drum kini membaca STR1/STRC juga (`q.warp` -> `q.dsample` dirender saat load, dipakai `sendPad`). Klip SYNC dengan rasio != 1 diberi `srcBpm = rasio x bpm`, `warpAuto` (ikut perubahan tempo seperti Honeydew `song/tempo.rs`), `swing: 0`. Bukti: HIPDUT punya 3 pad SYNC (1.135-1.477) yang dulu diputar tanpa stretch; Caest La vie: 677/677 klip warp dirender dengan panjang benar (web).
- Layering instrumen (FLM: semua instrumen di rack channel berbunyi, Honeydew `process_racks`): channel dengan 2+ synth -> Instrument Rack, chain k = instrumen k + efek di antara instrumen k dan instrumen terakhir; efek setelah instrumen terakhir tetap di track. Efek di chain ikut dikonversi ke modul FLM (`migrateJson`). `IRACK_INSTS` diperluas (Transistor Bass, 3x Osc, synth Live); chain tanpa layout panel menampilkan grid knob. Tes: import-test (model sintetis).
- SuperSaw (redesign 2026-11-16): tab OSC (Oscillator + Unison), SYNC (Supersync, lampu tab menyala saat Osc Mode = Supersync), FILTER, LFO, AMP, MOD, VOICES, FX; kartu ~974 px (dulu ~1220 px dengan 3 panel). Gambar: docs/redesign/supersaw/.
- Audit pembaca FLM vs Honeydew `src/flm/read.rs` (2026-11-16): ditambah `SF2D` (SoundFont Player: .sf2 sendiri + patch indeks urutan file -> `sf.flmPatch`, dipetakan ke daftar preset MobileDAW yang diurut bank/program lewat `order` dari sf2.js), `EVNT` (event lama tanpa ukuran rekaman), `SMPL`/`RMOD` (varian lama slot/modul), key not `i16` dibatasi seperti `decode_events`, klip tanpa panjang: source length dulu baru loop length (`lane.rs visible_ticks`). Tidak dibaca (tidak memengaruhi suara / tidak bisa): KEYB, META, CCLK, PADS, ZOOM, PLUG/PSTA (plugin pihak ketiga), HD* (ekstensi Honeydew).
- Cross-check pembaca FLM vs Honeydew dengan pembaca Honeydew sendiri (tools/flmcheck/, Rust example + dump JS + compare): 5 proyek, 9 846 item, 0 selisih. Regresi yang tertangkap & diperbaiki: key i16 yang dibatasi sempat menghapus titik envelope klip audio ber-key negatif (clipEnvs kini memakai `e.key` mentah).
- Moisture (instrumen 37, pemilik 2026-11-16: "moisture seperti Serum, support preset .fxp, tampilan seperti plug-in, hanya jendela mengambang"):
  - Engine C++ `native/engine/moist2.cpp` (web = build WASM): wavetable A/B (10 tabel bawaan buatan sendiri + tabel kustom dari sample bank, frame 2048, 11 level mip), unison 16, 22 mode warp, sub (6 bentuk), noise, filter (18 tipe pertama daftar Serum, sisanya Low 12), Env 1-3 (waktu 32 v^5 s), LFO 1-8 (sync / Hz), matriks 32 rute (sumber -> indeks parameter), rak FX (Hyper/Dimension, Distortion 13 mode, Flanger, Phaser, Chorus, Delay, Compressor + make-up otomatis, Reverb, EQ, Filter). Hukum Hz/detik/dB = perkiraan MobileDAW, bukan kode Serum.
  - Parameter 0..298 = urutan & normalisasi parameter VST Serum 1 (js/serumparams.js, dari catatan komunitas 0xdevalias), default = nilai init Serum (kecuali jumlah mod disimpan bipolar 0.5 = 0); 300.. milik Moisture (tabel, sample id, voices, mono/legato, bentuk/sync/mode LFO, rute).
  - .fxp (`js/serumfxp.js`): header VST2 CcnK/FPCh/XfsX, stream zlib 1 = blok parameter di 0x3460 (Serum 1.3x preset nyata: 248 nilai valid, sisanya NaN -> nilai awal), nama di 0x4970, nama file wavetable di 0x3C08 / 0x3E08; stream zlib 2 = frame osc A lalu B (2048 float), dipisah di lonjakan beda antar-frame terbesar (diverifikasi pada 3 preset ESW: 1+1, 256+1, 256+87). Routing modulasi TIDAK dibaca (belum terdokumentasi). Wavetable disimpan ke /Samples/Wavetables/<nama>.wav dan dimuat ulang saat proyek dibuka (`t.inst.wt`).
  - Tampilan: `js/moistview.js` (bukan gaya Live): bar atas (logo MOISTURE, halaman OSC/FX/MATRIX/GLOBAL, nama preset, MAIN), SUB / OSC A / OSC B / NOISE / FILTER, MACROS / ENV / LFO / VOICING. `def.floatOnly`: di rak hanya kartu "Tampilkan", panel selalu di jendela mengambang (1040x660). Moisture Klasik (7), Osphere (8), Keystone (9) DIHAPUS (pemilik 2026-11-16): tidak ada di menu; proyek lama dimigrasi saat dibuka (7, 8 -> Moisture 37 lewat `CLASSIC_CONV.toMoist`, nilai asli di `inst.classic`; 9 -> DirectWave 30, zona tetap); presetnya jadi 221 preset Moisture (presets-test merender lewat WASM). Tes: `tools/serum-fxp-test.mjs` (run-tests), golden `inst-moisture` (C++ desktop vs WASM).

## Audit bug + kualitas mesin audio + DirectWave WAV/MP3/DWP (sesi 2026-11-16)
- Audit: 26 tes di luar run-tests + engine-e2e / import-ui / ui-audit / ui-consist dijalankan; semua lulus. Bug yang ketemu saat
  membuat tes DWP: `decode()` (js/engine/web.js) memberi Uint8Array ke `decodeAudioData` (hanya menerima ArrayBuffer). File yang
  disimpan aplikasi sebagai Uint8Array (sample hasil edit gelombang, wavetable Moisture) gagal dimuat saat proyek dibuka lagi. Diperbaiki:
  view dikonversi ke ArrayBuffer.
- DirectWave (30): `js/dwp.js` = pembaca program .dwp (port struktur Honeydew `crates/audio/src/dwp.rs`: "DwPr", record tag/u64 len,
  zona 0x1F4/0x1F6/0x1F7/0x1FD/0x205/0x206). `P.loadDwpProgram(i, path)`: zona menggantikan zona track (maks 16), audio tertanam disimpan
  ke `/Samples/DirectWave/<program>/NN <nama>.wav|.flac`, file zona dicari menurut nama (folder .dwp dulu, lalu seluruh pustaka),
  Attack/Release dari zona terakhir (hukum amp FLM), bisa di-undo. UI: browser menampilkan .dwp (ketuk = muat ke track DirectWave),
  menu Zona punya "Muat WAV / MP3 / program DWP…". Belum: titik loop zona (mesin hddw meloop seluruh sample), gain zona selalu dipakai
  (Honeydew hanya saat Loop). Tes: tools/dwp-test.mjs (parser + aplikasi + MP3 dari encoder aplikasi sendiri).
- Stretch 'beats' (js/engine/audioops.js) ditulis ulang: WSOLA per segmen antar-attack (`findOnsets`): attack diputar persis di posisi
  peta, tidak pernah dua kali; korelasi resolusi penuh (512 frame) — sebelumnya dicuplik tiap 4 sample sehingga nada tinggi (9 kHz)
  saling meniadakan. Hasil ukur (stretch-test bagian 9): posisi attack meleset 0 frame (sebelumnya sampai ~2000 frame / 40 ms, ada
  pukulan ganda). Pitch (beats & tones) kembali ke panjang asli dengan resampler sinc Kaiser 64-tap (`bandResample`) bukan interpolasi
  linear: aliasing +7 st dari 18 kHz turun dari -4 dB ke -116 dB; -5 st dari 12 kHz tidak lagi turun 1.8 dB. Biaya: pitch 10 s stereo
  ~0.9 s di desktop (sebelumnya 0.2 s), di worker.
- Limiter master (fx.cpp + fx.js, sama persis untuk golden): minimum gain ditahan 12 ms setelah puncak. THD nada 45 Hz +4 dB di atas
  full scale: 1.25 % -> 0.08 % (tools/limiter-test.mjs). Ceiling tetap -0.3 dB.
- Belum bisa dibuktikan tanpa render referensi FL Studio Mobile: "lebar" stereo. Mix Caest La Vie terukur side/mid sekitar -36 dB;
  modul FX dengan nilai default terbukti stereo (side/mid 0 dB untuk L/R independen), dan sample stereo tetap stereo setelah stretch.
  Perlu ekspor FLM dari proyek yang sama (master + per-track) untuk perbandingan objektif.

## Importer FLM vs Honeydew, progres memuat, oversampling, alat FLM, tutorial interaktif (sesi 2026-11-16, lanjutan)
- Importer FLM (js/import/flm.js + build.js), dibandingkan dengan Honeydew `drums.rs` / `audio_clips.rs` / `read.rs`:
  - Pitch STR1 dibulatkan ke semitone utuh dan dibatasi ±24, rasio stretch dibatasi ×¼…×4 (`strSemis` / `strRatio`), seperti render FLM.
    Sebelumnya 262 dari 1002 klip Caest dan 92 klip HIPDUT diputar dengan pitch pecahan (mis. -3.498 st, padahal FLM -3).
  - Loop klip audio: offset konten ada di dalam loop (`ll` = loop, `lp` = offset, `lps` = koreksi Speed). Klip dengan offset + panjang >
    loop kini membungkus di batas loop seperti FLM (sebelumnya terus memutar sample).
  - Slot kit drum: rasio stretch berlaku kapan pun ≠ 1 (mode di file diabaikan, seperti Honeydew).
  - Program library DirectWave (mis. "Keyboard/Grand Piano"): bila .dwp bernama sama ada di pustaka, dipakai (dimuat saat proyek dibuka);
    jika tidak, tetap GM SoundFont pengganti.
  - Sample Start / Length / ADSR slot klip audio belum diterapkan (0 klip memakainya di semua proyek pemilik); tetap dilaporkan.
- Jendela progres memuat proyek (js/loadprog.js): setiap sample, render stretch/pitch, dan klip yang disesuaikan ke tempo / swing adalah satu
  langkah; dipakai saat membuka proyek, demo, cadangan, sesi terakhir, dan impor. `bakeHooks.hold` menahan bake sampai proyek selesai dimuat.
- Oversampling 4× (native/engine/os.h = js/engine/os.js, tap filter literal agar desktop = WASM bit demi bit): Amp, Overdrive, Pedal,
  Drum Buss, Vinyl Distortion. Aliasing (relatif terhadap harmonik): Amp -20 → -87 dB, Pedal -17 → -76, Overdrive -18 → -49, Drum Buss -33 → -57.
  Nada / dinamika tetap (selisih ≤ 0.2 dB). Tidak di-oversample: Roar dan FLM Waveshaper (konstanta per-sampel berubah di 4×), FLM
  Distortion (dipertahankan seperti FLM; tanh/pow libm desktop vs WASM membuat golden -84 dB).
- Alat alur FL Studio Mobile: "Nilai persis (Fine tune)" di menu tahan setiap kontrol (automate.js `fineTune`); DirectWave "Buat dari
  sample (multi-sample)" = instrument builder FLM (js/tokenmap.js, port Honeydew token_map.rs: root / tuts / velocity / round robin dari
  nama file). Tes: tools/flmtools-test.mjs.
- Tutorial interaktif (js/tutorial.js): 5 bab, 45 langkah. Spotlight pada kontrol asli, kartu penjelasan, langkah "Coba" menunggu aksi
  pengguna. Termasuk latihan membuat beat pertama. Dibuka dari Menu → Tutorial interaktif; ditawarkan sekali saat pertama kali dibuka
  (tidak saat diuji otomatis). Overlay diletakkan tepat sebelum #layer agar menu / dialog tetap di atasnya. `T.tutorialRects()` memberi
  posisi bagian arrangement (canvas). Tes: tools/tutorial-test.mjs (`--shots` → docs/redesign/tutorial/).

## Tutorial showcase "Neon Horizon" + animasi tutorial (sesi 2026-11-16, lanjutan)
- demos/progressive-house.mdaw: lagu progressive house asli 2:00 (128 BPM, F minor, 64 bar), dibuat oleh tools/make-proghouse.mjs lewat
  API proyek di Chromium (`--render out.wav` untuk mixdown). Instrumen bawaan saja; sidechain Autoduck dari Kick ke Bass / Pluck / Pad;
  otomasi Auto Filter pad, pitch riser, volume master; Reverb + Delay return; Glue + Limiter master. Level terukur (solo, RMS):
  Kick -15, Lead -17, Pad -20, Bass -21, Pluck / Drums -27 dB; puncak mix -1,9 dBFS, tanpa clipping. Terdaftar di DEMOS (`neon-horizon`).
- js/tutorial.js v2: bab "Showcase" (16 langkah) membuka demo itu dan membongkarnya sambil diputar: struktur + marker, kick, drum,
  bass + sidechain, pluck + delay 3/16, pad + otomasi filter, lead, riser, return, master, latihan mute. Langkah bisa punya `acts`
  (tombol: putar dari bagian, solo...), `tips` (Detail & tips), `gest` (jari animasi tap / dtap / hold / drag / swipe), `live` (peta lagu:
  marker sebagai bagian berwarna, playhead mengikuti lagu, bagian aktif menyala, ketuk = lompat), `finale` (hujan konfeti), `pre` async.
  Animasi: kartu masuk dengan spring + isi bertahap, spotlight meluncur dan berdenyut, splash bab dengan equalizer, progress bar, burst saat
  latihan berhasil. Semua mati dengan prefers-reduced-motion. Kartu pindah ke samping target bila atas / bawah tidak muat.
  `startTutorial(id, only)`; menu tutorial menampilkan showcase sebagai kartu utama. `T.revealRow()` menggulir lane / "+ Track" ke layar.
- docs/redesign/tutorial/neon-horizon.mp3: render mixdown untuk didengar.
- Sample drum showcase (permintaan pemilik "cari sendiri"): Stargate DAW sample pack, lisensi CC0 1.0 (domain publik, boleh didistribusikan
  bersama aplikasi). Dipilih dan diukur: kick `stargate/kick-1-C` (dasar ~64 Hz = C, kuint F minor), clap / hat / ride `x0xproc1` (gaya 909),
  snare `x0xproc2` (roll), crash `distkit`, white noise 7,5 s (= 4 bar di 128 BPM) untuk Noise Riser. Dipotong + dinormalisasi ke -1 dBFS
  di demos/Samples/NH *.wav (2,2 MB); DEMOS `neon-horizon` menyalinnya ke /Samples/Demo saat dibuka. Track baru: Cymbals (crash di setiap
  bagian, ride di Drop B) dan Noise Riser (audio + Auto Filter 250 Hz → 18 kHz). Level solo RMS: Kick -13, Lead -17, Pad -20, Bass -21,
  Drums -22..-26, Pluck -27 dB; mix puncak -3,3 dBFS. Kredit: demos/README.txt, THIRD_PARTY_NOTICES.md.
- Showcase dibangun ulang secara profesional (permintaan "bukan ala-ala"): 16 track (drum per peran, Sub + Mid Bass, Chord Stabs, Pad,
  Atmosphere, Pluck Arp, Lead + Lead Layer, Riser, FX, Noise Riser), Drum Bus (Glue 4:1 + saturasi) dan Music Bus (Autoduck dari Kick,
  Glue, high-pass otomatis di build-up), harmoni Fm9 - Dbmaj7 - Ab(add9) - Eb dengan pedal tone, hook satu ritme di empat akor, transisi
  (reverse crash, impact, sub drop, downlifter, noise / synth riser, kick roll, satu ketukan hening sebelum Drop). Master: EQ, Glue
  ringan, soft clipper (Saturator), Limiter. Diukur dengan analyzer BS.1770 (scratch): -8,3 LUFS integrated, -1,2 dBTP, PLR 7,1;
  Drop -7,7 / Intro -9,1 / Breakdown -10,1 LUFS short-term; spektrum drop per oktaf menurun halus dari 63 Hz. Temuan selama mixing:
  kick yang terlalu keras membuat semua bagian sama keras; tanpa clipper limiter menekan seluruh drop 2-3 dB. Sample tambahan: snare
  layer, shaker, rim (Stargate CC0), bongo (freesound CC0) dan 4 FX transisi yang disintesis (CC0). Bab showcase ditulis ulang (16 langkah).
