# MobileDAW Plugin SDK (API 1)

A MobileDAW plugin is **one ES module** (`.js` / `.mjs`) that exports a manifest and a DSP class. It runs inside the app's
AudioWorklet (the Web audio engine, real time) and on the main thread (offline export, freeze, bounce) — the same code in both places,
so what you hear is what you export. WebAssembly may be used from inside the module.

What this is **not**: VST / VST3 / AU / LV2 / CLAP binaries cannot be loaded (a browser or an Android WebView cannot run native
desktop plugins). Plugin instruments are not supported yet (API 1 is effects only). The native C++ engine (Android, optional) cannot run
JavaScript plugins: a project that contains a plugin plays on the Web engine automatically (the same fallback used for any device the
native engine does not have).

## Install

- In the app: *Pengaturan → Audio → Plugin → Pasang plugin (.js)…*. The file is checked first (manifest, class, a test run) and only then
  copied to the library folder `/Plugins`.
- Or copy the `.js` file into `/Plugins` in the library folder; every file there is loaded when the app starts, before the last project is
  restored.
- Installed plugins appear in *Browser → Efek → Plugin*.

## The module

```js
export const manifest = {
  id: 'com.example.mytremolo',   // unique, stable: projects store this id (3..64 chars: letters, digits, . _ -)
  name: 'My Tremolo',            // shown in the browser / device header (max 40 chars)
  version: '1.0.0',              // semver; a project saved with another MAJOR version gets a warning in the log
  api: 1,                        // the host API this plugin was written for
  kind: 'effect',                // only 'effect' in API 1
  params: [                      // max 64; index = parameter number in setParam / automation
    { name: 'Rate', min: 0.1, max: 20, def: 4, unit: 'Hz', curve: 'log' },   // curve 'log' needs min > 0
    { name: 'Depth', min: 0, max: 1, def: 0.5 },
    { name: 'Sync', min: 0, max: 1, def: 0, toggle: true },                   // on/off switch
    { name: 'Steps', min: 1, max: 16, def: 4, step: 1 },                      // integer steps
  ],
  presets: [ { name: 'Slow', params: [1, 0.4, 0, 4] } ],                      // optional, shown in the device menu
};

export default class MyTremolo {
  constructor(sampleRate, ctx) { /* ctx = { sidechain: Float32Array, api: 1 } */ }
  setParam(index, value) {}       // optional: value is in the manifest's min..max (automation calls this too)
  setTempo(bpm) {}                // optional: song tempo
  process(L, R, n) {}             // required: process n frames of L and R (Float32Array) IN PLACE
  readOut(out) { return 0; }      // optional: write up to 4096 display values into out, return how many
  lat() { return 0; }             // optional: latency in frames (0..16383) for delay compensation (PDC)
}
```

Parameter names are cut to 16 characters, units to 6.

### Real-time rules (process)

`process` runs on the audio thread every 128 frames. Inside it: **no allocation** (`new`, array literals, closures, string building),
no `await`, no logging, no I/O, no locks. Prepare everything in the constructor or `setParam`. Keep state in the instance — several
instances of the same plugin run at once, on different tracks.

## Safety (what the host does for you)

- Install / load: invalid manifest, missing class or `process`, a constructor that throws, or a `process` that throws on silence →
  the plugin is refused with the reason, nothing is installed.
- While playing: if `process` throws, or writes NaN / infinite / absurd values (|x| ≥ 10⁶) anywhere in the block, that block is muted,
  the device is bypassed and the error is logged. The rest of the project keeps playing.
- `lat()` is clamped to 0..16383 frames.
- A project whose plugin is not installed still opens: the device becomes a silent pass-through placeholder named
  "<name> (plugin tidak ada)" that keeps its parameter values and the plugin id, so installing the plugin and reopening the project
  restores it.

## Projects

Devices are saved with `{ plugin: { id, version, name } }` and their parameter values; the numeric device type is assigned per session
and is never relied on. Automation, presets, freeze, export and the effect racks treat a plugin like a built-in effect.

## WebAssembly

Compile at module top level (`await WebAssembly.compile(bytes)` — top-level await is allowed) and instantiate per instance in the
constructor with its own memory. Copy `L` / `R` into the WASM memory, run, copy back. See `plugins/examples/wasm-gain.js`.

## Examples

- `plugins/examples/tremolo.js` — tremolo / auto-pan, tempo sync, presets, read-out.
- `plugins/examples/wasm-gain.js` — gain written in WebAssembly (hand-assembled 97-byte module).

## Tests

- `node tools/plugin-test.mjs` — manifest validation, audio of both examples, error isolation, missing-plugin pass-through, PDC.
- `node tools/plugin-e2e.mjs` — in the real app (Chromium): install, real-time playback in the AudioWorklet, export, save / reload by id,
  missing plugin placeholder.
