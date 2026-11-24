// Plugin delay compensation (PDC) of the engine, measured with impulses (sample frames, no tolerance):
//  - every device that reports a latency (lat()) really delays an impulse by exactly that many frames
//  - tracks with and without latent devices line up at the master (direct, send -> return, group routing to a return)
//  - parallel chains inside an Audio Effect Rack line up; the rack reports its slowest chain
//  - the metronome click lands with the music; pdcLatency() = the measured delay of the output against the song position
//  - PDC off = the old behaviour; a project without latent devices renders bit-identical with PDC on and off
// Usage: node tools/pdc-test.mjs     (part of tools/run-tests.mjs)
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Engine, PPQ, RET0, MASTER } = await import(path.join(root, 'js/engine/core.js'));
const { makeDevice } = await import(path.join(root, 'js/engine/fx.js'));
const SR = 48000, IMP = 2000;                       // the impulse sits IMP frames into its sample (clips fade in over their first 64 frames)
let bad = 0; const ok = (c, msg) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const peaks = (x, thr = 0.05) => { const r = []; for (let i = 1; i < x.length - 1; i++) if (Math.abs(x[i]) > thr && Math.abs(x[i]) >= Math.abs(x[i - 1]) && Math.abs(x[i]) > Math.abs(x[i + 1])) r.push(i); return r; };
const imp = () => { const a = new Float32Array(SR); a[IMP] = 0.25; return a; };

// --- 1. device latency = measured delay of an impulse
function devLat(type, params) {
  const d = makeDevice(type, SR, new Float32Array(80)); for (const [k, v] of params) d.setParam(k, v);
  const N = 8192, L = new Float32Array(N), R = new Float32Array(N); L[100] = R[100] = 0.25;
  for (let o = 0; o < N; o += 128) d.process(L.subarray(o, o + 128), R.subarray(o, o + 128), 128);
  let m = 0, k = -1; for (let i = 0; i < N; i++) if (Math.abs(L[i]) > m) { m = Math.abs(L[i]); k = i; }
  return { said: d.lat ? d.lat() : 0, got: k - 100 };
}
for (const [name, type, params] of [['Saturator (4x oversampling, Dry/Wet 0)', 3, [[1, 0]]], ['Saturator (Dry/Wet 100 %, drive 0 dB)', 3, [[0, 0]]], ['Compressor Lookahead 1 ms', 4, [[0, 0], [1, 1], [9, 1]]],
  ['Compressor Lookahead 10 ms', 4, [[0, 0], [1, 1], [9, 2]]], ['Compressor without Lookahead', 4, [[0, 0], [1, 1], [9, 0]]], ['Limiter (1.5 ms look-ahead)', 5, []], ['Spectral Time (STFT 2048)', 46, [[0, 0], [10, 0]]]]) {
  const r = devLat(type, params); ok(r.said === r.got, `${name}: reports ${r.said} frames, impulse delayed ${r.got}`);
}

// --- engine helpers: track t plays the impulse sample as an audio clip at bar 0
function eng(setup, pdc = true) {
  const e = new Engine(SR); e.masterLimit(false); e.setPdc(pdc); e.tempo(120); e.loadSample(0, imp(), imp());
  setup(e); return e;
}
const clip = (e, t, start = 0) => e.trackClips(t, [start, PPQ * 4, 0, 1, 0, 0, 0], 1);
function render(e, sec = 0.5) { e.seek(0); e.play(); const n = Math.round(sec * SR), L = new Float32Array(n), R = new Float32Array(n); for (let i = 0; i < n; i += 128) e.render(L.subarray(i, i + 128), R.subarray(i, i + 128), Math.min(128, n - i)); return L; }
const solo = (setup, t, pdc = true) => { const e = eng(setup, pdc); e.trackSolo(t, true); return peaks(render(e)); };
const sat = (e, t) => { e.insertDevice(t, 0, 3); e.devParam(t, 0, 1, 0); };            // Saturator, Dry/Wet 0: a pure 37-frame delay
const lim = (e, t) => { e.insertDevice(t, 0, 5); };                                      // Limiter: 72 frames, the impulse stays below the ceiling
const comp10 = (e, t) => { e.insertDevice(t, 0, 4); e.devParam(t, 0, 0, 0); e.devParam(t, 0, 1, 1); e.devParam(t, 0, 9, 2); };   // 480 frames

