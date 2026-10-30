// Headless render benchmark of the audio engine (block 128 frames, 48 kHz). Usage:
//   node --experimental-default-type=module tools/bench.mjs [scenario ...] [--blocks=N] [--json]
// Flags: --blocks=N  --hash (output checksum)  --worklet (sliced table build)  --cold (no warm-up pass)  --json
// Scenarios: ghibli, meadow (demo songs), wt6 (Wavetable unison 6 + echo/reverb), moist (Moisture + echo/reverb), sweep (parameter/table changes during playback), all
// Budget per block = 128 / 48000 s = 2.667 ms. Reports mean/p50/p99/max (% of budget), blocks over budget, first-block cost, NaN/Inf count.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = process.env.ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Engine, PPQ } = await import(path.join(root, 'js/engine/core.js'));
const dspM = await import(path.join(root, 'js/engine/dsp.js'));
const { parseSf2 } = await import(path.join(root, 'js/engine/sf2.js'));
const SR = 48000, B = 128, BUDGET = B / SR * 1e9;   // ns
const args = process.argv.slice(2), flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const names = args.filter((a) => !a.startsWith('--'));
if ('worklet' in flags && 'JOBS' in dspM) dspM.JOBS.sync = false;   // --worklet: build wavetables in slices like the AudioWorklet does
const NB = +(flags.blocks || 0), HASH = 'hash' in flags;   // --hash: also checksum the output (bit-exactness check against another build; allocates, so not for timing)

function loadSong(file, e) {
  const j = JSON.parse(fs.readFileSync(path.join(root, 'demos', file), 'utf8'));
  e.tempo(j.bpm); const sfs = new Map();
  const dev = (strip, d) => { const di = e.s[strip].dev.length; e.insertDevice(strip, di, d.type); d.params.forEach((v, pi) => e.devParam(strip, di, pi, v)); if (d.bypass) e.devBypass(strip, di, true); };
  (j.master.devices || []).forEach((d) => dev(64, d));
  (j.returns || []).forEach((r, k) => { e.s[65 + k].vol = r.vol; (r.devices || []).forEach((d) => dev(65 + k, d)); });
  let end = 0, i = 0;
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
    for (const c of t.clips) for (const nt of c.notes || []) { f.push(c.start + nt.t, nt.d, nt.p, nt.v, nt.pan || 0); n++; end = Math.max(end, c.start + nt.t + nt.d); }
    e.trackNotes(i, f, n); i++;
  }
  return { ticks: end, tracks: i };
}

// synthetic heavy patches: 8-note chords, repeated, on one track with echo + reverb
function loadPatch(kind, e) {
  const t = 0;
  if (kind === 'wt6') { e.trackInst(t, 11); e.instParam(t, 27, 6); e.instParam(t, 26, 1); e.instParam(t, 28, 0.6); e.instParam(t, 25, 8); e.instParam(t, 9, 4); e.instParam(t, 18, 1); }
  else { e.trackInst(t, 7); e.instParam(t, 5, 5); e.instParam(t, 6, 25); e.instParam(t, 2, 0.6); e.instParam(t, 4, 0.4); e.instParam(t, 16, 0.5); }
  const echo = [375, 0.3, 1, 0, 4500, 20, 375, 1, 0, 2, 1, 0.3, 1, 0, 0, 0.5, 0, 0], rev = [0.82, 0.5, 1, 22];
  e.insertDevice(t, 0, 6); echo.forEach((v, k) => e.devParam(t, 0, k, v));
  e.insertDevice(t, 1, 7); rev.forEach((v, k) => e.devParam(t, 1, k, v));
  const f = []; let n = 0;
  for (let bar = 0; bar < 16; bar++) for (const p of [48, 55, 60, 64, 67, 72, 76, 79]) { f.push(bar * 3840 + (p % 5) * 30, 3000, p, 0.8, 0); n++; }
  e.trackNotes(t, f, n);
  return { ticks: 16 * 3840, tracks: 1 };
}

// parameter / table switching during playback (what a preset change does on the audio thread)
function sweepEvents(kind, e, blk) {
  if (kind !== 'sweep') return;
  if (blk % 100 === 50) { e.instParam(0, 0, 1 + (blk / 100 | 0) % 14); e.instParam(0, 9, 1 + (blk / 100 | 0) % 14); }
}

