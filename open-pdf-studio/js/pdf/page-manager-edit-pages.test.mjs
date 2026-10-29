// Applying the pending edits of the Edit Pages organizer (#764) with
// page-manager.js applyPageEdits: reorder, rotate, delete, blank pages and
// pages of another PDF in one go, as ONE undo step, on real PDF bytes with
// real pdf-lib. The app modules around page-manager.js are replaced
// (page-manager-test-hooks.mjs); rotateAnnotation (renderer.js) is recorded.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';
import {
  createPlan, moveEntriesToGap, rotateEntries, deleteEntries, insertBlank, insertSource, toggleSplit,
} from './page-edit-plan.js';

register('./page-manager-test-hooks.mjs', import.meta.url);
const pm = await import('./page-manager.js');

const SLEUTEL = 'geheugen/edit-pages.pdf';
const BREEDTES = [100, 200, 300, 400]; // page n is (n * 100) wide: its identity

// Four pages; page 1 links to page 3, a form field sits on page 4.
async function bron() {
  const doc = await PDFDocument.create();
  const pages = BREEDTES.map((w) => doc.addPage([w, 500]));
  const ctx = doc.context;
  const link = ctx.register(ctx.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50],
    Dest: [pages[2].ref, PDFName.of('Fit')],
  }));
  pages[0].node.set(PDFName.of('Annots'), ctx.obj([link]));
  doc.getForm().createTextField('naam').addToPage(pages[3], { x: 10, y: 10, width: 80, height: 20 });
  return new Uint8Array(await doc.save());
}

// An added PDF of two pages, 700 and 800 wide.
async function extraPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([700, 500]);
  doc.addPage([800, 500]);
  return new Uint8Array(await doc.save());
}

async function opstelling() {
  const bytes = await bron();
  const cache = new Map([[SLEUTEL, bytes]]);
  const doc = {
    id: 'doc-edit-pages',
    filePath: SLEUTEL,
    fileName: 'edit-pages.pdf',
    pdfDoc: { numPages: 4, destroy() {} },
    currentPage: 2,
    pageRotations: { 1: 90 },
    annotations: [
      { id: 'op1', type: 'box', page: 1 },
      { id: 'op2', type: 'box', page: 2 },
      { id: 'op3', type: 'box', page: 3 },
    ],
    bookmarks: [
      { id: 'bm2', title: 'Twee', page: 2, parentId: null, sortOrder: 0 },
      { id: 'bm4', title: 'Vier', page: 4, parentId: null, sortOrder: 1 },
    ],
  };
  const undo = [];
  const gedraaid = [];
  const geschreven = new Map();
  const meldingen = [];
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
      rotateAnnotation: (ann, delta, w, h) => { gedraaid.push([ann.id, ann.page, delta, w, h]); ann.gedraaid = delta; },
      writeBinaryFile: (pad, b) => { geschreven.set(pad, b); },
      showMessage: (m) => { meldingen.push(m); },
    },
  };
  return { doc, undo, gedraaid, geschreven, meldingen, bytes: () => cache.get(SLEUTEL) };
}

const breedtes = (lib) => lib.getPages().map((p) => Math.round(p.getWidth()));
const hoeken = (lib) => lib.getPages().map((p) => p.getRotation().angle);
const paginaVan = (lib, ref) => lib.getPages().findIndex((p) => p.ref === ref) + 1;

// Plan: page 4 to the front, page 2 deleted, page 3 turned right, a blank
// page between 1 and 3, the two pages of the extra PDF at the end with the
// first of them turned left.
async function samengesteld() {
  let plan = createPlan(4);
  plan = moveEntriesToGap(plan, ['p4'], 0);            // 4 1 2 3
  plan = deleteEntries(plan, ['p2']).plan;              // 4 1 3
  plan = rotateEntries(plan, ['p3'], 90);
  plan = insertBlank(plan, 2).plan;                     // 4 1 _ 3
  const ins = insertSource(plan, 4, 'extra', 2);        // 4 1 _ 3 a b
  plan = rotateEntries(ins.plan, [ins.keys[0]], -90);
  const sources = { extra: { bytes: await extraPdf(), name: 'extra.pdf', pageCount: 2 } };
  return { plan, sources };
}

test('reorder, delete, rotate, blank and inserted pages land in the document in one go', async () => {
  const o = await opstelling();
  const { plan, sources } = await samengesteld();
  assert.equal(await pm.applyPageEdits(plan, { sources }), true);
  const lib = await PDFDocument.load(o.bytes());
  // The blank page takes the size of page 1 in front of it — which shows
  // turned by 90 (app rotation), so the blank is 500 x 100 (shown upright
  // the same way).
  assert.deepEqual(breedtes(lib), [400, 100, 500, 300, 700, 800]);
  assert.equal(Math.round(lib.getPages()[2].getHeight()), 100);
  // Document pages turn through the app rotation, new pages in the PDF.
  assert.deepEqual(hoeken(lib), [0, 0, 0, 0, 270, 0]);
  assert.deepEqual(o.doc.pageRotations, { 2: 90, 4: 90 });

  // The link on old page 1 (now 2) still points at old page 3 (now 4).
  const link = lib.getPages()[1].node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict);
  assert.equal(paginaVan(lib, link.lookup(PDFName.of('Dest'), PDFArray).get(0)), 4);
  // The form field on old page 4 (now 1) is still there.
  const widget = lib.getForm().getTextField('naam').acroField.getWidgets()[0];
  assert.equal(paginaVan(lib, widget.P()), 1);
});

