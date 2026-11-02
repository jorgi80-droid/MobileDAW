// Audio Effect Rack of the web engine (Live 12): up to 8 parallel chains, each a list of effects with its own volume / pan / activator / solo,
// summed at the output; 8 macro knobs, each mapped to one parameter of a device inside the rack (Min .. Max, log curve when the target has one).
// The devices inside are created by the engine (core.js rackCmd -> e.mk(type)); this file never imports fx.js.
// Parameters: chain c (0..7) at 4c: volume dB (-60 = off), pan, activator, solo | 32 chain count | 33..40 macros (0..1) |
// 41 + 8m: macro m map (chain (-1 = none), device index, parameter, target min, target max, log, Min, Max) | 105 chain selector (0..127) |
// 106 + 2c: chain c select zone low / high (the chain plays while the selector is inside its zone)
import { clamp, chainLat, PdcLine, PDC_MAX } from './dsp.js';

export const RACK_CHAINS = 8, RACK_MACROS = 8, RACK_MAP0 = 41;
export class AudioEffectRack {
  constructor(sr) {
    this.sr = sr; this.bypass = false; this.bpm = 120; this.rack = true;
    this.p = []; for (let c = 0; c < RACK_CHAINS; c++) this.p.push(0, 0, 1, 0); this.p.push(1); for (let m = 0; m < RACK_MACROS; m++) this.p.push(0); for (let m = 0; m < RACK_MACROS; m++) this.p.push(-1, 0, 0, 0, 1, 0, 0, 1); this.p.push(0); for (let c = 0; c < RACK_CHAINS; c++) this.p.push(0, 127);
    this.ch = Array.from({ length: RACK_CHAINS }, () => ({ dev: [] })); this.L = new Float32Array(128); this.R = new Float32Array(128); this.sL = new Float32Array(128); this.sR = new Float32Array(128);
    this.pk = new Float32Array(RACK_CHAINS); this.last = new Float64Array(RACK_MACROS).fill(NaN);
    for (const c of this.ch) c.pdl = new PdcLine();   // PDC inside the rack: the faster parallel chains wait for the slowest one
  }
  // latency of the rack = its slowest chain (every chain that exists counts, so switching a chain on / off never moves the timing)
  lat() { const cnt = clamp(Math.round(this.p[32]), 0, RACK_CHAINS); let m = 0; for (let c = 0; c < cnt; c++) { const l = chainLat(this.ch[c].dev); if (l > m) m = l; } return Math.min(m, PDC_MAX - 1); }
  // after chain c's devices: delay it to the slowest chain (D = 0: untouched)
  align(c, bl, br, n, M) { const x = this.ch[c], D = M - Math.min(M, chainLat(x.dev)); if (D > 0) x.pdl.run(bl, br, n, D); else x.pdl.clear(); }
  setParam(i, v) { this.p[i] = v; if (i >= RACK_MAP0 && i < RACK_MAP0 + 64) this.last[Math.floor((i - RACK_MAP0) / 8)] = NaN; }
  setTempo(b) { this.bpm = b; for (const c of this.ch) for (const d of c.dev) if (d.setTempo) d.setTempo(b); }
  tr(playing, beat) { for (const c of this.ch) for (const d of c.dev) if (d.tr) d.tr(playing, beat); }
  // op 0 reset | 1 insert device type a at chain c index j | 2 parameter a = b | 3 bypass a | 4 remove
  cmd(op, c, j, a, b, eng) {
    if (op === 0) { for (const x of this.ch) x.dev.length = 0; this.last.fill(NaN); return; }
    const ch = this.ch[c]; if (!ch) return;
    if (op === 1) { const d = eng.mk(a); if (d) ch.dev.splice(clamp(j, 0, ch.dev.length), 0, d); this.last.fill(NaN); return; }
    if (op === 4) { if (j >= 0 && j < ch.dev.length) ch.dev.splice(j, 1); this.last.fill(NaN); return; }
    const d = ch.dev[j]; if (!d) return;
    if (op === 2) d.setParam(a, b); else if (op === 3) d.bypass = !!a;
  }
  macros() {
    const p = this.p;
    for (let m = 0; m < RACK_MACROS; m++) {
      const o = RACK_MAP0 + m * 8, c = Math.round(p[o]); if (c < 0) continue;
      const j = Math.round(p[o + 1]), d = this.ch[c] && (j < 0 ? this.ch[c].inst : this.ch[c].dev[j]); if (!d) continue;   // -1 = the chain's instrument (Instrument Rack)
      const lo = p[o + 3], hi = p[o + 4], log = p[o + 5] > 0.5 && lo > 0 && hi > 0, n = clamp(p[o + 6] + (p[o + 7] - p[o + 6]) * p[33 + m], 0, 1);
      const v = log ? lo * Math.pow(hi / lo, n) : lo + n * (hi - lo);
      if (v !== this.last[m]) { this.last[m] = v; d.setParam(Math.round(p[o + 2]), v); }
    }
  }
  process(L, R, n) {
    this.macros();
    const p = this.p, cnt = clamp(Math.round(p[32]), 0, RACK_CHAINS); if (!cnt) return;   // a rack without chains passes the audio
    let solo = false; for (let c = 0; c < cnt; c++) if (p[c * 4 + 3] > 0.5 && p[c * 4 + 2] > 0.5) solo = true;   // a soloed chain mutes the others
    const sL = this.sL, sR = this.sR, bl = this.L, br = this.R, M = this.lat(); sL.fill(0, 0, n); sR.fill(0, 0, n);
    for (let c = 0; c < cnt; c++) {
      const o = c * 4, sel = p[105]; if (p[o + 2] < 0.5 || (solo && p[o + 3] < 0.5) || sel < p[106 + c * 2] || sel > p[107 + c * 2]) { this.pk[c] *= 0.9; this.ch[c].pdl.clear(); continue; }
      bl.set(L.subarray(0, n)); br.set(R.subarray(0, n));
      for (const d of this.ch[c].dev) if (!d.bypass) d.process(bl, br, n);
      this.align(c, bl, br, n, M);
      const g = p[o] <= -60 ? 0 : Math.pow(10, p[o] / 20), pan = p[o + 1], gl = g * Math.min(1, 1 - pan), gr = g * Math.min(1, 1 + pan); let pk = 0;
      for (let i = 0; i < n; i++) { const l = bl[i] * gl, r = br[i] * gr; sL[i] += l; sR[i] += r; const a = Math.max(Math.abs(l), Math.abs(r)); if (a > pk) pk = a; }
      this.pk[c] = Math.max(pk, this.pk[c] * 0.95);
    }
    L.set(sL.subarray(0, n)); R.set(sR.subarray(0, n));
  }
  readOut(o) { for (let c = 0; c < RACK_CHAINS; c++) o[c] = this.pk[c]; return RACK_CHAINS; }
  sub(c, j) { return this.ch[c] && this.ch[c].dev[j]; }
}

