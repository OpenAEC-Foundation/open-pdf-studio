// Tools that write client-chosen files, start background automation or
// record irreversible audit events must carry the destructive hint, so MCP
// clients ask before every call (convention in src-tauri/src/mcp_tool_meta.rs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const meta = readFileSync(new URL('../../src-tauri/src/mcp_tool_meta.rs', import.meta.url), 'utf8');
const tools = JSON.parse(readFileSync(new URL('../../../mcp-stdio/tools.json', import.meta.url), 'utf8'));

function assertModifying(name) {
  assert.match(meta, new RegExp(`^\\s*wijzigt\\("${name}",`, 'm'), `${name} is wijzigt in mcp_tool_meta.rs`);
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `${name} in tools.json`);
  assert.equal(tool.annotations.destructiveHint, true, `${name} destructiveHint`);
  assert.equal(tool.annotations.readOnlyHint, false, `${name} readOnlyHint`);
}

test('app_portfolio writes component files and reads local files: modifying', () => {
  assertModifying('app_portfolio');
});

test('workflows (background watch, remove), drawing-set import and approval audit events: modifying', () => {
  for (const name of ['app_document_workflows', 'app_drawing_sets', 'app_approval_routing']) assertModifying(name);
});

test('createReceipt over MCP takes an explicit confirmed flag', () => {
  const tool = tools.find((t) => t.name === 'app_approval_routing');
  assert.deepEqual(tool.inputSchema.properties.confirmed, { type: 'boolean' });
  assert.match(tool.description, /createReceipt requires confirmed:true/);
});

// Paginabewerkingen, bladwijzers en watermerken: wat bestaande pagina's,
// bladwijzers of watermerken wijzigt of verwijdert, of een bestand schrijft dat
// de client kiest (app_extract_pages), vraagt altijd. Lege pagina's invoegen
// voegt alleen toe, zoals app_merge_pdf.
test('page operations, bookmarks and watermarks: modifying; inserting blank pages only adds', () => {
  for (const name of ['app_rotate_pages', 'app_delete_pages', 'app_extract_pages', 'app_reorder_pages', 'app_shift_pages', 'app_bookmarks', 'app_watermarks']) {
    assertModifying(name);
  }
  assert.match(meta, /^\s*voegt_toe\("app_insert_blank_pages",/m);
  const insert = tools.find((t) => t.name === 'app_insert_blank_pages');
  assert.equal(insert.annotations.readOnlyHint, false);
  assert.equal(insert.annotations.destructiveHint, false);
});
