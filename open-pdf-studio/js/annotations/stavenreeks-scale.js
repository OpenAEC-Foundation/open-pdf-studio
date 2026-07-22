// Schaalgebied-bewuste brug voor de stavenreeks.
//
// De pure geometrie-module (stavenreeks.js) mag GEEN app-state importeren; de
// puntstraal moet toch de plaatselijke tekeningschaal kunnen volgen. Deze
// dunne helper haalt de px-per-mm op de positie van de reeks op en levert de
// opts waarmee buildStavenreeks() de staven op werkelijke maat tekent.
//
// ALLEEN de puntstraal is schaal-bewust. Pootlengte, uitloop, labelgrootte en
// lijndikte blijven papier-constant en komen dus NIET uit deze helper.
//
// De schaal wordt via de LICHTE bronnen opgevraagd (scale-region.js +
// scale-bar.js, die alleen state/factory importeren) — bewust NIET via
// symbols/real-size.js → annotations/measurement.js, want die keten trekt
// rendering.js mee en vormt dan een import-cyclus met de modules die deze
// helper aanroepen (rendering, geometry, spatial-index).
import { getScaleFromRegion } from './scale-region.js';
import { getScaleForPoint } from './scale-bar.js';

const UNIT_TO_MM = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

/**
 * px-per-mm op het MIDDEN van de reekslijn van een stavenreeks-annotatie.
 * Het midden valt altijd binnen (of het dichtst bij) een eventueel
 * schaalgebied dat de reeks overlapt, en is rotatie-onafhankelijk.
 *
 * Prioriteit — identiek aan measurement.getMeasureScale voor een punt:
 *   schaalgebied (scaleRegion) → viewport/scaleBar/doc-schaal (getScaleForPoint).
 * getScaleForPoint valt zelf al terug op doc.measureScale, dus die keten dekt
 * alle gekalibreerde gevallen.
 *
 * @returns {number} Pagina-pixels per werkelijke millimeter, of 0 als er geen
 *   schaal bekend is (dan valt pointRadius terug op de papier-constante formule).
 */
export function stavenreeksPxPerMm(ann) {
  if (!ann) return 0;
  const page = ann.page;
  const cx = ((Number(ann.startX) || 0) + (Number(ann.endX) || 0)) / 2;
  const cy = ((Number(ann.startY) || 0) + (Number(ann.endY) || 0)) / 2;
  let ms = null;
  if (page != null) {
    ms = getScaleFromRegion(page, cx, cy) || getScaleForPoint(page, cx, cy) || null;
  }
  if (!ms || !(ms.pixelsPerUnit > 0)) return 0;
  const mmPerUnit = UNIT_TO_MM[ms.unit || 'mm'] || 1;
  const k = ms.pixelsPerUnit / mmPerUnit;
  return Number.isFinite(k) && k > 0 ? k : 0;
}

/**
 * opts voor buildStavenreeks() met de schaal-bewuste puntstraal ingevuld.
 * Voeg desgewenst een `measureText` toe via de spread in de aanroeper.
 */
export function stavenreeksScaleOpts(ann) {
  return { pxPerMm: stavenreeksPxPerMm(ann) };
}
