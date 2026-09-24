// De regels achter de weergavefilters (#333, #468), zonder stores of state:
// view-filters.js levert de bronnen (het actieve document, de verborgen
// soorten, het statusfilter) en deze module beslist. Zo zijn de regels in
// node te toetsen.
//
// Twee vragen, met één antwoord voor het tekenen en de raakdetectie:
//   - hiddenInView: wordt de annotatie niet getekend? Dan is ze ook niet
//     aanklikbaar, hoverbaar of met een kader te selecteren.
//   - pickableInView: mag een klik, het selectiekader of "alles selecteren"
//     haar pakken? Niet als ze verborgen is, en niet als haar laag
//     vergrendeld is — die blijft zichtbaar, maar is niet te selecteren en
//     dus ook niet te verplaatsen.

import { isLayerHidden, isLayerLocked, isLayerPrintable } from './annotatie-lagen.js';

/**
 * @typedef {object} WeergaveBronnen
 * @property {object|null} doc              het document van de annotatie
 * @property {Set<string>} [hiddenTypes]    "Zichtbaarheid Elementen": verborgen soorten
 * @property {(ann:object)=>boolean} [isStatusHidden]  statusfilter van de annotatielijst
 */

/** @param {object} ann @param {WeergaveBronnen} bron */
export function hiddenInView(ann, bron = {}) {
  if (!ann) return false;
  // 1. per-annotatie `hidden`-vlag;
  if (ann.hidden) return true;
  // 2. het "Zichtbaarheid Elementen"-paneel (hele annotatie-SOORT verborgen);
  if (bron.hiddenTypes && bron.hiddenTypes.has(ann.type)) return true;
  // 3. het statusfilter van de annotatielijst (#236, #333);
  if (bron.isStatusHidden && bron.isStatusHidden(ann)) return true;
  // 4. de laag van de annotatie staat uit (#468).
  return isLayerHidden(bron.doc, ann);
}

/**
 * Blijft deze annotatie uit een afdruk, export of printvoorbeeld? Alles wat
 * niet op het scherm staat, plus een laag die niet afdrukbaar is (#468). Een
 * vergrendelde laag drukt gewoon af.
 * @param {object} ann @param {WeergaveBronnen} bron
 */
export function hiddenInOutput(ann, bron = {}) {
  if (!ann) return false;
  if (hiddenInView(ann, bron)) return true;
  return !isLayerPrintable(bron.doc, ann);
}

/** @param {object} ann @param {WeergaveBronnen} bron */
export function pickableInView(ann, bron = {}) {
  if (!ann) return false;
  if (hiddenInView(ann, bron)) return false;
  return !isLayerLocked(bron.doc, ann);
}
