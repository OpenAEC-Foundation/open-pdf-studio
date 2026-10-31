import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { PDFDocument } from 'pdf-lib';

// De MCP-opdrachten voor paginabewerkingen (app_rotate_pages, app_delete_pages,
// app_insert_blank_pages, app_extract_pages, app_reorder_pages,
// app_shift_pages): de argumenten worden gecontroleerd en dan draait de ECHTE
// page-manager.js op echte PDF-bytes (pdf-lib). De app eromheen is vervangen
// (page-manager-test-hooks.mjs).
register('./page-manager-test-hooks.mjs', import.meta.url);
const pm = await import('./page-manager.js');
const mcp = await import('./mcp-paginabewerkingen.js');
const { draaiPaginas } = await import('./pagina-draaien.js');
const { resolveTargetPages } = await import('./shift-page-geometry.js');

const SLEUTEL = 'C:/werk/bladen.pdf';

// Elke pagina een eigen breedte, zodat te zien is welke pagina waar staat.
async function bytesMet(aantal) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < aantal; i++) doc.addPage([100 + i, 200]);
  return new Uint8Array(await doc.save());
}

async function breedtes(bytes) {
  const d = await PDFDocument.load(bytes);
  return d.getPages().map((p) => Math.round(p.getWidth()));
}

function pdfjsDoc(lib) {
  return {
    numPages: lib.getPageCount(),
    destroy() {},
    async getPage(n) {
      const p = lib.getPage(n - 1);
      return { getViewport: () => ({ width: p.getWidth(), height: p.getHeight() }) };
    },
  };
}

async function opstelling(aantal, { alleenLezen = false, annotaties = [] } = {}) {
  const bytes = await bytesMet(aantal);
  const cache = new Map([[SLEUTEL, bytes]]);
  const bestanden = new Map();
  const doc = {
    id: 'doc-mcp',
    filePath: SLEUTEL,
    fileName: 'bladen.pdf',
    pdfDoc: pdfjsDoc(await PDFDocument.load(bytes)),
    annotations: annotaties.map((a) => ({ ...a })),
    pageRotations: {},
    currentPage: 1,
    pageLabels: null,
    pageLabelsDirty: false,
  };
  const undo = [];
  globalThis.window = { __TAURI__: {} };
  globalThis.__pmTest = {
    impl: {
      getActiveDocument: () => doc,
      getCachedPdfBytes: (k) => cache.get(k),
      setCachedPdfBytes: (k, b) => { cache.set(k, b); },
      isTauri: () => false,
      getDocument: ({ data }) => ({ promise: PDFDocument.load(data).then(pdfjsDoc) }),
      recordPageStructure: (...a) => { undo.push(a); },
      saveFileDialog: () => { throw new Error('geen dialoog via MCP'); },
      writeBinaryFileNew: async (pad, data) => {
        if (bestanden.has(pad)) throw new Error('FILE_EXISTS');
        bestanden.set(pad, data);
        return true;
      },
    },
  };
  const gedraaid = [];
  const o = {
    document: () => doc,
    alleenLezen: () => alleenLezen,
    paginaRotatie: (p) => doc.pageRotations[p] || 0,
    pm,
    // De echte draaitransactie van pagina-draaien.js, met een nagebootste renderer.
    draaiPaginas: (delta, paginas) => draaiPaginas(delta, paginas, {
      document: () => doc,
      paginaRotatie: (p) => doc.pageRotations[p] || 0,
      draaiPagina: async (d, p) => { gedraaid.push(p); doc.pageRotations[p] = ((doc.pageRotations[p] || 0) + d + 360) % 360; },
      legRotatieVast: (...a) => undo.push(['rotatie', ...a]),
      legAnnotatiesVast: () => {},
      kloon: (a) => ({ ...a }),
      beginTransactie: () => undo.push('begin'),
      eindTransactie: () => undo.push('eind'),
      tekenOpnieuw: async () => {},
    }),
    shiftPages: async () => { throw new Error('niet in deze test'); },
  };
  return { doc, undo, cache, bestanden, o, gedraaid, huidigeBytes: () => cache.get(SLEUTEL) };
}

// --- verwijderen ---------------------------------------------------------------

