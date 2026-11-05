// Metingen uitwisselen met andere markeerprogramma's (GitHub #959).
//
// Beide kanten op, volgens de meetconventies van ISO 32000 (12.9):
// - Een meting van een ander programma (alleen standaardsleutels: /IT
//   /LineDimension, /PolyLineDimension of /PolygonDimension, /Measure met
//   /X, /D en /A, de waarde als tekst in /Contents, bij een maat /LL /LLE
//   /Cap /CP) laadt als meting van de app, met de juiste waarde en schaal.
// - Een meting van de app heeft na opslaan diezelfde standaardsleutels, en de
//   waarde in /Contents is de waarde die een andere lezer uit de geometrie
//   en de schaal van /Measure berekent.
// De eigen OPS_-sleutels blijven voor de rondgang in de app zelf.
//
// Echte saver en echte lader (rondgang.testhulp.mjs).

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString, PDFArray, PDFNumber } from 'pdf-lib';
import { state, opslaan, laad, woordenboeken, leegBlad } from './rondgang.testhulp.mjs';

const meas = await import('../annotations/measurement.js');
const { pixelsPerUnitFor } = await import('../annotations/scale-region-scale.js');
const { lengteEenheid } = await import('../annotations/vlak-zijden.js');
const { huidigeNotatie } = await import('../core/maat-notatie.js');
const { decodePdfTextObject } = await import('./saver/pdf-text.js');
const { meetContents, meettekstUitBestand } = await import('./saver/dimension-measure.js');

const HOOGTE = 842;
// 1:100 in meter per punt.
const M_PER_PT = 25.4 / 72 * 100 / 1000;

// ── hulpjes ─────────────────────────────────────────────────────────────────

/** Een getal uit een meettekst ("7.06 m", "7,06 m", "7056") en het aantal decimalen. */
function getalUit(tekst) {
  const dec = huidigeNotatie().decimaal;
  const kern = String(tekst).trim().match(/^[-+]?[\d.,\s\u00A0\u202F]+/)?.[0].trim() || '';
  const zuiver = kern.split(dec).map((d) => d.replace(/[^\d-]/g, '')).join('.');
  const decimalen = zuiver.includes('.') ? zuiver.split('.')[1].length : 0;
  return { waarde: Number(zuiver), decimalen, eenheid: String(tekst).trim().slice(kern.length).trim() };
}

/** Een blad met één annotatie, alleen standaardsleutels (zoals een ander programma). */
async function vreemdBlad(bouw) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, HOOGTE]);
  const ctx = doc.context;
  const nf = (lijst) => lijst.map((d) => ctx.obj({ ...d, U: PDFString.of(d.U) }));
  const measure = (m) => ctx.obj({
    Type: PDFName.of('Measure'), Subtype: PDFName.of('RL'), R: PDFString.of('1 : 100'),
    X: nf(m.X), D: nf(m.D), A: nf(m.A),
  });
  const annot = ctx.obj(bouw({ ctx, measure }));
  pagina.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
  return doc.save();
}

const METER = {
  X: [{ U: 'm', C: M_PER_PT }],
  D: [{ U: 'm', C: 1, D: 100 }],
  A: [{ U: 'm²', C: 1, D: 100 }],
};

/** De standaardsleutels van het (enige) woordenboek van blad 1. */
async function opgeslagen(bytes) {
  const lijst = await woordenboeken(bytes);
  assert.equal(lijst.length, 1, 'één annotatie');
  const { dict } = lijst[0];
  const ctx = lijst.doc.context;
  const get = (k) => { const v = dict.get(PDFName.of(k)); return v === undefined ? undefined : ctx.lookup(v) ?? v; };
  const tekst = (k) => { const v = get(k); return v === undefined ? undefined : decodePdfTextObject(v); };
  const getallen = (k) => { const v = get(k); return v instanceof PDFArray ? v.asArray().map((n) => ctx.lookup(n).asNumber()) : undefined; };
  const m = get('Measure');
  const formaat = (k) => {
    const arr = m && ctx.lookup(m.get(PDFName.of(k)));
    if (!(arr instanceof PDFArray)) return undefined;
    return arr.asArray().map((r) => {
      const d = ctx.lookup(r);
      const n = (s) => { const v = d.get(PDFName.of(s)); return v instanceof PDFNumber ? v.asNumber() : undefined; };
      return { C: n('C'), D: n('D'), U: decodePdfTextObject(ctx.lookup(d.get(PDFName.of('U')))) };
    });
  };
  return {
    dict, get, tekst, getallen,
    measure: m ? { type: String(m.get(PDFName.of('Type'))), subtype: String(m.get(PDFName.of('Subtype'))),
      X: formaat('X'), D: formaat('D'), A: formaat('A') } : null,
    it: get('IT') ? String(get('IT')) : undefined,
    geerfd: String(get('OPS_ScaleInherited')) === 'true',
  };
}

