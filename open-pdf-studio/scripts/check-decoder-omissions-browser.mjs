import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try {
 const tab=await browser.newPage();
 await tab.route('**/__decoder_probe__',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Decoder probe</title>'}));
 await tab.goto(`${process.env.BASE_URL||'http://127.0.0.1:3042'}/__decoder_probe__`);
 const results=await tab.evaluate(async()=>{
  const pdfjs=await import('/node_modules/pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/build/pdf.worker.mjs';
  const bytes=new Uint8Array(await (await fetch('/scripts/fixtures/decoder-omissions/unsupported-xobject.pdf')).arrayBuffer());
  const results=[];
  for(const stopAtErrors of [false,true]) {
   const task=pdfjs.getDocument({data:bytes.slice(),stopAtErrors,verbosity:0});
   try {
    const doc=await task.promise;const page=await doc.getPage(1);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=100;
    const context=canvas.getContext('2d');
    await page.render({canvasContext:context,viewport:page.getViewport({scale:1})}).promise;
    results.push({stopAtErrors,status:'resolved',pixel:[...context.getImageData(10,90,1,1).data]});
   } finally {await task.destroy();}
  }
  return {version:pdfjs.version,results};
 });
 assert.equal(results.version,'6.4.299');
 assert.deepEqual(results.results[0].pixel,[0,0,0,255]);
 assert.deepEqual(results.results[1].pixel,[255,255,255,255]);
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
