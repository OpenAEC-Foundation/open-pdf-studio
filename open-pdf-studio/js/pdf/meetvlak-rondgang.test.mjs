// Meetvlak met zijdematen en eigen schaal: opslaan en heropenen met de echte
// saver (saver-test-hooks.mjs) en de echte lader (GitHub #536).
//
// - De zijdematen staan aan of uit per meetvlak (measureShowEdgeLengths) en
//   gaan als OPS_EdgeLengths mee; staan ze aan, dan staan de maten ook in de
//   appearance, zodat andere lezers ze tonen, binnen de /Rect.
// - Een eigen schaal (measureScale + eenheid) gaat mee als standaard
//   /Measure-woordenboek (/X lengte, /A oppervlakte); de lader kende dat al.
// - Een meetvlak zonder die twee wordt opgeslagen als voorheen, met de schaal
//   van de pagina in /Measure voor andere programma's (OPS_ScaleInherited,
//   #959); de app volgt na heropenen gewoon weer de pagina.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const meas = await import('../annotations/measurement.js');
const { lengteEenheid } = await import('../annotations/vlak-zijden.js');
const { decodePdfTextObject } = await import('./saver/pdf-text.js');
const { applyResize } = await import('../annotations/transforms.js');
const { cloneAnnotation } = await import('../annotations/factory.js');

const HOOGTE = 842;

async function leegBlad({ rotatie = 0 } = {}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, HOOGTE]);
  if (rotatie) pagina.node.set(PDFName.of('Rotate'), doc.context.obj(rotatie));
  return doc.save();
}

/** De modellen zoals js/pdf/loader.js ze aanmaakt. */
async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const modellen = [];
  for (const annot of await pagina.getAnnotations()) {
    modellen.push(await convertPdfAnnotation(annot, 1, viewport, new Map(), kaart));
  }
  await doc.loadingTask.destroy();
  return modellen.filter(Boolean);
}

function document(modellen) {
  state.documents = [{
    id: 'rondgang', filePath: 'C:/rondgang/bron.pdf', pdfDoc: {}, annotations: modellen,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [], currentPage: 1,
  }];
  state.activeDocumentIndex = 0;
}

/** Opslaan met de echte saver, op de bytes van het geopende bestand. */
async function opslaan(bronBytes, modellen) {
  let uit = null;
  globalThis.__saverTest = {
    impl: {
      getCachedPdfBytes: () => bronBytes,
      writeBinaryFile: (_pad, bytes) => { uit = bytes; return true; },
      writeBinaryFileAtomic: (_pad, bytes) => { uit = bytes; return true; },
    },
  };
  document(modellen);
  assert.equal(await savePDF('C:/rondgang/uit.pdf', { zonderHandtekeningVraag: true }), true, 'opslaan gelukt');
  return uit;
}

/** Het (enige) /Polygon-woordenboek van blad 1 met zijn appearance. */
async function veelhoek(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const [d] = doc.getPage(0).node.Annots().asArray().map((ref) => ctx.lookup(ref))
    .filter((x) => x.get(PDFName.of('Subtype'))?.toString() === '/Polygon');
  const n = ctx.lookup(ctx.lookup(d.get(PDFName.of('AP'))).get(PDFName.of('N')));
  return {
    dict: d,
    ctx,
    rect: ctx.lookup(d.get(PDFName.of('Rect'))).asArray().map((x) => x.asNumber()),
    ap: new TextDecoder().decode(n.getContents()),
  };
}

/** Tekst en basislijnpunt (PDF) van elke Tm…Tj in de appearance. */
function apTeksten(ap) {
  return [...ap.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm\n\((.*?)\) Tj/g)]
    .map((m) => ({ a: +m[1], b: +m[2], x: +m[5], y: +m[6], tekst: m[7] }));
}

/** Een meetvlak van 200 × 100 punt op (100,100), zoals het gereedschap het maakt. */
function meetvlak(extra = {}) {
  const ann = {
    id: 'ma1', type: 'measureArea', page: 1,
    points: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 }],
    color: '#ff0000', strokeColor: '#ff0000', fillColor: null, lineWidth: 1, opacity: 1,
    borderStyle: 'solid', hatchPattern: 'none', author: 'Tester',
    createdAt: '2026-10-01T10:00:00.000Z', modifiedAt: '2026-10-01T10:00:00.000Z',
    ...extra,
  };
  document([ann]);
  meas.herberekenVlakMaat(ann);
  return ann;
}

