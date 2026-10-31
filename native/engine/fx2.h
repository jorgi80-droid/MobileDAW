// Ports of js/engine/fx2.js: Auto Filter, Echo, Roar. Same maths and order of operations as the JS originals.
#pragma once
#include "fx.h"

namespace mdaw {

class AutoFilter : public Device {
 public:
  explicit AutoFilter(double r);
  double sr, f = 20000, q = 0.707, envAmt = 0, atk = 6, rel = 200, lfoAmt = 0, rate = 1, drive = 1, mix = 1, phs = 0, curR = -99;
  int type = 0, slope = 0, shape = 0; Biquad b[2][2];
  double env = 0, ph = 0, sh = 0, lfo = 0, cur = -99, fc = 20000, envN = 0, aC = 0, rC = 0; bool dirty = true; uint32_t cnt = 0, seed = 4242;
  void upA() { aC = std::exp(-1 / (jsMax(0.1, atk) * 0.001 * sr)); }
  void upR() { rC = std::exp(-1 / (jsMax(1, rel) * 0.001 * sr)); }
  void coef(double fq, int ch = -1);
  double lfoAt(double p);
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override { o[0] = (float)fc; o[1] = (float)envN; o[2] = (float)lfo; return 3; }
};
class Echo : public Device {
 public:
  explicit Echo(double r);
  ~Echo() override { delete[] d[0]; delete[] d[1]; for (auto* p : ab) delete[] p; }
  double sr, tL = 350, tR = 350, fb = 0.35, mix = 0.25, rev = 0, width = 1, inG = 1, outG = 1, mRate = 0.5, mAmt = 0, chr = 0, bpm = 120, ph = 0, fLP = 6000, fHP = 20, curL, curR;
  int len, w = 0, pp = 0, link = 1, sync = 0, dL = 2, dR = 1; float* d[2]; Biquad hp[2], lp[2]; int al[4]; float* ab[4]; int ai[4] = {};
  void setTempo(double b) override { bpm = b; }
  void upF() { lp[0].lowpass(sr, fLP, 0.707); lp[1].copy(lp[0]); hp[0].highpass(sr, fHP, 0.707); hp[1].copy(hp[0]); }
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
};
class Roar : public Device {
 public:
  explicit Roar(double r);
  ~Roar() override { delete[] fbuf[0]; delete[] fbuf[1]; }
  double sr, drive, tone = 12000, mix = 1, out, bias = 0, amt = 1, fbA = 0, fbT = 10, fbF = 20000, comp = 0, dc[4] = {}, env = 0, nz = 0;
  int shape = 0, fw = 0, nc = 0, fl; uint32_t seed = 5151; Biquad tl[2], flt[2]; float* fbuf[2];
  void upT() { tl[0].lowpass(sr, clamp(tone, 200, sr * 0.45), 0.707); tl[1].copy(tl[0]); }
  void upF() { flt[0].lowpass(sr, clamp(fbF, 100, sr * 0.45), 0.9); flt[1].copy(flt[0]); }
  double sh(double x);
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
};

}  // namespace mdaw
