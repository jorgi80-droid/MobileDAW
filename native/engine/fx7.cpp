// Port of js/engine/fx7.js AudioEffectRack (same order of operations; Float32Array storage = float).
#include "fx7.h"
#include <cmath>
#include <cstdlib>

namespace mdaw {

AudioEffectRack::AudioEffectRack(double r) : sr(r) {
  isRack = true; hasTr = true;
  for (auto& v : p) v = 0;
  int k = 0;
  for (int c = 0; c < RACK_CHAINS; c++) { p[k++] = 0; p[k++] = 0; p[k++] = 1; p[k++] = 0; }
  p[k++] = 1;
  for (int m = 0; m < RACK_MACROS; m++) p[k++] = 0;
  for (int m = 0; m < RACK_MACROS; m++) { const double d[8] = { -1, 0, 0, 0, 1, 0, 0, 1 }; for (double x : d) p[k++] = x; }
  p[k++] = 0;
  for (int c = 0; c < RACK_CHAINS; c++) { p[k++] = 0; p[k++] = 127; }
  for (auto& v : last) v = NAN;
  mem = (float*)std::calloc((size_t)RACK_CHAINS * 2 * PDC_MAX, sizeof(float));
  for (int c = 0; c < RACK_CHAINS; c++) { ch[c].pdl.L = mem + (size_t)c * 2 * PDC_MAX; ch[c].pdl.R = ch[c].pdl.L + PDC_MAX; }
}
AudioEffectRack::~AudioEffectRack() { for (auto& c : ch) for (int j = 0; j < c.n; j++) delete c.dev[j]; std::free(mem); }

void AudioEffectRack::setParam(int i, double v) {
  if (i < 0 || i >= RACK_NP) return;
  p[i] = v; if (i >= RACK_MAP0 && i < RACK_MAP0 + 64) last[(i - RACK_MAP0) / 8] = NAN;
}
void AudioEffectRack::setTempo(double b) { bpm = b; for (auto& c : ch) for (int j = 0; j < c.n; j++) c.dev[j]->setTempo(b); }
void AudioEffectRack::tr(bool playing, double beat) { for (auto& c : ch) for (int j = 0; j < c.n; j++) if (c.dev[j]->hasTr) c.dev[j]->tr(playing, beat); }

static inline bool idx(double c, int n, int& out) { if (!(c >= 0 && c < n) || c != std::floor(c)) return false; out = (int)c; return true; }   // JS this.ch[c]: undefined unless an integer in range

int AudioEffectRack::rackCmd(int op, double c, double j, double a, double b, Device* prep, Device** removed) {
  int nr = 0;
  if (op == 0) { for (auto& x : ch) { for (int q = 0; q < x.n; q++) { removed[nr++] = x.dev[q]; x.dev[q] = nullptr; } x.n = 0; } for (auto& v : last) v = NAN; if (prep) removed[nr++] = prep; return nr; }
  int ci; if (!idx(c, RACK_CHAINS, ci)) { if (prep) removed[nr++] = prep; return nr; }
  RackChain& x = ch[ci];
  if (op == 1) {
    if (prep && x.n < RACK_DEV) { int at = (int)std::trunc(clamp(j, 0, x.n)); for (int q = x.n; q > at; q--) x.dev[q] = x.dev[q - 1]; x.dev[at] = prep; x.n++; }   // tempo set by the engine (JS e.mk)
    else if (prep) removed[nr++] = prep;
    for (auto& v : last) v = NAN; return nr;
  }
  if (prep) removed[nr++] = prep;
  if (op == 4) { int jj = (int)std::trunc(j); if (j >= 0 && j < x.n) { removed[nr++] = x.dev[jj]; for (int q = jj; q < x.n - 1; q++) x.dev[q] = x.dev[q + 1]; x.dev[--x.n] = nullptr; } for (auto& v : last) v = NAN; return nr; }
  int jj; if (!idx(j, x.n, jj)) return nr;
  Device* d = x.dev[jj];
  if (op == 2) d->setParam((int)a, b); else if (op == 3) d->bypass = a != 0;
  return nr;
}

void AudioEffectRack::macros() {
  for (int m = 0; m < RACK_MACROS; m++) {
    int o = RACK_MAP0 + m * 8; double c = jsRound(p[o]); if (c < 0) continue;
    int ci; if (!idx(c, RACK_CHAINS, ci)) continue;
    double j = jsRound(p[o + 1]);
    Device* d = nullptr; Instrument* in = nullptr;
    if (j < 0) { in = chainInst[ci]; if (!in) continue; }                    // j = -1: the chain's instrument (Instrument Rack)
    else { int jj; if (!idx(j, ch[ci].n, jj)) continue; d = ch[ci].dev[jj]; }
    double lo = p[o + 3], hi = p[o + 4]; bool lg = p[o + 5] > 0.5 && lo > 0 && hi > 0;
    double q = clamp(p[o + 6] + (p[o + 7] - p[o + 6]) * p[33 + m], 0, 1);
    double v = lg ? lo * std::pow(hi / lo, q) : lo + q * (hi - lo);
    if (v != last[m]) { last[m] = v; if (d) d->setParam((int)jsRound(p[o + 2]), v); else in->setParam((int)jsRound(p[o + 2]), v); }
  }
}
int AudioEffectRack::chainLat(int c) const { int l = 0; const RackChain& x = ch[c]; for (int q = 0; q < x.n; q++) if (!x.dev[q]->bypass) l += x.dev[q]->lat(); return l; }
int AudioEffectRack::lat() {
  int cnt = (int)clamp(jsRound(p[32]), 0, RACK_CHAINS), m = 0;
  for (int c = 0; c < cnt; c++) { int l = chainLat(c); if (l > m) m = l; }
  return m < PDC_MAX - 1 ? m : PDC_MAX - 1;
}
void AudioEffectRack::align(int c, float* bl, float* br, int n, int M) { int cl = chainLat(c), D = M - (M < cl ? M : cl); if (D > 0) ch[c].pdl.run(bl, br, n, D); else ch[c].pdl.clear(); }

void AudioEffectRack::process(float* Lx, float* Rx, int n) {
  macros();
  int cnt = (int)clamp(jsRound(p[32]), 0, RACK_CHAINS); if (!cnt) return;
  bool solo = false; for (int c = 0; c < cnt; c++) if (p[c * 4 + 3] > 0.5 && p[c * 4 + 2] > 0.5) solo = true;
  int M = lat();
  for (int i = 0; i < n; i++) { sL[i] = 0; sR[i] = 0; }
  for (int c = 0; c < cnt; c++) {
    int o = c * 4; double sel = p[105];
    if (p[o + 2] < 0.5 || (solo && p[o + 3] < 0.5) || sel < p[106 + c * 2] || sel > p[107 + c * 2]) { pk[c] = (float)(pk[c] * 0.9); ch[c].pdl.clear(); continue; }
    for (int i = 0; i < n; i++) { L[i] = Lx[i]; R[i] = Rx[i]; }
    for (int q = 0; q < ch[c].n; q++) if (!ch[c].dev[q]->bypass) ch[c].dev[q]->process(L, R, n);
    align(c, L, R, n, M);
    double g = p[o] <= -60 ? 0 : std::pow(10, p[o] / 20), pan = p[o + 1], gl = g * jsMin(1, 1 - pan), gr = g * jsMin(1, 1 + pan), pkv = 0;
    for (int i = 0; i < n; i++) { double l = L[i] * gl, r = R[i] * gr; sL[i] = (float)(sL[i] + l); sR[i] = (float)(sR[i] + r); double a = jsMax(std::fabs(l), std::fabs(r)); if (a > pkv) pkv = a; }
    pk[c] = (float)jsMax(pkv, pk[c] * 0.95);
  }
  for (int i = 0; i < n; i++) { Lx[i] = sL[i]; Rx[i] = sR[i]; }
}

// ================================================================ Instrument Rack
InstrumentRack::InstrumentRack(double r) : core(r), sr(r) {
  isRack = true; pitchNative = false;
  for (int c = 0; c < RACK_CHAINS; c++) { core.p[122 + c * 2] = 0; core.p[123 + c * 2] = 127; core.p[138 + c * 2] = 1; core.p[139 + c * 2] = 127; }
}
bool InstrumentRack::plays(int c, int pitch, double v) const {
  const double* q = core.p; double vel = jsMax(1, jsRound(v * 127)), sel = q[105];
  return q[c * 4 + 2] > 0.5 && pitch >= q[122 + c * 2] && pitch <= q[123 + c * 2] && vel >= q[138 + c * 2] && vel <= q[139 + c * 2] && sel >= q[106 + c * 2] && sel <= q[107 + c * 2];
}
void InstrumentRack::noteOn(int pitch, double vel) {
  int cnt = (int)clamp(jsRound(core.p[32]), 0, RACK_CHAINS), mask = 0;
  for (int c = 0; c < cnt; c++) if (core.chainInst[c] && plays(c, pitch, vel)) { core.chainInst[c]->noteOn(pitch, vel); mask |= 1 << c; }
  held[pitch & 127] |= (uint8_t)mask;
}
void InstrumentRack::noteOff(int pitch) {
  int mask = held[pitch & 127];
  for (int c = 0; c < RACK_CHAINS; c++) if ((mask & (1 << c)) && core.chainInst[c]) core.chainInst[c]->noteOff(pitch);
  held[pitch & 127] = 0;
}
void InstrumentRack::render(float*, float*, int from, int to) {
  int cnt = (int)clamp(jsRound(core.p[32]), 0, RACK_CHAINS);
  for (int c = 0; c < cnt; c++) if (core.chainInst[c]) core.chainInst[c]->render(cL[c], cR[c], from, to);
}
void InstrumentRack::endBlock(float* L, float* R, int n) {
  core.macros();
  const double* p = core.p; int cnt = (int)clamp(jsRound(p[32]), 0, RACK_CHAINS), M = core.lat();
  bool solo = false; for (int c = 0; c < cnt; c++) if (p[c * 4 + 3] > 0.5 && p[c * 4 + 2] > 0.5) solo = true;
  for (int c = 0; c < cnt; c++) {
    int o = c * 4; float* bl = cL[c]; float* br = cR[c]; RackChain& x = core.ch[c];
    if (p[o + 2] > 0.5 && !(solo && p[o + 3] < 0.5)) {
      for (int q = 0; q < x.n; q++) if (!x.dev[q]->bypass) x.dev[q]->process(bl, br, n);
      core.align(c, bl, br, n, M);
      double g = p[o] <= -60 ? 0 : std::pow(10, p[o] / 20), pan = p[o + 1], gl = g * jsMin(1, 1 - pan), gr = g * jsMin(1, 1 + pan), pk = 0;
      for (int i = 0; i < n; i++) { double l = bl[i] * gl, r = br[i] * gr; L[i] = (float)(L[i] + l); R[i] = (float)(R[i] + r); double a = jsMax(std::fabs(l), std::fabs(r)); if (a > pk) pk = a; }
      core.pk[c] = (float)jsMax(pk, core.pk[c] * 0.95);
    } else { core.pk[c] = (float)(core.pk[c] * 0.9); x.pdl.clear(); }
    for (int i = 0; i < n; i++) { bl[i] = 0; br[i] = 0; }
  }
}
void InstrumentRack::rackCmd(int op, double c, double j, double a, double b, Device* prepD, Instrument* prepI, Device** rmD, int& nD, Instrument** rmI, int& nI) {
  nD = 0; nI = 0;
  if (op == 0) { for (auto*& x : core.chainInst) { if (x) { x->allOff(); rmI[nI++] = x; } x = nullptr; } for (auto& h : held) h = 0; }
  int ci; bool has = c >= 0 && c < RACK_CHAINS && c == std::floor(c); ci = has ? (int)c : 0;
  if (op == 5) {
    if (has) { if (core.chainInst[ci]) rmI[nI++] = core.chainInst[ci]; core.chainInst[ci] = a > 0 ? prepI : nullptr; if (core.chainInst[ci]) core.chainInst[ci]->setTempo(core.bpm); else if (prepI) rmI[nI++] = prepI; for (auto& v : core.last) v = NAN; }
    else if (prepI) rmI[nI++] = prepI;
    if (prepD) rmD[nD++] = prepD; return;
  }
  if (prepI) rmI[nI++] = prepI;
  if (op == 6) { if (has && core.chainInst[ci]) core.chainInst[ci]->setParam((int)a, b); if (prepD) rmD[nD++] = prepD; return; }
  nD = core.rackCmd(op, c, j, a, b, prepD, rmD);
}

}  // namespace mdaw
