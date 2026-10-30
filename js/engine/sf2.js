// SoundFont 2 (.sf2) parser. Output is a plain object that can be posted to the audio worklet:
//   { data: Int16Array, shdr: [{ rate }], presets: [{ name, bank, program, zones: [...] }] }
// zone: { lo, hi, vlo, vhi, sample, root, tune (cents), loop (0/1/3), atten (dB), pan (-1..1), a, d, s, r (seconds / level), start, end, ls, le }
const GEN = { startOff: 0, endOff: 1, lsOff: 2, leOff: 3, startC: 4, endC: 12, lsC: 45, leC: 50, pan: 17, atk: 34, dec: 36, sus: 37, rel: 38, inst: 41, key: 43, vel: 44, att: 48, coarse: 51, fine: 52, sample: 53, mode: 54, root: 58 };

function chunks(dv, off, end) {
  const out = [];
  while (off + 8 <= end) {
    const id = String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3)), size = dv.getUint32(off + 4, true);
    out.push({ id, off: off + 8, size });
    off += 8 + size + (size & 1);
  }
  return out;
}
const str = (dv, o, n) => { let s = ''; for (let i = 0; i < n; i++) { const c = dv.getUint8(o + i); if (!c) break; s += String.fromCharCode(c); } return s.trim(); };

