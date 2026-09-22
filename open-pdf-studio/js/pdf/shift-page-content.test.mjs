import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString,
  decodePDFRawStream, degrees, rgb,
} from "pdf-lib";
import { assertShiftable, shiftPageContent, shiftPageAnnotations, shiftPageViewports } from "./shift-page-content.js";
import { leesViewportsVanPagina } from "./pdf-viewports.js";

const name = (key) => PDFName.of(key);

/** A document with `count` pages that each have real drawn content. */
async function docWithPages(count = 1, size = [595, 842]) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) {
    const page = doc.addPage(size);
    page.drawRectangle({ x: 100, y: 100, width: 50, height: 50, color: rgb(1, 0, 0) });
  }
  // Round-trip so the pages look like pages from a file (no pending operators).
  return PDFDocument.load(await doc.save());
}

function streamText(doc, ref) {
  const stream = doc.context.lookup(ref);
  const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  return Buffer.from(bytes).toString("latin1");
}

function contentTexts(doc, page) {
  const contents = page.node.lookup(name("Contents"));
  assert.ok(contents instanceof PDFArray, "Contents is an array after a shift");
  return contents.asArray().map((ref) => streamText(doc, ref));
}

const numbers = (array) => array.asArray().map((n) => n.asNumber());

test("content is wrapped in a translation and the original streams stay in between", async () => {
  const doc = await docWithPages(1);
  const page = doc.getPages()[0];
  const before = page.node.get(name("Contents"));

  assert.equal(shiftPageContent(doc, page, 28.3464567, -14.1732283), true);

  const texts = contentTexts(doc, page);
  assert.equal(texts[0], "q 1 0 0 1 28.3465 -14.1732 cm\n");
  assert.equal(texts[texts.length - 1], "\nQ\n");
  assert.ok(texts.length >= 3);
  // The original stream objects are reused, not copied or re-encoded.
  const refs = page.node.lookup(name("Contents")).asArray();
  const original = doc.context.lookup(before);
  const originalRefs = original instanceof PDFArray ? original.asArray() : [before];
  assert.deepEqual(refs.slice(1, -1), originalRefs);
});

test("a single-stream /Contents (not an array) is wrapped as well", async () => {
  const doc = await docWithPages(1);
  const page = doc.getPages()[0];
  const contents = page.node.lookup(name("Contents"));
  const single = contents instanceof PDFArray ? contents.get(0) : page.node.get(name("Contents"));
  page.node.set(name("Contents"), single);

  assert.equal(shiftPageContent(doc, page, 10, 0), true);
  const refs = page.node.lookup(name("Contents")).asArray();
  assert.equal(refs.length, 3);
  assert.equal(refs[1], single);
});

test("the page object and everything on its dictionary survive the shift", async () => {
  const doc = await docWithPages(2);
  const page = doc.getPages()[1];
  page.setMediaBox(-2578.2, -1191.96, 5156.4, 2383.92); // origin far from 0,0
  page.setCropBox(-2000, -1000, 4000, 2000);
  page.setBleedBox(-2100, -1100, 4200, 2200);
  page.setTrimBox(-1900, -900, 3800, 1800);
  page.setRotation(degrees(90));
  page.node.set(name("UserUnit"), PDFNumber.of(2));
  const link = doc.context.register(doc.context.obj({
    Type: "Annot", Subtype: "Link", Rect: [10, 10, 60, 30], Dest: [doc.getPages()[0].ref, "Fit"],
  }));
  page.node.set(name("Annots"), doc.context.obj([link]));
  const refBefore = page.ref;

  assert.equal(shiftPageContent(doc, page, 28.35, -14.17), true);

  const reloaded = await PDFDocument.load(await doc.save());
  assert.equal(reloaded.getPageCount(), 2);
  const after = reloaded.getPages()[1];
  assert.deepEqual(after.ref, refBefore, "same page object: destinations elsewhere keep pointing at it");
  assert.deepEqual(after.getMediaBox(), { x: -2578.2, y: -1191.96, width: 5156.4, height: 2383.92 });
  assert.deepEqual(after.getCropBox(), { x: -2000, y: -1000, width: 4000, height: 2000 });
  assert.deepEqual(after.getBleedBox(), { x: -2100, y: -1100, width: 4200, height: 2200 });
  assert.deepEqual(after.getTrimBox(), { x: -1900, y: -900, width: 3800, height: 1800 });
  assert.equal(after.getRotation().angle, 90);
  assert.equal(after.node.lookup(name("UserUnit")).asNumber(), 2);
  assert.equal(after.node.lookup(name("Annots")).size(), 1, "the link is still on the page");
});

test("a /Rotate inherited from the page tree stays in effect", async () => {
  const doc = await docWithPages(1);
  const page = doc.getPages()[0];
  page.node.delete(name("Rotate"));
  page.node.Parent().set(name("Rotate"), PDFNumber.of(90));
  assert.equal(page.getRotation().angle, 90);

  shiftPageContent(doc, page, 5, 5);

  const reloaded = await PDFDocument.load(await doc.save());
  assert.equal(reloaded.getPages()[0].getRotation().angle, 90);
  assert.equal(reloaded.getPages()[0].node.get(name("Rotate")), undefined, "still inherited, not copied");
});

