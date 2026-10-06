// Bestaande markeringen, notities en antwoorden laden en opslaan zoals
// voorheen (#508, #527).
//
// De proefleescorrecties voegen aan de opslag en de lader een tak toe voor
// /Caret en voor doorhalingen met /IT /StrikeOutTextEdit. Highlight, Underline,
// StrikeOut zonder /IT, Squiggly, notities (/Text) en gewone antwoorden (/IRT
// zonder /RT /Group) mogen daar niets van merken. Deze test vergelijkt de
// nieuwe code met een letterlijke kopie van de oude opslag- en laadtak.
//
// Sinds #527 schrijft de opslag de quads van een markering bewust anders: in
// leesrichting zoals de pagina getoond wordt, met een /AP langs de tekst. De
// oude vaste volgorde liep op /Rotate 90 en 270 dwars over liggend getoonde
// tekst; zo'n markering wordt hersteld. Een markering die al in het bestand
// stond en waarvan p1 -> p2 de lange kant is (andere programma's, of tekst die
// in gebruikersruimte rechtop staat), houdt haar quads. Byte-gelijk is de
// opslag dus niet meer. Wat blijft: soort, kleur, doorzichtigheid, /T,
// /Contents, /M, /F, /IT, /NM en /Subj, dezelfde hoekpunten per regel, de
// popups en antwoorden; en de lader geeft voor een bestand met de oude
// volgorde, en voor zijn eigen save daarvan, precies hetzelfde model als
// voorheen.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString, PDFDict, decodePDFRawStream, degrees } from 'pdf-lib';

import { buildTextMarkupDict, bronMarkeringen } from './text-markup-dict.js';
import { makePointMapper, addLoadedMarkupKeys, correctionRefKeys, dropOrphanPopups } from './correction-dicts.js';
import { pdfTextString } from './pdf-text.js';
import { computeAnnotFlags, zetDoorzichtigheidInAp } from './utils.js';
import { hexToColorArray, colorArrayToHex } from '../../utils/colors.js';
import { _rotVisualMapper, _remapRect } from './rotatie-mapper.js';
import { linkPlanForSave, isTextEditStrike } from '../../annotations/corrections/model.js';
import { normTextDir, textDirFromVector } from '../../annotations/corrections/geometry.js';
import { textEditPropsFromPdf, resolveGroupLinks } from '../loader/correction-load.js';
import { extractAnnotationColors } from '../loader/color-extraction.js';
import { extraVoorAnnotatie } from '../loader/extra-sleutel.js';
import { buildLegacyMarkupFixture, PAGINAS } from './test-fixtures/text-edit-fixture.mjs';
import { viewportRectangle } from '../pdfjs-record.js';

// ── letterlijke kopie van de oude tak in saver.js (vóór #508) ────────────────
function oudeTekstmarkering(context, ann, convertX, convertY, opacity) {
  let annotDict;
  // Text markup annotations
  const x1 = convertX(ann.x);
  const y1 = convertY(ann.y + ann.height);
  const x2 = convertX(ann.x + ann.width);
  const y2 = convertY(ann.y);

  // Build QuadPoints from rects if available, otherwise from bounding box
  let quadPoints;
  if (ann.rects && ann.rects.length > 0) {
    quadPoints = [];
    for (const r of ann.rects) {
      const qx1 = convertX(r.x);
      const qx2 = convertX(r.x + r.width);
      const qy1 = convertY(r.y + r.height);
      const qy2 = convertY(r.y);
      quadPoints.push(qx1, qy2, qx2, qy2, qx1, qy1, qx2, qy1);
    }
  } else {
    quadPoints = [x1, y2, x2, y2, x1, y1, x2, y1];
  }

  // Map type to PDF subtype
  let markupSubtype = 'Highlight';
  if (ann.type === 'textStrikethrough') markupSubtype = 'StrikeOut';
  else if (ann.type === 'textUnderline') markupSubtype = 'Underline';
  else if (ann.type === 'textSquiggly') markupSubtype = 'Squiggly';

  annotDict = context.obj({
    Type: 'Annot',
    Subtype: markupSubtype,
    Rect: [x1, y1, x2, y2],
    QuadPoints: quadPoints,
    C: hexToColorArray(ann.fillColor || ann.color),
    CA: opacity,
    T: pdfTextString(ann.author || 'User'),
    Contents: pdfTextString(ann.subject || ''),
    M: PDFString.of(new Date().toISOString()),
    F: computeAnnotFlags(ann)
  });
  return annotDict;
}

