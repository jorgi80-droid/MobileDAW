// The audio engine of the web version. Plain JS with preallocated typed arrays: the same class runs inside the
// AudioWorklet (realtime), in the main thread (WAV export) and in node (tests). No allocation while rendering.
import { TWO_PI, clamp, BLOCK, JOBS, pumpJobs } from './dsp.js';
import { makeInstrument } from './instruments.js';
import { makeDevice } from './fx.js';
import { TempoMap } from './tmap.js';
import { MeterMap } from './meter.js';

export const PPQ = 960, MAX_TRACKS = 64, MASTER = 64, RET0 = 65, NFX = 8, NSTRIPS = RET0 + NFX, MAX_DEV = 16;   // strips: 0-63 tracks, 64 master, 65-72 effect tracks (65/66 = Return A/B)
const TAIL_SECONDS = 2;

function newStrip() {
  return {
    inst: null, ev: null, clips: [], dev: [], vol: 0.85, pan: 0, gl: 0, gr: 0, send: [0, 0], out: -1, mute: false, solo: false,
    silent: 0, wasAudible: true, pitch: 0, bend: 0, ccl: null, ccG: 1, ccP: 0, tpMap: Uint8Array.from({ length: 128 }, (_, i) => i), active: false, pre: [], bufL: new Float32Array(BLOCK), bufR: new Float32Array(BLOCK), peakL: 0, peakR: 0,
    sevT: new Int32Array(512), sevP: new Uint8Array(512), sevV: new Float32Array(512), sevOn: new Uint8Array(512), sevPn: new Float32Array(512), nPan: 0,
  };
}

export class Engine {
  constructor(sr = 48000) {
    this.sr = sr; this.bank = new Array(256).fill(null); this.sfs = new Array(8).fill(null);
    this.sc = new Float32Array(NSTRIPS);
    this.s = Array.from({ length: NSTRIPS }, newStrip);
    this.s[MASTER].vol = 1;
    this.playing = false; this.catchUp = false; this.pos = 0; this.bpm = 120; this.loopOn = false; this.loopS = 0; this.loopE = PPQ * 4;
    this.tm = new TempoMap(); this.tmOn = false; this.curBpm = 120; this.beatT = PPQ; this.barBeats = 4; this.mm = new MeterMap(); this.cinN = 4;
    this.metro = false; this.metroVol = 1; this.clickIdx = 1e9; this.clickOff = 0; this.clickF = 1000;
    this.cin = 0; this.cinBf = 0; this.cinNext = 0; this.cinPos = 0; this.cinBeat = 0;   // count-in: frames left, frames per beat, next click frame, position, beat counter
    this.mixL = new Float32Array(BLOCK); this.mixR = new Float32Array(BLOCK); this.zL = new Float32Array(BLOCK); this.zR = new Float32Array(BLOCK); this.scrL = new Float32Array(BLOCK); this.scrR = new Float32Array(BLOCK); this.noDirect = false;   // noDirect: ekspor stem Return (track hanya mengisi send/grup, tidak langsung ke master)
    this.retL = Array.from({ length: NFX }, () => new Float32Array(BLOCK)); this.retR = Array.from({ length: NFX }, () => new Float32Array(BLOCK)); this.retActive = new Array(NFX).fill(false);
    this.lanes = []; this.tailFrames = TAIL_SECONDS * sr; this.onError = null;
    this.tl = false; this.tlc = new Float64Array(MAX_TRACKS); this.tlp = new Float64Array(MAX_TRACKS);   // per-track load read-out (only measured while the mixer is open): ms spent in the window, smoothed share of the block budget
    for (let k = 0; k < NFX; k++) this.s[RET0 + k].vol = 0.85;
  }

