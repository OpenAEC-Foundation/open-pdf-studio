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
  losmaakPositie,
  buitenVenster,
  besluitBijLoslaten,
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

test('rechtstreeks zijwaarts slepen bereikt de andere tabbalk of het bureaublad', () => {
  for (const x of [-1, 800]) {
    const pos = losmaakPositie(x, 165, 800, 600, balk, false);
    assert.equal(pos.losGewapend, true);
    assert.equal(besluitBijLoslaten({ ...pos, aantalTabs: 1 }), 'losmaken');
  }
  assert.equal(losmaakPositie(799, 165, 800, 600, balk, false).losGewapend, false);
  assert.equal(losmaakPositie(800, 165, 800, 600, balk, true).losGewapend, false);
});
import { receiveDock, requestDock } from './tab-dock.js';

test('het bronvenster krijgt pas bevestiging nadat het juiste doel het document heeft geladen', async () => {
  const orig = globalThis.window;
  globalThis.window = { devicePixelRatio: 2 };
  let finish, started;
  const opened = new Promise(resolve => { started = resolve; });
  const bar = () => ({
    classList: { remove() {} },
    getBoundingClientRect: () => ({ left: 0, right: 400, top: 100, bottom: 130 }),
  });
  const stop = receiveDock(123, bar, path => {
    assert.equal(path, 'C:/plan.pdf');
    started();
    return new Promise(resolve => { finish = resolve; });
  });
  try {
    assert.equal(await requestDock({ pid: 123, x: 120, y: 850 }, 'C:/plan.pdf'), false);
    let closed = false;
    const result = requestDock({ pid: 123, x: 120, y: 225 }, 'C:/plan.pdf').then(ok => { closed = ok; });
    await opened;
    assert.equal(closed, false);
    finish(true);
    await result;
    assert.equal(closed, true);
  } finally { stop(); globalThis.window = orig; }
});

test('mislukt laden in het doel laat de brontab staan', async () => {
  const orig = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  const bar = () => ({ classList: { remove() {} }, getBoundingClientRect: () => ({ left: 0, right: 380, top: 4, bottom: 80 }) });
  const stop = receiveDock(124, bar, async () => false);
  try { assert.equal(await requestDock({ pid: 124, x: 20, y: 42 }, 'C:/plan.pdf'), false); }
  finally { stop(); globalThis.window = orig; }
});
