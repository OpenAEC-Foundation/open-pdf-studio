// Snappen op andere lijnen bij gereedschappen met een eerste punt (#997):
// loodrecht vanaf het eerste punt op lijnen van de PDF-tekening en op
// markeringen, plus eindpunt, midden, snijpunt en 'op de lijn' (rand /
// dichtstbijzijnd).
//
// De PDF-tekening wordt hier echt gemaakt (pdf-lib schrijft, PDF.js leest de
// operatorlijst) en gaat door de snap-extractie van de app, met CTM, een
// formulier met eigen matrix en een gedraaide pagina. Snap-engine, extractor
// en state-store draaien echt onder node (zie ../core/app-test-hooks.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import {
  PDFDocument, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix,
  moveTo, lineTo, stroke, drawObject, setLineWidth,
} from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../core/state.ts');
const snap = await import('./snap-engine.js');
const extractor = await import('./pdf-snap-extractor.js');

const STANDAARD = {
  enableObjectSnap: true,
  snapToEndpoints: true,
  snapToMidpoints: true,
  snapToCenters: true,
  snapToVertices: true,
  snapToStartPoints: true,
  snapToEdges: true,
  snapToIntersections: true,
  snapToPerpendicular: true,
  snapToQuadrant: false,
  snapToTangent: false,
  snapToNearest: true,
  snapToPdfContent: true,
  enableGridSnap: false,
  polarTrackingEnabled: false,
  objectSnapRadius: 12,
};

function voorkeuren(over = {}) {
  Object.assign(state.preferences, STANDAARD, over);
}

// Een A4-achtig blad van 400 x 400 pt met lijnen in PDF-ruimte (y omhoog).
async function maakPdf({ rotatie = 0, inhoud }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 400]);
  if (rotatie) page.setRotation(degrees(rotatie));
  inhoud(page, pdf);
  return pdf.save();
}

const lijn = (x1, y1, x2, y2) => [moveTo(x1, y1), lineTo(x2, y2), stroke()];

// Open de PDF als document van de app en laat de snap-extractie lopen.
async function openPdf(bytes) {
  const pdfDoc = await getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false }).promise;
  state.documents = [{
    id: `doc-${Math.random().toString(36).slice(2, 8)}`, filePath: null, pdfDoc,
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [], pageRotations: {},
    selectedAnnotation: null, selectedAnnotations: [],
  }];
  state.activeDocumentIndex = 0;
  extractor.clearPdfVectorCache();
  await extractor.loadAllPdfSnapData();
  assert.ok(extractor.isPdfSnapLoaded(1), 'snap-geometrie van pagina 1 geladen');
  const page = await pdfDoc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const naarScherm = (x, y) => ({
    x: vp.transform[0] * x + vp.transform[2] * y + vp.transform[4],
    y: vp.transform[1] * x + vp.transform[3] * y + vp.transform[5],
  });
  return { doc: state.documents[0], naarScherm };
}

function snapBij(cursor, opties = {}) {
  const doc = state.documents[state.activeDocumentIndex];
  return snap.performSnap(cursor.x, cursor.y, doc?.annotations || [], 1, opties.scale || 1,
    null, opties.punten || null, opties.extra);
}

// Het voetpunt ligt op de lijn a-b en ref -> voet staat er loodrecht op.
function assertLoodrecht(res, ref, a, b, label) {
  assert.equal(res.type, 'perpendicular', `${label}: soort ${res.type}`);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const opLijn = Math.abs((res.x - a.x) * dy - (res.y - a.y) * dx) / len;
  assert.ok(opLijn < 1e-6, `${label}: voetpunt ligt op de lijn (afwijking ${opLijn})`);
  const dot = ((res.x - ref.x) * dx + (res.y - ref.y) * dy) / (len * Math.hypot(res.x - ref.x, res.y - ref.y));
  assert.ok(Math.abs(dot) < 1e-6, `${label}: rechte hoek (cos ${dot})`);
}

