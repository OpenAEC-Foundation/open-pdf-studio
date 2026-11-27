import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralPdfAdapter} from './central-review-pdf-adapter.js';
import {isAlleenLezen} from '../pdf/wachtwoord-pdf.js';
const bytes=new TextEncoder().encode('%PDF-test');
const ann=(id,text='original')=>({id,type:'textbox',page:1,text});
function rig(){
  const state={present:true,removed:[],closed:0,redraw:0};
  const doc={annotations:[ann('local-a'),ann('local-b')],_annotationLoadId:0,_annotationPagesReady:new Set(),_pagesNeedingColorUpdate:new Set()};
  const io={createFile:async()=>'/own/unique.pdf',createTab:()=>doc,contains:()=>state.present,
    close:async()=>{state.present=false;state.closed++;},removeFile:async path=>state.removed.push(path),
    load:async(_,path,data)=>{assert.equal(path,'/own/unique.pdf');data[0]=0;doc.pdfDoc={numPages:1};doc._annotationLoadId++;},
    annotationsReady:async()=>doc._annotationPagesReady.add(1),modified:()=>{doc.modified=true;},redraw:()=>state.redraw++};
  return{state,doc,io,adapter:createCentralPdfAdapter('Drawing.pdf',io)};
}
test('snapshot updates/deletes PDF annotations by stable ID and adds shared annotations',async()=>{
 const{doc,adapter,state}=rig();const r=await adapter.open(bytes);
 assert.equal(isAlleenLezen(doc),true);await r.ready();assert.equal(bytes[0],37);
 r.install({annotations:[{id:'pdf:1:0',base:'e1',data:ann('pdf:1:0','changed')},{id:'pdf:1:1',base:'e2',data:null},{id:'shared',base:'e3',data:ann('shared','new')}]});
 assert.equal(doc.isUntitled,true);assert.equal(doc.modified,true);assert.equal(isAlleenLezen(doc),false);
 assert.deepEqual(doc.annotations.map(a=>[a.id,a.nm,a.text]),[['local-a','pdf:1:0','changed'],['shared','shared','new']]);
 assert.equal(state.redraw,1);await r.dispose();await r.dispose();assert.equal(state.closed,1);
});
test('cancellation during file creation removes the new file without creating a tab',async()=>{
 const{adapter,state,io}=rig();let allowed=true;io.createFile=async()=>{allowed=false;return'/own/unique.pdf';};
 io.createTab=()=>{throw new Error('must not create a tab');};
 await assert.rejects(adapter.open(bytes,()=>allowed),/STALE/);assert.deepEqual(state.removed,['/own/unique.pdf']);assert.equal(state.closed,0);
});
test('reload/close during annotation readiness refuses to install an outdated snapshot',async()=>{
 for(const mode of ['reload','close']){
  const{adapter,io,doc,state}=rig();io.annotationsReady=async()=>{if(mode==='reload')doc._annotationLoadId++;else state.present=false;};
  const r=await adapter.open(bytes);await assert.rejects(r.ready(),/STALE/);await r.dispose();assert.deepEqual(state.removed,['/own/unique.pdf']);
 }
});
test('partial annotation loading and out-of-document server pages cannot produce a snapshot',async()=>{
 const{adapter,io}=rig();io.annotationsReady=async()=>{};const r=await adapter.open(bytes);await assert.rejects(r.ready(),/PDF_LOAD_FAILED/);await r.dispose();
 const good=rig();const complete=await good.adapter.open(bytes);await complete.ready();
 assert.throws(()=>complete.install({annotations:[{id:'x',base:'e',data:{...ann('x'),page:2}}]}),/INVALID_RESPONSE/);
 assert.equal(good.doc.annotations[0].text,'original');await complete.dispose();
});

test('live adapter keeps original stable IDs, clears stale selection/undo and never publishes PDF names',async()=>{
 const{adapter,doc,state}=rig();const r=await adapter.open(bytes);await r.ready();r.install({annotations:[]});
 const original=doc.annotations[0];doc.selectedAnnotation=doc.annotations[1];doc.selectedAnnotations=[doc.selectedAnnotation];doc.undoStack=[{}];
 r.write(new Map([['pdf:1:0',ann('pdf:1:0','remote')],['pdf:1:1',null],['new',ann('new')]]));
 assert.equal(doc.annotations[0],original);assert.equal(original.id,'local-a');assert.equal(r.read().get('pdf:1:0').text,'remote');
 assert.equal(r.read().get('pdf:1:0').nm,undefined);assert.equal(doc.selectedAnnotation,null);assert.deepEqual(doc.selectedAnnotations,[]);assert.deepEqual(doc.undoStack,[]);
 assert.equal(state.redraw,2);assert.throws(()=>r.write(new Map([['bad',{...ann('bad'),page:2}]])),/INVALID_RESPONSE/);assert.equal(doc.annotations.length,2);
 await r.dispose();assert.throws(()=>r.read(),/STALE/);
});

test('a server ID equal to an original local PDF ID cannot alias its stable review ID',async()=>{
 const{adapter,doc}=rig();const r=await adapter.open(bytes);await r.ready();
 r.install({annotations:[{id:'local-a',base:'e1',data:ann('local-a','shared')}]});
 assert.equal(r.read().size,3);assert.equal(r.read().get('pdf:1:0').text,'original');assert.equal(r.read().get('local-a').text,'shared');
 assert.equal(new Set(doc.annotations.map(a=>a.id)).size,3);
 r.write(new Map([['local-b',ann('local-b','another')]]));
 assert.equal(r.read().get('pdf:1:1').text,'original');assert.equal(r.read().get('local-b').text,'another');
 await r.dispose();
});
