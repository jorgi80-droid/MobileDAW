// GMS (FL Studio Mobile's GMSynth, MobileDAW type 31): a port of the GMSynth model of Honeydew (https://github.com/daijro/honeydew,
// crates/audio/src/gmsynth.rs + gm_waveshapes.rs, GPL-3.0-or-later, by daijro; see THIRD_PARTY_NOTICES.md).
// Two additive-wavetable oscillators (29 shapes x 512 band-limited tables x 1024, 32-bit phases, one dither per frame) with up to four
// choir copies and an osc mod (Ring / FM / Sync / Filter), noise, an 8-stage one-pole filter with a tabulated resonance (LP 12 / LP 24 /
// HP), four one-pole envelopes (amp, filter, mod, EG), one global tempo LFO, mod wheel and pitch bend, then FX 1 -> 2 -> 3 (MultiFX banks,
// js/engine/hdmfx.js), master level and pan. Block laws every 32 frames. Saw / Sine / Square / Triangle follow FLM's law; the other 25
// shapes are Honeydew's own designs for FLM's menu names (FLM's shipped shapes are not part of Honeydew).
// MobileDAW keeps the parameters as the knobs FLM shows (0..100, -100..100, menu indices, dB: defs.js INSTRUMENTS[31]); js/import/build.js
// gmsFromFlm converts a project's stored values. Port rules as hdmini.js (the C++ twin is native/engine/hdgms.cpp).
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
import { clamp } from './dsp.js';
import { MfxBank } from './hdmfx.js';

export const GM_SHAPES = ['Beast', 'Crunch', 'Double Spike', 'Digital', 'Dirt', 'Electro', 'Filth', 'Fox', 'Funky', 'Grubby', 'Keys', 'Liquid', 'Ogre', 'Rhodes', 'Saw Mean', 'Saw Retro', 'Saw', 'Silk', 'Sine',
  'Smooth Sub', 'Square Retro', 'Square Smooth', 'Square', 'Strat', 'String', 'Throat', 'Triangle', 'Troll', 'Vocal'];
export const GM_RATE_BEATS = [0.25, 0.375, 0.5, 0.75, 1, 2, 4, 8, 16, 32];        // LFO Rate and FX LFO Rate (beats)
export const GM_RATES = ['1/4', '3/8', '1/2', '3/4', '1/1', '2/1', '4/1', '8/1', '16/1', '32/1'];
export const GM_PB_RANGES = [1, 2, 7, 12];
export const GM_MOD_KINDS = ['Ring', 'FM', 'Sync', 'Filter'];
const VOICES = 4, COPIES = 4, BLOCK = 32, PARTIALS = 512, TLEN = 1024, PHASE = 4294967296, TAU = 2 * Math.PI, PI = Math.PI;
const SAW = 16, SINE = 18, SQUARE = 22, TRIANGLE = 26, SEED = 0x2545f491;
// The designed shapes' level. Honeydew scales them to the square's RMS (pi / 4, "ours, not a law"); MobileDAW lowers that by 8 dB, the
// level of FLM's own default patch (Beast) measured on the owner's FLM stem (tools/flm-stem-test.mjs): the spectra stay Honeydew's designs.
const DESIGN_RMS = (PI / 4) * 0.398;
const IDLE = 0, ATTACK = 1, DECAY = 2, RELEASE = 3, RING = 0, FM = 1, SYNC = 2, FILTER = 3;
const SMOOTHING = 0.01, CUT_SMOOTH = 0.001, KBD_PER_KEY = 0.0089964, FLUSH = 1e-20, FREE_LEVEL = 1e-4, RATE_SCALE = 8.82, FT_LEN = 65536;

