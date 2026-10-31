// Een blad op schaal 1:50 meet op ware grootte (#884). De melding: een kast
// van 60 cm diep meet 68 cm, een bed van 200 cm ongeveer 13% te lang (factor
// ≈ 1,134 = 72 / 63,5: een punt telt als 0,4 mm op papier in plaats van
// 25,4 / 72 = 0,3528 mm, of 20 mm per punt bij 1:50 in plaats van 17,64).
//
// Deze tests bouwen echte PDF's (pdf-lib), lezen ze zoals de app dat doet
// (PDF.js voor de paginamaat, de rotatie en de tekst van de titelhoek;
// pdf-viewports.js voor /VP + /Measure) en meten een lijn van 1200 mm
// (24 mm op papier) met het maatgereedschap zelf: klik, beweeg, klik, kant
// kiezen, klik. Elke variant moet 1200 mm geven, niet 1361.
//
// De klikpunten komen uit de paginaruimte van de app: de rechthoek page.view
// (CropBox ∩ MediaBox) met /Rotate toegepast, oorsprong linksboven, y omlaag.
// Zo zet renderer.js de pagina in de viewport (pageW/pageH uit page.view) en
// zo rekent weergave-rotatie.js een schermpunt terug (CSS-pixels / zoom; de
// devicePixelRatio zit alleen in de backing store van het canvas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state, getActiveDocument } = await import('../../core/state.js');
const meting = await import('../../annotations/measurement.js');
const { measureDistanceTool } = await import('./measurement-tool.js');
const { createMeasurePerimeterAnnotation } = await import('../annotation-creators.js');
const { detectScaleInDocument, measureScaleFromTitleBlock } = await import('../../annotations/document-scale.js');
const { schaalUitKalibratie } = await import('../../annotations/kalibratie-schaal.js');
const { pixelsPerUnitFor } = await import('../../annotations/scale-region.js');
const { dimensionMeasure } = await import('../../pdf/saver/dimension-measure.js');
const { scaleStringFromMeasurement, pointsToPaperMm } = await import('../../annotations/scale-from-measurement.js');
const { leesPdfViewports, leesUserUnits, puntNaarAppRuimte, beginViewportLezing, rondViewportLezingAf } = await import('../../pdf/pdf-viewports.js');
const { viewportNaarPagina, viewportNaarScherm } = await import('../../pdf/weergave-rotatie.js');

const PT_PER_MM = 72 / 25.4;
const MM = (mm) => mm * PT_PER_MM;
// A3 liggend, 420 × 297 mm.
const A3 = [MM(420), MM(297)];
// De lijn uit de opdracht: 1200 mm bij 1:50 is 24 mm op papier.
const LIJN_PAPIER_PT = MM(1200 / 50);
// mm per PDF-punt bij 1:50.
const C_1_50_MM = 50 / PT_PER_MM;

// ── Testbladen ──────────────────────────────────────────────────────────────

/**
 * Een blad met een lijn van 24 mm op papier (1200 mm bij 1:50) en, als
 * gevraagd, een titelhoek en /VP-viewports.
 * @param {object} o
 * @param {number[]} [o.media]       MediaBox [x0 y0 x1 y1]
 * @param {number[]} [o.crop]        CropBox
 * @param {number} [o.rotate]        /Rotate
 * @param {number} [o.userUnit]      /UserUnit
 * @param {number} [o.inhoudSchaal]  schaal van de tekening op het blad (A1 → A3: 0,5)
 * @param {number[]} o.lijn          [x0 y0 x1 y1] in gebruikersruimte
 * @param {string[]} [o.titelhoek]   regels tekst rechtsonder
 * @param {object[]} [o.viewports]   /VP-woordenboeken (als gewone objecten)
 */
