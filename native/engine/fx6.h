// Port of js/engine/fx6.js: the Live 12 modulators (48 LFO, 49 Shaper, 50 Envelope Follower). Audio passes through unchanged; after
// every block the engine (engine.cpp applyMod) writes the mapped value into the target device / instrument parameter.
// Mapping block at index MAP (same in all three): mode (remap / mod), bipolar, amount, min, max, then hidden: target strip (-1 = none),
// device index (-1 = instrument), parameter, target min, target max, log, base value.
#pragma once
#include "dsp.h"
#include "units.h"

namespace mdaw {

class Mod : public Device {
 public:
  Mod(double r, int map) : sr(r), MAP(map) { isMod = true; for (auto& v : p) v = 0; }
  static constexpr int NP = 64;
  double sr, bpm = 120, m = 0, p[NP]; int MAP; float hist[128] = {}; int hw = 0;
  void setTempo(double b) override { bpm = b; }
  bool modTarget(int& s, int& d, int& k, double& v) override;
  void push() { hist[hw & 127] = (float)m; hw++; }
  int readOut(float* o) override { o[0] = (float)m; for (int j = 0; j < 128; j++) o[1 + j] = hist[(hw + j) & 127]; return 129; }
  void setMapDefaults() { const double d[12] = { 0, 0, 0.5, 0, 1, -1, 0, 0, 0, 1, 0, 0 }; for (int i = 0; i < 12; i++) p[MAP + i] = d[i]; }
};

class LfoMod : public Mod {
 public:
  explicit LfoMod(double r);
  double ph = 0, rv = 0, jv = 0, sm = 0, rt = 0; uint32_t seed = 21;
  void setParam(int i, double v) override;
  double wave(double x) const;
  void process(float* L, float* R, int n) override;
};
class ShaperMod : public Mod {
 public:
  explicit ShaperMod(double r);
  double ph = 0, jv = 0, sm = 0; uint32_t seed = 31;
  void setParam(int i, double v) override { if (i >= 0 && i < NP) p[i] = v; }
  double shape(double x) const;
  void process(float* L, float* R, int n) override;
};
class EnvFollower : public Mod {
 public:
  explicit EnvFollower(double r);
  double env = 0; float dl[4096] = {}; int dw = 0; float lv[128] = {}; int lw = 0;
  void setParam(int i, double v) override { if (i >= 0 && i < NP) p[i] = v; }
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override { int k = Mod::readOut(o); for (int j = 0; j < 128; j++) o[k + j] = lv[(lw + j) & 127]; return k + 128; }
};

}  // namespace mdaw
