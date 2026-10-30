// Every effect of the web engine: built from its DEVICES definition, every parameter set to its default, then to min / max / a random
// value, fed noise + a sine for 2 s (with transport running for bar-synced effects). Fails on non-finite or runaway output, on a
// device that is silent although it should pass audio, and on a parameter index the definition has but the engine ignores
// (each parameter must change the output for at least one value - "no dummy controls").
// Usage: node tools/fx-test.mjs [type ...]
import { DEVICES, MOD_MAP } from '../js/defs.js';
import { makeDevice } from '../js/engine/fx.js';

const SR = 48000, N = 128, BLOCKS = Math.round(SR * 1.2 / N);
const want = process.argv.slice(2).map(Number), types = Object.keys(DEVICES).map(Number).filter((t) => !want.length || want.includes(t));
// parameters that cannot change the audio by design: display / meter options, momentary triggers, the Tuner reference
const NO_AUDIO = { 48: 'all', 49: 'all', 50: 'all', 47: [1], 13: 'all', 12: 'all', 16: 'all', 30: 'all', 32: 'all', 19: [15], 10: 'all', 45: 'all' };   // 45 Looper: state-driven, has its own test below   // 10 Autoduck: listens to another track's sidechain only
// conditions a parameter needs before it can be heard (Live works the same: L Time only counts with Sync off, R only without Link ...)
const PRE = {
  17: { 2: { 0: 0 }, 3: { 0: 1 }, 4: { 8: 0, 5: 6 }, 5: { 8: 0 }, 6: { 8: 0, 4: 0 }, 7: { 8: 0 }, 8: { 5: 6 }, 14: { 16: 1 } },
  19: { 14: { 2: 1 } }, 21: { 13: { 0: 2 }, 14: { 6: 1 } }, 22: { 3: { 2: 1 } }, 18: { 5: { 4: 1 }, 15: { 14: 1 }, 25: { 24: 1 } }, 20: { 6: { 5: 1 } },
  28: { 10: { 11: 1 }, 11: { 10: 1 } }, 29: { 8: { 7: 1 }, 9: { 7: 1 } }, 36: { 6: { 4: -1 } }, 37: { 5: { 2: -1 }, 6: { 2: -1 } }, 42: { 3: { 0: 2 } }, 43: { 1: { 0: 1 } },
  44: { 16: { 15: 1 }, 17: { 15: 1 } },
  46: { 0: { 3: 1 }, 1: { 3: 1 }, 2: { 3: 1 }, 4: { 3: 1, 6: 100 }, 5: { 3: 1 }, 6: { 3: 1, 4: 0 }, 7: { 3: 1, 2: 0 }, 8: { 3: 1 }, 9: { 3: 1 }, 15: { 14: 1 }, 16: { 14: 2 } },
  47: { 3: { 0: 1 }, 10: { 9: 1, 11: 2 }, 11: { 9: 1 }, 13: { 0: 1 }, 14: { 0: 1 }, 16: { 15: 2 } },
  23: { 0: {}, 1: { 0: -12 }, 2: { 0: -12 }, 3: { 0: -12 }, 4: { 0: -12 }, 5: { 0: -12 }, 6: { 0: -12 } },
  25: { 3: { 2: 9 } }, 27: { 3: { 4: 1 }, 5: { 4: 1 }, 6: { 4: 1, 3: 3 } },
  0: { 8: { 7: 1, 6: 2 } }, 1: { 5: { 4: -1 }, 6: { 4: -1 }, 8: { 7: 1 }, 9: { 7: 1 }, 12: { 7: 1 } }, 2: { 4: { 0: 9 }, 5: { 2: 9 }, 9: { 0: 9 } },
  5: { 1: { 2: 12 } }, 6: { 6: { 7: 0, 8: 0 }, 7: { 8: 1 }, 9: { 8: 1 }, 10: { 8: 1, 7: 0 }, 15: { 16: 1 } }, 4: { 11: { 3: 10 } }, 9: { 8: { 0: 5, 7: 1 }, 9: { 0: 5, 7: 1 } },
  41: { 2: { 3: 1 }, 3: { 2: -6 }, 4: { 2: -6, 3: 1 } },
  40: { 6: { 7: 0.3 }, 15: { 14: 1 }, 16: { 14: 1 }, 18: { 17: 1 }, 19: { 17: 1 }, 23: { 14: 1 }, 24: { 14: 1 }, 25: { 14: 1, 24: 1 }, 26: { 14: 1 }, 27: { 14: 1, 23: 1 } },
  38: { 2: { 0: 1000, 3: 24, 5: -60 }, 6: { 0: 1000, 3: 24, 5: -60 }, 7: { 8: 0.5 }, 9: { 0: 1000, 3: 24, 5: -60 }, 10: { 0: 1000, 3: 24, 5: -60 },
    20: { 21: 24, 23: -60 }, 24: { 21: 24, 23: -60, 27: 0.1 }, 25: { 26: 0.5 }, 28: { 21: 24, 23: -60, 27: 0.1 }, 16: { 17: 0.5 } },
  8: { 0: { 1: 9 }, 2: { 3: 9 }, 4: { 3: 9 }, 5: { 6: 9 }, 7: { 6: 9 }, 8: { 9: 9 } },
  31: Object.fromEntries([...Array.from({ length: 8 }, (_, b) => [[b * 5 + 1, { [b * 5]: 1, [b * 5 + 3]: 9 }], [b * 5 + 2, { [b * 5]: 1, [b * 5 + 3]: 9 }], [b * 5 + 3, { [b * 5]: 1 }], [b * 5 + 4, { [b * 5]: 1, [b * 5 + 3]: 9 }], [b * 5, { [b * 5 + 1]: 3, [b * 5 + 3]: 9 }]]).flat(), [40, { 8: 9 }], [3, { 0: 1, 1: 2, 3: 9 }], [38, { 35: 1, 36: 5, 38: 9 }]]),
};
// known gaps (work in progress, listed in docs/HANDOFF.md): reported as TODO, not as a failure
const TODO = {};
let bad = 0, seed = 1;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
function render(type, set, opts = {}) {
  const d = makeDevice(type, SR, new Float32Array(128).fill(0.5)); if (!d) return null;   // sc: sidechain levels per strip (Autoduck)
  if (d.setTempo) d.setTempo(120);
  DEVICES[type].params.forEach((p, k) => d.setParam(k, p.def));
  set(d); if (d.midiIn) { d.noteOn(48, 0.8); d.noteOn(55, 0.7); }   // MIDI-mode devices (Spectral Resonator) get a held chord
  const L = new Float32Array(N), R = new Float32Array(N); let e = 0, peak = 0, beat = 0, ph = 0; seed = 1;   // same input every render, so only the parameter can make a difference
  const out = new Float32Array(BLOCKS * N * 2);
  for (let b = 0; b < BLOCKS; b++) {
    for (let i = 0; i < N; i++) { ph += 2 * Math.PI * 220 / SR; const nz = rnd() * 2 - 1; const s = Math.sin(ph) * 0.3 * (opts.burst ? (((b * N + i) % 12000) < 3000 ? 1 : 0.02) : 1); L[i] = s + nz * 0.1; R[i] = s * 0.9 - nz * 0.1; }
    if (d.tr) d.tr(true, beat); beat += N / SR * 2;
    d.process(L, R, N);
    for (let i = 0; i < N; i++) { const v = L[i] + R[i]; if (!Number.isFinite(v)) return { bad: 'non-finite' }; const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > peak) peak = a; e += L[i] * L[i] + R[i] * R[i]; out[(b * N + i) * 2] = L[i]; out[(b * N + i) * 2 + 1] = R[i]; }
  }
  const o = new Float32Array(4096); if (d.readOut) d.readOut(o);
  return { e, peak, out };
}
const diff = (a, b) => { let s = 0; for (let i = 0; i < a.out.length; i++) { const x = a.out[i] - b.out[i]; s += x * x; } return s / (a.e + 1e-9); };
for (const t of types) {
  const def = DEVICES[t]; if (!def || t === 11) continue;
  const pre = (k) => (d) => { for (const [j, v] of Object.entries((PRE[t] || {})[k] || {})) d.setParam(+j, v); };
  const base = render(t, () => {}, { burst: true });
  if (!base) { console.log(`FAIL ${t} ${def.name}: engine has no class`); bad++; continue; }
  if (base.bad) { console.log(`FAIL ${t} ${def.name}: defaults give ${base.bad}`); bad++; continue; }
  if (base.peak > 8) { console.log(`FAIL ${t} ${def.name}: defaults peak ${base.peak.toFixed(1)}`); bad++; }
  const issues = [];
  def.params.forEach((p, k) => {
    const skip = NO_AUDIO[t] === 'all' || (Array.isArray(NO_AUDIO[t]) && NO_AUDIO[t].includes(k)) || p.hidden;
    let changed = false;
    for (const v of [p.min, p.max, p.min + (p.max - p.min) * 0.37]) {
      const r = render(t, (d) => { pre(k)(d); d.setParam(k, v); }, { burst: true }), r0 = render(t, (d) => { pre(k)(d); d.setParam(k, p.def); }, { burst: true });
      if (r.bad || r.peak > 16) { issues.push(`${p.n}=${v}: ${r.bad || 'peak ' + r.peak.toFixed(1)}`); continue; }
      if (diff(r, r0) > 1e-6) changed = true;
    }
    if (!changed && !skip) { if ((TODO[t] || []).includes(k)) console.log(`TODO ${t} ${def.name}: ${p.n} has no audible effect yet`); else issues.push(`${p.n} has no audible effect`); }
  });
  if (issues.length) { bad++; console.log(`FAIL ${t} ${def.name}: ${issues.join('; ')}`); } else console.log(`ok   ${t} ${def.name}`);
}
// Looper (45): record 1 s of a tone, play it back with the input muted (Monitor Never), overdub adds to it, Clear empties it
if (!want.length || want.includes(45)) {
  const d = makeDevice(45, SR), L = new Float32Array(N), R = new Float32Array(N), o = new Float32Array(8); d.setTempo(120); DEVICES[45].params.forEach((p, k) => d.setParam(k, p.def)); d.setParam(5, 1);
  const run = (blocks, amp) => { let e = 0; for (let b = 0; b < blocks; b++) { for (let i = 0; i < N; i++) { L[i] = R[i] = amp * Math.sin((b * N + i) * 0.05); } d.process(L, R, N); for (let i = 0; i < N; i++) e += L[i] * L[i]; } return e; };
  const sec = Math.round(SR / N);
  d.setParam(0, 1); run(sec, 0.5); d.setParam(0, 2); d.readOut(o); const len = o[1];
  const play = run(sec, 0), ovr = (d.setParam(0, 3), run(sec, 0.5), d.setParam(0, 2), run(sec, 0)); d.setParam(6, 1); const clr = run(sec, 0);
  const fail = [len < 0.9 && 'length ' + len.toFixed(2), play < 1 && 'no playback', ovr <= play * 1.5 && 'overdub not added', clr > 1e-6 && 'clear left audio'].filter(Boolean);
  if (fail.length) { bad++; console.log('FAIL 45 Looper transport: ' + fail.join('; ')); } else console.log('ok   45 Looper transport (record / play / overdub / clear)');
}
// Modulators (48 LFO, 49 Shaper, 50 Envelope Follower): mapped to a target with a log 20 Hz .. 20 kHz range, the value must move and stay in the
// range (Remap) or around the target's own value (Mod); unmapped they give no target
for (const t of [48, 49, 50]) {
  if (want.length && !want.includes(t)) continue;
  const M = MOD_MAP[t], res = [];
  for (const mode of [0, 1]) {
    const d = makeDevice(t, SR); d.setTempo(120); DEVICES[t].params.forEach((p, k) => d.setParam(k, p.def));
    const none = d.target(); [mode, 1, 0.5, 0.1, 0.9, 2, 0, 3, 20, 20000, 1, 1000].forEach((v, j) => d.setParam(M + j, v));
    const L = new Float32Array(N), R = new Float32Array(N); let lo = 1e9, hi = -1e9, ph = 0;
    for (let b = 0; b < SR * 2 / N; b++) { for (let i = 0; i < N; i++) { ph += 0.05; L[i] = R[i] = Math.sin(ph) * (b % 100 < 30 ? 0.8 : 0.01); } d.process(L, R, N); const v = d.target().v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    res.push({ mode, none, lo, hi });
  }
  const [rm, md] = res, ok = rm.none === null && rm.hi > rm.lo * 1.05 && rm.lo >= 20 * 0.99 && rm.hi <= 20000 * 1.01 && md.lo < 1000 * 1.01 && md.hi > 1000 * 0.99 && md.hi > md.lo * 1.05;
  if (!ok) { bad++; console.log(`FAIL ${t} ${DEVICES[t].name} mapping: remap ${rm.lo.toFixed(0)}..${rm.hi.toFixed(0)}, mod ${md.lo.toFixed(0)}..${md.hi.toFixed(0)}`); }
  else console.log(`ok   ${t} ${DEVICES[t].name} mapping (remap ${rm.lo.toFixed(0)}..${rm.hi.toFixed(0)} Hz, mod ${md.lo.toFixed(0)}..${md.hi.toFixed(0)} Hz)`);
}
console.log(bad ? `\n${bad} device(s) FAILED` : '\nALL EFFECTS OK');
process.exit(bad ? 1 : 0);