// ── letterlijke kopie van de oude markering-tak in annotation-converter.js ──
function oudeMarkeringUitPdf(annot, convertRect, baseProps) {
  const typeMap = {
    'Highlight': 'textHighlight',
    'Underline': 'textUnderline',
    'StrikeOut': 'textStrikethrough',
    'Squiggly': 'textSquiggly'
  };
  const markupType = typeMap[annot.subtype] || 'highlight';
  const rect = annot.rect;
  const rects = [];
  if (annot.quadPoints && annot.quadPoints.length >= 8) {
    for (let i = 0; i < annot.quadPoints.length; i += 8) {
      const xs = [annot.quadPoints[i], annot.quadPoints[i+2], annot.quadPoints[i+4], annot.quadPoints[i+6]];
      const ys = [annot.quadPoints[i+1], annot.quadPoints[i+3], annot.quadPoints[i+5], annot.quadPoints[i+7]];
      rects.push(convertRect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]));
    }
  }
  let minX, maxX, minY, maxY;
  if (rects.length > 0) {
    minX = Math.min(...rects.map(r => r.x));
    maxX = Math.max(...rects.map(r => r.x + r.width));
    minY = Math.min(...rects.map(r => r.y));
    maxY = Math.max(...rects.map(r => r.y + r.height));
  } else {
    const fallback = convertRect(rect);
    minX = fallback.x; maxX = fallback.x + fallback.width;
    minY = fallback.y; maxY = fallback.y + fallback.height;
  }
  return {
    ...baseProps,
    type: markupType,
    x: minX, y: minY, width: maxX - minX, height: maxY - minY,
    rects: rects.length > 0 ? rects : undefined,
    color: colorArrayToHex(annot.color, '#FFFF00'),
    fillColor: colorArrayToHex(annot.color, '#FFFF00'),
  };
}

const OUDE_HANDLED = new Set([
  '/Highlight', '/Underline', '/StrikeOut', '/Squiggly',
  '/Square', '/Circle', '/Line', '/Ink', '/PolyLine', '/Polygon',
  '/Text', '/FreeText', '/Stamp',
]);
const NIEUWE_HANDLED = new Set([...OUDE_HANDLED, '/Caret']);
const MARKERINGEN = ['Highlight', 'Underline', 'StrikeOut', 'Squiggly'];

/**
 * Een dict als tekst zonder wat #527 bewust verandert (quads, /Rect, /AP,
 * /OPS_TextDir) en zonder /M (dat is "nu" en verschilt per aanroep).
 */
