// End-to-end: agent → HTTP JSON-RPC → relay → WebSocket → "browser" → back.
//
// The fake tab here stands in for js/mcp-bridge.js: it announces the events it
// has handlers for, answers `req` frames with a `res`, and otherwise does
// nothing. If this passes, the transport swap works — the real bridge speaks
// the same three frames.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

import { createRelay } from '../server.mjs';

const SECRET = 'test-secret-do-not-reuse';
let relay;
let base;
let journalDir;

before(async () => {
  journalDir = await mkdtemp(join(tmpdir(), 'ops-relay-test-'));
  relay = createRelay({ secret: SECRET, journalDir });
  const port = await relay.listen(0);
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await relay?.close();
  if (journalDir) await rm(journalDir, { recursive: true, force: true });
});

/** Mint a session the way the browser tab does on load. */
async function mintSession(author = 'Grok') {
  const res = await fetch(`${base}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ author }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.match(body.code, /^[0-9A-HJKMNP-TV-Z]{22}$/);
  return body.code;
}

/** A stand-in for the app tab. `respond` decides what each event returns. */
function fakeTab(code, { events, respond }) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?code=${code}`);
  const ready = new Promise((resolve, reject) => {
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.t === 'ready') return resolve(msg);
      if (msg.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }));
      if (msg.t === 'req') {
        const result = respond(msg.event, msg.params);
        if (result !== undefined) ws.send(JSON.stringify({ t: 'res', id: msg.id, result }));
      }
    });
  });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', events, author: 'Grok' })));
  return { ws, ready };
}

/** Call a tool the way the agent does. */
async function callTool(code, name, args = {}, secret = SECRET) {
  const res = await fetch(`${base}/mcp/${code}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  return { status: res.status, body: await res.json() };
}

test('health reports the advertised tool surface', async () => {
  const body = await (await fetch(`${base}/health`)).json();
  assert.equal(body.ok, true);
  assert.ok(body.tools > 40);
});

test('a tool call reaches the tab and the answer comes back', async () => {
  const code = await mintSession();
  const seen = [];
  const tab = fakeTab(code, {
    events: ['mcp:create-annotation', 'mcp:list-annotations'],
    respond: (event, params) => {
      seen.push({ event, params });
      return { ok: true, id: 'a1', annotation: { id: 'a1', type: params.type, author: 'Grok' } };
    },
  });
  await tab.ready;

  const { status, body } = await callTool(code, 'app_create_annotation', {
    type: 'box', page: 1, props: { x: 40, y: 40, width: 1144, height: 712 },
  });

  assert.equal(status, 200);
  const payload = JSON.parse(body.result.content[0].text);
  assert.equal(payload.ok, true);
  assert.equal(payload.annotation.author, 'Grok', 'attribution survives the round trip');

  assert.equal(seen.length, 1);
  assert.equal(seen[0].event, 'mcp:create-annotation', 'tool name mapped to the bridge event name');
  assert.equal(seen[0].params.type, 'box');

  tab.ws.close();
});

test('tools/list advertises the extracted surface and withholds undo', async () => {
  const code = await mintSession();
  const res = await fetch(`${base}/mcp/${code}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }),
  });
  const body = await res.json();
  const names = body.result.tools.map((t) => t.name);

  assert.ok(names.includes('app_create_annotation'));
  assert.ok(names.includes('app_commit_batch'));
  assert.equal(names.includes('app_undo'), false);
  assert.equal(names.includes('app_redo'), false);
});

test('calling app_undo explains why it is gone rather than just failing', async () => {
  const code = await mintSession();
  const { body } = await callTool(code, 'app_undo');

  assert.equal(body.result.isError, true);
  const payload = JSON.parse(body.result.content[0].text);
  assert.match(payload.error, /share one undo stack/);
  assert.match(payload.error, /app_delete_annotation/, 'points at what to use instead');
});

test('a call with no tab attached says so instead of hanging', async () => {
  const code = await mintSession();
  const { body } = await callTool(code, 'app_create_annotation', { type: 'box' });

  assert.equal(body.result.isError, true);
  assert.match(JSON.parse(body.result.content[0].text).error, /no browser tab is attached/);
});

