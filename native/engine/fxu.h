// Ports of the mix utilities in js/engine/fx.js: Autoduck (10), Stereolizer (14), Spacer (15). Same maths and order of operations as
// the JS classes; Float32Array storage in JS = float here, plain JS numbers = double.
#pragma once
#include "dsp.h"
#include "fx.h"
#include "units.h"

namespace mdaw {

class Autoduck : public Device {                 // the level of another strip (previous block, engine sc[]) pulls this one down
 public:
  Autoduck(double r, const float* sidechain);
  const float* sc; double sr, thr = -30, amt = 12, atk = 5, rel = 200, g = 1, gr = 0, aC = 0, rC = 0; int src = 0;
  void upd();
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override { o[0] = (float)gr; return 1; }
};

class Stereolizer : public Device {              // mid / side widener with bass mono, balance and a vectorscope
 public:
  explicit Stereolizer(double r);
  double sr, width = 1, mg = 1, sg = 1, bm = 0, bal = 0, og = 1, sLR = 0, sLL = 0, sRR = 0, m2 = 0, s2 = 0, pl = 0, pr = 0; Biquad lp;
  float vx[128] = {}; int vi = 0, vc = 0;
  void upd();
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override;
};

class Spacer : public Device {                   // early reflections + Haas-decorrelated side (room without a tail)
 public:
  explicit Spacer(double r);
  ~Spacer() override { delete[] buf; delete[] hs; }
  double sr, size = 0.5, spread = 0.5, damp = 0.4, mix = 0.3, pre = 0, lpz[2] = { 0, 0 }, k = 0; int len, w = 0, hn, hw = 0, hd = 1;
  float* buf; float* hs; Biquad hp[2];
  void hpf(double f);
  void upd();
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
};

}  // namespace mdaw
