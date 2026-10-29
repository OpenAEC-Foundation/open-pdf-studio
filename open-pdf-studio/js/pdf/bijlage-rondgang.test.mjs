// Bijlage-annotaties (#376) door de echte lader en saver: laden van een
// bestand van een ander programma, verplaatsen, ander pictogram, opslaan,
// heropenen; een nieuwe annotatie; verwijderen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as mupdf from 'mupdf';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { bewaarBijlageInhoud, bijlageBytes } = await import('../annotations/bijlage-store.js');
const { cloneAnnotation } = await import('../annotations/factory.js');

const N = (n) => PDFName.of(n);
const tekst = (s) => new TextEncoder().encode(s);
const lees = (b) => new TextDecoder().decode(b);

/** Een blad met een bijlage-annotatie zoals MuPDF hem schrijft. */
function vreemdBlad() {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(-1, doc.addPage([0, 0, 400, 400], 0, {}, ''));
  const pagina = doc.loadPage(0);
  const annot = pagina.createAnnotation('FileAttachment');
  annot.setRect([50, 300, 70, 320]);
  annot.setContents('Wapeningsberekening');
  const datum = new Date('2026-08-15T10:00:00Z');
  annot.setFileSpec(doc.addEmbeddedFile('wapening.xlsx', 'application/vnd.ms-excel', tekst('PK-xlsx-inhoud'), datum, datum));
  annot.update();
  return doc.saveToBuffer('compress').asUint8Array();
}

async function leegBlad() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  return doc.save();
}

/** De modellen zoals js/pdf/loader.js ze aanmaakt. */
async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const modellen = [];
  for (const annot of await pagina.getAnnotations()) {
    const m = await convertPdfAnnotation(annot, 1, viewport, new Map(), kaart);
    if (m) modellen.push(m);
  }
  await doc.loadingTask.destroy();
  return modellen;
}

async function opslaan(bronBytes, modellen) {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { uit = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { uit = bytes; return true; },
    },
  };
  state.documents = [{
    id: 'bijlage', filePath: 'C:/bijlage/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [],
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/bijlage/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return uit;
}

function bijlageAnnots(pdf) {
  const annots = pdf.getPage(0).node.Annots();
  return (annots ? annots.asArray() : []).map((r) => pdf.context.lookup(r))
    .filter((d) => d.lookup(N('Subtype'))?.toString() === '/FileAttachment');
}

test('an attachment annotation from another tool loads with its file', async () => {
  const [ann] = await laad(vreemdBlad());
  assert.equal(ann.type, 'fileAttachment');
  assert.equal(ann.attachment.name, 'wapening.xlsx');
  assert.equal(ann.attachment.mime, 'application/vnd.ms-excel');
  assert.equal(ann.text, 'Wapeningsberekening');
  assert.equal(ann.subject, '', 'Contents is the note, not duplicated as subject');
  assert.equal(lees(bijlageBytes(ann.attachment.key)), 'PK-xlsx-inhoud');
  // MuPDF rekent met y omlaag: [50 300 70 320] is /Rect [50 80 70 100], in
  // de app (y omlaag vanaf de bovenkant) weer y = 300.
  assert.deepEqual([ann.x, ann.y, ann.width, ann.height], [50, 300, 20, 20]);
  // Het model blijft JSON: de bytes zitten niet in de annotatie.
  assert.deepEqual(cloneAnnotation(ann).attachment, ann.attachment);
});

test('moved, re-iconed and saved: one annotation, same file, readable by other readers', async () => {
  const bron = vreemdBlad();
  const modellen = await laad(bron);
  modellen[0].x += 100;
  modellen[0].icon = 'tag';
  modellen[0].text = 'Nieuwe beschrijving';
  const bytes = await opslaan(bron, modellen);

  const pdf = await PDFDocument.load(bytes);
  const annots = bijlageAnnots(pdf);
  assert.equal(annots.length, 1, 'no duplicate');
  const d = annots[0];
  assert.deepEqual(d.lookup(N('Rect')).asArray().map((n) => n.asNumber()), [150, 80, 170, 100]);
  assert.equal(d.lookup(N('Name')).toString(), '/Tag');
  assert.equal(d.lookup(N('Contents')).decodeText(), 'Nieuwe beschrijving');

  const doc = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
  const [ma] = doc.loadPage(0).getAnnotations();
  assert.equal(ma.getType(), 'FileAttachment');
  assert.equal(lees(doc.getEmbeddedFileContents(ma.getFileSpec()).asUint8Array()), 'PK-xlsx-inhoud');
  assert.equal(doc.getFilespecParams(ma.getFileSpec()).filename, 'wapening.xlsx');

  // En de app leest het weer zoals het was.
  const [terug] = await laad(bytes);
  assert.equal(terug.icon, 'tag');
  assert.equal(terug.attachment.name, 'wapening.xlsx');
  assert.equal(lees(bijlageBytes(terug.attachment.key)), 'PK-xlsx-inhoud');
  assert.equal(terug.attachment.createdAt, '2026-08-15T10:00:00.000Z');
});

test('a new attachment annotation is saved with its file and reopened', async () => {
  const bron = await leegBlad();
  const nu = '2026-10-27T12:00:00.000Z';
  const ann = {
    id: 'nieuw1', type: 'fileAttachment', page: 1, x: 20, y: 30, width: 24, height: 24,
    text: 'model.ifc', color: '#2B579A', icon: 'paperclip', opacity: 1, author: 'Tester',
    createdAt: nu, modifiedAt: nu, locked: false, printable: true,
    attachment: {
      key: bewaarBijlageInhoud({ bytes: tekst('ISO-10303-21;\nDATA;') }), name: 'model.ifc', description: 'IFC-model',
      mime: 'application/x-step', size: 19, createdAt: nu, modifiedAt: nu, relationship: null, pdfjsId: null,
    },
  };
  const bytes = await opslaan(bron, [ann]);

  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const [a] = await (await pdfjs.getPage(1)).getAnnotations();
    assert.equal(a.subtype, 'FileAttachment');
    assert.equal(a.file.filename, 'model.ifc');
    assert.equal(a.file.description, 'IFC-model');
    assert.equal(lees(await pdfjs.getAttachmentContent(a.fileId)), 'ISO-10303-21;\nDATA;');
  } finally {
    await pdfjs.loadingTask.destroy();
  }
  const [terug] = await laad(bytes);
  assert.equal(terug.type, 'fileAttachment');
  assert.equal(terug.author, 'Tester');
  assert.deepEqual([terug.x, terug.y, terug.width, terug.height], [20, 30, 24, 24]);
  assert.equal(terug.attachment.description, 'IFC-model');
  assert.equal(terug.attachment.size, 19);
  assert.equal(lees(bijlageBytes(terug.attachment.key)), 'ISO-10303-21;\nDATA;');
});

