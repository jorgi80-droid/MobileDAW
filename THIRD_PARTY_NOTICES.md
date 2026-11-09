# Third-party notices and license

MobileDAW is licensed under the **GNU General Public License, version 3 or (at your option) any later version**
(`LICENSE`). Commits up to and including `ccr-beaae46f-5tn5nu` before the commit "License: GPL-3.0-or-later" were published
under the MIT License by jorgysphere; code from those commits that is not mixed with the work below can still be used under MIT,
but the program as distributed from this point on is GPL-3.0-or-later as a whole.

## Honeydew (ported synth / sampler DSP)

- Source: Honeydew by daijro (<https://github.com/daijro/honeydew>, copy at <https://github.com/jorgi80-droid/honeydew>),
  crate `crates/audio` (SuperSaw, MiniSynth, GMSynth, DirectWave sampler and the shared pieces they use).
- Copyright (C) 2026 daijro and the Honeydew contributors.
- License: GPL-3.0-or-later (the same license as MobileDAW).
- Changes: ported from Rust to JavaScript (`js/engine/`) and C++ (`native/engine/`) so that the web engine and the native engine render
  identically (golden harness); the parameter conversion to MobileDAW's units and the integration into the engine are MobileDAW's.
  Every ported file keeps the copyright line of the original and names the Rust file it follows.
- Honeydew states that it is a clean-room reimplementation of FL Studio Mobile written from a specification and contains no code,
  samples, presets or artwork of FL Studio Mobile. MobileDAW does not verify that claim; FL Studio is a trademark of Image-Line, and
  MobileDAW is not affiliated with or endorsed by Image-Line.
