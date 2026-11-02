#include "fx8.h"
#include <cmath>

namespace mdaw {

static const double TS_B[6] = {0.125, 0.25, 0.5, 1, 2, 4};
static const int LIVE = 0, STOPPING = 1, STOPPED = 2, STARTING = 3, REJOIN = 4, XF = 512;

TapeStop::TapeStop(double rate) : sr(rate) {
  double d[7] = {1, 1, 0.5, 3, 0.5, 2, 0.5};
  for (int i = 0; i < 7; i++) p[i] = d[i];
  blen = (int)std::ceil(sr * 10); bl.assign((size_t)blen, 0.f); br.assign((size_t)blen, 0.f);
  stt = LIVE;
}
double TapeStop::curveK() { return std::pow(2.0, (0.5 - clamp(p[6], 0, 1)) * 4); }
double TapeStop::timeOf(double sec, double beatsIdx) {
  double s = p[1] > 0.5 ? TS_B[(int)clamp(jsRound(beatsIdx), 0, 5)] * 60 / bpm : sec;
  return jsMax(1, clamp(s, 0.005, 8) * sr);
}
double TapeStop::rd(const std::vector<float>& b, double pos) {
  int i = (int)std::floor(pos); double f = pos - i;
  int i0 = (i - 1 + blen) % blen, i1 = i % blen, i2 = (i + 1) % blen, i3 = (i + 2) % blen;
  double a = b[i0], c = b[i1], d = b[i2], e = b[i3];
  return c + 0.5 * f * (d - a + f * (2 * a - 5 * c + 4 * d - e + f * (3 * (c - d) + e - a)));
}
void TapeStop::setParam(int i, double v) {
  bool was = p[0] > 0.5; p[i] = v;
  if (i != 0) return;
  bool play = v > 0.5;
  if (play == was) return;
  double k = curveK();
  if (!play) {
    if (stt == LIVE || stt == REJOIN) { rp = w - 1; if (rp < 0) rp += blen; x = 0; }
    else if (stt == STARTING) x = 1 - std::pow(speed, 1 / k);
    stt = STOPPING;
  } else {
    if (stt == STOPPED) { rp = w - 1; if (rp < 0) rp += blen; x = 0; }
    else if (stt == STOPPING) x = std::pow(speed, 1 / k);
    stt = STARTING;
  }
}
void TapeStop::process(float* L, float* R, int n) {
  int N = blen; double k = curveK();
  double tStop = timeOf(p[4], p[5]), tStart = timeOf(p[2], p[3]);
  for (int i = 0; i < n; i++) {
    double xl = L[i], xr = R[i];
    bl[w] = (float)xl; br[w] = (float)xr; if (++w >= N) w = 0;
    switch (stt) {
      case LIVE: break;
      case STOPPING: {
        speed = std::pow(jsMax(0, 1 - x), k); x += 1 / tStop;
        L[i] = (float)(rd(bl, rp) * jsMin(1, speed * 8)); R[i] = (float)(rd(br, rp) * jsMin(1, speed * 8));
        rp += speed; if (rp >= N) rp -= N;
        if (x >= 1) { stt = STOPPED; speed = 0; }
        break;
      }
      case STOPPED: L[i] = 0; R[i] = 0; break;
      case STARTING: {
        speed = std::pow(jsMin(1, x), k); x += 1 / tStart;
        L[i] = (float)(rd(bl, rp) * jsMin(1, speed * 8)); R[i] = (float)(rd(br, rp) * jsMin(1, speed * 8));
        rp += speed; if (rp >= N) rp -= N;
        if (x >= 1) { stt = REJOIN; xf = 0; speed = 1; }
        break;
      }
      case REJOIN: {
        double g = (double)xf / XF; L[i] = (float)(rd(bl, rp) * (1 - g) + xl * g); R[i] = (float)(rd(br, rp) * (1 - g) + xr * g);
        rp += 1; if (rp >= N) rp -= N;
        if (++xf >= XF) stt = LIVE;
        break;
      }
      default: break;
    }
  }
}
int TapeStop::readOut(float* o) { o[0] = (float)stt; o[1] = (float)((stt == LIVE || stt == REJOIN) ? 1.0 : speed); return 2; }

}  // namespace mdaw