test('a deleted attachment annotation leaves no annotation and no file behind', async () => {
  const bron = vreemdBlad();
  await laad(bron);
  const bytes = await opslaan(bron, []);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(bijlageAnnots(pdf).length, 0);
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
  // Ook de popup die MuPDF bij de annotatie maakte, is weg.
  assert.equal(doc.loadPage(0).getAnnotations().length, 0);
  // Ook de ingesloten stroom is opgeruimd.
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    assert.notEqual(obj?.dict?.lookup?.(N('Type'))?.toString(), '/EmbeddedFile');
  }
});

test('without content in the store, the saver falls back to pdf.js and keeps the file', async () => {
  const bron = vreemdBlad();
  const [ann] = await laad(bron);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bron.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const [a] = await (await doc.getPage(1)).getAnnotations();
  ann.attachment.key = null;
  ann.attachment.pdfjsId = a.fileId;
  let uit = null;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bron,
    writeBinaryFile: (_p, b) => { uit = b; return true; },
    writeBinaryFileAtomic: (_p, b) => { uit = b; return true; },
  } };
  state.documents = [{
    id: 'terugval', filePath: 'C:/bijlage/bron.pdf', pdfDoc: doc, annotations: [ann],
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [],
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/bijlage/uit.pdf', { zonderHandtekeningVraag: true }), true);
  await doc.loadingTask.destroy();
  const [terug] = await laad(uit);
  assert.equal(lees(bijlageBytes(terug.attachment.key)), 'PK-xlsx-inhoud');
  assert.ok(ann.attachment.key, 'the content is now in the store');
});

/**
 * Een blad van een ander programma waarvan de bestandsspecificatie meer
 * draagt dan de app kent (/CI en een eigen sleutel), met een eigen /AP.
 */
async function blad_metExtraSleutels() {
  const pdf = await PDFDocument.load(vreemdBlad());
  const [annot] = bijlageAnnots(pdf);
  const fs = annot.lookup(N('FS'));
  fs.set(N('CI'), pdf.context.obj({ Type: 'CollectionItem', Status: 'Approved' }));
  fs.set(N('VendorKey'), pdf.context.obj(42));
  return pdf.save();
}

/** Laden, en dan de inhoud onleesbaar maken: niet in de store en geen pdf.js-terugval. */
async function laadZonderInhoud(bron) {
  const modellen = await laad(bron);
  for (const m of modellen) {
    m.attachment.key = null;
    m.attachment.pdfjsId = null;
  }
  return modellen;
}

