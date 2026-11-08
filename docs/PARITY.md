# Matriks paritas: Master Prompt "Workflow FL Studio Mobile Touch" vs MobileDAW

Status per bagian prompt. **Selesai** = ada, berfungsi, dan dites (nama tes di kolom Bukti). **Sebagian** = ada tapi belum lengkap
(alasan ditulis). **Belum** = belum dibuat. **Batas platform** = tidak bisa dibuat dengan WebView/Web Audio di HP.
Gestur per layar: `docs/GESTURES.md`. Riwayat teknis: `docs/HANDOFF.md`.

Stack dipertahankan: JS modul (tanpa build) + AudioWorklet + engine C++ (Android, Oboe) + IndexedDB/SAF + PWA offline.

## 2–3. Gestur global, shortcut, quick action
| Fitur | Status | Bukti / catatan |
|---|---|---|
| Satu pengenal gestur (tap / ketuk-ganda / tekan lama / seret / pinch / geser 2 jari), ambang bisa diatur, getar | Selesai | `gesture-test`, `touch-ui-test` |
| Ketuk-ganda tidak dibaca dua ketukan; Escape / jari kedua membatalkan tanpa langkah undo | Selesai | `gesture-test`, `touch-ui-test` |
| Aksi destruktif lewat menu/konfirmasi + Undo | Selesai | hapus track / pad / proyek / ganti rantai; `touch-ui-test` |
| Shortcut keyboard opsional, bisa diubah (Pengaturan → Pintasan), tidak memotong input teks | Selesai | `touch-ui-test` |
| Quick action: Playlist / Piano Roll / Step / Automation / Wave Editor | Selesai | menu klip tidak modal, bar not, menu pad, bar titik otomasi, menu seleksi Wave Editor |
| Quick action Piano Roll "Slide" | Selesai | tombol Slide di bar not (track synth); not slide digambar dengan goresan naik + ↗ |

## 4. Playlist
| Fitur | Status | Bukti / catatan |
|---|---|---|
| Ketuk klip = Clip Controls (Copy, Cut, Delete, Snap, Edit, Combine, Mute …), ketuk-ganda = editor | Selesai | `touch-ui-test` |
| Pattern 4→8 bar mengulang 1-4; 3→8 bar = 3+3+2, tanpa pembulatan, sumber tidak disalin | Selesai | `pattern-test`, `pattern-ui-test` |
| Resize vs time-stretch audio dipisah (Stretch Mode), warp Beats / Tones / Re-Pitch | Selesai | `stretch-test` |
| Insert / Duplicate / Delete / Delete Space / Trim rentang waktu | Selesai | menu seleksi ruler (sesi sebelumnya) |
| Snap ketuk = on/off, tekan lama = pilihan; zoom, fit proyek / klip / seleksi | Selesai | `touch-ui-test` |
| Bayangan posisi asal + gelembung posisi saat menyeret | Selesai | `touch-ui-test` |
| Sub-track (Notes Track / Step Track di bawah drum channel) | Belum | model data satu track = satu jenis klip; perlu desain struktur track baru |
| Save as MIDI per track | Selesai | menu header track → "Simpan sebagai MIDI" (`track-dup-test`, `channel-ui-test`); ekspor seluruh proyek tetap ada |
| Pan per klip audio (balance di atas pan track, slider Pan di panel audio klip, impor FLM memakainya) | Selesai | `clip-pan-test` (pan 0 identik bit dengan sebelumnya), golden `core-clip-pan` JS = C++ |
| Menu channel: Duplikat track, Impor MIDI ke track ini, Sync semua sample | Selesai | `track-dup-test` (salinan independen, id baru, sidechain mengikuti, satu langkah urung), `channel-ui-test` |

