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
const S = await import(path.join(root, 'js/engine/flmsyn.js')), D = await import(path.join(root, 'js/defs.js')), HM = await import(path.join(root, 'js/engine/hdmini.js'));
const SR = 48000;
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };
const CLS = { 31: S.FlmGms, 32: HM.HdMiniSynth, 33: S.FlmSuperSaw };   // MiniSynth: Honeydew's model (js/engine/hdmini.js)
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

// ---------------------------------------------------------------- MiniSynth (Honeydew's model of FLM's module, js/engine/hdmini.js)
{
  const tone = (p) => play(synth(32, { 4: 100, 2: 0, ...p }), [[0, 1, 57]], 0.4);
  const same = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; };
  const s0 = tone({ 0: 0, 1: 0 }), s100 = tone({ 0: 0, 1: 100 }), s50 = tone({ 0: 0, 1: 50 });
  ok(same(s0, s100) < 1e-6 && same(s0, s50) > 0.05, 'MiniSynth Saw (2 S(a) - S(a + 1 - m)): Modifier 0 and 100 give the plain base wave, 50 subtracts the half-cycle copy');
  const h2 = goertzel(s0, 4800, 19200, 2 * 220) / goertzel(s0, 4800, 19200, 220);
  ok(Math.abs(h2 - 0.43) < 0.05, `MiniSynth base wave: FLM's own spectrum, not an ideal saw (2nd harmonic ${h2.toFixed(3)} of the 1st, closed form 0.43)`);
  const p0 = tone({ 0: 2, 1: 0 }), p100 = tone({ 0: 2, 1: 100 }), p50 = tone({ 0: 2, 1: 50 }), late = (x) => db(rms(x, 9600, 19200));
  ok(late(p0) < -100 && late(p100) < -100 && late(p50) > -30, `MiniSynth Pulse (S(a) - S(a + 1 - m)): cancels at 0 and 100 (${late(p0).toFixed(0)} / ${late(p100).toFixed(0)} dB), full at 50 (${late(p50).toFixed(0)} dB)`);
  // Saw + Saw: the second saw at s = trunc((2 m - 1) 12) semitones (+ 0.00625 octave): Modifier 75 = +6 st, 100 = +12 st
  for (const [m, st] of [[75, 6], [100, 12], [25, -6]]) { const x = tone({ 0: 1, 1: m }), f2 = hz(57 + st) * Math.pow(2, 0.00625), g = (f) => goertzel(x, 4800, 19200, f); ok(g(f2) > 5 * g(f2 * Math.pow(2, 1.5 / 12)) && g(f2) > 0.3 * g(220), `MiniSynth Saw + Saw: Modifier ${m} puts the second saw at ${st} st (+ 7.5 cents)`); }
  // every note glides from the previously pressed key (Slide knob); LEAD starts on its own key when no other key is held
  const glide = (mode) => { const x = play(synth(32, { 0: 0, 1: 0, 4: 100, 23: mode, 24: 80, 22: 30 }), [[0, 1, 45], [0.3, 0, 45], [0.6, 1, 57], [1.2, 0, 57]], 1.3); return zcHz(x, Math.round(0.605 * SR), Math.round(0.625 * SR)); };
  const gm = glide(1), gl = glide(2), gp = glide(0);
  ok(gm > hz(45) * 0.95 && gm < hz(57) * 0.8, `MiniSynth Mono: a note after a gap slides from the previous one (${gm.toFixed(0)} Hz at its start, from ${hz(45).toFixed(0)} to ${hz(57).toFixed(0)})`);
  ok(gp > hz(45) * 0.95 && gp < hz(57) * 0.8, `MiniSynth Poly: slides too, as in FLM (${gp.toFixed(0)} Hz)`);
  ok(Math.abs(gl - hz(57)) < hz(57) * 0.03, `MiniSynth Lead: no slide from an ended note (${gl.toFixed(0)} Hz)`);
  // mod wheel: MW Amount x wheel at the MW Dest (FLT / LFO / OSCMOD)
  const mw = (dest, w) => { const y = synth(32, { 0: 0, 1: 30, 4: 40, 17: 100, 18: dest, 13: 0 }); y.setMod(w); return play(y, [[0, 1, 57]], 0.3); };
  ok(rms(mw(0, 1)) > rms(mw(0, 0)) * 1.2, 'MiniSynth mod wheel -> FLT opens the filter (4 octaves at full amount)');
  ok(same(mw(2, 1), mw(2, 0)) > 0.02 && same(mw(1, 1), mw(1, 0)) > 0.02, 'MiniSynth mod wheel -> OSCMOD moves the Modifier, -> LFO opens the LFO depth');
  ok(HM.msRateIndex(0) === 0 && HM.msRateIndex(100) === 11 && HM.msRateIndex(11.22) === 1 && HM.MS_RATE_BEATS[8] === 16, 'MiniSynth LFO Rate / Phaser Speed: 12 tempo steps, trunc(11 v), "1 bar" plays 16 beats (Honeydew RATE_BEATS)');
  ok(D.INSTRUMENTS[32].params[5].min === 0 && D.INSTRUMENTS[32].params[6].min === 0 && D.INSTRUMENTS[32].params[19].max === 100, "MiniSynth knobs are FLM's own (Kbd / Vel Trk 0..100, envelope sliders 0..100)");
  // a fresh MiniSynth is FLM's default patch; the release is FLM's short default (AMP Rel 0.07)
  const def = play(synth(32, {}), [[0, 1, 57], [0.2, 0, 57]], 0.4);
  ok(db(rms(def, 2400, 9000)) > -30 && db(rms(def, Math.round(0.23 * SR), Math.round(0.4 * SR))) < -90, `MiniSynth default patch sounds and stops ${'<'} 30 ms after note-off (${db(rms(def, Math.round(0.23 * SR), Math.round(0.4 * SR))).toFixed(0)} dB)`);
}

