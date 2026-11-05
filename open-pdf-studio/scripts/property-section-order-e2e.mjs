import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
const pdf = await PDFDocument.create(); pdf.addPage([600,800]);
const bytes = [...await pdf.save()];
const browser = await chromium.launch({headless:true});
try {
 const page = await browser.newPage({viewport:{width:1600,height:1200}});
 page.on('pageerror', error => console.error('PAGEERROR',error.message));
 const url=process.argv[2] || 'http://127.0.0.1:32867';
 async function load() {
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
  await page.locator('[data-tab="view"]').waitFor({timeout:90000});
  await page.evaluate(async bytes=>{
   const {cacheWebFile}=await import('/js/core/platform.js');const {createTab}=await import('/js/ui/chrome/tabs.js');
   const {loadPDFIfNeeded}=await import('/js/pdf/loader.js');const {getActiveDocument,state}=await import('/js/core/state.ts');
   const {createAnnotation}=await import('/js/annotations/factory.js');
   const {storeShowProperties}=await import('/js/solid/stores/propertiesStore.js');
   cacheWebFile('sections.pdf',new Uint8Array(bytes));const {index}=createTab('sections.pdf');await loadPDFIfNeeded('sections.pdf',index);
   const doc=getActiveDocument();
   window.sectionTest={doc,state,select(type='textbox',locked=false) {
    const ann=createAnnotation({type,page:1,x:40,y:60,width:160,height:80,text:'Test',locked,scale:'1:100',units:'mm'});
    doc.annotations.push(ann);doc.selectedAnnotation=doc.annotations.at(-1);doc.selectedAnnotations=[doc.selectedAnnotation];storeShowProperties(doc.selectedAnnotation);
   }};
   state.preferences.language='en';
   await (await import('/js/i18n/config.js')).default.changeLanguage('en');
   window.sectionTest.select();
  },bytes);
  await page.locator('#prop-appearance-section').waitFor().catch(async e => { console.log(await page.evaluate(async()=>{const p=await import('/js/solid/stores/propertiesStore.js');return {panel:document.querySelector('#properties-panel')?.outerHTML,props:p.annotProps,vis:p.sectionVis};}));throw e; });
 }
 const appearance=page.locator('#prop-appearance-section > .property-section-header');
 const location=page.locator('.property-section-header').filter({hasText:/^Location/});
 const general=page.locator('#prop-general-section > .property-section-header');
 async function drag(source,target,{cancel=false,dx=0}={}) {
   await source.scrollIntoViewIfNeeded();const a=await source.boundingBox(),b=await target.boundingBox();
   await page.mouse.move(a.x+60,a.y+a.height/2);await page.mouse.down();
   await page.mouse.move(b.x+60+dx,b.y+2,{steps:12});
   if(cancel) await page.keyboard.press('Escape');
   await page.mouse.up();
 }
 await load();
 await general.click();assert(await page.locator('#prop-general-section').evaluate(el=>el.classList.contains('collapsed')));
 await drag(appearance,location);
 assert(await page.evaluate(()=>{
  const a=document.querySelector('#prop-appearance-section');const l=[...document.querySelectorAll('.property-section')].find(el=>el.querySelector('.property-section-header')?.textContent.trim().startsWith('Location'));
  return Boolean(a.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING);
 }),'Appearance moves above Location after a real pointer drag');
 assert.equal(await appearance.getAttribute('aria-expanded'),'true','drop must not collapse source');
 assert.equal(await general.getAttribute('aria-expanded'),'false','collapse state survives reorder');
 console.log('PASS pointer drag and collapse preservation');
 const order=()=>page.locator('[data-property-block]').evaluateAll(els=>els.filter(el=>el.querySelector('.property-section-header, .prop-section-header')?.getClientRects().length).map(el=>el.dataset.propertyBlock));
 let saved=await order();
 await page.evaluate(()=>window.sectionTest.select('line',true));
 let lineOrder=await order();assert(lineOrder.indexOf('appearance')<lineOrder.indexOf('location'));
 assert.equal(new Set(lineOrder).size,lineOrder.length);
 await page.evaluate(()=>window.sectionTest.select('scaleRegion',true));
 assert((await order()).includes('scaleRegion'));
 await page.evaluate(()=>window.sectionTest.select());assert.deepEqual(await order(),saved);
 // Alt+arrows reorder actual DOM/tab order and preserve focus.
 await appearance.focus();await page.keyboard.press('Alt+ArrowDown');
 assert((await order()).indexOf('appearance')>(await order()).indexOf('location'));
 assert(await appearance.evaluate(el=>el===document.activeElement));
 await page.keyboard.press('Alt+ArrowUp');assert.deepEqual(await order(),saved);
 // Plain click and keyboard activation only toggle collapse.
 await appearance.click();assert.equal(await appearance.getAttribute('aria-expanded'),'false');
 await appearance.press('Space');assert.equal(await appearance.getAttribute('aria-expanded'),'true');
 assert.deepEqual(await order(),saved);
 await drag(appearance,general,{cancel:true});assert.deepEqual(await order(),saved);
 await drag(appearance,general,{dx:-500});assert.deepEqual(await order(),saved);
 // A selection change during an unfinished drag cancels the move.
 const a=await appearance.boundingBox(),g=await general.boundingBox();
 await page.mouse.move(a.x+60,a.y+10);await page.mouse.down();await page.mouse.move(g.x+60,g.y+2,{steps:5});
 await page.evaluate(()=>window.sectionTest.select('textbox',true));await page.mouse.up();assert.deepEqual(await order(),saved);
 await page.waitForFunction(()=>Object.values(localStorage).some(v=>v.includes('propertySectionOrder')));
 await load();assert.deepEqual(await order(),saved);assert.equal(await general.getAttribute('aria-expanded'),'false');
 await page.getByRole('button',{name:'Reset section order',exact:true}).click();
 assert.deepEqual((await order()).slice(0,4),['general','location','replies','appearance']);
 assert.equal(await general.getAttribute('aria-expanded'),'false','reset does not reset collapse preferences');
 await load();assert.deepEqual((await order()).slice(0,4),['general','location','replies','appearance']);
 console.log('PASS selection changes, locked line/scale region, keyboard order/focus, click/Space, Escape, outside drop, stale selection, reload persistence and reset');
} finally {await browser.close();}