test('a tool the tab has no handler for is refused, not left to time out', async () => {
  const code = await mintSession();
  const tab = fakeTab(code, { events: ['mcp:create-annotation'], respond: () => ({ ok: true }) });
  await tab.ready;

  const { body } = await callTool(code, 'app_screenshot_view', {});
  assert.equal(body.result.isError, true);
  assert.match(JSON.parse(body.result.content[0].text).error, /did not register a handler/);

  tab.ws.close();
});

test('a wrong or missing bearer token is rejected', async () => {
  const code = await mintSession();

  const wrong = await callTool(code, 'app_get_page_count', {}, 'not-the-secret');
  assert.equal(wrong.status, 401);

  const none = await fetch(`${base}/mcp/${code}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(none.status, 401);
});

test('an unknown session code is rejected even with a valid token', async () => {
  const { status } = await callTool('ZZZZZZZZZZZZZZZZZZZZZZ', 'app_get_page_count');
  assert.equal(status, 404);
});

test('forwarded calls land in the journal, mutating ones marked replayable', async () => {
  const code = await mintSession();
  const tab = fakeTab(code, {
    events: ['mcp:create-annotation', 'mcp:get-viewport-state'],
    respond: () => ({ ok: true }),
  });
  await tab.ready;

  await callTool(code, 'app_create_annotation', { type: 'box', page: 1 });
  await callTool(code, 'app_get_viewport_state', {});

  const all = await (await fetch(`${base}/journal/${code}`, {
    headers: { authorization: `Bearer ${SECRET}` },
  })).json();
  assert.equal(all.count, 2, 'every forwarded call is recorded');
  assert.deepEqual(all.entries.map((e) => e.n), [1, 2], 'sequence numbers are dense and ordered');

  const replay = await (await fetch(`${base}/journal/${code}?replayable=1`, {
    headers: { authorization: `Bearer ${SECRET}` },
  })).json();
  assert.equal(replay.count, 1, 'reading the viewport is not part of a replay');
  assert.equal(replay.entries[0].tool, 'app_create_annotation');
  assert.deepEqual(replay.entries[0].params, { type: 'box', page: 1 });

  tab.ws.close();
});

test('a failed call is journalled as failed so replay will not re-issue it', async () => {
  const code = await mintSession();
  const tab = fakeTab(code, {
    events: ['mcp:create-annotation'],
    respond: () => ({ ok: false, error: 'width must be > 0' }),
  });
  await tab.ready;

  await callTool(code, 'app_create_annotation', { type: 'box' });

  const replay = await (await fetch(`${base}/journal/${code}?replayable=1`, {
    headers: { authorization: `Bearer ${SECRET}` },
  })).json();
  assert.equal(replay.count, 0);

  tab.ws.close();
});

test('the journal needs the bearer token too', async () => {
  const code = await mintSession();
  const res = await fetch(`${base}/journal/${code}`);
  assert.equal(res.status, 401);
});

test('a second tab takes the session and the first is told why', async () => {
  const code = await mintSession();
  const first = fakeTab(code, { events: ['mcp:get-page-count'], respond: () => ({ ok: true, pageCount: 1 }) });
  await first.ready;

  const farewell = new Promise((resolve) => {
    first.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.t === 'bye') resolve(msg.reason);
    });
  });

  const second = fakeTab(code, { events: ['mcp:get-page-count'], respond: () => ({ ok: true, pageCount: 3 }) });
  await second.ready;

  assert.match(await farewell, /another tab attached/);

  // The live session is the new tab, not the displaced one.
  const { body } = await callTool(code, 'app_get_page_count');
  assert.equal(JSON.parse(body.result.content[0].text).pageCount, 3);

  second.ws.close();
});

test('losing the tab fails in-flight calls instead of hanging the agent', async () => {
  const code = await mintSession();
  // Accept the request and never answer, then drop the socket.
  const tab = fakeTab(code, { events: ['mcp:save-pdf'], respond: () => undefined });
  await tab.ready;

  const pending = callTool(code, 'app_save_pdf', { path: '/tmp/x.pdf' });
  await new Promise((r) => setTimeout(r, 50));
  tab.ws.terminate();

  const { body } = await pending;
  assert.equal(body.result.isError, true);
  assert.match(JSON.parse(body.result.content[0].text).error, /disconnected/);
});

test('notifications are accepted without a response body', async () => {
  const code = await mintSession();
  const res = await fetch(`${base}/mcp/${code}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(res.status, 202);
});
