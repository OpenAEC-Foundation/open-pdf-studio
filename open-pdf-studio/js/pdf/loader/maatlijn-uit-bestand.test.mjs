// Maatlijnen (/Line /IT /LineDimension) en lijnen uit een ander programma:
// alle eigenschappen uit het woordenboek komen in het bewerkbare model.
//
// De woordenboeken zijn die van een echte tekening (een pagina van 842 x 1191
// met /Rotate 90): geen /BS en geen /Border (lijndikte 1 volgens de
// specificatie, pdf.js maakt er 0 van), /LE ClosedArrow zonder /IC (hol),
// /LL en /LLE, /Cap true met /CP /Inline en de tekstopmaak in /RC.
//
// Bestanden van de app zelf (met OPS_Subtype) en oudere eigen bestanden
// (vóór OPS_Subtype: /Line /IT /LineDimension zonder /BS, /LE en /LL) houden
// hun model. Per sleutel beslist wat er werkelijk in het woordenboek staat.
//
// Elke test schrijft echte PDF-bytes, leest ze zoals de lader (pdf.js voor de
// annotatie en de viewport, pdf-lib voor de extra sleutels) en zet ze om met
// de gedeelde regel die ook annotation-converter.js gebruikt.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { extractAnnotationColors } from './color-extraction.js';
import { extraVoorAnnotatie } from './extra-sleutel.js';
import {
  maatlijnUitBestand, lijnBreedteUitBestand, pijlKopVullingUitBestand, meetlijnKoppenUitBestand,
} from './maatlijn-uit-bestand.js';

const bijna = (a, b, tol, wat) => assert.ok(Math.abs(a - b) <= tol, `${wat}: ${a} ≈ ${b}`);

// ── het bestand ─────────────────────────────────────────────────────────────

const RC = (tekst) => '<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" '
  + 'style="text-align:center;line-height:normal;font-family:Arial;font-size:9pt;font-weight:normal;'
  + 'font-style:normal;text-decoration:none;color:#000000;text-valign:top;">'
  + `<p><span>${tekst}</span></p></body>`;

function meetwoordenboek(ctx) {
  const formaat = (C, U, D) => ctx.obj({
    C, ...(D ? { D } : {}), RD: PDFString.of(','), RT: PDFString.of('.'), U: PDFString.of(U),
  });
  return ctx.obj({
    A: [formaat(1, 'm²', 10)], D: [formaat(1, 'm', 10)],
    R: PDFString.of('1 mm = 0,11 m'), Subtype: PDFName.of('RL'), X: [formaat(0.038806, 'm')],
  });
}

/** Appearance van "5,9 m " (xref 47) zoals het andere programma hem schreef. */
const AP_59 = '.000409365 1 -1 .000409365 115.270256 249.125763 cm BT\n'
  + '0 g 0 Tc 0 Tw 100 Tz 0 Tr/F0 9 Tf 1.251 -8.145 Td\n(5,9 m )Tj\nET\n'
  + '0 0 1 RG 1 w .000409 -1 1 .000409 -249.172939 115.168267 cm\n'
  + '130.5 185.75 m 115.771 185.756 l S\n130.563 338.5 m 115.833 338.506 l S\n'
  + '120.771 186.754 m 120.797 249.124 l 120.807 275.134 m 120.833 337.504 l S\n'
  + '125.274 194.546 m 120.771 186.754 l 116.274 194.55 l h s\n'
  + '116.33 329.712 m 120.833 337.504 l 125.33 329.708 l h s\n';

function appearance(ctx, inhoud, bbox) {
  const stroom = ctx.stream(inhoud, {
    Type: 'XObject', Subtype: 'Form', BBox: bbox, Matrix: [1, 0, 0, 1, -bbox[0], -bbox[1]],
    Resources: ctx.obj({ Font: ctx.obj({ F0: ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }) }) }),
  });
  return ctx.obj({ N: ctx.register(stroom) });
}

/** Woordenboek uit `basis`; `wijzig` vult aan of haalt sleutels weg (null). */
function woordenboek(basis, wijzig = {}) {
  return (ctx) => {
    const d = basis(ctx);
    for (const [k, v] of Object.entries(wijzig)) {
      if (v === null) delete d[k];
      else d[k] = typeof v === 'function' ? v(ctx) : v;
    }
    return ctx.obj(d);
  };
}

