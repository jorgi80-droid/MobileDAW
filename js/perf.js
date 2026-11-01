// Device performance: class detection (low / mid / high Android), quality profiles with graceful degradation, and an on-device test that
// measures what this phone / browser really manages. Nothing here is a guess shown as a measurement: the report says which numbers were
// measured, which come from the browser, and which are not available on this device.
//
// Profiles (Pengaturan -> Audio -> Performa perangkat):
//   low  : audio buffer 'playback' (largest, fewest dropouts), UI capped at 60 fps, reduced motion, Native engine when the app has it
//   mid  : buffer 'balanced', adaptive UI frame rate
//   high : buffer 'interactive' (lowest latency), adaptive UI frame rate
// 'auto' picks one from the last on-device test, or (before any test) from the core count / device memory the browser reports.
import { prefs, savePrefs } from './prefs.js';
import { eng } from './engine.js';
import { log } from './log.js';

export const PROFILES = {
  low: { name: 'Rendah', latencyHint: 'playback', fpsMode: '60', reduceMotion: true, native: true },
  mid: { name: 'Menengah', latencyHint: 'balanced', fpsMode: 'auto', reduceMotion: false, native: false },
  high: { name: 'Tinggi', latencyHint: 'interactive', fpsMode: 'auto', reduceMotion: false, native: false },
};

export function hwInfo() {
  const n = globalThis.navigator || {};
  return { cores: n.hardwareConcurrency || 0, memGB: n.deviceMemory || 0, ua: n.userAgent || '', android: /Android/i.test(n.userAgent || ''), isolated: globalThis.crossOriginIsolated === true };
}
// before any measurement: a coarse class from what the browser reports (deviceMemory is capped at 8 and rounded by the browser)
export function guessClass(hw = hwInfo()) {
  if ((hw.cores && hw.cores <= 4) || (hw.memGB && hw.memGB <= 3)) return 'low';
  if (hw.cores >= 8 && (!hw.memGB || hw.memGB >= 6)) return 'high';
  return 'mid';
}
// class from a measured engine benchmark: how many dense synth tracks the JS engine renders within half of the real-time budget
export function classFromBench(maxTracks) { return maxTracks < 6 ? 'low' : maxTracks < 16 ? 'mid' : 'high'; }
export const effectiveClass = () => (prefs.perfProfile && prefs.perfProfile !== 'auto' ? prefs.perfProfile : prefs.perfMeasured || guessClass());

// apply a profile to the preferences; returns { reload } when the audio buffer setting changed (it takes effect on the next start)
export function applyProfile(cls) {
  const p = PROFILES[cls] || PROFILES.mid, before = prefs.latencyHint;
  prefs.latencyHint = p.latencyHint; prefs.fpsMode = p.fpsMode; prefs.reduceMotion = p.reduceMotion;
  if (p.native && eng.engineInfo && eng.engineInfo().available && prefs.engine !== 'native') { prefs.engine = 'native'; if (eng.setEngine) eng.setEngine('native'); }
  savePrefs();
  document.documentElement.classList.toggle('reduce-motion', !!prefs.reduceMotion);
  log('info', `profil performa: ${p.name} (buffer ${p.latencyHint}, UI ${p.fpsMode} fps${p.reduceMotion ? ', gerak dikurangi' : ''})`);
  return { reload: before !== p.latencyHint };
}

// ---- the dense test material: N tracks of SuperSaw chords (12 voices) through a Reverb, 8th notes, plus a drum kit on track 0
function stressSetup(cmd, n, PPQ = 960) {
  cmd('tempo', 128);
  for (let t = 0; t < n; t++) {
    cmd('trackInst', t, t === 0 ? 3 : 2);
    const f = [];
    for (let k = 0; k < 16; k++) {
      if (t === 0) { f.push(k * PPQ / 2, PPQ / 4, [36, 42, 38, 42][k % 4], 0.9, 0); continue; }
      for (const d of [0, 4, 7]) f.push(k * PPQ / 2, PPQ * 0.45, 48 + ((t * 5) % 12) + d, 0.6, 0);
    }
    cmd('trackNotes', t, f, f.length / 5);
    cmd('insertDevice', t, 0, 7); cmd('trackVol', t, 0.3);
  }
  cmd('loop', true, 0, PPQ * 8);
}

