// Port of js/engine/fx8.js: Tape Stop (device 52). Same maths and order of operations as the JS class (jsmath.h rules:
// double scalars, float buffers, no FMA). A ring buffer read at a varying speed with cubic interpolation; a state machine
// (LIVE / STOPPING / STOPPED / STARTING / REJOIN) driven by the automatable Play parameter.
#pragma once
#include "dsp.h"
#include "units.h"
#include <vector>

namespace mdaw {

class TapeStop : public Device {
 public:
  double sr, bpm = 120; double p[7]; int blen; std::vector<float> bl, br; int w = 0;
  int stt = 0; double rp = 0, x = 0, speed = 1; int xf = 0;
  explicit TapeStop(double rate);
  void setTempo(double b) override { bpm = clamp(b, 20, 400); }
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override;
  double curveK();
  double timeOf(double sec, double beatsIdx);
  double rd(const std::vector<float>& b, double pos);
};

}  // namespace mdaw
