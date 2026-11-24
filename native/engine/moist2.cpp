// Moisture (instrument 37): Serum-style wavetable synthesizer, MobileDAW's own DSP (see moist2.h).
#include "moist2.h"
#include <cmath>
#include <cstring>
#include <vector>
#include <algorithm>

namespace mdaw {

namespace {

constexpr int TBL = 2048, LEVELS = 11, STRIDE = 4096, MAXF = 256, UNI = 16, POLY = 16, LFOS = 8, CTRL = 16;
constexpr double TAU = 6.283185307179586;
inline double clamp01(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
inline float fclamp(float v, float a, float b) { return v < a ? a : v > b ? b : v; }

// ---- wavetables: frames of 2048 points, 11 band-limited levels per frame (level L: 2048 >> L points, harmonics below (2048 >> L) / 2)
void fftc(std::vector<double>& re, std::vector<double>& im, bool inv) {
  size_t n = re.size(), j = 0;
  for (size_t i = 1; i < n; i++) { size_t bit = n >> 1; while (j & bit) { j ^= bit; bit >>= 1; } j |= bit; if (i < j) { std::swap(re[i], re[j]); std::swap(im[i], im[j]); } }
  for (size_t len = 2; len <= n; len <<= 1) {
    double ang = (inv ? 1 : -1) * TAU / (double)len, wr0 = std::cos(ang), wi0 = std::sin(ang);
    for (size_t s = 0; s < n; s += len) { double wr = 1, wi = 0;
      for (size_t k = 0; k < len / 2; k++) { size_t a = s + k, b = a + len / 2; double tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; double t = wr * wr0 - wi * wi0; wi = wr * wi0 + wi * wr0; wr = t; } }
  }
}
constexpr int offsetOf(int L) { int o = 0; for (int j = 0; j < L; j++) o += TBL >> j; return o; }
struct Table {
  int frames = 0; std::vector<float> d;   // frames x STRIDE
  // raw: frames x 2048 time-domain points
  void build(const std::vector<float>& raw, int nf) {
    frames = std::max(1, std::min(MAXF, nf)); d.assign((size_t)frames * STRIDE, 0.0f);
    std::vector<double> re(TBL), im(TBL), zr, zi; double peak = 0;
    for (int f = 0; f < frames; f++) {
      for (int i = 0; i < TBL; i++) { re[i] = raw[(size_t)f * TBL + i]; im[i] = 0; }
      fftc(re, im, false); re[0] = im[0] = 0;   // no DC
      for (int L = 0; L < LEVELS; L++) {
        int P = TBL >> L, H = P / 2 - 1; zr.assign(P, 0.0); zi.assign(P, 0.0);
        for (int h = 1; h <= H; h++) { zr[h] = re[h]; zi[h] = im[h]; zr[P - h] = re[TBL - h]; zi[P - h] = im[TBL - h]; }
        fftc(zr, zi, true);
        float* o = &d[(size_t)f * STRIDE + offsetOf(L)];
        for (int i = 0; i < P; i++) { o[i] = (float)(zr[i] / TBL); if (L == 0) peak = std::max(peak, std::fabs(zr[i] / TBL)); }
      }
    }
    if (peak > 1e-9) { float g = (float)(1.0 / peak); for (auto& x : d) x *= g; }
  }
  inline float at(int f, int L, double ph) const {
    const int P = TBL >> L; const float* t = &d[(size_t)f * STRIDE + offsetOf(L)];
    double x = ph * P; int i = (int)x; float fr = (float)(x - i); i &= P - 1; float a = t[i]; return a + (t[(i + 1) & (P - 1)] - a) * fr;
  }
  // frame position 0..1 (crossfade between neighbouring frames)
  inline float read(double pos, int L, double ph) const {
    if (frames <= 1) return at(0, L, ph);
    double x = clamp01(pos) * (frames - 1); int f = (int)x; float fr = (float)(x - f); if (f >= frames - 1) return at(frames - 1, L, ph);
    float a = at(f, L, ph); return fr > 0 ? a + (at(f + 1, L, ph) - a) * fr : a;
  }
};

// harmonic-built frame -> 2048 points
void additive(std::vector<float>& raw, int f, const double* amp, int H, const double* phs = nullptr) {
  for (int i = 0; i < TBL; i++) { double s = 0, t = (double)i / TBL; for (int h = 1; h <= H; h++) if (amp[h] != 0) s += amp[h] * std::sin(TAU * h * t + (phs ? phs[h] : 0)); raw[(size_t)f * TBL + i] = (float)s; }
}
const char* NAMES[M2_BUILTIN_TABLES] = { "Basic Shapes", "Analog Saw", "PWM", "Harmonic Sweep", "Formant Vowels", "Sync Saw", "Sine Fold", "Organ", "Square Sweep", "Digital Steps" };
Table BUILT[M2_BUILTIN_TABLES]; bool builtDone = false;
void buildBuiltins() {
  if (builtDone) return; builtDone = true;
  std::vector<float> raw; std::vector<double> a(200, 0.0);
  auto shape = [](int k, double t) { switch (k) { case 0: return std::sin(TAU * t); case 1: return t < 0.25 ? 4 * t : t < 0.75 ? 2 - 4 * t : 4 * t - 4; case 2: return 2 * t - 1; default: return t < 0.5 ? 1.0 : -1.0; } };
  { int nf = 64; raw.assign((size_t)nf * TBL, 0); for (int f = 0; f < nf; f++) { double x = f / (double)(nf - 1) * 3; int k = std::min(2, (int)x); double fr = x - k;   // sine -> triangle -> saw -> square
      for (int i = 0; i < TBL; i++) { double t = (double)i / TBL; raw[(size_t)f * TBL + i] = (float)((1 - fr) * shape(k, t) + fr * shape(k + 1, t)); } } BUILT[0].build(raw, nf); }
  { int nf = 64; raw.assign((size_t)nf * TBL, 0); for (int f = 0; f < nf; f++) { double cut = 2 + std::pow(f / (double)(nf - 1), 2) * 180; std::fill(a.begin(), a.end(), 0.0);   // saw through a closing low-pass
      for (int h = 1; h < 200; h++) a[h] = (1.0 / h) / std::sqrt(1 + std::pow(h / cut, 4)); additive(raw, f, a.data(), 199); } BUILT[1].build(raw, nf); }
  { int nf = 64; raw.assign((size_t)nf * TBL, 0); for (int f = 0; f < nf; f++) { double w = 0.5 - 0.47 * f / (nf - 1); for (int i = 0; i < TBL; i++) raw[(size_t)f * TBL + i] = (float)(((double)i / TBL < w ? 1.0 : -1.0) - (2 * w - 1)); } BUILT[2].build(raw, nf); }
  { int nf = 32; raw.assign((size_t)nf * TBL, 0); for (int f = 0; f < nf; f++) { std::fill(a.begin(), a.end(), 0.0); a[1] = 0.5; a[f + 1] += 1; additive(raw, f, a.data(), 33); } BUILT[3].build(raw, nf); }
  { const double F[5][3] = { { 800, 1150, 2900 }, { 400, 1600, 2700 }, { 270, 2300, 3000 }, { 450, 800, 2830 }, { 325, 700, 2530 } };   // a e i o u at a 110 Hz voice
    int nf = 41; raw.assign((size_t)nf * TBL, 0); for (int f = 0; f < nf; f++) { double x = f / 10.0; int v = std::min(3, (int)x); double fr = x - v; std::fill(a.begin(), a.end(), 0.0);
      for (int h = 1; h < 120; h++) { double hz = 110.0 * h, s = 0; for (int q = 0; q < 3; q++) { double c = F[v][q] * (1 - fr) + F[v + 1][q] * fr, bw = 80 + c * 0.08; s += std::exp(-0.5 * std::pow((hz - c) / bw, 2)) / (q + 1); } a[h] = s / std::sqrt(h); }
      additive(raw, f, a.data(), 119); } BUILT[4].build(raw, nf); }
  { int nf = 64; raw.assign((size_t)nf * TBL, 0); for (int f = 0; f < nf; f++) { double r = 1 + 7.0 * f / (nf - 1); for (int i = 0; i < TBL; i++) { double t = (double)i / TBL, s = std::fmod(t * r, 1.0); raw[(size_t)f * TBL + i] = (float)((2 * s - 1) * (1 - t * 0.3)); } } BUILT[5].build(raw, nf); }
  { int nf = 64; raw.assign((size_t)nf * TBL, 0); for (int f = 0; f < nf; f++) { double g = 1 + 7.0 * f / (nf - 1); for (int i = 0; i < TBL; i++) raw[(size_t)f * TBL + i] = (float)std::sin(g * std::sin(TAU * i / TBL)); } BUILT[6].build(raw, nf); }
  { const double D[6][9] = { { 8, 8, 8, 0, 0, 0, 0, 0, 0 }, { 8, 8, 8, 8, 8, 8, 8, 8, 8 }, { 0, 0, 8, 6, 0, 0, 0, 0, 0 }, { 8, 3, 8, 0, 0, 0, 0, 0, 8 }, { 6, 8, 8, 6, 0, 0, 0, 0, 0 }, { 8, 0, 0, 0, 0, 0, 0, 0, 8 } };
    const int HN[9] = { 1, 3, 2, 4, 6, 8, 10, 12, 16 };   // drawbar harmonics 16' 5 1/3' 8' 4' 2 2/3' 2' 1 3/5' 1 1/3' 1' (on an 8' fundamental: the 16' = sub, kept as 1)
    int nf = 6; raw.assign((size_t)nf * TBL, 0); for (int f = 0; f < nf; f++) { std::fill(a.begin(), a.end(), 0.0); for (int q = 0; q < 9; q++) a[HN[q]] += D[f][q] / 8.0; additive(raw, f, a.data(), 17); } BUILT[7].build(raw, nf); }
  { int nf = 64; raw.assign((size_t)nf * TBL, 0); for (int f = 0; f < nf; f++) { double cut = 1 + std::pow(f / (double)(nf - 1), 2) * 150; std::fill(a.begin(), a.end(), 0.0);
      for (int h = 1; h < 200; h += 2) a[h] = (1.0 / h) / std::sqrt(1 + std::pow(h / cut, 4)); additive(raw, f, a.data(), 199); } BUILT[8].build(raw, nf); }
  { int nf = 32; raw.assign((size_t)nf * TBL, 0); for (int f = 0; f < nf; f++) { double steps = 2 + f; for (int i = 0; i < TBL; i++) raw[(size_t)f * TBL + i] = (float)(std::floor(std::sin(TAU * i / TBL) * steps) / steps); } BUILT[9].build(raw, nf); }
}

// ---- laws (MobileDAW's approximations of Serum's published ranges)
inline double envTime(double v) { return 32.0 * std::pow(clamp01(v), 5); }           // 0..32 s (0.11 -> 0.5 ms, 0.5 -> 1 s, 0.215 -> 15 ms)
inline double cutoffHz(double v) { return 8.0 * std::pow(2756.25, clamp01(v)); }       // 8 Hz .. 22.05 kHz (0.5 -> 420 Hz)
inline double volGain(double v) { v = clamp01(v); return v * v; }
inline double lfoHz(double v) { return std::pow(2.0, -6 + 13 * clamp01(v)); }           // free: 0.016 .. 128 Hz
inline double lfoBeats(double v) { return 4.0 * std::pow(2.0, 3 - std::round(10 * clamp01(v))); }   // sync: 8 bars .. 1/128 (0.5 -> 1/4 note)
inline int idxOf(double v, int n) { return std::max(0, std::min(n - 1, (int)std::lround(clamp01(v) * (n - 1)))); }

// ---- Cytomic SVF
struct Svf { double ic1 = 0, ic2 = 0;
  inline void run(double x, double g, double k, double& lp, double& bp, double& hp) { double a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2, v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2; lp = v2; bp = v1; hp = x - k * v1 - v2; }
  void reset() { ic1 = ic2 = 0; } };
// filter type (Serum's Normal list order for the first 18; the rest play as Low 12): kind 0 LP 1 HP 2 BP 3 Peak 4 Notch, poles 1..4, mg = Moog-like drive
struct FType { int kind, poles; bool mg; };
inline FType ftype(double v) { int i = idxOf(v, 96); static const FType T[18] = { { 0, 1, true }, { 0, 2, true }, { 0, 3, true }, { 0, 4, true }, { 0, 1, false }, { 0, 2, false }, { 0, 3, false }, { 0, 4, false },
    { 1, 1, false }, { 1, 2, false }, { 1, 3, false }, { 1, 4, false }, { 2, 2, false }, { 2, 4, false }, { 3, 2, false }, { 3, 4, false }, { 4, 2, false }, { 4, 4, false } }; return i < 18 ? T[i] : FType{ 0, 2, false }; }
struct VFilt { Svf a, b; double op = 0;
  double run(double x, const FType& t, double g, double k, double opc) {
    double lp, bp, hp, out;
    if (t.poles == 1) { op += opc * (x - op); return t.kind == 1 ? x - op : op; }
    a.run(x, g, k, lp, bp, hp);
    out = t.kind == 0 ? lp : t.kind == 1 ? hp : t.kind == 2 ? bp * k : t.kind == 3 ? x + bp * k * 2.0 : x - bp * k;
    if (t.poles >= 3) { if (t.poles == 3) { op += opc * (out - op); out = t.kind == 1 ? out - op : op; } else { b.run(out, g, k, lp, bp, hp); out = t.kind == 0 ? lp : t.kind == 1 ? hp : t.kind == 2 ? bp * k : t.kind == 3 ? out + bp * k * 2.0 : out - bp * k; } }
    return out; }
  void reset() { a.reset(); b.reset(); op = 0; } };

struct Env { int st = 4; double lv = 0, t = 0, from = 0;   // 0 attack 1 hold 2 decay 3 sustain 4 off 5 release
  void on() { st = 0; t = 0; from = lv; } void off() { if (st < 4) { st = 5; t = 0; from = lv; } }
  inline double tick(double dt, double A, double Hd, double D, double S, double R, double ca, double cd, double cr) {
    auto curve = [](double x, double c) { double e = std::pow(2.0, (c - 0.5) * 8); return std::pow(x, e); };
    switch (st) {
      case 0: if (A <= 1e-5) { lv = 1; st = 1; t = 0; break; } t += dt; lv = from + (1 - from) * curve(std::min(1.0, t / A), 1 - ca); if (t >= A) { st = 1; t = 0; lv = 1; } break;
      case 1: t += dt; lv = 1; if (t >= Hd) { st = 2; t = 0; } break;
      case 2: t += dt; if (D <= 1e-5) { lv = S; st = 3; break; } lv = S + (1 - S) * (1 - curve(std::min(1.0, t / D), 1 - cd)); if (t >= D) { lv = S; st = 3; } break;
      case 3: lv = S; break;
      case 5: t += dt; if (R <= 1e-5) { lv = 0; st = 4; break; } lv = from * (1 - curve(std::min(1.0, t / R), 1 - cr)); if (t >= R) { lv = 0; st = 4; } break;
      default: lv = 0; }
    return lv; } };

// warp modes (MobileDAW's list): index = round(value x (N - 1))
constexpr int WARPS = 22;
enum { W_OFF, W_WSYNC, W_SYNC, W_BENDP, W_BENDM, W_BENDPM, W_PWM, W_ASYMP, W_ASYMM, W_ASYMPM, W_FLIP, W_MIRROR, W_REMAP1, W_REMAP2, W_REMAP3, W_REMAP4, W_QUANT, W_FM, W_AM, W_RM, W_FMN, W_ODD };
inline double warpPhase(int m, double p, double w) {
  switch (m) {
    case W_SYNC: case W_WSYNC: return std::fmod(p * (1 + 15 * w), 1.0);
    case W_BENDP: case W_REMAP1: return std::pow(p, 1 + 4 * w);
    case W_BENDM: case W_REMAP2: return 1 - std::pow(1 - p, 1 + 4 * w);
    case W_BENDPM: case W_REMAP3: return p < 0.5 ? 0.5 * std::pow(2 * p, 1 + 4 * w) : 1 - 0.5 * std::pow(2 - 2 * p, 1 + 4 * w);
    case W_PWM: { double e = 0.5 + 0.49 * w; return p < e ? 0.5 * p / e : 0.5 + 0.5 * (p - e) / (1 - e); }
    case W_ASYMP: return std::min(1.0, p * (1 + 3 * w));
    case W_ASYMM: return std::max(0.0, 1 - (1 - p) * (1 + 3 * w));
    case W_ASYMPM: case W_REMAP4: { double q = p * (1 + 3 * w); return q >= 1 ? std::fmod(q, 1.0) : q; }
    case W_MIRROR: { double m2 = p < 0.5 ? 2 * p : 2 - 2 * p; return p + (m2 - p) * w; }
    case W_ODD: return p < 0.5 ? 2 * p : 0;
    default: return p;
  }
}

struct Voice {
  bool on = false, rel = false; int note = 0, age = 0; double vel = 0, freq = 0, target = 0, rnd = 0;
  Env env[3]; double lph[LFOS] = {}, lval[LFOS] = {}, lsh[LFOS] = {};
  double phA[UNI] = {}, phB[UNI] = {}, phS = 0; float nlp[2] = {}, lastB = 0;
  VFilt fl[2]; double mod[M2_PARAMS] = {}; bool modOn = false; int cnt = 0; uint32_t seed = 1;
  // control-rate values
  double gA = 0, gB = 0, gS = 0, gN = 0, posA = 0, posB = 0, warpA = 0, warpB = 0, detA = 0, detB = 0, blA = 0, blB = 0, panA = 0, panB = 0, panS = 0, panN = 0;
  double stA = 0, stB = 0, cut = 0, res = 0, drv = 0, fmix = 1, master = 0;
};

// ---- effects (global)
struct DLine { std::vector<float> b; int w = 0; void init(int n) { b.assign(n, 0.0f); w = 0; } inline void push(float x) { b[w] = x; w = (w + 1) % (int)b.size(); }
  inline float tap(double d) const { int n = (int)b.size(); double r = w - 1 - d; while (r < 0) r += n; int i = (int)r; float f = (float)(r - i); float a = b[i % n], c = b[(i + 1) % n]; return a + (c - a) * f; } };
struct OnePole { double z = 0; inline double lp(double x, double c) { z += c * (x - z); return z; } };
struct Biquad { double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
  void set(int type, double f, double q, double db, double sr) {   // 0 low shelf 1 peak 2 high shelf 3 high-pass 4 low-pass
    double A = std::pow(10, db / 40), w = TAU * std::min(f, sr * 0.45) / sr, cs = std::cos(w), sn = std::sin(w), al = sn / (2 * std::max(0.1, q)), a0;
    if (type == 1) { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
    else if (type == 0) { double sq = 2 * std::sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * cs + sq); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - sq); a0 = (A + 1) + (A - 1) * cs + sq; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - sq; }
    else if (type == 2) { double sq = 2 * std::sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cs + sq); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - sq); a0 = (A + 1) - (A - 1) * cs + sq; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - sq; }
    else if (type == 3) { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0; }
  inline double run(double x) { double y = b0 * x + z1; z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; return y; } };

class Moist2 : public Instrument {
 public:
  Moist2(double sr, Bank* b) : sr(sr), bank(b) {
    buildBuiltins();
    for (int i = 0; i < M2_PARAMS; i++) p[i] = 0;
    static const double DEF[299] = { 0.699999988, 0.75, 0.5, 0.5, 0.5, 0.5, 0, 0.5, 0.75, 0, 0.5, 0, 1, 0.5, 0.75, 0.5, 0.5, 0.5, 0.5, 0, 0.5, 0.75, 0, 0.5, 0, 1, 0.5, 0.25, 0.5, 0.5, 0.5, 0, 0, 0.75, 0.5, 0.109999999, 0, 0.5, 1, 0.215000004, 1, 0, 0, 0, 0.010526316, 0.5, 0.100000001, 0, 0, 1, 0.5, 0.109999999, 0, 0.5, 1, 0.215000004, 0.109999999, 0, 0.5, 1, 0.215000004, 0.5, 0.5, 0.5, 0.5, 0, 0.5, 0, 0, 0.251188993, 0.251188993, 0.400000006, 0.600000024, 0.600000024, 0.400000006, 0.600000024, 0.600000024, 0.400000006, 0.600000024, 0.600000024, 0.5, 0.200000003, 0.349999994, 0.349999994, 0, 0.25, 0.349999994, 0.200000003, 0.333000004, 0.666000009, 0.600000024, 0.600000024, 0.5, 0.5, 0, 0, 1, 0.25, 0, 0, 0.5, 0.5, 0, 1, 0, 0.25, 1, 0.5, 0.5, 1, 0, 0.25, 0.5, 0.5, 0.800000012, 0.5, 0.5, 0, 0.25, 0.5, 0, 1, 0.100000001, 0.5, 0.300000012, 0.5, 0.800000012, 1, 0, 0.625, 0.625, 0, 0.400000006, 0.5, 0.5, 0.5, 0.75, 0.300000012, 0.300000012, 0, 0, 1, 0, 0.5, 0, 0, 0, 0.5, 0.400000006, 0.25, 0.5, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0.540799975, 0.459100008, 0, 0, 0, 0.5, 1, 1, 0.5, 0.5, 0.5, 0.5, 0, 0, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0, 0.5, 1, 0.5, 0.5, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5 };   // Serum 1.3x init values (normalized), mod amounts bipolar (0.5 = 0)
    for (int i = 0; i < 299; i++) p[i] = DEF[i];
    p[M2_TBL_A] = 0; p[M2_TBL_B] = 0; p[M2_SMP_A] = p[M2_SMP_B] = -1; p[M2_VOICES] = 8; p[M2_MONO] = 0; p[M2_LEGATO] = 0;
    for (int k = 0; k < LFOS; k++) { p[M2_LFO_SHAPE + k] = 1; p[M2_LFO_SYNC + k] = 1; p[M2_LFO_MODE + k] = 0; }
    for (int k = 0; k < M2_ROUTES; k++) { p[M2_ROUTE + 2 * k] = 0; p[M2_ROUTE + 2 * k + 1] = -1; }
    bufL.assign(4096, 0); bufR.assign(4096, 0);
    int D = (int)(sr * 2.2) + 8; dly[0].init(D); dly[1].init(D);
    int C = (int)(sr * 0.06) + 8; for (int c = 0; c < 2; c++) { cho[c].init(C); flg[c].init(C); dim[c].init(C); for (int h = 0; h < 8; h++) hyp[h][c].init(C); }
    static const int CM[8] = { 1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617 }, AP[4] = { 556, 441, 341, 225 };
    double sc = sr / 44100.0; for (int c = 0; c < 2; c++) { for (int k = 0; k < 8; k++) { comb[c][k].init((int)((CM[k] + c * 23) * sc * 1.6) + 4); combS[c][k] = 0; } for (int k = 0; k < 4; k++) ap[c][k].init((int)((AP[k] + c * 23) * sc) + 4); pre[c].init((int)(sr * 0.25) + 8); }
    tblA = &BUILT[0]; tblB = &BUILT[0];
  }
  void setTempo(double b) override { bpm = b > 0 ? b : 120; }
  void setMod(double v) override { wheel = v; }
  bool hasSetBend() override { return true; }
  void setBend(double st) override { bendSt = st; slideSt = 0; }
  void setBendSl(double st, double sl) override { bendSt = st; slideSt = std::isfinite(sl) ? sl : 0; }   // slide notes: exact semitones, not scaled by Bend Up / Down
  void setParam(int i, double v) override {
    if (i < 0 || i >= M2_PARAMS) return;
    if (i == M2_SMP_A || i == M2_SMP_B) { p[i] = v; loadCustom(i == M2_SMP_A ? 0 : 1, (int)v); return; }
    p[i] = v;
    if (i == M2_TBL_A) tblA = custom[0].frames && p[M2_SMP_A] >= 0 ? &custom[0] : &BUILT[std::max(0, std::min(M2_BUILTIN_TABLES - 1, (int)v))];
    if (i == M2_TBL_B) tblB = custom[1].frames && p[M2_SMP_B] >= 0 ? &custom[1] : &BUILT[std::max(0, std::min(M2_BUILTIN_TABLES - 1, (int)v))];
  }
  void loadCustom(int o, int id) {
    Table& t = custom[o]; const Sample* s = id >= 0 && id < 256 && bank ? bank->s[id] : nullptr;
    if (s && s->frames >= TBL) { int nf = std::min(MAXF, s->frames / TBL); std::vector<float> raw((size_t)nf * TBL); std::memcpy(raw.data(), s->l, raw.size() * sizeof(float)); t.build(raw, nf); }
    else t.frames = 0;
    const Table*& dst = o ? tblB : tblA; dst = t.frames ? &t : &BUILT[std::max(0, std::min(M2_BUILTIN_TABLES - 1, (int)p[o ? M2_TBL_B : M2_TBL_A]))];
  }
  void noteOn(int pitch, double vel) override {
    bool mono = p[M2_MONO] > 0.5; int maxv = std::max(1, std::min(POLY, (int)p[M2_VOICES]));
    double f = 440.0 * std::pow(2.0, (pitch - 69) / 12.0);
    held[pitch & 127] = 1; heldOrder[pitch & 127] = ++clock;
    if (mono) { Voice& v = voices[0]; bool legato = v.on && !v.rel && p[M2_LEGATO] > 0.5; v.note = pitch; v.target = f; if (!(v.on && !v.rel) || p[65] <= 0) v.freq = f; if (!legato) start(v, pitch, vel, f, true); return; }
    int n = 0, pick = -1, oldest = 1 << 30; for (int k = 0; k < POLY; k++) if (voices[k].on) n++;
    for (int k = 0; k < POLY; k++) if (!voices[k].on) { pick = k; break; }
    if (pick < 0 || n >= maxv) { pick = -1; for (int k = 0; k < POLY; k++) if (voices[k].on && voices[k].rel && voices[k].age < oldest) { oldest = voices[k].age; pick = k; }
      if (pick < 0) for (int k = 0; k < POLY; k++) if (voices[k].on && voices[k].age < oldest) { oldest = voices[k].age; pick = k; } }
    if (pick < 0) pick = 0;
    Voice& v = voices[pick]; double from = lastFreq > 0 && p[65] > 0 ? lastFreq : f; v.target = f; v.freq = from; start(v, pitch, vel, f, false); lastFreq = f;
  }
  void start(Voice& v, int pitch, double vel, double f, bool mono) {
    (void)f; (void)mono; v.on = true; v.rel = false; v.note = pitch; v.vel = vel; v.age = ++clock; v.seed = 0x9e3779b9u * (uint32_t)(clock + 7);
    v.rnd = rnd(v); for (auto& e : v.env) e.on();
    for (int k = 0; k < LFOS; k++) { if ((int)p[M2_LFO_MODE + k] != 2) v.lph[k] = 0; v.lsh[k] = rnd(v) * 2 - 1; }
    for (int u = 0; u < UNI; u++) { v.phA[u] = std::fmod(p[13] + rnd(v) * clamp01(p[12]) , 1.0); v.phB[u] = std::fmod(p[26] + rnd(v) * clamp01(p[25]), 1.0); }
    v.phS = 0; v.cnt = 0; v.fl[0].reset(); v.fl[1].reset();
  }
  void noteOff(int pitch) override {
    held[pitch & 127] = 0;
    if (p[M2_MONO] > 0.5) { Voice& v = voices[0]; if (v.on && v.note == pitch) { int best = -1; unsigned bo = 0; for (int k = 0; k < 128; k++) if (held[k] && heldOrder[k] > bo) { bo = heldOrder[k]; best = k; }
        if (best >= 0) { v.note = best; v.target = 440.0 * std::pow(2.0, (best - 69) / 12.0); } else { v.rel = true; for (auto& e : v.env) e.off(); } } return; }
    for (auto& v : voices) if (v.on && !v.rel && v.note == pitch) { v.rel = true; for (auto& e : v.env) e.off(); }
  }
  bool active() override { for (auto& v : voices) if (v.on) return true; return fxTail > 0; }
  void allOff() override { for (auto& v : voices) { v.on = false; v.rel = false; } std::memset(held, 0, sizeof held); fxTail = 0; }
  int voicesOn() override { int n = 0; for (auto& v : voices) if (v.on) n++; return n; }

