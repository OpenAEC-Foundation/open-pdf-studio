// De MCP-gereedschappen voor paginabewerkingen, bladwijzers en watermerken
// staan op alle plekken: de brug in de WebView (js/mcp-bridge.js), de
// Rust-server (dispatch en schema), de metatabel, tools.json, de manifest van
// de Claude Desktop-extensie en de README van de stdio-brug. De namen en
// argumenten volgen het voorstel voor de Python-bibliotheek (#804).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REPO = new URL('../../../', import.meta.url);
const lees = (pad) => readFileSync(new URL(pad, REPO), 'utf8').replace(/\r\n/g, '\n');

// [tool, gebeurtenis, module, functie, verplichte argumenten]
const TOOLS = [
  ['app_rotate_pages', 'mcp:rotate-pages', './pdf/mcp-paginabewerkingen.js', 'rotatePages', ['pages', 'angle']],
  ['app_delete_pages', 'mcp:delete-pages', './pdf/mcp-paginabewerkingen.js', 'deletePages', ['pages']],
  ['app_insert_blank_pages', 'mcp:insert-blank-pages', './pdf/mcp-paginabewerkingen.js', 'insertBlankPages', ['after']],
  ['app_extract_pages', 'mcp:extract-pages', './pdf/mcp-paginabewerkingen.js', 'extractPages', ['pages', 'outputPath']],
  ['app_reorder_pages', 'mcp:reorder-pages', './pdf/mcp-paginabewerkingen.js', 'reorderPages', ['order']],
  ['app_shift_pages', 'mcp:shift-pages', './pdf/mcp-paginabewerkingen.js', 'shiftPages', ['pages']],
  ['app_bookmarks', 'mcp:bookmarks', './ui/panels/bladwijzers-mcp.js', 'bookmarks', ['action']],
  ['app_watermarks', 'mcp:watermarks', './watermark/watermerken-mcp.js', 'watermarks', ['action']],
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('de brug stuurt elke gebeurtenis naar de functie met de regels', async () => {
  const brug = lees('open-pdf-studio/js/mcp-bridge.js');
  for (const [, gebeurtenis, module, functie] of TOOLS) {
    assert.match(brug, new RegExp(`'${esc(gebeurtenis)}':\\s+\\(p\\) => import\\('${esc(module)}'\\)\\.then\\(\\(m\\) => m\\.${functie}\\(p\\)\\)`), gebeurtenis);
    const m = await import(new URL(`../${module.slice(2)}`, import.meta.url));
    assert.equal(typeof m[functie], 'function', `${module} exporteert ${functie}`);
  }
});

test('de Rust-server stuurt elk gereedschap naar zijn gebeurtenis, de metatabel kent ze', () => {
  const rs = lees('open-pdf-studio/src-tauri/src/mcp_server.rs');
  const meta = lees('open-pdf-studio/src-tauri/src/mcp_tool_meta.rs');
  for (const [naam, gebeurtenis] of TOOLS) {
    assert.match(rs, new RegExp(`"${naam}"\\s+=> tool_app_request\\(state, "${esc(gebeurtenis)}",`), `${naam} in de dispatch`);
    assert.match(meta, new RegExp(`(wijzigt|voegt_toe)\\("${naam}", "[^"]+"\\)`), `${naam} in mcp_tool_meta.rs`);
  }
  assert.match(rs, /tools\.splice\(na_samenvoegen\.\.na_samenvoegen, pagina_tools\(\)\)/);
});

test('tools.json: direct na app_merge_pdf, met de voorgestelde argumenten en zonder extra velden', () => {
  const tools = JSON.parse(lees('mcp-stdio/tools.json'));
  const i = tools.findIndex((t) => t.name === 'app_merge_pdf');
  assert.deepEqual(tools.slice(i + 1, i + 1 + TOOLS.length).map((t) => t.name), TOOLS.map((t) => t[0]));
  for (const [naam, , , , verplicht] of TOOLS) {
    const t = tools.find((x) => x.name === naam);
    assert.deepEqual(t.inputSchema.required, verplicht, `${naam} required`);
    assert.equal(t.inputSchema.additionalProperties, false, `${naam} additionalProperties`);
    assert.ok(t.annotations.title, `${naam} titel`);
  }
  const prop = (naam, veld) => tools.find((t) => t.name === naam).inputSchema.properties[veld];
  assert.deepEqual(prop('app_rotate_pages', 'angle').enum, [90, 180, 270, -90]);
  assert.equal(prop('app_delete_pages', 'pages').items.type, 'integer');
  assert.equal(prop('app_insert_blank_pages', 'after').minimum, 0);
  assert.equal(prop('app_extract_pages', 'outputPath').type, 'string');
  assert.equal(prop('app_reorder_pages', 'order').type, 'array');
  assert.ok(prop('app_shift_pages', 'dx') && prop('app_shift_pages', 'dy'));
  assert.deepEqual(prop('app_bookmarks', 'action').enum, ['list', 'add', 'update', 'delete', 'move']);
  assert.deepEqual(prop('app_watermarks', 'action').enum, ['list', 'add', 'remove']);
  assert.deepEqual(prop('app_watermarks', 'type').enum, ['text', 'image', 'headerFooter']);
});

test('de manifest en de README van de stdio-brug noemen ze', () => {
  const manifest = JSON.parse(lees('mcpb/manifest.json'));
  const leesmij = lees('mcp-stdio/README.md');
  for (const [naam] of TOOLS) {
    assert.ok(manifest.tools.some((t) => t.name === naam), `${naam} in manifest.json`);
    assert.match(leesmij, new RegExp(`\\| \`${naam}\` \\|`), `${naam} in mcp-stdio/README.md`);
  }
});

test('de dialogen gebruiken dezelfde functies als de MCP-opdrachten', () => {
  const pad = 'open-pdf-studio/js/';
  assert.match(lees(`${pad}ui/panels/bookmarks.js`), /voegBladwijzerToe\(doc, \{ \.\.\.result, parentId: null \}\)/);
  assert.match(lees(`${pad}ui/panels/bookmarks.js`), /return verplaatsBladwijzersIn\(getActiveDocument\(\), ids, doelId, positie\)/);
  assert.match(lees(`${pad}ui/panels/bookmarks.js`), /await verwijderBladwijzersUit\(doc, ids\)/);
  assert.match(lees(`${pad}solid/components/dialogs/WatermarkDialog.jsx`), /await voegWatermerkToe\(doc, wm\)/);
  assert.match(lees(`${pad}solid/components/dialogs/HeaderFooterDialog.jsx`), /await voegWatermerkToe\(doc, wm\)/);
  assert.match(lees(`${pad}solid/components/dialogs/ManageWatermarksDialog.jsx`), /await verwijderWatermerk\(doc, wm\.id\)/);
  assert.match(lees(`${pad}solid/components/dialogs/ExtractPagesDialog.jsx`), /extractPages\(pages, deleteAfter\(\)\)/);
});
