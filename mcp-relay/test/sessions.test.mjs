import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SessionStore, generateCode, secretMatches } from '../lib/sessions.mjs';

test('codes carry real entropy and avoid ambiguous characters', () => {
  const code = generateCode();
  assert.equal(code.length, 22, '22 chars over a 32-symbol alphabet is ~110 bits');
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]+$/, 'no I, L, O or U');

  // The code is a credential (D-4), so collisions must be inconceivable.
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(generateCode());
  assert.equal(seen.size, 2000);
});

test('secretMatches rejects empty, wrong and wrong-length secrets', () => {
  assert.equal(secretMatches('correct-horse', 'correct-horse'), true);
  assert.equal(secretMatches('correct-horse', 'correct-horsE'), false);
  assert.equal(secretMatches('correct-horse', 'short'), false);
  assert.equal(secretMatches('', ''), false, 'an unset secret must never match');
  assert.equal(secretMatches('secret', ''), false);
  assert.equal(secretMatches('secret', undefined), false);
  assert.equal(secretMatches(undefined, 'secret'), false);
});

test('a minted session is retrievable by its code', () => {
  const store = new SessionStore();
  const session = store.create({ author: 'Grok' });

  assert.equal(store.get(session.code)?.author, 'Grok');
  assert.equal(store.get('NOSUCHCODE'), null);
  assert.equal(store.size, 1);
});

test('attach returns the previous socket so a reload can take the session back', () => {
  const store = new SessionStore();
  const session = store.create();
  const first = { close() {} };
  const second = { close() {} };

  assert.equal(store.attach(session, first), null, 'nothing to displace on first attach');
  assert.equal(store.attach(session, second), first, 'the older tab is handed back to be closed');
  assert.equal(session.socket, second);
});

test('a late close from a replaced socket does not clear the live one', () => {
  const store = new SessionStore();
  const session = store.create();
  const first = { close() {} };
  const second = { close() {} };

  store.attach(session, first);
  store.attach(session, second);

  // `first` closes after being replaced — a real ordering, since close is async.
  assert.equal(store.detach(session, first), false);
  assert.equal(session.socket, second, 'the new tab keeps the session');

  assert.equal(store.detach(session, second), true);
  assert.equal(session.socket, null);
});

test('a detached session survives the grace window, then expires', () => {
  const store = new SessionStore({ idleMs: 60_000, graceMs: 50 });
  const session = store.create();
  const socket = { close() {} };

  store.attach(session, socket);
  store.detach(session, socket);

  assert.ok(store.get(session.code), 'still reclaimable immediately after a reload');

  session.detachedAt = Date.now() - 1000; // past the grace window
  assert.equal(store.get(session.code), null, 'gone once the grace window closes');
});

test('an idle session expires even while still connected', () => {
  const store = new SessionStore({ idleMs: 50 });
  const session = store.create();
  store.attach(session, { close() {} });

  session.lastSeen = Date.now() - 1000;
  assert.equal(store.get(session.code), null);
});

test('sweep drops expired sessions and reports them', () => {
  const store = new SessionStore({ idleMs: 50 });
  const live = store.create();
  const stale = store.create();
  stale.lastSeen = Date.now() - 1000;

  const dropped = store.sweep();
  assert.deepEqual(dropped, [stale.code]);
  assert.ok(store.get(live.code));
  assert.equal(store.size, 1);
});

test('dropping a session fails its in-flight calls rather than hanging them', async () => {
  const store = new SessionStore();
  const session = store.create();

  const { PendingTable } = await import('../lib/pending.mjs');
  session.pending = new PendingTable();
  const { promise } = session.pending.register(60_000);

  store.drop(session.code, 'expired');
  await assert.rejects(promise, /session expired/);
  assert.equal(store.size, 0);
});
