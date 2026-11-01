// Project import (js/import/*): FL Studio Mobile .flm, Ableton .als, FL Studio .flp -> MDAW. Files are generated here with the documented
// layouts; set FLM_ZIP=/path/to/project.zip to also convert a real FL Studio Mobile archive. Usage: node tools/import-test.mjs
import fs from 'node:fs'; import zlib from 'node:zlib';
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const { parseFlm, flmToModel } = await import('../js/import/flm.js');
const { parseAls } = await import('../js/import/als.js');
const { parseFlp } = await import('../js/import/flp.js');
const { buildMdaw } = await import('../js/import/build.js');
const { importProject } = await import('../js/import/index.js');
const { makeZip } = await import('../js/zip.js');
let bad = 0; const ok = (c, m) => { if (c) console.log('ok   ' + m); else { bad++; console.log('FAIL ' + m); } };

// ---------- FLM writer (same layout as js/import/flm.js documents)
const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const asc = (s) => new TextEncoder().encode(s);
const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
const i32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); return b; };
const u16 = (v) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; };
const f32s = (...v) => { const b = new Uint8Array(4 * v.length), d = new DataView(b.buffer); v.forEach((x, k) => d.setFloat32(4 * k, x, true)); return b; };
const f64 = (v) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); return b; };
const fixed = (s, n) => { const b = new Uint8Array(n); b.set(asc(s).subarray(0, n - 1)); return b; };
const ck = (tag, ...data) => { const d = cat(...data); return cat(asc(tag), u32(d.length), d); };
const pth = (p) => { const s = cat(asc('@L@'), new Uint8Array(1), asc(p)); return cat(u16(s.length), s); };
function flmFile() {
  const head = ck('HEAD', u32(0), u32(2), fixed('Tes FLM', 256), new Uint8Array(0x108 - 264), f64(150), new Uint8Array(32), asc('4.6.0'));
  const chhd = (name, order, num) => ck('CHHD', fixed(name, 1024), new Uint8Array(8), f32s(order, 0.3), new Uint8Array(0x438 - 1040), u32(num));
  const mod = (type, id, params, preset = 'Default/Default', extra = []) => ck('RMOd', i32(type), u32(id), ck('HEAD', new Uint8Array(9)), ck('DESC', fixed('Default', 256), fixed('Default', 256), new Uint8Array(4)), ck('PRST', u32(preset.length), u32(0), asc(preset)), ck('ADD1', new Uint8Array(3)), ck('PRMS', f32s(...params)), ck('SMPR', new Uint8Array(12)), ...extra);
  const rack = (flag, vol, mods = [], rsmp = []) => ck('RACK', u32(flag), asc('10KR'), ck('RHED', new Uint8Array(16)), ck('RPRM', f32s(vol, 0.25, 0, 0, 0.5, 0)), ...mods, ...rsmp);
  const desc = (kind, mod = -1, prm = -1, label = '') => ck('DESc', i32(kind), i32(mod), i32(prm), new Uint8Array(16), fixed(label, 1024));
  const clhd = (len, cyc, off, src = 0, flags = 0) => ck('CLHd', f64(len), f64(cyc), f64(off), i32(1), f64(src), new Uint8Array([flags]));
  const evn = (recs) => ck('EVN2', u16(20), ...recs.map((r) => cat(u32(r.t * 128), f64(r.len || 0), u16(r.p), u16(32767), u16(r.v ?? 32767), u16(0))));
  const clip = (pos, ...kids) => ck('CLIP', u32(pos * 128), asc('20LC'), ...kids);
  const clsm = (path, ratio) => ck('CLSm', asc('20LS'), ck('MAIN', i32(-1), f64(-1), fixed('nama klip', 1024)), ck('PTH1', pth(path)), ck('STRC', new Uint8Array([1]), f64(ratio), f64(1), f32s(0.5, 0.3)), ck('PRMS', f32s(0.853, 0.5, 0.5)));
  const chnl = (flag, name, order, num, ...trk) => ck('CHNL', u32(flag), asc('20HC'), chhd(name, order, num), ...trk);
  const parts = [asc('10LF'), head, ck('TDIV', new Uint8Array([3, 4]))];
  parts.push(rack(0, 0.853, [mod(7, 2, [1, 0.5, 0.5])]), rack(0x100, 0.6, [mod(7, 2, [1, 0.5]), mod(29, 3, [0, 1], 'urces/Effect Presets/Autoduck2/Hard.flmpst')]),
    rack(0x100, 0.853, [mod(1, 2, [1], 'x', [ck('CSTM', asc('10WD'), ck('ZONE', asc('@L@'), new Uint8Array(1), asc('My Samples/lead.wav'), new Uint8Array(20)))]), mod(20, 4, [1, 0.7, 0.5])]),
    rack(0x100, 0.853, [], [ck('RSMP', asc('10MS'), u32(2), ck('PADS', new Uint8Array(22)), ck('SMPl', asc('20LS'), ck('PTH1', pth('My Samples/kick.wav')), ck('PRMS', f32s(0.853, 0.5, 0.5))), ck('SMPl', asc('20LS'), ck('PTH1', pth('My Samples/hilang.wav')), ck('PRMS', f32s(0.5, 0.5, 0.5))))]));
  parts.push(chnl(0, 'MASTER', 0, 0, ck('TRKH', desc(1))),
    chnl(0x100, 'Vokal', 2.5, 1, ck('TRKH', desc(2), clip(4, clhd(8, 1024, 1, 7.5), ck('ZOOM', new Uint8Array(32)), clsm('My Tracks/vokal.wav', 0.8), evn([])), clip(16, clhd(8, 4, 0, 4), ck('ZOOM', new Uint8Array(32)), clsm('My Tracks/tidakada.wav', 1), evn([]))),
      ck('TRKH', desc(1, 0, 0, 'Level'), clip(0, clhd(8, 8, 0), ck('ZOOM', new Uint8Array(32)), evn([{ t: 0, p: 1, v: 30000 }, { t: 4, p: 1, v: 60000 }])))),
    chnl(0x100, 'Lead', 2.0, 2, ck('TRKH', desc(0), clip(8, clhd(12, 4, 2), ck('ZOOM', new Uint8Array(32)), evn([{ t: 0, len: 0.5, p: 60 }, { t: 1, len: 0.5, p: 64 }, { t: 3, len: 1, p: 67 }]))),
      ck('TRKH', desc(1, 4, 1, 'Gain : FX Leveller'), clip(0, clhd(4, 4, 0), ck('ZOOM', new Uint8Array(32)), evn([{ t: 0, p: 2, v: 100 }])))),
    chnl(0x100, 'Drum', 3, 3, ck('TRKH', desc(3), clip(0, clhd(16, 4, 0), ck('ZOOM', new Uint8Array(32)), evn([{ t: 0, len: 0.125, p: 0 }, { t: 1, len: 0.125, p: 1 }, { t: 2, len: 0.125, p: 0 }])))));
  return cat(...parts);
}
const flm = flmFile();
const P = parseFlm(flm), M = flmToModel(P);
ok(P.name === 'Tes FLM' && P.bpm === 150 && P.sig.join('/') === '3/4' && P.appVersion === '4.6.0', 'FLM header: name, tempo 150, 3/4, app version');
const ch = (n) => M.channels.find((c) => c.name === n);
ok(ch('Lead').tracks[0].clips[0].notes.length === 3 && ch('Lead').instrument.sample === 'My Samples/lead.wav', 'FLM notes track + DirectWave sample from its zone');
ok(ch('Vokal').modules.map((m) => m.name).join() === 'Graphic EQ,Autoduck' && ch('Vokal').modules[1].enabled === false, 'FLM modules in rack order, names from the module table, bypass from param 0');
ok(Math.abs(ch('Vokal').gain - 0.6 / 0.853) < 1e-6 && Math.abs(ch('Vokal').pan - (-0.5)) < 1e-6, 'FLM channel level / pan');
ok(ch('Lead').modules.some((m) => m.name === 'Leveller'), 'Leveller (type 20) named from the module table');
const have = new Set(['My Tracks/vokal.wav', 'My Samples/lead.wav', 'My Samples/kick.wav']);
const B = buildMdaw(M, { root: '/Samples/Imports/T', has: (p) => have.has(p) });
const tr = (n) => B.json.tracks.find((t) => t.name === n);
const voc = tr('Vokal'), lead = tr('Lead'), drum = tr('Drum');
ok(B.json.bpm === 150 && B.json.sig.n === 3 && B.json.sig.d === 4, 'MDAW project: tempo + signature');
ok(voc.kind === 'audio' && voc.clips[0].start === 4 * 960 && voc.clips[0].len === 8 * 960 && Math.abs(voc.clips[0].offset - 60 / 150) < 1e-9 && voc.clips[0].warp.ratio === 0.8, 'audio clip: position, length, offset (s), stretch ratio');
ok(voc.clips[1].name.includes('sample tidak ada') && voc.clips[1].sample.path.includes('/_missing/') && voc.clips[1].start === 16 * 960, 'missing sample: clip kept (place, length, name) with a silent placeholder');
ok(voc.clips[1].len === 8 * 960 && !voc.clips[1].ll, 'missing sample clip: no loop on the placeholder');
ok(voc.devices.length === 2 && voc.devices.every((d) => d.type === 0 && d.missing) && voc.devices[1].bypass && voc.devices[1].missing.name === 'Autoduck', 'plugins -> placeholder devices "[Plugin tidak tersedia]" keeping name, preset and params');
ok(lead.kind === 'midi' && lead.inst.type === 4 && lead.inst.zones[0].sample.path === '/Samples/Imports/T/My Samples/lead.wav', 'DirectWave instrument with its sample');
const lc = lead.clips[0];
ok(lc.start === 8 * 960 && lc.len === 12 * 960 && lc.ll === 4 * 960 && lc.lp === 2 * 960 && lc.notes.length === 3 && lc.notes[1].t === 960 && lc.notes[0].d === 480, 'pattern clip: cycle 4 beats, loop position 2, length 12 (repeats without copying notes)');
ok(drum.kind === 'drum' && drum.inst.pads.length === 2 && drum.inst.pads[1].mute && !drum.inst.pads[1].sample && drum.clips[0].notes.map((n) => n.p).join() === '36,37,36', 'drums: pads from the sampler, missing pad kept (muted), steps kept');
const auto = B.json.tracks.find((t) => t.kind === 'auto');
ok(auto && auto.target.strip === voc.id && auto.clips[0].pts.length === 2 && auto.clips[0].pts[1].t === 4 * 960, 'mixer Level automation -> MDAW volume automation on that track');
ok(B.report.skipped.some((s) => /FX Leveller/.test(s)), 'automation of an unavailable plugin is reported, not dropped silently');
ok(B.report.samplesMissing.includes('My Tracks/tidakada.wav') && B.report.samplesMissing.includes('My Samples/hilang.wav') && B.report.samplesFound === 3, 'report: samples found / missing');

