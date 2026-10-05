// Maatlijnen uit een ander programma over laden → opslaan → laden.
//
// Een pagina van 842 x 1191 met /Rotate 90 en de woordenboeken (met hun
// appearance) van drie maten en een grijze lijn uit een echte tekening:
//   - "5,9 m "  (xref 47): staand in het bestand, liggend op het scherm;
//   - "2,8 m "  (xref 41): bijna staand op het scherm (-88,91°);
//   - "0,6 m "  (xref 80): korter dan twee punten plus het bijschrift;
//   - een grijze gewone lijn (xref 77) zonder /BS.
// Geen /BS, /Border of /IC; /LE ClosedArrow, /LL 9,73, /LLE 5, /Cap true,
// /CP /Inline en de tekstopmaak in /RC.
//
// Laden gebeurt zoals js/pdf/loader.js (pdf.js + extractAnnotationColors) met
// de gedeelde regel uit loader/maatlijn-uit-bestand.js; opslaan met
// saver/maatlijn-opslaan.js, na dezelfde omrekening naar het ongedraaide
// paginaframe als saver.js (remapAnnotationForRotatedPage). Na het opslaan
// staat er OPS_Subtype in het woordenboek en geldt de maat als eigen maat:
// alles wat overgenomen is, moet dus in eigen sleutels mee.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

import { extractAnnotationColors } from './loader/color-extraction.js';
import { extraVoorAnnotatie } from './loader/extra-sleutel.js';
import { maatlijnUitBestand, lijnBreedteUitBestand } from './loader/maatlijn-uit-bestand.js';
import { maatlijnAnnotatie } from './saver/maatlijn-opslaan.js';
import { buildBorderStyle } from './saver/utils.js';
import { inlineMaatlijn, helveticaBreedte } from '../annotations/maatlijn-inline.js';

const B = 842;
const H = 1191;

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

function appearance(ctx, inhoud, bbox) {
  const stroom = ctx.stream(inhoud, {
    Type: 'XObject', Subtype: 'Form', BBox: bbox, Matrix: [1, 0, 0, 1, -bbox[0], -bbox[1]],
    Resources: ctx.obj({ Font: ctx.obj({ F0: ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }) }) }),
  });
  return ctx.obj({ N: ctx.register(stroom) });
}