function zonderNieuw(context, dict) {
  const kopie = dict.clone(context);
  for (const k of ['M', 'QuadPoints', 'Rect', 'AP', 'OPS_TextDir']) kopie.delete(PDFName.of(k));
  return kopie.toString();
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const getallen = (dict, k) => dict.lookup(PDFName.of(k)).asArray().map((v) => v.asNumber());
const rond = (v) => Math.round(v * 1e3) / 1e3 || 0;

/** Per quad de vier hoekpunten als verzameling: de volgorde telt niet. */
function hoeken(q) {
  const uit = [];
  for (let i = 0; i < q.length; i += 8) {
    uit.push([0, 2, 4, 6].map((k) => `${rond(q[i + k])},${rond(q[i + k + 1])}`).sort());
  }
  return uit;
}

/** Leesrichting per quad zoals getoond: p1 -> p2 met de omrekening van de pagina. */
function richtingen(q, naarScherm) {
  const uit = [];
  for (let i = 0; i < q.length; i += 8) {
    const a = naarScherm(q[i], q[i + 1]);
    const b = naarScherm(q[i + 2], q[i + 3]);
    uit.push(textDirFromVector(b[0] - a[0], b[1] - a[1]));
  }
  return uit;
}

test('een markering uit de app: alles als in de oude tak, behalve de quadvolgorde, /Rect, /AP en /OPS_TextDir (#527)', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const convertX = (x) => x + 36;
  const convertY = (y) => 768 - y;
  // Dezelfde omrekening per punt: CropBox vanaf (36, 0), hoogte 768, /Rotate 0.
  const map = makePointMapper(0, { x: 36, y: 0, width: 576, height: 768 });
  const naarScherm = (x, y) => [x - 36, 768 - y];
  const modellen = [
    { type: 'highlight', x: 10, y: 20, width: 30, height: 12, color: '#FFFF00', opacity: 0.3 },
    { type: 'textHighlight', x: 10, y: 20, width: 80, height: 28, rects: [{ x: 10, y: 20, width: 80, height: 12 }, { x: 10, y: 36, width: 50, height: 12 }], color: '#FFFF00', fillColor: '#FFEE00' },
    { type: 'textStrikethrough', x: 72.25, y: 90.4, width: 18, height: 12, rects: [{ x: 72.25, y: 90.4, width: 18, height: 12 }], color: '#FF0000', subject: 'opmerking', author: 'Ann' },
    { type: 'textStrikethrough', x: 72, y: 90, width: 18, height: 12, color: '#FF0000', textDir: 90 },
    { type: 'textUnderline', x: 1, y: 2, width: 3, height: 4, color: '#008000', subject: 'é€', printable: false, locked: true },
    { type: 'textSquiggly', x: 5, y: 6, width: 7, height: 8, color: '#0000FF', readOnly: true },
    { type: 'textUnderline', x: 1, y: 2, width: 30, height: 4, color: '#008000', intent: 'Underline', nm: 'n-1', pdfSubject: 'Onderstreping' },
  ];
  for (const ann of modellen) {
    const opacity = ann.opacity !== undefined ? ann.opacity : 1;
    const oud = oudeTekstmarkering(ctx, ann, convertX, convertY, opacity);
    addLoadedMarkupKeys(oud, ann);
    const nieuw = buildTextMarkupDict(ctx, ann, map, { opacity, pageRot: 0 });
    addLoadedMarkupKeys(nieuw, ann);
    assert.equal(isTextEditStrike(ann), false, ann.type);
    assert.equal(zonderNieuw(ctx, nieuw), zonderNieuw(ctx, oud), ann.type);
    assert.match(nieuw.lookup(PDFName.of('M')).asString(), ISO, '/M blijft een ISO-tijd');
    // Dezelfde hoekpunten per regel; alleen de volgorde volgt de tekst.
    const qOud = getallen(oud, 'QuadPoints');
    const qNieuw = getallen(nieuw, 'QuadPoints');
    assert.deepEqual(hoeken(qNieuw), hoeken(qOud), `${ann.type}: dezelfde hoekpunten`);
    const dir = normTextDir(ann.textDir ?? 0);
    assert.ok(richtingen(qNieuw, naarScherm).every((r) => r === dir), `${ann.type}: p1 -> p2 langs de tekst`);
    if (dir === 0) {
      assert.deepEqual(qNieuw.map(rond), qOud.map(rond), `${ann.type}: op /Rotate 0 was de oude volgorde al de leesrichting`);
    } else {
      assert.ok(richtingen(qOud, naarScherm).every((r) => r === 0), `${ann.type}: de oude volgorde liep dwars over staande tekst`);
    }
    assert.ok(nieuw.get(PDFName.of('AP')), `${ann.type}: een appearance langs de tekst`);
    assert.equal(nieuw.get(PDFName.of('OPS_TextDir')).asNumber(), dir, `${ann.type}: /OPS_TextDir`);
    const [llx, lly, urx, ury] = getallen(nieuw, 'Rect');
    for (let i = 0; i < qNieuw.length; i += 2) {
      assert.ok(qNieuw[i] >= llx && qNieuw[i] <= urx && qNieuw[i + 1] >= lly && qNieuw[i + 1] <= ury, `${ann.type}: quad binnen /Rect`);
    }
  }
});

/** Laadt het bestand zoals loader.js: pdf.js-annotaties plus de extra gegevens. */
async function laad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const lezer = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pdfLib = await PDFDocument.load(bytes);
  const paginas = [];
  for (let n = 1; n <= lezer.numPages; n++) {
    const pagina = await lezer.getPage(n);
    const viewport = pagina.getViewport({ scale: 1 });
    paginas.push({ n, viewport, annots: await pagina.getAnnotations(), kaart: await extractAnnotationColors(n, pdfLib) });
  }
  return paginas;
}

const viewportHulp = (viewport) => ({
  convertPoint: (x, y) => viewport.convertToViewportPoint(x, y),
  convertRect: (r) => {
    const vr = viewportRectangle(viewport, r);
    return { x: Math.min(vr[0], vr[2]), y: Math.min(vr[1], vr[3]), width: Math.abs(vr[2] - vr[0]), height: Math.abs(vr[3] - vr[1]) };
  },
});