/** De maat "5,9 m " (xref 47). */
const maat59 = (wijzig) => woordenboek((ctx) => ({
  Type: 'Annot', Subtype: 'Line',
  AP: appearance(ctx, AP_59, [115.27077, 185.25, 130.56273, 339.00605]),
  C: [0, 0, 1], Cap: true, CO: [0, 10], Contents: PDFString.of('5,9 m '), CP: PDFName.of('Inline'),
  CreationDate: PDFString.of("D:20230511125046+02'00'"), F: 516, IT: PDFName.of('LineDimension'),
  L: [158.239777, 185.75, 158.302307, 338.5],
  LE: [PDFName.of('ClosedArrow'), PDFName.of('ClosedArrow')], LL: 9.729187, LLE: 5,
  M: PDFString.of("D:20230603131610+02'00'"), Measure: meetwoordenboek(ctx),
  NM: PDFString.of('2efc17f8-086a-4d93-a51a2e17b1193192'), RC: PDFString.of(RC('5,9 m ')),
  Rect: [143.010544, 185.25, 158.302505, 339.006042], Subj: PDFString.of('Dimension Line'),
  T: PDFString.of('tekenaar'),
}), wijzig);

/** Een grijze gewone lijn uit dezelfde tekening (xref 77). */
const grijzeLijn = (wijzig) => woordenboek((ctx) => ({
  Type: 'Annot', Subtype: 'Line', C: [0.4, 0.4, 0.4], CP: PDFName.of('Inline'),
  CreationDate: PDFString.of("D:20230511164646+02'00'"), F: 4,
  L: [440.239746, 747.5, 512.239746, 747.5], M: PDFString.of("D:20230603131610+02'00'"),
  NM: PDFString.of('8db6a120-704c-455f-8605c8a026f9c714'), Rect: [440.239777, 747, 512.239746, 748],
  Subj: PDFString.of('Line'), T: PDFString.of('tekenaar'),
  AP: appearance(ctx, '.4 .4 .4 RG 1 w 440.24 747.5 m 512.24 747.5 l S\n', [440.239777, 747, 512.239746, 748]),
}), wijzig);

async function pdfMet(makers, { rotatie = 90 } = {}) {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([842, 1191]);
  if (rotatie) pagina.node.set(PDFName.of('Rotate'), doc.context.obj(rotatie));
  const ctx = doc.context;
  pagina.node.set(PDFName.of('Annots'), ctx.obj(makers.map((maak) => ctx.register(maak(ctx)))));
  return doc.save();
}

/** Lezen zoals js/pdf/loader.js: pdf.js-annotaties met viewport, plus de extra sleutels. */
async function gelezen(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 1 });
  const annots = await pagina.getAnnotations();
  await doc.loadingTask.destroy();
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const convertPoint = (x, y) => viewport.convertToViewportPoint(x, y);
  return annots.map((annot) => ({ annot, extra: extraVoorAnnotatie(kaart, annot) || {}, convertPoint }));
}

const maatModel = (g) => maatlijnUitBestand(g);

// ── 1. de vreemde maat ──────────────────────────────────────────────────────

test('een maat uit een ander programma neemt al zijn eigenschappen over', async () => {
  const [g] = await gelezen(await pdfMet([maat59()]));
  const m = maatModel(g);
  assert.equal(m.type, 'measureDistance');
  assert.equal(m.lineWidth, 1, 'geen /BS en geen /Border: lijndikte 1');
  assert.deepEqual([m.startHead, m.endHead], ['closed', 'closed']);
  assert.equal(m.headFill, false, 'geen /IC: holle punten');
  bijna(m.headSize, 9 * Math.cos(Math.PI / 6), 0.01, 'puntlengte 7,79');
  assert.equal(m.dimLineOvershootMm, 0, 'geen uitloop voorbij de punten');
  assert.equal(m.dimExtension, undefined, 'de uitloop gaat via dimLineOvershootMm, die bewaard blijft');
  bijna(m.dimExtOvershootMm, 5 * 25.4 / 72, 0.001, '/LLE 5 in papiermillimeters');
  assert.equal(m.dimExtGapMm, 0, 'geen /LLO: hulplijn vanaf het punt');
  assert.equal(m.dimTextPosition, 'inline');
  assert.equal(m.fontSize, 9, '/RC font-size');
  assert.equal(m.labelColor, '#000000', '/RC color');
  assert.equal(m.color, '#0000ff');
  // Regressiewacht: de ligging klopte al.
  bijna(m.startX, 185.754, 0.001, 'startX'); bijna(m.startY, 148.511, 0.001, 'startY');
  bijna(m.endX, 338.504, 0.001, 'endX'); bijna(m.endY, 148.573, 0.001, 'endY');
  bijna(m.leaderStartX, 185.75, 0.001, 'leaderStartX'); bijna(m.leaderStartY, 158.240, 0.001, 'leaderStartY');
  bijna(m.leaderEndX, 338.5, 0.001, 'leaderEndX'); bijna(m.leaderEndY, 158.302, 0.001, 'leaderEndY');
  assert.equal(m.measureUnit, 'm');
  bijna(m.measureScale, 0.038806, 1e-9, 'schaal uit /X');
});

