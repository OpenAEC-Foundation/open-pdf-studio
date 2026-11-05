import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropDoelBijPunt, volgordeNaDrop, scrollStap } from './miniatuur-slepen.js';

// Eén kolom: tegels van 100 px hoog onder elkaar, 10 px tussenruimte.
const kolom = [1, 2, 3, 4].map((page, i) => ({ page, left: 0, right: 150, top: i * 110, bottom: i * 110 + 100 }));

test('één kolom: bovenste helft is ervoor, onderste helft erachter', () => {
  assert.deepEqual(dropDoelBijPunt(kolom, 50, 120), { page: 2, position: 'before', naast: false });
  assert.deepEqual(dropDoelBijPunt(kolom, 50, 190), { page: 2, position: 'after', naast: false });
});

test('één kolom: in de tussenruimte en voorbij de laatste tegel', () => {
  // y = 104: 4 px onder tegel 1, 6 px boven tegel 2.
  assert.equal(dropDoelBijPunt(kolom, 50, 104).page, 1);
  assert.deepEqual(dropDoelBijPunt(kolom, 50, 900), { page: 4, position: 'after', naast: false });
  assert.deepEqual(dropDoelBijPunt(kolom, 50, -30), { page: 1, position: 'before', naast: false });
});

test('meerdere kolommen: links/rechts van de tegel in de juiste rij', () => {
  const raster = [1, 2, 3, 4, 5].map((page, i) => {
    const r = Math.floor(i / 2), c = i % 2;
    return { page, left: c * 160, right: c * 160 + 150, top: r * 210, bottom: r * 210 + 200 };
  });
  assert.deepEqual(dropDoelBijPunt(raster, 300, 250, true), { page: 4, position: 'after', naast: true });
  assert.deepEqual(dropDoelBijPunt(raster, 170, 250, true), { page: 4, position: 'before', naast: true });
  // Lege plek rechts naast de laatste tegel: erachter.
  assert.deepEqual(dropDoelBijPunt(raster, 250, 450, true), { page: 5, position: 'after', naast: true });
});

test('geen tegels: geen doel', () => {
  assert.equal(dropDoelBijPunt([], 0, 0), null);
});

test('volgorde: één pagina naar voren en naar achteren', () => {
  assert.deepEqual(volgordeNaDrop(4, [], 3, { page: 1, position: 'before' }), [3, 1, 2, 4]);
  assert.deepEqual(volgordeNaDrop(4, [1], 1, { page: 4, position: 'after' }), [2, 3, 4, 1]);
  assert.deepEqual(volgordeNaDrop(4, [], 1, { page: 3, position: 'before' }), [2, 1, 3, 4]);
});

test('volgorde: een geselecteerde pagina neemt de selectie mee', () => {
  assert.deepEqual(volgordeNaDrop(5, [2, 4], 4, { page: 5, position: 'after' }), [1, 3, 5, 2, 4]);
  // Een niet-geselecteerde pagina gaat alleen.
  assert.deepEqual(volgordeNaDrop(5, [2, 4], 1, { page: 5, position: 'after' }), [2, 3, 4, 5, 1]);
});

test('volgorde: een drop die niets verandert geeft null', () => {
  assert.equal(volgordeNaDrop(4, [], 2, { page: 2, position: 'before' }), null);
  assert.equal(volgordeNaDrop(4, [], 2, { page: 1, position: 'after' }), null);
  assert.equal(volgordeNaDrop(4, [], 2, { page: 3, position: 'before' }), null);
  assert.equal(volgordeNaDrop(1, [], 1, { page: 1, position: 'after' }), null);
  assert.equal(volgordeNaDrop(4, [], 2, null), null);
  assert.equal(volgordeNaDrop(4, [], 9, { page: 1, position: 'before' }), null);
});

test('automatisch scrollen alleen bij de randen', () => {
  assert.equal(scrollStap(0, 500, 250), 0);
  assert.ok(scrollStap(0, 500, 5) < 0);
  assert.ok(scrollStap(0, 500, 495) > 0);
  assert.equal(scrollStap(0, 500, -100), -18);
  assert.equal(scrollStap(0, 0, 10), 0);
});
