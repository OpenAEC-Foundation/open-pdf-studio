// Structure tree, page text and the accessibility check for an open document
// (#384). Everything here is loaded and computed on demand: the tags panel,
// the check and read aloud ask for it; opening or rendering a document never
// does (#634).
//
// The tree is read from the bytes pdf-lib saves from (originalBytesCache), once
// per version of those bytes, with a pdf-lib document that is dropped right
// after; a document without a structure tree is recognised first with the
// open pdf.js document and never loaded into pdf-lib (struct-model.js). Page
// text with its marked content comes from pdf.js, once per page.

import { getCachedPdfBytes, laadAnnotatiesVoorPaginas } from '../pdf/loader.js';
import { readStructModel } from './struct-model.js';
import { applyEditsToTree } from './struct-edits.js';
import { mcidTextMap, contentOrderText, structureSegments, segmentPages, segmentText, firstSegmentFromPage } from './reading-order.js';
import { buildAccessibilityReport } from './report.js';

const treeByBytes = new WeakMap();
const textByPdfDoc = new WeakMap();

/** The structure tree as read from the file (no edits), or null without bytes. */
export function getStructModel(doc) {
  const bytes = doc?.filePath ? getCachedPdfBytes(doc.filePath) : null;
  if (!bytes || !bytes.length) return Promise.resolve(null);
  let pending = treeByBytes.get(bytes);
  if (!pending) {
    pending = readStructModel({ bytes, pdfDoc: doc.pdfDoc });
    pending.catch(() => treeByBytes.delete(bytes));
    treeByBytes.set(bytes, pending);
  }
  return pending;
}

/** The structure tree with the unsaved edits of the document applied. */
export async function getDisplayTree(doc) {
  const model = await getStructModel(doc);
  if (!model) return null;
  return { ...model, root: applyEditsToTree(model.root, doc.structEdits) };
}

/**
 * Text and marked content of one page (0-based), from pdf.js.
 * @returns {Promise<ReturnType<typeof mcidTextMap> & { contentText: string }>}
 */
export function getPageText(doc, pageIndex) {
  const pdfDoc = doc?.pdfDoc;
  if (!pdfDoc || typeof pdfDoc.getPage !== 'function') {
    return Promise.resolve({ byMcid: new Map(), mcids: new Set(), untaggedItems: 0, taggedItems: 0, artifactItems: 0, contentText: '' });
  }
  let pages = textByPdfDoc.get(pdfDoc);
  if (!pages) { pages = new Map(); textByPdfDoc.set(pdfDoc, pages); }
  let pending = pages.get(pageIndex);
  if (!pending) {
    pending = pdfDoc.getPage(pageIndex + 1)
      .then((page) => page.getTextContent({ includeMarkedContent: true }))
      .then((tc) => ({ ...mcidTextMap(tc.items), contentText: contentOrderText(tc.items) }));
    pending.catch(() => pages.delete(pageIndex));
    pages.set(pageIndex, pending);
  }
  return pending;
}

/**
 * Items for read aloud from page `fromPage` (0-based) to the end, with a
 * function that fetches the text of an item when it is its turn.
 * Tagged: the structure tree order. Untagged: the pages in content order.
 */
export async function readingItems(doc, fromPage = 0) {
  const tree = await getDisplayTree(doc);
  const segments = tree?.tagged ? structureSegments(tree.root) : [];
  if (segments.length) {
    const start = firstSegmentFromPage(segments, fromPage);
    if (start >= 0) {
      return {
        tagged: true,
        items: segments.slice(start),
        resolveText: async (segment) => {
          const maps = new Map();
          for (const p of segmentPages(segment)) maps.set(p, (await getPageText(doc, p)).byMcid);
          return segmentText(segment, (p) => maps.get(p));
        },
      };
    }
  }
  const count = doc?.pdfDoc?.numPages || 0;
  const items = [];
  for (let p = Math.max(0, fromPage); p < count; p++) items.push({ pageIndex: p });
  return {
    tagged: false,
    items,
    resolveText: async (item) => (await getPageText(doc, item.pageIndex)).contentText,
  };
}

/** Run the accessibility check on the whole document. */
export async function runAccessibilityCheck(doc, onProgress = null) {
  const tree = await getDisplayTree(doc);
  const pages = [];
  const count = doc?.pdfDoc?.numPages || 0;
  if (tree?.tagged) {
    for (let p = 0; p < count; p++) {
      const info = await getPageText(doc, p);
      pages.push({ pageIndex: p, mcids: info.mcids, untaggedItems: info.untaggedItems, taggedItems: info.taggedItems });
      onProgress?.(p + 1, count);
    }
  }
  // Annotations load per page; the check needs those of every page.
  try { await laadAnnotatiesVoorPaginas(doc, Array.from({ length: count }, (_, i) => i + 1)); } catch { /* report what is loaded */ }
  return buildAccessibilityReport({ tree, pages, annotations: doc?.annotations || [] });
}
