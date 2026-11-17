// De stdio-brug: doorsturen naar de app, en zelf antwoorden als de app niet
// draait — anders ziet Claude Desktop een lege extensie zolang de app dicht is.

import assert from 'node:assert/strict';
import test from 'node:test';
import { maakBrug, NIET_BEREIKBAAR } from './brug.mjs';

const TOOLS = [{ name: 'app_list_tabs', description: 'x', inputSchema: { type: 'object' } }];
const plat = async () => { throw new Error('ECONNREFUSED'); };
const app = (antwoord) => async (_url, init) => ({ text: async () => antwoord(JSON.parse(init.body)) });
const vraag = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

test('draait de app, dan gaat alles door', async () => {
  const verwerk = maakBrug({
    endpoint: 'http://127.0.0.1:9223/mcp', tools: TOOLS, versie: '1.0.0',
    fetchFn: app((m) => JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: ['live'] } })),
  });
  assert.deepEqual(JSON.parse(await verwerk(vraag(1, 'tools/list'))).result.tools, ['live']);
});

test('zonder app: initialize wordt lokaal beantwoord', async () => {
  const verwerk = maakBrug({ endpoint: 'x', tools: TOOLS, versie: '1.99.0', fetchFn: plat });
  const r = JSON.parse(await verwerk(vraag(1, 'initialize', { protocolVersion: '2025-06-18' })));
  assert.equal(r.result.serverInfo.name, 'open-pdf-studio');
  assert.equal(r.result.serverInfo.version, '1.99.0');
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.ok(r.result.capabilities.tools);
});

test('zonder app: tools/list komt uit de meegeleverde lijst', async () => {
  const verwerk = maakBrug({ endpoint: 'x', tools: TOOLS, versie: '1', fetchFn: plat });
  assert.deepEqual(JSON.parse(await verwerk(vraag(2, 'tools/list'))).result.tools, TOOLS);
});

test('zonder app: een aanroep zegt wat de gebruiker moet doen', async () => {
  const verwerk = maakBrug({ endpoint: 'x', tools: TOOLS, versie: '1', fetchFn: plat });
  const r = JSON.parse(await verwerk(vraag(3, 'tools/call', { name: 'app_list_tabs', arguments: {} })));
  assert.equal(r.result.isError, true);
  assert.equal(r.result.content[0].text, NIET_BEREIKBAAR);
});

test('notificaties krijgen geen antwoord, ping wel', async () => {
  const verwerk = maakBrug({ endpoint: 'x', tools: TOOLS, versie: '1', fetchFn: plat });
  assert.equal(await verwerk(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })), null);
  assert.deepEqual(JSON.parse(await verwerk(vraag(4, 'ping'))).result, {});
});

test('ongeldige invoer wordt genegeerd', async () => {
  const verwerk = maakBrug({ endpoint: 'x', tools: TOOLS, versie: '1', fetchFn: plat });
  assert.equal(await verwerk('geen json'), null);
  assert.equal(await verwerk('   '), null);
});

test('een leeg antwoord van de app wordt een nette fout', async () => {
  const verwerk = maakBrug({ endpoint: 'x', tools: TOOLS, versie: '1', fetchFn: app(() => '') });
  const r = JSON.parse(await verwerk(vraag(5, 'tools/list')));
  assert.equal(r.id, 5);
  assert.equal(r.error.code, -32002);
});

test('de meegeleverde lijst is de publieke lijst van de app, met annotaties', async () => {
  const { readFileSync } = await import('node:fs');
  const lijst = JSON.parse(readFileSync(new URL('./tools.json', import.meta.url), 'utf8'));
  assert.equal(lijst.length, 96);
  for (const t of lijst) {
    assert.ok(t.annotations?.title, `${t.name} zonder titel`);
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
    assert.equal(typeof t.annotations.destructiveHint, 'boolean');
  }
  assert.ok(!lijst.some((t) => t.name === 'list_test_pdfs'), 'geen testgereedschap');
});


test('capture image content and legacy metadata reach stdio clients intact', async () => {
  for (const [name, mimeType, key] of [
    ['app_screenshot_view', 'image/png', 'png_base64'],
    ['app_capture_region', 'image/jpeg', 'image_base64'],
  ]) {
    const result = { content: [
      { type: 'text', text: JSON.stringify({ ok: true, [key]: 'aW1hZ2U=', width: 2, height: 1 }) },
      { type: 'image', data: 'aW1hZ2U=', mimeType },
    ], isError: false };
    const verwerk = maakBrug({ endpoint: 'x', tools: TOOLS, versie: '1',
      fetchFn: app((m) => JSON.stringify({ jsonrpc: '2.0', id: m.id, result })),
    });
    const actual = JSON.parse(await verwerk(vraag(8, 'tools/call', { name, arguments: {} })));
    assert.equal(actual.id, 8);
    assert.deepEqual(actual.result, result);
  }
});