/** Lengte van een reeks punten [x0 y0 x1 y1 …]. */
function lengte(v) {
  let s = 0;
  for (let i = 2; i < v.length; i += 2) s += Math.hypot(v[i] - v[i - 2], v[i + 1] - v[i - 1]);
  return s;
}

/** Oppervlakte (schoenveter) van een gesloten reeks punten. */
function oppervlak(v) {
  let s = 0;
  const n = v.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += v[2 * i] * v[2 * j + 1] - v[2 * j] * v[2 * i + 1];
  }
  return Math.abs(s) / 2;
}

/** /Contents klopt met de geometrie en de schaal van /Measure, op de afronding na. */
function klopt(contents, verwacht, eenheid, wat) {
  const g = getalUit(contents);
  assert.equal(g.eenheid, eenheid, `${wat}: eenheid in /Contents (${contents})`);
  const marge = 0.5 * 10 ** -g.decimalen + 1e-9;
  assert.ok(Math.abs(g.waarde - verwacht) <= marge, `${wat}: /Contents ${contents} ≈ ${verwacht} ${eenheid}`);
}

function zetDocument(modellen, extra = {}) {
  state.documents = [{
    id: 'meting', filePath: 'C:/meting/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [], currentPage: 1, ...extra,
  }];
  state.activeDocumentIndex = 0;
}

// ── van een ander programma naar de app ─────────────────────────────────────

test('vreemde maat (/LineDimension met /Measure, /LL, /Cap): laadt als maat met de waarde uit /Contents', async () => {
  const bron = await vreemdBlad(({ measure }) => ({
    Type: 'Annot', Subtype: 'Line', Rect: [95, 690, 305, 730], L: [100, 700, 300, 700],
    LL: 20, LLE: 5, Cap: true, CP: PDFName.of('Inline'), LE: [PDFName.of('OpenArrow'), PDFName.of('OpenArrow')],
    C: [0, 0, 1], IT: PDFName.of('LineDimension'), Contents: PDFString.of('7.06 m'), Measure: measure(METER),
  }));
  const [ann] = await laad(bron);
  assert.equal(ann.type, 'measureDistance');
  assert.equal(ann.measureText, '7.06 m');
  assert.ok(Math.abs(ann.measureScale - M_PER_PT) < 1e-12, 'schaal uit /X');
  assert.equal(ann.measureUnit, 'm');
  assert.equal(ann.measurePrecision, 2, '/D 100 = twee decimalen');
  assert.notEqual(ann.leaderStartX, undefined, '/LL geeft hulplijnen');
  assert.ok(Math.abs(Math.hypot(ann.endX - ann.startX, ann.endY - ann.startY) * ann.measureScale - 200 * M_PER_PT) < 1e-9);
});

test('vreemde maat zonder /Contents, /X in m en /D in mm: de app rekent de waarde in mm', async () => {
  const bron = await vreemdBlad(({ measure }) => ({
    Type: 'Annot', Subtype: 'Line', Rect: [95, 690, 305, 710], L: [100, 700, 300, 700],
    C: [0, 0, 1], IT: PDFName.of('LineDimension'),
    Measure: measure({ ...METER, D: [{ U: 'mm', C: 1000, D: 1 }] }),
  }));
  const [ann] = await laad(bron);
  assert.equal(ann.type, 'measureDistance');
  assert.equal(ann.measureUnit, 'mm', 'de eenheid die /D toont');
  assert.ok(Math.abs(ann.measureScale - M_PER_PT * 1000) < 1e-9);
  klopt(ann.measureText, 200 * M_PER_PT * 1000, 'mm', 'berekende maat');
});

