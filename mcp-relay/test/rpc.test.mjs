import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { eventNameForTool, isNotification, timeoutForTool, toolContent, toolError } from '../lib/rpc.mjs';
import { buildToolList, WITHHELD_TOOLS, ADDED_TOOLS } from '../scripts/extract-tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUST = join(HERE, '..', '..', 'open-pdf-studio', 'src-tauri', 'src', 'mcp_server.rs');
const BRIDGE = join(HERE, '..', '..', 'open-pdf-studio', 'js', 'mcp-bridge.js');

test('tool names map to the event names the bridge listens on', () => {
  assert.equal(eventNameForTool('app_open_pdf'), 'mcp:open-pdf');
  assert.equal(eventNameForTool('app_create_annotation'), 'mcp:create-annotation');
  assert.equal(eventNameForTool('app_get_viewport_state'), 'mcp:get-viewport-state');
  assert.equal(eventNameForTool('app_ai_complete'), 'mcp:ai-complete');
  assert.equal(eventNameForTool('app_commit_batch'), 'mcp:commit-batch');
});

test('non-app tools have no browser event — they were Rust-side on the desktop', () => {
  assert.equal(eventNameForTool('screenshot_page'), null);
  assert.equal(eventNameForTool('list_test_pdfs'), null);
  assert.equal(eventNameForTool('get_pdf_metadata'), null);
  assert.equal(eventNameForTool(undefined), null);
});

test('every advertised app_ tool has a handler registered in mcp-bridge.js', () => {
  const { tools } = buildToolList(readFileSync(RUST, 'utf8'));
  const bridge = readFileSync(BRIDGE, 'utf8');

  const missing = [];
  for (const tool of tools) {
    const event = eventNameForTool(tool.name);
    if (!event) continue; // off-app tool, no browser handler expected
    if (!bridge.includes(`'${event}'`)) missing.push(`${tool.name} -> ${event}`);
  }
  assert.deepEqual(missing, [], 'advertising a tool with no handler makes the agent hang until timeout');
});

test('app_undo and app_redo are withheld from the tool list', () => {
  const { tools } = buildToolList(readFileSync(RUST, 'utf8'));
  const names = new Set(tools.map((t) => t.name));

  for (const withheld of WITHHELD_TOOLS) {
    assert.equal(names.has(withheld), false, `${withheld} must not reach the agent`);
  }
});

test('the removed undo handlers are actually gone from the bridge', () => {
  // Withholding them from tools/list is only half the fix — if the handlers
  // were still wired, a hand-written tools/call would reach them.
  const bridge = readFileSync(BRIDGE, 'utf8');
  assert.equal(bridge.includes("'mcp:undo'"), false);
  assert.equal(bridge.includes("'mcp:redo'"), false);
});

test('relay-only tools are added and carry a schema', () => {
  const { tools } = buildToolList(readFileSync(RUST, 'utf8'));
  for (const added of ADDED_TOOLS) {
    const found = tools.find((t) => t.name === added.name);
    assert.ok(found, `${added.name} should be advertised`);
    assert.equal(found.inputSchema.type, 'object');
    assert.ok(found.description.length > 40, 'an agent needs to know when to call it');
  }
});

test('every extracted tool has a name, description and object input schema', () => {
  const { tools } = buildToolList(readFileSync(RUST, 'utf8'));
  assert.ok(tools.length > 40, `expected the full tool surface, got ${tools.length}`);

  for (const tool of tools) {
    assert.equal(typeof tool.name, 'string', 'tool has a name');
    assert.ok(tool.name.length > 0);
    assert.equal(typeof tool.description, 'string', `${tool.name} has a description`);
    assert.equal(tool.inputSchema?.type, 'object', `${tool.name} takes an object`);
  }
});

test('the committed tools.json matches what the Rust source produces', () => {
  const committed = JSON.parse(readFileSync(join(HERE, '..', 'tools.json'), 'utf8'));
  const { tools } = buildToolList(readFileSync(RUST, 'utf8'));
  assert.deepEqual(
    committed.tools.map((t) => t.name),
    tools.map((t) => t.name),
    'tools.json is stale — re-run node mcp-relay/scripts/extract-tools.mjs',
  );
});

test('long-poll tools get a budget past the app-side timeout', () => {
  // assistant-mcp-relay.js parks a question for 600s. A relay timeout shorter
  // than that would fail the call while the app is still legitimately waiting.
  assert.ok(timeoutForTool('app_assistant_pending') > 600_000);
  assert.ok(timeoutForTool('app_save_pdf') > timeoutForTool('app_set_zoom'));
  assert.equal(timeoutForTool('app_create_annotation'), 30_000);
});

test('notifications are requests without an id', () => {
  assert.equal(isNotification({ jsonrpc: '2.0', method: 'notifications/initialized' }), true);
  assert.equal(isNotification({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), false);
  assert.equal(isNotification(null), false);
  assert.equal(isNotification([1, 2]), false);
});

test('tool results travel as one text block, errors flagged', () => {
  const ok = toolContent({ ok: true, id: 'a1' });
  assert.equal(ok.content[0].type, 'text');
  assert.deepEqual(JSON.parse(ok.content[0].text), { ok: true, id: 'a1' });
  assert.equal(ok.isError, undefined);

  const bad = toolError('no active document');
  assert.equal(bad.isError, true);
  assert.deepEqual(JSON.parse(bad.content[0].text), { ok: false, error: 'no active document' });
});