// a fixed pseudo-random number in [0, 1) for partial n (an integer mix hash)
function hash(seed, n) { let x = (Math.imul(n, 0x9e3779b9) ^ Math.imul(seed, 0x85ebca6b)) >>> 0; x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0; x ^= x >>> 16; return (x >>> 8) / 16777216; }
// signed magnitude and sine-basis phase of partial n (from 1) of menu slot `slot`
function partial(slot, n) {
  const odd = n % 2 === 1, saw = 1 / n, square = odd ? saw : 0;
  const pulse = (duty) => Math.abs(Math.sin(PI * n * duty)) / n, bump = (c, w) => { const t = (n - c) / w; return Math.exp(-(t * t)); }, lowPass = (corner) => { const t = n / corner; return 1 / (1 + t * t); };
  const random = (seed) => hash(seed, n), jitter = (seed) => PI * (2 * hash(seed, n) - 1), only = (list) => { for (const q of list) if (q[0] === n) return q[1]; return 0; };
  let bits = 0; for (let x = n; x; x >>>= 1) bits += x & 1;
  switch (slot) {
    case 0: return [saw * (1 + 3 * bump(6, 2.5)), 0];
    case 1: return [pulse(0.3), 0.5 * jitter(1)];
    case 2: return [2 * Math.cos(PI * n * 0.35) * lowPass(10), PI / 2 - PI * n * 0.35];
    case 3: return [bits <= 2 ? saw : 0, 0];
    case 4: return [saw * (0.4 + 1.2 * random(4)), jitter(5)];
    case 5: return [pulse(0.125), 0];
    case 6: return [odd ? Math.pow(n, -0.8) : 0.5 * saw, jitter(6)];
    case 7: return [saw * saw + 0.5 * bump(3, 0.8) + 0.2 * bump(9, 2), 0];
    case 8: return [saw * (0.3 + 2 * bump(4, 1.2)), 0];
    case 9: return [Math.pow(n, -1.5) * (0.5 + random(9)), 0];
    case 10: return [n === 1 ? 1 : odd ? 0.6 * saw * saw : 0.3 * Math.pow(n, -2.5), 0];
    case 11: return [saw * saw * saw, PI / 2 * (n - 1)];
    case 12: return [square * (1 + 2 * bump(5, 1.5)) * lowPass(20), 0];
    case 13: return [only([[1, 1], [2, 0.35], [3, 0.12], [4, 0.05], [7, 0.18], [8, 0.06], [14, 0.04]]), 0];
    case 14: return [saw * (odd ? 1 : 0.5) * (1 + 2 * bump(14, 5)), 0];
    case 15: return [n <= 24 ? saw : 0, 0];
    case SAW: return [saw, 0];
    case 17: return [Math.pow(n, -2.5), 0];
    case SINE: return [only([[1, 0.5]]), 0];
    case 19: return [only([[1, 1], [2, 0.2], [3, 0.05]]), 0];
    case 20: return [n <= 15 ? square : 0, 0];
    case 21: return [square * lowPass(7), 0];
    case SQUARE: return [square, 0];
    case 23: return [Math.abs(Math.sin(PI * n * 0.18)) * Math.pow(n, -1.2), 0];
    case 24: return [Math.abs(Math.sin(PI * n * 0.09)) * saw * (0.8 + 0.4 * random(24)), 0.3 * jitter(25)];
    case 25: return [saw * (0.25 + bump(3, 1) + 0.6 * bump(9, 2)), 0];
    case TRIANGLE: return [odd ? saw * saw : 0, n % 4 === 3 ? PI : 0];
    case 27: return [n === 2 ? 0.6 : odd ? Math.pow(n, -1.2) : 0.3 * saw * saw, 0];
    default: return [saw * (0.25 + bump(5, 1.5) + 0.7 * bump(12, 2.5) + 0.3 * bump(22, 3)), 0];
  }
}
// one shape's 512 tables (table H - 1 = the sum of partials 1..H, no normalisation), built on first use and shared
const SHAPES = new Array(GM_SHAPES.length).fill(null);
export function gmShape(slot) {
  slot = clamp(Math.round(slot), 0, GM_SHAPES.length - 1);
  if (SHAPES[slot]) return SHAPES[slot];
  const mag = new Float32Array(PARTIALS), ph = new Float32Array(PARTIALS);
  for (let n = 1; n <= PARTIALS; n++) {
    const q = partial(slot, n), p = q[1] - PI / 2 + (q[0] < 0 ? PI : 0), w = p + PI;
    mag[n - 1] = Math.abs(q[0]); ph[n - 1] = w - Math.floor(w / TAU) * TAU - PI;
  }
  if (slot !== SAW && slot !== SINE && slot !== SQUARE && slot !== TRIANGLE) {   // the designed slots: one common level (DESIGN_RMS)
    let e = 0; for (let k = 0; k < PARTIALS; k++) e += mag[k] * mag[k];
    const sc = DESIGN_RMS / Math.sqrt(e / 2);
    for (let k = 0; k < PARTIALS; k++) mag[k] = mag[k] * sc;
  }
  const sine = new Float64Array(TLEN), sum = new Float64Array(TLEN), out = new Float32Array(PARTIALS * TLEN);
  for (let i = 0; i < TLEN; i++) sine[i] = Math.sin(TAU * i / TLEN);
  for (let h = 1; h <= PARTIALS; h++) {
    const m = mag[h - 1], o = (h - 1) * TLEN;
    if (m !== 0) { const a = m * Math.cos(ph[h - 1]), b = m * Math.sin(ph[h - 1]); for (let n = 0; n < TLEN; n++) { const k = h * n; sum[n] += a * sine[(k + TLEN / 4) % TLEN] - b * sine[k % TLEN]; } }
    for (let n = 0; n < TLEN; n++) out[o + n] = sum[n];
  }
  return (SHAPES[slot] = out);
}
// the table (offset) for f Hz: H = 512 up to sr / 1024, else min(512, floor(sr / (2 f)) + 1)
const tableFor = (f, sr) => { f = Math.abs(f); if (!Number.isFinite(f) || !(sr > 0)) return 0; return (Math.min(PARTIALS, f <= sr / (2 * PARTIALS) ? PARTIALS : Math.floor(sr / (2 * f)) + 1) - 1) * TLEN; };
// the filter table: for the resonance peak f_r = 11.68 + 0.304433 j Hz, the stage coefficient a that puts the 8-stage loop (with its
// 1-frame feedback delay) at phase -pi there, and the self-oscillation gain b = |H|^-8 (authored at 44.1 kHz)
let FT = null;
function filterTable() {
  if (FT) return FT;
  FT = new Float32Array(FT_LEN * 2);
  for (let j = 0; j < FT_LEN; j++) {
    const w = TAU * (11.68 + 0.304433 * j) / 44100, th = (PI - w) / 8, r = Math.sin(th) / Math.sin(w + th), h = (1 - r) / Math.sqrt(1 - 2 * r * Math.cos(w) + r * r), h2 = h * h, h4 = h2 * h2;
    FT[2 * j] = 1 - r; FT[2 * j + 1] = 1 / (h4 * h4);
  }
  return FT;
}
function rngNext(o) { let x = o.s | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; o.s = x >>> 0; return o.s; }
const pow4 = (x) => x * x * x * x;
export const gmAttackRate = (v, sr) => (v <= 0 ? 1 : RATE_SCALE / (sr * 100 * pow4(v)));            // 0 -> 1 in about 2.53 v^4 s
export const gmDecayRate = (v, sr) => RATE_SCALE / (sr * (200 * (pow4(v) * v * v * v) + 0.001));       // time constant 22.7 v^7 s
function envStep(e, r) {
  if (e.st === ATTACK) { e.e += (5 - e.e) * r.a; if (e.e > 1) { e.e = 1; e.st = DECAY; } }
  else if (e.st === DECAY) e.e += (r.s - e.e) * r.d;
  else if (e.st === RELEASE) e.e -= e.e * r.r;
  if (e.e < FLUSH) e.e = 0;
  return e.e;
}
const lfoValue = (shape, phase) => (shape === 0 ? Math.sin(TAU * phase) : shape === 1 ? 2 * phase - 1 : phase < 0.5 ? -1 : 1);
const newEnv = () => ({ e: 0, st: IDLE }), rates = () => ({ a: 0, d: 0, s: 0, r: 0 });
function newVoice() {
  return { key: 0, vel: 0, notePan: 0.5, panL: 1, panR: 1, age: 0, p: 0, amp: newEnv(), fenv: newEnv(), menv: newEnv(), eg: newEnv(), gain: 0, s: 0, sT: 0, snap: false,
    pa: new Uint32Array(COPIES), pb: new Uint32Array(COPIES), sa: new Float64Array(COPIES), sb: new Float64Array(COPIES), ta: 0, tb: 0, y: [new Float64Array(8), new Float64Array(8)], noise: { s: 1 } };
}

