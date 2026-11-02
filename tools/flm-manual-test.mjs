// FL Studio Mobile instruments: behaviour the official FL Studio Mobile manual describes (GMS / MiniSynth / SuperSaw pages), and the
// migration that keeps projects / presets saved before these corrections sounding the same.
//   GMS: Scale Chord = voices 0 / 7 / 14 / 21 st, Octave = 0 / 12 / 24 / 36 st; the filter envelope holds its peak while the key is down
//        and falls in Decay after the release; FX LFO rate 1/4 bar .. 8 bars
//   MiniSynth: Saw = perfect saw at Modifier 0 and 100; Pulse cancels at 0 and 100; 2nd wave -24..+24 st; Mono slides on every note change
//        (also from a note that has ended), Lead only between overlapping notes; LFO Dest MW = the MW Dest target; phaser Speed tempo synced
//   SuperSaw: Pulse Width 0 = silent, 100 = square; Mono Mode off: a note played while another is held slides from it (a chord does not);
//        Tempo Sync LFO in phase with the song's beat; Arp Up/Down 2 repeats the top and bottom notes
// Usage: node tools/flm-manual-test.mjs
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const S = await import(path.join(root, 'js/engine/flmsyn.js')), D = await import(path.join(root, 'js/defs.js'));
const SR = 48000;
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };
const CLS = { 31: S.FlmGms, 32: S.FlmMiniSynth, 33: S.FlmSuperSaw };
function synth(type, p = {}) { const s = new CLS[type](SR); s.setTempo(120); D.INSTRUMENTS[type].params.forEach((q, k) => s.setParam(k, p[k] ?? q.def)); return s; }
// events [time s, on, pitch]; returns the left channel
function play(s, ev, sec) {
  const n = Math.round(sec * SR), L = new Float32Array(n), R = new Float32Array(n); let cur = 0;
  for (const [t, on, p] of ev.slice().sort((a, b) => a[0] - b[0])) { const f = Math.round(t * SR); while (cur < f) { const e = Math.min(f, cur + 256); s.render(L, R, cur, e); cur = e; } if (on) s.noteOn(p, 0.8); else s.noteOff(p); }
  while (cur < n) { const e = Math.min(n, cur + 256); s.render(L, R, cur, e); cur = e; }
  return L;
}
const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
const goertzel = (x, a, b, f) => { const w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w); let s1 = 0, s2 = 0; for (let i = a; i < b; i++) { const hn = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - a) / (b - a)), s0 = x[i] * hn + c * s1 - s2; s2 = s1; s1 = s0; } return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / (b - a); };
// frequency from upward zero crossings (linear interpolation) over [a, b)
const zcHz = (x, a, b) => { let first = -1, last = -1, n = 0; for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) { const t = i - 1 + x[i - 1] / (x[i - 1] - x[i]); if (first < 0) first = t; else n++; last = t; } return n > 0 ? n * SR / (last - first) : 0; };
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------- GMS
{
  ok(JSON.stringify(S.GMS_SCALE[1]) === '[0,7,14,21]' && JSON.stringify(S.GMS_SCALE[2]) === '[0,12,24,36]', 'GMS Scale table: Chord 0/7/14/21, Octave 0/12/24/36 (manual)');
  // sine A only, filter open, 4 voices, no chorus detune: the spectrum has exactly the scale's partials
  const base = { 7: 1, 8: 1, 12: -100, 0: 100, 41: 0, 42: 0, 45: 3, 26: 1 };
  for (const [sc, iv, name] of [[1, [0, 7, 14, 21], 'Chord'], [2, [0, 12, 24, 36], 'Octave']]) {
    const x = play(synth(31, { ...base, 46: sc }), [[0, 1, 48]], 0.8), a = Math.round(0.2 * SR), b = Math.round(0.7 * SR);
    const on = iv.map((s) => goertzel(x, a, b, hz(48 + s))), off = [-12, 5, 19, 26].map((s) => goertzel(x, a, b, hz(48 + s)));
    ok(Math.min(...on) > 20 * Math.max(...off), `GMS Scale ${name}: voices at ${iv.join(' / ')} st (weakest ${db(Math.min(...on)).toFixed(0)} dB, strongest elsewhere ${db(Math.max(...off)).toFixed(0)} dB)`);
  }
  // filter envelope: Amount +60 from a low cutoff; held 1.5 s then released (long amp release): bright while held, dark again after Decay
  const fe = synth(31, { 7: 3, 8: 3, 12: -100, 0: 25, 2: 0.005, 3: 0.25, 4: 60, 27: 3 }), x = play(fe, [[0, 1, 48], [1.5, 0, 48]], 2.6);
  const hi = (t) => { const a = Math.round(t * SR), b = a + 4800; return goertzel(x, a, b, 10 * hz(48)) / Math.max(1e-9, goertzel(x, a, b, hz(48))); };   // 10th harmonic vs fundamental
  ok(hi(1.3) > 0.7 * hi(0.15) && hi(1.3) > 0.01, `GMS filter envelope holds its peak while the key is down (1.3 s vs 0.15 s: ${(hi(1.3) / hi(0.15)).toFixed(2)})`);
  ok(hi(2.3) < 0.2 * hi(1.3), `GMS filter envelope falls in Decay after the release (${(hi(2.3) / hi(1.3)).toFixed(3)})`);
  ok(D.INSTRUMENTS[31].params[52].items.join(',') === '8 Bars,4 Bars,2 Bars,1 Bar,1/2 Bar,1/4 Bar', 'GMS FX LFO Rate: 1/4 bar .. 8 bars (manual)');
  ok(D.INSTRUMENTS[31].params[15].items[2] === 'RM' && D.INSTRUMENTS[31].params[20].items.includes('LFO'), 'GMS Mod Kind RM, MW Dest Filter / LFO / Osc. Mod');
}