test('vreemde omtrekmaat (/PolyLineDimension): met en zonder /Contents de juiste waarde, en /Measure blijft na opslaan', async () => {
  const bouw = (contents) => ({ measure }) => ({
    Type: 'Annot', Subtype: 'PolyLine', Rect: [95, 595, 205, 705], Vertices: [100, 700, 200, 700, 200, 600],
    C: [1, 0, 0], IT: PDFName.of('PolyLineDimension'), Measure: measure(METER),
    ...(contents ? { Contents: PDFString.of(contents) } : {}),
  });
  const [metTekst] = await laad(await vreemdBlad(bouw('7.06 m')));
  assert.equal(metTekst.type, 'measurePerimeter');
  assert.equal(metTekst.measureText, '7.06 m');
  assert.ok(Math.abs(metTekst.measureScale - M_PER_PT) < 1e-12);

  const bron = await vreemdBlad(bouw(null));
  const [zonder] = await laad(bron);
  assert.equal(zonder.type, 'measurePerimeter');
  klopt(zonder.measureText, 200 * M_PER_PT, 'm', 'berekend uit /Measure, niet uit de paginaschaal');

  // Opslaan: de eigen schaal gaat als /Measure terug, niet als paginaschaal.
  const uit = await opgeslagen(await opslaan(bron, [zonder]));
  assert.equal(uit.it, '/PolyLineDimension');
  assert.ok(uit.measure, '/Measure blijft');
  assert.equal(uit.geerfd, false);
  assert.ok(Math.abs(uit.measure.X[0].C - M_PER_PT) < 1e-12);
  assert.equal(uit.measure.X[0].U, 'm');
  const [terug] = await laad(await opslaan(bron, [zonder]));
  assert.ok(Math.abs(terug.measureScale - M_PER_PT) < 1e-12, 'de schaal na heropenen');
});

test('vreemd meetvlak (/PolygonDimension) zonder /Contents: oppervlakte uit /X en /A', async () => {
  const bron = await vreemdBlad(({ measure }) => ({
    Type: 'Annot', Subtype: 'Polygon', Rect: [95, 595, 205, 705], Vertices: [100, 700, 200, 700, 200, 600, 100, 600],
    C: [1, 0, 0], IT: PDFName.of('PolygonDimension'), Measure: measure(METER),
  }));
  const [ann] = await laad(bron);
  assert.equal(ann.type, 'measureArea');
  klopt(ann.measureText, (100 * M_PER_PT) ** 2, 'm²', 'oppervlakte');
  assert.equal(ann.measureUnit, 'm²');
});

// ── van de app naar een ander programma ─────────────────────────────────────

const SCHAAL_100 = { pixelsPerUnit: pixelsPerUnitFor('1:100', 'mm'), unit: 'mm', scaleRatio: '1:100' };
const MM_PER_PT = 1 / SCHAAL_100.pixelsPerUnit;

test('maat van de app: /LineDimension, /Measure, /LL /LLE /Cap /CP en de waarde met eenheid in /Contents', async () => {
  zetDocument([], { measureScale: SCHAAL_100 });
  const ann = {
    id: 'm1', type: 'measureDistance', page: 1, startX: 100, startY: 100, endX: 300, endY: 100,
    leaderStartX: 100, leaderStartY: 130, leaderEndX: 300, leaderEndY: 130,
    strokeColor: '#ff0000', lineWidth: 1, startHead: 'openCircle', endHead: 'openCircle',
  };
  ann.measureText = meas.formatDimensionText(meas.calculateDistance(100, 100, 300, 100, 1));
  assert.match(ann.measureText, /^\d+$/, 'een maat in mm toont alleen het getal');

  const bytes = await opslaan(await leegBlad(), [ann], { document: { measureScale: SCHAAL_100 } });
  const uit = await opgeslagen(bytes);
  assert.equal(uit.it, '/LineDimension');
  assert.equal(uit.measure.type, '/Measure');
  assert.equal(uit.measure.subtype, '/RL');
  assert.equal(uit.geerfd, true, 'de schaal van de pagina, gemarkeerd');
  assert.equal(String(uit.get('Cap')), 'true');
  assert.equal(String(uit.get('CP')), '/Inline');
  assert.ok(Math.abs(uit.get('LL').asNumber()) > 0, '/LL');
  assert.ok(uit.get('LLE').asNumber() > 0, '/LLE');
  const L = uit.getallen('L');
  const { X, D } = uit.measure;
  klopt(uit.tekst('Contents'), lengte(L) * X[0].C * D[0].C, D[0].U, 'maat');
  assert.equal(uit.tekst('Contents'), `${ann.measureText} mm`);
  assert.equal(uit.tekst('OPS_MeasureText'), ann.measureText);
  assert.ok(Math.abs(X[0].C - MM_PER_PT) < 1e-12);

  // Terug in de app: dezelfde tekst, en de maat volgt de pagina.
  const [terug] = await laad(bytes);
  assert.equal(terug.type, 'measureDistance');
  assert.equal(terug.measureText, ann.measureText);
  assert.equal(terug.measureScale, undefined);
});

