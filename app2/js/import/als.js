// Ableton Live set (.als = gzip-compressed XML) -> neutral import model. Live 9 - 12 layouts: MasterTrack / MainTrack, MidiTrack, AudioTrack,
// ReturnTrack, GroupTrack; arrangement clips under MainSequencer > ... > ArrangerAutomation > Events (MidiClip / AudioClip). Times are beats.
// Devices: built-in device element names and VST / VST3 / AU plugin names are read; every device becomes a named placeholder in MDAW.
// Simpler / Sampler with a sample -> DirectWave with that sample; Drum Rack -> drum track with one pad per branch sample.
export const isAls = (u, name) => (u.length > 2 && u[0] === 0x1f && u[1] === 0x8b && /\.als$/i.test(name || '')) || (u.length > 5 && /^<\?xml/.test(String.fromCharCode(...u.subarray(0, 5))) && /\.als$/i.test(name || ''));

// minimal XML -> tree { n: name, a: {attrs}, c: [children] } (enough for Live sets: no DTD, no mixed content needed)
export function parseXml(text) {
  const root = { n: '#root', a: {}, c: [] }, stack = [root];
  const re = /<(\/?)([A-Za-z_][\w.\-:]*)((?:\s+[\w.\-:]+\s*=\s*"[^"]*")*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g;
  const ar = /([\w.\-:]+)\s*=\s*"([^"]*)"/g, ent = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e] || (e[1] === 'x' || e[1] === 'X' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(+e.slice(1))));
  let m;
  while ((m = re.exec(text))) {
    if (!m[2]) continue;
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const el = { n: m[2], a: {}, c: [] }; let q; ar.lastIndex = 0;
    while ((q = ar.exec(m[3] || ''))) el.a[q[1]] = ent(q[2]);
    stack[stack.length - 1].c.push(el);
    if (!m[4]) stack.push(el);
  }
  return root;
}
const kid = (e, n) => (e ? e.c.find((x) => x.n === n) : null);
const kids = (e, n) => (e ? e.c.filter((x) => x.n === n) : []);
const path = (e, ...ns) => { for (const n of ns) e = kid(e, n); return e; };
const val = (e, ...ns) => { const x = path(e, ...ns); return x ? x.a.Value : undefined; };
const num = (v, d = 0) => (v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);
function* all(e, n) { for (const x of e.c) { if (x.n === n) yield x; yield* all(x, n); } }
const first = (e, n) => { for (const x of all(e, n)) return x; return null; };

const STOCK = { Eq8: 'EQ Eight', FilterEQ3: 'EQ Three', Compressor2: 'Compressor', GlueCompressor: 'Glue Compressor', Reverb: 'Reverb', Delay: 'Delay', Echo: 'Echo', AutoFilter: 'Auto Filter', AutoPan: 'Auto Pan', Saturator: 'Saturator', Limiter: 'Limiter', StereoGain: 'Utility', Chorus2: 'Chorus-Ensemble', PhaserNew: 'Phaser-Flanger', Gate: 'Gate', Redux2: 'Redux', DrumBuss: 'Drum Buss', MultibandDynamics: 'Multiband Dynamics', Overdrive: 'Overdrive', Amp: 'Amp', Cabinet: 'Cabinet', Tuner: 'Tuner', SpectrumAnalyzer: 'Spectrum', BeatRepeat: 'Beat Repeat', GrainDelay: 'Grain Delay', Vocoder: 'Vocoder', Corpus: 'Corpus', Resonator: 'Resonators', FrequencyShifter: 'Shifter', Erosion: 'Erosion', Vinyl: 'Vinyl Distortion', Looper: 'Looper', ChannelEq: 'Channel EQ', Roar: 'Roar', Hybrid: 'Hybrid Reverb', AudioEffectGroupDevice: 'Audio Effect Rack', MidiArpeggiator: 'Arpeggiator', MidiChord: 'Chord', MidiScale: 'Scale', MidiPitcher: 'Pitch', MidiVelocity: 'Velocity', MidiNoteLength: 'Note Length', MidiRandom: 'Random',
  OriginalSimpler: 'Simpler', MultiSampler: 'Sampler', InstrumentVector: 'Wavetable', UltraAnalog: 'Analog', Operator: 'Operator', Drift: 'Drift', Collision: 'Collision', InstrumentImpulse: 'Impulse', LoungeLizard: 'Electric', StringStudio: 'Tension', InstrumentMeld: 'Meld', InstrumentGroupDevice: 'Instrument Rack', DrumGroupDevice: 'Drum Rack' };
