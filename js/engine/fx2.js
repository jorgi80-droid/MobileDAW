// Auto Filter, Echo and Roar (replace Filter, Delay and Distortion). Same Fx interface as fx.js: setParam(i, v), process(L, R, n), readOut(out).
import { TWO_PI, clamp, dbToLin, linToDb, Biquad, fastTanh } from './dsp.js';

const tanh = fastTanh;
class Fx { constructor(sr, sc) { this.sr = sr; this.sc = sc; this.bypass = false; } readOut() { return 0; } }

// ---- Auto Filter ---------------------------------------------------------------------------------------------------
// 0 type (0 LP, 1 HP, 2 BP, 3 Notch), 1 freq, 2 res (Q), 3 slope (0 = 12 dB, 1 = 24 dB), 4 env amount (-1..1), 5 env attack ms, 6 env release ms,
// 7 LFO amount, 8 LFO rate Hz, 9 LFO shape (0 sine, 1 tri, 2 saw, 3 square, 4 S&H)
// readOut: 0 current cutoff Hz, 1 envelope 0..1, 2 LFO -1..1
export class AutoFilter extends Fx {
  constructor(sr) {
    super(sr); this.type = 0; this.f = 20000; this.q = 0.707; this.slope = 0; this.envAmt = 0; this.atk = 6; this.rel = 200; this.lfoAmt = 0; this.rate = 1; this.shape = 0;
    this.b = [[new Biquad(), new Biquad()], [new Biquad(), new Biquad()]];     // [stage][channel]
    this.env = 0; this.ph = 0; this.sh = 0; this.lfo = 0; this.cur = -99; this.fc = 20000; this.dirty = true; this.cnt = 0; this.envN = 0; this.upA(); this.upR();
  }
  upA() { this.aC = Math.exp(-1 / (Math.max(0.1, this.atk) * 0.001 * this.sr)); }
  upR() { this.rC = Math.exp(-1 / (Math.max(1, this.rel) * 0.001 * this.sr)); }
  setParam(i, v) {
    switch (i) {
      case 0: this.type = Math.round(clamp(v, 0, 3)); break; case 1: this.f = clamp(v, 20, 20000); break; case 2: this.q = clamp(v, 0.3, 12); break;
      case 3: this.slope = v > 0.5 ? 1 : 0; break; case 4: this.envAmt = clamp(v, -1, 1); break; case 5: this.atk = v; this.upA(); break; case 6: this.rel = v; this.upR(); break;
      case 7: this.lfoAmt = clamp(v, 0, 1); break; case 8: this.rate = clamp(v, 0.05, 20); break; case 9: this.shape = Math.round(clamp(v, 0, 4)); break;
    }
    this.dirty = true;
  }
  coef(f) {
    const s = this.sr, q = this.slope ? this.q * 0.8 : this.q, a = this.b[0][0];
    if (this.type === 0) a.lowpass(s, f, q); else if (this.type === 1) a.highpass(s, f, q); else if (this.type === 2) a.bandpass(s, f, q); else a.notch(s, f, q);
    this.b[0][1].copy(a); this.b[1][0].copy(a); this.b[1][1].copy(a);
  }
  process(L, R, n) {
    const moving = this.envAmt !== 0 || this.lfoAmt > 0, aC = this.aC, rC = this.rC, inc = this.rate / this.sr, s0 = this.b[0], s1 = this.b[1], two = this.slope === 1;
    let env = this.env;
    for (let i = 0; i < n; i++) {
      const a = L[i] < 0 ? -L[i] : L[i], b = R[i] < 0 ? -R[i] : R[i], x = a > b ? a : b;
      env = x > env ? aC * env + (1 - aC) * x : rC * env + (1 - rC) * x;
      if ((this.cnt++ & 15) === 0 && (moving || this.dirty)) {
        this.ph += inc * 16; if (this.ph >= 1) { this.ph -= 1; this.sh = Math.random() * 2 - 1; }
        const p = this.ph; let l;
        switch (this.shape) { case 0: l = Math.sin(TWO_PI * p); break; case 1: l = 4 * Math.abs(p - Math.floor(p + 0.5)) - 1; l = -l; break; case 2: l = 1 - 2 * p; break; case 3: l = p < 0.5 ? 1 : -1; break; default: l = this.sh; }
        this.lfo = l;
        const envN = clamp((linToDb(env) + 48) / 48, 0, 1); this.envN = envN;
        const oct = this.envAmt * 4 * envN + this.lfoAmt * 3 * l, f = clamp(this.f * Math.pow(2, oct), 20, 20000);
        if (this.dirty || Math.abs(oct - this.cur) > 0.003) { this.cur = oct; this.fc = f; this.coef(f); this.dirty = false; }
      }
      let l = s0[0].process(L[i]), r = s0[1].process(R[i]);
      if (two) { l = s1[0].process(l); r = s1[1].process(r); }
      L[i] = l; R[i] = r;
    }
    this.env = env;
  }
  readOut(o) { o[0] = this.fc; o[1] = this.envN; o[2] = this.lfo; return 3; }
}

