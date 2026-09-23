import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { hexNaarKleur, meetWoordenboekVelden, omhullende, schrijfAnnotaties, SOORTEN } from './opslaan.js';
import { leesSchaal } from './meten.js';

const BREEDTE = 595;
const HOOGTE = 842;

async function leegDocument(paginas = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) doc.addPage([BREEDTE, HOOGTE]);
  return doc.save({ useObjectStreams: false });
}

async function annotatiesUit(bytes, paginaIndex = 0) {
  const doc = await PDFDocument.load(bytes);
  const pagina = doc.getPages()[paginaIndex];
  const arr = pagina.node.get(PDFName.of('Annots'));
  if (!arr) return [];
  return arr.asArray().map((ref) => doc.context.lookup(ref));
}

const naam = (dict, n) => String(dict.get(PDFName.of(n)) ?? '').replace(/^\//, '');
const tekst = (dict, n) => dict.get(PDFName.of(n))?.decodeText?.() ?? null;

test('een hexkleur wordt omgerekend naar 0..1, rommel wordt zwart', () => {
  assert.deepEqual(hexNaarKleur('#ff0000'), [1, 0, 0]);
  assert.deepEqual(hexNaarKleur('00ff00'), [0, 1, 0]);
  assert.deepEqual(hexNaarKleur('#000000'), [0, 0, 0]);
  assert.deepEqual(hexNaarKleur('kaas'), [0, 0, 0]);
  assert.deepEqual(hexNaarKleur(null), [0, 0, 0]);
});

test('het meetwoordenboek draagt eenheden per punt', () => {
  const s = leesSchaal('1:100', 'mm');
  const v = meetWoordenboekVelden(s);
  assert.equal(v.C, s.eenheidPerPunt);
  assert.equal(v.D, 1);
  assert.equal(v.U, 'mm');
  assert.match(v.R, /^1 pt = /);
  assert.equal(meetWoordenboekVelden(null), null);
  assert.equal(meetWoordenboekVelden({ eenheidPerPunt: 0 }), null);
});

test('de omhullende neemt alle punten mee, met marge', () => {
  assert.deepEqual(omhullende([{ x: 10, y: 20 }, { x: 30, y: 5 }], 5), [5, 0, 35, 25]);
  assert.deepEqual(omhullende([{ x: 10, y: 20 }], 0), [10, 20, 10, 20]);
});

test('een afstandsmaat wordt een /Line met /Measure en een appearance', async () => {
  const schaal = leesSchaal('1:100', 'mm');
  const uit = await schrijfAnnotaties(await leegDocument(), [{
    type: 'measureDistance', page: 1,
    startX: 100, startY: 100, endX: 300, endY: 100,
    strokeColor: '#ff0000', measureText: '7055.56 mm', author: 'Web',
  }], { schaal });

  const annots = await annotatiesUit(uit);
  assert.equal(annots.length, 1);
  const a = annots[0];
  assert.equal(naam(a, 'Subtype'), 'Line');
  assert.equal(naam(a, 'IT'), 'LineDimension');
  assert.equal(tekst(a, 'OPS_Subtype'), 'measureDistance');

  // y wordt gespiegeld: 100 vanaf boven op een pagina van 842 pt = 742.
  const L = a.get(PDFName.of('L')).asArray().map((n) => n.asNumber());
  assert.deepEqual(L, [100, 742, 300, 742]);

  const meet = a.get(PDFName.of('Measure'));
  assert.equal(naam(meet, 'Subtype'), 'RL');
  const x = meet.get(PDFName.of('X')).asArray()[0];
  assert.ok(Math.abs(x.get(PDFName.of('C')).asNumber() - schaal.eenheidPerPunt) < 1e-6);
  assert.equal(x.get(PDFName.of('U')).decodeText(), 'mm');

  assert.ok(a.get(PDFName.of('AP')), 'er hoort een /AP te staan');
});

test('zonder schaal blijft /Measure weg, maar de lijn wordt wel geschreven', async () => {
  const uit = await schrijfAnnotaties(await leegDocument(), [{
    type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 10, endY: 0,
  }], {});
  const a = (await annotatiesUit(uit))[0];
  assert.equal(naam(a, 'Subtype'), 'Line');
  assert.equal(a.get(PDFName.of('Measure')), undefined);
});

test('een eigen schaal op de annotatie wint van de documentschaal', async () => {
  const uit = await schrijfAnnotaties(await leegDocument(), [{
    type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 10, endY: 0,
    schaal: leesSchaal('1:50', 'm'),
  }], { schaal: leesSchaal('1:100', 'mm') });
  const a = (await annotatiesUit(uit))[0];
  const x = a.get(PDFName.of('Measure')).get(PDFName.of('X')).asArray()[0];
  assert.equal(x.get(PDFName.of('U')).decodeText(), 'm');
});

test('een opmerking wordt een /Text met de tekst erin', async () => {
  const uit = await schrijfAnnotaties(await leegDocument(), [{
    type: 'note', page: 1, x: 50, y: 60, contents: 'Maat controleren', author: 'Web',
  }]);
  const a = (await annotatiesUit(uit))[0];
  assert.equal(naam(a, 'Subtype'), 'Text');
  assert.equal(tekst(a, 'Contents'), 'Maat controleren');
  assert.equal(tekst(a, 'T'), 'Web');
  const rect = a.get(PDFName.of('Rect')).asArray().map((n) => n.asNumber());
  assert.equal(rect[0], 50);
  assert.equal(rect[3], HOOGTE - 60);
});

test('tekst buiten ASCII overleeft als hexstring', async () => {
  const uit = await schrijfAnnotaties(await leegDocument(), [{
    type: 'note', page: 1, x: 10, y: 10, contents: 'Hoogte ± 3 µm — pas op',
  }]);
  const doc = await PDFDocument.load(uit);
  const a = doc.context.lookup(doc.getPages()[0].node.get(PDFName.of('Annots')).asArray()[0]);
  assert.equal(a.get(PDFName.of('Contents')).decodeText(), 'Hoogte ± 3 µm — pas op');
});

test('een vlak wordt een /Square met rand en eventueel vulling', async () => {
  const uit = await schrijfAnnotaties(await leegDocument(), [{
    type: 'square', page: 1, x: 10, y: 20, breedte: 100, hoogte: 50,
    strokeColor: '#0000ff', fillColor: '#00ff00', lineWidth: 3,
  }]);
  const a = (await annotatiesUit(uit))[0];
  assert.equal(naam(a, 'Subtype'), 'Square');
  assert.deepEqual(a.get(PDFName.of('C')).asArray().map((n) => n.asNumber()), [0, 0, 1]);
  assert.deepEqual(a.get(PDFName.of('IC')).asArray().map((n) => n.asNumber()), [0, 1, 0]);
  assert.equal(a.get(PDFName.of('BS')).get(PDFName.of('W')).asNumber(), 3);
  const rect = a.get(PDFName.of('Rect')).asArray().map((n) => n.asNumber());
  assert.deepEqual(rect, [10, HOOGTE - 70, 110, HOOGTE - 20]);
});

test('zonder vulling komt er geen /IC in het bestand', async () => {
  const uit = await schrijfAnnotaties(await leegDocument(), [{
    type: 'square', page: 1, x: 0, y: 0, breedte: 10, hoogte: 10,
  }]);
  const a = (await annotatiesUit(uit))[0];
  assert.equal(a.get(PDFName.of('IC')), undefined);
});

test('annotaties landen op de juiste pagina', async () => {
  const uit = await schrijfAnnotaties(await leegDocument(3), [
    { type: 'note', page: 3, x: 1, y: 1, contents: 'derde' },
    { type: 'note', page: 1, x: 1, y: 1, contents: 'eerste' },
  ]);
  assert.equal((await annotatiesUit(uit, 0)).length, 1);
  assert.equal((await annotatiesUit(uit, 1)).length, 0);
  assert.equal(tekst((await annotatiesUit(uit, 2))[0], 'Contents'), 'derde');
});

test('onbekende soorten en paginas buiten het bereik worden overgeslagen', async () => {
  const uit = await schrijfAnnotaties(await leegDocument(1), [
    { type: 'stempel', page: 1, x: 1, y: 1 },
    { type: 'note', page: 9, x: 1, y: 1 },
    { type: 'note', page: 0, x: 1, y: 1 },
    null,
    { type: 'note', page: 1, x: 1, y: 1, contents: 'blijft' },
  ]);
  const annots = await annotatiesUit(uit);
  assert.equal(annots.length, 1);
  assert.equal(tekst(annots[0], 'Contents'), 'blijft');
});

test('bestaande annotaties in het document blijven staan', async () => {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([BREEDTE, HOOGTE]);
  const bestaand = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 10, 10], Contents: PDFString.of('oud'),
  }));
  pagina.node.set(PDFName.of('Annots'), doc.context.obj([bestaand]));
  const bron = await doc.save({ useObjectStreams: false });

  const uit = await schrijfAnnotaties(bron, [{ type: 'note', page: 1, x: 5, y: 5, contents: 'nieuw' }]);
  const annots = await annotatiesUit(uit);
  assert.equal(annots.length, 2);
  assert.deepEqual(annots.map((a) => tekst(a, 'Contents')), ['oud', 'nieuw']);
});

test('een lege lijst laat het bestand ongemoeid maar levert nog steeds bytes', async () => {
  const uit = await schrijfAnnotaties(await leegDocument(), []);
  assert.ok(uit instanceof Uint8Array);
  assert.ok(uit.length > 100);
  assert.equal((await annotatiesUit(uit)).length, 0);
});

test('een snijvak dat niet op de oorsprong begint wordt meegerekend', async () => {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([BREEDTE, HOOGTE]);
  pagina.node.set(PDFName.of('CropBox'), doc.context.obj([20, 30, 400, 600].map((n) => PDFNumber.of(n))));
  const bron = await doc.save({ useObjectStreams: false });

  const uit = await schrijfAnnotaties(bron, [{ type: 'note', page: 1, x: 0, y: 0, contents: 'hoek' }]);
  const a = (await annotatiesUit(uit))[0];
  const rect = a.get(PDFName.of('Rect')).asArray().map((n) => n.asNumber());
  assert.equal(rect[0], 20);       // x = snijvak links
  assert.equal(rect[3], 600);      // y = snijvak boven
});

test('de lijst met ondersteunde soorten is die van de eerste snede', () => {
  assert.deepEqual([...SOORTEN], ['measureDistance', 'note', 'square']);
});