// ---------- module migration to MDAW stock plugins (js/import/fxmap.js) and the sound it keeps
const FX = await import('../js/import/fxmap.js');
const { Engine } = await import('../js/engine/core.js');
const { DEVICES } = await import('../js/defs.js');
{
  const d = (name, params, extra = {}) => FX.decide({ name, params, ...extra });
  const geqFlat = d('Graphic EQ', [1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]), geq = d('Graphic EQ', [1, 0.5, 0.75, 0.5, 0.5, 0.5, 0.5, 0.5, 0.25]);
  ok(geqFlat.apply && geqFlat.type === 31 && geqFlat.how === 'exact' && geq.how === 'approx' && geq.params[8] === 6 && geq.params[38] === -6, 'Graphic EQ -> EQ Eight: flat = exact, band gains from the sliders (+6 dB at 160 Hz, -6 dB at 12 kHz)');
  const lv = d('FX Leveller', [1, 0.7071, 0.5]), lv2 = d('Leveller', [1, 0.554, 0.75]);
  ok(lv.apply && lv.type === 0 && lv.how === 'exact' && Math.abs(lv.params[0]) < 0.01 && lv2.how === 'approx' && Math.abs(lv2.params[0] - 20 * Math.log10((0.554 / 0.7071) ** 2)) < 0.01 && lv2.params[1] === 0.5, 'Leveller -> Utility gain / pan');
  ok(d('Compressor', [0, 0.7, 0.2]).how === 'off' && d('Compressor', [0, 0.7]).bypass === true, 'a module that is OFF in the source -> its stock equivalent, bypassed');
  ok(!d('Compressor', [1, 0.7, 0.2]).apply && d('Compressor', [1, 0.7, 0.2], {}).why === 'layout' && FX.decide({ name: 'Compressor', params: [1, 0.7] }, 'all').bypass === true, 'unverified parameters: not applied on import; "replace all" installs it bypassed');
  ok(d('Pitcher 2', [1]).why === 'none' && d('Tape Stop', [1]).why === 'none' && d('Efek FLM #35', [1]).why === 'unknown', 'no MDAW equivalent / unidentified module -> reported, stays a placeholder');
  ok(!d('Tape Delay', [1, 0.4, 0.6, 0.4, 0.6], { sure: false }).apply && FX.decide({ name: 'Tape Delay', params: [1], sure: false }, 'all').how === 'later', 'identity only guessed from the layout: never switched on automatically');
  ok(d('Spacer', [1, 0.5, 0.5, 0.5, 0, 0.5, 0, 0]).how === 'exact' && !d('Spacer', [1, 0.9, 0.5, 0.5, 0, 0.5, 0, 0]).apply, 'Spacer at its neutral default -> neutral Utility; any other setting is not guessed');
  // engine: the converted chain sounds like the original module would where the mapping is exact (null tests at the sample level)
  const render = (devs) => { const e = new Engine(48000); e.trackInst(0, 1); devs.forEach((x, j) => { e.insertDevice(0, j, x.type); x.params.forEach((v, k) => e.devParam(0, j, k, v)); if (x.bypass) e.devBypass(0, j, true); }); e.preview(0, 45, 0.9, true); const L = new Float32Array(128), R = new Float32Array(128), out = []; for (let b = 0; b < 150; b++) { L.fill(0); R.fill(0); e.render(L, R, 128); for (let i = 0; i < 128; i++) out.push(L[i], R[i]); } return out; };
  const diffDb = (a, b) => { let n = 0, s = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - b[i]) ** 2; s += b[i] ** 2; } return n ? 10 * Math.log10(n / Math.max(1e-20, s)) : -Infinity; };
  const dry = render([]), util = DEVICES[0].params.map((q) => q.def);
  ok(diffDb(render([{ type: 0, params: util }]), dry) < -120, 'placeholder (neutral Utility) leaves the audio unchanged');
  ok(diffDb(render([{ type: 4, params: DEVICES[4].params.map((q) => q.def), bypass: true }]), dry) < -120, 'a bypassed stock plugin leaves the audio unchanged ("off" modules, "replace all")');
  ok(diffDb(render([{ type: 31, params: FX.fill(31, geqFlat.params) }]), dry) < -90, 'flat Graphic EQ -> EQ Eight: same sound (difference < -90 dB)');
  ok(diffDb(render([{ type: 0, params: FX.fill(0, lv.params) }]), dry) < -120, 'Leveller at 0 dB -> Utility: same sound');
  const tone = (f, devs) => { const e = new Engine(48000); devs.forEach((x, j) => { e.insertDevice(0, j, x.type); x.params.forEach((v, k) => e.devParam(0, j, k, v)); }); const n = 48000, s = new Float32Array(n), L = new Float32Array(128), R = new Float32Array(128); let i0 = 0, acc = 0, cnt = 0; const dev = e.s && e.s[0] && e.s[0].dev; if (!dev) return null; for (let b = 0; b * 128 < n; b++) { for (let i = 0; i < 128; i++) { L[i] = R[i] = 0.25 * Math.sin(2 * Math.PI * f * (b * 128 + i) / 48000); } for (const x of dev) x.process(L, R, 128); if (b * 128 > n / 2) for (let i = 0; i < 128; i++) { acc += L[i] * L[i]; cnt++; } } return 10 * Math.log10(acc / cnt / (0.25 * 0.25 / 2)); };
  const g160 = tone(160, [{ type: 31, params: FX.fill(31, geq.params) }]), g12k = tone(12000, [{ type: 31, params: FX.fill(31, geq.params) }]);
  if (g160 === null) console.log('     (direct device processing not exposed: band-gain check skipped)');
  else ok(Math.abs(g160 - 6) < 1.5 && Math.abs(g12k + 6) < 1.5, `Graphic EQ conversion: +6 dB slider -> ${g160.toFixed(1)} dB at 160 Hz, -6 dB slider -> ${g12k.toFixed(1)} dB at 12 kHz`);
}