test('zijdematen en eigen schaal: in het bestand, in de appearance en terug na heropenen', async () => {
  const ann = meetvlak({ measureShowEdgeLengths: true, measureScale: 0.5, measureUnit: 'cm' });
  assert.equal(ann.measureText, '5000.00 cm\u00B2');
  const voor = meas.vlakZijdeTeksten(ann).map((z) => z.tekst);
  assert.deepEqual(voor, ['100.0 cm', '50.0 cm', '100.0 cm', '50.0 cm']);

  const bytes = await opslaan(await leegBlad(), [ann]);
  const { dict, ctx, rect, ap } = await veelhoek(bytes);

  // Eigen sleutel voor de zijdematen.
  assert.equal(ctx.lookup(dict.get(PDFName.of('OPS_EdgeLengths')))?.toString(), 'true');

  // De eigen schaal als /Measure.
  const measure = ctx.lookup(dict.get(PDFName.of('Measure')));
  assert.ok(measure, '/Measure geschreven');
  const x = ctx.lookup(ctx.lookup(measure.get(PDFName.of('X'))).get(0));
  assert.equal(ctx.lookup(x.get(PDFName.of('C'))).asNumber(), 0.5);
  assert.equal(decodePdfTextObject(ctx.lookup(x.get(PDFName.of('U')))), 'cm');
  const a = ctx.lookup(ctx.lookup(measure.get(PDFName.of('A'))).get(0));
  assert.equal(decodePdfTextObject(ctx.lookup(a.get(PDFName.of('U')))), 'cm\u00B2');

  // De maten in de appearance: de vier zijden en het oppervlaktelabel.
  const teksten = apTeksten(ap);
  assert.deepEqual(teksten.map((t) => t.tekst).sort(), ['100.0 cm', '100.0 cm', '50.0 cm', '50.0 cm']);
  assert.match(ap, /\(5000\.00 cm\\262\) Tj/, 'het oppervlaktelabel blijft');
  // Rechtop: van links naar rechts, of staand van onder naar boven (zoals een
  // maatlijn, maat-label.js). (a, b) is de leesrichting in de PDF.
  for (const t of teksten) {
    assert.ok(t.a > 1e-9 || (Math.abs(t.a) <= 1e-9 && t.b > 0), `${t.tekst} leest rechtop (a=${t.a}, b=${t.b})`);
  }
  // Alle maten binnen de /Rect, en die reikt tot buiten het vlak.
  for (const t of teksten) {
    assert.ok(t.x >= rect[0] && t.x <= rect[2] && t.y >= rect[1] && t.y <= rect[3], `${t.tekst} binnen de /Rect`);
  }
  assert.ok(rect[1] < HOOGTE - 200 - 5, 'onder de onderzijde');
  assert.ok(rect[3] > HOOGTE - 100 + 5, 'boven de bovenzijde');
  assert.ok(rect[0] < 100 - 5 && rect[2] > 300 + 5, 'links en rechts van het vlak');

  // Heropenen: dezelfde instellingen en dezelfde maten.
  const [terug] = await laad(bytes);
  assert.equal(terug.type, 'measureArea');
  assert.equal(terug.measureShowEdgeLengths, true);
  assert.equal(terug.measureScale, 0.5);
  assert.equal(lengteEenheid(terug.measureUnit), 'cm');
  assert.equal(terug.measureText, '5000.00 cm\u00B2');
  document([terug]);
  assert.deepEqual(meas.vlakZijdeTeksten(terug).map((z) => z.tekst), voor);
  meas.herberekenVlakMaat(terug);
  assert.equal(terug.measureText, '5000.00 cm\u00B2', 'herrekenen na heropenen geeft hetzelfde');
});

