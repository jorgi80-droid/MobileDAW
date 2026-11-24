// MiniSynth (FL Studio Mobile instrument, MobileDAW type 32): a port of the MiniSynth model of Honeydew
// (https://github.com/daijro/honeydew, crates/audio/src/minisynth.rs, GPL-3.0-or-later, by daijro; see THIRD_PARTY_NOTICES.md).
// Honeydew rebuilt FLM's MiniSynth law by law: 5 voices that all read one band-limited base wave (1024 tables x 2048, one per harmonic
// count) through 32-bit phases with a fresh dither per frame - the ten OSC Kinds are sums / differences of that wave at fixed offsets or
// intervals -, a 4-pole ladder run as 4096 Euler sub-steps per frame (collapsed into one 5x5 matrix), one-pole envelopes (attack towards
// 4, clipped at 1), a tempo-locked LFO, glide and drift per 32-frame control block, then Distortion -> Delay -> Phaser -> Chorus.
// MobileDAW keeps the parameters as the knobs FLM shows (0..100, -100..100, menu indices: defs.js INSTRUMENTS[32]); FLM's stored value of
// a knob is x / 100 (js/import/build.js miniFromFlm converts a project's values). Level (43, dB) is MobileDAW's output gain.
// Port rules (the C++ twin native/engine/hdmini.cpp renders the same samples): scalar maths in double, tables and delay lines in float,
// 32-bit phases, sums in the written order.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
import { clamp } from './dsp.js';

export const MS_RATE_BEATS = [0.25, 0.375, 0.5, 0.75, 1, 2, 4, 8, 16, 64, 128, 256];   // LFO Rate / Phaser Speed periods in beats (what the DSP plays)
export const MS_RATES = ['1/4', '3/8', '1/2', '3/4', '1/1', '2/1', '4/1', '8/1', '16/1', '64/1', '128/1', '256/1'];
export const MS_DELAY_TIMES = ['1/4', '2/4', '3/4', '1/1'];
export const MS_DELAY_BEATS = [0.25, 0.5, 0.75, 1];
export const msRateIndex = (x) => Math.min(11, Math.trunc(11 * clamp(x / 100, 0, 1)));   // Phaser Speed knob 0..100 -> index of MS_RATE_BEATS

const VOICES = 5, BLOCK = 32, TLEN = 2048, HARMONICS = 1024, PHASE = 4294967296, TAU = 2 * Math.PI;
const SPREAD = [-0.05, -0.0375, -0.025, -0.0125, 0, 0.0125, 0.025, 0.0375];   // SUPERSAW: 8 oscillators at f (1 + m c)
const FLUSH = 1e-20, OFF = 0, ATTACK = 1, DECAY = 2, RELEASE = 3;