test('bestaande markeringen met de oude quadvolgorde laden met precies dezelfde eigenschappen', async () => {
  const { bytes } = await buildLegacyMarkupFixture();
  for (const { n, viewport, annots, kaart } of await laad(bytes)) {
    const { convertPoint, convertRect } = viewportHulp(viewport);
    const markeringen = annots.filter((a) => MARKERINGEN.includes(a.subtype));
    assert.equal(markeringen.length, 3);
    for (const annot of markeringen) {
      const extra = extraVoorAnnotatie(kaart, annot) || {};
      const oud = oudeMarkeringUitPdf(annot, convertRect, { page: n });
      const erbij = textEditPropsFromPdf(annot, extra, convertPoint, viewport.rotation || 0);
      const nieuw = { ...oud, ...erbij };
      for (const [k, v] of Object.entries(oud)) assert.deepEqual(nieuw[k], v, `${annot.subtype}.${k}`);
      assert.deepEqual(erbij, {}, `${annot.subtype}: geen /IT, /NM, /Subj of textDir erbij`);
      assert.equal(extra.fillOpacity, undefined, `${annot.subtype}: geen aparte vul-alfa`);
    }
    // Gewone antwoorden en status-antwoorden komen niet in de groepswachtrij.
    const wachtrij = annots.filter((a) => a.replyType === 'Group' && a.inReplyTo);
    assert.equal(wachtrij.length, 0);
    assert.equal(resolveGroupLinks(wachtrij, new Map()), 0);
    const antwoord = annots.find((a) => a.subtype === 'Text' && a.inReplyTo && !a.state);
    assert.equal(antwoord.replyType, 'R', 'pdf.js ziet een gewoon antwoord');
  }
});

test('opslaan: dezelfde annotaties en popups blijven; een markering houdt alles behalve de quadvolgorde (#527)', async () => {
  const { bytes, refs } = await buildLegacyMarkupFixture();
  const geladen = await laad(bytes);
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  doc.getPages().forEach((pagina, i) => {
    const lijst = ctx.lookup(pagina.node.get(PDFName.of('Annots'))).asArray();
    const subtype = (ref) => ctx.lookup(ref).get(PDFName.of('Subtype'))?.toString();
    const oudBewaard = lijst.filter((ref) => !OUDE_HANDLED.has(subtype(ref)));
    const nieuwBewaard = lijst.filter((ref) => !NIEUWE_HANDLED.has(subtype(ref)));
    assert.deepEqual(nieuwBewaard.map(String), oudBewaard.map(String), 'dezelfde annotaties blijven staan');
    assert.deepEqual(nieuwBewaard.map(String), [refs[i].popup], 'alleen de popup van de notitie');
    const weg = lijst.filter((ref) => NIEUWE_HANDLED.has(subtype(ref)));
    const sleutels = correctionRefKeys(ctx, weg);
    const bronnen = bronMarkeringen(ctx, weg);
    assert.equal(sleutels.size, 0, 'geen proefleescorrecties');
    assert.deepEqual(dropOrphanPopups(ctx, nieuwBewaard, sleutels).map(String), [refs[i].popup], 'de popup van de notitie blijft');

    // De markeringen zoals de lader ze geeft, opnieuw geschreven.
    const { viewport, annots, kaart, n } = geladen[i];
    const { convertPoint, convertRect } = viewportHulp(viewport);
    const modellen = annots.filter((a) => MARKERINGEN.includes(a.subtype)).map((annot) => ({
      ...oudeMarkeringUitPdf(annot, convertRect, { page: n, author: annot.titleObj?.str || 'User', subject: annot.contentsObj?.str || '', opacity: annot.opacity ?? 1 }),
      ...textEditPropsFromPdf(annot, extraVoorAnnotatie(kaart, annot) || {}, convertPoint, viewport.rotation || 0),
    }));
    assert.equal(modellen.length, 3);
    const plan = linkPlanForSave(modellen);
    assert.deepEqual(plan.links, []);
    assert.equal(plan.stripReplaceIntent.size, 0);
    const pageRot = PAGINAS[i].rotate;
    const cropBox = pagina.getCropBox();
    const convertX = (x) => x + cropBox.x;
    const convertY = (y) => cropBox.y + cropBox.height - y;
    for (const annRaw of modellen) {
      const label = `${annRaw.type} op pagina ${i + 1}`;
      assert.equal(isTextEditStrike(annRaw), false);
      const ann = pageRot ? remap(annRaw, pageRot, cropBox) : annRaw;
      const oud = oudeTekstmarkering(ctx, ann, convertX, convertY, ann.opacity);
      addLoadedMarkupKeys(oud, ann);
      // Zoals saver.js: de NIET omgerekende annotatie, per punt omgerekend.
      const nieuw = buildTextMarkupDict(ctx, annRaw, makePointMapper(pageRot, cropBox), { opacity: annRaw.opacity, pageRot, bronnen });
      addLoadedMarkupKeys(nieuw, annRaw);
      assert.equal(zonderNieuw(ctx, nieuw), zonderNieuw(ctx, oud), label);
      // Dezelfde hoekpunten als in het bestand, nu in leesrichting.
      const bron = lijst.map((ref) => ctx.lookup(ref)).find((d) => d instanceof PDFDict
        && d.get(PDFName.of('Subtype')).toString() === nieuw.get(PDFName.of('Subtype')).toString());
      const qBron = getallen(bron, 'QuadPoints');
      const qNieuw = getallen(nieuw, 'QuadPoints');
      assert.deepEqual(hoeken(qNieuw), hoeken(qBron), `${label}: dezelfde hoekpunten`);
      assert.ok(richtingen(qNieuw, convertPoint).every((r) => r === 0), `${label}: p1 -> p2 langs de liggende tekst`);
      if (pageRot === 0) {
        assert.deepEqual(qNieuw.map(rond), qBron.map(rond), `${label}: op /Rotate 0 ongewijzigd`);
      } else {
        assert.ok(richtingen(qBron, convertPoint).every((r) => r !== 0), `${label}: de oude volgorde liep dwars over de tekst`);
      }
    }
  });
});