async function maakBlad(o) {
  const pdf = await PDFDocument.create();
  const media = o.media || [0, 0, A3[0], A3[1]];
  const page = pdf.addPage([media[2] - media[0], media[3] - media[1]]);
  page.setMediaBox(media[0], media[1], media[2] - media[0], media[3] - media[1]);
  if (o.crop) page.setCropBox(o.crop[0], o.crop[1], o.crop[2] - o.crop[0], o.crop[3] - o.crop[1]);
  if (o.rotate) page.setRotation(degrees(o.rotate));
  if (o.userUnit) page.node.set(PDFName.of('UserUnit'), pdf.context.obj(o.userUnit));
  const s = o.inhoudSchaal || 1;
  if (s !== 1) page.pushOperators(pushGraphicsState(), concatTransformationMatrix(s, 0, 0, s, 0, 0));
  const [x0, y0, x1, y1] = o.lijn;
  page.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: 0.5 });
  if (s !== 1) page.pushOperators(popGraphicsState());
  if (o.titelhoek) {
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const tx = (o.crop || media)[2] - MM(80);
    let ty = (o.crop || media)[1] + MM(30);
    for (const regel of o.titelhoek) {
      page.drawText(regel, { x: tx, y: ty, size: 9, font });
      ty -= 12;
    }
  }
  if (o.viewports) page.node.set(PDFName.of('VP'), pdf.context.obj(o.viewports));
  return pdf.save();
}

/** Een /VP-viewport met een /Measure. `x` is de /X-reeks getalopmaken. */
function viewport(bbox, x, r = '1:50', naam = 'plattegrond') {
  return {
    Type: 'Viewport',
    BBox: bbox,
    Name: PDFString.of(naam),
    Measure: { Type: 'Measure', Subtype: 'RL', R: PDFString.of(r), X: x },
  };
}
const opmaak = (u, c, extra = {}) => ({ Type: 'NumberFormat', U: PDFString.of(u), C: c, ...extra });

// ── Het blad lezen zoals de app ─────────────────────────────────────────────

/**
 * Leest het blad zoals loadPDF + renderPage: de paginaruimte uit PDF.js
 * (page.view, /Rotate), de viewports en de /UserUnit per pagina uit pdf-lib
 * (zelfde lezing als loader.js) en de schaal uit de titelhoek
 * (detectScaleInDocument + measureScaleFromTitleBlock, zoals loader.js).
 */
async function leesBlad(bytes) {
  const taak = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true });
  const pdfjs = await taak.promise;
  try {
    const page = await pdfjs.getPage(1);
    const doc = { annotations: [], currentPage: 1, pageRotations: {}, pdfDoc: pdfjs };
    const gevonden = await detectScaleInDocument(doc, 1);
    const pdfLib = await PDFDocument.load(bytes);
    const kenmerk = beginViewportLezing(doc);
    assert.ok(rondViewportLezingAf(doc, kenmerk, leesPdfViewports(pdfLib), leesUserUnits(pdfLib)));
    if (gevonden) doc.measureScale = measureScaleFromTitleBlock(gevonden);
    delete doc.pdfDoc;
    // Paginaruimte zoals renderer.js hem opzet: page.view, na /Rotate.
    const [vx0, vy0, vx1, vy1] = page.view;
    const rotate = page.rotate || 0;
    const naarApp = (x, y) => {
      const [ax, ay] = puntNaarAppRuimte(x, y, page.view, rotate);
      return { x: ax, y: ay };
    };
    // Dezelfde punten via de viewport van PDF.js (scale 1, zonder UserUnit):
    // die moet hetzelfde zeggen, anders klopt de paginaruimte niet.
    const vpPdfjs = page.getViewport({ scale: 1 / (page.userUnit || 1) });
    const viaPdfjs = (x, y) => {
      const [px, py] = vpPdfjs.convertToViewportPoint(x, y);
      return { x: px, y: py };
    };
    return {
      doc, gevonden, naarApp, viaPdfjs, rotate,
      userUnit: page.userUnit || 1,
      view: [vx0, vy0, vx1, vy1],
    };
  } finally {
    await taak.destroy();
  }
}

// ── Meten met het gereedschap ───────────────────────────────────────────────

const nepCanvas = { save() {}, restore() {}, setLineDash() {} };

function metDocument(doc, fn) {
  state.documents.push(doc);
  state.activeDocumentIndex = state.documents.length - 1;
  try {
    return fn(getActiveDocument());
  } finally {
    state.documents.splice(0);
    state.activeDocumentIndex = -1;
    state.dimPoints = [];
    state.isDrawingDimension = false;
    state.measurePoints = null;
  }
}

function metVoorkeuren(waarden, fn) {
  const oud = {};
  for (const sleutel of Object.keys(waarden)) {
    oud[sleutel] = state.preferences[sleutel];
    state.preferences[sleutel] = waarden[sleutel];
  }
  try {
    return fn();
  } finally {
    Object.assign(state.preferences, oud);
  }
}

