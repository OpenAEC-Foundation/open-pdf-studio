import { PDFName } from 'pdf-lib';
import { pixelsPerUnitFor, userUnitVanPagina } from '../../annotations/scale-region-scale.js';
import { schaalgebiedenOpPagina, schaalOpPuntUitBronnen, verzamelSchaalBronnen } from '../../annotations/schaal-op-punt.js';
import { lengteEenheid } from '../../annotations/vlak-zijden.js';
import { pdfTextString } from './pdf-text.js';

// Het /Measure-woordenboek (ISO 32000-1, 12.9) van de metingen van de app:
// maat (/Line /IT /LineDimension), omtrekmaat (/PolyLine /IT
// /PolyLineDimension) en meetvlak (/Polygon /IT /PolygonDimension). Andere
// programma's lezen hun schaal, eenheid en afronding hieruit; de waarde
// zelf staat als tekst in /Contents (meetContents hieronder).

/**
 * Het punt waar de meting haar schaal opzoekt, zoals het meetgereedschap:
 * het midden van een maat, het zwaartepunt van de punten van een omtrekmaat
 * of meetvlak (calculatePerimeter en calculateArea in measurement.js).
 */
export function meetPunt(ann) {
  const punten = Array.isArray(ann?.points) ? ann.points : null;
  if (punten && punten.length > 0 && ann.startX === undefined) {
    let x = 0, y = 0;
    for (const p of punten) { x += p.x; y += p.y; }
    return { x: x / punten.length, y: y / punten.length };
  }
  return { x: (ann.startX + ann.endX) / 2, y: (ann.startY + ann.endY) / 2 };
}

/**
 * Resolve the same scale at the measuring point that the drawing tool uses.
 * `inherited` is true when the measurement has no scale of its own and takes
 * it from a scale region, a PDF viewport or the document.
 * Een meetvlak draagt zijn eenheid soms als oppervlakte ('mm²'): de schaal
 * staat in de lengte-eenheid daarvan.
 */
export function dimensionMeasure(ann, doc, preferences = {}, sources = verzamelSchaalBronnen(doc)) {
  const page = ann.page;
  const { x, y } = meetPunt(ann);
  let scale = Number(ann.measureScale);
  let unit = lengteEenheid(ann.measureUnit) || 'mm';
  const inherited = !Number.isFinite(scale) || scale <= 0;
  if (inherited) {
    const region = schaalgebiedenOpPagina(sources, page).find(r =>
      x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height);
    const resolved = region
      ? { pixelsPerUnit: pixelsPerUnitFor(region.scaleString, region.units, userUnitVanPagina(doc, page)), unit: region.units || 'mm' }
      : schaalOpPuntUitBronnen(sources, doc, page, x, y);
    const fallback = preferences.measureScale;
    const effective = resolved?.pixelsPerUnit > 0 ? resolved
      : fallback?.pixelsPerUnit > 0 ? fallback : { pixelsPerUnit: 1, unit: 'mm' };
    scale = 1 / effective.pixelsPerUnit;
    unit = effective.unit || 'mm';
  }
  const requestedPrecision = Number(ann.measurePrecision);
  const precision = Number.isInteger(requestedPrecision) && requestedPrecision >= 0 && requestedPrecision <= 15
    ? requestedPrecision : unit === 'mm' ? 0 : 2;
  return { scale, unit, precision, inherited };
}

/**
 * De oppervlakte-opmaak voor /A van een meetvlak: de eenheid en factor
 * waarin de app de oppervlakte toont (formatMeasurement: mm² wordt m²),
 * zodat een andere lezer dezelfde waarde toont als /Contents.
 */
export function oppervlakteFormaat(unit) {
  if (unit === 'mm') return { C: 1e-6, U: 'm²' };
  return { C: 1, U: `${unit}²` };
}

/**
 * Write the PDF 1.7 rectilinear measure dictionary (ISO 32000-1, 12.9).
 *
 * /X converts default user space units (points) to the unit. /D and /A
 * convert from the units of /X, so their factor is 1 (except /A of a
 * measuring area in mm, which goes to m² like its label). A number format's
 * /D is the precision denominator (10 = one decimal), not a count of
 * decimals; the loader reads it back the same way (color-extraction.js).
 *
 * A scale taken from the page is written for other readers but marked with
 * OPS_ScaleInherited, so the app keeps following the page scale after
 * reopening the file instead of freezing it on the measurement.
 *
 * `opties.vlak`: een meetvlak; /A in de eenheid van het label, met de
 * afronding van het meetvlak (standaard twee decimalen).
 */
export function writeDimensionMeasure(annotDict, context, ann, doc, preferences, sources, opties = {}) {
  const meting = dimensionMeasure(ann, doc, preferences, sources);
  const { scale, unit, precision, inherited } = meting;
  const denominator = 10 ** precision;
  let area = { C: 1, U: `${unit}²` };
  let areaDenominator = denominator;
  if (opties.vlak) {
    area = oppervlakteFormaat(unit);
    const eigen = Number(ann.measurePrecision);
    areaDenominator = 10 ** (Number.isInteger(eigen) && eigen >= 0 && eigen <= 9 ? eigen : 2);
  }
  annotDict.set(PDFName.of('Measure'), context.obj({
    Type: PDFName.of('Measure'),
    Subtype: PDFName.of('RL'),
    R: pdfTextString(`1 pt = ${scale} ${unit}`),
    X: context.obj([context.obj({ C: scale, U: pdfTextString(unit) })]),
    D: context.obj([context.obj({ C: 1, D: denominator, U: pdfTextString(unit) })]),
    A: context.obj([context.obj({ C: area.C, D: areaDenominator, U: pdfTextString(area.U) })]),
  }));
  if (inherited) annotDict.set(PDFName.of('OPS_ScaleInherited'), context.obj(true));
  return meting;
}

// Een getal zonder eenheid: "3530" of "3.530,5" (een maat in mm toont geen mm).
const KAAL_GETAL = /^\s*[-+]?\d[\d.,\s  ]*$/;

/**
 * De tekst voor /Contents van een meting: de meettekst van de app, en bij een
 * kaal getal (een maat in mm) met de eenheid erachter, zodat een andere lezer
 * de waarde met haar eenheid ziet. `eigen` is dan de tekst van de app zelf,
 * die mee gaat in OPS_MeasureText.
 */
export function meetContents(measureText, unit) {
  const tekst = typeof measureText === 'string' ? measureText : '';
  if (!tekst || !unit || !KAAL_GETAL.test(tekst)) return { contents: tekst, eigen: null };
  return { contents: `${tekst.trim()} ${unit}`, eigen: tekst };
}

/**
 * Terug bij het laden: de meettekst van de app als /Contents nog de tekst is
 * die de saver uit OPS_MeasureText maakte (getal plus eenheid). Heeft een
 * ander programma /Contents veranderd, dan wint /Contents.
 */
export function meettekstUitBestand(contents, eigen) {
  if (typeof eigen !== 'string' || !eigen || typeof contents !== 'string') return contents;
  const kern = eigen.trim();
  if (!contents.startsWith(kern)) return contents;
  return /^\s+[^\d\s]+$/.test(contents.slice(kern.length)) ? eigen : contents;
}
