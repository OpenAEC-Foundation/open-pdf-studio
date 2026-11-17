import { meetPunt } from '../../annotations/meet-punt.js';
export { meetPunt };
import { PDFName } from 'pdf-lib';
import { pixelsPerUnitFor, userUnitVanPagina } from '../../annotations/scale-region-scale.js';
import { schaalgebiedenOpPagina, schaalOpPuntUitBronnen, verzamelSchaalBronnen } from '../../annotations/schaal-op-punt.js';
import { lengteEenheid } from '../../annotations/vlak-zijden.js';
import { pdfTextString } from './pdf-text.js';
import { opmaakVanMaat, getalopmaakVoorBestand, maatEenheid } from '../../core/maat-opmaak.js';
import { isImperialeLengte } from '../../core/voet-inch.js';
import { oppervlakteEenheid } from '../../annotations/oppervlakte-eenheid.js';
import { omrekenFactor } from '../../quantities/eenheid-omrekening.js';

// Het /Measure-woordenboek (ISO 32000-1, 12.9) van de metingen van de app:
// maat (/Line /IT /LineDimension), omtrekmaat (/PolyLine /IT
// /PolyLineDimension) en meetvlak (/Polygon /IT /PolygonDimension). Andere
// programma's lezen hun schaal, eenheid en afronding hieruit; de waarde
// zelf staat als tekst in /Contents (meetContents hieronder).

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
  let viewportOpmaak = null;
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
    viewportOpmaak = resolved?.opmaak || null;
  }
  const requestedPrecision = Number(ann.measurePrecision);
  const precision = Number.isInteger(requestedPrecision) && requestedPrecision >= 0 && requestedPrecision <= 15
    ? requestedPrecision : unit === 'mm' ? 0 : 2;
  const meting = { scale, unit, precision, inherited };
  // Getalopmaak (core/maat-opmaak.js) voor writeDimensionMeasure: eigen breuk,
  // eigen decimalen, of die van de viewport van de pagina. Niet opsombaar,
  // zodat de uitkomst voor bestaande aanroepers gelijk blijft.
  Object.defineProperty(meting, 'opmaak', { value: opmaakVanMaat(ann, viewportOpmaak, { eigenSchaal: !inherited }), enumerable: false });
  return meting;
}

/**
 * De oppervlakte-opmaak voor /A van een meetvlak: de eenheid en factor
 * waarin de app de oppervlakte toont (formatMeasurement: mm² wordt m²),
 * zodat een andere lezer dezelfde waarde toont als /Contents.
 */
export function oppervlakteFormaat(unit, weergave) {
  // Een eigen weergave-eenheid (acres, hectares, ..., #1129): de factor van
  // het kwadraat van de lengte-eenheid naar die eenheid. Zonder vaste
  // verhouding (pixels) blijft het kwadraat staan.
  const doel = oppervlakteEenheid(weergave);
  const factor = doel ? omrekenFactor(`${unit}²`, doel) : null;
  if (factor != null) return { C: factor, U: doel };
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
 * `opties.vlak`: een meetvlak; /A in de eenheid van het label (ook acres of
 * hectares, measureAreaUnit), met de afronding van het meetvlak (standaard
 * twee decimalen). De lader leest de weergave-eenheid uit /A terug.
 */
export function writeDimensionMeasure(annotDict, context, ann, doc, preferences, sources, opties = {}) {
  const meting = dimensionMeasure(ann, doc, preferences, sources);
  const { scale, unit, precision, inherited } = meting;
  const denominator = 10 ** precision;
  let area = { C: 1, U: `${unit}²` };
  let areaDenominator = denominator;
  if (opties.vlak) {
    area = oppervlakteFormaat(unit, ann.measureAreaUnit);
    const eigen = Number(ann.measurePrecision);
    areaDenominator = 10 ** (Number.isInteger(eigen) && eigen >= 0 && eigen <= 9 ? eigen : 2);
  }
  // Voet-inch met een breuk: voet → inch met /F /F (PDF 32000-1, 12.9.2),
  // zoals een andere lezer hem dan ook toont. Anders decimaal.
  const breuk = !opties.vlak && meting.opmaak?.fractie && isImperialeLengte(maatEenheid(unit));
  const dReeks = breuk
    ? getalopmaakVoorBestand(unit, meting.opmaak).map((f) => context.obj({
      C: f.C, D: f.D, F: PDFName.of(f.F), FD: true, U: pdfTextString(f.U), SS: pdfTextString(f.SS ?? ''),
    }))
    : [context.obj({ C: 1, D: denominator, U: pdfTextString(unit) })];
  annotDict.set(PDFName.of('Measure'), context.obj({
    Type: PDFName.of('Measure'),
    Subtype: PDFName.of('RL'),
    R: pdfTextString(`1 pt = ${scale} ${unit}`),
    X: context.obj([context.obj({ C: scale, U: pdfTextString(unit) })]),
    D: context.obj(dReeks),
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
