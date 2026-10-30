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
