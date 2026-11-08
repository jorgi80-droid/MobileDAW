// Interfaces of instruments and audio effects (devices). Each port of a JS instrument / effect implements one of these.
// makeInstrument / makeDevice return nullptr for a type that is not ported yet: the app then keeps the project on the JS engine.
#pragma once
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include "pdc.h"

namespace mdaw {

struct Sample {                       // engine.bank[id]: decoded audio at the engine rate (r == l for mono)
  float* l = nullptr; float* r = nullptr; int frames = 0; double rate = 48000;
  ~Sample() { if (r != l) delete[] r; delete[] l; }
};

class SoundFont;                      // sf2 port (later)

class Instrument {
 public:
  virtual ~Instrument() {}
  bool pitchNative = false;           // shifts itself by param 90 (drums, samplers); otherwise notes are transposed by the engine
  virtual void setTempo(double bpm) {}
  virtual void setParam(int i, double v) = 0;
  virtual void noteOn(int pitch, double vel) = 0;
  virtual void noteOnSt(int pitch, double vel, double st) { (void)st; noteOn(pitch, vel); }   // per-note pitch offset (only the drum sampler uses it)
  virtual void noteOff(int pitch) = 0;
  virtual void render(float* L, float* R, int a, int b) = 0;   // adds frames a..b-1
  virtual bool active() = 0;
  virtual void allOff() = 0;
  virtual bool canBend() { return false; }                      // JS: inst.bendVoice exists
  virtual bool hasSetBend() { return false; }                   // JS: inst.setBend exists (Live 12 instruments scale the wheel by their PB Range)
  virtual void setBend(double st) {}
  virtual void setBendSl(double st, double sl) { setBend(st + sl); }   // slide notes (exact semitones) on top of the wheel
  virtual void setSongPos(bool playing, double beat) {}         // JS inst.setSongPos (FLM SuperSaw tempo-sync LFO, in phase with the song)
  virtual void bendSounding(double ratio) {}                    // every voice that is on
  virtual void bendNewest(double ratio) {}                      // voices started by the last noteOn (v.age === counter)
  virtual int voicesOn() { return 0; }
  virtual int lat() { return 0; }                               // PDC (Instrument Rack: its slowest chain)
  virtual int readOut(float* out) { return 0; }                 // Instrument Rack: chain meters
  virtual void endBlock(float* L, float* R, int n) {}           // JS inst.endBlock (Instrument Rack: chain effects + mix once per block)
  // Instrument Rack (fx7): JS inst.rack / cmd(). Removed devices / instruments are handed back for the retire queue
  bool isRack = false;
  virtual void rackCmd(int op, double c, double j, double a, double b, class Device* prepD, Instrument* prepI, class Device** rmD, int& nD, Instrument** rmI, int& nI) {}
  virtual class Device* sub(int c, int j) { return nullptr; }
};

constexpr int MIX_P = 1000, GAIN_P = 1001;   // dsp.js: per-module Mix (0..1) / output Gain (linear), outside the effect's own parameters

class Device {
 public:
  virtual ~Device() { std::free(wline.L); std::free(wline.R); }
  bool bypass = false;
  double wm = 1, wg = 1, wm0 = 1, wg0 = 1; bool won = false;   // dsp.js d.wm / d.wg / d.wm0 / d.wg0 / d.wx.on
  float wxL[128], wxR[128]; PdcLine wline;                    // dry copy of the block + its latency ring (storage on first use)
  bool hasTr = false;                                           // JS: d.tr exists (bar-synced effects read the song position)
  virtual void tr(bool playing, double beat) {}
  virtual void setParam(int p, double v) = 0;
  virtual void setTempo(double bpm) {}
  virtual void process(float* L, float* R, int n) = 0;
  virtual int readOut(float* out) { return 0; }                 // analyzer / meter devices
  virtual int lat() { return 0; }                               // JS d.lat(): frames this device delays the audio (PDC); 0 = none
  // modulators (fx6): JS d.mod / d.target() / m.last. modTarget fills strip, device (-1 = instrument), parameter, value; false = not mapped
  bool isMod = false; double modLast = NAN;
  virtual bool modTarget(int& s, int& d, int& k, double& v) { return false; }
  // effects that listen to notes (fx5 Spectral Resonator): JS d.midiIn / midiFrom() / noteOn / noteOff
  // racks (fx7): JS d.rack / cmd() / sub(). rackCmd returns how many devices it put into `removed` (for the retire queue)
  bool isRack = false;
  virtual int rackCmd(int op, double c, double j, double a, double b, Device* prep, Device** removed) { if (prep) { removed[0] = prep; return 1; } return 0; }
  virtual Device* sub(int c, int j) { return nullptr; }
  bool midiIn = false;
  virtual int midiFrom() { return -1; }
  virtual void noteOn(int p, double v) {}
  virtual void noteOff(int p) {}
};

// dsp.js devSet / fxRun: Mix 1 + Gain 1 = the effect alone (bit for bit); otherwise dry (delayed by the effect's latency) + wet, ramped per block
inline void devSet(Device* d, int p, double v) {
  if (p == MIX_P) { d->wm = v >= 0 ? (v > 1 ? 1 : v) : 0; return; }
  if (p == GAIN_P) { d->wg = v >= 0 ? (v > 8 ? 8 : v) : 0; return; }
  d->setParam(p, v);
}
inline void fxRun(Device* d, float* L, float* R, int n) {
  double m1 = d->wm, g1 = d->wg, m0 = d->wm0, g0 = d->wg0;
  if (m1 == 1 && g1 == 1 && m0 == 1 && g0 == 1) { d->process(L, R, n); return; }
  float* xl = d->wxL; float* xr = d->wxR; int D = d->lat();
  for (int i = 0; i < n; i++) { xl[i] = L[i]; xr[i] = R[i]; }
  if (D > 0) {
    if (!d->wline.L) { d->wline.L = (float*)std::calloc(PDC_MAX, sizeof(float)); d->wline.R = (float*)std::calloc(PDC_MAX, sizeof(float)); }   // JS allocates here too (rare: an effect with latency)
    if (!d->won) d->wline.clear();
    d->wline.run(xl, xr, n, D); d->won = true;
  } else d->won = false;
  d->process(L, R, n);
  for (int i = 0; i < n; i++) {
    double t = (double)(i + 1) / n, m = m0 + (m1 - m0) * t, g = g0 + (g1 - g0) * t;
    L[i] = (float)((xl[i] + ((double)L[i] - xl[i]) * m) * g); R[i] = (float)((xr[i] + ((double)R[i] - xr[i]) * m) * g);
  }
  d->wm0 = m1; d->wg0 = g1;
  if (m1 == 1 && g1 == 1) d->won = false;
}

struct Bank { Sample* s[256] = {}; SoundFont* sf[8] = {}; };

// factories (instruments.cpp / devices.cpp): nullptr = not ported (or unknown type)
Instrument* makeInstrument(int type, double sr, Bank* bank);
Device* makeDevice(int type, double sr, float* sidechain);
bool instPorted(int type);
bool devPorted(int type);

}  // namespace mdaw
