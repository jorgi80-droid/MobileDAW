// Granulator III (Live 12): granular playback of one sample (zone 0 of the zone system, parameter 200 = sample id). Modes: Classic (a playhead
// starts at Position and moves at Scan speed, grains follow it), Loop (the playhead loops Position .. Position + Loop Length) and Cloud
// (grains at random times, Density per second, around Position). Every grain: Grain Size, window Shape (round .. sharp), Spray (random
// position), Pitch Spread, played at the note's pitch (root C3) + Transpose. Amp envelope Attack / Release, Volume < Velocity, Volume.
// Parameter indices: 0 Mode, 1 Position, 2 Scan, 3 Grain Size, 4 Shape, 5 Spray, 6 Density, 7 Loop Length, 8 Pitch Spread, 9 Transpose,
// 10 Attack, 11 Release, 12 Vol < Vel, 13 Volume.
import { TWO_PI, clamp, lcg } from './dsp.js';

const dbl = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));
const rnd = (o) => lcg(o) / 4294967296;
const G_MAX = 16;

export class Granulator {
  constructor(sr, bank) { this.sr = sr; this.bank = bank; this.p = new Array(14).fill(0); this.id = -1; this.rng = { seed: 3303 }; this.v = []; }
  setTempo() {}
  setParam(i, x) { if (i >= 200) { if (i === 200) this.id = x | 0; return; } this.p[i] = x; }
  smp() { const s = this.id >= 0 ? this.bank[this.id] : null; return s && s.frames > 64 ? s : null; }
  active() { return this.v.length > 0; }
  noteOn(pitch, vel) {
    if (!this.smp()) return; if (this.v.length >= 8) this.v.shift();
    this.v.push({ pitch, vel, held: true, env: 0, head: this.p[1], next: 0, g: [], t: 0, rate: Math.pow(2, (pitch - 60 + this.p[9]) / 12) });
  }
  noteOff(pitch) { for (const v of this.v) if (v.pitch === pitch) v.held = false; }
  allOff() { for (const v of this.v) v.held = false; }
  spawn(v, s) {
    const p = this.p, n = s.frames, len = Math.max(8, Math.round(p[3] / 1000 * this.sr)), sp = (rnd(this.rng) * 2 - 1) * p[5] * 0.25;
    const pos = clamp(v.head + sp, 0, 1) * (n - 1), r = v.rate * Math.pow(2, (rnd(this.rng) * 2 - 1) * p[8] / 12);
    if (v.g.length >= G_MAX) v.g.shift();
    v.g.push({ pos, r, i: 0, len, pan: (rnd(this.rng) * 2 - 1) * p[5] * 0.6 });
  }
  render(L, R, from, to) {
    const s = this.smp(); if (!s) { this.v.length = 0; return; }
    const p = this.p, sr = this.sr, dt = 1 / sr, mode = Math.round(p[0]), n = s.frames, vol = dbl(p[13]);
    const att = Math.max(0.001, p[10] / 1000), rel = Math.exp(-dt * 6.91 / Math.max(0.005, p[11] / 1000)), sharp = 1 + p[4] * 6;
    const gap = mode === 2 ? sr / Math.max(1, p[6]) : Math.max(8, Math.round(p[3] / 1000 * sr * 0.5));   // Classic / Loop: grains overlap by half
    for (let j = this.v.length - 1; j >= 0; j--) {
      const v = this.v[j], g0 = (1 - p[12] * (1 - v.vel)) * vol;
      for (let i = from; i < to; i++) {
        if (v.held) v.env = Math.min(1, v.env + dt / att); else v.env *= rel;
        if (mode !== 2) { v.head += p[2] / n;   // Scan: 1 x = the sample's own speed
          if (mode === 1) { const a = p[1], b = Math.min(1, p[1] + 0.02 + p[7] * 0.5); if (v.head > b) v.head = a; if (v.head < a) v.head = b; } else v.head = clamp(v.head, 0, 1); }
        if (--v.next <= 0) { this.spawn(v, s); v.next = mode === 2 ? gap * (0.5 + rnd(this.rng)) : gap; }
        let l = 0, r = 0;
        for (let k = v.g.length - 1; k >= 0; k--) {
          const g = v.g[k], u = g.i / g.len, w = Math.pow(0.5 - 0.5 * Math.cos(TWO_PI * u), sharp), rp = g.pos + g.i * g.r, ip = rp | 0;
          if (u >= 1 || ip >= n - 1 || ip < 0) { v.g.splice(k, 1); continue; }
          const x = (s.l[ip] + (s.l[ip + 1] - s.l[ip]) * (rp - ip)) * w; l += x * (1 - g.pan); r += x * (1 + g.pan); g.i++;
        }
        const e = v.env * g0 * 0.7; L[i] += l * e; R[i] += r * e;
      }
      v.t += (to - from) * dt;
      if (!v.held && v.env < 1e-4) this.v.splice(j, 1);
    }
  }
}
