// FL Studio Mobile synth calibration against the owner's stems: the "New Song" archive (FLM 4.x) holds the four untouched instruments (DirectWave
// library piano, GMS, SuperSaw, MiniSynth) each playing an A minor chord, plus FLM's own MP3 render of each. The import is rendered with the
// MobileDAW engine and compared: pitch (A3 = 220 Hz, proves FLM note numbers = MIDI), level of the first 125 ms, gate after note-off, spectrum.
// Usage: FLM_STEMS=/path/New_Song.zip node --experimental-default-type=module tools/flm-stem-test.mjs   (skips when the archive or ffmpeg is missing)
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const zipPath = process.env.FLM_STEMS || '/root/.claude/uploads/c47664c0-803d-5780-beca-8d2b625e3853/9e870d71-New_Song.zip';
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
if (!fs.existsSync(zipPath) || !hasFfmpeg) { console.log('flm-stem-test: skipped (no stem archive or no ffmpeg)'); process.exit(0); }
const F = await import(path.join(root, 'js/import/flm.js')), B = await import(path.join(root, 'js/import/build.js')), D0 = await import(path.join(root, 'js/defs.js'));
const { Engine, PPQ } = await import(path.join(root, 'js/engine/core.js'));
const { readZip: zr } = await import(path.join(root, 'js/zip.js'));
let bad = 0; const ok = (c, m) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const SR = 48000, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flmstem-'));
const files = await zr(new Uint8Array(fs.readFileSync(zipPath)));
const get = (re) => files.find((e) => re.test(e.name));
const M = F.flmToModel(F.parseFlm(get(/\.flm$/i).data)), { json } = B.buildMdaw(M, { root: '/FLM/x', resolve: (p) => p, relName: (e) => e });
const stem = (name) => { const e = get(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.mp3$', 'i')); const fin = path.join(tmp, 'a.mp3'), fo = path.join(tmp, 'a.f32'); fs.writeFileSync(fin, e.data); execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', fin, '-f', 'f32le', '-ac', '2', '-ar', String(SR), fo]); const b = fs.readFileSync(fo), st = new Float32Array(b.buffer, b.byteOffset, b.length / 4); return Float32Array.from({ length: st.length / 2 }, (_, i) => st[2 * i]); };   // left channel (the instruments are centred)
function render(t) {
  const e = new Engine(SR); e.masterLimit(false); e.tempo(json.bpm); e.trackInst(0, t.inst.type); const I = D0.INSTRUMENTS[t.inst.type];
  I.params.forEach((q, k) => { if (!(k in t.inst.params)) e.instParam(0, k, q.def); }); for (const [k, v] of Object.entries(t.inst.params)) e.instParam(0, +k, v); e.instParam(0, 90, 0);
  e.trackVol(0, t.vol); const c = t.clips[0], f = []; for (const n of c.notes) f.push(c.start + n.t, n.d, n.p, n.v, 0); e.trackNotes(0, f, f.length / 5); e.play();
  const N = SR * 9, L = new Float32Array(N), R = new Float32Array(N); for (let k = 0; k < N; k += 128) e.render(L.subarray(k, k + 128), R.subarray(k, k + 128), Math.min(128, N - k));
  return L;
}
const db = (x, a, b) => { let q = 0; for (let i = a; i < b; i++) q += (x[i] || 0) ** 2; return 10 * Math.log10(q / (b - a) + 1e-18); };
const gz = (x, a, n, fr) => { const w = 2 * Math.PI * fr / SR, cc = 2 * Math.cos(w); let s1 = 0, s2 = 0; for (let k = a; k < a + n; k++) { const s0 = (x[k] || 0) + cc * s1 - s2; s2 = s1; s1 = s0; } return 20 * Math.log10(Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - cc * s1 * s2)) / n + 1e-12); };
for (const t of json.tracks.filter((x) => x.inst && x.inst.type >= 31 && x.inst.type <= 33)) {
  const s = stem(t.name), m = render(t), on = Math.round((t.clips[0].start + t.clips[0].notes[0].t) / PPQ * 60 / json.bpm * SR);
  const ls = db(s, on, on + 6000), lm = db(m, on, on + 6000), ts = db(s, on + 7200, on + 9600), tm = db(m, on + 7200, on + 9600);
  ok(t.clips[0].notes.map((n) => n.p).slice(0, 3).join() === '57,60,64' && gz(m, on + 500, 4800, 220) > gz(m, on + 500, 4800, 110) + 20, `${t.name}: notes 57/60/64 play A3 220 Hz like the stem (no octave shift)`);
  ok(Math.abs(lm - ls) < 1, `${t.name}: level of the first 125 ms within 1 dB of FLM (FLM ${ls.toFixed(1)} dB, MobileDAW ${lm.toFixed(1)} dB)`);
  if (process.env.FLM_DIAG) console.log('     harmonics of A3 1..14, FLM - MobileDAW (dB): ' + Array.from({ length: 14 }, (_, h) => (gz(s, on + 500, 4800, 220 * (h + 1)) - gz(m, on + 500, 4800, 220 * (h + 1))).toFixed(1)).join(' ') + ' | FLM abs: ' + Array.from({ length: 14 }, (_, h) => gz(s, on + 500, 4800, 220 * (h + 1)).toFixed(0)).join(' '));
  ok(Math.abs(tm - ts) < 15 || (tm < -60 && ts < -60), `${t.name}: after note-off the same tail (FLM ${ts.toFixed(0)} dB, MobileDAW ${tm.toFixed(0)} dB)`);
}
const mini = json.tracks.find((x) => x.name === 'MiniSynth 4');
ok(mini && mini.inst.type === 32, 'FLM module type 0 = MiniSynth (was unknown: the track was silent)');
// New Song 1 (owner's screenshots of the MiniSynth preset "Cubed": Saw + Square, Modifier 50, Noise 14, Cutoff 64, Res 49, Flt Amount 30.7)
const ns1 = process.env.FLM_NS1 || '/root/.claude/uploads/c47664c0-803d-5780-beca-8d2b625e3853/bbe9a0f4-New_Song_1.flm';
if (fs.existsSync(ns1)) {
  const M1 = F.flmToModel(F.parseFlm(new Uint8Array(fs.readFileSync(ns1)))), J1 = B.buildMdaw(M1, { root: '/FLM/x', resolve: (p) => p, relName: (e) => e }).json, cub = J1.tracks.find((x) => x.name === 'Cubed');
  const P1 = D0.INSTRUMENTS[32].params, v = (n) => cub.inst.params[P1.findIndex((q) => q.n === n)];
  ok(cub && v('Oscillator Kind') === 3 && Math.round(v('Modifier')) === 50 && Math.floor(v('Noise')) === 14 && Math.floor(v('Res')) === 49 && Math.abs(v('Flt Amount') - 30.7) < 0.1 && Math.floor(v('Cutoff')) === 64 && Object.keys(cub.inst.params).length === 44,
    'MiniSynth preset "Cubed": the knobs shown in FLM (Saw + Square, Modifier 50, Noise 14, Cutoff 64, Res 49, Flt Amount 30.7) come from the file, all 44 values (miniFromFlm)');
  const M1t = (await import(path.join(root, 'js/import/fxmap.js'))).FLM_TYPES;
  ok(M1t[18] && M1t[18].name === 'Tape Delay' && M1t[16] && M1t[16].name === 'Trance Delay' && M1t[11] && M1t[11].name === 'Chorus', 'rack screenshot: type 18 = Tape Delay, 16 = Trance Delay; 11 = Chorus (named by Honeydew, not a layout guess)');
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : '\nFLM STEMS OK'); process.exit(bad ? 1 : 0);