// ================================================================================================ Instrument Rack
// An instrument (track.inst type 12): each chain = an instrument + effects. Notes go to the chains whose key zone (122 + 2c), velocity zone
// (138 + 2c) and chain select zone contain them; a note-off goes to the chains that got the note-on. Chain instruments render sample-accurately
// into the chain buffers (render), the chain effects and the mix run once per block (endBlock, called by core.js after the last render).
// Commands as the Audio Effect Rack, plus op 5 = chain c instrument type a (0 = none), op 6 = chain instrument parameter a = b.
export class InstrumentRack extends AudioEffectRack {
  constructor(sr, mkInst) {
    super(sr); this.mkInst = mkInst; this.pitchNative = false; this.irack = true;
    for (let c = 0; c < RACK_CHAINS; c++) this.p[122 + c * 2] = 0, this.p[123 + c * 2] = 127, this.p[138 + c * 2] = 1, this.p[139 + c * 2] = 127;
    for (const c of this.ch) { c.inst = null; c.L = new Float32Array(128); c.R = new Float32Array(128); }
    this.held = new Map();
  }
  cmd(op, c, j, a, b, eng) {
    if (op === 0) { for (const x of this.ch) { if (x.inst) x.inst.allOff(); x.inst = null; } this.held.clear(); }
    const ch = this.ch[c];
    if (op === 5) { if (ch) { ch.inst = a > 0 ? this.mkInst(a) : null; if (ch.inst && ch.inst.setTempo) ch.inst.setTempo(this.bpm); this.last.fill(NaN); } return; }
    if (op === 6) { if (ch && ch.inst) ch.inst.setParam(a, b); return; }
    super.cmd(op, c, j, a, b, eng);
  }
  setParam(i, v) { if (i >= 100) super.setParam(i - 100, v); }   // instrument parameter 100 + k = rack parameter k (90 is the engine's Pitch)
  setTempo(b) { super.setTempo(b); for (const c of this.ch) if (c.inst && c.inst.setTempo) c.inst.setTempo(b); }
  plays(c, p, v) {
    const q = this.p, vel = Math.max(1, Math.min(127, Math.round(v * 127))), sel = q[105];
    return q[c * 4 + 2] > 0.5 && p >= q[122 + c * 2] && p <= q[123 + c * 2] && vel >= q[138 + c * 2] && vel <= q[139 + c * 2] && sel >= q[106 + c * 2] && sel <= q[107 + c * 2];
  }
  noteOn(p, v) {
    const cnt = clamp(Math.round(this.p[32]), 0, RACK_CHAINS); let mask = 0;
    for (let c = 0; c < cnt; c++) if (this.ch[c].inst && this.plays(c, p, v)) { this.ch[c].inst.noteOn(p, v); mask |= 1 << c; }
    this.held.set(p, (this.held.get(p) || 0) | mask);
  }
  noteOff(p) { const mask = this.held.get(p) || 0; for (let c = 0; c < RACK_CHAINS; c++) if (mask & (1 << c) && this.ch[c].inst) this.ch[c].inst.noteOff(p); this.held.delete(p); }
  allOff() { for (const c of this.ch) if (c.inst) c.inst.allOff(); this.held.clear(); }
  active() { for (const c of this.ch) if (c.inst && c.inst.active()) return true; return false; }
  render(L, R, from, to) { const cnt = clamp(Math.round(this.p[32]), 0, RACK_CHAINS); for (let c = 0; c < cnt; c++) { const x = this.ch[c]; if (x.inst) x.inst.render(x.L, x.R, from, to); } }
  endBlock(L, R, n) {
    this.macros();
    const p = this.p, cnt = clamp(Math.round(p[32]), 0, RACK_CHAINS), M = this.lat();
    let solo = false; for (let c = 0; c < cnt; c++) if (p[c * 4 + 3] > 0.5 && p[c * 4 + 2] > 0.5) solo = true;
    for (let c = 0; c < cnt; c++) {
      const x = this.ch[c], o = c * 4, bl = x.L, br = x.R;
      if (p[o + 2] > 0.5 && !(solo && p[o + 3] < 0.5)) {
        for (const d of x.dev) if (!d.bypass) d.process(bl, br, n);
        this.align(c, bl, br, n, M);
        const g = p[o] <= -60 ? 0 : Math.pow(10, p[o] / 20), pan = p[o + 1], gl = g * Math.min(1, 1 - pan), gr = g * Math.min(1, 1 + pan); let pk = 0;
        for (let i = 0; i < n; i++) { const l = bl[i] * gl, r = br[i] * gr; L[i] += l; R[i] += r; const a = Math.max(Math.abs(l), Math.abs(r)); if (a > pk) pk = a; }
        this.pk[c] = Math.max(pk, this.pk[c] * 0.95);
      } else { this.pk[c] *= 0.9; x.pdl.clear(); }
      bl.fill(0, 0, n); br.fill(0, 0, n);
    }
  }
  process() {}
}
