// Compare vector diff (#465, gap 8): segments from real PDF operator lists
// (pdf-lib writes the PDF, pdf.js reads it), page classification and the
// exact path comparison with a tolerance and through an alignment.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pathSegments, classifyPage, diffSegments, vectorComparable } from './vector-diff.js';
import { alignmentMatrix } from './alignment.js';
import { PT_PER_MM } from './detect-plan.js';

const mm = (v) => v * PT_PER_MM;
const A3 = [mm(420), mm(297)];

// A drawing sheet: a grid of lines, a circle and some text. `edit` changes it.
async function sheetPdf(edit = {}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(A3);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const shift = edit.shiftMm ? mm(edit.shiftMm) : 0;
  for (let i = 0; i < 30; i++) {
    page.drawLine({ start: { x: mm(20), y: mm(20 + i * 8) }, end: { x: mm(200), y: mm(20 + i * 8) }, thickness: 0.7, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: mm(220 + i * 6), y: mm(20) }, end: { x: mm(220 + i * 6), y: mm(270) }, thickness: 0.35, color: rgb(0, 0, 0) });
  }
  // The wall that moves in the revision.
  page.drawLine({ start: { x: mm(30), y: mm(280) + shift }, end: { x: mm(90), y: mm(280) + shift }, thickness: 1, color: rgb(0, 0, 0) });
  page.drawCircle({ x: mm(300), y: mm(150), size: mm(10), borderColor: rgb(0, 0, 0), borderWidth: 0.5 });
  if (edit.extraLine) page.drawLine({ start: { x: mm(390), y: mm(50) }, end: { x: mm(392), y: mm(50) }, thickness: 0.35 });
  page.drawText(edit.text || 'Sheet A-101', { x: mm(330), y: mm(15), size: 10, font });
  return pdf.save();
}

async function segmentsOf(bytes) {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  const res = pathSegments(ops, OPS, vp.transform);
  await doc.loadingTask?.destroy?.();
  return { ...res, size: { width: vp.width, height: vp.height } };
}

test('segments come out in page points, top-left origin', async () => {
  const { segments, stats, size } = await segmentsOf(await sheetPdf());
  assert.ok(stats.segments >= 61, `segments ${stats.segments}`);
  // The first horizontal line: from x = 20 mm to 200 mm at 20 mm above the
  // bottom, i.e. 277 mm from the top.
  let found = false;
  for (let i = 0; i < segments.length; i += 4) {
    const [x1, y1, x2, y2] = segments.subarray(i, i + 4);
    if (Math.abs(Math.min(x1, x2) - mm(20)) < 0.1 && Math.abs(Math.max(x1, x2) - mm(200)) < 0.1 && Math.abs(y1 - mm(277)) < 0.1 && Math.abs(y2 - mm(277)) < 0.1) found = true;
  }
  assert.ok(found, 'first grid line found in page coordinates');
  assert.equal(classifyPage(stats, size.width * size.height), 'vector');
});

test('page classification: vector, scan, text', () => {
  const area = 1000 * 1000;
  assert.equal(classifyPage({ segments: 500, glyphs: 40, imageArea: 0 }, area), 'vector');
  assert.equal(classifyPage({ segments: 4, glyphs: 0, imageArea: area * 0.9 }, area), 'scan');
  assert.equal(classifyPage({ segments: 10, glyphs: 3000, imageArea: 0 }, area), 'text');
  assert.ok(vectorComparable('vector', 'vector'));
  assert.ok(!vectorComparable('vector', 'scan'));
});

test('identical sheets: no vector changes; a moved wall and an added 2 mm line are found exactly', async () => {
  const a = await segmentsOf(await sheetPdf());
  const same = diffSegments(a.segments, (await segmentsOf(await sheetPdf())).segments);
  assert.deepEqual(same.clusters, []);
  assert.equal(same.matched, a.stats.segments);

  const b = await segmentsOf(await sheetPdf({ shiftMm: -2, extraLine: true }));
  const r = diffSegments(a.segments, b.segments, { tolPt: mm(0.25), mergePt: mm(1.5) });
  const inMm = r.clusters.map((c) => ({ type: c.type, x: c.x / PT_PER_MM, y: c.y / PT_PER_MM, w: c.width / PT_PER_MM, h: c.height / PT_PER_MM }));
  // Wall: old at 17 mm from the top, new at 19 mm (2 mm lower on the sheet).
  const wall = inMm.filter((c) => c.x < 40 && c.y < 25);
  assert.ok(wall.some((c) => c.type === 'removed' || c.type === 'modified'), JSON.stringify(inMm));
  assert.ok(wall.some((c) => c.type === 'added' || c.type === 'modified'), JSON.stringify(inMm));
  const extra = inMm.find((c) => c.x > 385 && c.x < 393);
  assert.ok(extra && extra.type === 'added', JSON.stringify(inMm));
  assert.ok(Math.abs(extra.w - 2) < 0.5, `2 mm wide: ${extra.w}`);
  assert.equal(inMm.length, wall.length + 1, 'nothing else');
});

test('the alignment is applied to the old side: a shifted plot matches', async () => {
  const a = await segmentsOf(await sheetPdf());
  // Old plot shifted 1 mm right and 0.5 mm down.
  const shifted = new Float32Array(a.segments.length);
  for (let i = 0; i < a.segments.length; i += 2) { shifted[i] = a.segments[i] + mm(1); shifted[i + 1] = a.segments[i + 1] + mm(0.5); }
  assert.ok(diffSegments(shifted, a.segments).clusters.length > 0, 'without alignment it differs');
  const T = alignmentMatrix({ dx: -1, dy: -0.5, rotation: 0, scale: 1 }, a.size, a.size);
  assert.deepEqual(diffSegments(shifted, a.segments, { transform: T }).clusters, []);
});
