// Port of js/engine/flmsyn.js (FL Studio Mobile instruments: DirectWave 30, GMS 31, MiniSynth 32, SuperSaw 33).
// Same rules as the rest of the C++ engine (jsmath.h): scalar maths in double, buffers in float, JS operation order kept, no FMA.
// The JS file is the reference; this must render sample-for-sample identically (golden flm-*).
#pragma once
#include "dsp.h"
#include "units.h"
#include <vector>
#include <cmath>

namespace mdaw {

// ---- shared scalar helpers (flmsyn.js top) --------------------------------------------------------
inline double flmSyncBeats(double i) {
  static const double SB[12] = {32, 16, 8, 4, 2, 1, 0.75, 0.5, 1.0 / 3, 0.25, 1.0 / 6, 0.125};
  int k = (int)clamp(jsRound(i), 0, 11); return SB[k];
}
inline double cutHz(double x) { return 20 * std::pow(1000.0, clamp(x, 0, 100) / 100); }
inline double flmDbg(double db) { return db <= -60 ? 0 : std::pow(10.0, db / 20); }
inline double jsSign(double x) { return x > 0 ? 1 : x < 0 ? -1 : x; }   // Math.sign (0 and NaN pass through close enough for our use)
constexpr int FLM_CR = 32;                                             // control rate

// zero-delay-feedback state variable filter (flmsyn.js Svf): mode 0 LP, 1 HP, 2 BP
struct Svf {
  double a = 0, b = 0, a1 = 1, a2 = 0, a3 = 0, k = 2;
  void reset() { a = b = 0; }
  void set(double sr, double f, double res) {
    double g = std::tan(PI * clamp(f, 16, sr * 0.45) / sr);
    k = 2 - 1.97 * clamp(res, 0, 1); a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
  }
  void copyCoef(const Svf& o) { a1 = o.a1; a2 = o.a2; a3 = o.a3; k = o.k; }   // JS: s2.a1 = s1.a1; ...
  double run(double x, int mode) {
    double v3 = x - b, v1 = a1 * a + a2 * v3, v2 = b + a2 * a + a3 * v3;
    a = 2 * v1 - a; b = 2 * v2 - b;
    return mode == 0 ? v2 : mode == 1 ? x - k * v1 - v2 : v1 * k;
  }
};

// ---- FLM built-in effects (flmsyn.js Delay / ModDelay / Phaser / Reverb / decimate) ---------------
struct FlmDelay {
  double sr; int n; std::vector<float> l, r; int w = 0; double zl = 0, zr = 0;
  FlmDelay(double rate, double sec = 4) : sr(rate), n((int)std::ceil(rate * sec)), l(n, 0), r(n, 0) {}
  void clear() { std::fill(l.begin(), l.end(), 0.f); std::fill(r.begin(), r.end(), 0.f); zl = zr = 0; }
  void run(float* L, float* R, int from, int to, double time, double fb, double damp, double mix, bool ping = false) {
    int d = (int)clamp(jsRound(time), 1, n - 1); double c = 1 - clamp(damp, 0, 0.98);
    for (int i = from; i < to; i++) {
      int j = w - d; if (j < 0) j += n;
      double yl = l[j], yr = r[j];
      zl += (yl - zl) * c; zr += (yr - zr) * c;
      double xl = L[i], xr = R[i];
      l[w] = (float)(xl + (ping ? zr : zl) * fb); r[w] = (float)(xr + (ping ? zl : zr) * fb);
      if (++w >= n) w = 0;
      L[i] = (float)(xl * (1 - mix * 0.5) + yl * mix); R[i] = (float)(xr * (1 - mix * 0.5) + yr * mix);
    }
  }
};
struct FlmModDelay {
  double sr; int n; std::vector<float> l, r; int w = 0; double ph = 0;
  FlmModDelay(double rate) : sr(rate), n((int)std::ceil(rate * 0.05)), l(n, 0), r(n, 0) {}
  void clear() { std::fill(l.begin(), l.end(), 0.f); std::fill(r.begin(), r.end(), 0.f); }
  double rd(std::vector<float>& buf, double d) { double p = w - d; while (p < 0) p += n; int i = (int)p; double f = p - i; int j = i + 1 >= n ? 0 : i + 1; return buf[i] + (buf[j] - buf[i]) * f; }
  void run(float* L, float* R, int from, int to, double hz, double base, double depth, double fb, double mix) {
    double inc = hz / sr;
    for (int i = from; i < to; i++) {
      ph += inc; if (ph >= 1) ph -= 1;
      double dl = (base + depth * (0.5 + 0.5 * std::sin(TWO_PI * ph))) * sr, dr = (base + depth * (0.5 + 0.5 * std::cos(TWO_PI * ph))) * sr;
      double yl = rd(l, dl), yr = rd(r, dr), xl = L[i], xr = R[i];
      l[w] = (float)(xl + yl * fb); r[w] = (float)(xr + yr * fb);
      if (++w >= n) w = 0;
      L[i] = (float)(xl * (1 - mix * 0.5) + yl * mix); R[i] = (float)(xr * (1 - mix * 0.5) + yr * mix);
    }
  }
};
struct FlmPhaser {
  double sr; double zl[6] = {}, zr[6] = {}; double ph = 0, fl = 0, fr = 0;
  FlmPhaser(double rate) : sr(rate) {}
  void clear() { for (int i = 0; i < 6; i++) zl[i] = zr[i] = 0; fl = fr = 0; }
  void run(float* L, float* R, int from, int to, double hz, double f0, double width, double fb, double mix) {
    for (int i = from; i < to; i += FLM_CR) {
      int e = (int)jsMin(to, i + FLM_CR); ph += hz * (e - i) / sr; if (ph >= 1) ph -= std::floor(ph);
      double s = 0.5 + 0.5 * std::sin(TWO_PI * ph), fc = clamp(f0 * std::pow(2.0, width * 5 * s), 30, sr * 0.45), t = std::tan(PI * fc / sr), a = (t - 1) / (t + 1);
      for (int k = i; k < e; k++) {
        double xl = L[k] + fl * fb, xr = R[k] + fr * fb;
        for (int st = 0; st < 6; st++) { double yl = a * xl + zl[st]; zl[st] = xl - a * yl; xl = yl; double yr = a * xr + zr[st]; zr[st] = xr - a * yr; xr = yr; }
        fl = xl; fr = xr;
        L[k] = (float)(L[k] * (1 - mix * 0.5) + xl * mix); R[k] = (float)(R[k] * (1 - mix * 0.5) + xr * mix);
      }
    }
  }
};
struct FlmReverb {
  struct Comb { std::vector<float> b; int i = 0; double z = 0; };
  struct Ap { std::vector<float> b; int i = 0; };
  Comb c[2][4]; Ap ap[2][2];
  FlmReverb(double sr) {
    static const int RV_C[4] = {1116, 1188, 1277, 1356}, RV_A[2] = {556, 441};
    double s = sr / 44100;
    for (int ch = 0; ch < 2; ch++) {
      for (int j = 0; j < 4; j++) c[ch][j].b.assign((size_t)jsMax(1, jsRound((RV_C[j] + ch * 23) * s)), 0.f);
      for (int j = 0; j < 2; j++) ap[ch][j].b.assign((size_t)jsMax(1, jsRound((RV_A[j] + ch * 23) * s)), 0.f);
    }
  }
  void clear() { for (int ch = 0; ch < 2; ch++) { for (int j = 0; j < 4; j++) { std::fill(c[ch][j].b.begin(), c[ch][j].b.end(), 0.f); c[ch][j].z = 0; } for (int j = 0; j < 2; j++) std::fill(ap[ch][j].b.begin(), ap[ch][j].b.end(), 0.f); } }
  void run(float* L, float* R, int from, int to, double size, double wet) {
    double fb = 0.7 + 0.28 * clamp(size, 0, 1), damp = 0.25;
    for (int i = from; i < to; i++) {
      double x = ((double)L[i] + R[i]) * 0.15;
      for (int ch = 0; ch < 2; ch++) {
        double y = 0;
        for (int j = 0; j < 4; j++) { Comb& q = c[ch][j]; double o = q.b[q.i]; q.z = o * (1 - damp) + q.z * damp; q.b[q.i] = (float)(x + q.z * fb); if ((size_t)++q.i >= q.b.size()) q.i = 0; y += o; }
        for (int j = 0; j < 2; j++) { Ap& q = ap[ch][j]; double o = q.b[q.i]; double vv = -y + o; q.b[q.i] = (float)(y + o * 0.5); if ((size_t)++q.i >= q.b.size()) q.i = 0; y = vv; }
        if (ch) R[i] = (float)(R[i] * (1 - wet * 0.5) + y * wet); else L[i] = (float)(L[i] * (1 - wet * 0.5) + y * wet);
      }
    }
  }
};
struct Decim { double c = 0, l = 0, r = 0; };
inline void decimate(Decim& st, float* L, float* R, int from, int to, double amt) {
  if (amt <= 0) return;
  double hold = 1 + amt * 31, bits = std::pow(2.0, 16 - amt * 12);
  for (int i = from; i < to; i++) { if (++st.c >= hold) { st.c = 0; st.l = jsRound(L[i] * bits) / bits; st.r = jsRound(R[i] * bits) / bits; } L[i] = (float)st.l; R[i] = (float)st.r; }
}

// oscillator helpers (flmsyn.js) -----------------------------------------------------------------
inline double flmSaw(double ph, double dt) { return 2 * ph - 1 - polyBlep(ph, dt); }
inline double flmPulse(double ph, double dt, double w) { double p2 = ph + 1 - w; if (p2 >= 1) p2 -= 1; return (2 * ph - 1 - polyBlep(ph, dt)) - (2 * p2 - 1 - polyBlep(p2, dt)) + (1 - 2 * w); }
inline double flmPulseZ(double ph, double dt, double w) { if (w <= 1e-4) return 0; double p2 = ph + 1 - w; if (p2 >= 1) p2 -= 1; return (2 * ph - 1 - polyBlep(ph, dt)) - (2 * p2 - 1 - polyBlep(p2, dt)); }
inline double miniPw(double m) { return 0.5 - std::fabs(clamp(m, 0, 1) - 0.5); }
inline double miniSt(double m) { return (clamp(m, 0, 1) - 0.5) * 48; }
inline double miniPhaserBeats(double s) { static const double PB[10] = {32, 16, 8, 4, 2, 1, 0.75, 0.5, 1.0 / 3, 0.25}; int k = (int)clamp(jsRound(clamp(s, 0, 100) / 100 * 9), 0, 9); return PB[k]; }
inline const double* SS_OFF() { static const double a[8] = {0, -1, 1, -0.6, 0.6, -0.3, 0.3, -0.85}; return a; }
inline const double* SS_PAN() { static const double a[8] = {0, -0.9, 0.9, -0.55, 0.55, -0.25, 0.25, 0.7}; return a; }

// ---- voice base (flmsyn.js class Voices): poly / mono / legato / slide / polySlide ----------------
struct FlmVoice { bool on = false, held = false; int pitch = 0; double vel = 0; uint32_t age = 0; double t0 = 0; double f = 440, ft = 440, gl = 1; Adsr env; double lp = 0, lt = 0, lr = 0; };

template <class V>
inline void lfoAdvance(V& v, int n, double hz, double sr) { v.lp += hz * n / sr; v.lt += n / sr; }
template <class V>
inline double lfoValue(V& v, int shape, bool oneShot, double attack, uint32_t& rng) {
  double p = v.lp;
  if (oneShot && p >= 1) p = 0.9999;
  else if (p >= 1) { double w = std::floor(p); p -= w; v.lp = p; if (shape == 3) v.lr = ((double)lcg(rng) / 2147483648.0) - 1; }
  double x = shape == 0 ? std::sin(TWO_PI * p) : shape == 1 ? 1 - 2 * p : shape == 2 ? (p < 0.5 ? 1 : -1) : v.lr;
  return attack > 0.0005 ? x * jsMin(1, v.lt / attack) : x;
}

template <class V, int NV>
class FlmVoices : public Instrument {
 public:
  double sr; uint32_t counter = 0; uint32_t rng = 9137; double bpm = 120, bendSt = 0, pb = 2; int max = NV;
  bool mono = false, legato = false; double slide = 0; bool constSlide = true; double lastF = 0; bool polySlide = false; double clock = 0, tail = 0;
  struct Stk { int p; double vel; }; Stk stack[32]; int nstack = 0;
  V v[NV];
  explicit FlmVoices(double rate) : sr(rate) {}
  virtual void start(V& vv, bool retrig) = 0;
  virtual void release(V& vv) { vv.env.release(); }
  void setTempo(double b) override { bpm = clamp(b, 20, 400); }
  bool hasSetBend() override { return true; }
  void setBend(double st) override { bendSt = st / 2 * pb; }
  bool active() override { for (auto& x : v) if (x.on) return true; return false; }
  int voicesOn() override { int n = 0; for (auto& x : v) if (x.on) n++; return n; }
  V& pick() {
    int k = -1, n = (int)jsMin(max, NV);
    for (int i = 0; i < n; i++) if (!v[i].on) { k = i; break; }
    if (k < 0) { k = 0; for (int i = 1; i < n; i++) if (v[i].age < v[k].age) k = i; }
    return v[k];
  }
  double glideCoef(double from, double to) {
    double t = constSlide ? slide : slide * std::fabs(std::log2(to / from));
    return t < 0.0005 ? 1 : 1 - std::exp(-1 / (t * sr / 4));
  }
  void stackRemove(int p) { int w = 0; for (int i = 0; i < nstack; i++) if (stack[i].p != p) stack[w++] = stack[i]; nstack = w; }
  void noteOn(int p, double vel) override {
    if (mono) {
      stackRemove(p); if (nstack < 32) { stack[nstack].p = p; stack[nstack].vel = vel; nstack++; }
      V* cur = nullptr; for (auto& o : v) if (o.on && o.held) { cur = &o; break; }
      if (cur) {
        double ft = midiToHz(p); cur->gl = glideCoef(cur->f, ft); cur->ft = ft; cur->pitch = p; cur->vel = vel; lastF = ft;
        if (!legato) start(*cur, true);
        return;
      }
      for (auto& o : v) if (o.on) { o.held = false; o.env.release(); }
      double from = slide > 0 && !legato ? (v[0].on ? v[0].f : lastF) : 0;
      begin(v[0], p, vel, from); return;
    }
    double from = 0;
    if (polySlide && slide > 0) { V* b = nullptr; for (auto& o : v) if (o.on && o.held && o.t0 < clock && (!b || o.age > b->age)) b = &o; if (b) from = b->f; }
    begin(pick(), p, vel, from);
  }
  void begin(V& vv, int p, double vel, double fromF) {
    vv.on = vv.held = true; vv.pitch = p; vv.vel = vel; vv.age = ++counter; vv.t0 = clock; vv.ft = midiToHz(p);
    if (fromF > 0) { vv.f = fromF; vv.gl = glideCoef(fromF, vv.ft); } else { vv.f = vv.ft; vv.gl = 1; }
    lastF = vv.ft;
    start(vv, false);
  }
  void noteOff(int p) override {
    if (mono) {
      stackRemove(p);
      V* cur = nullptr; for (auto& o : v) if (o.on && o.held && o.pitch == p) { cur = &o; break; }
      if (!cur) return;
      if (nstack) { Stk t = stack[nstack - 1]; double ft = midiToHz(t.p); cur->gl = glideCoef(cur->f, ft); cur->ft = ft; cur->pitch = t.p; lastF = ft; if (!legato) start(*cur, true); return; }
      cur->held = false; release(*cur); return;
    }
    for (auto& vv : v) if (vv.on && vv.held && vv.pitch == p) { vv.held = false; release(vv); }
  }
  void allOff() override { nstack = 0; for (auto& vv : v) if (vv.on) { vv.held = false; release(vv); } }
};

template <class T> inline void tailOf(T* o, int n) { bool on = false; for (auto& v : o->v) if (v.on) { on = true; break; } o->tail = on ? o->sr * 6 : jsMax(0, o->tail - n); }

// ================================================================================================ MiniSynth (32)
struct MiniFlmVoice : FlmVoice { double ph[8] = {}; Adsr fenv; Svf s1, s2; };
class FlmMiniSynth : public FlmVoices<MiniFlmVoice, 8> {
 public:
  double p[48] = {}; AdsrP ap, fp;
  std::vector<float> bufL, bufR; FlmDelay dl; FlmModDelay ch; FlmPhaser phs; Decim dec;
  explicit FlmMiniSynth(double sr);
  void setParam(int i, double x) override;
  void start(MiniFlmVoice& v, bool retrig) override;
  void release(MiniFlmVoice& v) override { v.env.release(); v.fenv.release(); }
  bool active() override { return FlmVoices::active() || tail > 0; }
  void render(float* L, float* R, int from, int to) override;
};

// ================================================================================================ SuperSaw (33)
struct SawFlmVoice : FlmVoice { double ph[9] = {}, sp[9] = {}, sub = 0; Adsr fenv, senv; Svf s1, s2; double dir = 1; };
struct FlmArp { struct H { int p; double vel; }; H held[16]; int nheld = 0; double pos = 0; int step = 0; int note = -1; double vel = 0;
  // mode 1 up, 2 down, 3 up/down, 4 random, 5 up/down 2; returns {p,vel} via out, or false
  bool next(int mode, int range, uint32_t& rng, int& outP, double& outVel) {
    // sort held by pitch (stable, small n)
    H seq[16]; int n = nheld; for (int i = 0; i < n; i++) seq[i] = held[i];
    for (int i = 1; i < n; i++) { H t = seq[i]; int j = i - 1; while (j >= 0 && seq[j].p > t.p) { seq[j + 1] = seq[j]; j--; } seq[j + 1] = t; }
    int total = n * range; if (!total) return false;
    int idx;
    if (mode == 1) idx = step % total;
    else if (mode == 2) idx = total - 1 - (step % total);
    else if (mode == 3) { int cyc = (int)jsMax(1, total * 2 - 2), q = step % cyc; idx = q < total ? q : cyc - q; }
    else if (mode == 5) { int cyc = total * 2, q = step % cyc; idx = q < total ? q : cyc - 1 - q; }
    else idx = (int)((lcg(rng) >> 8) % (uint32_t)total);
    step++;
    outP = (int)jsMin(127, seq[idx % n].p + 12 * (int)std::floor((double)idx / n)); outVel = seq[idx % n].vel; return true;
  }
};
class FlmSuperSaw : public FlmVoices<SawFlmVoice, 16> {
 public:
  double p[60] = {}; AdsrP ap, fp, sp; FlmArp arp; int lastPitch = 60;
  std::vector<float> bufL, bufR; FlmDelay dl; double uOff[9] = {}, uPan[9] = {};
  bool playing = false; double beat0 = 0; int blk = 0;
  explicit FlmSuperSaw(double sr);
  void setParam(int i, double x) override;
  void start(SawFlmVoice& v, bool retrig) override;
  void release(SawFlmVoice& v) override { v.env.release(); v.fenv.release(); v.senv.release(); }
  void noteOn(int p, double vel) override;
  void noteOff(int p) override;
  void allOff() override { FlmVoices::allOff(); arp.note = -1; }
  bool active() override { return FlmVoices::active() || tail > 0 || ((int)jsRound(p[51]) > 0 && arp.nheld > 0); }
  void setSongPos(bool pl, double beat) override { playing = pl; beat0 = beat; blk = 0; }
  void render(float* L, float* R, int from, int to) override;
  void renderVoices(float* L, float* R, int from, int to);
};

}  // namespace mdaw