test('PDF-lijnwerk: loodrecht op horizontale, verticale en schuine lijn wint van rand en dichtstbij', async () => {
  voorkeuren();
  snap.vergeetVorigeSnap();
  await openPdf(await maakPdf({
    inhoud: (p) => p.pushOperators(
      ...lijn(20, 300, 380, 300),   // horizontaal: scherm y = 100
      ...lijn(300, 20, 300, 260),   // verticaal: scherm x = 300
      ...lijn(20, 20, 220, 220),    // schuin: scherm (20,380)-(220,180)
    ),
  }));

  // Horizontaal: eerste punt (50, 40), cursor schuin naast de lijn.
  const ref1 = { x: 50, y: 40 };
  const r1 = snapBij({ x: 56, y: 103 }, { punten: [ref1] });
  assert.equal(r1.type, 'perpendicular', 'niet langer rand/dichtstbij (#997)');
  assert.ok(Math.abs(r1.x - 50) < 1e-6 && Math.abs(r1.y - 100) < 1e-6, `voet (${r1.x}, ${r1.y})`);

  // Verticaal.
  const ref2 = { x: 200, y: 200 };
  const r2 = snapBij({ x: 298, y: 205 }, { punten: [ref2] });
  assertLoodrecht(r2, ref2, { x: 300, y: 140 }, { x: 300, y: 380 }, 'verticaal');
  assert.ok(Math.abs(r2.y - 200) < 1e-6);

  // Schuin (lijn x + y = 400 op het scherm).
  const ref3 = { x: 80, y: 260 };
  const voet3 = { x: (ref3.x - ref3.y + 400) / 2, y: (ref3.y - ref3.x + 400) / 2 };
  const r3 = snapBij({ x: voet3.x + 3, y: voet3.y + 2 }, { punten: [ref3] });
  assertLoodrecht(r3, ref3, { x: 20, y: 380 }, { x: 220, y: 180 }, 'schuin');
});

test('PDF-lijnwerk: voetpunt buiten de vangstraal of buiten het lijnstuk geeft geen loodrecht', async () => {
  voorkeuren({ snapToEdges: false, snapToNearest: false });
  snap.vergeetVorigeSnap();
  await openPdf(await maakPdf({ inhoud: (p) => p.pushOperators(...lijn(100, 300, 300, 300)) }));
  // Voet op (150, 100), cursor 30 px verder langs de lijn.
  const ver = snapBij({ x: 180, y: 101 }, { punten: [{ x: 150, y: 40 }] });
  assert.equal(ver.snapped, false);
  // Eerste punt voorbij het einde van het lijnstuk: geen voetpunt erop.
  const buiten = snapBij({ x: 330, y: 101 }, { punten: [{ x: 330, y: 40 }] });
  assert.notEqual(buiten.type, 'perpendicular');
});

test('PDF-lijnwerk: zonder loodrecht-voorkeur blijft rand het resultaat', async () => {
  voorkeuren({ snapToPerpendicular: false });
  snap.vergeetVorigeSnap();
  await openPdf(await maakPdf({ inhoud: (p) => p.pushOperators(...lijn(20, 300, 380, 300)) }));
  const r = snapBij({ x: 56, y: 103 }, { punten: [{ x: 50, y: 40 }] });
  assert.equal(r.type, 'edge');
  assert.ok(Math.abs(r.x - 56) < 1e-6 && Math.abs(r.y - 100) < 1e-6);
});

test('PDF-lijnwerk: dichtstbijzijnd werkt op de tekening ook met rand uit', async () => {
  voorkeuren({ snapToEdges: false, snapToPerpendicular: false });
  snap.vergeetVorigeSnap();
  await openPdf(await maakPdf({ inhoud: (p) => p.pushOperators(...lijn(20, 300, 380, 300)) }));
  const r = snapBij({ x: 140, y: 104 });
  assert.equal(r.type, 'nearest');
  assert.ok(Math.abs(r.x - 140) < 1e-6 && Math.abs(r.y - 100) < 1e-6);
});