  void render(float* L, float* R, int a, int b) override {
    for (int s = a; s < b;) { int n = std::min(b - s, 128); renderBlock(L + s, R + s, n); s += n; }
  }

 private:
  double sr, bpm = 120, wheel = 0, bendSt = 0, slideSt = 0, lastFreq = 0; Bank* bank;
  double p[M2_PARAMS];
  Voice voices[POLY]; unsigned char held[128] = {}; unsigned heldOrder[128] = {}; unsigned clock = 0;
  Table custom[2]; const Table* tblA = nullptr; const Table* tblB = nullptr;
  std::vector<float> bufL, bufR; int fxTail = 0; uint32_t gseed = 12345;
  // effect state
  DLine dly[2], cho[2], flg[2], dim[2], hyp[8][2], comb[2][8], ap[2][4], pre[2]; double combS[2][8]; OnePole dlyLp[2], dlyHp[2], choLp[2], revLo[2], revHi[2];
  double lfoFx[4] = {}; double apz[2][6] = {}, phFb[2] = {}, flFb[2] = {}, choFb[2] = {}, compEnv = 0, dsHold[2] = {}; int dsCnt = 0; Biquad eqL[2], eqH[2]; VFilt fxf[2];
  static double rnd(Voice& v) { v.seed = v.seed * 1664525u + 1013904223u; return (v.seed >> 8) / 16777216.0; }
  inline double P(const Voice& v, int i) const { return v.modOn ? clamp01(p[i] + v.mod[i]) : p[i]; }

