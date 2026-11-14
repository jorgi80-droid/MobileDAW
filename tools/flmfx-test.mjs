// FL Studio Mobile effect modules (device 100 + FLM id; C++ only: native/engine/hdfx.cpp + hdfx2.cpp, Honeydew's DSP) run as WebAssembly in
// Node, and their import: every module renders with its defaults, Leveller's gain law, the rack Mix 0 = bypass, Post Gain, the JS fallback
// keeps the chain's indices; FLM modules import with their exact values (Post Gain / Mix / Wet Pan, Pitcher notes, off = bypass) whatever the
// replace mode, and FLM automation lanes reach the module's own parameter. The DSP itself was checked against Honeydew's Rust code sample
// for sample (bit-identical for all but Multi FX, which reuses the double-precision GMSynth bank: within -90 dB). Usage: node tools/flmfx-test.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
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
ok(ids.length === 37 && ids.every((id) => DEVICES[FLMFX_BASE + id] && DEVICES[FLMFX_BASE + id].params.length >= FLMFX[id].p.length + 3), `${ids.length} FLM modules (32 effects + 5 note effects) defined as devices 100 + id (FLM params + Post Gain / Mix / Wet Pan)`);
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
// Comb Filter "MIDI Note" mode tunes to the notes of its own track (without notes it would sit at 1 Hz, as Manual with Pitch 0 and Snap off)
{ const C = FLMFX_BASE + 40, base = [`insertDevice 0 0 ${C}`, 'devParam 0 0 3 0.9', 'devParam 0 0 7 0'];
  const midi = await render([...base, 'devParam 0 0 1 0.5']), man = await render([...base, 'devParam 0 0 1 0', 'devParam 0 0 2 0']);
  let d = 0; for (let i = 0; i < midi.L.length; i++) d = Math.max(d, Math.abs(midi.L[i] - man.L[i]));
  ok(d > 0.01, `Comb Filter MIDI Note mode follows the track's notes (differs from the untuned comb by ${d.toFixed(3)})`); }
// the panel curves (js/flmviz.js FLM_RESP) against the engine: a sine through the module, its measured gain vs the drawn dB
{ const { FLM_RESP } = await import(path.join(root, 'js/flmviz.js'));
  const sineGain = async (hz, lines) => {
    const w = await loadWasmEngine(SR), n = SR * 2, x = Float32Array.from({ length: n }, (_, i) => 0.02 * Math.sin(2 * Math.PI * hz * i / SR)); w.setBlob(x);
    const er = w.cmd(`masterLimit 0\ntempo 120\ntrackVol 0 1\nsample 0 @0:${n}\ntrackClips 0 [7 0 7680 0 1 0 0 0] 1\n` + lines.join('\n') + '\nsettle\nplay\n'); if (er) console.log('engine:', er.trim());
    const L = new Float32Array(n), R = new Float32Array(n); w.render(L, R, n); return rms(L, SR, SR * 1.8);
  };
  const cases = [[103, { 1: 0.85, 2: 0.45, 3: 0.3, 4: 0.5, 5: 0.2, 6: 0.75, 7: 0.6, 8: 0.9 }], [107, { 1: 0.9, 3: 0.2, 5: 0.75, 8: 0.1 }], [130, { 2: 0.9, 4: 0.1, 6: 0.8, 9: 0.3 }],
    [109, { 1: 0.45, 2: 0.6, 3: 0, 4: 0.5 }], [109, { 1: 0.5, 3: 1, 4: 0 }], [140, { 3: 0.6, 4: 0.5, 7: 0, 2: 0.55 }]];
  const bads = []; let n = 0;
  for (const [t, vals] of cases) {
    const id = t - FLMFX_BASE, P = FLMFX[id].p.map((x) => x.d); for (const [k, v] of Object.entries(vals)) P[k] = v;
    const lines = [`insertDevice 0 0 ${t}`, ...Object.entries(vals).map(([k, v]) => `devParam 0 0 ${k} ${v}`)];
    for (const hz of [60, 150, 420, 1000, 2500, 7000]) {
      const dry = await sineGain(hz, []), wet = await sineGain(hz, lines), got = 20 * Math.log10(wet / dry), want = FLM_RESP[id]((i) => P[i], hz, SR); n++;
      if (Math.abs(got - want) > 0.5 && !(want < -40 && got < -40)) bads.push(`${FLMFX[id].name} ${hz} Hz: engine ${got.toFixed(2)} dB, panel ${want.toFixed(2)} dB`);
    }
  }
  ok(!bads.length, `panel curves = what the engine plays: ${n} sine gains of Equalizer / Graphic EQ / Tuned EQ / Filter / Comb within 0.5 dB` + (bads.length ? ': ' + bads.slice(0, 5).join('; ') : '')); }
