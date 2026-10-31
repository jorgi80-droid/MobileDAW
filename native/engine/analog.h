// Port of js/engine/analog.js (Live 12 Analog). Same maths and order of operations as the JS original.
#pragma once
#include "dsp.h"
#include "units.h"

namespace mdaw {

struct AEnv {
  int st = 0; double v = 0;
  void start() { st = 1; v = 0; }
  void release() { if (st) st = 4; }
  double step(double a, double d, double s, double r, double dt, bool ex);
};
struct ASvf { double a = 0, b = 0, h = 0, bp = 0; double run(double x, double g, double k, double inv) { double hh = (x - (k + g) * a - b) * inv, b0 = g * hh + a, lp = g * b0 + b; a = g * hh + b0; b = g * b0 + lp; h = hh; bp = b0; return lp; } };
struct AnVoice { bool on = false, held = false; int pitch = 0; double vel = 0; uint32_t age = 0; double f = 0, gf = 0, ph[2] = {}, sub[2] = {}, nz = 0, uni = 0, pan = 0; AEnv fe[2], ae[2]; ASvf f1[2], f2[2]; int cnt = 0;
  double d[2] = {}, pw[2] = { 0.5, 0.5 }, g[2] = {}, k[2] = { 2, 2 }, inv[2] = { 1, 1 }, amp[2] = {}; };
class Analog : public Instrument {
 public:
  explicit Analog(double rate) : sr(rate) {}
  double sr, bpm = 120, bend = 0, p[92] = {}, lph[2] = {}, lsh[2] = {}, vph = 0; uint32_t counter = 0, seed = 4242; AnVoice v[32]; int held[128]; int nheld = 0;
  void setTempo(double b) override { bpm = b; }
  bool hasSetBend() override { return true; }
  void setBend(double st) override { bend = st; }
  void setParam(int i, double x) override { if (i >= 0 && i < 92) p[i] = x; }
  bool active() override { for (auto& x : v) if (x.on) return true; return false; }
  void start(AnVoice& x, int pt, double vel, bool legato);
  void noteOn(int pt, double vel) override;
  void noteOff(int pt) override;
  void allOff() override { nheld = 0; for (auto& x : v) if (x.on) { x.held = false; for (auto& e : x.fe) e.release(); for (auto& e : x.ae) e.release(); } }
  void render(float* L, float* R, int from, int to) override;
  int voicesOn() override { int n = 0; for (auto& x : v) if (x.on) n++; return n; }
};

}  // namespace mdaw
