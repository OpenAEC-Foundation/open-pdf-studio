// De annotaties van de web-unit terugschrijven in het PDF-bestand.
//
// Pure module: pdf-lib in, bytes uit. Geen DOM, geen state, geen netwerk.
//
// De woordenboeken volgen exact de conventies van `js/pdf/saver.js`, zodat een
// op het web bewerkte tekening identiek opent in de bureaubladversie. De
// vector-appearance komt uit `js/pdf/saver/appearance-vectors.js` — dezelfde
// bouwer die de bureaubladversie gebruikt, zodat beide kanten er nooit uit
// kunnen lopen.
//
// Coordinaten: annotaties staan in punten met de oorsprong LINKSBOVEN in het
// snijvak, y naar beneden (zie `meten.js`).

import { PDFDocument, PDFName, PDFString, PDFHexString } from 'pdf-lib';
import { buildMeasureDistanceAP, HELV_FONT_NAME } from '../../js/pdf/saver/appearance-vectors.js';

export const SOORTEN = Object.freeze(['measureDistance', 'note', 'square']);

/** '#rrggbb' -> [r, g, b] in 0..1. Onleesbare invoer wordt zwart. */
export function hexNaarKleur(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * De inhoud van het /Measure-woordenboek als gewone waarden.
 * `/C` is het aantal eenheden per punt, `/U` de eenheid. Zo leest de
 * bureaubladversie hem terug (zie `js/pdf/loader/color-extraction.js`).
 */
export function meetWoordenboekVelden(schaal) {
  if (!schaal || !(schaal.eenheidPerPunt > 0)) return null;
  const eenheid = schaal.eenheid || 'mm';
  const c = schaal.eenheidPerPunt;
  return { C: c, D: 1, U: eenheid, R: `1 pt = ${c} ${eenheid}` };
}

/** Tekst die ook buiten ASCII overleeft: hex-string als het nodig is. */
function pdfTekst(s) {
  const t = String(s ?? '');
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(t) ? PDFString.of(t) : PDFHexString.fromText(t);
}

/** Het omhullende vak van een annotatie in PDF-coordinaten, met marge. */
export function omhullende(punten, marge = 5) {
  const xs = punten.map((p) => p.x);
  const ys = punten.map((p) => p.y);
  return [
    Math.min(...xs) - marge, Math.min(...ys) - marge,
    Math.max(...xs) + marge, Math.max(...ys) + marge,
  ];
}

function hangAppearanceAan(context, annotDict, gebouwd, vak) {
  if (!gebouwd || !gebouwd.content) return;
  const [x1, y1, x2, y2] = vak;
  const resources = {};
  if (gebouwd.needsFont) {
    resources.Font = context.obj({
      [HELV_FONT_NAME]: context.obj({
        Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding',
      }),
    });
  }
  const stroom = context.stream(gebouwd.content, {
    Type: 'XObject', Subtype: 'Form', BBox: [x1, y1, x2, y2],
    Matrix: [1, 0, 0, 1, -x1, -y1], Resources: context.obj(resources),
  });
  annotDict.set(PDFName.of('AP'), context.obj({ N: context.register(stroom) }));
}

function bouwMeetAfstand(context, ann, X, Y, schaal) {
  const kleur = hexNaarKleur(ann.strokeColor || '#ff0000');
  const breedte = ann.lineWidth ?? 1;
  const p1 = { x: X(ann.startX), y: Y(ann.startY) };
  const p2 = { x: X(ann.endX), y: Y(ann.endY) };
  const vak = omhullende([p1, p2], 12);
  const dict = context.obj({
    Type: 'Annot',
    Subtype: 'Line',
    Rect: vak,
    L: [p1.x, p1.y, p2.x, p2.y],
    C: kleur,
    CA: ann.opacity ?? 1,
    T: pdfTekst(ann.author || 'User'),
    Contents: pdfTekst(ann.measureText || ''),
    M: PDFString.of(new Date(ann.gewijzigdOp || Date.now()).toISOString()),
    IT: PDFName.of('LineDimension'),
    OPS_Subtype: PDFString.of('measureDistance'),
    F: 4,
    BS: context.obj({ W: breedte, S: PDFName.of('S') }),
  });
  const velden = meetWoordenboekVelden(ann.schaal || schaal);
  if (velden) {
    dict.set(PDFName.of('Cap'), context.obj(true));
    dict.set(PDFName.of('CP'), PDFName.of('Inline'));
    dict.set(PDFName.of('Measure'), context.obj({
      Subtype: PDFName.of('RL'),
      R: pdfTekst(velden.R),
      X: context.obj([context.obj({ C: velden.C, D: velden.D, U: pdfTekst(velden.U) })]),
    }));
  }
  hangAppearanceAan(context, dict, buildMeasureDistanceAP({
    startX: ann.startX, startY: ann.startY, endX: ann.endX, endY: ann.endY,
    X, Y, strokeColorHex: ann.strokeColor || '#ff0000', lineWidth: breedte,
    borderStyle: ann.borderStyle, text: ann.measureText,
  }), vak);
  return dict;
}

function bouwNotitie(context, ann, X, Y) {
  const x = X(ann.x);
  const y = Y(ann.y);
  const vak = [x, y - 20, x + 20, y];
  return context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: vak,
    Name: PDFName.of('Comment'),
    Contents: pdfTekst(ann.contents || ''),
    T: pdfTekst(ann.author || 'User'),
    C: hexNaarKleur(ann.color || '#ffd400'),
    CA: ann.opacity ?? 1,
    M: PDFString.of(new Date(ann.gewijzigdOp || Date.now()).toISOString()),
    Open: false,
    F: 4,
  });
}

