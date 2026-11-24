// Module order = signal order (acceptance B.2): Saturator -> EQ Three sounds different from EQ Three -> Saturator, in the main device chain
// and inside an Audio Effect Rack chain; a chain rebuilt after a reorder (what moveDevice / rackMoveDevice send) sounds exactly like a chain
// built in that order from the start. Usage: node tools/chain-order-test.mjs
import { Engine } from '../js/engine/core.js';
import { DEVICES } from '../js/defs.js';
const SR = 48000; let bad = 0;
const check = (ok, msg) => { if (!ok) { bad++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const SAT = 3, EQ = 2, RACK = 51;
const P = { [SAT]: { 0: 30 }, [EQ]: { 1: -15, 2: -15 } };        // hard drive; EQ removes mid + high: order decides whether the distortion harmonics survive
const params = (type) => DEVICES[type].params.map((p, k) => (P[type] && P[type][k] !== undefined ? P[type][k] : p.def));
function render(setup, sec = 0.5) {
  const e = new Engine(SR); e.trackInst(0, 1); setup(e);
  e.preview(0, 45, 0.9, true);
  const L = new Float32Array(128), R = new Float32Array(128), out = []; let en = 0;
  for (let b = 0; b < Math.round(sec * SR / 128); b++) { L.fill(0); R.fill(0); e.render(L, R, 128); for (let i = 0; i < 128; i++) { out.push(L[i]); en += L[i] * L[i]; } }
  return { out, en };
}
const diff = (a, b) => { let d = 0; for (let i = 0; i < a.out.length; i++) d += (a.out[i] - b.out[i]) ** 2; return d; };
const mainChain = (order) => (e) => order.forEach((ty, j) => { e.insertDevice(0, j, ty); params(ty).forEach((v, k) => e.devParam(0, j, k, v)); });
const rackChain = (order) => (e) => {
  e.insertDevice(0, 0, RACK); DEVICES[RACK].params.forEach((p, k) => e.devParam(0, 0, k, p.def)); e.devParam(0, 0, 32, 1);
  e.rackCmd(0, 0, 0, 0, 0, 0, 0);
  order.forEach((ty, j) => { e.rackCmd(0, 0, 1, 0, j, ty, 0); params(ty).forEach((v, k) => e.rackCmd(0, 0, 2, 0, j, k, v)); });
};

// main chain
const a = render(mainChain([SAT, EQ])), b = render(mainChain([EQ, SAT]));
check(a.en > 1e-3 && b.en > 1e-3, 'both main-chain orders play');
check(diff(a, b) > 0.05 * Math.min(a.en, b.en), 'main chain: Saturator -> EQ and EQ -> Saturator sound different (' + (diff(a, b) / a.en).toFixed(3) + ')');
// a reorder the way project.moveDevice sends it (remove + insert + parameters) = the fresh chain in that order
const moved = render((e) => { mainChain([SAT, EQ])(e); e.removeDevice(0, 0); e.insertDevice(0, 1, SAT); params(SAT).forEach((v, k) => e.devParam(0, 1, k, v)); });
check(diff(moved, b) < 1e-12, 'main chain: reordered chain == chain built in the new order');

// Audio Effect Rack chain
const ra = render(rackChain([SAT, EQ])), rb = render(rackChain([EQ, SAT]));
check(ra.en > 1e-3 && rb.en > 1e-3, 'both rack-chain orders play');
check(diff(ra, rb) > 0.05 * Math.min(ra.en, rb.en), 'rack chain: order changes the sound (' + (diff(ra, rb) / ra.en).toFixed(3) + ')');
check(diff(ra, a) < 1e-6 * a.en, 'rack chain [Saturator, EQ] == main chain [Saturator, EQ]');
// project.rackMoveDevice = rackSync: reset the rack, send every chain again in the new order
const rmoved = render((e) => { rackChain([SAT, EQ])(e); e.rackCmd(0, 0, 0, 0, 0, 0, 0); [EQ, SAT].forEach((ty, j) => { e.rackCmd(0, 0, 1, 0, j, ty, 0); params(ty).forEach((v, k) => e.rackCmd(0, 0, 2, 0, j, k, v)); }); });
check(diff(rmoved, rb) < 1e-12, 'rack chain: reordered (rackSync) == chain built in the new order');
console.log(bad ? `\n${bad} FAILED` : '\nchain-order-test: all passed'); process.exit(bad ? 1 : 0);
