// See hdslicer.h. Port of Honeydew crates/audio/src/slicer.rs (detect, the Slicer player).
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#include "hdslicer.h"
#include <cmath>
#include <algorithm>

namespace mdaw {

namespace {
const size_t HOP = 16, WINDOW = 128, BACK_HOPS = 28, ZERO_CROSSING_FRAMES = 882, MIN_SLICE = 2646, MAX_SLICES = 128;
const double HIGH_PASS_A = 9.134e-5, HIGH_PASS_B = 0.96, HOPS_PER_MS = 2.7562, ONSET = 1.0, START = 0.75, RMS_FLOOR = 0.05, TAU = 6.283185307179586;
struct BandSpec { size_t lo, hi, hold; double ms, k, floor; };
const BandSpec LOW = { 1, 6, 55, 15.0, 4.5, 1e-10 / 1.8 }, HIGH = { 6, 64, 41, 10.0, 5.0, 1e-10 / 20.0 };

void highPass(std::vector<double>& x) { double p = 0, v = 0; for (auto& s : x) { double u = v + HIGH_PASS_A * (s - p); p += u; v = HIGH_PASS_B * u; s -= p; } }
void fft(double* re, double* im, size_t n) {
  size_t j = 0;
  for (size_t i = 1; i < n; i++) { size_t bit = n >> 1; while (j & bit) { j ^= bit; bit >>= 1; } j |= bit; if (i < j) { std::swap(re[i], re[j]); std::swap(im[i], im[j]); } }
  for (size_t len = 2; len <= n; len <<= 1) {
    double ang = -TAU / (double)len, sn = std::sin(ang), cs = std::cos(ang);
    for (size_t st = 0; st < n; st += len) {
      double wr = 1, wi = 0;
      for (size_t k = st; k < st + len / 2; k++) {
        size_t m = k + len / 2; double tr = re[m] * wr - im[m] * wi, ti = re[m] * wi + im[m] * wr;
        re[m] = re[k] - tr; im[m] = im[k] - ti; re[k] += tr; im[k] += ti;
        double nwr = wr * cs - wi * sn, nwi = wr * sn + wi * cs; wr = nwr; wi = nwi;
      }
    }
  }
}
std::vector<double> bandDetect(const BandSpec& b, const std::vector<double>& raw) {
  double fall = std::exp(-1.0 / (HOPS_PER_MS * b.ms)), env = 0; std::vector<double> out(raw.size());
  for (size_t i = 0; i < raw.size(); i++) {
    double held = 0; for (size_t q = i >= b.hold ? i - b.hold : 0; q <= i; q++) held = std::max(held, raw[q]);
    double r = std::max(env, b.floor);
    env = held > env ? held : held + (env - held) * fall;
    out[i] = env >= r ? b.k * (env / r - 1.0) : 0.0;
  }
  return out;
}
std::vector<double> detection(const std::vector<double>& y) {
  size_t n = (y.size() + WINDOW + HOP - 1) / HOP; double win[WINDOW], gain = 0;
  for (size_t k = 0; k < WINDOW; k++) { win[k] = 0.53836 - 0.46164 * std::cos(TAU * (double)k / (double)WINDOW); gain += win[k]; }
  std::vector<double> low, high; low.reserve(n); high.reserve(n); double re[WINDOW], im[WINDOW];
  for (size_t i = 0; i < n; i++) {
    for (size_t k = 0; k < WINDOW; k++) { size_t q = i * HOP + k; re[k] = q < y.size() ? y[q] * win[k] : 0.0; im[k] = 0; }
    fft(re, im, WINDOW);
    auto mean = [&](size_t a, size_t b) { double s = 0; for (size_t k = a; k < b; k++) { double m = std::hypot(re[k], im[k]) / gain; s += m * m; } return s / (double)(b - a); };
    low.push_back(mean(LOW.lo, LOW.hi)); high.push_back(mean(HIGH.lo, HIGH.hi));
  }
  auto l = bandDetect(LOW, low), h = bandDetect(HIGH, high); std::vector<double> d(l.size());
  for (size_t i = 0; i < d.size(); i++) d[i] = std::max(l[i], h[i]);
  return d;
}
}  // namespace

std::vector<size_t> slicerDetect(const float* left, const float* right, size_t frames, float sensitivity) {
  std::vector<size_t> starts;
  if (sensitivity > 0 && frames > 0) {
    float peak = 0; for (size_t k = 0; k < frames; k++) peak = std::max(peak, std::fabs(left[k]));
    if (right && right != left) for (size_t k = 0; k < frames; k++) peak = std::max(peak, std::fabs(right[k]));
    if (peak != 0.0f) {
      auto x = [&](size_t k) { return (double)left[k] / (double)peak; };
      std::vector<double> y(frames); for (size_t k = 0; k < frames; k++) y[k] = x(k);
      for (int r = 0; r < 3; r++) highPass(y);
      std::vector<double> d = detection(y);
      double sens = (double)sensitivity;
      auto rms = [&](size_t fr) { size_t a = fr * HOP, b = std::min(fr * HOP + WINDOW, y.size()); double s = 0; for (size_t k = a; k < b; k++) s += x(k) * x(k); return std::sqrt(s / (double)WINDOW); };
      size_t i = 0;
      while (i < d.size() && starts.size() < MAX_SLICES) {
        if (sens * d[i] < ONSET) { i++; continue; }
        size_t back = i; for (size_t j = i >= BACK_HOPS ? i - BACK_HOPS : 0; j <= i; j++) if (sens * d[j] > START) { back = j; break; }
        size_t frame = i; for (size_t j = back; j <= i; j++) if (rms(j) > RMS_FLOOR) { frame = j; break; }
        size_t pos = frame * HOP, zc = pos;
        { size_t lo = std::max(pos >= ZERO_CROSSING_FRAMES ? pos - ZERO_CROSSING_FRAMES : 0, (size_t)1);
          for (size_t k = pos + 1; k-- > lo;) { if (x(k) == 0.0 || ((x(k - 1) < 0.0) != (x(k) < 0.0))) { zc = k; break; } if (k == 0) break; } }
        pos = zc;
        if (y.size() - pos >= MIN_SLICE) starts.push_back(pos);
        i = std::max((pos + MIN_SLICE + WINDOW / 2 + HOP / 2) / HOP, i + 1);
      }
    }
  }
  if (starts.empty() && frames > 0) starts.push_back(0);   // no onset: one whole slice
  return starts;
}

namespace {
const int VOICES = 256; const double FAST_FADE = 0.01, END_FADE = 512.0, SILENT = 1e-4;
enum Stage { IDLE, ATTACK, DECAY, FADE };
struct Voice { Stage stage = IDLE; int key = 0; bool hold = false; double pos = 0, sliceEnd = 0, end = 0; float g0 = 0, g1 = 0; double env = 0, attack = 0; uint64_t age = 0; };

class Slicer : public Instrument {
 public:
  Slicer(double sr, Bank* b) : rate((float)sr), bank(b), voices(VOICES) { pitchNative = true; }
  void setParam(int i, double v) override {
    if (i >= 0 && i < 7) { p[i] = (float)v; return; }
    if (i == 100) { sampleId = (int)v; dirty = true; }
    else if (i == 7) { float s = (float)v; if (s != sens) { sens = s; dirty = true; } }
    else if (i == 8) firstSet = (int)v;
    else if (i == 90) semis = std::isfinite(v) ? v : 0;   // the track's Pitch: on top of the module's (MobileDAW)
  }
  void noteOn(int key, double vel) override {
    const Sample* s = sample(); if (!s) return;
    int first = firstKey(); if (key < first) return;
    size_t k = (size_t)(key - first); if (k >= slices.size()) return;
    size_t start = slices[k], frames = (size_t)s->frames, sliceEnd = k + 1 < slices.size() ? slices[k + 1] : frames;
    if (p[6] != 0.0f) for (auto& vc : voices) if (vc.stage != IDLE) vc.stage = FADE;
    double sustain = std::trunc((double)p[5] * 2.0);
    double attack = p[3] < 0.001f ? 1.0 : 0.0002 / (500.0 * x4(3));
    float ve = std::min(std::max((float)vel, 0.0f), 1.0f), pan = 0.5f;
    age++;
    Voice* best = &voices[0];
    for (auto& vc : voices) { bool a = vc.stage != IDLE, b = best->stage != IDLE; if (a < b || (a == b && vc.age < best->age)) best = &vc; }
    *best = Voice{ ATTACK, key, sustain == 1.0, (double)start, (double)sliceEnd, (double)(sustain == 0.0 ? sliceEnd : frames),
      ve * std::min(2.0f - 2.0f * pan, 1.0f), ve * std::min(2.0f * pan, 1.0f), 0.0, attack, age };
  }
  void noteOff(int key) override { for (auto& vc : voices) if (vc.stage != IDLE && vc.key == key && vc.hold) vc.stage = FADE; }
  void allOff() override { for (auto& vc : voices) if (vc.stage != IDLE && vc.hold) vc.stage = FADE; }
  bool active() override { for (auto& vc : voices) if (vc.stage != IDLE) return true; return false; }
  void render(float* L, float* R, int a, int b) override {
    const Sample* s = sample(); if (!s) return;
    double semitones = std::trunc((double)p[1] * 48.0 - 24.0) + std::round(semis);
    double step = (double)s->rate / (double)rate * std::exp2(semitones * (1.0 / 12.0));
    double dv = (double)p[4], slow = 50.0 * x4(4), decay = dv > 0.99 ? 0.0 : (dv < 0.001 || slow < 0.001 ? 1.0 : 0.0002 / slow);
    const float* sl = s->l; const float* sr = s->r ? s->r : s->l; size_t n = (size_t)s->frames;
    for (auto& vc : voices) {
      if (vc.stage == IDLE) continue;
      for (int f = a; f < b; f++) {
        if (vc.stage == ATTACK) { vc.env += (5.0 - vc.env) * vc.attack; if (vc.env > 1.0) { vc.env = 1.0; vc.stage = DECAY; } }
        else if (vc.stage == DECAY) vc.env -= vc.env * decay;
        else if (vc.stage == FADE) vc.env -= vc.env * FAST_FADE;
        if (vc.pos >= vc.end || (vc.stage != ATTACK && vc.env < SILENT)) { vc.stage = IDLE; break; }
        double dip = vc.pos < vc.sliceEnd ? std::min(std::max((vc.sliceEnd - vc.pos) / END_FADE, 0.0), 1.0) : 1.0;
        float gain = (float)(vc.env * dip);
        L[f] += lerp(sl, n, vc.pos) * gain * vc.g0; R[f] += lerp(sr, n, vc.pos) * gain * vc.g1;
        vc.pos += step;
      }
    }
  }
 private:
  float rate; Bank* bank; float p[7] = { 1, 0.5f, 0, 0, 1, 0, 0 }; int sampleId = -1; float sens = 0.25f; int firstSet = 0; double semis = 0;
  std::vector<Voice> voices; uint64_t age = 0; std::vector<size_t> slices; const Sample* sliced = nullptr; bool dirty = true;
  double x4(int i) const { double x = 0.95 * (double)p[i] + 0.05; return x * x * x * x; }
  int firstKey() const { int f = firstSet > 0 ? firstSet : 48; int sl = (int)std::min(std::max(slices.size(), (size_t)1), (size_t)128); return std::min(f, 128 - sl); }
  static float lerp(const float* x, size_t n, double pos) { size_t i = (size_t)pos; if (i >= n) i = n - 1; float a = x[i], b = i + 1 < n ? x[i + 1] : x[i]; return a + (b - a) * (float)(pos - (double)i); }
  // the loop, sliced again when it or the Sensitivity changed (once, where the param or a new sample arrives)
  const Sample* sample() {
    const Sample* s = sampleId >= 0 && sampleId < 256 && bank ? bank->s[sampleId] : nullptr;
    if (!s || s->frames <= 0) return nullptr;
    if (dirty || s != sliced) { slices = slicerDetect(s->l, s->r, (size_t)s->frames, sens); sliced = s; dirty = false; }
    return s;
  }
};
}  // namespace

Instrument* makeSlicer(double sr, Bank* bank) { return new Slicer(sr, bank); }

}  // namespace mdaw
