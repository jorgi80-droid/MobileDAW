// Per-module Mix / Gain (devParam 1000 / 1001, dsp.js fxRun; C++ units.h fxRun, golden core-fx-mix checks JS = C++):
// Mix 1 + Gain 1 leaves an effect bit-identical, Mix 0 gives the dry signal exactly (delayed by the effect's own latency so it stays aligned),
// Gain scales the module output, the project stores the values only when changed and they survive save / load and undo.
// Usage: node tools/fx-mix-test.mjs   (part of tools/run-tests.mjs)
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const { Engine, PPQ } = await import(path.join(root, 'js/engine/core.js'));
const D = await import(path.join(root, 'js/defs.js'));
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const SR = 48000, N = SR;
function render(setup) {
  const e = new Engine(SR); e.masterLimit(false); e.tempo(120); e.trackInst(0, 32); e.instParam(0, 43, -12); e.trackVol(0, 1);   // MiniSynth at -12 dB: FLM-loud, the sum with the reverb must stay below the output's clip
  const f = []; for (let k = 0; k < 8; k++) f.push(k * PPQ / 4, PPQ / 5, 48 + k * 3, 0.8, 0); e.trackNotes(0, f, f.length / 5);
  setup(e); e.play();
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let k = 0; k < N; k += 128) e.render(L.subarray(k, k + 128), R.subarray(k, k + 128), Math.min(128, N - k));
  return { L, R, e };
}
const same = (a, b, from = 0, shift = 0) => { for (let k = from; k < N; k++) if (a[k] !== b[k - shift]) return false; return true; };
const diff = (a, b) => { let m = 0; for (let k = 0; k < N; k++) m = Math.max(m, Math.abs(a[k] - b[k])); return m; };
const ref = render(() => {});
const rev = render((e) => { e.insertDevice(0, 0, 7); e.devParam(0, 0, 2, 0.7); });
const rev1 = render((e) => { e.insertDevice(0, 0, 7); e.devParam(0, 0, 2, 0.7); e.devParam(0, 0, D.MIX_P, 1); e.devParam(0, 0, D.GAIN_P, 1); });
ok(same(rev.L, rev1.L) && same(rev.R, rev1.R), 'Mix 100 % + Gain 0 dB: the effect is bit-identical to before (old projects sound the same)');
ok(diff(rev.L, ref.L) > 1e-3, 'the Reverb changes the sound (the test is meaningful)');
const rev0 = render((e) => { e.insertDevice(0, 0, 7); e.devParam(0, 0, 2, 0.7); e.devParam(0, 0, D.MIX_P, 0); });
ok(same(rev0.L, ref.L, 128) && same(rev0.R, ref.R, 128), 'Mix 0 %: exactly the dry signal (after the first 128-frame ramp)');
const half = render((e) => { e.insertDevice(0, 0, 7); e.devParam(0, 0, D.MIX_P, 0); e.devParam(0, 0, D.GAIN_P, 0.5); });
let gok = true; for (let k = 128; k < N; k++) if (half.L[k] !== Math.fround(ref.L[k] * 0.5)) { gok = false; break; }
ok(gok, 'Gain x0.5 (-6 dB) halves the module output exactly');
const cmp = render((e) => { e.insertDevice(0, 0, 4); [-30, 10, 1, 80].forEach((v, k) => e.devParam(0, 0, k, v)); e.devParam(0, 0, 9, 2); e.devParam(0, 0, D.MIX_P, 0); });
const lat = cmp.e.s[0].dev[0].lat();
ok(lat > 0 && same(cmp.L, ref.L, 12000, lat) && same(cmp.R, ref.R, 12000, lat), `Mix 0 % on a Compressor with 10 ms look-ahead: the dry is delayed by its latency (${lat} frames) and lines up exactly (after the fader smoothing at the start)`);
const m50 = render((e) => { e.insertDevice(0, 0, 7); e.devParam(0, 0, 2, 0.7); e.devParam(0, 0, D.MIX_P, 0.5); });
let mx50 = 0; for (let k = 0; k < N; k++) mx50 = Math.max(mx50, Math.abs(ref.L[k]), Math.abs(rev.L[k])); let bok = true, worst50 = 0; for (let k = 128; k < N; k += 97) worst50 = Math.max(worst50, Math.abs(m50.L[k] - (ref.L[k] + (rev.L[k] - ref.L[k]) * 0.5))); for (let k = 128; k < N; k += 97) { const x = ref.L[k] + (rev.L[k] - ref.L[k]) * 0.5; if (Math.abs(m50.L[k] - x) > 1e-6 * Math.max(1, mx50)) { bok = false; break; } }
ok(bok, 'Mix 50 %: halfway between the dry and the wet signal (worst ' + worst50.toExponential(1) + ' at a peak of ' + mx50.toFixed(2) + ')');
const md = render((e) => { e.insertDevice(0, 0, 50); e.insertDevice(0, 1, 7); e.devParam(0, 1, D.MIX_P, 0.3); });
ok(md.L.every(Number.isFinite), 'a modulator ahead of a mixed effect: no NaN');

