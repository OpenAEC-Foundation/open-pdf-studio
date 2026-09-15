import assert from 'node:assert/strict';
import test from 'node:test';

import { PRINT_STANDAARD, herstelPrintInstellingen, kiesStartPrinter } from './print-instellingen.js';

test('zonder opgeslagen instellingen gelden de standaardwaarden', () => {
  assert.deepEqual(herstelPrintInstellingen(undefined), PRINT_STANDAARD);
  assert.deepEqual(herstelPrintInstellingen(null), PRINT_STANDAARD);
  assert.deepEqual(herstelPrintInstellingen('kapot'), PRINT_STANDAARD);
});

test('alle gekozen instellingen komen terug', () => {
  const gekozen = {
    printer: 'Kantoor A3',
    copies: 3,
    collate: true,
    range: 'custom',
    customPages: '2-4, 7',
    subset: 'even',
    reverseOrder: true,
    scaling: 'custom-scale',
    zoom: 75,
    autoRotate: false,
    autoCenter: false,
    content: 'doc-only',
    asImage: true,
  };
  assert.deepEqual(herstelPrintInstellingen(gekozen), gekozen);
});

test('onbekende keuzes en verkeerde typen vallen terug op de standaard', () => {
  const s = herstelPrintInstellingen({
    range: 'alles', subset: 3, scaling: 'groot', content: null,
    collate: 'ja', printer: 42, customPages: ['1'],
  });
  assert.equal(s.range, 'all');
  assert.equal(s.subset, 'all');
  assert.equal(s.scaling, 'fit');
  assert.equal(s.content, 'doc-and-markups');
  assert.equal(s.collate, false);
  assert.equal(s.printer, '');
  assert.equal(s.customPages, '');
});

test('aantallen worden begrensd zoals in de dialoog', () => {
  assert.equal(herstelPrintInstellingen({ copies: 0 }).copies, 1);
  assert.equal(herstelPrintInstellingen({ copies: 5000 }).copies, 999);
  assert.equal(herstelPrintInstellingen({ copies: 'veel' }).copies, 1);
  assert.equal(herstelPrintInstellingen({ zoom: 5 }).zoom, 10);
  assert.equal(herstelPrintInstellingen({ zoom: 900 }).zoom, 400);
  assert.equal(herstelPrintInstellingen({ zoom: 62.6 }).zoom, 63);
});

test('startprinter: laatst gebruikte, anders systeemstandaard, anders de eerste', () => {
  const lijst = [{ Name: 'PDF' }, { Name: 'Kantoor A3' }, { Name: 'Plotter A0' }];
  assert.equal(kiesStartPrinter(lijst, 'Plotter A0', 'Kantoor A3'), 'Plotter A0');
  assert.equal(kiesStartPrinter(lijst, 'Verwijderde printer', 'Kantoor A3'), 'Kantoor A3');
  assert.equal(kiesStartPrinter(lijst, '', 'Onbekend'), 'PDF');
  assert.equal(kiesStartPrinter([], 'Plotter A0', 'Kantoor A3'), '');
  assert.equal(kiesStartPrinter(null, 'Plotter A0', ''), '');
});
