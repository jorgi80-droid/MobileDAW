#include "tmap.h"
#include <cmath>
#include "jsmath.h"

namespace mdaw {

static const double K = 60.0 / 960;   // tmap.js K

void TempoMap::set(const double* flat, int count) {
  int nn = (int)std::floor((double)count / 2);
  std::vector<double> tt(nn), bb(nn), ss(nn, 0.0);
  for (int i = 0; i < nn; i++) {
    double a = flat[i * 2], c = flat[i * 2 + 1];
    tt[i] = jsMax(0, (a == a) ? a : 0);                   // Math.max(0, +x || 0)
    if (tt[i] != tt[i]) tt[i] = 0;
    double cb = (c == c && c != 0) ? c : 120;              // +x || 120
    bb[i] = jsMin(300, jsMax(20, cb));
  }
  for (int i = 1; i < nn; i++) ss[i] = ss[i - 1] + seg(tt[i] - tt[i - 1], bb[i - 1], bb[i]);
  n = nn; t.swap(tt); b.swap(bb); s.swap(ss);
}

double TempoMap::seg(double dt, double b0, double b1) const {
  if (dt <= 0) return 0;
  return std::fabs(b1 - b0) < 1e-9 ? dt * K / b0 : dt * K * std::log(b1 / b0) / (b1 - b0);
}

int TempoMap::idxT(double x) const { int a = 0, bb = n; while (a < bb) { int m = (a + bb) >> 1; if (t[m] <= x) a = m + 1; else bb = m; } return a - 1; }
int TempoMap::idxS(double x) const { int a = 0, bb = n; while (a < bb) { int m = (a + bb) >> 1; if (s[m] <= x) a = m + 1; else bb = m; } return a - 1; }

double TempoMap::bpmAt(double tick) const {
  if (!n) return 120;
  int i = idxT(tick);
  if (i < 0) return b[0];
  if (i >= n - 1) return b[n - 1];
  double dt = t[i + 1] - t[i];
  return dt <= 0 ? b[i + 1] : b[i] + (b[i + 1] - b[i]) * (tick - t[i]) / dt;
}

double TempoMap::tickToSec(double tick) const {
  if (!n) return tick * K / 120;
  if (tick <= t[0]) return tick * K / b[0];
  int i = idxT(tick);
  if (i >= n - 1) return s[n - 1] + (tick - t[n - 1]) * K / b[n - 1] + off();
  return s[i] + off() + seg(tick - t[i], b[i], bpmAt(tick));
}

double TempoMap::off() const { return n ? t[0] * K / b[0] : 0; }

double TempoMap::secToTick(double sec) const {
  if (!n) return sec * 120 / K;
  double o = off();
  if (sec <= o) return sec * b[0] / K;
  double x = sec - o; int i = idxS(x);
  if (i >= n - 1) return t[n - 1] + (x - s[n - 1]) * b[n - 1] / K;
  double b0 = b[i], b1 = b[i + 1], dt = t[i + 1] - t[i], r = x - s[i];
  if (dt <= 0) return t[i];
  if (std::fabs(b1 - b0) < 1e-9) return t[i] + r * b0 / K;
  double k = (b1 - b0) / dt;
  return t[i] + (b0 * std::exp(r * k / K) - b0) / k;
}

}  // namespace mdaw
