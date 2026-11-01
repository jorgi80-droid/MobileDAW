# Instrumen FL Studio Mobile di MobileDAW (DirectWave, GMS, MiniSynth, SuperSaw)

Sumber: screenshot modul FLM dari pemilik (26 gambar, semua tab) dan "Panduan Lengkap Instrumen FL Studio Mobile" (PDF pemilik, berdasar
dokumentasi Image-Line). Mesin: `js/engine/flmsyn.js`. Parameter: `js/defs.js` (INSTRUMENTS 30–33). Panel: `js/fxkit.js` (VI[30..33]),
desain Ableton Live 12 (tab, knob dengan label + nilai, layar gelap dengan kurva cyan / oranye, tombol oranye).

| Tipe | Nama | Tab (sama dengan FLM) |
|---|---|---|
| 30 | DirectWave | SAMPLE · FILTER · FLT ENV · FRQ ENV · LFO (+ daftar zona di kiri) |
| 31 | GMS | FILTER · OSC · MOD · LEVEL · EG · LFO · VOICES · FX |
| 32 | MiniSynth | OSC · FILTER · FLT EG · LFO · MASTER · FX |
| 33 | SuperSaw | OSC (SUPERSAW / SUPERSYNC) · FILTER · LFO · LEVEL · MOD · VOICES · FX |

Instrumen lama tetap ada dengan nomor yang sama dan diberi nama **Klasik** (1 Mini Synth Klasik, 2 SuperSaw Klasik, 4 DirectWave Klasik,
5 GMS Klasik): proyek lama terbuka dan berbunyi persis sama (golden test tetap identik). Track synth baru memakai **MiniSynth** (32).
Pemilih instrumen menampilkan keempat instrumen FLM paling atas.

## Alur sinyal (seperti FLM)
not → voice manager (Poly dengan batas voice / Mono / Legato / Slide) → oscillator atau zona sample → filter (cutoff, resonance, key
tracking, velocity tracking, envelope) → envelope amplitudo → modulasi LFO / envelope → FX bawaan instrumen → track.

## Parameter per instrumen
Nilai memakai satuan yang ditampilkan FLM: knob 0..100, semitone, cent, nilai tempo dalam **ketukan** seperti FL ("1/4" = seperempat
ketuk, "3/4", "8 Bars"); waktu envelope dalam detik (FLM tidak menampilkan angka untuk slider envelope).

- **DirectWave (30)** — Sample: Pitch ±24 st, Fine Tune ±100 ct, Attack / Decay / Sustain / Release, Slide Time, PB Range, Reverse, Loop,
  Legato, Mono. Filter: Cutoff, Resonance, Kbd Trk, Vel Trk, Filter Off / Lowpass / Highpass / Bandpass. Flt Env dan Frq Env (pitch
  ±12 st): ADSR + Amount ±100. LFO: Hertz / One Shot / Tmp Sync, Rate (0,03–30 Hz) atau nilai tempo, Shape Sine / Saw / Square, Attack,
  Amount, Destination Filter / Frequency / Level / Pan. Level (tambahan MDAW). Zona (sample, root, rentang tuts / velocity, tune, loop)
  sama dengan DirectWave Klasik; semua zona yang cocok berbunyi bersamaan (lapisan FLM).
- **GMS (31)** — Filter: Cutoff, Res, Attack, Decay, Amount, Kbd, Kind LP 12 / LP 24 / HP. Osc: gelombang A dan B (Beast, Sine,
  Triangle, Saw, Square, Pulse 25 %, Pulse 12 %, Organ, Bell, Formant, Hollow, Brass, Voice, Digital — tabel band-limited per oktaf),
  Pitch B, Fine B, Phase B, Balance, Noise. Mod: Mod Amount, Kind Mix / FM / Ring / Sync (B memodulasi A), Attack / Decay / EG Amount
  (envelope kedalaman modulasi), PB Range, MW Dest / MW Amount. Level: Level, Pan, ADSR. EG: Contour ±, ADSR, Vel, Dest Filter / Osc. Mod /
  Pitch. LFO: Amount, Shape, Dest FLT / OSC / PITCH, Rate (tempo). Voices: Transpose, Slide, Chorus Detune / Stereo, Mono, Auto (legato),
  Voices Solo–4, Scale Flat / Chord (+7, +12, +19) / Octave. FX: 3 slot seri (On, FX Kind Dist / Flanger / Phaser / LPF / HPF / Delay /
  Reverb / Panner / Ring Mod / VOX Filter, Amount = kedalaman LFO ke X, X, Y, LFO Rate, LFO Shape) — arti X / Y per jenis sesuai panduan.
