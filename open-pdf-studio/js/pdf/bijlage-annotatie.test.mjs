// Bijlagen volgens de PDF-specificatie (#376): wat de app schrijft, lezen
// pdf-lib, pdf.js en MuPDF; wat een ander programma schrijft (ook een naamboom
// met /Kids), leest en verwijdert de app.

import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString, PDFString, PDFRawStream, PDFStream,
} from 'pdf-lib';
import * as mupdf from 'mupdf';
import { pasBijlagenToe, leesBijlageNamen, leesBestandsspecificatie, metToegevoegd, metVerwijderd } from './bijlagen.js';
import { bouwBijlageAnnotatie, leesBijlageAnnotatie } from './bijlage-annotatie.js';
import { bijlageIcoonContent, bijlageIcoonUitPdf, bijlageIcoonNaarPdf, BIJLAGE_ICONEN } from '../annotations/bijlage-iconen.js';

const N = (n) => PDFName.of(n);
const tekst = (s) => new TextEncoder().encode(s);
const lees = (b) => new TextDecoder().decode(b);
const leeg = { toegevoegd: [], verwijderd: [] };

async function pdfMetBijlage(bijlage) {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 300]);
  pasBijlagenToe(pdf, metToegevoegd(leeg, bijlage));
  return pdf.save();
}

async function pdfMetBijlageAnnotatie(p) {
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([300, 300]);
  const dict = bouwBijlageAnnotatie(pdf, { tekstObj: (s) => PDFHexString.fromText(s), ...p });
  pagina.node.set(N('Annots'), pdf.context.obj([pdf.context.register(dict)]));
  return pdf.save();
}

function mupdfDoc(bytes) {
  return mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
}

test('a document attachment has the structure of the specification (pdf-lib)', async () => {
  const bytes = await pdfMetBijlage({
    naam: 'rapport.txt', bytes: tekst('berekening'), mime: 'text/plain', beschrijving: 'Berekening',
    aangemaakt: '2026-10-01T08:00:00Z', gewijzigd: '2026-10-02T09:30:00Z',
  });
  const pdf = await PDFDocument.load(bytes);
  const ctx = pdf.context;
  const ef = pdf.catalog.lookup(N('Names')).lookup(N('EmbeddedFiles'));
  const namen = ef.lookup(N('Names'));
  assert.ok(namen instanceof PDFArray);
  assert.equal(namen.lookup(0).decodeText(), 'rapport.txt');
  const fs = namen.lookup(1);
  assert.equal(fs.lookup(N('Type')).toString(), '/Filespec');
  assert.equal(fs.lookup(N('UF')).decodeText(), 'rapport.txt');
  // /F: een bytestring, in ASCII zonder UTF-16-BOM.
  assert.equal(fs.lookup(N('F')).decodeText(), 'rapport.txt');
  assert.equal(fs.lookup(N('F')).asBytes()[0], 'r'.charCodeAt(0));
  assert.equal(fs.lookup(N('Desc')).decodeText(), 'Berekening');
  const stroom = fs.lookup(N('EF')).lookup(N('F'));
  assert.ok(stroom instanceof PDFStream);
  assert.equal(stroom, fs.lookup(N('EF')).lookup(N('UF')));
  assert.equal(stroom.dict.lookup(N('Type')).toString(), '/EmbeddedFile');
  assert.equal(stroom.dict.lookup(N('Subtype')).decodeText(), 'text/plain');
  const params = stroom.dict.lookup(N('Params'));
  assert.equal(params.lookup(N('Size')).asNumber(), 10);
  assert.ok(params.lookup(N('CreationDate')));
  assert.ok(params.lookup(N('ModDate')));
  // Het bestand is geassocieerd met het document (/AF, PDF 2.0 / PDF/A-3).
  assert.equal(ctx.lookup(pdf.catalog.lookup(N('AF')).get(0)), fs);
  // En terug te lezen.
  const gelezen = leesBestandsspecificatie(ctx, namen.get(1));
  assert.equal(lees(gelezen.bytes), 'berekening');
  assert.equal(gelezen.mime, 'text/plain');
  assert.equal(gelezen.grootte, 10);
  assert.equal(gelezen.aangemaakt, '2026-10-01T08:00:00.000Z');
  assert.equal(gelezen.gewijzigd, '2026-10-02T09:30:00.000Z');
});

