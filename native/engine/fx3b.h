// Ports of js/engine/fx3.js (part 2): Erosion, Redux, Vinyl Distortion, Drum Buss, Tuner, EQ Eight, Spectrum.
#pragma once
#include "fx3.h"

namespace mdaw {

class Erosion : public FxBase {
 public:
  explicit Erosion(double r) : FxBase(r, { 0, 670, 0.3, 0.6 }) { upd(); }
  Biquad f[2]; uint32_t seed = 99; double ph = 0;
  void upd() { double q = clamp(1 / jsMax(0.05, p[2]), 0.3, 20); f[0].bandpass(sr, p[1], q); f[1].copy(f[0]); }
  void setParam(int i, double v) override { FxBase::setParam(i, v); upd(); }
  void process(float* L, float* R, int n) override;
};
class Redux : public FxBase {
 public:
  explicit Redux(double r) : FxBase(r, { 40000, 0, 1, 8, 0, 0, 0, 1 }) { upd(); }
  double c = 1, hl = 0, hr = 0; uint32_t seed = 5; Biquad pre[2];
  void upd() { pre[0].lowpass(sr, clamp(p[0] * 0.45, 100, sr * 0.45), 0.707); pre[1].copy(pre[0]); }
  void setParam(int i, double v) override { FxBase::setParam(i, v); upd(); }
  void process(float* L, float* R, int n) override;
};
class VinylDist : public FxBase {
 public:
  explicit VinylDist(double r) : FxBase(r, { 1, 0.14, 10400, 1.67, 1, 0.14, 5080, 3, 0, 1, 0, 0, 1 }) { upd(); }
  Biquad tb[2], pb[2], cf[2]; uint32_t seed = 31;
  void upd() { tb[0].bandpass(sr, p[2], 1 / jsMax(0.1, p[3])); tb[1].copy(tb[0]); pb[0].bandpass(sr, p[6], 1 / jsMax(0.1, p[7])); pb[1].copy(pb[0]); cf[0].bandpass(sr, 3000, 0.8); cf[1].copy(cf[0]); }
  void setParam(int i, double v) override { FxBase::setParam(i, v); upd(); }
  void process(float* L, float* R, int n) override;
};
class DrumBuss : public FxBase {
 public:
  explicit DrumBuss(double r) : FxBase(r, { 0.45, 2, -12, 1, 0, 20000, -0.45, 0, 49, 1, -4, 1 }) { upd(); }
  Biquad dmp[2], cr[2], bm; double env = 0, fast = 0, slow = 0, boomLv = 0, outLv = 0;
  void upd() { dmp[0].lowpass(sr, p[5], 0.707); dmp[1].copy(dmp[0]); cr[0].bandpass(sr, 4500, 1.2); cr[1].copy(cr[0]); bm.bandpass(sr, p[8], 4 + p[9] * 40); }
  void setParam(int i, double v) override { FxBase::setParam(i, v); upd(); }
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override { o[0] = (float)linToDb(boomLv); o[1] = (float)linToDb(outLv); return 2; }
};
class Tuner : public FxBase {
 public:
  explicit Tuner(double r) : FxBase(r, { 440 }) { dec = (int)jsMax(1, jsRound(sr / 12000)); }
  int dec, N = 2048, k = 0; float buf[2048] = {}; double w = 0, acc = 0, hz = 0, cl = 0, lv = 0; float d[702] = {};
  void process(float* L, float* R, int n) override;
  void detect();
  int readOut(float* o) override { detect(); o[0] = (float)(cl > 0 ? hz : 0); o[1] = (float)cl; o[2] = (float)linToDb(lv); o[3] = (float)p[0]; return 4; }
};
class EqEight : public FxBase {
 public:
  explicit EqEight(double r);
  Biquad st[2][32]; int ns = 0;
  void upd();
  void setParam(int i, double v) override { FxBase::setParam(i, v); upd(); }
  void process(float* L, float* R, int n) override;
};
class Spectrum : public FxBase {
 public:
  explicit Spectrum(double r) : FxBase(r, { 2, 2, 4, 0, 0, 1, 1 }) { buf = new float[16384](); for (auto& a : avg) a = -150; }
  ~Spectrum() override { delete[] buf; }
  float* buf; double w = 0; float avg[256]; double re[16384], im[16384];
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override;
};

}  // namespace mdaw
