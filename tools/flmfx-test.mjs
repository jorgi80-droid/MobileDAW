// FL Studio Mobile effect modules (device 100 + FLM id; C++ only: native/engine/hdfx.cpp + hdfx2.cpp, Honeydew's DSP) run as WebAssembly in
// Node, and their import: every module renders with its defaults, Leveller's gain law, the rack Mix 0 = bypass, Post Gain, the JS fallback
// keeps the chain's indices; FLM modules import with their exact values (Post Gain / Mix / Wet Pan, Pitcher notes, off = bypass) whatever the
// replace mode, and FLM automation lanes reach the module's own parameter. The DSP itself was checked against Honeydew's Rust code sample
// for sample (bit-identical for all but Multi FX, which reuses the double-precision GMSynth bank: within -90 dB). Usage: node tools/flmfx-test.mjs
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { loadWasmEngine } from './wasm-engine.mjs';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DEVICES, FLMFX_BASE, FX_GROUPS } = await import(path.join(root, 'js/defs.js'));
const { FLMFX } = await import(path.join(root, 'js/flmfx.js'));
const { decide, resolveFlmAutomation, FLM_TYPES } = await import(path.join(root, 'js/import/fxmap.js'));
const { makeDevice } = await import(path.join(root, 'js/engine/fx.js'));
const SR = 44100;
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };

// one engine: a synth track playing a chord, then device lines; returns the left channel
async function render(devLines, sec = 1.5) {
  const w = await loadWasmEngine(SR);
  const ev = []; for (let k = 0; k < 8; k++) ev.push(k * 480, 400, 48 + ((k * 5) % 24), 0.8, 0);
  let txt = `masterLimit 0\ntempo 120\ntrackVol 0 1\ntrackInst 0 1\ntrackNotes 0 [${ev.length} ${ev.join(' ')}] ${ev.length / 5}\n` + devLines.join('\n') + '\nsettle\nplay\n';
  const er = w.cmd(txt); if (er) console.log('engine:', er.trim());
  const n = Math.round(sec * SR), L = new Float32Array(n), R = new Float32Array(n); w.render(L, R, n); return { L, R, er };
}
const ids = Object.keys(FLMFX).map(Number);
ok(ids.length === 32 && ids.every((id) => DEVICES[FLMFX_BASE + id] && DEVICES[FLMFX_BASE + id].params.length >= FLMFX[id].p.length + 3), `${ids.length} FLM modules defined as devices 100 + id (FLM params + Post Gain / Mix / Wet Pan)`);
const dry = await render([]);
const dryR = rms(dry.L, 0, dry.L.length);
{ const bads = [];
  for (const id of ids) {
    const { L, R, er } = await render([`insertDevice 0 0 ${FLMFX_BASE + id}`]);
    const fin = L.every(Number.isFinite) && R.every(Number.isFinite), r = rms(L, 0, L.length) + rms(R, 0, R.length);
    if (er || !fin || !(r > 1e-4) || !(r < 50)) bads.push(`${id} ${FLMFX[id].name}${er ? ' (' + er.trim() + ')' : ''}${fin ? '' : ' NaN'} rms ${r.toExponential(2)}`);
  }
  ok(!bads.length, 'every module renders a finite, non-silent signal with its FLM defaults' + (bads.length ? ': ' + bads.join('; ') : ''));
}
{ const v = 0.5, want = Math.pow(10, (-60 + 72 * Math.pow(v, 0.6)) / 20);
  const { L } = await render([`insertDevice 0 0 ${FLMFX_BASE + 20}`, `devParam 0 0 1 ${v}`]);
  const g = rms(L, SR * 0.5, SR * 1.4) / rms(dry.L, SR * 0.5, SR * 1.4); ok(Math.abs(g / want - 1) < 0.01, `Leveller Gain 0.5 = ${(20 * Math.log10(want)).toFixed(2)} dB (FLM law -60 + 72 v^0.6), measured ${(20 * Math.log10(g)).toFixed(2)} dB`); }
{ const n = FLMFX[32].p.length;
  const a = await render([`insertDevice 0 0 ${FLMFX_BASE + 32}`, `devParam 0 0 3 0.8`, `devParam 0 0 ${n + 1} 0`]);
  let d = 0; for (let i = 0; i < a.L.length; i++) d = Math.max(d, Math.abs(a.L[i] - dry.L[i])); ok(d === 0, `rack Mix 0 = the module bypassed (dry passes unchanged, max diff ${d})`);
  const b = await render([`insertDevice 0 0 ${FLMFX_BASE + 20}`, `devParam 0 0 1 0.738`, `devParam 0 0 ${FLMFX[20].p.length} 0.75`]);
  const g = rms(b.L, SR * 0.5, SR * 1.4) / rms(dry.L, SR * 0.5, SR * 1.4), want = Math.pow(10, (-60 + 72 * Math.pow(0.738, 0.6)) / 20) * Math.pow(10, (-20 + 40 * 0.75) / 20);
  ok(Math.abs(g / want - 1) < 0.01, `Post Gain 0.75 = +10 dB on top of the module (${(20 * Math.log10(g)).toFixed(2)} dB)`); }
{ const a = await render([`insertDevice 0 0 ${FLMFX_BASE + 6}`, 'devParam 0 0 0 0']);
  let d = 0; for (let i = 0; i < a.L.length; i++) d = Math.max(d, Math.abs(a.L[i] - dry.L[i])); ok(d === 0, `module On = 0 passes the dry signal (max diff ${d})`); }
