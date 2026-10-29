import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument, degrees } from 'pdf-lib';
import { readWatermarkDefinitions } from '../js/pdf/saver/watermark-content.js';
const pdf=await PDFDocument.create();const sheet=pdf.addPage([700,900]);sheet.setCropBox(50,60,600,800);sheet.setRotation(degrees(90));sheet.drawText('ORIGINAL',{x:100,y:200});
const initial=[...await pdf.save()];
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 page.on('pageerror',e=>console.error(e.message));
 await page.goto(process.argv[2]||'http://127.0.0.1:3064',{waitUntil:'domcontentloaded',timeout:90000});
 await page.locator('[data-tab="drawing"]').waitFor({timeout:90000});
 async function open(bytes,path) {await page.evaluate(async({bytes,path})=>{
   const {cacheWebFile}=await import('/js/core/platform.js');const {createTab}=await import('/js/ui/chrome/tabs.js');const {loadPDFIfNeeded}=await import('/js/pdf/loader.js');
   cacheWebFile(path,new Uint8Array(bytes));const {index}=createTab(path);await loadPDFIfNeeded(path,index);
   window.__doc=(await import('/js/core/state.ts')).getActiveDocument;
 },{bytes,path});}
 async function save() {
   const [download,ok]=await Promise.all([page.waitForEvent('download',{timeout:90000}),page.evaluate(async()=>await (await import('/js/pdf/saver.js')).savePDF(null,{zonderHandtekeningVraag:true}))]);
   assert.equal(ok,true,'savePDF succeeded');const stream=await download.createReadStream();const chunks=[];for await(const c of stream)chunks.push(c);return new Uint8Array(Buffer.concat(chunks));
 }
 async function texts(bytes) {const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const d=await getDocument({data:bytes.slice(),isEvalSupported:false,useSystemFonts:true}).promise;try {return (await (await d.getPage(1)).getTextContent()).items.map(i=>i.str).filter(Boolean);}finally{await d.loadingTask.destroy();}}
 await open(initial,'watermark-fixture.pdf');
 await page.evaluate(()=>window.__doc().watermarks.push({id:'test-watermark',type:'textWatermark',text:'WATERMARK',fontFamily:'Helvetica',fontSize:40,enabled:true,position:'center',rotation:45,opacity:0.3,pageRange:'all',layer:'infront'}));
 for(let i=0;i<2;i++){const bytes=await save();assert.deepEqual(await texts(bytes),['ORIGINAL','WATERMARK']);assert.equal(await page.evaluate(()=>window.__doc()._kopVoetBron),null);console.log(`Save ${i+1}: one watermark, live view uses overlay only`);}
 const saved=await save();await open([...saved],'watermark-reopened.pdf');
 await page.waitForFunction(()=>window.__doc().watermarks.length===1,null,{timeout:30000});
 assert.equal(await page.evaluate(async()=> (await import('/js/watermark/kopvoet-tekst.js')).kopVoetInWeergave(window.__doc(),window.__doc().watermarks[0])),true);
 await page.evaluate(async()=> (await import('/js/solid/stores/dialogStore.js')).openDialog('watermark',{editWm:window.__doc().watermarks[0]}));
 await page.locator('.watermark-dialog input.watermark-input').first().fill('EDITED');
 await page.locator('.watermark-dialog .pref-btn-primary').click();
 await page.waitForFunction(()=>window.__doc().watermarks[0].text==='EDITED',null,{timeout:30000});
 assert.deepEqual(await texts(await save()),['ORIGINAL','EDITED']);
 await page.evaluate(async()=> (await import('/js/solid/stores/dialogStore.js')).openDialog('manage-watermarks'));
 await page.locator('.manage-wm-dialog input[type="checkbox"]').uncheck();
 await page.waitForFunction(()=>!window.__doc().watermarks[0].enabled,null,{timeout:30000});
 await page.keyboard.press('Escape');const disabled=await save();assert.deepEqual(await texts(disabled),['ORIGINAL']);
 await open([...disabled],'watermark-disabled.pdf');
 await page.waitForFunction(()=>window.__doc().watermarks.length===1,null,{timeout:30000});
 await page.evaluate(async()=> (await import('/js/solid/stores/dialogStore.js')).openDialog('manage-watermarks'));
 await page.locator('.manage-wm-dialog .manage-wm-btn.delete').click();
 await page.waitForFunction(()=>window.__doc().watermarks.length===0,null,{timeout:30000});
 await page.keyboard.press('Escape');const deleted=await save();
 assert.deepEqual(readWatermarkDefinitions(await PDFDocument.load(deleted)),[]);
 assert.deepEqual(await texts(deleted),['ORIGINAL']);
 console.log('PASS: actual save/download twice, reopen definitions without duplicate overlay, dialog edit, disable, reopen/delete disabled definition and save preserve original content');
}finally{await browser.close();}
