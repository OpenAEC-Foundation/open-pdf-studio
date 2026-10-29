// Reordering pages (#763) with page-manager.js reorderPages: the pages move
// inside the document, so links, named destinations and form fields keep
// their page; the annotations and bookmarks of the model follow their page;
// the whole reorder is one undo step that undo and redo restore. The app
// modules around page-manager.js are replaced (page-manager-test-hooks.mjs);
// page-manager.js, page-tree-reorder.js and pdf-lib are real.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';
import { reorderPageTree } from './page-tree-reorder.js';

register('./page-manager-test-hooks.mjs', import.meta.url);
const pm = await import('./page-manager.js');

const SLEUTEL = 'geheugen/volgorde.pdf';
const BREEDTES = [100, 200, 300, 400]; // page n is (n * 100) wide: its identity

// Four pages; page 1 links to page 3, a named destination points at page 4,
// a form field sits on page 2.
async function bron() {
  const doc = await PDFDocument.create();
  const pages = BREEDTES.map((w) => doc.addPage([w, 500]));
  const ctx = doc.context;
  const link = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50],
    Dest: [pages[2].ref, PDFName.of('Fit')],
  }));
  pages[0].node.set(PDFName.of('Annots'), ctx.obj([link]));
  doc.catalog.set(PDFName.of('Dests'), ctx.obj({ Hoofdstuk: [pages[3].ref, PDFName.of('Fit')] }));
  doc.getForm().createTextField('naam').addToPage(pages[1], { x: 10, y: 10, width: 80, height: 20 });
  return new Uint8Array(await doc.save());
}

async function opstelling() {
  const bytes = await bron();
  const cache = new Map([[SLEUTEL, bytes]]);
  const doc = {
    id: 'doc-volgorde',
    filePath: SLEUTEL,
    pdfDoc: { numPages: 4, destroy() {} },
    currentPage: 1,
    pageRotations: { 3: 90 },
    annotations: [
      { id: 'op1', type: 'circle', page: 1 },
      { id: 'op3', type: 'box', page: 3 },
    ],
    bookmarks: [
      { id: 'bm1', title: 'Begin', page: 1, parentId: null, sortOrder: 0 },
      { id: 'bm3', title: 'Detail', page: 3, parentId: 'bm1', sortOrder: 0 },
    ],
  };
  const undo = [];
  globalThis.window = { __TAURI__: {} };
  globalThis.__pmTest = {
    impl: {
      getActiveDocument: () => doc,
      getCachedPdfBytes: (k) => cache.get(k),
      setCachedPdfBytes: (k, b) => { cache.set(k, b); },
      isTauri: () => false,
      getDocument: ({ data }) => ({
        promise: PDFDocument.load(data).then((d) => ({ numPages: d.getPageCount(), destroy() {} })),
      }),
      recordPageStructure: (...a) => { undo.push(a); },
    },
  };
  return { doc, undo, bytes: () => cache.get(SLEUTEL) };
}

const breedtes = (lib) => lib.getPages().map((p) => p.getWidth());
const paginaVan = (lib, ref) => lib.getPages().findIndex((p) => p.ref === ref) + 1;

test('the pages move in the document; links, named destinations and form fields keep their page', async () => {
  const o = await opstelling();
  const veranderd = await pm.reorderPages([3, 1, 4, 2]);
  assert.equal(veranderd, true);
  const lib = await PDFDocument.load(o.bytes());
  assert.deepEqual(breedtes(lib), [300, 100, 400, 200]);

  // The link on (old) page 1 still points at (old) page 3, now page 1.
  const op1 = lib.getPages()[1];
  const link = op1.node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
  const dest = link.lookup(PDFName.of('Dest'), PDFArray);
  assert.equal(lib.getPages()[paginaVan(lib, dest.get(0)) - 1].getWidth(), 300);
  assert.equal(paginaVan(lib, dest.get(0)), 1);

  // The named destination still points at (old) page 4, now page 3.
  const dests = lib.catalog.lookup(PDFName.of('Dests'), PDFDict);
  const hoofdstuk = dests.lookup(PDFName.of('Hoofdstuk'), PDFArray);
  assert.equal(paginaVan(lib, hoofdstuk.get(0)), 3);

  // The form field is still there, its widget on (old) page 2, now page 4.
  const veld = lib.getForm().getTextField('naam');
  const widget = veld.acroField.getWidgets()[0];
  assert.equal(paginaVan(lib, widget.P()), 4);
  assert.ok(lib.getPages()[3].node.Annots()?.size() >= 1, 'the widget is in the annotations of its page');
});