// ── 2. eigen bestanden ──────────────────────────────────────────────────────

const HUIDIG_EIGEN_MODEL = {
  lineWidth: 1, startHead: 'closed', endHead: 'closed', headSize: 12,
};

test('een eigen maat (met OPS_Subtype) houdt zijn model', async () => {
  const [g] = await gelezen(await pdfMet([maat59({
    OPS_Subtype: PDFString.of('measureDistance'),
    BS: (ctx) => ctx.obj({ Type: 'Border', W: 1, S: 'S' }),
  })]));
  const m = maatModel(g);
  for (const [k, v] of Object.entries(HUIDIG_EIGEN_MODEL)) assert.equal(m[k], v, k);
  for (const k of ['headFill', 'dimTextPosition', 'dimLineOvershootMm', 'dimExtGapMm', 'dimExtOvershootMm',
    'dimExtension', 'fontSize', 'fontSizeUitBestand', 'labelColor']) {
    assert.equal(m[k], undefined, `${k} komt er niet bij`);
  }
});

test('een eigen maat met OPS_HeadSize houdt die maat', async () => {
  const [g] = await gelezen(await pdfMet([maat59({
    OPS_Subtype: PDFString.of('measureDistance'), OPS_HeadSize: 8,
    BS: (ctx) => ctx.obj({ Type: 'Border', W: 0.35, S: 'S' }),
  })]));
  const m = maatModel(g);
  assert.equal(m.headSize, 8);
  assert.equal(m.lineWidth, 0.35);
});

test('een ouder eigen bestand (zonder OPS_Subtype, /BS, /LE en /LL) blijft zoals het was', async () => {
  // Zo schreef de app een maat vóór OPS_Subtype: /Line /IT /LineDimension
  // met /L, /C, /CA, /T, /Contents, /M en /F, en geen appearance.
  const oud = (ctx) => ctx.obj({
    Type: 'Annot', Subtype: 'Line', Rect: [95, 95, 305, 105], L: [100, 100, 300, 100],
    C: [1, 0, 0], CA: 1, T: PDFString.of('User'), Contents: PDFString.of('200 mm'),
    M: PDFString.of('2026-02-01T10:00:00.000Z'), IT: 'LineDimension', F: 4,
  });
  const [g] = await gelezen(await pdfMet([oud], { rotatie: 0 }));
  const m = maatModel(g);
  assert.deepEqual([m.startHead, m.endHead], ['openCircle', 'openCircle'], 'geen /LE: de eigen standaard');
  assert.equal(m.headSize, 12);
  for (const k of ['headFill', 'dimTextPosition', 'dimLineOvershootMm', 'dimExtGapMm', 'dimExtOvershootMm',
    'fontSize', 'fontSizeUitBestand', 'labelColor', 'leaderStartX']) {
    assert.equal(m[k], undefined, `${k} komt er niet bij`);
  }
  // Bewust: zonder /BS en /Border is de lijndikte 1 (specificatie) en niet de
  // 0 van pdf.js, die op het scherm als 0,5 en bij opslaan als /W 0 uitkwam.
  assert.equal(m.lineWidth, 1);
});

