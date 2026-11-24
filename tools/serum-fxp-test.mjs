// Moisture (37): the Serum .fxp reader and the wavetable WAV reader (js/serumfxp.js) on files built here with the documented layout:
// VST2 "CcnK" / "FPCh" / "XfsX" header, zlib parameter block (299 LE floats at 0x3460, name at 0x4970) + a second zlib stream (2 x 2048
// floats); a raw "FxCk" program; a 3-frame WAV with a Serum "clm " chunk; the definition and value texts. Usage: node tools/serum-fxp-test.mjs
import zlib from 'node:zlib';
const { parseSerumFxp, parseWavetable, toFrames2048 } = await import('../js/serumfxp.js');
const { INSTRUMENTS, fmtParam } = await import('../js/defs.js');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const be32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };
const fxp = (kind, plugin, name, body) => Buffer.concat([Buffer.from('CcnK'), be32(52 + body.length), Buffer.from(kind), be32(1), Buffer.from(plugin), be32(1), be32(1), Buffer.concat([Buffer.from(name), Buffer.alloc(28 - name.length)]), body]);
// FPCh
const blk = Buffer.alloc(0x4990); const want = Array.from({ length: 299 }, (_, k) => Math.fround(((k * 37) % 101) / 100));
want.forEach((v, k) => blk.writeFloatLE(v, 0x3460 + 4 * k)); Buffer.from('Wobble Bass\0').copy(blk, 0x4970);
const wt = Buffer.alloc(16384); for (let i = 0; i < 4096; i++) wt.writeFloatLE(Math.sin(2 * Math.PI * (i % 2048) / 2048) * (i < 2048 ? 1 : 0.5), 4 * i);
const chunk = Buffer.concat([zlib.deflateSync(blk), zlib.deflateSync(wt)]);
const r = await parseSerumFxp(fxp('FPCh', 'XfsX', 'prog', Buffer.concat([be32(chunk.length), chunk])));
ok(r.plugin === 'XfsX' && r.name === 'Wobble Bass' && r.params.length === 299 && want.every((v, k) => r.params[k] === v), 'FPCh: Serum header, two zlib streams split, 299 parameters exact, name at 0x4970 (' + r.name + ')');
ok(r.tables[0] && r.tables[1] && Math.abs(r.tables[0][512] - 1) < 1e-6 && Math.abs(r.tables[1][512] - 0.5) < 1e-6 && !r.notes.length, 'second stream: 2 x 2048 floats -> wavetables A / B');
// one stream only, another plug-in id
const r2 = await parseSerumFxp(fxp('FPCh', 'ABCD', 'Just Params', Buffer.concat([be32(zlib.deflateSync(blk).length), zlib.deflateSync(blk)])));
ok(r2.tables.every((x) => !x) && r2.notes.some((n) => /ABCD/.test(n)) && r2.params[10] === want[10], 'one stream: no tables; a foreign plug-in id is reported');
// FxCk
const fl = Buffer.alloc(299 * 4); want.forEach((v, k) => fl.writeFloatBE(v, 4 * k));
const fx = fxp('FxCk', 'XfsX', 'Raw', fl); fx.writeUInt32BE(299, 24);
const r3 = await parseSerumFxp(fx); ok(r3.params[298] === want[298] && r3.params[0] === want[0], 'FxCk: raw big-endian parameter list');
let threw = ''; try { await parseSerumFxp(Buffer.from('nope, not a preset at all, long enough to pass the size check....')); } catch (e) { threw = e.message; } ok(/fxp/.test(threw), 'a non-preset file is refused: ' + threw);
// wavetable WAV (16-bit, 1024-point frames, clm chunk)
const F = 3, N = 1024, pcm = Buffer.alloc(F * N * 2); for (let f = 0; f < F; f++) for (let i = 0; i < N; i++) pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * (f + 1) * i / N) * 30000), 2 * (f * N + i));
const clm = Buffer.from('<!>1024 00000000 wavetable (www.xferrecords.com)\0'), le32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const fmt = Buffer.alloc(16); fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(44100, 4); fmt.writeUInt32LE(88200, 8); fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(16, 14);
const body = Buffer.concat([Buffer.from('WAVE'), Buffer.from('fmt '), le32(16), fmt, Buffer.from('clm '), le32(clm.length), clm, Buffer.alloc(clm.length & 1), Buffer.from('data'), le32(pcm.length), pcm]);
const wav = Buffer.concat([Buffer.from('RIFF'), le32(body.length), body]);
const t = parseWavetable(wav), f2 = toFrames2048(t);
ok(t.frame === 1024 && t.data.length === F * N && f2.length === F * 2048 && Math.abs(f2[2048 * 2 + 171] - Math.sin(2 * Math.PI * 3 * 171 / 2048) * 30000 / 32768) < 0.01, 'wavetable WAV: clm frame size 1024 read, 3 frames resampled to 2048 points as stored (no rate conversion)');
// definition
const d = INSTRUMENTS[37], t7 = INSTRUMENTS[7];
ok(d && d.name === 'Moisture' && t7.name === 'Moisture Klasik' && d.params.length === 396 && d.params[45].n === 'Fil Cutoff' && fmtParam(d.params[45], 0.5) === '420 Hz' && fmtParam(d.params[44], 1 / 95) === 'MG Low 12' && fmtParam(d.params[3], 0.75) === '+2 oct',
  'Moisture definition: Serum order (0..298) + 97 own, value texts (cutoff 420 Hz, MG Low 12, +2 oct); the old Moisture is "Moisture Klasik"');
console.log(bad ? `\n${bad} FAILED` : '\nserum-fxp-test: all passed'); process.exit(bad ? 1 : 0);
