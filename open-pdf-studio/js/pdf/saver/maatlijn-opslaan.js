// Opslaan van een maat (measureDistance) als /Line /IT /LineDimension met
// /Measure, hulplijnen (/L + /LL) en een vector-appearance.
//
// Een maat uit een ander programma neemt zijn opmaak mee in het model
// (loader/maatlijn-uit-bestand.js): holle punten (headFill false), het
// bijschrift in de lijn (dimTextPosition 'inline'), tekstgrootte en
// tekstkleur. Na opslaan staat er OPS_Subtype in het bestand en geldt hij als
// eigen maat; die opmaak gaat daarom mee in eigen sleutels:
//   OPS_HeadFill false      holle punten
//   OPS_DimTextPos /Inline  bijschrift in de lijn
//   OPS_LabelColor [r g b]  tekstkleur
//   OPS_FontSize getal      tekstgrootte (pt), bij zo'n overgenomen maat of
//                           als de grootte uit het bestand kwam
//                           (fontSizeUitBestand, ook zonder andere opmaak)
// Uitloop en hulplijnen gaan al mee in de plattegrondsleutels
// (saver/plattegrond-meta.js). Eigen maten hebben deze velden niet en worden
// precies zo opgeslagen als altijd.

import { PDFName, PDFString } from 'pdf-lib';
import { hexToColorArray } from '../../utils/colors.js';
import { buildBorderStyle, computeAnnotFlags } from './utils.js';
import { pdfTextString } from './pdf-text.js';
import { schrijfPlattegrondMeta } from './plattegrond-meta.js';
import { buildMeasureDistanceAP, buildInlineMaatAP } from './appearance-vectors.js';
import { attachVectorAP } from './vector-ap.js';
import { maatlijnTekst, maatLabelRuimte } from '../../annotations/maat-label.js';
import { maatlijnGeometrie, maatlijnVelden, papierMmNaarPt } from '../../annotations/maatlijn-geometrie.js';
import { inlineMaatlijn, helveticaBreedte } from '../../annotations/maatlijn-inline.js';

/** Een maat met opmaak uit een ander programma (zie de kop van dit bestand). */
export function heeftOvergenomenOpmaak(ann) {
  return ann?.dimTextPosition === 'inline' || ann?.headFill === false || !!ann?.labelColor;
}

/** De eigen sleutel voor holle punten; ook voor pijlen en omtrekmaten (saver.js). */
export function kopVullingSleutels(ann) {
  return ann?.headFill === false ? { OPS_HeadFill: false } : {};
}

/** De eigen sleutels van de overgenomen opmaak van een maat. */
export function maatlijnStijlSleutels(ann) {
  const uit = { ...kopVullingSleutels(ann) };
  if (ann?.dimTextPosition === 'inline') uit.OPS_DimTextPos = PDFName.of('Inline');
  if (ann?.labelColor) uit.OPS_LabelColor = hexToColorArray(ann.labelColor);
  if ((heeftOvergenomenOpmaak(ann) || ann?.fontSizeUitBestand) && Number(ann.fontSize) > 0) {
    uit.OPS_FontSize = Number(ann.fontSize);
  }
  return uit;
}

const rond = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Het annotatiewoordenboek van een maat, met appearance. `ann` staat al in
 * het ongedraaide paginaframe (saver.js); `convertX`/`convertY` rekenen naar
 * PDF-coördinaten. `paginaRotatie` is de /Rotate van de pagina.
 */
