import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, degrees, rgb } from "pdf-lib";
import { resizePdfPage } from "./resize-page-content.js";
import { marginsForPage } from "./resize-margins-geometry.js";

const MM = 72 / 25.4;
const name = (key) => PDFName.of(key);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-3, `${msg ?? ""} ${a} != ${b}`);

/** A document with `count` pages (points) that each have real drawn content. */
async function docWithPages(count, size, rotation = 0) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) {
    const page = doc.addPage(size);
    page.drawRectangle({ x: 10, y: 10, width: 50, height: 50, color: rgb(1, 0, 0) });
    if (rotation) page.setRotation(degrees(rotation));
  }
  // Round-trip so the pages look like pages from a file (no pending operators).
  return PDFDocument.load(await doc.save());
}

function streamText(doc, ref) {
  const stream = doc.context.lookup(ref);
  const bytes = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents();
  return Buffer.from(bytes).toString("latin1");
}

/** The texts of the content streams, or null when /Contents was not rewritten. */
function wrapped(doc, page) {
  const contents = page.node.lookup(name("Contents"));
  if (!(contents instanceof PDFArray)) return null;
  const texts = contents.asArray().map((ref) => streamText(doc, ref));
  return texts[0].startsWith("q ") && texts[texts.length - 1] === "\nQ\n" ? texts : null;
}

const box = (b) => [b.x, b.y, b.width, b.height];

test("without margins, keeping the size only moves the box: the content is not touched", async () => {
  const doc = await docWithPages(1, [200, 100]);
  const page = doc.getPages()[0];
  const before = page.node.get(name("Contents"));

  const placed = resizePdfPage(doc, page, { targetW: 300, targetH: 300, scaleContent: false });

  assert.equal(page.node.get(name("Contents")), before);
  assert.deepEqual(box(page.getMediaBox()), [-50, -100, 300, 300]);
  assert.deepEqual(box(page.getCropBox()), [-50, -100, 300, 300]);
  assert.deepEqual(placed, { visual: { s: 1, dx: 50, dy: 100 }, scaled: false });
});

test("without margins, scaling writes the same transform as before and no clip", async () => {
  const doc = await docWithPages(1, [200, 100]);
  const page = doc.getPages()[0];

  const placed = resizePdfPage(doc, page, { targetW: 300, targetH: 300, scaleContent: true, marginsMm: { left: 0, right: 0, top: 0, bottom: 0 } });

  const texts = wrapped(doc, page);
  assert.equal(texts[0], "q 1.5 0 0 1.5 0 75 cm\n");
  assert.deepEqual(box(page.getMediaBox()), [0, 0, 300, 300]);
  assert.deepEqual(placed, { visual: { s: 1.5, dx: 0, dy: 75 }, scaled: true });
});

test("scale to fit with margins: the page is scaled into the area between them", async () => {
  // 200 x 100 pt onto 400 x 300 pt; margins in mm that are 20/80/10/90 pt.
  const doc = await docWithPages(1, [200, 100]);
  const page = doc.getPages()[0];
  const marginsMm = { left: 20 / MM, right: 80 / MM, top: 10 / MM, bottom: 90 / MM };

  const placed = resizePdfPage(doc, page, { targetW: 400, targetH: 300, scaleContent: true, marginsMm });

  const texts = wrapped(doc, page);
  // Factor 1.5 into the 300 x 200 area; then the clip to the old page (in the
  // coordinates of the content, so it scales along).
  assert.equal(texts[0], "q 1.5 0 0 1.5 20 115 cm\n0 0 200 100 re W n\n");
  assert.deepEqual(box(page.getMediaBox()), [0, 0, 400, 300]);
  assert.deepEqual(box(page.getCropBox()), [0, 0, 400, 300]);
  assert.equal(placed.scaled, true);
  near(placed.visual.s, 1.5);
  near(placed.visual.dx, 20);
  near(placed.visual.dy, 35);
});

