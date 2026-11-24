// Port of js/engine/hdmini.js (MiniSynth, Honeydew model). Every expression keeps the JS operation order (golden compares samples).
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#include "hdmini.h"
#include <algorithm>

namespace mdaw {

namespace {
constexpr int MSV = 5, CBLOCK = 32, TLEN = 2048, HARMONICS = 1024;
constexpr double PHASE = 4294967296.0, TAU = 2 * PI, FLUSH = 1e-20;
constexpr int OFF = 0, ATTACK = 1, DECAY = 2, RELEASE = 3;
const double RATE_BEATS[12] = {0.25, 0.375, 0.5, 0.75, 1, 2, 4, 8, 16, 64, 128, 256};
const double SPREAD[8] = {-0.05, -0.0375, -0.025, -0.0125, 0, 0.0125, 0.025, 0.0375};

const float* tables() {
  static std::vector<float> out;
  if (!out.empty()) return out.data();
  std::vector<double> cs(TLEN), sn(TLEN), sum(TLEN, 0.0); out.assign((size_t)HARMONICS * TLEN, 0.f);
  for (int n = 0; n < TLEN; n++) { const double t = TAU * n / TLEN; cs[n] = std::cos(t); sn[n] = std::sin(t); }
  for (int h = 1; h <= HARMONICS; h++) {
    const double magnitude = (0.1402 + 0.1398 * std::exp(-(h - 1) / 2.8832) + 0.0215 * std::exp(-(h - 1) / 9.4539) + 0.0768 * std::pow(h / 1024.0, 2.4706)) / h;
    const double phase = -1.57007 + 0.00154 * (h - 1) - 3.09168 * h / ((double)h * h + 14.42413);
    const double a = magnitude * std::cos(phase), b = magnitude * std::sin(phase); const int o = (h - 1) * TLEN;
    for (int n = 0; n < TLEN; n++) { const int i = (h * n) % TLEN; sum[n] += a * cs[i] - b * sn[i]; out[o + n] = (float)sum[n]; }
  }
  return out.data();
}
int harmonics(double f1, double sr) { return f1 <= sr / 2048 ? HARMONICS : (int)clamp(std::floor(sr / (2 * f1)) + 1, 1, HARMONICS); }
double interval(double m) { return std::pow(2.0, std::trunc((double)(float)((double)(float)m * 2 - 1) * 12) / 12 + 0.00625); }
uint32_t cycles(double x) { return (uint32_t)(uint64_t)std::trunc(x * PHASE); }
uint32_t increment(double f, double sr) { const double x = std::trunc(f * PHASE / sr); return x >= PHASE ? 0xffffffffu : x > 0 ? (uint32_t)x : 0u; }
double envU(double v) { return 0.95 * v + 0.05; }
double pow4(double x) { return x * x * x * x; }
double attackRate(double v) { return v < 0.001 ? 1 : 4e-7 / pow4(envU(v)); }
double decayRate(double v) { return v < 0.0177 ? 1 : 4e-6 / pow4(envU(v)); }
double ampReleaseRate(double v) { return 4e-5 / pow4(envU(envU(v))); }
double glideRate(double v) { return 0.9 * pow4(1 - v) + 0.01; }
int rateIndex(double x) { return (int)jsMin(11, std::trunc(11 * clamp(x / 100, 0, 1))); }

void ladderSet(MsVoice& o, double g, double k) {
  double* m = o.m; double* t = o.t;
  for (int i = 0; i < 25; i++) m[i] = 0;
  m[0] = 1 - g; m[3] = -g * k; m[4] = g;
  for (int i = 1; i < 4; i++) { for (int j = 0; j < 5; j++) m[i * 5 + j] = g * m[(i - 1) * 5 + j]; m[i * 5 + i] += 1 - g; }
  m[24] = 1;
  for (int s = 0; s < 12; s++) {
    for (int i = 0; i < 5; i++) for (int j = 0; j < 5; j++) { double x = 0; for (int q = 0; q < 5; q++) x += m[i * 5 + q] * m[q * 5 + j]; t[i * 5 + j] = x; }
    for (int i = 0; i < 25; i++) m[i] = t[i];
  }
}
inline double ladderTick(MsVoice& o, double u) {
  const double* m = o.m; double* s = o.s; const double s0 = s[0], s1 = s[1], s2 = s[2], s3 = s[3];
  double a = m[0] * s0 + m[1] * s1 + m[2] * s2 + m[3] * s3 + m[4] * u;
  const double b = m[5] * s0 + m[6] * s1 + m[7] * s2 + m[8] * s3 + m[9] * u;
  const double cc = m[10] * s0 + m[11] * s1 + m[12] * s2 + m[13] * s3 + m[14] * u;
  const double d = m[15] * s0 + m[16] * s1 + m[17] * s2 + m[18] * s3 + m[19] * u;
  a /= 1 + a * a;
  s[0] = a; s[1] = b; s[2] = cc; s[3] = d;
  return d;
}
inline uint32_t rngNext(uint32_t& s) { uint32_t x = s; x ^= x << 13; x ^= x >> 17; x ^= x << 5; s = x; return x; }
inline double rngUniform(uint32_t& s) { return (double)(rngNext(s) >> 8) * (1 / 8388608.0) - 1; }
inline double overdrive(double x, double D) { return x >= 0 ? 1 - (1 - x) * std::pow(10.0, -D * x) : -1 + (1 + x) * std::pow(10.0, D * x); }
inline double envTick(MsEnv& e, double decay, double sustain) {
  e.lv += (e.tg - e.lv) * e.rate;
  if (e.st == ATTACK && e.lv > 1) { e.lv = 1; e.st = DECAY; e.tg = sustain; e.rate = decay; }
  return e.lv;
}
void clearVoice(MsVoice& o) {
  o.key = 0; o.vel = 0; o.pan = 0.5; o.started = 0; o.pitch = 0; o.freq = 0; o.wave = 0;
  for (auto& x : o.inc) x = 0; for (auto& x : o.ofs) x = 0;
  o.amp = MsEnv(); o.feg = MsEnv();
  o.gL = o.gR = o.tL = o.tR = 0; o.cutoff = 0; for (auto& x : o.m) x = 0; for (auto& x : o.s) x = 0; o.dc = 0;
}
}  // namespace

HdMiniSynth::HdMiniSynth(double rate) : sr(rate > 0 && std::isfinite(rate) ? rate : 44100), T(tables()) {
  for (auto& h : held) h = -1;
  dlen = (int)std::ceil(sr * 1.5) + 2; dl.assign(dlen, 0.f);
  chN = (int)jsMax(2, std::trunc(0.01 * sr)); chLen = chN + 2; ch.assign(chLen, 0.f);
  static const double D[44] = {0, 0, 0, 0, 100, 0, 0, 0, 0, 100, 1, 100, 0, 0, 2, 0, 0, 0, 0, 0, 100, 1, 7, 0, 0, 0, 0, 0, 0, 50, 100, 50, 2, 0, 25, 50, 50, 0, 11.22, 40, 10, 50, 100, 0};
  for (int i = 0; i < 44; i++) p[i] = D[i];
  reset();
}
void HdMiniSynth::reset() {
  rng = 0x12345678u;
  for (auto& o : v) { o.busy = false; clearVoice(o); o.drift = 0; for (int k = 0; k < 8; k++) o.ph[k] = rngNext(rng); }
  serial = 0; last = -1; for (auto& h : held) h = -1; blockPos = 0; running = false; tail = 0; dpeak = 0; beat = 0;
  decN = 0; decS[0] = decS[1] = 0; std::fill(dl.begin(), dl.end(), 0.f); dpos = 0; dlp = 0; std::fill(ch.begin(), ch.end(), 0.f); chPos = 0; chPh0 = 0.62; chPh1 = 0.1;
  for (auto& x : apIn) x = 0; for (auto& x : apOut) x = 0; phOut[0] = phOut[1] = 0;
  update(); phS = c.phT;
}
void HdMiniSynth::setParam(int i, double x) {
  if (i < 0 || i >= 44 || !std::isfinite(x)) return;
  const double was = p[i]; p[i] = x;
  if (i == 28 && (was > 0.5) != (x > 0.5)) { std::fill(dl.begin(), dl.end(), 0.f); dlp = 0; }
  if (i == 33 && !(was > 0.5) && x > 0.5) { chPh0 = 0.62; chPh1 = 0.1; }
}
bool HdMiniSynth::active() { if (running) return true; for (auto& o : v) if (o.busy) return true; return false; }

void HdMiniSynth::noteOn(int keyIn, double vel) {
  const int key = (int)clamp(jsRound(keyIn), 0, 127);
  if (!(vel > 0) || !std::isfinite(vel)) return;
  bool others = false; for (int k = 0; k < 128; k++) if (k != key && held[k] >= 0) { others = true; break; }
  held[key] = vel;
  const int md = mode(), start = md == 2 && !others ? key : last >= 0 ? last : key;
  last = key;
  int index = 0;
  if (md == 0) {
    index = -1;
    for (int i = MSV - 1; i >= 0; i--) if (!v[i].busy) { index = i; break; }
    if (index < 0) { index = 0; for (int i = 1; i < MSV; i++) if (v[i].started < v[index].started) index = i; }
  }
  serial++;
  const double attack = attackRate(clamp(p[19] / 100, 0, 1)), fattack = attackRate(clamp(p[8] / 100, 0, 1)); MsVoice& o = v[index];
  if (md == 2 && others && o.busy && o.amp.st != RELEASE) { o.key = key; o.vel = vel; return; }
  const bool wasFree = !o.busy;
  if (wasFree) clearVoice(o);
  o.busy = true; o.key = key; o.vel = vel; o.pan = 0.5; o.started = serial; o.pitch = start;
  o.amp.st = ATTACK; o.amp.tg = 4; o.amp.rate = attack;
  o.feg.lv = 0; o.feg.st = ATTACK; o.feg.tg = 4; o.feg.rate = fattack;
  update(); voiceControl(o);
  running = true; tail = tailFrames();
  if (wasFree) { o.gL = o.tL; o.gR = o.tR; }
}
void HdMiniSynth::noteOff(int keyIn) {
  const int key = (int)clamp(jsRound(keyIn), 0, 127);
  held[key] = -1;
  MsVoice& lead = v[0];
  if (mode() == 2 && lead.busy && lead.key == key && lead.amp.st != RELEASE) {
    int to = -1;
    for (int k = key - 1; k >= 0; k--) if (held[k] >= 0) { to = k; break; }
    if (to < 0) for (int k = key + 1; k < 128; k++) if (held[k] >= 0) { to = k; break; }
    if (to >= 0) { lead.key = to; lead.vel = held[to]; return; }
  }
  for (auto& o : v) if (o.busy && o.key == key && o.amp.st != RELEASE) release(o);
}
void HdMiniSynth::release(MsVoice& o) {
  o.amp.st = RELEASE; o.amp.tg = 0; o.amp.rate = ampReleaseRate(clamp(p[22] / 100, 0, 1));
  o.feg.st = RELEASE; o.feg.tg = 0; o.feg.rate = decayRate(clamp(p[11] / 100, 0, 1));
}
void HdMiniSynth::allOff() { for (auto& h : held) h = -1; for (auto& o : v) if (o.busy && o.amp.st != RELEASE) release(o); }

void HdMiniSynth::update() {
  auto N = [&](int i) { return clamp(p[i] / 100, 0, 1); };
  auto I = [&](int i, int hi) { return (int)clamp(jsRound(p[i]), 0, hi); };
  const double lb = beat / RATE_BEATS[I(14, 11)], phase = lb - std::floor(lb); const int shape = I(15, 2);
  const double wave = shape == 0 ? std::sin(TAU * phase) : shape == 1 ? 1 - 2 * phase : phase < 0.5 ? 1 : -1;
  const double wh = N(17) * wheel; const int wd = I(18, 2), ld = I(16, 2);
  const double centred = clamp(p[13] / 100, -1, 1), a = centred + (wd == 1 ? wh : 0), lfo = (centred < 0 ? -a * a : a * a) * wave;
  const double modifier = clamp(N(1) + (wd == 2 ? wh : 0) + (ld == 2 ? lfo : 0), -1, 1), dk = N(26), drive = 20 * dk * dk, dg = 1 - drive / 16, dg2 = dg * dg, dg4 = dg2 * dg2;
  double seconds = 0.25 * (I(32, 3) + 1) * 60 / bpm;
  while (seconds > 1.5) seconds /= 2;
  c.decA = decayRate(N(20)); c.decF = decayRate(N(9)); c.susA = clamp(p[21], 0, 1); c.susF = clamp(p[10], 0, 1);
  c.glide = glideRate(N(24)); c.transpose = clamp(jsRound(p[3]), -12, 12);
  c.kind = I(0, 9); c.mod = modifier; c.interval = interval(modifier); c.noise = N(2) * N(2);
  c.lfoPitch = 12 * (ld == 1 ? lfo : 0);
  c.log2cut = 4 + 10.3 * N(4) + 4 * (ld == 0 ? lfo : 0) + 4 * (wd == 0 ? wh : 0);
  c.envAmt = std::pow(2.0, 10 * clamp(p[12] / 100, -1, 1));
  c.res = 4.05 * 0.99 * N(7);
  c.drive = drive; c.driveGain = 0.7 * (dg4 * dg4) + 0.3; c.hold = (int)std::trunc(64 * N(27) * N(27));
  c.dframes = (int)clamp(std::trunc(seconds * sr), 1, dlen - 1); c.dfb = N(29); c.dco = 0.99 * N(30) + 0.01; c.dmix = N(31) * N(31);
  const double pb = beat / RATE_BEATS[rateIndex(p[38])];
  c.phT = jsMax(N(41) * N(41), 1e-5); c.phW = N(39) * N(39) * N(39); c.phCos = std::cos(TAU * (pb - std::floor(pb))); c.phFb = 0.98 * std::cbrt(N(40)); c.phMix = jsMax(N(42), 1e-5);
  c.chDepth = 0.36 * N(35) + 0.04; c.chR0 = 4 * N(34) * N(34) + 0.2; c.chR1 = 4 * N(34) * N(34) + 0.25; c.chMix = N(36) * N(36);
  c.gain = std::pow(10.0, clamp(p[43], -60, 12) / 20);
}
void HdMiniSynth::voiceControl(MsVoice& o) {
  const double pitch = o.pitch + c.transpose + bend + c.lfoPitch + 0.08 * o.drift, f = 440 * std::pow(2.0, (pitch - 69) / 12), m = c.mod; const int kind = c.kind;
  o.freq = f;
  for (auto& x : o.inc) x = 0; for (auto& x : o.ofs) x = 0;
  double r0 = 1;
  if (kind == 1 || kind == 3 || kind == 4) o.inc[1] = increment(f * c.interval, sr);
  else if (kind == 5) { r0 = 1 + m * SPREAD[0]; for (int k = 1; k < 8; k++) o.inc[k] = increment(f * (1 + m * SPREAD[k]), sr); }
  else if (kind == 8) { r0 = 0.5 - 0.005 * m; o.inc[1] = increment(f, sr); o.inc[2] = increment(f * (2 + 0.02 * m), sr); }
  else if (kind == 9) { r0 = 1.5 - 0.015 * m; o.inc[1] = increment(f, sr); o.inc[2] = increment(f * (2 + 0.02 * m), sr); }
  o.inc[0] = increment(f * r0, sr);
  o.wave = (harmonics(f * r0, sr) - 1) * TLEN;
  const double f0 = std::pow(2.0, c.log2cut + clamp(p[5] / 100, 0, 1) * (pitch / 12 - 4) + 14 * clamp(p[6] / 100, 0, 1) * (o.vel - 0.5) + 0.103 * o.drift);
  o.cutoff = clamp(f0 + (f0 * c.envAmt - f0) * o.feg.lv, 0, 20000);
  ladderSet(o, clamp(o.cutoff * 6.25 / (4096 * sr), 0, 1), c.res);
  if (kind == 0 || kind == 2 || kind == 7) o.ofs[0] = cycles(1 - std::fabs(m));
  else if (kind == 3) o.ofs[0] = 2147483648u;
  else if (kind == 4) o.ofs[0] = cycles(0.5625);
  else if (kind == 6) for (int k = 0; k < 5; k++) o.ofs[k] = cycles((k + 1) * std::fabs(m) / 2);
  const double gain = clamp(o.vel, 0, 1), pan = clamp(o.pan, 0, 1);
  o.tL = gain * jsMin(2 - 2 * pan, 1); o.tR = gain * jsMin(2 * pan, 1);
}
void HdMiniSynth::controlBlock() {
  bool busy = false; for (auto& o : v) if (o.busy) { busy = true; break; }
  tail = busy ? tailFrames() : (tail - CBLOCK > 0 ? tail - CBLOCK : 0);
  const bool echoing = p[28] > 0.5 && dpeak > 1e-5;
  running = busy || tail > 0 || echoing;
  dpeak = 0;
  update();
  for (auto& o : v) {
    if (!o.busy) continue;
    if (std::fabs(o.amp.lv) < FLUSH) o.amp.lv = 0; if (std::fabs(o.feg.lv) < FLUSH) o.feg.lv = 0; if (std::fabs(o.dc) < FLUSH) o.dc = 0;
    for (int k = 0; k < 4; k++) if (std::fabs(o.s[k]) < FLUSH) o.s[k] = 0;
    o.pitch += c.glide * (o.key - o.pitch);
    o.drift += 0.01 * (rngUniform(rng) - o.drift);
    voiceControl(o);
  }
}
void HdMiniSynth::frames(float* Lo, float* Ro, int at, int n) {
  const int kind = c.kind; const bool distOn = p[25] > 0.5, delayOn = p[28] > 0.5, chorusOn = p[33] > 0.5, phaserOn = p[37] > 0.5;
  float* dlp_ = dl.data(); float* chp = ch.data();
#define TB(x) ((double)T[w + (int)((uint32_t)(x) >> 21)])
  for (int i = 0; i < n; i++) {
    double xl = 0, xr = 0;
    for (int vi = 0; vi < MSV; vi++) {
      MsVoice& o = v[vi];
      if (!o.busy) continue;
      const double amp = envTick(o.amp, c.decA, c.susA);
      envTick(o.feg, c.decF, c.susF);
      const uint32_t dither = rngNext(rng) >> 10; uint32_t* ph = o.ph; const int w = o.wave; const uint32_t a = ph[0], b = ph[1], d = o.ofs[0];
      double sig;
      switch (kind) {
        case 0: sig = 2 * TB(a + dither) - TB(a + d + dither); break;
        case 1: sig = TB(a + dither) + TB(b + dither); break;
        case 2: sig = TB(a + dither) - TB(a + d + dither); break;
        case 3: sig = TB(a + dither) - TB(a + d + dither) + TB(b + dither); break;
        case 4: sig = TB(a + dither) - TB(a + d + dither) + TB(b + dither) - TB(b + d + dither); break;
        case 5: { double s = 0; for (int k = 0; k < 8; k++) s += TB(ph[k] + dither); sig = 0.5 * s; break; }
        case 6: { double s = 0; for (int k = 0; k < 5; k++) s += TB(a + o.ofs[k] + dither); sig = 0.5 * (TB(a + dither) + s); break; }
        case 7: sig = TB(a + dither) + TB(a + d + dither); break;
        default: sig = TB(a + dither) + TB(b + dither) + TB(ph[2] + dither);
      }
      for (int k = 0; k < 8; k++) ph[k] += o.inc[k];
      if (c.noise > 0) sig += rngUniform(rng) * c.noise;
      double y = ladderTick(o, (sig * 0.2 + 0.07) * amp) * 5;
      y -= o.dc; o.dc += 0.005 * y;
      const bool released = o.amp.st == RELEASE, quiet = released && amp < 1e-5;
      o.gL += ((quiet ? 0 : o.tL) - o.gL) * 0.005; xl += y * o.gL;
      o.gR += ((quiet ? 0 : o.tR) - o.gR) * 0.005; xr += y * o.gR;
      if (released && o.gL < 1e-5 && o.gR < 1e-5) { o.busy = false; for (int k = 0; k < 8; k++) ph[k] = rngNext(rng); }
    }
    if (distOn) {
      xl = overdrive(xl, c.drive) * c.driveGain; xr = overdrive(xr, c.drive) * c.driveGain;
      if (c.hold > 1) { if (decN == 0) { decS[0] = xl; decS[1] = xr; } xl = decS[0]; xr = decS[1]; decN = (decN + 1) % c.hold; }
    }
    if (delayOn) {
      const double out = dlp_[(dpos + dlen - c.dframes) % dlen];
      dlp += (c.dfb * out - dlp) * c.dco;
      const double y = dlp;
      dlp_[dpos] = (float)(xl + xr + y); dpos = (dpos + 1) % dlen;
      if (std::fabs(y) > dpeak) dpeak = std::fabs(y);
      xl += y * c.dmix; xr += y * c.dmix;
    }
    if (phaserOn) {
      phS += (c.phT - phS) * 0.001;
      for (int q = 0; q < 2; q++) {
        const double lfo = (q == 0 ? 1 + c.phCos : 1 - c.phCos) * c.phW / 2, f = clamp((50 + 19950 * (phS + lfo)) / sr, 1e-5, 0.499), ac = (1 - f) / (1 + f), x = q == 0 ? xl : xr;
        double wet = x + c.phFb * phOut[q];
        for (int k = q * 6; k < q * 6 + 6; k++) { const double oo = -ac * wet + apIn[k] + ac * apOut[k]; apIn[k] = wet; apOut[k] = oo; wet = oo; }
        phOut[q] = wet;
        if (q == 0) xl = x + wet * c.phMix; else xr = x + wet * c.phMix;
      }
    }
    if (chorusOn) {
      chp[chPos] = (float)(xl + xr);
      const int pos = chPos; const double mL = 0.5 + c.chDepth * std::sin(TAU * chPh0), mR = 0.5 + c.chDepth * std::sin(TAU * chPh1);
      const double delay = chN * (1 - mL * mL * c.chDepth); const int back = (int)std::trunc(delay); const double x0 = chp[(pos + chLen - back) % chLen], x1 = chp[(pos + chLen - back - 1) % chLen];
      const double wetL = x0 + (x1 - x0) * (delay - back), wetR = (1 - mR) * chp[pos] + mR * chp[(pos + chLen - (chN - 1)) % chLen];
      double t = chPh0 + c.chR0 / sr; chPh0 = t - std::trunc(t); t = chPh1 + c.chR1 / sr; chPh1 = t - std::trunc(t);
      chPos = (pos + 1) % chLen;
      xl += wetL * c.chMix; xr += wetR * c.chMix;
    }
    Lo[at + i] = (float)(Lo[at + i] + xl * c.gain); Ro[at + i] = (float)(Ro[at + i] + xr * c.gain);
  }
#undef TB
}
void HdMiniSynth::render(float* Lo, float* Ro, int from, int to) {
  const int total = to - from; const double bpf = bpm / (60 * sr);
  int done = 0;
  while (done < total) {
    if (blockPos == 0) controlBlock();
    const int n = std::min(CBLOCK - blockPos, total - done);
    if (running) frames(Lo, Ro, from + done, n);
    blockPos = (blockPos + n) % CBLOCK; beat += n * bpf; done += n;
  }
}

}  // namespace mdaw
