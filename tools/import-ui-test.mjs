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
// the import options (the only place to choose "replace missing modules with stock plugins"): on by default
await page.waitForSelector('#layer .modal .imp-opt', { timeout: 5000 });
const opt = await ev(() => { const m = [...document.querySelectorAll('#layer .modal')].pop(), cb = m.querySelector('.imp-opt input[type=checkbox]'); return { text: m.textContent, on: !!(cb && cb.checked) }; });
ok(/Ganti modul yang hilang dengan stock plugin/.test(opt.text) && opt.on, 'import options: "Ganti modul yang hilang dengan stock plugin" offered while loading, on by default');
await ev(() => [...document.querySelectorAll('#layer .modal .b')].find((x) => x.textContent === 'Impor').click());
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
const a7 = await ev(async () => { const P = await import('./js/project.js'); const t = P.state.tracks.find((x) => /^Audio 7$/.test(x.name)); if (!t) return null; const c = t.clips.slice().sort((a, b) => a.start - b.start);
  return { n: c.length, bars: c.reduce((s, x) => s + x.len, 0) / P.BAR, pitched: c.filter((x) => x.warp && x.warp.pitch).length, rendered: c.filter((x) => x.warp && x.dsample).length, firstLen: c[0] && c[0].len / P.BAR }; });
if (a7) ok(a7.n > 60 && a7.firstLen === 2 && a7.pitched === a7.rendered && a7.pitched > 60, 'FLM clips never resized fill their cycle (Audio 7: ' + a7.n + ' clips, ' + a7.bars + ' bars, first ' + a7.firstLen + ' bars) and keep their pitch (' + a7.pitched + ' pitched, ' + a7.rendered + ' rendered)');
const ins = await ev(async () => { const P = await import('./js/project.js'), { eng } = await import('./js/engine.js'); const T = P.state.tracks;
  return T.filter((t) => t.inst && [4, 6, 1, 2, 5, 30, 31, 32, 33].includes(t.inst.type) && t.kind === 'midi').map((t) => ({ name: t.name, type: t.inst.type, zones: (t.inst.zones || []).filter((z) => z.sample).length, roots: (t.inst.zones || []).map((z) => z.root).join(), sf: t.inst.sf ? t.inst.sf.preset : null, sfSize: t.inst.sf ? eng.fileSize(t.inst.sf.path) : 0, sub: t.inst.sub ? t.inst.sub.gm : '' })); });
console.log('     instruments: ' + JSON.stringify(ins));
ok(/Instrumen/.test(rep) && ins.length > 0, 'report lists the instrument conversions');
ok(ins.filter((x) => x.type === 30).length > 0 && ins.filter((x) => x.type === 30).every((x) => x.zones > 0), 'FLM DirectWave with its samples -> MDAW DirectWave (FLM engine) zones (' + ins.filter((x) => x.type === 30).map((x) => x.name + ': ' + x.zones + ' zona, root ' + x.roots).join('; ') + ')');
ok(ins.filter((x) => x.type === 6).every((x) => x.sfSize > 0 && x.sub), 'DirectWave library program -> General MIDI SoundFont present in the library (' + ins.filter((x) => x.type === 6).map((x) => x.name + ' -> ' + x.sub).join('; ') + ')');
ok(/diterapkan ke plugin stock MobileDAW/.test(rep) && /Modul efek \/ plugin/.test(rep), 'report: how many modules became stock plugins and which were not applied');
const before = await ev(async () => { const P = await import('./js/project.js'); const S = P.state; const all = [S.master, ...S.returns, ...S.tracks].flatMap((c) => c.devices); return { stock: all.filter((d) => !d.missing).length, missing: all.filter((d) => d.missing).length, eq8: all.filter((d) => d.type === 31 && d.from).length }; });
console.log('     after import', JSON.stringify(before));
ok(before.eq8 > 0, 'Graphic EQ modules converted to EQ Eight during import (' + before.eq8 + ')');
// modules with a stock equivalent whose parameters cannot be converted exactly were put in bypassed (the option above), the report has no
// separate "replace" button, and the project menu no longer offers it
await page.screenshot({ path: path.join(root, 'docs/redesign/55-import-report.png') });
const later = await ev(async () => { const P = await import('./js/project.js'); const S = P.state; return [S.master, ...S.returns, ...S.tracks].flatMap((c) => c.devices).filter((d) => d.from && d.from.how === 'later' && d.bypass).length; });
ok(later > 0, 'modules with a stock equivalent but unconvertible parameters became bypassed stock plugins during the import (' + later + ')');
ok(!/Ganti seluruh modul/.test(rep) && !(await ev(() => [...document.querySelectorAll('#layer .modal .b')].some((x) => /Ganti/.test(x.textContent)))), 'the report has no separate replace button');
await page.evaluate(() => [...document.querySelectorAll('#layer .modal .b')].find((x) => x.textContent === 'OK')?.click()); await page.waitForTimeout(400);
await ev(() => document.getElementById('btn-menu').click()); await page.waitForTimeout(450);
const mm = await ev(() => { const m = [...document.querySelectorAll('.menu')].pop(); return m ? [...m.querySelectorAll('.mi')].map((x) => x.textContent) : []; });
ok(mm.length > 0 && !mm.some((t) => /Ganti modul/.test(t)) && mm.includes('Impor') && mm.includes('Ekspor'), 'project menu: no "Ganti modul…" entry, imports / exports in submenus (' + mm.filter(Boolean).join(' | ') + ')');
await ev(() => { const s = [...document.querySelectorAll('.scrim')].pop(); if (s) s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }); await page.waitForTimeout(300);
await ev(async () => { const P = await import('./js/project.js'); const i = P.state.tracks.findIndex((t) => t.devices.some((d) => d.missing)); P.selectTrack(i); (await import('./js/devices.js')).render(); });
await page.evaluate(() => [...document.querySelectorAll('#layer .modal .b')].find((x) => x.textContent === 'OK')?.click()); await page.waitForTimeout(500);
ok(await ev(() => [...document.querySelectorAll('.card.dv-missing h4')].some((x) => /^\[Plugin tidak tersedia\]/.test(x.textContent))), 'device chain shows "[Plugin tidak tersedia] <name>" cards');
await page.screenshot({ path: path.join(root, 'docs/redesign/54-import-flm.png') });
// the arrangement around Audio 7 (FLM duplicates of the bass clip: one cycle each, pitched)
await ev(async () => { const P = await import('./js/project.js'); const i = P.state.tracks.findIndex((t) => t.name === 'Audio 7'); if (i >= 0) { P.selectTrack(i); const c = P.state.tracks[i].clips.slice().sort((a, b) => a.start - b.start)[4]; if (c) P.selectClip(i, c.id); } P.seekTo(P.BAR * 8); });
await ev(() => { const b = document.querySelector('#dtabs .b.on'); if (b) b.click(); }); await page.waitForTimeout(800);
await page.mouse.move(400, 300); for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(120); } await page.waitForTimeout(500);
await page.screenshot({ path: path.join(root, 'docs/redesign/56-import-flm-arrangement.png') });
await ev(async () => { const P = await import('./js/project.js'); P.play(); }); await page.waitForTimeout(1500);
const pos = await ev(async () => (await import('./js/project.js')).state.pos); await ev(async () => (await import('./js/project.js')).stop());
ok(pos > 0, 'the imported project plays (position ' + Math.round(pos) + ' ticks after 1.5 s)');
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nimport-ui-test: all passed'); process.exit(bad ? 1 : 0);