// harmonic h of the base wave (magnitude, phase): Honeydew's closed form of the shipped spectrum
export function msHarmonic(h) { return harmonic(h); }
function harmonic(h) {
  const magnitude = (0.1402 + 0.1398 * Math.exp(-(h - 1) / 2.8832) + 0.0215 * Math.exp(-(h - 1) / 9.4539) + 0.0768 * Math.pow(h / 1024, 2.4706)) / h;
  const phase = -1.57007 + 0.00154 * (h - 1) - 3.09168 * h / (h * h + 14.42413);
  return [magnitude, phase];
}
// the 1024 band-limited single-cycle tables T_H(n) = sum over h = 1..H of M_h cos(phi_h + 2 pi h n / 2048); table H at (H - 1) * 2048
let WT = null;
export function msTables() {
  if (WT) return WT;
  const cos = new Float64Array(TLEN), sin = new Float64Array(TLEN), sum = new Float64Array(TLEN), out = new Float32Array(HARMONICS * TLEN);
  for (let n = 0; n < TLEN; n++) { const t = TAU * n / TLEN; cos[n] = Math.cos(t); sin[n] = Math.sin(t); }
  for (let h = 1; h <= HARMONICS; h++) {
    const hm = harmonic(h), a = hm[0] * Math.cos(hm[1]), b = hm[0] * Math.sin(hm[1]), o = (h - 1) * TLEN;
    for (let n = 0; n < TLEN; n++) { const i = (h * n) % TLEN; sum[n] += a * cos[i] - b * sin[i]; out[o + n] = sum[n]; }
  }
  return (WT = out);
}
// the table a voice reads, from its first oscillator's frequency: all 1024 harmonics up to sr / 2048, else floor(sr / (2 f1)) + 1
const harmonics = (f1, sr) => (f1 <= sr / 2048 ? HARMONICS : clamp(Math.floor(sr / (2 * f1)) + 1, 1, HARMONICS));
// the Modifier interval r = 2^(s / 12 + 0.00625), s = trunc(float(2 m - 1) * 12): one float rounding, as FLM
const interval = (m) => Math.pow(2, Math.trunc(Math.fround(Math.fround(m) * 2 - 1) * 12) / 12 + 0.00625);
const cycles = (x) => Math.trunc(x * PHASE) >>> 0;                             // x cycles as a 32-bit phase, wrapped
const increment = (f, sr) => { const x = Math.trunc(f * PHASE / sr); return x >= PHASE ? PHASE - 1 : x > 0 ? x : 0; };
const envU = (v) => 0.95 * v + 0.05;
const pow4 = (x) => x * x * x * x;
export const msAttackRate = (v) => (v < 0.001 ? 1 : 4e-7 / pow4(envU(v)));     // per sample: e += (4 - e) k until e > 1
export const msDecayRate = (v) => (v < 0.0177 ? 1 : 4e-6 / pow4(envU(v)));     // decay to sustain, and the filter envelope's release
export const msAmpReleaseRate = (v) => 4e-5 / pow4(envU(envU(v)));
export const msGlideRate = (v) => 0.9 * pow4(1 - v) + 0.01;                    // per control block: p += c (key - p)

// one frame of the ladder s1 += g (u - k s4 - s1), s2 += g (s1 - s2), s3 += g (s2 - s3), s4 += g (s3 - s4) run 4096 times with u held:
// the sub-step is linear in [s1, s2, s3, s4, u], so its 4096th power (twelve squarings) is the whole frame; then s1 := s1 / (1 + s1^2)
function ladderSet(L, g, k) {
  const m = L.m, t = L.t;
  m.fill(0); m[0] = 1 - g; m[3] = -g * k; m[4] = g;
  for (let i = 1; i < 4; i++) { for (let j = 0; j < 5; j++) m[i * 5 + j] = g * m[(i - 1) * 5 + j]; m[i * 5 + i] += 1 - g; }
  m[24] = 1;
  for (let s = 0; s < 12; s++) {
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) { let x = 0; for (let q = 0; q < 5; q++) x += m[i * 5 + q] * m[q * 5 + j]; t[i * 5 + j] = x; }
    m.set(t);
  }
}
function ladderTick(L, s, u) {
  const m = L.m, s0 = s[0], s1 = s[1], s2 = s[2], s3 = s[3];
  let a = m[0] * s0 + m[1] * s1 + m[2] * s2 + m[3] * s3 + m[4] * u;
  const b = m[5] * s0 + m[6] * s1 + m[7] * s2 + m[8] * s3 + m[9] * u;
  const c = m[10] * s0 + m[11] * s1 + m[12] * s2 + m[13] * s3 + m[14] * u;
  const d = m[15] * s0 + m[16] * s1 + m[17] * s2 + m[18] * s3 + m[19] * u;
  a /= 1 + a * a;
  s[0] = a; s[1] = b; s[2] = c; s[3] = d;
  return d;
}
// xorshift32, seeded alike in every instance so renders repeat
function rngNext(o) { let x = o.s | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; o.s = x >>> 0; return o.s; }
const rngUniform = (o) => (rngNext(o) >>> 8) * (1 / 8388608) - 1;               // uniform in [-1, 1)
// the Overdrive curve at drive D
const overdrive = (x, D) => (x >= 0 ? 1 - (1 - x) * Math.pow(10, -D * x) : -1 + (1 + x) * Math.pow(10, D * x));

