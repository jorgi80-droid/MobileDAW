// Example MobileDAW plugin (docs/PLUGIN-SDK.md): a tremolo / auto-pan with a tempo-synced option.
// Pure JavaScript. Install: Pengaturan -> Audio -> Plugin -> Pasang plugin, or copy this file into the library folder /Plugins.
export const manifest = {
  id: 'org.mobiledaw.example.tremolo',
  name: 'Tremolo',
  version: '1.0.0',
  api: 1,
  kind: 'effect',
  params: [
    { name: 'Rate', min: 0.1, max: 20, def: 4, unit: 'Hz', curve: 'log' },
    { name: 'Depth', min: 0, max: 1, def: 0.6, unit: '%' },
    { name: 'Pan', min: 0, max: 1, def: 0, unit: '%' },          // 0 = tremolo, 1 = auto-pan
    { name: 'Sync', min: 0, max: 1, def: 0, toggle: true },        // on: Rate follows the song tempo (1/8 notes .. whole bars)
  ],
  presets: [
    { name: 'Slow Pulse', params: [1.5, 0.5, 0, 0] },
    { name: 'Helicopter', params: [12, 1, 0, 0] },
    { name: 'Wide Pan', params: [0.5, 0.8, 1, 0] },
  ],
};

export default class Tremolo {
  constructor(sampleRate) { this.sr = sampleRate; this.p = manifest.params.map((q) => q.def); this.ph = 0; this.bpm = 120; this.g = 1; this.lfo = 0; }
  setParam(i, v) { this.p[i] = v; }
  setTempo(bpm) { this.bpm = bpm; }
  process(L, R, n) {                      // realtime: no allocation, no logging, no I/O
    const [rate, depth, pan, sync] = this.p;
    const hz = sync > 0.5 ? this.bpm / 60 * Math.max(0.25, Math.round(rate / 4) / 2) : rate;
    const inc = hz / this.sr; let ph = this.ph;
    for (let i = 0; i < n; i++) {
      ph += inc; if (ph >= 1) ph -= 1;
      const s = Math.sin(2 * Math.PI * ph), a = 1 - depth * (0.5 - 0.5 * s);
      if (pan > 0) { const b = 1 - depth * (0.5 + 0.5 * s); L[i] *= a * pan + a * (1 - pan); R[i] *= b * pan + a * (1 - pan); }
      else { L[i] *= a; R[i] *= a; }
    }
    this.ph = ph; this.lfo = Math.sin(2 * Math.PI * ph);
  }
  readOut(o) { o[0] = this.lfo; return 1; }   // optional: values for displays
}