// remapAnnotationForRotatedPage voor markeringen (alleen rect en rects).
function remap(annRaw, rot, cropBox) {
  const m = _rotVisualMapper(rot, cropBox.width, cropBox.height);
  const ann = { ...annRaw, ..._remapRect(annRaw, m) };
  if (Array.isArray(ann.rects)) ann.rects = ann.rects.map((r) => ({ ...r, ..._remapRect(r, m) }));
  return ann;
}

// ── rondgang: oude volgorde -> opslaan met #527 -> opnieuw laden ─────────────

/** Het model van alle markeringen per pagina, zoals annotation-converter.js. */
async function markeringModel(bytes) {
  const uit = [];
  for (const { n, viewport, annots, kaart } of await laad(bytes)) {
    const { convertPoint, convertRect } = viewportHulp(viewport);
    for (const annot of annots.filter((a) => MARKERINGEN.includes(a.subtype))) {
      const extra = extraVoorAnnotatie(kaart, annot) || {};
      uit.push({
        ...oudeMarkeringUitPdf(annot, convertRect, {
          page: n,
          author: annot.titleObj?.str || 'User',
          subject: annot.contentsObj?.str || '',
          opacity: annot.opacity !== undefined ? annot.opacity : (extra.opacity ?? 1),
          ...(extra.fillOpacity !== undefined ? { fillOpacity: extra.fillOpacity } : {}),
          locked: !!(annot.annotationFlags & 128),
          printable: !!(annot.annotationFlags & 4),
          readOnly: !!(annot.annotationFlags & 64),
        }),
        ...textEditPropsFromPdf(annot, extra, convertPoint, viewport.rotation || 0),
      });
    }
  }
  return uit;
}

/** Slaat de markeringen op zoals saver.js; al het andere blijft staan. */
async function slaMarkeringenOp(bytes, model) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  doc.getPages().forEach((pagina, i) => {
    const pageRot = ((pagina.getRotation().angle % 360) + 360) % 360;
    const map = makePointMapper(pageRot, pagina.getCropBox());
    const alle = ctx.lookup(pagina.node.get(PDFName.of('Annots'))).asArray();
    const isMarkering = (ref) => MARKERINGEN.includes(ctx.lookup(ref).get(PDFName.of('Subtype'))?.toString().slice(1));
    const lijst = alle.filter((ref) => !isMarkering(ref));
    // Zoals saver.js: de weggehaalde markeringen zonder /OPS_TextDir als bron.
    const markeringBronnen = bronMarkeringen(ctx, alle.filter(isMarkering));
    for (const ann of model.filter((a) => a.page === i + 1)) {
      const dict = buildTextMarkupDict(ctx, ann, map, { opacity: ann.opacity, pageRot, bronnen: markeringBronnen });
      addLoadedMarkupKeys(dict, ann);
      zetDoorzichtigheidInAp(ctx, dict, ann.opacity);
      lijst.push(ctx.register(dict));
    }
    pagina.node.set(PDFName.of('Annots'), ctx.obj(lijst));
  });
  return doc.save();
}