ok(dryR > 0.01, `the test signal plays (${dryR.toFixed(3)} rms)`);
// JS fallback engine: no FLM modules, but their place in the chain is kept
{ const d = makeDevice(FLMFX_BASE + 32, SR), L = Float32Array.from([0.5, -0.25]), R = Float32Array.from([0.1, 0.2]);
  d.setParam(3, 0.9); d.process(L, R, 2); ok(L[0] === 0.5 && R[1] === Math.fround(0.2) && makeDevice(299, SR) === null, 'JS fallback: an FLM module is a pass-through placeholder (later devices keep their index)'); }
// pickers: the merged ones are not offered twice
{ const g = FX_GROUPS.find((x) => x[0] === 'flm'), names = g[2].map((t) => DEVICES[t].name);
  ok(names.includes('Pitcher 2') && names.includes('Comb Filter') && names.includes('Multi FX') && !names.includes('Reverb') && !names.includes('Compressor'), 'browser offers the FLM modules MobileDAW has no counterpart for: ' + names.join(', ')); }
// import
ok(FLM_TYPES[25].name === 'Pitcher' && FLM_TYPES[41].name === 'Waveshaper' && FLM_TYPES[11].name === 'Chorus' && FLM_TYPES[44].name === 'Spreader', 'FLM type ids named as Honeydew does (25 Pitcher, 41 Waveshaper, 11 Chorus, 44 Spreader)');
{ const p = FLMFX[32].p.map((x) => x.d); p[3] = 0.42; p[7] = 0.9;
  const r = decide({ name: 'Reverb', flmType: 32, params: p, mix: 0.6, postGain: 0.7, wetPan: 0.3, enabled: true }, 'map'), n = p.length;
  ok(r.apply && r.type === 132 && r.how === 'exact' && !r.bypass && r.params[3] === 0.42 && r.params[7] === 0.9 && r.params[n] === 0.7 && r.params[n + 1] === 0.6 && r.params[n + 2] === 0.3, 'FLM Reverb imports as the Reverb module itself with its exact values + Post Gain / Mix / Wet Pan');
  const off = decide({ name: 'Reverb', flmType: 32, params: [0, ...p.slice(1)], enabled: false }, 'none');
  ok(off.apply && off.bypass && off.params[0] === 1, 'off in the file: imported bypassed (the module On stays 1 inside), also with replace mode "none"');
  const nt = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1].map(Boolean), pi = decide({ name: 'Pitcher', flmType: 25, params: FLMFX[25].p.map((x) => x.d), notes: nt }, 'map'), m = FLMFX[25].p.length;
  ok(pi.type === 125 && nt.every((b, k) => pi.params[m + 3 + k] === (b ? 1 : 0)), 'Pitcher: its note enables (CSTM) arrive as the device notes');
  const un = decide({ name: 'Efek FLM #99', flmType: 99, params: [1, 0.5] }, 'map'); ok(!un.apply, 'an FLM type MobileDAW does not run stays a placeholder'); }
{ const json = { tracks: [{ id: 't1', devices: [{ id: 'd1', type: 132, params: [], from: { name: 'Reverb' } }] },
  { id: 'a1', name: 'A • x', flmAuto: { param: 32705, label: 'Mix : Reverb' }, target: { strip: 't1', devId: 'd1' }, clips: [{ pts: [{ t: 0, v: 0.25 }] }] },
  { id: 'a2', name: 'B • x', flmAuto: { param: 3, label: 'Mix' }, target: { strip: 't1', devId: 'd1' }, clips: [{ pts: [{ t: 0, v: 0.5 }] }] }] };
  resolveFlmAutomation(json, { skipped: [] }); const n = FLMFX[32].p.length, a1 = json.tracks.find((t) => t.id === 'a1'), a2 = json.tracks.find((t) => t.id === 'a2');
  ok(a1 && a1.target.param === n + 1 && a1.clips[0].pts[0].v === 0.25 && a2 && a2.target.param === 3 && a2.clips[0].pts[0].v === 0.5, 'FLM automation: rack Mix (0x7FC1) -> the module Mix, param 3 -> the module param 3, values unchanged'); }
console.log(bad ? `\n${bad} FAILED` : '\nALL FLM FX TESTS PASSED');
process.exit(bad ? 1 : 0);
