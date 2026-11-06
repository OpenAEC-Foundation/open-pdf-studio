// Delen / verzenden (#952, #953): de keuzes zonder DOM, Tauri of i18n, zodat
// ze in Node te testen zijn (delen-keuze.test.mjs). De uitvoering staat in
// delen.js.

import { voorgesteldeBestandsnaam } from './handtekeningen/opslaan.js';

/**
 * Langs welke weg het document de app uit gaat.
 *  - 'android'   : het deelvenster van Android (mail, Drive, berichten-apps)
 *  - 'mapi'      : Windows, het standaard-mailprogramma met de PDF als bijlage
 *  - 'xdg-email' : Linux, idem via xdg-email
 *  - 'tonen'     : macOS, het bestand in Finder tonen plus een mailconcept
 *  - 'web-share' : browser met Web Share voor bestanden
 *  - 'mailto'    : browser zonder Web Share: een mailconcept (zonder bijlage)
 * @param {{ tauri: boolean, os?: string|null, androidBrug?: boolean, webShare?: boolean }} o
 */
export function deelRoute({ tauri, os = null, androidBrug = false, webShare = false }) {
  if (tauri) {
    if (os === 'android') return androidBrug ? 'android' : 'tonen';
    if (os === 'windows') return 'mapi';
    if (os === 'linux') return 'xdg-email';
    return 'tonen';
  }
  return webShare ? 'web-share' : 'mailto';
}

/** Moet deze route een kopie van de bytes maken, ook van een ongewijzigd bestand? */
export function routeVraagtBytes(route) {
  // Android deelt alleen een bestand uit de eigen cachemap (MainActivity.kt);
  // de browser deelt bytes. De desktop hangt het bestand zelf aan.
  return route === 'android' || route === 'web-share';
}

/**
 * Wat er verstuurd wordt.
 *  - { soort: 'geen' }                    : geen document
 *  - { soort: 'vraag' }                   : niet-opgeslagen wijzigingen; eerst vragen
 *  - { soort: 'kopie' }                   : de huidige inhoud als tijdelijke kopie
 *  - { soort: 'bestand', pad }            : het bestand op schijf zoals het is
 * Een naamloos document (nieuw, samengevoegd, een scan) heeft geen eigen
 * bestand om te verzenden en gaat zonder vraag als kopie: er valt niets te
 * kiezen. Een ongewijzigd bestand gaat ongewijzigd, ook een ondertekend
 * bestand: opnieuw schrijven zou de handtekeningen ongeldig maken.
 * @param {object|null} doc
 */
export function deelBron(doc) {
  if (!doc?.pdfDoc) return { soort: 'geen' };
  const pad = doc.saveTargetPath || doc.filePath || null;
  if (doc.modified) return { soort: 'vraag' };
  if (doc.isUntitled || !pad) return { soort: 'kopie' };
  return { soort: 'bestand', pad };
}

/**
 * De knop uit de vraag bij niet-opgeslagen wijzigingen omgezet in een stap:
 * 'opslaan' (eerst opslaan, dan het bestand), 'kopie' (een kopie met de
 * wijzigingen, het bestand blijft zoals het is) of null (annuleren).
 * @param {string|null|undefined} keuze
 */
export function stapNaKeuze(keuze) {
  if (keuze === 'opslaan' || keuze === 'kopie') return keuze;
  return null;
}

/** Naam van de bijlage: de bestandsnaam, of de tabbladnaam bij een naamloos document. */
export function verzendNaam(doc) {
  const pad = doc?.isUntitled ? '' : (doc?.saveTargetPath || doc?.filePath || '');
  const uitPad = String(pad).split(/[\\/]/).pop();
  // Een content://-URI van Android heeft geen leesbare laatste component.
  const bruikbaar = uitPad && !/^content:/i.test(String(pad)) ? uitPad : '';
  return voorgesteldeBestandsnaam(bruikbaar || doc?.fileName || '');
}

/** Hoort deze fout bij "geen mailprogramma dat de bijlage aanneemt" (email.rs)? */
export function isGeenMailprogramma(fout) {
  return /OPDS_NO_MAIL_CLIENT/.test(String(fout?.message ?? fout ?? ''));
}