test("keep size with margins: the content is cropped to the area between them", async () => {
  // 400 x 300 pt kept at size on 300 x 300 pt; margins 50/10/20/30 pt.
  const doc = await docWithPages(1, [400, 300]);
  const page = doc.getPages()[0];
  const marginsMm = { left: 50 / MM, right: 10 / MM, top: 20 / MM, bottom: 30 / MM };

  const placed = resizePdfPage(doc, page, { targetW: 300, targetH: 300, scaleContent: false, marginsMm });

  const texts = wrapped(doc, page);
  // No scale and no shift, only the clip: 240 x 250 around the middle of the old page.
  assert.equal(texts[0], "q 1 0 0 1 0 0 cm\n80 25 240 250 re W n\n");
  const media = page.getMediaBox();
  near(media.x, 30); near(media.y, -5); near(media.width, 300); near(media.height, 300);
  assert.equal(placed.scaled, false);
  near(placed.visual.dx, 50 + (240 - 400) / 2);
  near(placed.visual.dy, 20 + (250 - 300) / 2);
});

test("odd and even pages get their own margins", async () => {
  const doc = await docWithPages(4, [200, 200]);
  const margins = {
    odd: { left: 40 / MM, right: 0, top: 0, bottom: 0 },
    even: { left: 0, right: 40 / MM, top: 0, bottom: 0 },
  };
  const placed = doc.getPages().map((page, index) => resizePdfPage(doc, page, {
    targetW: 240, targetH: 200, scaleContent: true, marginsMm: marginsForPage(index + 1, margins),
  }));
  // Pages 1 and 3 keep the left 40 pt free, pages 2 and 4 the right 40 pt.
  for (const index of [0, 2]) near(placed[index].visual.dx, 40, `page ${index + 1}`);
  for (const index of [1, 3]) near(placed[index].visual.dx, 0, `page ${index + 1}`);
  for (const p of placed) near(p.visual.s, 1);
  assert.equal(wrapped(doc, doc.getPages()[0])[0], "q 1 0 0 1 40 0 cm\n0 0 200 200 re W n\n");
  assert.equal(wrapped(doc, doc.getPages()[1])[0], "q 1 0 0 1 0 0 cm\n0 0 200 200 re W n\n");
});

test("a page with /Rotate 90 takes the margins as displayed", async () => {
  // Stored 100 x 200, shown 200 x 100. New size as shown 300 x 200, left margin 60 pt.
  const doc = await docWithPages(1, [100, 200], 90);
  const page = doc.getPages()[0];

  const placed = resizePdfPage(doc, page, {
    targetW: 300, targetH: 200, scaleContent: true, marginsMm: { left: 60 / MM, right: 0, top: 0, bottom: 0 },
  });

  // Stored box with the dimensions swapped back; the displayed left is the stored bottom.
  const media = page.getMediaBox();
  near(media.width, 200); near(media.height, 300);
  assert.equal(page.getRotation().angle, 90);
  assert.equal(wrapped(doc, page)[0], "q 1.2 0 0 1.2 40 60 cm\n0 0 100 200 re W n\n");
  near(placed.visual.s, 1.2);
  near(placed.visual.dx, 60);
  near(placed.visual.dy, 40);
});

test("the in-app rotation counts as well", async () => {
  // Stored upright, turned 90 degrees in the app: same result as /Rotate 90.
  const doc = await docWithPages(1, [100, 200]);
  const page = doc.getPages()[0];
  const placed = resizePdfPage(doc, page, {
    targetW: 300, targetH: 200, appRotation: 90, scaleContent: true, marginsMm: { left: 60 / MM, right: 0, top: 0, bottom: 0 },
  });
  assert.equal(wrapped(doc, page)[0], "q 1.2 0 0 1.2 40 60 cm\n0 0 100 200 re W n\n");
  near(placed.visual.dx, 60);
});

test("a page without content: scaling leaves it alone, keeping the size still resizes it", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 100]).node.delete(name("Contents"));
  doc.addPage([200, 100]).node.delete(name("Contents"));
  const [first, second] = doc.getPages();
  const marginsMm = { left: 10, right: 10, top: 10, bottom: 10 };

  assert.equal(resizePdfPage(doc, first, { targetW: 300, targetH: 300, scaleContent: true, marginsMm }), null);
  assert.deepEqual(box(first.getMediaBox()), [0, 0, 200, 100]);

  const placed = resizePdfPage(doc, second, { targetW: 300, targetH: 300, scaleContent: false, marginsMm });
  assert.equal(placed.scaled, false);
  assert.equal(second.node.get(name("Contents")), undefined);
  near(second.getMediaBox().width, 300);
});
