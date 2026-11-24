// Standard MIDI File (SMF type 0 / 1) reader and writer. Pure functions, no DOM: ticks are PPQ 960 like the rest of the app.
// decodeSmf(bytes) -> { format, tempos:[{tick,bpm}], sigs:[{tick,n,d}], markers:[{tick,name}], tracks:[{name, ch, program, notes:[{t,d,p,v}], cc:[{k,n,pts:[{t,v}]}]}] }
// encodeSmf({ name, tempos, sig, markers, tracks:[{name, ch, notes, cc}] }) -> Uint8Array   (note v = 0..1, cc value 0..127, bend -1..1 = +-2 semitones)
export const SMF_PPQ = 960;

export function decodeSmf(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let p = 0;
  const bad = (m) => { throw new Error('Berkas MIDI tidak valid: ' + m); };
  const u32 = () => { if (p + 4 > u.length) bad('terpotong'); const v = ((u[p] << 24) | (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3]) >>> 0; p += 4; return v; };
  const u16 = () => { if (p + 2 > u.length) bad('terpotong'); const v = (u[p] << 8) | u[p + 1]; p += 2; return v; };
  const tag = () => { if (p + 4 > u.length) bad('terpotong'); const s = String.fromCharCode(u[p], u[p + 1], u[p + 2], u[p + 3]); p += 4; return s; };
  if (tag() !== 'MThd') bad('bukan file MIDI (tidak ada header MThd).');
  const hl = u32(), format = u16(), ntr = u16(), div = u16(); p += Math.max(0, hl - 6);
  if (div & 0x8000) bad('format waktu SMPTE tidak didukung.');
  if (!div) bad('resolusi waktu nol.');
  if (format > 2) bad('tipe file tidak dikenal.');
  const sc = SMF_PPQ / div, out = { format, tempos: [], sigs: [], markers: [], tracks: [] };
  const text = (a, b) => { try { return new TextDecoder('utf-8', { fatal: false }).decode(u.subarray(a, b)).replace(/\0/g, '').trim(); } catch (_) { return ''; } };
  for (let ti = 0; ti < ntr && p + 8 <= u.length; ti++) {
    const id = tag(), len = u32(), end = Math.min(u.length, p + len);
    if (id !== 'MTrk') { p = end; ti--; continue; }
    let tick = 0, run = 0, name = '';
    const open = new Map(), groups = new Map();     // groups: channel -> { notes, ccs: Map, program }
    const grp = (ch) => { let g = groups.get(ch); if (!g) { g = { notes: [], ccs: new Map(), program: -1 }; groups.set(ch, g); } return g; };
    const vlq = () => { let v = 0; for (let k = 0; k < 4; k++) { if (p >= end) return v; const b = u[p++]; v = (v << 7) | (b & 127); if (!(b & 128)) break; } return v; };
    const addCc = (ch, k, n, t, v) => { const g = grp(ch), key = k + ':' + n; let l = g.ccs.get(key); if (!l) { l = { k, n, pts: [] }; g.ccs.set(key, l); } l.pts.push({ t, v }); };
    while (p < end) {
      tick += vlq() * sc;
      let st = u[p];
      if (st < 0x80) { if (!run) bad('data MIDI tanpa status.'); st = run; } else { p++; if (st < 0xf0) run = st; }
      const t = Math.round(tick);
      if (st === 0xff) {
        const ty = u[p++], l = vlq(), a = p; p += l;
        if (ty === 0x51 && l === 3) { const us = (u[a] << 16) | (u[a + 1] << 8) | u[a + 2]; if (us > 0) out.tempos.push({ tick: t, bpm: 60e6 / us }); }
        else if (ty === 0x58 && l >= 2) out.sigs.push({ tick: t, n: u[a], d: 1 << u[a + 1] });
        else if (ty === 0x03 && !name) name = text(a, a + l);
        else if ((ty === 0x06 || ty === 0x07) && l) out.markers.push({ tick: t, name: text(a, a + l) });
        else if (ty === 0x2f) break;
      } else if (st === 0xf0 || st === 0xf7) { const l = vlq(); p += l; }
      else {
        const hi = st & 0xf0, ch = st & 15, a = u[p++];
        const two = hi !== 0xc0 && hi !== 0xd0, b = two ? u[p++] : 0;
        if (hi === 0x90 && b > 0) { const k = ch * 128 + a; if (!open.has(k)) open.set(k, []); open.get(k).push({ t, v: b }); }
        else if (hi === 0x80 || hi === 0x90) { const k = ch * 128 + a, q = open.get(k); if (q && q.length) { const o = q.shift(); grp(ch).notes.push({ t: o.t, d: Math.max(1, t - o.t), p: a, v: Math.max(1, o.v) / 127 }); } }
        else if (hi === 0xb0) addCc(ch, 'cc', a, t, b);
        else if (hi === 0xe0) addCc(ch, 'bend', 0, t, Math.max(-1, Math.min(1, (((b << 7) | a) - 8192) / 8192)));
        else if (hi === 0xc0) grp(ch).program = a;
      }
    }
    for (const [k, q] of open) for (const o of q) grp(k >> 7).notes.push({ t: o.t, d: Math.max(1, Math.round(tick) - o.t), p: k & 127, v: Math.max(1, o.v) / 127 });
    p = end;
    for (const [ch, g] of groups) {
      if (!g.notes.length) continue;
      g.notes.sort((x, y) => x.t - y.t || x.p - y.p);
      const cc = [...g.ccs.values()].filter((l) => l.pts.length);
      out.tracks.push({ name, ch, program: g.program, notes: g.notes, cc, multi: groups.size > 1 });
    }
  }
  out.tempos.sort((a, b) => a.tick - b.tick); out.sigs.sort((a, b) => a.tick - b.tick); out.markers.sort((a, b) => a.tick - b.tick);
  return out;
}

