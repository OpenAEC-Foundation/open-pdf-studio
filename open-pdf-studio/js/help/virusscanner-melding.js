// Eenmalige melding voor nieuwe gebruikers (#761): een virusscanner geeft bij
// een nieuwe versie van een klein opensourceprogramma soms een waarschuwing
// over het installatieprogramma of de app. De melding legt dat rustig uit en
// vraagt de waarschuwing naar ons te sturen, zodat wij haar bij de maker van
// de scanner kunnen melden.
//
// Wanneer hij verschijnt: één keer, bij de eerste start van een nieuwe
// installatie. Dus niet na een update, niet bij wie al voorkeuren had, niet
// in de beheerde modus (core/beheerd.js), niet in een headless testinstantie
// of een instantie die voor automatisering is gestart (startvlag
// --mcp-server), en niet in de webversie: daar is geen installatieprogramma.
// Later blijft hij te openen via Help en het app-menu.
//
// Twee stappen, zodat ook wie de app bij de eerste start meteen weer sluit de
// melding de keer daarna nog krijgt:
//  1. registreerStart(), direct na het laden van de voorkeuren: stonden er
//     geen voorkeuren, dan is dit een nieuwe installatie ('nieuw'); anders is
//     de gebruiker er al ('gezien'). Dat staat vanaf dan in de opslag.
//  2. toonBijEersteStart(), even na de start: bij 'nieuw' de melding tonen en
//     'gezien' wegschrijven.
//
// De beslisregels zijn pure functies; de opslag gaat via core/opslag.js.

import { leesOpslag, schrijfOpslag } from '../core/opslag.js';
import { magMelden } from '../core/beheerd.js';
import { isHeadless } from '../core/headless.js';
import { isGehost } from '../core/gehost.js';

/** Naam in de opslag (core/opslag.js zet het voorvoegsel ervoor). */
export const OPSLAG_NAAM = 'virusscannerMelding';
/** Nieuwe installatie: de melding moet nog komen. */
export const NIEUW = 'nieuw';
/** De melding is getoond, of de gebruiker was er al vóór deze melding bestond. */
export const GEZIEN = 'gezien';
/** Naam van het venster in de DialogHost. */
export const DIALOOG = 'virus-scanner-notice';

/**
 * Welke status hoort er na deze start in de opslag?
 * Een bekende status blijft; anders beslist of er al voorkeuren stonden.
 * Niet te zeggen (laden mislukt, `null`) telt als bestaande gebruiker: liever
 * geen melding dan een melding bij iemand die de app al jaren gebruikt.
 * @param {{opgeslagen:string|null, voorkeurenBestonden:boolean|null}} o
 */
export function statusNaStart({ opgeslagen, voorkeurenBestonden }) {
  if (opgeslagen === NIEUW || opgeslagen === GEZIEN) return opgeslagen;
  return voorkeurenBestonden === false ? NIEUW : GEZIEN;
}

/**
 * Stap 1: leg vast of dit een nieuwe installatie is. In de webversie gebeurt
 * er niets (geen installatieprogramma, en als gast is de opslag gedeeld).
 * @returns {string|null} de status, of null in de webversie
 */
export function registreerStart({ inTauri, voorkeurenBestonden, lees = leesOpslag, schrijf = schrijfOpslag }) {
  if (!inTauri) return null;
  const opgeslagen = lees(OPSLAG_NAAM);
  const status = statusNaStart({ opgeslagen, voorkeurenBestonden });
  if (status !== opgeslagen) {
    try { schrijf(OPSLAG_NAAM, status); } catch { /* opslag vol: de volgende start beslist opnieuw */ }
  }
  return status;
}

/**
 * Is deze instantie voor automatisering gestart? De status van de
 * AI-koppeling (`mcp_status`) noemt de bron: 'startvlag' (--mcp-server) en
 * 'omgeving' (een beheerde omgeving) zijn automatisering; 'instelling' is een
 * gewone gebruiker die de koppeling zelf aanzette.
 */
export function isAutomatisering(mcpStatus) {
  return mcpStatus?.bron === 'startvlag' || mcpStatus?.bron === 'omgeving';
}

/**
 * Stap 2, de beslisregel: mag de melding nu vanzelf verschijnen?
 * @returns {{tonen:boolean, reden:string}}
 */
export function meldingBeleid({
  status, inTauri, gehost = false, mobiel = false, headless = false,
  automatisering = false, beheerdToegestaan = true, tweedeInstantie = false,
}) {
  const nee = (reden) => ({ tonen: false, reden });
  if (!inTauri || gehost) return nee('webversie');
  if (mobiel) return nee('mobiel');
  if (headless) return nee('headless');
  if (automatisering) return nee('automatisering');
  if (!beheerdToegestaan) return nee('beheerd');
  if (tweedeInstantie) return nee('tweede-instantie');
  if (status !== NIEUW) return nee('geen-nieuwe-installatie');
  return { tonen: true, reden: 'eerste-start' };
}

/**
 * Stap 2: toon de melding als dit de eerste start van een nieuwe installatie
 * is. Elke afhankelijkheid is in te vullen, zodat de tests zonder app draaien.
 * @returns {Promise<{tonen:boolean, reden:string}>}
 */
export async function toonBijEersteStart(o = {}) {
  // Beheerde modus (OPENAEC_BEHEERD=1): geen eenmalige meldingen bij de start.
  const beheerdToegestaan = await magMelden('virusscanner-melding');
  const lees = o.lees || leesOpslag;
  const schrijf = o.schrijf || schrijfOpslag;
  const beleid = meldingBeleid({
    status: lees(OPSLAG_NAAM),
    inTauri: !!o.inTauri,
    gehost: o.gehost ?? isGehost(),
    mobiel: !!o.mobiel,
    headless: o.headless ?? isHeadless(),
    automatisering: isAutomatisering(o.mcpStatus ? await o.mcpStatus() : null),
    beheerdToegestaan,
    tweedeInstantie: !!o.tweedeInstantie,
  });
  if (!beleid.tonen) return beleid;
  // Eerst wegschrijven, dan tonen: ook na een onverwachte afsluiting komt de
  // melding niet nog eens.
  try { schrijf(OPSLAG_NAAM, GEZIEN); } catch { /* opslag vol: de melding komt dan nog een keer */ }
  await (o.open || openVirusscannerMelding)();
  return beleid;
}

/** Open de melding (Help, het app-menu, en de eerste start). */
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
