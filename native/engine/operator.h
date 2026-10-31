// Port of js/engine/operator.js (Live 12 Operator). Same maths and order of operations as the JS original.
#pragma once
#include "dsp.h"
#include "units.h"

namespace mdaw {

struct OpEnv {
  int st = 0; double v = 0;
  void start(double init) { st = 1; v = init; }
  void release() { if (st && st < 4) st = 4; }
  double step(double a, double d, double s, double r, double ini, double pk, int loop, double dt);
};
struct OpVoice { bool on = false, held = false; int pitch = 0; double vel = 0; uint32_t age = 0; double f = 0, ph[4] = {}, dt[4] = {}, lv[4] = {}, fb[4] = {}, out[4] = {}; OpEnv e[4], fe; double tz = 0, a = 0, b = 0; int cnt = 0; };
class Operator : public Instrument {
 public:
  explicit Operator(double rate) : sr(rate) {}
  double sr, bpm = 120, bend = 0, p[96] = {}; uint32_t counter = 0, seed = 991; OpVoice v[16]; int wav[4] = {}; bool on[4] = { true, false, false, false };
  void setTempo(double b) override { bpm = b; }
  bool hasSetBend() override { return true; }
  void setBend(double st) override { bend = st; }
  void setParam(int i, double x) override { if (i >= 0 && i < 96) p[i] = x; }
  bool active() override { for (auto& x : v) if (x.on) return true; return false; }
  void noteOn(int pt, double vel) override;
  void noteOff(int pt) override { for (auto& x : v) if (x.on && x.held && x.pitch == pt) { x.held = false; for (auto& e : x.e) e.release(); x.fe.release(); } }
  void allOff() override { for (auto& x : v) if (x.on) { x.held = false; for (auto& e : x.e) e.release(); x.fe.release(); } }
  void render(float* L, float* R, int from, int to) override;
  int voicesOn() override { int n = 0; for (auto& x : v) if (x.on) n++; return n; }
};

}  // namespace mdaw