// projects imported before: a placeholder and a stock replacement become the FLM modules, their automation moves to the module's params
{ const FXm = await import(path.join(root, 'js/import/fxmap.js')), { normOf } = await import(path.join(root, 'js/defs.js'));
  const lev = [1, 0.5, 0.3], gainDb = 20 * Math.log10(Math.pow(0.5 / 0.7071, 2)), ut = DEVICES[0].params[0];
  const json = { master: { devices: [] }, returns: [], tracks: [
    { id: 't1', kind: 'audio', devices: [{ id: 'd1', type: 0, params: [gainDb, -0.4], from: { name: 'FX Leveller', flmType: 20, params: lev, how: 'approx' } },
      { id: 'd2', type: 0, params: [], missing: { name: 'Reverb', flmType: 32, params: FLMFX[32].p.map((x) => x.d), enabled: true } }] },
    { id: 'a1', kind: 'auto', name: 'A \u2022 Gain', target: { kind: 4, strip: 't1', devId: 'd1', param: 0 }, clips: [{ pts: [{ t: 0, v: normOf(ut, gainDb) }] }] }] };
  const n = FXm.flmUpgradable(json), r = FXm.upgradeFlmJson(json), d1 = json.tracks[0].devices[0], d2 = json.tracks[0].devices[1], a1 = json.tracks[1];
  ok(n === 2 && r.devices === 2 && d1.id === 'd1' && d1.type === 120 && d1.params[1] === 0.5 && d1.params[2] === 0.3 && d2.type === 132 && !d2.missing,
    'old FLM import: placeholder and stock replacement become the FLM modules with the stored values (same device id)');
  ok(r.lanes === 1 && a1.target.param === 1 && Math.abs(a1.clips[0].pts[0].v - 0.5) < 1e-3 && FXm.flmUpgradable(json) === 0, `old FLM import: the Utility Gain lane moves back to Leveller Gain (${a1.clips[0].pts[0].v})`); }
// FL Studio Mobile Transistor Bass (instrument 34, C++ only; checked sample for sample against Honeydew's Rust code when ported)
{ const tb = async (notes, extra = []) => {
    const w = await loadWasmEngine(SR), ev = []; for (const [b, l, k, v] of notes) ev.push(b * 960, l * 960, k, v, 0);
    w.cmd(`masterLimit 0\ntempo 120\ntrackVol 0 1\ntrackInst 0 34\n${extra.join('\n')}\ntrackNotes 0 [${ev.length} ${ev.join(' ')}] ${notes.length}\nsettle\nplay\n`);
    const n = Math.round(1.2 * SR), L = new Float32Array(n), R = new Float32Array(n); w.render(L, R, n); return L; };
  const zc = (x, a, b) => { let n = 0, f = -1, l = -1; for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) { const t = i - 1 + x[i - 1] / (x[i - 1] - x[i]); if (f < 0) f = t; else n++; l = t; } return n > 0 ? n * SR / (l - f) : 0; };   // first to last rising crossing
  const soft = await tb([[0, 0.5, 45, 0.6]]), acc = await tb([[0, 0.5, 45, 0.9]]), open = await tb([[0, 2, 45, 0.6]], ['instParam 0 2 1', 'instParam 0 3 0', 'instParam 0 1 1']);
  ok(rms(soft, 0, SR * 0.2) > 0.005 && rms(acc, 0, SR * 0.2) > rms(soft, 0, SR * 0.2) * 1.2, `Transistor Bass plays; an accent (velocity >= 99/127) is louder (${(20 * Math.log10(rms(acc, 0, SR * 0.2) / rms(soft, 0, SR * 0.2))).toFixed(1)} dB)`);
  const f = zc(open, SR * 0.1, SR * 0.9), want = 440 * Math.pow(2, (45 - 81) / 12);
  ok(Math.abs(f / want - 1) < 0.03, `Transistor Bass pitch: key 45 plays ${f.toFixed(1)} Hz (Honeydew: 440 Hz at key 81 -> ${want.toFixed(1)} Hz)`);
  const { buildMdaw } = await import(path.join(root, 'js/import/build.js'));
  ok(decide !== null && (await import(path.join(root, 'js/import/fxmap.js'))).FLM_TYPES[19].synth === 'transistorbass', 'FLM module 19 is the Transistor Bass instrument'); void buildMdaw; }
