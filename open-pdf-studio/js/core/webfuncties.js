// Wat de webversie niet kan, en hoe de gebruiker dat te horen krijgt.
//
// De app draait ook als gewone webpagina (zonder Tauri-schil). Wat de
// Rust-kant doet — afdrukken, OCR, CAD in- en uitvoer, comprimeren, PDF/X,
// IFC, plug-ins, de bijwerker en de MCP-brug — bestaat daar niet. Tot #456 bleven die knoppen gewoon klikbaar en deed er
// niets: invoke() gaf stil null terug. Nu gelden twee regels:
//
//  1. invoke() wijst af met een NietInBrowserError (zie platform.js).
//  2. Een knop zonder webvariant staat uit en draagt ÉÉN melding, hier
//     vastgelegd, zodat elke plek dezelfde zin toont.
//
// Als gast in de OpenAEC-site (#544) komt er een tweede tabel bij: diensten
// op een ándere host (feedback, de online symboolbibliotheek, de
// release-notes). Daar praat het gereedschap alleen met zijn eigen site,
// dus staan die knoppen uit, met dezelfde ene melding (#548).
//
// Deze module is met opzet vrij van DOM- en i18n-imports: de tabel en de
// beslisregel zijn los te testen, de melding haalt zijn afhankelijkheden pas
// op wanneer hij echt getoond wordt.

import { isNietInBrowser } from './platform.js';
import { isGehost } from './gehost.js';

/** Vertaalsleutel van de ene melding. Verwacht `{{feature}}`. */
export const MELDING_SLEUTEL = 'desktopOnly';

/**
 * Lintknop- of menu-id → naam van de functie zonder webvariant.
 * De id's zijn dezelfde als in de JSX; een tikfout valt hier op doordat de
 * knop in de browser gewoon aan blijft staan.
 */
export const BUREAUBLAD_KNOPPEN = Object.freeze({
  'ep-ocr': 'ocr',
  'ep-compress-pdf': 'compress',
  'btn-home-cad-export': 'cadExport',
  'btn-home-ifc-export': 'ifc',
  'ribbon-extensions': 'plugins',
  'ribbon-check-updates': 'updater',
  'ribbon-previous-version': 'updater',
  'ribbon-file-assoc': 'fileAssociation',
  'ribbon-startup-diagnostics': 'diagnostics',
  'menu-print': 'print',
  'menu-extensions': 'plugins',
  'export-pdfx': 'pdfx',
  'export-protect': 'protectPdf',
  'export-cad': 'cadExport',
  'import-cad': 'cadImport',
  'prefs-mcp': 'mcp',
});

// Bewust NIET in de tabel, want ze werken in de browser al:
//  - bijlagen: opslaan gaat via een download, toevoegen via <input type=file>
//  - het handtekening-gereedschap: tekenen en plaatsen is gewoon JS. Alleen
//    het CONTROLEREN van digitale handtekeningen loopt over de Rust-kant, en
//    die balk verschijnt in de browser simpelweg niet
//  - schermafdruk annoteren: valt terug op navigator.clipboard

/** Welke functie hangt achter deze knop? `null` = gewone knop. */
export function bureaubladFunctie(id) {
  if (!id) return null;
  return Object.prototype.hasOwnProperty.call(BUREAUBLAD_KNOPPEN, id)
    ? BUREAUBLAD_KNOPPEN[id]
    : null;
}

/**
 * Moet deze knop hier uit staan?
 *
 * @param {string|undefined} id  element-id van de knop
 * @param {boolean} inTauri      draait de app in de bureaubladschil?
 */
export function knopUitInBrowser(id, inTauri) {
  return !inTauri && bureaubladFunctie(id) !== null;
}

/**
 * Element-id → naam van een dienst op een andere host. Als gast staan deze
 * uit (#548); op het bureaublad en in de losse webversie (eigen oorsprong)
 * gewoon aan. Wie een nieuwe dienst op een andere host aanroept, zet zijn
 * knop hier en vraagt vóór het verzoek externeDienstenAan()
 * (webfuncties.test.mjs zoekt naar zulke verzoeken zonder die vraag).
 */
export const EXTERNE_DIENSTEN = Object.freeze({
  'send-feedback': 'feedback', // feedbackdienst
  'symbol-library-download': 'symbolLibrary', // GitHub: index en collecties
  'ribbon-whats-new': 'whatsNew', // GitHub: release-notes
  'menu-whats-new': 'whatsNew',
});

/** Welke dienst op een andere host hangt achter deze knop? `null` = geen. */
export function externeDienst(id) {
  if (!id) return null;
  return Object.prototype.hasOwnProperty.call(EXTERNE_DIENSTEN, id)
    ? EXTERNE_DIENSTEN[id]
    : null;
}

/** Mag de app hier andere hosts aanspreken? Als gast niet. */
export function externeDienstenAan(gehost = isGehost()) {
  return !gehost;
}

/**
 * Eén vraag voor elke knop: staat hij hier uit? Alleen-bureaublad in de
 * browser, of een dienst op een andere host als gast.
 */
export function knopUit(id, { inTauri, gehost = isGehost() } = {}) {
  return knopUitInBrowser(id, inTauri)
    || (!externeDienstenAan(gehost) && externeDienst(id) !== null);
}

/** De ene melding, met de naam die de gebruiker op de knop leest. */
export function meldingTekst(t, naam) {
  return t(MELDING_SLEUTEL, { feature: naam });
}

/** Toon de melding. Haalt i18next en de dialoog pas hier op. */
export async function meldAlleenBureaublad(naam) {
  const [i18n, dialogs] = await Promise.all([
    import('i18next'),
    import('../solid/stores/dialogStore.js'),
  ]);
  const t = (i18n.default || i18n).t;
  dialogs.showMessage(meldingTekst(t, naam));
}

/**
 * Vang een `invoke()` die in de browser niet kón. Geeft true als de fout
 * hiermee is afgehandeld; false betekent: een echte fout, laat hem door.
 */
export async function vangAlleenBureaublad(fout, naam) {
  if (!isNietInBrowser(fout)) return false;
  await meldAlleenBureaublad(naam);
  return true;
}
