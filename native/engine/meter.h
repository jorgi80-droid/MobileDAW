// Meter map (time signature changes): port of js/engine/meter.js
#pragma once
#include <vector>

namespace mdaw {

class MeterMap {
 public:
  MeterMap();
  int m = 0;
  std::vector<int> b, n, d;
  std::vector<double> bt, bl, T;
  void set(const double* flat, int count);
  int segOfTick(double t) const;
  int segOfBar(double k) const;
  double beatLenAt(double t) const { return bt[segOfTick(t)]; }
  int nAt(double t) const { return n[segOfTick(t)]; }
  double beatCeil(double t) const;
  double nextBeat(double t) const { return beatCeil(t + 1e-3 + 0.5); }
  bool isDownbeat(double t) const;
};

}  // namespace mdaw
