// De tekenconventie op een punt van het geopende document (#1230).
//
// De regel zelf staat in blad-conventie.js (puur); hier wordt alleen de
// schaal opgezocht zoals elke meting dat doet (getMeasureScale: schaalgebied,
// viewport, schaalbalk, documentschaal). Wie een wand, deur, raam of ruimte
// plaatst, vraagt hier of het blad op die plek imperiaal is.

import { getActiveDocument } from '../core/state.js';
import { getMeasureScale } from '../annotations/measurement.js';
import { isImperiaalBlad } from './blad-conventie.js';

/**
 * Is het blad op dit punt imperiaal (schaal in ft of in, of de voorkeur
 * Eenheden op Imperiaal)?
 * @param {number} page  paginanummer (1-based)
 * @param {number} x     paginapunten
 * @param {number} y     paginapunten
 */
export function isImperiaalBladOpPunt(page, x, y) {
  return isImperiaalBlad(getMeasureScale(page, x, y));
}

/**
 * Hetzelfde zonder klikpunt, voor de keuzelijsten van een gereedschap voordat
 * de muis op het blad is: het grootste schaalgebied van de pagina beslist, en
 * zonder schaalgebied de schaal van de pagina zelf.
 * @param {number} [page]  standaard de huidige pagina
 */
export function isImperiaalBladOpPagina(page = getActiveDocument()?.currentPage || 1) {
  let grootste = null;
  for (const a of getActiveDocument()?.annotations || []) {
    if (a?.type !== 'scaleRegion' || a.page !== page) continue;
    if (!grootste || a.width * a.height > grootste.width * grootste.height) grootste = a;
  }
  if (grootste) return isImperiaalBlad(grootste.units || 'mm');
  return isImperiaalBlad(getMeasureScale(page));
}
