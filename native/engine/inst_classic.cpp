// Port of js/engine/instruments.js: Sampler, Moisture, Osphere, Gms (see inst_classic.h).
#include "inst_classic.h"
#include <cmath>
#include <cstring>

namespace mdaw {

static inline double rnd01(uint32_t& s) { return lcg(s) / 4294967296.0; }
// instruments.js herm(): 4-point Hermite, indices clamped to [0, last]
static inline double herm(const float* a, double pos, int last) {
  int i = toInt32(pos); double t = pos - i; int i0 = i > 0 ? i - 1 : 0, i2 = i + 1 < last ? i + 1 : last, i3 = i + 2 < last ? i + 2 : last;
  double x0 = a[i0], x1 = a[i > last ? last : i], x2 = a[i2], x3 = a[i3];
  return x1 + 0.5 * t * (x2 - x0 + t * (2 * x0 - 5 * x1 + 4 * x2 - x3 + t * (3 * (x1 - x2) + x3 - x0)));
}

// ================================================================ Sampler
constexpr double SMP_UNITY = 0.8, SMP_OPEN = 17999;
Sampler::Sampler(double rate, Bank* b) : PolyBase(rate), bank(b) { pitchNative = true; upEnv(); upFilter(); }
void Sampler::upFilter() { open = cutoff >= SMP_OPEN; if (!open) lp.lowpass(sr, clamp(cutoff, 20, sr * 0.45), 0.707); for (auto& x : v) { x.fL.copy(lp); x.fR.copy(lp); } }
void Sampler::setParam(int i, double x) {
  if (i == 90) { pitch = clamp(x, -24, 24); return; }
  if (i >= 100) {
    int zi = (int)std::floor((i - 100) / 8.0), k = (i - 100) % 8; if (zi >= N_ZONES) return;
    SmpZone& q = z[zi];
    switch (k) {
      case 0: q.id = toInt32(x); break; case 1: q.root = (int)clamp(toInt32(x), 0, 127); break; case 2: q.lo = (int)clamp(toInt32(x), 0, 127); break; case 3: q.hi = (int)clamp(toInt32(x), 0, 127); break;
      case 4: q.vlo = (int)clamp(toInt32(x), 1, 127); break; case 5: q.vhi = (int)clamp(toInt32(x), 1, 127); break; case 6: q.tune = clamp(x, -100, 100); break; case 7: q.loop = x > 0.5; break;
    }
    return;
  }
  switch (i) { case 0: gain = x; break; case 1: a = x; upEnv(); break; case 2: r = x; upEnv(); break; case 3: cutoff = x; upFilter(); break; case 4: tune = x; break; case 5: velSens = clamp(x, 0, 1); break; case 6: oneShot = x > 0.5; break; }
}
SmpVoice& Sampler::allocS() {
  SmpVoice& x = alloc();
  if (x.on && x.fade == 0) {
    SmpVoice* sp = nullptr; for (auto& o : v) if (!o.on && &o != &x) { sp = &o; break; }
    if (sp) {
      sp->on = true; sp->held = false; sp->pitch = x.pitch; sp->vel = x.vel; sp->age = x.age; sp->pos = x.pos; sp->ratio = x.ratio; sp->id = x.id; sp->loop = x.loop; sp->fade = 1; sp->fd = 1 / (0.0015 * sr);
      sp->env.st = x.env.st; sp->env.v = x.env.v; sp->fL.copy(x.fL); sp->fL.z1 = x.fL.z1; sp->fL.z2 = x.fL.z2; sp->fR.copy(x.fR); sp->fR.z1 = x.fR.z1; sp->fR.z2 = x.fR.z2;
    }
  }
  return x;
}
void Sampler::noteOn(int p, double vel) {
  double vi = jsRound(vel * 127);
  for (auto& q : z) {
    Sample* s = q.id >= 0 && q.id < 256 ? bank->s[q.id] : nullptr;
    if (!s || p < q.lo || p > q.hi || vi < q.vlo || vi > q.vhi) continue;
    SmpVoice& x = allocS();
    x.on = x.held = true; x.pitch = p; x.vel = vel; x.age = ++counter; x.pos = 0; x.id = q.id; x.loop = q.loop; x.fade = 0;
    x.fL.copy(lp); x.fR.copy(lp); x.fL.z1 = x.fL.z2 = x.fR.z1 = x.fR.z2 = 0;
    x.ratio = (s->rate / sr) * std::pow(2, ((p - q.root) + tune + pitch) / 12 + q.tune / 1200);
    x.env.start();
  }
}
void Sampler::noteOff(int p) { if (oneShot) { for (auto& x : v) if (x.on && x.held && x.pitch == p) x.held = false; return; } PolyBase::noteOff(p); }
void Sampler::render(float* L, float* R, int from, int to) {
  for (auto& x : v) {
    if (!x.on) continue;
    Sample* s = x.id >= 0 && x.id < 256 ? bank->s[x.id] : nullptr;
    if (!s || s->frames < 2) { x.on = false; continue; }
    double g = (gain / SMP_UNITY) * ((1 - velSens) + velSens * x.vel); int last = s->frames - 1; const float* sl = s->l; const float* sr_ = s->r ? s->r : s->l;
    for (int i = from; i < to; i++) {
      double e = x.env.next(ap);
      if (x.env.st == 0) { x.on = false; break; }
      if (x.fade > 0) { x.fade -= x.fd; if (x.fade <= 0) { x.on = false; x.fade = 0; break; } e *= x.fade; }
      if (x.pos >= last) { if (!x.loop) { x.on = false; break; } x.pos -= last; }
      double xl = herm(sl, x.pos, last), xr = herm(sr_, x.pos, last);
      if (!open) { xl = x.fL.process(xl); xr = x.fR.process(xr); }
      L[i] = (float)(L[i] + xl * e * g); R[i] = (float)(R[i] + xr * e * g);
      x.pos += x.ratio;
    }
  }
}

// ================================================================ Moisture tables (instruments.js harm / tablesJob, built once)
static double harm(int t, int h, double& ph) {
  double amp = 0; ph = 0;
  switch (t) {
    case 0: amp = h == 1 ? 1 : 0; break;
    case 1: amp = (h & 1) ? 1.0 / (h * h) : 0; ph = (((h - 1) / 2) & 1) ? PI : 0; break;
    case 2: amp = 1.0 / h; break;
    case 3: amp = (h & 1) ? 1.0 / h : 0; break;
    case 4: amp = std::fabs(std::sin(PI * h * 0.25)) / h; ph = -PI * h * 0.5; break;
    case 5: { static const double A[9] = { 0, 1, 0.7, 0.5, 0.4, 0, 0.25, 0, 0.2 }; amp = h < 9 ? A[h] : 0; break; }
    case 6: amp = (1.0 / h) * (0.15 + std::exp(-0.5 * std::pow(h - 3, 2) / 1.5) + 0.8 * std::exp(-0.5 * std::pow(h - 6, 2) / 2) + 0.5 * std::exp(-0.5 * std::pow(h - 10, 2) / 3)); break;
    default: amp = (h & 1) ? 1 / std::pow(h, 0.8) : 0; ph = ((((uint32_t)h * 2654435761u) >> 20) & 1023) * (TWO_PI / 1024);
  }
  return amp;
}
static inline int mtAt(int t, int m) { return (t * MT_NM + m) * (MT_TLEN + 1); }
static const float* moistureTables() {
  static float* d = [] {
    float* dd = new float[MT_NT * MT_NM * (MT_TLEN + 1)](); float row[MT_TLEN];
    for (int t = 0; t < MT_NT; t++) {
      for (int h = 1; h <= 64; h++) {
        double ph; double amp = harm(t, h, ph);
        if (amp) {
          for (int i = 0; i < MT_TLEN; i++) row[i] = (float)(amp * std::sin(TWO_PI * h * i / MT_TLEN + ph));
          for (int m = 0; m < MT_NM; m++) if (h <= (64 >> m)) { int o = mtAt(t, m); for (int i = 0; i < MT_TLEN; i++) dd[o + i] = (float)((double)dd[o + i] + row[i]); }
        }
      }
      double pk = 1e-6; int o0 = mtAt(t, 0);
      for (int i = 0; i < MT_TLEN; i++) pk = jsMax(pk, std::fabs(dd[o0 + i]));
      for (int m = 0; m < MT_NM; m++) { int o = mtAt(t, m); for (int i = 0; i < MT_TLEN; i++) dd[o + i] = (float)(dd[o + i] / pk); dd[o + MT_TLEN] = dd[o]; }
    }
    return dd;
  }();
  return d;
}
static int mipFor(double hz, double sr) { double maxH = (sr * 0.45) / jsMax(hz, 20); int m = 0; while (m < MT_NM - 1 && (64 >> m) > maxH) m++; return m; }

// ================================================================ Moisture
Moisture::Moisture(double rate) : PolyBase(rate), T(moistureTables()) { upEnv(); }
void Moisture::setParam(int i, double x) {
  switch (i) {
    case 0: posA = clamp(x, 0, 1); break; case 1: posB = clamp(x, 0, 1); break; case 2: lvB = clamp(x, 0, 1); break; case 3: octB = jsRound(clamp(x, -2, 2)); break;
    case 4: subLv = clamp(x, 0, 1); break; case 5: uni = (int)jsRound(clamp(x, 1, 5)); break; case 6: uniDet = clamp(x, 0, 60); break; case 7: ftype = (int)jsRound(clamp(x, 0, 2)); break;
    case 8: cutoff = x; break; case 9: res = clamp(x, 0.5, 12); break; case 10: fAmt = clamp(x, -1, 1); break;
    case 11: a = x; upEnv(); break; case 12: d = x; upEnv(); break; case 13: s = x; upEnv(); break; case 14: rel = x; upEnv(); break;
    case 15: lfoHz = x; break; case 16: lfoDep = clamp(x, 0, 1); break; case 17: gain = x; break;
  }
}
void Moisture::noteOn(int p, double vel) {
  MoistVoice& x = alloc();
  x.on = x.held = true; x.pitch = p; x.vel = vel; x.age = ++counter; x.fenv = 1; x.lfo = 0; x.f0 = midiToHz(p); x.phS = 0;
  x.mA = mipFor(x.f0 * 1.05, sr); x.mB = mipFor(x.f0 * std::pow(2, octB) * 1.05, sr);
  for (int u = 0; u < 5; u++) x.phA[u] = rnd01(seed);
  x.phB = rnd01(seed); x.fl.reset(); x.fr.reset(); x.env.start();
}
void Moisture::render(float* L, float* R, int from, int to) {
  double lfoInc = lfoHz / sr, maxF = sr * 0.45; const int TL = MT_TLEN;
  double tposB = posB * (MT_NT - 1); int tB0 = (int)jsMin(toInt32(tposB), MT_NT - 2); double tBf = tposB - tB0;
  for (auto& x : v) {
    if (!x.on) continue;
    double dtB = x.f0 * std::pow(2, octB) / sr, dtS = x.f0 * 0.5 / sr; int mA = x.mA, mB = x.mB; double* phA = x.phA;
    for (int u = 0; u < uni; u++) { dtA[u] = x.f0 * std::pow(2, uniDet * spread[u] / 1200) / sr; double pan = uni > 1 ? spread[u] * 0.7 : 0; gl[u] = std::cos((pan + 1) * 0.7853982) * 1.4142; gr[u] = std::sin((pan + 1) * 0.7853982) * 1.4142; }
    double norm = 1 / std::sqrt((double)uni); int bBase0 = mtAt(tB0, mB), bBase1 = mtAt(tB0 + 1, mB);
    for (int i = from; i < to; i += 32) {
      int e2 = (int)jsMin(to, i + 32);
      double fc = clamp(cutoff * std::pow(2, fAmt * 4 * x.fenv), 30, maxF);
      if (ftype == 0) x.fl.lowpass(sr, fc, res); else if (ftype == 1) x.fl.highpass(sr, fc, res); else x.fl.bandpass(sr, fc, res);
      x.fr.copy(x.fl);
      x.lfo += lfoInc * 32; if (x.lfo >= 1) x.lfo -= 1;
      double pA = clamp(posA + lfoDep * 0.5 * (1 + std::sin(TWO_PI * x.lfo)) * (1 - posA), 0, 1);
      double tp = pA * (MT_NT - 1); int tA0 = (int)jsMin(toInt32(tp), MT_NT - 2); double tAf = tp - tA0; int aBase0 = mtAt(tA0, mA), aBase1 = mtAt(tA0 + 1, mA);
      for (int k = i; k < e2; k++) {
        double e = x.env.next(ap);
        if (x.env.st == 0) { x.on = false; break; }
        x.fenv *= fdC;
        double sl = 0, sr2 = 0;
        for (int u = 0; u < uni; u++) {
          double p = phA[u] + dtA[u]; if (p >= 1) p -= 1; phA[u] = p;
          double fp = p * TL; int i0 = toInt32(fp); double fr = fp - i0; int a0 = aBase0 + i0, a1 = aBase1 + i0;
          double x0 = T[a0] + (T[a0 + 1] - (double)T[a0]) * fr, x1 = T[a1] + (T[a1 + 1] - (double)T[a1]) * fr, xx = x0 + (x1 - x0) * tAf;
          sl += xx * gl[u]; sr2 += xx * gr[u];
        }
        sl *= norm; sr2 *= norm;
        if (lvB > 0.001) {
          x.phB += dtB; if (x.phB >= 1) x.phB -= 1;
          double fp = x.phB * TL; int i0 = toInt32(fp); double fr = fp - i0; int a0 = bBase0 + i0, a1 = bBase1 + i0;
          double x0 = T[a0] + (T[a0 + 1] - (double)T[a0]) * fr, x1 = T[a1] + (T[a1 + 1] - (double)T[a1]) * fr, xx = (x0 + (x1 - x0) * tBf) * lvB;
          sl += xx; sr2 += xx;
        }
        if (subLv > 0.001) { x.phS += dtS; if (x.phS >= 1) x.phS -= 1; double xx = std::sin(TWO_PI * x.phS) * subLv; sl += xx; sr2 += xx; }
        double g = e * x.vel * gain;
        L[k] = (float)(L[k] + x.fl.process(sl) * g); R[k] = (float)(R[k] + x.fr.process(sr2) * g);
      }
      if (!x.on) break;
    }
  }
}

// ================================================================ Osphere
Osphere::Osphere(double rate) : PolyBase(rate), dPrevL(0.018 * rate), dPrevR(0.018 * rate) { upEnv(); }
void Osphere::setParam(int i, double x) {
  switch (i) {
    case 0: w1 = jsRound(clamp(x, 0, 3)); break; case 1: lv1 = clamp(x, 0, 1); break; case 2: oct1 = jsRound(clamp(x, -2, 2)); break; case 3: det1 = clamp(x, 0, 40); break;
    case 4: w2 = jsRound(clamp(x, 0, 3)); break; case 5: lv2 = clamp(x, 0, 1); break; case 6: oct2 = jsRound(clamp(x, -2, 2)); break; case 7: det2 = clamp(x, 0, 40); break;
    case 8: air = clamp(x, 0, 1); break; case 9: cutoff = x; break; case 10: res = clamp(x, 0.5, 8); break;
    case 11: a = x; upEnv(); break; case 12: rel = x; upEnv(); break;
    case 13: chDepth = clamp(x, 0, 1); break; case 14: chMix = clamp(x, 0, 1); break; case 15: motion = clamp(x, 0, 1); break; case 16: motionHz = x; break; case 17: gain = x; break;
  }
}
void Osphere::noteOn(int p, double vel) { OsphVoice& x = alloc(); x.on = x.held = true; x.pitch = p; x.vel = vel; x.age = ++counter; x.f0 = midiToHz(p); x.lfo = 0; for (int k = 0; k < 4; k++) x.ph[k] = rnd01(seed); x.fl.reset(); x.fr.reset(); x.env.start(); }
void Osphere::render(float* L, float* R, int from, int to) {
  int n = to - from; if (n <= 0) return;
  double maxF = sr * 0.45;
  for (int i = 0; i < n; i++) { tl[i] = 0; tr[i] = 0; }
  for (auto& x : v) {
    if (!x.on) continue;
    double f1 = x.f0 * std::pow(2, oct1), f2 = x.f0 * std::pow(2, oct2); double* ph = x.ph;
    dts[0] = f1 * std::pow(2, det1 / 1200) / sr; dts[1] = f1 * std::pow(2, -det1 / 1200) / sr; dts[2] = f2 * std::pow(2, det2 / 1200) / sr; dts[3] = f2 * std::pow(2, -det2 / 1200) / sr;
    double d0 = dts[0], d1 = dts[1], d2 = dts[2], d3 = dts[3];
    for (int i = 0; i < n; i += 32) {
      int e2 = (int)jsMin(n, i + 32);
      x.lfo += motionHz * 32 / sr; if (x.lfo >= 1) x.lfo -= 1;
      x.fl.lowpass(sr, clamp(cutoff * std::pow(2, motion * 2 * std::sin(TWO_PI * x.lfo)), 40, maxF), res); x.fr.copy(x.fl);
      for (int k = i; k < e2; k++) {
        double e = x.env.next(ap);
        if (x.env.st == 0) { x.on = false; break; }
        double p0 = ph[0] + d0, p1 = ph[1] + d1, p2 = ph[2] + d2, p3 = ph[3] + d3;
        if (p0 >= 1) p0 -= 1; if (p1 >= 1) p1 -= 1; if (p2 >= 1) p2 -= 1; if (p3 >= 1) p3 -= 1;
        ph[0] = p0; ph[1] = p1; ph[2] = p2; ph[3] = p3;
        double xl = wave4(w1, p0, d0) * lv1 + wave4(w2, p2, d2) * lv2, xr = wave4(w1, p1, d1) * lv1 + wave4(w2, p3, d3) * lv2;
        if (air > 0.001) { double nz = (toInt32(lcg(seed)) / 2147483648.0) * air * 0.5; xl += nz; xr -= nz; }
        double g = e * x.vel * gain;
        tl[k] = (float)(tl[k] + x.fl.process(xl) * g); tr[k] = (float)(tr[k] + x.fr.process(xr) * g);
      }
      if (!x.on) break;
    }
  }
  float* dl0 = dl[0]; float* dl1 = dl[1]; double base = 0.018 * sr, dep = (0.0005 + 0.004 * chDepth) * sr, cm = chMix;
  double tgtL = base + dep * std::sin(TWO_PI * chPh), tgtR = base + dep * std::sin(TWO_PI * (chPh + 0.33));
  chPh += 0.35 * n / sr; if (chPh >= 1) chPh -= 1;
  double dL = dPrevL, dR = dPrevR, sL = (tgtL - dL) / n, sR = (tgtR - dR) / n;
  for (int i = 0; i < n; i++) {
    dl0[wp] = tl[i]; dl1[wp] = tr[i];
    dL += sL; dR += sR;
    double rp = wp - dL; if (rp < 0) rp += DL; int a0 = toInt32(rp); double f = rp - a0; double oL = dl0[a0] * (1 - f) + dl0[a0 + 1 >= DL ? 0 : a0 + 1] * f;
    rp = wp - dR; if (rp < 0) rp += DL; a0 = toInt32(rp); f = rp - a0; double oR = dl1[a0] * (1 - f) + dl1[a0 + 1 >= DL ? 0 : a0 + 1] * f;
    L[from + i] = (float)(L[from + i] + (tl[i] * (1 - cm * 0.5) + oL * cm)); R[from + i] = (float)(R[from + i] + (tr[i] * (1 - cm * 0.5) + oR * cm));
    if (++wp >= DL) wp = 0;
  }
  dPrevL = dL; dPrevR = dR;
}

// ================================================================ GMS
Gms::Gms(double rate) : PolyBase(rate) { upEnv(); }
void Gms::setParam(int i, double x) {
  if (i >= 10 && i <= 21) { Osc& q = o3[(i - 10) / 4]; switch ((i - 10) % 4) { case 0: q.wave = jsRound(clamp(x, 0, 3)); break; case 1: q.oct = jsRound(clamp(x, -2, 2)); break; case 2: q.fine = clamp(x, -50, 50); break; default: q.lv = clamp(x, 0, 1); } return; }
  switch (i) {
    case 0: mode = x > 0.5 ? 1 : 0; allOff(); break; case 1: glide = x; break; case 2: cutoff = x; break; case 3: res = clamp(x, 0.5, 10); break; case 4: fAmt = clamp(x, -1, 1); break;
    case 5: a = x; upEnv(); break; case 6: d = x; upEnv(); break; case 7: s = x; upEnv(); break; case 8: rel = x; upEnv(); break; case 9: gain = x; break;
    case 22: { bool on = x > 0.5; if (on != arpOn) { arpOn = on; allOff(); nh = 0; arpNote = -1; arpPos = 0; arpStep = 0; } break; }
    case 23: pattern = (int)jsRound(clamp(x, 0, 4)); break; case 24: rate = (int)jsRound(clamp(x, 0, 3)); break; case 25: octs = (int)jsRound(clamp(x, 1, 3)); break; case 26: gate = clamp(x, 0.1, 1); break;
  }
}
void Gms::trigger(int p, double vel) {
  if (mode == 1) {
    for (auto& m : v) if (m.on && m.held) { m.pitch = p; m.ft = midiToHz(p); m.vel = vel; return; }
    for (auto& o : v) if (o.on) { o.held = false; o.env.release(); }
  }
  GmsVoice& x = alloc();
  x.on = x.held = true; x.pitch = p; x.vel = vel; x.f = x.ft = midiToHz(p); x.age = ++counter; x.fenv = 1; for (int k = 0; k < 3; k++) x.ph[k] = rnd01(seed); x.f1.reset(); x.f2.reset(); x.env.start();
}
void Gms::releaseP(int p) {
  if (mode == 1) { for (auto& o : v) if (o.on && o.held) { o.held = false; o.env.release(); } return; }
  for (auto& o : v) if (o.on && o.held && o.pitch == p) { o.held = false; o.env.release(); }
}
template <class H> static int dropP(H* a, int n, int p) { int k = 0; for (int i = 0; i < n; i++) if (a[i].p != p) a[k++] = a[i]; return k; }
void Gms::noteOn(int p, double vel) {
  if (arpOn) { bool has = false; for (int i = 0; i < nh; i++) if (held[i].p == p) has = true; if (!has && nh < 16) held[nh++] = { p, vel }; return; }
  if (mode == 1) { ns = dropP(stack, ns, p); if (ns < 128) stack[ns++] = { p, vel }; }
  trigger(p, vel);
}
void Gms::noteOff(int p) {
  if (arpOn) { nh = dropP(held, nh, p); if (!nh && arpNote >= 0) { releaseP(arpNote); arpNote = -1; } return; }
  if (mode == 1) { ns = dropP(stack, ns, p); if (ns) { Held t = stack[ns - 1]; trigger(t.p, t.vel); return; } }
  releaseP(p);
}
void Gms::allOff() { for (auto& o : v) if (o.on) { o.held = false; o.env.release(); } ns = 0; arpNote = -1; }
bool Gms::active() { if (arpOn && nh > 0) return true; for (auto& o : v) if (o.on) return true; return false; }
void Gms::arpNext() {
  Held seq[16]; int n = nh; for (int i = 0; i < n; i++) seq[i] = held[i];
  if (pattern != 4) for (int i = 1; i < n; i++) for (int k = i; k > 0 && seq[k].p < seq[k - 1].p; k--) { Held t = seq[k]; seq[k] = seq[k - 1]; seq[k - 1] = t; }   // stable, like Array.sort
  int total = n * octs; if (!total) return;
  int idx;
  switch (pattern) {
    case 1: idx = total - 1 - (int)std::fmod(arpStep, total); break;
    case 2: { int cyc = (int)jsMax(1, total * 2 - 2), q = (int)std::fmod(arpStep, cyc); idx = q < total ? q : cyc - q; break; }
    case 3: idx = (int)((lcg(seed) >> 8) % (uint32_t)total); break;
    default: idx = (int)std::fmod(arpStep, total);
  }
  arpStep++;
  int p = (int)jsMin(127, seq[idx % n].p + 12 * std::floor((double)idx / n));
  if (arpNote >= 0) releaseP(arpNote);
  arpNote = p; trigger(p, seq[idx % n].vel);
}
void Gms::renderVoices(float* L, float* R, int from, int to) {
  double maxF = sr * 0.45, gl = 1 - std::exp(-1 / jsMax(1, glide * 0.001 * sr)); bool mono = mode == 1;
  double mul0 = std::pow(2, o3[0].oct + o3[0].fine / 1200) / sr, mul1 = std::pow(2, o3[1].oct + o3[1].fine / 1200) / sr, mul2 = std::pow(2, o3[2].oct + o3[2].fine / 1200) / sr;
  double w0 = o3[0].wave, w1 = o3[1].wave, w2 = o3[2].wave, l0 = o3[0].lv, l1 = o3[1].lv, l2 = o3[2].lv;
  for (auto& x : v) {
    if (!x.on) continue;
    double* ph = x.ph;
    for (int i = from; i < to; i += 32) {
      int e2 = (int)jsMin(to, i + 32);
      x.f1.lowpass(sr, clamp(cutoff * std::pow(2, fAmt * 4 * x.fenv), 30, maxF), res); x.f2.copy(x.f1);
      double dt0 = x.f * mul0, dt1 = x.f * mul1, dt2 = x.f * mul2;
      for (int k = i; k < e2; k++) {
        double e = x.env.next(ap);
        if (x.env.st == 0) { x.on = false; break; }
        x.fenv *= fdC;
        if (mono) x.f += (x.ft - x.f) * gl;
        double xx = 0;
        if (l0 > 0) { double p = ph[0] + dt0; if (p >= 1) p -= 1; ph[0] = p; xx += wave4(w0, p, dt0) * l0; }
        if (l1 > 0) { double p = ph[1] + dt1; if (p >= 1) p -= 1; ph[1] = p; xx += wave4(w1, p, dt1) * l1; }
        if (l2 > 0) { double p = ph[2] + dt2; if (p >= 1) p -= 1; ph[2] = p; xx += wave4(w2, p, dt2) * l2; }
        double y = x.f2.process(x.f1.process(xx)) * e * x.vel * gain;
        L[k] = (float)(L[k] + y); R[k] = (float)(R[k] + y);
      }
      if (!x.on) break;
    }
  }
}
void Gms::render(float* L, float* R, int from, int to) {
  if (!arpOn) { renderVoices(L, R, from, to); return; }
  double step = stepSamples(); int cur = from, guard = 0;
  while (cur < to && guard++ < 64) {
    double seg = to - cur;
    if (nh > 0) seg = jsMin(seg, jsMax(0, std::ceil(arpPos <= 0 ? 0 : step - arpPos)));
    if (arpNote >= 0 && arpOffAt >= 0) seg = jsMin(seg, jsMax(0, std::ceil(arpOffAt - arpPos)));
    if (seg > 0) { renderVoices(L, R, cur, cur + (int)seg); cur += (int)seg; if (nh > 0) arpPos += seg; }
    if (nh > 0 && (arpPos >= step || arpPos <= 0)) { arpPos = arpPos <= 0 ? 0 : arpPos - step; arpNext(); arpOffAt = step * gate; if (arpPos <= 0) arpPos = 1e-9; }
    else if (arpNote >= 0 && arpOffAt >= 0 && arpPos >= arpOffAt) { releaseP(arpNote); arpNote = -1; arpOffAt = -1; }
    else if (seg <= 0 && nh == 0) { renderVoices(L, R, cur, to); cur = to; }
  }
}

// ================================================================ SoundFont player
void SfPlayer::setParam(int i, double x) {
  if (i == 100) { sfId = toInt32(x); allOff(); } else if (i == 0) gain = x; else if (i == 1) { preset = (int)jsMax(0, toInt32(x)); allOff(); }
}
void SfPlayer::noteOn(int p, double vel) {
  const SoundFont* sf = sfId >= 0 && sfId < 8 ? bank->sf[sfId] : nullptr; if (!sf || sf->presets.empty()) return;
  const std::vector<SfZone>& pr = preset < (int)sf->presets.size() && !sf->presets[preset].empty() ? sf->presets[preset] : sf->presets[0];
  double vi = jsRound(vel * 127);
  for (const SfZone& z : pr) {
    if (p < z.lo || p > z.hi || vi < z.vlo || vi > z.vhi) continue;
    int si = (int)z.sample; if (si < 0 || si >= (int)sf->rate.size()) continue;
    SfVoice& x = alloc();
    x.on = x.held = true; x.pitch = p; x.vel = vel; x.age = ++counter; x.z = &z; x.sf = sf;
    x.pos = z.start; x.ratio = (sf->rate[si] / sr) * std::pow(2, (p - z.root + z.tune / 100) / 12);
    x.g = std::pow(10, -z.atten / 20); double pan = clamp(z.pan, -1, 1); x.pl = std::cos((pan + 1) * 0.7853982) * 1.4142; x.pr = std::sin((pan + 1) * 0.7853982) * 1.4142;
    x.ap = adsrParams(z.a, z.d, z.s, z.r, sr); x.env.start();
  }
}
void SfPlayer::render(float* L, float* R, int from, int to) {
  for (auto& x : v) {
    if (!x.on) continue;
    const SfZone& z = *x.z; const float* d = x.sf->data; bool loop = z.loop != 0 && z.le - z.ls > 8; double end = z.end - 1;
    double g = gain * x.vel * x.g * 1 / 32768;
    for (int i = from; i < to; i++) {
      double e = x.env.next(x.ap);
      if (x.env.st == 0) { x.on = false; break; }
      if (loop && x.pos >= z.le) x.pos -= z.le - z.ls;
      if (x.pos >= end) { x.on = false; break; }
      int ip = toInt32(x.pos); double fr = x.pos - ip; double s0 = ip >= 0 && ip < x.sf->n ? d[ip] : NAN, s1 = ip + 1 >= 0 && ip + 1 < x.sf->n ? d[ip + 1] : NAN;   // JS: undefined -> NaN
      double xx = (s0 + (s1 - s0) * fr) * e * g;
      L[i] = (float)(L[i] + xx * x.pl); R[i] = (float)(R[i] + xx * x.pr);
      x.pos += x.ratio;
    }
  }
}

}  // namespace mdaw
