import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {PDFDocument,PDFName,PDFString} from 'pdf-lib';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const cache=await mkdtemp(path.join(tmpdir(),'opds-central-pdf-'));
const server=await createServer({root,cacheDir:cache,logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false}});
let browser;
try{
 const pdf=await PDFDocument.create(),page=pdf.addPage([300,300]);
 const note=pdf.context.obj({Type:'Annot',Subtype:'Text',Rect:[30,230,50,250],Contents:PDFString.of('Original'),NM:PDFString.of('base-note')});
 const removed=pdf.context.obj({Type:'Annot',Subtype:'Text',Rect:[60,230,80,250],Contents:PDFString.of('Remove me'),NM:PDFString.of('base-remove')});
 page.node.set(PDFName.of('Annots'),pdf.context.obj([pdf.context.register(note),pdf.context.register(removed)]));
 const source=Array.from(await pdf.save());
 await server.listen();browser=await chromium.launch({headless:true});const tab=await browser.newPage({viewport:{width:1100,height:850}});
 const errors=[];tab.on('pageerror',e=>errors.push(e.message));
 await tab.goto(`http://127.0.0.1:${server.httpServer.address().port}/`,{timeout:120000});await tab.waitForSelector('#tool-select',{timeout:120000});
 const opened=await tab.evaluate(async source=>{
  const {state}=await import('/js/core/state.ts');
  const {createTab,closeTab,markDocumentModified}=await import('/js/ui/chrome/tabs.js');
  const {loadPDF,getCachedPdfBytes}=await import('/js/pdf/loader.js');
  const {redrawAnnotations}=await import('/js/annotations/rendering.js');
  const {createCentralPdfAdapter}=await import('/js/review/central-review-pdf-adapter.js');
  const {createCentralReviewOpening}=await import('/js/review/central-review-opening.js');
  const {isAlleenLezen}=await import('/js/pdf/wachtwoord-pdf.js');
  let active=true;
  const lease={isCurrent:()=>active,dispose:async()=>{active=false;},download:async()=>new Uint8Array(source),
    snapshot:async()=>({cursor:2,annotations:[{id:'base-remove',base:'e2',data:null},{id:'shared-box',base:'e1',data:{id:'shared-box',type:'box',page:1,x:80,y:80,width:100,height:60,color:'#ff0000',lineWidth:2,opacity:100}}]}),
    events:async()=>({events:[],cursor:2,head:2,hasMore:false})};
  const adapter=createCentralPdfAdapter('Review snapshot.pdf',{
    createFile:async()=>'/central-snapshot-test.pdf',removeFile:async()=>{},
    createTab:path=>state.documents[createTab(path).index],contains:doc=>state.documents.includes(doc),
    close:doc=>closeTab(state.documents.indexOf(doc),true),
    load:(doc,path,bytes)=>loadPDF(path,state.documents.indexOf(doc),bytes),annotationsReady:doc=>doc._annotationCompletion,
    modified:markDocumentModified,redraw:()=>redrawAnnotations(),
  });
  const opening=createCentralReviewOpening({retain:()=>lease},'1'.repeat(32),adapter);
  const {resource}=await opening.open();await opening.detach();
  window.snapshotTest={doc:resource.doc,opening};
  return {count:resource.doc.annotations.length,names:resource.doc.annotations.map(a=>a.nm),modified:resource.doc.modified,
    untitled:resource.doc.isUntitled,readOnly:isAlleenLezen(resource.doc),cached:getCachedPdfBytes(resource.doc.filePath).length,
    pages:resource.doc._annotationPagesReady.size,connected:active};
 },source);
 assert.equal(opened.count,2);assert.ok(opened.names.includes('base-note'));assert.ok(opened.names.includes('shared-box'));
 assert.equal(opened.modified,true);assert.equal(opened.untitled,true);assert.equal(opened.readOnly,false);assert.ok(opened.cached>100);assert.equal(opened.pages,1);assert.equal(opened.connected,false);
 if(process.env.OPDS_REVIEW_SCREENSHOT)await tab.screenshot({path:process.env.OPDS_REVIEW_SCREENSHOT});
 const exported=await tab.evaluate(async()=>{
  const doc=window.snapshotTest.doc;
  const {annotationsToXfdf,parseXfdfAnnotations}=await import('/js/annotations/xfdf.js');
  const xml=annotationsToXfdf(doc.annotations,{doc,fileName:'Review snapshot.pdf',names:true});
  const roundtrip=parseXfdfAnnotations(xml);
  const {savePDF}=await import('/js/pdf/saver.js');const saved=await savePDF('/central-export.pdf',{zonderHandtekeningVraag:true},doc);
  const {getCachedPdfBytes}=await import('/js/pdf/loader.js');
  const bytes=getCachedPdfBytes('/central-export.pdf');
  await window.snapshotTest.opening.close();
  const {state}=await import('/js/core/state.ts');
  return{saved,bytes:bytes?Array.from(bytes):[],xfdf:roundtrip.map(a=>a.id),preserved:state.documents.includes(doc)};
 });
 assert.equal(exported.saved,true);assert.equal(exported.preserved,true);assert.equal(exported.xfdf.length,2);
 const saved=await PDFDocument.load(new Uint8Array(exported.bytes));const annots=saved.getPage(0).node.Annots();
 const names=Array.from({length:annots.size()},(_,i)=>annots.lookup(i).get(PDFName.of('NM'))?.decodeText());
 assert.ok(names.includes('base-note'));assert.ok(names.includes('shared-box'));assert.ok(!names.includes('base-remove'));assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS: real PDF load/render + baseline/shared annotations, source cache, detached local tab, PDF and XFDF export');
}finally{await browser?.close();await server.close();await rm(cache,{recursive:true,force:true});}
