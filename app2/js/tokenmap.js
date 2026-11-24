// DirectWave "New from samples" (FL Studio Mobile's instrument builder, ported from Honeydew src/token_map.rs, GPL-3.0): audio file names
// split into tokens at a separator, each token position given a role (root key, single key, key range, velocity, round robin, group), and
// turned into zones. A file with only a root shares the keyboard with the other roots of its group, split at the midpoints; one with only a
// top velocity (v64) shares 1..127 with the other layers of its keys; with neither it plays every key at root 60 / every velocity.
// Pure: names in, regions out.
export const SEPARATORS = ['_', '-', '.', '@', '+'];
export const ROLES = ['ignore', 'root', 'key', 'lowKey', 'highKey', 'vel', 'lowVel', 'highVel', 'rr', 'group'];
export const ROLE_LABEL = { ignore: 'Abaikan', root: 'Nada dasar (root)', key: 'Satu tuts', lowKey: 'Tuts terendah', highKey: 'Tuts tertinggi', vel: 'Rentang velocity', lowVel: 'Velocity min', highVel: 'Velocity maks', rr: 'Round robin', group: 'Grup' };

const stem = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };
export const tokens = (name, sep) => (sep === '' ? [stem(name)] : stem(name).split(sep));
export const separatorOf = (name) => SEPARATORS.find((s) => stem(name).includes(s)) || '_';

