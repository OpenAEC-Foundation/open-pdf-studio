import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLabelOcrReader, labelOcrRegion } from './pagina-labels-ocr.js';
import { draaiVak } from './pagina-labels.js';

const rect = { x: 20, y: 30, width: 40, height: 150 };
const makeDoc = () => ({ id: 'doc', pdfDoc: {}, filePath: '/test.pdf' });

test('selection returns to intrinsic page space for every app rotation', () => {
  for (const extra of [0, 90, 180, 270]) {
    const displayed = draaiVak(rect, 600, 800, extra);
    assert.deepEqual(labelOcrRegion(displayed, { extra, breedte: 600, hoogte: 800 }), rect);
  }
});

test('vertical OCR preserves recognition order, sends crop and does not write a text layer', async () => {
  const doc = makeDoc();
  doc.ocrResults = { 1: [{ text: 'wrong old orientation' }] };
  const before = structuredClone(doc.ocrResults);
  const read = createLabelOcrReader({ isTauri: () => true, invoke: async (command, args) => {
    assert.equal(command, 'ocr_pdf_page');
    assert.deepEqual(args, { path: '/test.pdf', pageIndex: 0, lang: 'auto', labelRegion: rect });
    return [{ text: 'GRADING', top: 140 }, { text: 'PLAN', top: 80 }];
  } });
  assert.equal(await read(doc, 1, rect), 'GRADING PLAN');
  assert.deepEqual(doc.ocrResults, before);
});

test('deduplicates requests but invalidates on crop, page, PDF reload and path changes', async () => {
  let calls = 0;
  const doc = makeDoc();
  const read = createLabelOcrReader({ isTauri: () => true, invoke: async () => { calls++; return [{ text: 'A1' }]; } });
  assert.deepEqual(await Promise.all([read(doc, 1, rect), read(doc, 1, rect)]), ['A1', 'A1']);
  assert.equal(calls, 1);
  await read(doc, 1, { ...rect, x: 21 });
  await read(doc, 2, rect);
  doc.pdfDoc = {};
  await read(doc, 1, rect);
  doc.filePath = '/new.pdf';
  await read(doc, 1, rect);
  assert.equal(calls, 5);
});

test('failed OCR is retried and stale asynchronous results are discarded', async () => {
  const doc = makeDoc();
  let calls = 0;
  const read = createLabelOcrReader({ isTauri: () => true, invoke: async () => {
    if (++calls === 1) throw new Error('OCR failed');
    doc.pdfDoc = {};
    return [{ text: 'stale' }];
  } });
  await assert.rejects(read(doc, 1, rect), /OCR failed/);
  assert.equal(await read(doc, 1, rect), '');
  assert.equal(calls, 2);
});

test('web and unsaved documents retain existing OCR fallback without native calls', async () => {
  const read = createLabelOcrReader({ isTauri: () => false, invoke: () => { throw new Error('native'); } });
  const doc = makeDoc();
  doc.ocrResults = { 1: [{ text: 'A1', left: 25, top: 40, width: 20, height: 10 }] };
  assert.equal(await read(doc, 1, rect), 'A1');
  const extra = 90;
  assert.equal(await read(doc, 1, draaiVak(rect, 600, 800, extra), { extra, breedte: 600, hoogte: 800 }), 'A1');
});
