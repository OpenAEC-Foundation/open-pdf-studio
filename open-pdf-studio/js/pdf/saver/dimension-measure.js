import { PDFName } from 'pdf-lib';
import { pixelsPerUnitFor } from '../../annotations/scale-region-scale.js';
import { schaalgebiedenOpPagina, schaalOpPuntUitBronnen, verzamelSchaalBronnen } from '../../annotations/schaal-op-punt.js';
import { pdfTextString } from './pdf-text.js';

/**
 * Resolve the same scale at the dimension midpoint that the drawing tool uses.
 * `inherited` is true when the line has no scale of its own and takes it from
 * a scale region, a PDF viewport or the document.
 */
export function dimensionMeasure(ann, doc, preferences = {}, sources = verzamelSchaalBronnen(doc)) {
  const page = ann.page;
  const x = (ann.startX + ann.endX) / 2;
  const y = (ann.startY + ann.endY) / 2;
  let scale = Number(ann.measureScale);
  let unit = ann.measureUnit || 'mm';
  const inherited = !Number.isFinite(scale) || scale <= 0;
  if (inherited) {
    const region = schaalgebiedenOpPagina(sources, page).find(r =>
      x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height);
    const resolved = region
      ? { pixelsPerUnit: pixelsPerUnitFor(region.scaleString, region.units), unit: region.units || 'mm' }
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
 * Write the PDF 1.7 rectilinear measure dictionary (ISO 32000-1, 12.9).
 *
 * /X converts default user space units (points) to the unit. /D and /A
 * convert from the units of /X, so their factor is 1. A number format's /D
 * is the precision denominator (10 = one decimal), not a count of decimals;
 * the loader reads it back the same way (color-extraction.js).
 *
 * A scale taken from the page is written for other readers but marked with
 * OPS_ScaleInherited, so the app keeps following the page scale after
 * reopening the file instead of freezing it on the line.
 */
export function writeDimensionMeasure(annotDict, context, ann, doc, preferences, sources) {
  const { scale, unit, precision, inherited } = dimensionMeasure(ann, doc, preferences, sources);
  const denominator = 10 ** precision;
  annotDict.set(PDFName.of('Measure'), context.obj({
    Type: PDFName.of('Measure'),
    Subtype: PDFName.of('RL'),
    R: pdfTextString(`1 pt = ${scale} ${unit}`),
    X: context.obj([context.obj({ C: scale, U: pdfTextString(unit) })]),
    D: context.obj([context.obj({ C: 1, D: denominator, U: pdfTextString(unit) })]),
    A: context.obj([context.obj({ C: 1, D: denominator, U: pdfTextString(`${unit}²`) })]),
  }));
  if (inherited) annotDict.set(PDFName.of('OPS_ScaleInherited'), context.obj(true));
}
