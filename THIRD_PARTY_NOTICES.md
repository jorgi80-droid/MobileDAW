# Third-party notices and license

MobileDAW is licensed under the **GNU General Public License, version 3 or (at your option) any later version**
(`LICENSE`). Commits up to and including `ccr-beaae46f-5tn5nu` before the commit "License: GPL-3.0-or-later" were published
under the MIT License by jorgysphere; code from those commits that is not mixed with the work below can still be used under MIT,
but the program as distributed from this point on is GPL-3.0-or-later as a whole.

## Honeydew (ported synth / sampler / effect DSP)

- Source: Honeydew by daijro (<https://github.com/daijro/honeydew>, copy at <https://github.com/jorgi80-droid/honeydew>),
  crate `crates/audio` (SuperSaw, MiniSynth, GMSynth, DirectWave sampler, the effect modules and the shared pieces they use).
- Copyright (C) 2026 daijro and the Honeydew contributors.
- License: GPL-3.0-or-later (the same license as MobileDAW).
- Changes: ported from Rust to JavaScript (`js/engine/`) and C++ (`native/engine/`) so that the web engine and the native engine render
  identically (golden harness); the parameter conversion to MobileDAW's units and the integration into the engine are MobileDAW's.
  Every ported file keeps the copyright line of the original and names the Rust file it follows.
- Ported so far: DW Sampler (`crates/audio/src/dw_sampler.rs`, `voice.rs` -> `native/engine/hddw.*`, C++ only; its parameter layout ->
  `dwParamsFromFlm` in `js/import/build.js`), GMSynth (`crates/audio/src/gmsynth.rs`, `gm_waveshapes.rs` -> `js/engine/hdgms.js`, `native/engine/hdgms.*`; its parameter and
  `CSTM` layout -> `gmsFromFlm`) with the MultiFX processor bank (`multifx.rs`, `multifx_delay.rs`, `multifx_reverb.rs` -> `js/engine/hdmfx.js`,
  `native/engine/hdmfx.*`). 25 of the 29 GMSynth shapes are Honeydew's own designs (not FL Studio Mobile's waveshapes); MobileDAW lowers their
  common level by 8 dB (measured). MiniSynth (`crates/audio/src/minisynth.rs` -> `js/engine/hdmini.js`, `native/engine/hdmini.h`, `native/engine/hdmini.cpp`;
  its parameter layout -> `miniFromFlm` in `js/import/build.js`), SuperSaw (`crates/audio/src/supersaw.rs` -> `js/engine/hdsaw.js`, `native/engine/hdsaw.h`, `native/engine/hdsaw.cpp`),
  its FLM parameter layout and laws (`src/params/instruments.rs` -> `ssFromFlm` in `js/import/build.js`) and the FLM note-event layout
  (`src/flm/read.rs`: u8 velocity / u8 pan, repeat, slide, drum hit pitch, drum slot MAIN / PRMS fields, channel SEND -> `js/import/flm.js`),
  FLM's mixer laws (`crates/audio/src/mixer.rs`: Level law dB = 66 v^0.6 - 60, balance pan law -> `flmGain`, engine `trackPanLaw`),
  the drum slot sampler laws (`crates/audio/src/drums.rs`: envelope coefficients, attack / decay / release recurrence, Sample Start,
  Length gate, whole-semitone Speed -> pad envelope model 1 in `js/engine/instruments.js` and `native/engine/inst_classic.cpp`,
  `js/import/flm.js`, `flmPadTime` in `js/project.js`) and the drum slot routing (`src/flm/read.rs` LINk / legacy routing, `src/audio_engine/drums.rs`).
- Effect modules (C++ only): `crates/audio/src/lib.rs` (AudioEffect, CommonModule and the module states: Equalizer, Graphic / Tuned EQ,
  Filter, Leveller, Compressor, Distortion, both Limiters, both Autoducks, Tremolo, Chorus, Phaser, Stereoizer, Spacer, Gate, Flanger,
  Tape Delay, Wow & Flutter, Trance Delay), `biquad.rs`, `reverbs.rs` (Reverb legacy / Reverb / Reverb 2), `comb.rs` -> `native/engine/hdfx.*`;
  `multiband.rs`, `tape_stop.rs`, `spreader.rs`, `waveshaper.rs`, `pitcher.rs`, `pitcher2.rs` and MultiFX on the bank above ->
  `native/engine/hdfx2.*`; the effect type ids, names and parameter tables (`effect_info`, `src/params/effects.rs`, `effects_24_51.rs`) and
  the Pitcher note `CSTM` layout (`src/panels/cstm.rs`) -> `js/flmfx.js`, `js/import/fxmap.js`, `js/import/flm.js`.
- Honeydew states that it is a clean-room reimplementation of FL Studio Mobile written from a specification and contains no code,
  samples, presets or artwork of FL Studio Mobile. MobileDAW does not verify that claim; FL Studio is a trademark of Image-Line, and
  MobileDAW is not affiliated with or endorsed by Image-Line.
