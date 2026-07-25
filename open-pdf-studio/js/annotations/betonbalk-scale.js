// Schaalgebied-bewuste brug voor de betonbalk.
//
// De pure geometrie-module (betonbalk.js) mag GEEN app-state importeren; de
// balkbreedte (breedteMm) moet toch de plaatselijke tekeningschaal volgen.
// Deze dunne helper haalt de px-per-mm op de positie van de balk op en levert
// de opts waarmee buildBetonbalk() de balk op werkelijke breedte tekent.
//
// De schaal wordt via de LICHTE bronnen opgevraagd (scale-region.js +
// scale-bar.js, die alleen state/factory importeren) — bewust NIET via
// symbols/real-size.js → annotations/measurement.js, want die keten trekt
// rendering.js mee en vormt dan een import-cyclus met de modules die deze
// helper aanroepen (rendering, geometry, spatial-index, selection-helpers).
// Zelfde patroon als stavenreeks-scale.js.
//
// FALLBACK: buiten elk schaalgebied (en zonder kalibratie) geldt de vaste
// 1:100-omrekening uit betonbalk.js (PX_PER_MM_1_100), zodat een balk op een
// ongekalibreerde tekening een verdedigbare papierbreedte houdt.
import { getScaleFromRegion } from './scale-region.js';
import { getScaleForPoint } from './scale-bar.js';
import { resolveBetonbalkParams, halfWidthFromMm } from './betonbalk.js';

const UNIT_TO_MM = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

// Referentiepunt van een balk: het midden van de bounding box van de
// hartlijnpunten — valt altijd binnen (of het dichtst bij) een schaalgebied
// dat de balk overlapt en is stabiel bij het bijtekenen van punten.
function _anchor(ann) {
  const pts = Array.isArray(ann?.points) ? ann.points : [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    const x = Number(p?.x), y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * Pagina-pixels per werkelijke millimeter op de positie van de balk.
 * Prioriteit: schaalgebied → viewport/schaalbalk/doc-schaal. 0 = onbekend
 * (dan valt halfWidthFromMm terug op de vaste 1:100-omrekening).
 */
export function betonbalkPxPerMm(ann) {
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

/** Halve balkbreedte in app-px, schaalgebied-bewust (fallback 1:100). */
export function betonbalkHalfWidthPx(ann) {
  const { breedteMm } = resolveBetonbalkParams(ann);
  return halfWidthFromMm(breedteMm, betonbalkPxPerMm(ann));
}

/**
 * opts voor buildBetonbalk(): eigen halve breedte + de andere betonbalken op
 * dezelfde pagina (voor de inter-balk-join), elk met hun eigen schaalbewuste
 * halve breedte. De doelbalken worden hier alleen GELEZEN — nooit gemuteerd.
 */
export function betonbalkBuildOpts(ann, annotations) {
  const others = [];
  for (const o of annotations || []) {
    if (!o || o.type !== 'betonbalk' || o === ann) continue;
    if (o.id != null && ann?.id != null && o.id === ann.id) continue;
    if (o.page !== ann?.page) continue;
    if (!Array.isArray(o.points) || o.points.length < 2) continue;
    others.push({ points: o.points, halfWidth: betonbalkHalfWidthPx(o) });
  }
  return { halfWidth: betonbalkHalfWidthPx(ann), others };
}
