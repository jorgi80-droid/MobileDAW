// Ports of js/engine/fx2.js. Keep each class in step with its JS original.
#include "fx2.h"

namespace mdaw {

// ---------------------------------------------------------------------------------------------- Auto Filter
AutoFilter::AutoFilter(double r) : sr(r) { upA(); upR(); }
void AutoFilter::setParam(int i, double v) {
  switch (i) {
    case 0: type = (int)jsRound(clamp(v, 0, 3)); break; case 1: f = clamp(v, 20, 20000); break; case 2: q = clamp(v, 0.3, 12); break;
    case 3: slope = v > 0.5 ? 1 : 0; break; case 4: envAmt = clamp(v, -1, 1); break; case 5: atk = v; upA(); break; case 6: rel = v; upR(); break;
    case 7: lfoAmt = clamp(v, 0, 1); break; case 8: rate = clamp(v, 0.05, 20); break; case 9: shape = (int)jsRound(clamp(v, 0, 4)); break;
    case 10: drive = dbToLin(clamp(v, 0, 24)); break; case 11: mix = clamp(v, 0, 1); break; case 12: phs = clamp(v, 0, 360) / 360; break;
  }
  dirty = true;
}
void AutoFilter::coef(double fq, int ch) {
  double qq = slope ? q * 0.8 : q; Biquad& a = b[0][ch < 0 ? 0 : ch];
  if (type == 0) a.lowpass(sr, fq, qq); else if (type == 1) a.highpass(sr, fq, qq); else if (type == 2) a.bandpass(sr, fq, qq); else a.notch(sr, fq, qq);
  if (ch < 0) { b[0][1].copy(a); b[1][0].copy(a); b[1][1].copy(a); } else b[1][ch].copy(a);
}
double AutoFilter::lfoAt(double p) {
  switch (shape) { case 0: return std::sin(TWO_PI * p); case 1: return -(4 * std::fabs(p - std::floor(p + 0.5)) - 1); case 2: return 1 - 2 * (p - std::floor(p)); case 3: return (p - std::floor(p)) < 0.5 ? 1 : -1; default: return sh; }
}
void AutoFilter::process(float* L, float* R, int n) {
  bool moving = envAmt != 0 || lfoAmt > 0, two = slope == 1; double a_ = aC, r_ = rC, inc = rate / sr, e = env;
  for (int i = 0; i < n; i++) {
    double a = L[i] < 0 ? -(double)L[i] : L[i], bb = R[i] < 0 ? -(double)R[i] : R[i], x = a > bb ? a : bb;
    e = x > e ? a_ * e + (1 - a_) * x : r_ * e + (1 - r_) * x;
    if ((cnt++ & 15) == 0 && (moving || dirty)) {
      ph += inc * 16; if (ph >= 1) { ph -= 1; sh = lcg(seed) / 4294967296.0 * 2 - 1; }
      double p = ph, l;
      switch (shape) { case 0: l = std::sin(TWO_PI * p); break; case 1: l = 4 * std::fabs(p - std::floor(p + 0.5)) - 1; l = -l; break; case 2: l = 1 - 2 * p; break; case 3: l = p < 0.5 ? 1 : -1; break; default: l = sh; }
      lfo = l;
      double en = clamp((linToDb(e) + 48) / 48, 0, 1); envN = en;
      double oct = envAmt * 4 * en + lfoAmt * 3 * l, fq = clamp(f * std::pow(2, oct), 20, 20000);
      if (phs > 0) {
        double oR = envAmt * 4 * en + lfoAmt * 3 * lfoAt(p + phs);
        if (dirty || std::fabs(oct - cur) > 0.003) { cur = oct; fc = fq; coef(fq, 0); }
        if (dirty || std::fabs(oR - curR) > 0.003) { curR = oR; coef(clamp(f * std::pow(2, oR), 20, 20000), 1); }
        dirty = false;
      } else if (dirty || std::fabs(oct - cur) > 0.003) { cur = oct; fc = fq; coef(fq); dirty = false; }
    }
    double dl = drive != 1 ? std::tanh(L[i] * drive) : L[i], dr = drive != 1 ? std::tanh(R[i] * drive) : R[i];
    double l = b[0][0].process(dl), r = b[0][1].process(dr);
    if (two) { l = b[1][0].process(l); r = b[1][1].process(r); }
    L[i] = (float)(L[i] * (1 - mix) + l * mix); R[i] = (float)(R[i] * (1 - mix) + r * mix);
  }
  env = e;
}

// ---------------------------------------------------------------------------------------------- Echo
static const double EDIV[8] = { 0.25, 0.5, 1, 2, 4, 1.0 / 6, 1.0 / 3, 2.0 / 3 };
Echo::Echo(double r) : sr(r) {
  len = (int)std::floor(sr * 2.3); d[0] = new float[len](); d[1] = new float[len](); upF();
  curL = 350 * sr / 1000; curR = curL;
  static const int at[4] = { 142, 107, 379, 277 }; double s = sr / 44100;
  for (int k = 0; k < 4; k++) { al[k] = (int)std::floor(at[k] * s) | 1; ab[k] = new float[al[k]](); }
}
void Echo::setParam(int i, double v) {
  switch (i) {
    case 0: tL = clamp(v, 1, 2000); break; case 1: fb = clamp(v, 0, 0.98); break; case 2: mix = clamp(v, 0, 1); break; case 3: pp = v > 0.5 ? 1 : 0; break;
    case 4: fLP = clamp(v, 200, 20000); upF(); break; case 5: fHP = clamp(v, 20, 2000); upF(); break; case 6: tR = clamp(v, 1, 2000); break;
    case 7: link = v > 0.5 ? 1 : 0; break; case 8: sync = v > 0.5 ? 1 : 0; break; case 9: dL = (int)jsRound(clamp(v, 0, 7)); break; case 10: dR = (int)jsRound(clamp(v, 0, 7)); break;
    case 11: rev = clamp(v, 0, 1); break; case 12: width = clamp(v, 0, 1); break; case 13: inG = dbToLin(clamp(v, -24, 24)); break; case 14: outG = dbToLin(clamp(v, -24, 12)); break;
    case 15: mRate = clamp(v, 0.1, 10); break; case 16: mAmt = clamp(v, 0, 1); break; case 17: chr = clamp(v, 0, 1); break;
  }
}
void Echo::process(float* L, float* R, int n) {
  double spb = 60000 / bpm;
  double msL = sync ? EDIV[dL] * spb : tL, msR = link ? msL : (sync ? EDIV[dR] * spb : tR);
  double tl = clamp(msL * sr / 1000, 8, len - 600), tr = clamp(msR * sr / 1000, 8, len - 600), mod = mAmt * 0.004 * sr, minc = mRate / sr, smooth = 0.0006;
  double dr = 1 + chr * 3, dn = 1 / fastTanh(dr), wd = width;
  float *d0 = d[0], *d1 = d[1];
  for (int i = 0; i < n; i++) {
    curL += (tl - curL) * smooth; curR += (tr - curR) * smooth;
    ph += minc; if (ph >= 1) ph -= 1;
    double m = mod != 0 ? std::sin(TWO_PI * ph) * mod : 0;
    double xl = L[i] * inG, xr = R[i] * inG;
    double rp = w - (curL + m); while (rp < 0) rp += len;
    int i0 = toInt32(rp); double fr = rp - i0; int i1 = i0 + 1 >= len ? 0 : i0 + 1; double y0 = d0[i0] * (1 - fr) + d0[i1] * fr;
    rp = w - (curR - m); while (rp < 0) rp += len;
    i0 = toInt32(rp); fr = rp - i0; i1 = i0 + 1 >= len ? 0 : i0 + 1; double y1 = d1[i0] * (1 - fr) + d1[i1] * fr;
    double fl = lp[0].process(hp[0].process(y0)), fR = lp[1].process(hp[1].process(y1));
    if (chr > 0) { fl = fastTanh(fl * dr) * dn; fR = fastTanh(fR * dr) * dn; }
    d0[w] = (float)(pp ? xl + fR * fb : xl + fl * fb);
    d1[w] = (float)(pp ? fl * fb : xr + fR * fb);
    if (++w >= len) w = 0;
    double wl = fl, wr = fR;
    if (rev > 0.001) {
      double x = (wl + wr) * 0.5;
      for (int k = 0; k < 4; k++) { float* bb = ab[k]; int j = ai[k]; double z = bb[j], o = z - 0.6 * x; bb[j] = (float)(x + 0.6 * o); x = o; if (++ai[k] >= al[k]) ai[k] = 0; }
      wl += x * rev * 1.5; wr -= x * rev * 1.5;
    }
    double mm = (wl + wr) * 0.5, ss = (wl - wr) * 0.5 * wd; wl = mm + ss; wr = mm - ss;
    L[i] = (float)((L[i] * (1 - mix) + wl * mix) * outG); R[i] = (float)((R[i] * (1 - mix) + wr * mix) * outG);
  }
}

// ---------------------------------------------------------------------------------------------- Roar
Roar::Roar(double r) : sr(r) {
  drive = dbToLin(12); out = dbToLin(-6); fl = (int)std::floor(sr * 0.12); fbuf[0] = new float[fl](); fbuf[1] = new float[fl](); upT(); upF();
}
void Roar::setParam(int i, double v) {
  switch (i) {
    case 0: shape = (int)jsRound(clamp(v, 0, 5)); break; case 1: drive = dbToLin(clamp(v, 0, 40)); break; case 2: tone = v; upT(); break; case 3: mix = clamp(v, 0, 1); break;
    case 4: out = dbToLin(clamp(v, -24, 12)); break; case 5: bias = clamp(v, -1, 1); break; case 6: amt = clamp(v, 0, 1); break; case 7: fbA = clamp(v, 0, 1); break;
    case 8: fbT = clamp(v, 1, 100); break; case 9: fbF = v; upF(); break; case 10: comp = clamp(v, 0, 1); break;
  }
}
double Roar::sh(double x) {
  switch (shape) {
    case 0: return fastTanh(x); case 1: return x > 1 ? 1 : x < -1 ? -1 : x;
    case 2: { double u = (x + 1) * 0.25; u -= std::floor(u); return 1 - std::fabs(u * 4 - 2); }
    case 3: return std::sin(clamp(x, -3, 3) * 1.5708 * 0.6);
    case 4: { double c = x > 1 ? 1 : x < -1 ? -1 : x; return jsRound(c * 6) / 6; }
    default: { if (++nc >= 24) { nc = 0; nz = lcg(seed) / 4294967296.0 * 2 - 1; } return fastTanh(x * (1 + nz * 0.35)); }
  }
}
void Roar::process(float* L, float* R, int n) {
  float* ch[2] = { L, R }; double d = drive, a = amt, bs = bias * 0.5, fa = fbA * 0.85;
  int ds = (int)jsMax(1, std::floor(fbT * 0.001 * sr)); double norm = shape == 0 ? 1 / fastTanh(jsMax(d, 1)) : 1;
  for (int i = 0; i < n; i++) {
    for (int c = 0; c < 2; c++) {
      double x = ch[c][i]; float* buf = fbuf[c];
      int rp = fw - ds; if (rp < 0) rp += fl;
      double fbs = fa > 0 ? flt[c].process(buf[rp]) * fa : 0;
      double y = sh((x + fbs) * d + bs) * norm;
      y = y * a + x * (1 - a);
      double dc0 = dc[c * 2]; dc[c * 2] += (y - dc0) * 0.0015; y -= dc[c * 2];
      buf[fw] = (float)fastTanh(y);
      y = tl[c].process(y);
      if (comp > 0) { double ay = y < 0 ? -y : y; env = ay > env ? ay : env * 0.9996; y /= 1 + comp * 2.5 * env; }
      ch[c][i] = (float)((x * (1 - mix) + y * mix) * out);
    }
    if (++fw >= fl) fw = 0;
  }
}

}  // namespace mdaw