  // ---------------------------------------------------------------- commands (called between render calls)
  play() { this.playing = true; this.catchUp = true; }
  stop() { this.playing = false; this.cin = 0; this.panic(); for (let t = 0; t < MAX_TRACKS; t++) if (this.s[t].ccl) this.ccReset(this.s[t], t); }
  // count-in: `beats` clicks (accent on the first beat of each bar) while the song waits at its position, then playback starts. Works whether or not the metronome is on.
  playCountIn(beats) {
    const b = Math.max(0, beats | 0), tk = this.f2t(this.pos), bt = this.mm.beatLenAt(tk), bf = Math.max(1, this.t2f(tk + bt) - this.t2f(tk));
    this.cinN = this.mm.nAt(tk);                 // clicks are accented per bar of the signature that is active where the song starts
    this.cin = b * bf; this.cinBf = bf; this.cinNext = 0; this.cinPos = 0; this.cinBeat = 0; this.clickIdx = 1e9;
    this.playing = true; this.catchUp = true;
  }
  cinChunk(n) {
    const mL = this.mixL, mR = this.mixR, len = Math.floor(0.015 * this.sr);
    mL.fill(0, 0, n); mR.fill(0, 0, n);
    for (let i = 0; i < n; i++) {
      if (this.cinPos + i >= this.cinNext) { this.clickIdx = 0; this.clickF = this.cinBeat % this.cinN === 0 ? 1500 : 1000; this.cinBeat++; this.cinNext += this.cinBf; }
      if (this.clickIdx < len) { const y = Math.sin(TWO_PI * this.clickF * this.clickIdx / this.sr) * 0.35 * this.metroVol * (1 - this.clickIdx / len); mL[i] += y; mR[i] += y; this.clickIdx++; }
    }
    this.cinPos += n;
  }
  seek(tick) { this.pos = Math.round(this.t2f(Math.max(0, tick)));   // must be a whole frame: a fractional position makes every buffer write (L[k - pos]) a no-op, i.e. silence when starting mid-song
    this.cin = 0; this.catchUp = true; this.panic(); for (const l of this.lanes) l.last = NaN; }
  tempo(b) { const tick = this.f2t(this.pos); this.bpm = clamp(b, 20, 300); this.pos = Math.round(this.t2f(tick)); if (!this.tmOn) this.devTempo(this.bpm); }
  devTempo(b) { this.curBpm = b; for (let t = 0; t < MAX_TRACKS; t++) { if (this.s[t].inst) this.s[t].inst.setTempo(b); for (const d of (this.s[t].dev || [])) if (d.setTempo) d.setTempo(b); } }
  // tempo automation: flat = [tick, bpm, ...]. on=false or fewer than 1 point -> constant tempo (this.bpm) and the engine behaves exactly as before.
  tempoMap(on, flat) { const tick = this.f2t(this.pos); this.tm.set(flat || []); this.tmOn = !!on && this.tm.n > 0; this.pos = Math.round(this.t2f(tick)); this.devTempo(this.tmOn ? this.tm.bpmAt(tick) : this.bpm); this.catchUp = true; }
  // metronome grid: ticks per beat and beats per bar (time signature)
  setSig(beatT, beats) { this.beatT = Math.max(120, beatT | 0); this.barBeats = Math.max(1, beats | 0); this.mm.set([0, this.barBeats, Math.round(4 * PPQ / this.beatT)]); }
  // time signature changes along the song: flat = [startBar, n, d, ...] (see meter.js). A single entry behaves exactly like setSig.
  setMeter(flat) { this.mm.set(flat); this.beatT = this.mm.bt[0]; this.barBeats = this.mm.n[0]; }
  t2f(tk) { return this.tmOn ? this.tm.tickToSec(tk) * this.sr : tk * this.sr * 60 / (this.bpm * PPQ); }
  f2t(f) { return this.tmOn ? this.tm.secToTick(f / this.sr) : f * this.bpm * PPQ / (this.sr * 60); }
  loop(on, s, e) { this.loopOn = !!on; this.loopS = s; this.loopE = e; }
  setMetro(on) { this.metro = !!on; }
  setMetroVol(v) { this.metroVol = Math.max(0, Math.min(2, +v || 0)); }   // click level (1 = original loudness); also scales the count-in clicks
  trackLoad(on) { this.tl = !!on; this.tlc.fill(0); this.tlp.fill(0); }
  // called by the worklet every ~0.5 s with the window length in ms: Date.now() has 1 ms steps, so the per-track sum is a statistical estimate (unbiased, smoothed over a few seconds)
  tlTick(winMs) { for (let t = 0; t < MAX_TRACKS; t++) { this.tlp[t] += (this.tlc[t] / winMs - this.tlp[t]) * 0.4; this.tlc[t] = 0; } }
  // out = Int32Array(2 * MAX_TRACKS): voices sounding and share of the block budget in per mille
  fillLoad(out) {
    for (let t = 0; t < MAX_TRACKS; t++) {
      const i = this.s[t].inst; let n = 0;
      if (i && i.v) for (let k = 0; k < i.v.length; k++) if (i.v[k].on) n++;
      out[t * 2] = n; out[t * 2 + 1] = Math.round(this.tlp[t] * 1000);
    }
  }
  trackVol(t, v) { if (this.ok(t)) this.s[t].vol = Math.max(0, v); }
  trackPan(t, v) { if (this.ok(t)) this.s[t].pan = clamp(v, -1, 1); }
  trackMute(t, m) { if (this.ok(t)) this.s[t].mute = !!m; }
  trackSolo(t, m) { if (this.ok(t)) this.s[t].solo = !!m; }
  trackSend(t, k, v) { if (this.ok(t) && t < MASTER && (k === 0 || k === 1)) this.s[t].send[k] = clamp(v, 0, 1.5); }
  // where a track's main output goes: -1 = master, 0..NFX-1 = that effect track (group routing; the effect track's own output always goes to the master)
  trackOut(t, k) { if (this.ok(t) && t < MASTER) this.s[t].out = (k >= 0 && k < NFX) ? k | 0 : -1; }
  trackInst(t, type) {
    if (!this.ok(t) || t >= MASTER) return;
    const inst = makeInstrument(type, this.sr, this.bank, this.sfs);
    this.s[t].inst = inst;
    if (inst) { inst.setTempo(this.bpm); if (inst.pitchNative) inst.setParam(90, this.s[t].pitch); }
  }
  // Instrument pitch (-24..+24 semitones) is param 90 of every instrument: instruments with pitchNative (drums, samplers) shift themselves, the rest get transposed notes
  setPitch(t, v) { if (!this.ok(t) || t >= MASTER) return; const st = this.s[t]; st.pitch = clamp(Math.round(v) || 0, -24, 24); if (st.inst && st.inst.pitchNative) st.inst.setParam(90, st.pitch); }
  instParam(t, i, v) { if (i === 90) { this.setPitch(t, v); return; } if (this.ok(t) && this.s[t].inst) this.s[t].inst.setParam(i, v); }
  resetTrack(t) { if (!this.ok(t)) return; const o = newStrip(); o.vol = t === MASTER ? 1 : 0.85; this.s[t] = o; this.midiScan(); }
  insertDevice(t, index, type) {
    if (!this.ok(t)) return;
    const st = this.s[t], d = makeDevice(type, this.sr, this.sc);
    if (!d || st.dev.length >= MAX_DEV) return;
    if (d.setTempo) d.setTempo(this.bpm);
    st.dev.splice(clamp(index, 0, st.dev.length), 0, d); this.midiScan();
  }
  removeDevice(t, i) { if (this.ok(t) && i >= 0 && i < this.s[t].dev.length) { this.s[t].dev.splice(i, 1); this.midiScan(); } }
  // effects that listen to notes (Spectral Resonator in MIDI mode): d.midiFrom() = -1 off, 0 = own track, k = track k - 1
  midiScan() { this.midiFx = false; if (!this.s) return; for (let t = 0; t < NSTRIPS; t++) for (const d of ((this.s[t] && this.s[t].dev) || [])) if (d.midiIn) this.midiFx = true; }
  midiTo(src, p, v) {
    for (let t = 0; t < NSTRIPS; t++) for (const d of this.s[t].dev) {
      if (!d.midiIn) continue; const f = d.midiFrom();
      if ((f === 0 && t === src) || f - 1 === src) { if (v > 0) d.noteOn(p, v); else d.noteOff(p); }
    }
  }
  devParam(t, d, p, v) { if (this.ok(t) && this.s[t].dev[d]) this.s[t].dev[d].setParam(p, v); }
  devBypass(t, d, b) { if (this.ok(t) && this.s[t].dev[d]) this.s[t].dev[d].bypass = !!b; }
  // Pitch bend (semitones, +-12 max, the UI wheel uses +-2): scales the frequency of the sounding voices and of the notes that start afterwards
  bend(t, st) {
    if (!this.ok(t) || t >= MASTER) return; const s = this.s[t]; st = clamp(+st || 0, -12, 12);
    const r = Math.pow(2, (st - s.bend) / 12); s.bend = st;
    if (s.inst && s.inst.bendVoice && r !== 1) for (const v of s.inst.v) if (v.on) s.inst.bendVoice(v, r);
  }
  bendNew(s) { const n = s.inst.counter, r = Math.pow(2, s.bend / 12); for (const v of s.inst.v) if (v.on && v.age === n) s.inst.bendVoice(v, r); }
  preview(t, pitch, vel, on) { if (this.ok(t) && t < MASTER && this.s[t].inst && this.s[t].pre.length < 64) this.s[t].pre.push({ p: pitch | 0, v: vel, on: !!on }); }
  // flat = [start tick, length ticks, pitch, velocity, pan] * n   (pan -1..1; stride 4 is accepted for old callers)
  trackNotes(t, flat, n, stride = 5) {
    if (!this.ok(t) || t >= MASTER) return;
    const ev = [];
    for (let i = 0; i < n; i++) { const b = i * stride, st = flat[b], ln = flat[b + 1], pn = stride > 4 ? flat[b + 4] || 0 : 0; ev.push([st, 1, flat[b + 2], flat[b + 3], pn]); ev.push([st + Math.max(ln, 1), 0, flat[b + 2], 0, 0]); }
    const nl = []; for (let i = 0; i < n; i++) { const b = i * stride; nl.push([flat[b], flat[b] + Math.max(flat[b + 1], 1), flat[b + 2], flat[b + 3], stride > 4 ? flat[b + 4] || 0 : 0]); }
    this.s[t].notes = nl;   // used to start notes that are already sounding when playback begins mid-note
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);   // note-offs sort before note-ons at the same tick
    const m = ev.length, o = { n: m, tick: new Float64Array(m), p: new Uint8Array(m), v: new Float32Array(m), on: new Uint8Array(m), pan: new Float32Array(m) };
    for (let i = 0; i < m; i++) { o.tick[i] = ev[i][0]; o.on[i] = ev[i][1]; o.p[i] = ev[i][2]; o.v[i] = ev[i][3]; o.pan[i] = ev[i][4]; }
    this.s[t].ev = m ? o : null;
  }
  // MIDI controller lanes of a track: flat = [tick, kind, value] * n. kind 0 = pitch bend (-1..1 = +-2 semitones), 1 = volume (CC7, 0..127), 2 = pan (CC10), 3 = expression (CC11).
  // Evaluated once per block (linear between points). n = 0 removes the lanes.
  trackCC(t, flat, n) {
    if (!this.ok(t) || t >= MASTER) return;
    const s = this.s[t], by = [[], [], [], []];
    for (let i = 0; i < n; i++) { const k = flat[i * 3 + 1] | 0; if (k >= 0 && k < 4) by[k].push([flat[i * 3], flat[i * 3 + 2]]); }
    const ccl = by.map((a) => { if (!a.length) return null; a.sort((x, y) => x[0] - y[0]); return { t: Float64Array.from(a, (q) => q[0]), v: Float64Array.from(a, (q) => q[1]) }; });
    s.ccl = ccl.some(Boolean) ? ccl : null;
    if (!s.ccl) this.ccReset(s, t);
  }
  ccReset(s, t) { s.ccG = 1; s.ccP = 0; if (s.bend) this.bend(t, 0); }
  ccAt(l, tick) {
    const n = l.t.length; if (tick <= l.t[0]) return l.v[0]; if (tick >= l.t[n - 1]) return l.v[n - 1];
    let a = 0, b = n - 1; while (b - a > 1) { const m = (a + b) >> 1; if (l.t[m] <= tick) a = m; else b = m; }
    const d = l.t[b] - l.t[a]; return d <= 0 ? l.v[b] : l.v[a] + (l.v[b] - l.v[a]) * (tick - l.t[a]) / d;
  }
  applyCC(s, idx, tick) {
    const c = s.ccl;
    if (c[0]) { const st = clamp(this.ccAt(c[0], tick), -1, 1) * 2; if (Math.abs(st - s.bend) > 1e-4) this.bend(idx, st); }
    let g = 1; if (c[1]) g *= clamp(this.ccAt(c[1], tick) / 127, 0, 1); if (c[3]) g *= clamp(this.ccAt(c[3], tick) / 127, 0, 1);
    s.ccG = g; s.ccP = c[2] ? clamp((this.ccAt(c[2], tick) - 64) / 63, -1, 1) : 0;
  }
  // flat = [start tick, length ticks, sample id, gain, offset seconds, fade in seconds, fade out seconds] * n
  trackClips(t, flat, n, stride = 7) {
    if (!this.ok(t) || t >= MASTER) return;
    const c = [];
    for (let i = 0; i < n; i++) c.push({ start: flat[i * stride], len: flat[i * stride + 1], sample: flat[i * stride + 2] | 0, gain: flat[i * stride + 3], offset: stride > 4 ? flat[i * stride + 4] : 0, fadeIn: stride > 5 ? flat[i * stride + 5] : 0, fadeOut: stride > 6 ? flat[i * stride + 6] : 0 });
    c.sort((a, b) => a.start - b.start);
    this.s[t].clips = c;
  }
  // flat = per lane [kind, track, dev, param, npoints, (tick, value) * npoints]
  automation(flat, count = flat.length) {
    const lanes = [];
    for (let i = 0; i + 5 <= count;) {
      const l = { kind: flat[i] | 0, track: flat[i + 1] | 0, dev: flat[i + 2] | 0, param: flat[i + 3] | 0, pts: [], last: NaN };
      const n = flat[i + 4] | 0; i += 5;
      for (let k = 0; k < n && i + 2 <= count; k++, i += 2) l.pts.push([flat[i], flat[i + 1]]);
      l.pts.sort((a, b) => a[0] - b[0]);
      if (l.pts.length) lanes.push(l);
    }
    this.lanes = lanes;
  }
  loadSample(id, l, r) { if (id >= 0 && id < this.bank.length) this.bank[id] = { l, r: r || l, frames: l.length, rate: this.sr }; }
  loadSoundFont(id, sf) { if (id >= 0 && id < this.sfs.length) this.sfs[id] = sf; }

  ok(t) { return t >= 0 && t < NSTRIPS; }
  err(e) { if (this.onError) this.onError(e); }
  // Run one device; an exception or non-finite output switches that device off instead of killing the whole audio thread.
  runDev(strip, di, d, L, R, n) {
    try { d.process(L, R, n); } catch (e) { d.bypass = true; this.err({ kind: 'dev', strip, dev: di, msg: e && e.message }); return; }
    const x = L[0] + L[n - 1] + R[n - 1];
    if (!(x > -1e6 && x < 1e6)) { d.bypass = true; L.fill(0, 0, n); R.fill(0, 0, n); this.err({ kind: 'dev', strip, dev: di, msg: 'nilai tidak valid (NaN/tak hingga)' }); }
  }
  runChain(s, strip, L, R, n) { const dv = s.dev; for (let i = 0; i < dv.length; i++) if (!dv[i].bypass) { if (dv[i].tr) dv[i].tr(this.playing, this.f2t(this.pos) / PPQ); this.runDev(strip, i, dv[i], L, R, n); if (dv[i].mod) this.applyMod(dv[i]); } }   // tr: bar-synced effects (Beat Repeat, Auto Pan) read the song position
  // modulators (LFO / Shaper / Envelope Follower, fx6.js) write their mapped value into the target device (or instrument when d = -1)
  applyMod(m) {
    const t = m.target(); if (!t || t.s < 0 || t.s >= NSTRIPS) return;
    const st = this.s[t.s]; if (t.d < 0) { if (st.inst && t.v !== m.last) { st.inst.setParam(t.k, t.v); m.last = t.v; } return; }
    const d = st.dev[t.d]; if (d && d !== m && t.v !== m.last) { d.setParam(t.k, t.v); m.last = t.v; }
  }
  // a silent strip skips its chain, but its modulators keep running (with silence as input)
  runMods(s, n) { for (const d of s.dev) if (d.mod && !d.bypass) { this.zL.fill(0, 0, n); this.zR.fill(0, 0, n); d.process(this.zL, this.zR, n); this.applyMod(d); } }
  spt() { return this.sr * 60 / (this.bpm * PPQ); }
  balance(L, R, a, b, pan) { if (!pan) return; const gl = pan > 0 ? 1 - pan : 1, gr = pan < 0 ? 1 + pan : 1; for (let k = a; k < b; k++) { L[k] *= gl; R[k] *= gr; } }
  panic() { for (let t = 0; t < MAX_TRACKS; t++) this.s[t].nPan = 0; for (let t = 0; t < MAX_TRACKS; t++) if (this.s[t].inst) this.s[t].inst.allOff(); }

  // ---------------------------------------------------------------- readouts
  devOut(t, d, out) { return this.ok(t) && this.s[t].dev[d] ? this.s[t].dev[d].readOut(out) : 0; }
  // m = Int32Array(2 * NSTRIPS) of peaks * 1000
  fillMeters(m) { for (let i = 0; i < NSTRIPS; i++) { m[i * 2] = Math.round(this.s[i].peakL * 1000); m[i * 2 + 1] = Math.round(this.s[i].peakR * 1000); } }
  tickPos() { return this.f2t(this.pos); }

  // ---------------------------------------------------------------- rendering
  render(oL, oR, frames) {
    if (JOBS.q.length) pumpJobs();   // wavetable building runs in small slices here (worklet only), never in one long block
    let done = 0;
    while (done < frames) {
      let n = Math.min(frames - done, BLOCK);
      if (this.playing && this.cin > 0) {          // count-in: only the click is heard, the song position does not move
        n = Math.min(n, Math.max(1, Math.ceil(this.cin)));
        this.cinChunk(n);
        for (let i = 0; i < n; i++) { const l = this.mixL[i], r = this.mixR[i]; oL[done + i] = l; oR[done + i] = r; }
        this.cin -= n; done += n; continue;
      }
      const spt = this.spt();
      if (this.playing && this.loopOn) {
        const le = Math.ceil(this.t2f(this.loopE)), left = le - this.pos;
        if (left > 0) n = Math.min(n, Math.max(1, Math.ceil(left)));
      }
      this.chunk(n, spt);
      for (let i = 0; i < n; i++) { let l = this.mixL[i], r = this.mixR[i]; if (!(l === l)) l = 0; if (!(r === r)) r = 0; oL[done + i] = l > 1 ? 1 : l < -1 ? -1 : l; oR[done + i] = r > 1 ? 1 : r < -1 ? -1 : r; }
      if (this.playing) {
        if (this.pos % 1) this.pos = Math.round(this.pos);
        const before = this.pos; this.pos += n;
        if (this.loopOn) { const le = Math.ceil(this.t2f(this.loopE)); if (this.pos >= le && before < le) { this.pos = Math.ceil(this.t2f(this.loopS)); this.catchUp = true; this.panic(); } }
      }
      done += n;
    }
  }

  applyAuto(tick) {
    for (const l of this.lanes) {
      const p = l.pts; let v;
      if (tick <= p[0][0]) v = p[0][1]; else if (tick >= p[p.length - 1][0]) v = p[p.length - 1][1];
      else { let k = 1; while (k < p.length && p[k][0] < tick) k++; const a = p[k - 1], b = p[k], sp = b[0] - a[0]; v = sp <= 0 ? b[1] : a[1] + (b[1] - a[1]) * (tick - a[0]) / sp; }
      if (l.last === l.last && Math.abs(v - l.last) < 1e-6) continue;
      l.last = v;
      if (l.track < 0 || l.track >= NSTRIPS) continue;
      const s = this.s[l.track];
      switch (l.kind) {
        case 0: s.vol = Math.max(0, v); break; case 1: s.pan = clamp(v, -1, 1); break;
        case 2: if (l.track < MASTER) s.send[0] = clamp(v, 0, 1.5); break; case 3: if (l.track < MASTER) s.send[1] = clamp(v, 0, 1.5); break;
        case 4: if (s.dev[l.dev]) s.dev[l.dev].setParam(l.param, v); break; case 5: if (l.param === 90) this.setPitch(l.track, v); else if (s.inst) s.inst.setParam(l.param, v); break;
      }
    }
  }

  chunk(n, spt) {
    const pos = this.pos, mL = this.mixL, mR = this.mixR;
    if (this.tmOn && this.playing) { const bn = this.tm.bpmAt(this.f2t(pos)); if (Math.abs(bn - this.curBpm) > 0.02) this.devTempo(bn); }
    if (this.playing && this.lanes.length) this.applyAuto(this.f2t(pos));
    let anySolo = false;
    for (let t = 0; t < MAX_TRACKS; t++) if (this.s[t].solo) { anySolo = true; break; }
    mL.fill(0, 0, n); mR.fill(0, 0, n);
    for (let k = 0; k < NFX; k++) { this.retL[k].fill(0, 0, n); this.retR[k].fill(0, 0, n); this.retActive[k] = false; }
    if (this.tl) { for (let t = 0; t < MAX_TRACKS; t++) { const a = Date.now(); this.track(this.s[t], t, pos, n, spt, anySolo); this.tlc[t] += Date.now() - a; } }
    else for (let t = 0; t < MAX_TRACKS; t++) this.track(this.s[t], t, pos, n, spt, anySolo);
    this.catchUp = false;
    for (let k = 0; k < NFX; k++) this.ret(k, n);
    const m = this.s[MASTER];
    this.runChain(m, MASTER, mL, mR, n);
    let pl = 0, pr = 0;
    for (let i = 0; i < n; i++) {
      m.gl += (m.vol - m.gl) * 0.0021; mL[i] *= m.gl; mR[i] *= m.gl;
      const a = Math.abs(mL[i]), b = Math.abs(mR[i]); if (a > pl) pl = a; if (b > pr) pr = b;
    }
    m.peakL = Math.max(pl, m.peakL * 0.995); m.peakR = Math.max(pr, m.peakR * 0.995);
    if (this.metro && this.playing) this.click(n, pos, spt);
  }

  track(s, idx, pos, n, spt, anySolo) {
    const audible = !s.mute && (!anySolo || s.solo);
    s.active = false;
    if (!audible) {
      if (s.wasAudible) { if (s.inst) s.inst.allOff(); s.wasAudible = false; s.silent = this.tailFrames + 1; }
      this.sc[idx] = 0; s.peakL *= 0.99; s.peakR *= 0.99; s.pre.length = 0; this.runMods(s, n); return;
    }
    s.wasAudible = true;
    if (!s.inst && !s.clips.length) { this.sc[idx] = 0; s.peakL *= 0.99; s.peakR *= 0.99; this.runMods(s, n); return; }
    const L = s.bufL, R = s.bufR;
    L.fill(0, 0, n); R.fill(0, 0, n);
    let active = false;
    if (this.playing && s.ccl) this.applyCC(s, idx, this.f2t(pos));
    if (s.inst) {
      let ne = 0;
      const eo = s.sevT, ep = s.sevP, ev = s.sevV, eon = s.sevOn, epn = s.sevPn;
      for (const q of s.pre) if (ne < 512) { eo[ne] = 0; ep[ne] = q.p; ev[ne] = q.v; eon[ne] = q.on ? 1 : 0; epn[ne] = NaN; ne++; }
      s.pre.length = 0;
      if (this.playing && s.ev) {
        const E = s.ev, lo = this.f2t(pos - 1), hi = this.f2t(pos + n - 1);
        let a = 0, b = E.n;
        while (a < b) { const m = (a + b) >> 1; if (E.tick[m] > lo) b = m; else a = m + 1; }
        if (this.catchUp && s.notes) for (const q of s.notes) {   // play/seek/loop wrap landed inside a note: start it now
          if (ne >= 512) break;
          if (Math.ceil(this.t2f(q[0])) < pos && Math.ceil(this.t2f(q[1])) > pos) { eo[ne] = 0; ep[ne] = q[2]; ev[ne] = q[3]; eon[ne] = 1; epn[ne] = q[4]; ne++; }
        }
        for (let i = a; i < E.n && E.tick[i] <= hi && ne < 512; i++) {
          const sp = Math.ceil(this.t2f(E.tick[i])) - pos;
          if (sp < 0 || sp >= n) continue;
          eo[ne] = sp; ep[ne] = E.p[i]; ev[ne] = E.v[i]; eon[ne] = E.on[i]; epn[ne] = E.on[i] ? E.pan[i] : NaN; ne++;
        }
        for (let i = 1; i < ne; i++) for (let k = i; k > 0 && eo[k] < eo[k - 1]; k--) {   // insertion sort by offset (stable)
          let t = eo[k]; eo[k] = eo[k - 1]; eo[k - 1] = t; t = ep[k]; ep[k] = ep[k - 1]; ep[k - 1] = t; t = ev[k]; ev[k] = ev[k - 1]; ev[k - 1] = t; t = eon[k]; eon[k] = eon[k - 1]; eon[k - 1] = t; t = epn[k]; epn[k] = epn[k - 1]; epn[k - 1] = t;
        }
      }
      const sh = s.inst.pitchNative ? 0 : s.pitch, tm = s.tpMap;
      try {
        let cur = 0;
        for (let i = 0; i < ne; i++) {
          if (eo[i] > cur) { s.inst.render(L, R, cur, eo[i]); this.balance(L, R, cur, eo[i], s.nPan); cur = eo[i]; }
          if (eon[i]) { const q = clamp(ep[i] + sh, 0, 127); tm[ep[i] & 127] = q; s.inst.noteOn(q, ev[i]); if (s.bend && s.inst.bendVoice) this.bendNew(s); if (epn[i] === epn[i]) s.nPan = epn[i]; if (this.midiFx) this.midiTo(idx, q, ev[i]); } else { const q = tm[ep[i] & 127]; tm[ep[i] & 127] = ep[i]; s.inst.noteOff(q); if (this.midiFx) this.midiTo(idx, q, 0); }   // a note's pan applies from its note-on (the latest note decides while several overlap)
        }
        if (cur < n) { s.inst.render(L, R, cur, n); this.balance(L, R, cur, n, s.nPan); }
        if (s.inst.active()) active = true;
        const chk = L[0] + L[n - 1] + R[n - 1];
        if (!(chk > -1e6 && chk < 1e6)) throw new Error('nilai tidak valid');
      } catch (e) { s.inst = null; L.fill(0, 0, n); R.fill(0, 0, n); this.err({ kind: 'inst', strip: idx, msg: e && e.message }); }
    }
    if (this.playing && s.clips.length) {
      for (const c of s.clips) {
        const FI = c.fadeIn > 0 ? Math.max(2, Math.round(c.fadeIn * this.sr)) : 64, FO = c.fadeOut > 0 ? Math.max(2, Math.round(c.fadeOut * this.sr)) : 64;
        const cs = Math.ceil(this.t2f(c.start));
        if (cs >= pos + n) break;
        const ce = Math.ceil(this.t2f(c.start + c.len));
        if (ce <= pos) continue;
        const sm = this.bank[c.sample]; if (!sm) continue;
        const from = Math.max(pos, cs), to = Math.min(pos + n, ce), off = Math.round(c.offset * this.sr);
        const sl = sm.l, sr2 = sm.r, frames = sm.frames;
        for (let k = from; k < to; k++) {
          const idx = off + (k - cs); if (idx >= frames || idx < 0) { if (idx >= frames) break; continue; }
          let g = c.gain; const fi = k - cs, fo = ce - 1 - k;
          if (fi < FI) g *= (fi + 1) / FI; if (fo < FO) g *= (fo + 1) / FO;
          L[k - pos] += sl[idx] * g; R[k - pos] += sr2[idx] * g;
        }
        active = true;
      }
    }
    if (active) s.silent = 0; else s.silent += n;
    if (!active && s.silent > this.tailFrames) { this.sc[idx] = 0; s.peakL *= 0.99; s.peakR *= 0.99; this.runMods(s, n); return; }
    this.runChain(s, idx, L, R, n);
    const pn = s.ccP ? clamp(s.pan + s.ccP, -1, 1) : s.pan, vg = s.vol * s.ccG, a = (pn + 1) * Math.PI * 0.25, tl = vg * Math.cos(a) * 1.41421356, tr = vg * Math.sin(a) * 1.41421356, s0 = s.send[0], s1 = s.send[1];
    if (s0 > 0) this.retActive[0] = true; if (s1 > 0) this.retActive[1] = true;
    const ot = s.out >= 0 && s.out < NFX ? s.out : -1;          // group routing: the track feeds an effect track instead of the master
    if (ot >= 0) this.retActive[ot] = true;
    const mL = ot >= 0 ? this.retL[ot] : (this.noDirect ? this.scrL : this.mixL), mR = ot >= 0 ? this.retR[ot] : (this.noDirect ? this.scrR : this.mixR), r0L = this.retL[0], r0R = this.retR[0], r1L = this.retL[1], r1R = this.retR[1];
    let pl = 0, pr = 0, sc = 0;
    for (let i = 0; i < n; i++) {
      const x = L[i], y = R[i], ax = Math.abs(x), ay = Math.abs(y);
      if (ax > sc) sc = ax; if (ay > sc) sc = ay;
      s.gl += (tl - s.gl) * 0.0021; s.gr += (tr - s.gr) * 0.0021;
      const l = x * s.gl, r = y * s.gr;
      if (Math.abs(l) > pl) pl = Math.abs(l); if (Math.abs(r) > pr) pr = Math.abs(r);
      mL[i] += l; mR[i] += r;
      if (s0 > 0) { r0L[i] += l * s0; r0R[i] += r * s0; }
      if (s1 > 0) { r1L[i] += l * s1; r1R[i] += r * s1; }
    }
    this.sc[idx] = sc; s.active = true;
    s.peakL = Math.max(pl, s.peakL * 0.995); s.peakR = Math.max(pr, s.peakR * 0.995);
  }

  ret(k, n) {
    const s = this.s[RET0 + k], L = this.retL[k], R = this.retR[k];
    if (this.retActive[k]) s.silent = 0; else s.silent += n;
    if (s.silent > this.tailFrames) { s.peakL *= 0.995; s.peakR *= 0.995; this.sc[RET0 + k] = 0; this.runMods(s, n); return; }
    this.runChain(s, RET0 + k, L, R, n);
    const target = s.mute ? 0 : s.vol, a = (s.pan + 1) * Math.PI * 0.25, tl = target * Math.cos(a) * 1.41421356, tr = target * Math.sin(a) * 1.41421356;
    let pl = 0, pr = 0;
    for (let i = 0; i < n; i++) {
      s.gl += (tl - s.gl) * 0.0021; s.gr += (tr - s.gr) * 0.0021;
      const l = L[i] * s.gl, r = R[i] * s.gr;
      if (Math.abs(l) > pl) pl = Math.abs(l); if (Math.abs(r) > pr) pr = Math.abs(r);
      this.mixL[i] += l; this.mixR[i] += r;
    }
    s.peakL = Math.max(pl, s.peakL * 0.995); s.peakR = Math.max(pr, s.peakR * 0.995);
  }

  click(n, pos, spt) {
    const mm = this.mm;
    let t = mm.beatCeil(Math.max(0, this.f2t(pos) - 4));
    for (let q = 0; q < 4; q++) {
      const bs = Math.ceil(this.t2f(t));
      if (bs >= pos + n) break;
      if (bs >= pos) { this.clickIdx = 0; this.clickOff = bs - pos; this.clickF = mm.isDownbeat(t) ? 1500 : 1000; }
      t = mm.nextBeat(t);
    }
    const len = Math.floor(0.015 * this.sr);
    for (let i = this.clickOff; i < n && this.clickIdx < len; i++, this.clickIdx++) {
      const y = Math.sin(TWO_PI * this.clickF * this.clickIdx / this.sr) * 0.35 * this.metroVol * (1 - this.clickIdx / len);
      this.mixL[i] += y; this.mixR[i] += y;
    }
    this.clickOff = 0;
  }
}