// ---------- the whole import (zip -> files -> project) with a fake storage
const files = new Map(); let opened = null;
const io = { home: '', saveBytes: async (p, b) => { files.set(p, b); }, writeText: async (p, t) => { files.set(p, t); }, open: async (t, prog) => { opened = JSON.parse(t); prog(0.5); prog(1); return []; } };
const wav = new Uint8Array(64);
const zipBlob = makeZip([{ name: 'Tes/Tes FLM.flm', data: flm }, { name: 'Tes/My Tracks/vokal.wav', data: wav }, { name: 'Tes/My Samples/lead.wav', data: wav }, { name: 'Tes/My Samples/kick.wav', data: wav }]);
const steps = [];
const R = await importProject('Tes.zip', new Uint8Array(await zipBlob.arrayBuffer()), io, (f, l) => steps.push([f, l]));
ok(R.name === 'Tes FLM' && files.has('/Projects/Tes FLM.mdaw') && opened && opened.tracks.length === B.json.tracks.length, 'import: project saved as Projects/<name>.mdaw and opened');
ok(files.has('/FLM/Tes FLM/My Tracks/vokal.wav') && files.has('/FLM/Tes FLM/My Samples/lead.wav') && [...files.keys()].some((k) => /^\/FLM\/Tes FLM\/_missing\/tidakada\.wav$/.test(k)), 'import: FLM samples stored as FLM/<project>/<sample folders> (zip wrapper folder dropped), placeholders for missing ones');
ok(opened.tracks.find((t) => t.name === 'Vokal').clips[0].sample.path === '/FLM/Tes FLM/My Tracks/vokal.wav', 'the saved .mdaw refers to the FLM/<project> paths');
ok(steps.length > 5 && steps.every((s, k) => !k || s[0] >= steps[k - 1][0]) && steps[steps.length - 1][0] === 1, 'progress: ' + steps.length + ' steps, never going back, ends at 100 %');

