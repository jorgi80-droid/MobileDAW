// Honeydew FX modules kept in their own Rust files: multiband.rs (36 Multiband Compressor), tape_stop.rs (42 Tape Stop),
// spreader.rs (44 Spreader), waveshaper.rs (41 Waveshaper). See hdfx.h.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#include "hdfx2.h"
#include "hdmfx.h"
#include <vector>
#include <cstring>
#include <cstdint>
#include <algorithm>

namespace mdaw {
namespace hdfx {

static inline float clampf(float x, float a, float b) { return x < a ? a : (x > b ? b : x); }
static inline size_t nextPow2(size_t n) { size_t p = 1; while (p < n) p <<= 1; return p; }

// ---------------- multiband.rs ----------------
struct MbBiquad {
  float c[5] = {}, in[2][2] = {}, out[2][2] = {};
  float run(int ch, float s) {
    float r = flushf(c[0] * s + c[1] * in[ch][0] + c[2] * in[ch][1] + c[3] * out[ch][0] + c[4] * out[ch][1]);
    in[ch][1] = in[ch][0]; in[ch][0] = s; out[ch][1] = out[ch][0]; out[ch][0] = r; return r;
  }
  void clear() { std::memset(in, 0, sizeof in); std::memset(out, 0, sizeof out); }
};
static void crossover(float f, float sr, float* lo, float* hi) {
  double omega = 2.0 * 3.141592653589793 * (double)std::min(f, sr * 0.49f) / (double)sr;
  double s = std::sin(omega), c = std::cos(omega), alpha = s / (2.0 * (double)0.707000017f), den = 1.0 / (1.0 + alpha);
  float fb0 = (float)(2.0 * c * den), fb1 = (float)((alpha - 1.0) * den);
  float lb0 = (float)(0.5 * (1.0 - c) * den), hb0 = (float)(0.5 * (1.0 + c) * den);
  lo[0] = lb0; lo[1] = (float)((1.0 - c) * den); lo[2] = lb0; lo[3] = fb0; lo[4] = fb1;
  hi[0] = hb0; hi[1] = (float)(-(1.0 + c) * den); hi[2] = hb0; hi[3] = fb0; hi[4] = fb1;
}
struct Splitter {
  MbBiquad low[2], high[2];
  void set(float f, float sr) { float lo[5], hi[5]; crossover(f, sr, lo, hi); for (int i = 0; i < 2; i++) { std::memcpy(low[i].c, lo, sizeof lo); std::memcpy(high[i].c, hi, sizeof hi); } }
  void run(float l, float r, float* lo, float* hi) {
    lo[0] = hi[0] = l; lo[1] = hi[1] = r;
    for (int s = 0; s < 2; s++) for (int ch = 0; ch < 2; ch++) { lo[ch] = low[s].run(ch, lo[ch]); hi[ch] = high[s].run(ch, hi[ch]); }
  }
  void clear() { for (int i = 0; i < 2; i++) { low[i].clear(); high[i].clear(); } }
};
struct Band {
  float tGain = 1, gain = -1, tIn = 1, in = -1, dryMix = 0, dry = -1, tWidth = 0.5f, width = -1, thr = 1, rInv = 1, atk = 1, rel = 1, peak = -1, env = -1; bool bypass = false, safeW = false;
  void run(float l, float r, float kl, float kr, float& ol, float& orr) {
    if (bypass) { ol = l; orr = r; return; }
    if (gain < 0) gain = tGain; if (in < 0) in = tIn;
    gain += (tGain - gain) * 0.01f; in += (tIn - in) * 0.01f;
    float il = l * in, ir = r * in, level = std::max(std::fabs(kl * in), std::fabs(kr * in)) * in;
    peak = level > peak ? level : flushf(peak * (1.0f - rel));
    env = env < 0 ? peak : flushf(env + (peak - env) * atk);
    float comp = env >= thr && env > 0 ? (thr + rInv * (env - thr)) / env : 1.0f;
    float amount = dry + comp; if (dry < 0) dry = dryMix;
    float a = il * gain * amount, b = ir * gain * amount;
    if (safeW) { float w = tWidth; if (w <= 0.5f) { float mid = (a + b) * 0.5f, side = (a - b) * w; a = mid + side; b = mid - side; } else { a -= (w - 0.5f) * b; b -= (w - 0.5f) * a; } }
    else {
      if (width < 0) width = tWidth; else if (width != tWidth) { width += (tWidth - width) * 0.01f; if (std::fabs(width - tWidth) < 0.001f) width = tWidth; }
      float mid = (a + b) * clampf(2.0f - 2.0f * width, 0, 1) * 0.5f, side = (a - b) * clampf(2.0f * width, 0, 1) * 0.5f; a = mid + side; b = mid - side;
    }
    dry = flushf(dry + (dryMix - dry) * 0.01f);
    ol = a; orr = b;
  }
  void clear() { gain = in = dry = width = peak = env = -1; }
};
static float xfreq(float v) { return 20.0f * std::exp2(9.0f * v); }
static float mbDb(float v) { return v < -60.0f ? 0.0f : std::pow(10.0f, v * 0.05f); }
struct Multiband : Ext {
  float sr = 0, p[31] = {}; Splitter sp[3]; Band b[3]; float mg = -1, mt = 1;
  void refresh(const float* q, float rate) override {
    if (rate != sr) { sr = rate; std::memcpy(p, q, sizeof p); float lo = xfreq(p[2]), hi = xfreq(p[3]); sp[0].set(lo, sr); sp[1].set(hi, sr); sp[2].set(hi, sr); for (auto& s : sp) s.clear(); for (auto& x : b) { x = Band(); } mg = -1; }
    else { if (q[2] != p[2]) sp[0].set(xfreq(q[2]), sr); if (q[3] != p[3]) { float hi = xfreq(q[3]); sp[1].set(hi, sr); sp[2].set(hi, sr); } std::memcpy(p, q, sizeof p); }
    mt = mbDb(48.0f * p[1] - 24.0f);
    for (int k = 0; k < 3; k++) {
      int base = 6 + k * 7; Band& x = b[k]; int mode = (int)(2.0f * p[base + 6]);
      x.bypass = mode == 1; x.tGain = mode == 2 ? 0.0f : mbDb(48.0f * p[base + 5] - 24.0f);
      x.tIn = mbDb(48.0f * p[base] - 24.0f); x.thr = mbDb(48.0f * p[base + 1] - 48.0f); x.rInv = 1.0f / (1.0f + 30.0f * p[base + 2]);
      float as = 0.05f * p[base + 3] * p[base + 3];
      x.atk = as < 0.000001f ? 1.0f : 1.0f - (float)std::pow(0.1, 1.0 / (double)(44100.0f * as));
      float rs = 0.01f + 0.99f * p[base + 4]; x.rel = 1.0f - (float)std::pow(0.1, 1.0 / (double)(44100.0f * rs));
      x.dryMix = p[5] * p[5]; x.tWidth = p[27 + k]; x.safeW = p[30] >= 0.5f;
    }
  }
  void frame(float& l, float& r) override {
    if (p[0] < 0.5f) return;
    float lo[2], up[2], mid[2], hi[2], la[2], lb[2];
    sp[0].run(l, r, lo, up); sp[1].run(up[0], up[1], mid, hi); sp[2].run(lo[0], lo[1], la, lb);
    float band[3][2] = { { la[0] + lb[0], la[1] + lb[1] }, { mid[0], mid[1] }, { hi[0], hi[1] } }, o[3][2];
    for (int k = 0; k < 3; k++) b[k].run(band[k][0], band[k][1], band[k][0], band[k][1], o[k][0], o[k][1]);
    mg = mg < 0 ? mt : mg + (mt - mg) * 0.01f;
    l = mg * (o[0][0] + o[1][0] + o[2][0]); r = mg * (o[0][1] + o[1][1] + o[2][1]);
  }
  void reset(const float*) override { for (auto& s : sp) s.clear(); for (auto& x : b) x.clear(); mg = -1; }
};

// ---------------- tape_stop.rs ----------------
static size_t tsCapacity(float sr, float bpm) { return nextPow2(std::max((size_t)std::ceil(sr * std::max(960.0f / bpm, 5.0f)), (size_t)2)); }
static float tsRead(const std::vector<float>& b, double head) {
  uint64_t n = b.size(), f = (uint64_t)std::floor(head); float fr = (float)(head - std::trunc(head));
  float a = b[f % n]; return a + (b[(f + 1) % n] - a) * fr;
}
struct TapeStop : Ext {
  float p[8] = {}, sr = 0, bpm = 120; std::vector<float> L, R; uint64_t wh = 0; double rh = 0; float phase = 1, step = 0; size_t rem = 0; float fade = 0, hl = 0, hr = 0;
  bool built = false;
  void build(const float* q, float rate) { std::memcpy(p, q, sizeof p); sr = rate; size_t n = tsCapacity(sr, bpm); L.assign(n, 0); R.assign(n, 0); built = true; reset(q); }
  void refresh(const float* q, float rate) override {
    if (!built || rate != sr) { build(q, rate); return; }
    bool was = p[5] > 0.5f, now = q[5] > 0.5f; std::memcpy(p, q, sizeof p);
    if (was != now) {
      float ctl = p[7] > 0.5f ? (now ? p[4] : p[3]) : (now ? p[2] : p[1]);
      static const float BEATS[10] = { 0, 0.25f, 0.375f, 0.5f, 0.75f, 1, 2, 4, 8, 16 };
      float sec = p[7] > 0.5f ? BEATS[(int)clampf(std::round(9.0f * ctl), 0, 9)] * 60.0f / bpm : 5.0f * ctl;
      float target = now ? 1.0f : 0.0f;
      rem = (size_t)(std::max(sec, 0.005f) * sr * std::fabs(target - phase)); rem = std::max(rem, (size_t)1);
      if (tsCapacity(sr, bpm) > L.size()) { size_t lag = (size_t)std::max((double)wh - rh, 0.0); size_t room = std::max(L.size() > lag + 1 ? L.size() - (lag + 1) : 0, (size_t)1); rem = std::min(rem, room); }
      step = (target - phase) / (float)rem; fade = 0;
    }
  }
  void regrow(size_t need) {
    std::vector<float> nl(need, 0.0f), nr(need, 0.0f); size_t old = L.size();
    uint64_t first = rem == 0 ? wh : std::max((uint64_t)std::max(std::floor(rh), 0.0), wh > old ? wh - old : 0);
    for (uint64_t f = first; f < wh; f++) { nl[f % need] = L[f % old]; nr[f % need] = R[f % old]; }
    L.swap(nl); R.swap(nr);
  }
  void tempo(float b) override { bpm = b; if (built) { size_t need = tsCapacity(sr, b); if (need > L.size()) regrow(need); } }
  void prepare(float b, double, float, int) override { bpm = b; }
  void idle(float b) override { bpm = b; }
  float speed() const {
    float warp = 2.0f * p[6] - 1.0f, curve = std::fabs(warp) < 0.005f ? 0.005f : 1.0f - std::pow(0.005f, -warp);
    return clampf((std::pow(1.0f - curve, -phase) - 1.0f) * (1.0f / curve - 1.0f), 0, 1);
  }
  void frame(float& l, float& r) override {
    size_t w = (size_t)(wh % L.size()); L[w] = l; R[w] = r; wh++;
    if (rem == 0) {
      rh = (double)wh;
      if (p[5] > 0.5f) { hl = l; hr = r; return; }
      float sm = std::max(1.0f - 44.1f / sr, 0.0f); hl = flushf(hl * sm); hr = flushf(hr * sm); l = hl; r = hr; return;
    }
    float ol = tsRead(L, rh), orr = tsRead(R, rh);
    rh += (double)speed(); phase = clampf(phase + step, 0, 1); rem--;
    if (p[5] > 0.5f) {
      size_t xf = (size_t)std::max(0.1f * sr, 1.0f);
      if (rem < xf) { fade = std::min(fade + 1.0f / (float)xf, 1.0f); ol += (l - ol) * fade; orr += (r - orr) * fade; }
    }
    hl = ol; hr = orr; l = ol; r = orr;
  }
  void reset(const float*) override { std::fill(L.begin(), L.end(), 0.0f); std::fill(R.begin(), R.end(), 0.0f); wh = 0; rh = 0; phase = p[5] > 0.5f ? 1.0f : 0.0f; step = 0; rem = 0; fade = 0; hl = hr = 0; }
};

// ---------------- spreader.rs ----------------
struct Spreader : Ext {
  float sr = 0, p[5] = {}; std::vector<float> f; uint32_t cursor = 0; int32_t maxD = 0, dA = 0, dB = 0;
  Spreader() : f(4160, 0.0f) {}
  void configure() {
    float rate = clampf(sr, 1.0f, 192000.0f);
    f[3] = std::exp(-500.0f / rate); f[4] = 1.0f - f[3];
    float rt = 1.0f / std::tan(std::min(47124.0f / rate, 1.5f));
    maxD = (int32_t)(rate * 0.0063492f); f[2085] = std::trunc(rate * 0.0063492f); f[15] = 3.1416f / rate;
    f[2097] = 1.0f - rt; f[11] = 1.0f / (rt + 1.0f); f[2086] = 1.0f / std::trunc(rate * 0.02322f); f[4152] = 0.5f * rt;
    controls();
  }
  void controls() { f[5] = 1.0f; f[8] = p[4]; f[12] = 2.0f * p[1]; f[16] = 10.0f * std::pow(1000.0f, p[2]); f[4157] = p[3]; }
  void refresh(const float* q, float rate) override {
    std::memcpy(p, q, sizeof p);
    if (rate != sr) { sr = rate; std::fill(f.begin(), f.end(), 0.0f); cursor = 0; maxD = dA = dB = 0; configure(); } else controls();
  }
  void frame(float& left, float& right) override {
    float sm = f[3], st = f[4];
    float enable = f[5] * st + f[7] * sm, sep = f[8] * st + f[10] * sm, width = f[12] * st + f[14] * sm, lowB = f[16] * st + f[18] * sm;
    f[6] = enable; f[9] = sep; f[13] = width; f[17] = lowB;
    float t = std::tan(std::min(f[15] * lowB, 1.5f)), den = 1.0f / ((t + 1.4142f) * t + 1.0f);
    float a = ((enable * left - (f[22] + f[20] * (t + 1.4142f))) * t) * den, a1 = a + f[20];
    f[19] = f[20] + 2.0f * a; f[21] = f[22] + 2.0f * (a1 * t);
    float b = ((a1 * t + f[22]) - (f[30] + f[28] * (t + 1.4142f))) * t * den;
    float c = ((enable * right - (f[26] + f[24] * (t + 1.4142f))) * t) * den, c1 = (c + f[24]) * t;
    float d = ((c1 + f[26]) - (f[34] + f[32] * (t + 1.4142f))) * t * den;
    float b1 = (b + f[28]) * t, d1 = (d + f[32]) * t, ll = b1 + f[30], rl = d1 + f[34];
    f[23] = f[24] + 2.0f * c; f[25] = f[26] + 2.0f * c1; f[27] = f[28] + 2.0f * b; f[29] = f[30] + 2.0f * b1; f[31] = f[32] + 2.0f * d; f[33] = f[34] + 2.0f * d1;
    float lh = enable * left - a1 * 2.8284f, rhh = enable * right - (c + f[24]) * 2.8284f;
    float sa = lh + rhh - (ll + rl), sb = rl + lh, sc = ll + rhh;
    size_t slot = cursor & 2047; f[36 + slot] = sa; f[2100 + slot] = sb - sc;
    int32_t td = (int32_t)(f[2085] * width); float rs = f[2088], ramp = f[2090];
    if (rs == 0.0f) { if (ramp != 0.0f || dA == td) { if (ramp == 1.0f && dB != td) rs = -f[2086]; } else rs = f[2086]; }
    else if (ramp >= 1.0f || ramp <= 0.0f) rs = 0.0f;
    float nr = clampf(ramp + rs, 0, 1);
    int32_t nA = (dB == td || ramp < 1.0f) ? dA : td, nB = (dA == td || ramp > 0.0f) ? dB : td;
    uint32_t da = (uint32_t)std::min(std::max(nA, 0), maxD), db = (uint32_t)std::min(std::max(nB, 0), maxD);
    size_t ra = (size_t)(cursor - da) & 2047, rb = (size_t)(cursor - db) & 2047;
    cursor++; dA = nA; dB = nB; f[2087] = rs; f[2089] = nr;
    float dsb = (f[2100 + ra] + (f[2100 + rb] - f[2100 + ra]) * nr) * width, dsa = f[36 + ra] + (f[36 + rb] - f[36 + ra]) * nr;
    float pole = f[2097], ag = f[11], feed = f[4152], pdb = f[4149], pda = f[2096], nda = dsa * width;
    float a2 = f[4154] * pole + feed * (pdb - dsb), b2 = f[4151] * pole - 0.5f * (dsb + pdb), c2 = f[4156] * pole + feed * (pda - nda);
    float d2 = -(b2 * ag), e2 = -(a2 * ag), f2 = -(c2 * ag), g2 = -(f[2099] * pole - 0.5f * (nda + pda)) * ag;
    float wb = 2.0f * d2 + e2 * 0.79621f, wa = ((d2 + g2) + (f2 + e2) * 0.39811f) - 0.5f * ((wb + sc) - sb);
    float bm = f[4157] * st + f[4159] * sm, bass = (wb + lh + rhh) - (ll + rl) + bm * (ll + rl), stereo = sep * (wa + wa);
    float ol = stereo + (1.0f - enable) * left + (1.0f - bm) * ll + 0.5f * bass;
    float orr = (1.0f - enable) * right + (1.0f - bm) * rl - stereo + 0.5f * bass;
    f[4148] = dsb; f[2095] = nda; f[4150] = d2; f[4153] = e2; f[4155] = f2; f[2098] = g2; f[4158] = bm;
    static const int PAIRS[21][2] = { { 7, 6 }, { 10, 9 }, { 14, 13 }, { 18, 17 }, { 20, 19 }, { 22, 21 }, { 24, 23 }, { 26, 25 }, { 28, 27 }, { 30, 29 }, { 32, 31 }, { 34, 33 },
      { 2088, 2087 }, { 2090, 2089 }, { 2096, 2095 }, { 2099, 2098 }, { 4149, 4148 }, { 4151, 4150 }, { 4154, 4153 }, { 4156, 4155 }, { 4159, 4158 } };
    for (auto& pr : PAIRS) f[pr[0]] = flushf(f[pr[1]]);
    left = ol; right = orr;
  }
  void reset(const float*) override { std::fill(f.begin(), f.end(), 0.0f); cursor = 0; maxD = dA = dB = 0; configure(); }
};

// ---------------- waveshaper.rs ----------------
struct Pt { float x, y, c; };
static float pointCurve(const Pt* pts, int n, float in) {
  if (in < pts[0].x) return pts[0].y;
  for (int i = 1; i < n; i++) if (in < pts[i].x) {
    float t = (in - pts[i - 1].x) / (pts[i].x - pts[i - 1].x), c = pts[i].c;
    float s = c > 0.0f ? std::pow(t, 1.0f - c) : 1.0f - std::pow(1.0f - t, 1.0f + c);
    return pts[i - 1].y + s * (pts[i].y - pts[i - 1].y);
  }
  return pts[n - 1].y;
}
static float signumf(float x) { return std::isnan(x) ? x : (std::signbit(x) ? -1.0f : 1.0f); }
static float wsShape(int idx, float x, float y, float in) {
  switch (idx) {
    case 0: {
      float a = 2.0f * x - 1.0f; if (std::fabs(a) < 1e-4f) a = 1e-4f; float k = 1.0f + 9.0f * y;
      auto g = [a](float u) { float d = u - a; return u / std::sqrt(d * d + 1.0f); };
      return g(k * in) / std::fabs(g(signumf(a) * (1.0f + 1.0f / std::fabs(a))));
    }
    case 1: { float a = 2.0f * x - 1.0f, k = 1.0f + 9.0f * y; return (std::tanh(a) + std::tanh(k * in - a)) / (1.0f + std::tanh(std::fabs(a))); }
    case 2: {
      float d = std::min(x, 1.0f - x), e = std::fabs(2.0f * y - 1.0f), m = std::max(1.0f - 2.0f * y, 0.0f), inner = 0.25f - 0.12f * x, outer = 0.01f + 0.18f * d;
      Pt pts[9] = { { -1.0f, -1.0f + 0.37f * m, 0 }, { -0.75f, -0.75f + 0.25f * m, 0 }, { -inner, -0.1f, 0 }, { -outer, -(0.02f + 0.88f * e), 0.5f }, { 0, 0, -0.3f },
        { outer, 0.02f + 0.88f * e, 0.3f }, { inner, 0.1f, -0.3f }, { 0.75f, 0.75f - 0.25f * m, 0 }, { 1.0f, 1.0f - 0.37f * m, 0.16f * m } };
      return pointCurve(pts, 9, in);
    }
    case 3: return std::sin((1.0f + 7.0f * y) * in + 2.0f - 4.0f * x);
    case 4: {
      float a = 0.1f + 0.9f * x, pp = 0.1f + 0.6f * y, q = std::fmod((in + 1.0f) / (2.0f * pp), 1.0f); if (q < 0) q += 1.0f;
      return q < a ? 2.0f * q / a - 1.0f : (2.0f - 2.0f * q) / (1.0f - a) - 1.0f;
    }
    case 5: {
      float yf = clampf(4.0f * x - 1.0f, -1, 1), x0 = clampf(-0.999f + 1.998f * (x - 0.5f), -0.999f, 0.0f), c = 1.6f * (y - 0.5f);
      Pt pts[5] = { { -1.0f, yf, 0 }, { x0, yf, 0 }, { 0, 0, c }, { 0.999f, 1.0f, -c }, { 1.0f, 1.0f, 0 } };
      return pointCurve(pts, 5, in);
    }
    default: {
      float a = 0.6f + 0.4f * x, k = y > 0.5f ? 0.03f + 7.94f * (y - 0.5f) : -0.03f - 7.94f * (0.5f - y);
      float damp = std::exp(-std::exp(std::pow(20.0f, 1.0f - a)) * in * in);
      return in + damp * std::sin(6.2831855f * k * in);
    }
  }
}
struct Waveshaper : Ext {
  float p[21] = {}, sr = 44100; Biquad pl[2], ph[2], pb[2], pm[2], pt[2]; float dci[2] = {}, dco[2] = {}, dp = 0, wp = 0; double phase = 0, pstep = 0; float x = 0, y = 0;
  void refresh(const float* q, float rate) override {
    std::memcpy(p, q, sizeof p); sr = rate;
    float hc = std::min(20.0f * std::pow(1000.0f, p[9]), sr * 0.45f), lc = std::min(20.0f * std::pow(1000.0f, p[10]), sr * 0.45f), mf = std::min(500.0f * std::pow(4.0f, p[12]), sr * 0.45f);
    for (int c = 0; c < 2; c++) {
      pl[c].filter(LowPass, hc, 0.7f, sr); ph[c].filter(HighPass, lc, 0.7f, sr);
      pb[c].param(LowShelf, std::min(200.0f, sr * 0.45f), 1.0f, 36.0f * p[11] - 18.0f, sr);
      pm[c].param(Peak, mf, 1.0f, 36.0f * p[13] - 18.0f, sr);
      pt[c].param(HighShelf, std::min(6000.0f, sr * 0.45f), 1.0f, 36.0f * p[14] - 18.0f, sr);
    }
  }
  void prepare(float bpm, double sb, float, int) override {
    if (p[16] >= 0.5f) {
      static const double P[10] = { 0.125, 0.25, 0.375, 0.5, 0.75, 1.0, 2.0, 4.0, 8.0, 16.0 };
      int i = std::min((int)(p[17] * 9.0f), 9); double per = P[i];
      if (sb >= 0) { double r = std::fmod(sb / per, 1.0); phase = r < 0 ? r + 1.0 : r; }
      pstep = (double)bpm / (60.0 * per * (double)sr);
    } else { float rate = 0.02f + 9.9f * p[18] * p[18] * p[18]; pstep = (double)(rate / sr); }
  }
  void frame(float& l, float& r) override {
    if (!std::isfinite(l) || !std::isfinite(r) || p[0] < 0.5f) return;
    int ws = (int)std::round(p[15] * 2.0f);
    float wave = ws == 1 ? (float)(2.0 * phase - 1.0) : ws == 2 ? (phase < 0.5 ? -1.0f : 1.0f) : (float)std::sin(6.283185307179586 * phase);
    { double r2 = std::fmod(phase + pstep, 1.0); phase = r2 < 0 ? r2 + 1.0 : r2; }
    float pole = std::max(1.0f - 44.1f / sr, 0.0f);
    float tx = clampf(p[3] + 0.5f * p[19] * wave, 0, 1), ty = clampf(p[4] + 0.5f * p[20] * wave, 0, 1);
    x = flushf(pole * x + (1.0f - pole) * tx); y = flushf(pole * y + (1.0f - pole) * ty);
    int idx = std::min((int)std::round(p[1] * 6.0f), 6);
    float drive = std::pow(10.0f, 2.0f * p[5]), spread = p[7] * p[7] * p[7] * p[7], post = std::pow(10.0f, (36.0f * p[6] - 18.0f) / 20.0f);
    float in[2] = { l, r }, wet[2];
    for (int c = 0; c < 2; c++) {
      float filt = ph[c].run(pl[c].run(in[c])), sh = drive * filt + (c == 0 ? -spread : spread), shaped = wsShape(idx, x, y, sh);
      float dc = flushf(shaped - dci[c] + 0.995f * dco[c]); dci[c] = shaped; dco[c] = dc;
      wet[c] = pt[c].run(pm[c].run(pb[c].run(dc)));
    }
    float dm = 0.5f * (l * l + r * r), wm = 0.5f * (wet[0] * wet[0] + wet[1] * wet[1]);
    dp = flushf(dp + 0.01f * (dm - dp)); wp = flushf(wp + 0.01f * (wm - wp));
    float ag = p[2] >= 0.5f ? std::min(std::sqrt(dp / std::max(wp, 0.004f)), 16.0f) : 1.0f;
    float mix = p[8], dw = std::cos(1.57079637f * mix), ww = std::sin(1.57079637f * mix) * post * ag;
    l = l * dw + wet[0] * ww; r = r * dw + wet[1] * ww;
  }
  void reset(const float*) override {
    for (int c = 0; c < 2; c++) { pl[c].clear(); ph[c].clear(); pb[c].clear(); pm[c].clear(); pt[c].clear(); dci[c] = dco[c] = 0; }
    dp = wp = 0; phase = 0; pstep = 0; x = p[3]; y = p[4];
  }
};

// ---------------- multifx.rs (4 MultiFX): the bank already ported for GMSynth (hdmfx.cpp) ----------------
struct MultiFx : Ext {
  MfxBank* bank = nullptr; float sr = 0; bool enabled = false; int kind = 5; double x = 0.5, y = 0.5, rate = 1, amount = 0; int shape = 0;
  ~MultiFx() override { delete bank; }
  void refresh(const float* p, float rate_) override {
    static const int VISIBLE[8] = { 5, 6, 3, 4, 1, 2, 7, 9 };
    static const float RB[10] = { 0.125f, 0.25f, 0.375f, 0.5f, 0.75f, 1, 2, 4, 8, 16 };
    if (!bank || rate_ != sr) { delete bank; sr = rate_; bank = new MfxBank(sr); }
    enabled = p[0] >= 0.5f; kind = VISIBLE[std::min((int)(clampf(p[1], 0, 1) * 7.0f), 7)];
    x = clampf(p[2], 0, 1); y = clampf(p[3], 0, 1); rate = RB[std::min((int)(clampf(p[4], 0, 1) * 9.0f), 9)];
    amount = p[5] * std::fabs(p[5]); shape = std::min((int)(clampf(p[6], 0, 1) * 2.0f), 2);
  }
  void prepare(float bpm, double sb, float, int frames) override { bank->prepare(x, y, rate, amount, shape, bpm, sb, frames); }
  void frame(float& l, float& r) override { if (!enabled) return; double io[2] = { l, r }; bank->frame(io, kind); l = (float)io[0]; r = (float)io[1]; }
  void reset(const float*) override { bank->reset(); }
};
static const float D4[7] = { 1, 0, 0.5f, 0.5f, 0.61f, 0, 0 };
// ---------------- pitcher.rs (25 Pitcher) / pitcher2.rs (45 Pitcher 2) ----------------
static float dot8(const float* a, const float* b, size_t n) {
  size_t whole = n / 8 * 8; float lanes[8] = {};
  for (size_t i = 0; i < whole; i += 8) for (int k = 0; k < 8; k++) lanes[k] += a[i + k] * b[i + k];
  float tail = 0; for (size_t i = whole; i < n; i++) tail += a[i] * b[i];
  float sum = 0; for (int k = 0; k < 8; k++) sum += lanes[k];
  return sum + tail;
}
enum SearchKind { S_WAIT, S_UNVOICED, S_EDGE, S_PITCH };
struct Tracker {
  static const size_t RING = 2048;
  std::vector<float> ring, scores; size_t index = 0, count = 0, dec = 1, decCount = 0; float rate = 44100;
  void init(float sr, float lowest) {
    dec = std::max((size_t)std::floor(sr / 12000.0f), (size_t)1); rate = sr / (float)dec;
    ring.assign(2 * RING, 0); scores.assign((size_t)std::ceil(rate / lowest) + 2, 0); index = count = decCount = 0;
  }
  void push(float s) { if (++decCount == dec) { decCount = 0; ring[index] = s; ring[index + RING] = s; index = (index + 1) % RING; count = std::min(count + 1, RING); } }
  int search(float highest, float lowest, float threshold, float& hz) {
    size_t minLag = (size_t)std::max(std::floor(rate / highest), 2.0f), maxLag = std::min((size_t)std::ceil(rate / lowest), scores.size() - 2), window = maxLag * 2;
    if (count < window + maxLag) return S_WAIT;
    size_t end = index + RING; const float* x = &ring[end - window - maxLag]; const float* a = x + maxLag;
    float ea = dot8(a, a, window); const float* first = x + (maxLag - minLag);
    double eb = (double)dot8(first, first, window); size_t bestLag = 0; float bestS = threshold;
    std::fill(scores.begin(), scores.end(), 0.0f);
    for (size_t lag = minLag; lag <= maxLag; lag++) {
      size_t start = maxLag - lag;
      if (lag > minLag) eb += std::pow((double)x[start], 2) - std::pow((double)x[start + window], 2);
      float e = (float)eb;
      if (ea < 0.001f || e < 0.001f) continue;
      float score = dot8(a, x + start, window) / std::sqrt(ea * e); scores[lag] = score;
      float pref = score - 0.0005f * (float)lag; if (pref > bestS) { bestLag = lag; bestS = pref; }
    }
    size_t lag = bestLag; if (lag == 0) return S_UNVOICED;
    while (lag / 2 > minLag) {
      size_t half = lag / 2, at = half - 1;
      for (size_t c = half - 1; c <= half + 1; c++) if (scores[c] >= scores[at]) at = c;   // max_by keeps the last of equals
      if (scores[at] < 0.9f * scores[lag]) break;
      lag = at;
    }
    if (lag == minLag || lag == maxLag) return S_EDGE;
    float pv = scores[lag - 1], cu = scores[lag], nx = scores[lag + 1], den = pv - 2.0f * cu + nx;
    float off = std::fabs(den) > 1e-6f ? 0.5f * (pv - nx) / den : 0.0f;
    hz = rate / ((float)lag + clampf(off, -0.5f, 0.5f)); return S_PITCH;
  }
  void reset() { std::fill(ring.begin(), ring.end(), 0.0f); index = count = decCount = 0; }
};
static inline int remEuclidI(int a, int b) { int r = a % b; return r < 0 ? r + b : r; }
static float pRead(const std::vector<float>& b, size_t w, float delay) {
  size_t len = b.size(); float pos = (float)w - delay; if (pos < 0.0f) pos += (float)len;
  size_t i = (size_t)pos >= len ? 0 : (size_t)pos, nx = i + 1 == len ? 0 : i + 1;
  return b[i] + (b[nx] - b[i]) * (pos - std::trunc(pos));
}
struct Pitcher : Ext {
  float p[23] = {}, sr = 0; size_t lat = 4; std::vector<float> hist[2], fh[2]; size_t w = 0; Tracker tr; size_t frames = 0;
  float tracked = 0, tRatio = 1, ratio = 1, phase = 0, fc = 0, fil[2] = {}, fol[2] = {}, stable = 0; bool voiced = false;
  bool notes[12] = { true, false, true, true, false, true, false, true, true, false, true, false };
  float base() const { return 440.0f * std::pow(2.0f, (2.0f * p[7] - 1.0f) / 12.0f); }
  float formantRatio() const { return std::pow(2.0f, 2.0f * p[5] - 1.0f); }
  void refresh(const float* q, float rate) override {
    if (sr != rate) { sr = rate; lat = std::max((size_t)(rate / 55.0f) & ~(size_t)3, (size_t)4); size_t n = lat * 3 + 4; for (int c = 0; c < 2; c++) { hist[c].assign(n, 0); fh[c].assign(n, 0); } tr.init(rate, 55.0f); std::memcpy(p, q, sizeof p); reset(q); }
    std::memcpy(p, q, sizeof p);
    float cut = std::min(500.0f * formantRatio(), 0.45f * rate); fc = clampf(1.0f - std::exp(-6.2831855f * cut / rate), 0, 1);
  }
  void extra(int k, float v) override { if (k < 0 || k > 11) return; bool n[12]; std::copy(notes, notes + 12, n); n[k] = v >= 0.5f; setNotes(n); }
  void setNotes(const bool* n) { if (std::equal(n, n + 12, notes)) return; std::copy(n, n + 12, notes); stable = 0; }
  void transpose(float& semi, float& cents) const { semi = (float)std::trunc(24.0 * (double)p[2] - 12.0); cents = (float)std::trunc(100.0 * (double)p[3] - 50.0) * 0.01f; }
  float nearest(float midi) const {
    int center = (int)std::round(midi); int best = 0; bool any = false; float bd = 0;
    for (int o = -12; o <= 12; o++) { int nt = center + o; if (!notes[remEuclidI(nt, 12)]) continue; float d = std::fabs(midi - (float)nt); if (!any || d < bd) { any = true; bd = d; best = nt; } }
    return any ? (float)best : midi;
  }
  float targetFor(float f) const {
    if (!std::isfinite(f) || f <= 0.0f) return 0.0f;
    float midi = 69.0f + 12.0f * std::log2(f / base()); int pc = remEuclidI((int)std::round(midi), 12);
    bool by = p[22] > 0.5f || p[10 + pc] > 0.5f; float tn = by ? midi : nearest(midi), se, ce; transpose(se, ce);
    return base() * std::pow(2.0f, (tn + se + ce - 69.0f) / 12.0f);
  }
  float holdTarget() {
    if (tracked <= 0.0f) return 1.0f;
    float t = targetFor(tracked);
    if (p[8] > 0.0f && stable > 0.0f && std::fabs(12.0f * std::log2(t / stable)) < p[8] * 0.5f) return stable / tracked;
    stable = t; return t / tracked;
  }
  void observe(float s) {
    tr.push(s); if (frames % 64 != 0) return;
    float hz; int k = tr.search(1500.0f, 55.0f, 0.3f, hz);
    if (k == S_PITCH) { tracked = hz; voiced = true; } else if (k != S_WAIT) voiced = false;
    tRatio = holdTarget();
  }
  void frame(float& l, float& r) override {
    int ch = (int)(p[6] * 2.0f); float mono = ch == 0 ? l : (ch == 1 ? 0.5f * (l + r) : r);
    observe(mono);
    float om = 1.0f - p[1], speed = om * om * om * 3.0f + 0.001f, coef = std::min(8.82f / (sr * speed), 1.0f);
    ratio += coef * (clampf(tRatio, 0.5f, 2.0f) - ratio);
    float win = (float)lat, ph = phase + (1.0f - ratio) / win; phase = ph - std::floor(ph);
    float in[2] = { l, r }, out[2];
    for (int c = 0; c < 2; c++) {
      fil[c] += fc * (in[c] - fil[c]); hist[c][w] = in[c]; fh[c][w] = fil[c];
      float dry = pRead(hist[c], w, win);
      float other = phase + 0.5f; other -= std::trunc(other);
      float wA = 1.0f - std::fabs(2.0f * phase - 1.0f), wB = 1.0f - std::fabs(2.0f * other - 1.0f), b0 = 0.5f * win;
      float sh = wA * pRead(hist[c], w, b0 + phase * win) + wB * pRead(hist[c], w, b0 + other * win);
      float wet = sh;
      if (p[4] != 0.0f) { fol[c] += fc * (sh - fol[c]); float ol = pRead(fh[c], w, win); wet = sh + 0.4f * (ol - fol[c]); }
      out[c] = p[0] < 0.5f ? dry : dry + p[9] * (wet - dry);
    }
    w = (w + 1) % hist[0].size(); frames = (frames + 1) % 64;
    l = out[0]; r = out[1];
  }
  void reset(const float*) override {
    for (int c = 0; c < 2; c++) { std::fill(hist[c].begin(), hist[c].end(), 0.0f); std::fill(fh[c].begin(), fh[c].end(), 0.0f); }
    tr.reset(); w = 0; frames = 0; tracked = 0; voiced = false; tRatio = 1; ratio = 1; phase = 0; fil[0] = fil[1] = fol[0] = fol[1] = 0; stable = 0;
  }
  int latency() override { return (int)lat; }
};
static size_t p2Window(float ll, float sr) { return (size_t)std::trunc((ll >= 0.5f ? 1024.0f : 2048.0f) * 0.000022676f * sr); }
static size_t p2Latency(size_t w) { return (size_t)std::trunc(1.2f * (float)w); }
struct Pitcher2 : Ext {
  float p[27] = {}, sr = 0; size_t window = 0, lat = 0; std::vector<float> hist[3], out[2], wts; size_t w = 0, frames = 0; Tracker tr;
  float tracked = 0, target = 0, stable = 0, desired = 1, coef = 0, ratio = 1, countdown = 0, vib = 0;
  void refresh(const float* q, float rate) override {
    size_t win = p2Window(q[25], rate);
    if (sr != rate || window != win) {
      window = win; lat = p2Latency(win);
      size_t hl = std::max(lat * 4 + 4096, (size_t)8192), ol = lat * 4 + 4096;
      for (auto& h : hist) h.assign(hl, 0); for (auto& o : out) o.assign(ol, 0); wts.assign(ol, 0);
      if (sr != rate) tr.init(rate, 65.0f);
      sr = rate; reset(q);
    }
    std::memcpy(p, q, sizeof p);
    coef = std::min((std::pow(200.0f, p[13]) - 0.9f) / rate, 1.0f);
  }
  float formant() const { return p[16] >= 0.5f ? std::pow(2.0f, 2.0f * p[17] - 1.0f) : 1.0f; }
  float targetFor(float f) const {
    if (!std::isfinite(f) || f <= 0.0f) return 0.0f;
    float midi = 69.0f + 12.0f * std::log2(f / 440.0f); int center = (int)std::round(midi), best = 0; bool any = false; float bd = 0;
    for (int o = -12; o <= 12; o++) { int nt = center + o; if (!(p[1 + remEuclidI(nt, 12)] > 0.5f)) continue; float d = std::fabs(midi - (float)nt); if (!any || d < bd) { any = true; bd = d; best = nt; } }
    return any ? 440.0f * std::pow(2.0f, ((float)best - 69.0f) / 12.0f) : f;
  }
  size_t back(size_t lag) const { size_t len = hist[0].size(); return lag > w ? w + len - lag : w - lag; }
  void hold() {
    float t = targetFor(tracked);
    if (t > 0.0f) { float hy = p[19] * 0.5f; if (stable == 0.0f || std::fabs(12.0f * std::log2(t / stable)) > hy) stable = t; target = stable; } else target = 0.0f;
    desired = tracked > 0.0f && target > 0.0f ? clampf(std::pow(target / tracked, 1.0f - 0.5f * p[20]), 0.5f, 2.0f) : 1.0f;
  }
  void observe(float s) {
    tr.push(s); if (frames % 256 != 0) return;
    float hz; int k = tr.search(1000.0f, 65.0f, 0.15f + 0.3f / std::pow(200.0f, p[23]), hz);
    if (k == S_PITCH) tracked = hz; else if (k == S_UNVOICED) { tracked = 0; stable = 0; }
    hold();
  }
  void grain() {
    size_t period = (size_t)std::round(sr / tracked); period = std::min(std::max(period, (size_t)8), window / 2);
    float fm = formant(); size_t ss = (size_t)std::ceil((float)period * std::max(fm, 1.0f)), lag = ss; float peak = -INFINITY;
    for (size_t c = ss; c <= ss + period; c++) { float v = hist[2][back(c)]; if (v > peak) { peak = v; lag = c; } }
    size_t radius = std::min(period, lat > period + 1 ? lat - (period + 1) : 0);
    if (radius < 8) return;
    size_t ol = out[0].size(), at = (frames + lat - period - radius) % ol;
    for (long off = -(long)radius; off <= (long)radius; off++) {
      float ph = (float)(off + (long)radius) / (float)(2 * radius), s = std::sin(3.14159274f * ph), wt = s * s;
      float src = (float)lag - (float)off * fm; size_t whole = (size_t)src; float fr = src - std::trunc(src);
      size_t nw = back(whole), od = back(whole + 1);
      for (int c = 0; c < 2; c++) { float smp = hist[c][nw] + (hist[c][od] - hist[c][nw]) * fr; out[c][at] += smp * wt; }
      wts[at] += wt; at = at + 1 == ol ? 0 : at + 1;
    }
  }
  void frame(float& l, float& r) override {
    int rc = (int)std::trunc(2.0f * p[18]); float ref = rc == 0 ? l : (rc == 1 ? r : 0.5f * (l + r));
    size_t idx = w; hist[0][idx] = l; hist[1][idx] = r; hist[2][idx] = ref;
    observe(ref);
    ratio += coef * (desired - ratio);
    vib = vib + 5.0f / sr; vib -= std::trunc(vib);
    if (tracked > 0.0f && p[0] >= 0.5f) {
      countdown -= 1.0f;
      if (countdown <= 0.0f) {
        grain();
        float v = std::pow(2.0f, p[24] * 0.3f * std::sin(6.2831855f * vib) / 12.0f);
        countdown += clampf(sr / (tracked * ratio * v), 8.0f, sr / 65.0f);
      }
    } else countdown = 0.0f;
    size_t oi = frames % out[0].size(); float wt = wts[oi]; size_t di = back(lat); float dry[2] = { hist[0][di], hist[1][di] };
    float mix = p[0] >= 0.5f ? p[22] : 0.0f, fade = std::max(1.0f - wt / 0.25f, 0.0f), wet[2];
    for (int c = 0; c < 2; c++) wet[c] = out[c][oi] / std::max(wt, 0.25f) + fade * dry[c];
    l = dry[0] + mix * (wet[0] - dry[0]); r = dry[1] + mix * (wet[1] - dry[1]);
    out[0][oi] = 0; out[1][oi] = 0; wts[oi] = 0; w = (idx + 1) % hist[0].size(); frames++;
  }
  void reset(const float*) override {
    for (auto& h : hist) std::fill(h.begin(), h.end(), 0.0f); for (auto& o : out) std::fill(o.begin(), o.end(), 0.0f); std::fill(wts.begin(), wts.end(), 0.0f);
    tr.reset(); w = 0; frames = 0; tracked = target = stable = 0; desired = 1; ratio = 1; countdown = 0; vib = 0;
  }
  int latency() override { return (int)lat; }
};
static const float D25[23] = { 1, 0, 0.5f, 0.5f, 0, 0.5f, 0, 0.5f, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
static const float D45[27] = { 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0.5f, 0, 0, 0, 0.5f, 1, 0.5f, 0, 0, 1, 0.5f, 0, 0, 0 };
static const float D36[31] = { 1, 0.5f, 0.3f, 0.7f, 0, 0, 0.5f, 1, 0, 0.3f, 0.3f, 0.5f, 0, 0.5f, 1, 0, 0.3f, 0.3f, 0.5f, 0, 0.5f, 1, 0, 0.3f, 0.3f, 0.5f, 0, 0.5f, 0.5f, 0.5f, 0 };
static const float D41[21] = { 1, 0, 0, 0.5f, 0.5f, 0, 1.0f / 6.0f, 0, 1, 1, 0, 0.5f, 0.5f, 0.5f, 0.5f, 0, 0, 0.5f, 0, 0, 0 };
static const float D42[8] = { 1, 0.2f, 0.2f, 1.0f / 3.0f, 1.0f / 3.0f, 1, 0.5f, 0 };
static const float D44[5] = { 1, 0, 0, 0, 0.5f };

Ext* makeExt(int id, float sr, int& n, const float*& def) {
  switch (id) {
    case 4: n = 7; def = D4; return new MultiFx();
    case 25: n = 23; def = D25; return new Pitcher();
    case 45: n = 27; def = D45; return new Pitcher2();
    case 36: n = 31; def = D36; return new Multiband();
    case 41: n = 21; def = D41; return new Waveshaper();
    case 42: { n = 8; def = D42; auto* t = new TapeStop(); return t; }
    case 44: n = 5; def = D44; return new Spreader();
    default: n = 0; def = nullptr; return nullptr;
  }
}
int extParamCount(int id) { int n = 0; const float* d = nullptr; Ext* e = makeExt(id, 44100, n, d); delete e; return n; }

}  // namespace hdfx
}  // namespace mdaw