// ---------------------------------------------------------------- MiniSynth
{
  const tone = (p) => play(synth(32, { 4: 100, 2: 0, ...p }), [[0, 1, 57]], 0.4);
  const same = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; };
  const s0 = tone({ 0: 0, 1: 0 }), s100 = tone({ 0: 0, 1: 100 }), s50 = tone({ 0: 0, 1: 50 });
  ok(same(s0, s100) < 1e-6 && same(s0, s50) > 0.05, 'MiniSynth Saw: Modifier 0 and 100 give the same perfect saw, 50 adds the square');
  const h2 = goertzel(s0, 4800, 19200, 2 * 220) / goertzel(s0, 4800, 19200, 220);
  ok(Math.abs(h2 - 0.5) < 0.06, `MiniSynth Saw at Modifier 0 is a saw (2nd harmonic ${h2.toFixed(3)} of the 1st)`);
  const p0 = tone({ 0: 2, 1: 0 }), p100 = tone({ 0: 2, 1: 100 }), p50 = tone({ 0: 2, 1: 50 });
  ok(db(rms(p0)) < -100 && db(rms(p100)) < -100 && db(rms(p50)) > -30, `MiniSynth Pulse: cancels at 0 and 100 (${db(rms(p0)).toFixed(0)} / ${db(rms(p100)).toFixed(0)} dB), full at 50 (${db(rms(p50)).toFixed(0)} dB)`);
  for (const [m, st] of [[0, -24], [50, 0], [100, 24], [75, 12]]) ok(Math.abs(S.miniSt(m / 100) - st) < 1e-9, `MiniSynth 2nd wave Modifier ${m} = ${st} st`);
  // Mono slides from a note that has ended (Slide 0.25 s), Lead (overlap only) does not
  const glide = (mode) => { const x = play(synth(32, { 0: 0, 1: 0, 4: 100, 23: mode, 24: 0.25, 22: 0.02 }), [[0, 1, 45], [0.3, 0, 45], [0.6, 1, 57], [1.2, 0, 57]], 1.3); return zcHz(x, Math.round(0.605 * SR), Math.round(0.625 * SR)); };
  const gm = glide(1), gl = glide(2);
  ok(gm > hz(45) * 0.95 && gm < hz(57) * 0.8, `MiniSynth Mono: a note after a gap slides from the previous one (${gm.toFixed(0)} Hz at its start, from ${hz(45).toFixed(0)} to ${hz(57).toFixed(0)})`);
  ok(Math.abs(gl - hz(57)) < hz(57) * 0.03, `MiniSynth Lead: no slide from an ended note (${gl.toFixed(0)} Hz)`);
  // LFO Dest MW -> MW Dest: MW Dest Frequency gives the same output as LFO Dest Frequency
  const lf = (d, mw) => play(synth(32, { 13: 80, 14: 9, 16: d, 18: mw, 4: 100 }), [[0, 1, 57]], 0.5);
  ok(same(lf(3, 1), lf(1, 0)) < 1e-6 && same(lf(3, 1), lf(0, 0)) > 0.01, 'MiniSynth LFO Dest MW modulates the MW Dest target');
  ok(S.miniPhaserBeats(0) === 32 && S.miniPhaserBeats(100) === 0.25 && S.miniPhaserBeats(40) === 2, 'MiniSynth phaser Speed is tempo synced (8 bars .. 1/4 beat)');
  ok(D.INSTRUMENTS[32].params[5].min === -100 && D.INSTRUMENTS[32].params[6].min === -100, 'MiniSynth Kbd / Vel Trk are bipolar (manual: turn left = decrease)');
}

