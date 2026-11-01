# Peta gestur sentuh MobileDAW

Satu pengenal gestur (`js/gesture.js`) dipakai Arrangement, piano roll, step sequencer, editor otomasi, audio editor dan area uji
di Pengaturan. Waktu dan jarak diambil dari **Pengaturan -> Sentuhan** di awal setiap gestur:

| Pengaturan | Pilihan | Bawaan | Pref |
|---|---|---|---|
| Tekan lama setelah | 0,30 / 0,43 / 0,60 dtk | 0,43 dtk | `longMs` |
| Toleransi gerak sebelum dianggap seret (jari) | Ketat 5 / Normal 8 / Longgar 12 px (mouse selalu 4 px) | 8 px | `touchSlop` |
| Jeda ketuk-ganda | 250 / 320 / 420 ms | 320 ms | `dtapMs` |
| Getar saat gestur dikenali | ya / tidak | ya | `haptics` |
| Ketuk klip langsung membuka kontrol klip | ya / tidak (Live: ketuk pertama hanya memilih) | ya | `tapClipMenu` |
| Seret satu jari di latar piano roll / otomasi | Pilih not/titik (FL Studio Mobile) / Geser tampilan | Pilih | `rollDrag` |

Tombol lain yang punya tekan-lama sendiri (Snap editor, metronom, knob, fader mixer, header device) memakai ambang yang sama.
Di bawah pengaturan ada **area uji gestur** (ketuk, ketuk-ganda, tekan lama, seret, pinch, geser dua jari) untuk mencoba di HP.

## Aturan pengenal (berlaku di semua layar)
- **Tap / ketuk-ganda / tekan lama / seret** dibedakan dari waktu dan jarak: jari yang bergeser melewati toleransi sebelum ambang tekan-lama
  = seret/gulir; setelah tekan-lama dikenali, gerakan berikutnya tidak pernah berubah jadi tap atau seret yang tidak diminta
  (kecuali editor memang meminta "tekan lama lalu seret", mis. kotak seleksi).
- **Ketuk-ganda tidak dibaca sebagai dua ketukan**: target yang punya aksi ketuk-ganda bisa menunda ketukan tunggalnya (`defer`) sampai
  jeda ketuk-ganda lewat; bila ketukan kedua datang, hanya aksi ketuk-ganda yang jalan. Di Arrangement ketukan klip memilih seketika dan
  hanya *menu*-nya yang ditunda (umpan balik pilih tetap instan).
- **Pinch** = zoom berpusat di titik tengah dua jari (sumbu dipisah menurut arah jari); **geser dua jari** = menggulir tanpa memindah
  klip/not. Lewat batas zoom sedikit lalu memantul kembali.
- **Batal**: `Escape` (keyboard), jari kedua, atau sistem mengambil pointer -> `dragEnd(..., batal)`; klip / not / titik / step kembali
  ke posisi awal dan **tidak ada langkah undo yang tertinggal** (`revertLast()` di `js/history.js`).
- **Getar** singkat saat tekan-lama dikenali dan saat masuk mode seret khusus (bila perangkat dan pengaturan mengizinkan).
- Aksi destruktif (hapus track, hapus pad, hapus FX track) selalu lewat dialog konfirmasi dan bisa di-Urungkan.