const MATEN = [
  {
    tekst: '5,9 m ', C: [0, 0, 1], L: [158.239777, 185.75, 158.302307, 338.5],
    Rect: [143.010544, 185.25, 158.302505, 339.006042], NM: '2efc17f8-086a-4d93-a51a2e17b1193192',
    CreationDate: "D:20230511125046+02'00'", bbox: [115.27077, 185.25, 130.56273, 339.00605],
    ap: '.000409365 1 -1 .000409365 115.270256 249.125763 cm BT\n'
      + '0 g 0 Tc 0 Tw 100 Tz 0 Tr/F0 9 Tf 1.251 -8.145 Td\n(5,9 m )Tj\nET\n'
      + '0 0 1 RG 1 w .000409 -1 1 .000409 -249.172939 115.168267 cm\n'
      + '130.5 185.75 m 115.771 185.756 l S\n130.563 338.5 m 115.833 338.506 l S\n'
      + '120.771 186.754 m 120.797 249.124 l 120.807 275.134 m 120.833 337.504 l S\n'
      + '125.274 194.546 m 120.771 186.754 l 116.274 194.55 l h s\n'
      + '116.33 329.712 m 120.833 337.504 l 125.33 329.708 l h s\n',
  },
  {
    tekst: '2,8 m ', C: [1, 0, 0], L: [269.427277, 786.374756, 196.989777, 787.75],
    Rect: [196.210281, 771.458679, 269.927185, 787.75946], NM: 'd92501a1-e389-4a12-8c39edc21405ea2a',
    CreationDate: "D:20230511124646+02'00'", bbox: [168.4705, 771.4587, 242.18741, 787.75949],
    ap: '-0.99982 .0189818 -0.0189818 -0.99982 218.182327 771.562561 cm BT\n'
      + '0 g 0 Tc 0 Tw 100 Tz 0 Tr/F0 9 Tf 1.251 -8.145 Td\n(2,8 m )Tj\nET\n'
      + '1 0 0 RG 1 w -0.99982 -0.018982 .018982 -0.99982 203.497349 775.565058 cm\n'
      + '241.688 786.375 m 241.408 771.648 l S\n169.25 787.75 m 168.97 773.023 l S\n'
      + '240.503 776.666 m 218.287 777.088 l 192.281 777.582 m 170.065 778.004 l S\n'
      + '232.796 781.313 m 240.503 776.666 l 232.625 772.315 l h s\n'
      + '177.772 773.356 m 170.065 778.004 l 177.943 782.355 l h s\n',
  },
  {
    tekst: '0,6 m ', C: [1, 0, 0], L: [471.489807, 565.875, 471.427307, 581.139648],
    Rect: [444.622284, 545.833252, 471.491821, 601.101685], NM: '357d48b4-09c4-4455-98eedfab1eec5526',
    CreationDate: "D:20230511164822+02'00'", bbox: [413.7575, 535.45828, 440.62705, 590.7267],
    ap: '-0.00409439 .999992 -0.999992 -0.00409439 413.865051 550.0172729 cm BT\n'
      + '0 g 0 Tc 0 Tw 100 Tz 0 Tr/F0 9 Tf 1.251 -8.145 Td\n(0,6 m )Tj\nET\n'
      + '1 0 0 RG 1 w -0.004094 -0.999992 .999992 -0.004094 -548.318116 416.113554 cm\n'
      + '440.625 555.5 m 425.896 555.44 l S\n440.563 570.765 m 425.833 570.704 l S\n'
      + '430.978 535.46 m 430.9 554.46 l 430.829 571.725 m 430.752 590.725 l S\n'
      + '426.432 546.648 m 430.9 554.46 l 435.432 546.685 l h s\n'
      + '435.297 579.537 m 430.829 571.725 l 426.297 579.5 l h s\n',
  },
];

const maatWoordenboek = (m) => (ctx) => ctx.obj({
  Type: 'Annot', Subtype: 'Line', AP: appearance(ctx, m.ap, m.bbox), C: m.C, Cap: true, CO: [0, 10],
  Contents: PDFString.of(m.tekst), CP: PDFName.of('Inline'), CreationDate: PDFString.of(m.CreationDate),
  F: 516, IT: PDFName.of('LineDimension'), L: m.L, LE: [PDFName.of('ClosedArrow'), PDFName.of('ClosedArrow')],
  LL: 9.729187, LLE: 5, M: PDFString.of("D:20230603131610+02'00'"), Measure: meetwoordenboek(ctx),
  NM: PDFString.of(m.NM), RC: PDFString.of(RC(m.tekst)), Rect: m.Rect,
  Subj: PDFString.of('Dimension Line'), T: PDFString.of('tekenaar'), Type: 'Annot',
});

const grijzeLijn = (ctx) => ctx.obj({
  Type: 'Annot', Subtype: 'Line', C: [0.4, 0.4, 0.4], CP: PDFName.of('Inline'),
  CreationDate: PDFString.of("D:20230511164646+02'00'"), F: 4,
  L: [440.239746, 747.5, 512.239746, 747.5], M: PDFString.of("D:20230603131610+02'00'"),
  NM: PDFString.of('8db6a120-704c-455f-8605c8a026f9c714'), Rect: [440.239777, 747, 512.239746, 748],
  Subj: PDFString.of('Line'), T: PDFString.of('tekenaar'),
  AP: appearance(ctx, '.4 .4 .4 RG 1 w 440.24 747.5 m 512.24 747.5 l S\n', [440.239777, 747, 512.239746, 748]),
});

