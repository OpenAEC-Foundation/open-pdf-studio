// Wat de app of een ander programma op een annotatie zet, overleeft opslaan
// (#621): lezen, de ruwe waarde bewaren, terugschrijven. Tekenen is de
// optionele helft; weggooien is de fout.
//
// Elk geval: opslaan -> heropenen -> opslaan -> heropenen met de echte saver
// en lader (rondgang.testhulp.mjs), terugzoeken op soort, geen dubbelingen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString, PDFDict, PDFArray, decodePDFRawStream } from 'pdf-lib';
import { leegBlad, opslaan, laad, woordenboeken } from './rondgang.testhulp.mjs';
import { decodePdfTextObject } from './saver/pdf-text.js';

const naam = (d, k) => d.get(PDFName.of(k))?.toString();
const tekst = (d, k) => decodePdfTextObject(d.get(PDFName.of(k)));
const subtype = (d) => naam(d, 'Subtype');

/** Opslaan en heropenen, `keer` keer; elke volgende keer op het vorige bestand. */
async function rondgang(modellen, { keer = 2, bron, rotatie = 0, lagen = null } = {}) {
  let bytes = bron || await leegBlad({ rotatie });
  let huidig = modellen;
  let huidigeLagen = lagen;
  for (let i = 0; i < keer; i++) {
    bytes = await opslaan(bytes, huidig, { lagen: huidigeLagen });
    huidig = await laad(bytes);
    huidigeLagen = huidig.lagen;
  }
  return { modellen: huidig, bytes };
}

/** De gedecodeerde inhoud van de /AP /N van een annotatie. */
function apInhoud(doc, dict) {
  const ctx = doc.context;
  const ap = ctx.lookup(dict.get(PDFName.of('AP')));
  const stroom = ctx.lookup(ap.get(PDFName.of('N')));
  return Buffer.from(decodePDFRawStream(stroom).decode()).toString('latin1');
}

const basis = {
  page: 1, rotation: 0, color: '#000000', strokeColor: '#000000', fillColor: null,
  lineWidth: 1, borderStyle: 'solid', opacity: 1, author: 'User',
};
const ARCERING = { hatchPattern: 'diagonal-left', hatchColor: '#ff0000', hatchScale: 100, hatchAngle: 0 };

// ── 1. arcering uit het eigenschappenpaneel ─────────────────────────────────

const VORMEN = {
  box: { ...basis, id: 'bx', type: 'box', x: 80, y: 100, width: 140, height: 80 },
  circle: { ...basis, id: 'ci', type: 'circle', x: 300, y: 100, width: 120, height: 80 },
  polygon: { ...basis, id: 'pg', type: 'polygon', x: 80, y: 300, width: 140, height: 90, sides: 6 },
  cloud: { ...basis, id: 'cl', type: 'cloud', x: 300, y: 300, width: 160, height: 90 },
};

for (const [soort, vorm] of Object.entries(VORMEN)) {
  for (const extra of [{}, { rotation: 30, fillColor: '#00ff00' }]) {
    const wat = `${soort}${extra.rotation ? ' gedraaid met vulling' : ''}`;
    test(`arcering op een ${wat} blijft na twee rondgangen, in de sleutels en de appearance`, async () => {
      const { modellen, bytes } = await rondgang([{ ...vorm, ...ARCERING, ...extra }]);
      assert.equal(modellen.length, 1);
      const [m] = modellen;
      assert.equal(m.type, soort);
      assert.equal(m.hatchPattern, 'diagonal-left');
      assert.equal(m.hatchColor, '#ff0000');
      if (extra.rotation) assert.equal(m.rotation, 30);
      const dicts = await woordenboeken(bytes);
      const [{ dict }] = dicts;
      assert.equal(tekst(dict, 'OPS_HatchPattern'), 'diagonal-left');
      // De arcering staat in de appearance: een uitsnede (W n) met rode lijnen.
      const ap = apInhoud(dicts.doc, dict);
      assert.match(ap, /W n\n/, 'arcering knipt op de vorm');
      assert.match(ap, /1 0 0 RG/, 'rode arceringslijnen');
    });
  }
}

