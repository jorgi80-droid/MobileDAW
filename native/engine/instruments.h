// Ports of js/engine/instruments.js (one class per instrument, same names as in JS).
#pragma once
#include "dsp.h"
#include "units.h"

namespace mdaw {

// JS class Base: voice allocation (free voice or steal the oldest), note off by pitch, release all
template <class V, int NV>
class PolyBase : public Instrument {
 public:
  explicit PolyBase(double rate) : sr(rate) {}
  double sr; uint32_t counter = 0; uint32_t seed = 12345;
  V v[NV];
  V& alloc() {
    int k = -1;
    for (int i = 0; i < NV; i++) if (!v[i].on) { k = i; break; }
    if (k < 0) { k = 0; for (int i = 1; i < NV; i++) if (v[i].age < v[k].age) k = i; }
    return v[k];
  }
  bool active() override { for (auto& x : v) if (x.on) return true; return false; }
  void allOff() override { for (auto& x : v) if (x.on) { x.held = false; x.env.release(); } }
  void noteOff(int p) override { for (auto& x : v) if (x.on && x.held && x.pitch == p) { x.held = false; x.env.release(); } }
  int voicesOn() override { int n = 0; for (auto& x : v) if (x.on) n++; return n; }
};

struct VoiceBase { bool on = false, held = false; int pitch = 0; double vel = 0; uint32_t age = 0; Adsr env; };

struct MiniVoice : VoiceBase { double ph = 0, dt = 0; Biquad f; };
class MiniSynth : public PolyBase<MiniVoice, 16> {
 public:
  explicit MiniSynth(double rate);
  double wave = 0, cutoff = 8000, a = 0.005, d = 0.15, s = 0.7, r = 0.25, gain = 0.35;
  AdsrP ap; Biquad coef;
  void upEnv() { ap = adsrParams(a, d, s, r, sr); }
  void upFilter() { coef.lowpass(sr, cutoff, 0.707); }
  void setParam(int i, double x) override;
  void noteOn(int p, double vel) override;
  void render(float* L, float* R, int from, int to) override;
  bool canBend() override { return true; }
  void bendSounding(double r0) override { for (auto& x : v) if (x.on) x.dt *= r0; }
  void bendNewest(double r0) override { for (auto& x : v) if (x.on && x.age == counter) x.dt *= r0; }
};

struct SawVoice : VoiceBase { double ph[7] = {}; Biquad fl, fr; double f0 = 0; };
class SuperSaw : public PolyBase<SawVoice, 12> {
 public:
  explicit SuperSaw(double rate);
  double det = 25, mix = 0.75, cutoff = 9000, a = 0.01, r = 0.4, gain = 0.3;
  AdsrP ap; Biquad coef;
  const double off[7] = { 0, -1, 1, -2, 2, -3, 3 }, pl[7] = { 0.5, 0.15, 0.85, 0.3, 0.7, 0.05, 0.95 };
  double lev[7] = {}, dts[7] = {};
  void upEnv() { ap = adsrParams(a, 0.1, 1, r, sr); }
  void setParam(int i, double x) override;
  void noteOn(int p, double vel) override;
  void render(float* L, float* R, int from, int to) override;
  bool canBend() override { return true; }
  void bendSounding(double r0) override { for (auto& x : v) if (x.on) x.f0 *= r0; }
  void bendNewest(double r0) override { for (auto& x : v) if (x.on && x.age == counter) x.f0 *= r0; }
};

}  // namespace mdaw
