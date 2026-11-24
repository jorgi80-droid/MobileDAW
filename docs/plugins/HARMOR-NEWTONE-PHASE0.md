# Harmor & NewTone — Phase 0: Audit & Arsitektur

Dokumen ini adalah hasil audit MobileDAW sebelum menulis kode Harmor dan NewTone. Semua temuan diambil dari source code
yang ada di repo ini (bukan asumsi), dan dipakai untuk menentukan di mana kedua plugin menempel ke sistem yang sudah berjalan.

## 1. Temuan audit

| Area | Implementasi yang ada | File utama |
|---|---|---|
| Audio engine | **Satu engine C++** (`native/engine/*`, ~12.800 baris). Web: dikompilasi ke WebAssembly dan dijalankan di AudioWorklet (`worklet-wasm.js`). Android: engine yang sama sebagai native C++ (Oboe). Engine JS (`js/engine/*`, `worklet.js`) hanya cadangan bila WASM gagal dimuat. | `native/engine/engine.cpp`, `js/engine/web.js`, `native/wasm/build.sh` |
| Kesetaraan JS ↔ C++ | Golden test membandingkan engine JS dan C++ sampai -90 dB; skenario native membandingkan desktop dan WASM. | `tools/golden/*` |
| Audio routing | Track → rantai device → send A/B / FX return → master (index 64 = master, 65+ = return). | `js/project.js` (`syncTrackFull`, `syncAll`) |
| Plugin host / registry | Instrumen = `INSTRUMENTS[type]` (definisi parameter) + factory engine `makeInstrument` (C++ `units.cpp`, JS `instruments.js`). Efek = `DEVICES[type]`. | `js/defs.js`, `native/engine/units.cpp` |
| Instrumen besar terbaru | Transistor Bass (34), Slicer (35), 3x Osc (36), **Moisture (37)**: DSP **hanya C++**, engine JS mengembalikan `null`. UI, definisi, preset, loader tabel: JS. | `native/engine/moist2.cpp`, `js/moistdefs.js`, `js/moistview.js` |
| Data besar ke engine | Bank sample (256 slot): JS mengirim `Float32Array` lewat `putSampleBuffers(id, l, r)`; instrumen membaca slot lewat parameter ID (Moisture: param 302/303 = wavetable). Di Android, web layer meneruskan buffer yang sama ke engine native (`nat.mirror` → `nat.sink.sample`). | `js/engine/web.js`, `js/project.js` |
| MIDI input | Web MIDI (desktop/Chromium) → preview / rekam ke track; keyboard layar; pitch bend & mod wheel (CC1). | `js/midi.js`, `js/midiio.js`, `js/keys.js` |
| Parameter | Parameter instrumen = indeks angka di `t.inst.params[k]`; definisi `{n, min, max, def, curve, step, unit/fmt}`; dikirim ke engine lewat `instParam(track, k, v)`. | `js/defs.js`, `js/project.js` |
| Automation | Lane otomasi target `kind 5` = parameter instrumen (indeks). | `js/project.js` (automation) |
| Preset | Preset pabrik per instrumen (`PRESETS`, `presetlib.js`) + file preset user di `/Presets/Instruments` (simpan/muat/hapus lewat browser). | `js/presets.js`, `js/presetlib.js` |
| Save / load | Proyek `.mdaw` = JSON (`serialize` / `deserialize`); sample disimpan sebagai path; pemuatan dua tahap (struktur dulu, audio di belakang). | `js/project.js` |
| Undo / redo | `HK.add({...})` per perubahan; grup per aksi. | `js/history.js` |
| Worker | Render stretch/pitch di pool Web Worker (sampai 4). | `js/engine/stretchworker.js`, `js/project.js` |
| Penyimpanan | IndexedDB (`mobiledaw`): indeks file + data; dicerminkan ke folder perangkat (File System Access / SAF di Android). Cache render di `/.cache/render`. | `js/engine/web.js`, `js/storage.js` |
| Offline | Service worker dengan daftar aset (`sw.js` ASSETS, dibangun `tools/build.mjs`). Tidak ada CDN. | `sw.js`, `tools/build.mjs` |
| UI | Komponen gaya Live (`liveui.js`: knob, fader, toggle, choice, display canvas), kit panel device (`fxkit.js`), jendela plugin mengambang untuk plugin besar (`floatwin.js`, contoh `moistview.js`). | `js/liveui.js`, `js/fxkit.js`, `js/floatwin.js` |
| Responsif | `uiscale.js` (skala UI), tata letak per lebar (`data-w`), tes OPPO / Pixel. | `js/uiscale.js`, `js/layout.js` |

