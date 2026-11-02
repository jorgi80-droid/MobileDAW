// Port of js/engine/live.js (same order of operations; Float32Array storage = float).
#include "live.h"
#include "fx.h"
#include <atomic>
#include <cmath>
#include <mutex>

namespace mdaw {

static inline double dbLin(double db) { return std::pow(10, db / 20); }
static inline double hermL(double y0, double y1, double y2, double y3, double fr) { double c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2); return ((c3 * fr + c2) * fr + c1) * fr + y1; }
static inline double rnd01(uint32_t& s) { return lcg(s) / 4294967296.0; }
static double lfoShape(int shape, double ph, double hold) {
  switch (shape) { case 0: return std::sin(TWO_PI * ph); case 1: return 4 * std::fabs(ph - 0.5) - 1; case 2: return 2 * ph - 1; case 3: return ph < 0.5 ? 1 : -1; default: return hold; }
}

// ================================================================ Sampler (10)
enum { S_VOL = 0, S_PAN, S_TRANSPOSE, S_DETUNE, S_SPREAD, S_VOICES, S_SCALE, S_VOLVEL, S_INTERP, S_FON, S_FTYPE, S_FREQ, S_RES, S_FENV, S_AA, S_AD, S_AS, S_AR, S_FA, S_FD, S_FS, S_FR,
  S_PENV, S_PDEC, S_LSHAPE, S_LRATE, S_LPITCH, S_LFILT, S_LVOL, S_LPAN, S_RELMODE, S_SNAP, S_TIME, S_OSCON, S_OSCWAVE, S_OSCLVL, S_OSCSEMI, S_OSCDET, S_SMPLVL };
constexpr int SMP_ZONE0 = 200, SMP_ZONE_N = 16, SMP_FIELDS = 16;

