// SuperSaw (FL Studio Mobile instrument, MobileDAW type 33): a port of the SuperSaw model of Honeydew
// (https://github.com/daijro/honeydew, crates/audio/src/supersaw.rs, GPL-3.0-or-later, by daijro; see THIRD_PARTY_NOTICES.md).
// Honeydew rebuilt FLM's SuperSaw law by law: unison saws from one band-limited wavetable set (1024 tables x 2048), 32-bit phases with a
// fresh dither per frame, Supersync as pairs of shifted saws, a 4-pole ladder run as 4096 forward-Euler sub-steps per frame (collapsed into
// one 4x4 matrix), linear envelopes (the amp envelope squared), an LFO, an arpeggiator and Distortion -> Gain -> Delay.
// Control ticks of 24 frames: LFO, glide, unison set-up, filter coefficients, filter / sync envelopes and the level / pan targets update
// once per tick; oscillators, the ladder, the amp envelope and the gain smoothing run per frame.
// MobileDAW keeps its parameters in the units FLM shows (0..100, -100..100, seconds, Hz, semitones, menu indices: defs.js INSTRUMENTS[33]);
// they are read here in those units, so old projects open unchanged. js/import/build.js ssFromFlm converts FLM's stored values (0..1).
// Port rules (the C++ twin native/engine/hdsaw.cpp renders the same samples): scalar maths in double, wavetable and delay lines in float.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
import { clamp } from './dsp.js';
import { syncBeats } from './flmsyn.js';

export const SS_ARP_RATES = ['1/8', '1/4', '3/8', '1/2', '3/4', '1/1'];            // FLM ARP Rate menu (beats)
export const SS_ARP_BEATS = [0.125, 0.25, 0.375, 0.5, 0.75, 1];
export const SS_ARP_MODES = ['Off', 'Up', 'Down', 'Up/Down', 'Up/Down 2', 'Random'];
export const SS_DELAY_TIMES = ['1/4', '3/8', '1/2', '3/4', '1/1'];                  // FLM Delay Time menu (beats)
export const SS_DELAY_BEATS = [0.25, 0.375, 0.5, 0.75, 1];
export const SS_LFO_BEATS = [0.125, 0.25, 0.75, 0.5, 1, 2, 4, 8, 16, 32];           // FLM LFO Beat menu order (3/4 before 1/2)

const TICK = 24, MAX_VOICES = 8, MAX_UNISON = 12, MAX_PAIRS = 6;
const TABLES = 1024, TLEN = 2048, INDEX_SHIFT = 21, DITHER_SHIFT = 10, INC_FACTOR = 0.99951, PHASE = 4294967296;
const SUBSTEPS_LOG2 = 12, SUBSTEPS = 4096, OMEGA = 6.25, Y1_CLIP = 1e-5;
const GAIN_SMOOTH = 0.01, DELAY_MAX_S = 2;
// modulation targets (LFO Destination menu order, then the two only the mod wheel reaches)
const M_CUT = 0, M_RES = 1, M_FREQ = 2, M_SYNC = 3, M_PW = 4, M_DET = 5, M_LEVEL = 6, M_PAN = 7;
const IDLE = 0, ATTACK = 1, DECAY = 2, RELEASE = 3;

// FLM envelope time law: e = 2^x, six times e <- 2^(e - 1); T(x) = 2^(5e - 5) - 1 seconds (0 .. 31 s)
export function ssEnvTime(x) { let e = Math.pow(2, x); for (let i = 0; i < 6; i++) e = Math.pow(2, e - 1); return Math.pow(2, 5 * e - 5) - 1; }
export const ssLfoHz = (v) => 1 / (30 * Math.pow(1 - clamp(v, 0, 1), 3) + 0.033333);   // FLM LFO Rate 0..1 -> Hz
const RE_ATTACK_MIN = ssEnvTime(0.01);                                         // a retriggered sounding voice attacks for at least 2.7 ms
const sec = (t) => (t > 0.001 ? t : 0);                                        // MobileDAW's shortest time (1 ms) = FLM's 0
const swing = (s, rate) => 1 / (Math.trunc(s * rate) + 1);                     // step per full 0 <-> 1 swing of a segment lasting s seconds
const u32 = (x) => (x >= PHASE ? PHASE - 1 : x > 0 ? Math.floor(x) : 0);       // Rust `as u32` (saturating) of a non-negative value
const cycles = (c) => u32((c - Math.floor(c)) * PHASE);
const increment = (f, sr) => u32(f / sr * INC_FACTOR * PHASE);
const tableOf = (f, sr) => clamp(Math.floor(0.5 * sr / f), 1, TABLES - 1) * TLEN;   // the table with floor((sr/2)/f) + 1 harmonics

