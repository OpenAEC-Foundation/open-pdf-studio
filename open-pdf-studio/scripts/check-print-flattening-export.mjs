// Exercise the actual exporter with PDF.js; only the Tauri file-write boundary is mocked.
import {chromium} from 'playwright';
import {writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const output=process.env.OUTPUT_PDF;
assert.ok(output,'Set OUTPUT_PDF to a temporary output path');
const browser=await chromium.launch({headless:true});
let peakBrowserRssKiB=null;
const cdp=await browser.newBrowserCDPSession();
let sampling=false;
const sample=async()=>{
 if(sampling||process.platform!=='linux')return;
 sampling=true;
 try {
  const {processInfo}=await cdp.send('SystemInfo.getProcessInfo');
  const rss=await Promise.all(processInfo.map(async p=>{
   try{return Number((await readFile(`/proc/${p.id}/status`,'utf8')).match(/^VmRSS:\s+(\d+)/m)?.[1]||0);}catch{return 0;}
  }));
  peakBrowserRssKiB=Math.max(peakBrowserRssKiB||0,rss.reduce((a,b)=>a+b,0));
 }finally{sampling=false;}
};
const sampler=setInterval(()=>sample().catch(()=>{}),50);
try {
 const page=await browser.newPage();
 page.setDefaultTimeout(120000);
 await page.goto(process.env.BASE_URL||'http://127.0.0.1:3042',{waitUntil:'domcontentloaded',timeout:120000});
 const result=await page.evaluate(async()=>{
  const pdfjs=await import('/node_modules/pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/build/pdf.worker.mjs';
  const bytes=new Uint8Array(await (await fetch('/scripts/fixtures/print-flattening/corpus.pdf')).arrayBuffer());
  const task=pdfjs.getDocument({data:bytes.slice(),verbosity:0});
  const pdf=await task.promise;
  const {state,getActiveDocument}=await import('/js/core/state.ts');
  state.documents=[{id:'print-fixture',filePath:'/fixture.pdf',fileName:'fixture.pdf',currentPage:1,numPages:pdf.numPages,annotations:[],pageRotations:{},pdfDoc:pdf}];
  state.activeDocumentIndex=0;
  let written;
  window.__TAURI__={core:{invoke:async(cmd,args)=>{if(cmd==='write_file_atomic'){written=Array.from(args);return true;}return null;}}};
  const {exportAsRasterPdf}=await import('/js/pdf/exporter.js');
  const meting={};
  await exportAsRasterPdf({doc:getActiveDocument(),dpi:150,pages:Array.from({length:pdf.numPages},(_,i)=>i+1),motor:'pdfjs',outputPath:'/qualified-output.pdf',openInTab:false,meting});
  await task.destroy();
  return {written,meting};
 });
 assert.ok(result.written?.length,'Exporter did not write output');
 await writeFile(output,new Uint8Array(result.written));
 await sample();
 console.log(JSON.stringify({bytes:result.written.length,measurement:result.meting,peakBrowserRssKiB,memoryScope:"Linux Chromium process RSS sum sampled every 50ms; includes shared pages, excludes Vite and native Tauri; not a decoder limit"},null,2));
} finally {clearInterval(sampler);await browser.close();}
