// Golden test scenarios. Each one drives an engine `e` (the JS engine behind a recorder) exactly like the app does: engine commands,
// and e.render(frames) to produce audio. Everything is deterministic (synthetic samples from a fixed LCG seed).
import fs from 'node:fs'; import path from 'node:path';

const PPQ = 960, BAR = PPQ * 4;
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
