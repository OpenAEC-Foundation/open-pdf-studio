// De breedte van een deur of raam zonder opgave (#1230): één regel voor het
// gereedschap (Deur / Raam in wand) en voor app_floorplan.
//
// Metrisch blad: de maten van de sparing (900 en 1200 mm, sparing.js).
// Blad in voet of inch: 36 en 48 inch (blad-conventie.js).
//
// Puur: geen app-state. Of het blad imperiaal is, vraagt de aanroeper op het
// klikpunt (blad-conventie-op-punt.js, of `omgeving.imperiaalOp` in MCP).

import { SPARING_STANDAARD } from './sparing.js';
import { OPENING_STANDAARD_IMPERIAAL } from './blad-conventie.js';

const SOORT_VAN_KIND = { door: 'deur', window: 'raam', deur: 'deur', raam: 'raam' };

/**
 * @param {'door'|'window'|'deur'|'raam'} soort
 * @param {boolean} imperiaal  het blad staat op deze plek in voet of inch
 * @returns {number} millimeters
 */
export function standaardOpeningBreedteMm(soort, imperiaal) {
  const s = SOORT_VAN_KIND[soort] || 'deur';
  return imperiaal ? OPENING_STANDAARD_IMPERIAAL[s].breedteMm : SPARING_STANDAARD[s].dagmaatMm;
}
