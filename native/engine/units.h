// Interfaces of instruments and audio effects (devices). Each port of a JS instrument / effect implements one of these.
// makeInstrument / makeDevice return nullptr for a type that is not ported yet: the app then keeps the project on the JS engine.
#pragma once
#include <cmath>
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
  virtual int lat() { return 0; }                               // PDC (Instrument Rack: its slowest chain)
  virtual int readOut(float* out) { return 0; }                 // Instrument Rack: chain meters
  virtual void endBlock(float* L, float* R, int n) {}           // JS inst.endBlock (Instrument Rack: chain effects + mix once per block)
  // Instrument Rack (fx7): JS inst.rack / cmd(). Removed devices / instruments are handed back for the retire queue
  bool isRack = false;
  virtual void rackCmd(int op, double c, double j, double a, double b, class Device* prepD, Instrument* prepI, class Device** rmD, int& nD, Instrument** rmI, int& nI) {}
  virtual class Device* sub(int c, int j) { return nullptr; }
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

struct Bank { Sample* s[256] = {}; SoundFont* sf[8] = {}; };

// factories (instruments.cpp / devices.cpp): nullptr = not ported (or unknown type)
Instrument* makeInstrument(int type, double sr, Bank* bank);
Device* makeDevice(int type, double sr, float* sidechain);
bool instPorted(int type);
bool devPorted(int type);

}  // namespace mdaw
