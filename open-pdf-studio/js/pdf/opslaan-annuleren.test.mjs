// Een save annuleren (#766), met de echte saver (saver-test-hooks.mjs) en een
// echt bestand in een tijdelijke map.
//
// De schrijver hieronder doet wat core/platform.js en src-tauri/src/
// atomic_file.rs samen doen: de bytes in een tijdelijk bestand naast het doel,
// een annulering stopt vóór het hernoemen en ruimt dat bestand op, daarna gaat
// het tijdelijke bestand over het doel. Er wordt bij elk veilig punt van de
// saver geannuleerd: het doel blijft byte-gelijk (md5), er blijft geen
// tijdelijk bestand achter, het document blijft gewijzigd en geen cache of
// teller verandert. Een annulering na het hernoemen verandert niets meer.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, renameSync, readdirSync, existsSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { PDFDocument } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF, savePDFAs, bouwMomentopname, bouwAnnotatieDocument } = await import('./saver.js');
const { maakOpslagAnnulering, OpslagGeannuleerd } = await import('./saver/opslag-annuleren.js');
const { createAnnotation } = await import('../annotations/factory.js');

// i18next draait hier zonder vertalingen: de Engelse standaardtekst komt terug.
const T = {
  savingPdf: 'Saving PDF…',
  saveCancelling: 'Cancelling the save…',
  saveCancelled: 'Save cancelled. The file was not changed.',
  saveCancelTooLate: 'The file had already been saved; it was too late to cancel.',
};
const md5 = (bytes) => createHash('md5').update(bytes).digest('hex');
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

async function bronBestand() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([595, 842]).drawText(`Blad ${i + 1}`, { x: 40, y: 20, size: 10 });
  return doc.save();
}

function markeringen() {
  const uit = [];
  for (let page = 1; page <= 3; page++) {
    uit.push(createAnnotation({ type: 'box', page, x: 50, y: 60, width: 120, height: 80, color: '#ff0000',
      strokeColor: '#ff0000', lineWidth: 2, author: 'Tester' }));
    uit.push(createAnnotation({ type: 'circle', page, x: 220, y: 60, width: 90, height: 90, color: '#0000ff',
      strokeColor: '#0000ff', lineWidth: 3, author: 'Tester' }));
  }
  return uit;
}

/**
 * Een document in de store, een echt doelbestand en een schrijver zoals
 * platform.js + atomic_file.rs. `haken.voorHernoemen` / `haken.naHernoemen`
 * laten een test tijdens het schrijven ingrijpen.
 */
async function harness() {
  const map = mkdtempSync(join(tmpdir(), 'opds-annuleren-'));
  const doel = join(map, 'tekening.pdf');
  const bron = await bronBestand();
  writeFileSync(doel, bron);
  let cache = bron;
  const log = { cache: [], meldingen: [], status: [], vensters: [], schrijfacties: 0 };
  const haken = { voorHernoemen: null, naHernoemen: null };
  let volgnummer = 0;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => cache,
      setCachedPdfBytes: (pad, bytes) => { log.cache.push(pad); cache = bytes; },
      writeBinaryFileAtomic: async (pad, bytes, { annulering } = {}) => {
        log.schrijfacties++;
        let geannuleerd = false;
        const af = annulering?.opWijziging?.(() => { if (annulering.geannuleerd) geannuleerd = true; });
        annulering?.controleer?.();
        const tijdelijk = join(dirname(pad), `.opds-save-${process.pid}-${volgnummer++}.tmp`);
        try {
          writeFileSync(tijdelijk, bytes);
          await haken.voorHernoemen?.(tijdelijk);
          if (geannuleerd) throw new Error('opds-write-cancelled');
          renameSync(tijdelijk, pad);
          await haken.naHernoemen?.();
        } finally {
          af?.();
          if (existsSync(tijdelijk)) unlinkSync(tijdelijk);
        }
        return true;
      },
      markDocumentSaved: (d) => { d.modified = false; d.savedUndoStackLength = (d.undoStack || []).length; },
      showLoading: (tekst, opties = {}) => log.vensters.push({ tekst, ...opties }),
      updateStatusMessage: (tekst) => log.status.push(tekst),
      showMessage: (tekst) => log.meldingen.push(tekst),
    },
  };
  state.documents = [{
    id: 'annuleren', filePath: doel, fileName: 'tekening.pdf', pdfDoc: {}, annotations: markeringen(),
    pageRotations: {}, _annotationPagesReady: new Set([1, 2, 3]), textEdits: [], currentPage: 1,
    modified: true, undoStack: [{}, {}, {}], savedUndoStackLength: 1,
  }];
  state.activeDocumentIndex = 0;
  const doc = state.documents[0];
  const momentopnameModel = () => JSON.stringify(doc.annotations);
  return {
    doc, doel, map, log, haken, md5Voor: md5(readFileSync(doel)), model: momentopnameModel(),
    momentopnameModel,
    bestanden: () => readdirSync(map).sort(),
    opruimen: () => rmSync(map, { recursive: true, force: true }),
    save: (annulering) => savePDF(null, { zonderHandtekeningVraag: true, annulering }),
  };
}

