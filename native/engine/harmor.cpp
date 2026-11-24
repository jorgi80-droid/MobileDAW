// Harmor (instrument 38): additive synthesis, MobileDAW's own DSP (see harmor.h).
//
// Partials. Every voice is a bank of sine partials, each a complex rotation oscillator (cos, sin of its running phase): the phase stays
// continuous whatever the frequency does, nothing is read from a table, and the amplitude is renormalised once per step. A partial sounds
//   out += sin(psi) * X + cos(psi) * Y,   X = a cos(phi), Y = a sin(phi)
// so its amplitude a and phase phi are two coefficients, ramped linearly over every SUB-sample step (no clicks when a level, the mix, a
// filter or the partial count changes). Timbre mix: "Mix" adds the two complex partials, "Morph" interpolates the amplitude and the
// phase direction. Partials near Nyquist fade out (0.40 .. 0.47 of the rate); above it they are not computed at all.
// Unison: up to 8 copies of the oscillator bank per voice (detune, pitch spread, pan, random start phases); the copies share the
// coefficients, so a copy costs only its oscillators.
// Filters (2), resonance, self-oscillation, formants: a gain per partial from its frequency. The curve of a filter is a table over
// octaves from its cutoff (built when its type / slope / resonance changes), so moving the cutoff (knob, articulator, LFO, key, velocity)
// only shifts where the partials read it. Formant = vowel peaks at fixed frequencies, the cutoff morphing A - E - I - O - U.
// Articulators: 10 envelopes (multi-point with curve, sustain point and loop, or AHDSR), each with a depth, evaluated per step:
// Volume, Pitch, Filter 1 / 2 cutoff, Frequency (harmonic stretch), Harmonic level (tilt), Harmonic phase, Timbre mix, (Image freq /
// gain: phase 3). Two LFOs per voice (sine, triangle, saw, square, sample & hold) on a chosen destination. Vibrato with delay.
// Mono / legato with glide. The partial count adapts to the quality (Draft / Normal / High) and to the oscillator banks sounding.
// Special processing, also per partial: Prism (partials moved off their harmonic places: scattered or shifted by Hz), Pluck (each
// partial decays, the higher ones faster), Blur (partial amplitudes smeared in time, rising and falling apart, higher partials slower),
// spectral Phaser (notches spaced in octaves sweeping across the spectrum).
// Effects: a rack of 7 MobileDAW effects (the same C++ devices a track uses) after the voices, in a chosen order, each with on / mix;
// the instrument stays active while their tail sounds.
// Partial map (image synthesis / audio resynthesis): per step the voice reads its frame (time since the note x speed, from the start
// point, held or looped, frames interpolated or not) and gives each partial the map's amplitude, mixed with the timbres by Map Mix.
// Harmonic layout: bin = partial number (with Formant on, read at the partial's frequency relative to the analysed note, so the
// spectral envelope stays in place when the note changes); log-frequency layout: bin = the partial's frequency (pitch independent).
// Frequency deviations (resynthesis) move each partial off its harmonic place (vibrato, inharmonicity); a stereo map pans every
// partial (its own left / right coefficients); the map's phases can start the note. Image Freq / Image Gain articulators shift / scale it.
#include "harmor.h"
#include "dsp.h"
#include "os.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

namespace mdaw {
namespace {

constexpr double TAU = 6.283185307179586, PI = 3.141592653589793;
constexpr int SUB = 32;                 // samples per coefficient / modulation step
constexpr int NX = HM_MAXP + 2;         // + two sub-octave partials (f0 / 2, f0 / 4)
constexpr int CAP[3] = { 64, 256, HM_MAXP }, BUDGET[3] = { 512, 2048, 8192 };   // Draft / Normal / High: partials per voice, partial-banks in all
constexpr int FT_N = 769;               // filter table: -12 .. +12 octaves from the cutoff, 32 steps an octave
constexpr double FT_LO = -12, FT_STEP = 1.0 / 32;
constexpr int FM_N = 337;               // formant table: log2 f 4 .. 14.5 (16 Hz .. 23 kHz), 32 steps an octave
constexpr double FM_LO = 4.0;

inline double clampd(double x, double a, double b) { return x < a ? a : x > b ? b : x; }
// fast sin / cos of an angle in [0, pi] (rotation per sample of a partial below Nyquist): odd polynomial to x^13, |error| < 1e-8
inline double psin(double x) { const double x2 = x * x; return x * (1 + x2 * (-1.0 / 6 + x2 * (1.0 / 120 + x2 * (-1.0 / 5040 + x2 * (1.0 / 362880 + x2 * (-1.0 / 39916800 + x2 * (1.0 / 6227020800.0))))))); }
inline void rot(double d, float& c, float& s) {   // d in [0, pi)
  const double h = PI * 0.5;
  s = (float)(d <= h ? psin(d) : psin(PI - d));
  c = (float)(d <= h ? psin(h - d) : -psin(d - h));
}
// fast 2^x (|x| < 60), relative error < 2e-7
inline double pexp2(double x) {
  double fl = std::floor(x), f = x - fl;
  double p = 1 + f * (0.6931471805599453 + f * (0.2402265069591007 + f * (0.0555041086648216 + f * (0.0096181291076285 + f * (0.0013333558146428 + f * (0.0001540353039338 + f * 0.0000152527338040))))));
  return std::ldexp(p, (int)fl);
}

inline double pcos(double a) {   // cos of a in [0, 2 pi)
  if (a > PI) a = TAU - a;
  return a <= PI * 0.5 ? psin(PI * 0.5 - a) : -psin(a - PI * 0.5);
}
inline float hash01(int k) { uint32_t h = (uint32_t)(k + 1) * 2654435761u; h ^= h >> 15; h *= 2246822519u; h ^= h >> 13; return (h >> 8) * (1.0f / 16777216.0f); }

struct Timbre {
  float a[HM_MAXP] = {}, ph[HM_MAXP] = {};          // amplitude (>= 0), phase (radians)
  float tl[HM_MAXP] = {}, tp[HM_MAXP] = {};         // the drawn table: level, phase (0..1 of a cycle)
  bool table = false;
};

// an articulator's shape, built from its parameters: points (time from the previous, level, curve), sustain point, loop start
struct EnvDef { bool on = false; double depth = 0; int n = 0, sus = -1, loop = -1; double dt[HM_ENV_PTS] = {}, lv[HM_ENV_PTS] = {}, cv[HM_ENV_PTS] = {}; };
struct EnvState { int i = 1; double t = 0, from = 0, val = 0; bool done = false, rel = false; };

struct Voice {
  bool on = false, held = false, fresh = false; int pitch = 0; double vel = 0; uint32_t age = 0; int img = 0, pImg = 0;   // img: the image this note plays
  Adsr env; double f0 = 0, fcur = 0, bend = 1, t = 0;   // f0: the note's frequency, fcur: after glide; t: seconds since the start
  int nu = 1;                                         // unison copies of this voice
  float gl[HM_UNI] = {}, gr[HM_UNI] = {}, um[HM_UNI] = {};   // per copy: pan gains, frequency ratio
  double rotF[HM_UNI] = {}, rotS = -9;                // the frequency / stretch (+ prism) the rotation coefficients were made for
  int n = 0;                                          // partials computed (the sounding ones and those fading out)
  bool dirty = true;                                  // phase vectors to rebuild (note start, timbre phase change)
  int pPitch = -1; double pVel = 0; int fade = 0;     // stealing: fade out over `fade` samples, then start the pending note
  EnvState es[HM_ENVS]; double volPrev = 0;           // articulators; the volume at the end of the last step
  double lph[2] = {}, lsh[2] = {};                    // LFO phase, sample & hold value
  float vm[NX], lvm[NX];                              // per partial: frequency multiplier, its log2
  float c[HM_UNI][NX], s[HM_UNI][NX], cr[HM_UNI][NX], sr[HM_UNI][NX];
  float X[NX], Y[NX], u[NX], e1x[NX], e1y[NX], e2x[NX], e2y[NX];
  float soC = 1, soS = 0, soX = 0;                    // self-oscillation: a sine at the filter 1 resonance
  float XR[NX], YR[NX], ldm[NX], emx[NX], emy[NX];   // map: right-channel coefficients (stereo map), log2 frequency deviation, phase vectors
  bool devPrev = false, stPrev = false; float lastEnv = 0;           // the envelope at the end of the last step (display)
  float nz[HM_NB_MAX][4] = {}, nzS[HM_NB_MAX][4] = {}, ngL[HM_NB_MAX] = {}, ngR[HM_NB_MAX] = {}; uint32_t nr[HM_NB_MAX][2] = {};   // per band: its own noise (mid, side)   // noise layer: band filter states, gains, generator
};

class Harmor : public Instrument {
 public:
  Harmor(double rate, Bank* b) : sr(rate), bank(b) {
    for (double& x : p) x = 0;
    p[HM_VOL] = 0.7; p[HM_PARTIALS] = 256; p[HM_QUALITY] = 1; p[HM_POLY_P] = 8; p[HM_GLIDE] = 0.08;
    p[HM_T_WAVE] = HM_SAW; p[HM_T_LEVEL] = 1; p[HM_T_TABLE] = -1;
    p[HM_T_WAVE + 10] = HM_SQUARE; p[HM_T_LEVEL + 10] = 1; p[HM_T_TABLE + 10] = -1;
    p[HM_ATT] = 0.005; p[HM_DEC] = 0.3; p[HM_SUS] = 0.8; p[HM_REL] = 0.3; p[HM_VELS] = 0.7; p[HM_VIB_RATE] = 5;
    for (int f = 0; f < 2; f++) { int b0 = 10 * f; p[HM_F_TYPE + b0] = HM_LP; p[HM_F_CUT + b0] = 2000; p[HM_F_WIDTH + b0] = 0.5; p[HM_F_SLOPE + b0] = 1; p[HM_F_MIX + b0] = 1; p[HM_F_TABLE + b0] = -1; }
    p[HM_U_VOICES] = 1; p[HM_U_DETUNE] = 15; p[HM_U_SPREAD] = 0.6; p[HM_U_PHASE] = 1;
    for (int l = 0; l < 2; l++) { int b0 = HM_L_STRIDE * l; p[HM_L_RATE + b0] = 2; p[HM_L_RETRIG + b0] = 1; }
    for (int e = 0; e < HM_ENVS; e++) { int b0 = HM_ENV + HM_ENV_STRIDE * e; p[b0 + 1] = e == HM_E_VOL ? 1 : 0.5; p[b0 + 3] = -1; p[b0 + 4] = -1; p[b0 + 5] = 0.01; p[b0 + 7] = 0.4; p[b0 + 8] = e == HM_E_VOL ? 0.8 : 0; p[b0 + 9] = 0.3; }
    for (int k = 0; k < HM_MAXP; k++) l2k[k] = (float)std::log2((double)(k + 1));
    l2k[HM_MAXP] = -1; l2k[HM_MAXP + 1] = -2;
    p[HM_MAP_A] = p[HM_MAP_B] = p[HM_MAP_N] = p[HM_MAP_W] = -1; p[HM_MAP_NOISE] = 1; p[HM_MAP_END] = 1; p[HM_MAP_SPEED] = 1; p[HM_MAP_LOOP] = 1; p[HM_MAP_INTERP] = 1; p[HM_MAP_FDEV] = 1; p[HM_MAP_LEVEL] = 1; p[HM_MAP_PHASE] = 1;
    for (int g = 1; g < HM_IMGS; g++) { const int b0 = HM_IMG + HM_IMG_STRIDE * (g - 1); p[b0 + HM_I_A] = p[b0 + HM_I_B] = p[b0 + HM_I_N] = p[b0 + HM_I_W] = -1; p[b0 + HM_I_END] = 1; p[b0 + HM_I_LOOP] = 1; p[b0 + HM_I_LEVEL] = 1; p[b0 + HM_I_NOISE] = 1; }
    p[HM_PLUCK_TIME] = 1; p[HM_PLUCK_DAMP] = 0.5; p[HM_SPH_DENS] = 1; p[HM_SPH_SPEED] = 0.2; p[HM_SPH_SHARP] = 0.5;
    for (int k = 0; k < HM_FX_N; k++) { p[HM_FX_ORDER + k] = k; p[HM_FX + HM_FX_STRIDE * k + 1] = 1; fx[k] = makeDevice(HM_FX_TYPES[k], sr, nullptr); }
    upOrder();
    voices = new Voice[HM_POLY];
    buildTimbre(0); buildTimbre(1); upEnv(); for (int f = 0; f < 2; f++) buildFilter(f); for (int e = 0; e < HM_ENVS; e++) buildEnv(e);
  }
  ~Harmor() override { delete[] voices; for (Device* d : fx) delete d; }

