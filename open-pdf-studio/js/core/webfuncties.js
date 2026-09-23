// Wat de webversie niet kan, en hoe de gebruiker dat te horen krijgt.
//
// De app draait ook als gewone webpagina (zonder Tauri-schil). Alles wat de
// Rust-kant doet — afdrukken, OCR, CAD in- en uitvoer, handtekeningen,
// comprimeren, PDF/X, IFC, bijlagen, plug-ins, de bijwerker en de MCP-brug —
// bestaat daar niet. Tot #456 bleven die knoppen gewoon klikbaar en deed er
// niets: invoke() gaf stil null terug. Nu gelden twee regels:
//
//  1. invoke() wijst af met een NietInBrowserError (zie platform.js).
//  2. Een knop zonder webvariant staat uit en draagt ÉÉN melding, hier
//     vastgelegd, zodat elke plek dezelfde zin toont.
//
// Deze module is met opzet vrij van DOM- en i18n-imports: de tabel en de
// beslisregel zijn los te testen, de melding haalt zijn afhankelijkheden pas
// op wanneer hij echt getoond wordt.

import { isNietInBrowser } from './platform.js';

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
  'tool-signature': 'signatures',
  'ribbon-extensions': 'plugins',
  'ribbon-check-updates': 'updater',
  'ribbon-previous-version': 'updater',
  'ribbon-file-assoc': 'fileAssociation',
  'ribbon-startup-diagnostics': 'diagnostics',
  'menu-print': 'print',
  'menu-extensions': 'plugins',
  'menu-annotate-screenshot': 'screenshot',
  'export-pdfx': 'pdfx',
  'export-cad': 'cadExport',
  'import-cad': 'cadImport',
  'panel-attachments': 'attachments',
  'prefs-mcp': 'mcp',
});

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
