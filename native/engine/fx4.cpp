// Ports of js/engine/fx4.js (part 1). Keep each class in step with its JS original.
#include "fx4.h"

namespace mdaw {

struct AmpT { double g, a, lo, mid; };
static const AmpT AMPT[7] = { { 1, 0, 0, 700 }, { 3, 0.1, 0, 800 }, { 6, 0.2, -2, 650 }, { 12, 0.25, -1, 800 }, { 24, 0.3, -3, 1000 }, { 40, 0.4, 2, 500 }, { 4, 0.05, 4, 400 } };
void Amp::upd() {
  int ti = (int)clamp(jsRound(p[0]), 0, 6); const AmpT& t = AMPT[ti]; auto db = [](double v) { return (v - 5) * 2.4; };
  f[0][0].highpass(sr, ti == 6 ? 30 : 70, 0.707); f[0][1].lowShelf(sr, 120, 0.7, db(p[2]) + t.lo); f[0][2].peaking(sr, t.mid, 0.8, db(p[3])); f[0][3].highShelf(sr, 2800, 0.7, db(p[4])); f[0][4].highShelf(sr, 5500, 0.7, db(p[5]) * 0.8);
  for (int k = 0; k < 5; k++) f[1][k].copy(f[0][k]);
}
void Amp::process(float* L, float* R, int n) {
  const AmpT& t = AMPT[(int)clamp(jsRound(p[0]), 0, 6)]; double pre = t.g * (0.2 + p[1] / 10 * 2), vol = std::pow(p[6] / 10, 2) * 1.6; bool mono = p[7] < 0.5; double mix = p[8], norm = 1 / jsMax(0.3, fastTanh(pre * 0.5));
  auto sh = [&](double x, Biquad* ff) { x = ff[0].process(x) * pre; double y = fastTanh(x + t.a) - fastTanh(t.a); return ff[4].process(ff[3].process(ff[2].process(ff[1].process(y * norm * 0.5)))); };
  for (int i = 0; i < n; i++) {
    double l = L[i], r = R[i]; if (mono) l = r = (l + r) * 0.5;
    double yl = sh(l, f[0]) * vol, yr = mono ? yl : sh(r, f[1]) * vol;
    L[i] = (float)(L[i] * (1 - mix) + yl * mix); R[i] = (float)(R[i] * (1 - mix) + yr * mix);
  }
}
void Cabinet::upd() {
  int cab = (int)clamp(jsRound(p[0]), 0, 3), mic = (int)jsRound(p[1]), pos = (int)jsRound(p[2]);
  static const double HP[4] = { 110, 90, 75, 45 }, PF[4] = { 2200, 1800, 1600, 900 }, PG[4] = { 5, 4, 3, 3 }, LP[4] = { 5200, 4800, 4300, 3200 }, BF[4] = { 120, 110, 100, 80 };
  f[0][0].highpass(sr, HP[cab], 0.9); f[0][1].peaking(sr, PF[cab], 1.2, PG[cab] - (pos == 1 ? 4 : 0));
  f[0][2].lowpass(sr, LP[cab] * (pos == 1 ? 0.7 : pos == 2 ? 0.8 : 1) * (mic ? 0.85 : 1.15), 0.9); f[0][3].peaking(sr, BF[cab], 1, pos == 0 ? 3 : 1);
  for (int k = 0; k < 4; k++) f[1][k].copy(f[0][k]);
}
void Cabinet::process(float* L, float* R, int n) {
  bool mono = p[3] < 0.5; double mix = p[4]; bool far = jsRound(p[2]) == 2; int dl = (int)jsRound(sr * 0.006); const int M = 2047;
  auto run = [](double x, Biquad* ff) { return ff[3].process(ff[2].process(ff[1].process(ff[0].process(x)))); };
  for (int i = 0; i < n; i++) {
    double l = L[i], r = R[i]; if (mono) l = r = (l + r) * 0.5;
    double yl = run(l, f[0]), yr = mono ? yl : run(r, f[1]);
    if (far) { bl[w & M] = (float)yl; br[w & M] = (float)yr; yl = yl * 0.7 + br[(w - dl) & M] * 0.35; yr = yr * 0.7 + bl[(w - dl - 37) & M] * 0.35; w++; }
    L[i] = (float)(L[i] * (1 - mix) + yl * mix); R[i] = (float)(R[i] * (1 - mix) + yr * mix);
  }
}
void Overdrive::process(float* L, float* R, int n) {
  double dv = 1 + p[2] * 40, dyn = p[4], mix = p[5], ec = 1 - coefMs(20, sr);
  for (int i = 0; i < n; i++) {
    double x = jsMax(std::fabs((double)L[i]), std::fabs((double)R[i])); env += (x - env) * ec;
    double g = dyn > 0 ? 1 + dyn * clamp(env * 4, 0, 1) : 1;
    double yl = t[0].process(fastTanh(l[0].process(h[0].process(L[i])) * dv) * 0.5) * g, yr = t[1].process(fastTanh(l[1].process(h[1].process(R[i])) * dv) * 0.5) * g;
    L[i] = (float)(L[i] * (1 - mix) + yl * mix); R[i] = (float)(R[i] * (1 - mix) + yr * mix);
  }
}
void Pedal::upd() {
  static const double MF[3] = { 500, 1000, 2000 };
  for (int c = 0; c < 2; c++) { f[c][0].highpass(sr, p[7] > 0.5 ? 20 : 90, 0.707); f[c][1].lowShelf(sr, 150, 0.7, p[3] * 12); f[c][2].peaking(sr, MF[(int)clamp(jsRound(p[6]), 0, 2)], 0.9, p[4] * 12); f[c][3].highShelf(sr, 3000, 0.7, p[5] * 12); }
}
void Pedal::process(float* L, float* R, int n) {
  int ty = (int)jsRound(p[0]); static const double GM[3] = { 20, 60, 150 }; double g = 1 + p[1] * GM[(int)clamp(ty, 0, 2)], out = dbToLin(p[2]) * 0.6, mix = p[8];
  auto sh = [&](double x) { return ty == 0 ? fastTanh(x) : ty == 1 ? clamp(x * 1.2, -1, 1) : (x > 0 ? 1 - std::exp(-x * 2) : -(1 - std::exp(x * 1.2)) * 0.8); };
  auto run = [&](double x, Biquad* ff) { return ff[3].process(ff[2].process(ff[1].process(sh(ff[0].process(x) * g)))); };
  for (int i = 0; i < n; i++) {
    double yl = run(L[i], f[0]) * out, yr = run(R[i], f[1]) * out;
    L[i] = (float)(L[i] * (1 - mix) + yl * mix); R[i] = (float)(R[i] * (1 - mix) + yr * mix);
  }
}
void DynTube::process(float* L, float* R, int n) {
  double dv = dbToLin(p[0]) * 2; int tube = (int)jsRound(p[3]); double out = dbToLin(p[7]), mix = p[8], at = 1 - coefMs(p[5], sr), rl = 1 - coefMs(p[6], sr);
  for (int i = 0; i < n; i++) {
    double x = jsMax(std::fabs((double)L[i]), std::fabs((double)R[i])); env += (x - env) * (x > env ? at : rl);
    double bias = clamp(p[1] - 0.5 + p[2] * env * 2, -1, 1) * 0.6;
    auto sh = [&](double v) { double y = v * dv + bias; double z = tube == 0 ? fastTanh(y) - fastTanh(bias) : tube == 1 ? (y > 0 ? fastTanh(y) : fastTanh(y * 0.6) / 0.6) - fastTanh(bias) : y / (1 + std::fabs(y)) - bias / (1 + std::fabs(bias)); return z / jsMax(1, dv * 0.5); };
    double yl = t[0].process(sh(L[i])) * out, yr = t[1].process(sh(R[i])) * out;
    L[i] = (float)(L[i] * (1 - mix) + yl * mix); R[i] = (float)(R[i] * (1 - mix) + yr * mix);
  }
}

}  // namespace mdaw

