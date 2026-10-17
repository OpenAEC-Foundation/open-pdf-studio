import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { dimensionMeasure, writeDimensionMeasure } from './dimension-measure.js';
import { extractAnnotationColors } from '../loader/color-extraction.js';
import { extraVoorAnnotatie } from '../loader/extra-sleutel.js';
import { maatlijnUitBestand } from '../loader/maatlijn-uit-bestand.js';

const dimension = { page: 1, startX: 20, startY: 40, endX: 120, endY: 40, measureText: '50' };

/** A saved dimension line with the measure dictionary of `ann`. */
async function savedDimension(ann, doc) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  const dict = pdf.context.obj({ Type: 'Annot', Subtype: 'Line', IT: PDFName.of('LineDimension'),
    OPS_Subtype: PDFString.of('measureDistance'), Contents: PDFString.of('50'),
    Rect: [10, 140, 130, 170], L: [20, 160, 120, 160] });
  writeDimensionMeasure(dict, pdf.context, ann, doc);
  page.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(dict)]));
  return pdf.save();
}

/** Read back the way js/pdf/loader.js does: pdf.js annotations plus the extra keys. */
async function reloaded(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const [annot] = await page.getAnnotations();
  await doc.loadingTask.destroy();
  const map = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  return maatlijnUitBestand({ annot, extra: extraVoorAnnotatie(map, annot) || {},
    convertPoint: (x, y) => viewport.convertToViewportPoint(x, y) });
}

test('a dimension inherits the page scale and writes a complete PDF measure dictionary', async () => {
  const source = { annotations: [], measureScale: { pixelsPerUnit: 2, unit: 'mm' } };
  assert.deepEqual(dimensionMeasure(dimension, source), { scale: 0.5, unit: 'mm', precision: 0, inherited: true });

  const saved = await PDFDocument.load(await savedDimension(dimension, source));
  const line = saved.context.lookup(saved.getPage(0).node.Annots().get(0));
  const measure = line.lookup(PDFName.of('Measure'));
  assert.equal(measure.get(PDFName.of('Type')).toString(), '/Measure');
  assert.equal(measure.get(PDFName.of('Subtype')).toString(), '/RL');
  const format = key => saved.context.lookup(measure.get(PDFName.of(key))).lookup(0);
  // /X converts points to the unit; /D and /A convert from the /X units.
  assert.equal(format('X').get(PDFName.of('C')).asNumber(), 0.5);
  assert.equal(format('X').get(PDFName.of('U')).decodeText(), 'mm');
  for (const [key, unit] of [['D', 'mm'], ['A', 'mm²']]) {
    assert.equal(format(key).get(PDFName.of('C')).asNumber(), 1, `${key} factor`);
    assert.equal(format(key).get(PDFName.of('D')).asNumber(), 1, `${key} precision denominator for 0 decimals`);
    assert.equal(format(key).get(PDFName.of('U')).decodeText(), unit);
  }
  assert.equal(line.get(PDFName.of('OPS_ScaleInherited')).toString(), 'true');
});

test('scale region overrides document scale; explicit per-line scale wins', () => {
  const doc = { annotations: [{ type: 'scaleRegion', page: 1, x: 0, y: 0, width: 200, height: 100,
    scaleString: '1:100', units: 'm' }], measureScale: { pixelsPerUnit: 2, unit: 'mm' } };
  const fromRegion = dimensionMeasure(dimension, doc);
  assert.equal(fromRegion.unit, 'm');
  assert.equal(fromRegion.inherited, true);
  assert.ok(Math.abs(fromRegion.scale - (25.4 * 100 / 72000)) < 1e-10);
  assert.deepEqual(dimensionMeasure({ ...dimension, measureScale: 2, measureUnit: 'cm', measurePrecision: 3 }, doc),
    { scale: 2, unit: 'cm', precision: 3, inherited: false });
});

test('an explicit scale and its precision survive saving and reopening', async () => {
  const ann = { ...dimension, measureScale: 2, measureUnit: 'cm', measurePrecision: 2 };
  const m = await reloaded(await savedDimension(ann, { annotations: [] }));
  assert.equal(m.measureScale, 2);
  assert.equal(m.measureUnit, 'cm');
  assert.equal(m.measurePrecision, 2, '/D 100 is two decimals');
});

test('an inherited scale is not frozen on the line after reopening', async () => {
  const doc = { annotations: [], measureScale: { pixelsPerUnit: 2, unit: 'mm' } };
  const m = await reloaded(await savedDimension(dimension, doc));
  assert.equal(m.measureScale, undefined, 'the line keeps following the page scale');
  assert.equal(m.measureUnit, undefined);
});
