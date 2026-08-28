// Centrale weergavefilters voor het canvas (#333).
//
// Eén predicaat dat bepaalt of een annotatie in de huidige WEERGAVE
// onzichtbaar is. Onzichtbaar betekent hier: niet getekend, en dus ook niet
// aanklikbaar, hoverbaar of (marquee-)selecteerbaar — een filter dat alleen
// het tekenen overslaat maar de hit-test laat staan geeft spook-selecties.
//
// Drie bronnen, in volgorde van specificiteit:
//   1. per-annotatie `hidden`-vlag;
//   2. het "Zichtbaarheid Elementen"-paneel (hele annotatie-SOORT verborgen);
//   3. het statusfilter van de annotatielijst (Tonen > Status): review-
//      statussen die de gebruiker heeft uitgevinkt (#236) verbergen de
//      annotatie ook op het canvas (#333).
//
// Dit is uitdrukkelijk een WEERGAVE-filter: opslaan raakt het niet — de
// saver loopt over doc.annotations zelf en de AP-raster-route zet
// `_ignoreViewFilters` zodat ook een verborgen annotatie zijn appearance
// gewoon geschreven krijgt.

import { hiddenTypes as evHiddenTypes } from '../solid/stores/elementVisibilityStore.js';
import { isStatusHidden } from '../solid/stores/panels/annotationsStore.js';

export function isAnnotationHiddenInView(ann) {
  if (!ann) return false;
  if (ann.hidden) return true;
  if (evHiddenTypes().has(ann.type)) return true;
  return isStatusHidden(ann);
}