const INSTR = new Set(['OriginalSimpler', 'MultiSampler', 'InstrumentVector', 'UltraAnalog', 'Operator', 'Drift', 'Collision', 'InstrumentImpulse', 'LoungeLizard', 'StringStudio', 'InstrumentMeld', 'InstrumentGroupDevice', 'DrumGroupDevice']);
function deviceName(d) {
  if (d.n === 'PluginDevice' || d.n === 'AuPluginDevice') {
    const pd = kid(d, 'PluginDesc'), v = pd && pd.c[0];
    const nm = v && (val(v, 'PlugName') || val(v, 'Name'));
    const user = val(d, 'UserName');
    return { name: (user || nm || 'Plugin') + (v ? (v.n.includes('Vst3') ? ' (VST3)' : v.n.includes('Au') ? ' (AU)' : ' (VST)') : ''), plugin: true };
  }
  return { name: val(d, 'UserName') || STOCK[d.n] || d.n.replace(/([a-z])([A-Z])/g, '$1 $2'), plugin: false };
}
function fileRef(e) {                                           // SampleRef > FileRef: Live 11+ <Path>, older <RelativePath> elements + <Name>
  const fr = e && first(e, 'FileRef'); if (!fr) return '';
  const p = val(fr, 'Path') || val(fr, 'RelativePath');
  if (p) return p;
  const rel = kid(fr, 'RelativePath'), dirs = rel ? kids(rel, 'RelativePathElement').map((x) => x.a.Dir).filter(Boolean) : [];
  const nm = val(fr, 'Name'); return nm ? [...dirs, nm].join('/') : '';
}
const mixer = (tr) => path(tr, 'DeviceChain', 'Mixer');
function arrClips(tr, tag) { const ev = first(tr, 'ArrangerAutomation'); return ev ? [...all(ev, tag)] : []; }
function loopInfo(c) {
  const lp = kid(c, 'Loop'), s0 = num(val(c, 'CurrentStart')), s1 = num(val(c, 'CurrentEnd'), s0 + 4);
  return { pos: num(c.a.Time, s0), len: Math.max(1 / 64, s1 - s0), loopStart: num(val(lp, 'LoopStart')), loopEnd: num(val(lp, 'LoopEnd'), 4), startRel: num(val(lp, 'StartRelative')), on: val(lp, 'LoopOn') === 'true', start: s0 };
}

