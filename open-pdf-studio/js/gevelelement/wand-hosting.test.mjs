import assert from 'node:assert/strict';
import test from 'node:test';

import { plaatsInWand, wandSnedePlan, zoekHostWand } from './wand-hosting.js';

const K = 0.5;                       // pt per mm: een wand van 10 000 mm is 5000 pt
const bijna = (a, b, tol, wat) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);
const WAND = { id: 'w1', startX: 0, startY: 100, endX: 5000, endY: 100, dikteMm: 300 };

test('in de wand: het gat over de lengte van het element, twee solide stukken', () => {
  const r = plaatsInWand(WAND, { vanMm: 2000, lengteMm: 4800 }, K);
  assert.equal(r.ok, true);
  assert.deepEqual(r.gat, { vanMm: 2000, totMm: 6800 });
  assert.deepEqual(r.lijn, { startX: 1000, startY: 100, endX: 3400, endY: 100 });
  assert.equal(r.stukken.length, 2);
  assert.equal(r.stukken[0].startX, 0);
  assert.equal(r.stukken[0].endX, 1000, 'het eerste stuk stopt bij het begin van het element');
  assert.equal(r.stukken[1].startX, 3400, 'het tweede begint bij het eind');
  assert.equal(r.stukken[1].endX, 5000);
  assert.deepEqual(r.host, { wandId: 'w1', vanMm: 2000, lengteMm: 4800, offsetMm: 0, dikteMm: 300 });
});

test('hart in plaats van begin, en standaard in het midden van de wand', () => {
  const r = plaatsInWand(WAND, { hartMm: 5000, lengteMm: 2000 }, K);
  assert.deepEqual(r.gat, { vanMm: 4000, totMm: 6000 });
  const m = plaatsInWand(WAND, { lengteMm: 2000 }, K);
  assert.deepEqual(m.gat, { vanMm: 4000, totMm: 6000 });
});

test('tegen de hoek: één stuk; de hele wand: geen stuk meer', () => {
  const r = plaatsInWand(WAND, { vanMm: 0, lengteMm: 3000 }, K);
  assert.equal(r.stukken.length, 1);
  assert.equal(r.stukken[0].startX, 1500);
  const heel = plaatsInWand(WAND, { vanMm: 0, lengteMm: 10000 }, K);
  assert.equal(heel.ok, true);
  assert.equal(heel.stukken.length, 0);
});

test('positie in het wandpakket: offset dwars op de wand, binnen de dikte', () => {
  const r = plaatsInWand(WAND, { vanMm: 1000, lengteMm: 1000, offsetMm: 60 }, K);
  // Wand naar +x: rechts (n-zijde) is +y in schermcoördinaten.
  assert.equal(r.lijn.startY, 130);
  assert.equal(r.host.offsetMm, 60);
  assert.equal(plaatsInWand(WAND, { vanMm: 1000, lengteMm: 1000, offsetMm: 200 }, K).ok, false);
});

test('weigert wat niet past', () => {
  assert.equal(plaatsInWand(WAND, { vanMm: 8000, lengteMm: 3000 }, K).ok, false);
  assert.match(plaatsInWand(WAND, { vanMm: 8000, lengteMm: 3000 }, K).error, /does not fit/);
  assert.equal(plaatsInWand(WAND, { vanMm: -1, lengteMm: 1000 }, K).ok, false);
  assert.equal(plaatsInWand(WAND, { vanMm: 0, lengteMm: 0 }, K).ok, false);
  assert.equal(plaatsInWand({ ...WAND, endX: 0 }, { lengteMm: 100 }, K).ok, false);
  assert.equal(plaatsInWand(WAND, { lengteMm: 100 }, 0).ok, false);
});

test('snedeplan: eerste stuk hergebruikt de wand, tweede erft zijn stijl', () => {
  const ann = {
    id: 'w1', type: 'wall', page: 2, startX: 0, startY: 100, endX: 5000, endY: 100,
    dikteMm: 300, hatchPattern: 'nen47-metselwerk-baksteen', layer: 'L1', modifiedAt: 'x',
  };
  const { stukken } = plaatsInWand(ann, { vanMm: 2000, lengteMm: 4800 }, K);
  const plan = wandSnedePlan(ann, stukken);
  assert.deepEqual(plan.wijzig, { id: 'w1', props: { startX: 0, startY: 100, endX: 1000, endY: 100 } });
  assert.equal(plan.verwijder, null);
  assert.equal(plan.nieuw.length, 1);
  assert.deepEqual(plan.nieuw[0], {
    type: 'wall', page: 2, dikteMm: 300, hatchPattern: 'nen47-metselwerk-baksteen', layer: 'L1',
    startX: 3400, startY: 100, endX: 5000, endY: 100,
  });
  assert.deepEqual(wandSnedePlan(ann, []), { wijzig: null, nieuw: [], verwijder: 'w1' });
});

test('host zoeken: evenwijdige wand die het element over zijn lengte bevat', () => {
  const anderen = [
    { id: 'haaks', startX: 1000, startY: 0, endX: 1000, endY: 400, dikteMm: 300 },
    WAND,
  ];
  const r = zoekHostWand({ startX: 1000, startY: 110, endX: 3400, endY: 110 }, anderen, K);
  assert.equal(r.wand.id, 'w1');
  bijna(r.vanMm, 2000, 1e-9, 'begin langs de wand');
  bijna(r.lengteMm, 4800, 1e-9, 'lengte');
  bijna(r.offsetMm, 20, 1e-9, '10 pt = 20 mm naar rechts');
  assert.equal(r.omgekeerd, false);
  const terug = zoekHostWand({ startX: 3400, startY: 100, endX: 1000, endY: 100 }, anderen, K);
  assert.equal(terug.omgekeerd, true);
  assert.equal(zoekHostWand({ startX: 1000, startY: 200, endX: 3400, endY: 200 }, anderen, K), null, 'buiten de wanddikte');
  assert.equal(zoekHostWand({ startX: 4000, startY: 100, endX: 6000, endY: 100 }, anderen, K), null, 'steekt buiten de wand');
  assert.equal(zoekHostWand({ startX: 1000, startY: 100, endX: 3400, endY: 300 }, anderen, K), null, 'niet evenwijdig');
});