// ---- Echo ----------------------------------------------------------------------------------------------------------
// 0 time L ms, 1 feedback, 2 dry/wet, 3 ping-pong, 4 LP Hz, 5 HP Hz, 6 time R ms, 7 link L/R, 8 sync, 9 div L, 10 div R, 11 reverb, 12 stereo (width),
// 13 input dB, 14 output dB, 15 mod rate Hz, 16 mod amount, 17 character (feedback drive)
const DIV = [0.25, 0.5, 1, 2, 4, 1 / 6, 1 / 3, 2 / 3];          // beats: 1/16, 1/8, 1/4, 1/2, 1 bar, 1/16T, 1/8T, 1/4T
export class Echo extends Fx {
  constructor(sr) {
    super(sr); this.len = Math.floor(sr * 2.3); this.d = [new Float32Array(this.len), new Float32Array(this.len)]; this.w = 0;
    this.tL = 350; this.tR = 350; this.fb = 0.35; this.mix = 0.25; this.pp = 0; this.link = 1; this.sync = 0; this.dL = 2; this.dR = 1; this.rev = 0; this.width = 1;
    this.inG = 1; this.outG = 1; this.mRate = 0.5; this.mAmt = 0; this.chr = 0; this.bpm = 120; this.ph = 0;
    this.hp = [new Biquad(), new Biquad()]; this.lp = [new Biquad(), new Biquad()]; this.fLP = 6000; this.fHP = 20; this.upF();
    this.cl = [0, 0]; this.cr = [0, 0]; this.curL = 350 * sr / 1000; this.curR = this.curL;
    const at = [142, 107, 379, 277], s = sr / 44100; this.al = at.map((t) => Math.floor(t * s) | 1); this.ab = this.al.map((n) => new Float32Array(n)); this.ai = [0, 0, 0, 0]; this.az = [0, 0];
  }
  setTempo(b) { this.bpm = b; }
  upF() { this.lp[0].lowpass(this.sr, this.fLP, 0.707); this.lp[1].copy(this.lp[0]); this.hp[0].highpass(this.sr, this.fHP, 0.707); this.hp[1].copy(this.hp[0]); }
  setParam(i, v) {
    switch (i) {
      case 0: this.tL = clamp(v, 1, 2000); break; case 1: this.fb = clamp(v, 0, 0.98); break; case 2: this.mix = clamp(v, 0, 1); break; case 3: this.pp = v > 0.5 ? 1 : 0; break;
      case 4: this.fLP = clamp(v, 200, 20000); this.upF(); break; case 5: this.fHP = clamp(v, 20, 2000); this.upF(); break; case 6: this.tR = clamp(v, 1, 2000); break;
      case 7: this.link = v > 0.5 ? 1 : 0; break; case 8: this.sync = v > 0.5 ? 1 : 0; break; case 9: this.dL = Math.round(clamp(v, 0, 7)); break; case 10: this.dR = Math.round(clamp(v, 0, 7)); break;
      case 11: this.rev = clamp(v, 0, 1); break; case 12: this.width = clamp(v, 0, 1); break; case 13: this.inG = dbToLin(clamp(v, -24, 24)); break; case 14: this.outG = dbToLin(clamp(v, -24, 12)); break;
      case 15: this.mRate = clamp(v, 0.1, 10); break; case 16: this.mAmt = clamp(v, 0, 1); break; case 17: this.chr = clamp(v, 0, 1); break;
    }
  }
  process(L, R, n) {
    const sr = this.sr, len = this.len, spb = 60000 / this.bpm;
    const msL = this.sync ? DIV[this.dL] * spb : this.tL, msR = this.link ? msL : (this.sync ? DIV[this.dR] * spb : this.tR);
    const tl = clamp(msL * sr / 1000, 8, len - 600), tr = clamp(msR * sr / 1000, 8, len - 600), mod = this.mAmt * 0.004 * sr, minc = this.mRate / sr, smooth = 0.0006;
    const fb = this.fb, mix = this.mix, pp = this.pp, dr = 1 + this.chr * 3, dn = 1 / tanh(dr), wd = this.width, rev = this.rev, inG = this.inG, outG = this.outG;
    const hp = this.hp, lp = this.lp, dl = this.d;
    for (let i = 0; i < n; i++) {
      this.curL += (tl - this.curL) * smooth; this.curR += (tr - this.curR) * smooth;
      this.ph += minc; if (this.ph >= 1) this.ph -= 1;
      const m = mod ? Math.sin(TWO_PI * this.ph) * mod : 0;
      const xl = L[i] * inG, xr = R[i] * inG, d0 = dl[0], d1 = dl[1];   // no per-sample arrays: they made ~25 KB of garbage per block (GC spikes)
      let rp = this.w - (this.curL + m); while (rp < 0) rp += len;
      let i0 = rp | 0, f = rp - i0, i1 = i0 + 1 >= len ? 0 : i0 + 1; const y0 = d0[i0] * (1 - f) + d0[i1] * f;
      rp = this.w - (this.curR - m); while (rp < 0) rp += len;
      i0 = rp | 0; f = rp - i0; i1 = i0 + 1 >= len ? 0 : i0 + 1; const y1 = d1[i0] * (1 - f) + d1[i1] * f;
      let fl = lp[0].process(hp[0].process(y0)), fr = lp[1].process(hp[1].process(y1));
      if (this.chr > 0) { fl = tanh(fl * dr) * dn; fr = tanh(fr * dr) * dn; }
      dl[0][this.w] = pp ? xl + fr * fb : xl + fl * fb;
      dl[1][this.w] = pp ? fl * fb : xr + fr * fb;
      if (++this.w >= len) this.w = 0;
      let wl = fl, wr = fr;
      if (rev > 0.001) {                                  // four all-pass stages smear the repeats into a small room
        let x = (wl + wr) * 0.5;
        for (let k = 0; k < 4; k++) { const b = this.ab[k], j = this.ai[k], z = b[j], o = z - 0.6 * x; b[j] = x + 0.6 * o; x = o; if (++this.ai[k] >= this.al[k]) this.ai[k] = 0; }
        wl += x * rev * 1.5; wr -= x * rev * 1.5;
      }
      const mm = (wl + wr) * 0.5, ss = (wl - wr) * 0.5 * wd; wl = mm + ss; wr = mm - ss;
      L[i] = (L[i] * (1 - mix) + wl * mix) * outG; R[i] = (R[i] * (1 - mix) + wr * mix) * outG;
    }
  }
}

