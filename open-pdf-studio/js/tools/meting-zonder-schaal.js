// Een meting op een document zonder schaal zegt dat erbij (#1158).
//
// Zonder schaal toont een nieuwe meting de maat op papier (of de handmatige
// voorkeursschaal). Dat zag er eerder uit als een gewone maat in millimeters;
// wie in voet en inch wilde meten kreeg nergens te horen dat eerst de schaal
// gezet moet worden. De statusbalk wijst nu naar Kalibreren.
//
// De statusbalk en de vertalingen komen er lui bij, zodat de gereedschappen
// (en hun tests) deze module kunnen laden zonder de UI.

import { state } from '../core/state.js';
import { documentHeeftSchaal } from '../annotations/schaal-op-punt.js';
import { meetZonderSchaal } from '../annotations/eenhedenstelsel.js';

/** De vertaalsleutel (namespace common) van de melding. */
export const MELDING_ZONDER_SCHAAL = 'measureNoScale';

/**
 * Meldt in de statusbalk dat het document nog geen schaal heeft.
 * @param {object | null | undefined} doc  het document van de nieuwe meting
 * @returns {boolean}  is er gemeld?
 */
export function meldMetingZonderSchaal(doc) {
  if (!doc) return false;
  const zonder = meetZonderSchaal({
    heeftSchaalbron: documentHeeftSchaal(doc),
    legacySchaal: state.preferences?.measureScale,
  });
  if (!zonder) return false;
  Promise.all([import('../ui/chrome/status-bar.js'), import('../i18n/config.js')])
    .then(([balk, i18n]) => balk.updateStatusMessage(i18n.default.t(MELDING_ZONDER_SCHAAL), 8000))
    .catch(() => { /* zonder UI (tests): geen melding */ });
  return true;
}
