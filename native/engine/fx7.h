// Port of js/engine/fx7.js AudioEffectRack (51): up to 8 parallel chains of effects, chain volume / pan / activator / solo, chain selector
// zones, 8 macros mapped to parameters of the devices inside, PDC between the chains. The devices inside are built by commands.cpp
// (prepare, off the audio thread) and handed in by rackCmd; removed ones go back to the engine's retire queue.
#pragma once
#include "dsp.h"
#include "pdc.h"
#include "units.h"

namespace mdaw {

constexpr int RACK_CHAINS = 8, RACK_MACROS = 8, RACK_MAP0 = 41, RACK_DEV = 16, RACK_NP = 160;

struct RackChain { Device* dev[RACK_DEV] = {}; int n = 0; PdcLine pdl; };

class AudioEffectRack : public Device {
 public:
  explicit AudioEffectRack(double r);
  ~AudioEffectRack() override;
  double sr, bpm = 120, p[RACK_NP], last[RACK_MACROS];
  RackChain ch[RACK_CHAINS];
  Instrument* chainInst[RACK_CHAINS] = {};   // Instrument Rack only: the chain's instrument (macro target j = -1)
  float L[128] = {}, R[128] = {}, sL[128] = {}, sR[128] = {}, pk[RACK_CHAINS] = {};
  float* mem = nullptr;
  void setParam(int i, double v) override;
  void setTempo(double b) override;
  void tr(bool playing, double beat) override;
  void process(float* L, float* R, int n) override;
  int readOut(float* o) override { for (int c = 0; c < RACK_CHAINS; c++) o[c] = pk[c]; return RACK_CHAINS; }
  int lat() override;
  int rackCmd(int op, double c, double j, double a, double b, Device* prep, Device** removed) override;
  Device* sub(int c, int j) override { return c >= 0 && c < RACK_CHAINS && j >= 0 && j < ch[c].n ? ch[c].dev[j] : nullptr; }
  void macros();
  int chainLat(int c) const;
  void align(int c, float* bl, float* br, int n, int M);
};

// Port of js/engine/fx7.js InstrumentRack (instrument type 12): each chain = an instrument + effects; notes go to the chains whose key /
// velocity / chain-select zones contain them, note-offs to the chains that got the note-on. Rack parameter k = instrument parameter 100 + k.
class InstrumentRack : public Instrument {
 public:
  explicit InstrumentRack(double r);
  ~InstrumentRack() override { for (auto* x : core.chainInst) delete x; }
  AudioEffectRack core; double sr;
  float cL[RACK_CHAINS][128] = {}, cR[RACK_CHAINS][128] = {};
  uint8_t held[128] = {};                      // JS held: pitch -> chain mask
  void setParam(int i, double v) override { if (i >= 100) core.setParam(i - 100, v); }
  void setTempo(double b) override { core.setTempo(b); for (auto* x : core.chainInst) if (x) x->setTempo(b); }
  bool plays(int c, int pitch, double v) const;
  void noteOn(int pitch, double vel) override;
  void noteOff(int pitch) override;
  void allOff() override { for (auto* x : core.chainInst) if (x) x->allOff(); for (auto& h : held) h = 0; }
  bool active() override { for (auto* x : core.chainInst) if (x && x->active()) return true; return false; }
  void render(float* L, float* R, int from, int to) override;
  void endBlock(float* L, float* R, int n) override;
  int lat() override { return core.lat(); }
  int voicesOn() override { int n = 0; for (auto* x : core.chainInst) if (x) n += x->voicesOn(); return n; }
  void rackCmd(int op, double c, double j, double a, double b, Device* prepD, Instrument* prepI, Device** rmD, int& nD, Instrument** rmI, int& nI) override;
  Device* sub(int c, int j) override { return core.sub(c, j); }
  int readOut(float* o) override { return core.readOut(o); }
};

}  // namespace mdaw
