// See hd3osc.h. Port of Honeydew crates/audio/src/three_osc/{mod,osc,voice,filter,env,lfo,echo,arp}.rs, in that file's order of ideas:
// the shape tables, the filter, the envelopes / LFOs, the voice, Echo and Arpeggio, the voice pool and the instrument.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#include "hd3osc.h"
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>
#include <algorithm>
#include <limits>

namespace mdaw {
namespace {

constexpr int NP = THREE_OSC_PARAMS;
using Params = float[NP];

// ---- Rust `as` casts (saturating, NaN -> 0)
inline uint32_t asU32(double x) { if (!(x > 0)) return 0; if (x >= 4294967295.0) return 4294967295u; return (uint32_t)x; }
inline uint64_t asU64(double x) { if (!(x > 0)) return 0; if (x >= 18446744073709551615.0) return std::numeric_limits<uint64_t>::max(); return (uint64_t)x; }
inline uint8_t asU8(double x) { if (!(x > 0)) return 0; if (x >= 255.0) return 255; return (uint8_t)x; }
inline int32_t asI32(double x) { if (x != x) return 0; if (x >= 2147483647.0) return 2147483647; if (x <= -2147483648.0) return (-2147483647 - 1); return (int32_t)x; }
inline float clampf(float x, float a, float b) { return x < a ? a : (x > b ? b : x); }   // Rust f32::clamp (NaN stays NaN)
inline float minf(float a, float b) { return std::fmin(a, b); }                          // Rust f32::min / max ignore a NaN
inline float maxf(float a, float b) { return std::fmax(a, b); }
inline float fractf(float x) { return x - std::trunc(x); }
inline double fractd(double x) { return x - std::trunc(x); }
inline double remEuclid1(double x) { double r = std::fmod(x, 1.0); return r < 0.0 ? r + 1.0 : r; }

const float FRAC_PI_2_F = 1.57079637f, TAU_F = 6.28318548f;

const float DEFAULTS[NP] = {
  1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.5f, 0.5f, 0.5f,
  0.5f, 0.5f, 0.5f, 0.5f, 0.25f, 0.0f, 0.5f, 0.5f, 0.5f, 0.5f,
  0.5f, 0.5f, 0.5f, 0.25f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
  0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
  0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.305f, 0.305f, 0.305f,
  0.305f, 0.305f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f, 0.5f,
  0.5f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
  0.0f, 0.0f, 0.0f, 0.0f, 0.01f, 0.01f, 0.01f, 0.01f, 0.5f, 0.5f,
  0.5f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 0.01f, 0.01f, 0.01f, 0.01f,
  0.5f, 0.5f, 0.5f, 0.5f, 1.0f, 1.0f, 1.0f, 1.0f, 0.01f, 0.01f,
  0.01f, 0.01f, 0.105f, 0.5f, 0.5f, 0.5f, 1.0f, 0.5f, 0.5f, 0.5f,
  0.0f, 1.0f, 0.0f, 0.5f, 0.5f, 0.5f, 0.5f, 0.0f, 0.494f, 0.0f,
  0.0f, 0.5f, 0.5f, 0.5f, 0.5f, 0.833f, 0.5f, 0.5f, 0.5f, 1.0f,
  0.333f, 0.0f, 0.375f, 0.5f, 0.5f, 0.5f, 0.5f, 0.0f, 0.0f, 0.0f,
  0.576f, 1.0f, 0.167f, 0.0f, 0.0f, 0.0111f, 0.0f, 0.0f, 0.0f,
};

// ---- laws (mod.rs)
constexpr int VOICE_CAP = 256, KEY_QUEUE = 256, MONO_STACK = 128;
const float FALLBACK_BPM = 120.0f;
enum { MAX_POLYPHONY = 117, PORTAMENTO_TIME = 118, PORTAMENTO_MODE = 119, MONOPHONIC_MODE = 120, GATE = 129, DELAY_FEEDBACK = 131, ARPEGGIO_DIRECTION = 139 };
float effectiveBpm(float bpm) { return bpm > 0.0f ? bpm : FALLBACK_BPM; }
uint32_t tickSamples(float fs, float bpm, float d) {
  bpm = effectiveBpm(bpm);
  return std::max(asU32(std::round((double)fs * 15.0 * (double)d / (96.0 * (double)bpm))), 1u);
}
uint32_t timeLaw(float x) { return asU32(std::round(1.8462f * std::expm1(0.0032186f * x))); }
uint32_t slideT(float v) { return timeLaw(std::trunc(1660.0f * v)); }
float slideTicks(float v, float d) { return 2.0f * (float)slideT(v) / d; }
uint32_t gateT(float v) { return timeLaw(std::trunc(997.0f * v + 450.0f)); }
uint32_t gateTicks(float v, float d) { return std::max(asU32(std::round(2.0f * (float)gateT(v) / d)), 1u); }
bool toggle(float v) { return v > 0.5f; }
float coarse(float v) { return std::round(std::fma(v, 48.0f, -24.0f)); }
int maxVoices(float v) { uint64_t n = asU64(std::round(99.0f * clampf(v, 0.0f, 1.0f))); return n == 0 ? VOICE_CAP : (int)std::min<uint64_t>(n, 1u << 30); }

enum Target { PAN = 0, VOL = 1, CUT = 2, RES = 3, PITCH = 4 };
struct Tick { float bpm = 120, d = 4; uint64_t count = 0; double beat = 0; bool playing = false; };
struct ModFrame { float env[5] = {}; float lfo[5] = {}; bool done = false; };
struct NoteSpec { uint8_t key = 0; float velocity = 0, pan = 0, pitch = 0, cut = 0, res = 0; };
enum EvKind { EV_ON, EV_OFF, EV_SLIDE };
struct VoiceEvent { EvKind kind; uint32_t tag; NoteSpec note; uint32_t ticks; };

// ---- osc.rs: the shape tables
constexpr size_t CYCLE = 16384, MIP_LEVELS = 44, MIP_POINTS = 32768;
const double MIP_MIN_STEP = 0.0005, NOISE_STEP = 0.00029220;
const uint32_t NOISE_SEED = 0x3c0ffee5u;
enum Shape { SINE, TRIANGLE, SQUARE, SAW, ANALOG, NOISE, CUSTOM };
Shape shapeFrom(float v) { static const Shape s[7] = { SINE, TRIANGLE, SQUARE, SAW, ANALOG, NOISE, CUSTOM }; size_t i = (size_t)asU64(std::round(clampf(v, 0.0f, 1.0f) * 6.0f)); return s[std::min<size_t>(i, 6)]; }
bool hasMips(Shape s) { return s != SINE && s != NOISE; }
size_t mipLevel(float f) {
  double nEff = 12.0 * std::log2((double)f / 8.17579892);
  double l = std::floor(nEff / 3.0 - 5.0); l = l < 0.0 ? 0.0 : (l > 42.0 ? 42.0 : l); if (l != l) l = 0;
  return (size_t)l;
}
size_t harmonics(size_t level) { return (size_t)std::floor(1024.0 * std::pow(2.0, -(double)level / 4.0)); }

void fft(std::vector<double>& re, std::vector<double>& im, bool inverse) {
  size_t n = re.size(), j = 0;
  for (size_t i = 1; i < n; i++) {
    size_t bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j |= bit;
    if (i < j) { std::swap(re[i], re[j]); std::swap(im[i], im[j]); }
  }
  double sign = inverse ? 1.0 : -1.0;
  for (size_t len = 2; len <= n; len <<= 1) {
    size_t half = len / 2;
    for (size_t k = 0; k < half; k++) {
      double ang = sign * 2.0 * M_PI * (double)k / (double)len, wi = std::sin(ang), wr = std::cos(ang);
      for (size_t start = 0; start < n; start += len) {
        size_t a = start + k, b = start + k + half;
        double tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

struct Wave {
  std::vector<float> raw, mips;
  bool wantMips = false, built = false;
  float read(double phase, int level) const {
    if (level >= 0 && !mips.empty()) return lerp(&mips[(size_t)level * MIP_POINTS], MIP_POINTS, phase);
    return lerp(raw.data(), raw.size(), phase);
  }
  static float lerp(const float* t, size_t len, double phase) {
    double x = phase * (double)len; size_t i = (size_t)asU64(x); float frac = (float)(x - (double)i); size_t mask = len - 1;
    float a = t[i & mask]; return a + (t[(i + 1) & mask] - a) * frac;
  }
  // The 44 band-limited levels: one forward FFT, then one inverse FFT per pair of levels (a in the real part, b in the imaginary part)
  void buildMips() {
    if (built || !wantMips) { built = true; return; }
    std::vector<double> re(raw.begin(), raw.end()), im(CYCLE, 0.0);
    fft(re, im, false);
    std::vector<float> out(MIP_LEVELS * MIP_POINTS, 0.0f);
    std::vector<double> zr(MIP_POINTS), zi(MIP_POINTS);
    for (size_t pair = 0; pair < MIP_LEVELS; pair += 2) {
      std::fill(zr.begin(), zr.end(), 0.0); std::fill(zi.begin(), zi.end(), 0.0);
      for (int lv = 0; lv < 2; lv++) {
        size_t level = pair + (size_t)lv; bool real = lv == 0;
        for (size_t h = 0; h <= harmonics(level); h++) {
          double xr = 2.0 * re[h], xi = 2.0 * im[h];
          double ar = real ? xr : -xi, ai = real ? xi : xr;
          zr[h] += ar; zi[h] += ai;
          if (h > 0) { double cr = real ? xr : xi, ci = real ? -xi : xr; zr[MIP_POINTS - h] += cr; zi[MIP_POINTS - h] += ci; }
        }
      }
      fft(zr, zi, true);
      double scale = 1.0 / (double)MIP_POINTS;
      for (size_t n = 0; n < MIP_POINTS; n++) { out[pair * MIP_POINTS + n] = (float)(zr[n] * scale); out[(pair + 1) * MIP_POINTS + n] = (float)(zi[n] * scale); }
    }
    mips.swap(out); built = true;
  }
};

std::vector<float> rawCycle(Shape shape) {
  uint32_t seed = NOISE_SEED; std::vector<float> o(CYCLE);
  for (size_t i = 0; i < CYCLE; i++) {
    double p = (double)i / (double)CYCLE, v = 0;
    switch (shape) {
      case SINE: v = std::sin(2.0 * M_PI * p); break;
      case TRIANGLE: v = p < 0.25 ? 4.0 * p : p < 0.75 ? 2.0 - 4.0 * p : 4.0 * p - 4.0; break;
      case SQUARE: v = p < 0.5 ? 1.0 : -1.0; break;
      case SAW: v = 2.0 * p - 1.0; break;
      case CUSTOM: v = 0.0; break;
      case ANALOG: v = p < 0.46387 ? 1.0 - 2.0 * std::pow(0.997, (double)CYCLE * p) : p < 0.83333 ? 1.0 : -1.0; break;
      case NOISE: seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; v = (double)seed / 4294967295.0 * 2.0 - 1.0; break;
    }
    o[i] = (float)v;
  }
  return o;
}
struct Bank {
  Wave w[7];
  Bank() { for (int s = 0; s < 7; s++) { w[s].raw = rawCycle((Shape)s); w[s].wantMips = hasMips((Shape)s) && s != CUSTOM; } }
  static Bank& get() { static Bank b; return b; }
};

// ---- filter.rs
enum FilterType { FAST_LP, LP, BP, HP, BS, LPX2, SVF_LP, SVF_LPX2 };
FilterType filterFrom(float v) { size_t i = (size_t)asU64(std::round(clampf(v, 0.0f, 1.0f) * 7.0f)); return (FilterType)std::min<size_t>(i, 7); }
float fastLpF(float c, float fs) { if (c <= 0.0f) return 0.0f; if (c >= 1.0f) return 1.0f; return minf((std::pow(601.0f, c) - 1.0f) / 600.0f * 44100.0f / fs, 1.0f); }
float fastLpR(float r) { if (r <= 0.0f) return 0.0f; return 1.0f + (1.0f - std::pow(601.0f, 1.0f - 0.625f * minf(r, 1.0f))) / 600.0f; }
float biquadW0(float c, float fs) { return minf(44100.0f / fs * maxf(0.0596f * (std::pow(51.0f, c) - 1.0f) + 0.02f, 0.02f), 3.0f); }
float biquadQ(float r) { if (r <= 0.0f) return 0.1f; return 0.1f + 0.4f * std::expm1(2.45739f * minf(r, 1.0f)); }
float svfF(float c, float fs) { if (c < 0.0f) return 0.0f; return minf(0.04f * std::expm1(3.2581f * c) * 44100.0f / fs, 1.0f); }
float svfQ(float r) { if (r <= 0.0f) return 1.0f; if (r >= 1.0f) return 0.2f; return 1.0f - 0.8f * r; }
float lpx2Gain(float q, float w0) { return 1.0f - 0.046875f * q * (3.2f - w0); }

struct Coefs {
  FilterType kind = FAST_LP; float b[5] = {}; float gain = 1, fastR = 0, svf_f = 0; float svf_q[2] = {};
  static Coefs make(FilterType kind, float c, float r, float fs) {
    Coefs k; k.kind = kind; k.gain = 1.0f;
    switch (kind) {
      case FAST_LP: k.fastR = fastLpR(r); break;
      case SVF_LP: case SVF_LPX2: { float q = svfQ(r); k.svf_f = svfF(c, fs); k.svf_q[0] = q; k.svf_q[1] = 0.25f + 0.75f * q; break; }
      default: {
        float w0 = biquadW0(c, fs), q = biquadQ(r), sn = std::sin(w0), cs = std::cos(w0), alpha = sn / (2.0f * q), b0, b1, b2;
        if (kind == HP) { b0 = (1.0f + cs) / 2.0f; b1 = -(1.0f + cs); b2 = (1.0f + cs) / 2.0f; }
        else if (kind == BP) { b0 = alpha; b1 = 0.0f; b2 = -alpha; }
        else if (kind == BS) { b0 = 1.0f; b1 = -2.0f * cs; b2 = 1.0f; }
        else { b0 = (1.0f - cs) / 2.0f; b1 = 1.0f - cs; b2 = (1.0f - cs) / 2.0f; }
        float a0 = 1.0f + alpha;
        k.b[0] = b0 / a0; k.b[1] = b1 / a0; k.b[2] = b2 / a0; k.b[3] = -2.0f * cs / a0; k.b[4] = (1.0f - alpha) / a0;
        if (kind == LPX2) k.gain = lpx2Gain(q, w0);
      }
    }
    return k;
  }
};
inline float biquad(float* s, const float* b, float x) { float y = b[0] * x + s[0]; s[0] = b[1] * x - b[3] * y + s[1]; s[1] = b[2] * x - b[4] * y; return y; }
inline float svf(float* s, float f, float q, float x) { s[0] += f * s[1]; s[1] += f * (x - s[0] - q * s[1]); return s[0]; }
struct Filter {
  FilterType kind = FAST_LP; float st[2][2][2] = {};
  void process(const float* x, const Coefs& k, float fastF, float* out) {
    if (k.kind != kind) { kind = k.kind; std::memset(st, 0, sizeof st); }
    for (int ch = 0; ch < 2; ch++) {
      float* s0 = st[ch][0]; float* s1 = st[ch][1]; float xv = x[ch];
      switch (k.kind) {
        case FAST_LP: s0[0] = k.fastR * s0[0] + fastF * (xv - s0[1]); s0[1] += s0[0]; out[ch] = s0[1]; break;
        case LPX2: out[ch] = k.gain * biquad(s1, k.b, biquad(s0, k.b, xv)); break;
        case SVF_LP: out[ch] = svf(s0, k.svf_f, k.svf_q[0], xv); break;
        case SVF_LPX2: out[ch] = svf(s1, k.svf_f, k.svf_q[1], svf(s0, k.svf_f, k.svf_q[0], xv)); break;
        default: out[ch] = biquad(s0, k.b, xv);
      }
    }
  }
};

// ---- env.rs
const float K_TEMPO_ON = 49.152f, K_PER_BPM = 0.4096f, TIME_EXP = 6.9088f, TENSION_EXP = 8.7557f, DONE_LEVEL = 1.0f / 16777216.0f;
uint32_t timeTicks(float x, bool tempo, const Tick& t) {
  float k = tempo ? K_TEMPO_ON : K_PER_BPM * t.bpm;
  return asU32(maxf(std::round(k * std::expm1(TIME_EXP * x) / t.d), 0.0f));
}
struct Tension {
  float k = 0, l = 0;
  explicit Tension(float tension) {
    float tau = 2.0f * tension - 1.0f;
    k = tau == 0.0f ? 0.0f : std::copysign(1.0f, tau) * std::expm1(TENSION_EXP * std::fabs(tau)) / 10.0f;
    l = std::log1p(std::fabs(k));
  }
  float g(float u) const {
    if (u <= 0.0f || u >= 1.0f) return clampf(u, 0.0f, 1.0f);
    if (k > 0.0f) return 1.0f - std::expm1((1.0f - u) * l) / k;
    if (k < 0.0f) return std::expm1(u * l) / -k;
    return u;
  }
  float inverse(float y) const {
    if (y <= 0.0f || y >= 1.0f) return clampf(y, 0.0f, 1.0f);
    if (k > 0.0f) return 1.0f - std::log1p(k * (1.0f - y)) / l;
    if (k < 0.0f) return std::log1p(-k * y) / l;
    return y;
  }
};
struct EnvParams {
  bool enable, tempo; float delay, attack, attackT, hold, decay, decayT, sustain, release, releaseT; bool volume;
  static EnvParams read(const float* p, int target) {
    int i = target - 1;
    return { toggle(p[62 + i]), toggle(p[66 + i]), p[70 + i], p[74 + i], p[78 + i], p[82 + i], p[86 + i], p[90 + i], p[94 + i], p[98 + i], p[102 + i], target == VOL };
  }
};
enum Stage { IDLE, DELAY, ATTACK, HOLD, DECAY, SUSTAIN, RELEASE };
struct Env {
  Stage stage = IDLE; uint32_t count = 0; float u = 0, level = 0; bool pendingRelease = false;
  void trigger() { *this = Env(); stage = DELAY; }
  void cut() { *this = Env(); }
  bool isHeld() const { return stage != IDLE && stage != RELEASE; }
  bool isDone() const { return stage == IDLE; }
  void release(const EnvParams& p) {
    if (!p.enable) cut();
    else if (stage == DELAY && count == 0) pendingRelease = true;
    else if (isHeld()) { stage = RELEASE; u = Tension(p.releaseT).inverse(level); }
  }
  float tick(const EnvParams& p, const Tick& t) {
    if (!p.enable) {
      if (stage == RELEASE || pendingRelease) cut();
      return p.volume && isHeld() ? 1.0f : 0.0f;
    }
    auto n = [&](float x) { return timeTicks(x, p.tempo, t); };
    for (;;) {
      if (stage == IDLE) { level = 0.0f; break; }
      if (stage == DELAY) { if (count < n(p.delay)) { count++; level = 0.0f; break; } stage = ATTACK; u = 0.0f; continue; }
      if (stage == ATTACK) {
        u += 1.0f / ((float)n(p.attack) + 1.0f);
        if (u < 1.0f) { level = Tension(p.attackT).g(u); break; }
        stage = HOLD; count = 0; level = 1.0f; break;
      }
      if (stage == HOLD) { if (count < n(p.hold)) { count++; level = 1.0f; break; } stage = DECAY; u = 1.0f; continue; }
      if (stage == DECAY) {
        u -= 1.0f / ((float)n(p.decay) + 1.0f);
        float v = Tension(p.decayT).g(u);
        if (v > p.sustain) { level = v; break; }
        stage = SUSTAIN; continue;
      }
      if (stage == SUSTAIN) { level = p.sustain; break; }
      // RELEASE
      u -= 1.0f / ((float)n(p.release) + 1.0f);
      float v = Tension(p.releaseT).g(u);
      if (v >= DONE_LEVEL) { level = v; break; }
      stage = IDLE;
    }
    if (pendingRelease) { pendingRelease = false; stage = RELEASE; u = Tension(p.releaseT).inverse(level); }
    return level;
  }
};

// ---- lfo.rs
const uint32_t MIN_PERIOD_TICKS = 3;
struct LfoParams {
  bool global, tempo; uint8_t shape; float delay, attack, speed;
  static LfoParams read(const float* p, int t) { return { toggle(p[27 + t]), toggle(p[32 + t]), asU8(std::round(p[37 + t] * 2.0f)), p[42 + t], p[47 + t], p[57 + t] }; }
  uint32_t period(const Tick& t) const { return std::max(timeTicks(speed, tempo, t), MIN_PERIOD_TICKS); }
};
float shapeValue(uint8_t shape, float phase) {
  if (shape == 0) return std::sin(TAU_F * phase);
  if (shape == 1) return phase < 0.25f ? 4.0f * phase : phase < 0.75f ? 2.0f - 4.0f * phase : 4.0f * phase - 4.0f;
  return phase < 0.5f ? 1.0f : -1.0f;
}
struct Lfo {
  uint32_t age = 0; float g = 0, phase = 0;
  void trigger() { *this = Lfo(); }
  float tick(const LfoParams& p, const Tick& t, float globalPhase) {
    if (age < timeTicks(p.delay, p.tempo, t)) { age++; return 0.0f; }
    age = 0xffffffffu;
    float ph = p.global ? globalPhase : phase;
    float value = shapeValue(p.shape, ph) * g;
    g = minf(g + 1.0f / ((float)timeTicks(p.attack, p.tempo, t) + 1.0f), 1.0f);
    phase = fractf(phase + 1.0f / (float)p.period(t));
    return value;
  }
};
struct GlobalLfo {
  float phase[5] = {}, next[5] = {}; bool playing = false;
  void tick(const float* params, const Tick& t) {
    bool start = t.playing && !playing; playing = t.playing;
    for (int i = 0; i < 5; i++) {
      uint32_t period = LfoParams::read(params, i).period(t);
      phase[i] = start ? (float)remEuclid1(t.beat * 384.0 / (double)t.d / (double)period) : next[i];
      next[i] = fractf(phase[i] + 1.0f / (float)period);
    }
  }
};
struct Modulation {
  Env env[4]; Lfo lfo[5];
  void start() { for (auto& e : env) e.trigger(); for (auto& l : lfo) l.trigger(); }
  void release(const float* p) { for (int i = 0; i < 4; i++) env[i].release(EnvParams::read(p, i + 1)); }
  void cut() { for (auto& e : env) e.cut(); }
  ModFrame tick(const float* p, const GlobalLfo& g, const Tick& t) {
    ModFrame f;
    for (int i = 0; i < 4; i++) f.env[i + 1] = env[i].tick(EnvParams::read(p, i + 1), t);
    for (int i = 0; i < 5; i++) f.lfo[i] = lfo[i].tick(LfoParams::read(p, i), t, g.phase[i]);
    f.done = env[0].isDone();
    return f;
  }
};

// ---- voice.rs
const float SLOPE_PER_SAMPLE_AT_1HZ = 44.1f;
struct Ctl { const float* p; float fs, wheel, n; uint64_t samples; };
struct Ramp {
  float value = 0, step = 0, target = 0; bool exact = false;
  void set(float tg, float n, float slope, bool jump) {
    if (exact || jump) value = jump ? tg : target;
    float d = (tg - value) / n;
    step = clampf(d, -slope, slope); exact = step == d; target = tg;
  }
  float next() { value += step; return value; }
  bool silent() const { return value == 0.0f && target == 0.0f; }
};
struct Glide {
  float from[3] = {}, to_[3] = {}, k = 0, len = 0;
  void value(float* o) const {
    if (k >= len) { for (int i = 0; i < 3; i++) o[i] = to_[i]; return; }
    float t = k / len; for (int i = 0; i < 3; i++) o[i] = from[i] + (to_[i] - from[i]) * t;
  }
  static void target(const NoteSpec& n, float* o) { o[0] = (float)n.key + n.pitch; o[1] = n.velocity; o[2] = n.pan; }
  void to(const NoteSpec& n, float ticks) { float v[3]; value(v); for (int i = 0; i < 3; i++) from[i] = v[i]; target(n, to_); k = 0.0f; len = ticks; }
};

struct Voice {
  bool active = false, held = false, cut_ = false; uint32_t tag = 0; uint64_t order = 0; uint32_t gate = 0;
  Glide glide; NoteSpec note; float slide[3] = {}; Modulation m; bool fresh = false;
  Shape shape[3] = { SINE, SINE, SINE };
  double phase[3][2] = {}, step[3][2] = {}; int level[3][2] = { { -1, -1 }, { -1, -1 }, { -1, -1 } };
  float gain[3][2] = {}; bool am = false; Coefs coefs; Filter filter; Ramp fastF; Ramp amp[2];

  template <class R> void start(uint32_t tg, const NoteSpec& n, uint64_t ord, bool hasPorta, const float* portaFrom, float portaTicks, uint32_t gt, const float* p, R& rand) {
    *this = Voice();
    active = true; held = true; fresh = true; tag = tg; order = ord; gate = gt; note = n;
    float to[3]; Glide::target(n, to);
    for (int i = 0; i < 3; i++) { glide.from[i] = to[i]; glide.to_[i] = to[i]; }
    glide.k = 0.0f; glide.len = 0.0f;
    if (hasPorta) { for (int i = 0; i < 3; i++) glide.from[i] = portaFrom[i]; glide.len = portaTicks; }
    double pr = (double)p[26];
    for (int i = 0; i < 3; i++) {
      double ph = remEuclid1((2.0 * (double)p[7 + i] - 1.0) / 2.0);
      double a = rand() * pr; double b = remEuclid1(ph + rand() * pr);
      phase[i][0] = a; phase[i][1] = b;
    }
    m.start();
  }
  void release(const float* p) { if (held) { held = false; m.release(p); } }
  void cut() { held = false; cut_ = true; m.cut(); }

  bool control(const Ctl& c, const ModFrame& f) {
    const float* p = c.p;
    auto env = [&](int t) { return f.env[t]; }; auto lfo = [&](int t) { return f.lfo[t]; };
    float g3[3]; glide.value(g3); glide.k += 1.0f;
    float base = g3[0] + slide[0], pan = g3[2] + slide[1], vel = g3[1] + slide[2];
    float keyPitch = base + c.wheel;
    float pitch = keyPitch + 48.0f * ((p[109] - 0.5f) * env(PITCH) + (p[56] - 0.5f) * lfo(PITCH));
    float keyTerm = keyPitch - 120.0f * p[121];
    float velTerm = vel - 0.1f * std::expm1(2.248f * p[125]);
    auto track = [&](int key, int velocity) { return (2.0f * p[key] - 1.0f) / 12.0f * keyTerm + (4.0f * p[velocity] - 2.0f) * velTerm; };
    float m2 = p[22], m3 = p[23];
    am = toggle(p[24]);
    float mix[3];
    if (am) { mix[0] = 1.0f - m2; mix[1] = m2; mix[2] = m3; } else { mix[0] = (1.0f - m3) * (1.0f - m2); mix[1] = (1.0f - m3) * m2; mix[2] = m3; }
    bool hq = toggle(p[25]);
    for (int i = 0; i < 3; i++) {
      Shape sh = shapeFrom(p[1 + i]);
      float co = coarse(p[13 + i]), fine = 2.0f * p[16 + i] - 1.0f, oscPitch = pitch + co + fine;
      for (int ch = 0; ch < 2; ch++) {
        float detune = ch == 1 ? p[10 + i] - 0.5f : 0.0f;
        float hz = 440.0f * std::exp2((oscPitch + detune - 69.0f) / 12.0f);
        double st = sh == NOISE ? NOISE_STEP : (double)hz / (double)c.fs;
        step[i][ch] = st;
        if (hq && hasMips(sh) && st > MIP_MIN_STEP) { Wave& w = Bank::get().w[sh]; if (!w.built) w.buildMips(); level[i][ch] = (int)(uint8_t)mipLevel(hz); }
        else level[i][ch] = -1;
        if (fresh && toggle(p[146 + i])) phase[i][ch] = fractd(phase[i][ch] + (double)c.samples * st);
      }
      bool silent = oscPitch < 1.0f && sh != NOISE;
      float invert = toggle(p[4 + i]) ? -1.0f : 1.0f;
      float g = silent ? 0.0f : mix[i] * invert;
      float angle = p[19 + i] * FRAC_PI_2_F;
      gain[i][0] = g * std::cos(angle); gain[i][1] = g * std::sin(angle);
      shape[i] = sh;
    }
    float cutv = p[111] + (2.0f * p[115] - 1.0f) + note.cut + 2.0f * (p[107] - 0.5f) * env(CUT) + 2.0f * (p[54] - 0.5f) * lfo(CUT) + track(123, 127);
    float resv = p[112] + (2.0f * p[116] - 1.0f) + note.res + 2.0f * (p[108] - 0.5f) * env(RES) + 2.0f * (p[55] - 0.5f) * lfo(RES) + track(124, 128);
    coefs = Coefs::make(filterFrom(p[110]), cutv, resv, c.fs);
    float slope = SLOPE_PER_SAMPLE_AT_1HZ / c.fs;
    fastF.set(fastLpF(cutv, c.fs), c.n, slope, fresh);
    float a = env(VOL) * (1.0f + 2.0f * (p[53] - 0.5f) * lfo(VOL)) * 2.0f * (p[106] - 0.5f) * vel * 2.0f * p[114];
    float pn = clampf((2.0f * p[113] - 1.0f) + 2.0f * (pan - 0.5f) + 2.0f * (p[52] - 0.5f) * lfo(PAN) + track(122, 126), -1.0f, 1.0f);
    float angle = (pn + 1.0f) * FRAC_PI_2_F / 2.0f;
    float gains[2] = { maxf(a * std::cos(angle), 0.0f), maxf(a * std::sin(angle), 0.0f) };
    for (int k = 0; k < 2; k++) amp[k].set(gains[k], c.n, slope, fresh);
    fresh = false;
    return f.done && amp[0].silent() && amp[1].silent();
  }

  void render(const Wave* const* waves, float* outL, float* outR, int n) {
    for (int s = 0; s < n; s++) {
      float x[2];
      for (int ch = 0; ch < 2; ch++) {
        float o[3];
        for (int i = 0; i < 3; i++) {
          o[i] = waves[i]->read(phase[i][ch], level[i][ch]);
          double nx = phase[i][ch] + step[i][ch]; phase[i][ch] = nx - std::floor(nx);
        }
        float sum = gain[0][ch] * o[0] + gain[1][ch] * o[1];
        x[ch] = am ? sum * (1.0f - gain[2][ch] * o[2]) : sum + gain[2][ch] * o[2];
      }
      float y[2]; float ff = fastF.next(); filter.process(x, coefs, ff, y);
      outL[s] += amp[0].next() * y[0];
      outR[s] += amp[1].next() * y[1];
    }
  }
};

// ---- echo.rs
constexpr int ECHO_SLOTS = 512; const uint32_t ECHO_TAGS = 128;
struct EchoParams {
  uint32_t echoes; float feedback, time, pan, pitch, cutoff, resonance; bool pingPong, fat, mono;
  static EchoParams read(const float* p) {
    return { 1 + asU32(std::round(p[130] * 9.0f)), p[131], p[132], p[133], p[134], p[135], p[136], toggle(p[137]), toggle(p[138]), toggle(p[120]) };
  }
  bool active() const { return feedback > 0.0f && !mono; }
};
float offsetStep(float c, float x) { return c < 0.5f ? 2.0f * c * (x + 1.0f) - 1.0f : 1.0f - (2.0f - 2.0f * c) * (1.0f - x); }
void fatGains(float fb, uint32_t echoes, float& g, float& copy) { float n = (float)echoes, d = 3.0f * n + 2.0f; g = 1.5f - 4.0f * fb * n / d; copy = 2.0f * fb / d; }

template <class E> struct EchoT {
  struct Slot { bool live = false, sounding = false; uint32_t group = 0, tag = 0; uint64_t on = 0, hold = 0; NoteSpec note; };
  struct Held { bool down = false; uint32_t group = 0; uint64_t start = 0; };
  Slot slots[ECHO_SLOTS]; Held held[128]; uint32_t nextGroup = 0, nextTag = ECHO_TAGS;
  void reset() { for (auto& s : slots) s = Slot(); for (auto& h : held) h = Held(); nextGroup = 0; nextTag = ECHO_TAGS; }
  void keyOn(uint8_t key, float velocity, float pan, const float* params, const Tick& t, E& emit) {
    finish(key, t.count);
    uint32_t group = nextGroup; nextGroup++;
    held[key] = { true, group, t.count };
    EchoParams p = EchoParams::read(params);
    NoteSpec original; original.key = key; original.velocity = velocity; original.pan = pan;
    uint32_t tag = key;
    if (!p.active()) { emit({ EV_ON, tag, original, 0 }); return; }
    float panStep = 4.0f * p.pan - 2.0f, pitchStep = 24.0f * p.pitch - 12.0f, cut = 0.0f, res = 0.0f;
    if (p.fat) {
      float gain, copy; fatGains(p.feedback, p.echoes, gain, copy);
      NoteSpec nt = original; nt.velocity = velocity * gain;
      emit({ EV_ON, tag, nt, 0 });
      for (uint32_t k = 1; k <= p.echoes; k++) {
        cut = offsetStep(p.cutoff, cut); res = offsetStep(p.resonance, res);
        for (float sign : { 1.0f, -1.0f }) {
          float kk = sign * (float)k;
          NoteSpec c = original; c.velocity = velocity * copy; c.pan = pan + kk * panStep; c.pitch = kk * pitchStep; c.cut = sign * cut; c.res = sign * res;
          queue(group, t.count, c);
        }
      }
      return;
    }
    emit({ EV_ON, tag, original, 0 });
    NoteSpec nt = original; float stp = panStep;
    for (uint32_t k = 1; k <= p.echoes; k++) {
      nt.velocity *= 2.0f * p.feedback;
      nt.pan += stp;
      if (p.pingPong && (nt.pan <= 0.0f || nt.pan >= 1.0f)) stp = -stp;
      nt.pitch = (float)k * pitchStep;
      nt.cut = offsetStep(p.cutoff, nt.cut); nt.res = offsetStep(p.resonance, nt.res);
      uint64_t delay = asU64(std::round((double)k * 2.0 * (double)p.time * 384.0 / (double)t.d));
      queue(group, t.count + delay, nt);
    }
  }
  void keyOff(uint8_t key, const Tick& t, E& emit) { if (held[key].down) { emit({ EV_OFF, key, NoteSpec(), 0 }); finish(key, t.count); } }
  void tick(const Tick& t, E& emit) {
    for (auto& s : slots) {
      if (!s.live) continue;
      if (!s.sounding && s.on <= t.count) { s.sounding = true; emit({ EV_ON, s.tag, s.note, 0 }); }
      if (s.sounding && s.hold != UINT64_MAX && s.on + s.hold <= t.count) { s.live = false; emit({ EV_OFF, s.tag, NoteSpec(), 0 }); }
    }
  }
  void queue(uint32_t group, uint64_t on, const NoteSpec& note) {
    uint32_t tag = nextTag;
    for (auto& s : slots) if (!s.live) { nextTag++; s.live = true; s.sounding = false; s.group = group; s.tag = tag; s.on = on; s.hold = UINT64_MAX; s.note = note; return; }
  }
  void finish(uint8_t key, uint64_t now) {
    Held& h = held[key]; if (!h.down) return;
    h.down = false; uint32_t group = h.group; uint64_t hold = std::max<uint64_t>(now > h.start ? now - h.start : 0, 1);
    for (auto& s : slots) if (s.live && s.group == group) s.hold = hold;
  }
};

// ---- arp.rs
constexpr int MAX_ARPS = 32; const uint32_t ARP_TAGS = 1u << 31; const int CHORD_AUTO_SUSTAIN = -1; const size_t RANGE_OFF_MAX_OCTAVE = 5;
struct Chord { uint8_t n; uint8_t k[8]; };
const Chord CHORDS[88] = {
  {3,{0,4,7}},{3,{0,2,7}},{3,{0,5,7}},{3,{0,4,6}},{3,{0,3,7}},{3,{0,3,6}},{3,{0,4,8}},{3,{0,5,8}},{4,{0,3,6,9}},{4,{0,4,7,9}},
  {4,{0,5,7,9}},{5,{0,4,7,9,14}},{4,{0,3,7,9}},{5,{0,3,7,9,14}},{4,{0,4,7,10}},{4,{0,5,7,10}},{4,{0,4,8,10}},{4,{0,4,6,10}},{5,{0,4,7,10,15}},{5,{0,4,7,10,13}},
  {5,{0,4,8,10,15}},{5,{0,4,8,10,13}},{5,{0,4,6,10,13}},{5,{0,4,7,10,17}},{5,{0,4,7,10,21}},{5,{0,4,7,10,18}},{4,{0,4,7,11}},{4,{0,4,6,11}},{4,{0,4,8,11}},{5,{0,4,7,11,18}},
  {5,{0,4,7,11,21}},{4,{0,3,7,10}},{4,{0,3,6,10}},{5,{0,3,7,10,13}},{5,{0,3,7,10,17}},{5,{0,3,7,10,21}},{4,{0,3,7,11}},{5,{0,3,7,11,17}},{5,{0,3,7,11,21}},{5,{0,4,7,10,14}},
  {5,{0,5,7,10,14}},{4,{0,4,7,14}},{5,{0,4,8,10,14}},{5,{0,4,6,10,14}},{6,{0,4,7,10,14,18}},{6,{0,4,7,10,14,20}},{5,{0,4,7,11,14}},{5,{0,5,7,11,14}},{5,{0,4,8,11,14}},{6,{0,4,7,11,14,18}},
  {5,{0,3,7,10,14}},{4,{0,3,7,14}},{5,{0,3,6,10,14}},{5,{0,3,7,11,14}},{6,{0,4,7,10,14,17}},{6,{0,4,7,10,13,17}},{6,{0,4,7,11,14,17}},{6,{0,3,7,10,14,17}},{6,{0,3,7,11,14,17}},{6,{0,4,7,10,14,21}},
  {6,{0,4,7,10,15,21}},{6,{0,4,7,10,13,21}},{6,{0,4,6,10,13,21}},{6,{0,4,7,11,14,21}},{6,{0,3,7,10,14,21}},{6,{0,3,7,11,14,21}},{7,{0,2,4,5,7,9,11}},{5,{0,2,4,7,9}},{8,{0,2,4,5,7,8,9,11}},{7,{0,2,3,5,7,8,11}},
  {7,{0,2,3,5,7,9,11}},{5,{0,3,5,7,10}},{7,{0,2,3,5,7,8,10}},{7,{0,1,3,5,7,8,11}},{7,{0,2,3,6,7,8,11}},{6,{0,2,4,6,8,10}},{8,{0,2,3,5,6,8,9,11}},{8,{0,2,4,5,7,9,10,11}},{5,{0,1,5,7,10}},{6,{0,3,5,6,7,10}},
  {7,{0,1,4,5,7,8,11}},{7,{0,1,4,6,8,10,11}},{7,{0,1,3,5,7,9,11}},{7,{0,2,3,5,7,9,10}},{7,{0,1,3,5,7,8,10}},{7,{0,2,4,6,7,9,11}},{7,{0,2,4,5,7,9,10}},{7,{0,1,3,5,6,8,10}},
};
struct ArpParams {
  uint8_t direction; float time, gate; uint8_t range, repeat; bool slide; int32_t chord;
  static ArpParams read(const float* p) {
    uint8_t rep = asU8(std::round(p[143] * 5.0f));
    return { asU8(std::round(p[139] * 5.0f)), p[140], p[141], asU8(std::round(p[142] * 6.0f)), (uint8_t)(rep == 0 ? 1 : rep + 1), toggle(p[144]), asI32(std::round(90.0f * p[145] - 2.0f)) };
  }
  bool stepTicks(const Tick& t, double& s) const { if (!(time < 1.0f)) return false; s = std::max((double)gateT(time) * 384.0 / 192.0 / (double)t.d, 1.0); return true; }
};
uint64_t splitmix(uint64_t x) {
  uint64_t z = x + 0x9E3779B97F4A7C15ull;
  z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull; z = (z ^ (z >> 27)) * 0x94D049BB133111EBull; return z ^ (z >> 31);
}
size_t directionIndex(uint8_t dir, uint64_t count, size_t n0, uint32_t seed) {
  uint64_t n = n0;
  switch (dir) {
    case 2: return (size_t)(n - 1 - count % n);
    case 3: { if (n < 2) return 0; uint64_t m = count % (2 * n - 2); return (size_t)(m < n ? m : 2 * n - 2 - m); }
    case 4: { uint64_t m = count % (2 * n); return (size_t)(m < n ? m : 2 * n - 1 - m); }
    case 5: return (size_t)(splitmix((uint64_t)seed ^ splitmix(count)) % n);
    default: return (size_t)(count % n);
  }
}
struct HeldKey { uint8_t key = 0; float velocity = 0, pan = 0; };
struct Runner {
  bool active = false, autoArp = false; HeldKey root; uint64_t count = 0; double stepAt = 0; uint64_t fired = 0; bool started = false, gated = false, sustaining = false;
  bool hasTag = false; uint32_t tag = 0; uint32_t seed = 0;
  template <class E> void silence(E& emit) { if (hasTag) { hasTag = false; emit({ EV_OFF, tag, NoteSpec(), 0 }); } }
};
template <class E> struct ArpEcho {
  EchoT<E> echo; HeldKey held[128]; size_t nHeld = 0; Runner runners[MAX_ARPS]; uint32_t nextTag = ARP_TAGS, nextSeed = 0x9E3779B9u;
  void reset() { echo.reset(); for (auto& h : held) h = HeldKey(); nHeld = 0; for (auto& r : runners) r = Runner(); nextTag = ARP_TAGS; nextSeed = 0x9E3779B9u; }
  template <class F> void stop(E& emit, F which) { for (auto& r : runners) if (r.active && which(r)) { r.silence(emit); r.active = false; } }
  void keyOn(uint8_t key, float velocity, float pan, const float* params, const Tick& t, E& emit) {
    if (key > 127) return;
    ArpParams p = ArpParams::read(params);
    if (p.direction == 0) { echo.keyOn(key, velocity, pan, params, t, emit); return; }
    HeldKey hk{ key, velocity, pan };
    size_t pos = 0; while (pos < nHeld && held[pos].key < key) pos++;
    if (pos < nHeld && held[pos].key == key) held[pos] = hk;
    else { for (size_t i = nHeld; i > pos; i--) held[i] = held[i - 1]; held[pos] = hk; nHeld++; }
    bool autoA = p.chord < 0;
    stop(emit, [&](const Runner& r) { return r.autoArp != autoA; });
    if (autoA) { for (auto& r : runners) if (r.active && r.autoArp) return; }
    stop(emit, [&](const Runner& r) { return !r.autoArp && r.root.key == key; });
    for (auto& r : runners) if (!r.active) { r = Runner(); r.active = true; r.autoArp = autoA; r.root = hk; r.seed = nextSeed; nextSeed += 0x9E3779B9u; break; }
  }
  void keyOff(uint8_t key, const Tick& t, E& emit) {
    if (key > 127) return;
    echo.keyOff(key, t, emit);
    size_t pos = 0; while (pos < nHeld && held[pos].key != key) pos++;
    if (pos == nHeld) return;
    for (size_t i = pos; i + 1 < nHeld; i++) held[i] = held[i + 1];
    nHeld--;
    bool noneHeld = nHeld == 0;
    stop(emit, [&](const Runner& r) { return r.autoArp ? noneHeld : r.root.key == key; });
  }
  bool note(const Runner& r, const ArpParams& p, NoteSpec& out) const {
    static const uint8_t ROOT[1] = { 0 };
    const uint8_t* set = ROOT; size_t setN = 1;
    if (p.chord >= 1 && p.chord <= 88) { set = CHORDS[p.chord - 1].k; setN = CHORDS[p.chord - 1].n; }
    size_t m = r.autoArp ? nHeld : setN;
    if (m == 0) return false;
    size_t block = m * p.repeat;
    size_t i = directionIndex(p.direction, r.count, block * std::max<size_t>(p.range, 1), r.seed);
    size_t j = i % m;
    size_t octave = p.range == 0 ? std::min(j, RANGE_OFF_MAX_OCTAVE) : i / block;
    HeldKey base = r.autoArp ? held[j] : r.root; size_t offset = r.autoArp ? 0 : set[j];
    out = NoteSpec(); out.key = base.key; out.velocity = base.velocity; out.pan = base.pan; out.pitch = (float)(offset + 12 * octave);
    return true;
  }
  uint32_t on(const NoteSpec& n, E& emit) { uint32_t tag = nextTag; nextTag = (nextTag + 1) | ARP_TAGS; emit({ EV_ON, tag, n, 0 }); return tag; }
  void tick(const float* params, const Tick& t, E& emit) {
    echo.tick(t, emit);
    ArpParams p = ArpParams::read(params);
    if (p.direction == 0) { stop(emit, [](const Runner&) { return true; }); return; }
    stop(emit, [&](const Runner& r) { return r.autoArp != (p.chord < 0); });
    double s = 0; bool hasStep = p.stepTicks(t, s);
    uint64_t now = t.count;
    for (int i = 0; i < MAX_ARPS; i++) {
      Runner r = runners[i];
      if (!r.active) continue;
      if (r.autoArp && p.chord == CHORD_AUTO_SUSTAIN && nHeld == 1) {
        if (!r.sustaining) {
          r.silence(emit);
          HeldKey k = held[0]; NoteSpec nt; nt.key = k.key; nt.velocity = k.velocity; nt.pan = k.pan;
          r.sustaining = true; r.count = 0; r.hasTag = true; r.tag = on(nt, emit);
        }
        r.started = false; runners[i] = r; continue;
      }
      r.sustaining = false;
      if (r.started && !r.gated && hasStep && r.hasTag) {
        uint64_t gate = std::max<uint64_t>(asU64(std::round((double)p.gate * s)), 1);
        if (now >= r.fired + gate) {
          r.gated = true;
          NoteSpec nt;
          if (!p.slide) r.silence(emit);
          else if (note(r, p, nt)) { uint32_t ticks = asU32(std::max(std::ceil(r.stepAt + s) - (double)now, 0.0)); emit({ EV_SLIDE, r.tag, nt, ticks }); }
        }
      }
      bool hasNext = false; double at = 0;
      if (!r.started) { hasNext = true; at = (double)now; }
      else if (hasStep && (double)now >= r.stepAt + s) { hasNext = true; at = (double)now >= r.stepAt + 2.0 * s ? (double)now : r.stepAt + s; }
      NoteSpec nt;
      if (hasNext && note(r, p, nt)) {
        if (r.hasTag && p.slide) { if (!r.gated) emit({ EV_SLIDE, r.tag, nt, 0 }); }
        else { r.silence(emit); r.tag = on(nt, emit); r.hasTag = true; }
        r.count++; r.gated = false; r.started = true; r.stepAt = at; r.fired = now;
      }
      runners[i] = r;
    }
  }
};

// ---- the voice pool (mod.rs Pool)
struct Pool {
  std::vector<Voice> voices; GlobalLfo global; std::vector<std::pair<uint32_t, NoteSpec>> held; float d = 4; uint64_t order = 0; bool hasLast = false; float last[3] = {}; uint32_t rng = 0x9e3779b9u;
  void apply(const VoiceEvent& e, const float* p) {
    bool arpOff = std::round(p[ARPEGGIO_DIRECTION] * 5.0f) == 0.0f;
    bool mono = toggle(p[MONOPHONIC_MODE]) && arpOff;
    if (e.kind == EV_ON) { if (mono) monoOn(e.tag, e.note, p); else { release(e.tag, p); start(e.tag, e.note, p); } }
    else if (e.kind == EV_OFF) { if (mono) monoOff(e.tag, p); else release(e.tag, p); }
    else { Voice* v = heldVoice(true, e.tag); if (v) { v->note = e.note; v->glide.to(e.note, (float)e.ticks); Glide::target(e.note, last); hasLast = true; } }
  }
  Voice* heldVoice(bool byTag, uint32_t tag) { for (auto& v : voices) if (v.active && v.held && (!byTag || v.tag == tag)) return &v; return nullptr; }
  void release(uint32_t tag, const float* p) { for (auto& v : voices) if (v.active && v.tag == tag) v.release(p); }
  void start(uint32_t tag, const NoteSpec& note, const float* p) {
    int sounding = 0; for (auto& v : voices) if (v.active && !v.cut_) sounding++;
    if (sounding >= maxVoices(p[MAX_POLYPHONY])) cutOne();
    size_t slot = voices.size();
    for (size_t i = 0; i < voices.size(); i++) if (!voices[i].active) { slot = i; break; }
    if (slot == voices.size()) for (size_t i = 0; i < voices.size(); i++) if (voices[i].cut_) { slot = i; break; }
    if (slot == voices.size()) slot = 0;
    bool porta = toggle(p[PORTAMENTO_MODE]) && p[DELAY_FEEDBACK] == 0.0f && hasLast;
    float pt = porta ? slideTicks(p[PORTAMENTO_TIME], d) : 0.0f;
    uint32_t gate = p[GATE] < 1.0f ? gateTicks(p[GATE], d) : 0;
    order++;
    auto rand = [this]() { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return (double)(rng >> 8) / (double)(1u << 24); };
    voices[slot].start(tag, note, order, porta, last, pt, gate, p, rand);
    Glide::target(note, last); hasLast = true;
  }
  void cutOne() {
    for (int pass = 0; pass < 2; pass++) {
      bool wantHeld = pass == 1; int best = -1; uint64_t bo = 0;
      for (size_t i = 0; i < voices.size(); i++) { const Voice& v = voices[i]; if (v.active && !v.cut_ && v.held == wantHeld && (best < 0 || v.order >= bo)) { best = (int)i; bo = v.order; } }
      if (best >= 0) { voices[best].cut(); return; }
    }
  }
  void monoOn(uint32_t tag, const NoteSpec& note, const float* p) {
    held.erase(std::remove_if(held.begin(), held.end(), [&](const std::pair<uint32_t, NoteSpec>& h) { return h.first == tag; }), held.end());
    if (held.size() == (size_t)MONO_STACK) held.erase(held.begin());
    held.push_back({ tag, note });
    uint32_t gate = p[GATE] < 1.0f ? gateTicks(p[GATE], d) : 0;
    float glide = slideTicks(p[PORTAMENTO_TIME], d);
    if (Voice* v = heldVoice(false, 0)) { v->tag = tag; v->note = note; v->gate = gate; v->glide.to(note, glide); Glide::target(note, last); hasLast = true; return; }
    for (auto& v : voices) if (v.active && !v.cut_) v.cut();
    start(tag, note, p);
  }
  void monoOff(uint32_t tag, const float* p) {
    held.erase(std::remove_if(held.begin(), held.end(), [&](const std::pair<uint32_t, NoteSpec>& h) { return h.first == tag; }), held.end());
    bool back = !held.empty(); std::pair<uint32_t, NoteSpec> b; if (back) b = held.back();
    float glide = slideTicks(p[PORTAMENTO_TIME], d);
    Voice* v = heldVoice(true, tag); if (!v) return;
    if (back) { v->tag = b.first; v->note = b.second; v->glide.to(b.second, glide); Glide::target(b.second, last); hasLast = true; }
    else v->release(p);
  }
};

// ---- the instrument
class ThreeOsc : public Instrument {
 public:
  struct Emit { Pool* pool; const float* p; void operator()(const VoiceEvent& e) { pool->apply(e, p); } };
  explicit ThreeOsc(double sr) {
    fs = (float)std::max(sr, 1.0); std::memcpy(p, DEFAULTS, sizeof p);
    pool.voices.resize(VOICE_CAP); pool.held.reserve(MONO_STACK); keys.reserve(KEY_QUEUE);
    Bank::get();
  }
  void setTempo(double b) override { bpm = (float)b; }
  void setSongPos(bool pl, double beat) override { playing = pl; songBeat = beat; }
  bool hasSetBend() override { return true; }
  void setBend(double st) override { wheel = std::isfinite(st) ? (float)st : 0.0f; }
  void setParam(int i, double v) override {
    if (i == NP) { float d = (float)std::max(1.0, std::min(255.0, std::round(v > 0 ? v : 4))); pool.d = d; return; }   // D (TDIV byte 0)
    if (i < 0 || i >= NP || !(v == v) || v < 0 || v > 1) return;
    if (i == 0) enabled = v >= 0.5;
    p[i] = (float)v;
  }
  void noteOn(int key, double vel) override { if (key >= 0 && key <= 127) queue({ (uint8_t)key, (float)vel, 0.5f, true }); }
  void noteOff(int key) override { if (key >= 0 && key <= 127) queue({ (uint8_t)key, 0.0f, 0.5f, false }); }
  void allOff() override { keys.clear(); allOffPending = true; }
  bool active() override { if (!keys.empty() || allOffPending) return true; for (auto& v : pool.voices) if (v.active) return true; return false; }
  int voicesOn() override { int n = 0; for (auto& v : pool.voices) if (v.active) n++; return n; }
  void render(float* L, float* R, int a, int b) override {
    if (!enabled || b <= a) return;
    double bpf = (double)bpm / (60.0 * (double)fs);
    double start = songBeat + (playing ? (double)a * bpf : 0.0);
    uint32_t n = tickSamples(fs, bpm, pool.d);
    int pos = 0, len0 = b - a;
    while (pos < len0) {
      if (untilTick == 0) {
        Tick t; t.bpm = effectiveBpm(bpm); t.d = pool.d; t.count = ticks; t.beat = start + (playing ? (double)pos * bpf : 0.0); t.playing = playing;
        controlTick(t, n); untilTick = n;
      }
      int len = (int)std::min<uint32_t>(untilTick, (uint32_t)(len0 - pos));
      Bank& bk = Bank::get();
      for (auto& v : pool.voices) if (v.active) { const Wave* w[3] = { &bk.w[v.shape[0]], &bk.w[v.shape[1]], &bk.w[v.shape[2]] }; v.render(w, L + a + pos, R + a + pos, len); }
      pos += len; untilTick -= (uint32_t)len; samples += (uint64_t)len;
    }
  }

 private:
  struct Key { uint8_t key; float velocity, pan; bool on; };
  float fs, p[NP]; float bpm = 120, wheel = 0; bool playing = false, enabled = true, allOffPending = false; double songBeat = 0;
  uint32_t untilTick = 0; uint64_t ticks = 0, samples = 0; std::vector<Key> keys; Pool pool; ArpEcho<Emit> sched;
  void queue(Key k) {
    if (keys.size() < (size_t)KEY_QUEUE) keys.push_back(k);
    else if (!k.on) { for (size_t i = keys.size(); i-- > 0;) if (keys[i].on && keys[i].key == k.key) { keys.erase(keys.begin() + (long)i); break; } }
  }
  void controlTick(const Tick& t, uint32_t n) {
    for (auto& v : pool.voices) if (v.active && v.gate > 0) { v.gate--; if (v.gate == 0) v.release(p); }
    Emit emit{ &pool, p };
    if (allOffPending) { allOffPending = false; sched.reset(); pool.held.clear(); for (auto& v : pool.voices) if (v.active) v.release(p); }
    for (const Key& k : keys) { if (k.on) sched.keyOn(k.key, k.velocity, k.pan, p, t, emit); else sched.keyOff(k.key, t, emit); }
    keys.clear();
    sched.tick(p, t, emit);
    pool.global.tick(p, t);
    Ctl c{ p, fs, wheel, (float)n, samples };
    for (auto& v : pool.voices) if (v.active) { ModFrame f = v.m.tick(p, pool.global, t); if (v.control(c, f)) v.active = false; }
    ticks++;
  }
};

}  // namespace

Instrument* makeThreeOsc(double sr) { return new ThreeOsc(sr); }

}  // namespace mdaw
