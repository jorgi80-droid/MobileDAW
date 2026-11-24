// Drum kits (FL Studio Mobile "Save Template" / "My Drumsets"): save the pads of a drum track (every setting + the sample file of each pad),
// load them back = the same pads, one undo step swaps the whole list, pads that hold an instrument chain are skipped and counted, a sample
// that is gone is reported (the pad stays silent).   Usage: node --experimental-default-type=module tools/drumkit-test.mjs
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const P = await import(path.join(root, 'js/project.js')), H = await import(path.join(root, 'js/history.js'));
const { eng } = await import(path.join(root, 'js/engine.js'));
const PRS = await import(path.join(root, 'js/presets.js'));
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };

const fs = new Map();                                                       // a tiny in-memory file system for presets
eng.writeText = (p, t) => { fs.set(p, t); return true; };
eng.readText = (p) => fs.get(p);
eng.listDir = (d) => ({ path: d, items: [...fs.keys()].filter((k) => k.startsWith(d + '/')).map((k) => ({ name: k.slice(d.length + 1) })) });
const smp = (p) => ({ id: 20 + Object.keys(P.state.samples).length, path: p, name: p.split('/').pop(), duration: 0.5, frames: 24000, peaks: [], pyr: null });
P.newProject(false); P.addTrack('drum'); const i = P.state.tracks.length - 1;
for (const p of ['/Samples/kick.wav', '/Samples/snare.wav', '/Samples/hat.wav']) P.state.samples[p] = smp(p);   // after newProject (it clears the sample table)
const pads = P.padsOf(i);
pads.push(P.newPad({ pitch: 50, name: 'Kick S', kind: -1, sample: P.state.samples['/Samples/kick.wav'], gain: -3, pan: -0.2, rev: true, a: 0.01, r: 0.3, cut: 1, poly: false, hold: 0.2, shift: 0.02 }));
pads.push(P.newPad({ pitch: 52, name: 'Snare S', kind: -1, sample: P.state.samples['/Samples/snare.wav'], start: 0.1, end: 0.8, cut: 1 }));
pads[3].cut = 2; pads[3].hold = 0.4;                                          // a built-in pad too
const strip = (q) => { const { sample, chain, ...r } = q; return JSON.stringify({ ...r, smp: sample ? sample.path : null }); };
ok(P.padsOf(i)[6].sample && P.padsOf(i)[7].sample, 'test setup: the sample pads really hold their samples');
const before = P.padsOf(i).map(strip);

const r = PRS.saveKit(i, 'My Kit');
ok(!r.error && r.n === pads.length && r.skipped === 0, `saveKit stores every pad (${r.n})`);
ok(PRS.kitList().length === 1 && PRS.kitList()[0].name === 'My Kit' && PRS.kitList()[0].n === pads.length, 'the kit is listed with its pad count');
ok(PRS.saveKit(i, '  ').error && PRS.saveKit(999, 'x').error, 'empty name / missing track give an error');

// change the kit, then load the saved one back
P.setPad(i, 0, 'cut', 3); P.setPad(i, 6, 'gain', -20);
P.removePad(i, 5);
ok(P.padsOf(i).map(strip).join() !== before.join(), 'the pads were changed after saving');
const a = await PRS.applyKit(PRS.kitList()[0].path, i);
ok(!a.error && a.missing === 0, 'applyKit loads the kit (' + (a.msg || a.error) + ')');
ok(P.padsOf(i).map(strip).join() === before.join(), 'loading restores every pad exactly (settings and sample files)');
ok(P.padsOf(i)[6].sample === P.state.samples['/Samples/kick.wav'] && P.padsOf(i)[6].cut === 1 && P.padsOf(i)[6].poly === false && P.padsOf(i)[6].hold === 0.2, 'sample object re-linked; cut / poly / hold / shift survive');
H.undoOp();
ok(P.padsOf(i).map(strip).join() !== before.join() && P.padsOf(i).length === before.length - 1, 'one undo returns the pads that were there before loading');
H.redoOp();
ok(P.padsOf(i).map(strip).join() === before.join(), 'redo loads the kit again');

// a pad with an instrument chain is not saved
P.padsOf(i)[1].chain = { inst: { type: 19, params: {} }, devices: [] };
const r2 = PRS.saveKit(i, 'With Chain');
ok(!r2.error && r2.skipped === 1 && r2.n === P.padsOf(i).length - 1, 'a pad with an instrument chain is skipped and counted');
delete P.padsOf(i)[1].chain;

// a missing sample file: reported, the pad is silent
const gone = '/Samples/gone.wav';
P.state.samples[gone] = smp(gone); P.padsOf(i).push(P.newPad({ pitch: 54, name: 'Gone', kind: -1, sample: P.state.samples[gone] }));
const r3 = PRS.saveKit(i, 'Missing'); delete P.state.samples[gone];
const m = await PRS.applyKit(r3.path, i);
const gp = P.padsOf(i).find((q) => q.pitch === 54);
ok(m.missing === 1 && gp && !gp.sample && gp.kind === -1 && /tidak ditemukan/.test(m.msg), 'a missing sample is reported and its pad stays silent');

// guards
ok((await PRS.applyKit('/Presets/Kits/none.json', i)).error, 'a missing kit file gives an error');
P.addTrack('midi'); ok((await PRS.applyKit(r.path, P.state.tracks.length - 1)).error, 'a kit cannot be loaded on a synth track');

console.log(bad ? `\n${bad} FAILED` : '\nDRUM KITS OK');
process.exit(bad ? 1 : 0);
