// Builds the tutorial showcase song demos/progressive-house.mdaw: "Neon Horizon", an original progressive house track, 128 BPM, F minor,
// 64 bars = 2:00 (a radio edit), produced the way a professional progressive house record is put together, with MobileDAW's built-in
// instruments (FL Studio Mobile's SuperSaw, MiniSynth, GMS), stock effects, CC0 drum samples from the Stargate DAW sample pack and
// transition FX synthesized for the song (demos/Samples/NH *.wav, credited in demos/README.txt). Built through the app's own project API
// in Chromium, so the file is exactly what the app writes.
//
// Arrangement (bars): Intro 1-8 (kick, tops, filtered pad) | Build 9-16 (sub + rolling bass, clap, fill) | Groove 17-24 (stabs, arp
// opening, percussion, drop-out) | Breakdown 25-32 (no kick: pad + hook, then the build: kick roll, snare roll, noise + synth risers,
// music bus high-pass, one beat of silence) | Drop 33-48 (everything, crash + impact + sub drop) | Drop B 49-56 (hook an octave up,
// ride, bongos) | Outro 57-64 (strip-down, final hit and tail).
// Harmony: Fm9 - Dbmaj7 - Ab(add9) - Eb(sus4 -> Eb), two bars each, voiced around a common C / Eb on top. The hook repeats one rhythm on
// every chord (call and answer), the arp counter-plays 16ths. Mix: drums -> Drum Bus (glue + saturation), the musical parts -> Music Bus
// (sidechained to the kick as a whole, glue), sub on its own with a harder duck; master: EQ, glue, limiter to a measured loudness.
// Usage: node tools/make-proghouse.mjs [--render out.wav]   (LIM_GAIN=<dB> overrides the master limiter's input gain for a render)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
await new Promise((o) => server.once('listening', o));
const b = await chromium.launch(), page = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, floatPlugins: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted); await page.waitForTimeout(800);
const renderTo = (process.argv.includes('--render') && process.argv[process.argv.indexOf('--render') + 1]) || null;
const SAMPLES = ['NH Kick', 'NH Clap', 'NH Snare', 'NH Snare Layer', 'NH Hat Closed', 'NH Hat Open', 'NH Shaker', 'NH Rim', 'NH Bongo', 'NH Crash', 'NH Ride', 'NH Noise Riser', 'NH FX Reverse Crash', 'NH FX Sub Drop', 'NH FX Impact', 'NH FX Downlifter'];

