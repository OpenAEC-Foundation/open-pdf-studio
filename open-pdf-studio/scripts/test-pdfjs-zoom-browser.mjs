// Actual PDF.js canvas ownership during overlapping zoom renders (#1183).
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument, rgb } from 'pdf-lib';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const cache=await mkdtemp(path.join(tmpdir(),'opds-pdfjs-zoom-'));
const server=await createServer({root,cacheDir:cache,logLevel:'error',server:{host:'127.0.0.1',port:18584,strictPort:false,hmr:false}});
let browser;
try {
 await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1400,height:1000},deviceScaleFactor:2});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/same canvas|PDF.js-render.*mislukt/.test(m.text()))errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{timeout:120000});await page.waitForSelector('#tool-select',{timeout:120000});
 const pdf=await PDFDocument.create();pdf.addPage([200,160]).drawRectangle({x:30,y:30,width:100,height:90,color:rgb(0,0,0)});
 await page.evaluate(async bytes=>{
  const {state,getActiveDocument}=await import('/js/core/state.ts');const {createTab}=await import('/js/ui/chrome/tabs.js');const {loadPDF}=await import('/js/pdf/loader.js');const renderer=await import('/js/pdf/renderer.js');
  const tab=createTab('/zoom-race.pdf');await loadPDF('/zoom-race.pdf',tab.index,new Uint8Array(bytes));await getActiveDocument()._annotationCompletion;window.zoomTest={state,getActiveDocument,renderer};
 },Array.from(await pdf.save()));
 for(const mode of ['single','continuous']) {
  await page.evaluate(async mode=>{await zoomTest.renderer.setViewMode(mode);await zoomTest.renderer.setZoom(1);},mode);
  await page.waitForTimeout(700);
  const result=await page.evaluate(async mode=>{
   const t=zoomTest,doc=t.getActiveDocument(),pdfPage=await doc.pdfDoc.getPage(1);
   const original=pdfPage.render.bind(pdfPage);let heldResolve,release,held=false,cancelled=0;
   const ready=new Promise(r=>heldResolve=r);const gate=new Promise(r=>release=r);
   pdfPage.render=options=>{
    const task=original(options);
    if(!held){held=true;const cancel=task.cancel.bind(task);task.cancel=(...args)=>{cancelled++;return cancel(...args)};task.onContinue=resume=>{heldResolve();gate.then(resume);};}
    return task;
   };
   try {
    const first=t.renderer.setZoom(2);
    await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('render did not start')),10000))]);
    const second=t.renderer.setZoom(3);
    // A third wheel notch supersedes the intermediate target while painting is paused.
    const last=t.renderer.setZoom(3.25);
    await new Promise(r=>setTimeout(r,500));release();await Promise.all([first,second,last]);
    return {cancelled};
   } finally {release();pdfPage.render=original;}
  },mode);
  await page.waitForTimeout(900);
  assert.ok(result.cancelled>0,`${mode}: superseded PDF.js task was cancelled`);
  const canvas=mode==='single'?'#pdf-canvas':'.canvas-container-cont .pdf-canvas';
  const ink=await page.locator(canvas).evaluate(c=>{const ctx=c.getContext('2d');const data=ctx.getImageData(0,0,c.width,c.height).data;let dark=0;for(let i=0;i<data.length;i+=4)if(data[i]<100&&data[i+3]===255)dark++;return{dark,width:c.width,height:c.height};});
  assert.ok(ink.dark>10000,`${mode}: current canvas contains PDF ink ${JSON.stringify(ink)}`);
  console.log(`PASS ${mode}: overlapping zoom above 200%, cancellation and visible ink`,ink);
 }
 assert.deepEqual(errors,[]);
}finally {await browser?.close();await server.close();await rm(cache,{recursive:true,force:true});}
