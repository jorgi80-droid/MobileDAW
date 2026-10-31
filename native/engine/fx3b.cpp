// Ports of js/engine/fx3.js (part 2). Keep each class in step with its JS original.
#include "fx3b.h"

namespace mdaw {

static inline double rnd01(uint32_t& s) { return lcg(s) / 4294967296.0; }
static inline double jsSign(double x) { return x > 0 ? 1 : x < 0 ? -1 : x; }

void Erosion::process(float* L, float* R, int n) {
  int mode = (int)jsRound(p[0]); double amt = p[3] * 4, inc = TWO_PI * p[1] / sr;
  for (int i = 0; i < n; i++) {
    double ml, mr;
    if (mode == 2) { ph += inc; if (ph > TWO_PI) ph -= TWO_PI; ml = mr = std::sin(ph) * 0.3; }
    else { double a = rnd01(seed) * 2 - 1; ml = f[0].process(a); mr = mode == 1 ? f[1].process(rnd01(seed) * 2 - 1) : ml; }
    L[i] = (float)(L[i] + L[i] * ml * amt); R[i] = (float)(R[i] + R[i] * mr * amt);
  }
}
void Redux::process(float* L, float* R, int n) {
  double step = clamp(p[0], 50, sr) / sr, jit = p[1]; bool pr = p[2] > 0.5, bon = p[4] > 0.5; double q = std::pow(2, clamp(p[3], 1, 16) - 1), sh = p[5], dc = p[6] > 0.5 ? 0.5 / q : 0, mix = p[7];
  for (int i = 0; i < n; i++) {
    double xl = pr ? pre[0].process(L[i]) : L[i], xr = pr ? pre[1].process(R[i]) : R[i];
    c += step * (1 + jit * (rnd01(seed) - 0.5));
    if (c >= 1) { c -= std::floor(c); hl = xl; hr = xr; }
    double l = hl, r = hr;
    if (bon) { double sl = sh > 0 ? jsSign(l) * std::pow(std::fabs(l), 1 - sh * 0.6) : l, s2 = sh > 0 ? jsSign(r) * std::pow(std::fabs(r), 1 - sh * 0.6) : r; l = jsRound(sl * q + dc) / q; r = jsRound(s2 * q + dc) / q; }
    L[i] = (float)(L[i] * (1 - mix) + l * mix); R[i] = (float)(R[i] * (1 - mix) + r * mix);
  }
}
void VinylDist::process(float* L, float* R, int n) {
  bool tOn = p[0] > 0.5; double td = p[1] * 8; bool pOn = p[4] > 0.5; double pd = p[5] * 8; bool mono = p[8] > 0.5, hard = p[9] > 0.5; double cv = p[10], cd = p[11] * 0.004, dr = p[12];
  auto sh = [&](double x) { return hard ? clamp(x * (1 + pd), -1, 1) : fastTanh(x * (1 + pd)); };
  for (int i = 0; i < n; i++) {
    double l = L[i], r = R[i];
    if (tOn) { double a = tb[0].process(l), b = tb[1].process(r); l += td * a * std::fabs(a); r += td * b * std::fabs(b); }
    if (pOn) { double a = pb[0].process(l), b = pb[1].process(r), ea = sh(a) - a, eb = sh(b) - b; l += ea; r += mono ? ea : -eb; }
    if (cv > 0 && rnd01(seed) < cd) { double c = (rnd01(seed) * 2 - 1) * cv; l += cf[0].process(c) * 4; r += cf[1].process(c) * 4; }
    else if (cv > 0) { l += cf[0].process(0) * 4; r += cf[1].process(0) * 4; }
    L[i] = (float)(l * dr); R[i] = (float)(r * dr);
  }
}
void DrumBuss::process(float* L, float* R, int n) {
  double trim = dbToLin(p[2]); bool comp = p[3] > 0.5; double dv = 1 + p[0] * 9; int ty = (int)jsRound(p[1]); double crn = p[4] * 2, trs = p[6], boom = p[7] * 3, out = dbToLin(p[10]), mix = p[11];
  double ec = 1 - coefMs(30, sr), fa = 1 - coefMs(1, sr), sl = 1 - coefMs(60, sr), bpk = 0, opk = 0;
  auto sh = [&](double x) { return ty == 0 ? fastTanh(x * dv) / jsMax(1, dv * 0.6) : ty == 1 ? fastTanh(x * dv) / jsMax(1, dv * 0.45) : clamp(x * dv, -1, 1) / jsMax(1, dv * 0.4); };
  for (int i = 0; i < n; i++) {
    double l = L[i] * trim, r = R[i] * trim;
    if (comp) { double x = jsMax(std::fabs(l), std::fabs(r)); env += (x - env) * ec; double g = env > 0.25 ? std::pow(0.25 / env, 0.5) : 1; l *= g * 1.6; r *= g * 1.6; }
    l = sh(l); r = sh(r);
    if (crn > 0) { l += fastTanh(cr[0].process(l) * 6) * crn * 0.2; r += fastTanh(cr[1].process(r) * 6) * crn * 0.2; }
    l = dmp[0].process(l); r = dmp[1].process(r);
    double a = jsMax(std::fabs(l), std::fabs(r)); fast += (a - fast) * fa; slow += (a - slow) * sl;
    double tg = clamp(1 + trs * ((fast - slow) / jsMax(1e-4, slow)) * 0.8, 0.2, 3); l *= tg; r *= tg;
    if (boom > 0) { double b = bm.process((l + r) * 0.5) * boom; l += b; r += b; if (std::fabs(b) > bpk) bpk = std::fabs(b); }
    l *= out; r *= out; double o = jsMax(std::fabs(l), std::fabs(r)); if (o > opk) opk = o;
    L[i] = (float)(L[i] * (1 - mix) + l * mix); R[i] = (float)(R[i] * (1 - mix) + r * mix);
  }
  boomLv = jsMax(bpk, boomLv * 0.92); outLv = jsMax(opk, outLv * 0.92);
}
void Tuner::process(float* L, float* R, int n) {
  for (int i = 0; i < n; i++) { acc += ((double)L[i] + R[i]) * 0.5; if (++k >= dec) { buf[toInt32(w) & (N - 1)] = (float)(acc / dec); w++; acc = 0; k = 0; } }
}
void Tuner::detect() {
  double s_ = sr / dec; const int W = 768, M = N - 1; int e = toInt32(w), maxLag = (int)jsMin(700, std::floor(s_ / 25)), minLag = (int)jsMax(2, std::floor(s_ / 1500));
  double l2 = 0; for (int j = 0; j < W; j++) { double x = buf[(e - W - maxLag + j) & M]; l2 += x * x; } lv = std::sqrt(l2 / W);
  if (lv < 0.003) { cl = 0; return; }
  double run = 0, bestV = 1; int best = -1;
  for (int t = 1; t <= maxLag; t++) { double s = 0; for (int j = 0; j < W; j++) { double x = (double)buf[(e - W + j) & M] - buf[(e - W + j - t) & M]; s += x * x; } run += s; d[t] = (float)(run > 0 ? s * t / run : 1); }
  for (int t = minLag; t < maxLag; t++) if (d[t] < 0.15 && d[t] < d[t - 1] && d[t] <= d[t + 1]) { best = t; bestV = d[t]; break; }
  if (best < 0) { for (int t = minLag; t < maxLag; t++) if (d[t] < bestV) { bestV = d[t]; best = t; } if (bestV > 0.35 || best < 1) { cl = 0; return; } }
  double a = d[best - 1], c = d[best + 1], den = a + c - 2 * d[best], lag = den != 0 ? best + 0.5 * (a - c) / den : best;
  hz = s_ / lag; cl = 1 - bestV;
}
EqEight::EqEight(double r) : FxBase(r, {}) {
  static const int T[8] = { 1, 2, 3, 3, 3, 3, 5, 6 }; static const double F[8] = { 30, 100, 250, 1000, 2500, 5000, 10000, 18000 };
  for (int b = 0; b < 8; b++) { double* q = p + b * 5; q[0] = b == 0 || b == 7 ? 0 : 1; q[1] = T[b]; q[2] = F[b]; q[3] = 0; q[4] = 0.71; } p[40] = 1; p[41] = 0; upd();
}
void EqEight::upd() {
  double sc = p[40]; ns = 0;
  for (int b = 0; b < 8; b++) {
    int o = b * 5; if (p[o] < 0.5) continue; int t = (int)jsRound(p[o + 1]); double f = clamp(p[o + 2], 10, 22000), g = clamp(p[o + 3] * sc, -24, 24), q = clamp(p[o + 4], 0.1, 18);
    int n0 = ns;
    for (int c = 0; c < 2; c++) {
      int k = n0;
      auto one = [&]() -> Biquad& { st[c][k] = Biquad(); return st[c][k++]; };
      if (t == 0 || t == 7) { static const double QS[4] = { 0.5412, 1.3066, 0.5412, 1.3066 }; for (double qq : QS) { if (t == 0) one().highpass(sr, f, qq * q / 0.7071); else one().lowpass(sr, f, qq * q / 0.7071); } }
      else if (t == 1) one().highpass(sr, f, q); else if (t == 6) one().lowpass(sr, f, q);
      else if (t == 2) one().lowShelf(sr, f, q, g); else if (t == 5) one().highShelf(sr, f, q, g);
      else if (t == 4) one().notch(sr, f, q); else one().peaking(sr, f, q, g);
      ns = k;
    }
  }
}
void EqEight::process(float* L, float* R, int n) {
  double g = dbToLin(p[41]);
  for (int i = 0; i < n; i++) { double l = L[i], r = R[i]; for (int k = 0; k < ns; k++) { l = st[0][k].process(l); r = st[1][k].process(r); } L[i] = (float)(l * g); R[i] = (float)(r * g); }
}
void Spectrum::process(float* L, float* R, int n) {
  int ch = (int)jsRound(p[1]); for (int i = 0; i < n; i++) { buf[toInt32(w) & 16383] = (float)(ch == 0 ? L[i] : ch == 1 ? R[i] : ((double)L[i] + R[i]) * 0.5); w++; }
}
static void fftC(double* re, double* im, int n) {     // in-place radix-2 (display only)
  for (int i = 1, j = 0; i < n; i++) { int bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { double t0 = re[i]; re[i] = re[j]; re[j] = t0; t0 = im[i]; im[i] = im[j]; im[j] = t0; } }
  for (int len = 2; len <= n; len <<= 1) { double a = -2 * PI / len, wr = std::cos(a), wi = std::sin(a);
    for (int i = 0; i < n; i += len) { double cr = 1, ci = 0; for (int k = 0; k < len / 2; k++) { int u = i + k, v = u + len / 2; double tr = re[v] * cr - im[v] * ci, ti = re[v] * ci + im[v] * cr; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; double nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } } }
}
int Spectrum::readOut(float* o) {
  static const int NS[5] = { 1024, 2048, 4096, 8192, 16384 }; int n = NS[(int)clamp(jsRound(p[0]), 0, 4)], M = 16383, e = toInt32(w);
  for (int k = 0; k < n; k++) { double wdw = 0.5 - 0.5 * std::cos(2 * PI * k / (n - 1)); re[k] = buf[(e - n + k) & M] * wdw; im[k] = 0; }
  fftC(re, im, n);
  int scale = (int)jsRound(p[5]); double a = 1 / jsMax(1, jsRound(p[2])), nyq = sr / 2;
  for (int b = 0; b < 256; b++) {
    double f0 = scale == 0 ? b / 256.0 * nyq : 20 * std::pow(1000, b / 256.0), f1 = scale == 0 ? (b + 1) / 256.0 * nyq : 20 * std::pow(1000, (b + 1) / 256.0);
    int k0 = (int)std::floor(f0 / nyq * n / 2), k1 = (int)jsMax(k0 + 1, std::ceil(f1 / nyq * n / 2)); double m = 0;
    for (int k = k0; k < k1 && k < n / 2; k++) { double v = re[k] * re[k] + im[k] * im[k]; if (v > m) m = v; }
    double db = 10 * std::log10(m / ((double)n * n / 16) + 1e-16);
    avg[b] = (float)(avg[b] + (db - avg[b]) * a); o[b] = avg[b];
  }
  return 256;
}

}  // namespace mdaw
