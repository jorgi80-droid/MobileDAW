# Arti angka parameter FLM: bukti dari screenshot pemilik

Sumber: 26 screenshot FL Studio Mobile dari pemilik (proyek "New Song 1", app 4.10.19) yang menampilkan panel tiap instrumen dan rack efek, dibandingkan
dengan nilai mentah PRMS di file yang sama (`docs/replica/FLM-DEFAULTS.md`). Hanya kontrol yang menampilkan ANGKA atau NAMA di layar yang dipakai;
slider tanpa angka (waktu envelope, dll.) tidak dipetakan karena kurvanya tidak terlihat.

## Identitas modul (rack "Simple Saw", urutan terlihat di layar)
| Slot | Tipe | Nama di layar | Status |
|---|---|---|---|
| 2 | 32 | Reverb | sudah dikenal |
| 3 | 35 | Reverb 2 | sudah dikenal |
| 4 | 18 | Tape Delay | **baru** (tebakan lama "11 = Tape Delay" dicabut) |
| 5 | 16 | Trance Delay | **baru** |
| 6 | 29 | Autoduck | cocok dengan yang dikenal |
| 7 | 8 | Compressor | cocok |
| 8 | 6 | Distortion | cocok |
Slot berikutnya tidak terlihat di screenshot (tipe 27, 28, 41, 3, 9, 44, 30, 13 masih tanpa nama).

## Reverb (tipe 32), preset Default
Layar MAIN: Decay 35, High Damp 75, Mix 36, Early Refl. 22, Room Size 95. File: p1 0,359 / p2 0,7554 / p3 0,3639 / p5 0,2229 / p7 0,9531
-> p1 Decay, p2 High Damp, p3 Mix, p5 Early Refl., p7 Room Size, masing-masing nilai x 100 (dibulatkan ke bawah di layar).

## MiniSynth (tipe 0), preset "Cubed" + default "New Song"
| Mentah | Kontrol di layar | Cubed (layar / file) | Default file |
|---|---|---|---|
| p6 | Oscillator Kind (x 9) | Saw + Square / 0,3333 | 0 = Saw |
| p7 | Modifier (x 100) | 50 / 0,5047 | 0 |
| p8 | Noise (x 100) | 14 / 0,1481 | 0 |
| p9 | Cutoff (x 100) | 64 / 0,6494 | 1 |
| p10 | Kbd Trk | slider ~ tengah / 0,4974 | 0 |
| p11 | Res (x 100) | 49 / 0,4969 | 0 |
| p12 | Vel Trk | 0 / 0 | 0 |
| p13..p16 | Flt EG A / D / S / R | slider / 0,22 0,32 0 1 | 0 1 1 1 |
| p17 | Flt EG Amount (bipolar) | 30,7 / 0,6537 | 0,5 = 0 |
| p22..p25 | Amp A / D / S / R | slider / 0,06 0,19 0,56 0,55 | 0 1 1 0,07 |
Importer: preset MiniSynth yang tidak ada di MobileDAW kini memakai p6..p12 dan p17 dari file (`build.js RAW`); envelope tetap setelan awal.

## DirectWave (tipe 1), program "Brazil Piano"
Layar FILTER: Cutoff 91, Resonance 3, Kbd Trk 3, Vel Trk 1, Filter Off. File: p12 0,912 / p13 0,0315 / p14 0,0344 / p15 0,0173 / p16 0. SAMPLE: Pitch 0,
Fine 0, PB Range 2 (p3 0,5056 / p4 0,4963). Ini **mengonfirmasi** pemetaan DirectWave yang sudah ada (`dwParamsFromFlm`).

## Belum terbukti
- GMS "Simple Saw" (Osc A Saw, Osc B Saw Retro, Fine B 8,7, LFO Amount 12, Transp 12 ...) dan SuperSaw "Lead Super" (Output Level 70, Unison 12 Voices,
  Poly 5 Voices, Arp Range 3 Oct, Delay Mix 100 ...): beberapa nilai cocok dengan lebih dari satu indeks mentah, jadi belum dipetakan. Satu screenshot
  tambahan dengan SATU knop diubah per instrumen cukup untuk memastikannya.