test('app_delete_pages: de echte page-manager haalt de pagina\'s weg, annotaties schuiven mee, één undo-stap', async () => {
  const s = await opstelling(4, { annotaties: [{ id: 'a', page: 2 }, { id: 'b', page: 3 }, { id: 'c', page: 4 }] });
  const r = await mcp.deletePages({ pages: [3, 1] }, s.o);
  assert.deepEqual(r, { ok: true, deleted: [1, 3], pagesBefore: 4, pagesAfter: 2, currentPage: 1 });
  assert.deepEqual(await breedtes(s.huidigeBytes()), [101, 103]);
  assert.deepEqual(s.doc.annotations.map((a) => [a.id, a.page]), [['a', 1], ['c', 2]]);
  assert.equal(s.undo.length, 1, 'één ongedaan-maakstap');
});

test('app_delete_pages: nooit alle pagina\'s, en paginanummers binnen het document', async () => {
  const s = await opstelling(3);
  assert.match((await mcp.deletePages({ pages: [1, 2, 3] }, s.o)).error, /cannot delete all pages/);
  assert.match((await mcp.deletePages({ pages: [4] }, s.o)).error, /page 4 is out of range: the document has 3 pages/);
  assert.match((await mcp.deletePages({ pages: [0] }, s.o)).error, /out of range/);
  assert.match((await mcp.deletePages({ pages: [1.5] }, s.o)).error, /whole page numbers/);
  assert.match((await mcp.deletePages({ pages: [2, 2] }, s.o)).error, /listed twice/);
  assert.match((await mcp.deletePages({ pages: [] }, s.o)).error, /non-empty array/);
  assert.match((await mcp.deletePages({}, s.o)).error, /non-empty array/);
  assert.match((await mcp.deletePages({ pages: [1], page: 2 }, s.o)).error, /unknown argument: page/);
  assert.equal(s.doc.pdfDoc.numPages, 3, 'niets verwijderd');
  assert.equal(s.undo.length, 0);
});

// --- invoegen ------------------------------------------------------------------

test('app_insert_blank_pages: na een pagina, met de maat van die pagina', async () => {
  const s = await opstelling(3, { annotaties: [{ id: 'a', page: 3 }] });
  const r = await mcp.insertBlankPages({ after: 2, count: 2 }, s.o);
  assert.equal(r.ok, true);
  assert.deepEqual(r.inserted, [3, 4]);
  assert.equal(r.widthPt, 101);
  assert.equal(r.heightPt, 200);
  assert.equal(r.pagesAfter, 5);
  assert.deepEqual(await breedtes(s.huidigeBytes()), [100, 101, 101, 101, 102]);
  assert.equal(s.doc.annotations[0].page, 5, 'de annotatie van pagina 3 schuift mee');
  assert.equal(s.undo.length, 1);
});

test('app_insert_blank_pages: after 0 zet ze vooraan, met een eigen maat', async () => {
  const s = await opstelling(2);
  const r = await mcp.insertBlankPages({ after: 0, widthPt: 595.28, heightPt: 841.89 }, s.o);
  assert.deepEqual(r.inserted, [1]);
  assert.deepEqual(await breedtes(s.huidigeBytes()), [595, 100, 101]);
});

test('app_insert_blank_pages: argumenten', async () => {
  const s = await opstelling(2);
  assert.match((await mcp.insertBlankPages({}, s.o)).error, /missing after/);
  assert.match((await mcp.insertBlankPages({ after: 3 }, s.o)).error, /after must be a whole number from 0 to 2/);
  assert.match((await mcp.insertBlankPages({ after: 1, count: 0 }, s.o)).error, /count must be a whole number from 1 to 500/);
  assert.match((await mcp.insertBlankPages({ after: 1, widthPt: 300 }, s.o)).error, /both widthPt and heightPt/);
  assert.match((await mcp.insertBlankPages({ after: 1, widthPt: 1, heightPt: 300 }, s.o)).error, /widthPt must be a number from 3 to 14400/);
  assert.equal(s.doc.pdfDoc.numPages, 2);
});

// --- uitnemen ------------------------------------------------------------------

test('app_extract_pages: in de gegeven volgorde naar een nieuw bestand, zonder dialoog; het document blijft', async () => {
  const s = await opstelling(4);
  const r = await mcp.extractPages({ pages: [4, 2], outputPath: 'C:/uit/deel.pdf' }, s.o);
  assert.deepEqual(r, { ok: true, outputPath: 'C:/uit/deel.pdf', pages: [4, 2], pagesExtracted: 2, deletedFromOriginal: false, pagesAfter: 4 });
  assert.deepEqual(await breedtes(s.bestanden.get('C:/uit/deel.pdf')), [103, 101]);
  assert.equal(s.undo.length, 0, 'alleen uitnemen wijzigt het document niet');
});

