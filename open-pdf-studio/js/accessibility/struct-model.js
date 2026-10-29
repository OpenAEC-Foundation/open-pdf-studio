// The structure model of a document (#384) without reading a whole untagged
// file into pdf-lib.
//
// readStructTree() needs the file loaded with pdf-lib: on a drawing of 100+ MB
// that is seconds of work and several times the file in memory. Most files
// have no structure tree at all, and the tags panel, the check and read aloud
// only need to learn that. So first a cheap check with the pdf.js document
// the app already has open: getMetadata() reports hasStructTree (the catalog
// has a /StructTreeRoot). A pdf.js without that field is asked for page 1's
// structure tree instead, which is also null when pdf.js cannot parse one, so
// there a quick scan of the bytes for the name backs it up. Only when the
// answer is no is the model built from pdf.js alone (marked, language, page
// count).
//
// No app imports: testable under node.

import { PDFDocument } from 'pdf-lib';
import { readStructTree } from './struct-tree.js';

const NAME = new TextEncoder().encode('StructTreeRoot');

/** Do the raw bytes contain the name /StructTreeRoot (outside compressed object streams)? */
export function bytesMentionStructTreeRoot(bytes) {
  if (!bytes || !bytes.length) return false;
  const first = NAME[0];
  const last = bytes.length - NAME.length;
  for (let i = bytes.indexOf(first); i >= 0 && i <= last; i = bytes.indexOf(first, i + 1)) {
    if (bytes[i - 1] !== 0x2f) continue; // preceded by '/'
    let match = true;
    for (let j = 1; j < NAME.length; j++) {
      if (bytes[i + j] !== NAME[j]) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Has the pdf.js document a structure tree? { tagged: true|false|null, exact }:
 * null when pdf.js cannot tell; exact when it read the catalog itself.
 */
export async function pdfjsHasStructTree(pdfDoc) {
  if (!pdfDoc) return { tagged: null, exact: false };
  try {
    const meta = await pdfDoc.getMetadata?.();
    if (typeof meta?.hasStructTree === 'boolean') return { tagged: meta.hasStructTree, exact: true };
  } catch { /* ask the page */ }
  try {
    const page = await pdfDoc.getPage?.(1);
    if (typeof page?.getStructTree !== 'function') return { tagged: null, exact: false };
    return { tagged: (await page.getStructTree()) != null, exact: false };
  } catch {
    return { tagged: null, exact: false };
  }
}

/** The model of an untagged document, from pdf.js: same shape as readStructTree(). */
async function untaggedModelFromPdfjs(pdfDoc) {
  let marked = false;
  let lang = null;
  try {
    const info = await pdfDoc.getMarkInfo?.();
    marked = (info instanceof Map ? info.get('Marked') : info?.Marked) === true;
  } catch { /* not marked */ }
  try {
    const value = (await pdfDoc.getMetadata?.())?.info?.Language;
    lang = typeof value === 'string' && value ? value : null;
  } catch { /* no language */ }
  return { tagged: false, marked, lang, roleMap: {}, pageCount: pdfDoc.numPages || 0, root: null, elementCount: 0 };
}

/**
 * The structure model of a document (readStructTree's shape).
 * @param {{ bytes: Uint8Array, pdfDoc?: object, loadPdfLib?: (bytes: Uint8Array) => Promise<object> }} input
 */
export async function readStructModel({
  bytes,
  pdfDoc = null,
  loadPdfLib = (b) => PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false }),
}) {
  const { tagged, exact } = await pdfjsHasStructTree(pdfDoc);
  if (tagged === false && (exact || !bytesMentionStructTreeRoot(bytes))) return untaggedModelFromPdfjs(pdfDoc);
  return readStructTree(await loadPdfLib(bytes));
}
