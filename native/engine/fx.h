// Ports of the effects in js/engine/fx.js (Utility, EQ Three, Saturator, Compressor, Limiter, Reverb, Parametric EQ) and the helpers of
// js/engine/dsp.js they use (fastLog2 / fastPow2 / fastTanh bit tricks, the 2x / 4x polyphase oversampler). Same maths, same order of
// operations; Float32Array storage in JS = float storage here, Float64Array = double.
#pragma once
#include <cstring>
#include "dsp.h"
#include "units.h"

namespace mdaw {

inline double linToDb(double x) { return 20 * std::log10(jsMax(x, 1e-9)); }
inline double fastLog2(double x) {
  float f = (float)x; uint32_t vx; std::memcpy(&vx, &f, 4); uint32_t u = (vx & 0x007FFFFFu) | 0x3f000000u; float mxf; std::memcpy(&mxf, &u, 4); double mx = mxf;
  return vx * 1.1920928955078125e-7 - 124.22551499 - 1.498030302 * mx - 1.72587999 / (0.3520887068 + mx);
}
inline uint32_t toUint32(double x) { return (uint32_t)toInt32(x); }
inline double fastPow2(double p) {
  double c = p < -126 ? -126 : p; double w = toInt32(c), z = c - w + (p < 0 ? 1 : 0);
  uint32_t u = toUint32((1 << 23) * (c + 121.2740575 + 27.7280233 / (4.84252568 - z) - 1.49012907 * z)); float f; std::memcpy(&f, &u, 4); return f;
}
inline double fastTanh(double x) { if (x > 3) return 1; if (x < -3) return -1; double x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }

// ---- oversampling (dsp.js Os2 / Os4)
struct OsFilter { double h[65]; int n = 0; OsFilter(int len, double fc, double beta); };
const OsFilter& osH();
const OsFilter& osH4();
constexpr int OS2_LATENCY = 32, OS4_LATENCY = 37;
struct Os2 {
  const double* h; int n, ne, no; double xu[130] = {}, xd[130] = {}; int pu = 0, pd = 0; double o[2] = {};
  explicit Os2(const OsFilter& f) : h(f.h), n(f.n), ne((f.n + 1) >> 1), no(f.n >> 1) {}
  const double* up(double x);
  double down(double a, double b2);
};
struct Os4 {
  Os2 a, b; double o[4] = {};
  Os4() : a(osH()), b(osH4()) {}
  const double* up(double x) { const double* u = a.up(x); double u0 = u[0], u1 = u[1]; const double* v = b.up(u0); o[0] = v[0]; o[1] = v[1]; v = b.up(u1); o[2] = v[0]; o[3] = v[1]; return o; }
  double down(double s0, double s1, double s2, double s3) { double y0 = b.down(s0, s1), y1 = b.down(s2, s3); return a.down(y0, y1); }
};

class Utility : public Device {
 public:
  explicit Utility(double r);
  double sr, gdb = 0, pan = 0, width = 1, bmf = 120, g = 0; int inv = 0, mono = 0, invR = 0, ch = 0, bm = 0, mute = 0, dc = 0; bool gInit = false;
  Biquad lo[2], hi[2]; double dcx[2] = {}, dcy[2] = {};
  void upd();
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
};
struct Xover {
  double sr; Biquad l[4], h[4]; int n = 0;
  void set(double f, int steep);
  double lp(double x) { for (int k = 0; k < n; k++) x = l[k].process(x); return x; }
  double hp(double x) { for (int k = 0; k < n; k++) x = h[k].process(x); return x; }
};
class Eq3 : public Device {
 public:
  explicit Eq3(double r);
  double sr, g[3] = { 0, 0, 0 }, lf = 250, hf = 4000; int on[3] = { 1, 1, 1 }, steep = 0; Xover x[2][3];
  void upd();
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
};
class Saturator : public Device {
 public:
  explicit Saturator(double r);
  double sr, drive = 1, mix = 1, out = 1, tone = 20000; int type = 0, clip = 0; Biquad tb[2];
  Os4 os[2]; double dl[OS4_LATENCY] = {}, dr[OS4_LATENCY] = {}; int dp = 0;
  double shp(double x) const;
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
};
class Compressor : public Device {
 public:
  explicit Compressor(double r);
  ~Compressor() override { delete[] dl; delete[] dr; }
  double sr, thr = -18, ratio = 4, atk = 10, rel = 120, mk = 1, gr = 0, knee = 6, cmix = 1, pin = 0, pout = 0, rms = 0, slow = 0, aC = 0, rC = 0, linStep = 0;
  int mode = 0, aut = 0, la = 0, lin = 0, arel = 0, D = 0, dp = 0; float* dl = nullptr; float* dr = nullptr;
  void upd();
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override { o[0] = (float)gr; o[1] = (float)linToDb(pin); o[2] = (float)linToDb(pout); pin *= 0.5; pout *= 0.5; return 3; }
};
class Limiter : public Device {
 public:
  explicit Limiter(double r);
  ~Limiter() override { delete[] dL; delete[] dR; delete[] qv; delete[] qt; delete[] ma; }
  double sr, ceil, rel = 80, in = 1, g = 1, pin = 0, pout = 0, rC = 0, t = 0, ms = 0; int La, W, dp = 0, qh = 0, qn = 0, mp = 0;
  double *dL, *dR, *qv, *qt, *ma;
  void upd() { rC = std::exp(-1 / (jsMax(1, rel) * 0.001 * sr)); }
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override { o[0] = (float)-linToDb(g); o[1] = (float)linToDb(pin); o[2] = (float)linToDb(pout); pin *= 0.5; pout *= 0.5; return 3; }
};
class Reverb : public Device {
 public:
  explicit Reverb(double r);
  ~Reverb() override { for (int c = 0; c < 2; c++) { delete[] cbuf[c]; delete[] abuf[c]; } delete[] pdl; }
  double sr, size = 0.6, damp = 0.5, mix = 0.25, width = 1, lcf = 20, hcf = 20000, fb = 0, d1 = 0; int freeze = 0, pd = 0, pdw = 0, pn = 0;
  int cl[2][8], co[2][8], cidx[2][8] = {}, al[2][4], ao[2][4], aidx[2][4] = {}; float cst[2][8] = {}; float* cbuf[2]; float* abuf[2];
  float tmp[1024] = {}, wv[2][1024] = {}; float* pdl; Biquad lc, hc;
  void upF() { lc.highpass(sr, lcf, 0.707); hc.lowpass(sr, hcf, 0.707); }
  void upd() { fb = freeze ? 1 : 0.7 + 0.28 * size; d1 = freeze ? 0 : damp * 0.4; }
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
};
class ParametricEq : public Device {
 public:
  explicit ParametricEq(double r) : sr(r) { upd(); }
  double sr, f[4] = { 100, 400, 3000, 8000 }, g[4] = { 0, 0, 0, 0 }, q[2] = { 1, 1 }; Biquad b[4][2];
  void upd();
  void setParam(int i, double v) override;
  void process(float* L, float* R, int n) override;
};

}  // namespace mdaw
