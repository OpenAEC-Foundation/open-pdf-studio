import test from 'node:test';
import assert from 'node:assert/strict';
import { createCentralReviewSync } from './central-review-sync.js';
import { validateReplay, validateSnapshot } from './central-review-protocol.js';
const data = (id = 'ann', text = 'one') => ({ id, type: 'textbox', page: 1, text });
const event = (revision, id, base = null, value = data()) => ({ v: 1, id, ann: value?.id || 'ann', base,
  op: value === null ? 'delete' : base ? 'edit' : 'create', data: value,
  revision, seq: revision, clock: revision, uk: 'user', user: 'Alice', at: '2026-11-13T00:00:00Z' });
const page = (events, head = events.at(-1)?.revision || 0, cursor = events.at(-1)?.revision || 0) => ({ events, head, cursor, hasMore: cursor < head });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function rig(overrides = {}) {
  let next = 0;
  const client = { snapshot: async () => ({ cursor: 0, annotations: [] }), events: async () => page([]), ...overrides };
  return createCentralReviewSync(client, '1'.repeat(32), () => `local-${++next}`);
}

test('uncertain commit retries the identical detached event and does not skip other revisions', async () => {
  const sent = []; let fail = true;
  const sync = rig({ append: async (_, request) => {
    sent.push(request);
    if (fail) { fail = false; throw new Error('NETWORK_ERROR'); }
    return event(2, request.id, null, request.data);
  }, events: async (_, after) => {
    assert.equal(after, 0);
    return page([event(1, 'colleague', null, data('other')), event(2, 'local-1')]);
  } });
  await sync.initialize();
  const original = data(); sync.stage('ann', original); original.text = 'later';
  assert.throws(() => sync.stage('ann', data()), /PENDING_CHANGE/);
  await assert.rejects(sync.flush(), /NETWORK_ERROR/);
  assert.equal(sync.view().pending.length, 1);
  await sync.flush(); assert.deepEqual(sent[0], sent[1]);
  assert.equal(sent[1].data.text, 'one'); assert.equal(sync.view().cursor, 0);
  await sync.pull(); assert.equal(sync.view().cursor, 2);
  assert.equal(sync.view().annotations.length, 2);
});

test('conflicts preserve local data until an explicit refresh and replacement/discard', async () => {
  let latest = false;
  const sync = rig({ snapshot: async () => ({ cursor: 1, annotations: [{ id: 'ann', base: 'e1', data: data() }] }),
    events: async () => page([event(2, 'e2', 'e1', data('ann', 'remote'))]),
    append: async (_, request) => {
      if (!latest) { const error = new Error('CONFLICT'); error.current = 'e2'; throw error; }
      return event(3, request.id, 'e2', request.data);
    } });
  await sync.initialize(); sync.stage('ann', data('ann', 'mine'));
  await assert.rejects(sync.flush(), /CONFLICT/);
  assert.equal(sync.view().pending[0].event.data.text, 'mine');
  assert.throws(() => sync.resolve('ann', 'replace', data()), /REFRESH_REQUIRED/);
  await sync.pull();
  assert.equal(sync.view().annotations[0].data.text, 'remote');
  sync.resolve('ann', 'replace', data('ann', 'merged'));
  assert.equal(sync.view().pending[0].event.id, 'local-2');
  assert.equal(sync.view().pending[0].event.base, 'e2');
  latest = true; await sync.flush(); assert.equal(sync.view().pending[0].status, 'acknowledged');
});

test('invalid or broken replay pages are atomic, including deletion and restore bases', async () => {
  let reply = page([event(1, 'e1'), event(2, 'e2', 'wrong')]);
  const sync = rig({ events: async () => reply });
  await sync.initialize(); await assert.rejects(sync.pull(), /INVALID_RESPONSE/);
  assert.deepEqual(sync.view().annotations, []); assert.equal(sync.view().cursor, 0);
  reply = page([event(1, 'e1'), event(2, 'e2', 'e1', null), event(3, 'e3', 'e2')]);
  await sync.pull(); assert.equal(sync.view().annotations[0].base, 'e3');
  assert.equal(sync.view().cursor, 3);
});

