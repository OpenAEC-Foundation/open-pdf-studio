// Samenvoegen met lastige invoer (#1134): de echte mergeFiles van
// page-manager.js op echte PDF-bytes, met pdf-lib en pdf.js echt en de
// app-modules eromheen vervangen (page-manager-test-hooks.mjs). Gecontroleerd
// wordt wat een gebruiker ziet: het aantal pagina's, de volgorde, de maten en
// draaiing, en dat de inhoud van elke pagina leesbaar is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { versleutel } from './versleutel.testhulp.mjs';

register('./page-manager-test-hooks.mjs', import.meta.url);
const pm = await import('./page-manager.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const DOEL = 'C:/werk/doel.pdf';

/** Een PDF met op elke pagina de tekst "<naam> p<n>". */
async function pdf(naam, paginas, { objectStromen = true } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  paginas.forEach((p, i) => {
    const pagina = doc.addPage(p.maat || [300, 400]);
    if (p.draai) pagina.setRotation(degrees(p.draai));
    pagina.drawText(`${naam} p${i + 1}`, { x: 20, y: 40, size: 14, font });
  });
  return new Uint8Array(await doc.save({ useObjectStreams: objectStromen }));
}

const n = (aantal) => Array.from({ length: aantal }, () => ({}));

async function opstelling({ doelBytes, bestanden = {}, geopend = [], inCache = true, tauri = true, ontsleuteld = {} } = {}) {
  const bytes = doelBytes || await pdf('doel', n(2));
  const cache = new Map(inCache ? [[DOEL, bytes]] : []);
  const pdfDoc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const doc = {
    id: 'doel', filePath: DOEL, pdfDoc, currentPage: 1, pageRotations: {},
    annotations: [{ id: 'eigen', type: 'circle', page: 2, x: 10, y: 10, width: 20, height: 20 }],
    bookmarks: [],
    _loadedAnnotationPages: new Set([1, 2]), _annotationPagesReady: new Set([1, 2]),
  };
  const meldingen = [];
  const aanroepen = [];
  const alle = { [DOEL]: bytes, ...bestanden };
  // De desktop-app: Rust maakt van een beveiligd bestand een ontsleutelde
  // werkkopie (open_protected_pdf). `ontsleuteld[pad]` = { wachtwoord, bytes }.
  const invoke = async (cmd, args) => {
    aanroepen.push([cmd, args]);
    if (cmd === 'open_protected_pdf') {
      const o = ontsleuteld[args.path];
      if (!o) throw 'DECRYPT_FAILED: no PDFium';
      if ((o.wachtwoord || '') !== args.password) throw 'WRONG_PASSWORD';
      alle[`kopie:${args.path}`] = o.bytes;
      return { path: `kopie:${args.path}`, security: { handle: 7 } };
    }
    return null;
  };
  globalThis.window = tauri ? { __TAURI__: { core: { invoke } } } : {};
  globalThis.__pmTest = {
    documents: [doc, ...geopend],
    impl: {
      getActiveDocument: () => doc,
      getCachedPdfBytes: (k) => cache.get(k),
      setCachedPdfBytes: (k, b) => { cache.set(k, b); },
      isTauri: () => tauri,
      invoke,
      readBinaryFile: async (pad) => {
        if (!alle[pad]) throw new Error(`onbekend bestand ${pad}`);
        return alle[pad];
      },
      writeBinaryFile: async () => {},
      getDocument: (o) => pdfjs.getDocument({ ...o, isEvalSupported: false, verbosity: 0 }),
      laadAnnotatiesVoorPaginas: async (d, paginas) => { for (const p of paginas) d._annotationPagesReady.add(p); return null; },
      markAllAnnotationPagesLoaded: (aantal, d) => {
        for (let i = 1; i <= aantal; i++) { d._loadedAnnotationPages.add(i); d._annotationPagesReady.add(i); }
      },
      cancelAnnotationLoading: (d) => { d._loadedAnnotationPages.clear(); d._annotationPagesReady.clear(); },
      recordPageStructure: () => {},
      showMessage: (m) => { meldingen.push(String(m)); },
    },
  };
  return { doc, cache, meldingen, aanroepen };
}

/** De tekst van elke pagina van het document zoals de app het nu toont. */
async function teksten(doc) {
  const uit = [];
  for (let p = 1; p <= doc.pdfDoc.numPages; p++) {
    const pagina = await doc.pdfDoc.getPage(p);
    const inhoud = await pagina.getTextContent();
    uit.push(inhoud.items.map((i) => i.str).join('').trim());
  }
  return uit;
}

/** Maten en draaiing uit de bytes die de app nu als document heeft. */
async function paginas(o) {
  const lib = await PDFDocument.load(o.cache.get(o.doc.filePath));
  return lib.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight()), p.getRotation().angle]);
}

