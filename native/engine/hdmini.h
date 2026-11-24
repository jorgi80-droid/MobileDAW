// Port of js/engine/hdmini.js: MiniSynth (type 32) on Honeydew's model (https://github.com/daijro/honeydew, crates/audio/src/minisynth.rs,
// GPL-3.0-or-later, see THIRD_PARTY_NOTICES.md). The JS file is the reference; this renders sample-for-sample the same (golden):
// scalar maths in double in the JS operation order, tables and delay lines in float, 32-bit phases, no FMA.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#pragma once
#include "units.h"
#include "jsmath.h"
#include <vector>
#include <cstdint>

namespace mdaw {

struct MsEnv { double lv = 0, tg = 0, rate = 0; int st = 0; };   // 0 off, 1 attack, 2 decay, 3 release
struct MsVoice {
  bool busy = false; int key = 0; double vel = 0, pan = 0.5, started = 0; MsEnv amp, feg;
  double pitch = 0, drift = 0, freq = 0; int wave = 0; uint32_t ph[8] = {}, inc[8] = {}, ofs[5] = {};
  double gL = 0, gR = 0, tL = 0, tR = 0, cutoff = 0, m[25] = {}, t[25] = {}, s[4] = {}, dc = 0;
};
struct MsControl {
  double decA = 1, decF = 1, susA = 1, susF = 1, glide = 1, transpose = 0; int kind = 0; double mod = 0, interval = 1, noise = 0, lfoPitch = 0, log2cut = 14.3, envAmt = 1, res = 0;
  double drive = 0, driveGain = 1; int hold = 0, dframes = 1; double dfb = 0, dco = 1, dmix = 0, phT = 1e-5, phW = 0, phCos = 1, phFb = 0, phMix = 1e-5, chDepth = 0.04, chR0 = 0.2, chR1 = 0.25, chMix = 0, gain = 1;
};

class HdMiniSynth : public Instrument {
 public:
  explicit HdMiniSynth(double sr);
  void setParam(int i, double x) override;
  void noteOn(int key, double vel) override;
  void noteOff(int key) override;
  void render(float* L, float* R, int from, int to) override;
  bool active() override;
  void allOff() override;
  void setTempo(double b) override { if (b > 0 && std::isfinite(b)) bpm = b; }
  bool hasSetBend() override { return true; }
  void setBend(double st) override { bend = std::isfinite(st) ? st : 0; }
  void setBendSl(double st, double sl) override { bend = (std::isfinite(st) ? st : 0) + (std::isfinite(sl) ? sl : 0); }
  void setSongPos(bool playing, double b) override { if (playing && std::isfinite(b)) beat = b; }
  void setMod(double x) override { wheel = clamp(x == x ? x : 0, 0, 1); }
 private:
  double sr; double p[44] = {}; const float* T; MsVoice v[5];
  double held[128]; double bend = 0, wheel = 0, bpm = 120, beat = 0, serial = 0; int last = -1; uint32_t rng = 0x12345678u;
  int blockPos = 0; bool running = false; int tail = 0; double dpeak = 0;
  int dlen; std::vector<float> dl; int dpos = 0; double dlp = 0;
  int chN, chLen; std::vector<float> ch; int chPos = 0; double chPh0 = 0.62, chPh1 = 0.1;
  double apIn[12] = {}, apOut[12] = {}, phOut[2] = {}, phS = 0, decS[2] = {}; int decN = 0;
  MsControl c;
  int mode() const { return (int)clamp(jsRound(p[23]), 0, 2); }
  int tailFrames() const { return (int)std::trunc(0.5 * sr); }
  void reset();
  void update();
  void release(MsVoice& o);
  void voiceControl(MsVoice& o);
  void controlBlock();
  void frames(float* Lo, float* Ro, int at, int n);
};

}  // namespace mdaw