## 2. Keputusan arsitektur

### 2.1 Bahasa DSP — temuan yang bertentangan dengan permintaan "JavaScript-first"

DSP real-time yang ditulis **hanya** di JavaScript **tidak akan berbunyi** di engine default MobileDAW:
web memakai engine C++/WASM, Android memakai engine C++ native, dan engine JS hanya cadangan. Membuat AudioWorklet
terpisah khusus Harmor berarti membuat audio host kedua di luar mixer, efek, otomasi, ekspor, dan Android native —
itu persis yang dilarang ("jangan membuat sistem audio atau plugin host baru").

Profiling (desktop, satu core, oscillator tabel per partial, 48 kHz):

| Beban | JS | C++ (-O2) |
|---|---|---|
| 128 partial × 8 voice | 16 % | 13 % |
| 516 partial × 8 voice | 28 % | 23 % |
| 516 partial × 16 voice | 55 % | 45 % |

Kesimpulan jujur: **C++ tidak jauh lebih cepat** untuk inti ini. Alasan memakai C++ adalah **arsitektur host**, bukan kecepatan.
Kedua angka juga menunjukkan oscillator naif per partial **terlalu berat untuk HP** di 516 partial, jadi Harmor memakai
sintesis yang lebih hemat (bank oscillator rotasi kompleks / IFFT overlap-add) apa pun bahasanya.

Rekomendasi (mengikuti pola Moisture):

- **Harmor**: loop suara real-time (partial, voice, filter, articulator, unison, efek internal) di **C++** di engine yang sama
  (`native/engine/harmor.*`, instrumen baru), sehingga otomatis jalan di web (WASM) **dan** Android native, ikut mixer,
  efek, otomasi, freeze, dan ekspor. **Semua yang lain JavaScript**: definisi parameter + schema, UI (MAIN / IMG / FX / ADV),
  editor harmonik/envelope, analisis gambar & audio (Web Worker) yang menghasilkan tabel partial, preset, tes.
- **NewTone**: **seluruhnya JavaScript**. NewTone bekerja pada klip audio (bukan aliran real-time), jadi cocok dengan pipeline
  non-destruktif yang sudah ada: instruksi edit disimpan di klip, analisis & rekonstruksi di Web Worker, hasilnya buffer turunan
  (seperti render stretch/pitch) yang diputar engine mana pun, termasuk Android native, dan disimpan di cache render.

### 2.2 Titik integrasi

**Harmor**
- `js/defs.js` — instrumen baru (tipe 38) dengan schema parameter ber-ID stabil + versi schema.
- `native/engine/harmor.h/.cpp` — DSP; `units.cpp` — factory `case 38`; `js/engine/instruments.js` — `case 38: return null` (seperti 34–37).
- Tabel gambar / resynthesis: dibuat di Worker JS → `putSampleBuffers` → ID slot di parameter (pola Moisture 302/303).
- UI: `js/harmor/` (view plugin + editor), didaftarkan sebagai jendela plugin seperti `moistview.js`.
- Preset: `PRESETS[38]` (pabrik) + mekanisme preset user yang sudah ada; ekspor/impor `.mdawpreset`.
- Tes: `tools/harmor-test.mjs` (render C++ desktop host, ukur frekuensi, distribusi harmonik, filter, clipping, dll.).

**NewTone**
- Data di klip audio: `c.nt = { v, analysis ref, notes[], global }` (instruksi edit, non-destruktif).
- `js/newtone/` — analisis (pYIN + autokorelasi + spektral, onset, voicing, segmentasi) di Worker, editor nada (canvas, touch),
  rekonstruksi (PSOLA/WSOLA/phase vocoder + formant) di Worker.
- Hasil render → buffer turunan klip (jalur `deriveSample` / cache render) → diputar engine.
- Tes: `tools/newtone-test.mjs` dengan sinyal uji yang diketahui (sinus, vibrato sintetis, vokal sintetis berformant).

## 3. Urutan kerja