export class HdGms {
  constructor(sr) {
    this.sr = sr > 0 && Number.isFinite(sr) ? sr : 44100;
    this.p = new Float64Array(68); this.FT = filterTable();
    this.v = Array.from({ length: VOICES }, newVoice);
    this.held = new Uint8Array(128); this.bendSt = 0; this.slideSt = 0; this.wheel = 0; this.bpm = 120; this.beat = 0; this.playing = false; this.rng = { s: SEED };
    this.fx = [new MfxBank(this.sr), new MfxBank(this.sr), new MfxBank(this.sr)]; this.fxKind = [-1, -1, -1]; this.io = new Float64Array(2);
    this.dither = new Uint32Array(BLOCK); this.lfo = new Float64Array(BLOCK); this.amount = new Float64Array(BLOCK); this.busL = new Float64Array(BLOCK); this.busR = new Float64Array(BLOCK);
    this.c = { amp: rates(), fenv: rates(), menv: rates(), eg: rates(), copies: 1, ratio: new Float64Array(COPIES), cpL: new Float64Array(COPIES), cpR: new Float64Array(COPIES), gainA: 0, gainB: 0, noise: 0, ratioB: 1, offset: 0, slide: 0,
      velDepth: false, egFilter: 0, egMod: 0, egPitch: 0, lfoShape: 0, lfoFilter: 0, lfoMod: 0, lfoPitch: 0, lfoModNow: 0, modKind: 0, modContour: 0, modTarget: 0, syncBase: 0, fltContour: 0, cutoff: 0, kbd: 0, mwFilter: 0, res: 0, fltKind: 0, level: 0, pan: 0.5 };
    // defaults = a fresh FLM GMSynth (Honeydew DEFAULTS in MobileDAW units) = defs.js INSTRUMENTS[31] defaults
    const D = [100, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 0, 1, 2, 50, 0, 0, 0, 100, 1, 20, 0, 0, 100, 1, 100, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 1, 0, 50, 50, 0, 0, 0, 5, 0, 50, 50, 0, 0, 0, 3, 0, 50, 50, 0, 0];
    D.forEach((x, i) => { this.p[i] = x; });
    this.wa = gmShape(0); this.wb = gmShape(0);
    this.reset();
  }
  reset() {
    this.v.forEach((v, i) => { const seed = i + 1, r = seed * 8; v.amp.st = IDLE; v.amp.e = 0; for (const e of [v.fenv, v.menv, v.eg]) { e.e = 0; e.st = IDLE; } v.key = 0; v.vel = 0; v.age = 0; v.p = 0; v.gain = 0; v.s = 0; v.sT = 0; v.snap = false;
      v.pa.fill(0); v.pb.fill(0); v.sa.fill(0); v.sb.fill(0); v.y[0].fill(0); v.y[1].fill(0); v.noise.s = (((SEED << r) | (SEED >>> (32 - r))) ^ seed) >>> 0; });
    this.held.fill(0); this.last = -1; this.serial = 0; this.blockPos = 0; this.lfoPhase = 0; this.snap = true; this.rng.s = SEED; this.modAmount = 0; this.level = 0; this.pan = 0.5;
    for (const b of this.fx) b.reset();
  }
  setParam(i, x) {
    if (i < 0 || i >= 68 || !Number.isFinite(x)) return;
    if (i === 43 && x > 0.5 && !(this.p[43] > 0.5)) for (let k = 0; k < 128; k++) this.noteOff(k);   // MONO on: a note-off to every key first
    this.p[i] = x;
    if (i === 7) this.wa = gmShape(x); else if (i === 8) this.wb = gmShape(x);
  }
  setTempo(b) { if (b > 0 && Number.isFinite(b)) this.bpm = b; }
  setBend(st) { this.bendSt = Number.isFinite(st) ? st : 0; this.slideSt = 0; }   // the wheel sends +-2 st = FLM's w = +-1 (x PB RANGE)
  setBendSl(st, sl) { this.bendSt = Number.isFinite(st) ? st : 0; this.slideSt = Number.isFinite(sl) ? sl : 0; }
  setSongPos(playing, beat) { this.playing = !!playing; if (playing && Number.isFinite(beat)) this.beat = beat; }
  setMod(v) { this.wheel = clamp(+v || 0, 0, 1); }
  active() { for (const v of this.v) if (v.amp.st !== IDLE) return true; for (const b of this.fx) if (b.busy()) return true; return false; }
  ratioB() { const p = this.p; return Math.pow(2, (clamp(p[10], -50, 50) / 100 + clamp(Math.round(p[9]), -24, 24)) * (1 / 12)); }

