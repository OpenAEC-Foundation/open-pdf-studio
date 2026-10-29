// Wapeningskorf (parametrische rechthoekige balk) in de buigstaat (#312).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wapeningskorfTemplate as tpl, wapeningskorfStaven } from './wapeningskorf.js';
import { defaultParams } from '../registry.js';
import { staafLengte } from '../../quantities/wapening.js';

test('zonder balklengte telt de korf niet mee', () => {
  assert.deepEqual(wapeningskorfStaven(defaultParams(tpl)), []);
  assert.deepEqual(tpl.rebarItems({}), []);
});

test('staven over de balklengte met doorlopende staafnummers', () => {
  const items = tpl.rebarItems({ ...defaultParams(tpl), lengte: 6000, staafnummerStart: '11' });
  assert.deepEqual(items.map((i) => [i.staafnummer, i.aantal, i.diameter, i.lengteMm, i.vormcode]), [
    ['11', 4, 12, 5940, '00'],
    ['12', 6, 16, 5940, '00'],
    ['13', 2, 10, 5940, '00'],
    ['14', 40, 8, staafLengte('51', { a: 340, b: 340 }, 8), '51'],
  ]);
  assert.ok(items.every((i) => i.staalkwaliteit === 'B500B'));
});

test('lege staafgroep valt weg, nummering automatisch zonder startnummer', () => {
  const items = tpl.rebarItems({ lengte: 3000, zijAantal: 0, staalkwaliteit: 'B500C' });
  assert.equal(items.length, 3);
  assert.ok(items.every((i) => i.staafnummer === '' && i.staalkwaliteit === 'B500C'));
});
