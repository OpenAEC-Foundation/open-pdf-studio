import assert from 'node:assert/strict';
// Run against an isolated Vite server: node scripts/frame-labels-e2e.mjs <url>
// Tauri filesystem calls are replaced with in-memory fixture PDFs.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PDFDocument}=require('pdf-lib');
const pdf=await PDFDocument.create();pdf.addPage([2384,1684]);const bytes=[...await pdf.save()];
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(process.argv[2] || 'http://127.0.0.1:3060',{waitUntil:'domcontentloaded'});
 await page.locator('[data-tab="drawing"]').waitFor({timeout:90000});
 await page.evaluate(async bytes=>{
  const {changeLanguage}=await import('/js/i18n/useTranslation.js');await changeLanguage('en');
  window.__frameReads=[];
  window.__TAURI__={core:{invoke:async cmd=>cmd==='app_data_dir_effectief'?'C:\\fixture':undefined},path:{resourceDir:async()=> 'C:\\resources'},fs:{
   exists:async p=>p==='C:\\fixture\\kaders',
   readDir:async()=>['grootformaat_a1_liggend.pdf','grootformaat_a1_staand.pdf','detailblad_a3_liggend.pdf','voorblad_a4_staand.pdf','customstudio_a1_liggend.pdf','constructor_a1_liggend.pdf'].map(name=>({name,isDirectory:false})),
   readFile:async p=>{window.__frameReads.push(p);return new Uint8Array(bytes);}
  }};
  const {openDialog}=await import('/js/solid/stores/dialogStore.js');openDialog('new-doc');
 },bytes);
 const styles=page.locator('.new-doc-select').first();
 await page.waitForFunction(()=>document.querySelectorAll('.new-doc-select option').length>=6);
 const options=await styles.locator('option').evaluateAll(els=>Object.fromEntries(els.map(el=>[el.value,el.textContent])));
 console.log('English options:',options);
 assert.equal(options.grootformaat,'Large format');assert.equal(options.detailblad,'Detail sheet');assert.equal(options.voorblad,'Cover sheet');
 assert.equal(options.customstudio,'Customstudio');assert.equal(options.constructor,'Constructor');
 const caption=page.locator('.new-doc-preview-text');
 assert.equal(await caption.textContent(),'Large format, A1 landscape, 841 x 594 mm');
 await page.locator('input[name="new-doc-orientation"][value="portrait"]').check();
 assert.equal(await caption.textContent(),'Large format, A1 portrait, 594 x 841 mm');
 await styles.selectOption('customstudio');
 assert.equal(await caption.textContent(),'Customstudio, A1 landscape, 841 x 594 mm');
 await page.waitForFunction(()=>window.__frameReads.some(p=>p.endsWith('customstudio_a1_liggend.pdf')));
 await styles.selectOption('grootformaat');
 await page.evaluate(async()=>{const {changeLanguage}=await import('/js/i18n/useTranslation.js');await changeLanguage('nl');});
 assert.equal(await styles.locator('option[value="grootformaat"]').textContent(),'Grootformaat');
 assert.equal(await styles.locator('option[value="detailblad"]').textContent(),'Detailblad');
 assert.equal(await styles.locator('option[value="voorblad"]').textContent(),'Voorblad');
 assert.equal(await caption.textContent(),'Grootformaat, A1 liggend, 841 x 594 mm');
 await styles.selectOption('');assert.equal(await caption.textContent(),'841 x 594 mm (A1)');
 console.log('PASS: translated styles, live EN→NL, orientations, custom fallback, original file paths and blank-page caption');
} finally {await browser.close();}
