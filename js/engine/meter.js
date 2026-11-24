// Meter map: time signature changes along the song. Pure maths, no DOM, safe in the AudioWorklet.
// flat = [startBar, n, d, startBar, n, d, ...]  (startBar is 0-based, sorted; the first entry always starts at bar 0, the last one lasts forever)
// Segment j: starts at bar b[j] / tick T[j], has beat length bt[j] = PPQ*4/d ticks and bar length bl[j] = bt[j]*n ticks.
const PPQ = 960;

export class MeterMap {
  constructor() { this.set([0, 4, 4]); }

  set(flat) {
    const src = [];
    for (let i = 0; i + 2 < (flat ? flat.length : 0); i += 3) {
      const b = Math.max(0, Math.round(+flat[i]) || 0), n = Math.max(1, Math.min(32, Math.round(+flat[i + 1]) || 4)), d = [1, 2, 4, 8, 16].includes(+flat[i + 2]) ? +flat[i + 2] : 4;
      src.push([b, n, d]);
    }
    src.sort((x, y) => x[0] - y[0]);
    if (!src.length || src[0][0] !== 0) src.unshift([0, 4, 4]);
    const seg = [];
    for (const s of src) { if (seg.length && seg[seg.length - 1][0] === s[0]) seg[seg.length - 1] = s; else seg.push(s); }
    const m = seg.length;
    this.m = m; this.b = new Int32Array(m); this.n = new Int32Array(m); this.d = new Int32Array(m);
    this.bt = new Float64Array(m); this.bl = new Float64Array(m); this.T = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      this.b[j] = seg[j][0]; this.n[j] = seg[j][1]; this.d[j] = seg[j][2];
      this.bt[j] = Math.round(PPQ * 4 / seg[j][2]); this.bl[j] = this.bt[j] * seg[j][1];
      this.T[j] = j === 0 ? 0 : this.T[j - 1] + (this.b[j] - this.b[j - 1]) * this.bl[j - 1];
    }
  }

  segOfTick(t) { let j = this.m - 1; while (j > 0 && this.T[j] > t) j--; return j; }
  segOfBar(k) { let j = this.m - 1; while (j > 0 && this.b[j] > k) j--; return j; }

  barLenAt(t) { return this.bl[this.segOfTick(t)]; }
  beatLenAt(t) { return this.bt[this.segOfTick(t)]; }
  nAt(t) { return this.n[this.segOfTick(t)]; }
  dAt(t) { return this.d[this.segOfTick(t)]; }
  // tick where bar k (0-based) starts
  barStart(k) { if (k < 0) return k * this.bl[0]; const j = this.segOfBar(k); return this.T[j] + (k - this.b[j]) * this.bl[j]; }
  // 0-based bar index containing tick t (fractional ticks floor down)
  barAt(t) { if (t < 0) return Math.floor(t / this.bl[0]); const j = this.segOfTick(t); return this.b[j] + Math.floor((t - this.T[j]) / this.bl[j] + 1e-9); }
  barFloor(t) { return this.barStart(this.barAt(t)); }
  barCeil(t) { const k = this.barAt(t), s = this.barStart(k); return s >= t - 1e-6 ? s : this.barStart(k + 1); }
  barRound(t) { const a = this.barFloor(t), c = this.barCeil(t); return t - a < c - t ? a : c; }
  // tick of the first beat at or after t
  beatCeil(t) {
    const j = this.segOfTick(t); let x = this.T[j] + Math.ceil((t - this.T[j]) / this.bt[j] - 1e-9) * this.bt[j];
    if (j + 1 < this.m && x >= this.T[j + 1]) x = this.T[j + 1];
    return x;
  }
  nextBeat(t) { return this.beatCeil(t + 1e-3 + 0.5); }
  isDownbeat(t) { const j = this.segOfTick(t + 1e-6), r = (t - this.T[j]) % this.bl[j]; return r < 1e-3 || this.bl[j] - r < 1e-3; }
  // beat grid helpers for the UI: snap to the nearest beat
  beatRound(t) { const a = this.beatFloor(t), c = this.beatCeil(t); return t - a < c - t ? a : c; }
  beatFloor(t) { const j = this.segOfTick(t); return this.T[j] + Math.floor((t - this.T[j]) / this.bt[j] + 1e-9) * this.bt[j]; }
  // signature that starts exactly at bar k, or null
  changeAt(k) { for (let j = 0; j < this.m; j++) if (this.b[j] === k) return { n: this.n[j], d: this.d[j] }; return null; }
}
