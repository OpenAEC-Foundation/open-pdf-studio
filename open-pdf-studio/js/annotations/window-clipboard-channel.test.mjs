import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowClipboard, connectWindowClipboard, CLIPBOARD_EVENT } from './window-clipboard-channel.js';
const line={id:'line',type:'line',startX:1,startY:2,endX:30,endY:40};
const tick=()=>new Promise(r=>setImmediate(r));
function pair() {
  const received=[[],[]],sent=[];const peers=[];
  for(let i=0;i<2;i++)peers.push(createWindowClipboard({id:()=>String(i),now:()=>10,send:p=>{sent.push(p);for(const other of peers)other.receive(p);},apply:(a,at)=>received[i].push({a,at})}));
  return {peers,received,sent};
}
test('copies are independent editable snapshots; echoes do not reapply',async()=>{
 const {peers,received}=pair();const source={...line};peers[0].publish([source]);source.startX=999;await tick();
 assert.equal(received[0].length,0);assert.equal(received[1].length,1);assert.equal(received[1][0].a[0].startX,1);
});
test('new window requests the latest copy, and copied groups retain their links',async()=>{
 const {peers,sent}=pair();peers[0].publish([line,{...line,id:'second',linkedTo:'line'}]);await tick();
 const received=[];const third=createWindowClipboard({send:p=>peers.forEach(x=>x.receive(p)),apply:a=>received.push(a)});third.request();
 await third.receive(sent.at(-1));assert.equal(received[0].length,2);assert.equal(received[0][1].linkedTo,'line');
});
test('logical ordering rejects stale packets and the older image load cannot overwrite a new copy',async()=>{
 let release;const applied=[];const c=createWindowClipboard({send(){},apply:a=>applied.push(a),prepare:a=>a[0].id==='slow'?new Promise(r=>release=()=>r(a)):a,now:()=>1,id:()=> 'local'});
 const p=(at,id)=>({version:1,kind:'copy',at,id,annotations:[{...line,id}]});
 const old=c.receive(p(10,'slow'));await c.receive(p(11,'fast'));release();await old;await c.receive(p(9,'stale'));
 assert.deepEqual(applied.map(a=>a[0].id),['fast']);c.publish([line]);await c.receive(p(11,'remote'));assert.equal(applied.length,1);
});
test('malformed packets, failed preparation and shutdown preserve local state',async()=>{
 const applied=[];let sent=0;const c=createWindowClipboard({send(){sent++},apply:a=>applied.push(a),prepare:()=>{throw Error('bad image')}});
 for(const p of [null,{version:2},{version:1,kind:'copy',at:Infinity,id:'x',annotations:[line]},{version:1,kind:'copy',at:1,id:'x',annotations:[null]}])await c.receive(p);
 await c.receive({version:1,kind:'copy',at:2,id:'x',annotations:[line]});assert.equal(applied.length,0);
 c.stop();c.request();c.publish([line]);assert.equal(sent,0);
});
test('native transport listens before sending, unwraps event payloads, and unregisters',async()=>{
 const got=[];let callback,closed=false;const native={async listen(name,cb){assert.equal(name,CLIPBOARD_EVENT);callback=cb;return()=>{closed=true}},async emit(name,p){assert.equal(name,CLIPBOARD_EVENT);callback({payload:p});}};
 const t=await connectWindowClipboard(p=>got.push(p),{native});await t.send({version:1,kind:'request'});assert.deepEqual(got,[{version:1,kind:'request'}]);t.close();assert.equal(closed,true);
});
test('browser transport uses the same channel without storage; absence of transport is harmless',async()=>{
 let bus;class Broadcast {constructor(name){assert.equal(name,CLIPBOARD_EVENT);bus=this}postMessage(p){this.onmessage({data:p})}close(){this.closed=true}}
 const got=[];const t=await connectWindowClipboard(p=>got.push(p),{Broadcast});t.send({x:1});assert.deepEqual(got,[{x:1}]);t.close();assert.ok(bus.closed);assert.equal(await connectWindowClipboard(()=>{}),null);
});

test('native broker adapter fetches a fresh copy and restores its memory copy after broker restart',async()=>{
 let current=null;let received=null;const sent=[];let saved={version:1,kind:'copy',at:5,id:'saved',annotations:[line]};
 const exchange=async(candidate,known)=>{sent.push(candidate);if(candidate)current=candidate;return {empty:!current,latest:current?.id===known?null:current};};
 const t=await connectWindowClipboard(p=>{received=p;saved=p;},{exchange,snapshot:()=>saved});
 await t.refresh();assert.equal(current.id,'saved');
 current={...saved,at:6,id:'other'};await t.refresh();assert.equal(received.id,'other');
 current=null;await t.refresh();assert.equal(current.id,'other');
 t.close();const before=sent.length;await t.refresh();assert.equal(sent.length,before);
});
