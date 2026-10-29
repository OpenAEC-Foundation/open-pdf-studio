// Ingevoegde tekst verwijderen met het tekstbewerkgereedschap (GitHub #722).
//
// removeTextEditRecord legde alleen een 'removeTextEdit'-stap vast; execute()
// past niets toe, dus het record bleef in doc.textEdits staan en de tekst
// kwam bij opslaan terug. Hier: invoegen, verwijderen, ongedaan maken,
// opnieuw uitvoeren en opslaan, met de echte state, undo-manager en saver.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { register } from 'node:module';
import { PDFDocument } from 'pdf-lib';
import * as mupdf from 'mupdf';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const undo = await import('../core/undo-manager.js');
const { verwijderTextEditRecord } = await import('./text-edit-verwijderen.js');
const { nieuwTekstblokRecord } = await import('../text/text-edit-appearance.js');
const { saveTextEditsToPages } = await import('../pdf/saver/text-edits.js');

function openen() {
  state.documents = [{
    id: 'doc-722', filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [],
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

// Zoals de tool: record aanmaken, tekst typen, eerste commit = addTextEdit.
function voegTekstIn(doc, id, tekst, pdfY) {
  const rec = nieuwTekstblokRecord({ page: 1, pdfX: 72, pdfY });
  rec.id = id;
  doc.textEdits.push(rec);
  rec.newText = tekst;
  delete rec._pendingNew;
  undo.execute({ type: 'addTextEdit', textEdit: { ...rec } });
  return rec;
}

async function opgeslagenTekst(doc) {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  await saveTextEditsToPages(pdf, pdf.getPages(), doc);
  const bytes = await pdf.save({ useObjectStreams: false });
  const d = mupdf.Document.openDocument(bytes, 'application/pdf');
  return d.loadPage(0).toStructuredText().asText();
}

const ids = (doc) => doc.textEdits.map(e => e.id);

test('verwijderde ingevoegde tekst verdwijnt uit het document en uit het opgeslagen bestand', async () => {
  const doc = openen();
  voegTekstIn(doc, 'blijft', 'Blijvende regel', 700);
  const weg = voegTekstIn(doc, 'weg', 'Verwijderde regel', 650);
  voegTekstIn(doc, 'achter', 'Laatste regel', 600);

  assert.equal(verwijderTextEditRecord(doc, weg), true);
  assert.deepEqual(ids(doc), ['blijft', 'achter']);
  assert.equal(doc.undoStack.at(-1).type, 'removeTextEdit');

  const tekst = await opgeslagenTekst(doc);
  assert.match(tekst, /Blijvende regel/);
  assert.doesNotMatch(tekst, /Verwijderde regel/);
});

test('ongedaan maken zet het record terug op zijn plek, opnieuw uitvoeren haalt het weer weg', async () => {
  const doc = openen();
  voegTekstIn(doc, 'a', 'Eerste', 700);
  const weg = voegTekstIn(doc, 'b', 'Tweede', 650);
  voegTekstIn(doc, 'c', 'Derde', 600);
  verwijderTextEditRecord(doc, weg);

  await undo.undo();
  assert.deepEqual(ids(doc), ['a', 'b', 'c']);
  assert.equal(doc.textEdits[1].newText, 'Tweede');
  assert.match(await opgeslagenTekst(doc), /Tweede/);

  await undo.redo();
  assert.deepEqual(ids(doc), ['a', 'c']);
  assert.doesNotMatch(await opgeslagenTekst(doc), /Tweede/);
});

test('een onbekend record verwijderen doet niets en legt geen stap vast', () => {
  const doc = openen();
  voegTekstIn(doc, 'a', 'Eerste', 700);
  const stappen = doc.undoStack.length;
  assert.equal(verwijderTextEditRecord(doc, { id: 'onbekend' }), false);
  assert.deepEqual(ids(doc), ['a']);
  assert.equal(doc.undoStack.length, stappen);
});

test('text-edit-tool verwijdert records via de helper', () => {
  const bron = fs.readFileSync(new URL('./text-edit-tool.js', import.meta.url), 'utf8');
  const fn = bron.slice(bron.indexOf('function removeTextEditRecord('));
  assert.match(fn.slice(0, 300), /verwijderTextEditRecord\(getActiveDocument\(\), rec\)/);
});
