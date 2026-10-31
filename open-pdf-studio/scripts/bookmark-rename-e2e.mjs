import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
const pdf = await PDFDocument.create();
for (let i=0;i<3;i++) pdf.addPage([612,792]);
const bytes=[...await pdf.save()];
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  page.setDefaultTimeout(15000);
  await page.goto(process.argv[2] || 'http://127.0.0.1:3078',{waitUntil:'domcontentloaded',timeout:90000});
  await page.locator('[data-tab="view"]').waitFor({timeout:90000});
  await page.evaluate(async bytes=>{
    const {cacheWebFile}=await import('/js/core/platform.js');
    const {createTab}=await import('/js/ui/chrome/tabs.js');
    const {loadPDFIfNeeded}=await import('/js/pdf/loader.js');
    cacheWebFile('rename.pdf',new Uint8Array(bytes));const {index}=createTab('rename.pdf');await loadPDFIfNeeded('rename.pdf',index);
    const {getActiveDocument}=await import('/js/core/state.ts');
    const bm=await import('/js/ui/panels/bookmarks.js');const doc=getActiveDocument();
    doc.bookmarks=[{id:'a',title:'First',page:2,parentId:null,sortOrder:0,bold:true,color:'#123456'},
      {id:'b',title:'Second',page:1,parentId:null,sortOrder:1}, {id:'c',title:'Third',page:3,parentId:null,sortOrder:2}];
    bm.updateBookmarksList();window.renameTest={doc,bm,getActiveDocument};
    (await import('/js/solid/stores/leftPanelStore.js')).switchToLeftPanelTab('bookmarks');
  },bytes);
  const row=id=>page.locator(`[data-bm-id="${id}"]`);
  const title=id=>row(id).locator('.bookmark-title');
  const input=page.locator('.bookmark-title-input');
  const model=()=>page.evaluate(()=>JSON.parse(JSON.stringify(window.renameTest.doc.bookmarks)));
  const waitTitle=async(id,value)=>page.waitForFunction(({id,value})=>window.renameTest.doc.bookmarks.find(b=>b.id===id)?.title===value,{id,value});
  await title('a').dblclick();await input.waitFor();
  await page.waitForFunction(()=>window.renameTest.doc.currentPage===2);
  assert.equal(await input.inputValue(),'First');
  assert.deepEqual(await input.evaluate(el=>[el.selectionStart,el.selectionEnd]),[0,5]);
  await input.fill('Renamed');await input.press('Enter');await waitTitle('a','Renamed');
  assert.equal((await model())[0].bold,true);assert.equal((await model())[0].color,'#123456');
  await page.keyboard.press('Control+z');await waitTitle('a','First');
  await page.evaluate(()=>{window.renameTest.doc.modified=false;});
  await title('a').dblclick();await input.fill('Cancel this');await input.press('Escape');
  assert.equal((await model())[0].title,'First');assert.equal(await page.evaluate(()=>window.renameTest.doc.modified),false);
  await title('a').dblclick();await input.fill('   ');await input.press('Enter');
  assert.equal((await model())[0].title,'First');
  await title('a').click();await page.keyboard.press('F2');await input.waitFor();
  await input.fill('Blur saved');await page.locator('.bookmarks-container').click({position:{x:40,y:140}});await waitTitle('a','Blur saved');
  await title('a').click();await title('b').click({modifiers:['Control']});await title('c').click({modifiers:['Shift']});
  await title('b').dblclick();await input.fill('Only second');await input.press('Enter');await waitTitle('b','Only second');
  assert.equal((await model())[2].title,'Third');
  // A refreshed tree must preserve an in-progress title during navigation.
  await title('b').dblclick();await input.fill('Survives refresh');
  await page.evaluate(()=>window.renameTest.bm.updateBookmarksList());await input.waitFor();assert.equal(await input.inputValue(),'Survives refresh');
  await input.press('Escape');assert.equal((await model())[1].title,'Only second');
  await title('b').dblclick();await input.fill('abcdef');await input.press('Home');await input.press('Delete');await input.press('ArrowRight');
  assert.equal(await input.inputValue(),'bcdef');assert.equal((await model()).length,3);
  const before=await model();const box=await input.boundingBox();
  await page.mouse.move(box.x+4,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+35,box.y+box.height/2,{steps:8});await page.mouse.up();
  assert.ok(await input.evaluate(el=>el.selectionEnd>el.selectionStart),'mouse selects input text');
  assert.deepEqual(await model(),before,'text drag cannot move bookmark');await input.press('Escape');
  await page.evaluate(()=>{const {doc,bm}=window.renameTest;doc.pdfaCompliance='PDF/A-1b';doc.pdfADismissed=false;bm.updateBookmarksList();});
  await title('a').dblclick();assert.equal(await input.count(),0);await page.keyboard.press('F2');assert.equal(await input.count(),0);
  await page.evaluate(()=>{window.renameTest.doc.pdfaCompliance=null;window.renameTest.bm.updateBookmarksList();});
  await title('a').dblclick();await input.fill('Saved name');await input.press('Enter');await waitTitle('a','Saved name');
  const [download,saved]=await Promise.all([page.waitForEvent('download',{timeout:90000}),page.evaluate(async()=>(await import('/js/pdf/saver.js')).savePDF(null,{zonderHandtekeningVraag:true}))]);
  assert.equal(saved,true);const chunks=[];for await(const c of await download.createReadStream())chunks.push(c);
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const reopened=await getDocument({data:new Uint8Array(Buffer.concat(chunks)),isEvalSupported:false}).promise;
  try {assert.equal((await reopened.getOutline())[0].title,'Saved name');}finally{await reopened.loadingTask.destroy();}
  // F2 outside the list still toggles proofreading, including after list use.
  await page.locator('.bookmarks-container').evaluate(el=>el.blur());
  await page.keyboard.press('F2');
  assert.equal(await page.evaluate(async()=>(await import('/js/tools/proofreading-mode.js')).isProofreadingActive()),true);
  await page.keyboard.press('F2');
  await title('a').dblclick();await input.fill('Must not cross tabs');const old=await model();
  await page.evaluate(async bytes=>{
    (await import('/js/core/platform.js')).cacheWebFile('other-rename.pdf',new Uint8Array(bytes));
    const {index}=(await import('/js/ui/chrome/tabs.js')).createTab('other-rename.pdf');await(await import('/js/pdf/loader.js')).loadPDFIfNeeded('other-rename.pdf',index);
  },bytes);
  assert.equal(await input.count(),0);assert.deepEqual(await model(),old);
  console.log('PASS cross-page double-click, selection, Enter/Ctrl+Z, Escape/empty unchanged, focused F2/Proofread elsewhere, blur save, multiselection, tree refresh, input keys/text drag, readonly/doc-switch guards and saved PDF outline');
}finally{await browser.close();}
