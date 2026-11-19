// Snap-geometrie per document en pagina (#705): niets van een gesloten
// document blijft staan, ook niet als de extractie pas na het sluiten klaar is.

import assert from 'node:assert/strict';
import test from 'node:test';

import { documentSleutel, maakSnapGeometrieCache } from './snap-geometrie-cache.js';

const geometrie = (naam) => ({ points: [naam], edges: [], index: null });
const uitgesteld = () => {
  let klaar;
  const belofte = new Promise((r) => { klaar = r; });
  return { belofte, klaar };
};

test('twee documenten met dezelfde pagina delen geen geometrie', async () => {
  const cache = maakSnapGeometrieCache();
  const a = { id: 1, filePath: 'C:/t/a.pdf' };
  const b = { id: 2, filePath: 'C:/t/b.pdf' };
  await cache.laad(a, 1, async () => geometrie('a1'));
  assert.deepEqual(cache.get(a, 1).points, ['a1']);
  assert.equal(cache.get(b, 1), null, 'pagina 1 van b is niet die van a');
  assert.equal(cache.heeft(b, 1), false);
});

test('een extractie die pas na het sluiten klaar is, wordt niet bewaard', async () => {
  const open = new Set();
  const cache = maakSnapGeometrieCache({ isOpen: (d) => open.has(d) });
  const doc = { id: 1, filePath: 'C:/t/MV-03.pdf' };
  open.add(doc);
  const uit = uitgesteld();
  const loopt = cache.laad(doc, 1, () => uit.belofte);
  open.delete(doc); // tabblad gesloten terwijl de extractie loopt
  uit.klaar(geometrie('oud'));
  await loopt;
  assert.equal(cache.grootte, 0);
  assert.equal(cache.get(doc, 1), null);
});

test('na het legen van de cache bewaart een lopende extractie niets meer', async () => {
  const cache = maakSnapGeometrieCache();
  const doc = { id: 1, filePath: 'C:/t/a.pdf' };
  const uit = uitgesteld();
  const loopt = cache.laad(doc, 1, () => uit.belofte);
  cache.wis();
  uit.klaar(geometrie('oud'));
  await loopt;
  assert.equal(cache.get(doc, 1), null);
  // Een nieuwe extractie mag daarna gewoon weer.
  await cache.laad(doc, 1, async () => geometrie('nieuw'));
  assert.deepEqual(cache.get(doc, 1).points, ['nieuw']);
});

test('vergeetPad haalt alle pagina\'s van dat pad weg, ook wat nog loopt, en laat de rest staan', async () => {
  const cache = maakSnapGeometrieCache();
  const a = { id: 1, filePath: 'C:/t/a.pdf' };
  const a2 = { id: 3, filePath: 'C:/t/a.pdf.bak' };
  await cache.laad(a, 1, async () => geometrie('a1'));
  await cache.laad(a, 2, async () => geometrie('a2'));
  await cache.laad(a2, 1, async () => geometrie('bak'));
  const uit = uitgesteld();
  const loopt = cache.laad(a, 3, () => uit.belofte);
  cache.vergeetPad('C:/t/a.pdf');
  uit.klaar(geometrie('a3'));
  await loopt;
  assert.equal(cache.get(a, 1), null);
  assert.equal(cache.get(a, 2), null);
  assert.equal(cache.get(a, 3), null);
  assert.deepEqual(cache.get(a2, 1).points, ['bak'], 'een pad dat er alleen mee begint blijft');
});

test('per pagina loopt één extractie tegelijk', async () => {
  const cache = maakSnapGeometrieCache();
  const doc = { id: 1, filePath: 'C:/t/a.pdf' };
  let keer = 0;
  const uit = uitgesteld();
  const extraheer = () => { keer += 1; return uit.belofte; };
  const een = cache.laad(doc, 1, extraheer);
  const twee = cache.laad(doc, 1, extraheer);
  assert.equal(een, twee);
  assert.equal(cache.lopend(doc, 1), een);
  uit.klaar(geometrie('x'));
  await een;
  assert.equal(keer, 1);
  assert.equal(cache.lopend(doc, 1), null);
});

test('een mislukte extractie bewaart niets en mag opnieuw', async () => {
  const cache = maakSnapGeometrieCache();
  const doc = { id: 1, filePath: 'C:/t/a.pdf' };
  await cache.laad(doc, 1, async () => { throw new DOMException('afgebroken', 'AbortError'); });
  assert.equal(cache.heeft(doc, 1), false);
  await cache.laad(doc, 1, async () => geometrie('later'));
  assert.deepEqual(cache.get(doc, 1).points, ['later']);
});

test('documentsleutel: pad, anders het id van een document zonder pad', () => {
  assert.equal(documentSleutel({ id: 4, filePath: 'C:/t/a.pdf' }), 'C:/t/a.pdf');
  assert.equal(documentSleutel({ id: 4 }), '__memory__4');
  assert.equal(documentSleutel(null), null);
});

test('na een paginadraai worden oude snappunten en een lopende extractie vervangen', async () => {
  const cache = maakSnapGeometrieCache();
  const doc = { id: 1, pageRotations: {} };
  await cache.laad(doc, 1, () => geometrie('origineel'));
  doc.pageRotations[1] = 90;
  assert.equal(cache.get(doc, 1), null);
  assert.equal(cache.heeft(doc, 1), false);
  const traag = uitgesteld();
  const kwartslag = cache.laad(doc, 1, () => traag.belofte);
  doc.pageRotations[1] = 180;
  assert.equal(cache.lopend(doc, 1), null);
  await cache.laad(doc, 1, () => geometrie('halve slag'));
  traag.klaar(geometrie('kwartslag'));
  await kwartslag;
  assert.deepEqual(cache.get(doc, 1).points, ['halve slag']);
  assert.equal(cache.grootte, 1);
});
