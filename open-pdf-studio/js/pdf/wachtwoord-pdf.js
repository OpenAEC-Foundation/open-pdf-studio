// PDF's met een openingswachtwoord (gebruikerswachtwoord).
//
// PDF.js weigert zo'n bestand met een PasswordException. De app vraagt dan het
// wachtwoord; in de desktop-app maakt Rust (src-tauri/src/beveiligde_pdf.rs)
// een ontsleutelde werkkopie in een eigen tijdelijke map, en het document
// opent uit die kopie, zodat alle renderpaden die op PAD werken (PDFium, de
// worker-processen, tekst, miniaturen) gewoon werken. Het tabblad, de recente
// bestanden en het sessieherstel houden het ORIGINELE pad: na een herstart
// vraagt de app het wachtwoord opnieuw, de werkkopie komt nooit in de sessie.
//
// Documentbeveiliging (#378): Rust neemt bij het openen ook de beveiliging
// van het origineel over (`doc.beveiliging`, document-beveiliging.js). Is dat
// AES-256, dan is het document bewerkbaar en schrijft opslaan het terug met
// dezelfde wachtwoorden en rechten (naar het origineel, `saveTargetPath`).
// Een oudere methode (RC4, AES-128), of een browser zonder Rust, blijft
// alleen-lezen tot de gebruiker de beveiliging vervangt of verwijdert: de app
// schrijft een ontsleuteld document nooit stil onbeveiligd weg.
// Ook een bestand dat zonder wachtwoord opent maar rechten heeft, opent zo
// uit een werkkopie (`passwordProtected` blijft dan false).
//
// Puur: geen app-state, geen DOM. De loader, de saver, de tabbladen en de
// sessie gebruiken deze beslissingen; de unit-test toetst ze los.

import { kanBeveiligingSchrijven, beperktDoorRechten } from './document-beveiliging.js';

/** Foutcode van het Rust-commando bij een verkeerd wachtwoord. */
export const FOUT_VERKEERD_WACHTWOORD = 'WRONG_PASSWORD';

// pdf.js PasswordResponses
const PDFJS_WACHTWOORD_NODIG = 1;
const PDFJS_WACHTWOORD_ONJUIST = 2;

/** Weigerde PDF.js het bestand omdat er een wachtwoord nodig is? */
export function isWachtwoordFout(fout) {
  return !!fout && fout.name === 'PasswordException';
}

/** PDF.js kreeg een wachtwoord, maar het klopte niet. */
export function isOnjuistWachtwoordPdfjs(fout) {
  return isWachtwoordFout(fout) && fout.code === PDFJS_WACHTWOORD_ONJUIST;
}

/** PDF.js vraagt (voor het eerst) om een wachtwoord. */
export function isWachtwoordNodigPdfjs(fout) {
  return isWachtwoordFout(fout) && fout.code === PDFJS_WACHTWOORD_NODIG;
}

/**
 * Soort fout van het ontsleutelen. Het Rust-commando geeft een tekst terug
 * (invoke wijst af met een string); een Error mag ook.
 * @returns {'verkeerd-wachtwoord'|'geen-pdfium'|'mislukt'}
 */
export function soortOntsleutelFout(fout) {
  if (isOnjuistWachtwoordPdfjs(fout)) return 'verkeerd-wachtwoord';
  const tekst = String((fout && typeof fout === 'object' ? fout.message : fout) ?? '').trim();
  if (tekst === FOUT_VERKEERD_WACHTWOORD || tekst.startsWith(`${FOUT_VERKEERD_WACHTWOORD}:`)) return 'verkeerd-wachtwoord';
  if (tekst.startsWith('PDFIUM_UNAVAILABLE')) return 'geen-pdfium';
  return 'mislukt';
}

/** Is dit document met een wachtwoord geopend? */
export function isBeveiligdDocument(doc) {
  return !!doc && doc.passwordProtected === true;
}

/**
 * Door de gastsite alleen-lezen geopend (de werkplek, #704: `alleen_lezen` in
 * het antwoord op open, bv. omdat iemand anders het bestand vastheeft).
 */
export function isHostAlleenLezen(doc) {
  return !!doc && doc.hostAlleenLezen === true;
}