test('app_extract_pages: een bestaand bestand wordt nooit vervangen', async () => {
  const s = await opstelling(2);
  s.bestanden.set('/tmp/bestaat.pdf', new Uint8Array([1]));
  const r = await mcp.extractPages({ pages: [1], outputPath: '/tmp/bestaat.pdf' }, s.o);
  assert.equal(r.ok, false);
  assert.match(r.error, /must not exist yet/);
  assert.deepEqual([...s.bestanden.get('/tmp/bestaat.pdf')], [1]);
});

test('app_extract_pages: met deleteFromOriginal gaan ze uit het document, maar nooit alle', async () => {
  const s = await opstelling(3);
  const r = await mcp.extractPages({ pages: [2], outputPath: '/tmp/twee.pdf', deleteFromOriginal: true }, s.o);
  assert.equal(r.deletedFromOriginal, true);
  assert.equal(r.pagesAfter, 2);
  assert.deepEqual(await breedtes(s.huidigeBytes()), [100, 102]);
  assert.match((await mcp.extractPages({ pages: [1, 2], outputPath: '/tmp/alles.pdf', deleteFromOriginal: true }, s.o)).error, /cannot delete all pages/);
  assert.equal(s.bestanden.has('/tmp/alles.pdf'), false);
});

test('app_extract_pages: het pad is absoluut, eindigt op .pdf en is niet het document zelf', async () => {
  const s = await opstelling(2);
  const fout = async (outputPath) => (await mcp.extractPages({ pages: [1], outputPath }, s.o)).error;
  assert.match(await fout('deel.pdf'), /absolute path/);
  assert.match(await fout('/tmp/deel.png'), /must end in \.pdf/);
  assert.match(await fout('/tmp/../etc/deel.pdf'), /\.\./);
  assert.match(await fout('https://example.com/deel.pdf'), /URL/);
  assert.match(await fout(undefined), /missing or invalid outputPath/);
  assert.match(await fout('c:\\werk\\BLADEN.pdf'), /the document itself/);
  assert.match((await mcp.extractPages({ pages: [1], outputPath: '/tmp/x.pdf', deleteFromOriginal: 'ja' }, s.o)).error, /boolean/);
  assert.equal(s.bestanden.size, 0);
});

// --- herschikken ---------------------------------------------------------------

test('app_reorder_pages: order[i] wordt pagina i+1; annotaties gaan mee met hun pagina', async () => {
  const s = await opstelling(3, { annotaties: [{ id: 'a', page: 1 }, { id: 'c', page: 3 }] });
  const r = await mcp.reorderPages({ order: [3, 1, 2] }, s.o);
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.deepEqual(await breedtes(s.huidigeBytes()), [102, 100, 101]);
  assert.deepEqual(Object.fromEntries(s.doc.annotations.map((a) => [a.id, a.page])), { a: 2, c: 1 });
  assert.equal(s.undo.length, 1);
});

test('app_reorder_pages: elke pagina precies één keer; de huidige volgorde verandert niets', async () => {
  const s = await opstelling(3);
  assert.match((await mcp.reorderPages({ order: [1, 2] }, s.o)).error, /every page exactly once: the document has 3 pages, order has 2/);
  assert.match((await mcp.reorderPages({ order: [1, 1, 2] }, s.o)).error, /listed twice in order/);
  assert.match((await mcp.reorderPages({ order: [1, 2, 4] }, s.o)).error, /out of range/);
  assert.deepEqual(await mcp.reorderPages({ order: [1, 2, 3] }, s.o), { ok: true, changed: false, order: [1, 2, 3], pages: 3, currentPage: 1 });
  assert.equal(s.undo.length, 0);
});

// --- draaien -------------------------------------------------------------------

