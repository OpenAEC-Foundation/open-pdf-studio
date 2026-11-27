// Real viewer controls, PDF.js, pdf-lib snapshot save/reopen and tab isolation.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PNG } from 'pngjs';
import { PDFDocument, rgb } from 'pdf-lib';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-content-view-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18395, strictPort: false, hmr: false } });
let browser;
try {
 await server.listen(); browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1400,height:1000}});
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{timeout:120000});
 await page.waitForSelector('#tool-select',{timeout:120000});console.log('App ready');
 const source=await PDFDocument.create();
 for(let i=0;i<2;i++)source.addPage([300,300]).drawRectangle({x:20,y:160,width:70,height:70,color:rgb(0,1,0)});
 await page.evaluate(async bytes=>{
  window.testState=await import('/js/core/state.ts');
  const {index}=(await import('/js/ui/chrome/tabs.js')).createTab('/content.pdf');
  await (await import('/js/pdf/loader.js')).loadPDF('/content.pdf',index,new Uint8Array(bytes));
  const doc=window.testState.getActiveDocument();await doc._annotationCompletion;await doc._contentViewCompletion;
  doc.annotations.push({id:'red-mark',type:'box',page:1,x:160,y:70,width:60,height:60,color:'#ff0000',fillColor:'#ff0000',opacity:1,strokeWidth:2});
  (await import('/js/annotations/rendering.js')).redrawAnnotations();
 },[...await source.save()]);
 console.log('Fixture ready');await page.locator('[data-tab=\"view\"]').click();await page.locator('#ribbon-element-visibility').click();console.log('Panel open');
 await page.waitForFunction(()=>window.__pdfRenderInFlight===0);
 const shot=async()=>{
  const png=PNG.sync.read(await page.locator('#canvas-container').screenshot());let red=0,green=0;
  for(let i=0;i<png.data.length;i+=4){const [r,g,b]=png.data.subarray(i,i+3);if(r>200&&g<50&&b<50)red++;if(g>150&&r<50&&b<50)green++;}
  return {red,green};
 };
 console.log('Taking baseline');const before=await shot();assert.ok(before.green>100);assert.ok(before.red>100);
 await page.locator('#pdf-content-enabled').check();
 const filtered=await shot();assert.equal(filtered.green,0);assert.equal(filtered.red,before.red);
 if(process.env.OPDS_CONTENT_SCREENSHOT) await page.screenshot({path:process.env.OPDS_CONTENT_SCREENSHOT});
 async function slider(key,value){await page.locator('#pdf-content-'+key).evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},value);}
 await slider('brightness',75);await slider('opacity',40);
 assert.equal(await page.evaluate(()=>window.testState.getActiveDocument().modified),true);
 console.log('Saving');const report=await page.evaluate(async()=>{
  const doc=window.testState.getActiveDocument();
  const saved=[...await (await import('/js/pdf/saver.js')).bouwMomentopname(doc)];
  const {index}=(await import('/js/ui/chrome/tabs.js')).createTab('/reopened.pdf');
  await (await import('/js/pdf/loader.js')).loadPDF('/reopened.pdf',index,new Uint8Array(saved));
  const next=window.testState.getActiveDocument();await next._annotationCompletion;await next._contentViewCompletion;
  return next.pdfContentView ? JSON.parse(JSON.stringify(next.pdfContentView)) : null;
 });
 assert.deepEqual(report,{enabled:true,grayscale:100,brightness:75,opacity:40});
 assert.equal(await page.locator('#pdf-content-brightness').inputValue(),'75');
 await page.evaluate(async()=>(await import('/js/pdf/renderer.js')).setViewMode('continuous'));
 await page.waitForSelector('.pdf-canvas');
 assert.match(await page.locator('.pdf-canvas').first().evaluate(el=>getComputedStyle(el).filter),/grayscale\(1\)/);
 const annotationFilter=await page.locator('.annotation-canvas').first().evaluate(el=>getComputedStyle(el).filter);
 assert.equal(annotationFilter,'none');
 await page.locator('#pdf-content-enabled').uncheck();
 assert.equal(await page.locator('.pdf-canvas').first().evaluate(el=>getComputedStyle(el).filter),'none');
 assert.equal(await page.locator('#pdf-content-brightness').inputValue(),'75');
 // A fresh document gets defaults; switching back restores its own settings.
 await page.evaluate(async bytes=>{
  const {index}=(await import('/js/ui/chrome/tabs.js')).createTab('/fresh.pdf');
  await (await import('/js/pdf/loader.js')).loadPDF('/fresh.pdf',index,new Uint8Array(bytes));
  await window.testState.getActiveDocument()._contentViewCompletion;
 },[...await source.save()]);
 assert.equal(await page.locator('#pdf-content-enabled').isChecked(),false);
 assert.equal(await page.locator('#pdf-content-brightness').inputValue(),'100');
 await page.evaluate(async()=>{await (await import('/js/ui/chrome/tabs.js')).switchToTab(1);});
 assert.equal(await page.locator('#pdf-content-brightness').inputValue(),'75');
 assert.deepEqual(errors.filter(e=>!e.startsWith('WebSocket closed without opened')),[]);
 console.log('PASS: content pixels grayscale while red annotation pixels unchanged; real controls; brightness/opacity; document modified; save/reopen; continuous filter scope; master bypass retains settings; tab isolation.');
} finally {await browser?.close();await server.close();await rm(cache,{recursive:true,force:true});}