const out = await page.evaluate(async ({ render, SAMPLES }) => {
  const P = await import('./js/project.js'), { PRESETS, DEVICES, normOf } = await import('./js/defs.js'), { eng } = await import('./js/engine.js');
  const PPQ = 960, BEAT = PPQ, BAR = 4 * BEAT, bar = (n) => (n - 1) * BAR, sec2beats = (s) => s * 128 / 60;
  P.newProject(false); P.HK.on = false;
  for (const n of SAMPLES) await eng.saveBytes('/Samples/Demo/' + n + '.wav', await (await fetch('demos/Samples/' + encodeURIComponent(n) + '.wav')).arrayBuffer());
  const smp = (n) => '/Samples/Demo/' + n + '.wav';
  P.setBpm(128); P.state.projectName = 'Neon Horizon (Progressive House Showcase)';
  const preset = (i, type, name) => { const p = (PRESETS[type] || []).find((x) => x.name === name); if (!p) throw new Error('preset ' + name); P.applyPreset(i, p); };
  const track = (kind, name, color, vol) => { P.addTrack(kind); const i = P.state.tracks.length - 1; P.renameTrack(i, name); P.state.tracks[i].color = color; P.setVol(i, vol); return i; };
  const strip = (i) => (i === 64 ? P.state.master : i >= 65 ? P.state.returns[i - 65] : P.state.tracks[i]);
  const dev = (i, type, params = {}) => { P.addDevice(i, type); const di = strip(i).devices.length - 1; for (const [k, v] of Object.entries(params)) P.setDeviceParam(i, di, +k, v); return di; };
  // EQ Eight: bands [type, freq, gain, q] from band 1 (types: 0 Low Cut 48, 1 Low Cut 12, 2 Low Shelf, 3 Bell, 5 High Shelf, 6 High Cut 12)
  const eq = (i, bands) => { const ps = {}; for (let k = 0; k < 8; k++) ps[k * 5] = 0; bands.forEach(([ty, f, g, q], k) => { ps[k * 5] = 1; ps[k * 5 + 1] = ty; ps[k * 5 + 2] = f; ps[k * 5 + 3] = g || 0; ps[k * 5 + 4] = q || 0.71; }); return dev(i, 31, ps); };
  // a clip of explicit notes [beat, len beats, pitch, vel] from bar `from` for `bars` bars (loopBars: the pattern repeats every loopBars)
  const clip = (i, from, bars, notes, name, loopBars) => {
    const c = P.addClip(i, bar(from), bars * BAR); c.name = name || '';
    c.notes = notes.filter((n) => n[0] >= 0 && n[0] < (loopBars || bars) * 4).map(([bt, len, p, v]) => ({ t: Math.round(bt * BEAT), d: Math.max(30, Math.round(len * BEAT)), p, v: Math.max(0.05, Math.min(1, v)) }));
    if (loopBars && loopBars < bars) { c.ll = loopBars * BAR; c.pb = loopBars * BAR; } else c.pb = bars * BAR;
    P.clipChanged(i); return c;
  };
  // notes for bars [a, b] of the song: fn(barNumber, beatOffsetInClip) -> notes
  const span = (a, b2, fn) => { const o = []; for (let n = a; n <= b2; n++) o.push(...fn(n, (n - a) * 4)); return o; };
  const steps = (off, list) => list.map(([s, len, p, v]) => [off + s / 4, len / 4, p, v]);   // 16th steps -> beats
  const chordOf = (n) => Math.floor(((n - 1) % 8) / 2);                                     // 0 Fm9, 1 Dbmaj7, 2 Ab(add9), 3 Eb
  // ---- harmony
  const VO = [[56, 60, 63, 67], [53, 56, 60, 65], [56, 60, 63, 70], [55, 58, 63, 67]], SUS = [56, 58, 63, 68];
  const voicing = (n) => (chordOf(n) === 3 && (n - 1) % 2 === 0 ? SUS : VO[chordOf(n)]);
  const ROOT = [41, 37, 44, 39];

  // =========================================================================================== drums
  // Kick: four on the floor, a fill gap at the end of each 8 / 16, a kick roll in the build, silence on the last beat before the drop
  const kick = track('drum', 'Kick', '#ff5f4a', 0.36); await P.setPadSample(kick, 0, smp('NH Kick'));
  const K = 36, four = (o, skip = []) => [0, 1, 2, 3].filter((x) => !skip.includes(x)).map((x) => [o + x, 0.25, K, 1]);
  clip(kick, 1, 24, span(1, 24, (n, o) => four(o, n === 16 ? [3] : n === 24 ? [2, 3] : [])), 'Kick');
  clip(kick, 29, 4, span(29, 32, (n, o) => n <= 30 ? four(o) : n === 31 ? [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [o + k / 2, 0.2, K, 0.75 + k * 0.02]) : [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [o + k / 4, 0.12, K, 0.8 + k * 0.025])), 'Kick Roll');
  clip(kick, 33, 30, span(33, 62, (n, o) => four(o, n === 48 || n === 56 ? [3] : [])), 'Kick');
  clip(kick, 63, 1, [[0, 0.25, K, 1]], 'Final Hit');
  eq(kick, [[1, 30], [3, 300, -3, 1.2], [3, 4200, 2.5, 1.2]]);                        // tidy rumble, less box, more click (the sub carries the lows)
  // Claps (clap + snare layer on 2 and 4), fills, the snare roll of the build
  const cl = track('drum', 'Claps', '#ffb347', 0.75);
  for (const [k, n] of [[1, 'NH Snare'], [2, 'NH Clap'], [5, 'NH Snare Layer']]) await P.setPadSample(cl, k, smp(n));
  const SN = 38, CP = 39, SL = 41;
  const backbeat = (o, v = 0.95) => [[o + 1, 0.25, CP, v], [o + 1, 0.25, SL, v * 0.55], [o + 3, 0.25, CP, v], [o + 3, 0.25, SL, v * 0.55]];
  const fill = (o, from) => [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => k / 4 >= from).map((k) => [o + 2 + k / 4, 0.1, SN, 0.55 + k * 0.05]);
  clip(cl, 9, 16, span(9, 24, (n, o) => [...backbeat(o), ...(n === 16 ? fill(o, 1) : n === 24 ? fill(o, 0) : [])]), 'Claps');
  clip(cl, 29, 4, span(29, 32, (n, o) => n === 32 ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => [o + k / 4, 0.08, SN, 0.7 + k * 0.025]) : (n === 31 ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3]).map((k, j, a) => [o + k * (4 / a.length), 0.12, SN, 0.4 + (n - 29) * 0.12 + j * 0.01])), 'Snare Roll');
  clip(cl, 33, 30, span(33, 62, (n, o) => [...backbeat(o), ...(n === 40 || n === 48 || n === 56 ? fill(o, 1) : [])]), 'Claps');
  clip(cl, 63, 1, [[0, 0.25, CP, 1], [0, 0.25, SL, 0.6]], 'Final Hit');
  eq(cl, [[0, 180], [3, 900, -2, 1], [5, 9000, 2, 0.7]]);
  // Hats: closed 16ths with an accented offbeat and a human velocity curve, open hats on the offbeat in the grooves (cut group: the
  // closed hat chokes the open one, as on a real kit)
  const ht = track('drum', 'Hats', '#ffd166', 0.27);
  await P.setPadSample(ht, 3, smp('NH Hat Closed')); await P.setPadSample(ht, 4, smp('NH Hat Open'));
  P.setPad(ht, 3, 'cut', 1); P.setPad(ht, 4, 'cut', 1);
  const HC = 42, HO = 46, ACC = [0.32, 0.5, 0.9, 0.5];
  const sixteen = (o, open, scale = 1) => [...[...Array(16).keys()].filter((s) => !(open && s % 4 === 2)).map((s) => [o + s / 4, 0.1, HC, ACC[s % 4] * scale * (0.92 + 0.08 * Math.sin(s * 1.7))]), ...(open ? [0, 1, 2, 3].map((x) => [o + x + 0.5, 0.4, HO, 0.7 * scale]) : [])];
  clip(ht, 1, 8, span(1, 8, (n, o) => n <= 4 ? [0, 1, 2, 3].map((x) => [o + x + 0.5, 0.1, HC, 0.8]) : sixteen(o, false, 0.85)), 'Hats Intro');
  clip(ht, 9, 16, span(9, 24, (n, o) => sixteen(o, n >= 17, n >= 17 ? 1 : 0.9)), 'Hats');
  clip(ht, 31, 2, span(31, 32, (n, o) => sixteen(o, false, 0.5 + (n - 31) * 0.2).filter((x) => n === 31 || x[0] < o + 3)), 'Hats Build');
  clip(ht, 33, 30, span(33, 62, (n, o) => sixteen(o, true)), 'Hats');
  eq(ht, [[0, 450], [3, 7500, -1.5, 1]]);
  // Percussion: shaker 16ths, rim ghosts, bongos in Drop B
  const pc = track('drum', 'Percussion', '#9be15d', 0.4);
  const ps = await P.addPadSample(pc, smp('NH Shaker')), pr = await P.addPadSample(pc, smp('NH Rim')), pb = await P.addPadSample(pc, smp('NH Bongo'));
  const SH = P.state.tracks[pc].inst.pads[ps.k].pitch, RM = P.state.tracks[pc].inst.pads[pr.k].pitch, BG = P.state.tracks[pc].inst.pads[pb.k].pitch;
  P.setPad(pc, ps.k, 'pan', 0.25); P.setPad(pc, pr.k, 'pan', -0.2); P.setPad(pc, pb.k, 'pan', -0.3);
  const shaker = (o) => [...Array(16).keys()].map((s) => [o + s / 4, 0.1, SH, [0.35, 0.55, 0.45, 0.65][s % 4]]);
  const rim = (o, n) => (n % 2 ? [[o + 1.75, 0.1, RM, 0.55], [o + 3.5, 0.1, RM, 0.4]] : [[o + 0.75, 0.1, RM, 0.45], [o + 2.75, 0.1, RM, 0.55]]);
  const bongo = (o) => [[o + 0.75, 0.2, BG, 0.6], [o + 1.5, 0.2, BG, 0.5], [o + 2.75, 0.2, BG, 0.65], [o + 3.25, 0.2, BG, 0.45]];
  clip(pc, 17, 8, span(17, 24, (n, o) => [...shaker(o), ...rim(o, n)]), 'Perc');
  clip(pc, 33, 30, span(33, 62, (n, o) => [...shaker(o), ...rim(o, n), ...(n >= 49 && n <= 56 ? bongo(o) : [])]), 'Perc');
  eq(pc, [[0, 300]]);
  // Cymbals: a crash on each section's downbeat, ride in Drop B
  const cy = track('drum', 'Cymbals', '#f6e05e', 0.3);
  const cr = await P.addPadSample(cy, smp('NH Crash')), rd = await P.addPadSample(cy, smp('NH Ride'));
  const CR = P.state.tracks[cy].inst.pads[cr.k].pitch, RD = P.state.tracks[cy].inst.pads[rd.k].pitch;
  for (const b0 of [9, 17, 33, 41, 57, 63]) clip(cy, b0, 1, [[0, 2, CR, b0 === 63 ? 1 : 0.85]], 'Crash');
  clip(cy, 49, 8, span(49, 56, (n, o) => [...(n === 49 ? [[o, 2, CR, 0.9]] : []), ...[0, 1, 2, 3].map((x) => [o + x, 0.5, RD, x % 2 ? 0.45 : 0.6])]), 'Ride');
  eq(cy, [[0, 350]]);

  // =========================================================================================== bass
  // Sub: offbeat eighths on the chord root, mono, ducked hard by the kick
  const sub = track('midi', 'Sub Bass', '#3a86ff', 1.05); P.setInstrument(sub, 32); preset(sub, 32, 'Triangle Sub');
  const subLine = (n, o) => [0, 1, 2, 3].map((x) => [o + x + 0.5, 0.42, ROOT[chordOf(n)] - 12, 0.95]);
  clip(sub, 9, 16, span(9, 24, (n, o) => subLine(n, o).filter((x) => !(n === 24 && x[0] >= o + 2))), 'Sub');
  clip(sub, 33, 28, span(33, 60, subLine), 'Sub');
  dev(sub, 0, { 3: 1, 0: 10 });                                                         // Utility: mono, +8 dB (the preset is quiet)
  dev(sub, 10, { 0: kick + 1, 1: -36, 2: 20, 3: 1, 4: 140 });                           // Autoduck from the kick: deep, fast release
  eq(sub, [[1, 22], [6, 200]]);
  // Mid bass: the rolling 16ths (root - octave - root) that drive progressive house; high-passed, so the sub owns the lows
  const mb = track('midi', 'Mid Bass', '#4fd1ff', 1.4); P.setInstrument(mb, 32); preset(mb, 32, 'Round Saw Bass');
  const roll = (n, o) => [0, 1, 2, 3].flatMap((x) => { const r = ROOT[chordOf(n)], last = (n % 2 === 0) && x === 3; return [[o + x + 0.25, 0.2, r, 0.8], [o + x + 0.5, 0.22, r + 12, 0.95], [o + x + 0.75, 0.2, last ? ROOT[(chordOf(n) + 1) % 4] : r, 0.75]]; });
  clip(mb, 9, 16, span(9, 24, (n, o) => roll(n, o).filter((x) => !(n === 24 && x[0] >= o + 2))), 'Rolling Bass');
  clip(mb, 33, 28, span(33, 60, roll), 'Rolling Bass');
  dev(mb, 0, { 0: 4 });
  eq(mb, [[0, 80], [3, 450, -2, 1.1], [3, 1500, 2, 1]]);

  // =========================================================================================== music
  // Chord stabs: syncopated offbeat stabs (steps 2, 6, 10, 13)
  const ch = track('midi', 'Chord Stabs', '#c77dff', 1.4); P.setInstrument(ch, 31); preset(ch, 31, 'Wide Chord');
  const stab = (n, o) => steps(o, [[2, 1.6], [6, 1.6], [10, 1.6], [13, 2.2]].flatMap(([s, l], j) => voicing(n).map((p) => [s, l, p + 12, [0.8, 0.72, 0.8, 0.7][j]])));
  clip(ch, 17, 8, span(17, 24, (n, o) => stab(n, o).filter((x) => !(n === 24 && x[0] >= o + 2))), 'Stabs');
  clip(ch, 33, 24, span(33, 56, stab), 'Stabs');
  dev(ch, 0, { 0: 2 });
  eq(ch, [[0, 250], [3, 2500, 1.5, 0.9]]);
  // Pad: sustained chords; its filter opens in the intro, closes into the breakdown, sweeps up through the build
  const pad = track('midi', 'Pad', '#b28dff', 0.08); P.setInstrument(pad, 33); preset(pad, 33, 'Warm Saw Pad');
  const padLine = (n, o) => ((n - 1) % 2 === 0 ? voicing(n).map((p) => [o, 7.9, p, 0.75]) : []);
  clip(pad, 1, 64, span(1, 64, padLine), 'Pad');
  const padF = dev(pad, 1, { 0: 0, 1: 900, 2: 0.9 });
  eq(pad, [[0, 220], [3, 600, -2, 1]]);
  // Atmosphere: a wide air pad an octave up, under the intro, the breakdown and the outro
  const at = track('midi', 'Atmosphere', '#80ffdb', 0.1); P.setInstrument(at, 33); preset(at, 33, 'Air Pad Soft');
  for (const [a, n] of [[1, 8], [25, 8], [57, 8]]) clip(at, a, n, span(a, a + n - 1, (m, o) => ((m - 1) % 2 === 0 ? voicing(m).slice(1).map((p) => [o, 7.9, p + 12, 0.6]) : [])), 'Air');
  eq(at, [[0, 500]]);
  // Pluck arp: 16ths over the voicing (up-down figure), filter opening through the Groove, dotted-8th delay
  const pl = track('midi', 'Pluck Arp', '#7cf29c', 1.3); P.setInstrument(pl, 31); preset(pl, 31, 'Pluck Arp');
  const ORD = [0, 1, 2, 3, 2, 1, 3, 2, 0, 1, 2, 3, 1, 2, 3, 2];
  const arp = (n, o) => ORD.map((k, s) => [o + s / 4, 0.22, voicing(n)[k] + 12, s % 4 === 0 ? 0.9 : s % 2 ? 0.62 : 0.75]);
  clip(pl, 17, 16, span(17, 32, (n, o) => arp(n, o).filter((x) => !(n === 32 && x[0] >= o + 3))), 'Arp');
  clip(pl, 33, 24, span(33, 56, arp), 'Arp');
  dev(pl, 0, { 0: 2 });
  const plF = dev(pl, 1, { 0: 0, 1: 9000, 2: 1.2 });
  dev(pl, 17, { 1: 3, 5: 3, 9: 0.38, 12: 2400, 19: 0.2 });                             // Delay: 3/16 both sides, filtered repeats
  eq(pl, [[0, 300]]);
  // The hook: one 2-bar rhythm on every chord (call and answer), the supersaw lead + a bell an octave up for definition
  const R = [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2], [16, 6], [22, 2], [24, 4], [28, 4]];
  const MEL = [[72, 68, 72, 75, 77, 75, 72, 70, 72, 68], [72, 68, 72, 77, 80, 77, 75, 73, 72, 68], [72, 68, 72, 75, 79, 75, 77, 75, 72, 70], [70, 67, 70, 75, 79, 77, 75, 72, 75, 77]];
  const hook = (vel, tr = 0) => [0, 1, 2, 3].flatMap((c) => R.map(([s, l], k) => [c * 8 + s / 4, l / 4 * 0.92, MEL[c][k] + tr, vel * (k % 3 === 0 ? 1 : 0.86)]));
  const ld = track('midi', 'Lead', '#ff6fb5', 0.25); P.setInstrument(ld, 33); preset(ld, 33, 'Anthem Lead');
  clip(ld, 29, 4, hook(0.4).filter((x) => x[0] < 15), 'Hook (build)', 0);
  clip(ld, 33, 16, hook(0.92), 'Hook', 8);
  clip(ld, 49, 8, hook(0.88, 12), 'Hook +8va', 8);
  dev(ld, 6, { 8: 1, 9: 3, 10: 3, 1: 0.3, 2: 0.14, 4: 4500 });
  eq(ld, [[0, 200], [3, 3000, 1.5, 1]]);
  const ll = track('midi', 'Lead Layer', '#ff9ed2', 0.95); P.setInstrument(ll, 31); preset(ll, 31, 'Bell Pluck');
  clip(ll, 25, 8, hook(0.38, 0).filter((x) => x[0] < 31), 'Hook (bell)', 0);
  clip(ll, 33, 16, hook(0.7, 12), 'Hook layer', 8);
  clip(ll, 49, 8, hook(0.75, 12), 'Hook layer', 8);
  eq(ll, [[0, 500]]);
  // Synth riser: a held chord climbing an octave through the build
  const rs = track('midi', 'Riser', '#ffe066', 0.1); P.setInstrument(rs, 33); preset(rs, 33, 'Huge Pad Bright');
  clip(rs, 29, 4, [[0, 14.9, 53, 0.8], [0, 14.9, 60, 0.8], [0, 14.9, 65, 0.8]], 'Riser');
  eq(rs, [[0, 300]]);
  // FX: reverse crashes into each section, impact + sub drop on the drops, downlifters, noise riser
  const fx = track('audio', 'FX', '#e0e0e0', 0.5);
  const put = async (name, at, gain = 1, lenBeats) => { const c = await P.addAudioClip(fx, smp(name), Math.round(at * BEAT)); if (c) { c.gain = gain; if (lenBeats) c.len = Math.round(lenBeats * BEAT); } return c; };
  const rcb = sec2beats(2.6);
  for (const b0 of [9, 17, 33, 49]) await put('NH FX Reverse Crash', (b0 - 1) * 4 - rcb, 0.55);
  for (const b0 of [33, 49]) { await put('NH FX Impact', (b0 - 1) * 4, 0.7); await put('NH FX Sub Drop', (b0 - 1) * 4, 0.8); }
  await put('NH FX Downlifter', 24 * 4, 0.5); await put('NH FX Downlifter', 56 * 4, 0.45);
  await put('NH FX Impact', 62 * 4, 0.6); await put('NH FX Sub Drop', 62 * 4, 0.6);
  const nzT = track('audio', 'Noise Riser', '#cfcfcf', 0.3);
  const nc = await P.addAudioClip(nzT, smp('NH Noise Riser'), bar(29)); if (nc) nc.len = Math.round(15 * BEAT);
  const nzF = dev(nzT, 1, { 0: 0, 1: 250, 2: 1.6 });

  // =========================================================================================== buses, returns, master
  P.state.returns[0].name = 'Reverb'; P.state.returns[1].name = 'Delay';
  dev(65, 7, { 0: 0.85, 1: 0.55, 2: 1, 3: 20, 4: 1, 6: 300, 7: 9000 });              // hall: long, dark, no low end
  dev(66, 17, { 1: 3, 5: 3, 9: 0.42, 12: 1500, 13: 5, 18: 1, 19: 1 });                // ping-pong 3/16, band-limited
  const dbK = P.addFxTrack(), mbK = P.addFxTrack(); P.renameFx(dbK, 'Drum Bus'); P.renameFx(mbK, 'Music Bus');
  dev(65 + dbK, 24, { 0: 4, 1: 2, 2: 1, 3: -18, 4: 3, 7: 1 });                       // drum glue: 3 ms attack, 0.4 s, 4:1
  dev(65 + dbK, 3, { 0: 3, 4: 0, 1: 0.5 });                                            // a little analog clip, half wet
  dev(65 + mbK, 10, { 0: kick + 1, 1: -32, 2: 9, 3: 2, 4: 190 });                    // the whole music bus breathes with the kick
  dev(65 + mbK, 24, { 0: 5, 1: 6, 2: 0, 3: -16, 4: 2, 7: 1 });                       // gentle glue, auto release
  const mbF = dev(65 + mbK, 1, { 0: 1, 1: 20, 2: 0.8 });                              // high-pass, automated in the build
  dev(65 + mbK, 0, { 6: 1.15 });                                                       // a touch wider
  for (const i of [cl, ht, pc, cy]) P.setOut(i, dbK);
  for (const i of [mb, ch, pad, pl, ld, ll]) P.setOut(i, mbK);
  for (const [i, a, d] of [[cl, 0.12, 0], [ht, 0.05, 0], [pc, 0.1, 0.05], [cy, 0.15, 0], [ch, 0.18, 0.08], [pad, 0.3, 0], [at, 0.4, 0], [pl, 0.2, 0.15], [ld, 0.3, 0.18], [ll, 0.35, 0.2], [rs, 0.5, 0.2], [fx, 0.25, 0], [nzT, 0.35, 0.2]]) { P.setSend(i, 0, a); P.setSend(i, 1, d); }
  for (const [i, w] of [[pad, 1.35], [at, 1.6], [ch, 1.2], [ll, 1.25], [rs, 1.4]]) P.setWidth(i, w);
  eq(64, [[1, 20], [2, 130, 1.5, 0.7], [3, 500, -2, 1], [3, 2500, 0.5, 0.8], [5, 8500, -2, 0.7]]);   // warmth, less box, a softer top
  dev(64, 24, { 0: 5, 1: 6, 2: 0, 3: -8, 4: 0.5, 7: 1 });                           // master glue: 2:1, only the loudest moments (about 1 dB)
  dev(64, 3, { 0: 4, 4: 0, 5: 1, 2: -4, 1: 1 });                                   // soft clipper (oversampled Saturator): shaves the kick / bass peaks before the limiter
  const limD = dev(64, 5, { 0: -1.3, 1: 60, 2: 5 });                                  // limiter: +5 dB into a -1.3 dB ceiling (measured: about -8.5 LUFS, -1 dBTP)

  // =========================================================================================== automation
  const auto = (target, label, pts) => { const t = P.addAutoTrack(target, label); const i = P.state.tracks.indexOf(t); t.clips = []; const c = P.addClip(i, 0, 64 * BAR); c.pts = pts.map(([b0, v]) => ({ t: Math.round(b0 * BAR), v })); P.clipChanged(i); return i; };
  const fq = (hz) => normOf(DEVICES[1].params[1], hz);
  auto({ kind: 4, strip: P.stripOf(pad), devId: P.state.tracks[pad].devices[padF].id, param: 1, def: DEVICES[1].params[1] }, 'Pad • Auto Filter Freq',
    [[0, fq(350)], [8, fq(3500)], [24, fq(6000)], [24.01, fq(700)], [28, fq(2500)], [32, fq(16000)], [32.01, fq(5000)], [56, fq(5000)], [62, fq(600)], [64, fq(300)]]);
  auto({ kind: 4, strip: P.stripOf(pl), devId: P.state.tracks[pl].devices[plF].id, param: 1, def: DEVICES[1].params[1] }, 'Pluck Arp • Auto Filter Freq',
    [[16, fq(500)], [24, fq(7000)], [28, fq(1200)], [32, fq(12000)], [56, fq(12000)]]);
  auto({ kind: 4, strip: 'ret' + mbK, devId: P.state.returns[mbK].devices[mbF].id, param: 1, def: DEVICES[1].params[1] }, 'Music Bus • High-pass',
    [[0, fq(20)], [28, fq(20)], [32, fq(900)], [32.01, fq(20)], [64, fq(20)]]);
  auto({ kind: 4, strip: P.stripOf(nzT), devId: P.state.tracks[nzT].devices[nzF].id, param: 1, def: DEVICES[1].params[1] }, 'Noise Riser • Auto Filter Freq', [[0, fq(250)], [28, fq(250)], [31.75, fq(18000)], [64, fq(18000)]]);
  auto({ kind: 5, strip: P.stripOf(rs), param: 90, def: { n: 'Pitch', min: -24, max: 24 } }, 'Riser • Pitch', [[28, 0.5], [31.75, 0.75]]);
  auto({ kind: 0, strip: 'master', param: 0, def: P.AUTO_VOL }, 'Master • Volume', [[0, normOf(P.AUTO_VOL, 0.85)], [62.5, normOf(P.AUTO_VOL, 0.85)], [64, 0]]);
  for (const [b0, n, c] of [[1, 'Intro', '#8f9bb3'], [9, 'Build', '#4fd1ff'], [17, 'Groove', '#7cf29c'], [25, 'Breakdown', '#b28dff'], [33, 'Drop', '#ff5f4a'], [49, 'Drop B', '#ff6fb5'], [57, 'Outro', '#8f9bb3']]) P.addMarker(bar(b0), n, c);
  P.state.loop = { on: false, start: 0, end: BAR * 2 };
  P.syncAll();
  if (render && render.limGain != null) P.setDeviceParam(64, limD, 2, render.limGain);
  if (render && render.noMaster) { for (const d of P.state.master.devices) d.bypass = true; P.syncAll(); }
  const text = P.serialize();
  let wav = null;
  if (render) {
    globalThis.__exportSecs = 124; const done = new Promise((r) => { globalThis.onExportDone = r; });
    eng.exportWav('/Exports/neon.wav', 64 * BAR, 128, 24); const r = await done;
    if (r.ok) { const u = new Uint8Array(await eng.readBytes('/Exports/neon.wav')); let bin = ''; for (let k = 0; k < u.length; k += 32768) bin += String.fromCharCode.apply(null, u.subarray(k, k + 32768)); wav = btoa(bin); }
  }
  return { text, tracks: P.state.tracks.map((t) => t.name + ':' + t.clips.length), wav };
}, { render: renderTo ? { limGain: process.env.LIM_GAIN != null ? +process.env.LIM_GAIN : null, noMaster: !!process.env.NO_MASTER } : null, SAMPLES });
fs.writeFileSync(path.join(root, 'demos/progressive-house.mdaw'), out.text);
console.log('demos/progressive-house.mdaw', out.text.length, 'bytes;', out.tracks.join(', '));
if (renderTo && out.wav) { fs.writeFileSync(renderTo, Buffer.from(out.wav, 'base64')); console.log('render ->', renderTo); }
await b.close(); server.close();
