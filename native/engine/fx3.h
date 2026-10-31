// Ports of js/engine/fx3.js (Live 12 set, part 1): Delay, Filter Delay, Beat Repeat, Chorus-Ensemble, Phaser-Flanger, Auto Pan, Gate,
// Glue Compressor, Channel EQ. Same maths and order of operations; the JS write counters (this.w) stay doubles and index through ToInt32.
#pragma once
#include <initializer_list>
#include "fx.h"

namespace mdaw {

inline int pow2Size(double x) { return 1 << (int)std::ceil(std::log2(x)); }
inline double rdJ(const float* buf, int mask, double w, double d) { double p = w - d, i = std::floor(p), f = p - i; int ii = toInt32(i); double a = buf[ii & mask], b = buf[(ii + 1) & mask]; return a + (b - a) * f; }
inline double coefMs(double ms, double sr) { return std::exp(-1 / jsMax(1, ms * 0.001 * sr)); }
struct Band { double sr; Biquad h, l; void set(double f, double w) { double k = std::pow(2, w / 2); h.highpass(sr, clamp(f / k, 20, 20000), 0.707); l.lowpass(sr, clamp(f * k, 30, 20000), 0.707); } double process(double x) { return l.process(h.process(x)); } };

class FxBase : public Device {                     // fx3.js Fx: parameter array, tempo
 public:
  FxBase(double r, std::initializer_list<double> def) : sr(r) { int k = 0; for (double v : def) p[k++] = v; }
  double sr, bpm = 120, p[48] = {};
  void setTempo(double b) override { bpm = b; }
  void setParam(int i, double v) override { if (i >= 0 && i < 48) p[i] = v; }
};
class Delay3 : public FxBase {
 public:
  explicit Delay3(double r);
  ~Delay3() override { delete[] bl; delete[] br; }
  float *bl, *br; int m; double w = 0, t[2] = {}, cur[2], old[2] = {}, xf[2] = {}, ph = 0, fq = -1; Band fl, fr;
  double tgt(int c);
  void upd() { t[0] = tgt(0); t[1] = tgt(1); }
  void setParam(int i, double v) override;
  void setTempo(double b) override { bpm = b; upd(); }
  void process(float* L, float* R, int n) override;
};
class FilterDelay : public FxBase {
 public:
  explicit FilterDelay(double r);
  ~FilterDelay() override { for (auto* x : b) delete[] x; }
  float* b[3]; int m; double w = 0, d[3] = {}; Band f[3];
  void upd(int k);
  void setParam(int i, double v) override { FxBase::setParam(i, v); if (i < 30) upd(i / 10); }
  void setTempo(double bb) override { bpm = bb; for (int k = 0; k < 3; k++) upd(k); }
  void process(float* L, float* R, int n) override;
};
class BeatRepeat : public FxBase {
 public:
  explicit BeatRepeat(double r);
  ~BeatRepeat() override { delete[] bl; delete[] br; }
  float *bl, *br; int m; double w = 0; Band fl, fr; bool on = false, play = false; double start = 0, len = 1, pos = 0, rate = 1, amp = 1, left = 0, lastSlot = -1, beat = 0, cap = 0; int gridNow = 4; uint32_t seed = 12345;
  double grid(); void trigger();
  void tr(bool pl, double b) override { play = pl; beat = b; }
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override { o[0] = on ? 1 : 0; o[1] = (float)gridNow; return 2; }
};
class ChorusEnsemble : public FxBase {
 public:
  explicit ChorusEnsemble(double r);
  ~ChorusEnsemble() override { delete[] bl; delete[] br; }
  float *bl, *br; int m; double w = 0, ph = 0; Biquad hl, hr, wl, wr;
  void upd() { hl.highpass(sr, p[6], 0.707); hr.copy(hl); wl.lowpass(sr, 20000 - p[10] * 14000, 0.6); wr.copy(wl); }
  void setParam(int i, double v) override { FxBase::setParam(i, v); upd(); }
  void process(float* L, float* R, int n) override;
};
class PhaserFlanger : public FxBase {
 public:
  explicit PhaserFlanger(double r);
  ~PhaserFlanger() override { delete[] bl; delete[] br; }
  double z[2][48] = {}, lastL = 0, lastR = 0, ph = 0; float *bl, *br; int m; double w = 0; Biquad wl, wr;
  void upd() { wl.lowpass(sr, 20000 - p[10] * 15000, 0.6); wr.copy(wl); }
  void setParam(int i, double v) override { FxBase::setParam(i, v); upd(); }
  static double ap(double* zz, double x, double a, int k) { double y = -a * x + zz[k]; zz[k] = x + a * y; return y; }
  void process(float* L, float* R, int n) override;
};
class AutoPan : public FxBase {
 public:
  explicit AutoPan(double r) : FxBase(r, { 0.5, 1, 0, 2, 180, 0, 0, 0, 0 }) { hasTr = true; }
  double ph = 0, sh[2] = {}, last[2] = {}, beat = 0; bool play = false; uint32_t seed = 777;
  double wave(double x, int c);
  void tr(bool pl, double b) override { play = pl; beat = b; }
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override { o[0] = (float)ph; return 1; }
};
class Gate : public FxBase {
 public:
  explicit Gate(double r) : FxBase(r, { -40, 3, 0.1, 10, 100, -80, 0 }) {}
  double env = 0, g = 0, hold = 0, inPk = 0, gr = 0; bool open = false;
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override { o[0] = (float)linToDb(inPk); o[1] = (float)linToDb(gr); o[2] = open ? 1 : 0; inPk = 0; return 3; }
};
class GlueComp : public FxBase {
 public:
  explicit GlueComp(double r) : FxBase(r, { 3, 2, 0, -10, 0, 70, 0, 1 }) {}
  double env = 0, grDb = 0, grMax = 0, slow = 0;
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override { o[0] = (float)grMax; grMax = 0; return 1; }
};
class ChannelEq : public FxBase {
 public:
  explicit ChannelEq(double r) : FxBase(r, { 0, 0, 0, 1500, 0, 0 }) { upd(); }
  Biquad b[2][4];
  void upd();
  void setParam(int i, double v) override { FxBase::setParam(i, v); upd(); }
  void process(float* L, float* R, int n) override;
};

}  // namespace mdaw
