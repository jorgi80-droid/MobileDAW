// Port of js/engine/hdsaw.js (SuperSaw, Honeydew model). Every expression keeps the JS operation order (golden flm-* compares samples).
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#include "hdsaw.h"
#include "flmsyn.h"
#include <algorithm>
#include <climits>

namespace mdaw {

namespace {
constexpr int TICK = 24, MAXV = 8, MAXU = 12, MAXP = 6, TABLES = 1024, TLEN = 2048, ISHIFT = 21, DSHIFT = 10;
constexpr double INC_FACTOR = 0.99951, PHASE = 4294967296.0, OMEGA = 6.25, SUBSTEPS = 4096, Y1_CLIP = 1e-5, GAIN_SMOOTH = 0.01, DELAY_MAX_S = 2;
constexpr int IDLE = 0, ATTACK = 1, DECAY = 2, RELEASE = 3;
constexpr int M_CUT = 0, M_RES = 1, M_FREQ = 2, M_SYNC = 3, M_PW = 4, M_DET = 5, M_LEVEL = 6, M_PAN = 7, M_LFO_AMT = 8, M_LFO_RATE = 9;
const int WHEEL_TARGETS[9] = {M_CUT, M_RES, M_SYNC, M_PW, M_DET, M_LEVEL, M_PAN, M_LFO_AMT, M_LFO_RATE};
const double ARP_BEATS[6] = {0.125, 0.25, 0.375, 0.5, 0.75, 1}, DELAY_BEATS[5] = {0.25, 0.375, 0.5, 0.75, 1};

double envTime(double x) { double e = std::pow(2.0, x); for (int i = 0; i < 6; i++) e = std::pow(2.0, e - 1); return std::pow(2.0, 5 * e - 5) - 1; }
double sec(double t) { return t > 0.001 ? t : 0; }
double swing(double s, double rate) { return 1 / (std::trunc(s * rate) + 1); }
uint32_t u32(double x) { return x >= PHASE ? 0xffffffffu : x > 0 ? (uint32_t)std::floor(x) : 0u; }
uint32_t cycles(double c) { return u32((c - std::floor(c)) * PHASE); }
uint32_t increment(double f, double sr) { return u32(f / sr * INC_FACTOR * PHASE); }
int tableOf(double f, double sr) { return (int)clamp(std::floor(0.5 * sr / f), 1, TABLES - 1) * TLEN; }

const float* tables() {
  static std::vector<float> set;
  if (!set.empty()) return set.data();
  std::vector<double> sine(TLEN), sum(TLEN, 0.0); set.assign((size_t)TABLES * TLEN, 0.f);
  for (int n = 0; n < TLEN; n++) sine[n] = std::sin(2 * PI * n / TLEN);
  double peak = 0;
  for (int m = 0; m < TABLES; m++) {
    const int h = m + 1, o = m * TLEN;
    for (int n = 0; n < TLEN; n++) { sum[n] += sine[(h * n) % TLEN] / h; const double a = std::fabs(sum[n]); if (a > peak) peak = a; set[o + n] = (float)sum[n]; }
  }
  const float scale = (float)(1 / peak);
  for (auto& x : set) x = (float)((double)x * (double)scale);
  return set.data();
}

uint32_t rngNew(int seed) { return 0x2545f491u ^ (uint32_t)((uint32_t)(seed + 1) * 0x9e3779b9u); }
uint32_t rngNext(uint32_t& s) { uint32_t x = s; x ^= x << 13; x ^= x >> 17; x ^= x << 5; s = x; return x; }
double rngUnit(uint32_t& s) { return (double)(rngNext(s) >> 8) / 16777216.0; }

double envAdvance(HdEnv& e, double attack, double decay, double sustain, double release) {
  if (e.st == ATTACK) { e.lv += attack; if (e.lv >= 1) { e.lv = 1; e.st = DECAY; } }
  else if (e.st == DECAY) e.lv = jsMax(e.lv - decay, sustain);
  else if (e.st == RELEASE) { e.lv -= release; if (e.lv <= 0) { e.lv = 0; e.st = IDLE; } }
  return e.lv;
}
bool envHeld(const HdEnv& e) { return e.st == ATTACK || e.st == DECAY; }

void ladderMatrix(HdLadder& L, double g, double r) {
  const double k = 4 * r; double* P = L.P; double* Q = L.Q; double* T = L.T;
  for (int i = 0; i < 16; i++) P[i] = 0;
  P[0] = 1 - g; P[3] = -g * k; P[4] = g; P[5] = 1 - g; P[9] = g; P[10] = 1 - g; P[14] = g; P[15] = 1 - g;
  Q[0] = g; Q[1] = 0; Q[2] = 0; Q[3] = 0;
  for (int s = 0; s < 12; s++) {
    const double q0 = Q[0], q1 = Q[1], q2 = Q[2], q3 = Q[3];
    for (int i = 0; i < 4; i++) Q[i] += P[i * 4] * q0 + P[i * 4 + 1] * q1 + P[i * 4 + 2] * q2 + P[i * 4 + 3] * q3;
    for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) T[i * 4 + j] = P[i * 4] * P[j] + P[i * 4 + 1] * P[4 + j] + P[i * 4 + 2] * P[8 + j] + P[i * 4 + 3] * P[12 + j];
    for (int i = 0; i < 16; i++) P[i] = T[i];
  }
}
double ladderRun(const HdLadder& L, double* y, double u) {
  const double* P = L.P; const double* Q = L.Q;
  double a = P[0] * y[0] + P[1] * y[1] + P[2] * y[2] + P[3] * y[3] + Q[0] * u;
  const double b = P[4] * y[0] + P[5] * y[1] + P[6] * y[2] + P[7] * y[3] + Q[1] * u;
  const double c = P[8] * y[0] + P[9] * y[1] + P[10] * y[2] + P[11] * y[3] + Q[2] * u;
  const double d = P[12] * y[0] + P[13] * y[1] + P[14] * y[2] + P[15] * y[3] + Q[3] * u;
  a /= 1 + Y1_CLIP * a * a;
  y[0] = a; y[1] = b; y[2] = c; y[3] = d;
  return d;
}
double lfoShape(int shape, double ph, double rnd) { return shape == 0 ? std::sin(2 * PI * ph) : shape == 1 ? 1 - ph : shape == 2 ? (ph < 0.5 ? 1 : 0) : rnd; }
int arpPosition(int mode, int step, int len, double u) {
  if (mode == 1) return step % len;
  if (mode == 2) return len - 1 - step % len;
  if (mode == 3) { const int cyc = std::max(1, 2 * len - 2), i = step % cyc; return i < len ? i : cyc - i; }
  if (mode == 4) { const int i = step % (2 * len); return i < len ? i : 2 * len - 1 - i; }
  return step == 0 ? 0 : (int)jsRound(u * (len - 1));
}
const double RE_ATTACK_MIN = envTime(0.01);
}  // namespace

