// Project import in the real app (Chromium, Pixel 7 landscape): pick a .flm / .zip through Browser -> Proyek -> Impor, watch the progress
// window, check the report, the converted project (tracks, clips, samples decoded, stretched clips rendered) and the placeholder cards.
// Usage: IMPORT_FILE=/path/project.zip node tools/import-ui-test.mjs   (needs Playwright + Chromium; not part of run-tests)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.env.IMPORT_FILE;
if (!FILE || !fs.existsSync(FILE)) { console.log('set IMPORT_FILE=/path/to/project.zip (.flm / .flp / .als)'); process.exit(0); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7 landscape'] }); const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(1200);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const ev = (f, a) => page.evaluate(f, a);
const t0 = Date.now();
const chooser = page.waitForEvent('filechooser');
await ev(async () => { (await import('./js/import/ui.js')).importDialog(); });
const fc = await chooser; await fc.setFiles(FILE);
const seen = new Set();
for (let k = 0; k < 600; k++) {                                   // poll the progress window
  const st = await ev(() => { const w = document.querySelector('.imp'); return w ? w.querySelector('.imp-row b').textContent + ' ' + w.querySelector('.imp-l').textContent : null; });
  if (st) seen.add(st.split(' ')[0]); else if (k > 2) break;
  await page.waitForTimeout(250);
}
const secs = (Date.now() - t0) / 1000;
ok(seen.size >= 4, 'progress window moved through ' + seen.size + ' values: ' + [...seen].slice(0, 12).join(' '));
const rep = await ev(() => { const m = [...document.querySelectorAll('#layer .modal')].pop(); return m ? m.textContent : ''; });
ok(/Impor selesai/.test(rep), 'report shown (' + secs.toFixed(1) + ' s): ' + rep.slice(0, 220).replace(/\s+/g, ' '));
const st = await ev(async () => { const P = await import('./js/project.js'); const S = P.state; const aud = S.tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.clips);
  return { name: S.projectName, bpm: S.bpm, tracks: S.tracks.length, audio: aud.length, decoded: aud.filter((c) => c.sample && c.sample.id >= 0 && c.sample.duration > 0).length, warped: aud.filter((c) => c.warp).length, rendered: aud.filter((c) => c.warp && c.dsample).length,
    missingDev: S.tracks.reduce((n, t) => n + t.devices.filter((d) => d.missing).length, 0) + S.master.devices.filter((d) => d.missing).length, midi: S.tracks.filter((t) => t.kind === 'midi').length, drum: S.tracks.filter((t) => t.kind === 'drum').length,
    pads: (S.tracks.find((t) => t.kind === 'drum') || { inst: { pads: [] } }).inst.pads.filter((q) => q.sample).length, notes: S.tracks.reduce((n, t) => n + t.clips.reduce((m, c) => m + (c.notes ? c.notes.length : 0), 0), 0) }; });
