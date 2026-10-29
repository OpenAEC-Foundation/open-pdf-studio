// Invoer van de bijsnij-overlay (image-crop-overlay.js), los en getest (#749).
//
// De overlay hing zijn pointer-handlers in de capture-fase aan het
// annotatiecanvas zelf. Dat canvas is ook het doel van de klik, en op het
// doel houdt stopPropagation() de andere luisteraars van hetzelfde element
// niet tegen: het selectiegereedschap kreeg dezelfde pointerdown op dezelfde
// greep en schaalde de afbeelding terwijl de overlay bijsneed. Het resultaat
// was een uitgerekte of ongewijzigde afbeelding: "Bijsnijden snijdt niets
// bij". In de doorlopende weergave kwam er bovendien niets aan, want daar
// krijgt elk paginacanvas de events, niet #annotation-canvas.
//
// Nu luistert de overlay in de capture-fase op het document (vóór elk
// element in de weergave) en houdt hij een klik op een greep volledig tegen.

const SOORTEN = ['pointerdown', 'pointermove', 'pointerup'];

/** Ligt het doel van de gebeurtenis in de documentweergave (enkel of doorlopend)? */
export function inDocumentWeergave(doel) {
  return !!(doel && typeof doel.closest === 'function' && doel.closest('#pdf-container'));
}

/** De gebeurtenis is van de overlay: geen enkele andere luisteraar krijgt hem nog. */
export function eisGebeurtenisOp(e) {
  e.preventDefault?.();
  e.stopPropagation?.();
  e.stopImmediatePropagation?.();
}

/**
 * Hang de handlers in de capture-fase aan `doel` (het document).
 * @param {EventTarget} doel
 * @param {{ pointerdown: Function, pointermove: Function, pointerup: Function }} handlers
 * @returns {() => void}  haalt ze er weer af
 */
export function installeerCropInvoer(doel, handlers) {
  const opties = { capture: true };
  for (const soort of SOORTEN) doel.addEventListener(soort, handlers[soort], opties);
  return () => {
    for (const soort of SOORTEN) doel.removeEventListener(soort, handlers[soort], opties);
  };
}