HdSuperSaw::HdSuperSaw(double rate) : sr(rate > 0 && std::isfinite(rate) ? rate : 44100), T(tables()), rng(rngNew(0)) {
  for (int i = 0; i < MAXV; i++) v[i].rng = rngNew(i + 1);
  for (auto& h : held) h = -1;
  dlen = (int)std::trunc(DELAY_MAX_S * sr) + 1; dl[0].assign(dlen, 0.f); dl[1].assign(dlen, 0.f);
  static const double D[58] = {0, 0, 0, 100, 0, 0, 20, 0, 50, 0, 0, 100, 0.001, 31, 1, 31, 0, 0, 100, 0, 0, 0, 0.001, 31, 1, 31, 0, 0, 0, 11, 0, 0.001, 0, 0,
                               100, 0, 0.001, 31, 1, 0.014, 2, 0, 0, 4, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 3, 40, 50, 0};
  for (int i = 0; i < 58; i++) p[i] = D[i];
  p[28] = 1 / (30 * std::pow(1 - clamp(0, 0, 1), 3) + 0.033333);
  update();
}
void HdSuperSaw::setParam(int i, double x) {
  if (i < 0 || i >= 60 || !std::isfinite(x)) return;
  const bool monoOn = i == 48 && !(p[48] > 0.5) && x > 0.5;
  p[i] = x;
  if (monoOn) for (int k = 1; k < MAXV; k++) { v[k].amp.lv = 0; v[k].amp.st = IDLE; }
}
bool HdSuperSaw::active() { if (heldN > 0 || tail > 0) return true; for (auto& o : v) if (o.amp.st != IDLE) return true; return false; }

