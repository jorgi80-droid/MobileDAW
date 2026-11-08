# Replica: klip Arrangement Ableton Live (recon -> build -> diff)

Sumber recon: tangkapan layar Live 11 / 12 yang dikirim pemilik (arrangement dengan klip audio, MIDI dan drum, tema gelap dan terang). Hanya tampilan
dan perilaku yang ditiru, bukan aset Live.

| Bagian klip | Live (diamati) | MobileDAW (`timeline.js drawClip`) | Status |
|---|---|---|---|
| Strip judul | warna klip, nama klip hitam (putih pada warna gelap), ~13 px | `hd` 14 px, warna klip, `ink()` ambang luminansi 100 | sama |
| Badan | warna klip penuh (bukan pucat) | warna klip penuh | sama |
| Isi audio | gelombang hitam simetris | `contentInk()` hitam 86 % (putih pada warna gelap) | sama |
| Isi MIDI / drum | balok not gelap, tinggi menurut rentang nada | idem | sama |
| Tepi | garis gelap tipis antar klip | `rgba(0,0,0,.6)` 1 px | sama |
| Garis bawah strip | tipis, lebih gelap | `rgba(0,0,0,.22)` 1 px | sama |
| Klip terpilih | lebih terang | badan `tint 0.32`, strip `tint 0.18`, garis tepi + menu ⋯ | mendekati |
| Klip nonaktif | abu-abu netral, isi abu tua | `#9a9a9f` / strip `#8a8a8f`, sama di semua tema | sama |
| Track dilipat | warna + isi tanpa strip | idem | sama |
| Loop | takik di strip + garis tipis | idem | sama |
| Tema | warna klip tidak berubah per tema | warna klip tidak melewati `C()` | sama |

Diff visual: screenshot per tema (dark / live / light / black / midlight) dibuat dengan skrip uji di scratchpad sesi; tidak dibandingkan piksel dengan Live
(warna dan font Live adalah trade dress-nya).

## Diff tata letak dengan alat Replica (`tools/imgdiff.py`, mode layout, warna diabaikan)
Referensi: screenshot arrangement Live 11 pemilik (3 track terbuka: 2 audio stereo + 1 drum MIDI, 1 track dilipat, return + Master), dipotong ke area
track. Klon: `node tools/replica-arr-shot.mjs out.png live` (keadaan yang sama, tema Live Classic), area track dipotong pada skala yang sama.

| Iterasi | Skor layout | Perubahan |
|---|---|---|
| 1 | 48,3 (DIFFERENT) | awal |
| 2 | 59,6 (PARTLY) | klip audio stereo digambar dua gelombang (kiri di atas, kanan di bawah) seperti Live; baris Master / FX tipis (26 px, nama di tengah, aktivator + field level di kolom mixer) |

Sisa perbedaan (alasan): kolom I/O Live (Audio From / Monitor / Audio To) sengaja tidak ada karena pemilik minta header tanpa In / Auto / Off dan Master di
kolom mixer; Return A / B tidak tampil sebagai baris arrangement di MobileDAW (send A / B ada di tiap track); strip judul klip MobileDAW menampilkan nama
sampel. Skor bukan target piksel: tampilan Live adalah trade dress-nya; yang ditiru adalah struktur dan perilaku.