// the shared wavetable set: table m holds harmonics 1..m+1 of a falling saw, all scaled by one factor so the global peak is 1
let WT = null;
export function ssTables() {
  if (WT) return WT;
  const sine = new Float64Array(TLEN), sum = new Float64Array(TLEN), set = new Float32Array(TABLES * TLEN);
  for (let n = 0; n < TLEN; n++) sine[n] = Math.sin(2 * Math.PI * n / TLEN);
  let peak = 0;
  for (let m = 0; m < TABLES; m++) {
    const h = m + 1, o = m * TLEN;
    for (let n = 0; n < TLEN; n++) { sum[n] += sine[(h * n) % TLEN] / h; const a = Math.abs(sum[n]); if (a > peak) peak = a; set[o + n] = sum[n]; }
  }
  const scale = Math.fround(1 / peak);
  for (let i = 0; i < set.length; i++) set[i] = set[i] * scale;
  return (WT = set);
}

// xorshift32
const rngNew = (seed) => (0x2545f491 ^ Math.imul(seed + 1, 0x9e3779b9)) >>> 0;
function rngNext(o) { let x = o.s | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; o.s = x >>> 0; return o.s; }
const rngUnit = (o) => (rngNext(o) >>> 8) / 16777216;

function envAdvance(e, attack, decay, sustain, release) {
  if (e.st === ATTACK) { e.lv += attack; if (e.lv >= 1) { e.lv = 1; e.st = DECAY; } }
  else if (e.st === DECAY) e.lv = Math.max(e.lv - decay, sustain);
  else if (e.st === RELEASE) { e.lv -= release; if (e.lv <= 0) { e.lv = 0; e.st = IDLE; } }
  return e.lv;
}
const envHeld = (e) => e.st === ATTACK || e.st === DECAY;

// one frame of the ladder as 4096 forward-Euler sub-steps with the input held: y <- A^4096 y + (sum A^k) g e1 u; twelve squarings build both
function ladderMatrix(L, g, r) {
  const k = 4 * r, P = L.P, Q = L.Q, T = L.T;
  P.fill(0); P[0] = 1 - g; P[3] = -g * k; P[4] = g; P[5] = 1 - g; P[9] = g; P[10] = 1 - g; P[14] = g; P[15] = 1 - g;
  Q[0] = g; Q[1] = 0; Q[2] = 0; Q[3] = 0;
  for (let s = 0; s < SUBSTEPS_LOG2; s++) {
    const q0 = Q[0], q1 = Q[1], q2 = Q[2], q3 = Q[3];
    for (let i = 0; i < 4; i++) Q[i] += P[i * 4] * q0 + P[i * 4 + 1] * q1 + P[i * 4 + 2] * q2 + P[i * 4 + 3] * q3;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) T[i * 4 + j] = P[i * 4] * P[j] + P[i * 4 + 1] * P[4 + j] + P[i * 4 + 2] * P[8 + j] + P[i * 4 + 3] * P[12 + j];
    P.set(T);
  }
}
function ladderRun(L, y, u) {
  const P = L.P, Q = L.Q;
  let a = P[0] * y[0] + P[1] * y[1] + P[2] * y[2] + P[3] * y[3] + Q[0] * u;
  const b = P[4] * y[0] + P[5] * y[1] + P[6] * y[2] + P[7] * y[3] + Q[1] * u;
  const c = P[8] * y[0] + P[9] * y[1] + P[10] * y[2] + P[11] * y[3] + Q[2] * u;
  const d = P[12] * y[0] + P[13] * y[1] + P[14] * y[2] + P[15] * y[3] + Q[3] * u;
  a /= 1 + Y1_CLIP * a * a;
  y[0] = a; y[1] = b; y[2] = c; y[3] = d;
  return d;
}

function lfoShape(shape, ph, rnd) { return shape === 0 ? Math.sin(2 * Math.PI * ph) : shape === 1 ? 1 - ph : shape === 2 ? (ph < 0.5 ? 1 : 0) : rnd; }
function arpPosition(mode, step, len, u) {
  if (mode === 1) return step % len;
  if (mode === 2) return len - 1 - step % len;
  if (mode === 3) { const cyc = Math.max(1, 2 * len - 2), i = step % cyc; return i < len ? i : cyc - i; }
  if (mode === 4) { const i = step % (2 * len); return i < len ? i : 2 * len - 1 - i; }
  return step === 0 ? 0 : Math.round(u * (len - 1));
}

