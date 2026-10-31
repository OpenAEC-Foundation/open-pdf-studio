// Run against an isolated Vite server. Tests real PDF pixels and dialog input.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import { writeWatermarkContent } from '../js/pdf/saver/watermark-content.js';
const pdf=await PDFDocument.create();
for(const size of [[600,800],[450,700]]) {
  const p=pdf.addPage(size); p.drawRectangle({x:20,y:20,width:50,height:50,color:rgb(0,0,0)});
}
pdf.getPages()[1].setRotation(degrees(90));
const old={id:'existing',type:'textWatermark',text:'ORIGINAL',fontSize:48,fontFamily:'Helvetica',color:'#ff0000',opacity:1,rotation:0,position:'center',layer:'infront',pageRange:'all',enabled:true};
await writeWatermarkContent(pdf,[old],{pageRange:()=>[1,2]});
const bytes=[...await pdf.save()];
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1500,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]||'http://127.0.0.1:3070',{waitUntil:'domcontentloaded',timeout:90000});
 await page.locator('[data-tab="drawing"]').waitFor({timeout:90000});
 await page.evaluate(async bytes=>{
  const {cacheWebFile}=await import('/js/core/platform.js');
  const {createTab}=await import('/js/ui/chrome/tabs.js');
  const loader=await import('/js/pdf/loader.js');
  const {getActiveDocument}=await import('/js/core/state.ts');
  const {openDialog}=await import('/js/solid/stores/dialogStore.js');
  cacheWebFile('watermark-preview.pdf',new Uint8Array(bytes));const {index}=createTab('watermark-preview.pdf');await loader.loadPDFIfNeeded('watermark-preview.pdf',index);
  const doc=getActiveDocument();window.fixture={doc,loader,openDialog,getActiveDocument,sourcePdf:doc.pdfDoc,sourceBytes:loader.getCachedPdfBytes(doc.filePath)};
  window.fixture.before=JSON.stringify({watermarks:doc.watermarks,modified:doc.modified,undo:doc.undoStack});

 },bytes);
 await page.waitForFunction(()=>window.fixture.doc.watermarks.some(w=>w.id==='existing'),null,{timeout:90000});
 await page.evaluate(()=>{const f=window.fixture;f.before=JSON.stringify({watermarks:f.doc.watermarks,modified:f.doc.modified,undo:f.doc.undoStack});f.openDialog('watermark',{editWm:f.doc.watermarks.find(w=>w.id==='existing')});});
 const canvas=page.locator('#watermark-preview-canvas');
 const ready=async n=>page.waitForFunction(n=>{const c=document.querySelector('#watermark-preview-canvas');return c?.dataset.page===String(n)&&c.width>1;},n,{timeout:90000});
 const pixels=async()=>page.evaluate(()=>{
  const c=document.querySelector('#watermark-preview-canvas');const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  let red=0,green=0,blue=0;for(let i=0;i<a.length;i+=4){if(a[i]>150&&a[i+1]<80&&a[i+2]<80)red++;if(a[i+1]>100&&a[i]<80&&a[i+2]<80)green++;if(a[i+2]>150&&a[i]<80&&a[i+1]<80)blue++;}return{red,green,blue};
 });
 await ready(1); assert.ok((await pixels()).red>100);
 const textTab=page.locator('.watermark-tab-content.active');
 await textTab.locator('input[type="color"]').fill('#00ff00');

 await page.waitForFunction(()=>{const c=document.querySelector('#watermark-preview-canvas');const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<a.length;i+=4)if(a[i+1]>150&&a[i]<80&&a[i+2]<80)return true;return false;});
 assert.equal((await pixels()).red,0,'Edited stored watermark is replaced, not drawn twice');
 const repaintTimes=await page.evaluate(async()=>{
  const input=document.querySelector('.watermark-tab-content.active input[type="color"]');const times=[];
  for(const color of ['#ff0000','#00ff00','#ff0000','#00ff00']) {
   const start=performance.now();
   await new Promise(resolve=>{
    const observer=new MutationObserver(()=>{observer.disconnect();resolve();});
    observer.observe(document.querySelector('#watermark-preview-canvas'),{attributes:true,attributeFilter:['data-page']});
    input.value=color;input.dispatchEvent(new Event('input',{bubbles:true}));
   });
   times.push(performance.now()-start);
  }
  return times;
 });
 console.log('Cached preview repaint samples (ms):',repaintTimes.map(n=>n.toFixed(1)).join(', '));
 // Zero opacity must hide the edited watermark; restoring opacity repaints immediately.
 await textTab.locator('input[type="range"]').fill('0');
 await page.waitForFunction(()=>{const c=document.querySelector('#watermark-preview-canvas'),a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<a.length;i+=4)if(a[i+1]>150&&a[i]<80&&a[i+2]<80)return false;return true;});
 await textTab.locator('input[type="range"]').fill('100');
 // The preview owns zoom/pan; the underlying document's zoom is untouched.
 const originalWidth=(await canvas.boundingBox()).width;
 const originalScale=await page.evaluate(()=>window.fixture.doc.scale);
 await canvas.hover();await page.keyboard.down('Control');await page.mouse.wheel(0,-100);await page.keyboard.up('Control');
 await page.waitForFunction(w=>document.querySelector('#watermark-preview-canvas').getBoundingClientRect().width>w,originalWidth);
 assert.equal(await page.evaluate(()=>window.fixture.doc.scale),originalScale);
 await page.keyboard.down('Control');await page.mouse.wheel(0,100);await page.keyboard.up('Control');

 await page.locator('#watermark-text-input').fill('PREVIEW');
 await textTab.locator('.watermark-input-sm').first().fill('0');
 const r=await canvas.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+30,r.y+r.height/2+20,{steps:5});await page.mouse.up();
 const xy=await page.locator('.wm-custom-pos input').evaluateAll(inputs=>inputs.map(e=>Number(e.value)));
 assert.ok(xy[0]>300&&xy[1]>400,'Drag updates custom page coordinates');
 await textTab.locator('select').last().selectOption('first');
 await page.locator('.watermark-preview-nav button').last().click(); await ready(2);
 assert.equal((await pixels()).green,0,'Page range excludes the second page');
 assert.equal((await pixels()).red,0,'Stored original also absent on excluded page');
 const r2=await canvas.boundingBox();assert.ok(r2.width>r2.height,'Rotated page uses its displayed dimensions');
 await page.locator('.watermark-preview-nav button').first().click();await ready(1);
 // Cancel must preserve the original bytes, renderer, model, and undo state.
 await page.locator('.watermark-footer .pref-btn-secondary').click();
 assert.equal(await page.evaluate(()=>{const f=window.fixture,d=f.doc;return JSON.stringify({watermarks:d.watermarks,modified:d.modified,undo:d.undoStack})===f.before&&d.pdfDoc===f.sourcePdf&&f.loader.getCachedPdfBytes(d.filePath)===f.sourceBytes;}),true);
 // Image preview decodes asynchronously and must repaint without another input.
 await page.evaluate(()=>window.fixture.openDialog('watermark',{}));await ready(1);
 await page.locator('.watermark-tab').last().click();
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=40;c.height=20;const x=c.getContext('2d');x.fillStyle='#0000ff';x.fillRect(0,0,40,20);return c.toDataURL().split(',')[1];});
 await page.locator('.watermark-dialog input[type="file"]').setInputFiles({name:'blue.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.locator('.watermark-tab-content.active input[type="range"]').first().fill('100');
 await page.waitForFunction(()=>{const c=document.querySelector('#watermark-preview-canvas');const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<a.length;i+=4)if(a[i+2]>150&&a[i]<80&&a[i+1]<80)return true;return false;});
 await page.screenshot({path:'/tmp/opds-848-preview.png',fullPage:true});
 await page.locator('.watermark-footer .pref-btn-primary').click();
 assert.equal(await page.evaluate(()=>window.fixture.doc.watermarks.filter(w=>w.type==='imageWatermark').length),1);
 // Switching documents closes a pending preview instead of applying it elsewhere.
 await page.evaluate(()=>window.fixture.openDialog('watermark',{}));await ready(1);
 await page.evaluate(async()=>{const {createTab}=await import('/js/ui/chrome/tabs.js');createTab(null);});
 await page.locator('.watermark-dialog').waitFor({state:'detached'});
 assert.deepEqual(errors,[]);
 console.log('PASS: stored watermark replacement, live text/color, drag, page range, rotation, cancel preserves bytes/model/undo, asynchronous image preview, apply once, document-switch cleanup');
} catch(e) { const p=browser.contexts()[0]?.pages()[0]; if(p) { await p.screenshot({path:'/tmp/opds-848-failure.png',fullPage:true}); console.log(await p.locator('.watermark-dialog').innerText()); } throw e; } finally {await browser.close();}
