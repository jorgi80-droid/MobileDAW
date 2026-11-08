// Drum Sampler "Seq" settings (FL Studio Mobile Stepsequencer tab): Cut Group, Poly, Hold, Shift. Drives DrumSynth directly and checks the
// audible behaviour (not only JS = C++, which golden `inst-drumcut` covers): a cut group silences the other pads of its group (a 6 ms fade,
// no click), poly off makes a pad cut itself, hold ends a pad that long after the hit, shift delays the hit, defaults change nothing.
// Usage: node tools/drumseq-test.mjs
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DrumSynth } = await import(path.join(root, 'js/engine/instruments.js'));
const SR = 48000;
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };
const bank = () => { const n = SR * 3, l = new Float32Array(n); for (let i = 0; i < n; i++) l[i] = Math.sin(2 * Math.PI * 220 * i / SR) * 0.5; return [{ frames: n, rate: SR, l, r: l }]; };
const P = (d, pad, f, v) => d.setParam(200 + pad * 16 + f, v);
const goertzel = (x, a, b, f) => { const w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w); let s1 = 0, s2 = 0; for (let i = a; i < b; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; } return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / (b - a); };
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
// events: [seconds, 'on' | 'off', pitch]; returns { L, d }
function run(d, ev, sec, probe) {
  const n = Math.round(sec * SR), L = new Float32Array(n), R = new Float32Array(n), out = {}; let cur = 0;
  const todo = ev.slice().sort((a, b) => a[0] - b[0]).concat(probe ? probe.map((t) => [t, 'probe']) : []).sort((a, b) => a[0] - b[0]);
  for (const [t, k, p] of todo) { const f = Math.round(t * SR); while (cur < f) { const e = Math.min(f, cur + 256); d.render(L, R, cur, e); cur = e; } if (k === 'on') d.noteOn(p, 0.9); else if (k === 'off') d.noteOff(p); else out[t] = d.v.filter((o) => o.on).length; }
  while (cur < n) { const e = Math.min(n, cur + 256); d.render(L, R, cur, e); cur = e; }
  return { L, out };
}
const mk = (setup) => { const d = new DrumSynth(SR, bank(), null); setup(d); return d; };
// pad 6 (note 50) plays the 220 Hz sample; pad 7 (note 52) the same sample an octave up (440 Hz)
const base = (d) => { P(d, 6, 0, 0); P(d, 6, 11, 50); P(d, 7, 0, 0); P(d, 7, 11, 52); d.setParam(7 * 3 + 1, 12); };

// ---- cut group
{
  const hit = [[0, 'on', 50], [0.5, 'on', 52]], at = (r) => [Math.round(0.6 * SR), Math.round(0.8 * SR), r];
  const free = run(mk(base), hit, 1.2).L, cut = run(mk((d) => { base(d); P(d, 6, 12, 1); P(d, 7, 12, 1); }), hit, 1.2).L;
  const a = goertzel(free, 28800, 38400, 220), b = goertzel(cut, 28800, 38400, 220);
  ok(a > 0.05 && b < a * 0.02, `cut group: pad 6 is silenced by pad 7 of the same group (220 Hz ${a.toFixed(3)} -> ${b.toFixed(5)})`);
  ok(goertzel(cut, 28800, 38400, 440) > 0.05, 'cut group: the pad that cuts keeps playing');
  const other = run(mk((d) => { base(d); P(d, 6, 12, 1); P(d, 7, 12, 2); }), hit, 1.2).L;
  ok(goertzel(other, 28800, 38400, 220) > a * 0.8, 'different cut groups (A / B) do not silence each other');
  // the choke is a fade, not a cut: no sample-to-sample jump bigger than the signal itself
  let mx = 0; for (let i = 24000 + 1; i < 26400; i++) mx = Math.max(mx, Math.abs(cut[i] - cut[i - 1]));
  ok(mx < 0.2, `cut group: no click at the choke (largest step ${mx.toFixed(3)})`);
}
// ---- poly
{
  const re = [[0, 'on', 50], [0.3, 'on', 50]];
  const polyOn = run(mk(base), re, 0.6, [0.32]).out[0.32], polyOff = run(mk((d) => { base(d); P(d, 6, 13, 0); }), re, 0.6, [0.32]).out[0.32];
  ok(polyOn === 2, `poly on: a re-trigger overlaps itself (${polyOn} voices)`);
  ok(polyOff === 1, `poly off: a re-trigger cuts the previous hit (${polyOff} voice)`);
}
// ---- hold
{
  const one = [[0, 'on', 50]];
  const long = run(mk((d) => { base(d); P(d, 6, 9, 0); }), one, 0.6).L, held = run(mk((d) => { base(d); P(d, 6, 9, 0.01); P(d, 6, 14, 0.1); }), one, 0.6).L;
  ok(rms(long, 24000, 28000) > 0.1 && rms(held, 24000, 28000) < 0.001, `hold: the pad ends 0.1 s after the hit (0.5 s: ${rms(long, 24000, 28000).toFixed(3)} -> ${rms(held, 24000, 28000).toFixed(5)})`);
  ok(rms(held, 1000, 4000) > 0.1, 'hold: the hit itself plays normally');
  const cl = [[0, 'on', 39]];
  const clapFree = run(mk(() => {}), cl, 0.5, [0.3]).out[0.3], clapHold = run(mk((d) => P(d, 2, 14, 0.05)), cl, 0.5, [0.3]).out[0.3];
  ok(clapFree === 1 && clapHold === 0, `hold also ends a built-in sound (clap voices at 0.3 s: ${clapFree} -> ${clapHold})`);
}
// ---- shift
{
  const one = [[0, 'on', 50]];
  const s0 = run(mk(base), one, 0.3).L, s1 = run(mk((d) => { base(d); P(d, 6, 15, 0.05); }), one, 0.3).L;
  ok(rms(s0, 100, 2000) > 0.05 && rms(s1, 100, 2000) === 0, 'shift: the hit does not start before its delay');
  ok(rms(s1, 3000, 6000) > 0.05, 'shift: the hit starts after the delay');
}
// ---- defaults leave everything as it was
{
  const ev = [[0, 'on', 50], [0.2, 'on', 52], [0.4, 'on', 50], [0.6, 'on', 36], [0.8, 'on', 42]];
  const a = run(mk(base), ev, 1.2).L, b = run(mk((d) => { base(d); P(d, 6, 12, 0); P(d, 6, 13, 1); P(d, 6, 14, 0); P(d, 6, 15, 0); }), ev, 1.2).L;
  let same = true; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
  ok(same, 'defaults (no cut group, poly on, hold 0, shift 0) are bit-identical to before');
}
console.log(bad ? `\n${bad} FAILED` : '\nDRUM SEQ SETTINGS OK');
process.exit(bad ? 1 : 0);