// FL Studio Mobile 3x Osc (instrument 36, C++ only: native/engine/hd3osc.cpp; checked sample for sample against Honeydew's Rust code when ported, 35 cases)
{ const osc = async (notes, extra = []) => {
    const w = await loadWasmEngine(SR), ev = []; for (const [b, l, k, v] of notes) ev.push(b * 960, l * 960, k, v, 0);
    w.cmd(`masterLimit 0\ntempo 120\ntrackVol 0 1\ntrackInst 0 36\n${extra.join('\n')}\ntrackNotes 0 [${ev.length} ${ev.join(' ')}] ${notes.length}\nsettle\nplay\n`);
    const n = Math.round(1.2 * SR), L = new Float32Array(n), R = new Float32Array(n); w.render(L, R, n); return L; };
  const zc = (x, a, b) => { let n = 0, f = -1, l = -1; for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) { const t = i - 1 + x[i - 1] / (x[i - 1] - x[i]); if (f < 0) f = t; else n++; l = t; } return n > 0 ? n * SR / (l - f) : 0; };
  const one = await osc([[0, 2, 69, 0.8]], ['instParam 0 22 0', 'instParam 0 23 0']), fq = zc(one, SR * 0.1, SR * 0.9);
  ok(rms(one, 0, SR * 0.5) > 0.05 && Math.abs(fq / 440 - 1) < 0.002, `3x Osc plays: osc 1 alone, key 69 = ${fq.toFixed(2)} Hz (440)`);
  const oct = await osc([[0, 2, 69, 0.8]], ['instParam 0 22 0', 'instParam 0 23 0', 'instParam 0 13 0.75']), f2 = zc(oct, SR * 0.1, SR * 0.9);
  ok(Math.abs(f2 / 880 - 1) < 0.002, `3x Osc Coarse +12 (v = 0.75): ${f2.toFixed(2)} Hz (880)`);
  const off = await osc([[0, 2, 69, 0.8]], ['instParam 0 0 0']); ok(rms(off, 0, SR) === 0, '3x Osc Enable off: silent (voices frozen)');
  const arp = await osc([[0, 2, 60, 0.8]], ['instParam 0 139 0.2', 'instParam 0 145 0.0333333', 'instParam 0 140 0.7', 'instParam 0 22 0', 'instParam 0 23 0']);   // Time 0.7: 36 ticks = 3/8 beat a step
  const seg = (a) => zc(arp, a, a + Math.round(SR * 0.1)); const fs3 = [seg(Math.round(SR * 0.03)), seg(Math.round(SR * 0.22)), seg(Math.round(SR * 0.41))].map((x) => Math.round(12 * Math.log2(x / 440) + 69));
  ok(new Set(fs3).size >= 2 && fs3.join() === '60,64,67', `3x Osc Arpeggio Up on a major chord plays its notes (${fs3.join(', ')})`);
  const X = await import(path.join(root, 'js/fxlaw.js')), { THREE_OSC } = await import(path.join(root, 'js/flm3osc.js'));
  const FX3 = JSON.parse(fs.readFileSync(path.join(root, 'tools/fixtures/flm3osc-text.json'), 'utf8')).t; let n3 = 0, b3 = 0;
  THREE_OSC.p.forEach((x, k) => (FX3[k] || []).forEach((want, j) => { if (x.t === 'on' || x.t === 'tog') return; const v = Math.fround(j / 50);
    const got = x.t === 'list' ? x.items[X.menuItem(x.br, v)] : X.lawText(x.law, v, { bpm: 120, sr: 44100 }, 'i36.' + k); n3++; if (got !== want) { b3++; if (b3 < 5) console.log('  ', k, x.n, v, got, want); } }));
  ok(n3 > 5000 && b3 === 0, `3x Osc value texts as FL Studio Mobile prints them: ${n3 - b3} / ${n3} equal to Honeydew's`);
  const D = await import(path.join(root, 'js/defs.js')); ok(D.INSTRUMENTS[36].params.length === 150 && D.INSTRUMENTS[36].params[14].def === 0.25, '3x Osc: 149 FLM params (+ D), FLM defaults');
  ok((await import(path.join(root, 'js/import/fxmap.js'))).FLM_TYPES[39].synth === 'threeosc', 'FLM module 39 is the 3x Osc instrument'); }