async function pagina(makers) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([B, H]);
  p.node.set(PDFName.of('Rotate'), doc.context.obj(90));
  const ctx = doc.context;
  p.node.set(PDFName.of('Annots'), ctx.obj(makers.map((maak) => ctx.register(maak(ctx)))));
  return doc.save();
}

// ── laden ───────────────────────────────────────────────────────────────────

/** De modellen zoals annotation-converter.js ze maakt (zonder gedeelde velden). */
async function geladen(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const p = await doc.getPage(1);
  const viewport = p.getViewport({ scale: 1 });
  const annots = await p.getAnnotations();
  await doc.loadingTask.destroy();
  const kaart = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
  const convertPoint = (x, y) => viewport.convertToViewportPoint(x, y);
  return annots.map((annot) => {
    const extra = extraVoorAnnotatie(kaart, annot) || {};
    if (annot.it === 'LineDimension' || extra.opsSubtype === 'measureDistance') {
      return { ...maatlijnUitBestand({ annot, extra, convertPoint }), measureText: annot.contentsObj?.str };
    }
    // De tak voor een gewone lijn (zonder /LE) uit annotation-converter.js.
    const lc = extra.lineCoords || annot.lineCoordinates;
    const [startX, startY] = convertPoint(lc[0], lc[1]);
    const [endX, endY] = convertPoint(lc[2], lc[3]);
    return { type: 'line', startX, startY, endX, endY, lineWidth: lijnBreedteUitBestand(extra, annot, 2) };
  });
}

// ── opslaan ─────────────────────────────────────────────────────────────────

// saver.js: op een pagina met /Rotate 90 eerst naar het ongedraaide frame
// (remapAnnotationForRotatedPage), dan x ongewijzigd en y omgeklapt.
const naarOngedraaid = (x, y) => ({ x: y, y: H - x });
function ongedraaid(ann) {
  const uit = { ...ann };
  for (const [kx, ky] of [['startX', 'startY'], ['endX', 'endY'], ['leaderStartX', 'leaderStartY'], ['leaderEndX', 'leaderEndY']]) {
    if (typeof ann[kx] === 'number' && typeof ann[ky] === 'number') {
      const p = naarOngedraaid(ann[kx], ann[ky]);
      uit[kx] = p.x; uit[ky] = p.y;
    }
  }
  return uit;
}
const X = (x) => x;
const Y = (y) => H - y;

async function opgeslagen(modellen) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([B, H]);
  p.node.set(PDFName.of('Rotate'), doc.context.obj(90));
  const context = doc.context;
  const refs = modellen.map((model) => {
    const ann = ongedraaid(model);
    if (ann.type === 'measureDistance') {
      return context.register(maatlijnAnnotatie({
        ann, context, convertX: X, convertY: Y, opacity: 1, borderWidth: ann.lineWidth ?? 2, paginaRotatie: 90,
      }));
    }
    // De tak voor een gewone lijn uit saver.js: /L en /BS uit lineWidth.
    return context.register(context.obj({
      Type: 'Annot', Subtype: 'Line', Rect: [0, 0, 1, 1], L: [X(ann.startX), Y(ann.startY), X(ann.endX), Y(ann.endY)],
      C: [0.4, 0.4, 0.4], BS: buildBorderStyle(context, ann.lineWidth ?? 2, ann.borderStyle),
    }));
  });
  p.node.set(PDFName.of('Annots'), context.obj(refs));
  return { bytes: await doc.save(), context };
}

function gelijkModel(na, voor, wat) {
  assert.deepEqual(Object.keys(na).sort(), Object.keys(voor).sort(), `${wat}: dezelfde velden`);
  for (const [k, v] of Object.entries(voor)) {
    if (typeof v === 'number') assert.ok(Math.abs(na[k] - v) <= 1e-3, `${wat}.${k}: ${v} → ${na[k]}`);
    else assert.deepEqual(na[k], v, `${wat}.${k}`);
  }
}

