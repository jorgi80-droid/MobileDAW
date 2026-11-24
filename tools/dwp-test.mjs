// DirectWave programs (.dwp, js/dwp.js) on programs built here with the layout of Honeydew's reader / writer (crates/audio/src/dwp.rs):
// zones with key / velocity ranges, gain, pan, loop mode, the 0x1FD floats; embedded 16-bit mono and f32 stereo PCM with a lead-in;
// a file zone; a zone with a bad 0x1F7 and one with neither file nor audio (left out); a record whose length runs past the end; tags after
// tag 2 ignored. Then in the app (Playwright + Chromium): the program onto a DirectWave track, the embedded audio saved and loaded, the
// file zone found by name in the library, Attack / Release from the last zone, undo; WAV and MP3 samples into zones.
// Usage: node tools/dwp-test.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parseDwp, toMdawZone, dwpAttackRelease } = await import('../js/dwp.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };

const le = (bits, v) => { const b = Buffer.alloc(bits / 8); if (bits === 8) b.writeUInt8(v); else if (bits === 32) b.writeUInt32LE(v >>> 0); else b.writeBigUInt64LE(BigInt(v)); return b; };
const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return b; };
const rec = (tag, data) => Buffer.concat([le(32, tag), le(64, data.length), data]);
const head = (o) => Buffer.concat([Buffer.from([o.root, o.lo, o.hi, o.vlo, o.vhi, 0, 0, 0, 0]), f32(o.gain ?? 1), f32(o.pan ?? 0), Buffer.alloc(4), le(32, (o.lead || 0) * 2)]);
const fmt = (frames, ch, rate, mode = 0, ls = 0, lend = 0) => Buffer.concat([le(64, frames), le(32, ch), Buffer.alloc(4), f32(rate), le(32, mode), le(32, ls), le(32, lend)]);
const floats = (a) => Buffer.concat(a.map(f32));
const SR = 44100, N = 4410;
// zone 1: 16-bit mono, 3 frames of lead-in, keys 0..59, root 48
const pcm16 = Buffer.alloc((N + 3) * 2); for (let i = 0; i < N + 3; i++) pcm16.writeInt16LE(i < 3 ? 32767 : Math.round(16000 * Math.sin(2 * Math.PI * 441 * (i - 3) / SR)), 2 * i);
const z1 = Buffer.concat([rec(0x1f4, head({ root: 48, lo: 0, hi: 59, vlo: 0, vhi: 127, gain: 0.5, pan: -0.25, lead: 3 })), rec(0x1f6, Buffer.from('C:\\DW\\Piano C3.wav\0')),
  rec(0x1f7, fmt(N, 1, SR, 2, 100, 4000)), rec(0x1fd, floats([0.2, 1, 1, 0.5])), rec(0x205, pcm16)]);
// zone 2: f32 stereo (left +, right -), keys 60..128, velocities 64..127
const pf = Buffer.alloc(N * 8); for (let i = 0; i < N; i++) { const v = 0.4 * Math.sin(2 * Math.PI * 882 * i / SR); pf.writeFloatLE(v, 8 * i); pf.writeFloatLE(-v, 8 * i + 4); }
const z2 = Buffer.concat([rec(0x1f4, head({ root: 72, lo: 60, hi: 128, vlo: 64, vhi: 127, gain: 2 })), rec(0x1f7, fmt(N, 2, SR)), rec(0x205, pf)]);
// zone 3: a file only (in the library)
const z3 = Buffer.concat([rec(0x1f4, head({ root: 60, lo: 60, hi: 127, vlo: 0, vhi: 63 })), rec(0x1f6, Buffer.from('Samples/Strings/Str Lo.wav\0')), rec(0x1f7, fmt(1000, 1, SR)), rec(0x1fd, floats([0, 1, 1, 0.3]))]);
const zBadFmt = Buffer.concat([rec(0x1f4, head({ root: 1, lo: 1, hi: 2, vlo: 0, vhi: 127 })), rec(0x1f6, Buffer.from('x.wav\0')), rec(0x1f7, fmt(10, 3, SR))]);
const zEmpty = rec(0x1f4, head({ root: 5, lo: 0, hi: 127, vlo: 0, vhi: 127 }));
const prog = Buffer.concat([rec(0x64, Buffer.alloc(7)), rec(3, z1), rec(3, z2), rec(3, zBadFmt), rec(3, zEmpty), rec(3, z3), rec(2, Buffer.alloc(0)), rec(3, z2)]);
const dwp = Buffer.concat([Buffer.from('DwPr'), le(32, 38), rec(1, prog)]);

