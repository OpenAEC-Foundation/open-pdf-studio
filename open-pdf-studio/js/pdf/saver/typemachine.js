// Het vak van een typemachine-tekst (noWrap, /IT /FreeTextTypewriter) bij
// opslaan.
//
// Een typemachine-tekst breekt niet af (een waarneming aan zulke bestanden,
// geen regel uit de PDF-specificatie): elke harde regel staat op één regel,
// ook als hij breder is dan het vak. In de app is dat geen probleem (het
// canvas knipt hem niet), maar de appearance die de saver schrijft knipt op
// het vak, en de font is niet ingebed en heeft geen /Widths: een andere lezer
// tekent de tekst met de breedtes van een standaardfont, gekozen uit de vlaggen
// van de FontDescriptor (zie vervangendeStandaardFont) of, zoals pdf.js, uit
// de naam (Helvetica). Het opgeslagen vak moet daarom minstens zo breed zijn
// als de breedste regel in die breedtes én in de meting van de app.

import { StandardFontEmbedder } from 'pdf-lib';
import { isTekstStandaardFont, mapFontToPdfName, vervangendeStandaardFont } from './utils.js';

const _embedders = new Map();

/**
 * Breedte van tekst in de standaardfont die een lezer die de vlaggen volgt voor
 * `pdfFontNaam` gebruikt (vervangendeStandaardFont): de som van de
 * glyphbreedtes, zonder kerning (een lezer kernt een Tj-string niet). Tekens
 * buiten WinAnsi tellen als een spatie.
 */
export function breedteInStandaardFont(tekst, pdfFontNaam, grootte) {
  const naam = vervangendeStandaardFont(pdfFontNaam);
  let font = _embedders.get(naam);
  if (!font) {
    // Vangnet: een naam zonder maten in pdf-lib mag het opslaan niet breken.
    try { font = StandardFontEmbedder.for(naam); } catch { font = StandardFontEmbedder.for('Helvetica'); }
    _embedders.set(naam, font);
  }
  let breedte = 0;
  for (const teken of String(tekst ?? '')) {
    let glyphs;
    try { glyphs = font.encodeTextAsGlyphs(teken); } catch { glyphs = font.encodeTextAsGlyphs(' '); }
    for (const g of glyphs) breedte += font.widthOfGlyph(g.name);
  }
  return breedte * grootte / 1000;
}

/**
 * Breedte van één regel van een typemachine-tekst zoals het vak hem moet
 * bevatten: de meting van de app of, als die smaller is, de breedte in de
 * standaardfont waarmee een andere lezer hem tekent. Het vak wordt met deze
 * breedte gemaakt, en de appearance zet een gecentreerde of rechts uitgelijnde
 * regel met dezelfde breedte neer; anders loopt hij in de vervangende font
 * buiten het vak.
 *
 * @param {object} ann  het tekstvlak
 * @param {{width:number, chunks?: Array<{text,bold,italic}>, text?: string}} ln
 *   een regel van layoutTextboxForExport
 */
export function typemachineRegelBreedte(ann, ln) {
  const grootte = ann.fontSize || 14;
  const chunks = ln.chunks?.length ? ln.chunks : [{ text: ln.text || '', bold: !!ann.fontBold, italic: !!ann.fontItalic }];
  const standaard = chunks.reduce((w, c) => {
    const pdfNaam = mapFontToPdfName(ann.fontFamily, c.bold, c.italic);
    const volgensVlaggen = breedteInStandaardFont(c.text, pdfNaam, grootte);
    // pdf.js negeert zonder /Widths de vlaggen van de FontDescriptor en leest
    // de breedtes op naam: een onbekende naam wordt Helvetica (een schreefnaam
    // Times, en die is smaller).
    const opNaam = isTekstStandaardFont(pdfNaam) ? 0 : breedteInStandaardFont(c.text, 'Helvetica', grootte);
    return w + Math.max(volgensVlaggen, opNaam);
  }, 0);
  return Math.max(ln.width || 0, standaard);
}

/**
 * Het vak van een typemachine-tekst zoals de saver het wegschrijft.
 *
 * @param {object} ann     het tekstvlak in weergaveruimte
 * @param {{lines: Array<{width:number, chunks?: Array<{text,bold,italic}>, text?: string}>,
 *          padding: number}} layout  uitvoer van layoutTextboxForExport voor dit vak
 * @returns {object} `ann` zelf als het vak breed genoeg is (of geen
 *   typemachine-tekst), anders een kopie met de nodige breedte. Het vak groeit
 *   langs de tekstrichting; de kant waar de tekst begint (de uitlijning) blijft
 *   staan.
 */
export function typemachineVak(ann, layout) {
  if (!ann || ann.type !== 'textbox' || !ann.noWrap) return ann;
  let regel = 0;
  for (const ln of layout?.lines || []) regel = Math.max(regel, typemachineRegelBreedte(ann, ln));
  const nodig = regel + 2 * (layout?.padding || 0);
  const breedte = ann.width || 150;
  if (!(nodig > breedte)) return ann;

  // Het midden schuift langs de tekstrichting (canvashoek, met de klok mee).
  const groei = nodig - breedte;
  const uitlijning = ann.textAlign || 'left';
  const schuif = uitlijning === 'center' ? 0 : (uitlijning === 'right' ? -groei / 2 : groei / 2);
  const hoek = (ann.rotation || 0) * Math.PI / 180;
  return {
    ...ann,
    x: ann.x - groei / 2 + schuif * Math.cos(hoek),
    y: ann.y + schuif * Math.sin(hoek),
    width: nodig,
  };
}
