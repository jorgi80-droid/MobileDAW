// UI audit of every effect and instrument card on the owner's phone (Oppo Find X8 at its standard resolution 2374 x 1080 px; Chrome lays a
// 6.6" FHD+ screen out at devicePixelRatio 2.625 = 904 x 411 CSS px in landscape). For each module the card is opened in the Device panel (normal height) and checked:
//   overflow  text wider than its own box (cut / ellipsis) or reaching outside the card
//   overlap   two controls (knobs, buttons, fields, displays, labels) whose boxes intersect
//   clipped   a control that sticks out of the card
//   fonts     the text sizes used (zoom included) - Live uses one small set
//   fill      share of the card body the controls really use (big empty areas = low fill)
// Usage: node tools/ui-audit.mjs [out.json] [fx|inst|all] [type,type,...]   (Playwright; not part of run-tests)
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
if (process.env.SHOT0) await page.screenshot({ path: process.env.SHOT0 });
const report = [];
const jobs = [];
if (which !== 'inst') for (const t of list.fx) if (!only || only.includes(t)) jobs.push(['fx', t]);
if (which !== 'fx') for (const t of list.inst) if (!only || only.includes(t)) jobs.push(['inst', t]);
for (const [kind, t] of jobs) {
  await ev(async ([kind, t]) => {
    const P = await import('./js/project.js'), i = P.state.tracks.length - 1;
    P.state.tracks[i].devices = [];
    if (kind === 'inst') P.setInstrument(i, t); else { P.setInstrument(i, 32); P.addDevice(i, t); }
    P.syncAll(); P.selectTrack(i); P.emit('all');
  }, [kind, t]);
  await page.waitForTimeout(450);
  const measure = ([kind, t]) => {
    const cards = [...document.querySelectorAll('.dev-scroll > .card')].filter((c) => c.querySelector(':scope > h4'));   // not the empty 'add effect' card
    const card = kind === 'inst' ? cards[0] : cards[cards.length - 1];
    if (!card) return { err: 'no card' };
    card.scrollIntoView({ inline: 'start', block: 'nearest' });
    const cr = card.getBoundingClientRect(), head = card.querySelector(':scope > h4'), hb = head ? head.getBoundingClientRect().bottom : cr.top;
    const vis = (e) => { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; const q = e.getBoundingClientRect(); return q.width > 1 && q.height > 1; };
    const inHidden = (e) => { for (let p = e; p && p !== card; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return true; } return false; };   // on-demand overlays (MiniMeters toolbar) count as hidden
    const name = (e) => (e.className && typeof e.className === 'string' ? e.className.split(' ')[0] : e.tagName.toLowerCase()) + (e.textContent ? ':' + e.textContent.trim().slice(0, 18) : '');
    const issues = { overflow: [], overlap: [], clipped: [] };
    // text leaves
    const texts = [...card.querySelectorAll('*')].filter((e) => e !== head && !head?.contains(e) && !inHidden(e) && vis(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
    const fonts = new Map();
    for (const e of texts) {
      const s = getComputedStyle(e), z = parseFloat(getComputedStyle(e.closest('.lk, .lv-dev') || card).zoom || 1) || 1, fsz = Math.round(parseFloat(s.fontSize) * z * 2) / 2;
      fonts.set(fsz, (fonts.get(fsz) || 0) + 1);
      if (e.scrollWidth > e.clientWidth + 1 && s.overflow !== 'visible' && e.clientWidth > 0) issues.overflow.push(name(e) + ' cut');
      const q = e.getBoundingClientRect(); if (q.right > cr.right + 1 || q.left < cr.left - 1 || q.bottom > cr.bottom + 1) issues.overflow.push(name(e) + ' outside card');
    }
    // controls
    const sel = '.knob, .lv-btn, .lv-fld, canvas, .lk-n, .lk-lb, .lk-st, .lk-fdh, .lv-tab, button, select, .lk-lamp';
    const ctl = [...card.querySelectorAll(sel)].filter((e) => !head?.contains(e) && !inHidden(e) && vis(e));
    const leaf = ctl.filter((e) => !ctl.some((o) => o !== e && e.contains(o)));
    const R = leaf.map((e) => e.getBoundingClientRect());
    for (let a = 0; a < leaf.length; a++) {
      const p = R[a]; if (p.right > cr.right + 1 || p.bottom > cr.bottom + 1 || p.left < cr.left - 1 || p.top < hb - 1) issues.clipped.push(name(leaf[a]));
      for (let c = a + 1; c < leaf.length; c++) { const q = R[c]; const ix = Math.min(p.right, q.right) - Math.max(p.left, q.left), iy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
        if (ix > 2 && iy > 2 && !leaf[a].contains(leaf[c]) && !leaf[c].contains(leaf[a])) issues.overlap.push(name(leaf[a]) + ' x ' + name(leaf[c])); }
    }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, area = 0; for (const q of R) { x0 = Math.min(x0, q.left); y0 = Math.min(y0, q.top); x1 = Math.max(x1, q.right); y1 = Math.max(y1, q.bottom); area += q.width * q.height; }
    const bodyH = cr.bottom - hb, used = R.length ? ((y1 - y0) / bodyH) : 0;
    const title = head ? head.textContent.trim().replace(/Mix.*$/, '').slice(0, 24) : '?';
    const lk = card.querySelector('.lk, .lv-dev'), zoom = lk ? (parseFloat(lk.style.zoom) || 1) : 1, hBody = Math.round(bodyH), hNeed = lk ? Math.round(lk.offsetHeight) : 0;
    const lab = card.querySelector('.knob .kl, .knob .klabel, .lk-k > span, .knob > span'), labPx = lab ? Math.round(lab.getBoundingClientRect().height * 10) / 10 : 0;
    const ks = [...new Set([...card.querySelectorAll('*')].filter((e) => e._k != null).map((e) => e._k))].sort((a, b) => a - b), tabs = card.querySelectorAll('.lk-autotabs .lv-tab').length;
    // symmetry: free space left / right of the controls and above / below them inside the card (a tidy panel has them (nearly) equal)
    const lkR = (card.querySelector(':scope > .lk, :scope > .lv-dev') || card).getBoundingClientRect(), mg = R.length ? { l: Math.round(x0 - cr.left), r: Math.round(cr.right - x1), t: Math.round(y0 - hb), b: Math.round(cr.bottom - y1) } : null;
    // natural size: the panel at zoom 1 without the fill stretch (what it needs at the common size)
    let nat = null; { const lk0 = card.querySelector(':scope > .lk, :scope > .lv-dev'); if (lk0) { const z0 = lk0.style.zoom, m0 = lk0.style.minHeight, f0 = lk0.classList.contains('lk-fill'); lk0.style.zoom = '1'; lk0.style.minHeight = ''; lk0.classList.remove('lk-fill'); nat = [lk0.offsetWidth, lk0.offsetHeight]; lk0.style.zoom = z0; lk0.style.minHeight = m0; if (f0) lk0.classList.add('lk-fill'); } }
    const rect = [cr.left, cr.top, cr.width, cr.height].map((v) => Math.round(v * 10) / 10), iw = innerWidth;
    return { nat, mg, rect, iw, ks, tabs, zoom, hBody, hNeed, labPx, title, w: Math.round(cr.width), h: Math.round(cr.height), fonts: [...fonts.entries()].sort((a, b) => a[0] - b[0]), usedH: Math.round(used * 100), usedW: R.length ? Math.round((x1 - x0) / cr.width * 100) : 0, n: leaf.length, ...issues };
  };
  const r = await ev(measure, [kind, t]);
  // every tab page of the panel (tabs in the title bar or in the panel) is measured too: the worst zoom and all issues count
  const nTabs = await ev(([kind]) => { const cs = [...document.querySelectorAll('.dev-scroll > .card')].filter((c) => c.querySelector(':scope > h4')), card = kind === 'inst' ? cs[0] : cs[cs.length - 1]; return card ? card.querySelectorAll(':scope > h4 > .lk-htabs .lv-tab').length : 0; }, [kind]);
  r.pages = [];
  const on0 = await ev(([kind]) => { const cs = [...document.querySelectorAll('.dev-scroll > .card')].filter((c) => c.querySelector(':scope > h4')), card = kind === 'inst' ? cs[0] : cs[cs.length - 1]; return card ? [...card.querySelectorAll(':scope > h4 > .lk-htabs .lv-tab')].findIndex((b) => b.classList.contains('on')) : 0; }, [kind]);
  for (let j = 0; j < nTabs; j++) {
    if (j === on0) continue;
    await ev(([kind, j]) => { const cs = [...document.querySelectorAll('.dev-scroll > .card')].filter((c) => c.querySelector(':scope > h4')), card = kind === 'inst' ? cs[0] : cs[cs.length - 1]; const b = card.querySelectorAll(':scope > h4 > .lk-htabs .lv-tab')[j]; b.click(); }, [kind, j]);
    await page.waitForTimeout(300);
    const q = await ev(measure, [kind, t]);
    r.pages.push({ zoom: q.zoom, need: q.hNeed, n: q.n, usedH: q.usedH, fonts: q.fonts.map((f) => f[0]) });
    for (const key of ['overflow', 'overlap', 'clipped']) r[key].push(...q[key].map((x) => 'tab' + (j + 1) + ': ' + x));
    if (process.env.SHOTDIR) await page.screenshot({ path: path.join(process.env.SHOTDIR, `${kind}-${t}-p${j + 1}.png`) });
  }
  if (nTabs > 1) await ev(([kind, j0]) => { const cs = [...document.querySelectorAll('.dev-scroll > .card')].filter((c) => c.querySelector(':scope > h4')), card = kind === 'inst' ? cs[0] : cs[cs.length - 1]; card.querySelectorAll(':scope > h4 > .lk-htabs .lv-tab')[j0]?.click(); }, [kind, Math.max(0, on0)]);
  if (process.env.SHOTDIR) await page.screenshot({ path: path.join(process.env.SHOTDIR, `${kind}-${t}.png`) });   // whole screen (the panel as the phone shows it)
  report.push({ kind, t, ...r });
  const bad = (r.overflow || []).length + (r.overlap || []).length + (r.clipped || []).length;
  if (r.mg && (Math.abs(r.mg.l - r.mg.r) > 10 || Math.abs(r.mg.t - r.mg.b) > 14)) r.asym = true;
  console.error(`${kind} ${t} ${r.title || ''}${r.asym ? ' ASYM L' + r.mg.l + ' R' + r.mg.r + ' T' + r.mg.t + ' B' + r.mg.b : ''}: ${bad ? bad + ' issues' : 'ok'}  fill ${r.usedW}%x${r.usedH}%  zoom ${r.zoom} body ${r.hBody} need ${r.hNeed}  fonts ${(r.fonts || []).map((f) => f[0]).join('/')}` + (r.pages.length ? '  tabs ' + r.pages.map((q, j) => `${j + 2}:z${q.zoom}/${q.usedH}%/${q.fonts.join('/')}`).join(' ') : ''));
}
fs.writeFileSync(out === '/dev/stdout' ? '/dev/stdout' : out, JSON.stringify({ viewport: [W, H], report, errs }, null, 1));
await b.close(); server.close();
