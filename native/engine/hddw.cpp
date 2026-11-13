// DirectWave on Honeydew's DW Sampler model (see hddw.h). C++ only: the JS engine (the fallback) has no DirectWave.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#include "hddw.h"
#include <algorithm>

namespace mdaw {

namespace {
constexpr int TICK = 16, OFF = 0, ATTACK = 1, DECAY = 2, SUSTAIN = 3, RELEASE = 4, KILL = 5;
constexpr int F_OFF = 0, F_LP = 1, F_HP = 2, F_BP = 3;   // MobileDAW's menu order
const double SYNC_BEATS[10] = {0.125, 0.25, 0.5, 0.75, 1, 2, 4, 8, 16, 32};
inline double flush(double x) { return std::fabs(x) < 1e-30 ? 0 : x; }
inline uint32_t xorshift(uint32_t& s) { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
inline double unit(uint32_t& s) { return (double)(xorshift(s) >> 8) / 16777216.0; }
inline double pow4(double x) { const double y = x * x; return y * y; }
// FLM's one-pole envelope law from a 0..100 slider: attack c = 0.0002 / (500 x^4), decay / release 0.0002 / (50 x^4), at most 1
inline double expC(double k, double v) { const double x = clamp(v / 100, 0, 1); return x <= 0 ? 1 : jsMin(0.0002 / (k * pow4(x)), 1); }
struct ExpLaw { double a, d, s, r; };
inline double expAdvance(HdwExpEnv& e, const ExpLaw& l) {
  const double target = e.released ? 0 : e.decaying ? l.s : 4, c = e.released ? l.r : e.decaying ? l.d : l.a;
  e.e = flush(e.e + (target - e.e) * c);
  if (!e.decaying && !e.released && e.e > 1) { e.e = 1; e.decaying = true; }
  return e.e;
}
void tune(HdwFilter& f, int kind, double hz, double res, double sr) {
  if (kind != f.kind) { f.kind = kind; for (auto& ch : f.s) for (auto& x : ch) x = 0; }
  const double g = std::tan(PI * jsMin(hz, 0.49 * sr) / sr);
  if (kind == F_LP) { const double k = 4 * res, big = g / (1 + g); f.c[0] = big; f.c[1] = 1 / (1 + g); f.c[2] = k; f.c[3] = 1 / (1 + k * pow4(big)); }
  else { const double k = 1 / (16 * res * res * res + 0.5), a1 = 1 / (1 + g * (g + k)); f.c[0] = a1; f.c[1] = g * a1; f.c[2] = g * g * a1; f.c[3] = k; }
}
inline double filt(HdwFilter& f, int kind, int ch, double x) {
  double* s = f.s[ch];
  if (kind == F_LP) {
    const double big = f.c[0], beta = f.c[1], k = f.c[2], norm = f.c[3];
    const double tail = beta * (((big * s[0] + s[1]) * big + s[2]) * big + s[3]), est = (pow4(big) * x + tail) * norm;
    double u = k == 0 ? x : x - k * std::tanh(est);
    for (int q = 0; q < 4; q++) { const double v = (u - s[q]) * big; u = v + s[q]; s[q] = flush(u + v); }
    return u;
  }
  if (kind == F_BP || kind == F_HP) {
    const double a1 = f.c[0], a2 = f.c[1], a3 = f.c[2], k = f.c[3], v3 = x - s[1], v1 = a1 * s[0] + a2 * v3, v2 = s[1] + a2 * s[0] + a3 * v3;
    s[0] = flush(2 * v1 - s[0]); s[1] = flush(2 * v2 - s[1]);
    return kind == F_BP ? v1 : x - k * v1 - v2;
  }
  return x;
}
}  // namespace

HdDirectWave::HdDirectWave(double rate, Bank* b) : sr(rate > 0 && std::isfinite(rate) ? rate : 44100), bank(b) {
  // FLM's defaults (Honeydew DEFAULTS) in these units
  static const double D[35] = {0, 0, 0.001, 10.001, 1, 0.002, 0, 2, 0, 1, 0, 0, 100, 0, 0, 0, 0, 0, 100, 1, 100, 0, 0, 100, 1, 100, 0, 0, 0.0333, 0, 0, 0, 0, 0, 0};
  for (int i = 0; i < 35; i++) p[i] = D[i];
}
void HdDirectWave::setParam(int i, double x) {
  if (!std::isfinite(x)) return;
  if (i >= 300) { const int zi = (i - 300) >> 1; if (zi < HDW_ZONES) { if ((i - 300) & 1) z[zi].pan = clamp(x, -1, 1); else z[zi].gain = std::pow(10.0, clamp(x, -60, 12) / 20); } return; }
  if (i >= 100) {
    const int zi = (i - 100) / 8, k = (i - 100) % 8; if (zi >= HDW_ZONES) return; HdwZone& q = z[zi];
    switch (k) { case 0: q.id = toInt32(x); break; case 1: q.root = (int)clamp(toInt32(x), 0, 127); break; case 2: q.lo = (int)clamp(toInt32(x), 0, 127); break; case 3: q.hi = (int)clamp(toInt32(x), 0, 127); break;
      case 4: q.vlo = (int)clamp(toInt32(x), 0, 127); break; case 5: q.vhi = (int)clamp(toInt32(x), 0, 127); break; case 6: q.tune = clamp(x, -100, 100); break; case 7: q.loop = x > 0.5; break; }
    return;
  }
  if (i < 0 || i >= 35) return;
  if (i == 11 && (p[11] > 0.5) != (x > 0.5)) for (auto& v : voices) v.stage = OFF;   // Mono on / off: every voice stops
  p[i] = x;
}
void HdDirectWave::unhold(int key) { for (int k = 0; k < held; k++) if (heldKeys[k] == key) { for (int j = k; j + 1 < held; j++) heldKeys[j] = heldKeys[j + 1]; held--; break; } }
void HdDirectWave::hold(int key) { unhold(key); heldKeys[held++] = (uint8_t)key; last = key; }
void HdDirectWave::release(HdwVoice& v) { if (v.stage >= ATTACK && v.stage <= SUSTAIN) { v.stage = RELEASE; v.fenv.released = true; v.penv.released = true; } }

void HdDirectWave::noteOn(int keyIn, double vel) {
  const int key = (int)clamp(jsRound(keyIn), 0, 127);
  vel = clamp(vel, 0, 1);
  bool others = false; for (int k = 0; k < held; k++) if (heldKeys[k] != key) { others = true; break; }
  const bool legato = p[10] > 0.5, mono = p[11] > 0.5;
  const double from = last >= 0 && (others || !legato) ? last : key;   // Legato off: every note glides from the last; on: only while a key is held
  if (mono) {
    if (others) for (auto& v : voices) if (v.stage >= ATTACK && v.stage <= SUSTAIN) {   // legato hand-over: same zone and position, glides to the key
      v.glide += v.key - key; v.key = key; v.vel = vel; hold(key); return;
    }
    for (auto& v : voices) if (v.stage) v.stage = KILL;
  }
  hold(key);
  const int shifted = key + (int)jsRound(p[0]), step = (int)std::trunc(vel * 127 + 0.5);
  const bool instant = p[2] <= 0.0011, reverse = p[8] > 0.5;
  for (int zi = 0; zi < HDW_ZONES; zi++) {
    const HdwZone& q = z[zi];
    Sample* s = q.id >= 0 && q.id < 256 ? bank->s[q.id] : nullptr;
    if (!s || s->frames < 2 || shifted < q.lo || shifted > q.hi || step < q.vlo || step > q.vhi) continue;
    HdwVoice* v = nullptr; for (auto& o : voices) if (!o.stage) { v = &o; break; }
    if (!v) return;                                                    // no free voice: the note is dropped (as FLM)
    const double random = unit(rng);
    *v = HdwVoice();
    v->stage = instant ? DECAY : ATTACK; v->level = instant ? 1 : 0; v->key = key; v->zone = zi; v->reverse = reverse; v->pos = reverse ? s->frames - 1 : 0;
    v->vel = vel; v->glide = from - key; v->lfo.random = random; v->lfo.level = 1;
    if (mono) break;
  }
}
void HdDirectWave::noteOff(int keyIn) {
  const int key = (int)clamp(jsRound(keyIn), 0, 127);
  unhold(key);
  if (p[11] > 0.5) {
    for (auto& v : voices) if (v.stage >= ATTACK && v.stage <= SUSTAIN && v.key == key) {   // last-note priority: back to the newest key held
      if (held > 0) { const int top = heldKeys[held - 1]; v.glide += v.key - top; v.key = top; } else release(v);
      break;
    }
  } else for (auto& v : voices) if (v.key == key) release(v);
}

void HdDirectWave::render(float* L, float* R, int from, int to) {
  if (to <= from) return;
  // the block's values (Honeydew DwSampler::block)
  const double tA = jsMax(p[2], 0.001), tD = jsMax(p[3], 0.001), tR = jsMax(p[5], 0.001);
  const bool instant = p[2] <= 0.0011;
  const double attack = instant ? 1 : 1 / (tA * sr), decay = 1 / (tD * sr), sustain = clamp(p[4], 0, 1), rel = 1 / (tR * sr), kill = 1 / (0.001 * sr);
  const double glideK = p[6] > 0 ? std::exp(-1 / (p[6] * sr)) : 0;
  const double pitchRatio = std::pow(2.0, (bendSt / 2 * clamp(jsRound(p[7]), 0, 24) + slideSt + jsRound(p[0])) / 12 + clamp(p[1], -100, 100) / 1200);
  const ExpLaw fl{expC(500, p[17]), expC(50, p[18]), clamp(p[19], 0, 1), expC(50, p[20])}, pl{expC(500, p[22]), expC(50, p[23]), clamp(p[24], 0, 1), expC(50, p[25])};
  const double pa = clamp(p[26] / 100, -1, 1), penvOct = 4 * pa * pa * pa, fenvOct = 8 * clamp(p[21] / 100, -1, 1);
  const int fkind = (int)clamp(jsRound(p[16]), 0, 3), lfoShape = (int)clamp(jsRound(p[30]), 0, 3), lfoMode = (int)clamp(jsRound(p[27]), 0, 2), lfoDest = (int)clamp(jsRound(p[33]), 0, 3);
  const double cutoff = clamp(p[12] / 100, 0, 1), res = clamp(p[13] / 100, 0, 1), kbd = clamp(p[14] / 100, 0, 1), velTrk = clamp(p[15] / 100, 0, 1);
  const double amount = clamp(p[32] / 100, -1, 1), lfoDepth = amount * std::fabs(amount), lfoFade = p[31] <= 0.001 ? 1 : 1 / (p[31] * sr), lfoHz = jsMax(0.001, p[28]);
  const double lfoBeats = SYNC_BEATS[(int)clamp(jsRound(p[29]), 0, 9)], level = std::pow(10.0, clamp(p[34], -60, 12) / 20), bpf = bpm / (60 * sr);
  const bool looping = p[9] > 0.5;
  for (auto& v : voices) {
    if (!v.stage) continue;
    const HdwZone& q = z[v.zone];
    Sample* s = q.id >= 0 && q.id < 256 ? bank->s[q.id] : nullptr;
    if (!s || s->frames < 2) { v.stage = OFF; continue; }
    const double rateRatio = s->rate / sr, root = q.root, last = s->frames - 1;
    const bool looped = looping && q.loop && !v.reverse, stereo = s->r && s->r != s->l;
    const float* sl = s->l; const float* sr_ = stereo ? s->r : s->l;
    const double zg = q.gain * level, zpl = q.pan > 0 ? 1 - q.pan : 1, zpr = q.pan < 0 ? 1 + q.pan : 1;
    for (int i = from; i < to; i++) {
      const double fe = expAdvance(v.fenv, fl), pe = expAdvance(v.penv, pl);
      v.glide = flush(v.glide * glideK);
      const double pitch = v.key + v.glide;
      if (v.tick == 0) {                                               // the LFO, every 16 samples (Honeydew Lfo::tick)
        HdwLfo& o = v.lfo;
        o.fade = jsMin(o.fade + TICK * lfoFade, 1);
        const bool song = lfoMode == 2 && playing;
        if (song) { const double b = (beat + i * bpf) / lfoBeats, ph = b - std::floor(b); if (ph < o.phase) o.random = unit(rng); o.phase = ph; }
        const double ph = o.phase, sh = lfoShape == 0 ? std::sin(2 * PI * ph) : lfoShape == 1 ? 1 - 2 * ph : lfoShape == 2 ? (ph >= 0.5 ? 1 : -1) : o.random;
        o.out = sh * lfoDepth * o.fade;
        if (!song) {
          const double hz = lfoMode == 2 ? bpm / 60 / lfoBeats : lfoHz, nx = ph + TICK * hz / sr;
          if (lfoMode == 1) o.phase = jsMin(nx, 1); else if (nx >= 1) { o.random = unit(rng); o.phase = nx - std::floor(nx); } else o.phase = nx;
        }
      }
      if (fkind != F_OFF && (v.tick == 0 || v.filter.kind != fkind)) {
        const double lf = lfoDest == 0 ? v.lfo.out : 0, x = clamp(cutoff + velTrk * v.vel + lf, 0, 1);
        const double hz = jsMin(std::pow(2.0, 4 + 10.4 * x + fe * fenvOct + kbd * (pitch / 12 - 4)), 22000);
        tune(v.filter, fkind, hz, res, sr);
      }
      v.tick = (v.tick + 1) % TICK;
      const double l = v.lfo.out, lt = lfoDest == 2 ? 1 + l : 1, pt = lfoDest == 3 ? l : 0;
      v.lfo.level += (lt - v.lfo.level) * 0.01; v.lfo.pan = flush(v.lfo.pan + (pt - v.lfo.pan) * 0.01);
      // the sample at pos by linear interpolation; in a loop the frame after the last is the first
      const int k = (int)v.pos; const double t = v.pos - k; const int nx = looped && k + 1 >= s->frames ? 0 : k + 1;
      const double a0 = k >= 0 && k < s->frames ? sl[k] : 0, a1 = nx >= 0 && nx < s->frames ? sl[nx] : 0, dl = a0 + t * (a1 - a0);
      double dr = dl; if (stereo) { const double b0 = k >= 0 && k < s->frames ? sr_[k] : 0, b1 = nx >= 0 && nx < s->frames ? sr_[nx] : 0; dr = b0 + t * (b1 - b0); }
      const double wl = filt(v.filter, fkind, 0, dl), wr = stereo ? filt(v.filter, fkind, 1, dr) : wl;
      const double gain = v.level * v.level * v.vel * zg * v.lfo.level;
      L[i] = (float)(L[i] + wl * gain * zpl * jsMin(1 + v.lfo.pan, 1)); R[i] = (float)(R[i] + wr * gain * zpr * jsMin(1 - v.lfo.pan, 1));
      switch (v.stage) {
        case ATTACK: v.level += attack; if (v.level >= 1) { v.level = 1; v.stage = DECAY; } break;
        case DECAY: v.level -= decay; if (v.level <= sustain) { v.level = sustain; v.stage = SUSTAIN; } break;
        case SUSTAIN: v.level = sustain; break;
        case RELEASE: case KILL: v.level -= v.stage == KILL ? kill : rel; if (v.level <= 0) v.stage = OFF; break;
        default: break;
      }
      const double lo = lfoDest == 1 ? l * std::fabs(l) : 0;
      const double oct = ((pitch - root) + q.tune / 100) / 12 + penvOct * pe * pe * pe + lo;
      const double step = rateRatio * std::pow(2.0, oct) * pitchRatio;
      if (v.reverse) v.pos -= step;
      else { v.pos += step; if (looped && v.pos >= s->frames) v.pos = std::fmod(v.pos, (double)s->frames); }
      if (v.pos < 0 || v.pos >= s->frames || (!looped && v.pos > last)) v.stage = OFF;
      if (!v.stage) break;
    }
  }
}

}  // namespace mdaw
