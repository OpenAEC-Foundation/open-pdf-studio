import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const cacheDir = await mkdtemp(join(tmpdir(), 'opds-window-clipboard-'));
const server = await createServer({ cacheDir, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
let browser;
let broker;
let nativeExchanges=0;
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  context.setDefaultNavigationTimeout(90000);
  const probe=process.env.NATIVE_CLIPBOARD_PROBE;
  if (probe) {
    broker=spawn(probe,['server'],{stdio:['ignore','pipe','inherit']});
    const address=await new Promise((resolve,reject)=>{
      const lines=createInterface({input:broker.stdout});lines.once('line',line=>{lines.close();resolve(line);});broker.once('error',reject);
    });
    await context.exposeFunction('nativeClipboard',(command,args)=>new Promise((resolve,reject)=>{
      assert.equal(command,'exchange_annotation_clipboard');
      nativeExchanges++;
      const client=spawn(probe,['client',address],{stdio:['pipe','pipe','pipe']});let out='',err='';
      client.stdout.on('data',d=>out+=d);client.stderr.on('data',d=>err+=d);client.once('error',reject);
      client.once('exit',code=>{if(code)reject(Error(err));else{try{resolve(JSON.parse(out));}catch(e){reject(e);}}});
      client.stdin.end(JSON.stringify(args));
    }));
    // Exercise the production JS native adapter and real Rust IPC without
    // pretending the browser has Tauri filesystem/window APIs.
    await context.route('**/js/annotations/window-clipboard.js',async route=>{
      const response=await route.fetch(),text=await response.text();
      assert.ok(text.includes('window.__TAURI__?.core?.invoke'));
      await route.fulfill({response,body:text.replace('window.__TAURI__?.core?.invoke','window.nativeClipboard')});
    });
  }
  const pdf = await PDFDocument.create(); pdf.addPage([600,800]); const bytes = [...await pdf.save()];
  async function open() {
    const page = await context.newPage(); await page.goto(server.resolvedUrls.local[0]);
    await page.locator('[data-tab="drawing"]').waitFor({ timeout: 90000 });
    await page.evaluate(async bytes => {
      const { cacheWebFile } = await import('/js/core/platform.js');
      const { createTab } = await import('/js/ui/chrome/tabs.js');
      const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
      cacheWebFile('clipboard.pdf',new Uint8Array(bytes));const {index}=createTab('clipboard.pdf');await loadPDFIfNeeded('clipboard.pdf',index);
      window.clipTest={...(await import('/js/annotations/clipboard.js')),...(await import('/js/core/state.ts'))};
    },bytes);return page;
  }
  const a=await open(),b=await open();
  await a.evaluate(()=>clipTest.copyAnnotation({id:'source-line',type:'line',page:1,startX:10,startY:20,endX:100,endY:110,color:'#123456',lineWidth:2}));
  await b.waitForFunction(()=>clipTest.state.clipboardAnnotation?.id==='source-line',{},{timeout:5000});
  await b.evaluate(()=>clipTest.pasteAnnotation({bijMuis:false}));
  const pasted=await b.evaluate(()=>clipTest.getActiveDocument().annotations.at(-1));
  assert.equal(pasted.type,'line');assert.equal(pasted.color,'#123456');assert.notEqual(pasted.id,'source-line');
  console.log('PASS editable line copied between separate windows');
  await b.evaluate(async()=>{await (await import('/js/core/undo-manager.js')).undo();});
  assert.equal(await b.evaluate(()=>clipTest.getActiveDocument().annotations.length),0);
  await b.evaluate(async()=>{await (await import('/js/core/undo-manager.js')).redo();});
  assert.equal(await b.evaluate(()=>clipTest.getActiveDocument().annotations.length),1);
  console.log('PASS destination undo and redo retain the copied annotation');
  await b.evaluate(()=>clipTest.copyAnnotations([
    {id:'group-a',type:'line',page:1,startX:10,startY:10,endX:30,endY:30,color:'#000000',lineWidth:1},
    {id:'group-b',type:'line',page:1,startX:40,startY:50,endX:60,endY:70,color:'#000000',lineWidth:1},
  ]));
  await a.waitForFunction(()=>clipTest.state.clipboardAnnotations?.[1]?.id==='group-b');
  await a.evaluate(()=>document.activeElement?.blur()); await a.keyboard.press('Control+v');
  await a.waitForFunction(()=>clipTest.getActiveDocument().annotations.length===2);
  const group=await a.evaluate(()=>clipTest.getActiveDocument().annotations.map(x=>({id:x.id,startX:x.startX,startY:x.startY})));
  assert.equal(group[1].startX-group[0].startX,30);assert.equal(group[1].startY-group[0].startY,40);
  assert.ok(group.every(x=>!x.id.startsWith('group-')));
  console.log('PASS group copy in reverse direction uses Ctrl+V and preserves relative positions');
  const c=await open();
  await c.waitForFunction(()=>clipTest.state.clipboardAnnotations?.[1]?.id==='group-b');
  await c.evaluate(()=>clipTest.pasteAnnotationsInPlace());
  assert.deepEqual(await c.evaluate(()=>clipTest.getActiveDocument().annotations.map(x=>[x.startX,x.startY])),[[10,10],[40,50]]);
  console.log('PASS newly opened window requests latest copy and pastes in place');
  await a.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,4,4);
    const img=new Image();img.src=canvas.toDataURL();await img.decode();clipTest.imageCache.set('only-source-cache',img);
    clipTest.copyAnnotation({id:'image-source',type:'image',page:1,x:20,y:20,width:40,height:40,imageId:'only-source-cache'});
  });
  await b.waitForFunction(()=>clipTest.state.clipboardAnnotation?.id==='image-source');
  await c.waitForFunction(()=>clipTest.state.clipboardAnnotation?.id==='image-source');
  await a.close();
  await b.evaluate(()=>clipTest.pasteAnnotation({bijMuis:false}));
  const image=await b.evaluate(()=>{
    const a=clipTest.getActiveDocument().annotations.at(-1),img=clipTest.imageCache.get(a.imageId);
    const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
    return {id:a.imageId,data:a.imageData,pixel:[...ctx.getImageData(1,1,1,1).data]};
  });
  assert.notEqual(image.id,'only-source-cache');assert.ok(image.data.startsWith('data:image/png;'));assert.deepEqual(image.pixel,[255,0,0,255]);
  console.log('PASS cache-only image pixels survive source close with independent cache IDs');
  await b.evaluate(async()=>{
    const h=await import('/js/annotations/clipboard-history.js');h.useClipboardHistoryItem(h.clipboardHistory()[0].id);
  });
  await c.waitForFunction(()=>clipTest.state.clipboardAnnotations?.[1]?.id==='group-b');
  console.log('PASS choosing a saved clipboard item updates other windows');
  const before=await c.evaluate(()=>clipTest.getActiveDocument().annotations.length);
  await c.evaluate(()=>{const d=clipTest.getActiveDocument();d.pdfaCompliance='PDF/A-1B';d.pdfADismissed=false;document.activeElement?.blur();});
  await c.keyboard.press('Control+v');
  assert.equal(await c.evaluate(()=>clipTest.getActiveDocument().annotations.length),before);
  const prevented=await b.evaluate(()=>{
    const input=document.createElement('input');document.body.append(input);input.focus();
    const data=new DataTransfer();data.setData('text/plain','outside text');
    const e=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});input.dispatchEvent(e);input.remove();return e.defaultPrevented;
  });
  assert.equal(prevented,false);
  console.log('PASS read-only destination and text-input paste guards remain effective');
  if (probe) { assert.ok(nativeExchanges>5); console.log('Native broker exchanges:',nativeExchanges); }
} finally { await browser?.close(); broker?.kill(); await server.close(); await rm(cacheDir,{recursive:true,force:true}); }
