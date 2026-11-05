// Esc in de inline editor van een tekstvlak (textbox/callout, #951).
//
// Esc beëindigt het bewerken en BEWAART wat er getypt is, zoals in andere
// markeringsprogramma's: de getypte tekst ging eerder verloren en er bleef
// een leeg vak achter. Alleen een NIEUW vak waar (nog) niets in staat,
// verdwijnt bij Esc: dat vak is net neergezet en de gebruiker ziet ervan af.
// Een bestaand vak blijft altijd staan, ook als de tekst leeg werd.

/** Bewaar de tekst en sluit de editor. */
export const ESC_BEWAREN = 'bewaren';
/** Haal het (lege, nieuwe) vak weg. */
export const ESC_VERWIJDEREN = 'verwijderen';

/**
 * Wat Esc met het vak doet.
 * @param {{ nieuw?: boolean, tekst?: string }} toestand
 *   nieuw: het vak is net met het gereedschap neergezet en dit is de eerste
 *   bewerking; tekst: de tekst zoals hij nu in de editor staat.
 * @returns {'bewaren'|'verwijderen'}
 */
export function besluitBijEsc({ nieuw = false, tekst = '' } = {}) {
  const leeg = String(tekst ?? '').trim() === '';
  return nieuw && leeg ? ESC_VERWIJDEREN : ESC_BEWAREN;
}
