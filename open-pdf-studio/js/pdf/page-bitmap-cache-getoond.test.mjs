// De paginabitmapcache sluit nooit een bitmap die getoond wordt (#715).
//
// De viewport tekent viewport.currentBitmap elk frame; die bitmap is een
// entry van deze cache. Werd hij bij verdringen (12 entries) of ongeldig
// maken gesloten, dan gaf elk frame "drawImage: the image source is
// detached". Het tweede paneel van de gesplitste weergave vraagt uit
// dezelfde cache en kon hem zo verdringen. Hier draait de echte cache.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const pbc = await import('./page-bitmap-cache.js');

// Nep-ImageBitmap: close() maakt hem 0×0, zoals een echte.
function bitmap(naam) {
  return {
    naam, width: 100, height: 100, gesloten: false,
    close() { this.gesloten = true; this.width = 0; this.height = 0; },
  };
}

function zet(pad, pagina, bucket = 1) {
  const b = bitmap(`${pad}:${pagina}:${bucket}`);
  pbc.setCachedBitmapEntry(pad, pagina, 0, bucket, b, 100, 100, bucket);
  return b;
}

let getoond = [];
const afmelden = pbc.registreerGetoondeBitmaps(() => getoond);

function schoon() {
  getoond = [];
  pbc.claimBitmaps('test', []);
  pbc.clearAllBitmaps();
  pbc.ruimUitgesteldOp();
}

test('verdringen sluit de getoonde bitmap nooit, ook niet als hij de oudste is', () => {
  schoon();
  const live = zet('live.pdf', 1);
  getoond = [live];
  const anderen = [];
  for (let p = 1; p <= 30; p++) anderen.push(zet('ander.pdf', p));
  assert.equal(live.gesloten, false, 'de getoonde bitmap blijft open');
  assert.equal(live.width, 100);
  assert.equal(pbc.getCachedBitmap('live.pdf', 1, 0, 1)?.bitmap, live, 'en blijft in de cache');
  // De cache blijft wel begrensd: de rest is netjes verdrongen en gesloten.
  const open = anderen.filter((b) => !b.gesloten).length;
  assert.ok(open <= 11, `hooguit 11 andere entries open, nu ${open}`);
  assert.ok(anderen[0].gesloten, 'een niet-getoonde oude entry gaat wel dicht');
});

test('een net toegevoegde entry wordt niet meteen verdrongen, ook als al het andere vastligt', () => {
  schoon();
  const vast = [];
  for (let p = 1; p <= 12; p++) vast.push(zet('vast.pdf', p));
  getoond = vast;
  const nieuw = zet('nieuw.pdf', 1);
  assert.equal(nieuw.gesloten, false);
  assert.equal(pbc.getCachedBitmap('nieuw.pdf', 1, 0, 1)?.bitmap, nieuw);
  assert.ok(vast.every((b) => !b.gesloten));
});

test('geclaimde sleutels worden niet verdrongen; loslaten maakt ze weer verdringbaar', () => {
  schoon();
  const geclaimd = zet('paneel.pdf', 1);
  pbc.claimBitmaps('test', [pbc.bitmapSleutel('paneel.pdf', 1, 0, 1)]);
  for (let p = 1; p <= 20; p++) zet('ander.pdf', p);
  assert.equal(geclaimd.gesloten, false);
  assert.ok(pbc.getCachedBitmap('paneel.pdf', 1, 0, 1));
  pbc.claimBitmaps('test', []);
  for (let p = 21; p <= 40; p++) zet('ander.pdf', p);
  assert.equal(geclaimd.gesloten, true, 'zonder claim gaat hij gewoon weg');
});

test('ongeldig maken haalt een getoonde bitmap uit de cache, maar sluit hem pas als hij niet meer getoond wordt', () => {
  for (const ongeldig of [
    () => pbc.invalidatePageBitmaps('live.pdf', 1),
    () => pbc.invalidateDocumentBitmaps('live.pdf'),
    () => pbc.clearAllBitmaps(),
  ]) {
    schoon();
    const live = zet('live.pdf', 1);
    const ander = zet('live.pdf', 1, 2); // zelfde pagina, andere zoomtrap
    getoond = [live];
    ongeldig();
    assert.equal(pbc.getCachedBitmap('live.pdf', 1, 0, 1), null, 'niet meer in de cache');
    assert.equal(live.gesloten, false, 'maar nog open: de viewport tekent hem');
    assert.equal(ander.gesloten, true, 'een niet-getoonde gaat meteen dicht');
    pbc.ruimUitgesteldOp();
    assert.equal(live.gesloten, false, 'opruimen laat een getoonde staan');
    getoond = [];
    pbc.ruimUitgesteldOp();
    assert.equal(live.gesloten, true, 'niet meer getoond: nu dicht');
  }
});

test('een vervangen entry onder dezelfde sleutel sluit de oude niet als die getoond wordt', () => {
  schoon();
  const oud = zet('live.pdf', 1);
  getoond = [oud];
  const nieuw = zet('live.pdf', 1);
  assert.equal(oud.gesloten, false);
  assert.equal(pbc.getCachedBitmap('live.pdf', 1, 0, 1)?.bitmap, nieuw);
  getoond = [nieuw];
  pbc.ruimUitgesteldOp();
  assert.equal(oud.gesloten, true);
});

test('afmelden: daarna telt de bron niet meer mee', () => {
  schoon();
  const b = zet('x.pdf', 1);
  getoond = [b];
  afmelden();
  pbc.invalidateDocumentBitmaps('x.pdf');
  assert.equal(b.gesloten, true);
});
