// Mengmodi (blend modes) op één plek (#614): de naam in het model, de naam in
// een PDF (/BM in een ExtGState, en vanaf PDF 2.0 ook op de annotatie zelf) en
// de waarde voor canvas (globalCompositeOperation).

/** De modi die het model kent, met hun PDF-naam. De volgorde is die van het menu. */
const MODI = Object.freeze({
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  colorDodge: 'ColorDodge',
  colorBurn: 'ColorBurn',
  hardLight: 'HardLight',
  softLight: 'SoftLight',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
});

/** Canvas schrijft de samengestelde namen met een streepje. Een onbekende
 *  waarde voor globalCompositeOperation is géén fout: de vorige waarde blijft
 *  dan gewoon staan, dus zonder deze tabel deden deze vier modi stilletjes
 *  niets. */
const CANVAS = Object.freeze({
  colorDodge: 'color-dodge',
  colorBurn: 'color-burn',
  hardLight: 'hard-light',
  softLight: 'soft-light',
});

/** Alle zestien modi, in menuvolgorde. */
export const BLEND_MODES = Object.freeze(Object.keys(MODI));

/** Kent het model deze modus? */
export function isBlendMode(mode) {
  return typeof mode === 'string' && Object.prototype.hasOwnProperty.call(MODI, mode);
}

export function effectiveBlendMode(annotation) {
  const highlight = annotation.type === 'textHighlight' || annotation.type === 'highlight';
  return annotation.blendMode || (highlight ? 'multiply' : 'normal');
}

/** Mengt deze modus anders dan gewoon erover tekenen? */
export function isGemengd(mode) {
  return isBlendMode(mode) && mode !== 'normal';
}

/** De PDF-naam (zonder '/'), of null voor normaal of onbekend: normaal zeg je
 *  in een PDF door géén /BM te schrijven. */
export function blendPdfNaam(mode) {
  return isGemengd(mode) ? MODI[mode] : null;
}

/** De modus uit een PDF-naam (met of zonder '/', hoofdletters maken niet uit),
 *  of de meegegeven terugval voor Normal en Compatible, en null voor onbekend.
 *  Een /BM-array (PDF 1.4) telt met zijn eerste bekende naam. */
export function blendUitPdf(naam, normaal = null) {
  if (Array.isArray(naam)) {
    for (const n of naam) {
      const kaal = String(n ?? '').replace(/^\//, '').toLowerCase();
      if (kaal === 'normal' || kaal === 'compatible') return normaal;
      const m = blendUitPdf(n);
      if (m) return m;
    }
    return null;
  }
  if (naam == null) return null;
  const kaal = String(naam).replace(/^\//, '').toLowerCase();
  if (kaal === 'normal' || kaal === 'compatible') return normaal;
  const gevonden = BLEND_MODES.find((m) => MODI[m].toLowerCase() === kaal);
  return gevonden || null;
}

/** De waarde voor globalCompositeOperation. */
export function blendCanvasWaarde(mode) {
  if (!isGemengd(mode)) return 'source-over';
  return CANVAS[mode] || mode;
}