void HdSuperSaw::update() {
  const double tr = sr / TICK;
  c.wd = WHEEL_TARGETS[(int)clamp(jsRound(p[42]), 0, 8)]; c.wv = clamp(p[41] / 100, -1, 1) * wheel;
  const double a = 2 * clamp((clamp(p[32] / 100, -1, 1) + 1) / 2 + (c.wd == M_LFO_AMT ? c.wv : 0), 0, 1) - 1, lfoBeats = flmSyncBeats(p[29]), amt = clamp(p[52] / 100, 0, 1);
  c.aA = swing(sec(p[36]), sr); c.aD = swing(sec(p[37]), sr); c.aS = clamp(p[38], 0, 1); c.aR = swing(sec(p[39]), sr);
  c.aRe = swing(jsMax(sec(p[36]), RE_ATTACK_MIN), sr);
  c.fA = swing(sec(p[22]), tr); c.fD = swing(sec(p[23]), tr); c.fS = clamp(p[24], 0, 1); c.fR = swing(sec(p[25]), tr);
  c.sA = swing(sec(p[12]), tr); c.sD = swing(sec(p[13]), tr); c.sS = clamp(p[14], 0, 1); c.sR = swing(sec(p[15]), tr);
  c.shape = (int)clamp(jsRound(p[30]), 0, 3); c.mode = (int)clamp(jsRound(p[27]), 0, 2); c.dest = (int)clamp(jsRound(p[33]), 0, 7);
  double hz = clamp(p[28], 0.001, 100); if (c.wd == M_LFO_RATE && c.wv != 0) hz = 1 / (30 * std::pow(1 - clamp(1 - std::cbrt(jsMax(0, (1 / hz - 0.033333) / 30)) + c.wv, 0, 1), 3) + 0.033333);
  c.amount = a * std::fabs(a); c.step = hz * TICK / sr;
  const double sp = beat / lfoBeats; c.syncPh = sp - std::floor(sp);
  c.fade = swing(sec(p[31]), tr); c.tune = p[44] + bendSt;
  c.drive = amt > 0.005 ? std::pow(10.0, 2 * amt) - 0.99 : 0; c.dnorm = c.drive > 0 ? 1 / std::tanh(c.drive) : 1;
  c.gain = std::pow(10.0, p[53] / 20);
  const double ds = jsMin(DELAY_BEATS[(int)clamp(jsRound(p[54]), 0, 4)] * 60 / bpm, DELAY_MAX_S);
  c.dframes = (int)clamp(std::trunc(ds * sr), 1, dlen - 1);
  c.fb = 0.99 * clamp(p[55] / 100, 0, 1); const double m = clamp(p[57] / 100, 0, 1); c.mix = m * m; c.dfilt = 2 * clamp(p[56] / 100, 0, 1);
}

