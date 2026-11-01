// Shared-memory channels between the main thread and the AudioWorklet (only when the page is cross-origin isolated, so SharedArrayBuffer
// exists; otherwise web.js keeps using postMessage for everything, which is the fallback and behaves the same).
//
// CmdRing (main -> worklet): a single-producer / single-consumer ring of Float64 entries [seq, op, nargs, args...] for the frequent scalar
// commands (fader moves, parameter changes, transport, previews). Nothing is allocated or serialised on either side. Commands that carry
// data (notes, clips, automation, samples) still go by postMessage; every command has a sequence number and the worklet applies ring
// entries with a smaller number before a message, so the order the app sent them in is always kept.
//
// PollShare (worklet -> main): the ~30 Hz read-out block (position, transport, CPU, PDC latency, strip meters, per-track load, the
// read-outs of up to 8 watched devices) written with a sequence lock: the writer makes the counter odd, writes, makes it even; the reader
// keeps its previous copy when the counter was odd or changed while it read. The worklet allocates nothing for it (postMessage of the
// same data built new arrays ~30 times a second in the audio thread).

// commands the ring may carry (all arguments numbers / booleans); the index is the opcode
export const RING_CMDS = ['play', 'stop', 'seek', 'tempo', 'loop', 'setMetro', 'setMetroVol', 'masterLimit', 'setPdc', 'playCountIn', 'trackVol', 'trackPan', 'trackMute', 'trackSolo',
  'trackSend', 'trackOut', 'trackLoad', 'instParam', 'devParam', 'devBypass', 'preview', 'bend', 'rackCmd', 'resetTrack', 'removeDevice', 'insertDevice', 'trackInst'];
const OPS = new Map(RING_CMDS.map((c, i) => [c, i]));
export const RING_CAP = 1 << 16;                 // Float64 slots
export const POLL_WATCH = 8, POLL_DEVMAX = 4096, POLL_HEAD = 8;

export const sabAvailable = () => typeof SharedArrayBuffer === 'function' && globalThis.crossOriginIsolated === true;

export function makeShared(nstrips, ntracks) {
  return {
    ring: new SharedArrayBuffer(RING_CAP * 8), ringIdx: new SharedArrayBuffer(8),
    poll: new SharedArrayBuffer(4 * 4 + POLL_HEAD * 8 + nstrips * 2 * 4 + ntracks * 2 * 4 + POLL_WATCH * 2 * 4 + POLL_WATCH * POLL_DEVMAX * 4), nstrips, ntracks,
  };
}
// typed views over the poll block: ctrl[0] = sequence, ctrl[1] = watch count; head = pos, playing, cin, cpu, lat, tl on, audio time
export function pollViews(sh) {
  let o = 0; const b = sh.poll, v = {};
  v.ctrl = new Int32Array(b, o, 4); o += 16;
  v.head = new Float64Array(b, o, POLL_HEAD); o += POLL_HEAD * 8;
  v.m = new Int32Array(b, o, sh.nstrips * 2); o += sh.nstrips * 8;
  v.tl = new Int32Array(b, o, sh.ntracks * 2); o += sh.ntracks * 8;
  v.key = new Int32Array(b, o, POLL_WATCH); o += POLL_WATCH * 4;
  v.len = new Int32Array(b, o, POLL_WATCH); o += POLL_WATCH * 4;
  v.dev = new Float32Array(b, o, POLL_WATCH * POLL_DEVMAX);
  return v;
}

// ---- main thread side
export class RingWriter {
  constructor(sh) { this.d = new Float64Array(sh.ring); this.idx = new Int32Array(sh.ringIdx); }   // idx[0] = write position, idx[1] = read position
  // false: not a ring command, an argument is not a plain number, or the ring is full (the caller then sends a message)
  push(seq, name, args) {
    const op = OPS.get(name); if (op === undefined) return false;
    const n = args.length, need = 3 + n, d = this.d, cap = RING_CAP;
    for (let i = 0; i < n; i++) { const a = args[i]; if (!(typeof a === 'number' && Number.isFinite(a)) && typeof a !== 'boolean') return false; }
    const w = Atomics.load(this.idx, 0), r = Atomics.load(this.idx, 1), used = (w - r + cap) % cap;
    if (used + need >= cap - 1) return false;
    let p = w; const put = (x) => { d[p] = x; p = (p + 1) % cap; };
    put(seq); put(op); put(n); for (let i = 0; i < n; i++) put(+args[i]);
    Atomics.store(this.idx, 0, p);
    return true;
  }
}
export class PollReader {
  constructor(sh) { this.v = pollViews(sh); this.last = -1; this.out = null; }
  // the newest consistent block as a poll object (the same shape as the worklet's message), or the previous one
  read() {
    const v = this.v, s1 = Atomics.load(v.ctrl, 0);
    if (s1 & 1 || s1 === this.last) return this.out;
    const h = v.head, nw = Math.min(POLL_WATCH, v.ctrl[1]);
    const o = { pos: h[0], playing: h[1] > 0, cin: h[2], cpu: h[3], lat: h[4], t: h[6], m: Array.from(v.m), tl: h[5] > 0 ? Array.from(v.tl) : null, dev: {} };   // t = the worklet's currentTime when written
    for (let k = 0; k < nw; k++) { const key = v.key[k], n = v.len[k]; if (key >= 0 && n > 0) o.dev[(key >> 16) + ',' + (key & 0xffff)] = Array.from(v.dev.subarray(k * POLL_DEVMAX, k * POLL_DEVMAX + n)); }
    if (Atomics.load(v.ctrl, 0) !== s1) return this.out;              // written while we read: keep the previous block
    this.last = s1; this.out = o; return o;
  }
}

// ---- worklet side
export class RingReader {
  constructor(sh) { this.d = new Float64Array(sh.ring); this.idx = new Int32Array(sh.ringIdx); this.args = Array.from({ length: 9 }, (_, n) => new Array(n).fill(0)); }
  // apply every entry with seq < upTo (Infinity = all): fn(name, args) with a reused argument array (no allocation)
  drain(upTo, fn) {
    const d = this.d, cap = RING_CAP; let r = Atomics.load(this.idx, 1); const w = Atomics.load(this.idx, 0);
    while (r !== w) {
      const seq = d[r]; if (!(seq < upTo)) break;
      const op = d[(r + 1) % cap], n = d[(r + 2) % cap], a = this.args[n] || (this.args[n] = new Array(n).fill(0));
      for (let i = 0; i < n; i++) a[i] = d[(r + 3 + i) % cap];
      r = (r + 3 + n) % cap; Atomics.store(this.idx, 1, r);
      fn(RING_CMDS[op], a);
    }
  }
}
export class PollWriter {
  constructor(sh) { this.v = pollViews(sh); }
  begin() { Atomics.add(this.v.ctrl, 0, 1); }   // odd: being written
  end() { Atomics.add(this.v.ctrl, 0, 1); }     // even: consistent
}
