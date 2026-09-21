import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { leesPdfViewports } from "./pdf-viewports.js";

// Gedragstests van de structurele bewerkingen in page-manager.js (#400): na
// elke bewerking horen de meetschalen uit de PDF (/VP + /Measure) per pagina
// gelijk te zijn aan wat volledig opnieuw lezen van de nieuwe bytes oplevert.
// De app-modules eromheen zijn vervangen (zie page-manager-test-hooks.mjs);
// page-manager.js, pdf-viewports.js en pdf-lib zijn echt.
register("./page-manager-test-hooks.mjs", import.meta.url);
const pm = await import("./page-manager.js");

const SLEUTEL = "geheugen/document.pdf";

/** Pagina met een eigen viewport; de rechthoek hangt van de schaal af. */
function metViewport(doc, page, ratio) {
  const n = Number(ratio.split(":")[1]);
  page.node.set(PDFName.of("VP"), doc.context.obj([{
    Type: "Viewport", BBox: [10, 20, 100 + n / 10, 150], Name: PDFString.of(ratio),
    Measure: { Type: "Measure", Subtype: "RL", R: PDFString.of(ratio),
      X: [{ U: PDFString.of("mm"), C: n * 25.4 / 72, D: 1 }] },
  }]));
}

async function docMet(ratios, { vulling = 0 } = {}) {
  const doc = await PDFDocument.create();
  for (const ratio of ratios) {
    const page = doc.addPage([200, 200]);
    if (ratio) metViewport(doc, page, ratio);
  }
  // Losse objecten: boven de honderd objecten leest pdf-lib in stappen, zodat
  // een achtergrondlezing aantoonbaar nog loopt als de volgende bewerking komt.
  for (let i = 0; i < vulling; i++) doc.context.register(doc.context.obj({ Vulling: i }));
  return doc;
}

const bytesVan = async (doc) => new Uint8Array(await doc.save());
const ofNiets = (v) => (v && Object.keys(v).length ? v : undefined);
const gelezen = async (bytes) => ofNiets(leesPdfViewports(await PDFDocument.load(bytes)));
const ratios = (vp) => Object.fromEntries(Object.entries(vp || {}).map(([p, l]) => [p, l.map((v) => v.ratio)]));

/**
 * Zet een actief document klaar zoals de app het heeft: bytes in de cache,
 * viewports gelezen, en de omliggende modules als doorgeefluik.
 */
async function opstelling(bytes, { bestanden = {}, gekozen = null, currentPage = 1 } = {}) {
  const lib = await PDFDocument.load(bytes);
  const cache = new Map([[SLEUTEL, bytes]]);
  const doc = {
    id: "doc-1",
    filePath: SLEUTEL,
    pdfDoc: { numPages: lib.getPageCount(), destroy() {} },
    annotations: [],
    pageRotations: {},
    currentPage,
    pdfViewports: ofNiets(leesPdfViewports(lib)),
  };
  const meldingen = [];
  const undo = [];
  const tijdensRender = [];
  globalThis.window = { __TAURI__: { dialog: { open: async () => gekozen } } };
  globalThis.__pmTest = {
    impl: {
      getActiveDocument: () => doc,
      getCachedPdfBytes: (k) => cache.get(k),
      setCachedPdfBytes: (k, b) => { cache.set(k, b); },
      isTauri: () => true,
      readBinaryFile: async (pad) => {
        if (!bestanden[pad]) throw new Error(`onbekend bestand ${pad}`);
        return bestanden[pad];
      },
      getDocument: ({ data }) => ({
        promise: PDFDocument.load(data).then((d) => ({ numPages: d.getPageCount(), destroy() {} })),
      }),
      // De weergave wordt opgebouwd terwijl de viewports al gezet zijn: wat
      // hier geldt, is wat de maatvoering op dat moment zou gebruiken.
      setViewMode: async () => { tijdensRender.push(doc.pdfViewports); },
      showMessage: (m) => { meldingen.push(m); },
      recordPageStructure: (...a) => { undo.push(a); },
    },
  };
  return { doc, cache, meldingen, undo, tijdensRender, impl: globalThis.__pmTest.impl, bytesNu: () => cache.get(SLEUTEL) };
}

