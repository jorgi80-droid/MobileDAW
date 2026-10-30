// Ports of js/engine/instruments.js. Keep each class in step with its JS original.
#include "instruments.h"

namespace mdaw {

// ------------------------------------------------------------------------------- Mini Synth
MiniSynth::MiniSynth(double rate) : PolyBase(rate) { upEnv(); upFilter(); }
void MiniSynth::setParam(int i, double x) {
  switch (i) {
    case 0: wave = jsRound(clamp(x, 0, 2)); break; case 1: cutoff = x; upFilter(); break; case 2: a = x; upEnv(); break;
    case 3: d = x; upEnv(); break; case 4: s = x; upEnv(); break; case 5: r = x; upEnv(); break; case 6: gain = x; break;
  }
}
void MiniSynth::noteOn(int p, double vel) {
  MiniVoice& x = alloc(); x.on = x.held = true; x.pitch = p; x.vel = vel; x.age = ++counter; x.ph = 0; x.dt = midiToHz(p) / sr; x.f.reset(); x.env.start();
}
void MiniSynth::render(float* L, float* R, int from, int to) {
  double w = wave, g0 = gain;
  for (auto& x : v) {
    if (!x.on) continue;
    x.f.copy(coef);
    double dt = x.dt, g = g0 * x.vel;
    for (int i = from; i < to; i++) {
      double e = x.env.next(ap);
      if (x.env.st == 0) { x.on = false; break; }
      x.ph += dt; if (x.ph >= 1) x.ph -= 1;
      double s0 = w == 0 ? sawBl(x.ph, dt) : w == 1 ? squareBl(x.ph, dt) : triNaive(x.ph);
      double y = x.f.process(s0) * e * g;
      L[i] = (float)(L[i] + y); R[i] = (float)(R[i] + y);
    }
  }
}

// ------------------------------------------------------------------------------- SuperSaw
SuperSaw::SuperSaw(double rate) : PolyBase(rate) { upEnv(); coef.lowpass(sr, cutoff, 0.707); }
void SuperSaw::setParam(int i, double x) {
  switch (i) { case 0: det = x; break; case 1: mix = x; break; case 2: cutoff = x; coef.lowpass(sr, x, 0.707); break; case 3: a = x; upEnv(); break; case 4: r = x; upEnv(); break; case 5: gain = x; break; }
}
void SuperSaw::noteOn(int p, double vel) {
  SawVoice& x = alloc(); x.on = x.held = true; x.pitch = p; x.vel = vel; x.age = ++counter; x.f0 = midiToHz(p);
  for (int k = 0; k < 7; k++) x.ph[k] = lcg(seed) / 4294967296.0;
  x.fl.reset(); x.fr.reset(); x.env.start();
}
void SuperSaw::render(float* L, float* R, int from, int to) {
  double dt3 = det / 3 / 1200, mx = mix;
  for (auto& x : v) {
    if (!x.on) continue;
    x.fl.copy(coef); x.fr.copy(coef);
    for (int k = 0; k < 7; k++) { dts[k] = x.f0 * std::pow(2, off[k] * dt3) / sr; lev[k] = k == 0 ? 1 - mx * 0.5 : mx * 0.5; }
    double g = gain * x.vel * 0.72; double* ph = x.ph;
    for (int i = from; i < to; i++) {
      double e = x.env.next(ap);
      if (x.env.st == 0) { x.on = false; break; }
      double l = 0, r0 = 0;
      for (int k = 0; k < 7; k++) {
        double dt = dts[k], p = ph[k] + dt; if (p >= 1) p -= 1; ph[k] = p;
        double s0 = 2 * p - 1;
        if (p < dt) { double t = p / dt; s0 -= t + t - t * t - 1; } else if (p > 1 - dt) { double t = (p - 1) / dt; s0 -= t * t + t + t + 1; }
        s0 *= lev[k]; l += s0 * (1 - pl[k]); r0 += s0 * pl[k];
      }
      L[i] = (float)(L[i] + x.fl.process(l) * e * g); R[i] = (float)(R[i] + x.fr.process(r0) * e * g);
    }
  }
}

}  // namespace mdaw
