// Port of js/engine/poli.js. Keep in step with the JS original.
#include "poli.h"

namespace mdaw {

static const double POLI_SYNC[7] = { 0.25, 0.5, 1, 2, 4, 8, 16 };
static inline double rnd01(uint32_t& s) { return lcg(s) / 4294967296.0; }
static inline double dblP(double db) { return db <= -60 ? 0 : std::pow(10, db / 20); }

double PEnv::step(double a, double d, double s, double r, double dt, bool loop) {
  switch (st) {
    case 1: v += dt / jsMax(0.0005, a); if (v >= 1) { v = 1; st = 2; } break;
    case 2: v += (s - v) * (1 - std::exp(-dt * 4.6 / jsMax(0.0005, d))); if (std::fabs(v - s) < 2e-3) { v = s; st = loop ? 5 : 3; } break;
    case 3: v = s; break;
    case 5: v -= v * (1 - std::exp(-dt * 4.6 / jsMax(0.0005, r))); if (v < 0.01) st = 1; break;
    case 4: v -= v * (1 - std::exp(-dt * 4.6 / jsMax(0.0005, r))); if (v < 1e-4) { v = 0; st = 0; } break;
    default: return 0;
  }
  return v;
}
Poli::Poli(double rate) : sr(rate) {
  int k = 26; for (int t = 0; t < 7; t++) for (int s = 0; s < 3; s++) { gi[t][s] = -1; if ((t == 2 && s == 2) || (t == 6 && s != 1)) continue; gi[t][s] = k++; }
  for (int t = 0; t < 7; t++) for (int s = 0; s < 2; s++) mi[t][s] = k++;
}
void Poli::start(PoliVoice& x, int pt, double vel, bool leg) {
  double f = midiToHz(pt); int g = (int)jsRound(p[63]);
  x.gf = g == 0 || (!x.on && g != 1) ? f : (x.f != 0 ? x.f : f); if (g == 2 && !leg) x.gf = f;
  x.on = x.held = true; x.pitch = pt; x.vel = vel; x.age = ++counter; x.f = f; x.pan = (rnd01(seed) * 2 - 1) * p[59];
  if (!leg) { x.fe.start(); x.ae.start(); x.t = 0; x.lph = p[13] > 0.5 ? 0 : lph; }
}
void Poli::noteOn(int pt, double vel) {
  int m = mode();
  if (m == 1) { int j = 0; for (int i = 0; i < nheld; i++) if (held[i] != pt) held[j++] = held[i]; nheld = j; if (nheld < 128) held[nheld++] = pt; PoliVoice& x = v[0]; bool leg = x.on && x.held; start(x, pt, vel, leg); x.det = 0; return; }
  int n = m == 2 ? 4 : 1;
  for (int u = 0; u < n; u++) {
    int k = -1; for (int i = 0; i < 16; i++) if (!v[i].on) { k = i; break; } if (k < 0) { k = 0; for (int i = 1; i < 16; i++) if (v[i].age < v[k].age) k = i; }
    PoliVoice& x = v[k]; start(x, pt, vel, false); x.det = n > 1 ? ((double)u / (n - 1) - 0.5) * p[66] * 0.5 : 0; if (n > 1) x.pan = ((double)u / (n - 1) - 0.5) * 2 * jsMax(p[66], p[59]);
  }
}
void Poli::noteOff(int pt) {
  if (mode() == 1) { int j = 0; for (int i = 0; i < nheld; i++) if (held[i] != pt) held[j++] = held[i]; nheld = j; PoliVoice& x = v[0]; if (nheld && x.pitch == pt) { start(x, held[nheld - 1], x.vel, true); return; } if (nheld) return; }
  for (auto& x : v) if (x.on && x.held && x.pitch == pt) { x.held = false; x.fe.release(); x.ae.release(); }
}
double Poli::lfoV(PoliVoice& x) {
  int w = (int)jsRound(p[11]); double y = x.lph - std::floor(x.lph);
  switch (w) { case 1: return 1 - 4 * std::fabs(y - 0.5); case 2: return 2 * y - 1; case 3: return 1 - 2 * y; case 4: return y < 0.5 ? 1 : -1; case 5: return x.lsh; case 6: return rnd01(seed) * 2 - 1; default: return std::sin(TWO_PI * y); }
}
void Poli::render(float* L, float* R, int from, int to) {
  const int CT = 16; double dtc = CT / sr; int n = to - from;
  double lfoHz = p[12] > 0.5 ? bpm / 60 / POLI_SYNC[(int)clamp(jsRound(p[15]), 0, 6)] : p[14];
  mix[0] = p[5] * p[5]; mix[1] = p[6] * p[6]; mix[2] = p[7] * p[7]; mix[3] = p[8] * p[8]; mix[4] = p[9] * p[9]; bool subSaw = jsRound(p[2]) == 1, rmPulse = jsRound(p[4]) == 1;
  double vol = dblP(p[60]) * 0.22, glide = jsRound(p[63]) > 0 && p[64] > 0 ? std::exp(-dtc / (p[64] * 0.001)) : 0;
  double nc = 1 - std::exp(-TWO_PI * (200 * std::pow(100, p[3])) / sr); bool boost = p[17] > 0.5, bendAll = p[62] > 0.5;
  lph += lfoHz * n / sr; if (lph > 1e6) lph -= std::floor(lph);
  for (auto& x : v) {
    if (!x.on) continue;
    double gl = 0, gr = 0;
    for (int i = from; i < to; i++) {
      if (x.cnt-- <= 0) {
        x.cnt = CT - 1; x.t += dtc;
        double fe = x.fe.step(p[22] * 0.001, p[23] * 0.001, p[24], p[25] * 0.001, dtc, p[21] > 0.5), ae = x.ae.step(p[67] * 0.001, p[68] * 0.001, p[69], p[70] * 0.001, dtc, false);
        if (x.ae.st == 0) { x.on = false; break; }
        auto cell = [&](int k) { return k < 0 ? 0.0 : p[k]; };
        auto src = [&](int t) { double fade = p[16] > 0 ? jsMin(1, x.t / p[16]) : 1, lf = lfoV(x) * fade; return cell(gi[t][0]) * lf + cell(gi[t][1]) * fe + cell(gi[t][2]) * ae + cell(mi[t][0]) * x.vel + cell(mi[t][1]) * (x.pitch - 60) / 60; };
        x.lph += lfoHz * std::pow(2, src(6) * 4) * dtc; if (x.lph >= 1) { x.lph -= std::floor(x.lph); x.lsh = rnd01(seed) * 2 - 1; }
        x.gf = glide != 0 ? x.f + (x.gf - x.f) * glide : x.f;
        bool bendOn = bendAll || x.held; double f = x.gf * std::pow(2, (src(3) * 12 + (bendOn ? bend / 2 * p[61] : 0) + x.det) / 12);
        x.dS = clamp(f / sr, 0, 0.45); x.pw = clamp(0.5 - p[1] * 0.45 - src(4) * 0.4, 0.05, 0.95); x.ring = clamp((f + p[10]) * std::pow(2, src(5) * 2) / sr, 0, 0.45);
        double lpf = clamp(p[19] * std::pow(2, src(0) * 6), 20, sr * 0.45), hpf = clamp(p[18] * std::pow(2, src(1) * 6), 10, sr * 0.45);
        x.g = std::tan(PI * lpf / sr); x.k = 2 - 1.95 * p[20]; x.i1 = 1 / (1 + x.g * (x.g + x.k)); x.i2 = 1 / (1 + x.g * (x.g + x.k + 0.3));
        x.hg = std::tan(PI * hpf / sr); x.hi = 1 / (1 + x.hg * (x.hg + 1.4142));
        x.amp = ae * clamp(1 + src(2), 0, 2) * vol; double pan = clamp(x.pan, -1, 1); gl = x.amp * jsMin(1, 1 - pan); gr = x.amp * jsMin(1, 1 + pan);
      }
      double dt = x.dS;
      x.ps += dt * 0.5; if (x.ps >= 1) x.ps -= 1;
      double sub = subSaw ? 2 * x.ps - 1 : (x.ps < 0.5 ? 1 : -1);
      double d2 = clamp(dt * (1 + p[0] * sub * 0.8), 0, 0.45);
      x.pb += d2; if (x.pb >= 1) x.pb -= 1;
      double a = x.pb, saw = 2 * a - 1 - polyBlep(a, d2), c = a + (1 - x.pw); if (c >= 1) c -= 1;
      double pulse = (a < x.pw ? 1 : -1) + polyBlep(a, d2) - polyBlep(c, d2);
      x.pr += x.ring; if (x.pr >= 1) x.pr -= 1;
      double y0 = saw * mix[0] + pulse * mix[1] + sub * mix[2] + (rmPulse ? pulse : saw) * std::sin(TWO_PI * x.pr) * mix[4];
      if (mix[3] != 0) { x.nz += (rnd01(seed) * 2 - 1 - x.nz) * nc; y0 += x.nz * mix[3] * 1.5; }
      x.hp.run(y0, x.hg, 1.4142, x.hi); double y = x.hp.h;
      if (boost) { x.ls += (y0 - x.ls) * 0.01; y += x.ls * 0.8; }
      y = x.lp[1].run(x.lp[0].run(y, x.g, x.k, x.i1), x.g, x.k + 0.3, x.i2);
      L[i] = (float)(L[i] + y * gl); R[i] = (float)(R[i] + y * gr);
    }
  }
  int ch = (int)jsRound(p[58]); if (!ch) return;
  double rate = ch == 1 ? 0.5 : ch == 2 ? 0.83 : 0.65, depth = ch == 1 ? 0.0019 : ch == 2 ? 0.0035 : 0.0028, base = 0.0045 * sr; const int M2 = 2047;
  for (int i = from; i < to; i++) {
    cph += rate / sr; if (cph >= 1) cph -= 1;
    double m = std::sin(TWO_PI * cph) * depth * sr, xl = L[i], xr = R[i];
    cl[toInt32(cw) & M2] = (float)((xl + xr) * 0.5);
    auto rd = [&](double dd) { double pos = cw - dd, k = std::floor(pos), f = pos - k; int ki = toInt32(k); return cl[ki & M2] * (1 - f) + cl[(ki + 1) & M2] * f; };
    L[i] = (float)(xl * 0.7 + rd(base + m) * 0.6); R[i] = (float)(xr * 0.7 + rd(base - m) * 0.6); cw++;
  }
}

}  // namespace mdaw