export function parseSf2(buf, maxSamples = 80e6) {
  const dv = new DataView(buf);
  if (buf.byteLength < 12 || str(dv, 0, 4) !== 'RIFF' || str(dv, 8, 4) !== 'sfbk') throw new Error('Bukan file SoundFont (.sf2)');
  let smpl = null, pdta = {};
  for (const c of chunks(dv, 12, buf.byteLength)) {
    if (c.id !== 'LIST') continue;
    const type = str(dv, c.off, 4);
    for (const s of chunks(dv, c.off + 4, c.off + c.size)) {
      if (type === 'sdta' && s.id === 'smpl') smpl = s;
      if (type === 'pdta') pdta[s.id] = s;
    }
  }
  if (!smpl) throw new Error('SoundFont tidak berisi data sample (smpl)');
  const n = smpl.size >> 1;
  if (n > maxSamples) throw new Error('SoundFont terlalu besar untuk dimuat (' + Math.round(n / 1e6) + ' juta sample)');
  const data = new Int16Array(n);
  for (let i = 0; i < n; i++) data[i] = dv.getInt16(smpl.off + i * 2, true);

  const recs = (id, size, fn) => { const c = pdta[id]; if (!c) return []; const r = []; for (let o = c.off; o + size <= c.off + c.size; o += size) r.push(fn(o)); return r; };
  const phdr = recs('phdr', 38, (o) => ({ name: str(dv, o, 20), program: dv.getUint16(o + 20, true), bank: dv.getUint16(o + 22, true), bag: dv.getUint16(o + 24, true) }));
  const pbag = recs('pbag', 4, (o) => dv.getUint16(o, true));
  const pgen = recs('pgen', 4, (o) => ({ op: dv.getUint16(o, true), lo: dv.getUint8(o + 2), hi: dv.getUint8(o + 3), v: dv.getInt16(o + 2, true), u: dv.getUint16(o + 2, true) }));
  const inst = recs('inst', 22, (o) => ({ bag: dv.getUint16(o + 20, true) }));
  const ibag = recs('ibag', 4, (o) => dv.getUint16(o, true));
  const igen = recs('igen', 4, (o) => ({ op: dv.getUint16(o, true), lo: dv.getUint8(o + 2), hi: dv.getUint8(o + 3), v: dv.getInt16(o + 2, true), u: dv.getUint16(o + 2, true) }));
  const sh = recs('shdr', 46, (o) => ({ start: dv.getUint32(o + 20, true), end: dv.getUint32(o + 24, true), ls: dv.getUint32(o + 28, true), le: dv.getUint32(o + 32, true), rate: dv.getUint32(o + 36, true), key: dv.getUint8(o + 40), corr: dv.getInt8(o + 41) }));
  if (!phdr.length || !sh.length) throw new Error('SoundFont rusak (tidak ada preset atau sample)');

  const zonesOf = (bags, gens, from, to) => {            // list of {gens: Map(op -> record)} for bag range [from, to)
    const zs = [];
    for (let b = from; b < to; b++) {
      const g = new Map();
      for (let k = bags[b]; k < (bags[b + 1] ?? gens.length); k++) if (gens[k]) g.set(gens[k].op, gens[k]);
      zs.push(g);
    }
    return zs;
  };
  const num = (m, op, d = 0) => (m.has(op) ? m.get(op).v : d);
  const range = (m, op) => (m.has(op) ? [m.get(op).lo, m.get(op).hi] : [0, 127]);
  const tc = (v, min) => Math.max(min, Math.pow(2, v / 1200));

  const instZones = inst.slice(0, -1).map((it, i) => {
    const zs = zonesOf(ibag, igen, it.bag, inst[i + 1].bag);
    let glob = null;
    if (zs.length && !zs[0].has(GEN.sample)) glob = zs.shift();
    return zs.filter((z) => z.has(GEN.sample)).map((z) => { if (glob) for (const [k, v] of glob) if (!z.has(k)) z.set(k, v); return z; });
  });

  const presets = [];
  for (let p = 0; p < phdr.length - 1; p++) {
    const zs = zonesOf(pbag, pgen, phdr[p].bag, phdr[p + 1].bag);
    let glob = null;
    if (zs.length && !zs[0].has(GEN.inst)) glob = zs.shift();
    const zones = [];
    for (const pz of zs) {
      if (glob) for (const [k, v] of glob) if (!pz.has(k)) pz.set(k, v);
      if (!pz.has(GEN.inst)) continue;
      const pk = range(pz, GEN.key), pv = range(pz, GEN.vel);
      for (const iz of instZones[pz.get(GEN.inst).u] || []) {
        const ik = range(iz, GEN.key), iv = range(iz, GEN.vel), si = iz.get(GEN.sample).u, h = sh[si];
        if (!h || h.end <= h.start) continue;
        const lo = Math.max(pk[0], ik[0]), hi = Math.min(pk[1], ik[1]), vlo = Math.max(pv[0], iv[0]), vhi = Math.min(pv[1], iv[1]);
        if (lo > hi || vlo > vhi) continue;
        const add = (op) => num(iz, op) + num(pz, op);
        const rootGen = num(iz, GEN.root, -1);
        const sus = Math.max(0, add(GEN.sus));
        zones.push({
          lo, hi, vlo: Math.max(1, vlo), vhi, sample: si,
          root: rootGen >= 0 && rootGen <= 127 ? rootGen : (h.key <= 127 ? h.key : 60),
          tune: add(GEN.coarse) * 100 + add(GEN.fine) + h.corr, loop: num(iz, GEN.mode) & 3, atten: Math.max(0, add(GEN.att) / 10), pan: Math.max(-1, Math.min(1, add(GEN.pan) / 500)),
          a: tc(num(iz, GEN.atk, -12000) + num(pz, GEN.atk), 0.001), d: tc(num(iz, GEN.dec, -12000) + num(pz, GEN.dec), 0.005), s: Math.pow(10, -sus / 200), r: tc(num(iz, GEN.rel, -12000) + num(pz, GEN.rel), 0.02),
          start: h.start + num(iz, GEN.startOff) + 32768 * num(iz, GEN.startC), end: Math.min(n, h.end + num(iz, GEN.endOff) + 32768 * num(iz, GEN.endC)),
          ls: h.ls + num(iz, GEN.lsOff) + 32768 * num(iz, GEN.lsC), le: h.le + num(iz, GEN.leOff) + 32768 * num(iz, GEN.leC),
        });
      }
    }
    if (zones.length) presets.push({ name: phdr[p].name || 'Preset ' + (p + 1), bank: phdr[p].bank, program: phdr[p].program, zones });
  }
  if (!presets.length) throw new Error('SoundFont tidak punya preset yang bisa dimainkan');
  presets.sort((a, b) => a.bank - b.bank || a.program - b.program);
  return { data, shdr: sh.map((h) => ({ rate: h.rate || 44100 })), presets };
}