namespace mdaw {

// ---------------------------------------------------------------------------------------------- Multiband Dynamics
MultibandDyn::MultibandDyn(double r) : FxBase(r, { 120, 2500 }) {
  for (int b = 0; b < 3; b++) { double* q = p + 2 + b * 9; q[0] = 1; q[1] = 6; q[2] = 0; q[3] = -12; q[4] = 4; q[5] = -40; q[6] = 1; q[7] = 10; q[8] = 100; }
  p[29] = 1; p[30] = 1; for (int k = 31; k <= 36; k++) p[k] = 0; upd();
}
void MultibandDyn::upd() {
  double lo = clamp(p[0], 20, 1000), hi = jsMax(lo * 1.5, clamp(p[1], 500, 16000));
  for (auto& c : x) { c[0][0].lowpass(sr, lo, 0.7071); c[0][1].copy(c[0][0]); c[1][0].highpass(sr, lo, 0.7071); c[1][1].copy(c[1][0]); c[2][0].lowpass(sr, hi, 0.7071); c[2][1].copy(c[2][0]); c[3][0].highpass(sr, hi, 0.7071); c[3][1].copy(c[3][0]); }
}
void MultibandDyn::process(float* L, float* R, int n) {
  double amt = p[29], tm = p[30], out = dbToLin(p[31]); bool soft = p[32] > 0.5, rms = p[33] > 0.5;
  struct BS { bool on; double inG, outG, ta, ra, tb, rb, at, rl; } B[3];
  for (int b = 0; b < 3; b++) { int o = 2 + b * 9; B[b] = { p[o] > 0.5, dbToLin(p[o + 1]), dbToLin(p[o + 2]), p[o + 3], 1 + (p[o + 4] - 1) * amt, p[o + 5], 1 + (p[o + 6] - 1) * amt, 1 - coefMs(p[o + 7] * tm, sr), 1 - coefMs(p[o + 8] * tm, sr) }; }
  double pk[3] = { 0, 0, 0 }; bool solo = p[34] > 0.5 || p[35] > 0.5 || p[36] > 0.5;
  for (int b = 0; b < 3; b++) if (solo && !(p[34 + b] > 0.5)) B[b].outG = 0;
  for (int i = 0; i < n; i++) {
    double bl[3], br[3];
    for (int c = 0; c < 2; c++) { double xx = c ? R[i] : L[i]; auto& f = x[c]; double lo = f[0][1].process(f[0][0].process(xx)), rest = f[1][1].process(f[1][0].process(xx)), mid = f[2][1].process(f[2][0].process(rest)), hi = f[3][1].process(f[3][0].process(rest));
      double* o = c ? br : bl; o[0] = lo; o[1] = mid; o[2] = hi; }
    double ol = 0, orr = 0;
    for (int b = 0; b < 3; b++) {
      BS& s = B[b]; double l = bl[b] * s.inG, r = br[b] * s.inG;
      if (!s.on) { ol += l * s.outG; orr += r * s.outG; continue; }
      double xx = jsMax(std::fabs(l), std::fabs(r)), d = rms ? xx * xx : xx; env[b] += (d - env[b]) * (d > env[b] ? s.at : s.rl);
      double lev = linToDb(rms ? std::sqrt(env[b]) : env[b]); if (lev > pk[b]) pk[b] = lev;
      double gdb = 0, kn = soft ? 6 : 0;
      if (lev > s.ta - kn) gdb = -(lev - s.ta) * (1 - 1 / s.ra) * (lev > s.ta + kn || kn == 0 ? 1 : 0.5);
      else if (lev < s.tb && lev > -90) gdb = -(s.tb - lev) * (s.rb - 1);
      gdb = clamp(gdb, -60, jsMin(24, 6 - jsMax(lev, linToDb(xx)))); gr[b] = gdb;
      double g = dbToLin(gdb) * s.outG; ol += l * g; orr += r * g;
    }
    L[i] = (float)(ol * out); R[i] = (float)(orr * out);
  }
  for (int b = 0; b < 3; b++) lv[b] = jsMax(pk[b] != 0 ? pk[b] : -90, lv[b] - 1.5);
}

// ---------------------------------------------------------------------------------------------- Resonators
Resonators::Resonators(double r) : FxBase(r, { 1, 50, 2, 0, 0.77, 0, 0.857, 1, 43, 0, 0 }) {
  static const double ST[4] = { 7, 7, 3, 12 }; for (int k = 0; k < 4; k++) { double* q = p + 11 + k * 4; q[0] = 1; q[1] = ST[k]; q[2] = 0; q[3] = 0; } p[27] = 1; p[28] = 0; p[29] = 0.49;
  int NN = pow2Size(sr / 20 + 4); N = NN - 1; for (auto& q : b) q = new float[NN](); upd();
}
void Resonators::upd() { for (int c = 0; c < 2; c++) { Biquad& f = in[c]; int t = (int)jsRound(p[2]); if (t == 0) f.lowpass(sr, p[1], 0.7); else if (t == 1) f.bandpass(sr, p[1], 0.7); else if (t == 2) f.highpass(sr, p[1], 0.7); else f.notch(sr, p[1], 0.7); } }
void Resonators::process(float* L, float* R, int n) {
  bool fon = p[0] > 0.5, modeB = jsRound(p[3]) == 1; double col = 0.15 + p[6] * 0.85; bool cst = p[5] > 0.5; double wid = p[27], g = dbToLin(p[28]) * 0.25, mix = p[29];
  struct VS { bool on; double d, fb, gain, pan; } V[5];
  for (int k = 0; k < 5; k++) {
    int o = k == 0 ? 7 : 11 + (k - 1) * 4; bool on = p[o] > 0.5; double midi = k == 0 ? p[8] + p[9] / 100 : p[8] + p[o + 1] + p[o + 2] / 100, hz = 440 * std::pow(2, (midi - 69) / 12) * (modeB ? 0.5 : 1);
    double d = clamp(sr / hz, 2, N - 2), T60 = 0.05 + std::pow(p[4], 2) * 8, fbk = cst ? std::exp(-6.9 * (d / sr) / T60) : 0.9 + p[4] * 0.099;
    V[k] = { on, d, modeB ? -fbk : fbk, dbToLin(k == 0 ? p[10] : p[o + 3]), k == 0 ? 0 : (k % 2 ? -1 : 1) * wid * (k < 3 ? 0.5 : 1) };
  }
  for (int i = 0; i < n; i++) {
    double xl = L[i], xr = R[i]; if (fon) { xl = in[0].process(xl); xr = in[1].process(xr); }
    double xx = (xl + xr) * 0.5, ol = 0, orr = 0;
    for (int k = 0; k < 5; k++) {
      VS& vv = V[k]; if (!vv.on) continue; float* buf = b[k];
      double y = rdJ(buf, N, w, vv.d); lp[k] += (y - lp[k]) * col; buf[toInt32(w) & N] = (float)(xx + lp[k] * vv.fb);
      double o = y * vv.gain; ol += o * (1 - jsMax(0, vv.pan)); orr += o * (1 + jsMin(0, vv.pan));
    }
    w++;
    L[i] = (float)(L[i] * (1 - mix) + ol * g * mix); R[i] = (float)(R[i] * (1 - mix) + orr * g * mix);
  }
}

// ---------------------------------------------------------------------------------------------- Corpus
static const double CORPUS[7][12] = { { 1, 2.756, 5.404, 8.933, 13.34, 18.64, 24.81, 31.87, 39.8, 48.6, 58.3, 68.9 }, { 1, 3.932, 9.538, 16.81, 25.66, 36.1, 48.1, 61.8, 77, 94, 112, 132 },
  { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 }, { 1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501, 3.6, 4.06, 4.15, 4.6 }, { 1, 2.5, 4, 5, 6.5, 8, 9, 10, 12.5, 13, 16, 17 },
  { 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23 }, { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 } };
static const double CORPUS_SYNC[8] = { 1.0 / 16, 1.0 / 8, 1.0 / 4, 3.0 / 8, 1.0 / 2, 1, 2, 4 };
static double lfoWave(double sh, double x, double rn) { x -= std::floor(x); switch ((int)jsRound(sh)) { case 1: return x < 0.5 ? 1 : -1; case 2: return 1 - 4 * std::fabs(x - 0.5); case 3: return 2 * x - 1; case 4: return 1 - 2 * x; case 5: return rn; default: return std::sin(TWO_PI * x); } }
Corpus::Corpus(double r) : FxBase(r, { 3, 1, 0.5, 0.84, 0, 0, 0.5, 0.5, 1, 0.47, 0.82, 65.41, 0, 0, 0, 0.5, 0.5, 0, 1000, 4, 0, -0.5, 1, 0, 0, 4, 0, 0 }) { upd(); }
void Corpus::upd() {
  int ty = (int)clamp(jsRound(p[0]), 0, 6); static const int NMS[3] = { 4, 8, 12 }; int nmx = NMS[(int)clamp(jsRound(p[1]), 0, 2)]; double base = p[11] * std::pow(2, p[12] / 1200); const double* rat = CORPUS[ty];
  nm = 0;
  for (int k = 0; k < nmx; k++) {
    double r = rat[k] * jsMax(0.3, 1 + p[5] * 0.03 * k * k) * (ty == 3 || ty == 4 ? 1 + (p[6] - 0.5) * 0.3 * (k % 2) : 1), f = base * r;
    if (f > sr * 0.45) break;
    double T = (0.05 + p[2] * p[2] * 6) * std::pow(r, -(0.25 + p[3] * 0.75 + 0.25)), rr = std::exp(-6.9 / (T * sr));
    double amp = std::fabs(std::sin(PI * (k + 1) * (0.05 + p[7] * 0.9))) * std::pow(r, p[4] * 0.8 - 0.4);
    double aL = std::sin(PI * (k + 1) * (0.05 + p[9] * 0.9)), aR = std::sin(PI * (k + 1) * (0.05 + p[10] * 0.9));
    m[nm++] = { f, rr, amp * (1 - rr) * 2, aL, aR, { 0, 0 }, { 0, 0 }, f * (1 + p[13] * 0.02), { 0, 0 } };
  }
  for (int c = 0; c < 2; c++) in[c].bandpass(sr, p[18], 1 / jsMax(0.1, p[19]));
  dirty = true;
}
void Corpus::coefs(double l0, double l1) { double lf[2] = { l0, l1 }; for (int k = 0; k < nm; k++) for (int c = 0; c < 2; c++) { double f = (c ? m[k].fs : m[k].f) * (1 + lf[c]), w = TWO_PI * f / sr; m[k].c[c] = 2 * m[k].rr * std::cos(w); } dirty = false; }
void Corpus::process(float* L, float* R, int n) {
  bool lfoOn = p[14] > 0.5; double wid = p[8], g = dbToLin(p[21]) * 0.5, mix = p[22], bleed = p[20]; bool fon = p[17] > 0.5;
  if (lfoOn) {
    double hz = p[24] > 0.5 ? bpm / 60 / (CORPUS_SYNC[(int)clamp(jsRound(p[25]), 0, 7)] * 4) : p[16];
    ph += hz * n / sr; if (ph >= 1) { ph -= std::floor(ph); double a = lcg(seed) / 4294967296.0 * 2 - 1; double b2 = lcg(seed) / 4294967296.0 * 2 - 1; sh[0] = a; sh[1] = b2; }
    double a = p[15] * 0.12, o = p[27] / 360; double l0 = lfoWave(p[23], ph + o, sh[0]) * a; coefs(l0, lfoWave(p[23], ph + o + p[26] / 360, sh[1]) * a);
  } else if (dirty) coefs(0, 0);
  for (int i = 0; i < n; i++) {
    double xx = ((double)L[i] + R[i]) * 0.5; if (fon) xx = in[0].process(xx);
    double ol = 0, orr = 0;
    for (int k = 0; k < nm; k++) { CMode& md = m[k];
      for (int c = 0; c < 2; c++) { double y = md.c[c] * md.s1[c] - md.rr * md.rr * md.s2[c] + xx * md.amp; md.s2[c] = md.s1[c]; md.s1[c] = y; }
      ol += md.s1[0] * md.aL; orr += md.s1[1] * md.aR; }
    double mm = (ol + orr) * 0.5, s = (ol - orr) * 0.5 * wid; ol = (mm + s) * g; orr = (mm - s) * g;
    L[i] = (float)(L[i] * (1 - mix) + (ol + xx * bleed) * mix); R[i] = (float)(R[i] * (1 - mix) + (orr + xx * bleed) * mix);
  }
}

}  // namespace mdaw
