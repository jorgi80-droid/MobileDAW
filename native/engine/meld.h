// Port of js/engine/meld.js (Live 12 Meld). Same maths and order of operations as the JS original.
#pragma once
#include "dsp.h"
#include "units.h"

namespace mdaw {

struct MEnv {
  int st = 0; double v = 0;
  void start() { st = 1; }
  void release() { if (st) st = 4; }
  double step(double a, double d, double s, double r, double dt);
};
struct MSvf { double a = 0, b = 0, h = 0, bp = 0; double run(double x, double g, double k, double inv) { double hh = (x - (k + g) * a - b) * inv, b0 = g * hh + a, lp = g * b0 + b; a = g * hh + b0; b = g * b0 + lp; h = hh; bp = b0; return lp; } };
struct MEng {
  double src[5] = {}, lv1 = 0, lv2 = 0, ph[8] = {}, sv[2] = {}, z = 0, hold = 0, hv = 0; float nl[2048] = {}; int nlp = 0, nll = 0; MSvf f1, f2; float comb[4096] = {}; double cw = 0; MEnv ae, me;
  double l1 = 0, l2 = 0, s1 = 0, s2 = 0, t = 0, tz = 0, d = 0, shape = 0, tone = 0, g = 0, k = 2, inv = 1, inv2 = 1, morph = 0, amp = 0, pl = 1, pr = 1, cd = 100, cq = 0, tilt = 0; int ft = 0;
};
struct MeldVoice { bool on = false, held = false; int pitch = 0; double vel = 0; uint32_t age = 0; double f = 0; MEng e[2]; int cnt = 0; double det = 0, pan = 0; };
class Meld : public Instrument {
 public:
  explicit Meld(double rate);
  ~Meld() override { delete[] v; }
  double sr, bpm = 120, bend = 0, p[159] = {}, g1[2] = {}, g2[2] = {}; uint32_t counter = 0, seed = 909; MeldVoice* v; int held[128]; int nheld = 0;
  void setTempo(double b) override { bpm = b; }
  bool hasSetBend() override { return true; }
  void setBend(double st) override { bend = st; }
  void setParam(int i, double x) override { if (i >= 0 && i < 159) p[i] = x; }
  bool active() override { for (int k = 0; k < 16; k++) if (v[k].on) return true; return false; }
  void start(MeldVoice& x, int pt, double vel);
  void noteOn(int pt, double vel) override;
  void noteOff(int pt) override;
  void allOff() override { nheld = 0; for (int k = 0; k < 16; k++) if (v[k].on) { v[k].held = false; for (auto& E : v[k].e) { E.ae.release(); E.me.release(); } } }
  double lfo(double w, double x, double sh, double fold, double s);
  double osc(MEng& E, int type);
  double filt(MEng& E, double x);
  void render(float* L, float* R, int from, int to) override;
  int voicesOn() override { int n = 0; for (int k = 0; k < 16; k++) if (v[k].on) n++; return n; }
};

}  // namespace mdaw
