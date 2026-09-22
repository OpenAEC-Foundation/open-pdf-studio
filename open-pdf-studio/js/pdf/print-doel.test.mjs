// Het doel van de printdialoog: een printer, of "Opslaan als PDF".

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOEL_PDF, isPdfDoel, zelfdeBestand, doelIsGeopend, standaardDoelPad, isBestandsPrinter,
} from './print-doel.js';
import { kiesStartPrinter } from '../solid/stores/print-instellingen.js';

test('het doel "Opslaan als PDF" is geen printernaam', () => {
  assert.equal(isPdfDoel(DOEL_PDF), true);
  for (const naam of ['', 'Een printer', null, undefined, 'PDF']) assert.equal(isPdfDoel(naam), false, String(naam));
  // Geen tekens die in een printernaam kunnen voorkomen en toch herkenbaar.
  assert.match(DOEL_PDF, /^\0?[a-z:_-]+$/i);
});

test('het laatst gebruikte doel "Opslaan als PDF" komt terug, ook zonder printers', () => {
  const printers = [{ Name: 'Kantoor' }, { Name: 'Plotter' }];
  assert.equal(kiesStartPrinter(printers, DOEL_PDF, 'Kantoor'), DOEL_PDF);
  assert.equal(kiesStartPrinter([], DOEL_PDF, ''), DOEL_PDF);
  // Zonder voorkeur en zonder printers blijft alleen het bestand over.
  assert.equal(kiesStartPrinter([], '', ''), '');
  assert.equal(kiesStartPrinter(printers, 'Verdwenen', 'Plotter'), 'Plotter');
});

test('zelfde bestand: ongeacht hoofdletters en de richting van de schuine strepen', () => {
  assert.equal(zelfdeBestand('C:\\Werk\\Tekening.pdf', 'c:/werk/tekening.PDF'), true);
  assert.equal(zelfdeBestand('C:\\Werk\\Tekening.pdf', 'C:\\Werk\\.\\Tekening.pdf'), true);
  assert.equal(zelfdeBestand('C:\\Werk\\a\\..\\Tekening.pdf', 'C:\\Werk\\Tekening.pdf'), true);
  assert.equal(zelfdeBestand('/home/ik/a.pdf', '/home/ik/a.pdf'), true);
  assert.equal(zelfdeBestand('C:\\Werk\\Tekening.pdf', 'C:\\Werk\\Tekening - afdruk.pdf'), false);
  for (const leeg of [null, undefined, '']) {
    assert.equal(zelfdeBestand(leeg, 'C:\\a.pdf'), false);
    assert.equal(zelfdeBestand(leeg, leeg), false);
  }
});

test('het doelbestand mag geen geopend bestand zijn: niet het bestand zelf, niet zijn werkkopie', () => {
  const documenten = [
    { filePath: 'C:\\Temp\\opds-edit-1.pdf', saveTargetPath: 'C:\\Werk\\Tekening.pdf' },
    { filePath: 'C:\\Werk\\Ander.pdf' },
    null,
  ];
  assert.equal(doelIsGeopend('c:\\werk\\tekening.pdf', documenten), true);
  assert.equal(doelIsGeopend('C:/Temp/opds-edit-1.pdf', documenten), true);
  assert.equal(doelIsGeopend('C:\\Werk\\Ander.pdf', documenten), true);
  assert.equal(doelIsGeopend('C:\\Werk\\Tekening - afdruk.pdf', documenten), false);
  assert.equal(doelIsGeopend('C:\\Werk\\Tekening.pdf', []), false);
  assert.equal(doelIsGeopend('', documenten), false);
});

