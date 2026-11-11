import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { PDFDocument, rgb } from 'pdf-lib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const cache=await mkdtemp(path.join(tmpdir(),'opds-rotation-'));
const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),cacheDir:cache,logLevel:'error',server:{host:'127.0.0.1',port:18037,strictPort:false,hmr:false}});
let browser;
try {
 await server.listen();browser=await chromium.launch({headless:true});
 const pdf=await PDFDocument.create(); const sheet=pdf.addPage([600,800]);sheet.drawRectangle({x:0,y:0,width:600,height:800,color:rgb(0.8,0.1,0.1)});sheet.drawText('ROTATE',{x:100,y:400,size:48});
 const bytes=[...await pdf.save()];
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 page.on('pageerror',e=>console.log('PAGEERROR',e.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`,{timeout:120000});await page.waitForSelector('#tool-select',{timeout:120000});
 await page.evaluate(async bytes=>{const {createTab}=await import('/js/ui/chrome/tabs.js');const {loadPDF}=await import('/js/pdf/loader.js');const {index}=createTab('rotation.pdf');await loadPDF('rotation.pdf',index,new Uint8Array(bytes));},bytes);
 for(const mode of ['single','continuous']) {
  await page.evaluate(async mode=>{await(await import('/js/pdf/renderer.js')).setViewMode(mode)},mode);
  for(const delta of [90,-90,180,90,-90,-180]) {
   const result = await page.evaluate(async delta=>{
    await(await import('/js/pdf/pagina-draaien.js')).draaiPaginas(delta,[1]);await new Promise(r=>setTimeout(r,350));
    const {state,getPageRotation}=await import('/js/core/state.ts');const canvas=state.documents[0].viewMode==='single'?document.getElementById('pdf-canvas'):document.querySelector('.page-wrapper canvas');
    const d=canvas.getContext('2d').getImageData(Math.floor(canvas.width/3),Math.floor(canvas.height/3),1,1).data;
    return {mode:state.documents[0].viewMode,rotation:getPageRotation(1),pixel:[...d],size:[canvas.width,canvas.height]};
   },delta);
   assert.deepEqual(result.pixel, [204,26,26,255], JSON.stringify(result));
   console.log(`PASS PDF.js ${mode} rotation ${result.rotation}`);
  }
 }

 // OS services alone are mocked. The real scheduler, caches, tile routing,
 // orchestrator and canvas viewport still run. Native region rendering
 // rejects nonzero user rotation; native whole-page rendering supports it.
 await page.evaluate(async()=>{
  const {state}=await import('/js/core/state.ts');
  state.preferences.progressiveRender=true;
  window.nativeTest = { calls: [], mode: 'fail' };
  const rgba = () => {
   const out=new Uint8Array(8+32*32*4), h=new DataView(out.buffer);
   h.setUint32(0,32,true);h.setUint32(4,32,true);
   for(let i=8;i<out.length;i+=4){out[i]=200;out[i+1]=25;out[i+2]=25;out[i+3]=255;}
   return out;
  };
  window.__TAURI__={core:{invoke:async(cmd,args)=>{
   const t=window.nativeTest;t.calls.push({cmd,...args});
   if(cmd==='page_content_size')return 9000000;
   if(cmd==='render_tile_scene_region')throw new Error('scene rejected');
   if(cmd==='render_pdf_page_region') {
    if(t.mode==='success') return rgba();
    if(t.mode==='cancel') { const e=new Error('cancelled');e.renderCancelled=true;throw e; }
    throw new Error('rotation not yet supported (only 0 is implemented)');
   }
   if(cmd==='render_pdf_page') {
    const {viewport}=await import('/js/pdf/pdf-viewport.js');
    if(t.mode==='stale-rotation') viewport.rotation=180;
    if(t.mode==='stale-page') viewport.pageNum=2;
    if(t.mode==='stale-document') viewport.filePath='other.pdf';
    if(t.mode==='inactive') viewport.active=false;
    if(t.mode==='stale-engine') viewport.pageType='vector';
    if(t.mode==='fail-whole') throw new Error('whole-page render failed');
    if(t.mode==='newer-bitmap') viewport.currentBitmap=t.kept;
    return rgba();
   }
   throw new Error('Unmocked: '+cmd);
  }}};
  await(await import('/js/pdf/renderer.js')).setViewMode('single');
  await new Promise(r=>setTimeout(r,600));
 });
 const cases = [
  ...[0,90,180,270].map(rotation=>({mode:'fail',rotation})),
  ...['success','cancel','stale-rotation','stale-page','stale-document','inactive','stale-engine','fail-whole','newer-bitmap','existing-bitmap'].map(mode=>({mode,rotation:90})),
 ];
 for(const item of cases) {
  const result=await page.evaluate(async item=>{
   const {viewport}=await import('/js/pdf/pdf-viewport.js');
   const {state}=await import('/js/core/state.ts');
   const orch=await import('/js/pdf/bitmap-orchestrator.js');
   const path=`rotation-${item.mode}-${item.rotation}.pdf`;
   state.documents[state.activeDocumentIndex].filePath=path;
   Object.assign(viewport,{active:true,filePath:path,pageNum:1,pageW:600,pageH:800,rotation:item.rotation,viewRotation:0,zoom:8,offsetX:0,offsetY:0,pageType:'raster',currentBitmap:null,currentTile:null,currentTileMeta:null});
   const t=window.nativeTest;Object.assign(t,{mode:item.mode,calls:[]});
   t.kept=await createImageBitmap(new ImageData(new Uint8ClampedArray([0,0,255,255]),1,1));
   if(item.mode==='existing-bitmap')viewport.currentBitmap=t.kept;
   await orch.ensureBitmapForCurrentView();
   await orch.ensureTileForCurrentView(document.getElementById('pdf-canvas'));
   const bitmap=viewport.currentBitmap;
   let pixel=null;
   if(bitmap) {const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0,1,1);pixel=[...ctx.getImageData(0,0,1,1).data];}
   return {bitmap:!!bitmap,tile:!!viewport.currentTile,pixel,kept:bitmap===t.kept,calls:t.calls};
  },item);
  const whole=result.calls.filter(c=>c.cmd==='render_pdf_page');
  const needsWhole=!['success','cancel','existing-bitmap'].includes(item.mode);
  assert.equal(whole.length,needsWhole?1:0,JSON.stringify({item,result}));
  if(needsWhole) {
   assert.equal(whole[0].rotation,item.rotation);
   assert.ok(whole[0].scale*800<=4096,'fallback stays within whole-page pixel cap');
  }
  if(item.mode==='fail') {
   assert.ok(result.bitmap,'tile failure must recover a whole-page bitmap');
   assert.deepEqual(result.pixel,[200,25,25,255]);
  } else if(item.mode==='success') assert.ok(result.tile);
  else if(['newer-bitmap','existing-bitmap'].includes(item.mode)) assert.ok(result.kept);
  else assert.equal(result.bitmap,false,'cancelled/stale/failed result must not paint');
  console.log(`PASS native tile recovery ${item.mode} rotation ${item.rotation}`);
 }
} finally {await browser?.close();await server.close();await rm(cache,{recursive:true,force:true});}