function newVoice(index) {
  return {
    note: 0, vel: 0, pan: 0.5, age: 0, pitch: 0, glide: 0, flip: 1,
    amp: { lv: 0, st: IDLE }, reAttack: false, feg: { lv: 0, st: IDLE }, seg: { lv: 0, st: IDLE },
    lfoPh: 0, lfoFade: 0, lfoRnd: 0,
    ph: new Uint32Array(MAX_UNISON), sph: new Uint32Array(MAX_UNISON),
    sync: false, nu: 1, inc: new Uint32Array(MAX_UNISON), tbl: new Int32Array(MAX_UNISON), sinc: new Uint32Array(MAX_UNISON), stbl: new Int32Array(MAX_UNISON),
    panOn: false, panL: new Float64Array(MAX_UNISON), panR: new Float64Array(MAX_UNISON), pulseOn: false, pulse: 0, subLv: 0,
    pairs: 0, starts: new Uint32Array(MAX_PAIRS), ends: new Uint32Array(MAX_PAIRS),
    lad: { P: new Float64Array(16), Q: new Float64Array(4), T: new Float64Array(16), g: -1, r: -1 }, y0: new Float64Array(4), y1: new Float64Array(4),
    gL: 0, gR: 0, tL: 0, tR: 0, rng: { s: rngNew(index + 1) },
  };
}

export class HdSuperSaw {
  constructor(sr) {
    this.sr = sr > 0 && Number.isFinite(sr) ? sr : 44100;
    this.p = new Float64Array(60); this.T = ssTables();
    this.v = Array.from({ length: MAX_VOICES }, (_, i) => newVoice(i));
    this.serial = 0; this.held = new Float64Array(128).fill(-1); this.heldN = 0; this.last = -1; this.tickPos = 0;
    this.bendSt = 0; this.bpm = 120; this.beat = 0; this.lfoPh = 0; this.rng = { s: rngNew(0) };
    this.arp = { on: false, step: 0, timer: 0 };
    this.dlen = Math.trunc(DELAY_MAX_S * this.sr) + 1; this.dl = [new Float32Array(this.dlen), new Float32Array(this.dlen)]; this.dpos = 0; this.dz = new Float64Array(2);
    this.mixL = new Float64Array(TICK); this.mixR = new Float64Array(TICK); this.tail = 0;
    this.c = { aA: 1, aD: 1, aS: 1, aR: 1, aRe: 1, fA: 1, fD: 1, fS: 1, fR: 1, sA: 1, sD: 1, sS: 1, sR: 1, shape: 0, mode: 0, dest: 0, amount: 0, step: 0, syncPh: 0, fade: 1, tune: 0, drive: 0, dnorm: 1, gain: 1, dframes: 1, fb: 0, mix: 0, dfilt: 1 };
    // defaults = FLM's (Honeydew DEFAULTS in MobileDAW units)
    const D = [0, 0, 0, 100, 0, 0, 20, 0, 50, 0, 0, 100, 0.001, 31, 1, 31, 0, 0, 100, 0, 0, 0, 0.001, 31, 1, 31, 0, 0, ssLfoHz(0), 11, 0, 0.001, 0, 0, 100, 0, 0.001, 31, 1, 0.014, 2, 0, 0, 4, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 3, 40, 50, 0];   // = defs.js INSTRUMENTS[33] defaults (a fresh FLM SuperSaw)
    D.forEach((x, i) => { this.p[i] = x; });
    this.update();
  }
  setParam(i, x) {
    if (i < 0 || i >= 60 || !Number.isFinite(x)) return;
    const monoOn = i === 48 && !(this.p[48] > 0.5) && x > 0.5;
    this.p[i] = x;
    if (monoOn) for (let k = 1; k < MAX_VOICES; k++) { const a = this.v[k].amp; a.lv = 0; a.st = IDLE; }   // Mono on silences the other voices
  }
  setTempo(b) { if (b > 0 && Number.isFinite(b)) this.bpm = b; }
  setBend(st) { this.bendSt = st / 2 * this.p[40]; }                            // the UI wheel sends +-2: scaled by PB Range
  setBendSl(st, sl) { this.bendSt = st / 2 * this.p[40] + sl; }
  setSongPos(playing, beat) { if (playing) this.beat = beat; }
  arpMode() { return clamp(Math.round(this.p[51]), 0, 5); }
  active() { if (this.heldN > 0 || this.tail > 0) return true; for (const v of this.v) if (v.amp.st !== IDLE) return true; return false; }