| Fase | Hasil yang bisa diuji |
|---|---|
| 0 | Dokumen ini + keputusan arsitektur. |
| 1 | Harmor: mesin partial + timbre 1/2 + voice + MIDI; tes frekuensi dasar, distribusi harmonik, amplitudo/fase partial, blending, polifoni, clipping. |
| 2 | Pitch, filter (+ kurva respons), articulator, LFO, unison, efek. |
| 3 | Image synthesis + audio resynthesis (Worker → tabel → engine). |
| 4 | NewTone analisis: pitch, onset, voicing, segmentasi, confidence. |
| 5 | NewTone edit: koreksi (Center/Variation/Transition), timing, vibrato, formant, rekonstruksi, ekspor WAV. |
| 6 | UI lengkap gaya Live 12 untuk keduanya (portrait/landscape). |
| 7 | Integrasi preset, otomasi, proyek, undo. |
| 8 | Optimasi Android, offline, CPU/memori, kualitas audio. |

Setiap fase baru dianggap selesai bila tes audionya lulus.

## 4. Status

### Phase 0 — selesai
Keputusan pemilik: loop suara real-time Harmor di C++ (pola Moisture); semua bagian lain JavaScript; NewTone 100 % JavaScript.

### Phase 1 — Harmor additive engine: selesai (tes lulus)
- `native/engine/harmor.{h,cpp}` (instrumen 38): partial = oscillator rotasi kompleks (fase kontinu, tanpa tabel), sampai 516 partial per
  voice + 2 partial sub-oktaf; Timbre 1/2 (Sine, Saw, Square, Triangle, Custom) + tabel level/fase harmonik dari bank sample (slot 13 / 23);
  blend Mix (jumlah kompleks) / Morph (amplitudo + arah fase); acak fase per voice; stretch harmonik (k^(1+0.1 s)); jumlah partial
  adaptif (Draft 64 / Normal 256 / High 516 dan anggaran partial×voice); peredaman 0.40–0.47 × rate, di atas Nyquist tidak dihitung;
  koefisien diramp per 32 sampel (anti-klik); 16 voice, pencurian voice dengan fade 3 ms; pitch bend; ADSR amplitudo; soft-limit output.
- `js/harmor/schema.js`: parameter ber-ID stabil + versi schema; `INSTRUMENTS[38]`, daftar instrumen, panel generik sementara.
- Tes: `tools/harmor-test.mjs` (di build WebAssembly — engine yang sama dengan web/Android): frekuensi dasar 44,1 / 48 kHz,
  distribusi harmonik saw/square/triangle/sine, fase partial, tabel gambar (level + fase, berubah saat note berbunyi), mix vs morph,
  acak fase, jumlah partial + kualitas, tanpa aliasing (−81 dB), sub, stretch, stealing tanpa klik, release ke senyap, chord 8 voice
  tanpa clipping, pitch bend, CPU (≈18 % satu core desktop untuk 8 voice × 256 partial). Golden `inst-harmor`: desktop = WASM identik.

### Phase 2a — Harmor pitch, filter, articulator, LFO, unison: selesai (tes lulus)
- Pitch: Coarse / Fine, vibrato (rate, depth, delay), artikulator Pitch (±48 st), pitch bend, Mono / Legato / Glide.
- Filter 1 / 2 sebagai gain per partial (presisi, tanpa osilator tambahan): Low-pass / High-pass (12 / 24 / 48 dB), Band-pass, Band-stop,
  Formant (vokal A-E-I-O-U digeser cutoff), Custom (kurva gambar dari bank sample); resonansi sampai +24 dB dengan lebar dan offset
  (oktaf), self-oscillation (sinus di frekuensi resonansi), key tracking, velocity ke cutoff, mix per filter.
- Articulator (10, 8 aktif sekarang; 2 untuk image di Phase 3): multi-titik (≤ 16 titik, kurva, titik sustain, loop) atau AHDSR, dengan depth:
  Volume, Pitch, Cutoff 1 / 2, Frequency (stretch), Harmonic level (kemiringan dB/oktaf), Harmonic phase, Timbre mix.
- LFO 1 / 2 per voice: sine / triangle / saw / square / S&H, rate, phase, depth, retrigger, tujuan (pitch, cutoff 1/2, volume, timbre
  mix, harmonic phase, pan, stretch).