/**
 * Alleen-lezen: een beveiligd document dat niet beveiligd terug te schrijven
 * is of waarvan de rechten geen bewerking toestaan, door de gastsite
 * alleen-lezen geopend, of PDF/A zolang de gebruiker bewerken niet heeft
 * ingeschakeld.
 */
export function isAlleenLezen(doc) {
  if (!doc) return false;
  if (opslaanGeweigerd(doc) || beperktDoorRechten(doc)) return true;
  if (isHostAlleenLezen(doc)) return true;
  return !!doc.pdfaCompliance && !doc.pdfADismissed;
}

/**
 * Mag dit document niet opgeslagen worden? Alleen als opslaan de beveiliging
 * niet kan behouden: een met een wachtwoord geopend document zonder
 * beveiligingssessie (browser, onleesbare beveiliging) of met een oudere
 * methode die nog niet vervangen is. (PDF/A mag wel.)
 */
export function opslaanGeweigerd(doc) {
  if (!doc) return false;
  if (doc.beveiliging) return !kanBeveiligingSchrijven(doc);
  return isBeveiligdDocument(doc);
}

/**
 * Staat er ontsleutelde inhoud van een beveiligd bestand in dit document? Dan
 * geen herstelmomentopnamen en geen onbeveiligde afgeleide bestanden
 * (splitsen). Na het opslaan zonder beveiliging niet meer.
 */
export function heeftBeveiligdeInhoud(doc) {
  return isBeveiligdDocument(doc) || !!doc?.beveiliging;
}

/**
 * Het pad dat de gebruiker ziet en dat de app onthoudt: het origineel, ook als
 * het document uit een ontsleutelde werkkopie rendert.
 */
export function bronPad(doc) {
  if (!doc) return null;
  return doc.originalFilePath || doc.filePath || null;
}

/** Hoort dit document bij dit pad (werkkopie of origineel)? */
export function hoortBijPad(doc, pad) {
  if (!doc || !pad) return false;
  return doc.filePath === pad || (!!doc.originalFilePath && doc.originalFilePath === pad);
}

/**
 * De bestanden voor het sessieherstel: originele paden, nooit een werkkopie,
 * geen naamloze documenten (die staan in een tijdelijk bestand).
 */
export function sessieBestanden(documenten) {
  return (documenten || [])
    .filter((d) => d && !d.isUntitled && bronPad(d))
    .map((d) => bronPad(d));
}

/**
 * Vraagt het wachtwoord tot het klopt of de gebruiker annuleert.
 *  - `vraag({ verkeerd })` geeft het wachtwoord, of null bij Annuleren;
 *    `verkeerd` is true als de vorige poging niet klopte.
 *  - `ontsleutel(wachtwoord)` geeft het resultaat, of gooit een fout; een
 *    verkeerd wachtwoord (soortOntsleutelFout) leidt tot een nieuwe vraag,
 *    elke andere fout gaat door naar de aanroeper.
 * @returns {Promise<any|null>} het resultaat van ontsleutel, of null
 */
export async function vraagEnOntsleutel({ vraag, ontsleutel }) {
  let verkeerd = false;
  for (;;) {
    const wachtwoord = await vraag({ verkeerd });
    if (wachtwoord === null || wachtwoord === undefined) return null;
    try {
      return await ontsleutel(wachtwoord);
    } catch (fout) {
      if (soortOntsleutelFout(fout) !== 'verkeerd-wachtwoord') throw fout;
      verkeerd = true;
    }
  }
}

/**
 * Zet het document als beveiligd geopend, met zijn originele pad.
 *  - `gevraagd`: er werd om een wachtwoord gevraagd (na een herstart opnieuw).
 *  - `beveiliging`: doc.beveiliging (document-beveiliging.js). Dan schrijft
 *    opslaan naar het origineel, niet naar de ontsleutelde werkkopie.
 */
export function markeerBeveiligd(doc, origineelPad, { gevraagd = true, beveiliging = null } = {}) {
  doc.passwordProtected = gevraagd;
  doc.originalFilePath = origineelPad || null;
  if (beveiliging) {
    doc.beveiliging = beveiliging;
    if (origineelPad) doc.saveTargetPath = origineelPad;
  }
}

/** Rendert dit document uit een ontsleutelde werkkopie? */
export function heeftWerkkopie(doc) {
  return !!doc?.originalFilePath && !!doc.filePath && doc.filePath !== doc.originalFilePath;
}
