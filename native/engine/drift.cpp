// Port of js/engine/drift.js. Keep in step with the JS original.
#include "drift.h"

namespace mdaw {

static const double DRIFT_SYNC[7] = { 0.25, 0.5, 1, 2, 4, 8, 16 };
static const int DVOICES[8] = { 2, 4, 6, 8, 12, 16, 24, 32 };
static inline double rnd01(uint32_t& s) { return lcg(s) / 4294967296.0; }
static inline double dblD(double db) { return db <= -60 ? 0 : std::pow(10, db / 20); }
static inline int rnd_i(double x) { return (int)jsRound(x); }

double DEnv::step(double a, double d, double s, double r, double dt, bool cyc) {
  switch (st) {
    case 1: v += dt / jsMax(0.0005, a); if (v >= 1) { v = 1; st = 2; } break;
    case 2: v += (s - v) * (1 - std::exp(-dt * 4.6 / jsMax(0.0005, d))); if (std::fabs(v - s) < 1e-3) { v = s; st = cyc ? 4 : 3; } break;
    case 3: v = s; break;
    case 4: v -= v * (1 - std::exp(-dt * 4.6 / jsMax(0.0005, r))); if (v < 1e-4) { v = 0; st = cyc ? 1 : 0; } break;
    default: return 0;
  }
  return v;
}
Drift::Drift(double rate) : sr(rate) { p[22] = 1000; p[31] = 2; p[32] = 600; p[34] = 400; p[42] = 1; p[47] = 1; p[51] = 7; p[55] = -6; }
int Drift::maxVoices() { int m = rnd_i(p[50]); return m == 1 ? 1 : m == 3 ? 4 : DVOICES[(int)clamp(jsRound(p[51]), 0, 7)]; }
DriftVoice& Drift::alloc(int n) { int k = -1; for (int i = 0; i < n; i++) if (!v[i].on) { k = i; break; } if (k < 0) { k = 0; for (int i = 1; i < n; i++) if (v[i].age < v[k].age) k = i; } return v[k]; }
void Drift::start(DriftVoice& x, int pt, double vel, bool legato) {
  double f = midiToHz(pt + p[57]);
  x.glideF = legato || (p[54] > 0 && x.on) ? (x.f != 0 ? x.f : f) : f;
  x.on = x.held = true; x.pitch = pt; x.vel = vel; x.age = ++counter; x.f = f; x.rnd = rnd01(seed);
  if (!legato) {
    if (p[21] > 0.5) { x.ph1 = 0; x.ph2 = 0; } else { x.ph1 = rnd01(seed); x.ph2 = rnd01(seed); }
    x.e1.start(false); x.e2.start(false); x.lph = p[46] > 0.5 ? 0 : rnd01(seed);
  }
}
void Drift::noteOn(int pt, double vel) {
  int mode = rnd_i(p[50]);
  if (mode == 1) { int j = 0; for (int i = 0; i < nheld; i++) if (held[i] != pt) held[j++] = held[i]; nheld = j; if (nheld < 128) held[nheld++] = pt;
    DriftVoice& x = v[0]; bool leg = p[53] > 0.5 && x.on && x.held; start(x, pt, vel, leg); return; }
  if (mode == 3) { for (int u = 0; u < 4; u++) { DriftVoice& x = alloc(32); start(x, pt, vel, false); x.det = (u - 1.5) * 0.08; x.pan = (u - 1.5) / 1.5; x.age = counter; } return; }
  DriftVoice& x = alloc(maxVoices()); start(x, pt, vel, false); x.det = 0; x.pan = mode == 2 ? (rnd01(seed) * 2 - 1) : 0;
}
void Drift::noteOff(int pt) {
  if (rnd_i(p[50]) == 1) {
    int j = 0; for (int i = 0; i < nheld; i++) if (held[i] != pt) held[j++] = held[i]; nheld = j; DriftVoice& x = v[0];
    if (nheld && x.pitch == pt) { start(x, held[nheld - 1], x.vel, p[53] > 0.5); return; }
    if (!nheld && x.on) { x.held = false; x.e1.release(); x.e2.release(); } return;
  }
  for (auto& x : v) if (x.on && x.held && x.pitch == pt) { x.held = false; x.e1.release(); x.e2.release(); }
}
double Drift::lfoHz(DriftVoice& x) {
  int m = rnd_i(p[41]);
  return m == 0 ? p[42] : m == 1 ? x.glideF * p[43] / 100 : m == 2 ? 1000 / jsMax(1, p[44]) : bpm / 60 / DRIFT_SYNC[(int)clamp(jsRound(p[45]), 0, 6)];
}
double Drift::lfo(DriftVoice& x) {
  int w = rnd_i(p[40]); double y = x.lph - std::floor(x.lph);
  switch (w) {
    case 1: return 1 - 4 * std::fabs(y - 0.5); case 2: return 2 * y - 1; case 3: return 1 - 2 * y; case 4: return y < 0.5 ? 1 : -1;
    case 5: return x.lsh; case 6: return x.wan; case 7: return x.lph < 1 ? 1 - 2 * y : -1; case 8: return x.lph < 1 ? 2 * std::exp(-y * 5) - 1 : -1;
    default: return std::sin(TWO_PI * y);
  }
}
void Drift::render(float* L, float* R, int from, int to) {
  int w1x = 0; const int CT = 16; double dtc = CT / sr; int w1 = rnd_i(p[0]), w2 = rnd_i(p[5]); bool two = rnd_i(p[23]) == 1;
  double glide = p[54] > 0 ? std::exp(-dtc / (p[54] * 0.001)) : 0, out = gainOut * dblD(p[55]), vv = p[56]; bool r1 = p[14] > 0.5, r2 = p[17] > 0.5, rn = p[20] > 0.5;
  for (auto& x : v) {
    if (!x.on) continue;
    double o1 = 0, o2 = 0, on = 0, sh = 0, cut = 1000, gk = 0, k = 2, hg = 0, amp = 0, pan = x.pan, d1 = 0, d2 = 0, gl = 0, gr = 0, i1 = 1, i2 = 1, ih = 1;
    for (int i = from; i < to; i++) {
      if (x.cnt-- <= 0) {
        x.cnt = CT - 1;
        double e1 = x.e1.step(p[31] * 0.001, p[32] * 0.001, p[33], p[34] * 0.001, dtc, false), e2 = x.e2.step(p[35] * 0.001, p[36] * 0.001, p[37], p[38] * 0.001, dtc, p[39] > 0.5);
        if (x.e1.st == 0) { x.on = false; break; }
        double lr = lfoHz(x), prev = x.lph; x.lph += lr * dtc; if (std::floor(x.lph) != std::floor(prev)) x.lsh = rnd01(seed) * 2 - 1;
        x.wanT += lr * dtc; if (x.wanT >= 0.25) { x.wanT = 0; x.wanG = clamp(x.wan + (rnd01(seed) - 0.5), -1, 1); } x.wan = x.wan + (x.wanG - x.wan) * 0.05;
        if (rnd_i(p[40]) < 7 && x.lph > 1e6) x.lph -= std::floor(x.lph);
        double lm = clamp(p[47] + src(x, rnd_i(p[48]), e1, e2, 0) * p[49], -1, 1), lf = lfo(x) * lm;
        for (auto& m : md) m = 0;
        for (int s = 0; s < 3; s++) { int dst = rnd_i(p[60 + s * 3]); if (dst > 0) md[dst] += src(x, rnd_i(p[59 + s * 3]), e1, e2, lf) * p[61 + s * 3]; }
        x.dT -= dtc; if (x.dT <= 0) { x.dT = 0.15 + rnd01(seed) * 0.3; x.dG = (rnd01(seed) * 2 - 1); } x.drift += (x.dG - x.drift) * 0.02;
        x.glideF = glide != 0 ? x.f + (x.glideF - x.f) * glide : x.f;
        double pm = src(x, rnd_i(p[8]), e1, e2, lf) * p[9] * 12 + src(x, rnd_i(p[10]), e1, e2, lf) * p[11] * 12 + md[6] * 12 + bend / 2 * p[58] + x.det + x.drift * p[52] * 0.3;
        double f = x.glideF * std::pow(2, pm / 12);
        d1 = clamp(f * std::pow(2, jsRound(p[1])) / sr, 0, 0.45); d2 = clamp(f * std::pow(2, jsRound(p[6]) + (p[7] + md[5] * 12) / 12) / sr, 0, 0.45);
        sh = clamp(p[2] + src(x, rnd_i(p[3]), e1, e2, lf) * p[4] + md[4], 0, 1);
        o1 = p[12] > 0.5 ? dblD(p[13]) * clamp(1 + md[1], 0, 2) : 0; o2 = p[15] > 0.5 ? dblD(p[16]) * clamp(1 + md[2], 0, 2) : 0; on = p[18] > 0.5 ? dblD(p[19]) * clamp(1 + md[3], 0, 2) : 0;
        double fo = src(x, rnd_i(p[27]), e1, e2, lf) * p[28] * 6 + src(x, rnd_i(p[29]), e1, e2, lf) * p[30] * 6 + md[7] * 6 + p[24] * (x.pitch - 60) / 12;
        cut = clamp(p[22] * std::pow(2, fo), 20, sr * 0.45); gk = std::tan(PI * cut / sr); k = 2 - 1.95 * clamp(p[25] + md[8], 0, 1);
        hg = std::tan(PI * clamp(p[26] * std::pow(2, md[9] * 4), 10, sr * 0.45) / sr); i1 = 1 / (1 + gk * (gk + k)); i2 = 1 / (1 + gk * (gk + k + 0.3)); ih = 1 / (1 + hg * (hg + 1.4142));
        amp = e1 * (1 - vv + vv * x.vel) * clamp(1 + md[11], 0, 2) * out; pan = clamp(x.pan + md[12], -1, 1); gl = amp * jsMin(1, 1 - pan); gr = amp * jsMin(1, 1 + pan);
      }
      x.ph1 += d1; if (x.ph1 >= 1) x.ph1 -= 1; x.ph2 += d2; if (x.ph2 >= 1) x.ph2 -= 1;
      double a = x.ph1, b = x.ph2, x1 = 0, x2 = 0;
      if (o1 == 0) w1x = -1; else w1x = w1;
      switch (w1x) {
        case 0: { double sa = std::sin(TWO_PI * a); x1 = sh > 0.001 ? std::sin(TWO_PI * a + sh * 3 * sa) : sa; break; }
        case 1: { double t = (1 - 4 * std::fabs(a - 0.5)) * (1 + sh * 3); x1 = std::sin(t * PI / 2); break; }
        case 2: { double sk = 0.5 + sh * 0.49; x1 = a < sk ? 2 * a / sk - 1 : 1 - 2 * (a - sk) / (1 - sk); break; }
        case 3: { double g = 1 + sh * 8; x1 = std::tanh(std::sin(TWO_PI * a) * g) / std::tanh(g); break; }
        case 4: { double q = a * (1 + sh * 3), fq = q - std::floor(q); x1 = 2 * fq - 1 - (sh < 0.01 ? polyBlep(a, d1) : 0); break; }
        case 5: case 6: { double pw = w1 == 5 ? 0.5 - sh * 0.45 : 0.5 + sh * 0.45, c = a + (1 - pw); if (c >= 1) c -= 1; x1 = (a < pw ? 1 : -1) + polyBlep(a, d1) - polyBlep(c, d1); break; }
        default: x1 = 0;
      }
      if (o2 == 0) x2 = 0; else switch (w2) {
        case 0: x2 = std::sin(TWO_PI * b); break; case 1: x2 = 1 - 4 * std::fabs(b - 0.5); break; case 2: x2 = std::tanh(std::sin(TWO_PI * b) * 3) / std::tanh(3); break;
        case 3: x2 = 2 * b - 1 - polyBlep(b, d2); break; default: { double c = b + 0.5; if (c >= 1) c -= 1; x2 = (b < 0.5 ? 1 : -1) + polyBlep(b, d2) - polyBlep(c, d2); }
      }
      double nz = on != 0 ? (rnd01(seed) * 2 - 1) : 0;
      double a1 = x1 * o1, a2 = x2 * o2, an = nz * on, fin = (r1 ? a1 : 0) + (r2 ? a2 : 0) + (rn ? an : 0), dry = (r1 ? 0 : a1) + (r2 ? 0 : a2) + (rn ? 0 : an);
      double y = x.fl[0].run(fin, gk, k, i1); if (two) y = x.fl[1].run(y, gk, k + 0.3, i2);
      y = x.hl.hp(y + dry, hg, ih);
      L[i] = (float)(L[i] + y * gl); R[i] = (float)(R[i] + y * gr);
    }
  }
}

}  // namespace mdaw
