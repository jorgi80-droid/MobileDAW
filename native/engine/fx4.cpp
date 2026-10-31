// Ports of js/engine/fx4.js (part 1). Keep each class in step with its JS original.
#include "fx4.h"

namespace mdaw {

struct AmpT { double g, a, lo, mid; };
static const AmpT AMPT[7] = { { 1, 0, 0, 700 }, { 3, 0.1, 0, 800 }, { 6, 0.2, -2, 650 }, { 12, 0.25, -1, 800 }, { 24, 0.3, -3, 1000 }, { 40, 0.4, 2, 500 }, { 4, 0.05, 4, 400 } };
void Amp::upd() {
  int ti = (int)clamp(jsRound(p[0]), 0, 6); const AmpT& t = AMPT[ti]; auto db = [](double v) { return (v - 5) * 2.4; };
  f[0][0].highpass(sr, ti == 6 ? 30 : 70, 0.707); f[0][1].lowShelf(sr, 120, 0.7, db(p[2]) + t.lo); f[0][2].peaking(sr, t.mid, 0.8, db(p[3])); f[0][3].highShelf(sr, 2800, 0.7, db(p[4])); f[0][4].highShelf(sr, 5500, 0.7, db(p[5]) * 0.8);
  for (int k = 0; k < 5; k++) f[1][k].copy(f[0][k]);
}
void Amp::process(float* L, float* R, int n) {
  const AmpT& t = AMPT[(int)clamp(jsRound(p[0]), 0, 6)]; double pre = t.g * (0.2 + p[1] / 10 * 2), vol = std::pow(p[6] / 10, 2) * 1.6; bool mono = p[7] < 0.5; double mix = p[8], norm = 1 / jsMax(0.3, fastTanh(pre * 0.5));
  auto sh = [&](double x, Biquad* ff) { x = ff[0].process(x) * pre; double y = fastTanh(x + t.a) - fastTanh(t.a); return ff[4].process(ff[3].process(ff[2].process(ff[1].process(y * norm * 0.5)))); };
  for (int i = 0; i < n; i++) {
    double l = L[i], r = R[i]; if (mono) l = r = (l + r) * 0.5;
    double yl = sh(l, f[0]) * vol, yr = mono ? yl : sh(r, f[1]) * vol;
    L[i] = (float)(L[i] * (1 - mix) + yl * mix); R[i] = (float)(R[i] * (1 - mix) + yr * mix);
  }
}
void Cabinet::upd() {
  int cab = (int)clamp(jsRound(p[0]), 0, 3), mic = (int)jsRound(p[1]), pos = (int)jsRound(p[2]);
  static const double HP[4] = { 110, 90, 75, 45 }, PF[4] = { 2200, 1800, 1600, 900 }, PG[4] = { 5, 4, 3, 3 }, LP[4] = { 5200, 4800, 4300, 3200 }, BF[4] = { 120, 110, 100, 80 };
  f[0][0].highpass(sr, HP[cab], 0.9); f[0][1].peaking(sr, PF[cab], 1.2, PG[cab] - (pos == 1 ? 4 : 0));
  f[0][2].lowpass(sr, LP[cab] * (pos == 1 ? 0.7 : pos == 2 ? 0.8 : 1) * (mic ? 0.85 : 1.15), 0.9); f[0][3].peaking(sr, BF[cab], 1, pos == 0 ? 3 : 1);
  for (int k = 0; k < 4; k++) f[1][k].copy(f[0][k]);
}
void Cabinet::process(float* L, float* R, int n) {
  bool mono = p[3] < 0.5; double mix = p[4]; bool far = jsRound(p[2]) == 2; int dl = (int)jsRound(sr * 0.006); const int M = 2047;
  auto run = [](double x, Biquad* ff) { return ff[3].process(ff[2].process(ff[1].process(ff[0].process(x)))); };
  for (int i = 0; i < n; i++) {
    double l = L[i], r = R[i]; if (mono) l = r = (l + r) * 0.5;
    double yl = run(l, f[0]), yr = mono ? yl : run(r, f[1]);
    if (far) { bl[w & M] = (float)yl; br[w & M] = (float)yr; yl = yl * 0.7 + br[(w - dl) & M] * 0.35; yr = yr * 0.7 + bl[(w - dl - 37) & M] * 0.35; w++; }
    L[i] = (float)(L[i] * (1 - mix) + yl * mix); R[i] = (float)(R[i] * (1 - mix) + yr * mix);
  }
}
void Overdrive::process(float* L, float* R, int n) {
  double dv = 1 + p[2] * 40, dyn = p[4], mix = p[5], ec = 1 - coefMs(20, sr);
  for (int i = 0; i < n; i++) {
    double x = jsMax(std::fabs((double)L[i]), std::fabs((double)R[i])); env += (x - env) * ec;
    double g = dyn > 0 ? 1 + dyn * clamp(env * 4, 0, 1) : 1;
    double yl = t[0].process(fastTanh(l[0].process(h[0].process(L[i])) * dv) * 0.5) * g, yr = t[1].process(fastTanh(l[1].process(h[1].process(R[i])) * dv) * 0.5) * g;
    L[i] = (float)(L[i] * (1 - mix) + yl * mix); R[i] = (float)(R[i] * (1 - mix) + yr * mix);
  }
}
void Pedal::upd() {
  static const double MF[3] = { 500, 1000, 2000 };
  for (int c = 0; c < 2; c++) { f[c][0].highpass(sr, p[7] > 0.5 ? 20 : 90, 0.707); f[c][1].lowShelf(sr, 150, 0.7, p[3] * 12); f[c][2].peaking(sr, MF[(int)clamp(jsRound(p[6]), 0, 2)], 0.9, p[4] * 12); f[c][3].highShelf(sr, 3000, 0.7, p[5] * 12); }
}
void Pedal::process(float* L, float* R, int n) {
  int ty = (int)jsRound(p[0]); static const double GM[3] = { 20, 60, 150 }; double g = 1 + p[1] * GM[(int)clamp(ty, 0, 2)], out = dbToLin(p[2]) * 0.6, mix = p[8];
  auto sh = [&](double x) { return ty == 0 ? fastTanh(x) : ty == 1 ? clamp(x * 1.2, -1, 1) : (x > 0 ? 1 - std::exp(-x * 2) : -(1 - std::exp(x * 1.2)) * 0.8); };
  auto run = [&](double x, Biquad* ff) { return ff[3].process(ff[2].process(ff[1].process(sh(ff[0].process(x) * g)))); };
  for (int i = 0; i < n; i++) {
    double yl = run(L[i], f[0]) * out, yr = run(R[i], f[1]) * out;
    L[i] = (float)(L[i] * (1 - mix) + yl * mix); R[i] = (float)(R[i] * (1 - mix) + yr * mix);
  }
}
void DynTube::process(float* L, float* R, int n) {
  double dv = dbToLin(p[0]) * 2; int tube = (int)jsRound(p[3]); double out = dbToLin(p[7]), mix = p[8], at = 1 - coefMs(p[5], sr), rl = 1 - coefMs(p[6], sr);
  for (int i = 0; i < n; i++) {
    double x = jsMax(std::fabs((double)L[i]), std::fabs((double)R[i])); env += (x - env) * (x > env ? at : rl);
    double bias = clamp(p[1] - 0.5 + p[2] * env * 2, -1, 1) * 0.6;
    auto sh = [&](double v) { double y = v * dv + bias; double z = tube == 0 ? fastTanh(y) - fastTanh(bias) : tube == 1 ? (y > 0 ? fastTanh(y) : fastTanh(y * 0.6) / 0.6) - fastTanh(bias) : y / (1 + std::fabs(y)) - bias / (1 + std::fabs(bias)); return z / jsMax(1, dv * 0.5); };
    double yl = t[0].process(sh(L[i])) * out, yr = t[1].process(sh(R[i])) * out;
    L[i] = (float)(L[i] * (1 - mix) + yl * mix); R[i] = (float)(R[i] * (1 - mix) + yr * mix);
  }
}

}  // namespace mdaw
