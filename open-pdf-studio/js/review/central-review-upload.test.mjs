import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadCentralPdf } from './central-review-upload.js';
const pdf=new TextEncoder().encode('%PDF-test');
function rig(){
  const calls=[];let current=true;
  const io={choose:async()=>'/chosen.pdf',stat:async()=>({isFile:true,size:pdf.length}),read:async()=>pdf};
  const client={upload:async(id,bytes)=>calls.push([id,bytes])};
  return {io,client,calls,stop(){current=false;},run:()=>uploadCentralPdf(client,'document',io,()=>current)};
}
test('cancelled picker never reads or uploads; success sends only the selected bytes',async()=>{
  const r=rig();r.io.choose=async()=>null;r.io.stat=async()=>{throw Error('must not read');};assert.equal(await r.run(),false);assert.deepEqual(r.calls,[]);
  const good=rig();assert.equal(await good.run(),true);assert.deepEqual(good.calls,[['document',pdf]]);
});
test('size, directory and changing-file guards precede any upload',async()=>{
  for(const info of [{isFile:false,size:9},{isFile:true,size:32*1024*1024+1},{isFile:true,size:4},{isFile:true,size:NaN}]){
    const r=rig();r.io.stat=async()=>info;r.io.read=async()=>{throw Error('must not read');};await assert.rejects(r.run(),/INVALID_PDF/);assert.deepEqual(r.calls,[]);
  }
  const r=rig();r.io.read=async()=>new Uint8Array(8);await assert.rejects(r.run(),/INVALID_PDF/);assert.deepEqual(r.calls,[]);
});
test('closing after each file await blocks later reads and uploads',async()=>{
  for(const step of ['choose','stat','read']){
    const r=rig(),original=r.io[step];r.io[step]=async(...args)=>{const result=await original(...args);r.stop();return result;};
    await assert.rejects(r.run(),/STALE/);assert.deepEqual(r.calls,[]);
  }
});
test('uncertain upload is not retried; late completion is not reported as success',async()=>{
  const r=rig();r.client.upload=async()=>{r.calls.push('upload');throw Error('NETWORK_ERROR');};await assert.rejects(r.run(),/NETWORK_ERROR/);assert.deepEqual(r.calls,['upload']);
  const late=rig();late.client.upload=async()=>late.stop();await assert.rejects(late.run(),/STALE/);
});