const KOP = 9 * Math.cos(Math.PI / 6);
const LLE_MM = 5 * 25.4 / 72;

// ── tests ───────────────────────────────────────────────────────────────────

test('drie maten en een lijn uit een ander programma komen met al hun eigenschappen binnen', async () => {
  const [m59, m28, m06, lijn] = await geladen(await pagina([...MATEN.map(maatWoordenboek), grijzeLijn]));
  for (const [m, kleur] of [[m59, '#0000ff'], [m28, '#ff0000'], [m06, '#ff0000']]) {
    assert.equal(m.type, 'measureDistance');
    assert.equal(m.strokeColor, kleur);
    assert.equal(m.lineWidth, 1);
    assert.deepEqual([m.startHead, m.endHead, m.headFill], ['closed', 'closed', false]);
    assert.ok(Math.abs(m.headSize - KOP) < 1e-9, `puntmaat ${m.headSize}`);
    assert.equal(m.dimLineOvershootMm, 0);
    assert.equal(m.dimExtGapMm, 0);
    assert.ok(Math.abs(m.dimExtOvershootMm - LLE_MM) < 1e-9);
    assert.equal(m.dimTextPosition, 'inline');
    assert.equal(m.fontSize, 9);
    assert.equal(m.labelColor, '#000000');
    assert.equal(m.measureUnit, 'm');
    assert.equal(m.measurePrecision, 1);
  }
  // Ligging (regressiewacht) van 5,9 m.
  assert.ok(Math.abs(m59.startX - 185.754) < 1e-3 && Math.abs(m59.startY - 148.511) < 1e-3);
  assert.ok(Math.abs(m59.leaderEndX - 338.5) < 1e-3 && Math.abs(m59.leaderEndY - 158.302) < 1e-3);
  // 2,8 m is bijna staand en leest, zoals de staande 5,9 m-maten van die
  // tekening, van onder naar boven.
  const hoek28 = Math.atan2(m28.endY - m28.startY, m28.endX - m28.startX) * 180 / Math.PI;
  assert.ok(Math.abs(hoek28 + 88.91) < 0.01, `weergavehoek ${hoek28}`);
  const tekst28 = inlineMaatlijn({ ...m28, tekstBreedte: helveticaBreedte(m28.measureText, 9) }).tekst;
  assert.ok(Math.abs(tekst28.hoek * 180 / Math.PI - hoek28) < 1e-9, 'leest langs de lijn, van onder naar boven');
  // 0,6 m is te kort: punten buiten de hulplijnen, tekst ernaast.
  assert.equal(inlineMaatlijn({ ...m06, tekstBreedte: helveticaBreedte(m06.measureText, 9) }).buiten, true);
  // De grijze lijn: lijndikte 1.
  assert.equal(lijn.type, 'line');
  assert.equal(lijn.lineWidth, 1);
});

test('laden → opslaan → laden houdt het model van elke maat en van de lijn', async () => {
  const eerst = await geladen(await pagina([...MATEN.map(maatWoordenboek), grijzeLijn]));
  const { bytes } = await opgeslagen(eerst);
  const daarna = await geladen(bytes);
  assert.equal(daarna.length, eerst.length);
  eerst.forEach((m, i) => gelijkModel(daarna[i], m, m.measureText || m.type));
  // En nog een keer: het blijft zo.
  const derde = await geladen((await opgeslagen(daarna)).bytes);
  eerst.forEach((m, i) => gelijkModel(derde[i], m, `${m.measureText || m.type} (2x)`));
});

/** Het woordenboek en de appearance-inhoud van één opgeslagen maat. */
async function opgeslagenMaat(model) {
  const doc = await PDFDocument.create();
  doc.addPage([B, H]);
  const context = doc.context;
  const d = maatlijnAnnotatie({
    ann: ongedraaid(model), context, convertX: X, convertY: Y, opacity: 1, borderWidth: model.lineWidth ?? 2,
    paginaRotatie: 90,
  });
  const n = context.lookup(context.lookup(d.get(PDFName.of('AP'))).get(PDFName.of('N')));
  return { d, inhoud: Buffer.from(n.getContents()).toString('latin1') };
}

