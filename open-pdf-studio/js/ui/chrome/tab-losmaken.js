// Beslisregels voor het losmaken van een tabblad (zuiver, zonder DOM of IPC).
//
// Een tabblad dat voorbij de drempel uit de tabbalk gesleept en losgelaten
// wordt, opent in een TWEEDE app-instantie: een eigen proces met een eigen
// venster. De oorspronkelijke instantie sluit dat tabblad en houdt de rest.
//
// De sleepbeweging zelf blijft in de WebView: tijdens een ingedrukte knop
// levert die muisgebeurtenissen ook buiten het venster. Een native OS-sleep
// (DoDragDrop) start alleen nog als de cursor boven een ANDERE instantie van
// de app hangt, om het tabblad daar terug te zetten. Daarbuiten nooit: die
// modale OS-lus nam het hele proces mee als hij niet netjes afliep, en meldt
// op Windows ook "Dropped" als het venster onder de cursor niets aannam —
// het tabblad sloot dan zonder ergens anders te openen.

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

/**
 * Wat er gebeurt als de muisknop loskomt zonder dat een OS-sleep liep.
 * @returns {'herschikken'|'losmaken'|'houden'}
 */
export function besluitBijLoslaten({ losGewapend, aantalTabs }) {
  if (!losGewapend) return 'herschikken';
  // Het enige tabblad naar een nieuwe instantie verhuizen laat hier een leeg
  // venster achter; dan gebeurt er niets.
  if (!(aantalTabs > 1)) return 'houden';
  return 'losmaken';
}

/**
 * Moet de native OS-sleep nu starten? Alleen boven een andere instantie van
 * dezelfde app, zodat die het tabblad kan overnemen.
 */
export function moetOsSleepStarten({ losGewapend, buitenVenster: buiten, doelSoort }) {
  return !!losGewapend && !!buiten && doelSoort === 'instantie';
}

/**
 * Wat er na afloop van de OS-sleep gebeurt. `doelSoort` is wat er NA het
 * loslaten onder de cursor ligt ('instantie' | 'zelf' | 'geen').
 * @returns {'sluiten'|'losmaken'|'houden'}
 */
export function besluitNaOsSleep({ resultaat, doelSoort, zelfDrop }) {
  if (zelfDrop) return 'houden';
  // Escape of afgebroken: niets veranderen.
  if (resultaat !== 'Dropped') return 'houden';
  if (doelSoort === 'instantie') return 'sluiten';
  if (doelSoort === 'zelf') return 'houden';
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
