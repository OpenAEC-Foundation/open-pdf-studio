// Schaalgebied-bewuste brug voor het systeemraster.
//
// De pure geometrie-module (systeemraster.js) mag GEEN app-state importeren;
// de plaatmaat (mm) moet toch de plaatselijke tekeningschaal volgen. Deze
// dunne helper haalt de px-per-mm op de positie van het raster op en levert
// de opts waarmee buildSysteemraster() op werkelijke maat tekent.
//
// De schaal wordt via de LICHTE bronnen opgevraagd (scale-region.js +
// scale-bar.js, die alleen state/factory importeren) — zelfde patroon en
// zelfde motivatie (import-cyclus vermijden) als betonbalk-scale.js.
//
// FALLBACK: buiten elk schaalgebied (en zonder kalibratie) geldt de vaste
// 1:100-omrekening uit systeemraster.js (PX_PER_MM_1_100).
import { getScaleFromRegion } from './scale-region.js';
import { getScaleForPoint } from './scale-bar.js';
import { systeemrasterContour } from './systeemraster.js';
import { getSysteemTypeById } from './systeem-typen-registry.js';

const UNIT_TO_MM = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

// Referentiepunt: het zwaartepunt van de contourpunten — valt altijd binnen
// (of het dichtst bij) een schaalgebied dat het veld overlapt.
function _anchor(ann) {
  const pts = systeemrasterContour(ann);
  if (!pts) return null;
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  return { x: sx / pts.length, y: sy / pts.length };
}

/**
 * Pagina-pixels per werkelijke millimeter op de positie van het raster.
 * Prioriteit: schaalgebied → viewport/schaalbalk/doc-schaal. 0 = onbekend
 * (dan valt buildSysteemraster terug op de vaste 1:100-omrekening).
 */
export function systeemrasterPxPerMm(ann) {
  if (!ann || ann.page == null) return 0;
  const a = _anchor(ann);
  if (!a) return 0;
  const ms = getScaleFromRegion(ann.page, a.x, a.y)
    || getScaleForPoint(ann.page, a.x, a.y) || null;
  if (!ms || !(ms.pixelsPerUnit > 0)) return 0;
  const mmPerUnit = UNIT_TO_MM[ms.unit || 'mm'] || 1;
  const k = ms.pixelsPerUnit / mmPerUnit;
  return Number.isFinite(k) && k > 0 ? k : 0;
}

/** opts voor buildSysteemraster(): schaalbewuste px-per-mm + de
 *  SYSTEEMTYPE-definitie uit de registry (ann.systeemTypeId → typeDef).
 *  Eén plek, zodat álle aanroepers (render, saver, grips, tools, panelen)
 *  dezelfde type-resolutie zien. */
export function systeemrasterBuildOpts(ann) {
  return {
    pxPerMm: systeemrasterPxPerMm(ann),
    typeDef: ann && ann.systeemTypeId ? getSysteemTypeById(ann.systeemTypeId) : null,
  };
}
