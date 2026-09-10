// De rondgang van een vectorknipsel: schrijven, opslaan, heropenen, terugvinden.
// Dit is de test die telt — hij gebruikt het echte schrijfpad en het echte
// leespad, zonder de app ertussen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { bouwKnipselAppearance, CATALOGUS_SLEUTEL } from '../saver/vector-snippet.js';
import { leesKnipselBronnen, leesKnipselVelden } from './vector-snippet-load.js';
import { bewaar, bytesVan, leegmaken, sleutelVoor } from '../../annotations/vector-snippet-store.js';

const VAK = { left: 100, bottom: 80, right: 220, top: 140 };

async function bronBytes() {
  const d = await PDFDocument.create();
  const p = d.addPage([600, 400]);
  p.drawRectangle({ x: 100, y: 80, width: 120, height: 60 });
  return d.save();
}

/** Bouwt een document met één knipsel-stempel erop, precies zoals de saver dat doet. */
async function documentMetKnipsel({ rect = [50, 50, 290, 170], label = 'Bron.pdf, blad 1' } = {}) {
  const bytes = await bronBytes();
  const sleutel = sleutelVoor(bytes);
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([600, 600]);
  const gebouwd = await bouwKnipselAppearance(doc, { bronBytes: bytes, srcBox: VAK, rect, sleutel });

  const context = doc.context;
  const apStream = context.stream(gebouwd.content, {
    Type: 'XObject', Subtype: 'Form', BBox: rect,
    Matrix: [1, 0, 0, 1, -rect[0], -rect[1]],
    Resources: context.obj({ XObject: context.obj(gebouwd.xobjects) }),
  });
  const annot = context.obj({
    Type: 'Annot', Subtype: 'Stamp', Rect: rect,
    OPS_Subtype: PDFString.of('vectorSnippet'),
    OPS_SnippetKey: PDFString.of(sleutel),
    OPS_SrcBox: [VAK.left, VAK.bottom, VAK.right, VAK.top],
    OPS_SrcLabel: PDFString.of(label),
    AP: context.obj({ N: context.register(apStream) }),
  });
  pagina.node.set(PDFName.of('Annots'), context.obj([context.register(annot)]));
  return { bytes: await doc.save(), sleutel, brongrootte: bytes.length };
}

test('de bronpagina komt na heropenen terug in de store', async () => {
  leegmaken();
  const { bytes, sleutel, brongrootte } = await documentMetKnipsel();
  const heropend = await PDFDocument.load(bytes);
  const sleutels = await leesKnipselBronnen(heropend, bewaar);
  assert.deepEqual(sleutels, [sleutel], 'sleutel uit het bestand');
  assert.equal(bytesVan(sleutel).length, brongrootte, 'bytes ongewijzigd terug');
});

test('de knipsel-velden komen terug van de stempel', async () => {
  leegmaken();
  const { bytes, sleutel } = await documentMetKnipsel({ label: 'Barn - Elevations.pdf, blad 4' });
  const heropend = await PDFDocument.load(bytes);
  const annots = heropend.getPage(0).node.lookup(PDFName.of('Annots'));
  const annot = heropend.context.lookup(annots.get(0));
  const velden = await leesKnipselVelden(annot, heropend.context);
  assert.equal(velden.snippetKey, sleutel);
  assert.deepEqual(velden.srcBox, VAK);
  assert.equal(velden.srcLabel, 'Barn - Elevations.pdf, blad 4');
});

test('een gewone stempel zonder knipsel-sleutel levert niets op', async () => {
  const doc = await PDFDocument.create();
  const context = doc.context;
  const annot = context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [0, 0, 10, 10] });
  assert.equal(await leesKnipselVelden(annot, context), null);
});

test('een stempel met sleutel maar zonder vak wordt geweigerd', async () => {
  const doc = await PDFDocument.create();
  const context = doc.context;
  const annot = context.obj({
    Type: 'Annot', Subtype: 'Stamp', Rect: [0, 0, 10, 10],
    OPS_SnippetKey: PDFString.of('aaaabbbbccccdddd'),
  });
  assert.equal(await leesKnipselVelden(annot, context), null);
});

test('een document zonder knipsels geeft een lege lijst in plaats van een fout', async () => {
  leegmaken();
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const heropend = await PDFDocument.load(await doc.save());
  assert.deepEqual(await leesKnipselBronnen(heropend, bewaar), []);
});

test('de opgeslagen appearance verwijst echt naar het ingebedde knipsel', async () => {
  const { bytes } = await documentMetKnipsel();
  const heropend = await PDFDocument.load(bytes);
  const annots = heropend.getPage(0).node.lookup(PDFName.of('Annots'));
  const annot = heropend.context.lookup(annots.get(0));
  const ap = heropend.context.lookup(annot.get(PDFName.of('AP'))).get(PDFName.of('N'));
  const form = heropend.context.lookup(ap);
  const res = heropend.context.lookup(form.dict.get(PDFName.of('Resources')));
  const xobj = heropend.context.lookup(res.get(PDFName.of('XObject')));
  assert.equal(xobj.keys().length, 1, 'de appearance heeft het knipsel in zijn resources');
});

test('twee knipsels uit dezelfde bron leveren één bronstream in het bestand', async () => {
  const bytes = await bronBytes();
  const sleutel = sleutelVoor(bytes);
  const doc = await PDFDocument.create();
  doc.addPage([600, 600]);
  await bouwKnipselAppearance(doc, { bronBytes: bytes, srcBox: VAK, rect: [0, 0, 120, 60], sleutel });
  await bouwKnipselAppearance(doc, { bronBytes: bytes, srcBox: VAK, rect: [200, 200, 320, 260], sleutel });
  const heropend = await PDFDocument.load(await doc.save());
  const wb = heropend.catalog.lookup(PDFName.of(CATALOGUS_SLEUTEL));
  assert.equal(wb.keys().length, 1, 'ontdubbeld: één bronpagina voor twee knipsels');
});
