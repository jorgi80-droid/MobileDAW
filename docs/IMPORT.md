# Impor proyek FL Studio Mobile / FL Studio / Ableton ke MDAW

Menu: **Browser → Proyek → Impor proyek FL Studio Mobile / FL Studio / Ableton…** (atau menu ⋮ → Impor proyek FLM / FLP / Ableton).
Pilih `.flm`, `.flp`, `.als`, atau **ZIP** yang berisi file proyek itu beserta sample-nya (mis. ZIP ekspor FL Studio Mobile dengan folder
`My Samples` / `My Tracks`). Jendela progres tampil selama konversi; di akhir ada laporan. Hasilnya disimpan sebagai
`Projects/<nama>.mdaw`, sample disalin ke `Samples/Imports/<nama>/` (offline setelahnya).

## Alur (js/import/)
| Langkah | File | Progres |
|---|---|---|
| Buka ZIP, cari file proyek, petakan sample | `index.js` (`readZip` dari `zip.js`) | 0–15 % |
| Baca proyek | `flm.js` / `flp.js` / `als.js` → model netral | 15–30 % |
| Konversi ke JSON MDAW | `build.js` | 30–35 % |
| Salin sample (yang hilang: file hening pendek) | `index.js` | 35–70 % |
| Simpan + buka (decode sample, render klip stretch) | `P.deserialize(text, onProgress)` | 70–100 % |

Model netral: satuan ketuk (beat), gain linear (1 = level bawaan), pan −1..1; kanal `master` / `bus` / `track` dengan `modules`
(efek), `instrument`, `pads`, dan `tracks` (sub-track: `notes`, `drums`, `audio`, `automation`) berisi klip
(`pos`, `len`, `cycle` = panjang siklus pattern / loop, `offset`, not / sample / titik otomasi).

## Aturan "tidak ada yang hilang diam-diam"
- **Plugin tidak ada di MDAW** → device placeholder: Utility netral (audio diteruskan apa adanya) dengan `d.missing = { name, app, preset,
  params }`; kartunya bertuliskan **[Plugin tidak tersedia] <nama>**, nilai parameter asli disimpan, bisa diganti lewat ⋯ → Ganti dengan.
- **Sample audio tidak ada** → klip tetap di posisi / panjang / namanya ("⚠ <nama> (sample tidak ada)") dengan file hening pendek.
- **Sample / program DirectWave tidak ada** → track synth DirectWave tetap dengan pattern (not) utuh; chip di kartu instrumen menyebut
  program / sample yang hilang (mis. library bawaan FLM "Grand Piano").
- **Sample pad drum tidak ada** → pad tetap (nama, step), dibisukan sampai diberi sample.
- **Otomasi** volume mixer → track otomasi MDAW; otomasi parameter plugin yang tidak tersedia dan otomasi master → dilaporkan.
- Laporan akhir: plugin tidak tersedia (dengan jumlah), sample hilang, yang tidak dikonversi, catatan (mis. lapisan DirectWave).

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
