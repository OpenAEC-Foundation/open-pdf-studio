import test from 'node:test';
import assert from 'node:assert/strict';
import { createCentralReviewOpening } from './central-review-opening.js';
const A='1'.repeat(32);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{resolve,reject,promise};};
function rig() {
  const state={active:true,docActive:true,releases:0,disposes:0,installs:0,events:0,source:new TextEncoder().encode('%PDF-source')};
  const lease={isCurrent:()=>state.active,dispose:async()=>{state.active=false;state.releases++;},download:async()=>state.source,
    snapshot:async()=>({cursor:0,annotations:[]}),events:async(_,after)=>{state.events++;return{events:[],cursor:after,head:after,hasMore:false};}};
  const resource={isCurrent:()=>state.docActive,dispose:async()=>{state.disposes++;},ready:async()=>{},install:view=>{state.installs++;state.view=view;}};
  const adapter={open:async bytes=>{state.received=bytes;return resource;}};
  const opening=createCentralReviewOpening({retain:id=>{assert.equal(id,A);return lease;}},A,adapter);
  return{state,lease,resource,adapter,opening};
}

test('download/snapshot/PDF readiness/catch-up precede a single install; source bytes remain intact',async()=>{
  const {state,opening,adapter,resource}=rig();
  adapter.open=async bytes=>{structuredClone(bytes.buffer,{transfer:[bytes.buffer]});return resource;};
  await opening.open();assert.equal(state.source.length,11);assert.equal(state.installs,1);assert.equal(state.events,1);
  await assert.rejects(opening.open(),/ALREADY_OPENING/);await opening.close();await opening.close();assert.equal(state.disposes,1);
});

test('close during each opening await discards late work and disposes a late-created PDF',async()=>{
  for(const stage of ['download','snapshot','open','ready','events']) {
    const {state,lease,adapter,resource,opening}=rig(),wait=deferred(),started=deferred();
    const target=['download','snapshot','events'].includes(stage)?lease:stage==='open'?adapter:resource;
    const original=target[stage];target[stage]=async(...args)=>{started.resolve();await wait.promise;return original(...args);};
    const work=opening.open();await started.promise;await opening.close();wait.resolve();await assert.rejects(work,/STALE/);
    assert.equal(state.installs,0,stage);assert.equal(state.disposes,['open','ready','events'].includes(stage)?1:0,stage);
  }
});

test('PDF generation changes while annotations load prevent installation',async()=>{
  const {state,resource,opening}=rig();resource.ready=async()=>{state.docActive=false;};
  await assert.rejects(opening.open(),/STALE/);assert.equal(state.installs,0);assert.equal(state.disposes,1);
});

test('readiness failure releases only owned resources and preserves original error',async()=>{
  const {state,resource,opening,adapter}=rig();let warned=0;
  resource.ready=async()=>{throw new Error('PDF_LOAD_FAILED');};resource.dispose=async()=>{state.disposes++;throw new Error('CLEANUP_FAILED');};
  adapter.onCleanupError=()=>warned++;
  await assert.rejects(opening.open(),/PDF_LOAD_FAILED/);assert.equal(warned,1);assert.equal(state.active,false);assert.equal(state.disposes,1);
});

test('opening catches up events committed during PDF loading before installing',async()=>{
  const {state,lease,opening,resource}=rig();let loaded=false;
  resource.ready=async()=>{loaded=true;};
  lease.events=async(_,after)=>{
    assert.equal(loaded,true);
    const n=after+1;
    return{events:[{v:1,id:`event-${n}`,ann:`note-${n}`,base:null,op:'create',data:{id:`note-${n}`,type:'textbox',page:1},revision:n,seq:n,clock:n,uk:'alice',user:'Alice',at:'2026-11-13T00:00:00Z'}],cursor:n,head:2,hasMore:n<2};
  };
  const opened=await opening.open();assert.equal(state.view.cursor,2);assert.equal(state.view.annotations.length,2);
  assert.equal(opened.sync.view().cursor,2);await opening.close();
});

test('sustained writes have a finite catch-up budget and cannot leave a half-installed PDF',async()=>{
  const {state,lease,opening}=rig();let pages=0;
  lease.events=async(_,after)=>{
    const n=after+1;pages++;
    return{events:[{v:1,id:`e-${n}`,ann:`a-${n}`,op:'create',base:null,data:{id:`a-${n}`,type:'textbox',page:1},revision:n,seq:n,clock:n,uk:'alice',user:'Alice',at:'2026-11-13T00:00:00Z'}],cursor:n,head:n+1,hasMore:true};
  };
  await assert.rejects(opening.open(),/CATCH_UP_LIMIT/);
  assert.equal(pages,100);assert.equal(state.installs,0);assert.equal(state.disposes,1);assert.equal(state.active,false);
});

test('detaching a complete snapshot releases its connection but preserves the user-owned PDF',async()=>{
 const{opening,state}=rig();await assert.rejects(opening.detach(),/NOT_READY/);
 await opening.open();await opening.detach();await opening.close();assert.equal(state.disposes,0);assert.equal(state.active,false);
});
