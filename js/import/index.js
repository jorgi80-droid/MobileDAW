// Project import: FL Studio Mobile (.flm), FL Studio (.flp), Ableton Live (.als) and ZIP archives that hold one of them plus samples.
// Steps (each reports progress): read archive -> parse -> convert (js/import/build.js) -> copy samples into Samples/Imports/<name>/ (missing
// ones get a short silent placeholder file) -> save Projects/<name>.mdaw -> open it (samples are decoded, stretched clips rendered).
// onProgress(fraction 0..1, label) is called often; the work yields to the UI between files so the progress bar moves.
import { readZip } from '../zip.js';
import { encodeWav } from '../engine/wav.js';
import { parseFlm, flmToModel, isFlm } from './flm.js';
import { parseFlp, isFlp } from './flp.js';
import { parseAls, isAls } from './als.js';
import { buildMdaw, safeName } from './build.js';
import { migrateJson, describe, resolveFlmAutomation } from './fxmap.js';

export const IMPORT_EXT = /\.(flm|flp|als|zip)$/i;
const yieldUI = () => new Promise((r) => setTimeout(r, 0));
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
const isZip = (u) => u.length > 4 && u[0] === 0x50 && u[1] === 0x4b && u[2] === 0x03 && u[3] === 0x04;
export const kindOf = (name, u) => (isZip(u) ? 'zip' : isFlm(u) ? 'flm' : isFlp(u) ? 'flp' : isAls(u, name) ? 'als' : null);

// a short silent WAV: the stand-in for an audio clip whose sample was not in the archive (the clip keeps its place, length and name)
let silent = null;
function silentWav() { if (!silent) { const n = 22050, z = new Float32Array(n); silent = new Uint8Array(encodeWav([z], null, n, 44100, 16, 1)); } return silent; }

// Parse a project file (bytes) into the neutral model. Sync parsers; async only for the gzip of .als.
export async function parseProject(kind, u8, onProgress) {
  if (kind === 'flm') return flmToModel(parseFlm(u8, onProgress));
  if (kind === 'flp') return parseFlp(u8);
  if (kind === 'als') return parseAls(u8);
  throw new Error('Format proyek tidak dikenal. Didukung: .flm, .flp, .als (atau ZIP berisi salah satunya).');
}

// io: { saveBytes(path, Uint8Array), writeText(path, text), open(text) -> missing[], home: '' }
export async function importProject(fileName, buf, io, onProgress = () => {}) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const kind0 = kindOf(fileName, u8);
  if (!kind0) throw new Error('File ini bukan proyek FL Studio Mobile (.flm), FL Studio (.flp), Ableton (.als), atau ZIP.');
  // 1. the archive (0 - 15 %)
  let entries = new Map(), projName = fileName, projBytes = u8, kind = kind0, projDir = '';
  if (kind0 === 'zip') {
    onProgress(0.01, 'Membuka arsip ZIP…'); await yieldUI();
    const list = await readZip(u8);
    for (const e of list) entries.set(norm(e.name), e.data);
    const proj = list.find((e) => /\.flm$/i.test(e.name)) || list.find((e) => /\.flp$/i.test(e.name)) || list.find((e) => /\.als$/i.test(e.name));
    if (!proj) {
      if (list.some((e) => /\.mdaw$/i.test(e.name))) throw new Error('ZIP ini berisi proyek MDAW: pakai "Buka proyek (.mdaw / .zip) dari perangkat".');
      throw new Error('Tidak ada file .flm / .flp / .als di dalam ZIP.');
    }
    projName = proj.name.split('/').pop(); projBytes = proj.data; kind = kindOf(projName, projBytes);
    projDir = norm(proj.name).split('/').slice(0, -1).join('/');                // the folder of the project file inside the zip
    if (!kind || kind === 'zip') throw new Error('File proyek di dalam ZIP tidak dikenali: ' + projName);
  }
  onProgress(0.15, 'Membaca proyek ' + projName + '…'); await yieldUI();
  // 2. parse (15 - 30 %)
  const M = await parseProject(kind, projBytes, (f) => onProgress(0.15 + 0.15 * f, 'Membaca proyek…'));
  const name = safeName(M.name || projName.replace(/\.\w+$/, ''));
  // sample lookup: exact relative path, else the same file name anywhere in the archive (desktop projects store absolute paths)
  const byBase = new Map();
  for (const k of entries.keys()) { const b = k.split('/').pop().toLowerCase(); if (!byBase.has(b)) byBase.set(b, k); }
  const resolve = (p) => { const k = norm(p); if (entries.has(k)) return k; for (const e of entries.keys()) if (k.endsWith('/' + e) || e.endsWith('/' + k)) return e; return byBase.get(k.split('/').pop().toLowerCase()) || null; };
  // 3. convert (30 - 35 %)
  onProgress(0.3, 'Mengonversi track, klip dan efek…'); await yieldUI();
  // FL Studio Mobile samples go to FLM/<project>/<their folders> (e.g. FLM/My Song/My Samples/...); other formats to Samples/Imports/<project>
  const root = (io.home || '') + (kind === 'flm' ? '/FLM/' : '/Samples/Imports/') + name;
  const relName = (e) => (projDir && e.startsWith(projDir + '/') ? e.slice(projDir.length + 1) : e);
  const { json, files, report } = buildMdaw(M, { root, resolve, relName });
  json.name = name;
  // 3b. modules MDAW does not have -> stock plugins where the sound is kept (io.fxMode 'map' | 'all' | 'none')
  const fx = io.fxMode === 'none' ? null : await migrateJson(json, io.fxMode || 'map', (f) => onProgress(0.3 + 0.05 * f, 'Menyesuaikan dan memproses parameter modul ke plugin bawaan\u2026'));
  resolveFlmAutomation(json, report);                                      // plugin automation lanes -> the converted device's parameter (or reported)
  // 4. samples (35 - 70 %)
  for (let k = 0; k < files.length; k++) {
    const f = files[k];
    onProgress(0.36 + 0.34 * k / Math.max(1, files.length), `Menyalin sample ${k + 1}/${files.length}…`);
    await io.saveBytes(f.path, f.missing ? silentWav() : entries.get(f.src));
    if (k % 4 === 3) await yieldUI();
  }
  if (json.needsSoundFont) {                                    // a library program was replaced by the bundled General MIDI SoundFont
    onProgress(0.7, 'Menyiapkan SoundFont pengganti\u2026'); await yieldUI();
    if (io.ensureSoundFont) await io.ensureSoundFont(json.needsSoundFont);
    delete json.needsSoundFont;
  }
  // 5. save + open (70 - 100 %)
  const text = JSON.stringify(json), path = (io.home || '') + '/Projects/' + name + '.mdaw';
  onProgress(0.7, 'Menyimpan proyek MDAW…'); await yieldUI();
  await io.writeText(path, text);
  onProgress(0.72, 'Memuat sample dan klip…'); await yieldUI();
  const missingOnOpen = await io.open(text, (f) => onProgress(0.72 + 0.28 * f, 'Memuat sample dan klip…'));
  onProgress(1, 'Selesai');
  return { name, path, kind, app: M.app, report, fx: fx && describe(fx), missingOnOpen: missingOnOpen || [] };
}