test('een bestand met de oude volgorde: na opslaan en opnieuw laden hetzelfde model, en een tweede save houdt de quads (#527)', async () => {
  const { bytes } = await buildLegacyMarkupFixture();
  const eerste = await markeringModel(bytes);
  assert.equal(eerste.length, 6);
  for (const oud of eerste) assert.equal(oud.textDir, undefined, `${oud.type} op pagina ${oud.page}: de oude volgorde geeft geen richting`);
  const save1 = await slaMarkeringenOp(bytes, eerste);
  // Opnieuw laden geeft precies hetzelfde model: geen textDir en geen
  // fillOpacity erbij, want een herstelde markering krijgt geen /OPS_TextDir.
  const tweede = await markeringModel(save1);
  zelfdeModel(eerste, tweede);
  // De quads staan nu in de getoonde leesrichting (ook op /Rotate 90). pdf.js
  // geeft ze in een vaste volgorde, dus de rauwe quads uit het bestand.
  const opgeslagen = await PDFDocument.load(save1);
  for (const { n, viewport } of await laad(save1)) {
    const c = opgeslagen.context;
    for (const d of c.lookup(opgeslagen.getPages()[n - 1].node.get(PDFName.of('Annots'))).asArray().map((ref) => c.lookup(ref))) {
      const subtype = d.get(PDFName.of('Subtype')).toString();
      if (!MARKERINGEN.includes(subtype.slice(1))) continue;
      assert.ok(richtingen(getallen(d, 'QuadPoints'), (x, y) => viewport.convertToViewportPoint(x, y)).every((r) => r === 0),
        `${subtype} op /Rotate ${viewport.rotation}: p1 -> p2 langs de liggende tekst`);
      assert.equal(d.get(PDFName.of('OPS_TextDir')), undefined, `${subtype}: geen /OPS_TextDir`);
    }
  }
  // Een tweede save van de eigen save schrijft dezelfde quads.
  const save2 = await slaMarkeringenOp(save1, tweede);
  const quadsVan = async (b) => {
    const d = await PDFDocument.load(b);
    return d.getPages().map((p) => d.context.lookup(p.node.get(PDFName.of('Annots'))).asArray()
      .map((ref) => d.context.lookup(ref))
      .filter((x) => MARKERINGEN.includes(x.get(PDFName.of('Subtype'))?.toString().slice(1)))
      .map((x) => getallen(x, 'QuadPoints').map(rond)));
  };
  assert.deepEqual(await quadsVan(save2), await quadsVan(save1));
});

// ── een bestand van een ander programma: quads in leesrichting ──────────────
//
// Andere programma's schrijven elke quad in leesrichting: p1 -> p2 langs de
// tekst. Op een pagina met /Rotate 90 of 270 waarvan de tekst in
// gebruikersruimte rechtop staat, loopt de tekst getoond omlaag of omhoog.
// Het model kent daar geen leesrichting (de lader blijft zoals hij was), maar
// de quads uit het bestand wel: een save mag ze niet dwars over de tekst
// herschrijven, ook als de gebruiker op die pagina niets veranderde.

/** Regels rechtop in gebruikersruimte: [x1, x2, basislijn], lettergrootte 10. */
const RECHTOP = {
  Highlight: [[100, 260, 500]],
  Underline: [[100, 300, 470], [100, 180, 455]],
  StrikeOut: [[100, 220, 440]],
  Squiggly: [[100, 240, 420]],
};
const leesrichtingQuad = ([x1, x2, b]) => [x1, b + 8, x2, b + 8, x1, b - 2, x2, b - 2];

async function bouwAnderProgramma() {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  for (const rotate of [90, 270]) {
    const pagina = doc.addPage([612, 792]);
    pagina.setRotation(degrees(rotate));
    if (rotate === 90) pagina.setCropBox(36, 48, 540, 720);
    const refs = Object.entries(RECHTOP).map(([subtype, regels]) => {
      const quads = regels.flatMap(leesrichtingQuad);
      const xs = quads.filter((_, i) => i % 2 === 0);
      const ys = quads.filter((_, i) => i % 2 === 1);
      return ctx.register(ctx.obj({
        Type: 'Annot', Subtype: subtype, Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        QuadPoints: quads, C: subtype === 'Highlight' ? [1, 1, 0] : [0, 0, 1], CA: subtype === 'Highlight' ? 0.5 : 1,
        T: PDFString.of('Ander'), Contents: PDFString.of(`opmerking ${subtype}`), NM: PDFString.of(`ander-${rotate}-${subtype}`),
        M: PDFString.of('D:20260901080000Z'), F: 4,
      }));
    });
    pagina.node.set(PDFName.of('Annots'), ctx.obj(refs));
  }
  return { bytes: await doc.save() };
}

/** Alle tekstmarkeringen van een bestand per /NM: quads, /OPS_TextDir en de lijnen van de /AP. */
async function markeringenPerNm(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const uit = new Map();
  for (const pagina of doc.getPages()) {
    for (const ref of ctx.lookup(pagina.node.get(PDFName.of('Annots'))).asArray()) {
      const d = ctx.lookup(ref);
      if (!MARKERINGEN.includes(d.get(PDFName.of('Subtype'))?.toString().slice(1))) continue;
      const rect = getallen(d, 'Rect');
      const ap = d.lookup(PDFName.of('AP'))?.get(PDFName.of('N'));
      const tekst = ap ? Buffer.from(decodePDFRawStream(ctx.lookup(ap)).decode()).toString('latin1') : '';
      const lijnen = [];
      for (const m of tekst.matchAll(/(-?[\d.]+) (-?[\d.]+) (m|l)\b/g)) {
        const p = { x: Number(m[1]) + rect[0], y: Number(m[2]) + rect[1] };
        if (m[3] === 'm') lijnen.push([p]); else lijnen.at(-1).push(p);
      }
      uit.set(ctx.lookup(d.get(PDFName.of('NM'))).decodeText(), {
        quads: getallen(d, 'QuadPoints'), opsTextDir: d.get(PDFName.of('OPS_TextDir')), lijnen,
      });
    }
  }
  return uit;
}