test('close invalidates in-flight snapshot, replay and acknowledgement', async () => {
  for (const operation of ['initialize', 'pull', 'flush']) {
    const wait = deferred();
    const sync = rig({ ...(operation === 'initialize' ? { snapshot: () => wait.promise } : {}),
      events: () => wait.promise, append: () => wait.promise });
    if (operation !== 'initialize') await sync.initialize();
    if (operation === 'flush') sync.stage('ann', data());
    const running = sync[operation](); sync.close();
    wait.resolve(operation === 'initialize' ? { cursor: 0, annotations: [] } : operation === 'pull' ? page([event(1, 'e1')]) : event(1, 'local-1'));
    await assert.rejects(running, /STALE/);
    assert.equal(sync.view().cursor, 0);
    if (operation === 'flush') assert.equal(sync.view().pending.length, 1);
  }
});

test('bounded replay rejects gaps, cursor regression, duplicate IDs and invalid tombstones', () => {
  for (const reply of [page([event(2,'e2')]), page([event(1,'e1')],0), page([],1),
    page([event(1,'e1'),event(2,'e1','e1')]), page([{...event(1,'e1'),data:null}]),
    page([event(1,'e1')],1,0)]) assert.throws(() => validateReplay(reply,0,100),/INVALID_RESPONSE/);
  assert.throws(() => validateSnapshot({cursor:0,annotations:[{id:'ann',base:'e1',data:data()}]}),/INVALID_RESPONSE/);
});

test('detached views cannot mutate replay state or pending retry payload', async () => {
  const sync = rig(); await sync.initialize(); sync.stage('ann',data());
  sync.view().pending[0].event.data.text = 'mutated';
  assert.equal(sync.view().pending[0].event.data.text,'one');
  await assert.rejects(sync.initialize(),/ALREADY_INITIALIZED/);
});

test('replay can confirm a lost acknowledgement; acknowledged changes cannot use a stale base', async () => {
  const sync = rig({append: async () => { throw new Error('NETWORK_ERROR'); }, events: async () => page([event(1,'local-1')])});
  await sync.initialize(); sync.stage('ann',data()); await assert.rejects(sync.flush(),/NETWORK_ERROR/);
  await sync.pull(); assert.equal(sync.view().pending.length,0);
  sync.stage('ann',data('ann','next')); assert.equal(sync.view().pending[0].event.base,'local-1');
});

test('conflict discard and catch-up to a newer remote head require explicit decisions', async () => {
  let reply = page([event(2,'e2','e1'),event(3,'e3','e2')]);
  const sync = rig({snapshot: async () => ({cursor:1,annotations:[{id:'ann',base:'e1',data:data()}]}),
    events: async () => reply, append: async () => { const e=new Error('CONFLICT');e.current='e2';throw e; }});
  await sync.initialize(); sync.stage('ann',data()); await assert.rejects(sync.flush(),/CONFLICT/);
  await sync.pull(); sync.resolve('ann','replace',data('ann','chosen after reading'));
  assert.equal(sync.view().pending[0].event.base,'e3');
  await assert.rejects(sync.flush(),/CONFLICT/);
  sync.resolve('ann','discard'); assert.equal(sync.view().pending.length,0);
  assert.equal(sync.view().annotations[0].base,'e3');
});

test('concurrent operations are rejected and errors arriving after close are stale', async () => {
  let reject;
  const wait = new Promise((_,r)=>{reject=r;});
  const sync = rig({events:()=>wait}); await sync.initialize();
  const pulling = sync.pull(); await assert.rejects(sync.flush(),/BUSY/);
  sync.close(); reject(new Error('NETWORK_ERROR'));
  await assert.rejects(pulling,/STALE/);
});
