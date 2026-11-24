// Port of js/engine/hdmfx.js (MultiFX bank, Honeydew model). Every expression keeps the JS operation order.
// Copyright (C) 2026 daijro and the Honeydew contributors (original Rust); port (C) MobileDAW contributors. GPL-3.0-or-later.
#include "hdmfx.h"
#include <algorithm>
#include <limits>

namespace mdaw {

namespace {
constexpr double TAU = 2 * PI, SILENT = 1e-4;
constexpr int DIST = 0, FLANGER = 1, PHASER = 2, LPF = 3, HPF = 4, DELAY = 5, REVERB = 6, PANNER = 7, RING = 8, VOX = 9;
const double VOWEL_A[8] = {250, 700, 2500, 3500, 4200, 8500, 10000, 12000}, VOWEL_B[8] = {700, 1250, 2500, 3500, 4200, 8500, 10000, 12000}, VOWEL_C[8] = {250, 2500, 2700, 3500, 4200, 8500, 10000, 12000};
const double DIFF_S[4] = {0.0131, 0.0173, 0.0197, 0.0251}, LATE_L[4] = {0.0441, 0.0633, 0.0781, 0.1039}, LATE_R[4] = {0.0473, 0.0659, 0.0829, 0.1091};
inline double flush(double x) { return std::fabs(x) < 1e-30 ? 0 : x; }
inline double frac(double x) { return x - std::floor(x); }
}  // namespace
double mfxLfo(int shape, double phase, double inc) { return shape == 0 ? std::sin(TAU * phase) : shape == 1 ? 1 - 2 * frac(phase + inc) : phase <= 0.5 ? 1 : -1; }

void MfxFilter::clear() { for (auto& x : z) x = 0; for (auto& x : pre) x = 0; b0 = b1 = a1 = a2 = 0; wet = 0; }
void MfxFilter::set(double frequency, double resonance, double sr, bool highPass) {
  const double angle = jsMin(TAU * frequency / sr, 3), sine = std::sin(angle), cosine = std::cos(angle), b = (1 + (highPass ? cosine : -cosine)) / (2 + sine / resonance);
  b0 = b; b1 = highPass ? -2 * b : 2 * b; a1 = -2 * resonance * cosine / (sine + resonance); a2 = (resonance - sine) / (sine + resonance);
}
void MfxFilter::run(double* io, double target) {
  wet += (target - wet) * 0.005;
  double nx[4];
  for (int ch = 0; ch < 2; ch++) {
    const double x = io[ch];
    for (int st = 0; st < 4; st++) {
      const double s = st == 0 ? x : pre[ch * 3 + st - 1]; const int o = (ch * 4 + st) * 4;
      const double out = flush(b0 * s + b1 * z[o] + b0 * z[o + 1] - a1 * z[o + 2] - a2 * z[o + 3]);
      z[o + 1] = z[o]; z[o] = s; z[o + 3] = z[o + 2]; z[o + 2] = out; nx[st] = out;
    }
    pre[ch * 3] = nx[0]; pre[ch * 3 + 1] = nx[1]; pre[ch * 3 + 2] = nx[2];
    io[ch] = x + wet * (nx[3] - x);
  }
}
void MfxFlanger::init(double sr) { span = jsMax(4, std::trunc(sr * 0.005)); s.assign((size_t)span + 3, 0.f); cur = 0; speed = tspeed = fb = wet = 0; }
void MfxFlanger::clear() { std::fill(s.begin(), s.end(), 0.f); cur = 0; speed = 0; wet = 0; }
void MfxFlanger::set(double x, double y, double lfo) { const double q = (1 - x) - 0.5 * lfo, q2 = q * q, d = jsMin(q2 * q2, 1); tspeed = 1 / (2 + (span - 2) * d); fb = -0.96 * y; if (speed == 0) speed = tspeed; }
void MfxFlanger::run(double* io, double target) {
  wet += (target - wet) * 0.005;
  speed = clamp(speed + 0.001 * (tspeed - speed), 1 / span, 0.9);
  const int len = (int)s.size(); const double p0 = cur - 1 / speed, pos = p0 - std::floor(p0 / len) * len; const int idx = (int)std::trunc(pos) % len;
  const double y = s[idx] + ((double)s[(idx + 1) % len] - s[idx]) * (pos - std::trunc(pos));
  s[cur] = (float)flush(-0.5 * wet * (io[0] + io[1]) + fb * y);
  cur = (cur + 1) % len;
  io[0] += y; io[1] += y;
}
void MfxPanner::init(double sr) { const int n = (int)jsMax(4, std::trunc(sr * 0.002)); s[0].assign(n, 0.f); s[1].assign(n, 0.f); clear(); }
void MfxPanner::clear() { std::fill(s[0].begin(), s[0].end(), 0.f); std::fill(s[1].begin(), s[1].end(), 0.f); cur = 0; wet = 0; pan = -1; dist = -1; tpan = 0.5; tdist = 0; }
void MfxPanner::set(double x, double y, double lfo) { tpan = clamp(x + lfo, 0, 1); tdist = std::sqrt(y); if (pan < 0) pan = tpan; if (dist < 0) dist = tdist; }
void MfxPanner::run(double* io, double target) {
  wet += (target - wet) * 0.005; pan += (tpan - pan) * 0.005; dist += (tdist - dist) * 0.005;
  const int len = (int)s[0].size();
  for (int ch = 0; ch < 2; ch++) {
    const double far = ch == 0 ? jsMax(2 * pan - 1, 0) : jsMax(1 - 2 * pan, 0), x = io[ch]; std::vector<float>& b = s[ch];
    b[cur] = (float)x;
    const double p0 = cur - (1 + far * (len - 4)), pos = p0 - std::floor(p0 / len) * len; const int idx = (int)std::trunc(pos) % len;
    const double delayed = b[idx] + ((double)b[(idx + 1) % len] - b[idx]) * (pos - std::trunc(pos));
    io[ch] = x * (1 - wet) + delayed * (1 - dist * far) * wet;
  }
  cur = (cur + 1) % len;
}
void MfxPhaser::clear() { for (auto& x : st) x = 0; fbk[0] = fbk[1] = 0; wet = og = co = fg = 0; }
void MfxPhaser::set(double x, double y, double lfo, double sr) { const double nrm = clamp(((x * x + x * x * lfo) * 19950 + 50) / sr, 0.001, 0.499); co = (1 - nrm) / (1 + nrm); fg = 0.98 * std::cbrt(0.6 * y); }
void MfxPhaser::run(double* io, double target) {
  wet += (target - wet) * 0.005; og += (1 - og) * 0.005;
  for (int ch = 0; ch < 2; ch++) {
    double s = io[ch] * wet + fbk[ch] * fg;
    for (int k = ch * 6; k < ch * 6 + 6; k++) { const double nx = st[k] - co * s; st[k] = flush(s + co * nx); s = nx; }
    fbk[ch] = flush(s);
    io[ch] += s * og;
  }
}
void MfxVowel::clear() { for (auto& x : z) x = 0; for (int b = 0; b < 8; b++) b0[b] = a1[b] = a2[b] = 0; wet = og = sg = 0; }
void MfxVowel::set(double x, double y, double lfo, double sr) {
  const double position = clamp(x + lfo, 0, 1) * 3; const int segment = position >= 3 ? 0 : (int)std::trunc(position); const double fr = position - std::trunc(position), scale = std::pow(2.0, 1.7 * y - 0.85);
  sg = 1 - segment * 0.125;
  for (int b = 0; b < 8; b++) {
    const double f = (segment == 0 ? VOWEL_A[b] * (1 - fr) + VOWEL_B[b] * fr : segment == 1 ? VOWEL_B[b] * (1 - fr) + VOWEL_C[b] * fr : VOWEL_C[b] * (1 - fr) + VOWEL_A[b] * fr) * scale;
    const double angle = jsMin(TAU * f / sr, 3.1), sine = std::sin(angle), cosine = std::cos(angle), alpha = sine / 24, den = 1 + alpha;
    b0[b] = 0.5 * sine / den; a1[b] = 2 * cosine / den; a2[b] = (1 - alpha) / den;
  }
}
void MfxVowel::run(double* io, double target) {
  wet += (target - wet) * 0.005; og += (1 - og) * 0.005;
  const double mix = wet * og;
  for (int ch = 0; ch < 2; ch++) {
    const double x = io[ch]; double sum = 0;
    for (int b = 0; b < 8; b++) {
      const int o = (ch * 8 + b) * 4; const double out = flush(b0[b] * (x - z[o + 1]) + a1[b] * z[o + 2] - a2[b] * z[o + 3]);
      z[o + 1] = z[o]; z[o] = x; z[o + 3] = z[o + 2]; z[o + 2] = out; sum += out;
    }
    io[ch] = x * (1 - mix) + sum * sg * mix;
  }
}
void MfxCrusher::clear() { h[0] = h[1] = 0; count = 0; hold = 0; gain = 0; knee = 0; }
void MfxCrusher::set(double x, double y, double lfo) { const double y2 = y * y; hold = (int)std::trunc(jsMin(y2 * y2, 1) * 256) + 1; gain = 0.1 - 0.09 * y; knee = std::pow(10.0, 4 * (x + lfo) + 1); }
void MfxCrusher::run(double* io) {
  if (count == 0) { const double g = gain, k = knee; h[0] = io[0] * g * (k + 1) / (1 + k * std::fabs(io[0])); h[1] = io[1] * g * (k + 1) / (1 + k * std::fabs(io[1])); }
  count++; if (count >= hold) count = 0;
  io[0] = h[0]; io[1] = h[1];
}
void MfxRing::clear() { phase = step = wet = og = 0; }
void MfxRing::set(double x, double lfo, double sr) { step = std::pow(2.0, 5 + 8.7 * clamp(x + 0.5 * lfo, 0, 1)) / sr; }
void MfxRing::run(double* io, double target) {
  wet += (target - wet) * 0.005; og += (1 - og) * 0.005;
  const double mix = wet * og, carrier = std::sin(TAU * phase), t = phase + step;
  phase = t - std::trunc(t);
  io[0] = io[0] * (1 - mix) + mix * io[0] * carrier; io[1] = io[1] * (1 - mix) + mix * io[1] * carrier;
}
void MfxDelay::init(double rate) { sr = rate; cap = (int)jsMax(4, std::trunc(sr * 1.5)); ring[0].assign(cap, 0.f); ring[1].assign(cap, 0.f); cur = 0; dly = 1; x = y = 0.5; wet = 0; f1[0] = f1[1] = f2[0] = f2[1] = 0; la = 0; ls = 0; lph = linc = 0; }
void MfxDelay::resetAudio() { std::fill(ring[0].begin(), ring[0].end(), 0.f); std::fill(ring[1].begin(), ring[1].end(), 0.f); cur = 0; f1[0] = f1[1] = f2[0] = f2[1] = 0; }
void MfxDelay::clear() { resetAudio(); wet = 0; }
void MfxDelay::configure(double xi, double yi, double rateBeats, double amount, int shape, double bpm, double startBeat) {
  x = clamp(xi, 0, 1); y = clamp(yi, 0, 1); la = clamp(amount, -1, 1); ls = std::min(shape, 2);
  if (rateBeats > 0 && bpm > 0) {
    const double rate = 2 * rateBeats; double nt = rate * 60 / bpm / 3;
    while (nt > 1) nt *= 0.5;
    const int d = (int)clamp(std::trunc((cap - 1) * nt), 1, cap - 1);
    if (d != dly) { dly = d; resetAudio(); }
    linc = bpm / (60 * sr * rate);
    if (startBeat >= 0) lph = frac(startBeat / rate);
  }
}
void MfxDelay::run(double* io, double target) {
  wet = flush(wet + 0.005 * (clamp(target, 0, 1) - wet));
  const double lfo = la * mfxLfo(ls, lph, linc);
  lph = frac(lph + linc);
  const int ri = (cur + cap - dly) % cap; const double gain = x * x, c1 = y <= 0.5 ? 0.01 + 1.98 * y : 1, c2 = y <= 0.5 ? 0 : 0.9 * y - 0.45;
  for (int ch = 0; ch < 2; ch++) {
    const double smp = ring[ch][ri], pf = f1[ch];
    f1[ch] = flush(pf + c1 * (gain * smp - pf));
    f2[ch] = flush(f2[ch] + c2 * (pf - f2[ch]));
    const double w = pf - f2[ch];
    ring[ch][cur] = (float)flush(io[ch] * wet + w);
    io[ch] += (ch == 0 ? 1 + lfo : 1 - lfo) * w;
  }
  cur = (cur + 1) % cap;
}
void MfxLine::init(int maxFrames) { s.assign(std::max(4, maxFrames) + 4, 0.f); cur = 0; }
double MfxLine::read(double frames) const { const int len = (int)s.size(); const double p0 = cur - clamp(frames, 1, len - 2), pos = p0 - std::floor(p0 / len) * len; const int idx = (int)std::trunc(pos) % len; return s[idx] + ((double)s[(idx + 1) % len] - s[idx]) * (pos - std::trunc(pos)); }
void MfxLine::push(double x) { s[cur] = (float)flush(x); cur = (cur + 1) % (int)s.size(); }
void MfxLine::clear() { std::fill(s.begin(), s.end(), 0.f); cur = 0; }
void MfxReverb::init(double rate) {
  sr = rate; wet = 0; decay = 1; late = lateT = 0; damp = 1; hp = prev = 0;
  for (int i = 0; i < 4; i++) { difFr[i] = jsMax(1, jsRound(DIFF_S[i] * sr)); dif[i].init((int)difFr[i] + 2); difG[i] = i % 2 == 0 ? 0.7 : -0.7; }
  for (int i = 0; i < 4; i++) { lFr[i] = jsMax(1, jsRound(LATE_L[i] * sr)); L[i].init((int)lFr[i] + 4); rFr[i] = jsMax(1, jsRound(LATE_R[i] * sr)); R[i].init((int)rFr[i] + 4); lDamp[i] = rDamp[i] = 0; }
  hpk = std::exp(-TAU * 317 / sr);
  refresh(0.5, 0.5); late = lateT;
}
void MfxReverb::refresh(double x, double y) {
  x = clamp(x, 0, 1); y = clamp(y, 0, 1);
  const double x3 = x * x * x;
  decay = 0.1 * std::floor(1 + 199 * (0.75 * x3) + 0.5);
  lateT = 0.3 * std::pow(10.0, std::floor(-361 + 421 * (0.5 + 0.15 * x3) + 0.5) * 0.005);
  const double fc = std::floor(5 + 216 * y * y + 0.5);
  damp = fc >= 221 ? 1 : 1 - std::exp(-TAU * 100 * fc / sr);
}
double MfxReverb::branch(bool left, const double* taps, const double* opp, double input) {
  const double t0 = taps[0], t1 = taps[1], t2 = taps[2], t3 = taps[3];
  MfxLine* lines = left ? L : R; double* fr = left ? lFr : rFr; double* dp = left ? lDamp : rDamp;
  for (int i = 0; i < 4; i++) {
    const double tr_ = i == 0 ? (t0 + t1 + t2 + t3) * 0.5 : i == 1 ? (t0 - t1 + t2 - t3) * 0.5 : i == 2 ? (t0 + t1 - t2 - t3) * 0.5 : (t0 - t1 - t2 + t3) * 0.5;
    const double fb = std::pow(10.0, -3 * (fr[i] / sr) / decay);
    dp[i] = flush(dp[i] + damp * (tr_ + 0.08 * opp[i] - dp[i]));
    lines[i].push(input * 0.25 + fb * dp[i]);
  }
  return (t0 + t1 - t2 + t3) * 0.5;
}
void MfxReverb::run(double* io, double target) {
  wet = flush(wet + ((target > 0.5 ? 1 : 0) - wet) * 0.005);
  late += 0.001 * (lateT - late);
  const double input = 0.5 * (io[0] + io[1]) * wet;
  hp = flush(hpk * (hp + input - prev)); prev = input;
  double d = hp;
  for (int i = 0; i < 4; i++) { const double dl = dif[i].read(difFr[i]), out = dl - difG[i] * d; dif[i].push(d + difG[i] * out); d = out; }
  for (int i = 0; i < 4; i++) { tl[i] = L[i].read(lFr[i]); tr[i] = R[i].read(rFr[i]); }
  const double ll = branch(true, tl, tr, d), lr = branch(false, tr, tl, d);
  io[0] += late * ll; io[1] += late * lr;
}
void MfxReverb::clear() { wet = 0; hp = 0; prev = 0; for (auto& s : dif) s.clear(); for (int i = 0; i < 4; i++) { L[i].clear(); R[i].clear(); lDamp[i] = rDamp[i] = 0; } }

MfxBank::MfxBank(double rate) : sr(jsMax(1, rate)) {
  flanger.init(sr); delay.init(sr); reverb.init(sr); panner.init(sr);
  const double q = std::trunc(0.25 * sr), s = std::trunc(sr), inf = std::numeric_limits<double>::infinity();
  const double sk[10] = {0, q, q, s, s, inf, inf, s, q, q}, tl[10] = {0, 0, 0, 0, 0, std::trunc(1.5 * sr), q, 0, 0, 0};
  for (int k = 0; k < 10; k++) { skip[k] = sk[k]; tail[k] = tl[k]; }
}
void MfxBank::prepare(double x0, double y, double rateBeats, double amount, int shape, double tempo, double startBeat, int frames) {
  bpm = tempo;
  const double phase = startBeat >= 0 ? frac(startBeat / rateBeats) : lph, step = bpm >= 1 ? frames * bpm / (sr * 60 * rateBeats) : 0;
  lph = frac(phase + step);
  const double lfo = amount * mfxLfo(shape, phase, step), x = clamp(x0 + lfo, 0, 1), res = 1 + 2 * y * y;
  delay.configure(x0, y, rateBeats, amount, shape, bpm, startBeat);
  reverb.refresh(x0, y);
  lpf.set(std::pow(2.0, 6 + 8.28 * x), res, sr, false); hpf.set(std::pow(2.0, 5 + 7.424 * x), res, sr, true);
  crusher.set(x0, y, lfo); phaser.set(x0, y, lfo, sr); flanger.set(x0, y, lfo); panner.set(x0, y, lfo); ring.set(x0, lfo, sr); vowel.set(x0, y, lfo, sr);
}
double& MfxBank::wetOf(int k) { switch (k) { case FLANGER: return flanger.wet; case PHASER: return phaser.wet; case LPF: return lpf.wet; case HPF: return hpf.wet; case DELAY: return delay.wet; case REVERB: return reverb.wet; case PANNER: return panner.wet; case RING: return ring.wet; default: return vowel.wet; } }
void MfxBank::runK(int k, double* io, double t) { switch (k) { case FLANGER: flanger.run(io, t); break; case PHASER: phaser.run(io, t); break; case LPF: lpf.run(io, t); break; case HPF: hpf.run(io, t); break; case DELAY: delay.run(io, t); break; case REVERB: reverb.run(io, t); break; case PANNER: panner.run(io, t); break; case RING: ring.run(io, t); break; default: vowel.run(io, t); } }
void MfxBank::clearK(int k) { switch (k) { case FLANGER: flanger.clear(); break; case PHASER: phaser.clear(); break; case LPF: lpf.clear(); break; case HPF: hpf.clear(); break; case DELAY: delay.clear(); break; case REVERB: reverb.clear(); break; case PANNER: panner.clear(); break; case RING: ring.clear(); break; default: vowel.clear(); } }
void MfxBank::frame(double* io, int sel) {
  if (bpm < 1) return;
  if (sel == DIST) crusher.run(io);
  for (int k = 1; k < 10; k++) {
    const bool on = sel == k;
    if (!on && !run[k]) continue;
    run[k] = true;
    const double il = io[0], ir = io[1], target = on ? 1 : 0;
    idle[k] = std::fabs(il) > SILENT || std::fabs(ir) > SILENT ? 0 : idle[k] + 1;
    if (idle[k] > skip[k]) wetOf(k) = target; else runK(k, io, target);
    quiet[k] = std::fabs(io[0] - il) > SILENT || std::fabs(io[1] - ir) > SILENT ? 0 : quiet[k] + 1;
    if (!on && wetOf(k) < SILENT && quiet[k] >= tail[k]) { clearK(k); run[k] = false; idle[k] = 0; quiet[k] = 0; }
  }
}
bool MfxBank::busy() const { const double q = tail[REVERB]; for (int k = 1; k < 10; k++) if (run[k] && (idle[k] <= jsMin(skip[k], skip[LPF]) || quiet[k] < jsMax(tail[k], q))) return true; return false; }
void MfxBank::reset() { crusher.clear(); for (int k = 1; k < 10; k++) { clearK(k); run[k] = false; idle[k] = 0; quiet[k] = 0; } }

}  // namespace mdaw
