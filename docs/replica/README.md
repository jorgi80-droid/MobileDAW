# Metode Replica di proyek ini

Dari paket `replica-skill` (MIT, milik pemilik proyek; dibaca, bukan disalin ke aplikasi): **meniru fitur, kontrol dan alur kerja secara clean-room**, tanpa
mengambil kode / aset aplikasi asli. Dipakai di sini sebagai disiplin kerja:

1. **Recon** dari sumber publik + file milik sendiri: manual resmi FL Studio Mobile (PDF dari pemilik), tangkapan layar pemilik, dan dua arsip `.flm` milik
   pemilik (dibaca dengan `js/import/flm.js`). Tidak ada dekompilasi `libFLM.so`, tidak ada VST komersial.
2. **Matriks fitur** `docs/replica/features.csv` (kolom feature, area, priority must / should / could, original, clone yes / partial / no / skip). Diturunkan dari
   `docs/PARITY.md` + 20 baris "Impor FLM" hasil audit arsip asli. Bobot must 3 / should 2 / could 1, partial = 0,5.
3. **Skor paritas jujur**: `python3 -I tools/parity.py docs/replica/features.csv` (pustaka standar saja, tidak memakai jaringan).
4. **Bukti**: tiap baris menunjuk tes atau arsip uji. Yang tidak terbukti ditulis partial / no, bukan diklaim.
5. **Yang tidak ditiru** (skip): konten berlisensi, library bawaan FLM yang tidak ada di arsip, plugin pihak ketiga, hal yang mustahil di WebView.

File: `features.csv`, `UNKNOWN-FLM-MODULES.md` (modul FLM yang belum dikenali + cara membantu mengidentifikasi), alat `tools/parity.py`,
`tools/flm-unknown-modules.mjs`.
