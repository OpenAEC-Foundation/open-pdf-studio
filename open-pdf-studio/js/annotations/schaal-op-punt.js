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
// op via scale-region.js.
//
// De bronnen worden in één doorloop over de annotaties verzameld
// (verzamelSchaalBronnen); een opzoeking daarna kost alleen nog de bronnen
// van die pagina, niet de hele annotatielijst (#491). Wie veel punten
// opzoekt, verzamelt één keer en vraagt dan schaalOpPuntUitBronnen; zie
// schaal-bronnen.js voor de doorloop die dat voor de app regelt.
//
// Geen app-state: importeert alleen pdf-viewports.js (pdf-lib), zodat de
// regel onder node te testen is en de bruggen hem zonder importcyclus kunnen
// gebruiken.

import { viewportOp } from '../pdf/pdf-viewports.js';

/**
 * @typedef {object} SchaalBronnen
 * @property {Map<any, Array<object>>} viewports  viewport-annotaties per pagina, in lijstvolgorde
 * @property {Map<any, object>} balkOpPagina       eerste schaalbalk per pagina
 * @property {Array<object>} schaalbalken          alle schaalbalken, in lijstvolgorde
 * @property {Map<any, Array<object>>} gebieden    schaalgebieden per pagina, in lijstvolgorde
 * @property {Map<any, Array<object>>} gesorteerd  schaalgebieden per pagina, kleinste eerst (lui)
 */

function voegToe(map, sleutel, waarde) {
  const lijst = map.get(sleutel);
  if (lijst) lijst.push(waarde);
  else map.set(sleutel, [waarde]);
}

// Zelfde gelijkheid als `a.page === pageNum`: een Map ziet NaN als gelijk aan
// NaN, een strikte vergelijking niet.
function opPagina(map, pageNum) {
  return pageNum === pageNum ? map.get(pageNum) : undefined;
}

/**
 * Alle schaalbronnen van een document in één doorloop over de annotaties.
 * De annotaties zelf worden niet gekopieerd: een opzoeking leest hun actuele
 * maten en schaal, alleen wélke annotaties bron zijn (en op welke pagina)
 * ligt vast op het moment van verzamelen.
 * @param {{annotations?:Array<object>} | null | undefined} doc
 * @returns {SchaalBronnen}
 */
export function verzamelSchaalBronnen(doc) {
  const viewports = new Map();
  const balkOpPagina = new Map();
  const schaalbalken = [];
  const gebieden = new Map();
  const annotaties = doc && Array.isArray(doc.annotations) ? doc.annotations : [];
  for (const a of annotaties) {
    const type = a.type;
    if (type === 'viewport') {
      voegToe(viewports, a.page, a);
    } else if (type === 'scaleBar') {
      schaalbalken.push(a);
      const pagina = a.page;
      if (!balkOpPagina.has(pagina)) balkOpPagina.set(pagina, a);
    } else if (type === 'scaleRegion') {
      voegToe(gebieden, a.page, a);
    }
  }
  return { viewports, balkOpPagina, schaalbalken, gebieden, gesorteerd: new Map() };
}

/**
 * De schaalgebieden van een pagina, kleinste oppervlak eerst (het binnenste
 * gebied wint). Bij gelijk oppervlak blijft de lijstvolgorde staan.
 * @param {SchaalBronnen} bronnen
 * @param {number} pageNum
 * @returns {Array<object>}
 */
export function schaalgebiedenOpPagina(bronnen, pageNum) {
  let lijst = bronnen.gesorteerd.get(pageNum);
  if (!lijst) {
    lijst = [...(opPagina(bronnen.gebieden, pageNum) || [])];
    lijst.sort((a, b) => (a.width * a.height) - (b.width * b.height));
    bronnen.gesorteerd.set(pageNum, lijst);
  }
  return lijst;
}

/**
 * schaalOpPunt met vooraf verzamelde bronnen van hetzelfde document.
 * @param {SchaalBronnen} bronnen
 * @param {{pdfViewports?:Record<number, Array<object>>,
 *   measureScale?:{pixelsPerUnit:number, unit?:string}} | null | undefined} doc
 * @param {number} pageNum
 * @param {number} x
 * @param {number} y
 * @returns {{pixelsPerUnit:number, unit:string, method:string} | null}
 */
