// Pure tests for the shared-session store.
//
// The rule that matters most here is the auto-open one: the pairing dialog
// must open itself the first time, because otherwise the session code only
// reaches the browser console and the feature is unusable — but it must NOT
// reappear on every reload of a tab that has already been paired.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  session, connectionState, lastActivity, agentEverAttached,
  publishSession, setSessionState, noteAgentActivity, clearSession,
  shouldAutoOpenPairing,
} from './sessionStore.js';

const SESSION = {
  code: 'G9R5PXV02Y7SD09FGC9J52',
  author: 'Grok',
  endpoint: 'https://relay.example/mcp/G9R5PXV02Y7SD09FGC9J52',
};

test('a tab with no relay has no session and shows nothing', () => {
  clearSession();
  assert.equal(session(), null);
  assert.equal(connectionState(), 'waiting');
  assert.equal(shouldAutoOpenPairing(), false,
    'the desktop build must never pop a pairing dialog');
});

test('publishing a session records the code, author and endpoint', () => {
  clearSession();
  publishSession(SESSION);

  assert.equal(session().code, SESSION.code);
  assert.equal(session().author, 'Grok');
  assert.equal(session().endpoint, SESSION.endpoint);
  assert.ok(session().at, 'timestamped so the UI can say how long it has been open');
});

test('connection state transitions are recorded', () => {
  clearSession();
  publishSession(SESSION);

  setSessionState('paired');
  assert.equal(connectionState(), 'paired');
  setSessionState('lost');
  assert.equal(connectionState(), 'lost');
  setSessionState('displaced');
  assert.equal(connectionState(), 'displaced');
});

test('the dialog auto-opens on a fresh session', () => {
  clearSession();
  publishSession(SESSION);
  assert.equal(shouldAutoOpenPairing(), true);
});

test('once an agent has attached, the dialog stops opening itself', () => {
  clearSession();
  publishSession(SESSION);
  assert.equal(shouldAutoOpenPairing(), true);

  noteAgentActivity('create-annotation');

  assert.equal(agentEverAttached(), true);
  assert.equal(shouldAutoOpenPairing(), false,
    'a tab that has been paired must not get the dialog in the face again');
});

test('activity is recorded with a description for the status line', () => {
  clearSession();
  publishSession(SESSION);
  noteAgentActivity('commit-batch');

  assert.equal(lastActivity().description, 'commit-batch');
  assert.ok(typeof lastActivity().at === 'number');
});

test('clearing the session resets state but not the ever-attached memory', () => {
  clearSession();
  publishSession(SESSION);
  noteAgentActivity('create-annotation');
  clearSession();

  assert.equal(session(), null);
  assert.equal(connectionState(), 'waiting');
  assert.equal(lastActivity(), null);
  // agentEverAttached is deliberately sticky for the life of the tab: a
  // dropped socket that reconnects should not re-trigger the dialog.
  assert.equal(agentEverAttached(), true);
  assert.equal(shouldAutoOpenPairing(), false);
});
