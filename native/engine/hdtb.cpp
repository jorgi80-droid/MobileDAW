// See hdtb.h. Port of Honeydew crates/audio/src/transistor_bass.rs.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#include "hdtb.h"
#include <cmath>
#include <cstring>
#include <vector>
#include <algorithm>

namespace mdaw {
namespace {

constexpr int NP = 14;
const float DEFAULTS[NP] = { 1, 0, 1, 1, 0.1f, 1, 0.1f, 0, 0, 0.3f, 0.5f, 0, 0, 0 };
enum { WAVEFORM = 1, CUTOFF, RESO, ENV_MOD, DECAY, ACCENT, DISTORTION, DRIVE_HP, DRIVE, DRIVE_VOL, PW, LFO_SPEED, LFO_TO_PW };
constexpr int MAX_KEYS = 16, SAW_POINTS = 1024, MIP_LEVELS = 48, SINC_TAPS = 64, BALANCE_BLOCK = 256;
const float ACCENT_VELOCITY = 99.0f / 127.0f;
const double SLIDE_T = 0.05, PITCH_T = 0.0001, MEG_T = 0.2775, MEG_T_DECAY = 1.8825, VEG_T = 1.0, SWEEP_RISE_T = 0.05, SWEEP_FALL_T = 0.2, VCA_T = 0.005;
const float MIP_HEADROOM = 0.9f, PW_CENTRE = 0.5f, PW_RANGE = 0.45f, PW_LFO_DEPTH = 0.24f, PW_MIN = 0.001f, PW_MAX = 0.999f, LFO_MIN_HZ = 0.1f, LFO_RANGE_HZ = 9.9f;
const float KEY_0_HZ = 8.175799f, CUTOFF_MIN_HZ = 11.0f, CUTOFF_MAX_FS = 0.4f, HP_FEEDBACK_HZ = 160.0f, VCA_ACCENT = 0.74f, HP_POST_HZ = 205.0f, POST_GAIN = 0.25f;
const float DRIVE_HP_HZ[2] = { 7.2f, 60.0f }, DRIVE_LP_HZ[6] = { 16000, 5000, 2500, 1500, 900, 600 };
const float SLEW_PER_SECOND = 300000.0f, SLEW_LIMIT = 4.5f, DRIVE_OUT_LP_HZ = 19475.0f, ONE_POLE_MAX_FS = 0.49f, BALANCE_STEP = 0.01f, TAIL_S = 0.25f;
const float TAU_F = 6.2831855f, PI_F = 3.14159274f;

float smoother(float fs, double t) { return (float)(1.0 - std::pow(0.1, 1.0 / ((double)fs * t))); }
float decayK(float fs, double t) { return (float)std::pow(0.1, 1.0 / ((double)fs * t)); }
float wrap(float p) { return p - std::floor(p); }
float clampf(float x, float a, float b) { return x < a ? a : (x > b ? b : x); }

float cutoffHz(const float* p, float n, float meg, float sweep, float fs) {
  float c = p[CUTOFF], e = p[ENV_MOD];
  float v = 0.23f * sweep + meg * (0.16f + 0.54f * e * e) + (0.1f + 0.58f * std::pow(c, 1.5f)) * (1.0f - 0.31f * e * e) - 0.02f - (n - 12.0f) / 288.0f;
  return clampf(KEY_0_HZ * std::exp2(128.0f * v / 12.0f), CUTOFF_MIN_HZ, CUTOFF_MAX_FS * fs);
}
float pulseWidth(const float* p, float lfoPhase) {
  float lfo = std::sin(TAU_F * lfoPhase);
  return clampf(PW_CENTRE + PW_RANGE * p[PW] + PW_LFO_DEPTH * p[LFO_TO_PW] * lfo, PW_MIN, PW_MAX);
}

struct SawMips {
  std::vector<float> table; size_t start[MIP_LEVELS] = {}, len[MIP_LEVELS] = {};
  SawMips() {
    auto cycle = [](long long i) { long long m = ((i % SAW_POINTS) + SAW_POINTS) % SAW_POINTS; return 1.0 - 2.0 * (double)m / (double)(SAW_POINTS - 1); };
    const long long half = SINC_TAPS / 2;
    for (int k = 0; k < MIP_LEVELS; k++) {
      size_t l = std::max((size_t)std::llround((double)SAW_POINTS * std::exp2(-(double)k / 4.0)), (size_t)1);
      double c = (double)l / SAW_POINTS; start[k] = table.size(); len[k] = l;
      for (size_t j = 0; j < l; j++) {
        double t = (double)j / c; long long first = (long long)std::floor(t) - half + 1; double sum = 0, weight = 0;
        for (long long i = first; i < first + SINC_TAPS; i++) {
          double x = t - (double)i, sinc = x == 0.0 ? 1.0 : std::sin(M_PI * c * x) / (M_PI * c * x), u = x / (double)half;
          double bl = 0.42 + 0.5 * std::cos(M_PI * u) + 0.08 * std::cos(2.0 * M_PI * u), h = c * sinc * bl;
          sum += cycle(i) * h; weight += h;
        }
        table.push_back((float)(sum / weight));
      }
    }
  }
  static int level(float f, float fs) { return (int)clampf(std::floor(4.0f * std::log2((float)SAW_POINTS * f / (MIP_HEADROOM * fs))), 0.0f, (float)(MIP_LEVELS - 1)); }
  float read(int lv, float phase) const {
    const float* t = &table[start[lv]]; size_t l = len[lv]; float pos = phase * (float)l; size_t i = std::min((size_t)pos, l - 1);
    float nx = t[(i + 1) % l]; return t[i] + (nx - t[i]) * (pos - (float)i);
  }
};
const SawMips& mips() { static const SawMips m; return m; }

struct OnePole {
  float k = 0, s = 0;
  void set(float hz, float fs) { float g = std::tan(PI_F * std::min(hz, ONE_POLE_MAX_FS * fs) / fs); k = g / (1.0f + g); }
  float lp(float x) { float v = (x - s) * k, y = v + s; s = y + v; return y; }
  float hp(float x) { return x - lp(x); }
};

struct DiodeLadder {
  float y[4] = {}; OnePole hpf;
  float process(float input, float fc, float r, float fs) {
    double x = (double)fc * 0.7071067811865476 / (double)fs;
    double b = (0.00045522346 + 6.1922189 * x) / (1.0 + 12.358354 * x + 4.4156345 * x * x);
    double k = (((((x + 7198.6997) * x - 5837.7917) * x - 476.47308) * x + 614.95611) * x + 213.87126) * x + 16.998792;
    double r64 = (double)r; float g = (float)(((k / 17.0 - 1.0) * r64 + 1.0) * (1.0 + r64));
    float bf = (float)b, kf = (float)k;
    float y0 = input - hpf.hp(kf * r * y[3]);
    y[0] += 2.0f * bf * (y0 - y[0] + y[1]);
    y[1] += bf * (y[0] - 2.0f * y[1] + y[2]);
    y[2] += bf * (y[1] - 2.0f * y[2] + y[3]);
    y[3] += bf * (y[2] - 2.0f * y[3]);
    return 2.0f * g * y[3];
  }
};

struct Distortion {
  float pre = 1; OnePole hp[3], lp; float maxStep = 0, slew = 0; OnePole outLp; float post = 1;
  void init(float fs) { hp[0].set(DRIVE_HP_HZ[0], fs); hp[1].set(DRIVE_HP_HZ[1], fs); maxStep = SLEW_PER_SECOND / fs; outLp.set(DRIVE_OUT_LP_HZ, fs); }
  void configure(const float* p, float fs) {
    float dr = p[DRIVE], h = p[DRIVE_HP], vo = p[DRIVE_VOL];
    pre = 1.0f + 2305.0f * dr * dr * dr; hp[2].set(10.0f + 3000.0f * h * h, fs);
    float at = dr * 4.999f; int i = std::min((int)at, 4);
    lp.set(DRIVE_LP_HZ[i] + (DRIVE_LP_HZ[i + 1] - DRIVE_LP_HZ[i]) * (at - (float)i), fs);
    post = (1.0f + h) * std::exp2(4.0f * vo - 2.0f) * (0.9819f * std::exp(-11.834f * dr) + 0.022199f);
  }
  float process(float x) {
    x *= pre; for (auto& f : hp) x = f.hp(x); x = lp.lp(x);
    slew = clampf(slew + clampf(x - slew, -maxStep, maxStep), -SLEW_LIMIT, SLEW_LIMIT);
    return outLp.lp(std::tanh(slew)) * post;
  }
};

class TransistorBass : public Instrument {
 public:
  explicit TransistorBass(double rate) { fs = std::max((float)rate, 1.0f); std::memcpy(p, DEFAULTS, sizeof p); build(); }
  void build() {
    const float keep[NP] = {}; (void)keep;
    held = 0; accent = sliding = false; target = pitch = 0; fresh = true; pan = 0.5f; rendering = false; tail = 0;
    phase = lfoPhase = meg = veg = sweep = vca = 0;
    ladder = DiodeLadder(); ladder.hpf.set(HP_FEEDBACK_HZ, fs); hpPost = OnePole(); hpPost.set(HP_POST_HZ, fs);
    dist = Distortion(); dist.init(fs); gains[0] = gains[1] = 1; blockFrame = 0;
    slideK = smoother(fs, SLIDE_T); pitchK = smoother(fs, PITCH_T); sweepRiseK = smoother(fs, SWEEP_RISE_T); sweepFallK = smoother(fs, SWEEP_FALL_T);
    vcaK = smoother(fs, VCA_T); vegDecay = decayK(fs, VEG_T); megAccentDecay = decayK(fs, MEG_T);
    tailFrames = std::max((size_t)std::lround(TAIL_S * fs), (size_t)1);
    configure();
  }
  void configure() {
    double d = (double)p[DECAY]; megDecay = decayK(fs, MEG_T + MEG_T_DECAY * d * d);
    lfoStep = (LFO_MIN_HZ + LFO_RANGE_HZ * p[LFO_SPEED]) / fs; dist.configure(p, fs);
  }
  void setParam(int i, double v) override {
    if (i == 0) { bool on = v >= 0.5; if (enabled && !on) build(); enabled = on; return; }   // Enable off: the instrument rests and is reset (InstrumentModule)
    if (i > 0 && i < NP) { p[i] = clampf((float)v, 0, 1); configure(); }
  }
  void noteOn(int key, double vel) override {
    if (!enabled || key < 0 || key > 127) return;
    for (int k = 0; k < held; k++) if (keys[k] == key) return;
    if (held == MAX_KEYS) { std::memmove(keys, keys + 1, (MAX_KEYS - 1) * sizeof keys[0]); held--; }
    sliding = held > 0; keys[held++] = key; accent = (float)vel >= ACCENT_VELOCITY; target = (float)key; pan = 0.5f;
    if (!sliding) { meg = 1; veg = 1; }
    if (fresh) { pitch = target; fresh = false; }
    rendering = true;
  }
  void noteOff(int key) override {
    int i = -1; for (int k = 0; k < held; k++) if (keys[k] == key) { i = k; break; }
    if (i < 0) return;
    bool newest = i + 1 == held; std::memmove(keys + i, keys + i + 1, (held - i - 1) * sizeof keys[0]); held--;
    if (held == 0) tail = tailFrames; else if (newest) { target = (float)keys[held - 1]; sliding = true; }
  }
  void allOff() override { if (held > 0) { held = 0; tail = tailFrames; } }
  bool active() override { return rendering; }
  void render(float* L, float* R, int a, int b) override {
    if (!enabled) return;
    for (int f = a; f < b; f++) {
      if (!rendering) return;
      if (blockFrame == 0) stepBalance();
      blockFrame = (blockFrame + 1) % BALANCE_BLOCK;
      float out = tick(); L[f] += out * gains[0]; R[f] += out * gains[1];
      if (held == 0) { tail--; rendering = tail > 0; }
    }
  }
 private:
  float fs, p[NP]; bool enabled = true;
  int keys[MAX_KEYS] = {}; int held = 0; bool accent = false, sliding = false; float target = 0, pitch = 0; bool fresh = true; float pan = 0.5f; bool rendering = false; size_t tail = 0;
  float phase = 0, lfoPhase = 0, meg = 0, veg = 0, sweep = 0, vca = 0;
  DiodeLadder ladder; OnePole hpPost; Distortion dist; float gains[2] = { 1, 1 }; int blockFrame = 0;
  float slideK, pitchK, sweepRiseK, sweepFallK, vcaK, vegDecay, megAccentDecay, megDecay = 1, lfoStep = 0; size_t tailFrames = 1;
  void stepBalance() {
    float q = clampf(2.0f * pan - 1.0f, -1, 1), t[2] = { 1.0f - std::max(q, 0.0f), 1.0f + std::min(q, 0.0f) };
    for (int c = 0; c < 2; c++) gains[c] += (t[c] - gains[c]) * BALANCE_STEP;
  }
  float tick() {
    float r = p[RESO], a = p[ACCENT];
    pitch += (target - pitch) * (sliding ? slideK : pitchK);
    float f = 440.0f * std::exp2((pitch - 81.0f) / 12.0f);
    int lv = SawMips::level(f, fs); const SawMips& m = mips();
    float pw = pulseWidth(p, lfoPhase), saw = m.read(lv, phase), pulse = saw - m.read(lv, wrap(phase + pw)), osc = pulse + (saw - pulse) * p[WAVEFORM];
    phase = wrap(phase + f / fs); lfoPhase = wrap(lfoPhase + lfoStep);
    float meg0 = meg, veg0 = veg; meg *= accent ? megAccentDecay : megDecay; veg *= vegDecay;
    float acc = accent ? meg0 * (0.5f + 0.5f * r) * a * a : 0.0f, k = acc > sweep ? sweepRiseK : sweepFallK;
    sweep += (acc - sweep) * k; float sw = sweep + (3.0f - 3.0f * r) * acc;
    float fc = cutoffHz(p, pitch, meg0, sw, fs), filtered = ladder.process(osc, fc, r, fs);
    float target = held == 0 ? 0.0f : (!accent ? veg0 : std::max(veg0, VCA_ACCENT + meg0 * (VCA_ACCENT + 1.86f * a * a)));
    vca += (target - vca) * vcaK;
    float out = hpPost.hp(vca * filtered) * POST_GAIN;
    return p[DISTORTION] >= 0.5f ? dist.process(out) : out;
  }
};

}  // namespace

Instrument* makeTransistorBass(double sr) { return new TransistorBass(sr); }

}  // namespace mdaw