  double srcVal(Voice& v, int s) {
    switch (s) {
      case 1: case 2: case 3: return v.env[s - 1].lv;
      case 4: case 5: case 6: case 7: case 8: case 9: case 10: case 11: return v.lval[s - 4];
      case 12: return v.vel; case 13: return (v.note - 60) / 64.0; case 14: return std::max(wheel, p[217]);
      case 15: case 16: case 17: case 18: return p[218 + s - 15];
      case 19: return bendSt / 12.0; case 20: return v.rnd * 2 - 1;
      default: return 0;
    }
  }
  double lfoShape(int sh, double ph, double sv) {
    switch (sh) { case 0: return std::sin(TAU * ph); case 1: return ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4; case 2: return 2 * ph - 1; case 3: return 1 - 2 * ph; case 4: return ph < 0.5 ? 1 : -1; case 5: return sv; default: return std::sin(TAU * ph); }
  }
  void control(Voice& v, double dt) {
    // LFOs (rates 61..64, 260..263; rise 273..280, delay 281..288)
    for (int k = 0; k < LFOS; k++) {
      double rv = k < 4 ? p[61 + k] : p[260 + k - 4], hz = p[M2_LFO_SYNC + k] > 0.5 ? bpm / 60.0 / lfoBeats(rv) : lfoHz(rv);
      double old = v.lph[k]; v.lph[k] += hz * dt; bool wrap = v.lph[k] >= 1; if (wrap) { if ((int)p[M2_LFO_MODE + k] == 1) v.lph[k] = 1; else v.lph[k] -= std::floor(v.lph[k]); v.lsh[k] = rnd(v) * 2 - 1; }
      (void)old; v.lval[k] = lfoShape((int)p[M2_LFO_SHAPE + k], std::min(0.999999, v.lph[k]), v.lsh[k]);
    }
    // routes
    v.modOn = false;
    for (int k = 0; k < M2_ROUTES; k++) { int s = (int)p[M2_ROUTE + 2 * k], d = (int)p[M2_ROUTE + 2 * k + 1]; if (s <= 0 || d < 0 || d >= 299) continue;
      if (!v.modOn) { std::memset(v.mod, 0, sizeof(double) * 299); v.modOn = true; }
      int b0 = k < 16 ? 180 + 2 * k : 228 + 2 * (k - 16); v.mod[d] += (p[b0] * 2 - 1) * clamp01(p[b0 + 1]) * srcVal(v, s); }
    // per-voice values
    v.gA = p[212] > 0.5 ? volGain(P(v, 1)) : 0; v.gB = p[213] > 0.5 ? volGain(P(v, 14)) : 0; v.gS = p[215] > 0.5 ? volGain(P(v, 33)) : 0; v.gN = p[214] > 0.5 ? volGain(P(v, 27)) : 0;
    v.posA = P(v, 11); v.posB = P(v, 24); v.warpA = P(v, 9); v.warpB = P(v, 22); v.detA = P(v, 7); v.detB = P(v, 20); v.blA = P(v, 8); v.blB = P(v, 21);
    v.panA = P(v, 2) * 2 - 1; v.panB = P(v, 15) * 2 - 1; v.panS = P(v, 34) * 2 - 1; v.panN = P(v, 30) * 2 - 1;
    v.stA = std::round(P(v, 3) * 8 - 4) * 12 + std::round(P(v, 4) * 24 - 12) + (P(v, 5) * 200 - 100) / 100 + (P(v, 10) - 0.5) * 96;
    v.stB = std::round(P(v, 16) * 8 - 4) * 12 + std::round(P(v, 17) * 24 - 12) + (P(v, 18) * 200 - 100) / 100 + (P(v, 23) - 0.5) * 96;
    v.cut = P(v, 45); v.res = P(v, 46); v.drv = P(v, 47); v.fmix = P(v, 49); v.master = volGain(P(v, 0)) * 2.0;
  }
  inline int level(double hz) const { double h = sr * 0.5 / std::max(1.0, hz); int L = 0; while (L < LEVELS - 1 && (TBL >> L) / 2 - 1 > h) L++; return L; }

