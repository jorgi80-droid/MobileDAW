// Port of js/engine/meld.js. Keep in step with the JS original.
#include "meld.h"

namespace mdaw {

static const int MB = 91, MG = 68;
enum { O_TYPE = 0, O_OCT = 1, O_SEMI = 2, O_FINE = 3, O_SHAPE = 4, O_TONE = 5, O_FTYPE = 6, O_FREQ = 7, O_Q = 8, O_MORPH = 9, O_PAN = 10, O_TILT = 11, O_LEVEL = 12, O_ON = 13,
  O_L1W = 22, O_L1S = 23, O_L1R = 24, O_L1D = 25, O_L1SH = 26, O_L1F = 27, O_L1P = 28, O_L1RT = 29, O_FX1 = 30, O_FX2 = 31, O_L2W = 32, O_L2S = 33, O_L2R = 34, O_L2D = 35, O_L2P = 36, O_L2RT = 37, O_MAT = 38 };
static const double MSYNC[7] = { 0.25, 0.5, 1, 2, 4, 8, 16 };
static inline double rnd01(uint32_t& s) { return lcg(s) / 4294967296.0; }
static inline double dblM(double db) { return db <= -60 ? 0 : std::pow(10, db / 20); }

double MEnv::step(double a, double d, double s, double r, double dt) {
  switch (st) {
    case 1: v += dt / jsMax(0.0005, a); if (v >= 1) { v = 1; st = 2; } break;
    case 2: v += (s - v) * (1 - std::exp(-dt * 4.6 / jsMax(0.0005, d))); if (std::fabs(v - s) < 1e-3) { v = s; st = 3; } break;
    case 3: v = s; break;
    case 4: v -= v * (1 - std::exp(-dt * 4.6 / jsMax(0.0005, r))); if (v < 1e-4) { v = 0; st = 0; } break;
    default: return 0;
  }
  return v;
}
Meld::Meld(double rate) : sr(rate) { v = new MeldVoice[16]; }
void Meld::start(MeldVoice& x, int pt, double vel) {
  x.on = x.held = true; x.pitch = pt; x.vel = vel; x.age = ++counter; x.f = midiToHz(pt);
  for (int e = 0; e < 2; e++) { MEng& E = x.e[e]; int b = e ? MB : 0; E.ae.start(); E.me.start(); E.t = 0; E.l1 = p[b + O_L1RT] > 0.5 ? 0 : g1[e]; E.l2 = p[b + O_L2RT] > 0.5 ? 0 : g2[e]; E.nll = 0; }
}
void Meld::noteOn(int pt, double vel) {
  bool mono = jsRound(p[MG]) == 1; int n = mono ? 1 : (int)clamp(jsRound(p[MG + 1]), 1, 16), stack = 1 + (int)clamp(jsRound(p[MG + 3]), 0, 3);
  if (mono) { int j = 0; for (int i = 0; i < nheld; i++) if (held[i] != pt) held[j++] = held[i]; nheld = j; if (nheld < 128) held[nheld++] = pt;
    MeldVoice& x = v[0]; bool leg = x.on && x.held; if (leg) { x.pitch = pt; x.f = midiToHz(pt); x.vel = vel; } else start(x, pt, vel); x.det = 0; return; }
  for (int u = 0; u < stack; u++) {
    int k = -1; for (int i = 0; i < n * stack && i < 16; i++) if (!v[i].on) { k = i; break; } if (k < 0) { k = 0; int lim = n * stack < 16 ? n * stack : 16; for (int i = 1; i < lim; i++) if (v[i].age < v[k].age) k = i; }
    MeldVoice& x = v[k]; start(x, pt, vel); double sp = stack > 1 ? (double)u / (stack - 1) - 0.5 : 0; x.det = sp * p[MG + 2] * 0.6; x.pan = sp * p[MG + 2] * 2;
  }
}
void Meld::noteOff(int pt) {
  if (jsRound(p[MG]) == 1) { int j = 0; for (int i = 0; i < nheld; i++) if (held[i] != pt) held[j++] = held[i]; nheld = j; MeldVoice& x = v[0]; if (nheld) { if (x.pitch == pt) { x.pitch = held[nheld - 1]; x.f = midiToHz(x.pitch); } return; } }
  for (int k = 0; k < 16; k++) { MeldVoice& x = v[k]; if (x.on && x.held && x.pitch == pt) { x.held = false; for (auto& E : x.e) { E.ae.release(); E.me.release(); } } }
}
double Meld::lfo(double w, double x, double sh, double fold, double s) {
  x -= std::floor(x); if (sh != 0) x = sh > 0 ? std::pow(x, 1 + sh * 3) : 1 - std::pow(1 - x, 1 - sh * 3);
  double y; switch ((int)jsRound(w)) { case 1: y = 1 - 4 * std::fabs(x - 0.5); break; case 2: y = 2 * x - 1; break; case 3: y = x < 0.5 ? 1 : -1; break; case 4: case 5: y = s; break; default: y = std::sin(TWO_PI * x); }
  if (fold > 0) y = std::sin(y * (1 + fold * 4) * PI / 2);
  return y;
}
double Meld::osc(MEng& E, int type) {
  double d = E.d, sh = E.shape, tn = E.tone;
  switch (type) {
    case 1: { double s = 0; for (int k = 0; k < 6; k++) { double det = 1 + (k - 2.5) * sh * 0.012 + (k % 2 ? tn * (k == 5 ? 1 : 0) : 0); E.ph[k] += d * det * (k == 5 && tn > 0.5 ? 2 : 1); if (E.ph[k] >= 1) E.ph[k] -= 1; s += std::sin(TWO_PI * E.ph[k]); } return s / 3; }
    case 2: { E.ph[0] += d; if (E.ph[0] >= 1) E.ph[0] -= 1; double ratio = 1 + jsRound(sh * 7); E.ph[1] += d * ratio; if (E.ph[1] >= 1) E.ph[1] -= 1; return std::sin(TWO_PI * E.ph[0] + tn * 4 * std::sin(TWO_PI * E.ph[1])); }
    case 3: { E.ph[0] += d; if (E.ph[0] >= 1) E.ph[0] -= 1; E.ph[1] += d * 2; if (E.ph[1] >= 1) E.ph[1] -= 1; double x = std::sin(TWO_PI * E.ph[0] + tn * 3 * std::sin(TWO_PI * E.ph[1])); return std::sin(x * (1 + sh * 5) * PI / 2); }
    case 4: { E.ph[0] += d; if (E.ph[0] >= 1) E.ph[0] -= 1; double x = 2 * E.ph[0] - 1 - polyBlep(E.ph[0], d), g = std::tan(PI * clamp(d * sr * (1 + sh * 30), 20, sr * 0.45) / sr), k = 2 - 1.98 * tn;
      double h = (x - (k + g) * E.sv[0] - E.sv[1]) / (1 + g * (g + k)), bp = g * h + E.sv[0], lp = g * bp + E.sv[1]; E.sv[0] = g * h + bp; E.sv[1] = g * bp + lp; return clamp(lp * 1.5, -2, 2); }
    case 5: { int len = (int)clamp(jsRound(1 / jsMax(1e-4, d)), 2, 2048); if (E.nll != len) { E.nll = len; for (int k = 0; k < len; k++) E.nl[k] = (float)(rnd01(seed) * 2 - 1); E.nlp = 0; }
      int j = E.nlp; double y = E.nl[j]; E.nl[j] = (float)(y * (1 - sh * 0.5) + E.nl[(j + 1) % len] * sh * 0.5); E.nlp = (j + 1) % len; E.z += (y - E.z) * (0.05 + tn * 0.95); return E.z; }
    case 6: { E.ph[0] += d; if (E.ph[0] >= 1) E.ph[0] -= 1; if (--E.hold <= 0) { E.hold = 1 + jsRound(tn * 40); double bits = 2 + jsRound((1 - sh) * 10), q = std::pow(2, bits); E.hv = jsRound(std::sin(TWO_PI * E.ph[0]) * q) / q; } return E.hv; }
    case 7: { E.ph[0] += d; if (E.ph[0] >= 1) E.ph[0] -= 1; static const double DUTY[4] = { 0.125, 0.25, 0.5, 0.75 }; double duty = DUTY[(int)jsMin(3, std::floor(sh * 4))]; double x = E.ph[0] < duty ? 1 : -1;
      if (tn > 0 && rnd01(seed) < tn * 0.3) return rnd01(seed) * 2 - 1; return x; }
    default: { E.ph[0] += d; if (E.ph[0] >= 1) E.ph[0] -= 1; double a = E.ph[0], s = sh * 3, sq = (a < 0.5 - tn * 0.4 ? 1 : -1), shapes[4] = { std::sin(TWO_PI * a), 1 - 4 * std::fabs(a - 0.5), 2 * a - 1 - polyBlep(a, d), sq };
      int i0 = (int)jsMin(2, std::floor(s)); double f = s - i0, y = shapes[i0] * (1 - f) + shapes[i0 + 1] * f, g = 1 + tn * 5; return std::tanh(y * g) / std::tanh(g); }
  }
}
double Meld::filt(MEng& E, double x) {
  switch (E.ft) {
    case 1: return E.f2.run(E.f1.run(x, E.g, E.k, E.inv), E.g, E.k + 0.3, E.inv2);
    case 2: return E.f2.run(E.f1.run(std::tanh(x * (1 + E.morph * 6)), E.g, E.k, E.inv), E.g, E.k + 0.3, E.inv2);
    case 3: { double dd = E.cd, pos = E.cw - dd, k = std::floor(pos), f = pos - k; const int M = 4095; int ki = toInt32(k); double y = E.comb[ki & M] * (1 - f) + E.comb[(ki + 1) & M] * f;
      E.comb[toInt32(E.cw) & M] = (float)(x + y * (E.morph * 2 - 1) * 0.95 * (0.5 + E.cq * 0.5)); E.cw++; return (x + y) * 0.6; }
    default: { double lp = E.f1.run(x, E.g, E.k, E.inv), m = E.morph * 3, bp = E.f1.bp, hp = E.f1.h, no = lp + hp, o[4] = { lp, bp, hp, no }; int i0 = (int)jsMin(2, std::floor(m)); double f = m - i0; return o[i0] * (1 - f) + o[i0 + 1] * f; }
  }
}
void Meld::render(float* L, float* R, int from, int to) {
  for (int e = 0; e < 2; e++) { int b = e ? MB : 0; double n = (to - from) / sr;
    g1[e] = std::fmod(g1[e] + (p[b + O_L1S] > 0.5 ? bpm / 60 / MSYNC[(int)clamp(jsRound(p[b + O_L1D]), 0, 6)] : p[b + O_L1R]) * n, 1);
    g2[e] = std::fmod(g2[e] + (p[b + O_L2S] > 0.5 ? bpm / 60 / MSYNC[(int)clamp(jsRound(p[b + O_L2D]), 0, 6)] : p[b + O_L2R]) * n, 1); }
  const int CT = 16; double dtc = CT / sr, drive = p[MG + 4], vol = dblM(p[MG + 5]) * 0.25; bool limit = p[MG + 6] > 0.5;
  for (int vi = 0; vi < 16; vi++) {
    MeldVoice& x = v[vi]; if (!x.on) continue;
    for (int i = from; i < to; i++) {
      if (x.cnt-- <= 0) {
        x.cnt = CT - 1; bool alive = false;
        for (int e = 0; e < 2; e++) {
          MEng& E = x.e[e]; int b = e ? MB : 0; auto q = [&](int o) { return p[b + o]; };
          double ae = E.ae.step(q(14) * 0.001, q(15) * 0.001, q(16), q(17) * 0.001, dtc), me = E.me.step(q(18) * 0.001, q(19) * 0.001, q(20), q(21) * 0.001, dtc);
          if (q(O_ON) > 0.5 && E.ae.st != 0) alive = true;
          E.t += dtc; double fade = q(O_FX2) > 0 ? jsMin(1, E.t / q(O_FX2)) : 1;
          double* src = E.src; src[0] = ae; src[1] = me; src[2] = E.lv1; src[3] = E.lv2; src[4] = x.vel;
          auto m = [&](int t) { double s = 0; for (int k = 0; k < 5; k++) s += src[k] * q(O_MAT + t * 5 + k); return s; };
          double r1 = (q(O_L1S) > 0.5 ? bpm / 60 / MSYNC[(int)clamp(jsRound(q(O_L1D)), 0, 6)] : q(O_L1R)) * std::pow(2, m(5) * 4), r2 = q(O_L2S) > 0.5 ? bpm / 60 / MSYNC[(int)clamp(jsRound(q(O_L2D)), 0, 6)] : q(O_L2R);
          double p1 = E.l1; E.l1 += r1 * dtc; if (std::floor(E.l1) != std::floor(p1)) { bool w5 = jsRound(q(O_L1W)) == 5; double a = E.s1 * 0.5 * (w5 ? 1 : 0); E.s1 = a + (rnd01(seed) * 2 - 1) * (w5 ? 0.5 : 1); }
          double p2 = E.l2; E.l2 += r2 * dtc; if (std::floor(E.l2) != std::floor(p2)) E.s2 = rnd01(seed) * 2 - 1;
          src[2] = lfo(q(O_L1W), E.l1 + q(O_L1P) / 360, q(O_L1SH), q(O_L1F), E.s1) * q(O_FX1) * fade; src[3] = lfo(q(O_L2W), E.l2 + q(O_L2P) / 360, 0, 0, E.s2); E.lv1 = src[2]; E.lv2 = src[3];
          double st = q(O_OCT) * 12 + q(O_SEMI) + q(O_FINE) / 100 + bend / 2 * p[MG + 7] + x.det;
          E.d = clamp(x.f * std::pow(2, st / 12) / sr, 0, 0.45);
          E.shape = clamp(q(O_SHAPE) + m(0), 0, 1); E.tone = clamp(q(O_TONE) + m(1), 0, 1);
          double fc = clamp(q(O_FREQ) * std::pow(2, m(2) * 6), 20, sr * 0.45), qq = clamp(q(O_Q) + m(3), 0, 1); E.morph = clamp(q(O_MORPH) + m(4), 0, 1);
          int ft = (int)jsRound(q(O_FTYPE)); E.g = std::tan(PI * fc / sr); E.k = 2 - 1.95 * qq; E.inv = 1 / (1 + E.g * (E.g + E.k)); E.inv2 = 1 / (1 + E.g * (E.g + E.k + 0.3)); E.cd = clamp(sr / fc, 2, 4000); E.cq = qq;
          E.amp = q(O_ON) > 0.5 ? ae * dblM(q(O_LEVEL)) : 0; double pan = clamp(q(O_PAN) + x.pan, -1, 1); E.pl = jsMin(1, 1 - pan); E.pr = jsMin(1, 1 + pan); E.tilt = q(O_TILT); E.ft = ft;
        }
        if (!alive) { x.on = false; break; }
      }
      double l = 0, r = 0;
      for (int e = 0; e < 2; e++) {
        MEng& E = x.e[e]; if (E.amp == 0) continue;
        int b = e ? MB : 0; double xx = osc(E, (int)jsRound(p[b])), y = filt(E, xx);
        E.tz += (y - E.tz) * 0.15; double t = E.tilt, o = (t >= 0 ? y + (y - E.tz) * t * 2 : E.tz * (-t) + y * (1 + t)) * E.amp;
        l += o * E.pl; r += o * E.pr;
      }
      if (drive > 0) { double g = 1 + drive * 8; l = std::tanh(l * g) / std::sqrt(g); r = std::tanh(r * g) / std::sqrt(g); }
      L[i] = (float)(L[i] + l * vol); R[i] = (float)(R[i] + r * vol);
    }
  }
  if (limit) for (int i = from; i < to; i++) { L[i] = (float)std::tanh((double)L[i]); R[i] = (float)std::tanh((double)R[i]); }
}

}  // namespace mdaw