function ingeslotenBestand(bytes) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
  const [ma] = doc.loadPage(0).getAnnotations();
  return lees(doc.getEmbeddedFileContents(ma.getFileSpec()).asUint8Array());
}

test('unreadable content, not edited: the original annotation stays as it was', async () => {
  const bron = await blad_metExtraSleutels();
  const voor = bijlageAnnots(await PDFDocument.load(bron))[0];
  const apVoor = voor.lookup(N('AP')).toString();
  const modellen = await laadZonderInhoud(bron);
  const bytes = await opslaan(bron, modellen);

  const pdf = await PDFDocument.load(bytes);
  const annots = bijlageAnnots(pdf);
  assert.equal(annots.length, 1, 'no duplicate');
  const d = annots[0];
  const fs = d.lookup(N('FS'));
  assert.ok(fs.lookup(N('EF')), 'the embedded file is still there');
  assert.equal(fs.lookup(N('VendorKey')).asNumber(), 42, 'unknown file specification keys are kept');
  assert.equal(fs.lookup(N('CI')).lookup(N('Status')).toString(), '/Approved');
  assert.equal(d.lookup(N('AP')).toString(), apVoor, 'the original appearance is kept');
  assert.equal(ingeslotenBestand(bytes), 'PK-xlsx-inhoud');
  // Ook de popup van het origineel blijft bij zijn annotatie.
  const popups = pdf.getPage(0).node.Annots().asArray().map((r) => pdf.context.lookup(r))
    .filter((x) => x.lookup(N('Subtype'))?.toString() === '/Popup');
  const eigenRef = pdf.getPage(0).node.Annots().asArray().find((r) => pdf.context.lookup(r) === d);
  assert.equal(popups.length, 1, 'the popup MuPDF made is kept');
  assert.equal(popups[0].get(N('Parent')), eigenRef);
});

test('readable content, not edited: the original annotation stays as it was', async () => {
  const bron = await blad_metExtraSleutels();
  const voor = bijlageAnnots(await PDFDocument.load(bron))[0];
  const apVoor = voor.lookup(N('AP')).toString();
  const modellen = await laad(bron);
  assert.equal(lees(bijlageBytes(modellen[0].attachment.key)), 'PK-xlsx-inhoud', 'the content is readable');
  const bytes = await opslaan(bron, modellen);

  const pdf = await PDFDocument.load(bytes);
  const annots = bijlageAnnots(pdf);
  assert.equal(annots.length, 1, 'no duplicate');
  const fs = annots[0].lookup(N('FS'));
  assert.equal(fs.lookup(N('VendorKey'))?.asNumber(), 42, 'unknown file specification keys are kept');
  assert.equal(fs.lookup(N('CI'))?.lookup(N('Status'))?.toString(), '/Approved', 'the collection item is kept');
  assert.equal(annots[0].lookup(N('AP')).toString(), apVoor, 'the original appearance is kept');
  assert.equal(ingeslotenBestand(bytes), 'PK-xlsx-inhoud');
});

test('unreadable content, edited: the new annotation keeps the original file specification', async () => {
  const bron = await blad_metExtraSleutels();
  const modellen = await laadZonderInhoud(bron);
  modellen[0].x += 100;
  modellen[0].icon = 'tag';
  const bytes = await opslaan(bron, modellen);

  const pdf = await PDFDocument.load(bytes);
  const annots = bijlageAnnots(pdf);
  assert.equal(annots.length, 1);
  const d = annots[0];
  assert.deepEqual(d.lookup(N('Rect')).asArray().map((n) => n.asNumber()), [150, 80, 170, 100]);
  assert.equal(d.lookup(N('Name')).toString(), '/Tag');
  const fs = d.lookup(N('FS'));
  assert.ok(fs.lookup(N('EF')), 'the embedded file is still there');
  assert.equal(fs.lookup(N('VendorKey')).asNumber(), 42);
  assert.equal(ingeslotenBestand(bytes), 'PK-xlsx-inhoud');
});

test('a copy of an unedited attachment with unreadable content does not take the original twice', async () => {
  const bron = await blad_metExtraSleutels();
  const [ann] = await laadZonderInhoud(bron);
  const kopie = { ...cloneAnnotation(ann), id: 'kopie' };
  const bytes = await opslaan(bron, [ann, kopie]);
  const pdf = await PDFDocument.load(bytes);
  const annots = bijlageAnnots(pdf);
  assert.equal(annots.length, 2);
  assert.notEqual(annots[0], annots[1]);
  for (const d of annots) assert.ok(d.lookup(N('FS')).lookup(N('EF')), 'both keep the embedded file');
});