// ---------- Ableton .als (gzip XML)
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" Creator="Ableton Live 12.0"><LiveSet>
<Tracks>
 <MidiTrack Id="1"><Name><EffectiveName Value="Bass"/><UserName Value=""/></Name>
  <DeviceChain><Mixer><Volume><Manual Value="0.5"/></Volume><Pan><Manual Value="0.25"/></Pan><Speaker><Manual Value="true"/></Speaker></Mixer>
   <MainSequencer><ClipTimeable><ArrangerAutomation><Events>
    <MidiClip Id="0" Time="8"><CurrentStart Value="0"/><CurrentEnd Value="16"/><Loop><LoopStart Value="0"/><LoopEnd Value="4"/><StartRelative Value="0"/><LoopOn Value="true"/></Loop><Name Value="Riff"/>
     <Notes><KeyTracks><KeyTrack Id="0"><Notes><MidiNoteEvent Time="0" Duration="0.5" Velocity="127" IsEnabled="true"/><MidiNoteEvent Time="2" Duration="0.5" Velocity="64" IsEnabled="true"/></Notes><MidiKey Value="36"/></KeyTrack></KeyTracks></Notes></MidiClip>
   </Events></ArrangerAutomation></ClipTimeable></MainSequencer>
   <DeviceChain><Devices>
    <OriginalSimpler Id="0"><On><Manual Value="true"/></On><Player><MultiSampleMap><SampleParts><MultiSamplePart><SampleRef><FileRef><Path Value="C:/Users/me/Samples/bass.wav"/></FileRef></SampleRef></MultiSamplePart></SampleParts></MultiSampleMap></Player></OriginalSimpler>
    <PluginDevice Id="1"><On><Manual Value="true"/></On><PluginDesc><Vst3PluginInfo Id="0"><Name Value="Serum"/></Vst3PluginInfo></PluginDesc></PluginDevice>
    <Reverb Id="2"><On><Manual Value="false"/></On></Reverb>
   </Devices></DeviceChain></DeviceChain></MidiTrack>
 <AudioTrack Id="2"><Name><EffectiveName Value="Vox"/><UserName Value="Vokal"/></Name>
  <DeviceChain><Mixer><Volume><Manual Value="1"/></Volume><Pan><Manual Value="0"/></Pan><Speaker><Manual Value="false"/></Speaker></Mixer>
   <MainSequencer><Sample><ArrangerAutomation><Events>
    <AudioClip Id="0" Time="4"><CurrentStart Value="1"/><CurrentEnd Value="9"/><Loop><LoopStart Value="0"/><LoopEnd Value="8"/><StartRelative Value="0"/><LoopOn Value="false"/></Loop><Name Value="vox take"/><IsWarped Value="true"/>
     <SampleRef><FileRef><RelativePath Value="Samples/Recorded/vox.wav"/><Path Value="/Users/me/Project/Samples/Recorded/vox.wav"/></FileRef></SampleRef>
     <WarpMarkers><WarpMarker Id="0" SecTime="0" BeatTime="0"/><WarpMarker Id="1" SecTime="4" BeatTime="8"/></WarpMarkers></AudioClip>
   </Events></ArrangerAutomation></Sample></MainSequencer>
   <DeviceChain><Devices><Compressor2 Id="0"><On><Manual Value="true"/></On></Compressor2></Devices></DeviceChain></DeviceChain></AudioTrack>
 <ReturnTrack Id="3"><Name><EffectiveName Value="A-Reverb"/></Name><DeviceChain><Mixer><Volume><Manual Value="1"/></Volume></Mixer><DeviceChain><Devices><Reverb Id="0"/></Devices></DeviceChain></DeviceChain></ReturnTrack>
