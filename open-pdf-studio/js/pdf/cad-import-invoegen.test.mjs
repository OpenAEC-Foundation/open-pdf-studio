import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { PDFDocument } from "pdf-lib";

// Het invoegen van een geïmporteerde tekening in het open document (#400),
// met de echte paginabeheerder en de app-modules eromheen vervangen (zie
// page-manager-test-hooks.mjs).
register("./page-manager-test-hooks.mjs", import.meta.url);
const pm = await import("./page-manager.js");
const cadImport = await import("./cad-import.js");

const SLEUTEL = "geheugen/document.pdf";

async function opstelling(bestanden = {}) {
  const lib = await PDFDocument.create();
  lib.addPage([200, 200]);
  const bytes = new Uint8Array(await lib.save());
  const cache = new Map([[SLEUTEL, bytes]]);
  const doc = {
    id: "doc-1", filePath: SLEUTEL, pdfDoc: { numPages: 1, destroy() {} },
    annotations: [], pageRotations: {}, currentPage: 1,
  };
  const meldingen = [];
  globalThis.window = { __TAURI__: {} };
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
      setViewMode: async () => {},
      showMessage: (m) => { meldingen.push(m); },
    },
  };
  return { doc, cache, meldingen };
}

test("a failed insert from the menu reports once", async () => {
  const o = await opstelling();
  assert.equal(await pm.insertPagesFromFile(1, "after", "weg.pdf"), false);
  assert.equal(o.meldingen.length, 1);
});

test("a failed insert of an imported drawing is reported by the import dialog alone", async () => {
  const o = await opstelling();
  await assert.rejects(cadImport.voegImportToeAanDocument("weg.pdf"), /IMPORT_INSERT_FAILED/);
  assert.deepEqual(o.meldingen, [], "geen los meldingsvenster naast de fout in het importvenster");
});

test("an imported drawing without pages is reported by the import dialog alone", async () => {
  // pdf-lib maakt bij het opslaan zelf een pagina aan; een bron zonder
  // pagina's bestaat alleen als kapot bestand, en dat is ook een mislukking.
  const o = await opstelling({ "leeg.pdf": new Uint8Array([37, 80, 68, 70]) });
  await assert.rejects(cadImport.voegImportToeAanDocument("leeg.pdf"), /IMPORT_INSERT_FAILED/);
  assert.deepEqual(o.meldingen, []);
});

test("a good import is inserted after the current page", async () => {
  const bron = await PDFDocument.create();
  bron.addPage([300, 300]);
  const o = await opstelling({ "goed.pdf": new Uint8Array(await bron.save()) });
  await cadImport.voegImportToeAanDocument("goed.pdf");
  const nieuw = await PDFDocument.load(o.cache.get(SLEUTEL));
  assert.equal(nieuw.getPageCount(), 2);
  assert.equal(nieuw.getPages()[1].getWidth(), 300);
  assert.deepEqual(o.meldingen, []);
});

// Een voorbeeld-PDF (het importvenster tekent er zijn voorbeeld mee) kan bij
// een zware tekening inhoud missen. Ze draagt `/OPS_Preview true` en komt
// nooit als pagina in een document terecht.
async function voorbeeldPdf({ opPagina = false } = {}) {
  const { PDFName, PDFBool } = await import("pdf-lib");
  const bron = await PDFDocument.create();
  const pagina = bron.addPage([300, 300]);
  if (opPagina) pagina.node.set(PDFName.of("OPS_Preview"), PDFBool.True);
  else bron.catalog.set(PDFName.of("OPS_Preview"), PDFBool.True);
  return new Uint8Array(await bron.save());
}

test("a preview pdf is never inserted as pages", async () => {
  for (const opPagina of [false, true]) {
    const o = await opstelling({ "voorbeeld.pdf": await voorbeeldPdf({ opPagina }) });
    const voor = o.cache.get(SLEUTEL);
    await assert.rejects(cadImport.voegImportToeAanDocument("voorbeeld.pdf"), /IMPORT_INSERT_FAILED/);
    assert.equal(o.cache.get(SLEUTEL), voor, "het document is niet aangeraakt");
    assert.deepEqual(o.meldingen, []);
    // Vanuit het menu: één melding, en ook dan niets ingevoegd.
    assert.equal(await pm.insertPagesFromFile(1, "after", "voorbeeld.pdf"), false);
    assert.equal(o.meldingen.length, 1);
    assert.equal(o.cache.get(SLEUTEL), voor);
  }
});

