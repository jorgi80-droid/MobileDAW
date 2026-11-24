// Before / after comparison image: two screenshots stacked (top = before, bottom = after) with a title strip each, saved as JPEG.
// Usage: node tools/ui-compare.mjs <out.jpg> "<title>" <before.png> <after.png> [<before2.png> <after2.png> ...]
// More pairs are placed side by side (columns), so one image can show e.g. the dark and the light theme.
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [out, title, ...imgs] = process.argv.slice(2);
if (!out || imgs.length < 2 || imgs.length % 2) { console.error('usage: ui-compare.mjs <out.jpg> <title> <before.png> <after.png> [...]'); process.exit(1); }
const src = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const cols = []; for (let k = 0; k < imgs.length; k += 2) cols.push([imgs[k], imgs[k + 1]]);
const cell = (lab, f, after) => `<div class="h${after ? ' a' : ''}">${title} - ${lab}</div><img src="${src(f)}">`;
const html = `<html><body style="margin:0;background:#151516;font:700 22px system-ui;color:#e8e8ea;display:flex;gap:8px">${cols.map(([b, a]) =>
  `<div style="display:flex;flex-direction:column;width:1180px">${cell('SEBELUM', b)}${cell('SESUDAH (gaya Ableton Live 12)', a, true)}</div>`).join('')}
<style>.h{padding:8px 12px}.h.a{color:#ffa722}img{width:1180px;display:block}</style></body></html>`;
const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1180 * cols.length + 8 * (cols.length - 1), height: 400 } });
await page.setContent(html); await page.waitForLoadState('load');
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
await page.screenshot({ path: out, type: 'jpeg', quality: 82, fullPage: true });
await browser.close(); console.log('wrote', out);
