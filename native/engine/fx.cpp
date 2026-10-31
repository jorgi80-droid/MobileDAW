// Ports of js/engine/fx.js (core effects). Keep each class in step with its JS original.
#include "fx.h"

namespace mdaw {

// ---------------------------------------------------------------------------------------------- oversampler (dsp.js osDesign / Os2)
static double bessel0(double x) { double sum = 1, term = 1; for (int k = 1; k < 40; k++) { term *= (x / (2 * k)) * (x / (2 * k)); sum += term; if (term < 1e-12 * sum) break; } return sum; }
OsFilter::OsFilter(int len, double fc, double beta) : n(len) {
  double c = (n - 1) / 2.0, dc = 0;
  for (int i = 0; i < n; i++) { double m = i - c, sinc = m == 0 ? 2 * fc : std::sin(2 * PI * fc * m) / (PI * m), r = m / c; h[i] = sinc * bessel0(beta * std::sqrt(jsMax(0, 1 - r * r))) / bessel0(beta); dc += h[i]; }
  for (int i = 0; i < n; i++) h[i] /= dc;
}
const OsFilter& osH() { static const OsFilter f(65, 0.245, 7.3); return f; }
const OsFilter& osH4() { static const OsFilter f(21, 0.25, 7.3); return f; }
const double* Os2::up(double x) {
  double* b = xu; int N = n, p = pu - 1; if (p < 0) p = N - 1; pu = p; b[p] = x; b[p + N] = x;
  double a0 = 0, a1 = 0;
  for (int i = 0; i < ne; i++) a0 += h[2 * i] * b[p + i];
  for (int i = 0; i < no; i++) a1 += h[2 * i + 1] * b[p + i];
  o[0] = 2 * a0; o[1] = 2 * a1; return o;
}
double Os2::down(double a, double b2) {
  double* w = xd; int N = n, p = pd - 1; if (p < 0) p = N - 1; pd = p; w[p] = a; w[p + N] = a;
  double y = 0; for (int i = 0; i < N; i++) y += h[i] * w[p + i];
  p = pd - 1; if (p < 0) p = N - 1; pd = p; w[p] = b2; w[p + N] = b2;
  return y;
}

// ---------------------------------------------------------------------------------------------- Utility
Utility::Utility(double r) : sr(r) { upd(); }
void Utility::upd() { lo[0].lowpass(sr, bmf, 0.707); lo[1].copy(lo[0]); hi[0].highpass(sr, bmf, 0.707); hi[1].copy(hi[0]); }
void Utility::setParam(int i, double v) {
  switch (i) {
    case 0: gdb = v; break; case 1: pan = clamp(v, -1, 1); break; case 2: inv = v > 0.5 ? 1 : 0; break; case 3: mono = v > 0.5 ? 1 : 0; break;
    case 4: invR = v > 0.5 ? 1 : 0; break; case 5: ch = (int)jsRound(clamp(v, 0, 3)); break; case 6: width = clamp(v, 0, 4); break; case 7: bm = v > 0.5 ? 1 : 0; break;
    case 8: bmf = clamp(v, 50, 500); upd(); break; case 9: mute = v > 0.5 ? 1 : 0; break; case 10: dc = v > 0.5 ? 1 : 0; break;
  }
}
void Utility::process(float* L, float* R, int n) {
  double tg = mute ? 0 : dbToLin(gdb);
  if (!gInit) { g = tg; gInit = true; }
  double step = (tg - g) / n, pl = std::cos(jsMax(0, pan) * PI / 2), pr = std::cos(jsMax(0, -pan) * PI / 2);
  double sl = inv ? -1 : 1, sR = invR ? -1 : 1, w = mono ? 0 : width, dcR = 0.995;
  for (int i = 0; i < n; i++) {
    g += step;
    double l = L[i] * sl, r = R[i] * sR;
    if (ch == 1) r = l; else if (ch == 2) l = r; else if (ch == 3) { double t = l; l = r; r = t; }
    if (dc) { double yl = l - dcx[0] + dcR * dcy[0], yr = r - dcx[1] + dcR * dcy[1]; dcx[0] = l; dcx[1] = r; dcy[0] = yl; dcy[1] = yr; l = yl; r = yr; }
    double m = (l + r) * 0.5, s = (l - r) * 0.5 * w;
    if (bm) { s = hi[0].process(s); lo[0].process(0); }
    l = m + s; r = m - s;
    L[i] = (float)(l * g * pl); R[i] = (float)(r * g * pr);
  }
}

// ---------------------------------------------------------------------------------------------- EQ Three
void Xover::set(double f, int steep) {
  static const double Q4[4] = { 0.5412, 1.3066, 0.5412, 1.3066 }, Q2[2] = { 0.7071, 0.7071 };
  int len = steep ? 4 : 2; const double* qs = steep ? Q4 : Q2;
  if (n != len) { n = len; for (int k = 0; k < 4; k++) { l[k] = Biquad(); h[k] = Biquad(); } }
  for (int k = 0; k < n; k++) { l[k].lowpass(sr, f, qs[k]); h[k].highpass(sr, f, qs[k]); }
}
Eq3::Eq3(double r) : sr(r) { for (auto& c : x) for (auto& o : c) o.sr = r; upd(); }
void Eq3::upd() { double h = jsMax(hf, lf * 1.05); for (auto& c : x) { c[0].set(lf, steep); c[1].set(h, steep); c[2].set(h, steep); } }
void Eq3::setParam(int i, double v) {
  if (i < 3) g[i] = clamp(v, -15, 15); else if (i == 4) { lf = clamp(v, 40, 800); upd(); } else if (i == 5) { hf = clamp(v, 1000, 16000); upd(); }
  else if (i >= 6 && i <= 8) on[i - 6] = v > 0.5 ? 1 : 0; else if (i == 9) { steep = v > 0.5 ? 1 : 0; upd(); }
}
void Eq3::process(float* L, float* R, int n) {
  double gl = on[0] ? dbToLin(g[0]) : 0, gm = on[1] ? dbToLin(g[1]) : 0, gh = on[2] ? dbToLin(g[2]) : 0;
  for (int c = 0; c < 2; c++) {
    float* X = c ? R : L; Xover &a = x[c][0], &b = x[c][1], &ap = x[c][2];
    for (int i = 0; i < n; i++) {
      double xi = X[i], low = a.lp(xi), rest = a.hp(xi), mid = b.lp(rest), high = b.hp(rest), lowA = ap.lp(low) + ap.hp(low);
      X[i] = (float)(lowA * gl + mid * gm + high * gh);
    }
  }
}

// ---------------------------------------------------------------------------------------------- Saturator
Saturator::Saturator(double r) : sr(r) { tb[0].lowpass(sr, 20000, 0.707); tb[1].copy(tb[0]); }
void Saturator::setParam(int i, double v) {
  if (i == 4) { type = (int)jsRound(clamp(v, 0, 5)); return; } if (i == 5) { clip = v > 0.5 ? 1 : 0; return; }
  if (i == 0) drive = dbToLin(clamp(v, 0, 36)); else if (i == 1) mix = clamp(v, 0, 1); else if (i == 2) out = dbToLin(clamp(v, -24, 6));
  else if (i == 3) { tone = clamp(v, 500, 20000); tb[0].lowpass(sr, tone, 0.707); tb[1].copy(tb[0]); }
}
double Saturator::shp(double x) const {      // Live curves: Soft Sine, Medium Curve, Hard Curve, Sinoid Fold, Digital Clip (type 0 is in process)
  double d = drive;
  switch (type) {
    case 1: return std::sin(clamp(x * d, -1.5708, 1.5708));
    case 2: { double y = x * d; return y / (1 + std::fabs(y)) * 1.5; }
    case 3: { double y = clamp(x * d, -1.5, 1.5); return y - y * y * y / 6.75; }
    case 4: return std::sin(x * d);
    default: return clamp(x * d, -1, 1);
  }
}
void Saturator::process(float* L, float* R, int n) {
  double d = drive, m = mix, o = out, norm = 1 / fastTanh(jsMax(d, 1)); bool lp = tone < 19500;
  auto sh = [&](double x) { return type ? shp(x) : fastTanh(x * d) * norm; };
  for (int i = 0; i < n; i++) {
    double xl = L[i], xr = R[i];
    const double* u = os[0].up(xl); double l = os[0].down(sh(u[0]), sh(u[1]), sh(u[2]), sh(u[3]));
    u = os[1].up(xr); double r = os[1].down(sh(u[0]), sh(u[1]), sh(u[2]), sh(u[3]));
    if (clip) { l = fastTanh(l); r = fastTanh(r); }
    if (lp) { l = tb[0].process(l); r = tb[1].process(r); }
    double yl = dl[dp], yr = dr[dp]; dl[dp] = xl; dr[dp] = xr; if (++dp >= OS4_LATENCY) dp = 0;
    L[i] = (float)((yl * (1 - m) + l * m) * o); R[i] = (float)((yr * (1 - m) + r * m) * o);
  }
}

// ---------------------------------------------------------------------------------------------- Compressor
Compressor::Compressor(double r) : sr(r) { D = (int)std::ceil(sr * 0.011); dl = new float[D](); dr = new float[D](); upd(); }
void Compressor::upd() { aC = std::exp(-1 / (jsMax(0.05, atk) * 0.001 * sr)); rC = std::exp(-1 / (jsMax(1, rel) * 0.001 * sr)); linStep = 60 / (jsMax(1, rel) * 0.001 * sr); }
void Compressor::setParam(int i, double v) {
  switch (i) {
    case 0: thr = v; break; case 1: ratio = jsMax(1, v); break; case 2: atk = v; upd(); break; case 3: rel = v; upd(); break;
    case 4: mk = dbToLin(v); break; case 5: knee = clamp(v, 0, 24); break; case 6: cmix = clamp(v, 0, 1); break; case 7: mode = (int)jsRound(clamp(v, 0, 2)); break;
    case 8: aut = v > 0.5 ? 1 : 0; break;
    case 9: { int k = (int)jsRound(clamp(v, 0, 2)); la = k == 0 ? 0 : k == 1 ? (int)jsRound(sr * 0.001) : (int)jsRound(sr * 0.01); break; }
    case 10: lin = v < 0.5 ? 1 : 0; break; case 11: arel = v > 0.5 ? 1 : 0; break;
  }
}
void Compressor::process(float* L, float* R, int n) {
  double kn = jsMax(0.01, knee), cm = cmix, th = thr, a_ = aC, r_ = rC, rt = ratio;
  double mkg = mk * (aut ? dbToLin(-th * (1 - 1 / rt) * 0.5) : 1), rmsC = 1 - std::exp(-1 / (0.01 * sr)), slC = 1 - std::exp(-1 / (1.5 * sr));
  double g_r = gr, pi = pin, po = pout; int p_ = dp;
  for (int i = 0; i < n; i++) {
    double a = L[i] < 0 ? -(double)L[i] : L[i], b = R[i] < 0 ? -(double)R[i] : R[i], pk = a > b ? a : b;
    if (pk > pi) pi = pk;
    double lev = pk;
    if (mode == 1) { rms += (pk * pk - rms) * rmsC; lev = std::sqrt(rms); }
    double over = 6.0205999 * fastLog2(lev + 1e-9) - th, red = 0;
    if (mode == 2) { if (over < 0) red = jsMin(60, -over * (rt - 1)); }
    else { double slope = 1 / rt - 1; if (2 * over > kn) red = -slope * over; else if (2 * over > -kn) red = -slope * (over + kn / 2) * (over + kn / 2) / (2 * kn); }
    if (red > g_r) g_r = a_ * g_r + (1 - a_) * red;
    else if (lin) g_r = jsMax(red, g_r - linStep);
    else if (arel) { slow += (red - slow) * slC; double f = r_ * g_r + (1 - r_) * red; g_r = jsMax(f, jsMin(g_r, slow)); }
    else g_r = r_ * g_r + (1 - r_) * red;
    double g = fastPow2(-g_r * 0.16609640) * mkg;
    double xl = L[i], xr = R[i];
    if (la) { int p = (p_ - la + D) % D; dl[p_] = (float)xl; dr[p_] = (float)xr; xl = dl[p]; xr = dr[p]; p_ = (p_ + 1) % D; }
    L[i] = (float)(xl * (1 - cm) + xl * g * cm); R[i] = (float)(xr * (1 - cm) + xr * g * cm);
    double oa = L[i] < 0 ? -(double)L[i] : L[i], ob = R[i] < 0 ? -(double)R[i] : R[i]; if (oa > po) po = oa; if (ob > po) po = ob;
  }
  gr = g_r; pin = pi; pout = po; dp = p_;
}

// ---------------------------------------------------------------------------------------------- Limiter
Limiter::Limiter(double r) : sr(r) {
  ceil = dbToLin(-0.3); La = (int)jsMax(8, jsRound(sr * 0.0015)); W = La + 1;
  dL = new double[La](); dR = new double[La](); qv = new double[W + 1](); qt = new double[W + 1](); ma = new double[W]; for (int k = 0; k < W; k++) ma[k] = 1; ms = W;
  upd();
}
void Limiter::setParam(int i, double v) { if (i == 0) ceil = dbToLin(v); else if (i == 1) { rel = v; upd(); } else if (i == 2) in = dbToLin(v); }
void Limiter::process(float* L, float* R, int n) {
  double cl = ceil, inG = in, rl = 1 - rC; int Q = W + 1;
  double gg = g, pi = pin, po = pout, tt = t, s_ = ms; int p_ = dp, h_ = qh, n_ = qn, m_ = mp;
  for (int i = 0; i < n; i++) {
    double l = L[i] * inG, r = R[i] * inG, a = l < 0 ? -l : l, b = r < 0 ? -r : r, pk = a > b ? a : b;
    if (pk > pi) pi = pk;
    double need = pk > cl ? cl / pk : 1;
    while (n_ > 0 && qv[(h_ + n_ - 1) % Q] >= need) n_--;
    qv[(h_ + n_) % Q] = need; qt[(h_ + n_) % Q] = tt; n_++;
    while (qt[h_] <= tt - W) { h_ = (h_ + 1) % Q; n_--; }
    double mn = qv[h_];
    s_ += mn - ma[m_]; ma[m_] = mn; if (++m_ >= W) m_ = 0;
    double s = s_ / W;
    gg = s < gg ? s : gg + (s - gg) * rl;
    double ol = dL[p_] * gg, orr = dR[p_] * gg; dL[p_] = l; dR[p_] = r; if (++p_ >= La) p_ = 0;
    L[i] = (float)(ol > cl ? cl : ol < -cl ? -cl : ol); R[i] = (float)(orr > cl ? cl : orr < -cl ? -cl : orr);
    double qa = L[i] < 0 ? -(double)L[i] : L[i], qb = R[i] < 0 ? -(double)R[i] : R[i]; if (qa > po) po = qa; if (qb > po) po = qb;
    tt++;
  }
  if (tt > 1e15) { for (int k = 0; k < n_; k++) qt[(h_ + k) % Q] -= tt; tt = 0; }
  s_ = 0; for (int k = 0; k < W; k++) s_ += ma[k];
  g = gg; pin = pi; pout = po; dp = p_; qh = h_; qn = n_; t = tt; mp = m_; ms = s_;
}

// ---------------------------------------------------------------------------------------------- Reverb
Reverb::Reverb(double r) : sr(r) {
  double s = sr / 44100; static const int ct[8] = { 1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617 }, at[4] = { 556, 441, 341, 225 };
  for (int c = 0; c < 2; c++) {
    int tot = 0; for (int k = 0; k < 8; k++) { cl[c][k] = (int)std::floor((ct[k] + c * 23) * s); co[c][k] = tot; tot += cl[c][k]; }
    int tot2 = 0; for (int k = 0; k < 4; k++) { al[c][k] = (int)std::floor((at[k] + c * 23) * s); ao[c][k] = tot2; tot2 += al[c][k]; }
    cbuf[c] = new float[tot](); abuf[c] = new float[tot2]();
  }
  pn = (int)std::ceil(sr * 0.12); pdl = new float[pn]();
  upF(); upd();
}
void Reverb::setParam(int i, double v) {
  if (i == 4) { width = clamp(v, 0, 1); return; } if (i == 5) { freeze = v > 0.5 ? 1 : 0; upd(); return; }
  if (i == 6) { lcf = clamp(v, 20, 2000); upF(); return; } if (i == 7) { hcf = clamp(v, 1000, 20000); upF(); return; }
  if (i == 0) size = clamp(v, 0, 1); else if (i == 1) damp = clamp(v, 0, 1); else if (i == 2) mix = clamp(v, 0, 1); else if (i == 3) pd = (int)std::floor(clamp(v, 0, 100) * 0.001 * sr);
  upd();
}
void Reverb::process(float* L, float* R, int n) {
  for (int i = 0; i < n; i++) {
    double x = freeze ? 0 : hc.process(lc.process(((double)L[i] + R[i]) * 0.015));
    if (pd > 0) { pdl[pdw] = (float)x; int rp = pdw - pd; if (rp < 0) rp += pn; tmp[i] = pdl[rp]; if (++pdw >= pn) pdw = 0; } else tmp[i] = (float)x;
  }
  double wet = mix * 3, dry = 1 - mix * 0.5, d0 = 1 - d1;
  for (int c = 0; c < 2; c++) {
    float* cb = cbuf[c]; float* ab = abuf[c]; float* cs = cst[c]; int* ci = cidx[c]; int* ai = aidx[c];
    for (int i = 0; i < n; i++) {
      double inp = tmp[i], out = 0;
      for (int k = 0; k < 8; k++) {
        int j = ci[k], p = co[c][k] + j; double y = cb[p];
        double st = y * d0 + cs[k] * d1; cs[k] = (float)st; cb[p] = (float)(inp + st * fb);
        if (++j >= cl[c][k]) j = 0; ci[k] = j; out += y;
      }
      for (int k = 0; k < 4; k++) {
        int j = ai[k], p = ao[c][k] + j; double y = ab[p];
        ab[p] = (float)(out + y * 0.5); out = y - out;
        if (++j >= al[c][k]) j = 0; ai[k] = j;
      }
      wv[c][i] = (float)(out * wet);
    }
  }
  double w = width;
  for (int i = 0; i < n; i++) { double m = ((double)wv[0][i] + wv[1][i]) * 0.5, sd = ((double)wv[0][i] - wv[1][i]) * 0.5 * w; L[i] = (float)(L[i] * dry + m + sd); R[i] = (float)(R[i] * dry + m - sd); }
}

// ---------------------------------------------------------------------------------------------- Parametric EQ
void ParametricEq::upd() {
  b[0][0].lowShelf(sr, f[0], 0.707, g[0]); b[1][0].peaking(sr, f[1], q[0], g[1]); b[2][0].peaking(sr, f[2], q[1], g[2]); b[3][0].highShelf(sr, f[3], 0.707, g[3]);
  for (auto& x : b) x[1].copy(x[0]);
}
void ParametricEq::setParam(int i, double v) {
  switch (i) { case 0: f[0] = v; break; case 1: g[0] = clamp(v, -18, 18); break; case 2: f[1] = v; break; case 3: g[1] = clamp(v, -18, 18); break; case 4: q[0] = clamp(v, 0.2, 12); break;
    case 5: f[2] = v; break; case 6: g[2] = clamp(v, -18, 18); break; case 7: q[1] = clamp(v, 0.2, 12); break; case 8: f[3] = v; break; case 9: g[3] = clamp(v, -18, 18); break; }
  upd();
}
void ParametricEq::process(float* L, float* R, int n) {
  for (int i = 0; i < n; i++) { L[i] = (float)b[3][0].process(b[2][0].process(b[1][0].process(b[0][0].process(L[i])))); R[i] = (float)b[3][1].process(b[2][1].process(b[1][1].process(b[0][1].process(R[i])))); }
}

}  // namespace mdaw
