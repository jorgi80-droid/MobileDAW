# Impor proyek FL Studio Mobile / FL Studio / Ableton ke MDAW

Menu: **Browser → Proyek → Impor proyek FL Studio Mobile / FL Studio / Ableton…** (atau menu ⋮ → Impor proyek FLM / FLP / Ableton).
Pilih `.flm`, `.flp`, `.als`, atau **ZIP** yang berisi file proyek itu beserta sample-nya (mis. ZIP ekspor FL Studio Mobile dengan folder
`My Samples` / `My Tracks`). Jendela progres tampil selama konversi; di akhir ada laporan. Hasilnya disimpan sebagai
`Projects/<nama>.mdaw`. Sample proyek **FL Studio Mobile** disimpan di **`FLM/<nama proyek>/<folder sample aslinya>`** (mis.
`FLM/Lagu Saya/My Samples/Drums/kick.wav`; folder pembungkus ZIP dibuang), sample FLP / ALS di `Samples/Imports/<nama>/`. Proyek `.mdaw`
merujuk ke path itu, jadi tetap terbuka offline. **Ekspor ZIP** (menu ⋮) membawa semua sample di dalam ZIP dengan path yang sama
(termasuk sample pad drum); saat ZIP itu dibuka lagi, path folder library (`FLM/...`, `Samples/sub/...`) dipertahankan.

## Alur (js/import/)
| Langkah | File | Progres |
|---|---|---|
| Buka ZIP, cari file proyek, petakan sample | `index.js` (`readZip` dari `zip.js`) | 0–15 % |
| Baca proyek | `flm.js` / `flp.js` / `als.js` → model netral | 15–30 % |
| Konversi ke JSON MDAW | `build.js` | 30–35 % |
| Sesuaikan modul ke stock plugin | `fxmap.js` | 30–35 % |
| Salin sample ke `FLM/<proyek>/…` (yang hilang: file hening pendek) | `index.js` | 36–70 % |
| Simpan + buka (decode sample, render klip stretch) | `P.deserialize(text, onProgress)` | 70–100 % |

Model netral: satuan ketuk (beat), gain linear (1 = level bawaan), pan −1..1; kanal `master` / `bus` / `track` dengan `modules`
(efek), `instrument`, `pads`, dan `tracks` (sub-track: `notes`, `drums`, `audio`, `automation`) berisi klip
(`pos`, `len`, `cycle` = panjang siklus pattern / loop, `offset`, not / sample / titik otomasi).

## Aturan "tidak ada yang hilang diam-diam"
- **Plugin tidak ada di MDAW** → device placeholder: Utility netral (audio diteruskan apa adanya) dengan `d.missing = { name, app, preset,
  params }`; kartunya bertuliskan **[Plugin tidak tersedia] <nama>**, nilai parameter asli disimpan, bisa diganti lewat ⋯ → Ganti dengan.
- **Sample audio tidak ada** → klip tetap di posisi / panjang / namanya ("⚠ <nama> (sample tidak ada)") dengan file hening pendek.
- **DirectWave FLM → DirectWave MDAW (mesin FLM, instrumen 30, lihat `docs/FLM-INSTRUMENTS.md`)**: setiap modul DirectWave di kanal
  (lapisan) menjadi satu zona dengan sample dan **root key** aslinya (rentang tuts penuh, jadi lapisan berbunyi bersamaan seperti di FLM).
  Flt Env, Frq Env dan LFO dikonversi dari nilai file; nilai tab Sample / Filter disimpan mentah di `inst.from` (urutannya belum diketahui).
- **Program library bawaan FLM** (mis. `DirectWave Samples/Keyboard/Grand Piano.dwp`, tidak ikut di ZIP) → **SoundFont General MIDI** bawaan
  MobileDAW (`SoundFonts/TimGM6mb.sf2`) dengan preset paling mirip dari namanya (Grand Piano → Acoustic Grand Piano); chip "pengganti …" di
  kartu instrumen. Suaranya mirip, bukan sample FLM yang sama. Tanpa padanan nama → DirectWave kosong, pattern utuh, chip "hilang".
- **GMS / MiniSynth / SuperSaw** → instrumen FLM MobileDAW yang sama (31 / 32 / 33, tab dan kontrol seperti FLM) dengan preset bernama sama bila ada;
  nilai parameter FLM asli disimpan di `inst.from`. Dikenali dari nama / path preset modul — type id synth ini belum terverifikasi dari file
  FLM asli (arsip pemilik tidak memakainya).
- **Sample pad drum tidak ada** → pad tetap (nama, step), dibisukan sampai diberi sample.
- **Otomasi** volume mixer → track otomasi MDAW; otomasi parameter plugin yang tidak tersedia dan otomasi master → dilaporkan.
- Laporan akhir: instrumen (asal → hasil), plugin tidak tersedia (dengan jumlah), sample hilang, yang tidak dikonversi, catatan.

