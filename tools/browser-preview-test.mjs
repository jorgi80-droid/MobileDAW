// Sample preview in the browser: the waveform / Tambah bar must sit under the list inside the list column (it used to become a third column and squeeze the list).
// Usage: node tools/browser-preview-test.mjs   (needs Playwright + Chromium; not part of run-tests)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(new URL(q.url,'http://x').pathname));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return}const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm'};r.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r)}).listen(0,'127.0.0.1');
await new Promise(o=>server.once('listening',o));
const b=await chromium.launch();const page=await(await b.newContext({...devices['Pixel 7 landscape']})).newPage();
await page.addInitScript(()=>localStorage.setItem('mobiledaw.prefs.v1',JSON.stringify({folderAsked:true,haptics:false,floatPlugins:false})));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);await page.waitForFunction(()=>window.__dawBooted);await page.waitForTimeout(1200);
await page.evaluate(async()=>{const {eng}=await import('./js/engine.js');
 eng.listDir=(d)=>({path:d,items:[{name:'FC - FILL J.wav',size:674000},{name:'FC - FILL K.wav',size:628000},{name:'Kick long name sample.wav',size:1000}]});
 eng.previewFile=async()=>({duration:1.6,peaks:Array.from({length:200},(_, i)=>Math.abs(Math.sin(i/5)))}); eng.stopPreview=()=>{}; eng.previewPos=()=>0.4;
 document.querySelector('#btn-browser').click();});
await page.waitForTimeout(500);
await page.evaluate(()=>document.querySelector('#browser .bs-i[data-k="file"]').click());await page.waitForTimeout(500);
await page.evaluate(()=>{const e=document.querySelector('#browser .pv[data-p]');e.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))});await page.waitForTimeout(700);
const g=await page.evaluate(()=>{const a=document.querySelector('#browser'),m=document.querySelector('#browser .bmain'),p=document.querySelector('#browser .pbar'),l=document.querySelector('#browser .blist');const r=e=>e&&e.getBoundingClientRect();return{pbarInMain:!!(p&&m.contains(p)),pbarW:p&&r(p).width,mainW:r(m).width,listW:l&&r(l).width,cols:[...a.children].length,pbarBelow:p&&l&&r(p).top>=r(l).bottom-1}});
let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
ok(g.cols===2,'the browser keeps two columns (side list + main): the preview bar is not a third column');
ok(g.pbarInMain&&Math.abs(g.pbarW-g.mainW)<2&&Math.abs(g.listW-g.mainW)<2,'the preview bar sits under the sample list inside its column; the list keeps the full width ('+Math.round(g.listW)+' px)');
ok(g.pbarBelow,'the preview bar is below the list, not over it');
await b.close();server.close();console.log(bad?'\n'+bad+' FAILED':'\nBROWSER PREVIEW: all passed');process.exit(bad?1:0);
