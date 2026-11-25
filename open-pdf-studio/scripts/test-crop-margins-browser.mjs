// #1264: echte PDF.js-weergave, bijsnijdialoog, undo/redo en opslag-rondgang.
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, rgb, degrees } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const cache=await mkdtemp(path.join(tmpdir(),'opds-crop-margins-'));
const server=await createServer({root,cacheDir:cache,logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false}});let browser;
const closeTo=(a,b,label)=>assert.ok(a.every((v,i)=>Math.abs(v-b[i])<.6),`${label}: ${a} != ${b}`);
try {
 await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1400,height:1000}});
 await page.addInitScript(()=>localStorage.setItem('opds:pdfEditorPreferences',JSON.stringify({language:'en'})));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{timeout:120000});await page.waitForSelector('#tool-select',{timeout:120000});
 for (const [rotation,userUnit,extraRotation] of [[0,1,0],[90,1,0],[180,1,0],[270,1,0],[90,2,0],[0,1,90]]) {
  const pdf=await PDFDocument.create();const p=pdf.addPage([600,400]);p.setMediaBox(-20,-30,600,400);p.setCropBox(100,50,400,300);p.setRotation(degrees(rotation));p.node.set(PDFName.of('UserUnit'),pdf.context.obj(userUnit));
  p.drawRectangle({x:150,y:100,width:200,height:100,color:rgb(0,0,0)});
  const original=await page.evaluate(async({data,rotation,extraRotation,userUnit})=>{
   const {createTab}=await import('/js/ui/chrome/tabs.js');const {loadPDF}=await import('/js/pdf/loader.js');window.cropDoc=(await import('/js/core/state.ts')).getActiveDocument;
   const file=`/crop-${rotation}-${userUnit}-${extraRotation}.pdf`;const {index}=createTab(file);await loadPDF(file,index,new Uint8Array(data));
   const d=window.cropDoc();d.pageRotations[1]=extraRotation;
   const p=await d.pdfDoc.getPage(1);const vp=p.getViewport({scale:1,rotation:(rotation+extraRotation)%360});
   const r=[...vp.convertToViewportPoint(175,125),...vp.convertToViewportPoint(205,145)];
   const {createAnnotation}=await import('/js/annotations/factory.js');
   d.annotations.push(createAnnotation({id:'crop-marker',type:'box',page:1,x:Math.min(r[0],r[2]),y:Math.min(r[1],r[3]),width:Math.abs(r[2]-r[0]),height:Math.abs(r[3]-r[1]),strokeColor:'#ff0000',lineWidth:1}));
   d.annotations.push(createAnnotation({id:'crop-callout',type:'callout',page:1,
    x:Math.min(r[0],r[2]),y:Math.min(r[1],r[3]),width:10,height:10,
    arrowX:r[0],arrowY:r[1],kneeX:r[2],kneeY:r[3],armOriginX:r[0],armOriginY:r[3],locked:true}));
   window.cropInfo=async()=>{
    const doc=window.cropDoc(),pg=await doc.pdfDoc.getPage(1),v=pg.getViewport({scale:1,rotation:(pg.rotate+(doc.pageRotations[1]||0))%360});
    const a=doc.annotations.find(a=>a.type==='box');
    const callout=doc.annotations.find(a=>a.type==='callout');
    const anchors=callout?['arrow','knee','armOrigin'].flatMap(k=>v.convertToPdfPoint(callout[k+'X'],callout[k+'Y'])):null;
    return{view:pg.view,anchors,marker:a?[...v.convertToPdfPoint(a.x,a.y),...v.convertToPdfPoint(a.x+a.width,a.y+a.height)]:null};
   };
   return window.cropInfo();
  },{data:[...await pdf.save()],rotation,extraRotation,userUnit});
  // De eerste casus loopt via de werkelijke lintknop en dialoog.
  if(rotation===0&&userUnit===1&&!extraRotation){
   await page.evaluate(async()=>{window.beforeCropPdf=window.cropDoc().pdfDoc;(await import('/js/solid/stores/ribbonStore.js')).setActiveTab('organize');});
   await page.locator('#ep-crop-margins').click();
   await page.locator('.crop-margins-dialog .pref-btn-primary').click();
   await page.waitForFunction(()=>window.cropDoc().pdfDoc!==window.beforeCropPdf&&window.cropDoc().undoStack.some(c=>c.type==='pageStructure'),null,{timeout:120000});
  } else await page.evaluate(async()=>{await(await import('/js/pdf/crop-margins.js')).cropMargins('current','',0,250);});
  const first=await page.evaluate(()=>window.cropInfo());closeTo(first.view,[150,100,350,200],'cropped view');closeTo(first.marker,original.marker,'annotation stays on PDF content');closeTo(first.anchors,original.anchors,'locked callout anchors');
  await page.evaluate(async()=>{await(await import('/js/core/undo-manager.js')).undo();});
  const undone=await page.evaluate(()=>window.cropInfo());closeTo(undone.view,original.view,'undo view');closeTo(undone.marker,original.marker,'undo marker');closeTo(undone.anchors,original.anchors,'undo callout anchors');
  await page.evaluate(async()=>{await(await import('/js/core/undo-manager.js')).redo();});
  await page.evaluate(async()=>{await(await import('/js/pdf/crop-margins.js')).cropMargins('current','',0,250);});
  const twice=await page.evaluate(()=>window.cropInfo());closeTo(twice.view,first.view,'repeat must not expand');closeTo(twice.marker,original.marker,'repeat marker');closeTo(twice.anchors,original.anchors,'repeat callout anchors');
  await page.evaluate(async()=>{
   // De ronde hieronder is voor de rechthoek; pijlpunt/knik zijn hierboven getest.
   window.cropDoc().annotations=window.cropDoc().annotations.filter(a=>a.type==='box');
   const saved=await(await import('/js/pdf/saver.js')).bouwMomentopname(window.cropDoc());
   const file='/crop-reopened-'+window.cropDoc().id+'.pdf';const {index}=(await import('/js/ui/chrome/tabs.js')).createTab(file);
   await(await import('/js/pdf/loader.js')).loadPDF(file,index,saved.slice());
  });
  const reopened=await page.evaluate(()=>window.cropInfo());closeTo(reopened.view,first.view,'saved crop');closeTo(reopened.marker,original.marker,'saved marker');
 }
 console.log('PASS: actual Crop dialog, existing CropBox, nonzero MediaBox origin, all rotations, UserUnit, app rotation, annotation position and locked callout anchors, repeated crop, undo/redo, real save/reopen');
}finally{await browser?.close();await server.close();await rm(cache,{recursive:true,force:true});}
