// UI audit of every effect and instrument card on the owner's phone (Oppo Find X8: 2760 x 1256 px, 6.59", 460 ppi; Chrome reports
// devicePixelRatio 3, landscape layout 920 x 419 CSS px). For each module the card is opened in the Device panel (normal height) and checked:
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
const W = +(process.env.VW || 920), H = +(process.env.VH || 419);
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, floatPlugins: false })));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted, null, { timeout: 15000 }); await page.waitForTimeout(1200);
const ev = (f, a) => page.evaluate(f, a);
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
  const r = await ev(([kind, t]) => {
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
    const sel = '.knob, .lv-btn, .lv-fld, canvas, .lk-n, .lk-lb, .lk-st, .lv-tab, button, select, .lk-lamp';
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
    return { zoom, hBody, hNeed, labPx, title, w: Math.round(cr.width), h: Math.round(cr.height), fonts: [...fonts.entries()].sort((a, b) => a[0] - b[0]), usedH: Math.round(used * 100), usedW: R.length ? Math.round((x1 - x0) / cr.width * 100) : 0, n: leaf.length, ...issues };
  }, [kind, t]);
  if (process.env.SHOTDIR) await page.screenshot({ path: path.join(process.env.SHOTDIR, `${kind}-${t}.png`) });   // whole screen (the panel as the phone shows it)
  report.push({ kind, t, ...r });
  const bad = (r.overflow || []).length + (r.overlap || []).length + (r.clipped || []).length;
  console.error(`${kind} ${t} ${r.title || ''}: ${bad ? bad + ' issues' : 'ok'}  fill ${r.usedW}%x${r.usedH}%  zoom ${r.zoom} body ${r.hBody} need ${r.hNeed}  fonts ${(r.fonts || []).map((f) => f[0]).join('/')}`);
}
fs.writeFileSync(out === '/dev/stdout' ? '/dev/stdout' : out, JSON.stringify({ viewport: [W, H], report, errs }, null, 1));
await b.close(); server.close();
