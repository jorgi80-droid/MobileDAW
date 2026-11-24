// Port of js/engine/fx5.js (same order of operations).
#include "fx5.h"
#include <cmath>
#include <cstring>
#include <initializer_list>

namespace mdaw {

// V8 Math.hypot (builtins-math.tq): divide by the largest magnitude, Kahan-sum the squares, sqrt * max
double jsHypot(double a, double b) {
  double x = std::fabs(a), y = std::fabs(b);
  if (std::isinf(x) || std::isinf(y)) return INFINITY;
  if (x != x || y != y) return NAN;
  double mx = x > y ? x : y; if (mx == 0) return 0;
  double sum = 0, comp = 0;
  for (double v : { x, y }) { double q = v / mx, s = q * q - comp, pre = sum + s; comp = (pre - sum) - s; sum = pre; }
  return std::sqrt(sum) * mx;
}
// dsp.js fft (in-place, radix-2, twiddles by recurrence)
void jsFft(double* re, double* im, int n) {
  for (int i = 1, j = 0; i < n; i++) {
    int bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (int len = 2; len <= n; len <<= 1) {
    double ang = -TWO_PI / len, wr = std::cos(ang), wi = std::sin(ang); int h = len >> 1;
    for (int i = 0; i < n; i += len) {
      double cr = 1, ci = 0;
      for (int k = 0; k < h; k++) {
        int a = i + k, b = a + h; double tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        double nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
static inline double rnd01(uint32_t& s) { return lcg(s) / 4294967296.0; }
static inline double wrapPh(double x) { return x - TWO_PI * std::floor((x + PI) / TWO_PI); }
static const double NOTE_BEATS[8] = { 0.125, 0.25, 0.5, 1, 2, 4, 8, 16 };
static float* fz0(int n) { return new float[n](); }

// ---------------------------------------------------------------- STFT
Stft::Stft(int n, int h) : N(n), hop(h), B(n / 2 + 1) {
  win = new double[N]; for (int i = 0; i < N; i++) win[i] = 0.5 - 0.5 * std::cos(TWO_PI * i / N);
  double s = 0; for (int i = 0; i < N; i += hop) s += win[i] * win[i]; scale = 1 / (s * N);
  for (int c = 0; c < 2; c++) { inp[c] = fz0(N); ola[c] = fz0(N); out[c] = fz0(hop); re[c] = new double[N](); im[c] = new double[N](); }
}
Stft::~Stft() { delete[] win; for (int c = 0; c < 2; c++) { delete[] inp[c]; delete[] ola[c]; delete[] out[c]; delete[] re[c]; delete[] im[c]; } }
void Stft::analyse() {
  for (int c = 0; c < 2; c++) { double* r = re[c]; double* m = im[c]; const float* x = inp[c]; for (int i = 0; i < N; i++) { r[i] = x[i] * win[i]; m[i] = 0; } jsFft(r, m, N); }
}
void Stft::synthesise() {
  for (int c = 0; c < 2; c++) {
    double* r = re[c]; double* m = im[c]; float* o = ola[c];
    for (int j = 1; j < N / 2; j++) { r[N - j] = r[j]; m[N - j] = -m[j]; }
    m[0] = 0; m[N / 2] = 0;
    for (int i = 0; i < N; i++) m[i] = -m[i];
    jsFft(r, m, N);
    for (int i = 0; i < N; i++) o[i] = (float)(o[i] + r[i] * win[i] * scale);
    std::memcpy(out[c], o, sizeof(float) * hop); std::memmove(o, o + hop, sizeof(float) * (N - hop)); std::memset(o + N - hop, 0, sizeof(float) * hop);
    std::memmove(inp[c], inp[c] + hop, sizeof(float) * (N - hop));
  }
}
// fx5.js bands(): sonogram column (display)
static void bands(const float* m, int B, double sr, int N, float* o, int off, int NB) {
  for (int j = 0; j < NB; j++) {
    double f0 = 40 * std::pow(400, (double)j / NB), f1 = 40 * std::pow(400, (double)(j + 1) / NB);
    int b0 = (int)jsMax(1, std::floor(f0 * N / sr)), b1 = (int)jsMin(B - 1, jsMax(b0 + 1, std::ceil(f1 * N / sr)));
    double s = 0; for (int b = b0; b < b1; b++) if (m[b] > s) s = m[b];
    o[off + j] = (float)(20 * std::log10(s * 4 / N + 1e-9));
  }
}

// ---------------------------------------------------------------- Spectral Time
SpectralTime::SpectralTime(double r) : sr(r), st(N, HOP), B(st.B) {
  const double d[22] = { 1, 1, 1, 0, 1, 2, 250, 0.5, 0, 0.25, 1, 250, 0.21, 0, 0, 2, 3, 0, 0.5, 0, 0, 0 };
  for (auto& v : p) v = 0; for (int i = 0; i < 22; i++) p[i] = d[i];
  for (int c = 0; c < 2; c++) {
    mag[c] = fz0(B); ph[c] = fz0(B); prev[c] = fz0(B); pmag[c] = fz0(B);
    fz.m[c] = fz0(B); fz.ph[c] = fz0(B); fz.dp[c] = fz0(B); fz.om[c] = fz0(B); fz.oph[c] = fz0(B); fz.odp[c] = fz0(B);
    dre[c] = fz0(D * B); dim[c] = fz0(D * B);
  }
  col = fz0(B);
}
SpectralTime::~SpectralTime() {
  for (int c = 0; c < 2; c++) { delete[] mag[c]; delete[] ph[c]; delete[] prev[c]; delete[] pmag[c]; delete[] fz.m[c]; delete[] fz.ph[c]; delete[] fz.dp[c]; delete[] fz.om[c]; delete[] fz.oph[c]; delete[] fz.odp[c]; delete[] dre[c]; delete[] dim[c]; }
  delete[] col;
}
void SpectralTime::process(float* L, float* R, int n) {
  double pk = 0; for (int i = 0; i < n; i++) { double a = std::fabs(L[i]) + std::fabs(R[i]); if (a > pk) pk = a; } lvIn = jsMax(pk * 0.5, lvIn * 0.97);
  st.process(L, R, n, [this](double** re, double** im) { frame(re, im); });
  pk = 0; for (int i = 0; i < n; i++) { double a = std::fabs(L[i]) + std::fabs(R[i]); if (a > pk) pk = a; } lvOut = jsMax(pk * 0.5, lvOut * 0.97);
}
void SpectralTime::frame(double** re, double** im) {
  double flux = 0, tot = 0;
  for (int c = 0; c < 2; c++) for (int b = 0; b < B; b++) {
    double m = jsHypot(re[c][b], im[c][b]), a = std::atan2(im[c][b], re[c][b]);
    flux += jsMax(0, m - pmag[c][b]); tot += m; pmag[c][b] = (float)m;
    mag[c][b] = (float)m; prev[c][b] = ph[c][b]; ph[c][b] = (float)a;
  }
  // ---- Freezer
  if (p[0] > 0.5 && p[3] > 0.5) {
    bool retr = jsRound(p[1]) == 1;
    double iv = jsMax(2, p[4] > 0.5 ? frames(NOTE_BEATS[(int)clamp(jsRound(p[5]), 0, 7)]) : p[6] * 0.001 * sr / HOP);
    fz.cnt++;
    bool onset = jsRound(p[2]) == 0 && fz.cnt > 4 && flux > (0.05 + (1 - p[7]) * 0.6) * (tot + 1e-6);
    if (!fz.on || (retr && (jsRound(p[2]) == 1 ? fz.cnt >= iv : onset))) {
      for (int c = 0; c < 2; c++) {
        std::memcpy(fz.om[c], fz.m[c], sizeof(float) * B); std::memcpy(fz.oph[c], fz.ph[c], sizeof(float) * B); std::memcpy(fz.odp[c], fz.dp[c], sizeof(float) * B);
        for (int b = 0; b < B; b++) { fz.m[c][b] = mag[c][b]; fz.ph[c][b] = ph[c][b]; fz.dp[c][b] = (float)wrapPh((double)ph[c][b] - prev[c][b]); }
      }
      if (!fz.on) for (int c = 0; c < 2; c++) std::memset(fz.om[c], 0, sizeof(float) * B);
      fz.on = true; fz.cnt = 0; fz.len = retr && jsRound(p[2]) == 1 ? iv : retr ? 24 : 1e9;
    }
    bool env = jsRound(p[8]) == 1; double xf = jsMax(1, p[9] * (fz.len < 1e8 ? fz.len : 40)), t = fz.cnt, gn, go;
    if (env) { gn = jsMin(1, (t + 1) / jsMax(1, xf / 2)); if (fz.len < 1e8) gn *= jsMin(1, jsMax(0, (fz.len - t) / jsMax(1, xf / 2))); go = 0; }
    else { gn = jsMin(1, (t + 1) / xf); go = 1 - gn; }
    for (int c = 0; c < 2; c++) for (int b = 0; b < B; b++) {
      fz.ph[c][b] = (float)(fz.ph[c][b] + (double)fz.dp[c][b]); fz.oph[c][b] = (float)(fz.oph[c][b] + (double)fz.odp[c][b]);
      double a = fz.m[c][b] * gn, o = fz.om[c][b] * go;
      re[c][b] = a * std::cos((double)fz.ph[c][b]) + o * std::cos((double)fz.oph[c][b]); im[c][b] = a * std::sin((double)fz.ph[c][b]) + o * std::sin((double)fz.oph[c][b]);
    }
  } else fz.on = false;
  // ---- Delay
  if (p[10] > 0.5) {
    int mode = (int)jsRound(p[14]);
    static const double TRIP[3] = { 1, 2.0 / 3, 1.5 };
    double base = mode == 0 ? p[11] * 0.001 * sr / HOP : mode == 1 ? frames(NOTE_BEATS[(int)clamp(jsRound(p[15]), 0, 7)]) : frames(jsRound(p[16]) * 0.25 * (mode - 2 >= 0 && mode - 2 < 3 ? TRIP[mode - 2] : NAN));
    double tilt = p[19] * 0.001 * sr / HOP, spray = p[20] * 0.001 * sr / HOP, fb = clamp(p[12], 0, 0.98), mix = p[18], mask = p[21];
    int sh = (int)jsRound(p[13] * N / sr);
    for (int c = 0; c < 2; c++) {
      float* dr = dre[c]; float* di = dim[c]; double stv = (c ? 1 : -1) * p[17] * base * 0.25; double* rr = re[c]; double* ii = im[c];
      for (int b = 0; b < B; b++) {
        double x = (double)b / B; double dd = clamp(jsRound(base + stv + tilt * (x * 2 - 1) + (spray > 0 ? rnd01(seed) * spray : 0)), 1, D - 1);
        int d = dd == dd ? (int)dd : 0;   // NaN delay: JS indexes undefined (reads 0); never happens with valid modes
        double wb = mask > 0 ? (x >= mask ? 1 : 0) : mask < 0 ? (x <= 1 + mask ? 1 : 0) : 1;
        int rf = ((w - d + D) % D) * B; double yr = dr[rf + b], yi = di[rf + b]; int sb = b - sh;
        double fr = sb >= 0 && sb < B ? dr[rf + sb] : 0, fi = sb >= 0 && sb < B ? di[rf + sb] : 0;
        dr[w * B + b] = (float)(rr[b] * wb + fr * fb); di[w * B + b] = (float)(ii[b] * wb + fi * fb);
        rr[b] = rr[b] * (1 - mix) + yr * mix; ii[b] = ii[b] * (1 - mix) + yi * mix;
      }
    }
    w = (w + 1) % D;
  }
  for (int b = 0; b < B; b++) col[b] = (float)(jsHypot(re[0][b], im[0][b]) + jsHypot(re[1][b], im[1][b]));
  bands(col, B, sr, N, son, 0, 48);
}

// ---------------------------------------------------------------- Spectral Resonator
SpectralResonator::SpectralResonator(double r) : sr(r), st(N, HOP), B(st.B) {
  const double d[19] = { 0, 0, 110, 0, 2.6, 0, 0, 0, 0, 0, 0.1, 0, 128, 1, 16, 0, 0.2, 0, 0.5 };
  for (auto& v : p) v = 0; for (int i = 0; i < 19; i++) p[i] = d[i];
  E[0] = fz0(B); E[1] = fz0(B); phi = new double[B](); hf = fz0(B); hit = new uint8_t[B](); col = fz0(B);
  for (auto& g : gr) g = 1;
  midiIn = true;
}
SpectralResonator::~SpectralResonator() { delete[] E[0]; delete[] E[1]; delete[] phi; delete[] hf; delete[] hit; delete[] col; }
void SpectralResonator::noteOn(int pitch, double vel) {
  bool poly = p[13] > 0.5; int mx = poly ? (int)clamp(jsRound(p[14]), 1, 16) : 1;
  int k = 0; for (int i = 0; i < nn; i++) if (notes[i].p != pitch) notes[k++] = notes[i]; nn = k;
  if (nn < 16) notes[nn++] = { pitch, vel }; else { for (int i = 1; i < nn; i++) notes[i - 1] = notes[i]; notes[nn - 1] = { pitch, vel }; }
  while (nn > mx) { for (int i = 1; i < nn; i++) notes[i - 1] = notes[i]; nn--; }
}
void SpectralResonator::noteOff(int pitch) { int k = 0; for (int i = 0; i < nn; i++) if (notes[i].p != pitch) notes[k++] = notes[i]; nn = k; }
void SpectralResonator::process(float* L, float* R, int n) {
  st.process(L, R, n, [this](double** re, double** im) { frame(re, im); });
  for (int i = 0; i < n; i++) { L[i] = (float)std::tanh((double)L[i]); R[i] = (float)std::tanh((double)R[i]); }
}
void SpectralResonator::frame(double** re, double** im) {
  static const int UNI[4] = { 1, 2, 4, 8 };
  double hopS = (double)HOP / sr, binHz = sr / N, mix = p[18], send = dbToLin(p[17]);
  t += hopS;
  V vs[16]; int nv = 0;
  if (jsRound(p[0]) == 0) vs[nv++] = { clamp(p[2], 20, 4000), 1 };
  else for (int i = 0; i < nn; i++) vs[nv++] = { 440 * std::pow(2, (notes[i].p + p[3] - 69) / 12), 0.4 + 0.6 * notes[i].v };
  int nu = UNI[(int)clamp(jsRound(p[15]), 0, 3)], nvv = 0;
  for (int i = 0; i < nv; i++) for (int u = 0; u < nu; u++) vv[nvv++] = { vs[i].f * std::pow(2, (nu > 1 ? ((double)u / (nu - 1) - 0.5) * p[16] : 0) / 12), vs[i].a / std::sqrt((double)nu) };
  int H = (int)clamp(jsRound(p[12]), 1, 256), mod = (int)jsRound(p[9]); double pm = p[11], rate = 0.05 + p[10] * 12, str = p[7], shf = std::pow(2, -p[8] / 12);
  if (mod == 2) for (int k = 0; k < 256; k++) wan[k] = (float)clamp(wan[k] * 0.995 + (rnd01(seed) - 0.5) * rate * 0.02, -1, 1);
  if (mod == 3) { grT += hopS * rate; if (grT >= 1) { grT -= std::floor(grT); for (int k = 0; k < 256; k++) gr[k] = rnd01(seed) < 0.5 ? 1 : 0; } } else for (auto& g : gr) g = 1;
  std::memset(hit, 0, B);
  for (int vi = 0; vi < nvv; vi++) {
    const V& v = vv[vi];
    for (int k = 1; k <= H; k++) {
      double stv = 0; if (mod == 1) stv = pm * std::sin(TWO_PI * rate * 0.3 * t + k * 1.7); else if (mod == 2) stv = pm * wan[(k - 1) & 255];
      double f = v.f * std::pow((double)k, 1 + str * 0.5) * std::pow(2, stv / 12);
      if (f >= sr * 0.47) break; if (f < 20) continue;
      double bb = jsRound(f / binHz); if (bb < 1 || bb >= B) continue; int b = (int)bb;
      if (!gr[(k - 1) & 255]) continue;
      double sbF = b * shf, s0 = jsRound(sbF);
      for (int c = 0; c < 2; c++) { double m = s0 > 0 && s0 < B ? jsHypot(re[c][(int)s0], im[c][(int)s0]) : 0; E[c][b] = (float)(E[c][b] + m * v.a * send * 0.35); }
      hf[b] = (float)f; hit[b] = 1;
    }
  }
  for (int b = 1; b < B; b++) {
    double x = (double)b / B, T = jsMax(0.01, p[4] * (1 - p[5] * 0.95 * x) * (1 - p[6] * 0.95 * (1 - x) * (1 - x))), dec = std::exp(-6.9 * hopS / T);
    double hb = hf[b]; phi[b] += TWO_PI * (hb != 0 && hb == hb ? hb : b * binHz) * hopS; if (phi[b] > 1e6) phi[b] = wrapPh(phi[b]);
    double cs = std::cos(phi[b]), sn = std::sin(phi[b]);
    for (int c = 0; c < 2; c++) { double e = E[c][b] * dec; E[c][b] = (float)e; re[c][b] = re[c][b] * (1 - mix) + e * cs * mix; im[c][b] = im[c][b] * (1 - mix) + e * sn * mix; }
    col[b] = (float)((double)E[0][b] + E[1][b]);
  }
  re[0][0] *= 1 - mix; re[1][0] *= 1 - mix; im[0][0] *= 1 - mix; im[1][0] *= 1 - mix;
  bands(col, B, sr, N, son, 0, 48);
}

}  // namespace mdaw
