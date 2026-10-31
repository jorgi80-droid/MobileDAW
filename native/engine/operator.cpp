// Port of js/engine/operator.js. Keep in step with the JS original.
#include "operator.h"

namespace mdaw {

struct OpAlgo { int m[4][3]; int nm[4]; int c[4]; int nc; };
static const OpAlgo OP_ALGOS[11] = {
  { { { 1 }, { 2 }, { 3 }, {} }, { 1, 1, 1, 0 }, { 0 }, 1 }, { { { 1 }, { 2, 3 }, {}, {} }, { 1, 2, 0, 0 }, { 0 }, 1 }, { { { 1, 2 }, {}, { 3 }, {} }, { 2, 0, 1, 0 }, { 0 }, 1 },
  { { { 1, 3 }, { 2 }, {}, {} }, { 2, 1, 0, 0 }, { 0 }, 1 }, { { { 1 }, {}, { 3 }, {} }, { 1, 0, 1, 0 }, { 0, 2 }, 2 }, { { { 3 }, { 3 }, { 3 }, {} }, { 1, 1, 1, 0 }, { 0, 1, 2 }, 3 },
  { { { 1 }, { 2 }, {}, {} }, { 1, 1, 0, 0 }, { 0, 3 }, 2 }, { { { 1 }, {}, {}, {} }, { 1, 0, 0, 0 }, { 0, 2, 3 }, 3 }, { { { 1, 2, 3 }, {}, {}, {} }, { 3, 0, 0, 0 }, { 0 }, 1 },
  { { {}, {}, { 3 }, {} }, { 0, 0, 1, 0 }, { 0, 1, 2 }, 3 }, { { {}, {}, {}, {} }, { 0, 0, 0, 0 }, { 0, 1, 2, 3 }, 4 },
};
static inline double rnd01(uint32_t& s) { return lcg(s) / 4294967296.0; }
static inline double dblO(double db) { return db <= -60 ? 0 : std::pow(10, db / 20); }
static inline double COARSE(double c) { return c < 0.75 ? 0.5 : jsRound(c); }

double OpEnv::step(double a, double d, double s, double r, double ini, double pk, int loop, double dt) {
  switch (st) {
    case 1: v += (pk - ini) * dt / jsMax(0.0005, a); if ((pk >= ini && v >= pk) || (pk < ini && v <= pk)) { v = pk; st = 2; } break;
    case 2: v += (s - v) * (1 - std::exp(-dt * 4.6 / jsMax(0.0005, d))); if (std::fabs(v - s) < 1e-3) { v = s; st = loop == 1 ? 1 : loop == 2 ? 4 : 3; if (loop == 1) v = ini; } break;
    case 3: v = s; break;
    case 4: v -= v * (1 - std::exp(-dt * 4.6 / jsMax(0.0005, r))); if (v < 1e-4) { v = 0; st = 0; } break;
    default: return 0;
  }
  return v;
}
void Operator::noteOn(int pt, double vel) {
  int n = (int)clamp(jsRound(p[83]), 1, 16), k = -1;
  for (int i = 0; i < n; i++) if (!v[i].on) { k = i; break; }
  if (k < 0) { k = 0; for (int i = 1; i < n; i++) if (v[i].age < v[k].age) k = i; }
  OpVoice& x = v[k]; x.on = x.held = true; x.pitch = pt; x.vel = vel; x.age = ++counter; x.f = midiToHz(pt + p[80]);
  for (int o = 0; o < 4; o++) { x.ph[o] = 0; x.fb[o] = 0; x.out[o] = 0; x.e[o].start(dblO(p[o * 16 + 14])); }
  x.fe.start(0);
}
void Operator::render(float* L, float* R, int from, int to) {
  const int CT = 16; double dtc = CT / sr; const OpAlgo& alg = OP_ALGOS[(int)clamp(jsRound(p[68]), 0, 10)]; int ftype = (int)jsRound(p[70]); bool fon = p[69] > 0.5; double vol = dblO(p[79]) * 0.3, tone = p[78];
  double tk = 1 - std::exp(-TWO_PI * (200 * std::pow(100, tone)) / sr), time = std::pow(2, p[77]), spread = p[81], pan = p[76], pl = jsMin(1, 1 - pan), pr = jsMin(1, 1 + pan);
  for (int o = 0; o < 4; o++) { wav[o] = (int)jsRound(p[o * 16 + 7]); on[o] = p[o * 16] > 0.5; }
  auto isC = [&](int o) { for (int j = 0; j < alg.nc; j++) if (alg.c[j] == o) return true; return false; };
  for (auto& x : v) {
    if (!x.on) continue;
    double gk = 0, kq = 1.4, inv = 1;
    for (int i = from; i < to; i++) {
      if (x.cnt-- <= 0) {
        x.cnt = CT - 1; bool alive = false;
        double f0 = x.f * std::pow(2, bend / 2 * p[82] / 12);
        for (int o = 0; o < 4; o++) {
          int b = o * 16; double e = x.e[o].step(p[b + 10] * 0.001 * time, p[b + 11] * 0.001 * time, dblO(p[b + 12]), p[b + 13] * 0.001 * time, dblO(p[b + 14]), dblO(p[b + 15]), (int)jsRound(p[64 + o]), dtc);
          if (x.e[o].st != 0 && isC(o) && on[o]) alive = true;
          double fr = p[b + 3] > 0.5 ? p[b + 4] * p[b + 5] : f0 * COARSE(p[b + 1]) * (1 + p[b + 2] / 1000);
          x.dt[o] = clamp(fr / sr, 0, 0.49);
          x.lv[o] = on[o] ? e * dblO(p[b + 6]) * (1 - p[b + 9] + p[b + 9] * x.vel) : 0;
        }
        if (!alive) { x.on = false; break; }
        double fe = x.fe.step(p[74] * 0.001, p[75] * 0.001, 0, p[75] * 0.001, 0, 1, 0, dtc);
        double cut = clamp(p[71] * std::pow(2, p[73] * fe * 6), 20, sr * 0.45); gk = std::tan(PI * cut / sr); kq = 2 - 1.9 * p[72]; inv = 1 / (1 + gk * (gk + kq));
      }
      double* out = x.out;
      for (int o = 3; o >= 0; o--) {
        if (x.lv[o] == 0) { out[o] = 0; continue; }
        double pm = 0; for (int j = 0; j < alg.nm[o]; j++) pm += out[alg.m[o][j]];
        x.ph[o] += x.dt[o]; if (x.ph[o] >= 1) x.ph[o] -= 1;
        double xx = x.ph[o] + pm * 0.5 + x.fb[o] * p[o * 16 + 8] * 0.4, a = xx - std::floor(xx), y;
        switch (wav[o]) { case 1: y = 2 * a - 1; break; case 2: y = a < 0.5 ? 1 : -1; break; case 3: y = 1 - 4 * std::fabs(a - 0.5); break; case 4: y = rnd01(seed) * 2 - 1; break; default: y = std::sin(TWO_PI * xx); }
        y *= x.lv[o]; x.fb[o] = (x.fb[o] + y) * 0.5; out[o] = y;
      }
      double s = 0; for (int j = 0; j < alg.nc; j++) s += out[alg.c[j]];
      s *= vol / std::sqrt((double)alg.nc);
      x.tz += (s - x.tz) * tk; s = x.tz;
      if (fon) { double h = (s - (kq + gk) * x.a - x.b) * inv, bp = gk * h + x.a, lp = gk * bp + x.b; x.a = gk * h + bp; x.b = gk * bp + lp; s = ftype == 1 ? h : ftype == 2 ? bp : lp; }
      double w = spread != 0 ? out[alg.c[0]] * vol * spread * 0.3 * (x.age % 2 ? 1 : -1) : 0;
      L[i] = (float)(L[i] + (s * (1 - spread * 0.3) - w) * pl); R[i] = (float)(R[i] + (s * (1 - spread * 0.3) + w) * pr);
    }
  }
}

}  // namespace mdaw