  void setTempo(double b) override { bpm = b > 0 ? b : 120; for (Device* d : fx) if (d) d->setTempo(bpm); }
  void setSongPos(bool playing, double beat) override { for (Device* d : fx) if (d && d->hasTr) d->tr(playing, beat); }
  int lat() override { int n = 0; for (int k = 0; k < HM_FX_N; k++) if (fx[k] && p[HM_FX + HM_FX_STRIDE * k] > 0.5) n += fx[k]->lat(); return n; }
  void setParam(int i, double v) override {
    if (i < 0 || i >= HM_PARAMS || i == 90) return;
    p[i] = v;
    if (i >= HM_ENV && i < HM_ENV + HM_ENV_STRIDE * HM_ENVS) { buildEnv((i - HM_ENV) / HM_ENV_STRIDE); return; }
    if (i >= HM_FX_ORDER && i < HM_FX_ORDER + HM_FX_N) { upOrder(); return; }
    if (i >= HM_FX && i < HM_FX + HM_FX_STRIDE * HM_FX_N) { int k = (i - HM_FX) / HM_FX_STRIDE, j = (i - HM_FX) % HM_FX_STRIDE; if (j >= 2 && j - 2 < HM_FX_NP[k] && fx[k]) fx[k]->setParam(j - 2, v); return; }
    if (i == HM_PRISM_AMT || i == HM_PRISM_MODE) { for (int k = 0; k < HM_POLY; k++) voices[k].rotS = -9; return; }
    switch (i) {
      case HM_T_WAVE: case HM_T_WAVE + 10: buildTimbre(i == HM_T_WAVE ? 0 : 1); break;
      case HM_T_TABLE: case HM_T_TABLE + 10: loadTable(i == HM_T_TABLE ? 0 : 1, (int)v); break;
      case HM_T_PRND: case HM_T_PRND + 10: for (int k = 0; k < HM_POLY; k++) voices[k].dirty = true; break;
      case HM_ATT: case HM_DEC: case HM_SUS: case HM_REL: upEnv(); break;
      case HM_MAP_A: case HM_MAP_B: loadMap(0, i == HM_MAP_A ? 0 : 1, (int)v); break;
      case HM_MAP_N: loadNoise(0, (int)v); break;
      case HM_MAP_W: loadWave(0, (int)v); break;
      case HM_MAP_PHASE: for (int k = 0; k < HM_POLY; k++) voices[k].dirty = true; break;
      default:
        if (i >= HM_IMG && i < HM_IMG + HM_IMG_STRIDE * (HM_IMGS - 1)) { const int g = 1 + (i - HM_IMG) / HM_IMG_STRIDE, o = (i - HM_IMG) % HM_IMG_STRIDE;
          if (o == HM_I_A || o == HM_I_B) loadMap(g, o == HM_I_A ? 0 : 1, (int)v); else if (o == HM_I_N) loadNoise(g, (int)v); else if (o == HM_I_W) loadWave(g, (int)v); else for (int k = 0; k < HM_POLY; k++) voices[k].dirty = true; break; }
        if (i >= HM_F_ON && i < HM_F_ON + 20) { int f = (i - HM_F_ON) / 10, k = (i - HM_F_ON) % 10; if (k == 9) loadFilterTable(f, (int)v); else if (k == 1 || k == 3 || k == 4 || k == 5 || k == 6) buildFilter(f); }
        break;
    }
  }
  // the note's image (its 6th event value): set for the noteOn that follows
  void noteOnSt(int pitch, double vel, double st) override { nImg = std::max(0, std::min(HM_IMGS - 1, (int)std::lround(st))); noteOn(pitch, vel); nImg = 0; }
  int nImg = 0;
  void noteOn(int pitch, double vel) override {
    pitch = std::max(0, std::min(127, pitch));
    if (p[HM_MONO] > 0.5) { monoOn(pitch, vel); return; }
    int maxv = std::max(1, std::min(HM_POLY, (int)std::lround(p[HM_POLY_P]))), n = 0;
    for (int k = 0; k < HM_POLY; k++) if (voices[k].on) n++;
    Voice* v = nullptr;
    if (n < maxv) for (int k = 0; k < HM_POLY; k++) if (!voices[k].on) { v = &voices[k]; break; }
    if (!v) {                                            // steal: the oldest released voice, else the oldest; it fades out first (no click)
      for (int pass = 0; pass < 2 && !v; pass++) for (int k = 0; k < HM_POLY; k++) {
        Voice& x = voices[k]; if (!x.on || (pass == 0 && x.held) || x.pPitch >= 0) continue;
        if (!v || x.age < v->age) v = &x;
      }
      if (!v) v = &voices[0];
      if (v->on) { v->pPitch = pitch; v->pVel = vel; v->pImg = nImg; v->fade = std::max(v->fade, (int)(sr * 0.003)); v->held = false; return; }
    }
    start(*v, pitch, vel, -1);
  }
  void noteOff(int pitch) override {
    if (p[HM_MONO] > 0.5) { monoOff(pitch); return; }
    for (int k = 0; k < HM_POLY; k++) { Voice& v = voices[k]; if (v.pPitch == pitch) v.pPitch = -1; if (v.on && v.held && v.pitch == pitch) release(v); }
  }
  void allOff() override { nHeld = 0; for (int k = 0; k < HM_POLY; k++) { Voice& v = voices[k]; v.pPitch = -1; if (v.on) release(v); } }
  bool active() override { for (int k = 0; k < HM_POLY; k++) if (voices[k].on) return true; return fxOn() && tail > 0; }   // the effects' tail keeps it running
  int voicesOn() override { int n = 0; for (int k = 0; k < HM_POLY; k++) if (voices[k].on) n++; return n; }
  // display data (devOut 998): peak left / right since the last read, voices sounding, the newest voice's fundamental (Hz), its partial
  // count K, then K partial levels (coefficient magnitude x its envelope)
  int readOut(float* out) override {
    out[0] = pkL; out[1] = pkR; pkL = pkR = 0;
    const Voice* nv = nullptr; int on = 0; for (int k = 0; k < HM_POLY; k++) if (voices[k].on) { on++; if (!nv || voices[k].age > nv->age) nv = &voices[k]; }
    out[2] = (float)on; out[3] = nv ? (float)(nv->fcur * nv->bend) : 0;
    const int K = nv ? std::min(256, nv->n) : 0; out[4] = (float)K;
    for (int k = 0; k < K; k++) out[5 + k] = (float)(std::sqrt((double)nv->X[k] * nv->X[k] + (double)nv->Y[k] * nv->Y[k]) * nv->lastEnv);
    return 5 + K;
  }
  bool canBend() override { return true; }
  void bendSounding(double r) override { for (int k = 0; k < HM_POLY; k++) if (voices[k].on) voices[k].bend *= r; }
  void bendNewest(double r) override { for (int k = 0; k < HM_POLY; k++) if (voices[k].on && voices[k].age == counter) voices[k].bend *= r; }

  void render(float* L, float* R, int a, int b) override {
    int banks = 0; for (int k = 0; k < HM_POLY; k++) if (voices[k].on) banks += voices[k].nu;
    const bool anyFx = fxOn();
    if (!banks && !(anyFx && tail > 0)) return;
    int q = std::max(0, std::min(2, (int)std::lround(p[HM_QUALITY])));
    int want = std::max(1, std::min({ HM_MAXP, CAP[q], (int)std::lround(p[HM_PARTIALS]) }));
    if (banks) want = std::min(want, std::max(8, BUDGET[q] / banks));        // adaptive: the partial-bank budget of the quality
    // voices into the instrument's own buffer (steps of SUB), the effects rack (blocks of up to 128), then a soft limit (transparent
    // below 0.7, never past 1) added to the track
    for (int at = a; at < b; ) {
      const int m = std::min(128, b - at);
      std::memset(fL, 0, sizeof(float) * m); std::memset(fR, 0, sizeof(float) * m);
      for (int s0 = 0; s0 < m; s0 += SUB) {
        const int mm = std::min(SUB, m - s0);
        sphPh += clampd(p[HM_SPH_SPEED], -8, 8) * mm / sr; sphPh -= std::floor(sphPh);
        for (int k = 0; k < HM_POLY; k++) { Voice& v = voices[k]; if (v.on) renderVoice(v, fL + s0, fR + s0, mm, want); }
      }
      if (anyFx) {
        runFx(fL, fR, m);
        float pk = 0; for (int i = 0; i < m; i++) pk = std::max(pk, std::max(std::fabs(fL[i]), std::fabs(fR[i])));
        if (pk > 1e-5f || voicesOn()) tail = (int)(sr * 0.5); else tail -= m;
      }
      for (int i = 0; i < m; i++) { const float l = soft(fL[i]), r = soft(fR[i]); L[at + i] += l; R[at + i] += r; pkL = std::max(pkL, std::fabs(l)); pkR = std::max(pkR, std::fabs(r)); }
      at += m;
    }
  }

