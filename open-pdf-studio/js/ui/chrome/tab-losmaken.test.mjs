// Een tabblad uit de tabbalk slepen ("losmaken"): het document gaat naar een
// tweede, eigen app-instantie. Getest: wanneer een sleepbeweging telt als
// losmaken, wat er bij het loslaten gebeurt, wanneer de OS-sleep (alleen voor
// terugzetten in een andere instantie) start, hoe de uitkomst van die OS-sleep
// wordt gelezen en welk pad de nieuwe instantie krijgt.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOSMAAK_DREMPEL_PX,
  buitenTabbalk,
  buitenVenster,
  besluitBijLoslaten,
  moetOsSleepStarten,
  besluitNaOsSleep,
  padVoorNieuweInstantie,
  losmaakBlokkade,
} from './tab-losmaken.js';

const balk = { top: 150, bottom: 180 };

// ── Wanneer telt een sleep als losmaken ───────────────────────────────────

test('binnen de drempel onder of boven de tabbalk blijft het herschikken', () => {
  assert.equal(buitenTabbalk(180 + LOSMAAK_DREMPEL_PX, balk), false);
  assert.equal(buitenTabbalk(150 - LOSMAAK_DREMPEL_PX, balk), false);
  assert.equal(buitenTabbalk(165, balk), false);
});

test('voorbij de drempel onder of boven de tabbalk telt als losmaken', () => {
  assert.equal(buitenTabbalk(180 + LOSMAAK_DREMPEL_PX + 1, balk), true);
  assert.equal(buitenTabbalk(150 - LOSMAAK_DREMPEL_PX - 1, balk), true);
});

test('zonder bekende tabbalk telt niets als losmaken', () => {
  assert.equal(buitenTabbalk(5000, null), false);
});

test('buitenVenster herkent een cursor buiten het eigen venster', () => {
  assert.equal(buitenVenster(10, 10, 800, 600), false);
  assert.equal(buitenVenster(-1, 10, 800, 600), true);
  assert.equal(buitenVenster(10, 600, 800, 600), true);
  assert.equal(buitenVenster(800, 10, 800, 600), true);
  assert.equal(buitenVenster(10, -5, 800, 600), true);
});

// ── Loslaten zonder OS-sleep ───────────────────────────────────────────────

test('loslaten zonder losmaakgebaar is gewoon herschikken', () => {
  assert.equal(besluitBijLoslaten({ losGewapend: false, aantalTabs: 3 }), 'herschikken');
});

test('loslaten voorbij de drempel maakt het tabblad los naar een nieuwe instantie', () => {
  assert.equal(besluitBijLoslaten({ losGewapend: true, aantalTabs: 2 }), 'losmaken');
});

test('het enige tabblad losmaken heeft geen zin: het blijft staan', () => {
  assert.equal(besluitBijLoslaten({ losGewapend: true, aantalTabs: 1 }), 'houden');
  assert.equal(besluitBijLoslaten({ losGewapend: true, aantalTabs: 0 }), 'houden');
});

// ── Wanneer de OS-sleep start ────────────────────────────────────────────────

test('de OS-sleep start alleen boven een andere instantie van de app', () => {
  assert.equal(moetOsSleepStarten({ losGewapend: true, buitenVenster: true, doelSoort: 'instantie' }), true);
});

test('geen OS-sleep boven leeg bureaublad, een ander programma of het eigen venster', () => {
  assert.equal(moetOsSleepStarten({ losGewapend: true, buitenVenster: true, doelSoort: 'geen' }), false);
  assert.equal(moetOsSleepStarten({ losGewapend: true, buitenVenster: true, doelSoort: 'zelf' }), false);
  assert.equal(moetOsSleepStarten({ losGewapend: true, buitenVenster: false, doelSoort: 'instantie' }), false);
  assert.equal(moetOsSleepStarten({ losGewapend: false, buitenVenster: true, doelSoort: 'instantie' }), false);
  assert.equal(moetOsSleepStarten({ losGewapend: true, buitenVenster: true, doelSoort: undefined }), false);
});

// ── Uitkomst van de OS-sleep ─────────────────────────────────────────────────

test('neergezet op een andere instantie: die heeft het document, hier sluiten', () => {
  assert.equal(besluitNaOsSleep({ resultaat: 'Dropped', doelSoort: 'instantie', zelfDrop: false }), 'sluiten');
});

test('neergezet buiten elke instantie: losmaken naar een nieuwe instantie', () => {
  // Windows meldt "Dropped" ook als het venster onder de cursor niets aannam.
  assert.equal(besluitNaOsSleep({ resultaat: 'Dropped', doelSoort: 'geen', zelfDrop: false }), 'losmaken');
});

test('terug op het eigen venster of afgebroken: tabblad blijft', () => {
  assert.equal(besluitNaOsSleep({ resultaat: 'Dropped', doelSoort: 'zelf', zelfDrop: false }), 'houden');
  assert.equal(besluitNaOsSleep({ resultaat: 'Dropped', doelSoort: 'instantie', zelfDrop: true }), 'houden');
  assert.equal(besluitNaOsSleep({ resultaat: 'Cancel', doelSoort: 'geen', zelfDrop: false }), 'houden');
  assert.equal(besluitNaOsSleep({ resultaat: 'Cancelled', doelSoort: 'instantie', zelfDrop: false }), 'houden');
  assert.equal(besluitNaOsSleep({ resultaat: undefined, doelSoort: 'geen', zelfDrop: false }), 'houden');
});

// ── Pad voor de nieuwe instantie ────────────────────────────────────────────

test('het pad is het bestand van het document', () => {
  assert.equal(padVoorNieuweInstantie({ filePath: 'C:/a.pdf' }), 'C:/a.pdf');
});

test('een met wachtwoord geopend document gaat naar het origineel, nooit de werkkopie', () => {
  assert.equal(
    padVoorNieuweInstantie({ filePath: 'C:/tmp/ontsleuteld.pdf', originalFilePath: 'C:/geheim.pdf' }),
    'C:/geheim.pdf',
  );
});

test('een document dat uit een tijdelijke werkkopie rendert gaat naar het echte bestand', () => {
  assert.equal(
    padVoorNieuweInstantie({ filePath: 'C:/tmp/werk.pdf', saveTargetPath: 'C:/echt.pdf', _renderTemp: true }),
    'C:/echt.pdf',
  );
});

test('een naamloos of padloos document heeft geen pad', () => {
  assert.equal(padVoorNieuweInstantie({ filePath: 'C:/tmp/naamloos.pdf', isUntitled: true }), null);
  assert.equal(padVoorNieuweInstantie({ filePath: '' }), null);
  assert.equal(padVoorNieuweInstantie(null), null);
});

test('losmaakBlokkade vraagt eerst opslaan bij een naamloos document', () => {
  assert.equal(losmaakBlokkade({ filePath: 'C:/tmp/x.pdf', isUntitled: true }), 'eerst-opslaan');
  assert.equal(losmaakBlokkade({ filePath: '' }), 'eerst-opslaan');
  assert.equal(losmaakBlokkade({ filePath: 'C:/a.pdf' }), null);
  assert.equal(losmaakBlokkade(null), 'geen-document');
});
