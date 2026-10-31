// Impulse (Live 12): eight sample slots played by C3..G3 (notes 60..67), one voice per slot (a new hit restarts it). Each slot: Start,
// Transp, Stretch (two-grain time stretch, pitch kept), Drive (with Sat on), filter (on, Freq, Res), Decay in Trigger or Gate mode, Pan,
// Volume, Volume < Velocity. Global Volume, Time (scales every decay) and Transp. Slot k's sample is zone k of the zone system
// (parameter 200 + k * 16 = sample id). Parameter indices: 0 Volume, 1 Time, 2 Transp, 3..91 unused, slot k field f = 92 + k * 13 + f.
import { TWO_PI, clamp } from './dsp.js';

export const IMP_S0 = 92, IMP_N = 13, IMP_Z0 = 200;
const dbl = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));
const GR = 0.04;                                            // grain length (s) of the stretch

export class Impulse {
  constructor(sr, bank) {
    this.sr = sr; this.bank = bank; this.p = new Array(IMP_S0 + 8 * IMP_N).fill(0); this.ids = new Array(8).fill(-1);
    this.v = Array.from({ length: 8 }, () => ({ on: false, held: false }));
  }
  setTempo() {}
  setParam(i, x) { if (i >= IMP_Z0) { const k = (i - IMP_Z0) >> 4, f = (i - IMP_Z0) & 15; if (k < 8 && f === 0) this.ids[k] = x | 0; return; } this.p[i] = x; }
  q(k, f) { return this.p[IMP_S0 + k * IMP_N + f]; }
  smp(k) { const s = this.ids[k] >= 0 ? this.bank[this.ids[k]] : null; return s && s.frames > 4 ? s : null; }
  active() { return this.v.some((v) => v.on); }
  noteOn(p, vel) {
    const k = p - 60; if (k < 0 || k > 7) return; const s = this.smp(k); if (!s) return;
    const v = this.v[k], st = Math.floor(clamp(this.q(k, 0), 0, 0.99) * s.frames);
    Object.assign(v, { on: true, held: true, vel, t: 0, pos: st, tpos: st, gp: 0, env: 1, a: 0, b: 0, fade: v.on ? 0 : 1 });
  }
  noteOff(p) { const k = p - 60; if (k >= 0 && k < 8) this.v[k].held = false; }
  render(L, R, from, to) {
    const gv = dbl(this.p[0]), time = Math.pow(2, this.p[1] * 3), sr = this.sr, dt = 1 / sr;
    for (let k = 0; k < 8; k++) {
      const v = this.v[k]; if (!v.on) continue; const s = this.smp(k); if (!s) { v.on = false; continue; }
      const q = (f) => this.q(k, f), rate = Math.pow(2, (q(1) + this.p[2]) / 12), str = q(2), speed = rate * Math.pow(2, -str * 2), drive = q(3), sat = q(4) > 0.5, filt = q(5) > 0.5;
      const dec = Math.max(0.005, q(8) * time), gate = Math.round(q(9)) === 1, pan = q(10), vol = dbl(q(11)) * (1 - q(12) * (1 - v.vel)) * gv;
      const pl = Math.min(1, 1 - pan), pr = Math.min(1, 1 + pan), kd = Math.exp(-dt * 6.91 / dec);
      let g = 0, kk = 0, inv = 1; if (filt) { g = Math.tan(Math.PI * clamp(q(6), 20, sr * 0.45) / sr); kk = 1 / q(7); inv = 1 / (1 + g * (g + kk)); }
      const glen = GR * sr, n = s.frames;
      for (let i = from; i < to; i++) {
        let x;
        if (Math.abs(str) < 0.005) { const ip = v.pos | 0; if (ip >= n - 1) { v.on = false; break; } const fr = v.pos - ip; x = s.l[ip] + (s.l[ip + 1] - s.l[ip]) * fr; v.pos += rate; }
        else {                                                         // stretch: two grains half a grain apart read at the pitch rate, their start follows the slower / faster time position
          if (v.tpos >= n - 1) { v.on = false; break; }
          x = 0; for (let c = 0; c < 2; c++) { const ph = ((v.gp / glen) + c * 0.5) % 1, start = v.tpos - ph * glen * speed, rp = start + ph * glen * rate, ip = Math.floor(rp);
            if (ip >= 0 && ip < n - 1) x += (s.l[ip] + (s.l[ip + 1] - s.l[ip]) * (rp - ip)) * (0.5 - 0.5 * Math.cos(TWO_PI * ph)); }
          v.gp++; v.tpos += speed;
        }
        if (sat) x = Math.tanh(x * (1 + drive * 12)) / Math.tanh(1 + drive * 12);
        if (filt) { const h = (x - (kk + g) * v.a - v.b) * inv, bp = g * h + v.a, lp = g * bp + v.b; v.a = g * h + bp; v.b = g * bp + lp; x = lp; }
        if (!gate || !v.held) v.env *= kd;
        if (v.fade < 1) v.fade = Math.min(1, v.fade + dt / 0.003);
        x *= v.env * vol * v.fade; L[i] += x * pl; R[i] += x * pr;
        if (v.env < 1e-4) { v.on = false; break; }
      }
    }
  }
}
