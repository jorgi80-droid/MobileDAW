// Tempo map: port of js/engine/tmap.js (piecewise-linear BPM over ticks, closed-form time integral).
#pragma once
#include <vector>

namespace mdaw {

class TempoMap {
 public:
  int n = 0;
  std::vector<double> t, b, s;
  void set(const double* flat, int count);
  double seg(double dt, double b0, double b1) const;
  int idxT(double x) const;
  int idxS(double x) const;
  double bpmAt(double tick) const;
  double tickToSec(double tick) const;
  double off() const;
  double secToTick(double sec) const;
};

}  // namespace mdaw
