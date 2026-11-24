// Harmor plug-in window (js/harmor/view.js) in the app, on a phone (Playwright Pixel 7, landscape and portrait, the WebAssembly engine):
// the window opens, every section (5 sound pages + 5 editors, one tab row) renders and FITS the window: nothing spills sideways and
// nothing is cut off at the bottom (no scrolling needed, landscape and portrait), a knob drag and
// a double tap change the parameter, the live displays (meter, partials) draw what the engine plays (devOut 998), a tap in the
// articulator editor adds a point and a drag moves it (parameters), the harmonic editor's drawing and presets write the timbre table and
// change the SOUND (measured), the table survives save / open, and the effects rack reorders (FX order parameters).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium, devices } = createRequire(import.meta.url)('playwright');
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
await new Promise((o) => server.once('listening', o));
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

async function open(dev) {
  const page = await (await b.newContext(typeof dev === 'string' ? { ...devices[dev] } : dev)).newPage(), errs = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.addInitScript(() => localStorage.setItem('mobiledaw.prefs.v1', JSON.stringify({ folderAsked: true, haptics: false, tutorialOffered: true, fullscreen: false })));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.__dawBooted); await page.waitForTimeout(800);
  await page.evaluate(async () => { const P = await import('./js/project.js'), D = await import('./js/devices.js'), { eng } = await import('./js/engine.js'); await eng.start();
    P.newProject(false); P.addTrack('midi'); P.setInstrument(0, 38); P.selectTrack(0); D.openInstWindow(P.state.tracks[0].id); });
  await page.waitForSelector('.fw .hm'); await page.waitForTimeout(500);
  return { page, errs };
}
const param = (page, j) => page.evaluate(async (j) => { const P = await import('./js/project.js'), { INSTRUMENTS } = await import('./js/defs.js'), v = P.state.tracks[0].inst.params[j]; return v ?? INSTRUMENTS[38].params[j].def; }, j);   // params are sparse: unset = the default
const S = await (async () => { const m = await import(path.join(root, 'js/harmor/schema.js')); return m; })();
const { HM } = S, E = (e, s) => HM.ENV + HM.ENV_STRIDE * e + s;

// ------------------------------------------------------------------ layout: every page and editor tab, landscape and portrait
for (const dev of ['Pixel 7 landscape', 'Pixel 7']) {
  const { page, errs } = await open(dev);
  const rep = [];
  for (let q = 0; q < 10; q++) {
    await page.evaluate((q) => document.querySelectorAll('.fw .hm-pt')[q].click(), q); await page.waitForTimeout(250);
    rep.push(await page.evaluate((q) => {
      const hm = document.querySelector('.fw .hm'), R = hm.getBoundingClientRect(), fw = hm.closest('.fw').getBoundingClientRect(), m = hm.querySelector(q < 5 ? '.hm-main.up' : '.hm-main.ed');   // two zones: modules (pages 0-4), editor (5-9)
      const spill = [...hm.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > R.right + 1 || r.left < R.left - 1); }).length;
      const disp = q < 5 ? [] : [...m.querySelectorAll('.hm-disp')].filter((d) => d.offsetParent).map((d) => d.getBoundingClientRect().height);   // the editor's displays (the module zone keeps thin strips)
      return { tab: document.querySelectorAll('.fw .hm-pt')[q].textContent, on: document.querySelectorAll('.fw .hm-pt')[q].classList.contains('on'), body: m.children.length, spill,
        inWin: R.width <= fw.width + 1 && R.bottom <= fw.bottom + 1 && fw.bottom <= innerHeight + 1, fits: q === 8 || m.scrollHeight <= m.clientHeight + 1, h: Math.round(m.clientHeight), minDisp: disp.length ? Math.round(Math.min(...disp)) : null };
    }, q));
  }
  ok(rep.every((r) => r.on && r.body > 0), `${dev}: all 10 sections render (${rep.map((r) => r.tab).join(' ')})`);
  ok(rep.every((r) => !r.spill && r.inWin), `${dev}: nothing spills sideways, the plug-in and its window stay inside the screen`);
  ok(rep.every((r) => r.fits), `${dev}: every section fits the window, nothing cut off at the bottom (${rep[0].h} px; ${rep.filter((r) => !r.fits).map((r) => r.tab).join(' ') || 'no scrolling'})`);
  ok(rep.every((r) => r.minDisp == null || r.minDisp >= 40), `${dev}: the displays keep a usable height (smallest ${Math.min(...rep.filter((r) => r.minDisp != null).map((r) => r.minDisp))} px)`);
  ok(!errs.length, `${dev}: no page errors ${errs.slice(0, 2).join(' | ')}`);
  await page.context().close();
}

