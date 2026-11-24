# MobileDAW 2

A separate app next to MobileDAW 1.0, which stays in the repository root, unchanged, in the Ableton style. MobileDAW 2 is a
simpler touch screen built from these sources:

- **Workflow and gestures:** Honeydew (`jorgi80-droid/honeydew`, GPL-3.0), an open-source studio modelled on FL Studio Mobile.
  Its clip bubbles, More… menu, insert menu and range menu are followed.
- **Look:** MobileDAW's own outline icons, rounded-square controls and theme colours, with Indonesian labels. The owner's
  FL Studio Mobile screenshots were used as inspiration only; nothing is copied from them.
- **Modules:**
  - FL Studio Mobile's own instruments: 3x Osc, DirectWave, GMS, MiniSynth, Slicer, SoundFont Player, SuperSaw, Transistor Bass.
  - FL Studio Mobile's own effects, with the note effects (Arpeggiator, Note Echo, Transpose, Randomizer, Scale).
  - Plus MiniMeters, Harmor and Moisture.
  - Projects that already use other modules still play them, but they are not offered in the lists.

## How MobileDAW 2 is separate

| | MobileDAW 1.0 | MobileDAW 2 |
|---|---|---|
| Web app | `/` (repository root) | `/app2/` |
| Settings (localStorage) | `mobiledaw.*` | `mobiledaw2.*` |
| Files (IndexedDB / folder) | `mobiledaw`, `mobiledaw-fs`, `MobileDAW/` | `mobiledaw2`, `mobiledaw2-fs`, `MobileDAW2/` |
| Offline cache | `mobiledaw-…` (`sw.js`, `node tools/build.mjs`) | `mobiledaw2-…` (`app2/sw.js`, `node tools/app2-build.mjs`) |
| Android | `com.mobiledaw.app` (`android/`) | `com.mobiledaw.app2` (`app2/android/`), installs next to 1.0 |
| APK (GitHub Actions) | `MobileDAW-debug-apk` | `MobileDAW2-debug-apk` |

- **Shared:** the C++ audio engine source in `native/`, which both Android apps compile, and the demo songs in `demos/`.
- **Copied:** the JavaScript engine, the WebAssembly build and the editors were copied from 1.0 when MobileDAW 2 was made.
  From then on they are changed in `app2/` without touching 1.0.
- **Project files:** `.mdaw` is the same format in both apps, so a song can be opened in either.

## Commands

- `node tools/app2-build.mjs` updates the offline file list and cache name after any change in `app2/`.
- `node tools/app2-check.mjs` runs a syntax check and checks the file list.
- `node tools/app2-test.mjs` runs the browser test of the main screen. Both checks are also part of `node tools/run-tests.mjs`.
- `node tools/app2-www.mjs && (cd app2 && npx cap sync android && cd android && ./gradlew assembleDebug)` builds the Android APK.

The plan and the phases are in `docs/UI2.md`.