test("a destination on another page still resolves to the shifted page", async () => {
  const doc = await docWithPages(3);
  const [toc, , target] = doc.getPages();
  const link = doc.context.register(doc.context.obj({
    Type: "Annot", Subtype: "Link", Rect: [50, 700, 300, 720], Dest: [target.ref, "Fit"],
  }));
  toc.node.set(name("Annots"), doc.context.obj([link]));

  shiftPageContent(doc, target, 0, 20);

  const reloaded = await PDFDocument.load(await doc.save());
  const dest = reloaded.getPages()[0].node.lookup(name("Annots")).lookup(0, PDFDict).lookup(name("Dest"), PDFArray);
  const destRef = dest.get(0);
  assert.ok(destRef instanceof PDFRef);
  const index = reloaded.getPages().findIndex((p) => p.ref === destRef);
  assert.equal(index, 2, "the table-of-contents link still opens page 3");
});

test("a page without content is left alone", async () => {
  const doc = await PDFDocument.create();
  const blank = doc.addPage([595, 842]); // nothing drawn: no /Contents
  assert.equal(blank.node.get(name("Contents")), undefined);
  assert.equal(shiftPageContent(doc, blank, 10, 10), false);
  assert.equal(blank.node.get(name("Contents")), undefined);
});

test("a Contents array shared by two pages is not changed for the other page", async () => {
  const doc = await docWithPages(2);
  const [first, second] = doc.getPages();
  const shared = doc.context.register(doc.context.obj(first.node.lookup(name("Contents")).asArray()));
  first.node.set(name("Contents"), shared);
  second.node.set(name("Contents"), shared);

  shiftPageContent(doc, first, 10, 10);

  assert.equal(second.node.get(name("Contents")), shared);
  assert.equal(doc.context.lookup(shared).size(), 1, "the shared array itself was not extended");
  assert.equal(first.node.lookup(name("Contents")).size(), 3);
});

test("shifting twice nests the translations instead of re-embedding the page", async () => {
  const doc = await docWithPages(1);
  const page = doc.getPages()[0];
  shiftPageContent(doc, page, 28.35, 0);
  shiftPageContent(doc, page, -28.35, 0);
  const texts = contentTexts(doc, page);
  assert.equal(texts[0], "q 1 0 0 1 -28.35 0 cm\n");
  assert.equal(texts[1], "q 1 0 0 1 28.35 0 cm\n");
  assert.deepEqual(texts.slice(-2), ["\nQ\n", "\nQ\n"]);
  // No form XObject with a page-sized clip box: nothing is cut off for good.
  const xobjects = page.node.Resources()?.lookup(name("XObject"));
  assert.ok(!xobjects || xobjects.keys().length === 0);
});

test("offsets are written in plain decimal notation and must be finite", async () => {
  const doc = await docWithPages(1);
  const page = doc.getPages()[0];
  shiftPageContent(doc, page, 1e-7, -1e-9);
  assert.equal(contentTexts(doc, page)[0], "q 1 0 0 1 0 0 cm\n");
  assert.throws(() => shiftPageContent(doc, page, Infinity, 0), RangeError);
  assert.throws(() => shiftPageContent(doc, page, 0, NaN), RangeError);
  assert.throws(() => shiftPageContent(doc, page, 1e308, 0), RangeError);
});

test("annotations stored on the page move with the content", async () => {
  const doc = await docWithPages(1);
  const page = doc.getPages()[0];
  const ctx = doc.context;
  const link = ctx.register(ctx.obj({
    Type: "Annot", Subtype: "Link", Rect: [100, 100, 200, 120],
    QuadPoints: [100, 120, 200, 120, 100, 100, 200, 100],
  }));
  const widget = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Widget", FT: "Sig", Rect: [300, 50, 450, 90] }));
  const ink = ctx.register(ctx.obj({
    Type: "Annot", Subtype: "Ink", Rect: [10, 10, 40, 40], InkList: [[10, 10, 20, 20], [30, 30, 40, 40]],
  }));
  const line = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Line", Rect: [0, 0, 50, 50], L: [0, 0, 50, 50] }));
  page.node.set(name("Annots"), ctx.obj([link, widget, ink, line, link])); // link listed twice

  const moved = shiftPageAnnotations(doc, page, 10, -5);

  assert.equal(moved, 4, "a dictionary referenced twice moves once");
  const dict = (ref) => ctx.lookup(ref, PDFDict);
  assert.deepEqual(numbers(dict(link).lookup(name("Rect"))), [110, 95, 210, 115]);
  assert.deepEqual(numbers(dict(link).lookup(name("QuadPoints"))), [110, 115, 210, 115, 110, 95, 210, 95]);
  assert.deepEqual(numbers(dict(widget).lookup(name("Rect"))), [310, 45, 460, 85]);
  assert.deepEqual(numbers(dict(line).lookup(name("L"))), [10, -5, 60, 45]);
  const strokes = dict(ink).lookup(name("InkList")).asArray().map((s) => numbers(ctx.lookup(s)));
  assert.deepEqual(strokes, [[20, 5, 30, 15], [40, 25, 50, 35]]);
  assert.equal(dict(widget).lookup(name("FT")), name("Sig"), "other entries are untouched");
});

