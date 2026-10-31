// Port of js/engine/simpler.js. Keep in step with the JS original.
#include "simpler.h"

namespace mdaw {

static const double SIM_SYNC[7] = { 0.25, 0.5, 1, 2, 4, 8, 16 };
static inline double rnd01(uint32_t& s) { return lcg(s) / 4294967296.0; }
static inline double dblS(double db) { return db <= -60 ? 0 : std::pow(10, db / 20); }

double SEnv::step(double a, double d, double s, double r, double dt) {
  switch (st) {
    case 1: v += dt / jsMax(0.0001, a); if (v >= 1) { v = 1; st = 2; } break;
    case 2: v += (s - v) * (1 - std::exp(-dt * 4.6 / jsMax(0.0005, d))); if (std::fabs(v - s) < 1e-3) { v = s; st = 3; } break;
    case 3: v = s; break;
    case 4: v -= v * (1 - std::exp(-dt * 4.6 / jsMax(0.0005, r))); if (v < 1e-4) { v = 0; st = 0; } break;
    default: return 0;
  }
  return v;
}
void Simpler::setParam(int i, double x) {
  if (i >= 200) { switch (i - 200) { case 0: z.id = toInt32(x); break; case 1: z.root = (int)clamp(toInt32(x), 0, 127); break; case 8: z.s0 = clamp(x, 0, 1); break; case 9: z.s1 = clamp(x, 0, 1); break;
    case 10: z.l0 = clamp(x, 0, 1); break; case 11: z.l1 = clamp(x, 0, 1); break; case 12: z.xf = clamp(x, 0, 1); break; case 13: z.rev = x > 0.5; break; case 14: z.vol = x; break; } return; }
  if (i >= 0 && i < 64) p[i] = x;
}
void Simpler::getSlices(Sample* s) {
  double key[9] = { (double)z.id, (double)s->frames, jsRound(p[9]), std::round(p[10] * 1000), jsRound(p[11]), jsRound(p[12]), jsRound(p[15]), z.s0, z.s1 };
  bool same = nsl > 0; for (int k = 0; k < 9 && same; k++) if (key[k] != skey[k]) same = false;
  if (same) return;
  for (int k = 0; k < 9; k++) skey[k] = key[k];
  double a = std::floor(z.s0 * s->frames), b = jsMax(a + 64, std::floor(z.s1 * s->frames)); int by = (int)jsRound(p[9]); nsl = 0; slices[nsl++] = a;
  if (by == 0) {
    double blk = jsMax(64, jsRound(sr * 0.01)), thr = 1.5 + (1 - p[10]) * 6, prev = 1e-6, last = a;
    for (double i = a; i + blk < b; i += blk) { double e = 0; for (double j = i; j < i + blk; j++) { double x = s->l[(int)j]; e += x * x; } e /= blk; if (e > prev * thr && e > 1e-5 && i - last > sr * 0.05) { slices[nsl++] = i; last = i; } prev = prev * 0.6 + e * 0.4; if (nsl >= 64) break; }
  } else if (by == 1) { static const double DIV[5] = { 0.25, 0.5, 1, 2, 4 }; double beats = jsMax(1, jsRound(p[15])), div = DIV[(int)clamp(jsRound(p[11]), 0, 4)], n = jsMax(1, jsRound(beats / div)), step = (b - a) / n; for (int k = 1; k < jsMin(64, n); k++) slices[nsl++] = jsRound(a + k * step); }
  else { int n = (int)clamp(jsRound(p[12]), 2, 64); double step = (b - a) / n; for (int k = 1; k < n; k++) slices[nsl++] = jsRound(a + k * step); }
  slices[nsl++] = b;
}
void Simpler::noteOn(int pt, double vel) {
  Sample* s = smp(); if (!s) return;
  int mode = (int)jsRound(p[0]), n = (int)clamp(jsRound(p[4]), 1, 32);
  double s0 = std::floor(jsMin(z.s0, z.s1) * s->frames), s1 = std::floor(jsMax(z.s0, z.s1) * s->frames); int slice = -1;
  if (mode == 2) { getSlices(s); slice = pt - 36; if (slice < 0 || slice >= nsl - 1) return; s0 = slices[slice]; s1 = slices[slice + 1];
    if (jsRound(p[13]) == 0) for (auto& x : v) if (x.on) { x.fadeOut = 0.004; x.held = false; } }
  if (p[3] > 0.5) { double k = s0; while (k < s1 - 1 && !((s->l[(int)k] <= 0 && s->l[(int)k + 1] > 0))) k++; if (k < s1 - 1) s0 = k; }
  double spread = p[51]; int copies = spread > 0.005 ? 2 : 1;
  for (int c = 0; c < copies; c++) {
    SimVoice* x = nullptr;
    if (p[5] > 0.5 && mode != 2) for (auto& o : v) if (o.on && o.pitch == pt) { x = &o; break; }
    if (!x) { for (int k = 0; k < n; k++) if (!v[k].on) { x = &v[k]; break; } if (!x) { x = &v[0]; for (int k = 1; k < n; k++) if (v[k].age < x->age) x = &v[k]; } }
    SimVoice& o = *x;
    o.on = o.held = true; o.pitch = pt; o.vel = vel; o.age = ++counter; o.s0 = s0; o.s1 = s1; o.slice = slice; o.t = 0; o.fadeOut = -1; o.fo = 1;
    o.pos = z.rev ? s1 - 1 : s0; o.tpos = o.pos; o.gp = 0; o.det = copies > 1 ? (c ? 1 : -1) * spread * 25 : 0;
    double pan = clamp(p[49] + (rnd01(seed) * 2 - 1) * p[50] + (copies > 1 ? (c ? 1 : -1) * spread : 0), -1, 1); o.rp = pan;
    o.ae.start(); o.fe.start(); o.pe.start(); if (p[38] > 0.5) o.lph = p[37] / 360; else o.lph = lastL;
    double f = midiToHz(pt); o.gf = jsRound(p[54]) > 0 && lastF != 0 ? lastF : f; lastF = f;
    for (auto& q : o.fl) { q.a = 0; q.b = 0; } for (auto& q : o.fr) { q.a = 0; q.b = 0; }
  }
}
void Simpler::noteOff(int pt) {
  int mode = (int)jsRound(p[0]);
  for (auto& x : v) if (x.on && x.held && x.pitch == pt) {
    x.held = false;
    if (mode == 1) { if (jsRound(p[6]) == 1) x.fadeOut = jsMax(0.001, p[8] * 0.001); }
    else { x.ae.release(); x.fe.release(); x.pe.release(); }
  }
}
void Simpler::read(Sample* s, double pos) {
  double i = std::floor(pos), f = pos - i; int n = s->frames;
  if (i < 0 || i >= n - 1) { ol = 0; orr = 0; return; }
  int ii = (int)i; ol = s->l[ii] + ((double)s->l[ii + 1] - s->l[ii]) * f; orr = s->r[ii] + ((double)s->r[ii + 1] - s->r[ii]) * f;
}
double Simpler::filt(SSvf* F, double x, SimVoice& vv, int ft, bool two) {
  double y = F[0].run(x, vv.g, vv.k, vv.i1), o = ft == 1 ? F[0].h : ft == 2 ? F[0].bp : ft == 3 ? x - F[0].bp * vv.k : y;
  if (two) { y = F[1].run(o, vv.g, vv.k + 0.3, vv.i2); o = ft == 1 ? F[1].h : ft == 2 ? F[1].bp : ft == 3 ? o - F[1].bp * vv.k : y; }
  return o;
}
void Simpler::render(float* L, float* R, int from, int to) {
  Sample* s = smp(); if (!s) { for (auto& x : v) x.on = false; return; }
  const int CT = 16; double dtc = CT / sr; int mode = (int)jsRound(p[0]); double gain = dblS(p[1]) * dblS(z.vol) * dblS(p[61]) * 0.8; bool loop = mode == 0 && p[2] > 0.5;
  bool warp = p[14] > 0.5; double beats = jsMax(1, p[15]), stretch = warp ? ((jsMax(z.s1, z.s0) - jsMin(z.s1, z.s0)) * s->frames / sr) / (beats * 60 / bpm) : 1; bool wBeats = warp && jsRound(p[16]) == 1;
  double lfoHz = p[32] > 0.5 ? bpm / 60 / SIM_SYNC[(int)clamp(jsRound(p[34]), 0, 6)] : p[33];
  lastL = std::fmod(lastL + lfoHz * (to - from) / sr, 1);
  double glide = jsRound(p[54]) > 0 && p[55] > 0 ? std::exp(-dtc / (p[55] * 0.001)) : 0; int ftype = (int)jsRound(p[18]); bool two = jsRound(p[19]) == 1; int circ = (int)jsRound(p[20]); bool fon = p[17] > 0.5;
  for (auto& x : v) {
    if (!x.on) continue;
    for (int i = from; i < to; i++) {
      if (x.cnt-- <= 0) {
        x.cnt = CT - 1; x.t += dtc;
        double ae = mode == 1 ? 1 : x.ae.step(p[56] * 0.001, p[57] * 0.001, p[58], p[59] * 0.001, dtc);
        if (mode != 1 && x.ae.st == 0) { x.on = false; break; }
        if (x.fadeOut >= 0) { x.fo -= dtc / jsMax(0.001, x.fadeOut); if (x.fo <= 0) { x.on = false; break; } }
        double fe = x.fe.step(p[26] * 0.001, p[27] * 0.001, p[28], p[29] * 0.001, dtc), pe = p[43] > 0.5 ? x.pe.step(p[45] * 0.001, p[46] * 0.001, p[47], p[48] * 0.001, dtc) * p[44] : 0;
        x.lph += lfoHz * std::pow(2, p[36] * (x.pitch - 60) / 12) * dtc; if (x.lph >= 1) { x.lph -= std::floor(x.lph); x.lsh = rnd01(seed) * 2 - 1; }
        double fade = p[35] > 0 ? jsMin(1, x.t / (p[35] * 0.001)) : 1; int lw = (int)jsRound(p[31]); double xx = x.lph - std::floor(x.lph);
        double lfo = p[30] > 0.5 ? (lw == 1 ? (xx < 0.5 ? 1 : -1) : lw == 2 ? 1 - 4 * std::fabs(xx - 0.5) : lw == 3 ? 1 - 2 * xx : lw == 4 ? 2 * xx - 1 : lw == 5 ? x.lsh : std::sin(TWO_PI * xx)) * fade : 0;
        double f = midiToHz(x.pitch); x.gf = glide != 0 ? f + (x.gf - f) * glide : f;
        double st = (mode == 2 ? 0 : 12 * std::log2(x.gf / midiToHz(z.root))) + p[52] + (p[53] + x.det) / 100 + pe + lfo * p[40] * 12 + bend;
        x.rate = std::pow(2, st / 12) * (warp && !wBeats ? stretch : 1); x.span = wBeats ? stretch : 1;
        double fc = clamp(p[21] * std::pow(2, fe * p[25] * 6 + p[23] * (x.vel - 0.5) * 4 + p[24] * (x.pitch - 60) / 12 + lfo * p[42] * 3), 20, sr * 0.45);
        x.g = std::tan(PI * fc / sr); x.k = 2 - 1.95 * p[22]; x.i1 = 1 / (1 + x.g * (x.g + x.k)); x.i2 = 1 / (1 + x.g * (x.g + x.k + 0.3));
        double fi = 1; if (mode == 1) { double pos0 = std::fabs(x.tpos - (z.rev ? x.s1 : x.s0)) / sr, rem = std::fabs((z.rev ? x.s0 : x.s1) - x.tpos) / sr; fi = jsMin(jsMin(1, p[7] > 0 ? pos0 / (p[7] * 0.001) : 1), p[8] > 0 ? rem / (p[8] * 0.001) : 1); }
        x.amp = ae * fi * x.fo * gain * (1 - p[60] + p[60] * x.vel) * clamp(1 + lfo * p[39], 0, 2);
        double pan = clamp(x.rp + lfo * p[41], -1, 1); x.pl = jsMin(1, 1 - pan); x.pr = jsMin(1, 1 + pan);
      }
      double dir = z.rev ? -1 : 1, l, r;
      if (x.span != 1) {
        double G = jsRound(sr * 0.05); x.tpos += dir * x.span; x.gp += 1; if (x.gp >= G) x.gp = 0;
        double a = x.gp / G, o1 = x.tpos + dir * x.gp * (x.rate - x.span), o2 = x.tpos + dir * std::fmod(x.gp + G / 2, G) * (x.rate - x.span), w1 = std::sin(PI * a), w2 = std::sin(PI * std::fmod(a + 0.5, 1));
        read(s, o1); l = ol * w1; r = orr * w1; read(s, o2); l += ol * w2; r += orr * w2;
      } else { x.tpos += dir * x.rate; read(s, x.tpos); l = ol; r = orr; }
      double lenF = x.s1 - x.s0;
      if (loop) { double la = x.s0 + jsMin(z.l0, z.l1) * lenF, lb = x.s0 + jsMax(z.l0, z.l1) * lenF, ll = jsMax(64, lb - la), xfN = z.xf * ll * 0.5;
        if (dir > 0 && x.tpos >= lb) x.tpos -= ll; else if (dir < 0 && x.tpos <= la) x.tpos += ll;
        if (xfN > 1) { double d2 = dir > 0 ? lb - x.tpos : x.tpos - la; if (d2 < xfN) { double w = d2 / xfN; read(s, x.tpos - dir * ll); l = l * w + ol * (1 - w); r = r * w + orr * (1 - w); } } }
      else if ((dir > 0 && x.tpos >= x.s1) || (dir < 0 && x.tpos <= x.s0)) { x.on = false; break; }
      if (fon) {
        if (circ) { static const double DD[5] = { 1, 1.6, 2.4, 1.2, 3 }; double d = DD[circ]; l = std::tanh(l * d) / d * (circ == 3 ? 1.2 : 1); r = std::tanh(r * d) / d * (circ == 3 ? 1.2 : 1); }
        l = filt(x.fl, l, x, ftype, two); r = filt(x.fr, r, x, ftype, two);
      }
      L[i] = (float)(L[i] + l * x.amp * x.pl); R[i] = (float)(R[i] + r * x.amp * x.pr);
    }
  }
}

}  // namespace mdaw
