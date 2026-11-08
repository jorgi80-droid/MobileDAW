# Replika panel FX ke gaya Ableton Live 12

Modul yang sebelumnya masih memakai tata letak knob otomatis (kolom knob bertumpuk, Play / Sync Tape Stop berupa knob) kini punya panel
Live 12 di `js/fxkit.js` (`V[9]`, `V[10]`, `V[14]`, `V[15]`, `V[52]`, `kit: true` di defs.js). Bahasa visualnya sama dengan panel Live lain:
bagian berjudul berdampingan, display gelap dengan kurva cyan dan ring oranye yang bisa diseret, tombol oranye, kotak nilai cyan.

| Modul | Acuan | Isi panel |
|---|---|---|
| Roar (Live 12) | tata letak Roar Live 12 (tidak ada gambar Roar di referensi pemilik; dari pengetahuan umum tentang perangkatnya) | Input (Drive, Tone) / display shaper (seret: x = Bias, y = Amount) + pilihan Shape / Feedback (Amount, Time, Freq) / Output (Compress, Output, Dry/Wet) |
| Autoduck (FLM) | Glue Compressor Live (referensi pemilik `c087`) | Sidechain (tombol Sidechain = ada sumber, Audio From) / Attack, Release / meter GR berjarum 0..24 dB (busur oranye = Amount) dengan Threshold + Amount di bawahnya |
| Stereolizer (FLM) | Utility Live | goniometer + korelasi / Width, Balance / Mid, Side / Bass Mono / Gain |
| Spacer (FLM) | Reverb Live (panel Reverb MobileDAW) | Input Processing (Lo Cut, Predelay) / display pantulan awal L-R (seret = Size) + Size, Spread, Damping / Dry/Wet |
| Tape Stop (FLM) | gaya Echo / Live | Play, Sync / kurva kecepatan Stop - Start (Warp membengkokkan, ring = kecepatan saat ini) + panjang Stop / Start (ketukan saat Sync, detik saat tidak) / Warp |

## Pengukuran dengan alat replika (`tools/imgdiff.py`, mode layout)

Kartu dipotong ke judul + isi (`rep2/crop.py` di scratchpad), dibandingkan dengan crop referensi pemilik. Yang dibandingkan adalah modul yang
BERBEDA (Live tidak punya Autoduck / Spacer / Tape Stop), jadi angka ini hanya ukuran kasar kemiripan struktur, bukan kemiripan piksel.

| Pasangan | Sebelum | Sesudah |
|---|---|---|
| Autoduck vs Glue Compressor | 26,7 | 43,1 (iterasi 1), 37,7 (iterasi 2: kolom sidechain dirapatkan; lebih mirip secara visual, skor turun karena lebar kartu berubah) |
| Spacer vs Hybrid Reverb | 38,1 | 36,5 |
| Tape Stop vs Echo | 31,8 | 27,9 |

Roar dan Stereolizer tidak punya referensi gambar yang cocok, jadi tidak diberi skor.

## Tes
- `tools/fxkit-cover-test.mjs` (Playwright): kelima kartu adalah panel Live dan setiap parameter punya kontrol (Tape Stop diperiksa dengan Sync nyala dan mati).
- Screenshot: `CARD=1 FX=7,9,10,14,15,52 node tools/ui-shots.mjs <dir> devs` (modul pertama di daftar kadang tertangkap sebelum tab Device terbuka).

## Putaran 2: referensi pemilik (`Ui_Refrences.zip`, 61 gambar)

30 gambar panel perangkat Live dipetakan ke modul MobileDAW. Kartu MobileDAW difoto di ukuran panel normal, lagu demo berputar
(`PLAY=1 CARD=1 FX=0,<tipe> node tools/ui-shots.mjs <dir> devs`; tipe pertama dalam daftar terfoto sebelum tab Device terbuka, jadi 0 dipakai
sebagai pembuka), dipotong ke judul + isi, lalu dibandingkan dengan `tools/imgdiff.py` mode layout. Skrip: `tools/replica-fx-score.sh`
(memakai folder scratchpad sesi; sesuaikan path).

- Rata-rata awal yang adil (ukuran normal, audio berjalan): 41,4. Sesudah putaran ini: 44,3 (derau pengukuran sekitar +-5: Beat Repeat
  turun 54,3 -> 48,2 tanpa perubahan kode, karena isi audio / waktu foto berbeda).
- Erosion 23,9 -> 34,3 (acuan diganti ke Erosion Legacy, karena parameternya persis itu; tata letak vertikal seperti Legacy).
- EQ Three 24,6 -> 36,2 (lampu oranye per band, pasangan 24 / 48 kecil).
- Drum Buss 29,1 -> 42..45 (meter berbingkai Bass + Out L/R dengan garis puncak, panah Output di meter, Boom % dan dB di bawah meter,
  strip Dry / Wet, Decay sebagai kotak nilai, pil nada "G0" = Force To Note, headphone = Boom Audition (parameter baru 12, JS + C++, golden)).
- Channel EQ: analyser abu-abu dari spektrum asli (readOut baru ChannelEq di JS dan C++, hanya untuk tampilan), kurva garis tanpa isi, skala dB /
  Hz, strip bawah dengan ikon HP dan frekuensi oranye. Skor layout tidak naik (23..28) karena kurva referensi memakai nilai Low -12 / Mid +10 /
  High -0,5 sedangkan foto kita di nilai bawaan 0 dB: untuk display yang bergantung nilai, skor layout tidak bisa dijadikan patokan.
- Semua knob bipolar di panel Live kini punya segitiga kecil di atasnya seperti Live.

Yang belum sama dan alasannya:
- Kotak Trim Drum Buss: di Live terisi cyan pada -12 dB; rentang Trim di MobileDAW -12..0 dB sehingga -12 = kosong. Rentang Live belum diketahui
  pasti, jadi tidak ditebak.
- Meter Bass Drum Buss hanya bergerak bila Boom > 0 (mengukur sinyal Boom); di referensi meter itu penuh.
- Proporsi: knob dan teks Live lebih besar relatif terhadap tinggi panel; panel MobileDAW di-zoom agar muat tinggi Device panel.
- Warna: referensi kebanyakan tema abu-abu Live; tema MobileDAW "Mid Light" adalah padanannya (lihat perbandingan di sesi).
