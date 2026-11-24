// FL Studio Mobile's MultiFX processor bank: a port of Honeydew (https://github.com/daijro/honeydew, crates/audio/src/multifx.rs,
// multifx_delay.rs, multifx_reverb.rs, GPL-3.0-or-later, by daijro; see THIRD_PARTY_NOTICES.md). One processor of every kind (DIST,
// FLANGER, PHASER, LPF, HPF, DELAY, REVERB, PANNER, RING, VOX), visited in that order; the selected one fades in over its wet ramp and a
// deselected one keeps running until its tail is silent. Controls per block: X, Y, an LFO (rate in beats, amount, shape) on X.
// GMSynth runs three banks (FX 1 -> 2 -> 3, js/engine/hdgms.js). Port rules: scalar maths in double, delay lines in float; the C++ twin
// (native/engine/hdmfx.cpp) keeps every expression in this order.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
const TAU = 2 * Math.PI, SILENT = 1e-4;
export const MFX_DIST = 0, MFX_FLANGER = 1, MFX_PHASER = 2, MFX_LPF = 3, MFX_HPF = 4, MFX_DELAY = 5, MFX_REVERB = 6, MFX_PANNER = 7, MFX_RING = 8, MFX_VOX = 9;
const VOWEL_A = [250, 700, 2500, 3500, 4200, 8500, 10000, 12000], VOWEL_B = [700, 1250, 2500, 3500, 4200, 8500, 10000, 12000], VOWEL_C = [250, 2500, 2700, 3500, 4200, 8500, 10000, 12000];
const flush = (x) => (Math.abs(x) < 1e-30 ? 0 : x);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const frac = (x) => x - Math.floor(x);
// the MultiFX LFO: Sine at the phase before the advance, Saw 1 - 2 phase' (after one increment), Square +1 while phase <= 0.5
export function mfxLfo(shape, phase, inc) { return shape === 0 ? Math.sin(TAU * phase) : shape === 1 ? 1 - 2 * frac(phase + inc) : phase <= 0.5 ? 1 : -1; }