// ------------------------------------------------------------------ interaction: the phone's landscape layout size (1280 x 534 CSS px). Not the
// emulated phone itself: there Playwright divides every pointer position after the first by the page scale of the app's viewport meta.
const { page, errs } = await open({ viewport: { width: 1280, height: 534 } });
const center = (sel, q = 0) => page.evaluate(([s, q]) => { const e = document.querySelectorAll('.fw ' + s)[q], r = e.getBoundingClientRect(), k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k')) || 1;   // the app zooms its root by --k: mouse = layout x k
  return [(r.left + r.width / 2) * k, (r.top + r.height / 2) * k, r.width * k, r.height * k]; }, [sel, q]);
const drag = async (x, y, dx, dy, steps = 8) => { await page.mouse.move(x, y); await page.mouse.down(); for (let s = 1; s <= steps; s++) await page.mouse.move(x + dx * s / steps, y + dy * s / steps); await page.mouse.up(); };

// knob: drag up raises Volume, double tap restores the default
const v0 = await param(page, HM.VOL); let [kx, ky] = await center('.hm-top .hm-kn');
await drag(kx, ky, 0, -50); const v1 = await param(page, HM.VOL), shown = await page.evaluate(() => document.querySelector('.fw .hm-top .hm-kv').textContent);
await page.waitForTimeout(400); await page.mouse.click(kx, ky); await page.waitForTimeout(80); await page.mouse.click(kx, ky); const v2 = await param(page, HM.VOL);
ok(v1 > v0 + 0.1 && shown === Math.round(v1 * 100) + ' %', `knob drag up: Volume ${v0.toFixed(2)} -> ${v1.toFixed(2)}, the knob shows "${shown}"`);
ok(Math.abs(v2 - v0) < 1e-6, `knob double tap: back to the default ${v2.toFixed(2)}`);

