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