// FL Studio Mobile note effects (devices 147..151, C++ only: native/engine/hdnfx.cpp; checked note for note against Honeydew's Rust code
// when ported): trackNoteFx before trackNotes reworks the track's notes. Played on the Transistor Bass (mono, known pitch law).
{ const play = async (fx, notes, sec = 1) => {
    const w = await loadWasmEngine(SR), ev = []; for (const [b, l, k, v] of notes) ev.push(b * 960, l * 960, k, v, 0);
    const er = w.cmd(`masterLimit 0\ntempo 120\ntrackVol 0 1\ntrackInst 0 34\ninstParam 0 2 1\ninstParam 0 3 0\ninstParam 0 1 1\n${fx}\ntrackNotes 0 [${ev.length} ${ev.join(' ')}] ${notes.length}\nsettle\nplay\n`);
    if (er) console.log('engine:', er.trim());
    const n = Math.round(sec * SR), L = new Float32Array(n), R = new Float32Array(n); w.render(L, R, n); return L; };
  const zc = (x, a, b) => { let n = 0, f = -1, l = -1; for (let i = Math.round(a) + 1; i < Math.round(b); i++) if (x[i - 1] < 0 && x[i] >= 0) { const t = i - 1 + x[i - 1] / (x[i - 1] - x[i]); if (f < 0) f = t; else n++; l = t; } return n > 0 ? n * SR / (l - f) : 0; };
  const hz = (k) => 440 * Math.pow(2, (k - 81) / 12);
  const tr = await play('insertDevice 0 0 148\ntrackNoteFx 0 [6 48 7 3 1 0.625 0.5] 8', [[0, 2, 45, 0.6]]);
  const f1 = zc(tr, SR * 0.1, SR * 0.9); ok(Math.abs(f1 / hz(57) - 1) < 0.02, `Transpose +1 octave: key 45 plays ${f1.toFixed(1)} Hz (key 57 = ${hz(57).toFixed(1)} Hz)`);
  const P = FLMFX[51].p.map((x) => x.d); P[10] = 2 / 23;                                           // Arp 1 mode Up, Rate 1/8 (0.5 beat = 0.25 s at 120 BPM)
  const arp = await play(`insertDevice 0 0 151\ntrackNoteFx 0 [${P.length + 3} 51 9 ${P.length} ${P.join(' ')}] 8`, [[0, 2, 45, 0.6], [0, 2, 49, 0.6], [0, 2, 52, 0.6]], 0.8);
  const a = [zc(arp, SR * 0.02, SR * 0.11), zc(arp, SR * 0.27, SR * 0.36), zc(arp, SR * 0.52, SR * 0.61)], want = [hz(45), hz(49), hz(52)];
  ok(a.every((x, k) => Math.abs(x / want[k] - 1) < 0.03), `Arpeggiator Up 1/8 over A-C#-E: ${a.map((x) => x.toFixed(1)).join(' / ')} Hz in turn (${want.map((x) => x.toFixed(1)).join(' / ')})`);
  const none = await play('insertDevice 0 0 151\ntrackNoteFx 0 [0] 8', [[0, 2, 45, 0.6]]);
  ok(Math.abs(zc(none, SR * 0.1, SR * 0.9) / hz(45) - 1) < 0.02, 'no note effect: the notes play as they are'); }
