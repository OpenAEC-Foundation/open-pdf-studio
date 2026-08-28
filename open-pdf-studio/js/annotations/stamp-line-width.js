// Lijndikte van een geplaatst symbool — eigen module, bewust GEEN import van
// stamps.js: die trekt ui/panels/properties-panel.js mee, wat via bridge.ts
// terugloopt naar solid/stores/propertiesStore.js. Omdat propertiesStore deze
// functie aanroept zou dat een import-cyclus opleveren.
import { getActiveDocument, imageCache } from '../core/state.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import {
  svgViewBoxWidth, svgBaseStrokeWidth, strokeUnitsForLineWidth,
  lineWidthForStroke, restrokeSvg,
} from './svg-stroke-width.js';
import { rasterizeSvg } from './svg-raster.js';

/**
 * De lijndikte die een geplaatst symbool op dit moment werkelijk oplevert, in
 * paginaeenheden. Het eigenschappenpaneel toont die in plaats van een geërfde
 * standaard, zodat de lijn niet verspringt zodra het veld wordt aangeraakt.
 *
 * Alleen zinvol als de bron zelf een dikte noemt: bij een SVG zonder enige
 * `stroke-width` (vaak puur gevulde vormen) zou de SVG-standaard van 1
 * gebruikerseenheid een getal opleveren dat nergens op slaat.
 *
 * @returns {number|null} null als er niets zinnigs te melden is.
 */
export function stampLineWidthOf(ann) {
  if (!ann || ann.type !== 'stamp' || !ann.stampSvg) return null;
  if (!/\bstroke-width\s*=/i.test(ann.stampSvg)) return null;
  return lineWidthForStroke({
    strokeUnits: svgBaseStrokeWidth(ann.stampSvg),
    viewBoxWidth: svgViewBoxWidth(ann.stampSvg),
    placedWidth: ann.width,
  });
}

/**
 * Pas de lijndikte van een geplaatst symbool aan.
 *
 * Een stempel wordt met `drawImage()` getekend en dat kent geen
 * `ctx.lineWidth`; de dikte moet dus IN de SVG staan vóór het rasteren.
 * `ann.lineWidth` is de dikte in paginaeenheden, net als bij elke andere
 * annotatie — die wordt hier omgerekend naar gebruikerseenheden van de
 * viewBox en in de bron gezet.
 *
 * De SVG-mutatie is SYNCHROON: `stampSvg` is wat opgeslagen en teruggedraaid
 * wordt, dus die moet klaar zijn voordat undo zijn momentopname maakt. Het
 * rasteren gebeurt daarna; `imageData` moet mee, want saver.js embedt de
 * stempel daaruit (anders wijkt de opgeslagen PDF af van het scherm).
 *
 * @returns {boolean} of de bron daadwerkelijk is gewijzigd.
 */
export function applyStampLineWidth(ann) {
  if (!ann || ann.type !== 'stamp' || !ann.stampSvg) return false;
  const units = strokeUnitsForLineWidth({
    lineWidth: ann.lineWidth,
    viewBoxWidth: svgViewBoxWidth(ann.stampSvg),
    placedWidth: ann.width,
  });
  if (units == null) return false;
  const next = restrokeSvg(ann.stampSvg, units);
  if (next === ann.stampSvg) return false;

  ann.stampSvg = next;
  // Oude rasterversie ongeldig maken zodat er geen verouderd beeld blijft
  // staan terwijl het nieuwe nog gerasterd wordt.
  if (ann.imageId) imageCache.delete(ann.imageId);
  ann._cachedImg = null;

  rasterizeSvg(next).then((result) => {
    if (!result) return;
    const cacheId = ann.imageId || ('stamp_svg_' + ann.id);
    imageCache.set(cacheId, result.img);
    ann.imageId = cacheId;
    ann._cachedImg = result.img;
    ann.imageData = result.dataUrl;
    redrawAnnotations();
    if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  });
  return true;
}
