// Port of the building blocks in js/engine/dsp.js (same maths, same order of operations).
#pragma once
#include <cmath>
#include <cstdint>
#include "jsmath.h"

namespace mdaw {

inline double midiToHz(double n) { return 440 * std::pow(2, (n - 69) / 12); }
inline double dbToLin(double db) { return std::pow(10, db * 0.05); }
inline uint32_t lcg(uint32_t& seed) { seed = (uint32_t)((uint32_t)((int32_t)seed * (int32_t)1664525) + 1013904223u); return seed; }   // Math.imul + >>> 0

// RBJ biquad, transposed direct form II
struct Biquad {
  double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
  void set(double B0, double B1, double B2, double A0, double A1, double A2) { double i = 1 / A0; b0 = B0 * i; b1 = B1 * i; b2 = B2 * i; a1 = A1 * i; a2 = A2 * i; }
  void copy(const Biquad& o) { b0 = o.b0; b1 = o.b1; b2 = o.b2; a1 = o.a1; a2 = o.a2; }
  void reset() { z1 = z2 = 0; }
  double process(double x) { double y = b0 * x + z1; z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; return y; }
  void lowpass(double sr, double f, double q) { f = clamp(f, 10, sr * 0.45); double w = TWO_PI * f / sr, c = std::cos(w), al = std::sin(w) / (2 * jsMax(q, 0.1)); set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al); }
  void highpass(double sr, double f, double q) { f = clamp(f, 10, sr * 0.45); double w = TWO_PI * f / sr, c = std::cos(w), al = std::sin(w) / (2 * jsMax(q, 0.1)); set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al); }
  void bandpass(double sr, double f, double q) { f = clamp(f, 10, sr * 0.45); double w = TWO_PI * f / sr, c = std::cos(w), al = std::sin(w) / (2 * jsMax(q, 0.1)); set(al, 0, -al, 1 + al, -2 * c, 1 - al); }
  void notch(double sr, double f, double q) { f = clamp(f, 10, sr * 0.45); double w = TWO_PI * f / sr, c = std::cos(w), al = std::sin(w) / (2 * jsMax(q, 0.1)); set(1, -2 * c, 1, 1 + al, -2 * c, 1 - al); }
  void peaking(double sr, double f, double q, double db) { f = clamp(f, 10, sr * 0.45); double A = std::pow(10, db / 40), w = TWO_PI * f / sr, c = std::cos(w), al = std::sin(w) / (2 * jsMax(q, 0.1)); set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A); }
  void lowShelf(double sr, double f, double q, double db) {
    f = clamp(f, 10, sr * 0.45); double A = std::pow(10, db / 40), w = TWO_PI * f / sr, c = std::cos(w), s = std::sin(w), al = s / (2 * jsMax(q, 0.1)), t = 2 * std::sqrt(A) * al;
    set(A * ((A + 1) - (A - 1) * c + t), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - t), (A + 1) + (A - 1) * c + t, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - t);
  }
  void highShelf(double sr, double f, double q, double db) {
    f = clamp(f, 10, sr * 0.45); double A = std::pow(10, db / 40), w = TWO_PI * f / sr, c = std::cos(w), s = std::sin(w), al = s / (2 * jsMax(q, 0.1)), t = 2 * std::sqrt(A) * al;
    set(A * ((A + 1) + (A - 1) * c + t), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - t), (A + 1) - (A - 1) * c + t, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - t);
  }
};

// dsp.js polyBlep v2: 16-sample Blackman-windowed sinc step (same table, same maths)
constexpr int BLEP_W = 8, BLEP_M = 1024;
inline double* blepTab() { static double T[2 * BLEP_W * BLEP_M + 1]; return T; }
inline double& blepRate() { static double r = 0; return r; }
inline void blepInit(double sr) {
  if (blepRate() == sr) return;
  const int W = BLEP_W, M = BLEP_M, n = 2 * W * M; double fc = jsMin(0.86, 19500 / (sr * 0.5)); double* S = blepTab();
  static double k[2 * BLEP_W * BLEP_M + 1];
  for (int i = 0; i <= n; i++) { double x = -W + (double)i / M, a = PI * fc * x; k[i] = (i == W * M ? 1.0 : std::sin(a) / a) * (0.42 + 0.5 * std::cos(PI * x / W) + 0.08 * std::cos(2 * PI * x / W)); }
  double acc = 0; S[0] = 0; for (int i = 1; i <= n; i++) { acc += (k[i - 1] + k[i]) * 0.5; S[i] = acc; }
  for (int i = 0; i <= n; i++) S[i] /= acc;
  blepRate() = sr;
}
inline double polyBlep(double t, double dt) {
  const double W = BLEP_W, wd = W * dt;
  if (t >= wd && t <= 1 - wd) return 0;
  if (blepRate() == 0) blepInit(48000);
  const double* T = blepTab(); double s = 0, k1 = std::floor(t + wd);
  for (double k = std::ceil(t - wd); k <= k1; k++) {
    double x = (t - k) / dt;
    if (x <= -W || x >= W) continue;
    double f = (x + W) * BLEP_M, i = std::floor(f), fr = f - i; int ii = (int)i;
    if (ii >= 2 * BLEP_W * BLEP_M) continue;
    s += T[ii] + (T[ii + 1] - T[ii]) * fr - (x >= 0 ? 1 : 0);
  }
  return 2 * s;
}
inline double sawBl(double ph, double dt) { return 2 * ph - 1 - polyBlep(ph, dt); }
inline double squareBl(double ph, double dt) { double p2 = ph + 0.5; if (p2 >= 1) p2 -= 1; return (ph < 0.5 ? 1 : -1) + polyBlep(ph, dt) - polyBlep(p2, dt); }
inline double triNaive(double ph) { return 2 * std::fabs(2 * ph - 1) - 1; }
inline double wave4(double w, double ph, double dt) { return w == 0 ? sawBl(ph, dt) : w == 1 ? squareBl(ph, dt) : w == 2 ? triNaive(ph) : std::sin(TWO_PI * ph); }

struct AdsrP { double aInc = 0, dC = 0, s = 0, rC = 0; };
inline AdsrP adsrParams(double a, double d, double s, double r, double sr) {
  AdsrP p; p.aInc = 1 / jsMax(1, a * sr); p.dC = 1 - std::exp(-4.6 / jsMax(1, d * sr)); p.s = s; p.rC = 1 - std::exp(-4.6 / jsMax(1, r * sr)); return p;
}
// linear attack, exponential decay / release. st: 0 idle, 1 attack, 2 decay, 3 sustain, 4 release
struct Adsr {
  int st = 0; double v = 0;
  void start() { st = 1; }   // dsp.js: retrigger from the current level (no click)
  void release() { if (st != 0) st = 4; }
  double next(const AdsrP& p) {
    switch (st) {
      case 1: v += p.aInc; if (v >= 1) { v = 1; st = 2; } break;
      case 2: v += (p.s - v) * p.dC; if (std::fabs(v - p.s) < 1e-4) { v = p.s; st = 3; } break;
      case 3: v = p.s; break;
      case 4: v -= v * p.rC; if (v < 1e-4) { v = 0; st = 0; } break;
      default: return 0;
    }
    return v;
  }
};

}  // namespace mdaw
