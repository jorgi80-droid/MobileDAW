// Plugin delay compensation helpers (ports of dsp.js PDC_MAX / pdcCap / PdcLine / ClickLine), shared by the engine and the racks.
#pragma once
#include <cstring>

namespace mdaw {

constexpr int PDC_MAX = 16384;        // core.js / dsp.js: longest compensation per path + 1 (frames, power of two)
inline int pdcCap(int D) { int c = 512; while (c <= D && c < PDC_MAX) c *= 2; return c; }

// dsp.js PdcLine: stereo PDC delay ring. The storage (PDC_MAX frames) is handed in by the engine at construction (calloc: untouched pages
// cost no RAM); n is the ring size JS would have allocated, so growing starts from silence exactly as in JS.
struct PdcLine {
  float* L = nullptr; float* R = nullptr; int n = 0, w = 0; bool used = false;
  void run(float* x, float* y, int cnt, int D) {
    if (D >= n) { n = pdcCap(D); std::memset(L, 0, sizeof(float) * n); std::memset(R, 0, sizeof(float) * n); w = 0; }
    int M = n - 1;
    for (int i = 0; i < cnt; i++) { L[w] = x[i]; R[w] = y[i]; int r = (w - D) & M; x[i] = L[r]; y[i] = R[r]; w = (w + 1) & M; }
    used = true;
  }
  void clear() { if (used) { std::memset(L, 0, sizeof(float) * n); std::memset(R, 0, sizeof(float) * n); used = false; } }
};
// dsp.js ClickLine: mono, double precision
struct ClickLine {
  double* b = nullptr; int n = 0, w = 0; bool used = false;
  template <class T> void run(T* x, int cnt, int D) {
    if (D >= n) { n = pdcCap(D); std::memset(b, 0, sizeof(double) * n); w = 0; }
    int M = n - 1;
    for (int i = 0; i < cnt; i++) { b[w] = x[i]; x[i] = (T)b[(w - D) & M]; w = (w + 1) & M; }
    used = true;
  }
  void clear() { if (used) { std::memset(b, 0, sizeof(double) * n); used = false; } }
};

}  // namespace mdaw
