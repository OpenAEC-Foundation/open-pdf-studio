// Plain PDF links for extensions: read the links a page already has, and add
// standard /Link annotations (no /OPS_Subtype), the kind Revit and other
// exporters write. They are not app annotations: they show and work like any
// link in the file (pdf/link-layer.js: invisible, highlighted on hover, "Go to
// page"), and cannot be selected, moved or deleted in the app. Adding them is
// a page-structure change (new bytes, reload) with one undo step, like
// inserting pages.

import { PDFDocument, PDFName, PDFArray, PDFNumber, PDFNull } from 'pdf-lib';

export const MAX_PDF_LINKS = 5000;

const getal = (v) => typeof v === 'number' && Number.isFinite(v);

/** Check the request; throws a TypeError with what is wrong. */
export function controleerLinks(links, pageCount) {
  if (!Array.isArray(links) || links.length === 0) throw new TypeError('links must be a non-empty array');
  if (links.length > MAX_PDF_LINKS) throw new TypeError(`at most ${MAX_PDF_LINKS} links per call`);
  const paginaGoed = (p) => Number.isInteger(p) && p >= 1 && p <= pageCount;
  for (const [i, l] of links.entries()) {
    const r = l?.rect;
    if (!paginaGoed(l?.page)) throw new TypeError(`links[${i}].page is not a page of the document`);
    if (!r || ![r.x, r.y, r.width, r.height].every(getal) || r.width <= 0 || r.height <= 0) throw new TypeError(`links[${i}].rect needs x, y, width and height`);
    const t = l.target;
    if (!t || !paginaGoed(t.page)) throw new TypeError(`links[${i}].target.page is not a page of the document`);
    if ((t.x !== undefined || t.y !== undefined) && !(getal(t.x) && getal(t.y))) throw new TypeError(`links[${i}].target needs both x and y, or neither`);
  }
}

/**
 * Add the /Link annotations to a pdf-lib document. `naarPdf(page, x, y)` turns
 * a point in annotation space (as the extension sees the page) into PDF user
 * space. Returns the number added.
 */
export function schrijfLinks(pdfLibDoc, links, naarPdf) {
  const ctx = pdfLibDoc.context;
  const paginas = pdfLibDoc.getPages();
  for (const l of links) {
    const pagina = paginas[l.page - 1];
    const a = naarPdf(l.page, l.rect.x, l.rect.y);
    const b = naarPdf(l.page, l.rect.x + l.rect.width, l.rect.y + l.rect.height);
    const rect = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
    const doel = paginas[l.target.page - 1].ref;
    let dest;
    if (getal(l.target.x) && getal(l.target.y)) {
      const p = naarPdf(l.target.page, l.target.x, l.target.y);
      dest = ctx.obj([doel, PDFName.of('XYZ'), PDFNumber.of(p.x), PDFNumber.of(p.y), PDFNull]);
    } else {
      dest = ctx.obj([doel, PDFName.of('Fit')]);
    }
    const annot = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], F: 4, Dest: dest,
    }));
    let annots = pagina.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) {
      annots = ctx.obj([]);
      pagina.node.set(PDFName.of('Annots'), annots);
    }
    annots.push(annot);
  }
  return links.length;
}

/** Annotation-space rectangle of a pdf.js annotation rect. */
function vakVan(viewport, rect) {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

/**
 * The links on a page, as the file has them: [{ x, y, width, height, kind:
 * 'page'|'uri'|'other', app }] in annotation space. `app` is true for a link
 * the app made and edits itself (#953); those are also in getAnnotations().
 */
export async function leesPaginaLinks(doc, pageNum, rotation = 0) {
  const page = await doc.pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1, rotation: ((page.rotate + rotation) % 360 + 360) % 360 });
  const lijst = await page.getAnnotations();
  const appIds = new Set((doc.annotations || []).filter((a) => a.type === 'link' && a.pdfLinkId).map((a) => String(a.pdfLinkId)));
  return lijst.filter((a) => a.subtype === 'Link' && Array.isArray(a.rect)).map((a) => ({
    ...vakVan(viewport, a.rect),
    kind: a.dest ? 'page' : a.url || a.unsafeUrl ? 'uri' : 'other',
    app: appIds.has(String(a.id)),
  }));
}

/**
 * Add plain links to the active document. `links`: [{ page, rect: { x, y,
 * width, height }, target: { page, x?, y? } }], all in annotation space; a
 * target with x and y opens at that point (/XYZ, zoom kept), without at the
 * whole page (/Fit). One undo step.
 * @returns {Promise<{ added: number }>}
 */
export async function voegPdfLinksToe(links, { doc, getCachedPdfBytes, getCacheKey, reloadFromBytes, recordPageStructure, rotatieVan }) {
  if (!doc?.pdfDoc) throw new Error('No document is open');
  controleerLinks(links, doc.pdfDoc.numPages);
  const currentBytes = getCachedPdfBytes(getCacheKey());
  if (!currentBytes) throw new Error('The document bytes are not available');
  const oldAnnotations = doc.annotations.map((a) => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;
  // The same space the extension read the page in (getPageInfo, readPageContent).
  const viewports = new Map();
  for (const p of new Set(links.flatMap((l) => [l.page, l.target.page]))) {
    const page = await doc.pdfDoc.getPage(p);
    viewports.set(p, page.getViewport({ scale: 1, rotation: ((page.rotate + (rotatieVan(p) || 0)) % 360 + 360) % 360 }));
  }
  const naarPdf = (p, x, y) => { const [px, py] = viewports.get(p).convertToPdfPoint(x, y); return { x: px, y: py }; };
  const pdfLibDoc = await PDFDocument.load(currentBytes, { ignoreEncryption: true, updateMetadata: false });
  const added = schrijfLinks(pdfLibDoc, links, naarPdf);
  const newBytes = new Uint8Array(await pdfLibDoc.save());
  const pageMapping = {};
  for (let p = 1; p <= doc.pdfDoc.numPages; p++) pageMapping[p] = p;
  const newAnnotations = doc.annotations.map((a) => ({ ...a }));
  const inModel = await reloadFromBytes(newBytes, newAnnotations, { ...doc.pageRotations }, oldPage, { pageMapping });
  recordPageStructure(currentBytes, oldAnnotations, oldRotations, oldPage, newBytes, inModel || newAnnotations, { ...doc.pageRotations }, oldPage);
  return { added };
}