  // Poly: the highest-numbered free voice, else the oldest-started is stolen. MONO: voice 0, legato while it sounds unreleased.
  noteOn(key, vel) {
    key = clamp(Math.round(key), 0, 127);
    let others = false; for (let k = 0; k < 128; k++) if (this.held[k] && k !== key) { others = true; break; }
    this.held[key] = 1;
    vel = clamp(vel, 0, 1);
    const p = this.p, mono = p[43] > 0.5, last = this.last;
    this.last = key;
    const glideFrom = last >= 0 && (!(p[44] > 0.5) || others) ? last : key;      // AUTO: no glide unless another key is held
    const v0 = this.v[0];
    if (mono && (v0.amp.st === ATTACK || v0.amp.st === DECAY)) { v0.key = key; v0.vel = vel; return; }
    let index = 0;
    if (!mono) { index = -1; for (let i = VOICES - 1; i >= 0; i--) if (this.v[i].amp.st === IDLE) { index = i; break; } if (index < 0) { index = 0; for (let i = 1; i < VOICES; i++) if (this.v[i].age < this.v[index].age) index = i; } }
    this.serial++;
    const rb = this.ratioB(), po = clamp(p[11], 0, 1), v = this.v[index];
    if (v.amp.st === IDLE) { for (let k = 0; k < COPIES; k++) v.pa[k] = rngNext(this.rng); v.y[0].fill(0); v.y[1].fill(0); v.gain = vel; }
    for (let k = 0; k < COPIES; k++) { const cyc = po + v.pa[k] / PHASE * rb; v.pb[k] = Math.trunc((cyc - Math.trunc(cyc)) * PHASE); }   // B locks to A at retrigger
    v.key = key; v.vel = vel; v.notePan = 0.5; v.panL = 1; v.panR = 1; v.age = this.serial; v.p = glideFrom;
    v.amp.st = ATTACK; for (const e of [v.fenv, v.menv, v.eg]) { e.e = 0; e.st = ATTACK; }
    v.snap = true;
    if (this.blockPos !== 0) { this.glide(v); this.voiceControl(v); }
  }
  noteOff(key) {
    key = clamp(Math.round(key), 0, 127);
    this.held[key] = 0;
    if (!(this.p[43] > 0.5)) { for (const v of this.v) if (v.key === key && (v.amp.st === ATTACK || v.amp.st === DECAY)) this.release(v); return; }
    const v = this.v[0];
    if ((v.amp.st === ATTACK || v.amp.st === DECAY) && v.key === key) {
      let to = -1;
      for (let k = key - 1; k >= 0; k--) if (this.held[k]) { to = k; break; }
      if (to < 0) for (let k = key + 1; k < 128; k++) if (this.held[k]) { to = k; break; }
      if (to >= 0) v.key = to; else this.release(v);
    }
  }
  release(v) { if (v.amp.st !== IDLE) { v.amp.st = RELEASE; v.eg.st = RELEASE; } }   // the filter and mod envelopes ignore the note-off
  allOff() { this.held.fill(0); for (const v of this.v) this.release(v); }
  // glide, once per block: p += (key - p) 32 / (0.1 sr slide + 1), snapping when it reaches the key
  glide(v) { const gap = v.key - v.p, step = gap * BLOCK / (0.1 * this.sr * this.c.slide + 1); v.p = Math.abs(step) >= Math.abs(gap) ? v.key : v.p + step; }
  // the voice's block laws: pitch, both tables, the phase steps and the cutoff target
  voiceControl(v) {
    const c = this.c, sr = this.sr, eg = v.eg.e, pitch = v.p + c.offset + c.egPitch * eg + c.lfoPitch, fa = 220 * Math.pow(2, (pitch - 57) / 12), fb = fa * c.ratioB;
    v.ta = tableFor(fa, sr); v.tb = tableFor(fb, sr);
    const sync = c.modKind === SYNC ? Math.pow(2, c.syncBase + c.modContour * v.menv.e + c.egMod * eg + c.lfoModNow) : 1;
    for (let k = 0; k < COPIES; k++) {
      let x = Math.trunc(fa * sync * c.ratio[k] / sr * PHASE); v.sa[k] = x > 0 ? x % PHASE : 0;
      x = Math.trunc(fb * c.ratio[k] / sr * PHASE); v.sb[k] = x > 0 ? x % PHASE : 0;
    }
    v.sT = clamp(c.cutoff + c.kbd * (pitch - 64) * KBD_PER_KEY + c.mwFilter, 0, 1);
    if (v.snap) { v.s = v.sT; v.snap = false; }
  }
  // the block laws
  control() {
    const p = this.p, sr = this.sr, c = this.c, N = (i) => clamp(p[i] / 100, 0, 1), B = (i) => clamp(p[i] / 100, -1, 1), I = (i, hi) => clamp(Math.round(p[i]), 0, hi);
    const startBeat = this.playing ? this.beat : -1;
    for (let s = 0; s < 3; s++) {
      const o = 47 + 7 * s, a = B(o + 2);
      this.fxKind[s] = p[o] > 0.5 ? I(o + 1, 9) : -1;
      this.fx[s].prepare(N(o + 3), N(o + 4), GM_RATE_BEATS[I(o + 5, 9)], a * Math.abs(a), I(o + 6, 2), this.bpm, startBeat, BLOCK);
    }
    const lfoShape = I(36, 2), lrate = GM_RATE_BEATS[I(38, 9)];
    let lph = this.lfoPhase; if (this.playing) { const t = this.beat / lrate; lph = t - Math.floor(t); }
    const lfoNow = lfoValue(lfoShape, lph);
    const mw = this.wheel * N(21), md = I(20, 2), mwFilter = md === 0 ? mw : 0, mwLfo = md === 1 ? mw : 0, mwOsc = md === 2 ? mw : 0;
    let s2 = clamp(p[26], 0, 1);
    c.amp.a = gmAttackRate(N(24), sr); c.amp.d = gmDecayRate(N(25), sr); c.amp.s = s2 * s2; c.amp.r = RATE_SCALE / (sr * (N(27) + 0.001));
    c.menv.a = gmAttackRate(N(16), sr); c.menv.d = gmDecayRate(N(17), sr); c.menv.s = 0; c.menv.r = 0;
    c.fenv.a = gmAttackRate(N(2), sr); c.fenv.d = gmDecayRate(N(3), sr); c.fenv.s = 0; c.fenv.r = 0;
    s2 = clamp(p[31], 0, 1);
    c.eg.a = gmAttackRate(N(29), sr); c.eg.d = gmDecayRate(N(30), sr); c.eg.s = s2 * s2; c.eg.r = RATE_SCALE / (sr * (200 * pow4(N(32)) + 0.001));
    // choir: N copies at 2^((D i / (N - 1) - D / 2) / 12), odd copies x 1.5 (Chord) or x 2 (Octave), spread across the stereo field
    c.copies = I(45, 3) + 1;
    const spread = N(41), scale = [1, 1.5, 2][I(46, 2)], stereo = N(42);
    for (let k = 0; k < COPIES; k++) {
      const t = c.copies > 1 ? k / (c.copies - 1) : 0.5, x = stereo * (2 * t - 1);
      c.ratio[k] = Math.pow(2, (spread * t - spread / 2) / 12) * (k % 2 === 1 ? scale : 1);
      c.cpL[k] = clamp(1 - x, 0, 1); c.cpR[k] = clamp(1 + x, 0, 1);
    }
    const nz = N(13), bal = (clamp(p[12], -100, 100) + 100) / 200, g = 0.5 / (1 + 0.15 * (c.copies - 1)) * (1 - nz * nz);
    c.gainA = g * (1 - Math.abs(2 * bal - 1)); c.gainB = g * (2 * bal - 1); c.noise = nz * nz;
    c.ratioB = this.ratioB();
    c.offset = clamp(Math.round(p[39]), -24, 24) + GM_PB_RANGES[I(19, 3)] * (this.bendSt / 2) + this.slideSt;
    c.slide = N(40);
    // EG depth c by its destination: Filter c^3, Osc. Mod |c| c, Pitch 12 c |c| st
    const depth = B(28), egDest = I(34, 2);
    c.egFilter = egDest === 0 ? depth * depth * depth : 0; c.egMod = egDest === 1 ? Math.abs(depth) * depth : 0; c.egPitch = egDest === 2 ? 12 * depth * Math.abs(depth) : 0;
    c.velDepth = p[33] > 0.5;
    // LFO: A (+ the mod wheel on |A|) by its destination: FLT A^3, MOD |A| A, FREQ 12 A |A| st, LVL +-12 A dB, PAN |A| A
    const a0 = B(35), am = Math.min(Math.abs(a0) + mwLfo, 1), a = a0 < 0 ? -am : am, lfoDest = I(37, 4);
    c.lfoShape = lfoShape;
    c.lfoFilter = lfoDest === 0 ? a * a * a : 0; c.lfoMod = lfoDest === 1 ? Math.abs(a) * a : 0; c.lfoModNow = c.lfoMod * lfoNow;
    c.lfoPitch = (lfoDest === 2 ? 12 * a * Math.abs(a) : 0) * lfoNow;
    const lfoLevel = (lfoDest === 3 ? 12 * a : 0) * lfoNow, lfoPan = (lfoDest === 4 ? Math.abs(a) * a : 0) * lfoNow;
    c.modKind = I(15, 3); c.modContour = B(18); c.modTarget = N(14) + mwOsc; c.syncBase = clamp(c.modTarget, 0, 1);
    const fc = B(4);
    c.fltContour = fc * fc * fc; c.cutoff = N(0); c.kbd = N(5); c.mwFilter = mwFilter; c.res = N(1); c.fltKind = I(6, 2);
    const db = clamp(p[22], -60, 18) + lfoLevel;
    c.level = db < -60 || p[22] <= -60 ? 0 : Math.pow(10, db / 20); c.pan = clamp((clamp(p[23], -100, 100) + 100) / 200 + lfoPan, 0, 1);
    if (this.snap) { this.level = c.level; this.pan = c.pan; this.modAmount = c.modTarget; this.snap = false; }
    for (const v of this.v) if (v.amp.st !== IDLE) { this.glide(v); this.voiceControl(v); }
  }
  // one voice into the bus for n frames of the block
  voice(v, n) {
    const c = this.c, A = this.wa, Bt = this.wb, ta = v.ta, tb = v.tb, FTb = this.FT, dither = this.dither, lfo = this.lfo, amount = this.amount, busL = this.busL, busR = this.busR;
    const velocity = clamp(v.vel, 0, 1), depth = c.velDepth ? velocity : 1, sync = c.modKind === SYNC, pa = v.pa, pb = v.pb, y0 = v.y[0], y1 = v.y[1], kind = c.fltKind;
    for (let i = 0; i < n; i++) {
      const dz = dither[i], amp = envStep(v.amp, c.amp), eF = envStep(v.fenv, c.fenv), eM = envStep(v.menv, c.menv), eg = envStep(v.eg, c.eg) * depth;
      const m = clamp(amount[i] + c.modContour * eM + c.egMod * eg + c.lfoMod * lfo[i], 0, 1), act = m > 0.001, fm = act && c.modKind === FM, ring = act && c.modKind === RING;
      let left = 0, right = 0, b0 = 0;
      for (let k = 0; k < c.copies; k++) {
        const b = Bt[tb + ((pb[k] + dz) >>> 22)];
        let a = A[ta + ((fm ? pa[k] + Math.trunc((b + 1) * m * PHASE) + dz : pa[k] + dz) >>> 22)];
        if (ring) a *= 1 + 3 * m * b;
        const x = c.gainA * a + c.gainB * b;
        left += x * c.cpL[k]; right += x * c.cpR[k];
        if (k === 0) b0 = b;
        const nb = pb[k] + v.sb[k];
        pb[k] = nb;                                                             // (wraps: Uint32Array)
        pa[k] = sync && nb >= PHASE ? 0 : pa[k] + v.sa[k];
      }
      const noise = c.noise * ((rngNext(v.noise) >>> 8) / 8388608 - 1);
      v.s += CUT_SMOOTH * (v.sT - v.s);
      const cut = clamp(v.s + c.fltContour * eF + c.egFilter * eg + c.lfoFilter * lfo[i] + (act && c.modKind === FILTER ? 0.5 * m * b0 : 0), 0, 1);
      // (a, b) of the filter table at the nominal cutoff 32 x 2^(9.27 c) Hz
      const fx = clamp((1.0159 * (32 * Math.pow(2, 9.27 * cut)) + 0.5 - 11.68) / 0.304433, 0, FT_LEN - 1), j = Math.min(Math.trunc(fx), FT_LEN - 2), t = fx - j;
      const ca = FTb[2 * j] + t * (FTb[2 * j + 2] - FTb[2 * j]), fbk = c.res * (FTb[2 * j + 1] + t * (FTb[2 * j + 3] - FTb[2 * j + 1]));
      // one channel: u = clip(x - feedback y8), eight stages y += a (u - y); LP 12 = stage 4, LP 24 = stage 8, HP = u - stage 1
      let u = left + noise - fbk * y0[7]; u = u / (1 + 0.05 * Math.abs(u));
      let inp = u; for (let q = 0; q < 8; q++) { y0[q] += ca * (inp - y0[q]); inp = y0[q]; }
      const outL = kind === 0 ? y0[3] : kind === 1 ? y0[7] : u - y0[0];
      u = right + noise - fbk * y1[7]; u = u / (1 + 0.05 * Math.abs(u));
      inp = u; for (let q = 0; q < 8; q++) { y1[q] += ca * (inp - y1[q]); inp = y1[q]; }
      const outR = kind === 0 ? y1[3] : kind === 1 ? y1[7] : u - y1[0];
      v.gain += SMOOTHING * (velocity - v.gain);
      const gn = amp * v.gain;
      busL[i] += outL * gn * v.panL; busR[i] += outR * gn * v.panR;
      if ((v.amp.st === RELEASE || (v.amp.st === DECAY && c.amp.s === 0)) && amp < FREE_LEVEL) { v.amp.st = IDLE; return; }
    }
  }
  render(Lo, Ro, from, to) {
    const total = to - from, bpf = this.bpm / (60 * this.sr), io = this.io;
    let done = 0;
    while (done < total) {
      if (this.blockPos === 0) this.control();
      const n = Math.min(BLOCK - this.blockPos, total - done), c = this.c, lrate = GM_RATE_BEATS[clamp(Math.round(this.p[38]), 0, 9)], step = bpf / lrate;
      for (let i = 0; i < n; i++) {
        this.dither[i] = rngNext(this.rng) >>> 10;                               // one dither per frame, shared by every oscillator and voice
        let ph = this.lfoPhase; if (this.playing) { const t = (this.beat + i * bpf) / lrate; ph = t - Math.floor(t); }
        const nx = ph + step; this.lfoPhase = nx - Math.trunc(nx);
        this.lfo[i] = lfoValue(c.lfoShape, ph);
        this.modAmount += SMOOTHING * (c.modTarget - this.modAmount); this.amount[i] = this.modAmount;
      }
      this.busL.fill(0, 0, n); this.busR.fill(0, 0, n);
      for (const v of this.v) if (v.amp.st !== IDLE) this.voice(v, n);
      for (let i = 0; i < n; i++) {
        io[0] = this.busL[i]; io[1] = this.busR[i];
        this.fx[0].frame(io, this.fxKind[0]); this.fx[1].frame(io, this.fxKind[1]); this.fx[2].frame(io, this.fxKind[2]);
        this.level += SMOOTHING * (c.level - this.level); this.pan += SMOOTHING * (c.pan - this.pan);
        const l = Math.min(2 - 2 * this.pan, 1), r = Math.min(2 * this.pan, 1);
        Lo[from + done + i] += io[0] * this.level * l * l; Ro[from + done + i] += io[1] * this.level * r * r;
      }
      this.blockPos = (this.blockPos + n) % BLOCK; if (this.playing) this.beat += n * bpf; done += n;
    }
  }
}
