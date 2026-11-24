// Harmor (instrument 38) in the project: loading an image (image synthesis) or an audio file (resynthesis) into a Harmor track's
// partial map. The work runs in js/harmor/worker.js; the packed map goes into two sample-bank slots (kept per track for the session)
// and the track's map parameters point at them. The track remembers the source (t.inst.hm: source, path, options, report), not the map:
// when the project opens the map is made again, or read from the render cache (the app's own storage) when nothing changed.
import { eng } from '../engine.js';
import * as P from '../project.js';
import { HM } from './schema.js';

let worker = null, jobId = 0;
const jobs = new Map(), slots = new Map();           // track id + image -> [slot A, slot B, slot N, slot W]
function work(msg, transfer, onProgress) {
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const j = jobs.get(e.data.id); if (!j) return; if (e.data.progress != null) { if (j.onProgress) j.onProgress(e.data.progress); return; } jobs.delete(e.data.id); if (e.data.error) j.rej(new Error(e.data.error)); else j.res(e.data.ok); };
    worker.onerror = (e) => { for (const [k, j] of jobs) { jobs.delete(k); j.rej(new Error('worker: ' + (e.message || 'gagal'))); } worker = null; };
  }
  return new Promise((res, rej) => { const id = ++jobId; jobs.set(id, { res, rej, onProgress }); worker.postMessage({ id, ...msg }, transfer || []); });
}
const harmorTrack = (i) => { const t = P.state.tracks[i]; return t && t.inst && t.inst.type === 38 ? t : null; };

// the map into the engine: the track's two slots (made once), then the parameters (not an undo step: the map is data, like a sample)
// image g: 0 = the map parameters (MAP_A ...), 1..7 = HM.IMG + 10 (g - 1) + slot (A, B, N, W): several vocals in one Harmor, a note's img picks one
export const imgParam = (g, o) => (g ? HM.IMG + HM.IMG_STRIDE * (g - 1) + o : [HM.MAP_A, HM.MAP_B, HM.MAP_N, HM.MAP_W][o]);
async function install(i, t, out, g = 0) {
  const sk = g ? t.id + '#' + g : t.id; let ids = slots.get(sk);
  if (!ids) { const a = P.allocSampleSlot(), b = P.allocSampleSlot(); if (a < 0 || b < 0) throw new Error('Slot sample penuh (256). Simpan proyek lalu buka ulang.'); ids = [a, b, -1, -1]; slots.set(sk, ids); }
  for (const [q, has] of [[2, out.N], [3, out.W]]) if (has && !(ids[q] >= 0)) { ids[q] = P.allocSampleSlot(); if (ids[q] < 0) throw new Error('Slot sample penuh (256). Simpan proyek lalu buka ulang.'); }
  const r1 = await eng.putSampleBuffers(ids[0], out.A.l, out.A.r || out.A.l); if (!r1 || r1.error) throw new Error((r1 && r1.error) || 'Engine tidak bisa memuat peta.');
  if (out.B) { const r2 = await eng.putSampleBuffers(ids[1], out.B.l, out.B.r || out.B.l); if (!r2 || r2.error) throw new Error((r2 && r2.error) || 'Engine tidak bisa memuat peta.'); }
  const j = P.state.tracks.indexOf(t); if (j < 0) return;
  for (const [q, x] of [[2, out.N], [3, out.W]]) if (x) { const r3 = await eng.putSampleBuffers(ids[q], x.l, x.r || x.l); if (!r3 || r3.error) throw new Error((r3 && r3.error) || 'Engine tidak bisa memuat peta.'); }
  P.setInstParamQuiet(j, imgParam(g, 0), ids[0]); P.setInstParamQuiet(j, imgParam(g, 1), out.B ? ids[1] : -1); P.setInstParamQuiet(j, imgParam(g, 2), out.N ? ids[2] : -1); P.setInstParamQuiet(j, imgParam(g, 3), out.W ? ids[3] : -1);
  if (!(t.inst.params[HM.MAP_MIX] > 0)) P.setInstParamQuiet(j, HM.MAP_MIX, 1);
}
const cacheKey = (kind, path, extra) => 'hm' + kind + '|' + path + '|' + (eng.fileSize ? eng.fileSize(path) : 0) + '|' + JSON.stringify(extra) + '|v4';   // v3: harmonic + noise resynthesis, residual waveform; v4: pitch search down to 27 Hz (sub bass)
async function fromCache(key) {
  const a = await P.cacheGet(key + '|A'); if (!a) return null;
  const b = await P.cacheGet(key + '|B'), nz = await P.cacheGet(key + '|N'), wv = await P.cacheGet(key + '|W');
  return { A: { l: a.l, r: a.r !== a.l ? a.r : null }, B: b ? { l: b.l, r: b.r !== b.l ? b.r : null } : null, N: nz ? { l: nz.l, r: nz.r !== nz.l ? nz.r : null } : null, W: wv ? { l: wv.l, r: wv.r !== wv.l ? wv.r : null } : null };
}
function toCache(key, out) { P.cachePut(key + '|A', out.A.l, out.A.r || out.A.l); if (out.B) P.cachePut(key + '|B', out.B.l, out.B.r || out.B.l); if (out.N) P.cachePut(key + '|N', out.N.l, out.N.r || out.N.l); if (out.W) P.cachePut(key + '|W', out.W.l, out.W.r || out.W.l); }