// live displays: play a chord, the meter and the output spectrum (right column) draw what the engine plays
await page.evaluate(() => document.querySelectorAll('.fw .hm-pt')[0].click());
await page.evaluate(async () => { const { eng } = await import('./js/engine.js'); eng.preview(0, 57, 1, true); eng.preview(0, 64, 1, true); });
await page.waitForTimeout(700);
const live = await page.evaluate(async () => {
  const { eng } = await import('./js/engine.js'), o = eng.devOut(0, 998);
  const lit = (sel, f) => { const c = document.querySelector('.fw ' + sel + ' canvas') || document.querySelector('.fw ' + sel + '> canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2])) n++; return n / (c.width * c.height); };
  return { n: o.length, pk: o[0], voices: o[2], f0: o[3], K: o[4], parts: lit('.hm-spec', (r, g, b) => r > 120 && b > 90), meter: lit('.hm-meter', (r, g, b) => r > 70 || g > 70) };
});
ok(live.voices === 2 && Math.abs(live.f0 - 329.63) < 1 && live.K > 8 && live.pk > 0.05, `devOut 998 while a chord plays: ${live.voices} voices, newest f0 ${live.f0.toFixed(1)} Hz, ${live.K} partials, peak ${live.pk.toFixed(2)}`);
ok(live.parts > 0.02 && live.meter > 0.2, `the output spectrum and the meter draw it (${(live.parts * 100).toFixed(1)} % / ${(live.meter * 100).toFixed(0)} % of their pixels lit)`);
await page.evaluate(async () => { const { eng } = await import('./js/engine.js'); eng.preview(0, 57, 0, false); eng.preview(0, 64, 0, false); });

// articulator editor (ENV, Volume): a tap between points adds one, a drag moves it up
await page.evaluate(() => { document.querySelectorAll('.fw .hm-pt')[5].click(); }); await page.waitForTimeout(200);
const n0 = await param(page, E(0, 2)); let [ex, ey, ew, eh] = await center('.hm-env');
const tx = ex - ew * 0.2, ty = ey + eh * 0.1;
await page.mouse.click(tx, ty); await page.waitForTimeout(150);
const n1 = await param(page, E(0, 2)), lv = async () => { const n = await param(page, E(0, 2)), out = []; for (let j = 0; j < n; j++) out.push(await param(page, E(0, 11 + 3 * j))); return out; };
const before = await lv(); await page.waitForTimeout(400);
await drag(tx, ty, 0, -40); const after = await lv();
const moved = after.findIndex((v, j) => Math.abs(v - before[j]) > 0.05);
ok(n0 < 2 && n1 === 6, `MSEG: a tap on the AHDSR curve turns it into points and adds one (point count ${n0} -> ${n1})`);
ok(moved > 0 && after[moved] > before[moved], `MSEG: dragging the new point up raises its level (point ${moved}: ${before[moved]?.toFixed(2)} -> ${after[moved]?.toFixed(2)})`);
await page.waitForTimeout(400); [ex, ey] = [tx, ty - 40]; await page.mouse.click(ex, ey); await page.waitForTimeout(80); await page.mouse.click(ex, ey); await page.waitForTimeout(150);
ok(await param(page, E(0, 2)) === 5, `MSEG: a double tap on the point deletes it (${await param(page, E(0, 2))} points)`);
await page.evaluate(() => [...document.querySelectorAll('.hm-btn')].find((x) => x.textContent === 'AHDSR').click());

// harmonic editor: draw, then a preset; the sound changes (measured) and survives save / open
const render = () => page.evaluate(async () => {
  const P = await import('./js/project.js'), { eng } = await import('./js/engine.js'), sr = eng.info().sampleRate;
  if (!P.state.tracks[0].clips.length) { const c = P.addClip(0, 0, 3840); c.notes = [{ t: 0, d: 1900, p: 57, v: 1 }]; P.touchClips(0); }
  const r = await eng.renderTrack(0, 1), a = Math.round(sr * 0.3), n = 8192;
  const bin = (f) => { let re = 0, im = 0, ws = 0; for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)), ph = 2 * Math.PI * f * i / sr; re += r.l[a + i] * w * Math.cos(ph); im -= r.l[a + i] * w * Math.sin(ph); ws += w; } return 2 * Math.hypot(re, im) / ws; };
  return [1, 2, 3, 4, 5].map((k) => bin(220 * k));
});
const db = (x, y) => 20 * Math.log10(x / y);
const saw = await render();
await page.evaluate(() => document.querySelectorAll('.fw .hm-pt')[6].click()); await page.waitForTimeout(200);
let [hx, hy, hw, hh] = await center('.hm-harm');
await drag(hx - hw / 2 + 8, hy + hh / 2 - 20, hw - 16, 0, 20); await page.waitForTimeout(400);    // a stroke along the bottom: every visible partial low
const drawn = await page.evaluate(async () => { const P = await import('./js/project.js'), t = P.state.tracks[0].inst; return { wave: t.params[(await import('./js/harmor/schema.js')).HM.T], lv: t.hmT && t.hmT[0] ? Array.from(t.hmT[0].lv.slice(0, 64)) : null }; });
ok(drawn.wave === 4 && drawn.lv && Math.max(...drawn.lv) < 0.2, `harmonic drawing: timbre A becomes a drawn table, the stroke set partials 1-64 to ≤ ${drawn.lv ? Math.max(...drawn.lv).toFixed(2) : '?'}`);
const low = await render();
ok(db(low[0], saw[0]) < -14, `…and the sound follows: partial 1 ${db(low[0], saw[0]).toFixed(1)} dB against the saw`);
await page.evaluate(() => [...document.querySelectorAll('.hm-btn')].find((x) => x.textContent === 'Ganjil').click()); await page.waitForTimeout(400);
const odd = await render();
ok(db(saw[1], saw[0]) > -8 && db(odd[1], odd[0]) < -40 && Math.abs(db(odd[2], odd[0]) - db(1 / 3, 1)) < 1.5, `preset "Ganjil": partial 2 ${db(saw[1], saw[0]).toFixed(1)} -> ${db(odd[1], odd[0]).toFixed(1)} dB, partial 3 ${db(odd[2], odd[0]).toFixed(1)} dB (1/3 = -9.5)`);
await page.evaluate(async () => { const P = await import('./js/project.js'); await P.deserialize(P.serialize()); });
await page.waitForTimeout(300);
const re = await render();
ok(re.every((x, q) => Math.abs(db(x + 1e-9, odd[q] + 1e-9)) < 0.5), `save / open: the drawn table comes back and renders the same (${re.map((x, q) => db(x + 1e-9, odd[q] + 1e-9).toFixed(2)).join(' ')} dB)`);

