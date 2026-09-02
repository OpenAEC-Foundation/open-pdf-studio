import assert from 'node:assert/strict';
import test from 'node:test';

import { catalogusOpslagkeuze, isCatalogusVerwijzing, CATALOGUS_BESTAND_DREMPEL } from './catalog-opslagkeuze.js';

test('kleine catalogus blijft inline, grote gaat naar een bestand', () => {
  assert.equal(catalogusOpslagkeuze(1000, true), 'inline');
  assert.equal(catalogusOpslagkeuze(CATALOGUS_BESTAND_DREMPEL + 1, true), 'bestand');
});

test('buiten Tauri altijd inline — daar is geen bestandsopslag', () => {
  assert.equal(catalogusOpslagkeuze(10 * 1024 * 1024, false), 'inline');
});

test('verwijzing wordt herkend, echte catalogi en rommel niet', () => {
  assert.equal(isCatalogusVerwijzing({ extern: true }), true);
  assert.equal(isCatalogusVerwijzing({ families: [] }), false);
  assert.equal(isCatalogusVerwijzing(null), false);
  assert.equal(isCatalogusVerwijzing('x'), false);
});
