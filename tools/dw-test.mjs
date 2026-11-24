// DirectWave (type 30) on the C++ engine (native/engine/hddw.cpp, Honeydew's DW Sampler model), run as WebAssembly in Node: zones by key and
// velocity, pitch from the root, Loop / Reverse, the linear amp envelope (FLM's time law, level squared), the filter types, the frequency
// envelope, LFO to level, Mono legato glide, and the JS fallback engine has no DirectWave (C++ only). Usage: node tools/dw-test.mjs
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { loadWasmEngine } from './wasm-engine.mjs';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { makeInstrument } = await import(path.join(root, 'js/engine/instruments.js'));
const SR = 48000;
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const sine = (hz, sec) => Float32Array.from({ length: Math.round(SR * sec) }, (_, i) => 0.5 * Math.sin(2 * Math.PI * hz * i / SR));
const zc = (x, a, b) => { let n = 0, f = -1, l = -1; for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) { const t = i - 1 + x[i - 1] / (x[i - 1] - x[i]); if (f < 0) f = t; else n++; l = t; } return n > 0 ? n * SR / (l - f) : 0; };
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const goertzel = (x, a, b, f) => { const w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w); let s1 = 0, s2 = 0; for (let i = a; i < b; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; } return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / (b - a); };
// one engine, one DirectWave track; zones: [sample id, root, lo, hi, vlo, vhi, tune, loop]; params by index; notes [beat, len beats, key, vel]
async function render(zones, params, notes, sec, samples = [sine(440, 1)]) {
  const w = await loadWasmEngine(SR);
  const blob = []; let off = 0; const refs = samples.map((s) => { const r = `@${off}:${s.length}`; blob.push(s); off += s.length; return r; });
  const all = new Float32Array(off); let o = 0; for (const s of blob) { all.set(s, o); o += s.length; } w.setBlob(all);
  let txt = 'masterLimit 0\ntempo 120\ntrackVol 0 1\ntrackInst 0 30\n'; refs.forEach((r, i) => { txt += `sample ${i} ${r}\n`; });
  zones.forEach((z, k) => z.forEach((v, f) => { txt += `instParam 0 ${100 + k * 8 + f} ${v}\n`; }));
  for (const [i, v] of Object.entries(params)) txt += `instParam 0 ${i} ${v}\n`;
  const ev = []; for (const [b, l, k, v] of notes) ev.push(b * 960, l * 960, k, v, 0);
  txt += `trackNotes 0 [${ev.length} ${ev.join(' ')}] ${notes.length}\nsettle\nplay\n`;
  const er = w.cmd(txt); if (er) console.log('engine:', er.trim());
  const n = Math.round(sec * SR), L = new Float32Array(n), R = new Float32Array(n); w.render(L, R, n); return { L, R };
}
const Z = (o = {}) => [o.id ?? 0, o.root ?? 69, o.lo ?? 0, o.hi ?? 127, o.vlo ?? 1, o.vhi ?? 127, o.tune ?? 0, o.loop ?? 0];
// pitch: the root plays the sample as it is, +12 keys = double speed
{ const { L } = await render([Z()], {}, [[0, 1, 69, 1], [1, 1, 81, 1]], 1.0);
  const a = zc(L, 2000, 20000), b = zc(L, 26000, 44000); ok(Math.abs(a - 440) < 1 && Math.abs(b - 880) < 2, `root key plays the sample at its pitch (${a.toFixed(1)} Hz), +12 keys an octave up (${b.toFixed(1)} Hz)`); }
// zones: key and velocity ranges pick the zone
{ const S = [sine(440, 1), sine(660, 1)], zs = [Z({ id: 0, hi: 59 }), Z({ id: 1, lo: 60, vhi: 90 }), Z({ id: 0, lo: 60, vlo: 91 })];
  const { L } = await render(zs, {}, [[0, 0.5, 69, 0.5], [0.5, 0.5, 69, 1]], 0.6, S);
  const a = zc(L, 2000, 10000), b = zc(L, 14000, 22000); ok(Math.abs(a - 660) < 2 && Math.abs(b - 440) < 2, `key / velocity zones: soft note plays zone 2 (${a.toFixed(0)} Hz), hard note zone 3 (${b.toFixed(0)} Hz)`); }
// amp envelope: linear level, squared; Attack 0.5 s (FLM law: knob v plays 0.001 + 10 v^4 s)
{ const { L } = await render([Z({ loop: 1 })], { 2: 0.5 }, [[0, 2, 69, 1]], 0.8);
  const q = rms(L, 0.25 * SR - 480, 0.25 * SR + 480) / rms(L, 0.7 * SR - 480, 0.7 * SR + 480); ok(Math.abs(q - 0.25) < 0.03, `Attack 0.5 s: linear level, squared at the output (half way ${q.toFixed(3)} of full, expected 0.25)`); }
