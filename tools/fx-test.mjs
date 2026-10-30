// Every effect of the web engine: built from its DEVICES definition, every parameter set to its default, then to min / max / a random
// value, fed noise + a sine for 2 s (with transport running for bar-synced effects). Fails on non-finite or runaway output, on a
// device that is silent although it should pass audio, and on a parameter index the definition has but the engine ignores
// (each parameter must change the output for at least one value - "no dummy controls").
// Usage: node tools/fx-test.mjs [type ...]
import { DEVICES } from '../js/defs.js';
import { makeDevice } from '../js/engine/fx.js';

const SR = 48000, N = 128, BLOCKS = Math.round(SR * 1.2 / N);
const want = process.argv.slice(2).map(Number), types = Object.keys(DEVICES).map(Number).filter((t) => !want.length || want.includes(t));
// parameters that cannot change the audio by design: display / meter options, momentary triggers, the Tuner reference
const NO_AUDIO = { 13: 'all', 12: 'all', 16: 'all', 30: 'all', 19: [15], 0: [] };
// conditions a parameter needs before it can be heard (Live works the same: L Time only counts with Sync off, R only without Link ...)
const PRE = {
  17: { 2: { 0: 0 }, 3: { 0: 1 }, 4: { 8: 0, 5: 6 }, 5: { 8: 0 }, 6: { 8: 0, 4: 0 }, 7: { 8: 0 }, 8: { 5: 6 }, 14: { 16: 1 } },
  19: { 14: { 2: 1 } }, 21: { 14: { 6: 1 } }, 22: { 3: { 2: 1 } },
  23: { 0: {}, 1: { 0: -12 }, 2: { 0: -12 }, 3: { 0: -12 }, 4: { 0: -12 }, 5: { 0: -12 }, 6: { 0: -12 } },
  25: { 3: { 2: 9 } }, 27: { 3: { 4: 1 }, 5: { 4: 1 }, 6: { 4: 1, 3: 3 } },
};
let bad = 0, seed = 1;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
function render(type, set, opts = {}) {
  const d = makeDevice(type, SR, new Float32Array(128).fill(0.5)); if (!d) return null;   // sc: sidechain levels per strip (Autoduck)
  if (d.setTempo) d.setTempo(120);
  DEVICES[type].params.forEach((p, k) => d.setParam(k, p.def));
  set(d);
  const L = new Float32Array(N), R = new Float32Array(N); let e = 0, peak = 0, beat = 0, ph = 0;
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
    if (!changed && !skip) issues.push(`${p.n} has no audible effect`);
  });
  if (issues.length) { bad++; console.log(`FAIL ${t} ${def.name}: ${issues.join('; ')}`); } else console.log(`ok   ${t} ${def.name}`);
}
console.log(bad ? `\n${bad} device(s) FAILED` : '\nALL EFFECTS OK');
process.exit(bad ? 1 : 0);