export async function parseAls(u8) {
  let text;
  if (u8[0] === 0x1f && u8[1] === 0x8b) text = await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  else text = new TextDecoder().decode(u8);
  const doc = parseXml(text), set = first(doc, 'LiveSet');
  if (!set) throw new Error('File .als tidak berisi LiveSet.');
  const ab = first(doc, 'Ableton');
  const M = { app: 'Ableton Live' + (ab && ab.a.Creator ? ' (' + ab.a.Creator + ')' : ''), name: '', bpm: 120, sig: [4, 4], channels: [], warnings: [] };
  const main = kid(set, 'MainTrack') || kid(set, 'MasterTrack');
  const mx = mixer(main);
  M.bpm = num(val(mx, 'Tempo', 'Manual'), 120);
  const ts = mx && first(mx, 'RemoteableTimeSignature');
  if (ts) M.sig = [num(val(ts, 'Numerator'), 4), num(val(ts, 'Denominator'), 4)];
  const chanOf = (tr, kind) => {
    const m = mixer(tr), devs = path(tr, 'DeviceChain', 'DeviceChain', 'Devices') || first(tr, 'Devices');
    const ch = { kind, name: val(tr, 'Name', 'UserName') || val(tr, 'Name', 'EffectiveName') || kind, gain: num(val(m, 'Volume', 'Manual'), 1), pan: num(val(m, 'Pan', 'Manual'), 0), mute: val(m, 'Speaker', 'Manual') === 'false', modules: [], pads: [], tracks: [] };
    for (const d of devs ? devs.c : []) {
      const dn = deviceName(d), on = val(d, 'On', 'Manual') !== 'false';
      if (INSTR.has(d.n) && !ch.instrument && !ch.pads.length) {
        if (d.n === 'DrumGroupDevice') {
          for (const br of all(d, 'DrumBranch')) {
            const smp = first(br, 'SampleRef'), note = num(val(first(br, 'BranchInfo') || br, 'ReceivingNote'), 36);
            ch.pads.push({ path: fileRef(smp), name: val(br, 'Name', 'EffectiveName') || val(br, 'Name', 'UserName') || (fileRef(smp).split('/').pop() || 'Pad').replace(/\.\w+$/, ''), gain: 1, pan: 0, pitch: 0, note });
          }
          if (!ch.pads.length) ch.modules.push({ name: dn.name, enabled: on, preset: '', params: [] });
          continue;
        }
        const smp = (d.n === 'OriginalSimpler' || d.n === 'MultiSampler') ? first(d, 'SampleRef') : null;
        ch.instrument = { kind: smp ? 'directwave' : 'unknown', name: dn.name, sample: smp ? fileRef(smp) : '', library: smp ? '' : dn.name, enabled: on };
        continue;
      }
      ch.modules.push({ name: dn.name, enabled: on, preset: '', params: [], app: dn.plugin ? 'Plugin' : 'Ableton Live' });
    }
    return ch;
  };
  const mch = chanOf(main, 'master'); M.channels.push(mch);
  const tracks = kid(set, 'Tracks');
  for (const tr of tracks ? tracks.c : []) {
    if (tr.n === 'ReturnTrack') { M.channels.push(chanOf(tr, 'bus')); continue; }
    if (tr.n !== 'MidiTrack' && tr.n !== 'AudioTrack') { if (tr.n === 'GroupTrack') M.warnings.push('Group track "' + (val(tr, 'Name', 'EffectiveName') || '') + '" dilewati (track di dalamnya tetap diimpor).'); continue; }
    const ch = chanOf(tr, 'track');
    if (tr.n === 'MidiTrack') {
      const st = { kind: ch.pads.length ? 'drums' : 'notes', clips: [] };
      const padIdx = new Map(ch.pads.map((q, k) => [q.note, k]));
      for (const c of arrClips(tr, 'MidiClip')) {
        const L = loopInfo(c), notes = [];
        for (const kt of all(c, 'KeyTrack')) {
          const key = num(val(kt, 'MidiKey'), 60);
          for (const n of all(kt, 'MidiNoteEvent')) if (n.a.IsEnabled !== 'false') notes.push({ t: num(n.a.Time), len: num(n.a.Duration, 0.25), pitch: key, vel: num(n.a.Velocity, 100) / 127 });
        }
        const cyc = L.on ? Math.max(1 / 16, L.loopEnd - L.loopStart) : 0, base = L.on ? L.loopStart : L.start;
        const ns = notes.map((n) => ({ ...n, t: n.t - base })).filter((n) => n.t >= 0 && (!cyc || n.t < cyc));
        if (st.kind === 'drums') for (const n of ns) n.pitch = padIdx.has(n.pitch) ? padIdx.get(n.pitch) : padIdx.has(128 - n.pitch) ? padIdx.get(128 - n.pitch) : -1;
        st.clips.push({ pos: L.pos, len: L.len, cycle: cyc, offset: L.on ? L.start - L.loopStart + L.startRel : 0, notes: ns, muted: val(c, 'Disabled') === 'true' });
      }
      ch.tracks.push(st);
    } else {
      const st = { kind: 'audio', clips: [] };
      for (const c of arrClips(tr, 'AudioClip')) {
        const L = loopInfo(c), smp = first(c, 'SampleRef'), warped = val(c, 'IsWarped') !== 'false';
        const wm = [...all(c, 'WarpMarker')].map((w) => ({ s: num(w.a.SecTime), b: num(w.a.BeatTime) })).sort((a, b) => a.b - b.b);
        let ratio = 1;
        if (warped && wm.length >= 2) { const a = wm[0], b = wm[wm.length - 1]; if (b.s > a.s) ratio = ((b.b - a.b) / (b.s - a.s)) * 60 / M.bpm; }   // stretched length / original
        const k = warped ? 1 : M.bpm / 60;                     // an unwarped clip counts its start / end / loop in seconds
        st.clips.push({ pos: L.pos, len: L.len * k, cycle: L.on ? (L.loopEnd - L.loopStart) * k : 0, offset: warped ? L.start : L.start * M.bpm / 60, sample: fileRef(smp), name: val(c, 'Name') || '', stretch: Math.abs(ratio - 1) < 1e-6 ? 1 : ratio, gain: num(val(c, 'SampleVolume'), 1), muted: val(c, 'Disabled') === 'true' });
      }
      ch.tracks.push(st);
    }
    M.channels.push(ch);
  }
  M.name = '';
  return M;
}
