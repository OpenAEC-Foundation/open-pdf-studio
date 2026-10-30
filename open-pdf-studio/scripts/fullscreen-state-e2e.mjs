// node scripts/fullscreen-state-e2e.mjs [isolated Vite URL]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1400,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.argv[2]||'http://127.0.0.1:3072',{waitUntil:'domcontentloaded',timeout:90000});
 await page.locator('[data-tab="view"]').click({timeout:90000});
 await page.evaluate(async()=>{
  window.fullscreenTest=await import('/js/ui/chrome/fullscreen.js');
  window.originalRequestFullscreen=document.documentElement.requestFullscreen;
  document.documentElement.requestFullscreen=()=>Promise.reject(new DOMException('Permission denied','NotAllowedError'));
 });
 const button=page.locator('#ribbon-fullscreen');
 assert.match(await button.getAttribute('title'), /Ctrl\+L/);
 assert.doesNotMatch(await button.getAttribute('title'), /F11/);
 const state=()=>page.evaluate(async()=>({actual:!!document.fullscreenElement,stored:(await import('/js/ui/chrome/fullscreen.js')).getFullscreenState()}));
 await button.click();
 assert.deepEqual(await state(),{actual:false,stored:false},'Rejected request must not activate the ribbon');
 await button.click();
 assert.deepEqual(await state(),{actual:false,stored:false},'Repeated denied request must not get stuck');
 await page.evaluate(()=>{document.documentElement.requestFullscreen=undefined;});
 await button.click();
 assert.deepEqual(await state(),{actual:false,stored:false},'Unsupported API must stay inactive');
 await page.evaluate(()=>{document.documentElement.requestFullscreen=window.originalRequestFullscreen;});
 await button.click();
 await page.waitForFunction(()=>!!document.fullscreenElement && window.fullscreenTest.getFullscreenState());
 assert.deepEqual(await state(),{actual:true,stored:true},'Successful request activates the ribbon');
 await page.evaluate(()=>{window.originalExitFullscreen=document.exitFullscreen;document.exitFullscreen=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));});
 assert.equal(await page.evaluate(async()=>(await import('/js/ui/chrome/fullscreen.js')).exitFullscreen()),false,'Denied exit is not reported as successful');
 assert.deepEqual(await state(),{actual:true,stored:true});
 await page.evaluate(()=>{document.exitFullscreen=window.originalExitFullscreen;});
 await button.click();await page.waitForFunction(()=>!document.fullscreenElement && !window.fullscreenTest.getFullscreenState());
 assert.deepEqual(await state(),{actual:false,stored:false});
 await button.click();await page.waitForFunction(()=>!!document.fullscreenElement && window.fullscreenTest.getFullscreenState());
 await page.evaluate(()=>document.exitFullscreen());
 await page.waitForFunction(()=>!window.fullscreenTest.getFullscreenState());
 assert.deepEqual(await state(),{actual:false,stored:false},'Native fullscreenchange resets the ribbon');
 await page.evaluate(async()=>{
  const fs=await import('/js/ui/chrome/fullscreen.js');
  let actual=false,deny=true;
  window.__TAURI__={window:{getCurrentWindow:()=>({isFullscreen:async()=>actual,setFullscreen:async value=>{if(deny)throw Error('Window refused');actual=value;}})}};
  try {
   if(await fs.toggleFullscreen() || fs.getFullscreenState())throw Error('Denied native request activated ribbon');
   deny=false;if(!await fs.toggleFullscreen() || !fs.getFullscreenState())throw Error('Native enter failed');
   deny=true;if(await fs.exitFullscreen() || !fs.getFullscreenState())throw Error('Denied native exit deactivated ribbon');
   deny=false;if(!await fs.exitFullscreen() || fs.getFullscreenState())throw Error('Native exit failed');
  } finally {delete window.__TAURI__;}
 });
 assert.deepEqual(errors,[]);
 console.log('Fullscreen: denied, repeated, unavailable API, successful enter/exit, denied exit and external fullscreenchange passed.');
} finally {await browser.close();}