test('gedraaide pagina (/Rotate 90): loodrecht in schermruimte', async () => {
  voorkeuren();
  snap.vergeetVorigeSnap();
  const { naarScherm } = await openPdf(await maakPdf({
    rotatie: 90,
    inhoud: (p) => p.pushOperators(...lijn(40, 200, 360, 200)),
  }));
  const a = naarScherm(40, 200), b = naarScherm(360, 200);
  // Op een 90 graden gedraaide pagina staat de horizontale PDF-lijn verticaal.
  assert.ok(Math.abs(a.x - b.x) < 1e-6, 'lijn is op het scherm verticaal');
  const ref = { x: a.x - 120, y: (a.y + b.y) / 2 + 37 };
  const r = snapBij({ x: a.x + 2, y: ref.y + 4 }, { punten: [ref] });
  assertLoodrecht(r, ref, a, b, 'gedraaid');
});

test('CTM-geschaalde tekening en formulier met eigen matrix', async () => {
  voorkeuren();
  snap.vergeetVorigeSnap();
  const { naarScherm } = await openPdf(await maakPdf({
    inhoud: (p, pdf) => {
      // 2x geschaald en verschoven: (0,40)-(80,40) wordt (10,90)-(170,90).
      p.pushOperators(pushGraphicsState(), concatTransformationMatrix(2, 0, 0, 2, 10, 10),
        setLineWidth(0.5), ...lijn(0, 40, 80, 40), popGraphicsState());
      // Formulier met /Matrix [0.5 0 0 0.5 200 200]: (0,0)-(0,300) wordt
      // (200,200)-(200,350).
      const fx = pdf.context.formXObject(lijn(0, 0, 0, 300), {
        BBox: [-10, -10, 400, 400], Matrix: [0.5, 0, 0, 0.5, 200, 200],
      });
      const naam = p.node.newXObject('FmSnap', pdf.context.register(fx));
      p.pushOperators(pushGraphicsState(), drawObject(naam), popGraphicsState());
    },
  }));

  const a = naarScherm(10, 90), b = naarScherm(170, 90);
  const ref = { x: 60, y: 200 };
  const r = snapBij({ x: 63, y: a.y - 3 }, { punten: [ref] });
  assertLoodrecht(r, ref, a, b, 'CTM');
  assert.ok(Math.abs(r.x - 60) < 1e-6 && Math.abs(r.y - a.y) < 1e-6);

  const f1 = naarScherm(200, 200), f2 = naarScherm(200, 350);
  const ref2 = { x: 120, y: 100 };
  const r2 = snapBij({ x: f1.x - 3, y: 104 }, { punten: [ref2] });
  assertLoodrecht(r2, ref2, f1, f2, 'formulier');
  assert.ok(Math.abs(r2.x - 200) < 1e-6, `formuliermatrix toegepast (x = ${r2.x})`);
  // Ook het eindpunt van de formulierlijn ligt op de juiste plek.
  const eind = snapBij({ x: f2.x + 1, y: f2.y + 1 });
  assert.equal(eind.type, 'endpoint');
  assert.ok(Math.abs(eind.x - f2.x) < 1e-6 && Math.abs(eind.y - f2.y) < 1e-6);
});

test('een dichterbij gelegen eindpunt wint; ligt het voetpunt dichterbij, dan wint loodrecht', async () => {
  voorkeuren();
  // Lijn tot scherm (380, 100); voetpunt vanaf (375, 40) is (375, 100).
  await openPdf(await maakPdf({ inhoud: (p) => p.pushOperators(...lijn(20, 300, 380, 300)) }));
  const ref = { x: 375, y: 40 };
  snap.vergeetVorigeSnap();
  const bijEind = snapBij({ x: 379, y: 101 }, { punten: [ref] });
  assert.equal(bijEind.type, 'endpoint');
  assert.ok(Math.abs(bijEind.x - 380) < 1e-6 && Math.abs(bijEind.y - 100) < 1e-6);
  snap.vergeetVorigeSnap();
  const bijVoet = snapBij({ x: 375.5, y: 101 }, { punten: [ref] });
  assert.equal(bijVoet.type, 'perpendicular');
  assert.ok(Math.abs(bijVoet.x - 375) < 1e-6);
});