const lijnstukken = (inhoud) => [...inhoud.matchAll(/(-?[\d.]+) (-?[\d.]+) m (-?[\d.]+) (-?[\d.]+) l S/g)]
  .map((m) => m.slice(1, 5).map(Number));

test('de opgeslagen appearance houdt holle punten, het bijschrift in de lijn en lijndikte 1', async () => {
  const [m59, m28] = await geladen(await pagina(MATEN.slice(0, 2).map(maatWoordenboek)));
  const { d, inhoud } = await opgeslagenMaat(m59);
  assert.equal(String(d.get(PDFName.of('BS')).get(PDFName.of('W'))), '1');
  assert.equal(d.get(PDFName.of('IC')), undefined, 'geen /IC: de punten blijven hol');
  assert.equal(String(d.get(PDFName.of('CP'))), '/Inline');
  assert.equal(String(d.get(PDFName.of('LLE'))), '5', '/LLE uit de doorloop van de hulplijn');
  // Punten: gesloten driehoeken die alleen omlijnd worden.
  assert.equal((inhoud.match(/ h\nS\n/g) || []).length, 2, 'twee omlijnde punten');
  assert.doesNotMatch(inhoud, /\b(f|B|b)\n/, 'niets gevuld');
  // De maatlijn (x 148,51 in het bestand) in twee stukken rond de tekst.
  const maatlijn = lijnstukken(inhoud).filter(([x1, , x2]) => Math.abs(x1 - 148.51) < 0.05 && Math.abs(x2 - 148.51) < 0.1);
  assert.equal(maatlijn.length, 2, `twee stukken: ${JSON.stringify(maatlijn)}`);
  const ys = maatlijn.flatMap(([, y1, , y2]) => [y1, y2]).sort((a, b) => a - b);
  for (const [y, verwacht] of ys.map((y, i) => [y, [186.754, 249.124, 275.134, 337.504][i]])) {
    assert.ok(Math.abs(y - verwacht) < 0.06, `${y} ≈ ${verwacht}`);
  }
  // Zwarte tekst van 9 pt, langs de lijn.
  assert.match(inhoud, /\/Helv 9 Tf\n0 0 0 rg\n/);
  // 2,8 m loopt in het bestand naar links (-x); op de 90° gedraaide pagina is
  // dat omhoog: de tekst loopt dus ook naar -x en leest van onder naar boven.
  const tm = (await opgeslagenMaat(m28)).inhoud.match(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm/);
  assert.ok(Number(tm[1]) < -0.99, `tekstrichting ${tm[1]} ${tm[2]}`);
});

/** "5,9 m " met een andere opmaak: `wijzig` vult aan of haalt sleutels weg (null). */
const maat59Met = (wijzig) => (ctx) => {
  const d = maatWoordenboek(MATEN[0])(ctx);
  for (const [k, v] of Object.entries(wijzig)) {
    if (v === null) d.delete(PDFName.of(k));
    else d.set(PDFName.of(k), ctx.obj(v));
  }
  return d;
};

const OPEN = [PDFName.of('OpenArrow'), PDFName.of('OpenArrow')];

