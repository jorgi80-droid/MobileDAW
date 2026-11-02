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

}  // namespace mdaw
