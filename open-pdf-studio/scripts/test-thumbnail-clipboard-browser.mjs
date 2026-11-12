// Real Solid thumbnail events, PDF.js, pdf-lib, tab switches and undo. No Tauri mocks.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument } from 'pdf-lib';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const cache = await mkdtemp(path.join(tmpdir(), 'opds-page-clipboard-'));
const server = await createServer({ root, cacheDir: cache, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18356, strictPort: false, hmr: false } });
let browser;
async function pdf(widths) {
  const doc = await PDFDocument.create();
  for (const width of widths) doc.addPage([width, 200]);
  return [...await doc.save()];
}
try {
  await server.listen(); browser = await chromium.launch({headless:true});
  const page = await browser.newPage({ viewport: {width:1500,height:1000} });
  const errors=[]; page.on('pageerror', e=>errors.push(e.stack || e.message));
  if(process.env.OPDS_CLIPBOARD_DEBUG) page.on('console', m=>console.log(m.type(),m.text()));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`, {timeout:120000});
  await page.waitForSelector('#tool-select', {timeout:120000});
  await page.evaluate(async ([source,dest]) => {
    const {createTab,switchToTab}=await import('/js/ui/chrome/tabs.js');
    const {loadPDF}=await import('/js/pdf/loader.js');
    const a=createTab('source.pdf'); await loadPDF('source.pdf',a.index,new Uint8Array(source));
    const b=createTab('destination.pdf'); await loadPDF('destination.pdf',b.index,new Uint8Array(dest));
    window.testState=await import('/js/core/state.ts');
    window.testManager=await import('/js/pdf/page-manager.js');
    window.testTabs=[a.index,b.index]; await switchToTab(a.index);
    (await import('/js/solid/stores/leftPanelStore.js')).switchToLeftPanelTab('thumbnails');
    window.clipboardBubbles=0;
    document.addEventListener('keydown', e=>{if(e.ctrlKey&&['c','v'].includes(e.key))window.clipboardBubbles++;});
  }, [await pdf([110,120,130]), await pdf([210,220])]);
  const thumb = n => page.locator(`#thumbnails-container .thumbnail-item[data-page="${n}"]`);
  await thumb(1).click(); await thumb(3).click({modifiers:['Control']});
  await page.keyboard.press('Control+c');
  await page.waitForFunction(()=>!!window.testManager.getPageClipboard(),null,{timeout:5000});
  assert.equal(await page.evaluate(()=>window.clipboardBubbles),0,'page copy must stop before annotation copy');
  await page.evaluate(async()=> (await import('/js/ui/chrome/tabs.js')).switchToTab(window.testTabs[1]));
  await thumb(1).click();
  await page.waitForFunction(()=>window.__pdfRenderInFlight===0);
  await page.keyboard.press('Control+v');
  await page.waitForFunction(()=>window.testState.getActiveDocument()?.undoStack?.at(-1)?.type==='pageStructure');
  if(process.env.OPDS_CLIPBOARD_DEBUG) console.log(await page.evaluate(async()=>{const d=(await import('/js/core/state.ts')).getActiveDocument();return {id:d.id, pages:d.pdfDoc.numPages,getPage:String(d.pdfDoc.getPage),undo:d.undoStack.length};}));
  const widths = await page.evaluate(async()=>{
    const {getActiveDocument}=await import('/js/core/state.ts');
    const doc=getActiveDocument(); const result=[];
    for(let n=1;n<=doc.pdfDoc.numPages;n++) result.push((await doc.pdfDoc.getPage(n)).view[2]);
    return result;
  });
  assert.deepEqual(widths,[210,110,130,220]);
  assert.equal(await page.evaluate(()=>window.clipboardBubbles),0,'page paste must stop before annotation paste');
  await page.waitForFunction(()=>window.__pdfRenderInFlight===0);
  await page.evaluate(async()=> (await import('/js/core/undo-manager.js')).undo());
  await page.waitForFunction(()=>window.testState.getActiveDocument()?.pdfDoc?.numPages===2);
  // Native listener must leave the delegated label editor's Ctrl+A/C alone.
  await thumb(1).locator('.thumbnail-label').dblclick();
  const editor=page.locator('.thumbnail-label-input'); await editor.fill('Destination');
  await page.keyboard.press('Control+a');
  assert.equal(await editor.evaluate(n=>n.selectionEnd-n.selectionStart),11);
  await page.keyboard.press('Control+c'); await page.keyboard.press('Escape');
  await page.evaluate(async()=>{ (await import('/js/core/state.ts')).getActiveDocument().pdfaCompliance='PDF/A-2b'; });
  await thumb(1).click(); await page.keyboard.press('Control+v');
  assert.equal(await page.evaluate(async()=>(await import('/js/core/state.ts')).getActiveDocument().pdfDoc.numPages),2);
  await page.evaluate(async()=> (await import('/js/ui/chrome/tabs.js')).switchToTab(window.testTabs[0]));
  assert.equal(await page.evaluate(async()=>(await import('/js/core/state.ts')).getActiveDocument().pdfDoc.numPages),3);
  assert.deepEqual(errors.filter(e=>!e.startsWith('WebSocket closed without opened')),[]);
  console.log('PASS: Ctrl+C/V copies pages 1 and 3 between tabs in order; source unchanged; undo; read-only; label editing; no annotation shortcut bubbling');
} finally {
  await browser?.close(); await server.close(); await rm(cache,{recursive:true,force:true});
}
