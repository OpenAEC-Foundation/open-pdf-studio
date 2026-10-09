import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const laad = (taal) => JSON.parse(readFileSync(new URL(`../i18n/locales/${taal}/appMenu.json`, import.meta.url), 'utf8'));

test('de gevlakte kopie heeft een titel en uitleg in en en nl', () => {
  for (const taal of ['en', 'nl']) {
    const p = laad(taal).exportPanel;
    assert.ok(p.exportFlat && p.exportFlat.length > 3, taal);
    assert.ok(p.exportFlatDesc && p.exportFlatDesc.length > 20, taal);
  }
});

test('het ExportPanel start de gevlakte kopie vanuit flattened-copy.js', () => {
  const bron = readFileSync(new URL('../solid/components/app-menu/ExportPanel.jsx', import.meta.url), 'utf8');
  assert.ok(bron.includes("pdf/flattened-copy.js"));
  assert.ok(bron.includes('maakGevlakteKopie'));
  const kopie = readFileSync(new URL('./flattened-copy.js', import.meta.url), 'utf8');
  assert.ok(kopie.includes("vel: 'pagina'") && kopie.includes("inhoud: 'doc-and-markups'"));
});
