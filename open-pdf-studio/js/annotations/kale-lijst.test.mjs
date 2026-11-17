// Snelle lussen over de annotaties lezen de kale objecten in plaats van de
// proxies van de state-store: elke eigenschap via de store kost een
// proxy-aanroep, en bij duizenden markeringen was dat 40 % van de rekentijd
// van elke muisbeweging. Wat de lus vindt gaat als store-object terug, zodat
// wijzigen gewoon reactief blijft.

import assert from 'node:assert/strict';
import test from 'node:test';
import { $RAW } from 'solid-js/store';
import { kaleLijst, vanStore, kaal } from './kale-lijst.js';

/** Een lijst zoals de store hem geeft: lezen via een proxy, en `$RAW` geeft de kale lijst. */
function storeLijst(kaal) {
  const teller = { lezingen: 0 };
  const omhulsels = new Map();
  const omhul = (item) => {
    if (!omhulsels.has(item)) omhulsels.set(item, new Proxy(item, { get(t, k) { teller.lezingen++; return t[k]; } }));
    return omhulsels.get(item);
  };
  const lijst = new Proxy(kaal, {
    get(t, k) {
      if (k === $RAW) return t;
      if (typeof k === 'string' && /^\d+$/.test(k)) return omhul(t[k]);
      return t[k];
    },
  });
  return { lijst, teller };
}

test('de kale lijst is de lijst onder de store, en lezen eruit raakt de store niet', () => {
  const kaal = [{ id: 'a', page: 1 }, { id: 'b', page: 2 }];
  const { lijst, teller } = storeLijst(kaal);
  const snel = kaleLijst(lijst);
  assert.equal(snel, kaal);
  let gevonden = 0;
  for (const a of snel) if (a.page === 2) gevonden++;
  assert.equal(gevonden, 1);
  assert.equal(teller.lezingen, 0);
});

test('een gewone lijst (tests, webdelen zonder store) blijft zichzelf', () => {
  const lijst = [{ id: 'a' }];
  assert.equal(kaleLijst(lijst), lijst);
  assert.deepEqual(kaleLijst(null), []);
  assert.deepEqual(kaleLijst(undefined), []);
});

test('wat in de kale lijst gevonden is, gaat terug als het object van de store', () => {
  const kaal = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const { lijst } = storeLijst(kaal);
  const terug = vanStore(lijst, kaal[1]);
  assert.equal(terug, lijst[1], 'hetzelfde object als de store geeft');
  assert.notEqual(terug, kaal[1], 'niet het kale object: wijzigen moet reactief blijven');
  assert.equal(vanStore(lijst, null), null);
  // Een object dat niet (meer) in de lijst staat komt terug zoals het is.
  const los = { id: 'x' };
  assert.equal(vanStore(lijst, los), los);
  // Zonder store valt er niets te vertalen.
  const gewoon = [{ id: 'a' }];
  assert.equal(vanStore(gewoon, gewoon[0]), gewoon[0]);
});

test('het kale object onder een store-object, en een gewoon object blijft zichzelf', () => {
  const doc = { annotationLayers: [{ id: 'l1' }] };
  const proxy = new Proxy(doc, { get(t, k) { return k === $RAW ? t : t[k]; } });
  assert.equal(kaal(proxy), doc);
  assert.equal(kaal(doc), doc);
  assert.equal(kaal(null), null);
  assert.equal(kaal(undefined), undefined);
});
