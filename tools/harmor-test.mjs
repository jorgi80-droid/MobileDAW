// Harmor (instrument 38, native/engine/harmor.cpp) audio tests on the WebAssembly build of the engine (the same code the web app and the
// Android native engine run). Known signals in, measured audio out: no test looks at the UI.
//   fundamental frequency, harmonic distribution (saw 1/k, square odd 1/k, triangle odd 1/k^2, sine), partial phase (shift-invariant
//   phi_k - k phi_1), drawn harmonic table (level + phase) through the sample bank, timbre mix vs morph, phase randomisation (same
//   magnitudes, different waveform), partial count + quality caps, no aliasing near Nyquist, sub-octave partials, stretch, polyphony /
//   voice stealing without clicks, release to silence, pitch bend, 8-voice chords never clip, 44.1 and 48 kHz, CPU cost.
// Usage: node tools/harmor-test.mjs   (needs js/engine/mdaw.wasm: sh native/wasm/build.sh)
import { loadWasmEngine } from './wasm-engine.mjs';

let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const db = (x) => 20 * Math.log10(Math.max(1e-12, x));

// Goertzel: complex DFT bin at frequency f over x[a .. a+n) (Hann window, amplitude-normalised)
function bin(x, sr, f, a, n) {
  let re = 0, im = 0, ws = 0;
  for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)), ph = 2 * Math.PI * f * i / sr; re += x[a + i] * w * Math.cos(ph); im -= x[a + i] * w * Math.sin(ph); ws += w; }
  const amp = 2 * Math.hypot(re, im) / ws; return { amp, ph: Math.atan2(im, re) + Math.PI / 2 };   // x = A sin(wt + phi) -> phi
}
// the frequency of the strongest component near f0 (phase advance of the bin between two windows)
function freqAt(x, sr, f0, a, n) { const d = Math.round(sr * 0.01), p1 = bin(x, sr, f0, a, n).ph, p2 = bin(x, sr, f0, a + d, n).ph; let dp = p2 - p1 - 2 * Math.PI * f0 * d / sr; dp = Math.atan2(Math.sin(dp), Math.cos(dp)); return f0 + dp * sr / (2 * Math.PI * d); }
const wrap = (p) => Math.atan2(Math.sin(p), Math.cos(p));

async function synth(sr, params, notes, secs, extra = '') {
  const w = await loadWasmEngine(sr);
  let cmd = 'masterLimit 0\ntrackVol 0 1\ntrackInst 0 38\n';
  for (const [k, v] of Object.entries(params)) cmd += `instParam 0 ${k} ${v}\n`;
  cmd += extra;
  const er = w.cmd(cmd); if (er) throw new Error('engine: ' + er);
  const n = Math.round(secs * sr), L = new Float32Array(n), R = new Float32Array(n);
  let at = 0;
  const ev = notes.slice().sort((a, b) => a.t - b.t);
  for (const e of ev) {
    const to = Math.round(e.t * sr); if (to > at) { const l = new Float32Array(to - at), r = new Float32Array(to - at); w.render(l, r, to - at); L.set(l, at); R.set(r, at); at = to; }
    const er2 = w.cmd(e.cmd); if (er2) throw new Error('engine: ' + er2);
  }
  if (at < n) { const l = new Float32Array(n - at), r = new Float32Array(n - at); w.render(l, r, n - at); L.set(l, at); R.set(r, at); }
  return { L, R, w };
}
const on = (t, p, v = 1) => ({ t, cmd: `preview 0 ${p} ${v} 1` }), off = (t, p) => ({ t, cmd: `preview 0 ${p} 0 0` });
const peak = (x, a = 0, b = x.length) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i])); return m; };
const flat = { 40: 0.001, 41: 0.1, 42: 1, 43: 0.05, 44: 0 };   // envelope out of the way: instant attack, full sustain, no velocity scaling

