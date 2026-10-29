// Esc in het voortgangsvenster (LoadingOverlay.jsx) doet hetzelfde als de
// knop Annuleren (#766). Los van Solid, zodat het onder node te testen is.
//
// Zolang het venster met een knop Annuleren openstaat, gaat Esc niet door naar
// de rest van de app (een gereedschap of dialoog erachter): de luisteraar zit
// in de capture-fase en stopt de toets. Is de knop uit (voorbij het punt
// zonder terugkeer) of al gebruikt, dan doet Esc niets.

export function isAnnuleerToets(e) {
  return e?.key === 'Escape' || e?.key === 'Esc';
}

/**
 * @param {EventTarget} doel meestal `window`
 * @param {{ open: () => boolean, kan: () => boolean, annuleer: () => void }} haken
 *   open: het venster staat open met een knop Annuleren;
 *   kan: de knop staat aan.
 * @returns {() => void} loskoppelen
 */
export function koppelEscAnnuleren(doel, { open, kan, annuleer }) {
  const opToets = (e) => {
    if (!isAnnuleerToets(e) || !open()) return;
    e.preventDefault?.();
    e.stopImmediatePropagation?.();
    e.stopPropagation?.();
    if (e.repeat || !kan()) return;
    annuleer();
  };
  doel.addEventListener('keydown', opToets, { capture: true });
  return () => doel.removeEventListener('keydown', opToets, { capture: true });
}