- Unison sampai 8 salinan per voice: detune, pitch spread, stereo spread (equal power), fase acak, distribusi volume; daya dinormalisasi.
- Tes (`tools/harmor-test.mjs`, 52 pemeriksaan): vibrato ±49,4 ct / 5,0 Hz; LP 24 dB tepat (−0,02 / −3,01 / −24,10 dB), HP 12 dB tepat,
  band-stop −80 dB, resonansi +24 dB, mix filter −6,02 dB, key tracking identik antar-oktaf, self-osc, formant A, kurva gambar,
  attack 200 ms (0,51 di 100 ms), loop multi-titik 100 ms, tilt −12 dB/okt tepat, fase harmonik, timbre mix, stretch, LFO 4 Hz,
  pan, unison (kiri flat / kanan sharp, level terjaga), chord 8 × 8 unison tanpa clipping, glide legato tanpa klik, CPU ≈ 22 % satu core
  desktop untuk 8 voice × 4 unison + 2 filter + LFO + articulator. Golden `inst-harmor` diperluas: desktop vs WASM −203 dBFS.

### Phase 2b — modul khusus + rak efek: selesai (tes lulus)
- Di ranah partial: **Prism** (Scatter: partial digeser acak-deterministik sampai ½ harmonik; Shift: semua partial naik sampai 2 × f0 Hz,
  inharmonik), **Pluck** (tiap partial meluruh, yang tinggi lebih cepat: Time, Damp), **Blur** (amplitudo partial dihaluskan terhadap waktu,
  naik = Attack, turun = Release, Harm = partial tinggi lebih lambat), **Phaser spektral** (notch berjarak oktaf menyapu spektrum: Depth,
  Notches/oktaf, Speed, Sharp, Offset).
- **Rak efek** di dalam Harmor: Distortion (Saturator), Chorus-Ensemble, Phaser-Flanger, Delay, Reverb, Compressor, EQ Eight — **efek
  MobileDAW yang sama** (C++ yang sama dengan efek track), urutan 7 slot bisa diubah, On + Mix per efek, tempo / posisi lagu diteruskan,
  latensi dilaporkan (PDC), instrumen tetap aktif selama ekor efek berbunyi. Parameter detail tiap efek: ID HM.FX + 48 k + 2 + j
  (sama urutannya dengan efek di track), panelnya di Phase 6.
- Tes: Prism shift (partial 1 tepat 220 Hz, partial 3 tepat 440 Hz), scatter; Pluck (fundamental −6,51 dB dalam 0,75 s = teori −6,51;
  partial 8 tertinggal 79 dB); Blur (26 % vs 3 % di 40 ms, 99 % di 1 s); phaser spektral 2,0 Hz / 33 dB; **ketujuh efek di dalam Harmor
  identik bit-per-bit (−240 dB) dengan efek yang sama di track**; urutan efek berpengaruh; mix 50 % tepat di tengah; ekor delay terdengar
  setelah voice selesai. Golden `inst-harmor` mencakup 2b (desktop vs WASM −204 dBFS).

### Phase 3 — Image Synthesis + Audio Resynthesis: selesai (tes lulus)
- **Engine — peta partial** (`harmor.cpp`): frame (waktu) × bin, amplitudo kiri/kanan, deviasi frekuensi (cent), fase; disimpan di slot bank
  sample dengan header sendiri. Dibaca per langkah: speed, start, loop/hold, interpolasi frame; layout **Harmonik** (bin = nomor partial;
  **Formant** = dibaca pada frekuensi partial relatif nada yang dianalisis, sehingga envelope spektrum tetap di Hz) atau **Log-frekuensi**
  (bin = frekuensi, tidak bergantung nada); deviasi frekuensi per partial (vibrato, inharmonik); peta stereo memberi tiap partial koefisien
  kiri/kanan sendiri; fase awal dari peta; Map Mix / Level / Shift; articulator Image Freq dan Image Gain aktif.
- **Image Synthesis** (`js/harmor/imagemap.js`, JS): horizontal = waktu, vertikal = partial (bawah = partial 1) atau frekuensi (log),
  kecerahan = amplitudo (gamma + rentang dB); crop/zoom/pan/posisi = wilayah gambar; interpolasi bilinear; warna = stereo (merah kiri,
  biru kanan); dinormalisasi ke kenyaringan saw.
