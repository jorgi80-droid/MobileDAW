// Port of js/engine/hdmfx.js: FL Studio Mobile's MultiFX processor bank on Honeydew's model (https://github.com/daijro/honeydew,
// crates/audio/src/multifx.rs, multifx_delay.rs, multifx_reverb.rs, GPL-3.0-or-later, see THIRD_PARTY_NOTICES.md). The JS file is the
// reference; this renders the same samples: scalar maths in double in the JS operation order, delay lines in float, no FMA.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#pragma once
#include "jsmath.h"
#include <vector>
#include <cstdint>

namespace mdaw {

struct MfxFilter { double z[32] = {}, pre[6] = {}, b0 = 0, b1 = 0, a1 = 0, a2 = 0, wet = 0; void clear(); void set(double f, double res, double sr, bool hp); void run(double* io, double target); };
struct MfxFlanger { double span = 4; std::vector<float> s; int cur = 0; double speed = 0, tspeed = 0, fb = 0, wet = 0; void init(double sr); void clear(); void set(double x, double y, double lfo); void run(double* io, double target); };
struct MfxPanner { std::vector<float> s[2]; int cur = 0; double wet = 0, pan = -1, dist = -1, tpan = 0.5, tdist = 0; void init(double sr); void clear(); void set(double x, double y, double lfo); void run(double* io, double target); };
struct MfxPhaser { double st[12] = {}, fbk[2] = {}, wet = 0, og = 0, co = 0, fg = 0; void clear(); void set(double x, double y, double lfo, double sr); void run(double* io, double target); };
struct MfxVowel { double z[64] = {}, b0[8] = {}, a1[8] = {}, a2[8] = {}, wet = 0, og = 0, sg = 0; void clear(); void set(double x, double y, double lfo, double sr); void run(double* io, double target); };
struct MfxCrusher { double h[2] = {}; int count = 0, hold = 0; double gain = 0, knee = 0; void clear(); void set(double x, double y, double lfo); void run(double* io); };
struct MfxRing { double phase = 0, step = 0, wet = 0, og = 0; void clear(); void set(double x, double lfo, double sr); void run(double* io, double target); };
struct MfxDelay { double sr = 44100; int cap = 4; std::vector<float> ring[2]; int cur = 0, dly = 1; double x = 0.5, y = 0.5, wet = 0, f1[2] = {}, f2[2] = {}, la = 0; int ls = 0; double lph = 0, linc = 0;
  void init(double rate); void resetAudio(); void clear(); void configure(double x, double y, double rateBeats, double amount, int shape, double bpm, double startBeat); void run(double* io, double target); };
struct MfxLine { std::vector<float> s; int cur = 0; void init(int maxFrames); double read(double frames) const; void push(double x); void clear(); };
struct MfxReverb { double sr = 44100, wet = 0, decay = 1, late = 0, lateT = 0, damp = 1, hp = 0, prev = 0, hpk = 0; MfxLine dif[4]; double difFr[4] = {}, difG[4] = {}; MfxLine L[4], R[4]; double lFr[4] = {}, rFr[4] = {}, lDamp[4] = {}, rDamp[4] = {}, tl[4] = {}, tr[4] = {};
  void init(double rate); void refresh(double x, double y); double branch(bool left, const double* taps, const double* opp, double input); void run(double* io, double target); void clear(); };

class MfxBank {
 public:
  explicit MfxBank(double sr);
  void prepare(double x0, double y, double rateBeats, double amount, int shape, double bpm, double startBeat, int frames);
  void frame(double* io, int sel);
  void reset();
  bool busy() const;
 private:
  double sr, bpm = 120, lph = 0;
  MfxCrusher crusher; MfxFlanger flanger; MfxPhaser phaser; MfxFilter lpf, hpf; MfxDelay delay; MfxReverb reverb; MfxPanner panner; MfxRing ring; MfxVowel vowel;
  bool run[10] = {}; double idle[10] = {}, quiet[10] = {}, skip[10] = {}, tail[10] = {};
  double& wetOf(int k); void runK(int k, double* io, double target); void clearK(int k);
};
double mfxLfo(int shape, double phase, double inc);

}  // namespace mdaw