function run(name) {
  const e = new Engine(SR); let info;
  const t0 = process.hrtime.bigint();
  if (name === 'ghibli') info = loadSong('ghibli-sky.mdaw', e);
  else if (name === 'meadow') info = loadSong('meadow-wind.mdaw', e);
  else if (name === 'sweep') { e.trackInst(0, 11); e.instParam(0, 27, 6); e.instParam(0, 26, 1); e.instParam(0, 28, 0.6); info = loadPatch('wt6', e); }
  else info = loadPatch(name, e);
  const setup = Number(process.hrtime.bigint() - t0) / 1e6;
    const total = NB || Math.min(Math.ceil(info.ticks / PPQ * 60 / e.bpm * SR / B), 20000);
  const L = new Float32Array(B), R = new Float32Array(B), dt = new Float64Array(total), hh = crypto.createHash('sha1');
  e.play(); let bad = 0, first = 0;
  for (let b = 0; b < total; b++) {
    sweepEvents(name, e, b);
    const a = performance.now(); e.render(L, R, B); const d = (performance.now() - a) * 1e6;
    if (b === 0) first = d; dt[b] = d; if (HASH) { hh.update(L); hh.update(R); }
    for (let i = 0; i < B; i++) if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) { bad++; break; }
  }
  if ('spikes' in flags) { const bad = []; for (let b = 1; b < total; b++) if (dt[b] > BUDGET) bad.push(b + ':' + (dt[b] / BUDGET * 100).toFixed(0) + '%'); console.log(name, 'over-budget blocks:', bad.join(' ')); }   // --spikes: list them
  const s = Array.from(dt.subarray(1)).sort((x, y) => x - y), q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))] / BUDGET * 100;
  const mean = s.reduce((x, y) => x + y, 0) / s.length / BUDGET * 100, over = s.filter((x) => x > BUDGET).length;
  return { name, tracks: info.tracks, blocks: total, setupMs: +setup.toFixed(1), firstBlockMs: +(first / 1e6).toFixed(2), meanPct: +mean.toFixed(2), p50: +q(0.5).toFixed(2), p99: +q(0.99).toFixed(2), maxPct: +(s[s.length - 1] / BUDGET * 100).toFixed(1), over, overPct: +(over / s.length * 100).toFixed(3), nan: bad, hash: HASH ? hh.digest('hex').slice(0, 12) : '-' };
}

// --prewarm: render a throw-away engine with every instrument and effect before the measured run (what the worklet could do at start-up)
async function prewarm() {
  const { makeDevice } = await import(path.join(root, 'js/engine/fx.js'));
  const e = new Engine(SR); const n = 16;
  [1, 2, 3, 5, 7, 8, 11].forEach((ty, i) => { e.trackInst(i, ty); const f = []; for (let k = 0; k < 8; k++) f.push(k * 2000, 6000, 48 + k * 3 + i, 0.8, 0); e.trackNotes(i, f, 8, 5); });
  for (let ty = 0; ty < 16; ty++) { if (!makeDevice(ty, SR, e.sc)) continue; e.insertDevice(0, e.s[0].dev.length, ty); }
  e.insertDevice(64, 0, 4); e.insertDevice(64, 1, 5);
  const L = new Float32Array(B), R = new Float32Array(B); e.play();
  for (let b = 0; b < +(flags.prewarm || 300); b++) e.render(L, R, B);
}
if ('prewarm' in flags) await prewarm();
const list = names.length && names[0] !== 'all' ? names : ['ghibli', 'meadow', 'wt6', 'moist', 'sweep'];
if (!('cold' in flags)) for (const n of list) run(n);   // warm-up pass: JIT, tables (not reported); --cold skips it (first-use costs show up in setup/first/max)
const out = list.map(run);
if (flags.json) console.log(JSON.stringify(out, null, 1));
else for (const r of out) console.log(`${r.name.padEnd(7)} trk=${r.tracks} blk=${r.blocks} setup=${r.setupMs}ms first=${r.firstBlockMs}ms mean=${r.meanPct}% p50=${r.p50}% p99=${r.p99}% max=${r.maxPct}% over=${r.over} (${r.overPct}%) nan=${r.nan} hash=${r.hash}`);
