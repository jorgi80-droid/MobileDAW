// Plugin host (js/plugins.js + js/engine/fx.js, docs/PLUGIN-SDK.md) in the engine: the example plugins (JS and WebAssembly) process audio,
// manifests are validated, a plugin that throws or outputs NaN is switched off without stopping the engine, a plugin that is not installed
// is a pass-through that keeps the device indices, plugin latency enters PDC. (Loading into the AudioWorklet: tools/plugin-e2e.mjs.)
// Usage: node tools/plugin-test.mjs     (part of tools/run-tests.mjs)
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Engine, PPQ } = await import(path.join(root, 'js/engine/core.js'));
const { validateManifest } = await import(path.join(root, 'js/plugins.js'));
const Trem = await import(path.join(root, 'plugins/examples/tremolo.js')), Wg = await import(path.join(root, 'plugins/examples/wasm-gain.js'));
let bad = 0; const ok = (c, msg) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const reg = (globalThis.__mdawPlugins = new Map());
ok(validateManifest(Trem.manifest) === '' && validateManifest(Wg.manifest) === '', 'example manifests are valid');
for (const [m, why] of [[{ ...Trem.manifest, api: 2 }, 'api'], [{ ...Trem.manifest, id: 'x' }, 'id'], [{ ...Trem.manifest, version: '1' }, 'version'], [{ ...Trem.manifest, kind: 'instrument' }, 'kind'], [{ ...Trem.manifest, params: [{ name: 'a', min: 1, max: 0, def: 0 }] }, 'min'], [{ ...Trem.manifest, params: [{ name: 'f', min: 0, max: 10, def: 5, curve: 'log' }] }, 'log']])
  ok(validateManifest(m) !== '', `invalid manifest rejected (${why}): ${validateManifest(m)}`);
const SR = 48000, tone = Float32Array.from({ length: SR }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 330 * i / SR));
function render(setup, sec = 0.5) {
  const e = new Engine(SR); e.masterLimit(false); e.loadSample(0, tone, tone); e.trackClips(0, [0, PPQ * 4, 0, 1, 0, 0, 0], 1); const errs = []; e.onError = (x) => errs.push(x); setup(e); e.play();
  const N = Math.round(sec * SR), L = new Float32Array(N), R = new Float32Array(N); for (let i = 0; i < N; i += 128) e.render(L.subarray(i, i + 128), R.subarray(i, i + 128), 128); return { L, R, e, errs };
}
const rms = (a, from = 4800) => { let s = 0; for (let i = from; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / (a.length - from)); };
reg.set(1000, Trem); reg.set(1001, Wg);
const dry = render(() => {}), tr = render((e) => { e.insertDevice(0, 0, 1000); e.devParam(0, 0, 1, 1); }), tr0 = render((e) => { e.insertDevice(0, 0, 1000); e.devParam(0, 0, 1, 0); });
let same = true; for (let i = 0; i < dry.L.length; i++) if (dry.L[i] !== tr0.L[i]) { same = false; break; }
ok(rms(tr.L) < rms(dry.L) * 0.85 && same, `Tremolo plugin modulates the audio (RMS ${rms(tr.L).toFixed(3)} vs dry ${rms(dry.L).toFixed(3)}), depth 0 = untouched`);
const wg = render((e) => { e.insertDevice(0, 0, 1001); e.devParam(0, 0, 0, -6); }), ratio = rms(wg.L) / rms(dry.L);
ok(Math.abs(20 * Math.log10(ratio) + 6) < 0.01, `WASM Gain plugin: -6 dB (measured ${(20 * Math.log10(ratio)).toFixed(3)} dB)`);
// error isolation
reg.set(1002, { manifest: {}, default: class { process() { throw new Error('boom'); } } });
reg.set(1003, { manifest: {}, default: class { process(L) { L[3] = NaN; } } });
for (const [type, what] of [[1002, 'throws'], [1003, 'outputs NaN']]) {
  const r = render((e) => { e.insertDevice(0, 0, type); e.insertDevice(0, 1, 0); });
  ok(r.e.s[0].dev[0].bypass && r.errs.length > 0 && rms(r.L) > rms(dry.L) * 0.9, `a plugin that ${what} is switched off, reported (${r.errs.length}x), the track keeps playing`);
}
reg.set(1004, { manifest: {}, default: class { constructor() { throw new Error('ctor'); } } });
{ const r = render((e) => { e.insertDevice(0, 0, 1004); e.insertDevice(0, 1, 0); e.devParam(0, 1, 0, -12); }); ok(r.e.s[0].dev.length === 2 && r.e.s[0].dev[0].missing && Math.abs(20 * Math.log10(rms(r.L) / rms(dry.L)) + 12) < 0.05, 'a plugin whose constructor fails is a pass-through; the next device keeps its index (Utility -12 dB applied)'); }
{ const r = render((e) => { e.insertDevice(0, 0, 1999); e.insertDevice(0, 1, 0); e.devParam(0, 1, 0, -6); }); ok(r.e.s[0].dev[0].missing && Math.abs(20 * Math.log10(rms(r.L) / rms(dry.L)) + 6) < 0.05, 'a plugin that is not installed is a silent-free pass-through placeholder, indices kept'); }
// latency reporting -> PDC
reg.set(1005, { manifest: {}, default: class { constructor() { this.b = new Float32Array(256); this.w = 0; } lat() { return 100; } process(L, R, n) { for (let i = 0; i < n; i++) { const j = (this.w + i) & 255, k = (this.w + i - 100) & 255; this.b[j] = L[i]; L[i] = R[i] = this.b[k]; } this.w = (this.w + n) & 255; } } });
{ const e = new Engine(SR); e.loadSample(0, tone, tone); e.trackClips(0, [0, PPQ, 0, 1, 0, 0, 0], 1); e.trackClips(1, [0, PPQ, 0, 1, 0, 0, 0], 1); e.insertDevice(0, 0, 1005); ok(e.pdcLatency() === 100 + e.lim.latency, `plugin latency (100 frames) is compensated by PDC (output latency ${e.pdcLatency()})`); }
console.log(bad ? `\n${bad} FAILED` : '\nALL OK'); process.exit(bad ? 1 : 0);