test('different page sizes and rotated pages keep their size, rotation and order', async () => {
  const bron = await pdf('A', [{ maat: [842, 1191] }, { maat: [200, 100], draai: 90 }, { maat: [595, 842], draai: 270 }]);
  const o = await opstelling({ bestanden: { 'C:/in/A.pdf': bron } });
  const verslag = await pm.mergeFiles(['C:/in/A.pdf'], 'end');
  assert.equal(verslag.pagesInserted, 3);
  assert.deepEqual(await teksten(o.doc), ['doel p1', 'doel p2', 'A p1', 'A p2', 'A p3']);
  assert.deepEqual(await paginas(o), [[300, 400, 0], [300, 400, 0], [842, 1191, 0], [200, 100, 90], [595, 842, 270]]);
  assert.equal(o.doc.currentPage, 3, 'de eerste samengevoegde pagina staat voor');
  assert.equal(o.doc.modified, true);
});

test('the three insert positions put the pages where the dialog says', async () => {
  const bron = await pdf('A', n(2));
  for (const [positie, verwacht, eigenPagina] of [
    ['start', ['A p1', 'A p2', 'doel p1', 'doel p2'], 4],
    ['after', ['doel p1', 'A p1', 'A p2', 'doel p2'], 4],
    ['end', ['doel p1', 'doel p2', 'A p1', 'A p2'], 2],
  ]) {
    const o = await opstelling({ bestanden: { 'C:/in/A.pdf': bron } });
    await pm.mergeFiles(['C:/in/A.pdf'], positie);
    assert.deepEqual(await teksten(o.doc), verwacht, positie);
    // De annotatie van het open document blijft op haar eigen pagina.
    assert.deepEqual(o.doc.annotations.map((a) => [a.id, a.page]), [['eigen', eigenPagina]], positie);
  }
});

test('several files go in in list order, also with spaces and non-ASCII characters in the path', async () => {
  const paden = ['C:\\Mijn documenten\\Tekening één (v2).pdf', 'C:/in/Ünïcödé — 図面.pdf', '\\\\server\\deel\\map met spatie\\C.pdf'];
  const o = await opstelling({
    bestanden: { [paden[0]]: await pdf('A', n(1)), [paden[1]]: await pdf('B', n(2)), [paden[2]]: await pdf('C', n(1)) },
  });
  const verslag = await pm.mergeFiles(paden, 'end');
  assert.deepEqual(verslag.merged, paden);
  assert.deepEqual(verslag.failed, []);
  assert.deepEqual(await teksten(o.doc), ['doel p1', 'doel p2', 'A p1', 'B p1', 'B p2', 'C p1']);
  assert.deepEqual(o.meldingen, []);
});

test('the same file twice, with and without object streams, and a large file', async () => {
  const klein = await pdf('K', n(1), { objectStromen: false });
  const groot = await pdf('G', n(300));
  const o = await opstelling({ bestanden: { 'C:/in/K.pdf': klein, 'C:/in/G.pdf': groot } });
  const verslag = await pm.mergeFiles(['C:/in/K.pdf', 'C:/in/G.pdf', 'C:/in/K.pdf'], 'end');
  assert.equal(verslag.pagesInserted, 302);
  const t = await teksten(o.doc);
  assert.equal(t.length, 304);
  assert.deepEqual([t[2], t[3], t[302], t[303]], ['K p1', 'G p1', 'G p300', 'K p1']);
  // Het resultaat laadt opnieuw, ook in pdf-lib.
  assert.equal((await PDFDocument.load(o.cache.get(o.doc.filePath))).getPageCount(), 304);
});

test('the open document can be merged into itself, and bytes not in the cache are read from disk', async () => {
  const o = await opstelling({ inCache: false });
  globalThis.__pmTest.impl.bouwMomentopname = async () => { throw new Error('geen momentopname in deze test'); };
  const verslag = await pm.mergeFiles([DOEL], 'end');
  assert.equal(verslag.error, undefined);
  assert.deepEqual(await teksten(o.doc), ['doel p1', 'doel p2', 'doel p1', 'doel p2']);
});

test('a file that is not a PDF is reported and the others are still merged', async () => {
  const o = await opstelling({
    bestanden: { 'C:/in/kapot.pdf': new TextEncoder().encode('dit is geen pdf'), 'C:/in/A.pdf': await pdf('A', n(1)) },
  });
  const verslag = await pm.mergeFiles(['C:/in/kapot.pdf', 'C:/in/weg.pdf', 'C:/in/A.pdf'], 'end');
  assert.deepEqual(verslag.merged, ['C:/in/A.pdf']);
  assert.deepEqual(verslag.failed.map((f) => f.path), ['C:/in/kapot.pdf', 'C:/in/weg.pdf']);
  assert.equal(o.meldingen.length, 2, 'elk mislukt bestand wordt gemeld');
  assert.deepEqual(await teksten(o.doc), ['doel p1', 'doel p2', 'A p1']);
});

