// Muis-events van een pagina in de doorlopende weergave: één keer per
// paginacontainer koppelen (#1174).
//
// De koppeling hoort bij het aanmaken van de canvassen van een pagina, niet
// bij het einde van een geslaagde render: een render kan onderweg worden
// ingehaald door een nieuwere, mislukken of worden afgebroken. Omdat elke
// render de koppeling nu aanvraagt, bewaakt deze functie dat een container
// zijn luisteraars maar één keer krijgt.

/**
 * @param {WeakSet<object>} gezien  de containers die hun luisteraars al hebben
 * @param {object} element
 * @returns {boolean} true bij de eerste aanvraag voor dit element
 */
export function eenmaalPerElement(gezien, element) {
  if (!element || gezien.has(element)) return false;
  gezien.add(element);
  return true;
}