## 5. Channel Rack / Rack efek
| Fitur | Status | Bukti / catatan |
|---|---|---|
| Urutan modul = urutan sinyal (rantai utama dan di dalam rack) | Selesai | `chain-order-test` (suara beda bila urutan dibalik; urutan baru = rantai baru, identik) |
| Tekan lama header modul + geser = reorder, garis sisip, undo | Selesai | rantai utama, **Audio / Instrument Rack**, chain pad Drum Rack (`js/reorder.js`); `touch-ui-test` |
| Ketuk-ganda header = lipat / buka | Selesai | sesi sebelumnya |
| Header track gaya Live: kolom warna penuh + kolom mixer, ketuk = Penuh / Ringkas, lebar bisa diseret, Monitor In/Auto/Off, Out | Selesai | `tools/header-ui-test.mjs` |
| Tombol Rewind di toolbar (CTRL dihapus) | Selesai | |
| Menu modul: geser, Sisip kiri/kanan, Ganti, Copy, Paste, Reset, Simpan preset, Sisip preset, Bypass, Hapus | Selesai | `touch-ui-test` |
| Rack Preset: simpan / muat (ganti) / sisip, Copy All / Paste All | Selesai | `touch-ui-test` (simpan → kosongkan → muat = identik) |
| Plugin hilang di preset | Selesai | modul yang tidak ada di versi ini jadi placeholder netral (Utility bawaan, audio lewat) yang menyimpan data aslinya utuh; disimpan apa adanya dan kembali sendiri di versi yang mengenal tipenya; paste / Rack preset / preset mixer melapor "sebagai placeholder". `placeholder-test` |
| Mix per modul (Dry/Wet, gain) | Selesai | chip Mix di judul tiap kartu efek: Mix 0-100 %, Gain -36..+12 dB, dry disejajarkan dengan latency efek; JS = C++ (golden `core-fx-mix`), `fx-mix-test`. Kontrol UI hanya untuk rantai utama track / Master / return |

## 6. Mixer
| Fitur | Status | Bukti / catatan |
|---|---|---|
| Fader / pan / mute / solo / meter / send / Master FX / return | Selesai | `mixer-test`, `click-test` (sesi sebelumnya) |
| Semua kontrol mixer bisa diotomasi (tekan lama atau CTRL) | Selesai | `touch-ui-test` (CTRL) |

## 7. Piano Roll
| Fitur | Status | Bukti / catatan |
|---|---|---|
| Ketuk = not, seret / ujung = pindah / durasi, seret latar = seleksi, copy/paste relatif | Selesai | `touch-ui-test`, `clipview-test` |
| More: Legato, Snap ke skala, Tebak skala, Humanize, Double up/down, Panjang, Transpose, ±1 | Selesai | sesi sebelumnya |
| Snap Steps 1/6..1, Beats 1/6..1, Bar; quantize hanya not terpilih | Selesai | sesi sebelumnya |
| Ruler: Select / Insert / Duplicate / Delete space / Trim / Tebak skala / Snap ke skala | Selesai | sesi sebelumnya |
| Lane Velocity / Pan | Selesai | sesi sebelumnya |
| **Ghost Notes** (bisa dimatikan di Pengaturan → Editor) | Selesai | dicek visual; data dari `clipNoteEvents` yang sama dengan engine |
| Slide Notes (pitch / velocity / pan glide) | Selesai | not slide menggeser nada (lane kind 4, semitone persis), level (kind 5 = rasio velocity not slide / not yang berbunyi) dan pan (kind 6 = selisih pan) not yang berbunyi selama panjang not slide; lane 5/6 hanya ditulis bila ada slide yang mengubahnya. JS = C++: golden `core-slide`, `core-slide-vp`; `slide-test`. Batas: berlaku untuk seluruh track (akor ikut), velocity dipetakan sebagai rasio gain |
| Strength quantize parsial | Selesai | alat Quantize di editor (Jumlah 0-100 %, `editor.js` TOOLS); belum ada tes otomatis |

