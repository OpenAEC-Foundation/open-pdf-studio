// A link to an area on a page (#1226): the model, the conversion of the dragged
// box, and the area through save and load.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import { normaliseerDoel, linkGebied, herschikLinkDoel } from './link-model.js';
import { gebiedNaarPdf } from './link-gebied.js';
import { linkDoelVoorPdf } from '../../pdf/saver/link-opslaan.js';
import { leesLinkDoel } from '../../pdf/loader/link-laden.js';

const GEBIED = { left: 100, bottom: 200, right: 400, top: 500 };

test('an area is four numbers with a width and a height, corners in any order', () => {
  assert.deepEqual(linkGebied(GEBIED), GEBIED);
  assert.deepEqual(linkGebied({ left: 400, bottom: 500, right: 100, top: 200 }), GEBIED);
  assert.equal(linkGebied({ left: 100, bottom: 200, right: 100, top: 500 }), null, 'no width');
  assert.equal(linkGebied({ left: 100, bottom: 200, right: 400 }), null, 'a number is missing');
  assert.equal(linkGebied(null), null);
});

test('a page target with an area is valid; without a usable area it is not', () => {
  assert.deepEqual(normaliseerDoel({ kind: 'page', page: 2, fit: 'rect', ...GEBIED }, 5),
    { kind: 'page', page: 2, fit: 'rect', ...GEBIED });
  assert.equal(normaliseerDoel({ kind: 'page', page: 2, fit: 'rect' }, 5), null);
  assert.equal(normaliseerDoel({ kind: 'page', page: 9, fit: 'rect', ...GEBIED }, 5), null, 'page outside the document');
  // The other views are as they were.
  assert.deepEqual(normaliseerDoel({ kind: 'page', page: 1, fit: 'fit' }, 5), { kind: 'page', page: 1, fit: 'fit' });
});

test('the area moves with its page when pages are rearranged, and breaks when the page is deleted', () => {
  const doel = { kind: 'page', page: 2, fit: 'rect', ...GEBIED };
  assert.deepEqual(herschikLinkDoel(doel, { 2: 4 }), { ...doel, page: 4 });
  assert.equal(herschikLinkDoel(doel, { 2: null }).broken, true);
});

test('a dragged box becomes an area in the units of the page', () => {
  // An upright page of 842 high: y runs down in app space, up in the PDF.
  const naarPdf = (x, y) => [x, 842 - y];
  assert.deepEqual(gebiedNaarPdf({ x: 100, y: 342, width: 300, height: 300 }, naarPdf), GEBIED);
  // A click without a drag is no area.
  assert.equal(gebiedNaarPdf({ x: 100, y: 342, width: 0.5, height: 300 }, naarPdf), null);
  assert.equal(gebiedNaarPdf(null, naarPdf), null);
});

test('the area is saved as a /FitR destination and read back', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  pdf.addPage([595, 842]);
  const paginas = pdf.getPages();
  const doel = { kind: 'page', page: 2, fit: 'rect', ...GEBIED };
  const { Dest } = linkDoelVoorPdf(pdf.context, doel, paginas);
  const delen = Dest.asArray();
  assert.equal(delen[0], paginas[1].ref);
  assert.equal(delen[1].toString(), '/FitR');
  assert.deepEqual(delen.slice(2).map((n) => n.asNumber()), [100, 200, 400, 500]);

  const dict = pdf.context.obj({ Type: 'Annot', Subtype: 'Link' });
  dict.set(PDFName.of('Dest'), Dest);
  assert.deepEqual(leesLinkDoel(pdf.context, pdf, dict), doel);
});

test('a /FitR destination without usable numbers opens the whole page', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const dict = pdf.context.obj({ Type: 'Annot', Subtype: 'Link' });
  dict.set(PDFName.of('Dest'), pdf.context.obj([pdf.getPages()[0].ref, PDFName.of('FitR'), 10, 10, 10, 10]));
  assert.deepEqual(leesLinkDoel(pdf.context, pdf, dict), { kind: 'page', page: 1, fit: 'fit' });
});

test('following the link asks for that area, and the dialog offers it', () => {
  const lees = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(lees('./link-volgen.js'), /\{ name: 'FitR' \}, doel\.left, doel\.bottom, doel\.right, doel\.top/);
  const dialoog = lees('../../solid/components/dialogs/LinkDialog.jsx');
  assert.match(dialoog, /value: 'rect', label: t\('link\.viewArea'\)/);
  assert.match(dialoog, /id="link-dialog-pick-area"/);
  assert.match(dialoog, /kiesLinkGebied\(/);
});