test('a protected file that opens without a password is merged with readable pages', async () => {
  const schoon = await pdf('Beveiligd', n(2));
  const beveiligd = await versleutel(schoon);
  // De testhulp maakt een echt beveiligd bestand: pdf.js opent en leest het.
  const controle = await pdfjs.getDocument({ data: beveiligd.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  assert.equal((await (await controle.getPage(1)).getTextContent()).items.map((i) => i.str).join(''), 'Beveiligd p1');
  assert.equal((await PDFDocument.load(beveiligd, { ignoreEncryption: true })).isEncrypted, true);

  const o = await opstelling({
    bestanden: { 'C:/in/beveiligd.pdf': beveiligd },
    ontsleuteld: { 'C:/in/beveiligd.pdf': { wachtwoord: '', bytes: schoon } },
  });
  const verslag = await pm.mergeFiles(['C:/in/beveiligd.pdf'], 'end');
  assert.deepEqual(verslag.merged, ['C:/in/beveiligd.pdf']);
  assert.deepEqual(await teksten(o.doc), ['doel p1', 'doel p2', 'Beveiligd p1', 'Beveiligd p2']);
  assert.deepEqual(o.meldingen, []);
  // De werkkopie en haar beveiligingssessie worden weer losgelaten.
  assert.deepEqual(o.aanroepen.filter(([c]) => c === 'release_protected_pdf').map(([, a]) => a.path), ['kopie:C:/in/beveiligd.pdf']);
  assert.deepEqual(o.aanroepen.filter(([c]) => c === 'pdf_security_release').map(([, a]) => a.handles), [[7]]);
});

test('a file with an open password asks for it and is merged once it is right', async () => {
  const schoon = await pdf('Geheim', n(1));
  const beveiligd = await versleutel(schoon, { gebruiker: 'geheim' });
  await assert.rejects(pdfjs.getDocument({ data: beveiligd.slice(), isEvalSupported: false, verbosity: 0 }).promise, { name: 'PasswordException' });

  const o = await opstelling({
    bestanden: { 'C:/in/geheim.pdf': beveiligd },
    ontsleuteld: { 'C:/in/geheim.pdf': { wachtwoord: 'geheim', bytes: schoon } },
  });
  const gevraagd = [];
  globalThis.__pmTest.impl.vraagWachtwoord = async (v) => { gevraagd.push(v); return gevraagd.length === 1 ? 'fout' : 'geheim'; };
  const verslag = await pm.mergeFiles(['C:/in/geheim.pdf'], 'end');
  assert.deepEqual(gevraagd, [{ fileName: 'geheim.pdf', verkeerd: false }, { fileName: 'geheim.pdf', verkeerd: true }]);
  assert.deepEqual(verslag.merged, ['C:/in/geheim.pdf']);
  assert.deepEqual(await teksten(o.doc), ['doel p1', 'doel p2', 'Geheim p1']);
});

test('a protected file that cannot be decrypted is refused with a message, never merged as blank pages', async () => {
  const beveiligd = await versleutel(await pdf('Beveiligd', n(2)));
  const geheim = await versleutel(await pdf('Geheim', n(1)), { gebruiker: 'geheim' });
  const o = await opstelling({
    bestanden: { 'C:/in/beveiligd.pdf': beveiligd, 'C:/in/geheim.pdf': geheim, 'C:/in/A.pdf': await pdf('A', n(1)) },
    ontsleuteld: { 'C:/in/geheim.pdf': { wachtwoord: 'geheim', bytes: new Uint8Array() } },
  });
  // Geen ontsleuteling beschikbaar; bij het wachtwoord kiest de gebruiker Annuleren.
  globalThis.__pmTest.impl.vraagWachtwoord = async () => null;
  const verslag = await pm.mergeFiles(['C:/in/beveiligd.pdf', 'C:/in/geheim.pdf', 'C:/in/A.pdf'], 'end');
  assert.deepEqual(verslag.merged, ['C:/in/A.pdf']);
  assert.deepEqual(verslag.refused, [
    { path: 'C:/in/beveiligd.pdf', reason: 'protected' },
    { path: 'C:/in/geheim.pdf', reason: 'protected' },
  ]);
  assert.deepEqual(await teksten(o.doc), ['doel p1', 'doel p2', 'A p1']);
  // Alleen het bestand dat niet te ontsleutelen was krijgt een melding; wie
  // zelf Annuleren koos bij het wachtwoord, weet het al.
  assert.deepEqual(o.meldingen, ['protectedPdfNotAdded']);
});

test('when nothing could be merged the document is left exactly as it was', async () => {
  const beveiligd = await versleutel(await pdf('Beveiligd', n(2)));
  const o = await opstelling({ bestanden: { 'C:/in/beveiligd.pdf': beveiligd } });
  const voor = o.cache.get(DOEL);
  const verslag = await pm.mergeFiles(['C:/in/beveiligd.pdf'], 'end');
  assert.deepEqual(verslag.merged, []);
  assert.equal(o.cache.get(DOEL), voor);
  assert.equal(o.doc.pdfDoc.numPages, 2);
  assert.equal(o.doc.modified, undefined);
});

test('a failure after the files were read is shown, not swallowed', async () => {
  const o = await opstelling({ bestanden: { 'C:/in/A.pdf': await pdf('A', n(1)) } });
  globalThis.__pmTest.impl.getDocument = () => ({ promise: Promise.reject(new Error('herladen mislukt')) });
  const verslag = await pm.mergeFiles(['C:/in/A.pdf'], 'end');
  assert.equal(verslag.error, 'herladen mislukt');
  assert.deepEqual(o.meldingen, ['mergeFailed']);
});

test('a document whose own bytes are still encrypted is not merged into', async () => {
  const o = await opstelling({
    doelBytes: await versleutel(await pdf('doel', n(2))),
    bestanden: { 'C:/in/A.pdf': await pdf('A', n(1)) },
  });
  const verslag = await pm.mergeFiles(['C:/in/A.pdf'], 'end');
  assert.equal(verslag.error, 'document-protected');
  assert.deepEqual(o.meldingen, ['mergeDocumentProtected']);
  assert.equal(o.doc.pdfDoc.numPages, 2);
});

test('in the browser merging works on the files the user picked', async () => {
  // Een "pad" is daar de bestandsnaam; een open document met dezelfde naam
  // telt niet als hetzelfde bestand.
  const zelfdeNaam = { id: 'ander', filePath: 'A.pdf', pdfDoc: {} };
  const o = await opstelling({ tauri: false, bestanden: { 'A.pdf': await pdf('A', n(2)) }, geopend: [zelfdeNaam] });
  globalThis.__pmTest.impl.bouwMomentopname = async () => { throw new Error('mag niet gevraagd worden'); };
  const verslag = await pm.mergeFiles(['A.pdf', { path: 'A.pdf', pages: [1] }], 'start');
  assert.equal(verslag.error, undefined);
  assert.equal(verslag.pagesInserted, 3);
  assert.deepEqual(await teksten(o.doc), ['A p1', 'A p2', 'A p2', 'doel p1', 'doel p2']);
  assert.equal(o.doc.filePath, DOEL, 'geen werkbestand in de browser');
});

test('in the browser a protected file is refused with a message', async () => {
  const o = await opstelling({ tauri: false, bestanden: { 'B.pdf': await versleutel(await pdf('B', n(1))) } });
  const verslag = await pm.mergeFiles(['B.pdf'], 'end');
  assert.deepEqual(verslag.refused, [{ path: 'B.pdf', reason: 'protected' }]);
  assert.deepEqual(o.meldingen, ['protectedPdfNotAdded']);
  assert.deepEqual(o.aanroepen, []);
});

test('inserting pages from a protected file decrypts it first, and refuses it when that fails', async () => {
  const schoon = await pdf('Beveiligd', n(1));
  const beveiligd = await versleutel(schoon);
  let o = await opstelling({
    bestanden: { 'C:/in/beveiligd.pdf': beveiligd },
    ontsleuteld: { 'C:/in/beveiligd.pdf': { wachtwoord: '', bytes: schoon } },
  });
  assert.equal(await pm.insertPagesFromFile(1, 'after', 'C:/in/beveiligd.pdf'), true);
  assert.deepEqual(await teksten(o.doc), ['doel p1', 'Beveiligd p1', 'doel p2']);

  o = await opstelling({ bestanden: { 'C:/in/beveiligd.pdf': beveiligd } });
  assert.equal(await pm.insertPagesFromFile(1, 'after', 'C:/in/beveiligd.pdf'), false);
  assert.deepEqual(o.meldingen, ['protectedPdfNotAdded']);
  assert.equal(o.doc.pdfDoc.numPages, 2);
});

test('in the browser pages are inserted from the file the user picks', async () => {
  const o = await opstelling({ tauri: false, bestanden: { 'A.pdf': await pdf('A', n(1)) } });
  globalThis.__pmTest.impl.openFileDialog = async () => 'A.pdf';
  assert.equal(await pm.insertPagesFromFile(2, 'before'), true);
  assert.deepEqual(await teksten(o.doc), ['doel p1', 'A p1', 'doel p2']);
});
