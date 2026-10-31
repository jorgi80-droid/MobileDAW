// Every Live 12 instrument (defs.js full: true): all parameters at default, then each one at min / max / a middle value, a chord played and
// released over 1.5 s. Fails on non-finite or runaway output, on silence, and on a parameter that never changes the output (no dummy controls).
// PRE = conditions a parameter needs (as in Live: Osc 2 Detune is only heard with Osc 2 up); NO_AUDIO = parameters that cannot change the sound.
// Usage: node tools/inst-test.mjs [type ...]
import { INSTRUMENTS } from '../js/defs.js';
import { makeInstrument } from '../js/engine/instruments.js';

const SR = 48000, N = 128, BLOCKS = Math.round(SR * 1.5 / N);
const PRE = {
  13: { 3: { 4: 1 }, 4: { 2: 0.3 }, 7: { 16: -6 }, 8: { 9: 1 }, 10: { 11: 1 }, 15: { 16: -6 }, 17: { 16: -6 }, 21: { 16: -6 }, 46: { 11: 1 }, 5: { 16: -6 }, 6: { 16: -6 },
    27: { 28: 1 }, 29: { 30: 1 }, 28: { 22: 1000 }, 30: { 22: 1000 }, 39: { 9: 1 }, 35: { 9: 1 }, 36: { 9: 1 }, 37: { 9: 1 }, 38: { 9: 1 },
    40: { 11: 1 }, 41: { 11: 1 }, 42: { 11: 1, 41: 0 }, 43: { 11: 1 }, 44: { 11: 1, 41: 2 }, 45: { 11: 1, 41: 3 }, 46: { 11: 1 }, 47: { 11: 1 }, 48: { 11: 1, 49: 1 }, 49: { 11: 1 },
    51: { 50: 0 }, 53: { 50: 1, 54: 100 }, 54: { 50: 1 }, 58: {}, 59: { 60: 7, 61: 1 }, 60: { 61: 1 }, 61: { 60: 7 }, 62: { 63: 7, 64: 1 }, 63: { 64: 1 }, 64: { 63: 7 }, 65: { 66: 7, 67: 1 }, 66: { 67: 1 }, 67: { 66: 7 } },
};
// Operator: C / D are silent by default (level -inf), Freq / Multi count only with Fixed, the filter controls only with the filter on
PRE[14] = { 69: {}, 70: { 69: 1, 71: 2000 }, 71: { 69: 1 }, 72: { 69: 1, 71: 2000 }, 73: { 69: 1, 71: 500 }, 74: { 69: 1, 71: 500, 73: 1 }, 75: { 69: 1, 71: 500, 73: 1 } };
for (let o = 0; o < 4; o++) { const b = o * 16, up = o === 3 ? { [b + 6]: 0, 38: 0 } : o === 2 ? { [b + 6]: 0 } : {};  /* D is heard through C (algorithm 1) */ for (let k = 0; k < 16; k++) PRE[14][b + k] = { ...up }; PRE[14][b + 4] = { ...up, [b + 3]: 1 }; PRE[14][b + 5] = { ...up, [b + 3]: 1 }; PRE[14][64 + o] = { ...up, [b + 11]: 30, [b + 12]: -40 }; }
const NO_AUDIO = { 13: [58, 53], 14: [82] };    // PB Range: only heard with the pitch wheel, Legato: only with overlapping notes (both tested below)
const want = process.argv.slice(2).map(Number), types = Object.keys(INSTRUMENTS).map(Number).filter((t) => INSTRUMENTS[t].full && (!want.length || want.includes(t)));
let bad = 0;
function render(t, set, notes = [48, 55, 64]) {
  const d = makeInstrument(t, SR); d.setTempo && d.setTempo(120); INSTRUMENTS[t].params.forEach((p, k) => d.setParam(k, p.def)); set(d);
  const L = new Float32Array(N), R = new Float32Array(N), out = new Float32Array(BLOCKS * N * 2); let e = 0, peak = 0;
  notes.forEach((p, j) => d.noteOn(p, [0.9, 0.6, 0.35][j % 3]));
  for (let b = 0; b < BLOCKS; b++) {
    if (b === Math.round(BLOCKS * 0.6)) notes.forEach((p) => d.noteOff(p));
    L.fill(0); R.fill(0); d.render(L, R, 0, N);
    for (let i = 0; i < N; i++) { const v = L[i] + R[i]; if (!Number.isFinite(v)) return { bad: 'non-finite' }; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); e += L[i] * L[i] + R[i] * R[i]; out[(b * N + i) * 2] = L[i]; out[(b * N + i) * 2 + 1] = R[i]; }
  }
  return { e, peak, out, d };
}
const diff = (a, b) => { let s = 0; for (let i = 0; i < a.out.length; i++) { const x = a.out[i] - b.out[i]; s += x * x; } return s / (a.e + 1e-9); };
for (const t of types) {
  const def = INSTRUMENTS[t], base = render(t, () => {});
  if (base.bad || base.peak > 4 || base.e < 1e-3) { bad++; console.log(`FAIL ${t} ${def.name}: defaults ${base.bad || (base.e < 1e-3 ? 'silent' : 'peak ' + base.peak.toFixed(2))}`); continue; }
  const issues = [];
  def.params.forEach((p, k) => {
    if (p.hidden || (NO_AUDIO[t] || []).includes(k)) return;
    const pre = (d) => { for (const [j, v] of Object.entries((PRE[t] || {})[k] || {})) d.setParam(+j, v); };
    const r0 = render(t, (d) => { pre(d); d.setParam(k, p.def); }); let changed = false;
    for (const v of [p.min, p.max, p.min + (p.max - p.min) * 0.37]) { const r = render(t, (d) => { pre(d); d.setParam(k, v); }); if (r.bad || r.peak > 8) { issues.push(`${p.n}=${v}: ${r.bad || 'peak ' + r.peak.toFixed(1)}`); continue; } if (diff(r, r0) > 1e-6) changed = true; }
    if (!changed) issues.push(`${p.n} has no audible effect`);
  });
  if (issues.length) { bad++; console.log(`FAIL ${t} ${def.name}: ${issues.join('; ')}`); } else console.log(`ok   ${t} ${def.name} (${def.params.length} parameters)`);
}
// Operator PB Range
if (types.includes(14)) { const a = render(14, (d) => { d.setBend(2); d.setParam(82, 0); }), b = render(14, (d) => { d.setBend(2); d.setParam(82, 12); }); if (diff(a, b) < 1e-6) { bad++; console.log('FAIL 14 Operator: PB Range'); } else console.log('ok   14 Operator pitch bend range'); }
// Drift PB Range: the wheel moves the pitch by PB Range / 2 per unit (the UI wheel sends +-2 semitones)
if (types.includes(13)) {
  const a = render(13, (d) => { d.setBend(2); d.setParam(58, 0); }), b = render(13, (d) => { d.setBend(2); d.setParam(58, 12); });
  if (diff(a, b) < 1e-6) { bad++; console.log('FAIL 13 Drift: PB Range does not change the bent pitch'); } else console.log('ok   13 Drift pitch bend range');
}
// Drift Legato (Mono): a second note while the first is held does not restart the envelopes
if (types.includes(13)) {
  const leg = (on) => { const d = makeInstrument(13, SR); INSTRUMENTS[13].params.forEach((p, k) => d.setParam(k, p.def)); d.setParam(50, 1); d.setParam(53, on); d.setParam(31, 300);
    const L = new Float32Array(N), R = new Float32Array(N); let e = 0; d.noteOn(48, 0.9); for (let b = 0; b < 200; b++) { if (b === 100) d.noteOn(55, 0.9); L.fill(0); d.render(L, R, 0, N); if (b >= 100 && b < 110) for (const x of L) e += x * x; } return e; };
  const a = leg(0), b = leg(1); if (!(b > a * 1.5)) { bad++; console.log(`FAIL 13 Drift: Legato (retrigger ${a.toFixed(3)} vs legato ${b.toFixed(3)})`); } else console.log('ok   13 Drift legato');
}
console.log(bad ? `\n${bad} instrument(s) FAILED` : '\nALL INSTRUMENTS OK');
process.exit(bad ? 1 : 0);