// Resynthesis: an audio file of the library (WAV / MP3 / FLAC / OGG ...) -> the map. opts: { quality: 0 Draft, 1 Normal, 2 High,
// image: 0..7 (0 = the main map; 1..7 = more vocals in the same Harmor, played by the notes whose img is that number) }
export async function harmorLoadAudio(i, path, opts = {}, onProgress) {
  const t = harmorTrack(i); if (!t) return { error: 'Pilih track Harmor dulu.' };
  const g = Math.max(0, Math.min(7, opts.image | 0));
  const quality = Math.max(0, Math.min(2, opts.quality ?? 1)), key = cacheKey('res', path, { quality });
  let out = await fromCache(key), report = null;
  if (!out) {
    const s = await P.loadSampleObj(path); const b = s && eng.sampleBuffers && eng.sampleBuffers(s.id);
    if (!b || !b.l) return { error: 'Audio tidak bisa dibaca: ' + path.split('/').pop() };
    const sr = (eng.info && eng.info().sampleRate) || 48000, l = b.l.slice(), r = b.r && b.r !== b.l ? b.r.slice() : null;
    const ok = await work({ kind: 'resynth', l, r, sr, quality }, [l.buffer, ...(r ? [r.buffer] : [])], onProgress);
    out = ok; report = ok.report; toCache(key, out);
  }
  await install(i, t, out, g);
  if (g) { t.inst.hmI = t.inst.hmI || {}; const old = t.inst.hmI[g]; t.inst.hmI[g] = { src: 'audio', path, opts: { quality }, ...(report ? { report } : {}), ...(old && old.name && old.path === path ? { name: old.name } : {}) }; P.emit('devices'); return { ok: true, report }; }
  // the resynthesis plays at the file's own level: the map is in sine amplitudes, Harmor's output stage is 0.25 x Volume (headroom for
  // chords), so Map Level 4x = the file's level at Volume 100 % (-3 dB at the default 70 %). Only while the level was never set.
  { const j = P.state.tracks.indexOf(t); if (j >= 0 && t.inst.params[HM.MAP_LEVEL] == null) P.setInstParamQuiet(j, HM.MAP_LEVEL, 4); }
  t.inst.hm = { src: 'audio', path, opts: { quality }, ...(t.inst.hm && t.inst.hm.name && t.inst.hm.path === path ? { name: t.inst.hm.name } : {}), ...(report ? { report } : t.inst.hm && t.inst.hm.path === path && t.inst.hm.report ? { report: t.inst.hm.report } : {}) };
  P.emit('devices');
  return { ok: true, report: t.inst.hm.report || null };
}

