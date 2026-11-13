// Port of js/engine/hdgms.js: GMS (type 31) on Honeydew's GMSynth model (https://github.com/daijro/honeydew, crates/audio/src/gmsynth.rs +
// gm_waveshapes.rs, GPL-3.0-or-later, see THIRD_PARTY_NOTICES.md). The JS file is the reference; this renders the same samples: scalar
// maths in double in the JS operation order, tables in float, 32-bit phases, no FMA.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#pragma once
#include "units.h"
#include "jsmath.h"
#include "hdmfx.h"
#include <vector>
#include <cstdint>

namespace mdaw {

struct GmEnv { double e = 0; int st = 0; };   // 0 idle, 1 attack, 2 decay, 3 release
struct GmRates { double a = 0, d = 0, s = 0, r = 0; };
struct GmVoice {
  int key = 0; double vel = 0, panL = 1, panR = 1, age = 0, p = 0; GmEnv amp, fenv, menv, eg; double gain = 0, s = 0, sT = 0; bool snap = false;
  uint32_t pa[4] = {}, pb[4] = {}; double sa[4] = {}, sb[4] = {}; int ta = 0, tb = 0; double y[2][8] = {}; uint32_t noise = 1;
};
struct GmControl {
  GmRates amp, fenv, menv, eg; int copies = 1; double ratio[4] = {}, cpL[4] = {}, cpR[4] = {}, gainA = 0, gainB = 0, noise = 0, ratioB = 1, offset = 0, slide = 0;
  bool velDepth = false; double egFilter = 0, egMod = 0, egPitch = 0; int lfoShape = 0; double lfoFilter = 0, lfoMod = 0, lfoPitch = 0, lfoModNow = 0; int modKind = 0;
  double modContour = 0, modTarget = 0, syncBase = 0, fltContour = 0, cutoff = 0, kbd = 0, mwFilter = 0, res = 0; int fltKind = 0; double level = 0, pan = 0.5;
};

class HdGms : public Instrument {
 public:
  explicit HdGms(double sr);
  void setParam(int i, double x) override;
  void noteOn(int key, double vel) override;
  void noteOff(int key) override;
  void render(float* L, float* R, int from, int to) override;
  bool active() override;
  void allOff() override;
  void setTempo(double b) override { if (b > 0 && std::isfinite(b)) bpm = b; }
  bool hasSetBend() override { return true; }
  void setBend(double st) override { bendSt = std::isfinite(st) ? st : 0; slideSt = 0; }
  void setBendSl(double st, double sl) override { bendSt = std::isfinite(st) ? st : 0; slideSt = std::isfinite(sl) ? sl : 0; }
  void setSongPos(bool pl, double b) override { playing = pl; if (pl && std::isfinite(b)) beat = b; }
  void setMod(double x) override { wheel = clamp(x == x ? x : 0, 0, 1); }
 private:
  double sr; double p[68] = {}; const float* FT; GmVoice v[4]; bool held[128] = {};
  double bendSt = 0, slideSt = 0, wheel = 0, bpm = 120, beat = 0; bool playing = false; uint32_t rng;
  MfxBank fx0, fx1, fx2; int fxKind[3] = {-1, -1, -1};
  uint32_t dither[32] = {}; double lfo[32] = {}, amount[32] = {}, busL[32] = {}, busR[32] = {};
  GmControl c; const float* wa; const float* wb;
  int last = -1; double serial = 0; int blockPos = 0; double lfoPhase = 0; bool snap = true; double modAmount = 0, level = 0, pan = 0.5;
  void reset();
  double ratioB() const;
  void release(GmVoice& o);
  void glide(GmVoice& o);
  void voiceControl(GmVoice& o);
  void control();
  void voice(GmVoice& o, int n);
};

}  // namespace mdaw
