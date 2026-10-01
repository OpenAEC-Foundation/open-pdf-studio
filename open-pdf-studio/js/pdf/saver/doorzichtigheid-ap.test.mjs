// Doorzichtigheid in de appearance stream (#512).
//
// PDFium (ook in browsers) en MuPDF negeren /CA op een annotatie zodra die een
// appearance stream heeft: een onderlegger op 20% kwam daar op volle sterkte.
// Andere programma's schrijven daarom de alfa óók als ExtGState in de
// appearance (/CA 0.4 op de annotatie én `/GS gs` met CA/ca 0.4 in de stream).
// De app doet nu hetzelfde, voor elke annotatie op één plek.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import { zetDoorzichtigheidInAp } from './utils.js';
import { extractAnnotationColors } from '../loader/color-extraction.js';

const RECT = [100, 100, 200, 200];

function annotatieMetAp(doc, inhoud, resources = {}) {
  const ap = doc.context.stream(inhoud, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100], Resources: doc.context.obj(resources),
  });
  return doc.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: RECT, CA: 0.4,
    AP: doc.context.obj({ N: doc.context.register(ap) }),
  });
}

const nVan = (doc, annot) => doc.context.lookup(doc.context.lookup(annot.get(PDFName.of('AP'))).get(PDFName.of('N')));
const tekst = (stream) => Buffer.from(stream instanceof PDFRawStream
  ? decodePDFRawStream(stream).decode() : stream.getContents()).toString('latin1');
const extGState = (doc, stream) => doc.context.lookup(
  doc.context.lookup(stream.dict.get(PDFName.of('Resources'))).get(PDFName.of('ExtGState')));
const getal = (doc, dict, sleutel) => doc.context.lookup(dict.get(PDFName.of(sleutel))).asNumber();

test('een doorzichtige annotatie krijgt haar alfa in de appearance stream', async () => {
  const doc = await PDFDocument.create();
  const annot = annotatieMetAp(doc, '0 0 1 RG 0 0 m 10 10 l S');
  zetDoorzichtigheidInAp(doc.context, annot, 0.4);
  const n = nVan(doc, annot);
  assert.match(tekst(n), /^\/GSo gs\b/, 'de alfa staat vóór al het tekenwerk');
  assert.match(tekst(n), /0 0 1 RG 0 0 m 10 10 l S/, 'de oorspronkelijke inhoud blijft');
  const gs = doc.context.lookup(extGState(doc, n).get(PDFName.of('GSo')));
  assert.equal(getal(doc, gs, 'CA'), 0.4);
  assert.equal(getal(doc, gs, 'ca'), 0.4);
});

test('een aparte vul-alfa in dezelfde stream blijft staan', async () => {
  const doc = await PDFDocument.create();
  const gsf = doc.context.obj({ Type: 'ExtGState', ca: 0.2 });
  const annot = annotatieMetAp(doc, '/GSf gs 1 0 0 rg 0 0 10 10 re f', { ExtGState: doc.context.obj({ GSf: gsf }) });
  zetDoorzichtigheidInAp(doc.context, annot, 0.4);
  const n = nVan(doc, annot);
  const egs = extGState(doc, n);
  assert.ok(egs.get(PDFName.of('GSf')), 'GSf blijft');
  assert.ok(egs.get(PDFName.of('GSo')), 'GSo komt erbij');
  assert.match(tekst(n), /^\/GSo gs[\s\S]*\/GSf gs/);
});

test('volledig dekkend of zonder appearance verandert er niets', async () => {
  const doc = await PDFDocument.create();
  const annot = annotatieMetAp(doc, '0 0 m 1 1 l S');
  const voor = nVan(doc, annot);
  zetDoorzichtigheidInAp(doc.context, annot, 1);
  assert.equal(nVan(doc, annot), voor);
  const zonder = doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: RECT, CA: 0.4 });
  zetDoorzichtigheidInAp(doc.context, zonder, 0.4);
  assert.equal(zonder.get(PDFName.of('AP')), undefined);
});

async function heropend(doc, annot) {
  const pagina = doc.addPage([612, 792]);
  pagina.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  const terug = await PDFDocument.load(await doc.save());
  return (await extractAnnotationColors(1, terug)).get(RECT.join(','));
}

test('na heropenen is de algehele alfa geen aparte vul-alfa', async () => {
  const doc = await PDFDocument.create();
  const annot = annotatieMetAp(doc, '0 0 1 RG 0 0 m 10 10 l S');
  zetDoorzichtigheidInAp(doc.context, annot, 0.4);
  const extra = await heropend(doc, annot);
  assert.equal(extra.opacity, 0.4);
  assert.equal(extra.fillOpacity, undefined);
});

test('een echte aparte vul-alfa komt na heropenen wel terug', async () => {
  const doc = await PDFDocument.create();
  const gsf = doc.context.obj({ Type: 'ExtGState', ca: 0.2 });
  const annot = annotatieMetAp(doc, '/GSf gs 1 0 0 rg 0 0 10 10 re f', { ExtGState: doc.context.obj({ GSf: gsf }) });
  zetDoorzichtigheidInAp(doc.context, annot, 0.4);
  const extra = await heropend(doc, annot);
  assert.equal(extra.fillOpacity, 0.2);
});

// Een pijl tekent schacht en kop over elkaar. Per operatie de alfa zetten maakt
// de overlap donkerder; het scherm stelt de pijl daarom eerst als geheel samen.
// Als groep: de inhoud gaat ongewijzigd (alfa 1) in een transparantiegroep, en
// die wordt één keer met de alfa getekend.
test('als groep wordt de hele appearance in één keer met de alfa samengesteld', async () => {
  const doc = await PDFDocument.create();
  const annot = annotatieMetAp(doc, '0 0 1 RG 0 0 m 10 10 l S 0 0 1 rg 10 10 m 8 6 l 6 8 l h B');
  zetDoorzichtigheidInAp(doc.context, annot, 0.4, { alsGroep: true });
  const n = nVan(doc, annot);
  assert.match(tekst(n), /^\/GSo gs\s+\/OPSg Do\s*$/);
  const xo = doc.context.lookup(doc.context.lookup(n.dict.get(PDFName.of('Resources'))).get(PDFName.of('XObject')));
  const groep = doc.context.lookup(xo.get(PDFName.of('OPSg')));
  assert.equal(doc.context.lookup(groep.dict.get(PDFName.of('Group'))).get(PDFName.of('S')).asString(), '/Transparency');
  assert.match(tekst(groep), /0 0 m 10 10 l S/, 'de oorspronkelijke inhoud staat in de groep');
  assert.doesNotMatch(tekst(groep), /GSo/, 'binnen de groep geen alfa');
  const gs = doc.context.lookup(extGState(doc, n).get(PDFName.of('GSo')));
  assert.equal(getal(doc, gs, 'CA'), 0.4);
});