console.log('     project', JSON.stringify(st));
const where = await ev(async () => { const P = await import('./js/project.js'); const S = P.state; const ps = new Set(); for (const t of S.tracks) { for (const c of t.clips) if (c.sample) ps.add(c.sample.path); for (const z of (t.inst && t.inst.zones) || []) if (z.sample) ps.add(z.sample.path); for (const q of (t.inst && t.inst.pads) || []) if (q.sample) ps.add(q.sample.path); } const L = [...ps]; const { eng } = await import('./js/engine.js'); const top = eng.listDir('/FLM'); return { n: L.length, inFlm: L.filter((p) => p.startsWith('/FLM/' + S.projectName + '/')).length, sample: L[0], listed: top && top.items ? top.items.map((x) => x.name) : null }; });
console.log('     sample locations', JSON.stringify(where));
ok(where.n > 0 && where.inFlm === where.n && where.listed && where.listed.includes(st.name), 'every sample stored under FLM/<project>/ (' + where.inFlm + '/' + where.n + '), the folder shows in the library');
ok(st.tracks > 0 && st.decoded === st.audio, 'every audio clip has a decoded sample (' + st.decoded + '/' + st.audio + ')');
ok(st.warped === 0 || st.rendered === st.warped, 'stretched clips rendered (' + st.rendered + '/' + st.warped + ')');
ok(st.missingDev > 0, 'placeholder devices in the project: ' + st.missingDev);
ok(/diterapkan ke plugin stock MobileDAW/.test(rep) && /Modul efek \/ plugin/.test(rep), 'report: how many modules became stock plugins and which were not applied');
const before = await ev(async () => { const P = await import('./js/project.js'); const S = P.state; const all = [S.master, ...S.returns, ...S.tracks].flatMap((c) => c.devices); return { stock: all.filter((d) => !d.missing).length, missing: all.filter((d) => d.missing).length, eq8: all.filter((d) => d.type === 31 && d.from).length }; });
console.log('     after import', JSON.stringify(before));
ok(before.eq8 > 0, 'Graphic EQ modules converted to EQ Eight during import (' + before.eq8 + ')');
// "replace every missing module with stock plugins" (button in the report)
await page.screenshot({ path: path.join(root, 'docs/redesign/55-import-report.png') });
const hasBtn = await ev(() => !![...document.querySelectorAll('#layer .modal .b')].find((x) => /Ganti seluruh modul/.test(x.textContent)));
ok(hasBtn, 'report offers "Ganti seluruh modul hilang dengan stock plugin"');
await ev(() => [...document.querySelectorAll('#layer .modal .b')].find((x) => /Ganti seluruh modul/.test(x.textContent))?.click());
const seen2 = new Set(); for (let k = 0; k < 200; k++) { const t = await ev(() => { const w = [...document.querySelectorAll('.imp')].pop(); return w ? w.querySelector('.imp-row b').textContent : null; }); if (t) seen2.add(t); else if (k > 4) break; await page.waitForTimeout(100); }
const rep2 = await ev(() => { const m = [...document.querySelectorAll('#layer .modal')].pop(); return m ? m.textContent : ''; });
const after = await ev(async () => { const P = await import('./js/project.js'); const S = P.state; const all = [S.master, ...S.returns, ...S.tracks].flatMap((c) => c.devices); return { stock: all.filter((d) => !d.missing).length, missing: all.filter((d) => d.missing).length, bypassedLater: all.filter((d) => d.from && d.from.how === 'later' && d.bypass).length }; });
console.log('     after replace-all', JSON.stringify(after), 'progress', [...seen2].join(' '));
ok(/Modul diganti: \d+ diterapkan, \d+ tidak/.test(rep2) && after.stock > before.stock && after.bypassedLater === after.stock - before.stock, 'replace all: ' + (after.stock - before.stock) + ' more modules became stock plugins (bypassed, ready to adjust); ' + after.missing + ' without equivalent stay placeholders');
await ev(async () => (await import('./js/history.js')).undoOp()); await page.waitForTimeout(300);
const undone = await ev(async () => { const P = await import('./js/project.js'); const S = P.state; return [S.master, ...S.returns, ...S.tracks].flatMap((c) => c.devices).filter((d) => d.missing).length; });
ok(undone === before.missing, 'one Undo brings every replaced module back (' + undone + ' placeholders)');
await ev(async () => (await import('./js/history.js')).redoOp()); await page.waitForTimeout(300);
await page.evaluate(() => [...document.querySelectorAll('#layer .modal .b')].find((x) => x.textContent === 'OK')?.click()); await page.waitForTimeout(300);
await ev(async () => { const P = await import('./js/project.js'); const i = P.state.tracks.findIndex((t) => t.devices.some((d) => d.missing)); P.selectTrack(i); (await import('./js/devices.js')).render(); });
await page.evaluate(() => [...document.querySelectorAll('#layer .modal .b')].find((x) => x.textContent === 'OK')?.click()); await page.waitForTimeout(500);
ok(await ev(() => [...document.querySelectorAll('.card.dv-missing h4')].some((x) => /^\[Plugin tidak tersedia\]/.test(x.textContent))), 'device chain shows "[Plugin tidak tersedia] <name>" cards');
await page.screenshot({ path: path.join(root, 'docs/redesign/54-import-flm.png') });
await ev(async () => { const P = await import('./js/project.js'); P.play(); }); await page.waitForTimeout(1500);
const pos = await ev(async () => (await import('./js/project.js')).state.pos); await ev(async () => (await import('./js/project.js')).stop());
ok(pos > 0, 'the imported project plays (position ' + Math.round(pos) + ' ticks after 1.5 s)');
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nimport-ui-test: all passed'); process.exit(bad ? 1 : 0);
