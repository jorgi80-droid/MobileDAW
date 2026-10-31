// Ports of js/engine/fx3.js (part 1). Keep each class in step with its JS original.
#include "fx3.h"

namespace mdaw {

static const double SIXTEENTHS[8] = { 1, 2, 3, 4, 5, 6, 8, 16 };

// ---------------------------------------------------------------------------------------------- Delay
Delay3::Delay3(double r) : FxBase(r, { 1, 2, 250, 0, 1, 3, 300, 0, 1, 0.5, 0, 1, 1000, 6.5, 0.5, 0, 0, 1, 0, 0.5 }) {
  int N = pow2Size(sr * 6); bl = new float[N](); br = new float[N](); m = N - 1;
  fl.sr = fr.sr = sr; fl.set(1000, 6); fr.set(1000, 6); cur[0] = sr * 0.25; cur[1] = sr * 0.3; upd();
}
double Delay3::tgt(int c) {
  int o = c ? 4 : 0, src = c && p[8] > 0.5 ? 0 : o; double s16 = 60 / bpm / 4;
  double sec = p[src] > 0.5 ? SIXTEENTHS[(int)clamp(jsRound(p[src + 1]), 0, 7)] * s16 * (1 + clamp(p[src + 3], -0.333, 0.333)) : p[src + 2] / 1000;
  return clamp(sec * sr, 2, m - 4);
}
void Delay3::setParam(int i, double v) { FxBase::setParam(i, v); if (i == 8 && v > 0.5) { p[4] = p[0]; p[5] = p[1]; p[6] = p[2]; p[7] = p[3]; } upd(); }
void Delay3::process(float* L, float* R, int n) {
  double fb = p[10] > 0.5 ? 1 : clamp(p[9], 0, 0.95), mix = p[19]; int mode = (int)jsRound(p[17]); bool pp = p[18] > 0.5, frz = p[10] > 0.5, fon = p[11] > 0.5;
  double rate = TWO_PI * p[14] / sr, mf = p[15], mt = p[16], xs = 1 / (0.05 * sr), sm = 1 - coefMs(60, sr);
  for (int i = 0; i < n; i++) {
    ph += rate; if (ph > TWO_PI) ph -= TWO_PI; double lfo = std::sin(ph);
    if ((i & 31) == 0 && fon) { double f = clamp(p[12] * std::pow(2, lfo * mf * 2), 30, 18000); if (std::fabs(f - fq) > fq * 0.002) { fl.set(f, p[13]); fr.set(f, p[13]); fq = f; } }
    double out[2];
    for (int c = 0; c < 2; c++) {
      double tg = t[c] * (1 + lfo * mt * 0.02); float* buf = c ? br : bl;
      if (mode == 0) cur[c] += (tg - cur[c]) * sm;
      else if (std::fabs(tg - cur[c]) > 1 && xf[c] <= 0) { if (mode == 1) { old[c] = cur[c]; xf[c] = 1; } cur[c] = tg; }
      double y = rdJ(buf, m, w, cur[c]);
      if (xf[c] > 0) { double o = rdJ(buf, m, w, old[c]); y = y * (1 - xf[c]) + o * xf[c]; xf[c] -= xs; }
      out[c] = fon ? (c ? fr : fl).process(y) : y;
    }
    double inL = frz ? 0 : L[i], inR = frz ? 0 : R[i]; int wi = toInt32(w) & m;
    if (pp) { bl[wi] = (float)((inL + inR) * 0.5 + out[1] * fb); br[wi] = (float)(out[0] * fb); }
    else { bl[wi] = (float)(inL + out[0] * fb); br[wi] = (float)(inR + out[1] * fb); }
    w++;
    L[i] = (float)(L[i] * (1 - mix) + out[0] * mix); R[i] = (float)(R[i] * (1 - mix) + out[1] * mix);
  }
}

// ---------------------------------------------------------------------------------------------- Filter Delay
FilterDelay::FilterDelay(double r) : FxBase(r, {}) {
  int N = pow2Size(sr * 4); m = N - 1; for (int k = 0; k < 3; k++) { b[k] = new float[N](); f[k].sr = sr; f[k].set(1000, 6); }
  static const double F[3] = { 1010, 156, 1730 }, W[3] = { 2.09, 3.42, 2.36 }, PN[3] = { -0.5, 0, 0.5 };
  for (int k = 0; k < 3; k++) { double* q = p + k * 10; q[0] = 1; q[1] = 1; q[2] = F[k]; q[3] = W[k]; q[4] = 0; q[5] = 3; q[6] = 250; q[7] = 0.2; q[8] = PN[k]; q[9] = 0; }
  p[30] = 0; for (int k = 0; k < 3; k++) upd(k);
}
void FilterDelay::upd(int k) {
  int o = k * 10; f[k].set(p[o + 2], p[o + 3]); double s16 = 60 / bpm / 4;
  d[k] = clamp((p[o + 4] > 0.5 ? SIXTEENTHS[(int)clamp(jsRound(p[o + 5]), 0, 7)] * s16 : p[o + 6] / 1000) * sr, 2, m - 2);
}
void FilterDelay::process(float* L, float* R, int n) {
  double dry = p[30] <= -60 ? 0 : dbToLin(p[30]), g[3], pl[3], pr[3];
  for (int k = 0; k < 3; k++) { int o = k * 10; double v = p[o + 9] <= -60 ? 0 : dbToLin(p[o + 9]), pan = clamp(p[o + 8], -1, 1); g[k] = p[o] > 0.5 ? v : 0; pl[k] = std::cos((pan + 1) * PI / 4); pr[k] = std::sin((pan + 1) * PI / 4); }
  for (int i = 0; i < n; i++) {
    double x[3] = { L[i], ((double)L[i] + R[i]) * 0.5, R[i] }, oL = L[i] * dry, oR = R[i] * dry;
    for (int k = 0; k < 3; k++) {
      int o = k * 10; float* buf = b[k]; double y0 = buf[toInt32(w - d[k]) & m], y = p[o + 1] > 0.5 ? f[k].process(y0) : y0;
      buf[toInt32(w) & m] = (float)((p[o] > 0.5 ? x[k] : 0) + y * clamp(p[o + 7], 0, 0.95));
      oL += y * g[k] * pl[k]; oR += y * g[k] * pr[k];
    }
    w++; L[i] = (float)oL; R[i] = (float)oR;
  }
}

// ---------------------------------------------------------------------------------------------- Beat Repeat
static const double BR_INTERVAL[8] = { 0.125, 0.25, 0.5, 1, 2, 4, 8, 16 }, BR_GRID[9] = { 1, 2.0 / 3, 0.5, 1.0 / 3, 0.25, 1.0 / 6, 0.125, 1.0 / 12, 0.0625 };
BeatRepeat::BeatRepeat(double r) : FxBase(r, { 5, 0, 4, 0, 1, 8, 0, 0, 1, 1000, 6, 0, 0, 0, 0, 0 }) {
  hasTr = true; int N = pow2Size(sr * 10); bl = new float[N](); br = new float[N](); m = N - 1; fl.sr = fr.sr = sr; fl.set(1000, 6); fr.set(1000, 6);
}
void BeatRepeat::setParam(int i, double v) { FxBase::setParam(i, v); if (i == 9 || i == 10) { fl.set(p[9], p[10]); fr.set(p[9], p[10]); } if (i == 15 && v > 0.5) trigger(); }
double BeatRepeat::grid() {
  int gi = (int)clamp(jsRound(p[2]), 0, 8); double vr = jsRound(p[3]);
  if (vr > 0) gi = (int)clamp(gi + jsRound(((lcg(seed) / 4294967296.0) * 2 - 1) * vr), 0, 8);
  if (p[14] > 0.5 && gi % 2 == 1 && gi > 0) gi -= 1;
  gridNow = gi; return BR_GRID[gi];
}
void BeatRepeat::trigger() {
  double spb = 60 / bpm * sr; len = jsMax(64, jsRound(grid() * spb)); start = w; pos = 0;
  left = jsRound(clamp(p[5], 1, 64) * spb / 4); rate = std::pow(2, clamp(p[6], -48, 0) / 12); amp = 1; on = true; cap = len;
}
void BeatRepeat::process(float* L, float* R, int n) {
  double iv = BR_INTERVAL[(int)clamp(jsRound(p[0]), 0, 7)], off = clamp(p[1], 0, 15) / 4;
  if (play) { double slot = std::floor((beat - off) / iv); if (slot != lastSlot && beat - off >= 0) { lastSlot = slot; if ((lcg(seed) / 4294967296.0) < p[4]) trigger(); } }
  else lastSlot = -1;
  double vol = p[12] <= -60 ? 0 : dbToLin(p[12]); int mode = (int)jsRound(p[11]); bool fon = p[8] > 0.5; double pd = p[7], dk = p[13];
  for (int i = 0; i < n; i++) {
    int wi = toInt32(w) & m; bl[wi] = L[i]; br[wi] = R[i];
    double rl = 0, rr = 0;
    if (on) {
      if (cap > 0) { cap--; rl = L[i]; rr = R[i]; }
      else {
        double q = start + pos; rl = rdJ(bl, m, q, 0); rr = rdJ(br, m, q, 0);
        double env = jsMin(jsMin(1, pos / 32), (len - pos) / 32);
        rl *= env * amp; rr *= env * amp;
        pos += rate; if (pos >= len) { pos = 0; rate = jsMax(0.0625, rate * (1 - pd * 0.15)); amp *= 1 - dk * 0.6; }
      }
      if (fon) { rl = fl.process(rl); rr = fr.process(rr); }
      if (--left <= 0) on = false;
    }
    w++;
    double dryOn = mode == 0 || (mode == 1 && !on) ? 1 : 0;
    L[i] = (float)(L[i] * dryOn + rl * vol); R[i] = (float)(R[i] * dryOn + rr * vol);
  }
}

// ---------------------------------------------------------------------------------------------- Chorus-Ensemble
ChorusEnsemble::ChorusEnsemble(double r) : FxBase(r, { 0, 0.62, 0.59, 0.3, 0, 0, 50, 1, 20, 1, 0, 0, 0.5 }) { int N = pow2Size(sr * 0.1); bl = new float[N](); br = new float[N](); m = N - 1; upd(); }
void ChorusEnsemble::process(float* L, float* R, int n) {
  int mode = (int)jsRound(p[0]); double rate = TWO_PI * p[1] / sr, amt = p[2], fb = clamp(p[3], 0, 0.95) * (p[4] > 0.5 ? -1 : 1); bool hp = p[5] > 0.5;
  double base = clamp(p[8], 1, 40) * 0.001 * sr, depth = amt * (mode == 2 ? 0.004 : 0.003) * sr; int taps = mode == 1 ? 3 : mode == 0 && p[9] > 0.5 ? 2 : 1;
  double wet = mode == 2 ? 1 : p[12], out = dbToLin(p[11]), width = clamp(p[7], 0, 2), warm = p[10];
  for (int i = 0; i < n; i++) {
    ph += rate; if (ph > TWO_PI) ph -= TWO_PI;
    double yl = 0, yr = 0;
    for (int t = 0; t < taps; t++) {
      double a = ph + t * TWO_PI / taps;
      yl += rdJ(bl, m, w, base * (1 + t * 0.35) + depth * (1 + std::sin(a)));
      yr += rdJ(br, m, w, base * (1 + t * 0.35) + depth * (1 + std::sin(a + PI / 2 * width)));
    }
    yl /= taps; yr /= taps;
    double xl = hp ? hl.process(L[i]) : L[i], xr = hp ? hr.process(R[i]) : R[i]; int wi = toInt32(w) & m;
    bl[wi] = (float)(xl + yl * fb); br[wi] = (float)(xr + yr * fb); w++;
    if (warm > 0) { yl = wl.process(fastTanh(yl * (1 + warm * 3)) / (1 + warm)); yr = wr.process(fastTanh(yr * (1 + warm * 3)) / (1 + warm)); }
    double mm = (yl + yr) * 0.5, s = (yl - yr) * 0.5 * width; yl = mm + s; yr = mm - s;
    L[i] = (float)((L[i] * (1 - wet) + yl * wet) * out); R[i] = (float)((R[i] * (1 - wet) + yr * wet) * out);
  }
}

// ---------------------------------------------------------------------------------------------- Phaser-Flanger
static const double PF_DIV[7] = { 0.25, 0.5, 1, 2, 4, 8, 16 };
PhaserFlanger::PhaserFlanger(double r) : FxBase(r, { 0, 4, 769, 0.37, 0.62, 0.5, 0, 0.69, 0.12, 0, 0.27, 0, 0.5, 2, 3 }) { int N = pow2Size(sr * 0.06); bl = new float[N](); br = new float[N](); m = N - 1; upd(); }
void PhaserFlanger::process(float* L, float* R, int n) {
  int mode = (int)jsRound(p[0]); double hz = p[6] > 0.5 ? bpm / 60 / PF_DIV[(int)clamp(jsRound(p[14]), 0, 6)] : p[5], rate = TWO_PI * hz / sr;
  double amt = p[7], fb = clamp(p[8], 0, 0.95) * (p[9] > 0.5 ? -1 : 1), wet = p[12], out = dbToLin(p[11]); int st = (int)clamp(jsRound(p[1]), 1, 24) * 2; double warm = p[10];
  for (int i = 0; i < n; i++) {
    ph += rate; if (ph > TWO_PI) ph -= TWO_PI;
    double yl, yr;
    if (mode == 0) {
      double ml = std::sin(ph), mr = std::sin(ph + PI * p[3]);
      double fL = clamp(p[2] * std::pow(2, ml * amt * 3), 20, 18000), fR = clamp(p[2] * std::pow(2, mr * amt * 3), 20, 18000);
      double tL = std::tan(PI * fL / sr), tR = std::tan(PI * fR / sr), aL = (1 - tL) / (1 + tL), aR = (1 - tR) / (1 + tR);
      yl = L[i] + lastL * fb; yr = R[i] + lastR * fb;
      for (int k = 0; k < st; k++) { yl = ap(z[0], yl, aL, k); yr = ap(z[1], yr, aR, k); }
      lastL = yl; lastR = yr;
    } else {
      double base = (mode == 1 ? clamp(p[13], 0.1, 20) : clamp(p[13], 0.1, 20) + 15) * 0.001 * sr, dep = amt * (mode == 1 ? 0.004 : 0.006) * sr;
      double dl = base + dep * (1 + std::sin(ph)) * 0.5, dr = base + dep * (1 + std::sin(ph + PI * p[3])) * 0.5;
      yl = rdJ(bl, m, w, dl); yr = rdJ(br, m, w, dr); int wi = toInt32(w) & m;
      bl[wi] = (float)(L[i] + yl * fb); br[wi] = (float)(R[i] + yr * fb); w++;
    }
    if (warm > 0) { yl = wl.process(fastTanh(yl * (1 + warm * 2))); yr = wr.process(fastTanh(yr * (1 + warm * 2))); }
    double b = mode == 0 ? 0.5 + (p[4] - 0.5) * 0.5 : 0.5;
    L[i] = (float)(((L[i] * (1 - b) + yl * b) * wet + L[i] * (1 - wet)) * out); R[i] = (float)(((R[i] * (1 - b) + yr * b) * wet + R[i] * (1 - wet)) * out);
  }
}

// ---------------------------------------------------------------------------------------------- Auto Pan
static const double AP_DIV[7] = { 0.25, 0.5, 1, 2, 4, 8, 16 };
double AutoPan::wave(double x, int c) {
  int wf = (int)jsRound(p[7]); x -= std::floor(x); double v;
  if (wf == 0) v = std::sin(TWO_PI * x); else if (wf == 1) v = 1 - 4 * std::fabs(x - 0.5); else if (wf == 2) v = 1 - 2 * x;
  else { if (x < last[c]) sh[c] = (lcg(seed) / 4294967296.0) * 2 - 1; last[c] = x; v = sh[c]; }
  double s = p[5]; if (s > 0) v = clamp(v * (1 + s * 6), -1, 1);
  return v;
}
void AutoPan::process(float* L, float* R, int n) {
  double amt = p[0], inv = p[8] > 0.5 ? -1 : 1; bool sync = p[2] > 0.5; double dv = AP_DIV[(int)clamp(jsRound(p[3]), 0, 6)], hz = sync ? bpm / 60 / dv : p[1];
  if (sync && play) ph = beat / dv;
  double step = hz / sr, off = p[6] / 360, phs = p[4] / 360;
  for (int i = 0; i < n; i++) {
    ph += step; double a = wave(ph + off, 0), b = wave(ph + off + phs, 1);
    double gl = 1 - amt * (0.5 + 0.5 * a * inv), gr = 1 - amt * (0.5 + 0.5 * b * -inv);
    L[i] = (float)(L[i] * gl); R[i] = (float)(R[i] * gr);
  }
  ph -= std::floor(ph);
}

// ---------------------------------------------------------------------------------------------- Gate
void Gate::process(float* L, float* R, int n) {
  double on = dbToLin(p[0]), off = dbToLin(p[0] - p[1]), at = 1 - coefMs(p[2], sr), rl = 1 - coefMs(p[4], sr), hs = p[3] * 0.001 * sr, fl = dbToLin(p[5]); bool flip = p[6] > 0.5; double ec = 1 - coefMs(1, sr);
  double pk = 0;
  for (int i = 0; i < n; i++) {
    double x = jsMax(std::fabs((double)L[i]), std::fabs((double)R[i])); env += (x - env) * (x > env ? 1 : ec); if (x > pk) pk = x;
    if (env >= on) { open = true; hold = hs; } else if (env < off) { if (hold > 0) hold--; else open = false; }
    double t = (open != flip) ? 1 : fl; g += (t - g) * (t > g ? at : rl);
    L[i] = (float)(L[i] * g); R[i] = (float)(R[i] * g);
  }
  inPk = jsMax(pk, inPk * 0.9); gr = g;
}

// ---------------------------------------------------------------------------------------------- Glue Compressor
static const double GLUE_ATK[7] = { 0.01, 0.1, 0.3, 1, 3, 10, 30 }, GLUE_REL[6] = { 0.1, 0.2, 0.4, 0.6, 0.8, 1.2 }, GLUE_RAT[3] = { 2, 4, 10 };
void GlueComp::process(float* L, float* R, int n) {
  double at = 1 - coefMs(GLUE_ATK[(int)clamp(jsRound(p[0]), 0, 6)], sr); bool aut = jsRound(p[1]) >= 6; double rel = GLUE_REL[(int)clamp(jsRound(p[1]), 0, 5)];
  double ratio = GLUE_RAT[(int)clamp(jsRound(p[2]), 0, 2)], th = p[3], mk = dbToLin(p[4]), range = p[5]; bool clip = p[6] > 0.5; double mix = p[7];
  double rf = 1 - coefMs(rel * 1000, sr), rs = 1 - coefMs(1500, sr), rq = 1 - coefMs(80, sr), mx = 0;
  for (int i = 0; i < n; i++) {
    double x = jsMax(std::fabs((double)L[i]), std::fabs((double)R[i])), xdb = linToDb(x), over = xdb - th;
    double want = over > 0 ? jsMin(range, over * (1 - 1 / ratio)) : 0;
    if (want > env) env += (want - env) * at;
    else if (aut) { slow += (want - slow) * rs; double fast = env + (want - env) * rq; env = jsMax(fast, jsMin(env, slow)); }
    else env += (want - env) * rf;
    double g = dbToLin(-env) * mk; if (env > mx) mx = env;
    double l = L[i] * g, r = R[i] * g; if (clip) { l = fastTanh(l); r = fastTanh(r); }
    L[i] = (float)(L[i] * (1 - mix) + l * mix); R[i] = (float)(R[i] * (1 - mix) + r * mix);
  }
  grDb = env; grMax = jsMax(grMax, mx);
}

// ---------------------------------------------------------------------------------------------- Channel EQ
void ChannelEq::upd() {
  Biquad *a = b[0];
  a[0].highpass(sr, 80, 0.707); a[1].lowShelf(sr, 100, 0.7, clamp(p[1], -15, 15)); a[2].peaking(sr, p[3], 0.9, clamp(p[2], -12, 12));
  if (p[4] >= 0) a[3].highShelf(sr, 6000, 0.7, p[4]); else a[3].lowpass(sr, 20000 * std::pow(2, p[4] / 3), 0.707);
  for (int k = 0; k < 4; k++) b[1][k].copy(b[0][k]);
}
void ChannelEq::process(float* L, float* R, int n) {
  bool hpOn = p[0] > 0.5; double g = dbToLin(p[5]);
  for (int i = 0; i < n; i++) {
    double l = L[i], r = R[i]; if (hpOn) { l = b[0][0].process(l); r = b[1][0].process(r); }
    for (int k = 1; k < 4; k++) { l = b[0][k].process(l); r = b[1][k].process(r); }
    L[i] = (float)(l * g); R[i] = (float)(r * g);
  }
}

}  // namespace mdaw
