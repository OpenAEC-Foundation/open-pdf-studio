// Sondering: wel/niet uitgevoerd (gevulde of open conus), wel/geen
// kleefmeting (kleeflijn onder de conuspunt) en een groter nummer.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sonderingTemplate as tpl, estimateTextWidth } from './sondering.js';
import { assertBinnenBbox } from './binnen-bbox.testhulp.mjs';

const BBOX = { x: 10, y: 20, width: 90, height: 120 };
const conus = (cmds) => cmds.find((c) => c.role === 'conus');
const kleeflijn = (cmds) => cmds.find((c) => c.role === 'kleeflijn');
const nummer = (cmds) => cmds.find((c) => c.kind === 'text');
const standaard = (key) => tpl.params.find((p) => p.key === key)?.default;

test('params: kleefmeting standaard uit, uitgevoerd standaard aan', () => {
  assert.deepEqual(tpl.params.map((p) => p.key), ['nummer', 'kleefmeting', 'uitgevoerd']);
  assert.equal(standaard('kleefmeting'), false);
  assert.equal(standaard('uitgevoerd'), true);
  assert.equal(tpl.params.find((p) => p.key === 'uitgevoerd').type, 'boolean');
});

test('uitgevoerd: gevulde driehoek; niet uitgevoerd: open driehoek', () => {
  for (const kleefmeting of [false, true]) {
    const wel = conus(tpl.render({ uitgevoerd: true, kleefmeting }, BBOX));
    const niet = conus(tpl.render({ uitgevoerd: false, kleefmeting }, BBOX));
    assert.equal(wel.kind, 'polyline');
    assert.equal(wel.points.length, 3);
    assert.equal(wel.close, true);
    assert.equal(wel.fill, true);
    assert.equal(niet.close, true);
    assert.equal(niet.fill, false);
    assert.deepEqual(niet.points, wel.points);
  }
  // Zonder de param (ouder symbool) geldt de sondering als uitgevoerd.
  assert.equal(conus(tpl.render({}, BBOX)).fill, true);
});

test('kleefmeting: kleeflijn onder de conuspunt, anders geen', () => {
  for (const uitgevoerd of [false, true]) {
    const met = tpl.render({ kleefmeting: true, uitgevoerd }, BBOX);
    const zonder = tpl.render({ kleefmeting: false, uitgevoerd }, BBOX);
    const lijn = kleeflijn(met);
    assert.equal(lijn.kind, 'line');
    assert.equal(lijn.y1, lijn.y2);
    const punt = conus(met).points[2];
    assert.equal(lijn.y1, punt.y);
    assert.ok(lijn.x1 < punt.x && lijn.x2 > punt.x);
    assert.equal(kleeflijn(zonder), undefined);
  }
  assert.equal(kleeflijn(tpl.render({}, BBOX)), undefined, 'standaard geen kleefmeting');
});

test('het nummer is anderhalf keer zo groot als voorheen', () => {
  // Voorheen: max(13, min(breedte * 0.24, hoogte * 0.22)) = 21,6 bij 90 x 120.
  const t = nummer(tpl.render({ nummer: '7' }, BBOX));
  assert.equal(t.text, '7');
  assert.equal(t.bold, true);
  assert.ok(Math.abs(t.size - 21.6 * 1.5) < 1e-9, `lettergrootte ${t.size}`);
});

test('het nummer blijft binnen het kader en boven de conus', () => {
  for (const bbox of [BBOX, { x: 0, y: 0, width: 160, height: 180 }, { x: 3, y: 4, width: 20, height: 26 }]) {
    for (const text of ['1', '12', 'S123', 'DKM-104a']) {
      const cmds = tpl.render({ nummer: text, kleefmeting: true }, bbox);
      const t = nummer(cmds);
      const half = estimateTextWidth(t.text, t.size, true) / 2;
      assert.ok(t.size > 0);
      assert.ok(t.x - half >= bbox.x - 1e-9, `${text}: links buiten het kader`);
      assert.ok(t.x + half <= bbox.x + bbox.width + 1e-9, `${text}: rechts buiten het kader`);
      assert.ok(t.y - t.size / 2 >= bbox.y - 1e-9, `${text}: boven het kader uit`);
      assert.ok(t.y + t.size / 2 <= conus(cmds).points[0].y + 1e-9, `${text}: over de conus`);
      assertBinnenBbox(cmds, bbox, 'sondering');
    }
  }
});

test('snappunt ligt op de conuspunt', () => {
  const punt = conus(tpl.render({}, BBOX)).points[2];
  assert.deepEqual(tpl.snapPoints({}, BBOX), [{ x: punt.x, y: punt.y, kind: 'endpoint' }]);
});