LiveSampler::LiveSampler(double rate, Bank* b) : sr(rate), bank(b) {
  pitchNative = true;
  const double d[39] = { 0, 0, 0, 0, 0, 16, 1, 0.35, 0, 0, 0, 20000, 0.707, 0, 0.001, 0.6, 1, 0.05, 0.001, 0.6, 1, 0.05, 0, 0.15, 0, 4, 0, 0, 0, 0, 0, 0, 1, 0, 0, -12, 0, 0, 0 };
  for (int k = 0; k < 39; k++) g[k] = d[k];
  upEnv();
}
void LiveSampler::upEnv() {
  double t = jsMax(0.05, g[S_TIME]);
  ap = adsrParams(g[S_AA] * t, g[S_AD] * t, g[S_AS], g[S_AR] * t, sr);
  fp = adsrParams(g[S_FA] * t, g[S_FD] * t, g[S_FS], g[S_FR] * t, sr);
}
void LiveSampler::setParam(int i, double x) {
  if (i == 90) { pitch = clamp(x, -24, 24); return; }
  if (i >= SMP_ZONE0) {
    int zi = (i - SMP_ZONE0) / SMP_FIELDS, k = (i - SMP_ZONE0) % SMP_FIELDS; if (zi >= SMP_ZONE_N) return;
    LsZone& q = z[zi];
    switch (k) {
      case 0: q.id = toInt32(x); break; case 1: q.root = (int)clamp(toInt32(x), 0, 127); break; case 2: q.lo = (int)clamp(toInt32(x), 0, 127); break; case 3: q.hi = (int)clamp(toInt32(x), 0, 127); break;
      case 4: q.vlo = (int)clamp(toInt32(x), 1, 127); break; case 5: q.vhi = (int)clamp(toInt32(x), 1, 127); break; case 6: q.det = clamp(x, -100, 100); break; case 7: q.sus = (int)clamp(toInt32(x), 0, 2); break;
      case 8: q.s0 = clamp(x, 0, 1); break; case 9: q.s1 = clamp(x, 0, 1); break; case 10: q.l0 = clamp(x, 0, 1); break; case 11: q.l1 = clamp(x, 0, 1); break;
      case 12: q.xf = clamp(x, 0, 1); break; case 13: q.rev = x > 0.5; break; case 14: q.vol = clamp(x, -60, 24); break; case 15: q.pan = clamp(x, -1, 1); break;
    }
    return;
  }
  if (i < 0 || i >= 40) return;
  g[i] = x;
  if ((i >= S_AA && i <= S_FR) || i == S_TIME) upEnv();
}
LsVoice& LiveSampler::alloc() {
  int n = (int)clamp(jsRound(g[S_VOICES]), 1, 32), used = 0, oldest = 0, fr = -1;
  for (int k = 0; k < 32; k++) { LsVoice& x = v[k]; if (x.on) { used++; if (v[oldest].age > x.age || !v[oldest].on) oldest = k; } else if (fr < 0) fr = k; }
  if (fr >= 0 && used < n) return v[fr];
  if (used >= n) { int o = -1; for (int k = 0; k < 32; k++) if (v[k].on && (o < 0 || v[k].age < v[o].age)) o = k; if (o >= 0) return v[o]; }
  return fr >= 0 ? v[fr] : v[oldest];
}
int LiveSampler::zero(const Sample* s, double i0) const {
  const float* l = s->l; int n = s->frames; int i = (int)clamp(toInt32(i0), 0, n - 2);
  for (int k = 0; k < 256; k++) { int js[2] = { i + k, i - k }; for (int j : js) if (j >= 0 && j < n - 1 && (l[j] <= 0) != (l[j + 1] <= 0)) return j; }
  return i;
}
void LiveSampler::start(const LsZone& q, const Sample* s, int p, double vel, double dt, double pan) {
  LsVoice& x = alloc(); int frames = s->frames;
  x.on = x.held = true; x.rel = false; x.pitch = p; x.vel = vel; x.age = ++counter; x.id = q.id;
  double a = std::floor(jsMin(q.s0, q.s1) * (frames - 1)), b = std::ceil(jsMax(q.s0, q.s1) * (frames - 1));
  double la = std::floor(jsMin(q.l0, q.l1) * (frames - 1)), lb = std::ceil(jsMax(q.l0, q.l1) * (frames - 1));
  if (g[S_SNAP] > 0.5) { a = zero(s, a); b = zero(s, b); la = zero(s, la); lb = zero(s, lb); }
  if (b - a < 2) b = jsMin(frames - 1, a + 2);
  la = clamp(la, a, b - 1); lb = clamp(lb, la + 1, b);
  x.s0 = a; x.s1 = b; x.sus = q.sus; x.rev = q.rev; x.xf = q.xf * (lb - la) * 0.5;
  if (q.rev) { double len = b - a; x.l0 = len - (lb - a); x.l1 = len - (la - a); x.pos = 0; } else { x.l0 = la - a; x.l1 = lb - a; x.pos = 0; }
  x.dir = 1;
  x.zvol = dbLin(q.vol) * (pan != 0 ? 0.707 : 1); x.zpan = q.pan; x.vpan = pan;
  x.keyOff = ((p - q.root) * g[S_SCALE]) + g[S_TRANSPOSE] + pitch + (q.det + g[S_DETUNE] + dt) / 100;
  x.base = s->rate / sr;
  x.fl.reset(); x.fr.reset(); x.lfo = 0; x.hold = rnd01(seed) * 2 - 1; x.pe = 1; x.op = 0; x.sd = false;
  x.env.start(); x.fenv.start();
}
void LiveSampler::startOsc(int p, double vel) {
  LsVoice& x = alloc();
  x.on = x.held = true; x.rel = false; x.pitch = p; x.vel = vel; x.age = ++counter; x.id = -1; x.pos = 0; x.dir = 1;
  x.s0 = x.s1 = x.l0 = x.l1 = 0; x.xf = 0; x.sus = 0; x.rev = false; x.zvol = 1; x.zpan = 0; x.vpan = 0; x.keyOff = g[S_TRANSPOSE] + pitch + g[S_DETUNE] / 100; x.base = 1;
  x.fl.reset(); x.fr.reset(); x.lfo = 0; x.hold = rnd01(seed) * 2 - 1; x.pe = 1; x.op = 0; x.sd = false;
  x.env.start(); x.fenv.start();
}
void LiveSampler::noteOn(int p, double vel) {
  double vi = jsMin(127, jsRound(vel * 127)), sp = g[S_SPREAD]; bool started = false;
  for (auto& q : z) {
    const Sample* s = q.id >= 0 && q.id < 256 ? bank->s[q.id] : nullptr;
    if (!s || s->frames < 4 || p < q.lo || p > q.hi || vi < q.vlo || vi > q.vhi) continue;
    started = true;
    if (sp > 0.005) { start(q, s, p, vel, -sp * 25, -sp); start(q, s, p, vel, sp * 25, sp); } else start(q, s, p, vel, 0, 0);
  }
  if (!started && g[S_OSCON] > 0.5) startOsc(p, vel);
}
void LiveSampler::noteOff(int p) { for (auto& x : v) if (x.on && x.held && x.pitch == p) { x.held = false; x.rel = true; x.env.release(); x.fenv.release(); } }
void LiveSampler::allOff() { for (auto& x : v) if (x.on) { x.held = false; x.rel = true; x.env.release(); x.fenv.release(); } }
void LiveSampler::render(float* L, float* R, int from, int to) {
  bool hi = g[S_INTERP] > 0.5, fon = g[S_FON] > 0.5; int ft = (int)jsRound(g[S_FTYPE]);
  double lfoInc = g[S_LRATE] / sr; int lsh = (int)jsRound(g[S_LSHAPE]); double lP = g[S_LPITCH] * 12, lF = g[S_LFILT], lV = g[S_LVOL], lPan = g[S_LPAN];
  double pDec = std::exp(-32 / jsMax(1, g[S_PDEC] * sr)), pAmt = g[S_PENV], vv = g[S_VOLVEL], gv = dbLin(g[S_VOL]), gp = g[S_PAN], fAmt = g[S_FENV], frq = g[S_FREQ], res = g[S_RES];
  bool relMode = g[S_RELMODE] > 0.5; double maxF = sr * 0.45;
  bool oscOn = g[S_OSCON] > 0.5; int oWave = (int)jsRound(g[S_OSCWAVE]); double oLvl = dbLin(g[S_OSCLVL]), oOff = g[S_OSCSEMI] + g[S_OSCDET] / 100, sLvl = dbLin(g[S_SMPLVL]);
  for (auto& x : v) {
    if (!x.on) continue;
    bool osc = x.id < 0;
    const Sample* s = osc ? nullptr : (x.id < 256 ? bank->s[x.id] : nullptr);
    if (!osc && (!s || s->frames < 4)) { x.on = false; continue; }
    if (osc && !oscOn) { x.on = false; continue; }
    const float* sl = osc ? nullptr : s->l; const float* sr_ = osc ? nullptr : s->r;
    double a = x.s0, len = x.s1 - x.s0, l0 = x.l0, l1 = x.l1, loopLen = l1 - l0, xf = x.xf; bool rev = x.rev;
    for (int i = from; i < to; i += 32) {
      int e2 = (int)jsMin(to, i + 32);
      x.lfo += lfoInc * 32; if (x.lfo >= 1) { x.lfo -= 1; x.hold = rnd01(seed) * 2 - 1; }
      double lv = lfoShape(lsh, x.lfo, x.hold);
      x.pe *= pDec;
      double fe = x.fenv.v;
      double ratio = x.base * std::pow(2, (x.keyOff + pAmt * x.pe + lP * lv) / 12);
      double oInc = oscOn ? midiToHz(x.pitch) * std::pow(2, (g[S_TRANSPOSE] + pitch + oOff + pAmt * x.pe + lP * lv) / 12) / sr : 0;
      if (fon) {
        double fc = clamp(frq * std::pow(2, fAmt * 6 * fe + lF * 3 * lv), 20, maxF);
        if (ft == 0) x.fl.lowpass(sr, fc, res); else if (ft == 1) x.fl.highpass(sr, fc, res); else if (ft == 2) x.fl.bandpass(sr, fc, res); else x.fl.notch(sr, fc, res);
        x.fr.copy(x.fl);
      }
      double pn = clamp(gp + x.zpan + x.vpan + lPan * lv, -1, 1), pg = (1 - vv) + vv * x.vel;
      double gL = std::cos((pn + 1) * 0.7853982) * 1.4142 * gv * x.zvol * pg * (1 - lV * (0.5 - 0.5 * lv));
      double gR = std::sin((pn + 1) * 0.7853982) * 1.4142 * gv * x.zvol * pg * (1 - lV * (0.5 - 0.5 * lv));
      for (int k = i; k < e2; k++) {
        double e = x.env.next(ap); x.fenv.next(fp);
        if (x.env.st == 0) { x.on = false; break; }
        double xl = 0, xr = 0;
        if (!osc && !x.sd) {
          double p = x.pos;
          if (x.sus && !(x.rel && relMode)) {
            if (x.sus == 1) { if (p >= l1) p -= loopLen; }
            else { if (x.dir > 0 && p >= l1) { p = 2 * l1 - p; x.dir = -1; } else if (x.dir < 0 && p <= l0) { p = 2 * l0 - p; x.dir = 1; } }
            x.pos = p;
          }
          if (p >= len - 1 || p < 0) { if (oscOn) x.sd = true; else { x.on = false; break; } }
          if (!x.sd) {
            int ip = toInt32(p); double fr = p - ip;
            int j0 = (int)(rev ? x.s1 - 1 - ip : a + ip), j1 = (int)(rev ? x.s1 - 2 - ip : a + ip + 1);
            if (hi && ip > 0 && ip < len - 2) {
              int jm = (int)(rev ? x.s1 - ip : a + ip - 1), j2 = (int)(rev ? x.s1 - 3 - ip : a + ip + 2);
              xl = hermL(sl[jm], sl[j0], sl[j1], sl[j2], fr); xr = hermL(sr_[jm], sr_[j0], sr_[j1], sr_[j2], fr);
            } else { xl = sl[j0] + (sl[j1] - (double)sl[j0]) * fr; xr = sr_[j0] + (sr_[j1] - (double)sr_[j0]) * fr; }
            if (x.sus == 1 && xf > 1 && !(x.rel && relMode) && p > l1 - xf && p < l1) {
              double t = (p - (l1 - xf)) / xf, q = p - loopLen;
              if (q >= 0) {
                int i2 = toInt32(q); double f2 = q - i2; int ja = (int)(rev ? x.s1 - 1 - i2 : a + i2), jb = (int)(rev ? x.s1 - 2 - i2 : a + i2 + 1);
                double yl = sl[ja] + (sl[jb] - (double)sl[ja]) * f2, yr = sr_[ja] + (sr_[jb] - (double)sr_[ja]) * f2;
                xl = xl * (1 - t) + yl * t; xr = xr * (1 - t) + yr * t;
              }
            }
            xl *= sLvl; xr *= sLvl;
            x.pos += ratio * x.dir;
          }
        }
        if (oscOn) {
          x.op += oInc; if (x.op >= 1) x.op -= 1;
          double ph = x.op, o;
          if (oWave == 0) o = std::sin(TWO_PI * ph);
          else if (oWave == 1) o = 4 * std::fabs(ph - 0.5) - 1;
          else if (oWave == 2) { o = 2 * ph - 1; o -= polyBlep(ph, oInc); }
          else if (oWave == 3) { o = ph < 0.5 ? 1 : -1; o += polyBlep(ph, oInc); o -= polyBlep(std::fmod(ph + 0.5, 1), oInc); }
          else o = rnd01(seed) * 2 - 1;
          o *= oLvl; xl += o; xr += o;
        }
        if (fon) { xl = x.fl.process(xl); xr = x.fr.process(xr); }
        L[k] = (float)(L[k] + xl * e * gL); R[k] = (float)(R[k] + xr * e * gR);
      }
      if (!x.on) break;
    }
  }
}