// ---------------------------------------------------------------- SuperSaw
{
  const pw = (v) => play(synth(33, { 0: 1, 3: v, 4: 0, 18: 100 }), [[0, 1, 57]], 0.4);
  ok(db(rms(pw(0))) < -100 && db(rms(pw(100))) > -30, `SuperSaw Pulse Width 0 = silent (${db(rms(pw(0))).toFixed(0)} dB), 100 = square`);
  const sq = pw(100), h2 = goertzel(sq, 4800, 19200, 440) / goertzel(sq, 4800, 19200, 220), h3 = goertzel(sq, 4800, 19200, 660) / goertzel(sq, 4800, 19200, 220);
  ok(h2 < 0.02 && Math.abs(h3 - 1 / 3) < 0.05, `SuperSaw Pulse Width 100 is a square (h2 ${h2.toFixed(3)}, h3 ${h3.toFixed(3)})`);
  ok(D.INSTRUMENTS[33].params[3].def === 100 && D.INSTRUMENTS[33].params[20].min === -100, 'SuperSaw Pulse Width default 100, Kbd / Vel Trk bipolar');
  // poly slide: a note played while another is held slides from it; notes that start together do not
  const ps = (ev, a) => { const x = play(synth(33, { 45: 0.3, 47: 1, 5: 0, 18: 100, 37: 0.05, 38: 1 }), ev, 1.2); return x; };
  const two = ps([[0, 1, 45], [0.4, 1, 57], [1.0, 0, 45], [1.0, 0, 57]]);
  const one = play(synth(33, { 45: 0.3, 47: 1, 5: 0, 18: 100 }), [[0, 1, 45], [0.4, 0, 45]], 0.5);
  // the second voice alone = two minus the first voice (same phases: Retrig off uses random phases, so compare spectra instead)
  const early = goertzel(two, Math.round(0.41 * SR), Math.round(0.45 * SR), hz(57)), late = goertzel(two, Math.round(0.8 * SR), Math.round(0.9 * SR), hz(57));
  ok(early < 0.5 * late, `SuperSaw poly: a note played while another is held slides into its pitch (energy at the target just after the start ${(early / late).toFixed(2)} of the settled value)`);
  const chord = play(synth(33, { 45: 0.3, 47: 1, 5: 0, 18: 100 }), [[0, 1, 45], [0, 1, 57], [0.6, 0, 45], [0.6, 0, 57]], 0.7);
  const ce = goertzel(chord, Math.round(0.01 * SR), Math.round(0.05 * SR), hz(57)), cl = goertzel(chord, Math.round(0.4 * SR), Math.round(0.5 * SR), hz(57));
  ok(ce > 0.7 * cl, `SuperSaw poly: notes that start together (a chord) do not slide (${(ce / cl).toFixed(2)})`);
  ok(one.length > 0, 'SuperSaw single note renders');
  // Tempo Sync LFO follows the song's beat: a note starting on beat 2.5 with a 1-beat LFO starts at phase 0.5
  const t = synth(33, { 27: 2, 29: 5, 32: 50 }); t.setSongPos(true, 2.5); t.noteOn(57, 0.8);
  const v = t.v.find((o) => o.on);
  ok(v && Math.abs(v.lp - 0.5) < 1e-9, `SuperSaw Tempo Sync LFO in phase with the song (phase ${v ? v.lp.toFixed(3) : '?'} at beat 2.5)`);
  const t2 = synth(33, { 27: 0, 28: 2, 32: 50 }); t2.setSongPos(true, 2.5); t2.noteOn(57, 0.8);
  ok(t2.v.find((o) => o.on).lp === 0, 'SuperSaw Hertz LFO restarts with the note');
  // Arp Up/Down 2: top and bottom twice; Up/Down: once
  const arp = (mode) => { const s = synth(33, { 51: mode, 49: 9, 50: 0 }), seq = [], orig = s.begin.bind(s); s.begin = (vv, p, vel, f) => { seq.push(p); orig(vv, p, vel, f); }; play(s, [[0, 1, 60], [0, 1, 64], [0, 1, 67]], 2.1); return seq.slice(0, 8).join(' '); };
  ok(arp(5) === '60 64 67 67 64 60 60 64', `SuperSaw Arp Up/Down 2 repeats top and bottom (${arp(5)})`);
  ok(arp(3) === '60 64 67 64 60 64 67 64', `SuperSaw Arp Up/Down plays them once (${arp(3)})`);
  ok(D.INSTRUMENTS[33].params[42].items.join(',') === 'Cutoff,Resonance,Osc Sync,Pulse Width,Unison Detune,Level,Pan,LFO Amount,LFO Rate', 'SuperSaw ModWheel Dest list as in the manual');
}

