// Gewone tekstmarkering (markeren, onderstrepen, doorhalen, kronkellijn); een
// doorhaling als tekstcorrectie gaat via saver/correction-dicts.js.
//
// Quads in leesrichting (#527): andere lezers nemen p1 -> p2 van elke quad als
// de richting van de tekst. De hoeken komen per PUNT uit de NIET omgerekende
// annotatie (paginaruimte van de app) via makePointMapper, dus op elke
// /Rotate staan ze begin-boven, eind-boven, begin-onder, eind-onder zoals de
// pagina getoond wordt; textDir is de leesrichting in die getoonde pagina.
// Vroeger stond hier een vaste volgorde in gebruikersruimte, die op /Rotate
// 90 en 270 dwars over de tekst liep.
//
// De markering krijgt een /AP langs de tekst (buildMarkupAppearance) en
// /OPS_TextDir, zodat de lader de leesrichting terugvindt; een lijn met een
// eigen dikte ook /OPS_LineWidth. /C, /CA, /T, /Contents, /M en /F blijven
// zoals de saver ze altijd schreef.
//
// Een markering die al in het bestand stond zonder /OPS_TextDir (van een
// ander programma of een eerdere app-versie) heeft in het model geen
// leesrichting; de lader blijft daarvoor zoals hij was. Bij het opslaan geven
// haar eigen quads (bronMarkeringen) de richting: een quad waarvan p1 -> p2
// de lange kant is, of die al met het model samenvalt, blijft zoals hij was.
// Alleen de oude vaste volgorde dwars over getoond liggende tekst (p1 -> p2
// is daar de regelhoogte) wordt opnieuw in leesrichting opgebouwd. Zo'n
// markering krijgt geen /OPS_TextDir: bij het volgende laden en opslaan
// gebeurt hetzelfde.