test('een vorm zonder arcering krijgt geen arceringssleutels', async () => {
  const { modellen, bytes } = await rondgang([VORMEN.box]);
  const [{ dict }] = await woordenboeken(bytes);
  assert.equal(dict.get(PDFName.of('OPS_HatchPattern')), undefined);
  assert.equal(modellen[0].hatchPattern, undefined);
});

// ── 2–13. sleutels van een ander programma ─────────────────────────────────

/**
 * Een blad zoals een ander tekenpakket het schrijft: per geval één annotatie
 * met de sleutels die de app niet kent, twee eigen lagen (OCG's) waar
 * annotaties naar wijzen, één OCG voor inhoud van de tekening, en eigen
 * sleutels in de catalogus.
 */
async function vreemdBlad() {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  const ctx = doc.context;
  const s = (t) => PDFString.of(t);
  const ocg = (n) => ctx.register(ctx.obj({ Type: 'OCG', Name: s(n) }));
  const laagA = ocg('Opmerkingen A');
  const laagB = ocg('Opmerkingen B');
  const tekening = ocg('Tekening');
  doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({
    OCGs: [laagA, laagB, tekening],
    D: { Order: [laagA, laagB, tekening], OFF: [laagB] },
  }));
  doc.catalog.set(PDFName.of('BSIStatus'), ctx.obj({ Statussen: [s('Open'), s('Klaar')] }));
  doc.catalog.set(PDFName.of('BSIAnnotColumns'), ctx.obj([ctx.obj({ Name: s('Kostenpost') })]));
  // Een stroom achter een verwijzing: moet als nieuw object mee.
  const merkteken = ctx.register(ctx.stream('0 0 m 4 4 l S', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 4, 4] }));
  const measure = ctx.obj({
    Type: 'Measure', Subtype: 'RL', R: s('1:100'),
    X: [ctx.obj({ U: s('mm'), C: 35.28, D: 1 })], D: [ctx.obj({ U: s('mm'), C: 1, D: 1 })],
    A: [ctx.obj({ U: s('m2'), C: 0.00124, D: 100 })],
  });
  const annots = [
    // 5. lijnstijl
    ctx.obj({ Type: 'Annot', Subtype: 'Line', Rect: [60, 780, 300, 800], L: [60, 790, 300, 790], C: [0, 0, 1],
      LineStyle: [ctx.obj({ Merk: merkteken, Afstand: 12 })], LineStyleName: s('Hekwerk'), OC: laagA }),
    // 3. telling
    ctx.obj({ Type: 'Annot', Subtype: 'Polygon', Rect: [60, 600, 200, 700], Vertices: [70, 610, 190, 610, 130, 690],
      C: [1, 0, 0], IT: PDFName.of('PolygonCount'), NumCounts: 3, CountStyle: PDFName.of('Circle'), CountScale: 1.5,
      OC: laagB }),
    // 13. meting met een eigen bedoeling
    ctx.obj({ Type: 'Annot', Subtype: 'Polygon', Rect: [250, 600, 350, 650], Vertices: [250, 650, 350, 650, 350, 600, 250, 600],
      C: [1, 0, 0], IT: PDFName.of('RectangleSketchToScale'), Measure: measure, Contents: s('5 m2') }),
    // 7. gedeeltelijke boog
    ctx.obj({ Type: 'Annot', Subtype: 'Circle', Rect: [400, 600, 500, 700], C: [0, 0, 0],
      IT: PDFName.of('CircleArc'), Angle1: 30, Angle2: 200 }),
    // 8. gebogen maatlijn
    ctx.obj({ Type: 'Annot', Subtype: 'Line', Rect: [60, 480, 300, 560], L: [60, 500, 300, 500], C: [0, 0, 0],
      Curves: [60, 500, 180, 560, 300, 500], SO: [0, 4, 0, -4] }),
    // 9. callout met een tweede arm
    ctx.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [320, 450, 520, 560], Contents: s('Y-callout'),
      DA: s('0 0 0 rg /Helv 12 Tf'), IT: PDFName.of('FreeTextCallout'), CL: [330, 460, 360, 500, 400, 520],
      CLEx: [[330, 540, 360, 500]], RD: [0, 0, 0, 0] }),
    // 11. kolomwaarden en 2. tegelpatroon
    ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [60, 300, 260, 400], C: [0, 0, 0], IC: [1, 1, 0.8],
      BSIColumnData: [s('Fase 2'), s('1200')], PatternName: s('Diagonal Up'), PatternColor: [0, 0, 1] }),
  ];
  pagina.node.set(PDFName.of('Annots'), ctx.obj(annots.map((a) => ctx.register(a))));
  return doc.save();
}