</Tracks>
<MainTrack><DeviceChain><Mixer><Tempo><Manual Value="128"/></Tempo><TimeSignature><TimeSignatures><RemoteableTimeSignature Id="0"><Numerator Value="6"/><Denominator Value="8"/><Time Value="0"/></RemoteableTimeSignature></TimeSignatures></TimeSignature></Mixer><DeviceChain><Devices><Limiter Id="0"/></Devices></DeviceChain></DeviceChain></MainTrack>
</LiveSet></Ableton>`;
const A = await parseAls(new Uint8Array(zlib.gzipSync(Buffer.from(xml))));
ok(A.bpm === 128 && A.sig.join('/') === '6/8' && /Live 12/.test(A.app), 'ALS: tempo, signature, creator');
const bass = A.channels.find((c) => c.name === 'Bass'), vox = A.channels.find((c) => c.name === 'Vokal');
ok(bass.instrument.sample === 'C:/Users/me/Samples/bass.wav' && bass.modules.map((m) => m.name).join() === 'Serum (VST3),Reverb' && bass.modules[1].enabled === false, 'ALS: Simpler sample, VST3 plugin name, stock device name + off state');
ok(bass.tracks[0].clips[0].pos === 8 && bass.tracks[0].clips[0].len === 16 && bass.tracks[0].clips[0].cycle === 4 && bass.tracks[0].clips[0].notes.length === 2 && Math.abs(bass.tracks[0].clips[0].notes[1].vel - 64 / 127) < 1e-9, 'ALS: MIDI clip position, length, loop, notes, velocity');
ok(vox.mute && vox.tracks[0].clips[0].pos === 4 && vox.tracks[0].clips[0].len === 8 && Math.abs(vox.tracks[0].clips[0].stretch - 2 * 60 / 128) < 1e-9 && vox.tracks[0].clips[0].offset === 1, 'ALS: audio clip, warp ratio from warp markers, start offset, track mute');
ok(A.channels.some((c) => c.kind === 'bus' && c.name === 'A-Reverb') && A.channels[0].modules[0].name === 'Limiter', 'ALS: return track + master devices');
const AB = buildMdaw(A, { root: '/S', resolve: (p) => (/bass\.wav$/.test(p) ? 'bass.wav' : null) });
ok(AB.json.tracks.find((t) => t.name === 'Bass').inst.zones[0].sample.path === '/S/bass.wav' && AB.json.returns[0].name === 'A-Reverb', 'ALS -> MDAW: sample matched by file name, return track');

// ---------- FL Studio .flp (events)
const ev = [];
const eb = (id, v) => ev.push(new Uint8Array([id, v])), ew = (id, v) => ev.push(cat(new Uint8Array([id]), u16(v))), ed = (id, v) => ev.push(cat(new Uint8Array([id]), u32(v)));
const et = (id, s) => { const b = new Uint8Array(s.length * 2 + 2); for (let k = 0; k < s.length; k++) b[k * 2] = s.charCodeAt(k); ev.push(cat(new Uint8Array([id, b.length]), b)); };
const edata = (id, b) => { let n = b.length, vl = []; do { let x = n & 127; n >>= 7; if (n) x |= 128; vl.push(x); } while (n); ev.push(cat(new Uint8Array([id, ...vl]), b)); };
ed(156, 174000); eb(17, 4); eb(18, 4); et(194, 'Lagu FLP');
ew(64, 0); eb(21, 0); et(201, 'Sampler'); et(203, 'Kick'); et(196, 'C:\\Samples\\kick.wav');
ew(64, 1); eb(21, 2); et(201, 'Fruity Wrapper'); et(203, 'Sytrus');
ew(65, 1);
const note = (pos, chan, len, key, vel) => { const b = new Uint8Array(24), d = new DataView(b.buffer); d.setUint32(0, pos, true); d.setUint16(6, chan, true); d.setUint32(8, len, true); d.setUint16(12, key, true); b[20] = 64; b[21] = vel; return b; };
edata(224, cat(note(0, 0, 24, 60, 100), note(96, 0, 24, 60, 100), note(0, 1, 192, 72, 128)));
const item = (pos, idx, len) => { const b = new Uint8Array(32), d = new DataView(b.buffer); d.setUint32(0, pos, true); d.setUint16(4, 20480, true); d.setUint16(6, idx, true); d.setUint32(8, len, true); d.setFloat32(24, -1, true); return b; };
edata(233, cat(item(0, 20481, 384), item(768, 20481, 384)));
eb(236, 0); et(201, 'Fruity Limiter'); et(203, 'Limiter'); ew(98, 0);
eb(236, 0); et(201, 'Fruity Reeverb 2'); et(203, 'Reverb'); ew(98, 0);
const body = cat(...ev), flp = cat(asc('FLhd'), u32(6), u16(0), u16(2), u16(96), asc('FLdt'), u32(body.length), body);
const F = parseFlp(flp);
ok(F.bpm === 174 && F.name === 'Lagu FLP', 'FLP: tempo, title (UTF-16)');
const kick = F.channels.find((c) => c.name === 'Kick'), syt = F.channels.find((c) => c.name === 'Sytrus');
ok(kick && kick.instrument.sample === 'C:\\Samples\\kick.wav' && kick.tracks[0].clips.length === 2 && kick.tracks[0].clips[1].pos === 8 && kick.tracks[0].clips[0].notes.length === 2, 'FLP: sampler channel, pattern placed twice on the playlist, notes');
ok(syt && syt.instrument.name === 'Fruity Wrapper' && syt.tracks[0].clips[0].notes[0].pitch === 72 && syt.tracks[0].clips[0].notes[0].len === 2, 'FLP: plugin channel keeps its plugin name, note pitch / length');
ok(F.channels[0].kind === 'master' && F.channels[0].modules[0].name === 'Limiter' && F.channels.some((c) => c.kind === 'bus' && c.modules[0].name === 'Reverb'), 'FLP: mixer effect slots (master + insert)');

// ---------- optional: the owner's real FL Studio Mobile archive
if (process.env.FLM_ZIP && fs.existsSync(process.env.FLM_ZIP)) {
  const files2 = new Map(); let op = null;
  const io2 = { home: '', saveBytes: async (p, b) => { files2.set(p, b.length); }, writeText: async (p, t) => { files2.set(p, t.length); }, open: async (t) => { op = JSON.parse(t); return []; } };
  const t0 = Date.now(), R2 = await importProject(process.env.FLM_ZIP.split('/').pop(), fs.readFileSync(process.env.FLM_ZIP), io2, () => {});
  console.log(`     real archive: "${R2.name}" ${op.tracks.length} tracks, ${R2.report.clips} clips, ${R2.report.notes} notes, ${R2.report.samplesFound} samples, missing ${R2.report.samplesMissing.length}, ${Date.now() - t0} ms`);
  ok(op.tracks.length > 0 && R2.report.samplesMissing.length === 0 && R2.report.clips > 0, 'real FL Studio Mobile archive converts with every sample found');
}
console.log(bad ? `\n${bad} FAILED` : '\nimport-test: all passed'); process.exit(bad ? 1 : 0);
