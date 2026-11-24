// Ports of js/engine/ds.js, phys.js, impulse.js, granulator.js. Keep each class in step with its JS original.
#include "inst_live.h"

namespace mdaw {

// ============================================================================================== Drum Synths
void DsBase::render(float* L, float* R, int from, int to) {
  double vol = jsDbl(p[n - 1]), dt = 1 / sr;
  for (int j = v.n - 1; j >= 0; j--) {
    DsVoice& x = v.at(j);
    for (int i = from; i < to; i++) { tick(x, dt); L[i] = (float)(L[i] + o0 * vol * x.vel); R[i] = (float)(R[i] + o1 * vol * x.vel); x.t += dt; }
    if (x.t > x.life) v.erase(j);
  }
}
void DsKick::voice(DsVoice& x) { x.ph = 0; x.life = p[1] * 6 + 0.05; x.lp = 0; }
void DsKick::tick(DsVoice& v, double dt) {
  double f = p[0] * (1 + p[3] * 6 * std::exp(-v.t * 40));
  v.ph += f * dt; double env = std::exp(-v.t * 4.6 / p[1]);
  double x = std::sin(TWO_PI * v.ph) + p[2] * 0.6 * std::sin(TWO_PI * v.ph * 2) * std::exp(-v.t * 12);
  if (p[6] > 0.5 && v.t < 0.012) { double c = nzLcg(seed) * (1 - v.t / 0.012); v.lp += (c - v.lp) * 0.5; x += v.lp * p[5] * 1.6; }
  x *= env; double dr = 1 + p[4] * 9; x = std::tanh(x * dr) / std::tanh(dr) * 0.9;
  o0 = o1 = x;
}
void DsSnare::voice(DsVoice& x) { x.life = p[1] * 6 + 0.05; x.fl.set(sr, p[3], 0.9); x.fr.set(sr, p[3], 0.9); }
static inline double pickF(const DSvf& f, int type, double lo) { return type == 1 ? f.hp : type == 2 ? f.bp : lo; }
void DsSnare::tick(DsVoice& v, double dt) {
  int ty = (int)jsRound(p[4]); double f = p[0] * (1 + 0.4 * std::exp(-v.t * 60));
  v.ph += f * dt; v.ph2 += f * 1.47 * dt;
  double body = (std::sin(TWO_PI * v.ph) + 0.5 * std::sin(TWO_PI * v.ph2)) * std::exp(-v.t * 4.6 / (p[1] * 0.5));
  double nn = nzLcg(seed), eN = std::exp(-v.t * 4.6 / p[1]);
  double lo = v.fl.run(nn), nl = ty ? pickF(v.fl, ty, lo) : lo;
  v.d[v.w & 63] = (float)nn; double nd = v.d[(v.w - 23) & 63]; v.w++;
  double ro = v.fr.run(nn * (1 - p[5]) + nd * p[5]), nr = ty ? pickF(v.fr, ty, ro) : ro;
  double b = body * (1 - p[2]) * 0.8;
  o0 = std::tanh(b + nl * p[2] * eN * 1.2); o1 = std::tanh(b + nr * p[2] * eN * 1.2);
}
void DsTom::voice(DsVoice& x) { x.life = p[1] * 6 + 0.05; x.fl.set(sr, p[0] * 4, 1.5); }
void DsTom::tick(DsVoice& v, double dt) {
  double f = p[0] * (1 + p[3] * 1.5 * std::exp(-v.t * 9));
  v.ph += f * dt; v.ph2 += f * 1.59 * dt;
  double e = std::exp(-v.t * 4.6 / p[1]);
  double a = (std::sin(TWO_PI * v.ph) + p[2] * 0.45 * std::sin(TWO_PI * v.ph2)) * e;
  double x = a + v.fl.run(nzLcg(seed)) * p[2] * std::exp(-v.t * 80) * 1.5;
  o0 = o1 = std::tanh(x);
}
static const double HH_R[6] = { 1, 1.342, 1.2312, 1.6532, 1.9523, 2.1523 };
void DsHH::voice(DsVoice& x) { x.life = p[1] * 6 + 0.03; x.fl.set(sr, p[2], 0.8); }
void DsHH::tick(DsVoice& v, double dt) {
  int ty = (int)jsRound(p[3]); double m = 0;
  for (int k = 0; k < 6; k++) { v.ph6[k] += p[0] * HH_R[k] * dt; m += (jsMod(v.ph6[k], 1) < 0.5 ? 1 : -1); }
  double src = ty == 0 ? m / 6 : ty == 1 ? nzLcg(seed) : (m / 6 + nzLcg(seed)) * 0.5;
  v.fl.run(src);
  o0 = o1 = v.fl.hp * std::exp(-v.t * 4.6 / p[1]) * 1.4;
}
void DsClap::voice(DsVoice& x) { x.life = p[1] * 6 + 0.1; double q = 0.6 + (1 - p[2]) * 4; x.fl.set(sr, p[0], q); x.fr.set(sr, p[0] * (1 + p[3] * 0.25), q); }
void DsClap::tick(DsVoice& v, double dt) {
  double gap = 0.006 + p[4] * 0.02, e = 0;
  for (int k = 0; k < 4; k++) { double t0 = k * gap; if (v.t >= t0) e += std::exp(-(v.t - t0) * 160) * (k == 3 ? 1 : 0.8); }
  e += p[5] * std::exp(-v.t * 4.6 / p[1]) * 0.6;
  double n1 = nzLcg(seed), n2 = nzLcg(seed);
  v.fl.run(n1); v.fr.run(n1 * (1 - p[3]) + n2 * p[3]);
  o0 = v.fl.bp * e * 2.2; o1 = v.fr.bp * e * 2.2;
}
void DsFm::voice(DsVoice& x) { x.pc = x.pm = x.fb = x.fm = x.lp = 0; x.life = p[1] * 6 + 0.05; }
void DsFm::tick(DsVoice& v, double dt) {
  double e = std::exp(-v.t * 4.6 / p[1]), em = std::exp(-v.t * 4.6 / (p[1] * 0.5));
  v.pm += p[0] * p[3] * dt; double m = std::sin(TWO_PI * v.pm + v.fb * p[4] * 1.5); v.fb = (m + v.fm) * 0.5; v.fm = m;
  v.pc += p[0] * dt; double x = std::sin(TWO_PI * v.pc + m * p[2] * 8 * em) * e;
  double a = 1 - std::exp(-TWO_PI * (200 + p[5] * p[5] * 18000) * dt); v.lp += (x - v.lp) * a;
  o0 = o1 = v.lp;
}

// ============================================================================================== physical models
void PhysBase::noteOn(int pitch, double vel) {
  if (v.n >= 8) v.erase(0);
  float* keep = nullptr; PhVoice& x = v.push(); keep = x.buf; x = PhVoice(); x.buf = keep;
  voice(x, pitch, vel); x.pitch = pitch; x.vel = vel; x.on = true; x.t = 0; x.amp = 1;
}
void PhysBase::render(float* L, float* R, int from, int to) {
  double vol = jsDbl(p[n - 1]), dt = 1 / sr, rel = relGain();
  for (int j = v.n - 1; j >= 0; j--) {
    PhVoice& x = v.at(j); double peak = 0;
    for (int i = from; i < to; i++) {
      double y = tick(x, dt) * x.amp * vol; if (!x.on) x.amp *= rel;
      L[i] = (float)(L[i] + y * 1); R[i] = (float)(R[i] + y * 1); x.t += dt; double a = std::fabs(y); if (a > peak) peak = a;
    }
    if ((x.t > 0.05 && peak < 1e-5) || x.amp < 1e-5 || x.t > 30) v.erase(j);
  }
}
// ---- Electric
double Electric::relGain() { return t60(0.02 + p[11] * 2, sr); }
void Electric::voice(PhVoice& v, int pitch, double vel) {
  double f = midiToHz(pitch), key = (pitch - 60) / 48.0;
  double stiff = clamp(p[0] + (vel - 0.5) * p[6], 0, 1), force = (0.3 + 0.7 * p[7]) * clamp(1 + (vel - 0.5) * 2 * p[8], 0.1, 2);
  v.f = f; v.ph = v.ph2 = v.ph3 = 0; v.force = force; v.stiff = stiff; v.nl = 0;
  v.gT = t60((0.4 + p[2] * 3.5) * (1 - key * 0.6), sr); v.gB = t60((1 + p[3] * 6) * (1 - key * 0.5), sr); v.gO = t60(0.05 + 0.25 * (1 - stiff), sr);
  v.eT = v.eB = v.eO = v.eN = 1; v.gN = t60(0.004 + p[10] * 0.08, sr); v.nc = 1 - std::exp(-TWO_PI * (300 + p[9] * p[9] * 9000) / sr);
}
double Electric::tick(PhVoice& v, double dt) {
  v.ph += v.f * dt; v.ph2 += v.f * 7.11 * dt; v.ph3 += v.f * 0.5 * dt;
  v.eT *= v.gT; v.eB *= v.gB; v.eO *= v.gO; v.eN *= v.gN;
  double tine = std::sin(TWO_PI * v.ph) * v.eT * (0.3 + p[2] * 0.7), bar = std::sin(TWO_PI * v.ph) * v.eB * p[3] * 0.6 + std::sin(TWO_PI * v.ph3) * v.eB * p[3] * 0.15;
  double over = std::sin(TWO_PI * v.ph2) * v.eO * v.stiff * 0.7;
  v.nl += (nzLcg(seed) - v.nl) * v.nc; double noise = v.nl * v.eN * p[1] * 0.8;
  double x = (tine + bar + over) * v.force + noise * v.force;
  double s = p[4] * 2 - 1;
  x = jsRound(p[5]) == 0 ? std::tanh(x * 1.6 + s * x * x) * 0.6 : (x + s * 0.7 * x * std::fabs(x) + 0.25 * x * x * x) * 0.5;
  return x;
}
// ---- Tension
Tension::Tension(double r) : PhysBase(r, 17) { store = new float[(size_t)9 * TBUF]; for (int k = 0; k < 9; k++) v.pool[k].buf = store + (size_t)k * TBUF; }
double Tension::relGain() { return t60(0.15, sr); }
void Tension::voice(PhVoice& v, int pitch, double vel) {
  double f = midiToHz(pitch), N = jsMax(4, sr / f); int size = 1 << (int)std::ceil(std::log2(N + 8)); if (size > TBUF) size = TBUF;
  std::memset(v.buf, 0, sizeof(float) * size);
  v.f = f; v.N = N; v.M = size - 1; v.w = 0; v.lp = v.ap = v.apx = v.tlp = 0;
  v.loss = std::pow(t60(0.2 + p[6] * 8, sr), N); v.damp = 0.05 + (1 - p[9]) * 0.9; v.inh = -p[8] * 0.6;
  int ty = (int)jsRound(p[0]); double len = jsMax(2, jsRound(N * (0.05 + p[1] * 0.45))), amp = (0.4 + p[3] * 1.2) * (0.4 + 0.6 * vel), sm = 0.1 + (1 - p[5]) * 0.9, y = 0;
  if (ty != 0) for (int k = 0; k < N; k++) {
    double u = k / len, sh = ty == 2 ? (u < 1 ? u : jsMax(0, 1 - (u - 1) * (1 + p[2] * 4))) : (u < 1 ? 0.5 - 0.5 * std::cos(TWO_PI * u) : 0);
    double tone = ty == 1 ? sh * (1 + p[2] * nzLcg(seed) * 0.3) : sh;
    y += (tone - y) * sm; v.buf[k] = (float)(y * amp);
  }
  int pos = (int)jsRound(N * (0.02 + p[4] * 0.48));
  if (ty != 0) { int cl = (int)std::ceil(N); std::memcpy(tmp, v.buf, sizeof(float) * cl); for (int k = 0; k < cl; k++) v.buf[k] = (float)(tmp[k] - tmp[(k + pos) % cl] * 0.9); }
  v.w = std::ceil(N); v.bowAmp = ty == 0 ? amp : 0;
}
double Tension::tick(PhVoice& v, double dt) {
  double N = v.N, r = v.w - N, i0 = std::floor(r), fr = r - i0; int ii = toInt32(i0);
  double x = v.buf[ii & v.M] * (1 - fr) + v.buf[(ii + 1) & v.M] * fr;
  v.lp += (x - v.lp) * (1 - v.damp * (0.4 + p[7] * 0.6)); x = v.lp;
  double ap = v.inh * x + v.apx - v.inh * v.ap; v.apx = x; v.ap = ap; x = ap;
  if (p[10] > 0.5) { v.tlp += (x - v.tlp) * (0.15 + (1 - p[11]) * 0.85); x = v.tlp * (0.995 - (1 - p[12]) * 0.02) + (x - v.tlp) * p[13] * 0.3; }
  x *= v.loss;
  if (v.bowAmp != 0 && v.on) { double rel = v.bowAmp * 0.3 - x, fric = rel * std::exp(-rel * rel * (2 + p[2] * 20)) * (0.2 + p[1] * 0.4); x += fric * (1 - p[5] * 0.5) + nzLcg(seed) * 0.0008; }
  int wi = toInt32(v.w); v.buf[wi & v.M] = (float)x; v.w++;
  double out = x;
  if (p[14] > 0.5) { int pd = (int)jsMax(1, jsRound(N * (0.02 + p[15] * 0.48))); out = x - v.buf[(toInt32(v.w) - 1 - pd) & v.M]; }
  return std::tanh(out * 0.9);
}
// ---- Collision
static void colRatios(int type, double ratio, double inh, double* r) {
  static const double MAR[12] = { 1, 3.9, 9.2, 13.4, 16.6, 21, 25.4, 30, 35.1, 40.3, 46, 52 }, MEM[12] = { 1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.16, 3.5, 3.6, 4.06, 4.15, 4.6 };
  for (int k = 1; k <= 12; k++) {
    double x;
    switch (type) {
      case 0: x = std::pow((2.0 * k + 1) / 3, 2); break;
      case 1: x = MAR[k - 1]; break;
      case 2: x = k; break;
      case 3: x = MEM[k - 1] * (1 + (ratio - 1) * 0.15 * ((k % 3) / 2.0)); break;
      case 4: { double a = std::ceil(k / 3.0), b = (k % 3) + 1; x = (a * a + (b * b) * ratio * ratio) / (1 + ratio * ratio); break; }
      case 5: x = 2 * k - 1; break;
      default: x = k; break;
    }
    r[k - 1] = x * (1 + inh * (x - 1) * 0.05);
  }
}
double Collision::relGain() { return t60(0.05 + p[16] * 0.1, sr); }
void Collision::voice(PhVoice& v, int pitch, double vel) {
  double f = midiToHz(pitch), rs[12]; colRatios((int)jsRound(p[15]), p[20], p[19], rs); v.nm = 0;
  for (int k = 0; k < 12; k++) {
    double fk = f * rs[k]; if (fk > sr * 0.45) break;
    double dec = p[16] / (1 + k * (1 + p[17]) * 0.6), g = t60(jsMax(0.01, dec), sr), w = TWO_PI * fk / sr;
    PhMode& m = v.m[v.nm++]; m.c1 = 2 * g * std::cos(w); m.c2 = -g * g; m.y1 = m.y2 = 0; m.a = std::pow(k + 1, -2.2 + p[18] * 2.2) * (1 - g * g) * 6;
  }
  v.nl = v.mlp = v.ne = v.sa = v.sb = 0; v.vel = vel;
  v.mw = jsMax(2, jsRound(sr * (0.0005 + (1 - p[2]) * 0.006))); v.mc = 1 - std::exp(-TWO_PI * (200 + p[4] * p[4] * 12000) / sr);
}
double Collision::tick(PhVoice& v, double dt) {
  double ex = 0;
  if (p[0] > 0.5) {
    double nn = v.t * sr, hit = nn < v.mw ? 0.5 - 0.5 * std::cos(TWO_PI * nn / v.mw) : 0;
    v.mlp += (nzLcg(seed) - v.mlp) * v.mc; hit += v.mlp * p[3] * std::exp(-v.t * 300);
    ex += hit * jsDbl(p[1]) * (0.3 + 0.7 * v.vel) * 4;
  }
  if (p[5] > 0.5) {
    double A = p[11] / 1000, D = p[12] / 1000, S = p[13], R = p[14] / 1000;
    if (v.on) v.ne = v.t < A ? v.t / jsMax(1e-4, A) : S + (1 - S) * std::exp(-(v.t - A) * 4.6 / jsMax(1e-4, D)); else v.ne *= t60(jsMax(0.001, R), sr);
    double fc = clamp(p[9] * std::pow(2, p[8] * 4 * v.ne), 30, sr * 0.45), g = std::tan(PI * fc / sr), k = 1 / p[10], inv = 1 / (1 + g * (g + k));
    double x = nzLcg(seed), h = (x - (k + g) * v.sa - v.sb) * inv, bp = g * h + v.sa, lp = g * bp + v.sb; v.sa = g * h + bp; v.sb = g * bp + lp;
    int ty = (int)jsRound(p[6]); ex += (ty == 0 ? lp : ty == 1 ? h : bp) * v.ne * jsDbl(p[7]) * 2;
  }
  double y = 0;
  for (int k = 0; k < v.nm; k++) { PhMode& m = v.m[k]; double o = m.c1 * m.y1 + m.c2 * m.y2 + ex * m.a; m.y2 = m.y1; m.y1 = o; y += o; }
  return std::tanh(y * 0.5);
}

// ============================================================================================== Impulse
void Impulse::setParam(int i, double x) {
  if (i >= 200) { int k = (i - 200) >> 4, f = (i - 200) & 15; if (k < 8 && f == 0) ids[k] = toInt32(x); return; }
  if (i >= 0 && i < 196) p[i] = x;
}
void Impulse::noteOn(int pitch, double vel) {
  int k = pitch - 60; if (k < 0 || k > 7) return; Sample* s = smp(k); if (!s) return;
  ImpVoice& x = v[k]; double st = std::floor(clamp(q(k, 0), 0, 0.99) * s->frames), fade = x.on ? 0 : 1;
  x.on = true; x.held = true; x.vel = vel; x.t = 0; x.pos = st; x.tpos = st; x.gp = 0; x.env = 1; x.a = 0; x.b = 0; x.fade = fade;
}
void Impulse::render(float* L, float* R, int from, int to) {
  double gv = jsDbl(p[0]), time = std::pow(2, p[1] * 3), dt = 1 / sr;
  for (int k = 0; k < 8; k++) {
    ImpVoice& x0 = v[k]; if (!x0.on) continue; Sample* s = smp(k); if (!s) { x0.on = false; continue; }
    double rate = std::pow(2, (q(k, 1) + p[2]) / 12), str = q(k, 2), speed = rate * std::pow(2, -str * 2), drive = q(k, 3); bool sat = q(k, 4) > 0.5, filt = q(k, 5) > 0.5;
    double dec = jsMax(0.005, q(k, 8) * time); bool gate = jsRound(q(k, 9)) == 1; double pan = q(k, 10), vol = jsDbl(q(k, 11)) * (1 - q(k, 12) * (1 - x0.vel)) * gv;
    double pl = jsMin(1, 1 - pan), pr = jsMin(1, 1 + pan), kd = std::exp(-dt * 6.91 / dec);
    double g = 0, kk = 0, inv = 1; if (filt) { g = std::tan(PI * clamp(q(k, 6), 20, sr * 0.45) / sr); kk = 1 / q(k, 7); inv = 1 / (1 + g * (g + kk)); }
    double glen = 0.04 * sr; int n = s->frames; const float* l = s->l; ImpVoice& vv = x0;
    for (int i = from; i < to; i++) {
      double x;
      if (std::fabs(str) < 0.005) { int ip = toInt32(vv.pos); if (ip >= n - 1) { vv.on = false; break; } double fr = vv.pos - ip; x = l[ip] + ((double)l[ip + 1] - l[ip]) * fr; vv.pos += rate; }
      else {
        if (vv.tpos >= n - 1) { vv.on = false; break; }
        x = 0; for (int c = 0; c < 2; c++) { double ph = jsMod((vv.gp / glen) + c * 0.5, 1), start = vv.tpos - ph * glen * speed, rp = start + ph * glen * rate, ipd = std::floor(rp);
          if (ipd >= 0 && ipd < n - 1) { int ip = (int)ipd; x += (l[ip] + ((double)l[ip + 1] - l[ip]) * (rp - ipd)) * (0.5 - 0.5 * std::cos(TWO_PI * ph)); } }
        vv.gp++; vv.tpos += speed;
      }
      if (sat) x = std::tanh(x * (1 + drive * 12)) / std::tanh(1 + drive * 12);
      if (filt) { double h = (x - (kk + g) * vv.a - vv.b) * inv, bp = g * h + vv.a, lp = g * bp + vv.b; vv.a = g * h + bp; vv.b = g * bp + lp; x = lp; }
      if (!gate || !vv.held) vv.env *= kd;
      if (vv.fade < 1) vv.fade = jsMin(1, vv.fade + dt / 0.003);
      x *= vv.env * vol * vv.fade; L[i] = (float)(L[i] + x * pl); R[i] = (float)(R[i] + x * pr);
      if (vv.env < 1e-4) { vv.on = false; break; }
    }
  }
}

// ============================================================================================== Granulator III
void Granulator::noteOn(int pitch, double vel) {
  if (!smp()) return; if (v.n >= 8) v.erase(0);
  GranVoice& x = v.push(); x = GranVoice(); x.pitch = pitch; x.vel = vel; x.held = true; x.env = 0; x.head = p[1]; x.next = 0; x.t = 0; x.rate = std::pow(2, (pitch - 60 + p[9]) / 12);
}
void Granulator::spawn(GranVoice& v, Sample* s) {
  double nn = s->frames, len = jsMax(8, jsRound(p[3] / 1000 * sr)), sp = (rndLcg(seed) * 2 - 1) * p[5] * 0.25;
  double pos = clamp(v.head + sp, 0, 1) * (nn - 1), r = v.rate * std::pow(2, (rndLcg(seed) * 2 - 1) * p[8] / 12);
  if (v.ng >= 16) { std::memmove(v.g, v.g + 1, sizeof(Grain) * (v.ng - 1)); v.ng--; }
  Grain& g = v.g[v.ng++]; g.pos = pos; g.r = r; g.i = 0; g.len = len; g.pan = (rndLcg(seed) * 2 - 1) * p[5] * 0.6;
}
void Granulator::render(float* L, float* R, int from, int to) {
  Sample* s = smp(); if (!s) { v.clear(); return; }
  double dt = 1 / sr; int mode = (int)jsRound(p[0]), n = s->frames; double vol = jsDbl(p[13]);
  double att = jsMax(0.001, p[10] / 1000), rel = std::exp(-dt * 6.91 / jsMax(0.005, p[11] / 1000)), sharp = 1 + p[4] * 6;
  double gap = mode == 2 ? sr / jsMax(1, p[6]) : jsMax(8, jsRound(p[3] / 1000 * sr * 0.5));
  const float* sl = s->l;
  for (int j = v.n - 1; j >= 0; j--) {
    GranVoice& x = v.at(j); double g0 = (1 - p[12] * (1 - x.vel)) * vol;
    for (int i = from; i < to; i++) {
      if (x.held) x.env = jsMin(1, x.env + dt / att); else x.env *= rel;
      if (mode != 2) { x.head += p[2] / n;
        if (mode == 1) { double a = p[1], b = jsMin(1, p[1] + 0.02 + p[7] * 0.5); if (x.head > b) x.head = a; if (x.head < a) x.head = b; } else x.head = clamp(x.head, 0, 1); }
      if (--x.next <= 0) { spawn(x, s); x.next = mode == 2 ? gap * (0.5 + rndLcg(seed)) : gap; }
      double l = 0, r = 0;
      for (int k = x.ng - 1; k >= 0; k--) {
        Grain& g = x.g[k]; double u = g.i / g.len, w = std::pow(0.5 - 0.5 * std::cos(TWO_PI * u), sharp), rp = g.pos + g.i * g.r; int ip = toInt32(rp);
        if (u >= 1 || ip >= n - 1 || ip < 0) { std::memmove(x.g + k, x.g + k + 1, sizeof(Grain) * (x.ng - k - 1)); x.ng--; continue; }
        double y = (sl[ip] + ((double)sl[ip + 1] - sl[ip]) * (rp - ip)) * w; l += y * (1 - g.pan); r += y * (1 + g.pan); g.i++;
      }
      double e = x.env * g0 * 0.7; L[i] = (float)(L[i] + l * e); R[i] = (float)(R[i] + r * e);
    }
    x.t += (to - from) * dt;
    if (!x.held && x.env < 1e-4) v.erase(j);
  }
}

}  // namespace mdaw