test('MuPDF lists and extracts a document attachment written by the app', async () => {
  const bytes = await pdfMetBijlage({ naam: 'model.ifc', bytes: tekst('ISO-10303-21;'), mime: 'application/x-step', beschrijving: 'IFC-model' });
  const doc = mupdfDoc(bytes);
  const lijst = doc.getEmbeddedFiles();
  assert.deepEqual(Object.keys(lijst), ['model.ifc']);
  const fs = lijst['model.ifc'];
  assert.equal(doc.isEmbeddedFile(fs), true);
  assert.equal(lees(doc.getEmbeddedFileContents(fs).asUint8Array()), 'ISO-10303-21;');
  const params = doc.getFilespecParams(fs);
  assert.equal(params.filename, 'model.ifc');
  assert.equal(params.mimetype, 'application/x-step');
});

test('a file attachment annotation is written per the specification and read by pdf.js and MuPDF', async () => {
  const bytes = await pdfMetBijlageAnnotatie({
    rect: [40, 200, 64, 224], icoon: 'paperclip', kleur: '#2B579A', tekst: 'Zie berekening',
    bestand: { naam: 'calc.csv', bytes: tekst('a;b\n1;2\n'), mime: 'text/csv', beschrijving: 'Berekening' },
  });

  // pdf-lib: de structuur.
  const pdf = await PDFDocument.load(bytes);
  const ctx = pdf.context;
  const annot = ctx.lookup(pdf.getPage(0).node.Annots().get(0));
  assert.equal(annot.lookup(N('Subtype')).toString(), '/FileAttachment');
  assert.equal(annot.lookup(N('Name')).toString(), '/Paperclip');
  assert.equal(annot.lookup(N('Contents')).decodeText(), 'Zie berekening');
  const fs = annot.lookup(N('FS'));
  assert.equal(fs.lookup(N('Type')).toString(), '/Filespec');
  assert.ok(fs.lookup(N('EF')).lookup(N('F')) instanceof PDFStream);
  assert.equal(ctx.lookup(annot.lookup(N('AF')).get(0)), fs);
  assert.ok(ctx.lookup(annot.lookup(N('AP')).get(N('N'))) instanceof PDFStream, 'own appearance');
  // Annotatiebijlagen horen niet in de naamboom van het document.
  assert.deepEqual(leesBijlageNamen(pdf), []);
  const terug = leesBijlageAnnotatie(ctx, annot);
  assert.equal(terug.icoon, 'paperclip');
  assert.equal(terug.bestand.naam, 'calc.csv');
  assert.equal(terug.bestand.beschrijving, 'Berekening');
  assert.equal(lees(terug.bestand.bytes), 'a;b\n1;2\n');

  // pdf.js: soort, bestandsnaam en inhoud.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const [a] = await (await pdfjs.getPage(1)).getAnnotations();
    assert.equal(a.subtype, 'FileAttachment');
    assert.equal(a.file.filename, 'calc.csv');
    assert.equal(a.name, 'Paperclip');
    assert.equal(lees(await pdfjs.getAttachmentContent(a.fileId)), 'a;b\n1;2\n');
  } finally {
    await pdfjs.loadingTask.destroy();
  }

  // MuPDF: de annotatie en haar bestand.
  const doc = mupdfDoc(bytes);
  const [ma] = doc.loadPage(0).getAnnotations();
  assert.equal(ma.getType(), 'FileAttachment');
  const mfs = ma.getFileSpec();
  assert.equal(doc.isEmbeddedFile(mfs), true);
  assert.equal(lees(doc.getEmbeddedFileContents(mfs).asUint8Array()), 'a;b\n1;2\n');
  assert.equal(doc.getFilespecParams(mfs).filename, 'calc.csv');
});

