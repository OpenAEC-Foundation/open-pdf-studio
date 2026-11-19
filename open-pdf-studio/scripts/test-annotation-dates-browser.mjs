// #1189: webdownload met echte factory, saver, PDF.js en heropenen.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument, PDFName } from 'pdf-lib';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const cache=await mkdtemp(path.join(tmpdir(),'opds-annotation-dates-'));
const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),cacheDir:cache,logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false}});
let browser;
try {
  await server.listen();browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`,{timeout:120000});
  await page.waitForSelector('#tool-select',{timeout:120000});
  const input=await PDFDocument.create();input.addPage([300,400]);
  const dates=await page.evaluate(async bytes=>{
    const {createTab}=await import('/js/ui/chrome/tabs.js');
    const {loadPDF}=await import('/js/pdf/loader.js');
    await loadPDF('area.pdf',createTab('area.pdf').index,new Uint8Array(bytes));
    const {getActiveDocument}=await import('/js/core/state.ts');
    const doc=getActiveDocument();await doc._annotationCompletion;
    const {createAnnotation}=await import('/js/annotations/factory.js');
    const area=createAnnotation({type:'measureArea',page:1,points:[{x:40,y:40},{x:180,y:40},{x:180,y:140},{x:40,y:140}],measureText:'0.01 m²',strokeColor:'#0000ff',lineWidth:1});
    doc.annotations.push(area);doc.isModified=true;
    return {createdAt:area.createdAt,modifiedAt:area.modifiedAt};
  },[...await input.save()]);
  const expected=iso=>new Date(Math.floor(new Date(iso).getTime()/1000)*1000).toISOString();
  for(const action of ['save','save-as','reopen-save']) {
    const downloaded=page.waitForEvent('download');
    assert.equal(await page.evaluate(async action=>{
      const {savePDF,savePDFAs}=await import('/js/pdf/saver.js');
      const {getActiveDocument}=await import('/js/core/state.ts');
      return action==='save-as'?savePDFAs(getActiveDocument(),'area-copy.pdf'):savePDF();
    },action),true);
    const file=await downloaded;const outputPath=path.join(cache,'area.pdf');await file.saveAs(outputPath);
    const bytes=await readFile(outputPath);const saved=await PDFDocument.load(bytes);
    const refs=saved.getPage(0).node.Annots().asArray();assert.equal(refs.length,1);
    const dict=saved.context.lookup(refs[0]);
    for(const [key,field] of [['CreationDate','createdAt'],['M','modifiedAt']]) {
      const value=dict.get(PDFName.of(key));
      assert.match(value?.decodeText()||'',/^D:\d{14}Z$/);
      assert.equal(value.decodeDate().toISOString(),expected(dates[field]));
    }
    if(action==='save-as') await page.evaluate(async bytes=>{
      const {createTab}=await import('/js/ui/chrome/tabs.js');
      const {loadPDF}=await import('/js/pdf/loader.js');
      await loadPDF('reopened.pdf',createTab('reopened.pdf').index,new Uint8Array(bytes));
      await(await import('/js/core/state.ts')).getActiveDocument()._annotationCompletion;
    },[...bytes]);
    console.log(`PASS area annotation dates: browser ${action}`);
  }
} finally {await browser?.close();await server.close();await rm(cache,{recursive:true,force:true});}
