// Beslisregels voor het losmaken van een tabblad (zuiver, zonder DOM of IPC).
//
// Een tabblad dat voorbij de drempel uit de tabbalk gesleept en losgelaten
// wordt, opent in een TWEEDE app-instantie: een eigen proces met een eigen
// venster. De oorspronkelijke instantie sluit dat tabblad en houdt de rest.
//
// Het bronvenster volgt de muis tot loslaten; een ander venster bevestigt
// via het tabkanaal dat het document is geopend.

import { bronPad } from '../../pdf/wachtwoord-pdf.js';

/** Hoe ver (CSS-px) de cursor boven of onder de tabbalk moet zijn. */
export const LOSMAAK_DREMPEL_PX = 60;

/**
 * Is de cursor verticaal ver genoeg buiten de tabbalk om als losmaken te tellen?
 * @param {number} clientY
 * @param {{top:number,bottom:number}|null} balk
 */
export function buitenTabbalk(clientY, balk, drempel = LOSMAAK_DREMPEL_PX) {
  if (!balk) return false;
  return clientY > balk.bottom + drempel || clientY < balk.top - drempel;
}

/** Ligt het punt buiten het eigen venster (viewport)? */
export function buitenVenster(clientX, clientY, breedte, hoogte) {
  return clientX < 0 || clientY < 0 || clientX >= breedte || clientY >= hoogte;
}

/** Ook bij twee vensters naast elkaar kan de cursor op tabbalkhoogte blijven. */
export function losmaakPositie(x, y, breedte, hoogte, balk, meerWeergaven) {
  const buiten = buitenVenster(x, y, breedte, hoogte);
  return { buiten, losGewapend: !meerWeergaven && (buiten || buitenTabbalk(y, balk)) };
}

/**
 * Wat er gebeurt als de muisknop loskomt zonder dat een OS-sleep liep.
 * @returns {'herschikken'|'losmaken'|'houden'}
 */
export function besluitBijLoslaten({ losGewapend, aantalTabs, buiten = false }) {
  if (!losGewapend) return 'herschikken';
  // Het enige tabblad naar een nieuwe instantie verhuizen laat hier een leeg
  // venster achter; dan gebeurt er niets.
  if (aantalTabs < 1 || (aantalTabs === 1 && !buiten)) return 'houden';
  return 'losmaken';
}

/**
 * Het bestand dat de nieuwe instantie opent: het echte bestand, nooit een
 * tijdelijke werkkopie (die ruimt het sluiten hier op).
 */
export function padVoorNieuweInstantie(doc) {
  if (!doc || doc.isUntitled) return null;
  return doc.saveTargetPath || bronPad(doc) || null;
}

/**
 * Waarom dit document niet losgemaakt kan worden, of null als het kan.
 * @returns {null|'eerst-opslaan'|'geen-document'}
 */
export function losmaakBlokkade(doc) {
  if (!doc) return 'geen-document';
  if (doc.isUntitled || !doc.filePath) return 'eerst-opslaan';
  return null;
}