// De sleutels per soort, als 'Subtype:Sleutel'.
async function sleutelTelling(bytes) {
  const teller = new Map();
  for (const { dict } of await woordenboeken(bytes)) {
    for (const k of dict.keys()) {
      const sleutel = `${subtype(dict)}:${k.decodeText()}`;
      teller.set(sleutel, (teller.get(sleutel) || 0) + 1);
    }
  }
  return teller;
}

const VREEMDE_SLEUTELS = [
  '/Line:LineStyle', '/Line:LineStyleName', '/Polygon:NumCounts', '/Polygon:CountStyle', '/Polygon:CountScale',
  '/Circle:Angle1', '/Circle:Angle2', '/Line:Curves', '/Line:SO', '/FreeText:CLEx',
  '/Square:BSIColumnData', '/Square:PatternName', '/Square:PatternColor',
];

test('sleutels van een ander programma overleven twee keer opslaan, zonder dubbelingen', async () => {
  const bron = await vreemdBlad();
  const voor = await sleutelTelling(bron);
  const { bytes, modellen } = await rondgang(await laad(bron), { bron });
  const na = await sleutelTelling(bytes);
  for (const sleutel of VREEMDE_SLEUTELS) {
    assert.equal(na.get(sleutel), voor.get(sleutel), `${sleutel}: ${voor.get(sleutel)} -> ${na.get(sleutel)}`);
  }
  assert.equal(modellen.length, 7, 'evenveel annotaties');
});

test('de waarden komen ongewijzigd terug, ook achter een verwijzing', async () => {
  const bron = await vreemdBlad();
  const { bytes } = await rondgang(await laad(bron), { bron });
  const dicts = await woordenboeken(bytes);
  const ctx = dicts.doc.context;
  const zoek = (st, k) => dicts.find(({ dict }) => subtype(dict) === st && dict.get(PDFName.of(k)) !== undefined)?.dict;
  const lijn = zoek('/Line', 'LineStyle');
  assert.equal(tekst(lijn, 'LineStyleName'), 'Hekwerk');
  const stijl = ctx.lookup(ctx.lookup(lijn.get(PDFName.of('LineStyle'))).get(0));
  assert.equal(ctx.lookup(stijl.get(PDFName.of('Afstand'))).asNumber(), 12);
  const merk = ctx.lookup(stijl.get(PDFName.of('Merk')));
  assert.equal(Buffer.from(decodePDFRawStream(merk).decode()).toString('latin1'), '0 0 m 4 4 l S', 'de stroom zelf');
  const telling = zoek('/Polygon', 'NumCounts');
  assert.equal(telling.get(PDFName.of('NumCounts')).asNumber(), 3);
  assert.equal(naam(telling, 'CountStyle'), '/Circle');
  assert.equal(naam(telling, 'IT'), '/PolygonCount');
  const boog = zoek('/Circle', 'Angle1');
  assert.equal(naam(boog, 'IT'), '/CircleArc');
  assert.deepEqual([boog.get(PDFName.of('Angle1')).asNumber(), boog.get(PDFName.of('Angle2')).asNumber()], [30, 200]);
  const vak = zoek('/Square', 'BSIColumnData');
  assert.deepEqual(ctx.lookup(vak.get(PDFName.of('BSIColumnData'))).asArray().map((v) => v.decodeText()), ['Fase 2', '1200']);
});