// loop: a 0.1 s sample keeps playing while the key is held; without loop it ends
{ const sh = [sine(440, 0.1)], on = await render([Z({ loop: 1 })], { 9: 1 }, [[0, 1, 69, 1]], 0.5, sh), off = await render([Z({ loop: 1 })], { 9: 0 }, [[0, 1, 69, 1]], 0.5, sh);
  ok(rms(on.L, 0.3 * SR, 0.4 * SR) > 0.1 && rms(off.L, 0.3 * SR, 0.4 * SR) < 1e-6, 'Loop on: a short sample sustains while held; off: it ends with the sample'); }
// reverse: a rising sweep plays falling
{ const sw = Float32Array.from({ length: SR }, (_, i) => 0.5 * Math.sin(2 * Math.PI * (200 * i / SR + 300 * (i / SR) ** 2)));
  const { L } = await render([Z()], { 8: 1 }, [[0, 1, 69, 1]], 0.9, [sw]); const a = zc(L, 1000, 6000), b = zc(L, 18000, 23000); ok(a > b * 1.25, `Reverse: the sweep plays backwards (${a.toFixed(0)} Hz at the start, ${b.toFixed(0)} Hz later)`); }
// filter: lowpass at a low cutoff removes the 5th harmonic of a saw-like sample; highpass removes the fundamental
{ const saw = Float32Array.from({ length: SR }, (_, i) => { let s = 0; for (let h = 1; h < 10; h++) s += Math.sin(2 * Math.PI * 220 * h * i / SR) / h; return 0.3 * s; });
  const dry = await render([Z({ root: 57 })], {}, [[0, 1, 57, 1]], 0.5, [saw]), lp = await render([Z({ root: 57 })], { 16: 1, 12: 40 }, [[0, 1, 57, 1]], 0.5, [saw]), hp = await render([Z({ root: 57 })], { 16: 2, 12: 60 }, [[0, 1, 57, 1]], 0.5, [saw]);
  const g = (x, f) => goertzel(x.L, 4800, 19200, f);
  ok(g(lp, 1100) < 0.05 * g(dry, 1100) && g(lp, 220) > 0.3 * g(dry, 220), 'Lowpass (cutoff 40 = 2^(4 + 4.16) = 286 Hz, 4 poles): 5th harmonic gone, the fundamental below the cutoff kept');
  ok(g(hp, 220) < 0.2 * g(dry, 220) && g(hp, 1980) > 0.5 * g(dry, 1980), 'Highpass (cutoff 60): fundamental cut, 9th harmonic kept'); }
// frequency envelope: amount +100 = up 4 octaves at the start, back to the key after the decay
{ const { L } = await render([Z({ loop: 1 })], { 26: 100, 22: 0, 23: 30, 24: 0 }, [[0, 2, 57, 1]], 1.0); const a = zc(L, 100, 600), b = zc(L, 0.8 * SR, 0.95 * SR); ok(a > 4 * b && Math.abs(b - 220) < 3, `Frequency envelope: starts ${(a / b).toFixed(1)} x higher, ends on the key (${b.toFixed(1)} Hz)`); }
// LFO to level: the loudness moves; Mono legato: the second key glides (Slide) without a restart
{ const { L } = await render([Z({ loop: 1 })], { 33: 2, 32: 100, 28: 4 }, [[0, 4, 69, 1]], 1.0); const a = rms(L, 0.3 * SR, 0.33 * SR), b = rms(L, 0.42 * SR, 0.45 * SR); ok(Math.abs(a - b) > 0.1 * Math.max(a, b), `LFO -> Level moves the loudness (${a.toFixed(3)} vs ${b.toFixed(3)})`); }
{ const { L } = await render([Z({ loop: 1 })], { 11: 1, 10: 1, 6: 0.1 }, [[0, 2, 57, 1], [0.5, 1.5, 69, 1]], 1.0); const a = zc(L, 0.26 * SR, 0.27 * SR), b = zc(L, 0.95 * SR, 0.99 * SR); ok(a > 230 && a < 400 && Math.abs(b - 440) < 3, `Mono + Legato: the held second key glides (${a.toFixed(0)} Hz on the way, ${b.toFixed(1)} Hz at the end)`); }
ok(makeInstrument(30, SR, [], []) === null, 'the JS fallback engine has no DirectWave (C++ only)');
console.log(bad ? `DIRECTWAVE: ${bad} failed` : 'DIRECTWAVE: all passed'); process.exit(bad ? 1 : 0);