  // the tick's global state from the parameters, the tempo and the song position
  update() {
    const p = this.p, sr = this.sr, tr = sr / TICK, c = this.c;
    const a = clamp(p[32] / 100, -1, 1), lfoBeats = syncBeats(p[29]), amt = clamp(p[52] / 100, 0, 1);
    c.aA = swing(sec(p[36]), sr); c.aD = swing(sec(p[37]), sr); c.aS = clamp(p[38], 0, 1); c.aR = swing(sec(p[39]), sr);
    c.aRe = swing(Math.max(sec(p[36]), RE_ATTACK_MIN), sr);
    c.fA = swing(sec(p[22]), tr); c.fD = swing(sec(p[23]), tr); c.fS = clamp(p[24], 0, 1); c.fR = swing(sec(p[25]), tr);
    c.sA = swing(sec(p[12]), tr); c.sD = swing(sec(p[13]), tr); c.sS = clamp(p[14], 0, 1); c.sR = swing(sec(p[15]), tr);
    c.shape = clamp(Math.round(p[30]), 0, 3); c.mode = clamp(Math.round(p[27]), 0, 2); c.dest = clamp(Math.round(p[33]), 0, 7);
    c.amount = a * Math.abs(a); c.step = clamp(p[28], 0.001, 100) * TICK / sr;
    const sp = this.beat / lfoBeats; c.syncPh = sp - Math.floor(sp);
    c.fade = swing(sec(p[31]), tr); c.tune = p[44] + this.bendSt;
    c.drive = amt > 0.005 ? Math.pow(10, 2 * amt) - 0.99 : 0; c.dnorm = c.drive > 0 ? 1 / Math.tanh(c.drive) : 1;
    c.gain = Math.pow(10, p[53] / 20);
    const ds = Math.min(SS_DELAY_BEATS[clamp(Math.round(p[54]), 0, 4)] * 60 / this.bpm, DELAY_MAX_S);
    c.dframes = clamp(Math.trunc(ds * sr), 1, this.dlen - 1);
    c.fb = 0.99 * clamp(p[55] / 100, 0, 1); const m = clamp(p[57] / 100, 0, 1); c.mix = m * m; c.dfilt = 2 * clamp(p[56] / 100, 0, 1);
  }