const p = parseDwp(dwp), [a, b, c] = p.zones;
ok(p.version === 38 && p.zones.length === 3, `3 zones read (a bad 0x1F7, a zone with neither file nor audio, and a zone after tag 2 left out): ${p.zones.length}`);
ok(a.root === 48 && a.lo === 0 && a.hi === 59 && Math.abs(a.gain - 0.5) < 1e-6 && Math.abs(a.pan + 0.25) < 1e-6 && a.loopMode === 2 && a.loopStart === 100 && a.loopEnd === 4000 && a.file === 'Piano C3.wav', 'zone 1: root / keys / gain / pan / loop / file name (last path segment)');
ok(a.audio && a.audio.kind === 'pcm' && a.audio.rate === SR && a.audio.l.length === N && a.audio.l === a.audio.r && Math.abs(a.audio.l[0]) < 1e-4 && Math.abs(a.audio.l[25] - 16000 / 32768 * Math.sin(2 * Math.PI * 441 * 25 / SR)) < 1e-4, '16-bit mono PCM: the 3-frame lead-in skipped, 0x1F7 frames kept');
ok(b.audio && b.audio.r !== b.audio.l && Math.abs(b.audio.l[10] + b.audio.r[10]) < 1e-6 && b.audio.l[10] > 0.1 && b.hi === 128 && b.vlo === 64, 'f32 stereo PCM: left and right apart');
ok(c.file === 'Str Lo.wav' && !c.audio && c.floats[3] === Math.fround(0.3), 'zone 3: a file zone, its floats');
const m1 = toMdawZone(a), m2 = toMdawZone(b);
ok(m1.vol === -6 && m1.pan === -0.25 && m1.loop && m1.vlo === 1 && m2.hi === 127 && m2.vol === 6 && !m2.loop, 'as MobileDAW zones: gain -> dB (0.5 = -6, 2 = +6), keys 0..127, velocity 1..127, loop when mode > 1');
const ar = dwpAttackRelease(p.zones); ok(ar.attack === 0.001 && Math.abs(ar.release - (0.001 + 10 * 0.3 ** 4)) < 1e-5, 'Attack / Release from the last zone (attack float 0 = 1 ms)');
// hostile input
const cut = dwp.subarray(0, dwp.length - 900), pc = parseDwp(cut);
ok(pc.zones.length >= 1 && pc.zones.length <= 3, `a program cut short reads what is there (${pc.zones.length} zones), no throw`);
let threw = ''; try { parseDwp(Buffer.from('RIFF....WAVE')); } catch (e) { threw = e.message; } ok(/dwp/.test(threw), 'a non-program is refused');
let crash = false; try { for (let s = 0; s < 200; s++) { const x = Buffer.from(dwp); for (let k = 0; k < 20; k++) x[8 + ((s * 7919 + k * 104729) % (x.length - 8))] = (s * 31 + k * 17) & 255; parseDwp(x); } } catch (_) { crash = true; } ok(!crash, '200 corrupted programs: no throw');

// ---- in the app
const wav = (n, hz, ch = 1) => { const d = Buffer.alloc(n * 2 * ch); for (let i = 0; i < n; i++) for (let k = 0; k < ch; k++) d.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * hz * i / SR)), 2 * (i * ch + k)); const f = Buffer.alloc(16); f.writeUInt16LE(1, 0); f.writeUInt16LE(ch, 2); f.writeUInt32LE(SR, 4); f.writeUInt32LE(SR * 2 * ch, 8); f.writeUInt16LE(2 * ch, 12); f.writeUInt16LE(16, 14);
  return Buffer.concat([Buffer.from('RIFF'), le(32, 36 + d.length), Buffer.from('WAVEfmt '), le(32, 16), f, Buffer.from('data'), le(32, d.length), d]); };
const { chromium } = createRequire(import.meta.url)('playwright');
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' }; r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
await new Promise((o) => server.once('listening', o));
const br = await chromium.launch(), page = await (await br.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, floatPlugins: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted); await page.waitForTimeout(800);
// an MP3 made by the app's own encoder (js/engine/mp3.js): 1 s of 440 Hz
const { Mp3Encoder } = await import('../js/engine/mp3.js');
const mp3 = (() => { const n = SR, x = Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 440 * i / SR)), enc = new Mp3Encoder(SR, 2, 128), parts = [];
  for (let o = 0; o < n; o += 4096) for (const f of enc.encode(x.subarray(o, o + 4096), x.subarray(o, o + 4096), Math.min(4096, n - o))) parts.push(Buffer.from(f));
  for (const f of enc.finish()) parts.push(Buffer.from(f)); return Buffer.concat(parts); })();
