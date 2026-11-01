// Port of js/engine/fx5.js: Spectral Time (46) and Spectral Resonator (47) on a shared STFT (Hann, 4x overlap, latency N).
// Float32Array storage in JS = float here; Math.hypot = jsHypot (V8's scaled Kahan sum), fft = the same radix-2 as dsp.js.
#pragma once
#include "dsp.h"
#include "units.h"

namespace mdaw {

double jsHypot(double a, double b);
void jsFft(double* re, double* im, int n);

class Stft {
 public:
  Stft(int N, int hop);
  ~Stft();
  int N, hop, B, k = 0; double scale; double* win;
  float* inp[2]; float* ola[2]; float* out[2]; double* re[2]; double* im[2];
  template <class F> void process(float* L, float* R, int n, F frame) {
    float* a = inp[0]; float* b = inp[1]; float* oa = out[0]; float* ob = out[1];
    for (int i = 0; i < n; i++) {
      a[N - hop + k] = L[i]; b[N - hop + k] = R[i]; L[i] = oa[k]; R[i] = ob[k];
      if (++k == hop) { k = 0; run(frame); }
    }
  }
  template <class F> void run(F frame) { analyse(); frame(re, im); synthesise(); }
  void analyse();
  void synthesise();
};

class SpectralTime : public Device {
 public:
  explicit SpectralTime(double r);
  ~SpectralTime() override;
  static constexpr int N = 2048, HOP = 512, D = 384;
  double sr, bpm = 120, p[32]; Stft st; int B;
  float* mag[2]; float* ph[2]; float* prev[2]; float* pmag[2];
  struct Fz { float* m[2]; float* ph[2]; float* dp[2]; float* om[2]; float* oph[2]; float* odp[2]; bool on = false; double cnt = 0, len = NAN; } fz;
  float* dre[2]; float* dim[2]; int w = 0; uint32_t seed = 5; float* col; double lvIn = 0, lvOut = 0; float son[48] = {};
  void setParam(int i, double v) override { if (i < 0 || i >= 32) return; p[i] = v; if (i == 3 && v < 0.5) fz.on = false; }
  void setTempo(double b) override { bpm = b; }
  int lat() override { return N; }
  double frames(double beats) const { return beats * 60 / bpm * sr / HOP; }
  void process(float* L, float* R, int n) override;
  void frame(double** re, double** im);
  int readOut(float* o) override { o[0] = (float)lvIn; o[1] = (float)lvOut; o[2] = fz.on ? 1 : 0; for (int j = 0; j < 48; j++) o[3 + j] = son[j]; return 51; }
};

class SpectralResonator : public Device {
 public:
  explicit SpectralResonator(double r);
  ~SpectralResonator() override;
  static constexpr int N = 2048, HOP = 512;
  double sr, bpm = 120, p[32]; Stft st; int B;
  float* E[2]; double* phi; float* hf; uint8_t* hit;
  struct Note { int p; double v; }; Note notes[16]; int nn = 0;
  uint32_t seed = 9; double t = 0; float wan[256] = {}; uint8_t gr[256]; double grT = 0; float son[48] = {}; float* col;
  struct V { double f, a; }; V vv[16 * 8 + 8];
  void setParam(int i, double v) override { if (i < 0 || i >= 32) return; p[i] = v; if (i == 0 && jsRound(v) == 0) nn = 0; }
  void setTempo(double b) override { bpm = b; }
  int lat() override { return N; }
  int midiFrom() override { return jsRound(p[0]) == 1 ? (int)jsRound(p[1]) : -1; }
  void noteOn(int pitch, double vel) override;
  void noteOff(int pitch) override;
  void process(float* L, float* R, int n) override;
  void frame(double** re, double** im);
  int readOut(float* o) override { o[0] = (float)nn; for (int j = 0; j < 48; j++) o[1 + j] = son[j]; return 49; }
};

}  // namespace mdaw
