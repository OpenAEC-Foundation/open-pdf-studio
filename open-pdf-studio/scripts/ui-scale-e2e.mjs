import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
const pdf=await PDFDocument.create();pdf.addPage([612,792]);pdf.addPage([612,792]);
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1400,height:1000}});page.setDefaultTimeout(15000);
 await page.goto(process.argv[2] || 'http://127.0.0.1:3079',{waitUntil:'domcontentloaded',timeout:90000});await page.locator('[data-tab="view"]').waitFor({timeout:90000});
 await page.evaluate(async bytes=>{
  const {state,getActiveDocument}=await import('/js/core/state.ts');
  const {default:i18n,loadLocale}=await import('/js/i18n/config.js');await loadLocale('en');state.preferences.language='en';await i18n.changeLanguage('en');
  (await import('/js/core/platform.js')).cacheWebFile('ui-scale.pdf',new Uint8Array(bytes));
  const {index}=(await import('/js/ui/chrome/tabs.js')).createTab('ui-scale.pdf');await(await import('/js/pdf/loader.js')).loadPDFIfNeeded('ui-scale.pdf',index);
  await(await import('/js/pdf/renderer.js')).setZoom(1);
  const doc=getActiveDocument();doc.bookmarks=[{id:'a',title:'A long drawing sheet title',page:1,sortOrder:0}];(await import('/js/ui/panels/bookmarks.js')).updateBookmarksList();
  (await import('/js/solid/stores/leftPanelStore.js')).switchToLeftPanelTab('bookmarks');window.scaleTest={state,doc};
 },[...await pdf.save()]);
 const metrics=()=>page.evaluate(()=>{
  const bounds=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,font:parseFloat(getComputedStyle(e).fontSize)};};
  return {tab:bounds('.ribbon-tab'),bookmark:bounds('.bookmark-title'),row:bounds('.bookmark-item'),nav:bounds('.status-page-input'),canvas:bounds('#pdf-canvas'),scale:window.scaleTest.doc.scale};
 });
 const original=await metrics();
 for(const scale of [125,150,175,200,100]){
  await page.evaluate(scale=>{window.scaleTest.state.preferences.uiScale=scale;},scale);
  await page.waitForFunction(scale=>getComputedStyle(document.querySelector('.ribbon-tab')).fontSize===`${12*scale/100}px`,scale);
  const m=await metrics();
  for(const key of ['tab','bookmark','nav']) assert.ok(Math.abs(m[key].font-original[key].font*scale/100)<.2,`${key} scales`);
  assert.equal(m.canvas.width,original.canvas.width,'PDF width unchanged');assert.equal(m.canvas.height,original.canvas.height,'PDF height unchanged');assert.equal(m.scale,original.scale);
 }
 // Preferences uses the existing Save/Cancel/persistence path.
 const openPrefs=()=>page.evaluate(async()=>{(await import('/js/solid/stores/dialogStore.js')).openDialog('preferences');});
 await openPrefs();await page.locator('#pref-ui-scale').selectOption('150');await page.locator('.preferences-dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.scaleTest.state.preferences.uiScale),100);
 await openPrefs();await page.locator('#pref-ui-scale').selectOption('200');
 await page.locator('.preferences-dialog').getByRole('button',{name:'Save',exact:true}).click();
 await page.waitForFunction(()=>window.scaleTest.state.preferences.uiScale===200);
 await openPrefs();await page.locator('.preferences-dialog').waitFor();
 const header=page.locator('.preferences-dialog .modal-header');const box=await header.boundingBox();
 await page.mouse.move(box.x+50,box.y+20);await page.mouse.down();await page.mouse.move(box.x+100,box.y+20,{steps:5});await page.mouse.up();
 const moved=await header.boundingBox();assert.ok(Math.abs(moved.x-box.x-50)<2 && Math.abs(moved.y-box.y)<2,'dialog drag uses screen pixels');
 await page.locator('.preferences-dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 await page.setViewportSize({width:800,height:600});await openPrefs();
 const dialog=await page.locator('.preferences-dialog').boundingBox();assert.ok(dialog.x>=0 && dialog.y>=0 && dialog.x+dialog.width<=801 && dialog.y+dialog.height<=601,'dialog fits small window');
 await page.screenshot({path:'/tmp/opds-883-small.png'});
 await page.locator('.preferences-dialog').getByRole('button',{name:'Cancel',exact:true}).click();
 const nav=await page.locator('.status-bar-center').boundingBox();assert.ok(nav.x>=0 && nav.x+nav.width<=801 && nav.y+nav.height<=601,'navigation reachable');
 await page.screenshot({path:'/tmp/opds-883-ui.png'});
 const layout=await page.evaluate(()=>{
  const bounds=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width};};
  return {nav:bounds('.status-bar-center'),left:bounds('.status-bar-left'),right:bounds('.status-bar-right'),view:bounds('.main-view'),title:bounds('.title-bar-center'),tools:bounds('.title-bar-left')};
 });
 assert.ok(layout.left.y>=layout.nav.bottom && layout.right.y>=layout.nav.bottom,'status rows do not overlap');
 assert.ok(layout.view.width>=240 && layout.view.x<800,'PDF area remains reachable');
 assert.ok(layout.title.x>=layout.tools.right-1,'title does not overlap quick access');


 // Drawing must use normal client pixels even when the chrome is doubled.
 await page.setViewportSize({width:1800,height:1200});
 await page.evaluate(async()=>{await(await import('/js/pdf/renderer.js')).setZoom(1);(await import('/js/tools/manager.js')).setTool('box');});
 const canvas=await page.locator('#annotation-canvas').boundingBox();
 const view=await page.locator('.main-view').boundingBox();
 const x=Math.max(canvas.x,view.x)+40,y=Math.max(canvas.y,view.y)+40;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+80,y+60,{steps:8});await page.mouse.up();
 await page.waitForFunction(()=>window.scaleTest.doc.annotations.length===1);
 const annotation=await page.evaluate(()=>JSON.parse(JSON.stringify(window.scaleTest.doc.annotations[0])));
 assert.ok(Math.abs(annotation.width-80)<2 && Math.abs(annotation.height-60)<2,'drawing dimensions stay in PDF points at zoom 1');
 await page.locator('.status-nav-btn[title="Next Page"]').click();
 await page.waitForFunction(()=>window.scaleTest.doc.currentPage===2);
 await page.locator('.status-nav-btn[title="Previous Page"]').click();
 await page.waitForFunction(()=>window.scaleTest.doc.currentPage===1);
 const handle=page.locator('#left-panel-resize');const before=await page.locator('.left-panel').boundingBox();const h=await handle.boundingBox();
 await page.mouse.move(h.x+h.width/2,h.y+80);await page.mouse.down();await page.mouse.move(h.x+h.width/2-40,h.y+80,{steps:6});await page.mouse.up();
 const after=await page.locator('.left-panel').boundingBox();assert.ok(Math.abs(after.width-before.width+40)<3,'panel resize follows screen pixels');

 await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-tab="view"]').waitFor({timeout:90000});
 assert.equal(await page.evaluate(async()=>(await import('/js/core/state.ts')).state.preferences.uiScale),200,'scale persists after reload');
 await page.setViewportSize({width:1000,height:700});
 for(const language of ['de','ar']) {
  await page.evaluate(async language=>{const {default:i18n,loadLocale}=await import('/js/i18n/config.js');await loadLocale(language);await i18n.changeLanguage(language);},language);
  await openPrefs();
  const bounds=await page.locator('.preferences-dialog').boundingBox();
  assert.ok(bounds.x>=0 && bounds.x+bounds.width<=1001,'localized preferences fit');
  await page.locator('.preferences-dialog .pref-combo-arrow').last().click();
  const popup=await page.locator('.pref-combo-dropdown.show').boundingBox();
  assert.ok(popup.x>=0 && popup.y>=0 && popup.x+popup.width<=1001 && popup.y+popup.height<=701,'dropdown remains inside viewport');
  await page.locator('.pref-combo-dropdown.show .pref-combo-option').first().click();
  await page.locator('.preferences-dialog .modal-footer button').nth(1).click();
 }
 await page.evaluate(async()=>{const {default:i18n}=await import('/js/i18n/config.js');await i18n.changeLanguage('en');});
 await openPrefs();
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('.preferences-dialog').getByRole('button',{name:'Reset to Defaults',exact:true}).click();
 assert.equal(await page.locator('#pref-ui-scale').inputValue(),'100','reset restores 100%');
 await page.locator('.preferences-dialog').getByRole('button',{name:'Save',exact:true}).click();
 assert.equal(await page.evaluate(async()=>(await import('/js/core/state.ts')).state.preferences.uiScale),100);
 console.log('PASS UI font/dimension scaling 100–200%, fixed PDF geometry, preference Cancel/Save/persistence, dialog/panel dragging, PDF drawing, navigation, German/Arabic dropdown bounds, reset and small-window reachability');
}finally{await browser.close();}