test('een meetvlak zonder zijdematen en zonder eigen schaal: zoals voorheen, met de paginaschaal in /Measure', async () => {
  const ann = meetvlak();
  const bytes = await opslaan(await leegBlad(), [ann]);
  const { dict, ctx, rect, ap } = await veelhoek(bytes);
  assert.equal(dict.get(PDFName.of('OPS_EdgeLengths')), undefined);
  assert.ok(ctx.lookup(dict.get(PDFName.of('Measure'))), 'de schaal van de pagina in /Measure');
  assert.equal(String(dict.get(PDFName.of('OPS_ScaleInherited'))), 'true');
  assert.equal(apTeksten(ap).length, 0, 'geen gedraaide zijdematen');
  assert.equal((ap.match(/\) Tj/g) || []).length, 1, 'alleen het oppervlaktelabel');
  assert.deepEqual(rect, [98, HOOGTE - 202, 302, HOOGTE - 98], 'de /Rect van altijd');

  const [terug] = await laad(bytes);
  assert.notEqual(terug.measureShowEdgeLengths, true, 'standaard uit na heropenen');
  assert.ok(!terug.measureScale);
});

test('op een gedraaide pagina: maten rechtop op de pagina zoals hij getoond wordt, en terug na heropenen', async () => {
  const bron = await leegBlad({ rotatie: 90 });
  // De punten in de weergave (842 breed, 595 hoog).
  const ann = meetvlak({ measureShowEdgeLengths: true, measureScale: 0.5, measureUnit: 'cm' });
  const bytes = await opslaan(bron, [ann]);
  const { ap, rect } = await veelhoek(bytes);
  const teksten = apTeksten(ap);
  assert.equal(teksten.length, 4);
  for (const t of teksten) {
    assert.ok(t.x >= rect[0] && t.x <= rect[2] && t.y >= rect[1] && t.y <= rect[3], `${t.tekst} binnen de /Rect`);
    // /Rotate 90 draait de pagina een kwartslag rechtsom: de leesrichting
    // (a, b) in de PDF staat op het scherm als (b, -a). Rechtop is daar van
    // links naar rechts (b > 0) of staand van onder naar boven (b = 0, a < 0).
    assert.ok(t.b > 1e-9 || (Math.abs(t.b) <= 1e-9 && t.a < 0),
      `${t.tekst} rechtop op de gedraaide pagina (a=${t.a}, b=${t.b})`);
  }
  const [terug] = await laad(bytes);
  assert.equal(terug.measureShowEdgeLengths, true);
  document([terug]);
  assert.deepEqual(meas.vlakZijdeTeksten(terug).map((z) => z.tekst).sort(),
    ['100.0 cm', '100.0 cm', '50.0 cm', '50.0 cm']);
});

// ── een meetvlak van een ander programma, met zijn eigen /Measure ──────────
//
// De lader leest de schaal uit /X (de reeks vermenigvuldigd, in de eenheid
// van het laatste element) en de oppervlakte-eenheid uit /A. Het meetvlak
// rekent zijn eigen schaal in de lengte-eenheid van measureUnit: lazen we
// /X als /A, dan gaf het eerste verslepen een 10⁶ (mm/m²) of 144 (ft+in/sq
// ft) keer te grote oppervlakte, en schreef opslaan een verkeerde /Measure.

// 1:100: millimeters per punt.
const MM_PER_PT_100 = 25.4 / 72 * 100;

/** Blad met één extern meetvlak van 100 × 50 punt en de gegeven /Measure. */
async function externBlad({ X, A, contents }) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, HOOGTE]);
  const ctx = doc.context;
  const nf = (lijst) => lijst.map((d) => ctx.obj({ ...d, U: PDFString.of(d.U) }));
  const measure = ctx.obj({
    Type: PDFName.of('Measure'), Subtype: PDFName.of('RL'), R: PDFString.of('1:100'),
    X: nf(X), D: nf([{ U: 'mm', C: 1, D: 1 }]), A: nf(A),
  });
  const annot = ctx.obj({
    Type: 'Annot', Subtype: 'Polygon', Rect: [100, 600, 200, 650],
    Vertices: [100, 650, 200, 650, 200, 600, 100, 600],
    C: [1, 0, 0], IT: PDFName.of('PolygonDimension'), Contents: PDFString.of(contents),
    Measure: measure,
  });
  pagina.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(annot)]));
  return doc.save();
}

