// Golden test scenarios. Each one drives an engine `e` (the JS engine behind a recorder) exactly like the app does: engine commands,
// and e.render(frames) to produce audio. Everything is deterministic (synthetic samples from a fixed LCG seed).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const D = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/defs.js'));

const PPQ = 960, BAR = PPQ * 4;
const PARAM_SYNTHS = [13, 14, 15, 17, 18, 16, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29];   // Live 12 instruments with a min / max sweep of every parameter
const FX_PORTED = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45];   // effects with a min / max sweep scenario (fx-<name>)
const SYNTHS = [1, 2, 5, 7, 8, 11, 13, 14, 15, 17, 16, 19, 20, 21, 22, 23, 24, 25, 26, 27];   // instruments with golden scenarios (presets + playing)
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; }; }
function tone(sec, hz, sr = 48000, amp = 0.5) { const n = Math.round(sec * sr), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.sin(2 * Math.PI * hz * i / sr) * amp * Math.min(1, (n - i) / 2000); return a; }
function noise(sec, seed, sr = 48000, amp = 0.3) { const r = lcg(seed), n = Math.round(sec * sr), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r() * amp; return a; }
function chirp(sec, f0, f1, sr = 48000) { const n = Math.round(sec * sr), a = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { ph += (f0 + (f1 - f0) * i / n) / sr; a[i] = Math.sin(2 * Math.PI * ph) * 0.4; } return a; }
// render `sec` seconds in 128-frame blocks (the AudioWorklet quantum), or in the given repeating sizes
function play(e, sec, sizes = [128]) { let left = Math.round(sec * 48000), k = 0; while (left > 0) { const n = Math.min(left, sizes[k++ % sizes.length]); e.render(n); left -= n; } }
function samples(e) {
  e.loadSample(0, tone(2, 220), tone(2, 330));      // stereo
  e.loadSample(1, noise(1.5, 7));                     // mono
  e.loadSample(2, chirp(3, 80, 2000), chirp(3, 100, 1800));
}
// clips: [start, len, sample, gain, offset s, fade in s, fade out s]
const clipsA = [0, BAR, 0, 0.8, 0, 0, 0, BAR * 1.5, BAR, 0, 1, 0.25, 0.05, 0.3, BAR * 3, BAR * 2, 2, 0.7, 0, 0.5, 0.5];
const clipsB = [PPQ / 3, PPQ * 2, 1, 1, 0, 0, 0, PPQ * 5.5, BAR, 1, 0.6, 0.2, 0.01, 0.01, BAR * 2 + 7, BAR * 2, 2, 0.5, 1.1, 0, 0];

