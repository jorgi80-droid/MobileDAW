#include "meter.h"
#include <algorithm>
#include <array>
#include <cmath>
#include "jsmath.h"

namespace mdaw {

static const double PPQ = 960;

MeterMap::MeterMap() { const double f[3] = { 0, 4, 4 }; set(f, 3); }

static double orDefault(double v, double def) { return (v == v && v != 0) ? v : def; }   // +x || def

void MeterMap::set(const double* flat, int count) {
  std::vector<std::array<int, 3>> src;
  for (int i = 0; i + 2 < count; i += 3) {
    int bb = (int)jsMax(0, orDefault(jsRound(flat[i]), 0));
    int nn = (int)jsMax(1, jsMin(32, orDefault(jsRound(flat[i + 1]), 4)));
    double dv = flat[i + 2]; int dd = (dv == 1 || dv == 2 || dv == 4 || dv == 8 || dv == 16) ? (int)dv : 4;
    src.push_back({ bb, nn, dd });
  }
  std::stable_sort(src.begin(), src.end(), [](const std::array<int, 3>& x, const std::array<int, 3>& y) { return x[0] < y[0]; });
  if (src.empty() || src[0][0] != 0) src.insert(src.begin(), { 0, 4, 4 });
  std::vector<std::array<int, 3>> seg;
  for (auto& s : src) { if (!seg.empty() && seg.back()[0] == s[0]) seg.back() = s; else seg.push_back(s); }
  m = (int)seg.size();
  b.assign(m, 0); n.assign(m, 0); d.assign(m, 0); bt.assign(m, 0); bl.assign(m, 0); T.assign(m, 0);
  for (int j = 0; j < m; j++) {
    b[j] = seg[j][0]; n[j] = seg[j][1]; d[j] = seg[j][2];
    bt[j] = jsRound(PPQ * 4 / seg[j][2]); bl[j] = bt[j] * seg[j][1];
    T[j] = j == 0 ? 0 : T[j - 1] + (b[j] - b[j - 1]) * bl[j - 1];
  }
}

int MeterMap::segOfTick(double t) const { int j = m - 1; while (j > 0 && T[j] > t) j--; return j; }
int MeterMap::segOfBar(double k) const { int j = m - 1; while (j > 0 && b[j] > k) j--; return j; }

double MeterMap::beatCeil(double t) const {
  int j = segOfTick(t);
  double x = T[j] + std::ceil((t - T[j]) / bt[j] - 1e-9) * bt[j];
  if (j + 1 < m && x >= T[j + 1]) x = T[j + 1];
  return x;
}

bool MeterMap::isDownbeat(double t) const {
  int j = segOfTick(t + 1e-6);
  double r = std::fmod(t - T[j], bl[j]);                 // JS % on doubles = fmod
  return r < 1e-3 || bl[j] - r < 1e-3;
}

}  // namespace mdaw
