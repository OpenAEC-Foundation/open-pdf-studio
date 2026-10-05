// Bestaande markeringen, notities en antwoorden laden en opslaan precies als
// voorheen (#508).
//
// De proefleescorrecties voegen aan de opslag en de lader een tak toe voor
// /Caret en voor doorhalingen met /IT /StrikeOutTextEdit. Highlight, Underline,
// StrikeOut zonder /IT, Squiggly, notities (/Text) en gewone antwoorden (/IRT
// zonder /RT /Group) mogen daar niets van merken. Deze test vergelijkt de
// nieuwe code met een letterlijke kopie van de oude opslag- en laadtak.

import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString, PDFDict } from 'pdf-lib';

import { buildTextMarkupDict } from './text-markup-dict.js';
import { addLoadedMarkupKeys, correctionRefKeys, dropOrphanPopups } from './correction-dicts.js';
import { pdfTextString } from './pdf-text.js';
import { computeAnnotFlags } from './utils.js';
import { hexToColorArray, colorArrayToHex } from '../../utils/colors.js';
import { _rotVisualMapper, _remapRect } from './rotatie-mapper.js';
import { linkPlanForSave, isTextEditStrike } from '../../annotations/corrections/model.js';
import { textEditPropsFromPdf, resolveGroupLinks } from '../loader/correction-load.js';
import { extractAnnotationColors } from '../loader/color-extraction.js';
import { extraVoorAnnotatie } from '../loader/extra-sleutel.js';
import { buildLegacyMarkupFixture, PAGINAS } from './test-fixtures/text-edit-fixture.mjs';

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

