// Pure rules of "Protect with password" (see protect-pdf.js): no state, no DOM.

/** Shortest password the dialog accepts, in characters. */
export const MIN_LENGTE = 6;

/** The rights a recipient has; all on = unrestricted. */
export const STANDAARD_RECHTEN = Object.freeze({
  print: true,
  printHogeKwaliteit: true,
  wijzigen: true,
  kopieren: true,
  annoteren: true,
  formulieren: true,
  samenstellen: true,
  toegankelijkheid: true,
});

/**
 * Checks the dialog input. Returns an i18n key (dialogs namespace) for the
 * first problem, or null when the input can be used.
 * @param {{ gebruiker: string, gebruikerHerhaald: string, eigenaar: string, eigenaarHerhaald: string }} v
 */
export function controleerWachtwoorden({ gebruiker, gebruikerHerhaald, eigenaar, eigenaarHerhaald }) {
  if (!gebruiker && !eigenaar) return 'protectPdf.needPassword';
  // Een kort wachtwoord is snel te raden, ook bij AES-256.
  if ((gebruiker && [...gebruiker].length < MIN_LENGTE) || (eigenaar && [...eigenaar].length < MIN_LENGTE)) {
    return 'protectPdf.tooShort';
  }
  if (gebruiker !== gebruikerHerhaald) return 'protectPdf.userMismatch';
  if (eigenaar !== eigenaarHerhaald) return 'protectPdf.ownerMismatch';
  if (gebruiker && eigenaar && gebruiker === eigenaar) return 'protectPdf.samePassword';
  return null;
}

