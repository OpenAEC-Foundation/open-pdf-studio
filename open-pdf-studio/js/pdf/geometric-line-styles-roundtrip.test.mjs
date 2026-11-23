import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mupdf from 'mupdf';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { leegBlad, opslaan, laad, woordenboeken } from './rondgang.testhulp.mjs';
import { GEOMETRIC_LINE_STYLES } from '../annotations/geometric-line-styles.js';
function pixels(bytes) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const page = doc.loadPage(0);
  const pix = page.toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceRGB, false, true);
  const data = pix.getPixels().slice(); pix.destroy(); page.destroy(); doc.destroy(); return data;
}
const base = { page: 1, color: '#1144cc', strokeColor: '#1144cc', opacity: 0.6, lineWidth: 1,
  author: 'Tester', createdAt: '2026-11-22T17:33:06Z', modifiedAt: '2026-11-22T17:33:06Z' };
for (const type of ['line', 'polyline']) test(`${type}: all nine patterns survive two saves and reverting to solid`, async () => {
  const annotations = GEOMETRIC_LINE_STYLES.map((borderStyle, i) => ({ ...base, id: String(i), type, borderStyle,
    ...(type === 'line' ? { startX: 40, startY: 40 + i * 70, endX: 500, endY: 40 + i * 70 }
      : { points: [{ x: 40, y: 40 + i * 70 }, { x: 200, y: 50 + i * 70 }, { x: 500, y: 40 + i * 70 }] }) }));
  let bytes = await opslaan(await leegBlad(), annotations);
  const firstPixels = pixels(bytes);
  assert.ok(firstPixels.filter(c => c < 240).length > 3000, 'external PDF viewer sees pattern ink');
  for (let cycle = 0; cycle < 2; cycle++) {
    const loaded = await laad(bytes);
    assert.deepEqual(loaded.map(a => a.borderStyle), GEOMETRIC_LINE_STYLES);
    for (const { dict, doc } of await woordenboeken(bytes)) {
      assert.ok(dict.get(PDFName.of('OPS_LinePattern')));
      const ap = dict.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
      const content = new TextDecoder().decode(decodePDFRawStream(ap).decode());
      assert.ok(content.includes('1 j'));
      assert.ok(content.split(' l').length > 2);
      assert.equal(content.includes('NaN'), false);
    }
    bytes = await opslaan(bytes, loaded);
    assert.deepEqual(pixels(bytes), firstPixels, 'external appearance unchanged after reload');
  }
  const changed = await laad(bytes); changed.forEach(a => { a.borderStyle = 'solid'; });
  const solid = await opslaan(bytes, changed);
  assert.ok((await laad(solid)).every(a => a.borderStyle === 'solid'));
  for (const { dict } of await woordenboeken(solid)) assert.equal(dict.get(PDFName.of('OPS_LinePattern')), undefined);
});
for (const rotatie of [0, 90, 180, 270]) test(`curve and page rotation ${rotatie} retain pattern and geometry`, async () => {
  const ann = { ...base, id: 'curve', type: 'polyline', borderStyle: 'insulation',
    points: [{ x: 40, y: 100 }, { x: 400, y: 100 }], curves: [{ c1x: 30, c1y: 100, c2x: -40, c2y: 100 }] };
  const source = await PDFDocument.load(await leegBlad({ rotatie }));
  source.getPage(0).setCropBox(20, 30, 500, 700);
  const bytes = await opslaan(await source.save(), [ann]);
  const [loaded] = await laad(bytes);
  assert.equal(loaded.borderStyle, 'insulation');
  assert.deepEqual(loaded.points, ann.points);
  assert.deepEqual(loaded.curves, ann.curves);
  assert.deepEqual(pixels(await opslaan(bytes, [loaded])), pixels(bytes));
});