test('geen heen-en-weer springen tussen twee bijna even verre kandidaten', async () => {
  voorkeuren();
  await openPdf(await maakPdf({ inhoud: (p) => p.pushOperators(...lijn(20, 300, 380, 300)) }));
  const ref = { x: 372, y: 40 };   // voet (372, 100), eindpunt (380, 100)
  snap.vergeetVorigeSnap();
  assert.equal(snapBij({ x: 373, y: 100 }, { punten: [ref] }).type, 'perpendicular');
  // Net voorbij het midden (376): de vorige keuze blijft staan.
  assert.equal(snapBij({ x: 377, y: 100 }, { punten: [ref] }).type, 'perpendicular');
  // Duidelijk dichter bij het eindpunt: dan pas wisselt het.
  assert.equal(snapBij({ x: 379.5, y: 100 }, { punten: [ref] }).type, 'endpoint');
  // En terug: het eindpunt blijft tot het voetpunt duidelijk dichterbij ligt.
  assert.equal(snapBij({ x: 375, y: 100 }, { punten: [ref] }).type, 'endpoint');
  assert.equal(snapBij({ x: 372.5, y: 100 }, { punten: [ref] }).type, 'perpendicular');
});

test('vangstraal in schermpixels: bij inzoomen krimpt hij in paginaruimte', async () => {
  voorkeuren({ snapToEdges: false, snapToNearest: false });
  snap.vergeetVorigeSnap();
  await openPdf(await maakPdf({ inhoud: (p) => p.pushOperators(...lijn(20, 300, 380, 300)) }));
  const ref = { x: 50, y: 40 };
  // 8 paginapunten naast de lijn: bij zoom 1 (12 px straal) wel, bij zoom 4 (3 pt) niet.
  assert.equal(snapBij({ x: 50, y: 108 }, { punten: [ref], scale: 1 }).type, 'perpendicular');
  snap.vergeetVorigeSnap();
  assert.equal(snapBij({ x: 50, y: 108 }, { punten: [ref], scale: 4 }).snapped, false);
});

// ─── Markeringen (annotaties) ─────────────────────────────────────────────

function zonderPdf(annotaties) {
  state.documents = [{
    id: 'leeg', filePath: null, pdfDoc: null, currentPage: 1, scale: 1, viewMode: 'single',
    annotations: annotaties, pageRotations: {}, selectedAnnotation: null, selectedAnnotations: [],
  }];
  state.activeDocumentIndex = 0;
  snap.vergeetVorigeSnap();
}

const markLijn = { id: 'm1', type: 'line', page: 1, startX: 20, startY: 150, endX: 180, endY: 150 };
const markPijl = { id: 'm2', type: 'arrow', page: 1, startX: 60, startY: 30, endX: 60, endY: 230 };

test('markeringslijn: op de lijn, eindpunt, midden, snijpunt en loodrecht', () => {
  voorkeuren({ snapToPdfContent: false });
  zonderPdf([markLijn, markPijl]);
  const opLijn = snapBij({ x: 130, y: 153 });
  assert.equal(opLijn.type, 'edge');
  assert.ok(Math.abs(opLijn.x - 130) < 1e-6 && Math.abs(opLijn.y - 150) < 1e-6);

  zonderPdf([markLijn, markPijl]);
  const eind = snapBij({ x: 177, y: 152 });
  assert.equal(eind.type, 'endpoint');
  assert.deepEqual([eind.x, eind.y], [180, 150]);

  zonderPdf([markLijn]);
  const midden = snapBij({ x: 103, y: 151 });
  assert.equal(midden.type, 'midpoint');
  assert.deepEqual([midden.x, midden.y], [100, 150]);

  // Snijpunt van lijn en pijl op (60, 150): ook met rand aan wint het
  // snijpunt (exacte snap) van 'op de lijn'.
  zonderPdf([markLijn, markPijl]);
  const snij = snapBij({ x: 64, y: 147 });
  assert.equal(snij.type, 'intersection');
  assert.deepEqual([snij.x, snij.y], [60, 150]);

  // Loodrecht vanaf het eerste punt van het lijngereedschap (opties).
  zonderPdf([markLijn, markPijl]);
  const ref = { x: 140, y: 60 };
  const lood = snapBij({ x: 143, y: 152 }, { extra: { loodlijnVanaf: ref, vermijdPunt: ref } });
  assertLoodrecht(lood, ref, { x: 20, y: 150 }, { x: 180, y: 150 }, 'markeringslijn');
});

