// ============================================================================
// Embedded image-XObject detection + removal (issue #184).
//
// Browser-side orchestration around the pure parser in
// embedded-image-parser.js. Detection maps each page-level image draw to an
// app-space bounding box (via the PDF.js viewport transform) for highlighting;
// removal deletes the chosen image's `/Name Do` operator from the page content
// stream with pdf-lib and re-saves, reusing the same undo-able byte-swap path
// (reloadFromBytes + recordPageStructure) that page insert/delete/reorder use.
// ============================================================================

import { paginaViewport } from '../pdf/pagina-viewport.js';
import { PDFDocument, PDFName } from 'pdf-lib';
import { getActiveDocument, getPageRotation } from '../core/state.js';
import { getCachedPdfBytes } from '../pdf/loader.js';
import { getCacheKey, reloadFromBytes } from '../pdf/page-manager.js';
import { recordPageStructure } from '../core/undo-manager.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import {
  parsePageImages, blankImageRange, bboxFromCtm,
} from './embedded-image-parser.js';
import { verplaatsAfbeelding, vervangAfbeelding, isRechtOpScherm } from './embedded-image-edit.js';

// pageNum → [{ index, bbox:{x,y,width,height} }] in app-space (scale=1, y-down).
const _cache = new Map();
// pageNum → viewport transform (PDF-ruimte → app-ruimte) waarmee de kaders berekend zijn.
const _vt = new Map();

export function clearEmbeddedImageCache() { _cache.clear(); _vt.clear(); }

export function getCachedEmbeddedImages(pageNum) {
  return _cache.get(pageNum) || null;
}

function currentBytes() {
  const key = getCacheKey();
  return key ? getCachedPdfBytes(key) : null;
}

// Detect embedded images on a page and cache their app-space bounding boxes.
// Returns the array (possibly empty). Safe to call repeatedly.
export async function detectEmbeddedImages(pageNum) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) { _cache.set(pageNum, []); return []; }

  const bytes = currentBytes();
  if (!bytes) { _cache.set(pageNum, []); return []; }

  let images, text;
  try {
    const pdfLibDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    ({ images, text } = parsePageImages(pdfLibDoc, pageNum));
  } catch (e) {
    console.warn('[embedded-image] parse failed:', e);
    _cache.set(pageNum, []);
    return [];
  }

  if (!images || images.length === 0) { _cache.set(pageNum, []); return []; }

  // Map each image's CTM through the PDF.js viewport transform (scale 1, with
  // the app's extra per-page rotation) → app-space bbox. Mirrors the coordinate
  // pipeline in js/tools/pdf-snap-extractor.js.
  let vt = null;
  try {
    const page = await doc.pdfDoc.getPage(pageNum);
    const extraRotation = getPageRotation(pageNum);
    const vpOpts = { scale: 1 };
    if (extraRotation) vpOpts.rotation = (page.rotate + extraRotation) % 360;
    vt = paginaViewport(page, vpOpts).transform;
  } catch (e) {
    console.warn('[embedded-image] viewport failed:', e);
  }

  const out = images.map((im, idx) => ({
    index: idx,
    bbox: bboxFromCtm(im.ctm, vt),
    // Alleen een rechte afbeelding laat zich zonder vervorming schalen.
    schaalbaar: isRechtOpScherm(im.ctm, vt),
  }));
  _cache.set(pageNum, out);
  if (vt) _vt.set(pageNum, vt);
  return out;
}

// Point-in-bbox hit test; returns the topmost (last-drawn) matching index or -1.
export function hitTestEmbeddedImage(pageNum, x, y) {
  const list = _cache.get(pageNum);
  if (!list || list.length === 0) return -1;
  let hit = -1;
  for (let i = 0; i < list.length; i++) {
    const b = list[i].bbox;
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) hit = i;
  }
  return hit;
}

// Schrijf de aangepaste pdf-lib-inhoud terug in het document: herladen,
// ongedaan te maken (pagina-structuur) en de detectiecache leegmaken.
async function legInhoudVast(doc, bytes, pdfLibDoc) {
  const newBytes = new Uint8Array(await pdfLibDoc.save());

  // Snapshot for undo. Annotations/rotations are unchanged by a content edit.
  const oldBytes = bytes.slice();
  const oldAnnotations = doc.annotations.map(a => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

  await reloadFromBytes(newBytes, doc.annotations.map(a => ({ ...a })), { ...doc.pageRotations }, doc.currentPage);

  const newAnnotations = doc.annotations.map(a => ({ ...a }));
  const newRotations = { ...doc.pageRotations };
  recordPageStructure(
    oldBytes, oldAnnotations, oldRotations, oldPage,
    newBytes, newAnnotations, newRotations, doc.currentPage,
  );

  clearEmbeddedImageCache();
}

// Remove the embedded image at `index` on `pageNum` by neutralising its
// `/Name Do` operator in the page content stream. Undo-able (page-structure
// byte swap) and re-rendered. Returns true on success.
export async function removeEmbeddedImage(pageNum, index) {
  const doc = getActiveDocument();
  if (!doc) return false;

  const bytes = currentBytes();
  if (!bytes) return false;

  showLoading('Removing image...');
  try {
    const pdfLibDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const context = pdfLibDoc.context;
    const { text, images } = parsePageImages(pdfLibDoc, pageNum);
    if (index < 0 || index >= images.length) {
      console.warn('[embedded-image] target index out of range', index, images.length);
      return false;
    }

    const newText = blankImageRange(text, images[index]);
    const newStream = context.flateStream(newText);
    const newRef = context.register(newStream);
    pdfLibDoc.getPage(pageNum - 1).node.set(PDFName.of('Contents'), newRef);

    await legInhoudVast(doc, bytes, pdfLibDoc);
    return true;
  } catch (e) {
    console.error('[embedded-image] removal failed:', e);
    return false;
  } finally {
    hideLoading();
  }
}

// Verplaats of schaal de afbeelding naar `nieuwKader` (app-ruimte). Ongedaan te maken.
export async function moveEmbeddedImage(pageNum, index, nieuwKader) {
  const doc = getActiveDocument();
  const bytes = currentBytes();
  const vt = _vt.get(pageNum);
  if (!doc || !bytes || !vt) return false;
  showLoading('Moving image...');
  try {
    const pdfLibDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    if (!verplaatsAfbeelding(pdfLibDoc, pageNum, index, vt, nieuwKader)) return false;
    await legInhoudVast(doc, bytes, pdfLibDoc);
    return true;
  } catch (e) {
    console.error('[embedded-image] move failed:', e);
    return false;
  } finally {
    hideLoading();
  }
}

// Vervang de afbeelding door `imageBytes` (PNG of JPEG), passend in het oude kader.
export async function replaceEmbeddedImage(pageNum, index, imageBytes, soort) {
  const doc = getActiveDocument();
  const bytes = currentBytes();
  const vt = _vt.get(pageNum);
  if (!doc || !bytes || !vt) return false;
  showLoading('Replacing image...');
  try {
    const pdfLibDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    if (!(await vervangAfbeelding(pdfLibDoc, pageNum, index, vt, imageBytes, soort))) return false;
    await legInhoudVast(doc, bytes, pdfLibDoc);
    return true;
  } catch (e) {
    console.error('[embedded-image] replace failed:', e);
    return false;
  } finally {
    hideLoading();
  }
}