- **Audio Resynthesis** (`js/harmor/resynth.js`, JS, di Web Worker): nada = median YIN (`js/audiokit/pitch.js`, dipakai juga NewTone);
  STFT (Draft/Normal/High), tiap harmonik dicari di sekitar k × f0 frame, frekuensi presisi (parabola), amplitudo dari energi lobus
  (tahan vibrato), fase; kiri/kanan terpisah. Sumber tanpa nada yang dapat dipercaya (drum, noise, akor) → peta log-frekuensi + alasannya
  di laporan (tidak memaksakan nada).
- **Aplikasi** (`js/harmor/harmor.js`): menu kartu Harmor "Image synthesis: muat gambar…", "Resynthesis: muat audio…", "Hapus peta";
  analisis di worker; hasil di cache render; proyek menyimpan sumbernya, peta dibuat ulang/diambil dari cache saat dibuka.
- Tes: `tools/harmor-map-test.mjs` (23) + `tools/harmor-app-test.mjs` (4): YIN ≤ 0,14 cent (82–988 Hz), fundamental hilang 200,00 Hz,
  noise tak bernada; frame/interpolasi/speed/loop/level/mix/shift/articulator image; log-frekuensi tak bergantung nada; peta stereo;
  deviasi +100 cent tepat 233,08 Hz; gambar (baris → partial, kolom → waktu, crop, warna → stereo); resintesis saw: nada 56,99,
  harmonik 0/−6,02/−9,54/−13,98/−18,06 dB tepat, partial 1 = 0,300, hasil sintesis ulang ≤ 0,25 dB dari sumber, vibrato ±27,5 cent
  (sumber ±30; jendela analisis 85 ms meratakan sedikit), stereo −6,02 dB tepat; formant tetap ~880 Hz satu oktaf di atas (tanpa
  Formant pindah ke 1540 Hz); noise → peta log dengan kemiringan terjaga; di aplikasi: gambar, resintesis (nada 57,00), simpan + buka
  ulang identik (93 ms). Golden `inst-harmor` + peta: desktop vs WASM −205 dBFS.

### Phase 6 (Harmor) — tampilan plugin: selesai (tes lulus)
- **Jendela** (`js/harmor/view.js`, `VI[38]` di `js/fxkit.js`): jendela mengambang besar, gaya Live 12 (charcoal, aksen oranye, knob
  cincin, garis tipis), gambar buatan MobileDAW sendiri.
- **Satu baris tab, satu bagian sekali tampil**: TIMBRE · PITCH · FILTER · UNISON · MOD | ENV · HARM · IMG · FX · ADV. Bagian mengisi
  tinggi jendela, display (partial, respons filter, unison, envelope, harmonik, peta) mengambil sisa tinggi. Di HP landscape (tinggi
  layout 534 px) semua 10 bagian **muat tanpa scroll, tidak terpotong di bawah** (revisi atas laporan pemilik: versi pertama menumpuk
  halaman + editor setinggi ~980 px sehingga terpotong). Tab bergeser ke samping bila jendela sempit.
- **Kontrol sentuh**: knob geser naik/turun, ketuk 2× = default, tekan lama = automation; editor envelope multi-titik (ketuk = titik baru,
  geser titik/garis, ketuk 2× = hapus, cubit = zoom, Sustain/Loop/AHDSR); editor harmonik (gambar level/fase per partial, preset 1/k,
  Ganjil, Organ, Bel, Reset) → tabel timbre di slot bank sample (`harmorSetTable`, ikut tersimpan di proyek); peta gambar geser = pan,
  cubit = zoom; rak FX dengan LED, Mix, ▲▼ urutan, ketuk nama = knob device.
- **Data langsung dari engine**: `devOut(track, 998)` → `Instrument::readOut` (C++ dan JS): puncak L/R, jumlah voice, f0 dan level partial
  voice terbaru → meter + display PARTIAL.