export const SCENARIOS = [
  { name: 'core-clips', info: 'audio clips: gain, offset, fades, overlaps, vol/pan',
    run(e) {
      samples(e); e.tempo(128);
      e.trackClips(0, clipsA, 3); e.trackClips(1, clipsB, 3); e.trackVol(0, 0.7); e.trackPan(0, -0.4); e.trackVol(1, 0.9); e.trackPan(1, 0.65);
      e.play(); play(e, 9);
    } },
  { name: 'core-mixer', info: 'mute / solo during playback, sends A/B, group routing, return + master volume / pan',
    run(e) {
      samples(e); e.tempo(110);
      e.trackClips(0, clipsA, 3); e.trackClips(1, clipsB, 3); e.trackClips(2, [0, BAR * 4, 2, 1, 0, 0, 0], 1);
      e.trackSend(0, 0, 0.5); e.trackSend(1, 1, 0.8); e.trackOut(2, 1); e.trackVol(65, 0.6); e.trackPan(65, 0.3); e.trackVol(66, 1.2); e.trackPan(66, -0.5);
      e.trackVol(64, 0.8);
      e.play(); play(e, 1.5);
      e.trackSolo(1, true); play(e, 1); e.trackSolo(1, false); e.trackMute(0, true); play(e, 1); e.trackMute(0, false);
      e.trackMute(66, true); play(e, 1); e.trackMute(66, false); e.trackPan(64, 0.5); e.trackVol(64, 0.4); play(e, 2);
      e.trackOut(2, -1); e.trackSend(0, 0, 1.4); play(e, 2.5);
    } },
  { name: 'core-transport', info: 'loop, seek while playing, tempo changes, stop/play, odd render sizes',
    run(e) {
      samples(e); e.tempo(97.5);
      e.trackClips(0, clipsA, 3); e.trackClips(1, clipsB, 3);
      e.loop(true, BAR / 2 + 13, BAR * 2 + PPQ / 4); e.play(); play(e, 5, [37, 500, 128, 1000, 1]);
      e.seek(BAR * 3 + 101); play(e, 1, [128, 77]); e.tempo(143.25); play(e, 1.5, [300]); e.loop(false, 0, 0);
      e.stop(); play(e, 0.5); e.seek(PPQ * 1.5); e.play(); play(e, 2, [64]); e.tempo(60); play(e, 2);
    } },
  { name: 'core-tempomap', info: 'tempo map ramps / jumps, time signature changes, metronome, count-in',
    run(e) {
      samples(e); e.tempo(120);
      e.trackClips(0, clipsA, 3);
      e.tempoMap(true, [0, 90, BAR * 2, 150, BAR * 2, 70, BAR * 4, 120, BAR * 6, 133]);
      e.setMeter([0, 4, 4, 2, 7, 8, 4, 3, 4]); e.setMetro(true); e.setMetroVol(0.8);
      e.playCountIn(4); play(e, 10);
      e.stop(); e.setSig(PPQ / 2, 6); e.tempoMap(false, []); e.seek(0); e.playCountIn(3); play(e, 4, [128, 93]);
    } },
  { name: 'core-automation', info: 'automation lanes (volume, pan, sends) and MIDI CC lanes (volume, pan, expression)',
    run(e) {
      samples(e); e.tempo(120);
      e.trackClips(0, clipsA, 3); e.trackClips(1, clipsB, 3); e.trackSend(1, 0, 0.3);
      // lane = kind, track, dev, param, n, (tick, value) * n
      e.automation([0, 0, 0, 0, 3, 0, 0.1, BAR * 2, 1, BAR * 4, 0.3, 1, 1, 0, 0, 2, 0, -1, BAR * 5, 1, 2, 1, 0, 0, 2, 0, 0, BAR * 3, 1.2, 0, 64, 0, 0, 2, BAR, 1, BAR * 3, 0.2]);
      e.trackCC(0, [0, 1, 127, BAR * 2, 1, 20, 0, 2, 0, BAR * 3, 2, 127, BAR, 3, 100, BAR * 4, 3, 30], 6);
      e.play(); play(e, 6);
      e.seek(BAR); play(e, 2); e.trackCC(0, [], 0); e.automation([], 0); play(e, 2);
    } },
  ...instScenarios(),
  ...paramScenarios(),
  { name: 'core-limiter', info: 'master safety limiter: three loud SuperSaw tracks drive the master ~ +10 dB over 0 dBFS (limiter on), then off (hard clip), then on again',
    run(e) {
      e.tempo(128);
      for (let t = 0; t < 3; t++) { e.trackInst(t, 2); e.trackVol(t, 1.4); const f = []; for (let k = 0; k < 24; k++) f.push(k * PPQ / 2 + t * 40, PPQ * 0.45, 40 + t * 7 + ((k * 5) % 12), 1, 0); e.trackNotes(t, f, f.length / 5); }
      e.trackVol(64, 2.2); e.play(); play(e, 2, [128, 96, 256]);
      e.masterLimit(false); play(e, 1); e.masterLimit(true); play(e, 1.5, [128, 77]);
      e.stop(); play(e, 0.5);
    } },
  { name: 'core-mute-fade', info: 'mute / unmute / solo / send jumps while notes sound: the mute ramp and the smoothed send levels',
    run(e) {
      e.tempo(120); for (let t = 0; t < 3; t++) { e.trackInst(t, t === 1 ? 2 : 1); e.trackNotes(t, [0, PPQ * 32, 52 + t * 5, 0.8, 0, PPQ * 2, PPQ * 8, 64 + t, 0.7, 0], 2); }
      e.insertDevice(65, 0, 7); e.trackSend(0, 0, 0.2); e.play(); play(e, 0.4, [128, 50]);
      e.trackMute(0, true); play(e, 0.3, [128, 33]); e.trackMute(0, false); play(e, 0.3); e.trackSolo(2, true); play(e, 0.4, [77]); e.trackSolo(2, false);
      e.trackSend(0, 0, 1.2); e.trackSend(1, 1, 0.8); play(e, 0.4); e.trackSend(0, 0, 0); play(e, 0.6, [128, 200]); e.trackMute(1, true); play(e, 0.2); e.stop(); play(e, 0.5);
    } },
  { name: 'core-retrigger', info: 'the same pitch retriggered while it still sounds (long release) and voices stolen: the envelope restarts from its current level',
    run(e) {
      e.tempo(140); e.trackInst(0, 1); e.trackInst(1, 2); e.instParam(0, 6, 0.8);
      const f = []; for (let k = 0; k < 48; k++) f.push(k * PPQ / 4, PPQ * 0.6, 60 + (k % 3 === 0 ? 0 : 7), 0.9, 0); e.trackNotes(0, f, f.length / 5);
      const g = []; for (let k = 0; k < 40; k++) g.push(k * PPQ / 8, PPQ * 2, 48 + (k % 20), 0.8, 0); e.trackNotes(1, g, g.length / 5);
      e.play(); play(e, 3, [128, 64, 200]); e.stop(); play(e, 0.5);
    } },
  { name: 'core-pdc', info: 'plugin delay compensation: Limiter / Saturator / Compressor look-ahead on tracks, a send return, a group return and the master; latency changes (bypass, Lookahead, insert / remove) while playing, metronome + count-in, loop seam, mute, PDC off / on',
    run(e) {
      samples(e); e.tempo(126); e.setMetro(true); e.setMetroVol(0.6);
      e.trackClips(0, clipsA, 3); e.trackClips(1, clipsB, 3); e.trackInst(2, 1); const f = []; for (let k = 0; k < 32; k++) f.push(k * PPQ / 2, PPQ * 0.4, 48 + ((k * 7) % 24), 0.8, 0); e.trackNotes(2, f, f.length / 5);
      e.insertDevice(0, 0, 5); e.insertDevice(1, 0, 3); e.devParam(1, 0, 0, 12);                     // track 0 Limiter (72), track 1 Saturator (37)
      e.insertDevice(2, 0, 4); [-24, 4, 2, 80].forEach((v, k) => e.devParam(2, 0, k, v)); e.devParam(2, 0, 9, 1);   // track 2 Compressor, Lookahead 1 ms
      e.trackSend(0, 0, 0.6); e.trackSend(2, 0, 0.3); e.insertDevice(65, 0, 3); e.devParam(65, 0, 1, 0.5);   // Return A: Saturator
      e.trackOut(1, 1); e.insertDevice(66, 0, 4); e.devParam(66, 0, 9, 2);                         // track 1 grouped into Return B: Compressor 10 ms
      e.insertDevice(64, 0, 3); e.devParam(64, 0, 1, 0.3);                                          // master: Saturator
      e.playCountIn(4); play(e, 2.4, [128, 96, 256]);
      e.devParam(2, 0, 9, 2); play(e, 0.6); e.devBypass(0, 0, true); play(e, 0.5, [128, 77]); e.devBypass(0, 0, false); play(e, 0.5);
      e.trackMute(1, true); play(e, 0.4); e.trackMute(1, false); play(e, 0.4);
      e.setPdc(false); play(e, 0.5); e.setPdc(true); play(e, 0.5);
      e.removeDevice(66, 0); play(e, 0.4); e.insertDevice(3, 0, 5); e.trackClips(3, [0, BAR * 8, 2, 0.6, 0, 0, 0], 1); play(e, 0.4);
      e.loop(true, BAR, BAR * 2); e.seek(BAR); play(e, 4.5, [128, 333]); e.loop(false, 0, 0);
      e.stop(); play(e, 0.6);
    } },
  ...fxScenarios(),
  { name: 'fx-autoduck-sc', info: 'Autoduck: track 2 (short bass notes) ducks the pad on track 1; source / threshold / amount / attack / release changes while playing',
    run(e) {
      e.tempo(124); e.trackInst(0, 2); e.trackInst(1, 1);
      const pad = []; for (let k = 0; k < 4; k++) pad.push(k * PPQ * 4, PPQ * 3.9, 55 + k * 2, 0.7, 0); e.trackNotes(0, pad, pad.length / 5);
      const kick = []; for (let k = 0; k < 16; k++) kick.push(k * PPQ, PPQ * 0.2, 36, 1, 0); e.trackNotes(1, kick, kick.length / 5);
      e.insertDevice(0, 0, 10); [2, -40, 18, 3, 150].forEach((v, k) => e.devParam(0, 0, k, v));
      e.play(); play(e, 2, [128, 77, 256]);
      e.devParam(0, 0, 1, -12); e.devParam(0, 0, 3, 40); play(e, 1);
      e.devParam(0, 0, 2, 48); e.devParam(0, 0, 4, 900); play(e, 1, [128, 333]);
      e.devParam(0, 0, 0, 1); play(e, 0.5); e.devParam(0, 0, 0, 0); play(e, 0.5);
      e.stop(); play(e, 0.5);
    } },
  { name: 'demo-ghibli', info: 'demo song Ghibli Sky (SoundFont + Osphere)', run: (e, o) => demo(e, o, 'ghibli-sky.mdaw', 30) },
  { name: 'demo-meadow', info: 'demo song Meadow Wind (SoundFont + Osphere)', run: (e, o) => demo(e, o, 'meadow-wind.mdaw', 30) },
];