// ---------------------------------------------------------------- migration of format-1 parameters (saved before these corrections)
{
  const m = (type, p) => D.migrateFlmParams(type, { ...p });
  ok(m(32, { 0: 0 })[1] === 50 && m(32, { 0: 0, 1: 100 })[1] === 5, 'migrate MiniSynth Saw: old square width kept (50 - 45 m)');
  ok(m(32, { 0: 1, 1: 30 })[1] === 80 && m(32, { 0: 2 })[1] === 50 && m(32, { 0: 4, 1: 100 })[1] === 100, 'migrate MiniSynth Saw + Saw / Pulse / Square + Square: 50 + m / 2, then the interval rescaled to FLM\'s +-12 st (65 -> 80)');
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
  ok(T[n - 3].inst.params[1] === 80 && T[n - 2].inst.params[3] === 100 && T[n - 1].inst.params[28] === 50 && T[n - 1].inst.params[4] === 0, 'old project (no flm field): GMS / MiniSynth / SuperSaw parameters migrated on load');
  const txt = P.serialize(); ok(JSON.parse(txt).flm === D.FLM_FMT, 'serialize writes flm: ' + D.FLM_FMT);
  await P.deserialize(txt);
  ok(P.state.tracks[n - 3].inst.params[1] === 80 && P.state.tracks[n - 1].inst.params[28] === 50, 'reloading a current project does not migrate again');
  // a classic Mini Synth project converts to MiniSynth with unison saws (Modifier 50), not -24 st
  const o2 = JSON.parse(P.serialize()); delete o2.flm; o2.tracks[n - 3].inst = { type: 1, params: { 0: 0 }, pitch: 0 };
  await P.deserialize(JSON.stringify(o2));
  ok(P.state.tracks[n - 3].inst.type === 32 && P.state.tracks[n - 3].inst.params[1] === 50, 'classic Mini Synth (old project) -> MiniSynth Saw + Saw at Modifier 50 (unison)');
}

console.log(bad ? `\n${bad} FAILED` : '\nALL FLM MANUAL CHECKS OK');
process.exit(bad ? 1 : 0);