// Offline benchmark of the JS engine on this device (main thread, the same Engine class the AudioWorklet runs). Real-time factor = render
// time / audio time per track count. Returns { steps: [{ tracks, rt }], maxTracks }.
export async function benchEngine(onStep) {
  const { Engine } = await import('./engine/core.js');
  const SR = 48000, sec = 1, steps = [], L = new Float32Array(128), R = new Float32Array(128);
  for (const n of [1, 2, 4, 8, 12, 16, 24, 32]) {
    const e = new Engine(SR); stressSetup((c, ...a) => e[c](...a), n); e.play();
    for (let i = 0; i < 64; i++) e.render(L, R, 128);                    // warm-up (JIT, tables)
    const blocks = Math.round(sec * SR / 128), t0 = performance.now();
    for (let i = 0; i < blocks; i++) e.render(L, R, 128);
    const rt = (performance.now() - t0) / (sec * 1000);
    steps.push({ tracks: n, rt }); if (onStep) onStep(steps);
    await new Promise((r) => setTimeout(r, 30));
    if (rt > 1.2) break;                                                  // far beyond real time: larger counts say nothing more
  }
  let max = 0; for (const s of steps) if (s.rt <= 0.5) max = s.tracks;
  return { steps, maxTracks: max };
}

// Live test in the real audio path: a second, silent instance of the engine's AudioWorklet runs the stress material while the CPU share of
// its render calls is read from its own poll messages; the browser's playback statistics (underruns) are read where the browser has them.
// The project and the main engine are not touched.
export async function liveStress(onStep, counts = [2, 4, 8, 16, 24], secsEach = 4) {
  const ctx = eng.audioContext && eng.audioContext();
  if (!ctx || !globalThis.AudioWorkletNode) return { error: 'AudioWorklet tidak tersedia.' };
  if (ctx.state !== 'running') { try { await ctx.resume(); } catch (_) { /* needs a tap */ } }
  const node = new AudioWorkletNode(ctx, 'daw', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] }), mute = ctx.createGain();
  mute.gain.value = 0; node.connect(mute); mute.connect(ctx.destination);
  let cpu = [];
  node.port.onmessage = (ev) => { if (ev.data && typeof ev.data.cpu === 'number') cpu.push(ev.data.cpu / 10); };
  const cmd = (c, ...a) => node.port.postMessage({ c, a });
  const stats = () => { const s = ctx.playbackStats || ctx.playoutStats; if (!s) return null; return { under: s.underrunEvents ?? s.fallbackFramesEvents ?? null, underMs: s.underrunDuration != null ? s.underrunDuration * 1000 : (s.fallbackFramesDuration != null ? s.fallbackFramesDuration * 1000 : null) }; };
  const steps = [];
  try {
    for (const n of counts) {
      for (let t = 0; t < 64; t++) cmd('resetTrack', t);
      stressSetup(cmd, n); cmd('seek', 0); cmd('play');
      await new Promise((r) => setTimeout(r, 800)); cpu = []; const s0 = stats();
      await new Promise((r) => setTimeout(r, secsEach * 1000));
      const s1 = stats(), sorted = cpu.slice().sort((a, b) => a - b);
      const step = { tracks: n, cpuMean: cpu.reduce((a, b) => a + b, 0) / Math.max(1, cpu.length), cpuMax: sorted.length ? sorted[sorted.length - 1] : 0, under: s0 && s1 && s0.under != null ? s1.under - s0.under : null, underMs: s0 && s1 && s0.underMs != null ? s1.underMs - s0.underMs : null };
      steps.push(step); if (onStep) onStep(steps);
      cmd('stop');
      if (step.cpuMax > 95 || (step.under || 0) > 3) break;
    }
  } finally { try { node.disconnect(); mute.disconnect(); } catch (_) { /* gone */ } }
  let max = 0; for (const s of steps) if (s.cpuMax <= 70 && !(s.under > 0)) max = s.tracks;
  return { steps, maxTracks: max, sr: ctx.sampleRate, baseMs: (ctx.baseLatency || 0) * 1000, outMs: (ctx.outputLatency || 0) * 1000, playbackStats: !!(ctx.playbackStats || ctx.playoutStats) };
}