export function schaalOpPuntUitBronnen(bronnen, doc, pageNum, x, y) {
  if (!doc) return null;

  const viewports = opPagina(bronnen.viewports, pageNum);
  if (viewports) {
    for (const a of viewports) {
      if (x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height) {
        return { pixelsPerUnit: a.pixelsPerUnit, unit: a.unit, method: 'viewport' };
      }
    }
  }

  const balk = opPagina(bronnen.balkOpPagina, pageNum);
  if (balk) return { pixelsPerUnit: balk.pixelsPerUnit, unit: balk.unit, method: 'scaleBar' };

  const vp = viewportOp(doc.pdfViewports?.[pageNum], x, y);
  if (vp) return { pixelsPerUnit: vp.pixelsPerUnit, unit: vp.unit, method: 'pdfViewport' };

  const docSchaal = doc.measureScale;
  if (docSchaal && docSchaal.pixelsPerUnit > 0) {
    return { pixelsPerUnit: docSchaal.pixelsPerUnit, unit: docSchaal.unit || 'mm', method: 'document' };
  }

  if (bronnen.schaalbalken.length) {
    const eerste = bronnen.schaalbalken[0];
    return { pixelsPerUnit: eerste.pixelsPerUnit, unit: eerste.unit, method: 'scaleBar' };
  }
  return null;
}

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
  return schaalOpPuntUitBronnen(verzamelSchaalBronnen(doc), doc, pageNum, x, y);
}

/**
 * Heeft het document ergens een schaalbron (#554)? Een schaalgebied,
 * schaalbalk of viewport-annotatie, een viewport uit de PDF zelf (/VP) of de
 * documentschaal (kalibratie, snelle schaal, schaal uit de titelhoek). Een
 * nieuwe meting neemt dan haar schaal uit die bronnen (getMeasureScale); de
 * handmatige voorkeursschaal van een meetgereedschap geldt alleen als het
 * document er geen enkele heeft.
 * @param {{annotations?:Array<object>, pdfViewports?:Record<number, Array<object>>,
 *   measureScale?:{pixelsPerUnit:number} | null} | null | undefined} doc
 * @returns {boolean}
 */
export function documentHeeftSchaal(doc) {
  if (!doc) return false;
  if (doc.measureScale && doc.measureScale.pixelsPerUnit > 0) return true;
  if (doc.pdfViewports && Object.values(doc.pdfViewports).some((lijst) => Array.isArray(lijst) && lijst.length > 0)) {
    return true;
  }
  const annotaties = Array.isArray(doc.annotations) ? doc.annotations : [];
  return annotaties.some((a) => a.type === 'scaleRegion' || a.type === 'scaleBar' || a.type === 'viewport');
}

/**
 * Als schaalOpPunt, maar met het schaalgebied vooraan (zoals getMeasureScale)
 * en met de bron erbij: wélk schaalgebied, welke viewport, welke schaalbalk.
 * De schaalcontrole (#629) gebruikt dit om te zien of twee punten in dezelfde
 * schaal liggen en om de juiste bron te herkalibreren. De volgorde is die van
 * getMeasureScale; de legacy-voorkeursschaal valt hier weg.
 * @param {object | null | undefined} doc
 * @param {number} pageNum
 * @param {number} x
 * @param {number} y
 * @param {(scaleString:string, unit:string) => number} ppuVoorGebied
 *   omrekening van een schaalgebied (pixelsPerUnitFor uit scale-region-scale.js)
 * @returns {{pixelsPerUnit:number, unit:string, method:string, bron:object|null, sleutel:string} | null}
 */
export function schaalBronOpPunt(doc, pageNum, x, y, ppuVoorGebied) {
  if (!doc) return null;
  const bronnen = verzamelSchaalBronnen(doc);
  for (const r of schaalgebiedenOpPagina(bronnen, pageNum)) {
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
      const unit = r.units || 'mm';
      return {
        pixelsPerUnit: ppuVoorGebied(r.scaleString || '1:100', unit), unit,
        method: 'scaleRegion', bron: r, sleutel: `scaleRegion:${r.id}`,
      };
    }
  }
  const viewports = opPagina(bronnen.viewports, pageNum);
  if (viewports) {
    for (const a of viewports) {
      if (x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height) {
        return { pixelsPerUnit: a.pixelsPerUnit, unit: a.unit, method: 'viewport', bron: a, sleutel: `viewport:${a.id}` };
      }
    }
  }
  const balk = opPagina(bronnen.balkOpPagina, pageNum);
  if (balk) return { pixelsPerUnit: balk.pixelsPerUnit, unit: balk.unit, method: 'scaleBar', bron: balk, sleutel: `scaleBar:${balk.id}` };
  const lijst = doc.pdfViewports?.[pageNum];
  const vp = viewportOp(lijst, x, y);
  if (vp) {
    return {
      pixelsPerUnit: vp.pixelsPerUnit, unit: vp.unit, method: 'pdfViewport', bron: vp,
      sleutel: `pdfViewport:${pageNum}:${lijst.indexOf(vp)}`,
    };
  }
  const docSchaal = doc.measureScale;
  if (docSchaal && docSchaal.pixelsPerUnit > 0) {
    return { pixelsPerUnit: docSchaal.pixelsPerUnit, unit: docSchaal.unit || 'mm', method: 'document', bron: docSchaal, sleutel: 'document' };
  }
  if (bronnen.schaalbalken.length) {
    const eerste = bronnen.schaalbalken[0];
    return { pixelsPerUnit: eerste.pixelsPerUnit, unit: eerste.unit, method: 'scaleBar', bron: eerste, sleutel: `scaleBar:${eerste.id}` };
  }
  return null;
}