- Jendela: saat layar berubah (rotasi, layar penuh) seluruh jendela ditarik kembali ke dalam layar, bukan hanya title bar.
- **Title bar semua jendela modul (FX + instrumen)**, didesain ulang atas tandaan pemilik: satu bar tipis datar (30 px); kiri = header
  device seperti di kartu (power bulat, nama tebal, Preset / Mix sebagai field bergaris tipis, ⇄ ⋯ ikon polos tanpa kotak); kanan = nama
  track, garis pemisah tipis, tombol jendela (gulung, kecilkan, perbesar, tutup) sebagai ikon polos 26 px tanpa kotak bersambung
  (sorotan bulat saat ditekan, merah untuk tutup). Kartu yang lebih sempit dari title bar-nya (mis. Limiter) membuka jendela selebar
  bar-nya, isinya ikut diskala (rasio tetap), sehingga nama/Mix/menu tidak terpotong; nama track disembunyikan di jendela < 380 px.
  Revisi pemilik: tombol jendela menjadi **lampu bulat berwarna ala MacBook** (gambar sendiri, CSS): merah = tutup, kuning = kecilkan,
  hijau = perbesar, abu-abu = gulung; simbol samar di layar sentuh dan jelas saat ditekan; jendela yang tidak aktif lampunya pudar.
  Sudut jendela membulat 10 px, field Preset / Mix 5 px.
  Revisi berikutnya (lampu terlalu tebal / makan tempat): lampu 12 px dengan jarak rapat 20 px, simbol hanya saat ditekan, lampu gulung
  dihapus (ketuk 2× title bar tetap menggulung), nama track tidak lagi di bar.
- **Level resintesis**: tahap output Harmor = 0,25 × Volume (ruang aman untuk akor), sehingga audio yang diresintesis terdengar ~15 dB
  lebih pelan dari filenya. Saat audio dimuat, Map Level kini diset 4× (bila belum pernah diubah): Volume 100 % = level file (partial 1
  0,300 dari 0,300; tes di `harmor-app-test`), Volume 70 % = −3 dB.
- **Resintesis harmonik + residu (revisi atas uji pemilik "belum sama")** — selalu dibandingkan dengan file asli:
  - Analisis (`js/harmor/resynth.js`): jendela Hann 5 periode nada frame itu sendiri (bukan 186 ms), hop 4 ms; harmonik hanya bila
    lobusnya 6 dB di atas lantai noise (median celah × 1,44); frekuensi dikunci ke k × f0 (±25 cent); pelacak YIN ambang 0,25 + celah
    ≤ 20 ms diisi (dulu harmonik menyala-mati tiap beberapa ms); koreksi amplop waktu per frame (energi sesaat 8 ms).
  - Residu (semua yang bukan harmonik: konsonan, napas, transien) disimpan dua cara: **gelombang** (slot W: spektrum kompleks dengan lobus
    harmonik diredam, WOLA) yang diputar engine pada garis waktu peta, dan **32 pita noise mid/side** (slot N) sebagai pengganti saat
    Map Speed ≠ 1. Engine (C++): noise per pita dengan sumber sendiri (sumber bersama saling meniadakan), gain diselesaikan dengan matriks
    kebocoran antar-pita (NNLS) saat dimuat. Parameter baru: Noise (level residu), slot N/W.
  - Untuk mengembalikan nada dari file datar: Formant **off** (kebalikan persis dari pendataran), mono + legato, not tersusun dari
    kontur asli per 5 ms (lari nada ≥ 15 ms ikut, salah oktaf di ekor pelan dibuang).
- **Uji pemilik (WAV 22 s, melodi 11 nada)** — hasil akhir dibanding file asli: track "Harmor Datar" (resintesis High, Freq Dev 0 %,
  satu not D4) → 99,9 % frame bernada di D4 (median 0,2 cent); track "Harmor Nada" (resintesis WAV datar + 71 not) → LSD 2,34 dB
  (awal 17,6), 1,16 dB di bagian keras (smoothed), korelasi amplop 1,000, nada sama 98,7 % (median 2,9 cent), level per pita
  0,0 / −0,1 / −0,0 / +0,1 dB, level total −31,6 dB (asli −31,4). Satu lintasan saja (identitas): LSD 1,52 dB. Batas: residu gelombang
  tidak bisa di-stretch (Map Speed ≠ 1 memakai pita noise); fase antar-harmonik hanya diambil di awal peta.
- Tes `tools/harmor-resynth-test.mjs` (alur pemilik pada sumber sintetis bernada + desis "s", dibanding sumber): identitas 0,28 dB,
  datar 100 % di nadanya, nada kembali 100 % sama / 0,27 dB / noise +0,00 dB, Map Speed 2× +0,04 dB.