## 8. Step Sequencer / Drum
| Fitur | Status | Bukti / catatan |
|---|---|---|
| Ketuk step, lukis, Swing (groove global / per klip), Fill 1/2/4, Clear | Selesai | sesi sebelumnya |
| Menu channel: Load Sample, Clone, Set MIDI Key (ketik / learn dari controller), Hapus | Selesai | `touch-ui-test` |
| Graph editor: Velocity, **Note Repeat 1–8** | Selesai | `pattern-test` (event yang dikirim ke kedua engine) |
| Graph editor: Pan / Pitch per step | Selesai | lane Pan dan Pitch (-12..+12 semitone) di graph editor drum; Pitch = event not stride 6 → `DrumSynth.noteOnSt` di JS dan C++ (golden `inst-drumpitch` identik, `drumseq-test`); Pan memakai pan per not dari awal step |
| ADSR pad, Reverse, Pitch, Start/End | Selesai | panel pad (sesi sebelumnya) |
| Cut Groups A/B/C, Poly, Hold, Shift per pad (tab **Seq**) | Selesai | `drumseq-test` (perilaku), golden `inst-drumcut` (JS = C++ identik); **AUX per pad belum** (butuh routing send per pad) |
| Simpan / muat Drum Kit (Save Template / My Drumsets) | Selesai | menu header track drum; `drumkit-test`, `channel-ui-test`; pad dengan chain instrumen dilewati dan dihitung |

## 9. Automation
| Fitur | Status | Bukti / catatan |
|---|---|---|
| **CTRL** di transport: gerakkan kontrol → CTRL → Add Automation Track / Link to Current Track / Link to MIDI CC | Selesai | `touch-ui-test` |
| Edit titik: tambah, seret, seleksi banyak, copy / paste (bentuk & jarak terjaga), hapus, kurva | Selesai | `touch-ui-test`, `autocurve-test` |
| Rekam otomasi dari gerakan kontrol saat merekam | Belum | |

## 10. Audio / Wave Editor
| Fitur | Status | Bukti / catatan |
|---|---|---|
| Seret ruler (atau tekan lama + seret) = seleksi waktu | Selesai | `touch-ui-test` |
| Menu: Deselect, Insert Silence, Duplicate, Clear, Delete Space, Trim, Normalize, Fade In, Fade Out, Undo | Selesai | `waveops-test`, `touch-ui-test` |
| Edit tidak merusak file asli (hasil di `Samples/Edits`, Undo menunjuk lagi ke sample lama); potongan di zero-crossing | Selesai | `waveops-test` |
| Envelope Volume / Pan / Pitch di dalam klip | Sebagian | fade in/out dan gain klip ada; envelope bertitik per klip belum (lane otomasi track bisa dipakai) |

## 11. Keyboard / Drumpad / MIDI
| Fitur | Status | Bukti / catatan |
|---|---|---|
| Keyboard Klasik, **Skala**, **Chord** (strip per derajat skala, inversi per zona, 7th, Hold), **Strum** (arah + kecepatan) | Selesai | `chords-test`, `touch-ui-test` |
| Pitch bend wheel, velocity dari posisi sentuh | Selesai | sesi sebelumnya |
| Penamaan C tengah C3 / C4 / C5 | Selesai | Pengaturan → Editor |
| Drumpad, MIDI learn CC, MMC, pilih perangkat | Selesai | sesi sebelumnya (Web MIDI) |
| Bluetooth MIDI / USB di APK | Batas platform | WebView Android tidak punya Web MIDI; butuh plugin native MIDI (belum) |
| Mod wheel | Belum | |

## 12. Transport / Recording
| Fitur | Status | Bukti / catatan |
|---|---|---|
| Play, Rec, Metronom + level, count-in, Tap Tempo, input BPM, CTRL, Undo, CPU meter, tes performa | Selesai | sesi sebelumnya + CTRL |
| Kompensasi latensi rekaman + PDC | Selesai | `pdc-test` |
| Monitoring input audio + peringatan headphone | Belum | rekaman audio belum punya monitoring (jadi juga tidak ada risiko feedback) |
| Multitrack input | Batas platform | getUserMedia di HP umumnya satu input stereo |

