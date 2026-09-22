// De schaal op één punt van een pagina, uit de bronnen van het document, in
// één vaste volgorde (#400). Dit is de gedeelde regel achter
// scale-bar.getScaleForPoint, en daarmee achter getMeasureScale én de lichte
// schaalbruggen (stempels, stavenreeks, betonbalk, systeemraster, dynamische
// schaal): de volgorde staat op één plek en loopt niet op vijf plekken uiteen.
//
// Volgorde:
//   1. viewport-annotatie van de app die het punt bevat
//   2. schaalbalk-annotatie op dezelfde pagina
//   3. viewport uit de PDF zelf (/VP + /Measure: CAD-plots, de DWG/DXF-import)
//   4. documentschaal (doc.measureScale)
//   5. schaalbalk op een andere pagina
// Het schaalgebied (scaleRegion) gaat hier nog vóór; dat zoekt de aanroeper
// op via scale-region.js, waar de cache ervan leeft.
//
// Geen app-state: importeert alleen pdf-viewports.js (pdf-lib), zodat de
// regel onder node te testen is en de bruggen hem zonder importcyclus kunnen
// gebruiken.

import { viewportOp } from '../pdf/pdf-viewports.js';

/**
 * @param {{annotations?:Array<object>, pdfViewports?:Record<number, Array<object>>,
 *   measureScale?:{pixelsPerUnit:number, unit?:string}} | null | undefined} doc
 * @param {number} pageNum
 * @param {number} x
 * @param {number} y
 * @returns {{pixelsPerUnit:number, unit:string, method:string} | null}
 */
export function schaalOpPunt(doc, pageNum, x, y) {
  if (!doc) return null;
  const annotaties = Array.isArray(doc.annotations) ? doc.annotations : [];

  for (const a of annotaties) {
    if (a.type !== 'viewport' || a.page !== pageNum) continue;
    if (x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height) {
      return { pixelsPerUnit: a.pixelsPerUnit, unit: a.unit, method: 'viewport' };
    }
  }

  const schaalbalken = annotaties.filter((a) => a.type === 'scaleBar');
  const opPagina = schaalbalken.find((sb) => sb.page === pageNum);
  if (opPagina) return { pixelsPerUnit: opPagina.pixelsPerUnit, unit: opPagina.unit, method: 'scaleBar' };

  const vp = viewportOp(doc.pdfViewports?.[pageNum], x, y);
  if (vp) return { pixelsPerUnit: vp.pixelsPerUnit, unit: vp.unit, method: 'pdfViewport' };

  const docSchaal = doc.measureScale;
  if (docSchaal && docSchaal.pixelsPerUnit > 0) {
    return { pixelsPerUnit: docSchaal.pixelsPerUnit, unit: docSchaal.unit || 'mm', method: 'document' };
  }

  if (schaalbalken.length) {
    return { pixelsPerUnit: schaalbalken[0].pixelsPerUnit, unit: schaalbalken[0].unit, method: 'scaleBar' };
  }
  return null;
}
