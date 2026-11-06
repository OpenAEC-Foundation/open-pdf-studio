// Tekeningkaders uit de huisstijl van het bedrijf (pdf/huisstijl-kaders.js):
// de kaders van de site via __OPDS_HOST__.huisstijl(), de maat van het vel en
// het vel zelf met de velden als invulvelden. Sjabloon en logo hebben een
// canvas nodig en zitten in de browserproef, niet hier.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';

import { kaderLabel, kaderMaat, laadHuisstijlKaders, maakKaderPdf } from './huisstijl-kaders.js';

const KADER = {
  naam: 'Tekening',
  formaat: 'A3',
  orientatie: 'liggend',
  standaard: true,
  velden: [
    { veld: 'projectnaam', label: 'Projectnaam', x_mm: 300, y_mm: 20, lettergrootte: 10, uitlijning: 'links' },
    { veld: 'projectnummer', label: 'Projectnummer', x_mm: 400, y_mm: 20, lettergrootte: 8, uitlijning: 'rechts' },
  ],
  template: null,
  logo: null,
};

test('zonder site geen kaders', async () => {
  globalThis.window = {};
  assert.deepEqual(await laadHuisstijlKaders(), []);
});

test('de kaders van de site, met merk en id; een kader zonder maat valt weg', async () => {
  globalThis.window = { __OPDS_HOST__: { huisstijl: async () => ({ merk: 'Dorphout', kaders: [KADER, { naam: 'Raar', formaat: 'X9' }] }) } };
  const kaders = await laadHuisstijlKaders();
  assert.equal(kaders.length, 1);
  assert.equal(kaders[0].id, 'huisstijl:0');
  assert.equal(kaderLabel(kaders[0]), 'Dorphout – Tekening A3 (liggend)');
});

test('een fout van de site geeft geen kaders', async () => {
  globalThis.window = { __OPDS_HOST__: { huisstijl: async () => { throw new Error('weg'); } } };
  assert.deepEqual(await laadHuisstijlKaders(), []);
});

test('maat: eigen breedte en hoogte, anders de ISO-maat in de richting', () => {
  assert.deepEqual(kaderMaat({ breedte_mm: 500, hoogte_mm: 300 }), { breedteMm: 500, hoogteMm: 300 });
  assert.deepEqual(kaderMaat({ formaat: 'A3', orientatie: 'liggend' }), { breedteMm: 420, hoogteMm: 297 });
  assert.deepEqual(kaderMaat({ formaat: 'a4', orientatie: 'staand' }), { breedteMm: 210, hoogteMm: 297 });
  assert.equal(kaderMaat({ formaat: 'Letter' }), null);
});

test('het vel heeft de maat van het kader en de velden als invulvelden', async () => {
  const { bytes, widthPt, heightPt } = await maakKaderPdf(KADER);
  assert.ok(Math.abs(widthPt - (420 / 25.4) * 72) < 0.01);
  const pdf = await PDFDocument.load(bytes);
  const { width, height } = pdf.getPage(0).getSize();
  assert.ok(Math.abs(width - widthPt) < 0.01 && Math.abs(height - heightPt) < 0.01);
  const velden = pdf.getForm().getFields().map((v) => v.getName()).sort();
  assert.deepEqual(velden, ['projectnaam', 'projectnummer']);
  const nummer = pdf.getForm().getTextField('projectnummer');
  const [rect] = nummer.acroField.getWidgets().map((w) => w.getRectangle());
  // Rechts uitgelijnd: het veld eindigt bij x_mm.
  assert.ok(Math.abs(rect.x + rect.width - (400 / 25.4) * 72) < 0.01);
});
