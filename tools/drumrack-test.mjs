// Drum Rack chains (instruments.js DrumSynth + rackCmd): a pad with a chain plays its instrument (at C3 + pad Pitch) through its effects
// instead of its own sound, follows pad Level / Mute, keeps ringing as an active instrument, and the other pads still play their own sounds.
// Usage: node tools/drumrack-test.mjs
import { Engine } from '../js/engine/core.js';
import { INSTRUMENTS, DEVICES } from '../js/defs.js';
const SR = 48000; let bad = 0;
const check = (ok, msg) => { if (!ok) { bad++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
function run(setup, notes, sec = 0.6) {
  const e = new Engine(SR); e.trackInst(0, 3); setup(e);
  const L = new Float32Array(128), R = new Float32Array(128); let en = 0, n = Math.round(sec * SR / 128), out = [];
  for (const p of notes) e.preview(0, p, 0.9, true);
  for (let b = 0; b < n; b++) { L.fill(0); R.fill(0); e.render(L, R, 128); for (let i = 0; i < 128; i++) { en += L[i] * L[i] + R[i] * R[i]; out.push(L[i]); } if (!Number.isFinite(L[0])) return { bad: true }; }
  return { en, out, e };
}
const chain = (type, fx) => (e) => {
  e.rackCmd(0, -1, 5, 0, 0, type, 0); INSTRUMENTS[type].params.forEach((p, j) => e.rackCmd(0, -1, 6, 0, 0, j, p.def));
  if (fx != null) { e.rackCmd(0, -1, 1, 0, 0, fx, 0); DEVICES[fx].params.forEach((p, j) => e.rackCmd(0, -1, 2, 0, 0, j, p.def)); }
};
const own = run(() => {}, [36]), ds = run(chain(19), [36]), dsFx = run(chain(19, 6), [36], 1.2), dsNo = run(chain(19), [38]);
check(own.en > 1e-3, 'pad 1 plays its own kick without a chain');
check(ds.en > 1e-3 && Math.abs(ds.en - own.en) / own.en > 0.05, 'a DS Kick chain replaces the pad sound');
{ const dl = run(chain(19), [36], 1.2); let d = 0; for (let i = 0; i < dl.out.length; i++) d += (dl.out[i] - dsFx.out[i]) ** 2; check(d > dl.en * 0.01, 'the chain effect (Echo) is heard'); }
const snare = run(() => {}, [38]); check(Math.abs(dsNo.en - snare.en) < 1e-6 * (1 + snare.en), 'other pads keep their own sound');
const muted = run((e) => { chain(19)(e); e.instParam(0, 200 + 10, 1); }, [36]); check(muted.en < 1e-9, 'a muted pad silences its chain');
const quiet = run((e) => { chain(19)(e); e.instParam(0, 0, -24); }, [36]); check(quiet.en < ds.en * 0.05, 'pad Level scales the chain');
const cleared = run((e) => { chain(19)(e); e.rackCmd(0, -1, 7, 0, 0, 0, 0); }, [36]); check(Math.abs(cleared.en - own.en) < 1e-6 * own.en, 'clearing the chain brings the pad sound back');
for (const ty of [19, 20, 21, 22, 23, 24, 25, 26, 27, 13, 14, 15, 16, 17, 1, 2]) { const r = run(chain(ty), [36]); check(!r.bad && r.en > 1e-6, `chain instrument ${INSTRUMENTS[ty].name} plays`); }
console.log(bad ? `\n${bad} FAILED` : '\nALL OK'); process.exit(bad ? 1 : 0);