test('een meting houdt de bedoeling waarmee ze binnenkwam (13)', async () => {
  const bron = await vreemdBlad();
  const { bytes, modellen } = await rondgang(await laad(bron), { bron });
  assert.ok(modellen.some((m) => m.type === 'measureArea'), 'blijft een meetvlak');
  const intenties = (await woordenboeken(bytes)).map(({ dict }) => naam(dict, 'IT')).filter(Boolean).sort();
  assert.deepEqual(intenties, ['/CircleArc', '/FreeTextCallout', '/PolygonCount', '/RectangleSketchToScale']);
});

test('een bekend tegelpatroon wordt de arcering van de app en blijft ook als patroonnaam staan (2)', async () => {
  const bron = await vreemdBlad();
  const eerste = await laad(bron);
  const vak = eerste.find((m) => m.type === 'box');
  assert.equal(vak.hatchPattern, 'diagonal-right', 'Diagonal Up loopt rechts omhoog');
  assert.equal(vak.hatchColor, '#0000ff');
  const { bytes, modellen } = await rondgang(eerste, { bron });
  assert.equal(modellen.find((m) => m.type === 'box').hatchPattern, 'diagonal-right');
  const sq = (await woordenboeken(bytes)).find(({ dict }) => subtype(dict) === '/Square').dict;
  assert.equal(tekst(sq, 'PatternName'), 'Diagonal Up');
  // Niet bewerkt: het woordenboek blijft dat van het bestand (#629), zonder
  // eigen arceringssleutels; /PatternName geeft de arcering bij heropenen.
  // Het bestand had geen appearance: die van de app (met de arcering) komt erbij.
  assert.equal(sq.get(PDFName.of('OPS_HatchPattern')), undefined);
  assert.ok(sq.get(PDFName.of('AP')), 'appearance erbij');
});

test('de catalogussleutels van een ander programma blijven staan (11)', async () => {
  const bron = await vreemdBlad();
  const { bytes } = await rondgang(await laad(bron), { bron });
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.catalog.get(PDFName.of('BSIStatus')), '/BSIStatus');
  assert.ok(doc.catalog.get(PDFName.of('BSIAnnotColumns')), '/BSIAnnotColumns');
});

// ── 4. lagen van een ander programma ────────────────────────────────────────

test('lagen van een ander programma: naam, zichtbaarheid en dezelfde groep na twee keer opslaan', async () => {
  const bron = await vreemdBlad();
  const eerste = await laad(bron);
  const namen = eerste.lagen.map((l) => l.name);
  assert.ok(namen.includes('Opmerkingen A') && namen.includes('Opmerkingen B'), `lagen: ${namen}`);
  assert.ok(!namen.includes('Tekening'), 'een groep zonder markeringen is geen annotatielaag');
  assert.equal(eerste.lagen.find((l) => l.name === 'Opmerkingen B').visible, false, '/OFF blijft uit');
  const laagVan = (ms, st, lagen) => lagen.find((l) => l.id === ms.find((m) => m.type === st)?.layer)?.name;
  assert.equal(laagVan(eerste, 'line', eerste.lagen), 'Opmerkingen A');

  const { bytes, modellen } = await rondgang(eerste, { bron, lagen: eerste.lagen });
  assert.equal(laagVan(modellen, 'line', modellen.lagen), 'Opmerkingen A');
  assert.equal(laagVan(modellen, 'polygon', modellen.lagen), 'Opmerkingen B');
  assert.equal(modellen.lagen.find((l) => l.name === 'Opmerkingen B').visible, false);
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const oc = ctx.lookup(doc.catalog.get(PDFName.of('OCProperties')));
  const ocgNamen = ctx.lookup(oc.get(PDFName.of('OCGs'))).asArray()
    .map((r) => decodePdfTextObject(ctx.lookup(r).get(PDFName.of('Name'))));
  for (const n of ['Opmerkingen A', 'Opmerkingen B', 'Tekening']) {
    assert.equal(ocgNamen.filter((x) => x === n).length, 1, `${n} precies één keer in ${ocgNamen}`);
  }
  // De lijn wijst naar dezelfde groep als in het origineel.
  const origineel = await PDFDocument.load(bron);
  const refA = origineel.context.lookup(origineel.catalog.get(PDFName.of('OCProperties'))).get(PDFName.of('OCGs')).asArray()[0];
  const lijn = (await woordenboeken(bytes)).find(({ dict }) => dict.get(PDFName.of('LineStyle'))).dict;
  assert.equal(lijn.get(PDFName.of('OC')).toString(), refA.toString());
});