for (const SR of [48000, 44100]) {
  const F = 220, A = Math.round(SR * 0.3), N = Math.round(SR * 0.5);
  // 1. fundamental + saw harmonic distribution + phase
  {
    const { L } = await synth(SR, { ...flat, 10: 1 }, [on(0, 57)], 1);
    const f = freqAt(L, SR, F, A, N), h = [1, 2, 3, 4, 5, 8].map((k) => bin(L, SR, F * k, A, N)), r = h.map((x) => x.amp / h[0].amp), want = [1, 1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 8];
    ok(Math.abs(f - F) < 0.01, `${SR}: fundamental of A3 = ${f.toFixed(4)} Hz (220)`);
    ok(r.every((x, i) => Math.abs(db(x) - db(want[i])) < 0.15), `${SR}: saw harmonics fall as 1/k (${r.map((x) => db(x).toFixed(2)).join(', ')} dB)`);
    const rel = [2, 3, 4].map((k, i) => wrap(h[i + 1].ph - k * h[0].ph)), wantP = [Math.PI, 0, Math.PI];
    ok(rel.every((x, i) => Math.abs(wrap(x - wantP[i])) < 0.05), `${SR}: saw partial phases (phi_k - k phi_1 = ${rel.map((x) => x.toFixed(3)).join(', ')}; want pi, 0, pi)`);
  }
}
const SR = 48000, F = 220, A = Math.round(SR * 0.3), N = Math.round(SR * 0.5);
// 2. square / triangle / sine distributions
{
  const sq = (await synth(SR, { ...flat, 10: 2 }, [on(0, 57)], 1)).L, tr = (await synth(SR, { ...flat, 10: 3 }, [on(0, 57)], 1)).L, si = (await synth(SR, { ...flat, 10: 0 }, [on(0, 57)], 1)).L;
  const H = (x) => [1, 2, 3, 4, 5].map((k) => bin(x, SR, F * k, A, N).amp);
  const s = H(sq), t = H(tr), n = H(si);
  ok(Math.abs(db(s[2] / s[0]) - db(1 / 3)) < 0.15 && Math.abs(db(s[4] / s[0]) - db(1 / 5)) < 0.15 && s[1] / s[0] < 1e-3 && s[3] / s[0] < 1e-3, `square: odd harmonics 1/k, no even (${s.map((x) => db(x / s[0]).toFixed(1)).join(', ')} dB)`);
  ok(Math.abs(db(t[2] / t[0]) - db(1 / 9)) < 0.15 && Math.abs(db(t[4] / t[0]) - db(1 / 25)) < 0.2 && t[1] / t[0] < 1e-3, `triangle: odd harmonics 1/k^2 (${t.map((x) => db(x / t[0]).toFixed(1)).join(', ')} dB)`);
  ok(n.slice(1).every((x) => x / n[0] < 1e-3), `sine: a single partial (others below ${db(Math.max(...n.slice(1)) / n[0]).toFixed(0)} dB)`);
}
// 3. a drawn harmonic table (sample bank slot: l = level, r = phase) shapes the Custom timbre and offsets the phases
{
  const w0 = await loadWasmEngine(SR); void w0;
  const lv = new Float32Array(516), ph = new Float32Array(516); lv[0] = 1; lv[2] = 0.5; lv[6] = 0.25; ph[2] = 0.25;   // partials 1, 3, 7; partial 3 a quarter cycle on
  const w = await loadWasmEngine(SR), blob = new Float32Array(1032); blob.set(lv, 0); blob.set(ph, 516); w.setBlob(blob);
  let cmd = 'masterLimit 0\ntrackVol 0 1\nsample 20 @0:516 @516:516\ntrackInst 0 38\n'; for (const [k, v] of Object.entries({ ...flat, 10: 4, 13: 20 })) cmd += `instParam 0 ${k} ${v}\n`;
  const er = w.cmd(cmd + 'preview 0 57 1 1\n'); if (er) throw new Error(er);
  const n = SR, L = new Float32Array(n), R = new Float32Array(n); w.render(L, R, n);
  const h = [1, 2, 3, 4, 7].map((k) => bin(L, SR, F * k, A, N));
  ok(Math.abs(db(h[2].amp / h[0].amp) - db(0.5)) < 0.1 && Math.abs(db(h[4].amp / h[0].amp) - db(0.25)) < 0.1 && h[1].amp / h[0].amp < 1e-3 && h[3].amp / h[0].amp < 1e-3, `drawn levels play: partial 3 = ${db(h[2].amp / h[0].amp).toFixed(2)} dB (-6.02), 7 = ${db(h[4].amp / h[0].amp).toFixed(2)} dB (-12.04), 2 and 4 silent`);
  const rel = wrap(h[2].ph - 3 * h[0].ph);
  ok(Math.abs(wrap(rel - Math.PI / 2)) < 0.05, `drawn phase plays: partial 3 at ${rel.toFixed(3)} rad (pi/2)`);
  // editing the table while the note sounds changes the sound (the table is read again when its slot is set)
  lv[4] = 0.5; blob.set(lv, 0); w.setBlob(blob); w.cmd('sample 21 @0:516 @516:516\ninstParam 0 13 21\n');
  const L2 = new Float32Array(n), R2 = new Float32Array(n); w.render(L2, R2, n);
  ok(bin(L2, SR, F * 5, A, N).amp / bin(L2, SR, F, A, N).amp > 0.45, 'an edited table changes the sounding note (partial 5 appears)');
}
// 4. timbre mix (complex sum) vs morph (amplitude + phase direction)
{
  const base = { ...flat, 10: 1, 20: 2, 30: 0.5 };
  const mx = (await synth(SR, { ...base, 31: 0 }, [on(0, 57)], 1)).L, mo = (await synth(SR, { ...base, 31: 1 }, [on(0, 57)], 1)).L;
  const a = [1, 2, 3].map((k) => bin(mx, SR, F * k, A, N).amp), b = [1, 2, 3].map((k) => bin(mo, SR, F * k, A, N).amp);
  const want1 = 0.5 * (2 / Math.PI) + 0.5 * (4 / Math.PI), want2 = 0.5 * (2 / (2 * Math.PI)), want3 = 0.5 * (2 / (3 * Math.PI)) + 0.5 * (4 / (3 * Math.PI));
  ok(Math.abs(db(a[1] / a[0]) - db(want2 / want1)) < 0.15 && Math.abs(db(a[2] / a[0]) - db(want3 / want1)) < 0.15, `mix 50 % saw + square: partial 2 = ${db(a[1] / a[0]).toFixed(2)} dB (${db(want2 / want1).toFixed(2)}), 3 = ${db(a[2] / a[0]).toFixed(2)} dB (${db(want3 / want1).toFixed(2)})`);
  ok(Math.abs(db(b[0] / a[0])) < 0.1 && Math.abs(db(b[2] / a[2])) < 0.1, 'morph keeps the amplitudes of partials in phase (1, 3)');
  const sawPh = (await synth(SR, { ...flat, 10: 1, 20: 1, 22: 0, 30: 0.5, 31: 1, 12: 0 }, [on(0, 57)], 1)).L;
  ok(Math.abs(db(bin(sawPh, SR, F * 2, A, N).amp / bin(sawPh, SR, F, A, N).amp) - db(0.5)) < 0.1, 'morph of two equal timbres = that timbre');
}
// 5. phase randomisation: the same magnitudes, a different waveform
{
  const a = (await synth(SR, { ...flat, 10: 1, 12: 0 }, [on(0, 57)], 1)).L, b = (await synth(SR, { ...flat, 10: 1, 12: 1 }, [on(0, 57)], 1)).L;
  const ha = [1, 2, 3, 5].map((k) => bin(a, SR, F * k, A, N).amp), hb = [1, 2, 3, 5].map((k) => bin(b, SR, F * k, A, N).amp);
  let diff = 0; for (let i = A; i < A + N; i++) diff += (a[i] - b[i]) ** 2;
  ok(ha.every((x, i) => Math.abs(db(hb[i] / x)) < 0.1) && Math.sqrt(diff / N) > 0.02, `random phases: magnitudes kept (within 0.1 dB), waveform changed (RMS difference ${Math.sqrt(diff / N).toFixed(3)})`);
}
// 6. partial count, quality caps, Nyquist: a high saw has no energy above Nyquist and no aliases between the harmonics
{
  const few = (await synth(SR, { ...flat, 10: 1, 1: 4 }, [on(0, 57)], 1)).L;
  ok(bin(few, SR, F * 4, A, N).amp / bin(few, SR, F, A, N).amp > 0.2 && bin(few, SR, F * 5, A, N).amp / bin(few, SR, F, A, N).amp < 1e-4, 'Partials = 4: partial 4 plays, partial 5 does not');
  const draft = (await synth(SR, { ...flat, 10: 1, 2: 0, 1: 516 }, [on(0, 33)], 1)).L;   // A1 55 Hz: 436 partials below Nyquist
  ok(bin(draft, SR, 55 * 64, A, N).amp > 1e-4 && bin(draft, SR, 55 * 65, A, N).amp < 1e-5, 'Draft quality caps a voice at 64 partials');
  const hi = (await synth(SR, { ...flat, 10: 1, 1: 516, 2: 2 }, [on(0, 100)], 1)).L;   // E7 2637 Hz: partials 1..8 below 0.47 SR
  const f0 = 440 * Math.pow(2, (100 - 69) / 12); let alias = 0, harm = 0;
  for (let f = 100; f < SR / 2 - 100; f += 37) { const near = Math.abs(f / f0 - Math.round(f / f0)) * f0 < 60; const a = bin(hi, SR, f, A, N).amp; if (near) harm = Math.max(harm, a); else alias = Math.max(alias, a); }
  ok(db(alias / harm) < -80, `no aliasing for a high saw (strongest off-harmonic component ${db(alias / harm).toFixed(0)} dB)`);
}
// 7. sub-octave partials and harmonic stretch
{
  const s = (await synth(SR, { ...flat, 10: 0, 33: 1 }, [on(0, 57)], 1)).L;
  ok(Math.abs(db(bin(s, SR, F / 2, A, N).amp / bin(s, SR, F, A, N).amp) - db(0.5)) < 0.1, 'Sub: a partial one octave down at half level');
  const st = (await synth(SR, { ...flat, 10: 1, 32: 1 }, [on(0, 57)], 1)).L, f4 = F * Math.pow(4, 1.1);
  ok(freqAt(st, SR, f4, A, N) - f4 < 0.05 && bin(st, SR, F * 4, A, N).amp < 0.2 * bin(st, SR, f4, A, N).amp, `Stretch +1: partial 4 moves to ${f4.toFixed(1)} Hz (k^1.1)`);
}
// 8. polyphony, stealing without clicks, release to silence, pitch bend
{
  const notes = []; for (let k = 0; k < 12; k++) notes.push(on(0.05 * k, 48 + k));
  const offs = [...Array(12)].map((_, k) => off(1, 48 + k)), d2 = (x) => { let m = 0; for (let i = 2; i < Math.round(SR * 0.9); i++) m = Math.max(m, Math.abs(x[i] - 2 * x[i - 1] + x[i - 2])); return m; };   // 2nd difference: ~0 for sines, large at a discontinuity
  const { L, w } = await synth(SR, { ...flat, 10: 0, 3: 8, 43: 0.2 }, notes.concat(offs), 2), ref = (await synth(SR, { ...flat, 10: 0, 3: 16, 43: 0.2 }, notes.concat(offs), 2)).L;
  const js = d2(L), jr = d2(ref);
  ok(js <= jr * 1.3, `12 sine notes on 8 voices: the 4 stolen voices fade out, no click (largest 2nd difference ${js.toFixed(4)}, ${jr.toFixed(4)} with 16 voices and no stealing)`);
  ok(peak(L, Math.round(SR * 1.7)) < 1e-4, `after release the voices go silent (${db(peak(L, Math.round(SR * 1.7))).toFixed(0)} dB)`); void w;
  const chord = await synth(SR, { 10: 1, 3: 8, 0: 1, 42: 1, 44: 0, 40: 0.001 }, [48, 52, 55, 59, 62, 64, 67, 71].map((p) => on(0, p)), 1);
  ok(peak(chord.L) < 1, `an 8-voice saw chord at full volume does not clip (peak ${db(peak(chord.L)).toFixed(1)} dBFS)`);
  const b = await synth(SR, { ...flat, 10: 0 }, [on(0, 57), { t: 0.2, cmd: 'bend 0 2' }], 1);
  ok(Math.abs(freqAt(b.L, SR, F * Math.pow(2, 2 / 12), A, N) - F * Math.pow(2, 2 / 12)) < 0.05, 'pitch bend +2 semitones moves every partial');
}
// 9. CPU: 8 voices x 256 partials (Normal) in the WebAssembly engine, as on the device
{
  const w = await loadWasmEngine(SR); let cmd = 'masterLimit 0\ntrackInst 0 38\ninstParam 0 10 1\ninstParam 0 1 256\n'; for (const p of [36, 40, 43, 47, 50, 55, 59, 62]) cmd += `preview 0 ${p} 1 1\n`; w.cmd(cmd);
  const n = SR * 4, L = new Float32Array(n), R = new Float32Array(n), t0 = performance.now(); w.render(L, R, n); const ms = performance.now() - t0;
  console.log(`info 8 voices (Normal quality, adaptive partials): ${(ms / 40).toFixed(1)} % of one desktop core per second of audio`);
  ok(ms / 4000 < 0.35, 'Normal quality stays well inside real time on a desktop core');
}

