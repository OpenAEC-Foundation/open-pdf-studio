// Fontnamen van tekstvakken en hun vervanging, zonder pdf-lib: de saver
// gebruikt ze voor /DA en de appearance, het eigenschappenpaneel om te melden
// welk lettertype een lezer zonder het gekozen lettertype toont (#765).

// Map CSS font family + bold/italic to PDF standard font name for DA string
export function mapFontToPdfName(fontFamily, bold, italic) {
  const f = (fontFamily || '').toLowerCase();

  // Map well-known CSS fonts to PDF standard 14 font names
  if (f.includes('courier') || f === 'mono' || f === 'monospace') {
    if (bold && italic) return 'Courier-BoldOblique';
    if (bold) return 'Courier-Bold';
    if (italic) return 'Courier-Oblique';
    return 'Courier';
  }
  if (f.includes('times') || (f.includes('serif') && !f.includes('sans'))) {
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }
  if (f === 'helvetica' || f === 'arial' || f === 'sans-serif') {
    if (bold && italic) return 'Helvetica-BoldOblique';
    if (bold) return 'Helvetica-Bold';
    if (italic) return 'Helvetica-Oblique';
    return 'Helvetica';
  }

  // For non-standard fonts, preserve the actual name as CamelCase (no spaces)
  // The loader's mapPdfFontName re-inserts spaces from CamelCase (e.g. "SegoeUI" → "Segoe UI")
  let baseName = (fontFamily || 'Helvetica').replace(/\s+/g, '');
  let suffix = '';
  if (bold && italic) suffix = '-BoldItalic';
  else if (bold) suffix = '-Bold';
  else if (italic) suffix = '-Italic';
  return baseName + suffix;
}

export const STANDAARD_FONTS = /^(Helvetica|Courier|Times|Symbol|ZapfDingbats)(-|$)/;
// De twaalf standaardfonts voor tekst, precies zo gespeld: alleen van deze
// namen heeft elke lezer de maten. 'Helvetica-Narrow' of 'Helvetica-Bold-Bold'
// hoort er niet bij.
const _TEKST_STANDAARDFONTS = /^(Helvetica(-Bold|-Oblique|-BoldOblique)?|Courier(-Bold|-Oblique|-BoldOblique)?|Times-(Roman|Bold|Italic|BoldItalic))$/;

/** Is `naam` precies een van de twaalf standaardfonts voor tekst? */
export function isTekstStandaardFont(naam) {
  return _TEKST_STANDAARDFONTS.test(naam);
}

// Soort van een niet-standaard tekstvakfont, uit de naam: bepaalt de vlaggen
// van zijn FontDescriptor en daarmee de letter waarmee een lezer hem vervangt.
export function tekstvakFontSoort(naam) {
  const vet = /-Bold/.test(naam);
  const cursief = /(Italic|Oblique)$/.test(naam);
  const familie = naam.replace(/-.*$/, '').toLowerCase();
  const mono = /mono|consol|courier|menlo|typewriter|code/.test(familie);
  const schreef = !mono && !/sans/.test(familie)
    && /serif|times|georgia|cambria|garamond|antiqua|palatino|bookman|baskerville|caslon|didot|bodoni|constantia|century|minion|rockwell|charter|cochin|sabon|plantin|perpetua|bell ?mt|book/.test(familie);
  return { vet, cursief, mono, schreef };
}

/**
 * De standaardfont waarmee een lezer zonder het font een tekstvakfont tekent:
 * een standaardfont zichzelf, anders die met de vlaggen van zijn
 * FontDescriptor (vaste breedte, schreef, vet, cursief). Het font is niet
 * ingebed en heeft geen /Widths, dus dit zijn de breedtes van een lezer die de
 * vlaggen volgt. Niet van elke lezer: pdf.js leest de breedtes op naam en neemt
 * Helvetica voor een onbekende (zie typemachineRegelBreedte).
 * @param {string} naam  PDF-fontnaam van mapFontToPdfName
 * @returns {string} naam van een van de 14 standaardfonts (pdf-lib StandardFonts)
 */
export function vervangendeStandaardFont(naam) {
  if (isTekstStandaardFont(naam)) return naam;
  // Een andere Helvetica-, Courier- of Times-naam valt op zijn familie terug.
  const { vet, cursief, mono, schreef } = tekstvakFontSoort(/^(Symbol|ZapfDingbats)(-|$)/.test(naam) ? '' : naam);
  if (mono) return `Courier${vet || cursief ? `-${vet ? 'Bold' : ''}${cursief ? 'Oblique' : ''}` : ''}`;
  if (schreef) return vet ? (cursief ? 'Times-BoldItalic' : 'Times-Bold') : (cursief ? 'Times-Italic' : 'Times-Roman');
  return `Helvetica${vet || cursief ? `-${vet ? 'Bold' : ''}${cursief ? 'Oblique' : ''}` : ''}`;
}