function envTick(e, decay, sustain) {
  e.lv += (e.tg - e.lv) * e.rate;
  if (e.st === ATTACK && e.lv > 1) { e.lv = 1; e.st = DECAY; e.tg = sustain; e.rate = decay; }
  return e.lv;
}
function newVoice() {
  return { busy: false, key: 0, vel: 0, pan: 0.5, started: 0, amp: { lv: 0, tg: 0, rate: 0, st: OFF }, feg: { lv: 0, tg: 0, rate: 0, st: OFF },
    pitch: 0, drift: 0, freq: 0, wave: 0, ph: new Uint32Array(8), inc: new Uint32Array(8), ofs: new Uint32Array(5),
    gL: 0, gR: 0, tL: 0, tR: 0, cutoff: 0, lad: { m: new Float64Array(25), t: new Float64Array(25) }, s: new Float64Array(4), dc: 0 };
}
// a voice that was free starts from scratch, keeping only its drift and its oscillator phases
function clearVoice(v) {
  v.key = 0; v.vel = 0; v.pan = 0.5; v.started = 0; v.pitch = 0; v.freq = 0; v.wave = 0; v.inc.fill(0); v.ofs.fill(0);
  for (const e of [v.amp, v.feg]) { e.lv = 0; e.tg = 0; e.rate = 0; e.st = OFF; }
  v.gL = v.gR = v.tL = v.tR = 0; v.cutoff = 0; v.lad.m.fill(0); v.s.fill(0); v.dc = 0;
}

export class HdMiniSynth {
  constructor(sr) {
    this.sr = sr > 0 && Number.isFinite(sr) ? sr : 44100;
    this.p = new Float64Array(44); this.T = msTables();
    this.v = Array.from({ length: VOICES }, newVoice);
    this.held = new Float64Array(128).fill(-1); this.bend = 0; this.wheel = 0; this.bpm = 120; this.rng = { s: 0x12345678 };
    this.dlen = Math.ceil(this.sr * 1.5) + 2; this.dl = new Float32Array(this.dlen);
    this.chN = Math.max(2, Math.trunc(0.01 * this.sr)); this.chLen = this.chN + 2; this.ch = new Float32Array(this.chLen);
    this.apIn = new Float64Array(12); this.apOut = new Float64Array(12); this.phOut = new Float64Array(2); this.decS = new Float64Array(2);
    this.c = { decA: 1, decF: 1, susA: 1, susF: 1, glide: 1, transpose: 0, kind: 0, mod: 0, interval: 1, noise: 0, lfoPitch: 0, log2cut: 14.3, envAmt: 1, res: 0,
      drive: 0, driveGain: 1, hold: 0, dframes: 1, dfb: 0, dco: 1, dmix: 0, phT: 1e-5, phW: 0, phCos: 1, phFb: 0, phMix: 1e-5, chDepth: 0.04, chR0: 0.2, chR1: 0.25, chMix: 0, gain: 1 };
    // defaults = a fresh FLM MiniSynth (Honeydew PARAMETERS in MobileDAW units) = defs.js INSTRUMENTS[32] defaults
    const D = [0, 0, 0, 0, 100, 0, 0, 0, 0, 100, 1, 100, 0, 0, 2, 0, 0, 0, 0, 0, 100, 1, 7, 0, 0, 0, 0, 0, 0, 50, 100, 50, 2, 0, 25, 50, 50, 0, 11.22, 40, 10, 50, 100, 0];
    D.forEach((x, i) => { this.p[i] = x; });
    this.reset();
  }
  // silences at once, as a new instance: voices, glide memory, held keys, effect tails and phases (parameters, tempo, bend, wheel kept)
  reset() {
    this.rng.s = 0x12345678;
    for (const v of this.v) { v.busy = false; clearVoice(v); v.drift = 0; for (let k = 0; k < 8; k++) v.ph[k] = rngNext(this.rng); }
    this.serial = 0; this.last = -1; this.held.fill(-1); this.blockPos = 0; this.running = false; this.tail = 0; this.dpeak = 0; this.beat = 0;
    this.decN = 0; this.decS.fill(0); this.dl.fill(0); this.dpos = 0; this.dlp = 0; this.ch.fill(0); this.chPos = 0; this.chPh0 = 0.62; this.chPh1 = 0.1;
    this.apIn.fill(0); this.apOut.fill(0); this.phOut.fill(0);
    this.update(); this.phS = this.c.phT;                                       // the phaser sweep starts at its target
  }
  setParam(i, x) {
    if (i < 0 || i >= 44 || !Number.isFinite(x)) return;
    const was = this.p[i]; this.p[i] = x;
    if (i === 28 && (was > 0.5) !== (x > 0.5)) { this.dl.fill(0); this.dlp = 0; }        // the delay's buffer is cleared when its toggle changes
    if (i === 33 && !(was > 0.5) && x > 0.5) { this.chPh0 = 0.62; this.chPh1 = 0.1; }      // the chorus phases restart when it is switched on
  }
  setTempo(b) { if (b > 0 && Number.isFinite(b)) this.bpm = b; }
  setBend(st) { this.bend = Number.isFinite(st) ? st : 0; }                     // FLM's channel Pitch Bend: +-2 semitones (the UI wheel's range)
  setBendSl(st, sl) { this.bend = (Number.isFinite(st) ? st : 0) + (Number.isFinite(sl) ? sl : 0); }
  setSongPos(playing, beat) { if (playing && Number.isFinite(beat)) this.beat = beat; }   // the LFO and the phaser lock to the song position
  setMod(v) { this.wheel = clamp(+v || 0, 0, 1); }
  mode() { return clamp(Math.round(this.p[23]), 0, 2); }                        // 0 POLY, 1 MONO, 2 LEAD
  active() { if (this.running) return true; for (const v of this.v) if (v.busy) return true; return false; }
  tailFrames() { return Math.trunc(0.5 * this.sr); }

