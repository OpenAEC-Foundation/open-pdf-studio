// Arcering overleeft de rondgang: schrijven, opslaan, heropenen, teruglezen.
//
// Aanleiding: een meetvlak met arcering kreeg de arceringslijnen wel in zijn
// appearance, maar de parameters werden niet als OPS_Hatch*-sleutels
// opgeslagen. Na heropenen kende het model de arcering niet meer en schreef de
// volgende save een vlak zonder arcering weg — in de opslag-rondgang zakte de
// dekking van een blad met gearceerde vlakken zichtbaar.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { schrijfHatchMeta, hatchUitExtra } from './hatch-meta.js';
import { extractAnnotationColors } from '../loader/color-extraction.js';

const VLAK = { hatchPattern: 'diagonal', hatchColor: '#ff0000', hatchScale: 150, hatchAngle: 45 };

/** Zet één Polygon-annotatie met arceringsgegevens in een vers document. */
async function documentMetVlak(ann) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([600, 400]);
  const context = doc.context;
  const annotDict = context.obj({
    Type: 'Annot',
    Subtype: 'Polygon',
    Rect: [50, 50, 250, 200],
    Vertices: [50, 50, 250, 50, 250, 200],
    OPS_Subtype: PDFString.of('measureArea'),
  });
  schrijfHatchMeta(annotDict, ann, context);
  pagina.node.set(PDFName.of('Annots'), context.obj([context.register(annotDict)]));
  return PDFDocument.load(await doc.save());
}

test('de arceringsgegevens komen na opslaan en heropenen terug', async () => {
  const heropend = await documentMetVlak(VLAK);
  const kaart = await extractAnnotationColors(1, heropend);
  const extra = kaart.get('50,50,250,200');
  assert.ok(extra, 'geen gegevens voor de annotatie');
  assert.deepEqual(hatchUitExtra(extra), VLAK);
});

test('zonder arcering blijft het vlak leeg en schrijft er niets bij', async () => {
  const heropend = await documentMetVlak({ hatchPattern: 'none' });
  const kaart = await extractAnnotationColors(1, heropend);
  const extra = kaart.get('50,50,250,200') || {};
  assert.equal(extra.opsHatchPattern, undefined, 'geen OPS_HatchPattern verwacht');
  assert.deepEqual(hatchUitExtra(extra), {
    hatchPattern: 'none', hatchColor: '#000000', hatchScale: 100, hatchAngle: 0,
  });
});

test('alleen een patroon: kleur, schaal en hoek vallen terug op de standaard', async () => {
  const heropend = await documentMetVlak({ hatchPattern: 'cross' });
  const kaart = await extractAnnotationColors(1, heropend);
  assert.deepEqual(hatchUitExtra(kaart.get('50,50,250,200')), {
    hatchPattern: 'cross', hatchColor: '#000000', hatchScale: 100, hatchAngle: 0,
  });
});

test('hoek 0 en schaal 0 overleven de rondgang (geen val voor falsy waarden)', async () => {
  const heropend = await documentMetVlak({ ...VLAK, hatchAngle: 0, hatchScale: 0 });
  const kaart = await extractAnnotationColors(1, heropend);
  const terug = hatchUitExtra(kaart.get('50,50,250,200'));
  assert.equal(terug.hatchAngle, 0);
  assert.equal(terug.hatchScale, 0);
});
