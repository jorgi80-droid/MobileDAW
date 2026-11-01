// Port of js/engine/live.js: Ableton-style Sampler (10) and Wavetable (11). Wavetable frame sets are built off the audio thread:
// commands.cpp (prepare) builds every table an instParam / trackInst asks for before the command reaches the engine (wtEnsure), the
// audio thread only reads finished tables (wtGet). Same results as the JS engine with JOBS.sync (tests, export).
#pragma once
#include "instruments.h"

namespace mdaw {

// ---------------------------------------------------------------- Sampler (10)
struct LsZone { int id = -1, root = 60, lo = 0, hi = 127, vlo = 1, vhi = 127, sus = 0; double det = 0, s0 = 0, s1 = 1, l0 = 0, l1 = 1, xf = 0, vol = 0, pan = 0; bool rev = false; };
struct LsVoice {
  bool on = false, held = false; int pitch = 0; double vel = 0; uint32_t age = 0; Adsr env, fenv; int id = -1; double pos = 0, dir = 1, ratio = 1; bool rel = false;
  double s0 = 0, s1 = 0, l0 = 0, l1 = 0, xf = 0; int sus = 0; bool rev = false; double zvol = 1, zpan = 0, dt = 0, vpan = 0; Biquad fl, fr; double lfo = 0, hold = 0, pe = 1, base = 1, keyOff = 0, op = 0; bool sd = false;
};
class LiveSampler : public Instrument {
 public:
  LiveSampler(double rate, Bank* b);
  double sr; Bank* bank; double pitch = 0; uint32_t counter = 0, seed = 987654321u;
  double g[40] = {}; LsZone z[16]; LsVoice v[32]; AdsrP ap, fp;
  void upEnv();
  void setParam(int i, double x) override;
  LsVoice& alloc();
  void start(const LsZone& q, const Sample* s, int p, double vel, double dt, double pan);
  void startOsc(int p, double vel);
  int zero(const Sample* s, double i) const;
  void noteOn(int p, double vel) override;
  void noteOff(int p) override;
  void allOff() override;
  bool active() override { for (auto& x : v) if (x.on) return true; return false; }
  void render(float* L, float* R, int from, int to) override;
  int voicesOn() override { int n = 0; for (auto& x : v) if (x.on) n++; return n; }
};

// ---------------------------------------------------------------- Wavetable (11)
constexpr int WT_NF = 16, WT_NM = 7, WT_TL = 2048, WT_NH = 64, WT_COUNT = 34;
void wtEnsure(int idx);                 // build the frame set (non-audio thread); idempotent
const float* wtGet(int idx);            // the frame set or nullptr while it is not built
inline int wtAt(int f, int m) { return (f * WT_NM + m) * (WT_TL + 1); }

struct WtOsc { const float* tab = nullptr; int tabIdx = -1, want = -1; double pos = 0.7, fx1 = 0, fx2 = 0; int mode = 0; double gain = 1, semi = 0, det = 0; bool on = true; };
struct WtVoice {
  bool on = false, held = false; int pitch = 0; double vel = 0; uint32_t age = 0; Adsr env, e2, e3; double f0 = 0, cur = 0;
  double ph[2][8] = {}, sy[2][8] = {}, phS = 0, l1 = 0, l2 = 0, h1 = 0, h2 = 0, t = 0, rnd[8] = {}; Biquad fl, fr, fl2, fr2;
};
struct WtSc { WtOsc* o = nullptr; double gn = 1, dts[8] = {}, pos[8] = {}; int mips[8] = {}; const float* tb = nullptr; };
class LiveWavetable : public Instrument {
 public:
  explicit LiveWavetable(double rate);
  double sr; uint32_t counter = 0, seed = 987654321u;
  double p[120] = {}, mx[48] = {}; WtOsc o[2]; WtVoice v[8]; int stack[128]; int ns = 0;
  double spread[8] = {}, gl[8] = {}, gr[8] = {}, src[6] = {}, mod[8] = {}; WtSc sc[2]; WtSc* st[2] = { nullptr, nullptr }; AdsrP pa, p2, p3;
  void upEnv();
  void takeTab(WtOsc& o);
  void upO();
  void setParam(int i, double x) override;
  WtVoice& alloc();
  void begin(WtVoice& x, int p, double vel);
  void noteOn(int p, double vel) override;
  void noteOff(int p) override;
  void allOff() override;
  bool active() override { for (auto& x : v) if (x.on) return true; return false; }
  void render(float* L, float* R, int from, int to) override;
  int voicesOn() override { int n = 0; for (auto& x : v) if (x.on) n++; return n; }
  bool canBend() override { return true; }
  void bendSounding(double r0) override { for (auto& x : v) if (x.on) { x.f0 *= r0; if (x.cur) x.cur *= r0; } }
  void bendNewest(double r0) override { for (auto& x : v) if (x.on && x.age == counter) { x.f0 *= r0; if (x.cur) x.cur *= r0; } }
};

}  // namespace mdaw
