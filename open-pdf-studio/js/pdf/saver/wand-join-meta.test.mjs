// De join-schakelaar van een wand overleeft opslaan en heropenen (#476).
//
// De test schrijft echte PDF-bytes met de sleutel zoals de saver hem zet,
// leest ze terug met de lezer (extractAnnotationColors) en zet ze om naar
// de velden van het wandmodel. De converter en de saver zelf zijn in node niet
// te laden (ze hangen aan de app-staat); de laatste test bewaakt dat ze deze
// gedeelde regels ook echt gebruiken.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { noJoinWaarde, schrijfWandJoinMeta, wandJoinUitExtra } from './wand-join-meta.js';
import { extractAnnotationColors } from '../loader/color-extraction.js';

const RECT = '50,50,250,70';

/** Eén wand (/Line met OPS_Subtype wall) in een vers document, heropend. */
async function heropendeWand(ann) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([600, 400]);
  const context = doc.context;
  const annotDict = context.obj({
    Type: 'Annot',
    Subtype: 'Line',
    Rect: [50, 50, 250, 70],
    L: [60, 60, 240, 60],
    OPS_Subtype: PDFString.of('wall'),
    OPS_DikteMm: 100,
  });
  schrijfWandJoinMeta(annotDict, ann);
  pagina.node.set(PDFName.of('Annots'), context.obj([context.register(annotDict)]));
  return PDFDocument.load(await doc.save());
}

test('de sleutelwaarde volgt de twee vlaggen', () => {
  assert.equal(noJoinWaarde({}), null);
  assert.equal(noJoinWaarde({ noJoinStart: false, noJoinEnd: undefined }), null);
  assert.equal(noJoinWaarde({ noJoinStart: true }), 'start');
  assert.equal(noJoinWaarde({ noJoinEnd: true }), 'end');
  assert.equal(noJoinWaarde({ noJoinStart: true, noJoinEnd: true }), 'both');
});

for (const [naam, ann] of [
  ['alleen het begin', { noJoinStart: true }],
  ['alleen het eind', { noJoinEnd: true }],
  ['beide uiteinden', { noJoinStart: true, noJoinEnd: true }],
]) {
  test(`join uit aan ${naam}: komt na opslaan en heropenen terug`, async () => {
    const kaart = await extractAnnotationColors(1, await heropendeWand(ann));
    const extra = kaart.get(RECT);
    assert.ok(extra, 'geen gegevens voor de wand');
    assert.equal(extra.opsSubtype, 'wall');
    assert.deepEqual(wandJoinUitExtra(extra), ann);
  });
}

test('standaard (join aan) schrijft niets en leest niets terug', async () => {
  const kaart = await extractAnnotationColors(1, await heropendeWand({}));
  const extra = kaart.get(RECT) || {};
  assert.equal(extra.opsNoJoin, undefined, 'geen OPS_NoJoin verwacht');
  assert.deepEqual(wandJoinUitExtra(extra), {});
});

test('onbekende waarden worden genegeerd', () => {
  assert.deepEqual(wandJoinUitExtra({ opsNoJoin: 'onzin' }), {});
  assert.deepEqual(wandJoinUitExtra(null), {});
});

test('de saver en de converter gebruiken deze regels bij een wand', () => {
  const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
  const saver = lees('../saver.js');
  const wandTak = saver.slice(saver.indexOf("case 'wall': {"), saver.indexOf("case 'parametricSymbol': {", saver.indexOf("case 'wall': {")));
  assert.match(wandTak, /schrijfWandJoinMeta\(annotDict, ann\)/, 'saver schrijft OPS_NoJoin in de wandtak');

  const converter = lees('../loader/annotation-converter.js');
  const wandLaad = converter.slice(converter.indexOf("extraColors.opsSubtype === 'wall'"), converter.indexOf('isMeasureDist'));
  assert.match(wandLaad, /\.\.\.wandJoinUitExtra\(extraColors\)/, 'converter zet de vlaggen op de wand');

  assert.match(lees('../loader/color-extraction.js'), /OPS_NoJoin[\s\S]{0,300}colors\.opsNoJoin/, 'lezer leest OPS_NoJoin');
});
