// Port of js/engine/poli.js (Live 12 Poli). Same maths and order of operations, including every call of the modulation source closure
// (each call reads the LFO again, which matters for the S&H / noise shapes).
#pragma once
#include "dsp.h"
#include "units.h"

namespace mdaw {

struct PEnv {
  int st = 0; double v = 0;
  void start() { st = 1; }
  void release() { if (st) st = 4; }
  double step(double a, double d, double s, double r, double dt, bool loop);
};
struct PSvf { double a = 0, b = 0, h = 0; double run(double x, double g, double k, double inv) { double hh = (x - (k + g) * a - b) * inv, bp = g * hh + a, lp = g * bp + b; a = g * hh + bp; b = g * bp + lp; h = hh; return lp; } };
struct PoliVoice {
  bool on = false, held = false; int pitch = 0; double vel = 0; uint32_t age = 0; double f = 0, gf = 0, ps = 0, pb = 0, pr = 0, nz = 0; PEnv fe, ae; PSvf lp[2], hp;
  double ls = 0; int cnt = 0; double t = 0, pan = 0, det = 0, dS = 0, pw = 0.5, g = 0, k = 2, i1 = 1, i2 = 1, hg = 0, hi = 1, amp = 0, ring = 0, lph = 0, lsh = 0;
};
class Poli : public Instrument {
 public:
  explicit Poli(double rate);
  double sr, bpm = 120, bend = 0, p[71] = {}, lph = 0, mix[5] = {}; uint32_t counter = 0, seed = 616; PoliVoice v[16]; int held[128]; int nheld = 0;
  float cl[2048] = {}; double cw = 0, cph = 0; int gi[7][3], mi[7][2];
  void setTempo(double b) override { bpm = b; }
  bool hasSetBend() override { return true; }
  void setBend(double st) override { bend = st; }
  void setParam(int i, double x) override { if (i >= 0 && i < 71) p[i] = x; }
  bool active() override { for (auto& x : v) if (x.on) return true; return false; }
  int mode() { return (int)jsRound(p[65]); }
  void start(PoliVoice& x, int pt, double vel, bool leg);
  void noteOn(int pt, double vel) override;
  void noteOff(int pt) override;
  void allOff() override { nheld = 0; for (auto& x : v) if (x.on) { x.held = false; x.fe.release(); x.ae.release(); } }
  double lfoV(PoliVoice& x);
  void render(float* L, float* R, int from, int to) override;
  int voicesOn() override { int n = 0; for (auto& x : v) if (x.on) n++; return n; }
};

}  // namespace mdaw