## Arrangement / Playlist (`js/timeline.js`)
| Gestur | Di mana | Aksi |
|---|---|---|
| Ketuk | klip | pilih seketika + **Kontrol Klip** setelah jeda ketuk-ganda (Edit, Cut, Copy, Duplicate, Delete, Rename, Split, Snap Edges, Combine with Next Clip, Activate/Deactivate, Unlink Loop, Stretch Mode). Menu ini **tidak modal**: sentuhan di luar menutupnya dan langsung diteruskan (bisa langsung menyeret klip lain). |
| Ketuk | `⋯` di klip terpilih | Kontrol Klip seketika |
| Ketuk-ganda | klip | editor sesuai jenis klip (piano roll / step / audio / otomasi), layar penuh |
| Ketuk-ganda | ruang kosong | klip baru 1 bar di bar itu (track audio: pemilih sample) |
| Tekan lama | klip | tambah/lepas dari pilihan banyak klip (bar `n klip ⋯`) |
| Tekan lama (tanpa geser) | ruang kosong | menu: Klip baru / **Paste** / marker / Pilih semua |
| Tekan lama + seret | ruang kosong | kotak seleksi klip |
| Tekan lama | header track | menu track (Output, Arm, Monitor, Lane otomasi, Freeze, Ganti nama, Warna, Lipat, Pindah atas/bawah, **Hapus track… (konfirmasi)**) |
| Seret | badan klip | pindah waktu / track (snap); **bayangan putus-putus di posisi asal + gelembung posisi bar.beat.16** |
| Seret | tepi kanan / kiri klip | ubah panjang / trim kiri (pattern berulang dari sumber, tidak menyalin not); gelembung panjang |
| Seret | tepi kanan klip audio dengan Stretch Mode | time-stretch (pitch tetap), gelembung panjang + rasio |
| Seret | pegangan fade (klip audio terpilih) | panjang fade in / out |
| Ketuk | saklar **Snap** (kanan atas) | Snap mati / kembali ke grid terakhir |
| Tekan lama | saklar Snap | pilihan grid + opsi lain |
| Ketuk | badge Grid / Zoom (bawah) | pilihan grid / zoom (Fit proyek, Fit klip, **Fit seleksi waktu**, reset, in/out) |
| Seret horizontal | beat ruler | seleksi waktu -> menu Deselect / Insert space / Duplicate / Delete / Delete space / Trim |
| Seret vertikal | beat ruler | zoom (gaya Live) |
| Seret | pita loop / ujungnya | geser / ubah loop; ketuk = loop on/off |
| Seret | slider vol / pan / send di header | nilai (dengan titik tangkap 0 dB / tengah) |
| Seret | tepi bawah header | tinggi baris; ketuk-ganda = tinggi normal |
| 1 jari di area kosong | | gulir (dengan fling) |

## Piano roll (`js/editor.js`)
| Gestur | Di mana | Aksi |
|---|---|---|
| Ketuk | grid kosong | not baru (panjang terakhir, kunci skala bila aktif) |
| Ketuk | not | pilih + bar Copy / Del / Snap / More… (Legato, Snap ke skala, Tebak skala, Humanize, Double up/down, Panjang not, Transpose, ±1) |
| Tekan lama | not | menu Hapus / Copy (tidak pernah langsung menghapus) |
| Seret | not / ujung kanan not | pindah waktu & pitch (pilihan ikut, jarak relatif terjaga) / ubah durasi |
| **Seret 1 jari** | latar kosong | **kotak seleksi** (FL Studio Mobile; bisa diganti ke "Geser tampilan" di Pengaturan) |
| Tekan lama + seret | latar kosong | kotak seleksi (selalu) |
| Tekan lama (tanpa geser) | latar kosong | Paste di sini / Pilih semua |
| Seret | ruler atas | seleksi waktu -> Select / Insert space / Duplicate / Delete space / More (Trim, Tebak skala, Snap ke skala) |
| Seret | lane velocity/pan/CC | lukis nilai |
| Seret | tuts kiri | pratinjau (glissando) |
| 2 jari | | geser + pinch zoom (waktu dan tinggi tuts) |
| Ketuk / tekan lama | tombol Snap | Snap on/off / pilihan Steps, Beats, Bar (1/6..1 step, 1/6..1 beat, bar) |

## Step sequencer / drum
| Gestur | Di mana | Aksi |
|---|---|---|
| Ketuk | sel step | on / off |
| Tekan lama lalu geser | sel step | lukis / hapus sepanjang baris |
| Seret vertikal | step yang menyala | velocity step |
| Ketuk | nama pad (kiri) | panel pad (Mixer / Sample / Envelope) |
| Tekan lama | nama pad | **Load Sample…, Clone, Set MIDI Key… (ketik nada / angka atau tekan tuts controller), Hapus pad… (konfirmasi)**, Isi tiap 1 / 2 / 4 step, Kosongkan, Pengaturan pad |
| Seret | lane velocity bawah | velocity pad terpilih |
| 2 jari | | geser + pinch (lebar step / tinggi baris) |

## Editor otomasi
| Gestur | Di mana | Aksi |
|---|---|---|
| Ketuk | kosong | titik baru |
| Ketuk | titik | pilih (ketuk titik dalam grup terpilih = bar grup) |
| Seret | titik | pindah waktu / nilai; titik dalam grup terpilih = **seluruh grup bergerak** (bentuk dan jarak terjaga) |
| **Seret 1 jari / tekan lama + seret** | kosong | **kotak seleksi titik** -> bar Copy / Hapus / Paste / Batal pilih |
| Tekan lama (tanpa geser) | kosong | Paste di sini / Pilih semua titik |
| Tekan lama | titik | bentuk kurva (berlaku untuk grup), Copy titik, Hapus titik |
| Paste | | kurva tempelan menggantikan titik di rentangnya; bentuk dan jarak waktu terjaga |