- Perbaikan umum: parameter berkurva log yang bisa 0 (Map Speed, 0 = peta berhenti) memakai kurva kubik (sebelumnya knob NaN).
- Tes `tools/harmor-ui-test.mjs` (24 cek, masuk `run-tests`): Pixel 7 landscape + portrait — 10 bagian tampil, tidak meluber ke samping,
  muat tanpa scroll, display ≥ 40 px, tanpa error; knob geser 0,70 → 1,00 dan ketuk 2× kembali 0,70; devOut 998 saat akor: 2 voice,
  f0 329,6 Hz, 62 partial, meter + partial tergambar; MSEG ketuk menambah titik (AHDSR → 6 titik), geser menaikkan level, ketuk 2×
  menghapus; goresan harmonik → partial 1 −27,7 dB, preset Ganjil → partial 2 −6,0 → −112,5 dB, partial 3 −9,5 dB (1/3 tepat); simpan +
  buka ulang identik (≤ 0,03 dB); urutan FX Distortion, Chorus → Chorus, Distortion. Golden 134 skenario identik.

### Phase 6b (Harmor) — Map End, tata letak padat: selesai (tes lulus)

- **Map End (param 1066, 0..1, default 1)**: peta diputar dari Map Start sampai Map End. Loop off = setelah End, frame End ditahan
  (vokal bertahan seperti file yang dipotong, tanpa memotong file). Loop on = berulang Start..End. Berlaku untuk harmonik, pita noise,
  dan residu waveform (C++ `mapPos()`; WASM + native). Proyek lama: param tidak ada = 1 = perilaku lama.
  Tes: `harmor-resynth-test` (End di tengah not 1 + Loop off menahan nada 57 di not 2-4, level +0.1 dB; Loop on mengulang segmen 1).
- **Jendela**: bilah judul 22 px. Di layar kecil / pendek (lebar < 900 atau tinggi < 600 CSS px) jendela Harmor / Moisture memakai
  ~90-98 % layar, jadi kontrol tidak mengecil. Moisture di layar pendek memakai desain lebih pendek (skala ±0.80 bukan 0.64).
- **Harmor**: knob 44 px; tab PITCH punya grafik pitch-waktu (glide + vibrato), MOD menampilkan partial hasil modul, ADV menampilkan
  ADSR volume; panel IMG dua kolom; PHASER satu baris.
- **Moisture**: knob 38 px (makro 44 px, mengisi panel MACROS), SUB menampilkan bentuk gelombangnya, NOISE menampilkan jejak noise.
- **ACC IMUT KABODY** dari `imut.wav` mentah (tanpa trim): Map End 0.30 s, Map Noise imut 0.45, body 0.35. Dibanding referensi:
  LSD 4.89 dB (sebelumnya 5.75), envelope corr 0.989, 98.5 % frame nada sama, side/mid -13.8 dB (target -13.5).

### Phase 6c (Harmor + Moisture) — desain ulang dari referensi pemilik: selesai (tes lulus)

Acuan: screenshot dan manual dari pemilik (tata letak, kepadatan, alur kerja). Gambar, warna khas, dan aset produk komersial tidak disalin.
- **Harmor**: satu permukaan instrumen, kelompok dipisah garis tipis (bukan kotak seragam), judul dengan garis aksen; knob tiga
  ukuran (lg 44 / 38 / sm 30) dengan label dan nilai di bawah knob.
- **Harmor IMG**: peta (spektrogram) mengisi halaman, dengan arsir di luar Start..End, garis Start / End, dan penanda Loop; kolom samping
  sempit berisi Audio… / Gambar… / Hapus, Kualitas, info analisis, 8 knob kecil (Start End Speed Shift Mix Level Noise Freq Dev),
  Loop / Interp / Formant / Fase, dan opsi gambar (hanya saat peta dari gambar).
- **FX (Harmor dan Moisture)**: hanya efek yang aktif yang tampil sebagai modul; **+ Tambah FX** membuka menu efek yang belum dipakai;
  × mematikan efek. Harmor: ▲▼ mengubah urutan (parameter FX order). Moisture: urutan rantai tetap. Knob FX Moisture 48 px.
- **Moisture**: tinggi body sama di semua halaman (skala jendela tetap); MATRIX dua kolom (32 rute); GLOBAL mengisi halaman.
- Tes: `harmor-ui-test` (FX: kosong secara default, tambah Delay + Reverb, urutan, hapus), `moisture-ui-test` (baru).

### Phase 6d (Harmor + Moisture) — tata letak mengikuti referensi pemilik: selesai (tes lulus)

