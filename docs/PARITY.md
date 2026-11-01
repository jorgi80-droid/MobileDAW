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
| Quick action Piano Roll "Slide" | Belum | slide note butuh dukungan di engine JS + C++ (lihat §7F) |

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
| Save as MIDI per track | Sebagian | ekspor MIDI seluruh proyek ada (menu → Ekspor MIDI); per track belum |

## 5. Channel Rack / Rack efek
| Fitur | Status | Bukti / catatan |
|---|---|---|
| Urutan modul = urutan sinyal (rantai utama dan di dalam rack) | Selesai | `chain-order-test` (suara beda bila urutan dibalik; urutan baru = rantai baru, identik) |
| Tekan lama header modul + geser = reorder, garis sisip, undo | Selesai | rantai utama, **Audio / Instrument Rack**, chain pad Drum Rack (`js/reorder.js`); `touch-ui-test` |
| Ketuk-ganda header = lipat / buka | Selesai | sesi sebelumnya |
| Menu modul: geser, Sisip kiri/kanan, Ganti, Copy, Paste, Reset, Simpan preset, Sisip preset, Bypass, Hapus | Selesai | `touch-ui-test` |
| Rack Preset: simpan / muat (ganti) / sisip, Copy All / Paste All | Selesai | `touch-ui-test` (simpan → kosongkan → muat = identik) |
| Plugin hilang di preset | Sebagian | modul tak dikenal dilewati DAN dilaporkan namanya (tidak diam-diam); placeholder yang menyimpan state belum (butuh tipe device kosong di engine) |
| Mix per modul (Dry/Wet, gain) | Sebagian | ada di modul yang punya parameter itu (Live 12), bukan kontrol seragam di semua modul |

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
| Slide Notes (pitch / velocity / pan glide) | Belum | perlu perubahan engine JS + port C++ identik + skenario golden; tidak dikerjakan agar engine tidak rusak |
| Strength quantize parsial | Belum | |

## 8. Step Sequencer / Drum
| Fitur | Status | Bukti / catatan |
|---|---|---|
| Ketuk step, lukis, Swing (groove global / per klip), Fill 1/2/4, Clear | Selesai | sesi sebelumnya |
| Menu channel: Load Sample, Clone, Set MIDI Key (ketik / learn dari controller), Hapus | Selesai | `touch-ui-test` |
| Graph editor: Velocity, **Note Repeat 1–8** | Selesai | `pattern-test` (event yang dikirim ke kedua engine) |
| Graph editor: Pan / Pitch per step | Belum | engine native mengabaikan pan per not; pitch per step butuh engine |
| ADSR pad, Reverse, Pitch, Start/End | Selesai | panel pad (sesi sebelumnya) |
| Cut Groups A/B/C, Poly, Shift, Hold, AUX per pad | Belum | butuh perubahan DrumSynth JS + C++ |
| Simpan / muat Drum Kit | Sebagian | preset instrumen menyimpan parameter; kit dengan sample per pad belum |

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
| Render **Seleksi**, **Trim Silence**, tail **Leave / Wrap / Cut** | Selesai | `waveops-test` (postRender) |
| **Impor proyek FL Studio Mobile (.flm / ZIP)**, Ableton (.als), FL Studio (.flp, eksperimental) dengan progres + laporan | Selesai | `import-test`, `import-ui-test` (arsip FLM pemilik: 26 track, 1032 klip, 42/42 sample); lihat `docs/IMPORT.md` |
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
- D Drum 1–8: 1, 3, 4, 5 (velocity + repeat) lulus; 6 (Cut Groups / Poly / Shift / AUX) dan 8 (template kit) belum.
- E Automation & Audio 1–7: 1, 3–7 lulus; 2 (rekam otomasi) belum; envelope pan/pitch per klip belum.
- F Controller: 1–3, 5, 6 lulus di Chromium; 4 (USB/BT MIDI) dan 7–9 butuh HP sungguhan.
- G Proyek & Ekspor: 1–5 lulus; 6–8 dites lewat `export-test` / `waveops-test` (render penuh di HP belum diuji).
- H Touch: 3–5 lulus di emulator; 1, 2, 6, 7 butuh uji di HP sungguhan (pemilik).