## FL Studio Mobile (.flm) — dipetakan dari proyek asli (FLM 4.6)
Format tidak terdokumentasi; struktur di bawah dibaca dan diverifikasi pada proyek pemilik (28 kanal, 1041 klip, 33 sample unik).
- File = `10LF` + chunk (`tag` 4 huruf + `u32` ukuran + data). HEAD: nama, **tempo** (f64 di +0x108), versi aplikasi. TDIV: birama.
- RACK ×N dan CHNL ×N berurutan sama. CHNL: jenis (master / bus efek / track), CHHD (nama, kunci urutan, hue warna, nomor), TRKH per
  sub-track (DESc: 0 not, 1 otomasi, 2 audio, 3 drum; target otomasi + label seperti "Gain : FX Leveller").
- CLIP: posisi u32 (**128 tick per ketuk**) + CLHd (panjang, panjang siklus/loop, offset, panjang sumber dalam ketuk, flag mute) — sama
  dengan model pattern MDAW (`len`, `ll`, `lp`), jadi pengulangan pattern tidak menyalin not. EVN2: not 20 byte (waktu, durasi f64 ketuk,
  pitch, pan, velocity). CLSm: path sample (`@L@` = folder pengguna FLM), **rasio stretch** (STRC), gain / pan klip.
- RACK: RPRM (volume, pan), RMOd = modul berurutan sesuai rantai sinyal (tipe, id instance, preset, parameter dengan [0] = aktif;
  CSTM/ZONE = sample DirectWave, PATh `@R@` = library bawaan FLM), RSMP/SMPl = sample per pad drum.
- **Nama plugin**: hanya yang terbukti dari isi file — 1 DirectWave, 8 Compressor, 20 FX Leveller (label otomasi), 29 Autoduck,
  34 Spacer, 43 Wow & Flutter (folder preset) — plus nama yang dipelajari dari folder preset / label otomasi di file yang sedang diimpor.
  Tipe lain tampil sebagai **"Efek FLM #<id>"** (bukan tebakan). Tabel `KNOWN` di `flm.js` bisa dilengkapi begitu nama tipe lain
  diketahui (mis. dari screenshot rack FLM).
- Level FLM (slider 0..1, bawaan 0,853) dipetakan relatif ke level bawaan MDAW. Velocity not 0x7FFF → 0,8.
- **Klip yang tidak pernah di-resize** (duplikat / klip tertaut, chunk `LINk`) menyimpan panjang 0: panjangnya = panjang siklus (dulu
  terbaca hampir nol, contoh arsip pemilik: 74 klip "BASS LOUD FUNKYTONE" di Audio 7 hanya muncul sebagian). 82 klip di arsip pemilik.
- **Pitch klip audio**: stretch hidup → `STR1` (u8 on, f64 rasio waktu, f64 **semitone**), sama dengan `STRC` (f64 rasio pitch =
  2^(st/12), f32 knob = 0,5 + st/48); diterapkan sebagai warp pitch (waktu tetap). Stretch mati → knob pitch di `PRMS[2]` (0,5 + st/48)
  = resample (kecepatan ikut berubah) → warp mode `repitch`. Arsip pemilik: 377 klip dengan pitch + 48 klip repitch (96_Tom −4,16 st).
- **Pad drum**: pitch dengan cent (`PRMS[2]` = 0,5 + st/48, mis. kick +1,85 st) dan envelope A / D / S / R (`PRMS[6..9]`, kurva waktu
  kubik 1 ms–10 s, perkiraan — FLM tidak menampilkan angka).
- **Modul**: `SMPR` = pan, level / mix (1 = penuh). Pada efek yang dikonversi: Dry/Wet stock plugin, atau campuran dry + olahan untuk
  Utility / EQ Eight; pada lapisan DirectWave: level (dB) dan pan per zona.
- **Penomoran nada**: root zona DirectWave FLM tersimpan 12 di bawah MIDI (Banjo.wav ber-unity 60 di chunk `smpl` / `acid`, FLM
  menyimpan 48; nada dasarnya terukur C4 = 261 Hz). Root dan not pattern digeser +12 → nada relatif sampler tetap, nada absolut benar untuk
  synth / SoundFont. Kesimpulan dari satu sample; dikonfirmasi lebih lanjut bila ada proyek FLM dengan synth.
- Belum terbaca: urutan nilai tab Sample / Filter DirectWave di `PRMS[1..16]` (disimpan mentah; mis. lapisan Banjo berbeda di `PRMS[3]`
  0,236 vs 0,5 — kemungkinan Fine Tune −53 ct, belum terbukti), chunk `KEYB` (pengaturan akor keyboard FLM, JSON), `META` (tanggal).
  `SEND` dibaca: semua kanal arsip pemilik ke Master dengan level bawaan.