export function maatlijnAnnotatie({ ann, context, convertX, convertY, opacity, borderWidth, paginaRotatie = 0 }) {
  let annotDict;
  const overgenomen = heeftOvergenomenOpmaak(ann);
  const inline = ann.dimTextPosition === 'inline';
  const draaiing = (Number(paginaRotatie) || 0) * Math.PI / 180;
  const mapDimHead = (h) => {
    switch (h) {
      case 'open': return 'OpenArrow';
      case 'closed': return 'ClosedArrow';
      case 'diamond': return 'Diamond';
      case 'circle': return 'Circle';
      case 'openCircle': return 'Circle';
      case 'square': return 'Square';
      case 'slash': return 'Slash';
      case 'butt': return 'Butt';
      case 'openReversed': return 'ROpenArrow';
      case 'closedReversed': return 'RClosedArrow';
      default: return 'Circle';
    }
  };
  // Save as Line annotation with Measure dictionary
  // Data model: startX/Y = dimension line, leaderX/Y = base object points
  const mdx1 = convertX(ann.startX);
  const mdy1 = convertY(ann.startY);
  const mdx2 = convertX(ann.endX);
  const mdy2 = convertY(ann.endY);

  // Compute rect including all points, plus room for the label that
  // sits above the line (the /AP BBox is the Rect: a tight Rect
  // would clip the text in other viewers).
  const mdPad = maatLabelRuimte({
    fontSize: ann.fontSize, startHead: ann.startHead || 'openCircle',
    endHead: ann.endHead || 'openCircle', headSize: ann.headSize || 12,
    tekst: maatlijnTekst(ann.measureText, ann.dimShowUnit),
  });
  let mdRectMinX = Math.min(mdx1, mdx2) - mdPad;
  let mdRectMinY = Math.min(mdy1, mdy2) - mdPad;
  let mdRectMaxX = Math.max(mdx1, mdx2) + mdPad;
  let mdRectMaxY = Math.max(mdy1, mdy2) + mdPad;
  // De uitloop van de maatlijn en de doorloop van de hulplijnen
  // (maatlijn-geometrie.js) vallen ook binnen de Rect.
  const mdGeo = maatlijnGeometrie(maatlijnVelden(ann));
  for (const l of [mdGeo.maatlijn, ...mdGeo.hulplijnen]) {
    for (const [gx, gy] of [[convertX(l.x1), convertY(l.y1)], [convertX(l.x2), convertY(l.y2)]]) {
      mdRectMinX = Math.min(mdRectMinX, gx - 2); mdRectMaxX = Math.max(mdRectMaxX, gx + 2);
      mdRectMinY = Math.min(mdRectMinY, gy - 2); mdRectMaxY = Math.max(mdRectMaxY, gy + 2);
    }
  }
  // Bijschrift in de lijn: ook de staarten en punten van een korte maat.
  if (inline) {
    const fs = Number(ann.fontSize) > 0 ? Number(ann.fontSize) : 11;
    const il = inlineMaatlijn({
      ...maatlijnVelden(ann), lineWidth: borderWidth, startHead: ann.startHead, endHead: ann.endHead,
      tekstBreedte: helveticaBreedte(maatlijnTekst(ann.measureText, ann.dimShowUnit), fs), fontSize: fs,
      tekstOffsetX: ann.textOffsetX, tekstOffsetY: ann.textOffsetY, draaiing,
    });
    const marge = (ann.headSize || 12) + (borderWidth || 0) + 2;
    for (const l of il.lijnstukken) {
      for (const [gx, gy] of [[convertX(l.x1), convertY(l.y1)], [convertX(l.x2), convertY(l.y2)]]) {
        mdRectMinX = Math.min(mdRectMinX, gx - marge); mdRectMaxX = Math.max(mdRectMaxX, gx + marge);
        mdRectMinY = Math.min(mdRectMinY, gy - marge); mdRectMaxY = Math.max(mdRectMaxY, gy + marge);
      }
    }
  }

  // PDF /L = base object points when leaders exist, else dimension line
  let pdfLX1 = mdx1, pdfLY1 = mdy1, pdfLX2 = mdx2, pdfLY2 = mdy2;

  const mdDict = {
    Type: 'Annot',
    Subtype: 'Line',
    C: hexToColorArray(ann.strokeColor || '#ff0000'),
    CA: opacity,
    T: pdfTextString(ann.author || 'User'),
    Contents: pdfTextString(ann.measureText || ''),
    M: PDFString.of(new Date().toISOString()),
    IT: PDFName.of('LineDimension'),
    OPS_Subtype: PDFString.of('measureDistance'),
    LE: [PDFName.of(mapDimHead(ann.startHead)), PDFName.of(mapDimHead(ann.endHead))],
    F: computeAnnotFlags(ann)
  };

  // Save custom properties for exact round-trip
  if (ann.headSize && ann.headSize !== 12) mdDict.OPS_HeadSize = ann.headSize;
  if (ann.measurePrecision != null && ann.measurePrecision !== 2) mdDict.OPS_Precision = ann.measurePrecision;
  // User-dragged text position: offset from the dimension-line
  // midpoint, stored in the same visual frame as the annotation
  // (loader reads it back verbatim — no coordinate conversion).
  if (ann.textOffsetX || ann.textOffsetY) {
    mdDict.OPS_TextOffsetX = ann.textOffsetX || 0;
    mdDict.OPS_TextOffsetY = ann.textOffsetY || 0;
  }
  // Overgenomen opmaak (holle punten, bijschrift in de lijn, tekst).
  Object.assign(mdDict, maatlijnStijlSleutels(ann));

  // Save leader line properties if extension lines exist
  if (ann.leaderStartX !== undefined) {
    // leaderStartX/Y = /L base object points in our data model
    const lsx = convertX(ann.leaderStartX);
    const lsy = convertY(ann.leaderStartY);
    const lex = convertX(ann.leaderEndX);
    const ley = convertY(ann.leaderEndY);
    // /L = base object points
    pdfLX1 = lsx; pdfLY1 = lsy;
    pdfLX2 = lex; pdfLY2 = ley;
    // Compute LL: perpendicular distance from /L base to dimension line
    const lineAngle = Math.atan2(ley - lsy, lex - lsx);
    const perpX = -Math.sin(lineAngle);
    const perpY = Math.cos(lineAngle);
    const ll = (mdx1 - lsx) * perpX + (mdy1 - lsy) * perpY;
    mdDict.LL = ll;
    mdDict.LLE = 5;
    // Een overgenomen maat schrijft /LLE en /LLO zoals hij ze tekent.
    if (overgenomen) {
      if (ann.dimExtOvershootMm !== undefined && ann.dimExtOvershootMm !== null) {
        mdDict.LLE = rond(papierMmNaarPt(ann.dimExtOvershootMm));
      }
      const llo = rond(papierMmNaarPt(ann.dimExtGapMm));
      if (llo > 0) mdDict.LLO = llo;
    }
    // Expand rect to include base points
    mdRectMinX = Math.min(mdRectMinX, lsx, lex);
    mdRectMinY = Math.min(mdRectMinY, lsy, ley);
    mdRectMaxX = Math.max(mdRectMaxX, lsx, lex);
    mdRectMaxY = Math.max(mdRectMaxY, lsy, ley);
  }

  mdDict.L = [pdfLX1, pdfLY1, pdfLX2, pdfLY2];

  mdDict.Rect = [mdRectMinX, mdRectMinY, mdRectMaxX, mdRectMaxY];

  // Save Measure dictionary with scale factor
  if (ann.measureScale || inline) {
    mdDict.Cap = true;
    mdDict.CP = PDFName.of('Inline');
  }

  annotDict = context.obj(mdDict);

  if (ann.measureScale) {
    const numFmt = context.obj({
      C: ann.measureScale,
      D: 1,
      U: pdfTextString(ann.measureUnit || 'mm'),
    });
    const measureDict = context.obj({
      Subtype: PDFName.of('RL'),
      R: pdfTextString(`1 pt = ${ann.measureScale} ${ann.measureUnit || 'mm'}`),
      X: context.obj([numFmt]),
    });
    annotDict.set(PDFName.of('Measure'), measureDict);
  }

  annotDict.set(PDFName.of('BS'), buildBorderStyle(context, borderWidth, ann.borderStyle));
  // Vector /AP so the dimension line, extension lines AND the value
  // label render in other viewers (label was Contents-only) — #256.
  // Maat zonder eenheid (dimShowUnit false) en de plattegrond-sleutels.
  schrijfPlattegrondMeta(annotDict, ann, context, convertX, convertY);
  const apOpties = {
    ...maatlijnVelden(ann),
    X: convertX, Y: convertY, strokeColorHex: ann.strokeColor || '#ff0000',
    lineWidth: borderWidth, borderStyle: ann.borderStyle,
    // De tekst zoals het scherm hem toont (maat-label.js).
    text: maatlijnTekst(ann.measureText, ann.dimShowUnit),
    textOffsetX: ann.textOffsetX, textOffsetY: ann.textOffsetY,
    fontSize: ann.fontSize, startHead: ann.startHead || 'openCircle',
    endHead: ann.endHead || 'openCircle', headSize: ann.headSize || 12,
  };
  // Bijschrift in de lijn: lijnstukken, punten en tekst zoals het scherm
  // (annotations/maatlijn-inline.js); anders de tekst boven de lijn.
  const ap = inline
    ? buildInlineMaatAP({ ...apOpties, headFill: ann.headFill, labelColorHex: ann.labelColor, draaiing })
    : buildMeasureDistanceAP(ann.labelColor ? { ...apOpties, labelColorHex: ann.labelColor } : apOpties);
  attachVectorAP(context, annotDict, ap, mdDict.Rect);
  return annotDict;
}
