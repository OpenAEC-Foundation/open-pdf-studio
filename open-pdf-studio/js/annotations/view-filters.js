// Centrale weergavefilters voor het canvas (#333).
//
// Eén predicaat dat bepaalt of een annotatie in de huidige WEERGAVE
// onzichtbaar is. Onzichtbaar betekent hier: niet getekend, en dus ook niet
// aanklikbaar, hoverbaar of (marquee-)selecteerbaar — een filter dat alleen
// het tekenen overslaat maar de hit-test laat staan geeft spook-selecties.
//
// Vier bronnen, in volgorde van specificiteit:
//   1. per-annotatie `hidden`-vlag;
//   2. het "Zichtbaarheid Elementen"-paneel (hele annotatie-SOORT verborgen);
//   3. het statusfilter van de annotatielijst (Tonen > Status): review-
//      statussen die de gebruiker heeft uitgevinkt (#236) verbergen de
//      annotatie ook op het canvas (#333);
//   4. annotatielagen (#468): een uitgezette laag wordt niet getekend; een
//      vergrendelde laag wel, maar is niet aanklikbaar (isAnnotationPickableInView).
//
// De regels zelf staan in view-filter-rules.js (puur, getoetst); hier alleen
// de bronnen van het actieve document.
//
// Dit is uitdrukkelijk een WEERGAVE-filter: opslaan raakt het niet — de
// saver loopt over doc.annotations zelf en de AP-raster-route zet
// `_ignoreViewFilters` zodat ook een verborgen annotatie zijn appearance
// gewoon geschreven krijgt.

import { hiddenTypes as evHiddenTypes } from '../solid/stores/elementVisibilityStore.js';
import { isStatusHidden } from '../solid/stores/panels/annotationsStore.js';
import { getActiveDocument } from '../core/state.js';
import { hiddenInView, pickableInView, hiddenInOutput } from './view-filter-rules.js';

function bronnen() {
  return { doc: getActiveDocument(), hiddenTypes: evHiddenTypes(), isStatusHidden };
}

/** Wordt deze annotatie niet getekend? Dan is ze ook niet aanklikbaar. */
export function isAnnotationHiddenInView(ann) {
  return hiddenInView(ann, bronnen());
}

/**
 * Blijft deze annotatie uit een afdruk of export? Wat niet getekend wordt,
 * plus een laag die niet afdrukbaar is (#468). "Afdrukken: Document" laat de
 * hele annotatielaag al weg (rendering/uitvoer-lagen.js); dit is per markering.
 */
export function isAnnotationHiddenInOutput(ann) {
  return hiddenInOutput(ann, bronnen());
}

/**
 * Mag een klik, het selectiekader of "alles selecteren" deze annotatie
 * pakken? Niet als ze verborgen is, en niet als haar laag vergrendeld is.
 */
export function isAnnotationPickableInView(ann) {
  return pickableInView(ann, bronnen());
}