/** Een maatlijn van a naar b (paginaruimte) met het maatgereedschap. */
function meetMetGereedschap(a, b) {
  const voorvertoning = [];
  let vastgelegd = null;
  const basis = {
    state,
    scale: 1,
    canvasCtx: nepCanvas,
    snap: (x, y) => ({ snapped: false, x, y }),
    snapAngle: (hoek) => hoek,
    snapDistanceTo10: meting.snapDistanceTo10,
    calculateDistance: meting.calculateDistance,
    createAnnotation: (props) => ({ ...props }),
    recordAdd: (ann) => { vastgelegd = ann; },
    redraw() {},
    drawDimension: (_c, opties) => { voorvertoning.push(opties.measureText); },
    drawSnapIndicator() {},
  };
  const knop = { button: 0, shiftKey: false, ctrlKey: false };
  const klik = (p) => measureDistanceTool.onPointerDown({ ...basis, ...p }, knop);
  const beweeg = (p) => measureDistanceTool.onPointerMove({ ...basis, ...p }, knop);
  // Kant kiezen: een punt loodrecht naast het midden.
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const kant = { x: mx - ((b.y - a.y) / len) * 30, y: my + ((b.x - a.x) / len) * 30 };
  klik(a);
  beweeg(b);
  klik(b);
  beweeg(kant);
  klik(kant);
  measureDistanceTool.onDeactivate({ ...basis, x: 0, y: 0 });
  return { voorvertoning, vastgelegd };
}

/** Meet de lijn van het blad (gebruikersruimte) in de app-ruimte. */
function meetLijn(blad, lijn) {
  const a = blad.naarApp(lijn[0], lijn[1]);
  const b = blad.naarApp(lijn[2], lijn[3]);
  // De paginaruimte van de app is die van PDF.js (zonder UserUnit).
  const pa = blad.viaPdfjs(lijn[0], lijn[1]);
  const pb = blad.viaPdfjs(lijn[2], lijn[3]);
  for (const [p, q] of [[a, pa], [b, pb]]) {
    assert.ok(Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6,
      `paginaruimte wijkt af van PDF.js: ${JSON.stringify(p)} ≠ ${JSON.stringify(q)}`);
  }
  return metDocument(blad.doc, () => meetMetGereedschap(a, b));
}

const bijna = (a, b, tol, tekst) => assert.ok(Math.abs(a - b) <= tol, `${tekst}: ${a} ≠ ${b}`);

/** De vastgelegde maat moet 1200 mm zijn, in voorvertoning en annotatie. */
function verwacht1200mm({ voorvertoning, vastgelegd }, tekst) {
  assert.ok(vastgelegd, `${tekst}: geen maatlijn vastgelegd`);
  assert.equal(vastgelegd.measureUnit, 'mm', tekst);
  bijna(vastgelegd.measureValue, 1200, 1e-6, tekst);
  assert.equal(vastgelegd.measureText, '1200', tekst);
  assert.equal(voorvertoning.at(-1), '1200', `${tekst} (voorvertoning)`);
}

// Een horizontale lijn midden op een A3.
const LIJN = [MM(100), MM(150), MM(100) + LIJN_PAPIER_PT, MM(150)];

// ── De schaal alleen in de titelhoek ────────────────────────────────────────

test('A3 at 1:50 with the scale only in the title block measures 1200 mm', async () => {
  const blad = await leesBlad(await maakBlad({
    lijn: LIJN,
    titelhoek: ['PROJECT Woning', 'Blad 1/3', 'Datum 01/09/2026', 'Schaal 1:50', 'Formaat A3'],
  }));
  assert.equal(blad.gevonden?.ratio, 50, 'schaal uit de titelhoek');
  assert.equal(blad.doc.pdfViewports, undefined);
  verwacht1200mm(meetLijn(blad, LIJN), 'titelhoek 1:50');
});

test('a detail scale or a sheet number elsewhere on the sheet does not win over "Schaal 1:50"', async () => {
  // Losse "1:20" en "1/3" staan vóór de gelabelde schaal in de tekst.
  const blad = await leesBlad(await maakBlad({
    lijn: LIJN,
    titelhoek: ['Detail A 1:20', 'Blad 1/3', 'Schaal 1:50'],
  }));
  assert.equal(blad.gevonden?.ratio, 50);
  verwacht1200mm(meetLijn(blad, LIJN), 'titelhoek met detailschaal');
});