## Device chain / Rack (`js/devices.js`)
| Gestur | Aksi |
|---|---|
| Ketuk-ganda title bar | lipat / buka modul |
| **Tekan lama title bar lalu geser kiri/kanan** | **ubah urutan** (kartu terangkat mengikuti jari, garis aksen = posisi jatuh, rantai menggulir di tepi; satu langkah undo; urutan sinyal langsung berubah) |
| Geser title bar tanpa tekan lama | menggulir rantai seperti biasa |
| `⋯` | menu device (jendela mengambang, lipat, geser kiri/kanan, bypass, hapus) |
| Knob: seret vertikal | nilai; **geser jari menjauh ke samping = penyesuaian halus** (sampai 1/8), ketuk-ganda = nilai awal, tekan lama = otomasi / MIDI CC |

## Mixer
Fader: seret relatif (tidak melompat), ketuk-ganda = 0 dB, tekan lama = otomasi. Pan / send: seret. Lebar strip: seret grip, ketuk-ganda = normal.

## Menu utama, simpan
- **Simpan proyek…**: ketuk = dialog nama (Simpan sebagai). **Geser baris ini ke kanan = Simpan cepat** tanpa dialog
  (gaya FL Studio Mobile). Baris **Simpan cepat** juga ada sebagai tombol biasa (geser bukan satu-satunya cara), juga di Browser -> Proyek.
- Simpan cepat menimpa file proyek yang sedang dibuka; versi lama di disk lebih dulu disalin ke `Projects/_backup_<nama>.mdaw`
  (tampil di Browser -> Proyek -> Cadangan). Proyek yang belum pernah disimpan dengan nama selalu meminta nama dulu.
- Titik kecil di tombol menu = ada perubahan yang belum disimpan (dicek saat idle, tidak saat jari menyentuh layar).

## Pintasan keyboard (opsional, keyboard fisik / Bluetooth)
Bawaan aplikasi ini (bukan pintasan resmi FL Studio Mobile), bisa diubah di **Pengaturan -> Pintasan** (ketuk kolom, tekan tombol baru;
`✕` = kosongkan; tombol yang sama dipindah dari aksi lain). Tidak aktif saat mengetik di kotak teks.

Spasi play/pause · Home ke awal · Ctrl+S simpan cepat · Ctrl+Shift+S simpan sebagai · Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z undo/redo ·
Ctrl+C / X / V / D copy / cut / paste / duplikat · Ctrl+A pilih semua · Delete / Backspace hapus pilihan · Esc tutup menu / batalkan gestur /
lepas pilihan / tutup editor · = / − zoom · ← → playhead (editor: geser not terpilih) · ↑ ↓ track (editor: not ±1 semitone) · Tab
Arrangement/Mixer · M metronom · R rekam · B browser · F layar penuh. Di tab Keys, baris Z–M dan Q–I memainkan piano.

## Mana yang dari FL Studio Mobile, mana tambahan
Dari manual FL Studio Mobile: ketuk klip = kontrol klip, ketuk-ganda klip = editor, tekan lama ikon track = menu channel, tekan lama
tempat kosong = Paste, tarik ujung klip, ketuk / tekan lama Snap, ketuk not = kontrol, seret latar piano roll = seleksi, seret ruler =
rentang waktu, tekan lama channel drum = menu channel, ketuk-ganda / tekan lama + seret header modul, geser Save = Quick Save.
Tambahan aplikasi ini (bukan gestur resmi FL Studio Mobile): pinch zoom, geser dua jari, penyesuaian halus knob, bayangan + gelembung
posisi saat menyeret, Escape membatalkan gestur, getar, pengaturan ambang gestur, pintasan keyboard.

## Tes
- `node tools/gesture-test.mjs` (masuk `run-tests`): pengenal di Node dengan event sintetis — tap, toleransi, seret, pan + fling,
  ketuk-ganda (tertunda / tidak), tekan lama (ambang dari pref), pinch berpusat, geser dua jari, batal, slop mouse.
- `node tools/touch-ui-test.mjs` (Chromium emulasi Pixel 7, sentuhan; butuh Playwright, tidak di CI): 45 cek alur sentuh nyata di aplikasi.
- `node tools/pattern-ui-test.mjs`: alur klip pattern dengan sentuhan (tetap lulus).
