// Punch / level measurements of the drum-step kit (Drum Sampler built-in sounds + sample pads) and DirectWave, rendered offline with the
// web engine classes. Prints one row per sound; with --check it also asserts the quality floor (part of tools/run-tests.mjs).
// Usage: node tools/drum-punch.mjs [--check] [--json out.json]
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DrumSynth, Sampler } = await import(path.join(root, 'js/engine/instruments.js'));
const { fft } = await import(path.join(root, 'js/engine/dsp.js'));
const SR = 48000, args = process.argv.slice(2), CHECK = args.includes('--check');
const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
function render(inst, notes, sec) {           // notes: [time s, pitch, vel, length s]
  const n = Math.round(sec * SR), L = new Float32Array(n), R = new Float32Array(n), ev = [];
  for (const [t, p, v, d] of notes) { ev.push([Math.round(t * SR), 1, p, v]); ev.push([Math.round((t + d) * SR), 0, p, 0]); }
  ev.sort((a, b) => a[0] - b[0]);
  let k = 0;
  for (let i = 0; i < n; i += 128) {
    const e = Math.min(n, i + 128);
    let a = i;
    while (k < ev.length && ev[k][0] < e) { const at = Math.max(a, ev[k][0]); if (at > a) { inst.render(L, R, a, at); a = at; } if (ev[k][1]) inst.noteOn(ev[k][2], ev[k][3]); else inst.noteOff(ev[k][2]); k++; }
    if (e > a) inst.render(L, R, a, e);
    if (inst.endBlock) inst.endBlock(L.subarray(i, e), R.subarray(i, e), e - i);
  }
  return { L, R };
}
// band energies of the first `win` seconds (Hann, 8192-point FFT), in dB relative to the total
function bands(x, win = 0.25) {
  const N = 8192, re = new Float64Array(N), im = new Float64Array(N), m = Math.min(N, Math.round(win * SR));
  for (let i = 0; i < m; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (m - 1)));
  fft(re, im, N);
  const e = (f0, f1) => { let s = 0; for (let k = Math.ceil(f0 * N / SR); k <= Math.floor(f1 * N / SR); k++) s += re[k] * re[k] + im[k] * im[k]; return s; };
  const tot = e(20, 20000) || 1e-30;
  return { sub: 10 * Math.log10(e(20, 60) / tot + 1e-12), low: 10 * Math.log10(e(60, 150) / tot + 1e-12), phone: 10 * Math.log10(e(150, 500) / tot + 1e-12), mid: 10 * Math.log10(e(500, 4000) / tot + 1e-12), hi: 10 * Math.log10(e(4000, 20000) / tot + 1e-12) };
}
function measure(name, { L }, extra = {}) {
  let pk = 0; for (const v of L) pk = Math.max(pk, Math.abs(v));
  const r = (a, b) => { let s = 0; const i0 = Math.round(a * SR), i1 = Math.min(L.length, Math.round(b * SR)); for (let i = i0; i < i1; i++) s += L[i] * L[i]; return Math.sqrt(s / Math.max(1, i1 - i0)); };
  const hit = r(0, 0.08), body = r(0.08, 0.3);
  let t10 = 0; for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) > pk * 0.01) t10 = i / SR;     // last moment above -40 dB of the peak
  const b = bands(L);
  return { name, peak: db(pk), hit: db(hit), body: db(body), crest: db(pk) - db(hit), tail: t10, ...b, ...extra };
}
const rows = [];
// ---- drum-step built-in kit (pad pitches 36 kick, 38 snare, 39 clap, 42 closed hat, 46 open hat, 41 tom); a step note is 1/16 at 120 BPM
const STEP = 0.125;
for (const [p, name] of [[36, 'kick'], [38, 'snare'], [39, 'clap'], [42, 'closed hat'], [46, 'open hat'], [41, 'tom']]) {
  const d = new DrumSynth(SR, []); rows.push(measure('kit ' + name, render(d, [[0, p, 1, STEP]], 1.2)));
}
{ // a two-bar beat at 100 BPM with overlapping hits (accents 1, ghost 0.8)
  const st = 60 / 100 / 4, pat = { 36: [0, 3, 8, 10, 16, 19, 24, 26], 38: [4, 12, 20, 28], 42: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28], 46: [30], 39: [12, 28], 41: [29, 31] }, notes = [];
  for (const [p, xs] of Object.entries(pat)) for (const x of xs) notes.push([x * st, +p, x % 4 === 0 ? 1 : 0.8, st]);
  rows.push(measure('kit beat', render(new DrumSynth(SR, []), notes, 32 * st + 1)));
}
// ---- sample sources: a punchy 808-ish kick and a crash-like long noise tail, as a pad sample and in DirectWave
function kickSample() { const n = Math.round(0.9 * SR), a = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR, f = 50 + 180 * Math.exp(-t / 0.03); ph += f / SR; a[i] = Math.tanh(2.2 * Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.35)) * 0.95; } return a; }
function crashSample() { const n = Math.round(1.6 * SR), a = new Float32Array(n); let s = 99, hp = 0; for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const w = s / 2147483648 - 1, y = w - hp; hp += y * 0.2; a[i] = y * Math.exp(-i / SR / 0.6) * 0.9; } return a; }
const K = kickSample(), C = crashSample();
const bank = [{ l: K, r: K, frames: K.length, rate: SR }, { l: C, r: C, frames: C.length, rate: SR }];
rows.push(measure('source kick sample', { L: K }));
for (const [sid, nm] of [[0, 'kick'], [1, 'crash']]) {
  const d = new DrumSynth(SR, bank); d.setParam(200 + 6 * 16, sid); d.setParam(200 + 6 * 16 + 11, 50);     // pad 7 = the sample, at C3 (50)
  rows.push(measure('pad sample ' + nm + ' (1/16 step)', render(d, [[0, 50, 1, STEP]], 2)));
}
for (const [sid, nm] of [[0, 'kick'], [1, 'crash']]) {
  const s = new Sampler(SR, bank); s.setParam(100, sid); s.setParam(101, 60);
  rows.push(measure('DirectWave ' + nm + ' (1/16 note)', render(s, [[0, 60, 1, STEP]], 2)));
  const s2 = new Sampler(SR, bank); s2.setParam(100, sid); s2.setParam(101, 60);
  rows.push(measure('DirectWave ' + nm + ' vel 0.8 (piano-roll default)', render(s2, [[0, 60, 0.8, STEP]], 2)));
}
{ const s = new Sampler(SR, bank); s.setParam(100, 1); s.setParam(101, 60); s.setParam(6, 1);     // DirectWave Mode = One-shot
  rows.push(measure('DirectWave crash one-shot (1/16 note)', render(s, [[0, 60, 1, STEP]], 2))); }
{ // transient sharpness: DirectWave playing the kick sample at root: how much of the first 2 ms is lost to the attack ramp / filter
  const s = new Sampler(SR, bank); s.setParam(100, 0); s.setParam(101, 60);
  const { L } = render(s, [[0, 60, 1, 1]], 0.05); let e0 = 0, e1 = 0; for (let i = 0; i < 96; i++) { e0 += K[i] * K[i]; e1 += L[i] * L[i]; }
  rows.push({ name: 'DirectWave first 2 ms vs source', peak: 10 * Math.log10(e1 / e0) });
  // high-frequency retention when pitched up a fifth: energy above 6 kHz relative to the source (interpolation / filter loss)
  const s3 = new Sampler(SR, bank); s3.setParam(100, 1); s3.setParam(101, 60);
  const up = render(s3, [[0, 67, 1, 1]], 0.3).L, b0 = bands(C, 0.25), b1 = bands(up, 0.25);
  rows.push({ name: 'DirectWave crash +7 st: hi band vs source', peak: b1.hi - b0.hi });
}
const f = (x) => (x == null ? '' : (Math.round(x * 10) / 10).toFixed(1));
console.log('sound'.padEnd(46) + ['peak', 'hit', 'body', 'crest', 'tail s', 'sub', '60-150', '150-500', 'mid', 'hi'].map((h) => h.padStart(8)).join(''));
for (const r of rows) console.log(r.name.padEnd(46) + [r.peak, r.hit, r.body, r.crest, r.tail, r.sub, r.low, r.phone, r.mid, r.hi].map((v) => f(v).padStart(8)).join(''));
const jo = args.indexOf('--json'); if (jo >= 0) fs.writeFileSync(args[jo + 1], JSON.stringify(rows, null, 1));
if (CHECK) {
  let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };
  const R = Object.fromEntries(rows.map((r) => [r.name, r]));
  const RANGE = { kick: [-6.5, -4.5], snare: [-10.5, -6.5], clap: [-13, -8], 'closed hat': [-17.5, -12], 'open hat': [-17.5, -12], tom: [-10, -6] };   // a mixed drum machine
  for (const [k, [lo, hi]] of Object.entries(RANGE)) { const r = R['kit ' + k]; ok(r.peak > lo && r.peak < hi, `kit ${k}: peak ${f(r.peak)} dBFS (mix level ${lo} .. ${hi})`); }
  ok(R['kit beat'].peak < 0, 'a full beat on the built-in kit (kick + snare + clap + hats + toms, overlapping) peaks ' + f(R['kit beat'].peak) + ' dBFS: no clipping');
  ok(R['kit kick'].phone > R['source kick sample'].phone - 2, 'kit kick: 150-500 Hz (what a phone speaker plays) as present as a produced kick sample: ' + f(R['kit kick'].phone) + ' dB (sample ' + f(R['source kick sample'].phone) + ')');
  ok(R['kit kick'].body > -16, 'kit kick: body RMS 80-300 ms ' + f(R['kit kick'].body) + ' dBFS');
  ok(R['kit closed hat'].hi > -3 && R['kit open hat'].hi > -3, 'hats: energy above 4 kHz dominates');
  ok(R['kit snare'].mid > -12 && R['kit snare'].phone > -10, 'snare: body (150-500 Hz) and snap (mid band) both present');
  ok(Math.abs(R['DirectWave kick (1/16 note)'].peak - R['source kick sample'].peak) < 0.3, 'DirectWave at velocity 1 plays the sample at unity');
  ok(R['DirectWave first 2 ms vs source'].peak > -0.5, 'DirectWave keeps the transient (first 2 ms within 0.5 dB of the source)');
  ok(R['DirectWave crash +7 st: hi band vs source'].peak > -3, 'DirectWave pitched up keeps its highs (within 3 dB)');
  ok(Math.abs(R['pad sample kick (1/16 step)'].peak - R['source kick sample'].peak) < 0.3, 'drum pad sample at velocity 1 plays at unity');
  ok(R['pad sample crash (1/16 step)'].tail > 1.0, 'drum pad: a 1/16 step does not cut the crash tail (one-shot)');
  ok(R['DirectWave crash one-shot (1/16 note)'].tail > 1.0 && R['DirectWave crash (1/16 note)'].tail < 0.6, 'DirectWave: Gate releases at note-off, One-shot plays the whole sample');
  console.log(bad ? bad + ' FAILED' : 'ALL OK'); process.exit(bad ? 1 : 0);
}