// ---- project: values stored only when changed, undo, save / load
const P = await import(path.join(root, 'js/project.js')), H = await import(path.join(root, 'js/history.js'));
P.newProject(false); P.addTrack('midi'); const i = P.state.tracks.length - 1; P.addDevice(i, 7);
const d = P.state.tracks[i].devices[0];
ok(!('mix' in d) && !('gain' in d), 'a new effect carries no Mix / Gain fields (files stay as before)');
H.init && H.init();
P.setDeviceWet(i, 0, 'mix', 0.35); P.setDeviceWet(i, 0, 'gain', -4.5);
ok(d.mix === 0.35 && d.gain === -4.5, 'Mix 35 % / Gain -4.5 dB stored on the device');
const txt = P.serialize(), o = JSON.parse(txt), dd = o.tracks.find((t) => t.id === P.state.tracks[i].id).devices[0];
ok(dd.mix === 0.35 && dd.gain === -4.5, 'saved in the project file');
P.setDeviceWet(i, 0, 'mix', 1); P.setDeviceWet(i, 0, 'gain', 0);
ok(!('mix' in d) && !('gain' in d), 'back to the defaults: the fields are removed again');
P.setDeviceWet(i, 0, 'mix', 7); P.setDeviceWet(i, 0, 'gain', 99);
ok(d.mix === 1 || !('mix' in d), 'Mix is limited to 0..100 %'); ok(d.gain === D.WET_GAIN_MAX, 'Gain is limited to +12 dB');
await P.deserialize(txt);
const d2 = P.state.tracks.find((t) => t.devices && t.devices[0] && t.devices[0].type === 7).devices[0];
ok(d2.mix === 0.35 && d2.gain === -4.5, 'loaded back from the file');
// Mix automation lane (long press the Mix dial): the engine gets devParam 1000 lanes, the lane starts from the current Mix
{
  const { eng } = await import(path.join(root, 'js/engine.js')); let got = null; const au = eng.automation; eng.automation = (f, n) => { got = Array.from(f).slice(0, n); return au && au(f, n); };
  P.addTrack('midi'); const j = P.state.tracks.length - 1; P.addDevice(j, 7); P.setDeviceWet(j, 0, 'mix', 0.25);
  const dv = P.state.tracks[j].devices[0], at = P.addAutoTrack({ kind: 4, strip: P.stripOf(j), devId: dv.id, param: D.MIX_P, def: D.WET_PARAMS.mix }, 'Mix');
  const lane = P.state.tracks.find((t) => t.kind === 'auto' && t.target && t.target.param === D.MIX_P);
  ok(!!lane && Math.abs(P.autoCurrent(lane) - 0.25) < 1e-9, 'a Mix lane starts from the module\'s current Mix (25 %)');
  P.syncAutomation && P.syncAutomation();
  ok(got && got.some((v, k) => v === 4 && got[k + 3] === D.MIX_P), 'the engine receives the lane as device parameter 1000');
}
console.log(bad ? bad + ' FAILED' : 'ALL OK'); process.exit(bad ? 1 : 0);
