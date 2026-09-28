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