test("merging a preview pdf reports the refusal instead of a merged file", async () => {
  const { mergeAntwoord, REDEN_VOORBEELD } = await import("./merge-verslag.js");
  const bron = await PDFDocument.create();
  bron.addPage([300, 300]);
  const o = await opstelling({
    "voorbeeld.pdf": await voorbeeldPdf(),
    "goed.pdf": new Uint8Array(await bron.save()),
  });
  const voor = o.cache.get(SLEUTEL);
  const verslag = await pm.mergeFiles(["voorbeeld.pdf"], "end");
  assert.deepEqual(verslag.merged, []);
  assert.deepEqual(verslag.refused, [{ path: "voorbeeld.pdf", reason: REDEN_VOORBEELD }]);
  assert.equal(verslag.pagesInserted, 0);
  assert.equal(o.cache.get(SLEUTEL), voor, "het document is niet aangeraakt");
  const antwoord = mergeAntwoord(verslag, { filePaths: ["voorbeeld.pdf"], position: "end", pagesBefore: 1, pagesAfter: 1 });
  assert.equal(antwoord.ok, false);
  assert.equal(antwoord.mergedFiles, 0);
  assert.deepEqual(antwoord.refused, [{ file: "voorbeeld.pdf", reason: REDEN_VOORBEELD }]);

  // Een goed bestand naast een geweigerd en een onleesbaar bestand: wat erin
  // ging, staat er apart van wat eruit bleef.
  const gemengd = await pm.mergeFiles(["goed.pdf", "voorbeeld.pdf", "weg.pdf"], "end");
  assert.deepEqual(gemengd.merged, ["goed.pdf"]);
  assert.equal(gemengd.pagesInserted, 1);
  assert.equal(gemengd.refused.length, 1);
  assert.equal(gemengd.failed.length, 1);
  assert.equal(gemengd.failed[0].path, "weg.pdf");
  assert.equal((await PDFDocument.load(o.cache.get(SLEUTEL))).getPageCount(), 2);

  // Zonder open document begint het samenvoegen niet, en dat staat erbij.
  globalThis.__pmTest.impl.getActiveDocument = () => null;
  assert.equal((await pm.mergeFiles(["goed.pdf"], "end")).error, "no-document");
});

test("the preview mark is recognised on the catalog and on a page, and only when true", async () => {
  const pdfLib = await import("pdf-lib");
  const { isVoorbeeldPdf } = await import("./cad-import-logica.js");
  const gewoon = await PDFDocument.create();
  gewoon.addPage([100, 100]);
  assert.equal(isVoorbeeldPdf(gewoon, pdfLib), false);
  gewoon.catalog.set(pdfLib.PDFName.of("OPS_Preview"), pdfLib.PDFBool.False);
  assert.equal(isVoorbeeldPdf(gewoon, pdfLib), false);
  for (const opPagina of [false, true]) {
    const doc = await PDFDocument.load(await voorbeeldPdf({ opPagina }));
    assert.equal(isVoorbeeldPdf(doc, pdfLib), true);
  }
  assert.equal(isVoorbeeldPdf(null, pdfLib), false);
});

test("after a page edit the document renders from a new working file and the old one is removed", async () => {
  // Een geïmporteerde tekening opent uit een tijdelijke PDF. Na een
  // paginabewerking rendert het document uit een nieuw werkbestand; het oude
  // mag niet tot de opruiming van de volgende dag in de tijdelijke map blijven.
  const { onthoudWerkbestand } = await import("./document-release.js");
  const bron = await PDFDocument.create();
  bron.addPage([300, 300]);
  const o = await opstelling({ "goed.pdf": new Uint8Array(await bron.save()) });
  const importPdf = "T:/tmp/opds-import-1700000000000-plan.pdf";
  o.cache.set(importPdf, o.cache.get(SLEUTEL));
  o.doc.filePath = importPdf;
  o.doc.isUntitled = true;
  onthoudWerkbestand(o.doc, importPdf);
  const geschreven = [];
  const verwijderd = [];
  // Het openen van de import-PDF heeft haar vergrendeld (lock_file): zolang
  // die vergrendeling erop staat, is het bestand niet te verwijderen.
  const vergrendeld = new Set([importPdf]);
  globalThis.__pmTest.documents = [o.doc];
  globalThis.__pmTest.impl.writeBinaryFile = async (pad) => { geschreven.push(pad); };
  globalThis.__pmTest.impl.unlockFile = async (pad) => { vergrendeld.delete(pad); return true; };
  globalThis.window.__TAURI__ = {
    path: { tempDir: async () => "T:/tmp/" },
    fs: {
      remove: async (pad) => {
        if (vergrendeld.has(pad)) throw new Error("in gebruik");
        verwijderd.push(pad);
      },
      exists: async (pad) => !verwijderd.includes(pad),
    },
  };

  assert.equal(await pm.insertPagesFromFile(1, "after", "goed.pdf"), true);
  assert.equal(vergrendeld.size, 0, "de vergrendeling van de losgelaten import-PDF is eraf");
  assert.equal(geschreven.length, 1);
  assert.match(geschreven[0], /^T:\/tmp\/opds-edit-\d+\.pdf$/);
  assert.equal(o.doc.filePath, geschreven[0], "het document rendert uit het nieuwe werkbestand");
  assert.ok(verwijderd.includes(importPdf), `het losgelaten werkbestand is verwijderd: ${verwijderd}`);
  assert.deepEqual(o.doc._werkbestanden, [geschreven[0]], "alleen het nieuwe werkbestand is nog onthouden");
  assert.ok(!verwijderd.includes(geschreven[0]), "het werkbestand in gebruik blijft staan");
});

