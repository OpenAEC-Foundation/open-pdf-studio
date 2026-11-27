import test from 'node:test';
import assert from 'node:assert/strict';
import { createCentralReviewSync } from './central-review-sync.js';
import { createCentralReviewLive } from './central-review-live.js';
const ann = (id = 'a', text = 'original') => ({ id, type: 'textbox', page: 1, text });
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function server() {
  const log = [], heads = new Map();
  const api = {
    snapshot: async () => ({ cursor: log.length, annotations: [...heads.values()] }),
    events: async (_, after) => ({ events: log.slice(after, after + 100), cursor: Math.min(after + 100, log.length), head: log.length, hasMore: after + 100 < log.length }),
    append: async (_, e) => {
      const existing = log.find(item => item.id === e.id); if (existing) return existing;
      if ((heads.get(e.ann)?.base ?? null) !== e.base) throw Object.assign(new Error('CONFLICT'), { current: heads.get(e.ann)?.base });
      const n = log.length + 1, event = { ...structuredClone(e), v: 1, revision: n, seq: n, clock: n, uk: 'u', user: 'User', at: '2026-11-19T00:00:00Z' };
      log.push(event); heads.set(e.ann, { id: e.ann, base: e.id, data: e.data }); return event;
    },
  };
  return { api, log, heads };
}
let clientId = 0;
async function client(server, original = [], options = {}) {
  let seq = 0, present = true, disconnected = 0, latest;
  const id = ++clientId;
  const api = { ...server.api }, sync = createCentralReviewSync(api, 'doc', () => `c${id}-${++seq}`);
  await sync.initialize();
  const local = new Map(original.map(a => [a.id, structuredClone(a)]));
  for (const row of sync.view().annotations) { if (row.data) local.set(row.id, row.data); else local.delete(row.id); }
  const resource = { isCurrent: () => present, read: () => structuredClone(local), write: changes => {
    assert.equal(present, true);
    for (const [id, data] of changes) { if (data === null) local.delete(id); else local.set(id, structuredClone(data)); }
  } };
  const live = createCentralReviewLive({ resource, sync, isCurrent: () => present,
    disconnect: async () => { disconnected++; sync.close(); } }, { ...options, onStatus: status => latest = status });
  return { api, sync, local, live, status: () => latest, close: () => { present = false; }, disconnected: () => disconnected };
}
test('two live clients create, edit, delete and restore without echoing remote edits', async () => {
  const s = server(), a = await client(s), b = await client(s);
  a.local.set('a', ann()); await a.live.step(); await b.live.step();
  assert.deepEqual(b.local.get('a'), ann()); assert.equal(s.log.length, 1);
  b.local.set('a', ann('a', 'changed')); await b.live.step(); await a.live.step();
  assert.equal(a.local.get('a').text, 'changed');
  a.local.delete('a'); await a.live.step(); await b.live.step(); assert.equal(b.local.size, 0);
  b.local.set('a', ann('a', 'restored')); await b.live.step(); await a.live.step();
  assert.equal(a.local.get('a').text, 'restored'); await a.live.step(); await b.live.step(); assert.equal(s.log.length, 4);
});
test('first deletion of an original PDF annotation seeds a revision then deletes it', async () => {
  const s = server(), a = await client(s, [ann()]), b = await client(s, [ann()]);
  a.local.delete('a'); await a.live.step(); assert.equal(a.local.size, 0); await a.live.step(); await b.live.step();
  assert.equal(b.local.size, 0); assert.deepEqual(s.log.map(e => e.op), ['create', 'delete']);
});
test('concurrent changes preserve both versions and require explicit keep-mine or remote', async () => {
  for (const choice of ['replace', 'discard']) {
    const s = server(), a = await client(s), b = await client(s);
    a.local.set('a', ann('a', 'Alice')); b.local.set('a', ann('a', 'Bob'));
    await a.live.step(); await b.live.step();
    assert.equal(b.local.get('a').text, 'Bob'); assert.equal(b.status().conflicts[0].remote.text, 'Alice');
    assert.equal(b.status().conflicts[0].ready, true);
    b.live.resolve('a', choice); await b.live.step(); await a.live.step();
    assert.equal(a.local.get('a').text, choice === 'replace' ? 'Bob' : 'Alice');
    assert.equal(b.status().conflicts.length, 0);
  }
});
test('an edit made during pull is never silently rebased onto the newly fetched remote edit', async () => {
  const s = server(), a = await client(s); a.local.set('a', ann()); await a.live.step();
  const b = await client(s), wait = deferred(), entered = deferred(), originalEvents = b.api.events;
  a.local.set('a', ann('a', 'remote')); await a.live.step();
  b.api.events = async (...args) => { entered.resolve(); await wait.promise; return originalEvents(...args); };
  const run = b.live.step(); await entered.promise; b.local.set('a', ann('a', 'local during pull')); wait.resolve(); await run;
  await b.live.step(); assert.equal(b.status().error, 'CONFLICT'); assert.equal(b.local.get('a').text, 'local during pull');
  assert.equal(s.heads.get('a').data.text, 'remote');
});
test('new edits during acknowledgement remain local and publish in a subsequent event', async () => {
  const s = server(), a = await client(s), wait = deferred(), entered = deferred(), append = a.api.append;
  a.api.append = async (...args) => { const ack = await append(...args); entered.resolve(); await wait.promise; return ack; };
  a.local.set('a', ann()); const run = a.live.step(); await entered.promise;
  a.local.set('a', ann('a', 'later')); wait.resolve(); await run;
  assert.equal(a.local.get('a').text, 'later'); await a.live.step();
  assert.equal(s.log.length, 2); assert.equal(s.heads.get('a').data.text, 'later');
});
test('lost acknowledgement is recovered by replay without duplicates or local loss', async () => {
  const s = server(), a = await client(s), append = a.api.append;
  a.api.append = async (...args) => { await append(...args); throw new Error('NETWORK_ERROR'); };
  a.local.set('a', ann()); await a.live.step(); await a.live.step();
  assert.equal(a.status().error, ''); assert.equal(s.log.length, 1); assert.equal(a.local.get('a').text, 'original');
});
test('offline writes retain the same event until recovery', async () => {
  const s = server(), a = await client(s), append = a.api.append;
  a.api.append = async () => { throw new Error('NETWORK_ERROR'); }; a.local.set('a', ann()); await a.live.step();
  const pendingId = a.sync.view().pending[0].event.id; a.local.set('a', ann('a', 'later'));
  await a.live.step(); assert.equal(a.sync.view().pending[0].event.id, pendingId);
  a.api.append = append; await a.live.step(); await a.live.step(); assert.equal(s.log.length, 2); assert.equal(s.heads.get('a').data.text, 'later');
});
test('readers pull but never publish their local edits', async () => {
  const s = server(), a = await client(s), b = await client(s, [], { writable: false });
  a.local.set('a', ann()); await a.live.step(); await b.live.step();
  b.local.set('a', ann('a', 'reader local')); await b.live.step(); assert.equal(s.log.length, 1);
  assert.equal(b.local.get('a').text, 'reader local'); assert.equal(b.status().writable, false);
});
test('closed tabs and invalidated leases stop in-flight replay before writing annotations', async () => {
  const s = server(), a = await client(s), wait = deferred(), entered = deferred(), events = a.api.events;
  a.api.events = async (...args) => { entered.resolve(); await wait.promise; return events(...args); };
  const run = a.live.step(); assert.equal(a.live.step(), run); await entered.promise;
  a.close(); wait.resolve(); await run; assert.equal(a.disconnected(), 1); assert.equal(a.status().connected, false);
  await a.live.step(); assert.equal(a.disconnected(), 1);
});
test('gesture started during acknowledgement defers reconciliation without republishing', async () => {
  const s = server(); let safe = true;
  const a = await client(s, [], { canSync: () => safe }), append = a.api.append;
  a.api.append = async (...args) => { const ack = await append(...args); safe = false; return ack; };
  a.local.set('a', ann()); await a.live.step(); a.local.set('a', ann('a', 'gesture'));
  await a.live.step(); assert.equal(s.log.length, 1);
  safe = true; a.api.append = s.api.append; await a.live.step(); assert.equal(s.log.length, 2); assert.equal(s.heads.get('a').data.text, 'gesture');
});

