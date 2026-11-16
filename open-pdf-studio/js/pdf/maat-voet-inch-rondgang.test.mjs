// Maten in voet en inch met een breuk (core/maat-opmaak.js), uit een ander
// tekenpakket: /Measure met /D voet → inch, /F /F en de breuk in /D (1, 4,
// 16). De app las /D als decimale noemer (16 → één decimaal) en ' als
// eenheid, zodat de maat na slepen "2.21 ft" werd in plaats van 2'-2 9/16".
//
// Laden, de viewport van de pagina, de tekst na een wijziging en opslaan en
// heropenen, met de echte saver en lader.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { state, opslaan, laad, woordenboeken } from './rondgang.testhulp.mjs';

const { leesViewportsVanPagina } = await import('./pdf-viewports.js');
const { maatlijnTekst } = await import('../annotations/measurement.js');
const { opmaakUitGetalopmaken } = await import('../core/maat-opmaak.js');
const { getalopmaakReeks } = await import('./pdf-viewports.js');

// 1,4018 in op papier = 3 ft: voet per punt.
const VOET_PER_PT = 0.02972369;

function measure(ctx, breuk) {
  const nf = (U, C, extra = {}) => ctx.obj({ Type: PDFName.of('NumberFormat'), U: PDFString.of(U), C, F: PDFName.of('F'), D: breuk, FD: true, ...extra });
  return ctx.obj({
    Type: PDFName.of('Measure'), Subtype: PDFName.of('RL'), R: PDFString.of('1.4018 in = 3 ft'),
    X: [nf("'", VOET_PER_PT, { SS: PDFString.of('') })],
    D: [nf("'", 1, { SS: PDFString.of('-') }), nf('"', 12, { SS: PDFString.of('') })],
    A: [ctx.obj({ U: PDFString.of('sf'), C: 1, D: 1 })],
  });
}

/** Een blad met een /VP (voet-inch, `breuk`) en een verticale maat van 73,438 pt. */
async function blad(breuk, contents, { metMaat = true } = {}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([612, 792]);
  const ctx = doc.context;
  pagina.node.set(PDFName.of('VP'), ctx.obj([ctx.obj({
    Type: PDFName.of('Viewport'), BBox: [0, 0, 612, 792], Measure: measure(ctx, breuk),
  })]));
  const annot = ctx.obj({
    Type: 'Annot', Subtype: 'Line', Rect: [130, 590, 190, 680], L: [182.3659, 596.6769, 182.3659, 670.1151],
    LL: 28.32507, LLE: 2, C: [1, 0, 0], IT: PDFName.of('LineDimension'), Measure: measure(ctx, breuk),
    ...(contents ? { Contents: PDFString.of(contents) } : {}),
  });
  if (metMaat) pagina.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
  return doc.save();
}

// 73,4382 pt × voet per punt = 26,194"; 1 pt langer is 26,551".
const GEVALLEN = [
  { breuk: 1, tekst: `2'-2"`, langer: `2'-3"` },
  { breuk: 4, tekst: `2'-2 1/4"`, langer: `2'-2 1/2"` },
  { breuk: 16, tekst: `2'-2 3/16"`, langer: `2'-2 9/16"` },
];

for (const { breuk, tekst, langer } of GEVALLEN) {
  test(`breuk 1/${breuk}: laden, langer maken en opslaan houden voet-inch`, async () => {
    const bron = await blad(breuk, tekst);
    const [maat] = await laad(bron);
    assert.equal(maat.type, 'measureDistance');
    assert.equal(maat.measureText, tekst, 'de tekst uit /Contents');
    assert.equal(maat.measureUnit, 'ft', "' is voet");
    assert.equal(maat.measureFraction, breuk);
    assert.ok(Math.abs(maat.measureScale - VOET_PER_PT) < 1e-12, 'schaal uit /X, niet omgerekend naar inches');

    // Een wijziging rekent de tekst opnieuw uit, in dezelfde opmaak.
    const lengte = Math.hypot(maat.endX - maat.startX, maat.endY - maat.startY);
    assert.equal(maatlijnTekst(maat, { value: (lengte + 1) * maat.measureScale, unit: maat.measureUnit }), langer);

    // Opslaan: /D voet → inch met /F /F en dezelfde breuk; heropenen geeft hem terug.
    state.preferences.imperialLengthFormat = 'decimal';
    const uit = await opslaan(bron, [{ ...maat, measureText: undefined }]);
    const [{ dict }] = await woordenboeken(uit);
    const lees = await PDFDocument.load(uit);
    const m = lees.context.lookup(dict.get(PDFName.of('Measure')));
    const d = getalopmaakReeks(m.get(PDFName.of('D')), (v) => lees.context.lookup(v) ?? v);
    assert.deepEqual(opmaakUitGetalopmaken(d), { unit: 'ft', fractie: breuk });
    const [terug] = await laad(uit);
    assert.equal(terug.measureFraction, breuk);
    assert.equal(terug.measureUnit, 'ft');
  });
}

test('zonder /Contents rekent de lader de tekst in voet-inch uit', async () => {
  const [maat] = await laad(await blad(16, null));
  assert.equal(maat.measureText, `2'-2 3/16"`);
});