// ================================================================ Wavetable frame sets
static inline double wrnd(int a, int b) { int32_t q = (int32_t)(uint32_t)(int64_t)(a * 7919 + b * 104729 + 1); return (((uint32_t)q * 2654435761u >> 8) & 0xffff) / 65536.0; }
static double vowel(int h, double t, double f0, const char* order, double bw) {
  static const double VA[5][2] = { { 800, 1150 }, { 400, 2000 }, { 300, 2500 }, { 500, 900 }, { 350, 700 } };   // A E I O U
  auto ix = [](char c) { return c == 'A' ? 0 : c == 'E' ? 1 : c == 'I' ? 2 : c == 'O' ? 3 : 4; };
  int n = 0; while (order[n]) n++;
  double x = t * (n - 1); int k = (int)jsMin(n - 2, toInt32(x)); double u = x - k; const double* a = VA[ix(order[k])]; const double* b = VA[ix(order[k + 1])];
  double f1 = a[0] + (b[0] - a[0]) * u, f2 = a[1] + (b[1] - a[1]) * u, f = f0 * h;
  return (1 / std::pow(h, 0.6)) * (std::exp(-std::pow((f - f1) / bw, 2)) + 0.7 * std::exp(-std::pow((f - f2) / (bw * 1.6), 2)) + 0.04);
}
static inline double oddPh(int h) { return (((h - 1) / 2) & 1) ? PI : 0; }
// live.js GEN, in WT_LIST order; returns the amplitude, ph = phase
static double gen(int g, int h, double t, int f, double& ph) {
  ph = 0;
  switch (g) {
    case 0: return h == 1 ? 1 : t / h;                                                                       // sineSaw
    case 1: { double w = 0.5 - 0.42 * t; ph = PI / 2 - h * PI * w; return std::sin(PI * h * w) / h; }         // squarePulse
    case 2: ph = oddPh(h); return (h & 1) ? 1 / std::pow(h, 2 - t) : 0;                                      // triSquare
    case 3: { double n = 1 + t * 23; return h <= n ? 1 / std::pow(h, 0.7) : jsMax(0, 1 - (h - n)) / std::pow(h, 0.7); }   // growHarm
    case 4: return (h & (h - 1)) == 0 ? (h == 1 ? 1 : t * 1.2 / std::log2(h * 2.0)) : 0;                     // octaves
    case 5: return (h == 1 || h == 3 || h == 9 || h == 27) ? (h == 1 ? 1 : t * 1.1 / std::pow(h, 0.5)) : 0;  // fifths
    case 6: ph = wrnd(h, 3) * 0.3 * t; return (1.0 / h) * (0.4 + 0.6 * std::fabs(std::sin(PI * h * (0.5 - 0.4 * t))));   // pulseStack
    case 7: { double c = 2 + t * 10; ph = h * t * 0.7; return std::exp(-std::pow(h - c, 2) / 2) + 0.6 * std::exp(-std::pow(h - c * 1.5, 2) / 2) + (h == 1 ? 0.3 : 0); }   // ringMod
    case 8: return (1.0 / h) * (1 + 5 * std::exp(-std::pow(h - (1 + t * 14), 2) / 1.2));                     // syncSweep
    case 9: ph = t * h * h * 0.06; return 1.0 / h;                                                            // chirp
    case 10: ph = oddPh(h); return (h & 1) ? std::fabs(std::sin(PI * h * (0.1 + t * 0.4))) / std::pow(h, 0.8) : 0;   // fold
    case 11: ph = oddPh(h); return (h & 1) ? std::pow(1.0 / h, 1 - 0.85 * t) : 0;                            // clip
    case 12: return (1.0 / h) * (wrnd(h, f) < 0.4 + 0.5 * t ? 1 : 0.1);                                      // bits
    case 13: return (1.0 / h) / (1 + std::pow(h / (1 + t * 22), 4));                                          // lpSweep
    case 14: return (1.0 / h) * std::exp(-std::pow(h - (1 + t * 20), 2) / (2 * std::pow(1 + t * 3, 2))) + (h == 1 ? 0.15 : 0);   // bpSweep
    case 15: return (1.0 / h) * (0.5 + 0.5 * std::cos(TWO_PI * h * (0.08 + t * 0.4)));                       // comb
    case 16: return vowel(h, t, 110, "AEIOU", 220);                                                           // aeiou
    case 17: ph = wrnd(h, 9) * 2; return vowel(h, t, 130, "OAEA", 260);                                      // choir
    case 18: return vowel(h, t, 220, "AOUIE", 300);                                                           // female
    case 19: return (h & 1) ? 1 / std::pow(h, 0.5 + t) : 0;                                                  // oddHarm
    case 20: return (h & 1) ? (h == 1 ? 1 : 1 - t) / h : t / h;                                              // evenHarm
    case 21: return std::pow(h, -(0.2 + 2.2 * (1 - t)));                                                     // tilt
    case 22: { static const double D[6][2] = { { 1, 1 }, { 2, 0.8 }, { 3, 0.6 }, { 4, 0.5 }, { 6, 0.4 }, { 8, 0.3 } }; for (auto& d : D) if (d[0] == h) return d[1] * (h == 1 ? 1 : 0.2 + 0.8 * t); return 0; }   // organ
    case 23: return std::exp(-h * (0.04 + 0.35 * (1 - t))) / std::pow(h, 0.4);                              // pluck
    case 24: { ph = h * 0.2; const double E[9] = { 0, 1, 0.1, 0.45 * t, 0.05, 0.2 * t, 0, 0, 0.1 * t }; double a = h < 9 ? E[h] : 0; return a == a && a != 0 ? a : 0; }   // epiano
    case 25: return (1.0 / h) * (0.3 + std::exp(-std::pow(h - (2 + t * 6), 2) / 3) * 3);                     // brass
    case 26: ph = wrnd(h, f + 7) * TWO_PI; return (h > 2 ? 1 / std::pow(h, 0.35) : 0.5) * (0.5 + 0.5 * wrnd(h, f + 1)) * (0.3 + t * 0.7);   // metalNoise
    case 27: ph = wrnd(h, 11) * TWO_PI; return wrnd(h, f + 3) > 0.5 - t * 0.3 ? 1 / std::pow(h, 0.5) : 0;    // digiNoise
    case 28: { static const double W[4] = { 0.5, 0.25, 0.125, 0.0625 }; double w = W[(int)jsMin(3, toInt32(t * 4))]; ph = PI / 2 - h * PI * w; return std::sin(PI * h * w) / h; }   // chipPulse
    case 29: ph = oddPh(h); return (h & 1) ? (1.0 / (h * h)) + (t * 0.06) / std::sqrt((double)h) : 0;        // chipTri
    case 30: return h <= 4 + toInt32(t * 12) ? 1.0 / h : 0;                                                  // chipSaw
    case 31: ph = wrnd(h, 5) * t * 0.9; return 1.0 / h;                                                      // analogSaw
    case 32: ph = oddPh(h); return (h & 1) ? (1.0 / h) * (1 - 0.8 * t * (h > 5 ? 1 : 0)) : 0;                // warmSquare
    default: ph = h * t * 1.3; return (1.0 / h) * (1 + 0.5 * std::sin(h * (1 + t * 3)));                     // detuneStack
  }
}
static std::atomic<const float*> WT[WT_COUNT];
static std::mutex wtMu;
void wtEnsure(int idx) {
  if (idx < 0 || idx >= WT_COUNT || WT[idx].load(std::memory_order_acquire)) return;
  std::lock_guard<std::mutex> g(wtMu);
  if (WT[idx].load(std::memory_order_relaxed)) return;
  float* d = new float[WT_NF * WT_NM * (WT_TL + 1)](); float acc[WT_TL], row[WT_TL];
  for (int f = 0; f < WT_NF; f++) {
    double t = (double)f / (WT_NF - 1), pk = 1e-6;
    for (int i = 0; i < WT_TL; i++) acc[i] = 0;
    for (int h = 1; h <= WT_NH; h++) {
      double ph; double amp = gen(idx, h, t, f, ph);
      if (amp) { for (int i = 0; i < WT_TL; i++) row[i] = (float)(amp * std::sin(TWO_PI * h * i / WT_TL + ph)); for (int i = 0; i < WT_TL; i++) acc[i] = (float)((double)acc[i] + row[i]); }
      if ((h & (h - 1)) == 0) {
        int m = WT_NM - 1 - (int)std::log2((double)h), o = wtAt(f, m);
        for (int i = 0; i < WT_TL; i++) d[o + i] = acc[i];
        if (m == 0) for (int i = 0; i < WT_TL; i++) pk = jsMax(pk, std::fabs(acc[i]));
      }
    }
    double k = 1 / pk;
    for (int m = 0; m < WT_NM; m++) { int o = wtAt(f, m); for (int i = 0; i < WT_TL; i++) d[o + i] = (float)(d[o + i] * k); d[o + WT_TL] = d[o]; }
  }
  WT[idx].store(d, std::memory_order_release);
}
const float* wtGet(int idx) { return idx >= 0 && idx < WT_COUNT ? WT[idx].load(std::memory_order_acquire) : nullptr; }
static int wtMip(double hz, double sr) { double maxH = (sr * 0.45) / jsMax(hz, 20); int m = 0; while (m < WT_NM - 1 && (WT_NH >> m) > maxH) m++; return m; }