  // starts key on a voice (poly: first free, else the oldest-started; Mono: voice 0, retriggered only once it is releasing), the glide
  // from the previously played note, Flip and the phase rules
  start(key, vel, pan) {
    if (key < 1) return;
    this.update();
    const p = this.p, c = this.c, mono = p[48] > 0.5;
    let index = 0;
    if (!mono) {
      const n = clamp(Math.round(p[43]), 1, MAX_VOICES); index = -1;
      for (let i = 0; i < n; i++) if (this.v[i].amp.st === IDLE) { index = i; break; }
      if (index < 0) { index = 0; for (let i = 1; i < n; i++) if (this.v[i].age < this.v[index].age) index = i; }
    }
    const keyHeld = key < 128 && this.held[key] >= 0, others = this.heldN > (keyHeld ? 1 : 0);
    const slide = clamp(p[45], 0, 10), from = this.last >= 0 && slide > 0.001 && (!(p[46] > 0.5) || others) ? this.last : -1;
    const flipped = p[17] > 0.5 && this.last >= 0 && key <= this.last, supersaw = !(p[1] > 0.5), retrig = p[2] > 0.5;
    const ph = clamp(p[9] / 100, 0, 1), spread = 0.99 * ph * ph;
    this.serial++;
    const v = this.v[index], retrigger = !mono || !envHeld(v.amp);
    v.note = key; v.vel = vel; v.pan = pan; v.age = this.serial; v.flip = flipped ? -1 : 1;
    if (from >= 0) { const ticks = slide * this.sr / TICK; v.pitch = from; v.glide = p[47] > 0.5 ? Math.abs(key - from) / ticks : 1 / ticks; }
    else { v.pitch = key; v.glide = 0; }
    if (retrigger) {
      if (!retrig && v.amp.st === IDLE) { for (let k = 0; k < MAX_UNISON; k++) { v.ph[k] = rngNext(this.rng); v.sph[k] = rngNext(this.rng); } }
      else if (retrig && supersaw) { for (let k = 0; k < MAX_UNISON; k++) { v.ph[k] = cycles(k * spread); v.sph[k] = v.ph[k]; } }   // the sub restarts at its unison voice's phase
      v.reAttack = v.amp.lv > 0; v.amp.st = ATTACK;
      v.feg.lv = 0; v.feg.st = ATTACK; v.seg.lv = 0; v.seg.st = ATTACK;
      v.lfoFade = 0; v.lfoPh = c.mode === 0 ? this.lfoPh : c.mode === 1 ? 0 : c.syncPh;
      v.lfoRnd = rngUnit(v.rng);
    }
    this.last = key;
    this.compute(v);
  }
  releaseAll() { for (const v of this.v) this.rel(v); }
  rel(v) { for (const e of [v.amp, v.feg, v.seg]) if (e.st !== IDLE) e.st = RELEASE; }
  noteOn(key, vel) {
    key = clamp(Math.round(key), 0, 127);
    if (this.held[key] < 0) this.heldN++;
    this.held[key] = vel;
    if (this.arpMode() === 0) this.start(key, vel, 0.5);
  }
  noteOff(key) {
    key = clamp(Math.round(key), 0, 127);
    if (this.held[key] >= 0) { this.held[key] = -1; this.heldN--; }
    if (this.arpMode() !== 0) return;
    if (this.p[48] > 0.5) {
      const v = this.v[0];
      if (v.note !== key || !envHeld(v.amp)) return;
      for (let k = 127; k >= 0; k--) if (this.held[k] >= 0) { this.start(k, v.vel, v.pan); return; }   // the highest key still held, no retrigger
      this.rel(v); return;
    }
    for (const v of this.v) if (v.note === key && envHeld(v.amp)) this.rel(v);
  }
  allOff() { this.held.fill(-1); this.heldN = 0; this.arp.on = false; this.arp.step = 0; this.arp.timer = 0; this.releaseAll(); }

  // runs the arp at this frame; returns the frames until its next step (each step releases every voice and plays the next note)
  arpStep() {
    const mode = this.arpMode(), A = this.arp;
    if (mode === 0 || this.heldN === 0) { if (A.on) { A.on = false; A.step = 0; A.timer = 0; this.releaseAll(); } return Infinity; }
    const len = SS_ARP_BEATS[clamp(Math.round(this.p[49]), 0, 5)] * 60 / this.bpm * this.sr;
    if (!A.on) { A.on = true; A.step = 0; A.timer = len; }
    if (A.timer >= len) {
      A.timer = (A.timer - len) % len;
      const oct = clamp(Math.round(this.p[50]), 0, 3) + 1, pos = arpPosition(mode, A.step, this.heldN * oct, rngUnit(this.rng));
      A.step++;
      let nth = pos % this.heldN, key = -1;
      for (let k = 0; k < 128; k++) if (this.held[k] >= 0 && nth-- === 0) { key = k; break; }
      if (key >= 0) { const vel = this.held[key]; this.releaseAll(); this.start(key + 12 * Math.floor(pos / this.heldN), vel, 0.5); }
    }
    return Math.max(1, Math.ceil(len - A.timer));
  }