test('per sleutel: alleen wat er staat wordt overgenomen', async () => {
  // Zonder /LL: geen hulplijnen, dus ook geen hulplijnvelden; zonder /Cap of
  // met /CP /Top geen bijschrift in de lijn, /Cap true zonder /CP wel (Inline
  // is de standaard); met /IC gevulde punten; met /BS de lijndikte daarvan.
  const [zonderLL, zonderCap, boven, metIc, metBs, metBorder, zonderCp] = await gelezen(await pdfMet([
    maat59({ LL: null, LLE: null }),
    maat59({ Cap: null, Rect: [143.01, 185.25, 158.3, 339.006] }),
    maat59({ CP: PDFName.of('Top'), Rect: [143.02, 185.25, 158.3, 339.006] }),
    maat59({ IC: [1, 1, 0], Rect: [143.03, 185.25, 158.3, 339.006] }),
    maat59({ BS: (ctx) => ctx.obj({ W: 2 }), Rect: [143.04, 185.25, 158.3, 339.006] }),
    maat59({ Border: [0, 0, 3], Rect: [143.05, 185.25, 158.3, 339.006] }),
    maat59({ CP: null, Rect: [143.06, 185.25, 158.3, 339.006] }),
  ]));
  const a = maatModel(zonderLL);
  assert.equal(a.leaderStartX, undefined);
  assert.equal(a.dimExtOvershootMm, undefined);
  assert.equal(a.dimExtGapMm, undefined);
  assert.equal(a.dimLineOvershootMm, 0, '/LE uit een ander programma: geen uitloop');
  assert.equal(maatModel(zonderCap).dimTextPosition, undefined);
  assert.equal(maatModel(boven).dimTextPosition, undefined);
  assert.equal(maatModel(zonderCp).dimTextPosition, 'inline', '/Cap true zonder /CP: Inline (PDF 32000, tabel 175)');
  assert.equal(maatModel(metIc).headFill, undefined, 'met /IC gevuld');
  assert.equal(maatModel(metBs).lineWidth, 2);
  bijna(maatModel(metBs).headSize, 9 * Math.cos(Math.PI / 6) * 2, 1e-9, 'punt groeit met de lijndikte');
  assert.equal(maatModel(metBorder).lineWidth, 3);
});

// ── 7. gewone lijnen ────────────────────────────────────────────────────────

test('een gewone lijn zonder /BS en zonder /Border krijgt lijndikte 1', async () => {
  const [grijs, metBs, metBorder, bsZonderW] = await gelezen(await pdfMet([
    grijzeLijn(),
    grijzeLijn({ BS: (ctx) => ctx.obj({ W: 3 }), Rect: [440.24, 747, 512.24, 748] }),
    grijzeLijn({ Border: [0, 0, 2], Rect: [440.25, 747, 512.24, 748] }),
    grijzeLijn({ BS: (ctx) => ctx.obj({ S: 'D', D: [3, 2] }), Rect: [440.26, 747, 512.24, 748] }),
  ]));
  assert.equal(lijnBreedteUitBestand(grijs.extra, grijs.annot, 2), 1);
  assert.equal(lijnBreedteUitBestand(metBs.extra, metBs.annot, 2), 3);
  assert.equal(lijnBreedteUitBestand(metBorder.extra, metBorder.annot, 2), 2);
  assert.equal(lijnBreedteUitBestand(bsZonderW.extra, bsZonderW.annot, 2), 1, '/BS zonder /W: standaard 1');
  // Zonder gegevens uit het bestand blijft de oude terugval.
  assert.equal(lijnBreedteUitBestand({}, { borderStyle: { width: 0 } }, 2), 0);
  assert.equal(lijnBreedteUitBestand({}, {}, 2), 2);
});

// ── gewone pijlen ───────────────────────────────────────────────────────────

const pijl = (wijzig = {}) => grijzeLijn({
  LE: [PDFName.of('None'), PDFName.of('ClosedArrow')], ...wijzig,
});

