// Port of js/engine/hdsaw.js: SuperSaw (type 33) on Honeydew's model (https://github.com/daijro/honeydew, crates/audio/src/supersaw.rs,
// GPL-3.0-or-later, see THIRD_PARTY_NOTICES.md). The JS file is the reference; this renders sample-for-sample the same (golden flm-*):
// scalar maths in double in the JS operation order, wavetable and delay lines in float, 32-bit phases, no FMA.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#pragma once
#include "units.h"
#include "jsmath.h"
#include <vector>
#include <cstdint>

namespace mdaw {

struct HdEnv { double lv = 0; int st = 0; };   // 0 idle, 1 attack, 2 decay, 3 release
struct HdLadder { double P[16] = {}, Q[4] = {}, T[16] = {}, g = -1, r = -1; };
struct HdVoice {
  int note = 0; double vel = 0, pan = 0.5; double age = 0, pitch = 0, glide = 0, flip = 1;
  HdEnv amp, feg, seg; bool reAttack = false;
  double lfoPh = 0, lfoFade = 0, lfoRnd = 0;
  uint32_t ph[12] = {}, sph[12] = {};
  bool sync = false; int nu = 1; uint32_t inc[12] = {}; int tbl[12] = {}; uint32_t sinc[12] = {}; int stbl[12] = {};
  bool panOn = false; double panL[12] = {}, panR[12] = {}; bool pulseOn = false; uint32_t pulse = 0; double subLv = 0;
  int pairs = 0; uint32_t starts[6] = {}, ends[6] = {};
  HdLadder lad; double y0[4] = {}, y1[4] = {};
  double gL = 0, gR = 0, tL = 0, tR = 0; uint32_t rng = 0;
};
struct HdControl {
  double aA = 1, aD = 1, aS = 1, aR = 1, aRe = 1, fA = 1, fD = 1, fS = 1, fR = 1, sA = 1, sD = 1, sS = 1, sR = 1;
  int shape = 0, mode = 0, dest = 0; double amount = 0, step = 0, syncPh = 0, fade = 1, tune = 0, drive = 0, dnorm = 1, gain = 1;
  int dframes = 1; double fb = 0, mix = 0, dfilt = 1;
};

class HdSuperSaw : public Instrument {
 public:
  explicit HdSuperSaw(double sr);
  void setParam(int i, double x) override;
  void noteOn(int key, double vel) override;
  void noteOff(int key) override;
  void render(float* L, float* R, int from, int to) override;
  bool active() override;
  void allOff() override;
  void setTempo(double b) override { if (b > 0 && std::isfinite(b)) bpm = b; }
  bool hasSetBend() override { return true; }
  void setBend(double st) override { bendSt = st / 2 * p[40]; }
  void setBendSl(double st, double sl) override { bendSt = st / 2 * p[40] + sl; }
  void setSongPos(bool playing, double b) override { if (playing) beat = b; }
 private:
  double sr; double p[60] = {}; const float* T; HdVoice v[8];
  double serial = 0; double held[128]; int heldN = 0; int last = -1; int tickPos = 0;
  double bendSt = 0, bpm = 120, beat = 0, lfoPh = 0; uint32_t rng;
  bool arpOn = false; int arpStepN = 0; double arpTimer = 0;
  int dlen; std::vector<float> dl[2]; int dpos = 0; double dz[2] = {0, 0};
  double mixL[24] = {}, mixR[24] = {}; double tail = 0;
  HdControl c;
  int arpMode() const { return (int)clamp(jsRound(p[51]), 0, 5); }
  void update();
  void start(int key, double vel, double pan);
  void rel(HdVoice& o);
  void releaseAll() { for (auto& o : v) rel(o); }
  double arpStep();
  void tick();
  void advance(HdVoice& o);
  void compute(HdVoice& o);
  void voice(HdVoice& o, int n);
  void effects(float* Lo, float* Ro, int at, int n);
};

}  // namespace mdaw