  tick() {
    this.update();
    const c = this.c;
    if (this.arpMode() === 0) { const x = this.lfoPh + c.step; this.lfoPh = x - Math.trunc(x); }   // the global Hertz phase stands still in arp mode (as FLM)
    for (const v of this.v) if (v.amp.st !== IDLE) { this.advance(v); this.compute(v); }
  }
  advance(v) {
    const c = this.c, n = v.note;
    v.pitch = v.pitch < n ? Math.min(v.pitch + v.glide, n) : Math.max(v.pitch - v.glide, n);
    envAdvance(v.feg, c.fA, c.fD, c.fS, c.fR); envAdvance(v.seg, c.sA, c.sD, c.sS, c.sR);
    const old = v.lfoPh;
    if (c.mode === 0) { const x = old + c.step; v.lfoPh = x - Math.trunc(x); } else if (c.mode === 1) v.lfoPh = Math.min(old + c.step, 1); else v.lfoPh = c.syncPh;
    if (v.lfoPh < old) v.lfoRnd = rngUnit(v.rng);
    v.lfoFade = Math.min(v.lfoFade + c.fade, 1);
  }
  // the tick's derived values: oscillator increments and tables, the ladder, the output targets
  compute(v) {
    const p = this.p, c = this.c, sr = this.sr;
    const lfo = v.lfoFade * lfoShape(c.shape, v.lfoPh, v.lfoRnd) * c.amount, m = (k) => (c.dest === k ? lfo : 0);
    const f = 440 * Math.pow(2, (v.pitch - 69 + c.tune + 12 * m(M_FREQ)) / 12);
    let ugain = 1;
    if (p[1] > 0.5) {                                                            // Supersync: R = 1 + 5S slave periods, each a pair of saws
      const a0 = clamp(p[16] / 100, -1, 1), a = a0 * a0 * a0 * v.flip;
      const s = clamp(clamp(p[10] / 100, 0, 1) + v.seg.lv * a + m(M_SYNC), 0, 1), r = 1 + 5 * s, t = 1 / r;
      const w = clamp(0.5 * clamp(p[11] / 100, 0, 1) + m(M_PW), 0, 1);
      v.sync = true; v.nu = 1; v.panOn = false; v.pairs = Math.min(Math.ceil(r), MAX_PAIRS);
      for (let j = 0; j < v.pairs; j++) { const st = j * t; v.starts[j] = cycles(st); v.ends[j] = cycles(Math.min(st + w * t, 1)); }
      v.inc[0] = increment(f, sr); v.tbl[0] = tableOf(f, sr);
    } else {
      const n = clamp(Math.round(p[5]) + 1, 1, MAX_UNISON), det = clamp(p[6] / 100, 0, 1), d = clamp(det * det + m(M_DET), 0, 1);
      const curve = 2 * clamp(p[8] / 100, 0, 1) - 1, e = 1 + curve * (curve >= 0 ? 4 : 0.9), up = clamp(p[7] / 100, 0, 1), spread = n > 1 && up >= 0.001;
      for (let k = 0; k < n; k++) {
        const x = n === 1 ? 0 : k / (n - 1), ratio = n === 1 ? 1 : Math.pow(2, d / 12 * (2 * Math.pow(x, e) - 1)), fk = f * ratio;
        v.inc[k] = increment(fk, sr); v.tbl[k] = tableOf(fk, sr); v.sinc[k] = increment(0.5 * fk, sr); v.stbl[k] = tableOf(0.5 * fk, sr);
        v.panL[k] = 1; v.panR[k] = 1;
        if (spread) { const q = (2 * x - 1) * up; if (q >= 0) v.panL[k] = 1 - q; else v.panR[k] = 1 + q; }
      }
      v.sync = false; v.nu = n; v.panOn = spread;
      v.pulseOn = p[0] > 0.5; v.pulse = cycles(0.5 * clamp(clamp(p[3] / 100, 0, 1) + m(M_PW), 0, 1));
      const sb = clamp(p[4] / 100, 0, 1), sub = sb * sb; v.subLv = sub < 0.001 ? 0 : sub;
      ugain = Math.pow(10, -n / 20);
    }
    // key tracking reads the gliding note, without Transpose or bend
    const cp = clamp(clamp(p[18] / 100, 0, 1) + v.vel * p[21] / 100 + m(M_CUT), 0, 1);
    const fc = Math.min(Math.pow(2, 4 + 10.3 * cp + 8 * v.feg.lv * clamp(p[26] / 100, -1, 1) + (v.pitch / 12 - 4) * p[20] / 100), 20000);
    const g = clamp(OMEGA * fc / (SUBSTEPS * sr), 0, 1), r = clamp(clamp(p[19] / 100, 0, 1) + m(M_RES), 0, 1), L = v.lad;
    if (g !== L.g || r !== L.r) { ladderMatrix(L, g, r); L.g = g; L.r = r; }
    const lv = clamp(clamp(p[34] / 100, 0, 1) + m(M_LEVEL), 0, 1), gain = lv * lv * ugain * clamp(v.vel, 0, 1);
    const pan = clamp((clamp(p[35] / 100, -1, 1) + 1) / 2 + (v.pan - 0.5) + m(M_PAN), 0, 1);
    v.tL = gain * Math.min(2 - 2 * pan, 1); v.tR = gain * Math.min(2 * pan, 1);
  }
  // adds n frames of a voice into the tick mix: oscillators, the ladder per channel, the squared amp envelope and the smoothed gains
  voice(v, n) {
    const T = this.T, c = this.c, ML = this.mixL, MR = this.mixR, attack = v.reAttack ? c.aRe : c.aA, y0 = v.y0, y1 = v.y1, L = v.lad;
    for (let i = 0; i < n; i++) {
      const dither = rngNext(v.rng) >>> DITHER_SHIFT;
      let l = 0, r = 0;
      if (v.sync) {
        const ph = v.ph[0], t = v.tbl[0];
        for (let j = 0; j < v.pairs; j++) l += T[t + ((ph + v.starts[j] + dither) % PHASE >>> INDEX_SHIFT)] - T[t + ((ph + v.ends[j] + dither) % PHASE >>> INDEX_SHIFT)];
        v.ph[0] = ph + v.inc[0];
      } else {
        for (let k = 0; k < v.nu; k++) {
          const ph = v.ph[k];
          let s = T[v.tbl[k] + ((ph + dither) % PHASE >>> INDEX_SHIFT)];
          if (v.pulseOn) s -= T[v.tbl[k] + ((ph + v.pulse + dither) % PHASE >>> INDEX_SHIFT)];
          if (v.subLv > 0) s += v.subLv * T[v.stbl[k] + ((v.sph[k] + dither) % PHASE >>> INDEX_SHIFT)];
          if (v.panOn) { l += s * v.panL[k]; r += s * v.panR[k]; } else l += s;
          v.ph[k] = ph + v.inc[k]; v.sph[k] = v.sph[k] + v.sinc[k];
        }
      }
      let yl, yr;
      if (v.panOn) { yl = ladderRun(L, y0, l); yr = ladderRun(L, y1, r); }
      else { yl = yr = ladderRun(L, y0, l); y1.set(y0); }                        // a mono sum: one ladder, its state copied to the other
      const e = envAdvance(v.amp, attack, c.aD, c.aS, c.aR), e2 = e * e;
      v.gL += GAIN_SMOOTH * (v.tL - v.gL); v.gR += GAIN_SMOOTH * (v.tR - v.gR);
      ML[i] += yl * e2 * v.gL; MR[i] += yr * e2 * v.gR;
    }
  }
  // Distortion -> Gain -> Delay on the voices' sum, added into the output
  effects(Lo, Ro, at, n) {
    const c = this.c, len = this.dlen, read = (this.dpos + len - c.dframes) % len, M = [this.mixL, this.mixR], O = [Lo, Ro];
    for (let ch = 0; ch < 2; ch++) {
      const line = this.dl[ch], mx = M[ch], out = O[ch];
      let s = this.dz[ch];
      for (let i = 0; i < n; i++) {
        let x = mx[i];
        if (c.drive > 0) x = Math.tanh(c.drive * x) * c.dnorm;
        x *= c.gain;
        const d = line[(read + i) % len];
        let tap;
        if (c.dfilt <= 1) { s += (d - s) * c.dfilt; tap = s; } else { const k = c.dfilt - 1; s += (d - s) * (k * k * k * k); tap = d - s; }
        line[(this.dpos + i) % len] = (tap + x) * c.fb;
        out[at + i] += x + c.mix * tap;
      }
      this.dz[ch] = s;
    }
    this.dpos = (this.dpos + n) % len;
  }
  render(Lo, Ro, from, to) {
    const frames = to - from, bpf = this.bpm / (60 * this.sr);
    let done = 0, sounding = false;
    while (done < frames) {
      const wait = this.arpStep();
      if (this.tickPos === 0) this.tick();
      const n = Math.min(TICK - this.tickPos, frames - done, wait);
      this.mixL.fill(0, 0, n); this.mixR.fill(0, 0, n);
      for (const v of this.v) if (v.amp.st !== IDLE) { this.voice(v, n); sounding = true; }
      this.effects(Lo, Ro, from + done, n);
      this.tickPos = (this.tickPos + n) % TICK; this.arp.timer += n; this.beat += n * bpf; done += n;
    }
    // the delay rings on after the last voice (until its echoes are below -100 dB)
    const c = this.c;
    if (sounding) this.tail = c.mix > 0 ? Math.min(this.sr * 20, c.dframes * (c.fb > 1e-6 ? Math.ceil(Math.log(1e-5) / Math.log(c.fb)) + 1 : 1)) : 0;
    else this.tail = Math.max(0, this.tail - frames);
  }
}