// ── 3. tellingen ────────────────────────────────────────────────────────────

test('een telmarkering van de app overleeft opslaan (verdween zonder melding)', async () => {
  const tel = (id, x, number) => ({
    ...basis, id, type: 'count', x, y: 500, number, categoryId: 'deuren', markerStyle: 'dot',
    color: '#e11d48', strokeColor: '#e11d48',
  });
  const { modellen, bytes } = await rondgang([tel('t1', 100, 1), tel('t2', 160, 2)]);
  const tellingen = modellen.filter((m) => m.type === 'count').sort((a, b) => a.number - b.number);
  assert.equal(tellingen.length, 2);
  assert.deepEqual(tellingen.map((t) => [Math.round(t.x), Math.round(t.y), t.number, t.categoryId, t.markerStyle, t.color]),
    [[100, 500, 1, 'deuren', 'dot', '#e11d48'], [160, 500, 2, 'deuren', 'dot', '#e11d48']]);
  // Andere lezers zien de stip met zijn nummer.
  const dicts = await woordenboeken(bytes);
  assert.ok(dicts.every(({ dict }) => subtype(dict) === '/Circle'));
  const ap = apInhoud(dicts.doc, dicts.find(({ dict }) => tekst(dict, 'OPS_Subtype') === 'count').dict);
  assert.match(ap, /\((1|2)\) Tj/);
});

test('een telling van een ander programma wordt als stippen getekend, niet als veelhoek (3)', async () => {
  const bron = await vreemdBlad();
  const { bytes, modellen } = await rondgang(await laad(bron), { bron });
  const telling = modellen.find((m) => m.type === 'polygon');
  assert.equal(telling.points.length, 3);
  const dicts = await woordenboeken(bytes);
  const pg = dicts.find(({ dict }) => naam(dict, 'IT') === '/PolygonCount').dict;
  const ap = apInhoud(dicts.doc, pg);
  assert.equal((ap.match(/ c f\n/g) || []).length, 3, 'drie stippen');
  assert.doesNotMatch(ap, / S\n/, 'geen omtrek');
});

test('na een vormwijziging in de app vallen de vormsleutels weg, de rest blijft', async () => {
  // Een oude kromme bij een verplaatste lijn zou een ander programma de oude
  // vorm laten tekenen.
  const bron = await vreemdBlad();
  const modellen = await laad(bron);
  const kromme = modellen.find((m) => m.pdfRaw?.sleutels?.Curves);
  kromme.endX += 40;
  const bytes = await opslaan(bron, modellen);
  const dicts = await woordenboeken(bytes);
  assert.equal(dicts.filter(({ dict }) => dict.get(PDFName.of('Curves'))).length, 0, 'geen oude kromme');
  assert.equal(dicts.filter(({ dict }) => dict.get(PDFName.of('LineStyle'))).length, 1, 'de lijnstijl van de andere lijn blijft');
});
