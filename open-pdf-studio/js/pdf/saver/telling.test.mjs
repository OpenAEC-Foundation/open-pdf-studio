// Telmarkering opslaan en terugladen: de groepsnaam reist mee (#935), zodat
// een heropend bestand zijn telgroepen met naam terugkrijgt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import { bouwTellingDict, tellingUitExtra } from './telling.js';

const tekst = (obj) => (obj && typeof obj.decodeText === 'function' ? obj.decodeText() : null);

test('the group id and group name are written as own keys', async () => {
  const pdf = await PDFDocument.create();
  const dict = bouwTellingDict(pdf.context, {
    type: 'count', x: 10, y: 20, number: 3, categoryId: 'kleppen-ab12', categoryName: 'Kleppen DN100', color: '#00aa00',
  }, (x) => x, (y) => y);
  assert.equal(tekst(dict.get(PDFName.of('OPS_CountCategory'))), 'kleppen-ab12');
  assert.equal(tekst(dict.get(PDFName.of('OPS_CountCategoryName'))), 'Kleppen DN100');
});

test('a marker without a group writes no group name', async () => {
  const pdf = await PDFDocument.create();
  const dict = bouwTellingDict(pdf.context, { type: 'count', x: 0, y: 0, number: 1, categoryName: 'los' }, (x) => x, (y) => y);
  assert.equal(dict.get(PDFName.of('OPS_CountCategoryName')), undefined);
});

test('loading gives the marker its group and group name back', () => {
  const rect = { x: 0, y: 0, width: 20, height: 20 };
  const m = tellingUitExtra({ opsSubtype: 'count', opsCountNumber: 2, opsCountCategory: 'kleppen-ab12', opsCountCategoryName: 'Kleppen DN100' }, rect);
  assert.equal(m.categoryId, 'kleppen-ab12');
  assert.equal(m.categoryName, 'Kleppen DN100');
  assert.equal(m.number, 2);
  const zonder = tellingUitExtra({ opsSubtype: 'count', opsCountCategory: 'deuren' }, rect);
  assert.equal('categoryName' in zonder, false, 'older files without a name stay as they were');
});

test('the loader reads the group name key', () => {
  const bron = readFileSync(new URL('../loader/color-extraction.js', import.meta.url), 'utf8');
  assert.match(bron, /\['OPS_CountCategoryName', 'opsCountCategoryName'\]/);
});
