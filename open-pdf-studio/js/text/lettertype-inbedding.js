// Welk lettertype komt er echt in het PDF-bestand (#765)?
//
// De app bedt geen systeemlettertypen in. Een tekstvak of callout bewaart het
// gekozen lettertype op naam (/DA, /DS, een FontDescriptor zonder fontbestand):
// de app zelf en een lezer die het lettertype heeft, tonen het; een lezer
// zonder dat lettertype tekent een standaardletter (Helvetica, Times of
// Courier). Tekst die in de pagina zelf komt (PDF-tekst bewerken, "Tekst
// toevoegen") wordt altijd in een van die drie standaardletters geschreven.
// Eerder gebeurde dat zonder enig bericht: een gekozen lettertype werd stil
// Helvetica, wat er op het scherm als Arial uitziet.
//
// Pure module: het eigenschappenpaneel en de dialoog "Tekst toevoegen"
// gebruiken haar voor een melding onder de lettertypekeuze.

import { mapFontToPdfName, vervangendeStandaardFont } from '../pdf/saver/tekstvak-fontnaam.js';
import { toStandardFontName } from './text-edit-appearance.js';

// Lettertypen die zelf een standaardletter zijn (of er de gewone naam van op
// het scherm zijn): daarvoor is er niets te melden.
const STANDAARD_FAMILIES = /^(arial|helvetica|times|times new roman|times-roman|courier|courier new|sans-serif|serif|monospace)$/;

function familieVanPdfNaam(naam) {
  if (/^Courier/.test(naam)) return 'Courier';
  if (/^Times/.test(naam)) return 'Times';
  return 'Helvetica';
}

/** Is dit lettertype zelf een standaardletter (Helvetica/Arial, Times, Courier)? */
export function isStandaardFamilie(fontFamily) {
  const f = String(fontFamily ?? '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  return f === '' || STANDAARD_FAMILIES.test(f);
}

/**
 * De standaardletter waarmee het lettertype in het bestand terechtkomt.
 * @param {string} fontFamily  zoals in het paneel gekozen
 * @param {'tekstvak'|'paginatekst'} soort  tekstvak/callout, of tekst in de pagina
 * @returns {'Helvetica'|'Times'|'Courier'}
 */
export function standaardLetterVoor(fontFamily, soort = 'tekstvak') {
  if (soort === 'paginatekst') return familieVanPdfNaam(toStandardFontName(fontFamily, false, false));
  return familieVanPdfNaam(vervangendeStandaardFont(mapFontToPdfName(fontFamily, false, false)));
}

/**
 * De melding bij een gekozen lettertype, of null als er niets te melden is.
 * - 'tekstvak': het lettertype gaat op naam mee, maar wordt niet ingebed.
 * - 'paginatekst': de tekst wordt in de standaardletter geschreven.
 * @returns {null | { sleutel: string, font: string, fallback: string }}
 */
export function lettertypeMelding(fontFamily, soort = 'tekstvak') {
  if (!fontFamily || fontFamily === 'mixed' || isStandaardFamilie(fontFamily)) return null;
  return {
    sleutel: soort === 'paginatekst' ? 'textFormat.fontReplaced' : 'textFormat.fontNotEmbedded',
    font: String(fontFamily),
    fallback: standaardLetterVoor(fontFamily, soort),
  };
}
