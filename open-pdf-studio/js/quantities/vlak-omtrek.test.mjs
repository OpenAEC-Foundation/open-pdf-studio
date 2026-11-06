// De lengte-kolom van vlakken is hun omtrek in de schaal-eenheid (#982), en
// elementen zonder lengte (tekst, tellingen, symbolen) laten de cel leeg.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSchedule } from './engine.js';
import { fieldsForCategories } from './categories.js';

const CATS = ['area', 'line-based', 'count', 'text-annotation', 'symbol'];
const lengtes = (els) => buildSchedule(els, { categories: CATS, fields: ['length'] })
  .groups[0].rows.map((r) => r.vals.length);
const vierkant = (x, y, z) => [{ x, y }, { x: x + z, y }, { x: x + z, y: y + z }, { x, y: y + z }];
const bijna = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

test('a measured area: the perimeter follows the scale of its area value', () => {
  // 10 x 10 pt, waarde 400 m² → 2 m per pt → omtrek 4 x 20 m.
  const [l] = lengtes([{ type: 'measureArea', page: 1, points: vierkant(0, 0, 10), measureValue: 400, measureUnit: 'm²' }]);
  bijna(l, 80, 'omtrek');
});

test('a measured area in mm² keeps mm for its perimeter, like the distances', () => {
  const r = buildSchedule(
    [{ type: 'measureArea', page: 1, points: vierkant(0, 0, 10), measureValue: 100 * 25 * 25, measureUnit: 'mm²' }],
    { categories: ['area'], fields: ['area', 'length'] },
  );
  bijna(r.groups[0].rows[0].vals.length, 1000, 'omtrek in mm');
  assert.equal(r.columns.find((c) => c.key === 'length').unit, 'mm');
});

test('a measured area without any scale leaves the length empty instead of page units', () => {
  assert.deepEqual(lengtes([{ type: 'measureArea', page: 1, points: vierkant(0, 0, 10) }]), [null]);
});

test('holes and separate parts add their edge to the perimeter', () => {
  const [l] = lengtes([{
    type: 'polygon', page: 1, points: vierkant(0, 0, 10), holes: [vierkant(2, 2, 2)],
  }]);
  bijna(l, 40 + 8, 'buitenrand plus gatrand');
});

test('circles and ellipses get their circumference, boxes twice width plus height', () => {
  const [cirkel, ellips, kader] = lengtes([
    { type: 'circle', page: 1, x: 0, y: 0, width: 20, height: 20 },
    { type: 'ellipse', page: 1, x: 0, y: 0, width: 20, height: 10 },
    { type: 'box', page: 1, x: 0, y: 0, width: 30, height: 10, __pxPerUnit: 2, __unit: 'mm' },
  ]);
  bijna(cirkel, Math.PI * 20, 'cirkel');
  assert.ok(ellips > 48.4 && ellips < 48.5, `ellips ${ellips}`);
  bijna(kader, 40, 'kader op schaal');
});

test('an arc segment in an area counts as a curve, not as its chord', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0, arc: true, bulge: 0.5 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const [l] = lengtes([{ type: 'filledArea', page: 1, points: pts }]);
  assert.ok(l > 40, `boog langer dan de koorde: ${l}`);
});

test('text, counts, symbols and scale regions have no length', () => {
  assert.deepEqual(lengtes([
    { type: 'callout', page: 1, startX: 0, startY: 0, endX: 100, endY: 0, points: vierkant(0, 0, 50) },
    { type: 'count', page: 1, x: 0, y: 0 },
    { type: 'stamp', page: 1, x: 0, y: 0, width: 50, height: 50 },
    { type: 'scaleRegion', page: 1, x: 0, y: 0, width: 50, height: 50 },
  ]), [null, null, null, null]);
});

test('an area-only schedule offers the length column', () => {
  assert.ok(fieldsForCategories(['area']).some((f) => f.key === 'length'));
});