// Image synthesis: a picture of the library (PNG / JPEG / WebP ...) -> the map. opts: buildImageMap's (crop x0..y1, frames, bins,
// layout 0 harmonic / 1 frequency, gamma, rangeDb, seconds, stereo, invert)
export async function harmorLoadImage(i, path, opts = {}) {
  const t = harmorTrack(i); if (!t) return { error: 'Pilih track Harmor dulu.' };
  const key = cacheKey('img', path, opts);
  let out = await fromCache(key);
  if (!out) {
    const bytes = await eng.readBytes(path); if (!bytes) return { error: 'Gambar tidak bisa dibaca: ' + path.split('/').pop() };
    let bmp; try { bmp = await createImageBitmap(new Blob([bytes])); } catch (_) { return { error: 'Format gambar tidak didukung.' }; }
    const sc = Math.min(1, 1024 / bmp.width, 1024 / bmp.height), w = Math.max(1, Math.round(bmp.width * sc)), h = Math.max(1, Math.round(bmp.height * sc));
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = cv.getContext('2d'); g.drawImage(bmp, 0, 0, w, h); const px = g.getImageData(0, 0, w, h).data;
    const rgba = new Uint8ClampedArray(px);
    out = await work({ kind: 'image', rgba, w, h, opts }, [rgba.buffer]); toCache(key, out);
  }
  await install(i, t, out);
  t.inst.hm = { src: 'image', path, opts };
  P.emit('devices');
  return { ok: true };
}
export function harmorClearMap(i, g = 0) {
  const t = harmorTrack(i); if (!t) return;
  if (g) { for (let o = 0; o < 4; o++) P.setInstParamQuiet(i, imgParam(g, o), -1); if (t.inst.hmI) delete t.inst.hmI[g]; P.emit('devices'); return; }
  P.setInstParamQuiet(i, HM.MAP_A, -1); P.setInstParamQuiet(i, HM.MAP_B, -1); P.setInstParamQuiet(i, HM.MAP_N, -1); P.setInstParamQuiet(i, HM.MAP_W, -1); delete t.inst.hm; P.emit('devices');
}
// a project opening: the map of a Harmor track is made again (or read from the cache)
export async function restoreHarmorMap(t) {
  await restoreHarmorTables(t);
  const i = P.state.tracks.indexOf(t); if (i < 0 || !t.inst) return { ok: true };
  try {
    let r = { ok: true }; const h = t.inst.hm;
    if (h) r = h.src === 'image' ? await harmorLoadImage(i, h.path, h.opts || {}) : await harmorLoadAudio(i, h.path, h.opts || {});
    for (const [g, x] of Object.entries(t.inst.hmI || {})) if (x && x.path) { const r2 = await harmorLoadAudio(P.state.tracks.indexOf(t), x.path, { ...(x.opts || {}), image: +g }); if (r2.error) r = r2; }   // the other vocals
    return r;
  } catch (e) { return { error: (e && e.message) || String(e) }; }
}

// ---- drawn harmonic tables (the HARM editor): level and phase (0..1 of a cycle) of partials 1..516 of timbre tt, into a sample-bank slot
// of their own (left = level, right = phase) and the timbre's table parameter (13 / 23); kept in the project as plain numbers
const tslots = new Map();                              // track id -> [slot timbre A, slot timbre B]
export async function harmorSetTable(i, tt, lv, ph) {
  const t = harmorTrack(i); if (!t) return { error: 'Pilih track Harmor dulu.' };
  const j = HM.T * (tt + 1) + 3;
  if (!lv) { P.setInstParamQuiet(i, j, -1); if (t.inst.hmT) t.inst.hmT[tt] = null; return { ok: true }; }
  let ids = tslots.get(t.id); if (!ids) { ids = [-1, -1]; tslots.set(t.id, ids); }
  if (ids[tt] < 0) { ids[tt] = P.allocSampleSlot(); if (ids[tt] < 0) return { error: 'Slot sample penuh (256).' }; }
  const L = Float32Array.from(lv), R = Float32Array.from(ph || new Float32Array(L.length));
  const r = await eng.putSampleBuffers(ids[tt], L, R); if (!r || r.error) return { error: (r && r.error) || 'Engine tidak bisa memuat tabel.' };
  const k = P.state.tracks.indexOf(t); if (k < 0) return { ok: true };
  P.setInstParamQuiet(k, j, ids[tt]);
  const q = (a) => Array.from(a, (x) => Math.round(x * 1e4) / 1e4);
  t.inst.hmT = t.inst.hmT || [null, null]; t.inst.hmT[tt] = { lv: q(L), ph: q(R) };
  return { ok: true };
}
export async function restoreHarmorTables(t) {
  const i = P.state.tracks.indexOf(t); if (i < 0 || !t.inst || !t.inst.hmT) return;
  for (let tt = 0; tt < 2; tt++) { const x = t.inst.hmT[tt]; if (x && x.lv) await harmorSetTable(i, tt, x.lv, x.ph); }
}
