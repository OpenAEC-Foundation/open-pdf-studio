import { PDFName } from 'pdf-lib';
import { pixelsPerUnitFor } from '../../annotations/scale-region-scale.js';
import { schaalgebiedenOpPagina, schaalOpPuntUitBronnen, verzamelSchaalBronnen } from '../../annotations/schaal-op-punt.js';
import { pdfTextString } from './pdf-text.js';

/** Resolve the same scale at the dimension midpoint that the drawing tool uses. */
export function dimensionMeasure(ann, doc, preferences = {}, sources = verzamelSchaalBronnen(doc)) {
  const page = ann.page;
  const x = (ann.startX + ann.endX) / 2;
  const y = (ann.startY + ann.endY) / 2;
  let scale = Number(ann.measureScale);
  let unit = ann.measureUnit || 'mm';
  if (!Number.isFinite(scale) || scale <= 0) {
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
  return { scale, unit, precision };
}

/** Write the PDF 1.7 rectilinear measure dictionary, including required /D. */
export function writeDimensionMeasure(annotDict, context, ann, doc, preferences, sources) {
  const { scale, unit, precision } = dimensionMeasure(ann, doc, preferences, sources);
  const format = context.obj({ C: scale, D: precision, U: pdfTextString(unit) });
  const formats = context.obj([format]);
  annotDict.set(PDFName.of('Measure'), context.obj({
    Type: PDFName.of('Measure'),
    Subtype: PDFName.of('RL'),
    R: pdfTextString(`1 pt = ${scale} ${unit}`),
    X: formats,
    D: formats,
  }));
}
