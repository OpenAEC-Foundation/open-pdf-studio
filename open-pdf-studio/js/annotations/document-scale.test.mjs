// The document-level measure scale is read from and written to the document
// that is handed in - a PDF loading in a background tab never picks up the
// title block of the tab in front.

import assert from 'node:assert/strict';
import test from 'node:test';

import { findScaleInText, detectScaleInDocument, scaleFromScaleBar } from './document-scale.js';

const items = (...strs) => strs.map((str) => ({ str }));

// Minimal stand-in for a loaded document: PDF.js getPage/getTextContent.
function fakeDoc(pages, currentPage = 1) {
  const asked = [];
  return {
    asked,
    currentPage,
    pdfDoc: {
      getPage: async (n) => {
        asked.push(n);
        return { getTextContent: async () => ({ items: items(...(pages[n] || [])) }) };
      },
    },
  };
}

test('labelled scale in several languages', () => {
  assert.deepEqual(findScaleInText(items('Schaal 1:20')), { ratio: 20, scaleText: 'Schaal 1:20' });
  assert.deepEqual(findScaleInText(items('SCALE: 1:200')), { ratio: 200, scaleText: 'SCALE: 1:200' });
  assert.deepEqual(findScaleInText(items('M 1:500')), { ratio: 500, scaleText: 'M 1:500' });
  assert.deepEqual(findScaleInText(items('Maßstab 1/50')), { ratio: 50, scaleText: 'Maßstab 1/50' });
});

test('the labelled scale wins over an earlier bare ratio', () => {
  assert.equal(findScaleInText(items('detail 1:5', 'Schaal 1:100')).ratio, 100);
});

test('a bare 1:N is accepted when nothing is labelled', () => {
  assert.deepEqual(findScaleInText(items('Plattegrond', '1:100')), { ratio: 100, scaleText: '1:100' });
});

test('label and value in separate text items are still found', () => {
  assert.equal(findScaleInText(items('Schaal', '1:50')).ratio, 50);
});

test('no scale, an absurd ratio or no text at all gives null', () => {
  assert.equal(findScaleInText(items('Begane grond', 'verhouding 2:3')), null);
  assert.equal(findScaleInText(items('Schaal 1:0')), null);
  assert.equal(findScaleInText(items('Schaal 1:20000')), null);
  assert.equal(findScaleInText([]), null);
  assert.equal(findScaleInText(undefined), null);
});

test('detection reads the document it is given, not another loaded one', async () => {
  // U is the drawing in front (1:100); R1 finishes loading behind it (1:20).
  const u = fakeDoc({ 1: ['Schaal 1:100'] });
  const r1 = fakeDoc({ 1: ['Detail', 'Schaal 1:20'] });

  assert.equal((await detectScaleInDocument(r1, 1)).ratio, 20);
  assert.deepEqual(r1.asked, [1]);
  assert.deepEqual(u.asked, [], 'the other document is not touched');
  assert.equal((await detectScaleInDocument(u, 1)).ratio, 100);
});

test('detection without a page number uses the current page of that document', async () => {
  const doc = fakeDoc({ 1: ['Schaal 1:100'], 3: ['Schaal 1:5'] }, 3);
  assert.equal((await detectScaleInDocument(doc)).ratio, 5);
  assert.deepEqual(doc.asked, [3]);
});

test('a document that is not loaded yet gives null', async () => {
  assert.equal(await detectScaleInDocument({ pdfDoc: null, currentPage: 1 }, 1), null);
  assert.equal(await detectScaleInDocument(null, 1), null);
});

test('scale bar to document scale', () => {
  assert.deepEqual(scaleFromScaleBar({ type: 'scaleBar', pixelsPerUnit: 0.5, unit: 'm' }), {
    pixelsPerUnit: 0.5, unit: 'm', method: 'scaleBar', scaleRatio: 0,
  });
  // unit defaults to mm
  assert.equal(scaleFromScaleBar({ pixelsPerUnit: 0.25 }).unit, 'mm');
});

test('a scale bar without a usable calibration leaves the document scale alone', () => {
  assert.equal(scaleFromScaleBar(null), null);
  assert.equal(scaleFromScaleBar({ pixelsPerUnit: 0 }), null);
  assert.equal(scaleFromScaleBar({ pixelsPerUnit: -1 }), null);
  assert.equal(scaleFromScaleBar({ unit: 'mm' }), null);
});