/** Na een geannuleerde save: niets op schijf, niets in het model veranderd. */
function onveranderd(h, wat) {
  assert.equal(md5(readFileSync(h.doel)), h.md5Voor, `${wat}: the file is byte-identical`);
  assert.deepEqual(h.bestanden(), ['tekening.pdf'], `${wat}: no temporary file is left`);
  assert.equal(h.doc.modified, true, `${wat}: still modified`);
  assert.equal(h.doc.savedUndoStackLength, 1, `${wat}: the saved revision did not move`);
  assert.deepEqual(h.log.cache, [], `${wat}: the bytes cache was not updated`);
  assert.equal(h.momentopnameModel(), h.model, `${wat}: the model is unchanged`);
  assert.ok(h.doc.textEdits.every((te) => !te._pendingBakeInfo), `${wat}: no pending bake info`);
  assert.deepEqual(h.log.meldingen, [], `${wat}: no error message`);
  assert.equal(h.log.status.at(-1), T.saveCancelled, `${wat}: a short status message`);
}

test('cancelling at every safe point leaves file, temp dir and model untouched', async () => {
  // Count the safe points of a full save first.
  const proef = await harness();
  let punten = 0;
  const teller = maakOpslagAnnulering({ nu: () => 0 });
  const echtPunt = teller.punt;
  teller.punt = async () => { punten++; return echtPunt(); };
  assert.equal(await proef.save(teller), true);
  proef.opruimen();
  assert.ok(punten >= 9, `safe points in one save: ${punten}`);

  for (let bij = 1; bij <= punten; bij++) {
    const h = await harness();
    const a = maakOpslagAnnulering({ nu: () => 0 });
    const punt = a.punt;
    let n = 0;
    a.punt = async () => { if (++n === bij) a.annuleer(); return punt(); };
    assert.equal(await h.save(a), false, `cancel at safe point ${bij}`);
    onveranderd(h, `safe point ${bij}`);
    assert.equal(h.log.schrijfacties, 0, `safe point ${bij}: the writer was never called`);
    h.opruimen();
  }
});

test('cancelling while the bytes are read cancels before parsing', async () => {
  const h = await harness();
  const a = maakOpslagAnnulering();
  const lees = globalThis.__saverTest.impl.getCachedPdfBytes;
  globalThis.__saverTest.impl.getCachedPdfBytes = (...x) => { a.annuleer(); return lees(...x); };
  assert.equal(await h.save(a), false);
  onveranderd(h, 'while reading');
  h.opruimen();
});

test('cancelling during the write removes the temp file and keeps the original', async () => {
  const h = await harness();
  const binnen = deferred(), verder = deferred();
  let tijdelijkGezien = null;
  h.haken.voorHernoemen = async (tijdelijk) => { tijdelijkGezien = existsSync(tijdelijk); binnen.resolve(); await verder.promise; };
  const saving = h.save();
  await binnen.promise;
  // The dialog still offers Cancel while the bytes are being staged.
  const venster = h.log.vensters.at(-1);
  assert.equal(venster.annulerenUit, false);
  venster.annuleren();
  verder.resolve();
  assert.equal(await saving, false);
  assert.equal(tijdelijkGezien, true, 'the write had staged a temp file');
  onveranderd(h, 'during the write');
  h.opruimen();
});

