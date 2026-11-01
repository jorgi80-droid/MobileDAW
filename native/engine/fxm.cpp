// Port of the meter devices in js/engine/fx.js (Loudness, Levelness, Analyzer, MiniMeters). Float32Array storage = float.
#include "fxm.h"
#include "fx.h"
#include <cmath>
#include <cstring>

namespace mdaw {

// dsp.js fft on Float32Array data (every butterfly result stored as float, as in the JS)
static void fftF(float* re, float* im, int n) {
  for (int i = 1, j = 0; i < n; i++) { int bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { float t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (int len = 2; len <= n; len <<= 1) {
    double ang = -TWO_PI / len, wr = std::cos(ang), wi = std::sin(ang); int h = len >> 1;
    for (int i = 0; i < n; i += len) {
      double cr = 1, ci = 0;
      for (int k = 0; k < h; k++) {
        int a = i + k, b = a + h; double tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = (float)(re[a] - tr); im[b] = (float)(im[a] - ti); re[a] = (float)(re[a] + tr); im[a] = (float)(im[a] + ti);
        double nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// ================================================================ Loudness (BS.1770-4)
Loudness::Loudness(double r) : sr(r), subLen((int)std::floor(r / 10)) {
  for (int c = 0; c < 2; c++) { k[c][0] = { 1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585, 0, 0 }; k[c][1] = { 1, -2, 1, -1.99004745483398, 0.99007225036621, 0, 0 }; }
  rk = std::exp(-1 / (0.3 * r)); clear();
}
void Loudness::clear() {
  std::memset(hist, 0, sizeof hist); std::memset(lra, 0, sizeof lra); std::memset(ring, 0, sizeof ring);
  rn = 0; rp = 0; sn = 0; ss = 0; tp = 0; sp = 0; sec = 0; pl = 0; pr = 0; rms2 = 0; std::memset(prev, 0, sizeof prev);
  for (auto& v : o) v = -100; o[6] = 0; o[3] = 0; for (auto& c : k) for (auto& s : c) s.z1 = s.z2 = 0;
}
double Loudness::meanLast(int kk) const { int n = (int)jsMin(kk, rn); if (n <= 0) return 0; double s = 0; for (int i = 0; i < n; i++) s += ring[(rp - 1 - i + 30) % 30]; return s / n; }
double Loudness::pct(const uint32_t* h, int from, double q) const {
  double tot = 0; for (int b = from; b < BINS; b++) tot += h[b]; if (!tot) return 0;
  double want = std::ceil(q * tot), acc = 0; for (int b = from; b < BINS; b++) { acc += h[b]; if (acc >= want) return b / 10.0 - 70; } return 0;
}
void Loudness::block() {
  ring[rp] = ss / subLen; rp = (rp + 1) % 30; rn = (int)jsMin(30, rn + 1); ss = 0; sn = 0;
  double mom = lufs(meanLast(4)), st = lufs(meanLast(30));
  if (rn >= 4 && mom > -70) hist[bin(mom)]++;
  if (rn >= 30 && st > -70) lra[bin(st)]++;
  double sum = 0, cnt = 0;
  for (int b = 0; b < BINS; b++) if (hist[b]) { sum += pw(b) * hist[b]; cnt += hist[b]; }
  double integ = -100;
  if (cnt) { double gate = lufs(sum / cnt) - 10, s2 = 0, c2 = 0; for (int b = bin(gate); b < BINS; b++) if (hist[b]) { s2 += pw(b) * hist[b]; c2 += hist[b]; } if (c2) integ = lufs(s2 / c2); }
  double lr = 0, ls = 0, lc = 0;
  for (int b = 0; b < BINS; b++) if (lra[b]) { ls += pw(b) * lra[b]; lc += lra[b]; }
  if (lc) { int from = bin(lufs(ls / lc) - 20); lr = jsMax(0, pct(lra, from, 0.95) - pct(lra, from, 0.1)); }
  o[0] = (float)mom; o[1] = (float)(rn >= 30 ? st : lufs(meanLast(30))); o[2] = (float)integ; o[3] = (float)lr; o[4] = (float)linToDb(tp); o[5] = (float)linToDb(sp); o[6] = (float)sec;
  o[7] = (float)linToDb(std::sqrt(rms2 * 0.5)); o[8] = (float)linToDb(pl); o[9] = (float)linToDb(pr);
}
void Loudness::measure(const float* L, const float* R, int n) {
  const float* ch[2] = { L, R };
  for (int i = 0; i < n; i++) {
    double l = L[i], r = R[i], al = l < 0 ? -l : l, ar = r < 0 ? -r : r;
    if (al > pl) pl = al; if (ar > pr) pr = ar;
    rms2 = rms2 * rk + (l * l + r * r) * (1 - rk);
    for (int c = 0; c < 2; c++) {
      double x = ch[c][i]; sp = jsMax(sp, x < 0 ? -x : x);
      double* q = prev[c]; double p0 = q[0], p1 = q[1], p2 = q[2], p3 = x;
      for (int kk = 1; kk < 4; kk++) { double t = kk * 0.25, t2 = t * t, t3 = t2 * t; double v = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); double av = v < 0 ? -v : v; if (av > tp) tp = av; }
      double ax = x < 0 ? -x : x; if (ax > tp) tp = ax; q[0] = p1; q[1] = p2; q[2] = x;
      double y = x;
      for (auto& s : k[c]) { double oo = s.b0 * y + s.z1; s.z1 = s.b1 * y - s.a1 * oo + s.z2; s.z2 = s.b2 * y - s.a2 * oo; y = oo; }
      ss += y * y;
    }
    sec += 1 / sr;
    if (++sn >= subLen) block();
  }
}

// ================================================================ Level
Levelness::Levelness(double r) : sr(r), m(r) { for (int i = 0; i < 1024; i++) win[i] = (float)(0.5 - 0.5 * std::cos(TWO_PI * i / 1023)); for (auto& v : spec) v = -100; }
void Levelness::setParam(int i, double v) { if (i == 0 && v != resetVal) { resetVal = v; m.clear(); } else if (i == 1) { gdb = clamp(v, -24, 24); g = dbToLin(gdb); } }
void Levelness::process(float* L, float* R, int n) {
  m.measure(L, R, n);
  for (int i = 0; i < n; i++) { int j = (w + i) & 2047; rl[j] = L[i]; rr[j] = R[i]; }
  w = (w + n) & 2047;
  if (g != 1) for (int i = 0; i < n; i++) { L[i] = (float)(L[i] * g); R[i] = (float)(R[i] * g); }
}
int Levelness::readOut(float* o) {
  for (int i = 0; i < 10; i++) o[i] = m.o[i]; o[10] = (float)gdb; o[11] = 0;
  int end = w; const int N = 1024;
  for (int p = 0; p < 64; p++) { int j = (end - 1024 + p * 16) & 2047; double l = rl[j], r = rr[j]; o[12 + p * 2] = (float)((l - r) * 0.7071); o[13 + p * 2] = (float)((l + r) * 0.7071); }
  for (int i = 0; i < N; i++) { int j = (end - N + i) & 2047; re[i] = (float)(((double)rl[j] + rr[j]) * 0.5 * win[i]); im[i] = 0; }
  fftF(re, im, N);
  double binHz = sr / N;
  for (int b = 0; b < 48; b++) {
    double f0 = 30 * std::pow(600, b / 48.0), f1 = 30 * std::pow(600, (b + 1) / 48.0); int k0 = (int)jsMax(1, std::floor(f0 / binHz)), k1 = (int)jsMin(N / 2 - 1, jsMax(k0, std::ceil(f1 / binHz) - 1));
    double mm = 0; for (int kk = k0; kk <= k1; kk++) mm = jsMax(mm, std::sqrt((double)re[kk] * re[kk] + (double)im[kk] * im[kk]));
    double db = linToDb(mm * 4 / N); spec[b] = (float)(db > spec[b] ? db : spec[b] * 0.8 + db * 0.2); o[140 + b] = spec[b];
  }
  return 188;
}

// ================================================================ Analyzer
Analyzer::Analyzer(double r) : sr(r), m(r) { for (int i = 0; i < 2048; i++) win[i] = (float)(0.5 - 0.5 * std::cos(TWO_PI * i / 2047)); }
void Analyzer::process(float* L, float* R, int n) {
  double kk = std::exp(-1 / (0.3 * sr));
  for (int i = 0; i < n; i++) {
    double l = L[i], r = R[i]; int j = (w + i) & 4095; ringL[j] = L[i]; ringR[j] = R[i];
    sLR = sLR * kk + l * r; sLL = sLL * kk + l * l; sRR = sRR * kk + r * r;
    double mm = (l + r) * 0.5, s = (l - r) * 0.5; mid2 = mid2 * kk + mm * mm; side2 = side2 * kk + s * s;
    double al = l < 0 ? -l : l, ar = r < 0 ? -r : r; if (al > pl) pl = al; if (ar > pr) pr = ar; if (al > pk) pk = al; if (ar > pk) pk = ar;
  }
  w = w + n;
  m.measure(L, R, n);
}
int Analyzer::readOut(float* o) {
  uint32_t end = w;
  for (int i = 0; i < N; i++) { double x = ((double)ringL[(end - N + i) & 4095] + ringR[(end - N + i) & 4095]) * 0.5; re[i] = (float)(x * win[i]); im[i] = 0; }
  fftF(re, im, N);
  double d = std::sqrt(sLL * sRR), c = 1 - std::exp(-1 / (0.3 * sr));
  o[0] = (float)(d > 1e-12 ? sLR / d : 0);
  o[1] = (float)linToDb(std::sqrt((sLL + sRR) * c * 0.5));
  double binHz = sr / N;
  for (int b = 0; b < 64; b++) {
    double f0 = 20 * std::pow(1000, b / 64.0), f1 = 20 * std::pow(1000, (b + 1) / 64.0); int k0 = (int)jsMax(1, std::floor(f0 / binHz)), k1 = (int)jsMin(N / 2 - 1, jsMax(k0, std::ceil(f1 / binHz) - 1));
    double mm = 0; for (int kk = k0; kk <= k1; kk++) mm = jsMax(mm, std::sqrt((double)re[kk] * re[kk] + (double)im[kk] * im[kk]));
    o[2 + b] = (float)linToDb(mm * 4 / N);
  }
  o[66] = (float)linToDb(pl); o[67] = (float)linToDb(pr); o[70] = (float)linToDb(pk); pl *= 0.6; pr *= 0.6;
  double rl = std::sqrt(sLL), rr = std::sqrt(sRR); o[68] = (float)(rl + rr > 1e-9 ? (rr - rl) / (rl + rr) : 0);
  double ms = std::sqrt(mid2), ss = std::sqrt(side2); o[69] = (float)(ms + ss > 1e-9 ? ss / (ms + ss) : 0);
  int bk = 0; double bm = 0; int lo = (int)jsMax(2, std::floor(40 / binHz)), hi = (int)jsMin(N / 2 - 2, std::floor(5000 / binHz));
  for (int kk = lo; kk <= hi; kk++) { double mm = (double)re[kk] * re[kk] + (double)im[kk] * im[kk]; if (mm > bm) { bm = mm; bk = kk; } }
  double peakDb = linToDb(std::sqrt(bm) * 4 / N);
  if (bk && peakDb > -60) {
    double m0 = std::log(std::sqrt((double)re[bk - 1] * re[bk - 1] + (double)im[bk - 1] * im[bk - 1]) + 1e-12), m1 = std::log(std::sqrt(bm) + 1e-12), m2 = std::log(std::sqrt((double)re[bk + 1] * re[bk + 1] + (double)im[bk + 1] * im[bk + 1]) + 1e-12);
    double den = m0 - 2 * m1 + m2, off = std::fabs(den) > 1e-9 ? 0.5 * (m0 - m2) / den : 0;
    o[71] = (float)((bk + jsMax(-0.5, jsMin(0.5, off))) * binHz); o[72] = (float)peakDb;
  } else { o[71] = 0; o[72] = -100; }
  o[73] = 0;
  const int span = 2048; double per = span / 96.0;
  for (int p = 0; p < 96; p++) {
    double best = 0, bv = 0; int s0 = (int)std::floor(p * per);
    for (int q = 0; q < per; q++) { double x = ((double)ringL[(end - span + s0 + q) & 4095] + ringR[(end - span + s0 + q) & 4095]) * 0.5, ax = x < 0 ? -x : x; if (ax >= bv) { bv = ax; best = x; } }
    o[74 + p] = (float)best;
  }
  for (int p = 0; p < 64; p++) { int j = (end - 1024 + p * 16) & 4095; double l = ringL[j], r = ringR[j]; o[170 + p * 2] = (float)((l - r) * 0.7071); o[171 + p * 2] = (float)((l + r) * 0.7071); }
  for (int i = 0; i < 10; i++) o[298 + i] = m.o[i]; o[308] = 0; o[309] = 0;
  return 310;
}

// ================================================================ MiniMeters
MiniMeters::MiniMeters(double r) : sr(r), m(r) {
  k = std::exp(-1 / (0.3 * r));
  rl = new float[RING](); rr = new float[RING]();
  for (auto& b : bLP) b.lowpass(r, 200, 0.707); for (auto& b : bHP) b.highpass(r, 2000, 0.707);
  for (auto& b : rb) b = new float[RING >> 2]();
  fr = new float[RING >> 1](); fi = new float[RING >> 1](); gr = new float[RING >> 1](); gi = new float[RING >> 1](); lre = new float[RING >> 1](); lim = new float[RING >> 1]();
}
MiniMeters::~MiniMeters() { delete[] rl; delete[] rr; for (auto* b : rb) delete[] b; delete[] fr; delete[] fi; delete[] gr; delete[] gi; delete[] lre; delete[] lim; delete[] win; delete[] cache; }
void MiniMeters::setParam(int i, double v) {
  if (i == 0 && v != resetVal) { resetVal = v; m.clear(); pl = pr = 0; }
  else if (i == 1) fftIdx = (int)clamp(jsRound(v), 0, 4);
  else if (i == 2) follow = v >= 0.5 ? 1 : 0;
  else if (i == 3) msMode = v >= 0.5 ? 1 : 0;
}
void MiniMeters::process(float* L, float* R, int n) {
  const uint32_t W = RING - 1, W2 = (RING >> 2) - 1;
  for (int i = 0; i < n; i++) {
    double l = L[i], r = R[i]; uint32_t j = (w + i) & W; rl[j] = L[i]; rr[j] = R[i];
    sLR = sLR * k + l * r; sLL = sLL * k + l * l; sRR = sRR * k + r * r;
    rmsL = rmsL * k + l * l * (1 - k); rmsR = rmsR * k + r * r * (1 - k);
    double mm = (l + r) * 0.5, s = (l - r) * 0.5; mid2 = mid2 * k + mm * mm; side2 = side2 * k + s * s;
    double al = l < 0 ? -l : l, ar = r < 0 ? -r : r; if (al > pl) pl = al; if (ar > pr) pr = ar;
    if (l < mnL) mnL = l; if (l > mxL) mxL = l; if (r < mnR) mnR = r; if (r > mxR) mxR = r;
    if (mm < mnM) mnM = mm; if (mm > mxM) mxM = mm; if (s < mnS) mnS = s; if (s > mxS) mxS = s;
    double ll = bLP[0].process(l), lr = bLP[1].process(r), hl = bHP[0].process(l), hr = bHP[1].process(r);
    double ml = l - ll - hl, mr = r - lr - hr; uint32_t jb = (wb + i) & W2;
    rb[0][jb] = (float)ll; rb[1][jb] = (float)lr; rb[2][jb] = (float)ml; rb[3][jb] = (float)mr; rb[4][jb] = (float)hl; rb[5][jb] = (float)hr;
    bs[0][0] = bs[0][0] * k + ll * lr; bs[0][1] = bs[0][1] * k + ll * ll; bs[0][2] = bs[0][2] * k + lr * lr;
    bs[1][0] = bs[1][0] * k + ml * mr; bs[1][1] = bs[1][1] * k + ml * ml; bs[1][2] = bs[1][2] * k + mr * mr;
    bs[2][0] = bs[2][0] * k + hl * hr; bs[2][1] = bs[2][1] * k + hl * hl; bs[2][2] = bs[2][2] * k + hr * hr;
    e2[0] += ll * ll + lr * lr; e2[1] += ml * ml + mr * mr; e2[2] += hl * hl + hr * hr;
  }
  en += n; w = w + n; wb = wb + n;
  m.measure(L, R, n);
}
void MiniMeters::spectra(float* o) {
  int N = 1024 << fftIdx; uint32_t end = w; const uint32_t W = RING - 1;
  if (winN != N) { delete[] win; win = new float[N]; for (int i = 0; i < N; i++) win[i] = (float)(0.5 - 0.5 * std::cos(TWO_PI * i / (N - 1))); winN = N; }   // only when the FFT size changes (a UI action)
  for (int i = 0; i < N; i++) { uint32_t j = (end - N + i) & W; double ww = win[i]; fr[i] = (float)(rl[j] * ww); fi[i] = (float)(rr[j] * ww); }
  fftF(fr, fi, N);
  for (int kk = 0; kk <= N >> 1; kk++) {
    int k2 = (N - kk) & (N - 1); double ar = fr[kk], ai = fi[kk], br = fr[k2], bi = fi[k2];
    lre[kk] = (float)((ar + br) * 0.5); lim[kk] = (float)((ai - bi) * 0.5); gr[kk] = (float)((ai + bi) * 0.5); gi[kk] = (float)((br - ar) * 0.5);
  }
  double binHz = sr / N; int nyq = N / 2 - 1; double top = jsMin(20000, sr * 0.49), sc = 4.0 / N;
  for (int b = 0; b < NB; b++) {
    double f0 = 20 * std::pow(top / 20, (double)b / NB), f1 = 20 * std::pow(top / 20, (double)(b + 1) / NB), fc = std::sqrt(f0 * f1);
    int k0 = (int)std::floor(f0 / binHz), k1 = (int)std::ceil(f1 / binHz) - 1; k0 = (int)jsMax(1, jsMin(nyq, k0)); k1 = (int)jsMax(k0, jsMin(nyq, k1));
    double ma = 0, mb = 0, mm = 0, ms = 0;
    if (k1 - k0 < 1) {
      double x = fc / binHz; int q = (int)jsMax(1, jsMin(nyq - 1, std::floor(x))); double t = x - q;
      double lr = lre[q] + (lre[q + 1] - (double)lre[q]) * t, li = lim[q] + (lim[q + 1] - (double)lim[q]) * t, rr2 = gr[q] + (gr[q + 1] - (double)gr[q]) * t, ri = gi[q] + (gi[q + 1] - (double)gi[q]) * t;
      ma = lr * lr + li * li; mb = rr2 * rr2 + ri * ri; double sr_ = lr + rr2, si_ = li + ri, dr_ = lr - rr2, di_ = li - ri; mm = (sr_ * sr_ + si_ * si_) * 0.25; ms = (dr_ * dr_ + di_ * di_) * 0.25;
    } else {
      for (int kk = k0; kk <= k1; kk++) {
        double lr = lre[kk], li = lim[kk], rr2 = gr[kk], ri = gi[kk];
        double a2 = lr * lr + li * li, b2 = rr2 * rr2 + ri * ri, sr_ = lr + rr2, si_ = li + ri, dr_ = lr - rr2, di_ = li - ri, m2 = (sr_ * sr_ + si_ * si_) * 0.25, s2 = (dr_ * dr_ + di_ * di_) * 0.25;
        if (a2 > ma) ma = a2; if (b2 > mb) mb = b2; if (m2 > mm) mm = m2; if (s2 > ms) ms = s2;
      }
    }
    ma = std::sqrt(ma); mb = std::sqrt(mb); mm = std::sqrt(mm); ms = std::sqrt(ms);
    double A = ma, B = mb; if (msMode) { A = mm; B = ms; }
    o[HEAD + b] = (float)linToDb(A * sc); o[HEAD + NB + b] = (float)linToDb(B * sc); o[HEAD + NB * 2 + b] = (float)linToDb(mm * sc); o[HEAD + NB * 3 + b] = (float)linToDb(ms * sc);
  }
  int lo = (int)jsMax(2, std::floor(40 / binHz)), hi = (int)jsMin(N / 2 - 2, std::floor(5000 / binHz)), bk = 0; double bm = 0;
  for (int kk = lo; kk <= hi; kk++) { double x = (double)lre[kk] + gr[kk], y = (double)lim[kk] + gi[kk], mm = x * x + y * y; if (mm > bm) { bm = mm; bk = kk; } }
  bm = std::sqrt(bm);
  double pd = linToDb(bm * 0.5 * sc);
  if (bk && pd > -60) {
    auto g = [&](int kk) { double a = (double)lre[kk] + gr[kk], b = (double)lim[kk] + gi[kk]; return std::log(std::sqrt(a * a + b * b) + 1e-12); };
    double m0 = g(bk - 1), m1 = g(bk), m2 = g(bk + 1), den = m0 - 2 * m1 + m2, off = std::fabs(den) > 1e-9 ? 0.5 * (m0 - m2) / den : 0;
    o[27] = (float)((bk + clamp(off, -0.5, 0.5)) * binHz); o[28] = (float)pd;
  } else { o[27] = 0; o[28] = -100; }
}
int MiniMeters::readOut(float* o) {
  const uint32_t W = RING - 1; uint32_t end = w; double d = std::sqrt(sLL * sRR);
  auto cr = [](const double* b) { double dd = std::sqrt(b[1] * b[2]); return dd > 1e-12 ? b[0] / dd : 0; };
  o[0] = (float)(d > 1e-12 ? sLR / d : 0); o[1] = (float)cr(bs[0]); o[2] = (float)cr(bs[1]); o[3] = (float)cr(bs[2]);
  o[4] = (float)linToDb(pl); o[5] = (float)linToDb(pr); pl *= 0.6; pr *= 0.6;
  o[6] = (float)linToDb(std::sqrt(rmsL)); o[7] = (float)linToDb(std::sqrt(rmsR));
  double ms = std::sqrt(mid2), ss = std::sqrt(side2); o[8] = (float)linToDb(ms); o[9] = (float)linToDb(ss);
  for (int i = 0; i < 10; i++) o[10 + i] = m.o[i];
  double n = jsMax(1, en);
  o[20] = (float)(mnL > mxL ? 0 : mnL); o[21] = (float)(mnL > mxL ? 0 : mxL); o[22] = (float)(mnR > mxR ? 0 : mnR); o[23] = (float)(mnR > mxR ? 0 : mxR);
  o[24] = (float)linToDb(std::sqrt(e2[0] / (2 * n))); o[25] = (float)linToDb(std::sqrt(e2[1] / (2 * n))); o[26] = (float)linToDb(std::sqrt(e2[2] / (2 * n)));
  bool okk = mnM <= mxM; o[34] = (float)(okk ? mnM : 0); o[35] = (float)(okk ? mxM : 0); o[36] = (float)(okk ? mnS : 0); o[37] = (float)(okk ? mxS : 0);
  mnL = mnR = mnM = mnS = 1; mxL = mxR = mxM = mxS = -1; e2[0] = e2[1] = e2[2] = 0; en = 0;
  double rl2 = std::sqrt(sLL), rr2 = std::sqrt(sRR);
  o[29] = (float)(rl2 + rr2 > 1e-9 ? (rr2 - rl2) / (rl2 + rr2) : 0); o[30] = (float)(ms + ss > 1e-9 ? ss / (ms + ss) : 0);
  o[31] = (float)sr; o[32] = (float)(1024 << fftIdx); o[33] = (float)msMode; for (int i = 38; i < HEAD; i++) o[i] = 0;
  int every = fftIdx >= 3 ? fftIdx - 1 : 1, nsp = NB * 4;
  if (every == 1 || !cache || cacheIdx != fftIdx || cacheMs != msMode || (rc++ % every) == 0) {
    spectra(o); rc = 1; cacheIdx = fftIdx; cacheMs = msMode;
    if (every > 1) { if (!cache) cache = new float[nsp + 2](); for (int i = 0; i < nsp; i++) cache[i] = o[HEAD + i]; cache[nsp] = o[27]; cache[nsp + 1] = o[28]; }
  } else { for (int i = 0; i < nsp; i++) o[HEAD + i] = cache[i]; o[27] = cache[nsp]; o[28] = cache[nsp + 1]; }
  const int span = 1536; uint32_t start = end - span;
  if (follow) {
    const int back = 4096; int best = -1;
    for (int q = back; q > span; q--) { double a = ((double)rl[(end - q) & W] + rr[(end - q) & W]) * 0.5, b = ((double)rl[(end - q + 1) & W] + rr[(end - q + 1) & W]) * 0.5; if (a < 0 && b >= 0) { best = q; break; } }
    if (best > 0) start = end - best;
  }
  const int scL = HEAD + NB * 4, scR = scL + SC, dots = scR + SC, dLo = dots + 256, dMid = dLo + 128, dHi = dMid + 128, endOff = dHi + 128;
  double step = (double)span / SC;
  for (int p = 0; p < SC; p++) { uint32_t j = (start + (uint32_t)std::floor(p * step)) & W; o[scL + p] = rl[j]; o[scR + p] = rr[j]; }
  for (int p = 0; p < 128; p++) { uint32_t j = (end - 1024 + p * 8) & W; double l = rl[j], r = rr[j]; o[dots + p * 2] = (float)((l - r) * 0.7071); o[dots + p * 2 + 1] = (float)((l + r) * 0.7071); }
  const uint32_t W2 = (RING >> 2) - 1;
  for (int band = 0; band < 3; band++) {
    int off = band == 0 ? dLo : band == 1 ? dMid : dHi; const float* A = rb[band * 2]; const float* B = rb[band * 2 + 1];
    for (int p = 0; p < 64; p++) { uint32_t j = (wb - 512 + p * 8) & W2; double l = A[j], r = B[j]; o[off + p * 2] = (float)((l - r) * 0.7071); o[off + p * 2 + 1] = (float)((l + r) * 0.7071); }
  }
  return endOff;
}

}  // namespace mdaw