export function encodeSmf({ name = '', tempos = [], sig = { n: 4, d: 4 }, sigs = null, markers = [], tracks = [] }) {
  const chunks = [];
  const bytes = (arr) => arr;
  const vlq = (v) => { v = Math.max(0, Math.round(v)); const o = [v & 127]; while ((v >>= 7)) o.unshift((v & 127) | 128); return o; };
  const str = (s) => { const e = new TextEncoder().encode(String(s || '')); return Array.from(e); };
  const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const track = (events) => {                       // events: [tick, order, bytes[]]
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const d = []; let last = 0;
    for (const [t, , b] of events) { d.push(...vlq(t - last), ...b); last = t; }
    d.push(0, 0xff, 0x2f, 0);
    return [0x4d, 0x54, 0x72, 0x6b, ...u32(d.length), ...d];
  };
  const meta = (ty, data) => [0xff, ty, ...vlq(data.length), ...data];
  const ev0 = [];
  ev0.push([0, 0, meta(0x03, str(name || 'MobileDAW'))]);
  const sl = sigs && sigs.length ? sigs : [{ tick: 0, n: sig.n, d: sig.d }];      // one time-signature event per change (sigs = [{ tick, n, d }])
  for (const g of sl) { const d2 = Math.max(0, Math.round(Math.log2(g.d || 4))); ev0.push([Math.max(0, Math.round(g.tick || 0)), 1, meta(0x58, [Math.max(1, g.n | 0), d2, 24, 8])]); }
  const tp = tempos.length ? tempos : [{ tick: 0, bpm: 120 }];
  for (const q of tp) { const us = Math.round(60e6 / Math.max(20, Math.min(300, q.bpm))); ev0.push([Math.round(q.tick), 2, meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255])]); }
  for (const m of markers) ev0.push([Math.round(m.tick), 3, meta(0x06, str(m.name))]);
  const trs = [track(ev0)];
  for (const t of tracks) {
    const ev = [], ch = t.ch & 15;
    ev.push([0, 0, meta(0x03, str(t.name))]);
    for (const n of t.notes) {
      const v = Math.max(1, Math.min(127, Math.round(n.v * 127))), a = Math.round(n.t), b = Math.max(a + 1, Math.round(n.t + n.d));
      ev.push([a, 5, [0x90 | ch, n.p & 127, v]]); ev.push([b, 4, [0x80 | ch, n.p & 127, 0]]);   // note-off sorts before a note-on at the same tick
    }
    for (const l of (t.cc || [])) for (const q of l.pts) {
      const tk = Math.round(q.t);
      if (l.k === 'bend') { const v = Math.max(0, Math.min(16383, Math.round(8192 + Math.max(-1, Math.min(1, q.v)) * 8191))); ev.push([tk, 3, [0xe0 | ch, v & 127, v >> 7]]); }
      else ev.push([tk, 3, [0xb0 | ch, l.n & 127, Math.max(0, Math.min(127, Math.round(q.v)))]]);
    }
    trs.push(track(ev));
  }
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (trs.length >> 8) & 255, trs.length & 255, (SMF_PPQ >> 8) & 255, SMF_PPQ & 255];
  void bytes; void chunks;
  const all = [...head]; for (const t of trs) for (let i = 0; i < t.length; i++) all.push(t[i]);
  return Uint8Array.from(all);
}