test('voorgesteld doelpad: naast het document, met het achtervoegsel vóór .pdf', () => {
  const doc = { filePath: 'C:\\Temp\\opds-edit-1.pdf', saveTargetPath: 'C:\\Werk\\Tekening.pdf', fileName: 'Tekening.pdf' };
  assert.equal(standaardDoelPad(doc, null, ' - afdruk'), 'C:\\Werk\\Tekening - afdruk.pdf');
  assert.equal(standaardDoelPad({ filePath: '/home/ik/plan.PDF' }, null, ' - print'), '/home/ik/plan - print.pdf');
  // Naamloos: de tabbladnaam in de opgegeven map, of alleen de naam.
  const naamloos = { isUntitled: true, filePath: 'C:\\Temp\\x.pdf', fileName: 'Naamloos 1' };
  assert.equal(standaardDoelPad(naamloos, 'C:\\Users\\ik\\Documents', ' - afdruk'), 'C:\\Users\\ik\\Documents\\Naamloos 1 - afdruk.pdf');
  assert.equal(standaardDoelPad(naamloos, null, ' - afdruk'), 'Naamloos 1 - afdruk.pdf');
  assert.equal(standaardDoelPad(null, null, ' - afdruk'), 'document - afdruk.pdf');
  // Verboden tekens uit een tabbladnaam komen niet in een bestandsnaam.
  assert.equal(standaardDoelPad({ isUntitled: true, fileName: 'a/b:c?.pdf' }, null, ''), 'a_b_c_.pdf');
  // Het voorstel is nooit het geopende bestand zelf, ook niet zonder achtervoegsel.
  assert.notEqual(standaardDoelPad(doc, null, ''), 'C:\\Werk\\Tekening.pdf');
});

test('een printer die naar een bestand schrijft: aan de poort of aan het stuurprogramma te zien', () => {
  // Poort: vraagt om een bestandsnaam, of is zelf een bestand.
  assert.equal(isBestandsPrinter({ Name: 'A', DriverName: 'Iets', PortName: 'PORTPROMPT:' }), true);
  assert.equal(isBestandsPrinter({ Name: 'A', DriverName: 'Iets', PortName: 'FILE:' }), true);
  assert.equal(isBestandsPrinter({ Name: 'A', DriverName: 'Iets', PortName: 'file:' }), true);
  assert.equal(isBestandsPrinter({ Name: 'A', DriverName: 'Iets', PortName: 'C:\\Uitvoer\\afdruk.pdf' }), true);
  assert.equal(isBestandsPrinter({ Name: 'A', DriverName: 'Iets', PortName: '\\\\server\\map\\uit.prn' }), true);
  // Stuurprogramma: "PDF" of "XPS" als los woord.
  assert.equal(isBestandsPrinter({ Name: 'A', DriverName: 'Een PDF Converter' }), true);
  assert.equal(isBestandsPrinter({ Name: 'A', DriverName: 'Document Writer v4 XPS' }), true);
  assert.equal(isBestandsPrinter({ Name: 'A', DriverName: 'print-to-pdf' }), true);
  // Gewone printers: netwerkpoort, USB, een naam met "xps" midden in een woord.
  assert.equal(isBestandsPrinter({ Name: 'Kantoor', DriverName: 'Laser PCL6', PortName: 'IP_192.168.1.20' }), false);
  assert.equal(isBestandsPrinter({ Name: 'Inkjet', DriverName: 'Inkjet 5000 series', PortName: 'USB001' }), false);
  assert.equal(isBestandsPrinter({ Name: 'X', DriverName: 'Upxpsdfx', PortName: 'LPT1:' }), false);
  assert.equal(isBestandsPrinter({ Name: 'X', DriverName: 'CUPS' }), false);
  // De naam van de printer alleen zegt niets: een wachtrij mag "PDF's" heten.
  assert.equal(isBestandsPrinter({ Name: 'PDF-kamer', DriverName: 'Laser PCL6', PortName: 'IP_10.0.0.4' }), false);
  for (const niets of [null, undefined, {}, { Name: 'Z' }]) assert.equal(isBestandsPrinter(niets), false);
});

