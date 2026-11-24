import { viewportZichtbaar } from './weergave-rotatie.js';

const SCALE_EPSILON = 0.001;
const BOUNDS_EPSILON_PT = 0.5;

function coversRequest(meta, request, epsilon) {
  return Number.isFinite(meta.renderScale)
    && meta.renderScale + SCALE_EPSILON >= request.requiredScale
    && meta.regionXpt <= request.regionXpt + epsilon
    && meta.regionYpt <= request.regionYpt + epsilon
    && meta.regionXpt + meta.regionWpt
      >= request.regionXpt + request.regionWpt - epsilon
    && meta.regionYpt + meta.regionHpt
      >= request.regionYpt + request.regionHpt - epsilon;
}

/**
 * Return the cheapest cached tile that is already sharp enough and fully
 * covers the requested PDF-point viewport.
 */
export function findBestCoveringTile(entries, request, epsilon = BOUNDS_EPSILON_PT) {
  const candidates = entries.filter((entry) =>
    entry?.regionMeta && coversRequest(entry.regionMeta, request, epsilon));

  candidates.sort((a, b) => {
    const scaleDifference = a.regionMeta.renderScale - b.regionMeta.renderScale;
    if (Math.abs(scaleDifference) > SCALE_EPSILON) return scaleDifference;

    const aArea = a.regionMeta.regionWpt * a.regionMeta.regionHpt;
    const bArea = b.regionMeta.regionWpt * b.regionMeta.regionHpt;
    return aArea - bArea;
  });

  return candidates[0] || null;
}

// Het zichtbare deel van de pagina in PDF-punten van de paginaruimte (waar de
// tegels in staan). Houdt rekening met de paginarotatie (`rotation`, pageW/pageH
// zijn de maat daarvóór) en de weergaverotatie (`viewRotation`, #200): het
// scherm toont de pagina gedraaid, de tegels blijven ongedraaid.
export function visiblePdfRegion(viewport, cssWidth, cssHeight) {
  const zicht = viewportZichtbaar(viewport, cssWidth, cssHeight);
  return { x: zicht.x, y: zicht.y, w: zicht.width, h: zicht.height };
}

/**
 * Does the tile cover the visible region AND a margin around it (a fraction of
 * the region on each side, clamped to the page)? A tile that covers the view
 * only just is replaced in the background before the next step of a pan shows
 * the stretched whole-page bitmap under its edge.
 * `region` is {x, y, w, h} in page points, as visiblePdfRegion returns it.
 */
export function tileCoversWithMargin(tileMeta, region, pageW, pageH, fraction = 0.1) {
  if (!tileMeta || !region) return false;
  const mx = region.w * fraction;
  const my = region.h * fraction;
  const x0 = Math.max(0, region.x - mx);
  const y0 = Math.max(0, region.y - my);
  const x1 = Math.min(pageW, region.x + region.w + mx);
  const y1 = Math.min(pageH, region.y + region.h + my);
  return tileMeta.regionXpt <= x0 + BOUNDS_EPSILON_PT
    && tileMeta.regionYpt <= y0 + BOUNDS_EPSILON_PT
    && tileMeta.regionXpt + tileMeta.regionWpt >= x1 - BOUNDS_EPSILON_PT
    && tileMeta.regionYpt + tileMeta.regionHpt >= y1 - BOUNDS_EPSILON_PT;
}

export function tileCoversViewport(
  tileMeta,
  viewport,
  cssWidth,
  cssHeight,
  devicePixelRatio,
) {
  if (!tileMeta) return false;
  const region = visiblePdfRegion(viewport, cssWidth, cssHeight);
  return findBestCoveringTile([{ regionMeta: tileMeta }], {
    regionXpt: region.x,
    regionYpt: region.y,
    regionWpt: region.w,
    regionHpt: region.h,
    requiredScale: viewport.zoom * devicePixelRatio,
  }) !== null;
}