test('polylijn-, vak- en maatlijnzijden: loodrecht vanaf het laatste punt', () => {
  voorkeuren({ snapToPdfContent: false, snapToEdges: false, snapToNearest: false });
  const poly = { id: 'p', type: 'polyline', page: 1, points: [{ x: 0, y: 300 }, { x: 200, y: 300 }, { x: 200, y: 400 }] };
  const vak = { id: 'b', type: 'box', page: 1, x: 300, y: 300, width: 80, height: 60 };
  const maat = { id: 'd', type: 'measureDistance', page: 1, startX: 20, startY: 500, endX: 220, endY: 500 };
  zonderPdf([poly, vak, maat]);
  const ref = { x: 120, y: 200 };
  assertLoodrecht(snapBij({ x: 123, y: 303 }, { punten: [ref] }), ref, { x: 0, y: 300 }, { x: 200, y: 300 }, 'polylijn');
  zonderPdf([poly, vak, maat]);
  const ref2 = { x: 450, y: 310 };
  const rv = snapBij({ x: 383, y: 314 }, { punten: [ref2] });
  assertLoodrecht(rv, ref2, { x: 380, y: 300 }, { x: 380, y: 360 }, 'vak');
  zonderPdf([poly, vak, maat]);
  const ref3 = { x: 60, y: 600 };
  assertLoodrecht(snapBij({ x: 64, y: 497 }, { punten: [ref3] }), ref3, { x: 20, y: 500 }, { x: 220, y: 500 }, 'maatlijn');
  zonderPdf([poly, vak, maat]);
  const mid = snapBij({ x: 122, y: 502 });
  assert.equal(mid.type, 'midpoint', 'midden van de maatlijn');
});

test('het eigen beginpunt is geen snapdoel (geen lijn van lengte nul)', () => {
  voorkeuren({ snapToPdfContent: false, snapToEdges: false, snapToNearest: false });
  zonderPdf([markLijn]);
  // Beginpunt op het eindpunt van de bestaande lijn; cursor er vlak naast.
  const start = { x: 180, y: 150 };
  const r = snapBij({ x: 182, y: 151 }, { extra: { loodlijnVanaf: start, vermijdPunt: start } });
  assert.ok(!(r.snapped && r.x === 180 && r.y === 150), 'niet terug op het beginpunt');
  // Zonder vermijdPunt (bv. hover vóór de eerste klik) wel.
  zonderPdf([markLijn]);
  assert.equal(snapBij({ x: 182, y: 151 }).type, 'endpoint');
});

test('snijpunt van een markeringslijn met een lijn van de tekening', async () => {
  voorkeuren({ snapToEdges: true });
  const { doc } = await openPdf(await maakPdf({ inhoud: (p) => p.pushOperators(...lijn(20, 300, 380, 300)) }));
  doc.annotations.push({ id: 'k', type: 'line', page: 1, startX: 250, startY: 20, endX: 250, endY: 200 });
  snap.vergeetVorigeSnap();
  const r = snapBij({ x: 254, y: 97 });
  assert.equal(r.type, 'intersection');
  assert.ok(Math.abs(r.x - 250) < 1e-6 && Math.abs(r.y - 100) < 1e-6);
});
