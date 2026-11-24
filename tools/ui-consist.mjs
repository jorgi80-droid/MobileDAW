import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || '/dev/stdout', which = process.argv[3] || 'all', only = process.argv[4] ? process.argv[4].split(',').map(Number) : null;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const W = +(process.env.VW || 904), H = +(process.env.VH || 411), DPR = +(process.env.DPR || 2.625);
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
if (process.env.NOTAB) await page.addInitScript(() => { globalThis.__noTabify = true; });
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, floatPlugins: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(1200);
const ev = (f, a) => page.evaluate(f, a);
if (process.env.THEME) { await ev(async (th) => { const { prefs, savePrefs } = await import('./js/prefs.js'), T = await import('./js/theme.js'); prefs.theme = th; savePrefs(); T.applyTheme(th); }, process.env.THEME); await page.waitForTimeout(500); }   // THEME=midlight|light|live ... : audit in another theme
const list = await ev(async () => { const D = await import('./js/defs.js'); return { fx: Object.keys(D.DEVICES).map(Number).filter((k) => !D.HIDDEN_FX.includes(k)), inst: [...D.INST_LIST] }; });
await ev(async () => { const P = await import('./js/project.js'); P.newProject(false); P.addTrack('midi'); P.selectTrack(P.state.tracks.length - 1); document.querySelector('#dtabs .b[data-tab="dev"]').click(); });
await page.waitForTimeout(400);
for (let k = 0; k < 3; k++) {                                   // the Device panel must be open (tapping the active tab closes it)
  const hh = await ev(() => { const d = document.querySelector('.dev-scroll'); return d ? d.getBoundingClientRect().height : 0; });
  if (hh > 60) break; await ev(() => document.querySelector('#dtabs .b[data-tab="dev"]').click()); await page.waitForTimeout(500);
}
const jobs = [...list.fx.map((t) => ['fx', t]), ...list.inst.map((t) => ['inst', t])];
const all = [];
for (const [kind, t] of jobs) {
  await ev(async ([kind, t]) => { const P = await import('./js/project.js'), i = P.state.tracks.length - 1; P.state.tracks[i].devices = []; if (kind === 'inst') P.setInstrument(i, t); else { P.setInstrument(i, 32); P.addDevice(i, t); } P.syncAll(); P.selectTrack(i); P.emit('all'); }, [kind, t]);
  await page.waitForTimeout(350);
  const r = await ev(() => {
    const cs = [...document.querySelectorAll('.dev-scroll > .card')].filter((c) => c.querySelector(':scope > h4')), card = cs[0 + 0] && (document.querySelector('.dev-scroll > .card:not(.addcard)') ? cs[cs.length - 1] : null);
    const c = cs.length > 1 ? cs[cs.length - 1] : cs[0]; if (!c) return null;
    const lk = c.querySelector('.lk, .lv-dev'); const z = parseFloat((lk && lk.style.zoom) || 1) || 1;
    const vis = (e) => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.getBoundingClientRect().width > 1; };
    const px = (v) => Math.round(parseFloat(v) * z * 10) / 10;
    const out = { name: c.querySelector('h4').textContent.trim().slice(0, 14), zoom: z, card: { radius: getComputedStyle(c).borderTopLeftRadius, border: getComputedStyle(c).borderTopWidth + ' ' + getComputedStyle(c).borderTopColor, h4: Math.round(c.querySelector('h4').getBoundingClientRect().height) } };
    const sample = (sel, f) => [...c.querySelectorAll(sel)].filter(vis).filter((e) => !e.closest('h4')).map(f);
    out.btn = sample('.lv-btn', (e) => { const s = getComputedStyle(e); return [(e.className.replace('lv-btn', '').trim().split(' ')[0] || '-') + ':' + (e.parentElement.className.split(' ')[0] || '-'), px(s.height), s.borderTopWidth, s.borderTopLeftRadius, px(s.fontSize), s.fontWeight].join('|'); });
    out.fld = sample('.lv-fld', (e) => { const s = getComputedStyle(e); return [(e.className.replace('lv-fld', '').trim().split(' ').slice(0, 2).join('.') || '-'), px(s.height), s.borderTopWidth, s.borderTopLeftRadius, px(s.fontSize)].join('|'); });
    out.knob = sample('.knob.lk-k', (e) => { const s = getComputedStyle(e.querySelector('svg')), n = getComputedStyle(e.querySelector('.k-n')); return [px(s.width), px(n.fontSize), px(getComputedStyle(e.querySelector('.k-v')).fontSize)].join('|'); });
    out.dk = sample('.lk-dk', (e) => { const s = getComputedStyle(e); return [s.borderTopLeftRadius, s.borderTopWidth, s.borderTopColor].join('|'); });
    out.disp = sample('canvas.lv-disp', (e) => getComputedStyle(e).borderTopLeftRadius);
    out.lab = sample('.lk-lb, .lk-st', (e) => px(getComputedStyle(e).fontSize) + '|' + getComputedStyle(e).fontWeight);
    out.fam = [...new Set(sample('*', (e) => getComputedStyle(e).fontFamily.split(',')[0]).slice(0, 400))];
    return out;
  });
  if (r) all.push({ kind, t, ...r });
}
fs.writeFileSync(out, JSON.stringify(all)); await b.close(); server.close();
