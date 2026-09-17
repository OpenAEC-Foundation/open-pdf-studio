// Pointer-events-doorval van het selectiegereedschap.
//
// In select-modus ligt het annotatiecanvas (z 6) boven de tekstlaag (z 5).
// Bij elke muisbeweging bepaalt tools/manager.js wie de volgende pointerdown
// krijgt:
//   - boven een annotatie (of greep): het canvas → klikken/slepen/grepen;
//   - boven PDF-tekst: de tekstlaag → native tekstselectie;
//   - boven leeg paginavlak: het canvas → selectierechthoek.
//
// Voorheen viel ook het lege paginavlak door naar de tekstlaag. Een
// selectierechthoek kwam dan alleen nog bij het selectiegereedschap aan
// wanneer de "armed marquee" (knop Selecteren / Escape) het canvas eenmalig
// forceerde; de tweede rechthoek belandde in de (lege) tekstlaag en
// selecteerde niets.

/**
 * @param {{overAnnotatie: boolean, overTekst: boolean, knopIngedrukt: boolean}} p
 * @returns {null | {canvas: 'auto'|'none', tekstlaag: 'auto'|'none', spanCursor: ''|'text'}}
 *   null = niets omschakelen (lopende sleep, bv. een tekstselectie).
 */
export function doorvalVoorSelectie({ overAnnotatie, overTekst, knopIngedrukt }) {
  if (knopIngedrukt) return null;
  if (overAnnotatie) return { canvas: 'auto', tekstlaag: 'none', spanCursor: '' };
  if (overTekst) return { canvas: 'none', tekstlaag: 'auto', spanCursor: 'text' };
  // Leeg vlak: het canvas vangt de pointerdown (selectierechthoek). De
  // tekstlaag blijft raakbaar zodat staatBovenTekst() de tekst onder het
  // canvas via elementsFromPoint blijft zien.
  return { canvas: 'auto', tekstlaag: 'auto', spanCursor: 'text' };
}

/** Is dit element tekstinhoud van een tekstlaag (niet de laag zelf)? */
export function isTekstElement(el) {
  const laag = el?.closest?.('.textLayer');
  return !!laag && laag !== el && !el.classList?.contains?.('endOfContent');
}

/** Ligt er tekst in de elementstapel onder de aanwijzer (document.elementsFromPoint)? */
export function staatBovenTekst(elementen) {
  return Array.isArray(elementen) && elementen.some(isTekstElement);
}