// FL Studio Mobile Slicer (instrument 35, C++ only; slices and audio checked against Honeydew's Rust code when ported): a loop of four
// tones cut at their attacks; key 48 + k plays slice k
{ const seg = [220, 330, 440, 550], len = Math.round(SR * 0.5), loop = new Float32Array(len * 4);
  seg.forEach((hz, k) => { for (let i = 0; i < len; i++) loop[k * len + i] = 0.7 * Math.exp(-i / (SR * 0.15)) * Math.sin(2 * Math.PI * hz * i / SR); });
  const play = async (key, extra = []) => {
    const w = await loadWasmEngine(SR); w.setBlob(loop);
    w.cmd(`masterLimit 0\ntempo 120\ntrackVol 0 1\nsample 0 @0:${loop.length}\ntrackInst 0 35\ninstParam 0 100 0\n${extra.join('\n')}\ntrackNotes 0 [5 0 960 ${key} 0.8 0] 1\nsettle\nplay\n`);
    const n = Math.round(0.45 * SR), L = new Float32Array(n), R = new Float32Array(n); w.render(L, R, n); return L; };
  const zc = (x, a, b) => { let n = 0, f = -1, l = -1; for (let i = Math.round(a) + 1; i < Math.round(b); i++) if (x[i - 1] < 0 && x[i] >= 0) { const t = i - 1 + x[i - 1] / (x[i - 1] - x[i]); if (f < 0) f = t; else n++; l = t; } return n > 0 ? n * SR / (l - f) : 0; };
  const got = []; for (let k = 0; k < 4; k++) got.push(zc(await play(48 + k), SR * 0.02, SR * 0.3));
  ok(got.every((x, k) => Math.abs(x / seg[k] - 1) < 0.01), `Slicer: keys 48..51 play the loop's four slices (${got.map((x) => x.toFixed(0)).join(' / ')} Hz)`);
  const up = zc(await play(49, ['instParam 0 1 0.75']), SR * 0.02, SR * 0.3);
  ok(Math.abs(up / (330 * 2) - 1) < 0.01, `Slicer Pitch +12 (FLM law trunc(48 v - 24)): slice 2 plays ${up.toFixed(0)} Hz`);
  const first = zc(await play(60, ['instParam 0 8 60']), SR * 0.02, SR * 0.3), past = rms(await play(52), 0, SR * 0.3);
  ok(Math.abs(first / 220 - 1) < 0.01 && past < 1e-6, `Slicer First Key 60 plays slice 1 there (${first.toFixed(0)} Hz); a key past the last slice plays nothing`); }
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
// value texts: FLM's own laws (js/fxlaw.js) against texts printed by Honeydew's Rust tables (tools/fixtures/flmfx-text.json: 13 values of every
// param of every module, tempo 120, 44.1 kHz, the module's defaults); the full 401-value sweep matched too when the fixture was made
{ const { lawText, menuItem } = await import(path.join(root, 'js/fxlaw.js')), fs = await import('node:fs');
  const FX = JSON.parse(fs.readFileSync(path.join(root, 'tools/fixtures/flmfx-text.json'), 'utf8')); let n = 0; const diffs = [];
  for (const [id, rows] of Object.entries(FX.t)) {
    const m = FLMFX[id], ctx = { p: m.p.map((x) => x.d), bpm: 120, sr: 44100 };
    rows.forEach((texts, i) => texts.forEach((want, j) => {
      const v = Math.fround(FX.k[j] / FX.n), p = m.p[i];
      const got = i === 0 || p.t === 'tog' ? (v >= 0.5 ? 'On' : 'Off') : p.t === 'list' ? p.items[menuItem(p.br, v)] : lawText(p.law, v, ctx, id + '.' + i);
      n++; if (got !== want) diffs.push(`${m.name} ${p.n} @${v}: "${got}" != "${want}"`);
    }));
  }
  ok(!diffs.length && n > 4000, `value texts as FL Studio Mobile prints them: ${n} texts equal to Honeydew's` + (diffs.length ? ': ' + diffs.slice(0, 4).join('; ') : '')); }
{ const { fmtParam } = await import(path.join(root, 'js/defs.js')), P = (t, i, v) => fmtParam(DEVICES[t].params[i], v);
  ok(P(135, 4, 0.068) === '1.5s' && P(120, 1, 0.738) === '0 dB' && P(106, 3, 1) === '0.0 dB' && P(129, 2, 0.1) === '25 ms', `knobs read FLM units (Reverb 2 Decay ${P(135, 4, 0.068)}, Leveller ${P(120, 1, 0.738)}, Distortion Gain ${P(106, 3, 1)}, Autoduck Attack at 120 BPM ${P(129, 2, 0.1)})`); }