 private:
  double sr, bpm = 120; Bank* bank; double p[HM_PARAMS]; Voice* voices = nullptr; Timbre tb[2]; AdsrP ap; uint32_t counter = 0, seed = 0x9e3779b9u;
  float l2k[NX];
  float buf[HM_UNI][SUB], fL[128], fR[128], dL[128], dR[128], pkL = 0, pkR = 0;
  Device* fx[HM_FX_N] = {}; int order[HM_FX_N] = { 0, 1, 2, 3, 4, 5, 6 }; int tail = 0; double sphPh = 0;
  bool fxOn() const { for (int k = 0; k < HM_FX_N; k++) if (fx[k] && p[HM_FX + HM_FX_STRIDE * k] > 0.5) return true; return false; }
  // the slots' effects in order; a repeated or missing effect: the first use counts, the rest follow in their own order
  void upOrder() {
    bool used[HM_FX_N] = {}; int n = 0;
    for (int s = 0; s < HM_FX_N; s++) { int k = (int)std::lround(p[HM_FX_ORDER + s]); if (k >= 0 && k < HM_FX_N && !used[k]) { used[k] = true; order[n++] = k; } }
    for (int k = 0; k < HM_FX_N; k++) if (!used[k]) order[n++] = k;
  }
  void runFx(float* L, float* R, int m) {
    for (int s = 0; s < HM_FX_N; s++) {
      const int k = order[s], b0 = HM_FX + HM_FX_STRIDE * k; Device* d = fx[k];
      if (!d || p[b0] <= 0.5) continue;
      const float mix = (float)clampd(p[b0 + 1], 0, 1);
      if (mix < 1) { std::memcpy(dL, L, sizeof(float) * m); std::memcpy(dR, R, sizeof(float) * m); }
      d->process(L, R, m);
      if (mix < 1) for (int i = 0; i < m; i++) { L[i] = dL[i] + (L[i] - dL[i]) * mix; R[i] = dR[i] + (R[i] - dR[i]) * mix; }
    }
  }
  float ft[2][FT_N]; float fcustom[2][256]; bool fcHas[2] = { false, false };
  float fmt[FM_N]; double fmtVowel = -1, fmtRes = -1;
  EnvDef ed[HM_ENVS];
  struct Map { int frames = 0, bins = 0, layout = 0; double hop = 0.01, base = 0, flo = 20, fhi = 20000; std::vector<float> aL, aR, dev, ph; bool stereo = false, hasDev = false, hasPh = false; } mpz[HM_IMGS];
  float bufR[HM_UNI][SUB];
  // the residual noise map (slot N) and its band-pass bank: band j = two equal biquads centred in the band (geometric centre), each with
  // the band's width in octaves; nPg = 1 / sqrt(the cascade's power gain for unit white noise), measured once, so a band plays the RMS
  // the analysis measured
  struct NMap { int frames = 0, bands = 0; double hop = 0.01, flo = 40, fhi = 20000; std::vector<float> aL, aR; bool stereo = false, ms = false; float nb0[HM_NB_MAX] = {}, na1[HM_NB_MAX] = {}, na2[HM_NB_MAX] = {}, nPg[HM_NB_MAX] = {}; bool nOn[HM_NB_MAX] = {}; } nmz[HM_IMGS];
  // the map's play range: from Map Start to Map End (frames); past the end it holds the end frame, or loops back to the start
  double iP(int g, int o, int legacy) const { return g ? p[HM_IMG + HM_IMG_STRIDE * (g - 1) + o] : p[legacy]; }
  double iStart(int g) const { return clampd(iP(g, HM_I_START, HM_MAP_START), 0, 1); }
  double iEnd(int g) const { return clampd(iP(g, HM_I_END, HM_MAP_END), 0, 1); }
  bool iLoop(int g) const { return iP(g, HM_I_LOOP, HM_MAP_LOOP) > 0.5; }
  double iLevel(int g) const { return std::max(0.0, p[HM_MAP_LEVEL]) * (g ? std::max(0.0, p[HM_IMG + HM_IMG_STRIDE * (g - 1) + HM_I_LEVEL]) : 1.0); }
  double iNoise(int g) const { return std::max(0.0, p[HM_MAP_NOISE]) * (g ? std::max(0.0, p[HM_IMG + HM_IMG_STRIDE * (g - 1) + HM_I_NOISE]) : 1.0); }
  double iShift(int g) const { return clampd(p[HM_MAP_SHIFT] + (g ? p[HM_IMG + HM_IMG_STRIDE * (g - 1) + HM_I_SHIFT] : 0), -48, 48); }
  int imgOf(const Voice& v) const { return v.img > 0 && v.img < HM_IMGS && mpz[v.img].frames > 0 ? v.img : 0; }   // an image without a map: image 0
  double mapPos(int g, double fp, int frames, bool loop) const {
    const double a = iStart(g) * (frames - 1), z = std::max(a, iEnd(g) * (frames - 1));
    if (loop && frames > 1) { const double len = std::max(1.0, z - a + 1); if (fp > z) fp = a + std::fmod(fp - a, len); return clampd(fp, 0, frames - 1); }
    return clampd(fp, 0, z);
  }
  struct WMap { int n = 0; double sr = 48000; std::vector<float> l, r; } wvz[HM_IMGS];
  void loadWave(int g, int id) {
    const Sample* s = id >= 0 && id < 256 && bank ? bank->s[id] : nullptr; WMap& wv = wvz[g];
    wv.n = 0; wv.l.clear(); wv.r.clear();
    if (!s || s->frames < HM_MAP_HDR || std::fabs(s->l[0] - HM_MAP_MAGIC) > 1e-3 || std::lround(s->l[4]) != HM_MAP_WAVE) return;
    const int n = (int)std::lround(s->l[1]); if (n < 1 || (long)n + HM_MAP_HDR > s->frames) return;
    wv.n = n; wv.sr = std::max(1000.0, (double)s->l[3]); wv.l.assign(s->l + HM_MAP_HDR, s->l + HM_MAP_HDR + n);
    if (s->r && s->r != s->l) wv.r.assign(s->r + HM_MAP_HDR, s->r + HM_MAP_HDR + n);
  }
  void loadNoise(int g, int id) {
    const Sample* s = id >= 0 && id < 256 && bank ? bank->s[id] : nullptr; NMap& nm = nmz[g]; float* nb0 = nm.nb0; float* na1 = nm.na1; float* na2 = nm.na2; float* nPg = nm.nPg; bool* nOn = nm.nOn;
    nm.frames = 0; nm.aL.clear(); nm.aR.clear();
    if (!s || s->frames < HM_MAP_HDR || std::fabs(s->l[0] - HM_MAP_MAGIC) > 1e-3 || std::lround(s->l[4]) != HM_MAP_NOISEB) return;
    const int fr = (int)std::lround(s->l[1]), bn = (int)std::lround(s->l[2]);
    if (fr < 1 || fr > 8192 || bn < 1 || bn > HM_NB_MAX || (long)fr * bn + HM_MAP_HDR > s->frames) return;
    nm.frames = fr; nm.bands = bn; nm.hop = std::max(1e-4, (double)s->l[3]); nm.flo = std::max(1.0, (double)s->l[6]); nm.fhi = std::max(nm.flo * 1.01, (double)s->l[7]);
    const size_t n = (size_t)fr * bn; nm.aL.assign(s->l + HM_MAP_HDR, s->l + HM_MAP_HDR + n);
    nm.stereo = s->r && s->r != s->l; if (nm.stereo) nm.aR.assign(s->r + HM_MAP_HDR, s->r + HM_MAP_HDR + n); nm.ms = std::lround(s->l[5]) == 1;
    const double lo = std::log2(nm.flo), w = (std::log2(nm.fhi) - lo) / bn;
    for (int j = 0; j < bn; j++) {
      const double fc = std::pow(2.0, lo + (j + 0.5) * w); nOn[j] = fc < 0.45 * sr; if (!nOn[j]) continue;
      const double w0 = TAU * fc / sr, q = 1.0 / (2 * std::sinh(std::log(2.0) / 2 * w * 1.55)), al = std::sin(w0) / (2 * q), a0 = 1 + al;   // 1.55: two sections narrow the band
      nb0[j] = (float)(al / a0); na1[j] = (float)(-2 * std::cos(w0) / a0); na2[j] = (float)((1 - al) / a0);
      double pg = 0; const int G = 2048;                  // power gain of the cascade for white noise: mean |H|^4 over 0..pi
      for (int g = 0; g < G; g++) { const double om = PI * (g + 0.5) / G, c1 = std::cos(om), s1 = std::sin(om), c2 = std::cos(2 * om), s2 = std::sin(2 * om);
        const double nr = nb0[j] * (1 - c2), ni = nb0[j] * s2, dr = 1 + na1[j] * c1 + na2[j] * c2, di = -(na1[j] * s1 + na2[j] * s2), h2 = (nr * nr + ni * ni) / (dr * dr + di * di); pg += h2 * h2; }
      pg /= G; nPg[j] = (float)(1.0 / std::sqrt(std::max(1e-12, pg)));
    }
    // the bands overlap: noise through band j also lands in its neighbours. M[i][j] = the power that unit white noise through band j puts
    // into band i (exact responses of the cascades); each frame's band gains g^2 solve M g^2 = the measured band powers (non-negative,
    // projected Gauss-Seidel), so the played noise has the analysed spectrum. Done once here: the map then holds the gains.
    // (every band has its OWN noise source: the bands' powers add; one shared source would make neighbours cancel at the crossovers)
    std::vector<double> M((size_t)bn * bn, 0.0);
    { const int G = 4096; const double lw0 = std::log2(nm.flo), lwt = std::log2(nm.fhi);
      for (int g = 0; g < G; g++) {                       // a log-spaced grid (the low bands are narrow), weight = d(omega) / pi
        const double hz = std::pow(2.0, lw0 + (g + 0.5) / G * (lwt - lw0)), om = TAU * hz / sr, wt = om * std::log(2.0) * (lwt - lw0) / G / PI; if (om >= PI) continue;
        const int i = std::min(bn - 1, (int)((std::log2(hz) - lw0) / (lwt - lw0) * bn)); const double c1 = std::cos(om), s1 = std::sin(om), c2 = std::cos(2 * om), s2 = std::sin(2 * om);
        for (int j = 0; j < bn; j++) { if (!nOn[j]) continue; const double nr = nb0[j] * (1 - c2), ni = nb0[j] * s2, dr = 1 + na1[j] * c1 + na2[j] * c2, di = -(na1[j] * s1 + na2[j] * s2), h2 = (nr * nr + ni * ni) / (dr * dr + di * di);
          M[(size_t)i * bn + j] += h2 * h2 * wt; } } }
    auto solve = [&](float* row) {                       // row: band RMS in -> gain on unit noise out
      double t[HM_NB_MAX], x[HM_NB_MAX];
      for (int j = 0; j < bn; j++) { t[j] = (double)row[j] * row[j]; const double d = M[(size_t)j * bn + j]; x[j] = nOn[j] && d > 1e-15 ? t[j] / d : 0; }
      for (int it = 0; it < 12; it++) for (int i = 0; i < bn; i++) { if (!nOn[i]) continue; const double d = M[(size_t)i * bn + i]; if (d <= 1e-15) continue;
        double r = t[i]; for (int j = 0; j < bn; j++) if (j != i) r -= M[(size_t)i * bn + j] * x[j]; x[i] = std::max(0.0, r / d); }
      for (int j = 0; j < bn; j++) row[j] = (float)std::sqrt(std::max(0.0, x[j]));
    };
    for (int f = 0; f < fr; f++) { solve(nm.aL.data() + (size_t)f * bn); if (nm.stereo) solve(nm.aR.data() + (size_t)f * bn); }
    for (int j = 0; j < bn; j++) nPg[j] = 1.f;            // the solved gains already include each band's own power gain
    for (int k = 0; k < HM_POLY; k++) { std::memset(voices[k].nz, 0, sizeof(voices[k].nz)); std::memset(voices[k].nzS, 0, sizeof(voices[k].nzS));
      for (int j = 0; j < HM_NB_MAX; j++) { voices[k].nr[j][0] = 0x12345u + 0x9e3779b9u * (uint32_t)(j + 64 * k) | 1u; voices[k].nr[j][1] = 0xabcdefu + 0x7f4a7c15u * (uint32_t)(j + 64 * k) | 1u; } }
  }
  // slot A (amplitude) / B (deviation, phase): copied out of the bank, as the bank's sample can be replaced at any time
  bool mapHeader(const Sample* s, int& fr, int& bn) const {
    if (!s || s->frames < HM_MAP_HDR || std::fabs(s->l[0] - HM_MAP_MAGIC) > 1e-3) return false;
    fr = (int)std::lround(s->l[1]); bn = (int)std::lround(s->l[2]);
    return fr >= 1 && bn >= 1 && bn <= HM_MAXP && fr <= 8192 && (long)fr * bn + HM_MAP_HDR <= s->frames;
  }
  void loadMap(int g, int which, int id) {
    const Sample* s = id >= 0 && id < 256 && bank ? bank->s[id] : nullptr; int fr = 0, bn = 0; Map& mp = mpz[g];
    if (which == 0) {
      if (!mapHeader(s, fr, bn)) { mp.frames = 0; mp.aL.clear(); mp.aR.clear(); mp.hasDev = mp.hasPh = false; }
      else {
        mp.frames = fr; mp.bins = bn; mp.hop = std::max(1e-4, (double)s->l[3]); mp.layout = (int)std::lround(s->l[4]); mp.base = s->l[5]; mp.flo = std::max(1.0, (double)s->l[6]); mp.fhi = std::max(mp.flo * 1.01, (double)s->l[7]);
        const size_t n = (size_t)fr * bn; mp.aL.assign(s->l + HM_MAP_HDR, s->l + HM_MAP_HDR + n);
        mp.stereo = s->r && s->r != s->l; if (mp.stereo) mp.aR.assign(s->r + HM_MAP_HDR, s->r + HM_MAP_HDR + n); else mp.aR.clear();
        if ((int)mp.dev.size() != (int)n) { mp.dev.clear(); mp.ph.clear(); mp.hasDev = mp.hasPh = false; }
      }
    } else {
      if (!mapHeader(s, fr, bn) || fr != mp.frames || bn != mp.bins) { mp.dev.clear(); mp.ph.clear(); mp.hasDev = mp.hasPh = false; }
      else { const size_t n = (size_t)fr * bn; mp.dev.assign(s->l + HM_MAP_HDR, s->l + HM_MAP_HDR + n); mp.hasDev = true; mp.hasPh = s->r && s->r != s->l; if (mp.hasPh) mp.ph.assign(s->r + HM_MAP_HDR, s->r + HM_MAP_HDR + n); else mp.ph.clear(); }
    }
    for (int k = 0; k < HM_POLY; k++) voices[k].dirty = true;
  }
  // a map value at (frame position, bin position), both interpolated
  static float mapAt(const std::vector<float>& a, int bins, int f0, int f1, double ff, double b) {
    if (b < 0 || b > bins - 1) return 0;
    const int j0 = (int)b, j1 = std::min(bins - 1, j0 + 1); const double jf = b - j0;
    const float* r0 = a.data() + (size_t)f0 * bins; const float* r1 = a.data() + (size_t)f1 * bins;
    const double v0 = r0[j0] + (r0[j1] - r0[j0]) * jf, v1 = r1[j0] + (r1[j1] - r1[j0]) * jf;
    return (float)(v0 + (v1 - v0) * ff);
  }
  int held[128] = {}, nHeld = 0;                     // mono: the keys held, in order

