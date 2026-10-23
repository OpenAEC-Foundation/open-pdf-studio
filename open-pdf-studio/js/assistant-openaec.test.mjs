import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_ROUNDS, TOOLS, askOpenaec, describeOpenaecError, historyMessages, openaecAvailable, runToolCall, toolDefinitions,
} from './assistant-openaec.js';

// The OpenAEC provider: questions go to the host bridge (`ai.vraag`) in OpenAI
// chat form; tool calls run in the app; every assistant message goes back
// unchanged (with openaec_denkblokken) in the next round.

const t = (key) => key;
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

test('tool definitions are OpenAI functions with a matching app command', () => {
  const defs = toolDefinitions();
  assert.equal(defs.length, TOOLS.length);
  for (const [i, def] of defs.entries()) {
    assert.equal(def.type, 'function');
    assert.equal(def.function.name, TOOLS[i].name);
    assert.equal(def.function.parameters.type, 'object');
    assert.match(TOOLS[i].event, /^mcp:/);
  }
  assert.ok(defs.some((d) => d.function.name === 'app_create_annotation'));
});

test('a tool round: the call runs in the app, the denkblokken go back unchanged', async () => {
  const first = {
    role: 'assistant',
    content: null,
    tool_calls: [call('c1', 'app_create_annotation', { type: 'stamp', page: 1, props: { text: 'Goedgekeurd' } })],
    openaec_denkblokken: 'opaque-block-1',
  };
  const asked = [];
  const ask = async (question) => {
    asked.push(structuredClone(question));
    return asked.length === 1
      ? { bericht: first, stop: 'tool_calls' }
      : { bericht: { role: 'assistant', content: 'Done.', openaec_denkblokken: 'opaque-block-2' }, stop: 'stop' };
  };
  const ran = [];
  const runEvent = async (event, params) => { ran.push([event, params]); return { ok: true, id: 'ann-7' }; };
  const history = [{ role: 'user', content: 'Put a stamp Goedgekeurd on page 1' }];

  const { text, turn } = await askOpenaec({ system: 'sys', history, ask, runEvent });

  assert.equal(text, 'Done.');
  assert.deepEqual(ran, [['mcp:create-annotation', { type: 'stamp', page: 1, props: { text: 'Goedgekeurd' } }]]);
  assert.equal(asked.length, 2);
  assert.deepEqual(asked[0].messages, [{ role: 'system', content: 'sys' }, ...history]);
  assert.ok(asked[0].tools.length > 0);
  assert.deepEqual(asked[1].messages[2], first); // unchanged, with openaec_denkblokken
  assert.deepEqual(asked[1].messages[3], { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ ok: true, id: 'ann-7' }) });
  assert.equal(turn.length, 3);
  assert.equal(turn[2].openaec_denkblokken, 'opaque-block-2');
});

test('earlier turns go back exactly as the gateway returned them', () => {
  const turn = [{ role: 'assistant', content: 'Hi', openaec_denkblokken: 'b' }];
  const msgs = [
    { role: 'assistant', greeting: true, content: '' },
    { role: 'user', content: 'shown', model: 'model text' },
    { role: 'assistant', content: 'Hi', openaec: turn },
    { role: 'user', content: 'next' },
  ];
  assert.deepEqual(historyMessages(msgs, (m) => m.model ?? m.content), [
    { role: 'user', content: 'model text' },
    ...turn,
    { role: 'user', content: 'next' },
  ]);
});

test('an unknown tool or bad arguments is a tool result, not a crash', async () => {
  const runEvent = async () => { throw new Error('should not run'); };
  assert.deepEqual(await runToolCall(call('x', 'app_unknown', {}), runEvent), { ok: false, error: 'unknown tool: app_unknown' });
  const bad = { id: 'y', type: 'function', function: { name: 'app_go_to_page', arguments: '{nope' } };
  assert.equal((await runToolCall(bad, runEvent)).ok, false);
  const failing = async () => { throw new Error('no document'); };
  assert.deepEqual(await runToolCall(call('z', 'app_go_to_page', { page: 2 }), failing), { ok: false, error: 'no document' });
});

test('stops after MAX_ROUNDS tool rounds', async () => {
  let n = 0;
  const ask = async () => { n += 1; return { bericht: { role: 'assistant', content: null, tool_calls: [call(`c${n}`, 'app_go_to_page', { page: 1 })], openaec_denkblokken: 'b' } }; };
  const { text, turn } = await askOpenaec({ system: 's', history: [], ask, runEvent: async () => ({ ok: true }) });
  assert.equal(n, MAX_ROUNDS);
  assert.equal(text, '');
  assert.equal(turn.length, MAX_ROUNDS * 2);
});

test('errors of the host bridge become a message; busy codes say no connection', () => {
  const busy = Object.assign(new Error('De AI-assistent is even druk.'), { code: 'te_druk' });
  assert.match(describeOpenaecError(busy, t), /assistant\.errorNoConnection/);
  const credit = Object.assign(new Error('Het AI-tegoed is op.'), { code: 'geen_tegoed' });
  const text = describeOpenaecError(credit, t);
  assert.match(text, /assistant\.errorFailed/);
  assert.match(text, /Het AI-tegoed is op\./);
});

test('available only when the host page offers ai.vraag', () => {
  const before = globalThis.window;
  try {
    globalThis.window = {};
    assert.equal(openaecAvailable(), false);
    globalThis.window = { __OPDS_HOST__: { storage: {} } };
    assert.equal(openaecAvailable(), false);
    globalThis.window = { __OPDS_HOST__: { ai: { vraag: async () => ({}) } } };
    assert.equal(openaecAvailable(), true);
  } finally {
    globalThis.window = before;
  }
});