  void renderBlock(float* L, float* R, int n) {
    std::fill(bufL.begin(), bufL.begin() + n, 0.0f); std::fill(bufR.begin(), bufR.begin() + n, 0.0f);
    const double dt = 1.0 / sr, bendR0 = bendSt >= 0 ? bendSt * (std::round(p[166] * 48 - 24)) / 2.0 : -bendSt * (std::round(p[167] * 48 - 24)) / 2.0, bendR = bendR0 + slideSt;   // the engine's ±2 st wheel scaled to Bend Up / Down
    const int nA = std::max(1, (int)std::lround(p[6] * 16)), nB = std::max(1, (int)std::lround(p[19] * 16));
    const int wmA = idxOf(p[168], WARPS), wmB = idxOf(p[169], WARPS), subSh = idxOf(p[170], 6); const double subOct = std::round(p[171] * 8 - 4);
    const FType ft = ftype(p[44]); const bool filtOn = p[216] > 0.5, toF[4] = { p[40] > 0.5, p[41] > 0.5, p[42] > 0.5, p[43] > 0.5 };
    const double porta = 10 * std::pow(clamp01(p[65]), 3), glideC = porta > 0 ? 1 - std::exp(-dt / (porta * 0.33)) : 1;
    const double uLR[2] = { p[172], p[173] }, uWT[2] = { p[176] * 2 - 1, p[177] * 2 - 1 }, stereoF = (p[50] - 0.5) * 2;
    const double nCut = 200 * std::pow(100.0, p[28]), nC = 1 - std::exp(-TAU * std::min(nCut, sr * 0.45) / sr);
    const bool trackA = p[164] > 0.5, trackB = p[165] > 0.5;
    for (auto& v : voices) {
      if (!v.on) continue;
      for (int i = 0; i < n; i++) {
        if (v.cnt-- <= 0) { control(v, dt * CTRL); v.cnt = CTRL - 1; }
        v.freq += (v.target - v.freq) * glideC;
        // envelopes (Env1 amp; 2, 3 for modulation)
        double e1 = v.env[0].tick(dt, envTime(p[35]), envTime(p[36]), envTime(p[37]), clamp01(p[38]), envTime(p[39]), p[71], p[72], p[73]);
        v.env[1].tick(dt, envTime(p[51]), envTime(p[52]), envTime(p[53]), clamp01(p[54]), envTime(p[55]), p[74], p[75], p[76]);
        v.env[2].tick(dt, envTime(p[56]), envTime(p[57]), envTime(p[58]), clamp01(p[59]), envTime(p[60]), p[77], p[78], p[79]);
        if (v.rel && v.env[0].st == 4) { v.on = false; break; }
        double base = v.freq * std::pow(2.0, bendR / 12.0);
        double fA = (trackA ? base : 261.6256) * std::pow(2.0, v.stA / 12.0), fB = (trackB ? base : 261.6256) * std::pow(2.0, v.stB / 12.0);
        double fl[2] = { 0, 0 }, dr[2] = { 0, 0 };   // to the filter / around it
        // osc B first (A can warp with B)
        float bOut = 0;
        if (v.gB > 0) { int Lv = level(fB); double sumL = 0, sumR = 0;
          for (int u = 0; u < nB; u++) { double sp = nB == 1 ? 0 : 2.0 * u / (nB - 1) - 1, f = fB * std::pow(2.0, sp * 50 * v.detB * v.detB / 1200.0);
            v.phB[u] += f * dt; v.phB[u] -= std::floor(v.phB[u]);
            double ph = warpPhase(wmB, v.phB[u], v.warpB), pos = clamp01(v.posB + sp * uWT[1] * 0.5);
            double x = tblB ? tblB->read(pos, Lv, ph) : 0; if (wmB == W_FLIP && v.phB[u] > 1 - v.warpB) x = -x; if (wmB == W_QUANT) { double q = std::pow(2.0, 16 - 15 * v.warpB); x = std::round(x * q) / q; }
            if (wmB == W_WSYNC) x *= std::sin(M_PI * v.phB[u]);
            double g = (nB == 1 || std::fabs(sp) < 0.01) ? 1.0 : v.blB * 1.33; if (u == 0) bOut = (float)x;
            double pan = std::max(-1.0, std::min(1.0, v.panB + sp * uLR[1])); sumL += x * g * (1 - pan) * 0.5 * 1.414; sumR += x * g * (1 + pan) * 0.5 * 1.414; }
          double nrm = 1.0 / std::sqrt((double)nB); int t = toF[1] ? 0 : 1; (t ? dr : fl)[0] += sumL * nrm * v.gB; (t ? dr : fl)[1] += sumR * nrm * v.gB; }
        if (v.gA > 0) { int Lv = level(fA); double sumL = 0, sumR = 0;
          for (int u = 0; u < nA; u++) { double sp = nA == 1 ? 0 : 2.0 * u / (nA - 1) - 1, f = fA * std::pow(2.0, sp * 50 * v.detA * v.detA / 1200.0);
            v.phA[u] += f * dt; v.phA[u] -= std::floor(v.phA[u]);
            double ph = v.phA[u];
            if (wmA == W_FM) { ph = std::fmod(ph + v.warpA * bOut * 2 + 4, 1.0); } else ph = warpPhase(wmA, ph, v.warpA);
            double pos = clamp01(v.posA + sp * uWT[0] * 0.5), x = tblA ? tblA->read(pos, Lv, ph) : 0;
            if (wmA == W_FLIP && v.phA[u] > 1 - v.warpA) x = -x; if (wmA == W_QUANT) { double q = std::pow(2.0, 16 - 15 * v.warpA); x = std::round(x * q) / q; }
            if (wmA == W_WSYNC) x *= std::sin(M_PI * v.phA[u]); if (wmA == W_AM) x *= (1 - v.warpA) + v.warpA * (bOut * 0.5 + 0.5); if (wmA == W_RM) x = x * (1 - v.warpA) + x * bOut * v.warpA;
            double g = (nA == 1 || std::fabs(sp) < 0.01) ? 1.0 : v.blA * 1.33, pan = std::max(-1.0, std::min(1.0, v.panA + sp * uLR[0]));
            sumL += x * g * (1 - pan) * 0.5 * 1.414; sumR += x * g * (1 + pan) * 0.5 * 1.414; }
          double nrm = 1.0 / std::sqrt((double)nA); int t = toF[0] ? 0 : 1; (t ? dr : fl)[0] += sumL * nrm * v.gA; (t ? dr : fl)[1] += sumR * nrm * v.gA; }
        if (v.gS > 0) { double fs = v.freq * std::pow(2.0, bendR / 12.0 + subOct); v.phS += fs * dt; v.phS -= std::floor(v.phS); double ph = v.phS, x;
          switch (subSh) { case 0: x = std::sin(TAU * ph); break; case 1: x = std::tanh(3 * std::sin(TAU * ph)) / std::tanh(3.0); break; case 2: x = ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4; break;
            case 3: x = 2 * ph - 1; break; case 4: x = ph < 0.5 ? 1 : -1; break; default: x = ph < 0.25 ? 1 : -1; }
          int t = toF[3] ? 0 : 1; (t ? dr : fl)[0] += x * v.gS * (1 - v.panS) * 0.707; (t ? dr : fl)[1] += x * v.gS * (1 + v.panS) * 0.707; }
        if (v.gN > 0) { for (int c = 0; c < 2; c++) { double w = rnd(v) * 2 - 1; v.nlp[c] += (float)(nC * (w - v.nlp[c])); }
          int t = toF[2] ? 0 : 1; (t ? dr : fl)[0] += v.nlp[0] * v.gN * (1 - v.panN) * 0.707; (t ? dr : fl)[1] += v.nlp[1] * v.gN * (1 + v.panN) * 0.707; }
        double out[2];
        for (int c = 0; c < 2; c++) {
          double x = fl[c];
          if (filtOn) { double fc = cutoffHz(v.cut) * std::pow(2.0, (c ? 1 : -1) * stereoF), g = std::tan(M_PI * std::min(fc, sr * 0.45) / sr), k = 2 - 1.97 * clamp01(v.res);
            double opc = 1 - std::exp(-TAU * std::min(fc, sr * 0.45) / sr), d = 1 + 9 * v.drv, xin = d > 1.001 || ft.mg ? std::tanh(x * d) / (ft.mg ? 1.0 : std::max(1.0, std::tanh(d))) : x;
            double y = v.fl[c].run(xin, ft, g, k, opc); x = x + (y - x) * v.fmix; }
          out[c] = (x + dr[c]) * e1 * v.master;
        }
        bufL[i] += (float)out[0]; bufR[i] += (float)out[1];
      }
    }
    effects(n);
    for (int i = 0; i < n; i++) { L[i] += bufL[i]; R[i] += bufR[i]; }
    bool any = false; for (auto& v : voices) if (v.on) any = true;
    if (any) fxTail = (int)(sr * 6); else fxTail = std::max(0, fxTail - n);
  }