  static float soft(float x) { float a = std::fabs(x); if (a <= 0.7f) return x; float y = 0.7f + 0.3f * std::tanh((a - 0.7f) / 0.3f); return x < 0 ? -y : y; }
  float rnd() { seed = seed * 1664525u + 1013904223u; return (seed >> 8) * (1.0f / 16777216.0f); }
  void upEnv() { ap = adsrParams(std::max(0.001, p[HM_ATT]), std::max(0.001, p[HM_DEC]), clampd(p[HM_SUS], 0, 1), std::max(0.002, p[HM_REL]), sr); }

  // ---- timbres
  void loadTable(int t, int id) {
    const Sample* s = id >= 0 && id < 256 && bank ? bank->s[id] : nullptr;
    Timbre& T = tb[t]; T.table = s && s->frames >= 1;
    if (T.table) { int n = std::min(HM_MAXP, s->frames); for (int k = 0; k < HM_MAXP; k++) { T.tl[k] = k < n ? std::max(0.0f, std::min(1.0f, s->l[k])) : 0; T.tp[k] = k < n && s->r ? s->r[k] : 0; } }
    buildTimbre(t);
  }
  // the waveform's Fourier series (sign as a half-cycle phase), times the drawn level, plus the drawn phase
  void buildTimbre(int t) {
    Timbre& T = tb[t]; int w = std::max(0, std::min(4, (int)std::lround(p[HM_T_WAVE + 10 * t])));
    double e2 = 0;
    for (int k = 0; k < HM_MAXP; k++) {
      int h = k + 1; double a = 0, ph = 0;
      switch (w) {
        case HM_SINE: a = h == 1 ? 1 : 0; break;
        case HM_SAW: a = 2 / (PI * h); ph = (h & 1) ? 0 : PI; break;
        case HM_SQUARE: a = (h & 1) ? 4 / (PI * h) : 0; break;
        case HM_TRI: a = (h & 1) ? 8 / (PI * PI * h * h) : 0; ph = ((h - 1) / 2) & 1 ? PI : 0; break;
        default: a = T.table ? 1 : 1.0 / h; break;    // Custom: the drawn levels themselves (no table yet: a saw-like 1/k)
      }
      if (T.table) { a *= T.tl[k]; ph += T.tp[k] * TAU; }
      T.a[k] = (float)a; T.ph[k] = (float)ph; e2 += a * a;
    }
    if (w == HM_CUSTOM && e2 > 0) {                    // a drawn spectrum never louder than a saw (RMS)
      double g = std::min(1.0, std::sqrt((4 / (PI * PI)) * (PI * PI / 6) / e2));
      for (int k = 0; k < HM_MAXP; k++) T.a[k] = (float)(T.a[k] * g);
    }
    for (int k = 0; k < HM_POLY; k++) voices[k].dirty = true;
  }