test('de viewport van de pagina draagt zijn opmaak; een nieuwe maat volgt hem', async () => {
  for (const { breuk } of GEVALLEN) {
    const doc = await PDFDocument.load(await blad(breuk, 'x'));
    const [vp] = leesViewportsVanPagina(doc.getPage(0));
    assert.equal(vp.unit, 'ft');
    assert.deepEqual(vp.opmaak, { fractie: breuk });
    // Een maat zonder eigen schaal en zonder eigen opmaak: die van de viewport.
    const waarde = 26.5514 / 12;
    const tekst = maatlijnTekst({ measurePrecision: 0 }, { value: waarde, unit: 'ft', opmaak: vp.opmaak });
    assert.equal(tekst, GEVALLEN.find((g) => g.breuk === breuk).langer);
  }
});

test('metrisch blijft zoals het was: een maat met de paginaschaal negeert de voorkeur 0 decimalen', () => {
  // measureDistDimPrecision is standaard 0; vóór deze wijziging kreeg een
  // maat met de paginaschaal toch de standaard per eenheid.
  assert.equal(maatlijnTekst({ measurePrecision: 0 }, { value: 7.0612, unit: 'm' }), '7.06 m');
  assert.equal(maatlijnTekst({ measurePrecision: 0 }, { value: 120, unit: 'cm' }), '120.0 cm');
  assert.equal(maatlijnTekst({ measurePrecision: 0 }, { value: 1234.5, unit: 'mm' }), '1235');
  // Met een eigen schaal geldt de eigen precisie, zoals bij slepen.
  assert.equal(maatlijnTekst({ measureScale: 0.01, measurePrecision: 3 }, { value: 7.0612, unit: 'm' }), '7.061 m');
});

// ── terug naar decimaal: de drie standen van measureFraction ────────────────

test('een maat uit het bestand terug naar decimale voet: blijft decimaal na opslaan en heropenen', async () => {
  const bron = await blad(16, `2'-2 3/16"`);
  const [maat] = await laad(bron);
  // De keuze 0.01 in het eigenschappenpaneel: uitdrukkelijk decimaal.
  const decimaal = { ...maat, measureFraction: 0, measurePrecision: 2 };
  const lengte = Math.hypot(maat.endX - maat.startX, maat.endY - maat.startY);
  const waarde = { value: lengte * maat.measureScale, unit: 'ft' };
  assert.equal(maatlijnTekst(decimaal, waarde), '2.18 ft');

  const uit = await opslaan(bron, [{ ...decimaal, measureText: '2.18 ft' }]);
  const [{ dict }] = await woordenboeken(uit);
  assert.equal(String(dict.get(PDFName.of('OPS_DimDecimal'))), 'true', 'de keuze gaat mee');
  const [terug] = await laad(uit);
  assert.equal(terug.measureFraction, 0, 'uitdrukkelijk decimaal na heropenen');
  assert.equal(maatlijnTekst(terug, waarde), '2.18 ft');
});

test('een maat met de schaal van de pagina: automatisch volgt de viewport, decimaal gaat ervoor', () => {
  const waarde = { value: 26.5514 / 12, unit: 'ft', opmaak: { fractie: 16 } };
  // Automatisch (measureFraction niet gezet): de breuk van de pagina.
  assert.equal(maatlijnTekst({ measurePrecision: 0 }, waarde), `2'-2 9/16"`);
  // Uitdrukkelijk decimaal: ook op dit blad.
  assert.equal(maatlijnTekst({ measurePrecision: 2, measureFraction: 0 }, waarde), '2.21 ft');
  // Uitdrukkelijk een andere breuk.
  assert.equal(maatlijnTekst({ measurePrecision: 0, measureFraction: 4 }, waarde), `2'-2 1/2"`);
  // Zonder viewport-opmaak en met de voorkeur voet-inch: decimaal wint ook dan.
  const vrij = { value: 26.5514 / 12, unit: 'ft' };
  state.preferences.imperialLengthFormat = 'feetInch';
  try {
    assert.equal(maatlijnTekst({ measurePrecision: 2, measureFraction: 0 }, vrij), '2.21 ft');
  } finally {
    state.preferences.imperialLengthFormat = 'decimal';
  }
});

test('een nieuwe maat met de schaal van de pagina blijft na opslaan automatisch', async () => {
  const bron = await blad(4, null, { metMaat: false });
  // Getekend op het blad: geen eigen schaal en geen eigen opmaak.
  const nieuw = {
    id: 'nieuw', type: 'measureDistance', page: 1, color: '#ff0000', strokeColor: '#ff0000', lineWidth: 1,
    startX: 100, startY: 100, endX: 100 + 73.4382, endY: 100, measurePrecision: 0, opacity: 1,
  };
  // De viewports van het blad, zoals js/pdf/loader.js ze op het document zet.
  const pdfViewports = { 1: leesViewportsVanPagina((await PDFDocument.load(bron)).getPage(0)) };
  const uit = await opslaan(bron, [nieuw], { document: { pdfViewports } });
  const [{ dict }] = await woordenboeken(uit);
  const lees = await PDFDocument.load(uit);
  const m = lees.context.lookup(dict.get(PDFName.of('Measure')));
  const d = getalopmaakReeks(m.get(PDFName.of('D')), (v) => lees.context.lookup(v) ?? v);
  assert.deepEqual(opmaakUitGetalopmaken(d), { unit: 'ft', fractie: 4 }, 'een andere lezer ziet de breuk van de pagina');
  const [terug] = await laad(uit);
  assert.equal(terug.measureFraction, undefined, 'na heropenen nog automatisch');
  assert.equal(terug.measureScale, undefined, 'en nog met de schaal van de pagina');
});