/** De viewports van het document zijn gelijk aan opnieuw lezen van de bytes. */
async function controleer(o, verwachtAantalPaginas) {
  assert.equal(o.undo.length, 1, "de bewerking is uitgevoerd en vastgelegd voor ongedaan maken");
  const nieuw = await PDFDocument.load(o.bytesNu());
  assert.equal(nieuw.getPageCount(), verwachtAantalPaginas);
  assert.deepEqual(ofNiets(o.doc.pdfViewports), ofNiets(leesPdfViewports(nieuw)), "gelijk aan opnieuw lezen");
  assert.deepEqual(o.meldingen, []);
}

const DOEL = ["1:50", null, "1:200", "1:500"];
const BRON = ["1:100", "1:20"];

test("reordering pages keeps every measure scale with its page", async () => {
  const o = await opstelling(await bytesVan(await docMet(DOEL)));
  await pm.reorderPages([3, 1, 4, 2]);
  await controleer(o, 4);
  assert.deepEqual(ratios(o.doc.pdfViewports), { 1: ["1:200"], 2: ["1:50"], 3: ["1:500"] });
});

for (const pagina of [1, 2, 4]) {
  test(`replacing page ${pagina}: the replacement pages bring their scales to that position`, async () => {
    const bron = await bytesVan(await docMet(BRON));
    const o = await opstelling(await bytesVan(await docMet(DOEL)), { bestanden: { "bron.pdf": bron }, gekozen: "bron.pdf" });
    await pm.replacePages(pagina);
    await controleer(o, 5);
    assert.deepEqual(o.doc.pdfViewports[pagina].map((v) => v.ratio), ["1:100"]);
    assert.deepEqual(o.doc.pdfViewports[pagina + 1].map((v) => v.ratio), ["1:20"]);
  });
}

test("deleting pages", async () => {
  const o = await opstelling(await bytesVan(await docMet(DOEL)));
  await pm.deletePages([1, 3]);
  await controleer(o, 2);
  assert.deepEqual(ratios(o.doc.pdfViewports), { 2: ["1:500"] });
});

for (const [refPage, position, eerste] of [[1, "before", 1], [2, "after", 3], [4, "after", 5]]) {
  test(`inserting pages from a file ${position} page ${refPage}`, async () => {
    const bron = await bytesVan(await docMet(BRON));
    const o = await opstelling(await bytesVan(await docMet(DOEL)), { bestanden: { "bron.pdf": bron } });
    assert.equal(await pm.insertPagesFromFile(refPage, position, "bron.pdf"), true);
    await controleer(o, 6);
    assert.deepEqual(o.doc.pdfViewports[eerste].map((v) => v.ratio), ["1:100"]);
    assert.deepEqual(o.doc.pdfViewports[eerste + 1].map((v) => v.ratio), ["1:20"]);
  });
}

test("pasting copied pages", async () => {
  const o = await opstelling(await bytesVan(await docMet(DOEL)));
  await pm.copyPages([1, 3]);
  await pm.pastePage(2);
  await controleer(o, 6);
  assert.deepEqual(ratios(o.doc.pdfViewports), { 1: ["1:50"], 3: ["1:50"], 4: ["1:200"], 5: ["1:200"], 6: ["1:500"] });
});

for (const [position, currentPage] of [["start", 1], ["after", 2], ["end", 1]]) {
  test(`merging two files at ${position}`, async () => {
    const bestanden = { "a.pdf": await bytesVan(await docMet(BRON)), "b.pdf": await bytesVan(await docMet([null, "1:5"])) };
    const o = await opstelling(await bytesVan(await docMet(DOEL)), { bestanden, currentPage });
    await pm.mergeFiles(["a.pdf", "b.pdf"], position);
    await controleer(o, 8);
  });
}

for (const [position, refPage] of [["start", 1], ["before", 3], ["after", 3], ["end", 1]]) {
  test(`inserting blank pages at ${position}`, async () => {
    const o = await opstelling(await bytesVan(await docMet(DOEL)));
    await pm.insertBlankPages(position, refPage, 2, 100, 100);
    await controleer(o, 6);
  });
}