test('a cancel after the rename is ignored: the save is reported, nothing is rolled back', async () => {
  const h = await harness();
  const binnen = deferred(), verder = deferred();
  h.haken.naHernoemen = async () => { binnen.resolve(); await verder.promise; };
  const saving = h.save();
  await binnen.promise;
  h.log.vensters.at(-1).annuleren();
  verder.resolve();
  assert.equal(await saving, true);
  assert.notEqual(md5(readFileSync(h.doel)), h.md5Voor, 'the new file stays');
  assert.deepEqual(h.bestanden(), ['tekening.pdf']);
  assert.equal(h.doc.modified, false);
  assert.equal(h.doc.savedUndoStackLength, 3);
  assert.deepEqual(h.log.cache, [h.doel]);
  assert.equal(h.log.status.at(-1), T.saveCancelTooLate);
  // Past the point of no return the button stays, disabled.
  assert.equal(h.log.vensters.at(-1).annulerenUit, true);
  h.opruimen();
});

test('after a cancelled save, the next save works normally', async () => {
  const h = await harness();
  const a = maakOpslagAnnulering();
  a.annuleer();
  assert.equal(await h.save(a), false);
  onveranderd(h, 'first save');
  h.log.status.length = 0;
  assert.equal(await h.save(), true);
  const opnieuw = await PDFDocument.load(readFileSync(h.doel));
  assert.equal(opnieuw.getPageCount(), 3);
  assert.equal(h.doc.modified, false);
  assert.deepEqual(h.log.status, [], 'no cancel message on a normal save');
  h.opruimen();
});

test('Save As: a cancelled save keeps the document at its old path and writes no new file', async () => {
  const h = await harness();
  const nieuw = join(h.map, 'kopie.pdf');
  const a = maakOpslagAnnulering();
  const lees = globalThis.__saverTest.impl.getCachedPdfBytes;
  globalThis.__saverTest.impl.getCachedPdfBytes = (...x) => { a.annuleer(); return lees(...x); };
  assert.equal(await savePDFAs(h.doc, nieuw, { zonderHandtekeningVraag: true, annulering: a }), false);
  assert.equal(h.doc.filePath, h.doel);
  assert.equal(existsSync(nieuw), false);
  onveranderd(h, 'save as');
  h.opruimen();
});

test('the progress dialog offers Cancel, and shows that a cancel is running', async () => {
  const h = await harness();
  const a = maakOpslagAnnulering();
  const lees = globalThis.__saverTest.impl.getCachedPdfBytes;
  globalThis.__saverTest.impl.getCachedPdfBytes = (...x) => { a.annuleer(); return lees(...x); };
  await h.save(a);
  assert.equal(h.log.vensters[0].tekst, T.savingPdf);
  assert.equal(typeof h.log.vensters[0].annuleren, 'function');
  assert.equal(h.log.vensters.at(-1).tekst, T.saveCancelling);
  h.opruimen();
});

test('a recovery snapshot shows no Cancel and is not affected by a cancelled save', async () => {
  const h = await harness();
  const bytes = await bouwMomentopname(h.doc);
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0);
  assert.equal(h.log.vensters.length, 0, 'no progress dialog, so no Cancel');
  const a = maakOpslagAnnulering();
  a.annuleer();
  assert.equal(await h.save(a), false);
  const daarna = await bouwMomentopname(h.doc);
  assert.ok(daarna.length > 0, 'a snapshot after a cancelled save still works');
  h.opruimen();
});

test('Flatten All: the annotation build takes the token and throws when cancelled', async () => {
  const h = await harness();
  const a = maakOpslagAnnulering();
  a.annuleer();
  await assert.rejects(bouwAnnotatieDocument(h.doc, { annulering: a }), OpslagGeannuleerd);
  assert.equal(h.log.vensters.length, 0, 'Flatten All keeps its own progress dialog');
  const { pdfDocLib } = await bouwAnnotatieDocument(h.doc, { annulering: maakOpslagAnnulering() });
  assert.equal(pdfDocLib.getPageCount(), 3);
  // Flatten All reports its own cancel; the build itself shows nothing.
  h.log.status.push(T.saveCancelled);
  onveranderd(h, 'flatten build');
  h.opruimen();
});
