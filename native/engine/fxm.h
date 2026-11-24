// Ports of the meter devices of js/engine/fx.js: Level (12), Analyzer (13), MiniMeters (16) and their BS.1770-4 Loudness meter.
// Audio passes through (Level applies its output gain); the read-outs feed the device displays (engine devOut).
#pragma once
#include "dsp.h"
#include "units.h"

namespace mdaw {

class Loudness {
 public:
  explicit Loudness(double r);
  static constexpr int BINS = 900;
  double sr; int subLen; struct K { double b0, b1, b2, a1, a2, z1, z2; } k[2][2];
  uint32_t hist[BINS], lra[BINS]; double ring[30]; float o[12]; double rk;
  int rn, rp, sn; double ss, tp, sp, sec, pl, pr, rms2, prev[2][3];
  void clear();
  static double lufs(double ms) { return ms > 1e-12 ? -0.691 + 10 * std::log10(ms) : -100; }
  static int bin(double l) { return (int)jsMax(0, jsMin(BINS - 1, std::floor((l + 70) * 10))); }
  static double pw(int b) { return std::pow(10, ((b / 10.0 - 70 + 0.05) + 0.691) / 10); }
  double meanLast(int kk) const;
  double pct(const uint32_t* h, int from, double q) const;
  void block();
  void measure(const float* L, const float* R, int n);
};

class Levelness : public Device {
 public:
  explicit Levelness(double r);
  double sr; Loudness m; double resetVal = 0, gdb = 0, g = 1; float rl[2048] = {}, rr[2048] = {}; int w = 0; float win[1024], re[1024], im[1024], spec[48];
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override;
};
class Analyzer : public Device {
 public:
  explicit Analyzer(double r);
  double sr; static constexpr int N = 2048; float ringL[4096] = {}, ringR[4096] = {}; uint32_t w = 0; double sLR = 0, sLL = 0, sRR = 0;
  float win[2048], re[2048], im[2048]; double pl = 0, pr = 0, pk = 0; Loudness m; double resetVal = 0, mid2 = 0, side2 = 0;
  void setParam(int i, double v) override { if (i == 0 && v != resetVal) { resetVal = v; m.clear(); pk = 0; } }
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override;
};
class MiniMeters : public Device {
 public:
  explicit MiniMeters(double r);
  ~MiniMeters() override;
  static constexpr int NB = 320, SC = 384, RING = 32768, HEAD = 40;
  double sr; float* rl; float* rr; uint32_t w = 0, wb = 0; Loudness m; double resetVal = 0; int fftIdx = 2, follow = 0, msMode = 0; float* cache = nullptr; int cacheIdx = -1, cacheMs = -1, rc = 0;
  double pl = 0, pr = 0, k, sLR = 0, sLL = 0, sRR = 0, mid2 = 0, side2 = 0, rmsL = 0, rmsR = 0; Biquad bLP[2], bHP[2]; double bs[3][3] = {};
  float* rb[6]; float *fr, *fi, *gr, *gi, *lre, *lim; float* win = nullptr; int winN = 0;
  double mnL = 1, mxL = -1, mnR = 1, mxR = -1, mnM = 1, mxM = -1, mnS = 1, mxS = -1, e2[3] = {}, en = 0;
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
  void spectra(float* o);
  int readOut(float* o) override;
};

}  // namespace mdaw