// LP / HP: four biquads per channel in series, each fed the previous stage's output of the frame before
class Filter {
  constructor() { this.z = new Float64Array(32); this.pre = new Float64Array(6); this.b0 = 0; this.b1 = 0; this.a1 = 0; this.a2 = 0; this.wet = 0; this.nx = new Float64Array(4); }
  clear() { this.z.fill(0); this.pre.fill(0); this.b0 = this.b1 = this.a1 = this.a2 = 0; this.wet = 0; }
  set(frequency, resonance, sr, highPass) {
    const angle = Math.min(TAU * frequency / sr, 3), sine = Math.sin(angle), cosine = Math.cos(angle), b0 = (1 + (highPass ? cosine : -cosine)) / (2 + sine / resonance);
    this.b0 = b0; this.b1 = highPass ? -2 * b0 : 2 * b0; this.a1 = -2 * resonance * cosine / (sine + resonance); this.a2 = (resonance - sine) / (sine + resonance);
  }
  run(io, target) {
    this.wet += (target - this.wet) * 0.005;
    const z = this.z, nx = this.nx;
    for (let ch = 0; ch < 2; ch++) {
      const x = io[ch];
      for (let st = 0; st < 4; st++) {
        const s = st === 0 ? x : this.pre[ch * 3 + st - 1], o = (ch * 4 + st) * 4;
        const out = flush(this.b0 * s + this.b1 * z[o] + this.b0 * z[o + 1] - this.a1 * z[o + 2] - this.a2 * z[o + 3]);
        z[o + 1] = z[o]; z[o] = s; z[o + 3] = z[o + 2]; z[o + 2] = out; nx[st] = out;
      }
      this.pre[ch * 3] = nx[0]; this.pre[ch * 3 + 1] = nx[1]; this.pre[ch * 3 + 2] = nx[2];
      io[ch] = x + this.wet * (nx[3] - x);
    }
  }
}
// a mono feed -0.5 w (L + R) plus the feedback enters a line of N = trunc(0.005 sr) frames read at the delay 1 / speed (tape-like)
class Flanger {
  constructor(sr) { this.span = Math.max(4, Math.trunc(sr * 0.005)); this.s = new Float32Array(this.span + 3); this.cur = 0; this.speed = 0; this.tspeed = 0; this.fb = 0; this.wet = 0; }
  clear() { this.s.fill(0); this.cur = 0; this.speed = 0; this.wet = 0; }
  set(x, y, lfo) { const q = (1 - x) - 0.5 * lfo, q2 = q * q, d = Math.min(q2 * q2, 1); this.tspeed = 1 / (2 + (this.span - 2) * d); this.fb = -0.96 * y; if (this.speed === 0) this.speed = this.tspeed; }
  run(io, target) {
    this.wet += (target - this.wet) * 0.005;
    this.speed = clamp(this.speed + 0.001 * (this.tspeed - this.speed), 1 / this.span, 0.9);
    const s = this.s, len = s.length, p0 = this.cur - 1 / this.speed, pos = p0 - Math.floor(p0 / len) * len, idx = Math.trunc(pos) % len;
    const y = s[idx] + (s[(idx + 1) % len] - s[idx]) * (pos - Math.trunc(pos));
    s[this.cur] = flush(-0.5 * this.wet * (io[0] + io[1]) + this.fb * y);
    this.cur = (this.cur + 1) % len;
    io[0] += y; io[1] += y;
  }
}
class Panner {
  constructor(sr) { const n = Math.max(4, Math.trunc(sr * 0.002)); this.s = [new Float32Array(n), new Float32Array(n)]; this.clear(); }
  clear() { this.s[0].fill(0); this.s[1].fill(0); this.cur = 0; this.wet = 0; this.pan = -1; this.dist = -1; this.tpan = 0.5; this.tdist = 0; }
  set(x, y, lfo) { this.tpan = clamp(x + lfo, 0, 1); this.tdist = Math.sqrt(y); if (this.pan < 0) this.pan = this.tpan; if (this.dist < 0) this.dist = this.tdist; }
  run(io, target) {
    this.wet += (target - this.wet) * 0.005; this.pan += (this.tpan - this.pan) * 0.005; this.dist += (this.tdist - this.dist) * 0.005;
    const len = this.s[0].length;
    for (let ch = 0; ch < 2; ch++) {
      const far = ch === 0 ? Math.max(2 * this.pan - 1, 0) : Math.max(1 - 2 * this.pan, 0), s = this.s[ch], x = io[ch];
      s[this.cur] = x;
      const p0 = this.cur - (1 + far * (len - 4)), pos = p0 - Math.floor(p0 / len) * len, idx = Math.trunc(pos) % len;
      const delayed = s[idx] + (s[(idx + 1) % len] - s[idx]) * (pos - Math.trunc(pos));
      io[ch] = x * (1 - this.wet) + delayed * (1 - this.dist * far) * this.wet;
    }
    this.cur = (this.cur + 1) % len;
  }
}
class Phaser {
  constructor() { this.st = new Float64Array(12); this.fbk = new Float64Array(2); this.clear(); }
  clear() { this.st.fill(0); this.fbk.fill(0); this.wet = 0; this.og = 0; this.co = 0; this.fg = 0; }
  set(x, y, lfo, sr) { const nrm = clamp(((x * x + x * x * lfo) * 19950 + 50) / sr, 0.001, 0.499); this.co = (1 - nrm) / (1 + nrm); this.fg = 0.98 * Math.cbrt(0.6 * y); }
  run(io, target) {
    this.wet += (target - this.wet) * 0.005; this.og += (1 - this.og) * 0.005;
    for (let ch = 0; ch < 2; ch++) {
      let s = io[ch] * this.wet + this.fbk[ch] * this.fg;
      for (let k = ch * 6; k < ch * 6 + 6; k++) { const nx = this.st[k] - this.co * s; this.st[k] = flush(s + this.co * nx); s = nx; }
      this.fbk[ch] = flush(s);
      io[ch] += s * this.og;
    }
  }
}
// VOX: eight band-passes per channel on a vowel triangle A -> B -> C -> A (X), the formants scaled by 2^(1.7 Y - 0.85)
class Vowel {
  constructor() { this.z = new Float64Array(64); this.b0 = new Float64Array(8); this.a1 = new Float64Array(8); this.a2 = new Float64Array(8); this.clear(); }
  clear() { this.z.fill(0); this.b0.fill(0); this.a1.fill(0); this.a2.fill(0); this.wet = 0; this.og = 0; this.sg = 0; }
  set(x, y, lfo, sr) {
    const position = clamp(x + lfo, 0, 1) * 3, segment = position >= 3 ? 0 : Math.trunc(position), fr = position - Math.trunc(position), scale = Math.pow(2, 1.7 * y - 0.85);
    this.sg = 1 - segment * 0.125;
    for (let b = 0; b < 8; b++) {
      const f = (segment === 0 ? VOWEL_A[b] * (1 - fr) + VOWEL_B[b] * fr : segment === 1 ? VOWEL_B[b] * (1 - fr) + VOWEL_C[b] * fr : VOWEL_C[b] * (1 - fr) + VOWEL_A[b] * fr) * scale;
      const angle = Math.min(TAU * f / sr, 3.1), sine = Math.sin(angle), cosine = Math.cos(angle), alpha = sine / 24, den = 1 + alpha;
      this.b0[b] = 0.5 * sine / den; this.a1[b] = 2 * cosine / den; this.a2[b] = (1 - alpha) / den;
    }
  }
  run(io, target) {
    this.wet += (target - this.wet) * 0.005; this.og += (1 - this.og) * 0.005;
    const mix = this.wet * this.og, z = this.z;
    for (let ch = 0; ch < 2; ch++) {
      const x = io[ch]; let sum = 0;
      for (let b = 0; b < 8; b++) {
        const o = (ch * 8 + b) * 4, out = flush(this.b0[b] * (x - z[o + 1]) + this.a1[b] * z[o + 2] - this.a2[b] * z[o + 3]);
        z[o + 1] = z[o]; z[o] = x; z[o + 3] = z[o + 2]; z[o + 2] = out; sum += out;
      }
      io[ch] = x * (1 - mix) + sum * this.sg * mix;
    }
  }
}
// DIST: every H = trunc(min(Y^4, 1) 256) + 1 frames latches y = x g (k + 1) / (1 + k |x|), g = 0.1 - 0.09 Y, k = 10^(4 (X + LFO) + 1)
class Crusher {
  constructor() { this.h = new Float64Array(2); this.clear(); }
  clear() { this.h.fill(0); this.count = 0; this.hold = 0; this.gain = 0; this.knee = 0; }
  set(x, y, lfo) { const y2 = y * y; this.hold = Math.trunc(Math.min(y2 * y2, 1) * 256) + 1; this.gain = 0.1 - 0.09 * y; this.knee = Math.pow(10, 4 * (x + lfo) + 1); }
  run(io) {
    if (this.count === 0) { const g = this.gain, k = this.knee; this.h[0] = io[0] * g * (k + 1) / (1 + k * Math.abs(io[0])); this.h[1] = io[1] * g * (k + 1) / (1 + k * Math.abs(io[1])); }
    this.count++; if (this.count >= this.hold) this.count = 0;
    io[0] = this.h[0]; io[1] = this.h[1];
  }
}
// RING: a sine carrier at 2^(5 + 8.7 clamp(X + 0.5 LFO, 0, 1)) Hz
class Ring {
  constructor() { this.clear(); }
  clear() { this.phase = 0; this.step = 0; this.wet = 0; this.og = 0; }
  set(x, lfo, sr) { this.step = Math.pow(2, 5 + 8.7 * clamp(x + 0.5 * lfo, 0, 1)) / sr; }
  run(io, target) {
    this.wet += (target - this.wet) * 0.005; this.og += (1 - this.og) * 0.005;
    const mix = this.wet * this.og, carrier = Math.sin(TAU * this.phase), t = this.phase + this.step;
    this.phase = t - Math.trunc(t);
    io[0] = io[0] * (1 - mix) + mix * io[0] * carrier; io[1] = io[1] * (1 - mix) + mix * io[1] * carrier;
  }
}
// DELAY: echo of R beats (halved until <= 1.5 s), X^2 = level and gain per repeat, Y = low-pass below 0.5 / high-pass above, LFO pans
class Delay {
  constructor(sr) { this.sr = sr; this.cap = Math.max(4, Math.trunc(sr * 1.5)); this.ring = [new Float32Array(this.cap), new Float32Array(this.cap)]; this.cur = 0; this.dly = 1; this.x = 0.5; this.y = 0.5; this.wet = 0;
    this.f1 = new Float64Array(2); this.f2 = new Float64Array(2); this.la = 0; this.ls = 0; this.lph = 0; this.linc = 0; }
  resetAudio() { this.ring[0].fill(0); this.ring[1].fill(0); this.cur = 0; this.f1.fill(0); this.f2.fill(0); }
  clear() { this.resetAudio(); this.wet = 0; }
  configure(x, y, rateBeats, amount, shape, bpm, startBeat) {
    this.x = clamp(x, 0, 1); this.y = clamp(y, 0, 1); this.la = clamp(amount, -1, 1); this.ls = Math.min(shape, 2);
    if (rateBeats > 0 && bpm > 0) {
      const rate = 2 * rateBeats; let nt = rate * 60 / bpm / 3;
      while (nt > 1) nt *= 0.5;
      const d = clamp(Math.trunc((this.cap - 1) * nt), 1, this.cap - 1);
      if (d !== this.dly) { this.dly = d; this.resetAudio(); }
      this.linc = bpm / (60 * this.sr * rate);
      if (startBeat >= 0) this.lph = frac(startBeat / rate);
    }
  }
  run(io, target) {
    this.wet = flush(this.wet + 0.005 * (clamp(target, 0, 1) - this.wet));
    const lfo = this.la * mfxLfo(this.ls, this.lph, this.linc);
    this.lph = frac(this.lph + this.linc);
    const ri = (this.cur + this.cap - this.dly) % this.cap, gain = this.x * this.x, c1 = this.y <= 0.5 ? 0.01 + 1.98 * this.y : 1, c2 = this.y <= 0.5 ? 0 : 0.9 * this.y - 0.45;
    for (let ch = 0; ch < 2; ch++) {
      const smp = this.ring[ch][ri], pf = this.f1[ch];
      this.f1[ch] = flush(pf + c1 * (gain * smp - pf));
      this.f2[ch] = flush(this.f2[ch] + c2 * (pf - this.f2[ch]));
      const w = pf - this.f2[ch];
      this.ring[ch][this.cur] = flush(io[ch] * this.wet + w);
      io[ch] += (ch === 0 ? 1 + lfo : 1 - lfo) * w;
    }
    this.cur = (this.cur + 1) % this.cap;
  }
}
// REVERB: mono in, high-passed near 317 Hz, four diffusers, two cross-coupled damped late branches; only the late tail is added
const DIFF_S = [0.0131, 0.0173, 0.0197, 0.0251], LATE_L = [0.0441, 0.0633, 0.0781, 0.1039], LATE_R = [0.0473, 0.0659, 0.0829, 0.1091];
class Line {
  constructor(maxFrames) { this.s = new Float32Array(Math.max(4, maxFrames) + 4); this.cur = 0; }
  read(frames) { const len = this.s.length, p0 = this.cur - clamp(frames, 1, len - 2), pos = p0 - Math.floor(p0 / len) * len, idx = Math.trunc(pos) % len; return this.s[idx] + (this.s[(idx + 1) % len] - this.s[idx]) * (pos - Math.trunc(pos)); }
  push(x) { this.s[this.cur] = flush(x); this.cur = (this.cur + 1) % this.s.length; }
  clear() { this.s.fill(0); this.cur = 0; }
}
class Reverb {
  constructor(sr) {
    this.sr = sr; this.wet = 0; this.decay = 1; this.late = 0; this.lateT = 0; this.damp = 1; this.hp = 0; this.prev = 0;
    this.dif = DIFF_S.map((s, i) => { const fr = Math.max(1, Math.round(s * sr)); return { d: new Line(fr + 2), fr, g: i % 2 === 0 ? 0.7 : -0.7 }; });
    const late = (S) => S.map((s) => { const fr = Math.max(1, Math.round(s * sr)); return { d: new Line(fr + 4), fr, damp: 0 }; });
    this.L = late(LATE_L); this.R = late(LATE_R); this.tl = new Float64Array(4); this.tr = new Float64Array(4);
    this.hpk = Math.exp(-TAU * 317 / sr);
    this.refresh(0.5, 0.5); this.late = this.lateT;
  }
  refresh(x, y) {
    x = clamp(x, 0, 1); y = clamp(y, 0, 1);
    const x3 = x * x * x;
    this.decay = 0.1 * Math.floor(1 + 199 * (0.75 * x3) + 0.5);
    this.lateT = 0.3 * Math.pow(10, Math.floor(-361 + 421 * (0.5 + 0.15 * x3) + 0.5) * 0.005);
    const fc = Math.floor(5 + 216 * y * y + 0.5);
    this.damp = fc >= 221 ? 1 : 1 - Math.exp(-TAU * 100 * fc / this.sr);
  }
  branch(lines, taps, opp, input) {
    const t0 = taps[0], t1 = taps[1], t2 = taps[2], t3 = taps[3];
    for (let i = 0; i < 4; i++) {
      const tr = i === 0 ? (t0 + t1 + t2 + t3) * 0.5 : i === 1 ? (t0 - t1 + t2 - t3) * 0.5 : i === 2 ? (t0 + t1 - t2 - t3) * 0.5 : (t0 - t1 - t2 + t3) * 0.5;
      const ln = lines[i], fb = Math.pow(10, -3 * (ln.fr / this.sr) / this.decay);
      ln.damp = flush(ln.damp + this.damp * (tr + 0.08 * opp[i] - ln.damp));
      ln.d.push(input * 0.25 + fb * ln.damp);
    }
    return (t0 + t1 - t2 + t3) * 0.5;
  }
  run(io, target) {
    this.wet = flush(this.wet + ((target > 0.5 ? 1 : 0) - this.wet) * 0.005);
    this.late += 0.001 * (this.lateT - this.late);
    const input = 0.5 * (io[0] + io[1]) * this.wet;
    this.hp = flush(this.hpk * (this.hp + input - this.prev)); this.prev = input;
    let d = this.hp;
    for (const st of this.dif) { const dl = st.d.read(st.fr), out = dl - st.g * d; st.d.push(d + st.g * out); d = out; }
    for (let i = 0; i < 4; i++) { this.tl[i] = this.L[i].d.read(this.L[i].fr); this.tr[i] = this.R[i].d.read(this.R[i].fr); }
    const ll = this.branch(this.L, this.tl, this.tr, d), lr = this.branch(this.R, this.tr, this.tl, d);
    io[0] += this.late * ll; io[1] += this.late * lr;
  }
  clear() { this.wet = 0; this.hp = 0; this.prev = 0; for (const s of this.dif) s.d.clear(); for (const l of this.L) { l.d.clear(); l.damp = 0; } for (const l of this.R) { l.d.clear(); l.damp = 0; } }
}

