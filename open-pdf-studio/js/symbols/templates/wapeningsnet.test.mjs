// Wapeningsnet in plattegrond (#312): netnotatie, staafaantallen, tekening.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wapeningsnetTemplate as tpl, netNotatie, netOnderschrift, netStaven, wapeningsnetLayout } from './wapeningsnet.js';
import { defaultParams, getTemplate } from '../registry.js';
import { assertBinnenBbox, teksten } from './binnen-bbox.testhulp.mjs';

const BBOX = { x: 0, y: 0, width: 250, height: 107.5 };

test('geregistreerd, ware maat = netmaat', () => {
  assert.equal(getTemplate('wapeningsnet'), tpl);
  assert.deepEqual(tpl.realSizeMm(defaultParams(tpl)), { width: 5000, height: 2150 });
  assert.equal(tpl.fixedSize, true);
});

test('netnotatie en onderschrift', () => {
  assert.equal(netNotatie({}), 'Ø8-150/Ø8-150');
  assert.equal(netNotatie({ diameterL: 10, afstandL: 100, diameterB: 6, afstandB: 200, aantalNetten: 3 }), '3× Ø10-100/Ø6-200');
  assert.equal(netOnderschrift({ laag: 'boven' }), '5000×2150 boven B500A');
});

test('staafaantallen over lengte en breedte', () => {
  const s = netStaven({ lengte: 5000, breedte: 2150, afstandL: 150, afstandB: 150 });
  assert.deepEqual(s, {
    lengterichting: { aantal: 15, lengteMm: 5000 },
    breedterichting: { aantal: 34, lengteMm: 2150 },
  });
  const items = tpl.rebarItems({ aantalNetten: 2, staafnummerL: '5', staafnummerB: '6' });
  assert.deepEqual(items.map((i) => [i.staafnummer, i.aantal, i.lengteMm, i.diameter, i.staalkwaliteit]), [
    ['5', 30, 5000, 8, 'B500A'],
    ['6', 68, 2150, 8, 'B500A'],
  ]);
});

test('render: omtrek, onderbroken diagonaal, label; bovennet gestreept', () => {
  const onder = tpl.render(defaultParams(tpl), BBOX);
  assertBinnenBbox(onder, BBOX, 'ondernet');
  assert.equal(onder.filter((c) => c.role === 'diagonaal').length, 2, 'diagonaal rond het label onderbroken');
  assert.ok(!onder.some((c) => c.dash));
  assert.ok(teksten(onder).includes('5000×2150 onder B500A'));

  const boven = tpl.render({ ...defaultParams(tpl), laag: 'boven', staafnummerL: '3' }, BBOX);
  assertBinnenBbox(boven, BBOX, 'bovennet');
  assert.ok(boven.filter((c) => c.role === 'diagonaal' || c.role === 'net').every((c) => Array.isArray(c.dash)));
  assert.ok(boven.some((c) => c.role === 'staafnummer' && c.kind === 'text' && c.text === '3'));
});

test('het label past binnen het net, ook bij een smal net', () => {
  for (const p of [{}, { lengte: 1200, breedte: 2000 }, { lengte: 6000, breedte: 300 }]) {
    const L = wapeningsnetLayout(p);
    assert.ok(L.label.hw * 2 <= L.footprint.width, 'labelbreedte');
    assert.ok(L.diagonaal.t0 > 0 && L.diagonaal.t1 < 1);
  }
});
