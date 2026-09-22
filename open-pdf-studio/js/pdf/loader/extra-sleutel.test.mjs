// De extra gegevens van een annotatie terugvinden, ook als de lezer de /Rect
// anders aanlevert dan hij in het bestand staat.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';

import { extractAnnotationColors } from './color-extraction.js';
import { zoekExtraKleuren } from './extra-sleutel.js';
import { onzichtbaarVlakUitExtra } from './geen-rand.js';

/** De extra-gegevens-kaart van één blad, uit echte PDF-bytes. */
async function kaartVan(rect, dict) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([1191, 1684]);
  const annotDict = doc.context.obj({ Type: 'Annot', Rect: rect, ...dict });
  pagina.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annotDict)]));
  const heropend = await PDFDocument.load(await doc.save());
  return extractAnnotationColors(1, heropend);
}

test('gewone /Rect: exacte sleutel', async () => {
  const kaart = await kaartVan([100, 100, 300, 200], { Subtype: 'Square', IC: [0, 1, 0] });
  assert.equal(zoekExtraKleuren(kaart, [100, 100, 300, 200])?.ic, '#00ff00');
});

test('omgekeerde /Rect: de lezer normaliseert, de sleutel is de rauwe', async () => {
  // Zo schrijft een tekenpakket zijn vlakken weg: [rechts onder links boven].
  const kaart = await kaartVan([543, 899, 483, 927], { Subtype: 'Square', F: 64, Border: [0, 0, 0] });
  assert.deepEqual([...kaart.keys()], ['543,899,483,927'], 'sleutel komt uit de rauwe /Rect');
  // De lezer geeft de annotatie met genormaliseerde hoeken door.
  const extra = zoekExtraKleuren(kaart, [483, 899, 543, 927]);
  assert.ok(extra, 'extra gegevens niet gevonden');
  assert.equal(extra.borderWidth, 0);
  assert.equal(onzichtbaarVlakUitExtra(extra), true, 'onzichtbaar vlak (#435)');
});

test('omgekeerde /Rect in beide richtingen', async () => {
  const kaart = await kaartVan([300, 200, 100, 100], { Subtype: 'Circle', IC: [1, 0, 0] });
  assert.equal(zoekExtraKleuren(kaart, [100, 100, 300, 200])?.ic, '#ff0000');
  const kaartY = await kaartVan([100, 200, 300, 100], { Subtype: 'Circle', IC: [0, 0, 1] });
  assert.equal(zoekExtraKleuren(kaartY, [100, 100, 300, 200])?.ic, '#0000ff');
});

test('opgerekte /Rect: vage match blijft werken, ver ernaast niet', async () => {
  const kaart = await kaartVan([100, 100, 300, 200], { Subtype: 'Square', IC: [0, 1, 0] });
  assert.equal(zoekExtraKleuren(kaart, [99, 99, 301, 201])?.ic, '#00ff00', 'lijndikte-oprekking');
  assert.equal(zoekExtraKleuren(kaart, [400, 400, 600, 500]), undefined, 'andere annotatie');
  assert.equal(zoekExtraKleuren(null, [100, 100, 300, 200]), undefined);
  assert.equal(zoekExtraKleuren(kaart, [100, 100]), undefined);
});