export class MfxBank {
  constructor(sr) {
    this.sr = Math.max(1, sr); this.bpm = 120; this.lph = 0;
    this.crusher = new Crusher(); this.p = [null, new Flanger(this.sr), new Phaser(), new Filter(), new Filter(), new Delay(this.sr), new Reverb(this.sr), new Panner(this.sr), new Ring(), new Vowel()];
    this.run = new Uint8Array(10); this.idle = new Float64Array(10); this.quiet = new Float64Array(10); this.io = new Float64Array(2);
    const q = Math.trunc(0.25 * this.sr), s = Math.trunc(this.sr);
    this.skip = [0, q, q, s, s, Infinity, Infinity, s, q, q]; this.tail = [0, 0, 0, 0, 0, Math.trunc(1.5 * this.sr), q, 0, 0, 0];
  }
  // the controls for a block of `frames` frames starting at song beat startBeat (negative: the LFO runs on from its stored phase)
  prepare(x0, y, rateBeats, amount, shape, bpm, startBeat, frames) {
    this.bpm = bpm;
    const phase = startBeat >= 0 ? frac(startBeat / rateBeats) : this.lph, step = bpm >= 1 ? frames * bpm / (this.sr * 60 * rateBeats) : 0;
    this.lph = frac(phase + step);
    const lfo = amount * mfxLfo(shape, phase, step), x = clamp(x0 + lfo, 0, 1), sr = this.sr, p = this.p, res = 1 + 2 * y * y;
    p[MFX_DELAY].configure(x0, y, rateBeats, amount, shape, bpm, startBeat);
    p[MFX_REVERB].refresh(x0, y);
    p[MFX_LPF].set(Math.pow(2, 6 + 8.28 * x), res, sr, false); p[MFX_HPF].set(Math.pow(2, 5 + 7.424 * x), res, sr, true);
    this.crusher.set(x0, y, lfo); p[MFX_PHASER].set(x0, y, lfo, sr); p[MFX_FLANGER].set(x0, y, lfo); p[MFX_PANNER].set(x0, y, lfo); p[MFX_RING].set(x0, lfo, sr); p[MFX_VOX].set(x0, y, lfo, sr);
  }
  // one frame through the bank with kind `sel` enabled (-1: every running processor winds down); io = [L, R] in place
  frame(io, sel) {
    if (this.bpm < 1) return;
    if (sel === MFX_DIST) this.crusher.run(io);
    for (let k = 1; k < 10; k++) {
      const on = sel === k;
      if (!on && !this.run[k]) continue;
      this.run[k] = 1;
      const pr = this.p[k], il = io[0], ir = io[1], target = on ? 1 : 0;
      this.idle[k] = Math.abs(il) > SILENT || Math.abs(ir) > SILENT ? 0 : this.idle[k] + 1;
      if (this.idle[k] > this.skip[k]) pr.wet = target; else pr.run(io, target);
      this.quiet[k] = Math.abs(io[0] - il) > SILENT || Math.abs(io[1] - ir) > SILENT ? 0 : this.quiet[k] + 1;
      if (!on && pr.wet < SILENT && this.quiet[k] >= this.tail[k]) { pr.clear(); this.run[k] = 0; this.idle[k] = 0; this.quiet[k] = 0; }
    }
  }
  // still producing sound: a processor that had input within its skip time (at most 1 s) or whose output differed from its input within
  // its tail (at least 0.25 s)
  busy() { const q = this.tail[MFX_REVERB]; for (let k = 1; k < 10; k++) if (this.run[k] && (this.idle[k] <= Math.min(this.skip[k], this.skip[MFX_LPF]) || this.quiet[k] < Math.max(this.tail[k], q))) return true; return false; }
  // clears every processor; the LFO phases stay
  reset() { this.crusher.clear(); for (let k = 1; k < 10; k++) this.p[k].clear(); this.run.fill(0); this.idle.fill(0); this.quiet.fill(0); }
}
