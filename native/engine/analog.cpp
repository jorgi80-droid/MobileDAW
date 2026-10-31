// Port of js/engine/analog.js. Keep in step with the JS original.
#include "analog.h"

namespace mdaw {

static inline double rnd01(uint32_t& s) { return lcg(s) / 4294967296.0; }
static inline double dblA(double db) { return db <= -60 ? 0 : std::pow(10, db / 20); }
static const int AVOICES[9] = { 1, 2, 4, 6, 8, 12, 16, 24, 32 };
static const double DRIVE[7] = { 0, 1.5, 3, 6, 1.5, 3, 6 };
static double driveA(double x, int d) { if (!d) return x; double g = DRIVE[d]; return d >= 4 ? std::tanh(x * g + 0.3) - std::tanh(0.3) : std::tanh(x * g) / std::tanh(g); }

double AEnv::step(double a, double d, double s, double r, double dt, bool ex) {
  switch (st) {
    case 1: v += dt / jsMax(0.0005, a); if (v >= 1) { v = 1; st = 2; } break;
    case 2: if (ex) v += (s - v) * (1 - std::exp(-dt * 4.6 / jsMax(0.0005, d))); else v -= (1 - s) * dt / jsMax(0.0005, d);
      if (v <= s + 1e-3) { v = s; st = 3; } break;
    case 3: v = s; break;
    case 4: if (ex) v -= v * (1 - std::exp(-dt * 4.6 / jsMax(0.0005, r))); else v -= dt / jsMax(0.0005, r);
      if (v < 1e-4) { v = 0; st = 0; } break;
    default: return 0;
  }
  return v;
}
void Analog::start(AnVoice& x, int pt, double vel, bool legato) {
  x.on = x.held = true; x.pitch = pt; x.vel = vel; x.age = ++counter; x.f = midiToHz(pt); if (x.gf == 0 || p[83] <= 0) x.gf = x.f;
  if (!legato) { x.ph[0] = x.ph[1] = 0; x.sub[0] = x.sub[1] = 0; for (auto& e : x.fe) e.start(); for (auto& e : x.ae) e.start(); for (int l = 0; l < 2; l++) if (p[73 + l * 5] > 0.5) lph[l] = 0; }
}
void Analog::noteOn(int pt, double vel) {
  int n = AVOICES[(int)clamp(jsRound(p[80]), 0, 8)], uni = 1 + (int)clamp(jsRound(p[81]), 0, 3);
  if (n == 1) { int j = 0; for (int i = 0; i < nheld; i++) if (held[i] != pt) held[j++] = held[i]; nheld = j; if (nheld < 128) held[nheld++] = pt; AnVoice& x = v[0]; start(x, pt, vel, p[84] > 0.5 && x.on && x.held); return; }
  for (int u = 0; u < uni; u++) {
    int k = -1; for (int i = 0; i < n; i++) if (!v[i].on) { k = i; break; } if (k < 0) { k = 0; for (int i = 1; i < n; i++) if (v[i].age < v[k].age) k = i; }
    AnVoice& x = v[k]; start(x, pt, vel, false); x.uni = uni > 1 ? ((double)u / (uni - 1) - 0.5) : 0; x.pan = x.uni * 1.4;
  }
}
void Analog::noteOff(int pt) {
  bool free = p[91] > 0.5;
  if (AVOICES[(int)clamp(jsRound(p[80]), 0, 8)] == 1) {
    int j = 0; for (int i = 0; i < nheld; i++) if (held[i] != pt) held[j++] = held[i]; nheld = j; AnVoice& x = v[0];
    if (nheld && x.pitch == pt) { start(x, held[nheld - 1], x.vel, p[84] > 0.5); return; }
    if (nheld) return;
  }
  for (auto& x : v) if (x.on && x.held && x.pitch == pt) { x.held = false; if (!free) { for (auto& e : x.fe) e.release(); for (auto& e : x.ae) e.release(); } }
}
void Analog::render(float* L, float* R, int from, int to) {
  const int CT = 16; double dtc = CT / sr; bool ex = p[89] > 0.5; double vol = dblA(p[87]) * 0.25; bool free = p[91] > 0.5;
  int n = to - from; double lv[2] = { 0, 0 };
  for (int l = 0; l < 2; l++) {
    int b = 70 + l * 5; lph[l] += p[b + 2] * n / sr; if (lph[l] >= 1) { lph[l] -= std::floor(lph[l]); lsh[l] = rnd01(seed) * 2 - 1; }
    double x = std::fmod(lph[l] + p[b + 4], 1); int w = (int)jsRound(p[b + 1]);
    lv[l] = p[b] > 0.5 ? (w == 1 ? 1 - 4 * std::fabs(x - 0.5) : w == 2 ? (x < 0.5 ? 1 : -1) : w == 3 ? lsh[l] : w == 4 ? rnd01(seed) * 2 - 1 : std::sin(TWO_PI * x)) : 0;
  }
  vph += p[86] * n / sr; double vib = std::sin(TWO_PI * vph) * p[85] * 0.5; if (vph > 1e6) vph -= std::floor(vph);
  double glide = p[83] > 0 ? std::exp(-dtc / (p[83] * 0.001)) : 0;
  for (auto& x : v) {
    if (!x.on) continue;
    for (int i = from; i < to; i++) {
      if (x.cnt-- <= 0) {
        x.cnt = CT - 1;
        x.gf = glide != 0 ? x.f + (x.gf - x.f) * glide : x.f;
        double bendSt = bend / 2 * p[88] + vib + x.uni * p[82];
        for (int o = 0; o < 2; o++) {
          int b = o * 12; double st = p[b + 4] * 12 + p[b + 5] + p[b + 6] + bendSt + lv[o] * p[b + 10] * 12 + (p[b + 9] != 0 ? x.fe[o].v * p[b + 9] * 12 : 0);
          x.d[o] = clamp((p[b + 11] > 0.5 ? x.gf : 261.63) * std::pow(2, st / 12) / sr, 0, 0.45); x.pw[o] = 0.5 - p[b + 7] * 0.45;
        }
        bool alive = false;
        for (int f = 0; f < 2; f++) {
          int b = 28 + f * 12; double fe = x.fe[f].step(p[b + 7] * 0.001, p[b + 8] * 0.001, p[b + 9], p[b + 10] * 0.001, dtc, ex); int ab = 54 + f * 8; double ae = x.ae[f].step(p[ab + 3] * 0.001, p[ab + 4] * 0.001, p[ab + 5], p[ab + 6] * 0.001, dtc, ex);
          if (p[ab] > 0.5 && x.ae[f].st != 0) alive = true;
          double fc = p[b + 2]; if (f == 1 && p[53] > 0.5) fc = p[30] * (p[b + 2] / 1000);
          fc = clamp(fc * std::pow(2, fe * p[b + 4] * 7 + lv[f] * p[b + 11] * 3 + p[b + 5] * (x.pitch - 60) / 12), 20, sr * 0.45);
          x.g[f] = std::tan(PI * fc / sr); x.k[f] = 2 - 1.97 * p[b + 3]; x.inv[f] = 1 / (1 + x.g[f] * (x.g[f] + x.k[f]));
          x.amp[f] = p[ab] > 0.5 ? ae * dblA(p[ab + 1]) * (0.3 + 0.7 * x.vel) * (1 + lv[f] * p[ab + 7]) : 0;
        }
        if (!alive || (free && x.ae[0].st == 0 && x.ae[1].st == 0)) { x.on = false; break; }
      }
      double s1 = 0, s2 = 0;
      for (int o = 0; o < 2; o++) {
        int b = o * 12; if (p[b] < 0.5) continue;
        x.ph[o] += x.d[o]; if (x.ph[o] >= 1) x.ph[o] -= 1;
        double a = x.ph[o], dt = x.d[o], y; int sh = (int)jsRound(p[b + 3]);
        if (sh == 0) y = std::sin(TWO_PI * a); else if (sh == 1) y = 2 * a - 1 - polyBlep(a, dt);
        else if (sh == 2) { double pw = x.pw[o], c = a + (1 - pw); if (c >= 1) c -= 1; y = (a < pw ? 1 : -1) + polyBlep(a, dt) - polyBlep(c, dt); }
        else y = rnd01(seed) * 2 - 1;
        if (p[b + 8] > 0) { x.sub[o] += dt * 0.5; if (x.sub[o] >= 1) x.sub[o] -= 1; y = y * (1 - p[b + 8] * 0.5) + (x.sub[o] < 0.5 ? 1 : -1) * p[b + 8] * 0.5; }
        y *= dblA(p[b + 1]); s1 += y * (1 - p[b + 2]); s2 += y * p[b + 2];
      }
      if (p[24] > 0.5) { double w = rnd01(seed) * 2 - 1, c = 1 - std::exp(-TWO_PI * p[27] / sr); x.nz += (w - x.nz) * c; double y = x.nz * dblA(p[25]) * 2; s1 += y * (1 - p[26]); s2 += y * p[26]; }
      double y1 = 0, y2 = 0;
      for (int f = 0; f < 2; f++) {
        int b = 28 + f * 12, ty = (int)jsRound(p[b + 1]); bool on = p[b] > 0.5; ASvf* fl = f ? x.f2 : x.f1;
        double in = f ? s2 + y1 * p[52] : s1, y;
        if (!on) y = in;
        else {
          double lp = fl[0].run(in, x.g[f], x.k[f], x.inv[f]);
          switch (ty) {
            case 1: y = fl[1].run(lp, x.g[f], x.k[f] + 0.4, 1 / (1 + x.g[f] * (x.g[f] + x.k[f] + 0.4))); break;
            case 2: y = fl[0].bp; break; case 3: fl[1].run(fl[0].bp, x.g[f], x.k[f], x.inv[f]); y = fl[1].bp; break;
            case 4: y = in - fl[0].bp * x.k[f]; break; case 5: y = fl[0].h; break; case 6: fl[1].run(fl[0].h, x.g[f], x.k[f], x.inv[f]); y = fl[1].h; break;
            default: y = lp;
          }
          y = driveA(y, (int)jsRound(p[b + 6]));
        }
        if (f == 0) y1 = y; else y2 = y;
      }
      double o1 = y1 * x.amp[0] * (1 - p[52] * 0.5), o2 = y2 * x.amp[1], pa = clamp(p[56] + x.pan * 0.5, -1, 1), pb = clamp(p[64] + x.pan * 0.5, -1, 1);
      L[i] = (float)(L[i] + (o1 * jsMin(1, 1 - pa) + o2 * jsMin(1, 1 - pb)) * vol); R[i] = (float)(R[i] + (o1 * jsMin(1, 1 + pa) + o2 * jsMin(1, 1 + pb)) * vol);
    }
  }
}

}  // namespace mdaw
