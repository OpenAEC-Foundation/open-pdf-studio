// De pure regels van de wachtwoorden in de beveiligingsdialoog
// (ProtectPdfDialog.jsx, #378): geen state, geen DOM, zodat ze met node:test
// te toetsen zijn. De rest van de beveiliging: document-beveiliging.js.

/** Kortste wachtwoord dat de dialoog accepteert, in tekens. */
export const MIN_LENGTE = 6;

/** Langste wachtwoord dat de PDF-norm (revisie 6) gebruikt, in UTF-8-bytes. */
export const MAX_WACHTWOORD_BYTES = 127;

/** Wat een ontvanger mag; alles aan = geen beperkingen. */
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

// RFC 3454 C.1.2 (spaties anders dan de gewone spatie) en B.1 ("commonly
// mapped to nothing"): de toewijzingsstap van SASLprep, dezelfde tabellen als
// de Rust-kant (stringprep::tables) en pdf.js gebruiken.
const BIJZONDERE_SPATIES = /[   -​  　]/g;
const ONZICHTBAAR = /[­͏᠆᠋-᠍​-‍⁠︀-️﻿]/g;
// Stuurtekens (C0, DEL, C1): verschillen per lezer en zijn niet te typen.
const STUURTEKENS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Het wachtwoord zoals PDF 2.0 het voorbereidt (en de Rust-kant bij het
 * schrijven): bijzondere spaties worden een gewone spatie, onzichtbare tekens
 * vervallen, daarna NFKC.
 * @param {string} w
 */
export function bereidWachtwoordVoor(w) {
  return String(w ?? '')
    .replace(BIJZONDERE_SPATIES, ' ')
    .replace(ONZICHTBAAR, '')
    .normalize('NFKC');
}

/** Lengte in UTF-8-bytes. */
export function wachtwoordBytes(w) {
  return new TextEncoder().encode(String(w ?? '')).length;
}

/**
 * Werkt dit wachtwoord in elke lezer precies zoals getypt? PDFium (ook de app
 * zelf bij openen) en andere lezers bereiden een wachtwoord niet voor en
 * kappen niet af; wat de voorbereiding verandert of langer is dan 127 bytes
 * zou daar dus niet meer openen.
 * @returns {null|'protectPdf.tooLong'|'protectPdf.notPortable'}
 */
function draagbaarheidsProbleem(w) {
  if (!w) return null;
  if (wachtwoordBytes(w) > MAX_WACHTWOORD_BYTES) return 'protectPdf.tooLong';
  if (STUURTEKENS.test(w) || bereidWachtwoordVoor(w) !== w) return 'protectPdf.notPortable';
  return null;
}

/**
 * Controleert de invoer van de dialoog. Geeft de i18n-sleutel (namespace
 * dialogs) van het eerste probleem, of null als de invoer bruikbaar is.
 * @param {{ gebruiker: string, gebruikerHerhaald: string, eigenaar: string, eigenaarHerhaald: string }} v
 */
export function controleerWachtwoorden({ gebruiker, gebruikerHerhaald, eigenaar, eigenaarHerhaald }) {
  if (!gebruiker && !eigenaar) return 'protectPdf.needPassword';
  // Een kort wachtwoord is snel te raden, ook bij AES-256.
  if ((gebruiker && [...gebruiker].length < MIN_LENGTE) || (eigenaar && [...eigenaar].length < MIN_LENGTE)) {
    return 'protectPdf.tooShort';
  }
  const probleem = draagbaarheidsProbleem(gebruiker) || draagbaarheidsProbleem(eigenaar);
  if (probleem) return probleem;
  if (gebruiker !== gebruikerHerhaald) return 'protectPdf.userMismatch';
  if (eigenaar !== eigenaarHerhaald) return 'protectPdf.ownerMismatch';
  if (gebruiker && eigenaar && gebruiker === eigenaar) return 'protectPdf.samePassword';
  return null;
}

// Vaste foutcodes van de beveiligingscommando's (open-pdf-security) en
// hun melding (namespace dialogs). `detail` = de toelichting na ": ".
const FOUTCODES = {
  NEED_PASSWORD: { sleutel: 'protectPdf.needPassword' },
  ALREADY_ENCRYPTED: { sleutel: 'protectPdf.errorEncrypted' },
  INCOMPLETE: { sleutel: 'protectPdf.errorIncomplete' },
  READ_FAILED: { sleutel: 'protectPdf.errorRead', detail: true },
  WRITE_FAILED: { sleutel: 'protectPdf.errorWrite', detail: true },
};

/**
 * De melding bij een fout van het Rust-commando: een vertaalsleutel met
 * opties. Een onbekende fout komt met zijn tekst in `protectPdf.failed`.
 * @param {unknown} fout  de afwijzing van invoke (tekst of Error)
 * @returns {{ sleutel: string, opties: Record<string, string> }}
 */
export function foutMelding(fout) {
  const tekst = String((fout && typeof fout === 'object' ? fout.message : fout) ?? '').trim();
  const m = /^([A-Z_]+)(?::\s*([\s\S]*))?$/.exec(tekst);
  const bekend = m && Object.prototype.hasOwnProperty.call(FOUTCODES, m[1]) ? FOUTCODES[m[1]] : null;
  if (!bekend) return { sleutel: 'protectPdf.failed', opties: { error: tekst } };
  return { sleutel: bekend.sleutel, opties: bekend.detail ? { detail: m[2] ?? '' } : {} };
}