const r = await page.evaluate(async ({ dwp, str, w2, mp3 }) => {
  const P = await import('./js/project.js'), { eng } = await import('./js/engine.js');
  await eng.saveBytes('/Samples/Strings/Str Lo.wav', new Uint8Array(str)); await eng.saveBytes('/Samples/Progs/Test Piano.dwp', new Uint8Array(dwp));
  await eng.saveBytes('/Samples/one.wav', new Uint8Array(w2)); if (mp3) await eng.saveBytes('/Samples/tone.mp3', new Uint8Array(mp3));
  P.newProject(false); P.addTrack('midi'); const i = P.state.tracks.length - 1; P.setInstrument(i, 30);
  const before = P.state.tracks[i].inst.zones.length;
  const res = await P.loadDwpProgram(i, '/Samples/Progs/Test Piano.dwp'), t = P.state.tracks[i], zs = t.inst.zones;
  if (res.error) return { res, err: res.error };
  const sb = zs.map((z) => { const b = eng.sampleBuffers && eng.sampleBuffers(z.sample.id); return b ? { n: b.l.length, st: b.r !== b.l && Math.abs(b.l[100] + b.r[100]) < 1e-3 } : null; });
  const out = { res, n: zs.length, names: zs.map((z) => z.sample.path), keys: zs.map((z) => [z.root, z.lo, z.hi, z.vlo, z.vhi, z.vol, z.pan, z.loop]), sb, atk: t.inst.params[2], rel: t.inst.params[5], from: t.inst.from && t.inst.from.name };
  const H = await import('./js/history.js'); H.undoOp(); out.undone = P.state.tracks[i].inst.zones.length === before && !P.state.tracks[i].inst.zones[0].sample;
  const s1 = await P.setZoneSample(i, 0, '/Samples/one.wav'); out.wav = !!s1;
  if (mp3) { const k = P.addZone(i); const s2 = await P.setZoneSample(i, k, '/Samples/tone.mp3'); out.mp3 = s2 ? s2.duration : 0; }
  const miss = await P.loadDwpProgram(i, '/Samples/one.wav'); out.notProg = miss.error;
  // an imported FLM project whose DirectWave names a library program: the .dwp loads when the project opens
  const o = JSON.parse(P.serialize()); o.tracks[i].inst = { type: 30, params: {}, zones: [], dwp: '/Samples/Progs/Test Piano.dwp' };
  const missing = await P.deserialize(JSON.stringify(o)); const ti = P.state.tracks[i].inst;
  out.onOpen = { zones: (ti.zones || []).filter((z) => z.sample).length, left: ti.dwp || null, missing: missing.length };
  return out;
}, { dwp: [...dwp], str: [...wav(1000, 220)], w2: [...wav(2000, 330, 2)], mp3: mp3 ? [...mp3] : null });
if (r.err) console.log('loadDwpProgram:', r.err);
ok(r.res.zones === 3 && !r.res.missing.length && r.from === 'Test Piano', `program loaded onto DirectWave: ${r.res.zones} zones, nothing missing`);
ok(/\/Samples\/DirectWave\/Test Piano\/01 Piano C3\.wav$/.test(r.names[0]) && /02\.wav$/.test(r.names[1]) && r.names[2] === '/Samples/Strings/Str Lo.wav', 'embedded audio saved next to the program; the file zone found by name in the library: ' + r.names.join(' | '));
ok(JSON.stringify(r.keys[0]) === JSON.stringify([48, 0, 59, 1, 127, -6, -0.25, true]) && JSON.stringify(r.keys[1].slice(0, 6)) === JSON.stringify([72, 60, 127, 64, 127, 6]), 'zone ranges / level / pan / loop in the track');
ok(r.sb[0] && r.sb[0].n > 4000 && r.sb[1] && r.sb[1].st && r.sb[2], 'the samples are in the engine (stereo kept): ' + JSON.stringify(r.sb));
ok(r.atk === 0.001 && Math.abs(r.rel - 0.082) < 1e-4, `Attack ${r.atk} s / Release ${r.rel} s from the program`);
ok(r.undone, 'undo brings the previous zones back');
ok(r.wav, 'a WAV into a DirectWave zone');
ok(r.mp3 > 0.9, `an MP3 into a DirectWave zone (${r.mp3 && r.mp3.toFixed(2)} s)`);
ok(/dwp/.test(r.notProg || ''), 'a WAV given as a program is refused with a message');
ok(r.onOpen.zones === 3 && !r.onOpen.left && !r.onOpen.missing, 'a project naming a library .dwp loads its zones when it opens: ' + JSON.stringify(r.onOpen));
await br.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\ndwp-test: all passed'); process.exit(bad ? 1 : 0);
