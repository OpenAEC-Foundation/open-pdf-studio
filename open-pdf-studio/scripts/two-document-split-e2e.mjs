import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PDFDocument, rgb } from 'pdf-lib';
const fixtures=[];
for(const [name,color,count] of [['A',[1,.8,.8],305],['B',[.7,.8,1],307],['C',[.8,1,.8],3]]) {
 const pdf=await PDFDocument.create();
 for(let i=0;i<count;i++) {const p=pdf.addPage([612,792]);p.drawRectangle({x:0,y:0,width:612,height:792,color:rgb(...color)});p.drawText(name+' '+(i+1),{x:50,y:720,size:32});}
 fixtures.push({name:name+'.pdf',bytes:[...await pdf.save()]});
}
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1800,height:1100}});page.setDefaultTimeout(20000);
 page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
 await page.goto(process.argv[2]||'http://127.0.0.1:5173',{waitUntil:'domcontentloaded',timeout:90000});
 await page.locator('[data-tab="view"]').waitFor({timeout:90000});
 await page.evaluate(async fixtures=>{
  const {state,getActiveDocument}=await import('/js/core/state.ts');
  const {default:i18n,loadLocale}=await import('/js/i18n/config.js');await loadLocale('en');state.preferences.language='en';await i18n.changeLanguage('en');
  const tabs=await import('/js/ui/chrome/tabs.js'),renderer=await import('/js/pdf/renderer.js'),split=await import('/js/pdf/split-view/split-view.js');
  for(const f of fixtures) {
   (await import('/js/core/platform.js')).cacheWebFile(f.name,new Uint8Array(f.bytes));
   const {index}=tabs.createTab(f.name);await(await import('/js/pdf/loader.js')).loadPDFIfNeeded(f.name,index);await renderer.setZoom(1);
   getActiveDocument().bookmarks=[{id:f.name,title:f.name+' bookmark',page:1}];getActiveDocument().measureScale={pixelsPerUnit:f.name==='A.pdf'?2:4,unit:'mm'};
  }
  await tabs.switchToTab(0);window.splitTest={state,getActiveDocument,tabs,renderer,split};
 },fixtures);
 await page.locator('.document-tab[data-index="1"]').click({button:'right'});
 await page.locator('.document-tab-ctxmenu').getByText('Open in Split View',{exact:true}).click();
 await page.waitForFunction(()=>window.splitTest.split.splitOverzicht()?.documentIds.length===2);
 const overview=()=>page.evaluate(()=>window.splitTest.split.splitOverzicht());
 const active=()=>page.evaluate(()=>window.splitTest.getActiveDocument().fileName);
 const ids=await page.evaluate(()=>window.splitTest.state.documents.map(d=>d.id));
 assert.deepEqual((await overview()).documentIds,ids.slice(0,2));assert.equal(await active(),'A.pdf');
 await page.waitForFunction(()=>document.querySelector('.split-pane-pdf').width>100);
 assert.equal(await page.locator('#split-name-0').textContent(),'A.pdf');assert.equal(await page.locator('#split-name-1').textContent(),'B.pdf');
 // The mirror uses B's page pixels, independent of A's page/zoom.
 await page.waitForFunction(()=>{const c=document.querySelector('.split-pane-pdf'),d=c.getContext('2d').getImageData(Math.min(100,c.width-1),100,1,1).data;return d[2]>d[0]+20;});
 await page.evaluate(async()=>{await window.splitTest.renderer.goToPage(200);await window.splitTest.renderer.setZoom(.8);});
 assert.equal((await overview()).panelen[1].page,1);
 // Click the mirror, then draw using the real editor in B.
 await page.locator('#split-pane').click({position:{x:100,y:100}});
 await page.waitForFunction(()=>window.splitTest.getActiveDocument().fileName==='B.pdf');
 await page.waitForFunction(()=>window.splitTest.split.splitOverzicht().actief===1);
 assert.equal((await overview()).panelen[0].page,200);
 const draw=async()=>{
  await page.evaluate(async()=>{await window.splitTest.renderer.setZoom(1);(await import('/js/tools/manager.js')).setTool('cloud');});
  const c=await page.locator('#annotation-canvas').boundingBox(),v=await page.locator('#pdf-container').boundingBox();
  const x=Math.max(c.x,v.x)+70,y=Math.max(c.y,v.y)+90;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+70,y+50,{steps:5});await page.mouse.up();
 };
 await draw();
 assert.deepEqual(await page.evaluate(()=>window.splitTest.state.documents.slice(0,2).map(d=>d.annotations.length)),[0,1]);
 await page.locator('.document-tab[data-index="0"]').click();await page.waitForFunction(()=>window.splitTest.getActiveDocument().fileName==='A.pdf');
 await draw();
 assert.deepEqual(await page.evaluate(()=>window.splitTest.state.documents.slice(0,2).map(d=>d.annotations.length)),[1,1]);
 await page.keyboard.press('Control+z');
 await page.waitForFunction(()=>window.splitTest.state.documents[0].annotations.length===0);
 assert.equal(await page.evaluate(()=>window.splitTest.state.documents[1].annotations.length),1);
 // Save through the real keyboard shortcut; only the active PDF becomes clean.
 await draw();
 const downloadReady=page.waitForEvent('download');
 await page.keyboard.press('Control+s');
 const download=await downloadReady;
 assert.equal(download.suggestedFilename(),'A.pdf');
 const savedA=await PDFDocument.load(await readFile(await download.path()));
 assert.equal(savedA.getPages()[199].node.Annots().size(),1);
 await page.waitForFunction(()=>!window.splitTest.state.documents[0].modified);
 assert.equal(await page.evaluate(()=>window.splitTest.state.documents[1].modified),true);
 if (process.env.OPDS_TEST_SCREENSHOT) await page.screenshot({path:process.env.OPDS_TEST_SCREENSHOT});
 // Measurement lookup follows each document, including the inactive rendering context.
 assert.deepEqual(await page.evaluate(async()=>{
   const {getMeasureScale}=await import('/js/annotations/measurement.js');
   const {metPaneelStand}=await import('/js/pdf/split-view/paneel-weergave.js');
   const a=getMeasureScale(200,100,100).pixelsPerUnit;
   const b=metPaneelStand(window.splitTest.state.documents[1],{schaal:1,rotatie:0},()=>getMeasureScale(1,100,100).pixelsPerUnit);
   return [a,b,window.splitTest.getActiveDocument().fileName];
 }),[2,4,'A.pdf']);
 // Cancel closing B leaves both panes and its unsaved annotation in place.
 assert.equal(await page.evaluate(()=>window.splitTest.tabs.closeTab(1,false,'cancel')),false);
 assert.deepEqual((await overview()).documentIds,ids.slice(0,2));
 await page.evaluate(()=>window.splitTest.split.zetSplitSync(true));
 const before=(await overview()).panelen[1].scale;
 await page.evaluate(()=>window.splitTest.renderer.setZoom(2));
 await page.waitForFunction(before=>window.splitTest.split.splitOverzicht().panelen[1].scale>before,before);
 assert.equal((await overview()).panelen[1].page,1);
 const oldScroll=await page.evaluate(()=>window.splitTest.split.splitStaatVan().stand.scrollTop);
 await page.evaluate(()=>{document.querySelector('#pdf-container').scrollTop+=80;});
 await page.waitForFunction(old=>window.splitTest.split.splitStaatVan().stand.scrollTop>old,oldScroll);
 await page.evaluate(()=>window.splitTest.renderer.goToPage(201));
 assert.equal((await overview()).panelen[1].page,1);
 await page.evaluate(()=>window.splitTest.split.zetSplitSync(false));
 // Third tab replaces only the active pane; B stays in the other pane.
 await page.locator('.document-tab[data-index="2"]').click();await page.waitForFunction(()=>window.splitTest.getActiveDocument().fileName==='C.pdf');
 assert.deepEqual((await overview()).documentIds,[ids[2],ids[1]]);
 await page.evaluate(()=>window.splitTest.split.hefSplitsingOp());assert.equal(await overview(),null);assert.equal(await active(),'C.pdf');
 // Same-document splitting still restores independently when changing tabs.
 await page.evaluate(()=>window.splitTest.split.splitsWeergave('horizontal'));
 assert.deepEqual((await overview()).documentIds,[ids[2],ids[2]]);
 await page.locator('.document-tab[data-index="0"]').click();await page.waitForFunction(()=>window.splitTest.getActiveDocument().fileName==='A.pdf');assert.equal(await overview(),null);
 await page.locator('.document-tab[data-index="2"]').click();await page.waitForFunction(()=>window.splitTest.getActiveDocument().fileName==='C.pdf');assert.equal((await overview()).richting,'horizontal');
 await page.evaluate(()=>window.splitTest.split.openDocumentInSplit(1));
 await page.locator('#split-pane').dispatchEvent('wheel',{deltaY:-100,ctrlKey:true,clientX:100,clientY:100});
 const survivorZoom=(await overview()).panelen[1].scale;
 await page.evaluate(()=>window.splitTest.tabs.closeTab(2,true));
 assert.equal(await page.evaluate(()=>window.splitTest.getActiveDocument().scale),survivorZoom);
 assert.equal(await active(),'B.pdf');assert.equal(await overview(),null);
 // Closing an unsaved background pane with Save waits for activation, saves B and returns A.
 await page.evaluate(async()=>{await window.splitTest.tabs.switchToTab(0);await window.splitTest.split.openDocumentInSplit(1);});
 const saveClose=page.waitForEvent('download');
 assert.equal(await page.evaluate(()=>window.splitTest.tabs.closeTab(1,false,'save')),true);
 const savedDownload=await saveClose;
 assert.equal(savedDownload.suggestedFilename(),'B.pdf');
 const savedB=await PDFDocument.load(await readFile(await savedDownload.path()));
 assert.equal(savedB.getPages()[0].node.Annots().size(),1);
 assert.equal(await active(),'A.pdf');assert.equal(await overview(),null);
 console.log('PASS: 305/307-page PDFs; independent pixels/pages/clouds/undo/save/measurement; sync zoom/scroll; third tab; same-PDF split; cancel/save/close with survivor view preserved');

} finally {await browser.close();}
