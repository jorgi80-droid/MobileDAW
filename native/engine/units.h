// Interfaces of instruments and audio effects (devices). Each port of a JS instrument / effect implements one of these.
// makeInstrument / makeDevice return nullptr for a type that is not ported yet: the app then keeps the project on the JS engine.
#pragma once
#include <cstdint>

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
  virtual void noteOff(int pitch) = 0;
  virtual void render(float* L, float* R, int a, int b) = 0;   // adds frames a..b-1
  virtual bool active() = 0;
  virtual void allOff() = 0;
  virtual bool canBend() { return false; }                      // JS: inst.bendVoice exists
  virtual bool hasSetBend() { return false; }                   // JS: inst.setBend exists (Live 12 instruments scale the wheel by their PB Range)
  virtual void setBend(double st) {}
  virtual void bendSounding(double ratio) {}                    // every voice that is on
  virtual void bendNewest(double ratio) {}                      // voices started by the last noteOn (v.age === counter)
  virtual int voicesOn() { return 0; }
};

class Device {
 public:
  virtual ~Device() {}
  bool bypass = false;
  bool hasTr = false;                                           // JS: d.tr exists (bar-synced effects read the song position)
  virtual void tr(bool playing, double beat) {}
  virtual void setParam(int p, double v) = 0;
  virtual void setTempo(double bpm) {}
  virtual void process(float* L, float* R, int n) = 0;
  virtual int readOut(float* out) { return 0; }                 // analyzer / meter devices
};

struct Bank { Sample* s[256] = {}; SoundFont* sf[8] = {}; };

// factories (instruments.cpp / devices.cpp): nullptr = not ported (or unknown type)
Instrument* makeInstrument(int type, double sr, Bank* bank);
Device* makeDevice(int type, double sr, float* sidechain);
bool instPorted(int type);
bool devPorted(int type);

}  // namespace mdaw