// ── Achtergrondlezing en ongedaan maken ─────────────────────────────────────

async function wachtTot(voorwaarde, ms = 3000) {
  const eind = Date.now() + ms;
  while (Date.now() < eind) {
    if (voorwaarde()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return voorwaarde();
}

const zelfde = (a, b) => {
  try { assert.deepEqual(ofNiets(a), ofNiets(b)); return true; } catch { return false; }
};

test("a structural edit right after cropping does not leave the pre-crop viewport rectangles", async () => {
  const bron = await docMet(["1:50", "1:200", "1:500"], { vulling: 300 });
  const o = await opstelling(await bytesVan(bron));

  // Bijsnijden: de zichtbare box van pagina 2 verandert, dus ook de plek van
  // haar viewport in de app-ruimte. Geen paginatoewijzing → achtergrondlezing.
  const bijgesneden = await PDFDocument.load(o.bytesNu());
  bijgesneden.getPages()[1].setCropBox(5, 5, 150, 160);
  const cropBytes = await bytesVan(bijgesneden);
  // Direct daarna pagina 1 weg, mét toewijzing.
  const zonderEen = await PDFDocument.load(cropBytes);
  zonderEen.removePage(0);
  const eindBytes = await bytesVan(zonderEen);
  const verwacht = await gelezen(eindBytes);
  assert.notDeepEqual(verwacht[1], o.doc.pdfViewports[2], "de bijsnijding verschuift de rechthoek echt");

  // De weergave (pdf.js, in een eigen draad) is eerder klaar dan de lezing van
  // de meetschalen: de tweede bewerking komt binnen terwijl die nog loopt.
  o.impl.getDocument = () => ({ promise: Promise.resolve({ numPages: 3, destroy() {} }) });
  await pm.reloadFromBytes(cropBytes, [], {}, 1);
  await pm.reloadFromBytes(eindBytes, [], {}, 1, { pageMapping: { 1: null, 2: 1, 3: 2 } });

  assert.ok(await wachtTot(() => zelfde(o.doc.pdfViewports, verwacht)), "na afloop gelijk aan opnieuw lezen van de laatste bytes");
  // En het blijft zo: de verworpen lezing van de bijgesneden versie komt niet
  // alsnog binnen.
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(ofNiets(o.doc.pdfViewports), verwacht);
});

test("a structural edit without a pending read stays a plain remap (no second read)", async () => {
  const o = await opstelling(await bytesVan(await docMet(DOEL, { vulling: 300 })));
  const markering = [{ ratio: "alleen-herschikt" }];
  o.doc.pdfViewports = { 1: markering };
  const zonderDrie = await PDFDocument.load(o.bytesNu());
  zonderDrie.removePage(2);
  await pm.reloadFromBytes(await bytesVan(zonderDrie), [], {}, 1, { pageMapping: { 1: 1, 2: 2, 3: null, 4: 3 } });
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(o.doc.pdfViewports, { 1: markering }, "het document is niet nog eens gelezen");
});

test("undo and redo of a structural edit never show the viewports of the other version", async () => {
  const o = await opstelling(await bytesVan(await docMet(["1:50", "1:200", "1:500"], { vulling: 300 })));
  const voorBytes = o.bytesNu();
  const voor = await gelezen(voorBytes);
  await pm.deletePages([1]);
  const naBytes = o.bytesNu();
  const na = await gelezen(naBytes);
  assert.deepEqual(ofNiets(o.doc.pdfViewports), na);

  for (const [bytes, goed] of [[voorBytes, voor], [naBytes, na], [voorBytes, voor]]) {
    o.tijdensRender.length = 0;
    await pm.restorePageState(bytes, [], {}, 1);
    // Tijdens het opbouwen van de weergave en direct erna: leeg of al goed,
    // nooit de schalen van de andere versie op de verkeerde pagina.
    for (const moment of [...o.tijdensRender, o.doc.pdfViewports]) {
      assert.ok(moment === undefined || zelfde(moment, goed), `verkeerde viewports: ${JSON.stringify(ratios(moment))}`);
    }
    assert.ok(await wachtTot(() => zelfde(o.doc.pdfViewports, goed)), "de herlezing vult ze daarna goed in");
  }
});