test('attachments written by MuPDF are listed and extracted', async () => {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(-1, doc.addPage([0, 0, 300, 300], 0, {}, ''));
  const datum = new Date('2026-09-01T12:00:00Z');
  const efs = doc.addEmbeddedFile('tekening.dwg', 'application/acad', tekst('AC1027'), datum, datum);
  doc.insertEmbeddedFile('tekening.dwg', efs);
  const pagina = doc.loadPage(0);
  const annot = pagina.createAnnotation('FileAttachment');
  annot.setRect([20, 20, 40, 40]);
  annot.setFileSpec(doc.addEmbeddedFile('foto.jpg', 'image/jpeg', tekst('JFIF'), datum, datum));
  annot.update();
  const bytes = doc.saveToBuffer('compress').asUint8Array();

  const pdf = await PDFDocument.load(bytes);
  assert.deepEqual(leesBijlageNamen(pdf), ['tekening.dwg']);
  const ef = pdf.catalog.lookup(N('Names')).lookup(N('EmbeddedFiles'));
  const namen = [];
  const verzamel = (k) => {
    const n = k.lookup(N('Names'));
    if (n) for (let i = 0; i < n.size(); i += 2) namen.push(n.get(i + 1));
    const kids = k.lookup(N('Kids'));
    if (kids) for (let i = 0; i < kids.size(); i++) verzamel(kids.lookup(i));
  };
  verzamel(ef);
  const doc1 = leesBestandsspecificatie(pdf.context, namen[0]);
  assert.equal(doc1.naam, 'tekening.dwg');
  assert.equal(lees(doc1.bytes), 'AC1027');
  assert.equal(doc1.mime, 'application/acad');
  assert.equal(doc1.aangemaakt, '2026-09-01T12:00:00.000Z');

  const annotDict = pdf.context.lookup(pdf.getPage(0).node.Annots().get(0));
  const terug = leesBijlageAnnotatie(pdf.context, annotDict);
  assert.equal(terug.bestand.naam, 'foto.jpg');
  assert.equal(lees(terug.bestand.bytes), 'JFIF');
  // MuPDF schrijft een /Name of niet; zonder /Name is het de punaise (spec).
  assert.ok(BIJLAGE_ICONEN.includes(terug.icoon));
});

// Een naamboom zoals grotere documenten hem hebben: een wortel met /Kids,
// bladen met /Limits, PDFDocEncoding-sleutels, een bestandsspecificatie met
// alleen /F en een ongecomprimeerde stroom zonder /Params.
async function pdfMetNaamboomKids() {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const ctx = pdf.context;
  const spec = (naam, inhoud, alleenF = false) => {
    const stroom = ctx.register(PDFRawStream.of(ctx.obj({ Type: 'EmbeddedFile', Length: inhoud.length }), tekst(inhoud)));
    return ctx.register(ctx.obj(alleenF
      ? { Type: 'Filespec', F: PDFString.of(naam), EF: { F: stroom } }
      : { Type: 'Filespec', F: PDFString.of(naam), UF: PDFHexString.fromText(naam), EF: { F: stroom }, Desc: PDFString.of(`over ${naam}`) }));
  };
  const blad1 = ctx.register(ctx.obj({
    Limits: [PDFString.of('a.txt'), PDFString.of('b.txt')],
    Names: [PDFString.of('a.txt'), spec('a.txt', 'AAA'), PDFString.of('b.txt'), spec('b.txt', 'BBB', true)],
  }));
  const blad2 = ctx.register(ctx.obj({
    Limits: [PDFString.of('c.txt'), PDFString.of('c.txt')],
    Names: [PDFString.of('c.txt'), spec('sub/dir/c.txt', 'CCC')],
  }));
  const midden = ctx.register(ctx.obj({ Kids: [blad2], Limits: [PDFString.of('c.txt'), PDFString.of('c.txt')] }));
  const wortel = ctx.register(ctx.obj({ Kids: [blad1, midden] }));
  pdf.catalog.set(N('Names'), ctx.obj({ EmbeddedFiles: wortel }));
  return pdf.save();
}

test('a nested name tree with /Kids from another tool is listed and extracted', async () => {
  const bytes = await pdfMetNaamboomKids();
  const pdf = await PDFDocument.load(bytes);
  assert.deepEqual(leesBijlageNamen(pdf), ['a.txt', 'b.txt', 'c.txt']);

  // Zoals het paneel ze ziet (pdf.js) met inhoud.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const lijst = await pdfjs.getAttachments();
    const namen = [...(lijst instanceof Map ? lijst.keys() : Object.keys(lijst))];
    assert.deepEqual(namen.sort(), ['a.txt', 'b.txt', 'c.txt']);
    assert.equal(lees(await pdfjs.getAttachmentContent('c.txt')), 'CCC');
    assert.equal(lees(await pdfjs.getAttachmentContent('b.txt')), 'BBB');
  } finally {
    await pdfjs.loadingTask.destroy();
  }

  // De lezer van de app: /F zonder /UF, een pad wordt de bestandsnaam.
  const ef = pdf.catalog.lookup(N('Names')).lookup(N('EmbeddedFiles'));
  const blad1 = ef.lookup(N('Kids')).lookup(0);
  const b = leesBestandsspecificatie(pdf.context, blad1.lookup(N('Names')).get(3));
  assert.equal(b.naam, 'b.txt');
  assert.equal(lees(b.bytes), 'BBB');
  assert.equal(b.grootte, 3);
  const blad2 = ef.lookup(N('Kids')).lookup(1).lookup(N('Kids')).lookup(0);
  const c = leesBestandsspecificatie(pdf.context, blad2.lookup(N('Names')).get(1));
  assert.equal(c.naam, 'c.txt');
  assert.equal(c.beschrijving, 'over sub/dir/c.txt');
});