void HdSuperSaw::start(int key, double vel, double pan) {
  if (key < 1) return;
  update();
  const bool mono = p[48] > 0.5;
  int index = 0;
  if (!mono) {
    const int n = (int)clamp(jsRound(p[43]), 1, MAXV); index = -1;
    for (int i = 0; i < n; i++) if (v[i].amp.st == IDLE) { index = i; break; }
    if (index < 0) { index = 0; for (int i = 1; i < n; i++) if (v[i].age < v[index].age) index = i; }
  }
  const bool keyHeld = key < 128 && held[key] >= 0, others = heldN > (keyHeld ? 1 : 0);
  const double slide = clamp(p[45], 0, 10); const int from = last >= 0 && slide > 0.001 && (!(p[46] > 0.5) || others) ? last : -1;
  const bool flipped = p[17] > 0.5 && last >= 0 && key <= last, supersaw = !(p[1] > 0.5), retrig = p[2] > 0.5;
  const double ph = clamp(p[9] / 100, 0, 1), spread = 0.99 * ph * ph;
  serial++;
  HdVoice& o = v[index]; const bool retrigger = !mono || !envHeld(o.amp);
  o.note = key; o.vel = vel; o.pan = pan; o.age = serial; o.flip = flipped ? -1 : 1;
  if (from >= 0) { const double ticks = slide * sr / TICK; o.pitch = from; o.glide = p[47] > 0.5 ? std::fabs((double)(key - from)) / ticks : 1 / ticks; }
  else { o.pitch = key; o.glide = 0; }
  if (retrigger) {
    if (!retrig && o.amp.st == IDLE) { for (int k = 0; k < MAXU; k++) { o.ph[k] = rngNext(rng); o.sph[k] = rngNext(rng); } }
    else if (retrig && supersaw) { for (int k = 0; k < MAXU; k++) { o.ph[k] = cycles(k * spread); o.sph[k] = o.ph[k]; } }
    o.reAttack = o.amp.lv > 0; o.amp.st = ATTACK;
    o.feg.lv = 0; o.feg.st = ATTACK; o.seg.lv = 0; o.seg.st = ATTACK;
    o.lfoFade = 0; o.lfoPh = c.mode == 0 ? lfoPh : c.mode == 1 ? 0 : c.syncPh;
    o.lfoRnd = rngUnit(o.rng);
  }
  last = key;
  compute(o);
}
void HdSuperSaw::rel(HdVoice& o) { for (HdEnv* e : {&o.amp, &o.feg, &o.seg}) if (e->st != IDLE) e->st = RELEASE; }
void HdSuperSaw::noteOn(int key, double vel) {
  key = (int)clamp(key, 0, 127);
  if (held[key] < 0) heldN++;
  held[key] = vel;
  if (arpMode() == 0) start(key, vel, 0.5);
}
void HdSuperSaw::noteOff(int key) {
  key = (int)clamp(key, 0, 127);
  if (held[key] >= 0) { held[key] = -1; heldN--; }
  if (arpMode() != 0) return;
  if (p[48] > 0.5) {
    HdVoice& o = v[0];
    if (o.note != key || !envHeld(o.amp)) return;
    for (int k = 127; k >= 0; k--) if (held[k] >= 0) { start(k, o.vel, o.pan); return; }
    rel(o); return;
  }
  for (auto& o : v) if (o.note == key && envHeld(o.amp)) rel(o);
}
void HdSuperSaw::allOff() { for (auto& h : held) h = -1; heldN = 0; arpOn = false; arpStepN = 0; arpTimer = 0; releaseAll(); }

double HdSuperSaw::arpStep() {
  const int mode = arpMode();
  if (mode == 0 || heldN == 0) { if (arpOn) { arpOn = false; arpStepN = 0; arpTimer = 0; releaseAll(); } return 1e18; }
  const double len = ARP_BEATS[(int)clamp(jsRound(p[49]), 0, 5)] * 60 / bpm * sr;
  if (!arpOn) { arpOn = true; arpStepN = 0; arpTimer = len; }
  if (arpTimer >= len) {
    arpTimer = std::fmod(arpTimer - len, len);
    const int oct = (int)clamp(jsRound(p[50]), 0, 3) + 1, pos = arpPosition(mode, arpStepN, heldN * oct, rngUnit(rng));
    arpStepN++;
    int nth = pos % heldN, key = -1;
    for (int k = 0; k < 128; k++) if (held[k] >= 0 && nth-- == 0) { key = k; break; }
    if (key >= 0) { const double vel = held[key]; releaseAll(); start(key + 12 * (int)std::floor((double)pos / heldN), vel, 0.5); }
  }
  return jsMax(1, std::ceil(len - arpTimer));
}

