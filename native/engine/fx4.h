// Ports of js/engine/fx4.js (Live 12 set, part 2). Same maths and order of operations as the JS originals.
#pragma once
#include "fx3b.h"

namespace mdaw {

class Amp : public FxBase {
 public:
  explicit Amp(double r) : FxBase(r, { 2, 6.9, 6.27, 5.79, 4.44, 2.62, 8.25, 0, 1 }) { upd(); }
  Biquad f[2][5];
  void upd();
  void setParam(int i, double v) override { FxBase::setParam(i, v); upd(); }
  void process(float* L, float* R, int n) override;
};
class Cabinet : public FxBase {
 public:
  explicit Cabinet(double r) : FxBase(r, { 1, 1, 0, 0, 1 }) { upd(); }
  Biquad f[2][4]; float bl[2048] = {}, br[2048] = {}; int w = 0;
  void upd();
  void setParam(int i, double v) override { FxBase::setParam(i, v); upd(); }
  void process(float* L, float* R, int n) override;
};
class Overdrive : public FxBase {
 public:
  explicit Overdrive(double r) : FxBase(r, { 1100, 6, 0.5, 0.5, 0.5, 1 }) { upd(); }
  Biquad h[2], l[2], t[2]; double env = 0;
  void upd() { double k = std::pow(2, p[1] / 2); for (int c = 0; c < 2; c++) { h[c].highpass(sr, clamp(p[0] / k, 20, 18000), 0.707); l[c].lowpass(sr, clamp(p[0] * k, 40, 20000), 0.707); t[c].lowpass(sr, 800 * std::pow(25, p[3]), 0.707); } }
  void setParam(int i, double v) override { FxBase::setParam(i, v); upd(); }
  void process(float* L, float* R, int n) override;
};
class Pedal : public FxBase {
 public:
  explicit Pedal(double r) : FxBase(r, { 0, 0.5, 0, 0, 0, 0, 1, 0, 1 }) { upd(); }
  Biquad f[2][4];
  void upd();
  void setParam(int i, double v) override { FxBase::setParam(i, v); upd(); }
  void process(float* L, float* R, int n) override;
};
class DynTube : public FxBase {
 public:
  explicit DynTube(double r) : FxBase(r, { 0, 0.5, 0, 0, 0.5, 10, 100, 0, 1 }) { upd(); }
  Biquad t[2]; double env = 0;
  void upd() { for (int c = 0; c < 2; c++) t[c].highShelf(sr, 2000, 0.7, (p[4] - 0.5) * 18); }
  void setParam(int i, double v) override { FxBase::setParam(i, v); upd(); }
  void process(float* L, float* R, int n) override;
};

}  // namespace mdaw

namespace mdaw {

class MultibandDyn : public FxBase {
 public:
  explicit MultibandDyn(double r);
  Biquad x[2][4][2]; double env[3] = {}, gr[3] = {}, lv[3] = {};
  void upd();
  void setParam(int i, double v) override { FxBase::setParam(i, v); if (i < 2) upd(); }
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override { for (int b = 0; b < 3; b++) { o[b * 2] = (float)lv[b]; o[b * 2 + 1] = (float)gr[b]; } return 6; }
};
class Resonators : public FxBase {
 public:
  explicit Resonators(double r);
  ~Resonators() override { for (auto* q : b) delete[] q; }
  int N; float* b[5]; double lp[5] = {}, w = 0; Biquad in[2];
  void upd();
  void setParam(int i, double v) override { FxBase::setParam(i, v); if (i <= 2) upd(); }
  void process(float* L, float* R, int n) override;
};
struct CMode { double f, rr, amp, aL, aR, s1[2], s2[2], fs, c[2]; };
class Corpus : public FxBase {
 public:
  explicit Corpus(double r);
  CMode m[12]; int nm = 0; double ph = 0, sh[2] = {}; uint32_t seed = 7; Biquad in[2]; bool dirty = true;
  void upd();
  void coefs(double l0, double l1);
  void setParam(int i, double v) override { FxBase::setParam(i, v); upd(); }
  void process(float* L, float* R, int n) override;
};

}  // namespace mdaw
