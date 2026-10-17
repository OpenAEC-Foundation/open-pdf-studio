import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRINT_STANDAARD, PRINT_KEUZES, herstelPrintInstellingen, kiesStartPrinter, markeringenVoorInhoud,
} from './print-instellingen.js';

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
    perSheet: 'custom',
    sheetCols: 3,
    sheetRows: 4,
    sheetOrder: 'vertical-reversed',
    sheetBorder: true,
    posterScale: 50,
    posterOverlap: 7.5,
    posterCutMarks: false,
    posterLabels: false,
    posterOnlyLarge: false,
    flyerCount: '8',
    flyerCutMarks: false,
    bookletSheets: 4,
  };
  assert.deepEqual(herstelPrintInstellingen(gekozen), gekozen);
});

test('posterafdruk: Type "Poster" en de tegelkeuzes komen terug, rommel valt terug', () => {
  assert.equal(herstelPrintInstellingen({ scaling: 'poster' }).scaling, 'poster');
  const s = herstelPrintInstellingen({
    posterScale: 5000, posterOverlap: -4, posterCutMarks: 'ja', posterLabels: 0, posterOnlyLarge: null,
  });
  assert.equal(s.posterScale, 400);
  assert.equal(s.posterOverlap, 0);
  assert.equal(s.posterCutMarks, true);
  assert.equal(s.posterLabels, true);
  assert.equal(s.posterOnlyLarge, true);
  assert.equal(herstelPrintInstellingen({ posterOverlap: 'x' }).posterOverlap, 10);
  assert.equal(herstelPrintInstellingen({ posterOverlap: 99 }).posterOverlap, 50);
});

test('pagina\'s per vel: een getal uit een oud bestand telt, rommel valt terug', () => {
  assert.equal(herstelPrintInstellingen({ perSheet: 4 }).perSheet, '4');
  const s = herstelPrintInstellingen({ perSheet: 7, sheetCols: 99, sheetRows: 'x', sheetOrder: 'diagonaal', sheetBorder: 'ja' });
  assert.equal(s.perSheet, '1');
  assert.equal(s.sheetCols, 10);
  assert.equal(s.sheetRows, 2);
  assert.equal(s.sheetOrder, 'horizontal');
  assert.equal(s.sheetBorder, false);
});

test('boekje (#381): de keuze blijft bewaard', () => {
  assert.equal(herstelPrintInstellingen({ perSheet: 'booklet' }).perSheet, 'booklet');
  assert.equal(herstelPrintInstellingen({ perSheet: 'Booklet' }).perSheet, '1');
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

// --- Afdrukken: Document, of Document en markeringen --------------------------

test('elke waarde van de keuzelijst Afdrukken bepaalt of de markeringen meegaan', () => {
  assert.deepEqual([...PRINT_KEUZES.content], ['doc-and-markups', 'doc-only']);
  assert.equal(markeringenVoorInhoud('doc-and-markups'), true);
  assert.equal(markeringenVoorInhoud('doc-only'), false);
  // Elke toegestane waarde heeft een antwoord; alleen 'doc-only' laat ze weg.
  for (const waarde of PRINT_KEUZES.content) {
    assert.equal(typeof markeringenVoorInhoud(waarde), 'boolean', waarde);
    assert.equal(markeringenVoorInhoud(waarde), waarde !== 'doc-only', waarde);
  }
  // Onzin of niets: de standaard van de dialoog.
  for (const onzin of [undefined, null, '', 'alles', 42]) {
    assert.equal(markeringenVoorInhoud(onzin), true, String(onzin));
  }
  assert.equal(markeringenVoorInhoud(PRINT_STANDAARD.content), true);
});

test('de keuzelijst in de printdialoog kent precies deze waarden', async () => {
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const jsx = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../components/dialogs/PrintDialog.jsx'), 'utf8',
  );
  // Het blok van de keuzelijst Afdrukken (printContent) uit de JSX.
  const blok = jsx.split('onChange={(e) => onPrintContentChange(e.target.value)}')[1] ?? '';
  const waarden = [...blok.split('</select>')[0].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(waarden, [...PRINT_KEUZES.content]);
});

test('folder en katernen (#607): de keuzes blijven bewaard, rommel valt terug', () => {
  assert.equal(herstelPrintInstellingen({ perSheet: 'flyer' }).perSheet, 'flyer');
  assert.equal(herstelPrintInstellingen({ flyerCount: 16 }).flyerCount, '16');
  assert.equal(herstelPrintInstellingen({ flyerCount: '7' }).flyerCount, PRINT_STANDAARD.flyerCount);
  assert.equal(herstelPrintInstellingen({ flyerCutMarks: 'ja' }).flyerCutMarks, PRINT_STANDAARD.flyerCutMarks);
  assert.equal(PRINT_STANDAARD.flyerCount, '4');
  assert.equal(PRINT_STANDAARD.flyerCutMarks, true);
  assert.equal(PRINT_STANDAARD.bookletSheets, 0);
  assert.equal(herstelPrintInstellingen({ bookletSheets: 8 }).bookletSheets, 8);
  assert.equal(herstelPrintInstellingen({ bookletSheets: 7 }).bookletSheets, 0);
  assert.equal(herstelPrintInstellingen({ bookletSheets: 'x' }).bookletSheets, 0);
});

test("de keuzelijsten voor pagina's per vel en folder in de printdialoog kennen precies deze waarden", async () => {
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const jsx = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../components/dialogs/PrintDialog.jsx'), 'utf8',
  );
  const waardenNa = (merk) => {
    const blok = jsx.split(merk)[1] ?? '';
    return [...blok.split('</select>')[0].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  };
  assert.deepEqual(waardenNa('onChange={(e) => setPerSheet(e.target.value)}'), [...PRINT_KEUZES.perSheet]);
  assert.deepEqual(waardenNa('onChange={(e) => setFlyerCount(e.target.value)}'), [...PRINT_KEUZES.flyerCount]);
});
