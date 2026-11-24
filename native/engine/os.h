// 4x oversampling around a nonlinear effect (= js/engine/os.js, the same arithmetic): the effect runs at 4 x the engine rate between a
// linear-phase interpolation filter and a decimation filter (one 129-tap windowed sinc, Kaiser beta 8, cut-off at the engine's Nyquist), so
// the harmonics its curve makes above Nyquist are filtered out instead of folding back as inharmonic aliases (Amp / Overdrive / Pedal
// aliased at -17..-20 dB under their own harmonics). Latency 32 frames + the effect's own / 4 (PDC).
#pragma once
#include <cmath>
#include "units.h"

namespace mdaw {

constexpr int OS_K = 4, OS_TAPS = 129, OS_SUB = 32, OS_LAT = 32;   // OS_SUB: engine frames per inner block (128 frames at 4x)
// the filter: a 129-tap windowed sinc (Kaiser beta 8, cut-off 1/8 of the 4x rate = the engine's Nyquist, unity DC gain), stored as
// literals so the desktop and WebAssembly builds use bit-identical taps (their sin() differs in the last bit); first half, the rest mirrors
static const double OS_HALF[65] = { -2.2793406192118978e-20, -0.000013044848518897293, -0.000027075575998030824, -0.000026727957584233550, 2.7449107506564883e-19, 0.000047236731696784379, 0.000085786022021262074, 0.000076560461249701830, -2.3092205157170335e-19, -0.00011701467671170988, -0.00020114803229090693, -0.00017125979008406793, -5.6699522968344124e-19, 0.00024231879525530361, 0.00040333615933344359, 0.00033359528029501041, -8.0635266320076606e-19, -0.00044889373476711175, -0.00073094453934346017, -0.00059244509268003621, 4.6860942895795029e-18, 0.00076894172689418025, 0.0012319907654951931, 0.00098358784547470171, -1.9172281272452542e-18, -0.0012421736606075822, -0.0019656715250163420, -0.0015511851717476127, 2.6916868577606445e-18, 0.0019179665276436964, 0.0030060628837892869, 0.0023509597148402132, -3.5958762700449054e-18, -0.0028600584933125401, -0.0044501914904047325, -0.0034571331123827071, 4.5985173630431555e-18, 0.0041568149322780256, 0.0064357207697408169, 0.0049776860699849998, -5.6538840433944423e-18, -0.0059441189763904312, -0.0091808002964131729, -0.0070891961968622156, 6.7047219816496173e-18, 0.0084595015873546280, 0.013080441606844580, 0.010123317691569524, -7.6868994151664943e-18, -0.012185399781257837, -0.018971667179607715, -0.014815398152203844, 8.5353127995922083e-18, 0.018307285429310031, 0.029038056364666699, 0.023218001739302128, -9.1903553831358893e-18, -0.030743731817464936, -0.051333373193474308, -0.043999154832933540, 9.6041370455141142e-18, 0.074413496592101641, 0.15857790316932435, 0.22487850744868104, 0.25000546362582182 };
inline const double* osTaps() {
  static double h[OS_TAPS]; static bool done = false;
  if (!done) { for (int i = 0; i < OS_TAPS; i++) h[i] = OS_HALF[i < 65 ? i : OS_TAPS - 1 - i]; done = true; }
  return h;
}
class Oversampled : public Device {
 public:
  Device* in; const double* h = osTaps();
  static constexpr int UH = (OS_TAPS + OS_K - 1) / OS_K;            // input history the interpolator needs (33)
  double ux[2][UH] = {}; int up = 0;                                  // input ring (per channel)
  double dx[2][OS_TAPS] = {}; int dp = 0;                             // 4x ring for the decimator
  float bL[OS_SUB * OS_K], bR[OS_SUB * OS_K];
  explicit Oversampled(Device* inner) : in(inner) { hasTr = in->hasTr; }
  ~Oversampled() override { delete in; }
  void tr(bool playing, double beat) override { in->tr(playing, beat); }
  void setParam(int p, double v) override { in->setParam(p, v); }
  void setTempo(double bpm) override { in->setTempo(bpm); }
  int readOut(float* o) override { return in->readOut(o); }
  int lat() override { return OS_LAT + (in->lat() + OS_K - 1) / OS_K; }
  void process(float* L, float* R, int n) override {
    for (int a = 0; a < n; a += OS_SUB) {
      const int m = n - a < OS_SUB ? n - a : OS_SUB;
      float* X[2] = { L + a, R + a }; float* B[2] = { bL, bR };
      int u0 = up;
      for (int c = 0; c < 2; c++) {                                   // interpolate: phase p of input frame i = 4 sum_k h[p + 4k] x[i - k]
        int u = u0; double* hx = ux[c];
        for (int i = 0; i < m; i++) {
          u = u + 1 == UH ? 0 : u + 1; hx[u] = X[c][i];
          for (int p = 0; p < OS_K; p++) {
            double s = 0; int q = u;
            for (int j = p; j < OS_TAPS; j += OS_K) { s += h[j] * hx[q]; q = q == 0 ? UH - 1 : q - 1; }
            B[c][i * OS_K + p] = (float)(s * OS_K);
          }
        }
        if (c == 1) up = u;
      }
      in->process(bL, bR, m * OS_K);
      int d0 = dp;
      for (int c = 0; c < 2; c++) {                                   // decimate: output frame i = sum_j h[j] v[4i - j]
        int d = d0; double* hv = dx[c];
        for (int i = 0; i < m; i++) {
          for (int p = 0; p < OS_K; p++) {
            d = d + 1 == OS_TAPS ? 0 : d + 1; hv[d] = B[c][i * OS_K + p];
            if (p == 0) { double s = 0; int q = d; for (int j = 0; j < OS_TAPS; j++) { s += h[j] * hv[q]; q = q == 0 ? OS_TAPS - 1 : q - 1; } X[c][i] = (float)s; }
          }
        }
        if (c == 1) dp = d;
      }
    }
  }
};
// the effects that run oversampled (units.cpp makeDevice; js/engine/fx.js makeDevice)
// not Roar / FLM Waveshaper (per-sample time constants would change at 4x), not FLM Distortion (kept as FL Studio Mobile renders it)
inline bool osType(int t) { return t == 28 || t == 29 || t == 33 || t == 35 || t == 36; }

}  // namespace mdaw
