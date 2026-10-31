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

namespace mdaw {

static inline double rndU(uint32_t& s) { return lcg(s) / 4294967296.0; }

// ---------------------------------------------------------------------------------------------- Vocoder
void Vocoder::upd() {
  static const int VB[8] = { 4, 8, 12, 16, 20, 24, 32, 40 };
  nb = VB[(int)clamp(jsRound(p[5]), 0, 7)]; double lo = clamp(p[6], 20, 2000), hi = jsMax(lo * 2, clamp(p[7], 500, 18000)), q = (p[11] > 0.5 ? 9 : 4) / jsMax(0.1, p[8]) * nb / 20;
  for (int b = 0; b < nb; b++) { double f = lo * std::pow(hi / lo, (b + 0.5) / nb), fc = clamp(f * std::pow(2, p[16]), 20, 20000); B[b] = VBand(); B[b].m.bandpass(sr, f, q); B[b].c[0].bandpass(sr, fc, q); B[b].c[1].bandpass(sr, fc, q); }
}
void Vocoder::process(float* L, float* R, int n) {
  int car = (int)jsRound(p[0]); bool enh = p[1] > 0.5; double unv = p[2] <= -60 ? 0 : dbToLin(p[2]), gate = dbToLin(p[9]), lvl = dbToLin(p[10]) * 3, dep = p[12], at = 1 - coefMs(p[13], sr), rl = 1 - coefMs(p[14], sr); int mode = (int)jsRound(p[15]); double mix = p[17];
  for (int i = 0; i < n; i++) {
    double mod = ((double)L[i] + R[i]) * 0.5;
    if ((mod >= 0) != (last >= 0) && mod >= 0) { if (cntZ > 20) period += (cntZ - period) * 0.2; cntZ = 0; } cntZ++; last = mod;
    double carrier;
    if (car == 0) {
      if (--hold <= 0) { hold = 1 + jsRound(std::pow(1 - p[18], 2) * 63); nz = rndU(seed) * 2 - 1; if (p[19] > 0 && rndU(seed) < p[19] * 0.97) nz = 0; else if (p[19] > 0) nz /= std::sqrt(1 - p[19] * 0.97); }
      carrier = nz;
    } else if (car == 1) carrier = mod;
    else { ph += 1 / jsMax(8, period); if (ph >= 1) ph -= 1; carrier = 2 * ph - 1; }
    double noise = rndU(seed) * 2 - 1;
    zr += (((mod >= 0) != (last2 >= 0) ? 1 : 0) - zr) * 0.002; last2 = mod;
    double uT = clamp((zr - (1 - p[3]) * 0.35) / 0.08, 0, 1); uv += (uT - uv) * (p[4] > 0.5 ? 0.02 : 0.0015);
    double ol = 0, orr = 0;
    for (int b = 0; b < nb; b++) {
      VBand& Bb = B[b]; double m = std::fabs(Bb.m.process(mod)); Bb.e += (m - Bb.e) * (m > Bb.e ? at : rl);
      double e = Bb.e < gate * 0.1 ? 0 : Bb.e;
      e = dep * e + (1 - dep) * 0.05;
      double c = Bb.c[0].process(carrier), cn = Bb.c[1].process(noise) * unv * uv * (b > nb * 0.6 ? 1 : 0.3);
      double y = (c + cn) * e * (enh ? 1 / jsMax(0.02, std::sqrt(Bb.e + 1e-4)) * 0.2 : 1) * lvl * 30;
      if (mode == 2) { if (b % 2) orr += y; else ol += y; } else { ol += y; orr += y * (mode == 1 ? (b % 2 ? 0.8 : 1.2) : 1); }
      if ((i & 63) == 0) lv[b] = (float)jsMax(Bb.e, lv[b] * 0.97);
    }
    L[i] = (float)(L[i] * (1 - mix) + clamp(ol, -4, 4) * mix); R[i] = (float)(R[i] * (1 - mix) + clamp(orr, -4, 4) * mix);
  }
}

// ---------------------------------------------------------------------------------------------- Shifter
Shifter::Shifter(double r) : FxBase(r, { 0, 7, 0, 100, 60, 0, 0, 20000, 1 }) { int N = pow2Size(sr * 0.5); b[0] = new float[N](); b[1] = new float[N](); M = N - 1; upd(); }
void Shifter::process(float* L, float* R, int n) {
  int mode = (int)jsRound(p[0]); double mix = p[8], fbk = clamp(p[6], 0, 0.9), win = clamp(p[4], 10, 300) * 0.001 * sr, sp = p[5];
  for (int i = 0; i < n; i++) {
    double out[2];
    for (int c = 0; c < 2; c++) {
      double x = (c ? R[i] : L[i]) + fb[c] * fbk, sgn = c ? 1 : -1, y;
      if (mode == 0) {
        double ratio = std::pow(2, (p[1] + p[2] / 100 + sgn * sp * 0.25) / 12), step = (1 - ratio) / win;
        b[c][toInt32(w) & M] = (float)x; ph[c] += step; ph[c] -= std::floor(ph[c]);
        double d1 = ph[c] * win + 2, d2 = std::fmod(ph[c] + 0.5, 1) * win + 2, g1 = std::sin(PI * ph[c]), g2 = std::sin(PI * std::fmod(ph[c] + 0.5, 1));
        y = rdJ(b[c], M, w, d1) * g1 + rdJ(b[c], M, w, d2) * g2;
      } else {
        double f = p[3] + sgn * sp * 20, re, im; h[c].run(x, re, im); double a = oph * 1 + (c ? sp * 1.5 : 0);
        y = mode == 1 ? re * std::cos(a) - im * std::sin(a) : x * std::cos(a);
        if (c == 1) { oph += TWO_PI * (mode == 1 ? f : std::fabs(f)) / sr; if (oph > 1e4) oph -= TWO_PI * std::floor(oph / TWO_PI); }
      }
      y = t[c].process(y); fb[c] = y; out[c] = y;
    }
    w++;
    L[i] = (float)(L[i] * (1 - mix) + out[0] * mix); R[i] = (float)(R[i] * (1 - mix) + out[1] * mix);
  }
}

// ---------------------------------------------------------------------------------------------- Grain Delay
GrainDelay::GrainDelay(double r) : FxBase(r, { 0, 3, 100, 15, 4, 0, 0, 0, 0.5 }) { int N = pow2Size(sr * 2.5); b[0] = new float[N](); b[1] = new float[N](); M = N - 1; g[0].age = 0; g[0].len = 1; g[1] = g[0]; }
void GrainDelay::process(float* L, float* R, int n) {
  static const double SIXT[8] = { 1, 2, 3, 4, 5, 6, 8, 16 };
  double s16 = 60 / bpm / 4, base = (p[0] > 0.5 ? SIXT[(int)clamp(jsRound(p[1]), 0, 7)] * s16 : p[2] / 1000) * sr, hz = clamp(p[4], 1, 150), period = sr / hz, mix = p[8], fbk = clamp(p[7], 0, 0.95);
  for (int i = 0; i < n; i++) {
    if (--cnt <= 0) {
      cnt = period / 2; G& gr = g[0].age >= g[0].len ? g[0] : g[1];
      double rp = (rndU(seed) * 2 - 1) * p[6] * 12; gr.rate = std::pow(2, (p[5] + rp) / 12); gr.len = period; gr.age = 0;
      gr.pos = clamp(base + rndU(seed) * p[3] / 1000 * sr, 2, M - period * 4);
    }
    double out[2] = { 0, 0 };
    for (auto& gr : g) {
      if (gr.age >= gr.len) continue; double wv = std::sin(PI * gr.age / gr.len), d = gr.pos - gr.age * (gr.rate - 1);
      for (int c = 0; c < 2; c++) out[c] += rdJ(b[c], M, w, clamp(d, 2, M - 2)) * wv;
      gr.age++;
    }
    for (int c = 0; c < 2; c++) b[c][toInt32(w) & M] = (float)((c ? R[i] : L[i]) + out[c] * fbk);
    w++;
    L[i] = (float)(L[i] * (1 - mix) + out[0] * mix); R[i] = (float)(R[i] * (1 - mix) + out[1] * mix);
  }
}

// ---------------------------------------------------------------------------------------------- Hybrid Reverb
static const int ER[5][12] = { { 7, 11, 17, 23, 31, 41, 53, 67, 79, 97, 113, 131 }, { 3, 5, 8, 11, 13, 17, 19, 23, 29, 31, 37, 41 }, { 1, 2, 3, 5, 7, 9, 12, 15, 18, 22, 26, 31 }, { 11, 22, 33, 44, 55, 66, 77, 88, 99, 110, 121, 132 }, { 5, 9, 14, 20, 27, 35, 44, 54, 65, 77, 90, 104 } };
HybridReverb::HybridReverb(double r) : FxBase(r, { 0, 10, 0, 0, 0.6, 0, 0.6, 0.6, 0, 3.5, 0.5, 0.5, 0.7, 0.5, 0, 0, 20, 20000, 1, 0, 0, 0.3 }) {
  int N = pow2Size(sr * 1.2); pre = new float[N](); pm = N - 1; er[0] = new float[1 << 15](); er[1] = new float[1 << 15]();
  static const int LN[8] = { 1031, 1327, 1523, 1801, 2053, 2311, 2633, 2969 };
  for (int k = 0; k < 8; k++) { len[k] = (int)jsRound(LN[k] * sr / 44100); int sz = pow2Size(len[k] * 2.2 + 64); fd[k] = new float[sz](); fdm[k] = sz - 1; }
  upd();
}
void HybridReverb::process(float* L, float* R, int n) {
  static const double DMP[5] = { 1.35, 0.5, 1, 1, 0.3 }, DIF[5] = { 0, 0.12, 0, 0, -0.12 }; static const int APD[4] = { 142, 107, 379, 277 }, VI[5] = { 1, 2, 3, 4, 6 };
  double send = p[0] <= -60 ? 0 : dbToLin(p[0]), pd = clamp(p[1], 0, 1000) * 0.001 * sr, pfb = clamp(p[2], 0, 0.9); int route = (int)jsRound(p[3]); double blend = p[4]; const int* ir = ER[(int)clamp(jsRound(p[5]), 0, 4)];
  double irD = p[6], irS = 0.3 + p[7] * 1.7; int alg = (int)jsRound(p[8]); bool frz = p[14] > 0.5; double mix = p[21], stw = p[18]; int vint = (int)jsRound(p[19]); bool eqOn = p[15] > 0.5;
  int ac = (int)clamp(alg, 0, 4); double sizeK = 0.5 + p[10] * 1.5, g = frz ? 1 : std::pow(10, -3 * (len[4] * sizeK / sr) / jsMax(0.2, p[9])), damp = frz ? 0 : clamp((0.05 + p[11] * 0.7) * DMP[ac], 0, 0.95), dif = clamp(0.3 + p[12] * 0.45 + DIF[ac], 0.1, 0.85), md = p[13] * (alg == 3 ? 30 : 8); int nm = alg == 4 ? 8 : 2;
  for (int i = 0; i < n; i++) {
    double xin = frz ? 0 : ((double)L[i] + R[i]) * 0.5 * send;
    double pdo = pd > 1 ? rdJ(pre, pm, pw, pd) : xin; pre[toInt32(pw) & pm] = (float)(xin + pdo * pfb); pw++;
    int ewi = toInt32(ew); er[0][ewi & em] = (float)pdo; er[1][ewi & em] = (float)pdo;
    double el = 0, erv = 0; for (int k = 0; k < 12; k++) { int d = (int)jsRound(ir[k] * irS * sr / 1000) + 1; double a = std::pow(0.35 + irD * 0.6, k / 3.0); double v = er[0][(ewi - d) & em] * a * (k % 3 == 0 ? -1 : 1); if (k % 2) erv += v; else el += v; }
    ew++;
    double x = route == 0 ? (el + erv) * 0.5 : pdo;
    for (int k = 0; k < 4; k++) { int aw = toInt32(apw[k]); double y = ap[k][(aw - APD[k]) & 1023]; double u = x + y * dif; ap[k][aw & 1023] = (float)u; apw[k]++; x = y - u * dif; }
    ph += TWO_PI * (alg == 3 ? 0.3 : 0.8) / sr; if (ph > TWO_PI) ph -= TWO_PI;
    double sum = 0;
    for (int k = 0; k < 8; k++) { int M = fdm[k]; double d = len[k] * sizeK + (k < nm ? std::sin(ph + k) * md : 0); o[k] = rdJ(fd[k], M, fw, clamp(d, 2, M - 2)); lp[k] += (o[k] - lp[k]) * (1 - damp); o[k] = lp[k]; sum += o[k]; }
    double hh = sum * 0.25;
    if (alg == 2) { shB[toInt32(sh) & 8191] = (float)hh; sh++; }
    double shim = alg == 2 ? (shB[(toInt32(sh) - 1 - toInt32(std::fmod(sh * 0.5, 2048))) & 8191] * 0.25) : 0;
    int fwi = toInt32(fw);
    for (int k = 0; k < 8; k++) fd[k][fwi & fdm[k]] = (float)((o[k] - hh) * g + x * (k % 2 ? 0.35 : -0.35) + shim * (alg == 4 ? (k % 2 ? 1 : -1) : 1));
    fw++;
    double al = o[0] + o[2] + o[4] + o[6], ar = o[1] + o[3] + o[5] + o[7]; al *= 0.5; ar *= 0.5;
    double wl, wr;
    if (route == 2) { wl = al; wr = ar; } else if (route == 3) { wl = el; wr = erv; } else { wl = el * (1 - blend) + al * blend; wr = erv * (1 - blend) + ar * blend; }
    if (vint > 0) { if (++vc >= VI[vint > 4 ? 4 : vint]) { vc = 0; vh[0] = wl; vh[1] = wr; } wl = vh[0]; wr = vh[1]; }
    if (eqOn) { wl = eq[0][1].process(eq[0][0].process(wl)); wr = eq[1][1].process(eq[1][0].process(wr)); }
    double m = (wl + wr) * 0.5, s = (wl - wr) * 0.5 * stw; if (p[20] > 0.5) s = bm[0].process(s);
    wl = m + s; wr = m - s;
    L[i] = (float)(L[i] * (1 - mix) + wl * mix * 1.2); R[i] = (float)(R[i] * (1 - mix) + wr * mix * 1.2);
  }
}

// ---------------------------------------------------------------------------------------------- Looper
static const double LBARS[6] = { 0, 1, 2, 4, 8, 16 };
Looper::Looper(double r) : FxBase(r, { 0, 0, 0, 0, 1, 0, 0, 0 }) { N = (int)(sr * 32); bl = new float[N](); br = new float[N](); }
void Looper::close() { double bars = LBARS[(int)clamp(jsRound(p[1]), 0, 5)]; len = bars ? jsMin(N, jsRound(bars * 4 * 60 / bpm * sr)) : jsMax(64, rec); pos = 0; }
void Looper::setParam(int i, double v) {
  FxBase::setParam(i, v);
  if (i == 0) { int s = (int)jsRound(v); if (s == 1 && st != 1) { len = 0; rec = 0; pos = 0; } if (s != 1 && st == 1) close(); st = s; }
  if (i == 6 && v != clr) { clr = v; len = 0; rec = 0; for (int k = 0; k < N; k++) { bl[k] = 0; br[k] = 0; } }
}
void Looper::process(float* L, float* R, int n) {
  int s0 = st; double rate = std::pow(2, p[2] / 12) * (p[3] > 0.5 ? -1 : 1), fb = p[4], vol = dbToLin(p[7]); int mon = (int)jsRound(p[5]);
  double dry = mon == 0 || ((mon == 2 || mon == 3) && (s0 == 1 || s0 == 3)) || (mon == 3 && s0 == 0) ? 1 : 0;
  for (int i = 0; i < n; i++) {
    double ol = 0, orr = 0;
    if (s0 == 1) { if (rec < N) { bl[(int)rec] = L[i]; br[(int)rec] = R[i]; rec++; } if (p[1] > 0.5 && len == 0) { double bars = LBARS[(int)jsRound(p[1])]; if (rec >= bars * 4 * 60 / bpm * sr) { close(); st = 3; } } }
    else if ((s0 == 2 || s0 == 3) && len > 0) {
      double j = std::floor(pos), k = std::fmod(std::fmod(j, len) + len, len); int ki = (int)k; ol = bl[ki] * vol; orr = br[ki] * vol;
      if (s0 == 3) { bl[ki] = (float)(bl[ki] * fb + L[i]); br[ki] = (float)(br[ki] * fb + R[i]); }
      pos += rate; if (pos >= len) pos -= len; if (pos < 0) pos += len;
    }
    L[i] = (float)(L[i] * dry + ol); R[i] = (float)(R[i] * dry + orr);
  }
}

}  // namespace mdaw
