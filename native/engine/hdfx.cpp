// See hdfx.h. Port of Honeydew crates/audio/src/lib.rs (AudioEffect, CommonModule and the module states), reverbs.rs and biquad.rs.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#include "hdfx.h"
#include "hdfx2.h"
#include "hdnfx.h"
#include <cmath>
#include <cstring>
#include <algorithm>

namespace mdaw {
namespace hdfx {

static const float TAU_F = 6.2831855f, PI_F = 3.14159274f, HALF_PI_F = 1.57079637f, LN10_F = 2.30258512f;
static const float MIN_POS = 1.17549435e-38f;

static inline float clampf(float x, float a, float b) { return x < a ? a : (x > b ? b : x); }
static inline float fractf(float x) { return x - std::trunc(x); }
static inline double fractd(double x) { return x - std::trunc(x); }
static inline float remEuclid(float x, float y) { float r = std::fmod(x, y); return r < 0 ? r + std::fabs(y) : r; }
static inline float dbAmp(float db) { return std::pow(10.0f, db / 20.0f); }
static inline float sq(float x) { return x * x; }
static inline float cube(float x) { return x * x * x; }
static inline size_t nextPow2(size_t n) { size_t p = 1; while (p < n) p <<= 1; return p; }

// ---------------- biquad.rs ----------------
void Biquad::param(int response, float frequency, float bandwidth, float gainDb, float sampleRate) {
  if (gainDb == 0.0f) { b0 = 1; b1 = b2 = a1 = a2 = 0; return; }
  float a = std::pow(10.0f, gainDb * 0.05f);
  float omega = clampf(frequency * std::nextafter(TAU_F, 0.0f) / sampleRate, 0.0f, 3.0f);
  float s = std::sin(omega), c = std::cos(omega);
  float alpha = s * std::sinh(0.3465736f * bandwidth * omega / s);
  float B0, B1, B2, A0, A1, A2;
  if (response == Peak) { B0 = 1 + alpha * a; B1 = -2 * c; B2 = 1 - alpha * a; A0 = 1 + alpha / a; A1 = -2 * c; A2 = 1 - alpha / a; }
  else if (response == LowShelf || response == HighShelf) {
    float shelf = 2.0f * std::sqrt(a) * alpha, ap = a + 1.0f, am = a - 1.0f;
    if (response == LowShelf) { B0 = a * (ap - am * c + shelf); B1 = 2.0f * a * (am - ap * c); B2 = a * (ap - am * c - shelf); A0 = ap + am * c + shelf; A1 = -2.0f * (am + ap * c); A2 = ap + am * c - shelf; }
    else { B0 = a * (ap + am * c + shelf); B1 = -2.0f * a * (am + ap * c); B2 = a * (ap + am * c - shelf); A0 = ap - am * c + shelf; A1 = 2.0f * (am - ap * c); A2 = ap - am * c - shelf; }
  } else return;
  b0 = B0 / A0; b1 = B1 / A0; b2 = B2 / A0; a1 = A1 / A0; a2 = A2 / A0;
}
void Biquad::filter(int response, float frequency, float res, float sampleRate) {
  float omega = std::min(frequency * (2.0f * PI_F) / sampleRate, 3.0f);
  float s = std::sin(omega), c = std::cos(omega);
  float B0, B1, B2, A1, A2;
  if (response == LowPass || response == HighPass) {
    bool high = response == HighPass;
    B0 = (1.0f + (high ? c : -c)) / (s / res + 2.0f); B1 = high ? -2.0f * B0 : 2.0f * B0; B2 = B0;
    A1 = -2.0f * res * c / (s + res); A2 = (res - s) / (s + res);
  } else if (response == BandPass) {
    float alpha = s / (2.0f * res), den = 1.0f + alpha; B0 = 0.5f * s / den; B1 = 0; B2 = -B0; A1 = -2.0f * c / den; A2 = (1.0f - alpha) / den;
  } else return;
  auto z = [](float v) { return std::fabs(v) < 1e-9f ? 0.0f : v; };
  b0 = z(B0); b1 = z(B1); b2 = z(B2); a1 = z(A1); a2 = z(A2);
}

static float readFractional(const std::vector<float>& buf, size_t w, float delay) {
  size_t n = buf.size(); float position = remEuclid((float)w - delay, (float)n);
  size_t first = (size_t)std::trunc(position) % n, second = (first + 1) % n;
  return buf[first] + fractf(position) * (buf[second] - buf[first]);
}
static float writeAndRead(std::vector<float>& buf, size_t w, float input, float delay) {
  size_t n = buf.size(); buf[w] = input; size_t whole = (size_t)std::trunc(delay);
  size_t newer = (w + n - whole % n) % n, older = (newer + n - 1) % n;
  return buf[newer] + fractf(delay) * (buf[older] - buf[newer]);
}

// ---------------- the module states (lib.rs) ----------------
struct State {
  virtual ~State() {}
  virtual void refresh(const float* p, float sr) = 0;
  virtual void prepare(float bpm, double startBeat, float sr, int frames) {}
  virtual void frame(float& l, float& r) = 0;
  virtual void reset(const float* p) = 0;
};

struct EqState : State {
  int kind, count; Biquad b[8][2];
  explicit EqState(int k) : kind(k), count(k == 0 ? 4 : 8) {}
  void refresh(const float* p, float sr) override {
    static const float GHZ[8] = { 80, 160, 375, 750, 1500, 3000, 6000, 12000 };
    for (int i = 0; i < count; i++) {
      float hz, q, lg, rg; int resp;
      if (kind == 0) {
        int f = 1 + 4 * i; float gain = -12.0f + 24.0f * p[f];
        hz = std::pow(2.0f, 5.0f + 9.25f * p[f + 1]); q = 0.25f + 7.0f * p[f + 2];
        int k = (int)std::trunc((double)p[f + 3] * 2.0); resp = k == 0 ? LowShelf : (k == 2 ? HighShelf : Peak);
        int ch = (int)std::trunc(p[17 + i] * 4.0f);
        if (ch == 1) { lg = gain; rg = 0; } else if (ch == 2) { lg = 0; rg = gain; } else if (ch == 3) { lg = gain; rg = -gain; } else if (ch == 4) { lg = -gain; rg = gain; } else { lg = rg = gain; }
      } else if (kind == 1) {
        float gain = -12.0f + 24.0f * p[i + 1]; resp = i == 0 ? LowShelf : (i == 7 ? HighShelf : Peak); hz = GHZ[i]; q = 1; lg = rg = gain;
      } else {
        float gain = -12.0f + 24.0f * p[i + 1];
        float key = (float)std::trunc(std::fma((double)p[9], 11.0, (double)0.001f));
        hz = 110.0f * std::pow(2.0f, key / 12.0f - 0.75f + (float)i); q = 0.1f + 10.0f * cube(p[10]);
        resp = i == 0 ? LowShelf : (i == 7 ? HighShelf : Peak); lg = rg = gain;
      }
      float rate = kind == 0 ? sr * 2.0f : sr;
      b[i][0].param(resp, hz, q, lg, rate); b[i][1].param(resp, hz, q, rg, rate);
    }
  }
  void frame(float& l, float& r) override { for (int i = 0; i < count; i++) { l = b[i][0].run(l); r = b[i][1].run(r); } }
  void reset(const float*) override { for (auto& x : b) { x[0].clear(); x[1].clear(); } }
};

struct FilterState : State {
  Biquad sec[8][2]; float stage[4][2] = {}; int active = 0; float out = 1;
  void refresh(const float* p, float sr) override {
    float f = std::pow(2.0f, 4.0f + 10.3f * p[1]), q = 0.8f + 2.0f * sq(p[2]);
    int k = (int)std::trunc(p[3] * 2.0f); int resp = k == 0 ? LowPass : (k == 2 ? HighPass : BandPass);
    int pk = (int)std::trunc(p[4] * 2.0f); int passes = pk == 0 ? 1 : (pk == 2 ? 4 : 2);
    active = passes * 2; out = resp == LowPass ? std::pow(0.8f, (float)passes) : 1.0f;
    for (int i = 0; i < active; i++) { sec[i][0].filter(resp, f, q, sr); sec[i][1].filter(resp, f, q, sr); }
  }
  void frame(float& l, float& r) override {
    for (int s = 0; s < active / 2; s++) {
      float nl = sec[2 * s][0].run(l), nr = sec[2 * s][1].run(r);
      l = sec[2 * s + 1][0].run(stage[s][0]); r = sec[2 * s + 1][1].run(stage[s][1]);
      stage[s][0] = nl; stage[s][1] = nr;
    }
    l *= out; r *= out;
  }
  void reset(const float*) override { std::memset(stage, 0, sizeof stage); for (auto& x : sec) { x[0].clear(); x[1].clear(); } }
};

static float levAmp(float v) { float db = -60.0f + 72.0f * std::pow(v, 0.6f); return std::pow(10.0f, db / 20.0f); }
struct LevellerState : State {
  float gain = 1, bl = 1, br = 1, tg = 1, tl = 1, tr = 1;
  void refresh(const float* p, float) override { tg = levAmp(p[1]); tl = std::min(2.0f * (1.0f - p[2]), 1.0f); tr = std::min(2.0f * p[2], 1.0f); }
  void frame(float& l, float& r) override {
    gain = flushf(gain + 0.01f * (tg - gain)); bl = flushf(bl + 0.01f * (tl - bl)); br = flushf(br + 0.01f * (tr - br));
    l = l * gain * bl; r = r * gain * br;
  }
  void reset(const float* p) override { gain = tg = levAmp(p[1]); bl = br = tl = tr = 1; refresh(p, 0); }
};

struct CompressorState : State {
  float held = 0, env = 0; size_t holdRem = 0, holdFrames = 0; float atk = 1, rel = 0, thr = 1, invRatio = 1, detGain = 1, makeup = 1;
  float gr = 0;
  void refresh(const float* p, float sr) override {
    float as = 0.05f * sq(p[3]); atk = as < 1.0f / sr ? 1.0f : 1.0f - std::pow(0.1f, 1.0f / (sr * as));
    holdFrames = (size_t)std::trunc(sr * 0.05f * sq(p[6]));
    float rs = 0.01f + 0.49f * sq(p[4]); rel = std::pow(0.1f, 1.0f / (sr * rs));
    thr = dbAmp(-40.0f + 40.0f * p[1]);
    float ratio = 1.0f + 19.0f * sq(p[2]);
    if (ratio >= 20.0f) invRatio = 0; else if (thr >= 1.0f) invRatio = 1.0f / ratio;
    else { float cu = dbAmp((-40.0f + 40.0f * p[1]) * (1.0f - 1.0f / ratio)); invRatio = (cu - thr) / std::max(1.0f - thr, MIN_POS); }
    detGain = dbAmp(-20.0f + 40.0f * p[8]);
    float autoG = p[7] >= 0.5f ? 1.0f / (thr + invRatio * (1.0f - thr)) : 1.0f;
    float lv = p[7] >= 0.5f ? -20.0f + 40.0f * p[5] : 40.0f * p[5];
    makeup = dbAmp(lv) * autoG;
  }
  void frame(float& l, float& r) override {
    float det = std::max(std::fabs(l), std::fabs(r)) * detGain;
    if (det > held) { held = det; holdRem = holdFrames; } else if (holdRem > 0) holdRem--; else held = flushf(held * rel);
    env = flushf(env + atk * (held - env));
    float red = env < thr ? 1.0f : (thr + invRatio * (env - thr)) / std::max(env, MIN_POS);
    gr = -20.0f * std::log10(std::max(red, MIN_POS));
    float g = red * makeup; l *= g; r *= g;
  }
  void reset(const float*) override { held = env = 0; holdRem = 0; gr = 0; }
};

struct DistortionState : State {
  float dl = 0, dr = 0, bias = 0, outG = 1; int mode = 0; size_t holdI = 1, holdRem = 0; float hl = 0, hr = 0, bfl = 0, bfr = 0, bstep = 0;
  void refresh(const float* p, float sr) override {
    float left = std::min(2.0f * p[4], 1.0f), right = std::min(2.0f - 2.0f * p[4], 1.0f), d = p[1];
    mode = (int)std::trunc(3.0f * p[5]);
    if (mode == 0) { dl = std::pow(10.0f, 5.0f * d * left) - 1.0f; dr = std::pow(10.0f, 5.0f * d * right) - 1.0f; }
    else if (mode == 1) { dl = std::pow(10.0f, 4.0f * d * left) - 0.99f; dr = std::pow(10.0f, 4.0f * d * right) - 0.99f; }
    else if (mode == 2) { dl = 20.0f * d * d * left; dr = 20.0f * d * d * right; }
    else { dl = std::pow(10.0f, 3.0f * d * d * left); dr = std::pow(10.0f, 3.0f * d * d * right); }
    float b = 2.0f * p[6] - 1.0f; bias = b * b * b * b * b;
    outG = std::pow(10.0f, 1.2f * p[3] - 1.2f);
    holdI = 1 + (size_t)std::trunc(256.0f * sq(sq(p[2])));
    bstep = 220.5f / sr;
  }
  float shape(float x, float drive) const {
    float s = x + bias;
    if (mode == 0) return (drive + 1.0f) * s / (1.0f + drive * std::fabs(s));
    if (mode == 1) return std::tanh(drive * s) / std::tanh(drive);
    if (mode == 2) return s >= 0.0f ? 1.0f + (s - 1.0f) * std::pow(10.0f, -drive * s) : -1.0f + (s + 1.0f) * std::pow(10.0f, drive * s);
    return clampf(drive * s, -1.0f, 1.0f);
  }
  void frame(float& l, float& r) override {
    if (holdRem == 0) { hl = shape(l, dl); hr = shape(r, dr); holdRem = holdI; }
    holdRem--;
    float a = hl * outG, b = hr * outG;
    if (bias != 0.0f) { bfl = flushf(bfl + (a - bfl) * bstep); bfr = flushf(bfr + (b - bfr) * bstep); a -= bfl; b -= bfr; }
    l = a; r = b;
  }
  void reset(const float*) override { holdRem = 0; hl = hr = bfl = bfr = 0; }
};

struct LegacyLimiterState : State {
  float thr = 1, outG = 1, step = 0, ph = 1, base = 1;
  void refresh(const float* p, float sr) override {
    thr = std::pow(10.0f, 1.2f * p[1] - 1.2f); outG = std::pow(10.0f, (36.0f * p[3] - 24.0f) * 0.05f);
    float rf = 1.0f + 100.0f * sq(0.2f * (1.0f - p[2])); step = rf / sr;
  }
  void frame(float& l, float& r) override {
    float peak = std::max(std::fabs(l), std::fabs(r)), s = std::sin(ph * 1.5708f);
    float red = 1.0f + (s * s - 1.0f) * (1.0f - base);
    if (red * peak > thr) { red = thr / peak; ph = 0; base = red; }
    ph = std::min(ph + step, 1.0f);
    float g = outG * red / thr; l *= g; r *= g;
  }
  void reset(const float*) override { ph = 1; base = 1; }
};

struct LookaheadLimiterState : State {
  float inG = 1, outG = 1, thr = 1, relS = 0.1f, sr = 0; std::vector<float> dl, dr; size_t w = 0; float ph = 1, held = 1, gain = 1;
  void refresh(const float* p, float rate) override {
    inG = std::pow(10.0f, (48.0f * p[1] - 24.0f) * 0.05f); outG = std::pow(10.0f, (48.0f * p[2] - 24.0f) * 0.05f);
    relS = 0.1f + 1.9f * sq(sq(p[3])); thr = std::pow(10.0f, (24.0f * p[4] - 24.0f) * 0.05f);
    if (rate != sr) { sr = rate; size_t n = (size_t)std::trunc(rate * 0.002f); dl.assign(n, 0); dr.assign(n, 0); reset(p); }
  }
  void frame(float& l, float& r) override {
    float il = l * inG, ir = r * inG, peak = std::max(std::fabs(l * inG), std::fabs(r * inG));
    float rs = 0;
    if (ph > 0) { float s = std::sin(ph * HALF_PI_F); ph -= 1.0f / (sr * relS); if (ph <= 0) { ph = 0; rs = 0; } else rs = s; }
    float g = held + (1.0f - held) * (1.0f - rs); gain = g;
    if (g * peak > thr) { ph = 1; held = thr / peak; }
    if (dl.empty()) { l = il * g * outG; r = ir * g * outG; return; }
    float a = dl[w], b = dr[w]; dl[w] = il; dr[w] = ir; if (++w == dl.size()) w = 0;
    l = a * g * outG; r = b * g * outG;
  }
  void reset(const float*) override { std::fill(dl.begin(), dl.end(), 0.0f); std::fill(dr.begin(), dr.end(), 0.0f); w = 0; ph = 1; held = 1; gain = 1; }
};

struct AutoDuckState : State {
  bool modern; float p[8] = {}; double phase = 0, step = 0; float gain = -1;
  explicit AutoDuckState(bool m) : modern(m) {}
  int n = 4;
  void refresh(const float* q, float) override { for (int i = 0; i < n; i++) p[i] = q[i]; }
  void prepare(float bpm, double sb, float sr, int) override { if (sb >= 0) phase = sb - std::trunc(sb); step = (double)bpm / ((double)sr * 60.0); }
  float legacy() const { float atk = p[2] * 0.5f + 0.001f, ph = (float)phase; float v = ph < atk ? ph / atk : 1.0f + (atk - ph) / (1.0f - atk); return std::pow(clampf(v, 0, 1), p[3] * 0.5f + 0.5f); }
  float modernCurve() const {
    float ph = remEuclid((float)phase + 0.5f - p[5], 1.0f), atk = p[2] * 0.5f + 0.001f, time = std::max(p[4], 0.001f), he = p[6] * time + atk;
    float v = ph < atk ? ph / atk : (ph >= time ? 0.0f : (ph < he ? 1.0f : 1.0f + (he - ph) / (time - he)));
    v = clampf(v, 0, 1); if (v == 0.0f) return 0;
    int shape = (int)std::trunc(p[7] * 5.0f); float c = p[3];
    if (ph < atk || shape == 0) return std::pow(v, c * 0.5f + 0.5f);
    switch (shape) {
      case 1: return std::pow(v, 0.1f + 0.9f * c);
      case 2: return std::pow(v, 3.0f - 2.0f * c);
      case 3: return std::pow(v, 6.0f - 5.0f * c);
      case 4: case 5: { float st = shape == 4 ? 2.0f : 5.0f, e = (1.0f - c) * st + 1.0f, d = std::min(v, 1.0f - v); float h = 0.5f * std::pow(2.0f, e) * std::pow(d, e); return v < 0.5f ? h : 1.0f - h; }
      default: return v;
    }
  }
  void frame(float& l, float& r) override {
    float t = modern ? 1.0f - modernCurve() * std::sqrt(p[1]) : 1.0f - legacy() * sq(p[1]);
    gain = gain >= 0 ? gain + (t - gain) * 0.01f : t;
    phase += step; if (phase >= 1.0) phase -= 1.0;
    l *= gain; r *= gain;
  }
  void reset(const float*) override { phase = 0; gain = -1; }
};

struct TremoloState : State {
  double ph[2] = {}, inc = 0; float osc[2] = {}, sg[2] = {}, mn = 0, mx = 1, phOff = 0, stOff = 0; double shape = 0, smooth = 0, skew = 0.5, width = 0;
  bool synced = false; double period = 1; float ft = -1, fc = 0, fs = 0, gs = 0;
  void refresh(const float* p, float sr) override {
    mx = p[3]; mn = p[4]; phOff = p[5]; stOff = p[6]; synced = p[7] > 0.5f;
    shape = (double)(2.0f * p[8] - 1.0f); smooth = (double)(0.001f + 0.998f * p[9]); skew = (double)(0.001f + 0.998f * p[10]); width = (double)(0.999f - 1.998f * p[11]);
    static const double BP[10] = { 0.125, 0.25, 0.375, 0.5, 0.75, 1.0, 2.0, 4.0, 8.0, 16.0 };
    period = BP[std::min((int)std::trunc(p[2] * 9.0f), 9)];
    float f = 0.1f + 19.9f * p[1]; if (f != ft) { ft = f; fc = f; }
    fs = 1.0f - 44.1f / sr; gs = (float)std::exp(-2094.39508 / (double)sr);
  }
  void prepare(float bpm, double sb, float sr, int) override {
    if (synced) { inc = (double)bpm / (period * 60.0 * (double)sr); if (sb >= 0) { double x = fractd(sb / period); ph[0] = ph[1] = x; } }
    else inc = (double)fc / (double)sr;
  }
  float wave(double phase, float off) const {
    double x = fractd(phase + (double)off), rising = x / skew, falling = (1.0 - x) / (1.0 - skew), tri = std::min(rising, falling);
    double un = std::max(-1.0, std::min(1.0, (2.0 * tri - 1.0 - width) / (1.0 - std::fabs(width))));
    double e = std::exp2(shape * 4.0), sgn = un > 0 ? 1.0 : (un < 0 ? -1.0 : (std::signbit(un) ? -1.0 : 1.0));
    double angle = sgn * 1.5707963267948966 * std::pow(std::fabs(un), e), lin = angle * 0.6366197723675814;
    return (float)(lin + (std::sin(angle) - lin) * smooth);
  }
  void frame(float& l, float& r) override {
    float span = (mx - mn) * 0.495f;
    float tl = clampf(mn + span * (osc[0] + 1.0f), mn, mx), tr = clampf(mn + span * (osc[1] + 1.0f), mn, mx);
    sg[0] = flushf(tl + (sg[0] - tl) * gs); sg[1] = flushf(tr + (sg[1] - tr) * gs);
    l *= sg[0]; r *= sg[1];
    osc[0] = wave(ph[0], phOff); osc[1] = wave(ph[1], phOff + stOff);
    ph[0] = fractd(ph[0] + inc); ph[1] = fractd(ph[1] + inc);
    fc = ft + (fc - ft) * fs;
  }
  void reset(const float*) override { ph[0] = ph[1] = 0; inc = 0; osc[0] = osc[1] = 0; sg[0] = sg[1] = 0; fc = ft; }
};

struct ChorusState : State {
  std::vector<float> buf; size_t w = 0; float ph[2] = { 0.62f, 0.1f }, step[2] = {}, depth = 0, stereo = 0, mix = 0;
  void refresh(const float* p, float sr) override {
    size_t n = (size_t)std::max(std::trunc(sr * 0.01f), 1.0f);
    if (buf.size() != n) { buf.assign(n, 0); reset(p); }
    float rate = 0.2f + 4.0f * sq(p[1]); step[0] = rate / sr; step[1] = (rate + 0.1f) / sr;
    depth = 0.04f + 0.36f * p[2]; stereo = p[3]; mix = sq(p[4]);
  }
  float fwd(float off) const { size_t whole = (size_t)std::trunc(off); float fr = fractf(off); size_t a = (w + whole) % buf.size(), b = (a + 1) % buf.size(); return buf[a] + fr * (buf[b] - buf[a]); }
  void frame(float& l, float& r) override {
    size_t n = buf.size(); buf[w] = l + r;
    float ml = std::sin(ph[0] * TAU_F) * depth + 0.5f, mr = std::sin(ph[1] * TAU_F) * depth + 0.5f;
    float first = sq(ml) * depth * (float)n;
    float tl = fwd(first), tr = fwd(mr);
    ph[0] = fractf(ph[0] + step[0]); ph[1] = fractf(ph[1] + step[1]);
    if (++w == n) w = 0;
    float cross = 1.0f - stereo;
    float a = l + (tl + tr * cross) * mix, b = r + (tr + tl * cross) * mix; l = a; r = b;
  }
  void reset(const float*) override { std::fill(buf.begin(), buf.end(), 0.0f); w = 0; ph[0] = 0.62f; ph[1] = 0.1f; }
};

static const double PERIODS13[13] = { 0.25, 0.375, 0.5, 0.75, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0, 128.0, 256.0 };
static float simpleLfo(int shape, double ph) { if (shape == 1) return (float)(2.0 * ph - 1.0); if (shape == 2) return ph <= 0.5 ? -1.0f : 1.0f; return (float)std::sin(ph * 6.283185307179586); }

struct PhaserState : State {
  float st[2][6] = {}, fbo[2] = {}; double phase = 0, inc = 0, period = 1; float freeHz = 0; bool synced = false; int shape = 0; double stOff = 0;
  float lo = 0, hi = 0, center = 0, depth = 0, fb = 0, mix = 0;
  void refresh(const float* p, float sr) override {
    period = PERIODS13[std::min((int)std::trunc(p[1] * 12.0f), 12)]; depth = 0.25f * cube(p[2]); fb = 0.95f * p[3]; center = sq(p[4]); mix = sq(p[5]);
    synced = p[6] != 0.0f; freeHz = 0.1f + 9.9f * cube(p[7]); shape = std::min((int)std::round(p[8] * 2.0f), 2); stOff = (double)p[9] * 0.5;
    lo = 50.0f / sr; hi = std::min(16000.0f / sr, 0.499f);
  }
  void prepare(float bpm, double sb, float sr, int) override {
    if (synced) { if (sb >= 0) phase = fractd(sb / period); inc = (double)bpm / (60.0 * period * (double)sr); }
    else inc = (double)freeHz / (double)sr;
  }
  float coef(double ph) const {
    float o = shape == 1 ? (float)(2.0 * ph - 1.0) : shape == 2 ? (ph <= 0.5 ? -1.0f : 1.0f) : (float)std::sin(ph * 6.283185307179586);
    float f = clampf(lo + (center + depth * o) * (hi - lo), lo, hi); return (1.0f - f) / (1.0f + f);
  }
  float chan(int c, float in, float k) {
    float s = in + 1e-30f + fb * fbo[c];
    for (int i = 0; i < 6; i++) { float o = st[c][i] - k * s; st[c][i] = s + k * o; s = o; }
    fbo[c] = s; return in + mix * s;
  }
  void frame(float& l, float& r) override {
    float kl = coef(phase), kr = coef(fractd(phase + stOff)); phase = fractd(phase + inc);
    l = chan(0, l, kl); r = chan(1, r, kr);
  }
  void reset(const float*) override { std::memset(st, 0, sizeof st); fbo[0] = fbo[1] = 0; phase = 0; inc = 0; }
};

struct StereoizerState : State {
  std::vector<float> sh, lh, rh; size_t sw = 0, sdw = 0; float shD = 0, lD = 0, rD = 0, fs = 0, fc = 0; bool hp = false; float strength = 0, pt[2] = {}, pc[2] = {};
  void refresh(const float* p, float sr) override {
    size_t shl = (size_t)std::max(std::trunc(sr * 0.05f), 2.0f), sdl = (size_t)std::max(std::trunc(sr * 0.025f), 2.0f);
    if (sh.size() != shl) { sh.assign(shl, 0); sw = 0; }
    if (lh.size() != sdl) { lh.assign(sdl, 0); rh.assign(sdl, 0); sdw = 0; }
    strength = sq(p[1]); float mn = std::trunc(sr * 0.0005f); shD = mn + cube(p[2]) * ((float)shl - mn - 1.0f);
    float focus = 1.0f - 2.0f * p[3]; hp = focus < 0.0f; float base = hp ? 0.99f : 0.8f;
    fc = hp ? cube(-base * focus) : cube(1.0f - base * focus);
    float side = cube(2.0f * p[4] - 1.0f) * (float)(sdl - 1); lD = std::max(-side, 0.0f); rD = std::max(side, 0.0f);
    pt[0] = clampf(2.0f - 2.0f * p[5], 0, 1); pt[1] = clampf(2.0f * p[5], 0, 1);
  }
  void frame(float& l, float& r) override {
    float wl = l, wr = r;
    if (strength > 0.001f) { float tap = readFractional(sh, sw, shD); fs = flushf(fs + fc * (tap - fs)); float comp = hp ? tap - fs : fs; wl += strength * comp; wr -= strength * comp; }
    sh[sw] = l + r; sw = (sw + 1) % sh.size();
    float ol = lD > 0.9f ? readFractional(lh, sdw, lD) : wl, orr = rD > 0.9f ? readFractional(rh, sdw, rD) : wr;
    lh[sdw] = wl; rh[sdw] = wr; sdw = (sdw + 1) % lh.size();
    for (int c = 0; c < 2; c++) { pc[c] += 0.01f * (pt[c] - pc[c]); if (std::fabs(pc[c] - pt[c]) < 0.001f) pc[c] = pt[c]; }
    l = ol * pc[0]; r = orr * pc[1];
  }
  void reset(const float*) override { std::fill(sh.begin(), sh.end(), 0.0f); std::fill(lh.begin(), lh.end(), 0.0f); std::fill(rh.begin(), rh.end(), 0.0f); sw = sdw = 0; fs = 0; pc[0] = pt[0]; pc[1] = pt[1]; }
};

struct SpacerState : State {
  std::vector<float> path[4]; size_t pos[2] = {}; float maxD[2] = {}, ctl[4] = { 0.5f, 0.5f, 0.5f, 0.5f }, tgt[4] = { 0.5f, 0.5f, 0.5f, 0.5f }; int invLR = 0, invMS = 0, mode = 0;
  void refresh(const float* p, float sr) override {
    tgt[0] = p[1]; tgt[1] = p[2]; tgt[2] = p[3]; tgt[3] = p[5];
    invLR = (int)std::round(p[4] * 3.0f); invMS = (int)std::round(p[6] * 3.0f); mode = (int)std::round(p[7] * 2.0f);
    maxD[0] = sr * 0.3f; maxD[1] = sr * 0.1f;
    size_t sizes[2] = { nextPow2((size_t)std::ceil(maxD[0])), nextPow2((size_t)std::ceil(maxD[1])) };
    for (int i = 0; i < 4; i++) { size_t s = std::max(sizes[i / 2], (size_t)2); if (path[i].size() != s) { path[i].assign(s, 0); pos[i / 2] = 0; } }
  }
  void frame(float& il, float& ir) override {
    for (int i = 0; i < 4; i++) ctl[i] += 0.001f * (tgt[i] - ctl[i]);
    float lrs = cube(2.0f * ctl[0] - 1.0f); size_t rl = pos[0];
    float left = writeAndRead(path[0], rl, il, clampf(maxD[0] * lrs, 0, maxD[0]));
    float right = writeAndRead(path[1], rl, ir, clampf(-maxD[0] * lrs, 0, maxD[0]));
    pos[0] = (rl + 1) % path[0].size();
    if (invLR & 1) left = -left; if (invLR & 2) right = -right;
    float sep = ctl[2];
    if (sep < 0.5f) { float half = 0.5f - sep, al = left - half * right; right = right - half * al; left = al; }
    else { float mid = 0.5f * (left + right), side = (left - right) * (1.0f - sep); left = mid + side; right = mid - side; }
    float pan = ctl[1];
    if (pan != 0.5f) { left *= std::min(2.0f - 2.0f * pan, 1.0f); right *= std::min(2.0f * pan, 1.0f); }
    if (mode != 2) { float mid = 0.5f * (left + right), side = 0.5f * (left - right); left = mid; right = side; }
    if (invMS & 1) left = -left; if (invMS & 2) right = -right;
    float mss = 2.0f * ctl[3] - 1.0f; mss = mss * mss * mss * mss * mss; size_t rm = pos[1];
    float mid = writeAndRead(path[2], rm, left, clampf(maxD[1] * mss, 0, maxD[1]));
    float side = writeAndRead(path[3], rm, right, clampf(-maxD[1] * mss, 0, maxD[1]));
    pos[1] = (rm + 1) % path[2].size();
    if (mode == 1) { il = mid; ir = side; } else { il = mid + side; ir = mid - side; }
  }
  void reset(const float*) override { for (auto& x : path) std::fill(x.begin(), x.end(), 0.0f); pos[0] = pos[1] = 0; }
};

static float gateCurve(float ph, float c) {
  if (c == 0.0f || ph == 0.0f || ph == 1.0f) return ph;
  float curved = c > 0.0f ? std::exp(ph * LN10_F * 3.0f - LN10_F * 3.0f) : std::max(1.0f + std::log(ph) / (LN10_F * 3.0f), 0.0f);
  return ph + std::fabs(c) * (curved - ph);
}
struct GateState : State {
  float hist[2][256] = {}; size_t w = 0; float sums[2] = {}, lv[2] = { -60, -60 }, phase = 0, gain = 0; bool open = false; size_t holdRem = 0;
  float thrDb = -60, asym = 0, atk = 1, rel = 1, ac = -1, rc = 1; size_t holdF = 0; float floor_ = 0.001f; bool inv = false;
  void refresh(const float* p, float sr) override {
    thrDb = -60.0f + 66.0f * p[1]; asym = 66.0f * sq(p[2]);
    atk = p[3] == 0.0f ? 1.0f : 1.0f / (sr * p[3]); ac = 2.0f * p[4] - 1.0f;
    rel = p[5] == 0.0f ? 1.0f : 1.0f / (sr * p[5]); rc = 2.0f * p[6] - 1.0f;
    float mix = 2.0f * p[7] - 1.0f; floor_ = std::pow(10.0f, -3.0f * std::fabs(mix)); inv = mix < 0.0f;
    holdF = (size_t)std::trunc(sr * p[8]);
  }
  void frame(float& l, float& r) override {
    hist[0][w] = l; hist[1][w] = r; sums[0] += l * l; sums[1] += r * r; w = (w + 1) & 255;
    if (w == 0) for (int c = 0; c < 2; c++) { float s = sums[c]; sums[c] = 0; lv[c] = s <= 0.0f ? -60.0f : 10.0f * std::log10(s / 256.0f); }
    float level = std::max(lv[0], lv[1]);
    if (level > thrDb) { open = true; holdRem = holdF; } else if (level < thrDb - asym) { if (holdRem > 0) holdRem--; else open = false; }
    phase = open ? std::min(phase + atk, 1.0f) : std::max(phase - rel, 0.0f);
    float shaped = gateCurve(phase, open ? ac : rc), env = inv ? 1.0f - shaped : shaped;
    float t = floor_ + (1.0f - floor_) * env; gain += 0.1f * (t - gain);
    l = hist[0][w] * gain; r = hist[1][w] * gain;
  }
  void reset(const float*) override { std::memset(hist, 0, sizeof hist); w = 0; sums[0] = sums[1] = 0; lv[0] = lv[1] = -60; phase = 0; gain = 0; open = false; holdRem = 0; }
};

struct VariableDelay {
  std::vector<float> buf; size_t w = 0; float cur = 0, tgt = 0;
  void resize(size_t mx) { size_t n = std::max(mx, (size_t)4) + 3; if (buf.size() != n) { buf.assign(n, 0); w = 0; } }
  void setTarget(float s) { tgt = clampf(s, 2.0f, (float)(buf.size() - 2)); }
  float run(float in, float fb) { cur += 0.001f * (tgt - cur); float d = readFractional(buf, w, cur); buf[w] = flushf(in + fb * d); w = (w + 1) % buf.size(); return d; }
  void reset() { std::fill(buf.begin(), buf.end(), 0.0f); w = 0; cur = tgt; }
};

struct TapeDelayState : State {
  VariableDelay ln[2]; float mx = 4, nd[2] = {}, fb = 0, wet = 0;
  void refresh(const float* p, float sr) override {
    size_t cap = (size_t)std::trunc(sr); mx = (float)std::max(cap, (size_t)4); ln[0].resize(cap); ln[1].resize(cap);
    float base = sq(p[1]), av = p[3];
    if (av < 0.5f) { nd[0] = base * (av + 0.5f); nd[1] = base; } else if (av > 0.5f) { nd[0] = base; nd[1] = base * (1.5f - av); } else { nd[0] = nd[1] = base; }
    for (int c = 0; c < 2; c++) ln[c].setTarget(2.0f + (mx - 2.0f) * nd[c]);
    fb = p[2]; wet = p[4] * p[2];
  }
  void frame(float& l, float& r) override { float a = ln[0].run(l, fb), b = ln[1].run(r, fb); l = l + wet * a; r = r + wet * b; }
  void reset(const float*) override { ln[0].reset(); ln[1].reset(); }
};

struct FlangerState : State {
  VariableDelay ln[2]; double phase = 0, inc = 0, period = 1; float freeHz = 0; bool synced = false; int shape = 0; float depth = 0, base = 0; double stOff = 0; float fb = 0, mix = 0, cap = 4;
  void refresh(const float* p, float sr) override {
    period = PERIODS13[std::min((int)std::trunc(p[1] * 12.0f), 12)]; synced = p[2] != 0.0f; freeHz = 0.1f + 9.9f * cube(p[3]);
    shape = std::min((int)std::round(p[4] * 2.0f), 2); base = 0.5f * sq(p[6]); depth = 0.5f * base * p[5];
    fb = p[7] * (p[8] != 0.0f ? -1.0f : 1.0f); stOff = 0.5 * (double)p[9]; mix = sq(p[10]) * (p[11] != 0.0f ? -1.0f : 1.0f);
    size_t c = (size_t)std::trunc(sr * 0.005f); cap = (float)std::max(c, (size_t)4);
    for (auto& x : ln) { x.resize(c); x.setTarget(2.0f + (cap - 2.0f) * base); }
  }
  void prepare(float bpm, double sb, float sr, int) override {
    if (synced) { if (sb >= 0) phase = fractd(sb / period); inc = (double)bpm / (60.0 * period * (double)sr); } else inc = (double)freeHz / (double)sr;
  }
  void frame(float& l, float& r) override {
    float wv[2] = { simpleLfo(shape, phase), simpleLfo(shape, fractd(phase + stOff)) }; phase = fractd(phase + inc);
    for (int c = 0; c < 2; c++) ln[c].setTarget(2.0f + (cap - 2.0f) * clampf(base + depth * wv[c], 0, 1));
    float a = ln[0].run(l, fb), b = ln[1].run(r, fb); l = l + mix * a; r = r + mix * b;
  }
  void reset(const float*) override { ln[0].reset(); ln[1].reset(); phase = 0; inc = 0; }
};

static double wowPeriod(float v) { static const double P[10] = { 0.125, 0.25, 0.375, 0.5, 0.75, 1.0, 2.0, 4.0, 8.0, 16.0 }; return P[std::min((int)std::trunc(v * 9.0f), 9)]; }
struct WowFlutterState : State {
  std::vector<float> ln[2]; size_t w = 0; float sr = 0, wowMax = 0, flMax = 0, wdT = 0, wd = 0, fdT = 0, fd = 0, baseRate = 1, rateT = 1, rate = 1, flRate = 6, rndRate = 1, raT = 0, ra = 0;
  double wowP = 0.25, flP = 0.125; bool synced = false; double ph[2] = {}, inc[2] = {}; float out[2] = {}; size_t cd = 0; uint64_t seed = 0x9e3779b97f4a7c15ull;
  void refresh(const float* p, float rate_) override {
    sr = rate_; wowMax = 0.142f * sr; flMax = 0.003f * sr;
    size_t n = nextPow2(std::max((size_t)std::ceil(wowMax + flMax), (size_t)2));
    for (auto& x : ln) if (x.size() != n) { x.assign(n, 0); w = 0; }
    float b = 0.1f + 4.9f * p[1]; if (b != baseRate) { baseRate = b; rateT = b; }
    wowP = wowPeriod(p[2]); wdT = std::expm1(5.0f * p[3]) * 0.006783655f; flRate = 5.0f + 15.0f * p[4]; flP = wowPeriod(p[5]); fdT = p[6];
    synced = p[7] > 0.5f; rndRate = 0.1f + 9.9f * p[8]; raT = p[10];
  }
  void prepare(float bpm, double sb, float rate_, int) override {
    if (synced) {
      inc[0] = (double)bpm / (60.0 * wowP * (double)rate_); inc[1] = (double)bpm / (60.0 * flP * (double)rate_);
      if (sb >= 0) { ph[0] = fractd(sb / wowP); ph[1] = fractd(sb / flP); }
    } else { inc[0] = (double)rate / (double)rate_; inc[1] = (double)flRate / (double)rate_; }
  }
  void frame(float& l, float& r) override {
    float sm = 44.1f / sr; wd += sm * (wdT - wd); fd += sm * (fdT - fd); ra += sm * (raT - ra); rate += sm * (rateT - rate);
    if (cd == 0) {
      seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17;
      float fr = (float)(seed >> 40) / (float)(1ull << 24);
      float lo = baseRate + (0.1f - baseRate) * ra, hi = baseRate + (5.0f - baseRate) * ra;
      rateT = lo + fr * (hi - lo); cd = (size_t)std::max(sr / rndRate, 1.0f);
    }
    cd--;
    float wdl = clampf(0.5f * wowMax * (1.0f + out[0]) * wd, 0, wowMax), fdl = clampf(0.5f * flMax * (1.0f + out[1]) * fd, 0, flMax), d = wdl + fdl;
    float a = writeAndRead(ln[0], w, l, d), b = writeAndRead(ln[1], w, r, d); w = (w + 1) % ln[0].size();
    for (int c = 0; c < 2; c++) { out[c] = (float)std::sin(6.283185307179586 * ph[c]); ph[c] = fractd(ph[c] + inc[c]); }
    if (!synced) inc[0] = (double)rate / (double)sr;
    l = a; r = b;
  }
  void reset(const float*) override { for (auto& x : ln) std::fill(x.begin(), x.end(), 0.0f); w = 0; ph[0] = ph[1] = 0; out[0] = out[1] = 0; cd = 0; }
};

struct TranceDelayState : State {
  std::vector<float> L, R, A; size_t il = 0, ir = 0, ia = 0, delay = 1; float sr = 0; double period = 1; int mode = 0; float fb = 0, mix = 0, filt = 0, fst[2] = {}, inPan = 0.5f, curPan = -1;
  void refresh(const float* p, float rate) override {
    if (sr != rate) { sr = rate; size_t n = (size_t)std::max(std::trunc(rate * 2.0f), 1.0f); L.assign(n, 0); R.assign(n, 0); A.assign(n, 0); reset(p); }
    int m = (int)std::trunc(std::fma((double)p[5], 2.0, 0.5)); if (m != mode) { mode = m; reset(p); }
    static const double BP[5] = { 0.25, 0.375, 0.5, 0.75, 1.0 }; period = BP[std::min((int)std::trunc(p[1] * 4.0f), 4)];
    fb = p[2] * 0.99f; mix = sq(p[3]); filt = p[4]; inPan = p[6];
  }
  void prepare(float bpm, double, float rate, int) override {
    size_t f = (size_t)std::trunc((double)rate * 60.0 * period / (double)bpm); delay = std::min(std::max(f, (size_t)1), L.size());
  }
  float filter(int c, float in) {
    float ctl = filt * 2.0f, k = ctl <= 1.0f ? ctl : sq(sq(ctl - 1.0f));
    fst[c] = flushf(fst[c] + (in - fst[c]) * k); return ctl <= 1.0f ? fst[c] : in - fst[c];
  }
  void frame(float& l, float& r) override {
    if (mode == 1) {
      if (il >= delay) il = 0; if (ir >= delay) ir = 0;
      if (curPan < 0.0f) curPan = inPan; else if (curPan != inPan) { curPan += (inPan - curPan) * 0.01f; if (std::fabs(inPan - curPan) < 0.001f) curPan = inPan; }
      float lw = clampf(2.0f - 2.0f * curPan, 0, 1), rw = clampf(2.0f * curPan, 0, 1);
      float wl = filter(0, L[il] + 1e-30f), wr = filter(1, R[ir] + 1e-30f);
      L[il] = (r * rw + wr) * fb; R[ir] = (l * lw + wl) * fb; il = (il + 1) % delay; ir = (ir + 1) % delay;
      l = l + flushf(mix * wl); r = r + flushf(mix * wr); return;
    }
    float dl = l;
    if (mode == 2) { size_t n = delay; if (ia >= n) ia = 0; A[ia] = l; ia = (ia + 1) % n; dl = A[ia]; }
    size_t n = mode == 2 ? std::min(delay * 2, L.size()) : delay;
    if (il >= n) il = 0; if (ir >= n) ir = 0;
    float wl = filter(0, L[il] + 1e-30f), wr = filter(1, R[ir] + 1e-30f);
    L[il] = (dl + wl) * fb; R[ir] = (r + wr) * fb; il = (il + 1) % n; ir = (ir + 1) % n;
    l = dl + flushf(mix * wl); r = r + flushf(mix * wr);
  }
  void reset(const float*) override { std::fill(L.begin(), L.end(), 0.0f); std::fill(R.begin(), R.end(), 0.0f); std::fill(A.begin(), A.end(), 0.0f); il = ir = ia = 0; fst[0] = fst[1] = 0; curPan = -1; }
};

// comb.rs
static float midiFreq(int note) { return note < 1 ? 0.0f : 440.0f * std::pow(2.0f, (float)note / 12.0f - 5.75f); }
static bool estimatePitch(const float* in, float sr, float& out) {
  float e = 0; for (int i = 0; i < 2048; i++) e += in[i] * in[i]; e /= 2048.0f;
  if (e < 1e-5f) return false;
  float cum = 0; int bestLag = -1; float bestN = 0;
  for (int lag = 2; lag < 1024; lag++) {
    float d = 0; for (int i = 0; i < 2048 - lag; i++) { float x = in[i] - in[i + lag]; d += x * x; }
    cum += d; float nrm = d * (float)lag / std::max(cum, 1e-20f);
    if (lag >= 24 && nrm < 0.12f) { if (bestLag < 0 || nrm < bestN) { bestLag = lag; bestN = nrm; } else break; }
  }
  if (bestLag < 0) return false;
  out = sr / (float)bestLag; return true;
}
struct CombState : State {
  VariableDelay ln[2]; float sr = 0; int mode = 0; float manual = 1; int oct = 0; float smoothing = 0.2f, asym = 0; int pol = 0; float fb = 0.8f, mix = 0.75f;
  int active = -1, last = -1; float cur[2] = {}, an[2048] = {}; size_t ai = 0; float tracked = 0, lp = 0;
  void refresh(const float* p, float rate) override {
    if (sr != rate) { sr = rate; for (auto& x : ln) x.resize((size_t)std::trunc(rate)); }
    mode = (int)std::trunc(2.0f * p[1]);
    manual = p[7] != 0.0f ? midiFreq((int)std::round(7.0f * p[10]) * 12 + (int)std::round(11.0f * p[11])) : 1.0f + 2499.0f * sq(sq(p[2]));
    oct = (int)std::round(4.0f * p[5] - 2.0f); smoothing = 0.2f - 0.1999f * sq(p[6]); asym = 0.1f * p[9] - 0.05f;
    pol = (int)std::trunc(3.0f * p[8]); fb = p[3]; mix = p[4];
  }
  void note(int n) { active = n; if (n >= 0) last = n; }
  float freq() const {
    float base = mode == 1 ? (active >= 0 ? midiFreq(active) : (last >= 0 ? midiFreq(last) : 1.0f)) : (mode == 2 ? std::max(tracked, 1.0f) : manual);
    return clampf(base * std::pow(2.0f, (float)oct), 1.0f, 20000.0f);
  }
  void frame(float& l, float& r) override {
    if (mode == 2) {
      float mono = 0.5f * (l + r), cut = 1.0f - std::exp(-TAU_F * 1250.0f / sr); lp += cut * (mono - lp);
      an[ai] = mono - lp;
      if (++ai == 2048) { ai = 0; float f; if (estimatePitch(an, sr, f) && (tracked == 0.0f || std::max(f / tracked, tracked / f) < 3.0f)) tracked = f; }
    }
    float f = freq(), tg[2] = { f * (1.0f - asym), f * (1.0f + asym) }, out[2], in[2] = { l, r };
    for (int c = 0; c < 2; c++) {
      cur[c] += (tg[c] - cur[c]) * smoothing; float cf = clampf(cur[c], 1.0f, 20000.0f);
      ln[c].setTarget(2.0f + (sr - 2.0f) / cf);
      float sgn = (pol & (1 << c)) ? -1.0f : 1.0f; float wet = ln[c].run(in[c], fb * sgn); out[c] = in[c] + mix * wet;
    }
    l = out[0]; r = out[1];
  }
  void reset(const float*) override {
    tracked = 0; float f = freq(); cur[0] = f * (1.0f - asym); cur[1] = f * (1.0f + asym);
    for (int c = 0; c < 2; c++) { ln[c].setTarget(2.0f + (sr - 2.0f) / cur[c]); ln[c].reset(); }
    std::memset(an, 0, sizeof an); ai = 0; lp = 0;
  }
};

// ---------------- reverbs.rs ----------------
static const float LATE[4] = { 0.0297f, 0.0371f, 0.0411f, 0.0437f };
struct RDelay {
  std::vector<float> s; size_t cur = 0;
  void init(float sec, float sr) { s.assign((size_t)std::ceil(sec * sr) + 4, 0); cur = 0; }
  float read(float frames) const {
    size_t n = s.size(); float len = (float)n, back = (float)cur - clampf(frames, 1.0f, len - 2.0f), pos = back < 0 ? back + len : back;
    size_t whole = (size_t)pos, i = whole >= n ? whole - n : whole, nx = i + 1 == n ? 0 : i + 1;
    return s[i] + (s[nx] - s[i]) * (pos - (float)whole);
  }
  void push(float x) { s[cur] = flushf(x); cur = cur + 1 == s.size() ? 0 : cur + 1; }
  void clear() { std::fill(s.begin(), s.end(), 0.0f); cur = 0; }
};
static float onePole(float f, float sr) { return f <= 0.0f ? 0.0f : 1.0f - std::exp(-TAU_F * std::min(f, 0.45f * sr) / sr); }
struct ReverbState : State {
  int id; float sr = 0; std::vector<float> p; RDelay pre[2], dif[4], early[2], late[4]; float lowS[2] = {}, highS[2] = {}, damp[4] = {}, bass[4] = {}, gn[4] = {}, gb[4] = {};
  float phase = 0, preF = 0, lowCut = 0, highCut = 1, damping = 1, xover = 0, decay = 1, room = 1, diffusion = 0.5f, modRate = 0, modDepth = 0, wetL = 1, earlyL = 0.25f, dryL = 1, pan = 0.5f;
  explicit ReverbState(int i) : id(i) {}
  void alloc(float rate) { sr = rate; for (auto& d : pre) d.init(1.1f, sr); for (auto& d : dif) d.init(0.02f, sr); for (auto& d : early) d.init(0.1f, sr); for (auto& d : late) d.init(0.2f, sr); lowS[0] = lowS[1] = highS[0] = highS[1] = 0; std::memset(damp, 0, sizeof damp); std::memset(bass, 0, sizeof bass); phase = 0; }
  void refresh(const float* q, float rate) override {
    if (rate != sr) alloc(rate);
    int n = id == 35 ? 19 : (id == 12 ? 22 : 16); p.assign(q, q + n);
    float low, high, dmp, rm, dec, dif_, rt, dp, pn;
    if (id == 35) {
      low = p[2] <= 0.0f ? 0.0f : 19.0f + 2981.0f * p[2]; high = p[1] >= 1.0f ? 20000.0f : 510.0f + 21580.0f * p[1];
      dmp = p[6] >= 1.0f ? 20000.0f : 510.0f + 21580.0f * p[6]; rm = p[3]; dec = 0.1f + 19.9f * p[4]; dif_ = p[5]; rt = p[16]; dp = p[13]; pn = p[18];
    } else {
      float r_, d_, lo, hi, ra, de, pa;
      if (id == 12) { r_ = p[5]; d_ = p[6]; lo = p[8]; hi = p[9]; ra = p[19]; de = p[20]; pa = 0.5f; }
      else { r_ = p[7]; d_ = p[8]; lo = p[10]; hi = p[11]; ra = p[12]; de = p[13]; pa = p[4]; }
      low = lo * 3000.0f; high = 500.0f + hi * 19500.0f; dmp = 500.0f + (1.0f - p[2]) * 19500.0f; rm = r_; dec = 0.15f + 9.85f * p[1] * p[1]; dif_ = d_; rt = ra; dp = de; pn = pa;
    }
    lowCut = onePole(low, sr); highCut = onePole(high, sr); damping = onePole(dmp, sr);
    xover = onePole(id == 35 ? 25.0f + 1975.0f * p[17] : (id == 12 ? 25.0f + 1975.0f * p[18] : 500.0f), sr);
    room = 0.4f + 1.4f * rm; decay = dec; diffusion = 0.15f + 0.55f * dif_; modRate = 0.05f + 2.0f * rt; modDepth = 12.0f * dp; pan = pn;
    if (id == 35) { dryL = 1.25f * p[7]; earlyL = 1.25f * p[8]; wetL = 1.25f * p[9]; }
    else if (id == 12) { dryL = 1.0f - p[3] + p[12]; earlyL = p[3] * p[11]; wetL = p[3]; }
    else { dryL = (1.0f - p[3]) * p[15]; earlyL = p[3] * p[5] * p[14]; wetL = p[3] * p[14]; }
    float bm = id == 35 ? 0.2f + 2.8f * p[14] : (id == 12 ? 1.0f + 2.0f * p[17] : 1.0f);
    for (int i = 0; i < 4; i++) { float g = std::pow(10.0f, -3.0f * (LATE[i] * room) / decay); gn[i] = g; gb[i] = std::pow(g, 1.0f / bm); }
    prep(120.0f);
  }
  void prep(float bpm) {
    float d = id == 35 ? (p[12] > 0.5f ? p[11] * 60.0f / std::max(bpm, 1.0f) : p[11]) : (id == 12 ? p[4] * 0.25f : p[6] * 0.25f);
    preF = std::min(d * sr, (float)pre[0].s.size() - 2.0f);
  }
  void prepare(float bpm, double, float, int) override { prep(bpm); }
  void frame(float& il, float& ir) override {
    float in[2] = { il, (id == 35 && p[10] > 0.5f) ? -ir : ir }, feed[2];
    for (int c = 0; c < 2; c++) {
      float d = preF < 1.0f ? in[c] : pre[c].read(preF); pre[c].push(in[c]);
      lowS[c] = flushf(lowS[c] + lowCut * (d - lowS[c])); float hp = d - lowS[c];
      highS[c] = flushf(highS[c] + highCut * (hp - highS[c])); feed[c] = highS[c];
    }
    if (id == 12) { feed[0] *= p[10]; feed[1] *= p[10]; }
    static const float AP[4] = { 0.0047f, 0.0079f, 0.0059f, 0.0113f };
    for (int c = 0; c < 2; c++) for (int s = 0; s < 2; s++) {
      int i = 2 * c + s; float dl = dif[i].read(AP[i] * sr), o = dl - diffusion * feed[c]; dif[i].push(feed[c] + diffusion * o); feed[c] = o;
    }
    float eL = 0.7f * early[0].read(0.0083f * sr) + 0.3f * early[1].read(0.0221f * sr);
    float eR = 0.7f * early[1].read(0.0117f * sr) + 0.3f * early[0].read(0.0193f * sr);
    early[0].push(feed[0]); early[1].push(feed[1]);
    float tail[4], fbk[4];
    for (int i = 0; i < 4; i++) {
      float ph = phase + (float)i * 0.25f, mv = modDepth * std::sin(TAU_F * ph), sec = LATE[i] * room;
      tail[i] = late[i].read(sec * sr + mv);
      damp[i] = flushf(damp[i] + damping * (tail[i] - damp[i])); bass[i] = flushf(bass[i] + xover * (damp[i] - bass[i]));
      fbk[i] = gn[i] * (damp[i] - bass[i]) + gb[i] * bass[i];
    }
    float sum = (((fbk[0] + fbk[1]) + fbk[2]) + fbk[3]) * 0.5f;
    for (int i = 0; i < 4; i++) late[i].push(0.25f * (i % 2 == 0 ? feed[0] : feed[1]) + fbk[i] - sum);
    phase = fractf(phase + modRate / sr);
    float wl = earlyL * eL + wetL * (tail[0] - tail[1] + tail[2] - tail[3]);
    float wr = earlyL * eR + wetL * (tail[0] + tail[1] - tail[2] - tail[3]);
    if (id == 35) {
      float sep = p[15];
      if (sep <= 0.5f) { float mid = 0.5f * (wl + wr), side = (1.0f - sep) * (wl - wr); wl = mid + side; wr = mid - side; }
      else { float side = 0.5f - sep; wl -= side * wr; wr = wl * side - wr; }
    } else { float width = id == 12 ? p[7] : p[9], mid = 0.5f * (wl + wr), side = width * 0.5f * (wl - wr); wl = mid + side; wr = mid - side; }
    float lw = std::min(2.0f - 2.0f * pan, 1.0f), rw = std::min(2.0f * pan, 1.0f);
    il = dryL * il + wl * lw; ir = dryL * ir + wr * rw;
  }
  void reset(const float*) override {
    for (auto& d : pre) d.clear(); for (auto& d : dif) d.clear(); for (auto& d : early) d.clear(); for (auto& d : late) d.clear();
    lowS[0] = lowS[1] = highS[0] = highS[1] = 0; std::memset(damp, 0, sizeof damp); std::memset(bass, 0, sizeof bass); phase = 0;
  }
};

// ---------------- the module (AudioEffect + CommonModule) ----------------
struct ModuleInfo { int id, n; const float* def; };
static const float D6[] = { 1, 0.25f, 0, 1, 0.5f, 0, 0.5f }, D5[] = { 1, 1, 0.7f, 2.0f / 3.0f }, D8[] = { 1, 0.499f, 0, 0.6f, 0.6f, 0.5001f, 0, 1, 0.5f, 0 },
  D9[] = { 1, 0.7f, 0, 0, 0.5f }, D10[] = { 1, 0.501f, 0.1f, 0.501f }, D11[] = { 1, 0.4f, 0.6f, 1, 0.6f },
  D12[] = { 1, 0.4f, 0.8f, 0.4f, 0, 1, 1, 1, 0, 1, 1, 0.25f, 0, 0, 0, 0, 0, 0, 0, 0.499f, 0, 0 },
  D13[] = { 1, 0.4f, 0, 0.55f, 0, 1, 0.25f, 0.75f, 1, 0, 1, 1 }, D14[] = { 1, 0.1122f, 0.25f, 0.1f, 0.25f, 1, 1, 0, 0, 1 },
  D15[] = { 1, 0.7f, 0.52f, 0.75f, 0.5f, 0.5f, 0 }, D16[] = { 1, 0.775f, 0.4f, 1, 0.5f, 0, 0.5f }, D18[] = { 1, 0.6f, 0.6f, 0.5f, 0.4f },
  D20[] = { 1, 0.738f, 0.5f }, D27[] = { 1, 0, 0, 0.01f, 0, 0.25f, 1, 1, 0.25f }, D28[] = { 1, 0.5f, 0.5f, 0.2f, 1 },
  D29[] = { 1, 0.501f, 0.1f, 0.501f, 1, 0.5f, 0, 0 }, D32[] = { 1, 0.4f, 0.8f, 0.4f, 0.5f, 0.25f, 0, 1, 1, 1, 0, 1, 0.499f, 0, 1, 1 },
  D34[] = { 1, 0.5f, 0.5f, 0.5f, 0, 0.5f, 0, 0 }, D35[] = { 1, 0.16f, 0.0187f, 0.5f, 0.068f, 1, 0.16f, 0.8f, 0.8f, 0.56f, 0, 0, 0, 0, 0.28f, 0.5f, 0.33f, 0.2405f, 0.5f },
  D40[] = { 1, 0, 0.33f, 0.8f, 0.75f, 0.5f, 0.25f, 1, 0, 0.5f, 0.5f, 0.4f },
  D43[] = { 1, 0.1846f, 0.2f, 0.25f, 0.0668f, 0.1f, 0.25f, 0, 0.0895f, 0.8f, 0.25f }, D46[] = { 1, 0.0455f, 0, 1, 0, 0, 0, 0, 0.5f, 1, 0.5f, 0.5f };
static float D3[21], D7[9], D30[11];
static bool initDefaults() {
  for (float& x : D3) x = 0.5f; D3[0] = 1; for (int i = 0; i < 4; i++) { D3[2 + 4 * i] = 0.2f * (float)(i + 1); D3[4 + 4 * i] = 0.5f; D3[17 + i] = 0; }
  for (float& x : D7) x = 0.5f; D7[0] = 1;
  for (float& x : D30) x = 0.5f; D30[0] = 1; D30[9] = 0; D30[10] = 0.6f;
  return true;
}
static const bool defaultsReady = initDefaults();

static State* makeState(int id, int& n, const float*& def) {
  (void)defaultsReady;
  switch (id) {
    case 3: n = 21; def = D3; return new EqState(0);
    case 5: n = 4; def = D5; return new LegacyLimiterState();
    case 6: n = 7; def = D6; return new DistortionState();
    case 7: n = 9; def = D7; return new EqState(1);
    case 8: n = 10; def = D8; return new CompressorState();
    case 9: n = 5; def = D9; return new FilterState();
    case 10: { n = 4; def = D10; auto* s = new AutoDuckState(false); s->n = 4; return s; }
    case 11: n = 5; def = D11; return new ChorusState();
    case 12: n = 22; def = D12; return new ReverbState(12);
    case 13: n = 12; def = D13; return new FlangerState();
    case 14: n = 10; def = D14; return new PhaserState();
    case 15: n = 7; def = D15; return new StereoizerState();
    case 16: n = 7; def = D16; return new TranceDelayState();
    case 18: n = 5; def = D18; return new TapeDelayState();
    case 20: n = 3; def = D20; return new LevellerState();
    case 27: n = 9; def = D27; return new GateState();
    case 28: n = 5; def = D28; return new LookaheadLimiterState();
    case 29: { n = 8; def = D29; auto* s = new AutoDuckState(true); s->n = 8; return s; }
    case 30: n = 11; def = D30; return new EqState(2);
    case 32: n = 16; def = D32; return new ReverbState(32);
    case 34: n = 8; def = D34; return new SpacerState();
    case 35: n = 19; def = D35; return new ReverbState(35);
    case 40: n = 12; def = D40; return new CombState();
    case 43: n = 11; def = D43; return new WowFlutterState();
    case 46: n = 12; def = D46; return new TremoloState();
    default: return nullptr;
  }
}

class Module : public Device {
 public:
  int id, n; float sr; std::vector<float> p; State* st = nullptr; Ext* ext = nullptr;
  // CommonModule
  float tGain = 1, mix = 1, wetPan = 0.5f, gain = 1, cMix = 1, cPan = 0.5f; bool fresh = true;
  float bpm = 120; bool playing = false; double beat = 0;
  Module(int i, double rate) : id(i), sr((float)rate) {
    const float* def = nullptr; st = makeState(id, n, def);
    if (!st) { ext = makeExt(id, sr, n, def); }
    p.assign(def, def + n);
    hasTr = true;
    midiIn = id == 40;                                   // Comb Filter: MIDI Note mode follows the notes of its own track
    refresh(); doReset();
  }
  ~Module() override { delete st; delete ext; }
  void refresh() { if (st) st->refresh(p.data(), sr); else ext->refresh(p.data(), sr); }
  void doReset() { if (st) st->reset(p.data()); else ext->reset(p.data()); }
  void setParam(int i, double v) override {
    float x = (float)(v < 0 ? 0 : (v > 1 ? 1 : v));
    if (i >= n) {                                          // Post Gain, Mix, Wet Pan (CommonModule::set_parameter)
      int k = i - n;
      if (k >= 3) { if (ext) ext->extra(k - 3, x); return; }                // module data (Pitcher notes)
      if (k == 0) tGain = dbAmp(-20.0f + 40.0f * x); else if (k == 1) mix = x; else wetPan = x;
      if (fresh) { gain = tGain; cMix = mix; cPan = wetPan; }
      return;
    }
    if (i < 0) return;
    p[i] = x;
    if (id == 46) { if (i == 3 && p[4] > x) p[4] = x; else if (i == 4 && p[3] < x) p[3] = x; }
    refresh();
  }
  int midiFrom() override { return id == 40 ? 0 : -1; }
  void noteOn(int pitch, double) override { if (id == 40) static_cast<CombState*>(st)->note(pitch); }
  void noteOff(int pitch) override { if (id == 40) { auto* c = static_cast<CombState*>(st); if (c->active == pitch) c->note(-1); } }
  void setTempo(double b) override { bpm = (float)(b > 0 ? b : 120); if (ext) ext->tempo(bpm); }
  void tr(bool pl, double b) override { playing = pl; beat = b; }
  int lat() override { return ext ? ext->latency() : (id == 27 ? 255 : (id == 28 ? (int)std::trunc(sr * 0.002f) : 0)); }   // AudioEffect::latency_samples
  void process(float* L, float* R, int nf) override {
    fresh = false;
    bool runs = p[0] >= 0.5f && mix != 0.0f;
    double sb = playing ? beat : -1.0;
    if (runs) { if (st) st->prepare(bpm, sb, sr, nf); else ext->prepare(bpm, sb, sr, nf); }
    else if (ext) ext->idle(bpm);
    if (!runs) return;
    for (int f = 0; f < nf; f++) {
      float dl = L[f], dr = R[f], wl = dl, wr = dr;
      if (st) st->frame(wl, wr); else ext->frame(wl, wr);
      if (gain != tGain) { gain += (tGain - gain) * 0.01f; if (std::fabs(gain - tGain) < 0.001f) gain = tGain; }
      wl *= gain; wr *= gain;
      cMix += (mix - cMix) * 0.001f; cPan = flushf(cPan + (wetPan - cPan) * 0.001f);
      if (cMix == 1.0f && cPan == 0.5f) { L[f] = wl; R[f] = wr; continue; }
      float wL = std::min(2.0f - 2.0f * cPan, 1.0f), wR = std::min(2.0f * cPan, 1.0f);
      L[f] = dl + (wl - dl) * cMix * wL; R[f] = dr + (wr - dr) * cMix * wR;
    }
  }
};

}  // namespace hdfx

// FL Studio Mobile note effects (47..51): their notes are worked out when the track's notes arrive (hdnfx.cpp, commands.cpp trackNoteFx);
// in the chain they hold their place and pass the audio through
class NoteFxPlace : public Device { public: void setParam(int, double) override {} void process(float*, float*, int) override {} };
int hdfxParamCount(int flmId) {
  if (nfxParamCount(flmId)) return nfxParamCount(flmId);
  int n = 0; const float* def = nullptr; hdfx::State* s = hdfx::makeState(flmId, n, def);
  if (s) { delete s; return n; }
  return hdfx::extParamCount(flmId);
}
Device* makeHdFx(int flmId, double sr) { if (nfxParamCount(flmId)) return new NoteFxPlace(); return hdfxParamCount(flmId) > 0 ? new hdfx::Module(flmId, sr) : nullptr; }

}  // namespace mdaw