// ================================================================ Wavetable (11)
enum { W_O1 = 0, W_O2 = 9, W_SUBON = 18, W_SUBG, W_SUBTONE, W_SUBOCT, W_TRANSPOSE, W_MONO, W_GLIDE, W_VOICES, W_UMODE, W_UVOICES, W_UAMT, W_VOL,
  W_FON = 30, W_FTYPE, W_FREQ, W_RES, W_DRIVE, W_AMP = 35, W_E2 = 39, W_E3 = 43, W_LFO1 = 47, W_LFO2 = 50, W_MX = 53, W_F2ON = 101, W_F2TYPE, W_F2FREQ, W_F2RES, W_F2ROUTE, W_VELRES };
constexpr int MX_SRC = 6, MX_DST = 8;
LiveWavetable::LiveWavetable(double rate) : sr(rate) {
  const double D[53] = { 0, 0.7, 0, 0, 0, 0, 0, 0, 1, 4, 0.5, 0, 0, 0, -6, 0, 0, 0, 0, -6, 0.5, 1, 0, 0, 30, 8, 0, 4, 0.2, -6, 1, 0, 20000, 0.707, 0,
    0.001, 0.6, 1, 0.1, 0.001, 0.6, 0, 0.1, 0.001, 0.6, 0, 0.1, 0, 1, 0, 0, 1, 0 };
  for (int i = 0; i < 53; i++) p[i] = D[i];
  p[W_F2ON] = 0; p[W_F2TYPE] = 1; p[W_F2FREQ] = 20; p[W_F2RES] = 0.707; p[W_F2ROUTE] = 0;
  o[1].on = false;
  for (int i = 0; i < 18; i++) setParam(i, p[i]);
  upEnv(); upO();
}
void LiveWavetable::upEnv() { auto E = [&](int b) { return adsrParams(p[b], p[b + 1], p[b + 2], p[b + 3], sr); }; pa = E(W_AMP); p2 = E(W_E2); p3 = E(W_E3); }
void LiveWavetable::takeTab(WtOsc& x) { const float* T = wtGet(x.want); if (T) { x.tab = T; x.tabIdx = x.want; x.want = -1; } }
void LiveWavetable::upO() {
  for (int n = 0; n < 2; n++) {
    int b = n ? W_O2 : W_O1; WtOsc& x = o[n];
    int ti = (int)clamp(jsRound(p[b]), 0, WT_COUNT - 1);
    if (ti != x.tabIdx) x.want = ti;
    if (x.want >= 0) takeTab(x);
    x.pos = clamp(p[b + 1], 0, 1); x.fx1 = clamp(p[b + 2], 0, 1); x.fx2 = clamp(p[b + 3], 0, 1); x.mode = (int)jsRound(clamp(p[b + 4], 0, 3));
    x.gain = dbLin(p[b + 5]); x.semi = p[b + 6]; x.det = p[b + 7]; x.on = p[b + 8] > 0.5;
  }
}
void LiveWavetable::setParam(int i, double x) {
  if (i == 90) return;
  if (i < 0 || i >= 120) return;
  p[i] = x;
  if (i < 18) upO();
  else if (i >= W_AMP && i < W_LFO1) upEnv();
  else if (i >= W_MX && i < W_MX + MX_SRC * MX_DST) mx[i - W_MX] = clamp(x, -1, 1);
  else if (i == W_MONO) { allOff(); ns = 0; }
  else if (i == W_VELRES) mx[4 * MX_DST + 5] = clamp(x, -1, 1);
}
WtVoice& LiveWavetable::alloc() {
  int n = (int)clamp(jsRound(p[W_VOICES]), 1, 8), used = 0; WtVoice* fr = nullptr; WtVoice* old = nullptr;
  for (int k = 0; k < 8; k++) { WtVoice& x = v[k]; if (x.on) { used++; if (!old || x.age < old->age) old = &x; } else if (!fr) fr = &x; }
  return (fr && used < n) ? *fr : (old ? *old : *fr);
}
void LiveWavetable::begin(WtVoice& x, int pp, double vel) {
  x.on = x.held = true; x.pitch = pp; x.vel = vel; x.age = ++counter; x.f0 = midiToHz(pp + p[W_TRANSPOSE]); x.t = 0; x.l1 = x.l2 = 0; x.h1 = rnd01(seed) * 2 - 1; x.h2 = rnd01(seed) * 2 - 1; x.phS = 0;
  for (int n = 0; n < 2; n++) for (int u = 0; u < 8; u++) { x.ph[n][u] = rnd01(seed); x.sy[n][u] = 0; }
  for (int u = 0; u < 8; u++) x.rnd[u] = rnd01(seed) * 2 - 1;
  x.fl.reset(); x.fr.reset(); x.fl2.reset(); x.fr2.reset(); x.env.start(); x.e2.start(); x.e3.start();
}
void LiveWavetable::noteOn(int pp, double vel) {
  if (p[W_MONO] > 0.5) {
    int k = 0; for (int i = 0; i < ns; i++) if (stack[i] != pp) stack[k++] = stack[i]; ns = k; if (ns < 128) stack[ns++] = pp;
    WtVoice& x = v[0];
    if (x.on && x.held) { x.pitch = pp; x.vel = vel; x.f0 = midiToHz(pp + p[W_TRANSPOSE]); return; }
    begin(x, pp, vel); x.cur = x.f0;
    for (int q = 1; q < 8; q++) if (v[q].on) { v[q].held = false; v[q].env.release(); }
    return;
  }
  WtVoice& x = alloc(); begin(x, pp, vel); x.cur = x.f0;
}
void LiveWavetable::noteOff(int pp) {
  if (p[W_MONO] > 0.5) {
    int k = 0; for (int i = 0; i < ns; i++) if (stack[i] != pp) stack[k++] = stack[i]; ns = k;
    WtVoice& x = v[0];
    if (!x.on || !x.held) return;
    if (ns) { x.pitch = stack[ns - 1]; x.f0 = midiToHz(x.pitch + p[W_TRANSPOSE]); }
    else { x.held = false; x.env.release(); x.e2.release(); x.e3.release(); }
    return;
  }
  for (auto& x : v) if (x.on && x.held && x.pitch == pp) { x.held = false; x.env.release(); x.e2.release(); x.e3.release(); }
}
void LiveWavetable::allOff() { ns = 0; for (auto& x : v) if (x.on) { x.held = false; x.env.release(); x.e2.release(); x.e3.release(); } }
void LiveWavetable::render(float* L, float* R, int from, int to) {
  const double* P = p; double maxF = sr * 0.45; const double* M = mx;
  int nUni = P[W_UMODE] > 0.5 ? (int)clamp(jsRound(P[W_UVOICES]), 2, 8) : 1, umode = (int)jsRound(P[W_UMODE]); double uamt = P[W_UAMT];
  double vol = dbLin(P[W_VOL]); bool subOn = P[W_SUBON] > 0.5; double subG = dbLin(P[W_SUBG]), subTone = P[W_SUBTONE], subDiv = 1 / std::pow(2, jsRound(P[W_SUBOCT]));
  bool f2on = P[W_F2ON] > 0.5; int f2t = (int)jsRound(P[W_F2TYPE]); bool par = P[W_F2ROUTE] > 0.5;
  bool fon = P[W_FON] > 0.5; int ft = (int)jsRound(P[W_FTYPE]); double drive = dbLin(P[W_DRIVE]), glide = std::exp(-32 / jsMax(1, P[W_GLIDE] * 0.001 * sr)); bool mono = P[W_MONO] > 0.5;
  int l1s = (int)jsRound(P[W_LFO1]); double l1r = P[W_LFO1 + 1] / sr, l1a = P[W_LFO1 + 2]; int l2s = (int)jsRound(P[W_LFO2]); double l2r = P[W_LFO2 + 1] / sr, l2a = P[W_LFO2 + 2];
  for (int u = 0; u < nUni; u++) spread[u] = nUni > 1 ? ((double)u / (nUni - 1)) * 2 - 1 : 0;
  if (o[0].want >= 0) takeTab(o[0]); if (o[1].want >= 0) takeTab(o[1]);
  for (auto& x : v) {
    if (!x.on) continue;
    for (int i = from; i < to; i += 32) {
      int e2 = (int)jsMin(to, i + 32); double dtS = 32 / sr;
      x.t += dtS;
      x.l1 += l1r * 32; if (x.l1 >= 1) { x.l1 -= 1; x.h1 = rnd01(seed) * 2 - 1; }
      x.l2 += l2r * 32; if (x.l2 >= 1) { x.l2 -= 1; x.h2 = rnd01(seed) * 2 - 1; }
      double a1 = l1a > 0.001 ? jsMin(1, x.t / l1a) : 1, a2 = l2a > 0.001 ? jsMin(1, x.t / l2a) : 1;
      src[0] = x.e2.v; src[1] = x.e3.v; src[2] = lfoShape(l1s, x.l1, x.h1) * a1; src[3] = lfoShape(l2s, x.l2, x.h2) * a2; src[4] = x.vel; src[5] = (x.pitch - 60) / 60.0;
      for (int d = 0; d < MX_DST; d++) { double s = 0; for (int k = 0; k < MX_SRC; k++) s += M[k * MX_DST + d] * src[k]; mod[d] = s; }
      if (mono) x.cur = x.f0 + (x.cur - x.f0) * glide; else x.cur = x.f0;
      double fbase = x.cur;
      if (fon) {
        double fc = clamp(P[W_FREQ] * std::pow(2, mod[4] * 6), 20, maxF), q = clamp(P[W_RES] + mod[5] * 6, 0.3, 14);
        if (ft == 0) x.fl.lowpass(sr, fc, q); else if (ft == 1) x.fl.highpass(sr, fc, q); else if (ft == 2) x.fl.bandpass(sr, fc, q); else x.fl.notch(sr, fc, q);
        x.fr.copy(x.fl);
      }
      if (f2on) {
        double fc2 = clamp(P[W_F2FREQ], 20, maxF), q2 = clamp(P[W_F2RES], 0.3, 14);
        if (f2t == 0) x.fl2.lowpass(sr, fc2, q2); else if (f2t == 1) x.fl2.highpass(sr, fc2, q2); else if (f2t == 2) x.fl2.bandpass(sr, fc2, q2); else x.fl2.notch(sr, fc2, q2);
        x.fr2.copy(x.fl2);
      }
      for (int n = 0; n < 2; n++) {
        WtOsc& oo = o[n];
        if (!oo.on || !oo.tab) { st[n] = nullptr; continue; }
        double pit = oo.semi + oo.det / 100 + mod[n ? 3 : 1] * 24, f = fbase * std::pow(2, pit / 12);
        double gn = clamp(oo.gain * (1 + mod[n ? 7 : 6]), 0, 3);
        WtSc& SC = sc[n];
        for (int u = 0; u < nUni; u++) {
          double det = 0, ps = 0;
          if (umode == 1 || umode == 2 || umode == 4) det = spread[u] * uamt * 60;
          else if (umode == 3) det = spread[u] * uamt * 60 + x.rnd[u] * uamt * 20 * std::sin(x.t * 7 + u);
          else if (umode == 6) det = x.rnd[u] * uamt * 100;
          if (umode == 5) ps = spread[u] * uamt * 0.5;
          double fu = f * std::pow(2, det / 1200) * (umode == 2 && (u & 1) ? 2 : 1);
          SC.dts[u] = fu / sr; SC.mips[u] = wtMip(fu * (oo.mode == 2 && oo.fx2 > 0.01 ? 1 + oo.fx2 * 7 : 1) * 1.05, sr);
          SC.pos[u] = clamp(oo.pos + mod[n ? 2 : 0] + ps, 0, 1);
        }
        SC.o = &oo; SC.gn = gn; SC.tb = oo.tab; st[n] = &SC;
      }
      for (int u = 0; u < nUni; u++) { double pan = nUni > 1 ? spread[u] * jsMin(1, uamt * 1.2 + 0.2) : 0; gl[u] = std::cos((pan + 1) * 0.7853982) * 1.4142; gr[u] = std::sin((pan + 1) * 0.7853982) * 1.4142; }
      double norm = 1 / std::sqrt((double)nUni), subDt = (fbase * subDiv) / sr;
      for (int k = i; k < e2; k++) {
        double ea = x.env.next(pa); x.e2.next(p2); x.e3.next(p3);
        if (x.env.st == 0) { x.on = false; break; }
        double sl = 0, sr2 = 0;
        for (int n = 0; n < 2; n++) {
          WtSc* S = st[n]; if (!S) continue;
          WtOsc& oo = *S->o; const float* T = S->tb; double* ph = x.ph[n]; double* sy = x.sy[n];
          for (int u = 0; u < nUni; u++) {
            double pp = ph[u] + S->dts[u]; bool wrapped = false;
            if (pp >= 1) { pp -= 1; wrapped = true; } ph[u] = pp;
            double q = pp;
            if (oo.mode == 2) {
              if (oo.fx2 > 0.01) { if (wrapped) sy[u] = 0; sy[u] += S->dts[u] * (1 + oo.fx2 * 7); q = std::fmod(sy[u], 1); }
              double c = 0.5 - oo.fx1 * 0.45; q = q < c ? 0.5 * q / c : 0.5 + 0.5 * (q - c) / (1 - c);
            } else if (oo.mode == 3) q = std::pow(pp, 1 + oo.fx1 * 3);
            else if (oo.mode == 1) { double r = 1 + jsRound(oo.fx2 * 7); q = pp + oo.fx1 * 0.9 * std::sin(TWO_PI * pp * r); q -= std::floor(q); }
            double fp = q * WT_TL; int i0 = toInt32(fp); double fr = fp - i0;
            double tp = S->pos[u] * (WT_NF - 1); int f0 = (int)jsMin(toInt32(tp), WT_NF - 2); double ff = tp - f0; int m = S->mips[u];
            int a0 = wtAt(f0, m) + i0, a1 = wtAt(f0 + 1, m) + i0;
            double x0 = T[a0] + (T[a0 + 1] - (double)T[a0]) * fr, x1 = T[a1] + (T[a1 + 1] - (double)T[a1]) * fr;
            double xx = x0 + (x1 - x0) * ff;
            if (oo.mode == 3 && oo.fx2 > 0.005) { double y = xx * (1 + oo.fx2 * 4); y = std::fabs(std::fmod(std::fmod(y + 1, 4) + 4, 4) - 2) - 1; xx = y; }
            xx *= S->gn;
            sl += xx * gl[u]; sr2 += xx * gr[u];
          }
        }
        sl *= norm; sr2 *= norm;
        if (subOn) {
          x.phS += subDt; if (x.phS >= 1) x.phS -= 1;
          double s0 = std::sin(TWO_PI * x.phS), xx = (s0 * (1 - subTone) + subTone * jsMax(-1, jsMin(1, s0 * 2.2)) * 0.8) * subG;
          sl += xx; sr2 += xx;
        }
        if (drive > 1.001) { sl = fastTanh(sl * drive) / std::sqrt(drive); sr2 = fastTanh(sr2 * drive) / std::sqrt(drive); }
        if (par && fon && f2on) { double al = x.fl.process(sl), ar = x.fr.process(sr2), bl = x.fl2.process(sl), br = x.fr2.process(sr2); sl = (al + bl) * 0.6; sr2 = (ar + br) * 0.6; }
        else { if (fon) { sl = x.fl.process(sl); sr2 = x.fr.process(sr2); } if (f2on) { sl = x.fl2.process(sl); sr2 = x.fr2.process(sr2); } }
        double g = ea * vol * (0.6 + 0.4 * x.vel);
        L[k] = (float)(L[k] + sl * g); R[k] = (float)(R[k] + sr2 * g);
      }
      if (!x.on) break;
    }
  }
}

}  // namespace mdaw
