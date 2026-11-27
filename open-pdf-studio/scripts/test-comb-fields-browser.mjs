import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument,PDFName,PDFString,StandardFonts } from 'pdf-lib';
import { createServer } from 'vite';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const temp=await mkdtemp(path.join(tmpdir(),'opds-comb-'));
const pdf=await PDFDocument.create(),sheet=pdf.addPage([600,800]),form=pdf.getForm(),font=await pdf.embedFont(StandardFonts.Courier);
for(const [name,len,y,align] of [['short',2,700,0],['letters',4,630,0],['digits',8,560,0],['right',4,490,2],['range',2,420,0]]){
 const f=form.createTextField(name);f.setMaxLength(len);f.enableCombing();f.setAlignment(align);f.addToPage(sheet,{x:60,y,width:len*30,height:28,borderWidth:0,font});f.setFontSize(16);
 if(name==='range')f.acroField.getWidgets()[0].dict.set(PDFName.of('AA'),pdf.context.obj({V:{S:'JavaScript',JS:PDFString.of('AFRange_Validate(true, 10, true, 20);')}}));
}
form.updateFieldAppearances(font);const bytes=Array.from(await pdf.save());
const server=await createServer({root,cacheDir:path.join(temp,'vite'),logLevel:'error',server:{host:'127.0.0.1',port:18306,strictPort:false,hmr:false}});let browser;
try{
 await server.listen();browser=await chromium.launch({headless:true});
 for(const mode of ['single','continuous']){
  const page=await browser.newPage({viewport:{width:1400,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{timeout:120000});await page.waitForSelector('#tool-select',{timeout:120000});
  async function load(data,file){await page.evaluate(async({bytes,mode,file})=>{const core=await import('/js/core/state.ts');core.state.preferences.defaultViewMode=mode;const {index}=(await import('/js/ui/chrome/tabs.js')).createTab(file);await(await import('/js/pdf/loader.js')).loadPDF(file,index,new Uint8Array(bytes));await core.getActiveDocument()._annotationCompletion;},{bytes:data,mode,file});}
  await load(bytes,'/comb.pdf');const input=n=>page.locator(`.formLayer input[name="${n}"]:visible`).first();await input('short').waitFor({timeout:60000});
  await input('short').fill('1');await page.locator('#tool-select').click();
  console.log(mode,'initial',await input('short').evaluate(el=>({letterSpacing:getComputedStyle(el).letterSpacing,width:el.getBoundingClientRect().width})),'dialogs',await page.locator('.form-validation-dialog').count());
  assert.equal(await page.locator('.form-validation-dialog').count(),0,'MaxLen is an upper bound, not a required length');
  await input('letters').click();await page.keyboard.type('AB');await page.locator('#tool-select').click();assert.equal(await input('letters').inputValue(),'AB','comb does not imply numeric-only');
  await input('digits').fill('12345678');await input('right').fill('12');await page.locator('#tool-select').click();
  for(const z of [1,1.75]){
   await page.evaluate(async z=>{const core=await import('/js/core/state.ts');core.state.scale=z;await(await import('/js/pdf/renderer.js')).renderPage(core.state.currentPage);},z);await input('digits').waitFor();
   for(const name of ['digits','right']){
    const before=await input(name).boundingBox();await input(name).click();
    const m=await input(name).evaluate(el=>{const s=getComputedStyle(el),c=document.createElement('canvas').getContext('2d');c.font=`${s.fontSize} ${s.fontFamily}`;return{width:el.getBoundingClientRect().width,spacing:parseFloat(s.letterSpacing),indent:parseFloat(s.textIndent),glyph:c.measureText('0').width,max:el.maxLength,offset:Number(s.getPropertyValue('--comb-offset'))||0};});
    assert.ok(Math.abs(m.width-before.width)<.1,'focus does not grow field');assert.ok(Math.abs(m.spacing+m.glyph-m.width/m.max)<1,'glyph pitch equals cell');assert.ok(Math.abs(m.indent-(m.offset*m.width/m.max+m.spacing/2))<1,'aligned character centers');
   }
  }
  async function invalid(value){await input('range').fill(value);await page.locator('#tool-select').click();await page.locator('.form-validation-dialog').waitFor();await page.locator('.form-validation-ok-btn').click();await page.waitForFunction(()=>document.activeElement?.name==='range');}
  await invalid('3');await page.locator('#tool-select').click();assert.equal(await page.locator('.form-validation-dialog').count(),0,'unchanged acknowledged error cannot trap focus');
  await invalid('4');await input('range').fill('12');await page.locator('#tool-select').click();assert.equal(await page.locator('.form-validation-dialog').count(),0);
  const saved=await page.evaluate(async()=>{const core=await import('/js/core/state.ts');const{pdfDocLib}=await(await import('/js/pdf/saver.js')).bouwAnnotatieDocument(core.getActiveDocument());return Array.from(await pdfDocLib.save());});
  const reopened=await PDFDocument.load(new Uint8Array(saved));for(const[n,v]of[['short','1'],['letters','AB'],['digits','12345678']])assert.equal(reopened.getForm().getTextField(n).getText(),v);
  await load(saved,'/comb-saved.pdf');await input('short').waitFor();assert.equal(await input('short').inputValue(),'1');
  if(process.env.OPDS_COMB_SCREENSHOT&&mode==='single')await page.screenshot({path:process.env.OPDS_COMB_SCREENSHOT});
  assert.deepEqual(errors.filter(x=>!x.startsWith('WebSocket closed without opened')),[]);console.log(`PASS ${mode}: comb values, spacing/alignment/zoom, explicit validation without focus trap, save/reopen`);await page.close();
 }
}finally{await browser?.close();await server.close();await rm(temp,{recursive:true,force:true});}
