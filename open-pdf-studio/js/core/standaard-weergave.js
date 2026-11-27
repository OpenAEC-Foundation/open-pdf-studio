// Default page layout (#1289): the layout a document opens in.
//
// The preference defaultViewMode holds one of the names setViewMode() takes:
//  - 'single'      one page at a time;
//  - 'continuous'  single pages, scrolling through the document;
//  - 'facing'      two pages side by side, one spread at a time;
//  - 'book'        two pages side by side, scrolling through the document.
// In both two-page layouts page 1 stands alone, like the cover of a book.
//
// Pure: no app state. tabs.js gives a new document its start layout from
// here and preferences.js runs the one-time migration.

/** The layouts the app can show, in the order of the Preferences list. */
export const PAGINA_INDELINGEN = ['single', 'continuous', 'facing', 'book'];

/** The layout when nothing (valid) is stored: single page. */
export const STANDAARD_INDELING = 'single';

/** A valid layout name; anything else falls back to single page. */
export function normaliseerIndeling(waarde) {
  return PAGINA_INDELINGEN.includes(waarde) ? waarde : STANDAARD_INDELING;
}

/**
 * The fields a new document starts with for a layout. The two-page layouts
 * are variants of the continuous view (see setViewMode in renderer.js):
 * viewMode stays 'continuous' and a flag picks the variant.
 * @param {unknown} voorkeur  state.preferences.defaultViewMode
 * @returns {{viewMode: 'single' | 'continuous', bookSpread: boolean, facingSpread: boolean}}
 */
export function beginWeergave(voorkeur) {
  const indeling = normaliseerIndeling(voorkeur);
  return {
    viewMode: indeling === 'single' ? 'single' : 'continuous',
    bookSpread: indeling === 'book',
    facingSpread: indeling === 'facing',
  };
}

/**
 * The layout a document is in, as the name setViewMode() takes: the reverse
 * of beginWeergave(). The flags only count in the continuous view.
 * @param {{viewMode?: string, bookSpread?: boolean, facingSpread?: boolean} | null | undefined} doc
 */
export function indelingVan(doc) {
  if (!doc || doc.viewMode !== 'continuous') return 'single';
  if (doc.facingSpread) return 'facing';
  if (doc.bookSpread) return 'book';
  return 'continuous';
}

/**
 * One-time migration for stored preferences. Continuous was the default in
 * one release (2026.47.1) while the layout could not be chosen anywhere, so
 * a stored value from before this setting existed is never a user's choice:
 * it goes back to single page once. The flag viewModeDefaultSingle makes sure
 * this happens only once; a layout chosen in Preferences afterwards is kept.
 * Changes and returns `opgeslagen`.
 * @param {Record<string, unknown>} opgeslagen  the loaded preferences
 */
export function migreerStandaardWeergave(opgeslagen) {
  if (!opgeslagen) return opgeslagen;
  if (opgeslagen.viewModeDefaultSingle !== true) {
    opgeslagen.defaultViewMode = STANDAARD_INDELING;
    opgeslagen.viewModeDefaultSingle = true;
  }
  // A value this version does not know (hand-edited, or from a newer
  // version) opens as single page.
  opgeslagen.defaultViewMode = normaliseerIndeling(opgeslagen.defaultViewMode);
  return opgeslagen;
}