// ================================================================ phase 2: pitch, filters, articulators, LFO, unison, mono
const E = (e, k) => 110 + 60 * e + k;                       // articulator e, slot k (harmor.h)
const env = (e, o) => { const r = { [E(e, 0)]: 1 }; for (const [k, v] of Object.entries(o)) r[E(e, { depth: 1, n: 2, sus: 3, loop: 4, a: 5, h: 6, d: 7, s: 8, r: 9 }[k])] = v; return r; };
const pts = (e, list, sus = -1, loop = -1) => { const r = { [E(e, 2)]: list.length, [E(e, 3)]: sus, [E(e, 4)]: loop }; list.forEach(([dt, lv, cv], j) => { r[E(e, 10 + 3 * j)] = dt; r[E(e, 11 + 3 * j)] = lv; r[E(e, 12 + 3 * j)] = cv || 0; }); return r; };
const SAW110 = { ...flat, 10: 1, 1: 516, 2: 2 }, F2 = 110, AN = Math.round(SR * 0.4), A2 = Math.round(SR * 0.4);
const hAmp = (x, k, a = A2, n = AN) => bin(x, SR, F2 * k, a, n).amp;
// vibrato: rate and depth from the measured frequency track
{
  const { L } = await synth(SR, { ...flat, 10: 0, 45: 5, 46: 50, 47: 0 }, [on(0, 57)], 2);
  const tr = []; for (let t = 0.5; t < 1.5; t += 0.005) { const a = Math.round(t * SR); tr.push(freqAt(L, SR, F, a, 960)); }
  const hi = Math.max(...tr), lo = Math.min(...tr), cents = 1200 * Math.log2(hi / lo) / 2; let cross = 0; const mid = Math.sqrt(hi * lo); for (let i = 1; i < tr.length; i++) if ((tr[i - 1] - mid) * (tr[i] - mid) < 0) cross++;
  ok(Math.abs(cents - 50) < 8 && Math.abs(cross / 2 - 5) <= 1, `vibrato 5 Hz / 50 cents: measured +-${cents.toFixed(1)} cents, ${(cross / 2).toFixed(1)} cycles per second`);
}
// pitch articulator: +12 semitones held for 0.3 s, then down to the note
{
  const { L } = await synth(SR, { ...flat, 10: 0, ...env(1, { depth: 0.25, a: 0.001, h: 0.3, d: 0.05, s: 0, r: 0.1 }) }, [on(0, 57)], 1);
  const f1 = freqAt(L, SR, 2 * F, Math.round(SR * 0.05), 4096), f2 = freqAt(L, SR, F, Math.round(SR * 0.5), 4096);
  ok(Math.abs(f1 - 2 * F) < 0.1 && Math.abs(f2 - F) < 0.05, `pitch articulator (depth 25 % = +12 st): ${f1.toFixed(2)} Hz while it holds, then ${f2.toFixed(2)} Hz`);
}
// filters: exact magnitude per partial
{
  const ref = (await synth(SR, SAW110, [on(0, 45)], 1)).L;
  const rel = (x, k) => db(hAmp(x, k) / hAmp(ref, k));
  const lp = (await synth(SR, { ...SAW110, 50: 1, 51: 0, 52: 880, 56: 1 }, [on(0, 45)], 1)).L;   // 24 dB / oct at 880 Hz
  const want = (fo) => 20 * Math.log10(1 / Math.sqrt(1 + Math.pow(2, 8 * fo)));
  ok([4, 8, 16].every((k) => Math.abs(rel(lp, k) - want(Math.log2(F2 * k / 880))) < 0.2), `low-pass 24 dB at 880 Hz: partial 4 ${rel(lp, 4).toFixed(2)} dB (${want(-1).toFixed(2)}), 8 ${rel(lp, 8).toFixed(2)} (${want(0).toFixed(2)}), 16 ${rel(lp, 16).toFixed(2)} (${want(1).toFixed(2)})`);
  const hp = (await synth(SR, { ...SAW110, 50: 1, 51: 1, 52: 880, 56: 0 }, [on(0, 45)], 1)).L;
  const wh = (fo) => 20 * Math.log10(1 / Math.sqrt(1 + Math.pow(2, -4 * fo)));
  ok([2, 4, 8].every((k) => Math.abs(rel(hp, k) - wh(Math.log2(F2 * k / 880))) < 0.2), `high-pass 12 dB at 880 Hz: partial 2 ${rel(hp, 2).toFixed(2)} dB (${wh(-2).toFixed(2)}), 4 ${rel(hp, 4).toFixed(2)} (${wh(-1).toFixed(2)})`);
  const bs = (await synth(SR, { ...SAW110, 50: 1, 51: 3, 52: 880, 56: 1 }, [on(0, 45)], 1)).L;
  ok(rel(bs, 8) < -60 && Math.abs(rel(bs, 2)) < 0.5, `band-stop at 880 Hz: partial 8 ${rel(bs, 8).toFixed(0)} dB, partial 2 untouched`);
  const bp = (await synth(SR, { ...SAW110, 50: 1, 51: 2, 52: 880, 56: 1 }, [on(0, 45)], 1)).L;
  ok(Math.abs(rel(bp, 8)) < 0.2 && rel(bp, 4) < -8 && rel(bp, 16) < -8, `band-pass at 880 Hz: partial 8 passes, 4 ${rel(bp, 4).toFixed(1)} dB, 16 ${rel(bp, 16).toFixed(1)} dB`);
  const rs = (await synth(SR, { ...SAW110, 50: 1, 51: 0, 52: 880, 56: 1, 53: 1, 54: 0.25 }, [on(0, 45)], 1)).L;
  ok(Math.abs(rel(rs, 8) - (want(0) + 20 * Math.log10(16))) < 0.3, `resonance 100 %: +24 dB at the cutoff (partial 8 ${rel(rs, 8).toFixed(2)} dB)`);
  const mix = (await synth(SR, { ...SAW110, 50: 1, 51: 3, 52: 880, 56: 1, 58: 0.5 }, [on(0, 45)], 1)).L;
  ok(Math.abs(rel(mix, 8) - db(0.5)) < 0.3, `filter mix 50 %: a notch only half deep (${rel(mix, 8).toFixed(2)} dB)`);
  // key tracking: an octave up moves the cutoff an octave up (same partial, same gain)
  const k1 = (await synth(SR, { ...SAW110, 50: 1, 51: 0, 52: 880, 56: 1, 57: 1 }, [on(0, 45)], 1)).L, k2 = (await synth(SR, { ...SAW110, 50: 1, 51: 0, 52: 880, 56: 1, 57: 1 }, [on(0, 57)], 1)).L, r2 = (await synth(SR, SAW110, [on(0, 57)], 1)).L;
  const g1 = db(hAmp(k1, 8) / hAmp(ref, 8)), g2 = db(bin(k2, SR, 220 * 8, A2, AN).amp / bin(r2, SR, 220 * 8, A2, AN).amp);
  ok(Math.abs(g1 - g2) < 0.2, `key tracking 100 %: partial 8 of A2 ${g1.toFixed(2)} dB, of A3 ${g2.toFixed(2)} dB`);
  // self-oscillation: a sine at the cutoff without any partial there
  const so = (await synth(SR, { ...flat, 10: 0, 50: 1, 51: 0, 52: 1500, 56: 1, 70: 1 }, [on(0, 45)], 1)).L;
  ok(db(bin(so, SR, 1500, A2, AN).amp / bin(so, SR, 110, A2, AN).amp) > -12, `self-oscillation: a tone at the 1.5 kHz cutoff (${db(bin(so, SR, 1500, A2, AN).amp / bin(so, SR, 110, A2, AN).amp).toFixed(1)} dB re the fundamental)`);
  // formant: vowel A peaks (800, 1150 Hz) over a flat saw
  const fm = (await synth(SR, { ...SAW110, 50: 1, 51: 4, 52: 200 }, [on(0, 45)], 1)).L;
  ok(rel(fm, 7) - rel(fm, 5) > 6 && rel(fm, 7) - rel(fm, 4) > 6, `formant A: 770 Hz ${(rel(fm, 7) - rel(fm, 5)).toFixed(1)} dB above 550 Hz`);
  // drawn filter curve (sample bank slot): a step at the cutoff
  const w = await loadWasmEngine(SR), cv = new Float32Array(256); for (let j = 0; j < 256; j++) cv[j] = j < 128 ? 1 : 0.1; w.setBlob(cv);
  let cmd = 'masterLimit 0\ntrackVol 0 1\nsample 30 @0:256\ntrackInst 0 38\n'; for (const [k, v] of Object.entries({ ...SAW110, 50: 1, 51: 5, 52: 880, 59: 30 })) cmd += `instParam 0 ${k} ${v}\n`; w.cmd(cmd + 'preview 0 45 1 1\n');
  const cu = new Float32Array(SR), cr = new Float32Array(SR); w.render(cu, cr, SR);
  ok(Math.abs(rel(cu, 4)) < 0.3 && Math.abs(rel(cu, 16) - db(0.1)) < 0.3, `drawn filter curve: below the cutoff 0 dB (${rel(cu, 4).toFixed(2)}), above it -20 dB (${rel(cu, 16).toFixed(2)})`);
}
// articulators: AHDSR attack time, multi-point loop, harmonic tilt / phase, timbre mix, frequency (stretch)
{
  const rmsAt = (x, t, w = 0.004) => { const a = Math.round(t * SR), n = Math.round(w * SR); let e = 0; for (let i = a; i < a + n; i++) e += x[i] * x[i]; return Math.sqrt(e / n); };
  const at = (await synth(SR, { ...flat, 10: 0, ...env(0, { depth: 1, a: 0.2, h: 0, d: 0.1, s: 1, r: 0.1 }) }, [on(0, 57)], 1)).L;
  const r1 = rmsAt(at, 0.1), r2 = rmsAt(at, 0.5);
  ok(Math.abs(r1 / r2 - 0.5) < 0.06, `volume articulator attack 200 ms: half level at 100 ms (${(r1 / r2).toFixed(3)})`);
  const lp = (await synth(SR, { ...flat, 10: 0, ...env(0, { depth: 1 }), ...pts(0, [[0, 0], [0.05, 1], [0.05, 0.1], [0.1, 0]], 2, 0) }, [on(0, 57)], 1)).L;
  const tr = []; for (let t = 0.2; t < 0.8; t += 0.002) tr.push(rmsAt(lp, t, 0.002));
  const best = [0.08, 0.1, 0.12].map((per) => { const d = Math.round(per / 0.002); let s = 0; for (let i = 0; i + d < tr.length; i++) s += Math.abs(tr[i] - tr[i + d]); return [per, s]; }).sort((a, b) => a[1] - b[1])[0][0];
  ok(best === 0.1 && Math.max(...tr) / Math.min(...tr) > 4, `multi-point articulator with loop: repeats every ${best * 1000} ms while held (100 ms loop)`);
  const tl = (await synth(SR, { ...SAW110, ...env(5, { depth: -1, a: 0.001, h: 1, d: 0.1, s: 1, r: 0.1 }) }, [on(0, 45)], 1)).L, ref = (await synth(SR, SAW110, [on(0, 45)], 1)).L;
  ok(Math.abs(db(hAmp(tl, 8) / hAmp(ref, 8)) + 36) < 0.3 && Math.abs(db(hAmp(tl, 1) / hAmp(ref, 1))) < 0.1, `harmonic level articulator: -12 dB per octave of harmonic number (partial 8 ${db(hAmp(tl, 8) / hAmp(ref, 8)).toFixed(2)} dB)`);
  const hp = (await synth(SR, { ...SAW110, ...env(6, { depth: 1, a: 0.001, h: 1, d: 0.1, s: 1, r: 0.1 }) }, [on(0, 45)], 1)).L;
  let diff = 0; for (let i = A2; i < A2 + AN; i++) diff += (hp[i] - ref[i]) ** 2;
  ok([2, 3, 5, 9].every((k) => Math.abs(db(hAmp(hp, k) / hAmp(ref, k))) < 0.1) && Math.sqrt(diff / AN) > 0.01, 'harmonic phase articulator: magnitudes kept, waveform changed');
  const mx = (await synth(SR, { ...SAW110, 20: 2, ...env(7, { depth: 1, a: 0.001, h: 1, d: 0.1, s: 1, r: 0.1 }) }, [on(0, 45)], 1)).L;
  ok(hAmp(mx, 2) / hAmp(mx, 1) < 1e-3, 'timbre mix articulator: saw -> square (no even partials at the top of the envelope)');
  const st = (await synth(SR, { ...SAW110, ...env(4, { depth: 0.5, a: 0.001, h: 1, d: 0.1, s: 1, r: 0.1 }) }, [on(0, 45)], 1)).L, f4 = F2 * Math.pow(4, 1.1);
  ok(Math.abs(freqAt(st, SR, f4, A2, AN) - f4) < 0.05, `frequency articulator: stretch +1 moves partial 4 to ${f4.toFixed(1)} Hz`);
}
// LFO: cutoff modulation at its rate; tremolo; pan
{
  const { L } = await synth(SR, { ...SAW110, 50: 1, 51: 0, 52: 880, 56: 1, 91: 4, 92: 0, 94: 1, 95: 2 }, [on(0, 45)], 2);
  const tr = []; for (let t = 0.3; t < 1.8; t += 0.01) tr.push(db(bin(L, SR, 1760, Math.round(t * SR), 2048).amp));
  const mid = (Math.max(...tr) + Math.min(...tr)) / 2; let cross = 0; for (let i = 1; i < tr.length; i++) if ((tr[i - 1] - mid) * (tr[i] - mid) < 0) cross++;
  ok(Math.abs(cross / 2 / 1.5 - 4) < 0.7 && Math.max(...tr) - Math.min(...tr) > 20, `LFO 4 Hz on cutoff 1: partial 16 swings ${(Math.max(...tr) - Math.min(...tr)).toFixed(0)} dB, ${(cross / 2 / 1.5).toFixed(1)} times a second`);
  const pn = await synth(SR, { ...flat, 10: 0, 91: 2, 94: 1, 95: 7 }, [on(0, 57)], 1);
  let lMax = 0, rMax = 0; for (let t = 0.1; t < 0.9; t += 0.01) { const a = Math.round(t * SR); const l = bin(pn.L, SR, F, a, 960).amp, r = bin(pn.R, SR, F, a, 960).amp; lMax = Math.max(lMax, l / (r + 1e-9)); rMax = Math.max(rMax, r / (l + 1e-9)); }
  ok(lMax > 10 && rMax > 10, 'LFO on pan: the voice moves left and right');
}
// unison: detune spread around the note, stereo, no louder than the power sum, no clipping
{
  const one = (await synth(SR, { ...flat, 10: 0 }, [on(0, 57)], 1)), uni = await synth(SR, { ...flat, 10: 0, 75: 4, 76: 30, 77: 1, 78: 1 }, [on(0, 57)], 1);
  const fl = freqAt(uni.L, SR, F * Math.pow(2, -15 / 1200), A2, Math.round(SR * 0.5)), fr = freqAt(uni.R, SR, F * Math.pow(2, 15 / 1200), A2, Math.round(SR * 0.5));
  ok(fl < F - 1 && fr > F + 1, `unison 4 x 30 cents, spread 100 %: the left side sits flat (${fl.toFixed(2)} Hz), the right side sharp (${fr.toFixed(2)} Hz)`);
  const rms = (x) => { let e = 0; for (let i = A2; i < A2 + AN; i++) e += x[i] * x[i]; return Math.sqrt(e / AN); };
  ok(Math.abs(db((rms(uni.L) + rms(uni.R)) / (rms(one.L) + rms(one.R)))) < 3, `unison keeps the level (${db((rms(uni.L) + rms(uni.R)) / (rms(one.L) + rms(one.R))).toFixed(1)} dB re one copy)`);
  const ch = await synth(SR, { 10: 1, 0: 1, 3: 8, 42: 1, 40: 0.001, 44: 0, 75: 8, 76: 25, 77: 1, 78: 1 }, [48, 52, 55, 59, 62, 64, 67, 71].map((p) => on(0, p)), 1);
  ok(Math.max(peak(ch.L), peak(ch.R)) < 1, `8-note chord x 8 unison copies at full volume: peak ${db(Math.max(peak(ch.L), peak(ch.R))).toFixed(1)} dBFS (soft-limited, never clips)`);
}
// mono / legato / glide: the second key glides, the envelope is not restarted
{
  const { L } = await synth(SR, { ...flat, 10: 0, 7: 1, 8: 1, 6: 0.2 }, [on(0, 57), on(0.5, 69), off(0.9, 69), off(0.9, 57)], 1.2);
  const fa = freqAt(L, SR, F, Math.round(SR * 0.3), 4096), fm = freqAt(L, SR, 330, Math.round(SR * 0.53), 512), fb = freqAt(L, SR, 440, Math.round(SR * 0.78), 4096);
  let jump = 0; for (let i = Math.round(SR * 0.49); i < Math.round(SR * 0.52); i++) jump = Math.max(jump, Math.abs(L[i] - 2 * L[i - 1] + L[i - 2]));
  ok(Math.abs(fa - 220) < 0.1 && fm > 240 && fm < 420 && Math.abs(fb - 440) < 0.5 && jump < 0.01, `mono legato glide: 220 Hz -> ${fm.toFixed(0)} Hz on the way -> ${fb.toFixed(1)} Hz, no retrigger click`);
}
// CPU: 8 voices x 4 unison copies, both filters, an LFO and a stretch articulator (Normal)
{
  const w = await loadWasmEngine(SR); let cmd = 'masterLimit 0\ntrackInst 0 38\n'; for (const [k, v] of Object.entries({ 10: 1, 1: 256, 75: 4, 50: 1, 52: 1500, 60: 1, 61: 4, 62: 900, 91: 3, 94: 0.5, 95: 2, [E(4, 0)]: 1, [E(4, 1)]: 0.2 })) cmd += `instParam 0 ${k} ${v}\n`;
  for (const p of [36, 40, 43, 47, 50, 55, 59, 62]) cmd += `preview 0 ${p} 1 1\n`; w.cmd(cmd);
  const n = SR * 4, L = new Float32Array(n), R = new Float32Array(n), t0 = performance.now(); w.render(L, R, n); const ms = performance.now() - t0;
  console.log(`info 8 voices x 4 unison, 2 filters, LFO + stretch articulator: ${(ms / 40).toFixed(1)} % of one desktop core (the partial budget shares 2048 partials among the 32 banks)`);
  ok(ms / 4000 < 0.35 && L.every(Number.isFinite), 'heavy patch stays inside real time on a desktop core, output finite');
}

