// Test helper: a small tagged PDF, built with pdf-lib (#384).
//
// Page 1 content stream, in this order:
//   MCID 0  "Second paragraph"   (tagged P, inside a Sect, through an MCR + Span)
//   MCID 1  (empty)              (tagged Figure)
//   MCID 2  "First heading"      (tagged Heading, RoleMap Heading -> H1)
//   untagged "Loose line"
//   Artifact "Page footer"
// Page 2: MCID 0 "Third paragraph" (tagged Para, RoleMap Para -> P).
//
// Structure order: Heading, Sect(P(Span(MCID 0))), Figure, Para(page 2) —
// so the reading order is not the content order.
//
// Not a *.test.mjs: this file contains no tests.

import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';

export const CONTENT_PAGE_1 = [
  '/P <</MCID 0>> BDC BT /F1 12 Tf 72 700 Td (Second paragraph) Tj ET EMC',
  '/Figure <</MCID 1>> BDC 0 0 1 rg 72 400 100 100 re f EMC',
  '/H1 <</MCID 2>> BDC BT /F1 18 Tf 72 760 Td (First heading) Tj ET EMC',
  'BT /F1 12 Tf 72 600 Td (Loose line) Tj ET',
  '/Artifact BMC BT /F1 8 Tf 72 30 Td (Page footer) Tj ET EMC',
].join('\n');

export const CONTENT_PAGE_2 = '/P <</MCID 0>> BDC BT /F1 12 Tf 72 700 Td (Third paragraph) Tj ET EMC';

/**
 * @param {{ figureAlt?: string|null, lang?: string|null, marked?: boolean }} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function taggedPdf({ figureAlt = null, lang = 'en-US', marked = true } = {}) {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([595, 842]);
  const p2 = doc.addPage([595, 842]);
  for (const [page, content, sp] of [[p1, CONTENT_PAGE_1, 0], [p2, CONTENT_PAGE_2, 1]]) {
    page.node.setFontDictionary(PDFName.of('F1'), font.ref);
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(content)));
    page.node.set(PDFName.of('StructParents'), ctx.obj(sp));
  }

  const rootRef = ctx.nextRef();
  const docRef = ctx.nextRef();
  const hRef = ctx.nextRef();
  const sectRef = ctx.nextRef();
  const pRef = ctx.nextRef();
  const spanRef = ctx.nextRef();
  const figRef = ctx.nextRef();
  const p2Ref = ctx.nextRef();

  const el = (s, parent, extra) => ctx.obj({ Type: 'StructElem', S: s, P: parent, ...extra });
  ctx.assign(hRef, el('Heading', docRef, { Pg: p1.ref, K: 2 }));
  ctx.assign(spanRef, el('Span', pRef, { K: ctx.obj({ Type: 'MCR', Pg: p1.ref, MCID: 0 }) }));
  ctx.assign(pRef, el('P', sectRef, { Pg: p1.ref, K: [spanRef] }));
  ctx.assign(sectRef, el('Sect', docRef, { K: [pRef] }));
  const fig = el('Figure', docRef, { Pg: p1.ref, K: 1 });
  if (figureAlt != null) fig.set(PDFName.of('Alt'), PDFString.of(figureAlt));
  ctx.assign(figRef, fig);
  ctx.assign(p2Ref, el('Para', docRef, { Pg: p2.ref, K: [0] }));
  ctx.assign(docRef, el('Document', rootRef, { K: [hRef, sectRef, figRef, p2Ref] }));
  ctx.assign(rootRef, ctx.obj({
    Type: 'StructTreeRoot',
    K: [docRef],
    RoleMap: { Heading: 'H1', Para: 'P' },
    ParentTree: { Nums: [0, [spanRef, figRef, hRef], 1, [p2Ref]] },
    ParentTreeNextKey: 2,
  }));
  doc.catalog.set(PDFName.of('StructTreeRoot'), rootRef);
  if (marked) doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));
  if (lang) doc.catalog.set(PDFName.of('Lang'), PDFString.of(lang));
  return doc.save({ useObjectStreams: false });
}

/** An untagged PDF with one line of text. */
export async function untaggedPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText('Plain text', { x: 72, y: 700, size: 12, font });
  return doc.save();
}

/** pdf.js text content (with marked content) of every page. */
export async function pdfjsPages(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pd = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= pd.numPages; n++) {
    const page = await pd.getPage(n);
    pages.push((await page.getTextContent({ includeMarkedContent: true })).items);
  }
  await pd.loadingTask.destroy();
  return pages;
}