test('een tekstgrootte uit /RC zonder kleur blijft over laden → opslaan → laden', async () => {
  // Geen bijschrift in de lijn, geen holle punten en geen tekstkleur: alleen
  // de tekstgrootte is overgenomen, en die moet ook in een eigen sleutel mee.
  const rc = PDFString.of(RC('5,9 m ').replace('color:#000000;', ''));
  const gevallen = {
    'open punten, /CP /Top': { LE: OPEN, CP: PDFName.of('Top'), RC: rc },
    'gevulde punten (/IC), /CP /Top': { IC: [0, 0, 1], CP: PDFName.of('Top'), RC: rc },
    'open punten, zonder /Cap': { LE: OPEN, Cap: null, RC: rc },
  };
  for (const [wat, wijzig] of Object.entries(gevallen)) {
    const [eerst] = await geladen(await pagina([maat59Met(wijzig)]));
    assert.equal(eerst.fontSize, 9, `${wat}: /RC font-size`);
    for (const k of ['labelColor', 'dimTextPosition', 'headFill']) assert.equal(eerst[k], undefined, `${wat}: ${k}`);
    const { d } = await opgeslagenMaat(eerst);
    assert.equal(String(d.get(PDFName.of('OPS_FontSize'))), '9', `${wat}: OPS_FontSize`);
    const daarna = await geladen((await opgeslagen([eerst])).bytes);
    assert.equal(daarna[0].fontSize, 9, `${wat}: na opslaan`);
    gelijkModel(daarna[0], eerst, wat);
    const derde = await geladen((await opgeslagen(daarna)).bytes);
    assert.equal(derde[0].fontSize, 9, `${wat}: na twee keer opslaan`);
    gelijkModel(derde[0], eerst, `${wat} (2x)`);
  }
});

test('/Cap true zonder /CP: het bijschrift staat in de lijn en blijft daar', async () => {
  const [eerst] = await geladen(await pagina([maat59Met({ CP: null })]));
  assert.equal(eerst.dimTextPosition, 'inline', 'zonder /CP is Inline de standaard');
  const { d } = await opgeslagenMaat(eerst);
  assert.equal(String(d.get(PDFName.of('OPS_DimTextPos'))), '/Inline');
  const daarna = await geladen((await opgeslagen([eerst])).bytes);
  gelijkModel(daarna[0], eerst, '5,9 m zonder /CP');
});

test('een eigen maat houdt over laden → opslaan → laden hetzelfde model, zonder nieuwe sleutels', async () => {
  const eigen = MATEN.map((m) => (ctx) => {
    const d = maatWoordenboek(m)(ctx);
    d.set(PDFName.of('OPS_Subtype'), PDFString.of('measureDistance'));
    d.set(PDFName.of('BS'), ctx.obj({ Type: 'Border', W: 1, S: 'S' }));
    return d;
  });
  const eerst = await geladen(await pagina(eigen));
  for (const m of eerst) {
    assert.equal(m.headSize, 12);
    for (const k of ['headFill', 'dimTextPosition', 'fontSize', 'fontSizeUitBestand', 'labelColor', 'dimLineOvershootMm']) {
      assert.equal(m[k], undefined, k);
    }
  }
  const { d } = await opgeslagenMaat(eerst[0]);
  for (const k of ['OPS_HeadFill', 'OPS_DimTextPos', 'OPS_FontSize', 'OPS_LabelColor', 'OPS_DimOvershoot']) {
    assert.equal(d.get(PDFName.of(k)), undefined, `${k} komt er niet bij`);
  }
  const daarna = await geladen((await opgeslagen(eerst)).bytes);
  eerst.forEach((m, i) => gelijkModel(daarna[i], m, m.measureText));
});

test('saver.js schrijft de lijndikte van een gewone lijn in /BS', () => {
  const bron = readFileSync(new URL('./saver.js', import.meta.url), 'utf8');
  assert.ok(bron.includes('const borderWidth = ann.lineWidth ?? 2;'));
  assert.ok(bron.includes('lineDict.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);'));
});

test('saver.js bewaart holle punten van een pijl en een omtrekmaat', () => {
  const bron = readFileSync(new URL('./saver.js', import.meta.url), 'utf8');
  assert.equal(bron.split('kopVullingSleutels(ann)').length - 1, 2, 'pijl en omtrekmaat');
  assert.ok(bron.includes('headSize, headFill: ann.headFill,'), 'de appearance van een pijl');
});