// Demo song, loaded like tools/bench.mjs does (instruments, devices, notes, mixer). Renders the first `sec` seconds.
async function demo(e, { root }, file, sec) {
  const { parseSf2 } = await import(path.join(root, 'js/engine/sf2.js'));
  const j = JSON.parse(fs.readFileSync(path.join(root, 'demos', file), 'utf8'));
  e.tempo(j.bpm); const sfs = new Map();
  const dev = (strip, d) => { const di = e.engine.s[strip].dev.length; e.insertDevice(strip, di, d.type); d.params.forEach((v, pi) => e.devParam(strip, di, pi, v)); if (d.bypass) e.devBypass(strip, di, true); };
  (j.master.devices || []).forEach((d) => dev(64, d));
  (j.returns || []).forEach((r, k) => { e.trackVol(65 + k, r.vol); (r.devices || []).forEach((d) => dev(65 + k, d)); });
  let i = 0;
  for (const t of j.tracks) {
    if (t.kind !== 'midi' || !t.inst) continue;
    e.trackInst(i, t.inst.type);
    for (const [k, v] of Object.entries(t.inst.params || {})) e.instParam(i, +k, v);
    if (t.inst.sf) {
      let id = sfs.get(t.inst.sf.path);
      if (id === undefined) { id = sfs.size; const b = fs.readFileSync(path.join(root, 'demos', t.inst.sf.path.replace(/^\//, ''))); e.loadSoundFont(id, parseSf2(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))); sfs.set(t.inst.sf.path, id); }
      e.instParam(i, 100, id); e.instParam(i, 1, t.inst.sf.preset);
    }
    (t.devices || []).forEach((d) => dev(i, d));
    e.trackVol(i, t.vol ?? 0.85); e.trackPan(i, t.pan || 0);
    if (t.send) { e.trackSend(i, 0, t.send[0]); e.trackSend(i, 1, t.send[1]); }
    const f = []; let n = 0;
    for (const c of t.clips) for (const nt of c.notes || []) { f.push(c.start + nt.t, nt.d, nt.p, nt.v, nt.pan || 0); n++; }
    e.trackNotes(i, f, n); i++;
  }
  e.play(); play(e, sec);
}

// Instruments: (1) every factory preset in turn (fresh track per preset, chord + melody with different velocities),
// (2) one patch played with parameter automation, the pitch parameter (90), CC pitch bend, live preview notes and preset changes mid-note.
function instScenarios() {
  const out = [];
  for (const t of SYNTHS) {
    const def = D.INSTRUMENTS[t]; if (!def) continue;
    const key = def.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const presets = D.PRESETS[t] || [];
    const apply = (e, p) => def.params.forEach((q, k) => e.instParam(0, k, p[k] ?? q.def));
    const notes = () => { const f = []; for (const n of [48, 52, 55, 60]) f.push(0, PPQ * 1.5, n, 0.8, 0); [72, 74, 76, 79].forEach((n, i) => f.push(PPQ * (0.25 + i * 0.4), PPQ * 0.3, n, 0.35 + i * 0.2, (i - 1.5) / 2)); return f; };
    if (presets.length) out.push({ name: 'presets-' + key, info: `${def.name}: all ${presets.length} factory presets`, run(e) {
      e.tempo(120);
      for (const pr of presets) { e.resetTrack(0); e.trackInst(0, t); apply(e, pr.p); const f = notes(); e.trackNotes(0, f, f.length / 5); e.seek(0); e.play(); play(e, 1.5); e.stop(); }
    } });
    out.push({ name: 'play-' + key, info: `${def.name}: automation, pitch, bend, preview, preset change mid-note`, run(e) {
      e.tempo(100); e.trackInst(0, t); apply(e, (presets[3] || {}).p || {});
      const f = []; for (let k = 0; k < 24; k++) f.push(k * PPQ / 2, PPQ * (k % 3 ? 0.4 : 1.2), 45 + ((k * 7) % 24), 0.3 + (k % 5) * 0.15, k % 2 ? 0.3 : -0.3);
      e.trackNotes(0, f, f.length / 5);
      const p1 = def.params.findIndex((q) => q.max > q.min && !q.step), q1 = def.params[p1 < 0 ? 0 : p1];
      e.automation([5, 0, 0, p1 < 0 ? 0 : p1, 3, 0, q1.min, BAR, q1.max, BAR * 3, (q1.min + q1.max) / 2, 5, 0, 0, 90, 2, BAR * 2, 0, BAR * 2 + 1, 5]);
      e.trackCC(0, [0, 0, 0, BAR, 0, 1, BAR * 1.5, 0, -0.5], 3);
      e.play(); play(e, 3);
      e.preview(0, 64, 0.9, true); play(e, 0.3); e.bend(0, 1.5); play(e, 0.3); e.preview(0, 64, 0, false);
      if (presets[10]) apply(e, presets[10].p);
      play(e, 2); e.stop(); play(e, 1);
    } });
  }
  return out;
}

// Live 12 instruments: every parameter in turn at its minimum and maximum (all modes / switches / branches), a chord + low and high notes,
// released; sample-based ones get a test sample in every slot (Impulse: zones 0..7 on C3..G3, Granulator III: zone 0).
function testSample(e) {
  const n = 48000, l = new Float32Array(n), r = new Float32Array(n); let ph = 0, seed = 9;
  for (let i = 0; i < n; i++) { const t = (i % 12000) / 48000, a = [0.5, 0.15, 0.4, 0.1][Math.floor(i / 12000)], env = Math.exp(-t * 6) * a; ph += 220 / 48000; seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const x = ((ph % 1) * 2 - 1) * env + (seed / 4294967296 - 0.5) * Math.exp(-t * 60) * a * 2; l[i] = x; r[i] = x * 0.9; }
  e.loadSample(3, l, r);
}
function paramScenarios() {
  return PARAM_SYNTHS.filter((t) => D.INSTRUMENTS[t]).map((t) => {
    const def = D.INSTRUMENTS[t], key = def.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return { name: 'params-' + key, info: `${def.name}: every parameter at min and max`, run(e) {
      e.tempo(120); const smp = def.sampler; if (smp) testSample(e);
      const notes = smp && def.slots ? [60, 61, 62, 63, 64, 65, 66, 67] : [36, 48, 55, 64, 84];
      const base = () => { def.params.forEach((q, k) => e.instParam(0, k, q.def)); if (smp) for (let z = 0; z < (def.slots || 1); z++) { e.instParam(0, 200 + z * 16, 3); e.instParam(0, 201 + z * 16, 60); } };
      const hit = () => { const f = []; notes.forEach((nn, j) => f.push(j * 60, PPQ * 0.8, nn, 0.3 + (j % 4) * 0.2, 0)); e.trackNotes(0, f, f.length / 5); e.seek(0); e.play(); play(e, 0.9, [128, 64, 200]); e.stop(); play(e, 0.15); };
      e.resetTrack(0); e.trackInst(0, t); base(); hit();
      def.params.forEach((q, k) => { if (q.hidden) return; for (const v of [q.min, q.max]) { base(); e.instParam(0, k, v); hit(); } });
    } };
  });
}

// Effects: a SuperSaw + DS Kick pattern through the effect; every parameter in turn at its minimum, maximum and a middle value (plus the
// defaults first), the effect instance kept between settings (state carries over, as in a real session); render sizes vary.
function fxScenarios() {
  return FX_PORTED.filter((t) => D.DEVICES[t]).map((t) => {
    const def = D.DEVICES[t], key = def.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return { name: 'fx-' + key, info: `${def.name}: every parameter at min / max / middle`, run(e) {
      e.tempo(120); e.trackInst(0, 2);
      const f = []; for (let k = 0; k < 16; k++) f.push(k * PPQ / 2, PPQ * 0.45, 48 + ((k * 5) % 19), 0.4 + (k % 4) * 0.15, 0); e.trackNotes(0, f, f.length / 5);
      e.insertDevice(0, 0, t); const base = () => def.params.forEach((q, k) => e.devParam(0, 0, k, q.def));
      base(); e.seek(0); e.play(); play(e, 1, [128, 64, 200]);
      def.params.forEach((q, k) => { if (q.hidden) return; for (const v of [q.min, q.max, q.min + (q.max - q.min) * 0.37]) { base(); e.devParam(0, 0, k, v); play(e, 0.35, [128, 96]); } });
      e.stop(); play(e, 0.5);
    } };
  });
}
