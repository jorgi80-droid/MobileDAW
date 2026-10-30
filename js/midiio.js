// .mid import / export (SMF type 0 and 1) for the project: tempo (also the tempo lane), time signature, markers, track names, notes, velocity, pitch bend and CC.
import { encodeSmf, decodeSmf } from './engine/smf.js';
import { normOf } from './defs.js';
import { eng } from './engine.js';
import { pickerAccept } from './native.js';
import { h, modal, toast } from './ui.js';
import { checkpoint } from './history.js';
import * as P from './project.js';
const { state, PPQ } = P;

const fileStem = () => (state.projectName || 'Untitled').replace(/[^\w\- ]+/g, '').trim() || 'Untitled';

// ------------------------------------------------------------------ export
function tempoEvents() {
  if (!P.tempoMapOn()) return [{ tick: 0, bpm: state.bpm }];
  const f = P.tempoPts(), out = [];
  for (let i = 0; i + 1 < f.length; i += 2) {
    const t = f[i], b = f[i + 1];
    out.push({ tick: t, bpm: b });
    const t2 = f[i + 2], b2 = f[i + 3];
    if (t2 !== undefined && t2 > t && Math.abs(b2 - b) > 0.01) for (let u = t + 120; u < t2; u += 120) out.push({ tick: u, bpm: b + (b2 - b) * (u - t) / (t2 - t) });   // ramps become small steps
  }
  return out;
}
export function buildProjectMidi() {
  const tracks = []; let chN = 0;
  for (const t of state.tracks) {
    if (t.kind !== 'midi' && t.kind !== 'drum') continue;
    const notes = [], lanes = new Map();
    for (const c of t.clips) {
      if (c.muted) continue;
      const ll = P.loopOf(c), reps = ll ? Math.min(512, Math.ceil(c.len / ll)) : 1;
      for (let k = 0; k < reps; k++) {
        const o = ll ? k * ll : 0, lim = ll ? Math.min(ll, c.len - o) : c.len;
        for (const n of c.notes || []) if (n.t < lim) notes.push({ t: c.start + o + n.t, d: Math.min(n.d, lim - n.t), p: n.p, v: n.v });
        for (const l of c.cc || []) {
          const key = l.k + ':' + l.n; let q = lanes.get(key); if (!q) { q = { k: l.k, n: l.n, pts: [] }; lanes.set(key, q); }
          for (const pt of l.pts) if (pt.t <= lim) q.pts.push({ t: c.start + o + pt.t, v: pt.v });
        }
      }
    }
    if (!notes.length && !lanes.size) continue;
    let ch = 9; if (t.kind !== 'drum') { ch = chN++ % 15; if (ch >= 9) ch++; }
    tracks.push({ name: t.name, ch, notes, cc: [...lanes.values()] });
  }
  return { tracks, bytes: encodeSmf({ name: state.projectName, tempos: tempoEvents(), sig: state.sig, sigs: [{ tick: 0, n: state.sig.n, d: state.sig.d }, ...state.sigs.map((c) => ({ tick: P.barStart(c.bar), n: c.n, d: c.d }))], markers: state.markers.map((m) => ({ tick: m.t, name: m.name })), tracks }) };
}
export function exportMidi() {
  const { tracks, bytes } = buildProjectMidi();
  if (!tracks.length) { toast('Tidak ada klip MIDI (synth atau drum) untuk diekspor.', 3500); return; }
  if (!eng.downloadBlob) { toast('Ekspor MIDI tersedia di versi web.'); return; }
  eng.downloadBlob(new Blob([bytes], { type: 'audio/midi' }), fileStem() + '.mid');
  toast(`MIDI diekspor: ${tracks.length} track.`, 3000);
}

