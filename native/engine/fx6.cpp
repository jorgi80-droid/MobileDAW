// Port of js/engine/fx6.js (same order of operations; Float32Array storage = float).
#include "fx6.h"
#include <cmath>

namespace mdaw {

static const double SYNC_BEATS[8] = { 0.125, 0.25, 0.5, 1, 2, 4, 8, 16 };
static inline double rnd01(uint32_t& s) { return lcg(s) / 4294967296.0; }
static inline int ci(double v, int lo, int hi) { return (int)clamp(jsRound(v), lo, hi); }

bool Mod::modTarget(int& s, int& d, int& k, double& v) {
  const int o = MAP; if (!(p[o + 5] >= 0)) return false;
  double lo = p[o + 8], hi = p[o + 9]; bool lg = p[o + 10] > 0.5 && lo > 0 && hi > 0;
  auto nrm = [&](double x) { double den = hi - lo; return lg ? std::log(x / lo) / std::log(hi / lo) : (x - lo) / (den != 0 && den == den ? den : 1); };
  auto dn = [&](double q) { return lg ? lo * std::pow(hi / lo, q) : lo + q * (hi - lo); };
  double q;
  if (p[o] > 0.5) { double mm = p[o + 1] > 0.5 ? m * 2 - 1 : m; q = nrm(p[o + 11]) + mm * p[o + 2] * (p[o + 1] > 0.5 ? 0.5 : 1); }
  else q = p[o + 3] + (p[o + 4] - p[o + 3]) * m;
  s = (int)jsRound(p[o + 5]); d = (int)jsRound(p[o + 6]); k = (int)jsRound(p[o + 7]); v = dn(clamp(q, 0, 1));
  return true;
}

// ---------------------------------------------------------------- LFO
LfoMod::LfoMod(double r) : Mod(r, 14) {
  const double d[14] = { 0, 0, 0, 0, 0, 1, 0, 3, 0, 1, 0, 0, 0, 0 }; for (int i = 0; i < 14; i++) p[i] = d[i]; setMapDefaults();
}
void LfoMod::setParam(int i, double v) { if (i < 0 || i >= NP) return; p[i] = v; if (i == 13 && v != rt) { rt = v; ph = 0; } }
double LfoMod::wave(double x) const {
  int w = (int)jsRound(p[0]); x -= std::floor(x);
  double sh = p[1]; if (sh) x = sh > 0 ? std::pow(x, 1 + sh * 3) : 1 - std::pow(1 - x, 1 - sh * 3);
  switch (w) { case 1: return x; case 2: return 1 - x; case 3: return 1 - std::fabs(2 * x - 1); case 4: return x < 0.5 ? 1 : 0; case 5: return rv; case 6: return rv > 0.5 ? 1 : 0; default: return 0.5 + 0.5 * std::sin(TWO_PI * x); }
}
void LfoMod::process(float*, float*, int n) {
  double hz = p[6] > 0.5 ? bpm / 60 / SYNC_BEATS[ci(p[7], 0, 7)] : p[5] * (p[8] > 0.5 ? 10 : 1);
  double prev = ph; ph += hz * n / sr; if (std::floor(ph) != std::floor(prev)) { rv = rnd01(seed); jv = (rnd01(seed) - 0.5) * p[3]; }
  if (ph > 1e6) ph -= std::floor(ph);
  if (p[12] > 0.5) { push(); return; }
  double v = wave(ph + p[11]); int st = (int)jsRound(p[2]); if (st > 1) v = jsRound(v * (st - 1)) / (st - 1);
  v = clamp(v + jv, 0, 1); double a = p[4] > 0 ? std::exp(-n / (sr * (0.001 + p[4] * p[4] * 0.5))) : 0; sm = sm * a + v * (1 - a);
  m = clamp(0.5 + (sm - 0.5) * p[9] + p[10] * 0.5, 0, 1);
  push();
}

// ---------------------------------------------------------------- Shaper
constexpr int SHAPER_PTS = 8, SHAPER_P0 = 11;
ShaperMod::ShaperMod(double r) : Mod(r, 35) {
  const double d[35] = { 1, 0, 3, 1, 0, 0, 0, 0, 4, 1, 4, 0, 0, -0.5, 0.5, 1, 0, 0.5, 0, 0.5, 1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0 };
  for (int i = 0; i < 35; i++) p[i] = d[i]; setMapDefaults();
}
double ShaperMod::shape(double x) const {
  int np = ci(p[10], 2, SHAPER_PTS); x -= std::floor(x);
  for (int j = 0; j < np - 1; j++) {
    double x0 = p[SHAPER_P0 + j * 3], x1 = p[SHAPER_P0 + (j + 1) * 3];
    if (x <= x1 || j == np - 2) {
      double y0 = p[SHAPER_P0 + j * 3 + 1], y1 = p[SHAPER_P0 + (j + 1) * 3 + 1], c = p[SHAPER_P0 + j * 3 + 2];
      double t = x1 > x0 ? clamp((x - x0) / (x1 - x0), 0, 1) : 1; if (c) t = c > 0 ? std::pow(t, 1 + c * 4) : 1 - std::pow(1 - t, 1 - c * 4);
      return y0 + (y1 - y0) * t;
    }
  }
  return 0;
}
void ShaperMod::process(float*, float*, int n) {
  double hz = p[1] > 0.5 ? bpm / 60 / SYNC_BEATS[ci(p[2], 0, 7)] : p[0];
  double prev = ph; ph += hz * n / sr; if (std::floor(ph) != std::floor(prev)) jv = (rnd01(seed) - 0.5) * p[6]; if (ph > 1e6) ph -= std::floor(ph);
  double v = clamp(shape(ph + p[5]) + jv, 0, 1), a = p[7] > 0 ? std::exp(-n / (sr * (0.001 + p[7] * p[7] * 0.5))) : 0; sm = sm * a + v * (1 - a);
  m = clamp(0.5 + (sm - 0.5) * p[3] + p[4] * 0.5, 0, 1); push();
}

// ---------------------------------------------------------------- Envelope Follower
EnvFollower::EnvFollower(double r) : Mod(r, 6) { const double d[6] = { 0, 0.157, 0.134, 63, 0, 2 }; for (int i = 0; i < 6; i++) p[i] = d[i]; setMapDefaults(); }
void EnvFollower::process(float* L, float* R, int n) {
  double g = std::pow(10, p[0] / 20), pk = 0;
  for (int i = 0; i < n; i++) { double a = jsMax(std::fabs(L[i]), std::fabs(R[i])) * g; if (a > pk) pk = a; }
  double blocks = sr / n, rise = std::exp(-1 / jsMax(1, p[1] * p[1] * blocks * 2)), fall = std::exp(-1 / jsMax(1, p[2] * p[2] * blocks * 4));
  env = pk > env ? env * rise + pk * (1 - rise) : env * fall + pk * (1 - fall);
  double dms = p[4] > 0.5 ? SYNC_BEATS[ci(p[5], 0, 7)] * 60000 / bpm : p[3]; int d = (int)clamp(jsRound(dms * 0.001 * blocks), 0, 4095);
  dl[dw & 4095] = (float)clamp(env, 0, 1); m = dl[(dw - d) & 4095]; dw++;
  lv[lw & 127] = (float)jsMin(1, pk); lw++; push();
}

}  // namespace mdaw
