// DirectWave (FL Studio Mobile's DW Sampler, MobileDAW type 30), written once in C++ (the engine of the app on Android and, as
// WebAssembly, on the web): a port of Honeydew's DW Sampler (https://github.com/daijro/honeydew, crates/audio/src/dw_sampler.rs + voice.rs,
// GPL-3.0-or-later, by daijro; see THIRD_PARTY_NOTICES.md). Linear-interpolated playback, a linear amp envelope (level squared), a filter
// (zero-delay-feedback 4-pole ladder for LP, state-variable BP / HP) with its own one-pole envelope, a frequency envelope and an LFO per
// voice (ticks of 16 samples), glide, legato / mono hand-over.
// Parameters (defs.js INSTRUMENTS[30]): 0 Pitch st, 1 Fine ct, 2 Attack s, 3 Decay s, 4 Sustain, 5 Release s (FLM's law T = 0.001 + 10 v^4),
// 6 Slide s (glide time constant, FLM (v / 2)^3), 7 PB Range st, 8 Reverse, 9 Loop, 10 Legato, 11 Mono, 12 Cutoff, 13 Res, 14 Kbd Trk,
// 15 Vel Trk (0..100 = FLM's 0..1), 16 Filter (Off / Lowpass / Highpass / Bandpass), 17..20 filter envelope A D S R (FLM's sliders 0..100,
// S 0..1), 21 its amount (-100..100), 22..26 the frequency envelope the same way, 27 LFO Mode (Hertz / One Shot / Tmp Sync), 28 LFO Rate Hz,
// 29 LFO Sync (FLM's 10 steps), 30 LFO Shape (Sine / Saw / Square / Random), 31 LFO Attack s, 32 LFO Amount (-100..100), 33 LFO Destination
// (Filter / Frequency / Level / Pan), 34 Level dB (MobileDAW's output gain).
// Zones as the other samplers: 100 + zone * 8 + field (0 sample id, 1 root, 2 lo, 3 hi, 4 vlo, 5 vhi, 6 tune ct, 7 loop), 300 + zone * 2 level dB
// / pan. Every zone that answers the key and velocity plays (MobileDAW layers = separate FLM modules).
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#pragma once
#include "units.h"
#include "jsmath.h"
#include <cstdint>

namespace mdaw {

constexpr int HDW_ZONES = 16, HDW_VOICES = 64;
struct HdwZone { int id = -1, root = 60, lo = 0, hi = 127, vlo = 1, vhi = 127; double tune = 0; bool loop = false; double gain = 1, pan = 0; };
struct HdwExpEnv { double e = 0; bool decaying = false, released = false; };
struct HdwFilter { int kind = 0; double c[4] = {}, s[2][4] = {}; };
struct HdwLfo { double phase = 0, fade = 0, random = 0, out = 0, level = 1, pan = 0; };
struct HdwVoice {
  int stage = 0;                       // 0 off, 1 attack, 2 decay, 3 sustain, 4 release, 5 kill
  double level = 0; int key = 0, zone = 0; double pos = 0; bool reverse = false; double vel = 0, glide = 0, slideSt = 0;
  HdwExpEnv fenv, penv; HdwLfo lfo; int tick = 0; HdwFilter filter;
};

class HdDirectWave : public Instrument {
 public:
  HdDirectWave(double sr, Bank* bank);
  void setParam(int i, double x) override;
  void noteOn(int key, double vel) override;
  void noteOff(int key) override;
  void render(float* L, float* R, int from, int to) override;
  bool active() override { for (auto& v : voices) if (v.stage) return true; return false; }
  void allOff() override { held = 0; for (auto& v : voices) release(v); }
  void setTempo(double b) override { if (b > 0 && std::isfinite(b)) bpm = b; }
  bool hasSetBend() override { return true; }
  void setBend(double st) override { bendSt = std::isfinite(st) ? st : 0; slideSt = 0; }   // the wheel sends +-2: FLM's w = +-1 x PB Range
  void setBendSl(double st, double sl) override { bendSt = std::isfinite(st) ? st : 0; slideSt = std::isfinite(sl) ? sl : 0; }
  void setSongPos(bool pl, double b) override { playing = pl; beat = b; }
  int voicesOn() override { int n = 0; for (auto& v : voices) if (v.stage) n++; return n; }
 private:
  double sr; Bank* bank; double p[35] = {}; HdwZone z[HDW_ZONES]; HdwVoice voices[HDW_VOICES];
  uint8_t heldKeys[128] = {}; int held = 0; double last = -1; uint32_t rng = 0x9E3779B9u;
  double bendSt = 0, slideSt = 0, bpm = 120, beat = 0; bool playing = false;
  void release(HdwVoice& v);
  void hold(int key); void unhold(int key);
};

}  // namespace mdaw
