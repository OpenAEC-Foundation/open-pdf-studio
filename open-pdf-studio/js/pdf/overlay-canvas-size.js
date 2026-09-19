// Maat van de overlay-canvassen (#annotation-canvas en #text-highlight-canvas)
// in de enkelpagina-weergave.
//
// redrawAnnotations() tekent in één van twee ruimtes, en de overlay moet exact
// de maat van díe ruimte hebben:
//
//  - viewport: de RAF-lus van pdf-viewport.js bezit #pdf-canvas op
//    containermaat en tekent de pagina met (zoom, offsetX, offsetY).
//    Annotaties gaan met dezelfde transform over het HELE venster.
//    Overlay = viewport in CSS-pixels, zonder inline CSS-maat.
//  - pagina: PDF.js tekent de pagina rechtstreeks op #pdf-canvas (leeg
//    document, webversie). Overlay = paginamaat × dpr, CSS = paginamaat.
//
// Waarom dit een eigen beslisregel is: renderPage() zette de overlay aan het
// eind altijd op de PAGINAmaat, ook als de viewport de pagina tekende. Alleen
// de eerstvolgende _render()-frame zette hem terug op de viewportmaat. Kwam
// die frame niet — bv. p2 → p3 met gelijke paginamaat, waar zoom en offsets
// al kloppen (fitToViewport() doet niets) en de bitmap al vóór het einde van
// renderPage() binnen was — dan bleef de overlay op paginamaat staan en werden
// annotaties verkleind en verschoven getekend. Gemeten op
// NKE2D2_opm_aw.pdf p3 (5156×2384 pt, venster 855×697, dpr 1,5): overlay
// 1283×593 backing met CSS 855×395 onder een #pdf-canvas van 1283×1046.
//
// De regel volgt exact de keuze die redrawAnnotations() maakt
// (`vp.active && doc.filePath` → viewport-transform), zodat het pixelraster
// van de overlay altijd bij de gebruikte transform hoort.

/**
 * Tekent redrawAnnotations() in de viewport-ruimte?
 *
 * @param {object} o
 * @param {boolean} o.viewportActief    Is de pdf-viewport-singleton actief?
 * @param {boolean} o.heeftBestandspad  Heeft het actieve document een pad?
 * @returns {boolean}
 */
export function overlayVolgtViewport({ viewportActief, heeftBestandspad }) {
  return !!viewportActief && !!heeftBestandspad;
}

function isPositief(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * Bepaal de maat van de overlay-canvassen.
 *
 * width/height zijn gehele getallen, afgerond zoals een <canvas> ze opslaat
 * (unsigned long → naar beneden). Zo is een tweede toepassing met dezelfde,
 * fractionele viewportmaat (dpr 1,25 / 1,5) een no-op in plaats van een
 * canvas-wis per frame.
 *
 * @param {object} o
 * @param {boolean} o.viewportActief
 * @param {boolean} o.heeftBestandspad
 * @param {number} [o.viewportCssW]  #pdf-canvas backing-breedte / dpr
 * @param {number} [o.viewportCssH]  #pdf-canvas backing-hoogte / dpr
 * @param {number} [o.paginaCssW]    Paginabreedte in CSS-px op doc.scale
 * @param {number} [o.paginaCssH]    Paginahoogte in CSS-px op doc.scale
 * @param {number} [o.dpr]           devicePixelRatio (alleen paginamodus)
 * @returns {{bron: 'viewport'|'pagina', width: number, height: number,
 *            cssWidth: string, cssHeight: string} | null}
 *   null = geen geldige maat; laat de canvassen dan ongemoeid. In
 *   viewport-modus wordt NOOIT op de paginamaat teruggevallen.
 */
export function bepaalOverlayMaat({
  viewportActief,
  heeftBestandspad,
  viewportCssW,
  viewportCssH,
  paginaCssW,
  paginaCssH,
  dpr,
}) {
  if (overlayVolgtViewport({ viewportActief, heeftBestandspad })) {
    if (!isPositief(viewportCssW) || !isPositief(viewportCssH)) return null;
    return {
      bron: 'viewport',
      width: Math.floor(viewportCssW),
      height: Math.floor(viewportCssH),
      cssWidth: '',
      cssHeight: '',
    };
  }
  if (!isPositief(paginaCssW) || !isPositief(paginaCssH)) return null;
  const r = isPositief(dpr) ? dpr : 1;
  return {
    bron: 'pagina',
    width: Math.floor(paginaCssW * r),
    height: Math.floor(paginaCssH * r),
    cssWidth: `${Math.floor(paginaCssW)}px`,
    cssHeight: `${Math.floor(paginaCssH)}px`,
  };
}

/**
 * Pas een maat uit bepaalOverlayMaat() toe op een canvas. Raakt de backing
 * store alleen aan als die echt verandert (elke toewijzing aan width/height
 * wist het canvas).
 *
 * @param {{width: number, height: number, style?: {width: string, height: string}} | null} canvas
 * @param {ReturnType<typeof bepaalOverlayMaat>} maat
 * @returns {boolean} true als er iets gewijzigd is
 */
export function pasOverlayMaatToe(canvas, maat) {
  if (!canvas || !maat) return false;
  let gewijzigd = false;
  if (canvas.width !== maat.width || canvas.height !== maat.height) {
    canvas.width = maat.width;
    canvas.height = maat.height;
    gewijzigd = true;
  }
  const st = canvas.style;
  if (st) {
    if (st.width !== maat.cssWidth) { st.width = maat.cssWidth; gewijzigd = true; }
    if (st.height !== maat.cssHeight) { st.height = maat.cssHeight; gewijzigd = true; }
  }
  return gewijzigd;
}