// ---- FLM audio-clip details (Honeydew audio_clips.rs / read.rs): clip envelopes, whole-semitone Speed, project build
{
  const FI = await import(path.join(root, 'js/import/flm.js')), BI = await import(path.join(root, 'js/import/build.js')), PJ = await import(path.join(root, 'js/project.js'));
  const ev = (t, key, value) => ({ t, pitch: key < 0 ? 65536 + key : key, value });
  const E = FI.clipEnvs([ev(0, 1, 65535), ev(0.5, -1, 32768), ev(1, 1, 0), ev(0, 2, 0), ev(2, 3, 40000)]);
  ok(E.lvlEnv.length === 3 && Math.abs(E.lvlEnv[0][1] - FI.flmGain(1)) < 1e-12 && E.lvlEnv[2][1] === 0 && E.panEnv[0][1] === -1 && E.spdEnv === 1, 'clip envelopes: key +-1 Level (flmGain), +-2 Pan (-1..1), +-3 Speed counted');
  const law = (v) => Math.trunc(Math.fround(48 * Math.fround(v) - 24));
  ok(law(0.413333) === -4 && law(0.5) === 0 && law(0.52) === 0 && law(0.53) === 1 && law(0) === -24 && law(1) === 24, 'clip Speed: whole semitones, trunc(48 v - 24) (0.413333 -> -4, not -4.16)');
  const M = { app: 'FL Studio Mobile', name: 't', bpm: 120, sig: [4, 4], loop: [4, 12], warnings: [], channels: [{ kind: 'track', name: 'A', zipped: true, gain: 1, pan: 0, sends: [], modules: [], pads: [], tracks: [{ kind: 'audio', clips: [
    { pos: 0, len: 8, cycle: 0, offset: 0, sample: 'x.wav', name: 'x', pitch: 0, repitch: -4, stretch: 1, gain: 0.5, pan: 0, reverse: true, lvlEnv: [[0, 1], [2, 0]], panEnv: [[1, 0.5]] }] }] }] };
  const { json } = BI.buildMdaw(M, { root: '/r', resolve: (q) => q, relName: (e) => e });
  const t = json.tracks[0], c = t.clips[0];
  ok(json.loop.on && json.loop.start === 4 * 960 && json.loop.end === 12 * 960, 'project play loop (HEAD @272 / @280) -> loop region');
  ok(t.fold === true, 'zipped channel (CHHD @1024) -> folded track');
  ok(c.warp && c.warp.rev === true && c.warp.mode === 'repitch' && Math.abs(c.warp.ratio - Math.pow(2, 4 / 12)) < 1e-12, 'clip reverse + whole-semitone repitch -> warp');
  ok(c.genv.length === 2 && c.genv[1][0] === 1 && c.penv[0][0] === 0.5 && c.genvRef === c.gain, 'clip envelopes on the source time (seconds at the project tempo)');
  const F = PJ.clipEnvFlat(c);
  ok(F.length === 9 && F[1] === 1 && F[4] === 0.5 && F[5] === 0.5 && F[7] === 0 && F[8] === 0.5 && F[2] === 0, 'engine points: Level and Pan read at every point of either (linear, clip pan before the first)');
  const F2 = PJ.clipEnvFlat({ ...c, gain: c.gain * 2 }); ok(Math.abs(F2[1] - 2) < 1e-12 && Math.abs(F2[4] - 1) < 1e-12, 'the clip Gain knob scales the Level envelope');
}
console.log(bad ? `\n${bad} FAILED` : '\nALL FLM FX TESTS PASSED');
process.exit(bad ? 1 : 0);
