import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, PDFNumber, degrees } from 'pdf-lib';
const pdf=await PDFDocument.create();
for (const rotation of [0,90,180,270]) {
  const page=pdf.addPage([700,900]);page.setCropBox(40,50,400,600);page.setRotation(degrees(rotation));
  page.node.set(PDFName.of('UserUnit'),PDFNumber.of(2));
}
const bytes=[...await pdf.save()];const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1800,height:1100}});
 await page.goto(process.argv[2]||'http://127.0.0.1:32868',{waitUntil:'domcontentloaded',timeout:90000});
 await page.locator('[data-tab="view"]').waitFor({timeout:90000});
 await page.evaluate(async bytes=>{
   const {cacheWebFile}=await import('/js/core/platform.js');const {createTab}=await import('/js/ui/chrome/tabs.js');
   const {loadPDFIfNeeded}=await import('/js/pdf/loader.js');const {getActiveDocument}=await import('/js/core/state.ts');
   const {createAnnotation}=await import('/js/annotations/factory.js');
   cacheWebFile('align.pdf',new Uint8Array(bytes));const {index}=createTab('align.pdf');await loadPDFIfNeeded('align.pdf',index);
   const doc=getActiveDocument();
   const make=(x,y,page=1)=>createAnnotation({type:'box',page,x,y,width:40,height:30,lineWidth:0});
   const a=make(20,60);doc.annotations.push(a);doc.selectedAnnotations=[doc.annotations.at(-1)];doc.selectedAnnotation=doc.selectedAnnotations[0];
   window.alignTest={doc,make,getActiveDocument};
 },bytes);
 await page.locator('[data-tab="arrange"]').click();await page.locator('#arr-align-to').click();
 assert.equal(await page.locator('[data-align-target="page"]').count(),1,'page alignment is available');
 await page.locator('[data-align-target="page"]').click();await page.locator('#arr-align-center').click();
 await page.waitForFunction(()=>Math.abs(window.alignTest.doc.annotations[0].x-180)<1e-6);
 console.log('ribbon single alignment passed');
 const results=await page.evaluate(async()=>{
   const {doc,make}=window.alignTest;const a=await import('/js/annotations/alignment.js');
   const {undo,redo}=await import('/js/core/undo-manager.js');
   const {annotationBounds}=await import('/js/annotations/spatial-index.js');
   const {rectNaarWeergave,weergaveMaat}=await import('/js/pdf/weergave-rotatie.js');
   const checks=[];const near=(x,y)=>{if(Math.abs(x-y)>1e-6)throw Error(`${x} != ${y}`);};
   await undo();near(doc.annotations[0].x,20);await redo();near(doc.annotations[0].x,180);
   for(let n=1;n<=4;n++)for(const view of [0,90,180,270]) {
     doc.viewRotation=view;const p=await doc.pdfDoc.getPage(n);const vp=p.getViewport({scale:1/p.userUnit});
     for(const [name,edge] of [['alignLeft','left'],['alignCenter','center'],['alignRight','right'],['alignTop','top'],['alignMiddle','middle'],['alignBottom','bottom']]) {
       doc.annotations=[make(-20,70,n),make(110,160,n)];doc.selectedAnnotations=[...doc.annotations];doc.selectedAnnotation=doc.annotations[0];
       const old=doc.annotations.map(x=>({x:x.x,y:x.y}));a.setAlignTarget('page');await a[name]();
       near(doc.annotations[1].x-doc.annotations[0].x,130);near(doc.annotations[1].y-doc.annotations[0].y,90);
       const b=doc.annotations.map(x=>rectNaarWeergave(annotationBounds(x),vp.width,vp.height,view));const size=weergaveMaat(vp.width,vp.height,view);
       const l=Math.min(...b.map(x=>x.x)),r=Math.max(...b.map(x=>x.x+x.width)),t=Math.min(...b.map(x=>x.y)),bottom=Math.max(...b.map(x=>x.y+x.height));
       near(({left:l,center:(l+r)/2,right:r,top:t,middle:(t+bottom)/2,bottom})[edge],({left:0,center:size.breedte/2,right:size.breedte,top:0,middle:size.hoogte/2,bottom:size.hoogte})[edge]);
       await undo();doc.annotations.forEach((x,i)=>{near(x.x,old[i].x);near(x.y,old[i].y);});
     }
     checks.push([n,view]);
   }
   doc.viewRotation=0;doc.annotations=[make(30,50),make(110,160)];doc.selectedAnnotations=[...doc.annotations];doc.selectedAnnotation=doc.annotations[0];
   a.setAlignTarget('page-each');await a.alignLeft();doc.annotations.forEach(x=>near(annotationBounds(x).x,0));await undo();
   a.setAlignTarget('selection');await a.alignLeft();near(doc.annotations[0].x,30);near(doc.annotations[1].x,30);await undo();
   a.setAlignTarget('last');await a.alignLeft();near(doc.annotations[0].x,110);near(doc.annotations[1].x,110);await undo();
   a.setAlignTarget('page');doc.annotations[0].locked=true;await a.alignLeft();near(doc.annotations[0].x,30);near(doc.annotations[1].x,110);doc.annotations[0].locked=false;
   doc.pdfaCompliance='PDF/A-2b';doc.pdfADismissed=false;await a.alignLeft();near(doc.annotations[0].x,30);doc.pdfADismissed=true;
   // Separate pages use their own visible dimensions, but undo together.
   doc.annotations=[make(30,50,1),make(110,160,2)];doc.selectedAnnotations=[...doc.annotations];doc.selectedAnnotation=doc.annotations[0];
   await a.alignRight();near(doc.annotations[0].x,360);near(doc.annotations[1].x,560);await undo();near(doc.annotations[0].x,30);near(doc.annotations[1].x,110);
   doc.pageRotations[1]=90;doc.selectedAnnotations=[doc.annotations[0]];await a.alignRight();near(doc.annotations[0].x,560);await undo();doc.pageRotations[1]=0;
   doc.selectedAnnotations=[...doc.annotations];
   // A queued dimension lookup must not mutate a selection changed meanwhile.
   doc.selectedAnnotations=[doc.annotations[0]];doc.selectedAnnotation=doc.annotations[0];
   const real=doc.pdfDoc.getPage.bind(doc.pdfDoc);let release, delayed=false;
   doc.pdfDoc.getPage=n=>{if(delayed)return real(n);delayed=true;return new Promise(resolve=>{release=()=>resolve(real(n));});};
   const pending=a.alignLeft();doc.selectedAnnotations=[];doc.selectedAnnotation=null;release();try {await Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(Error('stale selection timeout')),5000))]);} finally {doc.pdfDoc.getPage=real;}near(doc.annotations[0].x,30);
   return checks;
 });
 assert.equal(results.length,16);
 console.log('PASS ribbon single selection; 96 real-PDF group alignments across /Rotate and view rotations, CropBox/UserUnit, undo, individual/selection/last modes, lock/read-only and stale selection guards');
} finally {await browser.close();}