// the whole test (about 30 s): offline benchmark, live test, native statistics when the app has the C++ engine; plain-text report
export async function runDeviceTest(onProgress) {
  const hw = hwInfo(), out = { at: new Date().toISOString(), hw, guess: guessClass(hw) };
  onProgress && onProgress('Benchmark engine (offline)…');
  out.bench = await benchEngine((s) => onProgress && onProgress(`Benchmark: ${s[s.length - 1].tracks} track = ${(s[s.length - 1].rt * 100).toFixed(0)}% waktu nyata`));
  onProgress && onProgress('Tes langsung di jalur audio…');
  out.live = await liveStress((s) => { const q = s[s.length - 1]; onProgress && onProgress(`Langsung: ${q.tracks} track, CPU audio ${q.cpuMean.toFixed(0)}% (maks ${q.cpuMax.toFixed(0)}%)${q.under != null ? ', underrun ' + q.under : ''}`); });
  if (eng.nativeStats && eng.engineInfo && eng.engineInfo().available) { try { out.native = await eng.nativeStats(false); } catch (_) { out.native = null; } }
  out.measured = classFromBench(Math.min(out.bench.maxTracks, out.live && !out.live.error ? Math.max(out.live.maxTracks, 1) * 1.5 : 1e9));
  prefs.perfMeasured = out.measured; prefs.perfReport = report(out); savePrefs();
  log('info', 'tes performa: kelas ' + out.measured + ', benchmark maks ' + out.bench.maxTracks + ' track, langsung maks ' + (out.live.maxTracks ?? '-') + ' track');
  return out;
}

export function report(o) {
  const L = [], p = (x, d = 0) => (x == null || !Number.isFinite(x) ? '-' : x.toFixed(d));
  L.push('MobileDAW - laporan performa perangkat', 'Waktu: ' + o.at, 'Browser: ' + o.hw.ua);
  L.push(`Inti CPU (dilaporkan browser): ${o.hw.cores || '-'}, memori: ${o.hw.memGB ? o.hw.memGB + ' GB (dibulatkan browser)' : 'tidak dilaporkan'}, cross-origin isolated: ${o.hw.isolated ? 'ya' : 'tidak'}`);
  L.push('', 'Benchmark engine JS (offline, diukur): track SuperSaw 12 suara + Reverb, per track = % waktu nyata');
  for (const s of o.bench.steps) L.push(`  ${String(s.tracks).padStart(2)} track: ${p(s.rt * 100)}%`);
  L.push(`  Maks dengan cadangan 50%: ${o.bench.maxTracks} track`);
  if (o.live && !o.live.error) {
    L.push('', `Tes langsung di AudioWorklet (diukur): ${p(o.live.sr)} Hz, latensi dasar ${p(o.live.baseMs, 1)} ms, output ${p(o.live.outMs, 1)} ms`);
    for (const s of o.live.steps) L.push(`  ${String(s.tracks).padStart(2)} track: CPU audio rata-rata ${p(s.cpuMean)}%, maks ${p(s.cpuMax)}%, underrun ${s.under == null ? 'tidak tersedia di browser ini' : s.under + (s.underMs != null ? ' (' + p(s.underMs, 1) + ' ms)' : '')}`);
    L.push(`  Maks tanpa underrun dan CPU <= 70%: ${o.live.maxTracks} track`);
  } else L.push('', 'Tes langsung: ' + ((o.live && o.live.error) || 'tidak dijalankan'));
  if (o.native && o.native.blocks) L.push('', `Engine native (dari pemutaran terakhir, diukur): ${o.native.blocks} blok, rata-rata ${p(o.native.mean, 1)}%, p99 ${o.native.p99}%, maks ${p(o.native.max, 1)}%, underrun ${o.native.xruns}, buffer ${o.native.buffer} frame @ ${o.native.sampleRate} Hz`);
  else if (o.native) L.push('', 'Engine native: belum ada statistik (pilih Native, putar lagu, lalu ulangi tes).');
  L.push('', `Kelas perangkat: ${PROFILES[o.measured].name} (perkiraan sebelum tes: ${PROFILES[o.guess].name})`);
  return L.join('\n');
}
