// Automation segment shapes (js/autocurve.js) and what the engine receives (project.js syncAutomation densify): every shape stays inside its
// endpoints (Bezier: inside 0..1), steps hold then jump, the dense breakpoints the engine interpolates linearly follow the curve within 0.5 %,
// linear segments are sent exactly as before (old projects sound the same), and a curve really reaches the engine (Engine.applyAuto).
// Usage: node tools/autocurve-test.mjs     (part of tools/run-tests.mjs)
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = await import(path.join(root, 'js/autocurve.js'));
const { Engine, PPQ } = await import(path.join(root, 'js/engine/core.js'));
let bad = 0; const ok = (c, msg) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const lin = (pts, t) => { if (t <= pts[0][0]) return pts[0][1]; for (let k = 1; k < pts.length; k++) if (t <= pts[k][0]) { const a = pts[k - 1], b = pts[k], d = b[0] - a[0]; return d <= 0 ? b[1] : a[1] + (b[1] - a[1]) * (t - a[0]) / d; } return pts[pts.length - 1][1]; };
for (const [name, s, k] of [['linear', 0], ['step', 1], ['smooth', 2], ['curved +0.7', 3, 0.7], ['curved -0.7', 3, -0.7], ['bezier', 4]]) {
  const pts = [{ t: 0, v: 0.1 }, { t: 960, v: 0.9, s, k }, { t: 2880, v: 0.2, s, k }, { t: 3840, v: 0.6 }]; pts[0].s = s; pts[0].k = k;
  const D = A.densify(pts); let err = 0, inside = true, mono = true, prev = -1;
  for (let t = 0; t <= 3840; t += 5) {
    const c = A.valueAt(pts, t), e = lin(D, t); err = Math.max(err, Math.abs(c - e));
    const i = t < 960 ? 0 : t < 2880 ? 1 : 2, a = pts[i].v, b = pts[i + 1].v; if (s !== 4 && (c < Math.min(a, b) - 1e-9 || c > Math.max(a, b) + 1e-9)) inside = false; if (c < -1e-9 || c > 1 + 1e-9) inside = false;
    if (t < 960 && s !== 4) { if (c < prev - 1e-9) mono = false; prev = c; }
  }
  ok(err < 0.005 && inside && mono, `${name}: engine breakpoints follow the drawn curve (max error ${(err * 100).toFixed(3)} %), stays in range, monotone on a rising segment`);
}
{ const pts = [{ t: 0, v: 0.2, s: 1 }, { t: 960, v: 0.8 }]; ok(A.valueAt(pts, 959) === 0.2 && A.valueAt(pts, 960) === 0.8 && lin(A.densify(pts), 958) === 0.2, 'step holds the value until the next point, then jumps'); }
{ const pts = [{ t: 0, v: 0.2 }, { t: 960, v: 0.8 }, { t: 1920, v: 0.3 }]; ok(JSON.stringify(A.densify(pts)) === JSON.stringify([[0, 0.2], [960, 0.8], [1920, 0.3]]), 'linear segments: the same breakpoints as before shapes existed'); }
{ // the engine follows a smooth curve on the track volume: values at quarter points of the segment
  const e = new Engine(48000); e.tempo(120); const pts = [{ t: 0, v: 0, s: 2 }, { t: PPQ * 4, v: 1 }], D = A.densify(pts), flat = [0, 0, -1, 0, D.length]; for (const [t, v] of D) flat.push(t, v);
  e.trackInst(0, 1); e.automation(flat, flat.length); e.play(); const L = new Float32Array(128), R = new Float32Array(128), got = [];
  for (let b = 0; b < Math.round(2 * 48000 / 128); b++) { e.render(L, R, 128); if (b % 94 === 0) got.push([e.tickPos(), e.s[0].vol]); }
  const worst = Math.max(...got.map(([tk, vol]) => Math.abs(vol - A.valueAt(pts, tk - 128 * PPQ * 2 / 48000))));   // vol was set at the start of the last block
  ok(worst < 0.01, `engine track volume follows the smooth curve (worst ${(worst * 100).toFixed(2)} %)`);
}
console.log(bad ? `\n${bad} FAILED` : '\nALL OK'); process.exit(bad ? 1 : 0);