test('annotations, rotations and bookmarks follow their page; the current page follows too', async () => {
  const o = await opstelling();
  await pm.reorderPages([3, 1, 4, 2]);
  assert.deepEqual(o.doc.annotations.map((a) => [a.id, a.page]), [['op1', 2], ['op3', 1]]);
  assert.deepEqual(o.doc.pageRotations, { 1: 90 });
  assert.deepEqual(o.doc.bookmarks.map((b) => [b.id, b.page, b.parentId]), [['bm1', 2, null], ['bm3', 1, 'bm1']]);
  assert.equal(o.doc.currentPage, 2, 'old page 1 is now page 2');
});

test('one undo step; undo and redo restore pages, annotations and bookmarks', async () => {
  const o = await opstelling();
  const origineel = o.bytes();
  await pm.reorderPages([2, 3, 4, 1]);
  assert.equal(o.undo.length, 1, 'the whole reorder is one undo step');
  const [stap] = o.undo;
  assert.equal(stap[0], origineel, 'undo goes back to the bytes from before');
  assert.deepEqual(stap[8].bookmarks.old.map((b) => b.page), [1, 3]);
  assert.deepEqual(stap[8].bookmarks.new.map((b) => b.page), [4, 2]);

  await pm.restorePageState(stap[0], stap[1], stap[2], stap[3], { bookmarks: stap[8].bookmarks.old });
  assert.deepEqual(breedtes(await PDFDocument.load(o.bytes())), [100, 200, 300, 400]);
  assert.deepEqual(o.doc.annotations.map((a) => [a.id, a.page]), [['op1', 1], ['op3', 3]]);
  assert.deepEqual(o.doc.bookmarks.map((b) => b.page), [1, 3]);
  assert.equal(o.doc.currentPage, 1);

  await pm.restorePageState(stap[4], stap[5], stap[6], stap[7], { bookmarks: stap[8].bookmarks.new });
  assert.deepEqual(breedtes(await PDFDocument.load(o.bytes())), [200, 300, 400, 100]);
  assert.deepEqual(o.doc.annotations.map((a) => [a.id, a.page]), [['op1', 4], ['op3', 2]]);
  assert.deepEqual(o.doc.bookmarks.map((b) => b.page), [4, 2]);
});

test('an unchanged or invalid order does nothing and records no undo step', async () => {
  const o = await opstelling();
  const voor = o.bytes();
  assert.equal(await pm.reorderPages([1, 2, 3, 4]), false);
  assert.equal(await pm.reorderPages([1, 1, 2, 3]), false);
  assert.equal(await pm.reorderPages([2, 1]), false);
  assert.equal(o.undo.length, 0);
  assert.equal(o.bytes(), voor);
});

test('a nested page tree is flattened; what pages inherited from it stays with them', async () => {
  // Root -> two intermediate nodes; the second carries the MediaBox and
  // Rotate its pages inherit.
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const rootRef = doc.catalog.get(PDFName.of('Pages'));
  const root = ctx.lookup(rootRef, PDFDict);
  const leaf = (parentRef, extra = {}) => ctx.register(ctx.obj({ Type: 'Page', Parent: parentRef, Resources: {}, ...extra }));
  const aRef = ctx.nextRef();
  const bRef = ctx.nextRef();
  const a1 = leaf(aRef, { MediaBox: [0, 0, 100, 500] });
  const a2 = leaf(aRef, { MediaBox: [0, 0, 200, 500] });
  const b1 = leaf(bRef);
  const b2 = leaf(bRef);
  ctx.assign(aRef, ctx.obj({ Type: 'Pages', Parent: rootRef, Kids: [a1, a2], Count: 2 }));
  ctx.assign(bRef, ctx.obj({ Type: 'Pages', Parent: rootRef, Kids: [b1, b2], Count: 2, MediaBox: [0, 0, 700, 500], Rotate: 90 }));
  root.set(PDFName.of('Kids'), ctx.obj([aRef, bRef]));
  root.set(PDFName.of('Count'), ctx.obj(4));
  const lib = await PDFDocument.load(await doc.save({ addDefaultPage: false }));
  assert.deepEqual(breedtes(lib), [100, 200, 700, 700]);

  const geordend = reorderPageTree(lib, [3, 1, 4, 2]);
  assert.equal(geordend.length, 4);
  const na = await PDFDocument.load(await lib.save());
  assert.deepEqual(breedtes(na), [700, 100, 700, 200]);
  assert.deepEqual(na.getPages().map((p) => p.getRotation().angle), [90, 0, 90, 0]);
  const kids = na.catalog.Pages().Kids();
  assert.equal(kids.size(), 4, 'flat under the root');
  assert.throws(() => reorderPageTree(na, [1, 2]), /not a page order/);
});