// a MIDI note: a name (C4 = 60, C#4, Db4, any case; scientific pitch as sample libraries name them) or a number 0..127
export function note(t) {
  if (/^\d+$/.test(t)) { const n = +t; return n <= 127 ? n : null; }
  const m = /^([a-gA-G])(#|b)?(-?\d{1,2})$/.exec(t); if (!m) return null;
  const cls = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()], acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, k = 12 * (+m[3] + 1) + cls + acc;
  return k >= 0 && k <= 127 ? k : null;
}
// roles guessed from the tokens: the first note name is the root, v64 / Vel1-100 the velocities, RR2 / Seq2 the round robin; the rest ignored
export function guess(toks) {
  let root = false;
  const numbered = (t, p) => { const l = t.toLowerCase(); return l.startsWith(p) && /^\d/.test(l.slice(p.length)); };
  return toks.map((t) => {
    if (numbered(t, 'rr') || numbered(t, 'seq')) return 'rr';
    if (numbered(t, 'vel') || numbered(t, 'v')) return 'vel';
    if (!root && note(t) != null && !/^\d+$/.test(t)) { root = true; return 'root'; }
    return 'ignore';
  });
}
const num = (t) => { const s = t.replace(/^[a-zA-Z]+|[a-zA-Z]+$/g, ''); return /^\d+$/.test(s) ? +s : null; };
const vel1 = (t) => { const v = num(t); return v != null && v <= 127 ? v : null; };
function vels(t) {
  const s = t.replace(/^[a-zA-Z]+|[a-zA-Z]+$/g, ''), i = s.indexOf('-');
  if (i >= 0) { const a = vel1(s.slice(0, i)), b = vel1(s.slice(i + 1)); return a != null && b != null && a <= b ? { range: [a, b] } : null; }
  const v = vel1(s); return v != null ? { top: v } : null;
}
function parse(name, sep, roles) {
  const tk = tokens(name, sep), p = { root: null, key: null, keys: [null, null], vel: null, vels: [null, null], rr: null, group: '' };
  for (let i = 0; i < roles.length; i++) {
    const r = roles[i]; if (r === 'ignore') continue;
    const t = tk[i]; if (t == null) return { err: i };
    let ok = true;
    if (r === 'root') ok = (p.root = note(t)) != null; else if (r === 'key') ok = (p.key = note(t)) != null;
    else if (r === 'lowKey') ok = (p.keys[0] = note(t)) != null; else if (r === 'highKey') ok = (p.keys[1] = note(t)) != null;
    else if (r === 'vel') ok = (p.vel = vels(t)) != null; else if (r === 'lowVel') ok = (p.vels[0] = vel1(t)) != null; else if (r === 'highVel') ok = (p.vels[1] = vel1(t)) != null;
    else if (r === 'rr') { const n = num(t); ok = n != null && n >= 1; p.rr = n; } else if (r === 'group') p.group = t;
    if (!ok) return { err: i };
  }
  return { p };
}
// the span of value among the ascending values from first to last: past the midpoint below it to the midpoint above it (midpoint = true),
// or from past the previous value to the value itself
function share(values, value, first, last, midpoint) {
  const at = Math.max(0, values.indexOf(value)), mid = (a, b) => Math.floor((a + b) / 2);
  const low = at > 0 ? (midpoint ? mid(values[at - 1], value) + 1 : values[at - 1] + 1) : first;
  const high = at + 1 < values.length ? (midpoint ? mid(value, values[at + 1]) : value) : last;
  return [low, high];
}
// regions { file, root, keys: [lo, hi], vels: [lo, hi], seq: [i, n] | null, group, flag: null | { unparsed: i } | { overlaps: j } }
export function mapNames(names, sep, roles) {
  const parsed = names.map((n) => parse(n, sep, roles)), ok = parsed.filter((x) => x.p).map((x) => x.p);
  const spread = (p) => p.root != null && p.key == null && p.keys[0] == null && p.keys[1] == null;
  const regions = names.map((file, i) => {
    const r = { file, root: 60, keys: [0, 127], vels: [1, 127], seq: null, group: '', flag: null }, x = parsed[i];
    if (x.err != null) { r.flag = { unparsed: x.err }; return r; }
    const p = x.p; r.group = p.group;
    if (p.key != null) { r.root = p.root ?? p.key; r.keys = [p.key, p.key]; }
    else if ((p.keys[0] ?? p.keys[1]) != null) { const lo = p.keys[0] ?? p.keys[1], hi = p.keys[1] ?? p.keys[0]; r.root = p.root ?? lo; r.keys = [Math.min(lo, hi), Math.max(lo, hi)]; }
    else if (p.root != null) { const roots = [...new Set(ok.filter((o) => spread(o) && o.group === p.group).map((o) => o.root))].sort((a, b) => a - b); r.root = p.root; r.keys = share(roots, p.root, 0, 127, true); }
    if (p.vel && p.vel.range) r.vels = p.vel.range;
    else if (p.vels[0] != null || p.vels[1] != null) { const lo = p.vels[0] ?? 1, hi = p.vels[1] ?? 127; r.vels = [Math.min(lo, hi), Math.max(lo, hi)]; }
    return r;
  });
  for (let i = 0; i < regions.length; i++) {                       // velocity layers given by their top only
    const p = parsed[i].p; if (!p || !p.vel || p.vel.top == null) continue;
    const same = (j) => regions[j].group === regions[i].group && regions[j].keys.join() === regions[i].keys.join();
    const tops = [...new Set(regions.map((_, j) => j).filter(same).map((j) => parsed[j].p && parsed[j].p.vel && parsed[j].p.vel.top).filter((v) => v != null))].sort((a, b) => a - b);
    regions[i].vels = share(tops, p.vel.top, 1, 127, false);
  }
  const zone = (r) => r.group + '|' + r.keys.join() + '|' + r.vels.join();
  for (let i = 0; i < regions.length; i++) {                       // round robins of one zone count from 1
    const p = parsed[i].p; if (!p || p.rr == null) continue;
    const rrs = [...new Set(regions.map((_, j) => j).filter((j) => !regions[j].flag && zone(regions[j]) === zone(regions[i])).map((j) => parsed[j].p && parsed[j].p.rr).filter((v) => v != null))].sort((a, b) => a - b);
    if (rrs.length > 1) regions[i].seq = [rrs.indexOf(p.rr) + 1, rrs.length];
  }
  const meet = (a, b) => a[0] <= b[1] && b[0] <= a[1];
  for (let i = 0; i < regions.length; i++) for (let j = 0; j < i; j++) {
    const a = regions[i], b = regions[j]; if (a.flag && a.flag.unparsed != null) continue; if (b.flag && b.flag.unparsed != null) continue;
    const sib = zone(a) === zone(b) && a.seq && b.seq && a.seq.join() !== b.seq.join();
    if (!sib && meet(a.keys, b.keys) && meet(a.vels, b.vels)) { a.flag = a.flag || { overlaps: j }; break; }
  }
  return regions;
}
