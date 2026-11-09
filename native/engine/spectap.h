// SpecTap: the display analyser behind an effect's curve (EQ Eight, Auto Filter), as js/engine/dsp.js SpecTap. Display only.
#pragma once
#include <cmath>
namespace mdaw {
struct SpecTap {
  float sb[4096] = {}; unsigned sw = 0; float sav[128]; double re[2048], im[2048];
  SpecTap() { for (auto& v : sav) v = -150; }
  void push(double x) { sb[sw & 4095] = (float)x; sw = (sw + 1) & 0x7fffffffu; }
  static void fft(double* r, double* m, int n) {
    for (int i = 1, j = 0; i < n; i++) { int bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { double t = r[i]; r[i] = r[j]; r[j] = t; t = m[i]; m[i] = m[j]; m[j] = t; } }
    for (int len = 2; len <= n; len <<= 1) { double a = -2 * 3.14159265358979323846 / len, wr = std::cos(a), wi = std::sin(a);
      for (int i = 0; i < n; i += len) { double cr = 1, ci = 0; for (int k = 0; k < len / 2; k++) { int u = i + k, v = u + len / 2; double tr = r[v] * cr - m[v] * ci, ti = r[v] * ci + m[v] * cr; r[v] = r[u] - tr; m[v] = m[u] - ti; r[u] += tr; m[u] += ti; double nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } } }
  }
  int read(float* o, int off, double sr) {
    const int n = 2048; double nyq = sr / 2;
    for (int k = 0; k < n; k++) { re[k] = sb[(sw - n + k) & 4095] * (0.5 - 0.5 * std::cos(2 * 3.14159265358979323846 * k / (n - 1))); im[k] = 0; }
    fft(re, im, n);
    for (int b = 0; b < 128; b++) {
      double f0 = 20 * std::pow(1000, b / 128.0), f1 = 20 * std::pow(1000, (b + 1) / 128.0); int k0 = (int)std::floor(f0 / nyq * n / 2), k1 = (int)std::fmax(k0 + 1, std::ceil(f1 / nyq * n / 2)); double m = 0;
      for (int k = k0; k < k1 && k < n / 2; k++) { double v = re[k] * re[k] + im[k] * im[k]; if (v > m) m = v; }
      double db = 10 * std::log10(m / ((double)n * n / 16) + 1e-16); sav[b] = (float)(sav[b] + (db - sav[b]) * 0.5); o[off + b] = sav[b];
    }
    return 128;
  }
};
}  // namespace mdaw