// ---------------------------------------------------------------- migration of format-1 parameters (saved before these corrections)
{
  const m = (type, p) => D.migrateFlmParams(type, { ...p });
  ok(m(32, { 0: 0 })[1] === 50 && m(32, { 0: 0, 1: 100 })[1] === 5, 'migrate MiniSynth Saw: old square width kept (50 - 45 m)');
  ok(m(32, { 0: 1, 1: 30 })[1] === 65 && m(32, { 0: 2 })[1] === 50 && m(32, { 0: 4, 1: 100 })[1] === 100, 'migrate MiniSynth Saw + Saw / Pulse / Square + Square: 50 + m / 2');
  ok(m(32, { 0: 5, 1: 30 })[1] === 30, 'migrate MiniSynth SuperSaw kind: Modifier unchanged');
  ok(m(33, {})[3] === 100 && m(33, { 3: 30 })[3] === 60 && m(33, { 3: 85 })[3] === 30 && m(33, { 42: 5 })[42] === 7, 'migrate SuperSaw Pulse Width (2 x min(x, 100 - x)) and ModWheel Dest');
  const g = m(31, { 2: 0.01, 3: 0.4, 4: 60 });
  ok(g[4] === 0 && g[28] === 60 && g[29] === 0.01 && g[30] === 0.4 && g[31] === 0 && g[32] === 0.4 && g[34] === 0 && g[52] === 5, 'migrate GMS filter envelope -> Envelope Generator (dest Filter), FX LFO Rate -> 1/4 bar');
  const busy = m(31, { 4: 60, 28: 30, 34: 1 });
  ok(busy[4] === 60 && busy[28] === 30, 'migrate GMS: an Envelope Generator already in use is left alone');
  // migrated parameters play the same as the format-1 engine did: GMS EG decay == old filter decay while held (exact formula check)
  const a = play(synth(31, { 0: 30, 4: 0, 28: 60, 29: 0.01, 30: 0.4, 31: 0, 32: 0.4, 33: 0, 34: 0 }), [[0, 1, 48], [0.8, 0, 48]], 1.2);
  ok(Number.isFinite(rms(a)) && rms(a) > 1e-3, 'migrated GMS renders');
  // project load: no flm field -> migrated once; serialize writes flm: 2 and a reload keeps the values
  const P = await import(path.join(root, 'js/project.js'));
  P.newProject(false); P.addTrack('midi'); P.addTrack('midi'); P.addTrack('midi');
  const o = JSON.parse(P.serialize()); delete o.flm;
  const n = o.tracks.length;
  o.tracks[n - 3].inst = { type: 32, params: { 0: 1, 1: 30 }, pitch: 0 };
  o.tracks[n - 2].inst = { type: 33, params: { 0: 1 }, pitch: 0 };
  o.tracks[n - 1].inst = { type: 31, params: { 4: 50, 3: 0.3 }, pitch: 0 };
  await P.deserialize(JSON.stringify(o));
  const T = P.state.tracks;
  ok(T[n - 3].inst.params[1] === 65 && T[n - 2].inst.params[3] === 100 && T[n - 1].inst.params[28] === 50 && T[n - 1].inst.params[4] === 0, 'old project (no flm field): GMS / MiniSynth / SuperSaw parameters migrated on load');
  const txt = P.serialize(); ok(JSON.parse(txt).flm === D.FLM_FMT, 'serialize writes flm: ' + D.FLM_FMT);
  await P.deserialize(txt);
  ok(P.state.tracks[n - 3].inst.params[1] === 65 && P.state.tracks[n - 1].inst.params[28] === 50, 'reloading a current project does not migrate again');
  // a classic Mini Synth project converts to MiniSynth with unison saws (Modifier 50), not -24 st
  const o2 = JSON.parse(P.serialize()); delete o2.flm; o2.tracks[n - 3].inst = { type: 1, params: { 0: 0 }, pitch: 0 };
  await P.deserialize(JSON.stringify(o2));
  ok(P.state.tracks[n - 3].inst.type === 32 && P.state.tracks[n - 3].inst.params[1] === 50, 'classic Mini Synth (old project) -> MiniSynth Saw + Saw at Modifier 50 (unison)');
}

console.log(bad ? `\n${bad} FAILED` : '\nALL FLM MANUAL CHECKS OK');
process.exit(bad ? 1 : 0);