import { PDFArray, PDFDict, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { hexToColorArray } from '../../utils/colors.js';
import { normTextDir } from '../../annotations/corrections/geometry.js';
import { pdfTextString } from './pdf-text.js';
import { computeAnnotFlags } from './utils.js';
import { buildStrikeQuads, buildMarkupAppearance } from './correction-dicts.js';

const alsPunten = (q) => [0, 2, 4, 6].map((k) => ({ x: q[k], y: q[k + 1] }));

function omhullende(punten) {
  const xs = punten.map((p) => p.x);
  const ys = punten.map((p) => p.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// Dezelfde vakken per regel, binnen 0,01 pt: het model komt uit de Float32-
// quads van pdf.js.
function zelfdeVakken(bronQuads, berekend) {
  if (bronQuads.length !== berekend.length) return false;
  return bronQuads.every((q, i) => {
    const a = omhullende(alsPunten(q));
    const b = omhullende(berekend[i]);
    return a.every((v, k) => Math.abs(v - b[k]) <= 0.01);
  });
}

// De eerste bron van dezelfde soort met dezelfde vakken; die gaat uit de lijst.
function neemBron(bronnen, subtype, berekend) {
  if (!Array.isArray(bronnen)) return null;
  const i = bronnen.findIndex((b) => b.subtype === subtype && zelfdeVakken(b.quads, berekend));
  return i < 0 ? null : bronnen.splice(i, 1)[0].quads;
}

// Blijft een quad uit het bestand staan? Ja als p1 -> p2 de lange kant is
// (dan is het de leesrichting) of al binnen 1 graad met het model meeloopt.
function houdBronQuad(q, berekend) {
  const v = { x: q[2] - q[0], y: q[3] - q[1] };
  const lengte = Math.hypot(v.x, v.y);
  if (lengte > Math.hypot(q[4] - q[0], q[5] - q[1])) return true;
  const w = { x: berekend[1].x - berekend[0].x, y: berekend[1].y - berekend[0].y };
  const l = Math.hypot(w.x, w.y);
  return lengte > 0 && l > 0 && (v.x * w.x + v.y * w.y) / (lengte * l) >= Math.cos(Math.PI / 180);
}

/**
 * @param {import('pdf-lib').PDFContext} context
 * @param {object} ann  de annotatie zoals in het model (niet omgerekend)
 * @param {(x:number,y:number)=>{x:number,y:number}} map  uit makePointMapper
 * @param {{ opacity: number, pageRot?: number, rgb?: number[], bronnen?: Array<{ subtype: string, quads: number[][] }> }} opties
 *   pageRot: totale /Rotate bij het opslaan; rgb: kleur in plaats van die van
 *   de markering (een gekoppeld kind tekent in de kleur van zijn invoegteken,
 *   die applyGroupLinks in /C zet); bronnen: uit bronMarkeringen voor deze
 *   pagina (een gebruikte bron gaat eruit)
 */
export function buildTextMarkupDict(context, ann, map, { opacity, pageRot = 0, rgb: rgbOverride, bronnen }) {
  // Map type to PDF subtype
  let markupSubtype = 'Highlight';
  if (ann.type === 'textStrikethrough') markupSubtype = 'StrikeOut';
  else if (ann.type === 'textUnderline') markupSubtype = 'Underline';
  else if (ann.type === 'textSquiggly') markupSubtype = 'Squiggly';

  // Quads per regel; zonder rects het vak van de annotatie.
  const rects = Array.isArray(ann.rects) && ann.rects.length > 0
    ? ann.rects : [{ x: ann.x, y: ann.y, width: ann.width, height: ann.height }];
  const textDir = ann.textDir ?? 0;
  const berekend = buildStrikeQuads(rects, textDir, map);
  const bron = neemBron(bronnen, markupSubtype, berekend);
  const quads = bron
    ? berekend.map((q, i) => (houdBronQuad(bron[i], q) ? alsPunten(bron[i]) : q))
    : berekend;

  const rgb = rgbOverride || hexToColorArray(ann.fillColor || ann.color);
  const lw = ann.lineWidth > 0 ? ann.lineWidth : 1;
  const { rect, apRef } = buildMarkupAppearance(context, quads, markupSubtype, rgb, lw);

  const dict = context.obj({
    Type: 'Annot',
    Subtype: markupSubtype,
    Rect: rect,
    QuadPoints: quads.flatMap((q) => q.flatMap((p) => [p.x, p.y])),
    C: rgb,
    CA: opacity,
    T: pdfTextString(ann.author || 'User'),
    Contents: pdfTextString(ann.subject || ''),
    M: PDFString.of(new Date().toISOString()),
    F: computeAnnotFlags(ann)
  });
  // Leesrichting in de ONGEDRAAIDE pagina, zoals bij de correcties; niet bij
  // een markering die al zonder deze sleutel in het bestand stond.
  if (!bron) dict.set(PDFName.of('OPS_TextDir'), PDFNumber.of(normTextDir(textDir - (pageRot || 0))));
  // De lijndikte van de /AP, zodat de lader haar terugvindt (een markeervlak
  // heeft geen lijn).
  if (markupSubtype !== 'Highlight' && ann.lineWidth > 0) {
    dict.set(PDFName.of('OPS_LineWidth'), PDFNumber.of(ann.lineWidth));
  }
  dict.set(PDFName.of('AP'), context.obj({ N: apRef }));
  return dict;
}

const MARKERING_SOORTEN = new Set(['Highlight', 'Underline', 'StrikeOut', 'Squiggly']);

/**
 * De tekstmarkeringen zonder /OPS_TextDir uit de weggehaalde annotaties van
 * een pagina, met hun quads in bestandsvolgorde (per regel 8 getallen).
 * @param {import('pdf-lib').PDFContext} context
 * @param {import('pdf-lib').PDFRef[]} refs
 * @returns {Array<{ subtype: string, quads: number[][] }>}
 */
export function bronMarkeringen(context, refs) {
  const uit = [];
  for (const ref of refs || []) {
    const d = context.lookup(ref);
    if (!(d instanceof PDFDict)) continue;
    const subtype = d.get(PDFName.of('Subtype'))?.toString().replace('/', '');
    if (!MARKERING_SOORTEN.has(subtype) || d.get(PDFName.of('OPS_TextDir')) !== undefined) continue;
    const arr = context.lookup(d.get(PDFName.of('QuadPoints')));
    if (!(arr instanceof PDFArray)) continue;
    const getallen = arr.asArray().map((v) => {
      const n = context.lookup(v);
      return n instanceof PDFNumber ? n.asNumber() : NaN;
    });
    if (getallen.length < 8 || getallen.length % 8 !== 0 || !getallen.every(Number.isFinite)) continue;
    const quads = [];
    for (let i = 0; i < getallen.length; i += 8) quads.push(getallen.slice(i, i + 8));
    uit.push({ subtype, quads });
  }
  return uit;
}