// ---- Roar ----------------------------------------------------------------------------------------------------------
// 0 shape (0 soft, 1 hard, 2 fold, 3 sine, 4 bit, 5 noise), 1 drive dB, 2 tone Hz, 3 dry/wet, 4 output dB, 5 bias, 6 shaper amount, 7 feedback amount,
// 8 feedback time ms, 9 feedback freq Hz, 10 compress
export class Roar extends Fx {
  constructor(sr) {
    super(sr); this.shape = 0; this.drive = dbToLin(12); this.tone = 12000; this.mix = 1; this.out = dbToLin(-6); this.bias = 0; this.amt = 1; this.fbA = 0; this.fbT = 10; this.fbF = 20000; this.comp = 0;
    this.tl = [new Biquad(), new Biquad()]; this.fl = [new Biquad(), new Biquad()]; this.dc = [0, 0, 0, 0]; this.fbuf = [new Float32Array(Math.floor(sr * 0.12)), new Float32Array(Math.floor(sr * 0.12))]; this.fw = 0; this.env = 0; this.fy = [0, 0];
    this.nz = 0; this.nc = 0; this.upT(); this.upF();
  }
  upT() { this.tl[0].lowpass(this.sr, clamp(this.tone, 200, this.sr * 0.45), 0.707); this.tl[1].copy(this.tl[0]); }
  upF() { this.fl[0].lowpass(this.sr, clamp(this.fbF, 100, this.sr * 0.45), 0.9); this.fl[1].copy(this.fl[0]); }
  setParam(i, v) {
    switch (i) {
      case 0: this.shape = Math.round(clamp(v, 0, 5)); break; case 1: this.drive = dbToLin(clamp(v, 0, 40)); break; case 2: this.tone = v; this.upT(); break; case 3: this.mix = clamp(v, 0, 1); break;
      case 4: this.out = dbToLin(clamp(v, -24, 12)); break; case 5: this.bias = clamp(v, -1, 1); break; case 6: this.amt = clamp(v, 0, 1); break; case 7: this.fbA = clamp(v, 0, 1); break;
      case 8: this.fbT = clamp(v, 1, 100); break; case 9: this.fbF = v; this.upF(); break; case 10: this.comp = clamp(v, 0, 1); break;
    }
  }
  sh(x) {
    switch (this.shape) {
      case 0: return tanh(x); case 1: return x > 1 ? 1 : x < -1 ? -1 : x;
      case 2: { let u = (x + 1) * 0.25; u -= Math.floor(u); return 1 - Math.abs(u * 4 - 2); }
      case 3: return Math.sin(clamp(x, -3, 3) * 1.5708 * 0.6);
      case 4: { const c = x > 1 ? 1 : x < -1 ? -1 : x; return Math.round(c * 6) / 6; }
      default: { if (++this.nc >= 24) { this.nc = 0; this.nz = Math.random() * 2 - 1; } return tanh(x * (1 + this.nz * 0.35)); }
    }
  }
  process(L, R, n) {
    const ch = [L, R], d = this.drive, a = this.amt, bias = this.bias * 0.5, mix = this.mix, out = this.out, fbA = this.fbA * 0.85, comp = this.comp, fl = this.fbuf[0].length;
    const ds = Math.max(1, Math.floor(this.fbT * 0.001 * this.sr)), norm = this.shape === 0 ? 1 / tanh(Math.max(d, 1)) : 1;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 2; c++) {
        const x = ch[c][i], buf = this.fbuf[c];
        let rp = this.fw - ds; if (rp < 0) rp += fl;
        const fbs = fbA > 0 ? this.fl[c].process(buf[rp]) * fbA : 0;
        let y = this.sh((x + fbs) * d + bias) * norm;
        y = y * a + x * (1 - a);
        const dc = this.dc[c * 2]; this.dc[c * 2] += (y - dc) * 0.0015; y -= this.dc[c * 2];       // bias must not leave a DC offset
        buf[this.fw] = tanh(y);
        y = this.tl[c].process(y);
        if (comp > 0) { const ay = y < 0 ? -y : y; this.env = ay > this.env ? ay : this.env * 0.9996; y /= 1 + comp * 2.5 * this.env; }
        ch[c][i] = (x * (1 - mix) + y * mix) * out;
      }
      if (++this.fw >= fl) this.fw = 0;
    }
  }
}