## Migrasi modul ke stock plugin MobileDAW (`js/import/fxmap.js`)
Sumber nama / parameter modul: panduan FX FL Studio Mobile dari pemilik (30 modul) + data di proyek asli.
- **Saat impor** (langkah "Menyesuaikan dan memproses parameter modul ke plugin bawaan…", 30–35 %), hanya konversi yang menjaga suara:
  - Graphic EQ (8-band, 80 Hz – 12 kHz) → **EQ Eight**: 8 band bell, gain dari slider (0,5 = 0 dB, rentang ±12 dB diasumsikan) —
    datar = persis (null test < −90 dB), diatur = perkiraan (tes: +6 dB slider → +6,0 dB di 160 Hz).
  - Leveller → **Utility** gain / pan (0,7071 = 0 dB; null test persis di 0 dB).
  - Spacer pada setelan netral → Utility netral (persis); setelan lain tidak ditebak.
  - Modul yang **off** di proyek asli → stock plugin padanannya **dalam keadaan bypass** (suara identik).
  - Analyzer / Tuner → Spectrum / Tuner (tidak mengubah audio).
- **"Ganti seluruh modul hilang dengan stock plugin"** (tombol di laporan impor, menu ⋮): modul sisa yang punya padanan (Compressor,
  Autoduck, Multiband Compressor, Tape Delay, Stereoizer, Waveshaper, …) menjadi stock plugin **bypass** — suara tetap seperti sebelumnya,
  tinggal dinyalakan dan diatur; nilai asli tersimpan di `d.from`. Satu langkah Undo. Ada jendela progres dan laporan jumlah.
- **Tidak diterapkan** (dilaporkan): modul tanpa padanan di MobileDAW (Pitcher 2, Tape Stop, Multi FX, Comb Filter) dan tipe yang belum dikenali (`Efek FLM #id`).
- Identitas tipe: pasti = 1 DirectWave, 7 Graphic EQ, 8 Compressor, 20 Leveller, 29 Autoduck, 34 Spacer, 36 Multiband Compressor,
  43 Wow & Flutter; diduga dari tata letak (tidak pernah diaktifkan otomatis) = 11 Tape Delay, 25 Waveshaper, 44 Stereoizer;
  belum dikenali = 4, 9, 16, 30, 35, 45.
- Arsip pemilik: Banjo → DirectWave 2 zona (root C3), DW Sampler 9 ("Keyboard/Grand Piano") → SoundFont GM Acoustic Grand Piano;
  impor = 30 dari 69 modul efek diterapkan (3 persis, 25 perkiraan, 2 off); "ganti seluruh" = 50 dari 69 (20 bypass untuk
  diatur); 19 tetap placeholder (lapisan DirectWave kedua kini menjadi zona, bukan modul).
- Batas yang jujur: kesamaan suara dengan FL Studio Mobile hanya bisa dibuktikan untuk konversi "persis" / bypass. Untuk Graphic EQ yang
  diatur dan Leveller, skala nilai FLM diasumsikan; kalibrasi pasti butuh render referensi dari FLM (ekspor stem per track).

## Ableton Live (.als)
gzip + XML (Live 9–12: MasterTrack / MainTrack). Dibaca: tempo, birama, MidiTrack / AudioTrack / ReturnTrack, volume / pan / mute, klip
arrangement (posisi, panjang, loop, not + velocity), klip audio (path sample, warp marker → rasio stretch, offset), device bawaan (nama
Live 12) dan plugin VST / VST3 / AU (nama). Simpler / Sampler → DirectWave dengan sample-nya; Drum Rack → track drum (pad per branch).
Group track dilewati (track di dalamnya tetap). Sample dicocokkan dengan path lalu nama file di dalam ZIP.

## FL Studio (.flp) — eksperimental
Format event (`FLhd` / `FLdt`). Dibaca: tempo, birama, judul, channel (nama, plugin, sample), pattern (not), playlist (pattern dan klip
audio), nama efek slot mixer (insert 0 → Master, insert lain → track Return). Routing channel → insert belum. Dites dengan file buatan
sesuai dokumentasi komunitas (PyFLP); belum dengan file .flp asli.

## Tes
- `node tools/import-test.mjs` (masuk `run-tests`): FLM / ALS / FLP buatan + alur impor ZIP lengkap. `FLM_ZIP=/path.zip` = juga arsip asli.
- `IMPORT_FILE=/path.zip node tools/import-ui-test.mjs` (Chromium Pixel 7): impor lewat UI, progres, laporan, decode semua sample, render
  klip stretch, kartu placeholder, proyek bisa diputar. Arsip pemilik: 26 track, 1032 klip, 620 not, 42/42 sample, 619 klip stretch, ±31 dtk.
