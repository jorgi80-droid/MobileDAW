// Port of js/engine/flmsyn.js render paths (MiniSynth 32, SuperSaw 33). GMS 31 / DirectWave 30 are added later.
#include "flmsyn.h"
#include <algorithm>

namespace mdaw {

// ================================================================================================ MiniSynth (32)
FlmMiniSynth::FlmMiniSynth(double sr_) : FlmVoices<MiniFlmVoice, 8>(sr_), bufL(4096, 0), bufR(4096, 0), dl(sr_, 4), ch(sr_), phs(sr_) {
  static const double D[44] = {0, 0, 0, 0, 100, 0, 0, 0, 0.001, 1, 1, 1, 0, 0, 6, 0, 0, 0, 0, 0.001, 1, 1, 0.08, 0, 0.05,
                               0, 0, 0, 0, 40, 30, 25, 6, 0, 30, 40, 40, 0, 40, 60, 40, 30, 50, 0};
  for (int i = 0; i < 44; i++) setParam(i, D[i]);
}
void FlmMiniSynth::setParam(int i, double x) {
  if (i < 0 || i >= 48) return; p[i] = x;
  if (i >= 8 && i <= 11) fp = adsrParams(p[8], p[9], p[10], p[11], sr);
  if (i >= 19 && i <= 22) ap = adsrParams(p[19], p[20], p[21], p[22], sr);
  if (i == 23) { int m = (int)jsRound(x); mono = m > 0; legato = m == 2; allOff(); }
  if (i == 24) slide = x;
}
void FlmMiniSynth::start(MiniFlmVoice& v, bool retrig) {
  if (!retrig) { v.lp = 0; v.lt = 0; v.s1.reset(); v.s2.reset(); v.fenv.v = 0; for (int k = 0; k < 8; k++) v.ph[k] = (double)(lcg(rng) >> 8) / 16777216.0; }
  v.env.start(); v.fenv.start();
}
void FlmMiniSynth::render(float* L, float* R, int from, int to) {
  int kind = (int)clamp(jsRound(p[0]), 0, 9); double mod = p[1] / 100, noise = p[2] / 100 * 0.5, res = p[7] / 100;
  int ld0 = (int)jsRound(p[16]); double lhz = bpm / 60 / flmSyncBeats(p[14]); int lsh = (int)jsRound(p[15]); double lamt = p[13] / 100; int ldst = ld0 == 3 ? (int)jsRound(p[18]) : ld0;
  float* B = bufL.data(); float* Bq = bufR.data(); int n0 = to - from;
  if (n0 > (int)bufL.size()) { render(L, R, from, from + (int)bufL.size()); render(L, R, from + (int)bufL.size(), to); return; }
  clock += n0; std::fill(B, B + n0, 0.f); std::fill(Bq, Bq + n0, 0.f);
  for (auto& v : this->v) {
    if (!v.on) continue;
    for (int i = 0; i < n0; i += FLM_CR) {
      int e2 = (int)jsMin(n0, i + FLM_CR), n = e2 - i;
      lfoAdvance(v, n, lhz, sr); double lf = lfoValue(v, lsh, false, 0, rng) * lamt;
      if (v.gl < 1) v.f += (v.ft - v.f) * (1 - std::pow(1 - v.gl, (double)n)); else v.f = v.ft;
      double m = clamp(mod + (ldst == 2 ? lf * 0.5 : 0), 0, 1);
      double f0 = v.f * std::pow(2.0, (p[3] + bendSt + (ldst == 1 ? lf * 2 : 0)) / 12), dt = f0 / sr;
      double oct = (double)(v.pitch - 60) / 12 * p[5] / 100 + (v.vel - 1) * 4 * p[6] / 100 + v.fenv.v * p[12] / 100 * 6 + (ldst == 0 ? lf * 4 : 0);
      double fc = cutHz(p[4]) * std::pow(2.0, oct); v.s1.set(sr, fc, res); v.s2.copyCoef(v.s1);
      double r2 = std::pow(2.0, miniSt(m) / 12), pw = miniPw(m); double* ph = v.ph;
      double det = kind == 5 ? m * 0.5 : kind >= 8 ? m * 0.25 : 0; int iv = kind == 8 ? 12 : kind == 9 ? 7 : 0;
      double d2 = dt * (kind == 1 || kind == 3 || kind == 4 ? r2 : kind >= 8 ? std::pow(2.0, (iv + det) / 12) : 1);
      for (int k = i; k < e2; k++) {
        double e = v.env.next(ap); v.fenv.next(fp);
        if (v.env.st == 0) { v.on = false; break; }
        double a = ph[0] + dt; if (a >= 1) a -= 1; ph[0] = a;
        double l, r;
        if (kind == 5) {
          l = 0; r = 0;
          for (int u = 0; u < 8; u++) { double du = dt * std::pow(2.0, SS_OFF()[u] * det / 12); double q = (u ? ph[u] : a); if (u) { q += du; if (q >= 1) q -= 1; ph[u] = q; } double xx = flmSaw(q, du) * 0.42; l += xx * (1 - SS_PAN()[u]); r += xx * (1 + SS_PAN()[u]); }
        } else {
          double b = ph[1] + d2; if (b >= 1) b -= 1; ph[1] = b;
          double xx;
          switch (kind) {
            case 0: xx = 0.6 * flmSaw(a, dt) + 0.4 * flmPulseZ(a, dt, pw); break;
            case 1: xx = 0.55 * (flmSaw(a, dt) + flmSaw(b, d2)); break;
            case 2: { double c = a + m; if (c >= 1) c -= 1; xx = 0.5 * (flmPulse(a, dt, 0.5) - flmPulse(c, dt, 0.5)); break; }
            case 3: xx = 0.5 * flmPulse(a, dt, 0.5) + 0.5 * flmSaw(b, d2); break;
            case 4: xx = 0.5 * (flmPulse(a, dt, 0.5) + flmPulse(b, d2, 0.5)); break;
            case 6: xx = 0.7 * flmSaw(a, dt) + m * 0.6 * std::sin(TWO_PI * a * 3) * std::sin(TWO_PI * a); break;
            case 7: { double c = a + 0.15 + m * 0.35; if (c >= 1) c -= 1; xx = 0.55 * (flmSaw(a, dt) + flmSaw(c, dt)); break; }
            default: xx = 0.55 * (flmSaw(a, dt) + flmSaw(b, d2)); break;
          }
          l = r = xx;
        }
        if (noise > 0) { double nz = ((double)lcg(rng) / 2147483648.0 - 1) * noise; l += nz; r += nz; }
        double g = e * v.vel * 0.19;
        B[k] = (float)((double)B[k] + v.s1.run(l, 0) * g); Bq[k] = (float)((double)Bq[k] + v.s2.run(r, 0) * g);
      }
      if (!v.on) break;
    }
  }
  tailOf(this, n0);
  if (p[25] > 0.5) {
    double drive = 1 + p[26] / 100 * 20, nrm = 1 / std::tanh(drive);
    if (p[26] > 0) for (int k = 0; k < n0; k++) { B[k] = (float)(std::tanh(B[k] * drive) * nrm); Bq[k] = (float)(std::tanh(Bq[k] * drive) * nrm); }
    decimate(dec, B, Bq, 0, n0, p[27] / 100);
  }
  if (p[28] > 0.5) dl.run(B, Bq, 0, n0, sr * 60 / bpm * flmSyncBeats(p[32]), p[29] / 100 * 0.9, p[30] / 100, p[31] / 100);
  if (p[33] > 0.5) ch.run(B, Bq, 0, n0, 0.1 + p[34] / 100 * 4, 0.007, 0.012 * p[35] / 100, 0, p[36] / 100);
  if (p[37] > 0.5) phs.run(B, Bq, 0, n0, bpm / 60 / miniPhaserBeats(p[38]), 80 + p[41] / 100 * 1500, p[39] / 100, p[40] / 100 * 0.85, p[42] / 100);
  double lvl = flmDbg(p[43]);
  for (int k = 0; k < n0; k++) { L[from + k] = (float)((double)L[from + k] + (double)B[k] * lvl); R[from + k] = (float)((double)R[from + k] + (double)Bq[k] * lvl); }
}

// ================================================================================================ SuperSaw (33)
FlmSuperSaw::FlmSuperSaw(double sr_) : FlmVoices<SawFlmVoice, 16>(sr_), bufL(4096, 0), bufR(4096, 0), dl(sr_, 4) {
  polySlide = true;
  static const double D[59] = {0, 0, 0, 100, 0, 0, 20, 0, 50, 0, 0, 50, 0.001, 0.5, 0, 0.3, 0, 0, 100, 0, 0, 0, 0.001, 0.5, 1, 0.3, 0, 0, 0.03, 9, 0, 0, 0, 0,
                               100, 0, 0.001, 0.5, 1, 0.3, 2, 0, 0, 5, 0, 0.05, 0, 1, 0, 9, 2, 0, 0, 0, 6, 40, 50, 0};
  for (int i = 0; i < 59; i++) setParam(i, D[i]);
}
void FlmSuperSaw::setParam(int i, double x) {
  if (i < 0 || i >= 60) return; p[i] = x;
  if (i >= 12 && i <= 15) sp = adsrParams(p[12], p[13], p[14], p[15], sr);
  if (i >= 22 && i <= 25) fp = adsrParams(p[22], p[23], p[24], p[25], sr);
  if (i >= 36 && i <= 39) ap = adsrParams(p[36], p[37], p[38], p[39], sr);
  if (i == 40) pb = x; if (i == 43) max = (int)clamp(jsRound(x), 1, 16); if (i == 45) slide = x; if (i == 46) legato = x > 0.5;
  if (i == 47) constSlide = x > 0.5; if (i == 48) { mono = x > 0.5; allOff(); }
  if (i == 51) { allOff(); arp.nheld = 0; arp.note = -1; arp.step = 0; arp.pos = 0; }
}
void FlmSuperSaw::start(SawFlmVoice& v, bool retrig) {
  if (!retrig) {
    bool rt = p[2] > 0.5; double ph = p[9] / 100;
    for (int k = 0; k < 9; k++) { double r = (double)(lcg(rng) >> 8) / 16777216.0; if (rt) { v.ph[k] = std::fmod(k * 0.618, 1.0) * ph; v.sp[k] = 0; } else { v.ph[k] = r; v.sp[k] = r; } }
    v.lp = 0; v.lt = 0; v.s1.reset(); v.s2.reset(); v.fenv.v = 0; v.senv.v = 0;
    if ((int)jsRound(p[27]) == 2 && playing) { double b = (beat0 + blk * bpm / 60 / sr) / flmSyncBeats(p[29]); v.lp = b - std::floor(b); }
    v.dir = p[17] > 0.5 && v.pitch < lastPitch ? -1 : 1; lastPitch = v.pitch;
  }
  v.env.start(); v.fenv.start(); v.senv.start();
}
void FlmSuperSaw::noteOn(int pt, double vel) {
  if ((int)jsRound(p[51]) > 0) { for (int i = 0; i < arp.nheld; i++) if (arp.held[i].p == pt) return; if (arp.nheld < 16) { arp.held[arp.nheld].p = pt; arp.held[arp.nheld].vel = vel; arp.nheld++; } return; }
  FlmVoices::noteOn(pt, vel);
}
void FlmSuperSaw::noteOff(int pt) {
  if ((int)jsRound(p[51]) > 0) { int w = 0; for (int i = 0; i < arp.nheld; i++) if (arp.held[i].p != pt) arp.held[w++] = arp.held[i]; arp.nheld = w; if (!arp.nheld && arp.note >= 0) { FlmVoices::noteOff(arp.note); arp.note = -1; } return; }
  FlmVoices::noteOff(pt);
}
void FlmSuperSaw::render(float* L, float* R, int from, int to) {
  int mode = (int)jsRound(p[51]);
  clock += to - from;
  if (!mode) { renderVoices(L, R, from, to); blk = to; return; }
  double step = sr * 60 / bpm * flmSyncBeats(p[49]); int cur = from, guard = 0;
  while (cur < to && guard++ < 64) {
    if (arp.nheld && arp.pos <= 0) {
      if (arp.note >= 0) FlmVoices::noteOff(arp.note);
      int np; double nv; bool got = arp.next(mode, (int)clamp(jsRound(p[50]) + 1, 1, 4), rng, np, nv);
      blk = cur;
      if (got) { arp.note = np; FlmVoices::noteOn(np, nv); }
      arp.pos = step;
    }
    int seg = arp.nheld ? (int)jsMin(to - cur, jsMax(1, std::ceil(arp.pos))) : to - cur;
    renderVoices(L, R, cur, cur + seg); cur += seg; if (arp.nheld) arp.pos -= seg; else arp.pos = 0;
  }
  blk = to;
}
void FlmSuperSaw::renderVoices(float* L, float* R, int from, int to) {
  float* B = bufL.data(); float* Bq = bufR.data(); int n0 = to - from;
  if (n0 <= 0) return;
  if (n0 > (int)bufL.size()) { renderVoices(L, R, from, from + (int)bufL.size()); renderVoices(L, R, from + (int)bufL.size(), to); return; }
  std::fill(B, B + n0, 0.f); std::fill(Bq, Bq + n0, 0.f);
  bool pulseM = p[0] > 0.5, sync = (int)jsRound(p[1]) == 1; int nu = (int)clamp(jsRound(p[5]) + 1, 1, 9); double sub = p[4] / 100, res0 = p[19] / 100;
  int lmode = (int)jsRound(p[27]); double lhz = lmode == 2 ? bpm / 60 / flmSyncBeats(p[29]) : p[28]; int lsh = (int)jsRound(p[30]); double lamt = p[32] / 100; int ld = (int)jsRound(p[33]);
  double spreadExp = std::pow(2.0, (0.5 - p[8] / 100) * 2.5), upan = p[7] / 100;
  for (int u = 0; u < nu; u++) { double x = nu == 1 ? 0 : (double)u / (nu - 1) * 2 - 1; uOff[u] = jsSign(x) * std::pow(std::fabs(x), spreadExp); uPan[u] = x * upan; }
  double lvl0 = p[34] / 100, pan0 = p[35] / 100, norm = 0.19 / std::sqrt((double)nu);
  for (auto& v : this->v) {
    if (!v.on) continue;
    for (int i = 0; i < n0; i += FLM_CR) {
      int e2 = (int)jsMin(n0, i + FLM_CR), n = e2 - i;
      lfoAdvance(v, n, lhz, sr); double lf = lfoValue(v, lsh, lmode == 1, p[31], rng) * lamt;
      if (v.gl < 1) v.f += (v.ft - v.f) * (1 - std::pow(1 - v.gl, (double)n)); else v.f = v.ft;
      double f0 = v.f * std::pow(2.0, (p[44] + bendSt + (ld == 2 ? lf * 12 : 0)) / 12);
      double det = clamp(p[6] / 100 + (ld == 5 ? lf * 0.5 : 0), 0, 1) * 1.0;
      double pwS = clamp(p[3] / 100 + (ld == 4 ? lf * 0.5 : 0), 0, 1) * 0.5;
      double pwY = clamp(p[11] / 100 + (ld == 4 ? lf * 0.5 : 0), 0.02, 0.98);
      double syncAmt = clamp(p[10] / 100 + v.senv.v * p[16] / 100 * v.dir + (ld == 3 ? lf : 0), 0, 1), sr2 = std::pow(2.0, syncAmt * 4);
      double oct = (double)(v.pitch - 60) / 12 * p[20] / 100 + (v.vel - 1) * 4 * p[21] / 100 + v.fenv.v * p[26] / 100 * 6 + (ld == 0 ? lf * 4 : 0);
      v.s1.set(sr, cutHz(p[18]) * std::pow(2.0, oct), clamp(res0 + (ld == 1 ? lf * 0.5 : 0), 0, 1)); v.s2.copyCoef(v.s1);
      double amp = lvl0 * v.vel * norm * (ld == 6 ? jsMax(0, 1 + lf) : 1), pan = clamp(pan0 + (ld == 7 ? lf : 0), -1, 1);
      double dsub = f0 / 2 / sr;
      for (int k = i; k < e2; k++) {
        double e = v.env.next(ap); v.fenv.next(fp); v.senv.next(sp);
        if (v.env.st == 0) { v.on = false; break; }
        double l = 0, r = 0;
        for (int u = 0; u < nu; u++) {
          double du = f0 * std::pow(2.0, uOff[u] * det / 12) / sr;
          double q = v.ph[u] + du, x;
          if (sync) {
            double s = v.sp[u] + du * sr2;
            if (q >= 1) { q -= 1; s = q * sr2; }
            if (s >= 1) s -= std::floor(s);
            v.sp[u] = s;
            x = pulseM ? (s < pwY ? 1 : -1) : 2 * s - 1;
          } else {
            if (q >= 1) q -= 1;
            x = pulseM ? flmPulseZ(q, du, pwS) : flmSaw(q, du);
          }
          v.ph[u] = q;
          l += x * (1 - uPan[u]); r += x * (1 + uPan[u]);
        }
        if (sub > 0) { v.sub += dsub; if (v.sub >= 1) v.sub -= 1; double sx = flmSaw(v.sub, dsub) * sub * std::sqrt((double)nu); l += sx; r += sx; }
        double g = e * amp;
        B[k] = (float)((double)B[k] + v.s1.run(l, 0) * g * jsMin(1, 1 - pan)); Bq[k] = (float)((double)Bq[k] + v.s2.run(r, 0) * g * jsMin(1, 1 + pan));
      }
      if (!v.on) break;
    }
  }
  tailOf(this, n0);
  if (p[52] > 0 || p[53] != 0) {
    double drive = 1 + p[52] / 100 * 25, nrm = p[52] > 0 ? 1 / std::tanh(drive) : 1, gn = std::pow(10.0, p[53] / 20);
    for (int k = 0; k < n0; k++) { B[k] = (float)((p[52] > 0 ? std::tanh(B[k] * drive) * nrm : (double)B[k]) * gn); Bq[k] = (float)((p[52] > 0 ? std::tanh(Bq[k] * drive) * nrm : (double)Bq[k]) * gn); }
  }
  if (p[57] > 0) dl.run(B, Bq, 0, n0, sr * 60 / bpm * flmSyncBeats(p[54]), p[55] / 100 * 0.9, p[56] / 100, p[57] / 100);
  for (int k = 0; k < n0; k++) { L[from + k] = (float)((double)L[from + k] + (double)B[k]); R[from + k] = (float)((double)R[from + k] + (double)Bq[k]); }
}

// ================================================================================================ GMS (31)
// dsp.js fft (in-place, radix-2) on double buffers — used once to build the wavetables
static void flmFft(double* re, double* im, int n) {
  for (int i = 1, j = 0; i < n; i++) {
    int bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (int len = 2; len <= n; len <<= 1) {
    double ang = -TWO_PI / len, wr = std::cos(ang), wi = std::sin(ang); int h = len >> 1;
    for (int i = 0; i < n; i += len) {
      double cr = 1, ci = 0;
      for (int k = 0; k < h; k++) {
        int a = i + k, b = a + h; double tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        double nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
// harmonic amplitude of harmonic h for GMS wave w (flmsyn.js HARM)
static double harm(int w, int h) {
  switch (w) {
    case 0: return (1.0 / h) * (h % 2 ? 1 : 0.55) * (1 + 1.6 * std::exp(-std::pow((double)(h - 7), 2) / 10));
    case 1: return h == 1 ? 1 : 0;
    case 2: return h % 2 ? (((h - 1) / 2) % 2 ? -1.0 : 1.0) / ((double)h * h) : 0;
    case 3: return 1.0 / h;
    case 4: return h % 2 ? 1.0 / h : 0;
    case 5: return std::sin(PI * h * 0.25) / h;
    case 6: return std::sin(PI * h * 0.125) / h;
    case 7: { static const int K[6] = {1, 2, 3, 4, 6, 8}; static const double V[6] = {1, 0.8, 0.6, 0.5, 0.35, 0.3}; for (int i = 0; i < 6; i++) if (K[i] == h) return V[i]; return 0; }
    case 8: return h == 1 ? 1 : h == 3 ? 0.55 : h == 5 ? 0.4 : h == 7 ? 0.3 : h == 11 ? 0.25 : h == 14 ? 0.2 : 0;
    case 9: return (1.0 / h) * (std::exp(-std::pow((double)(h - 5), 2) / 3) * 2.5 + std::exp(-std::pow((double)(h - 13), 2) / 6) * 1.6 + 0.15);
    case 10: return (h % 2 ? 1.0 / h : 0) * (h % 3 ? 1 : 0.2);
    case 11: return (1.0 / h) * (1 - std::exp(-(double)h / 3)) * 1.8;
    case 12: return (1.0 / h) * (std::exp(-std::pow((double)(h - 3), 2) / 2) * 2 + std::exp(-std::pow((double)(h - 9), 2) / 4) * 1.2 + 0.1);
    case 13: return h <= 24 ? (h % 4 == 1 ? 1.0 : h % 4 == 3 ? -0.6 : 0.2) / std::sqrt((double)h) : 0;
    default: return 0;
  }
}
const std::vector<GmsMips>& gmsWT() {
  static std::vector<GmsMips> WT;
  if (!WT.empty()) return WT;
  WT.resize(14);
  for (int w = 0; w < 14; w++) {
    for (int m = 0; m < WT_MIPS; m++) {
      int maxH = (int)jsMax(1, std::floor(WT_LEN / 2.0 / std::pow(2.0, m)) - 1);
      std::vector<double> re(WT_LEN, 0), im(WT_LEN, 0);
      int hi = (int)jsMin(maxH, WT_LEN / 2 - 1);
      for (int h = 1; h <= hi; h++) { double a = harm(w, h); im[h] = -a; im[WT_LEN - h] = a; }
      flmFft(re.data(), im.data(), WT_LEN);
      std::vector<float> t(WT_LEN + 1, 0.f); double pk = 0;
      for (int i = 0; i < WT_LEN; i++) { t[i] = (float)re[i]; pk = jsMax(pk, std::fabs(re[i])); }
      if (pk > 0) for (int i = 0; i < WT_LEN; i++) t[i] = (float)((double)t[i] / pk);
      t[WT_LEN] = t[0]; WT[w].m[m] = std::move(t);
    }
  }
  return WT;
}
double wtRead(const GmsMips& w, double ph, double dt) {
  int m = (int)clamp(std::floor(std::log2(jsMax(1e-9, dt * WT_LEN * 2))) + 1, 0, WT_MIPS - 1);
  const std::vector<float>& t = w.m[m]; double p = ph * WT_LEN; int i = (int)p; double f = p - i;
  return (double)t[i] + ((double)t[i + 1] - (double)t[i]) * f;
}
void GmsFx::run(float* L, float* R, int from, int to, int k, double amt, double X, double Y, double rateBeats, int shape, double bpm) {
  static const double VOX[5][3] = {{730, 1090, 2440}, {530, 1840, 2480}, {270, 2290, 3010}, {570, 840, 2410}, {300, 870, 2240}};
  if (k != kind) { kind = k; dl.clear(); md.clear(); ph.clear(); rv.clear(); }
  int n = to - from; double hz = bpm / 60 / rateBeats;
  lp += hz * n / sr; lp -= std::floor(lp);
  double lv = shape == 0 ? std::sin(TWO_PI * lp) : shape == 1 ? 1 - 2 * lp : lp < 0.5 ? 1 : -1;
  double x = clamp(X / 100 + amt / 100 * lv * 0.5, 0, 1), y = clamp(Y / 100, 0, 1);
  switch (k) {
    case 0: { double drive = 1 + x * 30, f = cutHz(20 + y * 80); fl[0].set(sr, f, 0.1); fl[1].set(sr, f, 0.1); double nrm = 1 / std::tanh(drive);
      for (int i = from; i < to; i++) { L[i] = (float)fl[0].run(std::tanh(L[i] * drive) * nrm, 0); R[i] = (float)fl[1].run(std::tanh(R[i] * drive) * nrm, 0); } break; }
    case 1: md.run(L, R, from, to, 0.25 + std::fabs(lv) * 0, 0.001, 0.004 * x + 0.0005, y * 0.85, 0.5); break;
    case 2: ph.run(L, R, from, to, 0.3, 200, x, y * 0.8, 0.6); break;
    case 3: case 4: { double f = cutHz(x * 100); fl[0].set(sr, f, y * 0.9); fl[1].set(sr, f, y * 0.9); int m = k == 3 ? 0 : 1;
      for (int i = from; i < to; i++) { L[i] = (float)fl[0].run(L[i], m); R[i] = (float)fl[1].run(R[i], m); } break; }
    case 5: dl.run(L, R, from, to, sr * 60 / bpm * 0.75, x * 0.9, y, 0.45, true); break;
    case 6: rv.run(L, R, from, to, x, y); break;
    case 7: { double pan = x * 2 - 1, gl = jsMin(1, 1 - pan), gr = jsMin(1, 1 + pan); int d = (int)jsRound(y * 0.0007 * sr);
      for (int i = from; i < to; i++) { double l = L[i], r = R[i]; L[i] = (float)(l * gl); R[i] = (float)(r * gr); }
      if (d > 0) dl.run(L, R, from, to, d, 0, 0, y * 0.5); break; }
    case 8: { double f = 20 * std::pow(250.0, x), inc = f / sr;
      for (int i = from; i < to; i++) { rm += inc; if (rm >= 1) rm -= 1; double m = std::sin(TWO_PI * rm); L[i] = (float)(L[i] * m); R[i] = (float)(R[i] * m); } break; }
    case 9: { double vf = x * 4; int a = (int)std::floor(vf), b = (int)jsMin(4, a + 1); double fr = vf - a, sc = 0.75 + y * 0.5;
      for (int c = 0; c < 3; c++) { double f = (VOX[a][c] + (VOX[b][c] - VOX[a][c]) * fr) * sc; fv[c][0].set(sr, f, 0.85); fv[c][1].set(sr, f, 0.85); }
      for (int i = from; i < to; i++) { double l = 0, r = 0; for (int c = 0; c < 3; c++) { l += fv[c][0].run(L[i], 2) * (c ? 0.6 : 1); r += fv[c][1].run(R[i], 2) * (c ? 0.6 : 1); } L[i] = (float)(l * 0.6); R[i] = (float)(r * 0.6); } break; }
    default: break;
  }
}
FlmGms::FlmGms(double sr_) : FlmVoices<GmsFlmVoice, 16>(sr_), bufL(4096, 0), bufR(4096, 0), fx0(sr_), fx1(sr_), fx2(sr_) {
  max = 16; gmsWT();
  double D[70] = {}; const double head[47] = {100, 0, 0.001, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0.001, 1, 0, 2, 0, 0, 0, 0, 0.001, 1, 1, 0.1, 0, 0.001, 0.5, 0, 0.3, 0, 0, 0, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0, 0};
  for (int i = 0; i < 47; i++) D[i] = head[i];
  const double rk[3] = {1, 2, 5}; int o = 47; for (int s = 0; s < 3; s++) { double blk[7] = {0, rk[s], 0, 50, 50, 5, 0}; for (int j = 0; j < 7; j++) D[o++] = blk[j]; }
  for (int i = 0; i < 68; i++) setParam(i, D[i]);
}
void FlmGms::setParam(int i, double x) {
  if (i < 0 || i >= 70) return; p[i] = x;
  if (i == 2 || i == 3) fp = adsrParams(p[2], p[3], 1, p[3], sr);
  if (i == 16 || i == 17) mp = adsrParams(p[16], p[17], 0, p[17], sr);
  if (i >= 24 && i <= 27) ap = adsrParams(p[24], p[25], p[26], p[27], sr);
  if (i >= 29 && i <= 32) ep = adsrParams(p[29], p[30], p[31], p[32], sr);
  if (i == 19) pb = x; if (i == 40) slide = x; if (i == 43) { mono = x > 0.5; allOff(); } if (i == 44) legato = x > 0.5;
}
void FlmGms::start(GmsFlmVoice& v, bool retrig) {
  if (!retrig) { for (int k = 0; k < 8; k++) v.ph[k] = p[11] * (k & 1); v.lp = 0; v.lt = 0; v.s1.reset(); v.s2.reset(); v.s3.reset(); v.s4.reset(); v.fenv.v = 0; v.menv.v = 0; v.eg.v = 0; }
  v.env.start(); v.fenv.start(); v.menv.start(); v.eg.start();
}
void FlmGms::render(float* L, float* R, int from, int to) {
  const std::vector<GmsMips>& W = gmsWT();
  const GmsMips& wa = W[(int)clamp(jsRound(p[7]), 0, (double)W.size() - 1)]; const GmsMips& wb = W[(int)clamp(jsRound(p[8]), 0, (double)W.size() - 1)];
  int kind = (int)jsRound(p[15]), fk = (int)jsRound(p[6]); double bal = (p[12] + 100) / 200, noise = p[13] / 100, lvl = flmDbg(p[22]), pan = p[23] / 100;
  int nv = (int)clamp(jsRound(p[45]) + 1, 1, 4); const int* sc = GMS_SCALE_C()[(int)clamp(jsRound(p[46]), 0, 2)]; double det = p[41] / 100 * 0.3, wide = p[42] / 100;
  double lhz = bpm / 60 / flmSyncBeats(p[38]); int lsh = (int)jsRound(p[36]); double lamt = p[35] / 100; int ldst = (int)jsRound(p[37]), edst = (int)jsRound(p[34]); double eamt = p[28] / 100;
  double res = p[1] / 100, bRatio = std::pow(2.0, (p[9] + p[10] / 100) / 12), tr = p[39];
  float* B = bufL.data(); float* Bq = bufR.data(); int n0 = to - from;
  if (n0 > (int)bufL.size()) { render(L, R, from, from + (int)bufL.size()); render(L, R, from + (int)bufL.size(), to); return; }
  clock += n0; std::fill(B, B + n0, 0.f); std::fill(Bq, Bq + n0, 0.f);
  for (auto& v : this->v) {
    if (!v.on) continue;
    for (int i = 0; i < n0; i += FLM_CR) {
      int e2 = (int)jsMin(n0, i + FLM_CR), n = e2 - i;
      lfoAdvance(v, n, lhz, sr); double lf = lfoValue(v, lsh, false, 0, rng) * lamt;
      if (v.gl < 1) v.f += (v.ft - v.f) * (1 - std::pow(1 - v.gl, (double)n)); else v.f = v.ft;
      double egv = v.eg.v * eamt * (p[33] > 0.5 ? v.vel : 1);
      double modD = clamp(p[14] / 100 + v.menv.v * p[18] / 100 + (edst == 1 ? egv : 0) + (ldst == 1 ? lf : 0), 0, 1);
      double pitchSt = tr + bendSt + (edst == 2 ? egv * 12 : 0) + (ldst == 2 ? lf * 12 : 0);
      double oct = (p[5] > 0.5 ? (double)(v.pitch - 60) / 12 : 0) + v.fenv.v * p[4] / 100 * 6 + (edst == 0 ? egv * 6 : 0) + (ldst == 0 ? lf * 4 : 0);
      double fc = cutHz(p[0]) * std::pow(2.0, oct);
      v.s1.set(sr, fc, fk == 1 ? res * 0.5 : res); v.s2.set(sr, fc, fk == 1 ? res * 0.5 : res);
      v.s3.copyCoef(v.s1); v.s4.copyCoef(v.s1);
      int fm = fk == 2 ? 1 : 0; bool two = fk == 1;
      double f0 = v.f * std::pow(2.0, pitchSt / 12);
      for (int k = i; k < e2; k++) {
        double e = v.env.next(ap); v.fenv.next(fp); v.menv.next(mp); v.eg.next(ep);
        if (v.env.st == 0) { v.on = false; break; }
        double l = 0, r = 0;
        for (int u = 0; u < nv; u++) {
          double uf = f0 * std::pow(2.0, (sc[u] + (u ? (u & 1 ? 1 : -1) * det * std::ceil(u / 2.0) : 0)) / 12), dA = uf / sr, dB = dA * bRatio * (kind == 3 ? std::pow(2.0, modD * 3) : 1);
          double pa = v.ph[u * 2] + dA, pb = v.ph[u * 2 + 1] + dB;
          if (pa >= 1) { pa -= 1; if (kind == 3) pb = pa * (dB / dA); }
          if (pb >= 1) pb -= std::floor(pb);
          v.ph[u * 2] = pa; v.ph[u * 2 + 1] = pb;
          double b = wtRead(wb, pb, dB);
          double a;
          if (kind == 1) { double q = pa + b * modD * 0.6; q -= std::floor(q); a = wtRead(wa, q, dA); } else a = wtRead(wa, pa, dA);
          if (kind == 2) a = a * (1 - modD) + a * b * modD;
          double xx = a * (1 - bal) + b * bal, sp = nv > 1 ? ((double)u / (nv - 1) * 2 - 1) * wide : 0;
          l += xx * (1 - sp); r += xx * (1 + sp);
        }
        if (noise > 0) { double nz = ((double)lcg(rng) / 2147483648.0 - 1) * noise; l += nz; r += nz; }
        l = v.s1.run(l, fm); r = v.s2.run(r, fm);
        if (two) { l = v.s3.run(l, 0); r = v.s4.run(r, 0); }
        double g = e * v.vel * 0.2 / std::sqrt((double)nv);
        B[k] = (float)((double)B[k] + l * g); Bq[k] = (float)((double)Bq[k] + r * g);
      }
      if (!v.on) break;
    }
  }
  tailOf(this, n0);
  GmsFx* fx[3] = {&fx0, &fx1, &fx2};
  for (int s = 0; s < 3; s++) { int o = 47 + s * 7; if (p[o] > 0.5) fx[s]->run(B, Bq, 0, n0, (int)jsRound(p[o + 1]), p[o + 2], p[o + 3], p[o + 4], flmSyncBeats(jsMin(5, p[o + 5])), (int)jsRound(p[o + 6]), bpm); }
  double gl = lvl * jsMin(1, 1 - pan), gr = lvl * jsMin(1, 1 + pan);
  for (int k = 0; k < n0; k++) { L[from + k] = (float)((double)L[from + k] + (double)B[k] * gl); R[from + k] = (float)((double)R[from + k] + (double)Bq[k] * gr); }
}

// ================================================================================================ DirectWave (30)
FlmDirectWave::FlmDirectWave(double sr_, Bank* bk) : FlmVoices<DwFlmVoice, 32>(sr_), bank(bk) {
  static const double D[35] = {0, 0, 0.001, 1, 1, 0.3, 0.1, 2, 0, 0, 0, 0, 100, 0, 0, 0, 1, 0.001, 1, 1, 0.3, 0, 0.001, 1, 1, 0.3, 0, 0, 0.03, 9, 0, 0, 0, 0, 0};
  for (int i = 0; i < 35; i++) setParam(i, D[i]);
}
void FlmDirectWave::setParam(int i, double x) {
  if (i >= 300) { int zi = (i - 300) >> 1; if (zi < DW_ZONES) { if ((i - 300) & 1) z[zi].pan = clamp(x, -1, 1); else z[zi].gain = flmDbg(clamp(x, -60, 12)); } return; }
  if (i >= 100) {
    int zi = (int)std::floor((i - 100) / 8.0), k = (i - 100) % 8; if (zi >= DW_ZONES) return; DwZone& q = z[zi];
    switch (k) { case 0: q.id = toInt32(x); break; case 1: q.root = (int)clamp(toInt32(x), 0, 127); break; case 2: q.lo = (int)clamp(toInt32(x), 0, 127); break; case 3: q.hi = (int)clamp(toInt32(x), 0, 127); break; case 4: q.vlo = (int)clamp(toInt32(x), 1, 127); break; case 5: q.vhi = (int)clamp(toInt32(x), 1, 127); break; case 6: q.tune = clamp(x, -100, 100); break; case 7: q.loop = x > 0.5; break; }
    return;
  }
  if (i < 0 || i >= 40) return; p[i] = x;
  if (i >= 2 && i <= 5) ap = adsrParams(p[2], p[3], p[4], p[5], sr);
  if (i >= 17 && i <= 20) fp = adsrParams(p[17], p[18], p[19], p[20], sr);
  if (i >= 22 && i <= 25) qp = adsrParams(p[22], p[23], p[24], p[25], sr);
  if (i == 6) slide = x; if (i == 7) pb = x; if (i == 10) legato = x > 0.5; if (i == 11) { mono = x > 0.5; allOff(); }
}
void FlmDirectWave::start(DwFlmVoice& v, bool retrig) {
  if (!retrig) { v.fenv.v = 0; v.penv.v = 0; v.lp = 0; v.lt = 0; v.sl.reset(); v.sr2.reset(); }
  v.pos = p[8] > 0.5 ? -1 : 0;
  v.env.start(); v.fenv.start(); v.penv.start();
}
void FlmDirectWave::noteOn(int pt, double vel) {
  int vi = (int)jsMin(127, jsRound(vel * 127));
  for (DwZone& q : z) {
    Sample* s = q.id >= 0 ? bank->s[q.id] : nullptr;
    if (!s || pt < q.lo || pt > q.hi || vi < q.vlo || vi > q.vhi) continue;
    DwFlmVoice& v = mono ? this->v[0] : pick();
    v.id = q.id; v.zroot = q.root; v.ztune = q.tune; v.zloop = q.loop; v.zg = q.gain; v.zp = q.pan;
    if (mono) { FlmVoices::noteOn(pt, vel); return; }
    begin(v, pt, vel, 0);
  }
}
void FlmDirectWave::render(float* L, float* R, int from, int to) {
  clock += to - from;
  int ftype = (int)jsRound(p[16]); bool filt = ftype > 0; int mode = ftype - 1; bool loopAll = p[9] > 0.5, rev = p[8] > 0.5;
  int lfoMode = (int)jsRound(p[27]); double lhz = lfoMode == 2 ? bpm / 60 / flmSyncBeats(p[29]) : p[28]; int lshape = (int)jsRound(p[30]); double lamt = p[32] / 100; int ldest = (int)jsRound(p[33]);
  double lvl = flmDbg(p[34]), res = p[13] / 100;
  for (auto& v : this->v) {
    if (!v.on) continue;
    Sample* s = v.id >= 0 && v.id < 256 ? bank->s[v.id] : nullptr;
    if (!s || s->frames < 2) { v.on = false; continue; }
    int last = s->frames - 1; const float* sl = s->l; const float* srr = s->r ? s->r : s->l; bool loop = loopAll || v.zloop; double base = s->rate / sr;
    if (v.pos < 0) v.pos = last;
    for (int i = from; i < to; i += FLM_CR) {
      int e2 = (int)jsMin(to, i + FLM_CR), n = e2 - i;
      lfoAdvance(v, n, lhz, sr); double lf = lfoValue(v, lshape, lfoMode == 1, p[31], rng) * lamt;
      if (v.gl < 1) v.f += (v.ft - v.f) * (1 - std::pow(1 - v.gl, (double)n)); else v.f = v.ft;
      double fe = v.fenv.v, pe = v.penv.v;
      double st = 12 * std::log2(v.f / midiToHz(v.zroot)) + p[0] + (p[1] + v.ztune) / 100 + pe * p[26] / 100 * 12 + (ldest == 1 ? lf * 12 : 0) + bendSt;
      double step = base * std::pow(2.0, st / 12) * (rev ? -1 : 1);
      if (filt) {
        double oct = (double)(v.pitch - 60) / 12 * p[14] / 100 + (v.vel - 1) * 4 * p[15] / 100 + fe * p[21] / 100 * 6 + (ldest == 0 ? lf * 4 : 0);
        double f = cutHz(p[12]) * std::pow(2.0, oct); v.sl.set(sr, f, res); v.sr2.copyCoef(v.sl);
      }
      double amp = lvl * v.vel * v.zg * (ldest == 2 ? jsMax(0, 1 + lf) : 1), pan = clamp((ldest == 3 ? lf : 0) + v.zp, -1, 1), gl = amp * jsMin(1, 1 - pan), gr = amp * jsMin(1, 1 + pan);
      for (int k = i; k < e2; k++) {
        double e = v.env.next(ap); v.fenv.next(fp); v.penv.next(qp);
        if (v.env.st == 0) { v.on = false; break; }
        if (v.pos > last || v.pos < 0) { if (!loop) { v.on = false; break; } v.pos = rev ? v.pos + last : v.pos - last; }
        int ip = (int)v.pos; double fr = v.pos - ip; int j = ip + 1 > last ? (loop ? 0 : last) : ip + 1;
        double xl = (double)sl[ip] + ((double)sl[j] - sl[ip]) * fr, xr = (double)srr[ip] + ((double)srr[j] - srr[ip]) * fr;
        if (filt) { xl = v.sl.run(xl, mode); xr = v.sr2.run(xr, mode); }
        L[k] = (float)((double)L[k] + xl * e * gl); R[k] = (float)((double)R[k] + xr * e * gr);
        v.pos += step;
      }
      if (!v.on) break;
    }
  }
}

}  // namespace mdaw