  // ---- filters: gain against octaves from the cutoff (x). Slope 12 / 24 / 48 dB per octave = 2 / 4 / 8 poles (Butterworth magnitude);
  // resonance: a bell (width in octaves, centre offset in octaves) up to +24 dB; Custom: the drawn curve (256 points over -8 .. +8 oct)
  void loadFilterTable(int f, int id) {
    const Sample* s = id >= 0 && id < 256 && bank ? bank->s[id] : nullptr;
    fcHas[f] = s && s->frames >= 2;
    if (fcHas[f]) for (int j = 0; j < 256; j++) { double x = (double)j / 255 * (s->frames - 1); int i0 = (int)x; double fr = x - i0; int i1 = std::min(s->frames - 1, i0 + 1); fcustom[f][j] = (float)clampd(s->l[i0] + (s->l[i1] - s->l[i0]) * fr, 0, 1); }
    buildFilter(f);
  }
  void buildFilter(int f) {
    const int b0 = 10 * f, type = std::max(0, std::min(5, (int)std::lround(p[HM_F_TYPE + b0]))), sl = std::max(0, std::min(2, (int)std::lround(p[HM_F_SLOPE + b0])));
    const double n = sl == 0 ? 2 : sl == 1 ? 4 : 8, res = clampd(p[HM_F_RES + b0], 0, 1), w = clampd(p[HM_F_WIDTH + b0], 0.05, 3), ofs = clampd(p[HM_F_OFS + b0], -4, 4);
    const double bw = sl == 0 ? 1.0 : sl == 1 ? 0.5 : 0.25, peak = 15 * res * res;
    for (int j = 0; j < FT_N; j++) {
      double x = FT_LO + j * FT_STEP, g;
      switch (type) {
        case HM_HP: g = 1 / std::sqrt(1 + std::pow(2.0, -2 * n * x)); break;
        case HM_BP: g = std::exp(-0.5 * (x / bw) * (x / bw)); break;
        case HM_BS: g = 1 - 0.9999 * std::exp(-0.5 * (x / bw) * (x / bw)); break;
        case HM_FCUSTOM: { if (!fcHas[f]) { g = 1; break; } double u = clampd((x + 8) / 16 * 255, 0, 255); int i0 = (int)u; double fr = u - i0; g = fcustom[f][i0] + (fcustom[f][std::min(255, i0 + 1)] - fcustom[f][i0]) * fr; break; }
        case HM_FORMANT: g = 1; break;                  // formant: absolute vowel table, the resonance narrows its peaks
        default: g = 1 / std::sqrt(1 + std::pow(2.0, 2 * n * x)); break;
      }
      if (type != HM_FORMANT && peak > 0) { double d = (x - ofs) / w; g *= 1 + peak * std::exp(-0.5 * d * d); }
      ft[f][j] = (float)g;
    }
  }
  float flt(int f, double x) const { double u = (x - FT_LO) / FT_STEP; if (u <= 0) return ft[f][0]; if (u >= FT_N - 1) return ft[f][FT_N - 1]; int i = (int)u; double fr = u - i; return (float)(ft[f][i] + (ft[f][i + 1] - ft[f][i]) * fr); }
  // formant vowels A E I O U (F1 F2 F3 in Hz), the cutoff picks the vowel: 200 Hz = A .. 5 kHz = U
  void buildFormant(double vowel, double res) {
    static const double F[5][3] = { { 800, 1150, 2900 }, { 400, 1700, 2600 }, { 290, 2100, 3000 }, { 450, 800, 2830 }, { 325, 700, 2530 } }, G[3] = { 1, 0.5, 0.25 }, BW[3] = { 80, 90, 120 };
    int i0 = std::max(0, std::min(3, (int)vowel)); double fr = clampd(vowel - i0, 0, 1), nar = 1 - 0.75 * res;
    for (int j = 0; j < FM_N; j++) {
      double lf = FM_LO + j * FT_STEP, g = 0.02;
      for (int k = 0; k < 3; k++) { double fk = F[i0][k] + (F[i0 + 1][k] - F[i0][k]) * fr, wo = 1.44 * BW[k] / fk * nar + 0.02, d = (lf - std::log2(fk)) / wo; g += G[k] * std::exp(-0.5 * d * d); }
      fmt[j] = (float)std::min(1.5, g);
    }
    fmtVowel = vowel; fmtRes = res;
  }
  float fmtAt(double lf) const { double u = (lf - FM_LO) / FT_STEP; if (u <= 0) return fmt[0]; if (u >= FM_N - 1) return fmt[FM_N - 1]; int i = (int)u; double fr = u - i; return (float)(fmt[i] + (fmt[i + 1] - fmt[i]) * fr); }

  // ---- articulators
  void buildEnv(int e) {
    EnvDef& d = ed[e]; const double* q = p + HM_ENV + HM_ENV_STRIDE * e;
    d.on = q[0] > 0.5; d.depth = clampd(q[1], -1, 1);
    int np = (int)std::lround(q[2]);
    if (np >= 2) {
      d.n = std::min(HM_ENV_PTS, np);
      for (int j = 0; j < d.n; j++) { d.dt[j] = std::max(0.0, q[10 + 3 * j]); d.lv[j] = clampd(q[11 + 3 * j], 0, 1); d.cv[j] = clampd(q[12 + 3 * j], -1, 1); }
      d.dt[0] = 0;
      int s = (int)std::lround(q[3]), l = (int)std::lround(q[4]);
      d.sus = s >= 1 && s < d.n ? s : -1; d.loop = d.sus >= 0 && l >= 0 && l < d.sus ? l : -1;
    } else {                                           // AHDSR: 0 -> 1 (attack) -> hold -> sustain (decay), release -> 0
      d.n = 5; d.sus = 3; d.loop = -1;
      d.lv[0] = 0; d.dt[0] = 0; d.cv[0] = 0;
      d.lv[1] = 1; d.dt[1] = std::max(0.0005, q[5]); d.cv[1] = 0;
      d.lv[2] = 1; d.dt[2] = std::max(0.0, q[6]); d.cv[2] = 0;
      d.lv[3] = clampd(q[8], 0, 1); d.dt[3] = std::max(0.001, q[7]); d.cv[3] = 0.6;
      d.lv[4] = 0; d.dt[4] = std::max(0.002, q[9]); d.cv[4] = 0.6;
    }
  }
  static double shape(double t, double c) { return c >= 0 ? 1 - std::pow(1 - t, 1 + 6 * c) : std::pow(t, 1 - 6 * c); }   // c > 0: fast start, c < 0: slow start
  static void envStart(EnvState& s, const EnvDef& d) { s.i = 1; s.t = 0; s.from = d.lv[0]; s.val = d.lv[0]; s.done = d.n < 2; s.rel = false; }
  static void envRelease(EnvState& s, const EnvDef& d) {
    if (s.rel || d.n < 2) return; s.rel = true;
    int to = d.sus >= 0 ? d.sus + 1 : d.n - 1;      // after the sustain point, or (no sustain point) straight to the last point
    if (to >= d.n) { s.done = true; return; }
    s.i = to; s.t = 0; s.from = s.val; s.done = false;
  }
  static double envStep(EnvState& s, const EnvDef& d, double dt) {   // advance by dt seconds, return the level at the end
    if (s.done) return s.val;
    s.t += dt;
    for (int guard = 0; guard < 64; guard++) {
      const double D = d.dt[s.i];
      if (!s.rel && d.sus >= 0 && s.i > d.sus) { s.val = d.lv[d.sus]; return s.val; }   // holding at the sustain point
      if (s.t < D) { s.val = s.from + (d.lv[s.i] - s.from) * shape(D > 0 ? s.t / D : 1, d.cv[s.i]); return s.val; }
      s.t -= D; s.from = d.lv[s.i]; s.val = s.from;
      if (!s.rel && s.i == d.sus) {                 // reached the sustain point: loop back while held, else hold
        if (d.loop >= 0) { s.i = d.loop + 1; s.from = s.val; continue; }
        s.i++; s.t = 0; return s.val;
      }
      if (++s.i >= d.n) { s.done = true; s.i = d.n - 1; return s.val; }
    }
    return s.val;
  }

  // ---- voices
  void start(Voice& v, int pitch, double vel, double fromF) {
    bool wasOn = v.on && fromF > 0;
    v.on = v.held = true; v.fresh = !wasOn; v.img = nImg; v.pitch = pitch; v.vel = vel; v.age = ++counter; v.bend = 1; v.dirty = true; v.fade = 0; v.pPitch = -1;
    v.f0 = 440.0 * std::pow(2.0, (pitch - 69) / 12.0); v.fcur = fromF > 0 ? fromF : v.f0; v.t = 0;
    if (!wasOn) {
      v.nu = std::max(1, std::min(HM_UNI, (int)std::lround(p[HM_U_VOICES])));
      const double ph = clampd(p[HM_U_PHASE], 0, 1);
      for (int u = 0; u < v.nu; u++) for (int k = 0; k < NX; k++) { if (u == 0 || ph <= 0) { v.c[u][k] = 1; v.s[u][k] = 0; } else { double a = ph * TAU * rnd(); v.c[u][k] = (float)std::cos(a); v.s[u][k] = (float)std::sin(a); } }
      for (int k = 0; k < NX; k++) { v.X[k] = v.Y[k] = 0; v.u[k] = rnd(); }
      for (int u = 0; u < HM_UNI; u++) v.rotF[u] = -1;
      v.rotS = -9; v.n = 0; v.volPrev = 0; v.soC = 1; v.soS = 0; v.soX = 0; v.devPrev = v.stPrev = false;
      for (int k = 0; k < NX; k++) { v.XR[k] = v.YR[k] = 0; v.ldm[k] = 0; }
      v.env.v = 0;
    }
    v.env.start();
    for (int e = 0; e < HM_ENVS; e++) envStart(v.es[e], ed[e]);
    for (int l = 0; l < 2; l++) if (p[HM_L_RETRIG + HM_L_STRIDE * l] > 0.5 || !wasOn) { v.lph[l] = clampd(p[HM_L_PHASE + HM_L_STRIDE * l], 0, 1); v.lsh[l] = rnd() * 2 - 1; }
    unisonLayout(v);
  }
  // unison copies: positions -1..1 -> detune (cents) + pitch spread (semitones), pan (equal power), volume weight; total power normalised
  void unisonLayout(Voice& v) {
    double det = clampd(p[HM_U_DETUNE], 0, 100), ps = clampd(p[HM_U_PITCH], -24, 24), spread = clampd(p[HM_U_SPREAD], 0, 1), vd = clampd(p[HM_U_VOLDIST], -1, 1), e2 = 0, w[HM_UNI];
    for (int u = 0; u < v.nu; u++) {
      double pos = v.nu == 1 ? 0 : -1 + 2.0 * u / (v.nu - 1), cen = 1 - std::fabs(pos);
      w[u] = std::max(0.0, 1 + vd * (2 * cen - 1)); e2 += w[u] * w[u];
      v.um[u] = (float)std::pow(2.0, (pos * det / 100 + pos * ps) / 12);
      double pan = clampd(pos * spread, -1, 1), a = (pan + 1) * PI / 4;
      v.gl[u] = (float)std::cos(a); v.gr[u] = (float)std::sin(a);
    }
    double g = e2 > 0 ? 1 / std::sqrt(e2) : 1;
    for (int u = 0; u < v.nu; u++) { v.gl[u] = (float)(v.gl[u] * w[u] * g * std::sqrt(2.0)); v.gr[u] = (float)(v.gr[u] * w[u] * g * std::sqrt(2.0)); }
  }
  void release(Voice& v) { v.held = false; v.env.release(); for (int e = 0; e < HM_ENVS; e++) envRelease(v.es[e], ed[e]); }
  void monoOn(int pitch, double vel) {
    for (int k = 0; k < nHeld; k++) if (held[k] == pitch) { std::memmove(held + k, held + k + 1, sizeof(int) * (nHeld - k - 1)); nHeld--; break; }
    if (nHeld < 128) held[nHeld++] = pitch;
    Voice& v = voices[0]; for (int k = 1; k < HM_POLY; k++) if (voices[k].on) release(voices[k]);
    const bool glide = v.on && p[HM_GLIDE] > 0;
    if (v.on && v.held && p[HM_LEGATO] > 0.5) { const bool sw = v.img != nImg; if (sw) { v.img = nImg; v.dirty = true; v.t = 0; } v.pitch = pitch; v.f0 = 440.0 * std::pow(2.0, (pitch - 69) / 12.0); if (!glide || sw) v.fcur = v.f0; /* another vocal: from its Start, no glide */ v.age = ++counter; return; }   // legato: no retrigger
    start(v, pitch, vel, glide ? v.fcur : -1);
  }
  void monoOff(int pitch) {
    for (int k = 0; k < nHeld; k++) if (held[k] == pitch) { std::memmove(held + k, held + k + 1, sizeof(int) * (nHeld - k - 1)); nHeld--; break; }
    Voice& v = voices[0]; if (!v.on || v.pitch != pitch) return;
    if (nHeld > 0) { int back = held[nHeld - 1]; v.pitch = back; v.f0 = 440.0 * std::pow(2.0, (back - 69) / 12.0); if (p[HM_GLIDE] <= 0) v.fcur = v.f0; return; }   // back to the key still held
    release(v);
  }
  void phaseVectors(Voice& v) {
    for (int t = 0; t < 2; t++) {
      const Timbre& T = tb[t]; double r = clampd(p[HM_T_PRND + 10 * t], 0, 1) * TAU;
      float* ex = t ? v.e2x : v.e1x; float* ey = t ? v.e2y : v.e1y;
      for (int k = 0; k < HM_MAXP; k++) { double ph = T.ph[k] + r * v.u[k]; ex[k] = (float)std::cos(ph); ey[k] = (float)std::sin(ph); }
    }
    // the map's phases at its start frame (resynthesis), else timbre 1's
    const int g = imgOf(v); const Map& mp = mpz[g];
    const bool mph = mp.frames > 0 && mp.hasPh && p[HM_MAP_PHASE] > 0.5 && mp.layout == HM_MAP_HARM;
    const int f0 = mph ? std::max(0, std::min(mp.frames - 1, (int)std::lround(iStart(g) * (mp.frames - 1)))) : 0;
    for (int k = 0; k < HM_MAXP; k++) { if (mph && k < mp.bins) { const double ph = TAU * mp.ph[(size_t)f0 * mp.bins + k]; v.emx[k] = (float)std::cos(ph); v.emy[k] = (float)std::sin(ph); } else { v.emx[k] = v.e1x[k]; v.emy[k] = v.e1y[k]; } }
    v.dirty = false;
  }
  double lfo(Voice& v, int l, double dt) {
    const int b0 = HM_L_STRIDE * l; const double depth = clampd(p[HM_L_DEPTH + b0], 0, 1);
    double ph = v.lph[l], y;
    switch ((int)std::lround(p[HM_L_SHAPE + b0])) {
      case 1: y = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph; break;
      case 2: y = 2 * ph - 1; break;
      case 3: y = ph < 0.5 ? 1 : -1; break;
      case 4: y = v.lsh[l]; break;
      default: y = std::sin(TAU * ph); break;
    }
    ph += clampd(p[HM_L_RATE + b0], 0.01, 40) * dt;
    if (ph >= 1) { ph -= std::floor(ph); v.lsh[l] = rnd() * 2 - 1; }
    v.lph[l] = ph;
    return y * depth;
  }

