// Real PDF.js rendering and Solid dialog events against an isolated Vite server.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument, rgb } from 'pdf-lib';

const pdf = await PDFDocument.create();
const mm = 72 / 25.4;
const large = pdf.addPage([594 * mm, 841 * mm]);
for (const [x,y,color] of [[0,0,rgb(1,0,0)],[297,0,rgb(0,1,0)],[0,420.5,rgb(0,0,1)],[297,420.5,rgb(1,1,0)]]) {
  large.drawRectangle({ x:x*mm,y:y*mm,width:297*mm,height:420.5*mm,color });
}
pdf.addPage([210 * mm, 297 * mm]).drawText('Small second page', { x:40, y:400 });
const bytes = [...await pdf.save()];
const browser = await chromium.launch({ headless:true });
try {
  const page = await browser.newPage({ viewport:{width:1500,height:1000},deviceScaleFactor:2 });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.argv[2] || 'http://127.0.0.1:3066', {waitUntil:'domcontentloaded'});
  await page.locator('[data-tab="drawing"]').waitFor({timeout:90000});
  await page.evaluate(async bytes=>{
    const {cacheWebFile}=await import('/js/core/platform.js');
    const {createTab}=await import('/js/ui/chrome/tabs.js');
    const {loadPDFIfNeeded}=await import('/js/pdf/loader.js');
    const {state,getActiveDocument}=await import('/js/core/state.ts');
    const {stelPaginaInstellingIn}=await import('/js/solid/components/dialogs/PageSetupDialog.jsx');
    const {openDialog}=await import('/js/solid/stores/dialogStore.js');
    cacheWebFile('poster-fixture.pdf',new Uint8Array(bytes));
    const {index}=createTab('poster-fixture.pdf');await loadPDFIfNeeded('poster-fixture.pdf',index);
    stelPaginaInstellingIn({docId:getActiveDocument().id,handmatig:true,size:'a3',orientation:'portrait'});
    state.preferences.printSettings={printer:'opds:opslaan-als-pdf',scaling:'poster',posterScale:100,
      posterOverlap:0,posterCutMarks:false,posterLabels:false,autoRotate:false};
    openDialog('print');
  },bytes);
  const tiles=page.locator('.poster-grid-tile');
  await page.waitForFunction(()=>document.querySelectorAll('.poster-grid-tile').length===4);
  await page.waitForFunction(()=>document.querySelector('.poster-overview canvas')?.dataset.page==='1');
  assert.equal(await tiles.count(),4);
  // Real full-page render: all four coloured quadrants survive the overview.
  const colors=await page.locator('.poster-overview canvas').evaluate(c=>{
    const ctx=c.getContext('2d');return [[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([x,y])=>
      [...ctx.getImageData(Math.floor(c.width*x),Math.floor(c.height*y),1,1).data].slice(0,3));
  });
  assert.deepEqual(colors,[[0,0,255],[255,255,0],[255,0,0],[0,255,0]]);
  const detail=page.locator('#print-preview-canvas');
  const pixel=()=>detail.evaluate(c=>[...c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data].slice(0,3));
  await page.waitForFunction(()=>{const c=document.querySelector('#print-preview-canvas');return c&&c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data[2]===255});
  assert.deepEqual(await pixel(),[0,0,255]);
  await tiles.nth(1).click();
  await page.waitForFunction(()=>{const c=document.querySelector('#print-preview-canvas');const p=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;return p[0]===255&&p[1]===255&&p[2]===0});
  assert.equal(await tiles.nth(1).getAttribute('aria-pressed'),'true');
  await tiles.nth(2).focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>{const c=document.querySelector('#print-preview-canvas');const p=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;return p[0]===255&&p[1]===0&&p[2]===0});
  console.log('labels',await page.locator('.number-stepper input').evaluateAll(xs=>xs.map(x=>x.getAttribute('aria-label'))));
  await page.locator('.number-stepper').nth(1).hover();
  await page.locator('.number-stepper').nth(1).getByRole('button').first().click();
  assert.equal(await page.locator('.number-stepper input').nth(1).inputValue(),'1');
  await page.waitForFunction(()=>document.querySelectorAll('.poster-overlap').length>0);
  await page.locator('.number-stepper input').nth(1).fill('10,5');
  await page.locator('.number-stepper').nth(1).getByRole('button').first().click();
  assert.equal(Number((await page.locator('.number-stepper input').nth(1).inputValue()).replace(',', '.')),11.5);
  await page.locator('.number-stepper input').first().fill('400');
  await page.locator('.number-stepper input').first().press('Tab');
  assert.equal(await page.locator('.number-stepper').first().getByRole('button').first().isDisabled(),true);
  await page.locator('.number-stepper input').first().fill('100');await page.locator('.number-stepper input').first().press('Tab');
  // Existing navigation crosses source-page boundaries; the overview follows.
  await page.locator('.print-preview-nav-btn').last().click();
  await page.waitForFunction(()=>document.querySelector('.poster-overview canvas')?.dataset.page==='2');
  assert.equal(await tiles.count(),1);
  await page.locator('.print-preview-nav-btn').first().click();
  await page.waitForFunction(()=>document.querySelector('.poster-overview canvas')?.dataset.page==='1');
  // Disabled copies (Save as PDF) have no controls; other dialogs use the same shared controls.
  await page.locator('.print-dialog input[data-getal]').first().hover();
  assert.equal(await page.locator('.numeric-field-controls').isVisible(),false);
  await page.evaluate(async()=>{const {openDialog}=await import('/js/solid/stores/dialogStore.js');openDialog('page-setup');});
  const margin=page.locator('.page-setup-margin-input').first();
  await margin.hover();
  await page.locator('.numeric-field-controls').waitFor({state:'visible'});
  await page.locator('.numeric-field-controls button').first().click();
  assert.equal(await margin.inputValue(),'26');
  assert.equal(await margin.evaluate(el=>document.activeElement===el),true);
  await page.locator('.numeric-field-controls button').last().click();
  assert.equal(await margin.inputValue(),'25');
  await page.evaluate(async()=>{const {closeDialog}=await import('/js/solid/stores/dialogStore.js');closeDialog('page-setup');});
  await page.waitForFunction(()=>document.querySelector('.numeric-field-controls').style.display==='none');
  // A dynamically added decimal field takes its own step/bounds, not a hardcoded 1.
  await page.evaluate(()=>{
    const input=document.createElement('input');input.id='stepper-fixture';input.type='text';
    input.setAttribute('data-getal','');input.setAttribute('min','0');input.setAttribute('max','1');input.setAttribute('step','0.1');
    input.value='0.2';input.style.cssText='position:fixed;left:10px;top:10px;width:90px;height:24px;z-index:2147483646';
    window.stepEvents=[];input.addEventListener('input',()=>window.stepEvents.push('input'));input.addEventListener('change',()=>window.stepEvents.push('change'));
    document.body.append(input);
  });
  const fixture=page.locator('#stepper-fixture');await fixture.focus();
  await page.locator('.numeric-field-controls').waitFor({state:'visible'});
  await page.locator('.numeric-field-controls button').first().click();
  assert.equal(Number((await fixture.inputValue()).replace(',','.')),0.3);
  assert.deepEqual(await page.evaluate(()=>window.stepEvents),['input','change']);
  await fixture.evaluate(el=>{el.readOnly=true;});
  await fixture.hover();
  await page.waitForFunction(()=>document.querySelector('.numeric-field-controls').style.display==='none');
  await fixture.evaluate(el=>el.remove());
  await page.locator('.print-dialog').screenshot({path:'/tmp/opds-853-preview.png'});
  await page.evaluate(async()=>{const {closeDialog}=await import('/js/solid/stores/dialogStore.js');closeDialog('print');});
  assert.equal(await page.locator('.poster-overview').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: coloured full-page grid, mouse and keyboard tile selection, sharp detail, overlap, comma decimals, integer steppers/bounds, mixed page navigation, cleanup');
} finally {await browser.close();}
