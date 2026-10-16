import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { dimensionMeasure, writeDimensionMeasure } from './dimension-measure.js';

const dimension = { page: 1, startX: 20, startY: 40, endX: 120, endY: 40, measureText: '50' };

test('a dimension inherits the page scale and writes a complete PDF measure dictionary', async () => {
  const source = { annotations: [], measureScale: { pixelsPerUnit: 2, unit: 'mm' } };
  assert.deepEqual(dimensionMeasure(dimension, source), { scale: 0.5, unit: 'mm', precision: 0 });

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  const dict = pdf.context.obj({ Type: 'Annot', Subtype: 'Line', IT: PDFName.of('LineDimension'),
    Rect: [10, 140, 130, 170], L: [20, 160, 120, 160] });
  writeDimensionMeasure(dict, pdf.context, dimension, source);
  page.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(dict)]));

  const saved = await PDFDocument.load(await pdf.save());
  const line = saved.context.lookup(saved.getPage(0).node.Annots().get(0));
  const measure = line.lookup(PDFName.of('Measure'));
  assert.equal(measure.get(PDFName.of('Type')).toString(), '/Measure');
  assert.equal(measure.get(PDFName.of('Subtype')).toString(), '/RL');
  for (const key of ['X', 'D']) {
    const format = saved.context.lookup(measure.get(PDFName.of(key))).lookup(0);
    assert.equal(format.get(PDFName.of('C')).asNumber(), 0.5);
    assert.equal(format.get(PDFName.of('D')).asNumber(), 0);
    assert.equal(format.get(PDFName.of('U')).decodeText(), 'mm');
  }
});

test('scale region overrides document scale; explicit per-line scale wins', () => {
  const doc = { annotations: [{ type: 'scaleRegion', page: 1, x: 0, y: 0, width: 200, height: 100,
    scaleString: '1:100', units: 'm' }], measureScale: { pixelsPerUnit: 2, unit: 'mm' } };
  const fromRegion = dimensionMeasure(dimension, doc);
  assert.equal(fromRegion.unit, 'm');
  assert.ok(Math.abs(fromRegion.scale - (25.4 * 100 / 72000)) < 1e-10);
  assert.deepEqual(dimensionMeasure({ ...dimension, measureScale: 2, measureUnit: 'cm', measurePrecision: 3 }, doc),
    { scale: 2, unit: 'cm', precision: 3 });
});
