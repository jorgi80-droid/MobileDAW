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

namespace mdaw {

struct VBand { Biquad m, c[2]; double e = 0; };
class Vocoder : public FxBase {
 public:
  explicit Vocoder(double r) : FxBase(r, { 0, 0, -60, 0.5, 0, 4, 80, 12000, 1, -60, 0, 0, 1, 1, 150, 1, 0, 1, 1, 0 }) { upd(); }
  double hold = 0, nz = 0, ph = 0, last = 0, last2 = NAN, period = 200, cntZ = 0, zr = 0, uv = 0; uint32_t seed = 3; float lv[40] = {}; VBand B[40]; int nb = 0;
  void upd();
  void setParam(int i, double v) override { FxBase::setParam(i, v); if ((i >= 5 && i <= 8) || i == 11 || i == 16) upd(); }
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override { for (int b = 0; b < nb; b++) o[b] = (float)linToDb(lv[b]); return nb; }
};
struct Hilbert { double a[4] = { 0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737 }, b[4] = { 0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278 }, za[8] = {}, zb[8] = {}, d = 0;
  void run(double x, double& re, double& im) {
    double y = x; for (int k = 0; k < 4; k++) { double c = a[k] * a[k], o = c * (y - za[k * 2 + 1]) + za[k * 2]; za[k * 2] = y; za[k * 2 + 1] = o; y = o; }
    double z = x; for (int k = 0; k < 4; k++) { double c = b[k] * b[k], o = c * (z - zb[k * 2 + 1]) + zb[k * 2]; zb[k * 2] = z; zb[k * 2 + 1] = o; z = o; }
    re = y; im = d; d = z; } };
class Shifter : public FxBase {
 public:
  explicit Shifter(double r);
  ~Shifter() override { delete[] b[0]; delete[] b[1]; }
  float* b[2]; int M; double w = 0, ph[2] = {}, oph = 0, fb[2] = {}; Hilbert h[2]; Biquad t[2];
  void upd() { for (int c = 0; c < 2; c++) t[c].lowpass(sr, p[7], 0.707); }
  void setParam(int i, double v) override { FxBase::setParam(i, v); if (i == 7) upd(); }
  void process(float* L, float* R, int n) override;
};
class GrainDelay : public FxBase {
 public:
  explicit GrainDelay(double r);
  ~GrainDelay() override { delete[] b[0]; delete[] b[1]; }
  float* b[2]; int M; double w = 0, cnt = 0; uint32_t seed = 17; struct G { double pos = 0, rate = 1, age = 0, len = 1; } g[2];
  void process(float* L, float* R, int n) override;
};
class HybridReverb : public FxBase {
 public:
  explicit HybridReverb(double r);
  ~HybridReverb() override { delete[] pre; delete[] er[0]; delete[] er[1]; for (auto* q : fd) delete[] q; }
  float* pre; int pm; double pw = 0; float* er[2]; int em = (1 << 15) - 1; double ew = 0; int len[8]; float* fd[8]; int fdm[8]; double fw = 0, lp[8] = {}, ph = 0, o[8] = {};
  float ap[4][1024] = {}; double apw[4] = {}; double sh = 0; float shB[8192] = {}; double vh[2] = {}; int vc = 0; Biquad eq[2][2], bm[2];
  void upd() { for (int c = 0; c < 2; c++) { eq[c][0].highpass(sr, p[16], 0.707); eq[c][1].lowpass(sr, p[17], 0.707); bm[c].highpass(sr, 200, 0.707); } }
  void setParam(int i, double v) override { FxBase::setParam(i, v); upd(); }
  void process(float* L, float* R, int n) override;
};
class Looper : public FxBase {
 public:
  explicit Looper(double r);
  ~Looper() override { delete[] bl; delete[] br; }
  int N; float *bl, *br; double len = 0, rec = 0, pos = 0, clr = 0; int st = 0;
  void close();
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override { o[0] = (float)st; o[1] = (float)(len / sr); o[2] = (float)(len ? pos / len : 0); o[3] = (float)(rec / sr); return 4; }
};

}  // namespace mdaw