// --- 2. two tracks at the master
{
  const setup = (e) => { clip(e, 0); clip(e, 1); lim(e, 0); };
  const a = solo(setup, 0), b = solo(setup, 1), a0 = solo(setup, 0, false), b0 = solo(setup, 1, false);
  ok(a0[0] - b0[0] === 72, `PDC off: the Limiter track is ${a0[0] - b0[0]} frames late (72 expected: the problem PDC solves)`);
  ok(a.length === 1 && b.length === 1 && a[0] === b[0], `PDC on: Limiter track at ${a[0]}, plain track at ${b[0]} (same frame)`);
  const both = render(eng(setup)), x = peaks(both), va = render(eng((e) => { setup(e); e.trackSolo(0, true); }))[a[0]], vb = render(eng((e) => { setup(e); e.trackSolo(1, true); }))[b[0]];
  ok(x.length === 1 && Math.abs(both[x[0]] - (va + vb)) < 1e-6, `PDC on, both tracks: one summed impulse (${x.length} peak, ${both[x[0]].toFixed(4)} = ${va.toFixed(4)} + ${vb.toFixed(4)})`);
  ok(eng(setup).pdcLatency() === 72 && x[0] - IMP === 72, `pdcLatency() = ${eng(setup).pdcLatency()}, output trails the song by ${x[0] - IMP}`);
}
// --- 3. send to a latent return + latent track straight to the master
{
  const setup = (e) => { clip(e, 0); clip(e, 1); lim(e, 0); sat(e, RET0); e.trackSend(1, 0, 1); };   // track 1: direct AND through Return A (Saturator)
  const x = peaks(render(eng(setup))), y = peaks(render(eng(setup, false)));
  ok(y.length === 3 && x.length === 1 && x[0] - IMP === 72 + 37, `send: Limiter track, plain track direct and its send through Return A (Saturator) arrive together at +${x[0] - IMP} (72 + 37); PDC off: ${y.map((q) => q - IMP).join(' / ')}`);
}
// --- 4. group routing: a track whose main output goes into Return B (Compressor 10 ms look-ahead), another track direct
{
  const setup = (e) => { clip(e, 0); clip(e, 1); e.trackOut(0, 1); comp10(e, RET0 + 1); };
  const x = peaks(render(eng(setup))), y = peaks(render(eng(setup, false)));
  ok(x.length === 1 && x[0] - IMP === 480, `group: track -> Return B (Compressor 10 ms) and a direct track arrive together at +${x[0] - IMP}, PDC off: ${y.map((q) => q - IMP).join(' / ')}`);
}
// --- 5. parallel chains in an Audio Effect Rack (type 51)
{
  const setup = (e) => { clip(e, 0); e.insertDevice(0, 0, 51); e.devParam(0, 0, 32, 2); e.rackCmd(0, 0, 1, 0, 0, 4, 0); e.rackCmd(0, 0, 2, 0, 0, 0, 0); e.rackCmd(0, 0, 2, 0, 0, 1, 1); e.rackCmd(0, 0, 2, 0, 0, 9, 2); };
  const e = eng(setup), x = peaks(render(e));
  ok(e.s[0].dev[0].lat() === 480, `rack reports its slowest chain: ${e.s[0].dev[0].lat()} frames`);
  ok(x.length === 1 && x[0] - IMP === 480, `rack: chain 1 (Compressor 10 ms) and chain 2 (empty) sum into one impulse at +${x[0] - IMP}`);
}
// --- 6. the metronome click starts with the music
{
  const setup = (e) => { clip(e, 0); lim(e, 0); sat(e, MASTER); };
  const onset = (x) => { for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 1e-4) return i; return -1; };
  const click = (pdc) => onset(render(eng((q) => { setup(q); q.trackMute(0, true); q.setMetro(true); }, pdc)));
  const c = click(true) - click(false), m = peaks(render(eng(setup)))[0];
  ok(c === 72 + 37 && m - IMP === 72 + 37, `metronome: click delayed +${c}, the track's beat-0 material +${m - IMP} (same: 72 Limiter + 37 master Saturator)`);
}
// --- 7. no latent device: PDC on and off are bit-identical (projects without look-ahead / oversampling sound exactly as before)
{
  const setup = (e) => { e.trackInst(0, 2); e.trackNotes(0, [0, PPQ * 2, 60, 0.9, 0, PPQ, PPQ, 67, 0.8, 0], 2); e.insertDevice(0, 0, 7); e.trackSend(0, 0, 0.4); e.insertDevice(RET0, 0, 6); e.setMetro(true); clip(e, 1); };
  const a = render(eng(setup), 1.5), b = render(eng(setup, false), 1.5); let same = true; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
  ok(same, 'project without latent devices: PDC on == PDC off, sample for sample');
}
// --- 8. loop: the compensated output stays continuous over the loop seam (the delay lines run through the wrap)
{
  const setup = (e) => { clip(e, 0, PPQ * 3.9); clip(e, 1, 0); lim(e, 1); e.loop(true, 0, PPQ * 4); };
  const e = eng(setup); const x = render(e, 4.2), p = peaks(x).map((q) => q % Math.round(2 * SR));
  ok(p.length >= 4 && p.every((q) => q === p[0] || q === p[1]), `loop: impulses repeat at the same offsets every lap (${p.slice(0, 6).join(', ')})`);
}
// --- 9. a track that goes quiet (mute, then unmute) never plays stale audio from its delay line
{
  const setup = (e) => { clip(e, 0); clip(e, 1); lim(e, 1); };
  const e = eng(setup); e.seek(0); e.play(); const n = SR, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i += 128) { if (i === IMP + 20 - (IMP + 20) % 128) e.trackMute(0, true); if (i === 24064) e.trackMute(0, false); e.render(L.subarray(i, i + 128), R.subarray(i, i + 128), 128); }
  const late = peaks(L.subarray(24064)); ok(late.length === 0, `muted while its impulse waited in the PDC line: nothing comes out after the unmute (${late.length} peaks)`);
}
console.log(bad ? `\n${bad} FAILED` : '\nALL OK');
process.exit(bad ? 1 : 0);
