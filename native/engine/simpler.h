// Port of js/engine/simpler.js (Live 12 Simpler): Classic / 1-Shot / Slice, Warp Re-Pitch / Beats, filter, LFO, envelopes.
#pragma once
#include "dsp.h"
#include "units.h"

namespace mdaw {

struct SEnv {
  int st = 0; double v = 0;
  void start() { st = 1; v = 0; }
  void release() { if (st) st = 4; }
  double step(double a, double d, double s, double r, double dt);
};
struct SSvf { double a = 0, b = 0, h = 0, bp = 0; double run(double x, double g, double k, double inv) { double hh = (x - (k + g) * a - b) * inv, b0 = g * hh + a, lp = g * b0 + b; a = g * hh + b0; b = g * b0 + lp; h = hh; bp = b0; return lp; } };
struct SimVoice {
  bool on = false, held = false; int pitch = 0; double vel = 0; uint32_t age = 0; double pos = 0, tpos = 0, gp = 0, s0 = 0, s1 = 0; int slice = -1; SEnv ae, fe, pe; SSvf fl[2], fr[2];
  double lph = 0, lsh = 0, t = 0; int cnt = 0; double rate = 1, amp = 0, pl = 1, pr = 1, g = 0, k = 2, i1 = 1, i2 = 1, rp = 0, gf = 0, fadeOut = -1, fo = 1, det = 0, span = 0;
};
class Simpler : public Instrument {
 public:
  Simpler(double rate, Bank* b) : sr(rate), bank(b) {}
  double sr, bpm = 120, bend = 0, p[64] = {}; Bank* bank; uint32_t counter = 0, seed = 1818; SimVoice v[32]; double lastF = 0, lastL = 0, ol = 0, orr = 0;
  struct { int id = -1, root = 60; double s0 = 0, s1 = 1, l0 = 0, l1 = 1, xf = 0, vol = 0; bool rev = false; } z;
  double slices[66]; int nsl = 0; double skey[9] = { -1e300 };
  void setTempo(double b) override { bpm = b; }
  bool hasSetBend() override { return true; }
  void setBend(double st) override { bend = st; }
  void setParam(int i, double x) override;
  bool active() override { for (auto& x : v) if (x.on) return true; return false; }
  Sample* smp() { Sample* s = z.id >= 0 && z.id < 256 ? bank->s[z.id] : nullptr; return s && s->frames > 4 ? s : nullptr; }
  void getSlices(Sample* s);
  void noteOn(int pt, double vel) override;
  void noteOff(int pt) override;
  void allOff() override { for (auto& x : v) if (x.on) { x.held = false; x.ae.release(); x.fe.release(); x.pe.release(); if (jsRound(p[0]) == 1) x.fadeOut = 0.01; } }
  void read(Sample* s, double pos);
  double filt(SSvf* F, double x, SimVoice& vv, int ft, bool two);
  void render(float* L, float* R, int from, int to) override;
  int voicesOn() override { int n = 0; for (auto& x : v) if (x.on) n++; return n; }
};

}  // namespace mdaw
