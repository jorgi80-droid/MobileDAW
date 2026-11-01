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
    double j = jsRound(p[o + 1]); int jj; if (j < 0 || !idx(j, ch[ci].n, jj)) continue;   // j = -1 (chain instrument) only exists in the Instrument Rack
    Device* d = ch[ci].dev[jj];
    double lo = p[o + 3], hi = p[o + 4]; bool lg = p[o + 5] > 0.5 && lo > 0 && hi > 0;
    double q = clamp(p[o + 6] + (p[o + 7] - p[o + 6]) * p[33 + m], 0, 1);
    double v = lg ? lo * std::pow(hi / lo, q) : lo + q * (hi - lo);
    if (v != last[m]) { last[m] = v; d->setParam((int)jsRound(p[o + 2]), v); }
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

}  // namespace mdaw
