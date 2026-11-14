// The actual Print dialog and runPrintJob; native calls are captured, never spooled.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument } from 'pdf-lib';
const root=fileURLToPath(new URL('../',import.meta.url));
const cache=await mkdtemp(path.join(tmpdir(),'opds-duplex-'));
const server=await createServer({root,cacheDir:cache,logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false}});
let browser;
try {
  await server.listen();browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1500,height:1100}});
  page.setDefaultTimeout(10000);
  page.on('pageerror',e=>console.log('PAGEERROR',e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, { timeout: 120000 });
  await page.waitForSelector('#tool-select',{timeout:120000});
  await page.evaluate(async()=>{
    const {createBlankPDF}=await import('/js/pdf/loader.js');await createBlankPDF(100,100,3);
    window.jobs=[];window.tempDocs=[];
    window.__TAURI__={core:{invoke:async(name,args)=>{
      if(name==='get_printers')return JSON.stringify([{Name:'Test Printer',Default:true}]);
      if(name==='write_temp_pdf'){window.tempDocs.push(args instanceof Uint8Array?Array.from(args):args.data);return '/tmp/duplex-test.pdf';}
      if(name==='print_pdf'){window.jobs.push(args);return true;}
      if(name==='get_printer_paper'||name==='get_printer_margins')return null;
      return null;
    }}};
    const {loadPrinters}=await import('/js/solid/stores/printerStore.js');await loadPrinters(true);
    const {showPrintDialog}=await import('/js/ui/chrome/dialogs.js');showPrintDialog();
  });
  const select=page.locator('#print-duplex');await select.waitFor();assert.equal(await select.inputValue(),'printer');
  for(const choice of ['long-edge','short-edge','simplex','printer']) {
    await select.selectOption(choice);
    const before=await page.evaluate(()=>window.jobs.length);
    await page.locator('.print-dialog .print-footer-right button').filter({hasText:/^Print$|^Afdrukken$/}).click();
    await page.waitForFunction(n=>window.jobs.length>n,before,{timeout:60000});
    const sent=await page.evaluate(()=>({job:window.jobs.at(-1),settings:window.__duplexSettings}));
    if(choice==='printer')assert.equal(sent.job.duplex,undefined);else assert.equal(sent.job.duplex,choice);
    await page.evaluate(async()=>{const {showPrintDialog}=await import('/js/ui/chrome/dialogs.js');showPrintDialog();});
    await select.waitFor();assert.equal(await select.inputValue(),choice,'last duplex choice is restored');
  }
  const docs=await page.evaluate(()=>window.tempDocs);
  const pages=await Promise.all(docs.map(async b=>(await PDFDocument.load(new Uint8Array(b))).getPageCount()));
  assert.deepEqual(pages,[3,3,3,3],'three pages remain in one job, including the odd final page');
  // The built-in Save as PDF target has no duplex setting.
  await page.evaluate(async()=>{
    const {closeDialog,openDialog}=await import('/js/solid/stores/dialogStore.js');
    const {state}=await import('/js/core/state.ts');
    const {DOEL_PDF}=await import('/js/pdf/print-doel.js');
    closeDialog('print');state.preferences.printSettings={printer:DOEL_PDF,duplex:'long-edge'};
    openDialog('print',{currentPage:1});
  });
  await select.waitFor();assert.equal(await select.isDisabled(),true);
  console.log('PASS: four duplex choices, native job arguments, persisted selection, odd page count, PDF target disabled; no jobs sent to OS');
} finally {if(browser)await browser.close();await server.close();await rm(cache,{recursive:true,force:true});}