test('a remote edit after our acknowledged event still conflicts with a later local edit',async()=>{
 const s=server(),a=await client(s),append=a.api.append;
 a.api.append=async(...args)=>{const ack=await append(...args);a.local.set('a',ann('a','later local'));
   await append('doc',{id:'colleague',ann:'a',base:ack.id,op:'edit',data:ann('a','remote after ack')});return ack;};
 a.local.set('a',ann());await a.live.step();a.api.append=append;await a.live.step();
 assert.equal(a.status().error,'CONFLICT');assert.equal(a.local.get('a').text,'later local');assert.equal(a.status().conflicts[0].remote.text,'remote after ack');
});
test('confirmation on a replay page survives failure on the following page',async()=>{
 const s=server(),a=await client(s),events=a.api.events;let fail=true;
 a.api.events=async(_,after)=>{if(fail&&after===1)throw new Error('NETWORK_ERROR');const result=await events(_,after);
   if(fail&&after===0)return{...result,head:2,hasMore:true};return result;};
 a.local.set('a',ann());await a.live.step();assert.equal(a.status().error,'NETWORK_ERROR');
 a.local.set('a',ann('a','later'));fail=false;await a.live.step();
 assert.equal(s.log.length,2);assert.equal(a.status().error,'');assert.equal(s.heads.get('a').data.text,'later');
});
