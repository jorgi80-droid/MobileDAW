// Ports of Autoduck / Stereolizer / Spacer (js/engine/fx.js). Keep each class in step with its JS original.
#include "fxu.h"

namespace mdaw {

// ---------------------------------------------------------------------------------------------- Autoduck
Autoduck::Autoduck(double r, const float* sidechain) : sc(sidechain), sr(r) { upd(); }
void Autoduck::upd() { aC = 1 - std::exp(-1 / (jsMax(0.05, atk) * 0.001 * sr)); rC = 1 - std::exp(-1 / (jsMax(1, rel) * 0.001 * sr)); }
void Autoduck::setParam(int i, double v) {
  if (i == 0) src = (int)jsRound(clamp(v, 0, 64)); else if (i == 1) thr = v; else if (i == 2) amt = v; else if (i == 3) { atk = v; upd(); } else if (i == 4) { rel = v; upd(); }
}
void Autoduck::process(float* L, float* R, int n) {
  double lvl = src > 0 && sc ? (double)sc[src - 1] : 0, depth = clamp((linToDb(lvl) - thr) / 6, 0, 1), target = dbToLin(-amt * depth);
  for (int i = 0; i < n; i++) { g += (target - g) * (target < g ? aC : rC); L[i] = (float)(L[i] * g); R[i] = (float)(R[i] * g); }
  gr = -linToDb(g);
}

// ---------------------------------------------------------------------------------------------- Stereolizer
Stereolizer::Stereolizer(double r) : sr(r) { upd(); }
void Stereolizer::upd() { if (bm >= 20) lp.lowpass(sr, bm, 0.707); }
void Stereolizer::setParam(int i, double v) {
  if (i == 0) width = clamp(v, 0, 2); else if (i == 1) mg = dbToLin(clamp(v, -12, 12)); else if (i == 2) sg = dbToLin(clamp(v, -12, 12));
  else if (i == 3) { bm = v < 20 ? 0 : clamp(v, 20, 500); upd(); } else if (i == 4) bal = clamp(v, -1, 1); else if (i == 5) og = dbToLin(clamp(v, -24, 12));
}
void Stereolizer::process(float* L, float* R, int n) {
  const double k = std::exp(-1 / (0.3 * sr)), wd = width * sg; const bool on = bm > 0;
  const double gl = bal > 0 ? 1 - bal : 1, gR = bal < 0 ? 1 + bal : 1;
  for (int i = 0; i < n; i++) {
    double m = ((double)L[i] + R[i]) * 0.5 * mg;
    double s = ((double)L[i] - R[i]) * 0.5 * wd;
    if (on) s -= lp.process(s);
    double l = (m + s) * gl * og, r = (m - s) * gR * og;
    L[i] = (float)l; R[i] = (float)r;
    sLR = sLR * k + l * r; sLL = sLL * k + l * l; sRR = sRR * k + r * r; m2 = m2 * k + m * m * (1 - k); s2 = s2 * k + s * s * (1 - k);
    double al = l < 0 ? -l : l, ar = r < 0 ? -r : r; if (al > pl) pl = al; if (ar > pr) pr = ar;
    if (++vc >= 24) { vc = 0; vx[vi] = (float)((l - r) * 0.7071); vx[vi + 1] = (float)((l + r) * 0.7071); vi = (vi + 2) & 127; }
  }
}
int Stereolizer::readOut(float* o) {
  double d = std::sqrt(sLL * sRR); o[0] = (float)(d > 1e-12 ? sLR / d : 0);
  o[1] = (float)linToDb(std::sqrt(m2)); o[2] = (float)linToDb(std::sqrt(s2)); o[3] = (float)linToDb(pl); o[4] = (float)linToDb(pr); pl *= 0.6; pr *= 0.6;
  for (int i = 0; i < 128; i++) o[5 + i] = vx[(vi + i) & 127];
  return 133;
}

// ---------------------------------------------------------------------------------------------- Spacer
static const double SP_TL[6] = { 0.0113, 0.0173, 0.0233, 0.0311, 0.0397, 0.0491 }, SP_TR[6] = { 0.0131, 0.0197, 0.0269, 0.0347, 0.0433, 0.0527 }, SP_G[6] = { 0.8, 0.66, 0.54, 0.44, 0.34, 0.26 };
Spacer::Spacer(double r) : sr(r) {
  len = (int)std::floor(sr * 0.25); buf = new float[len](); hn = (int)std::floor(sr * 0.03); hs = new float[hn]();
  upd(); hpf(120);
}
void Spacer::hpf(double f) { hp[0].highpass(sr, f, 0.707); hp[1].copy(hp[0]); }
void Spacer::upd() { k = 1 - std::exp(-TWO_PI * (2500 + (1 - damp) * 12000) / sr); hd = (int)std::floor(spread * 0.014 * sr) + 1; }
void Spacer::setParam(int i, double v) {
  if (i == 0) size = clamp(v, 0, 1); else if (i == 1) spread = clamp(v, 0, 1); else if (i == 2) damp = clamp(v, 0, 1); else if (i == 3) mix = clamp(v, 0, 1);
  else if (i == 4) pre = clamp(v, 0, 60) * 0.001; else if (i == 5) hpf(clamp(v, 20, 1000));
  upd();
}
void Spacer::process(float* L, float* R, int n) {
  const double sc = 0.4 + size * 1.6, mx = mix;
  for (int i = 0; i < n; i++) {
    double m = ((double)L[i] + R[i]) * 0.5; buf[w] = (float)m;
    double wl = 0, wr = 0;
    for (int t = 0; t < 6; t++) {
      int pl = w - (int)std::floor((SP_TL[t] * sc + pre) * sr), pr = w - (int)std::floor((SP_TR[t] * sc + pre) * sr);
      if (pl < 0) pl += len; if (pr < 0) pr += len; if (pl < 0) pl += len; if (pr < 0) pr += len;
      wl += buf[pl] * SP_G[t] * (t & 1 ? -1 : 1); wr += buf[pr] * SP_G[t] * (t & 1 ? 1 : -1);
    }
    wl *= 0.5; wr *= 0.5;
    lpz[0] += k * (wl - lpz[0]); lpz[1] += k * (wr - lpz[1]);
    double el = hp[0].process(lpz[0]), er = hp[1].process(lpz[1]);
    hs[hw] = R[i]; int hr = hw - hd; if (hr < 0) hr += hn;
    double rd = R[i] * (1 - spread * 0.5 * mx) + hs[hr] * spread * 0.5 * mx;
    if (++hw >= hn) hw = 0;
    L[i] = (float)(L[i] + el * mx * 1.4); R[i] = (float)(rd + er * mx * 1.4);
    if (++w >= len) w = 0;
  }
}

}  // namespace mdaw
