import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(s,c,next) {
  if(s.endsWith('/document-context.js'))return {url:'data:text/javascript,export const tekenDocument=()=>null;',shortCircuit:true};
  return next(s,c);
}});
const { capturePrintView } = await import('./print-current-view-dom.js');
function setup(rotation=0) {
  const doc={id:'d',pdfDoc:{},filePath:'drawing.pdf',currentPage:1,viewRotation:rotation,pageDims:{1:{widthPt:600,heightPt:800}},pageRotations:{},scale:1};
  const viewer={clientLeft:0,clientTop:0,clientWidth:300,clientHeight:200,getBoundingClientRect:()=>({left:20,top:40})};
  globalThis.window={__pdfViewport:{active:true,pageNum:1,zoom:2,offsetX:-100,offsetY:-200}};
  globalThis.document={getElementById:id=>id==='pdf-container'?viewer:{getBoundingClientRect:()=>({left:20,top:40})},querySelectorAll:()=>[]};
  return doc;
}
test('captures actual viewport zoom/pan through DOM left/top coordinates',()=>{
  const d=setup();
  assert.deepEqual(capturePrintView(d),{docId:'d',pageNum:1,rotation:0,rect:{x:50,y:100,width:150,height:100}});
});
test('screen rotation is undone for source crop and retained for printed output',()=>{
  const d=setup(90);
  assert.deepEqual(capturePrintView(d),{docId:'d',pageNum:1,rotation:90,rect:{x:100,y:600,width:100,height:150}});
});
test('background clipping excludes non-page area',()=>{
  const d=setup();window.__pdfViewport.offsetX=100;window.__pdfViewport.offsetY=100;
  assert.deepEqual(capturePrintView(d).rect,{x:0,y:0,width:100,height:50});
  window.__pdfViewport.offsetX=400;
  assert.equal(capturePrintView(d),null);
});
test('continuous mode captures only the first visible page, excluding the page gap',()=>{
  const d=setup();d.viewMode='continuous';d.scale=2;
  d.pageDims[2]={widthPt:600,heightPt:800};
  document.querySelectorAll=()=>[{dataset:{page:'1'}},{dataset:{page:'2'}}];
  document.querySelector=selector=>({getBoundingClientRect:()=>({left:20,top:selector.includes('"1"')?-1500:120})});
  assert.deepEqual(capturePrintView(d),{docId:'d',pageNum:1,rotation:0,rect:{x:0,y:770,width:150,height:30}});
});