/** Een dict als tekst, zonder /M (dat is "nu" en verschilt per aanroep). */
function zonderM(context, dict) {
  const kopie = dict.clone(context);
  kopie.delete(PDFName.of('M'));
  return kopie.toString();
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test('een markering uit de app schrijft byte-gelijk aan de oude tak', async () => {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const convertX = (x) => x + 36;
  const convertY = (y) => 768 - y;
  const modellen = [
    { type: 'highlight', x: 10, y: 20, width: 30, height: 12, color: '#FFFF00', opacity: 0.3 },
    { type: 'textHighlight', x: 10, y: 20, width: 80, height: 28, rects: [{ x: 10, y: 20, width: 80, height: 12 }, { x: 10, y: 36, width: 50, height: 12 }], color: '#FFFF00', fillColor: '#FFEE00' },
    { type: 'textStrikethrough', x: 72.25, y: 90.4, width: 18, height: 12, rects: [{ x: 72.25, y: 90.4, width: 18, height: 12 }], color: '#FF0000', subject: 'opmerking', author: 'Ann' },
    { type: 'textStrikethrough', x: 72, y: 90, width: 18, height: 12, color: '#FF0000', textDir: 90 },
    { type: 'textUnderline', x: 1, y: 2, width: 3, height: 4, color: '#008000', subject: 'é€', printable: false, locked: true },
    { type: 'textSquiggly', x: 5, y: 6, width: 7, height: 8, color: '#0000FF', readOnly: true },
  ];
  for (const ann of modellen) {
    const opacity = ann.opacity !== undefined ? ann.opacity : 1;
    const oud = oudeTekstmarkering(ctx, ann, convertX, convertY, opacity);
    const nieuw = buildTextMarkupDict(ctx, ann, { convertX, convertY, opacity });
    addLoadedMarkupKeys(nieuw, ann);
    assert.equal(isTextEditStrike(ann), false, ann.type);
    assert.equal(zonderM(ctx, nieuw), zonderM(ctx, oud), ann.type);
    assert.match(nieuw.lookup(PDFName.of('M')).asString(), ISO, '/M blijft een ISO-tijd');
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

test('bestaande markeringen laden met dezelfde eigenschappen; alleen textDir kan erbij komen', async () => {
  const { bytes } = await buildLegacyMarkupFixture();
  for (const { n, viewport, annots, kaart } of await laad(bytes)) {
    const convertPoint = (x, y) => viewport.convertToViewportPoint(x, y);
    const convertRect = (r) => {
      const vr = viewport.convertToViewportRectangle(r);
      return { x: Math.min(vr[0], vr[2]), y: Math.min(vr[1], vr[3]), width: Math.abs(vr[2] - vr[0]), height: Math.abs(vr[3] - vr[1]) };
    };
    const markeringen = annots.filter((a) => ['Highlight', 'Underline', 'StrikeOut', 'Squiggly'].includes(a.subtype));
    assert.equal(markeringen.length, 3);
    for (const annot of markeringen) {
      const extra = extraVoorAnnotatie(kaart, annot) || {};
      const oud = oudeMarkeringUitPdf(annot, convertRect, { page: n });
      const erbij = textEditPropsFromPdf(annot, extra, convertPoint, viewport.rotation || 0);
      const nieuw = { ...oud, ...erbij };
      for (const [k, v] of Object.entries(oud)) assert.deepEqual(nieuw[k], v, `${annot.subtype}.${k}`);
      assert.deepEqual(Object.keys(erbij).filter((k) => k !== 'textDir'), [], `${annot.subtype}: geen /IT, /NM of /Subj erbij`);
    }
    // Gewone antwoorden en status-antwoorden komen niet in de groepswachtrij.
    const wachtrij = annots.filter((a) => a.replyType === 'Group' && a.inReplyTo);
    assert.equal(wachtrij.length, 0);
    assert.equal(resolveGroupLinks(wachtrij, new Map()), 0);
    const antwoord = annots.find((a) => a.subtype === 'Text' && a.inReplyTo && !a.state);
    assert.equal(antwoord.replyType, 'R', 'pdf.js ziet een gewoon antwoord');
  }
});

test('opslaan: dezelfde annotaties blijven staan, popups blijven, markeringen schrijven byte-gelijk', async () => {
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
    assert.equal(sleutels.size, 0, 'geen proefleescorrecties');
    assert.deepEqual(dropOrphanPopups(ctx, nieuwBewaard, sleutels).map(String), [refs[i].popup], 'de popup van de notitie blijft');

    // De markeringen zoals de lader ze geeft, opnieuw geschreven.
    const { viewport, annots, kaart, n } = geladen[i];
    const convertRect = (r) => {
      const vr = viewport.convertToViewportRectangle(r);
      return { x: Math.min(vr[0], vr[2]), y: Math.min(vr[1], vr[3]), width: Math.abs(vr[2] - vr[0]), height: Math.abs(vr[3] - vr[1]) };
    };
    const convertPoint = (x, y) => viewport.convertToViewportPoint(x, y);
    const modellen = annots.filter((a) => ['Highlight', 'Underline', 'StrikeOut'].includes(a.subtype)).map((annot) => ({
      ...oudeMarkeringUitPdf(annot, convertRect, { page: n, author: annot.titleObj?.str || 'User', subject: annot.contentsObj?.str || '', opacity: annot.opacity ?? 1 }),
      ...textEditPropsFromPdf(annot, extraVoorAnnotatie(kaart, annot) || {}, convertPoint, viewport.rotation || 0),
    }));
    const plan = linkPlanForSave(modellen);
    assert.deepEqual(plan.links, []);
    assert.equal(plan.stripReplaceIntent.size, 0);
    const pageRot = PAGINAS[i].rotate;
    const cropBox = pagina.getCropBox();
    const convertX = (x) => x + cropBox.x;
    const convertY = (y) => cropBox.y + cropBox.height - y;
    for (const annRaw of modellen) {
      assert.equal(isTextEditStrike(annRaw), false);
      const ann = pageRot ? remap(annRaw, pageRot, cropBox) : annRaw;
      const oud = oudeTekstmarkering(ctx, ann, convertX, convertY, ann.opacity);
      const nieuw = buildTextMarkupDict(ctx, ann, { convertX, convertY, opacity: ann.opacity });
      addLoadedMarkupKeys(nieuw, ann);
      assert.equal(zonderM(ctx, nieuw), zonderM(ctx, oud), `${ann.type} op pagina ${i + 1}`);
      // De quads komen terug zoals ze in het bestand stonden.
      const bron = lijst.map((ref) => ctx.lookup(ref)).find((d) => d instanceof PDFDict
        && d.get(PDFName.of('Subtype')).toString() === nieuw.get(PDFName.of('Subtype')).toString());
      assert.deepEqual(nieuw.lookup(PDFName.of('QuadPoints')).asArray().map((v) => v.asNumber()),
        bron.lookup(PDFName.of('QuadPoints')).asArray().map((v) => v.asNumber()), 'quads ongewijzigd');
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