- **Harmor**: zona modul di atas (pemilih halaman vertikal Timbre / Pitch / Filter / Unison / Mod di kiri), editor di bawah (tab ENV
  HARM IMG FX ADV di header, judul editor miring di kiri), spektrum keluaran langsung di kolom kanan (partial voice terbaru, bergulir).
  Judul bagian miring title-case, knob bertutup logam dengan busur berwarna per keluarga (--kc), zona modul warna anggur gelap,
  editor abu-biru gelap. Portrait: tiga baris (modul / editor / spektrum).
- **Moisture**: panel dua warna (header gelap + tampilan gelap di atas, area kontrol abu terang dengan knob gelap dan label gelap).
- Tes `harmor-ui-test`: cek muat per zona (modul / editor), spektrum keluaran ikut tergambar saat chord dimainkan.

## 5. Referensi dari pemilik (untuk fase berikutnya)

### Tampilan Harmor (screenshot Harmor di Live 12) — acuan Phase 6, disederhanakan untuk HP, tidak ditiru
Yang diambil dari referensi: susunan **bagian atas = mesin suara** (Timbre A/B dengan dua thumbnail gelombang + MIX, Phase start/rand,
Blur, Tremolo, Prism, Harmonizer, Unison, Pitch/Vibrato/Legato, Filter 1/2 + Pluck + Phaser + EQ) dan **bagian bawah = editor besar**
dengan tab **ENV / IMG / FX / ADV**, pemilih target envelope (Volume, Pitch, Filter …) dan kurva envelope multi-titik yang memenuhi area,
plus panel Global (limit, legato, porta, strum, vol/pitch, pad XY "MOD").
Versi MobileDAW (gaya Live 12: charcoal/graphite, aksen oranye, knob bulat, label kecil, garis tipis):
- Bagian atas dipecah jadi **halaman** yang bisa digeser/dipilih (Timbre · Pitch · Filter · Unison · Prism/Blur/Pluck/Phaser), satu
  halaman sekali tampil di HP — bukan semua knob sekaligus.
- Bagian bawah tetap editor besar (ENV / IMG / FX / ADV); di portrait editor di atas, kontrol di bawah; di landscape berdampingan.
- Editor harmonik (level / fase) dan envelope: sentuh-geser untuk menggambar, cubit untuk zoom, dua jari untuk geser.
- Meter output + spectrum kecil di header plugin.

### deriz-synth.ts (sampler pitch/speed terpisah) — acuan teknik untuk rekonstruksi NewTone (Phase 5)
WSOLA 75 % overlap dengan penyelarasan **sub-sampel** (korelasi silang ternormalisasi, kasar → halus → pecahan), panjang frame
mengikuti nada, **penjaga transien** (onset tidak diulang/dilebarkan saat stretch, crossfade 2 ms), pitch naik dengan **sinc berjendela
(cutoff 0.85/rasio) sebelum decimate**, turun dengan Hermite 4 titik, soft-limiter di keluaran, dan tes bit-per-bit. Prinsip yang sama
dipakai untuk time-stretch NewTone (bersama PSOLA untuk vokal dan phase vocoder untuk bagian tak bernada), di Web Worker.

## Phase 6e: several vocals in one Harmor (one pattern)

A Harmor now holds up to 8 images ("Vokal 1..8"). Image 1 is the existing map (MAP_A / B / N / W, Map Start / End / Loop / Level /
Shift / Noise). Images 2..8 live at `HM_IMG + 10 (k - 1)` (1100..1169): slots A, B, N, W, then Start, End, Loop, Level (x the map's),
Shift (+ the map's, semitones), Noise (x the map's). Speed, Mix, Interp, Formant, Freq Dev, the envelope, voices and effects stay global.

- A note picks its vocal with `note.img` (0..7, absent = 0). The project sends it as the note event's 6th value for melodic tracks
  (the drum sampler uses the same slot for its step pitch); the engine passes it to `noteOnSt`, which only Harmor reads.
- An image without a map plays image 1. In mono + legato, a note on another vocal starts that vocal from its Start without a glide.
- `harmorLoadAudio(i, path, { quality, image })` loads audio into any image; the track remembers the others in `t.inst.hmI`
  (restored on open, included in the ZIP export).
- UI: IMG page has the Vokal 1..8 selector (a dot = loaded); the piano roll's lane chooser has "Vokal / citra (Harmor, per not)".
- Test: `tools/harmor-multi-test.mjs` (two vocals in one clip, fallback, save / open).