// ------------------------------------------------------------------ import
// General MIDI drum notes -> the pads of a MobileDAW drum track (kick 36, snare 38, clap 39, hat 42, open hat 46, tom 41)
const GM_DRUM = { 35: 36, 36: 36, 37: 38, 38: 38, 40: 38, 39: 39, 42: 42, 44: 42, 46: 46, 49: 46, 51: 46, 52: 46, 53: 46, 55: 46, 57: 46, 59: 46, 41: 41, 43: 41, 45: 41, 47: 41, 48: 41, 50: 41 };
function thin(pts) {
  const o = []; let lastV = NaN;
  for (let i = 0; i < pts.length; i++) { const q = pts[i]; if (q.v === lastV && i + 1 < pts.length && pts[i + 1].v === q.v) continue; o.push(q); lastV = q.v; }
  if (o.length > 4000) { const k = Math.ceil(o.length / 4000); return o.filter((_, i) => i % k === 0 || i === o.length - 1); }
  return o;
}
const apply = (m, withTempo) => P.HK.group(() => applyInner(m, withTempo));   // clips, tracks, tempo and meter of one import = one undo step
function applyInner(m, withTempo) {
  checkpoint();
  const rep = { tracks: 0, notes: 0, dropped: 0, tempo: 0, sigNote: '' };
  if (withTempo) {
    if (m.sigs.length) {                                       // signature events -> bar-based meter map (a change inside a bar is moved to the nearest bar line)
      const okSig = (x) => [1, 2, 4, 8, 16].includes(x.d) && x.n >= 1 && x.n <= 32;
      let cur = { n: 4, d: 4 }, curTick = 0, curBar = 0; const list = []; let skipped = 0;
      for (const x of m.sigs) {
        if (!okSig(x)) { skipped++; continue; }
        const bl = cur.n * Math.round(P.PPQ * 4 / cur.d), bar = curBar + Math.max(0, Math.round((x.tick - curTick) / bl));
        if (bar === 0) { cur = { n: x.n, d: x.d }; list.length = 0; list.push({ bar: 0, ...cur }); continue; }
        if (x.n === cur.n && x.d === cur.d) continue;
        curTick += (bar - curBar) * bl; curBar = bar; cur = { n: x.n, d: x.d }; list.push({ bar, ...cur });
      }
      const first = list.find((q) => q.bar === 0);
      if (first) P.setSig(first.n, first.d); else if (list.length) P.setSig(4, 4);
      let over = 0; for (const q of list) if (q.bar > 0 && P.setSigAt(q.bar, q.n, q.d) === false) over++;
      if (skipped) rep.sigNote = `${skipped} perubahan birama tidak didukung dan dilewati.`;
      if (over) rep.sigNote = (rep.sigNote ? rep.sigNote + ' ' : '') + `Hanya ${P.MAX_SIG_CHANGES} perubahan birama yang dipakai.`;
    }
    if (m.tempos.length) {
      const t0 = m.tempos[0].bpm, same = m.tempos.every((q) => Math.abs(q.bpm - t0) < 0.02);
      P.setBpm(Math.round(t0 * 100) / 100);
      if (!same) {                                                // tempo changes: fill the tempo lane (steps, like a DAW tempo track)
        const lane = P.addAutoTrack({ kind: 6, strip: 'master', param: 0, def: P.TEMPO_DEF }, 'Tempo');
        const li = lane ? state.tracks.indexOf(lane) : -1;
        if (li >= 0) {
          const last = m.tempos[m.tempos.length - 1].tick, len = Math.max(P.BAR, P.barCeil(last + 1) + P.barLenAt(last + 1));
          let c = lane.clips[0]; if (!c) c = P.addClip(li, 0, len); else c.len = Math.max(c.len, len);
          const nv = (b) => normOf(P.TEMPO_DEF, Math.max(20, Math.min(300, b))), pts = [];
          m.tempos.forEach((q, i) => { if (i > 0 && q.tick > 0) pts.push({ t: q.tick - 1, v: nv(m.tempos[i - 1].bpm) }); pts.push({ t: q.tick, v: nv(q.bpm) }); });
          if (pts[0].t > 0) pts.unshift({ t: 0, v: pts[0].v });
          pts.push({ t: c.len, v: pts[pts.length - 1].v });
          c.pts = pts; P.syncClips(li); P.syncTempoMap(); rep.tempo = m.tempos.length;
        }
      }
    }
    for (const mk of m.markers) P.addMarker(mk.tick, mk.name);
  }
  let first = -1;
  for (const tr of m.tracks) {
    const drum = tr.ch === 9, kind = drum ? 'drum' : 'midi';
    let notes = tr.notes;
    if (drum) { const keep = []; for (const n of notes) { const p = GM_DRUM[n.p]; if (p === undefined) rep.dropped++; else keep.push({ ...n, p }); } notes = keep; }
    if (!notes.length) continue;
    const t = P.addTrack(kind); if (!t) { rep.dropped += notes.length; break; }
    const i = state.tracks.indexOf(t);
    t.name = (tr.name || (drum ? 'Drum' : 'Kanal ' + (tr.ch + 1))) + (tr.multi && tr.name ? ' (ch ' + (tr.ch + 1) + ')' : '');
    const a = P.barFloor(Math.min(...notes.map((n) => n.t))), b = Math.max(...notes.map((n) => n.t + n.d)), len = Math.max(P.barLenAt(a), P.barCeil(b) - a);
    const c = P.addClip(i, a, len); c.name = t.name;
    for (const n of notes) c.notes.push({ t: n.t - a, d: n.d, p: n.p, v: Math.max(0.05, Math.min(1, n.v)) });
    if (!drum && tr.cc.length) c.cc = tr.cc.map((l) => ({ k: l.k, n: l.n, pts: thin(l.pts.map((q) => ({ t: Math.max(0, q.t - a), v: l.k === 'bend' ? Math.round(q.v * 100) / 100 : q.v }))) })).filter((l) => l.pts.length);
    if (c.cc && !c.cc.length) delete c.cc;
    P.clipChanged(i);
    rep.tracks++; rep.notes += notes.length; if (first < 0) first = i;
  }
  if (first >= 0) P.selectTrack(first);
  P.emit('tracks'); P.emit('clips');
  return rep;
}
export async function importMidi() {
  const file = await new Promise((res) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = pickerAccept('.mid,.midi,audio/midi'); inp.style.display = 'none'; document.body.append(inp);
    inp.onchange = () => { const f = inp.files && inp.files[0]; inp.remove(); res(f || null); };
    inp.addEventListener('cancel', () => { inp.remove(); res(null); });
    inp.click();
  });
  if (!file) return;
  let m;
  try { m = decodeSmf(await file.arrayBuffer()); } catch (e) { toast(e.message || 'Berkas MIDI tidak bisa dibaca.', 5000); return; }
  if (!m.tracks.length) { toast('File MIDI ini tidak berisi not.', 4000); return; }
  const nn = m.tracks.reduce((a, t) => a + t.notes.length, 0), room = 64 - state.tracks.length;
  if (m.tracks.length > room) { toast(`Track proyek hampir penuh: file ini butuh ${m.tracks.length} track, tersisa ${room}.`, 5000); return; }
  const info = `${m.tracks.length} track, ${nn} not` + (m.tempos.length ? `, tempo ${Math.round(m.tempos[0].bpm * 100) / 100} BPM` + (m.tempos.length > 1 ? ` (${m.tempos.length} perubahan)` : '') : '') + (m.sigs.length ? `, birama ${m.sigs[0].n}/${m.sigs[0].d}` : '') + '.';
  const done = (withTempo) => () => { const r = apply(m, withTempo); toast(`MIDI diimpor: ${r.tracks} track, ${r.notes} not.` + (r.dropped ? ` ${r.dropped} not drum di luar pad dilewati.` : '') + (r.sigNote ? ' ' + r.sigNote : ''), r.sigNote || r.dropped ? 6000 : 3500); };
  const hasWork = state.tracks.some((t) => t.clips && t.clips.length);
  if (!hasWork) { done(true)(); return; }
  modal('Impor MIDI', h('div', {}, file.name + ' berisi ' + info + ' Terapkan juga tempo, birama, dan marker file ini ke proyek yang sedang terbuka?'), [
    { label: 'Batal' }, { label: 'Hanya track', fn: done(false) }, { label: 'Track + tempo', go: true, fn: done(true) },
  ]);
}