/** Twee modellen van dezelfde markeringen: dezelfde eigenschappen, getallen binnen 0,001. */
function zelfdeModel(eerste, tweede) {
  assert.equal(tweede.length, eerste.length);
  for (const oud of eerste) {
    const label = `${oud.nm || oud.type} op pagina ${oud.page}`;
    const nieuw = tweede.find((a) => a.page === oud.page && a.type === oud.type && a.nm === oud.nm);
    assert.ok(nieuw, label);
    for (const [k, v] of Object.entries(oud)) {
      if (k === 'rects') {
        assert.equal(nieuw.rects.length, v.length, `${label}: aantal regels`);
        v.forEach((r, j) => {
          for (const m of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(nieuw.rects[j][m] - r[m]) < 1e-3, `${label}: regel ${j + 1} ${m}`);
        });
      } else if (typeof v === 'number') {
        assert.ok(Math.abs(nieuw[k] - v) < 1e-3, `${label}: ${k} ${nieuw[k]} vs ${v}`);
      } else {
        assert.deepEqual(nieuw[k], v, `${label}: ${k}`);
      }
    }
    assert.deepEqual(Object.keys(nieuw).sort(), Object.keys(oud).sort(), `${label}: geen andere eigenschappen`);
  }
}

test('een markering van een ander programma op rechtop staande tekst van /Rotate 90 en 270 houdt na opslaan haar quads, langs de tekst (#527)', async () => {
  const { bytes } = await bouwAnderProgramma();
  const eerste = await markeringModel(bytes);
  assert.equal(eerste.length, 8);
  for (const a of eerste) assert.equal(a.textDir, undefined, `${a.nm}: de lader blijft zoals hij was`);
  const bron = await markeringenPerNm(bytes);
  const save1 = await slaMarkeringenOp(bytes, eerste);
  const na = await markeringenPerNm(save1);
  for (const [nm, b] of bron) {
    const n = na.get(nm);
    assert.ok(n, nm);
    assert.deepEqual(n.quads, b.quads, `${nm}: dezelfde quads, p1 -> p2 langs de tekst`);
    assert.equal(n.opsTextDir, undefined, `${nm}: geen /OPS_TextDir`);
    const subtype = nm.split('-')[2];
    if (subtype === 'Highlight') continue;
    // De lijnen van de appearance lopen langs gebruikers-x, op de juiste hoogte per regel.
    const regels = RECHTOP[subtype];
    assert.equal(n.lijnen.length, regels.length, `${nm}: één lijn per regel`);
    n.lijnen.forEach((lijn, i) => {
      const [x1, x2, b] = regels[i];
      assert.ok(Math.abs(lijn[0].x - x1) < 1e-3 && Math.abs(lijn.at(-1).x - x2) < 1e-3, `${nm}, regel ${i + 1}: van begin tot eind`);
      const onder = b - 2;
      for (const p of lijn) {
        if (subtype === 'Underline') assert.ok(Math.abs(p.y - (onder + 1)) < 1e-3, `${nm}: 1 pt boven de onderkant (${p.y})`);
        if (subtype === 'StrikeOut') assert.ok(Math.abs(p.y - (onder + 5)) < 1e-3, `${nm}: midden (${p.y})`);
        if (subtype === 'Squiggly') assert.ok(p.y >= onder - 1e-3 && p.y <= onder + 2 + 1e-3, `${nm}: langs de onderkant (${p.y})`);
      }
    });
  }
  // Opnieuw laden geeft hetzelfde model; een tweede save dezelfde quads.
  const tweede = await markeringModel(save1);
  zelfdeModel(eerste, tweede);
  const save2 = await slaMarkeringenOp(save1, tweede);
  const daarna = await markeringenPerNm(save2);
  for (const [nm, n] of na) assert.deepEqual(daarna.get(nm).quads, n.quads, `${nm}: tweede save`);
});

// ── lijndikte ───────────────────────────────────────────────────────────────
//
// Het eigenschappenpaneel zet lineWidth op onderstrepen, doorhalen en
// kronkellijn; de /AP tekent met die dikte. De lader leest hem alleen uit de
// eigen sleutel /OPS_LineWidth terug, zodat een bestand van een ander
// programma laadt zoals voorheen.

