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
import { schaalMaat } from '../symbols/symbol-scale.js';
import { OVERRIDE_STAMP_DEFAULT_HEIGHT } from './stamp-defaults.js';

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

/** Paginaeenheden per papiermillimeter bij /UserUnit 1 (1 pt = 25,4/72 mm). */
export const PT_PER_PAPIER_MM = 72 / 25.4;

/**
 * Paginaeenheden per papiermillimeter op een pagina met deze /UserUnit
 * (één eenheid is UserUnit/72 inch, #884).
 * @param {number} [userUnit]
 */
export function ptPerPapierMm(userUnit = 1) {
  const u = Number(userUnit);
  return PT_PER_PAPIER_MM / (Number.isFinite(u) && u > 0 ? u : 1);
}

/**
 * Soort maat van een te plaatsen stempel (#983):
 *  - 'werkelijk': de SVG-root declareert een echte maat (CAD-symbool,
 *    meubilair op ware grootte); volgt de tekeningschaal.
 *  - 'papier': een annotatiesymbool uit het palet (brandveiligheid, elektra,
 *    GD&T, ...); een vaste papiermaat, los van de tekeningschaal.
 *  - 'standaard': iets anders (extensie-stempel, eigen afbeelding); de
 *    opgegeven of standaard hoogte in paginaeenheden, zoals altijd.
 * Parametrische symbolen op werkelijke maat (staalprofielen, palen) lopen
 * niet via stempels maar via symbols/real-size.js.
 * @param {{stampSvg?:string, stampPaperHeightMm?:number}|null|undefined} ov
 * @returns {'werkelijk'|'papier'|'standaard'}
 */
export function symboolMaatSoort(ov) {
  if (svgRealSizeMm(ov?.stampSvg)) return 'werkelijk';
  if (ov?.stampPaperHeightMm > 0) return 'papier';
  return 'standaard';
}

/**
 * Plaatsingsmaat van een stempel in app-annotatiecoordinaten.
 *
 * 1. Kent de SVG een werkelijke maat EN is de tekeningschaal bekend, dan
 *    telt die maat: mm x paginapixels-per-mm.
 * 2. Anders, met een papierhoogte (annotatiesymbool, #983): die hoogte in
 *    papiermillimeters, omgerekend met de /UserUnit van de pagina; de
 *    tekeningschaal telt niet mee. De breedte volgt uit de beeldverhouding.
 * 3. Anders het bestaande gedrag: de standaardhoogte, met de breedte uit de
 *    beeldverhouding — zodat een niet-vierkante SVG niet langer in een
 *    vierkant wordt geduwd.
 *
 * @param {{width:number,height:number}|null} mm werkelijke maat, of null
 * @param {number} pxPerMm paginapixels per mm; 0/onbekend => terugval
 * @param {number} aspect breedte/hoogte van de gerasterde SVG
 * @param {number} [defaultWidth] expliciete breedte van de aanroeper
 * @param {number} [defaultHeight] standaardhoogte
 * @param {number} [papierHoogteMm] hoogte op papier in mm (annotatiesymbool)
 * @param {number} [ptPerMmPapier] paginaeenheden per papier-mm (standaard /UserUnit 1)
 */
export function stampPlacementSize({ mm, pxPerMm, aspect, defaultWidth, defaultHeight, schaal, papierHoogteMm, ptPerMmPapier }) {
  const maat = _basismaat({ mm, pxPerMm, aspect, defaultWidth, defaultHeight, papierHoogteMm, ptPerMmPapier });
  // De door de gebruiker gekozen symboolschaal (issue #357) werkt op de
  // UITKOMST, niet op de werkelijke maat: een symbool met een echte maat in mm
  // hoort ook op 2x geplaatst te kunnen worden.
  return schaalMaat(maat, schaal);
}

/**
 * Plaatsingsmaat van een stempel uit de gereedschapsinstellingen (een symbool
 * uit het palet of van een extensie). EEN bron voor zowel de spookafbeelding
 * onder de cursor als de echte plaatsing (issue #357): eerder rekende het
 * voorbeeld zonder de gekozen symboolschaal en met een andere terugvalhoogte,
 * waardoor het voorbeeld een andere maat had dan wat er daarna op de tekening
 * kwam.
 *
 * Een symbool uit het palet draagt `stampPaperHeightMm` (annotatiesymbool,
 * vaste papiermaat, #983); `ptPerMmPapier` geeft dan de paginaeenheden per
 * papier-mm van de pagina (ptPerPapierMm met de /UserUnit).
 *
 * @param {{stampSvg?:string, stampWidth?:number, stampHeight?:number, stampPaperHeightMm?:number}} ov
 * @param {{pxPerMm?:number, aspect?:number, schaal?:number, ptPerMmPapier?:number}} [context]
 */
export function overrideStampMaat(ov, { pxPerMm, aspect, schaal, ptPerMmPapier } = {}) {
  return stampPlacementSize({
    mm: svgRealSizeMm(ov?.stampSvg),
    pxPerMm,
    aspect,
    defaultWidth: ov?.stampWidth,
    defaultHeight: ov?.stampHeight || OVERRIDE_STAMP_DEFAULT_HEIGHT,
    papierHoogteMm: ov?.stampPaperHeightMm,
    ptPerMmPapier,
    schaal,
  });
}

function _basismaat({ mm, pxPerMm, aspect, defaultWidth, defaultHeight, papierHoogteMm, ptPerMmPapier }) {
  if (mm && mm.width > 0 && mm.height > 0 && pxPerMm > 0) {
    return { width: tidy(mm.width * pxPerMm), height: tidy(mm.height * pxPerMm) };
  }
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (papierHoogteMm > 0) {
    const k = ptPerMmPapier > 0 ? ptPerMmPapier : PT_PER_PAPIER_MM;
    const height = tidy(papierHoogteMm * k);
    return { width: tidy(height * ratio), height };
  }
  const height = defaultHeight > 0 ? defaultHeight : 0;
  if (defaultWidth > 0) return { width: defaultWidth, height };
  return { width: Math.round(height * ratio), height };
}
