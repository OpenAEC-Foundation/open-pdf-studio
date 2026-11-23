import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';
// Regression for the two dialog-owned color-font triggers from #1214.
// All external requests are intercepted; no feedback or user preferences are sent.
const root=process.cwd();
const cache=await mkdtemp(path.join(tmpdir(),'opds-1214-'));
const server=await createServer({root,cacheDir:cache,logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false}});
let browser;
try {
 await server.listen();
 const engine=process.env.PROBE_ENGINE || 'chromium';
 browser=await ({chromium,webkit}[engine]).launch({headless:true,...(process.env.PROBE_EXECUTABLE ? {executablePath:process.env.PROBE_EXECUTABLE} : {})});
 const page=await browser.newPage({viewport:{width:1400,height:1000}});
 page.setDefaultTimeout(15000);
 const pageErrors=[];
 page.on('pageerror',e=>{
  if(e.message!=='ResizeObserver loop completed with undelivered notifications.') pageErrors.push(e.message);
 });
 let indexRequests=0;
 await page.route('**/*',route=>{
  if(new URL(route.request().url()).hostname==='127.0.0.1') return route.continue();
  if(route.request().url().endsWith('/main/index.json')) {
   indexRequests++;
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({formatVersion:1,regions:[{id:'europe',countries:[{id:'NL',name:{en:'Netherlands'},flag:'🇳🇱',sectors:{aec:{collections:[]}}}]}],collections:{}})});
  }
  return route.abort();
 });
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{timeout:120000});
 await page.waitForSelector('#tool-select',{timeout:120000});
 console.log('loaded',engine);
 await page.evaluate(async()=>{
  await (await import('/js/i18n/useTranslation.js')).changeLanguage('en');

 });
 await page.locator('#send-feedback').click();
 const feedback=page.locator('.feedback-dialog');await feedback.waitFor();
 const faces=feedback.locator('.feedback-sentiment-btn');
 assert.equal(await faces.count(),3);
 assert.equal(await faces.nth(0).evaluate(el=>getComputedStyle(el).color),await feedback.locator('.feedback-message').evaluate(el=>getComputedStyle(el).color),'faces match the input text color in the active theme');
 assert.equal(await faces.locator('svg').count(),3,'sentiment faces must use vectors, not color-font glyphs');
 assert.equal(await faces.locator('svg text').count(),0);
 assert.ok(!/\p{Extended_Pictographic}/u.test(await feedback.textContent()),'dialog must not render decorative emoji');
 for(let i=0;i<3;i++) {
  const button=faces.nth(i);
  assert.ok(await button.getAttribute('aria-label'),'localized accessible label');
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'),'true');
  assert.equal(await feedback.locator('[aria-pressed=true]').count(),1);
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'),'false');
 }

 await faces.nth(0).click();
 await faces.nth(2).click();
 assert.equal(await faces.nth(0).getAttribute('aria-pressed'),'false');
 assert.equal(await faces.nth(2).getAttribute('aria-pressed'),'true');
 if(process.env.DIALOG_SCREENSHOT) await feedback.screenshot({path:process.env.DIALOG_SCREENSHOT});
 await feedback.locator('.feedback-message').fill('Local regression probe. This feedback will not be sent.');
 assert.equal(await feedback.locator('.feedback-message').inputValue(),'Local regression probe. This feedback will not be sent.');
 await feedback.locator('.modal-close-btn').click();await feedback.waitFor({state:'detached'});
 console.log('PASS vector faces, accessible selection/toggle, feedback input and close');
 for(let i=0;i<3;i++) {
  await page.locator('.sp-settings-btn:visible').first().click();
  const settings=page.locator('.sp-settings-dialog');await settings.waitFor();
  const country=settings.locator('.sp-settings-locale-field select').nth(1);
  await page.waitForFunction(()=>[...document.querySelectorAll('.sp-settings-locale-field select option')].some(o=>o.value==='NL'));
  const option=country.locator('option[value=NL]');
  assert.equal(await option.textContent(),'Netherlands','localized country name without color-font flag');
  assert.ok(!/\p{Regional_Indicator}/u.test(await country.textContent()));
  await country.selectOption('NL');
  assert.equal(await country.inputValue(),'NL');

  await settings.locator('input[type=text]').first().fill('Local group');
  await settings.locator('.sp-settings-header .sp-float-close').click();await settings.waitFor({state:'detached'});
 }
 console.log('PASS symbol settings opens, accepts input, closes three times');
 console.log('PASS responsive',await page.evaluate(()=>document.readyState),'index requests',indexRequests);
 assert.deepEqual(pageErrors,[],'no unexpected page errors');
 assert.ok(indexRequests>0 && indexRequests<=3,'one index request per open, no refresh loop');
} finally {
 await browser?.close();await server.close();await rm(cache,{recursive:true,force:true});
}