test('een PDF-printer met "pdf" vast aan een woord in het stuurprogramma is ook een bestandsprinter', () => {
  // Veel PDF-printers heten zo, met een eigen poort die niets verraadt.
  assert.equal(isBestandsPrinter({ Name: 'A', DriverName: 'Proefpdfschrijver', PortName: 'OMZETMON' }), true);
  assert.equal(isBestandsPrinter({ Name: 'A', DriverName: 'PDFproef 6', PortName: 'OMZET:' }), true);
  assert.equal(isBestandsPrinter({ Name: 'A', DriverName: 'MijnPDF7', PortName: 'X' }), true);
  // "XPS" blijft alleen als los woord tellen: vast aan een woord zegt het niets.
  assert.equal(isBestandsPrinter({ Name: 'X', DriverName: 'Laserxps', PortName: 'USB001' }), false);
});

// --- de teksten in alle talen --------------------------------------------------------

/** Nieuwe sleutels van dit doel en van de velkop, met de plaatshouders die ze moeten dragen. */
export const PRINT_DOEL_SLEUTELS = {
  saveAsPdf: [],
  sheetPortrait: ['paper'],
  sheetLandscape: ['paper'],
  autoRotateOverrides: ['orientation'],
  filePrinterHint: [],
  targetIsOpenFile: [],
  fileSuffix: [],
  'progress.savedTo': ['path'],
  'progress.savedAsImages': ['path'],
  'progress.saveFailed': ['error'],
};

test('alle locales kennen de teksten van "Opslaan als PDF" en de velkop, vertaald en met hun plaatshouders', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const map = join(dirname(fileURLToPath(import.meta.url)), '../i18n/locales');
  const lees = (taal) => JSON.parse(readFileSync(join(map, taal, 'dialogs.json'), 'utf8')).print;
  const leesCommon = (taal) => JSON.parse(readFileSync(join(map, taal, 'common.json'), 'utf8').replace(/^﻿/, ''));
  const haal = (print, sleutel) => sleutel.split('.').reduce((o, k) => (o == null ? undefined : o[k]), print);
  const en = lees('en');
  const enCommon = leesCommon('en');
  const talen = readdirSync(map);
  assert.equal(talen.length, 39);
  for (const taal of talen) {
    const print = lees(taal);
    const common = leesCommon(taal);
    for (const [sleutel, plaatshouders] of Object.entries(PRINT_DOEL_SLEUTELS)) {
      const tekst = haal(print, sleutel);
      assert.ok(typeof tekst === 'string' && tekst.trim(), `${taal} print.${sleutel} ontbreekt`);
      for (const p of plaatshouders) assert.ok(tekst.includes(`{{${p}}}`), `${taal} print.${sleutel} mist {{${p}}}`);
      assert.equal((tekst.match(/\{\{/g) || []).length, plaatshouders.length, `${taal} print.${sleutel} heeft een plaatshouder te veel`);
      // Het achtervoegsel van de bestandsnaam mag in elke taal hetzelfde zijn, en
      // een taal die in common.json hetzelfde woord voor de stand heeft als het
      // Engels ("portrait") heeft dat hier ook.
      const stand = sleutel === 'sheetPortrait' ? 'portrait' : sleutel === 'sheetLandscape' ? 'landscape' : null;
      const zelfdeWoord = stand && String(common[stand]).toLowerCase() === String(enCommon[stand]).toLowerCase();
      if (taal !== 'en' && sleutel !== 'fileSuffix' && !zelfdeWoord) {
        assert.notEqual(tekst, haal(en, sleutel), `${taal} print.${sleutel} is niet vertaald`);
      }
    }
    // Het achtervoegsel is een stuk bestandsnaam: geen verboden tekens, komt vóór ".pdf".
    assert.doesNotMatch(print.fileSuffix, /[<>:"/\\|?*\x00-\x1f]|\.pdf$/i, `${taal} print.fileSuffix`);
  }
  // Chinees in het schrift van dat bestand.
  assert.match(lees('zh').saveAsPdf, /[一-鿿]/);
});
