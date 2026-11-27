import test from 'node:test';
import assert from 'node:assert/strict';
import { getoondeKolommen, kolomBreedte, renderBreedteVoorLijst, MIN_KOLOM } from './miniatuur-maat.js';
test('chosen columns are an upper limit that survives narrowing and widening', () => {
  assert.equal(getoondeKolommen(620, 2), 2);
  assert.equal(getoondeKolommen(200, 2), 1);
  assert.equal(getoondeKolommen(780, 2), 2);
  assert.equal(getoondeKolommen(620, 0), 4);
  assert.equal(getoondeKolommen(780, 0), 5);
  for (const width of [150, 200, 620, 780]) {
    for (const choice of [0, 1, 2, 4, 999]) assert.ok(kolomBreedte(width, undefined, undefined, choice) >= MIN_KOLOM);
  }
});
test('larger thumbnails request a larger bitmap, within the existing memory cap', () => {
  assert.equal(kolomBreedte(620, undefined, undefined, 2), 308);
  assert.equal(renderBreedteVoorLijst(620, 1), 280);
  assert.equal(renderBreedteVoorLijst(620, 1, 2), 320);
  assert.equal(renderBreedteVoorLijst(620, 2, 1), 600);
  for (const invalid of [-1, NaN, Infinity, 1.5, '2']) assert.equal(getoondeKolommen(620, invalid), 4);
});
let serial = 0;
const fresh = () => import(`./miniatuur-kolommen.js?test=${++serial}`);
test('choice survives reload; auto removes storage; subscriptions can be removed', async () => {
  const values = new Map();
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
  try {
    const m = await fresh(); assert.equal(m.gekozenKolommen(), 0);
    const seen = []; const stop = m.bijKolomWijziging(n => seen.push(n));
    m.zetGekozenKolommen(2); m.zetGekozenKolommen(2);
    assert.deepEqual(seen, [2]); assert.equal((await fresh()).gekozenKolommen(), 2);
    stop(); m.zetGekozenKolommen(0); assert.deepEqual(seen, [2]);
    assert.equal(values.size, 0); assert.equal((await fresh()).gekozenKolommen(), 0);
  } finally { delete globalThis.localStorage; }
});
test('unavailable storage and malformed preferences do not break the slider', async () => {
  globalThis.localStorage = { getItem: () => 'garbage', setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  try {
    const m = await fresh(); assert.equal(m.gekozenKolommen(), 0);
    m.zetGekozenKolommen(3); assert.equal(m.gekozenKolommen(), 3);
    m.zetGekozenKolommen(-2); assert.equal(m.gekozenKolommen(), 0);
  } finally { delete globalThis.localStorage; }
});
