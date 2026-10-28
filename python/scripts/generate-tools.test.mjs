// De Python-bibliotheek (#518) heeft één bron: mcp-stdio/tools.json. Deze test
// faalt zodra python/src/open_pdf_studio/_tools.py achterloopt op die lijst,
// en bewaakt de vertaling van namen en schema's naar Python.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { genereer, leesTools, pyMethod, pyParam, snakeCase, UITVOER } from './generate-tools.mjs';

const lf = (s) => s.replace(/\r\n/g, '\n');

test('_tools.py is gegenereerd uit de huidige tools.json', () => {
  const verwacht = genereer(leesTools());
  assert.equal(lf(readFileSync(UITVOER, 'utf8')), verwacht,
    'python/src/open_pdf_studio/_tools.py loopt achter: draai node python/scripts/generate-tools.mjs');
});

test('elk gereedschap krijgt precies één Python-methode', () => {
  const tools = leesTools();
  const tekst = genereer(tools);
  for (const t of tools) {
    assert.match(tekst, new RegExp(`\\n    def ${pyMethod(t.name)}\\(self`), t.name);
    assert.ok(tekst.includes(`return self._call_tool("${t.name}", `), t.name);
  }
  assert.equal(new Set(tools.map((t) => pyMethod(t.name))).size, tools.length);
});

test('namen worden snake_case zonder botsing met Python', () => {
  assert.equal(snakeCase('widthPt'), 'width_pt');
  assert.equal(snakeCase('labelsYFromBottom'), 'labels_y_from_bottom');
  assert.equal(snakeCase('x1'), 'x1');
  assert.equal(pyParam('from'), 'from_');
  assert.equal(pyParam('class'), 'class_');
  assert.equal(pyParam('type'), 'type');
  assert.equal(pyMethod('app_get_page_count'), 'get_page_count');
  assert.equal(pyMethod('app_import'), 'import_');
});

test('verplichte parameters positioneel, de rest keyword-only met hun MCP-naam', () => {
  const tekst = genereer([{
    name: 'app_demo',
    description: 'Demo """ with \\ backslash.',
    inputSchema: {
      type: 'object',
      properties: {
        filePaths: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', enum: ['a', 'b'] },
        when: { type: ['string', 'null'] },
      },
      required: ['filePaths'],
    },
    annotations: { title: 'Demo', readOnlyHint: true, destructiveHint: false },
  }]);
  assert.match(tekst, /def demo\(self, file_paths: List\[str\], \*, mode: Optional\[Literal\["a", "b"\]\] = None, when: Optional\[str\] = None\) -> Any:/);
  assert.match(tekst, /_pack\(\{"filePaths": file_paths, "mode": mode, "when": when\}\)/);
  assert.ok(tekst.includes('Demo \\"\\"\\" with \\\\ backslash.'), 'docstring-escapes');
  assert.ok(tekst.includes('"required": ("filePaths",),'));
});

test('twee gereedschappen met dezelfde Python-naam zijn een fout', () => {
  const t = (name) => ({ name, inputSchema: { type: 'object', properties: {} } });
  assert.throws(() => genereer([t('app_get_x'), t('get_x')]), /two tools map/);
  assert.throws(() => genereer([]), /no tools/);
});
