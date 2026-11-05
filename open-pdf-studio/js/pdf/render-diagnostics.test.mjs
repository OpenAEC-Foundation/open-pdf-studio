import test from 'node:test';
import assert from 'node:assert/strict';
import {beginRenderObservation as begin,reportRenderObservation as report,readRenderDiagnostics as read,invalidateRenderDiagnostics as clear,observeNativeRender as observe,subscribeRenderDiagnostics as subscribe} from './render-diagnostics.js';
const bitmap=()=>{const b=new Uint8Array(12);const v=new DataView(b.buffer);v.setUint32(0,1,true);v.setUint32(4,1,true);return b;};
test('failed buffer cannot be published as successful pixels',async()=>{
 clear();await assert.rejects(observe('render_pdf_page',{path:'a',pageIndex:0},async()=>new Uint8Array(8)),/INVALID_RENDER_BUFFER/);
 assert.equal(read('a').pages[0].findings[0].code,'PDF_INVALID_RENDER_BUFFER');
});
test('fallback success retains evidence and does not certify complete rendering',async()=>{
 clear();await assert.rejects(observe('render_pdf_page',{path:'a',pageIndex:0},async()=>{throw new Error('PDF_OUTPUT_LIMIT: private/path.pdf');}));
 await observe('render_pdf_page_skia',{path:'a',pageIndex:0},async()=>bitmap());
 const result=read('a');assert.equal(result.fidelity,'not-certified');assert.equal(result.pages[0].status,'unknown');
 assert.equal(result.pages[0].findings[0].code,'PDF_OUTPUT_LIMIT');assert.ok(!JSON.stringify(result).includes('private/path'));
});
test('page and document invalidation reject late asynchronous findings',()=>{
 clear();let token=begin('a',1,'pdfium');clear('a',1);report(token,{code:'late',status:'failed'});assert.equal(read('a').pages.length,0);
 token=begin('a',1,'pdfium');clear('a');begin('a',1,'pdfium');report(token,{code:'old-document'});assert.equal(read('a').pages[0].findings.length,0);
});
test('quality and backend provenance remain separate, snapshots cannot mutate cache',()=>{
 clear();report(begin('a',2,'pdfjs','preview'),{code:'DECODE_FAILED',status:'incomplete',severity:'warning'});
 report(begin('a',2,'pdfium','final'),{code:'DECODE_FAILED',status:'incomplete',severity:'warning'});
 const snapshot=read('a');assert.equal(snapshot.pages[0].findings.length,2);snapshot.pages[0].findings.length=0;assert.equal(read('a').pages[0].findings.length,2);
});
test('notifications are removable and finding storage is bounded',()=>{
 clear();let calls=0;const dispose=subscribe(()=>calls++);const t=begin('a',1,'pdfium');
 for(let n=0;n<50;n++)report(t,{code:`failure-${n}`,status:'failed'});
 assert.equal(read('a').pages[0].findings.length,16);dispose();const before=calls;clear();assert.equal(calls,before);
});
test('a successful render does not notify listeners; a new finding does',async()=>{
 clear();let calls=0;const dispose=subscribe(()=>calls++);
 await observe('render_pdf_page_region',{path:'a',pageIndex:0},async()=>bitmap());
 assert.equal(calls,0);
 await assert.rejects(observe('render_pdf_page_region',{path:'a',pageIndex:0},async()=>{throw new Error('boom');}));
 assert.equal(calls,1);dispose();
});

test('isolated worker limits retain stable codes without exposing backend details',async()=>{
 for(const code of ['PDF_RENDER_TIMEOUT','PDF_WORKER_RESPONSE_LIMIT','PDF_WORKER_UNAVAILABLE']) {
  clear();
  await assert.rejects(observe('render_pdf_page',{path:'a',pageIndex:0},async()=>{throw new Error(`read from worker 2: ${code}: private.pdf`);}));
  assert.equal(read('a').pages[0].findings[0].code,code);
  assert.ok(!JSON.stringify(read('a')).includes('private.pdf'));
 }
});