test('lijndikte: opslaan, laden en nog eens opslaan geeft dezelfde dikte, /AP en /Rect (#527)', async () => {
  const leeg = await PDFDocument.create();
  for (const rotate of [0, 90]) {
    const p = leeg.addPage([612, 792]);
    p.setRotation(degrees(rotate));
    p.node.set(PDFName.of('Annots'), leeg.context.obj([]));
  }
  const bytes = await leeg.save();
  const regel = { x: 72, y: 90, width: 120, height: 12 };
  const model = [];
  for (const page of [1, 2]) {
    for (const [type, lineWidth] of [['textUnderline', 3], ['textStrikethrough', 1.5], ['textSquiggly', 2.5], ['textUnderline', undefined], ['textHighlight', 4]]) {
      model.push({
        id: `lw-${page}-${type}-${lineWidth}`, nm: `lw-${page}-${type}-${lineWidth}`, type, page,
        ...regel, rects: [{ ...regel }], textDir: 0, color: '#0000FF', opacity: 1, author: 'Ann', subject: '',
        ...(lineWidth !== undefined ? { lineWidth } : {}),
      });
    }
  }
  const save1 = await slaMarkeringenOp(bytes, model);
  const geladen = await markeringModel(save1);
  const save2 = await slaMarkeringenOp(save1, geladen);
  const dictsVan = async (b) => {
    const d = await PDFDocument.load(b);
    const uit = new Map();
    for (const p of d.getPages()) {
      for (const ref of d.context.lookup(p.node.get(PDFName.of('Annots'))).asArray()) {
        const x = d.context.lookup(ref);
        const ap = d.context.lookup(x.lookup(PDFName.of('AP')).get(PDFName.of('N')));
        uit.set(d.context.lookup(x.get(PDFName.of('NM'))).decodeText(), {
          rect: getallen(x, 'Rect'),
          w: /(-?[\d.]+) w\b/.exec(Buffer.from(decodePDFRawStream(ap).decode()).toString('latin1'))?.[1],
          ops: x.get(PDFName.of('OPS_LineWidth'))?.asNumber(),
        });
      }
    }
    return uit;
  };
  const eerste = await dictsVan(save1);
  const tweede = await dictsVan(save2);
  for (const ann of model) {
    const label = ann.nm;
    const terug = geladen.find((a) => a.nm === ann.nm);
    assert.ok(terug, label);
    if (ann.type === 'textHighlight') {
      assert.equal(eerste.get(label).ops, undefined, `${label}: een markeervlak heeft geen lijn`);
      assert.equal('lineWidth' in terug, false, `${label}: geen lineWidth na laden`);
    } else if (ann.lineWidth === undefined) {
      assert.equal(eerste.get(label).ops, undefined, `${label}: zonder lineWidth geen /OPS_LineWidth`);
      assert.equal('lineWidth' in terug, false, `${label}: geen lineWidth na laden`);
      assert.equal(eerste.get(label).w, '1', `${label}: 1 pt`);
    } else {
      assert.equal(eerste.get(label).ops, ann.lineWidth, `${label}: /OPS_LineWidth`);
      assert.equal(terug.lineWidth, ann.lineWidth, `${label}: lineWidth na laden`);
      assert.equal(eerste.get(label).w, String(ann.lineWidth), `${label}: /AP met de dikte`);
    }
    assert.equal(tweede.get(label).w, eerste.get(label).w, `${label}: dezelfde dikte na een tweede save`);
    assert.deepEqual(tweede.get(label).rect, eerste.get(label).rect, `${label}: dezelfde /Rect na een tweede save`);
  }
});

test('lijndikte: een bestand zonder /OPS_LineWidth (ook met /BS) laadt zonder lineWidth (#527)', async () => {
  const { bytes } = await bouwAnderProgramma();
  const doc = await PDFDocument.load(bytes);
  // Een ander programma met een /BS op zijn onderstreping: de lader blijft zoals hij was.
  for (const p of doc.getPages()) {
    for (const ref of doc.context.lookup(p.node.get(PDFName.of('Annots'))).asArray()) {
      doc.context.lookup(ref).set(PDFName.of('BS'), doc.context.obj({ W: 2, S: 'S' }));
    }
  }
  for (const a of await markeringModel(await doc.save())) assert.equal('lineWidth' in a, false, a.nm);
  const { bytes: oud } = await buildLegacyMarkupFixture();
  for (const a of await markeringModel(oud)) assert.equal('lineWidth' in a, false, `${a.type} op pagina ${a.page}`);
});
