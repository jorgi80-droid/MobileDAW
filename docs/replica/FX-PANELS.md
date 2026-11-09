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

## Putaran 3: bayangan, cahaya, animasi; Compressor
- Kedalaman: kartu efek punya bayangan lembut dan cahaya tipis di atas; display "tenggelam" (bayangan dalam + kilau di bagian atas).
- Cahaya: kurva (`lvPath`) dan ring (`lvRing`) bercahaya dalam warnanya sendiri, area di bawah kurva memudar ke bawah; tombol aktif bersinar oranye;
  busur nilai knob bercahaya; batang meter Drum Buss / Compressor punya glow + garis sorot.
- Animasi fluid: meter dan analyser bergerak tiap frame (60 fps, naik cepat / turun pelan, `glide` di fxkit.js) alih-alih melompat tiap 50 ms;
  tombol, kotak nilai dan knob merespons sentuhan dengan pegas singkat. Semua gerakan mati bila "Kurangi animasi" / prefers-reduced-motion.
- Compressor (Live): display tinggi berisi pasangan meter In (panah = Threshold), kurva transfer di grid 6 dB, batang GR, pasangan meter Out
  (panah = Output, seret di sisi kanan display), strip dengan tiga tombol tampilan (ringkas / kurva / aktivitas: riwayat level + GR), Knee, Look, Env;
  Makeup + Peak/RMS/Expand + Dry/Wet di kanan. Skor layout 40,7 -> 52,7.
- GIF panel yang berjalan: `FRAMES=28 PLAY=1 CARD=1 FX=0,4,25,29 node tools/ui-shots.mjs <dir> devs` lalu gabungkan frame-nya.

## Putaran 4: referensi FL Studio Mobile (Pictures.zip, 28 gambar)
- Isi: screenshot modul efek FL Studio Mobile (Tape Stop, Spacer, Spreader, Autoduck, Reverb, Limiter, Trance Delay, Wow & Flutter, Tremolo, Gate,
  Graphic EQ, Tuned EQ, Waveshaper, Pitcher 2, Equalizer, Multiband Compressor, Analyzer, Filter). Screenshots 1-4 dan Ui_Refrences pada kiriman
  ini identik byte-per-byte dengan kiriman sebelumnya (sudah dipakai).
- Tape Stop (modul asal FLM) kini mengikuti tata letak FLM: reel besar Start Time (kiri) dan Stop Time (kanan) berisi nilainya (ketukan saat Sync,
  detik saat tidak; seret reel naik / turun), reel berputar mengikuti kecepatan pita; di tengah Sync, tombol Play bulat, Warp. Warna tetap Live.
- Perbedaan yang ketahuan dari gambar (belum diubah, butuh DSP baru, bukan sekadar tampilan):
  - Autoduck FLM = ducking berirama (S-Curve, Attack, Hold, Ducking, Curve, Time, Shift), bukan kompresor sidechain seperti Autoduck MobileDAW.
  - Spacer FLM = alat stereo (L/R Inversion, L/R Delay, Separation, Pan, M/S Inversion, M/S Delay, Mode), bukan ruang / pantulan seperti Spacer MobileDAW.
  - Reverb FLM punya tab Main / Tune / Mixer (Decay, High Damp, Mix, Early Refl., Room Size; Wet / Dry Level, Rev Pan).
- Nomor tipe FLM yang belum dikenal (3, 9, 13, 27, 28, 30, 41, 44) TIDAK dipetakan dari gambar ini: jumlah parameter kadang cocok (tipe 3 = 21
  parameter seperti Equalizer 4 band) tetapi nilai bawaannya tidak cocok, jadi masih tebakan.

## Putaran simetri + replika (instrumen dan efek), layar 2374x1080

