# Biaya render per frame (tools/ui-perf.mjs)

Proyek uji padat (8 track x 16 bar not), transport berjalan 3 detik per tampilan, Chromium headless tanpa vsync, 1180 x 560, DPR 2.
`meanMs`/`p95Ms`/`maxMs` = kerja JS di callback requestAnimationFrame per frame; `styleLayout` dan `script` = metrik CDP dibagi jumlah frame.
Angka bergantung mesin; bandingkan hanya dua run di mesin yang sama.

| Tampilan | Run | fps | mean ms | p95 ms | style+layout ms/frame | script ms/frame |
|---|---|---|---|---|---|---|
| Arrangement | baseline (Fase 0) | 368 | 0.40 | 0.5 | 0.268 | 0.197 |
| Piano roll | baseline (Fase 0) | 173 | 0.45 | 1.6 | 0.128 | 0.342 |
| Device | baseline (Fase 0) | 203 | 0.61 | 1.5 | 0.175 | 0.534 |
| Mixer | baseline (Fase 0) | 279 | 0.37 | 1.3 | 0.119 | 0.289 |

## Perbandingan akhir (Fase 8), dua run berturut-turut di mesin yang sama (commit dasar dad3163 vs hasil redesign)

| Tampilan | dasar mean / p95 ms | sesudah mean / p95 ms | style+layout ms/frame dasar -> sesudah | catatan |
|---|---|---|---|---|
| Arrangement | 0.15 / 0.4 | 0.19 / 0.5 | 0.079 -> 0.092 | + strip overview (digambar ulang hanya saat ada perubahan / playhead bergeser) |
| Piano roll | 0.50 / 1.8 | 0.50 / 2.1 | 0.118 -> 0.111 | sama |
| Device | 0.73 / 1.8 | 0.71 / 1.7 | 0.233 -> 0.221 | sama |
| Mixer | 0.38 / 1.4 | 0.36 / 1.3 | 0.128 -> 0.120 | sama |

Semua jauh di bawah anggaran 11 ms per frame untuk 90 fps (dan 8,3 ms untuk 120 fps).