// ================================================================ phase 2b: Prism, Pluck, Blur, spectral Phaser, effects rack
{
  const ref = (await synth(SR, SAW110, [on(0, 45)], 1.2)).L;
  // Prism shift 50 %: every partial moves up by one fundamental (partial k sits at (k + 1) f0)
  const ps = (await synth(SR, { ...SAW110, 81: 0.5, 82: 1 }, [on(0, 45)], 1)).L;
  ok(Math.abs(freqAt(ps, SR, 2 * F2, A2, AN) - 2 * F2) < 0.05 && Math.abs(freqAt(ps, SR, 4 * F2, A2, AN) - 4 * F2) < 0.05 && Math.abs(db(bin(ps, SR, 4 * F2, A2, AN).amp / hAmp(ref, 3))) < 0.2,
    'Prism shift 50 %: partial 1 at 220 Hz, partial 3 at 440 Hz (+1 x f0), with partial 3\'s level');
  const sc = (await synth(SR, { ...SAW110, 81: 1, 82: 0 }, [on(0, 45)], 1)).L;
  ok([5, 7, 9].every((k) => hAmp(sc, k) < 0.5 * hAmp(ref, k)) && Math.abs(db(hAmp(sc, 1) / hAmp(ref, 1))) < 0.2, 'Prism scatter: partials leave their harmonic places, the fundamental stays');
  // Pluck: each partial decays, the higher ones faster
  const pl = (await synth(SR, { ...SAW110, 83: 1, 84: 1, 85: 0.5 }, [on(0, 45)], 1.2)).L;
  const early = db(bin(pl, SR, 880, Math.round(SR * 0.05), 4096).amp / bin(pl, SR, 110, Math.round(SR * 0.05), 4096).amp), late = db(bin(pl, SR, 880, Math.round(SR * 0.8), 4096).amp / bin(pl, SR, 110, Math.round(SR * 0.8), 4096).amp);
  const f1 = db(bin(pl, SR, 110, Math.round(SR * 0.8), 4096).amp / bin(pl, SR, 110, Math.round(SR * 0.05), 4096).amp);
  ok(early - late > 12 && Math.abs(f1 - 20 * Math.log10(Math.exp(-0.75))) < 0.8, `Pluck: partial 8 falls ${(early - late).toFixed(1)} dB behind the fundamental in 0.75 s; the fundamental decays ${f1.toFixed(2)} dB (time 1 s: ${(20 * Math.log10(Math.exp(-0.75))).toFixed(2)})`);
  // Blur: partials rise slowly, the higher ones slower
  const bl = (await synth(SR, { ...SAW110, 86: 0.2, 88: 1 }, [on(0, 45)], 1.2)).L;
  const r1 = bin(bl, SR, 110, Math.round(SR * 0.04), 2048).amp / hAmp(ref, 1), r8 = bin(bl, SR, 880, Math.round(SR * 0.04), 2048).amp / hAmp(ref, 8), r1b = bin(bl, SR, 110, Math.round(SR * 1.0), 4096).amp / bin(ref, SR, 110, Math.round(SR * 1.0), 4096).amp;
  ok(r1 < 0.6 && r8 < r1 * 0.7 && r1b > 0.95, `Blur attack 200 ms: after 40 ms partial 1 at ${(r1 * 100).toFixed(0)} %, partial 8 at ${(r8 * 100).toFixed(0)} % (higher = slower); partial 1 full by 1 s (${(r1b * 100).toFixed(0)} %)`);
  // spectral phaser: notches sweep the spectrum (a partial's level swings at the speed)
  const sp = (await synth(SR, { ...SAW110, 103: 1, 104: 1, 105: 2, 106: 0.6 }, [on(0, 45)], 2)).L;
  const tr = []; for (let t = 0.2; t < 1.7; t += 0.01) tr.push(db(bin(sp, SR, 880, Math.round(t * SR), 2048).amp)); const mid = (Math.max(...tr) + Math.min(...tr)) / 2; let cr = 0; for (let i = 1; i < tr.length; i++) if ((tr[i - 1] - mid) * (tr[i] - mid) < 0) cr++;
  ok(Math.max(...tr) - Math.min(...tr) > 20 && Math.abs(cr / 2 / 1.5 - 2) < 0.5, `spectral phaser 2 Hz: partial 8 swings ${(Math.max(...tr) - Math.min(...tr)).toFixed(0)} dB, ${(cr / 2 / 1.5).toFixed(1)} times a second`);
}
// effects rack: each effect inside Harmor = the same MobileDAW effect on the track after a dry Harmor (sample for sample)
{
  const FXN = ['Distortion', 'Chorus', 'Phaser', 'Delay', 'Reverb', 'Compressor', 'EQ'], TYPES = [3, 20, 21, 17, 7, 4, 31];
  const SET = [[[0, 12], [3, 0.3]], [[2, 0.8], [1, 1.5]], [[7, 0.7], [8, 0.4]], [[9, 0.5]], [[2, 0.4], [0, 0.8]], [[0, -24], [1, 6]], [[5, 1], [8, 6]]];
  const base = { ...flat, 10: 1, 0: 0.25, 1: 64 }, notes = [on(0, 45), on(0.15, 52), off(0.6, 45), off(0.6, 52)];
  const render = async (cmd) => { const w = await loadWasmEngine(SR); const er = w.cmd(cmd); if (er) throw new Error(er); const n = Math.round(SR * 1.2), L = new Float32Array(n), R = new Float32Array(n); let at = 0;
    for (const e of notes) { const to = Math.round(e.t * SR); if (to > at) { const l = new Float32Array(to - at), r = new Float32Array(to - at); w.render(l, r, to - at); L.set(l, at); R.set(r, at); at = to; } w.cmd(e.cmd); }
    const l = new Float32Array(n - at), r = new Float32Array(n - at); w.render(l, r, n - at); L.set(l, at); R.set(r, at); return { L, R }; };
  const head = 'masterLimit 0\ntrackVol 0 1\ntrackInst 0 38\n' + Object.entries(base).map(([k, v]) => `instParam 0 ${k} ${v}\n`).join('');
  const res = [];
  for (let k = 0; k < 7; k++) {
    const inside = await render(head + `instParam 0 ${720 + 48 * k} 1\n` + SET[k].map(([j, v]) => `instParam 0 ${720 + 48 * k + 2 + j} ${v}\n`).join(''));
    const outside = await render(head + `insertDevice 0 0 ${TYPES[k]}\n` + SET[k].map(([j, v]) => `devParam 0 0 ${j} ${v}\n`).join(''));
    const dry = await render(head);
    let e = 0, r = 0, ch = 0; for (let i = 0; i < inside.L.length; i++) { e += (inside.L[i] - outside.L[i]) ** 2 + (inside.R[i] - outside.R[i]) ** 2; r += outside.L[i] ** 2; ch += (inside.L[i] - dry.L[i]) ** 2; }
    res.push([FXN[k], db(Math.sqrt(e / inside.L.length)), db(Math.sqrt(ch / r))]);
  }
  ok(res.every(([, d, c]) => d < -90 && c > -40), 'every effect in the rack = the MobileDAW effect on a track, and it changes the sound: ' + res.map(([n, d]) => `${n} ${d === -Infinity ? 'identical' : d.toFixed(0) + ' dB'}`).join(', '));
  // order: Distortion -> Reverb is not Reverb -> Distortion
  const both = head + 'instParam 0 720 1\ninstParam 0 722 24\ninstParam 0 912 1\ninstParam 0 914 0.6\n';
  const a = await render(both + 'instParam 0 712 0\ninstParam 0 713 4\n'), b = await render(both + 'instParam 0 712 4\ninstParam 0 713 0\n');
  let d2 = 0, r2 = 0; for (let i = 0; i < a.L.length; i++) { d2 += (a.L[i] - b.L[i]) ** 2; r2 += a.L[i] ** 2; }
  ok(db(Math.sqrt(d2 / r2)) > -30, `the order of the effects counts (Distortion -> Reverb vs Reverb -> Distortion: ${db(Math.sqrt(d2 / r2)).toFixed(1)} dB apart)`);
  // mix 50 %: halfway between dry and wet
  const wet = await render(head + 'instParam 0 912 1\ninstParam 0 914 1\n'), half = await render(head + 'instParam 0 912 1\ninstParam 0 913 0.5\ninstParam 0 914 1\n'), dry = await render(head);
  let dm = 0, rm = 0; for (let i = 0; i < half.L.length; i++) { const want = dry.L[i] + 0.5 * (wet.L[i] - dry.L[i]); dm += (half.L[i] - want) ** 2; rm += want * want; }
  ok(db(Math.sqrt(dm / rm)) < -90, 'effect mix 50 % = halfway between dry and wet');
  // tail: a delay keeps sounding after the notes have ended
  const dl = await render(head + 'instParam 0 864 1\ninstParam 0 875 0.6\n');
  ok(peak(dl.L, Math.round(SR * 0.9), Math.round(SR * 1.2)) > 1e-3 && peak(dry.L, Math.round(SR * 0.9), Math.round(SR * 1.2)) < 1e-5, 'the delay tail sounds after the voices have ended (the instrument stays active)');
}
console.log(bad ? `\n${bad} FAILED` : '\nharmor-test: all passed'); process.exit(bad ? 1 : 0);
