// Hoeveelheden na heropenen: meetwaarden komen uit geometrie en /Measure,
// niet uit de afgeronde (of door de gebruiker gewijzigde) labeltekst (#1287).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { state, opslaan, laad, leegBlad } from './rondgang.testhulp.mjs';
import { buildSchedule } from '../quantities/engine.js';

const ring = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const points = ring(100, 100, 200, 100);
const holes = [ring(120, 120, 40, 20)];
const nearly = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
function quantities(ann, expectedArea = 2, expectedLength = 6) {
  const result = buildSchedule([ann], { categories: ['area'], fields: ['area', 'length'],
    format: { area: { unit: 'm²' }, length: { unit: 'm' } } });
  assert.deepEqual(result.columns.map(c => c.unit), ['m²', 'm']);
  const vals = result.groups[0].rows[0].vals;
  assert.equal(typeof vals.area, 'number', 'area is available before editing any properties');
  nearly(vals.area, expectedArea);
  nearly(vals.length, expectedLength);
}

for (const unit of ['m', 'mm']) {
  test(`area and perimeter survive save/reopen with own ${unit} scale and a hole`, async () => {
    const scale = unit === 'm' ? 0.01 : 10;
    const model = { id: 'area', type: 'measureArea', page: 1, points, holes,
      measureScale: scale, measureUnit: `${unit}²`, measureValue: 19200 * scale ** 2,
      measureText: 'Room A', color: '#ff0000', lineWidth: 1 };
    const bytes = await opslaan(await leegBlad(), [model]);
    const [ann] = await laad(bytes);
    assert.equal(typeof ann.measureValue, 'number');
    assert.equal(ann.measureUnit, `${unit}²`);
    nearly(ann.measureScale, scale);
    quantities(ann, 1.92, 7.2);
    const [again] = await laad(await opslaan(bytes, [ann]));
    quantities(again, 1.92, 7.2);
  });
}

test('an inherited saved scale supplies quantities without becoming an own scale', async () => {
  const model = { id: 'inherited', type: 'measureArea', page: 1, points,
    measureUnit: 'm²', measureValue: 2, measureText: '2.00 m²', color: '#ff0000', lineWidth: 1 };
  const bytes = await opslaan(await leegBlad(), [model], {
    document: { measureScale: { pixelsPerUnit: 100, unit: 'm' } },
  });
  // The saved /Measure must suffice even before the page scale is restored.
  state.documents[0].measureScale = null;
  const [ann] = await laad(bytes);
  quantities(ann);
  assert.ok(!ann.measureScale, 'continues to inherit calibration');
  assert.equal(ann.measureUnit, 'm²');
});

test('foreign area keeps its caption and converts /X in mm to /A in m²', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const ctx = pdf.context;
  page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Polygon', IT: PDFName.of('PolygonDimension'),
    Rect: [100, 642, 300, 742], Vertices: [100, 742, 300, 742, 300, 642, 100, 642],
    Contents: PDFString.of('Room A'),
    Measure: { Type: 'Measure', Subtype: 'RL',
      X: [{ C: 10, U: PDFString.of('mm') }],
      A: [{ C: 0.000001, U: PDFString.of('m²') }],
    },
  }))]));
  const [ann] = await laad(await pdf.save());
  quantities(ann);
  assert.equal(ann.measureText, 'Room A');
  assert.equal(ann.measureUnit, 'm²');
  nearly(ann.measureScale, 0.01);
});