## 13. Home / Project / Files / Export
| Fitur | Status | Bukti / catatan |
|---|---|---|
| **New Project**: nama, tempo, birama, template | Selesai | `touch-ui-test` |
| Save / Save As / **Quick Save (geser)** + cadangan, indikator belum tersimpan, autosave | Selesai | `touch-ui-test` |
| **Recent**, **Duplikat / Ganti nama / Hapus** proyek (hapus dengan konfirmasi) | Selesai | Browser → Proyek (tekan lama) |
| Ekspor WAV 16/24/32f, MP3, MIDI, .mdaw, ZIP (proyek + sample), stem, mono, sample rate | Selesai | `export-test` |
| **Instrumen FLM**: DirectWave, GMS, MiniSynth, SuperSaw dengan tab / kontrol / logika FLM, UI gaya Live | Selesai (kurva suara perkiraan) | `inst-test`, `flm-inst-shots`, `docs/FLM-INSTRUMENTS.md` |
| Preset ekspor **WAV 16-bit · 44,1 kHz** / **MP3 320 kbps · 44,1 kHz**; MP3 dengan model masking, scalefactor, bit reservoir | Selesai | `export-test` (struktur MP3), `export-ui-test`, `mp3-quality-test` (vs LAME, butuh ffmpeg) |
| Render **Seleksi**, **Trim Silence**, tail **Leave / Wrap / Cut** | Selesai | `waveops-test` (postRender) |
| **Impor proyek FL Studio Mobile (.flm / ZIP)**, Ableton (.als), FL Studio (.flp, eksperimental) dengan progres + laporan; DirectWave FLM → DirectWave MDAW (semua lapisan + root key), GMS / MiniSynth / SuperSaw → synth MDAW yang sama | Selesai | `import-test`, `import-ui-test` (arsip FLM pemilik: 26 track, 1032 klip, 42/42 sample); lihat `docs/IMPORT.md` |
| FLAC / AAC / OGG | Batas platform | tidak ada encoder di browser tanpa pustaka tambahan |

## 14. Settings
| Fitur | Status | Bukti / catatan |
|---|---|---|
| Audio, Performa, Tampilan, **Sentuhan**, **Pintasan**, **Editor** (ghost notes, C tengah, velocity / panjang default), Penyimpanan, Log, Reset dengan konfirmasi | Selesai | `touch-ui-test` |
| Pilihan input audio / interface, buffer manual | Sebagian | profil performa mengatur buffer; pemilihan perangkat input belum |

## 16–17. Data & kinerja
| Fitur | Status | Bukti / catatan |
|---|---|---|
| Semua editor menulis ke satu model proyek; Undo membalik data | Selesai | semua tes di atas memakai `project.js` langsung |
| Engine audio tidak berubah oleh pekerjaan UI | Selesai | golden 111 skenario identik bit JS = C++ |
| Gelembung nilai, penyesuaian halus knob, bayangan drag | Selesai | `touch-ui-test` |

## 19. Hasil acceptance test (otomatis, Chromium emulasi Pixel 7)
- A Playlist 1–8: lulus (`pattern-test`, `pattern-ui-test`, `touch-ui-test`); 6 (Sync / non-Sync) lewat `stretch-test`.
- B Rack & Mixer 1–7: 1–5 lulus (`chain-order-test`, `touch-ui-test`, `mixer-test`); 6 (AUX / Master FX) dicakup `pdc-test`; 7 (urutan mixer ikut urutan track) tidak dites ulang otomatis di sesi ini.
- C Piano Roll 1–8: lulus kecuali slide note (belum ada).
- D Drum 1–8: 1, 3, 4, 5 (velocity + repeat) lulus; 6 (Cut Groups / Poly / Hold / Shift) lulus (`drumseq-test`, golden `inst-drumcut`), AUX per pad belum; 8 (template kit) lulus (`drumkit-test`).
- E Automation & Audio 1–7: 1, 3–7 lulus; 2 (rekam otomasi) belum; envelope pan/pitch per klip belum.
- F Controller: 1–3, 5, 6 lulus di Chromium; 4 (USB/BT MIDI) dan 7–9 butuh HP sungguhan.
- G Proyek & Ekspor: 1–5 lulus; 6–8 dites lewat `export-test` / `waveops-test` (render penuh di HP belum diuji).
- H Touch: 3–5 lulus di emulator; 1, 2, 6, 7 butuh uji di HP sungguhan (pemilik).
