// Schaalgebied-bewuste brug voor stempels met een werkelijke maat.
//
// De schaal wordt via de LICHTE bronnen opgevraagd (scale-region.js +
// scale-bar.js, die alleen state/factory importeren) — bewust NIET via
// symbols/real-size.js → annotations/measurement.js, want die keten trekt
// rendering.js mee en stamps.js importeert rendering.js zelf al.
// Zelfde patroon als betonbalk-scale.js en stavenreeks-scale.js.
//
// FALLBACK: geen schaalgebied en geen kalibratie => 0, waarna
// stampPlacementSize() terugvalt op de standaardhoogte + beeldverhouding.
import { getScaleFromRegion } from './scale-region.js';
import { getScaleForPoint } from './scale-bar.js';

const UNIT_TO_MM = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

/**
 * Pagina-pixels per werkelijke millimeter op het invoegpunt van een stempel.
 * Prioriteit — identiek aan measurement.getMeasureScale voor een punt:
 *   schaalgebied (scaleRegion) → viewport/scaleBar/doc-schaal.
 *
 * @returns {number} px per mm, of 0 als er geen schaal bekend is.
 */
export function stampPxPerMm(page, x, y) {
  if (page == null || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
  const ms = getScaleFromRegion(page, x, y) || getScaleForPoint(page, x, y) || null;
  if (!ms || !(ms.pixelsPerUnit > 0)) return 0;
  const mmPerUnit = UNIT_TO_MM[ms.unit || 'mm'] || 1;
  const k = ms.pixelsPerUnit / mmPerUnit;
  return Number.isFinite(k) && k > 0 ? k : 0;
}
