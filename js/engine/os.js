// 4x oversampling around a nonlinear effect (= native/engine/os.h, the same arithmetic in doubles, Float32Array blocks as the C++ floats):
// the effect runs at 4 x the engine rate between a linear-phase interpolation filter and a decimation filter (one 129-tap windowed sinc,
// Kaiser beta 8, cut-off at the engine's Nyquist), so the harmonics its curve makes above Nyquist are filtered out instead of folding back
// as inharmonic aliases. Latency 32 frames + the effect's own / 4 (PDC).
export const OS_K = 4, OS_TAPS = 129, OS_SUB = 32, OS_LAT = 32;
// the filter: a 129-tap windowed sinc (Kaiser beta 8, cut-off 1/8 of the 4x rate = the engine's Nyquist, unity DC gain), stored as literals
// (= native/engine/os.h, bit-identical on every platform); first half, the rest mirrors
const OS_HALF = [-2.2793406192118978e-20, -0.000013044848518897293, -0.000027075575998030824, -0.000026727957584233550, 2.7449107506564883e-19, 0.000047236731696784379, 0.000085786022021262074, 0.000076560461249701830, -2.3092205157170335e-19, -0.00011701467671170988, -0.00020114803229090693, -0.00017125979008406793, -5.6699522968344124e-19, 0.00024231879525530361, 0.00040333615933344359, 0.00033359528029501041, -8.0635266320076606e-19, -0.00044889373476711175, -0.00073094453934346017, -0.00059244509268003621, 4.6860942895795029e-18, 0.00076894172689418025, 0.0012319907654951931, 0.00098358784547470171, -1.9172281272452542e-18, -0.0012421736606075822, -0.0019656715250163420, -0.0015511851717476127, 2.6916868577606445e-18, 0.0019179665276436964, 0.0030060628837892869, 0.0023509597148402132, -3.5958762700449054e-18, -0.0028600584933125401, -0.0044501914904047325, -0.0034571331123827071, 4.5985173630431555e-18, 0.0041568149322780256, 0.0064357207697408169, 0.0049776860699849998, -5.6538840433944423e-18, -0.0059441189763904312, -0.0091808002964131729, -0.0070891961968622156, 6.7047219816496173e-18, 0.0084595015873546280, 0.013080441606844580, 0.010123317691569524, -7.6868994151664943e-18, -0.012185399781257837, -0.018971667179607715, -0.014815398152203844, 8.5353127995922083e-18, 0.018307285429310031, 0.029038056364666699, 0.023218001739302128, -9.1903553831358893e-18, -0.030743731817464936, -0.051333373193474308, -0.043999154832933540, 9.6041370455141142e-18, 0.074413496592101641, 0.15857790316932435, 0.22487850744868104, 0.25000546362582182];
let H = null;
export function osTaps() { if (!H) { H = new Float64Array(OS_TAPS); for (let i = 0; i < OS_TAPS; i++) H[i] = OS_HALF[i < 65 ? i : OS_TAPS - 1 - i]; } return H; }
export const osType = (t) => t === 28 || t === 29 || t === 33 || t === 35 || t === 36;   // not Roar / FLM Waveshaper (per-sample time constants), not FLM Distortion (kept as FLM renders it)
const UH = Math.ceil(OS_TAPS / OS_K);
export class Oversampled {
  constructor(inner) {
    this.in = inner; this.h = osTaps(); this.bypass = false;
    this.ux = [new Float64Array(UH), new Float64Array(UH)]; this.up = 0; this.dx = [new Float64Array(OS_TAPS), new Float64Array(OS_TAPS)]; this.dp = 0;
    this.bL = new Float32Array(OS_SUB * OS_K); this.bR = new Float32Array(OS_SUB * OS_K);
    if (inner.tr) this.tr = (p, b) => inner.tr(p, b);
    if (inner.setTempo) this.setTempo = (b) => inner.setTempo(b);
  }
  get inner() { return this.in; }
  setParam(i, v) { this.in.setParam(i, v); }
  readOut(o) { return this.in.readOut ? this.in.readOut(o) : 0; }
  lat() { return OS_LAT + Math.ceil((this.in.lat ? this.in.lat() : 0) / OS_K); }
  process(L, R, n) {
    const h = this.h, B = [this.bL, this.bR];
    for (let a = 0; a < n; a += OS_SUB) {
      const m = Math.min(OS_SUB, n - a), X = [L.subarray(a, a + m), R.subarray(a, a + m)];
      const u0 = this.up;
      for (let c = 0; c < 2; c++) {
        let u = u0; const hx = this.ux[c], b = B[c], x = X[c];
        for (let i = 0; i < m; i++) {
          u = u + 1 === UH ? 0 : u + 1; hx[u] = x[i];
          for (let p = 0; p < OS_K; p++) { let s = 0, q = u; for (let j = p; j < OS_TAPS; j += OS_K) { s += h[j] * hx[q]; q = q === 0 ? UH - 1 : q - 1; } b[i * OS_K + p] = s * OS_K; }
        }
        if (c === 1) this.up = u;
      }
      this.in.process(this.bL, this.bR, m * OS_K);
      const d0 = this.dp;
      for (let c = 0; c < 2; c++) {
        let d = d0; const hv = this.dx[c], b = B[c], x = X[c];
        for (let i = 0; i < m; i++) for (let p = 0; p < OS_K; p++) {
          d = d + 1 === OS_TAPS ? 0 : d + 1; hv[d] = b[i * OS_K + p];
          if (p === 0) { let s = 0, q = d; for (let j = 0; j < OS_TAPS; j++) { s += h[j] * hv[q]; q = q === 0 ? OS_TAPS - 1 : q - 1; } x[i] = s; }
        }
        if (c === 1) this.dp = d;
      }
    }
  }
}
