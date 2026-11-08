// Lists the FL Studio Mobile modules the importer cannot identify yet (type ids missing from FLM_TYPES), per archive: where each one sits
// (track, chain position, neighbours), how many parameters it has and its first values. The owner can open the same track in FL Studio Mobile,
// read the module's name and send it back: that is the evidence needed to add the id (nothing is guessed from the sound).
// Usage: node --experimental-default-type=module tools/flm-unknown-modules.mjs <file.flm> [more.flm ...] > docs/replica/UNKNOWN-FLM-MODULES.md
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = await import(path.join(root, 'js/import/flm.js')), X = await import(path.join(root, 'js/import/fxmap.js'));
const files = process.argv.slice(2); if (!files.length) { console.error('usage: flm-unknown-modules.mjs <file.flm> ...'); process.exit(1); }
const byType = new Map(), names = {};
for (const f of files) {
  const P = F.parseFlm(new Uint8Array(fs.readFileSync(f))), label = path.basename(f);
  for (const ch of P.channels) (ch.modules || []).forEach((m, k, arr) => {
    if (X.FLM_TYPES[m.type]) return;
    const nb = (j) => (arr[j] ? (X.FLM_TYPES[arr[j].type] ? X.FLM_TYPES[arr[j].type].name : '#' + arr[j].type) : '-');
    if (!byType.has(m.type)) byType.set(m.type, []);
    byType.get(m.type).push({ file: label, ch: ch.name, pos: k + 1, of: arr.length, prev: nb(k - 1), next: nb(k + 1), np: m.params.length, on: m.params[0], p: m.params.slice(0, 8).map((v) => +(+v).toFixed(3)) });
  });
}
const out = ['# Modul FL Studio Mobile yang belum dikenali', '',
  'Dibuat oleh `tools/flm-unknown-modules.mjs` dari arsip .flm pemilik. **Cara membantu**: buka track yang tertulis di FL Studio Mobile, lihat nama modul di slot yang',
  'disebut, lalu tulis nama itu di kolom "Nama asli". Dengan nama yang pasti, id tipe ditambahkan ke `FLM_TYPES` dan modulnya bisa dipetakan; tanpa bukti ini',
  'id tidak ditebak dari suara.', ''];
for (const [t, l] of [...byType.entries()].sort((a, b) => a[0] - b[0])) {
  const nps = [...new Set(l.map((x) => x.np))].join(' / ');
  out.push(`## Tipe ${t}  —  ${l.length} modul, jumlah parameter: ${nps}`, '', '| Arsip | Track | Slot | Sebelum | Sesudah | Parameter awal | Nama asli |', '|---|---|---|---|---|---|---|');
  for (const x of l.slice(0, 6)) out.push(`| ${x.file.slice(0, 24)} | ${x.ch} | ${x.pos} dari ${x.of} | ${x.prev} | ${x.next} | ${x.p.join(', ')} |  |`);
  if (l.length > 6) out.push(`| … | +${l.length - 6} modul lain | | | | | |`);
  out.push('');
}
console.log(out.join('\n'));
