// Port of js/engine/hdgms.js (GMS, Honeydew's GMSynth model). Every expression keeps the JS operation order.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#include "hdgms.h"
#include <algorithm>

namespace mdaw {

namespace {
constexpr int NV = 4, COPIES = 4, GBLOCK = 32, PARTIALS = 512, TLEN = 1024, NSHAPES = 29, FT_LEN = 65536;
constexpr double PHASE = 4294967296.0, TAU = 2 * PI;
constexpr int SAW = 16, SINE = 18, SQUARE = 22, TRIANGLE = 26;
constexpr uint32_t SEED = 0x2545f491u;
constexpr int IDLE = 0, ATTACK = 1, DECAY = 2, RELEASE = 3, RING = 0, FM = 1, SYNC = 2, FILTER = 3;
constexpr double SMOOTHING = 0.01, CUT_SMOOTH = 0.001, KBD_PER_KEY = 0.0089964, FLUSH = 1e-20, FREE_LEVEL = 1e-4, RATE_SCALE = 8.82;
const double RATE_BEATS[10] = {0.25, 0.375, 0.5, 0.75, 1, 2, 4, 8, 16, 32}, PB_RANGES[4] = {1, 2, 7, 12};

double hash(uint32_t seed, int n) { uint32_t x = ((uint32_t)n * 0x9e3779b9u) ^ (seed * 0x85ebca6bu); x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return (double)(x >> 8) / 16777216.0; }
struct Part { double m, p; };
double only(int n, std::initializer_list<std::pair<int, double>> list) { for (auto& q : list) if (q.first == n) return q.second; return 0; }
Part partial(int slot, int n) {
  const bool odd = n % 2 == 1; const double saw = 1.0 / n, square = odd ? saw : 0;
  auto pulse = [&](double duty) { return std::fabs(std::sin(PI * n * duty)) / n; };
  auto bump = [&](double cc, double w) { const double t = (n - cc) / w; return std::exp(-(t * t)); };
  auto lowPass = [&](double corner) { const double t = n / corner; return 1 / (1 + t * t); };
  auto random = [&](uint32_t seed) { return hash(seed, n); };
  auto jitter = [&](uint32_t seed) { return PI * (2 * hash(seed, n) - 1); };
  int bits = 0; for (unsigned x = (unsigned)n; x; x >>= 1) bits += x & 1;
  switch (slot) {
    case 0: return {saw * (1 + 3 * bump(6, 2.5)), 0};
    case 1: return {pulse(0.3), 0.5 * jitter(1)};
    case 2: return {2 * std::cos(PI * n * 0.35) * lowPass(10), PI / 2 - PI * n * 0.35};
    case 3: return {bits <= 2 ? saw : 0, 0};
    case 4: return {saw * (0.4 + 1.2 * random(4)), jitter(5)};
    case 5: return {pulse(0.125), 0};
    case 6: return {odd ? std::pow((double)n, -0.8) : 0.5 * saw, jitter(6)};
    case 7: return {saw * saw + 0.5 * bump(3, 0.8) + 0.2 * bump(9, 2), 0};
    case 8: return {saw * (0.3 + 2 * bump(4, 1.2)), 0};
    case 9: return {std::pow((double)n, -1.5) * (0.5 + random(9)), 0};
    case 10: return {n == 1 ? 1 : odd ? 0.6 * saw * saw : 0.3 * std::pow((double)n, -2.5), 0};
    case 11: return {saw * saw * saw, PI / 2 * (n - 1)};
    case 12: return {square * (1 + 2 * bump(5, 1.5)) * lowPass(20), 0};
    case 13: return {only(n, {{1, 1}, {2, 0.35}, {3, 0.12}, {4, 0.05}, {7, 0.18}, {8, 0.06}, {14, 0.04}}), 0};
    case 14: return {saw * (odd ? 1 : 0.5) * (1 + 2 * bump(14, 5)), 0};
    case 15: return {n <= 24 ? saw : 0, 0};
    case SAW: return {saw, 0};
    case 17: return {std::pow((double)n, -2.5), 0};
    case SINE: return {only(n, {{1, 0.5}}), 0};
    case 19: return {only(n, {{1, 1}, {2, 0.2}, {3, 0.05}}), 0};
    case 20: return {n <= 15 ? square : 0, 0};
    case 21: return {square * lowPass(7), 0};
    case SQUARE: return {square, 0};
    case 23: return {std::fabs(std::sin(PI * n * 0.18)) * std::pow((double)n, -1.2), 0};
    case 24: return {std::fabs(std::sin(PI * n * 0.09)) * saw * (0.8 + 0.4 * random(24)), 0.3 * jitter(25)};
    case 25: return {saw * (0.25 + bump(3, 1) + 0.6 * bump(9, 2)), 0};
    case TRIANGLE: return {odd ? saw * saw : 0, n % 4 == 3 ? PI : 0};
    case 27: return {n == 2 ? 0.6 : odd ? std::pow((double)n, -1.2) : 0.3 * saw * saw, 0};
    default: return {saw * (0.25 + bump(5, 1.5) + 0.7 * bump(12, 2.5) + 0.3 * bump(22, 3)), 0};
  }
}
const float* gmShape(double slotIn) {
  static std::vector<float> shapes[NSHAPES];
  const int slot = (int)clamp(jsRound(slotIn), 0, NSHAPES - 1);
  std::vector<float>& out = shapes[slot];
  if (!out.empty()) return out.data();
  std::vector<float> mag(PARTIALS), ph(PARTIALS);
  for (int n = 1; n <= PARTIALS; n++) {
    const Part q = partial(slot, n); const double pp = q.p - PI / 2 + (q.m < 0 ? PI : 0), w = pp + PI;
    mag[n - 1] = (float)std::fabs(q.m); ph[n - 1] = (float)(w - std::floor(w / TAU) * TAU - PI);
  }
  if (slot != SAW && slot != SINE && slot != SQUARE && slot != TRIANGLE) {
    double e = 0; for (int k = 0; k < PARTIALS; k++) e += (double)mag[k] * mag[k];
    const double sc = ((PI / 4) * 0.398) / std::sqrt(e / 2);   // DESIGN_RMS (hdgms.js)
    for (int k = 0; k < PARTIALS; k++) mag[k] = (float)(mag[k] * sc);
  }
  std::vector<double> sine(TLEN), sum(TLEN, 0.0); out.assign((size_t)PARTIALS * TLEN, 0.f);
  for (int i = 0; i < TLEN; i++) sine[i] = std::sin(TAU * i / TLEN);
  for (int h = 1; h <= PARTIALS; h++) {
    const double m = mag[h - 1]; const int o = (h - 1) * TLEN;
    if (m != 0) { const double a = m * std::cos((double)ph[h - 1]), b = m * std::sin((double)ph[h - 1]); for (int n = 0; n < TLEN; n++) { const int k = h * n; sum[n] += a * sine[(k + TLEN / 4) % TLEN] - b * sine[k % TLEN]; } }
    for (int n = 0; n < TLEN; n++) out[o + n] = (float)sum[n];
  }
  return out.data();
}
int tableFor(double f, double sr) { f = std::fabs(f); if (!std::isfinite(f) || !(sr > 0)) return 0; return ((int)jsMin(PARTIALS, f <= sr / (2 * PARTIALS) ? PARTIALS : std::floor(sr / (2 * f)) + 1) - 1) * TLEN; }
const float* filterTable() {
  static std::vector<float> ft;
  if (!ft.empty()) return ft.data();
  ft.assign((size_t)FT_LEN * 2, 0.f);
  for (int j = 0; j < FT_LEN; j++) {
    const double w = TAU * (11.68 + 0.304433 * j) / 44100, th = (PI - w) / 8, r = std::sin(th) / std::sin(w + th), h = (1 - r) / std::sqrt(1 - 2 * r * std::cos(w) + r * r), h2 = h * h, h4 = h2 * h2;
    ft[2 * j] = (float)(1 - r); ft[2 * j + 1] = (float)(1 / (h4 * h4));
  }
  return ft.data();
}
inline uint32_t rngNext(uint32_t& s) { uint32_t x = s; x ^= x << 13; x ^= x >> 17; x ^= x << 5; s = x; return x; }
inline double pow4(double x) { return x * x * x * x; }
double attackRate(double v, double sr) { return v <= 0 ? 1 : RATE_SCALE / (sr * 100 * pow4(v)); }
double decayRate(double v, double sr) { return RATE_SCALE / (sr * (200 * (pow4(v) * v * v * v) + 0.001)); }
inline double envStep(GmEnv& e, const GmRates& r) {
  if (e.st == ATTACK) { e.e += (5 - e.e) * r.a; if (e.e > 1) { e.e = 1; e.st = DECAY; } }
  else if (e.st == DECAY) e.e += (r.s - e.e) * r.d;
  else if (e.st == RELEASE) e.e -= e.e * r.r;
  if (e.e < FLUSH) e.e = 0;
  return e.e;
}
inline double lfoValue(int shape, double phase) { return shape == 0 ? std::sin(TAU * phase) : shape == 1 ? 2 * phase - 1 : phase < 0.5 ? -1 : 1; }
inline bool heldSt(const GmVoice& o) { return o.amp.st == ATTACK || o.amp.st == DECAY; }
}  // namespace

HdGms::HdGms(double rate) : sr(rate > 0 && std::isfinite(rate) ? rate : 44100), FT(filterTable()), rng(SEED), fx0(sr), fx1(sr), fx2(sr) {
  static const double D[68] = {100, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 0, 1, 2, 50, 0, 0, 0, 100, 1, 20, 0, 0, 100, 1, 100, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 1, 0, 50, 50, 0, 0, 0, 5, 0, 50, 50, 0, 0, 0, 3, 0, 50, 50, 0, 0};
  for (int i = 0; i < 68; i++) p[i] = D[i];
  wa = gmShape(0); wb = gmShape(0);
  reset();
}
void HdGms::reset() {
  for (int i = 0; i < NV; i++) { GmVoice& o = v[i]; const uint32_t seed = (uint32_t)i + 1, r = seed * 8; o = GmVoice(); o.noise = ((r >= 32 ? SEED : (SEED << r) | (SEED >> (32 - r))) ^ seed); }
  for (auto& h : held) h = false;
  last = -1; serial = 0; blockPos = 0; lfoPhase = 0; snap = true; rng = SEED; modAmount = 0; level = 0; pan = 0.5;
  fx0.reset(); fx1.reset(); fx2.reset();
}
void HdGms::setParam(int i, double x) {
  if (i < 0 || i >= 68 || !std::isfinite(x)) return;
  if (i == 43 && x > 0.5 && !(p[43] > 0.5)) for (int k = 0; k < 128; k++) noteOff(k);
  p[i] = x;
  if (i == 7) wa = gmShape(x); else if (i == 8) wb = gmShape(x);
}
bool HdGms::active() { for (auto& o : v) if (o.amp.st != IDLE) return true; return fx0.busy() || fx1.busy() || fx2.busy(); }
double HdGms::ratioB() const { return std::pow(2.0, (clamp(p[10], -50, 50) / 100 + clamp(jsRound(p[9]), -24, 24)) * (1.0 / 12)); }

void HdGms::noteOn(int keyIn, double vel) {
  const int key = (int)clamp(jsRound(keyIn), 0, 127);
  bool others = false; for (int k = 0; k < 128; k++) if (held[k] && k != key) { others = true; break; }
  held[key] = true;
  vel = clamp(vel, 0, 1);
  const bool mono = p[43] > 0.5; const int lastKey = last;
  last = key;
  const int glideFrom = lastKey >= 0 && (!(p[44] > 0.5) || others) ? lastKey : key;
  GmVoice& v0 = v[0];
  if (mono && heldSt(v0)) { v0.key = key; v0.vel = vel; return; }
  int index = 0;
  if (!mono) { index = -1; for (int i = NV - 1; i >= 0; i--) if (v[i].amp.st == IDLE) { index = i; break; } if (index < 0) { index = 0; for (int i = 1; i < NV; i++) if (v[i].age < v[index].age) index = i; } }
  serial++;
  const double rb = ratioB(), po = clamp(p[11], 0, 1); GmVoice& o = v[index];
  if (o.amp.st == IDLE) { for (int k = 0; k < COPIES; k++) o.pa[k] = rngNext(rng); for (int q = 0; q < 8; q++) o.y[0][q] = o.y[1][q] = 0; o.gain = vel; }
  for (int k = 0; k < COPIES; k++) { const double cyc = po + o.pa[k] / PHASE * rb; o.pb[k] = (uint32_t)(uint64_t)std::trunc((cyc - std::trunc(cyc)) * PHASE); }
  o.key = key; o.vel = vel; o.panL = 1; o.panR = 1; o.age = serial; o.p = glideFrom;
  o.amp.st = ATTACK; o.fenv.e = 0; o.fenv.st = ATTACK; o.menv.e = 0; o.menv.st = ATTACK; o.eg.e = 0; o.eg.st = ATTACK;
  o.snap = true;
  if (blockPos != 0) { glide(o); voiceControl(o); }
}
void HdGms::noteOff(int keyIn) {
  const int key = (int)clamp(jsRound(keyIn), 0, 127);
  held[key] = false;
  if (!(p[43] > 0.5)) { for (auto& o : v) if (o.key == key && heldSt(o)) release(o); return; }
  GmVoice& o = v[0];
  if (heldSt(o) && o.key == key) {
    int to = -1;
    for (int k = key - 1; k >= 0; k--) if (held[k]) { to = k; break; }
    if (to < 0) for (int k = key + 1; k < 128; k++) if (held[k]) { to = k; break; }
    if (to >= 0) o.key = to; else release(o);
  }
}
void HdGms::release(GmVoice& o) { if (o.amp.st != IDLE) { o.amp.st = RELEASE; o.eg.st = RELEASE; } }
void HdGms::allOff() { for (auto& h : held) h = false; for (auto& o : v) release(o); }
void HdGms::glide(GmVoice& o) { const double gap = o.key - o.p, step = gap * GBLOCK / (0.1 * sr * c.slide + 1); o.p = std::fabs(step) >= std::fabs(gap) ? o.key : o.p + step; }
void HdGms::voiceControl(GmVoice& o) {
  const double eg = o.eg.e, pitch = o.p + c.offset + c.egPitch * eg + c.lfoPitch, fa = 220 * std::pow(2.0, (pitch - 57) / 12), fb = fa * c.ratioB;
  o.ta = tableFor(fa, sr); o.tb = tableFor(fb, sr);
  const double sync = c.modKind == SYNC ? std::pow(2.0, c.syncBase + c.modContour * o.menv.e + c.egMod * eg + c.lfoModNow) : 1;
  for (int k = 0; k < COPIES; k++) {
    double x = std::trunc(fa * sync * c.ratio[k] / sr * PHASE); o.sa[k] = x > 0 ? std::fmod(x, PHASE) : 0;
    x = std::trunc(fb * c.ratio[k] / sr * PHASE); o.sb[k] = x > 0 ? std::fmod(x, PHASE) : 0;
  }
  o.sT = clamp(c.cutoff + c.kbd * (pitch - 64) * KBD_PER_KEY + c.mwFilter, 0, 1);
  if (o.snap) { o.s = o.sT; o.snap = false; }
}
void HdGms::control() {
  auto N = [&](int i) { return clamp(p[i] / 100, 0, 1); };
  auto B = [&](int i) { return clamp(p[i] / 100, -1, 1); };
  auto I = [&](int i, int hi) { return (int)clamp(jsRound(p[i]), 0, hi); };
  const double startBeat = playing ? beat : -1;
  MfxBank* fx[3] = {&fx0, &fx1, &fx2};
  for (int s = 0; s < 3; s++) {
    const int o = 47 + 7 * s; const double a = B(o + 2);
    fxKind[s] = p[o] > 0.5 ? I(o + 1, 9) : -1;
    fx[s]->prepare(N(o + 3), N(o + 4), RATE_BEATS[I(o + 5, 9)], a * std::fabs(a), I(o + 6, 2), bpm, startBeat, GBLOCK);
  }
  const int lfoShape = I(36, 2); const double lrate = RATE_BEATS[I(38, 9)];
  double lph = lfoPhase; if (playing) { const double t = beat / lrate; lph = t - std::floor(t); }
  const double lfoNow = lfoValue(lfoShape, lph);
  const double mw = wheel * N(21); const int md = I(20, 2); const double mwFilter = md == 0 ? mw : 0, mwLfo = md == 1 ? mw : 0, mwOsc = md == 2 ? mw : 0;
  double s2 = clamp(p[26], 0, 1);
  c.amp.a = attackRate(N(24), sr); c.amp.d = decayRate(N(25), sr); c.amp.s = s2 * s2; c.amp.r = RATE_SCALE / (sr * (N(27) + 0.001));
  c.menv.a = attackRate(N(16), sr); c.menv.d = decayRate(N(17), sr); c.menv.s = 0; c.menv.r = 0;
  c.fenv.a = attackRate(N(2), sr); c.fenv.d = decayRate(N(3), sr); c.fenv.s = 0; c.fenv.r = 0;
  s2 = clamp(p[31], 0, 1);
  c.eg.a = attackRate(N(29), sr); c.eg.d = decayRate(N(30), sr); c.eg.s = s2 * s2; c.eg.r = RATE_SCALE / (sr * (200 * pow4(N(32)) + 0.001));
  c.copies = I(45, 3) + 1;
  static const double SCALES[3] = {1, 1.5, 2};
  const double spread = N(41), scale = SCALES[I(46, 2)], stereo = N(42);
  for (int k = 0; k < COPIES; k++) {
    const double t = c.copies > 1 ? (double)k / (c.copies - 1) : 0.5, x = stereo * (2 * t - 1);
    c.ratio[k] = std::pow(2.0, (spread * t - spread / 2) / 12) * (k % 2 == 1 ? scale : 1);
    c.cpL[k] = clamp(1 - x, 0, 1); c.cpR[k] = clamp(1 + x, 0, 1);
  }
  const double nz = N(13), bal = (clamp(p[12], -100, 100) + 100) / 200, g = 0.5 / (1 + 0.15 * (c.copies - 1)) * (1 - nz * nz);
  c.gainA = g * (1 - std::fabs(2 * bal - 1)); c.gainB = g * (2 * bal - 1); c.noise = nz * nz;
  c.ratioB = ratioB();
  c.offset = clamp(jsRound(p[39]), -24, 24) + PB_RANGES[I(19, 3)] * (bendSt / 2) + slideSt;
  c.slide = N(40);
  const double depth = B(28); const int egDest = I(34, 2);
  c.egFilter = egDest == 0 ? depth * depth * depth : 0; c.egMod = egDest == 1 ? std::fabs(depth) * depth : 0; c.egPitch = egDest == 2 ? 12 * depth * std::fabs(depth) : 0;
  c.velDepth = p[33] > 0.5;
  const double a0 = B(35), am = jsMin(std::fabs(a0) + mwLfo, 1), a = a0 < 0 ? -am : am; const int lfoDest = I(37, 4);
  c.lfoShape = lfoShape;
  c.lfoFilter = lfoDest == 0 ? a * a * a : 0; c.lfoMod = lfoDest == 1 ? std::fabs(a) * a : 0; c.lfoModNow = c.lfoMod * lfoNow;
  c.lfoPitch = (lfoDest == 2 ? 12 * a * std::fabs(a) : 0) * lfoNow;
  const double lfoLevel = (lfoDest == 3 ? 12 * a : 0) * lfoNow, lfoPan = (lfoDest == 4 ? std::fabs(a) * a : 0) * lfoNow;
  c.modKind = I(15, 3); c.modContour = B(18); c.modTarget = N(14) + mwOsc; c.syncBase = clamp(c.modTarget, 0, 1);
  const double fc = B(4);
  c.fltContour = fc * fc * fc; c.cutoff = N(0); c.kbd = N(5); c.mwFilter = mwFilter; c.res = N(1); c.fltKind = I(6, 2);
  const double db = clamp(p[22], -60, 18) + lfoLevel;
  c.level = db < -60 || p[22] <= -60 ? 0 : std::pow(10.0, db / 20); c.pan = clamp((clamp(p[23], -100, 100) + 100) / 200 + lfoPan, 0, 1);
  if (snap) { level = c.level; pan = c.pan; modAmount = c.modTarget; snap = false; }
  for (auto& o : v) if (o.amp.st != IDLE) { glide(o); voiceControl(o); }
}
void HdGms::voice(GmVoice& o, int n) {
  const float* A = wa; const float* Bt = wb; const int ta = o.ta, tb = o.tb, kind = c.fltKind;
  const double velocity = clamp(o.vel, 0, 1), depth = c.velDepth ? velocity : 1; const bool sync = c.modKind == SYNC; double* y0 = o.y[0]; double* y1 = o.y[1];
  for (int i = 0; i < n; i++) {
    const uint32_t dz = dither[i]; const double amp = envStep(o.amp, c.amp), eF = envStep(o.fenv, c.fenv), eM = envStep(o.menv, c.menv), eg = envStep(o.eg, c.eg) * depth;
    const double m = clamp(amount[i] + c.modContour * eM + c.egMod * eg + c.lfoMod * lfo[i], 0, 1); const bool act = m > 0.001, fm = act && c.modKind == FM, ring = act && c.modKind == RING;
    double left = 0, right = 0, b0 = 0;
    for (int k = 0; k < c.copies; k++) {
      const double b = Bt[tb + (int)((uint32_t)(o.pb[k] + dz) >> 22)];
      const uint32_t pha = fm ? o.pa[k] + (uint32_t)(int64_t)std::trunc((b + 1) * m * PHASE) + dz : o.pa[k] + dz;
      double a = A[ta + (int)(pha >> 22)];
      if (ring) a *= 1 + 3 * m * b;
      const double x = c.gainA * a + c.gainB * b;
      left += x * c.cpL[k]; right += x * c.cpR[k];
      if (k == 0) b0 = b;
      const double nb = (double)o.pb[k] + o.sb[k];
      o.pb[k] = (uint32_t)(uint64_t)nb;
      o.pa[k] = sync && nb >= PHASE ? 0u : (uint32_t)(uint64_t)((double)o.pa[k] + o.sa[k]);
    }
    const double noise = c.noise * ((double)(rngNext(o.noise) >> 8) / 8388608.0 - 1);
    o.s += CUT_SMOOTH * (o.sT - o.s);
    const double cut = clamp(o.s + c.fltContour * eF + c.egFilter * eg + c.lfoFilter * lfo[i] + (act && c.modKind == FILTER ? 0.5 * m * b0 : 0), 0, 1);
    const double fx = clamp((1.0159 * (32 * std::pow(2.0, 9.27 * cut)) + 0.5 - 11.68) / 0.304433, 0, FT_LEN - 1); const int j = (int)jsMin(std::trunc(fx), FT_LEN - 2); const double t = fx - j;
    const double ca = FT[2 * j] + t * ((double)FT[2 * j + 2] - FT[2 * j]), fbk = c.res * (FT[2 * j + 1] + t * ((double)FT[2 * j + 3] - FT[2 * j + 1]));
    double u = left + noise - fbk * y0[7]; u = u / (1 + 0.05 * std::fabs(u));
    double inp = u; for (int q = 0; q < 8; q++) { y0[q] += ca * (inp - y0[q]); inp = y0[q]; }
    const double outL = kind == 0 ? y0[3] : kind == 1 ? y0[7] : u - y0[0];
    u = right + noise - fbk * y1[7]; u = u / (1 + 0.05 * std::fabs(u));
    inp = u; for (int q = 0; q < 8; q++) { y1[q] += ca * (inp - y1[q]); inp = y1[q]; }
    const double outR = kind == 0 ? y1[3] : kind == 1 ? y1[7] : u - y1[0];
    o.gain += SMOOTHING * (velocity - o.gain);
    const double gn = amp * o.gain;
    busL[i] += outL * gn * o.panL; busR[i] += outR * gn * o.panR;
    if ((o.amp.st == RELEASE || (o.amp.st == DECAY && c.amp.s == 0)) && amp < FREE_LEVEL) { o.amp.st = IDLE; return; }
  }
}
void HdGms::render(float* Lo, float* Ro, int from, int to) {
  const int total = to - from; const double bpf = bpm / (60 * sr); double io[2];
  int done = 0;
  while (done < total) {
    if (blockPos == 0) control();
    const int n = std::min(GBLOCK - blockPos, total - done); const double lrate = RATE_BEATS[(int)clamp(jsRound(p[38]), 0, 9)], step = bpf / lrate;
    for (int i = 0; i < n; i++) {
      dither[i] = rngNext(rng) >> 10;
      double ph = lfoPhase; if (playing) { const double t = (beat + i * bpf) / lrate; ph = t - std::floor(t); }
      const double nx = ph + step; lfoPhase = nx - std::trunc(nx);
      lfo[i] = lfoValue(c.lfoShape, ph);
      modAmount += SMOOTHING * (c.modTarget - modAmount); amount[i] = modAmount;
    }
    for (int i = 0; i < n; i++) busL[i] = busR[i] = 0;
    for (auto& o : v) if (o.amp.st != IDLE) voice(o, n);
    for (int i = 0; i < n; i++) {
      io[0] = busL[i]; io[1] = busR[i];
      fx0.frame(io, fxKind[0]); fx1.frame(io, fxKind[1]); fx2.frame(io, fxKind[2]);
      level += SMOOTHING * (c.level - level); pan += SMOOTHING * (c.pan - pan);
      const double l = jsMin(2 - 2 * pan, 1), r = jsMin(2 * pan, 1);
      Lo[from + done + i] = (float)(Lo[from + done + i] + io[0] * level * l * l); Ro[from + done + i] = (float)(Ro[from + done + i] + io[1] * level * r * r);
    }
    blockPos = (blockPos + n) % GBLOCK; if (playing) beat += n * bpf; done += n;
  }
}

}  // namespace mdaw