  void renderVoice(Voice& v, float* L, float* R, int m, int want) {
    if (v.dirty) phaseVectors(v);
    const int g = imgOf(v); const Map& mp = mpz[g]; NMap& nm = nmz[g]; const WMap& wv = wvz[g]; const float* nPg = nm.nPg; const bool* nOn = nm.nOn; const float* nb0 = nm.nb0; const float* na1 = nm.na1; const float* na2 = nm.na2; (void)nb0; (void)na1; (void)na2;   // the note's image
    const double dt = m / sr;
    // modulation for this step: articulators, LFOs, vibrato, glide
    double ev[HM_ENVS];
    for (int e = 0; e < HM_ENVS; e++) ev[e] = ed[e].on ? envStep(v.es[e], ed[e], dt) : 0;
    double lm[HM_LD_COUNT] = {};
    for (int l = 0; l < 2; l++) { double y = lfo(v, l, dt); int d = (int)std::lround(p[HM_L_DEST + HM_L_STRIDE * l]); if (d > 0 && d < HM_LD_COUNT) lm[d] += y; }
    double vib = 0; if (p[HM_VIB_DEPTH] > 0) { double dl = std::max(0.0, p[HM_VIB_DELAY]), fi = dl > 0 ? clampd(v.t / dl, 0, 1) : 1; vib = p[HM_VIB_DEPTH] / 100 * fi * std::sin(TAU * clampd(p[HM_VIB_RATE], 0.05, 20) * v.t); }
    v.t += dt;
    if (std::fabs(v.fcur - v.f0) > 1e-9 * v.f0) { double g = p[HM_GLIDE] > 0 ? 1 - std::exp(-dt / (p[HM_GLIDE] / 4.6)) : 1; v.fcur *= std::pow(v.f0 / v.fcur, g); }
    const double semis = p[HM_PITCH] + p[HM_FINE] / 100 + vib + (ed[HM_E_PITCH].on ? ev[HM_E_PITCH] * ed[HM_E_PITCH].depth * 48 : 0) + lm[HM_LD_PITCH] * 12;
    const double f0 = v.fcur * v.bend * pexp2(semis / 12), l2f0 = std::log2(f0), nyq = sr * 0.5;
    const double stretch = clampd(p[HM_STRETCH] + (ed[HM_E_FREQ].on ? ev[HM_E_FREQ] * ed[HM_E_FREQ].depth * 2 : 0) + lm[HM_LD_STRETCH], -2, 2);
    // per-partial frequency multipliers (only when the stretch moved), then the rotation per sample of every copy (only when the pitch moved)
    bool rebuild = false;
    if (stretch != v.rotS) {
      const double e = 1 + 0.1 * stretch, pa = clampd(p[HM_PRISM_AMT], 0, 1); const bool shift = p[HM_PRISM_MODE] > 0.5;
      for (int k = 0; k < HM_MAXP; k++) {
        double m0 = pexp2(e * l2k[k]);
        if (pa > 0) m0 = shift ? m0 + 2 * pa : (k ? m0 + pa * 0.5 * (2 * hash01(k) - 1) : m0);   // Prism: shift every partial by up to 2 x f0 Hz, or scatter it by up to half a harmonic
        m0 = std::max(0.01, m0); v.vm[k] = (float)m0; v.lvm[k] = (float)std::log2(m0);
      }
      v.vm[HM_MAXP] = 0.5f; v.vm[HM_MAXP + 1] = 0.25f; v.lvm[HM_MAXP] = -1; v.lvm[HM_MAXP + 1] = -2;
      v.rotS = stretch; rebuild = true;
    }
    int top = std::max(v.n, want);
    // partial map: the frame for this step, the deviation of every partial (moves its frequency: the rotation is rebuilt)
    const bool mapOn = mp.frames > 0 && p[HM_MAP_MIX] > 0;
    int mf0 = 0, mf1 = 0; double mff = 0, mshift = 0, mMix = 0, mLev = 0, fbase = 0;
    if (mapOn) {
      const double tm = (v.t - dt) * clampd(p[HM_MAP_SPEED], 0, 16);
      double fp = iStart(g) * (mp.frames - 1) + tm / mp.hop;
      const bool loop = iLoop(g) && mp.frames > 1;
      fp = mapPos(g, fp, mp.frames, loop);
      mf0 = (int)fp; mff = p[HM_MAP_INTERP] > 0.5 ? fp - mf0 : 0; mf1 = loop ? (mf0 + 1) % mp.frames : std::min(mf0 + 1, mp.frames - 1);
      mMix = clampd(p[HM_MAP_MIX], 0, 1);
      mLev = iLevel(g) * (ed[HM_E_IMGGAIN].on ? (1 - clampd(ed[HM_E_IMGGAIN].depth, 0, 1)) + clampd(ed[HM_E_IMGGAIN].depth, 0, 1) * ev[HM_E_IMGGAIN] : 1);
      mshift = iShift(g) / 12 + (ed[HM_E_IMGFREQ].on ? ev[HM_E_IMGFREQ] * ed[HM_E_IMGFREQ].depth * 4 : 0);
      fbase = mp.base > 0 ? 440.0 * std::pow(2.0, (mp.base - 69) / 12.0) : 0;
    }
    const bool devOn = mapOn && mp.hasDev && mp.layout == HM_MAP_HARM && p[HM_MAP_FDEV] > 0;
    if (devOn) { const double fd = clampd(p[HM_MAP_FDEV], 0, 1) / 1200; for (int k = 0; k < HM_MAXP; k++) v.ldm[k] = k < mp.bins && k < top ? (float)(fd * mapAt(mp.dev, mp.bins, mf0, mf1, mff, k)) : 0.f; }
    else if (v.devPrev) for (int k = 0; k < HM_MAXP; k++) v.ldm[k] = 0;
    const bool devRe = devOn || v.devPrev; v.devPrev = devOn;
    for (int u = 0; u < v.nu; u++) {
      const double fu = f0 * v.um[u];
      if (!rebuild && !devRe && std::fabs(fu - v.rotF[u]) <= 1e-9 * fu) continue;
      const double k0 = TAU * fu / sr;
      for (int k = 0; k < NX; k++) { if (k >= top && k < HM_MAXP) { k = HM_MAXP - 1; continue; } const double d = k0 * v.vm[k] * (k < HM_MAXP && devRe ? pexp2(v.ldm[k]) : 1.0); if (d < PI) rot(d, v.cr[u][k], v.sr[u][k]); else { v.cr[u][k] = 1; v.sr[u][k] = 0; } }
      v.rotF[u] = fu;
    }
    // per-partial gain: timbres, filters (relative to the moved cutoffs), harmonic tilt and phase, Nyquist taper (the highest copy)
    const double mix = clampd(p[HM_MIX] + (ed[HM_E_MIX].on ? ev[HM_E_MIX] * ed[HM_E_MIX].depth : 0) + lm[HM_LD_MIX], 0, 1);
    const double w1 = (1 - mix) * std::max(0.0, p[HM_T_LEVEL]), w2 = mix * std::max(0.0, p[HM_T_LEVEL + 10]);
    const bool morph = p[HM_BLEND] > 0.5; const double sub = clampd(p[HM_SUB], 0, 1);
    double umax = 1; for (int u = 0; u < v.nu; u++) umax = std::max(umax, (double)v.um[u]);
    bool fOn[2]; double fx0[2], fmix[2]; int ftype[2];
    for (int f = 0; f < 2; f++) {
      const int b0 = 10 * f; fOn[f] = p[HM_F_ON + b0] > 0.5; if (!fOn[f]) continue;
      ftype[f] = (int)std::lround(p[HM_F_TYPE + b0]); fmix[f] = clampd(p[HM_F_MIX + b0], 0, 1);
      double cut = std::log2(clampd(p[HM_F_CUT + b0], 16, 22000)) + clampd(p[HM_F_KEY + b0], 0, 1) * (v.pitch - 60) / 12.0;
      const int ee = f ? HM_E_CUT2 : HM_E_CUT1; if (ed[ee].on) cut += ev[ee] * ed[ee].depth * 8;
      cut += lm[f ? HM_LD_CUT2 : HM_LD_CUT1] * 4 + clampd(p[HM_VEL_FLT], 0, 1) * 4 * (v.vel - 0.5);
      fx0[f] = cut;
      if (ftype[f] == HM_FORMANT) { double vowel = clampd((cut - std::log2(200.0)) / (std::log2(5000.0) - std::log2(200.0)) * 4, 0, 4), res = clampd(p[HM_F_RES + b0], 0, 1); if (std::fabs(vowel - fmtVowel) > 0.005 || res != fmtRes) buildFormant(vowel, res); }
    }
    const double tilt = ed[HM_E_HLEVEL].on ? ev[HM_E_HLEVEL] * ed[HM_E_HLEVEL].depth * 12 : 0;   // dB per octave of harmonic number
    const double hph = (ed[HM_E_HPHASE].on ? ev[HM_E_HPHASE] * ed[HM_E_HPHASE].depth : 0) + lm[HM_LD_HPHASE];
    const double plA = clampd(p[HM_PLUCK_AMT], 0, 1), plT = std::max(0.01, p[HM_PLUCK_TIME]), plD = clampd(p[HM_PLUCK_DAMP], 0, 1);
    const double blA = std::max(0.0, p[HM_BLUR_ATT]), blR = std::max(0.0, p[HM_BLUR_REL]), blH = clampd(p[HM_BLUR_HARM], 0, 1); const bool blur = blA > 0 || blR > 0;
    const double spD = clampd(p[HM_SPH_DEPTH], 0, 1), spN = clampd(p[HM_SPH_DENS], 0.1, 8), spO = p[HM_SPH_OFS]; const int spP = 1 + (int)std::lround(clampd(p[HM_SPH_SHARP], 0, 1) * 15);
    const bool st = mapOn && mp.stereo;
    if (st && !v.stPrev) for (int k = 0; k < NX; k++) { v.XR[k] = v.X[k]; v.YR[k] = v.Y[k]; }
    v.stPrev = st;
    for (int u = 0; u < v.nu; u++) { std::memset(buf[u], 0, sizeof(float) * m); if (st) std::memset(bufR[u], 0, sizeof(float) * m); }
    const double lflo = mapOn ? std::log2(mp.flo) : 0, lfspan = mapOn ? std::log2(mp.fhi) - lflo : 1;
    const float inv = 1.0f / m; int last = 0;
    for (int k = 0; k < NX; k++) {
      if (k >= top && k < HM_MAXP) { k = HM_MAXP - 1; continue; }   // jump to the sub partials
      const double dv = devOn && k < HM_MAXP ? v.ldm[k] : 0, lf = l2f0 + v.lvm[k] + dv, f = f0 * v.vm[k] * (dv != 0 ? pexp2(dv) : 1.0), fh = f * umax;
      double g = fh >= 0.47 * sr ? 0 : fh > 0.40 * sr ? (0.47 * sr - fh) / (0.07 * sr) : 1;
      float tx = 0, ty = 0, txR = 0, tyR = 0;
      if (g > 0 && ((k < HM_MAXP && k < want) || (k >= HM_MAXP && sub > 0))) {
        for (int fi = 0; fi < 2; fi++) if (fOn[fi]) { const double h = ftype[fi] == HM_FORMANT ? fmtAt(lf) : flt(fi, lf - fx0[fi]); g *= 1 - fmix[fi] + fmix[fi] * h; }
        if (tilt != 0 && k < HM_MAXP) g *= pexp2(tilt / 6.0206 * l2k[k]);
        if (plA > 0 && k < HM_MAXP) g *= 1 - plA + plA * pexp2(-v.t / (plT / (1 + 8 * plD * l2k[k])) * 1.4426950408889634);   // Pluck
        if (spD > 0) { double u0 = lf * spN + spO + sphPh; u0 -= std::floor(u0); double c = 0.5 + 0.5 * pcos(TAU * u0), cn = c; for (int j = 1; j < spP; j++) cn *= c; g *= 1 - spD * cn; }   // spectral phaser
        if (k < HM_MAXP) {
          const double a1 = w1 * tb[0].a[k], a2 = w2 * tb[1].a[k];
          double x, y;
          if (!morph) { x = a1 * v.e1x[k] + a2 * v.e2x[k]; y = a1 * v.e1y[k] + a2 * v.e2y[k]; }
          else {                                         // morph: amplitude and phase direction interpolated
            double A = a1 + a2, dx = (1 - mix) * v.e1x[k] + mix * v.e2x[k], dy = (1 - mix) * v.e1y[k] + mix * v.e2y[k], l = std::sqrt(dx * dx + dy * dy);
            if (l < 1e-6) { dx = v.e1x[k]; dy = v.e1y[k]; l = 1; }
            x = A * dx / l; y = A * dy / l;
          }
          double xR = x, yR = y;
          if (mapOn) {                                   // the map's amplitude at this partial (left / right), mixed with the timbres
            double b;
            if (mp.layout == HM_MAP_LOGF) b = (lf - mshift - lflo) / lfspan * (mp.bins - 1);
            else b = (fbase > 0 && p[HM_MAP_FORMANT] > 0.5 ? (k + 1) * f0 / fbase : (double)(k + 1)) * pexp2(-mshift) - 1;
            const double aL = mapAt(mp.aL, mp.bins, mf0, mf1, mff, b) * mLev, aR = st ? mapAt(mp.aR, mp.bins, mf0, mf1, mff, b) * mLev : aL;
            x = (1 - mMix) * x + mMix * aL * v.emx[k]; y = (1 - mMix) * y + mMix * aL * v.emy[k];
            xR = (1 - mMix) * xR + mMix * aR * v.emx[k]; yR = (1 - mMix) * yR + mMix * aR * v.emy[k];
          }
          if (hph != 0) { double a = std::fmod(std::fabs(hph) * PI * l2k[k], TAU); float cc, ss; if (a >= PI) a -= TAU; rot(std::fabs(a), cc, ss); if ((a < 0) != (hph < 0)) ss = -ss; double x2 = x * cc - y * ss; y = x * ss + y * cc; x = x2; x2 = xR * cc - yR * ss; yR = xR * ss + yR * cc; xR = x2; }
          tx = (float)(g * x); ty = (float)(g * y); txR = (float)(g * xR); tyR = (float)(g * yR);
        } else { tx = (float)(sub * (k == HM_MAXP ? 0.5 : 0.25) * g); txR = tx; }
      }
      if (f >= nyq) tx = ty = txR = tyR = 0;
      if (blur) {                                      // Blur: the coefficients follow their target slowly (rising: attack, falling: release)
        if (v.fresh) { v.X[k] = v.Y[k] = v.XR[k] = v.YR[k] = 0; }
        const double cur = (double)v.X[k] * v.X[k] + (double)v.Y[k] * v.Y[k], tg = (double)tx * tx + (double)ty * ty, tau = (tg > cur ? blA : blR) * (1 + 3 * blH * std::max(0.0f, l2k[k]));
        if (tau > 0) { const float al = (float)(1 - pexp2(-dt / tau * 1.4426950408889634)); tx = v.X[k] + (tx - v.X[k]) * al; ty = v.Y[k] + (ty - v.Y[k]) * al; txR = v.XR[k] + (txR - v.XR[k]) * al; tyR = v.YR[k] + (tyR - v.YR[k]) * al; }
      } else if (v.fresh) { v.X[k] = tx; v.Y[k] = ty; v.XR[k] = txR; v.YR[k] = tyR; }
      const float x0 = v.X[k], y0 = v.Y[k], xr0 = v.XR[k], yr0 = v.YR[k];
      if (x0 == 0 && y0 == 0 && tx == 0 && ty == 0 && (!st || (xr0 == 0 && yr0 == 0 && txR == 0 && tyR == 0))) continue;
      if (k < HM_MAXP) last = k + 1;
      const float dx = (tx - x0) * inv, dy = (ty - y0) * inv;
      if (!st) for (int u = 0; u < v.nu; u++) {
        float c = v.c[u][k], s = v.s[u][k], x = x0, y = y0; const float cr = v.cr[u][k], sn = v.sr[u][k]; float* bu = buf[u];
        for (int i = 0; i < m; i++) { bu[i] += s * x + c * y; const float c2 = c * cr - s * sn; s = s * cr + c * sn; c = c2; x += dx; y += dy; }
        const float g2 = 1.5f - 0.5f * (c * c + s * s);   // keep the oscillator on the unit circle
        v.c[u][k] = c * g2; v.s[u][k] = s * g2;
      }
      else {                                           // stereo map: one oscillator, left and right coefficients
        const float dxr = (txR - xr0) * inv, dyr = (tyR - yr0) * inv;
        for (int u = 0; u < v.nu; u++) {
          float c = v.c[u][k], s = v.s[u][k], x = x0, y = y0, xr = xr0, yr = yr0; const float cr = v.cr[u][k], sn = v.sr[u][k]; float* bu = buf[u]; float* br = bufR[u];
          for (int i = 0; i < m; i++) { bu[i] += s * x + c * y; br[i] += s * xr + c * yr; const float c2 = c * cr - s * sn; s = s * cr + c * sn; c = c2; x += dx; y += dy; xr += dxr; yr += dyr; }
          const float g2 = 1.5f - 0.5f * (c * c + s * s);
          v.c[u][k] = c * g2; v.s[u][k] = s * g2;
        }
      }
      v.X[k] = tx; v.Y[k] = ty; v.XR[k] = txR; v.YR[k] = tyR;
    }
    // self-oscillation: a sine at filter 1's resonance frequency (cutoff + resonance offset)
    float so[SUB]; bool soOn = false;
    { const double lvl = fOn[0] ? clampd(p[HM_SELFOSC], 0, 1) * 0.5 : 0, fso = fOn[0] ? pexp2(fx0[0] + clampd(p[HM_F_OFS], -4, 4)) : 0, tgt = fso > 10 && fso < 0.45 * sr ? lvl : 0;
      if (tgt > 0 || v.soX != 0) {
        soOn = true; float cr, sn; rot(TAU * std::min(fso, 0.45 * sr) / sr, cr, sn); float c = v.soC, s = v.soS, x = v.fresh ? (float)tgt : v.soX; const float dx = ((float)tgt - x) * inv;
        for (int i = 0; i < m; i++) { so[i] = s * x; const float c2 = c * cr - s * sn; s = s * cr + c * sn; c = c2; x += dx; }
        const float g2 = 1.5f - 0.5f * (c * c + s * s); v.soC = c * g2; v.soS = s * g2; v.soX = (float)tgt;
      } }
    // the resynthesis residual: one noise source through the band bank, each band's gain ramping to the noise map at this step's map time
    float nzL[SUB], nzR[SUB]; bool nzOn = false;
    const bool wvOn = mapOn && wv.n > 0 && iNoise(g) > 0 && std::fabs(p[HM_MAP_SPEED] - 1) < 1e-3;
    if (wvOn) {                                        // the residual waveform on the map's timeline (same start / loop as the map)
      const float lev = (float)(iNoise(g) * mMix * mLev); const bool loop = iLoop(g);
      const double t0 = iStart(g) * std::max(0, mp.frames - 1) * mp.hop + (v.t - dt), step = wv.sr / sr; double pos = t0 * wv.sr;
      const float* wl = wv.l.data(); const float* wr = wv.r.empty() ? wl : wv.r.data();
      const double mDur = std::max(0, mp.frames - 1) * mp.hop, wBeg = iStart(g) * mDur * wv.sr, wEnd = std::max(wBeg + 1, iEnd(g) * mDur * wv.sr);   // Map Start .. Map End
      for (int i = 0; i < m; i++, pos += step) {
        double q = pos; if (loop) { if (q > wEnd) q = wBeg + std::fmod(q - wBeg, std::max(1.0, wEnd - wBeg)); if (q < 0) q = 0; } if (q >= std::min((double)wv.n - 1, wEnd) || q < 0) { nzL[i] = nzR[i] = 0; continue; }
        const int a = (int)q, b = a + 1 < wv.n ? a + 1 : 0; const float fr = (float)(q - a);
        nzL[i] = lev * (wl[a] + (wl[b] - wl[a]) * fr); nzR[i] = lev * (wr[a] + (wr[b] - wr[a]) * fr);
      }
      nzOn = true;
    } else if (mapOn && nm.frames > 0 && iNoise(g) > 0) {
      const double tm = (v.t - dt) * clampd(p[HM_MAP_SPEED], 0, 16);
      double fp = iStart(g) * (nm.frames - 1) + tm / nm.hop;
      const bool loop = iLoop(g) && nm.frames > 1;
      fp = mapPos(g, fp, nm.frames, loop);
      const int g0 = (int)fp, g1 = loop ? (g0 + 1) % nm.frames : std::min(g0 + 1, nm.frames - 1); const float gf = p[HM_MAP_INTERP] > 0.5 ? (float)(fp - g0) : 0.f;
      const float lev = (float)(iNoise(g) * mMix * mLev), *rL0 = nm.aL.data() + (size_t)g0 * nm.bands, *rL1 = nm.aL.data() + (size_t)g1 * nm.bands;
      const float *rR0 = nm.stereo ? nm.aR.data() + (size_t)g0 * nm.bands : rL0, *rR1 = nm.stereo ? nm.aR.data() + (size_t)g1 * nm.bands : rL1;
      const bool ms = nm.ms && nm.stereo;               // mid / side map: two independent noises, L = M + S, R = M - S
      constexpr float NS = 1.7320508f / 2147483648.f;     // xorshift32 -> uniform noise of unit variance
      std::memset(nzL, 0, sizeof(float) * m); std::memset(nzR, 0, sizeof(float) * m);
      for (int j = 0; j < nm.bands; j++) {
        if (!nOn[j]) continue;
        const float tL = lev * nPg[j] * (rL0[j] + (rL1[j] - rL0[j]) * gf), tR = lev * nPg[j] * (rR0[j] + (rR1[j] - rR0[j]) * gf);
        float gL = v.fresh ? tL : v.ngL[j], gR = v.fresh ? tR : v.ngR[j]; v.ngL[j] = tL; v.ngR[j] = tR;
        if (gL == 0 && tL == 0 && gR == 0 && tR == 0) continue;
        const float dL = (tL - gL) * inv, dR = (tR - gR) * inv, b0 = nb0[j], a1 = na1[j], a2 = na2[j];
        float z0 = v.nz[j][0], z1 = v.nz[j][1], z2 = v.nz[j][2], z3 = v.nz[j][3];
        uint32_t r = v.nr[j][0], r2 = v.nr[j][1];
        if (!ms) for (int i = 0; i < m; i++) {           // two band-pass sections (transposed direct form II, b1 = 0, b2 = -b0)
          r ^= r << 13; r ^= r >> 17; r ^= r << 5;
          const float x = (float)(int32_t)r * NS, y1 = b0 * x + z0; z0 = -a1 * y1 + z1; z1 = -b0 * x - a2 * y1;
          const float y2 = b0 * y1 + z2; z2 = -a1 * y2 + z3; z3 = -b0 * y1 - a2 * y2;
          nzL[i] += y2 * gL; nzR[i] += y2 * gR; gL += dL; gR += dR;
        } else {                                         // gL = mid gain, gR = side gain
          float s0 = v.nzS[j][0], s1 = v.nzS[j][1], s2 = v.nzS[j][2], s3 = v.nzS[j][3];
          for (int i = 0; i < m; i++) {
            r ^= r << 13; r ^= r >> 17; r ^= r << 5; r2 ^= r2 << 13; r2 ^= r2 >> 17; r2 ^= r2 << 5;
            const float x = (float)(int32_t)r * NS, y1 = b0 * x + z0; z0 = -a1 * y1 + z1; z1 = -b0 * x - a2 * y1;
            const float y2 = b0 * y1 + z2; z2 = -a1 * y2 + z3; z3 = -b0 * y1 - a2 * y2;
            const float u = (float)(int32_t)r2 * NS, w1 = b0 * u + s0; s0 = -a1 * w1 + s1; s1 = -b0 * u - a2 * w1;
            const float w2 = b0 * w1 + s2; s2 = -a1 * w2 + s3; s3 = -b0 * w1 - a2 * w2;
            const float mm = y2 * gL, ss = w2 * gR; nzL[i] += mm + ss; nzR[i] += mm - ss; gL += dL; gR += dR;
          }
          v.nzS[j][0] = s0; v.nzS[j][1] = s1; v.nzS[j][2] = s2; v.nzS[j][3] = s3;
        }
        v.nz[j][0] = z0; v.nz[j][1] = z1; v.nz[j][2] = z2; v.nz[j][3] = z3; v.nr[j][0] = r; v.nr[j][1] = r2;
      }
      nzOn = true;
    }
    v.n = last; v.fresh = false;
    // amplitude: volume articulator (or the ADSR), velocity, volume, tremolo; pan; a stolen voice fades out, then its pending note starts
    const double vs = clampd(p[HM_VELS], 0, 1), gain = 0.25 * std::max(0.0, p[HM_VOL]) * ((1 - vs) + vs * v.vel) * clampd(1 + lm[HM_LD_VOL], 0, 2);
    const bool menv = ed[HM_E_VOL].on; const double vd = clampd(ed[HM_E_VOL].depth, 0, 1), vEnd = menv ? (1 - vd) + vd * ev[HM_E_VOL] : 0, vStart = v.volPrev;
    const double pan = clampd(lm[HM_LD_PAN], -1, 1), pa = (pan + 1) * PI / 4, pl = std::cos(pa) * std::sqrt(2.0), pr = std::sin(pa) * std::sqrt(2.0);
    for (int i = 0; i < m; i++) {
      double e = menv ? vStart + (vEnd - vStart) * (i + 1) / m : v.env.next(ap);
      e *= gain;
      float l = 0, r = 0;
      if (!st) { for (int u = 0; u < v.nu; u++) { l += buf[u][i] * v.gl[u]; r += buf[u][i] * v.gr[u]; } if (v.nu == 1) { l = r = buf[0][i]; } }
      else { for (int u = 0; u < v.nu; u++) { l += buf[u][i] * v.gl[u]; r += bufR[u][i] * v.gr[u]; } if (v.nu == 1) { l = buf[0][i]; r = bufR[0][i]; } }
      if (soOn) { l += so[i]; r += so[i]; }
      if (nzOn) { l += nzL[i]; r += nzR[i]; }
      if (v.fade > 0) {
        e *= (double)v.fade / (sr * 0.003 + 1); v.fade--;
        if (v.fade == 0) { L[i] += (float)(l * e * pl); R[i] += (float)(r * e * pr); if (v.pPitch >= 0) { int pp = v.pPitch; double pv = v.pVel; v.on = false; const int ki = nImg; nImg = v.pImg; start(v, pp, pv, -1); nImg = ki; } else v.on = false; return; }
      }
      L[i] += (float)(l * e * pl); R[i] += (float)(r * e * pr);
    }
    v.volPrev = vEnd; v.lastEnv = (float)((menv ? vEnd : v.env.v) * gain / 0.25);
    if (menv) { if (v.es[HM_E_VOL].done && (!v.held || v.es[HM_E_VOL].val <= 0) && vEnd <= 1e-5 && v.fade == 0) v.on = false; }
    else if (v.env.st == 0 && v.fade == 0) v.on = false;
  }
};

}  // namespace

Instrument* makeHarmor(double sr, Bank* bank) { return new Harmor(sr, bank); }

}  // namespace mdaw