// ── alleen inches met een breuk: 26 3/16" ───────────────────────────────────

/** Een blad met /X in voet en /D in alleen inches (/U ", /C 12, /F /F). */
async function inchBlad({ metMaat = true } = {}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([612, 792]);
  const ctx = doc.context;
  const m = () => ctx.obj({
    Type: PDFName.of('Measure'), Subtype: PDFName.of('RL'), R: PDFString.of('1.4018 in = 3 ft'),
    X: [ctx.obj({ U: PDFString.of("'"), C: VOET_PER_PT, D: 16, F: PDFName.of('F') })],
    D: [ctx.obj({ U: PDFString.of('"'), C: 12, F: PDFName.of('F'), D: 16, FD: true })],
    A: [ctx.obj({ U: PDFString.of('sf'), C: 1, D: 1 })],
  });
  pagina.node.set(PDFName.of('VP'), ctx.obj([ctx.obj({ Type: PDFName.of('Viewport'), BBox: [0, 0, 612, 792], Measure: m() })]));
  if (metMaat) {
    const annot = ctx.obj({
      Type: 'Annot', Subtype: 'Line', Rect: [130, 590, 190, 680], L: [182.3659, 596.6769, 182.3659, 670.1151],
      LL: 28.32507, LLE: 2, C: [1, 0, 0], IT: PDFName.of('LineDimension'), Measure: m(), Contents: PDFString.of('26 3/16"'),
    });
    pagina.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
  }
  return doc.save();
}

test('alleen inches: laden, langer maken en opslaan houden 26 3/16"', async () => {
  const bron = await inchBlad();
  const [maat] = await laad(bron);
  assert.equal(maat.measureText, '26 3/16"');
  assert.equal(maat.measureUnit, 'in', 'de maat staat in inches (/D rekent voet om)');
  assert.equal(maat.measureFraction, 16);
  assert.ok(Math.abs(maat.measureScale - VOET_PER_PT * 12) < 1e-9, 'inches per punt');

  const lengte = Math.hypot(maat.endX - maat.startX, maat.endY - maat.startY);
  assert.equal(maatlijnTekst(maat, { value: (lengte + 1) * maat.measureScale, unit: maat.measureUnit }), '26 9/16"');

  const uit = await opslaan(bron, [{ ...maat, measureText: undefined }]);
  const [{ dict }] = await woordenboeken(uit);
  const lees = await PDFDocument.load(uit);
  const d = getalopmaakReeks(lees.context.lookup(dict.get(PDFName.of('Measure'))).get(PDFName.of('D')), (v) => lees.context.lookup(v) ?? v);
  assert.deepEqual(opmaakUitGetalopmaken(d), { unit: 'in', fractie: 16, inch: true }, 'een andere lezer ziet alleen inches');
  const [terug] = await laad(uit);
  assert.equal(terug.measureUnit, 'in');
  assert.equal(terug.measureFraction, 16);
});

test('alleen inches op de viewport: een nieuwe maat met de schaal van de pagina toont inches', async () => {
  const bron = await inchBlad({ metMaat: false });
  const [vp] = leesViewportsVanPagina((await PDFDocument.load(bron)).getPage(0));
  assert.equal(vp.unit, 'ft', 'de schaal blijft in voet');
  assert.deepEqual(vp.opmaak, { fractie: 16, inch: true });
  assert.equal(maatlijnTekst({ measurePrecision: 0 }, { value: 26.5514 / 12, unit: 'ft', opmaak: vp.opmaak }), '26 9/16"');

  // Opslaan: de maat volgt de pagina; een andere lezer ziet alleen inches.
  const nieuw = {
    id: 'nieuw', type: 'measureDistance', page: 1, color: '#ff0000', strokeColor: '#ff0000', lineWidth: 1,
    startX: 100, startY: 100, endX: 100 + 73.4382, endY: 100, measurePrecision: 0, opacity: 1,
  };
  const uit = await opslaan(bron, [nieuw], { document: { pdfViewports: { 1: [vp] } } });
  const [{ dict }] = await woordenboeken(uit);
  const lees = await PDFDocument.load(uit);
  const d = getalopmaakReeks(lees.context.lookup(dict.get(PDFName.of('Measure'))).get(PDFName.of('D')), (v) => lees.context.lookup(v) ?? v);
  assert.deepEqual(opmaakUitGetalopmaken(d), { unit: 'in', fractie: 16, inch: true });
});