test('app_rotate_pages: de draaitransactie van het lint, de nieuwe draaiing per pagina', async () => {
  const s = await opstelling(3);
  const r = await mcp.rotatePages({ pages: [3, 1], angle: 90 }, s.o);
  assert.deepEqual(r, { ok: true, angle: 90, pages: [1, 3], rotations: [{ page: 1, rotation: 90 }, { page: 3, rotation: 90 }] });
  assert.deepEqual(s.gedraaid, [1, 3]);
  assert.equal(s.undo[0], 'begin');
  assert.equal(s.undo.at(-1), 'eind', 'één transactie: één Ctrl+Z');
  const terug = await mcp.rotatePages({ pages: [1], angle: -90 }, s.o);
  assert.equal(terug.rotations[0].rotation, 0);
});

test('app_rotate_pages: alleen kwartslagen', async () => {
  const s = await opstelling(2);
  for (const angle of [45, 0, 360, '90', undefined]) {
    assert.match((await mcp.rotatePages({ pages: [1], angle }, s.o)).error, /angle must be 90, 180, 270/);
  }
  assert.match((await mcp.rotatePages({ pages: [3], angle: 90 }, s.o)).error, /out of range/);
  assert.deepEqual(s.gedraaid, []);
});

// --- verschuiven ---------------------------------------------------------------

test('app_shift_pages: millimeters en de paginalijst gaan naar shiftPages van de dialoog', async () => {
  const s = await opstelling(3);
  const aanroepen = [];
  s.o.shiftPages = async (dx, dy, pages) => { aanroepen.push([dx, dy, pages]); return { shifted: pages.length }; };
  const r = await mcp.shiftPages({ pages: [3, 1], dx: 5, dy: -2.5 }, s.o);
  assert.deepEqual(r, { ok: true, pages: [1, 3], dx: 5, dy: -2.5, shifted: 2 });
  assert.deepEqual(aanroepen, [[5, -2.5, [1, 3]]]);
  s.o.shiftPages = async () => ({ shifted: 0, reason: 'no-pages' });
  const leeg = await mcp.shiftPages({ pages: [2], dy: 1 }, s.o);
  assert.equal(leeg.ok, false);
  assert.match(leeg.error, /nothing to shift/);
  assert.match((await mcp.shiftPages({ pages: [1] }, s.o)).error, /non-zero dx or dy/);
  assert.match((await mcp.shiftPages({ pages: [1], dx: 6000 }, s.o)).error, /dx must be a number from -5080 to 5080 \(millimetres\)/);
  assert.match((await mcp.shiftPages({ pages: [1], dx: '5' }, s.o)).error, /dx must be a number/);
});

test('shiftPages kiest uit een paginalijst dezelfde pagina\'s (resolveTargetPages)', () => {
  assert.deepEqual(resolveTargetPages([3, 1, 3, 9, 0, 2.5], 1, 1, 4), [1, 3]);
  assert.deepEqual(resolveTargetPages([], 1, 1, 4), []);
  assert.deepEqual(resolveTargetPages('odd', 1, 1, 4), [1, 3], 'de keuzes van de dialoog blijven');
});

// --- alleen-lezen en geen document --------------------------------------------

test('alleen-lezen (PDF/A, wachtwoord): elke paginabewerking geweigerd, niets gedaan', async () => {
  const s = await opstelling(3, { alleenLezen: true });
  s.o.shiftPages = async () => { throw new Error('mag niet'); };
  const pogingen = [
    mcp.deletePages({ pages: [1] }, s.o),
    mcp.insertBlankPages({ after: 1 }, s.o),
    mcp.extractPages({ pages: [1], outputPath: '/tmp/a.pdf' }, s.o),
    mcp.reorderPages({ order: [2, 1, 3] }, s.o),
    mcp.rotatePages({ pages: [1], angle: 90 }, s.o),
    mcp.shiftPages({ pages: [1], dx: 1 }, s.o),
  ];
  for (const r of await Promise.all(pogingen)) {
    assert.equal(r.ok, false);
    assert.equal(r.readOnly, true);
    assert.match(r.error, /read-only/);
  }
  assert.equal(s.undo.length, 0);
  assert.equal(s.bestanden.size, 0);
  assert.deepEqual(s.gedraaid, []);
});

test('zonder document: een duidelijke fout', async () => {
  const s = await opstelling(1);
  s.o.document = () => null;
  assert.deepEqual(await mcp.deletePages({ pages: [1] }, s.o), { ok: false, error: 'no active document' });
  assert.deepEqual(await mcp.insertBlankPages({ after: 0 }, s.o), { ok: false, error: 'no active document' });
});
