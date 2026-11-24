// SharedArrayBuffer channels (js/engine/sabio.js): the command order across the ring and postMessage is kept, the ring wraps around, a full
// ring falls back to messages, non-numeric arguments never go into the ring, the poll block's sequence lock rejects half-written data.
// Usage: node tools/sab-test.mjs     (part of tools/run-tests.mjs)
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = await import(path.join(root, 'js/engine/sabio.js'));
let bad = 0; const ok = (c, msg) => { if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + msg); };
const sh = S.makeShared(73, 64), W = new S.RingWriter(sh), Rd = new S.RingReader(sh);
// sender as web.js post(): ring when possible, else a message with the same sequence number
let seq = 0; const msgs = [], applied = [];
const post = (c, a) => { const q = ++seq; if (!W.push(q, c, a)) msgs.push({ c, a, seq: q }); };
const apply = (c, a) => applied.push(c + ':' + a.join(','));
// receiver as worklet.js: a message first drains the ring entries sent before it; every render quantum drains the rest
const receive = () => { while (msgs.length) { const m = msgs.shift(); Rd.drain(m.seq, apply); apply(m.c, m.a); } Rd.drain(Infinity, apply); };
const want = [];
for (let k = 0; k < 20000; k++) {
  const r = k % 7;
  const [c, a] = r === 0 ? ['trackNotes', [k % 8, [1, 2, 3], 1]] : r === 1 ? ['insertDevice', [k % 8, 0, 3]] : r === 2 ? ['devParam', [k % 8, 0, 1, k / 7]] : r === 3 ? ['trackVol', [k % 8, (k % 100) / 100]] : r === 4 ? ['play', []] : r === 5 ? ['preview', [1, 60, 0.5, k % 2 === 0]] : ['seek', [undefined]];
  post(c, a); want.push(c + ':' + a.map((x) => (typeof x === 'boolean' ? +x : x)).join(','));
  if (k % 97 === 0) receive();                     // the worklet runs now and then: the ring fills, wraps and empties many times
}
receive();
const same = applied.length === want.length && applied.every((x, i) => x === want[i]);
ok(same, `20000 interleaved ring / message commands applied in the order they were sent (${applied.length} applied)`);
ok(msgs.length === 0 && seq === 20000, 'nothing left behind');
// a full ring: the overflow goes by message and still keeps the order
{ const sh2 = S.makeShared(73, 64), w2 = new S.RingWriter(sh2), r2 = new S.RingReader(sh2); let q = 0, n = 0, m = 0; const got = [], ms = [];
  for (let k = 0; k < 30000; k++) { q++; if (w2.push(q, 'trackVol', [1, k])) n++; else { m++; ms.push({ seq: q, k }); } }
  for (const x of ms) { r2.drain(x.seq, (c, a) => got.push(a[1])); got.push(x.k); } r2.drain(Infinity, (c, a) => got.push(a[1]));
  ok(m > 0 && n > 0 && got.every((v, i) => v === i), `ring full after ${n} entries: ${m} fall back to messages, order kept`); }
ok(!W.push(1, 'trackNotes', [0, [1], 1]) && !W.push(1, 'trackVol', [0, NaN]) && !W.push(1, 'seek', [undefined]), 'data commands, NaN and undefined never go into the ring');
// poll block: the reader takes only complete blocks
{ const pw = new S.PollWriter(sh), pv = S.pollViews(sh), pr = new S.PollReader(sh);
  pw.begin(); pv.head[0] = 123; pv.head[1] = 1; pv.m[4] = 77; pv.ctrl[1] = 1; pv.key[0] = (3 << 16) | 2; pv.len[0] = 3; pv.dev.set([1, 2, 3]); pw.end();
  const a = pr.read(); ok(a && a.pos === 123 && a.playing && a.m[4] === 77 && JSON.stringify(a.dev['3,2']) === '[1,2,3]', 'poll block read: position, transport, meters, device read-out');
  pw.begin(); pv.head[0] = 999; const b = pr.read(); ok(b === a, 'half-written block (odd sequence) is ignored, the previous one is kept'); pw.end();
  ok(pr.read().pos === 999, 'the finished block is taken'); }
console.log(bad ? `\n${bad} FAILED` : '\nALL OK'); process.exit(bad ? 1 : 0);
