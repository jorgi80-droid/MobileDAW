// Shared pieces of the Honeydew FX port (hdfx.cpp, hdfx2.cpp): flush, the biquad (biquad.rs) and the interface of the modules that
// Honeydew keeps in their own files (multiband.rs, tape_stop.rs, spreader.rs, comb.rs, waveshaper.rs, ...).
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#pragma once
#include <cmath>
#include <cstddef>

namespace mdaw {
namespace hdfx {

inline float flushf(float x) { return std::fabs(x) < 1e-30f ? 0.0f : x; }

enum Resp { LowPass, BandPass, HighPass, LowShelf, Peak, HighShelf };
struct Biquad {
  float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  void param(int response, float frequency, float bandwidth, float gainDb, float sampleRate);   // set_parametric_response
  void filter(int response, float frequency, float resonance, float sampleRate);              // set_filter_response
  float run(float in) { float o = flushf(b0 * in + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2); x2 = x1; x1 = in; y2 = y1; y1 = o; return o; }
  void clear() { x1 = x2 = y1 = y2 = 0; }
};

// A module whose state lives in its own Honeydew file. Same calls as AudioEffect makes on its Processor.
struct Ext {
  virtual ~Ext() {}
  virtual void refresh(const float* p, float sr) = 0;
  virtual void prepare(float bpm, double startBeat, float sr, int frames) {}
  virtual void idle(float bpm) {}                     // bypassed block (Tape Stop still takes the tempo)
  virtual void tempo(float bpm) {}                    // configure_tempo (ring sizes), off the audio path in Honeydew
  virtual void frame(float& l, float& r) = 0;
  virtual void reset(const float* p) = 0;
  virtual int latency() { return 0; }
  virtual void extra(int k, float v) {}               // module data beyond its params: Pitcher's note enables C..B (CSTM)
};
Ext* makeExt(int id, float sr, int& n, const float*& def);
int extParamCount(int id);

}  // namespace hdfx
}  // namespace mdaw
