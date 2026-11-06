// Compare change report (#465): rows with page pair, type, position and size
// in mm and the text before/after, the CSV, the PDF summary with crops, and
// the comment text of a cloud.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  buildReportRows, buildReportCsv, buildReportPdf, textForChange, pdfSafeLabels, cloudComment, REPORT_COLUMNS,
} from './change-report.js';
import { PT_PER_MM } from './detect-plan.js';

const mm = (v) => v * PT_PER_MM;

// A 2 x 2 px PNG.
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
));

function samplePairs() {
  return [
    {
      pair: 1, oldPage: 1, newPage: 1, sheet: 'A-101',
      changes: [
        // A changed dimension figure: the text comparison knows before/after.
        { type: 'modified', source: 'pixel', x: mm(100), y: mm(50), width: mm(12), height: mm(4), old: { x: mm(100), y: mm(50), width: mm(12), height: mm(4) } },
        { type: 'added', source: 'pixel', x: mm(10), y: mm(20), width: mm(2), height: mm(2) },
      ],
      textChanges: [
        { type: 'modified', oldPage: 1, newPage: 1, oldText: '2350', newText: '2400',
          oldRects: [{ page: 1, x: mm(101), y: mm(51), w: mm(8), h: mm(3) }], newRects: [{ page: 1, x: mm(101), y: mm(51), w: mm(8), h: mm(3) }] },
        { type: 'added', oldPage: null, newPage: 2, newText: 'elsewhere', newRects: [{ page: 2, x: mm(10), y: mm(20), w: 10, h: 10 }] },
      ],
    },
    {
      pair: 2, oldPage: 3, newPage: 4, sheet: 'A-102',
      changes: [{ type: 'removed', source: 'pixel', x: mm(300), y: mm(200), width: mm(5.5), height: mm(1), old: { x: mm(150), y: mm(100), width: mm(11), height: mm(2) } }],
      textChanges: [],
    },
  ];
}

test('rows carry the page pair, type, position and size in mm, and the text before and after', () => {
  const rows = buildReportRows(samplePairs());
  assert.equal(rows.length, 3);
  const strip = ({ _change, _pair, ...r }) => r;
  assert.deepEqual(strip(rows[0]), {
    no: 1, pair: 1, oldPage: 1, newPage: 1, sheet: 'A-101', type: 'modified', source: 'pixel',
    xMm: 100, yMm: 50, widthMm: 12, heightMm: 4, oldText: '2350', newText: '2400',
  });
  // The "added" change does not overlap any text on this page pair.
  assert.equal(rows[1].oldText, '');
  assert.equal(rows[1].newText, '');
  assert.deepEqual([rows[2].oldPage, rows[2].newPage, rows[2].type, rows[2].widthMm], [3, 4, 'removed', 5.5]);
  // Text known on the change record itself wins.
  const own = buildReportRows([{ pair: 1, oldPage: 1, newPage: 1, changes: [{ type: 'added', source: 'text', x: 0, y: 0, width: 1, height: 1, newText: 'X' }] }]);
  assert.equal(own[0].newText, 'X');
});

test('removed changes look for their text on the old page', () => {
  const t = textForChange(
    { type: 'removed', x: 0, y: 0, width: 5, height: 5, old: { x: 500, y: 500, width: 10, height: 10 } },
    [{ type: 'removed', oldText: 'gone', oldRects: [{ page: 7, x: 505, y: 505, w: 3, h: 3 }] }],
    7, 9,
  );
  assert.deepEqual(t, { oldText: 'gone', newText: '' });
});

test('CSV: localised headings and types, safe quoting, one row per change', () => {
  const rows = buildReportRows(samplePairs());
  rows[1].newText = 'a, "quoted" =text';
  const headers = Object.fromEntries(REPORT_COLUMNS.map((k) => [k, `H-${k}`]));
  const csv = buildReportCsv(rows, headers, { added: 'Toegevoegd', removed: 'Verwijderd', modified: 'Gewijzigd', pixel: 'Tekening' });
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[0], REPORT_COLUMNS.map((k) => `H-${k}`).join(','));
  assert.equal(lines[1], '1,1,1,1,A-101,Gewijzigd,Tekening,100,50,12,4,2350,2400');
  assert.ok(lines[2].endsWith(`,"a, ""quoted"" =text"`), lines[2]);
  assert.ok(lines[3].includes('Verwijderd'));
});

test('PDF summary: lists every change with its pages and text, and embeds the crops', async () => {
  const rows = buildReportRows(samplePairs());
  const labels = {
    title: 'Compare report', generated: 'Generated', oldDoc: 'Old', newDoc: 'New', changes: 'Changes',
    settings: 'Settings', page: 'Page', none: 'No changes', no: 'No.', oldPage: 'Old page', newPage: 'New page',
    sheet: 'Sheet', type: 'Type', xMm: 'X (mm)', yMm: 'Y (mm)', widthMm: 'Width (mm)', heightMm: 'Height (mm)',
    oldText: 'Text before', newText: 'Text after',
  };
  const crops = new Map([[1, { old: PNG, new: PNG }], [3, { new: PNG }]]);
  const bytes = await buildReportPdf({
    rows, labels, typeNames: { added: 'Added', removed: 'Removed', modified: 'Modified' },
    meta: { oldName: 'plan-rev-A.pdf', newName: 'plan-rev-B.pdf', date: '2026-10-27 12:00', settings: 'line' }, crops,
  });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 1);
  assert.equal(pdf.getTitle(), 'Compare report');

  const doc = await getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false }).promise;
  let text = '';
  let images = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    text += (await page.getTextContent()).items.map((i) => i.str).join(' ') + '\n';
    const ops = await page.getOperatorList();
    images += ops.fnArray.filter((f) => f === OPS.paintImageXObject).length;
  }
  await doc.loadingTask?.destroy?.();
  for (const s of ['plan-rev-A.pdf', 'plan-rev-B.pdf', 'Changes: 3', 'A-101', 'A-102', '2350', '2400', 'Modified', 'Removed', 'Text before', 'Page 1 /']) {
    assert.ok(text.includes(s), `PDF text contains ${s}`);
  }
  assert.equal(images, 3, 'three crops embedded');
});

test('PDF labels fall back to English when the standard font cannot show them', () => {
  const en = { title: 'Compare report' };
  assert.equal(pdfSafeLabels({ title: 'Vergleichsbericht' }, en).title, 'Vergleichsbericht');
  assert.equal(pdfSafeLabels({ title: '比较报告' }, en), en);
});

test('an empty comparison still gives a valid summary', async () => {
  const bytes = await buildReportPdf({ rows: [], labels: { title: 'R', none: 'No changes' }, meta: { oldName: 'a', newName: 'b', date: 'd' } });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
});

test('cloud comment names the change, its size and the text before and after', () => {
  const [row] = buildReportRows(samplePairs());
  const c = cloudComment(row, { prefix: 'Vergelijking', before: 'Voor', after: 'Na' }, { modified: 'Gewijzigd' });
  assert.equal(c, 'Vergelijking: Gewijzigd\n12 x 4 mm\nVoor: 2350\nNa: 2400');
});