test('annotations, bookmarks and the current page follow; a turned page turns its annotations', async () => {
  const o = await opstelling();
  const { plan, sources } = await samengesteld();
  await pm.applyPageEdits(plan, { sources });
  // op2 was on the deleted page; op3 turned with its page (300 x 500 shown).
  assert.deepEqual(o.doc.annotations.map((a) => [a.id, a.page]), [['op1', 2], ['op3', 4]]);
  assert.deepEqual(o.gedraaid, [['op3', 4, 90, 300, 500]]);
  assert.equal(o.doc.annotations.find((a) => a.id === 'op3').gedraaid, 90);
  // The bookmark on the deleted page 2 moves to the next page that stays (old 3, now 4).
  assert.deepEqual(o.doc.bookmarks.map((b) => [b.id, b.page]), [['bm2', 4], ['bm4', 1]]);
  // Current page 2 was deleted: the same position, clamped.
  assert.equal(o.doc.currentPage, 2);
});

test('the whole edit is one undo step; undo and redo restore it', async () => {
  const o = await opstelling();
  const origineel = o.bytes();
  const { plan, sources } = await samengesteld();
  await pm.applyPageEdits(plan, { sources });
  assert.equal(o.undo.length, 1, 'one undo step for everything');
  const [stap] = o.undo;
  assert.equal(stap[0], origineel);
  assert.deepEqual(stap[2], { 1: 90 }, 'old rotations');
  assert.deepEqual(stap[6], { 2: 90, 4: 90 }, 'new rotations');
  assert.deepEqual(stap[8].bookmarks.old.map((b) => b.page), [2, 4]);

  await pm.restorePageState(stap[0], stap[1], stap[2], stap[3], { bookmarks: stap[8].bookmarks.old });
  assert.deepEqual(breedtes(await PDFDocument.load(o.bytes())), BREEDTES);
  assert.deepEqual(o.doc.annotations.map((a) => [a.id, a.page]), [['op1', 1], ['op2', 2], ['op3', 3]]);
  assert.deepEqual(o.doc.pageRotations, { 1: 90 });

  await pm.restorePageState(stap[4], stap[5], stap[6], stap[7], { bookmarks: stap[8].bookmarks.new });
  assert.deepEqual(breedtes(await PDFDocument.load(o.bytes())), [400, 100, 500, 300, 700, 800]);
  assert.deepEqual(o.doc.bookmarks.map((b) => b.page), [4, 1]);
});

test('nothing to do, an invalid plan or an empty plan: no change and no undo step', async () => {
  const o = await opstelling();
  const voor = o.bytes();
  // Split marks alone do not change the document.
  assert.equal(await pm.applyPageEdits(toggleSplit(createPlan(4), 2)), false);
  const buiten = { entries: [{ key: 'p5', kind: 'page', page: 5, rotation: 0 }], splits: [], seq: 0 };
  assert.equal(await pm.applyPageEdits(buiten), false, 'a page the document does not have');
  const dubbel = { entries: [1, 1, 2].map((p, i) => ({ key: `k${i}`, kind: 'page', page: p, rotation: 0 })), splits: [], seq: 0 };
  assert.equal(await pm.applyPageEdits(dubbel), false, 'a page twice');
  assert.equal(await pm.applyPageEdits({ entries: [], splits: [], seq: 0 }), false, 'never an empty document');
  const zonderBron = insertSource(createPlan(4), 1, 'weg', 2).plan;
  assert.equal(await pm.applyPageEdits(zonderBron), false, 'a source that is not there');
  assert.equal(o.undo.length, 0);
  assert.equal(o.bytes(), voor);
});

test('a preview PDF of the CAD import is refused, the document stays as it was', async () => {
  const o = await opstelling();
  const voor = o.bytes();
  const preview = await PDFDocument.create();
  preview.addPage([100, 100]);
  preview.catalog.set(PDFName.of('OPS_Preview'), preview.context.obj(true));
  const sources = { pv: { bytes: new Uint8Array(await preview.save()), name: 'pv.pdf', pageCount: 1 } };
  const plan = insertSource(createPlan(4), 0, 'pv', 1).plan;
  assert.equal(await pm.applyPageEdits(plan, { sources }), false);
  assert.deepEqual(o.meldingen, ['previewPdfRefused']);
  assert.equal(o.undo.length, 0);
  assert.equal(o.bytes(), voor);
});

test('extract writes the selected entries as they will look, the document stays as it was', async () => {
  const o = await opstelling();
  const voor = o.bytes();
  const { plan, sources } = await samengesteld();
  const keys = [plan.entries[0].key, plan.entries[2].key, plan.entries[4].key]; // old 4, blank, extra p1
  assert.equal(await pm.extractPlannedPages(plan, keys, { sources, savePath: 'uit.pdf' }), true);
  const uit = await PDFDocument.load(o.geschreven.get('uit.pdf'));
  assert.deepEqual(breedtes(uit), [400, 500, 700]);
  assert.deepEqual(hoeken(uit), [0, 0, 270]);
  assert.equal(o.bytes(), voor, 'the document is not changed');
  assert.equal(o.undo.length, 0);
});
