import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import {
  herschikViewports, leesPdfViewports, viewportsVanPaginas,
  beginViewportLezing, rondViewportLezingAf, viewportLezingLoopt,
} from "./pdf-viewports.js";

// Na een paginawijziging moeten de meetschalen uit de PDF (/VP) bij de goede
// pagina blijven, zonder het hele document opnieuw te lezen (#400). De
// verwachting komt telkens uit het volledig opnieuw lezen van het resultaat.

function metViewport(doc, page, ratio, c) {
  page.node.set(PDFName.of("VP"), doc.context.obj([{
    Type: "Viewport", BBox: [0, 0, 200, 200], Name: PDFString.of(ratio),
    Measure: { Type: "Measure", Subtype: "RL", R: PDFString.of(ratio),
      X: [{ U: PDFString.of("mm"), C: c, D: 1 }] },
  }]));
}

async function docMet(ratios) {
  const doc = await PDFDocument.create();
  for (const ratio of ratios) {
    const page = doc.addPage([200, 200]);
    if (ratio) metViewport(doc, page, ratio, Number(ratio.split(":")[1]) * 25.4 / 72);
  }
  return doc;
}

const ratios = (vp) => Object.fromEntries(Object.entries(vp || {}).map(([p, l]) => [p, l.map((v) => v.ratio)]));

test("inserting pages: old viewports move along, the inserted pages bring their own", async () => {
  const dest = await docMet(["1:50", null, "1:200"]);
  const src = await docMet(["1:100"]);
  const voor = leesPdfViewports(dest);

  // Zelfde stappen als insertPagesFromFile: na pagina 1 invoegen.
  const insertIdx = 1;
  const copied = await dest.copyPages(src, [0]);
  copied.forEach((p, i) => dest.insertPage(insertIdx + i, p));
  const pageMapping = { 1: 1, 2: 3, 3: 4 };
  const nieuw = viewportsVanPaginas(copied, insertIdx + 1);
  const snel = herschikViewports(voor, pageMapping, nieuw);

  const volledig = leesPdfViewports(await PDFDocument.load(await dest.save()));
  assert.deepEqual(ratios(snel), { 1: ["1:50"], 2: ["1:100"], 4: ["1:200"] });
  assert.deepEqual(snel, volledig, "gelijk aan opnieuw lezen");
});

test("deleting and reordering pages", async () => {
  const doc = await docMet(["1:10", "1:20", "1:30"]);
  const voor = leesPdfViewports(doc);
  doc.removePage(1);
  const na = herschikViewports(voor, { 1: 1, 2: null, 3: 2 });
  assert.deepEqual(na, leesPdfViewports(await PDFDocument.load(await doc.save())));
  assert.deepEqual(ratios(herschikViewports(voor, { 1: 3, 2: 1, 3: 2 })), { 1: ["1:20"], 2: ["1:30"], 3: ["1:10"] });
});

test("nothing left gives undefined, never an empty object", () => {
  assert.equal(herschikViewports(undefined, { 1: 1 }), undefined);
  assert.equal(herschikViewports({ 1: [{ ratio: "1:5" }] }, { 1: null }), undefined);
});

test("only the last background read may set its result", () => {
  const doc = { pdfViewports: { 1: [{ ratio: "tussenwaarde" }] } };
  assert.equal(viewportLezingLoopt(doc), false);
  const eerste = beginViewportLezing(doc);
  assert.equal(viewportLezingLoopt(doc), true);
  const tweede = beginViewportLezing(doc);

  // De eerste lezing is ingehaald: haar uitkomst komt niet meer binnen.
  assert.equal(rondViewportLezingAf(doc, eerste, { 1: [{ ratio: "oud" }] }), false);
  assert.deepEqual(doc.pdfViewports, { 1: [{ ratio: "tussenwaarde" }] });
  assert.equal(viewportLezingLoopt(doc), true, "de tweede loopt nog");

  assert.equal(rondViewportLezingAf(doc, tweede, { 2: [{ ratio: "nieuw" }] }), true);
  assert.deepEqual(doc.pdfViewports, { 2: [{ ratio: "nieuw" }] });
  assert.equal(viewportLezingLoopt(doc), false);

  // Niets gevonden wordt undefined; een mislukte lezing laat staan wat er stond.
  rondViewportLezingAf(doc, beginViewportLezing(doc), {});
  assert.equal(doc.pdfViewports, undefined);
  doc.pdfViewports = { 3: [] };
  assert.equal(rondViewportLezingAf(doc, beginViewportLezing(doc), null), true);
  assert.deepEqual(doc.pdfViewports, { 3: [] });
  assert.equal(viewportLezingLoopt(doc), false);
});
