// Lijndikte van een SVG-symbool herschrijven — pure module, geen app-imports.
//
// Een geplaatst symbool is een rasterafbeelding: `ctx.drawImage()` kent geen
// `ctx.lineWidth`, dus de lijndikte moet IN de SVG staan voordat er gerasterd
// wordt. Deze module rekent een lijndikte in paginaeenheden om naar
// gebruikerseenheden van de viewBox en schrijft de bron om.
//
// Onderlinge verhoudingen blijven behouden: een symbool met een dikke en een
// dunne lijn houdt dat verschil. De BASIS (de meest voorkomende dikte) wordt
// op de gevraagde waarde gezet, de rest schaalt met dezelfde factor mee.
//
// Beperking: alleen `stroke-width`-ATTRIBUTEN worden herschreven, geen CSS in
// een <style>-blok. De meegeleverde bibliotheken gebruiken attributen.

const ROOT_TAG = /<svg\b[^>]*>/i;
const VIEWBOX = /\bviewBox\s*=\s*"\s*([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s*"/i;
const STROKE_W = /\bstroke-width\s*=\s*"([\d.]+)"/gi;

/** SVG-standaard als de bron zelf geen stroke-width noemt. */
const DEFAULT_STROKE_WIDTH = 1;

function tidy(v) {
  return Math.round(v * 1e4) / 1e4;
}

/** Breedte van de viewBox in gebruikerseenheden, of null. */
export function svgViewBoxWidth(svg) {
  if (!svg || typeof svg !== 'string') return null;
  const root = ROOT_TAG.exec(svg);
  const m = VIEWBOX.exec(root ? root[0] : svg);
  if (!m) return null;
  const w = parseFloat(m[3]);
  return w > 0 ? w : null;
}

/**
 * De basisdikte van de bron: de meest voorkomende `stroke-width`. Bij gelijke
 * stand wint de kleinste — dat is in tekeningen vrijwel altijd de hoofdlijn.
 */
export function svgBaseStrokeWidth(svg) {
  if (!svg || typeof svg !== 'string') return DEFAULT_STROKE_WIDTH;
  const counts = new Map();
  for (const m of svg.matchAll(STROKE_W)) {
    const w = parseFloat(m[1]);
    if (w > 0) counts.set(w, (counts.get(w) || 0) + 1);
  }
  if (counts.size === 0) return DEFAULT_STROKE_WIDTH;
  let best = null;
  let bestCount = -1;
  for (const [w, c] of counts) {
    if (c > bestCount || (c === bestCount && w < best)) {
      best = w;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Lijndikte in paginaeenheden -> dikte in gebruikerseenheden van de viewBox.
 * De SVG wordt over `placedWidth` paginaeenheden uitgetekend, dus één
 * gebruikerseenheid is `placedWidth / viewBoxWidth` paginaeenheden.
 *
 * @returns {number|null} null als er niets zinnigs te berekenen valt.
 */
export function strokeUnitsForLineWidth({ lineWidth, viewBoxWidth, placedWidth }) {
  if (!(lineWidth > 0) || !(viewBoxWidth > 0) || !(placedWidth > 0)) return null;
  return tidy(lineWidth * viewBoxWidth / placedWidth);
}

/**
 * De terugweg: welke lijndikte in paginaeenheden levert een dikte in
 * gebruikerseenheden op bij de huidige plaatsingsbreedte? Gebruikt om het
 * eigenschappenpaneel de WERKELIJKE dikte van een symbool te laten tonen in
 * plaats van een geërfde standaard.
 *
 * @returns {number|null}
 */
export function lineWidthForStroke({ strokeUnits, viewBoxWidth, placedWidth }) {
  if (!(strokeUnits > 0) || !(viewBoxWidth > 0) || !(placedWidth > 0)) return null;
  return tidy(strokeUnits * placedWidth / viewBoxWidth);
}

/**
 * Herschrijf de lijndikten zodat de basisdikte `target` gebruikerseenheden
 * wordt. Heeft de bron geen enkele `stroke-width`, dan wordt er één op de root
 * gezet. Bij onbruikbare invoer komt de bron ongewijzigd terug.
 */
export function restrokeSvg(svg, target) {
  if (!svg || typeof svg !== 'string') return svg;
  if (!(target > 0)) return svg;

  const base = svgBaseStrokeWidth(svg);
  const factor = target / base;
  if (!Number.isFinite(factor) || factor <= 0) return svg;

  STROKE_W.lastIndex = 0;
  if (!STROKE_W.test(svg)) {
    // Geen enkele dikte in de bron: op de root zetten, zodat alles erft.
    return svg.replace(ROOT_TAG, (tag) => tag.replace(/>$/, ` stroke-width="${tidy(target)}">`));
  }
  STROKE_W.lastIndex = 0;
  return svg.replace(STROKE_W, (_all, w) => `stroke-width="${tidy(parseFloat(w) * factor)}"`);
}
