// Werkelijke maat van een SVG-symbool — pure module, geen app-imports.
//
// Een SVG die uit CAD komt declareert zijn echte maat op de root, bv.
// `width="65.0mm" height="14.0mm"`. De meegeleverde symbolen doen dat NIET
// (die hebben alleen een viewBox), dus een symbool kiest hier zelf voor: geen
// eenheid op de root => het bestaande standaardgedrag blijft gelden.
//
// De omrekening naar paginapixels gebeurt in stamp-scale.js; deze module doet
// alleen het lezen en het rekenwerk, zodat het in node testbaar is.

// Alleen ECHTE lengte-eenheden. `px` en eenheidloze waarden zijn schermmaten,
// geen werkelijke maat, en tellen dus bewust niet mee.
const UNIT_TO_MM = {
  mm: 1,
  cm: 10,
  in: 25.4,
  pt: 25.4 / 72,
  pc: 25.4 / 6,
};

const ROOT_TAG = /<svg\b[^>]*>/i;
const LENGTH = /^\s*([+-]?[\d.]+)\s*([a-z]+)\s*$/i;
const WIDTH_ATTR = /\bwidth\s*=\s*"([^"]*)"/i;
const HEIGHT_ATTR = /\bheight\s*=\s*"([^"]*)"/i;

/** Float-ruis wegpoetsen (1.4 * 10 === 14.000000000000002). */
function tidy(v) {
  return Math.round(v * 1e6) / 1e6;
}

function attrMm(rootTag, attr) {
  const m = attr.exec(rootTag);
  if (!m) return null;
  const len = LENGTH.exec(m[1]);
  if (!len) return null;
  const factor = UNIT_TO_MM[len[2].toLowerCase()];
  if (!factor) return null;
  const mm = tidy(parseFloat(len[1]) * factor);
  return mm > 0 ? mm : null;
}

/**
 * Werkelijke maat van de SVG-root in millimeters.
 * @returns {{width:number,height:number}|null} null als de root geen echte
 *   eenheid declareert — dan is er geen werkelijke maat bekend.
 */
export function svgRealSizeMm(svg) {
  if (!svg || typeof svg !== 'string') return null;
  const root = ROOT_TAG.exec(svg);
  if (!root) return null;
  const width = attrMm(root[0], WIDTH_ATTR);
  const height = attrMm(root[0], HEIGHT_ATTR);
  if (width == null || height == null) return null;
  return { width, height };
}

/**
 * Plaatsingsmaat van een stempel in app-annotatiecoordinaten.
 *
 * 1. Kent de SVG een werkelijke maat EN is de tekeningschaal bekend, dan
 *    telt die maat: mm x paginapixels-per-mm.
 * 2. Anders het bestaande gedrag: de standaardhoogte, met de breedte uit de
 *    beeldverhouding — zodat een niet-vierkante SVG niet langer in een
 *    vierkant wordt geduwd.
 *
 * @param {{width:number,height:number}|null} mm werkelijke maat, of null
 * @param {number} pxPerMm paginapixels per mm; 0/onbekend => terugval
 * @param {number} aspect breedte/hoogte van de gerasterde SVG
 * @param {number} [defaultWidth] expliciete breedte van de aanroeper
 * @param {number} [defaultHeight] standaardhoogte
 */
export function stampPlacementSize({ mm, pxPerMm, aspect, defaultWidth, defaultHeight }) {
  if (mm && mm.width > 0 && mm.height > 0 && pxPerMm > 0) {
    return { width: tidy(mm.width * pxPerMm), height: tidy(mm.height * pxPerMm) };
  }
  const height = defaultHeight > 0 ? defaultHeight : 0;
  if (defaultWidth > 0) return { width: defaultWidth, height };
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return { width: Math.round(height * ratio), height };
}