/** Een hoekpunt over 0 verslepen: de app rekent tekst en eenheid opnieuw. */
function versleepNul(ann) {
  document([ann]);
  applyResize(ann, 'polyline_node_2', 0, 0, cloneAnnotation(ann));
  return ann.measureText;
}

/** De /X en /A van de /Measure van het opgeslagen vlak: [{ U, C }]. */
async function opgeslagenMeasure(bytes) {
  const { dict, ctx } = await veelhoek(bytes);
  const m = ctx.lookup(dict.get(PDFName.of('Measure')));
  assert.ok(m, '/Measure geschreven');
  const lees = (sleutel) => ctx.lookup(m.get(PDFName.of(sleutel))).asArray().map((r) => {
    const d = ctx.lookup(r);
    const c = d.get(PDFName.of('C'));
    return { U: decodePdfTextObject(ctx.lookup(d.get(PDFName.of('U')))), C: c ? ctx.lookup(c).asNumber() : undefined };
  });
  return { X: lees('X'), A: lees('A') };
}

const bijna = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

test('extern meetvlak, lengte in mm en oppervlakte in m²: verslepen, opslaan en heropenen houden 6,22 m²', async () => {
  const bron = await externBlad({
    X: [{ U: 'mm', C: MM_PER_PT_100, D: 1 }],
    A: [{ U: 'm²', C: 0.000001, D: 100 }],
    contents: '6.22 m²',
  });
  const [ann] = await laad(bron);
  assert.equal(ann.type, 'measureArea');
  assert.equal(ann.measureText, '6.22 m²', 'de tekst uit het bestand');
  assert.equal(versleepNul(ann), '6.22 m²', 'verslepen over 0 laat de oppervlakte staan');
  assert.deepEqual(meas.vlakZijdeTeksten(ann).map((z) => z.tekst), ['3.53 m', '1.76 m', '3.53 m', '1.76 m']);

  // Opslaan zonder te bewerken: een /Measure die andere lezers goed lezen.
  const [opnieuw] = await laad(bron);
  const bytes = await opslaan(bron, [opnieuw]);
  const { X, A } = await opgeslagenMeasure(bytes);
  assert.equal(X.length, 1);
  // Lengte per punt in de eenheid van /X, oppervlakte = (X·C)² · A·C.
  const mPerPt = X[0].C * (X[0].U === 'mm' ? 0.001 : X[0].U === 'm' ? 1 : NaN);
  assert.ok(bijna(mPerPt, MM_PER_PT_100 / 1000), `/X ${JSON.stringify(X)}`);
  assert.equal(A[0].U, `${X[0].U}²`, '/A in het kwadraat van de eenheid van /X');
  assert.equal(A[0].C, 1);

  // Heropenen en weer verslepen: dezelfde oppervlakte.
  const [terug] = await laad(bytes);
  assert.equal(terug.measureText, '6.22 m²');
  assert.equal(versleepNul(terug), '6.22 m²', 'na heropenen ook');
});

test('extern meetvlak, lengte in voet + inch en oppervlakte in sq ft: verslepen, opslaan en heropenen houden 66,98 ft²', async () => {
  const FT_PER_PT = MM_PER_PT_100 / 304.8;
  const bron = await externBlad({
    X: [{ U: 'ft', C: FT_PER_PT, D: 1 }, { U: 'in', C: 12, D: 1 }],
    A: [{ U: 'sq ft', C: 1, D: 100 }],
    contents: '66.98 sq ft',
  });
  const [ann] = await laad(bron);
  assert.equal(ann.type, 'measureArea');
  assert.equal(versleepNul(ann), '66.98 ft²', 'niet 144 keer te groot');
  assert.deepEqual(meas.vlakZijdeTeksten(ann).map((z) => z.tekst), ['11.57 ft', '5.79 ft', '11.57 ft', '5.79 ft']);

  const [opnieuw] = await laad(bron);
  const bytes = await opslaan(bron, [opnieuw]);
  const { X, A } = await opgeslagenMeasure(bytes);
  assert.equal(X[0].U, 'ft');
  assert.ok(bijna(X[0].C, FT_PER_PT), `/X ${JSON.stringify(X)}`);
  assert.equal(A[0].U, 'ft²');

  const [terug] = await laad(bytes);
  assert.equal(versleepNul(terug), '66.98 ft²', 'na heropenen ook');
});