Alat: `tools/ui-audit.mjs` (sekarang mengukur juga margin kiri/kanan/atas/bawah isi kartu: kolom `ASYM`; kartu dengan selisih
kiri-kanan > 10 px atau atas-bawah > 14 px ditandai), `tools/ui-crop.py` (memotong tiap kartu dari screenshot audit) dan perbandingan
berdampingan dengan gambar Live pengguna (`Ui_Refrences`, `Pictures.zip`, `uiref`).

- Hasil audit: dari 10 kartu tidak simetris tinggal 2 (MiniMeters: ukuran bebas; Osphere: grid 4 kolom, bagian terakhir 3 knob).
- Tata letak umum: kolom dalam satu baris panel memakai `space-between` (elemen pertama dan terakhir tiap kolom sejajar di garis
  atas/bawah yang sama; kolom berisi satu elemen di tengah). Bagian yang terlalu tinggi dilipat jadi 2 kolom dengan baris sama tinggi
  (Operator), baru kemudian jadi tab.
- Dibuat ulang mengikuti Live: SoundFont (daftar preset di kotak gelap), Limiter (satu baris tiga knob), EQ Three (grid 3x2),
  Tension (tiga pita: Exciter / String / Termination-Pickup-Global), Granulator III (info sampel di dalam display, menu mode + ikon
  di kiri baris knob), Echo (tunnel dan filter lebih besar, busur lebih tebal), Simpler (display tidak lagi keluar kotak).
- Belum bisa ditiru karena engine tidak punya fungsinya: Mode / Edit A-B / Adaptive Q (EQ Eight), Sidechain (Glue), Resonator 2
  (Collision), Refresh (Spectrum), meter Out (Filter Delay), baris Velocity/Random di tiap kolom Impulse selain Volume.

## Skala Live (Jan 2026 putaran 2): teks, knob, tombol, display

Penyebab "masih tidak sama" yang ditemukan lewat perbandingan berdampingan pada tinggi kartu yang sama: teks, knob dan tombol Live
kira-kira 1,4x lebih besar terhadap kartunya, display lebih kecil, busur knob lebih tebal. Tata letak kita sudah mirip, ukurannya tidak.
- Efek dan instrumen kompak: teks 12 px (token `--fs-*` naik), knob 38 px (besar 54), busur 4,4, tombol 24 px; display besar 0,9x,
  display kecil (< 26000 px persegi) 1,3x, display utama (Spectrum, Tuner, Collision) 1x (`lk-hero`), Filter Delay 1x.
- Sintesis padat (Drift, Operator, Poli, Analog, Meld, Wavetable, Sampler, Simpler, DirectWave / GMS / MiniSynth / SuperSaw) tetap
  di ukuran lama (`lk-dense`) supaya tetap satu panel seperti di Live.
- Tab otomatis hanya jika panel > 12% terlalu tinggi; grid Filter Delay tidak pernah dibongkar. Panel yang sedikit kelebihan tinggi
  mengecil 0,89-0,98 (Echo 0,90 dengan tab bawaannya).
- Warna: gambar Live berbadan abu sedang-terang (RGB ~135-165) dengan teks hitam; tema `Mid Light` paling dekat, tema bawaan
  `Dark` jauh berbeda. `THEME=midlight node tools/ui-audit.mjs ...` mengaudit tema lain.

## Detail kartu Live (putaran 3)

Dari pembesaran judul dan sudut kartu Live (kiri) vs kita: kartu bersudut membulat (8 px) dengan border tipis; bar judul rata dengan
badan (tanpa bar gelap dan garis pemisah); tombol power lingkaran 17 px dengan cincin; tombol fold ▾ bulat di sebelah power (di Live
posisinya di kiri); tombol header kanan (jendela mengambang, menu, Mix) bulat bercincin; kotak display gelap membulat (8 px) dan
display 6 px; tombol persegi berborder tegas dengan teks reguler (bukan tebal). Urutan elemen header diatur dengan CSS `order`
(power 0, fold 1, nama 2, Mix 4, jendela 5, menu 6, Preset 7).