void HdSuperSaw::tick() {
  update();
  if (arpMode() == 0) { const double x = lfoPh + c.step; lfoPh = x - std::trunc(x); }
  for (auto& o : v) if (o.amp.st != IDLE) { advance(o); compute(o); }
}
void HdSuperSaw::advance(HdVoice& o) {
  const double n = o.note;
  o.pitch = o.pitch < n ? jsMin(o.pitch + o.glide, n) : jsMax(o.pitch - o.glide, n);
  envAdvance(o.feg, c.fA, c.fD, c.fS, c.fR); envAdvance(o.seg, c.sA, c.sD, c.sS, c.sR);
  const double old = o.lfoPh;
  if (c.mode == 0) { const double x = old + c.step; o.lfoPh = x - std::trunc(x); } else if (c.mode == 1) o.lfoPh = jsMin(old + c.step, 1); else o.lfoPh = c.syncPh;
  if (o.lfoPh < old) o.lfoRnd = rngUnit(o.rng);
  o.lfoFade = jsMin(o.lfoFade + c.fade, 1);
}
void HdSuperSaw::compute(HdVoice& o) {
  const double lfo = o.lfoFade * lfoShape(c.shape, o.lfoPh, o.lfoRnd) * c.amount;
  auto m = [&](int k) { return (c.wd == k ? c.wv : 0.0) + (c.dest == k ? lfo : 0.0); };
  const double f = 440 * std::pow(2.0, (o.pitch - 69 + c.tune + 12 * m(M_FREQ)) / 12);
  double ugain = 1;
  if (p[1] > 0.5) {
    const double a0 = clamp(p[16] / 100, -1, 1), a = a0 * a0 * a0 * o.flip;
    const double s = clamp(clamp(p[10] / 100, 0, 1) + o.seg.lv * a + m(M_SYNC), 0, 1), r = 1 + 5 * s, t = 1 / r;
    const double w = clamp(0.5 * clamp(p[11] / 100, 0, 1) + m(M_PW), 0, 1);
    o.sync = true; o.nu = 1; o.panOn = false; o.pairs = (int)jsMin(std::ceil(r), MAXP);
    for (int j = 0; j < o.pairs; j++) { const double st = j * t; o.starts[j] = cycles(st); o.ends[j] = cycles(jsMin(st + w * t, 1)); }
    o.inc[0] = increment(f, sr); o.tbl[0] = tableOf(f, sr);
  } else {
    const int n = (int)clamp(jsRound(p[5]) + 1, 1, MAXU); const double det = clamp(p[6] / 100, 0, 1), d = clamp(det * det + m(M_DET), 0, 1);
    const double curve = 2 * clamp(p[8] / 100, 0, 1) - 1, e = 1 + curve * (curve >= 0 ? 4 : 0.9), up = clamp(p[7] / 100, 0, 1); const bool spread = n > 1 && up >= 0.001;
    for (int k = 0; k < n; k++) {
      const double x = n == 1 ? 0 : (double)k / (n - 1), ratio = n == 1 ? 1 : std::pow(2.0, d / 12 * (2 * std::pow(x, e) - 1)), fk = f * ratio;
      o.inc[k] = increment(fk, sr); o.tbl[k] = tableOf(fk, sr); o.sinc[k] = increment(0.5 * fk, sr); o.stbl[k] = tableOf(0.5 * fk, sr);
      o.panL[k] = 1; o.panR[k] = 1;
      if (spread) { const double q = (2 * x - 1) * up; if (q >= 0) o.panL[k] = 1 - q; else o.panR[k] = 1 + q; }
    }
    o.sync = false; o.nu = n; o.panOn = spread;
    o.pulseOn = p[0] > 0.5; o.pulse = cycles(0.5 * clamp(clamp(p[3] / 100, 0, 1) + m(M_PW), 0, 1));
    const double sb = clamp(p[4] / 100, 0, 1), sub = sb * sb; o.subLv = sub < 0.001 ? 0 : sub;
    ugain = std::pow(10.0, -(double)n / 20);
  }
  const double cp = clamp(clamp(p[18] / 100, 0, 1) + o.vel * p[21] / 100 + m(M_CUT), 0, 1);
  const double fc = jsMin(std::pow(2.0, 4 + 10.3 * cp + 8 * o.feg.lv * clamp(p[26] / 100, -1, 1) + (o.pitch / 12 - 4) * p[20] / 100), 20000);
  const double g = clamp(OMEGA * fc / (SUBSTEPS * sr), 0, 1), r = clamp(clamp(p[19] / 100, 0, 1) + m(M_RES), 0, 1);
  if (g != o.lad.g || r != o.lad.r) { ladderMatrix(o.lad, g, r); o.lad.g = g; o.lad.r = r; }
  const double lv = clamp(clamp(p[34] / 100, 0, 1) + m(M_LEVEL), 0, 1), gain = lv * lv * ugain * clamp(o.vel, 0, 1);
  const double pan = clamp((clamp(p[35] / 100, -1, 1) + 1) / 2 + (o.pan - 0.5) + m(M_PAN), 0, 1);
  o.tL = gain * jsMin(2 - 2 * pan, 1); o.tR = gain * jsMin(2 * pan, 1);
}
void HdSuperSaw::voice(HdVoice& o, int n) {
  const double attack = o.reAttack ? c.aRe : c.aA;
  for (int i = 0; i < n; i++) {
    const uint32_t dither = rngNext(o.rng) >> DSHIFT;
    double l = 0, r = 0;
    if (o.sync) {
      const uint32_t ph = o.ph[0]; const int t = o.tbl[0];
      for (int j = 0; j < o.pairs; j++) l += (double)T[t + ((uint32_t)(ph + o.starts[j] + dither) >> ISHIFT)] - (double)T[t + ((uint32_t)(ph + o.ends[j] + dither) >> ISHIFT)];
      o.ph[0] = ph + o.inc[0];
    } else {
      for (int k = 0; k < o.nu; k++) {
        const uint32_t ph = o.ph[k];
        double s = T[o.tbl[k] + ((uint32_t)(ph + dither) >> ISHIFT)];
        if (o.pulseOn) s -= T[o.tbl[k] + ((uint32_t)(ph + o.pulse + dither) >> ISHIFT)];
        if (o.subLv > 0) s += o.subLv * T[o.stbl[k] + ((uint32_t)(o.sph[k] + dither) >> ISHIFT)];
        if (o.panOn) { l += s * o.panL[k]; r += s * o.panR[k]; } else l += s;
        o.ph[k] = ph + o.inc[k]; o.sph[k] = o.sph[k] + o.sinc[k];
      }
    }
    double yl, yr;
    if (o.panOn) { yl = ladderRun(o.lad, o.y0, l); yr = ladderRun(o.lad, o.y1, r); }
    else { yl = yr = ladderRun(o.lad, o.y0, l); for (int q = 0; q < 4; q++) o.y1[q] = o.y0[q]; }
    const double e = envAdvance(o.amp, attack, c.aD, c.aS, c.aR), e2 = e * e;
    o.gL += GAIN_SMOOTH * (o.tL - o.gL); o.gR += GAIN_SMOOTH * (o.tR - o.gR);
    mixL[i] += yl * e2 * o.gL; mixR[i] += yr * e2 * o.gR;
  }
}
void HdSuperSaw::effects(float* Lo, float* Ro, int at, int n) {
  const int len = dlen, read = (dpos + len - c.dframes) % len;
  double* M[2] = {mixL, mixR}; float* O[2] = {Lo, Ro};
  for (int ch = 0; ch < 2; ch++) {
    float* line = dl[ch].data(); const double* mx = M[ch]; float* out = O[ch];
    double s = dz[ch];
    for (int i = 0; i < n; i++) {
      double x = mx[i];
      if (c.drive > 0) x = std::tanh(c.drive * x) * c.dnorm;
      x *= c.gain;
      const double d = line[(read + i) % len];
      double tap;
      if (c.dfilt <= 1) { s += (d - s) * c.dfilt; tap = s; } else { const double k = c.dfilt - 1; s += (d - s) * (k * k * k * k); tap = d - s; }
      line[(dpos + i) % len] = (float)((tap + x) * c.fb);
      out[at + i] = (float)((double)out[at + i] + (x + c.mix * tap));
    }
    dz[ch] = s;
  }
  dpos = (dpos + n) % len;
}
void HdSuperSaw::render(float* Lo, float* Ro, int from, int to) {
  const int frames = to - from; const double bpf = bpm / (60 * sr);
  int done = 0; bool sounding = false;
  while (done < frames) {
    const double wait = arpStep();
    if (tickPos == 0) tick();
    const int n = (int)jsMin(jsMin(TICK - tickPos, frames - done), wait);
    for (int i = 0; i < n; i++) { mixL[i] = 0; mixR[i] = 0; }
    for (auto& o : v) if (o.amp.st != IDLE) { voice(o, n); sounding = true; }
    effects(Lo, Ro, from + done, n);
    tickPos = (tickPos + n) % TICK; arpTimer += n; beat += n * bpf; done += n;
  }
  if (sounding) tail = c.mix > 0 ? jsMin(sr * 20, c.dframes * (c.fb > 1e-6 ? std::ceil(std::log(1e-5) / std::log(c.fb)) + 1 : 1)) : 0;
  else tail = jsMax(0, tail - frames);
}

}  // namespace mdaw
