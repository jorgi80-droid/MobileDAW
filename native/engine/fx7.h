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

}  // namespace mdaw