test("a page without /Annots has nothing to move", async () => {
  const doc = await docWithPages(1);
  assert.equal(shiftPageAnnotations(doc, doc.getPages()[0], 10, 10), 0);
});

test("an encrypted document is refused before anything is changed", async () => {
  const plain = await docWithPages(1);
  assert.doesNotThrow(() => assertShiftable(plain));

  const source = await docWithPages(1);
  source.context.trailerInfo.Encrypt = source.context.register(
    source.context.obj({ Filter: "Standard", V: 1, R: 2, P: -4 }),
  );
  const encrypted = await PDFDocument.load(await source.save(), { ignoreEncryption: true });
  assert.throws(() => assertShiftable(encrypted), (err) => err.code === "encrypted");
});

// The measure scales the PDF itself carries (/VP with /BBox, /Measure and the
// import's own /OPS_Clip and /OPS_ModelMatrix) describe regions of the page
// content. They move with that content, or the scale would apply to a strip
// next to the drawing and the way back to the model would be shifted (#400).
test("the viewports of the page (/VP) move with the content", async () => {
  const doc = await docWithPages(1);
  const page = doc.getPages()[0];
  const ctx = doc.context;
  const scale = 100 * 25.4 / 72; // 1:100 in mm per point
  // page → model: model = M·page, at 1:100 with a translation in millimetres
  const matrix = [scale, 0, 0, scale, 1000, 2000];
  page.node.set(name("VP"), ctx.obj([
    {
      Type: "Viewport", BBox: [100, 100, 500, 400], Name: PDFString.of("plattegrond"),
      Measure: { Type: "Measure", Subtype: "RL", R: PDFString.of("1:100"), X: [{ U: PDFString.of("mm"), C: scale, D: 1 }] },
      OPS_ModelMatrix: matrix, OPS_ModelUnits: PDFString.of("mm"),
      OPS_Clip: [100, 100, 500, 100, 100, 400],
    },
    { Type: "Viewport", BBox: [0, 0, 50, 50] }, // no /Measure: still a region, still moves
  ]));

  assert.equal(shiftPageViewports(doc, page, 10, -5), 2);

  const vp = page.node.lookup(name("VP"), PDFArray);
  const eerste = vp.lookup(0, PDFDict);
  assert.deepEqual(numbers(eerste.lookup(name("BBox"))), [110, 95, 510, 395]);
  assert.deepEqual(numbers(eerste.lookup(name("OPS_Clip"))), [110, 95, 510, 95, 110, 395]);
  // The model matrix absorbs the inverse translation: the same page content
  // still maps to the same model coordinates.
  const m = numbers(eerste.lookup(name("OPS_ModelMatrix")));
  const model = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  assert.deepEqual(model(110, 95), [matrix[0] * 100 + matrix[4], matrix[3] * 100 + matrix[5]]);
  assert.equal(eerste.lookup(name("Measure"), PDFDict).lookup(name("R")).decodeText(), "1:100", "the scale itself is unchanged");
  assert.deepEqual(numbers(vp.lookup(1, PDFDict).lookup(name("BBox"))), [10, -5, 60, 45]);

  // What the app reads back lies on the shifted content.
  const gelezen = leesViewportsVanPagina(page);
  assert.equal(gelezen.length, 1);
  assert.deepEqual([gelezen[0].x, gelezen[0].y, gelezen[0].width, gelezen[0].height], [110, 842 - 395, 400, 300]);
});

test("a rotated model matrix is shifted through its own axes, and a page without /VP has nothing to move", async () => {
  const doc = await docWithPages(1);
  const page = doc.getPages()[0];
  assert.equal(shiftPageViewports(doc, page, 10, 10), 0);

  // 90° turned model with scale 2: model = (−2·y + 7, 2·x + 9)
  page.node.set(name("VP"), doc.context.obj([{ BBox: [0, 0, 10, 10], OPS_ModelMatrix: [0, 2, -2, 0, 7, 9] }]));
  shiftPageViewports(doc, page, 3, 4);
  const m = numbers(page.node.lookup(name("VP"), PDFArray).lookup(0, PDFDict).lookup(name("OPS_ModelMatrix")));
  const model = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  // The content point that was (0, 0) is now (3, 4) and must still map to (7, 9).
  assert.deepEqual(model(3, 4), [7, 9]);
  assert.deepEqual(m.slice(0, 4), [0, 2, -2, 0], "rotation and scale are untouched");
});