- **MiniSynth (32)** — Osc: Oscillator Kind (Saw, Saw + Saw, Pulse, Square + Saw, Square + Square, SuperSaw 8 voice stereo, Bell, DeafSaw,
  Spread Oct, Spread 5th) dengan Modifier sesuai jenis (pulse width / pitch voice kedua hingga +24 st / detune / komponen spektral), Noise,
  Transp ±12. Filter low-pass: Cutoff, Kbd Trk, Vel Trk, Res. Flt EG: ADSR + Amount ±100. LFO: Amount ±, Rate (tempo), Shape SIN / SAW /
  SQR, Dest FLT / FRQ / MOD, MW / MW Dest. Master: ADSR, Voices Mode Poly (8 voice) / Mono (slide + envelope di-reset) / Lead
  (portamento hanya saat not tumpang tindih, envelope tidak diulang), Slide. FX (urutan tab FLM): Distortion (Drive, Decim =
  decimator), Delay (Feedback, Filter, Mix, Time tempo), Chorus (Rate, Mod, Mix), Phaser (Speed, Width, Feedback, Freq, Mix), masing-masing
  dengan saklar.
- **SuperSaw (33)** — Osc: Pulse Mode, Supersaw / Supersync, Retrig, Pulse Width, Sub Osc (saw satu oktaf di bawah), Unison Single–9,
  Detune, Unison Pan, Dtn. Spread (sebaran detune), Unison Phase; Supersync: Sync, Pulse Width, ADSR + Amount (modulasi sync), Flip
  (arah dibalik bila not lebih rendah dari not sebelumnya). Filter: Cutoff, Resonance, Kbd Trk, Vel Trk, ADSR, Amount. LFO: Hertz / One
  Shot / Tmp Sync, Rate, Shape Sine / Saw / Square / Random, Attack, Amount, Destination Cutoff / Resonance / Frequency / Osc Sync / Pulse
  Width / Unison Detune / Level / Pan. Level: Output Level, Panning, ADSR. Mod: PW Range (rentang pitch wheel), ModWheel Amount / Dest.
  Voices: Poly (batas voice, bawaan 5 seperti FLM), Transp, Slide, Legato, Constant (waktu slide tetap), Mono Mode, Arpeggiator (Rate,
  Range 1–4 oktaf, Mode Off / Up / Down / Up & Down / Random). FX: Distortion, Gain, Delay Time / Fdbk / Filter / Mix.

Preset bawaan (menu Preset kartu instrumen) mengikuti contoh sound design di panduan: DirectWave Mono Bass / Slow Pad / Reverse Chop /
Soft Keys; GMS FM Bell / Growl Bass / Pluck / Wide Chord; MiniSynth Pluck / Retro Bass / Bell / Pad / Lead; SuperSaw EDM Lead / Wide Pad /
Sync Lead / Pluck.

## Batas yang jujur
- Image-Line tidak mempublikasikan DSP-nya. Kontrol, logika (voice mode, legato, slide, unison, sync, routing modulasi, urutan FX) dan
  rentang yang terlihat sama dengan FLM; **kurva** (cutoff 0..100 → 20 Hz–20 kHz, waktu envelope, algoritma FX, isi gelombang GMS
  seperti "Beast") adalah buatan MobileDAW. Suaranya mirip, belum terbukti identik — kalibrasi butuh render referensi dari FLM.
- Mod wheel: MobileDAW belum punya sumber mod wheel, jadi MW Amount / Dest tersimpan (dan terbaca dari impor) tetapi belum berpengaruh.
- Engine C++ (Android, pilihan "Native") belum memuat instrumen 30–33: track yang memakainya otomatis dimainkan engine Web (fallback yang
  sudah ada), jadi bunyinya tetap sama di semua perangkat.
- Impor FLM: DirectWave → instrumen 30 dengan zona per lapisan; nilai Flt Env / Frq Env / LFO dikonversi dari file (urutannya cocok dengan
  screenshot: amount bipolar 0,5 = 0). Nilai tab Sample / Filter belum diketahui urutannya di file → disimpan mentah di `inst.from`.
  GMS / MiniSynth / SuperSaw → 31 / 32 / 33 dengan preset bernama sama bila ada; parameter asli disimpan mentah (type id dan urutan
  parameternya belum terverifikasi dari file FLM asli).

## Tes
- `tools/inst-test.mjs` (di run-tests): setiap parameter keempat instrumen terbukti mengubah suara (dengan prasyarat seperti FLM: amount
  envelope, Mono untuk slide, FX dinyalakan), tanpa NaN / lonjakan; legato dan PB Range diuji terpisah.
- `tools/flm-inst-shots.mjs`: membuka setiap tab di aplikasi (Chromium), memeriksa kontrolnya, menyimpan screenshot ke `docs/redesign/flm/`.
- `tools/import-test.mjs`: konversi parameter DirectWave dari FLM, synth → 31 / 32 / 33.
