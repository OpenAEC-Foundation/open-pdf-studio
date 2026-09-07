import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PendingTable } from '../lib/pending.mjs';

test('resolve settles the parked promise with the app result', async () => {
  const table = new PendingTable();
  const { id, promise } = table.register(1000);

  assert.equal(table.size, 1);
  assert.equal(table.resolve(id, { ok: true, value: 7 }), true);
  assert.deepEqual(await promise, { ok: true, value: 7 });
  assert.equal(table.size, 0, 'the slot is released once settled');
});

test('ids are unique across registrations', async () => {
  const table = new PendingTable();
  const registered = [table.register(1000), table.register(1000), table.register(1000)];
  // failAll rejects each parked promise, so attach handlers before tearing
  // down or the rejections escape the test as unhandled.
  const settled = registered.map((r) => r.promise.catch(() => {}));

  assert.equal(new Set(registered.map((r) => r.id)).size, 3);
  table.failAll('cleanup');
  await Promise.all(settled);
});

test('a timeout rejects and frees the slot so ids cannot leak', async () => {
  const table = new PendingTable();
  const { promise } = table.register(10);

  await assert.rejects(promise, /timed out after 10ms/);
  assert.equal(table.size, 0);
});

test('resolving an unknown id is a no-op, not a throw', () => {
  const table = new PendingTable();
  // A response that arrives after its request timed out, or a duplicate.
  assert.equal(table.resolve(999, { ok: true }), false);
});

test('a second response for the same id is dropped', async () => {
  const table = new PendingTable();
  const { id, promise } = table.register(1000);

  assert.equal(table.resolve(id, { first: true }), true);
  assert.equal(table.resolve(id, { second: true }), false);
  assert.deepEqual(await promise, { first: true });
});

test('fail rejects one request — used when the socket send throws', async () => {
  const table = new PendingTable();
  const { id, promise } = table.register(1000);

  table.fail(id, new Error('socket closed'));
  await assert.rejects(promise, /socket closed/);
  assert.equal(table.size, 0);
});

test('failAll rejects every in-flight request when the tab disconnects', async () => {
  const table = new PendingTable();
  const a = table.register(5000);
  const b = table.register(5000);

  assert.equal(table.failAll('the browser tab disconnected'), 2);
  await assert.rejects(a.promise, /browser tab disconnected/);
  await assert.rejects(b.promise, /browser tab disconnected/);
  assert.equal(table.size, 0);
});

test('a timer never keeps the process alive', () => {
  // register() unrefs its timer; without that a single in-flight request
  // would hold the relay open for its full timeout on shutdown.
  const table = new PendingTable();
  const { promise } = table.register(60_000);
  promise.catch(() => {});
  assert.equal(table.size, 1);
  table.failAll('done');
});