test('removing from a nested name tree keeps the others and MuPDF still reads them', async () => {
  const pdf = await PDFDocument.load(await pdfMetNaamboomKids());
  assert.equal(pasBijlagenToe(pdf, metVerwijderd(leeg, 'b.txt')), true);
  const bytes = await pdf.save();
  const heropend = await PDFDocument.load(bytes);
  assert.deepEqual(leesBijlageNamen(heropend), ['a.txt', 'c.txt']);
  // De inhoud van het verwijderde bestand staat niet meer in het bestand.
  assert.equal(lees(bytes).includes('BBB'), false);
  const doc = mupdfDoc(bytes);
  const lijst = doc.getEmbeddedFiles();
  assert.deepEqual(Object.keys(lijst).sort(), ['a.txt', 'c.txt']);
  assert.equal(lees(doc.getEmbeddedFileContents(lijst['c.txt']).asUint8Array()), 'CCC');
});

test('an undecodable stream travels back unchanged with its own filter', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const ctx = pdf.context;
  // /JBIG2Decode kan pdf-lib niet decoderen.
  const ruweBytes = new Uint8Array([1, 2, 3, 4, 5]);
  const stroom = ctx.register(PDFRawStream.of(ctx.obj({ Type: 'EmbeddedFile', Filter: 'JBIG2Decode', Length: 5 }), ruweBytes));
  const fs = ctx.obj({ Type: 'Filespec', F: PDFString.of('scan.bin'), EF: { F: stroom } });
  const gelezen = leesBestandsspecificatie(ctx, fs);
  assert.equal(gelezen.bytes, undefined);
  assert.deepEqual([...gelezen.ruw.bytes], [1, 2, 3, 4, 5]);
  assert.equal(gelezen.ruw.filter, 'JBIG2Decode');

  const bytes = await pdfMetBijlageAnnotatie({ rect: [0, 0, 20, 20], bestand: { naam: 'scan.bin', ruw: gelezen.ruw } });
  const terug = await PDFDocument.load(bytes);
  const annot = terug.context.lookup(terug.getPage(0).node.Annots().get(0));
  const s = annot.lookup(N('FS')).lookup(N('EF')).lookup(N('F'));
  assert.equal(s.dict.lookup(N('Filter')).toString(), '/JBIG2Decode');
  assert.deepEqual([...s.getContents()], [1, 2, 3, 4, 5]);
});

test('a /FS that is a plain string (external file) is read as a name only', async () => {
  const pdf = await PDFDocument.create();
  const g = leesBestandsspecificatie(pdf.context, PDFString.of('C:\\\\projecten\\\\plan.pdf'));
  assert.equal(g.naam, 'plan.pdf');
  assert.equal(g.extern, true);
  assert.equal(g.bytes, undefined);
});

test('icons: the four names of the specification, unknown becomes the paperclip', () => {
  assert.deepEqual(BIJLAGE_ICONEN, ['paperclip', 'pushpin', 'graph', 'tag']);
  for (const icoon of BIJLAGE_ICONEN) assert.equal(bijlageIcoonUitPdf(bijlageIcoonNaarPdf(icoon)), icoon);
  assert.equal(bijlageIcoonUitPdf('PushPin'), 'pushpin');
  assert.equal(bijlageIcoonUitPdf('Onbekend'), 'paperclip');
  for (const icoon of BIJLAGE_ICONEN) {
    const inhoud = bijlageIcoonContent(icoon, 24, 24, '#ff0000');
    assert.match(inhoud, /^q\n/);
    assert.match(inhoud, /1 0 0 RG/);
    assert.match(inhoud, /\nQ$/);
    assert.doesNotMatch(inhoud, /NaN|undefined/);
  }
});

test('the appearance of an attachment annotation is a form XObject with a BBox of the rect size', async () => {
  const bytes = await pdfMetBijlageAnnotatie({ rect: [100, 100, 120, 130], icoon: 'tag', bestand: { naam: 'x.txt', bytes: tekst('x') } });
  const pdf = await PDFDocument.load(bytes);
  const annot = pdf.context.lookup(pdf.getPage(0).node.Annots().get(0));
  const ap = pdf.context.lookup(annot.lookup(N('AP')).get(N('N')));
  assert.deepEqual(ap.dict.lookup(N('BBox')).asArray().map((n) => n.asNumber()), [0, 0, 20, 30]);
  assert.equal(ap.dict.lookup(N('Subtype')).toString(), '/Form');
  assert.ok(annot.lookup(N('M')) instanceof PDFString);
  assert.ok(annot instanceof PDFDict);
});

