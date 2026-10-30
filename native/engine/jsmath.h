// Numeric helpers that behave exactly like the JavaScript engine (js/engine/*.js), which is the reference.
// Rules for every file of the C++ engine, so the output matches the JS engine sample for sample:
//  - scalar maths in double (JS numbers), audio buffers in float (JS Float32Array): `buf[i] += x` is buf[i] = float(double(buf[i]) + x)
//  - keep the order of operations of the JS source (no algebraic rewrites), and build with -ffp-contract=off (no fused multiply-add)
//  - Math.round is NOT std::round (ties go to +infinity in JS); `x | 0` truncates toward zero
#pragma once
#include <cmath>
#include <cstdint>

namespace mdaw {

constexpr double PI = 3.141592653589793;   // Math.PI
constexpr double TWO_PI = PI * 2;          // dsp.js TWO_PI
constexpr int BLOCK = 128;                 // dsp.js BLOCK

inline double jsRound(double x) {          // Math.round
  if (!std::isfinite(x)) return x;
  double f = std::floor(x);
  return (x - f >= 0.5) ? f + 1 : f;
}
inline int32_t toInt32(double x) {         // x | 0
  if (!std::isfinite(x)) return 0;
  double t = std::trunc(x);
  double m = std::fmod(t, 4294967296.0);
  if (m < 0) m += 4294967296.0;
  uint32_t u = (uint32_t)m;
  return (int32_t)u;
}
inline double clamp(double v, double lo, double hi) { return v < lo ? lo : v > hi ? hi : v; }   // dsp.js clamp (NaN passes through)
inline double jsMax(double a, double b) { if (a != a || b != b) return NAN; return a > b ? a : (a < b ? b : (a == 0 && std::signbit(a) ? b : a)); }
inline double jsMin(double a, double b) { if (a != a || b != b) return NAN; return a < b ? a : (a > b ? b : (a == 0 && !std::signbit(a) ? b : a)); }

}  // namespace mdaw
