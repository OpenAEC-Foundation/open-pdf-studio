// Vrijgeven bij sluiten: welke caches mogen weg, en welke juist niet omdat
// een ander tabblad hetzelfde bestand nog gebruikt.

import assert from 'node:assert/strict';
import test from 'node:test';

import { padNogInGebruik, vrijgaveplan, sleutelsMetPad } from './document-release.js';

const doc = (id, filePath, extra = {}) => ({ id, filePath, pdfDoc: { id }, ...extra });

test('een gesloten document geeft zijn pad, bytes-sleutel en PDF.js-instantie vrij', () => {
  const dicht = doc(7, 'C:/t/a.pdf');
  const plan = vrijgaveplan(dicht, [doc(8, 'C:/t/b.pdf')]);
  assert.deepEqual(plan.paden, ['C:/t/a.pdf']);
  assert.equal(plan.memoryKey, '__memory__7');
  assert.equal(plan.pdfjsVrijgeven, true);
});

test('hetzelfde bestand in een ander tabblad houdt de caches in leven', () => {
  const dicht = doc(1, 'C:/t/a.pdf');
  const plan = vrijgaveplan(dicht, [doc(2, 'C:/t/a.pdf')]);
  assert.deepEqual(plan.paden, []);
  assert.equal(padNogInGebruik([doc(2, 'C:/t/a.pdf')], 'C:/t/a.pdf'), true);
  // Wel een eigen PDF.js-instantie: die mag dicht.
  assert.equal(plan.pdfjsVrijgeven, true);
});

test('een werkkopie na een save: doel-pad telt als gebruik, werkkopie-pad komt vrij', () => {
  // Document rendert uit een tijdelijke werkkopie, de lock staat op het echte bestand.
  const dicht = doc(3, 'C:/tmp/werk-3.pdf', { saveTargetPath: 'C:/t/echt.pdf' });
  const plan = vrijgaveplan(dicht, [doc(4, 'C:/t/echt.pdf')]);
  assert.deepEqual(plan.paden, ['C:/tmp/werk-3.pdf']);
  // En andersom: een ander tabblad dat uit een werkkopie van hetzelfde bestand
  // werkt, houdt het echte pad vast.
  const plan2 = vrijgaveplan(doc(5, 'C:/t/echt.pdf'), [doc(6, 'C:/tmp/werk-6.pdf', { saveTargetPath: 'C:/t/echt.pdf' })]);
  assert.deepEqual(plan2.paden, []);
});

test('zelfde pad als filePath én saveTargetPath staat één keer in het plan', () => {
  const plan = vrijgaveplan(doc(9, 'C:/t/a.pdf', { saveTargetPath: 'C:/t/a.pdf' }), []);
  assert.deepEqual(plan.paden, ['C:/t/a.pdf']);
});

test('nooit-opgeslagen document: geen pad, wel de bytes-sleutel', () => {
  const plan = vrijgaveplan({ id: 11, filePath: null, isUntitled: true, pdfDoc: {} }, []);
  assert.deepEqual(plan.paden, []);
  assert.equal(plan.memoryKey, '__memory__11');
  assert.equal(plan.pdfjsVrijgeven, true);
});

test('een gedeelde PDF.js-instantie wordt niet afgesloten', () => {
  const gedeeld = {};
  const plan = vrijgaveplan({ id: 1, filePath: 'C:/t/a.pdf', pdfDoc: gedeeld }, [{ id: 2, filePath: 'C:/t/b.pdf', pdfDoc: gedeeld }]);
  assert.equal(plan.pdfjsVrijgeven, false);
});

test('zonder PDF.js-instantie valt er niets af te sluiten', () => {
  assert.equal(vrijgaveplan({ id: 1, filePath: 'C:/t/a.pdf' }, []).pdfjsVrijgeven, false);
  assert.equal(vrijgaveplan(null, []).pdfjsVrijgeven, false);
  assert.deepEqual(vrijgaveplan(undefined, undefined).paden, []);
});

test('sleutels per pad: alleen exact dit pad, niet een pad met hetzelfde begin', () => {
  const sleutels = ['C:/t/a.pdf:1:0', 'C:/t/a.pdf:2:90', 'C:/t/a.pdf.bak:1:0', 'C:/t/b.pdf:1:0'];
  assert.deepEqual(sleutelsMetPad(sleutels, 'C:/t/a.pdf'), ['C:/t/a.pdf:1:0', 'C:/t/a.pdf:2:90']);
  assert.deepEqual(sleutelsMetPad(new Map([['C:/t/a.pdf:3:0', 1]]).keys(), 'C:/t/a.pdf'), ['C:/t/a.pdf:3:0']);
});
