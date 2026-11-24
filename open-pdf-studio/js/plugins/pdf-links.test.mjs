import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';
import { controleerLinks, schrijfLinks } from './pdf-links.js';

test('controleerLinks rejects bad requests', () => {
  const goed = { page: 1, rect: { x: 1, y: 1, width: 5, height: 5 }, target: { page: 2 } };
  assert.doesNotThrow(() => controleerLinks([goed], 2));
  assert.throws(() => controleerLinks([], 2));
  assert.throws(() => controleerLinks([{ ...goed, page: 3 }], 2));
  assert.throws(() => controleerLinks([{ ...goed, rect: { x: 1, y: 1, width: 0, height: 5 } }], 2));
  assert.throws(() => controleerLinks([{ ...goed, target: { page: 2, x: 5 } }], 2));
});

test('schrijfLinks writes plain /Link annotations with /Dest, round trip', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]); doc.addPage([600, 800]);
  // Annotation space here: y down from the top of an unrotated page.
  const naarPdf = (page, x, y) => ({ x, y: 800 - y });
  schrijfLinks(doc, [
    { page: 1, rect: { x: 100, y: 100, width: 30, height: 30 }, target: { page: 2, x: 50, y: 60 } },
    { page: 2, rect: { x: 10, y: 10, width: 20, height: 20 }, target: { page: 1 } },
  ], naarPdf);
  const terug = await PDFDocument.load(await doc.save());
  const [p1, p2] = terug.getPages();
  const l1 = terug.context.lookup(p1.node.lookup(PDFName.of('Annots'), PDFArray).get(0), PDFDict);
  assert.equal(String(l1.get(PDFName.of('Subtype'))), '/Link');
  assert.equal(l1.get(PDFName.of('OPS_Subtype')), undefined);
  assert.equal(l1.lookup(PDFName.of('Rect')).toString(), '[ 100 670 130 700 ]');
  const d1 = l1.lookup(PDFName.of('Dest'), PDFArray);
  assert.equal(d1.get(0).toString(), p2.ref.toString());
  assert.equal(String(d1.get(1)), '/XYZ');
  assert.equal(d1.get(3).asNumber(), 740);
  const l2 = terug.context.lookup(p2.node.lookup(PDFName.of('Annots'), PDFArray).get(0), PDFDict);
  assert.equal(String(l2.lookup(PDFName.of('Dest'), PDFArray).get(1)), '/Fit');
});