test('the loader turns a title-block scale into points per mm the way leesBlad does', () => {
  // leesBlad herhaalt de omrekening uit loadPDF; dit houdt die twee gelijk.
  const loader = readFileSync(new URL('../../pdf/loader.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(loader, /doc\.measureScale = measureScaleFromTitleBlock\(result\);/);
  assert.match(loader, /await detectScaleFromPdf\(1, doc\)/);
  assert.match(loader, /leesPdfViewports\(pdfLibDoc\) : null, geldig \? leesUserUnits\(pdfLibDoc\) : null\)/);
});

test('the title-block scale is the same as a 1:50 scale region and the calibration dialog', () => {
  const auto = 72 / (25.4 * 50);
  bijna(pixelsPerUnitFor('1:50', 'mm'), auto, 1e-15, 'schaalgebied');
  bijna(schaalUitKalibratie({ method: 'ratio', denominator: 50, unit: 'mm' }).pixelsPerUnit, auto, 1e-15, 'kalibratie');
  // 24 mm op papier is 1200 mm, geen 1360 (0,4 mm per punt).
  bijna(LIJN_PAPIER_PT / auto, 1200, 1e-9, '24 mm op papier');
});

// ── /VP + /Measure uit de PDF ───────────────────────────────────────────────

const BBOX = [MM(20), MM(60), MM(320), MM(280)];

const MEASURE_VARIANTEN = [
  ['/C in mm per point, /R "1:50"', [opmaak('mm', C_1_50_MM, { D: 1 })], '1:50', 'mm', 1200],
  ['/R "1 mm = 50 mm"', [opmaak('mm', C_1_50_MM, { D: 1 })], '1 mm = 50 mm', 'mm', 1200],
  ['/X in cm with /D 10, then mm', [opmaak('cm', C_1_50_MM / 10, { D: 10 }), opmaak('mm', 10, { D: 1 })], '1 cm = 50 cm', 'cm', 120],
  ['/X in m with /D 100', [opmaak('m', C_1_50_MM / 1000, { D: 100, F: PDFName.of('D') })], '1:50', 'm', 1.2],
  ['/X in inches', [opmaak('in', 50 / 72, { D: 16 })], '1 in = 50 in', 'in', 1200 / 25.4],
  ['/X in feet, then inches', [opmaak('ft', 50 / 864, { D: 1 }), opmaak('in', 12, { D: 16 })], '1 in = 4\'-2"', 'ft', 1200 / 304.8],
];

for (const [naam, x, r, eenheid, waarde] of MEASURE_VARIANTEN) {
  test(`a 1:50 /VP viewport with ${naam} measures 1200 mm`, async () => {
    const blad = await leesBlad(await maakBlad({ lijn: LIJN, viewports: [viewport(BBOX, x, r)] }));
    const [vp] = blad.doc.pdfViewports[1];
    assert.equal(vp.unit, eenheid);
    bijna(vp.mmPerPoint, C_1_50_MM, 1e-9, 'mm per punt');
    const { vastgelegd } = meetLijn(blad, LIJN);
    assert.equal(vastgelegd.measureUnit, eenheid);
    bijna(vastgelegd.measureValue, waarde, 1e-6 * waarde, naam);
  });
}

test('a /VP viewport wins over a different title-block scale, and only inside its BBox', async () => {
  const blad = await leesBlad(await maakBlad({
    lijn: LIJN,
    titelhoek: ['Schaal 1:100'],
    viewports: [viewport(BBOX, [opmaak('mm', C_1_50_MM)])],
  }));
  assert.equal(blad.gevonden?.ratio, 100);
  verwacht1200mm(meetLijn(blad, LIJN), 'binnen de viewport');
  // Buiten de BBox geldt de titelhoek (1:100): dezelfde 24 mm is 2400 mm.
  const buiten = [MM(340), MM(40), MM(340) + LIJN_PAPIER_PT, MM(40)];
  const { vastgelegd } = meetLijn(blad, buiten);
  bijna(vastgelegd.measureValue, 2400, 1e-6, 'buiten de viewport');
});

test('a smaller 1:20 detail viewport elsewhere on the sheet does not take over the 1:50 plan', async () => {
  const detail = [MM(330), MM(150), MM(410), MM(280)];
  const blad = await leesBlad(await maakBlad({
    lijn: LIJN,
    viewports: [
      viewport(BBOX, [opmaak('mm', C_1_50_MM)], '1:50', 'plattegrond'),
      viewport(detail, [opmaak('mm', 20 / PT_PER_MM)], '1:20', 'detail'),
    ],
  }));
  verwacht1200mm(meetLijn(blad, LIJN), 'plattegrond naast detail');
});

// ── Paginageometrie: CropBox, /Rotate, /UserUnit ────────────────────────────

test('a CropBox smaller than and offset in the MediaBox keeps 1200 mm (title block and /VP)', async () => {
  // MediaBox A2 met negatieve oorsprong, CropBox het A3-deel.
  const media = [-MM(50), -MM(30), MM(544), MM(390)];
  const crop = [MM(10), MM(20), MM(430), MM(317)];
  const lijn = [MM(110), MM(170), MM(110) + LIJN_PAPIER_PT, MM(170)];
  const bbox = [MM(30), MM(80), MM(330), MM(300)];
  for (const variant of ['titelhoek', 'viewport']) {
    const blad = await leesBlad(await maakBlad({
      media, crop, lijn,
      titelhoek: variant === 'titelhoek' ? ['Schaal 1:50'] : undefined,
      viewports: variant === 'viewport' ? [viewport(bbox, [opmaak('mm', C_1_50_MM)])] : undefined,
    }));
    bijna(blad.view[2] - blad.view[0], MM(420), 1e-6, 'zichtbare breedte is de CropBox');
    verwacht1200mm(meetLijn(blad, lijn), `CropBox, ${variant}`);
  }
});

for (const rotate of [90, 180, 270]) {
  test(`a sheet with /Rotate ${rotate} measures 1200 mm (title block and /VP)`, async () => {
    // Staand MediaBox; de lijn loopt verticaal in de gebruikersruimte en ligt
    // na /Rotate 90/270 horizontaal op het scherm.
    const media = [0, 0, A3[1], A3[0]];
    const lijn = [MM(150), MM(100), MM(150), MM(100) + LIJN_PAPIER_PT];
    const bbox = [MM(60), MM(20), MM(280), MM(320)];
    for (const variant of ['titelhoek', 'viewport']) {
      const blad = await leesBlad(await maakBlad({
        media, rotate, lijn,
        titelhoek: variant === 'titelhoek' ? ['Schaal 1:50'] : undefined,
        viewports: variant === 'viewport' ? [viewport(bbox, [opmaak('mm', C_1_50_MM)])] : undefined,
      }));
      assert.equal(blad.rotate, rotate);
      verwacht1200mm(meetLijn(blad, lijn), `/Rotate ${rotate}, ${variant}`);
    }
  });
}

test('/UserUnit 2: a /VP whose /C is per user unit measures 1200 mm in the app page space', async () => {
  // Een A3 als 595 × 421 eenheden van 2/72 inch. De app-ruimte is page.view
  // in eenheden (renderer.js); /C telt per eenheid (ISO 32000, 12.9).
  const media = [0, 0, A3[0] / 2, A3[1] / 2];
  const lijn = [MM(50), MM(75), MM(50) + LIJN_PAPIER_PT / 2, MM(75)];
  const blad = await leesBlad(await maakBlad({
    media, userUnit: 2, lijn,
    viewports: [viewport([0, 0, MM(210), MM(148)], [opmaak('mm', C_1_50_MM * 2)])],
  }));
  assert.equal(blad.userUnit, 2);
  verwacht1200mm(meetLijn(blad, lijn), '/UserUnit 2, viewport');
});

// /UserUnit en elke schaalbron (#884). De paginaruimte van de app telt in
// eenheden van page.view; één eenheid is UserUnit/72 inch. Een schaal 1:N
// (titelhoek, kalibratie op schaalverhouding, schaalgebied) rekent daarom
// met de /UserUnit van de pagina, net als /VP (per eenheid). Zonder dat mat
// een 1200 mm-lijn 600 mm bij u = 2 en 1361 mm (de 13% uit #884) bij
// u ≈ 0,882. Een referentielijn en de snelle schaal meten in
// pagina-eenheden en kloppen vanzelf.

/** Een A3 in eenheden van u/72 inch, met de lijn van 24 mm op papier. */
async function userUnitBlad(u, extra = {}) {
  const media = [0, 0, A3[0] / u, A3[1] / u];
  const lijn = [MM(50) / u, MM(75) / u, (MM(50) + LIJN_PAPIER_PT) / u, MM(75) / u];
  const blad = await leesBlad(await maakBlad({ media, userUnit: u, lijn, ...extra }));
  assert.equal(blad.userUnit, u, 'PDF.js leest de /UserUnit');
  if (u !== 1) assert.deepEqual(blad.doc.pageUserUnits, { 1: u }, 'de app leest de /UserUnit');
  return { blad, lijn };
}

for (const u of [2, 0.882]) {
  test(`/UserUnit ${u}: "Schaal 1:50" in the title block measures 1200 mm`, async () => {
    const { blad, lijn } = await userUnitBlad(u, { titelhoek: ['Schaal 1:50'] });
    assert.equal(blad.gevonden?.ratio, 50);
    assert.equal(blad.gevonden?.userUnit, u);
    verwacht1200mm(meetLijn(blad, lijn), `/UserUnit ${u}, titelhoek`);
  });

  test(`/UserUnit ${u}: calibration on the ratio tab (1:50, mm and cm) measures 1200 mm`, async () => {
    const { blad, lijn } = await userUnitBlad(u);
    blad.doc.measureScale = schaalUitKalibratie({ method: 'ratio', denominator: 50, unit: 'mm', userUnit: u });
    verwacht1200mm(meetLijn(blad, lijn), `/UserUnit ${u}, kalibratie mm`);
    blad.doc.measureScale = schaalUitKalibratie({ method: 'ratio', denominator: 50, unit: 'cm', userUnit: u });
    bijna(meetLijn(blad, lijn).vastgelegd.measureValue, 120, 1e-9, `/UserUnit ${u}, kalibratie cm`);
  });

  test(`/UserUnit ${u}: calibration on a reference line and the quick scale measure a 2000 mm bed`, async () => {
    const { blad, lijn } = await userUnitBlad(u);
    const lengte = Math.hypot(lijn[2] - lijn[0], lijn[3] - lijn[1]);
    const bed = [MM(50) / u, MM(150) / u, (MM(50) + MM(2000 / 50)) / u, MM(150) / u];
    blad.doc.measureScale = schaalUitKalibratie({ method: 'reference', distance: 1200, pixels: lengte, unit: 'mm', userUnit: u });
    bijna(meetLijn(blad, bed).vastgelegd.measureValue, 2000, 1e-6, `/UserUnit ${u}, referentielijn`);
    blad.doc.measureScale = null;
    const oudeVoorkeuren = { ...state.preferences };
    try {
      metDocument(blad.doc, () => meting.setScaleFromLine(lengte, 1200, 'mm', null));
      bijna(meetLijn(blad, bed).vastgelegd.measureValue, 2000, 1e-6, `/UserUnit ${u}, snelle schaal`);
    } finally {
      Object.assign(state.preferences, oudeVoorkeuren);
    }
  });

  test(`/UserUnit ${u}: a 1:50 scale region measures 1200 mm and writes /Measure per user unit`, async () => {
    const { blad, lijn } = await userUnitBlad(u);
    const a = blad.naarApp(lijn[0], lijn[1]);
    const b = blad.naarApp(lijn[2], lijn[3]);
    blad.doc.annotations.push({
      type: 'scaleRegion', id: 'sr-uu', page: 1,
      x: a.x - 10, y: a.y - 20, width: b.x - a.x + 20, height: 40,
      scaleString: '1:50', units: 'mm',
    });
    verwacht1200mm(meetLijn(blad, lijn), `/UserUnit ${u}, schaalgebied`);
    // Het /Measure dat de saver schrijft telt per eenheid van de pagina (/X
    // /C), net als een /VP: na heropenen geen tweede keer de /UserUnit.
    const maat = dimensionMeasure({ page: 1, startX: a.x, startY: a.y, endX: b.x, endY: b.y }, blad.doc);
    assert.equal(maat.inherited, true);
    bijna(maat.scale, C_1_50_MM * u, 1e-9, '/C in mm per eenheid');
    bijna(Math.hypot(b.x - a.x, b.y - a.y) * maat.scale, 1200, 1e-6, 'lengte via /Measure');
  });

  test(`/UserUnit ${u}: "measure on drawing" derives 1:50 and shows 24 mm on paper`, async () => {
    const { blad, lijn } = await userUnitBlad(u);
    const a = blad.naarApp(lijn[0], lijn[1]);
    const b = blad.naarApp(lijn[2], lijn[3]);
    const lengte = Math.hypot(b.x - a.x, b.y - a.y);
    bijna(pointsToPaperMm(lengte, u), 24, 1e-9, 'papierlengte');
    assert.equal(scaleStringFromMeasurement(lengte, 1200, 'mm', u), '1:50');
  });
}

test('without /UserUnit the page has no pageUserUnits and every 1:N source is unchanged', async () => {
  const { blad } = await userUnitBlad(1, { titelhoek: ['Schaal 1:50'] });
  assert.equal(blad.doc.pageUserUnits, undefined);
  assert.equal(blad.gevonden?.userUnit, 1);
  assert.equal(pixelsPerUnitFor('1:50', 'mm'), pixelsPerUnitFor('1:50', 'mm', 1));
  assert.equal(pixelsPerUnitFor('1:50', 'mm', 0), pixelsPerUnitFor('1:50', 'mm'), 'onbruikbare /UserUnit telt als 1');
  assert.equal(pixelsPerUnitFor('1:50', 'mm', NaN), pixelsPerUnitFor('1:50', 'mm'));
});

// ── A1-blad verkleind op A3 ─────────────────────────────────────────────────

test('an A1 sheet printed on A3 with "Schaal 1:50 (A1)" reads 1:50 and measures half: a factor 2, not 1.134', async () => {
  // De tekening (1:50 op A1) staat verkleind op A3 (factor 0,5). De titelhoek
  // noemt de schaal van het A1-origineel; de app leest 1:50 en meet dus de
  // helft. Dat is de bekende dubbelzinnigheid van "1:50 (A1)", geen 13%.
  const blad = await leesBlad(await maakBlad({
    inhoudSchaal: 0.5,
    lijn: [MM(200), MM(300), MM(200) + LIJN_PAPIER_PT, MM(300)],
    titelhoek: ['Schaal 1:50 (A1)'],
  }));
  assert.equal(blad.gevonden?.ratio, 50);
  const { vastgelegd } = meetLijn(blad, [MM(100), MM(150), MM(100) + LIJN_PAPIER_PT / 2, MM(150)]);
  bijna(vastgelegd.measureValue, 600, 1e-6, 'A1 op A3');
});

// ── Kalibreren en daarna meten ──────────────────────────────────────────────

test('calibrating 1:50 (ratio tab, mm and cm) and then measuring gives 1200 mm / 120 cm', async () => {
  const blad = await leesBlad(await maakBlad({ lijn: LIJN }));
  assert.equal(blad.gevonden, null);
  blad.doc.measureScale = schaalUitKalibratie({ method: 'ratio', denominator: 50, unit: 'mm' });
  verwacht1200mm(meetLijn(blad, LIJN), 'kalibratie 1:50 mm');
  blad.doc.measureScale = schaalUitKalibratie({ method: 'ratio', denominator: 50, unit: 'cm' });
  const { vastgelegd } = meetLijn(blad, LIJN);
  assert.equal(vastgelegd.measureUnit, 'cm');
  bijna(vastgelegd.measureValue, 120, 1e-9, 'kalibratie 1:50 cm');
  assert.equal(vastgelegd.measureText, '120.0 cm');
});

test('calibrating on the 1200 mm line (reference tab) and then measuring a 2000 mm bed gives 2000 mm', async () => {
  const blad = await leesBlad(await maakBlad({ lijn: LIJN }));
  // De dialoog krijgt de referentielengte afgerond op 0,01 pt.
  const pixels = Math.round(LIJN_PAPIER_PT * 100) / 100;
  blad.doc.measureScale = schaalUitKalibratie({ method: 'reference', distance: 1200, pixels, unit: 'mm' });
  const bed = [MM(100), MM(100), MM(100) + MM(2000 / 50), MM(100)];
  const { vastgelegd } = meetLijn(blad, bed);
  // Afronding van de referentie geeft hooguit een paar tienden van een mm.
  bijna(vastgelegd.measureValue, 2000, 0.5, 'bed na referentiekalibratie');
  assert.equal(vastgelegd.measureText, '2000');
});

test('quick scale from a dimension (setScaleFromLine) and then a new measurement gives 2000 mm', async () => {
  const blad = await leesBlad(await maakBlad({ lijn: LIJN }));
  const bed = [MM(100), MM(100), MM(100) + MM(2000 / 50), MM(100)];
  const oudeVoorkeuren = { ...state.preferences };
  try {
    metDocument(blad.doc, () => {
      meting.setScaleFromLine(LIJN_PAPIER_PT, 1200, 'mm', null);
    });
    const { vastgelegd } = meetLijn(blad, bed);
    bijna(vastgelegd.measureValue, 2000, 1e-6, 'bed na snelle schaal');
    assert.equal(vastgelegd.measureText, '2000');
  } finally {
    Object.assign(state.preferences, oudeVoorkeuren);
  }
});

test('a cabinet of 600 mm and a bed of 2000 mm at 1:50 (the report) measure 600 and 2000, also as perimeter', async () => {
  const blad = await leesBlad(await maakBlad({ lijn: LIJN, titelhoek: ['Schaal 1:50'] }));
  const kast = [MM(100), MM(200), MM(100) + MM(600 / 50), MM(200)];
  const bed = [MM(100), MM(100), MM(100), MM(100) + MM(2000 / 50)];
  assert.equal(meetLijn(blad, kast).vastgelegd.measureText, '600');
  assert.equal(meetLijn(blad, bed).vastgelegd.measureText, '2000');
  metDocument(blad.doc, () => {
    const a = blad.naarApp(bed[0], bed[1]);
    const b = blad.naarApp(bed[2], bed[3]);
    const ann = createMeasurePerimeterAnnotation([a, b]);
    assert.equal(ann.measureText, '2000 mm');
  });
});

// ── Documentschaal tegenover een schaalgebied ───────────────────────────────

test('a 1:50 scale region inside a 1:100 document scale measures 1200 mm, outside 2400 mm', async () => {
  const blad = await leesBlad(await maakBlad({ lijn: LIJN, titelhoek: ['Schaal 1:100'] }));
  const a = blad.naarApp(LIJN[0], LIJN[1]);
  blad.doc.annotations.push({
    type: 'scaleRegion', id: 'sr1', page: 1,
    x: a.x - 20, y: a.y - 40, width: LIJN_PAPIER_PT + 40, height: 80,
    scaleString: '1:50', units: 'mm',
  });
  verwacht1200mm(meetLijn(blad, LIJN), 'schaalgebied 1:50');
  const buiten = [MM(300), MM(40), MM(300) + LIJN_PAPIER_PT, MM(40)];
  bijna(meetLijn(blad, buiten).vastgelegd.measureValue, 2400, 1e-6, 'buiten het schaalgebied');
});

// ── Zoom en devicePixelRatio ────────────────────────────────────────────────

test('screen to page at any zoom and view rotation gives the same 1200 mm (no dpr in the page space)', async () => {
  const blad = await leesBlad(await maakBlad({ lijn: LIJN, titelhoek: ['Schaal 1:50'] }));
  const a = blad.naarApp(LIJN[0], LIJN[1]);
  const b = blad.naarApp(LIJN[2], LIJN[3]);
  // zoom is CSS-pixels per punt: 100% · schermschaal 1,25 / 1,5 / 1,75 maakt
  // het canvas scherper (backing store × dpr), niet de zoom zelf.
  for (const zoom of [0.5, 1, 1.25, 1.5, 4 / 3, 1.75, 2.37]) {
    for (const viewRotation of [0, 90, 180, 270]) {
      const vp = { pageW: A3[0], pageH: A3[1], rotation: 0, viewRotation, zoom, offsetX: 37, offsetY: -12 };
      const sa = viewportNaarScherm(vp, a.x, a.y);
      const sb = viewportNaarScherm(vp, b.x, b.y);
      bijna(Math.hypot(sb.x - sa.x, sb.y - sa.y), LIJN_PAPIER_PT * zoom, 1e-9, 'lengte op het scherm');
      const pa = viewportNaarPagina(vp, sa.x, sa.y);
      const pb = viewportNaarPagina(vp, sb.x, sb.y);
      const { vastgelegd } = metDocument(blad.doc, () => meetMetGereedschap(pa, pb));
      bijna(vastgelegd.measureValue, 1200, 1e-6, `zoom ${zoom}, weergave ${viewRotation}`);
    }
  }
});

// ── Zonder schaalbron ───────────────────────────────────────────────────────

test('without any scale source the dimension tool falls back to 1 pt = 1 mm (shows "68" for the 24 mm line)', async () => {
  // Geen 13%-fout maar de voorkeursschaal (#554): 24 mm op papier is 68,03 pt.
  const blad = await leesBlad(await maakBlad({ lijn: LIJN }));
  metVoorkeuren({ measureDistDimScale: 1, measureDistDimUnit: 'mm' }, () => {
    const { vastgelegd } = meetLijn(blad, LIJN);
    assert.equal(vastgelegd.measureText, '68');
    assert.equal(vastgelegd.measureScale, 1);
  });
});
