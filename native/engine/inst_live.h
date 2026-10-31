// Ports of the Live 12 instruments in js/engine/ds.js (DS Kick .. DS FM), js/engine/phys.js (Electric, Tension, Collision),
// js/engine/impulse.js and js/engine/granulator.js. Same names, same order of operations as the JS originals (the reference).
// JS keeps the playing voices in an array (push / shift / splice); VList keeps the same order without allocating on the audio thread.
#pragma once
#include <cstring>
#include "dsp.h"
#include "units.h"

namespace mdaw {

template <class V, int CAP>
struct VList {                                   // ordered voices: ord[0] is the oldest (JS array index 0)
  V pool[CAP]; int ord[CAP] = {}; bool used[CAP] = {}; int n = 0;
  V& at(int j) { return pool[ord[j]]; }
  void erase(int j) { used[ord[j]] = false; std::memmove(ord + j, ord + j + 1, sizeof(int) * (n - j - 1)); n--; }
  V& push() { int k = 0; while (used[k]) k++; used[k] = true; ord[n++] = k; return pool[k]; }   // caller keeps n < CAP (shift first)
  void clear() { for (int j = 0; j < CAP; j++) used[j] = false; n = 0; }
};

inline double jsDbl(double db) { return db <= -60 ? 0 : std::pow(10, db / 20); }          // dbl() of the JS files
inline double nzLcg(uint32_t& s) { return lcg(s) / 2147483648.0 - 1; }                     // nz()
inline double rndLcg(uint32_t& s) { return lcg(s) / 4294967296.0; }                        // rnd()
inline double t60(double sec, double sr) { return std::exp(-6.91 / jsMax(1, sec * sr)); }
inline double jsMod(double a, double b) { return std::fmod(a, b); }

struct DSvf {                                     // the Svf of ds.js
  double a = 0, b = 0, g = 0, k = 0, inv = 0, hp = 0, bp = 0;
  void set(double sr, double f, double q) { g = std::tan(PI * clamp(f, 20, sr * 0.45) / sr); k = 1 / jsMax(0.3, q); inv = 1 / (1 + g * (g + k)); }
  double run(double x) { double h = (x - (k + g) * a - b) * inv, bp0 = g * h + a, lp = g * bp0 + b; a = g * h + bp0; b = g * bp0 + lp; hp = h; bp = bp0; return lp; }
};

// ---------------------------------------------------------------------------------------- Drum Synths (types 19..24)
struct DsVoice { double t = 0, vel = 0, life = 0, ph = 0, ph2 = 0, lp = 0, pc = 0, pm = 0, fb = 0, fm = 0; double ph6[6] = {}; DSvf fl, fr; float d[64] = {}; int w = 0; };
class DsBase : public Instrument {
 public:
  DsBase(double rate, int np) : sr(rate), n(np), seed(1234 + np) {}
  double sr; int n; uint32_t seed; double p[8] = {}; VList<DsVoice, 7> v; double o0 = 0, o1 = 0;
  void setParam(int i, double x) override { if (i >= 0 && i < n) p[i] = x; }
  bool active() override { return v.n > 0; }
  void allOff() override {}
  void noteOff(int) override {}
  void noteOn(int, double vel) override { if (v.n >= 6) v.erase(0); DsVoice& x = v.push(); x = DsVoice(); voice(x); x.t = 0; x.vel = vel; }
  virtual void voice(DsVoice& x) = 0;
  virtual void tick(DsVoice& x, double dt) = 0;      // sets o0 / o1
  void render(float* L, float* R, int from, int to) override;
  int voicesOn() override { return v.n; }
};
class DsKick : public DsBase { public: explicit DsKick(double r) : DsBase(r, 8) {} void voice(DsVoice& x) override; void tick(DsVoice& x, double dt) override; };
class DsSnare : public DsBase { public: explicit DsSnare(double r) : DsBase(r, 7) {} void voice(DsVoice& x) override; void tick(DsVoice& x, double dt) override; };
class DsTom : public DsBase { public: explicit DsTom(double r) : DsBase(r, 5) {} void voice(DsVoice& x) override; void tick(DsVoice& x, double dt) override; };
class DsHH : public DsBase { public: explicit DsHH(double r) : DsBase(r, 5) {} void voice(DsVoice& x) override; void tick(DsVoice& x, double dt) override; };
class DsClap : public DsBase { public: explicit DsClap(double r) : DsBase(r, 7) {} void voice(DsVoice& x) override; void tick(DsVoice& x, double dt) override; };
class DsFm : public DsBase { public: explicit DsFm(double r) : DsBase(r, 7) {} void voice(DsVoice& x) override; void tick(DsVoice& x, double dt) override; };

// ---------------------------------------------------------------------------------------- physical models (types 25..27)
constexpr int TBUF = 16384;                       // Tension string buffer (enough for MIDI note 0 at 96 kHz)
struct PhMode { double c1 = 0, c2 = 0, y1 = 0, y2 = 0, a = 0; };
struct PhVoice {
  int pitch = 0; bool on = false; double vel = 0, t = 0, amp = 1;
  // Electric
  double f = 0, ph = 0, ph2 = 0, ph3 = 0, force = 0, stiff = 0, nl = 0, gT = 0, gB = 0, gO = 0, eT = 0, eB = 0, eO = 0, eN = 0, gN = 0, nc = 0;
  // Tension
  double N = 0, lp = 0, ap = 0, apx = 0, loss = 0, damp = 0, inh = 0, tlp = 0, bowAmp = 0; int M = 0; double w = 0; float* buf = nullptr;
  // Collision
  PhMode m[12]; int nm = 0; double mlp = 0, ne = 0, sa = 0, sb = 0, mw = 0, mc = 0;
};
class PhysBase : public Instrument {
 public:
  PhysBase(double rate, int np) : sr(rate), n(np), seed(777 + np) {}
  double sr; int n; uint32_t seed; double p[22] = {}; VList<PhVoice, 9> v;
  void setParam(int i, double x) override { if (i >= 0 && i < n) p[i] = x; }
  bool active() override { return v.n > 0; }
  void allOff() override { for (int j = 0; j < v.n; j++) v.at(j).on = false; }
  void noteOff(int pitch) override { for (int j = 0; j < v.n; j++) { PhVoice& x = v.at(j); if (x.pitch == pitch && x.on) x.on = false; } }
  void noteOn(int pitch, double vel) override;
  virtual void voice(PhVoice& x, int pitch, double vel) = 0;
  virtual double tick(PhVoice& x, double dt) = 0;
  virtual double relGain() { return t60(0.3, sr); }
  void render(float* L, float* R, int from, int to) override;
  int voicesOn() override { return v.n; }
};
class Electric : public PhysBase { public: explicit Electric(double r) : PhysBase(r, 13) {} double relGain() override; void voice(PhVoice& x, int pitch, double vel) override; double tick(PhVoice& x, double dt) override; };
class Tension : public PhysBase {
 public:
  explicit Tension(double r);
  ~Tension() override { delete[] store; }
  float* store = nullptr; float tmp[TBUF];
  double relGain() override; void voice(PhVoice& x, int pitch, double vel) override; double tick(PhVoice& x, double dt) override;
};
class Collision : public PhysBase { public: explicit Collision(double r) : PhysBase(r, 22) {} double relGain() override; void voice(PhVoice& x, int pitch, double vel) override; double tick(PhVoice& x, double dt) override; };

// ---------------------------------------------------------------------------------------- Impulse (28), Granulator III (29)
struct ImpVoice { bool on = false, held = false; double vel = 0, t = 0, pos = 0, tpos = 0, gp = 0, env = 0, a = 0, b = 0, fade = 0; };
class Impulse : public Instrument {
 public:
  Impulse(double rate, Bank* b) : sr(rate), bank(b) { for (int k = 0; k < 8; k++) ids[k] = -1; }
  double sr; Bank* bank; double p[196] = {}; int ids[8]; ImpVoice v[8];
  double q(int k, int f) { return p[92 + k * 13 + f]; }
  Sample* smp(int k) { Sample* s = ids[k] >= 0 && ids[k] < 256 ? bank->s[ids[k]] : nullptr; return s && s->frames > 4 ? s : nullptr; }
  void setParam(int i, double x) override;
  void noteOn(int pitch, double vel) override;
  void noteOff(int pitch) override { int k = pitch - 60; if (k >= 0 && k < 8) v[k].held = false; }
  void allOff() override { for (auto& x : v) x.held = false; }
  bool active() override { for (auto& x : v) if (x.on) return true; return false; }
  void render(float* L, float* R, int from, int to) override;
};
struct Grain { double pos = 0, r = 0, i = 0, len = 0, pan = 0; };
struct GranVoice { int pitch = 0; double vel = 0, env = 0, head = 0, next = 0, t = 0, rate = 0; bool held = false; Grain g[16]; int ng = 0; };
class Granulator : public Instrument {
 public:
  Granulator(double rate, Bank* b) : sr(rate), bank(b) {}
  double sr; Bank* bank; double p[14] = {}; int id = -1; uint32_t seed = 3303; VList<GranVoice, 9> v;
  Sample* smp() { Sample* s = id >= 0 && id < 256 ? bank->s[id] : nullptr; return s && s->frames > 64 ? s : nullptr; }
  void setParam(int i, double x) override { if (i >= 200) { if (i == 200) id = toInt32(x); return; } if (i >= 0 && i < 14) p[i] = x; }
  void noteOn(int pitch, double vel) override;
  void noteOff(int pitch) override { for (int j = 0; j < v.n; j++) if (v.at(j).pitch == pitch) v.at(j).held = false; }
  void allOff() override { for (int j = 0; j < v.n; j++) v.at(j).held = false; }
  bool active() override { return v.n > 0; }
  void spawn(GranVoice& x, Sample* s);
  void render(float* L, float* R, int from, int to) override;
};

}  // namespace mdaw