function bouwVlak(context, ann, X, Y) {
  const p1 = { x: X(ann.x), y: Y(ann.y) };
  const p2 = { x: X(ann.x + ann.breedte), y: Y(ann.y + ann.hoogte) };
  const vak = omhullende([p1, p2], 0);
  const dict = context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: vak,
    C: hexNaarKleur(ann.strokeColor || '#ff0000'),
    CA: ann.opacity ?? 1,
    T: pdfTekst(ann.author || 'User'),
    Contents: pdfTekst(ann.contents || ''),
    M: PDFString.of(new Date(ann.gewijzigdOp || Date.now()).toISOString()),
    BS: context.obj({ W: ann.lineWidth ?? 2, S: PDFName.of('S') }),
    F: 4,
  });
  if (ann.fillColor) dict.set(PDFName.of('IC'), context.obj(hexNaarKleur(ann.fillColor)));
  return dict;
}

/**
 * Annotaties in een PDF schrijven.
 * @param {Uint8Array|ArrayBuffer} pdfBytes bron
 * @param {Array<object>} annotaties met `type` uit SOORTEN en `page` (1-gebaseerd)
 * @param {{schaal?:object}} opties documentbrede meetschaal
 * @returns {Promise<Uint8Array>}
 */
export async function schrijfAnnotaties(pdfBytes, annotaties = [], opties = {}) {
  const bron = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const doc = await PDFDocument.load(bron, { ignoreEncryption: true, updateMetadata: false });
  const context = doc.context;
  const paginas = doc.getPages();

  const perPagina = new Map();
  for (const ann of annotaties) {
    if (!ann || !SOORTEN.includes(ann.type)) continue;
    const nr = ann.page == null ? 1 : Math.trunc(Number(ann.page));
    if (nr < 1 || nr > paginas.length) continue;
    if (!perPagina.has(nr)) perPagina.set(nr, []);
    perPagina.get(nr).push(ann);
  }

  for (const [nr, lijst] of perPagina) {
    const pagina = paginas[nr - 1];
    const snijvak = pagina.getCropBox();
    const links = snijvak.x;
    const boven = snijvak.y + snijvak.height;
    const X = (x) => x + links;
    const Y = (y) => boven - y;

    const bestaand = pagina.node.get(PDFName.of('Annots'));
    const refs = [];
    if (bestaand && typeof bestaand.asArray === 'function') refs.push(...bestaand.asArray());

    for (const ann of lijst) {
      let dict = null;
      if (ann.type === 'measureDistance') dict = bouwMeetAfstand(context, ann, X, Y, opties.schaal);
      else if (ann.type === 'note') dict = bouwNotitie(context, ann, X, Y);
      else if (ann.type === 'square') dict = bouwVlak(context, ann, X, Y);
      if (dict) refs.push(context.register(dict));
    }
    pagina.node.set(PDFName.of('Annots'), context.obj(refs));
  }

  return doc.save({ useObjectStreams: false });
}
