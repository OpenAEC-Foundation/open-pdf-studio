// Uitleg over een waarschuwing van een virusscanner (#761): een virusscanner
// geeft bij een nieuwe versie van een klein opensourceprogramma soms een
// waarschuwing over het installatieprogramma of de app. De uitleg vraagt de
// waarschuwing naar ons te sturen, zodat wij haar bij de maker van de scanner
// kunnen melden.
//
// Waar hij staat: één keer als blok bovenaan de release-notes ("Wat is
// nieuw"), de eerste keer dat dat venster opent. Niet in de webversie: daar is
// geen installatieprogramma. Later blijft hij te openen via Help en het
// app-menu.
//
// De beslisregel is een pure functie; de opslag gaat via core/opslag.js.

import { leesOpslag, schrijfOpslag } from '../core/opslag.js';
import { isGehost } from '../core/gehost.js';

/** Naam in de opslag (core/opslag.js zet het voorvoegsel ervoor). */
export const OPSLAG_NAAM = 'virusscannerMelding';
/** De uitleg heeft al eens in de release-notes gestaan. */
export const GEZIEN = 'gezien';
/** Naam van het losse venster in de DialogHost (Help, app-menu). */
export const DIALOOG = 'virus-scanner-notice';

/**
 * Hoort de uitleg nu in de release-notes?
 * @param {{inTauri:boolean, gehost?:boolean, opgeslagen:string|null}} o
 */
export function hoortInReleasenotes({ inTauri, gehost = false, opgeslagen }) {
  if (!inTauri || gehost) return false;
  return opgeslagen !== GEZIEN;
}

/**
 * Vraag bij het openen van de release-notes of de uitleg erbij hoort, en leg
 * meteen vast dat hij er gestaan heeft: de volgende keer komt hij niet meer.
 * @returns {boolean}
 */
export function neemInReleasenotes({ inTauri, gehost = isGehost(), lees = leesOpslag, schrijf = schrijfOpslag }) {
  if (!hoortInReleasenotes({ inTauri, gehost, opgeslagen: lees(OPSLAG_NAAM) })) return false;
  try { schrijf(OPSLAG_NAAM, GEZIEN); } catch { /* opslag vol: de uitleg komt dan nog een keer */ }
  return true;
}

/** Open de uitleg als los venster (Help en het app-menu). */
export async function openVirusscannerMelding() {
  const { openDialog } = await import('../solid/stores/dialogStore.js');
  openDialog(DIALOOG);
}

/**
 * Wat het feedbackvenster vooraf invult als de gebruiker een waarschuwing wil
 * melden: het onderwerp en de drie gegevens die wij nodig hebben.
 * @param {(sleutel:string)=>string} t  vertaalfunctie van de naamruimte `dialogs`
 */
export function feedbackVoorinvulling(t) {
  return {
    category: 'general',
    message: [
      t('virusNotice.feedbackSubject'),
      '',
      `${t('virusNotice.feedbackScanner')}: `,
      `${t('virusNotice.feedbackDetection')}: `,
      `${t('virusNotice.feedbackFile')}: `,
      '',
    ].join('\n'),
    hint: t('virusNotice.feedbackHint'),
  };
}