  // POLY takes the highest-numbered free voice, else steals the oldest-started; MONO and LEAD use voice 1. LEAD is legato while another
  // key is held and the voice is not released. Every note glides from the previously pressed key.
  noteOn(key, vel) {
    key = clamp(Math.round(key), 0, 127);
    if (!(vel > 0) || !Number.isFinite(vel)) return;
    let others = false; for (let k = 0; k < 128; k++) if (k !== key && this.held[k] >= 0) { others = true; break; }
    this.held[key] = vel;
    const mode = this.mode(), start = mode === 2 && !others ? key : this.last >= 0 ? this.last : key;
    this.last = key;
    let index = 0;
    if (mode === 0) {
      index = -1;
      for (let i = VOICES - 1; i >= 0; i--) if (!this.v[i].busy) { index = i; break; }
      if (index < 0) { index = 0; for (let i = 1; i < VOICES; i++) if (this.v[i].started < this.v[index].started) index = i; }
    }
    this.serial++;
    const p = this.p, attack = msAttackRate(clamp(p[19] / 100, 0, 1)), fattack = msAttackRate(clamp(p[8] / 100, 0, 1)), v = this.v[index];
    if (mode === 2 && others && v.busy && v.amp.st !== RELEASE) { v.key = key; v.vel = vel; return; }
    const wasFree = !v.busy;
    if (wasFree) clearVoice(v);
    v.busy = true; v.key = key; v.vel = vel; v.pan = 0.5; v.started = this.serial; v.pitch = start;
    v.amp.st = ATTACK; v.amp.tg = 4; v.amp.rate = attack;
    v.feg.lv = 0; v.feg.st = ATTACK; v.feg.tg = 4; v.feg.rate = fattack;
    this.update(); this.voiceControl(v);
    this.running = true; this.tail = this.tailFrames();
    if (wasFree) { v.gL = v.tL; v.gR = v.tR; }
  }
  // POLY and MONO release every voice on the key. LEAD, when the key is the sounding one and other keys are held, moves the voice to the
  // highest held key below, else the lowest above, with that key's velocity and no retrigger.
  noteOff(key) {
    key = clamp(Math.round(key), 0, 127);
    this.held[key] = -1;
    const lead = this.v[0];
    if (this.mode() === 2 && lead.busy && lead.key === key && lead.amp.st !== RELEASE) {
      let to = -1;
      for (let k = key - 1; k >= 0; k--) if (this.held[k] >= 0) { to = k; break; }
      if (to < 0) for (let k = key + 1; k < 128; k++) if (this.held[k] >= 0) { to = k; break; }
      if (to >= 0) { lead.key = to; lead.vel = this.held[to]; return; }
    }
    for (const v of this.v) if (v.busy && v.key === key && v.amp.st !== RELEASE) this.release(v);
  }
  release(v) {
    const p = this.p;
    v.amp.st = RELEASE; v.amp.tg = 0; v.amp.rate = msAmpReleaseRate(clamp(p[22] / 100, 0, 1));
    v.feg.st = RELEASE; v.feg.tg = 0; v.feg.rate = msDecayRate(clamp(p[11] / 100, 0, 1));
  }
  allOff() { this.held.fill(-1); for (const v of this.v) if (v.busy && v.amp.st !== RELEASE) this.release(v); }

