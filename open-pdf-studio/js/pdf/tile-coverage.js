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

export function visiblePdfRegion(viewport, cssWidth, cssHeight) {
  const visibleScreenLeft = Math.max(0, -viewport.offsetX);
  const visibleScreenTop = Math.max(0, -viewport.offsetY);
  const visibleScreenRight = Math.min(
    viewport.pageW * viewport.zoom,
    cssWidth - viewport.offsetX,
  );
  const visibleScreenBottom = Math.min(
    viewport.pageH * viewport.zoom,
    cssHeight - viewport.offsetY,
  );

  return {
    x: visibleScreenLeft / viewport.zoom,
    y: visibleScreenTop / viewport.zoom,
    w: Math.max(0, visibleScreenRight - visibleScreenLeft) / viewport.zoom,
    h: Math.max(0, visibleScreenBottom - visibleScreenTop) / viewport.zoom,
  };
}