// effects rack: only the effects in use are shown; + Tambah FX adds one (menu), ▼ moves it down (FX order parameters), × removes it
await page.evaluate(async () => { const P = await import('./js/project.js'), D = await import('./js/devices.js'); D.openInstWindow(P.state.tracks[0].id); });
await page.waitForSelector('.fw .hm'); await page.evaluate(() => document.querySelectorAll('.fw .hm-pt')[8].click()); await page.waitForTimeout(200);
const names = () => page.evaluate(() => [...document.querySelectorAll('.fw .hm .hm-fxh b')].map((x) => x.textContent));
const fx0 = (await names()).length;
const addFx = async (label) => { await page.evaluate(() => document.querySelector('.fw .hm .hm-fxadd').click()); await page.waitForTimeout(500);   // a menu ignores taps for its first moments (ghost clicks)
  await page.evaluate((l) => [...document.querySelectorAll('.menu .mi')].find((x) => x.textContent.trim() === l).click(), label); await page.waitForTimeout(150); };
await addFx('Delay'); await addFx('Reverb');
const o0 = await names();
ok(fx0 === 0 && o0.join() === 'Delay,Reverb', `FX: none shown by default (${fx0}), + Tambah FX adds them in order: ${o0.join(', ')}`);
ok(await page.evaluate(() => document.querySelectorAll('.fw .hm .hm-fx')[0].querySelectorAll('.hm-fxb .hm-k').length) > 1, 'FX: an added effect shows its knobs (Mix + its parameters)');
await page.evaluate(() => [...document.querySelectorAll('.fw .hm .hm-fx')[0].querySelectorAll('.hm-btn')].find((x) => x.textContent === '▼').click()); await page.waitForTimeout(150);
const o1 = await names();
ok(o1.join() === 'Reverb,Delay', `FX reorder: ${o0.join(', ')} -> ${o1.join(', ')}`);
await page.evaluate(() => document.querySelectorAll('.fw .hm .hm-fx')[0].querySelector('.hm-fxx').click()); await page.waitForTimeout(150);
const o2 = await names(), rvOn = await param(page, HM.FX + HM.FX_STRIDE * 4);
ok(o2.join() === 'Delay' && rvOn === 0, `FX remove: × turns the effect off and hides it (${o2.join(', ')}, Reverb on = ${rvOn})`);
ok(!errs.length, `interaction: no page errors ${errs.slice(0, 2).join(' | ')}`);

await b.close(); server.close();
console.log(bad ? `\n${bad} FAILED` : '\nall harmor UI checks passed');
process.exit(bad ? 1 : 0);