test("an imported drawing that opens as a new document is remembered as a working file of its tab", async () => {
  await opstelling();
  const tabDoc = { id: "doc-2", annotations: [] };
  globalThis.__pmTest.documents = [tabDoc];
  globalThis.__pmTest.impl.createTab = () => ({ index: 0 });
  let geladen = null;
  globalThis.__pmTest.impl.loadPDF = async (pad, index) => { geladen = [pad, index]; };
  const pad = "T:/tmp/opds-import-1700000000000-plan.pdf";
  const doc = await cadImport.openImportAlsNieuwDocument(pad, "C:/tekeningen/plan.dwg");
  assert.equal(doc, tabDoc);
  assert.deepEqual(geladen, [pad, 0]);
  assert.deepEqual(tabDoc._werkbestanden, [pad], "de tijdelijke PDF hoort bij dit tabblad");
  assert.equal(tabDoc.isUntitled, true, "Opslaan vraagt straks om een plek");
  assert.equal(tabDoc.fileName, "plan.pdf");
});

test("the start-up sweep removes old working files of imports and page edits, and nothing else", async () => {
  await opstelling();
  const nu = Date.now();
  const dag = 24 * 60 * 60 * 1000;
  const oud = nu - 2 * dag;
  const namen = [
    `opds-import-${oud}-plan.pdf`, `opds-edit-${oud}.pdf`, `OPDS-EDIT-${oud}.PDF`,
    `opds-import-${nu - 1000}-nieuw.pdf`, `opds-edit-${nu - 1000}.pdf`,
    "opds-import-notitie.pdf", `opds-print-${oud}.pdf`, `opds-edit-${oud}.txt`, "rapport.pdf",
  ];
  const verwijderd = [];
  globalThis.window.__TAURI__ = {
    path: { tempDir: async () => "T:/tmp" },
    fs: {
      readDir: async () => namen.map((name) => ({ name })),
      remove: async (pad) => { verwijderd.push(pad); },
    },
  };
  // Een document dat al dagen open staat, rendert nog uit zijn oude werkbestand.
  namen.push(`opds-edit-${oud - 5}.pdf`, `opds-import-${oud - 7}-open.pdf`);
  globalThis.__pmTest.documents = [
    { id: "lang-open", filePath: `T:/tmp/opds-edit-${oud - 5}.pdf`, _werkbestanden: [`T:/tmp/opds-import-${oud - 7}-open.pdf`] },
  ];
  assert.equal(await cadImport.ruimOudeImportsOp(), 3);
  assert.deepEqual(verwijderd.sort(), [`T:/tmp/OPDS-EDIT-${oud}.PDF`, `T:/tmp/opds-edit-${oud}.pdf`, `T:/tmp/opds-import-${oud}-plan.pdf`].sort());
});

test("the import writes into the app's private folder, not the shared temp folder, and the sweep covers both", async () => {
  await opstelling();
  const aanroepen = [];
  globalThis.__pmTest.impl.invoke = async (naam, args) => {
    aanroepen.push([naam, args]);
    if (naam === 'cad_import_dir') return 'C:\\Users\\iemand\\AppData\\Local\\app\\cache\\cad-import';
    return true;
  };
  const nu = Date.now();
  const oud = nu - 2 * 24 * 60 * 60 * 1000;
  const perMap = {
    'C:\\Users\\iemand\\AppData\\Local\\app\\cache\\cad-import/': [`opds-import-${oud}-plan.pdf`, `opds-import-${nu}-vers.pdf`],
    'T:/tmp/': [`opds-edit-${oud}.pdf`, `opds-import-${oud}-oud.pdf`],
  };
  const verwijderd = [];
  globalThis.window.__TAURI__ = {
    path: { tempDir: async () => 'T:/tmp' },
    fs: {
      readDir: async (map) => (perMap[map] || []).map((name) => ({ name })),
      remove: async (pad) => { verwijderd.push(pad); },
    },
  };
  const pad = await cadImport.tijdelijkPdfPad('C:/tekeningen/plan.dwg');
  assert.match(pad, /^C:\\Users\\iemand\\AppData\\Local\\app\\cache\\cad-import\/opds-import-\d{13}-plan\.pdf$/, pad);
  assert.ok(aanroepen.some(([n]) => n === 'cad_import_dir'));
  // Opruimen: de importmap van de app en de tijdelijke map (werkkopieën van vroeger).
  assert.equal(await cadImport.ruimOudeImportsOp(), 3);
  assert.deepEqual(verwijderd.sort(), [
    `C:\\Users\\iemand\\AppData\\Local\\app\\cache\\cad-import/opds-import-${oud}-plan.pdf`,
    `T:/tmp/opds-edit-${oud}.pdf`,
    `T:/tmp/opds-import-${oud}-oud.pdf`,
  ].sort());
  // Zonder de map van de app (oudere schil): de tijdelijke map, zoals vroeger.
  globalThis.__pmTest.impl.invoke = async (naam) => { if (naam === 'cad_import_dir') throw new Error('onbekend commando'); return true; };
  assert.match(await cadImport.tijdelijkPdfPad('plan.dwg'), /^T:\/tmp\/opds-import-\d{13}-plan\.pdf$/);
});
