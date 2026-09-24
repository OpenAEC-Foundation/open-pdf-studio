// Opening a document that already carries markups. Three separate costs:
//   1. pdf.js page.getAnnotations()          (js/pdf/loader.js:1016, 1131, 1202)
//   2. convertPdfAnnotation() per annotation (js/pdf/loader/annotation-converter.js:35)
//   3. extractAnnotationColors()             (js/pdf/loader/color-extraction.js:122),
//      which inflates every appearance stream to text and regex-scans it
//
// The document is built here with pdf-lib so the annotation count is a knob;
// the verification files themselves carry only a handful of markups.
//
// Run: node scripts/bench-rust/08-load-annotations.mjs

import './dom-shim.mjs';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFString, PDFArray } from 'pdf-lib';
import { report, median } from './lib.mjs';
import { loadAppModules } from './bundle.mjs';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const m = await loadAppModules('load', [
  ['js/pdf/loader/annotation-converter.js', ['convertPdfAnnotation']],
  ['js/pdf/loader/color-extraction.js', ['extractAnnotationColors']],
]);

const tmp = mkdtempSync(join(tmpdir(), 'opds-load-'));

/** A one-page document with n /Square annotations, each with its own /AP stream. */
async function makeDoc(n) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([2384, 3370]); // A0
  const annots = doc.context.obj([]);
  page.node.set(PDFName.of('Annots'), annots);
  for (let i = 0; i < n; i++) {
    const x = 20 + (i % 40) * 55, y = 20 + Math.floor(i / 40) * 55;
    const ap = doc.context.stream(
      `1 0 0 RG 0.9 0.9 0.2 rg 1.5 w\n1 1 48 48 re B\n`,
      { Type: PDFName.of('XObject'), Subtype: PDFName.of('Form'),
        BBox: doc.context.obj([0, 0, 50, 50]), Resources: doc.context.obj({}) },
    );
    const annot = doc.context.obj({
      Type: 'Annot', Subtype: 'Square',
      Rect: doc.context.obj([x, y, x + 50, y + 50]),
      F: 4, C: doc.context.obj([1, 0, 0]), IC: doc.context.obj([0.9, 0.9, 0.2]),
      CA: 1, T: PDFString.of('bench'), Contents: PDFString.of(`remark ${i}`),
      Subj: PDFString.of(`item ${i}`), M: PDFString.of('D:20260101000000Z'),
      BS: doc.context.obj({ W: 1.5, S: PDFName.of('S') }),
      AP: doc.context.obj({ N: doc.context.register(ap) }),
    });
    annots.push(doc.context.register(annot));
  }
  return doc.save();
}

const rows = [];
console.log(`${'annots'.padStart(7)} | ${'pdf.js open+getAnnotations'.padStart(26)} | ${'convertPdfAnnotation'.padStart(21)} | ${'extractAnnotationColors'.padStart(24)}`);
console.log(`${'-'.repeat(7)}-+-${'-'.repeat(26)}-+-${'-'.repeat(21)}-+-${'-'.repeat(24)}`);

for (const n of [100, 500, 2000]) {
  const bytes = await makeDoc(n);
  const path = join(tmp, `bench-${n}.pdf`);
  writeFileSync(path, bytes);
  const data = new Uint8Array(readFileSync(path));

  const G = [], C = [], E = [];
  for (let rep = 0; rep < 3; rep++) {
    const t0 = process.hrtime.bigint();
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(data), isEvalSupported: false, disableFontFace: true }).promise;
    const page = await doc.getPage(1);
    const raw = await page.getAnnotations();
    const t1 = process.hrtime.bigint();

    const viewport = page.getViewport({ scale: 1 });
    for (const a of raw) { try { await m.convertPdfAnnotation(a, 1, viewport, null, null); } catch { /* shape-dependent */ } }
    const t2 = process.hrtime.bigint();

    // extractAnnotationColors works on a pdf-lib document, not a pdf.js one.
    const libDoc = await PDFDocument.load(Uint8Array.from(data));
    const t2b = process.hrtime.bigint();
    const cmap = await m.extractAnnotationColors(1, libDoc);
    const t3 = process.hrtime.bigint();
    if (rep === 0 && cmap.size === 0) console.log('  (colour map came back empty - the numbers below would understate it)');

    if (rep > 0) {
      G.push(Number(t1 - t0) / 1e6); C.push(Number(t2 - t1) / 1e6); E.push(Number(t3 - t2b) / 1e6);
    }
    await doc.destroy();
  }
  console.log(`${String(n).padStart(7)} | ${median(G).toFixed(1).padStart(26)} | ${median(C).toFixed(1).padStart(21)} | ${median(E).toFixed(1).padStart(24)}`);
  rows.push({ name: `open ${n} annots, all three steps`, iters: 1, ms: median(G) + median(C) + median(E), perIterUs: (median(G) + median(C) + median(E)) * 1000 });
}

report(rows);
console.log(`(all times in ms, median of 2 timed runs after one warm-up; work dir ${tmp.replace(tmpdir(), '<temp>')})`);
