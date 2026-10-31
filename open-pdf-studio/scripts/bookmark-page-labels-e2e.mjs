import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
const pdf = await PDFDocument.create();
for (let i = 0; i < 30; i++) pdf.addPage([612, 792]);
const bytes = [...await pdf.save()];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(15000);
  await page.goto(process.argv[2] || 'http://127.0.0.1:3077', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('[data-tab="view"]').waitFor({ timeout: 90000 });
  await page.evaluate(async bytes => {
    const { default: i18n, loadLocale } = await import('/js/i18n/config.js');
    await loadLocale('en'); await i18n.changeLanguage('en');
    const { cacheWebFile } = await import('/js/core/platform.js');
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
    cacheWebFile('names.pdf', new Uint8Array(bytes));
    const { index } = createTab('names.pdf'); await loadPDFIfNeeded('names.pdf', index);
    const { getActiveDocument, state } = await import('/js/core/state.ts');
    state.preferences.language = 'en'; await i18n.changeLanguage('en');
    const bm = await import('/js/ui/panels/bookmarks.js');
    const { zetPaginaLabels } = await import('/js/pdf/pagina-labels-app.js');
    const doc = getActiveDocument();
    window.namesTest = { doc, bm, zetPaginaLabels, getActiveDocument };
    zetPaginaLabels(doc, Array.from({length:30}, (_,i) => 'Sheet '+(i+1)));
    bm.updateBookmarksList();
    (await import('/js/solid/stores/leftPanelStore.js')).switchToLeftPanelTab('bookmarks');
  }, bytes);
  const dialog = page.locator('.bookmark-names-dialog');
  const apply = () => dialog.locator('.modal-footer button').nth(1).click();
  const cancel = () => dialog.locator('.modal-footer button').first().click();
  const open = async direction => {
    await page.locator('.bookmarks-container').click({button:'right',position:{x:65,y:50}});
    await page.locator('.context-menu-item').filter({hasText:direction === 'bookmarks' ? 'Page Labels → Bookmarks' : 'Bookmarks → Page Labels'}).click().catch(async error => { console.log(await page.locator('.context-menu-item').allTextContents()); await page.screenshot({path:'/tmp/opds-892-menu.png'}); throw error; });
    await dialog.waitFor();
  };
  const model = () => page.evaluate(() => JSON.parse(JSON.stringify(window.namesTest.doc.bookmarks)));
  await open('bookmarks');
  assert.equal(await dialog.locator('tbody tr').count(),30);
  await dialog.locator('tbody input').first().fill('Edited first');
  await cancel(); assert.deepEqual(await model(),[]);
  await open('bookmarks'); await dialog.locator('tbody input').first().fill('Edited first'); await apply();
  assert.equal((await model()).length,30); assert.equal((await model())[0].title,'Edited first');
  await page.evaluate(async () => (await import('/js/core/undo-manager.js')).undo());
  assert.deepEqual(await model(),[], 'one undo restores empty bookmarks');
  await open('bookmarks'); await apply(); const first = await model();
  await open('bookmarks'); await apply(); assert.deepEqual(await model(),first,'repeat is idempotent');
  await page.evaluate(() => {
    const {doc,bm} = window.namesTest;
    doc.bookmarks = [
      {id:'group',title:'Group',page:1,parentId:null,sortOrder:0,expanded:true},
      {id:'deep',title:'Deep',page:1,parentId:'group',sortOrder:0,bold:true,color:'#123456'},
      {id:'tie',title:'Tie',page:1,parentId:'group',sortOrder:1},
      {id:'second',title:'Second',page:2,parentId:null,sortOrder:1},
    ]; bm.updateBookmarksList();
  });
  await open('bookmarks'); await apply();
  const nested = await model();
  assert.equal(nested.find(b=>b.id==='group').title,'Group');
  assert.equal(nested.find(b=>b.id==='deep').title,'Sheet 1');
  assert.equal(nested.find(b=>b.id==='deep').bold,true);
  assert.equal(nested.find(b=>b.id==='deep').color,'#123456');
  assert.equal(nested.find(b=>b.id==='tie').title,'Tie');
  await page.evaluate(() => { const {doc,bm} = window.namesTest; doc.bookmarks = doc.bookmarks.filter(b=>['group','deep','tie','second'].includes(b.id)); bm.updateBookmarksList(); });
  await open('labels'); assert.equal(await dialog.locator('tbody tr').count(),2);
  await dialog.locator('tbody input').first().fill('Saved edited label'); await cancel();
  assert.equal(await page.evaluate(()=>window.namesTest.doc.pageLabels[0]),'Sheet 1');
  await open('labels'); await dialog.locator('tbody input').first().fill('Saved edited label'); await apply();
  assert.equal(await page.evaluate(()=>window.namesTest.doc.pageLabels[0]),'Saved edited label');
  assert.equal(await page.evaluate(()=>window.namesTest.doc.pageLabels[2]),'Sheet 3');
  // Stale source and read-only transitions cannot apply an old preview.
  await open('bookmarks');
  await page.evaluate(()=>{window.namesTest.doc.bookmarks[0].title='Changed group';});
  assert.equal(await dialog.locator('.modal-footer button').nth(1).isDisabled(),true);
  assert.equal(await dialog.locator('[role="alert"]').count(),1); await cancel();
  await open('bookmarks');
  await page.evaluate(()=>{window.namesTest.doc.pdfaCompliance='PDF/A-1b';window.namesTest.doc.pdfADismissed=false;window.namesTest.bm.updateBookmarksList();});
  assert.equal(await dialog.locator('.modal-footer button').nth(1).isDisabled(),true); await cancel();
  await page.locator('.bookmarks-container').click({button:'right',position:{x:65,y:50}});
  assert.equal(await page.locator('.context-menu-item.disabled').filter({hasText:'→'}).count(),2);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{window.namesTest.doc.pdfaCompliance=null;window.namesTest.bm.updateBookmarksList();});
  await open('bookmarks'); await dialog.locator('input[type="checkbox"]').check(); await apply();
  assert.equal((await model()).length,30); assert.ok((await model()).every(b=>!b.parentId));
  const [download,saved] = await Promise.all([
    page.waitForEvent('download',{timeout:90000}),
    page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF(null,{zonderHandtekeningVraag:true})),
  ]);
  assert.equal(saved,true); const chunks=[]; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const reopened=await getDocument({data:new Uint8Array(Buffer.concat(chunks)),isEvalSupported:false}).promise;
  try {
    assert.equal((await reopened.getOutline()).length,30);
    assert.equal((await reopened.getOutline())[0].title,'Saved edited label');
    assert.equal((await reopened.getPageLabels())[0],'Saved edited label');
    assert.equal((await reopened.getPageLabels())[2],'Sheet 3');
  } finally { await reopened.loadingTask.destroy(); }
  await open('bookmarks'); const before = await model();
  await page.evaluate(async bytes => {
    (await import('/js/core/platform.js')).cacheWebFile('other-names.pdf',new Uint8Array(bytes));
    const {index}=(await import('/js/ui/chrome/tabs.js')).createTab('other-names.pdf');
    await (await import('/js/pdf/loader.js')).loadPDFIfNeeded('other-names.pdf',index);
  },bytes);
  assert.equal(await dialog.locator('.modal-footer button').nth(1).isDisabled(),true);
  assert.deepEqual(await model(),before); await cancel();
  console.log('PASS empty-list commands, 30 pages, editable previews/cancel, one-step undo, idempotence, deepest/tie selection, style/tree preservation, replace-all, unrelated labels, stale/read-only/document-switch guards, saved PDF outline and labels');
} finally { await browser.close(); }