test('omtrekmaat van de app: /PolyLineDimension met /Measure en een kloppende /Contents', async () => {
  const points = [{ x: 100, y: 100 }, { x: 250, y: 100 }, { x: 250, y: 200 }];
  zetDocument([], { measureScale: SCHAAL_100 });
  const ann = {
    id: 'o1', type: 'measurePerimeter', page: 1, points, strokeColor: '#ff0000', lineWidth: 1,
    measureText: meas.formatMeasurement(meas.calculatePerimeter(points, 1)),
  };
  const bytes = await opslaan(await leegBlad(), [ann], { document: { measureScale: SCHAAL_100 } });
  const uit = await opgeslagen(bytes);
  assert.equal(uit.it, '/PolyLineDimension');
  assert.ok(uit.measure, '/Measure geschreven');
  assert.equal(uit.geerfd, true);
  const { X, D } = uit.measure;
  klopt(uit.tekst('Contents'), lengte(uit.getallen('Vertices')) * X[0].C * D[0].C, D[0].U, 'omtrek');

  const [terug] = await laad(bytes);
  assert.equal(terug.type, 'measurePerimeter');
  assert.equal(terug.measureText, ann.measureText);
  assert.equal(terug.measureScale, undefined, 'blijft de pagina volgen');
});

test('meetvlak van de app: /PolygonDimension met /A in m², gelijk aan de m² in /Contents', async () => {
  const points = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 }];
  zetDocument([], { measureScale: SCHAAL_100 });
  const ann = {
    id: 'v1', type: 'measureArea', page: 1, points, strokeColor: '#ff0000', fillColor: 'none', lineWidth: 1,
    measureText: meas.formatMeasurement(meas.calculateArea(points, null, 1)),
  };
  assert.match(ann.measureText, /m²$/);
  const bytes = await opslaan(await leegBlad(), [ann], { document: { measureScale: SCHAAL_100 } });
  const uit = await opgeslagen(bytes);
  assert.equal(uit.it, '/PolygonDimension');
  assert.equal(uit.geerfd, true);
  const { X, A } = uit.measure;
  assert.equal(A[0].U, 'm²');
  assert.equal(A[0].D, 100, 'twee decimalen, zoals het label');
  klopt(uit.tekst('Contents'), oppervlak(uit.getallen('Vertices')) * X[0].C ** 2 * A[0].C, A[0].U, 'oppervlakte');

  const [terug] = await laad(bytes);
  assert.equal(terug.type, 'measureArea');
  assert.equal(terug.measureText, ann.measureText);
  assert.equal(terug.measureScale, undefined);
});

test('meetvlak met eigen schaal in mm: /A in m² voor andere lezers, de schaal in mm blijft in de app', async () => {
  const points = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 }];
  const ann = {
    id: 'v2', type: 'measureArea', page: 1, points, strokeColor: '#ff0000', fillColor: 'none', lineWidth: 1,
    measureScale: 5, measureUnit: 'mm²', measureShowEdgeLengths: true,
  };
  zetDocument([ann]);
  meas.herberekenVlakMaat(ann);
  const zijden = meas.vlakZijdeTeksten(ann).map((z) => z.tekst);
  const bytes = await opslaan(await leegBlad(), [ann]);
  const uit = await opgeslagen(bytes);
  assert.equal(uit.geerfd, false);
  const { X, A } = uit.measure;
  assert.equal(X[0].C, 5);
  assert.equal(X[0].U, 'mm');
  assert.equal(A[0].U, 'm²');
  klopt(uit.tekst('Contents'), oppervlak(uit.getallen('Vertices')) * X[0].C ** 2 * A[0].C, 'm²', 'oppervlakte');

  const [terug] = await laad(bytes);
  assert.equal(terug.measureScale, 5);
  assert.equal(lengteEenheid(terug.measureUnit), 'mm');
  assert.equal(terug.measureText, ann.measureText);
  zetDocument([terug]);
  assert.deepEqual(meas.vlakZijdeTeksten(terug).map((z) => z.tekst), zijden, 'zijdematen in mm, zoals voorheen');
});

// ── de tekst in /Contents ───────────────────────────────────────────────────

test('meetContents en meettekstUitBestand: eenheid erbij voor andere lezers, de eigen tekst terug', () => {
  assert.deepEqual(meetContents('3530', 'mm'), { contents: '3530 mm', eigen: '3530' });
  assert.deepEqual(meetContents('3,53 m', 'm'), { contents: '3,53 m', eigen: null }, 'met eenheid: ongewijzigd');
  assert.deepEqual(meetContents('', 'mm'), { contents: '', eigen: null });
  assert.equal(meettekstUitBestand('3530 mm', '3530'), '3530');
  assert.equal(meettekstUitBestand('3600 mm', '3530'), '3600 mm', 'door een ander programma gewijzigd');
  assert.equal(meettekstUitBestand('35300', '3530'), '35300');
  assert.equal(meettekstUitBestand('3530 mm', undefined), '3530 mm');
});