  // the shared block values, from the parameters as they are now: at each block start, and at a note-on
  update() {
    const p = this.p, c = this.c, N = (i) => clamp(p[i] / 100, 0, 1), I = (i, hi) => clamp(Math.round(p[i]), 0, hi);
    const lb = this.beat / MS_RATE_BEATS[I(14, 11)], phase = lb - Math.floor(lb), shape = I(15, 2);
    const wave = shape === 0 ? Math.sin(TAU * phase) : shape === 1 ? 1 - 2 * phase : phase < 0.5 ? 1 : -1;
    // destinations: LFO Dest FLT / FRQ / OSCMOD, MW Dest FLT / LFO / OSCMOD
    const wheel = N(17) * this.wheel, wd = I(18, 2), ld = I(16, 2);
    const centred = clamp(p[13] / 100, -1, 1), a = centred + (wd === 1 ? wheel : 0), lfo = (centred < 0 ? -a * a : a * a) * wave;
    const modifier = clamp(N(1) + (wd === 2 ? wheel : 0) + (ld === 2 ? lfo : 0), -1, 1), dk = N(26), drive = 20 * dk * dk, dg = 1 - drive / 16, dg2 = dg * dg, dg4 = dg2 * dg2;
    let seconds = 0.25 * (I(32, 3) + 1) * 60 / this.bpm;
    while (seconds > 1.5) seconds /= 2;
    c.decA = msDecayRate(N(20)); c.decF = msDecayRate(N(9)); c.susA = clamp(p[21], 0, 1); c.susF = clamp(p[10], 0, 1);
    c.glide = msGlideRate(N(24)); c.transpose = clamp(Math.round(p[3]), -12, 12);
    c.kind = I(0, 9); c.mod = modifier; c.interval = interval(modifier); c.noise = N(2) * N(2);
    c.lfoPitch = 12 * (ld === 1 ? lfo : 0);
    c.log2cut = 4 + 10.3 * N(4) + 4 * (ld === 0 ? lfo : 0) + 4 * (wd === 0 ? wheel : 0);
    c.envAmt = Math.pow(2, 10 * clamp(p[12] / 100, -1, 1));
    c.res = 4.05 * 0.99 * N(7);
    c.drive = drive; c.driveGain = 0.7 * (dg4 * dg4) + 0.3; c.hold = Math.trunc(64 * N(27) * N(27));
    c.dframes = clamp(Math.trunc(seconds * this.sr), 1, this.dlen - 1); c.dfb = N(29); c.dco = 0.99 * N(30) + 0.01; c.dmix = N(31) * N(31);
    const pb = this.beat / MS_RATE_BEATS[msRateIndex(p[38])];
    c.phT = Math.max(N(41) * N(41), 1e-5); c.phW = N(39) * N(39) * N(39); c.phCos = Math.cos(TAU * (pb - Math.floor(pb))); c.phFb = 0.98 * Math.cbrt(N(40)); c.phMix = Math.max(N(42), 1e-5);
    c.chDepth = 0.36 * N(35) + 0.04; c.chR0 = 4 * N(34) * N(34) + 0.2; c.chR1 = 4 * N(34) * N(34) + 0.25; c.chMix = N(36) * N(36);
    c.gain = Math.pow(10, clamp(p[43], -60, 12) / 20);
  }
  // one voice's block values: P = glided key + Transpose + bend + LFO + 0.08 drift semitones; the oscillator increments and offsets of the
  // OSC Kind; the cutoff (keyboard / velocity tracking, filter envelope, linear in Hz) and the ladder set to it; the gain targets
  voiceControl(v) {
    const c = this.c, p = this.p, sr = this.sr;
    const pitch = v.pitch + c.transpose + this.bend + c.lfoPitch + 0.08 * v.drift, f = 440 * Math.pow(2, (pitch - 69) / 12), kind = c.kind, m = c.mod;
    v.freq = f;
    const inc = v.inc, ofs = v.ofs; inc.fill(0); ofs.fill(0);
    let r0 = 1;
    if (kind === 1 || kind === 3 || kind === 4) inc[1] = increment(f * c.interval, sr);
    else if (kind === 5) { r0 = 1 + m * SPREAD[0]; for (let k = 1; k < 8; k++) inc[k] = increment(f * (1 + m * SPREAD[k]), sr); }
    else if (kind === 8) { r0 = 0.5 - 0.005 * m; inc[1] = increment(f, sr); inc[2] = increment(f * (2 + 0.02 * m), sr); }
    else if (kind === 9) { r0 = 1.5 - 0.015 * m; inc[1] = increment(f, sr); inc[2] = increment(f * (2 + 0.02 * m), sr); }
    inc[0] = increment(f * r0, sr);
    v.wave = (harmonics(f * r0, sr) - 1) * TLEN;
    const f0 = Math.pow(2, c.log2cut + clamp(p[5] / 100, 0, 1) * (pitch / 12 - 4) + 14 * clamp(p[6] / 100, 0, 1) * (v.vel - 0.5) + 0.103 * v.drift);
    v.cutoff = clamp(f0 + (f0 * c.envAmt - f0) * v.feg.lv, 0, 20000);
    ladderSet(v.lad, clamp(v.cutoff * 6.25 / (4096 * sr), 0, 1), c.res);
    if (kind === 0 || kind === 2 || kind === 7) ofs[0] = cycles(1 - Math.abs(m));
    else if (kind === 3) ofs[0] = 2147483648;
    else if (kind === 4) ofs[0] = cycles(0.5625);
    else if (kind === 6) for (let k = 0; k < 5; k++) ofs[k] = cycles((k + 1) * Math.abs(m) / 2);
    const gain = clamp(v.vel, 0, 1), pan = clamp(v.pan, 0, 1);
    v.tL = gain * Math.min(2 - 2 * pan, 1); v.tR = gain * Math.min(2 * pan, 1);
  }
  // the block-rate laws: the shared values, then each sounding voice's subnormal flush, glide, drift and pitch
  controlBlock() {
    let busy = false; for (const v of this.v) if (v.busy) { busy = true; break; }
    this.tail = busy ? this.tailFrames() : Math.max(0, this.tail - BLOCK);
    const echoing = this.p[28] > 0.5 && this.dpeak > 1e-5;
    this.running = busy || this.tail > 0 || echoing;
    this.dpeak = 0;
    this.update();
    for (const v of this.v) {
      if (!v.busy) continue;
      if (Math.abs(v.amp.lv) < FLUSH) v.amp.lv = 0; if (Math.abs(v.feg.lv) < FLUSH) v.feg.lv = 0; if (Math.abs(v.dc) < FLUSH) v.dc = 0;
      for (let k = 0; k < 4; k++) if (Math.abs(v.s[k]) < FLUSH) v.s[k] = 0;
      v.pitch += this.c.glide * (v.key - v.pitch);
      v.drift += 0.01 * (rngUniform(this.rng) - v.drift);
      this.voiceControl(v);
    }
  }
  // n frames of the voice sum and the built-in FX (Distortion -> Delay -> Phaser -> Chorus), added into the output.
  // Per voice: u = ((osc + noise) 0.2 + 0.07) A -> ladder -> x 5 -> DC blocker (one-pole high-pass, 0.005) -> x the smoothed gains
  // (0.005 per sample). In release the gain targets drop to 0 once A < 1e-5; the voice frees when both gains are below 1e-5.
  frames(Lo, Ro, at, n) {
    const c = this.c, T = this.T, rng = this.rng, V = this.v, kind = c.kind, sr = this.sr, p = this.p;
    const distOn = p[25] > 0.5, delayOn = p[28] > 0.5, chorusOn = p[33] > 0.5, phaserOn = p[37] > 0.5;
    const dl = this.dl, dlen = this.dlen, ch = this.ch, chLen = this.chLen, chN = this.chN, apIn = this.apIn, apOut = this.apOut;
    for (let i = 0; i < n; i++) {
      let xl = 0, xr = 0;
      for (let vi = 0; vi < VOICES; vi++) {
        const v = V[vi];
        if (!v.busy) continue;
        const amp = envTick(v.amp, c.decA, c.susA);
        envTick(v.feg, c.decF, c.susF);
        const dither = rngNext(rng) >>> 10, ph = v.ph, w = v.wave, a = ph[0], b = ph[1], d = v.ofs[0];
        let sig;
        switch (kind) {
          case 0: sig = 2 * T[w + ((a + dither) >>> 21)] - T[w + ((a + d + dither) >>> 21)]; break;
          case 1: sig = T[w + ((a + dither) >>> 21)] + T[w + ((b + dither) >>> 21)]; break;
          case 2: sig = T[w + ((a + dither) >>> 21)] - T[w + ((a + d + dither) >>> 21)]; break;
          case 3: sig = T[w + ((a + dither) >>> 21)] - T[w + ((a + d + dither) >>> 21)] + T[w + ((b + dither) >>> 21)]; break;
          case 4: sig = T[w + ((a + dither) >>> 21)] - T[w + ((a + d + dither) >>> 21)] + T[w + ((b + dither) >>> 21)] - T[w + ((b + d + dither) >>> 21)]; break;
          case 5: { let s = 0; for (let k = 0; k < 8; k++) s += T[w + ((ph[k] + dither) >>> 21)]; sig = 0.5 * s; break; }
          case 6: { let s = 0; for (let k = 0; k < 5; k++) s += T[w + ((a + v.ofs[k] + dither) >>> 21)]; sig = 0.5 * (T[w + ((a + dither) >>> 21)] + s); break; }
          case 7: sig = T[w + ((a + dither) >>> 21)] + T[w + ((a + d + dither) >>> 21)]; break;
          default: sig = T[w + ((a + dither) >>> 21)] + T[w + ((b + dither) >>> 21)] + T[w + ((ph[2] + dither) >>> 21)];
        }
        for (let k = 0; k < 8; k++) ph[k] += v.inc[k];
        if (c.noise > 0) sig += rngUniform(rng) * c.noise;
        let y = ladderTick(v.lad, v.s, (sig * 0.2 + 0.07) * amp) * 5;
        y -= v.dc; v.dc += 0.005 * y;
        const released = v.amp.st === RELEASE, quiet = released && amp < 1e-5;
        v.gL += ((quiet ? 0 : v.tL) - v.gL) * 0.005; xl += y * v.gL;
        v.gR += ((quiet ? 0 : v.tR) - v.gR) * 0.005; xr += y * v.gR;
        if (released && v.gL < 1e-5 && v.gR < 1e-5) { v.busy = false; for (let k = 0; k < 8; k++) ph[k] = rngNext(rng); }
      }
      if (distOn) {
        // D = 20 v^2: the Overdrive curve x (0.7 (1 - D / 16)^8 + 0.3); then the Decimator holds every h-th frame, h = trunc(64 v^2)
        xl = overdrive(xl, c.drive) * c.driveGain; xr = overdrive(xr, c.drive) * c.driveGain;
        if (c.hold > 1) { if (this.decN === 0) { this.decS[0] = xl; this.decS[1] = xr; } xl = this.decS[0]; xr = this.decS[1]; this.decN = (this.decN + 1) % c.hold; }
      }
      if (delayOn) {
        // mono in: y = low-pass(fb x buffer out); the buffer takes L + R + y; y x mix is added to both channels
        const out = dl[(this.dpos + dlen - c.dframes) % dlen];
        this.dlp += (c.dfb * out - this.dlp) * c.dco;
        const y = this.dlp;
        dl[this.dpos] = xl + xr + y; this.dpos = (this.dpos + 1) % dlen;
        if (Math.abs(y) > this.dpeak) this.dpeak = Math.abs(y);
        xl += y * c.dmix; xr += y * c.dmix;
      }
      if (phaserOn) {
        // six first-order allpasses per channel, a = (1 - x) / (1 + x), x = (50 + 19950 (s + lfo)) / sr; stage 6 feeds back to the input
        this.phS += (c.phT - this.phS) * 0.001;
        for (let q = 0; q < 2; q++) {
          const lfo = (q === 0 ? 1 + c.phCos : 1 - c.phCos) * c.phW / 2, f = clamp((50 + 19950 * (this.phS + lfo)) / sr, 1e-5, 0.499), ac = (1 - f) / (1 + f), x = q === 0 ? xl : xr;
          let wet = x + c.phFb * this.phOut[q];
          for (let k = q * 6; k < q * 6 + 6; k++) { const o = -ac * wet + apIn[k] + ac * apOut[k]; apIn[k] = wet; apOut[k] = o; wet = o; }
          this.phOut[q] = wet;
          if (q === 0) xl = x + wet * c.phMix; else xr = x + wet * c.phMix;
        }
      }
      if (chorusOn) {
        // mono in (L + R) to a buffer of N frames; m = 0.5 + d sin(2 pi phase) per side. L reads N - m^2 d N frames back (linear
        // interpolation); R crossfades (1 - m) x[n] + m x[n - N + 1]
        ch[this.chPos] = xl + xr;
        const pos = this.chPos, mL = 0.5 + c.chDepth * Math.sin(TAU * this.chPh0), mR = 0.5 + c.chDepth * Math.sin(TAU * this.chPh1);
        const delay = chN * (1 - mL * mL * c.chDepth), back = Math.trunc(delay), x0 = ch[(pos + chLen - back) % chLen], x1 = ch[(pos + chLen - back - 1) % chLen];
        const wetL = x0 + (x1 - x0) * (delay - back), wetR = (1 - mR) * ch[pos] + mR * ch[(pos + chLen - (chN - 1)) % chLen];
        let t = this.chPh0 + c.chR0 / sr; this.chPh0 = t - Math.trunc(t); t = this.chPh1 + c.chR1 / sr; this.chPh1 = t - Math.trunc(t);
        this.chPos = (pos + 1) % chLen;
        xl += wetL * c.chMix; xr += wetR * c.chMix;
      }
      Lo[at + i] += xl * c.gain; Ro[at + i] += xr * c.gain;
    }
  }
  render(Lo, Ro, from, to) {
    const total = to - from, bpf = this.bpm / (60 * this.sr);
    let done = 0;
    while (done < total) {
      if (this.blockPos === 0) this.controlBlock();
      const n = Math.min(BLOCK - this.blockPos, total - done);
      if (this.running) this.frames(Lo, Ro, from + done, n);
      this.blockPos = (this.blockPos + n) % BLOCK; this.beat += n * bpf; done += n;
    }
  }
}
