// Testhulp: een canvas zonder browser, voor tests die de lader of de saver
// een tekstvak laten opmeten (computeTextboxContentHeight,
// layoutTextboxForExport).
//
// Breedtes zijn vast en herhaalbaar. "Swis721 Cn BT" geeft voor de teksten
// uit het titelblok van een extern bestand de breedtes die Chromium (de motor van
// WebView2) met de geïnstalleerde font meet; zonder die font (opties.swis =
// false) valt de keten terug op sans-serif. Alles wat niet in de tabel staat,
// en sans-serif zelf, meet met de Helvetica-breedtes van pdf-lib (Arial heeft
// dezelfde breedtes), zonder kerning.
//
// Geen *.test.mjs: dit bestand bevat zelf geen tests.

import { StandardFontEmbedder, StandardFonts } from 'pdf-lib';

/** Breedte op 14 px in "Swis721 Cn BT", gemeten in Chromium. */
const SWIS_14PX = {
  'M.D. ': 28.9639,
  'M.D.': 25.4775,
  Vroegindeweij: 74.375,
  'M.D. Vroegindeweij': 103.3389,
};

export const canvasOpties = { swis: true };

const helvetica = {
  normaal: StandardFontEmbedder.for(StandardFonts.Helvetica),
  vet: StandardFontEmbedder.for(StandardFonts.HelveticaBold),
};

function helveticaBreedte(tekst, grootte, vet) {
  const font = vet ? helvetica.vet : helvetica.normaal;
  let breedte = 0;
  for (const glyph of font.encodeTextAsGlyphs(tekst)) breedte += font.widthOfGlyph(glyph.name);
  return breedte * grootte / 1000;
}

function maakContext() {
  let grootte = 10;
  let familie = 'sans-serif';
  let vet = false;
  return {
    get font() { return `${vet ? 'bold ' : ''}${grootte}px ${familie}`; },
    set font(waarde) {
      const m = String(waarde).match(/(bold\s+)?(?:italic\s+)?(?:bold\s+)?([\d.]+)px\s+(.*)$/);
      if (!m) return;
      vet = /\bbold\b/.test(waarde);
      grootte = parseFloat(m[2]);
      familie = m[3];
    },
    measureText(tekst) {
      const eerste = familie.split(',')[0].trim().replace(/^"|"$/g, '');
      const swis = canvasOpties.swis && eerste === 'Swis721 Cn BT' && !vet;
      const breedte = swis && SWIS_14PX[tekst] !== undefined
        ? SWIS_14PX[tekst] * grootte / 14
        : helveticaBreedte(tekst, grootte, vet) * (swis ? 0.85 : 1);
      return { width: breedte, fontBoundingBoxAscent: grootte * 0.963, fontBoundingBoxDescent: grootte * 0.236 };
    },
  };
}

/** Zet document.createElement('canvas') neer (na installeerBrowserStubs). */
export function installeerCanvas() {
  globalThis.document.createElement = () => ({ getContext: () => maakContext() });
}
