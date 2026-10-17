// Het paginabereik van de printdialoog (#606): de pagina's precies zoals ze
// getypt zijn, in die volgorde en met herhalingen. "1,1,1" drukt pagina 1
// drie keer af; het bereik van exporteren en verwijderen (parsePageRange)
// blijft een gesorteerde verzameling.

import assert from 'node:assert/strict';
import test from 'node:test';

import { printPaginaBereik } from './print-bereik.js';

test('herhalingen blijven staan: 1,1,1 is drie keer pagina 1', () => {
  assert.deepEqual(printPaginaBereik('1,1,1', 5), [1, 1, 1]);
  assert.deepEqual(printPaginaBereik('2, 2', 5), [2, 2]);
});

test('de getypte volgorde blijft staan, ook met overlappende bereiken', () => {
  assert.deepEqual(printPaginaBereik('3,1,2', 5), [3, 1, 2]);
  assert.deepEqual(printPaginaBereik('1-3,2', 5), [1, 2, 3, 2]);
  assert.deepEqual(printPaginaBereik('4-5, 1-2', 5), [4, 5, 1, 2]);
});

test('een aflopend bereik loopt af: 5-3 is 5, 4, 3', () => {
  assert.deepEqual(printPaginaBereik('5-3', 6), [5, 4, 3]);
  assert.deepEqual(printPaginaBereik('3 - 1, 1', 6), [3, 2, 1, 1]);
});

test('een bereik dat buiten het document loopt wordt begrensd, zoals bij exporteren', () => {
  assert.deepEqual(printPaginaBereik('4-9', 5), [4, 5]);
  assert.deepEqual(printPaginaBereik('0-2', 5), [1, 2]);
  assert.deepEqual(printPaginaBereik('9-4', 5), [5, 4]);
});

test('onzin, een losse pagina buiten het document of een leeg deel: niets', () => {
  for (const tekst of ['', 'a', '1,,2', '1-', '7', '0', '6-9', '1.5', '-2']) {
    assert.deepEqual(printPaginaBereik(tekst, 5), [], tekst);
  }
  assert.deepEqual(printPaginaBereik(null, 5), []);
  assert.deepEqual(printPaginaBereik('1', 0), []);
});

test('de printdialoog en de MCP-printopdracht gebruiken dit bereik, niet parsePageRange', async () => {
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const hier = dirname(fileURLToPath(import.meta.url));
  const dialoog = readFileSync(join(hier, '../solid/components/dialogs/PrintDialog.jsx'), 'utf8');
  assert.match(dialoog, /printPaginaBereik\(customPages\(\), totalPages\)/);
  assert.doesNotMatch(dialoog, /parsePageRange/);
  const brug = readFileSync(join(hier, '../mcp-bridge.js'), 'utf8');
  assert.match(brug, /bereik: printPaginaBereik/);
});
