// Ports of the classic instruments in js/engine/instruments.js: Sampler (4 / 9 = DirectWave / Keystone), GMS (5), Moisture (7),
// Osphere (8), SoundFont player (6). Same names, same order of operations (Float32Array storage = float, JS numbers = double).
#pragma once
#include <vector>
#include "instruments.h"

namespace mdaw {

// ---------------------------------------------------------------- Sampler (DirectWave / Keystone)
constexpr int N_ZONES = 16;
struct SmpZone { int id = -1, root = 60, lo = 0, hi = 127, vlo = 1, vhi = 127; double tune = 0; bool loop = false; };
struct SmpVoice : VoiceBase { double pos = 0, ratio = 1; int id = -1; bool loop = false; Biquad fL, fR; double fade = 0, fd = 0; };
class Sampler : public PolyBase<SmpVoice, 24> {
 public:
  Sampler(double rate, Bank* b);
  Bank* bank; double gain = 0.8, a = 0.001, r = 0.2, cutoff = 18000, tune = 0, pitch = 0, velSens = 0.7; bool oneShot = false, open = true;
  SmpZone z[N_ZONES]; Biquad lp; AdsrP ap;
  void upEnv() { ap = adsrParams(a <= 0.00201 ? 0.00012 : a, 0.1, 1, r, sr); }
  void upFilter();
  SmpVoice& allocS();
  void setParam(int i, double x) override;
  void noteOn(int p, double vel) override;
  void noteOff(int p) override;
  void render(float* L, float* R, int from, int to) override;
};

// ---------------------------------------------------------------- Moisture (wavetable)
constexpr int MT_NT = 8, MT_NM = 7, MT_TLEN = 2048;
struct MoistVoice : VoiceBase { double phA[5] = {}, phB = 0, phS = 0, lfo = 0, fenv = 0, f0 = 0; int mA = 0, mB = 0; Biquad fl, fr; };
class Moisture : public PolyBase<MoistVoice, 8> {
 public:
  explicit Moisture(double rate);
  const float* T;
  double posA = 0.25, posB = 0.6, lvB = 0.5, octB = 0, subLv = 0, uniDet = 12, cutoff = 6000, res = 1, fAmt = 0.3, a = 0.005, d = 0.35, s = 0.7, rel = 0.3, lfoHz = 0.5, lfoDep = 0, gain = 0.4, fdC = 0;
  int uni = 1, ftype = 0; AdsrP ap;
  const double spread[5] = { 0, -1, 1, -0.5, 0.5 }; double dtA[5] = {}, gl[5] = {}, gr[5] = {};
  void upEnv() { ap = adsrParams(a, d, s, rel, sr); fdC = std::exp(-1 / jsMax(1, d * sr * 0.3)); }
  void setParam(int i, double x) override;
  void noteOn(int p, double vel) override;
  void render(float* L, float* R, int from, int to) override;
  bool canBend() override { return true; }
  void bendSounding(double r0) override { for (auto& x : v) if (x.on) x.f0 *= r0; }
  void bendNewest(double r0) override { for (auto& x : v) if (x.on && x.age == counter) x.f0 *= r0; }
};

// ---------------------------------------------------------------- Osphere (layered pad)
struct OsphVoice : VoiceBase { double ph[4] = {}, lfo = 0, f0 = 0; Biquad fl, fr; };
class Osphere : public PolyBase<OsphVoice, 8> {
 public:
  explicit Osphere(double rate);
  double w1 = 0, w2 = 1, oct1 = 0, oct2 = 1, lv1 = 0.6, lv2 = 0.4, det1 = 8, det2 = 10, air = 0, cutoff = 4500, res = 0.8, a = 0.6, rel = 1.2, chDepth = 0.5, chMix = 0.4, motion = 0.3, motionHz = 0.15, gain = 0.35;
  static constexpr int DL = 4096; float dl[2][DL] = {}; int wp = 0; double chPh = 0, dPrevL, dPrevR; float tl[1024] = {}, tr[1024] = {}; double dts[4] = {}; AdsrP ap;
  void upEnv() { ap = adsrParams(a, 0.4, 0.85, rel, sr); }
  void setParam(int i, double x) override;
  void noteOn(int p, double vel) override;
  void render(float* L, float* R, int from, int to) override;
  bool canBend() override { return true; }
  void bendSounding(double r0) override { for (auto& x : v) if (x.on) x.f0 *= r0; }
  void bendNewest(double r0) override { for (auto& x : v) if (x.on && x.age == counter) x.f0 *= r0; }
};

// ---------------------------------------------------------------- GMS (groove synth: 3 oscillators, mono glide, arpeggiator)
struct GmsVoice : VoiceBase { double f = 0, ft = 0, ph[3] = {}, fenv = 0; Biquad f1, f2; };
class Gms : public PolyBase<GmsVoice, 8> {
 public:
  explicit Gms(double rate);
  int mode = 0, pattern = 0, rate = 2, octs = 1; double glide = 60, cutoff = 2500, res = 1.2, fAmt = 0.4, a = 0.003, d = 0.25, s = 0.6, rel = 0.2, gain = 0.4, bpm = 120, gate = 0.7, fdC = 0;
  bool arpOn = false; AdsrP ap;
  struct Osc { double wave, oct, fine, lv; } o3[3] = { { 0, 0, 0, 0.7 }, { 0, 0, 8, 0.5 }, { 0, -1, 0, 0 } };
  struct Held { int p; double vel; }; Held held[16]; int nh = 0; Held stack[128]; int ns = 0;
  double arpPos = 0, arpOffAt = -1; double arpStep = 0; int arpNote = -1;
  void upEnv() { ap = adsrParams(a, d, s, rel, sr); fdC = std::exp(-1 / jsMax(1, d * sr * 0.3)); }
  void setTempo(double b) override { bpm = clamp(b, 20, 300); }
  void setParam(int i, double x) override;
  void trigger(int p, double vel);
  void releaseP(int p);
  void noteOn(int p, double vel) override;
  void noteOff(int p) override;
  void allOff() override;
  bool active() override;
  double stepSamples() const { static const double M[4] = { 1, 2, 4, 8 }; return sr * 60 / (bpm * M[rate]); }
  void arpNext();
  void renderVoices(float* L, float* R, int from, int to);
  void render(float* L, float* R, int from, int to) override;
  bool canBend() override { return true; }
  void bendSounding(double r0) override { for (auto& x : v) if (x.on) { x.f *= r0; x.ft *= r0; } }
  void bendNewest(double r0) override { for (auto& x : v) if (x.on && x.age == counter) { x.f *= r0; x.ft *= r0; } }
};

// ---------------------------------------------------------------- SoundFont player (6)
// sf2.js parse result as the engine needs it: sample data (int16 values as float: exact), sample rates, presets of zones
struct SfZone { double lo, hi, vlo, vhi, sample, root, tune, loop, atten, pan, a, d, s, r, start, end, ls, le; };
constexpr int SF_ZONE_FIELDS = 18;
class SoundFont {
 public:
  ~SoundFont() { delete[] data; }
  float* data = nullptr; int n = 0;
  std::vector<double> rate; std::vector<std::vector<SfZone>> presets;
};
struct SfVoice : VoiceBase { double pos = 0, ratio = 1, g = 0, pl = 1, pr = 1; const SfZone* z = nullptr; const SoundFont* sf = nullptr; AdsrP ap; };
class SfPlayer : public PolyBase<SfVoice, 40> {
 public:
  SfPlayer(double rate, Bank* b) : PolyBase(rate), bank(b) {}
  Bank* bank; int sfId = -1, preset = 0; double gain = 0.8;
  void setParam(int i, double x) override;
  void noteOn(int p, double vel) override;
  void render(float* L, float* R, int from, int to) override;
};

}  // namespace mdaw