test('closing a document releases its attachment content, unless another document or the clipboard uses it', async () => {
  const store = await import('../annotations/bijlage-store.js');
  store.wisBijlageStore();
  const eigen = store.bewaarBijlageInhoud({ bytes: new Uint8Array([1]) });
  const gedeeld = store.bewaarBijlageInhoud({ bytes: new Uint8Array([2]) });
  const klembord = store.bewaarBijlageInhoud({ bytes: new Uint8Array([3]) });
  const inUndo = store.bewaarBijlageInhoud({ bytes: new Uint8Array([4]) });
  const los = store.bewaarBijlageInhoud({ bytes: new Uint8Array([5]) });
  const ann = (key) => ({ type: 'fileAttachment', attachment: { key } });
  const dicht = {
    annotations: [ann(eigen), ann(gedeeld), ann(klembord)],
    undoStack: [{ type: 'delete', annotation: ann(inUndo) }],
  };
  const open = [{ annotations: [ann(gedeeld)], undoStack: [] }];
  assert.equal(store.geefBijlagenVrij(dicht, open, [ann(klembord), null]), 2);
  assert.equal(store.bijlageItem(eigen), null);
  assert.equal(store.bijlageItem(inUndo), null, 'also what only its undo history held');
  assert.ok(store.bijlageItem(gedeeld), 'still used by an open document');
  assert.ok(store.bijlageItem(klembord), 'still on the clipboard');
  assert.ok(store.bijlageItem(los), 'content no document refers to is not touched');
  store.wisBijlageStore();
});

test('geefDocumentVrij releases the attachment content of the closed document', () => {
  const release = readFileSync(new URL('./document-release.js', import.meta.url), 'utf8');
  assert.match(release, /geefBijlagenVrij\(gesloten, overgebleven, klembord\)/);
  const tabs = readFileSync(new URL('../ui/chrome/tabs.js', import.meta.url), 'utf8');
  assert.match(tabs, /geefDocumentVrij\(doc, state\.documents, \{\s*klembord: \[state\.clipboardAnnotation, state\.clipboardAnnotations\],?\s*\}\)/);
});

test('the origin of a loaded attachment: edited or not, and where the original is', async () => {
  const { bijlageBron, bijlageBewerkt, origineleBijlage } = await import('./bijlage-annotatie.js');
  const pdf = await PDFDocument.create();
  const c = pdf.context;
  const fsRef = c.register(c.obj({ Type: 'Filespec', EF: { F: c.register(c.stream('x', { Type: 'EmbeddedFile' })) } }));
  const annRef = c.register(c.obj({ Type: 'Annot', Subtype: 'FileAttachment', FS: fsRef, NM: PDFString.of('nm-1') }));
  const model = { type: 'fileAttachment', x: 10, y: 20, width: 24, height: 24, text: 'a', attachment: { key: null, name: 'a.txt' } };
  model.attachment.bron = bijlageBron(model, `${annRef.objectNumber}R`, `${fsRef.objectNumber}R`);
  assert.equal(bijlageBewerkt(model), false);
  assert.equal(bijlageBewerkt({ ...model, x: 11 }), true);
  assert.equal(bijlageBewerkt({ ...model, attachment: { ...model.attachment, description: 'nieuw' } }), true);
  assert.equal(bijlageBewerkt({ ...model, attachment: { ...model.attachment, key: 'k', pdfjsId: 'p' } }), false,
    'the content key is not an edit');
  assert.equal(bijlageBewerkt({ type: 'fileAttachment', attachment: { name: 'n' } }), true, 'new counts as edited');

  assert.deepEqual(origineleBijlage(c, [annRef], model), { ref: annRef, fs: fsRef });
  // Op /NM als het objectnummer niet meer klopt.
  const opNaam = { ...model, nm: 'nm-1', attachment: { ...model.attachment, bron: { ...model.attachment.bron, ref: '999R' } } };
  assert.equal(origineleBijlage(c, [annRef], opNaam).ref, annRef);
  // De annotatie is weg: nog wel de bestandsspecificatie met /EF.
  assert.deepEqual(origineleBijlage(c, [], model), { ref: null, fs: fsRef });
  assert.equal(origineleBijlage(c, [annRef], { ...model, attachment: { name: 'a.txt' } }), null, 'new: no original');
});
