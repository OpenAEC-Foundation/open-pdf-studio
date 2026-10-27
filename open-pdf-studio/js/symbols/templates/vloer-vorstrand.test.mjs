// Parametrisch wapeningsdetail vloer met vorstrand (#312): geometrie uit de
// parameters, staven voor de buigstaat en tekening binnen de bbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { vloerVorstrandTemplate as tpl, vorstrandLayout, vorstrandStaven } from './vloer-vorstrand.js';
import { defaultParams, getTemplate } from '../registry.js';
import { staafLengte } from '../../quantities/wapening.js';
import { assertBinnenBbox, teksten } from './binnen-bbox.testhulp.mjs';

test('geregistreerd met ware maat', () => {
  assert.equal(getTemplate('vloer-vorstrand'), tpl);
  const mm = tpl.realSizeMm(defaultParams(tpl));
  assert.ok(mm.width > 1600 && mm.height > 800);
});

test('betonomtrek: vloer + verdiepte rand, met breeklijn', () => {
  const L = vorstrandLayout({ vloerdikte: 200, vorstrandBreedte: 400, vorstrandHoogte: 800, vloerLengte: 1200 });
  const xs = L.omtrek.map((p) => p.x), ys = L.omtrek.map((p) => p.y);
  assert.equal(Math.min(...xs), L.ox);
  assert.equal(Math.max(...ys) - Math.min(...ys), 800);
  // Onderkant vloer ligt op de vloerdikte, de rand loopt door tot de vorstrandhoogte.
  assert.ok(L.omtrek.some((p) => p.y === L.oy + 200 && p.x === L.ox + 400));
  assert.ok(L.omtrek.some((p) => p.y === L.oy + 800 && p.x === L.ox + 400));
  assert.equal(L.omtrek.length, 10, 'inclusief breeklijn');
});

test('netlagen en stippen volgen de parameters', () => {
  assert.equal(vorstrandLayout({}).netten.length, 2);
  assert.deepEqual(vorstrandLayout({ netLagen: 'onder' }).netten.map((n) => n.laag), ['onder']);
  const ruim = vorstrandLayout({ netAfstand: 300 }).netten[0].stippen.length;
  const dicht = vorstrandLayout({ netAfstand: 100 }).netten[0].stippen.length;
  assert.ok(dicht > ruim);
  const L = vorstrandLayout({ dekking: 40, netDiameter: 8 });
  assert.equal(L.netten.find((n) => n.laag === 'boven').y, L.oy + 40 + 4);
});

test('langsstaven en beugel in de vorstrand', () => {
  const L = vorstrandLayout({ randAantal: 5 });
  assert.equal(L.rand.length, 5);
  assert.equal(L.rand.filter((r) => r.y < L.oy + 200).length, 3, 'drie boven, twee onder');
  assert.equal(L.beugel.w, 400 - 80);
  assert.equal(L.beugel.h, 800 - 80);
});

test('staven voor de buigstaat over de randlengte', () => {
  const s = vorstrandStaven({ lengte: 10000, dekking: 40, beugelAfstand: 200, staafnummerStart: '7' });
  assert.deepEqual([s.rand.staafnummer, s.rand.aantal, s.rand.lengteMm, s.rand.diameter], ['7', 4, 9920, 12]);
  assert.equal(s.beugel.staafnummer, '8');
  assert.equal(s.beugel.aantal, 50);
  assert.equal(s.beugel.vormcode, '51');
  assert.equal(s.beugel.lengteMm, staafLengte('51', { a: 320, b: 720 }, 8));
  assert.deepEqual(tpl.rebarItems({ lengte: 0 }).map((i) => i.aantal), [4, 0]);
  assert.equal(vorstrandStaven({ staafnummerStart: '' }).rand.staafnummer, '');
});

test('render binnen de bbox, met legenda en staafnummers', () => {
  const p = defaultParams(tpl);
  const mm = tpl.realSizeMm(p);
  const bbox = { x: 10, y: 10, width: mm.width / 6, height: mm.height / 6 };
  for (const extra of [{}, { toonMaten: false }, { netLagen: 'boven', randAantal: 0 }, { vorstrandHoogte: 1200, vloerLengte: 400 }]) {
    const q = { ...p, ...extra };
    const m = tpl.realSizeMm(q);
    const b = { x: 10, y: 10, width: m.width / 6, height: m.height / 6 };
    assertBinnenBbox(tpl.render(q, b), b, JSON.stringify(extra));
  }
  const t = teksten(tpl.render(p, bbox));
  assert.ok(t.includes('1') && t.includes('2'), 'staafnummers');
  assert.ok(t.some((s) => s.includes('lg=9920')));
  assert.ok(t.some((s) => s.startsWith('bgls')));
  assert.ok(t.includes('800') && t.includes('400') && t.includes('200'), 'maatvoering');
});
