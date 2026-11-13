import test from 'node:test';
import assert from 'node:assert/strict';
import { createCentralReviewSession } from './central-review-session.js';
const A='1'.repeat(32),B='2'.repeat(32);
const deferred = () => { let resolve, reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
function rig() {
  const calls=[];let n=0, download=()=>new TextEncoder().encode('%PDF-test');
  const session=createCentralReviewSession(async (cmd,args)=>{
    calls.push([cmd,args]);
    if(cmd==='central_review_login') return `central-${++n}`;
    if(cmd==='central_review_download') return download();
  });
  return {session,calls,setDownload(fn){download=fn;}};
}
const login = s => s.login('https://review.test','Alice','secret');

test('closing manager retains PDF leases; only last PDF close revokes native session',async()=>{
  const {session,calls}=rig();await login(session);
  const first=session.retain(A),second=session.retain(B);
  await session.dispose();assert.throws(()=>session.retain(A),/STALE/);
  assert.equal((await first.download(A))[0],37);
  await first.dispose();await first.dispose();
  assert.equal(calls.filter(([c])=>c==='central_review_logout').length,0);
  assert.equal((await second.download(B))[0],37);
  await second.dispose();await second.dispose();
  assert.equal(calls.filter(([c])=>c==='central_review_logout').length,1);
});

test('leases are document scoped and cannot leak session handles or manage accounts',async()=>{
  const {session,calls}=rig();await login(session);const lease=session.retain(A);
  const count=calls.length;await assert.rejects(lease.download(B),/INVALID_REQUEST/);
  assert.equal(calls.length,count);assert.equal(lease.login,undefined);assert.equal(lease.share,undefined);
  assert.equal(lease.session,undefined);await lease.dispose();await session.dispose();
});

test('explicit logout revokes all leases and rejects late downloads',async()=>{
  const {session,setDownload}=rig();await login(session);const lease=session.retain(A),wait=deferred();
  setDownload(()=>wait.promise);const request=lease.download(A);
  await session.logout();wait.resolve(new TextEncoder().encode('%PDF-late'));
  await assert.rejects(request,/STALE/);assert.equal(lease.isCurrent(),false);
  assert.throws(()=>session.retain(A),/SESSION_CLOSED/);await session.dispose();
});

test('release invalidates both successful and failed late requests without logging out other PDFs',async()=>{
  for(const success of [true,false]) {
    const {session,setDownload,calls}=rig();await login(session);
    const lease=session.retain(A),other=session.retain(B),wait=deferred();setDownload(()=>wait.promise);
    const request=lease.download(A);await lease.dispose();
    if(success)wait.resolve(new TextEncoder().encode('%PDF-late'));else wait.reject('NETWORK_ERROR');
    await assert.rejects(request,/STALE/);assert.equal(other.isCurrent(),true);
    assert.equal(calls.filter(([c])=>c==='central_review_logout').length,0);
    await other.dispose();await session.dispose();
  }
});

test('old PDF leases never gain access to a replacement login',async()=>{
  const {session,calls}=rig();await login(session);const old=session.retain(A);
  await session.login('https://other.test','Bob','secret');const current=session.retain(B);
  assert.equal(old.isCurrent(),false);await assert.rejects(old.download(A),/STALE/);
  await old.dispose();await session.dispose();assert.equal(current.isCurrent(),true);
  await current.dispose();assert.equal(calls.filter(([c])=>c==='central_review_logout').length,2);
});

test('manager requests cannot finish after it closes, even when a PDF retains the login',async()=>{
  const wait=deferred();
  const session=createCentralReviewSession(async cmd=>cmd==='central_review_login'?'central-1':cmd==='central_review_json'?wait.promise:undefined);
  await login(session);const lease=session.retain(A),request=session.documents();await session.dispose();
  wait.resolve({status:200,body:{documents:[],cursor:'',hasMore:false}});
  await assert.rejects(request,/STALE/);assert.equal(lease.isCurrent(),true);await lease.dispose();
});