test('een gesloten pijlpunt uit een ander programma zonder /IC is hol', async () => {
  const [vreemd, metIc, eigen, oudEigen, open] = await gelezen(await pdfMet([
    pijl(),
    pijl({ IC: [1, 0, 0], Rect: [440.24, 747, 512.24, 748] }),
    // Eigen pijl (sinds de appearance): /BS, OPS_HeadSize en een appearance.
    pijl({ OPS_HeadSize: 8, BS: (ctx) => ctx.obj({ W: 2 }), Rect: [440.25, 747, 512.24, 748] }),
    // Oudere eigen pijl: /BS en /LE, maar geen appearance en geen OPS_HeadSize.
    pijl({ AP: null, BS: (ctx) => ctx.obj({ W: 2 }), Rect: [440.26, 747, 512.24, 748] }),
    pijl({ LE: [PDFName.of('None'), PDFName.of('OpenArrow')], Rect: [440.27, 747, 512.24, 748] }),
  ]));
  assert.equal(pijlKopVullingUitBestand(vreemd.extra), false);
  assert.equal(pijlKopVullingUitBestand(metIc.extra), undefined, 'met /IC gevuld');
  assert.equal(pijlKopVullingUitBestand(eigen.extra), undefined, 'eigen pijl: gevuld zoals altijd');
  assert.equal(pijlKopVullingUitBestand(oudEigen.extra), undefined, 'oudere eigen pijl: gevuld zoals altijd');
  assert.equal(pijlKopVullingUitBestand(open.extra), undefined, 'een open punt heeft geen vulling');
});

test('een opgeslagen holle pijl blijft hol', async () => {
  const [g] = await gelezen(await pdfMet([pijl({
    OPS_HeadSize: 8, OPS_HeadFill: false, BS: (ctx) => ctx.obj({ W: 2 }),
  })]));
  assert.equal(pijlKopVullingUitBestand(g.extra), false);
});

// ── omtrekmaat (/PolyLine /IT /PolyLineDimension) ───────────────────────────

const omtrek = (wijzig) => woordenboek((ctx) => ({
  Type: 'Annot', Subtype: 'PolyLine', IT: PDFName.of('PolyLineDimension'), C: [1, 0, 0],
  Vertices: [100, 100, 200, 100, 200, 200], Rect: [95, 95, 205, 205],
  LE: [PDFName.of('ClosedArrow'), PDFName.of('ClosedArrow')], Contents: PDFString.of('3 m'),
  Measure: meetwoordenboek(ctx),
  AP: appearance(ctx, '1 0 0 RG 1 w 100 100 m 200 100 l 200 200 l S\n', [95, 95, 205, 205]),
}), wijzig);

test('een omtrekmaat uit een ander programma: holle punten, puntmaat en lijndikte 1', async () => {
  const [vreemd, eigen] = await gelezen(await pdfMet([
    omtrek(),
    omtrek({ OPS_Subtype: PDFString.of('measurePerimeter'), BS: (ctx) => ctx.obj({ W: 1 }), Rect: [95, 95, 205, 206] }),
  ], { rotatie: 0 }));
  assert.equal(lijnBreedteUitBestand(vreemd.extra, vreemd.annot, 1), 1);
  const k = meetlijnKoppenUitBestand(vreemd.extra, 1);
  assert.equal(k.headFill, false);
  bijna(k.headSize, 9 * Math.cos(Math.PI / 6), 1e-9, 'puntmaat');
  assert.deepEqual(meetlijnKoppenUitBestand(eigen.extra, 1), { headSize: 12 }, 'eigen omtrekmaat ongewijzigd');
});

test('een opgeslagen omtrekmaat met holle punten blijft hol', async () => {
  const [g] = await gelezen(await pdfMet([omtrek({
    OPS_Subtype: PDFString.of('measurePerimeter'), OPS_HeadSize: 7.794, OPS_HeadFill: false,
    BS: (ctx) => ctx.obj({ W: 1 }),
  })], { rotatie: 0 }));
  assert.deepEqual(meetlijnKoppenUitBestand(g.extra, 1), { headSize: 7.794, headFill: false });
});

// ── de converter gebruikt deze regels ───────────────────────────────────────

test('annotation-converter.js zet maten en lijnen om met deze regels', () => {
  const bron = readFileSync(new URL('./annotation-converter.js', import.meta.url), 'utf8');
  for (const regel of [
    'maatlijnUitBestand({ annot, extra: extraColors, convertPoint })',
    'lineWidth: lijnBreedteUitBestand(extraColors, annot, 2)',
    'lineWidth: lijnBreedteUitBestand(extraColors, annot, 1)',
    'pijlKopVullingUitBestand(extraColors)',
    'meetlijnKoppenUitBestand(extraColors, mpProps.lineWidth)',
  ]) assert.ok(bron.includes(regel), regel);
});