  // ---- the effect rack: Hyper/Dimension, Distortion, Flanger, Phaser, Chorus, Delay, Compressor, Reverb, EQ, Filter (Serum's default order)
  double fxRate(double v) const { return 0.02 * std::pow(500.0, clamp01(v)); }   // 0.02 .. 10 Hz
  void effects(int n) {
    float* X[2] = { bufL.data(), bufR.data() };
    if (p[163] > 0.5) {   // Hyper (unison chorus) + Dimension
      int N = 1 + idxOf(p[150], 8); double wet = p[147], rate = fxRate(p[148]), dep = 0.0004 + 0.004 * p[149];
      for (int i = 0; i < n; i++) { lfoFx[0] += rate / sr; lfoFx[0] -= std::floor(lfoFx[0]);
        for (int c = 0; c < 2; c++) { double x = X[c][i], s = 0; for (int h = 0; h < N; h++) { hyp[h][c].push((float)x); double ph = lfoFx[0] + h / (double)N + c * 0.25, d = (0.006 + dep * (1 + std::sin(TAU * ph))) * sr; s += hyp[h][c].tap(d); }
          X[c][i] = (float)(x * (1 - wet) + s / std::sqrt((double)N) * wet); }
        if (p[153] > 0) { double l = X[0][i], r = X[1][i]; dim[0].push((float)l); dim[1].push((float)r); double d = (0.004 + 0.02 * p[152]) * sr, m = p[153]; X[0][i] = (float)(l + m * dim[1].tap(d) * 0.7); X[1][i] = (float)(r - m * dim[0].tap(d * 1.13) * 0.7); } }
    }
    if (p[154] > 0.5) {   // Distortion
      int mode = idxOf(p[99], 13); double drive = std::pow(10.0, p[97] * 30 / 20), wet = p[96];
      for (int i = 0; i < n; i++) for (int c = 0; c < 2; c++) { double x = X[c][i], y = x * drive;
        switch (mode) { case 0: y = std::tanh(y); break; case 1: y = y / (1 + std::fabs(y)) * 1.5; break; case 2: y = std::max(-1.0, std::min(1.0, y)); break; case 3: y = y > 0 ? std::tanh(y) : std::tanh(y * 0.3); break;
          case 4: y = y > 0 ? 1 - std::exp(-y) : -0.3 * (1 - std::exp(y)); break; case 5: { y = std::fmod(std::fabs(y + 1), 4.0); y = y > 2 ? 3 - y : y - 1; } break; case 6: y = std::sin(y * 1.5707963); break;
          case 7: y = y * y * (y > 0 ? 1 : -1); y = std::max(-1.0, std::min(1.0, y)); break;
          case 8: { if (c == 0 && --dsCnt <= 0) dsCnt = 1 + (int)(p[97] * 40); if (dsCnt == 1 + (int)(p[97] * 40)) dsHold[c] = x; y = dsHold[c]; } break;
          case 9: y = std::tanh(y + 0.3) - std::tanh(0.3); break; case 10: y = std::fabs(y) * 2 - 1; break; case 11: y = std::sin(y) * std::cos(y * 0.5); break; default: y = std::tanh(y * (y > 0 ? 1 : 0.5)); }
        X[c][i] = (float)(x * (1 - wet) + y * wet / std::max(1.0, std::sqrt(drive) * (mode == 8 ? drive : 1) * 0.5 + 0.5)); }
    }
    if (p[155] > 0.5) {   // Flanger
      double wet = p[103], rate = p[104] > 0.5 ? bpm / 60.0 / lfoBeats(p[105]) : fxRate(p[105]), dep = p[106], fb = (p[107] * 2 - 1) * 0.9, st = p[108] * 360;
      for (int i = 0; i < n; i++) { lfoFx[1] += rate / sr; lfoFx[1] -= std::floor(lfoFx[1]);
        for (int c = 0; c < 2; c++) { double ph = lfoFx[1] + (c ? st / 360.0 : 0), d = (0.0005 + 0.006 * dep * (0.5 + 0.5 * std::sin(TAU * ph))) * sr, x = X[c][i];
          double y = flg[c].tap(d); flg[c].push((float)(x + y * fb)); X[c][i] = (float)(x * (1 - wet * 0.5) + y * wet * 0.7); } }
    }
    if (p[156] > 0.5) {   // Phaser (6 all-pass stages)
      double wet = p[109], rate = p[110] > 0.5 ? bpm / 60.0 / lfoBeats(p[111]) : fxRate(p[111]), dep = p[112], fc0 = cutoffHz(p[113]), fb = p[114] * 0.95, st = p[115] / 360.0 * 360.0 / 360.0;
      for (int i = 0; i < n; i++) { lfoFx[2] += rate / sr; lfoFx[2] -= std::floor(lfoFx[2]);
        for (int c = 0; c < 2; c++) { double ph = lfoFx[2] + (c ? p[115] : 0), f = fc0 * std::pow(2.0, dep * 3 * std::sin(TAU * ph)), t = std::tan(M_PI * std::min(f, sr * 0.45) / sr), a = (t - 1) / (t + 1);
          double x = X[c][i] + phFb[c] * fb, y = x; for (int s = 0; s < 6; s++) { double z = apz[c][s], o = a * y + z; apz[c][s] = y - a * o; y = o; } phFb[c] = y; (void)st;
          X[c][i] = (float)(X[c][i] * (1 - wet * 0.5) + y * wet * 0.5); } }
    }
    if (p[157] > 0.5) {   // Chorus
      double wet = p[116], rate = p[117] > 0.5 ? bpm / 60.0 / lfoBeats(p[118]) : fxRate(p[118]), d1 = 0.0005 + 0.02 * p[119], d2 = 0.0005 + 0.02 * p[120], dep = 0.004 * p[121], fb = p[122] * 0.8, lc = 1 - std::exp(-TAU * cutoffHz(p[123]) / sr);
      for (int i = 0; i < n; i++) { lfoFx[3] += rate / sr; lfoFx[3] -= std::floor(lfoFx[3]);
        for (int c = 0; c < 2; c++) { double s = std::sin(TAU * (lfoFx[3] + c * 0.25)), y = 0.5 * (cho[c].tap((d1 + dep * (1 + s)) * sr) + cho[c].tap((d2 + dep * (1 - s)) * sr)); y = choLp[c].lp(y, lc);
          cho[c].push((float)(X[c][i] + y * fb)); X[c][i] = (float)(X[c][i] * (1 - wet * 0.5) + y * wet); } }
    }
    if (p[158] > 0.5) {   // Delay (tempo-synced by default, link, ping-pong, band-limited feedback)
      auto tim = [&](double v) { return p[127] > 0.5 ? std::pow(2.0, std::round(clamp01(v) * 8) - 6) * 60.0 / bpm : 0.001 + 1.0 * v * v; };
      double tl = tim(p[129]) * (1 + (p[133] - 0.5) * 0.4), tr = (p[128] > 0.5 ? tim(p[129]) : tim(p[130])) * (1 + (p[134] - 0.5) * 0.4);
      double wet = p[124], fb = p[132] * 0.95, fc = 100 * std::pow(100.0, p[125]), bw = 0.8 + 7.4 * clamp01(p[126]);
      double hc = 1 - std::exp(-TAU * std::min(sr * 0.45, fc * std::pow(2.0, bw / 2)) / sr), lc = 1 - std::exp(-TAU * std::max(10.0, fc / std::pow(2.0, bw / 2)) / sr); bool pp = idxOf(p[131], 3) == 1;
      for (int i = 0; i < n; i++) { double yl = dly[0].tap(tl * sr), yr = dly[1].tap(tr * sr);
        yl = dlyLp[0].lp(yl, hc); yl -= dlyHp[0].lp(yl, lc); yr = dlyLp[1].lp(yr, hc); yr -= dlyHp[1].lp(yr, lc);
        double il = X[0][i], ir = X[1][i]; if (pp) { dly[0].push((float)((il + ir) * 0.5 + yr * fb)); dly[1].push((float)(yl * fb)); } else { dly[0].push((float)(il + yl * fb)); dly[1].push((float)(ir + yr * fb)); }
        X[0][i] = (float)(il + yl * wet); X[1][i] = (float)(ir + yr * wet); }
    }
    if (p[159] > 0.5) {   // Compressor
      double thr = -60 + 60 * p[135], ratio = 1 + 3 * std::pow(p[136] / 0.75, 2), at = 1 - std::exp(-1 / ((0.0001 + 0.1 * p[137] * p[137]) * sr)), rl = 1 - std::exp(-1 / ((0.01 + 1.0 * p[138] * p[138]) * sr)), mk = std::pow(10.0, (p[139] * 30 + std::max(0.0, -thr) * (1 - 1 / ratio) * 0.7) / 20), wet = p[269];   // + automatic make-up (most of the gain reduction a full-scale signal gets)
      for (int i = 0; i < n; i++) { double lv = std::max(std::fabs(X[0][i]), std::fabs(X[1][i])), db = 20 * std::log10(lv + 1e-9); compEnv += (db > compEnv ? at : rl) * (db - compEnv);
        double over = compEnv - thr, g = over > 0 ? std::pow(10.0, -over * (1 - 1 / ratio) / 20) : 1;
        for (int c = 0; c < 2; c++) X[c][i] = (float)(X[c][i] * (1 - wet) + X[c][i] * g * mk * wet); }
    }
    if (p[160] > 0.5) {   // Reverb (Schroeder / Freeverb-style network)
      double wet = p[81], fbk = 0.7 + 0.28 * p[82], damp = p[85], pd = 0.2 * p[83] * sr, lo = 1 - std::exp(-TAU * (20 + 2000 * p[84] * p[84]) / sr), hi = 1 - std::exp(-TAU * (200 * std::pow(100.0, p[86])) / sr), wd = p[87];
      for (int i = 0; i < n; i++) { double in = (X[0][i] + X[1][i]) * 0.5, o[2];
        for (int c = 0; c < 2; c++) { pre[c].push((float)in); double x = pre[c].tap(std::max(1.0, pd)) * 0.015, s = 0;
          for (int k = 0; k < 8; k++) { double y = comb[c][k].tap((double)comb[c][k].b.size() - 2); combS[c][k] = y * (1 - damp) + combS[c][k] * damp; comb[c][k].push((float)(x + combS[c][k] * fbk)); s += y; }
          for (int k = 0; k < 4; k++) { double bo = ap[c][k].tap((double)ap[c][k].b.size() - 2); ap[c][k].push((float)(s + bo * 0.5)); s = bo - s; }
          s -= revLo[c].lp(s, lo); s = revHi[c].lp(s, hi); o[c] = s; }
        double m = (o[0] + o[1]) * 0.5; double l = m + (o[0] - m) * wd, r = m + (o[1] - m) * wd;
        X[0][i] = (float)(X[0][i] * (1 - wet * 0.5) + l * wet); X[1][i] = (float)(X[1][i] * (1 - wet * 0.5) + r * wet); }
    }
    if (p[161] > 0.5) {   // EQ: two bands (shelf / peak / cut)
      int tl = idxOf(p[94], 3), th = idxOf(p[95], 3); double fl = 20 * std::pow(1000.0, p[88]), fh = 20 * std::pow(1000.0, p[89]), ql = 0.3 + 9.7 * p[90] * p[90], qh = 0.3 + 9.7 * p[91] * p[91], gl = p[92] * 48 - 24, gh = p[93] * 48 - 24;
      for (int c = 0; c < 2; c++) { eqL[c].set(tl == 0 ? 0 : tl == 1 ? 1 : 3, fl, ql, gl, sr); eqH[c].set(th == 0 ? 2 : th == 1 ? 1 : 4, fh, qh, gh, sr); for (int i = 0; i < n; i++) X[c][i] = (float)eqH[c].run(eqL[c].run(X[c][i])); }
    }
    if (p[162] > 0.5) {   // FX Filter
      FType t = ftype(p[142]); double fc = cutoffHz(p[143]), g = std::tan(M_PI * std::min(fc, sr * 0.45) / sr), k = 2 - 1.97 * p[144], opc = 1 - std::exp(-TAU * std::min(fc, sr * 0.45) / sr), d = 1 + 9 * p[145], wet = p[141], pan = p[268] * 2 - 1;
      for (int i = 0; i < n; i++) for (int c = 0; c < 2; c++) { double x = X[c][i], y = fxf[c].run(d > 1.001 ? std::tanh(x * d) / std::tanh(d) : x, t, g, k, opc) * (c ? 1 + pan : 1 - pan); X[c][i] = (float)(x * (1 - wet) + y * wet); }
    }
  }
};

}  // namespace

Instrument* makeMoist2(double sr, Bank* bank) { return new Moist2(sr, bank); }
const char* moist2TableName(int k) { return k >= 0 && k < M2_BUILTIN_TABLES ? NAMES[k] : ""; }

}  // namespace mdaw
