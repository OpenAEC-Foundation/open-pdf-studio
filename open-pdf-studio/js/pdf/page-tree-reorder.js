// Reorders the pages of a pdf-lib document in place (#763).
//
// The page objects stay the same objects; only the page tree (/Pages /Kids)
// lists them in the new order. Everything that refers to a page by its
// object — link and GoTo destinations, named destinations, the outline, form
// field widgets (/P), the structure tree (/Pg), the annotations themselves —
// keeps pointing at the right page. Copying the pages into a new document
// would instead drop the AcroForm, named destinations and layers, and turn
// every link to another page into a link to an orphan copy of that page.

import { PDFName, PDFNumber, PDFDict } from 'pdf-lib';
import { isPageOrder } from './page-order.js';

// Attributes a page may inherit from its ancestors in the page tree. The
// tree is rebuilt flat under the root, so what a page inherited from an
// intermediate node is written onto the page itself first.
const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

/**
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {number[]} order order[i] = current page number that becomes page i + 1
 * @returns {import('pdf-lib').PDFPage[]} the pages in their new order
 */
export function reorderPageTree(pdfDoc, order) {
  const pages = pdfDoc.getPages();
  if (!isPageOrder(order, pages.length)) {
    throw new Error(`reorderPageTree: not a page order for ${pages.length} pages`);
  }
  const context = pdfDoc.context;
  const rootRef = pdfDoc.catalog.get(PDFName.of('Pages'));
  const root = context.lookup(rootRef, PDFDict);

  // Intermediate /Pages nodes, collected before anything changes.
  const intermediate = [];
  const walk = (node) => {
    const kids = node.lookup(PDFName.of('Kids'));
    if (!kids || typeof kids.size !== 'function') return;
    for (let i = 0; i < kids.size(); i++) {
      const ref = kids.get(i);
      const kid = context.lookup(ref);
      if (kid instanceof PDFDict && kid.get(PDFName.of('Type')) === PDFName.of('Pages')) {
        intermediate.push(ref);
        walk(kid);
      }
    }
  };
  walk(root);

  if (intermediate.length) {
    for (const page of pages) {
      const leaf = page.node;
      for (const key of INHERITABLE) {
        const name = PDFName.of(key);
        if (leaf.get(name) !== undefined) continue;
        let node = leaf.lookupMaybe(PDFName.of('Parent'), PDFDict);
        while (node && node !== root) {
          const value = node.get(name);
          if (value !== undefined) { leaf.set(name, value); break; }
          node = node.lookupMaybe(PDFName.of('Parent'), PDFDict);
        }
      }
    }
  }

  const ordered = order.map((p) => pages[p - 1]);
  const kids = context.obj([]);
  for (const page of ordered) {
    kids.push(page.ref);
    page.node.set(PDFName.of('Parent'), rootRef);
  }
  root.set(PDFName.of('Kids'), kids);
  root.set(PDFName.of('Count'), PDFNumber.of(ordered.length));
  for (const ref of intermediate) context.delete(ref);
  // getPages() is cached; the cache does not see a tree edited by hand.
  pdfDoc.pageCache?.invalidate?.();
  return ordered;
}
