// Tape Stop (device 52): FL Studio Mobile style tape stop / start. Play = 1 runs the audio through; switching Play to 0 slows the "tape"
// down to a halt (pitch and speed fall together) over the Stop Time, Play back to 1 spins it up again over the Start Time and then crossfades
// to the live input. Times in seconds or tempo values (Sync), Warp bends the speed curve (0.5 = linear, lower = falls fast then slow).
// Play is meant to be automated (FLM "Toggle Play"). Own implementation (ring buffer read at a varying speed, cubic interpolation).
// Interface as in fx.js: setParam(i, v), process(L, R, n) in place, readOut(out), bypass; setTempo(bpm).
import { clamp } from './dsp.js';

export const TS_BEATS = ['1/8', '1/4', '1/2', '1 beat', '2 beats', '4 beats'];
const TS_B = [0.125, 0.25, 0.5, 1, 2, 4];
const LIVE = 0, STOPPING = 1, STOPPED = 2, STARTING = 3, REJOIN = 4, XF = 512;

export class TapeStop {
  constructor(sr) {
    this.sr = sr; this.bypass = false; this.bpm = 120;
    this.p = [1, 1, 0.5, 3, 0.5, 2, 0.5];
    this.n = Math.ceil(sr * 10); this.bl = new Float32Array(this.n); this.br = new Float32Array(this.n); this.w = 0;
    this.st = LIVE; this.rp = 0; this.x = 0; this.speed = 1; this.xf = 0;
  }
  setTempo(b) { this.bpm = clamp(b, 20, 400); }
  setParam(i, v) {
    const was = this.p[0] > 0.5; this.p[i] = v;
    if (i !== 0) return;
    const play = v > 0.5;
    if (play === was) return;
    const k = this.curveK();
    if (!play) {                                                                  // stop: from live, or reverse a spin-up in progress
      if (this.st === LIVE || this.st === REJOIN) { this.rp = this.w - 1; if (this.rp < 0) this.rp += this.n; this.x = 0; }
      else if (this.st === STARTING) this.x = 1 - Math.pow(this.speed, 1 / k);
      this.st = STOPPING;
    } else {                                                                      // start: from silence, or reverse a slow-down
      if (this.st === STOPPED) { this.rp = this.w - 1; if (this.rp < 0) this.rp += this.n; this.x = 0; }
      else if (this.st === STOPPING) this.x = Math.pow(this.speed, 1 / k);
      this.st = STARTING;
    }
  }
  curveK() { return Math.pow(2, (0.5 - clamp(this.p[6], 0, 1)) * 4); }
  timeOf(sec, beatsIdx) { const s = this.p[1] > 0.5 ? TS_B[clamp(Math.round(beatsIdx), 0, TS_B.length - 1)] * 60 / this.bpm : sec; return Math.max(1, clamp(s, 0.005, 8) * this.sr); }
  rd(b, pos) {
    const n = this.n, i = Math.floor(pos), f = pos - i, i0 = (i - 1 + n) % n, i1 = i % n, i2 = (i + 1) % n, i3 = (i + 2) % n;
    const a = b[i0], c = b[i1], d = b[i2], e = b[i3];
    return c + 0.5 * f * (d - a + f * (2 * a - 5 * c + 4 * d - e + f * (3 * (c - d) + e - a)));
  }
  process(L, R, n) {
    const bl = this.bl, br = this.br, N = this.n, k = this.curveK();
    const tStop = this.timeOf(this.p[4], this.p[5]), tStart = this.timeOf(this.p[2], this.p[3]);
    for (let i = 0; i < n; i++) {
      const xl = L[i], xr = R[i];
      bl[this.w] = xl; br[this.w] = xr; if (++this.w >= N) this.w = 0;
      switch (this.st) {
        case LIVE: break;
        case STOPPING: {
          this.speed = Math.pow(Math.max(0, 1 - this.x), k); this.x += 1 / tStop;
          L[i] = this.rd(bl, this.rp) * Math.min(1, this.speed * 8); R[i] = this.rd(br, this.rp) * Math.min(1, this.speed * 8);
          this.rp += this.speed; if (this.rp >= N) this.rp -= N;
          if (this.x >= 1) { this.st = STOPPED; this.speed = 0; }
          break;
        }
        case STOPPED: L[i] = 0; R[i] = 0; break;
        case STARTING: {
          this.speed = Math.pow(Math.min(1, this.x), k); this.x += 1 / tStart;
          L[i] = this.rd(bl, this.rp) * Math.min(1, this.speed * 8); R[i] = this.rd(br, this.rp) * Math.min(1, this.speed * 8);
          this.rp += this.speed; if (this.rp >= N) this.rp -= N;
          if (this.x >= 1) { this.st = REJOIN; this.xf = 0; this.speed = 1; }
          break;
        }
        case REJOIN: {                                                            // back on speed: crossfade from the lagging tape to the live input
          const g = this.xf / XF; L[i] = this.rd(bl, this.rp) * (1 - g) + xl * g; R[i] = this.rd(br, this.rp) * (1 - g) + xr * g;
          this.rp += 1; if (this.rp >= N) this.rp -= N;
          if (++this.xf >= XF) this.st = LIVE;
          break;
        }
        default: break;
      }
    }
  }
  readOut(o) { o[0] = this.st; o[1] = this.st === LIVE || this.st === REJOIN ? 1 : this.speed; return 2; }
}
