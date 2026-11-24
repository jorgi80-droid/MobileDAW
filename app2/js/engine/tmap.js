// Tempo map: piecewise-linear BPM curve over ticks (like Ableton's tempo automation). Pure maths, no DOM, safe in the AudioWorklet.
// pts = flat [tick0, bpm0, tick1, bpm1, ...] sorted by tick. Before the first point the first BPM holds, after the last point the last BPM holds.
// Two points on the same tick make a jump. Between points the BPM changes linearly with the tick, so the time integral is closed-form (no stepping error).
const K = 60 / 960;                      // seconds per tick at 1 BPM x ... (sec = ticks * K / bpm)

export class TempoMap {
  constructor() { this.n = 0; this.t = new Float64Array(0); this.b = new Float64Array(0); this.s = new Float64Array(0); }

  set(flat) {
    const n = Math.floor((flat ? flat.length : 0) / 2);
    const t = new Float64Array(n), b = new Float64Array(n), s = new Float64Array(n);
    for (let i = 0; i < n; i++) { t[i] = Math.max(0, +flat[i * 2] || 0); b[i] = Math.min(300, Math.max(20, +flat[i * 2 + 1] || 120)); }
    for (let i = 1; i < n; i++) s[i] = s[i - 1] + this.seg(t[i] - t[i - 1], b[i - 1], b[i]);
    this.n = n; this.t = t; this.b = b; this.s = s;
  }

  // seconds spent across dt ticks while the BPM goes linearly from b0 to b1
  seg(dt, b0, b1) { if (dt <= 0) return 0; return Math.abs(b1 - b0) < 1e-9 ? dt * K / b0 : dt * K * Math.log(b1 / b0) / (b1 - b0); }

  // index of the last point with tick <= x (or -1)
  idxT(x) { let a = 0, b = this.n; while (a < b) { const m = (a + b) >> 1; if (this.t[m] <= x) a = m + 1; else b = m; } return a - 1; }
  idxS(x) { let a = 0, b = this.n; while (a < b) { const m = (a + b) >> 1; if (this.s[m] <= x) a = m + 1; else b = m; } return a - 1; }

  bpmAt(tick) {
    const n = this.n; if (!n) return 120;
    const i = this.idxT(tick);
    if (i < 0) return this.b[0];
    if (i >= n - 1) return this.b[n - 1];
    const dt = this.t[i + 1] - this.t[i];
    return dt <= 0 ? this.b[i + 1] : this.b[i] + (this.b[i + 1] - this.b[i]) * (tick - this.t[i]) / dt;
  }

  tickToSec(tick) {
    const n = this.n; if (!n) return tick * K / 120;
    if (tick <= this.t[0]) return tick * K / this.b[0];
    const i = this.idxT(tick);
    if (i >= n - 1) return this.s[n - 1] + (tick - this.t[n - 1]) * K / this.b[n - 1] + this.off();
    return this.s[i] + this.off() + this.seg(tick - this.t[i], this.b[i], this.bpmAt(tick));
  }
  // time before the first point is spent at b[0]; stored cumulative seconds start at the first point
  off() { return this.n ? this.t[0] * K / this.b[0] : 0; }

  secToTick(sec) {
    const n = this.n; if (!n) return sec * 120 / K;
    const o = this.off();
    if (sec <= o) return sec * this.b[0] / K;
    const x = sec - o, i = this.idxS(x);
    if (i >= n - 1) return this.t[n - 1] + (x - this.s[n - 1]) * this.b[n - 1] / K;
    const b0 = this.b[i], b1 = this.b[i + 1], dt = this.t[i + 1] - this.t[i], r = x - this.s[i];
    if (dt <= 0) return this.t[i];
    if (Math.abs(b1 - b0) < 1e-9) return this.t[i] + r * b0 / K;
    const k = (b1 - b0) / dt;                      // BPM per tick
    return this.t[i] + (b0 * Math.exp(r * k / K) - b0) / k;
  }
}
