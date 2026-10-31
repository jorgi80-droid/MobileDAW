// Port of js/engine/drift.js (Live 12 Drift). Same maths and order of operations as the JS original.
#pragma once
#include "dsp.h"
#include "units.h"

namespace mdaw {

struct DEnv {
  int st = 0; double v = 0;
  void start(bool legato) { st = 1; if (!legato) v = 0; }
  void release() { if (st) st = 4; }
  double step(double a, double d, double s, double r, double dt, bool cyc);
};
struct DSvf2 {
  double a = 0, b = 0;
  double run(double x, double g, double k, double inv) { double h = (x - (k + g) * a - b) * inv, bp = g * h + a, lp = g * bp + b; a = g * h + bp; b = g * bp + lp; return lp; }
  double hp(double x, double g, double inv) { double h = (x - (1.4142 + g) * a - b) * inv, bp = g * h + a, lp = g * bp + b; a = g * h + bp; b = g * bp + lp; return h; }
};
struct DriftVoice {
  bool on = false, held = false; int pitch = 0; double vel = 0; uint32_t age = 0; double f = 0, ph1 = 0, ph2 = 0; DEnv e1, e2;
  double lph = 0, lsh = 0, wan = 0, wanT = 0, wanG = 0, drift = 0, dT = 0, dG = 0, rnd = 0; DSvf2 fl[2], fr[2], hl, hr; double pan = 0; int cnt = 0; double glideF = 0, det = 0;
};
class Drift : public Instrument {
 public:
  explicit Drift(double rate);
  double sr, bpm = 120, bend = 0, gainOut = 0.32, p[68] = {}, md[13] = {}; uint32_t counter = 0, seed = 7331; DriftVoice v[32]; int held[128]; int nheld = 0;
  void setTempo(double b) override { bpm = b; }
  bool hasSetBend() override { return true; }
  void setBend(double st) override { bend = st; }
  void setParam(int i, double x) override { if (i >= 0 && i < 68) p[i] = x; }
  bool active() override { for (auto& x : v) if (x.on) return true; return false; }
  int maxVoices();
  DriftVoice& alloc(int n);
  void start(DriftVoice& x, int pt, double vel, bool legato);
  void noteOn(int pt, double vel) override;
  void noteOff(int pt) override;
  void allOff() override { nheld = 0; for (auto& x : v) if (x.on) { x.held = false; x.e1.release(); x.e2.release(); } }
  double lfoHz(DriftVoice& x);
  double lfo(DriftVoice& x);
  double src(DriftVoice& x, int s, double e1, double e2, double lf) { return s == 0 ? e1 : s == 1 ? e2 : s == 2 ? lf : s == 3 ? x.vel : s == 4 ? (x.pitch - 60) / 60.0 : x.rnd * 2 - 1; }
  void render(float* L, float* R, int from, int to) override;
  int voicesOn() override { int n = 0; for (auto& x : v) if (x.on) n++; return n; }
};

}  // namespace mdaw
